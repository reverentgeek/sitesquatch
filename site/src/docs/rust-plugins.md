---
title: "Plugins in Rust"
description: "Most plugins should be JavaScript."
---
Most plugins should be JavaScript: a piece of config, in the config or an npm package (see [Configuring a site](configuring.md)). When a plugin does heavy work, it can be written in Rust instead, with the [`ssqch-plugin`](https://crates.io/crates/ssqch-plugin) crate, the plugin SDK. It builds one `.wasm` file (for `wasm32-wasip1`) that ssqch runs in Node's own WebAssembly: the same file on macOS, Linux and Windows, with nothing to compile when a site installs it, no native code, and no files, network or environment for the plugin to reach. ssqch's own minifier (`ssqch/minify`) is built this way, and its Markdown and Sass are Rust compiled to WebAssembly too.

A Rust plugin can give a site a **transform** (every HTML page the build writes, after the image transform), **filters** (functions every template language can call) and **engines** (template languages of its own, by file extension). A site adds it as it adds any plugin; its npm package's function returns `{ name, rust: { wasm, options } }`, with `wasm` the absolute path to its file and `options` JSON for the plugin (`ssqch.d.ts` has the type, `RustPlugin`):

```js
// ssqch.config.js
import trailGuide from "ssqch-plugin-trail-guide";

export default {
  templateFormats: ["jinja", "md", "trail"],   // the plugin's engine renders .trail files
  plugins: [trailGuide({ greeting: "Howdy" })],
};
```

The plugin's hooks come from its manifest, inside the `.wasm` file: its filters' names and its engines' extensions, so the package doesn't list them. A name the config already uses is an error, as for any plugin. Options are JSON, checked by the plugin when the config loads: ``plugin "trail-guide": options: unknown field `greting`, expected one of `greeting`, `wordsPerMinute`, `externalRel` ``. A filter's error names the plugin (`index.edge:2: readingTime(): trail-guide: readingTime expects text, got a number`), an engine's error on a line of the file shows that line, and a panic is an error with its place in the Rust. A file that isn't a plugin, or that was built for another version of the plugin ABI, is refused with what to do: `built for plugin ABI 2, and this ssqch loads ABI 1: update ssqch, or use a version of the plugin built for ABI 1`.

What a plugin gets: a filter gets the template's values as JSON (a date as ISO 8601 text, `undefined` as `null`, no functions) and its answer is printed as any filter's is; an engine gets the file's text after the front matter and the page's data without `collections`; a transform gets each HTML page and its `url`, `inputPath` and `outputPath`, and no data, as a JavaScript transform does.

**The plugin SDK:** a plugin is a Rust crate with `crate-type = ["cdylib", "rlib"]`, a type that implements `ssqch_plugin::Plugin` (its `Options`, its `NAME` and `HOOKS`, `new`, and the hooks it has) and the line `export!(MyPlugin);`. `cargo build --release --target wasm32-wasip1` builds the file (`rustup target add wasm32-wasip1` first), and `cargo test` tests the plugin as plain Rust. [`examples/rust-plugin`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/rust-plugin/) is a whole plugin with all three hooks and its npm package, and [the crate's README](https://github.com/reverentgeek/sitesquatch/blob/main/crates/ssqch-plugin/README.md) has the rules and a complete example: the manifest, the options, what each hook sees, how errors and panics are reported, and the ABI.


## When a Rust plugin pays

Each call copies its text into the plugin's memory and the answer back out, and WebAssembly runs at most at native speed, so Rust pays for work that's heavy for each byte, not for a few edits.

- **Heavy work pays:** minifying, parsing a real grammar (a template language, a highlighter), work on images or fonts, hashing, compression, a search index. Measured on 10,000 pages, minify-html as a plugin minified them in 0.28 of html-minifier-terser's time (0.82 s against 2.97 s), and ssqch's own minifier minifies the ReverentGeek blog's 169 pages (7.9 MB) in about 0.1 s.
- **A regex doesn't.** Adding `loading="lazy"` to images, swapping a word, counting words: JavaScript's regular expressions compile to machine code. Adding attributes to 200,000 images on 10,000 pages took a JavaScript regex 53 ms, the same scan in Rust 81 ms as a plugin, and a real HTML tokenizer (lol_html) 311 ms. Write those as a transform in the config.
- **Many small calls cost.** A filter call costs about 0.25 µs besides its work (its arguments and answer cross as JSON): fifty a page on 10,000 pages is a tenth of a second. A filter that's called for every item of every list is better in JavaScript.
