//! # SiteSquatch
//!
//! A static site generator: a data cascade, layouts, collections, pagination
//! and permalinks, Edge.js and Markdown templates, and a plugin API for
//! filters, global data, collections, transforms, template engines and build hooks.
//!
//! ```no_run
//! fn main() -> std::process::ExitCode {
//!     sitesquatch::cli::run(|cfg| {
//!         cfg.input = "src".into();
//!         cfg.output = "dist".into();
//!         cfg.add_filter("shout", |args| Ok(sitesquatch::Value::from(args[0].to_js_string().to_uppercase())));
//!     })
//! }
//! ```

pub mod base;
pub mod build;
pub mod cli;
pub mod config;
pub mod data;
pub mod diff;
pub mod engines;
#[cfg(feature = "highlight")]
pub mod highlight;
pub mod diagnostics;
pub mod inspect;
pub mod markdown;
pub mod nav;
pub mod report;
pub mod schema;
pub mod serve;
pub mod site_toml;
pub mod theme;

pub use build::{build, display_path, slashes};
pub use config::{BuildContext, BuildReport, CollectionApi, Config, ConfigFiles, Environment, GeneratedFile, LastModified, PageSummary, Plugin, TransformContext};
pub use engines::{EngineEnv, RenderContext, TemplateEngine};
pub use sitesquatch_edge::{escape_html, Args, Func, Map, Value};
