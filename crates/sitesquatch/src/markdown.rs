//! Markdown: CommonMark with GitHub's extensions (tables, strikethrough,
//! footnotes, task lists, autolinked URLs, alerts), heading IDs, `:::`
//! containers, and render hooks.
//!
//! Render hooks are templates, in any engine, that take over part of the
//! output: `_includes/hooks/heading.*`, `link.*`, `image.*`, `fence.*` (or
//! `fence-<lang>.*` for one language), `footnote-ref.*` and `footnotes.*`. A `::: name args` block renders
//! `_includes/containers/name.*` with the block's rendered body as `content`.
//! The renderer asks a [`Hooks`] implementation for them; without one (or
//! without the template), it writes plain HTML.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use anyhow::{bail, Result};
use pulldown_cmark::{html, Alignment, BlockQuoteKind, CodeBlockKind, Event, LinkType, Options, Parser, Tag, TagEnd, TextMergeStream};
use pulldown_cmark_escape::{escape_href, escape_html};
use regex::Regex;

use crate::{Map, Value};

/// How headings get automatic `id`s.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slugger {
    /// GitHub's: lowercase, spaces become `-`, punctuation is dropped
    /// (`Hello, World!` is `hello-world`, `A -- B` is `a----b`).
    Github,
    /// Hugo's older "blackfriday" style: runs of anything that isn't a letter
    /// or a digit become one `-` (`A -- B` is `a-b`).
    Blackfriday,
    /// ASCII only: letters are transliterated (`Ünïcödé` is `unicode`, `🦀`
    /// is `crab`), then like blackfriday. Zola's anchors look like this.
    Ascii,
}

impl Slugger {
    pub fn parse(name: &str) -> Option<Slugger> {
        match name {
            "github" => Some(Slugger::Github),
            "blackfriday" => Some(Slugger::Blackfriday),
            "ascii" => Some(Slugger::Ascii),
            _ => None,
        }
    }

    pub fn slug(self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        match self {
            Slugger::Github => {
                for c in text.chars() {
                    if c == ' ' {
                        out.push('-');
                    } else if c.is_alphanumeric() || c == '-' || c == '_' {
                        out.extend(c.to_lowercase());
                    }
                }
            }
            Slugger::Ascii => return Slugger::Blackfriday.slug(&deunicode::deunicode(text)),
            Slugger::Blackfriday => {
                let mut dash = false;
                for c in text.chars() {
                    if c.is_alphanumeric() {
                        if dash && !out.is_empty() {
                            out.push('-');
                        }
                        dash = false;
                        out.extend(c.to_lowercase());
                    } else {
                        dash = true;
                    }
                }
            }
        }
        out
    }
}

/// The `markdown` config key.
#[derive(Clone, Debug)]
pub struct MarkdownOptions {
    /// Automatic heading `id`s (GitHub style by default), or `None` for none.
    /// An explicit `{#id}` always wins.
    pub heading_ids: Option<Slugger>,
    /// `## Heading {#id .class key=value}`.
    pub heading_attributes: bool,
    /// `[^1]` references, with the notes collected at the end of the page.
    pub footnotes: bool,
    /// `- [ ]` and `- [x]` list items.
    pub task_lists: bool,
    /// Bare `https://` and `www.` URLs become links.
    pub autolinks: bool,
    /// GitHub's `> [!NOTE]` alerts (note, tip, important, warning, caution).
    pub alerts: bool,
    /// `::: name args` blocks.
    pub containers: bool,
    /// `Term` followed by `: definition` lines.
    pub definition_lists: bool,
    /// Curly quotes, dashes and ellipses.
    pub smart_punctuation: bool,
    /// Lines indented four spaces are code. Off, they're ordinary Markdown
    /// (handy for HTML indented inside Markdown); fences are still code.
    pub indented_code: bool,
    /// Highlight fenced code at build time (needs the `highlight` feature).
    pub highlight: bool,
    /// Where the build writes the highlighting stylesheet (a URL path like
    /// `/highlight.css`), or `None` to leave it out.
    pub highlight_css: Option<String>,
    /// A slugger of the site's own (`headingIds: text => id`), used instead
    /// of `heading_ids` when set. Repeats still get `-1`, `-2`.
    pub slugger_fn: Option<Value>,
}

impl Default for MarkdownOptions {
    fn default() -> Self {
        MarkdownOptions {
            heading_ids: Some(Slugger::Github),
            heading_attributes: true,
            footnotes: true,
            task_lists: true,
            autolinks: true,
            alerts: true,
            containers: true,
            definition_lists: false,
            smart_punctuation: false,
            indented_code: true,
            highlight: false,
            highlight_css: Some("/highlight.css".into()),
            slugger_fn: None,
        }
    }
}

