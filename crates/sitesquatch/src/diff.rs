//! `ssqch diff`: compare two builds of a site, file by file.
//!
//! Build the site before a change (an upgrade, a refactor, a migration) into
//! one folder and after it into another, and this says what the change did
//! to the output: which URLs were added and removed, and what changed on the
//! pages that differ.
//!
//! Unless `exact` is set, differences that don't matter are ignored:
//!
//! - asset fingerprints (`index.3f2a1b4c.css` and `index.9d8e7f6a.css` are
//!   the same file, compared by content) and `integrity` hashes,
//! - the generator's version (`SiteSquatch v0.4.0`),
//! - whitespace between tags, inside text and between attributes (but not in
//!   `<pre>`, `<script>`, `<style>` or `<textarea>`, or in an attribute's value),
//! - anything matching one of the `ignore` patterns.
//!
//! HTML is compared as a list of tags and pieces of text, so a minified page
//! still gets a readable diff, and each changed page says whether its text,
//! its markup or both changed.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{bail, Context, Result};
use rayon::prelude::*;
use regex::Regex;

#[derive(Default)]
pub struct DiffOptions {
    /// Compare bytes: no fingerprint matching, and nothing ignored.
    pub exact: bool,
    /// Text matching one of these is left out of both sides before comparing.
    pub ignore: Vec<Regex>,
    /// Only compare files whose path (from the build's root, with `/`) matches.
    pub only: Option<globset::GlobSet>,
}

/// One side of a removed or added run of lines.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Hunk {
    pub removed: Vec<String>,
    pub added: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An HTML page.
    Page,
    Text,
    Binary,
}

impl Kind {
    fn as_str(&self) -> &'static str {
        match self {
            Kind::Page => "page",
            Kind::Text => "text",
            Kind::Binary => "binary",
        }
    }
}

/// A file that's in both builds with different contents.
#[derive(Debug, Clone)]
pub struct FileDiff {
    /// The file's path in the build, without a fingerprint: `assets/index.css`.
    pub path: String,
    /// `/about/` for `about/index.html`, `/feed.xml` for `feed.xml`.
    pub url: String,
    /// The file's own paths, when a fingerprint makes them differ.
    pub renamed: Option<(String, String)>,
    pub kind: Kind,
    /// For a page: `text`, `markup` or both.
    pub what: Vec<&'static str>,
    /// For a page: a changed title, ids that are gone.
    pub notes: Vec<String>,
    pub hunks: Vec<Hunk>,
    pub size_before: u64,
    pub size_after: u64,
}

impl FileDiff {
    /// How many lines changed (removed and added).
    pub fn changed_lines(&self) -> usize {
        self.hunks.iter().map(|h| h.removed.len() + h.added.len()).sum()
    }
}

#[derive(Debug, Clone, Default)]
pub struct DiffReport {
    pub before: PathBuf,
    pub after: PathBuf,
    pub exact: bool,
    /// URLs only in the second build.
    pub added: Vec<String>,
    /// URLs only in the first build.
    pub removed: Vec<String>,
    pub changed: Vec<FileDiff>,
    pub unchanged_pages: usize,
    pub unchanged_files: usize,
}

impl DiffReport {
    pub fn is_same(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
}

static FINGERPRINT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.([0-9a-f]{8})\.(css|js|mjs|map|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|json|xml|txt|pdf|wasm)\b").unwrap());
static INTEGRITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\s+integrity=("[^"]*"|'[^']*'|[^\s>]+)"#).unwrap());
static GENERATOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"SiteSquatch v\d+\.\d+\.\d+[\w.+-]*").unwrap());

/// `name` (or a whole text) without asset fingerprints: eight hex digits
/// before the extension. Eight digits that read as a date
/// (`report.20240101.pdf`) are part of the name, not a fingerprint.
fn without_fingerprints(text: &str) -> std::borrow::Cow<'_, str> {
    FINGERPRINT.replace_all(text, |c: &regex::Captures| {
        let hash = &c[1];
        let dated = hash.bytes().all(|b| b.is_ascii_digit()) && (hash.starts_with("19") || hash.starts_with("20"));
        if dated { c[0].to_string() } else { format!(".{}", &c[2]) }
    })
}

/// Elements that sit in a line of text, where a space next to the tag shows.
const INLINE: [&str; 30] = [
    "a", "abbr", "b", "bdi", "bdo", "button", "cite", "code", "data", "dfn", "em", "i", "img", "input", "kbd", "label", "mark", "q", "s", "samp", "select", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
];

