//! Site configuration and the plugin registration API.
//!
//! Plugins (and your own site code) call `add_filter`, `add_collection`,
//! `add_transform`, ... on a [`Config`] before the build starts.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;

use crate::data::DataLoader;
use crate::engines::{EngineEnv, TemplateEngine};
use crate::markdown::MarkdownOptions;
use crate::Value;

/// A plugin bundles configuration: filters, data, collections, transforms,
/// engines and build hooks. Fallible work belongs in hooks or callbacks.
pub trait Plugin {
    fn name(&self) -> &str;
    fn register(&self, config: &mut Config);
}

/// Any `Fn(&mut Config)` is a plugin too, handy for small site-specific bits.
impl<F: Fn(&mut Config)> Plugin for F {
    fn name(&self) -> &str {
        "anonymous"
    }
    fn register(&self, config: &mut Config) {
        self(config)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Environment {
    Development,
    Production,
}

impl Environment {
    pub fn as_str(&self) -> &'static str {
        match self {
            Environment::Development => "development",
            Environment::Production => "production",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "dev" | "development" => Some(Environment::Development),
            "prod" | "production" => Some(Environment::Production),
            _ => None,
        }
    }
}

/// Absolute paths and settings for the current build, handed to data
/// providers, hooks and transforms.
#[derive(Clone, Debug)]
pub struct BuildContext {
    pub root: PathBuf,
    pub input_dir: PathBuf,
    pub output_dir: PathBuf,
    pub includes_dir: PathBuf,
    /// Layouts: `includes_dir` unless `dirs.layouts` names another folder.
    pub layouts_dir: PathBuf,
    pub data_dir: PathBuf,
    pub env: Environment,
    /// True while running the development server.
    pub serving: bool,
    /// The path the site is served under: empty for the domain's root, or
    /// `/repo` (no `/` at the end). See [`Config::base`].
    pub base: String,
}

impl BuildContext {
    /// `url` with the site's `base` in front, if it's from the site's root
    /// (`/about/` becomes `/repo/about/`).
    pub fn with_base(&self, url: &str) -> String {
        crate::base::with_base(&self.base, url)
    }
}

/// Passed to transforms along with the rendered output.
pub struct TransformContext<'a> {
    pub url: &'a str,
    pub output_path: &'a Path,
    pub input_path: &'a Path,
    pub build: &'a BuildContext,
}

impl TransformContext<'_> {
    pub fn is_html(&self) -> bool {
        self.output_path.extension().is_some_and(|e| e == "html")
    }
}

/// What custom collections are built from: every page in collections.
pub struct CollectionApi {
    pub(crate) items: Vec<Value>,
}

impl CollectionApi {
    /// Every page in collections, sorted by date (oldest first).
    pub fn all(&self) -> Vec<Value> {
        self.items.clone()
    }

    pub fn by_tag(&self, tag: &str) -> Vec<Value> {
        self.by_tags(&[tag])
    }

    /// Pages that have *all* of the given tags.
    pub fn by_tags(&self, tags: &[&str]) -> Vec<Value> {
        self.items
            .iter()
            .filter(|item| {
                let item_tags = item.get("data").get("tags");
                let list = item_tags.as_array().unwrap_or(&[]);
                tags.iter().all(|t| list.iter().any(|v| v.as_str() == Some(t)))
            })
            .cloned()
            .collect()
    }
}

/// A build summary handed to `after_build` hooks.
#[derive(Debug, Default, Clone)]
pub struct BuildReport {
    /// Template files read (a paginated template counts once).
    pub templates: usize,
    pub pages_written: usize,
    /// Total size of the pages written.
    pub page_bytes: u64,
    /// Passthrough files copied because they were new or changed.
    pub files_copied: usize,
    /// Passthrough files already up to date in the output.
    pub files_unchanged: usize,
    /// Total size of every passthrough file, copied or not.
    pub passthrough_bytes: u64,
    /// Stale files deleted from the output (with `clean`).
    pub files_removed: usize,
    pub written: Vec<PathBuf>,
    pub duration: std::time::Duration,
    pub timings: Vec<(String, std::time::Duration)>,
    /// Lines plugins add to the build summary (see [`Config::add_summary`]),
    /// such as `("Images", "4,689 files ...")`. Filled in after the
    /// `after_build` hooks run.
    pub summary: Vec<(String, String)>,
}

