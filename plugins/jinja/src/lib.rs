//! Nunjucks and Jinja templates (`.njk`, `.jinja`, `.j2`) for SiteSquatch, on
//! [`minijinja`](https://crates.io/crates/minijinja), which implements Jinja2
//! and covers most of Nunjucks.
//!
//! - Pages and layouts get the same data as Edge templates, without copying:
//!   objects, lists, dates and functions are wrapped as minijinja objects.
//! - Config filters work as filters (`{{ title | slug }}`) and as functions
//!   (`{{ slug(title) }}`), replacing a built-in filter with the same name.
//! - `{% include %}`, `{% extends %}`, `{% import %}` and `{% from %}` read
//!   from the includes folder.
//! - Output is HTML-escaped, as in Nunjucks and Jinja; `| safe` opts out. A
//!   layout's `content` is already safe, so `{{ content }}` works.
//! - Undefined values and their properties print nothing, as in Nunjucks.
//! - `dump` is an alias for `tojson`, and `truncate` works as in Nunjucks.
//! - In `.njk` files, Nunjucks' `{% elseif %}` and `{% for key, value in
//!   object %}` work too (they're rewritten to `elif` and a pairs filter).

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Result};
use minijinja::value::{Enumerator, Object, ObjectRepr, Rest, Value as JValue, ValueKind};
use minijinja::{AutoEscape, Environment, Error, ErrorKind, State, UndefinedBehavior};
use sitesquatch::engines::{EngineEnv, RenderContext, TemplateEngine};
use sitesquatch::{Config, Map, Plugin, Value};

/// The file extensions this plugin registers an engine for.
pub const EXTENSIONS: &[&str] = &["njk", "jinja", "j2"];

/// Registers the `njk`, `jinja` and `j2` engines. Add the extensions you use
/// to `templateFormats`, or use one for Markdown with `markdownEngine`.
#[derive(Default)]
pub struct JinjaPlugin;

impl Plugin for JinjaPlugin {
    fn name(&self) -> &str {
        "jinja"
    }

    fn register(&self, config: &mut Config) {
        for ext in EXTENSIONS {
            let nunjucks = *ext == "njk";
            config.add_template_engine(*ext, move |env| Ok(Arc::new(JinjaEngine::new(env, nunjucks)) as Arc<dyn TemplateEngine>));
        }
    }
}

pub struct JinjaEngine {
    env: Environment<'static>,
    /// Page and layout sources by template name, for the loader, so minijinja
    /// compiles each one once per build.
    sources: Arc<RwLock<HashMap<String, String>>>,
    /// Accept Nunjucks syntax minijinja doesn't know (`.njk`).
    nunjucks: bool,
}

/// Page names get this prefix so a page can't shadow an include with the
/// same relative path.
const PAGE_PREFIX: &str = "./";

