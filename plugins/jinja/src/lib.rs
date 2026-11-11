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
    /// The config's functions, which `.njk` templates can use as tags:
    /// `{% image "a.png", "Alt" %}`, or around content with `{% endimage %}`.
    tags: Arc<std::collections::HashSet<String>>,
    /// The config's functions (filters too), for "did you mean".
    functions: Vec<String>,
    /// The includes folders, for "did you mean" on a template that isn't there.
    includes: Vec<PathBuf>,
    /// The includes read so far (minijinja reads each one once), for `--verbose`.
    loaded: Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
}

/// minijinja's own filters, tests and functions, and the ones this plugin adds,
/// for "did you mean".
const FILTERS: &[&str] = &[
    "abs", "attr", "batch", "bool", "capitalize", "chain", "count", "d", "default", "dictsort", "e", "escape", "first", "float", "format", "groupby", "indent", "int", "items", "join", "last", "length", "lines", "list", "lower", "map", "max", "min", "pprint",
    "reject", "rejectattr", "replace", "reverse", "round", "safe", "select", "selectattr", "slice", "sort", "split", "string", "sum", "title", "tojson", "trim", "unique", "upper", "urlencode", "zip", "dump", "truncate", "pluralize", "filesizeformat",
    "striptags", "dateformat", "timeformat", "datetimeformat",
];
const TESTS: &[&str] = &[
    "boolean", "defined", "divisibleby", "endingwith", "eq", "equalto", "escaped", "even", "false", "filter", "float", "ge", "greaterthan", "gt", "in", "int", "integer", "iterable", "le", "lessthan", "lower", "lt", "mapping", "ne", "none", "number", "odd",
    "safe", "sameas", "sequence", "startingwith", "string", "test", "true", "undefined", "upper",
];
const FUNCTIONS: &[&str] = &["debug", "dict", "namespace", "range", "cycler", "joiner", "now"];

/// What a config function is also called, so a tag reaches it even on a page
/// whose data has a field with the function's name.
const TAG_PREFIX: &str = "__ssqch_tag_";

/// Tags Jinja and Nunjucks define, which a function of the same name doesn't replace.
const BUILT_IN_TAGS: &[&str] = &[
    "if", "elif", "elseif", "else", "endif", "for", "endfor", "set", "endset", "block", "endblock", "extends", "include", "import", "from", "macro", "endmacro", "call", "endcall", "filter", "endfilter", "raw", "endraw", "verbatim", "endverbatim",
    "with", "endwith", "autoescape", "endautoescape", "do", "break", "continue", "asyncEach", "asyncAll", "ifAsync",
];

/// Page names get this prefix so a page can't shadow an include with the
/// same relative path.
const PAGE_PREFIX: &str = "./";

