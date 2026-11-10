//! Edge template parsing and rendering.
//!
//! Supported syntax:
//! - `{{ expr }}` (escaped), `{{{ expr }}}` (raw), `{{-- comment --}}`, `@{{ literal }}`
//! - `@if / @elseif / @else / @end`, `@unless`
//! - `@each(item in list)`, `@each((item, index) in list)`, with `@else` for empty lists
//! - `@let(name = expr)`, `@assign(name = expr)`
//! - `@include('partial')`, `@includeIf(cond, 'partial')`
//! - `@component('name', props) ... @slot('name') ... @end ... @end`, `@!component(...)`
//! - a trailing `~` on a tag cancels the next newline (as do `@let`, `@assign`
//!   and `@slot`, Edge's `noNewLine` tags)
//!
//! Tags must start a line. A line holding only a tag (or a comment) is
//! removed from the output entirely.

use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};

use crate::eval::{eval, Scope};
use crate::expr::{Expr, Parser, UnOp};
use crate::value::{Map, Value};
use crate::Engine;

#[derive(Debug, Clone)]
pub enum Node {
    Text(String),
    /// `source` is the expression as written, for errors.
    Output { expr: Expr, raw: bool, line: usize, source: String },
    If { branches: Vec<(Expr, Vec<Node>)>, otherwise: Vec<Node>, line: usize },
    Each { item: String, index: Option<String>, iter: Expr, body: Vec<Node>, otherwise: Vec<Node>, line: usize },
    Let { name: String, expr: Expr, assign: bool, line: usize },
    Include { cond: Option<Expr>, path: Expr, line: usize },
    Component { path: Expr, props: Option<Expr>, main: Vec<Node>, slots: Vec<(Expr, Vec<Node>)>, line: usize },
}

#[derive(Debug, Clone)]
pub struct Template {
    pub name: String,
    pub nodes: Vec<Node>,
}

const TAGS: &[&str] = &[
    "if", "elseif", "else", "end", "unless", "each", "let", "assign", "include", "includeIf", "component", "slot",
];

struct Tag {
    name: String,
    /// `~`: drop the newline that ends the text before this tag.
    swallow: bool,
    self_closing: bool,
    args: TagArgs,
    line: usize,
}

enum TagArgs {
    None,
    List(Vec<Expr>),
    Binding { name: String, expr: Expr },
    Each { item: String, index: Option<String>, iter: Expr },
}

impl TagArgs {
    fn list(self) -> Vec<Expr> {
        match self {
            TagArgs::List(l) => l,
            _ => Vec::new(),
        }
    }
}

pub fn parse(name: &str, src: &str) -> Result<Template> {
    let mut p = TemplateParser { src, pos: 0, at_bol: true, pending_nl: false, drop_nl: false, last_line_tag: false };
    let (nodes, stop) = p.parse_nodes(&[]).with_context(|| format!("parse error in {}", name))?;
    if let Some(tag) = stop {
        bail!("parse error in {}:{}: unexpected @{}", name, tag.line, tag.name);
    }
    Ok(Template { name: name.to_string(), nodes })
}

/// Newlines follow edge-lexer: lines are *joined* by newlines. A newline is
/// emitted before each line of text (comments included), and between two
/// consecutive opening tag lines (a closing `@end` line doesn't count as
/// either). A tag ending in `~`, or a `noNewLine` tag such as `@let`, cancels
/// the next newline emitted, wherever it falls. So tag-only lines vanish, and
/// [`crate::Engine::render`] trims one newline from each end of the output.
/// Checked against Edge.js in tests/fixtures/whitespace-*.json.
struct TemplateParser<'a> {
    src: &'a str,
    pos: usize,
    /// At the beginning of a source line.
    at_bol: bool,
    /// A line break was read and belongs before the next line of text.
    pending_nl: bool,
    /// Set by `~`: skip the next pending line break.
    drop_nl: bool,
    /// The last line was an opening tag (edge-lexer's `isLastLineATag`).
    last_line_tag: bool,
}

/// Edge.js tags declared `noNewLine`: they cancel the next newline like `~`.
const NO_NEWLINE_TAGS: &[&str] = &["let", "assign", "slot"];