/// Where `page.lastModified` comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LastModified {
    /// The last commit that changed the file (or the file's time, when it has
    /// uncommitted changes or isn't committed yet).
    Git,
    /// The file's modification time.
    File,
}

impl LastModified {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "git" => Some(LastModified::Git),
            "file" => Some(LastModified::File),
            _ => None,
        }
    }
}

/// A page the build wrote, for [`Config::add_generator`].
#[derive(Clone, Debug)]
pub struct PageSummary {
    pub url: String,
    pub output_path: PathBuf,
    pub input_path: PathBuf,
    pub date: chrono::DateTime<chrono::Utc>,
    /// The page's data (front matter and the rest of the cascade).
    pub data: Value,
}

/// A file a generator adds to the output.
#[derive(Clone, Debug)]
pub struct GeneratedFile {
    /// A URL path in the output: `/sitemap.xml`, `/old/index.html`.
    pub path: String,
    pub contents: String,
    /// Add to the end of a file a page wrote at the same path (a
    /// `_redirects` template, say), instead of it being a conflict.
    pub append: bool,
}

pub type FileBuilderFn = Arc<dyn Fn(&BuildContext) -> Result<Vec<GeneratedFile>> + Send + Sync>;
pub type GeneratorFn = Arc<dyn Fn(&BuildContext, &[PageSummary]) -> Result<Vec<GeneratedFile>> + Send + Sync>;
pub type DataFn = Arc<dyn Fn(&BuildContext) -> Result<Value> + Send + Sync>;
pub type CollectionFn = Arc<dyn Fn(&CollectionApi) -> Result<Value> + Send + Sync>;
pub type TransformFn = Arc<dyn Fn(&TransformContext, String) -> Result<String> + Send + Sync>;
pub type BeforeHook = Arc<dyn Fn(&BuildContext) -> Result<()> + Send + Sync>;
pub type AfterHook = Arc<dyn Fn(&BuildContext, &BuildReport) -> Result<()> + Send + Sync>;
pub type SummaryFn = Arc<dyn Fn(&BuildContext) -> Option<String> + Send + Sync>;
pub type EngineFactory = Arc<dyn Fn(&EngineEnv) -> Result<Arc<dyn TemplateEngine>> + Send + Sync>;

pub struct Config {
    /// Project root; every relative path below is resolved against it.
    pub root: PathBuf,
    /// Input directory, relative to `root`.
    pub input: PathBuf,
    /// Output directory, relative to `root`.
    pub output: PathBuf,
    /// Layouts, partials and components, relative to `input`.
    pub includes: PathBuf,
    /// Where layouts are, relative to `input`, when not in `includes`.
    pub layouts: Option<PathBuf>,
    /// Global data files, relative to `input`.
    pub data: PathBuf,
    /// File extensions treated as templates.
    pub template_formats: Vec<String>,
    /// Engine that pre-processes Markdown files before Markdown renders them.
    pub markdown_engine: Option<String>,
    /// Engine that pre-processes `.html` files.
    pub html_engine: Option<String>,
    /// How Markdown renders: heading IDs, footnotes and the other extensions.
    pub markdown: MarkdownOptions,
    /// Merge objects and concatenate arrays across the data cascade.
    pub data_deep_merge: bool,
    /// Delete output files an earlier build wrote or copied that this build
    /// didn't (a deleted post's page, a removed passthrough file). Files from
    /// other tools are never touched: only files listed in
    /// `.cache/ssqch/output-files.json` are candidates.
    pub clean: bool,
    /// Globs (relative to the input directory) for files and folders that
    /// aren't templates: `["drafts/**", "**/*.wip.md"]`.
    pub ignore: Vec<String>,
    /// Copy the other files in a folder whose page is `index.*` (images,
    /// downloads) next to that page's output.
    pub bundles: bool,
    /// Undefined values in templates are errors, not empty output.
    pub strict: bool,
    /// Where `page.lastModified` comes from, if anywhere.
    pub last_modified: Option<LastModified>,
    /// The path the site is served under, for a site that isn't at the root
    /// of its domain: `/repo` for `https://user.github.io/repo/`. Empty
    /// otherwise. Set it with [`Config::set_base`]. Templates and `page.url`
    /// don't include it; the build adds it to URLs in the HTML it writes.
    pub base: String,
    pub env: Environment,
    pub serving: bool,
    pub quiet: bool,
    pub verbose: bool,