impl JinjaEngine {
    pub fn new(engine_env: &EngineEnv, nunjucks: bool) -> Self {
        let mut env = Environment::new();
        env.set_undefined_behavior(UndefinedBehavior::Chainable);
        // String and list methods: Python's (`title.startswith("A")`, from
        // minijinja-contrib), plus the JavaScript names Nunjucks templates use
        // (`title.startsWith("A")`, `tags.includes("x")`).
        env.set_unknown_method_callback(|state, value, method, args| {
            let python = match method {
                "startsWith" => "startswith",
                "endsWith" => "endswith",
                "toLowerCase" => "lower",
                "toUpperCase" => "upper",
                "trim" => "strip",
                "trimStart" => "lstrip",
                "trimEnd" => "rstrip",
                "indexOf" if value.as_str().is_some() => "find",
                "indexOf" => "index",
                "includes" => {
                    let needle = args.first().cloned().unwrap_or_default();
                    if let (Some(hay), Some(n)) = (value.as_str(), needle.as_str()) {
                        return Ok(minijinja::Value::from(hay.contains(n)));
                    }
                    return Ok(minijinja::Value::from(value.try_iter()?.any(|item| item == needle)));
                }
                other => other,
            };
            minijinja_contrib::pycompat::unknown_method_callback(state, value, python, args)
        });
        env.set_auto_escape_callback(|_| AutoEscape::Html);
        // Nunjucks keeps a template's last newline; Jinja drops it.
        if let Ok(syntax) = minijinja::syntax::SyntaxConfig::builder().keep_trailing_newline(true).build() {
            env.set_syntax(syntax);
        }

        let tags: Arc<std::collections::HashSet<String>> =
            Arc::new(engine_env.globals.iter().filter(|(name, value)| matches!(value, Value::Func(_)) && !BUILT_IN_TAGS.contains(&name.as_str())).map(|(name, _)| name.clone()).collect());
        let sources: Arc<RwLock<HashMap<String, String>>> = Arc::default();
        let includes: Vec<PathBuf> = engine_env.include_dirs().cloned().collect();
        let include_dirs = includes.clone();
        let pages = sources.clone();
        let loader_tags = tags.clone();
        let loaded: Arc<std::sync::Mutex<std::collections::HashSet<String>>> = Arc::default();
        let loader_loaded = loaded.clone();
        env.set_loader(move |name: &str| {
            if let Some(src) = pages.read().unwrap().get(name) {
                return Ok(Some(src.clone()));
            }
            // Includes: plain relative paths inside the includes folder.
            if name.split(['/', '\\']).any(|part| part == ".." || part.is_empty()) {
                return Ok(None);
            }
            // The site's includes folder, then each theme's.
            let Some(path) = includes.iter().map(|dir| dir.join(name)).find(|p| p.is_file()) else { return Ok(None) };
            loader_loaded.lock().unwrap().insert(name.replace('\\', "/"));
            match std::fs::read_to_string(path) {
                Ok(src) if nunjucks => Ok(Some(nunjucks_syntax(&src, &loader_tags))),
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
        // More of Jinja's own (from minijinja-contrib), and dates.
        env.add_filter("pluralize", minijinja_contrib::filters::pluralize);
        env.add_filter("filesizeformat", minijinja_contrib::filters::filesizeformat);
        env.add_filter("striptags", minijinja_contrib::filters::striptags);
        env.add_function("cycler", minijinja_contrib::globals::cycler);
        env.add_function("joiner", minijinja_contrib::globals::joiner);
        env.add_filter("dateformat", |value: JValue, format: Option<String>| format_date(&value, format.as_deref(), DateParts::Date));
        env.add_filter("timeformat", |value: JValue, format: Option<String>| format_date(&value, format.as_deref(), DateParts::Time));
        env.add_filter("datetimeformat", |value: JValue, format: Option<String>| format_date(&value, format.as_deref(), DateParts::Both));
        env.add_function("now", || JValue::from_object(Opaque(Value::Date(chrono::Utc::now()))));
        // `{% for key, value in object %}` in Nunjucks: an object's pairs, a list as it is.
        env.add_filter(PAIRS_FILTER, |value: JValue| if value.kind() == ValueKind::Map { minijinja::filters::items(&value).unwrap_or(value) } else { value });
        for (name, value) in engine_env.globals.iter() {
            if let Value::Func(_) = value {
                let (filter_name, function) = (name.clone(), value.clone());
                env.add_filter(name.clone(), move |args: Rest<JValue>| call(&filter_name, &function, &args.0));
            }
            env.add_global(name.clone(), to_jinja(value));
            // A name page data can't shadow, for `{% name %}` tags.
            if tags.contains(name) {
                env.add_global(format!("{}{}", TAG_PREFIX, name), to_jinja(value));
            }
        }
        let functions = engine_env.globals.iter().filter(|(_, value)| matches!(value, Value::Func(_))).map(|(name, _)| name.clone()).collect();
        JinjaEngine { env, sources, nunjucks, tags, functions, includes: include_dirs, loaded }
    }

    /// minijinja's message, with where it happened (`index.jinja:3`). A name
    /// it doesn't know is quoted (so the error's frame puts carets under it),
    /// with the name it was probably meant to be.
    fn describe(&self, e: &Error) -> String {
        let place = match (e.name(), e.line()) {
            (Some(name), Some(line)) => format!("{}:{}: ", name.trim_start_matches(PAGE_PREFIX), line),
            (Some(name), None) => format!("{}: ", name.trim_start_matches(PAGE_PREFIX)),
            _ => String::new(),
        };
        let mut out = place + &self.what(e);
        let mut source = std::error::Error::source(e);
        while let Some(s) = source {
            out.push_str(&format!(" ({})", s));
            source = s.source();
        }
        out
    }

    /// The error itself: `unknown filter `upcase` (did you mean `upper`?)`.
    fn what(&self, e: &Error) -> String {
        let detail = e.detail().unwrap_or_default();
        let config = self.functions.iter().map(String::as_str);
        let unknown = |prefix: &str| detail.strip_prefix(prefix).and_then(|d| d.strip_suffix(" is unknown")).filter(|name| !name.contains(' '));
        let (name, candidates): (Option<&str>, Vec<&str>) = match e.kind() {
            ErrorKind::UnknownFilter => (unknown("filter "), FILTERS.iter().copied().chain(config).collect()),
            ErrorKind::UnknownTest => (unknown("test "), TESTS.to_vec()),
            ErrorKind::UnknownFunction => (unknown(""), FUNCTIONS.iter().copied().chain(config).collect()),
            ErrorKind::TemplateNotFound => {
                let Some(wanted) = quoted(detail) else { return format!("{}: {}", e.kind(), detail) };
                let hint = self.closest_include(wanted).map(|found| format!(" (did you mean `{}`?)", found)).unwrap_or_default();
                let verb = if detail.starts_with("tried to include") { "can't include" } else { "no template named" };
                return format!("{}: {} `{}`{}", e.kind(), verb, wanted, hint);
            }
            _ => (None, Vec::new()),
        };
        // Another generator's filter (`url`, `slugify`): ssqch's way, instead of a guess from the spelling.
        if let (Some(name), ErrorKind::UnknownFilter) = (name, e.kind()) {
            if let Some(equivalent) = sitesquatch::equivalents::find(name, sitesquatch::equivalents::Kind::Filter) {
                return format!("{} `{}`. {}\n  More: {}", e.kind(), name, equivalent.say, equivalent.more);
            }
        }
        match name {
            Some(name) => {
                let hint = sitesquatch::suggest::closest(name, candidates.into_iter().filter(|c| *c != name)).map(|found| format!(" (did you mean `{}`?)", found)).unwrap_or_default();
                format!("{} `{}`{}", e.kind(), name, hint)
            }
            None if detail.is_empty() => e.kind().to_string(),
            None => format!("{}: {}", e.kind(), detail),
        }
    }

    /// The file in the includes folders whose path is closest to `wanted`.
    fn closest_include(&self, wanted: &str) -> Option<String> {
        let have: Vec<String> = self
            .includes
            .iter()
            .flat_map(|dir| {
                walkdir::WalkDir::new(dir)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file())
                    .filter_map(|entry| entry.path().strip_prefix(dir).ok().map(|rel| rel.to_string_lossy().replace('\\', "/")))
                    .collect::<Vec<_>>()
            })
            .collect();
        sitesquatch::suggest::closest_path(wanted, have.iter().map(String::as_str)).map(String::from)
    }
}

/// The first `"quoted"` or `'quoted'` part of `text`.
fn quoted(text: &str) -> Option<&str> {
    let start = text.find(['"', '\''])?;
    let mark = text[start..].chars().next()?;
    let rest = &text[start + 1..];
    rest.find(mark).map(|end| &rest[..end])
}

impl TemplateEngine for JinjaEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        let context = page_context(data);
        let result = match ctx.cache_key {
            Some(key) => {
                let name = format!("{}{}", PAGE_PREFIX, key);
                if !self.sources.read().unwrap().contains_key(&name) {
                    let source = if self.nunjucks { nunjucks_syntax(source, &self.tags) } else { source.to_string() };
                    self.sources.write().unwrap().insert(name.clone(), source);
                }
                self.env.get_template(&name).and_then(|t| t.render(context))
            }
            None if self.nunjucks => self.env.render_named_str(ctx.name, &nunjucks_syntax(source, &self.tags), context),
            None => self.env.render_named_str(ctx.name, source, context),
        };
        result.map_err(|e| anyhow!("{}", self.describe(&e)))
    }

