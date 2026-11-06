//! Template objects and arrays passed to JavaScript as lazy views instead of
//! deep copies.
//!
//! A [`Handle`] wraps a Rust value (an `Arc`, so it's cheap to hold). The
//! prelude wraps each handle in a `Proxy` that fetches properties from it on
//! first access and caches them, so passing a page's data (with all global
//! data and every collection) to a filter costs nothing until the filter
//! reads it. The first write copies the value into the proxy (copy-on-write),
//! so code like `posts.sort()` still works. A view returned to Rust unchanged
//! unwraps to the original value, again without copying.

use std::sync::Arc;

use anyhow::Result;
use rquickjs::class::{JsClass, Readable, Trace, Tracer};
use rquickjs::{Class, Constructor, Ctx, Exception, Function, JsLifetime, Object};
use sitesquatch::Value;

use crate::convert::Conv;
use crate::Engine;

/// A template object or array, held for a JavaScript view of it.
pub(crate) struct Handle(pub(crate) Value);

impl<'js> Trace<'js> for Handle {
    fn trace<'a>(&self, _tracer: Tracer<'a, 'js>) {}
}

// SAFETY: `Handle` holds no JavaScript values, so it has no `'js` lifetime.
unsafe impl<'js> JsLifetime<'js> for Handle {
    type Changed<'to> = Handle;
}

impl<'js> JsClass<'js> for Handle {
    const NAME: &'static str = "TemplateValue";
    type Mutable = Readable;

    fn constructor(_ctx: &Ctx<'js>) -> rquickjs::Result<Option<Constructor<'js>>> {
        Ok(None)
    }
}

impl Handle {
    /// Identifies the underlying value, so two views of the same object
    /// within one call are the same proxy (`a.page === b.page`).
    fn identity(&self) -> f64 {
        match &self.0 {
            Value::Obj(m) => Arc::as_ptr(m) as *const () as usize as f64,
            Value::Arr(a) => Arc::as_ptr(a) as *const () as usize as f64,
            _ => 0.0,
        }
    }
}

/// The native side of views, used by the prelude's `view()`.
pub(crate) fn install<'js>(ctx: &Ctx<'js>, engine: &Arc<Engine>) -> rquickjs::Result<()> {
    let views = Object::new(ctx.clone())?;

    views.set(
        "keys",
        Function::new(ctx.clone(), |handle: Class<'js, Handle>| -> Vec<String> {
            handle.borrow().0.as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default()
        })?,
    )?;

    let engine = Arc::downgrade(engine);
    views.set(
        "get",
        // Returns `missing` when the key isn't there.
        Function::new(ctx.clone(), move |ctx: Ctx<'js>, handle: Class<'js, Handle>, key: String, missing: rquickjs::Value<'js>| -> rquickjs::Result<rquickjs::Value<'js>> {
            let child = {
                let h = handle.borrow();
                match &h.0 {
                    Value::Obj(m) => m.get(&key).cloned(),
                    Value::Arr(a) => key.parse::<usize>().ok().and_then(|i| a.get(i)).cloned(),
                    _ => None,
                }
            };
            let Some(child) = child else { return Ok(missing) };
            let engine = engine.upgrade().ok_or_else(|| Exception::throw_message(&ctx, "the JavaScript engine has shut down"))?;
            let result: Result<rquickjs::Value<'js>> = Conv::new(&ctx, &engine).and_then(|conv| conv.to_js(&child));
            result.map_err(|e| Exception::throw_message(&ctx, &format!("{:#}", e)))
        })?,
    )?;

    // A fresh (unshared) view of the items in an array whose `data.tags`
    // include every tag in `tags`, or of all of them when `tags` is null.
    // Backs the collection API's getAll and getFilteredByTag(s).
    views.set(
        "select",
        Function::new(ctx.clone(), |ctx: Ctx<'js>, handle: Class<'js, Handle>, tags: Option<Vec<String>>| -> rquickjs::Result<rquickjs::Value<'js>> {
            let items: Vec<Value> = {
                let h = handle.borrow();
                let all = h.0.as_array().unwrap_or(&[]);
                match &tags {
                    None => all.to_vec(),
                    Some(tags) => all
                        .iter()
                        .filter(|item| {
                            let item_tags = item.get("data").get("tags");
                            let list = item_tags.as_array().unwrap_or(&[]);
                            tags.iter().all(|t| list.iter().any(|v| v.as_str() == Some(t)))
                        })
                        .cloned()
                        .collect(),
                }
            };
            let make_view: Function = ctx.globals().get::<_, Object>("__ssqch")?.get("view")?;
            let len = items.len() as f64;
            let handle = Class::instance(ctx.clone(), Handle(Value::array(items)))?;
            make_view.call((handle, 0.0, true, len))
        })?,
    )?;

    ctx.globals().get::<_, Object>("__ssqch")?.set("views", views)
}

/// A JavaScript view of a template object or array.
pub(crate) fn view<'js>(ctx: &Ctx<'js>, make_view: &Function<'js>, value: &Value) -> Result<rquickjs::Value<'js>> {
    let handle = Handle(value.clone());
    let identity = handle.identity();
    let (is_array, len) = match value {
        Value::Arr(a) => (true, a.len() as f64),
        _ => (false, 0.0),
    };
    let handle = Class::instance(ctx.clone(), handle)?;
    Ok(make_view.call((handle, identity, is_array, len))?)
}

/// The value behind `v` if it's a view that hasn't been written to.
pub(crate) fn unwrap<'js>(unwrap_view: &Function<'js>, v: &rquickjs::Value<'js>) -> Result<Option<Value>> {
    let handle: rquickjs::Value = unwrap_view.call((v.clone(),))?;
    let Some(obj) = handle.as_object() else { return Ok(None) };
    Ok(Class::<Handle>::from_object(obj).map(|h| h.borrow().0.clone()))
}
