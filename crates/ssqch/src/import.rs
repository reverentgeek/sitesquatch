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
        .after_help("Run it in a clean git checkout, read the list, then run it again with --write. Guides for each generator are in docs/guides/.")
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
        "jekyll" | "hugo" | "docusaurus" | "mkdocs" | "hexo" | "astro" | "vitepress" => Err(anyhow::anyhow!("there's no importer for {} yet (only eleventy and zola); docs/guides/ has guides for moving from Docusaurus, MkDocs, Hexo and component frameworks by hand", generator)),
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
const TEMPLATE_EXTENSIONS: [&str; 9] = ["md", "markdown", "njk", "liquid", "html", "hbs", "handlebars", "mustache", "edge"];

/// Front matter keys, and their names in data files: (Eleventy's, ssqch's).
const KEYS: [(&str, &str); 4] = [("eleventyExcludeFromCollections", "excludeFromCollections"), ("eleventyComputed", "computed"), ("eleventyNavigation", "nav"), ("templateEngineOverride", "render")];

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
    for (from, to) in KEYS {
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
    for (from, to) in KEYS {
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
        _ => "check whether it's needed: see docs/guides/from-eleventy.md",
    })
}

/// A first `ssqch.config.js` from an Eleventy config, and what in it needs porting.
fn draft_config(name: &str, text: &str, extensions: &BTreeSet<String>) -> (String, Vec<(String, String)>) {
    let setting = |key: &str| SETTING.captures_iter(text).find(|c| &c[1] == key).map(|c| c[2].to_string());
    let line_of = |offset: usize| text[..offset].matches('\n').count() + 1;
    let mut by_hand: Vec<(String, String)> = Vec::new();
    let mut passthrough: Vec<String> = Vec::new();
    let mut watch: Vec<String> = Vec::new();
    let mut todo: Vec<String> = Vec::new();
    for c in CALL.captures_iter(text) {
        let (method, quoted, bare) = (&c[1], c.get(2).map(|m| m.as_str()), c.get(3).map(|m| m.as_str()));
        let at = format!("{}:{}", name, line_of(c.get(0).unwrap().start()));
        let arg = quoted.or(bare).unwrap_or("...");
        match method {
            "addPassthroughCopy" => match quoted {
                Some(path) => passthrough.push(path.to_string()),
                None => by_hand.push((at, "addPassthroughCopy with an object or a variable -> `passthrough: [{ from: to }]`".into())),
            },
            "addWatchTarget" => match quoted {
                Some(path) => watch.push(path.to_string()),
                None => by_hand.push((at, "addWatchTarget -> `watch`".into())),
            },
            "addFilter" | "addAsyncFilter" | "addNunjucksFilter" | "addLiquidFilter" | "addNunjucksAsyncFilter" => {
                todo.push(format!("filters: {}", arg));
                by_hand.push((at, format!("{}(\"{}\") -> `filters: {{ {}: ... }}` (async functions are awaited)", method, arg, arg)));
            }
            "addShortcode" | "addAsyncShortcode" | "addNunjucksShortcode" | "addLiquidShortcode" => {
                todo.push(format!("filters: {}", arg));
                by_hand.push((at, format!("{}(\"{}\") -> a filter: `filters: {{ {}: ... }}`. Nunjucks keeps `{{% {} ... %}}`; in Liquid it's `{{{{ x | {} }}}}`", method, arg, arg, arg, arg)));
            }
            "addPairedShortcode" | "addPairedAsyncShortcode" => {
                todo.push(format!("filters: {}", arg));
                by_hand.push((at, format!("{}(\"{}\") -> a filter that gets the content first. Nunjucks keeps `{{% {} %}}...{{% end{} %}}`; in Markdown, a `::: {}` container", method, arg, arg, arg, arg)));
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
        Some("njk") => "\"njk\"".to_string(),
        Some("false") | Some("") => "false".to_string(),
        Some(other) => format!("\"{}\"", other),
        None if text.contains(&format!("{}: false", key)) => "false".to_string(),
        None => "\"liquid\"".to_string(),
    };
    let formats: Vec<String> = match FORMATS.captures(text) {
        Some(c) => c[1].split(',').map(|f| f.trim().trim_matches(['"', '\'', '`']).to_string()).filter(|f| !f.is_empty() && f != "11ty.js").collect(),
        None => extensions.iter().filter(|e| e.as_str() != "edge").cloned().collect(),
    };
    let quoted = |items: &[String]| items.iter().map(|i| format!("\"{}\"", i)).collect::<Vec<_>>().join(", ");
    let mut dirs: Vec<String> = Vec::new();
    for key in ["input", "output", "includes", "layouts", "data"] {
        if let Some(value) = setting(key) {
            dirs.push(format!("{}: \"{}\"", key, value));
        }
    }
    let mut out = format!("// A first draft, written by `ssqch import eleventy` from {}.\n// What it couldn't carry over is listed at the end; docs/guides/from-eleventy.md\n// (in the sitesquatch repository) has the whole mapping.\nimport {{ defineConfig }} from \"ssqch\";\n\nexport default defineConfig({{\n", name);
    if !dirs.is_empty() {
        out.push_str(&format!("  dirs: {{ {} }},\n", dirs.join(", ")));
    }
    if !formats.is_empty() {
        out.push_str(&format!("  templateFormats: [{}],\n", quoted(&formats)));
    }
    out.push_str(&format!("  // Eleventy's defaults: Markdown and HTML run through Liquid first.\n  markdownEngine: {},\n  htmlEngine: {},\n", engine("markdownTemplateEngine"), engine("htmlTemplateEngine")));
    if let Some(prefix) = setting("pathPrefix").filter(|p| p != "/") {
        out.push_str(&format!("  base: \"{}\",\n", prefix));
    }
    if !passthrough.is_empty() {
        out.push_str(&format!("  passthrough: [{}],\n", quoted(&passthrough)));
    }
    if !watch.is_empty() {
        out.push_str(&format!("  watch: [{}],\n", quoted(&watch)));
    }
    out.push_str("\n  filters: {\n    // Port each filter and shortcode here: name: (value, ...args) => result\n  },\n  collections: {\n    // name: (pages) => pages.byTag(\"post\")\n  },\n  plugins: [],\n});\n");
    if !todo.is_empty() {
        out.push_str(&format!("\n// To port from {}:\n", name));
        for item in &todo {
            out.push_str(&format!("//   {}\n", item));
        }
    }
    (out, by_hand)
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
    let mut out = format!("// A first draft, written by `ssqch import zola` from config.toml.\n// docs/guides/from-zola.md (in the sitesquatch repository) has the whole mapping.\n{}\n\nexport default defineConfig({{\n", imports.join("\n"));
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
            "markdownEngine: \"njk\",\n  htmlEngine: \"liquid\",",
            "base: \"/blog/\",",
            "passthrough: [\"src/assets\"],",
            "watch: [\"./src/css/\"],",
            "//   filters: readableDate\n//   filters: year\n//   filters: callout\n//   collections: posts\n",
        ] {
            assert!(draft.contains(expected), "missing {:?} in\n{}", expected, draft);
        }
        let list: Vec<String> = by_hand.iter().map(|(at, what)| format!("{}: {}", at, what.split(" -> ").next().unwrap_or(""))).collect();
        assert_eq!(
            list,
            [
                ".eleventy.js:4: addPlugin(pluginRss)",
                ".eleventy.js:6: addPassthroughCopy with an object or a variable",
                ".eleventy.js:8: addFilter(\"readableDate\")",
                ".eleventy.js:9: addShortcode(\"year\")",
                ".eleventy.js:10: addPairedShortcode(\"callout\")",
                ".eleventy.js:11: addCollection(\"posts\")",
                ".eleventy.js:12: on(\"eleventy.after\")",
                ".eleventy.js: @11ty/eleventy-plugin-rss",
                ".eleventy.js: markdown-it-anchor",
            ]
        );
    }
}
