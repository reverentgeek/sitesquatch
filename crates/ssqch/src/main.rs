//! The `ssqch` command-line tool.
//!
//! A site is configured by `ssqch.config.js` (JavaScript) or
//! `sitesquatch.toml` in the project root. Sites that want to
//! extend SiteSquatch in Rust build their own binary with `sitesquatch::cli::run`.

mod modules;

// musl's allocator is slow under the many-threaded allocation of a build
// (rendering pages and encoding images in parallel), so the static Linux
// release uses mimalloc. Other targets keep the system allocator.
#[cfg(target_env = "musl")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use anyhow::{bail, Result};
use serde_json::Value as Json;
use sitesquatch::Config;
use sitesquatch_js::BuiltinPlugin;
use sitesquatch_plugin_image::{Format, ImageOptions, ImagePlugin};
use sitesquatch_plugin_assets::{AssetsOptions, AssetsPlugin};
use sitesquatch_plugin_minify::{MinifyOptions, MinifyPlugin};
use sitesquatch_plugin_rss::RssPlugin;

/// Built-in plugins, which a JavaScript config adds with `imagePlugin()`,
/// `rssPlugin()`, `minifyPlugin()` and `assetsPlugin()` from the matching `ssqch/` modules.
const BUILTINS: &[(&str, BuiltinPlugin)] = &[("ssqch/rss", rss), ("ssqch/image", image), ("ssqch/minify", minify), ("ssqch/assets", assets)];

fn main() -> std::process::ExitCode {
    sitesquatch::cli::run(|cfg| {
        if let Err(e) = configure(cfg) {
            eprintln!("\x1b[31merror:\x1b[0m {:#}", e);
            std::process::exit(1);
        }
    })
}

fn configure(cfg: &mut Config) -> Result<()> {
    let toml = cfg.root.join("sitesquatch.toml");
    let js_modules = modules::js_modules();
    match sitesquatch_js::find_config(&cfg.root) {
        Some(js) if toml.is_file() => bail!("found both {} and sitesquatch.toml; keep one of them", js.file_name().unwrap_or_default().to_string_lossy()),
        Some(js) => sitesquatch_js::load(cfg, &js, BUILTINS, &js_modules)?,
        None => {
            sitesquatch_js::add_data_files(cfg, &js_modules);
            sitesquatch::site_toml::apply(cfg)?;
        }
    }
    // JavaScript data files can call image() even without the plugin.
    modules::ensure_image_processor(cfg);
    Ok(())
}

fn rss(cfg: &mut Config, options: &Json) -> Result<()> {
    Options::new(options, &[])?;
    cfg.add_plugin(RssPlugin);
    Ok(())
}

fn image(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(
        options,
        &["formats", "widths", "defaultAttributes", "outputDir", "urlPath", "webpQuality", "avifQuality", "avifSpeed", "jpegQuality", "minimumThreshold", "prune", "hashCache"],
    )?;
    let mut opts = ImageOptions::default();
    if let Some(list) = o.list("formats")? {
        opts.formats = list.iter().map(|f| parse_format(f)).collect::<Result<_>>()?;
        if opts.formats.is_empty() {
            bail!("formats can't be empty");
        }
    }
    if let Some(list) = o.get("widths") {
        let Some(items) = list.as_array() else { bail!("widths must be an array of numbers") };
        opts.widths = items.iter().map(|w| w.as_u64().map(|n| n as u32).ok_or_else(|| anyhow::anyhow!("widths must be positive whole numbers, got {}", w))).collect::<Result<_>>()?;
    }
    if let Some(attrs) = o.get("defaultAttributes") {
        let Some(map) = attrs.as_object() else { bail!("defaultAttributes must be an object") };
        opts.default_attributes = map.iter().map(|(k, v)| (k.clone(), v.as_str().map(String::from).unwrap_or_else(|| v.to_string()))).collect();
    }
    if let Some(dir) = o.string("outputDir")? {
        opts.output_subdir = dir;
    }
    if let Some(url) = o.string("urlPath")? {
        opts.url_path = if url.ends_with('/') { url } else { format!("{}/", url) };
    }
    if let Some(q) = o.number("webpQuality")? { opts.webp_quality = q as f32; }
    if let Some(q) = o.number("avifQuality")? { opts.avif_quality = q as f32; }
    if let Some(q) = o.number("avifSpeed")? { opts.avif_speed = q.clamp(1.0, 10.0) as u8; }
    if let Some(q) = o.number("jpegQuality")? { opts.jpeg_quality = q.clamp(1.0, 100.0) as u8; }
    if let Some(t) = o.number("minimumThreshold")? { opts.minimum_threshold = t; }
    if let Some(p) = o.bool("prune")? { opts.prune = p; }
    if let Some(c) = o.bool("hashCache")? { opts.hash_cache = c; }
    let plugin = ImagePlugin::new(opts);
    modules::set_image_processor(plugin.processor.clone())?;
    cfg.add_plugin(plugin);
    Ok(())
}

