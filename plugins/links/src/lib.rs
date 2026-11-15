//! A link checker for SiteSquatch.
//!
//! After a build, every internal link in the HTML it wrote has to point at
//! something in the output folder, and a `#fragment` has to match an `id` (or
//! `<a name>`) on the page it points to. Checked: `href` on `a`, `link` and
//! `area`; `src` on `img`, `script`, `iframe`, `source`, `video`, `audio`,
//! `track` and `embed`; and each URL in `srcset`.
//!
//! Pages also link with URLs outside those attributes, so these are checked
//! too, when they're on the site (from its root, or absolute on its address):
//! `<meta>` values that are URLs (`og:image`, `twitter:image`, `og:url`),
//! strings in `application/ld+json` blocks, `imagesrcset` on a preload
//! `<link>`, and in `.xml` output (feeds, the sitemap), URLs in attributes and
//! elements, including the escaped HTML of a feed entry's content.
//!
//! External links (anything with a scheme, like `https:` or `mailto:`, or
//! starting with `//`) aren't checked, unless they're on the site's own
//! address: the `url` option, or the one `sitemap.xml` uses. Neither are
//! paths a Netlify `_redirects` file in the output covers, or paths under an
//! `ignore` prefix.
//!
//! A path matches a file (`/feed.xml`), `name.html` (`/about` for
//! `/about.html`) or `index.html` in a folder (`/about/`, or `/about`, which
//! hosts redirect to `/about/`).
//!
//! Broken links fail production builds; in `ssqch serve` and development
//! builds they're printed as warnings.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, bail, Context, Result};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use rayon::prelude::*;
use sitesquatch::diagnostics::{self, Diagnostic, Diagnostics, Severity};
use sitesquatch::{suggest, BuildContext, BuildReport, Config, Environment, Plugin};

#[derive(Clone, Debug, Default)]
pub struct LinksOptions {
    /// Check `#fragments` against the target page's ids (default true).
    pub anchors: Option<bool>,
    /// URL path prefixes not to check, like `/downloads/`.
    pub ignore: Vec<String>,
    /// Fail the build on a broken link. `None` means production builds only
    /// (not `ssqch serve`); otherwise broken links are warnings.
    pub fail: Option<bool>,
    /// The site's address (`https://example.com`), so absolute links to it
    /// are checked like links from its root. `None`: the address the
    /// output's `sitemap.xml` uses, if there is one.
    pub url: Option<String>,
}

#[derive(Default)]
pub struct LinksPlugin {
    options: LinksOptions,
    /// (links checked, broken) from the last build, for the summary.
    counts: Arc<Mutex<Option<(usize, usize)>>>,
}

impl LinksPlugin {
    pub fn new(options: LinksOptions) -> Result<Self> {
        if let Some(bad) = options.ignore.iter().find(|p| !p.starts_with('/')) {
            bail!("ignore: \"{}\" must be a URL path starting with / (like \"/downloads/\")", bad);
        }
        if let Some(url) = &options.url {
            if origin_of(url).is_none() {
                bail!("url: \"{}\" must be the site's address, like \"https://example.com\"", url);
            }
        }
        Ok(LinksPlugin { options, counts: Default::default() })
    }
}

impl Plugin for LinksPlugin {
    fn name(&self) -> &str {
        "links"
    }

