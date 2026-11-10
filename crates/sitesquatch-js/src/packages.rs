//! npm packages: finding them in `node_modules`, reading `package.json`
//! (`exports`, `imports`, `main`, `type`), and telling CommonJS files from
//! ES modules, the way Node does.

use std::path::{Path, PathBuf};

use serde_json::Value as Json;

/// How a module is being loaded, which picks the `exports` conditions.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Import,
    Require,
}

impl Kind {
    fn conditions(self) -> &'static [&'static str] {
        match self {
            Kind::Import => &["import", "node", "default"],
            Kind::Require => &["require", "node", "default"],
        }
    }
}

/// What kind of source a file holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Format {
    Esm,
    CommonJs,
    Json,
}

/// Is `name` a package specifier (`luxon`, `@scope/pkg/sub`), rather than
/// a path or a URL?
pub(crate) fn is_bare(name: &str) -> bool {
    !(name.is_empty() || name.starts_with("./") || name.starts_with("../") || name == "." || name == ".." || name.starts_with('/') || name.starts_with('#') || Path::new(name).is_absolute() || name.contains(':'))
}

/// `@scope/pkg/a/b` into `("@scope/pkg", "./a/b")`; `pkg` into `("pkg", ".")`.
fn split_package(spec: &str) -> Option<(&str, String)> {
    let mut parts = spec.splitn(if spec.starts_with('@') { 3 } else { 2 }, '/');
    let first = parts.next()?;
    let name_len = if spec.starts_with('@') { first.len() + 1 + parts.next().filter(|s| !s.is_empty())?.len() } else { first.len() };
    let rest = &spec[name_len..];
    let sub = if rest.is_empty() { ".".to_string() } else { format!(".{}", rest) };
    Some((&spec[..name_len], sub))
}

fn read_package_json(dir: &Path) -> Result<Option<Json>, String> {
    let path = dir.join("package.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| format!("{}: invalid JSON: {}", path.display(), e)),
        Err(_) => Ok(None),
    }
}

/// The nearest `package.json` at or above `dir`, and the folder it's in.
fn nearest_package_json(dir: &Path) -> Option<(PathBuf, Json)> {
    dir.ancestors().find_map(|d| read_package_json(d).ok().flatten().map(|json| (d.to_path_buf(), json)))
}

/// Resolve a package specifier imported from a file in `from_dir`, looking
/// in each `node_modules` folder from there up.
pub(crate) fn resolve_bare(from_dir: &Path, spec: &str, kind: Kind) -> Result<PathBuf, String> {
    let (name, sub) = split_package(spec).ok_or_else(|| format!("\"{}\" isn't a valid package name", spec))?;
    for dir in from_dir.ancestors() {
        let package = dir.join("node_modules").join(name);
        if package.is_dir() {
            return resolve_in_package(&package, name, &sub, kind);
        }
    }
    Err(format!("package \"{}\" isn't installed (no node_modules/{} folder here or in a parent folder; run npm install)", name, name))
}

fn resolve_in_package(dir: &Path, name: &str, sub: &str, kind: Kind) -> Result<PathBuf, String> {
    let json = read_package_json(dir)?.unwrap_or(Json::Null);
    if let Some(exports) = json.get("exports").filter(|e| !e.is_null()) {
        let target = resolve_map(exports, sub, kind, true).ok_or_else(|| {
            let what = if sub == "." { "its main entry".to_string() } else { format!("\"{}\"", sub) };
            format!("package \"{}\" doesn't export {} for {} (see the \"exports\" in its package.json)", name, what, if kind == Kind::Import { "import" } else { "require" })
        })?;
        let path = dir.join(target.trim_start_matches("./"));
        return if path.is_file() { Ok(path) } else { Err(format!("package \"{}\" exports \"{}\", which doesn't exist", name, target)) };
    }
    let found = if sub == "." {
        let main = json.get("main").and_then(Json::as_str).filter(|m| !m.is_empty());
        main.and_then(|m| file_or_folder(&dir.join(m))).or_else(|| file_or_folder(dir))
    } else {
        file_or_folder(&dir.join(sub.trim_start_matches("./")))
    };
    found.ok_or_else(|| format!("package \"{}\" has no file for \"{}\"", name, if sub == "." { name.to_string() } else { format!("{}/{}", name, &sub[2..]) }))
}

