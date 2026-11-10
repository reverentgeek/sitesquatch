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
    Templates::named(lang).is_some() || syntax(lang).is_some()
}

/// The highlighted HTML for the inside of `<code>`, or `None` for a
/// language without a grammar. Lines numbered in `marked` (from 1) are
/// wrapped in `<span class="line highlighted">`, and the others in
/// `<span class="line">`, when there are any.
pub fn highlight(lang: &str, code: &str, marked: &[usize]) -> Option<String> {
    let classes = match Templates::named(lang) {
        Some(templates) => templates.classes(code)?,
        None => classes(syntax(lang)?, code)?,
    };
    Some(render(code, &classes, marked))
}

/// The class of each byte of `code` (empty for none), from a grammar.
fn classes(syntax: &SyntaxReference, code: &str) -> Option<Vec<&'static str>> {
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut out: Vec<&'static str> = vec![""; code.len()];
    let mut offset = 0;
    for line in code.split_inclusive('\n') {
        let ops = state.parse_line(line, &SYNTAXES).ok()?;
        let body_len = line.strip_suffix('\n').map_or(line.len(), str::len);
        let mut pos = 0;
        let mut current = class_for(stack.as_slice());
        for (at, op) in &ops {
            let at = (*at).min(body_len);
            if at > pos {
                out[offset + pos..offset + at].fill(current);
                pos = at;
            }
            stack.apply(op).ok()?;
            current = class_for(stack.as_slice());
        }
        if body_len > pos {
            out[offset + pos..offset + body_len].fill(current);
        }
        offset += line.len();
    }
    Some(out)
}

/// `code` as HTML, with each run of bytes of one class in a span.
fn render(code: &str, classes: &[&'static str], marked: &[usize]) -> String {
    let mut out = String::with_capacity(code.len() * 2);
    let mut offset = 0;
    for (n, line) in code.split_inclusive('\n').enumerate() {
        let (body, newline) = match line.strip_suffix('\n') {
            Some(body) => (body, "\n"),
            None => (line, ""),
        };
        if !marked.is_empty() {
            out.push_str(if marked.contains(&(n + 1)) { "<span class=\"line highlighted\">" } else { "<span class=\"line\">" });
        }
        let mut pos = 0;
        while pos < body.len() {
            let class = classes[offset + pos];
            let mut end = pos + 1;
            while end < body.len() && classes[offset + end] == class {
                end += 1;
            }
            let text = &body[pos..end];
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
            pos = end;
        }
        if !marked.is_empty() {
            out.push_str("</span>");
        }
        out.push_str(newline);
        offset += line.len();
    }
    out
}

// --------------------------------------------------------------- templates

/// Template languages the grammars don't cover: HTML with tags of their own.
/// The HTML around the tags is highlighted by the HTML grammar (with the tags
/// blanked out, so they can sit anywhere, attribute values included), and the
/// tags by the small lexer here.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Templates {
    Edge,
    Liquid,
    Handlebars,
}

const EDGE_WORDS: &[&str] = &["in", "of", "await", "typeof", "new", "instanceof"];
const LIQUID_WORDS: &[&str] = &["in", "and", "or", "not", "contains", "with", "as", "for", "reversed", "limit", "offset", "by"];
const HANDLEBARS_WORDS: &[&str] = &["as", "else"];
const CONSTANTS: &[&str] = &["true", "false", "null", "undefined", "nil", "empty", "blank"];

impl Templates {
    fn named(lang: &str) -> Option<Templates> {
        match lang.to_ascii_lowercase().as_str() {
            "edge" | "edgejs" => Some(Templates::Edge),
            "liquid" => Some(Templates::Liquid),
            "hbs" | "handlebars" | "mustache" => Some(Templates::Handlebars),
            _ => None,
        }
    }

    fn words(self) -> &'static [&'static str] {
        match self {
            Templates::Edge => EDGE_WORDS,
            Templates::Liquid => LIQUID_WORDS,
            Templates::Handlebars => HANDLEBARS_WORDS,
        }
    }

    fn classes(self, code: &str) -> Option<Vec<&'static str>> {
        let mut tags: Vec<&'static str> = vec![""; code.len()];
        // Bytes that belong to a template tag: not HTML.
        let mut masked = code.as_bytes().to_vec();
        let mut lexer = Lexer { code, bytes: code.as_bytes(), out: &mut tags, mask: &mut masked, templates: self };
        lexer.run();
        let masked = String::from_utf8(masked).ok()?;
        let mut classes = classes(SYNTAXES.find_syntax_by_token("html")?, &masked)?;
        for (i, (class, original)) in tags.iter().zip(code.bytes()).enumerate() {
            if masked.as_bytes()[i] != original || !class.is_empty() {
                classes[i] = class;
            }
        }
        Some(classes)
    }
}