/// Whether `tag` (`<b>`, `</a>`, `<span class="x">`) is an inline element's.
fn is_inline(tag: &str) -> bool {
    let name: String = tag.trim_start_matches(['<', '/']).chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
    INLINE.contains(&name.as_str())
}

/// The text to compare for a file's contents.
fn normalize(text: &str, options: &DiffOptions) -> String {
    if options.exact {
        return text.to_string();
    }
    let mut out = text.replace("\r\n", "\n");
    for re in &options.ignore {
        out = re.replace_all(&out, "").into_owned();
    }
    out = without_fingerprints(&out).into_owned();
    out = INTEGRITY.replace_all(&out, "").into_owned();
    GENERATOR.replace_all(&out, "SiteSquatch").into_owned()
}

/// Every file under `dir`, as a path from it with `/`.
fn files(dir: &Path) -> Result<Vec<String>> {
    if !dir.is_dir() {
        bail!("{} isn't a folder; give `ssqch diff` two build folders, like `ssqch diff dist-before dist`", dir.display());
    }
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(dir).follow_links(true) {
        let entry = entry.with_context(|| format!("reading {}", dir.display()))?;
        if entry.file_type().is_file() && entry.file_name() != ".DS_Store" {
            out.push(crate::slashes(entry.path().strip_prefix(dir).unwrap_or(entry.path())));
        }
    }
    out.sort();
    Ok(out)
}

/// Each file under a key that's the same in both builds: its path without a
/// fingerprint. Two files with the same key (a stale fingerprinted copy next
/// to the current one) keep their own paths.
fn keyed(paths: Vec<String>, exact: bool) -> BTreeMap<String, String> {
    if exact {
        return paths.into_iter().map(|p| (p.clone(), p)).collect();
    }
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for p in &paths {
        *counts.entry(without_fingerprints(p).into_owned()).or_default() += 1;
    }
    paths
        .into_iter()
        .map(|p| {
            let key = without_fingerprints(&p).into_owned();
            if counts[&key] > 1 { (p.clone(), p) } else { (key, p) }
        })
        .collect()
}

/// `about/index.html` is `/about/`; anything else is its path.
pub fn url_of(path: &str) -> String {
    match path.strip_suffix("index.html") {
        Some(dir) if dir.is_empty() || dir.ends_with('/') => format!("/{}", dir),
        _ => format!("/{}", path),
    }
}

fn is_page(path: &str) -> bool {
    path.ends_with(".html") || path.ends_with(".htm")
}

