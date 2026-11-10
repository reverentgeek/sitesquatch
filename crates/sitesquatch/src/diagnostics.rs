//! Warnings and errors as data, for `ssqch build --format json`.
//!
//! A build prints its warnings (`warn: ...`) and returns its error as text.
//! A script or a coding agent wants the same things with their parts apart:
//! a code, the file, the line when it's known, and the field for a content
//! error. [`warn`] is how the build and its plugins report a warning,
//! [`Diagnostics`] is an error that keeps its problems apart, and
//! [`from_error`] turns any build error into a list.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use regex::Regex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Warning,
    Error,
}

/// One problem. The codes: `config`, `data`, `front-matter`, `template`,
/// `schema`, `conflict`, `links`, `images`, `assets`, `fetch`,
/// `passthrough`, `last-modified`, `hook` and `build` (anything else).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: String,
    /// What a person reads; it names the file too.
    pub message: String,
    /// From the project root, with forward slashes.
    pub file: Option<String>,
    /// A line of `file`, from 1.
    pub line: Option<usize>,
    /// The field of the page's data (a schema problem).
    pub field: Option<String>,
    /// The page's URL, when the problem is in what was written (a broken link).
    pub url: Option<String>,
}

impl Diagnostic {
    pub fn warning(code: &str, message: impl Into<String>) -> Self {
        Diagnostic { severity: Severity::Warning, code: code.into(), message: message.into(), file: None, line: None, field: None, url: None }
    }

    pub fn error(code: &str, message: impl Into<String>) -> Self {
        Diagnostic { severity: Severity::Error, ..Self::warning(code, message) }
    }

    pub fn file(mut self, file: impl Into<String>) -> Self {
        self.file = Some(file.into().replace('\\', "/").trim_start_matches("./").to_string());
        self
    }

    pub fn line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }

    pub fn field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    pub fn url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    /// `code` and `message` always; the rest when known.
    pub fn to_json(&self) -> serde_json::Value {
        let mut out = serde_json::json!({ "code": self.code, "message": self.message });
        if let Some(file) = &self.file {
            out["file"] = file.as_str().into();
        }
        if let Some(line) = self.line {
            out["line"] = line.into();
        }
        if let Some(field) = &self.field {
            out["field"] = field.as_str().into();
        }
        if let Some(url) = &self.url {
            out["url"] = url.as_str().into();
        }
        out
    }
}

/// An error made of several problems. It prints as `message`, which lists
/// them the way the build always has.
#[derive(Debug)]
pub struct Diagnostics {
    pub message: String,
    pub items: Vec<Diagnostic>,
}

