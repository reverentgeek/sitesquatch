//! `ssqch.config.js`: configure a SiteSquatch build in JavaScript.
//!
//! ```js
//! import { defineConfig } from "ssqch";
//! import { imagePlugin } from "ssqch/image";
//!
//! export default defineConfig(({ env }) => ({
//!   dirs: { input: "src", output: "dist" },
//!   passthrough: [{ "src/assets/fonts": "fonts" }],
//!   filters: { shout: (s) => s.toUpperCase() },
//!   plugins: [imagePlugin({ widths: [300, 600, 1200] })],
//! }));
//! ```
//!
//! The config runs on an embedded QuickJS engine, so no Node install is
//! needed. Every call into JavaScript (filters, data functions) goes through
//! one lock, so pages render in parallel but JavaScript runs one call at a
//! time, which keeps module-level state in the config behaving as it would in
//! Node.
//!
//! The same engine runs JavaScript data files (`_data/*.js` and
//! `*.data.js`), and provides the parts of Node's `fs`, `path`, `url`,
//! `process` and `Buffer` that configs and data files commonly use.

mod convert;
mod modules;
mod native;
mod views;

use std::cell::Cell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::SystemTime;

use anyhow::{anyhow, bail, Context as _, Result};
use rquickjs::{CatchResultExt, Context, Ctx, Function, Object, Runtime};
use sitesquatch::{Config, Func, Value};

use convert::Conv;

/// Config file names looked for in the project root, in order.
pub const CONFIG_FILES: [&str; 2] = ["ssqch.config.js", "ssqch.config.mjs"];

/// A built-in Rust plugin that a config enables with an object like
/// `{ builtin: "ssqch/image", options: { ... } }` in its `plugins` (what
/// `imagePlugin()` from `ssqch/image` returns). It receives the options.
pub type BuiltinPlugin = fn(&mut Config, &serde_json::Value) -> Result<()>;

/// A JavaScript module built into the program running the config, such as
/// `ssqch/image`. Its source reaches its native functions through
/// `globalThis.__ssqch.natives[name]`.
#[derive(Clone)]
pub struct JsModule {
    /// What `import` names, such as `ssqch/image`.
    pub name: String,
    /// The ES module source.
    pub source: String,
    /// Values (usually functions) for the source to use.
    pub natives: Vec<(String, Value)>,
}

/// The config file in `root`, if there is one.
pub fn find_config(root: &Path) -> Option<PathBuf> {
    CONFIG_FILES.iter().map(|name| root.join(name)).find(|p| p.is_file())
}

/// Run the config module at `path` and apply what it registers to `cfg`.
/// JavaScript data files are enabled too (see [`add_data_files`]).
pub fn load(cfg: &mut Config, path: &Path, builtins: &[(&str, BuiltinPlugin)], modules: &[JsModule]) -> Result<()> {
    let path = std::fs::canonicalize(path).with_context(|| format!("reading {}", path.display()))?;
    let root = project_root(cfg);
    let modules: Arc<[JsModule]> = modules.into();
    let engine = Engine::new(&root, cfg.env.as_str(), modules.clone())?;
    install_data_files(cfg, DataFiles::new(&root, cfg.env.as_str(), modules, Some(engine.clone())));
    let specifier = modules::specifier(&root, &path);
    let result = engine
        .with(|ctx| {
            let namespace = rquickjs::Module::import(&ctx, specifier.as_bytes())
                .and_then(|p| p.finish::<Object>())
                .catch(&ctx)
                .map_err(|e| convert::caught(e))?;
            let run: Function = ctx.globals().get::<_, Object>("__ssqch")?.get("run")?;
            let returned = run
                .call::<_, rquickjs::Value>((namespace, cfg.env.as_str(), cfg.serving))
                .and_then(convert::settle)
                .catch(&ctx)
                .map_err(|e| convert::caught(e))?;
            Conv::new(&ctx, &engine)?.from_js(returned)
        })
        .with_context(|| file_name(&path))?;
    apply(cfg, &engine, &result, builtins).with_context(|| file_name(&path))
}

