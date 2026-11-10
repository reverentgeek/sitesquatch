//! Custom elements for SiteSquatch: interactivity without a framework.
//!
//! A custom element is a tag with a hyphen in its name (`<like-button>`)
//! whose behaviour comes from a script that defines it. Put that script in
//! the elements folder as `like-button.js` (with `like-button.css` next to
//! it, if it has styles), and write the tag in any page or layout:
//!
//! ```html
//! <like-button count="3"><a href="/likes/">3 likes</a></like-button>
//! ```
//!
//! Each page gets the scripts and stylesheets of the elements it uses, and
//! no others. What's inside the tag is what a visitor without JavaScript
//! (or before the script loads) sees, so write the fallback there.
//!
//! `ssqch:load` on a tag says when its script loads: `eager` (with the page,
//! the default), `idle` (when the browser has a quiet moment) or `visible`
//! (when the element scrolls into view), which keeps a page's first load
//! light: an "island".

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use anyhow::{anyhow, bail, Context, Result};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use sitesquatch::{BuildContext, Config, Plugin};

/// When an element's script loads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Load {
    /// With the page.
    Eager,
    /// When the browser is idle.
    Idle,
    /// When one of the element's tags scrolls into view.
    Visible,
}

impl Load {
    pub fn parse(s: &str) -> Option<Load> {
        match s {
            "eager" => Some(Load::Eager),
            "idle" => Some(Load::Idle),
            "visible" => Some(Load::Visible),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Load::Eager => "eager",
            Load::Idle => "idle",
            Load::Visible => "visible",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ElementsOptions {
    /// The folder with the elements' files, relative to the project root.
    /// `None` is `elements` in the input folder.
    pub dir: Option<PathBuf>,
    /// Where the folder goes in the output. Default `/elements/`.
    pub url: String,
    /// When scripts load, for tags without `ssqch:load`. Default eager.
    pub load: Load,
}

impl Default for ElementsOptions {
    fn default() -> Self {
        ElementsOptions { dir: None, url: "/elements/".into(), load: Load::Eager }
    }
}

/// An element the site defines: the URLs of its script and stylesheet.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Element {
    script: String,
    style: Option<String>,
}

pub struct ElementsPlugin {
    options: ElementsOptions,
    known: Arc<RwLock<BTreeMap<String, Element>>>,
    /// Pages that use an element, and the elements used, for the summary.
    pages: Arc<AtomicUsize>,
    used: Arc<Mutex<BTreeSet<String>>>,
}

impl ElementsPlugin {
    pub fn new(mut options: ElementsOptions) -> Result<Self> {
        if !options.url.starts_with('/') || options.url.contains("..") {
            bail!("url must be a URL path starting with /, like \"/elements/\" (got {:?})", options.url);
        }
        if !options.url.ends_with('/') {
            options.url.push('/');
        }
        Ok(ElementsPlugin { options, known: Default::default(), pages: Default::default(), used: Default::default() })
    }
}

/// Whether `name` can be a custom element's: lowercase, with a hyphen.
fn is_element_name(name: &str) -> bool {
    name.contains('-') && name.starts_with(|c: char| c.is_ascii_lowercase()) && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.')
}

/// The elements in `dir`: every `.js` or `.mjs` file named like a custom
/// element, at any depth, with the `.css` file of the same name next to it.
fn scan(ctx: &BuildContext, dir: &std::path::Path, url: &str) -> Result<BTreeMap<String, Element>> {
    if !dir.is_dir() {
        bail!("the elements folder {} doesn't exist; create it, or set `dir`", sitesquatch::display_path(ctx, dir));
    }
    let mut out: BTreeMap<String, Element> = BTreeMap::new();
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    for entry in walkdir::WalkDir::new(dir).sort_by_file_name() {
        let entry = entry.with_context(|| format!("reading {}", dir.display()))?;
        let path = entry.path();
        let is_script = path.extension().is_some_and(|e| e == "js" || e == "mjs");
        let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
        if !entry.file_type().is_file() || !is_script || !is_element_name(&stem) {
            continue;
        }
        let rel = sitesquatch::slashes(path.strip_prefix(dir).unwrap_or(path));
        if let Some(other) = sources.insert(stem.clone(), rel.clone()) {
            bail!("{} and {} both define <{}>; keep one", other, rel, stem);
        }
        let css = path.with_extension("css");
        let style = css.is_file().then(|| format!("{}{}", url, sitesquatch::slashes(css.strip_prefix(dir).unwrap_or(&css))));
        out.insert(stem, Element { script: format!("{}{}", url, rel), style });
    }
    Ok(out)
}

/// What a page uses: each element's tag and when to load it.
type Used = BTreeMap<String, Load>;

/// Find the known elements in `html`, taking `ssqch:load` off their tags.
fn find_used(html: &str, known: &BTreeMap<String, Element>, default: Load) -> Result<(String, Used)> {
    let used: Mutex<Used> = Mutex::new(BTreeMap::new());
    let problem: Mutex<Option<String>> = Mutex::new(None);
    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("*", |el| {
                let tag = el.tag_name();
                if !known.contains_key(&tag) {
                    return Ok(());
                }
                let load = match el.get_attribute("ssqch:load") {
                    None => default,
                    Some(value) => {
                        el.remove_attribute("ssqch:load");
                        match Load::parse(value.trim()) {
                            Some(load) => load,
                            None => {
                                *problem.lock().unwrap() = Some(format!("<{} ssqch:load=\"{}\">: use eager, idle or visible", tag, value));
                                default
                            }
                        }
                    }
                };
                // Two tags that disagree: the earlier load wins.
                let mut used = used.lock().unwrap();
                let slot = used.entry(tag).or_insert(load);
                *slot = (*slot).min(load);
                Ok(())
            })],
            ..RewriteStrSettings::new()
        },
    )
    .map_err(|e| anyhow!("{}", e))?;
    if let Some(problem) = problem.into_inner().unwrap() {
        bail!("{}", problem);
    }
    Ok((out, used.into_inner().unwrap()))
}

