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
    /// kramdown's GFM parser's (Jekyll's): lowercase, then everything but letters, marks,
    /// digits, `_`-like connectors, `-`, spaces and tabs is dropped (emoji too, which GitHub's
    /// keeps), and spaces and tabs become `-`.
    Kramdown,
    /// markdown-it-anchor's default: trimmed, lowercase, each run of whitespace a `-`, then
    /// `encodeURIComponent` (`What’s new?` is `what%E2%80%99s-new%3F`).
    MarkdownItAnchor,
}

/// What kramdown's GFM ids drop: Ruby's `/[^\p{Word}\- \t]/`.
static KRAMDOWN_DROPS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{M}\p{Nd}\p{Pc}\- \t]").unwrap());

impl Slugger {
    pub fn parse(name: &str) -> Option<Slugger> {
        match name {
            "github" => Some(Slugger::Github),
            "blackfriday" => Some(Slugger::Blackfriday),
            "ascii" => Some(Slugger::Ascii),
            "kramdown" => Some(Slugger::Kramdown),
            "markdown-it-anchor" => Some(Slugger::MarkdownItAnchor),
            _ => None,
        }
    }

    pub fn slug(self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        match self {
            // github-slugger's: lowercase, then remove what its table lists (punctuation, symbols,
            // controls; it keeps letters, numbers, combining marks, joiners and `_`), spaces as `-`.
            // rehype-slug uses it, so remark and rehype sites (Astro, VitePress, Docusaurus) have
            // these anchors, and GitHub's are the same.
            Slugger::Github => {
                for c in text.to_lowercase().chars() {
                    if c == ' ' {
                        out.push('-');
                    } else if !crate::github_slugger::removes(c) {
                        out.push(c);
                    }
                }
            }
            Slugger::Ascii => return Slugger::Blackfriday.slug(&deunicode::deunicode(text)),
            Slugger::Kramdown => return KRAMDOWN_DROPS.replace_all(&text.to_lowercase(), "").replace([' ', '\t'], "-"),
            Slugger::MarkdownItAnchor => {
                // JavaScript's `trim`, `toLowerCase` and `/\s+/g`: Unicode white space, and the BOM.
                let js_space = |c: char| c.is_whitespace() || c == '\u{FEFF}';
                let lower = text.trim_matches(js_space).to_lowercase();
                let mut space = false;
                for c in lower.chars() {
                    if js_space(c) {
                        if !space {
                            out.push('-');
                        }
                        space = true;
                        continue;
                    }
                    space = false;
                    if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
                        out.push(c);
                    } else {
                        let mut buf = [0u8; 4];
                        for b in c.encode_utf8(&mut buf).bytes() {
                            out.push_str(&format!("%{:02X}", b));
                        }
                    }
                }
            }
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

/// Languages a site adds to highlighting, or replaces
/// (`markdown: { highlight: { languages: { chordpro: fn, cho: "chordpro" } } }`).
/// They come before the built-in ones, and their names match fences in any case.
#[derive(Clone, Debug, Default)]
pub struct Languages {
    /// Lowercase names, in the order they were configured.
    pub entries: Vec<(String, Language)>,
    /// The built-in grammars with the site's `.sublime-syntax` files added,
    /// once [`Languages::load`] has read them.
    #[cfg(feature = "highlight")]
    pub(crate) grammars: Option<std::sync::Arc<syntect::parsing::SyntaxSet>>,
}

/// One of a site's languages.
#[derive(Clone, Debug)]
pub enum Language {
    /// A function, `(code, lang) => tokens`: `[text, kind]` pairs or
    /// `{ text, kind }` objects, where `kind` is an `hl-*` name without the
    /// prefix (`keyword`, `string`, ...), or nothing for plain text.
    Tokens(Value),
    /// Another language's name: `cho: "chordpro"`, `jsx: "js"`.
    Alias(String),
    /// A `.sublime-syntax` file, from the project root, and the scope it
    /// names once it's loaded.
    Grammar { path: String, scope: Option<String> },
}

impl Language {
    /// A language from the config: a function (already a [`Value::Func`]),
    /// another language's name, or a path to a `.sublime-syntax` file.
    pub fn parse(name: &str, value: &Value) -> Result<Language> {
        Ok(match value {
            Value::Func(_) => Language::Tokens(value.clone()),
            Value::Str(s) if s.ends_with(".sublime-syntax") => Language::Grammar { path: s.to_string(), scope: None },
            Value::Str(s) if s.contains(['/', '\\']) => bail!("markdown.highlight.languages.{}: \"{}\" isn't a .sublime-syntax file (a grammar's file name ends with .sublime-syntax)", name, s),
            Value::Str(s) if !s.trim().is_empty() => Language::Alias(s.trim().to_ascii_lowercase()),
            other => bail!("markdown.highlight.languages.{} must be a function (code, lang) => tokens, another language's name, or a path to a .sublime-syntax file, not {}", name, other.type_of()),
        })
    }
}

impl Languages {
    /// Add `name` (or replace it). A name is the first word of a fence's
    /// info string, so it can't have spaces, braces or commas.
    pub fn set(&mut self, name: &str, language: Language) -> Result<()> {
        if name.is_empty() || name.contains(|c: char| c.is_whitespace() || c == '{' || c == '}' || c == ',' || c == '`') {
            bail!("markdown.highlight.languages: \"{}\" can't be a language's name; a fence's language is one word (`chordpro`, `cho`)", name);
        }
        let name = name.to_ascii_lowercase();
        match self.entries.iter_mut().find(|(n, _)| *n == name) {
            Some(entry) => entry.1 = language,
            None => self.entries.push((name, language)),
        }
        Ok(())
    }

    /// The site's language called `name`, in any case.
    pub fn get(&self, name: &str) -> Option<&Language> {
        self.entries.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, l)| l)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Without the `highlight` feature there's nothing to load: the config
    /// can't turn highlighting on.
    #[cfg(not(feature = "highlight"))]
    pub fn load(&mut self, _root: &std::path::Path) -> Result<()> {
        Ok(())
    }
}

thread_local! {
    /// The page being rendered on this thread, for warnings from code that
    /// doesn't know it (a site's highlighter).
    static PAGE: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// While it's kept, warnings name `page` (the input file, from the project root).
pub(crate) struct Rendering(Option<String>);

pub(crate) fn rendering(page: &str) -> Rendering {
    Rendering(PAGE.with(|p| p.replace(Some(page.to_string()))))
}

impl Drop for Rendering {
    fn drop(&mut self) {
        let previous = self.0.take();
        PAGE.with(|p| *p.borrow_mut() = previous);
    }
}

/// The page being rendered on this thread, if any.
pub(crate) fn current_page() -> Option<String> {
    PAGE.with(|p| p.borrow().clone())
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
    /// With `autolinks`, bare domains (`example.com`) and email addresses too, as markdown-it's
    /// `linkify` does (`autolinks: "fuzzy"`).
    pub fuzzy_links: bool,
    /// A single newline in a paragraph is a `<br>`, as markdown-it's `breaks: true` makes it.
    pub breaks: bool,
    /// An image alone in a paragraph is a `<figure>`, its alt text the `<figcaption>`, as
    /// markdown-it-implicit-figures makes it with `figcaption: true`.
    pub figures: bool,
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
    /// Languages the site adds or replaces (`highlight: { languages }`).
    pub languages: Languages,
    /// Another highlighter's class names for the tokens (`highlight: { classes }`).
    pub highlight_classes: Option<HighlightClasses>,
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
            fuzzy_links: false,
            breaks: false,
            figures: false,
            alerts: true,
            containers: true,
            definition_lists: false,
            smart_punctuation: false,
            indented_code: true,
            highlight: false,
            highlight_css: Some("/highlight.css".into()),
            languages: Languages::default(),
            highlight_classes: None,
            slugger_fn: None,
        }
    }
}

