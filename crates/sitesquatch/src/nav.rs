//! Navigation helpers for templates: a nav tree marked for the current page,
//! previous and next links, breadcrumbs, and a tree built from pages' `nav`
//! front matter.
//!
//! A tree is a list of entries, each an object with `title`, `url` (optional,
//! for a section heading) and children under `children`, `items` or `pages`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::{Map, Value};

const CHILD_KEYS: [&str; 3] = ["children", "items", "pages"];

fn children(entry: &Value) -> Option<(&'static str, &[Value])> {
    let obj = entry.as_object()?;
    CHILD_KEYS.iter().find_map(|k| obj.get(*k).and_then(|v| v.as_array()).filter(|a| !a.is_empty()).map(|a| (*k, a)))
}

/// `/docs/`, `/docs` and `/docs/index.html` are the same page.
fn same_url(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && normal(a) == normal(b)
}

/// A URL as [`same_url`] compares it.
fn normal(url: &str) -> String {
    let u = url.split(['#', '?']).next().unwrap_or("");
    u.strip_suffix("index.html").unwrap_or(u).trim_end_matches('/').to_string()
}

/// What the helpers need to know about one tree, worked out once: a sidebar
/// is asked about on every page, and marking 9,000 entries for each of 9,000
/// pages is most of such a site's build.
struct Index {
    /// The tree itself, kept so its address stays its identity.
    entries: Arc<Vec<Value>>,
    /// Every entry with `current`, `ancestor` and `open` false.
    unmarked: Vec<Value>,
    /// Where each URL's entries are: child indexes from the top.
    paths: HashMap<String, Vec<Vec<usize>>>,
    /// The entries with a URL, in reading order, without their children.
    flat: Vec<Value>,
    /// Each URL's first place in `flat`.
    position: HashMap<String, usize>,
}

impl Index {
    fn new(entries: &Arc<Vec<Value>>) -> Index {
        fn walk(level: &[Value], prefix: &mut Vec<usize>, index: &mut Index) {
            for (i, e) in level.iter().enumerate() {
                prefix.push(i);
                if let Some(url) = e.get("url").as_str().filter(|u| !u.is_empty()) {
                    index.paths.entry(normal(url)).or_default().push(prefix.clone());
                    index.position.entry(normal(url)).or_insert(index.flat.len());
                    index.flat.push(without_children(e));
                }
                if let Some((_, list)) = children(e) {
                    walk(list, prefix, index);
                }
                prefix.pop();
            }
        }
        // A URL no entry has: nothing is current.
        let unmarked = entries.iter().map(|e| mark(e, "\0").0).collect();
        let mut index = Index { entries: entries.clone(), unmarked, paths: HashMap::new(), flat: Vec::new(), position: HashMap::new() };
        walk(entries, &mut Vec::new(), &mut index);
        index
    }

    /// The index for `entries`, if this tree has been asked about before:
    /// an index costs more than one answer, and an engine that hands over a
    /// fresh copy of the tree for each page (Liquid) would never reuse it.
    fn of(entries: &Arc<Vec<Value>>) -> Option<Arc<Index>> {
        static RECENT: Mutex<Vec<Arc<Index>>> = Mutex::new(Vec::new());
        static SEEN_ONCE: Mutex<Vec<Arc<Vec<Value>>>> = Mutex::new(Vec::new());
        let mut recent = RECENT.lock().unwrap();
        if let Some(found) = recent.iter().find(|i| Arc::ptr_eq(&i.entries, entries)) {
            return Some(found.clone());
        }
        let mut seen = SEEN_ONCE.lock().unwrap();
        let Some(at) = seen.iter().position(|s| Arc::ptr_eq(s, entries)) else {
            if seen.len() >= 16 {
                seen.remove(0);
            }
            seen.push(entries.clone());
            return None;
        };
        seen.remove(at);
        let index = Arc::new(Index::new(entries));
        if recent.len() >= 16 {
            recent.remove(0);
        }
        recent.push(index.clone());
        Some(index)
    }
}

