//! Evaluates parsed expressions with JavaScript semantics.

use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use chrono::{Datelike, SecondsFormat, TimeZone, Timelike, Utc};

use crate::expr::{BinOp, Expr, Item, Link, LogicOp, Prop, PropKey, TplPart, UnOp};
use crate::value::{js_number, Map, Value};

/// Variable lookup: local frames (`@let`, loop variables, arrow params),
/// then the template data, then globals (filters, shortcodes, built-ins).
#[derive(Clone)]
pub struct Scope {
    frames: Vec<Map>,
    data: Arc<Map>,
    globals: Arc<Map>,
}

impl Scope {
    pub fn new(data: Arc<Map>, globals: Arc<Map>) -> Self {
        Scope { frames: vec![Map::new()], data, globals }
    }

    pub fn lookup(&self, name: &str) -> Value {
        for frame in self.frames.iter().rev() {
            if let Some(v) = frame.get(name) {
                return v.clone();
            }
        }
        if let Some(v) = self.data.get(name) {
            return v.clone();
        }
        self.globals.get(name).cloned().unwrap_or_default()
    }

    pub fn push(&mut self) {
        self.frames.push(Map::new());
    }

    pub fn pop(&mut self) {
        if self.frames.len() > 1 {
            self.frames.pop();
        }
    }

    /// `@let`: declare in the innermost frame.
    pub fn declare(&mut self, name: &str, value: Value) {
        self.frames.last_mut().unwrap().insert(name.to_string(), value);
    }

    /// `@assign`: update the nearest existing local, or declare one.
    pub fn assign(&mut self, name: &str, value: Value) {
        for frame in self.frames.iter_mut().rev() {
            if let Some(slot) = frame.get_mut(name) {
                *slot = value;
                return;
            }
        }
        self.declare(name, value);
    }

    pub fn globals(&self) -> &Arc<Map> {
        &self.globals
    }
}

pub fn eval(expr: &Expr, scope: &Scope) -> Result<Value> {
    Ok(match expr {
        Expr::Lit(v) => v.clone(),
        Expr::Ident(name) => scope.lookup(name),
        Expr::Template(parts) => {
            let mut s = String::new();
            for part in parts {
                match part {
                    TplPart::Str(t) => s.push_str(t),
                    TplPart::Expr(e) => s.push_str(&eval(e, scope)?.to_js_string()),
                }
            }
            Value::from(s)
        }
        Expr::Array(items) => Value::array(eval_items(items, scope)?),
        Expr::Object(props) => {
            let mut map = Map::new();
            for prop in props {
                match prop {
                    Prop::Pair(key, value) => {
                        let key = match key {
                            PropKey::Static(k) => k.clone(),
                            PropKey::Computed(e) => eval(e, scope)?.to_js_string(),
                        };
                        map.insert(key, eval(value, scope)?);
                    }
                    Prop::Spread(e) => {
                        if let Value::Obj(o) = eval(e, scope)? {
                            for (k, v) in o.iter() {
                                map.insert(k.clone(), v.clone());
                            }
                        }
                    }
                }
            }
            Value::object(map)
        }
        Expr::Chain { base, links } => eval_chain(base, links, scope)?,
        Expr::New { callee, args } => {
            let args = eval_items(args, scope)?;
            match callee.as_str() {
                "Date" => new_date(&args)?,
                other => bail!("`new {}` is not supported", other),
            }
        }
        Expr::Unary { op, expr } => {
            let v = eval(expr, scope)?;
            match op {
                UnOp::Not => Value::Bool(!v.truthy()),
                UnOp::Neg => Value::Num(-v.to_number()),
                UnOp::Plus => Value::Num(v.to_number()),
                UnOp::TypeOf => Value::str(v.type_of()),
                // Everything is synchronous here; `await` is a no-op.
                UnOp::Await => v,
            }
        }
        Expr::Logical { op, left, right } => {
            let l = eval(left, scope)?;
            match op {
                LogicOp::And => if l.truthy() { eval(right, scope)? } else { l },
                LogicOp::Or => if l.truthy() { l } else { eval(right, scope)? },
                LogicOp::Nullish => if l.is_nullish() { eval(right, scope)? } else { l },
            }
        }
        Expr::Binary { op, left, right } => binary(*op, eval(left, scope)?, eval(right, scope)?),
        Expr::Cond { test, cons, alt } => {
            if eval(test, scope)?.truthy() { eval(cons, scope)? } else { eval(alt, scope)? }
        }
        Expr::Arrow { params, body } => {
            let captured = scope.clone();
            let params = params.clone();
            let body = body.clone();
            Value::func(move |args| {
                let mut s = captured.clone();
                s.push();
                for (i, p) in params.iter().enumerate() {
                    s.declare(p, args.get(i).cloned().unwrap_or_default());
                }
                eval(&body, &s)
            })
        }
    })
}

