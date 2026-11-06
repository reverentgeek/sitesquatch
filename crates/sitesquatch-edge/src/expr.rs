//! Parser for the JavaScript expression subset used inside Edge templates.
//!
//! Supported: literals, template strings, arrays/objects (with shorthand and
//! spread), member access, optional chaining, calls, `new Date()`, unary
//! (`! - + typeof await`), arithmetic, comparison, equality, `&& || ??`,
//! the ternary operator and single-expression arrow functions.

use std::sync::Arc;

use anyhow::{anyhow, bail, Result};

use crate::value::Value;

#[derive(Debug, Clone)]
pub enum Expr {
    Lit(Value),
    Ident(String),
    Template(Vec<TplPart>),
    Array(Vec<Item>),
    Object(Vec<Prop>),
    Chain { base: Box<Expr>, links: Vec<Link> },
    New { callee: String, args: Vec<Item> },
    Unary { op: UnOp, expr: Box<Expr> },
    Binary { op: BinOp, left: Box<Expr>, right: Box<Expr> },
    Logical { op: LogicOp, left: Box<Expr>, right: Box<Expr> },
    Cond { test: Box<Expr>, cons: Box<Expr>, alt: Box<Expr> },
    Arrow { params: Arc<Vec<String>>, body: Arc<Expr> },
}

#[derive(Debug, Clone)]
pub enum TplPart {
    Str(String),
    Expr(Expr),
}

#[derive(Debug, Clone)]
pub enum Item {
    Expr(Expr),
    Spread(Expr),
}

#[derive(Debug, Clone)]
pub enum Prop {
    Pair(PropKey, Expr),
    Spread(Expr),
}

#[derive(Debug, Clone)]
pub enum PropKey {
    Static(String),
    Computed(Expr),
}

#[derive(Debug, Clone)]
pub enum Link {
    /// `.name` / `?.name`
    Prop { name: String, optional: bool },
    /// `[expr]` / `?.[expr]`
    Index { expr: Expr, optional: bool },
    /// `(args)` / `?.(args)`
    Call { args: Vec<Item>, optional: bool },
}

#[derive(Debug, Clone, Copy)]
pub enum UnOp {
    Not,
    Neg,
    Plus,
    TypeOf,
    Await,
}

#[derive(Debug, Clone, Copy)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    Lt,
    Gt,
    Le,
    Ge,
    Eq,
    Ne,
    StrictEq,
    StrictNe,
}

#[derive(Debug, Clone, Copy)]
pub enum LogicOp {
    And,
    Or,
    Nullish,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Tpl(Vec<RawTpl>),
    Ident(String),
    Punct(&'static str),
    Eof,
}

#[derive(Debug, Clone, PartialEq)]
enum RawTpl {
    Str(String),
    Expr(String),
}

const PUNCTS: &[&str] = &[
    "===", "!==", "...", "?.", "??", "=>", "==", "!=", "<=", ">=", "&&", "||", "(", ")", "[", "]",
    "{", "}", ",", ".", "?", ":", "!", "<", ">", "+", "-", "*", "/", "%", "=",
];

/// Expression parser over a source string. It stops at the first token that
/// cannot continue the expression, so callers (the template parser) can resume
/// scanning from [`Parser::offset`].
#[derive(Clone)]
pub struct Parser<'a> {
    src: &'a str,
    pos: usize,
    tok: Tok,
    tok_start: usize,
}

impl<'a> Parser<'a> {
    pub fn new(src: &'a str, start: usize) -> Result<Self> {
        let mut p = Parser { src, pos: start, tok: Tok::Eof, tok_start: start };
        p.advance()?;
        Ok(p)
    }

    /// Byte offset of the first unconsumed token.
    pub fn offset(&self) -> usize {
        self.tok_start
    }

    pub fn is_punct(&self, p: &str) -> bool {
        matches!(&self.tok, Tok::Punct(x) if *x == p)
    }

    pub fn at_eof(&self) -> bool {
        self.tok == Tok::Eof
    }

