//! Write ssqch plugins in Rust.
//!
//! A plugin is a type that implements [`Plugin`], and one line, `export!(MyPlugin);`. Built for
//! `wasm32-wasip1`, the crate is one `.wasm` file that ssqch runs in Node's WebAssembly, the same
//! file on every platform. A plugin can provide three kinds of hooks:
//!
//! - a **transform**, which rewrites every HTML page the build writes;
//! - **filters**, functions every template language can call (`{{ readingTime(content) }}`);
//! - **engines**, template languages of its own, by file extension (`.trail`).
//!
//! The author writes no `unsafe` and sees no pointer: [`export!`] writes the exports ssqch calls.
//!
//! ```
//! use ssqch_plugin::{export, Hooks, Page, Plugin, Value};
//!
//! #[derive(serde::Deserialize, Default)]
//! #[serde(default, deny_unknown_fields, rename_all = "camelCase")]
//! pub struct Options {
//!     shout: bool,
//! }
//!
//! pub struct Hello {
//!     options: Options,
//! }
//!
//! impl Plugin for Hello {
//!     type Options = Options;
//!     const NAME: &'static str = "hello";
//!     const HOOKS: Hooks = Hooks { transform: true, filters: &["greet"], ..Hooks::NONE };
//!
//!     fn new(options: Options) -> Result<Self, String> {
//!         Ok(Hello { options })
//!     }
//!
//!     fn transform(&self, html: &str, _page: &Page) -> Result<Option<String>, String> {
//!         // `None`: the page is unchanged, and nothing is copied back.
//!         Ok(self.options.shout.then(|| html.to_uppercase()))
//!     }
//!
//!     fn filter(&self, name: &str, args: &[Value]) -> Result<Value, String> {
//!         match name {
//!             "greet" => Ok(Value::from(format!("Howdy, {}", args.first().and_then(Value::as_str).unwrap_or("ranger")))),
//!             _ => Err(format!("no filter named {name}")),
//!         }
//!     }
//! }
//!
//! export!(Hello);
//!
//! // A plugin is tested as plain Rust.
//! let hello = ssqch_plugin::create::<Hello>(r#"{ "shout": true }"#).unwrap();
//! assert_eq!(hello.transform("<p>hi</p>", &Page::default()).unwrap().as_deref(), Some("<P>HI</P>"));
//! assert_eq!(hello.filter("greet", &[Value::from("Sasquatch")]).unwrap(), "Howdy, Sasquatch");
//! ```
//!
//! Build it with `cargo build --release --target wasm32-wasip1` (`rustup target add
//! wasm32-wasip1` first), and ship the `.wasm` file in an npm package whose default export
//! returns `{ name, rust: { wasm, options } }`; this crate's README shows the package.
//!
//! The rules, for ABI v1:
//!
//! - A plugin sees one page at a time. It has no files, network or environment, and a hook
//!   shouldn't keep state between calls: ssqch may start the plugin again (after a panic, or in
//!   another worker), each time with a fresh [`Plugin::new`].
//! - Errors are strings. ssqch says which plugin and which page; the message says what went
//!   wrong (`readingTime expects text, got a number`).
//! - A panic is an error too: the build fails with the panic's message and place, and the next
//!   call gets a fresh instance.
//! - Values are JSON ([`Value`] is `serde_json`'s, keeping objects' keys in order): a template's
//!   dates arrive as ISO 8601 strings, `undefined` as `null`, and functions not at all.

use serde::de::DeserializeOwned;
pub use serde_json::Value;