fn eval_items(items: &[Item], scope: &Scope) -> Result<Vec<Value>> {
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        match item {
            Item::Expr(e) => out.push(eval(e, scope)?),
            Item::Spread(e) => match eval(e, scope)? {
                Value::Arr(a) => out.extend(a.iter().cloned()),
                Value::Str(s) => out.extend(s.chars().map(|c| Value::from(c.to_string()))),
                other => bail!("cannot spread {}", other.type_of()),
            },
        }
    }
    Ok(out)
}

fn describe(expr: &Expr) -> String {
    match expr {
        Expr::Ident(n) => n.clone(),
        Expr::Chain { base, links } => {
            let mut s = describe(base);
            for l in links {
                match l {
                    Link::Prop { name, .. } => {
                        s.push('.');
                        s.push_str(name);
                    }
                    Link::Index { .. } => s.push_str("[…]"),
                    Link::Call { .. } => s.push_str("()"),
                }
            }
            s
        }
        _ => "expression".into(),
    }
}

fn eval_chain(base: &Expr, links: &[Link], scope: &Scope) -> Result<Value> {
    let mut cur = eval(base, scope)?;
    let mut path = describe(base);
    let mut i = 0;
    while i < links.len() {
        match &links[i] {
            Link::Prop { name, optional } => {
                if cur.is_nullish() {
                    if *optional {
                        return Ok(Value::Undefined);
                    }
                    bail!("Cannot read properties of {} (reading '{}') in `{}`", cur.to_js_string(), name, path);
                }
                if let Some(Link::Call { args, optional: call_optional }) = links.get(i + 1) {
                    let args = eval_items(args, scope)?;
                    cur = match call_method(&cur, name, &args)? {
                        Some(v) => v,
                        None if *call_optional => Value::Undefined,
                        None => bail!("`{}.{}` is not a function", path, name),
                    };
                    path = format!("{}.{}()", path, name);
                    i += 2;
                    continue;
                }
                cur = cur.get(name);
                path = format!("{}.{}", path, name);
            }
            Link::Index { expr, optional } => {
                if cur.is_nullish() {
                    if *optional {
                        return Ok(Value::Undefined);
                    }
                    bail!("Cannot read properties of {} in `{}[…]`", cur.to_js_string(), path);
                }
                let key = eval(expr, scope)?;
                cur = match (&cur, &key) {
                    (Value::Arr(a), Value::Num(n)) => a.get(*n as usize).cloned().unwrap_or_default(),
                    _ => cur.get(&key.to_js_string()),
                };
                path.push_str("[…]");
            }
            Link::Call { args, optional } => {
                if cur.is_nullish() && *optional {
                    return Ok(Value::Undefined);
                }
                let args = eval_items(args, scope)?;
                cur = match &cur {
                    Value::Func(f) => f.call(&args).map_err(|e| anyhow!("{}(): {:#}", path, e))?,
                    _ => bail!("`{}` is not a function", path),
                };
                path.push_str("()");
            }
        }
        i += 1;
    }
    Ok(cur)
}

pub fn binary(op: BinOp, l: Value, r: Value) -> Value {
    use BinOp::*;
    match op {
        Add => {
            let prim = |v: &Value| matches!(v, Value::Str(_) | Value::Arr(_) | Value::Obj(_) | Value::Date(_));
            if prim(&l) || prim(&r) {
                Value::from(l.to_js_string() + &r.to_js_string())
            } else {
                Value::Num(l.to_number() + r.to_number())
            }
        }
        Sub => Value::Num(l.to_number() - r.to_number()),
        Mul => Value::Num(l.to_number() * r.to_number()),
        Div => Value::Num(l.to_number() / r.to_number()),
        Rem => Value::Num(l.to_number() % r.to_number()),
        StrictEq => Value::Bool(l.strict_eq(&r)),
        StrictNe => Value::Bool(!l.strict_eq(&r)),
        Eq => Value::Bool(l.loose_eq(&r)),
        Ne => Value::Bool(!l.loose_eq(&r)),
        Lt | Gt | Le | Ge => {
            let ord = match (&l, &r) {
                (Value::Str(a), Value::Str(b)) => Some(a.cmp(b)),
                _ => l.to_number().partial_cmp(&r.to_number()),
            };
            Value::Bool(match ord {
                None => false,
                Some(o) => match op {
                    Lt => o.is_lt(),
                    Gt => o.is_gt(),
                    Le => o.is_le(),
                    _ => o.is_ge(),
                },
            })
        }
    }
}