    fn register(&self, cfg: &mut Config) {
        let options = self.options.clone();
        let counts = self.counts.clone();
        let quiet = cfg.quiet;
        let verbose = cfg.verbose;
        cfg.on_after_build(move |ctx, report| {
            let result = check(ctx, report, &options)?;
            *counts.lock().unwrap() = Some((result.checked, result.broken.len()));
            if result.broken.is_empty() {
                return Ok(());
            }
            let fail = options.fail.unwrap_or(ctx.env == Environment::Production && !ctx.serving);
            let message = describe(&result.broken, if verbose { usize::MAX } else { 20 });
            // One for each link, for `ssqch build --format json`.
            let each = |severity: Severity| -> Vec<Diagnostic> {
                result.broken.iter().map(|b| Diagnostic { severity, ..Diagnostic::error("links", format!("{} -> {} ({})", b.page, b.link, b.reason)).url(b.page.as_str()) }).collect()
            };
            if fail {
                return Err(Diagnostics { message, items: each(Severity::Error) }.into());
            }
            if diagnostics::capturing() {
                each(Severity::Warning).into_iter().for_each(diagnostics::warn);
            } else if !quiet {
                diagnostics::warn(Diagnostic::warning("links", message));
            }
            Ok(())
        });
        let counts = self.counts.clone();
        cfg.add_summary("Links", move |_| {
            let (checked, broken) = (*counts.lock().unwrap())?;
            Some(format!("{} checked, {} broken", sitesquatch::report::count(checked), sitesquatch::report::count(broken)))
        });
    }
}

/// A link that doesn't resolve: the page it's on, the link as written, why.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Broken {
    pub page: String,
    pub link: String,
    pub reason: String,
}

pub struct CheckResult {
    pub checked: usize,
    pub broken: Vec<Broken>,
}

/// The broken links, the first `shown` of them listed (all of them with `--verbose`).
fn describe(broken: &[Broken], shown: usize) -> String {
    let mut out = format!("{} on {} broken link{}:", sitesquatch::voice::TRAIL_GOES_COLD, broken.len(), if broken.len() == 1 { "" } else { "s" });
    for b in broken.iter().take(shown) {
        out.push_str(&format!("\n  {} -> {} ({})", b.page, b.link, b.reason));
    }
    if broken.len() > shown {
        out.push_str(&format!("\n  ... and {} more (--verbose lists them all)", broken.len() - shown));
    }
    out
}

/// What one page contains: the ids it defines and the links it makes.
#[derive(Default)]
struct PageScan {
    ids: HashSet<String>,
    links: Vec<String>,
    /// URLs that are only checked when they're on the site (from its root,
    /// or absolute on its address): `<meta>` values, JSON-LD strings, and
    /// everything in XML, where a relative URL's base isn't the file's own.
    site_links: Vec<String>,
    /// JSON-LD strings: their `#fragment` names a thing, not an id on a page.
    site_paths: Vec<String>,
}

/// `<meta>` names and properties whose `content` is a URL.
fn meta_is_url(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(name.as_str(), "og:url" | "twitter:url" | "msapplication-tileimage" | "thumbnail")
        || ["og:image", "og:video", "og:audio", "twitter:image", "twitter:player"].iter().any(|p| name == *p || name.strip_prefix(p).is_some_and(|rest| matches!(rest, ":url" | ":secure_url" | ":src")))
}

/// Every string in a JSON value that could be a URL on this site.
fn json_urls(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) if !s.is_empty() && !s.contains(char::is_whitespace) && (s.starts_with('/') || s.starts_with("http://") || s.starts_with("https://")) => out.push(s.clone()),
        serde_json::Value::Array(items) => items.iter().for_each(|v| json_urls(v, out)),
        serde_json::Value::Object(map) => map.values().for_each(|v| json_urls(v, out)),
        _ => {}
    }
}

