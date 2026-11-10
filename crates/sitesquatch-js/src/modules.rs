//! ES module resolution and loading for the config and the files it imports.
//!
//! Relative and absolute imports resolve like Node's ESM: the path as given,
//! then with `.js` or `.mjs` added, then `index.js` inside a directory. JSON
//! files load as a module whose default export is the parsed data. The Node
//! built-ins in `node.js` load as `node:fs` or plain `fs`. npm packages
//! load from `node_modules` (see `packages.rs`), and CommonJS files run
//! through `require` in `node.js`, wrapped as ES modules when imported.
//!
//! Module names are paths relative to the project root, so stack traces read
//! `lib/filters.js:3:9`. A `?v=N` suffix on a name loads a fresh copy of a
//! file that QuickJS has already cached (used to reload changed data files).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rquickjs::loader::ImportAttributes;
use rquickjs::{CatchResultExt, Ctx, Error, Module, Object, Result};

use crate::packages::{self, Format, Kind};
use crate::JsModule;

/// `import { defineConfig, markdown } from "ssqch"`. `defineConfig` returns
/// its argument: it's there so configs read as configs (and for editor
/// hints). `markdown(text, { inline })` renders Markdown with the site's options.
const CONFIG_MODULE: &str = "ssqch";
const CONFIG_MODULE_SOURCE: &str = r#"export const defineConfig = (config) => config;
export function markdown(text, options = {}) {
	for (const key of Object.keys(options ?? {})) {
		if (key !== "inline") throw new TypeError(`markdown(): unknown option "${key}" (options: inline)`);
	}
	return globalThis.__ssqch.natives.ssqch.markdown(String(text ?? ""), Boolean(options?.inline));
}
export function readData(path) {
	return globalThis.__ssqch.natives.ssqch.readData(String(path));
}
export default { defineConfig, markdown, readData };
"#;

/// Node built-in modules provided by `node.js`.
pub(crate) static NODE_MODULES: [&str; 32] = [
    "fs", "fs/promises", "path", "path/posix", "url", "process", "buffer", "crypto", "module", "util", "events", "os", "assert", "assert/strict", "timers", "timers/promises", "string_decoder",
    // These load, but only enough for packages that require them without using them.
    "http", "https", "http2", "net", "tls", "dns", "child_process", "worker_threads", "cluster", "readline", "zlib", "vm", "stream", "tty", "perf_hooks",
];

/// The Node built-in modules, as `(working, stubs)`: the stubs load, but
/// their functions throw.
pub fn node_modules() -> (&'static [&'static str], &'static [&'static str]) {
    let stubs = NODE_MODULES.iter().position(|m| *m == "http").unwrap_or(NODE_MODULES.len());
    NODE_MODULES.split_at(stubs)
}

/// The names `ssqch` itself exports.
pub const CONFIG_MODULE_EXPORTS: [&str; 3] = ["defineConfig", "markdown", "readData"];

/// The module name for `path`: relative to the project root when it's
/// inside it, absolute otherwise.
pub(crate) fn name(root: &Path, path: &Path) -> String {
    match path.strip_prefix(root) {
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

/// What to `import()` to load `path` as an entry module.
pub(crate) fn specifier(root: &Path, path: &Path) -> String {
    let name = name(root, path);
    if Path::new(&name).is_absolute() { name } else { format!("./{}", name) }
}

/// Split `file.js?v=2` into the file and its `?v=2` suffix.
fn split_query(name: &str) -> (&str, &str) {
    match name.find('?') {
        Some(i) => name.split_at(i),
        None => (name, ""),
    }
}

pub(crate) struct Resolver {
    root: PathBuf,
    modules: Arc<[JsModule]>,
}

impl Resolver {
    pub(crate) fn new(root: &Path, modules: Arc<[JsModule]>) -> Self {
        Resolver { root: root.to_path_buf(), modules }
    }
}

impl rquickjs::loader::Resolver for Resolver {
    fn resolve<'js>(&mut self, _ctx: &Ctx<'js>, base: &str, name: &str, _attributes: Option<ImportAttributes<'js>>) -> Result<String> {
        resolve(&self.root, &self.modules, base, name, Kind::Import).map_err(|m| Error::new_resolving_message(base, name, m))
    }
}

/// Resolve what `base` imports or requires as `name` to a module name: a
/// Node built-in (`node:fs`), a module built into ssqch (`ssqch/image`),
/// or a file (a path relative to the project root, keeping a `?v=N`).
pub(crate) fn resolve(root: &Path, modules: &[JsModule], base: &str, name: &str, kind: Kind) -> std::result::Result<String, String> {
    let builtin = name.strip_prefix("node:").unwrap_or(name);
    if NODE_MODULES.contains(&builtin) {
        return Ok(format!("node:{}", builtin));
    }
    if name == CONFIG_MODULE || modules.iter().any(|m| m.name == name) {
        return Ok(name.to_string());
    }
    if name.starts_with("node:") {
        return Err(format!("{} isn't available in ssqch (available: {})", name, NODE_MODULES.map(|m| format!("node:{}", m)).join(", ")));
    }
    let (name, query) = split_query(name);
    let (base, _) = split_query(base);
    let base_dir = Path::new(base).parent().map(|d| root.join(d)).unwrap_or_else(|| root.to_path_buf());
    let found = if Path::new(name).is_absolute() {
        packages::file_or_folder(Path::new(name)).ok_or_else(|| "file not found".to_string())
    } else if name.starts_with("./") || name.starts_with("../") || name == "." || name == ".." {
        packages::file_or_folder(&base_dir.join(name)).ok_or_else(|| "file not found".to_string())
    } else if name.starts_with('#') {
        packages::resolve_imports(&base_dir, name, kind)
    } else if packages::is_bare(name) {
        packages::resolve_bare(&base_dir, name, kind)
    } else {
        Err("only files, npm packages and node: built-ins can be imported".to_string())
    }?;
    let path = dunce::canonicalize(&found).map_err(|e| e.to_string())?;
    Ok(format!("{}{}", self::name(root, &path), query))
}

/// What to pass to `Module::import` for a module name from [`resolve`].
pub(crate) fn import_specifier(modules: &[JsModule], name: &str) -> String {
    if name == CONFIG_MODULE || name.starts_with("node:") || modules.iter().any(|m| m.name == name) || Path::new(name).is_absolute() {
        name.to_string()
    } else {
        format!("./{}", name)
    }
}

pub(crate) struct Loader {
    root: PathBuf,
    modules: Arc<[JsModule]>,
    loaded: sitesquatch::ConfigFiles,
}

impl Loader {
    pub(crate) fn new(root: &Path, modules: Arc<[JsModule]>, loaded: sitesquatch::ConfigFiles) -> Self {
        Loader { root: root.to_path_buf(), modules, loaded }
    }
}

/// Note a file the site's own code was loaded from (not a package's), so
/// `ssqch serve` reads the configuration again when it changes.
fn note_loaded(loaded: &sitesquatch::ConfigFiles, path: &Path) {
    if !path.components().any(|c| c.as_os_str() == "node_modules") {
        loaded.lock().unwrap().insert(dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()));
    }
}

