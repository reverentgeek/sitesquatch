//! `ssqch footprint`: how much a build weighs, by kind of file, and its
//! largest footprints (the heaviest pages, and the heaviest other files). It
//! reads an output folder, as `ssqch diff` does, so it works on any build.

use std::path::Path;

use anyhow::{bail, Context, Result};

use crate::report::{bytes, count};

/// The kinds of file a build is split into, in the order they're listed.
const KINDS: &[(&str, &[&str])] = &[
    ("Pages", &["html", "htm"]),
    ("Images", &["avif", "webp", "jpg", "jpeg", "png", "gif", "svg", "ico", "bmp", "tif", "tiff", "jxl"]),
    ("CSS", &["css"]),
    ("JavaScript", &["js", "mjs", "cjs", "wasm"]),
    ("Fonts", &["woff2", "woff", "ttf", "otf", "eot"]),
    ("Media", &["mp4", "webm", "mov", "mp3", "ogg", "wav", "m4a", "flac"]),
    ("Documents", &["pdf", "zip", "epub"]),
    ("Data and feeds", &["xml", "json", "txt", "webmanifest", "csv", "map", "rss", "atom"]),
];
const OTHER: &str = "Other";

/// One file.
#[derive(Debug, Clone)]
pub struct File {
    /// From the output folder, with `/`.
    pub path: String,
    pub bytes: u64,
}

/// A kind of file, and how much of it there is.
#[derive(Debug, Clone)]
pub struct Kind {
    pub name: &'static str,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone)]
pub struct Footprint {
    pub files: usize,
    pub bytes: u64,
    /// The kinds with any files, in [`KINDS`] order, `Other` last.
    pub kinds: Vec<Kind>,
    /// Pages, heaviest first.
    pub pages: Vec<File>,
    /// Every other file, heaviest first.
    pub others: Vec<File>,
}

fn kind_of(path: &str) -> &'static str {
    let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    KINDS.iter().find(|(_, exts)| exts.contains(&ext.as_str())).map(|(name, _)| *name).unwrap_or(OTHER)
}

/// Measure the build in `dir`.
pub fn measure(dir: &Path) -> Result<Footprint> {
    if !dir.is_dir() {
        bail!("{} isn't a folder; build the site first, or give `ssqch footprint` a build folder (`ssqch footprint dist`)", dir.display());
    }
    let mut pages = Vec::new();
    let mut others = Vec::new();
    for entry in walkdir::WalkDir::new(dir).follow_links(true) {
        let entry = entry.with_context(|| format!("reading {}", dir.display()))?;
        if !entry.file_type().is_file() || entry.file_name() == ".DS_Store" {
            continue;
        }
        let path = crate::slashes(entry.path().strip_prefix(dir).unwrap_or(entry.path()));
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let file = File { path, bytes: size };
        if kind_of(&file.path) == "Pages" { pages.push(file) } else { others.push(file) }
    }
    let heaviest = |a: &File, b: &File| b.bytes.cmp(&a.bytes).then_with(|| a.path.cmp(&b.path));
    pages.sort_by(heaviest);
    others.sort_by(heaviest);
    let mut kinds: Vec<Kind> = KINDS.iter().map(|(name, _)| *name).chain([OTHER]).map(|name| Kind { name, files: 0, bytes: 0 }).collect();
    for file in pages.iter().chain(&others) {
        let kind = kinds.iter_mut().find(|k| k.name == kind_of(&file.path)).expect("every kind is listed");
        kind.files += 1;
        kind.bytes += file.bytes;
    }
    kinds.retain(|k| k.files > 0);
    Ok(Footprint { files: pages.len() + others.len(), bytes: kinds.iter().map(|k| k.bytes).sum(), kinds, pages, others })
}

/// The share of `total` that `part` is, as a whole percent (`<1%` for a sliver).
fn share(part: u64, total: u64) -> String {
    if total == 0 {
        return "0%".into();
    }
    let percent = part as f64 * 100.0 / total as f64;
    if percent > 0.0 && percent < 1.0 { "<1%".into() } else { format!("{:.0}%", percent) }
}