impl<'a> TemplateParser<'a> {
    fn line_at(&self, pos: usize) -> usize {
        self.src[..pos.min(self.src.len())].matches('\n').count() + 1
    }

    fn parse_nodes(&mut self, stops: &[&str]) -> Result<(Vec<Node>, Option<Tag>)> {
        let mut nodes = Vec::new();
        let mut buf = String::new();
        // While the current line holds only whitespace: where it began in `buf`
        // and the newline state before it, so a tag or comment line can be undone.
        let mut line_start: Option<(usize, bool, bool)> = None;

        fn flush(buf: &mut String, nodes: &mut Vec<Node>) {
            if !buf.is_empty() {
                nodes.push(Node::Text(std::mem::take(buf)));
            }
        }

        while self.pos < self.src.len() {
            if self.at_bol {
                self.at_bol = false;
                line_start = Some((buf.len(), self.pending_nl, self.drop_nl));
                if self.pending_nl {
                    self.pending_nl = false;
                    if self.drop_nl {
                        self.drop_nl = false;
                    } else {
                        buf.push('\n');
                    }
                }
            }
            let rest = &self.src[self.pos..];

            if let Some((ls, pending, drop)) = line_start {
                if rest.starts_with('@') && !rest.starts_with("@{{") {
                    let tag_pos = self.pos;
                    if let Some(tag) = self.try_tag()? {
                        // The tag line produces no output at all, except that
                        // two opening tag lines in a row get a newline between them.
                        buf.truncate(ls);
                        let mut drop = drop;
                        if tag.name != "end" {
                            if self.last_line_tag && pending {
                                if drop {
                                    drop = false;
                                } else {
                                    buf.push('\n');
                                }
                            }
                            self.last_line_tag = true;
                        }
                        // The break after a tag line still precedes the next line of
                        // text, even after line 1 (Edge trims the output's first newline).
                        self.pending_nl = pending || self.line_at(tag_pos) == 1;
                        self.drop_nl = drop || tag.swallow || NO_NEWLINE_TAGS.contains(&tag.name.as_str());
                        self.at_bol = true;
                        flush(&mut buf, &mut nodes);
                        line_start = None;
                        match tag.name.as_str() {
                            "end" | "else" | "elseif" | "slot" => {
                                if stops.contains(&tag.name.as_str()) {
                                    return Ok((nodes, Some(tag)));
                                }
                                bail!("line {}: unexpected @{}", tag.line, tag.name);
                            }
                            _ => nodes.push(self.block(tag, tag_pos)?),
                        }
                        continue;
                    }
                }
            }

            if rest.starts_with("@{{") {
                // Escaped mustache: emit it literally.
                let end = rest.find("}}").map(|i| i + 2).unwrap_or(rest.len());
                buf.push_str(&rest[1..end]);
                self.pos += end;
                line_start = None;
                continue;
            }

            if rest.starts_with("{{--") {
                let end = rest.find("--}}").ok_or_else(|| anyhow!("line {}: unclosed comment", self.line_at(self.pos)))? + 4;
                // Like Edge, a comment outputs nothing but its line stays.
                self.pos += end;
                line_start = None;
                continue;
            }

            if rest.starts_with("{{") {
                let raw = rest.starts_with("{{{");
                let (open, close) = if raw { (3, "}}}") } else { (2, "}}") };
                let line = self.line_at(self.pos);
                let mut parser = Parser::new(self.src, self.pos + open).with_context(|| format!("line {}", line))?;
                let expr = parser.parse_expr().with_context(|| format!("line {}: invalid expression", line))?;
                let end = parser.offset();
                if !self.src[end..].starts_with(close) {
                    bail!("line {}: expected `{}` to close the mustache", line, close);
                }
                flush(&mut buf, &mut nodes);
                let source = self.src[self.pos + open..end].trim().to_string();
                nodes.push(Node::Output { expr, raw, line, source });
                self.pos = end + close.len();
                line_start = None;
                continue;
            }

            let c = rest.chars().next().unwrap();
            self.pos += c.len_utf8();
            if c == '\n' {
                if buf.ends_with('\r') {
                    buf.pop();
                }
                self.pending_nl = true;
                self.at_bol = true;
                self.last_line_tag = false;
                line_start = None;
            } else {
                buf.push(c);
                if !c.is_whitespace() {
                    line_start = None;
                }
            }
        }
        // Edge counts the empty line after a final line break too (the
        // renderer then trims one trailing newline).
        if self.at_bol && self.pending_nl {
            self.pending_nl = false;
            if self.drop_nl {
                self.drop_nl = false;
            } else {
                buf.push('\n');
            }
        }
        flush(&mut buf, &mut nodes);
        Ok((nodes, None))
    }

