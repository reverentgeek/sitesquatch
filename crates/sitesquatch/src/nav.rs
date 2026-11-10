//! Navigation helpers for templates: a nav tree marked for the current page,
//! previous and next links, breadcrumbs, and a tree built from pages' `nav`
//! front matter.
//!
//! A tree is a list of entries, each an object with `title`, `url` (optional,
//! for a section heading) and children under `children`, `items` or `pages`.

use crate::{Map, Value};

const CHILD_KEYS: [&str; 3] = ["children", "items", "pages"];

fn children(entry: &Value) -> Option<(&'static str, &[Value])> {
    let obj = entry.as_object()?;
    CHILD_KEYS.iter().find_map(|k| obj.get(*k).and_then(|v| v.as_array()).filter(|a| !a.is_empty()).map(|a| (*k, a)))
}

/// `/docs/`, `/docs` and `/docs/index.html` are the same page.
fn same_url(a: &str, b: &str) -> bool {
    let norm = |u: &str| {
        let u = u.split(['#', '?']).next().unwrap_or("");
        let u = u.strip_suffix("index.html").unwrap_or(u);
        u.trim_end_matches('/').to_string()
    };
    !a.is_empty() && norm(a) == norm(b)
}

/// The tree with `current`, `ancestor` and `open` set on each entry.
pub fn tree(entries: &[Value], url: &str) -> Value {
    Value::array(entries.iter().map(|e| mark(e, url).0).collect())
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
