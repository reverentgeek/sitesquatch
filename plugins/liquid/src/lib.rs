//! Liquid templates (`.liquid`) for SiteSquatch, on the
//! [`liquid`](https://crates.io/crates/liquid) crate.
//!
//! - Pages and layouts get the same data as Edge templates. The data isn't
//!   copied: Liquid reads it through [`View`], a view over SiteSquatch values.
//! - Config filters work as Liquid filters: `{{ title | slug }}` calls
//!   `slug(title)`, and `{{ date | format: "short" }}` calls
//!   `format(date, "short")`. A config filter replaces a built-in one with the
//!   same name.
//! - `{% include "nav.html" %}` (or Jekyll's unquoted `{% include nav.html
//!   title=page.title %}`, which passes `include.title`) and `{% render %}` read
//!   from the includes folder, adding `.liquid` when the name has no extension
//!   there.
//! - Unknown variables and properties render as nothing, as in Jekyll and
//!   Shopify.

// liquid-core's view traits are written in terms of its deprecated `KStringCow`.
#![allow(deprecated)]

use std::borrow::Cow;
use std::cell::Cell;
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Result};
use liquid_core::model::{ArrayView, DisplayCow, KStringCow, ObjectView, ScalarCow, State, ValueView};
use liquid_core::parser::{FilterArguments, FilterReflection, ParameterReflection, ParseFilter};
use liquid_core::runtime::Runtime;
use liquid_core::{Expression, Filter};
use sitesquatch::engines::{EngineEnv, RenderContext, TemplateEngine};
use sitesquatch::{Config, Map, Plugin, Value};

/// Registers the `liquid` engine. Add `"liquid"` to `templateFormats` to
/// render `.liquid` files, or use it for Markdown with `markdownEngine`.
#[derive(Default)]
pub struct LiquidPlugin;

impl Plugin for LiquidPlugin {
    fn name(&self) -> &str {
        "liquid"
    }

    fn register(&self, config: &mut Config) {
        config.add_template_engine("liquid", |env| Ok(Arc::new(LiquidEngine::new(env)?) as Arc<dyn TemplateEngine>));
    }
}

pub struct LiquidEngine {
    parser: liquid::Parser,
    strict: bool,
    compiled: RwLock<HashMap<String, Arc<liquid::Template>>>,
}

impl LiquidEngine {
    pub fn new(env: &EngineEnv) -> Result<Self> {
        let mut builder = liquid::ParserBuilder::with_stdlib()
            // Jekyll's include: quoted or bare names, and `include.*` parameters.
            .tag(liquid_lib::jekyll::IncludeTag)
            .filter(liquid_lib::jekyll::Slugify)
            .filter(liquid_lib::jekyll::Push)
            .filter(liquid_lib::jekyll::Pop)
            .filter(liquid_lib::jekyll::Unshift)
            .filter(liquid_lib::jekyll::Shift)
            .filter(liquid_lib::jekyll::ArrayToSentenceString)
            .filter(liquid_lib::shopify::Pluralize);
        for (name, value) in env.globals.iter().chain(env.pipe_filters.iter()) {
            if let Value::Func(_) = value {
                builder = builder.filter(ConfigFilter { name: name.clone(), function: value.clone() });
            }
        }
        let parser = builder.partials(liquid::partials::LazyCompiler::new(Includes::new(env.include_dirs()))).build()?;
        Ok(LiquidEngine { parser, strict: env.strict, compiled: RwLock::new(HashMap::new()) })
    }

    fn compiled(&self, source: &str, ctx: &RenderContext) -> Result<Arc<liquid::Template>> {
        if let Some(key) = ctx.cache_key {
            if let Some(t) = self.compiled.read().unwrap().get(key) {
                return Ok(t.clone());
            }
        }
        let template = Arc::new(self.parser.parse(source).map_err(|e| anyhow!("{}: {}", ctx.name, describe(&e.to_string())))?);
        if let Some(key) = ctx.cache_key {
            self.compiled.write().unwrap().insert(key.to_string(), template.clone());
        }
        Ok(template)
    }
}

impl TemplateEngine for LiquidEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        let template = self.compiled(source, ctx)?;
        let globals = Globals(View::of(data));
        let was = STRICT.replace(self.strict);
        let result = template.render(&globals).map_err(|e| anyhow!("{}: {}", ctx.name, describe(&e.to_string())));
        STRICT.set(was);
        result
    }
}

// --------------------------------------------------------------- includes