impl MarkdownOptions {
    /// The option names in `ssqch.config.js` (`markdown: { headingIds: "blackfriday" }`).
    pub const KEYS: [&'static str; 13] =
        ["headingIds", "headingAttributes", "footnotes", "taskLists", "autolinks", "alerts", "containers", "definitionLists", "smartPunctuation", "indentedCode", "highlight", "breaks", "figures"];

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
                        Value::Str(s) => Some(Slugger::parse(s).ok_or_else(|| anyhow::anyhow!("markdown.headingIds: unknown slugger \"{}\" (use \"github\", \"blackfriday\", \"ascii\", \"kramdown\", \"markdown-it-anchor\" or false)", s))?),
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
                                    ("languages", Value::Obj(languages)) => {
                                        for (name, language) in languages.iter() {
                                            self.languages.set(name, Language::parse(name, language)?)?;
                                        }
                                    }
                                    ("languages", other) => bail!("markdown.highlight.languages must be an object of {{ name: highlighter }}, not {}", other.type_of()),
                                    (other, _) => bail!("markdown.highlight.{} isn't an option (options: css, languages)", other),
                                }
                            }
                        }
                        other => bail!("markdown.highlight must be true, false or {{ css, languages }}, not {}", other.type_of()),
                    }
                    if self.highlight && !cfg!(feature = "highlight") {
                        bail!("markdown.highlight: this ssqch was built without the `highlight` feature");
                    }
                    continue;
                }
                "autolinks" => {
                    (self.autolinks, self.fuzzy_links) = match v {
                        Value::Bool(b) => (*b, false),
                        Value::Str(s) if s.as_ref() == "fuzzy" => (true, true),
                        other => bail!("markdown.autolinks must be true, false or \"fuzzy\", not {}", if let Value::Str(s) = other { format!("\"{}\"", s) } else { other.type_of().to_string() }),
                    };
                    continue;
                }
                "breaks" => &mut self.breaks,
                "figures" => &mut self.figures,
                "headingAttributes" => &mut self.heading_attributes,
                "footnotes" => &mut self.footnotes,
                "taskLists" => &mut self.task_lists,
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

