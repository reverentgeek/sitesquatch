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
use crate::engines::{EdgeEngine, EngineEnv, Engines, MarkdownEngine, PlainEngine, RenderContext, TemplateEngine};
use crate::{Map, Value};

struct Layout {
    name: String,
    ext: String,
    body: String,
    data: Map,
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
    /// Plain text with no front matter: copied as-is and kept out of collections.
    plain_copy: bool,
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

    for hook in &cfg.before_build {
        hook(&ctx).context("before_build hook failed")?;
    }

    // ---- engines
    let mut globals = Map::new();
    for (name, f) in &cfg.filters {
        globals.insert(name.clone(), f.clone());
    }
    let env = EngineEnv { includes_dir: ctx.includes_dir.clone(), globals, build: ctx.clone() };
    let edge = Arc::new(EdgeEngine::new(&env));
    let mut by_name: HashMap<String, Arc<dyn TemplateEngine>> = HashMap::new();
    by_name.insert("edge".into(), edge.clone());
    by_name.insert("md".into(), Arc::new(MarkdownEngine::default()));
    by_name.insert("html".into(), Arc::new(PlainEngine));
    by_name.insert("txt".into(), Arc::new(PlainEngine));
    for (ext, factory) in &cfg.engines {
        by_name.insert(ext.clone(), factory(&env).with_context(|| format!("setting up the `{}` engine", ext))?);
    }
    let engines = Engines { edge, by_name };
    for f in &cfg.template_formats {
        engines.get(f).context("check `template_formats`")?;
    }

    timer.lap("setup");

    // ---- global data
    let (mut global, skipped) = data::load_global_data(&ctx.data_dir, &cfg.data_extensions)?;
    let provided: Vec<(String, Result<Value>)> = cfg
        .global_data
        .par_iter()
        .map(|(name, f)| (name.clone(), f(&ctx).with_context(|| format!("global data `{}` failed", name))))
        .collect();
    for (name, value) in provided {
        global.insert(name, value?);
    }
    for file in skipped {
        let stem = file.rsplit('/').next().unwrap_or(&file).split('.').next().unwrap_or("");
        if !global.contains_key(stem) && !cfg.quiet {
            eprintln!("warn: skipped _data/{} (no loader for that format; provide `{}` with Config::add_global_data)", file, stem);
        }
    }
    let version = env!("CARGO_PKG_VERSION");
    let runtime = Value::from_pairs([
        ("version", Value::from(version)),
        ("generator", Value::from(format!("SiteSquatch v{}", version))),
        ("env", Value::from(ctx.env.as_str())),
        ("serving", Value::Bool(ctx.serving)),
    ]);
    global.insert("ssqch".into(), runtime);
    timer.lap("data");

    // ---- templates
    let files = discover(cfg, &ctx)?;
    let dir_data = load_directory_data(cfg, &ctx, &files)?;
    let layouts: Mutex<HashMap<String, Arc<Layout>>> = Mutex::new(HashMap::new());
    let tpls: Vec<Arc<Tpl>> = collect_errors(
        files.par_iter().map(|path| load_template(cfg, &ctx, path, &global, &dir_data, &layouts).map(Arc::new)).collect(),
    )?;
    timer.lap("read");

    // ---- pagination, computed data and permalinks
    let (deferred, immediate): (Vec<_>, Vec<_>) = tpls.iter().partition(|t| {
        t.data.get("pagination").map(|p| p.get("data")).and_then(|d| d.as_str().map(|s| s.starts_with("collections"))).unwrap_or(false)
    });
    let mut pages: Vec<Page> = collect_errors(immediate.par_iter().map(|t| expand(&ctx, t, None, &engines)).collect())?
        .into_iter()
        .flatten()
        .collect();
    if !deferred.is_empty() {
        let shallow = build_collections(cfg, &pages, &HashMap::new())?;
        let more: Vec<Page> = collect_errors(deferred.par_iter().map(|t| expand(&ctx, t, Some(&shallow), &engines)).collect())?
            .into_iter()
            .flatten()
            .collect();
        pages.extend(more);
    }
    check_conflicts(&pages)?;
    timer.lap("paginate");

