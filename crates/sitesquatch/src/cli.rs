//! Command line interface shared by the `ssqch` binary and custom site binaries.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{CommandFactory, FromArgMatches, Parser, Subcommand};

/// The clap this CLI is built with, for [`ExtraCommand`]s.
pub use clap;

use crate::config::{BuildReport, Config, Environment};

#[derive(Parser)]
#[command(version, about = "SiteSquatch (ssqch): a fast, pluggable static site generator")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// Project root (defaults to the current directory)
    #[arg(long, global = true)]
    root: Option<PathBuf>,
    /// Override the output directory (relative to the root)
    #[arg(long, short, global = true)]
    output: Option<PathBuf>,
    /// Serve the site under a path, like /repo/ (overrides the config's `base`)
    #[arg(long, global = true)]
    base: Option<String>,
    /// Don't use the network: `fetch()` answers from the copies its `cache` option saved
    #[arg(long, global = true)]
    offline: bool,
    /// development or production (default: $SSQCH_ENV, $NODE_ENV,
    /// then production for `build` and development for `serve`)
    #[arg(long, global = true)]
    env: Option<String>,
    /// Print only warnings and errors
    #[arg(long, short, global = true)]
    quiet: bool,
    /// Also list the slowest images to encode
    #[arg(long, short, global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Command {
    /// Build the site (default)
    #[command(after_help = "With --format json, standard output is one JSON report: whether the build worked, what it wrote, and its\nwarnings and errors, each with a code, the file, the line when it's known, and the field for a content error.\nProgress lines and `console.log` go to standard error.")]
    Build {
        /// text or json
        #[arg(long, default_value = "text")]
        format: String,
    },
    /// Build, serve, watch for changes and live-reload the browser
    Serve {
        /// The port to listen on (0 picks a free one)
        #[arg(long, short, default_value_t = 8080)]
        port: u16,
        /// Write this file once the first build is done: JSON with the url, port and output folder
        #[arg(long, value_name = "FILE")]
        ready_file: Option<PathBuf>,
    },
    /// Create a page from an archetype (a file in _archetypes/), with its title and date filled in
    #[command(after_help = "The archetype is named after the page's folder (_archetypes/posts.md for posts/), then `default`.\nIts body is copied as it is; only front matter keys are filled in. Nothing is overwritten.\n\n  ssqch new posts/pine-cones.md\n  ssqch new posts --title \"Pine cones\"      (named like the other pages in posts/)\n  ssqch new docs/guides/install.md --set order=3 --set draft=true")]
    New {
        /// The new file, from the input folder (posts/pine-cones.md), or a folder, with --title
        path: String,
        /// The page's title (default: from the file's name)
        #[arg(long)]
        title: Option<String>,
        /// The page's date, as it's written in front matter (default: today)
        #[arg(long)]
        date: Option<String>,
        /// The archetype to use (default: the page's folder, then `default`)
        #[arg(long, value_name = "NAME")]
        archetype: Option<String>,
        /// Another front matter key, with its value as it's written there (repeatable)
        #[arg(long, value_name = "KEY=VALUE")]
        set: Vec<String>,
        /// text or json
        #[arg(long, default_value = "text")]
        format: String,
    },
    /// Show where a page comes from, and which level of the data cascade set each value
    #[command(after_help = "Nothing is built or written, and build hooks don't run.\n\n  ssqch inspect /guides/install/\n  ssqch inspect src/guides/install.md --field title\n  ssqch inspect /guides/install/ --field hero.alt --format json")]
    Inspect {
        /// The page: its URL (/about/), or its template's path
        page: String,
        /// One field of its data, in full, with every level that set it (a dotted path reaches inside: hero.alt)
        #[arg(long, value_name = "NAME")]
        field: Option<String>,
        /// text or json
        #[arg(long, default_value = "text")]
        format: String,
    },
    /// Compare two builds of a site: URLs added and removed, and what changed on each page
    #[command(after_help = "Build the site into one folder before a change and another after it:\n\n  ssqch build --output dist-before\n  (upgrade ssqch, edit a layout, ...)\n  ssqch build\n  ssqch diff dist-before dist\n\nExits with 0 when the builds are the same, 1 when they differ, and 2 on an error.")]
    Diff {
        /// The build from before the change
        before: PathBuf,
        /// The build from after it
        after: PathBuf,
        /// Compare bytes: don't match fingerprinted files or ignore whitespace
        #[arg(long)]
        exact: bool,
        /// Leave out text matching this regular expression before comparing (repeatable)
        #[arg(long, value_name = "REGEX")]
        ignore: Vec<String>,
        /// Only compare files matching this glob, like '**/*.html' (repeatable)
        #[arg(long, value_name = "GLOB")]
        only: Vec<String>,
        /// Changed lines to show for each file (0 for all)
        #[arg(long, default_value_t = 10)]
        lines: usize,
        /// text or json
        #[arg(long, default_value = "text")]
        format: String,
    },
}

