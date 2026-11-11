//! Template engines. Built-in engines use the same trait as plugin engines.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock, Weak};

use anyhow::{Context, Result};
use sitesquatch_edge::{FsLoader, Template};

use crate::config::BuildContext;
use crate::markdown::{self, Hooks, MarkdownOptions};
use crate::{Map, Value};

/// What an engine factory gets to work with.
pub struct EngineEnv {
    pub includes_dir: PathBuf,
    /// The themes' `_includes` folders, where an include that isn't in
    /// `includes_dir` is looked for, in order.
    pub theme_includes: Vec<PathBuf>,
    /// Every registered filter, shortcode and global.
    pub globals: Map,
    pub build: BuildContext,
    /// The config's `strict`: printing an undefined value is an error.
    pub strict: bool,
}

impl EngineEnv {
    /// Every folder includes come from: the site's, then each theme's.
    pub fn include_dirs(&self) -> impl Iterator<Item = &PathBuf> {
        std::iter::once(&self.includes_dir).chain(&self.theme_includes)
    }
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

    /// The includes this engine has read so far, by their paths in the
    /// includes folder (with or without the extension), for `--verbose`'s
    /// list of templates nothing used. `None` when it doesn't keep track.
    fn included(&self) -> Option<Vec<String>> {
        None
    }
}

// -------------------------------------------------------------------- Edge

/// Edge's includes and components, from the includes folder and the themes'.
/// One that isn't there is reported with the name it was probably meant to be.
struct Includes(FsLoader);

impl sitesquatch_edge::Loader for Includes {
    fn load(&self, name: &str) -> Result<(String, String)> {
        self.0.load(name).map_err(|e| {
            let wanted = name.trim_end_matches(".edge");
            let have: Vec<String> = std::iter::once(&self.0.root)
                .chain(&self.0.fallbacks)
                .flat_map(|dir| {
                    walkdir::WalkDir::new(dir)
                        .into_iter()
                        .filter_map(Result::ok)
                        .filter(|entry| entry.file_type().is_file())
                        .filter_map(|entry| entry.path().strip_prefix(dir).ok().map(crate::slashes))
                        .filter_map(|rel| rel.strip_suffix(".edge").map(String::from))
                        .collect::<Vec<_>>()
                })
                .collect();
            match crate::suggest::closest(wanted, have.iter().map(String::as_str).filter(|c| *c != wanted)) {
                Some(found) => anyhow::anyhow!("{:#} (did you mean `{}`?)", e, found),
                None => e,
            }
        })
    }
}

pub struct EdgeEngine {
    engine: sitesquatch_edge::Engine,
    compiled: RwLock<HashMap<String, Arc<Template>>>,
}

impl EdgeEngine {
    pub fn new(env: &EngineEnv) -> Self {
        let mut engine = sitesquatch_edge::Engine::new(Includes(FsLoader { root: env.includes_dir.clone(), fallbacks: env.theme_includes.clone() }));
        for (name, value) in &env.globals {
            engine.add_global(name.clone(), value.clone());
        }
        engine.strict = env.strict;
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

    fn included(&self) -> Option<Vec<String>> {
        Some(self.engine.loaded())
    }
}

// ---------------------------------------------------------------- Markdown

/// Markdown, with the site's `markdown` options and its render hooks and
/// containers (see [`crate::markdown`]).
pub struct MarkdownEngine {
    pub options: MarkdownOptions,
    hooks: OnceLock<HookTemplates>,
}

impl Default for MarkdownEngine {
    fn default() -> Self {
        MarkdownEngine::new(MarkdownOptions::default())
    }
}

impl MarkdownEngine {
    pub fn new(options: MarkdownOptions) -> Self {
        MarkdownEngine { options, hooks: OnceLock::new() }
    }

    /// Render `source` for the page with `data` (which hook templates see),
    /// or for no page with `Value::Undefined`. `inline` drops the `<p>`
    /// around a single paragraph.
    pub fn render_html(&self, source: &str, data: &Value, input_path: &Path, inline: bool) -> Result<String> {
        let engines = self.hooks.get().and_then(|h| h.engines.upgrade().map(|e| (h, e)));
        let page_hooks = engines.as_ref().map(|(set, engines)| PageHooks { set, engines, data, input_path });
        let hooks = page_hooks.as_ref().filter(|h| !h.set.templates.is_empty()).map(|h| h as &dyn Hooks);
        if inline {
            markdown::render_inline(source, &self.options, hooks)
        } else {
            markdown::render(source, &self.options, hooks)
        }
    }

    /// Render the hook template `hooks/<name>` with `value` as `<name>` in
    /// `data`, if the site has that template.
    pub(crate) fn render_hook(&self, name: &str, value: Value, data: &Value) -> Option<Result<String>> {
        let set = self.hooks.get()?;
        let engines = set.engines.upgrade()?;
        let key = format!("hooks/{}", name);
        if !set.templates.contains_key(&key) {
            return None;
        }
        let hooks = PageHooks { set, engines: &engines, data, input_path: Path::new("") };
        Some(hooks.render(&key, name, value))
    }

    pub(crate) fn set_hooks(&self, templates: HashMap<String, HookTemplate>, engines: Weak<Engines>) {
        let _ = self.hooks.set(HookTemplates { templates, engines });
    }
}

impl TemplateEngine for MarkdownEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        self.render_html(source, data, ctx.input_path, false)
    }
}