/// The includes folder, as Liquid's partial source.
#[derive(Debug)]
struct Includes {
    /// Each partial's name (its path in an includes folder) and the file it
    /// is: the site's own, or else a theme's.
    files: Vec<(String, PathBuf)>,
}

impl Includes {
    fn new<'a>(dirs: impl Iterator<Item = &'a PathBuf>) -> Self {
        let mut files: Vec<(String, PathBuf)> = Vec::new();
        for dir in dirs.filter(|d| d.is_dir()) {
            for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
                if entry.file_type().is_file() {
                    if let Ok(rel) = entry.path().strip_prefix(dir) {
                        let name = rel.to_string_lossy().replace('\\', "/");
                        // An earlier folder's file wins.
                        if !files.iter().any(|(n, _)| *n == name) {
                            files.push((name, entry.path().to_path_buf()));
                        }
                    }
                }
            }
        }
        files.sort();
        Includes { files }
    }

    fn resolve(&self, name: &str) -> Option<&(String, PathBuf)> {
        // Jekyll's include tag hands over a quoted name with its quotes.
        let name = name.strip_prefix('"').and_then(|n| n.strip_suffix('"')).or_else(|| name.strip_prefix('\'').and_then(|n| n.strip_suffix('\''))).unwrap_or(name);
        let with_ext = format!("{}.liquid", name);
        self.files.iter().find(|(n, _)| n == name || *n == with_ext)
    }
}

impl liquid::partials::PartialSource for Includes {
    fn contains(&self, name: &str) -> bool {
        self.resolve(name).is_some()
    }

    fn names(&self) -> Vec<&str> {
        self.files.iter().map(|(name, _)| name.as_str()).collect()
    }

    fn try_get<'a>(&'a self, name: &str) -> Option<Cow<'a, str>> {
        let (_, path) = self.resolve(name)?;
        std::fs::read_to_string(path).ok().map(Cow::Owned)
    }
}

// ---------------------------------------------------------------- filters

/// A config filter (a template global that's a function), callable as a
/// Liquid filter.
#[derive(Clone)]
struct ConfigFilter {
    name: String,
    function: Value,
}

impl FilterReflection for ConfigFilter {
    fn name(&self) -> &str {
        &self.name
    }
    fn description(&self) -> &str {
        "a filter from the site's config"
    }
    fn positional_parameters(&self) -> &'static [ParameterReflection] {
        &[]
    }
    fn keyword_parameters(&self) -> &'static [ParameterReflection] {
        &[]
    }
}

impl ParseFilter for ConfigFilter {
    fn parse(&self, arguments: FilterArguments) -> liquid_core::Result<Box<dyn Filter>> {
        let positional: Vec<Expression> = arguments.positional.collect();
        let keyword: Vec<(String, Expression)> = arguments.keyword.map(|(k, v)| (k.to_string(), v)).collect();
        Ok(Box::new(CallFilter { name: self.name.clone(), function: self.function.clone(), positional, keyword }))
    }

    fn reflection(&self) -> &dyn FilterReflection {
        self
    }
}

struct CallFilter {
    name: String,
    function: Value,
    positional: Vec<Expression>,
    keyword: Vec<(String, Expression)>,
}

impl fmt::Debug for CallFilter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

impl fmt::Display for CallFilter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

impl Filter for CallFilter {
    fn evaluate(&self, input: &dyn ValueView, runtime: &dyn Runtime) -> liquid_core::Result<liquid_core::Value> {
        let mut args = vec![to_value(input)];
        for e in &self.positional {
            args.push(to_value(e.evaluate(runtime)?.as_view()));
        }
        // Keyword arguments (`| f: size: 2`) arrive as one trailing object.
        if !self.keyword.is_empty() {
            let mut options = Map::new();
            for (k, e) in &self.keyword {
                options.insert(k.clone(), to_value(e.evaluate(runtime)?.as_view()));
            }
            args.push(Value::object(options));
        }
        let Value::Func(f) = &self.function else { return Ok(liquid_core::Value::Nil) };
        let result = f.call(&args).map_err(|e| liquid_core::Error::with_msg(format!("filter `{}`: {:#}", self.name, e)))?;
        Ok(View::of(&result).to_value())
    }
}