// ------------------------------------------------------------------- tokens

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct Token {
    tag: bool,
    text: String,
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A tag with its whitespace collapsed, except inside quoted attribute values
/// (`title="pine  cone"` isn't `title="pine cone"`).
fn collapse_tag(tag: &str) -> String {
    let (mut out, mut quote, mut space) = (String::with_capacity(tag.len()), None, false);
    for c in tag.chars() {
        match quote {
            Some(q) => {
                out.push(c);
                if c == q {
                    quote = None;
                }
            }
            None if c.is_whitespace() => space = true,
            None => {
                if space && !out.is_empty() && !matches!(c, '>' | '/') {
                    out.push(' ');
                }
                space = false;
                if c == '"' || c == '\'' {
                    quote = Some(c);
                }
                out.push(c);
            }
        }
    }
    out
}

/// HTML as a list of tags and pieces of text. Whitespace is collapsed, except
/// in elements where it matters, whose content is kept line by line.
fn tokens(html: &str) -> Vec<Token> {
    let bytes = html.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    let mut text_start = 0;
    // Whitespace is collapsed, and dropped next to block tags, where it doesn't show.
    // Next to an inline tag it does (`a <b>b</b>` isn't `a<b>b</b>`), so one space stays.
    let push_text = |out: &mut Vec<Token>, s: &str, next_tag: Option<&str>| {
        let before = s.starts_with(|c: char| c.is_whitespace()) && out.last().is_some_and(|t| t.tag && is_inline(&t.text));
        let after = s.ends_with(|c: char| c.is_whitespace()) && next_tag.is_some_and(is_inline);
        let mut t = collapse(s);
        if t.is_empty() {
            if before && after {
                out.push(Token { tag: false, text: " ".into() });
            }
            return;
        }
        if before {
            t.insert(0, ' ');
        }
        if after {
            t.push(' ');
        }
        out.push(Token { tag: false, text: t });
    };
    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &html[i..];
        let end = if rest.starts_with("<!--") {
            rest.find("-->").map(|e| e + 3)
        } else if rest[1..].starts_with(|c: char| c.is_ascii_alphabetic() || c == '/' || c == '!' || c == '?') {
            tag_end(rest)
        } else {
            None
        };
        let Some(end) = end else {
            i += 1;
            continue;
        };
        let tag = &rest[..end];
        push_text(&mut out, &html[text_start..i], Some(tag));
        out.push(Token { tag: true, text: collapse_tag(tag) });
        i += end;
        text_start = i;
        // Raw content: kept exactly as it is (blank lines, indents), a line at a time. Tags
        // inside <pre> (highlighting spans) are markup like any other, but the diff is easier
        // to read with the line whole.
        let name: String = tag[1..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
        if matches!(name.as_str(), "script" | "style" | "pre" | "textarea") && !tag.ends_with("/>") {
            let close = format!("</{}", name);
            let lower = html[i..].to_ascii_lowercase();
            let len = lower.find(&close).unwrap_or(lower.len());
            let raw = &html[i..i + len];
            // A browser drops the newline right after `<pre>` and `<textarea>`.
            let raw = if matches!(name.as_str(), "pre" | "textarea") { raw.strip_prefix("\r\n").or_else(|| raw.strip_prefix('\n')).unwrap_or(raw) } else { raw };
            if !raw.is_empty() {
                out.extend(raw.split('\n').map(|line| Token { tag: false, text: line.strip_suffix('\r').unwrap_or(line).to_string() }));
            }
            i += len;
            text_start = i;
        }
    }
    push_text(&mut out, &html[text_start..], None);
    out
}

/// The length of the tag at the start of `s` (through its `>`), skipping
/// quoted attribute values.
fn tag_end(s: &str) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (i, b) in s.bytes().enumerate() {
        match (quote, b) {
            (Some(q), b) if b == q => quote = None,
            (Some(_), _) => {}
            (None, b'"') | (None, b'\'') => quote = Some(b),
            (None, b'>') => return Some(i + 1),
            _ => {}
        }
    }
    None
}

static ID_ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\sid=(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap());

fn ids(tokens: &[Token]) -> BTreeSet<String> {
    tokens
        .iter()
        .filter(|t| t.tag)
        .filter_map(|t| ID_ATTR.captures(&t.text))
        .filter_map(|c| c.get(1).or(c.get(2)).or(c.get(3)).map(|m| m.as_str().to_string()))
        .collect()
}

fn title(tokens: &[Token]) -> Option<&str> {
    let i = tokens.iter().position(|t| t.tag && (t.text.eq_ignore_ascii_case("<title>") || t.text.to_ascii_lowercase().starts_with("<title ")))?;
    tokens.get(i + 1).filter(|t| !t.tag).map(|t| t.text.as_str())
}

// ------------------------------------------------------------------ compare

fn hunks<T: std::hash::Hash + Eq + Ord + Clone>(before: &[T], after: &[T], show: impl Fn(&T) -> String) -> (Vec<Hunk>, Vec<(bool, usize)>) {
    let diff = similar::capture_diff_slices(similar::Algorithm::Myers, before, after);
    let mut out = Vec::new();
    // (from the first build?, index) of every changed item, for classifying.
    let mut changed = Vec::new();
    for op in diff {
        let (old, new) = (op.old_range(), op.new_range());
        match op.tag() {
            similar::DiffTag::Equal => continue,
            _ => {
                changed.extend(old.clone().map(|i| (true, i)));
                changed.extend(new.clone().map(|i| (false, i)));
                out.push(Hunk { removed: before[old].iter().map(&show).collect(), added: after[new].iter().map(&show).collect() });
            }
        }
    }
    (out, changed)
}

struct Pair<'a> {
    key: &'a str,
    before: &'a str,
    after: &'a str,
}