/// A subcommand a binary adds to `build` and `serve`, like `ssqch init`.
/// `run` gets the subcommand's own matches.
pub struct ExtraCommand {
    pub command: clap::Command,
    pub run: Box<dyn Fn(&clap::ArgMatches) -> ExitCode>,
}

/// Parse arguments, let `configure` set up the site, then build or serve.
pub fn run(configure: impl Fn(&mut Config)) -> ExitCode {
    run_with(configure, Vec::new())
}

/// [`run`], plus subcommands of the binary's own.
pub fn run_with(configure: impl Fn(&mut Config), extra: Vec<ExtraCommand>) -> ExitCode {
    try_run_with(
        |cfg| {
            configure(cfg);
            Ok(())
        },
        extra,
    )
}

/// [`run_with`] for a `configure` that can fail (reading a config file,
/// say). `ssqch serve` calls it again when one of the configuration's files
/// changes (see [`Config::add_config_file`]); a failure then is reported, and
/// the server carries on with the configuration it had.
pub fn try_run_with(configure: impl Fn(&mut Config) -> anyhow::Result<()>, extra: Vec<ExtraCommand>) -> ExitCode {
    // Named after the running binary (`ssqch`, or a site's own binary), not
    // this library crate, so `--version` and `--help` show the right name.
    let name = std::env::args_os()
        .next()
        .and_then(|arg| Path::new(&arg).file_stem().map(|s| s.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "ssqch".into());
    let mut command = Cli::command().name(name);
    for e in &extra {
        command = command.subcommand(e.command.clone());
    }
    let matches = command.get_matches();
    if let Some((sub, sub_matches)) = matches.subcommand() {
        if let Some(e) = extra.iter().find(|e| e.command.get_name() == sub) {
            return (e.run)(sub_matches);
        }
    }
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());
    if let Some(Command::Diff { before, after, exact, ignore, only, lines, format }) = &cli.command {
        return match run_diff(before, after, *exact, ignore, only, *lines, format) {
            Ok(same) => ExitCode::from(if same { 0 } else { 1 }),
            Err(e) => {
                eprintln!("\x1b[31merror:\x1b[0m {:#}", e);
                ExitCode::from(2)
            }
        };
    }
    let serving = matches!(cli.command, Some(Command::Serve { .. }));
    let env = cli
        .env
        .clone()
        .or_else(|| ["SSQCH_ENV", "NODE_ENV"].iter().find_map(|k| std::env::var(k).ok()))
        .and_then(|e| Environment::parse(&e))
        .unwrap_or(if serving { Environment::Development } else { Environment::Production });

    if cli.offline {
        // Read where requests are made (the JavaScript runtime's `fetch`).
        std::env::set_var("SSQCH_OFFLINE", "1");
    }
    let root = cli.root.clone().unwrap_or_else(|| PathBuf::from("."));
    let make_config = || -> anyhow::Result<Config> {
        let mut cfg = Config::new(root.clone(), env);
        cfg.serving = serving;
        cfg.quiet = cli.quiet;
        cfg.verbose = cli.verbose;
        configure(&mut cfg)?;
        if let Some(out) = &cli.output {
            cfg.output = out.clone();
        }
        if let Some(base) = &cli.base {
            cfg.set_base(base).map_err(|e| anyhow::anyhow!("--base: {:#}", e))?;
        }
        Ok(cfg)
    };

    if let Some(Command::Build { format }) = &cli.command {
        match format.as_str() {
            "json" => return build_json(&make_config, &root, env),
            "text" => {}
            other => {
                eprintln!("\x1b[31merror:\x1b[0m --format {}: use text or json", other);
                return ExitCode::FAILURE;
            }
        }
    }
    let result = make_config().and_then(|cfg| match &cli.command {
        Some(Command::Serve { port, ready_file }) => crate::serve::serve_reloading(cfg, &crate::serve::ServeOptions { port: *port, ready_file: ready_file.clone() }, &make_config),
        Some(Command::Inspect { page, field, format }) => run_inspect(&cfg, page, field.as_deref(), format),
        Some(Command::New { path, title, date, archetype, set, format }) => run_new(&cfg, crate::archetype::NewOptions { path: path.clone(), title: title.clone(), date: date.clone(), archetype: archetype.clone(), set: Vec::new() }, set, format),
        _ => crate::build(&cfg).map(|report| print_report(&cfg, &report)),
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("\x1b[31merror:\x1b[0m {:#}", e);
            ExitCode::FAILURE
        }
    }
}

