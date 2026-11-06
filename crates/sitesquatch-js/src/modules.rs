//! ES module resolution and loading for the config and the files it imports.
//!
//! Relative and absolute imports resolve like Node's ESM: the path as given,
//! then with `.js` or `.mjs` added, then `index.js` inside a directory. JSON
//! files load as a module whose default export is the parsed data. npm
//! packages and `node:` built-ins aren't available yet.

use std::path::{Path, PathBuf};

use rquickjs::loader::ImportAttributes;
use rquickjs::{Ctx, Error, Module, Result};

/// The module name for `path`: relative to the project root when it's
/// inside it (so stack traces read `lib/filters.js:3:9`), absolute otherwise.
pub(crate) fn name(root: &Path, path: &Path) -> String {
    match path.strip_prefix(root) {
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

/// What to `import()` to load `path` as the entry module.
pub(crate) fn specifier(root: &Path, path: &Path) -> String {
    let name = name(root, path);
    if Path::new(&name).is_absolute() { name } else { format!("./{}", name) }
}

pub(crate) struct Resolver {
    root: PathBuf,
}

impl Resolver {
    pub(crate) fn new(root: &Path) -> Self {
        Resolver { root: root.to_path_buf() }
    }
}

impl rquickjs::loader::Resolver for Resolver {
    fn resolve<'js>(&mut self, _ctx: &Ctx<'js>, base: &str, name: &str, _attributes: Option<ImportAttributes<'js>>) -> Result<String> {
        let base_dir = Path::new(base).parent().map(|d| self.root.join(d)).unwrap_or_else(|| self.root.clone());
        let target = if Path::new(name).is_absolute() {
            PathBuf::from(name)
        } else if name.starts_with("./") || name.starts_with("../") {
            base_dir.join(name)
        } else if name.starts_with("node:") {
            return Err(Error::new_resolving_message(base, name, "Node built-in modules aren't available in ssqch yet"));
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
            .map(|p| self::name(&self.root, &p))
            .ok_or_else(|| Error::new_resolving_message(base, name, "file not found"))
    }
}

pub(crate) struct Loader {
    root: PathBuf,
}

impl Loader {
    pub(crate) fn new(root: &Path) -> Self {
        Loader { root: root.to_path_buf() }
    }
}

impl rquickjs::loader::Loader for Loader {
    fn load<'js>(&mut self, ctx: &Ctx<'js>, name: &str, _attributes: Option<ImportAttributes<'js>>) -> Result<Module<'js>> {
        let text = std::fs::read_to_string(self.root.join(name)).map_err(|e| Error::new_loading_message(name, e.to_string()))?;
        let source = if name.ends_with(".json") {
            // Validate here so a broken file reports its own path.
            serde_json::from_str::<serde_json::Value>(&text).map_err(|e| Error::new_loading_message(name, format!("invalid JSON: {}", e)))?;
            format!("export default {};", text)
        } else {
            text
        };
        Module::declare(ctx.clone(), name, source)
    }
}
