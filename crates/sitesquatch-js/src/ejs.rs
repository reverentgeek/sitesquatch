//! EJS templates (`.ejs`). The compiler is `ejs.js`, run on the engine the
//! config and JavaScript data files use, so a config filter is called as it
//! is, and a page's data reaches the template as lazy views (see `views.rs`).
//!
//! - Filters, shortcodes and global functions are in scope by name
//!   (`<%= slugify(title) %>`), and so is the page's data, as in EJS.
//! - `include("partials/nav")` reads from the includes folder (and the
//!   themes'); `include("./card")` from the template's own folder. `.ejs` is
//!   added to a name without an extension. A second argument adds data.
//! - A layout prints the page with `<%- content %>`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use rquickjs::{CatchResultExt, Function, Object};
use sitesquatch::engines::{EngineEnv, RenderContext, TemplateEngine};
use sitesquatch::Value;

use crate::convert::{self, Conv};
use crate::DataFiles;

/// Each build's engine gets a new number, so templates compiled in the last
/// build (during `ssqch serve`) aren't reused.
static BUILDS: AtomicU32 = AtomicU32::new(0);

pub(crate) struct EjsEngine {
    files: Arc<DataFiles>,
    globals: Value,
    input_dir: PathBuf,
    includes: Arc<Vec<PathBuf>>,
    root: PathBuf,
    build: u32,
    /// The includes read so far, by their paths in the includes folder, for `--verbose`.
    loaded: Arc<Mutex<HashSet<String>>>,
}

impl EjsEngine {
    pub(crate) fn new(files: Arc<DataFiles>, env: &EngineEnv) -> Self {
        EjsEngine {
            files,
            globals: Value::object(env.globals.clone()),
            input_dir: env.build.input_dir.clone(),
            includes: Arc::new(env.include_dirs().cloned().collect()),
            root: env.build.root.clone(),
            build: BUILDS.fetch_add(1, Ordering::Relaxed),
            loaded: Arc::default(),
        }
    }
}

impl TemplateEngine for EjsEngine {
    fn render(&self, source: &str, data: &Value, ctx: &RenderContext) -> Result<String> {
        let engine = self.files.engine()?;
        // The template's own file, for relative includes: a theme's page or a layout isn't in the input folder.
        let file = if ctx.input_path.is_absolute() { ctx.input_path.to_path_buf() } else { self.input_dir.join(ctx.input_path) };
        engine.with(|js| {
            let globals = js.globals();
            if !globals.contains_key("__ssqch_ejs")? {
                let mut options = rquickjs::context::EvalOptions::default();
                options.global = true;
                options.filename = Some(convert::PRELUDE_NAME.into());
                js.eval_with_options::<(), _>(include_str!("ejs.js"), options).catch(&js).map_err(convert::caught)?;
            }
            let ejs: Object = globals.get("__ssqch_ejs")?;
            // A new build: forget the last one's templates, and find includes from this one's folders.
            if ejs.get::<_, Function>("generation")?.call::<_, f64>(())? != self.build as f64 {
                let (includes, root, loaded) = (self.includes.clone(), self.root.clone(), self.loaded.clone());
                let load = Function::new(js.clone(), move |from: String, name: String| find_include(&includes, &root, &loaded, Path::new(&from), &name))?;
                ejs.get::<_, Function>("start")?.call::<_, ()>((self.build, load))?;
            }
            let render: Function = ejs.get("render")?;
            let conv = Conv::new(&js, &engine)?;
            let out = render
                .call::<_, rquickjs::Value>((source, conv.to_js(data)?, conv.to_js(&self.globals)?, ctx.name, file.to_string_lossy().into_owned(), ctx.cache_key.unwrap_or("")))
                .catch(&js)
                .map_err(convert::caught)?;
            out.as_string().map(|s| s.to_string()).transpose()?.ok_or_else(|| anyhow!("internal error: an EJS template returned something other than text"))
        })
    }

    fn included(&self) -> Option<Vec<String>> {
        Some(self.loaded.lock().unwrap().iter().cloned().collect())
    }
}

/// The include `name` from the template at `from`: `[path, name to show,
/// source]`, or `[message]` when there's no such file.
fn find_include(includes: &[PathBuf], root: &Path, loaded: &Mutex<HashSet<String>>, from: &Path, name: &str) -> Vec<String> {
    let wanted = if Path::new(name).extension().is_some() { name.to_string() } else { format!("{}.ejs", name) };
    let relative = wanted.starts_with("./") || wanted.starts_with("../");
    let dirs: Vec<PathBuf> = if relative { from.parent().map(Path::to_path_buf).into_iter().collect() } else { includes.to_vec() };
    let shown = |path: &Path| sitesquatch::slashes(path.strip_prefix(root).unwrap_or(path));
    if let Some((dir, path)) = dirs.iter().map(|dir| (dir, dir.join(&wanted))).find(|(_, p)| p.is_file()) {
        if let Some(rel) = includes.iter().chain(std::iter::once(dir)).find_map(|d| path.strip_prefix(d).ok()) {
            loaded.lock().unwrap().insert(sitesquatch::slashes(rel));
        }
        return match std::fs::read_to_string(&path) {
            Ok(source) => vec![path.to_string_lossy().into_owned(), shown(&path), source],
            Err(e) => vec![format!("reading {}: {}", shown(&path), e)],
        };
    }
    // Not found: the closest file name in the same folders.
    let have: Vec<String> = dirs
        .iter()
        .flat_map(|dir| {
            walkdir::WalkDir::new(dir)
                .max_depth(if relative { 1 } else { usize::MAX })
                .into_iter()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_file())
                .filter_map(|entry| entry.path().strip_prefix(dir).ok().map(sitesquatch::slashes))
                .collect::<Vec<_>>()
        })
        .collect();
    let bare = wanted.trim_start_matches("./");
    let hint = sitesquatch::suggest::closest_path(bare, have.iter().map(String::as_str)).map(|found| format!(" (did you mean `{}`?)", found.trim_end_matches(".ejs"))).unwrap_or_default();
    let place = dirs.first().map(|d| shown(d)).unwrap_or_default();
    vec![format!("template not found: can't include `{}`: no sightings in {}{}", name, place, hint)]
}