/// Copy a Liquid value into a SiteSquatch one (for a config filter's
/// arguments). By the time a filter sees a value from the page's data, the
/// `liquid` crate has already copied it (every variable read does), so a big
/// list handed to a filter costs two copies and one more for the result.
fn to_value(v: &dyn ValueView) -> Value {
    if v.is_nil() {
        return Value::Null;
    }
    if let Some(s) = v.as_scalar() {
        if let Some(b) = s.to_bool() {
            return Value::Bool(b);
        }
        if let Some(i) = s.to_integer() {
            return Value::Num(i as f64);
        }
        if let Some(f) = s.to_float() {
            return Value::Num(f);
        }
        // Only for a date: asked of a string, Liquid parses it as one, and
        // compiles a regular expression to do it, every time.
        if !matches!(s.type_name(), "string") {
            if let Some(d) = s.to_date_time() {
                let ns = d.unix_timestamp_nanos();
                if let Some(dt) = chrono::DateTime::from_timestamp((ns / 1_000_000_000) as i64, (ns % 1_000_000_000) as u32) {
                    return Value::Date(dt);
                }
            }
        }
        return Value::from(s.to_kstr().as_str());
    }
    if let Some(a) = v.as_array() {
        return Value::array(a.values().map(to_value).collect());
    }
    if let Some(o) = v.as_object() {
        let mut map = Map::new();
        for (k, v) in o.iter() {
            map.insert(k.to_string(), to_value(v));
        }
        return Value::object(map);
    }
    Value::Undefined
}

// ------------------------------------------------------------------- data

/// A SiteSquatch value as Liquid sees it, without copying.
#[repr(transparent)]
pub struct View(Value);

static NIL: View = View(Value::Undefined);

thread_local! {
    /// The config's `strict`, while a template renders: a missing variable or
    /// property is an error instead of nil.
    static STRICT: Cell<bool> = const { Cell::new(false) };
}

fn strict() -> bool {
    STRICT.with(Cell::get)
}

impl View {
    pub fn of(v: &Value) -> &View {
        // SAFETY: `View` is `repr(transparent)` over `Value`.
        unsafe { &*(v as *const Value as *const View) }
    }

    fn number(n: f64) -> ScalarCow<'static> {
        if n.fract() == 0.0 && n.abs() < 9.0e15 {
            ScalarCow::new(n as i64)
        } else {
            ScalarCow::new(n)
        }
    }

    fn date(d: &chrono::DateTime<chrono::Utc>) -> Option<liquid_core::model::DateTime> {
        let ns = d.timestamp_nanos_opt()?;
        let t = time::OffsetDateTime::from_unix_timestamp_nanos(ns as i128).ok()?;
        let mut out = liquid_core::model::DateTime::from_ymd(1970, 1, 1);
        *out = t;
        Some(out)
    }
}

impl fmt::Debug for View {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0.to_json())
    }
}

/// How arrays and objects print in `{{ }}`: like Liquid's own (array items
/// joined with nothing, objects as their source).
struct Rendered<'a>(&'a View);

impl fmt::Display for Rendered<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 .0 {
            Value::Arr(items) => {
                for item in items.iter() {
                    write!(f, "{}", View::of(item).render())?;
                }
                Ok(())
            }
            Value::Obj(_) => write!(f, "{}", self.0 .0.to_json()),
            _ => match self.0.as_scalar() {
                Some(s) => write!(f, "{}", s.render()),
                None => Ok(()),
            },
        }
    }
}

impl ValueView for View {
    fn as_debug(&self) -> &dyn fmt::Debug {
        self
    }