pub fn call_value(f: &Value, args: &[Value]) -> Result<Value> {
    match f {
        Value::Func(f) => f.call(args),
        other => bail!("{} is not a function", other.type_of()),
    }
}

fn new_date(args: &[Value]) -> Result<Value> {
    Ok(match args {
        [] => Value::Date(Utc::now()),
        [one] => one.to_date().map(Value::Date).unwrap_or(Value::Null),
        [y, m, rest @ ..] => {
            let d = rest.first().map(|v| v.to_number()).unwrap_or(1.0);
            Utc.with_ymd_and_hms(y.to_number() as i32, m.to_number() as u32 + 1, d as u32, 0, 0, 0)
                .single()
                .map(Value::Date)
                .unwrap_or(Value::Null)
        }
    })
}

// ------------------------------------------------------------ built-in methods

fn num_arg(args: &[Value], i: usize) -> Option<f64> {
    args.get(i).filter(|v| !v.is_nullish()).map(Value::to_number)
}

/// Resolve JS-style relative indices (negative counts from the end).
fn rel_index(i: f64, len: usize) -> usize {
    let len = len as f64;
    let i = if i.is_nan() { 0.0 } else { i.trunc() };
    (if i < 0.0 { (len + i).max(0.0) } else { i.min(len) }) as usize
}

/// Returns `Ok(None)` when the method does not exist on the receiver.
pub fn call_method(recv: &Value, name: &str, args: &[Value]) -> Result<Option<Value>> {
    if let Value::Obj(o) = recv {
        if let Some(v) = o.get(name) {
            return call_value(v, args).map(Some);
        }
        if name == "hasOwnProperty" {
            return Ok(Some(Value::Bool(o.contains_key(&args.first().map(|a| a.to_js_string()).unwrap_or_default()))));
        }
    }
    if name == "toString" && !matches!(recv, Value::Num(_)) {
        return Ok(Some(Value::from(recv.to_js_string())));
    }
    match recv {
        Value::Str(s) => string_method(s, name, args),
        Value::Arr(a) => array_method(a, name, args),
        Value::Num(n) => number_method(*n, name, args),
        Value::Date(d) => date_method(*d, name, args),
        _ => Ok(None),
    }
}

fn string_method(s: &str, name: &str, args: &[Value]) -> Result<Option<Value>> {
    let arg_s = |i: usize| args.get(i).map(|v| v.to_js_string()).unwrap_or_else(|| "undefined".into());
    let chars: Vec<char> = s.chars().collect();
    let substr = |a: usize, b: usize| -> String { chars[a.min(b)..b.max(a)].iter().collect() };
    Ok(Some(match name {
        "startsWith" => {
            let start = num_arg(args, 1).map(|n| rel_index(n, chars.len())).unwrap_or(0);
            Value::Bool(substr(start, chars.len()).starts_with(&arg_s(0)))
        }
        "endsWith" => Value::Bool(s.ends_with(&arg_s(0))),
        "includes" => Value::Bool(s.contains(&arg_s(0))),
        "indexOf" => Value::Num(s.find(&arg_s(0)).map(|b| s[..b].chars().count() as f64).unwrap_or(-1.0)),
        "lastIndexOf" => Value::Num(s.rfind(&arg_s(0)).map(|b| s[..b].chars().count() as f64).unwrap_or(-1.0)),
        "slice" => {
            let a = num_arg(args, 0).map(|n| rel_index(n, chars.len())).unwrap_or(0);
            let b = num_arg(args, 1).map(|n| rel_index(n, chars.len())).unwrap_or(chars.len());
            Value::from(if a < b { substr(a, b) } else { String::new() })
        }
        "substring" => {
            let clamp = |n: f64| (if n.is_nan() { 0.0 } else { n }).clamp(0.0, chars.len() as f64) as usize;
            let a = num_arg(args, 0).map(clamp).unwrap_or(0);
            let b = num_arg(args, 1).map(clamp).unwrap_or(chars.len());
            Value::from(substr(a, b))
        }
        "toUpperCase" | "toLocaleUpperCase" => Value::from(s.to_uppercase()),
        "toLowerCase" | "toLocaleLowerCase" => Value::from(s.to_lowercase()),
        "trim" => Value::str(s.trim()),
        "trimStart" => Value::str(s.trim_start()),
        "trimEnd" => Value::str(s.trim_end()),
        "split" => {
            let parts: Vec<Value> = match args.first() {
                None | Some(Value::Undefined) => vec![Value::str(s)],
                Some(sep) => {
                    let sep = sep.to_js_string();
                    if sep.is_empty() {
                        chars.iter().map(|c| Value::from(c.to_string())).collect()
                    } else {
                        s.split(sep.as_str()).map(Value::str).collect()
                    }
                }
            };
            let limit = num_arg(args, 1).map(|n| n as usize).unwrap_or(usize::MAX);
            Value::array(parts.into_iter().take(limit).collect())
        }
        "replace" => Value::from(s.replacen(&arg_s(0), &arg_s(1), 1)),
        "replaceAll" => Value::from(s.replace(&arg_s(0), &arg_s(1))),
        "repeat" => Value::from(s.repeat(num_arg(args, 0).unwrap_or(0.0).max(0.0) as usize)),
        "padStart" | "padEnd" => {
            let width = num_arg(args, 0).unwrap_or(0.0) as usize;
            let fill = args.get(1).map(|v| v.to_js_string()).unwrap_or_else(|| " ".into());
            if chars.len() >= width || fill.is_empty() {
                Value::str(s)
            } else {
                let pad: String = fill.chars().cycle().take(width - chars.len()).collect();
                Value::from(if name == "padStart" { pad + s } else { s.to_string() + &pad })
            }
        }
        "charAt" => Value::from(chars.get(num_arg(args, 0).unwrap_or(0.0) as usize).map(|c| c.to_string()).unwrap_or_default()),
        "at" => {
            let i = num_arg(args, 0).unwrap_or(0.0);
            let idx = if i < 0.0 { chars.len() as f64 + i } else { i };
            if idx < 0.0 { Value::Undefined } else { chars.get(idx as usize).map(|c| Value::from(c.to_string())).unwrap_or_default() }
        }
        "concat" => Value::from(args.iter().fold(s.to_string(), |acc, a| acc + &a.to_js_string())),
        "localeCompare" => Value::Num(match s.cmp(&arg_s(0)) {
            std::cmp::Ordering::Less => -1.0,
            std::cmp::Ordering::Equal => 0.0,
            std::cmp::Ordering::Greater => 1.0,
        }),
        _ => return Ok(None),
    }))
}

