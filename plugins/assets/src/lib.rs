//! Asset fingerprinting for SiteSquatch.
//!
//! Templates link assets by their plain paths (`/assets/index.css`). In a
//! production build, each listed file in the output folder (written there by
//! a CSS or JS tool before the site build) is renamed to
//! `name.<hash>.ext`, where the hash is the first 8 hex characters of a
//! BLAKE3 hash of its contents, and every `href` and `src` attribute in HTML
//! output that points at it is rewritten. Older fingerprinted copies of the
//! same file are deleted, so the output doesn't collect stale versions.
//!
//! In development (`ssqch serve`), nothing is renamed, and pages use the plain
//! paths a watcher keeps updated. If a plain file isn't there but the last
//! production build left one fingerprinted copy of it, pages link to that copy
//! instead, so serving after a build still has styles and scripts.
//!
//! References elsewhere (`url()` in CSS, imports in JavaScript) aren't
//! rewritten. For a hashed URL outside an HTML attribute, templates can call
//! `assetUrl("/assets/index.css")`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, bail, Context, Result};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use sitesquatch::{BuildContext, Config, Environment, Plugin, Value};

#[derive(Clone, Debug, Default)]
pub struct AssetsOptions {
    /// URL paths of the files to fingerprint, relative to the output folder's
    /// root: `/assets/index.css`.
    pub files: Vec<String>,
    /// Whether to fingerprint. `None` means production builds only (not
    /// `ssqch serve`).
    pub fingerprint: Option<bool>,
    /// Add `integrity="sha384-..."` to the `<link>` and `<script>` elements
    /// that load a fingerprinted file. Only fingerprinted builds get it, so a
    /// watcher rewriting a plain file in `ssqch serve` doesn't break the page.
    pub integrity: bool,
}

pub struct AssetsPlugin {
    options: AssetsOptions,
    /// Plain URL path -> the URL to use this build.
    urls: Arc<RwLock<BTreeMap<String, String>>>,
    /// Plain URL path -> its `integrity` value, with `integrity` on.
    hashes: Arc<RwLock<BTreeMap<String, String>>>,
    /// Set for the summary when files were fingerprinted.
    fingerprinted: Arc<RwLock<Vec<String>>>,
}

impl AssetsPlugin {
    pub fn new(options: AssetsOptions) -> Result<Self> {
        for file in &options.files {
            if !file.starts_with('/') || file.ends_with('/') || file.contains("..") {
                bail!("files: \"{}\" must be a URL path to a file, starting with / (like \"/assets/index.css\")", file);
            }
        }
        Ok(AssetsPlugin { options, urls: Default::default(), hashes: Default::default(), fingerprinted: Default::default() })
    }
}

impl Plugin for AssetsPlugin {
    fn name(&self) -> &str {
        "assets"
    }

    fn register(&self, cfg: &mut Config) {
        let options = self.options.clone();
        let urls = self.urls.clone();
        let hashes = self.hashes.clone();
        let done = self.fingerprinted.clone();
        cfg.on_before_build(move |ctx| {
            let enabled = options.fingerprint.unwrap_or(ctx.env == Environment::Production && !ctx.serving);
            let mut map = BTreeMap::new();
            let mut sri = BTreeMap::new();
            let mut names = Vec::new();
            for file in &options.files {
                if enabled {
                    let hashed = fingerprint(&ctx.output_dir, file)?;
                    if options.integrity {
                        let path = ctx.output_dir.join(hashed.trim_start_matches('/'));
                        let bytes = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
                        sri.insert(file.clone(), integrity(&bytes));
                    }
                    names.push(hashed.rsplit('/').next().unwrap_or(&hashed).to_string());
                    map.insert(file.clone(), hashed);
                } else if ctx.output_dir.join(file.trim_start_matches('/')).is_file() {
                    map.insert(file.clone(), file.clone());
                } else if let Some(copy) = built_copy(&ctx.output_dir, file)? {
                    sitesquatch::diagnostics::warn(sitesquatch::diagnostics::Diagnostic::warning("assets", format!("{} isn't in the output ({}), so pages link to {} from the last production build; run the tool that writes {} to see changes", file, display(ctx, &ctx.output_dir), copy, file)));
                    map.insert(file.clone(), copy);
                } else {
                    sitesquatch::diagnostics::warn(sitesquatch::diagnostics::Diagnostic::warning("assets", format!("{} isn't in the output yet ({}); its tool may still be building it", file, display(ctx, &ctx.output_dir))));
                    map.insert(file.clone(), file.clone());
                }
            }
            *urls.write().unwrap() = map;
            *hashes.write().unwrap() = sri;
            *done.write().unwrap() = names;
            Ok(())
        });

        let urls = self.urls.clone();
        let hashes = self.hashes.clone();
        cfg.add_html_transform("assets", move |tctx, html| {
            if !tctx.is_html() {
                return Ok(html);
            }
            let map = urls.read().unwrap();
            let sri = hashes.read().unwrap();
            if map.iter().all(|(plain, url)| plain == url) && sri.is_empty() {
                return Ok(html);
            }
            rewrite_html(&html, &map, &sri)
        });

        let urls = self.urls.clone();
        cfg.add_filter("assetUrl", move |args| {
            let path = args.first().map(|v| v.to_js_string()).unwrap_or_default();
            let map = urls.read().unwrap();
            match map.get(&path) {
                Some(url) => Ok(Value::from(url.as_str())),
                None => bail!("assetUrl(\"{}\"): not one of the assets plugin's files ({})", path, map.keys().cloned().collect::<Vec<_>>().join(", ")),
            }
        });

        let done = self.fingerprinted.clone();
        cfg.add_summary("Assets", move |_| {
            let names = done.read().unwrap();
            if names.is_empty() {
                return None;
            }
            Some(format!("{} fingerprinted ({})", names.len(), names.join(", ")))
        });
    }
}

