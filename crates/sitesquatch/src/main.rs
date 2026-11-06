//! The generic `ssqch` binary: configured by `sitesquatch.toml`, no plugins.
//! Sites that need plugins build their own binary with `sitesquatch::cli::run`.

fn main() -> std::process::ExitCode {
    sitesquatch::cli::run(|cfg| {
        if let Err(e) = sitesquatch::site_toml::apply(cfg) {
            eprintln!("error: {:#}", e);
            std::process::exit(1);
        }
    })
}