impl std::fmt::Display for Diagnostics {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Diagnostics {}

static CAPTURING: AtomicBool = AtomicBool::new(false);
static WARNINGS: Mutex<Vec<Diagnostic>> = Mutex::new(Vec::new());

/// Keep warnings for [`take_warnings`] instead of printing them, and leave
/// standard output to the report: progress lines go to standard error.
pub fn capture() {
    CAPTURING.store(true, Ordering::SeqCst);
}

pub fn capturing() -> bool {
    CAPTURING.load(Ordering::SeqCst)
}

/// The warnings since [`capture`] (or the last call).
pub fn take_warnings() -> Vec<Diagnostic> {
    std::mem::take(&mut *WARNINGS.lock().unwrap())
}

/// Report a warning: printed as `warn: <message>`, or kept when capturing.
pub fn warn(diagnostic: Diagnostic) {
    if capturing() {
        WARNINGS.lock().unwrap().push(diagnostic);
    } else {
        eprintln!("warn: {}", diagnostic.message);
    }
}

/// A line of progress (`[ssqch] Writing ...`): standard output, or standard
/// error when that's kept for a JSON report.
pub fn progress(line: &str) {
    if capturing() {
        eprintln!("{}", line);
    } else {
        println!("{}", line);
    }
}

/// `label` (`error:`) in red, when standard error is a terminal that takes
/// colour. A log file or a CI job gets the plain word, and so does anyone who
/// sets `NO_COLOR`; `FORCE_COLOR` is for a pager that understands the codes.
pub fn red(label: &str) -> String {
    use std::io::IsTerminal;
    let set = |name: &str| std::env::var_os(name).is_some_and(|v| !v.is_empty());
    let colour = !set("NO_COLOR") && (set("FORCE_COLOR") || (std::io::stderr().is_terminal() && std::env::var("TERM").map_or(true, |term| term != "dumb")));
    if colour { format!("\x1b[31m{}\x1b[0m", label) } else { label.to_string() }
}

/// An error as a person reads it: its message, then the lines it's about
/// ([`frames`]), when they can be found.
pub fn describe(error: &anyhow::Error, fallback: &str, at: &Locator) -> String {
    let message = format!("{:#}", error);
    match frames(error, fallback, at) {
        Some(lines) => format!("{}\n\n{}", message, lines),
        None => message,
    }
}

/// Print [`describe`] after a red `label` on standard error.
pub fn print_error(label: &str, error: &anyhow::Error, fallback: &str, at: &Locator) {
    eprintln!("{} {}", red(label), describe(error, fallback, at));
}

/// The lines an error points at, for up to three of its problems:
///
/// ```text
///   --> src/index.edge:7
///    5 | <h1>Guides</h1>
///    6 | <ul>
///    7 |   <li>{{ guide.data.name.toUpperCase() }}</li>
///      |          ^^^^^^^^^^^^^^^
///    8 | </ul>
/// ```
///
/// The line is the file's own (a template engine counts from the end of the
/// front matter). The carets go under the part of the line that the message
/// quotes, when it quotes one; a schema problem points at its field.
pub fn frames(error: &anyhow::Error, fallback: &str, at: &Locator) -> Option<String> {
    let found: Vec<String> = from_error(error, fallback, at).iter().filter_map(|problem| frame(problem, at)).take(3).collect();
    (!found.is_empty()).then(|| found.join("\n\n"))
}

fn frame(problem: &Diagnostic, at: &Locator) -> Option<String> {
    const WIDEST: usize = 160;
    let file = problem.file.as_ref()?;
    let source = std::fs::read_to_string(at.root.join(file)).ok()?;
    let lines: Vec<&str> = source.lines().collect();
    let number = match (problem.line, &problem.field) {
        (Some(line), _) => line,
        (None, Some(field)) => field_line(&lines, field)?,
        _ => return None,
    };
    let text = lines.get(number.checked_sub(1)?)?.replace('\t', "    ");
    // What the message quotes (`in backticks` or 'in quotes') that's on the line: the longest first.
    let mut quoted: Vec<&str> = Vec::new();
    for mark in ['`', '\''] {
        let mut rest = problem.message.as_str();
        while let Some(start) = rest.find(mark) {
            let Some(end) = rest[start + 1..].find(mark) else { break };
            quoted.push(&rest[start + 1..start + 1 + end]);
            rest = &rest[start + end + 2..];
        }
    }
    quoted.sort_by_key(|part| std::cmp::Reverse(part.len()));
    let field = problem.field.as_ref().map(|f| f.split('.').next().unwrap_or(f));
    let under = field.into_iter().chain(quoted).filter(|part| part.trim().len() > 1).find_map(|part| text.find(part).map(|byte| (text[..byte].chars().count(), part.chars().count())));
    let from = number.saturating_sub(2).max(1);
    let to = (number + 1).min(lines.len());
    let width = to.to_string().len().max(2);
    let mut out = format!("  --> {}:{}", file, number);
    for n in from..=to {
        let line = if n == number { text.clone() } else { lines[n - 1].replace('\t', "    ") };
        let shown: String = line.chars().take(WIDEST).collect();
        out.push_str(format!("\n  {:>width$} | {}{}", n, shown, if line.chars().count() > WIDEST { "..." } else { "" }, width = width).trim_end());
        if n == number {
            if let Some((column, length)) = under.filter(|(column, length)| column + length <= WIDEST) {
                out.push_str(&format!("\n  {:>width$} | {}{}", "", " ".repeat(column), "^".repeat(length), width = width));
            }
        }
    }
    Some(out)
}

/// The line of a file's front matter that sets `field` (the first part of a
/// dotted path), from 1.
fn field_line(lines: &[&str], field: &str) -> Option<usize> {
    let key = field.split('.').next().unwrap_or(field);
    let fence = lines.first()?.trim_end();
    let close = match fence {
        "+++" => "+++",
        f if f.starts_with("---") => "---",
        _ => return None,
    };
    lines.iter().enumerate().skip(1).take_while(|(_, line)| line.trim_end() != close).find(|(_, line)| {
        let line = line.trim_start_matches(['"', '\'']);
        line.strip_prefix(key).is_some_and(|rest| rest.trim_start_matches(['"', '\'']).trim_start().starts_with([':', '=']))
    }).map(|(i, _)| i + 1)
}

/// Where the files an error names can be: the project root, then the input
/// folder and the folders in it that templates and data are named from.
pub struct Locator {
    pub root: PathBuf,
    pub dirs: Vec<PathBuf>,
}

impl Locator {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Locator { dirs: vec![root.clone()], root }
    }

