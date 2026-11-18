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
//!
//! The fences are kept on disk between processes too (`.cache/ssqch/highlight/fences.json`,
//! which `packages/ssqch/src/engines/markdown.ts` reads and writes): [`begin`] takes the file in
//! as a build starts, and [`save`] gives back the fences the build used, so the file holds one
//! build's fences and no more. A process's first build spends most of its highlighting time
//! loading syntect's grammars (the set of them, then each grammar's patterns the first time
//! it's used), and a fence found here never touches them, because it's looked up before
//! [`crate::syntax::highlight_in`] resolves its language. A fence with no highlighting (a
//! language without a grammar) is kept too: finding that out loads the set.
//!
//! On disk a fence's key is the one it has in memory, with its languages' key (`languagesKey`:
//! the site's languages, with each grammar's hash) in place of their number in this process.
//! The file names the highlighter that wrote it, a hash of what the `.wasm` is built from, so
//! a new highlighter never takes an old one's HTML; a file from another one, or one that can't
//! be read whole, is ignored and written again.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

use serde_json::Value as J;

use crate::markdown::{Language, Languages};

pub use crate::syntax::{marked_lines, supports, supports_in, CSS, KINDS};

type Key = (u32, String, String, Vec<usize>);

struct Fence {
    html: Option<String>,
    /// The last build ([`Fences::build`]) that used it.
    build: u32,
    /// The last build with the disk ([`Fences::session`]) that used it.
    session: u32,
    /// Whether the file on disk has it.
    on_disk: bool,
}

#[derive(Default)]
struct Fences {
    html: HashMap<Key, Fence>,
    /// One more for each build that used the cache.
    build: u32,
    used: bool,
    /// One more for each build that [`begin`]s with the disk; 0 before the first.
    session: u32,
    /// How many fences the file on disk has, or `usize::MAX` when it has to be written again.
    disk: usize,
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
        fences.html.retain(|_, fence| fence.build + 1 >= build);
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
        let (build, session) = (fences.build, fences.session);
        fences.used = true;
        fences.html.get_mut(&key).map(|fence| {
            fence.build = build;
            fence.session = session;
            fence.html.clone()
        })
    });
    if let Some(html) = hit {
        return html;
    }
    // Not borrowed while it runs: a grammar can't call out, but nothing here should depend on that.
    let html = crate::syntax::highlight_in(languages, lang, code, marked);
    FENCES.with(|fences| {
        let mut fences = fences.borrow_mut();
        let (build, session) = (fences.build, fences.session);
        fences.html.insert(key, Fence { html: html.clone(), build, session, on_disk: false });
    });
    html
}

/// A build starts with the disk. With `file` (the cache's text, empty when there's no file),
/// the disk is looked at afresh: the file's fences are taken in when it's `version`'s, and
/// otherwise it's to be written again. Without `file`, the disk is as this process last left it
/// (the next build while serving). Returns how many fences the file gave.
pub fn begin(version: &str, file: Option<&str>) -> usize {
    let found = file.map(|text| (text.is_empty(), read(version, text)));
    FENCES.with(|fences| {
        let mut fences = fences.borrow_mut();
        fences.session += 1;
        let Some((empty, entries)) = found else { return 0 };
        for fence in fences.html.values_mut() {
            fence.on_disk = false;
        }
        let Some(entries) = entries else {
            fences.disk = if empty { 0 } else { usize::MAX };
            return 0;
        };
        fences.disk = entries.len();
        let build = fences.build;
        for (key, html) in entries {
            // One that's here already is the same fence, from the same highlighter.
            fences.html.entry(key).or_insert(Fence { html, build, session: 0, on_disk: false }).on_disk = true;
        }
        fences.disk
    })
}

