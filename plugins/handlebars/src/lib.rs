//! Handlebars and Mustache templates (`.hbs`, `.handlebars`, `.mustache`)
//! for SiteSquatch, on the [`handlebars`](https://crates.io/crates/handlebars)
//! crate. Mustache templates render as Handlebars, which covers Mustache's
//! tags (not its lambdas).
//!
//! - Pages and layouts get the same data as Edge templates. The `handlebars`
//!   crate works on JSON, so each page's data is converted to JSON before it
//!   renders: dates become ISO 8601 strings, and big collections cost more
//!   than in the other engines.
//! - Config filters are helpers: `{{shout title}}`, or `{{wrap title "[" "]"}}`.
//!   Hash arguments (`size=2`) arrive as a trailing object.
//! - Every file in the includes folder is a partial, by its path with and
//!   without the extension: `{{> nav}}` or `{{> nav.hbs}}`. Files that aren't
//!   Handlebars (`.liquid`, `.njk`) and don't parse as it are skipped.
//! - `{{ }}` escapes HTML and `{{{ }}}` doesn't, so a layout writes
//!   `{{{content}}}`. Missing values print nothing.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Result};
use handlebars::{Context, Handlebars, Helper, HelperDef, RenderContext as HbsRenderContext, RenderError, RenderErrorReason, ScopedJson};
use serde_json::Value as Json;
use sitesquatch::engines::{EngineEnv, RenderContext, TemplateEngine};
use sitesquatch::{Config, Map, Plugin, Value};

/// The file extensions this plugin registers an engine for.
pub const EXTENSIONS: &[&str] = &["hbs", "handlebars", "mustache"];

/// Registers the `hbs`, `handlebars` and `mustache` engines. Add the
/// extensions you use to `templateFormats`.
#[derive(Default)]
pub struct HandlebarsPlugin;

impl Plugin for HandlebarsPlugin {
    fn name(&self) -> &str {
        "handlebars"
    }

    fn register(&self, config: &mut Config) {
        for ext in EXTENSIONS {
            let mustache = *ext == "mustache";
            config.add_template_engine(*ext, move |env| Ok(Arc::new(HandlebarsEngine::new(env, mustache)?) as Arc<dyn TemplateEngine>));
        }
    }
}

pub struct HandlebarsEngine {
    registry: RwLock<Handlebars<'static>>,
    /// Template names already registered, by cache key.
    compiled: RwLock<HashMap<String, ()>>,
    /// Rewrite Mustache syntax (`.mustache`); see [`rewrite`].
    mustache: bool,
    /// The config's helpers, which a Mustache section mustn't shadow.
    helpers: Vec<String>,
}

impl HandlebarsEngine {
    pub fn new(env: &EngineEnv, mustache: bool) -> Result<Self> {
        let mut registry = Handlebars::new();
        registry.set_strict_mode(env.strict);
        // Themes first, so the site's own partial of the same name replaces a theme's.
        let dirs: Vec<&std::path::PathBuf> = env.include_dirs().collect();
        for dir in dirs.into_iter().rev() {
            register_partials(&mut registry, dir, mustache)?;
        }
        registry.register_helper(SECTION_HELPER, Box::new(SectionHelper));
        let mut helpers = Vec::new();
        for (name, value) in env.globals.iter() {
            if let Value::Func(_) = value {
                registry.register_helper(name, Box::new(ConfigHelper { name: name.clone(), function: value.clone() }));
                helpers.push(name.clone());
            }
        }
        Ok(HandlebarsEngine { registry: RwLock::new(registry), compiled: RwLock::new(HashMap::new()), mustache, helpers })
    }
}

/// Register each file in the includes folder as a partial, by its relative
/// path with and without the extension (`nav`, `nav.hbs`, `blog/card`).
fn register_partials(registry: &mut Handlebars<'static>, dir: &Path, mustache: bool) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(dir) else { continue };
        let name = rel.to_string_lossy().replace('\\', "/");
        let Ok(source) = std::fs::read_to_string(entry.path()) else { continue };
        let source = rewrite(&source, mustache, &[]);
        // The includes folder also holds other engines' files. A Handlebars
        // file that doesn't parse is an error; anything else is just skipped.
        let ours = EXTENSIONS.iter().any(|ext| name.ends_with(&format!(".{}", ext)));
        if let Err(e) = registry.register_partial(&name, source.as_str()) {
            if ours {
                return Err(anyhow!("partial {}: {}", name, e));
            }
            continue;
        }
        if let Some((stem, _)) = name.rsplit_once('.') {
            let _ = registry.register_partial(stem, source.as_str());
        }
    }
    Ok(())
}

impl TemplateEngine for HandlebarsEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        let rewritten = rewrite(source, self.mustache, &self.helpers);
        let source = rewritten.as_str();
        let context = Context::from(data.to_json());
        let result = match ctx.cache_key {
            Some(key) => {
                let name = format!("./{}", key);
                if !self.compiled.read().unwrap().contains_key(&name) {
                    self.registry.write().unwrap().register_template_string(&name, source).map_err(|e| anyhow!("{}: {}", ctx.name, e))?;
                    self.compiled.write().unwrap().insert(name.clone(), ());
                }
                self.registry.read().unwrap().render_with_context(&name, &context)
            }
            None => self.registry.read().unwrap().render_template_with_context(source, &context),
        };
        result.map_err(|e| anyhow!("{}: {}", ctx.name, describe(&e)))
    }
}