    /// Recognise a tag at `self.pos`. Unknown `@words` are left as text.
    fn try_tag(&mut self) -> Result<Option<Tag>> {
        let src = self.src;
        let mut p = self.pos + 1;
        let self_closing = src[p..].starts_with('!');
        if self_closing {
            p += 1;
        }
        let name_len = src[p..].find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(src.len() - p);
        let name = &src[p..p + name_len];
        if !TAGS.contains(&name) {
            return Ok(None);
        }
        p += name_len;
        let line = self.line_at(self.pos);

        let args = if matches!(name, "else" | "end") {
            TagArgs::None
        } else {
            let paren = src[p..].len() - src[p..].trim_start_matches([' ', '\t']).len();
            if !src[p + paren..].starts_with('(') {
                return Ok(None);
            }
            p += paren + 1;
            let mut parser = Parser::new(src, p).with_context(|| format!("line {}", line))?;
            let args = parse_tag_args(name, &mut parser).with_context(|| format!("line {}: invalid @{} arguments", line, name))?;
            p = parser.finish_at(")").with_context(|| format!("line {}: unclosed @{}(", line, name))?;
            args
        };

        // `~` swallows the whitespace that follows the tag.
        let swallow = src[p..].starts_with('~');
        if swallow {
            p += 1;
        }
        let after = &src[p..];
        let ws = after.len() - after.trim_start_matches([' ', '\t', '\r']).len();
        if after[ws..].starts_with('\n') {
            p += ws + 1;
        } else if ws == after.len() {
            p += ws;
        }
        self.pos = p;
        Ok(Some(Tag { name: name.to_string(), self_closing, args, line, swallow }))
    }

    fn block(&mut self, tag: Tag, tag_pos: usize) -> Result<Node> {
        let line = tag.line;
        let unclosed = |what: &str| anyhow!("line {}: @{} is never closed with @end", line, what);
        Ok(match tag.name.as_str() {
            "if" | "unless" => {
                let mut cond = tag.args.list().into_iter().next().ok_or_else(|| anyhow!("line {}: @{} needs a condition", line, tag.name))?;
                if tag.name == "unless" {
                    cond = Expr::Unary { op: UnOp::Not, expr: Box::new(cond) };
                }
                let mut branches = Vec::new();
                let mut otherwise = Vec::new();
                loop {
                    let (body, stop) = self.parse_nodes(&["elseif", "else", "end"])?;
                    let stop = stop.ok_or_else(|| unclosed(&tag.name))?;
                    branches.push((cond, body));
                    match stop.name.as_str() {
                        "elseif" => {
                            cond = stop.args.list().into_iter().next().ok_or_else(|| anyhow!("line {}: @elseif needs a condition", stop.line))?;
                        }
                        "else" => {
                            let (body, stop) = self.parse_nodes(&["end"])?;
                            stop.ok_or_else(|| unclosed(&tag.name))?;
                            otherwise = body;
                            break;
                        }
                        _ => break,
                    }
                }
                Node::If { branches, otherwise, line }
            }
            "each" => {
                let TagArgs::Each { item, index, iter } = tag.args else { unreachable!() };
                let (body, stop) = self.parse_nodes(&["else", "end"])?;
                let stop = stop.ok_or_else(|| unclosed("each"))?;
                let otherwise = if stop.name == "else" {
                    let (body, stop) = self.parse_nodes(&["end"])?;
                    stop.ok_or_else(|| unclosed("each"))?;
                    body
                } else {
                    Vec::new()
                };
                Node::Each { item, index, iter, body, otherwise, line }
            }
            "let" | "assign" => {
                let TagArgs::Binding { name, expr } = tag.args else { unreachable!() };
                Node::Let { name, expr, assign: tag.name == "assign", line }
            }
            "include" => {
                let path = tag.args.list().into_iter().next().ok_or_else(|| anyhow!("line {}: @include needs a path", line))?;
                Node::Include { cond: None, path, line }
            }
            "includeIf" => {
                let mut args = tag.args.list().into_iter();
                let (cond, path) = args.next().zip(args.next()).ok_or_else(|| anyhow!("line {}: @includeIf(condition, path)", line))?;
                Node::Include { cond: Some(cond), path, line }
            }
            "component" => {
                let mut args = tag.args.list().into_iter();
                let path = args.next().ok_or_else(|| anyhow!("line {}: @component needs a path", line))?;
                let props = args.next();
                let mut main = Vec::new();
                let mut slots = Vec::new();
                if !tag.self_closing {
                    loop {
                        let (body, stop) = self.parse_nodes(&["slot", "end"])?;
                        main.extend(body);
                        let stop = stop.ok_or_else(|| unclosed("component"))?;
                        if stop.name == "end" {
                            break;
                        }
                        let name = stop.args.list().into_iter().next().ok_or_else(|| anyhow!("line {}: @slot needs a name", stop.line))?;
                        let (body, end) = self.parse_nodes(&["end"])?;
                        end.ok_or_else(|| unclosed("slot"))?;
                        slots.push((name, body));
                    }
                }
                // Edge.js ignores the main slot's first newline.
                if let Some(Node::Text(t)) = main.first_mut() {
                    if let Some(rest) = t.strip_prefix('\n') {
                        *t = rest.to_string();
                    }
                }
                Node::Component { path, props, main, slots, line }
            }
            other => bail!("line {}: unsupported tag @{} at byte {}", line, other, tag_pos),
        })
    }
}