fn js_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('<', "\\u003c"))
}

/// The tags to add for what a page uses: (for the head, for the end of the body).
fn tags(used: &Used, known: &BTreeMap<String, Element>, ctx: &BuildContext) -> (String, String) {
    let (mut head, mut body, mut lazy) = (String::new(), String::new(), Vec::new());
    for (tag, load) in used {
        let element = &known[tag];
        if let Some(style) = &element.style {
            head.push_str(&format!("<link rel=\"stylesheet\" href=\"{}\">\n", style));
        }
        match load {
            Load::Eager => body.push_str(&format!("<script type=\"module\" src=\"{}\"></script>\n", element.script)),
            // In a script, so the build's `base` isn't added for us.
            _ => lazy.push(format!("[{},{},{}]", js_string(tag), js_string(&ctx.with_base(&element.script)), js_string(load.as_str()))),
        }
    }
    if !lazy.is_empty() {
        body.push_str(&format!(
            "<script type=\"module\">const idle=window.requestIdleCallback||((f)=>setTimeout(f,200));for(const[tag,src,when]of[{}]){{if(when===\"idle\"){{idle(()=>import(src));continue}}const seen=new IntersectionObserver((entries)=>{{if(entries.some((e)=>e.isIntersecting)){{seen.disconnect();import(src)}}}},{{rootMargin:\"200px\"}});document.querySelectorAll(tag).forEach((el)=>seen.observe(el))}}</script>\n",
            lazy.join(",")
        ));
    }
    (head, body)
}

/// `html` with `addition` before the last `close` tag (`</body>`), or at the end.
fn insert_before(html: &mut String, close: &str, addition: &str, last: bool) {
    if addition.is_empty() {
        return;
    }
    let lower = html.to_ascii_lowercase();
    let at = if last { lower.rfind(close) } else { lower.find(close) };
    match at {
        Some(i) => html.insert_str(i, addition),
        None => html.push_str(addition),
    }
}

impl Plugin for ElementsPlugin {
    fn name(&self) -> &str {
        "elements"
    }