impl MarkdownOptions {
    /// The option names in `ssqch.config.js` (`markdown: { headingIds: "blackfriday" }`).
    pub const KEYS: [&'static str; 11] =
        ["headingIds", "headingAttributes", "footnotes", "taskLists", "autolinks", "alerts", "containers", "definitionLists", "smartPunctuation", "indentedCode", "highlight"];

    /// Apply a `markdown` object from the config. Errors start with the key
    /// (`markdown.footnotes must be true or false`).
    pub fn apply(&mut self, value: &Value) -> Result<()> {
        let Some(obj) = value.as_object() else {
            bail!("markdown must be an object, not {}", value.type_of());
        };
        for (key, v) in obj.iter() {
            let flag = match key.as_str() {
                "headingIds" => {
                    self.heading_ids = match v {
                        Value::Bool(false) | Value::Null => None,
                        Value::Bool(true) => Some(Slugger::Github),
                        Value::Str(s) => Some(Slugger::parse(s).ok_or_else(|| anyhow::anyhow!("markdown.headingIds: unknown slugger \"{}\" (use \"github\", \"blackfriday\", \"ascii\" or false)", s))?),
                        other => bail!("markdown.headingIds must be \"github\", \"blackfriday\", \"ascii\" or false, not {}", other.type_of()),
                    };
                    continue;
                }
                "highlight" => {
                    match v {
                        Value::Bool(b) => self.highlight = *b,
                        Value::Obj(o) => {
                            self.highlight = true;
                            for (k, css) in o.iter() {
                                match (k.as_str(), css) {
                                    ("css", Value::Bool(false) | Value::Null) => self.highlight_css = None,
                                    ("css", Value::Str(s)) if s.starts_with('/') && !s.contains("..") => self.highlight_css = Some(s.to_string()),
                                    ("css", other) => bail!("markdown.highlight.css must be a path like \"/assets/highlight.css\", or false, not {}", if let Value::Str(s) = other { format!("\"{}\"", s) } else { other.type_of().to_string() }),
                                    (other, _) => bail!("markdown.highlight.{} isn't an option (options: css)", other),
                                }
                            }
                        }
                        other => bail!("markdown.highlight must be true, false or {{ css }}, not {}", other.type_of()),
                    }
                    if self.highlight && !cfg!(feature = "highlight") {
                        bail!("markdown.highlight: this ssqch was built without the `highlight` feature");
                    }
                    continue;
                }
                "headingAttributes" => &mut self.heading_attributes,
                "footnotes" => &mut self.footnotes,
                "taskLists" => &mut self.task_lists,
                "autolinks" => &mut self.autolinks,
                "alerts" => &mut self.alerts,
                "containers" => &mut self.containers,
                "definitionLists" => &mut self.definition_lists,
                "smartPunctuation" => &mut self.smart_punctuation,
                "indentedCode" => &mut self.indented_code,
                other => bail!("markdown.{} isn't an option{} (options: {})", other, crate::suggest::closest(other, Self::KEYS.iter().copied()).map(|name| format!(" (did you mean `{}`?)", name)).unwrap_or_default(), Self::KEYS.join(", ")),
            };
            match v {
                Value::Bool(b) => *flag = *b,
                other => bail!("markdown.{} must be true or false, not {}", key, other.type_of()),
            }
        }
        Ok(())
    }

    fn parser_options(&self) -> Options {
        // SUBSCRIPT makes single `~` its own construct so only `~~` strikes
        // through; it's turned back into literal tildes below.
        let mut o = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_SUBSCRIPT;
        for (on, flag) in [
            (self.heading_attributes, Options::ENABLE_HEADING_ATTRIBUTES),
            (self.footnotes, Options::ENABLE_FOOTNOTES),
            (self.task_lists, Options::ENABLE_TASKLISTS),
            (self.alerts, Options::ENABLE_GFM),
            (self.definition_lists, Options::ENABLE_DEFINITION_LIST),
            (self.smart_punctuation, Options::ENABLE_SMART_PUNCTUATION),
        ] {
            if on {
                o |= flag;
            }
        }
        o
    }
}

/// Templates that take over parts of the output. Names are paths in
/// `_includes` without the extension: `hooks/heading`, `hooks/fence-mermaid`,
/// `containers/note`.
pub trait Hooks {
    fn has(&self, name: &str) -> bool;
    /// Render template `name`, with `value` in its data as `key` (`heading`,
    /// `link`, `image`, `fence`, `footnote`, `footnotes` or `container`).
    fn render(&self, name: &str, key: &str, value: Value) -> Result<String>;
}

static CURRENT: std::sync::RwLock<Option<MarkdownOptions>> = std::sync::RwLock::new(None);

/// Record the options of the build that's running, for [`render_current`].
pub(crate) fn set_current(options: MarkdownOptions) {
    *CURRENT.write().unwrap() = Some(options);
}

/// Render with the options of the latest build (or the defaults, before the
/// first one), without hooks: for code outside templates, like `markdown()`
/// from `ssqch` in a config.
pub fn render_current(source: &str, inline: bool) -> Result<String> {
    let options = CURRENT.read().unwrap().clone().unwrap_or_default();
    if inline {
        render_inline(source, &options, None)
    } else {
        render(source, &options, None)
    }
}

/// Render Markdown to HTML.
pub fn render(source: &str, opts: &MarkdownOptions, hooks: Option<&dyn Hooks>) -> Result<String> {
    let mut containers = Vec::new();
    let source = if opts.containers { mark_containers(source, &mut containers) } else { Cow::Borrowed(source) };
    let mut events: Vec<Event> = TextMergeStream::new(Parser::new_ext(&source, opts.parser_options()))
        .map(|e| match e {
            Event::Start(Tag::Subscript) | Event::End(TagEnd::Subscript) => Event::Text("~".into()),
            other => other,
        })
        .collect();
    if opts.smart_punctuation {
        keep_flags(&mut events);
    }
    if let Some(f) = &opts.slugger_fn {
        assign_heading_ids(&mut events, |text| match f {
            Value::Func(f) => Ok(f.call(&[Value::from(text)]).map_err(|e| e.context("markdown.headingIds"))?.to_js_string()),
            _ => Ok(String::new()),
        })?;
    } else if let Some(slugger) = opts.heading_ids {
        assign_heading_ids(&mut events, |text| Ok(slugger.slug(text)))?;
    }
    if opts.autolinks {
        events = autolink(events);
    }
    let defined = events
        .iter()
        .filter_map(|e| match e {
            Event::Start(Tag::FootnoteDefinition(label)) => Some(label.to_string()),
            _ => None,
        })
        .collect();
    let mut w = Writer { hooks, containers: &containers, defined, highlight: opts.highlight, opts: Some(opts), ..Default::default() };
    let mut out = String::with_capacity(source.len() * 3 / 2);
    w.write(&events, &mut out)?;
    w.write_footnotes(&mut out)?;
    Ok(out)
}

/// Render Markdown, and for one paragraph, drop the `<p>` around it (for a
/// title or a caption).
pub fn render_inline(source: &str, opts: &MarkdownOptions, hooks: Option<&dyn Hooks>) -> Result<String> {
    let html = render(source, opts, hooks)?;
    let inner = html.strip_prefix("<p>").and_then(|h| h.strip_suffix("</p>\n"));
    Ok(match inner {
        Some(inner) if !inner.contains("<p>") && !inner.contains("</p>") => inner.to_string(),
        _ => html,
    })
}

/// With smart punctuation, `--` is an en dash, which is wrong for a
/// command-line flag in running text (`run it with --fix`). A dash that
/// follows a space and runs straight into a word goes back to `--` (and
/// `---` to itself), as markdown-it's typographer leaves them.
fn keep_flags(events: &mut [Event]) {
    for event in events.iter_mut() {
        let Event::Text(text) = event else { continue };
        if !text.contains(['\u{2013}', '\u{2014}']) {
            continue;
        }
        let chars: Vec<char> = text.chars().collect();
        let mut out = String::with_capacity(text.len() + 4);
        for (i, &c) in chars.iter().enumerate() {
            let dash = c == '\u{2013}' || c == '\u{2014}';
            let after_space = i == 0 || chars[i - 1].is_whitespace();
            let before_word = chars.get(i + 1).is_some_and(|n| n.is_alphanumeric());
            // At the very start of the text there's no telling what came before, so only a space counts.
            if dash && i > 0 && after_space && before_word {
                out.push_str(if c == '\u{2013}' { "--" } else { "---" });
            } else {
                out.push(c);
            }
        }
        *text = out.into();
    }
}

// ------------------------------------------------------------- heading IDs

fn assign_heading_ids(events: &mut [Event], slug: impl Fn(&str) -> Result<String>) -> Result<()> {
    let mut used: HashSet<String> = events
        .iter()
        .filter_map(|e| match e {
            Event::Start(Tag::Heading { id: Some(id), .. }) => Some(id.to_string()),
            _ => None,
        })
        .collect();
    let mut i = 0;
    while i < events.len() {
        if let Event::Start(Tag::Heading { id: None, .. }) = &events[i] {
            let end = matching(events, i);
            let mut base = slug(&plain_text(&events[i + 1..end]))?;
            if base.is_empty() {
                base = "section".into();
            }
            let id = unique(&mut used, base);
            if let Event::Start(Tag::Heading { id: slot, .. }) = &mut events[i] {
                *slot = Some(id.into());
            }
            i = end;
        }
        i += 1;
    }
    Ok(())
}

/// `base`, or `base-1`, `base-2`, ... if it's taken.
fn unique(used: &mut HashSet<String>, base: String) -> String {
    if used.insert(base.clone()) {
        return base;
    }
    (1..).map(|n| format!("{}-{}", base, n)).find(|id| used.insert(id.clone())).unwrap()
}

/// The index of the `End` event matching the `Start` at `start`.
fn matching(events: &[Event], start: usize) -> usize {
    let mut depth = 0usize;
    for (j, e) in events[start..].iter().enumerate() {
        match e {
            Event::Start(_) => depth += 1,
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    return start + j;
                }
            }
            _ => {}
        }
    }
    events.len() - 1
}