    pub(crate) passthrough: Vec<(PathBuf, Option<PathBuf>)>,
    pub(crate) filters: Vec<(String, Value)>,
    pub(crate) global_data: Vec<(String, DataFn)>,
    pub(crate) data_extensions: Vec<(String, DataLoader)>,
    pub(crate) collections: Vec<(String, CollectionFn)>,
    pub(crate) transforms: Vec<(String, TransformFn)>,
    pub(crate) html_transforms: Vec<(String, TransformFn)>,
    pub(crate) engines: Vec<(String, EngineFactory)>,
    pub(crate) before_build: Vec<BeforeHook>,
    pub(crate) after_build: Vec<AfterHook>,
    pub(crate) watch_targets: Vec<PathBuf>,
    pub(crate) plugins: Vec<String>,
    pub(crate) summaries: Vec<(String, SummaryFn)>,
    pub(crate) generators: Vec<(String, GeneratorFn)>,
    pub(crate) file_builders: Vec<(String, FileBuilderFn)>,
    pub(crate) schemas: Vec<crate::schema::Schema>,
    pub(crate) config_files: ConfigFiles,
}

/// The files a site's configuration was read from: the config file and the
/// modules it imports, and JavaScript data files and theirs. Shared, because
/// some are only read during a build. `ssqch serve` reads the configuration
/// again when one of them changes.
pub type ConfigFiles = Arc<std::sync::Mutex<std::collections::BTreeSet<PathBuf>>>;

impl Config {
    pub fn new(root: impl Into<PathBuf>, env: Environment) -> Self {
        Config {
            root: root.into(),
            input: PathBuf::from("."),
            output: PathBuf::from("_site"),
            includes: PathBuf::from("_includes"),
            layouts: None,
            data: PathBuf::from("_data"),
            template_formats: ["edge", "md", "html"].map(String::from).to_vec(),
            markdown_engine: Some("edge".into()),
            html_engine: Some("edge".into()),
            markdown: MarkdownOptions::default(),
            data_deep_merge: true,
            clean: false,
            ignore: Vec::new(),
            bundles: false,
            strict: false,
            last_modified: None,
            base: String::new(),
            env,
            serving: false,
            quiet: false,
            verbose: false,
            passthrough: Vec::new(),
            filters: Vec::new(),
            global_data: Vec::new(),
            data_extensions: Vec::new(),
            collections: Vec::new(),
            transforms: Vec::new(),
            html_transforms: Vec::new(),
            engines: Vec::new(),
            before_build: Vec::new(),
            after_build: Vec::new(),
            watch_targets: Vec::new(),
            plugins: Vec::new(),
            summaries: Vec::new(),
            generators: Vec::new(),
            file_builders: Vec::new(),
            schemas: Vec::new(),
            config_files: Default::default(),
        }
    }

    /// Serve the site under a path: `set_base("/repo/")`. `"/"` or `""` means
    /// the domain's root.
    pub fn set_base(&mut self, base: &str) -> Result<&mut Self> {
        self.base = crate::base::normalize(base)?;
        Ok(self)
    }

    pub fn is_production(&self) -> bool {
        self.env == Environment::Production
    }

    pub fn is_development(&self) -> bool {
        self.env == Environment::Development
    }

    pub fn add_plugin(&mut self, plugin: impl Plugin) -> &mut Self {
        self.plugins.push(plugin.name().to_string());
        plugin.register(self);
        self
    }