/// The plugin ABI this SDK builds. ssqch refuses a plugin built for one it doesn't know.
pub const ABI_VERSION: u32 = 1;
/// This SDK's version, recorded in each plugin's manifest.
pub const SDK_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The hooks a plugin provides. ssqch reads them from the plugin's manifest without running it,
/// and calls only these.
#[derive(Clone, Copy, Debug)]
pub struct Hooks {
    /// Call [`Plugin::transform`] on every HTML page the build writes.
    pub transform: bool,
    /// Filters [`Plugin::filter`] answers, by the name templates call them with (`readingTime`).
    pub filters: &'static [&'static str],
    /// File extensions [`Plugin::render`] renders, without the dot (`trail`). A site lists them
    /// in `templateFormats` for its files to be pages.
    pub engines: &'static [&'static str],
}

impl Hooks {
    /// No hooks: start from this with `..Hooks::NONE`.
    pub const NONE: Hooks = Hooks { transform: false, filters: &[], engines: &[] };
}

/// The page a hook is working on.
#[derive(Clone, Copy, Debug, Default)]
pub struct Page<'a> {
    url: &'a str,
    input_path: &'a str,
    output_path: &'a str,
    data_json: &'a str,
}

impl<'a> Page<'a> {
    /// A page, for tests.
    pub fn new(url: &'a str, input_path: &'a str, output_path: &'a str, data_json: &'a str) -> Self {
        Page { url, input_path, output_path, data_json }
    }

    /// The page's URL (`/posts/hello/`).
    pub fn url(&self) -> &'a str {
        self.url
    }

    /// The page's source file, from the project root (`./src/posts/hello.md`).
    pub fn input_path(&self) -> &'a str {
        self.input_path
    }

    /// The file the page is written to (`_site/posts/hello/index.html`).
    pub fn output_path(&self) -> &'a str {
        self.output_path
    }

    /// The page's data as JSON text: an engine gets it (front matter, the global data and
    /// `page`, without `collections`); a transform gets `""`, as a JavaScript transform gets
    /// no data.
    pub fn data_json(&self) -> &'a str {
        self.data_json
    }

    /// The page's data, parsed: `Value::Null` when there's none.
    pub fn data(&self) -> Value {
        if self.data_json.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(self.data_json).unwrap_or(Value::Null)
        }
    }
}

/// An ssqch plugin. Implement it, then call [`export!`] once with the type.
pub trait Plugin: Sized + 'static {
    /// The options a site passes (`trailGuide({ greeting: "Howdy" })`), as JSON. Missing or
    /// `null` options are `Options::default()`. `#[serde(deny_unknown_fields)]` makes a
    /// misspelled option an error that names it.
    type Options: DeserializeOwned + Default;
    /// The plugin's name, in the manifest and in errors (`trail-guide`).
    const NAME: &'static str;
    /// The hooks the plugin provides.
    const HOOKS: Hooks;

    /// Makes the plugin from its options. An error fails the build before any page renders.
    fn new(options: Self::Options) -> Result<Self, String>;

    /// Rewrites an HTML page. `Ok(None)` leaves it as it is, without copying it back.
    fn transform(&self, html: &str, page: &Page) -> Result<Option<String>, String> {
        let _ = (html, page);
        Ok(None)
    }

    /// A filter named in `HOOKS.filters`, with the template's arguments.
    fn filter(&self, name: &str, args: &[Value]) -> Result<Value, String> {
        let _ = args;
        Err(format!("no filter named {name}"))
    }

    /// Renders a file whose extension is in `HOOKS.engines`: its text (after the front matter)
    /// in, HTML out. A layout then renders around it, as for any page.
    fn render(&self, ext: &str, source: &str, page: &Page) -> Result<String, String> {
        let _ = (source, page);
        Err(format!("no engine for .{ext}"))
    }
}

/// Makes a plugin from its options as JSON text (`""` and `null` are the defaults), as ssqch
/// does: for tests of a plugin's options.
pub fn create<P: Plugin>(options_json: &str) -> Result<P, String> {
    let trimmed = options_json.trim();
    let options = if trimmed.is_empty() || trimmed == "null" {
        P::Options::default()
    } else {
        // Without serde_json's " at line 1 column 10": the site didn't write that JSON.
        serde_json::from_str(trimmed).map_err(|e| {
            let text = e.to_string();
            let text = if e.line() > 0 { text.rfind(" at line ").map_or(text.as_str(), |at| &text[..at]) } else { &text };
            format!("options: {text}")
        })?
    };
    P::new(options)
}

