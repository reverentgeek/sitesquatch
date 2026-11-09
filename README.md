# SiteSquatch

A prototype static site generator in Rust: a data cascade, layouts, collections, pagination and
permalinks, with Edge.js and Markdown templates, a JavaScript config, and a plugin API for
filters, global data, collections, transforms, template engines and build hooks.

It builds [reverentgeek.com](https://reverentgeek.com) from its [source](https://github.com/reverentgeek/blog):
168 pages, about 3,200 responsive image derivatives, feed, sitemap, Netlify `_headers`/`_redirects`.
With images cached, a rebuild takes about **0.1 s**; see [Benchmarks](#benchmarks).

## Try it

You'll need a recent stable [Rust toolchain](https://rustup.rs). The example site is the
ReverentGeek blog, so clone it next to this repository:

```sh
git clone https://github.com/reverentgeek/blog.git ../blog
```

ssqch builds the pages, but the blog's CSS and JavaScript come from Tailwind and esbuild. With
Node installed, the blog's own scripts build everything:

```sh
cargo build --release -p ssqch --features avif
(cd ../blog && pnpm install && SSQCH_BIN=../ssqch/target/release/ssqch pnpm run build)
```

Without Node for the CSS and JS, `scripts/build-native.sh` in the blog downloads standalone
Tailwind and esbuild binaries, builds the CSS and JS, and then runs ssqch. It still uses Node to
fingerprint the CSS and JS (`index.css` becomes `index.<hash>.css`) and to prune unused images:

```sh
SSQCH_BIN="$PWD/target/release/ssqch" ../blog/scripts/build-native.sh
```

To build or serve the site directly, once the CSS and JS exist:

```sh
target/release/ssqch build --root ../blog
target/release/ssqch serve --root ../blog    # watch + live reload
```

The output goes to `../blog/dist`, and the build ends with a summary like
`Wrote 168 pages and copied 12 files in 99.65ms (production mode)`. The first build encodes
about 3,200 images, so expect it to take a while (see [Benchmarks](#benchmarks)). Later builds
reuse them.

`serve` doesn't build the CSS and JS. To work on styles, run the blog's watchers alongside the
server:

```sh
(cd ../blog && pnpm run serve:css) &
(cd ../blog && pnpm run serve:js) &
target/release/ssqch serve --root ../blog
```

Options: `--output DIR`, `--env development|production` (otherwise `$SSQCH_ENV` or `$NODE_ENV`;
defaults to production for `build`, development for `serve`), `--verbose` for per-phase timings
and the slowest images to encode, `--quiet` to print only warnings and errors.

A build prints a line for each page it writes and each image it encodes:

```text
[ssqch] Encoded ./src/site/content/images/hero.png into 10 files (webp, png) in 51.06ms
[ssqch] Writing ./dist/about/index.html from ./src/site/pages/about.md (edge, md)
```

## Layout

```text
crates/ssqch             The `ssqch` command-line tool, configured by ssqch.config.js or sitesquatch.toml
crates/sitesquatch       Generator core, CLI and dev server, as a library
crates/sitesquatch-edge  Edge.js template engine (parser + JavaScript expression evaluator)
crates/sitesquatch-js    ssqch.config.js support, on an embedded QuickJS engine
plugins/rss              getNewestCollectionItemDate, dateToRfc3339/822, absoluteUrl, htmlToAbsoluteUrls, url
plugins/image            <img> -> responsive <picture>, and image() for data files
plugins/minify           Conservative HTML minifier
examples/reverentgeek    The blog's config ported to Rust, as an example of the Rust API
```

## Configuring a site

Install the `ssqch` command:

```sh
cargo install --path crates/ssqch                    # add --features avif for AVIF images
```

Then put an `ssqch.config.js` in your project root:

```js
// ssqch.config.js
import { defineConfig } from "ssqch";
import { imagePlugin } from "ssqch/image";
import { minifyPlugin } from "ssqch/minify";
import { rssPlugin } from "ssqch/rss";
import { slugify } from "./src/utils/slugify.js";
import site from "./src/site.json";

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
  passthrough: [{ "src/assets/fonts": "fonts" }, "src/favicon.ico"],
  watch: ["src/assets/"],

  filters: {
    slug: (s) => slugify(s),
    isoDate: (d) => d.toISOString().slice(0, 10),
  },
  data: {
    site,
    snacks: async () => [{ name: "Pine Cone Crunch", stars: 5 }],
  },
  collections: {
    snacks: (pages) => pages.byTag("snacks").filter((p) => p.data.stars > 3),
  },

  plugins: [
    rssPlugin(),
    imagePlugin({ widths: [300, 600, 1200], formats: ["webp", "auto"] }),
    env === "production" && minifyPlugin(),
  ],
}));
```

```sh
ssqch build                 # production build
ssqch serve --port 8080     # development build, watch and live reload
```

No Node install needed. The config runs on [QuickJS](https://github.com/quickjs-ng/quickjs),
embedded in the `ssqch` binary (it adds about 1.2 MB), so modern JavaScript works: ES modules,
`async`/`await`, arrow functions and the standard built-ins.

The default export is the config: an object, or a function (sync or async) that gets
`{ env, serving }` and returns one. `defineConfig` just returns what it's given; it makes the
file read as a config. Every key is optional:

| Key | What it does |
| --- | --- |
| `dirs` | `input` (default `.`), `output` (`_site`), and `includes` (`_includes`) and `data` (`_data`), relative to the input. |
| `templateFormats` | File extensions to render (default `["edge", "md", "html"]`). |
| `markdownEngine`, `htmlEngine` | The engine that runs over `.md` and `.html` files first (default `"edge"`; `false` for none). |
| `deepMerge` | Merge objects and concatenate arrays through the data cascade (default `true`). |
| `filters` | `{ name: function }`, callable from templates: `{{ slug(title) }}`. Async functions are awaited. |
| `data` | `{ name: value }` for every template. A function (sync or async) is called on each build. |
| `collections` | `{ name: (pages) => ... }`. `pages` has `all()`, `byTag(tag)`, `byTags(...tags)` and `byGlob(glob or globs)`, oldest first. |
| `transforms` | `{ name: (content, page) => content }`, run on every output file. `page` has `url`, `inputPath` and `outputPath`. Return the content, changed or not. Async works. |
| `passthrough` | Files or folders to copy: a path, or `{ from: to }`, or an array of them. |
| `watch` | More paths for `ssqch serve` to watch. |
| `beforeBuild`, `afterBuild` | Build hooks (a function or an array). They get `{ env, serving, dirs }`, plus `written` (the files written) after the build. Async works. |
| `plugins` | More config: objects with any of the keys above except the settings (`dirs`, `templateFormats`, `markdownEngine`, `htmlEngine`, `deepMerge`), or functions that return one. `false`, `null` and `undefined` are skipped, so `env === "production" && minifyPlugin()` works. Give a plugin a `name` to have it show up in errors. |

Two plugins defining the same filter, data or collection name is an error that names both. So
are misspelled keys and options.

Imports can be relative files (`./lib/filters.js`, with or without the extension), JSON
(`import site from "./site.json"`), the built-in modules (`ssqch`, `ssqch/image`, `ssqch/rss`,
`ssqch/minify`), and these Node built-ins, with or without the `node:` prefix:

| Module | What's there |
| --- | --- |
| `node:fs` | `readFileSync`, `writeFileSync`, `appendFileSync`, `existsSync`, `statSync`, `lstatSync`, `readdirSync` (with `withFileTypes`), `mkdirSync`, `rmSync`, `unlinkSync`, `renameSync`, `copyFileSync`, `realpathSync`, `accessSync`, and `fs.promises` |
| `node:fs/promises` | The async versions of the above |
| `node:path` | All of `path.posix`, matching Node's results on [a set of edge cases](crates/sitesquatch-js/tests/fixtures/path-cases.mjs) |
| `node:url` | `fileURLToPath`, `pathToFileURL` (and `import.meta.url` is set) |
| `node:process`, `node:buffer` | `process.env`, `process.cwd()`, `process.platform`, and `Buffer` (also a global) with `utf8`, `hex`, `base64`, `base64url` and `latin1` |

Errors carry Node's codes (`err.code === "ENOENT"`), and relative paths resolve against the
project root, like running Node from there.

Template values arrive as ordinary-looking JavaScript objects, arrays and `Date`s. Large objects
(a page's data, a collection) are really lazy views: a property is read from Rust the first time
you touch it, so passing `collections.posts` to a filter costs nothing until the filter reads it.
They behave like plain objects (`Object.keys`, spread, `JSON.stringify`, `sort()` and other in-place
changes all work), and changes stay inside JavaScript: a filter that sorts `collections.posts`
doesn't reorder it for other pages. Pages render in parallel, but JavaScript runs one call at a
time, so module-level state in your config behaves the way it would in Node.

### JavaScript data files

`_data/*.js` files are global data, and `*.data.js` files next to a template or in a folder
(`posts/posts.data.js`) are template and directory data. The default export is the data, or a
function (sync or async) that returns it:

```js
// src/_data/snacks.js
import { readFile } from "node:fs/promises";

export default async function () {
  return JSON.parse(await readFile("data/snacks.json", "utf8"));
}
```

```js
// src/posts/posts.data.js
export default {
  tags: "posts",
  computed: {
    permalink: (data) => `/snacks/${data.page.fileSlug}/`,
  },
};
```

Data functions run on every build. `ssqch serve` reloads a data file when it changes (files it
imports stay cached until you restart). These work with `sitesquatch.toml` sites too, no
`ssqch.config.js` needed.

### Built-in plugins

- **`ssqch/image`:** `imagePlugin(options)` turns every local `<img>` in HTML output into a
  `<picture>`. Options: `formats` (`avif`, `webp`, `jpeg`, `png`, `auto`), `widths`,
  `defaultAttributes`, `outputDir`, `urlPath`, `webpQuality`, `avifQuality`, `avifSpeed`,
  `jpegQuality`, `minimumThreshold`, `prune`, `hashCache` (on by default; see
  [Deploying from CI](#deploying-from-ci)). On an `<img>`, `ssqch:widths="300,600"` picks that
  image's widths, a plain `width` attribute pins it to one width, and `ssqch:ignore` leaves it
  alone. `image(src, { widths, formats })` generates one image's derivatives with the same
  settings and cache, returning `{ webp: [{ url, width, height, srcset, sourceType, ... }] }`;
  data files can call it even without the plugin. AVIF needs `ssqch` built with
  `--features avif`; on x86_64 that build also needs the [nasm](https://nasm.us) assembler
  (`apt-get install nasm`, `brew install nasm`), which the AVIF encoder uses for speed.
- **`ssqch/minify`:** `minifyPlugin(options)` minifies HTML output, after the image transform.
  `minify(html, options)` does the same for a string. Options: `collapseWhitespace`,
  `removeComments`, `shortDoctype` (all `true` by default).
- **`ssqch/rss`:** `rssPlugin()` adds the filters `getNewestCollectionItemDate`, `dateToRfc3339`,
  `dateToRfc822`, `absoluteUrl`, `htmlToAbsoluteUrls` and `url`. The same functions are named
  exports, for use in your own code.

Errors point back at your code: `ssqch.config.js: too many pine cones` followed by a stack trace
like `at bad (lib/filters.js:3:9)`.

Dates and numbers format like Node for `en-US`: `toLocaleDateString()`, `toLocaleTimeString()`,
`toLocaleString()`, `Intl.DateTimeFormat` and `Intl.NumberFormat` match Node 24 on
[902 cases](crates/sitesquatch-js/tests/fixtures/intl-cases.mjs). QuickJS has no `Intl` of its own, so
other locales, and time zones other than UTC and the machine's, throw instead of formatting
something else.

> **Note:** these aren't supported yet: npm packages, CommonJS (`require`, `module.exports`),
> Node built-ins beyond the ones above (such as `node:crypto`), timers and `fetch`. After
> editing the config, restart `ssqch serve` to pick up the changes.

### Configuring with TOML

Sites that need no code at all can use a `sitesquatch.toml` instead (use one or the other). Every
key is optional; see `crates/sitesquatch/src/site_toml.rs` for the full list.

```toml
input = "src"
output = "public"
template_formats = ["edge", "md", "html"]

[passthrough]
"src/robots.txt" = ""   # empty keeps the path relative to the input directory
```

## Extending ssqch in Rust

When JavaScript isn't enough (a new template engine, a heavy transform), a site can be its own small
Rust binary. `examples/reverentgeek` builds the ReverentGeek blog this way:

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

| API | In `ssqch.config.js` |
| --- | --- |
| `add_filter`, `add_global` | `filters` (Edge globals) |
| `add_global_data(name, \|ctx\| ...)` | `data`, or a JavaScript file in `_data/` |
| `add_collection(name, \|api\| ...)` | `collections` (`all`, `by_tag`, `by_tags`) |
| `add_transform(name, \|ctx, html\| ...)` | `transforms` |
| `add_template_engine(ext, factory)` | not available (Markdown and Edge use this same trait) |
| `on_before_build`, `on_after_build` | `beforeBuild`, `afterBuild` |
| `add_passthrough_copy[_to]`, `add_watch_target` | `passthrough`, `watch` |

Plugins can share services. The image plugin exposes an `ImageProcessor`, and the blog plugin uses
it for `heroImage` data and the `socialImage` filter.

### Templates and data

Data cascade (global `_data` JSON/YAML/TOML/JavaScript < layout front matter < directory data <
template data file < front matter < `computed`), deep merge, tags and collections (sorted by
date), custom collections, pagination (`data`, `size`, `alias`, `reverse`, `filter`,
`addAllPagesToCollections`, hrefs), dynamic permalinks, `permalink: false`, `dynamicPermalink`,
`excludeFromCollections`, `templateEngineOverride`, layout chaining, `page.*`, `templateContent`
in collections, output conflict detection. Every template can read `ssqch.version`, `ssqch.env`,
`ssqch.serving` and `ssqch.generator`.

### Edge.js support

`{{ }}`, `{{{ }}}`, `{{-- --}}`, `@{{ }}`, `@if/@elseif/@else/@unless`, `@each` (with index,
objects, `@else`, `$loop`), `@let`, `@assign`, `@include`, `@includeIf`, `@component`/`@!component`
with named slots and isolated scope, `~` whitespace control. Newlines and escaping follow
Edge.js exactly, checked against Edge.js 6.5 on
[42 whitespace cases](crates/sitesquatch-edge/tests/fixtures/whitespace-cases.json). One
difference: an undefined value prints nothing, where Edge.js prints `undefined`.

Expressions cover the JavaScript the blog uses and a bit more: object/array literals with
shorthand and spread, template literals, optional chaining, arrow functions, ternaries, `??`,
`typeof`, `await` (a no-op), `new Date()`, plus common String/Array/Number/Date methods and
`JSON`, `Object`, `Math`, `Array` globals. Errors report `template:line` through the
include/component chain.

## Benchmarks

These numbers come from building the ReverentGeek blog (161 HTML pages plus feed, sitemap and
Netlify files) on an Apple M5 Pro (15 cores) in November 2026, all in production mode (HTML
minification on). The builds are the Rust port (`examples/reverentgeek`) with and without AVIF,
and the `ssqch` binary running the blog's JavaScript config. Each wrote to its own output folder,
so no image cache was shared.

| Build | Rust port (no AVIF) | Rust port, `--features avif` | `ssqch` with the JavaScript config (AVIF) |
| --- | --- | --- | --- |
| **Cold** (no images cached) | **8.0 s** | **30.8 s** | **25.0 s** |
| CPU time, cold (user + sys) | 79 s | 323 s | 335 s |
| Peak memory, cold | 1.41 GB | 1.54 GB | 1.80 GB |
| **Warm** (images cached, median of 3) | **0.09 s** | **0.10 s** | **0.16 s** |
| Peak memory, warm | ~52 MB | ~50 MB | ~47 MB |
| Image files written | 3,160 (233 MB) | 4,689 (268 MB) | 4,689 (268 MB) |

- **Warm builds** are what the dev server and cached CI builds do. Wall times include process
  startup.
- **Running the JavaScript config** costs about 70 ms more than the Rust port on a warm build:
  that's the blog's collections, filters and data files running in QuickJS. These numbers were
  measured before the blog's config moved to `defineConfig`; it runs the same filters,
  collections and data files.
- **Cold builds** are dominated by image encoding, and AVIF is the most expensive format. They're
  single runs and vary: the two AVIF builds do the same encoding work, and AVIF cold builds ranged
  from 21 s to 31 s across four runs. ssqch encodes AVIF with ravif at speed 8 (`avifSpeed`).
- Only the site generation step is measured. Building the CSS and JavaScript isn't included.

To reproduce on macOS, run `scripts/bench.sh [path/to/blog] [warm-runs]` (the blog defaults to
`../blog`). It benchmarks a copy-on-write clone of the blog in a temporary directory, so your copy is
never touched, and writes `results.csv`, `bench.log` and `summary.txt` to
`bench-results/<timestamp>/`.

## Deploying from CI

Image derivatives are named by a hash of the source file's contents plus the encoder settings, not
its path or modification time. That matters in CI, where every fresh clone gives each file a new
modification time. Cache the output's `img/` folder between runs, and a build with no new images
encodes nothing. On the blog, a fresh clone with `dist/img` restored rebuilds in about 85 ms.

Hashing every source image on every build would cost about 20 ms on the blog (around 420 MB of
images), so ssqch remembers each image's id, with its size and modification time, in
`.cache/ssqch/image-hashes.json` under the project root. Unchanged files skip the read, and a
changed size or modification time means hashing the file again. A fresh clone has all-new
modification times, so its first build re-hashes everything and gets the same ids. Add `.cache/` to
your `.gitignore`, or turn the cache off with `hashCache: false` on `imagePlugin()`
(`ImageOptions::hash_cache` in Rust). It lives outside the output folder because it names your
source paths, and the output gets published.

Set `prune: true` on `imagePlugin()` (`ImageOptions::prune` in Rust) and ssqch deletes
derivatives the build didn't use, so the cache doesn't keep growing as images are edited or
removed. Only turn it on for full builds where every image goes through the image plugin.

The blog deploys to Netlify from GitHub Actions:

1. Restore the cached `ssqch` binary (compiled only when the pinned sitesquatch commit changes),
   `dist/img`, and the downloaded Tailwind and esbuild binaries.
2. Run `scripts/build-native.sh`.
3. Run the smoke tests.
4. Run `netlify deploy --prod --dir dist`. Netlify only uploads files whose contents changed, so a
   new post sends a few pages and that post's images.

## Not done yet / known gaps

- JavaScript config and data files don't cover npm packages or CommonJS yet; see the note under
  [Configuring a site](#configuring-a-site).
- JavaScript is interpreted (QuickJS has no JIT), so heavy collection code is slower than in Node.
  Reading a page in a collection costs about 2 µs the first time; the blog's `topics` and
  `postsByYear` collections over 2,000 posts take about 45 ms together.
- Edge: no `@inject`, `@debugger`, `@svg`, components-as-tags (`@!card()`), destructuring in
  `@let`, scoped slots, regex literals, or the `in` operator. Array `reverse`/`sort` return copies
  rather than mutating.
- Markdown: pulldown-cmark with tables and strikethrough, adjusted to match markdown-it (`<s>`,
  single `~` left literal, `<img>`/`<hr>`/`<br>` without a slash, table alignment styles, line
  breaks in alt text), but it leaves `"` unescaped in text.
- The minifier doesn't shorten attribute values (`defer="defer"`, spaces in a viewport `content`).
- Images: no SVG rasterizing, and no color-profile conversion (profiles are dropped). SVGs are
  served as they are, and GIFs are copied for `auto` output, so animations keep working.
- Custom collections see pages that aren't paginated over collections. Pages paginated over
  collections are added to `all`/tags afterwards.
- No link checker or asset fingerprinting yet (the blog uses its own scripts). The output
  directory isn't cleaned before a build.