impl Footprint {
    /// The report, with up to `top` of each list of largest footprints.
    pub fn to_text(&self, shown: &str, top: usize) -> String {
        let mut out = format!("Footprint of {}: {} file{}, {}\n", shown, count(self.files), if self.files == 1 { "" } else { "s" }, bytes(self.bytes));
        if self.files == 0 {
            out.push_str("Nothing sighted: the folder is empty.\n");
            return out;
        }
        let rows: Vec<[String; 5]> = self.kinds.iter().map(|k| [k.name.to_string(), count(k.files), (if k.files == 1 { "file" } else { "files" }).to_string(), bytes(k.bytes), share(k.bytes, self.bytes)]).collect();
        let width = |i: usize| rows.iter().map(|r| r[i].chars().count()).max().unwrap_or(0);
        let (w0, w1, w2, w3) = (width(0), width(1), width(2), width(3));
        for [name, files, word, size, part] in &rows {
            out.push_str(&format!("  {:<w0$}  {:>w1$} {:<w2$}  {:>w3$}  {}\n", name, files, word, size, part));
        }
        let list = |out: &mut String, title: &str, files: &[File], name: &dyn Fn(&File) -> String| {
            if files.is_empty() || top == 0 {
                return;
            }
            out.push_str(&format!("\n{}\n", title));
            let shown: Vec<(String, String)> = files.iter().take(top).map(|f| (bytes(f.bytes), name(f))).collect();
            let w = shown.iter().map(|(s, _)| s.chars().count()).max().unwrap_or(0);
            for (size, name) in shown {
                out.push_str(&format!("  {:>w$}  {}\n", size, name));
            }
        };
        list(&mut out, "Largest footprints: pages", &self.pages, &|f| crate::diff::url_of(&f.path));
        list(&mut out, "Largest footprints: other files", &self.others, &|f| format!("/{}", f.path));
        out
    }

    pub fn to_json(&self, output: &str, top: usize) -> serde_json::Value {
        let files = |list: &[File], page: bool| -> Vec<serde_json::Value> {
            list.iter()
                .take(top)
                .map(|f| {
                    let mut item = serde_json::json!({ "path": f.path, "bytes": f.bytes });
                    if page {
                        item["url"] = crate::diff::url_of(&f.path).into();
                    } else {
                        item["kind"] = kind_of(&f.path).into();
                    }
                    item
                })
                .collect()
        };
        serde_json::json!({
            "schemaVersion": 1,
            "output": output,
            "files": self.files,
            "bytes": self.bytes,
            "kinds": self.kinds.iter().map(|k| serde_json::json!({ "kind": k.name, "files": k.files, "bytes": k.bytes })).collect::<Vec<_>>(),
            "largest": { "pages": files(&self.pages, true), "files": files(&self.others, false) },
        })
    }
}

// ------------------------------------------------------------------ budgets

/// The names `budgets` takes: each kind of file, as the config writes it, and `total`.
pub const BUDGETS: &[(&str, &str)] = &[
    ("pages", "Pages"),
    ("images", "Images"),
    ("css", "CSS"),
    ("javascript", "JavaScript"),
    ("fonts", "Fonts"),
    ("media", "Media"),
    ("documents", "Documents"),
    ("data", "Data and feeds"),
    ("other", OTHER),
    ("total", ""),
];

/// A size as a config writes it: bytes, or `"150 KB"`, `"1.5 MB"`, `"500 B"`
/// (powers of 1,000, as ssqch's reports print them).
pub fn parse_size(text: &str) -> Option<u64> {
    let text = text.trim();
    let split = text.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(text.len());
    let number: f64 = text[..split].trim().parse().ok().filter(|n: &f64| *n >= 0.0)?;
    let unit = match text[split..].trim().to_ascii_uppercase().as_str() {
        "" | "B" => 1.0,
        "KB" | "K" => 1e3,
        "MB" | "M" => 1e6,
        "GB" | "G" => 1e9,
        _ => return None,
    };
    Some((number * unit).round() as u64)
}

/// A `budgets` entry, checked: (the name, the size), or what's wrong with it.
pub fn budget(name: &str, size: &crate::Value) -> anyhow::Result<(String, u64)> {
    if !BUDGETS.iter().any(|(key, _)| *key == name) {
        let names: Vec<&str> = BUDGETS.iter().map(|(key, _)| *key).collect();
        let hint = crate::suggest::closest(name, names.iter().copied()).map(|n| format!(" (did you mean `{}`?)", n)).unwrap_or_default();
        bail!("budgets.{} isn't a kind of file{} (use {})", name, hint, names.join(", "));
    }
    let bytes = match size {
        crate::Value::Num(n) if *n >= 0.0 => *n as u64,
        crate::Value::Str(s) => parse_size(s).ok_or_else(|| anyhow::anyhow!("budgets.{}: {:?} isn't a size (write it like \"150 KB\" or \"1.5 MB\")", name, &**s))?,
        other => bail!("budgets.{} must be a size like \"150 KB\", not {}", name, other.type_of()),
    };
    Ok((name.to_string(), bytes))
}

