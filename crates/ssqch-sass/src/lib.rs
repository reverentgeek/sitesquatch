//! ssqch's Sass, for the Node build (0.8): [grass](https://github.com/connorskees/grass) at the
//! version 0.7's `plugins/sass` compiled with, so a stylesheet comes out as 0.7 wrote it.
//!
//! Built for `wasm32-wasip1`, this crate is `packages/ssqch/wasm/sass.wasm`, which
//! `packages/ssqch/src/modules/sass.ts` loads. grass reads files through its [`grass::Fs`];
//! here that's Node, through the imports in [`wasm`], so the wasm has no file system of its own
//! and Node knows every file a stylesheet read (`ssqch serve` rebuilds when one changes).
//! Paths are as Node gives them: from the project root for the site's own files, with `/`.
//!
//! Natively the crate builds for `cargo test` and clippy, without the wasm exports.

use serde::Deserialize;

/// How the CSS is written.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    Expanded,
    Compressed,
}

/// What Node asks for, as JSON: `{ "style": "compressed", "loadPaths": ["node_modules"] }`.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub style: Style,
    #[serde(default)]
    pub load_paths: Vec<String>,
}

/// The CSS for the stylesheet at `path`, or grass's error as 0.7 printed it.
pub fn compile(path: &str, options: &Options, fs: &dyn grass::Fs) -> Result<String, String> {
    let mut grass_options = grass::Options::default().fs(fs).style(match options.style {
        Style::Compressed => grass::OutputStyle::Compressed,
        Style::Expanded => grass::OutputStyle::Expanded,
    });
    for dir in &options.load_paths {
        grass_options = grass_options.load_path(dir);
    }
    let css = grass::from_path(path, &grass_options).map_err(|e| e.to_string())?;
    Ok(match options.style {
        Style::Compressed => without_last_semicolons(&css),
        Style::Expanded => css,
    })
}

/// Compressed CSS without a `;` right before a `}`. grass leaves one when a comment followed the
/// last declaration (`-webkit-text-size-adjust: 100%; /* 2 */` in normalize.css: 12 rules on
/// opensource.guide), where Dart Sass and libsass don't. Strings are passed over as they are.
fn without_last_semicolons(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut chars = css.chars().peekable();
    while let Some(c) = chars.next() {
        if let Some(q) = quote {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
        } else if c == ';' && chars.peek() == Some(&'}') {
            continue;
        }
        out.push(c);
    }
    out
}

