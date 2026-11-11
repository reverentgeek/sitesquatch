//! `sitesquatch.toml`: configuration for sites that don't need custom Rust code.
//!
//! ```toml
//! input = "src"
//! output = "dist"
//! template_formats = ["edge", "md", "html"]
//! markdown_engine = "edge"
//!
//! [markdown]
//! heading_ids = "blackfriday"
//! footnotes = true
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
pub struct ServeToml {
    #[serde(default)]
    pub run: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct SiteToml {
    pub input: Option<PathBuf>,
    pub output: Option<PathBuf>,
    pub includes: Option<PathBuf>,
    pub layouts: Option<PathBuf>,
    pub data: Option<PathBuf>,
    pub template_formats: Option<Vec<String>>,
    pub markdown_engine: Option<String>,
    pub html_engine: Option<String>,
    pub data_deep_merge: Option<bool>,
    /// `clean` is its other name.
    #[serde(alias = "clean")]
    pub leave_no_trace: Option<bool>,
    pub ignore: Option<Vec<String>>,
    pub bundles: Option<bool>,
    pub strict: Option<bool>,
    /// The path the site is served under, like `/repo/`.
    pub base: Option<String>,
    /// `"git"` or `"file"`.
    pub last_modified: Option<String>,
    /// Programs to run before and after each build.
    #[serde(default)]
    pub before_build: Vec<String>,
    #[serde(default)]
    pub after_build: Vec<String>,
    /// `[budgets]`: sizes by kind of file (`pages = "150 KB"`).
    pub budgets: Option<toml::Table>,
    /// `[serve]` with `run`: programs `ssqch serve` runs alongside.
    pub serve: Option<ServeToml>,
    /// Themes: folders, or git URLs pinned with `#commit`.
    #[serde(default)]
    pub theme: Vec<String>,
    /// `[schemas.posts]` with `fields`, `files` and `unknown`, as in the JavaScript config.
    pub schemas: Option<toml::Table>,
    /// `[markdown]`, with the config's keys in snake case (`heading_ids = "blackfriday"`).
    pub markdown: Option<toml::Table>,
    #[serde(default)]
    pub passthrough: BTreeMap<String, String>,
}

/// Apply `sitesquatch.toml` from the project root, if there is one.
pub fn apply(cfg: &mut Config) -> Result<()> {
    let path = cfg.root.join("sitesquatch.toml");
    if !path.is_file() {
        return Ok(());
    }
    cfg.add_config_file(&path);
    let text = std::fs::read_to_string(&path)?;
    let site: SiteToml = toml::from_str(&text).with_context(|| format!("invalid {}", path.display()))?;
    if let Some(v) = site.input { cfg.input = v; }
    if let Some(v) = site.output { cfg.output = v; }
    if let Some(v) = site.includes { cfg.includes = v; }
    if let Some(v) = site.layouts { cfg.layouts = Some(v); }
    if let Some(v) = site.data { cfg.data = v; }
    if let Some(v) = site.template_formats { cfg.template_formats = v; }
    if let Some(v) = site.markdown_engine { cfg.markdown_engine = Some(v).filter(|s| !s.is_empty()); }
    if let Some(v) = site.html_engine { cfg.html_engine = Some(v).filter(|s| !s.is_empty()); }
    if let Some(v) = site.data_deep_merge { cfg.data_deep_merge = v; }
    if let Some(v) = site.leave_no_trace { cfg.leave_no_trace = v; }
    if let Some(v) = site.ignore { cfg.ignore = v; }
    if let Some(v) = site.bundles { cfg.bundles = v; }
    if let Some(v) = site.strict { cfg.strict = v; }
    if let Some(v) = site.base {
        cfg.set_base(&v).with_context(|| format!("invalid {}", path.display()))?;
    }
    if let Some(table) = site.budgets {
        for (name, value) in table {
            let size = match value {
                toml::Value::Integer(n) => crate::Value::Num(n as f64),
                toml::Value::String(s) => crate::Value::from(s.as_str()),
                other => crate::Value::from(other.to_string().as_str()),
            };
            cfg.budgets.push(crate::footprint::budget(&name, &size).with_context(|| format!("invalid {}", path.display()))?);
        }
    }
    if let Some(serve) = site.serve {
        cfg.serve_run = serve.run;
    }
    for command in site.before_build {
        cfg.run_before_build(command);
    }
    for command in site.after_build {
        cfg.run_after_build(command);
    }
    if let Some(v) = site.last_modified {
        cfg.last_modified = Some(crate::LastModified::parse(&v).with_context(|| format!("invalid {}: last_modified must be \"git\" or \"file\"", path.display()))?);
    }
    if let Some(table) = site.markdown {
        let mut map = crate::Map::new();
        for (key, value) in table {
            let camel: String = key.split('_').enumerate().map(|(i, w)| match w.chars().next() { Some(c) if i > 0 => c.to_uppercase().collect::<String>() + &w[c.len_utf8()..], _ => w.to_string() }).collect();
            map.insert(camel, crate::data::toml_to_value(value));
        }
        cfg.markdown.apply(&crate::Value::object(map)).with_context(|| format!("invalid {}", path.display()))?;
    }
    for theme in site.theme {
        cfg.add_theme(&theme).with_context(|| format!("invalid {}", path.display()))?;
    }
    for (name, spec) in site.schemas.unwrap_or_default() {
        let schema = crate::schema::Schema::parse(&name, &crate::data::toml_to_value(spec)).with_context(|| format!("invalid {}", path.display()))?;
        cfg.add_schema(schema);
    }
    for (from, to) in site.passthrough {
        if to.is_empty() {
            cfg.add_passthrough_copy(from);
        } else {
            cfg.add_passthrough_copy_to(from, to);
        }
    }
    Ok(())
}
