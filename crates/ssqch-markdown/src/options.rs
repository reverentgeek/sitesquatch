//! A site's `markdown` options, as Node sends them: already checked by Node with 0.7's rules
//! and messages (`packages/ssqch/src/markdown-options.ts`), so this only puts them in 0.7's
//! [`MarkdownOptions`]. Then [`Languages::load`] runs as in 0.7: it reads the site's
//! `.sublime-syntax` files and checks its aliases. In the wasm it reads the files Node gave it
//! (see `wasm.ts`), from a root of `/`.
//!
//! ```json
//! { "headingIds": "github", "headingAttributes": true, "footnotes": true, "taskLists": true,
//!   "autolinks": true (or "fuzzy"), "breaks": false, "figures": false, "alerts": true, "containers": true, "definitionLists": false,
//!   "smartPunctuation": false, "indentedCode": true, "highlight": true, "highlightCss": "/highlight.css",
//!   "languages": [["chordpro", { "function": 0 }], ["cho", { "alias": "chordpro" }],
//!                 ["snack", { "grammar": "grammars/snack.sublime-syntax" }]],
//!   "headingIdsFunction": 1, "hooks": ["hooks/heading", "containers/note"],
//!   "languagesKey": "<the languages, with each grammar's text>" }
//! ```

use std::cell::RefCell;
use std::collections::HashSet;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::Value as J;

use crate::markdown::{Language, Languages, MarkdownOptions, Slugger};
use crate::Value;

/// A site's Markdown, ready to render with.
pub struct Setup {
    pub options: MarkdownOptions,
    /// The render hooks and containers the site has, by name (`hooks/heading`, `containers/note`).
    pub hooks: HashSet<String>,
    /// The same number for the same languages and grammars, in any build of this process: which
    /// highlighted fences one setup can take from another's.
    pub languages_id: u32,
}

thread_local! {
    /// Every `languagesKey` seen, so equal ones get one number.
    static KEYS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// The languages last loaded, by their key: a build with the same ones (the next rebuild while
    /// serving) takes its grammars instead of building the set of grammars again.
    static LOADED: RefCell<Option<(String, Languages)>> = const { RefCell::new(None) };
}

/// Builds a setup from Node's JSON. `function(n)` is the site's function number `n`.
pub fn setup(json: &str, root: &Path, function: &dyn Fn(u32) -> Value) -> Result<Setup> {
    let j: J = serde_json::from_str(json).context("ssqch's Markdown got options it can't read")?;
    let defaults = MarkdownOptions::default();
    let flag = |key: &str, default: bool| j.get(key).and_then(J::as_bool).unwrap_or(default);
    let mut o = MarkdownOptions {
        heading_ids: match j.get("headingIds").and_then(J::as_str) {
            None => None,
            Some(name) => Some(Slugger::parse(name).with_context(|| format!("markdown.headingIds: unknown slugger \"{}\"", name))?),
        },
        heading_attributes: flag("headingAttributes", defaults.heading_attributes),
        footnotes: flag("footnotes", defaults.footnotes),
        task_lists: flag("taskLists", defaults.task_lists),
        // `"fuzzy"`: bare domains and email addresses too.
        autolinks: j.get("autolinks").map(|v| v.as_bool().unwrap_or(v.as_str() == Some("fuzzy"))).unwrap_or(defaults.autolinks),
        fuzzy_links: j.get("autolinks").and_then(J::as_str) == Some("fuzzy"),
        breaks: flag("breaks", defaults.breaks),
        figures: flag("figures", defaults.figures),
        alerts: flag("alerts", defaults.alerts),
        containers: flag("containers", defaults.containers),
        definition_lists: flag("definitionLists", defaults.definition_lists),
        smart_punctuation: flag("smartPunctuation", defaults.smart_punctuation),
        indented_code: flag("indentedCode", defaults.indented_code),
        encode_urls: flag("encodeUrls", defaults.encode_urls),
        highlight: flag("highlight", defaults.highlight),
        highlight_css: j.get("highlightCss").and_then(J::as_str).map(String::from),
        ..defaults
    };
    if o.highlight && !cfg!(feature = "highlight") {
        bail!("markdown.highlight: this ssqch was built without the `highlight` feature");
    }
    for entry in j.get("languages").and_then(J::as_array).map(Vec::as_slice).unwrap_or_default() {
        let (Some(name), Some(spec)) = (entry.get(0).and_then(J::as_str), entry.get(1)) else { bail!("ssqch's Markdown got a language it can't read: {}", entry) };
        let language = if let Some(n) = spec.get("function").and_then(J::as_u64) {
            Language::Tokens(function(n as u32))
        } else if let Some(target) = spec.get("alias").and_then(J::as_str) {
            Language::Alias(target.to_string())
        } else if let Some(path) = spec.get("grammar").and_then(J::as_str) {
            Language::Grammar { path: path.to_string(), scope: None }
        } else {
            bail!("ssqch's Markdown got a language it can't read: {}", entry);
        };
        o.languages.set(name, language)?;
    }
    // `{ "names": { "keyword": "token keyword" }, "prism": true }`, checked and resolved by Node.
    if let Some(c) = j.get("highlightClasses").filter(|c| c.is_object()) {
        let names = c.get("names").and_then(J::as_object).map(|m| m.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect()).unwrap_or_default();
        o.highlight_classes = Some(crate::markdown::HighlightClasses { names, prism: c.get("prism").and_then(J::as_bool).unwrap_or(false) });
    }
    if let Some(n) = j.get("headingIdsFunction").and_then(J::as_u64) {
        o.slugger_fn = Some(function(n as u32));
    }
    let key = j.get("languagesKey").and_then(J::as_str).unwrap_or_default().to_string();
    load(&mut o.languages, &key, root)?;
    let hooks = j.get("hooks").and_then(J::as_array).map(|names| names.iter().filter_map(|n| n.as_str().map(String::from)).collect()).unwrap_or_default();
    Ok(Setup { options: o, hooks, languages_id: languages_id(&key) })
}

