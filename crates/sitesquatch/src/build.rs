//! The build pipeline.
//!
//! 1. Run `before_build` hooks, set up engines, load global data.
//! 2. Discover templates and resolve each one's data cascade:
//!    global data < layout front matter < directory data < template data
//!    file < front matter < `computed`.
//! 3. Expand pagination, render permalinks, check for output conflicts.
//! 4. Render page bodies in parallel. Bodies that don't mention `collections`
//!    go first, so their `templateContent` can appear in collections (feeds).
//! 5. Wrap bodies in layouts, run transforms, write files, copy passthroughs.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};
use rayon::prelude::*;
use regex::Regex;

use crate::config::{BuildContext, BuildReport, CollectionApi, Config, TransformContext};
use crate::data::{self, merge, normalize_tags};
use crate::diagnostics::{self, Diagnostic, Diagnostics, Severity};
use crate::engines::{load_hook_templates, EdgeEngine, EngineEnv, Engines, MarkdownEngine, PlainEngine, RenderContext, TemplateEngine};
use crate::{Map, Value};

struct Layout {
    name: String,
    /// The engines it runs through: `.html` layouts get `htmlEngine` first,
    /// `.md` layouts `markdownEngine`, like pages.
    engines: Vec<String>,
    body: String,
    data: Map,
}

/// The engines a file with extension `ext` runs through, unless its data says otherwise.
fn engines_for(cfg: &Config, ext: &str) -> Vec<String> {
    let pre = match ext {
        "md" | "markdown" => cfg.markdown_engine.clone(),
        "html" => cfg.html_engine.clone(),
        _ => None,
    };
    let ext = if ext == "markdown" { "md" } else { ext };
    pre.into_iter().chain(std::iter::once(ext.to_string())).collect()
}

struct Tpl {
    input: PathBuf,
    /// Path relative to the input directory, `/`-separated.
    rel: String,
    body: String,
    data: Map,
    engines: Vec<String>,
    layouts: Vec<Arc<Layout>>,
    file_slug: String,
    file_path_stem: String,
    mtime: DateTime<Utc>,
    /// The date at the start of the file name (`2024-06-01-post.md`).
    file_date: Option<DateTime<Utc>>,
    /// `page.lastModified`, with the `last_modified` setting.
    last_modified: Option<DateTime<Utc>>,
    /// Plain text with no front matter: copied as-is and kept out of collections.
    plain_copy: bool,
    /// The keys in the file's own front matter, for schemas' `unknown`.
    front_keys: Vec<String>,
    /// For `ssqch inspect`: each level of the data cascade that set something,
    /// lowest first, by what to call it. Empty in a build.
    layers: Vec<(String, Map)>,
}

struct Page {
    tpl: Arc<Tpl>,
    data: Arc<Map>,
    url: Option<String>,
    output: Option<PathBuf>,
    date: DateTime<Utc>,
    in_collections: bool,
}

struct Timer {
    last: Instant,
    timings: Vec<(String, std::time::Duration)>,
}

impl Timer {
    fn lap(&mut self, label: &str) {
        let now = Instant::now();
        self.timings.push((label.to_string(), now - self.last));
        self.last = now;
    }
}

pub fn build(cfg: &Config) -> Result<BuildReport> {
    let started = Instant::now();
    let mut timer = Timer { last: started, timings: Vec::new() };
    let ctx = cfg.build_context();
    if !ctx.input_dir.is_dir() {
        bail!("input directory {} does not exist", ctx.input_dir.display());
    }

    let built = run_file_builders(cfg, &ctx)?;
    for hook in &cfg.before_build {
        hook(&ctx).context("before_build hook failed")?;
    }
    let Prepared { markdown, engines, theme_includes, global, files, tpls, mut pages, theme_copies } = prepare(cfg, &ctx, &mut timer, false)?;
    check_schemas(cfg, &ctx, &pages)?;
    timer.lap("paginate");

    // ---- render bodies
    let mut collection_includes = includes_using_collections(&ctx.includes_dir);
    for dir in &theme_includes {
        collection_includes.extend(includes_using_collections(dir));
    }
    // Pages paginated over a collection render last too: their items are
    // refreshed from the finished collections, so they have `content`.
    let over_collections = |p: &Page| p.data.get("pagination").and_then(|p| p.get("data").as_str().map(|d| d.starts_with("collections."))).unwrap_or(false);
    let (early, late): (Vec<usize>, Vec<usize>) = (0..pages.len())
        .filter(|&i| pages[i].output.is_some() || pages[i].in_collections)
        .partition(|&i| !uses_collections(&pages[i].tpl, &collection_includes) && !over_collections(&pages[i]));
    let mut contents: HashMap<usize, Body> = collect_errors(
        early.par_iter().map(|&i| render_body(&pages[i], &engines, None).map(|c| (i, c))).collect(),
    )?
    .into_iter()
    .collect();
    let collections = build_collections(cfg, &pages, &contents)?;
    for &i in &late {
        if over_collections(&pages[i]) {
            refresh_pagination(&mut pages[i], &collections).with_context(|| format!("in {}", pages[i].tpl.rel))?;
        }
    }
    let late_contents: Vec<(usize, Body)> =
        collect_errors(late.par_iter().map(|&i| render_body(&pages[i], &engines, Some(&collections)).map(|c| (i, c))).collect())?;
    contents.extend(late_contents);
    timer.lap("render");

    // ---- layouts, transforms, write
    let outputs: Vec<(usize, PathBuf)> = pages.iter().enumerate().filter_map(|(i, p)| p.output.clone().map(|o| (i, o))).collect();
    let written: Vec<(PathBuf, u64)> = collect_errors(
        outputs
            .par_iter()
            .map(|(i, out)| guard(&pages[*i].tpl.rel, || {
                let page = &pages[*i];
                let body = contents.get(i).cloned().unwrap_or_default();
                let mut html = render_layouts(page, body, &engines, &collections)?;
                let tctx = TransformContext { url: page.url.as_deref().unwrap_or(""), output_path: out, input_path: &page.tpl.input, build: &ctx };
                for (name, transform) in cfg.html_transforms.iter().chain(&cfg.transforms) {
                    html = transform(&tctx, html).with_context(|| format!("transform `{}` failed for {}", name, page.tpl.rel))?;
                }
                // Last, so URLs that transforms wrote (images, fingerprinted assets) get it too.
                if !ctx.base.is_empty() && tctx.is_html() {
                    html = crate::base::rewrite_html(&html, &ctx.base).with_context(|| format!("in {}", page.tpl.rel))?;
                }
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(out, &html).with_context(|| format!("writing {}", out.display()))?;
                if !cfg.quiet {
                    diagnostics::progress(&format!("[ssqch] Writing {} from {} ({})", display_path(&ctx, out), display_path(&ctx, &page.tpl.input), page.tpl.engines.join(", ")));
                }
                Ok((out.clone(), html.len() as u64))
            }))
            .collect(),
    )?;
    timer.lap("write");

    let generated = run_generators(cfg, &ctx, &pages, &written, &markdown, &global)?;
    let mut bundles = if cfg.bundles { bundle_files(cfg, &ctx, &pages, &files)? } else { Vec::new() };
    bundles.extend(theme_copies);
    let copy = passthrough_copy(cfg, &ctx, bundles)?;
    let stylesheet = write_highlight_css(cfg, &ctx)?;
    timer.lap("copy");

    let outputs: Vec<&PathBuf> = written.iter().map(|(p, _)| p).chain(&generated).chain(&built).chain(&copy.paths).chain(&stylesheet).collect();
    let files_removed = record_outputs(cfg, &ctx, &outputs)?;

    let mut report = BuildReport {
        templates: tpls.len(),
        pages_written: written.len(),
        page_bytes: written.iter().map(|(_, n)| n).sum(),
        files_copied: copy.copied,
        files_unchanged: copy.unchanged,
        passthrough_bytes: copy.bytes,
        files_removed,
        written: written.into_iter().map(|(p, _)| p).chain(generated).collect(),
        duration: started.elapsed(),
        ..Default::default()
    };
    for hook in &cfg.after_build {
        hook(&ctx, &report).context("after_build hook failed")?;
    }
    report.summary = cfg.summaries.iter().filter_map(|(label, f)| f(&ctx).map(|line| (label.clone(), line))).collect();
    timer.lap("after");
    report.duration = started.elapsed();
    report.timings = timer.timings;
    Ok(report)
}

/// Everything up to the list of pages: engines, global data, templates with
/// their data, and each page's URL. What `build` renders, and what
/// [`crate::inspect`] reports on.
struct Prepared {
    markdown: Arc<MarkdownEngine>,
    engines: Arc<Engines>,
    theme_includes: Vec<PathBuf>,
    global: Map,
    files: Vec<PathBuf>,
    tpls: Vec<Arc<Tpl>>,
    pages: Vec<Page>,
    theme_copies: Vec<CopyJob>,
}

