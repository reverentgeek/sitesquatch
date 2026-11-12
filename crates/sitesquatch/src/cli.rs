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
    /// Create a page from a blueprint (a file in _blueprints/), with its title and date filled in
    #[command(after_help = "The blueprint is named after the page's folder (_blueprints/posts.md for posts/), then `default`.\nIts body is copied as it is; only front matter keys are filled in. Nothing is overwritten.\n\n  ssqch new posts/pine-cones.md\n  ssqch new posts --title \"Pine cones\"      (named like the other pages in posts/)\n  ssqch new docs/guides/install.md --set order=3 --set draft=true")]
    New {
        /// The new file, from the input folder (posts/pine-cones.md), or a folder, with --title
        path: String,
        /// The page's title (default: from the file's name)
        #[arg(long)]
        title: Option<String>,
        /// The page's date, as it's written in front matter (default: today)
        #[arg(long)]
        date: Option<String>,
        /// The blueprint to use (default: the page's folder, then `default`)
        #[arg(long, value_name = "NAME")]
        blueprint: Option<String>,
        /// Another front matter key, with its value as it's written there (repeatable)
        #[arg(long, value_name = "KEY=VALUE")]
        set: Vec<String>,
        /// text or json
        #[arg(long, default_value = "text")]
        format: String,
    },
    /// Show where a page comes from, and which level of the data cascade set each value
    #[command(after_help = "The site is read as a build reads it, up to rendering: beforeBuild hooks run (data can depend on them),\nbut no page is rendered or written, and afterBuild hooks don't run. Standard output is only the report.\n\n  ssqch inspect /guides/install/\n  ssqch inspect src/guides/install.md --field title\n  ssqch inspect /guides/install/ --field hero.alt --format json")]
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
    /// Print a completion script for your shell, so Tab finishes commands and options
    #[command(after_help = "Put the script where your shell looks for completions:\n\n  ssqch completions zsh > ~/.zfunc/_ssqch        (with ~/.zfunc in $fpath, before compinit)\n  ssqch completions bash > ~/.local/share/bash-completion/completions/ssqch\n  ssqch completions fish > ~/.config/fish/completions/ssqch.fish\n  ssqch completions powershell >> $PROFILE")]
    Completions {
        /// bash, zsh, fish, powershell or elvish
        shell: clap_complete::Shell,
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
    /// Show how much a build weighs: its files by kind, and the heaviest pages and files
    #[command(after_help = "It reads a build folder, so build first:\n\n  ssqch build\n  ssqch footprint                 (the site's output folder)\n  ssqch footprint dist-before     (any build)\n  ssqch footprint --top 20 --format json")]
    Footprint {
        /// The build folder (default: the site's output folder)
        dir: Option<PathBuf>,
        /// How many of the heaviest pages and files to list (0 for none)
        #[arg(long, default_value_t = 5)]
        top: usize,
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

/// The whole command line, `extra` commands included, named `name`: what
/// `--help` describes (and `ssqch docs` lists).
pub fn command(name: &str, extra: &[ExtraCommand]) -> clap::Command {
    let mut command = Cli::command().name(name.to_string());
    for e in extra {
        command = command.subcommand(e.command.clone());
    }
    command
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
    let matches = command(&name, &extra).try_get_matches().unwrap_or_else(|e| refused(e));
    if let Some((sub, sub_matches)) = matches.subcommand() {
        if let Some(e) = extra.iter().find(|e| e.command.get_name() == sub) {
            return (e.run)(sub_matches);
        }
    }
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());
    if let Some(Command::Completions { shell }) = &cli.command {
        // Every command, the binary's own included, except the ones it keeps out of `--help`.
        let mut command = Cli::command().name(name.clone());
        for e in extra.iter().filter(|e| !e.command.is_hide_set()) {
            command = command.subcommand(e.command.clone());
        }
        clap_complete::generate(*shell, &mut command, name, &mut std::io::stdout());
        return ExitCode::SUCCESS;
    }
    if let Some(Command::Diff { before, after, exact, ignore, only, lines, format }) = &cli.command {
        return match run_diff(before, after, *exact, ignore, only, *lines, format) {
            Ok(same) => ExitCode::from(if same { 0 } else { 1 }),
            Err(e) => {
                eprintln!("{} {:#}", crate::diagnostics::red("error:"), e);
                ExitCode::from(2)
            }
        };
    }
    // A folder of its own needs no config.
    if let Some(Command::Footprint { dir: Some(dir), top, format }) = &cli.command {
        return report_errors(run_footprint(dir, &dir.to_string_lossy(), *top, format));
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
    // `ssqch inspect` prints a report: what its hooks and `console.log` say goes to standard error.
    let inspecting = matches!(cli.command, Some(Command::Inspect { .. }));
    if inspecting {
        crate::diagnostics::capture();
    }
    let root = cli.root.clone().unwrap_or_else(|| PathBuf::from("."));
    let make_config = || -> anyhow::Result<Config> {
        let mut cfg = Config::new(root.clone(), env);
        cfg.serving = serving;
        cfg.quiet = cli.quiet || inspecting;
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
                eprintln!("{} --format {}: use text or json", crate::diagnostics::red("error:"), other);
                return ExitCode::FAILURE;
            }
        }
    }
    // Where an error's files are, once the configuration has said: its lines are printed under it.
    let located: std::cell::RefCell<Option<crate::diagnostics::Locator>> = Default::default();
    let result = make_config().and_then(|cfg| {
        *located.borrow_mut() = Some(crate::diagnostics::Locator::of(&cfg));
        run_command(&cli, cfg, &make_config)
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            match located.into_inner() {
                Some(at) => crate::diagnostics::print_error("error:", &e, "build", &at),
                None => crate::diagnostics::print_error("error:", &e, "config", &crate::diagnostics::Locator::new(&root)),
            }
            ExitCode::FAILURE
        }
    }
}

