//! Conservative HTML minification, modelled on html-minifier-terser with
//! `collapseWhitespace`, `removeComments` and `useShortDoctype`.
//!
//! Attribute order and quoting are left alone; `<pre>`, `<textarea>`,
//! `<script>` and `<style>` contents are copied verbatim.

use sitesquatch::{Config, Plugin};

#[derive(Clone)]
pub struct MinifyOptions {
    pub collapse_whitespace: bool,
    pub remove_comments: bool,
    pub short_doctype: bool,
}

impl Default for MinifyOptions {
    fn default() -> Self {
        MinifyOptions { collapse_whitespace: true, remove_comments: true, short_doctype: true }
    }
}

#[derive(Default)]
pub struct MinifyPlugin {
    pub options: MinifyOptions,
}

impl Plugin for MinifyPlugin {
    fn name(&self) -> &str {
        "minify"
    }

    fn register(&self, config: &mut Config) {
        let opts = self.options.clone();
        config.add_transform("minify-html", move |ctx, html| if ctx.is_html() { Ok(minify(&html, &opts)) } else { Ok(html) });
    }
}

/// Elements whose surrounding whitespace is insignificant.
const BLOCK: &[&str] = &[
    "html", "head", "body", "title", "meta", "link", "script", "style", "base", "noscript", "template", "div", "p", "section", "article", "aside",
    "header", "footer", "nav", "main", "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tfoot",
    "tr", "td", "th", "caption", "colgroup", "col", "figure", "figcaption", "picture", "source", "blockquote", "form", "fieldset", "legend", "hr",
    "pre", "address", "details", "summary", "dialog", "iframe", "video", "audio", "canvas", "option", "optgroup", "symbol", "g", "path",
    "defs", "circle", "rect", "polygon", "line", "ellipse", "!doctype",
];
const VOID: &[&str] = &["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"];
/// Inline elements that render something, so adjacent spaces matter.
const VISIBLE: &[&str] = &["img", "svg", "input", "select", "textarea", "button", "video", "audio", "iframe", "canvas", "br", "wbr"];
const RAW: &[&str] = &["script", "style", "pre", "textarea"];

fn tag_name(tag: &str) -> String {
    tag.trim_start_matches('<').trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '>' || c == '/').next().unwrap_or("").to_ascii_lowercase()
}

