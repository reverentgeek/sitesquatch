//! What Node calls, and what the wasm calls back. `packages/ssqch/src/engines/markdown.ts` is
//! the other side; the two change together.
//!
//! Strings go in through buffers Node gets from [`md_alloc`] and fills: each call takes its
//! buffer back and frees it. An answer is left for [`md_result_ptr`] and [`md_result_len`],
//! which Node reads as soon as the call returns. Calls nest (a render hook's template can call
//! `markdown()`, which renders again while the first render waits), so nothing here holds a
//! buffer or a borrow across a call back into Node.
//!
//! Statuses: 0 is done (the result is the answer), 1 is an error (the result is its message),
//! 2 is "nothing" (a language without a highlighter).
//!
//! The calls back, in the `ssqch` import module, each leave Node's answer in a buffer from
//! `md_alloc`, whose address and length Node writes at `out`:
//! - `hook(name, key, value, out)`: render the hook template `name` (`hooks/heading`) with
//!   `value` (JSON) in its data as `key`;
//! - `call(function, args, out)`: call the site's function number `function` with `args` (a JSON
//!   array), answering JSON as [`crate::json::from_text`] reads it;
//! - `warn(code, message, file)`: a warning for the build.

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;

use anyhow::{anyhow, Result};

use crate::diagnostics::Diagnostic;
use crate::highlight;
use crate::markdown::{self, Hooks};
use crate::options::Setup;
use crate::Value;

const DONE: u32 = 0;
const ERROR: u32 = 1;
const NOTHING: u32 = 2;

/// What Node checks the file against (`packages/ssqch/scripts/wasm-inputs.test.ts`): a hash of
/// the Rust this was built from, which `packages/ssqch/scripts/build-wasm.ts` passes in.
const INPUTS: &str = match option_env!("SSQCH_MARKDOWN_INPUTS") {
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
#[link_section = "ssqch_markdown_inputs"]
static INPUTS_SECTION: [u8; INPUTS.len()] = bytes(INPUTS);

#[link(wasm_import_module = "ssqch")]
extern "C" {
    fn hook(name: *const u8, name_len: usize, key: *const u8, key_len: usize, value: *const u8, value_len: usize, out: *mut [u32; 2]) -> u32;
    fn call(function: u32, args: *const u8, args_len: usize, out: *mut [u32; 2]) -> u32;
    #[link_name = "warn"]
    fn host_warn(code: *const u8, code_len: usize, message: *const u8, message_len: usize, file: *const u8, file_len: usize);
}

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SETUPS: RefCell<Vec<Option<Rc<Setup>>>> = const { RefCell::new(Vec::new()) };
    static PANIC: RefCell<String> = const { RefCell::new(String::new()) };
    static HOOKED: Cell<bool> = const { Cell::new(false) };
}

fn answer(status: u32, text: String) -> u32 {
    RESULT.with(|r| *r.borrow_mut() = text.into_bytes());
    status
}

fn done(result: Result<String>) -> u32 {
    match result {
        Ok(text) => answer(DONE, text),
        Err(e) => answer(ERROR, format!("{:#}", e)),
    }
}

/// Takes back a buffer from [`md_alloc`].
fn take(ptr: *mut u8, len: usize) -> Box<[u8]> {
    if len == 0 {
        return Box::default();
    }
    // SAFETY: Node passes back a buffer `md_alloc` made with exactly this length, once.
    unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) }
}

fn text(bytes: &[u8]) -> Result<&str> {
    std::str::from_utf8(bytes).map_err(|e| anyhow!("ssqch's Markdown got text that isn't UTF-8: {}", e))
}

/// Node's answer to a call back: the text, or its error.
fn reply(status: u32, out: [u32; 2]) -> Result<String> {
    let bytes = take(out[0] as *mut u8, out[1] as usize);
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if status == DONE {
        Ok(text)
    } else {
        Err(anyhow!(text))
    }
}

