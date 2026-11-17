//! `ssqch import <generator>`: the mechanical part of moving a site.
//!
//! It renames data files, rewrites front matter keys and attributes to
//! ssqch's names, writes a first `ssqch.config.js` from what it can read in
//! the old config, and lists what's left to do by hand, with file and line.
//! Without `--write` it only says what it would do.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::LazyLock;

use anyhow::{bail, Context, Result};
use regex::Regex;
use sitesquatch::cli::clap;

pub fn import_command() -> clap::Command {
    clap::Command::new("import")
        .about("Move a site from another generator: rename and rewrite what's mechanical, and list the rest")
        .arg(clap::Arg::new("generator").help("The generator the site is built with: eleventy or zola").required(true))
        .arg(clap::Arg::new("dir").help("The site's folder (default: the current folder)").default_value("."))
        .arg(clap::Arg::new("write").long("write").action(clap::ArgAction::SetTrue).help("Make the changes (without it, only list them)"))
        .after_help("Run it in a clean git checkout, read the list, then run it again with --write. `ssqch docs --from <generator>` prints the trailhead for each generator.")
}

pub fn run_import(matches: &clap::ArgMatches) -> ExitCode {
    let generator = matches.get_one::<String>("generator").expect("required");
    let dir = PathBuf::from(matches.get_one::<String>("dir").expect("has a default"));
    let write = matches.get_flag("write");
    let result = match generator.as_str() {
        "eleventy" | "11ty" => eleventy(&dir).and_then(|plan| {
            print!("{}", plan.describe(&dir, write));
            if write { plan.apply(&dir) } else { Ok(()) }
        }),
        "zola" => zola(&dir).and_then(|plan| {
            print!("{}", plan.describe(&dir, write));
            if write { plan.apply(&dir) } else { Ok(()) }
        }),
        "jekyll" | "hugo" | "docusaurus" | "mkdocs" | "hexo" | "astro" | "vitepress" => Err(anyhow::anyhow!("there's no importer for {} yet (only eleventy and zola); `ssqch docs --from <generator>` has trailheads for moving from Docusaurus, MkDocs, Hexo and component frameworks by hand", generator)),
        other => Err(anyhow::anyhow!("{}: not a generator ssqch can import from (use eleventy or zola)", other)),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{} {:#}", sitesquatch::diagnostics::red("error:"), e);
            ExitCode::FAILURE
        }
    }
}

/// What an import would do to a site. Paths are relative to its folder.
#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// The generator the site is moving from, as people write it.
    pub from: &'static str,
    /// Files to rename: (from, to).
    pub renames: Vec<(String, String)>,
    /// Files to change: (path as it is now, what changes, the new contents).
    pub edits: Vec<(String, Vec<String>, String)>,
    /// Files to create: (path, where it came from, contents).
    pub new_files: Vec<(String, String, String)>,
    /// What's left for a person: (where, what to do).
    pub by_hand: Vec<(String, String)>,
}

impl Plan {
    fn is_empty(&self) -> bool {
        self.renames.is_empty() && self.edits.is_empty() && self.new_files.is_empty()
    }

    pub fn describe(&self, dir: &Path, write: bool) -> String {
        let mut out = format!("Importing the {} site in {}{}\n", self.from, dir.display(), if write { "" } else { " (a dry run: nothing is changed; add --write to make the changes)" });
        if !self.renames.is_empty() {
            out.push_str(&format!("\nRename ({})\n", self.renames.len()));
            for (from, to) in &self.renames {
                out.push_str(&format!("  {} -> {}\n", from, to));
            }
        }
        if !self.edits.is_empty() {
            out.push_str(&format!("\nEdit ({})\n", self.edits.len()));
            for (path, changes, _) in &self.edits {
                out.push_str(&format!("  {}: {}\n", path, changes.join(", ")));
            }
        }
        if !self.new_files.is_empty() {
            out.push_str(&format!("\nCreate ({})\n", self.new_files.len()));
            for (path, from, _) in &self.new_files {
                out.push_str(&format!("  {} ({})\n", path, from));
            }
        }
        if self.is_empty() {
            out.push_str("\nNothing to rename, edit or create.\n");
        }
        if !self.by_hand.is_empty() {
            out.push_str(&format!("\nBy hand ({})\n", self.by_hand.len()));
            for (at, what) in &self.by_hand {
                out.push_str(&format!("  {}: {}\n", at, what));
            }
        }
        out.push_str(&format!("\nNext: `ssqch build`, then compare with the site {0} built: `ssqch diff <{0}'s output> <ssqch's output>`.\n", self.from));
        out
    }

    /// Make the changes. Edits are written before the renames move the files.
    pub fn apply(&self, dir: &Path) -> Result<()> {
        for (path, _, contents) in &self.edits {
            std::fs::write(dir.join(path), contents).with_context(|| format!("writing {}", path))?;
        }
        for (from, to) in &self.renames {
            if dir.join(to).exists() {
                bail!("{} is in the way of renaming {}", to, from);
            }
            std::fs::rename(dir.join(from), dir.join(to)).with_context(|| format!("renaming {} to {}", from, to))?;
        }
        for (path, _, contents) in &self.new_files {
            std::fs::write(dir.join(path), contents).with_context(|| format!("writing {}", path))?;
        }
        println!("Done: {} renamed, {} edited, {} created. Welcome to the woods.", self.renames.len(), self.edits.len(), self.new_files.len());
        Ok(())
    }
}

const ELEVENTY_CONFIGS: [&str; 4] = [".eleventy.js", "eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs"];
/// Files whose front matter and markup are rewritten.
const TEMPLATE_EXTENSIONS: [&str; 10] = ["md", "markdown", "njk", "liquid", "html", "hbs", "handlebars", "mustache", "edge", "ejs"];

/// Front matter keys, and their names in data files: (Eleventy's, ssqch's), from
/// the table of other generators' words.
fn keys() -> impl Iterator<Item = (&'static str, &'static str)> {
    use sitesquatch::equivalents::{Kind, TABLE};
    TABLE.iter().filter(|e| e.kind == Kind::FrontMatter && e.from.contains(&"Eleventy")).map(|e| (e.word, e.ssqch))
}