pub fn minify(html: &str, opts: &MinifyOptions) -> String {
    // Split into tokens: tags/comments and text.
    enum Tok<'a> {
        Tag(String, String), // (markup, name)
        Text(&'a str),
        Raw(&'a str),
    }
    let mut toks: Vec<Tok> = Vec::new();
    let mut i = 0;
    let b = html.as_bytes();
    while i < html.len() {
        if b[i] == b'<' {
            if html[i..].starts_with("<!--") {
                let end = html[i..].find("-->").map(|e| i + e + 3).unwrap_or(html.len());
                let comment = &html[i..end];
                let keep = !opts.remove_comments || comment.starts_with("<!--[if") || comment.starts_with("<!--!");
                if keep {
                    toks.push(Tok::Raw(comment));
                }
                i = end;
                continue;
            }
            let next = html[i + 1..].chars().next().unwrap_or(' ');
            if next.is_ascii_alphabetic() || next == '/' || next == '!' || next == '?' {
                // Find the end of the tag, honouring quoted attribute values.
                let mut j = i + 1;
                let mut quote: Option<u8> = None;
                while j < b.len() {
                    match (quote, b[j]) {
                        (Some(q), c) if c == q => quote = None,
                        (None, b'"') | (None, b'\'') => quote = Some(b[j]),
                        (None, b'>') => break,
                        _ => {}
                    }
                    j += 1;
                }
                let raw_tag = &html[i..(j + 1).min(html.len())];
                let name = tag_name(raw_tag);
                let mut markup = if name == "!doctype" && opts.short_doctype { "<!doctype html>".to_string() } else { collapse_tag(raw_tag) };
                // Like html-minifier: drop the closing slash on HTML void elements (not SVG).
                if VOID.contains(&name.as_str()) && markup.ends_with("/>") {
                    markup.truncate(markup.len() - 2);
                    let trimmed = markup.trim_end().len();
                    markup.truncate(trimmed);
                    markup.push('>');
                }
                let closing = raw_tag.starts_with("</");
                toks.push(Tok::Tag(markup, if closing { format!("/{}", name) } else { name.clone() }));
                i = j + 1;
                if !closing && RAW.contains(&name.as_str()) && !raw_tag.ends_with("/>") {
                    let close = format!("</{}", name);
                    let end = find_ci(&html[i..], &close).map(|e| i + e).unwrap_or(html.len());
                    toks.push(Tok::Raw(&html[i..end]));
                    i = end;
                }
                continue;
            }
        }
        let next_char = i + html[i..].chars().next().map(char::len_utf8).unwrap_or(1);
        let end = html[next_char..].find('<').map(|e| next_char + e).unwrap_or(html.len());
        toks.push(Tok::Text(&html[i..end]));
        i = end;
    }

    // Inline tags are "transparent" when deciding whether whitespace sits on a
    // block boundary: in `<div><a> Home</a></div>` the spaces are dropped.
    #[derive(PartialEq)]
    enum Edge {
        Boundary,
        Content,
    }
    let edge = |t: &Tok| -> Option<Edge> {
        match t {
            Tok::Tag(_, name) => {
                let bare = name.trim_start_matches('/');
                if BLOCK.contains(&bare) {
                    Some(Edge::Boundary)
                } else if VISIBLE.contains(&bare) {
                    Some(Edge::Content)
                } else {
                    None // transparent inline tag
                }
            }
            Tok::Text(t) if t.trim().is_empty() => None,
            _ => Some(Edge::Content),
        }
    };
    let mut out = String::with_capacity(html.len());
    // Did the most recent text end in a space (with only inline tags since)?
    let mut pending_space = false;
    for idx in 0..toks.len() {
        if edge(&toks[idx]).is_some() && !matches!(toks[idx], Tok::Text(_)) {
            pending_space = false;
        }
        match &toks[idx] {
            Tok::Tag(m, _) => out.push_str(m),
            Tok::Raw(r) => {
                let script_like = idx > 0 && matches!(&toks[idx - 1], Tok::Tag(_, n) if n == "script" || n == "style");
                out.push_str(if script_like && opts.collapse_whitespace { r.trim() } else { r });
            }
            Tok::Text(t) if !opts.collapse_whitespace => out.push_str(t),
            Tok::Text(t) => {
                let mut s = collapse_ws(t);
                let before = toks[..idx].iter().rev().find_map(edge).unwrap_or(Edge::Boundary);
                if before == Edge::Boundary || pending_space {
                    s = s.trim_start().to_string();
                }
                let after = toks[idx + 1..].iter().find_map(edge).unwrap_or(Edge::Boundary);
                if after == Edge::Boundary {
                    s = s.trim_end().to_string();
                }
                if !s.is_empty() {
                    pending_space = s.ends_with(' ');
                }
                out.push_str(&s);
            }
        }
    }
    out
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    let lower = hay.to_ascii_lowercase();
    lower.find(&needle.to_ascii_lowercase())
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if c.is_ascii_whitespace() {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

/// Collapse whitespace between attributes, leaving quoted values alone.
fn collapse_tag(tag: &str) -> String {
    let mut out = String::with_capacity(tag.len());
    let mut quote: Option<char> = None;
    let mut pending_space = false;
    for c in tag.chars() {
        match quote {
            Some(q) => {
                out.push(c);
                if c == q {
                    quote = None;
                }
            }
            None if c.is_ascii_whitespace() => pending_space = true,
            None => {
                if pending_space && c != '>' && !(c == '/' && tag.ends_with("/>")) && !out.ends_with('<') {
                    out.push(' ');
                }
                pending_space = false;
                if c == '"' || c == '\'' {
                    quote = Some(c);
                }
                out.push(c);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(s: &str) -> String {
        minify(s, &MinifyOptions::default())
    }

    #[test]
    fn collapses_whitespace_like_html_minifier() {
        assert_eq!(m("<!DOCTYPE html>\n<html>\n  <head>\n    <title>\n  Hi – there\n  </title>\n  </head>"), "<!doctype html><html><head><title>Hi – there</title></head>");
        assert_eq!(m("<p>Hello   <strong>big</strong>\n  world</p>"), "<p>Hello <strong>big</strong> world</p>");
        assert_eq!(m("<img\n   class=\"a\"\n   src=\"b c\"   >"), "<img class=\"a\" src=\"b c\">");
        assert_eq!(m("<div><!-- gone --><pre>  keep\n  this </pre></div>"), "<div><pre>  keep\n  this </pre></div>");
        assert_eq!(m("<script>\n if (a < b) {}\n</script>"), "<script>if (a < b) {}</script>");
        assert_eq!(m("<nav><a>\n Home\n</a>\n<a>\n About\n</a></nav>"), "<nav><a>Home </a><a>About</a></nav>");
        assert_eq!(m("<a href=\"/\">Home\n</a>"), "<a href=\"/\">Home</a>");
        assert_eq!(m("<link rel=\"canonical\" href=\"/\" /><svg><path d=\"M0\"/></svg>"), "<link rel=\"canonical\" href=\"/\"><svg><path d=\"M0\"/></svg>");
        assert_eq!(m("<p>—dash — <b>é</b></p>"), "<p>—dash — <b>é</b></p>");
        assert_eq!(m("<div>\n  <a href=\"/\">\n    Home\n  </a>\n</div>"), "<div><a href=\"/\">Home</a></div>");
        assert_eq!(m("<a><svg></svg>\n  Buy me\n</a>\n</div>"), "<a><svg></svg> Buy me</a></div>");
        assert_eq!(m("<script>\n  var a = 1;\n</script>"), "<script>var a = 1;</script>");
    }
}
