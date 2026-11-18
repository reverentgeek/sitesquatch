# ssqch-plugin

Write [ssqch](https://github.com/reverentgeek/sitesquatch) plugins in Rust. A plugin is one `.wasm` file (built for `wasm32-wasip1`) that ssqch runs in Node's own WebAssembly: the same file on macOS, Linux and Windows, with nothing to compile when a site installs it.

A plugin can give a site three kinds of hooks:

- a **transform**, which rewrites every HTML page the build writes;
- **filters**, functions every template language can call (`{{ readingTime(content) }}` in Jinja, Nunjucks, Edge, Liquid, Handlebars and EJS alike);
- **engines**, template languages of its own, by file extension (a `.trail` file is a page).

Most plugins should be JavaScript. Write one in Rust when the work is heavy: see [When a Rust plugin pays](#when-a-rust-plugin-pays).

## A plugin

```toml
# Cargo.toml
[package]
name = "ssqch-plugin-hello"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]   # cdylib is the .wasm file; rlib is for `cargo test`

[dependencies]
ssqch-plugin = "0.8"
serde = { version = "1", features = ["derive"] }
```

```rust
// src/lib.rs
use ssqch_plugin::{export, Hooks, Page, Plugin, Value};

#[derive(serde::Deserialize, Default)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    shout: bool,
}

pub struct Hello {
    options: Options,
}

impl Plugin for Hello {
    type Options = Options;
    const NAME: &'static str = "hello";
    const HOOKS: Hooks = Hooks { transform: true, filters: &["greet"], ..Hooks::NONE };

    fn new(options: Options) -> Result<Self, String> {
        Ok(Hello { options })
    }

    fn transform(&self, html: &str, _page: &Page) -> Result<Option<String>, String> {
        // `None`: the page is unchanged, and nothing is copied back.
        Ok(self.options.shout.then(|| html.to_uppercase()))
    }

    fn filter(&self, name: &str, args: &[Value]) -> Result<Value, String> {
        match name {
            "greet" => Ok(Value::from(format!("Howdy, {}", args.first().and_then(Value::as_str).unwrap_or("ranger")))),
            _ => Err(format!("no filter named {name}")),
        }
    }
}

export!(Hello);
```

Build it:

```sh
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
# target/wasm32-wasip1/release/ssqch_plugin_hello.wasm
```

For a smaller file, give your workspace a release profile with `lto = true`, `codegen-units = 1`, `opt-level = "s"` and `strip = true`.

## Shipping it on npm

The package's default export is a function that takes the site's options and returns `{ name, rust: { wasm, options } }`, with `wasm` the absolute path to the file:

```js
// index.js
import { fileURLToPath } from "node:url";

export default function hello(options = {}) {
  return { name: "hello", rust: { wasm: fileURLToPath(new URL("./hello.wasm", import.meta.url)), options } };
}
```

A site adds it as it adds any plugin, and lists an engine's extension in `templateFormats`:

```js
// ssqch.config.js
import hello from "ssqch-plugin-hello";
export default { plugins: [hello({ shout: true })] };
```

`examples/rust-plugin` in ssqch's repository is a whole plugin with all three hooks: its crate, its npm package (`package.json`, `index.js`, `index.d.ts`) and its tests.

## The rules (ABI v1)

- **The hooks are in the manifest.** `export!` writes `NAME`, `HOOKS` and the crate's version into the `.wasm` file's custom section `ssqch_plugin`. ssqch reads it without running the plugin, and wires in the hooks it lists: the transform (named after the plugin), each filter and each engine. A name a site's config already uses is an error, as for any plugin.
- **Options are JSON.** `new` gets the site's options deserialized into `Options` (missing or `null` is `Options::default()`). With `#[serde(deny_unknown_fields)]`, a misspelled option fails the build: ``plugin "hello": options: unknown field `shuot`, expected `shout` ``. An error from `new` fails the build before any page renders.
- **A transform sees HTML pages** (the output file ends in `.html`), after the page's layouts and after ssqch's image transform, with the page's `url()`, `input_path()` and `output_path()`. Its page has no data, as a JavaScript transform has none.
- **Filters get JSON values** (`Value` is `serde_json`'s, with objects' keys in order): a date arrives as ISO 8601 text, `undefined` as `null`, and a function isn't sent. What a filter returns is what the template prints, escaped as any filter's answer is.
- **An engine** gets the file's text after its front matter, and the page's data as `page.data()`: front matter, global data and `page`, without `collections`. Its HTML goes through the page's layouts like any page. An error that starts with `line N: ` is about that line of the file: ssqch counts it as a line of the file (after the front matter) and shows it.
- **Errors are strings**, and ssqch says the rest: `index.edge:2: readingTime(): hello: readingTime expects text, got a number`, ``transform `hello` failed for src/index.md: ...``.
- **A panic is an error** with its message and place, and the next call gets a fresh instance, made again with `new`. A build says it in the words of the hook that was running: ``transform `hello` failed for src/posts/1.md: panicked at src/lib.rs:7:9: ...``, `readingTime(): hello: panicked at ...` for a filter, and `hello: panicked at ...` for a panic in `new`. Only an error about the options (a field `new` refused to deserialize) starts with `options:`.
- **One page at a time, nothing shared.** A plugin has no files, network or environment (ssqch answers std's `wasi_snapshot_preview1` calls with none; clocks are real, and random numbers come from a fixed seed, so a build repeats). Don't keep state between calls: ssqch may start the plugin again at any time.
- **A plugin built for another ABI is refused**, with what to do: `built for plugin ABI 2, and this ssqch loads ABI 1: update ssqch, or use a version of the plugin built for ABI 1`. A file without the manifest is `not an ssqch plugin (it has no ssqch_plugin section; was it built with ssqch_plugin::export!?)`.

A plugin is tested as plain Rust: `ssqch_plugin::create::<Hello>(r#"{ "shout": true }"#)` makes it from options as ssqch does, and its hooks are methods. `export!` writes nothing outside wasm, so `cargo test` needs no special setup.

## When a Rust plugin pays

Each call copies its text into the plugin's memory and the answer back out, and V8 runs WebAssembly at most at native speed. So Rust pays for work that's heavy for each byte, not for a few edits.

- **Heavy work pays:** minifying, parsing a real grammar (a template language, a syntax highlighter), image or font work on bytes, hashing, compression, a search index. ssqch's own HTML minifier is a plugin built with this crate; in the study behind ssqch 0.8, minify-html as a plugin took 0.28 of html-minifier-terser's time.
- **A regex doesn't.** Adding `loading="lazy"` to images, swapping a word, a reading time: JavaScript's regular expressions are compiled to machine code. In the study, adding attributes to 200,000 images on 10,000 pages took a JavaScript regex 53 ms, the same scan in Rust 81 ms as a plugin, and an HTML tokenizer (lol_html) 311 ms. Write those in the config.
- **Many tiny calls cost.** A filter call costs about 0.25 µs on top of its work (JSON both ways). Fifty a page on 10,000 pages is a tenth of a second.

## License

MIT
