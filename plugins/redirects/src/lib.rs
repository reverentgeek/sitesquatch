//! Redirects for SiteSquatch.
//!
//! Old URLs come from each page's `aliases` (a URL path or a list of them)
//! and from the `redirects` option (`{ "/old/": "/new/" }`, where the target
//! can be another site). Each becomes a small page that sends browsers on
//! (a meta refresh, with a canonical link and `noindex`), a line in a
//! Netlify `_redirects` file, or both. The `_redirects` lines go after any
//! the site's own `_redirects` template writes.

use std::collections::BTreeMap;

use anyhow::{bail, Result};
use sitesquatch::{escape_html, slashes, Config, GeneratedFile, Plugin, Value};

#[derive(Clone, Debug)]
pub struct RedirectsOptions {
    /// Write a redirect page at each old URL. Default true.
    pub pages: bool,
    /// Add `/old /new 301` lines to `_redirects`. Default false.
    pub netlify: bool,
    /// Redirects that aren't a page's alias: old URL path to new URL.
    pub redirects: BTreeMap<String, String>,
}

impl Default for RedirectsOptions {
    fn default() -> Self {
        RedirectsOptions { pages: true, netlify: false, redirects: BTreeMap::new() }
    }
}

pub struct RedirectsPlugin {
    options: RedirectsOptions,
}

impl RedirectsPlugin {
    pub fn new(options: RedirectsOptions) -> Result<Self> {
        if !options.pages && !options.netlify {
            bail!("pages and netlify are both false, so there's nothing to write; turn one on");
        }
        for from in options.redirects.keys() {
            check_path(from).map_err(|e| anyhow::anyhow!("redirects: {}", e))?;
        }
        Ok(RedirectsPlugin { options })
    }
}

fn check_path(path: &str) -> Result<()> {
    if !path.starts_with('/') || path.split('/').any(|p| p == "..") || path.contains(['?', '#', ' ']) {
        bail!("{:?} must be a URL path starting with /, like \"/old-post/\"", path);
    }
    Ok(())
}

/// The redirect page for `to`.
pub fn redirect_page(to: &str) -> String {
    let to = escape_html(to);
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<meta charset=\"utf-8\">\n<title>Redirecting to {0}</title>\n<link rel=\"canonical\" href=\"{0}\">\n<meta name=\"robots\" content=\"noindex\">\n<meta http-equiv=\"refresh\" content=\"0; url={0}\">\n<p>This page has moved to <a href=\"{0}\">{0}</a>.</p>\n</html>\n",
        to
    )
}

impl Plugin for RedirectsPlugin {
    fn name(&self) -> &str {
        "redirects"
    }

    fn register(&self, cfg: &mut Config) {
        let options = self.options.clone();
        cfg.add_generator("ssqch/redirects", move |ctx, pages| {
            let page_at = |url: &str| pages.iter().find(|p| p.url == url || p.url.trim_end_matches('/') == url.trim_end_matches('/'));
            // Old URL -> (new URL, where it came from).
            let mut all: BTreeMap<String, (String, String)> = BTreeMap::new();
            for (from, to) in &options.redirects {
                all.insert(from.clone(), (to.clone(), "the redirects option".into()));
            }
            for page in pages {
                let source = sitesquatch::display_path(ctx, &page.input_path);
                let aliases: Vec<Value> = match page.data.get("aliases") {
                    Value::Undefined | Value::Null => continue,
                    Value::Str(s) => vec![Value::Str(s)],
                    Value::Arr(a) => a.to_vec(),
                    other => bail!("{}: aliases must be a URL path or a list of them, not {}", source, other.type_of()),
                };
                for alias in aliases {
                    let Some(alias) = alias.as_str() else { bail!("{}: aliases must be URL paths, not {}", source, alias.type_of()) };
                    check_path(alias).map_err(|e| anyhow::anyhow!("{}: aliases: {}", source, e))?;
                    if let Some((_, other)) = all.insert(alias.to_string(), (page.url.clone(), source.clone())) {
                        bail!("{} and {} both redirect {}", other, source, alias);
                    }
                }
            }
            let mut files = Vec::new();
            let mut lines = String::new();
            for (from, (to, source)) in &all {
                if let Some(page) = page_at(from) {
                    bail!("{}: {} is the URL of {}, so it can't redirect to {}", source, from, slashes(page.input_path.strip_prefix(&ctx.root).unwrap_or(&page.input_path)), to);
                }
                if options.pages {
                    // `/old` and `/old/` both become `/old/index.html`; `/old.html` stays a file.
                    let has_ext = from.rsplit('/').next().is_some_and(|last| last.contains('.'));
                    let path = if from.ends_with('/') || has_ext { from.clone() } else { format!("{}/", from) };
                    files.push(GeneratedFile { path, contents: redirect_page(to), append: false });
                }
                lines.push_str(&format!("{}  {}  301\n", from, to));
            }
            if options.netlify && !lines.is_empty() {
                files.push(GeneratedFile { path: "/_redirects".into(), contents: lines, append: true });
            }
            Ok(files)
        });
    }
}