    pub fn eat_punct(&mut self, p: &str) -> Result<bool> {
        if self.is_punct(p) {
            self.advance()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn expect_punct(&mut self, p: &str) -> Result<()> {
        if !self.eat_punct(p)? {
            bail!("expected `{}` but found {}", p, self.describe());
        }
        Ok(())
    }

    /// Check the current token is `p` *without* lexing past it, returning the
    /// byte offset just after it. Used where the template takes over again.
    pub fn finish_at(&self, p: &str) -> Result<usize> {
        if self.is_punct(p) {
            Ok(self.tok_start + p.len())
        } else {
            bail!("expected `{}` but found {}", p, self.describe())
        }
    }

    pub fn is_ident(&self, name: &str) -> bool {
        matches!(&self.tok, Tok::Ident(i) if i == name)
    }

    pub fn ident(&mut self) -> Result<String> {
        match self.tok.clone() {
            Tok::Ident(name) => {
                self.advance()?;
                Ok(name)
            }
            _ => bail!("expected an identifier but found {}", self.describe()),
        }
    }

    fn describe(&self) -> String {
        match &self.tok {
            Tok::Eof => "end of input".into(),
            Tok::Punct(p) => format!("`{}`", p),
            Tok::Ident(i) => format!("`{}`", i),
            Tok::Num(n) => format!("number {}", n),
            Tok::Str(_) | Tok::Tpl(_) => "a string".into(),
        }
    }

    // ---------------------------------------------------------------- lexer

    fn advance(&mut self) -> Result<()> {
        let bytes = self.src.as_bytes();
        while self.pos < bytes.len() && (bytes[self.pos] as char).is_ascii_whitespace() {
            self.pos += 1;
        }
        self.tok_start = self.pos;
        if self.pos >= bytes.len() {
            self.tok = Tok::Eof;
            return Ok(());
        }
        let rest = &self.src[self.pos..];
        let c = rest.chars().next().unwrap();

        if c.is_ascii_digit() || (c == '.' && rest[1..].starts_with(|d: char| d.is_ascii_digit())) {
            let len = rest
                .char_indices()
                .find(|&(i, ch)| {
                    !(ch.is_ascii_digit()
                        || ch == '.'
                        || ch == '_'
                        || ((ch == 'e' || ch == 'E') && i > 0)
                        || ((ch == '-' || ch == '+') && i > 0 && matches!(rest.as_bytes()[i - 1], b'e' | b'E')))
                })
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            let text = rest[..len].replace('_', "");
            let n = text.parse::<f64>().map_err(|_| anyhow!("invalid number `{}`", text))?;
            self.pos += len;
            self.tok = Tok::Num(n);
            return Ok(());
        }

        if c.is_alphabetic() || c == '_' || c == '$' {
            let len = rest
                .char_indices()
                .find(|&(_, ch)| !(ch.is_alphanumeric() || ch == '_' || ch == '$'))
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            self.tok = Tok::Ident(rest[..len].to_string());
            self.pos += len;
            return Ok(());
        }

        if c == '\'' || c == '"' {
            let (s, len) = lex_string(rest, c)?;
            self.pos += len;
            self.tok = Tok::Str(s);
            return Ok(());
        }

        if c == '`' {
            let (parts, len) = lex_template(rest)?;
            self.pos += len;
            self.tok = Tok::Tpl(parts);
            return Ok(());
        }

        for p in PUNCTS {
            if rest.starts_with(p) {
                // `a?.5:1` is a ternary, not optional chaining.
                if *p == "?." && rest[2..].starts_with(|d: char| d.is_ascii_digit()) {
                    continue;
                }
                self.pos += p.len();
                self.tok = Tok::Punct(p);
                return Ok(());
            }
        }
        bail!("unexpected character `{}`", c)
    }

    // --------------------------------------------------------------- parser

    pub fn parse_expr(&mut self) -> Result<Expr> {
        let test = self.parse_binary(0)?;
        if self.eat_punct("?")? {
            let cons = self.parse_expr()?;
            self.expect_punct(":")?;
            let alt = self.parse_expr()?;
            return Ok(Expr::Cond { test: Box::new(test), cons: Box::new(cons), alt: Box::new(alt) });
        }
        Ok(test)
    }

    fn binary_op(&self) -> Option<(u8, Result<LogicOp, BinOp>)> {
        let Tok::Punct(p) = &self.tok else { return None };
        Some(match *p {
            "??" => (1, Ok(LogicOp::Nullish)),
            "||" => (2, Ok(LogicOp::Or)),
            "&&" => (3, Ok(LogicOp::And)),
            "==" => (6, Err(BinOp::Eq)),
            "!=" => (6, Err(BinOp::Ne)),
            "===" => (6, Err(BinOp::StrictEq)),
            "!==" => (6, Err(BinOp::StrictNe)),
            "<" => (7, Err(BinOp::Lt)),
            ">" => (7, Err(BinOp::Gt)),
            "<=" => (7, Err(BinOp::Le)),
            ">=" => (7, Err(BinOp::Ge)),
            "+" => (9, Err(BinOp::Add)),
            "-" => (9, Err(BinOp::Sub)),
            "*" => (10, Err(BinOp::Mul)),
            "/" => (10, Err(BinOp::Div)),
            "%" => (10, Err(BinOp::Rem)),
            _ => return None,
        })
    }

    fn parse_binary(&mut self, min_prec: u8) -> Result<Expr> {
        let mut left = self.parse_unary()?;
        while let Some((prec, op)) = self.binary_op() {
            if prec <= min_prec {
                break;
            }
            self.advance()?;
            let right = self.parse_binary(prec)?;
            left = match op {
                Ok(op) => Expr::Logical { op, left: Box::new(left), right: Box::new(right) },
                Err(op) => Expr::Binary { op, left: Box::new(left), right: Box::new(right) },
            };
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr> {
        let op = match &self.tok {
            Tok::Punct("!") => Some(UnOp::Not),
            Tok::Punct("-") => Some(UnOp::Neg),
            Tok::Punct("+") => Some(UnOp::Plus),
            Tok::Ident(i) if i == "typeof" => Some(UnOp::TypeOf),
            Tok::Ident(i) if i == "await" => Some(UnOp::Await),
            _ => None,
        };
        if let Some(op) = op {
            self.advance()?;
            let expr = self.parse_unary()?;
            return Ok(Expr::Unary { op, expr: Box::new(expr) });
        }
        self.parse_postfix()
    }

    fn parse_postfix(&mut self) -> Result<Expr> {
        let base = self.parse_primary()?;
        let mut links = Vec::new();
        loop {
            if self.eat_punct(".")? {
                links.push(Link::Prop { name: self.ident()?, optional: false });
            } else if self.eat_punct("?.")? {
                if self.eat_punct("(")? {
                    links.push(Link::Call { args: self.parse_items(")")?, optional: true });
                } else if self.eat_punct("[")? {
                    let expr = self.parse_expr()?;
                    self.expect_punct("]")?;
                    links.push(Link::Index { expr, optional: true });
                } else {
                    links.push(Link::Prop { name: self.ident()?, optional: true });
                }
            } else if self.eat_punct("[")? {
                let expr = self.parse_expr()?;
                self.expect_punct("]")?;
                links.push(Link::Index { expr, optional: false });
            } else if self.eat_punct("(")? {
                links.push(Link::Call { args: self.parse_items(")")?, optional: false });
            } else {
                break;
            }
        }
        if links.is_empty() {
            Ok(base)
        } else {
            Ok(Expr::Chain { base: Box::new(base), links })
        }
    }

    /// Comma separated expressions (with spread) up to the closing punctuator.
    fn parse_items(&mut self, close: &str) -> Result<Vec<Item>> {
        let mut items = Vec::new();
        while !self.eat_punct(close)? {
            if self.eat_punct("...")? {
                items.push(Item::Spread(self.parse_expr()?));
            } else {
                items.push(Item::Expr(self.parse_expr()?));
            }
            if !self.eat_punct(",")? {
                self.expect_punct(close)?;
                break;
            }
        }
        Ok(items)
    }

    /// Try to parse `(a, b) =>`; on failure the parser state is unchanged.
    fn try_arrow_params(&mut self) -> Result<Option<Vec<String>>> {
        let saved = self.clone();
        let attempt = (|| -> Result<Option<Vec<String>>> {
            self.expect_punct("(")?;
            let mut params = Vec::new();
            while !self.eat_punct(")")? {
                params.push(self.ident()?);
                if !self.eat_punct(",")? {
                    self.expect_punct(")")?;
                    break;
                }
            }
            if self.eat_punct("=>")? {
                Ok(Some(params))
            } else {
                Ok(None)
            }
        })();
        match attempt {
            Ok(Some(params)) => Ok(Some(params)),
            _ => {
                *self = saved;
                Ok(None)
            }
        }
    }

    fn parse_primary(&mut self) -> Result<Expr> {
        match self.tok.clone() {
            Tok::Num(n) => {
                self.advance()?;
                Ok(Expr::Lit(Value::Num(n)))
            }
            Tok::Str(s) => {
                self.advance()?;
                Ok(Expr::Lit(Value::str(s)))
            }
            Tok::Tpl(raw) => {
                self.advance()?;
                let mut parts = Vec::new();
                for part in raw {
                    match part {
                        RawTpl::Str(s) => parts.push(TplPart::Str(s)),
                        RawTpl::Expr(src) => parts.push(TplPart::Expr(parse_complete(&src)?)),
                    }
                }
                Ok(Expr::Template(parts))
            }
            Tok::Ident(name) => {
                self.advance()?;
                match name.as_str() {
                    "true" => return Ok(Expr::Lit(Value::Bool(true))),
                    "false" => return Ok(Expr::Lit(Value::Bool(false))),
                    "null" => return Ok(Expr::Lit(Value::Null)),
                    "undefined" => return Ok(Expr::Lit(Value::Undefined)),
                    "new" => {
                        let callee = self.ident()?;
                        let args = if self.eat_punct("(")? { self.parse_items(")")? } else { Vec::new() };
                        return Ok(Expr::New { callee, args });
                    }
                    _ => {}
                }
                if self.eat_punct("=>")? {
                    let body = self.parse_expr()?;
                    return Ok(Expr::Arrow { params: Arc::new(vec![name]), body: Arc::new(body) });
                }
                Ok(Expr::Ident(name))
            }
            Tok::Punct("(") => {
                if let Some(params) = self.try_arrow_params()? {
                    let body = self.parse_expr()?;
                    return Ok(Expr::Arrow { params: Arc::new(params), body: Arc::new(body) });
                }
                self.advance()?;
                let e = self.parse_expr()?;
                self.expect_punct(")")?;
                Ok(e)
            }
            Tok::Punct("[") => {
                self.advance()?;
                Ok(Expr::Array(self.parse_items("]")?))
            }
            Tok::Punct("{") => {
                self.advance()?;
                let mut props = Vec::new();
                while !self.eat_punct("}")? {
                    if self.eat_punct("...")? {
                        props.push(Prop::Spread(self.parse_expr()?));
                    } else {
                        let key = match self.tok.clone() {
                            Tok::Ident(i) => {
                                self.advance()?;
                                PropKey::Static(i)
                            }
                            Tok::Str(s) => {
                                self.advance()?;
                                PropKey::Static(s)
                            }
                            Tok::Num(n) => {
                                self.advance()?;
                                PropKey::Static(crate::value::js_number(n))
                            }
                            Tok::Punct("[") => {
                                self.advance()?;
                                let e = self.parse_expr()?;
                                self.expect_punct("]")?;
                                PropKey::Computed(e)
                            }
                            _ => bail!("unexpected {} in object literal", self.describe()),
                        };
                        if self.eat_punct(":")? {
                            props.push(Prop::Pair(key, self.parse_expr()?));
                        } else if let PropKey::Static(name) = &key {
                            // shorthand `{ title }`
                            props.push(Prop::Pair(key.clone(), Expr::Ident(name.clone())));
                        } else {
                            bail!("computed object keys need a value");
                        }
                    }
                    if !self.eat_punct(",")? {
                        self.expect_punct("}")?;
                        break;
                    }
                }
                Ok(Expr::Object(props))
            }
            _ => bail!("unexpected {}", self.describe()),
        }
    }
}

/// Parse a string that must contain exactly one expression.
pub fn parse_complete(src: &str) -> Result<Expr> {
    let mut p = Parser::new(src, 0)?;
    let e = p.parse_expr()?;
    if !p.at_eof() {
        bail!("unexpected {} after expression", p.describe());
    }
    Ok(e)
}

fn lex_string(rest: &str, quote: char) -> Result<(String, usize)> {
    let mut out = String::new();
    let mut chars = rest.char_indices().skip(1);
    while let Some((i, c)) = chars.next() {
        if c == quote {
            return Ok((out, i + 1));
        }
        if c == '\\' {
            let (_, e) = chars.next().ok_or_else(|| anyhow!("unterminated string"))?;
            out.push(match e {
                'n' => '\n',
                't' => '\t',
                'r' => '\r',
                '0' => '\0',
                other => other,
            });
        } else {
            out.push(c);
        }
    }
    bail!("unterminated string literal")
}

fn lex_template(rest: &str) -> Result<(Vec<RawTpl>, usize)> {
    let bytes = rest.as_bytes();
    let mut parts = Vec::new();
    let mut buf = String::new();
    let mut i = 1;
    while i < bytes.len() {
        let c = rest[i..].chars().next().unwrap();
        if c == '`' {
            if !buf.is_empty() {
                parts.push(RawTpl::Str(buf));
            }
            return Ok((parts, i + 1));
        }
        if c == '\\' && i + 1 < bytes.len() {
            let e = rest[i + 1..].chars().next().unwrap();
            buf.push(if e == 'n' { '\n' } else { e });
            i += 1 + e.len_utf8();
            continue;
        }
        if rest[i..].starts_with("${") {
            if !buf.is_empty() {
                parts.push(RawTpl::Str(std::mem::take(&mut buf)));
            }
            let start = i + 2;
            let mut depth = 1;
            let mut j = start;
            let mut quote: Option<u8> = None;
            while j < bytes.len() {
                let b = bytes[j];
                match quote {
                    Some(_) if b == b'\\' => j += 1,
                    Some(q) if b == q => quote = None,
                    Some(_) => {}
                    None => match b {
                        b'\'' | b'"' | b'`' => quote = Some(b),
                        b'{' => depth += 1,
                        b'}' => {
                            depth -= 1;
                            if depth == 0 {
                                break;
                            }
                        }
                        _ => {}
                    },
                }
                j += 1;
            }
            if depth != 0 {
                bail!("unterminated `${{` in template literal");
            }
            parts.push(RawTpl::Expr(rest[start..j].to_string()));
            i = j + 1;
            continue;
        }
        buf.push(c);
        i += c.len_utf8();
    }
    bail!("unterminated template literal")
}