/// `#internal` specifiers, from the `imports` of the importing file's
/// `package.json`.
pub(crate) fn resolve_imports(from_dir: &Path, spec: &str, kind: Kind) -> Result<PathBuf, String> {
    let (dir, json) = nearest_package_json(from_dir).ok_or_else(|| format!("\"{}\" needs a package.json with \"imports\"", spec))?;
    let imports = json.get("imports").ok_or_else(|| format!("\"{}\": {} has no \"imports\"", spec, dir.join("package.json").display()))?;
    let target = resolve_map(imports, spec, kind, false).ok_or_else(|| format!("\"{}\" isn't in the \"imports\" of {}", spec, dir.join("package.json").display()))?;
    if target.starts_with("./") {
        let path = dir.join(target.trim_start_matches("./"));
        if path.is_file() { Ok(path) } else { Err(format!("\"{}\" maps to \"{}\", which doesn't exist", spec, target)) }
    } else {
        resolve_bare(&dir, &target, kind)
    }
}

/// Look `key` up in an `exports` or `imports` map: exact keys first, then
/// `*` patterns (the longest prefix wins), then folder keys ending in `/`.
fn resolve_map(map: &Json, key: &str, kind: Kind, exports: bool) -> Option<String> {
    let subpaths = map.as_object().filter(|o| o.keys().next().is_some_and(|k| k.starts_with(if exports { '.' } else { '#' })));
    let Some(entries) = subpaths else {
        // `"exports": "./index.js"` or a conditions object: the main entry only.
        return if exports && key == "." { target(map, "", kind) } else { None };
    };
    if let Some(value) = entries.get(key).filter(|_| !key.contains('*')) {
        return target(value, "", kind);
    }
    let mut best: Option<(&str, &Json, String)> = None;
    for (pattern, value) in entries {
        let matched = if let Some((prefix, suffix)) = pattern.split_once('*') {
            key.strip_prefix(prefix).and_then(|rest| rest.strip_suffix(suffix)).filter(|_| key.len() >= prefix.len() + suffix.len()).map(str::to_string)
        } else if pattern.ends_with('/') {
            key.strip_prefix(pattern.as_str()).map(|rest| format!("\0{}", rest))
        } else {
            None
        };
        if let Some(m) = matched {
            if best.as_ref().is_none_or(|(p, _, _)| pattern.len() > p.len()) {
                best = Some((pattern, value, m));
            }
        }
    }
    let (_, value, matched) = best?;
    match matched.strip_prefix('\0') {
        Some(rest) => target(value, "", kind).map(|t| format!("{}{}", t, rest)),
        None => target(value, &matched, kind),
    }
}

/// A target: a path (with `*` filled in), the first match in an array, or
/// the first condition in a conditions object that applies.
fn target(value: &Json, star: &str, kind: Kind) -> Option<String> {
    match value {
        Json::String(s) => Some(s.replace('*', star)),
        Json::Array(items) => items.iter().find_map(|v| target(v, star, kind)),
        Json::Object(conditions) => conditions.iter().filter(|(k, _)| kind.conditions().contains(&k.as_str())).find_map(|(_, v)| target(v, star, kind)),
        _ => None,
    }
}

/// A file as named, with an extension added, or a folder's entry point
/// (its `package.json` `main`, or `index.js`).
pub(crate) fn file_or_folder(path: &Path) -> Option<PathBuf> {
    let with_ext = |ext: &str| {
        let mut p = path.as_os_str().to_owned();
        p.push(ext);
        PathBuf::from(p)
    };
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    if let Some(found) = [".js", ".mjs", ".cjs", ".json"].into_iter().map(with_ext).find(|p| p.is_file()) {
        return Some(found);
    }
    if path.is_dir() {
        if let Some(main) = read_package_json(path).ok().flatten().as_ref().and_then(|j| j.get("main")).and_then(Json::as_str).filter(|m| !m.is_empty()) {
            let main = path.join(main);
            if main != path {
                if let Some(found) = file_or_folder(&main) {
                    return Some(found);
                }
            }
        }
        return ["index.js", "index.mjs", "index.cjs", "index.json"].into_iter().map(|f| path.join(f)).find(|p| p.is_file());
    }
    None
}