/// The text of some inline events, without markup.
fn plain_text(events: &[Event]) -> String {
    let mut s = String::new();
    for e in events {
        match e {
            Event::Text(t) | Event::Code(t) => s.push_str(t),
            Event::SoftBreak | Event::HardBreak => s.push(' '),
            _ => {}
        }
    }
    s
}

// --------------------------------------------------------------- autolinks

static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:https?://|www\.)[A-Za-z0-9][^\s<>]*").unwrap());

/// Turn bare URLs in text into links, as GitHub does: trailing punctuation
/// and an unbalanced `)` stay out of the link.
fn autolink(events: Vec<Event>) -> Vec<Event> {
    let mut out = Vec::with_capacity(events.len());
    let (mut in_link, mut in_html_link) = (0usize, 0usize);
    for e in events {
        match &e {
            Event::Start(Tag::Link { .. } | Tag::Image { .. } | Tag::CodeBlock(_)) => in_link += 1,
            Event::End(TagEnd::Link | TagEnd::Image | TagEnd::CodeBlock) => in_link = in_link.saturating_sub(1),
            Event::InlineHtml(h) | Event::Html(h) => {
                let lower = h.to_ascii_lowercase();
                if lower.starts_with("<a ") || lower.starts_with("<a>") {
                    in_html_link += 1;
                } else if lower.starts_with("</a") {
                    in_html_link = in_html_link.saturating_sub(1);
                }
            }
            Event::Text(t) if in_link == 0 && in_html_link == 0 && (t.contains("http") || t.contains("www.")) => {
                let text = t.to_string();
                let mut last = 0;
                for m in URL.find_iter(&text) {
                    let before = text[..m.start()].chars().next_back();
                    if before.is_some_and(|c| !(c.is_whitespace() || "*_~(".contains(c))) {
                        continue;
                    }
                    let url = trim_url(m.as_str());
                    if url.is_empty() || !url.contains('.') {
                        continue;
                    }
                    if m.start() > last {
                        out.push(Event::Text(text[last..m.start()].to_string().into()));
                    }
                    let href = if url.starts_with("www.") { format!("http://{}", url) } else { url.to_string() };
                    out.push(Event::Start(Tag::Link { link_type: LinkType::Autolink, dest_url: href.into(), title: "".into(), id: "".into() }));
                    out.push(Event::Text(url.to_string().into()));
                    out.push(Event::End(TagEnd::Link));
                    last = m.start() + url.len();
                }
                if last > 0 {
                    if last < text.len() {
                        out.push(Event::Text(text[last..].to_string().into()));
                    }
                    continue;
                }
            }
            _ => {}
        }
        out.push(e);
    }
    out
}

fn trim_url(mut url: &str) -> &str {
    loop {
        let before = url;
        url = url.trim_end_matches(['?', '!', '.', ',', ':', '*', '_', '~', '\'', '"', ';']);
        if url.ends_with(')') && url.matches(')').count() > url.matches('(').count() {
            url = &url[..url.len() - 1];
        }
        if url == before {
            return url;
        }
    }
}

// -------------------------------------------------------------- containers

/// A `::: name args` block, found before parsing.
struct Container {
    name: String,
    args: String,
    line: usize,
    /// The lines between the markers, as written.
    source: String,
}

const OPEN: &str = "<!--ssqch:container:open:";
const CLOSE: &str = "<!--ssqch:container:close:";

/// Replace `::: name args` and `:::` lines (outside fenced code) with HTML
/// comments, so the parser sees them as block boundaries and the writer can
/// find them. A container closes with a line of at least as many colons as
/// it opened with; one left open closes at the end.
fn mark_containers<'a>(source: &'a str, found: &mut Vec<Container>) -> Cow<'a, str> {
    if !source.contains(":::") {
        return Cow::Borrowed(source);
    }
    let mut out = String::with_capacity(source.len() + 64);
    let mut stack: Vec<(usize, usize)> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for (n, line) in source.split_inclusive('\n').enumerate() {
        let trimmed = line.trim_start();
        let indent = &line[..line.len() - trimmed.len()];
        let body = trimmed.trim_end();
        // Every open container's source gets the line (its own markers aside).
        let keep = |found: &mut Vec<Container>, stack: &[(usize, usize)]| {
            for &(id, _) in stack {
                found[id].source.push_str(line);
            }
        };
        if let Some((ch, len)) = fence {
            if body.len() >= len && body.chars().all(|c| c == ch) {
                fence = None;
            }
            keep(found, &stack);
            out.push_str(line);
            continue;
        }
        let fence_char = body.chars().next().filter(|c| *c == '`' || *c == '~');
        if let Some(ch) = fence_char {
            let len = body.chars().take_while(|c| *c == ch).count();
            if len >= 3 && !(ch == '`' && body[len..].contains('`')) {
                fence = Some((ch, len));
                keep(found, &stack);
                out.push_str(line);
                continue;
            }
        }
        if body.starts_with(":::") {
            let colons = body.chars().take_while(|c| *c == ':').count();
            let rest = body[colons..].trim();
            if rest.is_empty() {
                if let Some(&(id, opened)) = stack.last() {
                    if colons >= opened {
                        stack.pop();
                        keep(found, &stack);
                        out.push_str(&format!("{}{}{}-->\n", indent, CLOSE, id));
                        continue;
                    }
                }
            } else if rest.starts_with(|c: char| c.is_ascii_alphabetic()) {
                let name_len = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_')).unwrap_or(rest.len());
                keep(found, &stack);
                let id = found.len();
                // `:::tip[A title]` (Docusaurus' spelling) has the args `A title`.
                let args = rest[name_len..].trim();
                let args = args.strip_prefix('[').and_then(|a| a.strip_suffix(']')).unwrap_or(args);
                found.push(Container { name: rest[..name_len].to_string(), args: args.trim().to_string(), line: n + 1, source: String::new() });
                stack.push((id, colons));
                out.push_str(&format!("{}{}{}-->\n", indent, OPEN, id));
                continue;
            }
        }
        keep(found, &stack);
        out.push_str(line);
    }
    if found.is_empty() {
        return Cow::Borrowed(source);
    }
    while let Some((id, _)) = stack.pop() {
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&format!("{}{}-->\n", CLOSE, id));
    }
    Cow::Owned(out)
}

/// The container id if `events[i..]` is an HTML block holding just a marker.
fn marker(events: &[Event], i: usize, prefix: &str) -> Option<usize> {
    match (events.get(i), events.get(i + 1), events.get(i + 2)) {
        (Some(Event::Start(Tag::HtmlBlock)), Some(Event::Html(h)), Some(Event::End(TagEnd::HtmlBlock))) => {
            h.trim().strip_prefix(prefix)?.strip_suffix("-->")?.parse().ok()
        }
        _ => None,
    }
}

// ------------------------------------------------------------------ writer

#[derive(Default)]
struct Writer<'h, 'c> {
    hooks: Option<&'h dyn Hooks>,
    containers: &'c [Container],
    highlight: bool,
    /// For `indented_code: false`, which renders the lines again as Markdown.
    opts: Option<&'c MarkdownOptions>,
    /// Footnote labels with a definition.
    defined: HashSet<String>,
    /// Footnote labels in order of first reference, and how often each was referenced.
    refs: Vec<(String, usize)>,
    notes: HashMap<String, String>,
    aligns: Vec<Alignment>,
    in_head: bool,
    column: usize,
}