    /// For a site: its root, its input, includes and data folders, and its themes'.
    pub fn of(cfg: &crate::Config) -> Self {
        let ctx = cfg.build_context();
        let dirs = [ctx.input_dir.clone(), ctx.includes_dir.clone(), ctx.data_dir.clone()].into_iter().chain(ctx.theme_dirs.iter().flat_map(|t| [t.clone(), t.join("_includes")]));
        Locator::new(&ctx.root).with_dirs(dirs)
    }

    pub fn with_dirs(mut self, dirs: impl IntoIterator<Item = PathBuf>) -> Self {
        self.dirs.extend(dirs);
        self
    }

    /// The file `name` means, and its path from the root.
    fn find(&self, name: &str) -> Option<(PathBuf, String)> {
        let name = name.trim_matches(['"', '\'', '`']);
        if name.is_empty() {
            return None;
        }
        let path = self.dirs.iter().map(|d| d.join(name)).find(|p| p.is_file())?;
        let path = dunce::canonicalize(&path).unwrap_or(path);
        let root = dunce::canonicalize(&self.root).unwrap_or_else(|_| self.root.clone());
        let shown = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        Some((path, shown))
    }
}

/// The lines of a template before its body: its front matter, and the blank
/// lines after it. Template engines count lines from the body.
fn lines_before_body(path: &Path) -> Option<usize> {
    let src = std::fs::read_to_string(path).ok()?;
    let (_, body) = crate::data::parse_front_matter(&src).ok()?;
    Some(src[..src.len() - body.len()].matches('\n').count())
}

fn patterns() -> &'static [(Regex, Kind)] {
    static PATTERNS: OnceLock<Vec<(Regex, Kind)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        let re = |p: &str| Regex::new(p).unwrap();
        vec![
            // A JavaScript stack frame: `at shout (ssqch.config.js:3:67)`.
            (re(r"\(([^()\s:]+):(\d+):\d+\)"), Kind::FileLine),
            // A data file: `invalid JSON in /site/src/_data/site.json: trailing comma at line 1 column 17`.
            (re(r"invalid (?:JSON|YAML|TOML) in (.+?): [^\n]*?\bline (\d+)"), Kind::FileLine),
            (re(r"invalid (?:JSON|YAML|TOML) in (.+?): "), Kind::File),
            // Front matter: its lines start after the opening fence.
            (re(r"\bin (\S+): invalid (?:JSON|YAML|TOML) front matter: [^\n]*?\bline (\d+)"), Kind::FrontMatterLine),
            // A permalink or `computed` string: its line isn't a line of the file.
            (re(r"parse error in (\S+) \("), Kind::File),
            // A template, innermost first: `parse error in bad.edge: line 3`, then `page.njk:2:`.
            (re(r"parse error in (\S+): line (\d+)"), Kind::BodyLine),
            (re(r"(?:^|[\s:(])([^\s:()]+\.[A-Za-z0-9]+):(\d+): "), Kind::BodyLine),
            (re(r"rendering layout (\S+) for "), Kind::File),
            (re(r"rendering (\S+) with "), Kind::File),
            (re(r"(?:^|\n|- )in (\S+?): "), Kind::File),
            // `ssqch.config.js: "ouput" isn't a config option`.
            (re(r"^([^\s:]+\.[A-Za-z0-9]+): "), Kind::File),
        ]
    })
}