fn parse_tag_args(name: &str, p: &mut Parser) -> Result<TagArgs> {
    match name {
        "each" => {
            let (item, index) = if p.eat_punct("(")? {
                let item = p.ident()?;
                let index = if p.eat_punct(",")? { Some(p.ident()?) } else { None };
                p.expect_punct(")")?;
                (item, index)
            } else {
                (p.ident()?, None)
            };
            if !p.is_ident("in") {
                bail!("expected `in`");
            }
            p.ident()?;
            Ok(TagArgs::Each { item, index, iter: p.parse_expr()? })
        }
        "let" | "assign" => {
            let name = p.ident()?;
            p.expect_punct("=")?;
            Ok(TagArgs::Binding { name, expr: p.parse_expr()? })
        }
        _ => {
            let mut list = Vec::new();
            while !p.is_punct(")") {
                list.push(p.parse_expr()?);
                if !p.eat_punct(",")? {
                    break;
                }
            }
            Ok(TagArgs::List(list))
        }
    }
}

// ------------------------------------------------------------------ render

pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Edge.js escapes with `he.escape`, which writes these two in hex.
            '\'' => out.push_str("&#x27;"),
            '`' => out.push_str("&#x60;"),
            c => out.push(c),
        }
    }
    out
}

const MAX_DEPTH: usize = 64;