/// The file's new text: the fences this build used, sorted, so the same fences make the same
/// file. `None` when the file has those fences already, and an empty text when there are none
/// (no file).
pub fn save(version: &str) -> Option<String> {
    FENCES.with(|fences| {
        let mut fences = fences.borrow_mut();
        let session = fences.session;
        let mut used = 0;
        let mut new = false;
        for fence in fences.html.values() {
            if fence.session == session {
                used += 1;
                new |= !fence.on_disk;
            }
        }
        if !new && used == fences.disk {
            return None;
        }
        let mut kept: Vec<(String, &Key, &Option<String>)> = fences.html.iter().filter(|(_, f)| f.session == session).map(|(k, f)| (crate::options::languages_key(k.0), k, &f.html)).collect();
        kept.sort_by(|a, b| (&a.0, &a.1 .1, &a.1 .2, &a.1 .3).cmp(&(&b.0, &b.1 .1, &b.1 .2, &b.1 .3)));
        let text = if kept.is_empty() { String::new() } else { write(version, &kept) };
        let saved: HashSet<Key> = kept.into_iter().map(|(_, k, _)| k.clone()).collect();
        for (key, fence) in fences.html.iter_mut() {
            fence.on_disk = saved.contains(key);
        }
        fences.disk = used;
        Some(text)
    })
}

/// The file, a fence to a line:
///
/// ```json
/// {"highlighter":"<version>","languages":["<languagesKey>"],"fences":[
/// [0,"js","let a = 1;\n",[],"<span class=\"hl-keyword\">let</span> a = ..."],
/// [0,"nosuch","x\n",[],null]
/// ]}
/// ```
///
/// Each fence is its languages (a place in `languages`), language, code, marked lines and HTML
/// (`null` for none). `kept` is sorted by the languages' key first.
fn write(version: &str, kept: &[(String, &Key, &Option<String>)]) -> String {
    let quote = |s: &str| serde_json::to_string(s).unwrap_or_default();
    let mut languages: Vec<&str> = Vec::new();
    for (key, _, _) in kept {
        if languages.last() != Some(&key.as_str()) {
            languages.push(key);
        }
    }
    let mut out = format!("{{\"highlighter\":{},\"languages\":[{}],\"fences\":[", quote(version), languages.iter().map(|k| quote(k)).collect::<Vec<_>>().join(","));
    let mut place = 0;
    for (i, (key, (_, lang, code, marked), html)) in kept.iter().enumerate() {
        while languages[place] != key {
            place += 1;
        }
        out.push_str(if i == 0 { "\n" } else { ",\n" });
        let marked = marked.iter().map(usize::to_string).collect::<Vec<_>>().join(",");
        let html = html.as_deref().map_or_else(|| "null".to_string(), quote);
        out.push_str(&format!("[{},{},{},[{}],{}]", place, quote(lang), quote(code), marked, html));
    }
    out.push_str("\n]}\n");
    out
}

