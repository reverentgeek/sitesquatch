//! Build-time syntax highlighting for fenced code (`markdown: { highlight: true }`).
//!
//! Grammars are Sublime Text / TextMate ones (syntect, with bat's extra
//! syntaxes from two-face). Instead of syntect's one class per scope, each
//! token gets one short class for what it is (`hl-keyword`, `hl-string`,
//! ...), so the HTML stays small and one stylesheet ([`CSS`]) covers every
//! language, in light and dark.

use std::sync::LazyLock;

use syntect::parsing::{ParseState, Scope, ScopeStack, SyntaxReference, SyntaxSet};

use crate::markdown::escape_text;

static SYNTAXES: LazyLock<SyntaxSet> = LazyLock::new(two_face::syntax::extra_newlines);

/// Scope prefixes and the class they get, checked from a token's innermost
/// scope outwards; the first match wins. An empty class means "no class":
/// it stops the search, so code inside a template string or embedded
/// language doesn't take the string's class.
const RULES: &[(&str, &str)] = &[
    ("comment", "comment"),
    ("punctuation.definition.comment", "comment"),
    ("string.regexp", "regexp"),
    ("constant.character.escape", "escape"),
    ("punctuation.definition.string", "string"),
    ("meta.template.expression", ""),
    ("meta.embedded", ""),
    ("source", ""),
    ("string", "string"),
    ("constant.numeric", "number"),
    ("constant.language", "constant"),
    ("constant.character", "constant"),
    ("constant.other", "constant"),
    ("variable.other.constant", "constant"),
    ("support.constant", "constant"),
    ("keyword.operator", "operator"),
    ("keyword", "keyword"),
    ("storage", "keyword"),
    ("entity.name.function", "function"),
    ("support.function", "function"),
    ("variable.function", "function"),
    ("meta.function-call.identifier", "function"),
    ("entity.name.tag", "tag"),
    ("entity.other.attribute-name", "attribute"),
    ("support.type.property-name", "property"),
    ("variable.other.property", "property"),
    ("variable.other.object.property", "property"),
    ("meta.object-literal.key", "property"),
    ("variable.language", "builtin"),
    ("support.variable", "builtin"),
    ("variable.parameter", "parameter"),
    ("entity.name.type", "type"),
    ("entity.name.class", "type"),
    ("entity.name.namespace", "type"),
    ("entity.other.inherited-class", "type"),
    ("support.type", "type"),
    ("support.class", "type"),
    ("markup.heading", "heading"),
    ("entity.name.section", "heading"),
    ("markup.bold", "strong"),
    ("markup.italic", "emphasis"),
    ("markup.inserted", "inserted"),
    ("markup.deleted", "deleted"),
    ("markup.underline.link", "link"),
    ("entity.name", "type"),
];

static SCOPES: LazyLock<Vec<(Scope, &'static str)>> = LazyLock::new(|| RULES.iter().map(|(s, class)| (Scope::new(s).unwrap(), *class)).collect());

fn class_for(stack: &[Scope]) -> &'static str {
    for scope in stack.iter().rev() {
        if let Some((_, class)) = SCOPES.iter().find(|(prefix, _)| prefix.is_prefix_of(*scope)) {
            return class;
        }
    }
    ""
}

fn syntax(lang: &str) -> Option<&'static SyntaxReference> {
    let lang = lang.to_ascii_lowercase();
    let token = match lang.as_str() {
        "" | "text" | "txt" | "plain" | "plaintext" => return None,
        "sh" | "shell" | "zsh" | "console" | "shellsession" => "bash",
        "js" | "mjs" | "cjs" | "javascript" => "js",
        "ts" | "mts" | "cts" => "ts",
        "py" => "python",
        "rs" => "rust",
        "yml" => "yaml",
        "md" => "markdown",
        "njk" | "nunjucks" | "jinja" | "jinja2" | "j2" => "jinja2",
        other => other,
    };
    SYNTAXES.find_syntax_by_token(token)
}

/// Whether there's a grammar for `lang` (`js`, `rust`, `bash`, ...).
pub fn supports(lang: &str) -> bool {
    syntax(lang).is_some()
}