fn array_method(a: &Arc<Vec<Value>>, name: &str, args: &[Value]) -> Result<Option<Value>> {
    let f = || args.first().cloned().unwrap_or_default();
    let call = |item: &Value, i: usize| call_value(&f(), &[item.clone(), Value::from(i), Value::Arr(a.clone())]);
    Ok(Some(match name {
        "slice" => {
            let start = num_arg(args, 0).map(|n| rel_index(n, a.len())).unwrap_or(0);
            let end = num_arg(args, 1).map(|n| rel_index(n, a.len())).unwrap_or(a.len());
            Value::array(if start < end { a[start..end].to_vec() } else { Vec::new() })
        }
        // Arrays are immutable here: reverse/sort return copies.
        "reverse" | "toReversed" => Value::array(a.iter().rev().cloned().collect()),
        "includes" => {
            let needle = args.first().cloned().unwrap_or_default();
            Value::Bool(a.iter().any(|v| v.strict_eq(&needle)))
        }
        "indexOf" => {
            let needle = args.first().cloned().unwrap_or_default();
            Value::Num(a.iter().position(|v| v.strict_eq(&needle)).map(|i| i as f64).unwrap_or(-1.0))
        }
        "join" => {
            let sep = match args.first() {
                None | Some(Value::Undefined) => ",".to_string(),
                Some(v) => v.to_js_string(),
            };
            Value::from(a.iter().map(Value::to_output).collect::<Vec<_>>().join(&sep))
        }
        "map" => Value::array(a.iter().enumerate().map(|(i, v)| call(v, i)).collect::<Result<_>>()?),
        "filter" => {
            let mut out = Vec::new();
            for (i, v) in a.iter().enumerate() {
                if call(v, i)?.truthy() {
                    out.push(v.clone());
                }
            }
            Value::array(out)
        }
        "find" | "findIndex" => {
            for (i, v) in a.iter().enumerate() {
                if call(v, i)?.truthy() {
                    return Ok(Some(if name == "find" { v.clone() } else { Value::from(i) }));
                }
            }
            if name == "find" { Value::Undefined } else { Value::Num(-1.0) }
        }
        "some" => {
            for (i, v) in a.iter().enumerate() {
                if call(v, i)?.truthy() {
                    return Ok(Some(Value::Bool(true)));
                }
            }
            Value::Bool(false)
        }
        "every" => {
            for (i, v) in a.iter().enumerate() {
                if !call(v, i)?.truthy() {
                    return Ok(Some(Value::Bool(false)));
                }
            }
            Value::Bool(true)
        }
        "forEach" => {
            for (i, v) in a.iter().enumerate() {
                call(v, i)?;
            }
            Value::Undefined
        }
        "reduce" => {
            let mut iter = a.iter().enumerate();
            let mut acc = match args.get(1) {
                Some(init) => init.clone(),
                None => iter.next().map(|(_, v)| v.clone()).ok_or_else(|| anyhow!("reduce of empty array with no initial value"))?,
            };
            for (i, v) in iter {
                acc = call_value(&f(), &[acc, v.clone(), Value::from(i)])?;
            }
            acc
        }
        "concat" => {
            let mut out = a.to_vec();
            for arg in args {
                match arg {
                    Value::Arr(b) => out.extend(b.iter().cloned()),
                    other => out.push(other.clone()),
                }
            }
            Value::array(out)
        }
        "at" => {
            let i = num_arg(args, 0).unwrap_or(0.0);
            let idx = if i < 0.0 { a.len() as f64 + i } else { i };
            if idx < 0.0 { Value::Undefined } else { a.get(idx as usize).cloned().unwrap_or_default() }
        }
        "flat" => {
            let mut out = Vec::new();
            for v in a.iter() {
                match v {
                    Value::Arr(inner) => out.extend(inner.iter().cloned()),
                    other => out.push(other.clone()),
                }
            }
            Value::array(out)
        }
        "sort" | "toSorted" => {
            let mut items = a.to_vec();
            let mut err = None;
            match args.first() {
                Some(cmp @ Value::Func(_)) => items.sort_by(|x, y| {
                    match call_value(cmp, &[x.clone(), y.clone()]) {
                        Ok(v) => v.to_number().partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal),
                        Err(e) => {
                            err.get_or_insert(e);
                            std::cmp::Ordering::Equal
                        }
                    }
                }),
                _ => items.sort_by_key(|v| v.to_js_string()),
            }
            if let Some(e) = err {
                return Err(e);
            }
            Value::array(items)
        }
        _ => return Ok(None),
    }))
}

