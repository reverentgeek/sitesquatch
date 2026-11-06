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
        cfg.add_filter("getNewestCollectionItemDate", |args| {
            let newest = args.arg(0).as_array().unwrap_or(&[]).iter().filter_map(|item| item.get("date").to_date()).max();
            Ok(newest.map(Value::Date).unwrap_or(Value::Undefined))
        });
        cfg.add_filter("dateToRfc3339", |args| {
            let d = args.arg(0).to_date().ok_or_else(|| anyhow!("dateToRfc3339: not a date: {:?}", args.arg(0)))?;
            Ok(Value::from(d.format("%Y-%m-%dT%H:%M:%SZ").to_string()))
        });
        cfg.add_filter("dateToRfc822", |args| {
            let d = args.arg(0).to_date().ok_or_else(|| anyhow!("dateToRfc822: not a date: {:?}", args.arg(0)))?;
            Ok(Value::from(d.format("%a, %d %b %Y %H:%M:%S +0000").to_string()))
        });
        cfg.add_filter("absoluteUrl", |args| Ok(Value::from(absolute_url(&args.arg_string(0), &args.arg_string(1)))));
        cfg.add_filter("htmlToAbsoluteUrls", |args| Ok(Value::from(html_to_absolute_urls(&args.arg_string(0), &args.arg_string(1))?)));
        // Eleventy's built-in `url` filter (no path prefix support yet).
        cfg.add_filter("url", |args| Ok(args.arg(0)));
    }
}

/// Resolve `url` against `base`, like `new URL(url, base).toString()` for
/// http(s) URLs.
pub fn absolute_url(url: &str, base: &str) -> String {
    if url.contains("://") || url.starts_with("mailto:") || url.starts_with("data:") || url.starts_with('#') {
        return url.to_string();
    }
    let (scheme, rest) = base.split_once("://").unwrap_or(("https", base));
    if let Some(proto_relative) = url.strip_prefix("//") {
        return format!("{}://{}", scheme, proto_relative);
    }
    let (host, base_path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    if url.starts_with('/') {
        return format!("{}://{}{}", scheme, host, url);
    }
    let dir = &base_path[..base_path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let mut segments: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in url.split('/') {
        match seg {
            "." => {}
            ".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }
    format!("{}://{}/{}", scheme, host, segments.join("/"))
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

    #[test]
    fn resolves_urls() {
        assert_eq!(absolute_url("/a/", "https://x.com"), "https://x.com/a/");
        assert_eq!(absolute_url("img.png", "https://x.com/post/"), "https://x.com/post/img.png");
        assert_eq!(absolute_url("../b", "https://x.com/a/c/"), "https://x.com/a/b");
        assert_eq!(absolute_url("https://y.com/z", "https://x.com"), "https://y.com/z");
    }

    #[test]
    fn rewrites_html() {
        let html = r#"<p><a href="/a/">a</a><img src="/i.png" srcset="/i-1.png 1x, /i-2.png 2x"></p>"#;
        let out = html_to_absolute_urls(html, "https://x.com/post/").unwrap();
        assert!(out.contains(r#"href="https://x.com/a/""#));
        assert!(out.contains(r#"srcset="https://x.com/i-1.png 1x, https://x.com/i-2.png 2x""#));
    }
}