/// The highlighted HTML for the inside of `<code>`, or `None` for a
/// language without a grammar. Lines numbered in `marked` (from 1) are
/// wrapped in `<span class="line highlighted">`, and the others in
/// `<span class="line">`, when there are any.
pub fn highlight(lang: &str, code: &str, marked: &[usize]) -> Option<String> {
    let syntax = syntax(lang)?;
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut out = String::with_capacity(code.len() * 2);
    for (n, line) in code.split_inclusive('\n').enumerate() {
        let ops = state.parse_line(line, &SYNTAXES).ok()?;
        let (body, newline) = match line.strip_suffix('\n') {
            Some(body) => (body, "\n"),
            None => (line, ""),
        };
        if !marked.is_empty() {
            out.push_str(if marked.contains(&(n + 1)) { "<span class=\"line highlighted\">" } else { "<span class=\"line\">" });
        }
        // Byte ranges of the line and their class, merging neighbours with the same class.
        let mut spans: Vec<(usize, usize, &'static str)> = Vec::new();
        let mut add = |start: usize, end: usize, class: &'static str| match spans.last_mut() {
            Some((_, last_end, last)) if *last == class && *last_end == start => *last_end = end,
            _ => spans.push((start, end, class)),
        };
        let mut pos = 0;
        let mut current = class_for(stack.as_slice());
        for (at, op) in &ops {
            let at = (*at).min(body.len());
            if at > pos {
                add(pos, at, current);
                pos = at;
            }
            stack.apply(op).ok()?;
            current = class_for(stack.as_slice());
        }
        if body.len() > pos {
            add(pos, body.len(), current);
        }
        for (start, end, class) in spans {
            let text = &body[start..end];
            if class.is_empty() || text.trim().is_empty() {
                out.push_str(&escape_text(text));
            } else {
                // Whitespace around a token stays outside its span.
                let inner = text.trim();
                let lead = &text[..text.len() - text.trim_start().len()];
                let trail = &text[lead.len() + inner.len()..];
                out.push_str(lead);
                out.push_str("<span class=\"hl-");
                out.push_str(class);
                out.push_str("\">");
                out.push_str(&escape_text(inner));
                out.push_str("</span>");
                out.push_str(trail);
            }
        }
        if !marked.is_empty() {
            out.push_str("</span>");
        }
        out.push_str(newline);
    }
    Some(out)
}

/// Line numbers from a fence's info string: `{1,3-5}` (`js {1,3-5}` or
/// `js{1,3-5}`) is lines 1, 3, 4 and 5.
pub fn marked_lines(info: &str) -> Vec<usize> {
    let Some(start) = info.find('{') else { return Vec::new() };
    let Some(len) = info[start..].find('}') else { return Vec::new() };
    let inner = &info[start + 1..start + len];
    if !inner.chars().all(|c| c.is_ascii_digit() || c == ',' || c == '-' || c == ' ') {
        return Vec::new();
    }
    let mut lines = Vec::new();
    for part in inner.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        match part.split_once('-') {
            Some((a, b)) => {
                if let (Ok(a), Ok(b)) = (a.trim().parse::<usize>(), b.trim().parse::<usize>()) {
                    lines.extend(a..=b.min(a + 10_000));
                }
            }
            None => lines.extend(part.parse::<usize>().ok()),
        }
    }
    lines
}