fn display(ctx: &BuildContext, path: &Path) -> String {
    sitesquatch::display_path(ctx, path)
}

/// Rename the file at URL path `file` in `output` to its fingerprinted name,
/// delete older fingerprinted copies, and return the new URL path.
///
/// If the plain file is missing but a fingerprinted copy is there (a second
/// build without rebuilding the CSS), that copy is used as it is.
fn fingerprint(output: &Path, file: &str) -> Result<String> {
    let plain = output.join(file.trim_start_matches('/'));
    let dir = plain.parent().ok_or_else(|| anyhow!("{}: no folder", file))?.to_path_buf();
    let name = plain.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (stem, ext) = split_name(&name);
    let copies = fingerprinted_copies(&dir, stem, ext)?;

    let hashed_name = if plain.is_file() {
        let bytes = std::fs::read(&plain).with_context(|| format!("reading {}", plain.display()))?;
        let hashed_name = format!("{}.{}{}", stem, &blake3::hash(&bytes).to_hex()[..8], ext);
        std::fs::rename(&plain, dir.join(&hashed_name)).with_context(|| format!("renaming {} to {}", plain.display(), hashed_name))?;
        for old in copies.iter().filter(|c| c.file_name().is_some_and(|n| n.to_string_lossy() != hashed_name)) {
            std::fs::remove_file(old).with_context(|| format!("removing {}", old.display()))?;
        }
        hashed_name
    } else {
        match copies.as_slice() {
            [one] => one.file_name().unwrap().to_string_lossy().into_owned(),
            [] => bail!("{} doesn't exist; build the CSS and JS before ssqch", plain.display()),
            _ => bail!("{} doesn't exist, and there are {} fingerprinted copies of it; rebuild it", plain.display(), copies.len()),
        }
    };
    let base = &file[..file.len() - name.len()];
    Ok(format!("{}{}", base, hashed_name))
}

/// The URL path of the one fingerprinted copy of `file` in `output`, if there's
/// exactly one (what a production build leaves behind).
fn built_copy(output: &Path, file: &str) -> Result<Option<String>> {
    let plain = output.join(file.trim_start_matches('/'));
    let (Some(dir), Some(name)) = (plain.parent(), plain.file_name().map(|n| n.to_string_lossy().into_owned())) else { return Ok(None) };
    let (stem, ext) = split_name(&name);
    Ok(match fingerprinted_copies(dir, stem, ext)?.as_slice() {
        [one] => Some(format!("{}{}", &file[..file.len() - name.len()], one.file_name().unwrap().to_string_lossy())),
        _ => None,
    })
}