/// Run `serve`, `inspect`, `new` or (by default) `build`.
fn run_command(cli: &Cli, cfg: Config, make_config: &dyn Fn() -> anyhow::Result<Config>) -> anyhow::Result<()> {
    match &cli.command {
        Some(Command::Serve { port, ready_file }) => crate::serve::serve_reloading(cfg, &crate::serve::ServeOptions { port: *port, ready_file: ready_file.clone() }, make_config),
        Some(Command::Inspect { page, field, format }) => run_inspect(&cfg, page, field.as_deref(), format),
        Some(Command::Footprint { top, format, .. }) => {
            let ctx = cfg.build_context();
            let shown = crate::slashes(ctx.output_dir.strip_prefix(&ctx.root).unwrap_or(&ctx.output_dir));
            run_footprint(&ctx.output_dir, &shown, *top, format)
        }
        Some(Command::New { path, title, date, blueprint, set, format }) => run_new(&cfg, crate::blueprint::NewOptions { path: path.clone(), title: title.clone(), date: date.clone(), blueprint: blueprint.clone(), set: Vec::new() }, set, format),
        _ => crate::build(&cfg).map(|report| print_report(&cfg, &report)),
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
                    out["pages"] = serde_json::json!({ "written": report.pages_written, "templates": report.templates, "bytes": report.page_bytes, "new": report.pages_new, "gone": report.pages_gone });
                    out["copied"] = serde_json::json!({ "files": report.files_copied, "unchanged": report.files_unchanged, "bytes": report.passthrough_bytes });
                    out["removed"] = report.files_removed.into();
                    out["drafts"] = report.drafts.into();
                    out["written"] = report.written.iter().map(|p| shown(p, &ctx.output_dir)).collect::<Vec<_>>().into();
                    out["summary"] = report.summary.iter().map(|(label, value)| serde_json::json!({ "label": label, "value": value })).collect::<Vec<_>>().into();
                    out["timings"] = report.timings.iter().map(|(phase, d)| serde_json::json!({ "phase": phase, "ms": ms(*d) })).collect::<Vec<_>>().into();
                    Vec::new()
                }
                Err(e) => diagnostics::from_error(&e, "build", &Locator::of(&cfg)),
            }
        }
    };
    out["ok"] = errors.is_empty().into();
    out["warnings"] = diagnostics::take_warnings().iter().map(|w| w.to_json()).collect::<Vec<_>>().into();
    out["errors"] = errors.iter().map(|e| e.to_json()).collect::<Vec<_>>().into();
    println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    if errors.is_empty() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

