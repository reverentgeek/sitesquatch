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
/// feature set as markdown-it with `html: true`.
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
        html::push_html(&mut out, html5_void_tags(events).into_iter());
        Ok(out)
    }
}

/// Write `<img ...>`, `<hr>` and `<br>` like markdown-it, instead of
/// pulldown-cmark's XHTML-style `<img ... />`, keep line breaks in alt text
/// (markdown-it does; pulldown-cmark turns them into spaces), and write table
/// alignment as `style="text-align:left"` (pulldown-cmark adds a space). Raw
/// HTML in the Markdown is left alone.
fn html5_void_tags<'a>(events: impl Iterator<Item = Event<'a>>) -> Vec<Event<'a>> {
    let mut out = Vec::new();
    let mut image: Option<(Vec<Event<'a>>, usize)> = None;
    let mut aligns: Vec<pulldown_cmark::Alignment> = Vec::new();
    let (mut in_head, mut column) = (false, 0usize);
    for e in events {
        if let Some((buf, depth)) = image.as_mut() {
            match e {
                Event::Start(Tag::Image { .. }) => *depth += 1,
                Event::End(TagEnd::Image) if *depth == 0 => {
                    buf.push(e);
                    let mut html = String::new();
                    html::push_html(&mut html, buf.drain(..));
                    let html = html.strip_suffix(" />").map(|h| format!("{}>", h)).unwrap_or(html);
                    out.push(Event::InlineHtml(html.into()));
                    image = None;
                    continue;
                }
                Event::End(TagEnd::Image) => *depth -= 1,
                Event::SoftBreak => {
                    buf.push(Event::Text("\n".into()));
                    continue;
                }
                _ => {}
            }
            buf.push(e);
            continue;
        }
        match e {
            Event::Start(Tag::Table(ref a)) => {
                aligns = a.clone();
                out.push(e);
            }
            Event::Start(Tag::TableHead) => {
                (in_head, column) = (true, 0);
                out.push(e);
            }
            Event::End(TagEnd::TableHead) => {
                in_head = false;
                out.push(e);
            }
            Event::Start(Tag::TableRow) => {
                column = 0;
                out.push(e);
            }
            Event::Start(Tag::TableCell) => {
                use pulldown_cmark::Alignment;
                let style = match aligns.get(column) {
                    Some(Alignment::Left) => " style=\"text-align:left\"",
                    Some(Alignment::Center) => " style=\"text-align:center\"",
                    Some(Alignment::Right) => " style=\"text-align:right\"",
                    _ => "",
                };
                out.push(Event::Html(format!("<{}{}>", if in_head { "th" } else { "td" }, style).into()));
            }
            Event::End(TagEnd::TableCell) => {
                column += 1;
                out.push(Event::Html(if in_head { "</th>" } else { "</td>" }.into()));
            }
            Event::Start(Tag::Image { .. }) => image = Some((vec![e], 0)),
            Event::Rule => out.push(Event::Html("<hr>\n".into())),
            Event::HardBreak => out.push(Event::InlineHtml("<br>\n".into())),
            other => out.push(other),
        }
    }
    out
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
}
