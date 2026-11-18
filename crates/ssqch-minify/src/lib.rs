//! ssqch's own HTML minifier, for the Node build (0.8).
//!
//! [`html`] is 0.7's `plugins/minify/src/lib.rs`, compiled by path and unchanged, so a page
//! comes out as 0.7 minified it. It registers itself with 0.7's `sitesquatch::{Config,
//! Plugin}`; the stand-ins below take their place (`extern crate self as sitesquatch` is what
//! its `use sitesquatch::...` finds), and the Node build calls [`html::minify`] itself.
//!
//! The wasm is an ssqch plugin like any other (ABI v1, from `ssqch-plugin`):
//! `packages/ssqch/src/modules/minify.ts` loads it with the loader third-party plugins use.
//! Its transform minifies a page with `minifyPlugin()`'s options, and its `minify` filter is
//! `minify(html, options)` from `"ssqch/minify"`. Node checks the options with 0.7's messages
//! before they get here.

extern crate self as sitesquatch;

use ssqch_plugin::{export, Hooks, Page, Value};

#[path = "../../../plugins/minify/src/lib.rs"]
pub mod html;

/// 0.7's `sitesquatch::Plugin`, as `plugins/minify` uses it.
pub trait Plugin {
    fn name(&self) -> &str;
    fn register(&self, config: &mut Config);
}

/// 0.7's `sitesquatch::Config`, as far as `plugins/minify` uses it.
pub struct Config;

impl Config {
    pub fn add_transform<F>(&mut self, _name: &str, _transform: F)
    where
        F: Fn(&TransformContext, String) -> Result<String, String> + 'static,
    {
    }
}

/// 0.7's `sitesquatch::TransformContext`, as far as `plugins/minify` uses it.
pub struct TransformContext;

impl TransformContext {
    pub fn is_html(&self) -> bool {
        true
    }
}

/// The options, all on unless they're `false`, as `MinifyOptions::default()` has them.
#[derive(serde::Deserialize, Default, Clone, Copy)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    pub collapse_whitespace: Option<bool>,
    pub remove_comments: Option<bool>,
    pub short_doctype: Option<bool>,
    pub shorten_attributes: Option<bool>,
}

impl Options {
    fn minify_options(self) -> html::MinifyOptions {
        let on = html::MinifyOptions::default();
        html::MinifyOptions {
            collapse_whitespace: self.collapse_whitespace.unwrap_or(on.collapse_whitespace),
            remove_comments: self.remove_comments.unwrap_or(on.remove_comments),
            short_doctype: self.short_doctype.unwrap_or(on.short_doctype),
            shorten_attributes: self.shorten_attributes.unwrap_or(on.shorten_attributes),
        }
    }
}

pub struct Minify {
    options: html::MinifyOptions,
}

impl ssqch_plugin::Plugin for Minify {
    type Options = Options;
    const NAME: &'static str = "ssqch/minify";
    const HOOKS: Hooks = Hooks { transform: true, filters: &["minify"], ..Hooks::NONE };

    fn new(options: Options) -> Result<Self, String> {
        Ok(Minify { options: options.minify_options() })
    }

    fn transform(&self, text: &str, _page: &Page) -> Result<Option<String>, String> {
        Ok(Some(html::minify(text, &self.options)))
    }

    /// `minify(html, options)`.
    fn filter(&self, name: &str, args: &[Value]) -> Result<Value, String> {
        if name != "minify" {
            return Err(format!("no filter named {name}"));
        }
        let text = args.first().and_then(Value::as_str).ok_or("minify() takes the HTML as a string")?;
        let options: Options = match args.get(1) {
            None | Some(Value::Null) => Options::default(),
            Some(value) => serde_json::from_value(value.clone()).map_err(|e| format!("options: {e}"))?,
        };
        Ok(Value::from(html::minify(text, &options.minify_options())))
    }
}

export!(Minify);

/// What Node checks the file against (`packages/ssqch/scripts/wasm-inputs.test.ts`): a hash of
/// the Rust this was built from, which `packages/ssqch/scripts/build-wasm.ts` passes in.
#[cfg(target_arch = "wasm32")]
mod inputs {
    const INPUTS: &str = match option_env!("SSQCH_MINIFY_INPUTS") {
        Some(hash) => hash,
        None => "not built by scripts/build-wasm.ts",
    };

    const fn bytes<const N: usize>(s: &str) -> [u8; N] {
        let mut out = [0u8; N];
        let b = s.as_bytes();
        let mut i = 0;
        while i < N {
            out[i] = b[i];
            i += 1;
        }
        out
    }

    #[used]
    #[unsafe(link_section = "ssqch_minify_inputs")]
    static INPUTS_SECTION: [u8; INPUTS.len()] = bytes(INPUTS);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ssqch_plugin::Plugin as _;

    #[test]
    fn the_transform_and_the_filter_minify_as_0_7_did() {
        let on = ssqch_plugin::create::<Minify>("").unwrap();
        let page = "<!DOCTYPE html>\n<p>Hello   <strong>big</strong>\n  world</p><!-- gone --><script defer=\"defer\"></script>";
        assert_eq!(on.transform(page, &Page::default()).unwrap().as_deref(), Some("<!doctype html><p>Hello <strong>big</strong> world</p><script defer></script>"));
        let off = ssqch_plugin::create::<Minify>(r#"{ "removeComments": false, "shortenAttributes": false }"#).unwrap();
        assert_eq!(off.transform("<p><!-- kept --></p><script defer=\"defer\"></script>", &Page::default()).unwrap().as_deref(), Some("<p><!-- kept --></p><script defer=\"defer\"></script>"));
        let options = serde_json::json!({ "collapseWhitespace": false });
        assert_eq!(on.filter("minify", &[Value::from("<p>a  b</p>\n"), options]).unwrap(), "<p>a  b</p>\n");
        assert_eq!(on.filter("minify", &[Value::from("<p>a  b</p>\n")]).unwrap(), "<p>a b</p>");
        assert!(on.filter("minify", &[Value::from(1)]).is_err());
    }
}