    /// Register a function callable from every template. Filters are Edge
    /// globals:
    /// `{{ postDate(date) }}`.
    pub fn add_filter<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&[Value]) -> Result<Value> + Send + Sync + 'static,
    {
        self.filters.push((name.into(), Value::func(f)));
        self
    }

    /// Register any global value (an object of helpers, a constant...).
    pub fn add_global(&mut self, name: impl Into<String>, value: Value) -> &mut Self {
        self.filters.push((name.into(), value));
        self
    }

    /// Computed global data, like a JavaScript file in `_data/`.
    pub fn add_global_data<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&BuildContext) -> Result<Value> + Send + Sync + 'static,
    {
        self.global_data.push((name.into(), Arc::new(f)));
        self
    }

    /// Read data files with another extension: `_data/name.<ext>` and
    /// `name.data.<ext>`
    /// template and directory data files. `f` gets the file's path.
    pub fn add_data_extension<F>(&mut self, ext: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&Path) -> Result<Value> + Send + Sync + 'static,
    {
        let ext = ext.into();
        self.data_extensions.retain(|(e, _)| *e != ext);
        self.data_extensions.push((ext, Arc::new(f)));
        self
    }

    pub fn add_collection<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&CollectionApi) -> Result<Value> + Send + Sync + 'static,
    {
        self.collections.push((name.into(), Arc::new(f)));
        self
    }

    /// Post-process every rendered output file, after any HTML transforms
    /// (see [`Config::add_html_transform`]), in registration order.
    pub fn add_transform<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&TransformContext, String) -> Result<String> + Send + Sync + 'static,
    {
        self.transforms.push((name.into(), Arc::new(f)));
        self
    }

    /// A transform that runs before every [`Config::add_transform`] one,
    /// whatever order plugins were added in. The image plugin uses it, so later
    /// transforms (minifying) see the final markup.
    pub fn add_html_transform<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&TransformContext, String) -> Result<String> + Send + Sync + 'static,
    {
        self.html_transforms.push((name.into(), Arc::new(f)));
        self
    }

    /// Add (or replace) the template engine for a file extension.
    pub fn add_template_engine<F>(&mut self, ext: impl Into<String>, factory: F) -> &mut Self
    where
        F: Fn(&EngineEnv) -> Result<Arc<dyn TemplateEngine>> + Send + Sync + 'static,
    {
        self.engines.push((ext.into(), Arc::new(factory)));
        self
    }

    pub fn on_before_build<F>(&mut self, f: F) -> &mut Self
    where
        F: Fn(&BuildContext) -> Result<()> + Send + Sync + 'static,
    {
        self.before_build.push(Arc::new(f));
        self
    }

    pub fn on_after_build<F>(&mut self, f: F) -> &mut Self
    where
        F: Fn(&BuildContext, &BuildReport) -> Result<()> + Send + Sync + 'static,
    {
        self.after_build.push(Arc::new(f));
        self
    }

    /// Run a program before each build (after file builders), like a hook:
    /// `npx tailwindcss -i src/app.css -o dist/app.css`. See [`run_command`].
    pub fn run_before_build(&mut self, command: impl Into<String>) -> &mut Self {
        let command = command.into();
        let quiet = self.quiet;
        self.on_before_build(move |ctx| run_command(ctx, "beforeBuild", &command, quiet))
    }

    /// Run a program after each build, like a hook: `pagefind --site dist`.
    pub fn run_after_build(&mut self, command: impl Into<String>) -> &mut Self {
        let command = command.into();
        let quiet = self.quiet;
        self.on_after_build(move |ctx, _| run_command(ctx, "afterBuild", &command, quiet))
    }

    /// Add a line to the summary printed after each build, such as
    /// `Images  4,689 files from 812 sources`. `f` runs after the
    /// `after_build` hooks; returning `None` leaves the line out.
    pub fn add_summary<F>(&mut self, label: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&BuildContext) -> Option<String> + Send + Sync + 'static,
    {
        self.summaries.push((label.into(), Arc::new(f)));
        self
    }

    /// Add files made from the list of pages (a sitemap, redirect pages),
    /// after the pages are written and before `after_build` hooks run. The
    /// build writes them, records them for `clean`, and reports a file that
    /// collides with a page or another generator's.
    pub fn add_generator<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&BuildContext, &[PageSummary]) -> Result<Vec<GeneratedFile>> + Send + Sync + 'static,
    {
        self.generators.push((name.into(), Arc::new(f)));
        self
    }

    /// Add files built from sources of their own (compiled CSS), written at
    /// the start of each build, before `before_build` hooks run (so asset
    /// fingerprinting sees them). The build records them for `clean`.
    pub fn add_file_builder<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&BuildContext) -> Result<Vec<GeneratedFile>> + Send + Sync + 'static,
    {
        self.file_builders.push((name.into(), Arc::new(f)));
        self
    }

    /// The list of files the configuration comes from (see [`ConfigFiles`]),
    /// for code that reads them to add to.
    pub fn config_files(&self) -> ConfigFiles {
        self.config_files.clone()
    }

    /// Note that the configuration depends on `path`, so `ssqch serve` reads
    /// the configuration again when it changes.
    pub fn add_config_file(&self, path: impl Into<PathBuf>) {
        let path = path.into();
        let path = dunce::canonicalize(&path).unwrap_or(path);
        self.config_files.lock().unwrap().insert(path);
    }

    /// Check pages' data against a schema on every build (see
    /// [`crate::schema`]). A schema with the same name replaces the earlier one.
    pub fn add_schema(&mut self, schema: crate::schema::Schema) -> &mut Self {
        self.schemas.retain(|s| s.name != schema.name);
        self.schemas.push(schema);
        self
    }

    /// The content schemas, in the order they were added.
    pub fn schemas(&self) -> &[crate::schema::Schema] {
        &self.schemas
    }

    /// Copy a file or directory into the output. A path inside the input
    /// directory keeps its path relative to it; anything else keeps its path
    /// relative to the project root.
    pub fn add_passthrough_copy(&mut self, from: impl Into<PathBuf>) -> &mut Self {
        self.passthrough.push((from.into(), None));
        self
    }

    /// Copy a file or directory to a specific output path.
    pub fn add_passthrough_copy_to(&mut self, from: impl Into<PathBuf>, to: impl Into<PathBuf>) -> &mut Self {
        self.passthrough.push((from.into(), Some(to.into())));
        self
    }

    /// Extra paths the dev server watches (the input directory is always watched).
    pub fn add_watch_target(&mut self, path: impl Into<PathBuf>) -> &mut Self {
        self.watch_targets.push(path.into());
        self
    }

    pub fn plugin_names(&self) -> &[String] {
        &self.plugins
    }

    pub fn build_context(&self) -> BuildContext {
        let root = dunce::canonicalize(&self.root).unwrap_or_else(|_| self.root.clone());
        let input_dir = root.join(&self.input);
        BuildContext {
            output_dir: root.join(&self.output),
            includes_dir: input_dir.join(&self.includes),
            layouts_dir: input_dir.join(self.layouts.as_ref().unwrap_or(&self.includes)),
            data_dir: input_dir.join(&self.data),
            input_dir,
            root,
            env: self.env,
            serving: self.serving,
            base: self.base.clone(),
        }
    }

    pub(crate) fn watch_paths(&self) -> Vec<PathBuf> {
        let ctx = self.build_context();
        let mut paths = vec![ctx.input_dir];
        paths.extend(self.watch_targets.iter().map(|p| ctx.root.join(p)));
        paths
    }
}