    fn render(&self) -> DisplayCow<'_> {
        match &self.0 {
            Value::Str(s) => DisplayCow::Borrowed(s),
            _ => DisplayCow::Owned(Box::new(Rendered(self))),
        }
    }

    fn source(&self) -> DisplayCow<'_> {
        DisplayCow::Owned(Box::new(self.0.to_json().to_string()))
    }

    fn type_name(&self) -> &'static str {
        match &self.0 {
            Value::Undefined | Value::Null | Value::Func(_) => "nil",
            Value::Arr(_) => "array",
            Value::Obj(_) => "object",
            _ => self.as_scalar().map(|s| s.type_name()).unwrap_or("nil"),
        }
    }

    fn query_state(&self, state: State) -> bool {
        match &self.0 {
            Value::Undefined | Value::Null | Value::Func(_) => !matches!(state, State::Truthy | State::Empty),
            Value::Arr(a) => match state {
                State::Truthy => true,
                _ => a.is_empty(),
            },
            Value::Obj(o) => match state {
                State::Truthy => true,
                _ => o.is_empty(),
            },
            _ => self.as_scalar().is_some_and(|s| s.query_state(state)),
        }
    }

    fn to_kstr(&self) -> KStringCow<'_> {
        match &self.0 {
            Value::Str(s) => KStringCow::from_ref(s),
            _ => KStringCow::from_string(Rendered(self).to_string()),
        }
    }

    fn to_value(&self) -> liquid_core::Value {
        match &self.0 {
            Value::Undefined | Value::Null | Value::Func(_) => liquid_core::Value::Nil,
            Value::Arr(a) => liquid_core::Value::Array(a.iter().map(|v| View::of(v).to_value()).collect()),
            Value::Obj(o) => liquid_core::Value::Object(o.iter().map(|(k, v)| (k.clone().into(), View::of(v).to_value())).collect()),
            _ => self.as_scalar().map(|s| liquid_core::Value::Scalar(s.into_owned())).unwrap_or(liquid_core::Value::Nil),
        }
    }

    fn as_scalar(&self) -> Option<ScalarCow<'_>> {
        match &self.0 {
            Value::Bool(b) => Some(ScalarCow::new(*b)),
            Value::Num(n) => Some(View::number(*n)),
            Value::Str(s) => Some(ScalarCow::new(&**s)),
            Value::Date(d) => View::date(d).map(ScalarCow::new),
            _ => None,
        }
    }

    fn as_array(&self) -> Option<&dyn ArrayView> {
        matches!(self.0, Value::Arr(_)).then_some(self as &dyn ArrayView)
    }

    fn as_object(&self) -> Option<&dyn ObjectView> {
        matches!(self.0, Value::Obj(_)).then_some(self as &dyn ObjectView)
    }

    fn is_nil(&self) -> bool {
        matches!(self.0, Value::Undefined | Value::Null | Value::Func(_))
    }
}

impl ArrayView for View {
    fn as_value(&self) -> &dyn ValueView {
        self
    }

    fn size(&self) -> i64 {
        match &self.0 {
            Value::Arr(a) => a.len() as i64,
            _ => 0,
        }
    }

    fn values<'k>(&'k self) -> Box<dyn Iterator<Item = &'k dyn ValueView> + 'k> {
        match &self.0 {
            Value::Arr(a) => Box::new(a.iter().map(|v| View::of(v) as &dyn ValueView)),
            _ => Box::new(std::iter::empty()),
        }
    }

    fn contains_key(&self, index: i64) -> bool {
        ArrayView::get(self, index).is_some()
    }

    fn get(&self, index: i64) -> Option<&dyn ValueView> {
        let Value::Arr(a) = &self.0 else { return None };
        let i = if index < 0 { a.len() as i64 + index } else { index };
        a.get(usize::try_from(i).ok()?).map(|v| View::of(v) as &dyn ValueView)
    }
}

impl ObjectView for View {
    fn as_value(&self) -> &dyn ValueView {
        self
    }

    fn size(&self) -> i64 {
        match &self.0 {
            Value::Obj(o) => o.len() as i64,
            _ => 0,
        }
    }

    fn keys<'k>(&'k self) -> Box<dyn Iterator<Item = KStringCow<'k>> + 'k> {
        match &self.0 {
            Value::Obj(o) => Box::new(o.keys().map(|k| KStringCow::from_ref(k))),
            _ => Box::new(std::iter::empty()),
        }
    }

    fn values<'k>(&'k self) -> Box<dyn Iterator<Item = &'k dyn ValueView> + 'k> {
        match &self.0 {
            Value::Obj(o) => Box::new(o.values().map(|v| View::of(v) as &dyn ValueView)),
            _ => Box::new(std::iter::empty()),
        }
    }

    fn iter<'k>(&'k self) -> Box<dyn Iterator<Item = (KStringCow<'k>, &'k dyn ValueView)> + 'k> {
        match &self.0 {
            Value::Obj(o) => Box::new(o.iter().map(|(k, v)| (KStringCow::from_ref(k), View::of(v) as &dyn ValueView))),
            _ => Box::new(std::iter::empty()),
        }
    }

    // A missing property is nil rather than an error, as in Jekyll and Shopify
    // (`{{ page.subtitle }}` on a page without one renders nothing).
    fn contains_key(&self, index: &str) -> bool {
        match &self.0 {
            Value::Obj(o) => !strict() || o.contains_key(index),
            _ => false,
        }
    }

    fn get<'s>(&'s self, index: &str) -> Option<&'s dyn ValueView> {
        match &self.0 {
            Value::Obj(o) => match o.get(index) {
                Some(v) => Some(View::of(v)),
                None if strict() => None,
                None => Some(&NIL),
            },
            _ => None,
        }
    }
}

