//! Content schemas: what each kind of page's data has to look like.
//!
//! ```js
//! schemas: {
//!   posts: {                          // pages tagged `posts`
//!     fields: {
//!       title: "string",
//!       date: "date",
//!       description: "string?",       // optional
//!       status: "'draft' | 'published'",
//!       topics: "string[]",
//!       hero: { src: "file", alt: "string" },
//!       "author?": { name: "string", url: "string?" },
//!       slug: (value) => /^[a-z0-9-]+$/.test(value) || "must be lowercase letters, digits and dashes",
//!     },
//!     unknown: "error",               // front matter keys that aren't fields
//!   },
//!   docs: { files: "docs/**/*.md", fields: { title: "string", order: "integer?" } },
//! }
//! ```
//!
//! A schema applies to the pages with the tag it's named after (the pages in
//! that collection; `all` is every page in collections), or to the files its
//! `files` globs match. Every build checks each page's data (after the data
//! cascade and `computed`), and reports every problem together, naming the
//! file and the field.

use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};

use crate::{Func, Map, Value};

/// What to do about front matter keys that aren't one of the schema's fields.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unknown {
    Allow,
    Warn,
    Error,
}

#[derive(Clone)]
pub enum Type {
    Any,
    Str,
    Num,
    Int,
    Bool,
    Date,
    /// A path to a file that exists: from the input folder with a leading
    /// `/`, otherwise next to the page.
    File,
    /// Any object, or any list.
    AnyObject,
    AnyArray,
    Literal(Value),
    Union(Vec<Type>),
    Array(Box<Type>),
    Object(Vec<Field>),
    /// A function of (value, page data): `true` (or nothing) passes, a
    /// string is what's wrong, `false` is a plain "isn't valid".
    Check(Func),
}

#[derive(Clone)]
pub struct Field {
    pub name: String,
    pub optional: bool,
    pub ty: Type,
}

#[derive(Clone)]
enum Selector {
    Tag(String),
    Files(globset::GlobSet),
}

#[derive(Clone)]
pub struct Schema {
    pub name: String,
    selector: Selector,
    pub fields: Vec<Field>,
    pub unknown: Unknown,
}

/// Something wrong with one page's data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Problem {
    /// The field's path, like `hero.alt` or `topics[2]`.
    pub field: String,
    pub message: String,
    /// From `unknown: "warn"`: reported, but the build goes on.
    pub warning: bool,
}

/// Where a page is, for `file` fields.
pub struct PageFiles<'a> {
    pub input_dir: &'a Path,
    /// The folder the page's file is in.
    pub page_dir: &'a Path,
}

/// Front matter keys ssqch and its plugins read, which `unknown` never flags.
const BUILT_IN_KEYS: [&str; 17] = [
    "layout", "permalink", "dynamicPermalink", "tags", "date", "pagination", "computed", "render", "draft", "aliases", "excludeFromCollections", "sitemap", "nav", "title", "description", "templateEngineOverride", "lang",
];

// ------------------------------------------------------------------ parsing

struct TypeParser<'a> {
    src: &'a str,
    pos: usize,
}

const TYPE_NAMES: &str = "string, number, integer, boolean, date, file, object, array, any";