/// `level` with the entries at `paths` (and the ones above them) marked.
/// Entries off those paths are shared, not copied.
fn mark_paths(level: &[Value], paths: &[&[usize]]) -> Vec<Value> {
    let mut out = level.to_vec();
    let mut firsts: Vec<usize> = paths.iter().map(|p| p[0]).collect();
    firsts.sort_unstable();
    firsts.dedup();
    for i in firsts {
        let Some(obj) = level.get(i).and_then(|e| e.as_object()) else { continue };
        let here: Vec<&[usize]> = paths.iter().filter(|p| p[0] == i).map(|p| &p[1..]).collect();
        let current = here.iter().any(|p| p.is_empty());
        let below: Vec<&[usize]> = here.into_iter().filter(|p| !p.is_empty()).collect();
        let mut map: Map = obj.clone();
        if !below.is_empty() {
            if let Some((key, list)) = children(&level[i]) {
                map.insert(key.to_string(), Value::array(mark_paths(list, &below)));
            }
        }
        map.insert("current".into(), Value::Bool(current));
        map.insert("ancestor".into(), Value::Bool(!below.is_empty()));
        map.insert("open".into(), Value::Bool(true));
        out[i] = Value::object(map);
    }
    out
}

/// The tree with `current`, `ancestor` and `open` set on each entry.
pub fn tree(entries: &[Value], url: &str) -> Value {
    Value::array(entries.iter().map(|e| mark(e, url).0).collect())
}

/// [`tree`] for a tree that's a template value, remembering the work that
/// doesn't depend on the page.
pub fn tree_of(nav: &Value, url: &str) -> Value {
    let Value::Arr(entries) = nav else { return Value::array(Vec::new()) };
    let Some(index) = Index::of(entries) else { return tree(entries, url) };
    match index.paths.get(&normal(url)).filter(|_| !url.is_empty()) {
        Some(paths) => Value::array(mark_paths(&index.unmarked, &paths.iter().map(Vec::as_slice).collect::<Vec<_>>())),
        None => Value::array(index.unmarked.clone()),
    }
}

/// [`pager`] for a tree that's a template value.
pub fn pager_of(nav: &Value, url: &str) -> Value {
    let Value::Arr(entries) = nav else { return pager(&[], url) };
    let Some(index) = Index::of(entries) else { return pager(entries, url) };
    let i = index.position.get(&normal(url)).copied().filter(|_| !url.is_empty());
    let at = |j: Option<usize>| j.and_then(|j| index.flat.get(j)).cloned().unwrap_or(Value::Null);
    Value::from_pairs([("previous", at(i.and_then(|i| i.checked_sub(1)))), ("next", at(i.map(|i| i + 1)))])
}

/// [`breadcrumbs`] for a tree that's a template value.
pub fn breadcrumbs_of(nav: &Value, url: &str) -> Value {
    let Value::Arr(entries) = nav else { return Value::array(Vec::new()) };
    let Some(index) = Index::of(entries) else { return breadcrumbs(entries, url) };
    let Some(path) = index.paths.get(&normal(url)).filter(|_| !url.is_empty()).and_then(|p| p.first()) else { return Value::array(Vec::new()) };
    let mut level: &[Value] = entries;
    let mut out = Vec::with_capacity(path.len());
    for &i in path {
        let entry = &level[i];
        out.push(without_children(entry));
        level = children(entry).map(|(_, list)| list).unwrap_or(&[]);
    }
    Value::array(out)
}

/// An entry marked, and whether it or something below it is the current page.
fn mark(entry: &Value, url: &str) -> (Value, bool) {
    let Some(obj) = entry.as_object() else { return (entry.clone(), false) };
    let mut out: Map = obj.clone();
    let current = entry.get("url").as_str().is_some_and(|u| same_url(u, url));
    let mut ancestor = false;
    if let Some((key, list)) = children(entry) {
        let marked: Vec<Value> = list
            .iter()
            .map(|c| {
                let (v, found) = mark(c, url);
                ancestor |= found;
                v
            })
            .collect();
        out.insert(key.to_string(), Value::array(marked));
    }
    out.insert("current".into(), Value::Bool(current));
    out.insert("ancestor".into(), Value::Bool(ancestor));
    out.insert("open".into(), Value::Bool(current || ancestor));
    (Value::object(out), current || ancestor)
}