/// Read `_data/*.js` and `*.data.js` data files (and `.mjs`). A data
/// file's default export is the data, or a function (sync or async) that
/// returns it, called on every build. The engine starts on first use, so this
/// costs nothing for a site without JavaScript data files.
pub fn add_data_files(cfg: &mut Config, modules: &[JsModule]) {
    let root = project_root(cfg);
    install_data_files(cfg, DataFiles::new(&root, cfg.env.as_str(), modules.into(), None));
}

fn install_data_files(cfg: &mut Config, files: DataFiles) {
    let files = Arc::new(files);
    for ext in ["js", "mjs"] {
        let files = files.clone();
        cfg.add_data_extension(ext, move |path| files.load(path));
    }
}

fn project_root(cfg: &Config) -> PathBuf {
    std::fs::canonicalize(&cfg.root).unwrap_or_else(|_| cfg.root.clone())
}

struct DataFiles {
    root: PathBuf,
    env: String,
    modules: Arc<[JsModule]>,
    engine: Mutex<Option<Arc<Engine>>>,
    /// Modification time and reload count of every data file seen, so a
    /// changed file is imported fresh during `ssqch serve`.
    versions: Mutex<HashMap<PathBuf, (Option<SystemTime>, u32)>>,
}

impl DataFiles {
    fn new(root: &Path, env: &str, modules: Arc<[JsModule]>, engine: Option<Arc<Engine>>) -> Self {
        DataFiles { root: root.to_path_buf(), env: env.to_string(), modules, engine: Mutex::new(engine), versions: Mutex::new(HashMap::new()) }
    }

    fn engine(&self) -> Result<Arc<Engine>> {
        let mut slot = self.engine.lock().unwrap();
        if let Some(engine) = &*slot {
            return Ok(engine.clone());
        }
        let engine = Engine::new(&self.root, &self.env, self.modules.clone())?;
        *slot = Some(engine.clone());
        Ok(engine)
    }