impl JinjaEngine {
    pub fn new(engine_env: &EngineEnv, nunjucks: bool) -> Self {
        let mut env = Environment::new();
        env.set_undefined_behavior(UndefinedBehavior::Chainable);
        env.set_auto_escape_callback(|_| AutoEscape::Html);
        // Nunjucks keeps a template's last newline; Jinja drops it.
        if let Ok(syntax) = minijinja::syntax::SyntaxConfig::builder().keep_trailing_newline(true).build() {
            env.set_syntax(syntax);
        }

        let sources: Arc<RwLock<HashMap<String, String>>> = Arc::default();
        let includes: PathBuf = engine_env.includes_dir.clone();
        let pages = sources.clone();
        env.set_loader(move |name: &str| {
            if let Some(src) = pages.read().unwrap().get(name) {
                return Ok(Some(src.clone()));
            }
            // Includes: plain relative paths inside the includes folder.
            if name.split(['/', '\\']).any(|part| part == ".." || part.is_empty()) {
                return Ok(None);
            }
            match std::fs::read_to_string(includes.join(name)) {
                Ok(src) if nunjucks => Ok(Some(nunjucks_syntax(&src))),
                Ok(src) => Ok(Some(src)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(Error::new(ErrorKind::InvalidOperation, format!("reading {}: {}", name, e))),
            }
        });

        // Escape like Nunjucks (`& < > " '`; minijinja also escapes `/`), and
        // print nothing for none and undefined (minijinja prints `none`).
        let strict = engine_env.strict;
        env.set_formatter(move |out, state, value| {
            if value.is_undefined() && strict {
                return Err(Error::new(ErrorKind::UndefinedError, "printed an undefined value (strict is on)"));
            }
            if value.is_undefined() || value.is_none() {
                return Ok(());
            }
            let text = value.to_string();
            let text = if value.is_safe() || matches!(state.auto_escape(), AutoEscape::None) { text } else { escape(&text) };
            out.write_str(&text).map_err(|_| Error::new(ErrorKind::WriteFailure, "failed to write output"))
        });
        for name in ["escape", "e"] {
            env.add_filter(name, |value: JValue| if value.is_safe() { value } else { JValue::from_safe_string(escape(&value.to_string())) });
        }
        // Nunjucks' name for `tojson`, and its `truncate`.
        env.add_filter("dump", minijinja::filters::tojson);
        env.add_filter("truncate", truncate);
        // `{% for key, value in object %}` in Nunjucks: an object's pairs, a list as it is.
        env.add_filter(PAIRS_FILTER, |value: JValue| if value.kind() == ValueKind::Map { minijinja::filters::items(&value).unwrap_or(value) } else { value });
        for (name, value) in engine_env.globals.iter() {
            if let Value::Func(_) = value {
                let (filter_name, function) = (name.clone(), value.clone());
                env.add_filter(name.clone(), move |args: Rest<JValue>| call(&filter_name, &function, &args.0));
            }
            env.add_global(name.clone(), to_jinja(value));
        }
        JinjaEngine { env, sources, nunjucks }
    }
}

impl TemplateEngine for JinjaEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        let context = page_context(data);
        let result = match ctx.cache_key {
            Some(key) => {
                let name = format!("{}{}", PAGE_PREFIX, key);
                if !self.sources.read().unwrap().contains_key(&name) {
                    let source = if self.nunjucks { nunjucks_syntax(source) } else { source.to_string() };
                    self.sources.write().unwrap().insert(name.clone(), source);
                }
                self.env.get_template(&name).and_then(|t| t.render(context))
            }
            None if self.nunjucks => self.env.render_named_str(ctx.name, &nunjucks_syntax(source), context),
            None => self.env.render_named_str(ctx.name, source, context),
        };
        result.map_err(|e| anyhow!("{}", describe(&e)))
    }
}

const PAIRS_FILTER: &str = "__ssqch_pairs";

/// Rewrite the Nunjucks syntax minijinja doesn't know: `{% elseif %}` to
/// `{% elif %}`, and `{% for key, value in object %}` to iterate the object's
/// pairs. Line numbers stay the same.
fn nunjucks_syntax(src: &str) -> String {
    use std::sync::OnceLock;
    static ELSEIF: OnceLock<regex::Regex> = OnceLock::new();
    static FOR_PAIRS: OnceLock<regex::Regex> = OnceLock::new();
    if !src.contains("{%") {
        return src.to_string();
    }
    let elseif = ELSEIF.get_or_init(|| regex::Regex::new(r"\{%(-?)(\s*)elseif\b").unwrap());
    let for_pairs = FOR_PAIRS.get_or_init(|| regex::Regex::new(r"\{%(-?)(\s*)for\s+(\w+)\s*,\s*(\w+)\s+in\s+(.+?)\s*(-?)%\}").unwrap());
    let src = elseif.replace_all(src, "{%$1${2}elif");
    for_pairs.replace_all(&src, |c: &regex::Captures| format!("{{%{}{}for {}, {} in ({}) | {} {}%}}", &c[1], &c[2], &c[3], &c[4], &c[5], PAIRS_FILTER, &c[6])).into_owned()
}

