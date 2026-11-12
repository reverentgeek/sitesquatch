//! `ssqch inspect`: where a page comes from, and where each value in its
//! data was set.
//!
//! A page's data is a cascade. From the bottom: global data (`_data/` files,
//! the config's `data`), the front matter of its layouts (outermost first),
//! directory data files (outermost folder first), the page's own data file,
//! its front matter, and `computed`. Each level replaces what the ones below
//! it set (objects and lists are merged, unless `deepMerge` is off). When a
//! value isn't what you expect, this says which level set it, and which
//! levels it overrode.
//!
//! The site is read as a build reads it, up to the point of rendering:
//! `beforeBuild` hooks run, since data can depend on them, but no page is
//! rendered or written and `afterBuild` hooks don't run.

use anyhow::{bail, Result};

use crate::build::{display_path, inspect_pages, InspectedPage};
use crate::config::{BuildContext, Config};
use crate::{Map, Value};

/// One level of the cascade that set a field: what to call it, and the value it gave.
#[derive(Debug, Clone)]
pub struct SetBy {
    pub from: String,
    pub value: Value,
}

/// A field of the page's data.
#[derive(Debug, Clone)]
pub struct Field {
    pub name: String,
    /// The value templates see.
    pub value: Value,
    /// The level that decided it (the last of `set_by`).
    pub from: String,
    /// Every level that set it, lowest first.
    pub set_by: Vec<SetBy>,
}

#[derive(Debug, Clone)]
pub struct Inspection {
    /// The page's URL, or `None` for `permalink: false`.
    pub url: Option<String>,
    pub input_path: String,
    pub output_path: Option<String>,
    pub engines: Vec<String>,
    /// The layout chain, innermost first.
    pub layouts: Vec<String>,
    pub date: String,
    /// Where the date came from.
    pub date_from: String,
    /// The collections the page is in.
    pub collections: Vec<String>,
    pub fields: Vec<Field>,
}

/// Where a key of the global data came from.
fn global_origin(cfg: &Config, ctx: &BuildContext, key: &str) -> String {
    if key == "ssqch" {
        return "built in".into();
    }
    if cfg.global_data.iter().any(|(name, _)| name == key) {
        return "the config's `data`".into();
    }
    for dir in std::iter::once(ctx.data_dir.clone()).chain(ctx.theme_dirs.iter().map(|t| t.join("_data"))) {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        if let Some(path) = paths.into_iter().find(|p| p.file_stem().is_some_and(|s| s == key) || p.file_name().is_some_and(|n| n == key)) {
            return display_path(ctx, &path).trim_start_matches("./").to_string();
        }
    }
    "global data".into()
}

fn fields(cfg: &Config, ctx: &BuildContext, global: &Map, page: &InspectedPage) -> Vec<Field> {
    let computed = page.data.get("computed").and_then(|c| c.as_object()).cloned().unwrap_or_default();
    let alias = page.data.get("pagination").map(|p| p.get("alias").to_js_string()).unwrap_or_default();
    let mut out = Vec::new();
    for (name, value) in page.data.iter() {
        let mut set_by: Vec<SetBy> = Vec::new();
        if let Some(v) = global.get(name) {
            set_by.push(SetBy { from: global_origin(cfg, ctx, name), value: v.clone() });
        }
        for (from, layer) in &page.layers {
            // A layout's own `layout` says what wraps it; it isn't a value for the page.
            if name == "layout" && from.starts_with("layout ") {
                continue;
            }
            if let Some(v) = layer.get(name) {
                set_by.push(SetBy { from: from.clone(), value: v.clone() });
            }
        }
        if name == "page" {
            set_by = vec![SetBy { from: "built in".into(), value: value.clone() }];
        } else if computed.contains_key(name) {
            set_by.push(SetBy { from: "computed".into(), value: value.clone() });
        } else if *name == alias {
            set_by.push(SetBy { from: "pagination (its `alias`)".into(), value: value.clone() });
        } else if name == "pagination" {
            set_by.push(SetBy { from: "pagination (this page's items and links)".into(), value: value.clone() });
        }
        let from = set_by.last().map(|s| s.from.clone()).unwrap_or_else(|| "the build".into());
        out.push(Field { name: name.clone(), value: value.clone(), from, set_by });
    }
    out
}

