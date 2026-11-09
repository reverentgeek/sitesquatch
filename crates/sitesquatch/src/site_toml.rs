//! `sitesquatch.toml`: configuration for sites that don't need custom Rust code.
//!
//! ```toml
//! input = "src"
//! output = "dist"
//! template_formats = ["edge", "md", "html"]
//! markdown_engine = "edge"
//!
//! [passthrough]
//! "src/assets/fonts" = "fonts"
//! "src/favicon.ico" = ""      # empty: keep its path
//! ```

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::config::Config;

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct SiteToml {
    pub input: Option<PathBuf>,
    pub output: Option<PathBuf>,
    pub includes: Option<PathBuf>,
    pub data: Option<PathBuf>,
    pub template_formats: Option<Vec<String>>,
    pub markdown_engine: Option<String>,
    pub html_engine: Option<String>,
    pub data_deep_merge: Option<bool>,
    #[serde(default)]
    pub passthrough: BTreeMap<String, String>,
}

/// Apply `sitesquatch.toml` from the project root, if there is one.
pub fn apply(cfg: &mut Config) -> Result<()> {
    let path = cfg.root.join("sitesquatch.toml");
    if !path.is_file() {
        return Ok(());
    }
    let text = std::fs::read_to_string(&path)?;
    let site: SiteToml = toml::from_str(&text).with_context(|| format!("invalid {}", path.display()))?;
    if let Some(v) = site.input { cfg.input = v; }
    if let Some(v) = site.output { cfg.output = v; }
    if let Some(v) = site.includes { cfg.includes = v; }
    if let Some(v) = site.data { cfg.data = v; }
    if let Some(v) = site.template_formats { cfg.template_formats = v; }
    if let Some(v) = site.markdown_engine { cfg.markdown_engine = Some(v).filter(|s| !s.is_empty()); }
    if let Some(v) = site.html_engine { cfg.html_engine = Some(v).filter(|s| !s.is_empty()); }
    if let Some(v) = site.data_deep_merge { cfg.data_deep_merge = v; }
    for (from, to) in site.passthrough {
        if to.is_empty() {
            cfg.add_passthrough_copy(from);
        } else {
            cfg.add_passthrough_copy_to(from, to);
        }
    }
    Ok(())
}
