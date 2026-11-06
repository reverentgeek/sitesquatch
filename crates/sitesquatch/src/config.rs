//! Site configuration and the plugin registration API.
//!
//! This mirrors Eleventy's `eleventyConfig` object: plugins (and your own
//! site code) call `add_filter`, `add_collection`, `add_transform`, ... on a
//! [`Config`] before the build starts.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;

use crate::data::DataLoader;
use crate::engines::{EngineEnv, TemplateEngine};
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
    pub data_dir: PathBuf,
    pub env: Environment,
    /// True while running the development server.
    pub serving: bool,
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

/// What custom collections are built from, like Eleventy's `collectionApi`.
pub struct CollectionApi {
    pub(crate) items: Vec<Value>,
}

impl CollectionApi {
    /// Every page in collections, sorted by date (oldest first).
    pub fn get_all(&self) -> Vec<Value> {
        self.items.clone()
    }

    pub fn get_filtered_by_tag(&self, tag: &str) -> Vec<Value> {
        self.get_filtered_by_tags(&[tag])
    }

    /// Pages that have *all* of the given tags.
    pub fn get_filtered_by_tags(&self, tags: &[&str]) -> Vec<Value> {
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
    pub pages_written: usize,
    pub files_copied: usize,
    pub written: Vec<PathBuf>,
    pub duration: std::time::Duration,
    pub timings: Vec<(String, std::time::Duration)>,
}

pub type DataFn = Arc<dyn Fn(&BuildContext) -> Result<Value> + Send + Sync>;
pub type CollectionFn = Arc<dyn Fn(&CollectionApi) -> Result<Value> + Send + Sync>;
pub type TransformFn = Arc<dyn Fn(&TransformContext, String) -> Result<String> + Send + Sync>;
pub type BeforeHook = Arc<dyn Fn(&BuildContext) -> Result<()> + Send + Sync>;
pub type AfterHook = Arc<dyn Fn(&BuildContext, &BuildReport) -> Result<()> + Send + Sync>;
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
    /// Global data files, relative to `input`.
    pub data: PathBuf,
    /// File extensions treated as templates.
    pub template_formats: Vec<String>,
    /// Engine that pre-processes Markdown files (Eleventy's `markdownTemplateEngine`).
    pub markdown_template_engine: Option<String>,
    /// Engine that pre-processes `.html` files (Eleventy's `htmlTemplateEngine`).
    pub html_template_engine: Option<String>,
    /// Merge objects and concatenate arrays across the data cascade.
    pub data_deep_merge: bool,
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
}

impl Config {
    pub fn new(root: impl Into<PathBuf>, env: Environment) -> Self {
        Config {
            root: root.into(),
            input: PathBuf::from("."),
            output: PathBuf::from("_site"),
            includes: PathBuf::from("_includes"),
            data: PathBuf::from("_data"),
            template_formats: ["edge", "md", "html"].map(String::from).to_vec(),
            markdown_template_engine: Some("edge".into()),
            html_template_engine: Some("edge".into()),
            data_deep_merge: true,
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
        }
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

    /// Register a function callable from every template. Like the Edge.js
    /// plugin for Eleventy, filters and shortcodes are Edge globals:
    /// `{{ postDate(date) }}`.
    pub fn add_filter<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&[Value]) -> Result<Value> + Send + Sync + 'static,
    {
        self.filters.push((name.into(), Value::func(f)));
        self
    }

    /// Shortcodes are filters that return markup; the distinction is kept for
    /// readability when porting Eleventy configs.
    pub fn add_shortcode<F>(&mut self, name: impl Into<String>, f: F) -> &mut Self
    where
        F: Fn(&[Value]) -> Result<Value> + Send + Sync + 'static,
    {
        self.add_filter(name, f)
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

    /// Read data files with another extension, like Eleventy's
    /// `addDataExtension`: `_data/name.<ext>` and `name.11tydata.<ext>`
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

    /// A transform that runs before every [`Config::add_transform`] one, like
    /// a plugin on Eleventy's `htmlTransformer` (the stage `@11ty/eleventy-img`
    /// uses), whatever order plugins were added in.
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
        let root = std::fs::canonicalize(&self.root).unwrap_or_else(|_| self.root.clone());
        let input_dir = root.join(&self.input);
        BuildContext {
            output_dir: root.join(&self.output),
            includes_dir: input_dir.join(&self.includes),
            data_dir: input_dir.join(&self.data),
            input_dir,
            root,
            env: self.env,
            serving: self.serving,
        }
    }

    pub(crate) fn watch_paths(&self) -> Vec<PathBuf> {
        let ctx = self.build_context();
        let mut paths = vec![ctx.input_dir];
        paths.extend(self.watch_targets.iter().map(|p| ctx.root.join(p)));
        paths
    }
}