    fn included(&self) -> Option<Vec<String>> {
        Some(self.loaded.lock().unwrap().iter().cloned().collect())
    }
}

const PAIRS_FILTER: &str = "__ssqch_pairs";

/// Rewrite the Nunjucks syntax minijinja doesn't know: `{% elseif %}` to
/// `{% elif %}`, `{% for key, value in object %}` to iterate the object's
/// pairs, and inside tags (see [`nunjucks_code`]) object literals, `===`,
/// `site.404_page` and macro parameter order. Line numbers stay the same.
fn nunjucks_syntax(src: &str, tags: &std::collections::HashSet<String>) -> String {
    use std::sync::OnceLock;
    static ELSEIF: OnceLock<regex::Regex> = OnceLock::new();
    static FOR_PAIRS: OnceLock<regex::Regex> = OnceLock::new();
    if !src.contains("{%") && !src.contains("{{") {
        return src.to_string();
    }
    let elseif = ELSEIF.get_or_init(|| regex::Regex::new(r"\{%(-?)(\s*)elseif\b").unwrap());
    let for_pairs = FOR_PAIRS.get_or_init(|| regex::Regex::new(r"\{%(-?)(\s*)for\s+(\w+)\s*,\s*(\w+)\s+in\s+(.+?)\s*(-?)%\}").unwrap());
    let src = elseif.replace_all(src, "{%$1${2}elif");
    let src = for_pairs.replace_all(&src, |c: &regex::Captures| format!("{{%{}{}for {}, {} in ({}) | {} {}%}}", &c[1], &c[2], &c[3], &c[4], &c[5], PAIRS_FILTER, &c[6]));
    rewrite_tags(&custom_tags(&src, tags))
}