impl<'a> TypeParser<'a> {
    fn rest(&self) -> &'a str {
        &self.src[self.pos..]
    }

    fn skip_spaces(&mut self) {
        self.pos += self.rest().len() - self.rest().trim_start().len();
    }

    fn eat(&mut self, token: &str) -> bool {
        self.skip_spaces();
        if self.rest().starts_with(token) {
            self.pos += token.len();
            return true;
        }
        false
    }

    fn union(&mut self) -> Result<Type> {
        let mut types = vec![self.postfix()?];
        while self.eat("|") {
            types.push(self.postfix()?);
        }
        Ok(if types.len() == 1 { types.pop().unwrap() } else { Type::Union(types) })
    }

    fn postfix(&mut self) -> Result<Type> {
        let mut ty = self.primary()?;
        while self.eat("[]") {
            ty = Type::Array(Box::new(ty));
        }
        Ok(ty)
    }

    fn primary(&mut self) -> Result<Type> {
        self.skip_spaces();
        let rest = self.rest();
        let Some(first) = rest.chars().next() else { bail!("a type is missing (types: {})", TYPE_NAMES) };
        if first == '(' {
            self.pos += 1;
            let ty = self.union()?;
            if !self.eat(")") {
                bail!("a `(` has no `)`");
            }
            return Ok(ty);
        }
        if first == '\'' || first == '"' {
            let Some(end) = rest[1..].find(first) else { bail!("a quoted value has no closing {}", first) };
            self.pos += end + 2;
            return Ok(Type::Literal(Value::from(&rest[1..end + 1])));
        }
        let len = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')).unwrap_or(rest.len());
        let word = &rest[..len];
        self.pos += len;
        Ok(match word {
            "string" => Type::Str,
            "number" => Type::Num,
            "integer" => Type::Int,
            "boolean" => Type::Bool,
            "date" => Type::Date,
            "file" => Type::File,
            "object" => Type::AnyObject,
            "array" => Type::AnyArray,
            "any" => Type::Any,
            "true" => Type::Literal(Value::Bool(true)),
            "false" => Type::Literal(Value::Bool(false)),
            "null" => Type::Literal(Value::Null),
            "" => bail!("unexpected {:?} (types: {})", first, TYPE_NAMES),
            other => match other.parse::<f64>() {
                Ok(n) => Type::Literal(Value::Num(n)),
                Err(_) => bail!("unknown type {:?} (types: {}; quote a literal value, like \"'draft' | 'published'\")", other, TYPE_NAMES),
            },
        })
    }
}

/// A type written as a string: `string`, `string?`, `string[]`,
/// `'draft' | 'published'`, `(string | number)[]`. Returns the type and
/// whether it ended in `?` (optional).
pub fn parse_type(src: &str) -> Result<(Type, bool)> {
    let trimmed = src.trim();
    let (body, optional) = match trimmed.strip_suffix('?') {
        Some(body) => (body, true),
        None => (trimmed, false),
    };
    let mut parser = TypeParser { src: body, pos: 0 };
    let ty = parser.union()?;
    parser.skip_spaces();
    if !parser.rest().is_empty() {
        bail!("unexpected {:?} in type {:?}", parser.rest(), src);
    }
    Ok((ty, optional))
}

fn parse_fields(spec: &Value, at: &str) -> Result<Vec<Field>> {
    let Some(map) = spec.as_object() else { bail!("{} must be an object of {{ field: type }}, not {}", at, spec.type_of()) };
    let mut fields = Vec::new();
    for (key, value) in map {
        let (name, key_optional) = match key.strip_suffix('?') {
            Some(name) => (name, true),
            None => (key.as_str(), false),
        };
        let path = format!("{}.{}", at, name);
        let (ty, optional) = parse_field_type(value, &path)?;
        fields.push(Field { name: name.to_string(), optional: optional || key_optional, ty });
    }
    Ok(fields)
}

fn parse_field_type(value: &Value, at: &str) -> Result<(Type, bool)> {
    Ok(match value {
        Value::Str(s) => parse_type(s).with_context(|| at.to_string())?,
        Value::Func(f) => (Type::Check(f.clone()), false),
        Value::Obj(_) => (Type::Object(parse_fields(value, at)?), false),
        Value::Arr(items) => match items.as_slice() {
            [one] => (Type::Array(Box::new(parse_field_type(one, &format!("{}[]", at))?.0)), false),
            _ => bail!("{}: a list type has one item, the type of each entry, like [\"string\"] or [{{ name: \"string\" }}]", at),
        },
        other => bail!("{} must be a type (\"string\"), an object of fields, a one-item list, or a function, not {}", at, other.type_of()),
    })
}

