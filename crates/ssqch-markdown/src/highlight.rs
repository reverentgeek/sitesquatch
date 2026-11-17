//! The highlighter `markdown.rs` calls: 0.7's ([`crate::syntax`]), with a cache of highlighted
//! fences in front of it.
//!
//! syntect is most of what Markdown costs (a tenth of a second of the blog on one thread), and
//! while serving, a rebuild highlights the same fences again. So a fence's HTML is kept by its
//! language, code and marked lines, and by the site's languages: the same languages and
//! grammars share fences across builds in one process (see [`crate::options::Setup`]), and a
//! change to them starts afresh. A fence that a build didn't use is dropped at the start of the
//! build after it, so the cache holds about one build's fences. A site's own highlighter (a
//! function) isn't cached: it can give another answer, and its warnings name the page.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use crate::markdown::{Language, Languages};

pub use crate::syntax::{marked_lines, supports, supports_in, CSS, KINDS};

type Key = (u32, String, String, Vec<usize>);

#[derive(Default)]
struct Fences {
    html: HashMap<Key, (Option<String>, u32)>,
    /// One more for each build that used the cache.
    build: u32,
    used: bool,
}

thread_local! {
    /// The languages of the setup rendering now, while one is: fences are cached only then.
    static LANGUAGES: Cell<Option<u32>> = const { Cell::new(None) };
    static FENCES: RefCell<Fences> = RefCell::new(Fences::default());
}

/// Runs `f` with fences cached under the languages `id` ([`crate::options::Setup::languages_id`]).
pub fn caching<T>(id: u32, f: impl FnOnce() -> T) -> T {
    let before = LANGUAGES.replace(Some(id));
    let out = f();
    LANGUAGES.set(before);
    out
}

/// A build starts: drop the fences the last one didn't use.
pub fn next_build() {
    FENCES.with(|fences| {
        let mut fences = fences.borrow_mut();
        if !fences.used {
            return;
        }
        fences.used = false;
        fences.build += 1;
        let build = fences.build;
        fences.html.retain(|_, (_, used)| *used + 1 >= build);
    });
}

/// How many fences are kept, for tests.
pub fn cached() -> usize {
    FENCES.with(|fences| fences.borrow().html.len())
}

/// [`crate::syntax::highlight_in`], from the cache when it can be.
pub fn highlight_in(languages: &Languages, lang: &str, code: &str, marked: &[usize]) -> Option<String> {
    let Some(id) = LANGUAGES.get().filter(|_| !site_function(languages, lang)) else {
        return crate::syntax::highlight_in(languages, lang, code, marked);
    };
    let key: Key = (id, lang.to_string(), code.to_string(), marked.to_vec());
    let hit = FENCES.with(|fences| {
        let mut fences = fences.borrow_mut();
        let build = fences.build;
        fences.used = true;
        fences.html.get_mut(&key).map(|(html, used)| {
            *used = build;
            html.clone()
        })
    });
    if let Some(html) = hit {
        return html;
    }
    // Not borrowed while it runs: a grammar can't call out, but nothing here should depend on that.
    let html = crate::syntax::highlight_in(languages, lang, code, marked);
    FENCES.with(|fences| {
        let mut fences = fences.borrow_mut();
        let build = fences.build;
        fences.html.insert(key, (html.clone(), build));
    });
    html
}

/// Whether `lang` is one of the site's functions, through its aliases, as `resolve` finds it.
fn site_function(languages: &Languages, lang: &str) -> bool {
    let mut name = lang.to_ascii_lowercase();
    for _ in 0..16 {
        match languages.entries.iter().find(|(n, _)| *n == name) {
            Some((_, Language::Tokens(_))) => return true,
            Some((_, Language::Alias(target))) => name = target.clone(),
            _ => return false,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Value;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn fences_are_kept_for_the_next_build_and_site_functions_are_not() {
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let mut languages = Languages::default();
        languages.set("trail", Language::Tokens(Value::func(move |args| {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(Value::array(vec![Value::array(vec![args[0].clone(), Value::from("keyword")])]))
        }))).unwrap();
        languages.set("path", Language::Alias("trail".into())).unwrap();
        let first = caching(7, || highlight_in(&languages, "js", "let a = 1;\n", &[]));
        assert!(first.as_deref().unwrap().contains("hl-keyword"));
        assert_eq!(cached(), 1);
        assert_eq!(caching(7, || highlight_in(&languages, "js", "let a = 1;\n", &[])), first);
        assert_eq!(cached(), 1, "the same fence is one entry");
        caching(7, || highlight_in(&languages, "js", "let a = 1;\n", &[2]));
        caching(8, || highlight_in(&languages, "js", "let a = 1;\n", &[]));
        assert_eq!(cached(), 3, "marked lines and other languages are other fences");
        for _ in 0..2 {
            caching(7, || highlight_in(&languages, "PATH", "x", &[]));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 2, "a site's function runs every time");
        assert_eq!(cached(), 3);
        assert!(highlight_in(&languages, "rust", "fn a() {}", &[]).is_some());
        assert_eq!(cached(), 3, "nothing is kept outside a setup's render");

        // The next build uses one of them; the one after drops the rest.
        next_build();
        caching(7, || highlight_in(&languages, "js", "let a = 1;\n", &[]));
        assert_eq!(cached(), 3);
        next_build();
        assert_eq!(cached(), 1);
        next_build();
        next_build();
        assert_eq!(cached(), 1, "a build that didn't render drops nothing");
    }
}