    fn load(&self, path: &Path) -> Result<Value> {
        let name = modules::name(&self.root, path);
        (|| {
            let engine = self.engine()?;
            let modified = std::fs::metadata(path)?.modified().ok();
            let version = {
                let mut versions = self.versions.lock().unwrap();
                let entry = versions.entry(path.to_path_buf()).or_insert((modified, 0));
                if entry.0 != modified {
                    *entry = (modified, entry.1 + 1);
                }
                entry.1
            };
            let mut specifier = modules::specifier(&self.root, path);
            if version > 0 {
                specifier.push_str(&format!("?v={}", version));
            }
            engine.with(|ctx| {
                let value = rquickjs::Module::import(&ctx, specifier.as_bytes())
                    .and_then(|p| p.finish::<Object>())
                    .and_then(|namespace| ctx.globals().get::<_, Object>("__ssqch")?.get::<_, Function>("loadData")?.call::<_, rquickjs::Value>((namespace,)))
                    .and_then(convert::settle)
                    .catch(&ctx)
                    .map_err(|e| convert::caught(e))?;
                Conv::new(&ctx, &engine)?.from_js(value)
            })
        })()
        .with_context(|| name)
    }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn apply(cfg: &mut Config, engine: &Arc<Engine>, result: &Value, builtins: &[(&str, BuiltinPlugin)]) -> Result<()> {
    let settings = result.get("settings");
    let path_setting = |key: &str| -> Result<Option<PathBuf>> {
        match settings.get(key) {
            Value::Undefined | Value::Null => Ok(None),
            Value::Str(s) => Ok(Some(PathBuf::from(&*s))),
            other => bail!("dirs.{} must be a string, not {}", key, other.type_of()),
        }
    };
    if let Some(p) = path_setting("input")? { cfg.input = p; }
    if let Some(p) = path_setting("output")? { cfg.output = p; }
    if let Some(p) = path_setting("includes")? { cfg.includes = p; }
    if let Some(p) = path_setting("data")? { cfg.data = p; }
    match settings.get("templateFormats") {
        Value::Undefined => {}
        Value::Str(s) => cfg.template_formats = s.split(',').map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect(),
        Value::Arr(a) => cfg.template_formats = a.iter().map(|f| f.to_js_string()).collect(),
        other => bail!("templateFormats must be an array or a comma-separated string, not {}", other.type_of()),
    }
    for (key, slot) in [("markdownEngine", &mut cfg.markdown_engine), ("htmlEngine", &mut cfg.html_engine)] {
        match settings.get(key) {
            Value::Undefined => {}
            Value::Bool(false) | Value::Null => *slot = None,
            Value::Str(s) => *slot = Some(s.to_string()).filter(|s| !s.is_empty()),
            other => bail!("{} must be a string or false, not {}", key, other.type_of()),
        }
    }
    match settings.get("deepMerge") {
        Value::Undefined => {}
        Value::Bool(b) => cfg.data_deep_merge = b,
        other => bail!("deepMerge must be true or false, not {}", other.type_of()),
    }

    for op in result.get("ops").as_array().unwrap_or(&[]) {
        let name = op.get("name").to_js_string();
        match op.get("op").as_str().unwrap_or_default() {
            "filter" => {
                let f = engine.function(op.get("fn"))?;
                cfg.add_global(name, engine.value(f));
            }
            "data" => match op.get("fn") {
                Value::Undefined => {
                    let value = op.get("value");
                    cfg.add_global_data(name, move |_| Ok(value.clone()));
                }
                id => {
                    let f = engine.function(id)?;
                    let label = name.clone();
                    cfg.add_global_data(name, move |_| f.call(&[]).with_context(|| format!("data.{}", label)));
                }
            },
            "passthrough" => {
                let from = op.get("from").to_js_string();
                match op.get("to") {
                    Value::Str(to) => cfg.add_passthrough_copy_to(from, &*to),
                    _ => cfg.add_passthrough_copy(from),
                };
            }
            "watch" => {
                cfg.add_watch_target(op.get("path").to_js_string());
            }
            "collection" => {
                let f = engine.function(op.get("fn"))?;
                cfg.add_collection(name, move |api| f.call(&[Value::array(api.all())]));
            }
            "transform" => {
                let f = engine.function(op.get("fn"))?;
                cfg.add_transform(name, move |tctx, html| {
                    let input_path = sitesquatch::display_path(tctx.build, tctx.input_path);
                    let page = Value::from_pairs([
                        ("url", Value::from(tctx.url)),
                        ("inputPath", Value::from(input_path)),
                        ("outputPath", Value::from(tctx.output_path.to_string_lossy().into_owned())),
                    ]);
                    match f.call(&[Value::from(html), page])? {
                        Value::Str(s) => Ok(s.to_string()),
                        other => bail!("transform returned {}", other.type_of()),
                    }
                });
            }
            "hook" => {
                let f = engine.function(op.get("fn"))?;
                let event = op.get("event").to_js_string();
                let label = format!("{} ({})", event, op.get("where").to_js_string());
                if event == "beforeBuild" {
                    cfg.on_before_build(move |ctx| f.call(&[hook_event(ctx, None)]).map(|_| ()).context(label.clone()));
                } else {
                    cfg.on_after_build(move |ctx, report| f.call(&[hook_event(ctx, Some(report))]).map(|_| ()).context(label.clone()));
                }
            }
            "plugin" => {
                let Some((_, register)) = builtins.iter().find(|(n, _)| *n == name) else {
                    let known: Vec<&str> = builtins.iter().map(|(n, _)| *n).collect();
                    bail!("unknown plugin \"{}\" (built-in plugins: {})", name, known.join(", "));
                };
                let options = match op.get("options") {
                    Value::Undefined | Value::Null => serde_json::Value::Object(Default::default()),
                    v => v.to_json(),
                };
                register(cfg, &options).with_context(|| format!("plugin \"{}\"", name))?;
            }
            other => bail!("internal error: unknown config operation {:?}", other),
        }
    }
    Ok(())
}

/// The argument to `beforeBuild` and `afterBuild` hooks. Directories are
/// relative to the project root; `written` (after the build) lists the files
/// it wrote.
fn hook_event(ctx: &sitesquatch::BuildContext, report: Option<&sitesquatch::BuildReport>) -> Value {
    let rel = |p: &Path| match p.strip_prefix(&ctx.root) {
        Ok(r) if r.as_os_str().is_empty() => "./".to_string(),
        Ok(r) => format!("./{}/", sitesquatch::slashes(r)),
        Err(_) => format!("{}/", p.display()),
    };
    let dirs = Value::from_pairs([
        ("input", Value::from(rel(&ctx.input_dir))),
        ("output", Value::from(rel(&ctx.output_dir))),
        ("includes", Value::from(rel(&ctx.includes_dir))),
        ("data", Value::from(rel(&ctx.data_dir))),
    ]);
    let mut event = vec![("env", Value::from(ctx.env.as_str())), ("serving", Value::Bool(ctx.serving)), ("dirs", dirs)];
    if let Some(report) = report {
        let written = report.written.iter().map(|p| Value::from(p.to_string_lossy().into_owned())).collect();
        event.push(("written", Value::array(written)));
    }
    Value::from_pairs(event)
}

thread_local! {
    /// Set while this thread holds the engine, to turn re-entry (which would
    /// deadlock on the runtime lock) into an error.
    static IN_JS: Cell<bool> = const { Cell::new(false) };
}

/// The QuickJS runtime and context. Field order matters: the context must be
/// dropped before the runtime.
pub(crate) struct Engine {
    context: Context,
    _runtime: Runtime,
    /// Template functions that wrap a JavaScript function, so passing one
    /// back into JavaScript hands over the original function instead of a
    /// wrapper that would need to re-enter the engine. Keyed by address, and
    /// checked against the weak reference so a reused address never matches.
    origins: Mutex<HashMap<usize, (Weak<NativeFn>, u32)>>,
    /// Set when a call creates a view, so the call ends by clearing the
    /// view identity map (skipped for calls that made none).
    pub(crate) views_used: std::sync::atomic::AtomicBool,
}

type NativeFn = dyn Fn(&[Value]) -> Result<Value> + Send + Sync;

impl Engine {
    fn new(root: &Path, env: &str, modules: Arc<[JsModule]>) -> Result<Arc<Engine>> {
        let runtime = Runtime::new()?;
        runtime.set_max_stack_size(4 * 1024 * 1024);
        runtime.set_loader(modules::Resolver::new(root, modules.clone()), modules::Loader::new(root, modules.clone()));
        let context = Context::full(&runtime)?;
        let engine = Arc::new(Engine { context, _runtime: runtime, origins: Mutex::new(HashMap::new()), views_used: Default::default() });
        engine.with(|ctx| {
            let globals = ctx.globals();
            let print = Function::new(ctx.clone(), |level: i32, message: String| {
                if level == 0 {
                    println!("{}", message);
                } else {
                    eprintln!("{}", message);
                }
            })?;
            globals.set("__ssqch_print", print)?;
            globals.set("process", process_object(&ctx, root, env)?)?;
            native::install(&ctx, root)?;
            for source in [include_str!("prelude.js"), include_str!("node.js"), include_str!("intl.js")] {
                let mut options = rquickjs::context::EvalOptions::default();
                options.global = true;
                options.filename = Some(convert::PRELUDE_NAME.into());
                ctx.eval_with_options::<(), _>(source, options)
                    .catch(&ctx)
                    .map_err(|e| convert::caught(e))
                    .context("internal error in the ssqch prelude")?;
            }
            views::install(&ctx, &engine)?;
            let natives = Object::new(ctx.clone())?;
            let conv = Conv::new(&ctx, &engine)?;
            for module in modules.iter() {
                let exports = Object::new(ctx.clone())?;
                for (name, value) in &module.natives {
                    exports.set(name.as_str(), conv.to_js(value)?)?;
                }
                natives.set(module.name.as_str(), exports)?;
            }
            ctx.globals().get::<_, Object>("__ssqch")?.set("natives", natives)?;
            Ok(())
        })?;
        Ok(engine)
    }