impl Writer<'_, '_> {
    fn has(&self, name: &str) -> bool {
        self.hooks.is_some_and(|h| h.has(name))
    }

    fn hook(&self, name: &str, key: &str, value: Value) -> Result<String> {
        self.hooks.expect("checked with has()").render(name, key, value)
    }

    fn inner(&mut self, events: &[Event]) -> Result<String> {
        let mut s = String::new();
        self.write(events, &mut s)?;
        Ok(s)
    }

    fn write<'a>(&mut self, events: &[Event<'a>], out: &mut String) -> Result<()> {
        let mut plain: Vec<Event<'a>> = Vec::new();
        let flush = |plain: &mut Vec<Event<'a>>, out: &mut String| html::push_html(out, plain.drain(..));
        let mut i = 0;
        while i < events.len() {
            match &events[i] {
                Event::Start(Tag::Heading { level, id, classes, attrs }) if self.has("hooks/heading") => {
                    let end = matching(events, i);
                    flush(&mut plain, out);
                    let mut attr_map = Map::new();
                    if !classes.is_empty() {
                        attr_map.insert("class".into(), Value::from(classes.join(" ")));
                    }
                    for (k, v) in attrs {
                        attr_map.insert(k.to_string(), v.as_ref().map(|v| Value::from(v.to_string())).unwrap_or(Value::Bool(true)));
                    }
                    let heading = Value::from_pairs([
                        ("level", Value::Num(*level as usize as f64)),
                        ("id", id.as_ref().map(|id| Value::from(id.to_string())).unwrap_or_default()),
                        ("text", Value::from(plain_text(&events[i + 1..end]))),
                        ("content", Value::from(self.inner(&events[i + 1..end])?)),
                        ("attrs", Value::object(attr_map)),
                    ]);
                    block(out, &self.hook("hooks/heading", "heading", heading)?);
                    i = end + 1;
                    continue;
                }
                Event::Start(Tag::Link { link_type, dest_url, title, .. }) if self.has("hooks/link") => {
                    let end = matching(events, i);
                    flush(&mut plain, out);
                    // `<squatch@example.com>` links to `mailto:squatch@example.com`.
                    let href = if *link_type == LinkType::Email { format!("mailto:{}", dest_url) } else { dest_url.to_string() };
                    let link = Value::from_pairs([
                        ("href", Value::from(href)),
                        ("title", Value::from(title.to_string())),
                        ("text", Value::from(plain_text(&events[i + 1..end]))),
                        ("content", Value::from(self.inner(&events[i + 1..end])?)),
                    ]);
                    out.push_str(self.hook("hooks/link", "link", link)?.trim_end());
                    i = end + 1;
                    continue;
                }
                Event::Start(Tag::Image { dest_url, title, .. }) => {
                    let end = matching(events, i);
                    flush(&mut plain, out);
                    // Line breaks stay in alt text (pulldown-cmark makes them spaces).
                    let alt: String = events[i + 1..end]
                        .iter()
                        .map(|e| match e {
                            Event::Text(t) | Event::Code(t) => t.as_ref(),
                            Event::SoftBreak | Event::HardBreak => "\n",
                            _ => "",
                        })
                        .collect();
                    if self.has("hooks/image") {
                        let image = Value::from_pairs([("src", Value::from(dest_url.to_string())), ("alt", Value::from(alt)), ("title", Value::from(title.to_string()))]);
                        out.push_str(self.hook("hooks/image", "image", image)?.trim_end());
                    } else {
                        out.push_str("<img src=\"");
                        escape_href(&mut *out, dest_url).ok();
                        out.push_str("\" alt=\"");
                        escape_html(&mut *out, &alt).ok();
                        out.push('"');
                        if !title.is_empty() {
                            out.push_str(" title=\"");
                            escape_html(&mut *out, title).ok();
                            out.push('"');
                        }
                        out.push('>');
                    }
                    i = end + 1;
                    continue;
                }
                Event::Start(Tag::CodeBlock(CodeBlockKind::Indented)) if self.opts.is_some_and(|o| !o.indented_code) => {
                    // The parser has taken four spaces off each line; what's left is Markdown.
                    let end = matching(events, i);
                    flush(&mut plain, out);
                    let text: String = events[i + 1..end].iter().map(|e| if let Event::Text(t) = e { t.as_ref() } else { "" }).collect();
                    out.push_str(&render(&text, self.opts.unwrap(), self.hooks)?);
                    i = end + 1;
                    continue;
                }
                Event::Start(Tag::CodeBlock(kind)) => {
                    let end = matching(events, i);
                    flush(&mut plain, out);
                    let code: String = events[i + 1..end].iter().map(|e| if let Event::Text(t) = e { t.as_ref() } else { "" }).collect();
                    let info = match kind {
                        CodeBlockKind::Fenced(info) => info.trim().to_string(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    self.fence(&info, &code, out)?;
                    i = end + 1;
                    continue;
                }
                Event::Start(Tag::BlockQuote(Some(kind))) => {
                    let end = matching(events, i);
                    flush(&mut plain, out);
                    let content = self.inner(&events[i + 1..end])?;
                    let name = match kind {
                        BlockQuoteKind::Note => "note",
                        BlockQuoteKind::Tip => "tip",
                        BlockQuoteKind::Important => "important",
                        BlockQuoteKind::Warning => "warning",
                        BlockQuoteKind::Caution => "caution",
                    };
                    if self.has(&format!("containers/{}", name)) {
                        self.container(name, "", content, "", out)?;
                    } else {
                        let title = format!("{}{}", name[..1].to_ascii_uppercase(), &name[1..]);
                        out.push_str(&format!("<div class=\"markdown-alert markdown-alert-{}\">\n<p class=\"markdown-alert-title\">{}</p>\n{}</div>\n", name, title, content));
                    }
                    i = end + 1;
                    continue;
                }
                Event::Start(Tag::HtmlBlock) if marker(events, i, OPEN).is_some() => {
                    let id = marker(events, i, OPEN).unwrap();
                    let c = &self.containers[id];
                    let (mut depth, mut j) = (0i64, i + 3);
                    while j < events.len() {
                        if depth == 0 && marker(events, j, CLOSE) == Some(id) {
                            break;
                        }
                        match &events[j] {
                            Event::Start(_) => depth += 1,
                            Event::End(_) => depth -= 1,
                            _ => {}
                        }
                        if depth < 0 {
                            break;
                        }
                        j += 1;
                    }
                    if j >= events.len() || depth != 0 {
                        bail!("line {}: container `{}` has to close (with `:::`) inside the block it opened in, such as the same list item", c.line, c.name);
                    }
                    flush(&mut plain, out);
                    let (name, args, source) = (c.name.clone(), c.args.clone(), c.source.clone());
                    let content = self.inner(&events[i + 3..j])?;
                    self.container(&name, &args, content, &source, out)?;
                    i = j + 3;
                    continue;
                }
                Event::Start(Tag::HtmlBlock) if marker(events, i, CLOSE).is_some() => {
                    // A stray close (its container was opened inside other markup).
                    i += 3;
                    continue;
                }
                Event::Start(Tag::FootnoteDefinition(label)) => {
                    let end = matching(events, i);
                    let html = self.inner(&events[i + 1..end])?;
                    self.notes.insert(label.to_string(), html);
                    i = end + 1;
                    continue;
                }
                Event::FootnoteReference(label) if self.defined.contains(label.as_ref()) => {
                    let n = match self.refs.iter().position(|(l, _)| l == label.as_ref()) {
                        Some(n) => n,
                        None => {
                            self.refs.push((label.to_string(), 0));
                            self.refs.len() - 1
                        }
                    };
                    self.refs[n].1 += 1;
                    let slug = footnote_slug(label);
                    let suffix = if self.refs[n].1 > 1 { format!("-{}", self.refs[n].1) } else { String::new() };
                    if self.has("hooks/footnote-ref") {
                        let footnote = Value::from_pairs([
                            ("number", Value::from(n + 1)),
                            ("label", Value::from(label.as_ref())),
                            ("id", Value::from(format!("fn-{}", slug))),
                            ("refId", Value::from(format!("fnref-{}{}", slug, suffix))),
                            ("index", Value::from(self.refs[n].1)),
                        ]);
                        let html = self.hook("hooks/footnote-ref", "footnote", footnote)?;
                        plain.push(Event::InlineHtml(html.trim().to_string().into()));
                        i += 1;
                        continue;
                    }
                    plain.push(Event::InlineHtml(format!("<sup class=\"footnote-ref\"><a href=\"#fn-{0}\" id=\"fnref-{0}{1}\">{2}</a></sup>", slug, suffix, n + 1).into()));
                }
                Event::FootnoteReference(label) => plain.push(Event::Text(format!("[^{}]", label).into())),
                Event::Start(Tag::Item) if matches!(events.get(i + 1), Some(Event::TaskListMarker(_))) => {
                    plain.push(Event::Html("<li class=\"task-list-item\">".into()));
                }
                Event::TaskListMarker(checked) => {
                    plain.push(Event::InlineHtml(if *checked { "<input type=\"checkbox\" disabled checked> " } else { "<input type=\"checkbox\" disabled> " }.into()));
                }
                Event::Start(Tag::Strikethrough) => plain.push(Event::InlineHtml("<s>".into())),
                Event::End(TagEnd::Strikethrough) => plain.push(Event::InlineHtml("</s>".into())),
                Event::Start(Tag::Table(a)) => {
                    self.aligns = a.clone();
                    plain.push(events[i].clone());
                }
                Event::Start(Tag::TableHead) => {
                    (self.in_head, self.column) = (true, 0);
                    plain.push(events[i].clone());
                }
                Event::End(TagEnd::TableHead) => {
                    self.in_head = false;
                    plain.push(events[i].clone());
                }
                Event::Start(Tag::TableRow) => {
                    self.column = 0;
                    plain.push(events[i].clone());
                }
                Event::Start(Tag::TableCell) => {
                    let style = match self.aligns.get(self.column) {
                        Some(Alignment::Left) => " style=\"text-align:left\"",
                        Some(Alignment::Center) => " style=\"text-align:center\"",
                        Some(Alignment::Right) => " style=\"text-align:right\"",
                        _ => "",
                    };
                    plain.push(Event::Html(format!("<{}{}>", if self.in_head { "th" } else { "td" }, style).into()));
                }
                Event::End(TagEnd::TableCell) => {
                    self.column += 1;
                    plain.push(Event::Html(if self.in_head { "</th>" } else { "</td>" }.into()));
                }
                Event::Rule => plain.push(Event::Html("<hr>\n".into())),
                Event::HardBreak => plain.push(Event::InlineHtml("<br>\n".into())),
                // pulldown-cmark leaves `"` as it is in text; escape it, as the
                // CommonMark reference renderer does.
                Event::Text(t) if t.contains('"') => plain.push(Event::InlineHtml(escape_text(t).into())),
                Event::Code(t) if t.contains('"') => plain.push(Event::InlineHtml(format!("<code>{}</code>", escape_text(t)).into())),
                other => plain.push(other.clone()),
            }
            i += 1;
        }
        flush(&mut plain, out);
        Ok(())
    }

    fn fence(&mut self, info: &str, code: &str, out: &mut String) -> Result<()> {
        let lang = info.split(|c: char| c.is_whitespace() || c == '{' || c == ',').next().unwrap_or("");
        let highlighted = if self.highlight { highlight_code(lang, code, info) } else { None };
        let specific = format!("hooks/fence-{}", lang);
        let hook = if !lang.is_empty() && self.has(&specific) {
            Some(specific)
        } else {
            Some("hooks/fence".to_string()).filter(|name| self.has(name))
        };
        if let Some(name) = hook {
            let mut fence = vec![("lang", Value::from(lang)), ("info", Value::from(info)), ("code", Value::from(code))];
            if let Some(h) = &highlighted {
                fence.push(("highlighted", Value::from(h.as_str())));
            }
            block(out, &self.hook(&name, "fence", Value::from_pairs(fence))?);
            return Ok(());
        }
        out.push_str(if highlighted.is_some() { "<pre class=\"highlight\"><code" } else { "<pre><code" });
        if !lang.is_empty() {
            out.push_str(" class=\"language-");
            escape_html(&mut *out, lang).ok();
            out.push('"');
        }
        out.push('>');
        match &highlighted {
            Some(h) => out.push_str(h),
            None => out.push_str(&escape_text(code)),
        }
        out.push_str("</code></pre>\n");
        Ok(())
    }

    fn container(&mut self, name: &str, args: &str, content: String, source: &str, out: &mut String) -> Result<()> {
        let template = format!("containers/{}", name);
        if self.has(&template) {
            let value = Value::from_pairs([("name", Value::from(name)), ("args", Value::from(args)), ("content", Value::from(content)), ("source", Value::from(source))]);
            block(out, &self.hook(&template, "container", value)?);
            return Ok(());
        }
        out.push_str("<div class=\"");
        escape_html(&mut *out, name).ok();
        out.push_str("\">\n");
        if !args.is_empty() {
            out.push_str("<p class=\"container-title\">");
            escape_html(&mut *out, args).ok();
            out.push_str("</p>\n");
        }
        out.push_str(&content);
        out.push_str("</div>\n");
        Ok(())
    }

    /// The notes, in the order they were first referenced, each with links
    /// back to its references.
    fn write_footnotes(&mut self, out: &mut String) -> Result<()> {
        if self.refs.is_empty() {
            return Ok(());
        }
        // A `footnotes` hook renders the whole section its own way.
        if self.has("hooks/footnotes") {
            let notes: Vec<Value> = self
                .refs
                .iter()
                .enumerate()
                .map(|(n, (label, count))| {
                    let slug = footnote_slug(label);
                    let refs = (1..=*count).map(|k| Value::from(if k > 1 { format!("fnref-{}-{}", slug, k) } else { format!("fnref-{}", slug) })).collect();
                    Value::from_pairs([
                        ("number", Value::from(n + 1)),
                        ("label", Value::from(label.as_str())),
                        ("id", Value::from(format!("fn-{}", slug))),
                        ("content", Value::from(self.notes.get(label).map(String::as_str).unwrap_or(""))),
                        ("refs", Value::array(refs)),
                    ])
                })
                .collect();
            block(out, &self.hook("hooks/footnotes", "footnotes", Value::array(notes))?);
            return Ok(());
        }
        out.push_str("<section class=\"footnotes\">\n<ol>\n");
        for (n, (label, count)) in self.refs.iter().enumerate() {
            let slug = footnote_slug(label);
            let backrefs: String = (1..=*count)
                .map(|k| {
                    let (suffix, sup) = if k > 1 { (format!("-{}", k), format!("<sup>{}</sup>", k)) } else { (String::new(), String::new()) };
                    format!(" <a href=\"#fnref-{}{}\" class=\"footnote-backref\" aria-label=\"Back to reference {}\">↩{}</a>", slug, suffix, n + 1, sup)
                })
                .collect();
            let note = self.notes.get(label).map(String::as_str).unwrap_or("");
            let note = match note.strip_suffix("</p>\n") {
                Some(body) => format!("{}{}</p>\n", body, backrefs),
                None => format!("{}<p>{}</p>\n", note, backrefs.trim_start()),
            };
            out.push_str(&format!("<li id=\"fn-{}\">\n{}</li>\n", slug, note));
        }
        out.push_str("</ol>\n</section>\n");
        Ok(())
    }
}

#[cfg(feature = "highlight")]
fn highlight_code(lang: &str, code: &str, info: &str) -> Option<String> {
    crate::highlight::highlight(lang, code, &crate::highlight::marked_lines(info))
}

#[cfg(not(feature = "highlight"))]
fn highlight_code(_lang: &str, _code: &str, _info: &str) -> Option<String> {
    None
}

/// A block-level hook's output, on its own line.
fn block(out: &mut String, html: &str) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(html.trim());
    out.push('\n');
}