#[derive(Clone, Copy)]
enum Kind {
    File,
    /// The line is a line of the file.
    FileLine,
    /// The line counts from the template's body.
    BodyLine,
    /// The line counts from the start of the front matter.
    FrontMatterLine,
}

/// The file (and line) a message names, when the file exists.
fn locate(message: &str, at: &Locator) -> (Option<String>, Option<usize>) {
    for (pattern, kind) in patterns() {
        // The last match is the innermost file (an include inside a page).
        let found = match kind {
            Kind::BodyLine => pattern.captures_iter(message).last(),
            _ => pattern.captures(message),
        };
        let Some(found) = found else { continue };
        let Some((path, shown)) = at.find(&found[1]) else { continue };
        let number = found.get(2).and_then(|n| n.as_str().parse::<usize>().ok());
        let line = match (kind, number) {
            (Kind::FileLine, Some(n)) => Some(n),
            (Kind::BodyLine, Some(n)) => lines_before_body(&path).map(|before| before + n),
            (Kind::FrontMatterLine, Some(n)) => Some(n + 1),
            _ => None,
        };
        return (Some(shown), line);
    }
    (None, None)
}

/// A code for a message that came without one.
fn code_for(message: &str, fallback: &str) -> String {
    let code = if message.contains("front matter") {
        "front-matter"
    } else if message.starts_with("output conflicts") {
        "conflict"
    } else if message.contains("rendering ") || message.contains("parse error in ") || message.contains("layout `") || message.contains(" loop: ") {
        "template"
    } else if message.starts_with("invalid JSON in ") || message.starts_with("invalid YAML in ") || message.starts_with("invalid TOML in ") || message.contains("_data/") || message.contains("global data `") {
        "data"
    } else if message.contains("hook failed") || message.starts_with("beforeBuild") || message.starts_with("afterBuild") {
        "hook"
    } else {
        fallback
    };
    code.to_string()
}

