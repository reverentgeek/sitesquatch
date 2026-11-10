//! `ssqch init` (a starter site) and `ssqch types` (editor types).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result};
use sitesquatch::cli::clap;

/// The type definitions for `ssqch.config.js` and the `ssqch/*` modules.
pub const TYPES: &str = include_str!("ssqch.d.ts");

/// The starter site: (path in the new site, contents). It's an amateur
/// investigator's field notes: three posts that each show one thing. The
/// layout and home page come from the chosen engine ([`Engine::templates`]),
/// and [`Engine::adapt`] fits the config, `posts.json` and the 404 page to it.
const STARTER: &[(&str, &str)] = &[
    ("ssqch.config.js", include_str!("starter/ssqch.config.js")),
    ("src/_data/site.json", include_str!("starter/src/_data/site.json")),
    ("src/posts/posts.json", include_str!("starter/src/posts/posts.json")),
    ("src/posts/i-know-what-i-saw.md", include_str!("starter/src/posts/i-know-what-i-saw.md")),
    ("src/posts/upon-further-review-a-stump.md", include_str!("starter/src/posts/upon-further-review-a-stump.md")),
    ("src/posts/the-stump-has-moved.md", include_str!("starter/src/posts/the-stump-has-moved.md")),
    ("src/404.md", include_str!("starter/src/404.md")),
    ("src/_archetypes/posts.md", include_str!("starter/src/_archetypes/posts.md")),
    ("ssqch.d.ts", TYPES),
    ("jsconfig.json", include_str!("starter/jsconfig.json")),
    (".gitignore", include_str!("starter/gitignore")),
];

/// The documentation starter (`ssqch init --starter docs`): a sidebar, a table
/// of contents, previous and next links, notes, tabs, highlighting, a schema
/// and the link checker. Its layouts, render hook and containers come from the
/// chosen engine, like the site starter's.
const DOCS_STARTER: &[(&str, &str)] = &[
    ("ssqch.config.js", include_str!("starter-docs/ssqch.config.js")),
    ("src/_data/site.json", include_str!("starter-docs/src/_data/site.json")),
    ("src/_data/nav.yml", include_str!("starter-docs/src/_data/nav.yml")),
    ("src/assets/docs.css", include_str!("starter-docs/src/assets/docs.css")),
    ("src/assets/docs.js", include_str!("starter-docs/src/assets/docs.js")),
    ("src/index.md", include_str!("starter-docs/src/index.md")),
    ("src/404.md", include_str!("starter-docs/src/404.md")),
    ("src/docs/docs.json", include_str!("starter-docs/src/docs/docs.json")),
    ("src/docs/index.md", include_str!("starter-docs/src/docs/index.md")),
    ("src/docs/install.md", include_str!("starter-docs/src/docs/install.md")),
    ("src/docs/guides/writing.md", include_str!("starter-docs/src/docs/guides/writing.md")),
    ("src/docs/guides/deploying.md", include_str!("starter-docs/src/docs/guides/deploying.md")),
    ("src/_archetypes/docs.md", include_str!("starter-docs/src/_archetypes/docs.md")),
    ("ssqch.d.ts", TYPES),
    ("jsconfig.json", include_str!("starter/jsconfig.json")),
    (".gitignore", include_str!("starter-docs/gitignore")),
];

/// What `ssqch init --starter` can create.
const STARTERS: &[&str] = &["site", "docs"];

/// The template languages `ssqch init --engine` can start a site in. `njk`
/// uses the Jinja templates, which are Nunjucks too.
const ENGINES: &[&str] = &["jinja", "njk", "edge", "liquid", "hbs"];

/// The engine a starter is in without `--engine`: Jinja, the CLI's default
/// template language, or Edge in a build without it.
const DEFAULT_ENGINE: &str = if cfg!(feature = "jinja") { "jinja" } else { "edge" };

/// A starter's templates in one language: (path in the new site without the
/// extension, contents). The Jinja ones are the starters' own; the rest are
/// translations of them.
type Templates = &'static [(&'static str, &'static str)];

const SITE_JINJA: Templates = &[("src/_includes/layout", include_str!("starter/src/_includes/layout.jinja")), ("src/index", include_str!("starter/src/index.jinja"))];
const SITE_EDGE: Templates = &[("src/_includes/layout", include_str!("starter/engines/layout.edge")), ("src/index", include_str!("starter/engines/index.edge"))];
const SITE_LIQUID: Templates = &[("src/_includes/layout", include_str!("starter/engines/layout.liquid")), ("src/index", include_str!("starter/engines/index.liquid"))];
const SITE_HBS: Templates = &[("src/_includes/layout", include_str!("starter/engines/layout.hbs")), ("src/index", include_str!("starter/engines/index.hbs"))];