impl Schema {
    /// A schema from its config value: `{ fields, files, unknown }`.
    pub fn parse(name: &str, spec: &Value) -> Result<Schema> {
        let at = format!("schemas.{}", name);
        let Some(map) = spec.as_object() else { bail!("{} must be an object with `fields`, not {}", at, spec.type_of()) };
        if let Some(key) = map.keys().find(|k| !["fields", "files", "unknown"].contains(&k.as_str())) {
            bail!("{}: \"{}\" isn't an option (options: fields, files, unknown); a schema's fields go in `fields`", at, key);
        }
        let fields = match map.get("fields") {
            Some(f) => parse_fields(f, &format!("{}.fields", at))?,
            None => bail!("{} needs `fields`: {{ title: \"string\", date: \"date\" }}", at),
        };
        let selector = match map.get("files").filter(|v| !v.is_nullish()) {
            None => Selector::Tag(name.to_string()),
            Some(v) => {
                let globs: Vec<String> = match v {
                    Value::Str(s) => vec![s.to_string()],
                    Value::Arr(a) => a.iter().map(|g| g.as_str().map(String::from).ok_or_else(|| anyhow!("{}.files must be a glob or a list of globs", at))).collect::<Result<_>>()?,
                    other => bail!("{}.files must be a glob or a list of globs, not {}", at, other.type_of()),
                };
                let mut set = globset::GlobSetBuilder::new();
                for g in &globs {
                    set.add(globset::GlobBuilder::new(g.trim_start_matches("./")).literal_separator(true).build().with_context(|| format!("{}.files: invalid glob {:?}", at, g))?);
                }
                Selector::Files(set.build()?)
            }
        };
        let unknown = match map.get("unknown").filter(|v| !v.is_nullish()).map(|v| v.to_js_string()).as_deref() {
            None | Some("allow") => Unknown::Allow,
            Some("warn") => Unknown::Warn,
            Some("error") => Unknown::Error,
            Some(other) => bail!("{}.unknown must be \"allow\", \"warn\" or \"error\", not {:?}", at, other),
        };
        Ok(Schema { name: name.to_string(), selector, fields, unknown })
    }

    /// Whether this schema covers a page: `rel` is its file's path from the
    /// input folder, `tags` its tags (empty when it's kept out of collections).
    pub fn covers(&self, rel: &str, tags: &[&str], in_collections: bool) -> bool {
        match &self.selector {
            Selector::Tag(tag) => in_collections && (tag == "all" || tags.contains(&tag.as_str())),
            Selector::Files(set) => set.is_match(rel),
        }
    }

    /// Check a page's data. `front_keys` are the keys in the page's own
    /// front matter, for `unknown`.
    pub fn check(&self, data: &Map, front_keys: &[String], files: &PageFiles) -> Vec<Problem> {
        let mut problems = Vec::new();
        let page = Value::object(data.clone());
        check_fields(&self.fields, data, "", &page, files, &mut problems);
        if self.unknown != Unknown::Allow {
            for key in front_keys {
                if self.fields.iter().any(|f| f.name == *key) || BUILT_IN_KEYS.contains(&key.as_str()) {
                    continue;
                }
                let hint = crate::suggest::closest(key, self.fields.iter().map(|f| f.name.as_str())).map(|name| format!(" (did you mean `{}`?)", name)).unwrap_or_default();
                problems.push(Problem { field: key.clone(), message: format!("`{}` isn't a field of this schema{}", key, hint), warning: self.unknown == Unknown::Warn });
            }
        }
        problems
    }

    /// The schema as a TypeScript type, for `ssqch types`.
    pub fn typescript(&self) -> String {
        object_ts(&self.fields, 2)
    }
}

// ----------------------------------------------------------------- checking