/// A build's error as a list of problems. An error that holds
/// [`Diagnostics`] gives its items; any other is one problem. Each gets the
/// file and line its message names, when it has none and the file exists.
/// `fallback` is the code for a message nothing else fits (`config` for an
/// error from reading the configuration, `build` otherwise).
pub fn from_error(error: &anyhow::Error, fallback: &str, at: &Locator) -> Vec<Diagnostic> {
    let mut items = match error.chain().find_map(|cause| cause.downcast_ref::<Diagnostics>()) {
        Some(found) => found.items.clone(),
        None => vec![Diagnostic::error("", format!("{:#}", error))],
    };
    for item in &mut items {
        if item.code.is_empty() {
            item.code = code_for(&item.message, fallback);
        }
        if item.file.is_none() {
            (item.file, item.line) = locate(&item.message, at);
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_name_their_file_and_line() {
        let dir = std::env::temp_dir().join(format!("ssqch-diagnostics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src/_includes")).unwrap();
        std::fs::create_dir_all(dir.join("src/_data")).unwrap();
        // Three lines of front matter and a blank line: the body starts on line 5.
        std::fs::write(dir.join("src/page.edge"), "---\ntitle: T\n---\n\n<p>\n{{ nope.x }}\n").unwrap();
        std::fs::write(dir.join("src/_includes/bad.edge"), "<p>\n\n@if(\n").unwrap();
        std::fs::write(dir.join("src/_data/site.json"), "{ \"a\": 1, }").unwrap();
        std::fs::write(dir.join("ssqch.config.js"), "export default {};\n").unwrap();
        let at = Locator::new(&dir).with_dirs([dir.join("src"), dir.join("src/_includes")]);
        let one = |message: &str, fallback: &str| {
            let found = from_error(&anyhow::anyhow!("{}", message), fallback, &at);
            assert_eq!(found.len(), 1);
            (found[0].code.clone(), found[0].file.clone().unwrap_or_default(), found[0].line)
        };
        let data = dir.join("src/_data/site.json");
        for (message, fallback, code, file, line) in [
            // A template's lines count from its body.
            ("rendering page.edge with `edge`: page.edge:2: Cannot read properties of undefined", "build", "template", "src/page.edge", Some(6)),
            ("rendering page.edge with `edge`: parse error in page.edge: line 1: unclosed @if(", "build", "template", "src/page.edge", Some(5)),
            // The innermost file.
            ("rendering page.edge with `edge`: page.edge:1: @include('bad.edge'): parse error in bad.edge: line 3: invalid @if arguments", "build", "template", "src/_includes/bad.edge", Some(3)),
            ("rendering layout _includes/bad.edge for page.edge: _includes/bad.edge:2: nope", "build", "template", "src/_includes/bad.edge", Some(2)),
            ("in page.edge: invalid YAML front matter: did not find expected ',' or ']' at line 2 column 1, while parsing a flow sequence at line 1 column 8", "build", "front-matter", "src/page.edge", Some(3)),
            ("in page.edge: computed.x: parse error in page.edge (computed): line 1: invalid expression", "build", "template", "src/page.edge", None),
            ("in page.edge: layout `nope.edge` not found: no sightings in /site/src/_includes", "build", "template", "src/page.edge", None),
            ("in page.edge: we've passed this tree before. Layout loop: a.edge -> b.edge -> a.edge", "build", "template", "src/page.edge", None),
            (&format!("invalid JSON in {}: trailing comma at line 1 column 11", data.display()), "build", "data", "src/_data/site.json", Some(1)),
            ("ssqch.config.js: nope is not defined\n    at <anonymous> (ssqch.config.js:1:52)", "config", "config", "ssqch.config.js", Some(1)),
            ("ssqch.config.js: \"ouput\" isn't a config option", "config", "config", "ssqch.config.js", None),
            ("rendering page.edge with `edge`: page.edge:1: shout(): cannot read property 'x' of undefined\n    at shout (ssqch.config.js:3:67)", "build", "template", "ssqch.config.js", Some(3)),
            // A file that isn't there isn't named.
            ("rendering gone.edge with `edge`: gone.edge:2: nope", "build", "template", "", None),
            ("too many pine cones", "build", "build", "", None),
        ] {
            assert_eq!(one(message, fallback), (code.to_string(), file.to_string(), line), "{}", message);
        }

        // An error that keeps its problems apart, under a context.
        let error = anyhow::Error::new(Diagnostics {
            message: "2 content errors".into(),
            items: vec![Diagnostic::error("schema", "src/page.edge: `title` is required").file("./src/page.edge").field("title"), Diagnostic::error("", "in page.edge: front matter is missing its closing `---`")],
        })
        .context("checking content");
        assert_eq!(format!("{:#}", error), "checking content: 2 content errors");
        let found = from_error(&error, "build", &at);
        assert_eq!(found[0].to_json(), serde_json::json!({ "code": "schema", "message": "src/page.edge: `title` is required", "file": "src/page.edge", "field": "title" }));
        assert_eq!(found[1].to_json(), serde_json::json!({ "code": "front-matter", "message": "in page.edge: front matter is missing its closing `---`", "file": "src/page.edge" }));

        // The lines an error is about: the file's own line, with carets under what the message quotes.
        let shown = |message: &str| frames(&anyhow::anyhow!("{}", message), "build", &at).unwrap_or_default();
        assert_eq!(shown("rendering page.edge with `edge`: page.edge:2: Cannot read properties of undefined (reading 'x') in `nope`"), "  --> src/page.edge:6\n   4 |\n   5 | <p>\n   6 | {{ nope.x }}\n     |    ^^^^");
        assert_eq!(shown("rendering page.edge with `edge`: parse error in page.edge: line 1: unclosed @if("), "  --> src/page.edge:5\n   3 | ---\n   4 |\n   5 | <p>\n   6 | {{ nope.x }}");
        assert_eq!(shown("too many pine cones"), "");
        // A schema problem points at its field in the front matter.
        let error = anyhow::Error::new(Diagnostics { message: "1 content error".into(), items: vec![Diagnostic::error("schema", "src/page.edge: `title` must be a string").file("src/page.edge").field("title")] });
        assert_eq!(frames(&error, "build", &at).unwrap(), "  --> src/page.edge:2\n   1 | ---\n   2 | title: T\n     | ^^^^^\n   3 | ---");
        assert_eq!(describe(&error, "build", &at), "1 content error\n\n  --> src/page.edge:2\n   1 | ---\n   2 | title: T\n     | ^^^^^\n   3 | ---");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