    /// Run `f` with the engine locked.
    pub(crate) fn with<R>(&self, f: impl FnOnce(Ctx) -> Result<R>) -> Result<R> {
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                IN_JS.with(|c| c.set(false));
            }
        }
        if IN_JS.with(|c| c.replace(true)) {
            bail!("a JavaScript function was called from inside another JavaScript call, which ssqch doesn't support yet");
        }
        let _reset = Reset;
        self.context.with(|ctx| {
            let result = f(ctx.clone());
            if !self.views_used.swap(false, std::sync::atomic::Ordering::Relaxed) {
                return result;
            }
            // Forget which views exist, so their identity map doesn't grow.
            let end: rquickjs::Result<()> = ctx.globals().get::<_, Object>("__ssqch").and_then(|h| h.get::<_, Function>("endCall")).and_then(|f| f.call(()));
            if let Err(e) = end {
                if result.is_ok() {
                    return Err(anyhow!("internal error ending a JavaScript call: {}", e));
                }
            }
            result
        })
    }

    /// A handle to the JavaScript function kept at index `id`.
    fn function(self: &Arc<Self>, id: Value) -> Result<JsFn> {
        let id = id.as_f64().ok_or_else(|| anyhow!("internal error: missing function id"))? as u32;
        Ok(JsFn { engine: self.clone(), id })
    }

    /// A template function value that calls `f`.
    pub(crate) fn value(&self, f: JsFn) -> Value {
        let id = f.id;
        let func = Func::new(move |args| f.call(args));
        let mut origins = self.origins.lock().unwrap();
        if origins.len() >= 1024 && origins.len().is_power_of_two() {
            origins.retain(|_, (weak, _)| weak.strong_count() > 0);
        }
        origins.insert(Arc::as_ptr(&func.0) as *const () as usize, (Arc::downgrade(&func.0), id));
        Value::Func(func)
    }

    /// The JavaScript function behind `f`, if it wraps one.
    pub(crate) fn origin(&self, f: &Func) -> Option<u32> {
        let origins = self.origins.lock().unwrap();
        let (weak, id) = origins.get(&(Arc::as_ptr(&f.0) as *const () as usize))?;
        weak.upgrade().filter(|live| Arc::ptr_eq(live, &f.0)).map(|_| *id)
    }
}