fn minify(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["collapseWhitespace", "removeComments", "shortDoctype"])?;
    let mut opts = MinifyOptions::default();
    if let Some(b) = o.bool("collapseWhitespace")? { opts.collapse_whitespace = b; }
    if let Some(b) = o.bool("removeComments")? { opts.remove_comments = b; }
    if let Some(b) = o.bool("shortDoctype")? { opts.short_doctype = b; }
    cfg.add_plugin(MinifyPlugin { options: opts });
    Ok(())
}

fn assets(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["files", "fingerprint"])?;
    let files = o.list("files")?.unwrap_or_default();
    if files.is_empty() {
        bail!("files is required: the URL paths of the files to fingerprint, like [\"/assets/index.css\"]");
    }
    cfg.add_plugin(AssetsPlugin::new(AssetsOptions { files, fingerprint: o.bool("fingerprint")? })?);
    Ok(())
}

pub(crate) fn parse_format(name: &str) -> Result<Format> {
    Ok(match name {
        "avif" => Format::Avif,
        "webp" => Format::Webp,
        "jpeg" | "jpg" => Format::Jpeg,
        "png" => Format::Png,
        "gif" => Format::Gif,
        "svg" => Format::Svg,
        "auto" => Format::Auto,
        other => bail!("unknown image format \"{}\" (use avif, webp, jpeg, png, gif, svg or auto)", other),
    })
}

/// A plugin's options object, rejecting misspelled keys.
struct Options<'a>(&'a serde_json::Map<String, Json>);

impl<'a> Options<'a> {
    fn new(value: &'a Json, known: &[&str]) -> Result<Self> {
        let Some(map) = value.as_object() else { bail!("options must be an object") };
        if let Some(key) = map.keys().find(|k| !known.contains(&k.as_str())) {
            if known.is_empty() {
                bail!("this plugin takes no options (got \"{}\")", key);
            }
            bail!("unknown option \"{}\" (options: {})", key, known.join(", "));
        }
        Ok(Options(map))
    }

    fn get(&self, key: &str) -> Option<&Json> {
        self.0.get(key).filter(|v| !v.is_null())
    }

    fn string(&self, key: &str) -> Result<Option<String>> {
        self.get(key).map(|v| v.as_str().map(String::from).ok_or_else(|| anyhow::anyhow!("{} must be a string", key))).transpose()
    }

    fn number(&self, key: &str) -> Result<Option<f64>> {
        self.get(key).map(|v| v.as_f64().ok_or_else(|| anyhow::anyhow!("{} must be a number", key))).transpose()
    }

    fn bool(&self, key: &str) -> Result<Option<bool>> {
        self.get(key).map(|v| v.as_bool().ok_or_else(|| anyhow::anyhow!("{} must be true or false", key))).transpose()
    }

    fn list(&self, key: &str) -> Result<Option<Vec<String>>> {
        let Some(v) = self.get(key) else { return Ok(None) };
        let items = v.as_array().ok_or_else(|| anyhow::anyhow!("{} must be an array of strings", key))?;
        items.iter().map(|i| i.as_str().map(String::from).ok_or_else(|| anyhow::anyhow!("{} must be an array of strings", key))).collect::<Result<_>>().map(Some)
    }
}
