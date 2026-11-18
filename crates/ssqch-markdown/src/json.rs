//! Values between Node and the wasm, as JSON text.
//!
//! Out to Node (a hook's `heading`, a function's arguments) they're [`Value::to_json`], which
//! leaves out an object's undefined fields, so `heading.id` is undefined in a template, as in
//! 0.7. Back from Node (what a site's function returned) JSON loses what 0.7's errors name
//! (`returned undefined, not a list of tokens`), so Node writes those as an object with a `"\0"`
//! key, which no JSON a site writes has: `{"\0":"undefined"}`, `{"\0":"function"}`,
//! `{"\0":"NaN"}`, `{"\0":"Infinity"}`, `{"\0":"-Infinity"}` and `{"\0":"date","v":"<ISO 8601>"}`.

use anyhow::{Context, Result};
use serde_json::Value as J;

use crate::Value;

/// A value as JSON text for Node.
pub fn to_text(value: &Value) -> String {
    value.to_json().to_string()
}

/// A value from Node's JSON text.
pub fn from_text(text: &str) -> Result<Value> {
    let parsed: J = serde_json::from_str(text).context("ssqch's Markdown got a value it can't read")?;
    Ok(from_json(parsed))
}

fn from_json(j: J) -> Value {
    match j {
        J::Null => Value::Null,
        J::Bool(b) => Value::Bool(b),
        J::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
        J::String(s) => Value::from(s),
        J::Array(items) => Value::array(items.into_iter().map(from_json).collect()),
        J::Object(o) => match o.get("\0").and_then(J::as_str) {
            Some("undefined") => Value::Undefined,
            // Only its type matters to the code that gets it; it can't be called from here.
            Some("function") => Value::func(|_| Ok(Value::Undefined)),
            Some("NaN") => Value::Num(f64::NAN),
            Some("Infinity") => Value::Num(f64::INFINITY),
            Some("-Infinity") => Value::Num(f64::NEG_INFINITY),
            Some("date") => o.get("v").and_then(J::as_str).and_then(crate::value::parse_date).map(Value::Date).unwrap_or(Value::Null),
            _ => Value::object(o.into_iter().map(|(k, v)| (k, from_json(v))).collect()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_keep_what_json_loses() {
        let v = from_text(r#"[{"\u0000":"undefined"},{"\u0000":"function"},{"\u0000":"NaN"},{"\u0000":"-Infinity"},{"text":"x","kind":{"\u0000":"undefined"}},1.5,"s",null]"#).unwrap();
        let types: Vec<&str> = v.as_array().unwrap().iter().map(Value::type_of).collect();
        assert_eq!(types, ["undefined", "function", "number", "number", "object", "number", "string", "object"]);
        assert_eq!(v.get("2").to_js_string(), "NaN");
        assert_eq!(v.get("3").to_js_string(), "-Infinity");
        assert_eq!(v.get("4").get("kind").type_of(), "undefined");
        let date = from_text(r#"{"\u0000":"date","v":"2024-06-01T00:00:00.000Z"}"#).unwrap();
        assert!(matches!(date, Value::Date(_)));
    }

    #[test]
    fn undefined_fields_stay_out_of_what_node_gets() {
        let heading = Value::from_pairs([("level", Value::Num(2.0)), ("id", Value::Undefined), ("text", Value::from("Hi"))]);
        assert_eq!(to_text(&heading), r#"{"level":2,"text":"Hi"}"#);
    }
}