/// Tags named after the config's functions: `{% image "a.png", "Alt" %}`
/// prints `image("a.png", "Alt")`, and with a `{% endimage %}`, the function
/// gets what's between them as its first argument. What it returns is
/// printed as it is (HTML isn't escaped), like a shortcode.
fn custom_tags<'a>(src: &'a str, tags: &std::collections::HashSet<String>) -> std::borrow::Cow<'a, str> {
    use std::sync::OnceLock;
    static TAG: OnceLock<regex::Regex> = OnceLock::new();
    if tags.is_empty() || !src.contains("{%") {
        return src.into();
    }
    let tag = TAG.get_or_init(|| regex::Regex::new(r"(?s)\{%(-?)\s*([A-Za-z_]\w*)(.*?)(-?)%\}").unwrap());
    let is_end = |name: &str| name.strip_prefix("end").is_some_and(|n| tags.contains(n));
    if !tag.captures_iter(src).any(|c| tags.contains(&c[2]) || is_end(&c[2])) {
        return src.into();
    }
    let paired: std::collections::HashSet<&str> = tag.captures_iter(src).filter_map(|c| c.get(2).map(|m| m.as_str())).filter(|n| is_end(n)).map(|n| &n[3..]).collect();
    tag.replace_all(src, |c: &regex::Captures| {
        let (open_trim, name, args, close_trim) = (&c[1], &c[2], c[3].trim(), &c[4]);
        if is_end(name) {
            format!("{{%{} endfilter {}%}}", open_trim, close_trim)
        } else if !tags.contains(name) {
            c[0].to_string()
        } else if paired.contains(name) {
            format!("{{%{} filter {}({}) | safe {}%}}", open_trim, name, args, close_trim)
        } else {
            format!("{{{{{} {}{}({}) | safe {}}}}}", open_trim, TAG_PREFIX, name, args, close_trim)
        }
    })
}