struct Lexer<'a> {
    code: &'a str,
    bytes: &'a [u8],
    out: &'a mut Vec<&'static str>,
    mask: &'a mut Vec<u8>,
    templates: Templates,
}

impl Lexer<'_> {
    /// Mark `start..end` as a tag (not HTML), with `class`.
    fn mark(&mut self, start: usize, end: usize, class: &'static str) {
        let end = end.min(self.bytes.len());
        for i in start..end {
            self.out[i] = class;
            if self.bytes[i] != b'\n' {
                self.mask[i] = b' ';
            }
        }
    }

    fn find(&self, from: usize, needle: &str) -> Option<usize> {
        self.code.get(from..)?.find(needle).map(|i| from + i)
    }

    /// The end of a tag that closes with `close`, skipping quoted strings.
    fn close(&self, from: usize, close: &str) -> Option<usize> {
        let mut i = from;
        while i < self.bytes.len() {
            if self.bytes[i..].starts_with(close.as_bytes()) {
                return Some(i);
            }
            match self.bytes[i] {
                q @ (b'"' | b'\'') => i = self.string_end(i, q),
                _ => i += 1,
            }
        }
        None
    }

    /// The index after the string that starts at `i` with quote `q`.
    fn string_end(&self, i: usize, q: u8) -> usize {
        let mut j = i + 1;
        while j < self.bytes.len() {
            match self.bytes[j] {
                // The escaped character, whole.
                b'\\' => j += 1 + self.code[j + 1..].chars().next().map_or(1, char::len_utf8),
                b if b == q => return j + 1,
                b'\n' if q != b'`' => return j,
                _ => j += 1,
            }
        }
        self.bytes.len()
    }

    fn run(&mut self) {
        let mut i = 0;
        let mut line_start = true;
        while i < self.bytes.len() {
            let b = self.bytes[i];
            let rest = &self.bytes[i..];
            let next = if rest.starts_with(b"{{") {
                // `@{{ }}` in Edge is literal text.
                if self.templates == Templates::Edge && i > 0 && self.bytes[i - 1] == b'@' { None } else { self.mustache(i) }
            } else if rest.starts_with(b"{%") && self.templates == Templates::Liquid {
                self.liquid_tag(i)
            } else if b == b'@' && line_start && self.templates == Templates::Edge {
                self.edge_directive(i)
            } else {
                None
            };
            match next {
                Some(end) => {
                    line_start = false;
                    i = end.max(i + 1);
                }
                None => {
                    line_start = b == b'\n' || (line_start && (b == b' ' || b == b'\t'));
                    i += 1;
                }
            }
        }
    }

    /// `{{ ... }}`, `{{{ ... }}}` and comments, from `i`. Returns the index after it.
    fn mustache(&mut self, i: usize) -> Option<usize> {
        let rest = &self.code[i..];
        if rest.starts_with("{{--") || rest.starts_with("{{!--") {
            let end = self.find(i, "--}}").map(|e| e + 4)?;
            self.mark(i, end, "comment");
            return Some(end);
        }
        if rest.starts_with("{{!") && self.templates == Templates::Handlebars {
            let end = self.find(i, "}}").map(|e| e + 2)?;
            self.mark(i, end, "comment");
            return Some(end);
        }
        let (open, close) = if rest.starts_with("{{{") { (3, "}}}") } else { (2, "}}") };
        let end = self.close(i + open, close)?;
        self.mark(i, i + open, "operator");
        self.mark(i + open, end, "");
        self.mark(end, end + close.len(), "operator");
        let mut start = i + open;
        if self.templates == Templates::Handlebars {
            start = self.handlebars_head(start, end);
        }
        self.expression(start, end);
        Some(end + close.len())
    }

    /// The start of a Handlebars tag: `#if`, `/each`, `> partial`, `else`,
    /// or a helper's name. Returns where its arguments begin.
    fn handlebars_head(&mut self, start: usize, end: usize) -> usize {
        let mut i = start;
        while i < end && (self.bytes[i] == b'~' || self.bytes[i].is_ascii_whitespace()) {
            i += 1;
        }
        let sigil = (i < end && matches!(self.bytes[i], b'#' | b'/' | b'^' | b'>' | b'&' | b'*')).then(|| self.bytes[i]);
        let word_start = if sigil.is_some() { i + 1 } else { i };
        let mut w = word_start;
        while w < end && self.bytes[w].is_ascii_whitespace() {
            w += 1;
        }
        let mut word_end = w;
        while word_end < end && !self.bytes[word_end].is_ascii_whitespace() && self.bytes[word_end] != b'~' {
            word_end += 1;
        }
        let word = &self.code[w..word_end];
        let has_arguments = !self.code[word_end..end].trim_matches(|c: char| c.is_whitespace() || c == '~').is_empty();
        match sigil {
            Some(b'#' | b'/' | b'^') => self.mark(i, word_end, "keyword"),
            Some(b'>') => {
                self.mark(i, i + 1, "operator");
                self.mark(w, word_end, "function");
            }
            Some(_) => self.mark(i, i + 1, "operator"),
            None if word == "else" => self.mark(w, word_end, "keyword"),
            // A helper call: `{{formatDate date "long"}}`.
            None if has_arguments && word.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') => self.mark(w, word_end, "function"),
            None => return start,
        }
        word_end
    }

    /// `{% tag ... %}` from `i`, with `comment` and `raw` blocks.
    fn liquid_tag(&mut self, i: usize) -> Option<usize> {
        let end = self.close(i + 2, "%}")?;
        let inner = &self.code[i + 2..end];
        let name_start = i + 2 + (inner.len() - inner.trim_start_matches(|c: char| c == '-' || c.is_whitespace()).len());
        let mut name_end = name_start;
        while name_end < end && (self.bytes[name_end].is_ascii_alphanumeric() || self.bytes[name_end] == b'_') {
            name_end += 1;
        }
        let name = &self.code[name_start..name_end];
        if name == "comment" {
            let close = self.find(end, "endcomment").and_then(|e| self.find(e, "%}")).map(|e| e + 2).unwrap_or(self.bytes.len());
            self.mark(i, close, "comment");
            return Some(close);
        }
        self.mark(i, name_start, "operator");
        self.mark(name_start, name_end, "keyword");
        self.mark(name_end, end, "");
        self.mark(end, end + 2, "operator");
        if end > 0 && self.bytes[end - 1] == b'-' {
            self.mark(end - 1, end, "operator");
        }
        self.expression(name_end, end);
        if name == "raw" {
            // What's inside is literal: skip to the tag that ends it.
            let mut from = end + 2;
            while let Some(c) = self.find(from, "{%") {
                if self.code[c + 2..].trim_start_matches(|ch: char| ch == '-' || ch.is_whitespace()).starts_with("endraw") {
                    return Some(c);
                }
                from = c + 2;
            }
        }
        Some(end + 2)
    }

    /// An Edge tag on its own line: `@if(user)`, `@end`, `@!component('card', { title })`.
    fn edge_directive(&mut self, i: usize) -> Option<usize> {
        let mut j = i + 1;
        if j < self.bytes.len() && self.bytes[j] == b'!' {
            j += 1;
        }
        let name_start = j;
        while j < self.bytes.len() && (self.bytes[j].is_ascii_alphanumeric() || self.bytes[j] == b'_' || self.bytes[j] == b'.') {
            j += 1;
        }
        if j == name_start {
            return None;
        }
        let line_end = self.find(j, "\n").unwrap_or(self.bytes.len());
        if j < self.bytes.len() && self.bytes[j] == b'(' {
            // Through the matching `)`, which can be lines later.
            let mut depth = 0usize;
            let mut k = j;
            let mut close = None;
            while k < self.bytes.len() {
                match self.bytes[k] {
                    b'(' => depth += 1,
                    b')' => {
                        depth -= 1;
                        if depth == 0 {
                            close = Some(k);
                            break;
                        }
                    }
                    q @ (b'"' | b'\'' | b'`') => {
                        k = self.string_end(k, q);
                        continue;
                    }
                    _ => {}
                }
                k += 1;
            }
            let close = close?;
            self.mark(i, j, "keyword");
            self.mark(j, close + 1, "");
            self.expression(j + 1, close);
            // `~` after a tag trims the newline that follows it.
            let trim = usize::from(self.bytes.get(close + 1) == Some(&b'~'));
            self.mark(close + 1, close + 1 + trim, "operator");
            return Some(close + 1 + trim);
        }
        // Without arguments, the tag is the whole line: `@end`, `@else`, `@end~`.
        let after = self.code[j..line_end].trim();
        if !(after.is_empty() || after == "~") {
            return None;
        }
        self.mark(i, j, "keyword");
        let trim = usize::from(self.bytes.get(j) == Some(&b'~'));
        self.mark(j, j + trim, "operator");
        Some(j + trim)
    }

    /// The inside of a tag: strings, numbers, keywords, filters and calls.
    fn expression(&mut self, start: usize, end: usize) {
        let mut i = start;
        let mut after_pipe = false;
        let mut after_dot = false;
        while i < end {
            let b = self.bytes[i];
            if b.is_ascii_whitespace() {
                i += 1;
                continue;
            }
            if matches!(b, b'"' | b'\'' | b'`') {
                let e = self.string_end(i, b).min(end);
                self.mark(i, e, "string");
                i = e;
            } else if b.is_ascii_digit() {
                let mut e = i;
                while e < end && (self.bytes[e].is_ascii_alphanumeric() || self.bytes[e] == b'.' || self.bytes[e] == b'_') {
                    e += 1;
                }
                // `1..5` is a range, not one number.
                if let Some(dots) = self.code[i..e].find("..") {
                    e = i + dots;
                }
                self.mark(i, e, "number");
                i = e;
            } else if b.is_ascii_alphabetic() || b == b'_' || b == b'$' || b == b'@' || b >= 0x80 {
                let mut e = i + 1;
                while e < end && (self.bytes[e].is_ascii_alphanumeric() || matches!(self.bytes[e], b'_' | b'$') || self.bytes[e] >= 0x80 || (self.bytes[e] == b'-' && self.templates != Templates::Edge && e + 1 < end && self.bytes[e + 1].is_ascii_alphabetic())) {
                    e += 1;
                }
                let word = &self.code[i..e];
                let calls = self.code[e..end].trim_start().starts_with('(');
                let named = self.templates != Templates::Edge && e < end && (self.bytes[e] == b'=' || (self.bytes[e] == b':' && self.templates == Templates::Liquid)) && !self.code[e..end].starts_with("==");
                let class = if b == b'@' {
                    "builtin"
                } else if after_dot {
                    if calls { "function" } else { "property" }
                } else if CONSTANTS.contains(&word) {
                    "constant"
                } else if self.templates.words().contains(&word) {
                    "keyword"
                } else if word == "this" {
                    "builtin"
                } else if after_pipe && self.templates == Templates::Handlebars {
                    // Block parameters: `as |post index|`.
                    "parameter"
                } else if after_pipe || calls {
                    "function"
                } else if named {
                    "attribute"
                } else {
                    ""
                };
                if !class.is_empty() {
                    self.mark(i, e, class);
                }
                i = e;
            } else {
                if matches!(b, b'=' | b'!' | b'<' | b'>' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'?' | b'~' | b'^') || (b == b':' && self.templates == Templates::Edge) {
                    self.mark(i, i + 1, "operator");
                }
                after_pipe = b == b'|' && !(i + 1 < end && self.bytes[i + 1] == b'|') && !(i > start && self.bytes[i - 1] == b'|');
                after_dot = b == b'.';
                i += 1;
                continue;
            }
            after_pipe = false;
            after_dot = false;
        }
    }
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

    /// The classes of the text's tokens, as `class:text` words.
    fn tokens(lang: &str, code: &str) -> String {
        let html = highlight(lang, code, &[]).unwrap();
        let re = regex::Regex::new(r#"<span class="hl-([a-z]+)">(.*?)</span>"#).unwrap();
        re.captures_iter(&html).map(|c| format!("{}:{}", &c[1], &c[2])).collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn edge_templates() {
        let code = "{{-- a note --}}\n@if(user.isAdmin && count > 2)\n  <a href=\"{{ url }}\" class=\"x\">{{ upper(user.name) }}</a>\n@else\n  {{{ items.map(i => i.id).join(', ') }}}\n@end\n@!component('card', { title: 'Hi', n: 3 })\nmail me @home, @{{ raw }}\n";
        assert_eq!(
            tokens("edge", code),
            "comment:{{-- a note --}} keyword:@if property:isAdmin operator:&amp;&amp; operator:&gt; number:2 tag:a attribute:href string:&quot; operator:{{ operator:}} string:&quot; attribute:class string:&quot;x&quot; operator:{{ function:upper property:name operator:}} tag:a keyword:@else operator:{{{ function:map operator:=&gt; property:id function:join string:', ' operator:}}} keyword:@end keyword:@!component string:'card' operator:: string:'Hi' operator:: number:3"
        );
        // Text comes through whole, escaped.
        let html = highlight("edge", "@each(post in posts)\n<p>{{ post.title }} & more</p>\n@end\n", &[2]).unwrap();
        assert!(html.contains("<span class=\"line highlighted\">&lt;<span class=\"hl-tag\">p</span>&gt;<span class=\"hl-operator\">{{</span> post.<span class=\"hl-property\">title</span> <span class=\"hl-operator\">}}</span> &amp; more&lt;/<span class=\"hl-tag\">p</span>&gt;</span>"), "{}", html);
        assert!(html.starts_with("<span class=\"line\"><span class=\"hl-keyword\">@each</span>(post <span class=\"hl-keyword\">in</span> posts)</span>"), "{}", html);
        assert_eq!(tokens("edge", "@if(title)~\nx\n@else~\ny\n@end~\n"), "keyword:@if operator:~ keyword:@else operator:~ keyword:@end operator:~");
    }

    #[test]
    fn templates_with_text_beyond_ascii() {
        for lang in ["edge", "liquid", "hbs"] {
            let code = "<p>Café – “quoted” 🦀 {{ title }} naïve</p>\n{{ 'é\\' – ' }} @ 🦀\n{% if é %}–{% endif %}\n@if(naïve)\n";
            let html = highlight(lang, code, &[]).unwrap();
            assert!(html.contains("Café – “quoted” 🦀 <span class=\"hl-operator\">{{</span> title <span class=\"hl-operator\">}}</span> naïve"), "{}: {}", lang, html);
        }
        // A string with text beyond ASCII is still a string, and the tag still ends where it ends.
        assert_eq!(tokens("edge", "{{ \"héllo – 🦀\" }} after\n@include('partials/café')\n"), "operator:{{ string:&quot;héllo – 🦀&quot; operator:}} keyword:@include string:'partials/café'");
        assert_eq!(tokens("liquid", "{% assign x = \"é\" %}{{ x }}"), "operator:{% keyword:assign operator:= string:&quot;é&quot; operator:%}{{ operator:}}");
        assert_eq!(tokens("hbs", "{{greet \"señor\\\"\"}}"), "operator:{{ function:greet string:&quot;señor\\&quot;&quot; operator:}}");
    }

    #[test]
    fn liquid_templates() {
        let code = "{% comment %}hidden {{ x }}{% endcomment %}\n{%- for post in site.posts limit: 3 -%}\n  <li>{{ post.date | date: \"%Y\" | upcase }}</li>\n{% endfor %}\n{% raw %}{{ literal }}{% endraw %}\n{% include \"nav.html\", active: true %}\n";
        assert_eq!(
            tokens("liquid", code),
            "comment:{% comment %}hidden {{ x }}{% endcomment %} operator:{%- keyword:for keyword:in property:posts keyword:limit number:3 operator:-%} tag:li operator:{{ property:date operator:| function:date string:&quot;%Y&quot; operator:| function:upcase operator:}} tag:li operator:{% keyword:endfor operator:%} operator:{% keyword:raw operator:%} operator:{% keyword:endraw operator:%} operator:{% keyword:include string:&quot;nav.html&quot; attribute:active constant:true operator:%}"
        );
    }

    #[test]
    fn handlebars_templates() {
        let code = "{{!-- note --}}\n{{#each posts as |post|}}\n  <a href=\"{{post.url}}\">{{formatDate post.date \"long\" utc=true}}</a>{{{post.body}}}\n{{else}}\n  {{> empty-state title=\"None\"}}\n{{/each}}\n{{@index}} {{title}}\n";
        assert_eq!(
            tokens("hbs", code),
            "comment:{{!-- note --}} operator:{{ keyword:#each keyword:as operator:| parameter:post operator:|}} tag:a attribute:href string:&quot; operator:{{ property:url operator:}} string:&quot; operator:{{ function:formatDate property:date string:&quot;long&quot; attribute:utc operator:= constant:true operator:}} tag:a operator:{{{ property:body operator:}}} operator:{{ keyword:else operator:}} operator:{{&gt; function:empty-state attribute:title operator:= string:&quot;None&quot; operator:}} operator:{{ keyword:/each operator:}} operator:{{ builtin:@index operator:}} operator:{{ operator:}}"
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
        for lang in ["edge", "liquid", "hbs", "handlebars", "mustache"] {
            assert!(supports(lang), "{}", lang);
        }
        assert!(highlight("text", "x", &[]).is_none());
        for lang in ["rust", "python", "html", "css", "json", "yaml", "toml", "bash", "ts", "tsx", "go", "sql", "diff", "markdown", "jinja", "dockerfile", "java", "c", "cpp", "cs", "ruby", "php", "swift", "kotlin", "graphql"] {
            assert!(supports(lang), "{}", lang);
        }
    }
}
