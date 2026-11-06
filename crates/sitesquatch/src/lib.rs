//! # SiteSquatch
//!
//! A static site generator in the spirit of [Eleventy](https://www.11ty.dev):
//! a data cascade, layouts, collections, pagination and permalinks, Edge.js
//! and Markdown templates, and a plugin API for filters, shortcodes, global
//! data, collections, transforms, template engines and build hooks.
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

pub mod build;
pub mod cli;
pub mod config;
pub mod data;
pub mod engines;
pub mod serve;
pub mod site_toml;

pub use build::{build, display_path};
pub use config::{BuildContext, BuildReport, CollectionApi, Config, Environment, Plugin, TransformContext};
pub use engines::{EngineEnv, RenderContext, TemplateEngine};
pub use sitesquatch_edge::{escape_html, Args, Func, Map, Value};