fn setup(handle: u32) -> Result<Rc<Setup>> {
    SETUPS.with(|s| s.borrow().get(handle as usize).cloned().flatten()).ok_or_else(|| anyhow!("ssqch's Markdown has no setup {}", handle))
}

/// A site's function, called in Node.
fn function(n: u32) -> Value {
    Value::func(move |args| {
        let json = crate::json::to_text(&Value::array(args.to_vec()));
        let mut out = [0u32; 2];
        // SAFETY: the pointers are to `json` and `out`, which outlive the call.
        let status = unsafe { call(n, json.as_ptr(), json.len(), &mut out) };
        crate::json::from_text(&reply(status, out)?)
    })
}

/// The site's render hooks and containers, rendered in Node with the page's data.
struct HostHooks<'a>(&'a Setup);

impl Hooks for HostHooks<'_> {
    fn has(&self, name: &str) -> bool {
        self.0.hooks.contains(name)
    }

    fn render(&self, name: &str, key: &str, value: Value) -> Result<String> {
        let json = crate::json::to_text(&value);
        let mut out = [0u32; 2];
        // SAFETY: the pointers are to `name`, `key`, `json` and `out`, which outlive the call.
        let status = unsafe { hook(name.as_ptr(), name.len(), key.as_ptr(), key.len(), json.as_ptr(), json.len(), &mut out) };
        reply(status, out)
    }
}

pub(crate) fn warn(d: &Diagnostic) {
    let file = d.file.as_deref().unwrap_or("");
    // SAFETY: the pointers are to strings that outlive the call.
    unsafe { host_warn(d.code.as_ptr(), d.code.len(), d.message.as_ptr(), d.message.len(), file.as_ptr(), file.len()) }
}

/// Keeps a panic's message for [`md_panic`]: in the wasm a panic ends the call with a trap, and
/// Node starts a fresh instance after it.
fn keep_panics() {
    if HOOKED.replace(true) {
        return;
    }
    std::panic::set_hook(Box::new(|info| {
        let message = match info.payload().downcast_ref::<&str>() {
            Some(s) => s.to_string(),
            None => info.payload().downcast_ref::<String>().cloned().unwrap_or_else(|| "a panic".into()),
        };
        let at = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        PANIC.with(|p| *p.borrow_mut() = format!("{}{}", message, at));
    }));
}

/// A buffer of `len` bytes for Node to fill, which the call it's passed to frees.
#[no_mangle]
pub extern "C" fn md_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::<u8>::dangling().as_ptr();
    }
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// Frees a buffer from [`md_alloc`] that wasn't passed to a call.
#[no_mangle]
pub extern "C" fn md_free(ptr: *mut u8, len: usize) {
    drop(take(ptr, len));
}

#[no_mangle]
pub extern "C" fn md_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn md_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// The message of the panic that trapped the last call.
#[no_mangle]
pub extern "C" fn md_panic() -> u32 {
    let message = PANIC.with(|p| p.borrow().clone());
    answer(DONE, message)
}