    // ---- render bodies
    let (early, late): (Vec<usize>, Vec<usize>) =
        (0..pages.len()).filter(|&i| pages[i].output.is_some() || pages[i].in_collections).partition(|&i| !uses_collections(&pages[i].tpl));
    let mut contents: HashMap<usize, String> = collect_errors(
        early.par_iter().map(|&i| render_body(&pages[i], &engines, None).map(|c| (i, c))).collect(),
    )?
    .into_iter()
    .collect();
    let collections = build_collections(cfg, &pages, &contents)?;
    let late_contents: Vec<(usize, String)> =
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
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(out, &html).with_context(|| format!("writing {}", out.display()))?;
                if !cfg.quiet {
                    println!("[ssqch] Writing {} from {} ({})", display_path(&ctx, out), display_path(&ctx, &page.tpl.input), page.tpl.engines.join(", "));
                }
                Ok((out.clone(), html.len() as u64))
            }))
            .collect(),
    )?;
    timer.lap("write");

    let copy = passthrough_copy(cfg, &ctx)?;
    timer.lap("copy");

    let outputs: Vec<&PathBuf> = written.iter().map(|(p, _)| p).chain(&copy.paths).collect();
    let files_removed = record_outputs(cfg, &ctx, &outputs)?;

    let mut report = BuildReport {
        templates: tpls.len(),
        pages_written: written.len(),
        page_bytes: written.iter().map(|(_, n)| n).sum(),
        files_copied: copy.copied,
        files_unchanged: copy.unchanged,
        passthrough_bytes: copy.bytes,
        files_removed,
        written: written.into_iter().map(|(p, _)| p).collect(),
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
    for r in results {
        match r {
            Ok(v) => ok.push(v),
            Err(e) => errors.push(format!("{:#}", e)),
        }
    }
    if errors.is_empty() {
        return Ok(ok);
    }
    let count = errors.len();
    errors.truncate(10);
    Err(anyhow!("{} error(s):\n  - {}{}", count, errors.join("\n  - "), if count > 10 { "\n  ..." } else { "" }))
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
            println!("[ssqch] Removed {}", display_path(ctx, &path));
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
    let list = serde_json::json!({ "output": output_name, "files": current });
    std::fs::write(&list_path, serde_json::to_string_pretty(&list)?).with_context(|| format!("writing {}", list_path.display()))?;
    Ok(removed)
}

// ------------------------------------------------------------------ discover

