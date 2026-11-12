//! `ssqch new`: a new page from a blueprint.
//!
//! A blueprint is a page to start from: a file in `_blueprints/` in the
//! input folder (or a theme's), named after the folder its pages go in.
//! `ssqch new posts/pine.md` copies `_blueprints/posts.md` (or
//! `_blueprints/default.md`, or a title and a date when there's neither)
//! and fills in its front matter: the `title`, the `date` when the
//! blueprint has that key, and anything given with `--set`.
//!
//! A blueprint isn't a template. Its body is copied as it is, so it can
//! hold `{{ }}` for the page itself, and only front matter keys are filled
//! in: there's no second template syntax to learn or to clash with.
//!
//! Given a folder and a title (`ssqch new posts --title "Pine cones"`), the
//! file is named as the folder's other pages are: with the date in front
//! when most of them have one, and as `pine-cones/index.md` when most are
//! folders with an index file.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use regex::Regex;

use crate::build::slashes;
use crate::config::{BuildContext, Config};

/// What to create.
#[derive(Debug, Clone, Default)]
pub struct NewOptions {
    /// The new file, from the input folder (`posts/pine.md`), or the folder
    /// it goes in (`posts`), with a `title` to name it after.
    pub path: String,
    pub title: Option<String>,
    /// The page's date, as it's written in front matter (default: today).
    pub date: Option<String>,
    /// The blueprint's name (default: the page's folders, then `default`).
    pub blueprint: Option<String>,
    /// More front matter: each key and the value as it's written (`draft`, `true`).
    pub set: Vec<(String, String)>,
}

/// What was created.
#[derive(Debug, Clone)]
pub struct Created {
    pub path: PathBuf,
    /// The blueprint it came from; `None` for the built-in one.
    pub blueprint: Option<PathBuf>,
    pub title: String,
    pub date: String,
}

/// Lowercase letters and digits, with a dash for each run of anything else.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
        } else if c != '\'' && c != '\u{2019}' && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// `pine-cone_crunch` as a title: "Pine cone crunch".
fn title_from(slug: &str) -> String {
    let words = slug.replace(['-', '_'], " ");
    let mut chars = words.trim().chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn date_prefix() -> Regex {
    Regex::new(r"^\d{4}-\d{2}-\d{2}-").unwrap()
}

/// The template files in `dir`, and the folders in it with an index file.
fn pages_in(cfg: &Config, dir: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let is_page = |path: &Path| path.extension().is_some_and(|e| cfg.template_formats.iter().any(|f| f.eq_ignore_ascii_case(&e.to_string_lossy())));
    let (mut files, mut folders) = (Vec::new(), Vec::new());
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(['.', '_']) {
            continue;
        }
        if path.is_dir() {
            let index = std::fs::read_dir(&path).into_iter().flatten().flatten().map(|e| e.path()).find(|p| p.file_stem().is_some_and(|s| s == "index") && is_page(p));
            folders.extend(index);
        } else if is_page(&path) && path.file_stem().is_some_and(|s| s != "index") {
            files.push(path);
        }
    }
    (files, folders)
}

