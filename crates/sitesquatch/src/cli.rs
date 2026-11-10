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
    Build,
    /// Build, serve, watch for changes and live-reload the browser
    Serve {
        #[arg(long, short, default_value_t = 8080)]
        port: u16,
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

    let result = make_config().and_then(|cfg| match cli.command {
        Some(Command::Serve { port }) => crate::serve::serve_reloading(cfg, port, &make_config),
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