/// `index.css` -> (`index`, `.css`). A name without an extension has `""`.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// Files in `dir` named `stem.<8 hex chars>ext`.
fn fingerprinted_copies(dir: &Path, stem: &str, ext: &str) -> Result<Vec<PathBuf>> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
        let hash = name.strip_prefix(stem).and_then(|r| r.strip_prefix('.')).and_then(|r| r.strip_suffix(ext));
        if hash.is_some_and(|h| h.len() == 8 && h.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())) && path.is_file() {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// `sha384-<base64>`, for an `integrity` attribute.
pub fn integrity(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("sha384-{}", base64(&sha2::Sha384::digest(bytes)))
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Rewrite `href` and `src` attributes that point at a fingerprinted path,
/// keeping any query string or fragment, and add `integrity` (from `sri`,
/// by plain path) to the `<link>` and `<script>` elements that load one.
pub fn rewrite_html(html: &str, urls: &BTreeMap<String, String>, sri: &BTreeMap<String, String>) -> Result<String> {
    let plain_path = |value: &str| -> String { value[..value.find(['?', '#']).unwrap_or(value.len())].to_string() };
    let rewrite = |value: &str| -> Option<String> {
        let split = value.find(['?', '#']).unwrap_or(value.len());
        let (path, rest) = value.split_at(split);
        urls.get(path).filter(|url| url.as_str() != path).map(|url| format!("{}{}", url, rest))
    };
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[href], [src]", move |el| {
                let tag = el.tag_name();
                for attr in ["href", "src"] {
                    let Some(value) = el.get_attribute(attr) else { continue };
                    let loads = (tag == "link" && attr == "href") || (tag == "script" && attr == "src");
                    if loads && !el.has_attribute("integrity") {
                        if let Some(hash) = sri.get(&plain_path(&value)) {
                            el.set_attribute("integrity", hash)?;
                        }
                    }
                    if let Some(new) = rewrite(&value) {
                        el.set_attribute(attr, &new)?;
                    }
                }
                Ok(())
            })],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|e| anyhow!("assets transform: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ssqch-assets-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("assets")).unwrap();
        d
    }

    #[test]
    fn rewrites_matching_href_and_src_only() {
        let urls = BTreeMap::from([("/assets/index.css".to_string(), "/assets/index.0123abcd.css".to_string()), ("/assets/index.js".to_string(), "/assets/index.89ef4567.js".to_string())]);
        let html = r#"<link rel="stylesheet" href="/assets/index.css"><link rel="preload" href="/assets/index.js?v=2#x"><script src="/assets/index.js" defer></script><a href="/assets/index.css.map">map</a><img src="/assets/other.png"><p>/assets/index.css</p>"#;
        let out = rewrite_html(html, &urls, &BTreeMap::new()).unwrap();
        assert_eq!(
            out,
            r#"<link rel="stylesheet" href="/assets/index.0123abcd.css"><link rel="preload" href="/assets/index.89ef4567.js?v=2#x"><script src="/assets/index.89ef4567.js" defer></script><a href="/assets/index.css.map">map</a><img src="/assets/other.png"><p>/assets/index.css</p>"#
        );
    }

    #[test]
    fn integrity_goes_on_links_and_scripts() {
        assert_eq!(integrity(b"abc"), "sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn");
        let urls = BTreeMap::from([("/a.css".to_string(), "/a.0123abcd.css".to_string())]);
        let sri = BTreeMap::from([("/a.css".to_string(), "sha384-x".to_string())]);
        let out = rewrite_html(r#"<link rel="stylesheet" href="/a.css"><a href="/a.css">a</a><link href="/a.css" integrity="mine">"#, &urls, &sri).unwrap();
        assert_eq!(out, r#"<link rel="stylesheet" href="/a.0123abcd.css" integrity="sha384-x"><a href="/a.0123abcd.css">a</a><link href="/a.0123abcd.css" integrity="mine">"#);
    }

    #[test]
    fn fingerprints_renames_and_cleans_up() {
        let out = dir("rename");
        std::fs::write(out.join("assets/index.css"), "body { color: green }").unwrap();
        std::fs::write(out.join("assets/index.00000000.css"), "old").unwrap();
        std::fs::write(out.join("assets/index.notahash.css"), "keep").unwrap();
        let url = fingerprint(&out, "/assets/index.css").unwrap();
        let expected = format!("/assets/index.{}.css", &blake3::hash(b"body { color: green }").to_hex()[..8]);
        assert_eq!(url, expected);
        assert!(!out.join("assets/index.css").exists(), "the plain file is renamed");
        assert!(!out.join("assets/index.00000000.css").exists(), "older fingerprinted copies are removed");
        assert!(out.join("assets/index.notahash.css").exists(), "other files are left alone");

        // A second build without rebuilding the CSS reuses the fingerprinted copy.
        assert_eq!(fingerprint(&out, "/assets/index.css").unwrap(), expected);
    }

    #[test]
    fn a_missing_file_is_an_error() {
        let out = dir("missing");
        let e = format!("{:#}", fingerprint(&out, "/assets/index.js").unwrap_err());
        assert!(e.contains("index.js doesn't exist; build the CSS and JS before ssqch"), "{}", e);
    }

    #[test]
    fn finds_the_copy_a_production_build_left() {
        let out = dir("copy");
        assert_eq!(built_copy(&out, "/assets/index.css").unwrap(), None);
        std::fs::write(out.join("assets/index.0123abcd.css"), "built").unwrap();
        assert_eq!(built_copy(&out, "/assets/index.css").unwrap().as_deref(), Some("/assets/index.0123abcd.css"));
        // Two copies: no telling which is current.
        std::fs::write(out.join("assets/index.89ef4567.css"), "older").unwrap();
        assert_eq!(built_copy(&out, "/assets/index.css").unwrap(), None);
    }

    #[test]
    fn paths_must_be_url_paths() {
        assert!(AssetsPlugin::new(AssetsOptions { files: vec!["assets/index.css".into()], fingerprint: None, integrity: false }).is_err());
        assert!(AssetsPlugin::new(AssetsOptions { files: vec!["/../secret".into()], fingerprint: None, integrity: false }).is_err());
        assert!(AssetsPlugin::new(AssetsOptions { files: vec!["/assets/index.css".into()], fingerprint: None, integrity: false }).is_ok());
    }
}