/// The URLs in an XML file (a feed, a sitemap): attribute values (`href`,
/// `src`, `srcset`...) and elements that hold only a URL (`<loc>`,
/// `<link>`, `<id>`), including those in escaped HTML (a feed entry's
/// content), which is unescaped first.
fn scan_xml(xml: &str) -> Vec<String> {
    use std::sync::OnceLock;
    static ATTR: OnceLock<regex::Regex> = OnceLock::new();
    static SRCSET: OnceLock<regex::Regex> = OnceLock::new();
    static TEXT: OnceLock<regex::Regex> = OnceLock::new();
    let attr = ATTR.get_or_init(|| regex::Regex::new(r#"(?i)[\s<](?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
    let srcset = SRCSET.get_or_init(|| regex::Regex::new(r#"(?i)[\s<](?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
    let text = TEXT.get_or_init(|| regex::Regex::new(r#">\s*((?:https?://|/)[^<>\s]*)\s*<"#).unwrap());
    let unescaped = unescape_xml(xml);
    let mut out = Vec::new();
    for c in attr.captures_iter(&unescaped) {
        out.push(unescape_xml(c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or("")));
    }
    for c in srcset.captures_iter(&unescaped) {
        for candidate in c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or("").split(',') {
            if let Some(url) = candidate.split_whitespace().next() {
                out.push(unescape_xml(url));
            }
        }
    }
    for c in text.captures_iter(&unescaped) {
        out.push(unescape_xml(&c[1]));
    }
    out
}

/// XML's five entities and numeric references, and CDATA markers (whose
/// contents are already plain).
fn unescape_xml(s: &str) -> String {
    if !s.contains('&') && !s.contains("<![CDATA[") {
        return s.to_string();
    }
    let s = s.replace("<![CDATA[", "").replace("]]>", "");
    let mut out = String::with_capacity(s.len());
    let mut rest = s.as_str();
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let end = after.find(';').filter(|&e| e <= 8);
        let decoded = end.and_then(|e| match &after[..e] {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "amp" => Some('&'),
            n if n.starts_with("#x") || n.starts_with("#X") => u32::from_str_radix(&n[2..], 16).ok().and_then(char::from_u32),
            n if n.starts_with('#') => n[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        });
        match (decoded, end) {
            (Some(c), Some(e)) => {
                out.push(c);
                rest = &after[e + 1..];
            }
            _ => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn scan(html: &str) -> Result<PageScan> {
    let found = Mutex::new(PageScan::default());
    let json_ld = Mutex::new(String::new());
    let link = |el: &mut lol_html::html_content::Element, attr: &str| {
        if let Some(v) = el.get_attribute(attr) {
            found.lock().unwrap().links.push(v);
        }
    };
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!("[id]", |el| {
                    if let Some(id) = el.get_attribute("id") {
                        found.lock().unwrap().ids.insert(id);
                    }
                    Ok(())
                }),
                element!("a[name]", |el| {
                    if let Some(name) = el.get_attribute("name") {
                        found.lock().unwrap().ids.insert(name);
                    }
                    Ok(())
                }),
                element!("a[href], area[href]", |el| {
                    link(el, "href");
                    Ok(())
                }),
                element!("link[href]", |el| {
                    // Hints to other origins, not resources on this site.
                    let rel = el.get_attribute("rel").unwrap_or_default().to_ascii_lowercase();
                    if !rel.split_whitespace().any(|r| r == "preconnect" || r == "dns-prefetch") {
                        link(el, "href");
                    }
                    Ok(())
                }),
                element!("link[imagesrcset]", |el| {
                    if let Some(srcset) = el.get_attribute("imagesrcset") {
                        let mut f = found.lock().unwrap();
                        for candidate in srcset.split(',') {
                            if let Some(url) = candidate.split_whitespace().next() {
                                f.links.push(url.to_string());
                            }
                        }
                    }
                    Ok(())
                }),
                element!("meta[content]", |el| {
                    let name = el.get_attribute("property").or_else(|| el.get_attribute("name")).or_else(|| el.get_attribute("itemprop")).unwrap_or_default();
                    if meta_is_url(&name) {
                        if let Some(v) = el.get_attribute("content") {
                            found.lock().unwrap().site_links.push(v);
                        }
                    }
                    Ok(())
                }),
                lol_html::text!("script[type='application/ld+json']", |t| {
                    let mut text = json_ld.lock().unwrap();
                    text.push_str(t.as_str());
                    if t.last_in_text_node() {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                            let mut urls = Vec::new();
                            json_urls(&value, &mut urls);
                            found.lock().unwrap().site_paths.extend(urls);
                        }
                        text.clear();
                    }
                    Ok(())
                }),
                element!("img[src], script[src], iframe[src], source[src], video[src], audio[src], track[src], embed[src]", |el| {
                    link(el, "src");
                    Ok(())
                }),
                element!("img[srcset], source[srcset]", |el| {
                    if let Some(srcset) = el.get_attribute("srcset") {
                        let mut f = found.lock().unwrap();
                        for candidate in srcset.split(',') {
                            if let Some(url) = candidate.split_whitespace().next() {
                                f.links.push(url.to_string());
                            }
                        }
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|e| anyhow!("{}", e))?;
    Ok(found.into_inner().unwrap())
}

/// Check every HTML page the build wrote.
pub fn check(ctx: &BuildContext, report: &BuildReport, options: &LinksOptions) -> Result<CheckResult> {
    let pages: Vec<&PathBuf> = report.written.iter().filter(|p| p.extension().is_some_and(|e| e == "html" || e == "xml")).collect();
    let scans: Vec<(PathBuf, PageScan)> = pages
        .par_iter()
        .map(|path| {
            let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
            let page = if path.extension().is_some_and(|e| e == "xml") {
                PageScan { site_links: scan_xml(&text), ..PageScan::default() }
            } else {
                scan(&text).with_context(|| format!("scanning {}", path.display()))?
            };
            Ok(((*path).clone(), page))
        })
        .collect::<Result<_>>()?;
    // The site's address, so absolute links to it are checked.
    let origin = options.url.as_deref().and_then(origin_of).or_else(|| sitemap_origin(&ctx.output_dir));
    let ids: HashMap<&Path, &HashSet<String>> = scans.iter().map(|(p, s)| (p.as_path(), &s.ids)).collect();
    let redirects = redirect_sources(&ctx.output_dir);
    let anchors = options.anchors.unwrap_or(true);

    let mut checked = 0;
    let mut broken = BTreeSet::new();
    // Most links on a site point at the same few pages (every sidebar lists
    // them), so each target is looked up on disk once.
    let mut found: HashMap<String, Option<PathBuf>> = HashMap::new();
    // "Did you mean": the page whose URL is nearly a missing one, looked for once.
    let urls: Vec<String> = scans.iter().map(|(path, _)| url_of(&ctx.output_dir, path)).collect();
    let mut meant: HashMap<String, String> = HashMap::new();
    let did_you_mean = |found: Option<&str>, mark: &str| found.map(|name| format!("; did you mean {}{}?", mark, name)).unwrap_or_default();
    for (path, page) in &scans {
        let page_url = url_of(&ctx.output_dir, path);
        // Links in attributes as written; the others only when they're on the
        // site; JSON-LD's without their #fragment.
        let all = page.links.iter().map(|l| (l, true, false)).chain(page.site_links.iter().map(|l| (l, false, false))).chain(page.site_paths.iter().map(|l| (l, false, true)));
        for (written, relative_ok, ignore_fragment) in all {
            let on_site = origin.as_deref().and_then(|o| strip_origin(written, o));
            let link = match on_site {
                Some(path) => path,
                None if relative_ok => written.as_str(),
                None if written.trim().starts_with('/') && !written.trim().starts_with("//") => written.as_str(),
                None => continue,
            };
            checked += 1;
            // With a `base`, the HTML has it in front of every URL from the
            // site's root. Other paths on the domain aren't this site's.
            let link = match in_site(link, &ctx.base) {
                Some(l) => l,
                None => continue,
            };
            // Reported as the template has it: from the root without the base, or the whole address.
            let shown = if on_site.is_some() { written.trim() } else { link };
            let Some((target_path, fragment)) = resolve(&page_url, link) else { continue };
            let fragment = fragment.filter(|_| !ignore_fragment);
            if target_path.is_empty() && fragment.is_none() {
                continue;
            }
            let reason = if target_path.is_empty() {
                // `#top`: this page.
                match fragment {
                    Some(f) if anchors && !page.ids.contains(&f) => Some(format!("no id \"{}\" on this page{}", f, did_you_mean(suggest::closest(&f, page.ids.iter().map(String::as_str)), "#"))),
                    _ => None,
                }
            } else if options.ignore.iter().any(|p| target_path.starts_with(p.as_str())) || redirected(&redirects, &target_path) {
                None
            } else {
                if !found.contains_key(&target_path) {
                    found.insert(target_path.clone(), find(&ctx.output_dir, &target_path));
                }
                match &found[&target_path] {
                    None => {
                        // A site with hundreds of dead links has a bigger problem than typos.
                        if !meant.contains_key(&target_path) && meant.len() < 500 {
                            meant.insert(target_path.clone(), did_you_mean(suggest::closest_path(&target_path, urls.iter().map(String::as_str)), ""));
                        }
                        Some(format!("not found{}", meant.get(&target_path).map(String::as_str).unwrap_or("")))
                    }
                    Some(file) => match (fragment, ids.get(file.as_path())) {
                        (Some(f), Some(target_ids)) if anchors && !target_ids.contains(&f) => Some(format!("no id \"{}\" on that page{}", f, did_you_mean(suggest::closest(&f, target_ids.iter().map(String::as_str)), "#"))),
                        _ => None,
                    },
                }
            };
            if let Some(reason) = reason {
                broken.insert(Broken { page: page_url.clone(), link: shown.to_string(), reason });
            }
        }
    }
    Ok(CheckResult { checked, broken: broken.into_iter().collect() })
}

/// `https://example.com` from a site's address (`https://example.com/blog/`):
/// the scheme and host, lowercase. `None` when it isn't an http(s) address.
fn origin_of(url: &str) -> Option<String> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let host = rest.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    (!host.is_empty()).then(|| format!("{}://{}", scheme, host))
}

/// The address the output's `sitemap.xml` uses, from its first `<loc>`.
fn sitemap_origin(output: &Path) -> Option<String> {
    let xml = std::fs::read_to_string(output.join("sitemap.xml")).ok()?;
    let start = xml.find("<loc>")? + 5;
    let end = start + xml[start..].find("</loc>")?;
    origin_of(&unescape_xml(xml[start..end].trim()))
}

/// The path of an absolute URL on the site's address (`https://example.com/about/`
/// is `/about/`), whether it's `http` or `https`. `None` for other URLs.
fn strip_origin<'a>(link: &'a str, origin: &str) -> Option<&'a str> {
    let link = link.trim();
    let host = origin.split_once("://")?.1;
    let rest = ["https://", "http://"].iter().find_map(|s| link.get(..s.len()).filter(|p| p.eq_ignore_ascii_case(s)).map(|_| &link[s.len()..]))?;
    let after = rest.get(..host.len()).filter(|h| h.eq_ignore_ascii_case(host)).map(|_| &rest[host.len()..])?;
    match after {
        "" => Some("/"),
        a if a.starts_with('/') => Some(a),
        a if a.starts_with(['?', '#']) => Some(a),
        _ => None,
    }
}

/// `link` without the site's `base`, or `None` for a path on the same domain
/// that's outside it (`/other-project/` when the base is `/repo`).
fn in_site<'a>(link: &'a str, base: &str) -> Option<&'a str> {
    let trimmed = link.trim();
    if base.is_empty() || !trimmed.starts_with('/') || trimmed.starts_with("//") {
        return Some(link);
    }
    match trimmed.strip_prefix(base) {
        Some("") => Some("/"),
        Some(rest) if rest.starts_with(['/', '#', '?']) => Some(rest),
        _ => None,
    }
}

/// `dist/about/index.html` -> `/about/`, `dist/feed.xml` -> `/feed.xml`.
fn url_of(output: &Path, file: &Path) -> String {
    let rel = file.strip_prefix(output).unwrap_or(file).to_string_lossy().replace('\\', "/");
    let url = format!("/{}", rel);
    match url.strip_suffix("index.html") {
        Some(dir) => dir.to_string(),
        None => url,
    }
}

/// The URL path and fragment `link` points to, from a page at `page_url`.
/// `None` for links that aren't checked (external, or nothing to check).
/// An empty path means the page itself (`#top`).
fn resolve(page_url: &str, link: &str) -> Option<(String, Option<String>)> {
    let link = link.trim();
    if link.is_empty() || link.starts_with("//") || has_scheme(link) {
        return None;
    }
    let (rest, fragment) = match link.split_once('#') {
        Some((r, f)) => (r, Some(percent_decode(f)).filter(|f| !f.is_empty())),
        None => (link, None),
    };
    let path = rest.split('?').next().unwrap_or("");
    if path.is_empty() {
        return fragment.map(|f| (String::new(), Some(f)));
    }
    let joined = if path.starts_with('/') {
        path.to_string()
    } else {
        let base = &page_url[..page_url.rfind('/').map(|i| i + 1).unwrap_or(0)];
        format!("{}{}", base, path)
    };
    Some((normalize(&percent_decode(&joined)), fragment))
}

/// `mailto:`, `https:`, `data:`... A scheme comes before any `/`, `?` or `#`.
fn has_scheme(link: &str) -> bool {
    match link.find(':') {
        Some(i) => {
            let scheme = &link[..i];
            !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        }
        None => false,
    }
}

/// Resolve `.` and `..` segments, keeping a trailing slash.
fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    let mut out = format!("/{}", parts.join("/"));
    if path.ends_with('/') && out != "/" {
        out.push('/');
    }
    out
}

/// The output file a URL path serves, if any.
fn find(output: &Path, url_path: &str) -> Option<PathBuf> {
    let rel = url_path.trim_start_matches('/');
    let base = output.join(rel);
    if url_path.ends_with('/') {
        let index = base.join("index.html");
        return index.is_file().then_some(index);
    }
    if base.is_file() {
        return Some(base);
    }
    let html = output.join(format!("{}.html", rel));
    if html.is_file() {
        return Some(html);
    }
    let index = base.join("index.html");
    index.is_file().then_some(index)
}

/// The source paths of a Netlify `_redirects` file in the output: exact paths,
/// and prefixes for ones ending in `*`.
fn redirect_sources(output: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(output.join("_redirects")) else { return Vec::new() };
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_whitespace().next())
        .filter(|from| from.starts_with('/'))
        .map(String::from)
        .collect()
}

fn redirected(sources: &[String], path: &str) -> bool {
    sources.iter().any(|from| match from.strip_suffix('*') {
        Some(prefix) => path.starts_with(prefix),
        None => from == path || from.trim_end_matches('/') == path.trim_end_matches('/'),
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_links_relative_to_the_page() {
        let r = |link| resolve("/posts/pine/", link);
        assert_eq!(r("/about/"), Some(("/about/".into(), None)));
        assert_eq!(r("../brittle/#top"), Some(("/posts/brittle/".into(), Some("top".into()))));
        assert_eq!(r("photo.jpg?v=2"), Some(("/posts/pine/photo.jpg".into(), None)));
        assert_eq!(r("#comments"), Some((String::new(), Some("comments".into()))));
        assert_eq!(r("/my%20file.pdf"), Some(("/my file.pdf".into(), None)));
        for external in ["https://example.com/", "mailto:a@b.c", "//cdn.example.com/x.js", "data:image/png;base64,xx", "tel:123", "#", ""] {
            assert_eq!(r(external), None, "{}", external);
        }
        assert_eq!(resolve("/feed.xml", "style.css"), Some(("/style.css".into(), None)));
    }

    #[test]
    fn a_base_is_taken_off_links_before_checking() {
        assert_eq!(in_site("/repo/about/", "/repo"), Some("/about/"));
        assert_eq!(in_site("/repo", "/repo"), Some("/"));
        assert_eq!(in_site("/repo#top", "/repo"), Some("#top"));
        assert_eq!(in_site("/other/", "/repo"), None);
        assert_eq!(in_site("/repository/", "/repo"), None);
        assert_eq!(in_site("next/", "/repo"), Some("next/"));
        assert_eq!(in_site("//cdn.example.com/x.js", "/repo"), Some("//cdn.example.com/x.js"));
        assert_eq!(in_site("/about/", ""), Some("/about/"));
    }

    #[test]
    fn scans_ids_and_links() {
        let page = scan(r#"<h2 id="one">x</h2><a name="two"></a><a href="/a/">a</a><link rel="preconnect" href="https://fonts.example"><link rel="stylesheet" href="/s.css"><img src="/i.png" srcset="/i-300.webp 300w, /i-600.webp 600w">"#).unwrap();
        assert_eq!(page.ids, HashSet::from(["one".to_string(), "two".to_string()]));
        assert_eq!(page.links, vec!["/a/", "/s.css", "/i.png", "/i-300.webp", "/i-600.webp"]);
    }

    #[test]
    fn scans_urls_outside_attributes() {
        let page = scan(r#"<head><meta property="og:image" content="https://example.com/img/a.png"><meta name="twitter:image" content="/img/b.png"><meta name="description" content="/not a url"><meta property="og:title" content="/slash/"><link rel="preload" as="image" imagesrcset="/img/c-300.avif 300w, /img/c-600.avif 600w"><script type="application/ld+json">{"@context":"https://schema.org","logo":{"url":"https://example.com/content/logo.png"},"@id":"https://example.com/#org","name":"A / B"}</script></head>"#).unwrap();
        assert_eq!(page.links, vec!["/img/c-300.avif", "/img/c-600.avif"]);
        assert_eq!(page.site_links, vec!["https://example.com/img/a.png", "/img/b.png"]);
        assert_eq!(page.site_paths, vec!["https://schema.org", "https://example.com/content/logo.png", "https://example.com/#org"]);
    }

    #[test]
    fn scans_feeds_and_their_escaped_html() {
        let feed = r#"<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><link href="https://example.com/feed.xml" rel="self"/><entry><id>https://example.com/posts/a/</id><content type="html">&lt;p&gt;&lt;img src=&quot;https://example.com/content/images/a.png&quot; srcset=&quot;/i-1.png 1x, /i-2.png 2x&quot;&gt; &lt;a href=&quot;/x/?a=1&amp;amp;b=2&quot;&gt;x&lt;/a&gt;&lt;/p&gt;</content></entry><item><description><![CDATA[<a href="/cdata/">c</a>]]></description></item></feed>"#;
        let mut links = scan_xml(feed);
        links.sort();
        assert_eq!(links, vec!["/cdata/", "/i-1.png", "/i-2.png", "/x/?a=1&b=2", "https://example.com/content/images/a.png", "https://example.com/feed.xml", "https://example.com/posts/a/"]);
        assert_eq!(unescape_xml("a &amp;lt; &#39;b&#x27; &bogus; &"), "a &lt; 'b' &bogus; &");
    }

    #[test]
    fn absolute_links_on_the_site_are_its_paths() {
        assert_eq!(origin_of("https://Example.com/blog/"), Some("https://example.com".into()));
        assert_eq!(origin_of("example.com"), None);
        let o = "https://example.com";
        assert_eq!(strip_origin("https://example.com/about/", o), Some("/about/"));
        assert_eq!(strip_origin("http://EXAMPLE.com", o), Some("/"));
        assert_eq!(strip_origin("https://example.com#top", o), Some("#top"));
        assert_eq!(strip_origin("https://example.com.evil/x", o), None);
        assert_eq!(strip_origin("https://other.com/x", o), None);
        assert_eq!(strip_origin("/about/", o), None);
    }

    #[test]
    fn redirect_rules_cover_their_sources() {
        let sources = vec!["/old-post".to_string(), "/archive/*".to_string()];
        assert!(redirected(&sources, "/old-post/"));
        assert!(redirected(&sources, "/archive/2019/"));
        assert!(!redirected(&sources, "/new-post/"));
    }
}