fn prepare(cfg: &Config, ctx: &BuildContext, timer: &mut Timer, keep_layers: bool) -> Result<Prepared> {
    // ---- engines
    let markdown = Arc::new(MarkdownEngine::new(cfg.markdown.clone()));
    let mut globals = builtin_filters(&markdown);
    // withBase("/feed.xml"): the URL with the site's `base` in front, for
    // places outside HTML attributes (which the build rewrites itself).
    let base = ctx.base.clone();
    globals.insert("withBase".into(), Value::func(move |args| Ok(Value::from(crate::base::with_base(&base, &args.first().map(Value::to_js_string).unwrap_or_default())))));
    for (name, f) in &cfg.filters {
        globals.insert(name.clone(), f.clone());
    }
    let theme_includes: Vec<PathBuf> = ctx.theme_dirs.iter().map(|t| t.join("_includes")).collect();
    let env = EngineEnv { includes_dir: ctx.includes_dir.clone(), theme_includes: theme_includes.clone(), globals, build: ctx.clone(), strict: cfg.strict };
    let edge = Arc::new(EdgeEngine::new(&env));
    let mut by_name: HashMap<String, Arc<dyn TemplateEngine>> = HashMap::new();
    by_name.insert("edge".into(), edge.clone());
    by_name.insert("md".into(), markdown.clone());
    by_name.insert("html".into(), Arc::new(PlainEngine));
    by_name.insert("txt".into(), Arc::new(PlainEngine));
    for (ext, factory) in &cfg.engines {
        by_name.insert(ext.clone(), factory(&env).with_context(|| format!("setting up the `{}` engine", ext))?);
    }
    let engines = Arc::new(Engines { edge, by_name });
    for f in &cfg.template_formats {
        engines.get(f).context("check `template_formats`")?;
    }
    // A theme's hooks and containers, then the site's own on top of them.
    let mut hooks = HashMap::new();
    for dir in theme_includes.iter().rev() {
        hooks.extend(load_hook_templates(dir, "_includes (theme)", &engines, &|ext| engines_for(cfg, ext))?);
    }
    hooks.extend(load_hook_templates(&ctx.includes_dir, &slashes(&cfg.includes), &engines, &|ext| engines_for(cfg, ext))?);
    markdown.set_hooks(hooks, Arc::downgrade(&engines));
    crate::markdown::set_current(cfg.markdown.clone());

    timer.lap("setup");

    // ---- global data
    let (site_data, skipped) = data::load_global_data(&ctx.data_dir, &cfg.data_extensions)?;
    // Themes' `_data` first (the one on top last), then the site's over it.
    let mut global = Map::new();
    for theme in ctx.theme_dirs.iter().rev() {
        let (theme_data, _) = data::load_global_data(&theme.join("_data"), &cfg.data_extensions)?;
        merge(&mut global, &theme_data, cfg.data_deep_merge);
    }
    merge(&mut global, &site_data, cfg.data_deep_merge);
    let provided: Vec<(String, Result<Value>)> = cfg
        .global_data
        .par_iter()
        .map(|(name, f)| (name.clone(), f(ctx).with_context(|| format!("global data `{}` failed", name))))
        .collect();
    for (name, value) in provided {
        global.insert(name, value?);
    }
    for file in skipped {
        let stem = file.rsplit('/').next().unwrap_or(&file).split('.').next().unwrap_or("");
        if !global.contains_key(stem) && !cfg.quiet {
            let path = display_path(ctx, &ctx.data_dir.join(&file));
            diagnostics::warn(Diagnostic::warning("data", format!("skipped _data/{} (no loader for that format; provide `{}` with Config::add_global_data)", file, stem)).file(path));
        }
    }
    let version = env!("CARGO_PKG_VERSION");
    let runtime = Value::from_pairs([
        ("version", Value::from(version)),
        ("generator", Value::from(format!("SiteSquatch v{}", version))),
        ("env", Value::from(ctx.env.as_str())),
        ("serving", Value::Bool(ctx.serving)),
        ("base", Value::from(ctx.base.as_str())),
    ]);
    global.insert("ssqch".into(), runtime);
    timer.lap("data");

    // ---- templates
    let mut files = discover(cfg, ctx)?;
    // Pages and files from themes that the site doesn't have itself.
    let (theme_pages, theme_copies) = theme_files(cfg, ctx)?;
    files.extend(theme_pages);
    let commit_dates = match cfg.last_modified {
        Some(crate::LastModified::Git) => git_dates(cfg, ctx),
        _ => HashMap::new(),
    };
    let dir_data = load_directory_data(cfg, ctx, &files)?;
    let layouts: Mutex<HashMap<String, Arc<Layout>>> = Mutex::new(HashMap::new());
    let shared = Shared { global: &global, dir_data: &dir_data, layouts: &layouts, commit_dates: &commit_dates, keep_layers };
    let mut tpls: Vec<Arc<Tpl>> = collect_errors(
        files.par_iter().map(|path| load_template(cfg, ctx, path, &shared).map(Arc::new)).collect(),
    )?;
    // Drafts (`draft: true`) are built in development only.
    if ctx.env == crate::Environment::Production {
        tpls.retain(|t| {
            let draft = t.data.get("draft").is_some_and(Value::truthy);
            if draft && cfg.verbose {
                diagnostics::progress(&format!("[ssqch] Skipping draft {}", t.rel));
            }
            !draft
        });
    }
    timer.lap("read");

    // ---- pagination, computed data and permalinks
    let (deferred, immediate): (Vec<_>, Vec<_>) = tpls.iter().partition(|t| {
        t.data.get("pagination").map(|p| p.get("data")).and_then(|d| d.as_str().map(|s| s.starts_with("collections"))).unwrap_or(false)
    });
    let mut pages: Vec<Page> = collect_errors(immediate.par_iter().map(|t| expand(ctx, t, None, &engines)).collect())?
        .into_iter()
        .flatten()
        .collect();
    if !deferred.is_empty() {
        let shallow = build_collections(cfg, &pages, &HashMap::new())?;
        let more: Vec<Page> = collect_errors(deferred.par_iter().map(|t| expand(ctx, t, Some(&shallow), &engines)).collect())?
            .into_iter()
            .flatten()
            .collect();
        pages.extend(more);
    }
    check_conflicts(ctx, &pages)?;
    Ok(Prepared { markdown, engines, theme_includes, global, files, tpls, pages, theme_copies })
}

/// A page as `ssqch inspect` sees it.
pub(crate) struct InspectedPage {
    pub url: Option<String>,
    pub input: PathBuf,
    pub output: Option<PathBuf>,
    pub engines: Vec<String>,
    pub layouts: Vec<String>,
    pub date: DateTime<Utc>,
    /// Whether the date is the one at the start of the file's name.
    pub date_from_name: bool,
    pub in_collections: bool,
    pub data: Arc<Map>,
    pub layers: Vec<(String, Map)>,
}

/// Every page the site would build, with where its data came from. Nothing
/// is rendered or written, and build hooks don't run.
pub(crate) fn inspect_pages(cfg: &Config) -> Result<(BuildContext, Map, Vec<InspectedPage>)> {
    let ctx = cfg.build_context();
    if !ctx.input_dir.is_dir() {
        bail!("input directory {} does not exist", ctx.input_dir.display());
    }
    let mut timer = Timer { last: Instant::now(), timings: Vec::new() };
    let prepared = prepare(cfg, &ctx, &mut timer, true)?;
    let pages = prepared
        .pages
        .iter()
        .map(|p| InspectedPage {
            url: p.url.clone(),
            input: p.tpl.input.clone(),
            output: p.output.clone(),
            engines: p.tpl.engines.clone(),
            layouts: p.tpl.layouts.iter().map(|l| l.name.clone()).collect(),
            date: p.date,
            date_from_name: p.tpl.file_date.is_some(),
            in_collections: p.in_collections,
            data: p.data.clone(),
            layers: p.tpl.layers.clone(),
        })
        .collect();
    Ok((ctx, prepared.global, pages))
}

/// Filters every site has: `markdown(text)` (or `markdown(text, "inline")`)
/// and `toc(page.headings)` (or `toc(page.headings, { from: 2, to: 4, ordered: true })`).
/// A config filter with the same name replaces one.
fn builtin_filters(markdown: &Arc<MarkdownEngine>) -> Map {
    let mut filters = Map::new();
    let md = markdown.clone();
    filters.insert(
        "markdown".into(),
        Value::func(move |args| {
            let text = args.first().map(|v| if v.is_nullish() { String::new() } else { v.to_js_string() }).unwrap_or_default();
            let inline = match args.get(1) {
                Some(Value::Str(s)) => &**s == "inline",
                Some(v @ Value::Obj(_)) => v.get("inline").truthy(),
                _ => false,
            };
            md.render_html(&text, &Value::Undefined, Path::new(""), inline).map(Value::from)
        }),
    );
    // Navigation: navTree(tree, page.url), navPager(tree, page.url),
    // navBreadcrumbs(tree, page.url) and pagesTree(collection).
    let list = |args: &[Value], i: usize| args.get(i).and_then(|v| v.as_array()).map(|a| a.to_vec()).unwrap_or_default();
    let nav = |args: &[Value]| args.first().cloned().unwrap_or_default();
    let url = |args: &[Value]| args.get(1).map(Value::to_js_string).unwrap_or_default();
    filters.insert("navTree".into(), Value::func(move |args| Ok(crate::nav::tree_of(&nav(args), &url(args)))));
    filters.insert("navPager".into(), Value::func(move |args| Ok(crate::nav::pager_of(&nav(args), &url(args)))));
    filters.insert("navBreadcrumbs".into(), Value::func(move |args| Ok(crate::nav::breadcrumbs_of(&nav(args), &url(args)))));
    filters.insert("pagesTree".into(), Value::func(move |args| Ok(crate::nav::from_pages(&list(args, 0)))));
    // highlight(code, lang): highlighted HTML for the inside of <code> (escaped
    // text for a language without a grammar).
    filters.insert(
        "highlight".into(),
        Value::func(|args| {
            let code = args.first().map(Value::to_js_string).unwrap_or_default();
            let lang = args.get(1).map(Value::to_js_string).unwrap_or_default();
            #[cfg(feature = "highlight")]
            if let Some(html) = crate::highlight::highlight(&lang, &code, &[]) {
                return Ok(Value::from(html));
            }
            let _ = lang;
            Ok(Value::from(crate::markdown::escape_text(&code)))
        }),
    );
    filters.insert(
        "readingTime".into(),
        Value::func(|args| {
            let text = args.first().map(Value::to_js_string).unwrap_or_default();
            let wpm = args.get(1).and_then(Value::as_f64).filter(|w| *w > 0.0).unwrap_or(200.0);
            let words = crate::markdown::html_text(&text).split_whitespace().count() as f64;
            Ok(Value::Num((words / wpm).ceil().max(1.0)))
        }),
    );
    filters.insert(
        "toc".into(),
        Value::func(|args| {
            let headings = args.first().and_then(|v| v.as_array()).unwrap_or(&[]);
            let (mut from, mut to, mut ordered) = (2.0, 3.0, false);
            match args.get(1) {
                Some(o @ Value::Obj(_)) => {
                    for key in o.as_object().unwrap().keys() {
                        if !["from", "to", "ordered"].contains(&key.as_str()) {
                            bail!("toc: unknown option `{}` (options: from, to, ordered)", key);
                        }
                    }
                    from = o.get("from").as_f64().unwrap_or(from);
                    to = o.get("to").as_f64().unwrap_or(to);
                    ordered = o.get("ordered").truthy();
                }
                Some(n) if n.as_f64().is_some() => {
                    from = n.to_number();
                    to = args.get(2).and_then(|v| v.as_f64()).unwrap_or(to.max(from));
                }
                _ => {}
            }
            Ok(Value::from(crate::markdown::toc(headings, from.clamp(1.0, 6.0) as u8, to.clamp(1.0, 6.0) as u8, ordered)))
        }),
    );
    filters
}

