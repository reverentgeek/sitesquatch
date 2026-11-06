//! `sitesquatch-edge` — an [Edge.js](https://edgejs.dev)-compatible template engine.
//!
//! ```
//! use sitesquatch_edge::{Engine, MemoryLoader, Value};
//!
//! let engine = Engine::new(MemoryLoader::default());
//! let html = engine
//!     .render_str("demo", "Hello {{ name.toUpperCase() }}!", Value::from_pairs([("name", Value::from("edge"))]))
//!     .unwrap();
//! assert_eq!(html, "Hello EDGE!");
//! ```

pub mod eval;
pub mod expr;
pub mod template;
pub mod value;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Context, Result};

pub use template::{escape_html, Template};
pub use value::{Args, Func, Map, Value};

use eval::{call_value, Scope};

/// Resolves template names used by `@include` / `@component`.
pub trait Loader: Send + Sync {
    /// Return `(canonical_name, source)` for a template name.
    fn load(&self, name: &str) -> Result<(String, String)>;
}

/// Loads `name` (or `name.edge`) from a directory. Front matter blocks at the
/// top of a file are skipped, so layouts with front matter can be included.
pub struct FsLoader {
    pub root: PathBuf,
}

impl Loader for FsLoader {
    fn load(&self, name: &str) -> Result<(String, String)> {
        let rel = if name.ends_with(".edge") { name.to_string() } else { format!("{}.edge", name) };
        let path = self.root.join(&rel);
        let src = std::fs::read_to_string(&path).with_context(|| format!("template not found: {}", path.display()))?;
        Ok((rel, strip_front_matter(&src).to_string()))
    }
}

/// In-memory templates, handy for tests.
#[derive(Default)]
pub struct MemoryLoader(pub HashMap<String, String>);

impl Loader for MemoryLoader {
    fn load(&self, name: &str) -> Result<(String, String)> {
        let key = name.trim_end_matches(".edge");
        self.0.get(key).map(|s| (key.to_string(), s.clone())).ok_or_else(|| anyhow!("template not found: {}", name))
    }
}

pub fn strip_front_matter(src: &str) -> &str {
    if let Some(rest) = src.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let after = &rest[end + 4..];
            return after.strip_prefix("\r\n").or_else(|| after.strip_prefix('\n')).unwrap_or(after);
        }
    }
    src
}

pub struct Engine {
    loader: Box<dyn Loader>,
    globals: Arc<Map>,
    cache: RwLock<HashMap<String, Arc<Template>>>,
}

impl Engine {
    pub fn new(loader: impl Loader + 'static) -> Self {
        Engine { loader: Box::new(loader), globals: Arc::new(builtin_globals()), cache: RwLock::new(HashMap::new()) }
    }

    /// Register a global (filter, shortcode, helper or constant) visible to
    /// every template, including isolated component scopes.
    pub fn add_global(&mut self, name: impl Into<String>, value: Value) -> &mut Self {
        Arc::make_mut(&mut self.globals).insert(name.into(), value);
        self
    }

    pub fn compile(&self, name: &str, src: &str) -> Result<Template> {
        template::parse(name, src)
    }

    /// Load (and cache) a named template through the loader.
    pub fn template(&self, name: &str) -> Result<Arc<Template>> {
        let key = name.trim_end_matches(".edge");
        if let Some(t) = self.cache.read().unwrap().get(key) {
            return Ok(t.clone());
        }
        let (canonical, src) = self.loader.load(name)?;
        let tpl = Arc::new(self.compile(&canonical, &src)?);
        self.cache.write().unwrap().insert(key.to_string(), tpl.clone());
        Ok(tpl)
    }

    pub fn clear_cache(&self) {
        self.cache.write().unwrap().clear();
    }

    pub fn render(&self, tpl: &Template, data: Value) -> Result<String> {
        let data = match data {
            Value::Obj(o) => o,
            Value::Undefined | Value::Null => Arc::new(Map::new()),
            other => return Err(anyhow!("template data must be an object, got {}", other.type_of())),
        };
        let mut scope = Scope::new(data, self.globals.clone());
        let mut out = String::new();
        template::render_nodes(self, &tpl.name, &tpl.nodes, &mut scope, &mut out, 0)?;
        // Like Edge.js, trim one newline from the start and end of the output.
        let out = out.strip_prefix("\r\n").or_else(|| out.strip_prefix('\n')).unwrap_or(&out);
        let out = out.strip_suffix("\r\n").or_else(|| out.strip_suffix('\n')).unwrap_or(out);
        Ok(out.to_string())
    }

    pub fn render_str(&self, name: &str, src: &str, data: Value) -> Result<String> {
        let tpl = self.compile(name, src)?;
        self.render(&tpl, data)
    }

    pub fn render_named(&self, name: &str, data: Value) -> Result<String> {
        let tpl = self.template(name)?;
        self.render(&tpl, data)
    }

    /// Evaluate a single expression against `data`.
    pub fn eval_expr(&self, src: &str, data: Value) -> Result<Value> {
        let expr = expr::parse_complete(src)?;
        let scope = Scope::new(data.as_object().cloned().map(Arc::new).unwrap_or_default(), self.globals.clone());
        eval::eval(&expr, &scope)
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    Value::from_pairs(pairs)
}

fn stringify(args: &[Value]) -> Result<Value> {
    let json = args.arg(0).to_json();
    let indent = match args.arg(2) {
        Value::Num(n) => " ".repeat(n as usize),
        Value::Str(s) => s.to_string(),
        _ => String::new(),
    };
    if indent.is_empty() {
        return Ok(Value::from(serde_json::to_string(&json)?));
    }
    let mut buf = Vec::new();
    let fmt = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, fmt);
    serde::Serialize::serialize(&json, &mut ser)?;
    Ok(Value::from(String::from_utf8(buf)?))
}