fn check_fields(fields: &[Field], data: &Map, prefix: &str, page: &Value, files: &PageFiles, out: &mut Vec<Problem>) {
    for field in fields {
        let path = if prefix.is_empty() { field.name.clone() } else { format!("{}.{}", prefix, field.name) };
        let value = data.get(&field.name).cloned().unwrap_or(Value::Undefined);
        if let Type::Check(_) = field.ty {
            check_value(&field.ty, &value, &path, page, files, out);
            continue;
        }
        if value.is_nullish() {
            let null_ok = matches!(value, Value::Null) && accepts_null(&field.ty);
            if !field.optional && !null_ok {
                out.push(Problem { field: path.clone(), message: format!("`{}` is required ({})", path, describe(&field.ty)), warning: false });
            }
            continue;
        }
        check_value(&field.ty, &value, &path, page, files, out);
    }
}

fn accepts_null(ty: &Type) -> bool {
    match ty {
        Type::Any => true,
        Type::Literal(v) => matches!(v, Value::Null),
        Type::Union(types) => types.iter().any(accepts_null),
        _ => false,
    }
}

/// Whether `value` is of `ty`, without the details (for unions).
fn matches(ty: &Type, value: &Value, page: &Value, files: &PageFiles) -> bool {
    let mut problems = Vec::new();
    check_value(ty, value, "", page, files, &mut problems);
    problems.is_empty()
}

fn check_value(ty: &Type, value: &Value, path: &str, page: &Value, files: &PageFiles, out: &mut Vec<Problem>) {
    let mut wrong = |message: String| out.push(Problem { field: path.to_string(), message, warning: false });
    let mismatch = || format!("`{}` must be {}, not {}", path, describe(ty), show(value));
    match ty {
        Type::Any => {}
        Type::Str => {
            if !matches!(value, Value::Str(_)) {
                wrong(mismatch());
            }
        }
        Type::Num => {
            if !matches!(value, Value::Num(n) if !n.is_nan()) {
                wrong(mismatch());
            }
        }
        Type::Int => {
            if !matches!(value, Value::Num(n) if n.fract() == 0.0) {
                wrong(mismatch());
            }
        }
        Type::Bool => {
            if !matches!(value, Value::Bool(_)) {
                wrong(mismatch());
            }
        }
        Type::Date => {
            let ok = match value {
                Value::Date(_) => true,
                Value::Str(_) => value.to_date().is_some(),
                _ => false,
            };
            if !ok {
                wrong(mismatch());
            }
        }
        Type::File => match value.as_str() {
            Some(s) if !s.trim().is_empty() => {
                let clean = s.split(['?', '#']).next().unwrap_or(s);
                let found = match clean.strip_prefix('/') {
                    Some(from_root) => files.input_dir.join(from_root).is_file(),
                    None => files.page_dir.join(clean).is_file(),
                };
                if !found {
                    let whence = if clean.starts_with('/') { "in the input folder" } else { "next to the page" };
                    wrong(format!("`{}` is {:?}, but there's no such file {}", path, s, whence));
                }
            }
            _ => wrong(mismatch()),
        },
        Type::AnyObject => {
            if !matches!(value, Value::Obj(_)) {
                wrong(mismatch());
            }
        }
        Type::AnyArray => {
            if !matches!(value, Value::Arr(_)) {
                wrong(mismatch());
            }
        }
        Type::Literal(expected) => {
            if !expected.strict_eq(value) {
                wrong(mismatch());
            }
        }
        Type::Union(types) => {
            if !types.iter().any(|t| matches(t, value, page, files)) {
                wrong(mismatch());
            }
        }
        Type::Array(item) => match value {
            Value::Arr(items) => {
                for (i, v) in items.iter().enumerate() {
                    check_value(item, v, &format!("{}[{}]", path, i), page, files, out);
                }
            }
            _ => wrong(mismatch()),
        },
        Type::Object(fields) => match value {
            Value::Obj(map) => check_fields(fields, map, path, page, files, out),
            _ => wrong(mismatch()),
        },
        Type::Check(f) => match f.call(&[value.clone(), page.clone()]) {
            Ok(Value::Bool(true)) | Ok(Value::Undefined) | Ok(Value::Null) => {}
            Ok(Value::Str(message)) => wrong(format!("`{}` {}", path, message)),
            Ok(Value::Bool(false)) => wrong(format!("`{}` isn't valid ({})", path, show(value))),
            Ok(other) => wrong(format!("`{}`: the check returned {}; return true, false or a message", path, other.type_of())),
            Err(e) => wrong(format!("`{}`: the check failed: {:#}", path, e)),
        },
    }
}