static DATA_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.11tydata\.(js|cjs|mjs|json|ya?ml|toml)$").unwrap());
static IMAGE_ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\beleventy:(widths|ignore)\b").unwrap());
static TEMPLATE_GLOBAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\beleventy\.(generator|version)\b").unwrap());
static CALL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\.\s*(addFilter|addAsyncFilter|addNunjucksFilter|addLiquidFilter|addNunjucksAsyncFilter|addShortcode|addAsyncShortcode|addNunjucksShortcode|addLiquidShortcode|addPairedShortcode|addPairedAsyncShortcode|addCollection|addTransform|addGlobalData|addPlugin|addPassthroughCopy|addWatchTarget|setLibrary|addDataExtension|addTemplateFormats|setTemplateFormats|on)\s*\(\s*(?:["'`]([^"'`]*)["'`]|([A-Za-z_$][\w$.]*))?"#).unwrap()
});
static SETTING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\b(input|output|includes|layouts|data|markdownTemplateEngine|htmlTemplateEngine|pathPrefix)\s*:\s*["'`]([^"'`]*)["'`]"#).unwrap());
static FORMATS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"templateFormats\s*:\s*\[([^\]]*)\]"#).unwrap());
static REQUIRE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?:require\(\s*|from\s+)["'](@11ty/[\w./-]+|markdown-it[\w-]*|eleventy-[\w-]+|@[\w-]+/eleventy-[\w-]+)["']"#).unwrap());

/// The plan for the Eleventy site in `dir`.
pub fn eleventy(dir: &Path) -> Result<Plan> {
    if !dir.is_dir() {
        bail!("{} isn't a folder", dir.display());
    }
    let config = ELEVENTY_CONFIGS.iter().find(|name| dir.join(name).is_file());
    let config_text = match config {
        Some(name) => std::fs::read_to_string(dir.join(name)).with_context(|| format!("reading {}", name))?,
        None => String::new(),
    };
    let setting = |key: &str| SETTING.captures_iter(&config_text).find(|c| &c[1] == key).map(|c| c[2].to_string());
    let output = setting("output").unwrap_or_else(|| "_site".into());
    let mut plan = Plan { from: "Eleventy", ..Default::default() };
    let mut extensions: BTreeSet<String> = BTreeSet::new();

    let walker = walkdir::WalkDir::new(dir).sort_by_file_name().into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        e.depth() == 0 || !(name.starts_with(".git") || name == "node_modules" || name == ".cache" || e.path().strip_prefix(dir).is_ok_and(|rel| rel == Path::new(&output)))
    });
    for entry in walker {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = sitesquatch::slashes(path.strip_prefix(dir).unwrap_or(path));
        let name = entry.file_name().to_string_lossy().to_string();
        let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if DATA_FILE.is_match(&name) {
            plan.renames.push((rel.clone(), DATA_FILE.replace(&rel, ".data.$1").into_owned()));
        }
        if name.ends_with(".11ty.js") || name.ends_with(".11ty.cjs") {
            plan.by_hand.push((rel.clone(), "JavaScript templates don't run in ssqch: rewrite it as a template, or as an engine of your own (`engines` in the config)".into()));
            continue;
        }
        if ext == "webc" {
            plan.by_hand.push((rel.clone(), "WebC isn't supported: rewrite it as a template, with custom elements from `ssqch/elements` for the interactive parts".into()));
            continue;
        }
        let is_template = TEMPLATE_EXTENSIONS.contains(&ext.as_str());
        let is_data = DATA_FILE.is_match(&name) || (matches!(ext.as_str(), "json" | "yaml" | "yml") && !name.starts_with("package"));
        if !is_template && !is_data {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else { continue };
        if is_template {
            extensions.insert(if ext == "markdown" { "md".into() } else { ext.clone() });
        }
        let (new, changes) = if is_template { rewrite_template(&text, matches!(ext.as_str(), "md" | "markdown")) } else { rewrite_data(&text) };
        if !changes.is_empty() {
            plan.edits.push((rel.clone(), changes, new));
        }
        if is_template && (text.contains("eleventy.env") || text.contains("eleventy.directories")) {
            plan.by_hand.push((rel, "`eleventy.env` and `eleventy.directories` aren't there: use `ssqch.env` and `ssqch.serving`".into()));
        }
    }

    package_files(dir, &mut plan)?;
    match config {
        Some(name) => {
            let (source, by_hand) = draft_config(name, &config_text, &extensions);
            plan.by_hand.extend(by_hand);
            if sitesquatch_js::find_config(dir).is_none() {
                plan.new_files.push(("ssqch.config.js".into(), format!("a first draft, from {}", name), source));
            } else {
                plan.by_hand.push(("ssqch.config.js".into(), "it's already there, so the draft from the Eleventy config wasn't written".into()));
            }
        }
        None => plan.by_hand.push((".".into(), format!("no Eleventy config here ({}): is this the site's folder?", ELEVENTY_CONFIGS.join(", ")))),
    }
    Ok(plan)
}

/// A template with ssqch's front matter keys, image attributes and globals.
fn rewrite_template(text: &str, markdown: bool) -> (String, Vec<String>) {
    let mut changes = Vec::new();
    // Front matter: the keys at the start of a line, in the block at the top.
    let (front, body) = match text.strip_prefix("---").and_then(|rest| rest.find("\n---").map(|end| text.split_at(end + 3 + 4))) {
        Some((front, body)) => (front.to_string(), body),
        None => (String::new(), text),
    };
    let mut front = front;
    for (from, to) in keys() {
        let key = Regex::new(&format!(r#"(?m)^(\s*["']?){}(["']?\s*:)"#, from)).unwrap();
        if key.is_match(&front) {
            front = key.replace_all(&front, format!("${{1}}{}${{2}}", to)).into_owned();
            changes.push(format!("{} -> {}", from, to));
        }
    }
    // In the body, only where the names mean something: an attribute inside an
    // HTML tag, a global inside a template tag. A post about Eleventy keeps its
    // prose, and in Markdown its code samples.
    let (mut attrs, mut globals) = (false, false);
    let body = outside_code(body, markdown, |part| {
        let part = HTML_TAG.replace_all(part, |c: &regex::Captures| {
            attrs |= IMAGE_ATTR.is_match(&c[0]);
            IMAGE_ATTR.replace_all(&c[0], "ssqch:$1").into_owned()
        });
        TEMPLATE_TAG
            .replace_all(&part, |c: &regex::Captures| {
                globals |= TEMPLATE_GLOBAL.is_match(&c[0]);
                TEMPLATE_GLOBAL.replace_all(&c[0], "ssqch.$1").into_owned()
            })
            .into_owned()
    });
    if attrs {
        changes.push("eleventy:widths/ignore -> ssqch:widths/ignore".into());
    }
    if globals {
        changes.push("eleventy.generator/version -> ssqch.generator/version".into());
    }
    (format!("{}{}", front, body), changes)
}

static HTML_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[A-Za-z][^<>]*>").unwrap());
static TEMPLATE_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)\{\{.*?\}\}|\{%.*?%\}").unwrap());

/// `text` with `change` applied to everything that isn't a code sample. In
/// Markdown, that leaves out fenced blocks and `inline code`; other templates
/// have no code samples to tell apart, so all of the text is changed.
fn outside_code(text: &str, markdown: bool, mut change: impl FnMut(&str) -> String) -> String {
    if !markdown {
        return change(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut fence: Option<&str> = None;
    let mut prose = String::new();
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") { Some("```") } else if trimmed.starts_with("~~~") { Some("~~~") } else { None };
        match (fence, marker) {
            (None, Some(m)) => {
                out.push_str(&change_prose(&std::mem::take(&mut prose), &mut change));
                fence = Some(m);
                out.push_str(line);
            }
            (Some(open), Some(m)) if open == m => {
                fence = None;
                out.push_str(line);
            }
            (Some(_), _) => out.push_str(line),
            (None, None) => prose.push_str(line),
        }
    }
    out.push_str(&change_prose(&prose, &mut change));
    out
}

/// Prose with `change` applied around its `inline code`.
fn change_prose(prose: &str, change: &mut impl FnMut(&str) -> String) -> String {
    let mut out = String::with_capacity(prose.len());
    for (i, part) in prose.split('`').enumerate() {
        if i > 0 {
            out.push('`');
        }
        // Between the first and second backtick, the third and fourth, and so on, is code.
        if i % 2 == 1 { out.push_str(part) } else { out.push_str(&change(part)) }
    }
    out
}

/// A data file with ssqch's names for the keys Eleventy reads: only where
/// they're keys (`"eleventyComputed":`, `eleventyComputed:`), not in values.
fn rewrite_data(text: &str) -> (String, Vec<String>) {
    let mut out = text.to_string();
    let mut changes = Vec::new();
    for (from, to) in keys() {
        // Quoted (JSON), at the start of a line (YAML, JavaScript), or right after `{{` or `,`.
        let key = Regex::new(&format!(r#"(?m)(["']){0}(["']\s*:)|(^[ \t]*|[{{,][ \t]*){0}(\s*:)"#, from)).unwrap();
        if key.is_match(&out) {
            out = key.replace_all(&out, format!("${{1}}${{3}}{}${{2}}${{4}}", to)).into_owned();
            changes.push(format!("{} -> {}", from, to));
        }
    }
    (out, changes)
}

/// What an Eleventy plugin or library is in ssqch.
fn replacement(package: &str) -> Option<&'static str> {
    Some(match package {
        "@11ty/eleventy-img" => "`imagePlugin()` from \"ssqch/image\" (every <img> becomes a <picture>), or `image()` in data files",
        "@11ty/eleventy-plugin-rss" => "`rssPlugin()` from \"ssqch/rss\"",
        "@11ty/eleventy-plugin-syntaxhighlight" => "`markdown: { highlight: true }`",
        "@11ty/eleventy-navigation" => "`nav` front matter and `pagesTree(collections.all)`, with `navTree`, `navPager` and `navBreadcrumbs`",
        "@11ty/eleventy-fetch" => "`fetch(url, { cache: \"1d\" })`",
        "@11ty/eleventy-plugin-bundle" | "@11ty/eleventy-plugin-webc" | "@11ty/is-land" => "custom elements with `elementsPlugin()` from \"ssqch/elements\"",
        "@11ty/eleventy-upgrade-help" | "@11ty/eleventy" | "@11ty/eleventy-dev-server" => return None,
        "markdown-it" => "ssqch's own Markdown: see the `markdown` options, render hooks and containers",
        "markdown-it-anchor" => "heading ids are built in; add anchor links with `_includes/hooks/heading.*`",
        "markdown-it-footnote" => "built in (`markdown: { footnotes: true }`, the default)",
        "markdown-it-container" => "built in: `::: name` renders `_includes/containers/name.*`",
        "markdown-it-attrs" => "`{#id .class}` on headings is built in",
        _ => "check whether it's needed: see `ssqch docs --from eleventy`",
    })
}

/// How a config is written, so the draft reads like the site's own code.
struct Style {
    /// One level of indentation: a tab, or the config's number of spaces.
    indent: String,
    /// Spaces inside brackets and parentheses: `[ "md" ]`, `defineConfig( {`.
    padded: bool,
    /// A comma after the last item of a multi-line object or list.
    dangle: bool,
    /// Quotes around every key (`"input": "src"`), not only the ones that need them.
    quote_keys: bool,
}

impl Style {
    fn of(text: &str) -> Style {
        let indents: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).map(|l| &l[..l.len() - l.trim_start().len()]).filter(|i| !i.is_empty()).collect();
        let indent = match indents.first() {
            Some(first) if first.starts_with('\t') => "\t".to_string(),
            Some(_) => " ".repeat(indents.iter().filter(|i| !i.contains('\t')).map(|i| i.len()).min().unwrap_or(2).clamp(1, 8)),
            None => "  ".to_string(),
        };
        static PADDED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[(\[][ \t]+[^\s)\]]").unwrap());
        static TIGHT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[(\[][^\s)\]]").unwrap());
        let padded = PADDED.find_iter(text).count() > TIGHT.find_iter(text).count();
        // A closing bracket on its own line, after a comma or after a value (not after a
        // statement's `;`, which ends a function body).
        static DANGLING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r",[ \t]*\r?\n[ \t]*[}\]]").unwrap());
        static CLOSED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\s,;{\[(][ \t]*\r?\n[ \t]*[}\]]").unwrap());
        let (dangling, closed) = (DANGLING.find_iter(text).count(), CLOSED.find_iter(text).count());
        let dangle = dangling >= closed;
        static BARE_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[{,]\s*[A-Za-z_$][\w$]*\s*:").unwrap());
        static QUOTED_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[{,]\s*["'][^"'\n]*["']\s*:"#).unwrap());
        let quote_keys = !BARE_KEY.is_match(text) && QUOTED_KEY.is_match(text);
        Style { indent, padded, dangle, quote_keys }
    }

    /// An object key: quoted when it isn't an identifier, or when the config quotes every key.
    fn key(&self, key: &str) -> String {
        let identifier = !key.is_empty() && !key.starts_with(|c: char| c.is_ascii_digit()) && key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$');
        if identifier && !self.quote_keys { key.to_string() } else { format!("\"{}\"", key) }
    }

    /// Multi-line items (each already indented, without a comma), with commas
    /// between them and, if the config has them, after the last.
    fn items(&self, items: &[String]) -> String {
        let mut out = String::new();
        for (i, item) in items.iter().enumerate() {
            out.push_str(item);
            if i + 1 < items.len() || self.dangle {
                out.push(',');
            }
            out.push('\n');
        }
        out
    }

    /// `[a, b]` or `[ a, b ]`.
    fn list(&self, items: &[String]) -> String {
        if self.padded { format!("[ {} ]", items.join(", ")) } else { format!("[{}]", items.join(", ")) }
    }
}

/// Where the bracket that opens at `open` closes, skipping strings, template
/// literals and comments.
fn closing_bracket(text: &str, open: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            q @ (b'"' | b'\'' | b'`') => {
                i += 1;
                while i < bytes.len() && bytes[i] != q {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = text[i + 2..].find("*/").map_or(bytes.len(), |end| i + 2 + end + 1);
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// `code` split at its top-level commas.
fn top_level_args(code: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut start, mut i) = (0, 0);
    let bytes = code.as_bytes();
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' | b'{' | b'"' | b'\'' | b'`' => {
                i = if matches!(bytes[i], b'"' | b'\'' | b'`') {
                    let q = bytes[i];
                    let mut j = i + 1;
                    while j < bytes.len() && bytes[j] != q {
                        j += if bytes[j] == b'\\' { 2 } else { 1 };
                    }
                    j
                } else {
                    closing_bracket(code, i).unwrap_or(bytes.len())
                };
            }
            b',' => {
                parts.push(code[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    parts.push(code[start.min(code.len())..].trim());
    parts.retain(|p| !p.is_empty());
    parts
}

/// A JavaScript string literal's text (`"images"`, `'images'`), without escapes.
fn string_literal(code: &str) -> Option<&str> {
    let code = code.trim();
    let quote = code.chars().next().filter(|c| matches!(c, '"' | '\'' | '`'))?;
    let inner = code.strip_prefix(quote)?.strip_suffix(quote)?;
    (!inner.contains(['\\', quote]) && !(quote == '`' && inner.contains("${"))).then_some(inner)
}

/// `{ "src/static": "/", images: "images" }` as passthrough entries, if every
/// key and value is written out (no variables or computed values).
fn passthrough_object(code: &str) -> Option<Vec<(String, String)>> {
    let inner = code.trim().strip_prefix('{')?.strip_suffix('}')?;
    let pairs: Option<Vec<(String, String)>> = top_level_args(inner)
        .into_iter()
        .map(|pair| {
            let (key, value) = pair.split_once(':')?;
            let key = key.trim();
            let key = string_literal(key).map(String::from).or_else(|| (!key.is_empty() && key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '$')).then(|| key.to_string()))?;
            Some((key, string_literal(value)?.to_string()))
        })
        .collect();
    pairs.filter(|p| !p.is_empty())
}

static FUNCTION_EXPR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)").unwrap());
static DECLARED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(?:const|let|var|function|class|import)\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)").unwrap());
static DESTRUCTURED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(?:const|let|var|import)\s*\{([^}]*)\}").unwrap());

/// The names a config declares (imports, requires, functions, variables), to
/// tell a function that only uses its own arguments from one that needs
/// something else in the file.
fn declared_names(text: &str) -> BTreeSet<String> {
    let mut names: BTreeSet<String> = DECLARED.captures_iter(text).map(|c| c[1].to_string()).collect();
    for c in DESTRUCTURED.captures_iter(text) {
        for part in c[1].split(',') {
            let name = part.rsplit([':', ' ']).find(|w| !w.trim().is_empty()).unwrap_or("").trim();
            if !name.is_empty() {
                names.insert(name.to_string());
            }
        }
    }
    names.insert("eleventyConfig".into());
    names
}

/// A filter's or shortcode's function, if it can move to `filters` as written:
/// a function expression that uses nothing from the rest of the config (no
/// imports, no variables, no `eleventyConfig`, no `this`, which is Eleventy's
/// page context).
fn portable_function<'a>(source: &'a str, config: &str, declared: &BTreeSet<String>) -> Option<&'a str> {
    if !FUNCTION_EXPR.is_match(source) || source.contains("this") {
        return None;
    }
    // Names the function declares itself (its parameters, its own variables) are fine.
    let own = declared_names(source);
    let params: BTreeSet<&str> = FUNCTION_EXPR.find(source).map(|m| m.as_str()).unwrap_or("").split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$')).collect();
    let rest = config.replacen(source, "", 1);
    let outside = declared_names(&rest);
    let uses = |name: &str| Regex::new(&format!(r"(^|[^\w$.]){}([^\w$]|$)", regex::escape(name))).unwrap().is_match(source);
    let foreign = declared.iter().filter(|n| outside.contains(*n) && !own.contains(*n) && !params.contains(n.as_str())).any(|n| uses(n));
    (!foreign).then_some(source)
}

/// `source` moved from `from_indent` to `to_indent`: its first line as it is,
/// the others with `from_indent` swapped for `to_indent`.
fn reindent(source: &str, from_indent: &str, to_indent: &str) -> String {
    let mut lines = source.lines();
    let mut out = lines.next().unwrap_or("").to_string();
    for line in lines {
        out.push('\n');
        if !line.trim().is_empty() {
            out.push_str(to_indent);
            out.push_str(line.strip_prefix(from_indent).unwrap_or(line.trim_start()));
        }
    }
    out
}

/// A first `ssqch.config.js` from an Eleventy config, and what in it needs porting.
fn draft_config(name: &str, text: &str, extensions: &BTreeSet<String>) -> (String, Vec<(String, String)>) {
    let setting = |key: &str| SETTING.captures_iter(text).find(|c| &c[1] == key).map(|c| c[2].to_string());
    let line_of = |offset: usize| text[..offset].matches('\n').count() + 1;
    let style = Style::of(text);
    let ind = style.indent.as_str();
    let declared = declared_names(text);
    let mut by_hand: Vec<(String, String)> = Vec::new();
    let mut passthrough: Vec<String> = Vec::new();
    let mut watch: Vec<String> = Vec::new();
    let mut todo: Vec<String> = Vec::new();
    // Filters and shortcodes moved as written: (name, function source).
    let mut ported: Vec<(String, String)> = Vec::new();
    for c in CALL.captures_iter(text) {
        let (method, quoted, bare) = (&c[1], c.get(2).map(|m| m.as_str()), c.get(3).map(|m| m.as_str()));
        let whole = c.get(0).unwrap();
        let at = format!("{}:{}", name, line_of(whole.start()));
        let arg = quoted.or(bare).unwrap_or("...");
        // The call's arguments, as written.
        let open = whole.start() + whole.as_str().find('(').unwrap_or(0);
        let args: Vec<&str> = closing_bracket(text, open).map(|close| top_level_args(&text[open + 1..close])).unwrap_or_default();
        let call_indent = text[..whole.start()].rsplit('\n').next().map(|l| &l[..l.len() - l.trim_start().len()]).unwrap_or("");
        let port = |ported: &mut Vec<(String, String)>| -> bool {
            let (Some(name), Some(function)) = (quoted, args.get(1)) else { return false };
            if args.len() != 2 {
                return false;
            }
            match portable_function(function, text, &declared) {
                Some(source) => {
                    ported.push((name.to_string(), reindent(source, call_indent, &ind.repeat(2))));
                    true
                }
                None => false,
            }
        };
        match method {
            "addPassthroughCopy" => match (quoted, args.first().and_then(|a| passthrough_object(a))) {
                (Some(path), _) => passthrough.push(format!("\"{}\"", path)),
                (None, Some(pairs)) => {
                    for (from, to) in pairs {
                        passthrough.push(format!("{{ {}: \"{}\" }}", style.key(&from), to));
                    }
                }
                (None, None) => by_hand.push((at, "addPassthroughCopy with a variable or a computed value -> `passthrough: [{ from: to }]`".into())),
            },
            "addWatchTarget" => match quoted {
                Some(path) => watch.push(format!("\"{}\"", path)),
                None => by_hand.push((at, "addWatchTarget -> `watch`".into())),
            },
            "addFilter" | "addAsyncFilter" | "addNunjucksFilter" | "addLiquidFilter" => {
                if !port(&mut ported) {
                    todo.push(format!("filters: {}", arg));
                    by_hand.push((at, format!("{}(\"{}\") -> `filters: {{ {}: ... }}` (async functions are awaited)", method, arg, arg)));
                }
            }
            "addNunjucksAsyncFilter" => {
                todo.push(format!("filters: {}", arg));
                by_hand.push((at, format!("{}(\"{}\") -> `filters: {{ {}: async (value) => ... }}`: return the result instead of calling the callback", method, arg, arg)));
            }
            "addShortcode" | "addAsyncShortcode" | "addNunjucksShortcode" | "addLiquidShortcode" => {
                if !port(&mut ported) {
                    todo.push(format!("filters: {}", arg));
                    by_hand.push((at, format!("{}(\"{}\") -> a filter: `filters: {{ {}: ... }}`. Nunjucks keeps `{{% {} ... %}}`; in Liquid it's `{{{{ x | {} }}}}`", method, arg, arg, arg, arg)));
                }
            }
            "addPairedShortcode" | "addPairedAsyncShortcode" => {
                if !port(&mut ported) {
                    todo.push(format!("filters: {}", arg));
                    by_hand.push((at, format!("{}(\"{}\") -> a filter that gets the content first. Nunjucks keeps `{{% {} %}}...{{% end{} %}}`; in Markdown, a `::: {}` container", method, arg, arg, arg, arg)));
                }
            }
            "addCollection" => {
                todo.push(format!("collections: {}", arg));
                by_hand.push((at, format!("addCollection(\"{}\") -> `collections: {{ {}: (pages) => ... }}`: getAll() is pages.all(), getFilteredByTag is pages.byTag, getFilteredByGlob is pages.byGlob", arg, arg)));
            }
            "addTransform" => by_hand.push((at, format!("addTransform(\"{}\") -> `transforms: {{ {}: (content, page) => content }}` (an HTML minifier is `minifyPlugin()`)", arg, arg))),
            "addGlobalData" => by_hand.push((at, format!("addGlobalData(\"{}\") -> `data: {{ {}: value or function }}`", arg, arg))),
            "addPlugin" => by_hand.push((at, format!("addPlugin({}) -> see its package below, or `plugins: [...]` for one of your own", arg))),
            "setLibrary" => by_hand.push((at, "setLibrary -> ssqch renders Markdown itself: `markdown: { ... }` options, render hooks and containers".into())),
            "addDataExtension" => by_hand.push((at, "addDataExtension -> YAML, TOML and JSON data files load as they are".into())),
            "on" if quoted.is_some_and(|e| e.starts_with("eleventy.")) => by_hand.push((at, format!("on(\"{}\") -> `beforeBuild` or `afterBuild`", arg))),
            _ => {}
        }
    }
    let mut packages: BTreeSet<&str> = REQUIRE.captures_iter(text).filter_map(|c| c.get(1).map(|m| m.as_str())).collect();
    packages.retain(|p| replacement(p).is_some());
    for package in &packages {
        by_hand.push((name.to_string(), format!("{} -> {}", package, replacement(package).unwrap_or_default())));
    }

    // Eleventy runs Markdown and HTML through Liquid unless told otherwise.
    let engine = |key: &str| match setting(key).as_deref() {
        Some("njk") => Some("\"njk\"".to_string()),
        Some("false") | Some("") => Some("false".to_string()),
        Some(other) => Some(format!("\"{}\"", other)),
        None if text.contains(&format!("{}: false", key)) => Some("false".to_string()),
        None => None,
    };
    let (markdown_engine, html_engine) = (engine("markdownTemplateEngine"), engine("htmlTemplateEngine"));
    let engines_comment = match (&markdown_engine, &html_engine) {
        (None, None) => "Eleventy's defaults: Markdown and HTML run through Liquid first.",
        (Some(_), None) => "From the Eleventy config's markdownTemplateEngine; HTML runs through Liquid first, Eleventy's default.",
        (None, Some(_)) => "From the Eleventy config's htmlTemplateEngine; Markdown runs through Liquid first, Eleventy's default.",
        (Some(_), Some(_)) => "From the Eleventy config's markdownTemplateEngine and htmlTemplateEngine.",
    };
    let liquid = || "\"liquid\"".to_string();
    let formats: Vec<String> = match FORMATS.captures(text) {
        Some(c) => c[1].split(',').map(|f| f.trim().trim_matches(['"', '\'', '`']).to_string()).filter(|f| !f.is_empty() && f != "11ty.js").collect(),
        None => extensions.iter().filter(|e| e.as_str() != "edge").cloned().collect(),
    };
    let quoted = |items: &[String]| style.list(&items.iter().map(|i| format!("\"{}\"", i)).collect::<Vec<_>>());
    let mut dirs: Vec<String> = Vec::new();
    for key in ["input", "output", "includes", "layouts", "data"] {
        if let Some(value) = setting(key) {
            dirs.push(format!("{}: \"{}\"", key, value));
        }
    }
    let (open, close) = if style.padded { ("( {", "} )") } else { ("({", "})") };
    let mut out = format!("// A first draft, written by `ssqch import eleventy` from {}.\n// What it couldn't carry over is listed at the end; `ssqch docs --from eleventy` has the whole\n// mapping.\nimport {{ defineConfig }} from \"ssqch\";\n\nexport default defineConfig{}\n", name, open);
    let mut entries: Vec<String> = Vec::new();
    if !dirs.is_empty() {
        entries.push(format!("{}dirs: {{ {} }}", ind, dirs.join(", ")));
    }
    if !formats.is_empty() {
        entries.push(format!("{}templateFormats: {}", ind, quoted(&formats)));
    }
    entries.push(format!("{0}// {1}\n{0}markdownEngine: {2}", ind, engines_comment, markdown_engine.unwrap_or_else(liquid)));
    entries.push(format!("{}htmlEngine: {}", ind, html_engine.unwrap_or_else(liquid)));
    if let Some(prefix) = setting("pathPrefix").filter(|p| p != "/") {
        entries.push(format!("{}base: \"{}\"", ind, prefix));
    }
    if !passthrough.is_empty() {
        entries.push(format!("{}passthrough: {}", ind, style.list(&passthrough)));
    }
    if !watch.is_empty() {
        entries.push(format!("{}watch: {}", ind, style.list(&watch)));
    }
    let port_here = format!("{0}{0}// Port each filter and shortcode here: name: (value, ...args) => result\n", ind);
    let mut filters = format!("\n{}filters: {{\n", ind);
    if ported.is_empty() {
        filters.push_str(&port_here);
    } else {
        // Without trailing commas, the last filter ends the object, so the comment goes first.
        if !style.dangle {
            filters.push_str(&port_here);
        }
        filters.push_str(&format!("{0}{0}// From {1}, as written.\n", ind, name));
        let items: Vec<String> = ported.iter().map(|(filter, source)| format!("{0}{0}{1}: {2}", ind, style.key(filter), source)).collect();
        filters.push_str(&style.items(&items));
        if style.dangle {
            filters.push_str(&port_here);
        }
    }
    filters.push_str(&format!("{}}}", ind));
    entries.push(filters);
    entries.push(format!("{0}collections: {{\n{0}{0}// name: (pages) => pages.byTag(\"post\")\n{0}}}", ind));
    entries.push(format!("{}plugins: []", ind));
    out.push_str(&style.items(&entries));
    out.push_str(&format!("{};\n", close));
    if !todo.is_empty() {
        out.push_str(&format!("\n// To port from {}:\n", name));
        for item in &todo {
            out.push_str(&format!("//   {}\n", item));
        }
    }
    (out, by_hand)
}

/// The package manager a site uses: `packageManager` in package.json, or the
/// lockfile that's there.
fn package_manager(dir: &Path, package: &serde_json::Value) -> &'static str {
    let named = package["packageManager"].as_str().unwrap_or("");
    if let Some((pm, _)) = LOCKFILES.iter().find(|(pm, _)| named.split('@').next() == Some(pm)) {
        return pm;
    }
    LOCKFILES.iter().find(|(_, lockfiles)| lockfiles.iter().any(|l| dir.join(l).is_file())).map_or("npm", |(pm, _)| pm)
}

const LOCKFILES: [(&str, &[&str]); 4] = [("pnpm", &["pnpm-lock.yaml"]), ("yarn", &["yarn.lock"]), ("bun", &["bun.lock", "bun.lockb"]), ("npm", &["package-lock.json", "npm-shrinkwrap.json"])];

static ELEVENTY_COMMAND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:\bnpx\s+(?:-y\s+)?)?(?:@11ty/)?\beleventy\b((?:\s+--?[\w-]+(?:[= ](?:\x22[^\x22]*\x22|'[^']*'|[^\s&|;\x22-][^\s&|;\x22]*))?)*)").unwrap());

/// An npm script with ssqch's commands for Eleventy's (`eleventy --serve` is
/// `ssqch serve`), and the flags it couldn't carry over.
fn rewrite_script(script: &str) -> (String, Vec<String>) {
    let mut unknown = Vec::new();
    let out = ELEVENTY_COMMAND.replace_all(script, |c: &regex::Captures| {
        let mut command = "build";
        let mut flags: Vec<String> = Vec::new();
        let mut parts = c[1].split_whitespace().peekable();
        while let Some(part) = parts.next() {
            let (flag, value) = match part.split_once('=') {
                Some((f, v)) => (f, Some(v.to_string())),
                None => (part, None),
            };
            match flag {
                "--serve" | "--watch" => command = "serve",
                "--quiet" => flags.push("--quiet".into()),
                "--port" => {
                    let value = value.or_else(|| parts.next_if(|p| !p.starts_with('-')).map(String::from));
                    if let Some(port) = value {
                        flags.push(format!("--port {}", port));
                    }
                }
                "--output" => {
                    let value = value.or_else(|| parts.next_if(|p| !p.starts_with('-')).map(String::from));
                    if let Some(output) = value {
                        flags.push(format!("--output {}", output));
                    }
                }
                "--pathprefix" | "--pathPrefix" => {
                    let value = value.or_else(|| parts.next_if(|p| !p.starts_with('-')).map(String::from));
                    if let Some(base) = value {
                        flags.push(format!("--base {}", base));
                    }
                }
                "--incremental" => {}
                other => unknown.push(other.to_string()),
            }
        }
        if command == "build" {
            flags.retain(|f| !f.starts_with("--port"));
        }
        let mut out = format!("ssqch {}", command);
        for flag in flags {
            out.push(' ');
            out.push_str(&flag);
        }
        out
    });
    (out.into_owned(), unknown)
}

/// package.json with ssqch for Eleventy, in the dependencies and the scripts,
/// and what's left: lockfiles to update or remove.
fn package_files(dir: &Path, plan: &mut Plan) -> Result<()> {
    let path = dir.join("package.json");
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(()) };
    let Ok(mut package) = serde_json::from_str::<serde_json::Value>(&text) else {
        plan.by_hand.push(("package.json".into(), "isn't valid JSON, so its Eleventy dependency and scripts weren't changed".into()));
        return Ok(());
    };
    let version = env!("CARGO_PKG_VERSION");
    let mut changes = Vec::new();
    // The dependency: Eleventy's goes, and ssqch is a dev dependency (it builds the site; the
    // site doesn't import it at run time), pinned exactly, as the README's Install says.
    let has_ssqch = ["dependencies", "devDependencies"].iter().any(|k| package[k].get("ssqch").is_some());
    let mut removed = false;
    for section in ["dependencies", "devDependencies"] {
        if let Some(deps) = package.get_mut(section).and_then(|d| d.as_object_mut()) {
            removed |= deps.shift_remove("@11ty/eleventy").is_some();
            if deps.is_empty() && section == "dependencies" {
                package.as_object_mut().map(|p| p.shift_remove(section));
            }
        }
    }
    if removed {
        if has_ssqch {
            changes.push("@11ty/eleventy removed (ssqch is already there)".to_string());
        } else {
            let root = package.as_object_mut().expect("package.json is an object");
            let dev = root.entry("devDependencies").or_insert_with(|| serde_json::json!({}));
            if let Some(dev) = dev.as_object_mut() {
                dev.insert("ssqch".into(), serde_json::Value::String(version.into()));
                dev.sort_keys();
            }
            changes.push(format!("@11ty/eleventy -> ssqch {} in devDependencies", version));
        }
    }
    // The scripts: each string value in the `scripts` object.
    let mut unknown_flags = Vec::new();
    if let Some(scripts) = package.get_mut("scripts").and_then(|s| s.as_object_mut()) {
        let mut changed = false;
        for (name, script) in scripts.iter_mut() {
            let Some(text) = script.as_str() else { continue };
            let (rewritten, unknown) = rewrite_script(text);
            if rewritten != text {
                *script = serde_json::Value::String(rewritten);
                changed = true;
            }
            if !unknown.is_empty() {
                unknown_flags.push(format!("the `{}` script's {} {} Eleventy's: check what ssqch has (`ssqch build --help`, `ssqch serve --help`)", name, unknown.join(", "), if unknown.len() == 1 { "flag is" } else { "flags are" }));
            }
        }
        if changed {
            changes.push("scripts: eleventy -> ssqch build, eleventy --serve -> ssqch serve".into());
        }
    }
    plan.by_hand.extend(unknown_flags.into_iter().map(|what| ("package.json".to_string(), what)));
    let edited = !changes.is_empty();
    if edited {
        // Written the way npm writes it: the file's own indentation, and its last line break.
        let indent: String = text.lines().nth(1).map(|l| l[..l.len() - l.trim_start().len()].to_string()).filter(|i| !i.is_empty()).unwrap_or_else(|| "  ".into());
        // serde_json indents by two spaces; line breaks inside strings are escaped, so each
        // line's leading spaces are indentation.
        let mut new = serde_json::to_string_pretty(&package)?
            .lines()
            .map(|line| {
                let depth = (line.len() - line.trim_start_matches(' ').len()) / 2;
                format!("{}{}", indent.repeat(depth), line.trim_start_matches(' '))
            })
            .collect::<Vec<_>>()
            .join("\n");
        if text.ends_with('\n') {
            new.push('\n');
        }
        plan.edits.push(("package.json".into(), changes, new));
    }
    // Lockfiles: the package manager's needs updating, another one's is stale.
    let pm = package_manager(dir, &package);
    for (manager, lockfiles) in LOCKFILES {
        for lockfile in lockfiles.iter().filter(|l| dir.join(l).is_file()) {
            let mentions = std::fs::read(dir.join(lockfile)).is_ok_and(|b| String::from_utf8_lossy(&b).contains("@11ty/eleventy"));
            if manager != pm {
                plan.by_hand.push(((*lockfile).into(), format!("{}'s lockfile, but the site uses {}: delete it (a host that installs from it gets {} and no ssqch)", manager, pm, if mentions { "Eleventy" } else { "old packages" })));
            } else if mentions || edited {
                plan.by_hand.push(((*lockfile).into(), format!("run `{} install` to update it for ssqch", pm)));
            }
        }
    }
    // pnpm 11 and later wait a day before installing a release.
    if pm == "pnpm" && edited && waits_for_release_age(dir, &package) {
        plan.by_hand.push((
            "pnpm-workspace.yaml".into(),
            format!("pnpm waits a day before installing a new release, so if ssqch {} came out today, the install fails: add `ssqch` and `@ssqch/darwin-arm64`, `@ssqch/darwin-x64`, `@ssqch/linux-x64` and `@ssqch/win32-x64` under `minimumReleaseAgeExclude` (`ssqch docs \"release age\"`)", version),
        ));
    }
    Ok(())
}

/// Whether pnpm would hold back a release made today: pnpm 11 or later (or a version
/// `packageManager` doesn't say), and ssqch not already excluded from `minimumReleaseAge`.
fn waits_for_release_age(dir: &Path, package: &serde_json::Value) -> bool {
    let major = package["packageManager"].as_str().and_then(|pm| pm.strip_prefix("pnpm@")).and_then(|v| v.split('.').next()).and_then(|m| m.parse::<u32>().ok());
    if major.is_some_and(|m| m < 11) {
        return false;
    }
    let workspace = std::fs::read_to_string(dir.join("pnpm-workspace.yaml")).unwrap_or_default();
    let excluded = workspace.lines().any(|l| l.trim_start().trim_start_matches('-').trim().trim_matches(['\'', '"']).split('@').next() == Some("ssqch"));
    let off = workspace.lines().any(|l| l.trim().replace(' ', "") == "minimumReleaseAge:0");
    !excluded && !off
}

// --------------------------------------------------------------------- Zola

static TERA_CALLS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(get_url|get_section|get_page|get_taxonomy|get_taxonomy_url|get_image_metadata|resize_image|load_data|trans|get_hash)\s*\(").unwrap());
static NAMED_ARGUMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\|\s*\w+\(\s*\w+\s*=").unwrap());
static SHORTCODE_CALL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{[{%]\s*([a-z_][a-z0-9_]*)\s*\(").unwrap());

/// A Zola page's front matter with ssqch's names: `tags` out of
/// `[taxonomies]` to the top level, and `path` as a `permalink`.
fn rewrite_zola_front_matter(text: &str) -> (String, Vec<String>) {
    let Some(rest) = text.strip_prefix("+++") else { return (text.to_string(), Vec::new()) };
    let Some(end) = rest.find("\n+++") else { return (text.to_string(), Vec::new()) };
    let (front, after) = rest.split_at(end);
    let newline = if front.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = front.lines().collect();
    let mut changes = Vec::new();
    let mut top: Vec<String> = Vec::new();
    let mut tables: Vec<String> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut table = String::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.starts_with('[') && !trimmed.starts_with("[[") && trimmed.ends_with(']') {
            table = trimmed.trim_matches(['[', ']']).trim().to_string();
            tables.push(line.to_string());
        } else if table == "taxonomies" && trimmed.starts_with("tags") && trimmed[4..].trim_start().starts_with('=') {
            // The array can run over several lines.
            let mut value = line.to_string();
            while value.matches('[').count() > value.matches(']').count() && i + 1 < lines.len() {
                i += 1;
                value.push_str(newline);
                value.push_str(lines[i]);
            }
            tags.push(value.trim_start().to_string());
        } else if table.is_empty() && trimmed.starts_with("path") && trimmed[4..].trim_start().starts_with('=') {
            let value = trimmed[4..].trim_start().trim_start_matches('=').trim();
            let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'');
            match quote.and_then(|q| value[1..].find(q).map(|close| &value[1..close + 1])) {
                Some(path) => {
                    top.push(format!("permalink = \"/{}/\"", path.trim_matches('/')));
                    changes.push("path -> permalink".to_string());
                }
                None => top.push(line.to_string()),
            }
        } else if table.is_empty() {
            top.push(line.to_string());
        } else {
            tables.push(line.to_string());
        }
        i += 1;
    }
    if tags.is_empty() && changes.is_empty() {
        return (text.to_string(), Vec::new());
    }
    if !tags.is_empty() {
        changes.push("[taxonomies] tags -> tags".to_string());
        // Above the tables, after the last line that isn't blank.
        let at = top.iter().rposition(|l| !l.trim().is_empty()).map_or(0, |p| p + 1);
        for (n, tag_line) in tags.into_iter().enumerate() {
            top.insert(at + n, tag_line);
        }
        // A `[taxonomies]` table with nothing left in it goes too.
        if let Some(header) = tables.iter().position(|l| l.trim() == "[taxonomies]") {
            let next = tables[header + 1..].iter().position(|l| l.trim().starts_with('[')).map_or(tables.len(), |p| header + 1 + p);
            if tables[header + 1..next].iter().all(|l| l.trim().is_empty()) {
                tables.drain(header..next);
                while top.last().is_some_and(|l| l.trim().is_empty()) && tables.is_empty() {
                    top.pop();
                }
            }
        }
    }
    let mut out: Vec<String> = top;
    out.extend(tables);
    // `front` began with the line break after the opening `+++`.
    let body = out.join(newline);
    let body = body.strip_prefix(newline).unwrap_or(&body);
    (format!("+++{}{}{}", newline, body, after), changes)
}

/// The plan for the Zola site in `dir`.
pub fn zola(dir: &Path) -> Result<Plan> {
    let config_path = dir.join("config.toml");
    if !config_path.is_file() {
        bail!("there's no config.toml in {}: is this the Zola site's folder?", dir.display());
    }
    let config: toml::Table = toml::from_str(&std::fs::read_to_string(&config_path)?).context("config.toml")?;
    let mut plan = Plan { from: "Zola", ..Default::default() };
    let content = dir.join("content");
    let (mut sections, mut aliases, mut bundles, mut shortcodes) = (Vec::new(), false, false, BTreeSet::new());
    for entry in walkdir::WalkDir::new(&content).sort_by_file_name().into_iter().flatten() {
        let path = entry.path();
        if !entry.file_type().is_file() || path.extension().is_none_or(|e| e != "md") {
            continue;
        }
        let rel = sitesquatch::slashes(path.strip_prefix(dir).unwrap_or(path));
        let Ok(text) = std::fs::read_to_string(path) else { continue };
        if entry.file_name() == "_index.md" {
            sections.push(rel);
            continue;
        }
        if entry.file_name() == "index.md" && std::fs::read_dir(path.parent().unwrap_or(dir)).is_ok_and(|d| d.flatten().count() > 1) {
            bundles = true;
        }
        aliases |= text.contains("\naliases");
        shortcodes.extend(SHORTCODE_CALL.captures_iter(&text).map(|c| c[1].to_string()));
        if text.starts_with("---") && text.contains("taxonomies:") {
            plan.by_hand.push((rel.clone(), "YAML front matter with `taxonomies`: move `tags` to the top level".into()));
        }
        let (new, changes) = rewrite_zola_front_matter(&text);
        if !changes.is_empty() {
            plan.edits.push((rel, changes, new));
        }
    }
    for section in &sections {
        let folder = section.trim_end_matches("/_index.md");
        let name = folder.rsplit('/').next().unwrap_or(folder);
        plan.by_hand.push((section.clone(), format!("a section: its settings (`sort_by`, `paginate_by`, `page_template`) become directory data ({}/{}.json: `layout`, `tags`, `permalink`) and an index page that lists the folder's pages", folder, name)));
    }
    for name in &shortcodes {
        if dir.join("templates/shortcodes").join(format!("{}.html", name)).is_file() || dir.join("templates/shortcodes").join(format!("{}.md", name)).is_file() {
            plan.by_hand.push((format!("templates/shortcodes/{}.html", name), format!("a shortcode used in content: make it a config filter (`filters: {{ {}: ... }}`) or a macro; a body shortcode (`{{% {}() %}}...{{% end %}}`) becomes a `::: {}` container", name, name, name)));
        }
    }
    let templates = dir.join("templates");
    let mut tera: std::collections::BTreeMap<&'static str, usize> = Default::default();
    let mut template_count = 0;
    for entry in walkdir::WalkDir::new(&templates).into_iter().flatten().filter(|e| e.file_type().is_file()) {
        let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
        template_count += 1;
        let mut count = |what: &'static str, n: usize| {
            if n > 0 {
                *tera.entry(what).or_default() += n;
            }
        };
        count("Tera functions (get_url, get_section, load_data, resize_image...): filters or data in the config", TERA_CALLS.find_iter(&text).count());
        count("filters with named arguments (`| date(format=\"%Y\")`): positional in ssqch (`| dateformat(\"%Y\")`)", NAMED_ARGUMENT.find_iter(&text).count());
        count("`page.content`, `section.content`: `content` in a layout", text.matches("page.content").count() + text.matches("section.content").count());
        count("`section.pages`, `paginator.pages`: a collection (`collections.<tag>`), and `pagination.items`", text.matches("section.pages").count() + text.matches("paginator.").count());
        count("`page.title`, `page.extra`, `page.taxonomies`: front matter is at the top level (`title`, `extra`, `tags`)", text.matches("page.title").count() + text.matches("page.extra").count() + text.matches("page.taxonomies").count());
        count("`page.permalink`: `page.url`", text.matches("page.permalink").count() + text.matches(".permalink").count().saturating_sub(text.matches("page.permalink").count()));
    }
    if template_count > 0 {
        plan.by_hand.push(("templates/".into(), format!("{} Tera templates: they run as Jinja (`htmlEngine: \"jinja\"` in the draft config), and these need changing:", template_count)));
        for (what, n) in tera {
            plan.by_hand.push(("templates/".into(), format!("{} x {}", n, what)));
        }
    }

    let text = |key: &str| config.get(key).and_then(|v| v.as_str()).map(String::from);
    let flag = |key: &str| config.get(key).and_then(|v| v.as_bool()).unwrap_or(false) || config.get("markdown").and_then(|m| m.get(key)).and_then(|v| v.as_bool()).unwrap_or(false);
    let base_url = text("base_url").unwrap_or_default();
    let mut site = serde_json::Map::new();
    for key in ["base_url", "title", "description", "default_language"] {
        if let Some(value) = text(key) {
            site.insert(key.to_string(), serde_json::Value::String(value));
        }
    }
    if let Some(extra) = config.get("extra") {
        site.insert("extra".into(), serde_json::to_value(extra)?);
    }
    let mut imports = vec!["import { defineConfig } from \"ssqch\";".to_string(), "import { linksPlugin } from \"ssqch/links\";".to_string()];
    let mut plugins = Vec::new();
    if base_url.starts_with("http") {
        imports.push("import { sitemapPlugin } from \"ssqch/sitemap\";".into());
        plugins.push(format!("sitemapPlugin({{ url: {} }})", serde_json::to_string(&base_url)?));
    }
    if aliases {
        imports.push("import { redirectsPlugin } from \"ssqch/redirects\";".into());
        plugins.push("redirectsPlugin()".into());
    }
    if flag("compile_sass") && dir.join("sass").is_dir() {
        imports.push("import { sassPlugin } from \"ssqch/sass\";".into());
        plugins.push("sassPlugin({ files: { sass: \"/\" } })".into());
    }
    plugins.push("linksPlugin()".into());
    let mut markdown = vec!["headingIds: \"ascii\"".to_string()];
    if flag("highlight_code") {
        markdown.push("highlight: true".into());
    }
    if flag("smart_punctuation") {
        markdown.push("smartPunctuation: true".into());
    }
    let mut out = format!("// A first draft, written by `ssqch import zola` from config.toml.\n// `ssqch docs --from zola` has the whole mapping.\n{}\n\nexport default defineConfig({{\n", imports.join("\n"));
    out.push_str(&format!("  dirs: {{ input: \"content\", output: {}, includes: \"../templates\" }},\n", serde_json::to_string(&text("output_dir").unwrap_or_else(|| "public".into()))?));
    out.push_str("  // Tera templates are close to Jinja: Markdown and the .html templates run through it.\n  templateFormats: [\"md\"],\n  markdownEngine: \"jinja\",\n  htmlEngine: \"jinja\",\n");
    if !sections.is_empty() {
        out.push_str("  // Section files: their settings go in directory data (see the list `ssqch import` printed).\n  ignore: [\"**/_index.md\"],\n");
    }
    if bundles {
        out.push_str("  // Pages that are a folder (`post/index.md`) keep the files next to them.\n  bundles: true,\n");
    }
    out.push_str(&format!("  markdown: {{ {} }},\n", markdown.join(", ")));
    if dir.join("static").is_dir() {
        out.push_str("  passthrough: [{ static: \".\" }],\n");
    }
    out.push_str(&format!("  // `config.title` and `config.extra.*` in templates read this.\n  data: {{\n    config: {},\n  }},\n", serde_json::to_string_pretty(&site)?.replace('\n', "\n    ")));
    out.push_str(&format!("  filters: {{\n    // Port shortcodes and Tera functions here: name: (...args) => result\n  }},\n  plugins: [{}],\n}});\n", plugins.join(", ")));
    if config.get("taxonomies").is_some() {
        plan.by_hand.push(("config.toml".into(), "taxonomies: tags are built in (`collections.<tag>`); tag pages are a template paginated over the tags (the `blog-tags` example), and other taxonomies are custom `collections`".into()));
    }
    if flag("build_search_index") {
        plan.by_hand.push(("config.toml".into(), "build_search_index: Pagefind after the build (`afterBuild: { run: \"npx -y pagefind --site public\" }`)".into()));
    }
    if flag("generate_feeds") || flag("generate_feed") {
        plan.by_hand.push(("config.toml".into(), "generate_feeds: a feed template with `rssPlugin()`'s filters (the `blog-tags` example has one)".into()));
    }
    if sitesquatch_js::find_config(dir).is_none() {
        plan.new_files.push(("ssqch.config.js".into(), "a first draft, from config.toml".into(), out));
    } else {
        plan.by_hand.push(("ssqch.config.js".into(), "it's already there, so the draft from config.toml wasn't written".into()));
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zola_front_matter_gets_ssqch_names() {
        let (text, changes) = rewrite_zola_front_matter("+++\ntitle = \"Pine\"\ndate = 2024-01-02\npath = \"blog/2024/pine\"\n\n[taxonomies]\ntags = [\"trees\", \"cones\"]\n\n[extra]\nauthor = \"Sam\"\n+++\nBody with path = \"x\" and [taxonomies] in it.\n");
        assert_eq!(text, "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\ntags = [\"trees\", \"cones\"]\n\n[extra]\nauthor = \"Sam\"\n+++\nBody with path = \"x\" and [taxonomies] in it.\n");
        assert_eq!(changes, ["path -> permalink", "[taxonomies] tags -> tags"]);
        // Other taxonomies stay, and so does a table's own `path` or `tags`.
        let (text, changes) = rewrite_zola_front_matter("+++\ntitle = \"x\"\n[taxonomies]\ntags = [\n  \"a\",\n  \"b\",\n]\ncategories = [\"c\"]\n[extra]\npath = \"keep\"\ntags = \"keep\"\n+++\nBody\n");
        assert_eq!(text, "+++\ntitle = \"x\"\ntags = [\n  \"a\",\n  \"b\",\n]\n[taxonomies]\ncategories = [\"c\"]\n[extra]\npath = \"keep\"\ntags = \"keep\"\n+++\nBody\n");
        assert_eq!(changes, ["[taxonomies] tags -> tags"]);
        // Nothing to do: the text comes back untouched, whatever it is.
        for same in ["+++\ntitle = \"x\"\n+++\nBody\n", "---\ntitle: x\n---\nBody\n", "No front matter\n", "+++\nnever closed\n"] {
            assert_eq!(rewrite_zola_front_matter(same), (same.to_string(), Vec::new()));
        }
        // The result is still TOML.
        let front = text.split("+++").nth(1).unwrap();
        let parsed: toml::Table = toml::from_str(front).unwrap();
        assert_eq!(parsed["tags"].as_array().unwrap().len(), 2);
        assert_eq!(parsed["taxonomies"]["categories"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn templates_and_data_get_ssqch_names() {
        let (text, changes) = rewrite_template(
            "---\ntitle: Pine\neleventyExcludeFromCollections: true\neleventyComputed:\n  slug: \"{{ title | slugify }}\"\ntemplateEngineOverride: njk,md\neleventyNavigation:\n  key: Pine\n---\nUse eleventyComputed in prose. <img src=\"a.png\" eleventy:widths=\"300\" eleventy:ignore> {{ eleventy.generator }}\n",
            false,
        );
        assert_eq!(
            text,
            "---\ntitle: Pine\nexcludeFromCollections: true\ncomputed:\n  slug: \"{{ title | slugify }}\"\nrender: njk,md\nnav:\n  key: Pine\n---\nUse eleventyComputed in prose. <img src=\"a.png\" ssqch:widths=\"300\" ssqch:ignore> {{ ssqch.generator }}\n"
        );
        assert_eq!(changes.len(), 6);
        let (same, none) = rewrite_template("No front matter, and eleventyComputed is only a word here.\n", true);
        assert_eq!((same.as_str(), none.len()), ("No front matter, and eleventyComputed is only a word here.\n", 0));
        let (data, changes) = rewrite_data("{ \"layout\": \"post\", \"eleventyComputed\": { \"permalink\": \"/x/\" }, \"note\": \"about eleventyComputed: a key\" }");
        assert_eq!(data, "{ \"layout\": \"post\", \"computed\": { \"permalink\": \"/x/\" }, \"note\": \"about eleventyComputed: a key\" }");
        assert_eq!(changes, ["eleventyComputed -> computed"]);
        assert_eq!(rewrite_data("module.exports = {\n  eleventyComputed: { a: 1 },\n  note: \"eleventyNavigation\",\n};\n").0, "module.exports = {\n  computed: { a: 1 },\n  note: \"eleventyNavigation\",\n};\n");

        // A post about Eleventy keeps its prose and its code samples.
        let post = "---\ntitle: Images in Eleventy\n---\nAdd `eleventy:ignore` to skip one, as in `<img eleventy:ignore>`, and print {{ eleventy.version }}.\n\n```html\n<img src=\"a.png\" eleventy:widths=\"300\"> {{ eleventy.generator }}\n```\n\n<img src=\"b.png\" eleventy:ignore>\n";
        let (text, changes) = rewrite_template(post, true);
        assert_eq!(text, post.replace("and print {{ eleventy.version }}", "and print {{ ssqch.version }}").replace("<img src=\"b.png\" eleventy:ignore>", "<img src=\"b.png\" ssqch:ignore>"));
        assert_eq!(changes.len(), 2);
    }

    #[test]
    fn package_scripts_run_ssqch() {
        let cases = [
            ("eleventy", "ssqch build", ""),
            ("npm run clean && eleventy --serve", "npm run clean && ssqch serve", ""),
            ("npx @11ty/eleventy --serve --port=8081 --quiet", "ssqch serve --port 8081 --quiet", ""),
            ("ELEVENTY_ENV=production eleventy --pathprefix=/gahlee/ --output dist", "ELEVENTY_ENV=production ssqch build --base /gahlee/ --output dist", ""),
            ("eleventy --formats=md,njk", "ssqch build", "--formats"),
            ("eslint src/**/*.js", "eslint src/**/*.js", ""),
        ];
        for (script, want, unknown) in cases {
            let (out, flags) = rewrite_script(script);
            assert_eq!((out.as_str(), flags.join(" ").as_str()), (want, unknown), "{}", script);
        }
    }

    #[test]
    fn a_config_becomes_a_draft_and_a_list() {
        let config = r#"const pluginRss = require("@11ty/eleventy-plugin-rss");
const markdownItAnchor = require("markdown-it-anchor");
module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });
  eleventyConfig.addWatchTarget("./src/css/");
  eleventyConfig.addFilter("readableDate", (d) => d.toDateString());
  eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);
  eleventyConfig.addPairedShortcode("callout", (content) => content);
  eleventyConfig.addCollection("posts", (api) => api.getFilteredByGlob("src/posts/*.md"));
  eleventyConfig.on("eleventy.after", () => {});
  return {
    dir: { input: "src", output: "public", includes: "_includes" },
    markdownTemplateEngine: "njk",
    pathPrefix: "/blog/",
  };
};
"#;
        let extensions: BTreeSet<String> = ["md", "njk"].iter().map(|s| s.to_string()).collect();
        let (draft, by_hand) = draft_config(".eleventy.js", config, &extensions);
        for expected in [
            "dirs: { input: \"src\", output: \"public\", includes: \"_includes\" },",
            "templateFormats: [\"md\", \"njk\"],",
            "  // From the Eleventy config's markdownTemplateEngine; HTML runs through Liquid first, Eleventy's default.\n  markdownEngine: \"njk\",\n  htmlEngine: \"liquid\",",
            "base: \"/blog/\",",
            "passthrough: [\"src/assets\", { \"src/static\": \"/\" }],",
            "watch: [\"./src/css/\"],",
            // Self-contained functions move as written; shortcodes are filters.
            "  filters: {\n    // From .eleventy.js, as written.\n    readableDate: (d) => d.toDateString(),\n    year: () => `${new Date().getFullYear()}`,\n    callout: (content) => content,\n",
            "//   collections: posts\n",
        ] {
            assert!(draft.contains(expected), "missing {:?} in\n{}", expected, draft);
        }
        assert!(!draft.contains("//   filters:"), "{}", draft);
        let list: Vec<String> = by_hand.iter().map(|(at, what)| format!("{}: {}", at, what.split(" -> ").next().unwrap_or(""))).collect();
        assert_eq!(list, [".eleventy.js:4: addPlugin(pluginRss)", ".eleventy.js:11: addCollection(\"posts\")", ".eleventy.js:12: on(\"eleventy.after\")", ".eleventy.js: @11ty/eleventy-plugin-rss", ".eleventy.js: markdown-it-anchor"]);

        // Tabs and spaces inside brackets, as the config has them; a function that needs
        // something else in the config stays for a person, and so does a variable.
        let config = "import { DateTime } from \"luxon\";\nconst assets = { \"images\": \"images\" };\nexport default function ( eleventyConfig ) {\n\televentyConfig.addPassthroughCopy( assets );\n\televentyConfig.addPassthroughCopy( { \"images\": \"images\", fonts: 'static/fonts' } );\n\televentyConfig.addFilter( \"snake_case\", ( str ) => {\n\t\treturn str\n\t\t\t.toLowerCase()\n\t\t\t.replace( /[^a-z0-9]+/g, \"_\" );\n\t} );\n\televentyConfig.addFilter( \"year\", ( d ) => DateTime.fromJSDate( d ).year );\n\televentyConfig.addShortcode( \"url\", function ( path ) { return this.page.url + path; } );\n\treturn { templateFormats: [ \"njk\", \"md\" ] };\n}\n";
        let (draft, by_hand) = draft_config("eleventy.config.js", config, &extensions);
        for expected in [
            "export default defineConfig( {\n\ttemplateFormats: [ \"njk\", \"md\" ],\n\t// Eleventy's defaults: Markdown and HTML run through Liquid first.\n\tmarkdownEngine: \"liquid\",\n\thtmlEngine: \"liquid\",\n",
            "\tpassthrough: [ { images: \"images\" }, { fonts: \"static/fonts\" } ],\n",
            "\t\tsnake_case: ( str ) => {\n\t\t\treturn str\n\t\t\t\t.toLowerCase()\n\t\t\t\t.replace( /[^a-z0-9]+/g, \"_\" );\n\t\t},\n",
            "} );\n",
            "//   filters: year\n//   filters: url\n",
        ] {
            assert!(draft.contains(expected), "missing {:?} in\n{}", expected, draft);
        }
        // Gahlee House's config: no trailing commas, so the draft has none, and only the keys
        // that need them are quoted.
        let gahlee = "export default function ( eleventyConfig ) {\n\televentyConfig.addPassthroughCopy( { \"images\": \"images\" } );\n\televentyConfig.addFilter( \"snake_case\", ( str ) => {\n\t\treturn str.toLowerCase();\n\t} );\n\treturn {\n\t\tdir: {\n\t\t\tinput: \"src\",\n\t\t\toutput: \"_site\"\n\t\t},\n\t\thtmlTemplateEngine: \"njk\"\n\t};\n}\n";
        let (draft, _) = draft_config("eleventy.config.js", gahlee, &extensions);
        assert!(draft.contains("\tpassthrough: [ { images: \"images\" } ],\n"), "{}", draft);
        assert!(draft.contains("\tfilters: {\n\t\t// Port each filter and shortcode here: name: (value, ...args) => result\n\t\t// From eleventy.config.js, as written.\n\t\tsnake_case: ( str ) => {\n\t\t\treturn str.toLowerCase();\n\t\t}\n\t},\n"), "{}", draft);
        assert!(draft.contains("\tplugins: []\n} );\n") && !draft.contains(",\n}"), "{}", draft);
        let list: Vec<String> = by_hand.iter().map(|(at, what)| format!("{}: {}", at, what.split(" -> ").next().unwrap_or(""))).collect();
        assert_eq!(list, ["eleventy.config.js:4: addPassthroughCopy with a variable or a computed value", "eleventy.config.js:11: addFilter(\"year\")", "eleventy.config.js:12: addShortcode(\"url\")"]);
    }
}