/// JavaScript-flavoured globals available to every template.
fn builtin_globals() -> Map {
    let mut g = Map::new();
    let math = |f: fn(f64) -> f64| Value::func(move |a| Ok(Value::Num(f(a.arg(0).to_number()))));
    g.insert(
        "JSON".into(),
        obj(vec![
            ("stringify", Value::func(stringify)),
            ("parse", Value::func(|a| Ok(Value::from(serde_json::from_str::<serde_json::Value>(&a.arg_string(0))?)))),
        ]),
    );
    g.insert(
        "Object".into(),
        obj(vec![
            ("keys", Value::func(|a| Ok(Value::array(a.arg(0).as_object().map(|o| o.keys().map(Value::str).collect()).unwrap_or_default())))),
            ("values", Value::func(|a| Ok(Value::array(a.arg(0).as_object().map(|o| o.values().cloned().collect()).unwrap_or_default())))),
            (
                "entries",
                Value::func(|a| {
                    Ok(Value::array(
                        a.arg(0)
                            .as_object()
                            .map(|o| o.iter().map(|(k, v)| Value::array(vec![Value::str(k), v.clone()])).collect())
                            .unwrap_or_default(),
                    ))
                }),
            ),
            (
                "assign",
                Value::func(|a| {
                    let mut m = Map::new();
                    for v in a {
                        if let Some(o) = v.as_object() {
                            m.extend(o.iter().map(|(k, v)| (k.clone(), v.clone())));
                        }
                    }
                    Ok(Value::object(m))
                }),
            ),
        ]),
    );
    g.insert(
        "Math".into(),
        obj(vec![
            ("floor", math(f64::floor)),
            ("ceil", math(f64::ceil)),
            ("round", math(|n| (n + 0.5).floor())),
            ("abs", math(f64::abs)),
            ("sqrt", math(f64::sqrt)),
            ("trunc", math(f64::trunc)),
            ("max", Value::func(|a| Ok(Value::Num(a.iter().map(Value::to_number).fold(f64::NEG_INFINITY, f64::max))))),
            ("min", Value::func(|a| Ok(Value::Num(a.iter().map(Value::to_number).fold(f64::INFINITY, f64::min))))),
            ("PI", Value::Num(std::f64::consts::PI)),
        ]),
    );
    g.insert(
        "Array".into(),
        obj(vec![
            ("isArray", Value::func(|a| Ok(Value::Bool(matches!(a.arg(0), Value::Arr(_)))))),
            (
                "from",
                Value::func(|a| {
                    Ok(match a.arg(0) {
                        Value::Arr(arr) => Value::Arr(arr),
                        Value::Str(s) => Value::array(s.chars().map(|c| Value::from(c.to_string())).collect()),
                        Value::Obj(o) => {
                            let len = o.get("length").map(Value::to_number).unwrap_or(0.0) as usize;
                            let map_fn = a.arg(1);
                            let mut out = Vec::with_capacity(len);
                            for i in 0..len {
                                out.push(if map_fn.is_nullish() { Value::Undefined } else { call_value(&map_fn, &[Value::Undefined, Value::from(i)])? });
                            }
                            Value::array(out)
                        }
                        _ => Value::array(Vec::new()),
                    })
                }),
            ),
        ]),
    );
    g.insert("Date".into(), obj(vec![("now", Value::func(|_| Ok(Value::from(chrono::Utc::now().timestamp_millis()))))]));
    g.insert("Number".into(), Value::func(|a| Ok(Value::Num(a.arg(0).to_number()))));
    g.insert("String".into(), Value::func(|a| Ok(Value::from(a.first().map(Value::to_js_string).unwrap_or_default()))));
    g.insert("Boolean".into(), Value::func(|a| Ok(Value::Bool(a.arg(0).truthy()))));
    g.insert("isNaN".into(), Value::func(|a| Ok(Value::Bool(a.arg(0).to_number().is_nan()))));
    g.insert(
        "parseInt".into(),
        Value::func(|a| {
            let s = a.arg_string(0);
            let t = s.trim();
            let end = t.char_indices().find(|&(i, c)| !(c.is_ascii_digit() || (i == 0 && (c == '-' || c == '+')))).map(|(i, _)| i).unwrap_or(t.len());
            Ok(Value::Num(t[..end].parse::<f64>().unwrap_or(f64::NAN)))
        }),
    );
    g.insert("parseFloat".into(), Value::func(|a| Ok(Value::Num(a.arg_string(0).trim().parse().unwrap_or(f64::NAN)))));
    g.insert("encodeURIComponent".into(), Value::func(|a| Ok(Value::from(encode_uri_component(&a.arg_string(0))))));
    // Edge.js helpers
    g.insert("stringify".into(), Value::func(stringify));
    g.insert("safe".into(), Value::func(|a| Ok(a.arg(0))));
    g.insert("escape".into(), Value::func(|a| Ok(Value::from(escape_html(&a.arg_string(0))))));
    g.insert(
        "truncate".into(),
        Value::func(|a| {
            let s = a.arg_string(0);
            let n = a.arg(1).to_number() as usize;
            Ok(Value::from(if s.chars().count() > n { s.chars().take(n).collect::<String>() + "..." } else { s }))
        }),
    );
    g
}

fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}