/// A type in words, for "must be ...".
fn describe(ty: &Type) -> String {
    match ty {
        Type::Any => "set".into(),
        Type::Str => "a string".into(),
        Type::Num => "a number".into(),
        Type::Int => "a whole number".into(),
        Type::Bool => "true or false".into(),
        Type::Date => "a date, like 2026-03-14".into(),
        Type::File => "a path to a file".into(),
        Type::AnyObject => "an object".into(),
        Type::AnyArray => "a list".into(),
        Type::Literal(v) => show(v),
        Type::Union(types) => {
            let parts: Vec<String> = types.iter().map(describe).collect();
            match parts.split_last() {
                Some((last, rest)) if !rest.is_empty() => format!("{} or {}", rest.join(", "), last),
                _ => parts.join(""),
            }
        }
        Type::Array(item) => match &**item {
            Type::Str => "a list of strings".into(),
            Type::Num | Type::Int => "a list of numbers".into(),
            Type::Object(_) | Type::AnyObject => "a list of objects".into(),
            _ => "a list".into(),
        },
        Type::Object(_) => "an object".into(),
        Type::Check(_) => "valid".into(),
    }
}

/// A value, short enough for an error message.
fn show(value: &Value) -> String {
    match value {
        Value::Undefined => "missing".into(),
        Value::Null => "null".into(),
        Value::Str(s) => {
            let short: String = s.chars().take(60).collect();
            format!("{:?}{}", short, if s.chars().count() > 60 { "..." } else { "" })
        }
        Value::Num(_) | Value::Bool(_) => value.to_js_string(),
        Value::Date(d) => format!("the date {}", d.format("%Y-%m-%d")),
        Value::Arr(_) => "a list".into(),
        Value::Obj(_) => "an object".into(),
        Value::Func(_) => "a function".into(),
    }
}

// --------------------------------------------------------------- TypeScript

fn key_ts(name: &str) -> String {
    let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') && !name.starts_with(|c: char| c.is_ascii_digit());
    if plain { name.to_string() } else { format!("{:?}", name) }
}

fn object_ts(fields: &[Field], depth: usize) -> String {
    if fields.is_empty() {
        return "{}".into();
    }
    let indent = "\t".repeat(depth + 1);
    let mut out = String::from("{\n");
    for f in fields {
        out.push_str(&format!("{}{}{}: {};\n", indent, key_ts(&f.name), if f.optional { "?" } else { "" }, type_ts(&f.ty, depth + 1)));
    }
    out.push_str(&format!("{}}}", "\t".repeat(depth)));
    out
}