/// The page's data as the template's globals, where a missing name is nil
/// too.
#[derive(Debug)]
struct Globals<'a>(&'a View);

impl ValueView for Globals<'_> {
    fn as_debug(&self) -> &dyn fmt::Debug {
        self
    }
    fn render(&self) -> DisplayCow<'_> {
        self.0.render()
    }
    fn source(&self) -> DisplayCow<'_> {
        self.0.source()
    }
    fn type_name(&self) -> &'static str {
        "object"
    }
    fn query_state(&self, state: State) -> bool {
        self.0.query_state(state)
    }
    fn to_kstr(&self) -> KStringCow<'_> {
        self.0.to_kstr()
    }
    fn to_value(&self) -> liquid_core::Value {
        self.0.to_value()
    }
    fn as_object(&self) -> Option<&dyn ObjectView> {
        Some(self)
    }
}

impl ObjectView for Globals<'_> {
    fn as_value(&self) -> &dyn ValueView {
        self
    }
    fn size(&self) -> i64 {
        ObjectView::size(self.0)
    }
    fn keys<'k>(&'k self) -> Box<dyn Iterator<Item = KStringCow<'k>> + 'k> {
        ObjectView::keys(self.0)
    }
    fn values<'k>(&'k self) -> Box<dyn Iterator<Item = &'k dyn ValueView> + 'k> {
        ObjectView::values(self.0)
    }
    fn iter<'k>(&'k self) -> Box<dyn Iterator<Item = (KStringCow<'k>, &'k dyn ValueView)> + 'k> {
        ObjectView::iter(self.0)
    }
    fn contains_key(&self, index: &str) -> bool {
        !strict() || ObjectView::contains_key(self.0, index)
    }
    fn get<'s>(&'s self, index: &str) -> Option<&'s dyn ValueView> {
        match ObjectView::get(self.0, index) {
            None if !strict() => Some(&NIL),
            found => found,
        }
    }
}

/// The `liquid` crate's message, shorter where it's long: an unknown filter is
/// named, with ssqch's name for another generator's filter (`relative_url`) or
/// the closest filter there is, instead of every filter there is.
fn describe(message: &str) -> String {
    let field = |key: &str| message.lines().find_map(|l| l.trim().strip_prefix(key)).map(str::trim);
    if !message.contains("Unknown filter") {
        return message.to_string();
    }
    let Some(name) = field("requested filter=") else { return message.to_string() };
    let hint = match sitesquatch::equivalents::find(name, sitesquatch::equivalents::Kind::Filter) {
        Some(equivalent) => format!(". {}\n  More: {}", equivalent.say, equivalent.more),
        None => {
            let available: Vec<&str> = field("available filters=").map(|list| list.split(", ").collect()).unwrap_or_default();
            sitesquatch::suggest::closest(name, available.into_iter().filter(|f| *f != name)).map(|f| format!(" (did you mean `{}`?)", f)).unwrap_or_default()
        }
    };
    format!("unknown filter `{}`{}", name, hint)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Values survive the trip into a filter and back: lists, objects,
    /// numbers, strings that look like dates (which stay strings) and dates.
    #[test]
    fn filters_get_values_as_they_are() {
        let mut globals = Map::new();
        globals.insert("describe".into(), Value::func(|args| Ok(Value::from(args.iter().map(|a| format!("{}:{}", a.type_of(), a.to_json())).collect::<Vec<_>>().join(" ")))));
        let env = EngineEnv { includes_dir: std::env::temp_dir().join("ssqch-liquid-no-includes"), theme_includes: Vec::new(), globals, pipe_filters: Default::default(), build: sitesquatch::Config::new(".", sitesquatch::Environment::Production).build_context(), strict: false };
        let engine = LiquidEngine::new(&env).unwrap();
        let when = chrono::DateTime::parse_from_rfc3339("2026-03-14T00:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let data = Value::from_pairs([
            ("nav", Value::array(vec![Value::from_pairs([("on", Value::from("2026-03-14"))]), Value::from("Intro")])),
            ("when", Value::Date(when)),
        ]);
        let ctx = RenderContext { name: "test.liquid", input_path: std::path::Path::new("test.liquid"), cache_key: None };
        let out = engine.render("{{ nav | describe: 2, 'x', when }}", &data, &ctx).unwrap();
        assert_eq!(out, r#"object:[{"on":"2026-03-14"},"Intro"] number:2 string:"x" object:"2026-03-14T00:00:00.000Z""#);
    }
}
