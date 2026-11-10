//! A sitemap for SiteSquatch.
//!
//! After the pages are written, `sitemap.xml` lists every HTML page with its
//! absolute URL and, by default, its date as `<lastmod>`. Left out: pages
//! with `sitemap: false` in their data, 404 pages (`/404.html`, `/404/`),
//! pages after the first of a list split into pages (unless `paginated`), and
//! URLs matching an `exclude` glob (`/drafts/**`).

use anyhow::{bail, Context, Result};
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use sitesquatch::{escape_html, Config, GeneratedFile, Plugin, Value};

#[derive(Clone, Debug)]
pub struct SitemapOptions {
    /// The site's address, like `https://example.com`.
    pub url: String,
    /// URL globs to leave out: `/tags/**`.
    pub exclude: Vec<String>,
    /// Add `<lastmod>` from each page's date. Default true.
    pub lastmod: bool,
    /// Where to write it. Default `/sitemap.xml`.
    pub output: String,
    /// List every page of a paginated template, not just the first. Default false.
    pub paginated: bool,
}

impl SitemapOptions {
    pub fn new(url: impl Into<String>) -> Self {
        SitemapOptions { url: url.into(), exclude: Vec::new(), lastmod: true, output: "/sitemap.xml".into(), paginated: false }
    }
}

pub struct SitemapPlugin {
    options: SitemapOptions,
    exclude: GlobSet,
}

impl SitemapPlugin {
    pub fn new(options: SitemapOptions) -> Result<Self> {
        if !(options.url.starts_with("https://") || options.url.starts_with("http://")) {
            bail!("url must be the site's address, like \"https://example.com\" (got {:?})", options.url);
        }
        if !options.output.starts_with('/') || options.output.ends_with('/') {
            bail!("output must be a URL path to a file, like \"/sitemap.xml\" (got {:?})", options.output);
        }
        let mut set = GlobSetBuilder::new();
        for glob in &options.exclude {
            if !glob.starts_with('/') {
                bail!("exclude: {:?} must be a URL path or glob starting with /, like \"/tags/**\"", glob);
            }
            set.add(GlobBuilder::new(glob).literal_separator(true).build().with_context(|| format!("exclude: invalid glob {:?}", glob))?);
        }
        Ok(SitemapPlugin { exclude: set.build()?, options })
    }
}

/// Page 2 and on of a list split into pages (`pagination.size` over 1). With
/// a size of 1, each page is its own item (a tag's page), so it counts.
fn is_later_page(data: &Value) -> bool {
    let p = data.get("pagination");
    p.get("pageNumber").as_f64().unwrap_or(0.0) > 0.0 && p.get("size").as_f64().unwrap_or(1.0) > 1.0
}

impl Plugin for SitemapPlugin {
    fn name(&self) -> &str {
        "sitemap"
    }

    fn register(&self, cfg: &mut Config) {
        let options = self.options.clone();
        let exclude = self.exclude.clone();
        cfg.add_generator("ssqch/sitemap", move |_, pages| {
            let base = options.url.trim_end_matches('/');
            let mut entries: Vec<(&str, String)> = pages
                .iter()
                .filter(|p| p.output_path.extension().is_some_and(|e| e == "html"))
                .filter(|p| !matches!(p.data.get("sitemap"), Value::Bool(false)))
                .filter(|p| options.paginated || !is_later_page(&p.data))
                .filter(|p| !matches!(p.url.as_str(), "/404.html" | "/404/"))
                .filter(|p| !exclude.is_match(&p.url))
                .map(|p| (p.url.as_str(), p.date.format("%Y-%m-%d").to_string()))
                .collect();
            entries.sort();
            let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
            for (url, date) in entries {
                xml.push_str(&format!("  <url>\n    <loc>{}{}</loc>\n", escape_html(base), escape_html(url)));
                if options.lastmod {
                    xml.push_str(&format!("    <lastmod>{}</lastmod>\n", date));
                }
                xml.push_str("  </url>\n");
            }
            xml.push_str("</urlset>\n");
            Ok(vec![GeneratedFile { path: options.output.clone(), contents: xml, append: false }])
        });
    }
}