/// The page at `target`: a URL (`/guides/install/`) or a template's path
/// (`src/guides/install.md`, from the project root or the input folder).
pub fn inspect(cfg: &Config, target: &str) -> Result<Inspection> {
    let (ctx, global, pages) = inspect_pages(cfg)?;
    // `/trail/`, `/trail/index.html` and `/trail` are one page; `/trailindex.html` isn't. The
    // exact URL first.
    let trim = |u: &str| u.strip_suffix("index.html").filter(|rest| rest.ends_with('/')).unwrap_or(u).trim_end_matches('/').to_string();
    let exact: Vec<&InspectedPage> = pages.iter().filter(|p| p.url.as_deref() == Some(target)).collect();
    let by_url: Vec<&InspectedPage> = if exact.is_empty() { pages.iter().filter(|p| p.url.as_deref().is_some_and(|u| trim(u) == trim(target))).collect() } else { exact };
    let wanted: Vec<_> = [ctx.root.join(target), ctx.input_dir.join(target)].into_iter().map(|p| dunce::canonicalize(&p).unwrap_or(p)).collect();
    let by_file: Vec<&InspectedPage> = pages.iter().filter(|p| wanted.contains(&p.input)).collect();
    let page: &InspectedPage = if target.starts_with('/') && !by_url.is_empty() {
        by_url[0]
    } else {
        match by_file.as_slice() {
            [one] => one,
            [] => {
                // The closest URLs: the ones that share the target's last part.
                let last = target.trim_end_matches('/').rsplit('/').next().unwrap_or("").trim_end_matches(".md").to_ascii_lowercase();
                let mut near: Vec<&str> = pages.iter().filter_map(|p| p.url.as_deref()).filter(|u| !last.is_empty() && u.to_ascii_lowercase().contains(&last)).take(5).collect();
                near.sort();
                let hint = if near.is_empty() { String::new() } else { format!(" Close: {}", near.join(", ")) };
                bail!("no page at {:?} (give a URL like /about/, or a template's path; the site has {} pages).{}", target, pages.len(), hint);
            }
            many => {
                let urls: Vec<&str> = many.iter().filter_map(|p| p.url.as_deref()).take(8).collect();
                bail!("{} makes {} pages; give the URL of one: {}{}", target, many.len(), urls.join(", "), if many.len() > 8 { ", ..." } else { "" });
            }
        }
    };

    let has = |key: &str| page.layers.iter().rev().find(|(_, layer)| layer.get(key).is_some_and(|v| !v.is_nullish())).map(|(from, _)| from.clone());
    let computed_date = page.data.get("computed").is_some_and(|c| !c.get("date").is_nullish());
    let date_from = if computed_date {
        "computed".to_string()
    } else if let Some(from) = has("date") {
        from
    } else if page.date_from_name {
        "the file's name".to_string()
    } else {
        "the file's modification time".to_string()
    };
    let mut collections = Vec::new();
    if page.in_collections {
        collections.push("all".to_string());
        if let Some(tags) = page.data.get("tags").and_then(|t| t.as_array()) {
            collections.extend(tags.iter().map(|t| t.to_js_string()));
        }
    }
    Ok(Inspection {
        url: page.url.clone(),
        input_path: display_path(&ctx, &page.input).trim_start_matches("./").to_string(),
        output_path: page.output.as_ref().map(|o| display_path(&ctx, o).trim_start_matches("./").to_string()),
        engines: page.engines.clone(),
        layouts: page.layouts.clone(),
        date: page.date.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        date_from,
        collections,
        fields: fields(cfg, &ctx, &global, page),
    })
}

/// A value, short enough for one column.
fn brief(value: &Value) -> String {
    match value {
        Value::Str(s) => {
            let short: String = s.chars().take(48).collect();
            format!("{:?}{}", short, if s.chars().count() > 48 { "…" } else { "" })
        }
        Value::Arr(items) => format!("[{} item{}]", items.len(), if items.len() == 1 { "" } else { "s" }),
        Value::Obj(map) => {
            // As many of the first four keys as fit in the column.
            let mut keys: Vec<&str> = Vec::new();
            for key in map.keys().take(4) {
                if keys.iter().map(|k| k.chars().count() + 2).sum::<usize>() + key.chars().count() > 44 {
                    break;
                }
                keys.push(key);
            }
            match (keys.is_empty(), map.len() > keys.len()) {
                (true, _) => format!("{{{} key{}}}", map.len(), if map.len() == 1 { "" } else { "s" }),
                (false, more) => format!("{{{}{}}}", keys.join(", "), if more { ", …" } else { "" }),
            }
        }
        Value::Func(_) => "a function".into(),
        Value::Undefined => "undefined".into(),
        other => other.to_js_string(),
    }
}

