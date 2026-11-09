//! Command line interface shared by the `ssqch` binary and custom site binaries.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

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
    /// development or production (default: $SSQCH_ENV, $NODE_ENV,
    /// then production for `build` and development for `serve`)
    #[arg(long, global = true)]
    env: Option<String>,
    #[arg(long, short, global = true)]
    quiet: bool,
    /// Print per-phase timings
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
}

/// Parse arguments, let `configure` set up the site, then build or serve.
pub fn run(configure: impl Fn(&mut Config)) -> ExitCode {
    let cli = Cli::parse();
    let serving = matches!(cli.command, Some(Command::Serve { .. }));
    let env = cli
        .env
        .clone()
        .or_else(|| ["SSQCH_ENV", "NODE_ENV"].iter().find_map(|k| std::env::var(k).ok()))
        .and_then(|e| Environment::parse(&e))
        .unwrap_or(if serving { Environment::Development } else { Environment::Production });

    let root = cli.root.clone().unwrap_or_else(|| PathBuf::from("."));
    let mut cfg = Config::new(root, env);
    cfg.serving = serving;
    cfg.quiet = cli.quiet;
    cfg.verbose = cli.verbose;
    configure(&mut cfg);
    if let Some(out) = &cli.output {
        cfg.output = out.clone();
    }

    let result = match cli.command {
        Some(Command::Serve { port }) => crate::serve::serve(&cfg, port),
        _ => crate::build(&cfg).map(|report| print_report(&cfg, &report)),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("\x1b[31merror:\x1b[0m {:#}", e);
            ExitCode::FAILURE
        }
    }
}

pub(crate) fn print_report(cfg: &Config, report: &BuildReport) {
    if cfg.quiet {
        return;
    }
    if cfg.verbose {
        for (label, d) in &report.timings {
            println!("  {:<28} {:>8.1?}", label, d);
        }
    }
    println!(
        "Wrote {} pages and copied {} files in {:.2?} ({} mode)",
        report.pages_written,
        report.files_copied,
        report.duration,
        cfg.env.as_str()
    );
}