/// A setup from the options in `ptr` (JSON): its number, or -1 with the error as the result.
/// The grammars it names are read from the files Node gave the instance, from `/`.
#[no_mangle]
pub extern "C" fn md_new(ptr: *mut u8, len: usize) -> i32 {
    keep_panics();
    highlight::next_build();
    let buffer = take(ptr, len);
    let made = text(&buffer).and_then(|json| crate::options::setup(json, Path::new("/"), &function));
    match made {
        Ok(setup) => SETUPS.with(|s| {
            let mut s = s.borrow_mut();
            let handle = match s.iter().position(Option::is_none) {
                Some(free) => free,
                None => {
                    s.push(None);
                    s.len() - 1
                }
            };
            s[handle] = Some(Rc::new(setup));
            handle as i32
        }),
        Err(e) => {
            answer(ERROR, format!("{:#}", e));
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn md_drop(handle: u32) {
    let dropped = SETUPS.with(|s| s.borrow_mut().get_mut(handle as usize).and_then(Option::take));
    drop(dropped);
}

/// Renders Markdown. The buffer is the source, then the page warnings name (from the project
/// root), `source_len` and `page_len` bytes. `flags`: 1 drops the `<p>` around a single
/// paragraph (`markdown(text, "inline")`), 2 runs the site's render hooks.
#[no_mangle]
pub extern "C" fn md_render(handle: u32, ptr: *mut u8, source_len: usize, page_len: usize, flags: u32) -> u32 {
    let buffer = take(ptr, source_len + page_len);
    done((|| {
        let setup = setup(handle)?;
        let source = text(&buffer[..source_len])?;
        let page = text(&buffer[source_len..])?;
        let _page = (!page.is_empty()).then(|| markdown::rendering(page));
        let hooks = HostHooks(&setup);
        let hooks = (flags & 2 != 0 && !setup.hooks.is_empty()).then_some(&hooks as &dyn Hooks);
        highlight::caching(setup.languages_id, || if flags & 1 != 0 { markdown::render_inline(source, &setup.options, hooks) } else { markdown::render(source, &setup.options, hooks) })
    })())
}

/// `highlight(code, lang)`: the buffer is the code, the language and the page, each `*_len`
/// bytes. Nothing (status 2) for a language without a highlighter.
#[no_mangle]
pub extern "C" fn md_highlight(handle: u32, ptr: *mut u8, code_len: usize, lang_len: usize, page_len: usize) -> u32 {
    let buffer = take(ptr, code_len + lang_len + page_len);
    let found = (|| -> Result<Option<String>> {
        let setup = setup(handle)?;
        let code = text(&buffer[..code_len])?;
        let lang = text(&buffer[code_len..code_len + lang_len])?;
        let page = text(&buffer[code_len + lang_len..])?;
        let _page = (!page.is_empty()).then(|| markdown::rendering(page));
        let html = highlight::caching(setup.languages_id, || highlight::highlight_in(&setup.options.languages, lang, code, &[]));
        Ok(match &setup.options.highlight_classes {
            Some(classes) => html.map(|h| classes.apply(&h)),
            None => html,
        })
    })();
    match found {
        Ok(Some(html)) => answer(DONE, html),
        Ok(None) => answer(NOTHING, String::new()),
        Err(e) => answer(ERROR, format!("{:#}", e)),
    }
}

/// A build starts with the cache of highlighted fences on disk ([`highlight::begin`]). The buffer
/// is the highlighter's version, then the file's text, `version_len` and `file_len` bytes.
/// `flags`: 1 when Node read the file for this (its text is empty when there's none); without
/// it, the disk is as this instance last left it. The result is how many fences the file gave.
#[no_mangle]
pub extern "C" fn md_fences_begin(ptr: *mut u8, version_len: usize, file_len: usize, flags: u32) -> u32 {
    let buffer = take(ptr, version_len + file_len);
    let version = String::from_utf8_lossy(&buffer[..version_len]);
    // A file that isn't UTF-8 is one that can't be read, as one that isn't JSON.
    let file = (flags & 1 != 0).then(|| std::str::from_utf8(&buffer[version_len..]).unwrap_or("\0"));
    answer(DONE, highlight::begin(&version, file).to_string())
}

/// The cache file's new text after a build ([`highlight::save`]), for the version in the buffer:
/// nothing (status 2) when the file is as it should be, and an empty text for no file.
#[no_mangle]
pub extern "C" fn md_fences_save(ptr: *mut u8, len: usize) -> u32 {
    let buffer = take(ptr, len);
    match highlight::save(&String::from_utf8_lossy(&buffer)) {
        Some(text) => answer(DONE, text),
        None => answer(NOTHING, String::new()),
    }
}

/// The highlighting stylesheet.
#[no_mangle]
pub extern "C" fn md_css() -> u32 {
    answer(DONE, highlight::CSS.to_string())
}