fn footnote_slug(label: &str) -> String {
    let mut s = String::with_capacity(label.len());
    for c in label.chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            s.extend(c.to_lowercase());
        } else if !s.ends_with('-') {
            s.push('-');
        }
    }
    s
}

/// Escape text for HTML: `&`, `<`, `>` and `"`.
pub(crate) fn escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 16);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

// ---------------------------------------------------------------- headings

/// A heading found in a page's HTML, for `page.headings`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Heading {
    pub level: u8,
    pub id: Option<String>,
    /// The heading's text, without tags and without anything inside an
    /// `aria-hidden="true"` element (such as an anchor link's `#`).
    pub text: String,
}

impl Heading {
    pub fn to_value(&self) -> Value {
        Value::from_pairs([("level", Value::Num(self.level as f64)), ("id", self.id.clone().map(Value::from).unwrap_or_default()), ("text", Value::from(self.text.as_str()))])
    }

    fn from_value(v: &Value) -> Option<Heading> {
        Some(Heading {
            level: v.get("level").as_f64()? as u8,
            id: v.get("id").as_str().filter(|s| !s.is_empty()).map(String::from),
            text: v.get("text").to_js_string(),
        })
    }
}

static HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<h([1-6])(\s[^>]*)?>(.*?)</h[1-6]\s*>").unwrap());
static ID_ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#).unwrap());
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<(/?)([A-Za-z][A-Za-z0-9-]*)([^>]*)>|<!--.*?-->").unwrap());
static HIDDEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\saria-hidden\s*=\s*["']?true"#).unwrap());

/// The `<h1>` to `<h6>` headings in some HTML, in order.
pub fn headings(html: &str) -> Vec<Heading> {
    if !html.contains("<h") && !html.contains("<H") {
        return Vec::new();
    }
    let without_code = strip_code(html);
    HEADING
        .captures_iter(&without_code)
        .map(|c| {
            let attrs = c.get(2).map(|m| m.as_str()).unwrap_or("");
            let id = ID_ATTR.captures(attrs).and_then(|a| a.get(1).or(a.get(2)).or(a.get(3))).map(|m| decode_entities(m.as_str()));
            Heading { level: c[1].parse().unwrap(), id, text: html_text(&c[3]) }
        })
        .collect()
}

/// Blank out `<pre>`, `<code>`, `<script>`, `<style>`, `<template>` and
/// comments, so headings shown as code don't count.
fn strip_code(html: &str) -> Cow<'_, str> {
    static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<!--.*?-->|<(pre|code|script|style|template|textarea)\b.*?</(?:pre|code|script|style|template|textarea)\s*>").unwrap());
    CODE.replace_all(html, "")
}