/// Syntax the `handlebars` crate doesn't know:
///
/// - Inverted sections (`{{^items}}none{{/items}}`, in Handlebars.js and
///   Mustache) become `{{#unless items}}`.
/// - In Mustache, the implicit iterator `{{.}}` is `{{this}}`, and a section
///   (`{{#items}}...{{/items}}`) iterates a list, or renders once for any other
///   truthy value, through the `__section` helper.
fn rewrite(source: &str, mustache: bool, helpers: &[String]) -> String {
    use std::sync::OnceLock;
    static INVERTED: OnceLock<regex::Regex> = OnceLock::new();
    static SECTION: OnceLock<regex::Regex> = OnceLock::new();
    let mut out = source.to_string();
    if mustache {
        out = out.replace("{{{.}}}", "{{{this}}}").replace("{{.}}", "{{this}}").replace("{{ . }}", "{{this}}");
    }
    if out.contains("{{^") {
        let inverted = INVERTED.get_or_init(|| regex::Regex::new(r"\{\{\^\s*([\w.@-]+)\s*\}\}").unwrap());
        out = rewrite_blocks(&out, inverted, &|name| Some((format!("{{{{#unless {}}}}}", name), "{{/unless}}".to_string())));
    }
    if mustache && out.contains("{{#") {
        let section = SECTION.get_or_init(|| regex::Regex::new(r"\{\{#\s*([\w.@-]+)\s*\}\}").unwrap());
        out = rewrite_blocks(&out, section, &|name| {
            (!BUILTIN_HELPERS.contains(&name) && !helpers.iter().any(|h| h == name)).then(|| (format!("{{{{#each ({} {})}}}}", SECTION_HELPER, name), "{{/each}}".to_string()))
        });
    }
    out
}

const BUILTIN_HELPERS: &[&str] = &["if", "unless", "each", "with", "lookup", "log", "raw", "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not", "len"];
const SECTION_HELPER: &str = "__section";

/// Replace each block that `open` matches (capturing its name) and its
/// matching `{{/name}}` with what `replace` returns for the name, or leave
/// it when that's `None`. Nested blocks with the same name are matched.
fn rewrite_blocks(source: &str, open: &regex::Regex, replace: &dyn Fn(&str) -> Option<(String, String)>) -> String {
    let mut result = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(m) = open.captures(rest) {
        let whole = m.get(0).unwrap();
        let name = m[1].to_string();
        result.push_str(&rest[..whole.start()]);
        let after = &rest[whole.end()..];
        let close = format!("{{{{/{}}}}}", name);
        let opens = [format!("{{{{#{}}}}}", name), format!("{{{{^{}}}}}", name)];
        let (mut depth, mut i, mut end) = (0usize, 0usize, None);
        while i < after.len() {
            let tail = &after[i..];
            if opens.iter().any(|o| tail.starts_with(o.as_str())) {
                depth += 1;
            } else if tail.starts_with(&close) {
                if depth == 0 {
                    end = Some(i);
                    break;
                }
                depth -= 1;
            }
            i += tail.chars().next().map(char::len_utf8).unwrap_or(1);
        }
        match (end, replace(&name)) {
            (Some(e), Some((start_tag, end_tag))) => {
                result.push_str(&start_tag);
                result.push_str(&rewrite_blocks(&after[..e], open, replace));
                result.push_str(&end_tag);
                rest = &after[e + close.len()..];
            }
            _ => {
                result.push_str(whole.as_str());
                rest = after;
            }
        }
    }
    result.push_str(rest);
    result
}

/// `__section value`: a list as it is, any other truthy value as a list of
/// one, and nothing for a falsy one (Mustache's section rules).
struct SectionHelper;

impl HelperDef for SectionHelper {
    fn call_inner<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'rc>,
        _: &'reg Handlebars<'reg>,
        _: &'rc Context,
        _: &mut HbsRenderContext<'reg, 'rc>,
    ) -> Result<ScopedJson<'rc>, RenderError> {
        let value = h.param(0).map(|p| p.value().clone()).unwrap_or(Json::Null);
        Ok(ScopedJson::Derived(match value {
            Json::Array(_) => value,
            Json::Null | Json::Bool(false) => Json::Array(vec![]),
            Json::String(ref s) if s.is_empty() => Json::Array(vec![]),
            other => Json::Array(vec![other]),
        }))
    }
}

fn describe(e: &RenderError) -> String {
    match (e.line_no, e.column_no) {
        (Some(line), Some(col)) => format!("line {}, column {}: {}", line, col, e.reason()),
        _ => e.reason().to_string(),
    }
}

/// A config filter as a Handlebars helper.
struct ConfigHelper {
    name: String,
    function: Value,
}

impl HelperDef for ConfigHelper {
    fn call_inner<'reg: 'rc, 'rc>(
        &self,
        h: &Helper<'rc>,
        _: &'reg Handlebars<'reg>,
        _: &'rc Context,
        _: &mut HbsRenderContext<'reg, 'rc>,
    ) -> Result<ScopedJson<'rc>, RenderError> {
        let Value::Func(f) = &self.function else { return Ok(ScopedJson::Missing) };
        let mut args: Vec<Value> = h.params().iter().map(|p| Value::from(p.value().clone())).collect();
        if !h.hash().is_empty() {
            let mut options = Map::new();
            for (k, v) in h.hash() {
                options.insert(k.to_string(), Value::from(v.value().clone()));
            }
            args.push(Value::object(options));
        }
        let result = f.call(&args).map_err(|e| RenderErrorReason::Other(format!("helper `{}`: {:#}", self.name, e)))?;
        Ok(ScopedJson::Derived(match result {
            Value::Undefined => Json::Null,
            other => other.to_json(),
        }))
    }
}