/// A JavaScript function, callable from any thread.
#[derive(Clone)]
pub(crate) struct JsFn {
    pub(crate) engine: Arc<Engine>,
    pub(crate) id: u32,
}

impl JsFn {
    /// Call with template values; a returned Promise is awaited.
    pub(crate) fn call(&self, args: &[Value]) -> Result<Value> {
        self.engine.with(|ctx| {
            let conv = Conv::new(&ctx, &self.engine)?;
            let fns: rquickjs::Array = ctx.globals().get::<_, Object>("__ssqch")?.get("fns")?;
            let f: Function = fns.get(self.id as usize)?;
            let js_args = args.iter().map(|a| conv.to_js(a)).collect::<Result<Vec<_>>>()?;
            let out = f
                .call::<_, rquickjs::Value>((rquickjs::function::Rest(js_args),))
                .and_then(convert::settle)
                .catch(&ctx)
                .map_err(|e| convert::caught(e))?;
            conv.from_js(out)
        })
    }
}

/// `process.env`, `process.cwd()` and `process.platform`. The build's
/// environment is filled in for `SSQCH_ENV` when it's unset, so code that
/// reads it sees the `--env` choice.
fn process_object<'js>(ctx: &Ctx<'js>, root: &Path, env: &str) -> rquickjs::Result<Object<'js>> {
    let process = Object::new(ctx.clone())?;
    let vars = Object::new(ctx.clone())?;
    for (k, v) in std::env::vars() {
        vars.set(k, v)?;
    }
    if std::env::var_os("SSQCH_ENV").is_none() {
        vars.set("SSQCH_ENV", env)?;
    }
    process.set("env", vars)?;
    let cwd = root.to_string_lossy().into_owned();
    process.set("cwd", Function::new(ctx.clone(), move || cwd.clone())?)?;
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    process.set("platform", platform)?;
    Ok(process)
}