const VOID: [&str; 14] = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];

/// The text of some HTML: tags removed, entities decoded, whitespace
/// collapsed, and `aria-hidden="true"` elements left out.
pub(crate) fn html_text(html: &str) -> String {
    let mut text = String::new();
    let mut hidden = 0usize;
    let mut last = 0;
    for m in TAG.captures_iter(html) {
        let whole = m.get(0).unwrap();
        if hidden == 0 {
            text.push_str(&html[last..whole.start()]);
        }
        last = whole.end();
        let Some(name) = m.get(2) else { continue };
        let name = name.as_str().to_ascii_lowercase();
        let attrs = m.get(3).map(|a| a.as_str()).unwrap_or("");
        if VOID.contains(&name.as_str()) || attrs.ends_with('/') {
            if name == "br" && hidden == 0 {
                text.push(' ');
            }
            continue;
        }
        if &m[1] == "/" {
            hidden = hidden.saturating_sub(1);
        } else if hidden > 0 || HIDDEN.is_match(attrs) {
            hidden += 1;
        }
    }
    if hidden == 0 {
        text.push_str(&html[last..]);
    }
    decode_entities(&text).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Decode the entities Markdown and templates write: `&amp;`, `&lt;`,
/// `&gt;`, `&quot;`, `&#39;`, `&apos;`, `&nbsp;` and numeric ones.
fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    static ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z]+);").unwrap());
    ENTITY
        .replace_all(s, |c: &regex::Captures| {
            let name = &c[1];
            let decoded = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
                _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            decoded.map(String::from).unwrap_or_else(|| c[0].to_string())
        })
        .into_owned()
}

