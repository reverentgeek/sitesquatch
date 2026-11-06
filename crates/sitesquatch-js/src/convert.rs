//! Converting between template values (`sitesquatch::Value`) and JavaScript.
//!
//! Objects and arrays go to JavaScript as lazy views (see `views.rs`) and
//! come back as copies, unless they're views nobody wrote to. Dates stay
//! dates, and functions cross over as callable functions.

use std::cell::OnceCell;
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Utc};
use rquickjs::function::Rest;
use rquickjs::{Array, CaughtError, Ctx, Exception, Function, Object, Type};
use sitesquatch::{Map, Value};

use crate::views;
use crate::{Engine, JsFn};

/// File name of the prelude, whose frames are hidden from stack traces.
pub(crate) const PRELUDE_NAME: &str = "<ssqch>";

/// Objects and arrays holding at most this many values in total (at any
/// depth) are copied into JavaScript instead of viewed.
const SMALL: usize = 16;

fn is_small(v: &Value) -> bool {
    fn fits(v: &Value, budget: &mut usize) -> bool {
        if *budget == 0 {
            return false;
        }
        *budget -= 1;
        match v {
            Value::Arr(items) => items.iter().all(|i| fits(i, budget)),
            Value::Obj(map) => map.values().all(|i| fits(i, budget)),
            _ => true,
        }
    }
    fits(v, &mut SMALL.clone())
}

/// Objects nested deeper than this are almost certainly circular.
const MAX_DEPTH: usize = 128;

/// Converts values, looking up the prelude's helper functions only when a
/// conversion needs one (most only touch strings and numbers).
pub(crate) struct Conv<'js> {
    ctx: Ctx<'js>,
    engine: Arc<Engine>,
    helpers: Object<'js>,
    date_ms: OnceCell<Function<'js>>,
    make_date: OnceCell<Function<'js>>,
    keep: OnceCell<Function<'js>>,
    make_view: OnceCell<Function<'js>>,
    unwrap_view: OnceCell<Function<'js>>,
    is_array: OnceCell<Function<'js>>,
}

impl<'js> Conv<'js> {
    pub(crate) fn new(ctx: &Ctx<'js>, engine: &Arc<Engine>) -> Result<Self> {
        Ok(Conv {
            ctx: ctx.clone(),
            engine: engine.clone(),
            helpers: ctx.globals().get("__ssqch")?,
            date_ms: OnceCell::new(),
            make_date: OnceCell::new(),
            keep: OnceCell::new(),
            make_view: OnceCell::new(),
            unwrap_view: OnceCell::new(),
            is_array: OnceCell::new(),
        })
    }