/// The documentation starter's templates, in the same order in each language.
macro_rules! docs_templates {
    ($dir:literal, $ext:literal) => {
        &[
            ("src/_includes/base", include_str!(concat!($dir, "base.", $ext))),
            ("src/_includes/doc", include_str!(concat!($dir, "doc.", $ext))),
            ("src/_includes/hooks/heading", include_str!(concat!($dir, "hooks/heading.", $ext))),
            ("src/_includes/containers/tabs", include_str!(concat!($dir, "containers/tabs.", $ext))),
            ("src/_includes/containers/tab", include_str!(concat!($dir, "containers/tab.", $ext))),
            ("src/_includes/containers/details", include_str!(concat!($dir, "containers/details.", $ext))),
        ]
    };
}
const DOCS_JINJA: Templates = docs_templates!("starter-docs/src/_includes/", "jinja");
const DOCS_EDGE: Templates = docs_templates!("starter-docs/engines/edge/", "edge");
const DOCS_LIQUID: Templates = docs_templates!("starter-docs/engines/liquid/", "liquid");
const DOCS_HBS: Templates = docs_templates!("starter-docs/engines/hbs/", "hbs");

/// The engines this build can start a site in, the default first.
pub fn starter_engines() -> Vec<&'static str> {
    ENGINES.iter().copied().filter(|e| Engine::named(e).is_ok()).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Engine(&'static str);

impl Engine {
    pub fn named(name: &str) -> Result<Engine> {
        let ext = ENGINES.iter().find(|e| **e == name).with_context(|| format!("--engine {}: not a starter engine (use {})", name, ENGINES.join(", ")))?;
        let built = match *ext {
            "liquid" => cfg!(feature = "liquid"),
            "jinja" | "njk" => cfg!(feature = "jinja"),
            "hbs" => cfg!(feature = "handlebars"),
            _ => true,
        };
        anyhow::ensure!(built, "--engine {}: this ssqch was built without it", name);
        Ok(Engine(ext))
    }

    /// The starter's templates in this language, with their extension.
    fn templates(self, starter: &str) -> Vec<(String, String)> {
        let set = match (starter, self.0) {
            ("docs", "edge") => DOCS_EDGE,
            ("docs", "liquid") => DOCS_LIQUID,
            ("docs", "hbs") => DOCS_HBS,
            ("docs", _) => DOCS_JINJA,
            (_, "edge") => SITE_EDGE,
            (_, "liquid") => SITE_LIQUID,
            (_, "hbs") => SITE_HBS,
            _ => SITE_JINJA,
        };
        set.iter().map(|(rel, contents)| (format!("{}.{}", rel, self.0), self.rename(contents))).collect()
    }

    /// Point a mention of a Jinja template (`layout: base.jinja`) at this
    /// language's file.
    fn rename(self, contents: &str) -> String {
        if self.0 == "jinja" {
            return contents.to_string();
        }
        let mentions = regex::Regex::new(r"\b([\w-]+)\.jinja\b").expect("valid regex");
        mentions.replace_all(contents, format!("${{1}}.{}", self.0).as_str()).into_owned()
    }

    /// Fit a starter file written for Jinja to this engine.
    fn adapt(self, rel: &str, contents: &str) -> String {
        if self.0 == "jinja" {
            return contents.to_string();
        }
        match rel {
            "ssqch.config.js" => {
                // Markdown runs through the site's language too, as it does through Jinja by default.
                let formats = format!("templateFormats: [\"{0}\", \"md\"],\n  markdownEngine: \"{0}\",", self.0);
                let mut config = replace_once(contents, "templateFormats: [\"jinja\", \"md\"],", &formats);
                if config.contains("{{ readableDate(post.date) }}") {
                    let call = match self.0 {
                        "liquid" => "{{ post.date | readableDate }}",
                        "hbs" => "{{readableDate post.date}}",
                        _ => "{{ readableDate(post.date) }}",
                    };
                    config = replace_once(&config, "{{ readableDate(post.date) }}", call);
                }
                if self.0 == "hbs" && config.contains("data: { search },") {
                    // Handlebars has no `replace`, so the docs layout's edit link gets its path from a helper.
                    config = replace_once(&config, "  data: { search },", "  // The path after `site.editUrl` in each page's \"Edit this page\" link.\n  filters: {\n    sourcePath: (inputPath) => inputPath.replace(\"./\", \"\"),\n  },\n\n  data: { search },");
                }
                config
            }
            _ if rel.ends_with(".md") || rel.ends_with(".json") => self.rename(contents),
            _ => contents.to_string(),
        }
    }
}

/// Replace `from` (which the starter file must contain) with `to`.
fn replace_once(contents: &str, from: &str, to: &str) -> String {
    assert!(contents.contains(from), "starter file is missing {:?}", from);
    contents.replacen(from, to, 1)
}

pub fn init_command() -> clap::Command {
    clap::Command::new("init")
        .about("Create a starter site (config, layout, three posts, data and editor types)")
        .arg(clap::Arg::new("dir").help("Where to create it (default: the current folder)").default_value("."))
        .arg(clap::Arg::new("starter").long("starter").value_name("NAME").help("What to start with: site (a small blog) or docs (documentation with a sidebar, tabs and search)").default_value("site"))
        .arg(clap::Arg::new("engine").long("engine").value_name("NAME").help("The template language for the starter's layouts and templates: jinja, njk, edge, liquid or hbs").default_value(DEFAULT_ENGINE))
}

pub fn types_command() -> clap::Command {
    clap::Command::new("types")
        .about("Write ssqch.d.ts, the types editors use for ssqch.config.js")
        .arg(clap::Arg::new("out").long("out").help("Where to write it").default_value("ssqch.d.ts"))
}

pub fn run_init(matches: &clap::ArgMatches) -> ExitCode {
    let dir = PathBuf::from(matches.get_one::<String>("dir").expect("has a default"));
    let engine = matches.get_one::<String>("engine").expect("has a default");
    let starter = matches.get_one::<String>("starter").expect("has a default");
    let result = match starter.as_str() {
        "site" | "docs" => Engine::named(engine).and_then(|engine| init_starter(&dir, starter, engine)),
        other => Err(anyhow::anyhow!("--starter {}: not a starter (use {})", other, STARTERS.join(" or "))),
    };
    report(result.map(|(written, skipped)| {
        for path in &written {
            println!("  created {}", show(&dir, path));
        }
        for path in &skipped {
            println!("  kept    {} (already there)", show(&dir, path));
        }
        if written.is_empty() {
            println!("Nothing to do: camp is already set up (every starter file is there).");
            return;
        }
        let cd = if dir == Path::new(".") { String::new() } else { format!("cd {} && ", dir.display()) };
        println!("\nCamp is set up. Next: {}ssqch serve, then open http://localhost:8080", cd);
    }))
}

pub fn run_types(matches: &clap::ArgMatches) -> ExitCode {
    let root = matches.try_get_one::<PathBuf>("root").ok().flatten().cloned();
    let out = PathBuf::from(matches.get_one::<String>("out").expect("has a default"));
    let out = match &root {
        Some(root) if out.is_relative() => root.join(out),
        _ => out,
    };
    // A site's schemas become types too. Without a config (or with one that
    // doesn't load), the types are the same for every site.
    let mut types = TYPES.to_string();
    let mut schemas = 0;
    let mut cfg = sitesquatch::Config::new(root.unwrap_or_else(|| PathBuf::from(".")), sitesquatch::Environment::Development);
    cfg.quiet = true;
    match crate::configure(&mut cfg) {
        Ok(()) => {
            schemas = cfg.schemas().len();
            types.push_str(&schema_types(cfg.schemas()));
        }
        Err(e) => eprintln!("warn: couldn't read the site's config, so its schemas aren't in the types: {:#}", e),
    }
    report(write(&out, &types).map(|()| {
        let with = match schemas {
            0 => String::new(),
            1 => " (with 1 schema)".into(),
            n => format!(" (with {} schemas)", n),
        };
        println!("Wrote {}{}. List it in jsconfig.json's \"include\" so editors pick it up.", out.display(), with)
    }))
}

/// The site's schemas as an addition to the `Schemas` interface, so
/// `pages.byTag("posts")` knows each page's fields.
fn schema_types(schemas: &[sitesquatch::schema::Schema]) -> String {
    if schemas.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n// This site's `schemas`. Run `ssqch types` again after changing them.\ndeclare module \"ssqch\" {\n\tinterface Schemas {\n");
    for schema in schemas {
        let plain = schema.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !schema.name.starts_with(|c: char| c.is_ascii_digit());
        let key = if plain { schema.name.clone() } else { format!("{:?}", schema.name) };
        out.push_str(&format!("\t\t{}: {};\n", key, schema.typescript()));
    }
    out.push_str("\t}\n}\n");
    out
}

/// Write a starter (`site` or `docs`) into `dir` in `engine`'s language,
/// keeping any files that already exist. Returns (written, skipped).
pub fn init_starter(dir: &Path, starter: &str, engine: Engine) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let common = if starter == "docs" { DOCS_STARTER } else { STARTER };
    let files = common.iter().map(|(rel, contents)| (rel.to_string(), engine.adapt(rel, contents))).chain(engine.templates(starter));
    init_files(dir, files)
}

/// Write `files` (path in the site, contents) into `dir`, keeping any that
/// already exist. Returns (written, skipped).
fn init_files(dir: &Path, files: impl Iterator<Item = (String, String)>) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let (mut written, mut skipped) = (Vec::new(), Vec::new());
    for (rel, contents) in files {
        let path = dir.join(&rel);
        if path.exists() {
            skipped.push(path);
        } else {
            write(&path, &contents)?;
            written.push(path);
        }
    }
    Ok((written, skipped))
}

fn write(path: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(path, contents).with_context(|| format!("writing {}", path.display()))
}

fn show(dir: &Path, path: &Path) -> String {
    path.strip_prefix(dir).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn report(result: Result<()>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{} {:#}", sitesquatch::diagnostics::red("error:"), e);
            ExitCode::FAILURE
        }
    }
}