/// `ssqch build --format json`: build, and print one JSON report on
/// standard output whether or not it worked.
fn build_json(make_config: &dyn Fn() -> anyhow::Result<Config>, root: &Path, env: Environment) -> ExitCode {
    use crate::diagnostics::{self, Locator};
    diagnostics::capture();
    let mut out = serde_json::json!({ "schemaVersion": 1, "ok": false, "environment": env.as_str() });
    let errors = match make_config() {
        Err(e) => diagnostics::from_error(&e, "config", &Locator::new(root)),
        Ok(cfg) => {
            let ctx = cfg.build_context();
            let shown = |path: &Path, from: &Path| path.strip_prefix(from).unwrap_or(path).to_string_lossy().replace('\\', "/");
            out["output"] = shown(&ctx.output_dir, &ctx.root).into();
            match crate::build(&cfg) {
                Ok(report) => {
                    let ms = |d: std::time::Duration| (d.as_secs_f64() * 1e6).round() / 1e3;
                    out["durationMs"] = ms(report.duration).into();
                    out["pages"] = serde_json::json!({ "written": report.pages_written, "templates": report.templates, "bytes": report.page_bytes });
                    out["copied"] = serde_json::json!({ "files": report.files_copied, "unchanged": report.files_unchanged, "bytes": report.passthrough_bytes });
                    out["removed"] = report.files_removed.into();
                    out["written"] = report.written.iter().map(|p| shown(p, &ctx.output_dir)).collect::<Vec<_>>().into();
                    out["summary"] = report.summary.iter().map(|(label, value)| serde_json::json!({ "label": label, "value": value })).collect::<Vec<_>>().into();
                    out["timings"] = report.timings.iter().map(|(phase, d)| serde_json::json!({ "phase": phase, "ms": ms(*d) })).collect::<Vec<_>>().into();
                    Vec::new()
                }
                Err(e) => {
                    let dirs = [ctx.input_dir.clone(), ctx.includes_dir.clone(), ctx.data_dir.clone()].into_iter().chain(ctx.theme_dirs.iter().flat_map(|t| [t.clone(), t.join("_includes")]));
                    diagnostics::from_error(&e, "build", &Locator::new(&ctx.root).with_dirs(dirs))
                }
            }
        }
    };
    out["ok"] = errors.is_empty().into();
    out["warnings"] = diagnostics::take_warnings().iter().map(|w| w.to_json()).collect::<Vec<_>>().into();
    out["errors"] = errors.iter().map(|e| e.to_json()).collect::<Vec<_>>().into();
    println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    if errors.is_empty() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

/// `ssqch new`: create a page from an archetype, and say what was made.
fn run_new(cfg: &Config, mut options: crate::archetype::NewOptions, set: &[String], format: &str) -> anyhow::Result<()> {
    if !matches!(format, "text" | "json") {
        anyhow::bail!("--format {}: use text or json", format);
    }
    for pair in set {
        let Some((key, value)) = pair.split_once('=') else { anyhow::bail!("--set {}: give a key and a value, like --set draft=true", pair) };
        options.set.push((key.trim().to_string(), value.trim().to_string()));
    }
    let created = crate::archetype::new_page(cfg, &options)?;
    let ctx = cfg.build_context();
    let root = dunce::canonicalize(&ctx.root).unwrap_or_else(|_| ctx.root.clone());
    let shown = |path: &Path| crate::slashes(path.strip_prefix(&root).unwrap_or(path));
    if format == "json" {
        let out = serde_json::json!({ "schemaVersion": 1, "path": shown(&created.path), "archetype": created.archetype.as_deref().map(shown), "title": created.title, "date": created.date });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        match &created.archetype {
            Some(archetype) => println!("Created {} from {}", shown(&created.path), shown(archetype)),
            None => println!("Created {} with a title and a date (there's no archetype for it in {}/_archetypes/)", shown(&created.path), shown(&dunce::canonicalize(&ctx.input_dir).unwrap_or_else(|_| ctx.input_dir.clone()))),
        }
    }
    Ok(())
}

/// `ssqch inspect`: print where a page (or one field of its data) comes from.
fn run_inspect(cfg: &Config, page: &str, field: Option<&str>, format: &str) -> anyhow::Result<()> {
    if !matches!(format, "text" | "json") {
        anyhow::bail!("--format {}: use text or json", format);
    }
    let report = crate::inspect::inspect(cfg, page)?;
    let field = match field {
        Some(name) => Some(report.field(name).ok_or_else(|| {
            let names: Vec<&str> = report.fields.iter().map(|f| f.name.as_str()).collect();
            anyhow::anyhow!("{} has no `{}` in its data (it has: {})", report.url.as_deref().unwrap_or(&report.input_path), name.split('.').next().unwrap_or(name), names.join(", "))
        })?),
        None => None,
    };
    match (format, &field) {
        ("json", _) => println!("{}", serde_json::to_string_pretty(&report.to_json(field.as_ref()))?),
        (_, Some(field)) => print!("{}", crate::inspect::Inspection::field_text(field)),
        _ => print!("{}", report.to_text()),
    }
    Ok(())
}

/// `ssqch diff`: print the comparison; whether the builds are the same.
fn run_diff(before: &Path, after: &Path, exact: bool, ignore: &[String], only: &[String], lines: usize, format: &str) -> anyhow::Result<bool> {
    use anyhow::Context;
    use std::io::IsTerminal;
    if !matches!(format, "text" | "json") {
        anyhow::bail!("--format {}: use text or json", format);
    }
    let mut options = crate::diff::DiffOptions { exact, ..Default::default() };
    for pattern in ignore {
        options.ignore.push(regex::Regex::new(pattern).with_context(|| format!("--ignore {:?} isn't a regular expression", pattern))?);
    }
    if !only.is_empty() {
        let mut set = globset::GlobSetBuilder::new();
        for glob in only {
            set.add(globset::GlobBuilder::new(glob.trim_start_matches(['.', '/'])).literal_separator(true).build().with_context(|| format!("--only {:?} isn't a glob", glob))?);
        }
        options.only = Some(set.build()?);
    }
    let report = crate::diff::compare(before, after, &options)?;
    if format == "json" {
        println!("{}", serde_json::to_string_pretty(&report.to_json(lines))?);
    } else {
        print!("{}", report.to_text(lines, std::io::stdout().is_terminal()));
    }
    Ok(report.is_same())
}

pub(crate) fn print_report(cfg: &Config, report: &BuildReport) {
    if !cfg.quiet {
        print!("{}", crate::report::summary(cfg, report));
    }
}