fn discover(cfg: &Config, ctx: &BuildContext) -> Result<Vec<PathBuf>> {
    let formats: HashSet<String> = cfg.template_formats.iter().map(|f| f.to_ascii_lowercase()).collect();
    let skip_dirs: Vec<PathBuf> = [ctx.includes_dir.clone(), ctx.data_dir.clone(), ctx.output_dir.clone()]
        .into_iter()
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
        if formats.contains(&ext) {
            files.push(entry.into_path());
        }
    }
    files.sort();
    Ok(files)
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
        let mut dir = f.parent();
        while let Some(d) = dir {
            if !d.starts_with(&ctx.input_dir) {
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
    let direct = ctx.includes_dir.join(name);
    let path = if direct.is_file() {
        direct
    } else {
        cfg.template_formats
            .iter()
            .map(|ext| ctx.includes_dir.join(format!("{}.{}", name, ext)))
            .find(|p| p.is_file())
            .ok_or_else(|| anyhow!("layout `{}` not found in {}", name, ctx.includes_dir.display()))?
    };
    let src = std::fs::read_to_string(&path)?;
    let (data, body) = data::parse_front_matter(&src).with_context(|| format!("in layout {}", path.display()))?;
    let layout = Arc::new(Layout {
        name: format!("{}/{}", cfg.includes.display(), name),
        ext: path.extension().unwrap().to_string_lossy().to_string(),
        body: body.to_string(),
        data,
    });
    cache.lock().unwrap().insert(name.to_string(), layout.clone());
    Ok(layout)
}

fn load_template(
    cfg: &Config,
    ctx: &BuildContext,
    path: &Path,
    global: &Map,
    dir_data: &HashMap<PathBuf, Map>,
    layouts: &Mutex<HashMap<String, Arc<Layout>>>,
) -> Result<Tpl> {
    let rel_path = path.strip_prefix(&ctx.input_dir).unwrap_or(path);
    let rel = rel_path.to_string_lossy().replace('\\', "/");
    (|| {
        let src = std::fs::read_to_string(path)?;
        let (front, body) = data::parse_front_matter(&src)?;
        let has_front_matter = body.len() != src.len();

        // Template-level data: directory data (outermost first), then the
        // template's own data file, then front matter.
        let mut own = Map::new();
        let mut dirs: Vec<&Path> = path.ancestors().skip(1).take_while(|d| d.starts_with(&ctx.input_dir)).collect();
        dirs.reverse();
        for d in dirs {
            if let Some(data) = dir_data.get(d) {
                merge(&mut own, data, cfg.data_deep_merge);
            }
        }
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let suffixes = ["json".to_string(), "data.json".to_string()].into_iter().chain(cfg.data_extensions.iter().map(|(ext, _)| format!("data.{}", ext)));
        for suffix in suffixes {
            let candidate = path.with_file_name(format!("{}.{}", stem, suffix));
            if candidate.is_file() {
                if let Some(Value::Obj(o)) = data::load_data_file(&candidate, &cfg.data_extensions)? {
                    merge(&mut own, &o, cfg.data_deep_merge);
                }
            }
        }
        let mut front = front;
        normalize_tags(&mut front);
        merge(&mut own, &front, cfg.data_deep_merge);

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
        for layout in chain.iter().rev() {
            merge(&mut data, &layout.data, cfg.data_deep_merge);
        }
        merge(&mut data, &own, cfg.data_deep_merge);
        normalize_tags(&mut data);

        let ext = path.extension().unwrap().to_string_lossy().to_ascii_lowercase();
        if data.contains_key("templateEngineOverride") {
            bail!("front matter `templateEngineOverride` is now `render` (for example `render: md`)");
        }
        let engines: Vec<String> = match data.get("render").filter(|v| !v.is_nullish()) {
            Some(v) => render_engines(v)?,
            None => {
                let pre = match ext.as_str() {
                    "md" => cfg.markdown_engine.clone(),
                    "html" => cfg.html_engine.clone(),
                    _ => None,
                };
                pre.into_iter().chain(std::iter::once(ext.clone())).collect()
            }
        };

        let mut file_slug = stem.clone();
        if file_slug == "index" {
            file_slug = rel_path.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        }
        let date_prefix = Regex::new(r"^\d{4}-\d{2}-\d{2}-").unwrap();
        let file_slug = date_prefix.replace(&file_slug, "").to_string();
        let parent = rel_path.parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let file_path_stem = if parent.is_empty() { format!("/{}", stem) } else { format!("/{}/{}", parent, stem) };
        let mtime = std::fs::metadata(path)?.modified().unwrap_or(SystemTime::now());

        let plain_copy = !has_front_matter && engines.iter().all(|e| e == "txt");
        Ok(Tpl {
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
            _ => tpl.mtime,
        };
        let base_page = |url: Value, output: Value| {
            Value::from_pairs([
                ("url", url),
                ("outputPath", output),
                ("inputPath", Value::from(input_path.as_str())),
                ("fileSlug", Value::from(tpl.file_slug.as_str())),
                ("filePathStem", Value::from(tpl.file_path_stem.as_str())),
                ("date", Value::Date(date)),
            ])
        };

        let pagination = tpl.data.get("pagination").filter(|p| p.as_object().is_some()).cloned();
        let mut chunks: Vec<Option<(usize, Vec<Value>)>> = vec![None];
        let mut size = 1;
        if let Some(p) = &pagination {
            let path = p.get("data").as_str().ok_or_else(|| anyhow!("pagination.data must be a string"))?.to_string();
            let source = match (path.strip_prefix("collections."), collections) {
                (Some(rest), Some(c)) => c.get_path(rest),
                _ => Value::object(tpl.data.clone()).get_path(&path),
            };
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
            data.insert("page".into(), base_page(Value::Undefined, Value::Undefined));

            // computed
            if let Some(Value::Obj(computed)) = tpl.data.get("computed").cloned() {
                for (key, value) in computed.iter() {
                    let v = render_computed(value, &data, engines, &tpl.rel).with_context(|| format!("computed.{}", key))?;
                    data.insert(key.clone(), v);
                }
            }

            // permalink
            let page_index = chunk.as_ref().map(|(i, _)| *i).unwrap_or(0);
            let url = match data.get("permalink").cloned() {
                Some(Value::Bool(false)) => None,
                Some(Value::Str(s)) => {
                    let dynamic = !matches!(data.get("dynamicPermalink"), Some(Value::Bool(false)));
                    let rendered = if dynamic && s.contains("{{") {
                        engines.edge.inner().render_str(&format!("{} (permalink)", tpl.rel), &s, Value::object(data.clone()))?
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
/// every other page (whose `templateContent` it may show). Only Edge code
/// counts: `{{ ... }}` and `@directive` lines. A post that merely mentions
/// "collections" in its text, or isn't processed by Edge at all
/// (`render: md`), renders in the first pass so its content
/// can appear in feeds.
fn uses_collections(tpl: &Tpl) -> bool {
    if !tpl.engines.iter().any(|e| e == "edge") || !tpl.body.contains("collections") {
        return false;
    }
    edge_code_mentions(&tpl.body, "collections")
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

fn render_computed(value: &Value, data: &Map, engines: &Engines, name: &str) -> Result<Value> {
    Ok(match value {
        Value::Str(s) if s.contains("{{") => {
            Value::from(engines.edge.inner().render_str(&format!("{} (computed)", name), s, Value::object(data.clone()))?)
        }
        Value::Obj(o) => {
            let mut out = Map::new();
            for (k, v) in o.iter() {
                out.insert(k.clone(), render_computed(v, data, engines, name)?);
            }
            Value::object(out)
        }
        // A function (from a JavaScript data file) gets the page's data.
        Value::Func(f) => f.call(&[Value::object(data.clone())])?,
        other => other.clone(),
    })
}

fn check_conflicts(pages: &[Page]) -> Result<()> {
    let mut seen: HashMap<&Path, &str> = HashMap::new();
    let mut errors = Vec::new();
    for p in pages {
        if let Some(out) = &p.output {
            if let Some(other) = seen.insert(out, &p.tpl.rel) {
                errors.push(format!("{} and {} both write to {}", other, p.tpl.rel, out.display()));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        bail!("output conflicts:\n  - {}", errors.join("\n  - "))
    }
}

// --------------------------------------------------------------- collections

fn build_collections(cfg: &Config, pages: &[Page], contents: &HashMap<usize, String>) -> Result<Value> {
    let mut members: Vec<usize> = (0..pages.len()).filter(|&i| pages[i].in_collections).collect();
    members.sort_by(|&a, &b| pages[a].date.cmp(&pages[b].date).then_with(|| pages[a].tpl.input.cmp(&pages[b].tpl.input)));

    let mut all = Vec::with_capacity(members.len());
    let mut by_tag: indexmap::IndexMap<String, Vec<Value>> = indexmap::IndexMap::new();
    for &i in &members {
        let p = &pages[i];
        let content = contents.get(&i).map(|c| Value::from(c.as_str())).unwrap_or_default();
        let item = Value::from_pairs([
            ("url", p.url.clone().map(Value::from).unwrap_or(Value::Bool(false))),
            ("date", Value::Date(p.date)),
            ("inputPath", p.data.get("page").map(|pg| pg.get("inputPath")).unwrap_or_default()),
            ("fileSlug", Value::from(p.tpl.file_slug.as_str())),
            ("filePathStem", Value::from(p.tpl.file_path_stem.as_str())),
            ("outputPath", p.output.as_ref().map(|o| Value::from(o.to_string_lossy().to_string())).unwrap_or(Value::Bool(false))),
            ("page", p.data.get("page").cloned().unwrap_or_default()),
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

fn render_body(page: &Page, engines: &Engines, collections: Option<&Value>) -> Result<String> {
    let data = Value::object(with_collections(page, collections));
    let mut content = page.tpl.body.clone();
    for name in &page.tpl.engines {
        let ctx = RenderContext { name: &page.tpl.rel, input_path: &page.tpl.input, cache_key: Some(&page.tpl.rel) };
        content = engines.get(name)?.render(&content, &data, &ctx).with_context(|| format!("rendering {} with `{}`", page.tpl.rel, name))?;
    }
    Ok(content)
}

fn render_layouts(page: &Page, body: String, engines: &Engines, collections: &Value) -> Result<String> {
    if page.tpl.layouts.is_empty() {
        return Ok(body);
    }
    let mut data = with_collections(page, Some(collections));
    let mut content = body;
    for layout in &page.tpl.layouts {
        data.insert("content".into(), Value::from(content));
        let ctx = RenderContext { name: &layout.name, input_path: &page.tpl.input, cache_key: Some(&layout.name) };
        content = engines
            .get(&layout.ext)?
            .render(&layout.body, &Value::object(data.clone()), &ctx)
            .with_context(|| format!("rendering layout {} for {}", layout.name, page.tpl.rel))?;
    }
    Ok(content)
}

// --------------------------------------------------------------- passthrough

struct CopyStats {
    copied: usize,
    unchanged: usize,
    bytes: u64,
    /// Every destination, copied or not.
    paths: Vec<PathBuf>,
}

fn passthrough_copy(cfg: &Config, ctx: &BuildContext) -> Result<CopyStats> {
    let mut jobs: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (from, to) in &cfg.passthrough {
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