/// The fences in a file of `version`'s, or `None` for a file that isn't one (another
/// highlighter's, half a file, not JSON): all of it or nothing.
fn read(version: &str, text: &str) -> Option<Vec<(Key, Option<String>)>> {
    let j: J = serde_json::from_str(text).ok()?;
    if j.get("highlighter")?.as_str()? != version {
        return None;
    }
    let ids: Vec<u32> = j.get("languages")?.as_array()?.iter().map(|k| k.as_str().map(crate::options::languages_id)).collect::<Option<_>>()?;
    let mut out = Vec::new();
    for fence in j.get("fences")?.as_array()? {
        let [languages, lang, code, marked, html] = fence.as_array()?.as_slice() else { return None };
        let id = *ids.get(usize::try_from(languages.as_u64()?).ok()?)?;
        let marked = marked.as_array()?.iter().map(|n| n.as_u64().and_then(|n| usize::try_from(n).ok())).collect::<Option<Vec<_>>>()?;
        let html = match html {
            J::Null => None,
            J::String(s) => Some(s.clone()),
            _ => return None,
        };
        out.push(((id, lang.as_str()?.to_string(), code.as_str()?.to_string(), marked), html));
    }
    Some(out)
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

    #[test]
    fn fences_go_to_disk_and_come_back() {
        let id = crate::options::languages_id("[]");
        let languages = Languages::default();
        assert_eq!(begin("v1", Some("")), 0);
        assert_eq!(save("v1"), None, "no fences and no file: nothing to write");
        begin("v1", None);
        let html = caching(id, || highlight_in(&languages, "js", "let a = 1;\n", &[]));
        caching(id, || highlight_in(&languages, "js", "let a = 1;\n", &[1]));
        caching(id, || highlight_in(&languages, "nosuch", "x\n", &[]));
        let file = save("v1").unwrap();
        assert!(file.starts_with("{\"highlighter\":\"v1\",\"languages\":[\"[]\"],\"fences\":[\n[0,\"js\",\"let a = 1;\\n\",[],\"<span"), "{}", file);
        assert!(file.contains("\n[0,\"nosuch\",\"x\\n\",[],null]"), "{}", file);

        // The same fences again: the file stays as it is.
        begin("v1", None);
        caching(id, || highlight_in(&languages, "js", "let a = 1;\n", &[]));
        caching(id, || highlight_in(&languages, "js", "let a = 1;\n", &[1]));
        caching(id, || highlight_in(&languages, "nosuch", "x\n", &[]));
        assert_eq!(save("v1"), None);

        // Another process (each thread has its own cache) takes them all in, and gives the same
        // HTML without highlighting anything: using them all leaves the file as it is.
        let again = file.clone();
        std::thread::spawn(move || {
            let id = crate::options::languages_id("[]");
            assert_eq!(begin("v1", Some(&again)), 3);
            assert_eq!(cached(), 3);
            assert_eq!(caching(id, || highlight_in(&Languages::default(), "js", "let a = 1;\n", &[])), html);
            assert!(caching(id, || highlight_in(&Languages::default(), "js", "let a = 1;\n", &[1])).unwrap().contains("class=\"line highlighted\""));
            assert_eq!(caching(id, || highlight_in(&Languages::default(), "nosuch", "x\n", &[])), None);
            assert_eq!(cached(), 3);
            assert_eq!(save("v1"), None);
        })
        .join()
        .unwrap();

        // A build that uses fewer drops the rest from the file.
        begin("v1", None);
        caching(id, || highlight_in(&languages, "nosuch", "x\n", &[]));
        let fewer = save("v1").unwrap();
        assert_eq!(fewer, "{\"highlighter\":\"v1\",\"languages\":[\"[]\"],\"fences\":[\n[0,\"nosuch\",\"x\\n\",[],null]\n]}\n");
        // And one that uses none leaves no file.
        begin("v1", None);
        assert_eq!(save("v1").as_deref(), Some(""));
    }

    #[test]
    fn a_file_that_isnt_this_highlighters_is_ignored_and_written_again() {
        let id = crate::options::languages_id("[]");
        let good = "{\"highlighter\":\"v1\",\"languages\":[\"[]\"],\"fences\":[\n[0,\"js\",\"a\\n\",[],\"made up\"]\n]}\n";
        for bad in ["{\"highlighter\":\"v0\",\"languages\":[\"[]\"],\"fences\":[[0,\"js\",\"a\\n\",[],\"made up\"]]}", &good[..good.len() / 2], "not json", "{\"highlighter\":\"v1\",\"languages\":[\"[]\"],\"fences\":[[1,\"js\",\"a\\n\",[],\"x\"]]}", "{\"highlighter\":\"v1\",\"languages\":[\"[]\"],\"fences\":[[0,\"js\",\"a\\n\",[],7]]}"] {
            let bad = bad.to_string();
            std::thread::spawn(move || {
                assert_eq!(begin("v1", Some(&bad)), 0, "{}", bad);
                let html = caching(id, || highlight_in(&Languages::default(), "js", "a\n", &[]));
                assert_ne!(html.as_deref(), Some("made up"));
                let file = save("v1").unwrap();
                assert!(file.starts_with("{\"highlighter\":\"v1\",") && !file.contains("made up"), "written again: {}", file);
                // Unused, a bad file goes too.
                begin("v1", Some(&bad));
                assert_eq!(save("v1").as_deref(), Some(""));
            })
            .join()
            .unwrap();
        }
        // A good one is taken as it is (so a cache's HTML is what's written: it's the highlighter's own).
        std::thread::spawn(move || {
            assert_eq!(begin("v1", Some(good)), 1);
            assert_eq!(caching(id, || highlight_in(&Languages::default(), "js", "a\n", &[])).as_deref(), Some("made up"));
            assert_eq!(save("v1"), None);
        })
        .join()
        .unwrap();
    }
}