/// Run [`nunjucks_code`] over the code in every `{{ }}` and `{% %}` tag,
/// leaving `{% raw %}` blocks and `{# #}` comments alone.
fn rewrite_tags(src: &str) -> String {
    static ENDRAW: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let endraw = ENDRAW.get_or_init(|| regex::Regex::new(r"\{%-?\s*endraw\s*-?%\}").unwrap());
    let mut out = String::with_capacity(src.len() + 16);
    let mut rest = src;
    while let Some(start) = rest.find('{') {
        let (before, tail) = rest.split_at(start);
        out.push_str(before);
        let close = match tail.get(..2) {
            Some("{{") => "}}",
            Some("{%") => "%}",
            Some("{#") => "#}",
            _ => {
                out.push('{');
                rest = &tail[1..];
                continue;
            }
        };
        let Some(end) = find_close(&tail[2..], close) else {
            out.push_str(tail);
            return out;
        };
        let code = &tail[2..2 + end];
        out.push_str(&tail[..2]);
        if close == "#}" {
            out.push_str(code);
        } else {
            out.push_str(&nunjucks_code(code));
        }
        out.push_str(close);
        rest = &tail[2 + end + 2..];
        // `{% raw %}...{% endraw %}` stays as written.
        if close == "%}" && code.trim().trim_matches('-').trim() == "raw" {
            if let Some(m) = endraw.find(rest) {
                out.push_str(&rest[..m.end()]);
                rest = &rest[m.end()..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Where `close` ends a tag's code, skipping string literals.
fn find_close(code: &str, close: &str) -> Option<usize> {
    let bytes = code.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            q @ (b'"' | b'\'') => {
                i += 1;
                while i < bytes.len() && bytes[i] != q {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
            }
            _ if code[i..].starts_with(close) => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Nunjucks code as minijinja reads it, outside string literals:
/// - `{ title: x }` has the key `"title"` (unquoted, Jinja would use the
///   variable `title` as the key);
/// - `site.404_page` is `site["404_page"]`;
/// - `===` and `!==` are `==` and `!=`;
/// - `macro button(behavior="link", params)` lists parameters without
///   defaults first, as Nunjucks assigns positional arguments to them.
fn nunjucks_code(code: &str) -> String {
    let code = reorder_macro_params(code);
    let chars: Vec<char> = code.chars().collect();
    let mut out = String::with_capacity(code.len() + 8);
    let mut i = 0;
    // The last character outside whitespace, to tell `{ key:` from other colons.
    let mut prev = ' ';
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' {
            let start = i;
            i += 1;
            while i < chars.len() && chars[i] != c {
                i += if chars[i] == '\\' { 2 } else { 1 };
            }
            i = (i + 1).min(chars.len());
            out.extend(&chars[start..i]);
            prev = c;
            continue;
        }
        if (c == '=' || c == '!') && chars.get(i + 1) == Some(&'=') && chars.get(i + 2) == Some(&'=') {
            out.push(c);
            out.push('=');
            i += 3;
            prev = '=';
            continue;
        }
        // `.404_page`: a property that starts with a digit (but isn't a decimal).
        if c == '.' && (prev.is_alphanumeric() || prev == '_' || prev == ']' || prev == ')') && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()) {
            let start = i + 1;
            let mut j = start;
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            let name: String = chars[start..j].iter().collect();
            if !prev.is_ascii_digit() && name.chars().any(|ch| !ch.is_ascii_digit()) {
                out.push_str(&format!("[\"{}\"]", name));
                i = j;
                prev = ']';
                continue;
            }
        }
        // An object key: an identifier after `{` or `,`, then `:`.
        if (c.is_alphabetic() || c == '_' || c == '$') && (prev == '{' || prev == ',') {
            let mut j = i;
            while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_' || chars[j] == '$') {
                j += 1;
            }
            let mut k = j;
            while k < chars.len() && chars[k].is_whitespace() {
                k += 1;
            }
            if chars.get(k) == Some(&':') && chars.get(k + 1) != Some(&':') {
                let name: String = chars[i..j].iter().collect();
                out.push_str(&format!("\"{}\"", name));
                i = j;
                prev = '"';
                continue;
            }
        }
        out.push(c);
        if !c.is_whitespace() {
            prev = c;
        }
        i += 1;
    }
    out
}

/// `macro name(a="x", b)` to `macro name(b, a="x")`.
fn reorder_macro_params(code: &str) -> std::borrow::Cow<'_, str> {
    let trimmed = code.trim_start_matches('-').trim_start();
    let Some(rest) = trimmed.strip_prefix("macro ") else { return code.into() };
    let (Some(open), Some(close)) = (rest.find('('), rest.rfind(')')) else { return code.into() };
    let params = &rest[open + 1..close];
    // Top-level commas only (defaults can be lists or calls).
    let mut parts = Vec::new();
    let (mut depth, mut last) = (0i32, 0usize);
    for (i, ch) in params.char_indices() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(params[last..i].trim());
                last = i + 1;
            }
            _ => {}
        }
    }
    parts.push(params[last..].trim());
    let has_default = |p: &&str| p.contains('=');
    let first_default = parts.iter().position(has_default);
    if first_default.is_none_or(|f| parts[f..].iter().all(has_default)) {
        return code.into();
    }
    let reordered: Vec<&str> = parts.iter().filter(|p| !has_default(p)).chain(parts.iter().filter(|p| has_default(p))).copied().collect();
    let prefix_len = code.len() - trimmed.len() + "macro ".len() + open + 1;
    format!("{}{}{}", &code[..prefix_len], reordered.join(", "), &code[prefix_len + params.len()..]).into()
}