/// A render hook or container template from `_includes/hooks/` or
/// `_includes/containers/`.
pub(crate) struct HookTemplate {
    /// `_includes/hooks/heading.edge`, for errors.
    pub name: String,
    /// The engines it runs through (`.html` ones get `htmlEngine` first).
    pub engines: Vec<String>,
    pub body: String,
}

pub(crate) struct HookTemplates {
    /// Keyed by `hooks/heading`, `containers/note`, ...
    templates: HashMap<String, HookTemplate>,
    engines: Weak<Engines>,
}

/// Read `_includes/hooks/*` and `_includes/containers/*`. Each name can have
/// one template, in any engine.
pub(crate) fn load_hook_templates(includes_dir: &Path, includes_name: &str, engines: &Engines, chain: &dyn Fn(&str) -> Vec<String>) -> Result<HashMap<String, HookTemplate>> {
    let mut out: HashMap<String, HookTemplate> = HashMap::new();
    for kind in ["hooks", "containers"] {
        let Ok(entries) = std::fs::read_dir(includes_dir.join(kind)) else { continue };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file()).collect();
        paths.sort();
        for path in paths {
            let file = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            if file.starts_with('.') {
                continue;
            }
            let name = format!("{}/{}/{}", includes_name, kind, file);
            let (Some(stem), Some(ext)) = (path.file_stem(), path.extension()) else { continue };
            let ext = ext.to_string_lossy().to_ascii_lowercase();
            engines.get(&ext).with_context(|| name.clone())?;
            let key = format!("{}/{}", kind, stem.to_string_lossy());
            if let Some(other) = out.get(&key) {
                anyhow::bail!("{} and {} are both templates for `{}`; keep one", other.name, name, key);
            }
            let src = std::fs::read_to_string(&path).with_context(|| format!("reading {}", name))?;
            let (_, body) = crate::data::parse_front_matter(&src).with_context(|| name.clone())?;
            out.insert(key, HookTemplate { name, engines: chain(&ext), body: body.to_string() });
        }
    }
    Ok(out)
}

struct PageHooks<'a> {
    set: &'a HookTemplates,
    engines: &'a Arc<Engines>,
    data: &'a Value,
    input_path: &'a Path,
}

impl Hooks for PageHooks<'_> {
    fn has(&self, name: &str) -> bool {
        self.set.templates.contains_key(name)
    }

    fn render(&self, name: &str, key: &str, value: Value) -> Result<String> {
        let t = &self.set.templates[name];
        let mut data = self.data.as_object().cloned().unwrap_or_default();
        data.insert(key.to_string(), value);
        let data = Value::object(data);
        let mut text = t.body.clone();
        for engine in &t.engines {
            let key = format!("{}#{}", t.name, engine);
            let ctx = RenderContext { name: &t.name, input_path: self.input_path, cache_key: Some(&key) };
            text = self.engines.get(engine)?.render(&text, &data, &ctx).with_context(|| format!("rendering {}", t.name))?;
        }
        Ok(text)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The expected HTML is markdown-it 15's output for the same source
    /// (with `html: true`).
    #[test]
    fn void_tags_and_alt_text_match_markdown_it() {
        let src = "![Buy my shirts on\nAmazon!](/a.jpg \"T\")\n\nline one  \nline two\n\n---\n\n<img src=\"/raw.png\" />\n";
        let ctx = RenderContext { name: "test.md", input_path: Path::new("test.md"), cache_key: None };
        let html = MarkdownEngine::default().render(src, &Value::Undefined, &ctx).unwrap();
        assert_eq!(
            html,
            "<p><img src=\"/a.jpg\" alt=\"Buy my shirts on\nAmazon!\" title=\"T\"></p>\n<p>line one<br>\nline two</p>\n<hr>\n<img src=\"/raw.png\" />\n"
        );
    }

    #[test]
    fn table_alignment_matches_markdown_it() {
        let ctx = RenderContext { name: "test.md", input_path: Path::new("test.md"), cache_key: None };
        let html = MarkdownEngine::default().render("| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |\n", &Value::Undefined, &ctx).unwrap();
        assert!(html.contains("<th style=\"text-align:left\">a</th><th style=\"text-align:center\">b</th><th style=\"text-align:right\">c</th><th>d</th>"), "{}", html);
        assert!(html.contains("<td style=\"text-align:left\">1</td><td style=\"text-align:center\">2</td><td style=\"text-align:right\">3</td><td>4</td>"), "{}", html);
        assert_eq!(html.matches("<tr>").count(), 2, "{}", html);
    }

    #[test]
    fn double_quotes_are_escaped_in_text_and_code() {
        let ctx = RenderContext { name: "test.md", input_path: Path::new("test.md"), cache_key: None };
        let src = "Say \"hi\" & `x = \"<y>\"` ![a \"b\"](/i.png)\n\n```js\nlet s = \"q\";\n```\n\n<span title=\"raw\">\"raw\"</span>\n";
        let html = MarkdownEngine::default().render(src, &Value::Undefined, &ctx).unwrap();
        assert_eq!(
            html,
            "<p>Say &quot;hi&quot; &amp; <code>x = &quot;&lt;y&gt;&quot;</code> <img src=\"/i.png\" alt=\"a &quot;b&quot;\"></p>\n<pre><code class=\"language-js\">let s = &quot;q&quot;;\n</code></pre>\n<p><span title=\"raw\">&quot;raw&quot;</span></p>\n"
        );
    }
}