/// Another highlighter's class names, so a site keeps its theme's CSS (`highlight: { classes }`):
/// Prism's (`token keyword`), or the site's own for some kinds. Applied to the highlighted HTML,
/// after the cache of highlighted fences, so the cache doesn't depend on them.
#[derive(Clone, Debug, Default)]
pub struct HighlightClasses {
    /// The class names for each kind (`keyword` -> `token keyword`); a kind left out keeps `hl-*`.
    pub names: Vec<(String, String)>,
    /// Prism's markup around them too, as the syntax-highlight plugins write it:
    /// `<pre class="language-js">`, and a marked line as `<mark class="highlight-line
    /// highlight-line-active">` (the other lines unwrapped).
    pub prism: bool,
}

impl HighlightClasses {
    /// The highlighted HTML (the inside of a `<code>`) with these names.
    pub fn apply(&self, html: &str) -> String {
        let mut lines = String::with_capacity(html.len() + html.len() / 4);
        if self.prism && html.starts_with("<span class=\"line") {
            for line in html.split_inclusive('\n') {
                let (body, newline) = line.strip_suffix('\n').map_or((line, ""), |b| (b, "\n"));
                if let Some(inner) = body.strip_prefix("<span class=\"line highlighted\">").and_then(|b| b.strip_suffix("</span>")) {
                    lines.push_str("<mark class=\"highlight-line highlight-line-active\">");
                    lines.push_str(inner);
                    lines.push_str("</mark>");
                } else if let Some(inner) = body.strip_prefix("<span class=\"line\">").and_then(|b| b.strip_suffix("</span>")) {
                    lines.push_str(inner);
                } else {
                    lines.push_str(body);
                }
                lines.push_str(newline);
            }
        } else {
            lines.push_str(html);
        }
        const OPEN: &str = "<span class=\"hl-";
        if self.names.is_empty() || !lines.contains(OPEN) {
            return lines;
        }
        let mut out = String::with_capacity(lines.len() + lines.len() / 4);
        let mut rest = lines.as_str();
        while let Some(at) = rest.find(OPEN) {
            out.push_str(&rest[..at]);
            let after = &rest[at + OPEN.len()..];
            let kind_len = after.find('"').unwrap_or(after.len());
            let kind = &after[..kind_len];
            match self.names.iter().find(|(k, _)| k == kind) {
                Some((_, names)) => {
                    out.push_str("<span class=\"");
                    out.push_str(names);
                }
                None => {
                    out.push_str(OPEN);
                    out.push_str(kind);
                }
            }
            rest = &after[kind_len..];
        }
        out.push_str(rest);
        out
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
        close_open_quotes(&mut events);
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
        events = autolink(events, opts.fuzzy_links);
    }
    if opts.breaks {
        for e in events.iter_mut() {
            if matches!(e, Event::SoftBreak) {
                *e = Event::HardBreak;
            }
        }
    }
    if opts.figures {
        events = figures(events);
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

/// With smart punctuation, a `"` between two letters is both left- and right-flanking, and
/// pulldown-cmark opens a quote with it even when one is open: `比如"进展 ISSUE-123"；` came out
/// `“…ISSUE-123“` (opensource.guide's zh-hans pages). An opening quote that follows a character
/// other than a space while a quote is open in the same block closes it, as markdown-it and
/// commonmark.js match quotes.
fn close_open_quotes(events: &mut [Event]) {
    let mut open = false;
    let mut last: Option<char> = None;
    for event in events.iter_mut() {
        match event {
            Event::Start(tag) if !matches!(tag, Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. } | Tag::Image { .. }) => {
                open = false;
                last = None;
            }
            Event::End(end) if !matches!(end, TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link | TagEnd::Image) => {
                open = false;
                last = None;
            }
            Event::Code(code) => last = code.chars().last(),
            Event::SoftBreak | Event::HardBreak => last = Some(' '),
            Event::Text(text) => {
                if !text.contains(['\u{201C}', '\u{201D}']) {
                    last = text.chars().last().or(last);
                    continue;
                }
                let mut out = String::with_capacity(text.len());
                for c in text.chars() {
                    let c = match c {
                        '\u{201C}' if open && last.is_some_and(|l| !l.is_whitespace()) => {
                            open = false;
                            '\u{201D}'
                        }
                        '\u{201C}' => {
                            open = true;
                            c
                        }
                        '\u{201D}' => {
                            open = false;
                            c
                        }
                        _ => c,
                    };
                    out.push(c);
                    last = Some(c);
                }
                *text = out.into();
            }
            _ => {}
        }
    }
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

/// The top-level domains a bare domain can end in for `autolinks: "fuzzy"`: linkify-it's (the
/// library markdown-it's `linkify` uses), a few generic ones and every two-letter country code.
const FUZZY_TLDS: &str = "biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф|a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]";

/// A URL, or a bare domain (`example.com/path`) or email address (`ranger@example.com`).
static FUZZY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r"(?:https?://|www\.)[A-Za-z0-9][^\s<>]*|(?:[A-Za-z0-9._%+-]+@)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?i:{})\b(?::[0-9]{{1,5}})?(?:[/?#][^\s<>]*)?", FUZZY_TLDS)).unwrap()
});