/// Nunjucks' `truncate(length=255, killwords=false, end="...")`.
#[derive(Clone, Copy)]
enum DateParts {
    Date,
    Time,
    Both,
}

/// `dateformat`, `timeformat` and `datetimeformat`: a date (or a string or a
/// Unix time that reads as one), in UTC, as `short`, `medium` (the default),
/// `long`, `full`, `iso`, `unix`, or a `strftime` pattern like `%B %-d, %Y`.
fn format_date(value: &JValue, format: Option<&str>, parts: DateParts) -> Result<String, Error> {
    let date = match from_jinja(value) {
        Value::Num(n) => chrono::DateTime::<chrono::Utc>::from_timestamp(n as i64, 0),
        other => other.to_date(),
    }
    .ok_or_else(|| Error::new(ErrorKind::InvalidOperation, format!("not a date: {}", value)))?;
    let pattern = match (format.unwrap_or("medium"), parts) {
        ("unix", _) => return Ok(date.timestamp().to_string()),
        ("iso", DateParts::Date) => "%Y-%m-%d",
        ("iso", DateParts::Time) => "%H:%M:%S",
        ("iso", DateParts::Both) => "%Y-%m-%dT%H:%M:%SZ",
        ("short", DateParts::Date) => "%Y-%m-%d",
        ("medium", DateParts::Date) => "%b %-d %Y",
        ("long", DateParts::Date) => "%B %-d %Y",
        ("full", DateParts::Date) => "%A, %B %-d %Y",
        ("short" | "medium", DateParts::Time) => "%H:%M",
        ("long" | "full", DateParts::Time) => "%H:%M:%S",
        ("short", DateParts::Both) => "%Y-%m-%d %H:%M",
        ("medium", DateParts::Both) => "%b %-d %Y %H:%M",
        ("long", DateParts::Both) => "%B %-d %Y %H:%M:%S",
        ("full", DateParts::Both) => "%A, %B %-d %Y %H:%M:%S",
        (pattern, _) => pattern,
    };
    strftime(&date, pattern)
}

