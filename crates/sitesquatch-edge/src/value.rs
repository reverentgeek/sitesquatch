//! A dynamically typed value with JavaScript-like semantics.
//!
//! Templates written for Edge.js expect JavaScript behaviour (truthiness,
//! `+` concatenation, strict equality...). `Value` models just enough of that.
//! Compound values are reference counted so page data can be shared cheaply
//! across threads while rendering in parallel.

use std::fmt;
use std::sync::Arc;

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use indexmap::IndexMap;

pub type Map = IndexMap<String, Value>;

/// Signature of every native function callable from a template
/// (filters, shortcodes, globals, closures).
pub type NativeFn = dyn Fn(&[Value]) -> anyhow::Result<Value> + Send + Sync;

#[derive(Clone)]
pub struct Func(pub Arc<NativeFn>);

impl Func {
    pub fn new<F>(f: F) -> Self
    where
        F: Fn(&[Value]) -> anyhow::Result<Value> + Send + Sync + 'static,
    {
        Func(Arc::new(f))
    }

    pub fn call(&self, args: &[Value]) -> anyhow::Result<Value> {
        (self.0)(args)
    }
}

#[derive(Clone, Default)]
pub enum Value {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(Arc<str>),
    Arr(Arc<Vec<Value>>),
    Obj(Arc<Map>),
    Func(Func),
    Date(DateTime<Utc>),
}

impl Value {
    pub fn str(s: impl AsRef<str>) -> Value {
        Value::Str(Arc::from(s.as_ref()))
    }

    pub fn array(items: Vec<Value>) -> Value {
        Value::Arr(Arc::new(items))
    }

    pub fn object(map: Map) -> Value {
        Value::Obj(Arc::new(map))
    }

    /// Build an object from `(key, value)` pairs.
    pub fn from_pairs<K: Into<String>, I: IntoIterator<Item = (K, Value)>>(pairs: I) -> Value {
        Value::object(pairs.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }

    pub fn func<F>(f: F) -> Value
    where
        F: Fn(&[Value]) -> anyhow::Result<Value> + Send + Sync + 'static,
    {
        Value::Func(Func::new(f))
    }

    pub fn is_nullish(&self) -> bool {
        matches!(self, Value::Undefined | Value::Null)
    }

    pub fn truthy(&self) -> bool {
        match self {
            Value::Undefined | Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0 && !n.is_nan(),
            Value::Str(s) => !s.is_empty(),
            _ => true,
        }
    }

    pub fn type_of(&self) -> &'static str {
        match self {
            Value::Undefined => "undefined",
            Value::Null | Value::Arr(_) | Value::Obj(_) | Value::Date(_) => "object",
            Value::Bool(_) => "boolean",
            Value::Num(_) => "number",
            Value::Str(_) => "string",
            Value::Func(_) => "function",
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Value::Arr(a) => Some(a),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&Map> {
        match self {
            Value::Obj(o) => Some(o),
            _ => None,
        }
    }

    /// Property lookup with JavaScript semantics for the common cases.
    pub fn get(&self, key: &str) -> Value {
        match self {
            Value::Obj(o) => o.get(key).cloned().unwrap_or_default(),
            Value::Arr(a) => {
                if key == "length" {
                    Value::Num(a.len() as f64)
                } else {
                    key.parse::<usize>().ok().and_then(|i| a.get(i).cloned()).unwrap_or_default()
                }
            }
            Value::Str(s) => {
                if key == "length" {
                    Value::Num(s.encode_utf16().count() as f64)
                } else {
                    key.parse::<usize>()
                        .ok()
                        .and_then(|i| s.chars().nth(i))
                        .map(|c| Value::str(c.to_string()))
                        .unwrap_or_default()
                }
            }
            _ => Value::Undefined,
        }
    }

    /// Follow a dotted path such as `collections.posts`.
    pub fn get_path(&self, path: &str) -> Value {
        path.split('.').fold(self.clone(), |v, key| v.get(key))
    }

    /// JavaScript `String(value)`.
    pub fn to_js_string(&self) -> String {
        match self {
            Value::Undefined => "undefined".into(),
            Value::Null => "null".into(),
            Value::Bool(b) => b.to_string(),
            Value::Num(n) => js_number(*n),
            Value::Str(s) => s.to_string(),
            Value::Arr(a) => a
                .iter()
                .map(|v| if v.is_nullish() { String::new() } else { v.to_js_string() })
                .collect::<Vec<_>>()
                .join(","),
            Value::Obj(_) => "[object Object]".into(),
            Value::Func(_) => "function () { [native code] }".into(),
            Value::Date(d) => d.to_rfc3339_opts(SecondsFormat::Millis, true),
        }
    }

    /// How a value prints inside `{{ }}`: like `String()`, but nullish values
    /// render as nothing rather than the words "undefined"/"null".
    pub fn to_output(&self) -> String {
        if self.is_nullish() {
            String::new()
        } else {
            self.to_js_string()
        }
    }

    /// JavaScript `Number(value)`.
    pub fn to_number(&self) -> f64 {
        match self {
            Value::Undefined => f64::NAN,
            Value::Null => 0.0,
            Value::Bool(b) => *b as u8 as f64,
            Value::Num(n) => *n,
            Value::Str(s) => {
                let t = s.trim();
                if t.is_empty() {
                    0.0
                } else {
                    t.parse().unwrap_or(f64::NAN)
                }
            }
            Value::Date(d) => d.timestamp_millis() as f64,
            Value::Arr(a) if a.is_empty() => 0.0,
            Value::Arr(a) if a.len() == 1 => a[0].to_number(),
            _ => f64::NAN,
        }
    }

    /// Interpret a value as a date: dates pass through, strings are parsed
    /// (ISO 8601, `YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`), numbers are epoch ms.
    pub fn to_date(&self) -> Option<DateTime<Utc>> {
        match self {
            Value::Date(d) => Some(*d),
            Value::Num(n) => Utc.timestamp_millis_opt(*n as i64).single(),
            Value::Str(s) => parse_date(s),
            _ => None,
        }
    }

    pub fn strict_eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Undefined, Value::Undefined) | (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Num(a), Value::Num(b)) => a == b,
            (Value::Str(a), Value::Str(b)) => a == b,
            (Value::Arr(a), Value::Arr(b)) => Arc::ptr_eq(a, b),
            (Value::Obj(a), Value::Obj(b)) => Arc::ptr_eq(a, b),
            (Value::Func(a), Value::Func(b)) => Arc::ptr_eq(&a.0, &b.0),
            (Value::Date(a), Value::Date(b)) => a == b,
            _ => false,
        }
    }

    pub fn loose_eq(&self, other: &Value) -> bool {
        match (self, other) {
            (a, b) if a.is_nullish() && b.is_nullish() => true,
            (a, b) if a.is_nullish() || b.is_nullish() => false,
            (Value::Num(_), Value::Str(_))
            | (Value::Str(_), Value::Num(_))
            | (Value::Bool(_), _)
            | (_, Value::Bool(_)) => self.to_number() == other.to_number(),
            _ => self.strict_eq(other),
        }
    }

    /// Convert to JSON (used by `JSON.stringify` and by plugins).
    pub fn to_json(&self) -> serde_json::Value {
        use serde_json::Value as J;
        match self {
            Value::Undefined | Value::Func(_) | Value::Null => J::Null,
            Value::Bool(b) => J::Bool(*b),
            Value::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 9.0e15 {
                    J::from(*n as i64)
                } else {
                    serde_json::Number::from_f64(*n).map(J::Number).unwrap_or(J::Null)
                }
            }
            Value::Str(s) => J::String(s.to_string()),
            Value::Arr(a) => J::Array(a.iter().map(Value::to_json).collect()),
            Value::Obj(o) => J::Object(
                o.iter()
                    .filter(|(_, v)| !matches!(v, Value::Undefined | Value::Func(_)))
                    .map(|(k, v)| (k.clone(), v.to_json()))
                    .collect(),
            ),
            Value::Date(d) => J::String(d.to_rfc3339_opts(SecondsFormat::Millis, true)),
        }
    }
}