/// The stylesheet for highlighted code: GitHub's colors, light and dark (by
/// `prefers-color-scheme`). Each color is a custom property (`--hl-keyword`)
/// a site can override, for a theme switch say.
pub const CSS: &str = r#"/* Syntax highlighting for ssqch (markdown.highlight). Override the --hl-* properties to change colors. */
:root {
  --hl-comment: #59636e;
  --hl-keyword: #cf222e;
  --hl-operator: #cf222e;
  --hl-string: #0a3069;
  --hl-regexp: #116329;
  --hl-escape: #116329;
  --hl-number: #0550ae;
  --hl-constant: #0550ae;
  --hl-builtin: #0550ae;
  --hl-property: #0550ae;
  --hl-attribute: #0550ae;
  --hl-function: #6639ba;
  --hl-type: #953800;
  --hl-parameter: #953800;
  --hl-tag: #116329;
  --hl-heading: #0550ae;
  --hl-link: #0a3069;
  --hl-inserted: #116329;
  --hl-inserted-bg: #dafbe1;
  --hl-deleted: #82071e;
  --hl-deleted-bg: #ffebe9;
  --hl-line-bg: rgba(212, 167, 44, 0.2);
}
@media (prefers-color-scheme: dark) {
  :root {
    --hl-comment: #9198a1;
    --hl-keyword: #ff7b72;
    --hl-operator: #ff7b72;
    --hl-string: #a5d6ff;
    --hl-regexp: #7ee787;
    --hl-escape: #7ee787;
    --hl-number: #79c0ff;
    --hl-constant: #79c0ff;
    --hl-builtin: #79c0ff;
    --hl-property: #79c0ff;
    --hl-attribute: #79c0ff;
    --hl-function: #d2a8ff;
    --hl-type: #ffa657;
    --hl-parameter: #ffa657;
    --hl-tag: #7ee787;
    --hl-heading: #1f6feb;
    --hl-link: #a5d6ff;
    --hl-inserted: #aff5b4;
    --hl-inserted-bg: #033a16;
    --hl-deleted: #ffdcd7;
    --hl-deleted-bg: #67060c;
    --hl-line-bg: rgba(187, 128, 9, 0.25);
  }
}
.hl-comment { color: var(--hl-comment); font-style: italic; }
.hl-keyword { color: var(--hl-keyword); }
.hl-operator { color: var(--hl-operator); }
.hl-string { color: var(--hl-string); }
.hl-regexp { color: var(--hl-regexp); }
.hl-escape { color: var(--hl-escape); font-weight: bold; }
.hl-number { color: var(--hl-number); }
.hl-constant { color: var(--hl-constant); }
.hl-builtin { color: var(--hl-builtin); }
.hl-property { color: var(--hl-property); }
.hl-attribute { color: var(--hl-attribute); }
.hl-function { color: var(--hl-function); }
.hl-type { color: var(--hl-type); }
.hl-parameter { color: var(--hl-parameter); }
.hl-tag { color: var(--hl-tag); }
.hl-heading { color: var(--hl-heading); font-weight: bold; }
.hl-strong { font-weight: bold; }
.hl-emphasis { font-style: italic; }
.hl-link { color: var(--hl-link); text-decoration: underline; }
.hl-inserted { color: var(--hl-inserted); background: var(--hl-inserted-bg); }
.hl-deleted { color: var(--hl-deleted); background: var(--hl-deleted-bg); }
pre.highlight .line { display: inline-block; min-width: 100%; }
pre.highlight .line.highlighted { background: var(--hl-line-bg); }
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript() {
        let html = highlight("js", "// hi\nconst a = `x${b}` + 1; f(\"q\");\n", &[]).unwrap();
        assert_eq!(
            html,
            "<span class=\"hl-comment\">// hi</span>\n<span class=\"hl-keyword\">const</span> a <span class=\"hl-operator\">=</span> <span class=\"hl-string\">`x</span>${b}<span class=\"hl-string\">`</span> <span class=\"hl-operator\">+</span> <span class=\"hl-number\">1</span>; <span class=\"hl-function\">f</span>(<span class=\"hl-string\">&quot;q&quot;</span>);\n"
        );
    }

    #[test]
    fn marked_lines_and_unknown_languages() {
        assert_eq!(marked_lines("js {1,3-5}"), vec![1, 3, 4, 5]);
        assert_eq!(marked_lines("js{2}"), vec![2]);
        assert_eq!(marked_lines("js {theme=dark}"), Vec::<usize>::new());
        let html = highlight("sh", "echo hi\nls\n", &[2]).unwrap();
        assert_eq!(html, "<span class=\"line\"><span class=\"hl-function\">echo</span> hi</span>\n<span class=\"line highlighted\"><span class=\"hl-function\">ls</span></span>\n");
        assert!(highlight("not-a-language", "x", &[]).is_none());
        assert!(highlight("text", "x", &[]).is_none());
        for lang in ["rust", "python", "html", "css", "json", "yaml", "toml", "bash", "ts", "tsx", "go", "sql", "diff", "markdown", "jinja", "dockerfile", "java", "c", "cpp", "cs", "ruby", "php", "swift", "kotlin", "graphql"] {
            assert!(supports(lang), "{}", lang);
        }
    }
}