/// `strftime`, with a bad pattern as an error instead of a panic.
fn strftime(date: &chrono::DateTime<chrono::Utc>, pattern: &str) -> Result<String, Error> {
    use std::fmt::Write;
    let mut out = String::new();
    write!(out, "{}", date.format(pattern)).map_err(|_| Error::new(ErrorKind::InvalidOperation, format!("{:?} isn't a date format (use short, medium, long, full, iso, unix, or a strftime pattern like \"%B %-d, %Y\")", pattern)))?;
    Ok(out)
}

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

    /// JavaScript's `Date` methods, which Nunjucks templates call
    /// (`page.date.toISOString()`). Times are UTC.
    fn call_method(self: &Arc<Self>, _state: &mut State<'_, '_>, method: &str, args: &[JValue]) -> Result<JValue, Error> {
        use chrono::{Datelike, Timelike};
        let Value::Date(d) = &self.0 else {
            return Err(Error::new(ErrorKind::UnknownMethod, format!("a function has no method named {}", method)));
        };
        Ok(match method {
            // Python's, for Jinja templates.
            "strftime" => JValue::from(strftime(d, args.first().and_then(|a| a.as_str()).unwrap_or("%Y-%m-%d"))?),
            "isoformat" => JValue::from(d.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()),
            "toISOString" | "toJSON" => JValue::from(d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()),
            "toUTCString" => JValue::from(d.format("%a, %d %b %Y %H:%M:%S GMT").to_string()),
            "getTime" | "valueOf" => JValue::from(d.timestamp_millis()),
            "getFullYear" | "getUTCFullYear" => JValue::from(d.year()),
            "getMonth" | "getUTCMonth" => JValue::from(d.month0()),
            "getDate" | "getUTCDate" => JValue::from(d.day()),
            "getDay" | "getUTCDay" => JValue::from(d.weekday().num_days_from_sunday()),
            "getHours" | "getUTCHours" => JValue::from(d.hour()),
            "getMinutes" | "getUTCMinutes" => JValue::from(d.minute()),
            "getSeconds" | "getUTCSeconds" => JValue::from(d.second()),
            other => return Err(Error::new(ErrorKind::UnknownMethod, format!("a date has no method named {} (dates have toISOString, getTime, getFullYear, getMonth, getDate, getDay and the like)", other))),
        })
    }

    fn render(self: &Arc<Self>, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0.to_js_string())
    }
}

#[cfg(test)]
mod tests {
    use super::nunjucks_syntax;

    #[test]
    fn nunjucks_code_is_rewritten_for_minijinja() {
        let cases = [
            ("{{ hero({ title: t, post: { date: d } }) }}", "{{ hero({ \"title\": t, \"post\": { \"date\": d } }) }}"),
            ("{% set x = { \"a\": 1, b: 2 } %}", "{% set x = { \"a\": 1, \"b\": 2 } %}"),
            ("{{ site.404_page.title }} {{ 1.5 }} {{ a[1:2] }}", "{{ site[\"404_page\"].title }} {{ 1.5 }} {{ a[1:2] }}"),
            ("{% if a === b and c !== d %}x{% endif %}", "{% if a == b and c != d %}x{% endif %}"),
            ("{% macro button(behavior=\"link\", params) %}", "{% macro button(params, behavior=\"link\") %}"),
            ("{%- macro card(params, size=[1, 2]) -%}", "{%- macro card(params, size=[1, 2]) -%}"),
            ("{{ \"{ title: x } === .404\" }}", "{{ \"{ title: x } === .404\" }}"),
            ("{% raw %}{{ { a: 1 } }}{% endraw %}{# { b: 2 } #}", "{% raw %}{{ { a: 1 } }}{% endraw %}{# { b: 2 } #}"),
            ("{% elseif x %}{% for k, v in o %}", "{% elif x %}{% for k, v in (o) | __ssqch_pairs %}"),
            ("text { a: b } and site.404_page", "text { a: b } and site.404_page"),
        ];
        for (input, want) in cases {
            assert_eq!(nunjucks_syntax(input, &Default::default()), want, "{}", input);
        }
    }
}
