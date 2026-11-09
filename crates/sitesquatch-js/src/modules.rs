//! ES module resolution and loading for the config and the files it imports.
//!
//! Relative and absolute imports resolve like Node's ESM: the path as given,
//! then with `.js` or `.mjs` added, then `index.js` inside a directory. JSON
//! files load as a module whose default export is the parsed data. The Node
//! built-ins in `node.js` load as `node:fs` or plain `fs`. npm packages
//! aren't available yet.
//!
//! Module names are paths relative to the project root, so stack traces read
//! `lib/filters.js:3:9`. A `?v=N` suffix on a name loads a fresh copy of a
//! file that QuickJS has already cached (used to reload changed data files).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rquickjs::loader::ImportAttributes;
use rquickjs::{Ctx, Error, Module, Object, Result};

use crate::JsModule;

/// `import { defineConfig } from "ssqch"`. `defineConfig` returns its
/// argument: it's there so configs read as configs (and for editor hints).
const CONFIG_MODULE: &str = "ssqch";
const CONFIG_MODULE_SOURCE: &str = "export const defineConfig = (config) => config;\nexport default { defineConfig };\n";

/// Node built-in modules provided by `node.js`.
pub(crate) const NODE_MODULES: [&str; 7] = ["fs", "fs/promises", "path", "path/posix", "url", "process", "buffer"];

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
        let builtin = name.strip_prefix("node:").unwrap_or(name);
        if NODE_MODULES.contains(&builtin) {
            return Ok(format!("node:{}", builtin));
        }
        if name == CONFIG_MODULE {
            return Ok(name.to_string());
        }
        if let Some(module) = self.modules.iter().find(|m| m.name == name) {
            return Ok(module.name.clone());
        }
        if name.starts_with("node:") {
            return Err(Error::new_resolving_message(base, name, format!("{} isn't available in ssqch (available: {})", name, NODE_MODULES.map(|m| format!("node:{}", m)).join(", "))));
        }
        let (name, query) = split_query(name);
        let (base, _) = split_query(base);
        let base_dir = Path::new(base).parent().map(|d| self.root.join(d)).unwrap_or_else(|| self.root.clone());
        let target = if Path::new(name).is_absolute() {
            PathBuf::from(name)
        } else if name.starts_with("./") || name.starts_with("../") {
            base_dir.join(name)
        } else {
            return Err(Error::new_resolving_message(base, name, "importing npm packages isn't supported by ssqch yet; use a relative path"));
        };
        let mut candidates = vec![target.clone()];
        for ext in ["js", "mjs"] {
            let mut with_ext = target.clone().into_os_string();
            with_ext.push(".");
            with_ext.push(ext);
            candidates.push(with_ext.into());
        }
        candidates.push(target.join("index.js"));
        candidates
            .into_iter()
            .find(|p| p.is_file())
            .and_then(|p| std::fs::canonicalize(p).ok())
            .map(|p| format!("{}{}", self::name(&self.root, &p), query))
            .ok_or_else(|| Error::new_resolving_message(base, name, "file not found"))
    }
}

pub(crate) struct Loader {
    root: PathBuf,
    modules: Arc<[JsModule]>,
}

impl Loader {
    pub(crate) fn new(root: &Path, modules: Arc<[JsModule]>) -> Self {
        Loader { root: root.to_path_buf(), modules }
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
        let source = if file.ends_with(".json") {
            // Validate here so a broken file reports its own path.
            serde_json::from_str::<serde_json::Value>(&text).map_err(|e| Error::new_loading_message(name, format!("invalid JSON: {}", e)))?;
            format!("export default {};", text)
        } else {
            text
        };
        let module = Module::declare(ctx.clone(), name, source)?;
        module.meta()?.set("url", file_url(&path))?;
        Ok(module)
    }
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
fn file_url(path: &Path) -> String {
    let mut url = String::from("file://");
    for b in path.to_string_lossy().bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => url.push(b as char),
            _ => url.push_str(&format!("%{:02X}", b)),
        }
    }
    url
}