/// The blueprint for a page in `folders` (`docs/guides`), with `ext` when
/// there's a choice: the most specific folder's, then `default`.
fn find_blueprint(ctx: &BuildContext, named: Option<&str>, folders: &str, ext: Option<&str>) -> Result<Option<PathBuf>> {
    let dirs: Vec<PathBuf> = std::iter::once(ctx.input_dir.join("_blueprints")).chain(ctx.theme_dirs.iter().map(|t| t.join("_blueprints"))).collect();
    let mut names: Vec<String> = Vec::new();
    match named {
        Some(name) => names.push(name.trim_matches('/').to_string()),
        None => {
            let mut rest = folders.trim_matches('/');
            while !rest.is_empty() {
                names.push(rest.to_string());
                rest = rest.rsplit_once('/').map(|(up, _)| up).unwrap_or("");
            }
            names.push("default".into());
        }
    }
    for name in &names {
        for dir in &dirs {
            let at = dir.join(name);
            let Some(parent) = at.parent() else { continue };
            let stem = at.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let mut found: Vec<PathBuf> = std::fs::read_dir(parent).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_file() && p.file_stem().is_some_and(|s| s.to_string_lossy() == stem)).collect();
            found.sort();
            let wanted = found.iter().find(|p| ext.is_some_and(|e| p.extension().is_some_and(|x| x.to_string_lossy().eq_ignore_ascii_case(e))));
            if let Some(path) = wanted.or(found.first()) {
                return Ok(Some(path.clone()));
            }
        }
    }
    if let Some(name) = named {
        let mut have: Vec<String> = Vec::new();
        for dir in &dirs {
            for entry in walkdir::WalkDir::new(dir).into_iter().flatten().filter(|e| e.file_type().is_file()) {
                have.push(slashes(&entry.path().strip_prefix(dir).unwrap_or(entry.path()).with_extension("")));
            }
        }
        have.sort();
        have.dedup();
        let shown = slashes(dirs[0].strip_prefix(&ctx.root).unwrap_or(&dirs[0]));
        bail!("no blueprint named {:?} in {}/ ({})", name, shown, if have.is_empty() { "there are none".to_string() } else { format!("there's {}", have.join(", ")) });
    }
    Ok(None)
}

