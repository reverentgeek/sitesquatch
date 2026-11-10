//! The `ssqch` command-line tool.
//!
//! A site is configured by `ssqch.config.js` (JavaScript) or
//! `sitesquatch.toml` in the project root. Sites that want to
//! extend SiteSquatch in Rust build their own binary with `sitesquatch::cli::run`.

mod init;
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
use sitesquatch_plugin_links::{LinksOptions, LinksPlugin};
use sitesquatch_plugin_minify::{MinifyOptions, MinifyPlugin};
use sitesquatch_plugin_redirects::{RedirectsOptions, RedirectsPlugin};
use sitesquatch_plugin_rss::RssPlugin;
#[cfg(feature = "sass")]
use sitesquatch_plugin_sass::{SassOptions, SassPlugin, Style};
use sitesquatch_plugin_sitemap::{SitemapOptions, SitemapPlugin};

/// Built-in plugins, which a JavaScript config adds with `imagePlugin()`,
/// `rssPlugin()`, `minifyPlugin()`, `assetsPlugin()` and `linksPlugin()` from the matching
/// `ssqch/` modules.
const BUILTINS: &[(&str, BuiltinPlugin)] = &[("ssqch/rss", rss), ("ssqch/image", image), ("ssqch/minify", minify), ("ssqch/assets", assets), ("ssqch/links", links), ("ssqch/sitemap", sitemap), ("ssqch/redirects", redirects), ("ssqch/sass", sass)];

fn main() -> std::process::ExitCode {
    let extra = vec![
        sitesquatch::cli::ExtraCommand { command: init::init_command(), run: Box::new(init::run_init) },
        sitesquatch::cli::ExtraCommand { command: init::types_command(), run: Box::new(init::run_types) },
    ];
    sitesquatch::cli::run_with(
        |cfg| {
            if let Err(e) = configure(cfg) {
                eprintln!("\x1b[31merror:\x1b[0m {:#}", e);
                std::process::exit(1);
            }
        },
        extra,
    )
}

fn configure(cfg: &mut Config) -> Result<()> {
    // Template engines beyond Edge and Markdown. A site renders their files by
    // listing the extension in `templateFormats`.
    #[cfg(feature = "liquid")]
    cfg.add_plugin(sitesquatch_plugin_liquid::LiquidPlugin);
    #[cfg(feature = "jinja")]
    cfg.add_plugin(sitesquatch_plugin_jinja::JinjaPlugin);
    #[cfg(feature = "handlebars")]
    cfg.add_plugin(sitesquatch_plugin_handlebars::HandlebarsPlugin);
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
        &["formats", "widths", "defaultAttributes", "outputDir", "urlPath", "webpQuality", "avifQuality", "avifSpeed", "jpegQuality", "minimumThreshold", "prune", "hashCache", "linkedImages"],
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
    if let Some(l) = o.bool("linkedImages")? { opts.linked_images = l; }
    let plugin = ImagePlugin::new(opts);
    modules::set_image_processor(plugin.processor.clone())?;
    cfg.add_plugin(plugin);
    Ok(())
}

fn minify(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["collapseWhitespace", "removeComments", "shortDoctype", "shortenAttributes"])?;
    let mut opts = MinifyOptions::default();
    if let Some(b) = o.bool("collapseWhitespace")? { opts.collapse_whitespace = b; }
    if let Some(b) = o.bool("removeComments")? { opts.remove_comments = b; }
    if let Some(b) = o.bool("shortDoctype")? { opts.short_doctype = b; }
    if let Some(b) = o.bool("shortenAttributes")? { opts.shorten_attributes = b; }
    cfg.add_plugin(MinifyPlugin { options: opts });
    Ok(())
}

fn assets(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["files", "fingerprint", "integrity"])?;
    let files = o.list("files")?.unwrap_or_default();
    if files.is_empty() {
        bail!("files is required: the URL paths of the files to fingerprint, like [\"/assets/index.css\"]");
    }
    cfg.add_plugin(AssetsPlugin::new(AssetsOptions { files, fingerprint: o.bool("fingerprint")?, integrity: o.bool("integrity")?.unwrap_or(false) })?);
    Ok(())
}

fn links(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["anchors", "ignore", "fail"])?;
    cfg.add_plugin(LinksPlugin::new(LinksOptions { anchors: o.bool("anchors")?, ignore: o.list("ignore")?.unwrap_or_default(), fail: o.bool("fail")? })?);
    Ok(())
}

fn sitemap(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["url", "exclude", "lastmod", "output", "paginated"])?;
    let Some(url) = o.string("url")? else { bail!("url is required: the site's address, like \"https://example.com\"") };
    let mut opts = SitemapOptions::new(url);
    opts.exclude = o.list("exclude")?.unwrap_or_default();
    if let Some(b) = o.bool("lastmod")? { opts.lastmod = b; }
    if let Some(out) = o.string("output")? { opts.output = out; }
    if let Some(b) = o.bool("paginated")? { opts.paginated = b; }
    cfg.add_plugin(SitemapPlugin::new(opts)?);
    Ok(())
}

fn redirects(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["pages", "netlify", "redirects"])?;
    let mut opts = RedirectsOptions::default();
    if let Some(b) = o.bool("pages")? { opts.pages = b; }
    if let Some(b) = o.bool("netlify")? { opts.netlify = b; }
    if let Some(map) = o.get("redirects") {
        let Some(map) = map.as_object() else { bail!("redirects must be an object of {{ \"/old/\": \"/new/\" }}") };
        for (from, to) in map {
            let Some(to) = to.as_str() else { bail!("redirects.{}: the new URL must be a string", from) };
            opts.redirects.insert(from.clone(), to.to_string());
        }
    }
    cfg.add_plugin(RedirectsPlugin::new(opts)?);
    Ok(())
}

#[cfg(not(feature = "sass"))]
fn sass(_cfg: &mut Config, _options: &Json) -> Result<()> {
    bail!("this ssqch was built without the `sass` feature")
}

#[cfg(feature = "sass")]
fn sass(cfg: &mut Config, options: &Json) -> Result<()> {
    let o = Options::new(options, &["files", "style", "loadPaths"])?;
    let mut opts = SassOptions::default();
    match o.get("files") {
        Some(Json::Object(map)) => {
            for (from, to) in map {
                let Some(to) = to.as_str() else { bail!("files.{}: the output must be a URL path string", from) };
                opts.files.push((from.clone(), to.to_string()));
            }
        }
        Some(_) => bail!("files must be an object of {{ source: \"/output\" }}"),
        None => {}
    }
    opts.style = match o.string("style")?.as_deref() {
        None => None,
        Some("compressed") => Some(Style::Compressed),
        Some("expanded") => Some(Style::Expanded),
        Some(other) => bail!("style must be \"compressed\" or \"expanded\", not {:?}", other),
    };
    opts.load_paths = o.list("loadPaths")?.unwrap_or_default();
    cfg.add_plugin(SassPlugin::new(opts)?);
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