/// The files in `footprint` over their kind's budget (and the build, over
/// `total`), each kind as one `bigfootprint` warning.
pub fn over_budget(footprint: &Footprint, budgets: &[(String, u64)]) -> Vec<crate::diagnostics::Diagnostic> {
    let mut out = Vec::new();
    for (name, limit) in budgets {
        if name == "total" {
            if footprint.bytes > *limit {
                out.push(crate::diagnostics::Diagnostic::warning("bigfootprint", format!("the build is {}, over its total budget of {}", bytes(footprint.bytes), bytes(*limit))));
            }
            continue;
        }
        let Some((_, kind)) = BUDGETS.iter().find(|(key, _)| key == name) else { continue };
        let page = *kind == "Pages";
        let over: Vec<&File> = footprint.pages.iter().chain(&footprint.others).filter(|f| kind_of(&f.path) == *kind && f.bytes > *limit).collect();
        let shown = |f: &File| format!("{} ({})", if page { crate::diff::url_of(&f.path) } else { format!("/{}", f.path) }, bytes(f.bytes));
        let what = if page { "page" } else { "file" };
        let message = match over.as_slice() {
            [] => continue,
            [one] => format!("{} is over the {} budget of {}", shown(one), name, bytes(*limit)),
            many => format!("{} {}s are over the {} budget of {}: {}{}", many.len(), what, name, bytes(*limit), many.iter().take(5).map(|f| shown(f)).collect::<Vec<_>>().join(", "), if many.len() > 5 { ", ..." } else { "" }),
        };
        out.push(crate::diagnostics::Diagnostic::warning("bigfootprint", message));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_is_measured_by_kind() {
        let dir = std::env::temp_dir().join(format!("ssqch-footprint-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, size) in [("index.html", 300), ("about/index.html", 1200), ("img/a.avif", 5000), ("img/b.webp", 2000), ("assets/app.css", 400), ("feed.xml", 100), ("CNAME", 10)] {
            let path = dir.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, vec![b'x'; size]).unwrap();
        }
        let footprint = measure(&dir).unwrap();
        assert_eq!((footprint.files, footprint.bytes), (7, 9010));
        assert_eq!(
            footprint.to_text("dist", 2),
            "Footprint of dist: 7 files, 9.01 KB\n  Pages           2 files  1.50 KB  17%\n  Images          2 files  7.00 KB  78%\n  CSS             1 file     400 B  4%\n  Data and feeds  1 file     100 B  1%\n  Other           1 file      10 B  <1%\n\nLargest footprints: pages\n  1.20 KB  /about/\n    300 B  /\n\nLargest footprints: other files\n  5.00 KB  /img/a.avif\n  2.00 KB  /img/b.webp\n"
        );
        let json = footprint.to_json("dist", 1);
        assert_eq!(json["largest"]["pages"], serde_json::json!([{ "path": "about/index.html", "url": "/about/", "bytes": 1200 }]));
        assert_eq!(json["kinds"][1], serde_json::json!({ "kind": "Images", "files": 2, "bytes": 7000 }));
        // Budgets: one warning per kind, and the total.
        let budgets = [("pages".to_string(), 1000), ("images".to_string(), parse_size("1 KB").unwrap()), ("css".to_string(), 1000), ("total".to_string(), parse_size("9 KB").unwrap())];
        let said: Vec<String> = over_budget(&footprint, &budgets).into_iter().map(|d| d.message).collect();
        assert_eq!(said, ["/about/ (1.20 KB) is over the pages budget of 1.00 KB", "2 files are over the images budget of 1.00 KB: /img/a.avif (5.00 KB), /img/b.webp (2.00 KB)", "the build is 9.01 KB, over its total budget of 9.00 KB"]);
        assert_eq!((parse_size("150 KB"), parse_size("1.5MB"), parse_size("12"), parse_size("lots")), (Some(150_000), Some(1_500_000), Some(12), None));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