/// A string as a YAML value: as it is when that's safe, quoted when not.
fn yaml_string(text: &str) -> String {
    let plain = Regex::new(r"^[\p{L}][\p{L}\p{N} _.,'()!?&/+-]*$").unwrap();
    let word = matches!(text.to_ascii_lowercase().as_str(), "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "y" | "n");
    if plain.is_match(text) && !word && !text.ends_with(' ') && !text.contains(" -") {
        text.to_string()
    } else {
        // A JSON string is a YAML one too.
        serde_json::Value::from(text).to_string()
    }
}

/// How a front matter block is written.
#[derive(Clone, Copy, PartialEq)]
enum Format {
    Yaml,
    Toml,
    Json,
}

/// A value for a key: text (quoted as the format needs), or written as given.
enum Fill<'a> {
    Text(&'a str),
    Raw(&'a str),
}

/// Set top-level keys in a page's front matter, keeping everything else
/// (comments, the order, the body) as it is. A key that isn't there is
/// added: at the top when `first`, else at the end.
fn fill_front_matter(source: &str, fills: &[(&str, Fill, bool)]) -> Result<String> {
    let newline = if source.contains("\r\n") { "\r\n" } else { "\n" };
    let first_line = source.lines().next().unwrap_or("");
    let (format, fence) = match first_line.trim_end() {
        "+++" => (Format::Toml, "+++"),
        "---toml" => (Format::Toml, "---"),
        "---json" => (Format::Json, "---"),
        "---" | "---yaml" | "---yml" => (Format::Yaml, "---"),
        // No front matter: give it one.
        _ => return fill_front_matter(&format!("---{0}---{0}{1}", newline, source), fills),
    };
    let mut lines: Vec<String> = source.split_inclusive('\n').map(String::from).collect();
    let Some(close) = lines.iter().skip(1).position(|l| l.trim_end() == fence).map(|i| i + 1) else { bail!("its front matter is missing the closing `{}`", fence) };

    if format == Format::Json {
        let text: String = lines[1..close].concat();
        let mut data: serde_json::Value = serde_json::from_str(if text.trim().is_empty() { "{}" } else { &text }).context("its JSON front matter doesn't parse")?;
        let Some(map) = data.as_object_mut() else { bail!("its JSON front matter isn't an object") };
        for (key, fill, _) in fills {
            let value = match fill {
                Fill::Text(text) => serde_json::Value::from(*text),
                Fill::Raw(raw) => serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::from(*raw)),
            };
            map.insert(key.to_string(), value);
        }
        let written = format!("{}{}", serde_json::to_string_pretty(&data)?.replace('\n', newline), newline);
        lines.splice(1..close, [written]);
        return Ok(lines.concat());
    }

    let written = |key: &str, fill: &Fill| -> String {
        let value = match (fill, format) {
            (Fill::Raw(raw), _) => raw.to_string(),
            (Fill::Text(text), Format::Yaml) => yaml_string(text),
            (Fill::Text(text), _) => serde_json::Value::from(*text).to_string(),
        };
        let separator = if format == Format::Toml { " = " } else { ": " };
        format!("{}{}{}{}", key, separator, value, newline)
    };
    let mut close = close;
    let mut at_top = 1;
    for (key, fill, first) in fills {
        let starts = |line: &str| {
            let line = line.trim_start_matches([' ', '\t']);
            let rest = line.strip_prefix(key).or_else(|| line.strip_prefix(&format!("\"{}\"", key)));
            rest.is_some_and(|r| r.trim_start().starts_with(if format == Format::Toml { '=' } else { ':' }))
        };
        if format == Format::Toml {
            // Only the keys above the first table are the page's own: `draft` under `[extra]` isn't.
            let (entries, root_end) = toml_entries(&lines, close);
            let line = match entries.iter().find(|(at, _)| starts(&lines[*at])) {
                Some(&(at, end)) => {
                    lines.splice(at..end, [written(key, fill)]);
                    close -= end - at - 1;
                    continue;
                }
                None if *first => at_top,
                None => entries.last().map(|&(_, end)| end).unwrap_or_else(|| {
                    let mut at = root_end;
                    while at > 1 && lines[at - 1].trim().is_empty() {
                        at -= 1;
                    }
                    at
                }),
            };
            if *first {
                at_top += 1;
            }
            lines.insert(line, written(key, fill));
            close += 1;
            continue;
        }
        match lines[1..close].iter().position(|l| !l.starts_with([' ', '\t']) && starts(l)).map(|i| i + 1) {
            Some(at) => {
                // The lines of a value that goes on below its key (a YAML block, a TOML multi-line string's rest).
                let mut end = at + 1;
                while end < close && format == Format::Yaml && (lines[end].starts_with([' ', '\t']) || lines[end].starts_with("- ")) {
                    end += 1;
                }
                lines.splice(at..end, [written(key, fill)]);
                close -= end - at - 1;
            }
            None if *first => {
                lines.insert(at_top, written(key, fill));
                at_top += 1;
                close += 1;
            }
            None => {
                // After the last line that isn't blank.
                let mut at = close;
                while at > 1 && lines[at - 1].trim().is_empty() {
                    at -= 1;
                }
                lines.insert(at, written(key, fill));
                close += 1;
            }
        }
    }
    Ok(lines.concat())
}

/// TOML front matter's top-level entries, as the lines each takes (`start..end`: a multi-line
/// array or string takes several), and the line the first table (`[extra]`) starts on, or
/// `close`.
fn toml_entries(lines: &[String], close: usize) -> (Vec<(usize, usize)>, usize) {
    let (mut entries, mut depth, mut multi, mut start) = (Vec::new(), 0i32, None::<&[u8]>, None);
    for (i, line) in lines.iter().enumerate().take(close).skip(1) {
        if depth == 0 && multi.is_none() {
            let text = line.trim_start();
            if text.starts_with('[') {
                return (entries, i);
            }
            if !text.is_empty() && !text.starts_with('#') {
                start = Some(i);
            }
        }
        let b = line.as_bytes();
        let mut j = 0;
        while j < b.len() {
            if let Some(end) = multi {
                if b[j..].starts_with(end) {
                    multi = None;
                    j += 3;
                } else {
                    j += if end == b"\"\"\"" && b[j] == b'\\' { 2 } else { 1 };
                }
                continue;
            }
            match b[j] {
                b'#' => break,
                q @ (b'"' | b'\'') => {
                    let triple: &[u8] = if q == b'"' { b"\"\"\"" } else { b"'''" };
                    if b[j..].starts_with(triple) {
                        multi = Some(triple);
                        j += 3;
                        continue;
                    }
                    j += 1;
                    while j < b.len() && b[j] != q {
                        j += if q == b'"' && b[j] == b'\\' { 2 } else { 1 };
                    }
                }
                b'[' | b'{' => depth += 1,
                b']' | b'}' => depth -= 1,
                _ => {}
            }
            j += 1;
        }
        if depth <= 0 && multi.is_none() {
            depth = 0;
            if let Some(at) = start.take() {
                entries.push((at, i + 1));
            }
        }
    }
    (entries, close)
}

/// Whether the blueprint's front matter has `key` (so it's filled in).
fn has_key(source: &str, key: &str) -> bool {
    crate::data::parse_front_matter(source).map(|(data, _)| data.contains_key(key)).unwrap_or(false)
}

/// Create the page `options` describe. Nothing is overwritten.
pub fn new_page(cfg: &Config, options: &NewOptions) -> Result<Created> {
    let ctx = cfg.build_context();
    let given = options.path.replace('\\', "/");
    let given = given.trim_start_matches("./");
    if given.is_empty() {
        bail!("give the new page's path, like posts/pine-cones.md");
    }
    // From the input folder, or from the project root when that lands in it.
    let input = dunce::canonicalize(&ctx.input_dir).with_context(|| format!("input directory {} does not exist", ctx.input_dir.display()))?;
    let root = dunce::canonicalize(&ctx.root).unwrap_or_else(|_| ctx.root.clone());
    let clean = |base: &Path| -> Option<PathBuf> {
        let mut out = base.to_path_buf();
        for part in Path::new(given).components() {
            match part {
                std::path::Component::Normal(name) => out.push(name),
                std::path::Component::CurDir => {}
                _ => return None,
            }
        }
        Some(out)
    };
    let Some(from_input) = clean(&input) else { bail!("{}: a new page goes in the input folder ({}/), so give a path from there", options.path, slashes(input.strip_prefix(&root).unwrap_or(&input))) };
    let target = match clean(&root) {
        Some(from_root) if input != root && from_root.starts_with(&input) => from_root,
        _ => from_input,
    };
    let rel = slashes(target.strip_prefix(&input).unwrap_or(&target));
    if rel.split('/').next().is_some_and(|first| first.starts_with('_')) {
        bail!("{}: {}/ isn't a folder for pages", options.path, rel.split('/').next().unwrap_or(""));
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let date = options.date.clone().unwrap_or(today);
    let is_folder = given.ends_with('/') || target.is_dir() || target.extension().is_none();
    let (path, blueprint, title) = if is_folder {
        let Some(title) = options.title.clone().filter(|t| !t.trim().is_empty()) else {
            bail!("{} is a folder, so give the page a title to name its file after: ssqch new {} --title \"Pine cones\"", options.path, options.path.trim_end_matches('/'))
        };
        let name = slug(&title);
        if name.is_empty() {
            bail!("--title {:?} has no letters or digits to name the file after", title);
        }
        let blueprint = find_blueprint(&ctx, options.blueprint.as_deref(), &rel, None)?;
        // Named as the folder's other pages are.
        let (files, folders) = pages_in(cfg, &target);
        let ext = |path: &PathBuf| path.extension().map(|e| e.to_string_lossy().to_string());
        // The blueprint's extension, or the one most of the folder's pages have.
        let mut counts: Vec<(usize, String)> = Vec::new();
        for found in files.iter().chain(&folders).filter_map(ext) {
            match counts.iter_mut().find(|(_, e)| *e == found) {
                Some((n, _)) => *n += 1,
                None => counts.push((1, found)),
            }
        }
        counts.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        let ext = blueprint.as_ref().and_then(ext).or_else(|| counts.first().map(|(_, e)| e.clone())).unwrap_or_else(|| "md".into());
        let dated = files.iter().chain(&folders).filter(|p| if p.file_stem().is_some_and(|s| s == "index") { p.parent().and_then(|d| d.file_name()) } else { p.file_name() }.is_some_and(|n| date_prefix().is_match(&n.to_string_lossy()))).count();
        let stem = if dated * 2 > files.len() + folders.len() && date_prefix().is_match(&format!("{}-", date.get(..10).unwrap_or(""))) { format!("{}-{}", &date[..10], name) } else { name };
        let path = if folders.len() > files.len() { target.join(&stem).join(format!("index.{}", ext)) } else { target.join(format!("{}.{}", stem, ext)) };
        (path, blueprint, title)
    } else {
        let folders = rel.rsplit_once('/').map(|(folders, _)| folders).unwrap_or("");
        let ext = target.extension().map(|e| e.to_string_lossy().to_string());
        let stem = target.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        // `pine/index.md` is named by its folder, and for the blueprint it's a page of the folder above.
        let (name, folders) = if stem == "index" { (folders.rsplit('/').next().unwrap_or("").to_string(), folders.rsplit_once('/').map(|(up, _)| up).unwrap_or("")) } else { (stem, folders) };
        let blueprint = find_blueprint(&ctx, options.blueprint.as_deref(), folders, ext.as_deref())?;
        let title = options.title.clone().unwrap_or_else(|| title_from(&date_prefix().replace(&name, "")));
        (target.clone(), blueprint, title)
    };
    if path.exists() {
        bail!("{} is already there", slashes(path.strip_prefix(&root).unwrap_or(&path)));
    }

    let source = match &blueprint {
        Some(file) => std::fs::read_to_string(file).with_context(|| format!("reading {}", file.display()))?,
        None => "---\ntitle:\ndate:\n---\n\n".to_string(),
    };
    let mut fills: Vec<(&str, Fill, bool)> = vec![("title", Fill::Text(&title), true)];
    // A date only where the blueprint asks for one: a page whose file name has the date doesn't need it.
    if has_key(&source, "date") || options.date.is_some() {
        fills.push(("date", Fill::Raw(&date), false));
    }
    for (key, value) in &options.set {
        if key.is_empty() || key.contains(['.', ':', '=', ' ']) {
            bail!("--set {}={}: the key is one front matter key, like draft=true", key, value);
        }
        fills.push((key, Fill::Raw(value), false));
    }
    let shown = |p: &Path| slashes(p.strip_prefix(&root).unwrap_or(p));
    let text = fill_front_matter(&source, &fills).with_context(|| match &blueprint {
        Some(file) => format!("in {}", shown(&dunce::canonicalize(file).unwrap_or_else(|_| file.clone()))),
        None => "in the built-in blueprint".to_string(),
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))?;
    Ok(Created { path, blueprint: blueprint.map(|a| dunce::canonicalize(&a).unwrap_or(a)), title, date })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_titles() {
        assert_eq!(slug("Pine Cone Crunch!"), "pine-cone-crunch");
        assert_eq!(slug("  What's new in 0.4?  "), "whats-new-in-0-4");
        assert_eq!(slug("Crème brûlée & café"), "crème-brûlée-café");
        assert_eq!(slug("!!!"), "");
        assert_eq!(title_from("pine-cone_crunch"), "Pine cone crunch");
        assert_eq!(yaml_string("Pine cone crunch"), "Pine cone crunch");
        for (text, written) in [("Pines: a guide", "\"Pines: a guide\""), ("true", "\"true\""), ("2024 in review", "\"2024 in review\""), ("Say \"hi\"", "\"Say \\\"hi\\\"\""), ("#1 tip", "\"#1 tip\""), ("A - B", "\"A - B\"")] {
            assert_eq!(yaml_string(text), written);
        }
    }

    #[test]
    fn front_matter_is_filled_in_place() {
        let fill = |source: &str| fill_front_matter(source, &[("title", Fill::Text("Pines: a guide"), true), ("date", Fill::Raw("2026-03-02"), false), ("draft", Fill::Raw("true"), false)]).unwrap();
        // YAML: the keys that are there keep their place, comments stay, new ones are added.
        assert_eq!(
            fill("---\n# A guide.\nlayout: guide.edge\ntitle:\ntags:\n  - guides\n  - draft\ndate: 2020-01-01 # filled in\n---\n\n# {{ title }}\n"),
            "---\n# A guide.\nlayout: guide.edge\ntitle: \"Pines: a guide\"\ntags:\n  - guides\n  - draft\ndate: 2026-03-02\ndraft: true\n---\n\n# {{ title }}\n"
        );
        // A value over several lines is replaced whole.
        assert_eq!(fill("---\ntitle: >\n  An old\n  title\ndate:\n\n---\nBody\n"), "---\ntitle: \"Pines: a guide\"\ndate: 2026-03-02\ndraft: true\n\n---\nBody\n");
        // Without the keys, and without front matter.
        assert_eq!(fill("---\nlayout: a.edge\n---\nBody\n"), "---\ntitle: \"Pines: a guide\"\nlayout: a.edge\ndate: 2026-03-02\ndraft: true\n---\nBody\n");
        assert_eq!(fill("Just a body\n"), "---\ntitle: \"Pines: a guide\"\ndate: 2026-03-02\ndraft: true\n---\nJust a body\n");
        // TOML and JSON.
        assert_eq!(fill("+++\ntitle = \"\"\nweight = 3\n+++\nBody\n"), "+++\ntitle = \"Pines: a guide\"\nweight = 3\ndate = 2026-03-02\ndraft = true\n+++\nBody\n");
        // Keys are the page's own, above its tables: one missing goes before `[extra]`, and a
        // table's key of the same name stays the table's.
        assert_eq!(
            fill("+++\ntitle = \"New post\"\n[extra]\nanimal = \"owl\"\ndraft = false\n+++\n\n# Trail\n"),
            "+++\ntitle = \"Pines: a guide\"\ndate = 2026-03-02\ndraft = true\n[extra]\nanimal = \"owl\"\ndraft = false\n+++\n\n# Trail\n"
        );
        // A value over several lines is replaced whole, and brackets in strings aren't tables.
        assert_eq!(
            fill("+++\ntags = [\n  \"a\",\n  \"[b]\",\n]\ndraft = \"\"\"\n[x]\n\"\"\"\n# pine\n\n[[cones]]\nn = 1\n+++\n"),
            "+++\ntitle = \"Pines: a guide\"\ntags = [\n  \"a\",\n  \"[b]\",\n]\ndraft = true\ndate = 2026-03-02\n# pine\n\n[[cones]]\nn = 1\n+++\n"
        );
        assert_eq!(fill("---json\n{ \"layout\": \"a.edge\", \"title\": \"\" }\n---\nBody\n"), "---json\n{\n  \"layout\": \"a.edge\",\n  \"title\": \"Pines: a guide\",\n  \"date\": \"2026-03-02\",\n  \"draft\": true\n}\n---\nBody\n");
        // Windows line endings stay.
        assert_eq!(fill("---\r\ntitle:\r\n---\r\nBody\r\n"), "---\r\ntitle: \"Pines: a guide\"\r\ndate: 2026-03-02\r\ndraft: true\r\n---\r\nBody\r\n");
        assert!(fill_front_matter("---\ntitle:\nBody\n", &[]).unwrap_err().to_string().contains("missing the closing `---`"));
    }
}