fn compare_pair(before_dir: &Path, after_dir: &Path, pair: &Pair, options: &DiffOptions) -> Result<Option<FileDiff>> {
    let read = |dir: &Path, rel: &str| std::fs::read(dir.join(rel)).with_context(|| format!("reading {}", dir.join(rel).display()));
    let (a, b) = (read(before_dir, pair.before)?, read(after_dir, pair.after)?);
    if a == b {
        return Ok(None);
    }
    let mut diff = FileDiff {
        path: pair.key.to_string(),
        url: url_of(pair.key),
        renamed: (pair.before != pair.after).then(|| (pair.before.to_string(), pair.after.to_string())),
        kind: Kind::Binary,
        what: Vec::new(),
        notes: Vec::new(),
        hunks: Vec::new(),
        size_before: a.len() as u64,
        size_after: b.len() as u64,
    };
    let (Ok(a), Ok(b)) = (std::str::from_utf8(&a), std::str::from_utf8(&b)) else { return Ok(Some(diff)) };
    let (a, b) = (normalize(a, options), normalize(b, options));
    if a == b {
        return Ok(None);
    }
    if is_page(pair.key) && !options.exact {
        diff.kind = Kind::Page;
        let (ta, tb) = (tokens(&a), tokens(&b));
        let (found, changed) = hunks(&ta, &tb, |t| t.text.clone());
        if found.is_empty() {
            return Ok(None);
        }
        let is_tag = |&(first, i): &(bool, usize)| if first { ta[i].tag } else { tb[i].tag };
        if changed.iter().any(|c| !is_tag(c)) {
            diff.what.push("text");
        }
        if changed.iter().any(is_tag) {
            diff.what.push("markup");
        }
        if let (Some(old), Some(new)) = (title(&ta), title(&tb)) {
            if old != new {
                diff.notes.push(format!("title: {:?} -> {:?}", old, new));
            }
        }
        let (ids_a, ids_b) = (ids(&ta), ids(&tb));
        let gone: Vec<String> = ids_a.difference(&ids_b).map(|id| format!("#{}", id)).collect();
        if !gone.is_empty() {
            let shown = gone.iter().take(8).cloned().collect::<Vec<_>>().join(", ");
            let more = if gone.len() > 8 { format!(" and {} more", gone.len() - 8) } else { String::new() };
            diff.notes.push(format!("ids removed (links to them break): {}{}", shown, more));
        }
        diff.hunks = found;
    } else {
        diff.kind = if is_page(pair.key) { Kind::Page } else { Kind::Text };
        let (la, lb): (Vec<&str>, Vec<&str>) = (a.lines().collect(), b.lines().collect());
        diff.hunks = hunks(&la, &lb, |l| l.to_string()).0;
        if diff.hunks.is_empty() {
            // Only the line endings at the end of the file.
            diff.hunks.push(Hunk { removed: vec![format!("({} bytes)", a.len())], added: vec![format!("({} bytes)", b.len())] });
        }
    }
    Ok(Some(diff))
}

/// Compare the build in `before` with the one in `after`.
pub fn compare(before: &Path, after: &Path, options: &DiffOptions) -> Result<DiffReport> {
    let keep = |paths: Vec<String>| -> Vec<String> {
        match &options.only {
            Some(set) => paths.into_iter().filter(|p| set.is_match(p)).collect(),
            None => paths,
        }
    };
    let a = keyed(keep(files(before)?), options.exact);
    let b = keyed(keep(files(after)?), options.exact);
    let mut report = DiffReport { before: before.to_path_buf(), after: after.to_path_buf(), exact: options.exact, ..Default::default() };
    report.removed = a.keys().filter(|k| !b.contains_key(*k)).map(|k| url_of(k)).collect();
    report.added = b.keys().filter(|k| !a.contains_key(*k)).map(|k| url_of(k)).collect();
    let pairs: Vec<Pair> = a.iter().filter_map(|(key, before)| b.get(key).map(|after| Pair { key, before, after })).collect();
    let results: Vec<(bool, Option<FileDiff>)> =
        pairs.par_iter().map(|pair| compare_pair(before, after, pair, options).map(|d| (is_page(pair.key), d))).collect::<Result<_>>()?;
    for (page, diff) in results {
        match diff {
            Some(d) => report.changed.push(d),
            None if page => report.unchanged_pages += 1,
            None => report.unchanged_files += 1,
        }
    }
    Ok(report)
}

// ------------------------------------------------------------------- output

fn clip(line: &str) -> String {
    const MAX: usize = 200;
    if line.chars().count() <= MAX {
        return line.to_string();
    }
    let cut: String = line.chars().take(MAX).collect();
    format!("{}… ({} more characters)", cut, line.chars().count() - MAX)
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{} {}", crate::report::count(n), if n == 1 { one } else { many })
}