fn number_method(n: f64, name: &str, args: &[Value]) -> Result<Option<Value>> {
    Ok(Some(match name {
        "toFixed" => Value::from(format!("{:.*}", num_arg(args, 0).unwrap_or(0.0) as usize, n)),
        "toString" => Value::from(js_number(n)),
        "toLocaleString" => {
            let s = format!("{:.0}", n.trunc().abs());
            let mut out = String::new();
            for (i, c) in s.chars().enumerate() {
                if i > 0 && (s.len() - i) % 3 == 0 {
                    out.push(',');
                }
                out.push(c);
            }
            Value::from(if n < 0.0 { format!("-{}", out) } else { out })
        }
        _ => return Ok(None),
    }))
}

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

/// Dates are always interpreted in UTC so builds are reproducible no matter
/// which machine (or time zone) runs them.
fn date_method(d: chrono::DateTime<Utc>, name: &str, args: &[Value]) -> Result<Option<Value>> {
    Ok(Some(match name {
        "getFullYear" | "getUTCFullYear" => Value::from(d.year()),
        "getMonth" | "getUTCMonth" => Value::from(d.month0()),
        "getDate" | "getUTCDate" => Value::from(d.day()),
        "getDay" | "getUTCDay" => Value::from(d.weekday().num_days_from_sunday()),
        "getHours" | "getUTCHours" => Value::from(d.hour()),
        "getMinutes" | "getUTCMinutes" => Value::from(d.minute()),
        "getSeconds" | "getUTCSeconds" => Value::from(d.second()),
        "getTime" | "valueOf" => Value::from(d.timestamp_millis()),
        "toISOString" | "toJSON" => Value::from(d.to_rfc3339_opts(SecondsFormat::Millis, true)),
        "toUTCString" => Value::from(d.format("%a, %d %b %Y %H:%M:%S GMT").to_string()),
        "toDateString" => Value::from(d.format("%a %b %d %Y").to_string()),
        "toLocaleDateString" => {
            let opts = args.get(1).cloned().unwrap_or_default();
            let month = opts.get("month");
            let month_name = MONTHS[d.month0() as usize];
            Value::from(match month.as_str() {
                Some("long") => format!("{} {}, {}", month_name, d.day(), d.year()),
                Some("short") => format!("{} {}, {}", &month_name[..3], d.day(), d.year()),
                _ => format!("{}/{}/{}", d.month(), d.day(), d.year()),
            })
        }
        _ => return Ok(None),
    }))
}