/// Format a number the way JavaScript's `String(n)` does for typical values.
pub fn js_number(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{:.0}", n)
    } else {
        format!("{}", n)
    }
}

pub fn parse_date(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&Utc));
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0)?));
    }
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(d) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(Utc.from_utc_datetime(&d));
        }
    }
    None
}

impl fmt::Debug for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Undefined => write!(f, "undefined"),
            Value::Func(_) => write!(f, "[Function]"),
            Value::Date(d) => write!(f, "Date({})", d.to_rfc3339()),
            other => write!(f, "{}", other.to_json()),
        }
    }
}

impl From<serde_json::Value> for Value {
    fn from(v: serde_json::Value) -> Self {
        use serde_json::Value as J;
        match v {
            J::Null => Value::Null,
            J::Bool(b) => Value::Bool(b),
            J::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
            J::String(s) => Value::str(s),
            J::Array(a) => Value::array(a.into_iter().map(Value::from).collect()),
            J::Object(o) => Value::object(o.into_iter().map(|(k, v)| (k, Value::from(v))).collect()),
        }
    }
}

macro_rules! from_num {
    ($($t:ty),*) => {$(
        impl From<$t> for Value {
            fn from(n: $t) -> Self { Value::Num(n as f64) }
        }
    )*};
}
from_num!(f64, f32, i32, i64, u32, u64, usize);

impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}
impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::str(s)
    }
}
impl From<String> for Value {
    fn from(s: String) -> Self {
        Value::Str(Arc::from(s))
    }
}
impl From<Vec<Value>> for Value {
    fn from(v: Vec<Value>) -> Self {
        Value::array(v)
    }
}
impl From<Map> for Value {
    fn from(m: Map) -> Self {
        Value::object(m)
    }
}
impl From<DateTime<Utc>> for Value {
    fn from(d: DateTime<Utc>) -> Self {
        Value::Date(d)
    }
}
impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(o: Option<T>) -> Self {
        o.map(Into::into).unwrap_or(Value::Null)
    }
}

/// Convenience accessors for filter arguments.
pub trait Args {
    fn arg(&self, i: usize) -> Value;
    fn arg_string(&self, i: usize) -> String;
}

impl Args for [Value] {
    fn arg(&self, i: usize) -> Value {
        self.get(i).cloned().unwrap_or_default()
    }
    fn arg_string(&self, i: usize) -> String {
        self.get(i).map(Value::to_output).unwrap_or_default()
    }
}
