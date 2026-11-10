//! `base`: a site served below the root of its domain, like a GitHub Pages
//! project site at `https://user.github.io/repo/`.
//!
//! Templates keep writing URLs from the site's own root (`/about/`,
//! `/assets/site.css`), and `page.url` stays `/about/`. With `base: "/repo/"`,
//! the last step of writing an HTML page puts `/repo` in front of every such
//! URL in its attributes (and in `url()` in its styles). The output folder
//! doesn't change: it's what the host serves at `/repo/`.
//!
//! URLs outside HTML attributes (in an inline script, a JSON file, a feed)
//! aren't touched; templates use the `withBase()` filter or `ssqch.base` there.

use std::sync::LazyLock;

use anyhow::{anyhow, bail, Result};
use lol_html::{element, rewrite_str, text, RewriteStrSettings};
use regex::Regex;

/// A `base` setting as the build keeps it: empty for none, or `/repo`
/// (starting with `/`, with no `/` at the end).
pub fn normalize(base: &str) -> Result<String> {
    let trimmed = base.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return Ok(String::new());
    }
    if !trimmed.starts_with('/') || trimmed.starts_with("//") {
        bail!("base must be a URL path starting with /, like \"/docs/\" (got {:?}); the domain isn't part of it", base);
    }
    if trimmed.contains(['?', '#', '\\']) || trimmed.contains(char::is_whitespace) || trimmed.split('/').any(|p| p == ".." || p == ".") || trimmed.contains("//") {
        bail!("base must be a plain URL path, like \"/docs/\" (got {:?})", base);
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

/// Whether `url` is from the site's root: `/about/`, but not `//cdn.example.com/x`.
fn from_root(url: &str) -> bool {
    url.starts_with('/') && !url.starts_with("//")
}

/// `url` with `base` in front, if it's from the site's root. Anything else
/// (relative, `#top`, `https:`) is returned as it is.
pub fn with_base(base: &str, url: &str) -> String {
    if base.is_empty() || !from_root(url) {
        return url.to_string();
    }
    format!("{}{}", base, url)
}

/// Attributes that hold one URL.
const URL_ATTRIBUTES: [&str; 9] = ["href", "src", "action", "poster", "data", "formaction", "cite", "xlink:href", "manifest"];
/// Attributes that hold a list of `url descriptor` candidates.
const SRCSET_ATTRIBUTES: [&str; 2] = ["srcset", "imagesrcset"];

// The quote can be written as an entity, as it is inside a `style` attribute
// that a serializer or a minifier wrote: `url(&quot;/hero.jpg&quot;)`.
static CSS_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"url\(\s*(["']|&quot;|&#34;|&#39;|&apos;)?/((?:[^/)"'&]|&amp;)(?:[^)"'&]|&amp;)*)?(["')]|&quot;|&#34;|&#39;|&apos;)"#).unwrap());
static REFRESH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)^(\s*[\d.]+\s*[;,]\s*url\s*=\s*["']?)(/.*)$"#).unwrap());

/// A `srcset` with `base` in front of each candidate's URL that's from the
/// site's root. Read as browsers read it: a URL runs to the next whitespace
/// (so the commas in a `data:` URI are part of it), then its descriptors run
/// to the next comma.
fn srcset_with_base(base: &str, srcset: &str) -> String {
    let bytes = srcset.as_bytes();
    let mut out = String::with_capacity(srcset.len() + base.len() * 4);
    let mut i = 0;
    while i < bytes.len() {
        let start = i;
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b',') {
            i += 1;
        }
        out.push_str(&srcset[start..i]);
        let start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let url = &srcset[start..i];
        if from_root(url) {
            out.push_str(base);
        }
        out.push_str(url);
        // A URL that ends in a comma ends its candidate; otherwise its descriptors follow.
        if !url.ends_with(',') {
            let start = i;
            while i < bytes.len() && bytes[i] != b',' {
                i += 1;
            }
            out.push_str(&srcset[start..i]);
        }
    }
    out
}

/// `css` with `base` in front of every `url()` from the site's root.
pub fn css_with_base(base: &str, css: &str) -> String {
    if base.is_empty() {
        return css.to_string();
    }
    CSS_URL.replace_all(css, |c: &regex::Captures| format!("url({}{}/{}{}", c.get(1).map_or("", |m| m.as_str()), base, c.get(2).map_or("", |m| m.as_str()), &c[3])).into_owned()
}

/// Put `base` in front of every URL from the site's root in `html`: the
/// attributes that hold URLs, `srcset` lists, a meta refresh, and `url()` in
/// `style` attributes and `<style>` elements.
pub fn rewrite_html(html: &str, base: &str) -> Result<String> {
    if base.is_empty() {
        return Ok(html.to_string());
    }
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!("*", |el| {
                    for attr in URL_ATTRIBUTES {
                        if let Some(v) = el.get_attribute(attr) {
                            if from_root(v.trim_start()) {
                                el.set_attribute(attr, &format!("{}{}", base, v.trim_start()))?;
                            }
                        }
                    }
                    for attr in SRCSET_ATTRIBUTES {
                        if let Some(v) = el.get_attribute(attr) {
                            let new = srcset_with_base(base, &v);
                            if new != v {
                                el.set_attribute(attr, &new)?;
                            }
                        }
                    }
                    if let Some(v) = el.get_attribute("style") {
                        if v.contains("url(") {
                            el.set_attribute("style", &css_with_base(base, &v))?;
                        }
                    }
                    if el.tag_name() == "meta" && el.get_attribute("http-equiv").is_some_and(|h| h.eq_ignore_ascii_case("refresh")) {
                        if let Some(v) = el.get_attribute("content") {
                            if let Some(c) = REFRESH.captures(&v).filter(|c| from_root(&c[2])) {
                                el.set_attribute("content", &format!("{}{}{}", &c[1], base, &c[2]))?;
                            }
                        }
                    }
                    Ok(())
                }),
                text!("style", |chunk| {
                    let css = chunk.as_str();
                    if css.contains("url(") {
                        let new = css_with_base(base, css);
                        chunk.replace(&new, lol_html::html_content::ContentType::Html);
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|e| anyhow!("adding the base path: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_the_setting() {
        for (given, kept) in [("", ""), ("/", ""), ("/docs", "/docs"), ("/docs/", "/docs"), (" /a/b/ ", "/a/b")] {
            assert_eq!(normalize(given).unwrap(), kept, "{:?}", given);
        }
        for bad in ["docs", "https://example.com/docs/", "//docs", "/a//b", "/a/../b", "/a b", "/a?b", "/a#b"] {
            assert!(normalize(bad).is_err(), "{:?}", bad);
        }
    }

    #[test]
    fn prefixes_urls_from_the_root_only() {
        assert_eq!(with_base("/repo", "/about/"), "/repo/about/");
        assert_eq!(with_base("/repo", "/"), "/repo/");
        for other in ["about/", "../x", "#top", "https://example.com/", "//cdn.example.com/x.js", "mailto:a@b.c", ""] {
            assert_eq!(with_base("/repo", other), other);
        }
        assert_eq!(with_base("", "/about/"), "/about/");
    }

    #[test]
    fn rewrites_attributes_srcsets_styles_and_refreshes() {
        let html = concat!(
            r#"<link rel="stylesheet" href="/site.css"><meta http-equiv="refresh" content="0; url=/new/">"#,
            r#"<style>body { background: url(/bg.png) } .a { background: url("/a.png") } .b { background: url(b.png) } .c { background: url(//cdn.x/c.png) }</style>"#,
            r##"<a href="/about/#team">a</a><a href="#top">t</a><a href="next/">n</a><a href="https://example.com/">e</a><a href="//example.com/">p</a>"##,
            r#"<img src="/i.png" srcset="/i-300.webp 300w, /i-600.webp 600w, rel.webp 900w"><video poster="/p.jpg"></video>"#,
            r#"<form action="/search/"><button formaction="/go/"></button></form><svg><use href="/sprite.svg#x"/><use xlink:href="/old.svg#y"/></svg>"#,
            r#"<div style="background-image: url('/hero.jpg')"></div><script>const u = "/api/";</script>"#,
        );
        let out = rewrite_html(html, "/repo").unwrap();
        for expected in [
            r#"href="/repo/site.css""#,
            r#"content="0; url=/repo/new/""#,
            "url(/repo/bg.png)",
            r#"url("/repo/a.png")"#,
            "url(b.png)",
            "url(//cdn.x/c.png)",
            r##"href="/repo/about/#team""##,
            r##"href="#top""##,
            r#"href="next/""#,
            r#"href="https://example.com/""#,
            r#"href="//example.com/""#,
            r#"src="/repo/i.png""#,
            r#"srcset="/repo/i-300.webp 300w, /repo/i-600.webp 600w, rel.webp 900w""#,
            r#"poster="/repo/p.jpg""#,
            r#"action="/repo/search/""#,
            r#"formaction="/repo/go/""#,
            r##"href="/repo/sprite.svg#x""##,
            r##"xlink:href="/repo/old.svg#y""##,
            "url('/repo/hero.jpg')",
            r#"const u = "/api/";"#,
        ] {
            assert!(out.contains(expected), "missing {}\nin {}", expected, out);
        }
        assert_eq!(rewrite_html(html, "").unwrap(), html);
    }

    #[test]
    fn srcsets_and_styles_with_awkward_urls() {
        // The commas in a data: URI aren't between candidates (JPEG base64 starts with `/9j/`).
        assert_eq!(
            srcset_with_base("/repo", "data:image/jpeg;base64,/9j/4AAQ 1x, /real.jpg 2x,/tight.jpg 3x,\n  /last.jpg"),
            "data:image/jpeg;base64,/9j/4AAQ 1x, /repo/real.jpg 2x,/repo/tight.jpg 3x,\n  /repo/last.jpg"
        );
        assert_eq!(srcset_with_base("/repo", "/a.png, /b.png 2x"), "/repo/a.png, /repo/b.png 2x");
        assert_eq!(srcset_with_base("/repo", ""), "");
        // Quotes written as entities, and `&amp;` in a URL.
        let html = r#"<div style="background:url(&quot;/hero.jpg&quot;)"></div><p style="background:url(&#39;/a.png?x=1&amp;y=2&#39;), url(//cdn.x/b.png)"></p>"#;
        let out = rewrite_html(html, "/repo").unwrap();
        assert!(out.contains("url(&quot;/repo/hero.jpg&quot;)") && out.contains("url(&#39;/repo/a.png?x=1&amp;y=2&#39;)") && out.contains("url(//cdn.x/b.png)"), "{}", out);
    }
}