/// Nunjucks' `truncate(length=255, killwords=false, end="...")`.
fn truncate(value: String, length: Option<usize>, killwords: Option<bool>, end: Option<String>) -> String {
    let length = length.unwrap_or(255);
    let end = end.unwrap_or_else(|| "...".into());
    if value.chars().count() <= length {
        return value;
    }
    let cut: String = value.chars().take(length).collect();
    if killwords.unwrap_or(false) {
        return cut + &end;
    }
    match cut.rfind(' ') {
        Some(i) if i > 0 => cut[..i].to_string() + &end,
        _ => cut + &end,
    }
}

/// HTML-escape text the way Nunjucks does.
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// minijinja's message, with where it happened (`index.njk:3`).
fn describe(e: &Error) -> String {
    let mut out = match (e.name(), e.line()) {
        (Some(name), Some(line)) => format!("{}:{}: {}", name.trim_start_matches(PAGE_PREFIX), line, e.kind()),
        (Some(name), None) => format!("{}: {}", name.trim_start_matches(PAGE_PREFIX), e.kind()),
        _ => e.kind().to_string(),
    };
    if let Some(detail) = e.detail() {
        out.push_str(": ");
        out.push_str(detail);
    }
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        out.push_str(&format!(" ({})", s));
        source = s.source();
    }
    out
}

/// The page's data, with a layout's `content` marked safe.
fn page_context(data: &Value) -> JValue {
    match data {
        Value::Obj(map) if map.contains_key("content") => {
            let content = map.get("content").map(|c| c.to_js_string()).unwrap_or_default();
            JValue::from_object(PageData { data: map.clone(), content: JValue::from_safe_string(content) })
        }
        other => to_jinja(other),
    }
}

/// Call a config filter or function with minijinja arguments.
fn call(name: &str, function: &Value, args: &[JValue]) -> Result<JValue, Error> {
    let Value::Func(f) = function else { return Ok(JValue::UNDEFINED) };
    let args: Vec<Value> = args.iter().map(from_jinja).collect();
    let result = f.call(&args).map_err(|e| Error::new(ErrorKind::InvalidOperation, format!("`{}`: {:#}", name, e)))?;
    Ok(to_jinja(&result))
}

// ------------------------------------------------------------- conversion

fn to_jinja(v: &Value) -> JValue {
    match v {
        Value::Undefined => JValue::UNDEFINED,
        Value::Null => JValue::from(()),
        Value::Bool(b) => JValue::from(*b),
        Value::Num(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => JValue::from(*n as i64),
        Value::Num(n) => JValue::from(*n),
        Value::Str(s) => JValue::from(s.clone()),
        Value::Arr(items) => JValue::from_object(Seq(items.clone())),
        Value::Obj(map) => JValue::from_object(Obj(map.clone())),
        Value::Date(_) | Value::Func(_) => JValue::from_object(Opaque(v.clone())),
    }
}

fn from_jinja(v: &JValue) -> Value {
    if let Some(Seq(items)) = v.downcast_object_ref::<Seq>() {
        return Value::Arr(items.clone());
    }
    if let Some(Obj(map)) = v.downcast_object_ref::<Obj>() {
        return Value::Obj(map.clone());
    }
    if let Some(page) = v.downcast_object_ref::<PageData>() {
        return Value::Obj(page.data.clone());
    }
    if let Some(Opaque(inner)) = v.downcast_object_ref::<Opaque>() {
        return inner.clone();
    }
    match v.kind() {
        ValueKind::Undefined => Value::Undefined,
        ValueKind::None => Value::Null,
        ValueKind::Bool => Value::Bool(v.is_true()),
        ValueKind::Number => f64::try_from(v.clone()).map(Value::Num).unwrap_or(Value::Undefined),
        ValueKind::String => Value::from(v.as_str().unwrap_or_default()),
        ValueKind::Seq | ValueKind::Iterable => Value::array(v.try_iter().map(|it| it.map(|x| from_jinja(&x)).collect()).unwrap_or_default()),
        ValueKind::Map => {
            let mut map = Map::new();
            if let Ok(keys) = v.try_iter() {
                for key in keys {
                    let item = v.get_item(&key).unwrap_or_default();
                    map.insert(key.to_string(), from_jinja(&item));
                }
            }
            Value::object(map)
        }
        _ => Value::from(v.to_string().as_str()),
    }
}

/// A SiteSquatch list, without copying it.
struct Seq(Arc<Vec<Value>>);

impl fmt::Debug for Seq {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_list().entries(self.0.iter().map(to_jinja)).finish()
    }
}