impl DiffReport {
    /// The report for a terminal. `lines` is how many changed lines to show
    /// for each file (0 for all of them).
    pub fn to_text(&self, lines: usize, color: bool) -> String {
        let paint = |code: &str, s: &str| if color { format!("\x1b[{}m{}\x1b[0m", code, s) } else { s.to_string() };
        let mut out = format!("Comparing {} with {}\n", self.before.display(), self.after.display());
        if self.exact {
            out.push_str("Comparing bytes (--exact).\n");
        } else {
            out.push_str("Ignoring asset fingerprints, integrity hashes, the generator's version, and whitespace between tags (--exact compares bytes).\n");
        }
        let unchanged = format!("{} and {}", plural(self.unchanged_pages, "page", "pages"), plural(self.unchanged_files, "other file", "other files"));
        if self.is_same() {
            out.push_str(&format!("\nNo differences: {} are the same. The stump has not moved.\n", unchanged));
            return out;
        }
        if !self.added.is_empty() {
            out.push_str(&format!("\nAdded ({})\n", self.added.len()));
            for url in &self.added {
                out.push_str(&paint("32", &format!("  + {}\n", url)));
            }
        }
        if !self.removed.is_empty() {
            out.push_str(&format!("\nRemoved ({})\n", self.removed.len()));
            for url in &self.removed {
                out.push_str(&paint("31", &format!("  - {}\n", url)));
            }
        }
        if !self.changed.is_empty() {
            out.push_str(&format!("\nChanged ({})\n", self.changed.len()));
        }
        for file in &self.changed {
            let mut about = Vec::new();
            if !file.what.is_empty() {
                about.push(file.what.join(" and "));
            }
            if let Some((old, new)) = &file.renamed {
                let name = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
                about.push(format!("{} -> {}", name(old), name(new)));
            }
            if file.kind == Kind::Binary {
                about.push(format!("binary, {} -> {}", crate::report::bytes(file.size_before), crate::report::bytes(file.size_after)));
            }
            let about = if about.is_empty() { String::new() } else { format!("  ({})", about.join("; ")) };
            out.push_str(&format!("  ~ {}{}\n", file.url, about));
            for note in &file.notes {
                out.push_str(&format!("      {}\n", note));
            }
            let mut shown = 0;
            let total = file.changed_lines();
            'hunks: for hunk in &file.hunks {
                for (sign, code, side) in [("-", "31", &hunk.removed), ("+", "32", &hunk.added)] {
                    for line in side {
                        if lines > 0 && shown >= lines {
                            break 'hunks;
                        }
                        out.push_str(&paint(code, &format!("      {} {}\n", sign, clip(line))));
                        shown += 1;
                    }
                }
            }
            if total > shown {
                out.push_str(&format!("      ... {} more changed {} (--lines 0 shows all)\n", crate::report::count(total - shown), if total - shown == 1 { "line" } else { "lines" }));
            }
        }
        // How many pages and other files differ, before the detail.
        let page_url = |url: &String| url.ends_with('/') || is_page(url);
        let pages = self.added.iter().chain(&self.removed).filter(|u| page_url(u)).count() + self.changed.iter().filter(|f| is_page(&f.path)).count();
        let others = self.added.len() + self.removed.len() + self.changed.len() - pages;
        let found = match (pages, others) {
            (_, 0) => plural(pages, "page", "pages"),
            (0, _) => plural(others, "other file", "other files"),
            _ => format!("{} and {}", plural(pages, "page", "pages"), plural(others, "other file", "other files")),
        };
        out.push_str(&format!(
            "\nChanges found: {} ({} changed, {} added, {} removed); {} are the same. The stump has moved.\n",
            found,
            crate::report::count(self.changed.len()),
            crate::report::count(self.added.len()),
            crate::report::count(self.removed.len()),
            unchanged
        ));
        out
    }

    /// The report as JSON (`schemaVersion` 1). `lines` caps the changed lines
    /// listed for each file (0 for all); `changedLines` has the full count.
    pub fn to_json(&self, lines: usize) -> serde_json::Value {
        let changed: Vec<serde_json::Value> = self
            .changed
            .iter()
            .map(|f| {
                let mut left = if lines == 0 { usize::MAX } else { lines };
                let mut hunks = Vec::new();
                for h in &f.hunks {
                    if left == 0 {
                        break;
                    }
                    let removed: Vec<&String> = h.removed.iter().take(left).collect();
                    left -= removed.len();
                    let added: Vec<&String> = h.added.iter().take(left).collect();
                    left -= added.len();
                    hunks.push(serde_json::json!({ "removed": removed, "added": added }));
                }
                let mut entry = serde_json::json!({
                    "url": f.url,
                    "path": f.path,
                    "kind": f.kind.as_str(),
                    "changes": f.what,
                    "notes": f.notes,
                    "changedLines": f.changed_lines(),
                    "sizeBefore": f.size_before,
                    "sizeAfter": f.size_after,
                    "hunks": hunks,
                });
                if let Some((old, new)) = &f.renamed {
                    entry["renamed"] = serde_json::json!({ "before": old, "after": new });
                }
                entry
            })
            .collect();
        serde_json::json!({
            "schemaVersion": 1,
            "before": crate::slashes(&self.before),
            "after": crate::slashes(&self.after),
            "exact": self.exact,
            "same": self.is_same(),
            "summary": {
                "added": self.added.len(),
                "removed": self.removed.len(),
                "changed": self.changed.len(),
                "unchangedPages": self.unchanged_pages,
                "unchangedFiles": self.unchanged_files,
            },
            "added": self.added,
            "removed": self.removed,
            "changed": changed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ssqch-diff-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, text) in files {
            let path = dir.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        dir
    }

    #[test]
    fn html_is_compared_as_tags_and_text() {
        let t = tokens("<p class=\"a\">Hello\n   <b>big</b> world</p>\n<pre>  keep\n    this</pre><!-- c --><script>let a = '<p>';</script>");
        let texts: Vec<(bool, &str)> = t.iter().map(|t| (t.tag, t.text.as_str())).collect();
        assert_eq!(
            texts,
            [
                (true, "<p class=\"a\">"),
                (false, "Hello "),
                (true, "<b>"),
                (false, "big"),
                (true, "</b>"),
                (false, " world"),
                (true, "</p>"),
                (true, "<pre>"),
                (false, "  keep"),
                (false, "    this"),
                (true, "</pre>"),
                (true, "<!-- c -->"),
                (true, "<script>"),
                (false, "let a = '<p>';"),
                (true, "</script>"),
            ]
        );
    }

    #[test]
    fn spaces_that_show_and_names_with_dates_count() {
        let texts = |html: &str| tokens(html).into_iter().map(|t| t.text).collect::<Vec<_>>();
        // A space next to an inline tag is visible; between block tags it isn't.
        assert_ne!(texts("<p>a<b>b</b></p>"), texts("<p>a <b>b</b></p>"));
        assert_ne!(texts("<a>x</a><a>y</a>"), texts("<a>x</a> <a>y</a>"));
        assert_eq!(texts("<div><p>a</p><p>b</p></div>"), texts("<div>\n  <p>a</p>\n  <p>\n    b\n  </p>\n</div>\n"));
        // Whitespace that shows: in a field's value, a <pre>'s blank line, an attribute's value.
        assert_ne!(texts("<textarea>  pine</textarea>"), texts("<textarea>pine</textarea>"));
        assert_ne!(texts("<pre>pine\n\ncone</pre>"), texts("<pre>pine\ncone</pre>"));
        assert_ne!(texts("<p title=\"pine  cone\">Trail</p>"), texts("<p title=\"pine cone\">Trail</p>"));
        // Whitespace between attributes doesn't, and neither does the newline after <pre>.
        assert_eq!(texts("<p  class=\"a\"\n   id=\"b\" >x</p><br />"), texts("<p class=\"a\" id=\"b\">x</p><br/>"));
        assert_eq!(texts("<pre>\npine</pre>"), texts("<pre>pine</pre>"));
        // A fingerprint goes; a date in a file's name stays.
        assert_eq!(without_fingerprints("/assets/index.3f2a1b4c.css /a/app.00112233.js"), "/assets/index.css /a/app.js");
        assert_eq!(without_fingerprints("/files/report.20240101.pdf /files/notes.19991231.txt"), "/files/report.20240101.pdf /files/notes.19991231.txt");
    }

    #[test]
    fn noise_is_ignored_and_changes_are_classified() {
        let page = |css: &str, body: &str| format!("<html><head><title>T</title><meta name=\"generator\" content=\"SiteSquatch v{}\"><link rel=\"stylesheet\" href=\"/assets/index.{}.css\" integrity=\"sha384-{}\"></head><body>{}</body></html>", css.len(), css, css, body);
        let before = build(
            "before",
            &[
                ("index.html", &page("11111111", "<h2 id=\"team\">Team</h2><p>Old   text</p>")),
                ("same/index.html", &page("11111111", "<p>Same</p>")),
                ("markup/index.html", &page("11111111", "<p>Words</p>")),
                ("old/index.html", "<p>bye</p>"),
                ("assets/index.11111111.css", "body { color: red }\n"),
                ("assets/font.woff2", "\u{0}\u{1}"),
                ("feed.xml", "<rss>1</rss>\n"),
            ],
        );
        let after = build(
            "after",
            &[
                ("index.html", &page("22222222", "<h2>Team</h2>\n<p>New text</p>")),
                ("same/index.html", &page("22222222", "\n  <p>Same</p>\n")),
                ("markup/index.html", &page("22222222", "<p class=\"lead\">Words</p>")),
                ("new/index.html", "<p>hi</p>"),
                ("assets/index.22222222.css", "body { color: blue }\n"),
                ("assets/font.woff2", "\u{0}\u{1}"),
                ("feed.xml", "<rss>1</rss>\n"),
            ],
        );
        let report = compare(&before, &after, &DiffOptions::default()).unwrap();
        assert_eq!(report.added, ["/new/"]);
        assert_eq!(report.removed, ["/old/"]);
        assert_eq!((report.unchanged_pages, report.unchanged_files), (1, 2));
        let by_url = |url: &str| report.changed.iter().find(|f| f.url == url).unwrap_or_else(|| panic!("{} not in {:?}", url, report.changed));
        let home = by_url("/");
        assert_eq!(home.what, ["text", "markup"]);
        assert_eq!(home.notes, ["ids removed (links to them break): #team"]);
        assert_eq!(home.hunks, [Hunk { removed: vec!["<h2 id=\"team\">".into()], added: vec!["<h2>".into()] }, Hunk { removed: vec!["Old text".into()], added: vec!["New text".into()] }]);
        assert_eq!(by_url("/markup/").what, ["markup"]);
        let css = by_url("/assets/index.css");
        assert_eq!(css.renamed, Some(("assets/index.11111111.css".into(), "assets/index.22222222.css".into())));
        assert_eq!(css.hunks, [Hunk { removed: vec!["body { color: red }".into()], added: vec!["body { color: blue }".into()] }]);
        assert_eq!(report.changed.len(), 3);

        let text = report.to_text(10, false);
        assert!(text.contains("  ~ /  (text and markup)\n      ids removed (links to them break): #team\n      - <h2 id=\"team\">\n      + <h2>\n      - Old text\n      + New text\n"), "{}", text);
        assert!(text.contains("  ~ /assets/index.css  (index.11111111.css -> index.22222222.css)"), "{}", text);
        assert!(text.ends_with("Changes found: 4 pages and 1 other file (3 changed, 1 added, 1 removed); 1 page and 2 other files are the same. The stump has moved.\n"), "{}", text);
        let json = report.to_json(1);
        assert_eq!(json["same"], false);
        assert_eq!(json["summary"]["changed"], 3);
        let home = json["changed"].as_array().unwrap().iter().find(|f| f["url"] == "/").unwrap();
        assert_eq!(home["changedLines"], 4);
        assert_eq!(home["hunks"].as_array().unwrap().len(), 1);

        // --exact: fingerprints are different files, and every byte counts.
        let exact = compare(&before, &after, &DiffOptions { exact: true, ..Default::default() }).unwrap();
        assert!(exact.added.contains(&"/assets/index.22222222.css".to_string()) && exact.removed.contains(&"/assets/index.11111111.css".to_string()));
        assert!(exact.changed.iter().any(|f| f.url == "/same/"));

        // An ignore pattern, and only some files.
        let options = DiffOptions { ignore: vec![Regex::new(r"(Old|New)\s+text").unwrap()], only: Some(globset::GlobSetBuilder::new().add(globset::Glob::new("index.html").unwrap()).build().unwrap()), ..Default::default() };
        let report = compare(&before, &after, &options).unwrap();
        assert_eq!(report.changed.len(), 1);
        assert_eq!(report.changed[0].what, ["markup"]);
        assert!(report.added.is_empty() && report.removed.is_empty());

        assert!(compare(&before, &before, &DiffOptions::default()).unwrap().is_same());
        assert!(compare(&before.join("nope"), &after, &DiffOptions::default()).is_err());
    }
}