/// Run every job, then report all failures together rather than just the first.
/// Run `f`, converting a panic into an error so one bad page can't abort the
/// whole build without context.
fn guard<T>(what: &str, f: impl FnOnce() -> Result<T>) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(p) => {
            let msg = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            Err(anyhow!("internal error while processing {}: {}", what, msg))
        }
    }
}

fn collect_errors<T>(results: Vec<Result<T>>) -> Result<Vec<T>> {
    let mut ok = Vec::with_capacity(results.len());
    let mut errors = Vec::new();
    let mut items = Vec::new();
    for r in results {
        match r {
            Ok(v) => ok.push(v),
            Err(e) => {
                errors.push(format!("{:#}", e));
                // Each one apart, for `ssqch build --format json`.
                match e.chain().find_map(|cause| cause.downcast_ref::<Diagnostics>()) {
                    Some(inner) => items.extend(inner.items.iter().cloned()),
                    None => items.push(Diagnostic::error("", format!("{:#}", e))),
                }
            }
        }
    }
    if errors.is_empty() {
        return Ok(ok);
    }
    let count = errors.len();
    errors.truncate(10);
    let message = format!("{} error(s):\n  - {}{}", count, errors.join("\n  - "), if count > 10 { "\n  ..." } else { "" });
    Err(Diagnostics { message, items }.into())
}

/// With `markdown.highlight`, write the highlighting stylesheet (unless
/// `css` is false), skipping the write when it's already up to date.
#[cfg(feature = "highlight")]
fn write_highlight_css(cfg: &Config, ctx: &BuildContext) -> Result<Option<PathBuf>> {
    let Some(url) = cfg.markdown.highlight_css.as_deref().filter(|_| cfg.markdown.highlight) else { return Ok(None) };
    let path = ctx.output_dir.join(url.trim_start_matches('/'));
    if std::fs::read_to_string(&path).ok().as_deref() != Some(crate::highlight::CSS) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, crate::highlight::CSS).with_context(|| format!("writing {}", path.display()))?;
    }
    Ok(Some(path))
}

#[cfg(not(feature = "highlight"))]
fn write_highlight_css(_cfg: &Config, _ctx: &BuildContext) -> Result<Option<PathBuf>> {
    Ok(None)
}

// --------------------------------------------------------------------- clean

/// Where the build records the files it wrote and copied, relative to the
/// output folder, so a later build with `clean` knows which ones are its own.
const OUTPUT_LIST: &str = ".cache/ssqch/output-files.json";

/// Record this build's output files. Files an earlier build recorded that this
/// one didn't produce are stale: with `clean` they're deleted, and without it
/// they stay on the list, so turning `clean` on later still finds them.
/// Returns how many were deleted.
fn record_outputs(cfg: &Config, ctx: &BuildContext, outputs: &[&PathBuf]) -> Result<usize> {
    let list_path = ctx.root.join(OUTPUT_LIST);
    let output_name = slashes(ctx.output_dir.strip_prefix(&ctx.root).unwrap_or(&ctx.output_dir));
    let mut current: BTreeSet<String> = outputs.iter().filter_map(|p| p.strip_prefix(&ctx.output_dir).ok()).map(slashes).collect();
    let previous: Vec<String> = std::fs::read_to_string(&list_path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .filter(|v| v["output"].as_str() == Some(output_name.as_str()))
        .and_then(|v| v["files"].as_array().map(|files| files.iter().filter_map(|f| f.as_str().map(String::from)).collect()))
        .unwrap_or_default();

    let mut removed = 0;
    let stale: Vec<String> = previous.into_iter().filter(|r| !current.contains(r)).collect();
    for rel in stale {
        // Only plain relative paths inside the output folder.
        let rel_path = Path::new(&rel);
        if rel_path.is_absolute() || rel_path.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
            continue;
        }
        let path = ctx.output_dir.join(rel_path);
        if !path.is_file() {
            continue;
        }
        if !cfg.clean {
            // Still ours, and stale: remember it for when `clean` is turned on.
            current.insert(rel);
            continue;
        }
        std::fs::remove_file(&path).with_context(|| format!("removing stale {}", path.display()))?;
        removed += 1;
        if !cfg.quiet {
            diagnostics::progress(&format!("[ssqch] Removed {}", display_path(ctx, &path)));
        }
        // Then any folders that are now empty, up to the output folder.
        let mut dir = path.parent();
        while let Some(d) = dir.filter(|d| *d != ctx.output_dir && d.starts_with(&ctx.output_dir)) {
            if std::fs::remove_dir(d).is_err() {
                break;
            }
            dir = d.parent();
        }
    }

    if let Some(parent) = list_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let list = serde_json::to_string_pretty(&serde_json::json!({ "output": output_name, "files": current }))?;
    // Left alone when nothing changed, so a build with nothing new touches no files.
    if std::fs::read_to_string(&list_path).ok().as_deref() != Some(list.as_str()) {
        std::fs::write(&list_path, list).with_context(|| format!("writing {}", list_path.display()))?;
    }
    Ok(removed)
}

// ------------------------------------------------------------------ discover

/// Whether a passthrough entry is a glob (`src/**/*.png`) rather than a path.
fn is_glob(path: &Path) -> bool {
    path.to_string_lossy().contains(['*', '?', '[', '{'])
}

/// A glob set, naming `what` (the config key) in errors.
fn glob_set<'a>(what: &str, globs: impl IntoIterator<Item = &'a str>) -> Result<globset::GlobSet> {
    let mut set = globset::GlobSetBuilder::new();
    for g in globs {
        let g = g.trim_start_matches("./");
        set.add(globset::GlobBuilder::new(g).literal_separator(true).build().with_context(|| format!("{}: invalid glob {:?}", what, g))?);
    }
    Ok(set.build()?)
}

fn discover(cfg: &Config, ctx: &BuildContext) -> Result<Vec<PathBuf>> {
    let mut formats: HashSet<String> = cfg.template_formats.iter().map(|f| f.to_ascii_lowercase()).collect();
    if formats.contains("md") {
        formats.insert("markdown".into());
    }
    let ignore = glob_set("ignore", cfg.ignore.iter().map(String::as_str))?;
    let passthrough_globs = glob_set("passthrough", cfg.passthrough.iter().map(|(from, _)| from).filter(|f| is_glob(f)).map(|f| f.to_str().unwrap_or("")))?;
    let skip_dirs: Vec<PathBuf> = [ctx.includes_dir.clone(), ctx.layouts_dir.clone(), ctx.data_dir.clone(), ctx.output_dir.clone()]
        .into_iter()
        // A theme folder inside the input folder is a theme, not pages of the site's own.
        .chain(ctx.theme_dirs.iter().cloned())
        .chain(cfg.passthrough.iter().map(|(from, _)| ctx.root.join(from)))
        .map(|p| dunce::canonicalize(&p).unwrap_or(p))
        .collect();
    let mut files = Vec::new();
    let walker = walkdir::WalkDir::new(&ctx.input_dir).follow_links(true).into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        if e.depth() > 0 && (name.starts_with('.') || name == "node_modules") {
            return false;
        }
        let path = dunce::canonicalize(e.path()).unwrap_or_else(|_| e.path().to_path_buf());
        !skip_dirs.contains(&path)
    });
    for entry in walker {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if is_data_file(&name) {
            continue;
        }
        let ext = entry.path().extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if !formats.contains(&ext) {
            continue;
        }
        let rel = slashes(entry.path().strip_prefix(&ctx.input_dir).unwrap_or(entry.path()));
        if ignore.is_match(&rel) || passthrough_globs.is_match(slashes(entry.path().strip_prefix(&ctx.root).unwrap_or(entry.path()))) {
            continue;
        }
        files.push(entry.into_path());
    }
    files.sort();
    Ok(files)
}

/// A file to copy, and where to.
type CopyJob = (PathBuf, PathBuf);

/// The folder `path` is a page of: the theme it's in, or the input folder.
fn root_of<'a>(ctx: &'a BuildContext, path: &Path) -> &'a Path {
    ctx.theme_dirs.iter().find(|t| path.starts_with(t)).map(PathBuf::as_path).unwrap_or(&ctx.input_dir)
}

/// Files at the top of a theme's folder that are about the theme, not part of it.
fn is_theme_meta(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(stem.as_str(), "README" | "LICENSE" | "LICENCE" | "CHANGELOG" | "CONTRIBUTING" | "PACKAGE" | "PACKAGE-LOCK" | "PNPM-LOCK" | "SSQCH") || name == "jsconfig.json"
}

