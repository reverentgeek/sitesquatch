//! RSS/Atom helpers for SiteSquatch, mirroring `@11ty/eleventy-plugin-rss`:
//! `getNewestCollectionItemDate`, `dateToRfc3339`, `dateToRfc822`,
//! `absoluteUrl` and `htmlToAbsoluteUrls`.

use anyhow::{anyhow, Result};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use sitesquatch::{Args, Config, Plugin, Value};

pub struct RssPlugin;

impl Plugin for RssPlugin {
    fn name(&self) -> &str {
        "rss"
    }

    fn register(&self, cfg: &mut Config) {
        cfg.add_filter("getNewestCollectionItemDate", |args| Ok(newest_item_date(&args.arg(0))));
        cfg.add_filter("dateToRfc3339", |args| date_to_rfc3339(&args.arg(0)).map(Value::from));
        cfg.add_filter("dateToRfc822", |args| date_to_rfc822(&args.arg(0)).map(Value::from));
        cfg.add_filter("absoluteUrl", |args| Ok(Value::from(absolute_url(&args.arg_string(0), &args.arg_string(1)))));
        cfg.add_filter("htmlToAbsoluteUrls", |args| Ok(Value::from(html_to_absolute_urls(&args.arg_string(0), &args.arg_string(1))?)));
        // Eleventy's built-in `url` filter (no path prefix support yet).
        cfg.add_filter("url", |args| Ok(args.arg(0)));
    }
}

/// The newest `date` among a collection's items (undefined if it's empty).
pub fn newest_item_date(items: &Value) -> Value {
    let newest = items.as_array().unwrap_or(&[]).iter().filter_map(|item| item.get("date").to_date()).max();
    newest.map(Value::Date).unwrap_or(Value::Undefined)
}

/// `2026-03-14T00:00:00Z`
pub fn date_to_rfc3339(date: &Value) -> Result<String> {
    let d = date.to_date().ok_or_else(|| anyhow!("dateToRfc3339: not a date: {:?}", date))?;
    Ok(d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

/// `Sat, 14 Mar 2026 00:00:00 +0000`
pub fn date_to_rfc822(date: &Value) -> Result<String> {
    let d = date.to_date().ok_or_else(|| anyhow!("dateToRfc822: not a date: {:?}", date))?;
    Ok(d.format("%a, %d %b %Y %H:%M:%S +0000").to_string())
}

/// Resolve `url` against `base`, like `new URL(url, base).toString()`.
pub fn absolute_url(url: &str, base: &str) -> String {
    // The same WHATWG URL rules as `new URL(url, base).toString()`, which is
    // what @11ty/eleventy-plugin-rss uses: "https://example.com" becomes
    // "https://example.com/", and "#top" resolves against the page. Like the
    // plugin, a URL that can't be resolved is returned unchanged.
    match url::Url::parse(base).and_then(|b| b.join(url)) {
        Ok(u) => u.to_string(),
        Err(_) => url.to_string(),
    }
}

/// Rewrite `href`, `src`, `poster` and `srcset` attributes to absolute URLs.
pub fn html_to_absolute_urls(html: &str, base: &str) -> Result<String> {
    let fix = |attr: &'static str| {
        element!(format!("[{}]", attr), move |el| {
            if let Some(v) = el.get_attribute(attr) {
                let new = if attr == "srcset" {
                    v.split(',')
                        .map(|candidate| {
                            let candidate = candidate.trim();
                            match candidate.split_once(' ') {
                                Some((u, descriptor)) => format!("{} {}", absolute_url(u, base), descriptor),
                                None => absolute_url(candidate, base),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                } else {
                    absolute_url(&v, base)
                };
                el.set_attribute(attr, &new)?;
            }
            Ok(())
        })
    };
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![fix("href"), fix("src"), fix("poster"), fix("srcset")],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|e| anyhow!("htmlToAbsoluteUrls: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected values are what Node's `new URL(url, base).toString()` returns
    /// (the url, unchanged, when it throws).
    #[test]
    fn resolves_urls_like_node() {
        assert_eq!(absolute_url("/a/", "https://x.com"), "https://x.com/a/");
        assert_eq!(absolute_url("img.png", "https://x.com/post/"), "https://x.com/post/img.png");
        assert_eq!(absolute_url("../b", "https://x.com/a/c/"), "https://x.com/a/b");
        assert_eq!(absolute_url("https://y.com/z", "https://x.com"), "https://y.com/z");
        assert_eq!(absolute_url("https://getmetermaid.com", "https://reverentgeek.com/p/"), "https://getmetermaid.com/");
        assert_eq!(absolute_url("#gear-list", "https://reverentgeek.com/my-video-streaming-setup/"), "https://reverentgeek.com/my-video-streaming-setup/#gear-list");
        assert_eq!(absolute_url("?q=1", "https://x.com/a/b"), "https://x.com/a/b?q=1");
        assert_eq!(absolute_url("//cdn.x.com/a.js", "https://x.com/"), "https://cdn.x.com/a.js");
        assert_eq!(absolute_url("mailto:a@b.com", "https://x.com/"), "mailto:a@b.com");
        assert_eq!(absolute_url("HTTPS://Example.COM/A%20B", "https://x.com/"), "https://example.com/A%20B");
        assert_eq!(absolute_url("a b.png", "https://x.com/p/"), "https://x.com/p/a%20b.png");
        assert_eq!(absolute_url("", "https://x.com/p/"), "https://x.com/p/");
        assert_eq!(absolute_url("https://x.com:443/a", "https://x.com/"), "https://x.com/a");
        assert_eq!(absolute_url("data:image/png;base64,AAA", "https://x.com/"), "data:image/png;base64,AAA");
        assert_eq!(absolute_url("./", "https://x.com/a/b/"), "https://x.com/a/b/");
        assert_eq!(absolute_url("https://bad host/", "https://x.com/"), "https://bad host/");
    }

    #[test]
    fn rewrites_html() {
        let html = r#"<p><a href="/a/">a</a><img src="/i.png" srcset="/i-1.png 1x, /i-2.png 2x"></p>"#;
        let out = html_to_absolute_urls(html, "https://x.com/post/").unwrap();
        assert!(out.contains(r#"href="https://x.com/a/""#));
        assert!(out.contains(r#"srcset="https://x.com/i-1.png 1x, https://x.com/i-2.png 2x""#));
    }
}