pub(crate) fn render_nodes(
    engine: &Engine,
    tpl: &str,
    nodes: &[Node],
    scope: &mut Scope,
    out: &mut String,
    depth: usize,
) -> Result<()> {
    let at = |line: &usize| format!("{}:{}", tpl, line);
    for node in nodes {
        match node {
            Node::Text(t) => out.push_str(t),
            Node::Output { expr, raw, line, source } => {
                let v = eval(expr, scope).with_context(|| at(line))?;
                if engine.strict && matches!(v, Value::Undefined) {
                    bail!("{}: `{}` is undefined (strict is on)", at(line), source);
                }
                let s = v.to_output();
                if *raw {
                    out.push_str(&s);
                } else {
                    out.push_str(&escape_html(&s));
                }
            }
            Node::If { branches, otherwise, line } => {
                let mut matched = false;
                for (cond, body) in branches {
                    if eval(cond, scope).with_context(|| at(line))?.truthy() {
                        render_nodes(engine, tpl, body, scope, out, depth)?;
                        matched = true;
                        break;
                    }
                }
                if !matched {
                    render_nodes(engine, tpl, otherwise, scope, out, depth)?;
                }
            }
            Node::Each { item, index, iter, body, otherwise, line } => {
                let list = eval(iter, scope).with_context(|| at(line))?;
                let entries: Vec<(Value, Value)> = match &list {
                    Value::Arr(a) => a.iter().enumerate().map(|(i, v)| (v.clone(), Value::from(i))).collect(),
                    Value::Obj(o) => o.iter().map(|(k, v)| (v.clone(), Value::str(k))).collect(),
                    Value::Str(s) => s.chars().enumerate().map(|(i, c)| (Value::from(c.to_string()), Value::from(i))).collect(),
                    v if v.is_nullish() => Vec::new(),
                    other => bail!("{}: cannot iterate over a {}", at(line), other.type_of()),
                };
                if entries.is_empty() {
                    render_nodes(engine, tpl, otherwise, scope, out, depth)?;
                }
                let total = entries.len();
                for (i, (v, k)) in entries.into_iter().enumerate() {
                    scope.push();
                    scope.declare(item, v);
                    if let Some(index) = index {
                        scope.declare(index, k);
                    }
                    scope.declare(
                        "$loop",
                        Value::from_pairs([
                            ("index", Value::from(i)),
                            ("total", Value::from(total)),
                            ("first", Value::Bool(i == 0)),
                            ("last", Value::Bool(i + 1 == total)),
                            ("isOdd", Value::Bool(i % 2 == 1)),
                            ("isEven", Value::Bool(i % 2 == 0)),
                        ]),
                    );
                    let r = render_nodes(engine, tpl, body, scope, out, depth);
                    scope.pop();
                    r?;
                }
            }
            Node::Let { name, expr, assign, line } => {
                let v = eval(expr, scope).with_context(|| at(line))?;
                if *assign {
                    scope.assign(name, v);
                } else {
                    scope.declare(name, v);
                }
            }
            Node::Include { cond, path, line } => {
                if let Some(cond) = cond {
                    if !eval(cond, scope).with_context(|| at(line))?.truthy() {
                        continue;
                    }
                }
                if depth >= MAX_DEPTH {
                    bail!("{}: includes nested too deeply (is there a loop?)", at(line));
                }
                let name = eval(path, scope).with_context(|| at(line))?.to_js_string();
                let partial = engine.template(&name).with_context(|| format!("{}: @include('{}')", at(line), name))?;
                render_nodes(engine, &partial.name, &partial.nodes, scope, out, depth + 1)
                    .with_context(|| format!("included from {}", at(line)))?;
            }
            Node::Component { path, props, main, slots, line } => {
                if depth >= MAX_DEPTH {
                    bail!("{}: components nested too deeply (is there a loop?)", at(line));
                }
                let name = eval(path, scope).with_context(|| at(line))?.to_js_string();
                let props = match props {
                    Some(p) => eval(p, scope).with_context(|| at(line))?,
                    None => Value::Undefined,
                };
                // Slots render eagerly in the caller's scope.
                let mut slot_fns = Map::new();
                let mut render_slot = |key: String, body: &[Node], scope: &mut Scope| -> Result<()> {
                    let mut s = String::new();
                    scope.push();
                    let r = render_nodes(engine, tpl, body, scope, &mut s, depth + 1);
                    scope.pop();
                    r?;
                    let html = Value::from(s);
                    slot_fns.insert(key, Value::func(move |_| Ok(html.clone())));
                    Ok(())
                };
                render_slot("main".into(), main, scope)?;
                for (slot_name, body) in slots {
                    let key = eval(slot_name, scope).with_context(|| at(line))?.to_js_string();
                    render_slot(key, body, scope)?;
                }

                let component = engine.template(&name).with_context(|| format!("{}: @component('{}')", at(line), name))?;
                // Components get an isolated scope: their props plus globals.
                let mut data: Map = props.as_object().cloned().unwrap_or_default();
                data.insert("$props".into(), if props.is_nullish() { Value::object(Map::new()) } else { props.clone() });
                data.insert("$slots".into(), Value::object(slot_fns));
                let mut child = Scope::new(Arc::new(data), scope.globals().clone());
                render_nodes(engine, &component.name, &component.nodes, &mut child, out, depth + 1)
                    .with_context(|| format!("in component used at {}", at(line)))?;
            }
        }
    }
    Ok(())
}
