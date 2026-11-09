//! `ssqch init` (a starter site) and `ssqch types` (editor types).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result};
use sitesquatch::cli::clap;

/// The type definitions for `ssqch.config.js` and the `ssqch/*` modules.
pub const TYPES: &str = include_str!("ssqch.d.ts");

/// The starter site: (path in the new site, contents). The layout and home page
/// come from the chosen engine ([`Engine::files`]), and [`Engine::adapt`] fits the
/// config and `posts.json` to it.
const STARTER: &[(&str, &str)] = &[
    ("ssqch.config.js", include_str!("starter/ssqch.config.js")),
    ("src/_data/site.json", include_str!("starter/src/_data/site.json")),
    ("src/posts/posts.json", include_str!("starter/src/posts/posts.json")),
    ("src/posts/hello-world.md", include_str!("starter/src/posts/hello-world.md")),
    ("ssqch.d.ts", TYPES),
    ("jsconfig.json", include_str!("starter/jsconfig.json")),
    (".gitignore", include_str!("starter/gitignore")),
];

/// The template languages `ssqch init --engine` can start a site in.
const ENGINES: &[&str] = &["edge", "liquid", "njk", "hbs"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Engine(&'static str);

impl Engine {
    pub fn named(name: &str) -> Result<Engine> {
        let ext = ENGINES.iter().find(|e| **e == name).with_context(|| format!("--engine {}: not a starter engine (use {})", name, ENGINES.join(", ")))?;
        let built = match *ext {
            "liquid" => cfg!(feature = "liquid"),
            "njk" => cfg!(feature = "jinja"),
            "hbs" => cfg!(feature = "handlebars"),
            _ => true,
        };
        anyhow::ensure!(built, "--engine {}: this ssqch was built without it", name);
        Ok(Engine(ext))
    }

    /// The layout and home page.
    fn files(self) -> [(String, &'static str); 2] {
        let (layout, index) = match self.0 {
            "liquid" => (include_str!("starter/engines/layout.liquid"), include_str!("starter/engines/index.liquid")),
            "njk" => (include_str!("starter/engines/layout.njk"), include_str!("starter/engines/index.njk")),
            "hbs" => (include_str!("starter/engines/layout.hbs"), include_str!("starter/engines/index.hbs")),
            _ => (include_str!("starter/src/_includes/layout.edge"), include_str!("starter/src/index.edge")),
        };
        [(format!("src/_includes/layout.{}", self.0), layout), (format!("src/index.{}", self.0), index)]
    }

    /// Fit a starter file written for Edge to this engine.
    fn adapt(self, rel: &str, contents: &str) -> String {
        if self.0 == "edge" {
            return contents.to_string();
        }
        match rel {
            "ssqch.config.js" => {
                let call = match self.0 {
                    "liquid" => "{{ post.date | readableDate }}",
                    "hbs" => "{{readableDate post.date}}",
                    _ => "{{ readableDate(post.date) }}",
                };
                let formats = format!("templateFormats: [\"{0}\", \"md\"],\n  markdownEngine: \"{0}\",", self.0);
                replace_once(&replace_once(contents, "{{ readableDate(post.date) }}", call), "templateFormats: [\"edge\", \"md\"],", &formats)
            }
            "src/posts/posts.json" => replace_once(contents, "layout.edge", &format!("layout.{}", self.0)),
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
        .about("Create a starter site (config, layout, a post, data and editor types)")
        .arg(clap::Arg::new("dir").help("Where to create it (default: the current folder)").default_value("."))
        .arg(clap::Arg::new("engine").long("engine").value_name("NAME").help("The template language for the layout and home page: edge, liquid, njk or hbs").default_value("edge"))
}

pub fn types_command() -> clap::Command {
    clap::Command::new("types")
        .about("Write ssqch.d.ts, the types editors use for ssqch.config.js")
        .arg(clap::Arg::new("out").long("out").help("Where to write it").default_value("ssqch.d.ts"))
}

pub fn run_init(matches: &clap::ArgMatches) -> ExitCode {
    let dir = PathBuf::from(matches.get_one::<String>("dir").expect("has a default"));
    let engine = matches.get_one::<String>("engine").expect("has a default");
    report(Engine::named(engine).and_then(|engine| init(&dir, engine)).map(|(written, skipped)| {
        for path in &written {
            println!("  created {}", show(&dir, path));
        }
        for path in &skipped {
            println!("  kept    {} (already there)", show(&dir, path));
        }
        if written.is_empty() {
            println!("Nothing to do: every starter file is already there.");
            return;
        }
        let cd = if dir == Path::new(".") { String::new() } else { format!("cd {} && ", dir.display()) };
        println!("\nNext: {}ssqch serve, then open http://localhost:8080", cd);
    }))
}

pub fn run_types(matches: &clap::ArgMatches) -> ExitCode {
    let out = PathBuf::from(matches.get_one::<String>("out").expect("has a default"));
    report(write(&out, TYPES).map(|()| println!("Wrote {}. List it in jsconfig.json's \"include\" so editors pick it up.", out.display())))
}

/// Write the starter files into `dir`, keeping any that already exist.
/// Returns (written, skipped).
pub fn init(dir: &Path, engine: Engine) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let (mut written, mut skipped) = (Vec::new(), Vec::new());
    let files = STARTER.iter().map(|(rel, contents)| (rel.to_string(), engine.adapt(rel, contents))).chain(engine.files().map(|(rel, contents)| (rel, contents.to_string())));
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
            eprintln!("\x1b[31merror:\x1b[0m {:#}", e);
            ExitCode::FAILURE
        }
    }
}