/// The entries with a URL, in reading order (depth first).
fn flatten<'a>(entries: &'a [Value], out: &mut Vec<&'a Value>) {
    for e in entries {
        if e.get("url").as_str().is_some_and(|u| !u.is_empty()) {
            out.push(e);
        }
        if let Some((_, list)) = children(e) {
            flatten(list, out);
        }
    }
}

/// `{ previous, next }`: the entries before and after the current page.
pub fn pager(entries: &[Value], url: &str) -> Value {
    let mut flat = Vec::new();
    flatten(entries, &mut flat);
    let i = flat.iter().position(|e| same_url(e.get("url").as_str().unwrap_or(""), url));
    let at = |j: Option<usize>| j.and_then(|j| flat.get(j)).map(|e| without_children(e)).unwrap_or(Value::Null);
    Value::from_pairs([("previous", at(i.and_then(|i| i.checked_sub(1)))), ("next", at(i.map(|i| i + 1)))])
}

fn without_children(e: &Value) -> Value {
    match e.as_object() {
        Some(o) => Value::object(o.iter().filter(|(k, _)| !CHILD_KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()),
        None => e.clone(),
    }
}

/// The entries from the top of the tree down to the current page.
pub fn breadcrumbs(entries: &[Value], url: &str) -> Value {
    fn walk(entries: &[Value], url: &str, path: &mut Vec<Value>) -> bool {
        for e in entries {
            path.push(without_children(e));
            if e.get("url").as_str().is_some_and(|u| same_url(u, url)) {
                return true;
            }
            if let Some((_, list)) = children(e) {
                if walk(list, url, path) {
                    return true;
                }
            }
            path.pop();
        }
        false
    }
    let mut path = Vec::new();
    if walk(entries, url, &mut path) {
        Value::array(path)
    } else {
        Value::array(Vec::new())
    }
}

/// A tree from collection items with `nav` front matter: `nav: { title,
/// parent, order }` (or `nav: true` for a top-level entry titled by
/// `title`). An entry's key is its `nav.key`, or its title; `parent` names
/// another entry's key. Siblings sort by `order`, then title.
pub fn from_pages(items: &[Value]) -> Value {
    struct Node {
        key: String,
        parent: Option<String>,
        order: f64,
        entry: Map,
    }
    let mut nodes: Vec<Node> = Vec::new();
    for item in items {
        let data = item.get("data");
        let nav = data.get("nav");
        if nav.is_nullish() || matches!(nav, Value::Bool(false)) {
            continue;
        }
        let title = nav.get("title").as_str().map(String::from).unwrap_or_else(|| data.get("title").to_js_string());
        let key = nav.get("key").as_str().map(String::from).unwrap_or_else(|| title.clone());
        let mut entry = Map::new();
        entry.insert("title".into(), Value::from(title));
        entry.insert("url".into(), item.get("url"));
        entry.insert("key".into(), Value::from(key.as_str()));
        nodes.push(Node { key, parent: nav.get("parent").as_str().map(String::from), order: nav.get("order").as_f64().unwrap_or(f64::MAX), entry });
    }
    fn build(nodes: &[Node], parent: Option<&str>, depth: usize) -> Vec<Value> {
        if depth > 32 {
            return Vec::new();
        }
        let mut level: Vec<&Node> = nodes.iter().filter(|n| n.parent.as_deref() == parent).collect();
        level.sort_by(|a, b| a.order.total_cmp(&b.order).then_with(|| a.entry["title"].to_js_string().cmp(&b.entry["title"].to_js_string())));
        level
            .into_iter()
            .map(|n| {
                let mut e = n.entry.clone();
                e.insert("children".into(), Value::array(build(nodes, Some(&n.key), depth + 1)));
                Value::object(e)
            })
            .collect()
    }
    // Entries whose parent doesn't exist go at the top.
    let keys: std::collections::HashSet<String> = nodes.iter().map(|n| n.key.clone()).collect();
    let nodes: Vec<Node> = nodes.into_iter().map(|mut n| {
        if n.parent.as_ref().is_some_and(|p| !keys.contains(p)) {
            n.parent = None;
        }
        n
    }).collect();
    Value::array(build(&nodes, None, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nav() -> Vec<Value> {
        let json = serde_json::json!([
            { "title": "Start", "pages": [{ "title": "Intro", "url": "/docs/" }, { "title": "Install", "url": "/docs/install/" }] },
            { "title": "Guides", "url": "/docs/guides/", "children": [{ "title": "Config", "url": "/docs/guides/config/" }] }
        ]);
        json.as_array().unwrap().iter().cloned().map(Value::from).collect()
    }

    #[test]
    fn tree_marks_current_and_ancestors() {
        let t = tree(&nav(), "/docs/guides/config/index.html");
        assert!(!t.get_path("0.open").truthy());
        assert!(t.get_path("1.ancestor").truthy() && t.get_path("1.open").truthy() && !t.get_path("1.current").truthy());
        assert!(t.get_path("1.children.0.current").truthy());
        assert!(tree(&nav(), "/docs/install").get_path("0.pages.1.current").truthy());
    }

    #[test]
    fn pager_and_breadcrumbs() {
        let p = pager(&nav(), "/docs/install/");
        assert_eq!(p.get("previous").get("title").to_js_string(), "Intro");
        assert_eq!(p.get("next").get("title").to_js_string(), "Guides");
        assert!(p.get("next").get("children").is_nullish());
        assert!(pager(&nav(), "/docs/").get("previous").is_nullish());
        assert!(pager(&nav(), "/nowhere/").get("next").is_nullish());
        let crumbs = breadcrumbs(&nav(), "/docs/guides/config/");
        let titles: Vec<String> = crumbs.as_array().unwrap().iter().map(|c| c.get("title").to_js_string()).collect();
        assert_eq!(titles, ["Guides", "Config"]);
    }

    /// The remembered versions give what the plain ones do, for every page and for none.
    #[test]
    fn remembered_trees_match() {
        let json = serde_json::json!([
            { "title": "Start", "pages": [{ "title": "Intro", "url": "/docs/" }, { "title": "Install", "url": "/docs/install/" }] },
            { "title": "Guides", "url": "/docs/guides/", "children": [{ "title": "Overview", "url": "/docs/guides/" }, { "title": "Config", "url": "/docs/guides/config/", "items": [{ "title": "Deep", "url": "/docs/guides/config/deep/" }] }] },
            { "title": "Home", "url": "/" },
            "not an entry"
        ]);
        let nav = Value::from(json);
        let entries = nav.as_array().unwrap();
        // The first question about a tree is answered the plain way, the rest from its index.
        for url in ["/docs/", "/docs/", "/docs/install", "/docs/guides/", "/docs/guides/config/index.html", "/docs/guides/config/deep/#x", "/", "/nowhere/", ""] {
            assert_eq!(tree_of(&nav, url).to_json(), tree(entries, url).to_json(), "tree {:?}", url);
            assert_eq!(pager_of(&nav, url).to_json(), pager(entries, url).to_json(), "pager {:?}", url);
            assert_eq!(breadcrumbs_of(&nav, url).to_json(), breadcrumbs(entries, url).to_json(), "breadcrumbs {:?}", url);
        }
        assert_eq!(tree_of(&Value::Undefined, "/").to_json(), serde_json::json!([]));
    }

    #[test]
    fn tree_from_front_matter() {
        let item = |title: &str, url: &str, nav: serde_json::Value| Value::from(serde_json::json!({ "url": url, "data": { "title": title, "nav": nav } }));
        let items = vec![
            item("Config", "/guides/config/", serde_json::json!({ "parent": "Guides", "order": 2 })),
            item("Guides", "/guides/", serde_json::json!(true)),
            item("Deploy", "/guides/deploy/", serde_json::json!({ "parent": "Guides", "order": 1 })),
            item("Hidden", "/hidden/", serde_json::json!(false)),
            item("Orphan", "/orphan/", serde_json::json!({ "parent": "Nope", "title": "Lost" })),
        ];
        let t = from_pages(&items);
        let titles = |v: &Value| v.as_array().unwrap().iter().map(|e| e.get("title").to_js_string()).collect::<Vec<_>>();
        assert_eq!(titles(&t), ["Guides", "Lost"]);
        assert_eq!(titles(&t.get_path("0.children")), ["Deploy", "Config"]);
    }
}