/// What Node calls, and what the wasm calls back. `packages/ssqch/src/modules/sass.ts` is the
/// other side; the two change together.
///
/// Strings go in through a buffer from [`sass_alloc`], which the call frees. An answer is left
/// for [`sass_result_ptr`] and [`sass_result_len`]. Statuses: 0 is the CSS, 1 is an error.
///
/// The calls back, in the `ssqch` import module: `is_file(path)` and `is_dir(path)` answer 1 or
/// 0; `read(path, out)` and `canonicalize(path, out)` leave their answer in a buffer from
/// `sass_alloc`, whose address and length Node writes at `out`, and answer 0, or 1 when the
/// answer is an error's message.
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use std::cell::RefCell;
    use std::io;
    use std::path::{Path, PathBuf};

    const DONE: u32 = 0;
    const ERROR: u32 = 1;

    /// What Node checks the file against (`packages/ssqch/scripts/wasm-inputs.test.ts`): a hash
    /// of the Rust this was built from, which `packages/ssqch/scripts/build-wasm.ts` passes in.
    const INPUTS: &str = match option_env!("SSQCH_SASS_INPUTS") {
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
    #[unsafe(link_section = "ssqch_sass_inputs")]
    static INPUTS_SECTION: [u8; INPUTS.len()] = bytes(INPUTS);

    #[link(wasm_import_module = "ssqch")]
    extern "C" {
        fn is_file(path: *const u8, len: usize) -> u32;
        fn is_dir(path: *const u8, len: usize) -> u32;
        fn read(path: *const u8, len: usize, out: *mut [u32; 2]) -> u32;
        fn canonicalize(path: *const u8, len: usize, out: *mut [u32; 2]) -> u32;
    }

    thread_local! {
        static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static PANIC: RefCell<String> = const { RefCell::new(String::new()) };
    }

    fn take(ptr: *mut u8, len: usize) -> Box<[u8]> {
        if len == 0 {
            return Box::default();
        }
        // SAFETY: Node passes back a buffer `sass_alloc` made with exactly this length, once.
        unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) }
    }

    fn text(path: &Path) -> &str {
        // Every path here came from Node as text, or was joined from such paths.
        path.to_str().unwrap_or("")
    }

    /// A call back that answers with bytes: the bytes, or the error's message.
    fn answer(call: unsafe extern "C" fn(*const u8, usize, *mut [u32; 2]) -> u32, path: &Path) -> Result<Box<[u8]>, String> {
        let path = text(path);
        let mut out = [0u32; 2];
        // SAFETY: the pointers are to `path` and `out`, which outlive the call.
        let status = unsafe { call(path.as_ptr(), path.len(), &mut out) };
        let bytes = take(out[0] as usize as *mut u8, out[1] as usize);
        if status == DONE {
            Ok(bytes)
        } else {
            Err(String::from_utf8_lossy(&bytes).into_owned())
        }
    }

    /// The files are Node's.
    #[derive(Debug)]
    struct HostFs;

    impl grass::Fs for HostFs {
        fn is_file(&self, path: &Path) -> bool {
            let path = text(path);
            // SAFETY: the pointer is to `path`, which outlives the call.
            unsafe { is_file(path.as_ptr(), path.len()) == 1 }
        }

        fn is_dir(&self, path: &Path) -> bool {
            let path = text(path);
            // SAFETY: the pointer is to `path`, which outlives the call.
            unsafe { is_dir(path.as_ptr(), path.len()) == 1 }
        }

        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            answer(read, path).map(Vec::from).map_err(io::Error::other)
        }

        fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
            let bytes = answer(canonicalize, path).map_err(io::Error::other)?;
            Ok(PathBuf::from(String::from_utf8_lossy(&bytes).into_owned()))
        }
    }

    fn keep_panics() {
        std::panic::set_hook(Box::new(|info| {
            PANIC.with(|p| *p.borrow_mut() = info.to_string());
        }));
    }

    /// A buffer of `len` bytes for Node to fill, which the call it's passed to frees.
    #[no_mangle]
    pub extern "C" fn sass_alloc(len: usize) -> *mut u8 {
        if len == 0 {
            return std::ptr::NonNull::<u8>::dangling().as_ptr();
        }
        Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
    }

    #[no_mangle]
    pub extern "C" fn sass_result_ptr() -> *const u8 {
        RESULT.with(|r| r.borrow().as_ptr())
    }

    #[no_mangle]
    pub extern "C" fn sass_result_len() -> usize {
        RESULT.with(|r| r.borrow().len())
    }

    /// The message of the panic that trapped the last call, as the result.
    #[no_mangle]
    pub extern "C" fn sass_panic() {
        let message = PANIC.with(|p| p.borrow().clone());
        RESULT.with(|r| *r.borrow_mut() = message.into_bytes());
    }

    /// Compiles the stylesheet: `ptr` holds its path, then the options as JSON.
    #[no_mangle]
    pub extern "C" fn sass_compile(ptr: *mut u8, path_len: usize, options_len: usize) -> u32 {
        keep_panics();
        let input = take(ptr, path_len + options_len);
        let (path, options) = input.split_at(path_len);
        let result = (|| {
            let path = std::str::from_utf8(path).map_err(|e| e.to_string())?;
            let options: super::Options = serde_json::from_slice(options).map_err(|e| format!("ssqch's Sass got options it doesn't know: {}", e))?;
            super::compile(path, &options, &HostFs)
        })();
        let (status, text) = match result {
            Ok(css) => (DONE, css),
            Err(e) => (ERROR, e),
        };
        RESULT.with(|r| *r.borrow_mut() = text.into_bytes());
        status
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io;
    use std::path::{Path, PathBuf};

    #[derive(Debug, Default)]
    struct Files(HashMap<PathBuf, &'static str>);

    impl grass::Fs for Files {
        fn is_file(&self, path: &Path) -> bool {
            self.0.contains_key(path)
        }
        fn is_dir(&self, path: &Path) -> bool {
            self.0.keys().any(|f| f.starts_with(path) && f != path)
        }
        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            self.0.get(path).map(|s| s.as_bytes().to_vec()).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "not found"))
        }
    }

    fn files(list: &[(&str, &'static str)]) -> Files {
        Files(list.iter().map(|(p, s)| (PathBuf::from(p), *s)).collect())
    }

    #[test]
    fn compiles_with_partials_and_load_paths() {
        let fs = files(&[
            ("styles/app.scss", "@use \"colors\";\n@use \"trail\";\nbody { color: colors.$pine; a { color: red; } }\n"),
            ("styles/_colors.scss", "$pine: #01796f;\n"),
            ("vendor/_trail.scss", ".trail { margin: 0 auto; }\n"),
            ("print.sass", "body\n  font-size: 12pt\n"),
        ]);
        let compressed = Options { style: Style::Compressed, load_paths: vec!["vendor".into()] };
        assert_eq!(compile("styles/app.scss", &compressed, &fs).unwrap(), ".trail{margin:0 auto}body{color:#01796f}body a{color:red}");
        let expanded = Options { style: Style::Expanded, load_paths: vec![] };
        assert_eq!(compile("print.sass", &expanded, &fs).unwrap(), "body {\n  font-size: 12pt;\n}\n");
    }

    #[test]
    fn no_semicolon_before_a_closing_brace() {
        let fs = files(&[("a.scss", "html {\n  line-height: 1.15; /* 1 */\n  -webkit-text-size-adjust: 100%; /* 2 */\n}\nb::before { content: \";}\"; }\n")]);
        let compressed = Options { style: Style::Compressed, load_paths: vec![] };
        assert_eq!(compile("a.scss", &compressed, &fs).unwrap(), "html{line-height:1.15;-webkit-text-size-adjust:100%}b::before{content:\";}\"}");
    }

    #[test]
    fn an_error_names_the_file_and_line() {
        let fs = files(&[("styles/blog.scss", ".post { color: $missing; }")]);
        let e = compile("styles/blog.scss", &Options { style: Style::Expanded, load_paths: vec![] }, &fs).unwrap_err();
        assert_eq!(e, "Error: Undefined variable.\n  ╷\n1 │ .post { color: $missing; }\n  │                ^^^^^^^^\n  ╵\n./styles/blog.scss:1:16\n");
    }
}