fn type_ts(ty: &Type, depth: usize) -> String {
    match ty {
        Type::Any => "any".into(),
        Type::Str | Type::File => "string".into(),
        Type::Num | Type::Int => "number".into(),
        Type::Bool => "boolean".into(),
        Type::Date => "Date | string".into(),
        Type::AnyObject => "Record<string, any>".into(),
        Type::AnyArray => "any[]".into(),
        Type::Literal(v) => match v {
            Value::Str(s) => format!("{:?}", &**s),
            other => other.to_js_string(),
        },
        Type::Union(types) => types.iter().map(|t| type_ts(t, depth)).collect::<Vec<_>>().join(" | "),
        Type::Array(item) => match &**item {
            Type::Union(_) | Type::Date => format!("({})[]", type_ts(item, depth)),
            _ => format!("{}[]", type_ts(item, depth)),
        },
        Type::Object(fields) => object_ts(fields, depth),
        Type::Check(_) => "any".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(json: serde_json::Value) -> Value {
        Value::from(json)
    }

    fn problems(schema: &Schema, data: serde_json::Value, front_keys: &[&str]) -> Vec<String> {
        let dir = std::env::temp_dir();
        let files = PageFiles { input_dir: &dir, page_dir: &dir };
        let keys: Vec<String> = front_keys.iter().map(|k| k.to_string()).collect();
        schema.check(value(data).as_object().unwrap(), &keys, &files).into_iter().map(|p| format!("{}{}", if p.warning { "warn: " } else { "" }, p.message)).collect()
    }

    #[test]
    fn types_parse() {
        for ok in ["string", "string?", "string[]", "(string | number)[]", "'draft' | 'published'", "\"a\" | 1 | true | null", " integer ? ", "date", "file", "object", "array", "any", "string[][]"] {
            assert!(parse_type(ok).is_ok(), "{}", ok);
        }
        assert!(parse_type("string?").unwrap().1);
        for (bad, why) in [("strng", "unknown type \"strng\""), ("string |", "a type is missing"), ("(string", "a `(` has no `)`"), ("'draft", "no closing '"), ("string number", "unexpected \"number\"")] {
            let e = parse_type(bad).err().map(|e| format!("{:#}", e)).unwrap_or_default();
            assert!(e.contains(why), "{}: {}", bad, e);
        }
    }

    #[test]
    fn data_is_checked_against_fields() {
        let spec = value(serde_json::json!({
            "fields": {
                "title": "string",
                "date": "date",
                "description": "string?",
                "status": "'draft' | 'published'",
                "topics": "string[]",
                "weight": "integer?",
                "hero": { "src": "string", "alt": "string" },
                "author?": { "name": "string" },
                "links": [{ "href": "string" }],
            },
            "unknown": "error",
        }));
        let schema = Schema::parse("posts", &spec).unwrap();
        let good = serde_json::json!({ "title": "Pine", "date": "2026-03-14", "status": "draft", "topics": ["trees"], "hero": { "src": "/a.png", "alt": "A" }, "links": [], "site": { "name": "global data is fine" } });
        assert_eq!(problems(&schema, good, &["title", "date", "layout", "tags"]), Vec::<String>::new());

        let bad = serde_json::json!({ "title": 7, "date": "tomorrow", "description": null, "status": "drfat", "topics": ["trees", 2], "weight": 1.5, "hero": { "src": "/a.png" }, "author": "Sam", "links": [{ "href": 1 }], "descripton": "x" });
        assert_eq!(
            problems(&schema, bad, &["title", "descripton", "zebra"]),
            [
                "`title` must be a string, not 7",
                "`date` must be a date, like 2026-03-14, not \"tomorrow\"",
                "`status` must be \"draft\" or \"published\", not \"drfat\"",
                "`topics[1]` must be a string, not 2",
                "`weight` must be a whole number, not 1.5",
                "`hero.alt` is required (a string)",
                "`author` must be an object, not \"Sam\"",
                "`links[0].href` must be a string, not 1",
                "`descripton` isn't a field of this schema (did you mean `description`?)",
                "`zebra` isn't a field of this schema",
            ]
        );
        assert_eq!(problems(&schema, serde_json::json!({}), &[]).len(), 6);
    }

    #[test]
    fn schemas_cover_tags_or_files() {
        let by_tag = Schema::parse("posts", &value(serde_json::json!({ "fields": {} }))).unwrap();
        assert!(by_tag.covers("posts/a.md", &["posts"], true));
        assert!(!by_tag.covers("posts/a.md", &["notes"], true));
        assert!(!by_tag.covers("posts/a.md", &["posts"], false));
        let by_file = Schema::parse("docs", &value(serde_json::json!({ "files": ["docs/**/*.md"], "fields": {}, "unknown": "warn" }))).unwrap();
        assert!(by_file.covers("docs/a/b.md", &[], false));
        assert!(!by_file.covers("posts/a.md", &["docs"], true));
        assert_eq!(by_file.unknown, Unknown::Warn);
        let all = Schema::parse("all", &value(serde_json::json!({ "fields": {} }))).unwrap();
        assert!(all.covers("x.md", &[], true));

        for (spec, why) in [
            (serde_json::json!({ "title": "string" }), "\"title\" isn't an option (options: fields, files, unknown); a schema's fields go in `fields`"),
            (serde_json::json!({}), "schemas.posts needs `fields`"),
            (serde_json::json!({ "fields": { "title": "text" } }), "schemas.posts.fields.title: unknown type \"text\""),
            (serde_json::json!({ "fields": { "title": 1 } }), "schemas.posts.fields.title must be a type"),
            (serde_json::json!({ "fields": {}, "unknown": "ignore" }), "schemas.posts.unknown must be \"allow\", \"warn\" or \"error\""),
            (serde_json::json!({ "fields": { "a": ["string", "number"] } }), "a list type has one item"),
        ] {
            let e = Schema::parse("posts", &value(spec)).err().map(|e| format!("{:#}", e)).unwrap_or_default();
            assert!(e.contains(why), "{}", e);
        }
    }

    #[test]
    fn files_have_to_exist() {
        let dir = std::env::temp_dir().join(format!("ssqch-schema-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("posts/pine")).unwrap();
        std::fs::write(dir.join("posts/pine/photo.jpg"), "x").unwrap();
        std::fs::write(dir.join("logo.svg"), "x").unwrap();
        let schema = Schema::parse("posts", &value(serde_json::json!({ "fields": { "photo": "file", "logo": "file", "missing": "file" } }))).unwrap();
        let page_dir = dir.join("posts/pine");
        let files = PageFiles { input_dir: &dir, page_dir: &page_dir };
        let data = value(serde_json::json!({ "photo": "photo.jpg", "logo": "/logo.svg?v=2", "missing": "/nope.png" }));
        let found: Vec<String> = schema.check(data.as_object().unwrap(), &[], &files).into_iter().map(|p| p.message).collect();
        assert_eq!(found, ["`missing` is \"/nope.png\", but there's no such file in the input folder"]);
    }

    #[test]
    fn functions_check_values() {
        let mut fields = Map::new();
        fields.insert(
            "slug".into(),
            Value::func(|args| {
                let ok = args[0].as_str().is_some_and(|s| s.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
                Ok(if ok { Value::Bool(true) } else { Value::from("must be lowercase letters and dashes") })
            }),
        );
        fields.insert("flag".into(), Value::func(|args| Ok(Value::Bool(args[0].truthy()))));
        let mut spec = Map::new();
        spec.insert("fields".into(), Value::object(fields));
        let schema = Schema::parse("posts", &Value::object(spec)).unwrap();
        assert_eq!(problems(&schema, serde_json::json!({ "slug": "pine-cone", "flag": true }), &[]), Vec::<String>::new());
        assert_eq!(problems(&schema, serde_json::json!({ "slug": "Pine Cone" }), &[]), ["`slug` must be lowercase letters and dashes", "`flag` isn't valid (missing)"]);
    }

    #[test]
    fn schemas_become_typescript() {
        let spec = value(serde_json::json!({ "fields": { "title": "string", "date": "date", "status": "'draft' | 'published'", "topics": "string[]", "hero?": { "src": "file", "alt": "string?" }, "og:image": "string?", "links": [{ "href": "string" }] } }));
        let schema = Schema::parse("posts", &spec).unwrap();
        assert_eq!(
            schema.typescript(),
            "{\n\t\t\ttitle: string;\n\t\t\tdate: Date | string;\n\t\t\tstatus: \"draft\" | \"published\";\n\t\t\ttopics: string[];\n\t\t\thero?: {\n\t\t\t\tsrc: string;\n\t\t\t\talt?: string;\n\t\t\t};\n\t\t\t\"og:image\"?: string;\n\t\t\tlinks: {\n\t\t\t\thref: string;\n\t\t\t}[];\n\t\t}"
        );
    }
}