impl rquickjs::loader::Loader for Loader {
    fn load<'js>(&mut self, ctx: &Ctx<'js>, name: &str, _attributes: Option<ImportAttributes<'js>>) -> Result<Module<'js>> {
        if let Some(builtin) = name.strip_prefix("node:") {
            return Module::declare(ctx.clone(), name, builtin_source(ctx, builtin)?);
        }
        if name == CONFIG_MODULE {
            return Module::declare(ctx.clone(), name, CONFIG_MODULE_SOURCE);
        }
        if let Some(module) = self.modules.iter().find(|m| m.name == name) {
            return Module::declare(ctx.clone(), name, module.source.clone());
        }
        let (file, _) = split_query(name);
        let path = self.root.join(file);
        let text = std::fs::read_to_string(&path).map_err(|e| Error::new_loading_message(name, e.to_string()))?;
        note_loaded(&self.loaded, &path);
        let source = match format(ctx, &path, &text) {
            Format::Json => {
                // Validate here so a broken file reports its own path.
                serde_json::from_str::<serde_json::Value>(&text).map_err(|e| Error::new_loading_message(name, format!("invalid JSON: {}", e)))?;
                format!("export default {};", text)
            }
            Format::Esm => text,
            Format::CommonJs => commonjs_wrapper(ctx, name)?,
        };
        let module = Module::declare(ctx.clone(), name, source)?;
        module.meta()?.set("url", file_url(&path))?;
        Ok(module)
    }
}

/// An ES module for a CommonJS file: `module.exports` is the default
/// export, and its properties are named exports too (as Node finds them,
/// though Node reads the names from the source, and ssqch runs the file to
/// see them).
fn commonjs_wrapper(ctx: &Ctx<'_>, name: &str) -> Result<String> {
    let cjs: Object = ctx.globals().get::<_, Object>("__ssqch")?.get("cjs")?;
    let names: Vec<String> = cjs
        .get::<_, rquickjs::Function>("exportNames")?
        .call((name,))
        .catch(ctx)
        .map_err(|e| Error::new_loading_message(name, crate::convert::caught(e).to_string()))?;
    let key = serde_json::to_string(name).unwrap_or_default();
    let mut src = format!("const m = globalThis.__ssqch.cjs.load({});\nexport default m;\n", key);
    for (i, export) in names.iter().filter(|k| is_identifier(k) && *k != "default").enumerate() {
        src.push_str(&format!("const e{} = m[{}];\nexport {{ e{} as {} }};\n", i, serde_json::to_string(export).unwrap_or_default(), i, export));
    }
    Ok(src)
}

/// Node's function wrapper around a CommonJS file's source. Evaluating it
/// only compiles the file; calling the function runs it.
fn compile_commonjs<'js>(ctx: &Ctx<'js>, name: &str, source: &str) -> Result<rquickjs::Function<'js>> {
    // On the first line, so line numbers in stack traces match the file.
    let wrapped = format!("(function (exports, require, module, __filename, __dirname) {{{}\n}})", source);
    let mut options = rquickjs::context::EvalOptions::default();
    options.global = true;
    options.strict = false;
    options.filename = Some(name.to_string());
    ctx.eval_with_options(wrapped, options)
}