impl Inspection {
    /// A field by name, or by a dotted path into one (`hero.alt`): the top
    /// field, and the value at the path in it and in each level that set it.
    pub fn field(&self, path: &str) -> Option<Field> {
        let (top, rest) = path.split_once('.').unwrap_or((path, ""));
        let field = self.fields.iter().find(|f| f.name == top)?;
        if rest.is_empty() {
            return Some(field.clone());
        }
        let at = |v: &Value| v.get_path(rest);
        let set_by: Vec<SetBy> = field.set_by.iter().filter(|s| !at(&s.value).is_nullish()).map(|s| SetBy { from: s.from.clone(), value: at(&s.value) }).collect();
        Some(Field { name: path.to_string(), value: at(&field.value), from: set_by.last().map(|s| s.from.clone()).unwrap_or_else(|| field.from.clone()), set_by })
    }

    pub fn to_text(&self) -> String {
        let mut out = format!("{}\n", self.url.as_deref().unwrap_or("(no URL: permalink is false)"));
        let mut row = |label: &str, value: String| out.push_str(&format!("  {:<12}{}\n", label, value));
        row("From", format!("{} ({})", self.input_path, if self.engines.is_empty() { "as it is".to_string() } else { self.engines.join(", ") }));
        if let Some(output) = &self.output_path {
            row("Writes", output.clone());
        }
        if !self.layouts.is_empty() {
            row("Layouts", self.layouts.join(" > "));
        }
        row("Date", format!("{} (from {})", self.date, self.date_from));
        row("Collections", if self.collections.is_empty() { "none".into() } else { self.collections.join(", ") });
        out.push_str("\n  Data (name, value, and the level of the cascade that set it)\n");
        let width = self.fields.iter().map(|f| f.name.chars().count()).max().unwrap_or(0).min(24);
        for field in &self.fields {
            let overrides = if field.set_by.len() > 1 { format!(" (over {})", field.set_by[..field.set_by.len() - 1].iter().map(|s| s.from.as_str()).collect::<Vec<_>>().join(", ")) } else { String::new() };
            out.push_str(&format!("    {:<width$}  {:<52}  {}{}\n", field.name, brief(&field.value), field.from, overrides, width = width));
        }
        out
    }

    /// One field: its value in full, and each level that set it.
    pub fn field_text(field: &Field) -> String {
        let pretty = |v: &Value| serde_json::to_string_pretty(&v.to_json()).unwrap_or_default();
        let mut out = format!("{} = {}\n", field.name, pretty(&field.value));
        if field.set_by.is_empty() {
            out.push_str("  Nothing in the cascade sets it.\n");
            return out;
        }
        out.push_str("\nSet by (the last one wins):\n");
        for (i, set) in field.set_by.iter().enumerate() {
            let mark = if i + 1 == field.set_by.len() { ">" } else { " " };
            out.push_str(&format!("  {} {:<40}  {}\n", mark, set.from, brief(&set.value)));
        }
        out
    }

    fn field_json(field: &Field) -> serde_json::Value {
        serde_json::json!({
            "value": field.value.to_json(),
            "from": field.from,
            "setBy": field.set_by.iter().map(|s| serde_json::json!({ "from": s.from, "value": s.value.to_json() })).collect::<Vec<_>>(),
        })
    }

    /// The report as JSON (`schemaVersion` 1), or one field of it.
    pub fn to_json(&self, field: Option<&Field>) -> serde_json::Value {
        let mut out = serde_json::json!({
            "schemaVersion": 1,
            "url": self.url,
            "inputPath": self.input_path,
            "outputPath": self.output_path,
            "engines": self.engines,
            "layouts": self.layouts,
            "date": { "value": self.date, "from": self.date_from },
            "collections": self.collections,
        });
        match field {
            Some(field) => out["field"] = serde_json::json!({ "name": field.name, "value": field.value.to_json(), "from": field.from, "setBy": Self::field_json(field)["setBy"] }),
            None => out["data"] = serde_json::Value::Object(self.fields.iter().map(|f| (f.name.clone(), Self::field_json(f))).collect()),
        }
        out
    }
}