impl Object for Seq {
    fn repr(self: &Arc<Self>) -> ObjectRepr {
        ObjectRepr::Seq
    }

    fn get_value(self: &Arc<Self>, key: &JValue) -> Option<JValue> {
        let i = key.as_usize()?;
        self.0.get(i).map(to_jinja)
    }

    fn enumerate(self: &Arc<Self>) -> Enumerator {
        Enumerator::Seq(self.0.len())
    }
}

/// A SiteSquatch object, without copying it.
struct Obj(Arc<Map>);

impl fmt::Debug for Obj {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_map().entries(self.0.iter().map(|(k, v)| (k, to_jinja(v)))).finish()
    }
}

impl Object for Obj {
    fn get_value(self: &Arc<Self>, key: &JValue) -> Option<JValue> {
        self.0.get(key.as_str()?).map(to_jinja)
    }

    fn get_value_by_str(self: &Arc<Self>, key: &str) -> Option<JValue> {
        self.0.get(key).map(to_jinja)
    }

    fn enumerate(self: &Arc<Self>) -> Enumerator {
        let map = self.0.clone();
        Enumerator::Iter(Box::new((0..map.len()).filter_map(move |i| map.get_index(i).map(|(k, _)| JValue::from(k.as_str())))))
    }

    fn enumerator_len(self: &Arc<Self>) -> Option<usize> {
        Some(self.0.len())
    }
}

/// The top-level page data, with `content` marked safe.
struct PageData {
    data: Arc<Map>,
    content: JValue,
}

impl fmt::Debug for PageData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<page data>")
    }
}

impl Object for PageData {
    fn get_value(self: &Arc<Self>, key: &JValue) -> Option<JValue> {
        self.get_value_by_str(key.as_str()?)
    }

    fn get_value_by_str(self: &Arc<Self>, key: &str) -> Option<JValue> {
        if key == "content" {
            return Some(self.content.clone());
        }
        self.data.get(key).map(to_jinja)
    }

    fn enumerate(self: &Arc<Self>) -> Enumerator {
        let map = self.data.clone();
        Enumerator::Iter(Box::new((0..map.len()).filter_map(move |i| map.get_index(i).map(|(k, _)| JValue::from(k.as_str())))))
    }

    fn enumerator_len(self: &Arc<Self>) -> Option<usize> {
        Some(self.data.len())
    }
}

/// A date or a function: prints like it does in Edge, and a function can be
/// called (`{{ slug(title) }}`).
struct Opaque(Value);

impl fmt::Debug for Opaque {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0.to_js_string())
    }
}

impl Object for Opaque {
    fn repr(self: &Arc<Self>) -> ObjectRepr {
        ObjectRepr::Plain
    }

    fn call(self: &Arc<Self>, _state: &mut State<'_, '_>, args: &[JValue]) -> Result<JValue, Error> {
        match &self.0 {
            Value::Func(_) => call("function", &self.0, args),
            _ => Err(Error::new(ErrorKind::InvalidOperation, "a date isn't callable")),
        }
    }

    fn render(self: &Arc<Self>, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0.to_js_string())
    }
}