/// A filter's call as the wasm makes it: arguments and answer as JSON text.
fn filter_json<P: Plugin>(plugin: &P, name: &str, args_json: &str) -> Result<String, String> {
    let args: Vec<Value> = serde_json::from_str(args_json).map_err(|e| format!("the arguments aren't a JSON array: {e}"))?;
    let value = plugin.filter(name, &args)?;
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

/// The manifest, as JSON written at compile time, so ssqch reads it without running the plugin
/// (it's the `.wasm` file's custom section `ssqch_plugin`):
///
/// ```json
/// {"abi":1,"name":"trail-guide","version":"0.1.0","sdk":"0.8.0","hooks":["transform","filter","render"],"filters":["readingTime"],"engines":["trail"]}
/// ```
#[doc(hidden)]
pub mod manifest {
    use super::{Hooks, Plugin, ABI_VERSION, SDK_VERSION};

    struct W<'b, const N: usize> {
        buf: &'b mut [u8; N],
        pos: usize,
    }

    impl<const N: usize> W<'_, N> {
        const fn byte(&mut self, b: u8) {
            if self.pos < N {
                self.buf[self.pos] = b;
            }
            self.pos += 1;
        }

        const fn raw(&mut self, s: &str) {
            let b = s.as_bytes();
            let mut i = 0;
            while i < b.len() {
                self.byte(b[i]);
                i += 1;
            }
        }

        const fn string(&mut self, s: &str) {
            const HEX: &[u8; 16] = b"0123456789abcdef";
            self.byte(b'"');
            let b = s.as_bytes();
            let mut i = 0;
            while i < b.len() {
                let c = b[i];
                if c == b'"' || c == b'\\' {
                    self.byte(b'\\');
                    self.byte(c);
                } else if c < 0x20 {
                    self.raw("\\u00");
                    self.byte(HEX[(c >> 4) as usize]);
                    self.byte(HEX[(c & 15) as usize]);
                } else {
                    self.byte(c);
                }
                i += 1;
            }
            self.byte(b'"');
        }

        const fn list(&mut self, items: &[&str]) {
            self.byte(b'[');
            let mut i = 0;
            while i < items.len() {
                if i > 0 {
                    self.byte(b',');
                }
                self.string(items[i]);
                i += 1;
            }
            self.byte(b']');
        }

        const fn number(&mut self, mut n: u32) {
            let mut digits = [0u8; 10];
            let mut count = 0;
            loop {
                digits[count] = b'0' + (n % 10) as u8;
                count += 1;
                n /= 10;
                if n == 0 {
                    break;
                }
            }
            while count > 0 {
                count -= 1;
                self.byte(digits[count]);
            }
        }
    }

    const fn write<const N: usize>(buf: &mut [u8; N], name: &str, version: &str, hooks: &Hooks) -> usize {
        let mut w = W { buf, pos: 0 };
        w.raw("{\"abi\":");
        w.number(ABI_VERSION);
        w.raw(",\"name\":");
        w.string(name);
        w.raw(",\"version\":");
        w.string(version);
        w.raw(",\"sdk\":");
        w.string(SDK_VERSION);
        w.raw(",\"hooks\":[");
        let mut first = true;
        if hooks.transform {
            w.raw("\"transform\"");
            first = false;
        }
        if !hooks.filters.is_empty() {
            if !first {
                w.byte(b',');
            }
            w.raw("\"filter\"");
            first = false;
        }
        if !hooks.engines.is_empty() {
            if !first {
                w.byte(b',');
            }
            w.raw("\"render\"");
        }
        w.raw("],\"filters\":");
        w.list(hooks.filters);
        w.raw(",\"engines\":");
        w.list(hooks.engines);
        w.byte(b'}');
        w.pos
    }

    /// The manifest's length in bytes.
    pub const fn len<P: Plugin>(version: &str) -> usize {
        write(&mut [0u8; 0], P::NAME, version, &P::HOOKS)
    }

    /// The manifest's bytes. `N` must be [`len`].
    pub const fn bytes<P: Plugin, const N: usize>(version: &str) -> [u8; N] {
        let mut buf = [0u8; N];
        let n = write(&mut buf, P::NAME, version, &P::HOOKS);
        assert!(n == N);
        buf
    }

    /// The manifest as text, for tests.
    pub fn text<P: Plugin>(version: &str) -> String {
        let mut buf = [0u8; 4096];
        let n = write(&mut buf, P::NAME, version, &P::HOOKS);
        assert!(n <= buf.len(), "the manifest is longer than 4096 bytes");
        String::from_utf8_lossy(&buf[..n]).into_owned()
    }
}