    fn register(&self, cfg: &mut Config) {
        let dir = self.options.dir.clone().unwrap_or_else(|| cfg.input.join("elements"));
        // The whole folder goes to the output, so elements can import shared modules.
        cfg.add_passthrough_copy_to(&dir, self.options.url.trim_matches('/'));
        cfg.add_watch_target(&dir);

        let (known, pages, used_names) = (self.known.clone(), self.pages.clone(), self.used.clone());
        let (scan_dir, url) = (dir.clone(), self.options.url.clone());
        cfg.on_before_build(move |ctx| {
            *known.write().unwrap() = scan(ctx, &ctx.root.join(&scan_dir), &url).context("elements")?;
            pages.store(0, Ordering::Relaxed);
            used_names.lock().unwrap().clear();
            Ok(())
        });

        let (known, pages, used_names) = (self.known.clone(), self.pages.clone(), self.used.clone());
        let default = self.options.load;
        cfg.add_html_transform("elements", move |tctx, html| {
            if !tctx.is_html() {
                return Ok(html);
            }
            let known = known.read().unwrap();
            // Most pages use none: don't parse those.
            if !known.keys().any(|tag| html.contains(&format!("<{}", tag))) {
                return Ok(html);
            }
            let (mut out, used) = find_used(&html, &known, default)?;
            if used.is_empty() {
                return Ok(html);
            }
            let (head, body) = tags(&used, &known, tctx.build);
            // Without a <head>, the stylesheets go with the scripts.
            if out.to_ascii_lowercase().contains("</head>") {
                insert_before(&mut out, "</head>", &head, false);
                insert_before(&mut out, "</body>", &body, true);
            } else {
                insert_before(&mut out, "</body>", &format!("{}{}", head, body), true);
            }
            pages.fetch_add(1, Ordering::Relaxed);
            used_names.lock().unwrap().extend(used.into_keys());
            Ok(out)
        });

        let (known, pages, used_names) = (self.known.clone(), self.pages.clone(), self.used.clone());
        cfg.add_summary("Elements", move |_| {
            let defined = known.read().unwrap().len();
            let used = used_names.lock().unwrap().len();
            let pages = pages.load(Ordering::Relaxed);
            Some(format!("{} defined, {} used on {} page{}", defined, used, sitesquatch::report::count(pages), if pages == 1 { "" } else { "s" }))
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known() -> BTreeMap<String, Element> {
        BTreeMap::from([
            ("like-button".to_string(), Element { script: "/elements/like-button.js".into(), style: Some("/elements/like-button.css".into()) }),
            ("trail-map".to_string(), Element { script: "/elements/maps/trail-map.js".into(), style: None }),
        ])
    }

    #[test]
    fn finds_the_elements_a_page_uses() {
        let html = "<p><like-button count=\"3\">3 likes</like-button> <trail-map ssqch:load=\"visible\"></trail-map><trail-map ssqch:load=\"idle\"></trail-map><other-thing></other-thing></p>";
        let (out, used) = find_used(html, &known(), Load::Eager).unwrap();
        assert_eq!(out, "<p><like-button count=\"3\">3 likes</like-button> <trail-map></trail-map><trail-map></trail-map><other-thing></other-thing></p>");
        assert_eq!(used, BTreeMap::from([("like-button".to_string(), Load::Eager), ("trail-map".to_string(), Load::Idle)]));
        assert!(find_used("<p>none</p>", &known(), Load::Eager).unwrap().1.is_empty());
        let err = find_used("<like-button ssqch:load=\"later\"></like-button>", &known(), Load::Eager).unwrap_err();
        assert_eq!(err.to_string(), "<like-button ssqch:load=\"later\">: use eager, idle or visible");
    }

    #[test]
    fn writes_the_tags_for_a_page() {
        let mut cfg = Config::new(".", sitesquatch::Environment::Production);
        cfg.set_base("/repo/").unwrap();
        let ctx = cfg.build_context();
        let used = BTreeMap::from([("like-button".to_string(), Load::Eager), ("trail-map".to_string(), Load::Visible)]);
        let (head, body) = tags(&used, &known(), &ctx);
        assert_eq!(head, "<link rel=\"stylesheet\" href=\"/elements/like-button.css\">\n");
        assert!(body.starts_with("<script type=\"module\" src=\"/elements/like-button.js\"></script>\n<script type=\"module\">"), "{}", body);
        // The lazy loader's URLs are in a script, so they carry the base themselves.
        assert!(body.contains("[\"trail-map\",\"/repo/elements/maps/trail-map.js\",\"visible\"]"), "{}", body);

        let mut html = "<html><head><title>x</title></head><body><p>hi</p></body></html>".to_string();
        insert_before(&mut html, "</head>", "<link>", false);
        insert_before(&mut html, "</body>", "<script></script>", true);
        assert_eq!(html, "<html><head><title>x</title><link></head><body><p>hi</p><script></script></body></html>");
        let mut fragment = "<p>hi</p>".to_string();
        insert_before(&mut fragment, "</body>", "<script></script>", true);
        assert_eq!(fragment, "<p>hi</p><script></script>");
    }

    #[test]
    fn element_names_have_a_hyphen() {
        for name in ["like-button", "x-1", "trail-map.v2"] {
            assert!(is_element_name(name), "{}", name);
        }
        for name in ["button", "Like-Button", "-x", "1-x", "shared"] {
            assert!(!is_element_name(name), "{}", name);
        }
    }
}
