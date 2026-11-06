//! Template engines. Built-in engines use the same trait as plugin engines.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use anyhow::{Context, Result};
use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};
use sitesquatch_edge::{FsLoader, Template};

use crate::config::BuildContext;
use crate::{Map, Value};

/// What an engine factory gets to work with.
pub struct EngineEnv {
    pub includes_dir: PathBuf,
    /// Every registered filter, shortcode and global.
    pub globals: Map,
    pub build: BuildContext,
}

pub struct RenderContext<'a> {
    /// Name used in error messages (path relative to the input directory).
    pub name: &'a str,
    pub input_path: &'a Path,
    /// When set, the engine may cache the compiled template under this key.
    pub cache_key: Option<&'a str>,
}

pub trait TemplateEngine: Send + Sync {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String>;
}

// -------------------------------------------------------------------- Edge

pub struct EdgeEngine {
    engine: sitesquatch_edge::Engine,
    compiled: RwLock<HashMap<String, Arc<Template>>>,
}

impl EdgeEngine {
    pub fn new(env: &EngineEnv) -> Self {
        let mut engine = sitesquatch_edge::Engine::new(FsLoader { root: env.includes_dir.clone() });
        for (name, value) in &env.globals {
            engine.add_global(name.clone(), value.clone());
        }
        EdgeEngine { engine, compiled: RwLock::new(HashMap::new()) }
    }

    pub fn inner(&self) -> &sitesquatch_edge::Engine {
        &self.engine
    }

    fn compiled(&self, source: &str, ctx: &RenderContext) -> Result<Arc<Template>> {
        if let Some(key) = ctx.cache_key {
            if let Some(t) = self.compiled.read().unwrap().get(key) {
                return Ok(t.clone());
            }
        }
        let tpl = Arc::new(self.engine.compile(ctx.name, source)?);
        if let Some(key) = ctx.cache_key {
            self.compiled.write().unwrap().insert(key.to_string(), tpl.clone());
        }
        Ok(tpl)
    }
}

impl TemplateEngine for EdgeEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        let tpl = self.compiled(source, ctx)?;
        self.engine.render(&tpl, data.clone())
    }
}

// ---------------------------------------------------------------- Markdown

/// CommonMark plus tables and strikethrough, with raw HTML allowed: the same
/// feature set as markdown-it's defaults in Eleventy.
pub struct MarkdownEngine {
    pub options: Options,
}

impl Default for MarkdownEngine {
    fn default() -> Self {
        // SUBSCRIPT makes single `~` its own construct so only `~~` strikes
        // through; it is turned back into literal tildes below (as markdown-it does).
        MarkdownEngine { options: Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_SUBSCRIPT }
    }
}

impl TemplateEngine for MarkdownEngine {
    fn render(&self, source: &str, _data: &Value, _ctx: &RenderContext) -> Result<String> {
        let mut out = String::with_capacity(source.len() * 3 / 2);
        // markdown-it writes strikethrough as <s>, pulldown-cmark as <del>.
        let events = Parser::new_ext(source, self.options).map(|e| match e {
            Event::Start(Tag::Strikethrough) => Event::Html("<s>".into()),
            Event::End(TagEnd::Strikethrough) => Event::Html("</s>".into()),
            Event::Start(Tag::Subscript) | Event::End(TagEnd::Subscript) => Event::Text("~".into()),
            other => other,
        });
        html::push_html(&mut out, events);
        Ok(out)
    }
}

/// Passes content through unchanged (`.html` and `.txt` without pre-processing).
pub struct PlainEngine;

impl TemplateEngine for PlainEngine {
    fn render(&self, source: &str, _data: &Value, _ctx: &RenderContext) -> Result<String> {
        Ok(source.to_string())
    }
}

pub(crate) struct Engines {
    pub edge: Arc<EdgeEngine>,
    pub by_name: HashMap<String, Arc<dyn TemplateEngine>>,
}

impl Engines {
    pub fn get(&self, name: &str) -> Result<&Arc<dyn TemplateEngine>> {
        self.by_name.get(name).with_context(|| {
            let mut known: Vec<_> = self.by_name.keys().cloned().collect();
            known.sort();
            format!("no template engine named `{}` (known: {})", name, known.join(", "))
        })
    }
}