/// What themes add to the site: (pages to render, files to copy to the
/// output). A path the site's input folder has is the site's, and a theme
/// on top hides the same path in a theme below it.
fn theme_files(cfg: &Config, ctx: &BuildContext) -> Result<(Vec<PathBuf>, Vec<CopyJob>)> {
    let mut formats: HashSet<String> = cfg.template_formats.iter().map(|f| f.to_ascii_lowercase()).collect();
    if formats.contains("md") {
        formats.insert("markdown".into());
    }
    let ignore = glob_set("ignore", cfg.ignore.iter().map(String::as_str))?;
    let (mut pages, mut copies) = (Vec::new(), Vec::new());
    let mut taken: HashSet<String> = HashSet::new();
    for theme in &ctx.theme_dirs {
        let walker = walkdir::WalkDir::new(theme).follow_links(true).sort_by_file_name().into_iter().filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            e.depth() == 0 || !(name.starts_with('.') || name == "node_modules" || (e.depth() == 1 && (name == "_includes" || name == "_data" || is_theme_meta(&name))))
        });
        for entry in walker {
            let entry = entry?;
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let rel = slashes(path.strip_prefix(theme).unwrap_or(path));
            if ignore.is_match(&rel) || ctx.input_dir.join(&rel).exists() || !taken.insert(rel.clone()) {
                continue;
            }
            let name = entry.file_name().to_string_lossy();
            let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if formats.contains(&ext) && !is_data_file(&name) {
                pages.push(path.to_path_buf());
                continue;
            }
            // Data for a page or a folder (`posts/posts.json`, `about.json` next to `about.md`) isn't copied.
            let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let dir_name = path.parent().and_then(|d| d.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let is_data_ext = matches!(ext.as_str(), "json" | "yaml" | "yml" | "toml");
            let beside_page = formats.iter().any(|f| path.with_extension(f).is_file());
            if is_data_file(&name) || (is_data_ext && (stem == dir_name || beside_page)) {
                continue;
            }
            copies.push((path.to_path_buf(), ctx.output_dir.join(&rel)));
        }
    }
    Ok((pages, copies))
}

/// Template and directory data files (`hello.data.js`, `posts.data.json`)
/// sit next to templates, but aren't templates themselves.
fn is_data_file(name: &str) -> bool {
    name.contains(".data.")
}

/// Directory data files: `posts/posts.json` (or `posts/posts.data.json`)
/// applies to everything inside `posts/`.
fn load_directory_data(cfg: &Config, ctx: &BuildContext, files: &[PathBuf]) -> Result<HashMap<PathBuf, Map>> {
    let mut dirs: HashSet<PathBuf> = HashSet::new();
    for f in files {
        let root = root_of(ctx, f);
        let mut dir = f.parent();
        while let Some(d) = dir {
            if !d.starts_with(root) {
                break;
            }
            dirs.insert(d.to_path_buf());
            dir = d.parent();
        }
    }
    let mut out = HashMap::new();
    for dir in dirs {
        let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let mut data = Map::new();
        let mut candidates = Vec::new();
        for ext in ["json", "yaml", "yml", "toml"] {
            candidates.push(format!("{}.{}", name, ext));
            candidates.push(format!("{}.data.{}", name, ext));
        }
        // Added formats (JavaScript) only with the `.data.` suffix, so a
        // `posts/posts.js` script isn't mistaken for data.
        candidates.extend(cfg.data_extensions.iter().map(|(ext, _)| format!("{}.data.{}", name, ext)));
        for candidate in candidates {
            let path = dir.join(&candidate);
            if path.is_file() {
                if let Some(Value::Obj(o)) = data::load_data_file(&path, &cfg.data_extensions)? {
                    merge(&mut data, &o, true);
                }
            }
        }
        if !data.is_empty() {
            normalize_tags(&mut data);
            out.insert(dir, data);
        }
    }
    Ok(out)
}

fn load_layout(cfg: &Config, ctx: &BuildContext, name: &str, cache: &Mutex<HashMap<String, Arc<Layout>>>) -> Result<Arc<Layout>> {
    if let Some(l) = cache.lock().unwrap().get(name) {
        return Ok(l.clone());
    }
    // The site's layouts folder, then each theme's includes.
    let dirs = std::iter::once(ctx.layouts_dir.clone()).chain(ctx.theme_dirs.iter().map(|t| t.join("_includes")));
    let path = dirs
        .flat_map(|dir| std::iter::once(dir.join(name)).chain(cfg.template_formats.iter().map(move |ext| dir.join(format!("{}.{}", name, ext)))).collect::<Vec<_>>())
        .find(|p| p.is_file())
        .ok_or_else(|| anyhow!("layout `{}` not found in {}{}", name, ctx.layouts_dir.display(), if ctx.theme_dirs.is_empty() { "" } else { " or the theme" }))?;
    let src = std::fs::read_to_string(&path)?;
    let (data, body) = data::parse_front_matter(&src).with_context(|| format!("in layout {}", path.display()))?;
    let layout = Arc::new(Layout {
        name: format!("{}/{}", slashes(cfg.layouts.as_ref().unwrap_or(&cfg.includes)), name),
        engines: engines_for(cfg, &path.extension().unwrap().to_string_lossy().to_ascii_lowercase()),
        body: body.to_string(),
        data,
    });
    cache.lock().unwrap().insert(name.to_string(), layout.clone());
    Ok(layout)
}

/// What every template is loaded with.
struct Shared<'a> {
    global: &'a Map,
    dir_data: &'a HashMap<PathBuf, Map>,
    layouts: &'a Mutex<HashMap<String, Arc<Layout>>>,
    commit_dates: &'a HashMap<PathBuf, DateTime<Utc>>,
    /// Keep each level of the cascade apart as well, for `ssqch inspect`.
    keep_layers: bool,
}

fn load_template(cfg: &Config, ctx: &BuildContext, path: &Path, shared: &Shared) -> Result<Tpl> {
    let Shared { global, dir_data, layouts, commit_dates, keep_layers } = *shared;
    let root = root_of(ctx, path);
    let rel_path = path.strip_prefix(root).unwrap_or(path);
    let rel = rel_path.to_string_lossy().replace('\\', "/");
    (|| {
        let src = std::fs::read_to_string(path)?;
        let (front, body) = data::parse_front_matter(&src)?;
        let has_front_matter = body.len() != src.len();

        // Template-level data: directory data (outermost first), then the
        // template's own data file, then front matter.
        let mut own = Map::new();
        let mut dirs: Vec<&Path> = path.ancestors().skip(1).take_while(|d| d.starts_with(root)).collect();
        dirs.reverse();
        let mut layers: Vec<(String, Map)> = Vec::new();
        for d in dirs {
            if let Some(data) = dir_data.get(d) {
                merge(&mut own, data, cfg.data_deep_merge);
                if keep_layers {
                    // Named by its file, when there's just the one.
                    let name = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    let files: Vec<PathBuf> = std::fs::read_dir(d).map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.file_stem().is_some_and(|s| s.to_string_lossy() == name || s.to_string_lossy() == format!("{}.data", name))).collect()).unwrap_or_default();
                    let label = match files.as_slice() {
                        [one] => display_path(ctx, one).trim_start_matches("./").to_string(),
                        _ => format!("directory data in {}/", display_path(ctx, d).trim_start_matches("./")),
                    };
                    layers.push((label, data.clone()));
                }
            }
        }
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let suffixes = ["json".to_string(), "data.json".to_string()].into_iter().chain(cfg.data_extensions.iter().map(|(ext, _)| format!("data.{}", ext)));
        for suffix in suffixes {
            let candidate = path.with_file_name(format!("{}.{}", stem, suffix));
            if candidate.is_file() {
                if let Some(Value::Obj(o)) = data::load_data_file(&candidate, &cfg.data_extensions)? {
                    merge(&mut own, &o, cfg.data_deep_merge);
                    if keep_layers {
                        layers.push((display_path(ctx, &candidate).trim_start_matches("./").to_string(), (*o).clone()));
                    }
                }
            }
        }
        let mut front = front;
        let front_keys: Vec<String> = front.keys().cloned().collect();
        normalize_tags(&mut front);
        merge(&mut own, &front, cfg.data_deep_merge);
        if keep_layers && !front.is_empty() {
            layers.push(("front matter".to_string(), front.clone()));
        }

        // Layout chain; layout front matter sits below template data.
        let mut chain = Vec::new();
        let mut next = own.get("layout").and_then(|l| l.as_str().map(String::from));
        while let Some(name) = next {
            if chain.len() > 20 {
                bail!("layout chain is too deep (circular layouts?)");
            }
            let layout = load_layout(cfg, ctx, &name, layouts)?;
            next = layout.data.get("layout").and_then(|l| l.as_str().map(String::from));
            chain.push(layout);
        }
        let mut data = global.clone();
        let mut layout_layers = 0;
        for layout in chain.iter().rev() {
            merge(&mut data, &layout.data, cfg.data_deep_merge);
            // Layouts sit below everything the page has of its own, outermost first.
            if keep_layers && !layout.data.is_empty() {
                layers.insert(layout_layers, (format!("layout {}", layout.name), layout.data.clone()));
                layout_layers += 1;
            }
        }
        merge(&mut data, &own, cfg.data_deep_merge);
        normalize_tags(&mut data);

        let mut ext = path.extension().unwrap().to_string_lossy().to_ascii_lowercase();
        if ext == "markdown" {
            ext = "md".into();
        }
        if data.contains_key("templateEngineOverride") {
            bail!("front matter `templateEngineOverride` is now `render` (for example `render: md`)");
        }
        let engines: Vec<String> = match data.get("render").filter(|v| !v.is_nullish()) {
            Some(v) => render_engines(v)?,
            None => engines_for(cfg, &ext),
        };

        let mut file_slug = stem.clone();
        if file_slug == "index" {
            file_slug = rel_path.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        }
        let date_prefix = Regex::new(r"^\d{4}-\d{2}-\d{2}-").unwrap();
        let file_slug = date_prefix.replace(&file_slug, "").to_string();
        let file_date = (stem.len() >= 10).then(|| &stem[..10]).filter(|d| date_prefix.is_match(&format!("{}-", d))).and_then(|d| Value::from(d).to_date());
        let parent = rel_path.parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let file_path_stem = if parent.is_empty() { format!("/{}", stem) } else { format!("/{}/{}", parent, stem) };
        let mtime = std::fs::metadata(path)?.modified().unwrap_or(SystemTime::now());

        let plain_copy = !has_front_matter && engines.iter().all(|e| e == "txt");
        Ok(Tpl {
            layers,
            front_keys,
            plain_copy,
            input: path.to_path_buf(),
            rel: rel.clone(),
            body: body.to_string(),
            data,
            engines,
            layouts: chain,
            file_slug,
            file_path_stem,
            mtime: DateTime::<Utc>::from(mtime),
            file_date,
            last_modified: match cfg.last_modified {
                Some(crate::LastModified::Git) => Some(commit_dates.get(path).copied().unwrap_or(DateTime::<Utc>::from(mtime))),
                Some(crate::LastModified::File) => Some(DateTime::<Utc>::from(mtime)),
                None => None,
            },
        })
    })()
    .with_context(|| format!("in {}", rel))
}