/// [`packages::format_of`], plus Node's other check: the site's own file
/// that uses top-level `await` (and nothing else of ES modules') doesn't
/// compile as CommonJS, so it's an ES module.
fn format(ctx: &Ctx<'_>, path: &Path, source: &str) -> Format {
    let format = packages::format_of(path, source);
    let own = !path.components().any(|c| c.as_os_str() == "node_modules");
    if format == Format::CommonJs && own && source.contains("await") && compile_commonjs(ctx, "", source).is_err() {
        // Clear the compile error.
        let _ = ctx.catch();
        return Format::Esm;
    }
    format
}

/// The natives behind `require` in `node.js`.
pub(crate) fn install_commonjs<'js>(ctx: &Ctx<'js>, root: &Path, modules: Arc<[JsModule]>, loaded: sitesquatch::ConfigFiles) -> Result<()> {
    let native = Object::new(ctx.clone())?;
    let (r, m) = (root.to_path_buf(), modules.clone());
    native.set(
        "resolve",
        rquickjs::Function::new(ctx.clone(), move |ctx: Ctx<'js>, base: String, spec: String| -> Result<String> {
            resolve(&r, &m, &base, &spec, Kind::Require).map_err(|message| {
                let text = format!("Cannot find module '{}' from '{}': {}", spec, split_query(&base).0, message);
                rquickjs::Exception::throw_message(&ctx, &text)
            })
        })?,
    )?;
    let r = root.to_path_buf();
    native.set(
        "read",
        rquickjs::Function::new(ctx.clone(), move |ctx: Ctx<'js>, name: String| -> Result<Object<'js>> {
            let path = r.join(split_query(&name).0);
            let source = std::fs::read_to_string(&path).map_err(|e| rquickjs::Exception::throw_message(&ctx, &format!("{}: {}", name, e)))?;
            note_loaded(&loaded, &path);
            let format = match format(&ctx, &path, &source) {
                Format::Esm => "esm",
                Format::CommonJs => "cjs",
                Format::Json => "json",
            };
            let out = Object::new(ctx)?;
            out.set("format", format)?;
            // Node strips a `#!` line.
            out.set("source", if source.starts_with("#!") { source.find('\n').map(|i| &source[i..]).unwrap_or("") } else { &source })?;
            Ok(out)
        })?,
    )?;
    native.set(
        "compile",
        rquickjs::Function::new(ctx.clone(), |ctx: Ctx<'js>, name: String, source: String| -> Result<rquickjs::Function<'js>> {
            compile_commonjs(&ctx, &name, &source)
        })?,
    )?;
    let m = modules.clone();
    native.set(
        "importSync",
        rquickjs::Function::new(ctx.clone(), move |ctx: Ctx<'js>, name: String| -> Result<Object<'js>> {
            crate::convert::finish::<Object>(&Module::import(&ctx, import_specifier(&m, &name))?)
        })?,
    )?;
    let r = root.to_path_buf();
    native.set("absolute", rquickjs::Function::new(ctx.clone(), move |name: String| r.join(split_query(&name).0).to_string_lossy().replace('\\', "/"))?)?;
    let r = root.to_path_buf();
    native.set(
        "nameOf",
        rquickjs::Function::new(ctx.clone(), move |path: String| {
            let path = PathBuf::from(path);
            let path = dunce::canonicalize(&path).unwrap_or(path);
            self::name(&r, &path)
        })?,
    )?;
    ctx.globals().set("__ssqch_cjs", native)?;
    Ok(())
}

/// A module re-exporting one of the objects `node.js` built, both as the
/// default export and as named exports.
fn builtin_source(ctx: &Ctx<'_>, name: &str) -> Result<String> {
    let modules: Object = ctx.globals().get::<_, Object>("__ssqch")?.get("node")?;
    let module: Object = modules.get(name)?;
    let keys: Vec<String> = module.keys::<String>().collect::<Result<_>>()?;
    let key = serde_json::to_string(name).unwrap_or_default();
    let mut src = format!("const m = globalThis.__ssqch.node[{}];\nexport default m;\n", key);
    let names: Vec<&String> = keys.iter().filter(|k| is_identifier(k) && *k != "default").collect();
    if !names.is_empty() {
        src.push_str(&format!("export const {{ {} }} = m;\n", names.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", ")));
    }
    Ok(src)
}

fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// `file:///...` for `import.meta.url`, percent-encoding what URLs require.
/// On Windows, `C:\site\a.js` becomes `file:///C:/site/a.js`.
fn file_url(path: &Path) -> String {
    let mut text = path.to_string_lossy().replace('\\', "/");
    if !text.starts_with('/') {
        text.insert(0, '/');
    }
    let drive = text.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic) && text.as_bytes().get(2) == Some(&b':');
    let mut url = String::from("file://");
    for (i, b) in text.bytes().enumerate() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => url.push(b as char),
            b':' if drive && i == 2 => url.push(':'),
            _ => url.push_str(&format!("%{:02X}", b)),
        }
    }
    url
}