    fn helper<'a>(&'a self, cell: &'a OnceCell<Function<'js>>, name: &str) -> Result<&'a Function<'js>> {
        if let Some(f) = cell.get() {
            return Ok(f);
        }
        let f: Function = self.helpers.get(name)?;
        Ok(cell.get_or_init(|| f))
    }

    pub(crate) fn to_js(&self, v: &Value) -> Result<rquickjs::Value<'js>> {
        let ctx = self.ctx.clone();
        Ok(match v {
            Value::Undefined => rquickjs::Value::new_undefined(ctx),
            Value::Null => rquickjs::Value::new_null(ctx),
            Value::Bool(b) => rquickjs::Value::new_bool(ctx, *b),
            Value::Num(n) => rquickjs::Value::new_number(ctx, *n),
            Value::Str(s) => rquickjs::String::from_str(ctx, s)?.into_value(),
            // Small values (object literals in templates) are cheaper to copy than to wrap.
            Value::Arr(items) if is_small(v) => {
                let arr = Array::new(ctx)?;
                for (i, item) in items.iter().enumerate() {
                    arr.set(i, self.to_js(item)?)?;
                }
                arr.into_value()
            }
            Value::Obj(map) if is_small(v) => {
                let obj = Object::new(ctx)?;
                for (k, item) in map.iter() {
                    obj.set(k.as_str(), self.to_js(item)?)?;
                }
                obj.into_value()
            }
            Value::Arr(_) | Value::Obj(_) => {
                self.engine.views_used.store(true, std::sync::atomic::Ordering::Relaxed);
                views::view(&ctx, self.helper(&self.make_view, "view")?, v)?
            }
            Value::Date(d) => self.helper(&self.make_date, "makeDate")?.call((d.timestamp_millis() as f64,))?,
            Value::Func(f) if self.engine.origin(f).is_some() => {
                let fns: Array = self.ctx.globals().get::<_, Object>("__ssqch")?.get("fns")?;
                fns.get(self.engine.origin(f).unwrap_or_default() as usize)?
            }
            Value::Func(f) => {
                let f = f.clone();
                let engine = self.engine.clone();
                Function::new(ctx, move |ctx: Ctx<'js>, args: Rest<rquickjs::Value<'js>>| -> rquickjs::Result<rquickjs::Value<'js>> {
                    let result = Conv::new(&ctx, &engine).and_then(|conv| {
                        let args = args.0.into_iter().map(|a| conv.from_js(a)).collect::<Result<Vec<_>>>()?;
                        let out = f.call(&args)?;
                        conv.to_js(&out)
                    });
                    result.map_err(|e| Exception::throw_message(&ctx, &format!("{:#}", e)))
                })?
                .into_value()
            }
        })
    }

    pub(crate) fn from_js(&self, v: rquickjs::Value<'js>) -> Result<Value> {
        self.from_js_at(v, 0)
    }

    fn from_js_at(&self, v: rquickjs::Value<'js>, depth: usize) -> Result<Value> {
        if depth > MAX_DEPTH {
            bail!("value is nested too deeply (is it circular?)");
        }
        Ok(match v.type_of() {
            Type::Uninitialized | Type::Undefined | Type::Symbol | Type::Module | Type::Unknown => Value::Undefined,
            Type::Null => Value::Null,
            Type::Bool => Value::Bool(v.as_bool().unwrap_or_default()),
            Type::Int | Type::Float => Value::Num(v.as_number().unwrap_or(f64::NAN)),
            Type::BigInt => Value::Num(v.as_big_int().and_then(|b| b.clone().to_i64().ok()).map(|n| n as f64).unwrap_or(f64::NAN)),
            Type::String => Value::str(v.as_string().map(|s| s.to_string()).transpose()?.unwrap_or_default()),
            // A view nobody wrote to goes back as the original value.
            Type::Array | Type::Object | Type::Proxy if let Some(original) = views::unwrap(self.helper(&self.unwrap_view, "unwrapView")?, &v)? => original,
            // A Proxy around an array (a view that was written to, say by sort()).
            Type::Proxy if self.helper(&self.is_array, "isArray")?.call::<_, bool>((v.clone(),))? => {
                let obj = v.into_object().ok_or_else(|| anyhow!("expected an array"))?;
                let len: f64 = obj.get("length")?;
                let mut items = Vec::with_capacity(len as usize);
                for i in 0..len as usize {
                    items.push(self.from_js_at(obj.get(i as u32)?, depth + 1)?);
                }
                Value::array(items)
            }
            Type::Array => {
                let arr = v.into_array().ok_or_else(|| anyhow!("expected an array"))?;
                let mut items = Vec::with_capacity(arr.len());
                for item in arr.iter::<rquickjs::Value>() {
                    items.push(self.from_js_at(item?, depth + 1)?);
                }
                Value::array(items)
            }
            Type::Function | Type::Constructor => {
                let id: u32 = self.helper(&self.keep, "keep")?.call((v,))?;
                self.engine.value(JsFn { engine: self.engine.clone(), id })
            }
            Type::Promise => bail!("got a Promise inside a value; await it before returning"),
            Type::Object | Type::Exception | Type::Proxy => {
                let ms: Option<f64> = self.helper(&self.date_ms, "dateMs")?.call((v.clone(),))?;
                if let Some(ms) = ms {
                    return Ok(DateTime::<Utc>::from_timestamp_millis(ms as i64).map(Value::Date).unwrap_or(Value::Null));
                }
                let obj = v.into_object().ok_or_else(|| anyhow!("expected an object"))?;
                let mut map = Map::new();
                for prop in obj.props::<String, rquickjs::Value>() {
                    let (k, item) = prop?;
                    map.insert(k, self.from_js_at(item, depth + 1)?);
                }
                Value::object(map)
            }
        })
    }
}

/// Await `v` if it's a Promise. The engine has no timers or I/O, so a
/// promise that's still pending once the job queue is empty never settles.
pub(crate) fn settle(v: rquickjs::Value<'_>) -> rquickjs::Result<rquickjs::Value<'_>> {
    match v.as_promise() {
        Some(p) => p.finish(),
        None => Ok(v),
    }
}

/// Turn a caught JavaScript error into a readable message with its stack.
pub(crate) fn caught(e: CaughtError<'_>) -> anyhow::Error {
    match e {
        CaughtError::Exception(ex) => {
            let message = ex.message().unwrap_or_default();
            let stack = ex.stack().unwrap_or_default();
            let stack = stack.lines().filter(|l| !l.contains(PRELUDE_NAME)).collect::<Vec<_>>().join("\n");
            let stack = stack.trim_end();
            if stack.is_empty() { anyhow!("{}", message) } else { anyhow!("{}\n{}", message, stack) }
        }
        CaughtError::Value(v) => {
            let text = v.get::<rquickjs::Coerced<String>>().map(|s| s.0).unwrap_or_else(|_| "a non-Error value".into());
            anyhow!("uncaught {}", text)
        }
        CaughtError::Error(rquickjs::Error::WouldBlock) => anyhow!("a Promise never settled (timers and network requests aren't available yet)"),
        CaughtError::Error(e) => anyhow!("{}", e),
    }
}