// ---------------------------------------------------------------- pagination

fn expand(ctx: &BuildContext, tpl: &Arc<Tpl>, collections: Option<&Value>, engines: &Engines) -> Result<Vec<Page>> {
    (|| {
        let input_path = display_path(ctx, &tpl.input);
        let date = match tpl.data.get("date") {
            Some(v) if !v.is_nullish() => v.to_date().ok_or_else(|| anyhow!("can't parse date {:?}", v))?,
            // Then the date in the file name, then when the file last changed.
            _ => tpl.file_date.unwrap_or(tpl.mtime),
        };
        let base_page = |url: Value, output: Value, date: DateTime<Utc>| {
            let mut page = vec![
                ("url", url),
                ("outputPath", output),
                ("inputPath", Value::from(input_path.as_str())),
                ("fileSlug", Value::from(tpl.file_slug.as_str())),
                ("filePathStem", Value::from(tpl.file_path_stem.as_str())),
                ("date", Value::Date(date)),
            ];
            if let Some(modified) = tpl.last_modified {
                page.push(("lastModified", Value::Date(modified)));
            }
            Value::from_pairs(page)
        };

        let pagination = tpl.data.get("pagination").filter(|p| p.as_object().is_some()).cloned();
        let mut chunks: Vec<Option<(usize, Vec<Value>)>> = vec![None];
        let mut size = 1;
        if let Some(p) = &pagination {
            let path = p.get("data").as_str().ok_or_else(|| anyhow!("pagination.data must be a string"))?.to_string();
            // `collections.posts` is a collection's pages; `collections` alone is the collections' names (a page per tag).
            let source = match (path.strip_prefix("collections."), collections) {
                (Some(rest), Some(c)) => c.get_path(rest),
                (None, Some(c)) if path == "collections" => c.clone(),
                _ => Value::object(tpl.data.clone()).get_path(&path),
            };
            let items = pagination_items(p, &path, source)?;
            size = p.get("size").as_f64().unwrap_or(1.0).max(1.0) as usize;
            chunks = items.chunks(size).enumerate().map(|(i, c)| Some((i, c.to_vec()))).collect();
            if chunks.is_empty() {
                return Ok(Vec::new());
            }
        }
        let all_chunks = Value::array(chunks.iter().flatten().map(|(_, c)| if size == 1 { c[0].clone() } else { Value::array(c.clone()) }).collect());

        let mut pages = Vec::new();
        for chunk in &chunks {
            let mut data = tpl.data.clone();
            if let (Some(p), Some((index, items))) = (&pagination, chunk) {
                let mut pagination_obj = p.as_object().cloned().unwrap_or_default();
                pagination_obj.insert("items".into(), Value::array(items.clone()));
                pagination_obj.insert("pageNumber".into(), Value::from(*index));
                pagination_obj.insert("pages".into(), all_chunks.clone());
                data.insert("pagination".into(), Value::object(pagination_obj));
                if let Some(alias) = p.get("alias").as_str() {
                    data.insert(alias.to_string(), if size == 1 { items[0].clone() } else { Value::array(items.clone()) });
                }
            }
            if let Some(c) = collections {
                data.insert("collections".into(), c.clone());
            }
            data.insert("page".into(), base_page(Value::Undefined, Value::Undefined, date));

            // computed
            if let Some(Value::Obj(computed)) = tpl.data.get("computed").cloned() {
                for (key, value) in computed.iter() {
                    let v = render_computed(value, &data, engines, tpl).with_context(|| format!("computed.{}", key))?;
                    data.insert(key.clone(), v);
                }
            }
            // A computed `date` (from the URL, say) is the page's date.
            let date = match tpl.data.get("computed").map(|c| c.get("date")) {
                Some(c) if !c.is_nullish() => match data.get("date") {
                    Some(v) if !v.is_nullish() => v.to_date().ok_or_else(|| anyhow!("computed.date: can't parse date {:?}", v))?,
                    _ => date,
                },
                _ => date,
            };

            // permalink
            let page_index = chunk.as_ref().map(|(i, _)| *i).unwrap_or(0);
            let url = match data.get("permalink").cloned() {
                Some(Value::Bool(false)) => None,
                Some(Value::Str(s)) => {
                    let dynamic = !matches!(data.get("dynamicPermalink"), Some(Value::Bool(false)));
                    let rendered = if dynamic && (s.contains("{{") || s.contains("{%")) {
                        render_data_string(tpl, "permalink", &s, &data, engines)?
                    } else {
                        s.to_string()
                    };
                    Some(rendered.trim().to_string())
                }
                Some(v) if !v.is_nullish() => bail!("permalink must be a string or false"),
                // Non-HTML plain files (llms.txt) keep their own name.
                _ if !tpl.engines.is_empty() && tpl.engines.iter().all(|e| e == "txt") => Some(format!("/{}", tpl.rel)),
                _ => {
                    let stem = &tpl.file_path_stem;
                    let mut url = match stem.strip_suffix("/index") {
                        Some(dir) => format!("{}/", dir),
                        None if stem == "/index" => "/".into(),
                        None => format!("{}/", stem),
                    };
                    if url.is_empty() {
                        url = "/".into();
                    }
                    if page_index > 0 {
                        url = format!("{}{}/", url, page_index);
                    }
                    Some(url)
                }
            };
            let url = url.map(|u| if u.starts_with('/') { u } else { format!("/{}", u) });
            let output = url.as_ref().map(|u| {
                let rel = u.trim_start_matches('/');
                if u.ends_with('/') { ctx.output_dir.join(rel).join("index.html") } else { ctx.output_dir.join(rel) }
            });
            // `permalink: /about/index.html` writes that file; its URL is `/about/`.
            let url = url.map(|u| match u.strip_suffix("index.html") {
                Some(dir) if dir.ends_with('/') => dir.to_string(),
                _ => u,
            });
            if let Some(out) = &output {
                if !out.starts_with(&ctx.output_dir) || out.components().any(|c| c == std::path::Component::ParentDir) {
                    bail!("permalink {:?} points outside the output directory", url);
                }
            }
            data.insert(
                "page".into(),
                base_page(
                    url.clone().map(Value::from).unwrap_or(Value::Bool(false)),
                    output.as_ref().map(|o| Value::from(o.to_string_lossy().to_string())).unwrap_or(Value::Bool(false)),
                    date,
                ),
            );
            // Like js-yaml, front matter dates become real dates.
            if data.get("date").is_some_and(|d| !d.is_nullish()) {
                data.insert("date".into(), Value::Date(date));
            }
            data.shift_remove("collections");

            let excluded = data.get("excludeFromCollections").is_some_and(Value::truthy);
            let in_collections = !excluded && !tpl.plain_copy && (page_index == 0 || pagination.as_ref().is_some_and(|p| p.get("addAllPagesToCollections").truthy()));
            pages.push(Page { tpl: tpl.clone(), data: Arc::new(data), url, output, date, in_collections });
        }

        // Fill in pagination hrefs now that every page has a URL.
        if pagination.is_some() && !pages.is_empty() {
            let hrefs: Vec<Value> = pages.iter().map(|p| p.url.clone().map(Value::from).unwrap_or_default()).collect();
            let n = pages.len();
            for (i, page) in pages.iter_mut().enumerate() {
                let data = Arc::make_mut(&mut page.data);
                if let Some(Value::Obj(p)) = data.get_mut("pagination") {
                    let p = Arc::make_mut(p);
                    let prev = if i > 0 { hrefs[i - 1].clone() } else { Value::Undefined };
                    let next = if i + 1 < n { hrefs[i + 1].clone() } else { Value::Undefined };
                    p.insert("hrefs".into(), Value::array(hrefs.clone()));
                    p.insert(
                        "href".into(),
                        Value::from_pairs([("previous", prev.clone()), ("next", next.clone()), ("first", hrefs[0].clone()), ("last", hrefs[n - 1].clone())]),
                    );
                    p.insert("previousPageHref".into(), prev);
                    p.insert("nextPageHref".into(), next);
                    p.insert("firstPageHref".into(), hrefs[0].clone());
                    p.insert("lastPageHref".into(), hrefs[n - 1].clone());
                }
            }
        }
        Ok(pages)
    })()
    .with_context(|| format!("in {}", tpl.rel))
}

/// The items a pagination goes over: `source` as a list (an object's keys),
/// with `filter` and `reverse` applied.
fn pagination_items(p: &Value, path: &str, source: Value) -> Result<Vec<Value>> {
    let mut items: Vec<Value> = match source {
        Value::Arr(a) => a.to_vec(),
        Value::Obj(o) => o.keys().map(Value::str).collect(),
        v if v.is_nullish() => bail!("pagination data `{}` is undefined", path),
        other => bail!("pagination data `{}` is a {}, not a list", path, other.type_of()),
    };
    if let Some(Value::Arr(filter)) = p.as_object().and_then(|o| o.get("filter")) {
        items.retain(|i| !filter.iter().any(|f| f.strict_eq(i)));
    }
    if p.get("reverse").truthy() {
        items.reverse();
    }
    Ok(items)
}