/// Run `command` through the shell (`sh -c`, or `cmd /C` on Windows) in the
/// project root, with its output passed through. It gets `SSQCH_ENV`,
/// `SSQCH_SERVING` (`true` or `false`), `SSQCH_INPUT` and `SSQCH_OUTPUT` (the
/// folders, absolute). A failure (or a program that can't start) is an error
/// naming the command.
pub fn run_command(ctx: &BuildContext, event: &str, command: &str, quiet: bool) -> Result<()> {
    if !quiet {
        println!("[ssqch] {}: {}", event, command);
    }
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = std::process::Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    let status = cmd
        .current_dir(&ctx.root)
        .env("SSQCH_ENV", ctx.env.as_str())
        .env("SSQCH_SERVING", if ctx.serving { "true" } else { "false" })
        .env("SSQCH_INPUT", &ctx.input_dir)
        .env("SSQCH_OUTPUT", &ctx.output_dir)
        .status()
        .map_err(|e| anyhow::anyhow!("{}: couldn't run `{}`: {}", event, command, e))?;
    if !status.success() {
        let how = status.code().map(|c| format!("exited with status {}", c)).unwrap_or_else(|| "was stopped".into());
        anyhow::bail!("{}: `{}` {}", event, command, how);
    }
    Ok(())
}