/// A nested list of links to the headings with an `id` from level `from` to
/// `to`, for the `toc` filter.
pub fn toc(headings: &[Value], from: u8, to: u8, ordered: bool) -> String {
    let tag = if ordered { "ol" } else { "ul" };
    let items: Vec<Heading> = headings.iter().filter_map(Heading::from_value).filter(|h| h.id.is_some() && (from..=to).contains(&h.level)).collect();
    let mut out = String::new();
    let mut stack: Vec<u8> = Vec::new();
    for h in &items {
        if stack.is_empty() {
            out.push_str(&format!("<{}>", tag));
            stack.push(h.level);
        } else {
            while stack.len() > 1 && h.level < *stack.last().unwrap() {
                out.push_str(&format!("</li></{}>", tag));
                stack.pop();
            }
            if h.level > *stack.last().unwrap() {
                out.push_str(&format!("<{}>", tag));
                stack.push(h.level);
            } else {
                out.push_str("</li>");
            }
        }
        out.push_str("<li><a href=\"#");
        escape_html(&mut out, h.id.as_deref().unwrap_or("")).ok();
        out.push_str("\">");
        out.push_str(&escape_text(&h.text));
        out.push_str("</a>");
    }
    for _ in &stack {
        out.push_str(&format!("</li></{}>", tag));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn md(src: &str) -> String {
        render(src, &MarkdownOptions::default(), None).unwrap()
    }

    #[test]
    fn sluggers() {
        assert_eq!(Slugger::Github.slug("Hello, World!"), "hello-world");
        assert_eq!(Slugger::Github.slug("A -- B"), "a----b");
        assert_eq!(Slugger::Github.slug("The foo() function"), "the-foo-function");
        assert_eq!(Slugger::Github.slug("Ünïcödé snake_case"), "ünïcödé-snake_case");
        assert_eq!(Slugger::Blackfriday.slug("A -- B"), "a-b");
        assert_eq!(Slugger::Blackfriday.slug("What's new in 1.2?"), "what-s-new-in-1-2");
        assert_eq!(Slugger::Blackfriday.slug("snake_case"), "snake-case");
        assert_eq!(Slugger::Ascii.slug("Debugging Aspirations (👩‍💻)"), "debugging-aspirations-woman-computer");
        assert_eq!(Slugger::Ascii.slug("Fulfill Rust's Promise (🦀)"), "fulfill-rust-s-promise-crab");
        assert_eq!(Slugger::Ascii.slug("Ünïcödé Straße"), "unicode-strasse");
    }

    #[test]
    fn heading_ids_are_unique_and_explicit_ids_win() {
        let html = md("# Intro\n\n## Intro\n\n## Setup {#intro-1}\n\n## Intro\n\n## `code` & *more*\n\n## !!!\n");
        assert_eq!(
            html,
            "<h1 id=\"intro\">Intro</h1>\n<h2 id=\"intro-2\">Intro</h2>\n<h2 id=\"intro-1\">Setup</h2>\n<h2 id=\"intro-3\">Intro</h2>\n<h2 id=\"code--more\"><code>code</code> &amp; <em>more</em></h2>\n<h2 id=\"section\">!!!</h2>\n"
        );
        let opts = MarkdownOptions { heading_ids: None, ..Default::default() };
        assert_eq!(render("## Plain\n\n## Given {#given .big}\n", &opts, None).unwrap(), "<h2>Plain</h2>\n<h2 id=\"given\" class=\"big\">Given</h2>\n");
    }

    #[test]
    fn footnotes_collect_at_the_end() {
        let html = md("One[^a] and two[^b], one again[^a]. Missing[^zzz].\n\n[^b]: Bee.\n[^a]: Ay *ay*.\n\nAfter.\n");
        assert_eq!(
            html,
            "<p>One<sup class=\"footnote-ref\"><a href=\"#fn-a\" id=\"fnref-a\">1</a></sup> and two<sup class=\"footnote-ref\"><a href=\"#fn-b\" id=\"fnref-b\">2</a></sup>, one again<sup class=\"footnote-ref\"><a href=\"#fn-a\" id=\"fnref-a-2\">1</a></sup>. Missing[^zzz].</p>\n<p>After.</p>\n\
             <section class=\"footnotes\">\n<ol>\n\
             <li id=\"fn-a\">\n<p>Ay <em>ay</em>. <a href=\"#fnref-a\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a> <a href=\"#fnref-a-2\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩<sup>2</sup></a></p>\n</li>\n\
             <li id=\"fn-b\">\n<p>Bee. <a href=\"#fnref-b\" class=\"footnote-backref\" aria-label=\"Back to reference 2\">↩</a></p>\n</li>\n\
             </ol>\n</section>\n"
        );
    }

    #[test]
    fn task_lists_autolinks_and_alerts() {
        assert_eq!(
            md("- [ ] todo\n- [x] done\n- plain\n"),
            "<ul>\n<li class=\"task-list-item\"><input type=\"checkbox\" disabled> todo</li>\n<li class=\"task-list-item\"><input type=\"checkbox\" disabled checked> done</li>\n<li>plain</li>\n</ul>\n"
        );
        assert_eq!(
            md("See https://example.com/a_(b). Or (www.example.org), not x://y or <https://z.dev> or [l](https://q.io) or `https://code.io`.\n"),
            "<p>See <a href=\"https://example.com/a_(b)\">https://example.com/a_(b)</a>. Or (<a href=\"http://www.example.org\">www.example.org</a>), not x://y or <a href=\"https://z.dev\">https://z.dev</a> or <a href=\"https://q.io\">l</a> or <code>https://code.io</code>.</p>\n"
        );
        assert_eq!(md("<a href=\"/x\">https://inside.io</a>\n"), "<p><a href=\"/x\">https://inside.io</a></p>\n");
        assert_eq!(
            md("> [!WARNING]\n> Hot *pine* cones.\n"),
            "<div class=\"markdown-alert markdown-alert-warning\">\n<p class=\"markdown-alert-title\">Warning</p>\n<p>Hot <em>pine</em> cones.</p>\n</div>\n"
        );
    }

    #[test]
    fn containers() {
        assert_eq!(
            md("Before\n::: tip Pro tip\nInside **bold**\n\n## Heading\n:::\nAfter\n"),
            "<p>Before</p>\n<div class=\"tip\">\n<p class=\"container-title\">Pro tip</p>\n<p>Inside <strong>bold</strong></p>\n<h2 id=\"heading\">Heading</h2>\n</div>\n<p>After</p>\n"
        );
        // Nesting, and `:::` inside a fence is code.
        assert_eq!(
            md(":::: outer\n::: inner\nx\n:::\n```\n::: not\n```\n::::\n"),
            "<div class=\"outer\">\n<div class=\"inner\">\n<p>x</p>\n</div>\n<pre><code>::: not\n</code></pre>\n</div>\n"
        );
        // `:::name[Title]` arguments lose their brackets.
        assert!(md(":::tip[Watch out]\nx\n:::\n").contains("<p class=\"container-title\">Watch out</p>"));
        // Left open, it closes at the end.
        assert_eq!(md("::: note\nopen"), "<div class=\"note\">\n<p>open</p>\n</div>\n");
        let off = MarkdownOptions { containers: false, ..Default::default() };
        assert_eq!(render("::: note\nx\n:::\n", &off, None).unwrap(), "<p>::: note\nx\n:::</p>\n");
        // Opened inside a list item, closed outside it.
        let err = render("- item\n  ::: note\n  x\n\n:::\n", &MarkdownOptions::default(), None).unwrap_err();
        assert!(err.to_string().contains("line 2: container `note`"), "{}", err);
    }

    #[test]
    fn smart_punctuation_leaves_flags_alone() {
        let smart = MarkdownOptions { smart_punctuation: true, ..Default::default() };
        let html = render("Run it with --fix or ---force, pages 1--2 -- \"quoted\" --- done... and a -- b.\n", &smart, None).unwrap();
        assert_eq!(html, "<p>Run it with --fix or ---force, pages 1\u{2013}2 \u{2013} \u{201c}quoted\u{201d} \u{2014} done\u{2026} and a \u{2013} b.</p>\n");
    }

    #[test]
    fn footnote_hooks_render_references_and_notes() {
        struct FootnoteHooks;
        impl Hooks for FootnoteHooks {
            fn has(&self, name: &str) -> bool {
                matches!(name, "hooks/footnote-ref" | "hooks/footnotes")
            }
            fn render(&self, _name: &str, key: &str, v: Value) -> Result<String> {
                Ok(match key {
                    "footnote" => format!("<sup class=\"footnote-reference\"><a href=\"#{}\" id=\"{}\">[{}]</a></sup>\n", v.get("id").to_js_string(), v.get("refId").to_js_string(), v.get("number").to_js_string()),
                    _ => v.as_array().unwrap().iter().map(|n| format!("<div class=\"footnote-definition\" id=\"{}\" data-label=\"{}\" data-refs=\"{}\">{}</div>\n", n.get("id").to_js_string(), n.get("label").to_js_string(), n.get("refs").as_array().unwrap().iter().map(|r| r.to_js_string()).collect::<Vec<_>>().join(" "), n.get("content").to_js_string().trim())).collect(),
                })
            }
        }
        let html = render("One[^a] two[^b] one again[^a].\n\n[^a]: First *note*.\n[^b]: Second.\n", &MarkdownOptions::default(), Some(&FootnoteHooks)).unwrap();
        assert_eq!(
            html,
            "<p>One<sup class=\"footnote-reference\"><a href=\"#fn-a\" id=\"fnref-a\">[1]</a></sup> two<sup class=\"footnote-reference\"><a href=\"#fn-b\" id=\"fnref-b\">[2]</a></sup> one again<sup class=\"footnote-reference\"><a href=\"#fn-a\" id=\"fnref-a-2\">[1]</a></sup>.</p>\n\
             <div class=\"footnote-definition\" id=\"fn-a\" data-label=\"a\" data-refs=\"fnref-a fnref-a-2\"><p>First <em>note</em>.</p></div>\n\
             <div class=\"footnote-definition\" id=\"fn-b\" data-label=\"b\" data-refs=\"fnref-b\"><p>Second.</p></div>\n"
        );
    }

    struct TestHooks;

    impl Hooks for TestHooks {
        fn has(&self, name: &str) -> bool {
            matches!(name, "hooks/heading" | "hooks/link" | "hooks/fence-mermaid" | "containers/tip" | "containers/note" | "hooks/image")
        }
        fn render(&self, name: &str, key: &str, v: Value) -> Result<String> {
            Ok(match key {
                "heading" => format!("<h{0} id=\"{1}\">{2} <a href=\"#{1}\" aria-hidden=\"true\">#</a></h{0}>\n", v.get("level").to_js_string(), v.get("id").to_js_string(), v.get("content").to_js_string()),
                "link" => format!("<a href=\"{}\" data-text=\"{}\">{}</a>\n", v.get("href").to_js_string(), v.get("text").to_js_string(), v.get("content").to_js_string()),
                "image" => format!("<figure>{}</figure>", v.get("alt").to_js_string()),
                "fence" => format!("<div class=\"{}\" data-info=\"{}\">{}</div>", name, v.get("info").to_js_string(), v.get("code").to_js_string()),
                _ => format!("<aside class=\"{}\" title=\"{}\" data-source=\"{}\">\n{}</aside>\n", v.get("name").to_js_string(), v.get("args").to_js_string(), v.get("source").to_js_string().escape_default(), v.get("content").to_js_string()),
            })
        }
    }

    #[test]
    fn hooks_take_over() {
        let mail = render("Write <squatch@example.com>.\n", &MarkdownOptions::default(), Some(&TestHooks)).unwrap();
        assert_eq!(mail, "<p>Write <a href=\"mailto:squatch@example.com\" data-text=\"squatch@example.com\">squatch@example.com</a>.</p>\n");
        let html = render(
            "## A [link](/x) *here*\n\n![Alt](/i.png)\n\n```mermaid {theme=dark}\ngraph\n```\n\n```js\nx\n```\n\n::: tip T\nbody\n:::\n\n> [!NOTE]\n> noted\n",
            &MarkdownOptions::default(),
            Some(&TestHooks),
        )
        .unwrap();
        assert_eq!(
            html,
            "<h2 id=\"a-link-here\">A <a href=\"/x\" data-text=\"link\">link</a> <em>here</em> <a href=\"#a-link-here\" aria-hidden=\"true\">#</a></h2>\n\
             <p><figure>Alt</figure></p>\n\
             <div class=\"hooks/fence-mermaid\" data-info=\"mermaid {theme=dark}\">graph\n</div>\n\
             <pre><code class=\"language-js\">x\n</code></pre>\n\
             <aside class=\"tip\" title=\"T\" data-source=\"body\\n\">\n<p>body</p>\n</aside>\n\
             <aside class=\"note\" title=\"\" data-source=\"\">\n<p>noted</p>\n</aside>\n"
        );
        assert_eq!(headings(&html), vec![Heading { level: 2, id: Some("a-link-here".into()), text: "A link here".into() }]);
    }

    #[test]
    fn headings_from_html() {
        let html = "<h1>Top &amp; <em>tail</em></h1>\n<pre><code>&lt;h2&gt;no&lt;/h2&gt;</code></pre><!-- <h2>no</h2> -->\n<H2 class=x id='two'>Two<br>lines</H2><h3 id=three>Three <span aria-hidden=\"true\"><b>¶</b></span></h3>";
        assert_eq!(
            headings(html),
            vec![
                Heading { level: 1, id: None, text: "Top & tail".into() },
                Heading { level: 2, id: Some("two".into()), text: "Two lines".into() },
                Heading { level: 3, id: Some("three".into()), text: "Three".into() },
            ]
        );
    }

    #[test]
    fn table_of_contents() {
        let hs: Vec<Value> = [(1, "t"), (2, "a"), (3, "a1"), (3, "a2"), (2, "b"), (4, "b1"), (3, "b2"), (2, "c")]
            .iter()
            .map(|(l, id)| Heading { level: *l, id: Some(id.to_string()), text: id.to_uppercase() }.to_value())
            .collect();
        assert_eq!(
            toc(&hs, 2, 4, false),
            "<ul><li><a href=\"#a\">A</a><ul><li><a href=\"#a1\">A1</a></li><li><a href=\"#a2\">A2</a></li></ul></li>\
             <li><a href=\"#b\">B</a><ul><li><a href=\"#b1\">B1</a></li></ul><ul><li><a href=\"#b2\">B2</a></li></ul></li>\
             <li><a href=\"#c\">C</a></li></ul>"
        );
        assert_eq!(toc(&hs, 2, 2, true), "<ol><li><a href=\"#a\">A</a></li><li><a href=\"#b\">B</a></li><li><a href=\"#c\">C</a></li></ol>");
        assert_eq!(toc(&[], 2, 3, false), "");
    }

    #[test]
    fn indented_code_can_be_markdown() {
        let src = "Text\n\n    <div class=\"x\">\n      *hi*\n    </div>\n\n```\n    fenced\n```\n";
        assert!(md(src).contains("<pre><code>&lt;div class=&quot;x&quot;&gt;"));
        let opts = MarkdownOptions { indented_code: false, ..Default::default() };
        assert_eq!(render(src, &opts, None).unwrap(), "<p>Text</p>\n<div class=\"x\">\n  *hi*\n</div>\n<pre><code>    fenced\n</code></pre>\n");
    }

    #[test]
    fn inline() {
        let o = MarkdownOptions::default();
        assert_eq!(render_inline("Hi *there*", &o, None).unwrap(), "Hi <em>there</em>");
        assert_eq!(render_inline("a\n\nb", &o, None).unwrap(), "<p>a</p>\n<p>b</p>\n");
    }

    #[test]
    fn options_from_config() {
        let mut o = MarkdownOptions::default();
        o.apply(&Value::from_pairs([("headingIds", Value::from("blackfriday")), ("smartPunctuation", Value::Bool(true))])).unwrap();
        assert_eq!(o.heading_ids, Some(Slugger::Blackfriday));
        assert!(o.smart_punctuation);
        let err = o.apply(&Value::from_pairs([("footnote", Value::Bool(true))])).unwrap_err().to_string();
        assert!(err.starts_with("markdown.footnote isn't an option"), "{}", err);
        let err = o.apply(&Value::from_pairs([("headingIds", Value::from("hugo"))])).unwrap_err().to_string();
        assert!(err.contains("unknown slugger \"hugo\""), "{}", err);
    }
}