/// Give a page paginated over a collection the items from the finished
/// collections, which have each page's `content`. The first pass only had
/// pages without it, enough to count the pages and work out URLs.
fn refresh_pagination(page: &mut Page, collections: &Value) -> Result<()> {
    let Some(p) = page.data.get("pagination").cloned() else { return Ok(()) };
    let path = p.get("data").as_str().unwrap_or_default().to_string();
    let Some(rest) = path.strip_prefix("collections.") else { return Ok(()) };
    let items = pagination_items(&p, &path, collections.get_path(rest))?;
    let size = p.get("size").as_f64().unwrap_or(1.0).max(1.0) as usize;
    let number = p.get("pageNumber").as_f64().unwrap_or(0.0) as usize;
    let chunk: Vec<Value> = items.chunks(size).nth(number).map(|c| c.to_vec()).unwrap_or_default();
    let all: Vec<Value> = items.chunks(size).map(|c| if size == 1 { c[0].clone() } else { Value::array(c.to_vec()) }).collect();
    let data = Arc::make_mut(&mut page.data);
    if let Some(Value::Obj(obj)) = data.get_mut("pagination") {
        let obj = Arc::make_mut(obj);
        obj.insert("items".into(), Value::array(chunk.clone()));
        obj.insert("pages".into(), Value::array(all));
    }
    if let (Some(alias), Some(first)) = (p.get("alias").as_str(), chunk.first()) {
        data.insert(alias.to_string(), if size == 1 { first.clone() } else { Value::array(chunk.clone()) });
    }
    Ok(())
}

/// The engines named by a template's `render` data: one name (`md`), a
/// comma-separated chain (`"liquid, md"`), a list (`[liquid, md]`), or `false`
/// to write the body as it is.
fn render_engines(v: &Value) -> Result<Vec<String>> {
    let names: Vec<String> = match v {
        Value::Bool(false) => return Ok(Vec::new()),
        Value::Str(_) => v.as_str().unwrap_or_default().split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        _ => match v.as_array() {
            Some(items) => items
                .iter()
                .map(|i| i.as_str().map(|s| s.trim().to_string()).ok_or_else(|| anyhow!("`render` list items must be engine names, not {}", i.type_of())))
                .collect::<Result<_>>()?,
            None => bail!("`render` must be an engine name (`md`), a list of names, or false, not {}", v.type_of()),
        },
    };
    if names.is_empty() {
        bail!("`render` is empty: name an engine (`md`), or use `render: false` to skip processing");
    }
    Ok(names)
}

/// Whether a template's body reads `collections`, so it must render after
/// every other page (whose `templateContent` it may show). Only template code
/// counts: `{{ ... }}` and `@directive` lines for Edge, `{{ }}` and `{% %}`
/// tags for other template languages. A post that merely mentions
/// "collections" in its text, or is only Markdown (`render: md`), renders in
/// the first pass so its content can appear in feeds.
fn uses_collections(tpl: &Tpl, includes: &HashSet<String>) -> bool {
    if tpl.body.contains("collections") && code_mentions(&tpl.body, &tpl.engines, "collections") {
        return true;
    }
    // An include, import or component that reads collections.
    !includes.is_empty() && quoted_names(&tpl.body).any(|name| includes.contains(&include_key(name)))
}

/// Whether `word` is in template code (not prose) for a template rendered by `engines`.
fn code_mentions(body: &str, engines: &[String], word: &str) -> bool {
    if engines.iter().any(|e| e == "edge") && edge_code_mentions(body, word) {
        return true;
    }
    // Other template languages (Liquid and the like) put code in `{{ }}` and
    // `{% %}`. Markdown and plain files have none.
    engines.iter().any(|e| !matches!(e.as_str(), "edge" | "md" | "html" | "txt")) && tag_code_mentions(body, word)
}

/// Quoted strings in a template, the names an `include`, `import`,
/// `@include` or `{{> partial}}` uses (and any other strings).
fn quoted_names(body: &str) -> impl Iterator<Item = &str> {
    static QUOTED: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r#"["']([\w./-]{1,200})["']|\{\{>\s*([\w./-]+)"#).unwrap());
    QUOTED.captures_iter(body).filter_map(|c| c.get(1).or(c.get(2)).map(|m| m.as_str()))
}

/// `partials/nav.njk` and `./partials/nav` are both `partials/nav`.
fn include_key(name: &str) -> String {
    let name = name.trim_start_matches("./");
    match name.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') && !stem.is_empty() => stem.to_string(),
        _ => name.to_string(),
    }
}

/// The files in `_includes` (as [`include_key`]s) whose code reads
/// `collections`, or that include one that does.
fn includes_using_collections(dir: &Path) -> HashSet<String> {
    let mut files: Vec<(String, String)> = Vec::new();
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
        let rel = slashes(entry.path().strip_prefix(dir).unwrap_or(entry.path()));
        files.push((include_key(&rel), text));
    }
    let mut using: HashSet<String> = HashSet::new();
    for (key, text) in &files {
        if text.contains("collections") && (edge_code_mentions(text, "collections") || tag_code_mentions(text, "collections")) {
            using.insert(key.clone());
        }
    }
    loop {
        let before = using.len();
        for (key, text) in &files {
            if !using.contains(key) && quoted_names(text).any(|n| using.contains(&include_key(n))) {
                using.insert(key.clone());
            }
        }
        if using.len() == before {
            return using;
        }
    }
}

/// Whether `word` appears inside a `{{ ... }}` or `{% ... %}` tag.
fn tag_code_mentions(body: &str, word: &str) -> bool {
    body.match_indices(word).any(|(pos, _)| {
        let before = &body[..pos];
        [("{{", "}}"), ("{%", "%}")].iter().any(|(open, close)| before.rfind(open).is_some_and(|o| !before[o..].contains(close)))
    })
}

fn edge_code_mentions(body: &str, word: &str) -> bool {
    for (pos, _) in body.match_indices(word) {
        let before = &body[..pos];
        // Inside an interpolation: the last `{{` comes after the last `}}`.
        if let Some(open) = before.rfind("{{") {
            if before[open..].find("}}").is_none() && !before[open..].starts_with("{{--") {
                return true;
            }
        }
        // On a directive line such as `@each(post in collections.posts)`.
        let line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
        if body[line_start..].trim_start().starts_with('@') {
            return true;
        }
    }
    false
}

/// `./dist/about/index.html` for a path inside the project, else the full
/// path. Always with `/`, on Windows too: it's what templates, globs and
/// JavaScript see (`page.inputPath`), and what the build log prints.
pub fn display_path(ctx: &BuildContext, path: &Path) -> String {
    match path.strip_prefix(&ctx.root) {
        Ok(rel) => format!("./{}", slashes(rel)),
        Err(_) => path.display().to_string(),
    }
}

/// A relative path with `/` separators, whatever the platform.
pub fn slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Render a `permalink` or `computed` string with the page's own template
/// language: the first engine in its chain that isn't Markdown or plain
/// text, or Edge for those.
fn render_data_string(tpl: &Tpl, what: &str, s: &str, data: &Map, engines: &Engines) -> Result<String> {
    let engine = tpl.engines.iter().map(String::as_str).find(|e| !matches!(*e, "md" | "html" | "txt")).unwrap_or("edge");
    let name = format!("{} ({})", tpl.rel, what);
    if engine == "edge" {
        return engines.edge.inner().render_str(&name, s, Value::object(data.clone()));
    }
    let ctx = RenderContext { name: &name, input_path: &tpl.input, cache_key: None };
    engines.get(engine)?.render(s, &Value::object(data.clone()), &ctx)
}

fn render_computed(value: &Value, data: &Map, engines: &Engines, tpl: &Tpl) -> Result<Value> {
    Ok(match value {
        Value::Str(s) if s.contains("{{") || s.contains("{%") => Value::from(render_data_string(tpl, "computed", s, data, engines)?),
        Value::Obj(o) => {
            let mut out = Map::new();
            for (k, v) in o.iter() {
                out.insert(k.clone(), render_computed(v, data, engines, tpl)?);
            }
            Value::object(out)
        }
        // A function (from a JavaScript data file) gets the page's data.
        Value::Func(f) => f.call(&[Value::object(data.clone())])?,
        other => other.clone(),
    })
}