/// What ssqch calls in the wasm, ABI v1. One plugin per module, and an instance is one thread,
/// so its state is in statics.
///
/// Exports (numbers are `u32` addresses and lengths in the module's `memory`):
///
/// - `ssqch_abi_v1() -> 1`.
/// - `ssqch_reserve(len) -> ptr`: a buffer of at least `len` bytes, the plugin's, kept between
///   calls; ssqch writes a call's inputs there, one after another. A call that needs more room
///   asks again, and the old address is gone.
/// - `ssqch_result() -> ptr`: the result slot, three `u32`s: the output's address and length,
///   and 1 after a panic (the output is then the panic's message). Its address never changes.
/// - `ssqch_init(options_len) -> status`; `ssqch_transform(html_len, page_len) -> status`;
///   `ssqch_filter(name_len, args_len) -> status`; `ssqch_render(ext_len, source_len,
///   page_len) -> status`. A page is `url\0input_path\0output_path\0data_json`.
///
/// Statuses: 0 the output is the answer, 1 unchanged (a transform's), 2 the output is an error.
#[doc(hidden)]
pub mod __wasm {
    use super::{Page, Plugin};
    use std::cell::UnsafeCell;

    pub const OK: i32 = 0;
    pub const UNCHANGED: i32 = 1;
    pub const ERROR: i32 = 2;

    pub struct Cell<T>(UnsafeCell<T>);
    // A wasm32-wasip1 instance has one thread.
    unsafe impl<T> Sync for Cell<T> {}
    impl<T> Cell<T> {
        pub const fn new(value: T) -> Self {
            Cell(UnsafeCell::new(value))
        }
        #[allow(clippy::mut_from_ref)]
        fn get(&self) -> &mut T {
            // SAFETY: one thread, and no call holds a reference across another.
            unsafe { &mut *self.0.get() }
        }
    }

    static SCRATCH: Cell<Vec<u8>> = Cell::new(Vec::new());
    static RESULT: Cell<Vec<u8>> = Cell::new(Vec::new());
    static SLOT: Cell<[u32; 3]> = Cell::new([0; 3]);

    pub fn reserve(len: u32) -> u32 {
        let scratch = SCRATCH.get();
        let len = len as usize;
        if scratch.len() < len {
            *scratch = vec![0; len.next_power_of_two()];
        }
        scratch.as_ptr() as usize as u32
    }

    pub fn result_slot() -> u32 {
        SLOT.get().as_ptr() as usize as u32
    }

    fn set_result(bytes: Vec<u8>) {
        let result = RESULT.get();
        *result = bytes;
        *SLOT.get() = [result.as_ptr() as usize as u32, result.len() as u32, 0];
    }