/// Turn bare URLs in text into links, as GitHub does: trailing punctuation
/// and an unbalanced `)` stay out of the link. With `fuzzy`, bare domains
/// get `http://` and email addresses `mailto:`, as markdown-it's `linkify` does.
fn autolink(events: Vec<Event>, fuzzy: bool) -> Vec<Event> {
    let pattern: &Regex = if fuzzy { &FUZZY } else { &URL };
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
            Event::Text(t) if in_link == 0 && in_html_link == 0 && (t.contains("http") || t.contains("www.") || (fuzzy && t.contains('.'))) => {
                let text = t.to_string();
                let mut last = 0;
                for m in pattern.find_iter(&text) {
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
                    let href = if url.starts_with("http://") || url.starts_with("https://") {
                        url.to_string()
                    } else if url.contains('@') && !url.contains('/') {
                        format!("mailto:{}", url)
                    } else {
                        format!("http://{}", url)
                    };
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

/// `figures`: a paragraph that's only an image (or a linked image) is a `<figure>`, with the
/// image's alt text as its `<figcaption>` and the image's own `alt` left empty, so a screen reader
/// reads the caption once. markdown-it-implicit-figures with `figcaption: true` writes the same.
fn figures(events: Vec<Event>) -> Vec<Event> {
    let mut out = Vec::with_capacity(events.len());
    let mut i = 0;
    while i < events.len() {
        if let Event::Start(Tag::Paragraph) = &events[i] {
            let linked = matches!(events.get(i + 1), Some(Event::Start(Tag::Link { .. }))) && matches!(events.get(i + 2), Some(Event::Start(Tag::Image { .. })));
            let image = if linked { i + 2 } else { i + 1 };
            if matches!(events.get(image), Some(Event::Start(Tag::Image { .. }))) {
                let end = matching(&events, image);
                let after = if linked { end + 2 } else { end + 1 };
                let link_closes = !linked || matches!(events.get(end + 1), Some(Event::End(TagEnd::Link)));
                if link_closes && matches!(events.get(after), Some(Event::End(TagEnd::Paragraph))) {
                    out.push(Event::InlineHtml("<figure>".into()));
                    if linked {
                        out.push(events[i + 1].clone());
                    }
                    out.push(events[image].clone());
                    out.push(events[end].clone());
                    if linked {
                        out.push(events[end + 1].clone());
                    }
                    let caption = &events[image + 1..end];
                    if !caption.is_empty() {
                        out.push(Event::InlineHtml("<figcaption>".into()));
                        out.extend(caption.iter().cloned());
                        out.push(Event::InlineHtml("</figcaption>".into()));
                    }
                    out.push(Event::InlineHtml("</figure>\n".into()));
                    i = after + 1;
                    continue;
                }
            }
        }
        out.push(events[i].clone());
        i += 1;
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
                // A code span through `hooks/code.*` (GitHub Pages' Rouge writes `<code
                // class="language-plaintext highlighter-rouge">`; osg #4), given its text.
                Event::Code(t) if self.has("hooks/code") => {
                    flush(&mut plain, out);
                    out.push_str(self.hook("hooks/code", "code", Value::from_pairs([("code", Value::from(t.as_ref()))]))?.trim_end());
                }
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
        let classes = self.opts.and_then(|o| o.highlight_classes.as_ref());
        let highlighted = match self.opts {
            Some(opts) if self.highlight => highlight_code(&opts.languages, lang, code, info).map(|h| classes.map_or(h.clone(), |c| c.apply(&h))),
            _ => None,
        };
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
        if self.highlight && classes.is_some_and(|c| c.prism) && !lang.is_empty() {
            // Prism's: the language on the `<pre>` too, and for a language without a grammar
            // (the code escaped as it is), as eleventy-plugin-syntaxhighlight writes it.
            out.push_str("<pre class=\"language-");
            escape_html(&mut *out, lang).ok();
            out.push_str("\"><code");
        } else {
            out.push_str(if highlighted.is_some() { "<pre class=\"highlight\"><code" } else { "<pre><code" });
        }
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
fn highlight_code(languages: &Languages, lang: &str, code: &str, info: &str) -> Option<String> {
    crate::highlight::highlight_in(languages, lang, code, &crate::highlight::marked_lines(info))
}

#[cfg(not(feature = "highlight"))]
fn highlight_code(_languages: &Languages, _lang: &str, _code: &str, _info: &str) -> Option<String> {
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
        // As github-slugger 2.0.0 writes them (expressjs.com's anchors): an emoji's variation
        // selector and a combining accent stay; superscripts and fractions go.
        assert_eq!(Slugger::Github.slug("\u{26A0}\u{FE0F} What you should do"), "\u{FE0F}-what-you-should-do");
        assert_eq!(Slugger::Github.slug("Cafe\u{301} x\u{B2} \u{BD}"), "cafe\u{301}-x-");
        assert_eq!(Slugger::Github.slug("\u{130}stanbul"), "i\u{307}stanbul");
        assert_eq!(Slugger::Blackfriday.slug("A -- B"), "a-b");
        // kramdown's GFM ids drop emoji and symbols, and keep letters in any script.
        assert_eq!(Slugger::Kramdown.slug("\u{1F62D} Вы не атрымаеце адказ"), "-вы-не-атрымаеце-адказ");
        assert_eq!(Slugger::Kramdown.slug("Café, x\u{B2}\tsnake_case!"), "café-x-snake_case");
        // markdown-it-anchor's: encodeURIComponent of the lowercase text, spaces as `-`.
        assert_eq!(Slugger::MarkdownItAnchor.slug("  What’s new:  Café?  "), "what%E2%80%99s-new%3A-caf%C3%A9%3F");
        assert_eq!(Slugger::MarkdownItAnchor.slug("Use (it) wisely!"), "use-(it)-wisely!");
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
    fn smart_quotes_between_letters_close_an_open_one() {
        let smart = MarkdownOptions { smart_punctuation: true, ..Default::default() };
        assert_eq!(render("比如\"我们正在处理——进展见 ISSUE-123\"；\n", &smart, None).unwrap(), "<p>比如“我们正在处理——进展见 ISSUE-123”；</p>\n");
        assert_eq!(render("a \"b\" c \"d\"\n\n\"e\"\n", &smart, None).unwrap(), "<p>a “b” c “d”</p>\n<p>“e”</p>\n");
        assert_eq!(render("say \"*one*\"x\"two\"\n", &smart, None).unwrap(), "<p>say “<em>one</em>”x“two”</p>\n");
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

    // GitHub Pages' Rouge puts its classes on every code span (osg #4): a hook writes them.
    #[test]
    fn a_code_hook_writes_code_spans() {
        struct CodeHook;
        impl Hooks for CodeHook {
            fn has(&self, name: &str) -> bool {
                name == "hooks/code"
            }
            fn render(&self, _: &str, _: &str, v: Value) -> Result<String> {
                Ok(format!("<code class=\"language-plaintext highlighter-rouge\">{}</code>\n", escape_text(&v.get("code").to_js_string())))
            }
        }
        assert_eq!(
            render("Run `ssqch \"build\"` <b>now</b>, then [`serve`](/s/).\n", &MarkdownOptions::default(), Some(&CodeHook)).unwrap(),
            "<p>Run <code class=\"language-plaintext highlighter-rouge\">ssqch &quot;build&quot;</code> <b>now</b>, then <a href=\"/s/\"><code class=\"language-plaintext highlighter-rouge\">serve</code></a>.</p>\n"
        );
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

    // markdown-it's habits, for sites that move with their output as it was (a11y #12, #25; v8
    // #24). Each expected string is what markdown-it 13 wrote for the same Markdown (`breaks:
    // true`, `linkify: true`, markdown-it-implicit-figures with `figcaption: true`).
    #[test]
    fn markdown_its_habits() {
        let breaks = MarkdownOptions { breaks: true, ..Default::default() };
        assert_eq!(render("line one\nline two\n\n- a\n  b\n", &breaks, None).unwrap(), "<p>line one<br>\nline two</p>\n<ul>\n<li>a<br>\nb</li>\n</ul>\n");
        let fuzzy = MarkdownOptions { fuzzy_links: true, ..Default::default() };
        assert_eq!(
            render("See example.com, docs.example.org/a?b=1 and ranger@example.com. Not node.js, e.g. or 1.2.3; www.x.io and https://y.dev stay.\n", &fuzzy, None).unwrap(),
            "<p>See <a href=\"http://example.com\">example.com</a>, <a href=\"http://docs.example.org/a?b=1\">docs.example.org/a?b=1</a> and <a href=\"mailto:ranger@example.com\">ranger@example.com</a>. Not node.js, e.g. or 1.2.3; <a href=\"http://www.x.io\">www.x.io</a> and <a href=\"https://y.dev\">https://y.dev</a> stay.</p>\n"
        );
        assert_eq!(render("example.com\n", &MarkdownOptions::default(), None).unwrap(), "<p>example.com</p>\n");
        let figures = MarkdownOptions { figures: true, ..Default::default() };
        assert_eq!(render("![A *pine* cone](/cone.jpg)\n", &figures, None).unwrap(), "<figure><img src=\"/cone.jpg\" alt=\"\"><figcaption>A <em>pine</em> cone</figcaption></figure>\n");
        assert_eq!(render("[![Map](/map.png \"Trail\")](/trails/)\n", &figures, None).unwrap(), "<figure><a href=\"/trails/\"><img src=\"/map.png\" alt=\"\" title=\"Trail\"></a><figcaption>Map</figcaption></figure>\n");
        assert_eq!(render("![](/x.png)\n", &figures, None).unwrap(), "<figure><img src=\"/x.png\" alt=\"\"></figure>\n");
        // An image beside other text is still an image in a paragraph.
        assert_eq!(render("Look: ![Cone](/cone.jpg)\n", &figures, None).unwrap(), "<p>Look: <img src=\"/cone.jpg\" alt=\"Cone\"></p>\n");
        let mut o = MarkdownOptions::default();
        o.apply(&Value::from_pairs([("autolinks", Value::from("fuzzy")), ("breaks", Value::Bool(true)), ("figures", Value::Bool(true))])).unwrap();
        assert!(o.autolinks && o.fuzzy_links && o.breaks && o.figures);
        assert!(o.apply(&Value::from_pairs([("autolinks", Value::from("loose"))])).unwrap_err().to_string().contains("markdown.autolinks must be true, false or \"fuzzy\", not \"loose\""));
    }

    // Another highlighter's classes, so a site keeps its theme's CSS (v8 B3, lit.dev's CodeMirror
    // classes): the spans' names, and with Prism's, its `<pre>` and its marked lines.
    #[cfg(feature = "highlight")]
    #[test]
    fn highlighting_with_another_highlighters_classes() {
        let prism = HighlightClasses { names: vec![("keyword".into(), "token keyword".into()), ("number".into(), "token number".into())], prism: true };
        let opts = MarkdownOptions { highlight: true, highlight_classes: Some(prism), ..Default::default() };
        assert_eq!(render("```js\nlet a = 1;\n```\n", &opts, None).unwrap(), "<pre class=\"language-js\"><code class=\"language-js\"><span class=\"token keyword\">let</span> a <span class=\"hl-operator\">=</span> <span class=\"token number\">1</span>;\n</code></pre>\n");
        let marked = render("```js {2}\nlet a;\nlet b;\n```\n", &opts, None).unwrap();
        assert_eq!(marked, "<pre class=\"language-js\"><code class=\"language-js\"><span class=\"token keyword\">let</span> a;\n<mark class=\"highlight-line highlight-line-active\"><span class=\"token keyword\">let</span> b;</mark>\n</code></pre>\n");
        // A language with no grammar keeps Prism's `<pre>`, its code escaped.
        assert_eq!(render("```nope\na < b\n```\n", &opts, None).unwrap(), "<pre class=\"language-nope\"><code class=\"language-nope\">a &lt; b\n</code></pre>\n");
        // A map of the site's own keeps ssqch's markup around the spans.
        let own = MarkdownOptions { highlight: true, highlight_classes: Some(HighlightClasses { names: vec![("keyword".into(), "tok-keyword".into())], prism: false }), ..Default::default() };
        assert_eq!(render("```js\nlet a;\n```\n", &own, None).unwrap(), "<pre class=\"highlight\"><code class=\"language-js\"><span class=\"tok-keyword\">let</span> a;\n</code></pre>\n");
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