fn check_conflicts(ctx: &BuildContext, pages: &[Page]) -> Result<()> {
    let mut seen: HashMap<&Path, &str> = HashMap::new();
    let mut errors = Vec::new();
    for p in pages {
        if let Some(out) = &p.output {
            if let Some(other) = seen.insert(out, &p.tpl.rel) {
                errors.push((format!("{} and {} both write to {}", other, p.tpl.rel, out.display()), p.tpl.input.clone()));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        let message = format!("output conflicts:\n  - {}", errors.iter().map(|(m, _)| m.as_str()).collect::<Vec<_>>().join("\n  - "));
        let items = errors.into_iter().map(|(m, input)| Diagnostic::error("conflict", m).file(display_path(ctx, &input))).collect();
        Err(Diagnostics { message, items }.into())
    }
}

/// Check every page's data against the schemas that cover it. Warnings are
/// printed; errors fail the build, listed together.
fn check_schemas(cfg: &Config, ctx: &BuildContext, pages: &[Page]) -> Result<()> {
    if cfg.schemas.is_empty() {
        return Ok(());
    }
    // A template that makes many pages reports each problem once.
    let found: Vec<Vec<Diagnostic>> = pages
        .par_iter()
        .map(|page| {
            let tags: Vec<&str> = page.data.get("tags").and_then(|t| t.as_array()).map(|a| a.iter().filter_map(|t| t.as_str()).collect()).unwrap_or_default();
            let files = crate::schema::PageFiles { input_dir: &ctx.input_dir, page_dir: page.tpl.input.parent().unwrap_or(&ctx.input_dir) };
            let file = display_path(ctx, &page.tpl.input);
            let mut out = Vec::new();
            for schema in cfg.schemas.iter().filter(|s| s.covers(&page.tpl.rel, &tags, page.in_collections)) {
                for problem in schema.check(&page.data, &page.tpl.front_keys, &files) {
                    let message = format!("{}: {} (schema `{}`)", file.trim_start_matches("./"), problem.message, schema.name);
                    let found = if problem.warning { Diagnostic::warning("schema", message) } else { Diagnostic::error("schema", message) };
                    out.push(found.file(file.as_str()).field(problem.field));
                }
            }
            out
        })
        .collect();
    let mut seen = HashSet::new();
    let mut items: Vec<Diagnostic> = Vec::new();
    for problem in found.into_iter().flatten() {
        if !seen.insert(problem.message.clone()) {
            continue;
        }
        match problem.severity {
            Severity::Warning => diagnostics::warn(problem),
            Severity::Error => items.push(problem),
        }
    }
    if items.is_empty() {
        return Ok(());
    }
    let count = items.len();
    let shown = if cfg.verbose { usize::MAX } else { 30 };
    let more = if count > shown { format!("\n  ... and {} more (--verbose lists them all)", count - shown) } else { String::new() };
    let listed: Vec<&str> = items.iter().take(shown).map(|d| d.message.as_str()).collect();
    let message = format!("{} content {}:\n  - {}{}", count, if count == 1 { "error" } else { "errors" }, listed.join("\n  - "), more);
    Err(Diagnostics { message, items }.into())
}

// --------------------------------------------------------------- collections

fn build_collections(cfg: &Config, pages: &[Page], contents: &HashMap<usize, Body>) -> Result<Value> {
    let mut members: Vec<usize> = (0..pages.len()).filter(|&i| pages[i].in_collections).collect();
    members.sort_by(|&a, &b| pages[a].date.cmp(&pages[b].date).then_with(|| pages[a].tpl.input.cmp(&pages[b].tpl.input)));

    let mut all = Vec::with_capacity(members.len());
    let mut by_tag: indexmap::IndexMap<String, Vec<Value>> = indexmap::IndexMap::new();
    for &i in &members {
        let p = &pages[i];
        let body = contents.get(&i);
        let content = body.map(|b| Value::from(b.html.as_str())).unwrap_or_default();
        let page = with_headings(p.data.get("page").cloned().unwrap_or_default(), body);
        let item = Value::from_pairs([
            ("url", p.url.clone().map(Value::from).unwrap_or(Value::Bool(false))),
            ("date", Value::Date(p.date)),
            ("inputPath", p.data.get("page").map(|pg| pg.get("inputPath")).unwrap_or_default()),
            ("fileSlug", Value::from(p.tpl.file_slug.as_str())),
            ("filePathStem", Value::from(p.tpl.file_path_stem.as_str())),
            ("outputPath", p.output.as_ref().map(|o| Value::from(o.to_string_lossy().to_string())).unwrap_or(Value::Bool(false))),
            ("page", page),
            ("data", Value::Obj(p.data.clone())),
            ("templateContent", content.clone()),
            ("content", content),
        ]);
        if let Some(Value::Arr(tags)) = p.data.get("tags") {
            for t in tags.iter() {
                by_tag.entry(t.to_js_string()).or_default().push(item.clone());
            }
        }
        all.push(item);
    }

    let mut map = Map::new();
    map.insert("all".into(), Value::array(all.clone()));
    for (tag, items) in by_tag {
        map.insert(tag, Value::array(items));
    }
    let api = CollectionApi { items: all };
    for (name, f) in &cfg.collections {
        map.insert(name.clone(), f(&api).with_context(|| format!("collection `{}` failed", name))?);
    }
    Ok(Value::object(map))
}

// -------------------------------------------------------------------- render

fn with_collections(page: &Page, collections: Option<&Value>) -> Map {
    let mut data = (*page.data).clone();
    if let Some(c) = collections {
        data.insert("collections".into(), c.clone());
    }
    data
}

/// A page's rendered content, and the headings in it (`page.headings`).
#[derive(Clone, Default)]
struct Body {
    html: String,
    headings: Value,
    excerpt: Value,
}

fn render_body(page: &Page, engines: &Engines, collections: Option<&Value>) -> Result<Body> {
    let data = Value::object(with_collections(page, collections));
    let mut content = page.tpl.body.clone();
    for name in &page.tpl.engines {
        let ctx = RenderContext { name: &page.tpl.rel, input_path: &page.tpl.input, cache_key: Some(&page.tpl.rel) };
        content = engines.get(name)?.render(&content, &data, &ctx).with_context(|| format!("rendering {} with `{}`", page.tpl.rel, name))?;
    }
    let headings = Value::array(crate::markdown::headings(&content).iter().map(|h| h.to_value()).collect());
    let excerpt = excerpt(&content).map(Value::from).unwrap_or_default();
    Ok(Body { html: content, headings, excerpt })
}

/// The HTML before a `<!-- more -->` comment, or else the first paragraph.
fn excerpt(html: &str) -> Option<String> {
    static MORE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"<!--\s*more\s*-->").unwrap());
    static PARAGRAPH: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?is)<p(?:\s[^>]*)?>.*?</p>").unwrap());
    if let Some(m) = MORE.find(html) {
        return Some(html[..m.start()].trim().to_string());
    }
    PARAGRAPH.find(html).map(|m| m.as_str().to_string())
}

/// `page` with `headings` from the rendered body.
fn with_headings(page: Value, body: Option<&Body>) -> Value {
    match (page, body) {
        (Value::Obj(map), Some(body)) => {
            let mut map = (*map).clone();
            map.insert("headings".into(), body.headings.clone());
            map.insert("excerpt".into(), body.excerpt.clone());
            Value::object(map)
        }
        (page, _) => page,
    }
}

fn render_layouts(page: &Page, body: Body, engines: &Engines, collections: &Value) -> Result<String> {
    if page.tpl.layouts.is_empty() {
        return Ok(body.html);
    }
    let mut data = with_collections(page, Some(collections));
    if let Some(p) = data.get("page").cloned() {
        data.insert("page".into(), with_headings(p, Some(&body)));
    }
    let mut content = body.html;
    for layout in &page.tpl.layouts {
        data.insert("content".into(), Value::from(content));
        let value = Value::object(data.clone());
        let mut text = layout.body.clone();
        for name in &layout.engines {
            let key = format!("{}#{}", layout.name, name);
            let ctx = RenderContext { name: &layout.name, input_path: &page.tpl.input, cache_key: Some(&key) };
            text = engines.get(name)?.render(&text, &value, &ctx).with_context(|| format!("rendering layout {} for {}", layout.name, page.tpl.rel))?;
        }
        content = text;
    }
    Ok(content)
}

// --------------------------------------------------------------- passthrough

/// The files a passthrough glob matches (relative to the project root), and
/// where each goes: under `to` by its path below the glob's fixed prefix, or
/// by its own path, like a plain passthrough path.
fn glob_jobs(ctx: &BuildContext, glob: &Path, to: Option<&Path>) -> Result<Vec<(PathBuf, PathBuf)>> {
    let pattern = slashes(glob);
    let pattern = pattern.trim_start_matches("./");
    let set = glob_set("passthrough", [pattern])?;
    let base: PathBuf = pattern.split('/').take_while(|part| !part.contains(['*', '?', '[', '{'])).collect();
    let mut jobs = Vec::new();
    for entry in walkdir::WalkDir::new(ctx.root.join(&base)).follow_links(true) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() || entry.file_name() == ".DS_Store" {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(&ctx.root).unwrap_or(path);
        if !set.is_match(slashes(rel)) {
            continue;
        }
        let dest = match to {
            Some(to) => ctx.output_dir.join(to).join(rel.strip_prefix(&base).unwrap_or(rel)),
            None => ctx.output_dir.join(path.strip_prefix(&ctx.input_dir).unwrap_or(rel)),
        };
        jobs.push((path.to_path_buf(), dest));
    }
    if jobs.is_empty() && !ctx.serving {
        diagnostics::warn(Diagnostic::warning("passthrough", format!("passthrough glob {:?} matches no files", pattern)));
    }
    Ok(jobs)
}

/// Page bundles: the files next to an `index` page (outside the input
/// folder's root) that aren't templates or data, copied next to its output.
/// Subfolders with templates of their own are left out.
fn bundle_files(cfg: &Config, ctx: &BuildContext, pages: &[Page], templates: &[PathBuf]) -> Result<Vec<(PathBuf, PathBuf)>> {
    let templates: HashSet<&Path> = templates.iter().map(PathBuf::as_path).collect();
    // Template files left out by `ignore` (or not rendered) aren't bundle files either.
    let ignore = glob_set("ignore", cfg.ignore.iter().map(String::as_str))?;
    let mut formats: HashSet<String> = cfg.template_formats.iter().map(|f| f.to_ascii_lowercase()).collect();
    formats.insert("markdown".into());
    let mut seen: HashSet<&Path> = HashSet::new();
    let mut jobs = Vec::new();
    for page in pages {
        let (Some(out), Some(dir)) = (&page.output, page.tpl.input.parent()) else { continue };
        if page.tpl.input.file_stem().is_none_or(|s| s != "index") || dir == root_of(ctx, &page.tpl.input) || !seen.insert(&page.tpl.input) {
            continue;
        }
        let Some(out_dir) = out.parent() else { continue };
        let dir_name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let walker = walkdir::WalkDir::new(dir).into_iter().filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.depth() > 0 && (name.starts_with('.') || name == "node_modules") {
                return false;
            }
            // A subfolder with its own templates is its own section.
            !(e.depth() > 0 && e.file_type().is_dir() && templates.iter().any(|t| t.starts_with(e.path())))
        });
        for entry in walker.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy();
            // Directory data (`my-post/my-post.json`) and the page's own data file (`index.json`).
            let is_data = entry.depth() == 1 && ["json", "yaml", "yml", "toml"].iter().any(|ext| *name == format!("{}.{}", dir_name, ext) || *name == format!("index.{}", ext));
            let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            let ignored = ignore.is_match(slashes(path.strip_prefix(&ctx.input_dir).unwrap_or(path)));
            if !entry.file_type().is_file() || templates.contains(path) || is_data_file(&name) || is_data || ignored || formats.contains(&ext) {
                continue;
            }
            jobs.push((path.to_path_buf(), out_dir.join(path.strip_prefix(dir).unwrap())));
        }
    }
    Ok(jobs)
}