/// `ssqch new`: create a page from a blueprint, and say what was made.
fn run_new(cfg: &Config, mut options: crate::blueprint::NewOptions, set: &[String], format: &str) -> anyhow::Result<()> {
    if !matches!(format, "text" | "json") {
        anyhow::bail!("--format {}: use text or json", format);
    }
    for pair in set {
        let Some((key, value)) = pair.split_once('=') else { anyhow::bail!("--set {}: give a key and a value, like --set draft=true", pair) };
        options.set.push((key.trim().to_string(), value.trim().to_string()));
    }
    let created = crate::blueprint::new_page(cfg, &options)?;
    let ctx = cfg.build_context();
    let root = dunce::canonicalize(&ctx.root).unwrap_or_else(|_| ctx.root.clone());
    let shown = |path: &Path| crate::slashes(path.strip_prefix(&root).unwrap_or(path));
    if format == "json" {
        let out = serde_json::json!({ "schemaVersion": 1, "path": shown(&created.path), "blueprint": created.blueprint.as_deref().map(shown), "title": created.title, "date": created.date });
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        match &created.blueprint {
            Some(blueprint) => println!("Created {} from {}", shown(&created.path), shown(blueprint)),
            None => println!("Created {} with a title and a date (there's no blueprint for it in {}/_blueprints/)", shown(&created.path), shown(&dunce::canonicalize(&ctx.input_dir).unwrap_or_else(|_| ctx.input_dir.clone()))),
        }
    }
    Ok(())
}

/// `ssqch inspect`: print where a page (or one field of its data) comes from.
fn run_inspect(cfg: &Config, page: &str, field: Option<&str>, format: &str) -> anyhow::Result<()> {
    if !matches!(format, "text" | "json") {
        anyhow::bail!("--format {}: use text or json", format);
    }
    let report = crate::inspect::inspect(cfg, page);
    for warning in crate::diagnostics::take_warnings() {
        eprintln!("warn: {}", warning.message);
    }
    let report = report?;
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

/// A command line clap refused. When the word it refused is another
/// generator's (`ssqch dev`, `--drafts`), ssqch's name for it goes under the
/// error, before the usage line. Exits as clap does.
fn refused(error: clap::Error) -> ! {
    use clap::error::{ContextKind, ContextValue, ErrorKind};
    let word = match error.kind() {
        ErrorKind::InvalidSubcommand => error.get(ContextKind::InvalidSubcommand).map(|v| (v.to_string(), crate::equivalents::Kind::Command)),
        ErrorKind::UnknownArgument => match error.get(ContextKind::InvalidArg) {
            Some(ContextValue::String(arg)) => Some((arg.split('=').next().unwrap_or(arg).to_string(), crate::equivalents::Kind::Flag)),
            _ => None,
        },
        _ => None,
    };
    let Some(equivalent) = word.and_then(|(word, kind)| crate::equivalents::find(&word, kind)) else { error.exit() };
    let rendered = error.render().to_string();
    let (head, usage) = rendered.split_once("\nUsage:").map(|(h, u)| (h.to_string(), format!("Usage:{}", u))).unwrap_or((rendered.clone(), String::new()));
    // clap's own tips guess (`a similar subcommand exists`, `use '-- --template'`); the hint knows.
    let mut head: Vec<&str> = head.lines().filter(|l| !l.trim_start().starts_with("tip:")).collect();
    head.dedup_by(|a, b| a.trim().is_empty() && b.trim().is_empty());
    let hint: String = equivalent.hint().lines().map(|l| format!("  {}\n", l)).collect();
    eprint!("{}\n\n{}{}", head.join("\n").trim_end(), hint, if usage.is_empty() { String::new() } else { format!("\n{}", usage) });
    std::process::exit(error.exit_code());
}

/// `ssqch footprint`: what the build in `dir` weighs.
fn run_footprint(dir: &Path, shown: &str, top: usize, format: &str) -> anyhow::Result<()> {
    if !matches!(format, "text" | "json") {
        anyhow::bail!("--format {}: use text or json", format);
    }
    let footprint = crate::footprint::measure(dir)?;
    if format == "json" {
        println!("{}", serde_json::to_string_pretty(&footprint.to_json(shown, top))?);
    } else {
        print!("{}", footprint.to_text(shown, top));
    }
    Ok(())
}

/// Exit 0, or print the error and exit 1.
fn report_errors(result: anyhow::Result<()>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{} {:#}", crate::diagnostics::red("error:"), e);
            ExitCode::FAILURE
        }
    }
}

pub(crate) fn print_report(cfg: &Config, report: &BuildReport) {
    if !cfg.quiet {
        print!("{}", crate::report::summary(cfg, report));
    }
}