/// The number for the languages `key` in this process ([`Setup::languages_id`]).
pub fn languages_id(key: &str) -> u32 {
    KEYS.with(|keys| {
        let mut keys = keys.borrow_mut();
        match keys.iter().position(|k| k == key) {
            Some(i) => i as u32,
            None => {
                keys.push(key.to_string());
                (keys.len() - 1) as u32
            }
        }
    })
}

/// The languages' key for a number from [`languages_id`]: how the cache on disk names them.
pub fn languages_key(id: u32) -> String {
    KEYS.with(|keys| keys.borrow().get(id as usize).cloned().unwrap_or_default())
}

/// [`Languages::load`], or the grammars of the last load when its key is the same.
fn load(languages: &mut Languages, key: &str, root: &Path) -> Result<()> {
    if languages.is_empty() {
        return Ok(());
    }
    let reused = LOADED.with(|loaded| match &*loaded.borrow() {
        #[cfg(feature = "highlight")]
        Some((k, before)) if k == key => {
            languages.grammars = before.grammars.clone();
            for (name, language) in &mut languages.entries {
                if let (Language::Grammar { scope, .. }, Some(Language::Grammar { scope: was, .. })) = (language, before.get(name)) {
                    *scope = was.clone();
                }
            }
            true
        }
        _ => false,
    });
    if !reused {
        languages.load(root)?;
        LOADED.with(|loaded| *loaded.borrow_mut() = Some((key.to_string(), languages.clone())));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_function(_: u32) -> Value {
        Value::Undefined
    }

    #[test]
    fn options_from_node_are_0_7_options() {
        let s = setup(r#"{"headingIds":"blackfriday","smartPunctuation":true,"highlight":true,"highlightCss":null,"hooks":["hooks/heading"],"languages":[["cho",{"alias":"chordpro"}]],"languagesKey":"cho"}"#, Path::new("."), &no_function).unwrap();
        assert_eq!(s.options.heading_ids, Some(Slugger::Blackfriday));
        assert!(s.options.smart_punctuation && s.options.highlight && s.options.footnotes);
        assert_eq!(s.options.highlight_css, None);
        assert!(s.hooks.contains("hooks/heading"));
        let html = crate::markdown::render("# A -- B\n", &s.options, None).unwrap();
        assert_eq!(html, "<h1 id=\"a-b\">A – B</h1>\n");
        let again = setup(r#"{"headingIds":"github","languages":[["cho",{"alias":"chordpro"}]],"languagesKey":"cho"}"#, Path::new("."), &no_function).unwrap();
        assert_eq!(again.languages_id, s.languages_id, "the same languages share fences");
        let other = setup(r#"{"headingIds":null,"languagesKey":""}"#, Path::new("."), &no_function).unwrap();
        assert_ne!(other.languages_id, s.languages_id);
        assert_eq!(other.options.heading_ids, None);
    }

    #[test]
    fn aliases_are_checked_as_0_7_checks_them() {
        let err = setup(r#"{"languages":[["a",{"alias":"b"}],["b",{"alias":"a"}]],"languagesKey":"ab"}"#, Path::new("."), &no_function).err().unwrap();
        assert_eq!(format!("{:#}", err), "markdown.highlight.languages: these aliases go in a circle: a -> b -> a");
    }
}