    fn finish(r: Result<Option<String>, String>) -> i32 {
        match r {
            Ok(Some(s)) => {
                set_result(s.into_bytes());
                OK
            }
            Ok(None) => UNCHANGED,
            Err(e) => {
                set_result(e.into_bytes());
                ERROR
            }
        }
    }

    /// The call's inputs, in order, as text.
    fn inputs<const K: usize>(lens: [u32; K]) -> Result<[&'static str; K], String> {
        let scratch: &'static [u8] = SCRATCH.get();
        let mut out = [""; K];
        let mut at = 0usize;
        for (i, len) in lens.iter().enumerate() {
            let end = at + *len as usize;
            let bytes = scratch.get(at..end).ok_or("an input is longer than the reserved buffer")?;
            out[i] = std::str::from_utf8(bytes).map_err(|e| format!("an input isn't UTF-8: {e}"))?;
            at = end;
        }
        Ok(out)
    }

    fn page(text: &'static str) -> Page<'static> {
        let mut parts = text.splitn(4, '\0');
        let mut next = || parts.next().unwrap_or("");
        Page::new(next(), next(), next(), next())
    }

    fn plugin<P: Plugin>(cell: &'static Cell<Option<P>>) -> Result<&'static P, String> {
        cell.get().as_ref().ok_or_else(|| "called before ssqch_init".to_string())
    }

    pub fn init<P: Plugin>(cell: &'static Cell<Option<P>>, options_len: u32) -> i32 {
        // A panic aborts, which traps: the message goes in the slot first, for ssqch to show.
        std::panic::set_hook(Box::new(|info| {
            set_result(info.to_string().into_bytes());
            SLOT.get()[2] = 1;
        }));
        finish(inputs([options_len]).and_then(|[options]| {
            *cell.get() = Some(super::create::<P>(options)?);
            Ok(None)
        }))
    }

    pub fn transform<P: Plugin>(cell: &'static Cell<Option<P>>, html_len: u32, page_len: u32) -> i32 {
        finish(inputs([html_len, page_len]).and_then(|[html, page]| plugin(cell)?.transform(html, &self::page(page))))
    }

    pub fn filter<P: Plugin>(cell: &'static Cell<Option<P>>, name_len: u32, args_len: u32) -> i32 {
        finish(inputs([name_len, args_len]).and_then(|[name, args]| super::filter_json(plugin(cell)?, name, args).map(Some)))
    }

    pub fn render<P: Plugin>(cell: &'static Cell<Option<P>>, ext_len: u32, source_len: u32, page_len: u32) -> i32 {
        finish(inputs([ext_len, source_len, page_len]).and_then(|[ext, source, page]| plugin(cell)?.render(ext, source, &self::page(page)).map(Some)))
    }
}

/// Exports a [`Plugin`] for ssqch. Call it once per plugin crate, with the plugin's type.
///
/// Built for wasm32, it writes the manifest and the ABI's exports; built for anything else
/// (`cargo test`), it writes nothing, and the plugin is plain Rust.
#[macro_export]
macro_rules! export {
    ($plugin:ty) => {
        #[cfg(target_arch = "wasm32")]
        const _: () = {
            const __SSQCH_VERSION: &str = env!("CARGO_PKG_VERSION");
            const __SSQCH_MANIFEST_LEN: usize = $crate::manifest::len::<$plugin>(__SSQCH_VERSION);

            #[unsafe(link_section = "ssqch_plugin")]
            #[used]
            static __SSQCH_MANIFEST: [u8; __SSQCH_MANIFEST_LEN] = $crate::manifest::bytes::<$plugin, __SSQCH_MANIFEST_LEN>(__SSQCH_VERSION);

            static __SSQCH_PLUGIN: $crate::__wasm::Cell<Option<$plugin>> = $crate::__wasm::Cell::new(None);

            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_abi_v1() -> u32 {
                1
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_reserve(len: u32) -> u32 {
                $crate::__wasm::reserve(len)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_result() -> u32 {
                $crate::__wasm::result_slot()
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_init(options_len: u32) -> i32 {
                $crate::__wasm::init::<$plugin>(&__SSQCH_PLUGIN, options_len)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_transform(html_len: u32, page_len: u32) -> i32 {
                $crate::__wasm::transform::<$plugin>(&__SSQCH_PLUGIN, html_len, page_len)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_filter(name_len: u32, args_len: u32) -> i32 {
                $crate::__wasm::filter::<$plugin>(&__SSQCH_PLUGIN, name_len, args_len)
            }
            #[unsafe(no_mangle)]
            pub extern "C" fn ssqch_render(ext_len: u32, source_len: u32, page_len: u32) -> i32 {
                $crate::__wasm::render::<$plugin>(&__SSQCH_PLUGIN, ext_len, source_len, page_len)
            }
        };
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize, Default)]
    #[serde(default, deny_unknown_fields, rename_all = "camelCase")]
    struct Options {
        words_per_minute: u32,
    }

    struct Pines(u32);

    impl Plugin for Pines {
        type Options = Options;
        const NAME: &'static str = "pine \"cones\"";
        const HOOKS: Hooks = Hooks { transform: true, filters: &["count", "fail"], engines: &["pine"] };

        fn new(options: Options) -> Result<Self, String> {
            if options.words_per_minute > 1000 {
                return Err("nobody reads that fast".into());
            }
            Ok(Pines(options.words_per_minute))
        }

        fn filter(&self, name: &str, args: &[Value]) -> Result<Value, String> {
            match name {
                "count" => Ok(Value::from(args.len() as u32 + self.0)),
                _ => Err("failed on purpose".into()),
            }
        }
    }

    #[test]
    fn the_manifest_is_json_with_the_hooks() {
        let text = manifest::text::<Pines>("1.2.3");
        assert_eq!(text, format!(r#"{{"abi":1,"name":"pine \"cones\"","version":"1.2.3","sdk":"{SDK_VERSION}","hooks":["transform","filter","render"],"filters":["count","fail"],"engines":["pine"]}}"#));
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["abi"], 1);
        assert_eq!(manifest::len::<Pines>("1.2.3"), text.len());
    }

    #[test]
    fn options_come_from_json() {
        assert_eq!(create::<Pines>("").unwrap().0, 0);
        assert_eq!(create::<Pines>("null").unwrap().0, 0);
        assert_eq!(create::<Pines>(r#"{ "wordsPerMinute": 200 }"#).unwrap().0, 200);
        let Err(e) = create::<Pines>(r#"{ "wordsPerMinit": 200 }"#) else { panic!("a misspelled option") };
        assert!(e.starts_with("options: unknown field `wordsPerMinit`, expected `wordsPerMinute`"), "{e}");
        let Err(e) = create::<Pines>(r#"{ "wordsPerMinute": 2000 }"#) else { panic!("too fast") };
        assert_eq!(e, "nobody reads that fast");
    }

    #[test]
    fn filters_take_and_give_json() {
        let pines = create::<Pines>(r#"{ "wordsPerMinute": 10 }"#).unwrap();
        assert_eq!(filter_json(&pines, "count", r#"[1, "two", {"three": 3}]"#).unwrap(), "13");
        assert_eq!(filter_json(&pines, "fail", "[]").unwrap_err(), "failed on purpose");
        assert!(filter_json(&pines, "count", "{}").unwrap_err().starts_with("the arguments aren't a JSON array"));
    }

    #[test]
    fn a_page_has_its_parts() {
        let page = Page::new("/a/", "./src/a.md", "_site/a/index.html", r#"{"title":"Cedar"}"#);
        assert_eq!((page.url(), page.input_path(), page.output_path()), ("/a/", "./src/a.md", "_site/a/index.html"));
        assert_eq!(page.data()["title"], "Cedar");
        assert_eq!(Page::default().data(), Value::Null);
    }
}
