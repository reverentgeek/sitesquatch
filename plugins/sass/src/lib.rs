//! Sass for SiteSquatch, with [grass](https://github.com/connorskees/grass)
//! (pure Rust, no Dart Sass or Node needed).
//!
//! Each entry in `files` maps a source to an output URL path: a `.scss` or
//! `.sass` file to one CSS file, or a folder to a folder, compiling every
//! file in it whose name doesn't start with `_` (those are partials) and
//! keeping their paths. The CSS is written at the start of each build, so
//! asset fingerprinting and the link checker see it, and `ssqch serve`
//! watches the sources.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use sitesquatch::{slashes, Config, Environment, GeneratedFile, Plugin};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Expanded,
    Compressed,
}

#[derive(Clone, Debug, Default)]
pub struct SassOptions {
    /// Source (relative to the project root) to output URL path:
    /// `("src/scss", "/css")` or `("src/app.scss", "/app.css")`.
    pub files: Vec<(String, String)>,
    /// `None`: compressed in production builds, expanded otherwise.
    pub style: Option<Style>,
    /// More folders `@use` and `@import` look in (relative to the root).
    pub load_paths: Vec<String>,
}

pub struct SassPlugin {
    options: SassOptions,
    count: Arc<Mutex<Option<(usize, Style)>>>,
}

impl SassPlugin {
    pub fn new(options: SassOptions) -> Result<Self> {
        if options.files.is_empty() {
            bail!("files is required: {{ \"src/scss\": \"/css\" }} or {{ \"src/app.scss\": \"/app.css\" }}");
        }
        for (from, to) in &options.files {
            if !to.starts_with('/') || to.contains("..") {
                bail!("files: {:?} must be a URL path starting with / (like \"/css/app.css\" or \"/css\")", to);
            }
            if from.is_empty() {
                bail!("files: a source path can't be empty");
            }
        }
        Ok(SassPlugin { options, count: Arc::default() })
    }
}

fn is_sass(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "scss" || e == "sass")
}

/// The sources an entry compiles, and each one's output URL path.
fn entries(root: &Path, from: &str, to: &str) -> Result<Vec<(PathBuf, String)>> {
    let src = root.join(from);
    if src.is_file() {
        if !is_sass(&src) {
            bail!("files: {} isn't a .scss or .sass file", from);
        }
        let to = if to.ends_with('/') { format!("{}{}.css", to, src.file_stem().unwrap().to_string_lossy()) } else { to.to_string() };
        return Ok(vec![(src, to)]);
    }
    if !src.is_dir() {
        bail!("files: {} doesn't exist", from);
    }
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&src).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_sass(path) || entry.file_name().to_string_lossy().starts_with('_') {
            continue;
        }
        let rel = slashes(path.strip_prefix(&src).unwrap().with_extension("css").as_path());
        out.push((path.to_path_buf(), format!("{}/{}", to.trim_end_matches('/'), rel)));
    }
    out.sort();
    Ok(out)
}

impl Plugin for SassPlugin {
    fn name(&self) -> &str {
        "sass"
    }

    fn register(&self, cfg: &mut Config) {
        for (from, _) in &self.options.files {
            cfg.add_watch_target(from);
        }
        let options = self.options.clone();
        let count = self.count.clone();
        cfg.add_file_builder("ssqch/sass", move |ctx| {
            let style = options.style.unwrap_or(if ctx.env == Environment::Production && !ctx.serving { Style::Compressed } else { Style::Expanded });
            let mut grass_options = grass::Options::default().style(match style {
                Style::Compressed => grass::OutputStyle::Compressed,
                Style::Expanded => grass::OutputStyle::Expanded,
            });
            let load_paths: Vec<PathBuf> = options.load_paths.iter().map(|p| ctx.root.join(p)).collect();
            for p in &load_paths {
                grass_options = grass_options.load_path(p);
            }
            let mut files = Vec::new();
            for (from, to) in &options.files {
                for (src, url) in entries(&ctx.root, from, to)? {
                    let name = sitesquatch::display_path(ctx, &src);
                    let css = grass::from_path(&src, &grass_options).map_err(|e| anyhow::anyhow!("{}: {}", name, e)).with_context(|| format!("compiling {}", name))?;
                    // `url(/fonts/a.woff2)` gets the site's `base`, like URLs in HTML.
                    files.push(GeneratedFile::new(url, sitesquatch::base::css_with_base(&ctx.base, &css)));
                }
            }
            *count.lock().unwrap() = Some((files.len(), style));
            Ok(files)
        });
        let count = self.count.clone();
        cfg.add_summary("Sass", move |_| {
            let (n, style) = (*count.lock().unwrap())?;
            Some(format!("{} file{} ({})", n, if n == 1 { "" } else { "s" }, if style == Style::Compressed { "compressed" } else { "expanded" }))
        });
    }
}