/// When each file in the git repository last changed in a commit, from one
/// `git log`. Files with uncommitted changes are left out (they use their
/// modification time). Not a repository, or no git: nothing, with a warning.
fn git_dates(cfg: &Config, ctx: &BuildContext) -> HashMap<PathBuf, DateTime<Utc>> {
    let git = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(&ctx.root).args(["-c", "core.quotepath=off"]).args(args).output();
    let warn = |msg: &str| {
        if !cfg.quiet {
            diagnostics::warn(Diagnostic::warning("last-modified", format!("lastModified: {}", msg)));
        }
    };
    let top = match git(&["rev-parse", "--show-toplevel"]) {
        Ok(out) if out.status.success() => PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()),
        Ok(_) => {
            warn("not a git repository, so pages use their files' times");
            return HashMap::new();
        }
        Err(e) => {
            warn(&format!("can't run git ({}), so pages use their files' times", e));
            return HashMap::new();
        }
    };
    let top = dunce::canonicalize(&top).unwrap_or(top);
    if git(&["rev-parse", "--is-shallow-repository"]).is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "true") {
        warn("this is a shallow clone, so dates come from the commits it has (fetch the full history, like `fetch-depth: 0` in GitHub Actions)");
    }
    let mut dates = HashMap::new();
    let Ok(out) = git(&["log", "--format=@%ct", "--name-only", "--no-merges", "--", "."]) else { return dates };
    let mut current: Option<DateTime<Utc>> = None;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Some(ts) = line.strip_prefix('@') {
            current = ts.trim().parse::<i64>().ok().and_then(|t| DateTime::<Utc>::from_timestamp(t, 0));
        } else if let (false, Some(date)) = (line.trim().is_empty(), current) {
            dates.entry(top.join(line.trim())).or_insert(date);
        }
    }
    if let Ok(out) = git(&["status", "--porcelain", "--", "."]) {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(path) = line.get(3..) {
                let path = path.rsplit(" -> ").next().unwrap_or(path);
                dates.remove(&top.join(path));
            }
        }
    }
    // Templates are found through the input folder's real path.
    dates.into_iter().map(|(p, d)| (dunce::canonicalize(&p).unwrap_or(p), d)).collect()
}

/// Run the file builders ([`Config::add_file_builder`]) and write their
/// files, unless a file is already up to date.
fn run_file_builders(cfg: &Config, ctx: &BuildContext) -> Result<Vec<PathBuf>> {
    let mut owners: HashMap<PathBuf, &str> = HashMap::new();
    let mut out = Vec::new();
    for (name, builder) in &cfg.file_builders {
        for file in builder(ctx).with_context(|| format!("{} failed", name))? {
            let rel = file.path.trim_start_matches('/');
            if !file.path.starts_with('/') || rel.is_empty() || rel.ends_with('/') || rel.split('/').any(|p| p == "..") {
                bail!("{}: {:?} must be a URL path to a file in the output, starting with /", name, file.path);
            }
            let path = ctx.output_dir.join(rel);
            if let Some(other) = owners.insert(path.clone(), name) {
                bail!("{} and {} both write {}", other, name, display_path(ctx, &path));
            }
            if std::fs::read_to_string(&path).ok().as_deref() != Some(file.contents.as_str()) {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&path, &file.contents).with_context(|| format!("writing {}", path.display()))?;
            }
            out.push(path);
        }
    }
    Ok(out)
}

/// Run the generators ([`Config::add_generator`]) over the written pages and
/// write their files. Returns the paths written (not counting appends to a
/// page's own file).
fn run_generators(cfg: &Config, ctx: &BuildContext, pages: &[Page], written: &[(PathBuf, u64)], markdown: &MarkdownEngine, global: &Map) -> Result<Vec<PathBuf>> {
    if cfg.generators.is_empty() {
        return Ok(Vec::new());
    }
    let summaries: Vec<crate::PageSummary> = pages
        .iter()
        .filter_map(|p| {
            Some(crate::PageSummary { url: p.url.clone()?, output_path: p.output.clone()?, input_path: p.tpl.input.clone(), date: p.date, data: Value::Obj(p.data.clone()) })
        })
        .collect();
    let page_outputs: HashSet<&Path> = written.iter().map(|(p, _)| p.as_path()).collect();
    let mut owners: HashMap<PathBuf, String> = HashMap::new();
    let mut out = Vec::new();
    let mut global_data: Option<Value> = None;
    for (name, generator) in &cfg.generators {
        for file in generator(ctx, &summaries).with_context(|| format!("{} failed", name))? {
            let rel = file.path.trim_start_matches('/');
            if !file.path.starts_with('/') || rel.split('/').any(|p| p == "..") {
                bail!("{}: {:?} must be a URL path in the output, starting with /", name, file.path);
            }
            let path = if rel.is_empty() || rel.ends_with('/') { ctx.output_dir.join(rel).join("index.html") } else { ctx.output_dir.join(rel) };
            let is_page = page_outputs.contains(path.as_path());
            if !file.append {
                if is_page {
                    bail!("{} and a page both write {}", name, display_path(ctx, &path));
                }
                if let Some(other) = owners.get(&path) {
                    bail!("{} and {} both write {}", other, name, display_path(ctx, &path));
                }
            }
            let mut contents = file.contents;
            // The site's own template for this kind of file, if it has one.
            if let Some((hook, value)) = file.hook {
                let data = global_data.get_or_insert_with(|| Value::object(global.clone()));
                if let Some(rendered) = markdown.render_hook(&hook, value, data) {
                    contents = rendered.with_context(|| format!("{}: writing {}", name, file.path))?;
                }
            }
            if file.append && (is_page || owners.contains_key(&path)) {
                let mut existing = std::fs::read_to_string(&path).unwrap_or_default();
                if !existing.is_empty() && !existing.ends_with('\n') {
                    existing.push('\n');
                }
                contents = existing + &contents;
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if std::fs::read_to_string(&path).ok().as_deref() != Some(contents.as_str()) {
                std::fs::write(&path, &contents).with_context(|| format!("writing {}", path.display()))?;
            }
            if !is_page && owners.insert(path.clone(), name.clone()).is_none() {
                out.push(path);
            }
        }
    }
    Ok(out)
}

struct CopyStats {
    copied: usize,
    unchanged: usize,
    bytes: u64,
    /// Every destination, copied or not.
    paths: Vec<PathBuf>,
}

fn passthrough_copy(cfg: &Config, ctx: &BuildContext, extra: Vec<(PathBuf, PathBuf)>) -> Result<CopyStats> {
    let mut jobs: Vec<(PathBuf, PathBuf)> = extra;
    for (from, to) in &cfg.passthrough {
        if is_glob(from) {
            jobs.extend(glob_jobs(ctx, from, to.as_deref())?);
            continue;
        }
        let src = ctx.root.join(from);
        let src = dunce::canonicalize(&src).with_context(|| format!("passthrough source {} does not exist", src.display()))?;
        let dest = match to {
            Some(to) => ctx.output_dir.join(to),
            None => ctx.output_dir.join(src.strip_prefix(&ctx.input_dir).or_else(|_| src.strip_prefix(&ctx.root)).unwrap_or(&src)),
        };
        if src.is_dir() {
            for entry in walkdir::WalkDir::new(&src) {
                let entry = entry?;
                if entry.file_type().is_file() && entry.file_name() != ".DS_Store" {
                    let rel = entry.path().strip_prefix(&src).unwrap();
                    jobs.push((entry.path().to_path_buf(), dest.join(rel)));
                }
            }
        } else {
            jobs.push((src, dest));
        }
    }
    // (copied?, size) per file.
    let results: Vec<(bool, u64)> = collect_errors(
        jobs.par_iter()
            .map(|(src, dest)| {
                let meta = std::fs::metadata(src)?;
                if let Ok(existing) = std::fs::metadata(dest) {
                    let fresh = existing.len() == meta.len() && existing.modified().ok() >= meta.modified().ok();
                    if fresh {
                        return Ok((false, meta.len()));
                    }
                }
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(src, dest).with_context(|| format!("copying {} to {}", src.display(), dest.display()))?;
                Ok((true, meta.len()))
            })
            .collect(),
    )?;
    let copied = results.iter().filter(|(c, _)| *c).count();
    Ok(CopyStats { copied, unchanged: results.len() - copied, bytes: results.iter().map(|(_, n)| n).sum(), paths: jobs.into_iter().map(|(_, dest)| dest).collect() })
}

#[cfg(test)]
mod tests {
    use super::edge_code_mentions;

    #[test]
    fn collections_in_prose_is_not_code() {
        let code = [
            "{{ collections.posts.length }}",
            "{{{ collections.all[0].templateContent }}}",
            "<ul>\n  @each(post in collections.posts)\n  <li>{{ post.url }}</li>\n  @end\n</ul>",
            "{{ adjacentPosts(\n  collections.posts, page.url) }}",
        ];
        for body in code {
            assert!(edge_code_mentions(body, "collections"), "{:?}", body);
        }
        let prose = [
            "I have mugs, hats, toys and other collections.",
            "Collections in ssqch are {{ \"great\" }}, and so are collections.",
            "{{-- collections are rendered later --}}",
            "Use `collections.posts` in a template.",
        ];
        for body in prose {
            assert!(!edge_code_mentions(body, "collections"), "{:?}", body);
        }
    }
}
