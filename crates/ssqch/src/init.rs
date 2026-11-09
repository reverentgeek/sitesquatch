//! `ssqch init` (a starter site) and `ssqch types` (editor types).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result};
use sitesquatch::cli::clap;

/// The type definitions for `ssqch.config.js` and the `ssqch/*` modules.
pub const TYPES: &str = include_str!("ssqch.d.ts");

/// The starter site: (path in the new site, contents).
const STARTER: &[(&str, &str)] = &[
    ("ssqch.config.js", include_str!("starter/ssqch.config.js")),
    ("src/_includes/layout.edge", include_str!("starter/src/_includes/layout.edge")),
    ("src/_data/site.json", include_str!("starter/src/_data/site.json")),
    ("src/index.edge", include_str!("starter/src/index.edge")),
    ("src/posts/posts.json", include_str!("starter/src/posts/posts.json")),
    ("src/posts/hello-world.md", include_str!("starter/src/posts/hello-world.md")),
    ("ssqch.d.ts", TYPES),
    ("jsconfig.json", include_str!("starter/jsconfig.json")),
    (".gitignore", include_str!("starter/gitignore")),
];

pub fn init_command() -> clap::Command {
    clap::Command::new("init")
        .about("Create a starter site (config, layout, a post, data and editor types)")
        .arg(clap::Arg::new("dir").help("Where to create it (default: the current folder)").default_value("."))
}

pub fn types_command() -> clap::Command {
    clap::Command::new("types")
        .about("Write ssqch.d.ts, the types editors use for ssqch.config.js")
        .arg(clap::Arg::new("out").long("out").help("Where to write it").default_value("ssqch.d.ts"))
}

pub fn run_init(matches: &clap::ArgMatches) -> ExitCode {
    let dir = PathBuf::from(matches.get_one::<String>("dir").expect("has a default"));
    report(init(&dir).map(|(written, skipped)| {
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
pub fn init(dir: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let (mut written, mut skipped) = (Vec::new(), Vec::new());
    for (rel, contents) in STARTER {
        let path = dir.join(rel);
        if path.exists() {
            skipped.push(path);
        } else {
            write(&path, contents)?;
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