/// Whether `path` (with contents `source`) is CommonJS, an ES module or
/// JSON. `.mjs` and `.cjs` say so; a `.js` file follows the `type` in the
/// nearest `package.json`. Without a `type`, or for the site's own files,
/// `import` and `export` statements make it an ES module.
pub(crate) fn format_of(path: &Path, source: &str) -> Format {
    match path.extension().and_then(|e| e.to_str()) {
        Some("json") => return Format::Json,
        Some("mjs") => return Format::Esm,
        Some("cjs") => return Format::CommonJs,
        _ => {}
    }
    let in_node_modules = path.components().any(|c| c.as_os_str() == "node_modules");
    let declared = path.parent().and_then(nearest_package_json).and_then(|(_, json)| json.get("type").and_then(Json::as_str).map(str::to_string));
    match declared.as_deref() {
        Some("module") => Format::Esm,
        Some("commonjs") if in_node_modules => Format::CommonJs,
        _ if has_module_syntax(source) => Format::Esm,
        _ => Format::CommonJs,
    }
}

/// Does the source use `import` or `export` statements, or `import.meta`?
/// Skips comments, strings, template literals and regular expressions.
/// Dynamic `import()` is allowed in CommonJS, so it doesn't count.
pub(crate) fn has_module_syntax(source: &str) -> bool {
    let b = source.as_bytes();
    let mut i = 0;
    // The last significant byte, to tell a regex from division and `a.import` from `import`.
    let mut prev: u8 = b';';
    // Open template literals' `${` depths.
    let mut templates: Vec<usize> = Vec::new();
    let mut braces = 0usize;
    let skip_ws = |mut j: usize| {
        while j < b.len() && (b[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        j
    };
    let skip_template = |mut j: usize| -> (usize, bool) {
        // From inside a template literal to its end (false) or a `${` (true).
        while j < b.len() {
            match b[j] {
                b'\\' => j += 2,
                b'`' => return (j + 1, false),
                b'$' if b.get(j + 1) == Some(&b'{') => return (j + 2, true),
                _ => j += 1,
            }
        }
        (j, false)
    };
    while i < b.len() {
        let c = b[i];
        match c {
            _ if c.is_ascii_whitespace() => i += 1,
            b'/' if b.get(i + 1) == Some(&b'/') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                i = source[i + 2..].find("*/").map(|e| i + 2 + e + 2).unwrap_or(b.len());
            }
            b'\'' | b'"' => {
                i += 1;
                while i < b.len() && b[i] != c && b[i] != b'\n' {
                    i += if b[i] == b'\\' { 2 } else { 1 };
                }
                i += 1;
                prev = b'"';
            }
            b'`' => {
                let (j, open) = skip_template(i + 1);
                i = j;
                if open {
                    templates.push(braces);
                    braces += 1;
                    prev = b'(';
                } else {
                    prev = b'"';
                }
            }
            b'{' => {
                braces += 1;
                prev = c;
                i += 1;
            }
            b'}' => {
                braces = braces.saturating_sub(1);
                if templates.last() == Some(&braces) {
                    templates.pop();
                    let (j, open) = skip_template(i + 1);
                    i = j;
                    if open {
                        templates.push(braces);
                        braces += 1;
                        prev = b'(';
                    } else {
                        prev = b'"';
                    }
                } else {
                    prev = c;
                    i += 1;
                }
            }
            b'/' if matches!(prev, b'(' | b',' | b'=' | b':' | b'[' | b'!' | b'&' | b'|' | b'?' | b'{' | b'}' | b';' | b'+' | b'-' | b'*' | b'%' | b'<' | b'>' | b'~' | b'^') => {
                // A regular expression literal.
                i += 1;
                let mut class = false;
                while i < b.len() && b[i] != b'\n' {
                    match b[i] {
                        b'\\' => i += 1,
                        b'[' => class = true,
                        b']' => class = false,
                        b'/' if !class => break,
                        _ => {}
                    }
                    i += 1;
                }
                i += 1;
                prev = b'"';
            }
            _ if c.is_ascii_alphabetic() || c == b'_' || c == b'$' || c >= 0x80 => {
                let start = i;
                while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$' || b[i] >= 0x80) {
                    i += 1;
                }
                let word = &source[start..i];
                if prev != b'.' && templates.is_empty() {
                    let next = b.get(skip_ws(i)).copied().unwrap_or(b';');
                    match word {
                        "export" if !matches!(next, b':' | b'(' | b'=' | b'.') => return true,
                        "import" if next == b'.' && source[skip_ws(i) + 1..].trim_start().starts_with("meta") => return true,
                        "import" if !matches!(next, b'(' | b':' | b'=' | b'.' | b',' | b')' | b';') => return true,
                        _ => {}
                    }
                }
                // Keywords after which `/` starts a regex.
                prev = if matches!(word, "return" | "typeof" | "case" | "do" | "else" | "in" | "of" | "new" | "delete" | "void" | "throw" | "yield" | "await") { b'(' } else { b'a' };
            }
            _ => {
                prev = c;
                i += 1;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_syntax() {
        for esm in ["import x from \"y\";", "import { a } from 'b'", "import * as m from 'x'", "import 'side-effect';", "export default 1;", "export const a = 1;", "export { a };", "const u = import.meta.url;", "// hi\nexport function f() {}"] {
            assert!(has_module_syntax(esm), "{}", esm);
        }
        for cjs in [
            "module.exports = { import: 1, export: 2 };",
            "const m = await import('x');",
            "exports.a = 1; // import x from 'y'",
            "/* export default 1 */ require('x');",
            "const s = \"import x from 'y'\";",
            "const t = `\nimport x from 'y'\n${ a }\nexport default 1`;",
            "const r = /import x/; a.import(b); a.export = 1;",
            "x = 4 / 2; y = 3 / 1; export_ = 1; imported = 2;",
        ] {
            assert!(!has_module_syntax(cjs), "{}", cjs);
        }
    }

    #[test]
    fn package_names() {
        assert_eq!(split_package("luxon"), Some(("luxon", ".".into())));
        assert_eq!(split_package("lodash/fp/map"), Some(("lodash", "./fp/map".into())));
        assert_eq!(split_package("@scope/pkg"), Some(("@scope/pkg", ".".into())));
        assert_eq!(split_package("@scope/pkg/a.js"), Some(("@scope/pkg", "./a.js".into())));
        assert_eq!(split_package("@scope"), None);
        assert!(is_bare("luxon") && is_bare("@a/b") && !is_bare("./x") && !is_bare("/x") && !is_bare("#x") && !is_bare("node:fs"));
    }

    #[test]
    fn exports_maps() {
        let exports: Json = serde_json::from_str(
            r#"{
                ".": { "import": { "types": "./a.d.ts", "default": "./esm/index.js" }, "require": "./cjs/index.js" },
                "./package.json": "./package.json",
                "./utils/*": "./lib/utils/*.js",
                "./utils/internal/*": null,
                "./legacy/": "./old/",
                "./browser": { "browser": "./b.js" }
            }"#,
        )
        .unwrap();
        assert_eq!(resolve_map(&exports, ".", Kind::Import, true).as_deref(), Some("./esm/index.js"));
        assert_eq!(resolve_map(&exports, ".", Kind::Require, true).as_deref(), Some("./cjs/index.js"));
        assert_eq!(resolve_map(&exports, "./utils/a/b", Kind::Import, true).as_deref(), Some("./lib/utils/a/b.js"));
        assert_eq!(resolve_map(&exports, "./utils/internal/x", Kind::Import, true), None);
        assert_eq!(resolve_map(&exports, "./legacy/x.js", Kind::Import, true).as_deref(), Some("./old/x.js"));
        assert_eq!(resolve_map(&exports, "./browser", Kind::Import, true), None);
        assert_eq!(resolve_map(&exports, "./nope", Kind::Import, true), None);
        let plain = Json::String("./main.js".into());
        assert_eq!(resolve_map(&plain, ".", Kind::Require, true).as_deref(), Some("./main.js"));
        assert_eq!(resolve_map(&plain, "./x", Kind::Require, true), None);
        let conditions: Json = serde_json::from_str(r#"{ "node": { "import": "./n.mjs", "require": "./n.cjs" }, "default": "./d.js" }"#).unwrap();
        assert_eq!(resolve_map(&conditions, ".", Kind::Import, true).as_deref(), Some("./n.mjs"));
        let imports: Json = serde_json::from_str(r##"{ "#dep": { "node": "dep-node", "default": "./dep.js" }, "#x/*": "./x/*.js" }"##).unwrap();
        assert_eq!(resolve_map(&imports, "#dep", Kind::Import, false).as_deref(), Some("dep-node"));
        assert_eq!(resolve_map(&imports, "#x/y", Kind::Import, false).as_deref(), Some("./x/y.js"));
    }
}
