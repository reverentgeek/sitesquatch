//! `ssqch capabilities`: what this binary can do.
//!
//! A release has every feature, but a binary built from source can leave
//! some out (Sass, `fetch()`, a template language), and an older or newer
//! one has other commands and options. A script or a coding agent asks
//! instead of guessing from documentation for another version.

use std::process::ExitCode;

use serde_json::json;
use sitesquatch::cli::clap;

pub fn capabilities_command() -> clap::Command {
    clap::Command::new("capabilities")
        .about("Say what this binary supports: template languages, modules, config options and optional features")
        .arg(clap::Arg::new("format").long("format").value_name("FORMAT").help("text or json").default_value("text"))
}

/// The names a built-in module exports, read from its source.
fn exports(source: &str) -> Vec<String> {
    let name = regex::Regex::new(r"(?m)^export (?:async )?(?:function|const) (\w+)").unwrap();
    name.captures_iter(source).map(|c| c[1].to_string()).collect()
}

pub fn capabilities() -> serde_json::Value {
    let features = [
        ("avif", cfg!(feature = "avif")),
        ("fetch", cfg!(feature = "fetch")),
        ("sass", cfg!(feature = "sass")),
        ("liquid", cfg!(feature = "liquid")),
        ("jinja", cfg!(feature = "jinja")),
        ("handlebars", cfg!(feature = "handlebars")),
    ];
    let has = |name: &str| features.iter().any(|(f, on)| *f == name && *on);

    let mut languages = vec![
        json!({ "name": "edge", "extensions": ["edge"] }),
        json!({ "name": "markdown", "extensions": ["md", "markdown"] }),
        json!({ "name": "html", "extensions": ["html"] }),
    ];
    #[cfg(feature = "liquid")]
    languages.push(json!({ "name": "liquid", "extensions": ["liquid"] }));
    #[cfg(feature = "jinja")]
    languages.push(json!({ "name": "nunjucks", "extensions": sitesquatch_plugin_jinja::EXTENSIONS }));
    #[cfg(feature = "handlebars")]
    languages.push(json!({ "name": "handlebars", "extensions": sitesquatch_plugin_handlebars::EXTENSIONS }));

    let mut modules = vec![json!({ "name": "ssqch", "exports": sitesquatch_js::CONFIG_MODULE_EXPORTS })];
    for module in crate::modules::js_modules() {
        // The module is there either way, so a config that imports it gets a clear error.
        if module.name == "ssqch/sass" && !has("sass") {
            continue;
        }
        modules.push(json!({ "name": module.name, "exports": exports(&module.source) }));
    }

    let (node, stubs) = sitesquatch_js::node_modules();
    let node_names = |names: &[&str]| names.iter().map(|m| format!("node:{}", m)).collect::<Vec<_>>();
    let mut globals = vec!["console", "process", "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "EventTarget", "Intl", "setTimeout", "setInterval", "setImmediate"];
    if has("fetch") {
        globals.extend(["fetch", "Headers", "Request", "Response", "AbortController", "AbortSignal"]);
    }

    let mut image_formats = vec!["webp", "jpeg", "png", "gif", "svg"];
    if has("avif") {
        image_formats.insert(0, "avif");
    }

    // What a site gets without setting them.
    let mut cfg = sitesquatch::Config::new(".", sitesquatch::Environment::Production);
    crate::default_engines(&mut cfg);
    let defaults = json!({ "templateFormats": cfg.template_formats, "markdownEngine": cfg.markdown_engine, "htmlEngine": cfg.html_engine });

    json!({
        "schemaVersion": 1,
        "version": env!("CARGO_PKG_VERSION"),
        "commands": ["build", "serve", "new", "inspect", "diff", "completions", "init", "types", "import", "capabilities"],
        "json": ["build --format json", "inspect --format json", "diff --format json", "capabilities --format json", "serve --ready-file"],
        "features": features.iter().map(|(name, on)| (name.to_string(), json!(on))).collect::<serde_json::Map<_, _>>(),
        "configFiles": sitesquatch_js::CONFIG_FILES.iter().copied().chain(["sitesquatch.toml"]).collect::<Vec<_>>(),
        "configOptions": sitesquatch_js::config_options(),
        "templateLanguages": languages,
        "defaults": defaults,
        "frontMatter": ["yaml", "json", "toml"],
        "dataFiles": ["json", "yaml", "yml", "toml", "js", "mjs", "cjs"],
        "modules": modules,
        "nodeModules": { "available": node_names(node), "stubs": node_names(stubs) },
        "globals": globals,
        "imageFormats": image_formats,
        "starters": ["site", "docs"],
        "starterEngines": crate::init::starter_engines(),
        "importers": ["eleventy", "zola"],
    })
}

fn text(caps: &serde_json::Value) -> String {
    let list = |key: &str| caps[key].as_array().map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    let mut out = format!("ssqch {}\n", caps["version"].as_str().unwrap_or(""));
    let mut row = |label: &str, value: String| out.push_str(&format!("  {:<19}{}\n", label, value));
    row("Commands", list("commands"));
    let features = caps["features"].as_object().map(|f| f.iter().map(|(name, on)| format!("{} {}", name, if on.as_bool() == Some(true) { "yes" } else { "no" })).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    row("Optional features", features);
    let languages: Vec<String> = caps["templateLanguages"].as_array().into_iter().flatten().map(|l| format!("{} (.{})", l["name"].as_str().unwrap_or(""), l["extensions"].as_array().into_iter().flatten().filter_map(|e| e.as_str()).collect::<Vec<_>>().join(", ."))).collect();
    row("Template languages", languages.join(", "));
    let defaults = &caps["defaults"];
    let (md, html) = (defaults["markdownEngine"].as_str().unwrap_or("none"), defaults["htmlEngine"].as_str().unwrap_or("none"));
    let through = if md == html { format!("Markdown and HTML through {}", md) } else { format!("Markdown through {}, HTML through {}", md, html) };
    row("Defaults", format!("templateFormats {}; {}", defaults["templateFormats"].as_array().into_iter().flatten().filter_map(|f| f.as_str()).collect::<Vec<_>>().join(", "), through));
    row("Config files", list("configFiles"));
    row("Config options", list("configOptions"));
    let modules: Vec<&str> = caps["modules"].as_array().into_iter().flatten().filter_map(|m| m["name"].as_str()).collect();
    row("Modules", modules.join(", "));
    row("Node modules", caps["nodeModules"]["available"].as_array().into_iter().flatten().filter_map(|m| m.as_str()).collect::<Vec<_>>().join(", "));
    row("Globals", list("globals"));
    row("Image formats", list("imageFormats"));
    row("Starters", format!("{} (in {})", list("starters"), list("starterEngines")));
    row("Importers", list("importers"));
    out.push_str("\n--format json has all of it, with each module's exports.\n");
    out
}

pub fn run_capabilities(matches: &clap::ArgMatches) -> ExitCode {
    let caps = capabilities();
    match matches.get_one::<String>("format").map(String::as_str) {
        Some("json") => println!("{}", serde_json::to_string_pretty(&caps).unwrap_or_default()),
        Some("text") | None => print!("{}", text(&caps)),
        Some(other) => {
            eprintln!("{} --format {}: use text or json", sitesquatch::diagnostics::red("error:"), other);
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
