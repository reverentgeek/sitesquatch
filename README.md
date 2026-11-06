# SiteSquatch

A prototype static site generator in Rust, inspired by [Eleventy](https://www.11ty.dev): a data
cascade, layouts, collections, pagination and permalinks, with Edge.js and Markdown templates and
a plugin API for filters, shortcodes, global data, collections, transforms, template engines and
build hooks.

It builds [reverentgeek.com](https://reverentgeek.com) with no changes to the [source](https://github.com/reverentgeek/blog):
168 pages, about 3,200 responsive image derivatives, feed, sitemap, Netlify `_headers`/`_redirects`.

Compared with Eleventy on the same blog, `ssqch` rebuilds about **16x faster** (0.08 s vs 1.28 s)
and builds from scratch about **3.6x faster** with the same image formats (23.7 s vs 84.5 s). See
[Benchmarks vs. Eleventy](#benchmarks-vs-eleventy).

## Try it

You'll need a recent stable [Rust toolchain](https://rustup.rs). The example site is the
ReverentGeek blog, so clone it next to this repository:

```sh
git clone https://github.com/reverentgeek/blog.git ../blog
```

ssqch builds the pages, but the blog's CSS and JavaScript still come from Tailwind and esbuild.
Build those first, either with Node:

```sh
(cd ../blog && pnpm install && pnpm run build:css && pnpm run build:js)
```

or without it. `scripts/build-native.sh` in the blog downloads standalone Tailwind and esbuild
binaries, builds the CSS and JS, and then runs ssqch for you:

```sh
cargo build --release -p reverentgeek
SSQCH_BIN="$PWD/target/release/reverentgeek" ../blog/scripts/build-native.sh
```

In production builds ssqch fingerprints the CSS and JS itself (`index.css` becomes
`index.<hash>.css`), so the blog's `build:hash` step isn't needed.

To build or serve the site directly:

```sh
cargo run --release -p reverentgeek -- build --root ../blog
cargo run --release -p reverentgeek -- serve --root ../blog                    # watch + live reload
cargo run --release -p reverentgeek --features avif -- build --root ../blog    # also write AVIF (slower)
```

The output goes to `../blog/dist`, and the build ends with a summary like
`Wrote 168 pages and copied 12 files in 87.53ms (production mode)`. The first build encodes
about 3,200 images, so expect it to take a few seconds. Later builds reuse them.

Options: `--output DIR`, `--env development|production` (otherwise `$SSQCH_ENV`, `$ELEVENTY_ENV`,
`$NODE_ENV`; defaults to production for `build`, development for `serve`), `--verbose` for
per-phase timings, `--quiet`.

## Layout

```text
crates/sitesquatch-edge  Edge.js template engine (parser + JavaScript expression evaluator)
crates/sitesquatch       Generator core, CLI, dev server; `ssqch` binary configured by sitesquatch.toml
plugins/rss              getNewestCollectionItemDate, dateToRfc3339/822, absoluteUrl, htmlToAbsoluteUrls, url
plugins/image            <img> -> responsive <picture> (like @11ty/eleventy-img's transform)
plugins/minify           Conservative HTML minifier (like html-minifier-terser's collapseWhitespace)
examples/reverentgeek    The blog's .eleventy.js, src/utils/eleventy/*.js and _data/*.js, ported to Rust
```

## Writing a site or plugin

A site is a small Rust binary, the counterpart of `.eleventy.js`:

```rust
fn main() -> std::process::ExitCode {
    sitesquatch::cli::run(|cfg| {
        cfg.input = "src/site".into();
        cfg.output = "dist".into();
        cfg.add_passthrough_copy_to("src/assets/fonts", "fonts");
        cfg.add_plugin(sitesquatch_plugin_rss::RssPlugin);
        cfg.add_filter("shout", |args| Ok(sitesquatch::Value::from(args[0].to_js_string().to_uppercase())));
    })
}
```

A plugin implements `sitesquatch::Plugin` (any `Fn(&mut Config)` works too) and registers things on
the `Config`:

| API | Eleventy equivalent |
| --- | --- |
| `add_filter`, `add_shortcode`, `add_global` | `addFilter`, `addShortcode` (Edge globals, as in eleventy-plugin-edgejs) |
| `add_global_data(name, \|ctx\| ...)` | a JavaScript file in `_data/` |
| `add_collection(name, \|api\| ...)` | `addCollection` (`get_all`, `get_filtered_by_tag(s)`) |
| `add_transform(name, \|ctx, html\| ...)` | `addTransform` |
| `add_template_engine(ext, factory)` | `addExtension` (Markdown and Edge use this same trait) |
| `on_before_build`, `on_after_build` | `eleventy.before` / `eleventy.after` |
| `add_passthrough_copy[_to]`, `add_watch_target` | same |

Plugins can share services. The image plugin exposes an `ImageProcessor`, and the blog plugin uses
it for `heroImage` data and the `socialImage` filter.

### No Rust required

Sites that don't need custom code can use the plain `ssqch` binary with a `sitesquatch.toml` in
the project root. Every key is optional; see `crates/sitesquatch/src/site_toml.rs` for the full list.

```toml
input = "src"
output = "public"
template_formats = ["edge", "md", "html"]

[passthrough]
"src/robots.txt" = ""   # empty keeps the path relative to the input directory
```

```sh
cargo install --path crates/sitesquatch   # installs `ssqch`
ssqch build
ssqch serve --port 8080
```

### Supported Eleventy features

Data cascade (global `_data` JSON/YAML/TOML < layout front matter < directory data < template data
file < front matter < `eleventyComputed`), deep merge, tags and collections (sorted by date), custom
collections, pagination (`data`, `size`, `alias`, `reverse`, `filter`, `addAllPagesToCollections`,
hrefs), dynamic permalinks, `permalink: false`, `dynamicPermalink`, `eleventyExcludeFromCollections`,
`templateEngineOverride`, `markdownTemplateEngine`/`htmlTemplateEngine`, layout chaining,
`page.*`, `templateContent` in collections, output conflict detection.

### Edge.js support

`{{ }}`, `{{{ }}}`, `{{-- --}}`, `@{{ }}`, `@if/@elseif/@else/@unless`, `@each` (with index,
objects, `@else`, `$loop`), `@let`, `@assign`, `@include`, `@includeIf`, `@component`/`@!component`
with named slots and isolated scope, `~` whitespace control, Edge's newline rules.

Expressions cover the JavaScript the blog uses and a bit more: object/array literals with
shorthand and spread, template literals, optional chaining, arrow functions, ternaries, `??`,
`typeof`, `await` (a no-op), `new Date()`, plus common String/Array/Number/Date methods and
`JSON`, `Object`, `Math`, `Array` globals. Errors report `template:line` through the
include/component chain.

## Benchmarks vs. Eleventy

These numbers come from building the ReverentGeek blog (161 HTML pages plus feed, sitemap and
Netlify files) on an Apple M5 Pro (15 cores) in November 2026. Both tools ran in production mode
(HTML minification on) against the same copy of the blog. Eleventy 4.0.0-alpha.10 ran as the blog's
`build:eleventy` step (`eleventy` called directly, no npx/pnpm wrapper). Each ssqch variant wrote to
its own output folder, so no image cache was shared.

| Build | Eleventy 4.0.0-alpha.10 | ssqch `--features avif` (same formats) | ssqch default (no AVIF) |
| --- | --- | --- | --- |
| **Cold** (no images cached) | **84.5 s** | **23.7 s** (3.6x faster) | **7.0 s** (12x faster) |
| CPU time, cold (user + sys) | 971 s | 301 s | 77 s |
| Peak memory, cold | 1.85 GB | 1.90 GB | 1.53 GB |
| **Warm** (images cached, median of 3) | **1.28 s** | **0.08 s** (~16x faster) | **0.08 s** (~16x faster) |
| Peak memory, warm | ~378 MB | ~50 MB | ~48 MB |
| Image files written | 4,980 (273 MB) | 4,716 (270 MB) | 3,178 (235 MB) |

- **Warm builds** are what the dev server and cached CI builds do. Eleventy's own log reports
  1.16 s; ssqch reports 59 ms. Wall times above include process startup (Node vs. a native binary).
- **Cold builds** are dominated by image encoding, and AVIF is the most expensive format: it takes
  ssqch from 7 s to 24 s.
- The AVIF encoders differ: Eleventy uses sharp/libaom at effort 4, ssqch uses ravif at speed 8.
  Total sizes came out about the same, but image quality wasn't compared.
- Eleventy writes more image files, mostly AVIF/WebP versions of GIF first frames; ssqch copies
  GIFs as they are, keeping them animated.
- One cold run per tool, so treat cold numbers as accurate to a few seconds; warm runs were very
  consistent.
- Only the site generation step is measured. Building the CSS and JavaScript isn't included.

To reproduce on macOS, run `scripts/bench.sh [path/to/blog] [warm-runs]` (the blog defaults to
`../blog`). It benchmarks a copy-on-write clone of the blog in a temporary directory, so your copy is
never touched, and writes `results.csv`, `bench.log` and `summary.txt` to
`bench-results/<timestamp>/`.

## Deploying from CI

Image derivatives are named by a hash of the source file's contents plus the encoder settings, not
its path or modification time. That matters in CI, where every fresh clone gives each file a new
modification time. Cache the output's `img/` folder between runs, and a build with no new images
encodes nothing. On the blog, a fresh clone with `dist/img` restored rebuilds in about 90 ms.

Set `ImageOptions::prune` and ssqch deletes derivatives the build didn't use, so the cache doesn't
keep growing as images are edited or removed. Only turn it on for full builds where every image
goes through the image plugin. The blog enables it in production.

The blog deploys to Netlify from GitHub Actions without a Node toolchain:

1. Restore the cached ssqch binary (compiled only when this repository changes), `dist/img`, and
   the downloaded Tailwind and esbuild binaries.
2. Run `scripts/build-native.sh`.
3. Run the smoke tests.
4. Run `netlify deploy --prod --dir dist`. Netlify only uploads files whose contents changed, so a
   new post sends a few pages and that post's images.

## Parity with the 11ty build

Compared page by page against the Eleventy build's `dist/`, SiteSquatch produces exactly the same
set of files, and the blog's own `test/smoke.test.js` passes against SiteSquatch output. Every text
output is byte-identical (`_headers`, `_redirects`, `robots.txt`, `webfinger`, `llms.txt`). With
attribute order and minifier formatting ignored, 147 of 161 HTML pages are identical. The other 14
differ on purpose:

- **Dates are rendered in UTC.** `postDate`/`getFullYear` run in the local time zone in Node, so an
  Eleventy build west of UTC shows `date: 2014-07-14` as "July 13, 2014" (Netlify, in UTC, shows the
  14th). SiteSquatch always shows the front matter date, and the archive's year grouping follows.
- **Animated GIFs stay animated.** eleventy-img (without `sharpOptions.animated`) keeps only the
  first frame; SiteSquatch copies GIFs for `auto` output.
- **AVIF is opt-in** (`--features avif`), because the pure-Rust encoder is slow. Without it the hero
  preload uses WebP.

## Not done yet / known gaps

- Plugins are Rust only. JavaScript (QuickJS) or WASM plugins would let `_data/*.js` and filters run
  unchanged; today JS data files are skipped with a warning.
- Edge: no `@inject`, `@debugger`, `@svg`, components-as-tags (`@!card()`), destructuring in
  `@let`, scoped slots, regex literals, or the `in` operator. Array `reverse`/`sort` return copies
  rather than mutating.
- Markdown: pulldown-cmark with tables and strikethrough. Output matches markdown-it closely
  (`<s>`, single `~` left literal) but leaves `"` unescaped in text.
- The minifier doesn't rewrite attribute values (`defer="defer"`, `style` spacing) like
  html-minifier does.
- Custom collections see pages that aren't paginated over collections. Pages paginated over
  collections are added to `all`/tags afterwards.
- No `eleventy-plugin-broken-links` equivalent. The output directory isn't cleaned (like Eleventy).
- `{{ eleventy.version }}` renders SiteSquatch's version.
