# SiteSquatch

A prototype static site generator in Rust, inspired by [Eleventy](https://www.11ty.dev): a data
cascade, layouts, collections, pagination and permalinks, with Edge.js and Markdown templates and
a plugin API for filters, shortcodes, global data, collections, transforms, template engines and
build hooks.

It builds [reverentgeek.com](https://reverentgeek.com) with no changes to the [source](https://github.com/reverentgeek/blog):
168 pages, about 3,200 responsive image derivatives, feed, sitemap, Netlify `_headers`/`_redirects`.

Compared with Eleventy on the same blog, `ssqch` rebuilds about **14x faster** (0.09 s vs 1.28 s)
and builds from scratch about **3 to 4x faster** with the same image formats (25 to 31 s vs 91 s).
Running the blog's own `.eleventy.js` instead of the Rust port, it rebuilds about **8x faster**
(0.16 s). See [Benchmarks vs. Eleventy](#benchmarks-vs-eleventy).

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

`serve` doesn't build the CSS and JS. Pages link to the plain `index.css` when a watcher is
writing it, and otherwise to the fingerprinted file the last production build left. To work on
styles, run the blog's watchers alongside the server:

```sh
(cd ../blog && pnpm run serve:css) &
(cd ../blog && pnpm run serve:js) &
cargo run --release -p reverentgeek -- serve --root ../blog
```

If neither file exists, ssqch warns that the CSS and JS haven't been built.

Options: `--output DIR`, `--env development|production` (otherwise `$SSQCH_ENV`, `$ELEVENTY_ENV`,
`$NODE_ENV`; defaults to production for `build`, development for `serve`), `--verbose` for
per-phase timings and the slowest images to encode, `--quiet` to print only warnings and errors.

Like Eleventy, a build prints a line for each page it writes and each image it encodes:

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
plugins/image            <img> -> responsive <picture> (like @11ty/eleventy-img's transform)
plugins/minify           Conservative HTML minifier (like html-minifier-terser's collapseWhitespace)
examples/reverentgeek    The blog's .eleventy.js, src/utils/eleventy/*.js and _data/*.js, ported to Rust
```

## Configuring a site

Install the `ssqch` command:

```sh
cargo install --path crates/ssqch                    # add --features avif for AVIF images
```

Then put an `ssqch.config.js` in your project root. If you've written an Eleventy config, this will
look familiar:

```js
// ssqch.config.js
import { slugify } from "./src/utils/slugify.js";
import site from "./src/site.json";

export default function (config) {
  config.addPassthroughCopy({ "src/assets/fonts": "fonts" });
  config.addWatchTarget("src/assets/");

  config.addFilter("slug", (s) => slugify(s));
  config.addFilter("isoDate", (d) => d.toISOString().slice(0, 10));
  config.addShortcode("year", () => String(new Date().getFullYear()));
  config.addGlobalData("site", site);
  config.addGlobalData("snacks", async () => [{ name: "Pine Cone Crunch", stars: 5 }]);

  config.addPlugin("ssqch:rss");
  config.addPlugin("ssqch:image", { widths: [300, 600, 1200], formats: ["webp", "auto"] });
  if (config.isProduction) config.addPlugin("ssqch:minify");

  return { dir: { input: "src", output: "dist" }, templateFormats: ["edge", "md"] };
}
```

```sh
ssqch build                 # production build
ssqch serve --port 8080     # development build, watch and live reload
```

No Node install needed. The config runs on [QuickJS](https://github.com/quickjs-ng/quickjs),
embedded in the `ssqch` binary (it adds about 1.2 MB), so modern JavaScript works: ES modules,
`async`/`await`, arrow functions and the standard built-ins.

| In your config | What it does |
| --- | --- |
| `addFilter`, `addShortcode` (and their `Async` versions) | Functions callable from templates: `{{ slug(title) }}`. Async functions are awaited. |
| `addGlobalData(name, value)` | Data for every template. Pass a function (sync or async) to compute it on each build. |
| `addPassthroughCopy(path)` or `({ from: to })` | Copy files or folders into the output. |
| `addWatchTarget(path)` | More paths for `ssqch serve` to watch. |
| `addCollection(name, (api) => ...)` | A custom collection. `api` has `getAll`, `getAllSorted`, `getFilteredByTag`, `getFilteredByTags` and `getFilteredByGlob`, like Eleventy's. |
| `addTransform(name, function (content) { ... })` | Post-process every output file. `this.page` has `url`, `inputPath` and `outputPath`; `outputPath` is also the second argument. Return the content, changed or not. Async works. |
| `on("eleventy.before" \| "eleventy.after", fn)` | Build hooks. `fn` gets `{ directories, runMode, outputMode }`, plus `results` after the build. Async works. |
| `addPlugin("ssqch:rss" \| "ssqch:image" \| "ssqch:minify", options)` | Turn on a built-in plugin. |
| `addPlugin(fn, options)` | Call `fn(config, options)`, like an Eleventy plugin. |
| `setDataDeepMerge`, `setTemplateFormats`, `set{Input,Output,Includes,Data}Directory` | Settings, also accepted in the returned object or `export const config`. |
| `config.env`, `config.isProduction`, `config.isDevelopment`, `config.serving` | Which build this is. `process.env` works too. |

Imports can be relative files (`./lib/filters.js`, with or without the extension), JSON
(`import site from "./site.json"`), and these Node built-ins, with or without the `node:` prefix:

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

Like Eleventy, `_data/*.js` files are global data, and `*.11tydata.js` files next to a template or
in a folder (`posts/posts.11tydata.js`) are template and directory data. The default export is the
data, or a function (sync or async) that returns it:

```js
// src/_data/snacks.js
import { readFile } from "node:fs/promises";

export default async function () {
  return JSON.parse(await readFile("data/snacks.json", "utf8"));
}
```

```js
// src/posts/posts.11tydata.js
export default {
  tags: "posts",
  eleventyComputed: {
    permalink: (data) => `/snacks/${data.page.fileSlug}/`,
  },
};
```

Data functions run on every build. `ssqch serve` reloads a data file when it changes (files it
imports stay cached until you restart). These work with `sitesquatch.toml` sites too, no
`ssqch.config.js` needed.

Built-in plugin options:

- **`ssqch:image`:** `formats` (`avif`, `webp`, `jpeg`, `png`, `auto`), `widths`,
  `defaultAttributes`, `outputDir`, `urlPath`, `webpQuality`, `avifQuality`, `avifSpeed`,
  `jpegQuality`, `minimumThreshold`, `prune`, `hashCache` (on by default; see
  [Deploying from CI](#deploying-from-ci)). AVIF needs `ssqch` built with `--features avif`.
- **`ssqch:minify`:** `collapseWhitespace`, `removeComments`, `shortDoctype` (all `true` by
  default).
- **`ssqch:rss`:** no options.

Errors point back at your code: `ssqch.config.js: too many pine cones` followed by a stack trace
like `at bad (lib/filters.js:3:9)`. Misspelled plugin names and options are errors, not silently
ignored.

### Running an Eleventy config

Many Eleventy configs run unchanged. ssqch answers imports of these packages with its own
modules, backed by the built-in plugins:

| Import | What you get |
| --- | --- |
| `@11ty/eleventy-img` | `Image(src, options)`, returning eleventy-img's metadata (`{ webp: [{ url, width, height, srcset, sourceType, ... }] }`), and `eleventyImageTransformPlugin` |
| `@11ty/eleventy-plugin-rss` | The plugin (its filters), plus `getNewestCollectionItemDate`, `dateToRfc3339`, `dateToRfc822`, `absoluteUrl` and `convertHtmlToAbsoluteUrls` |
| `html-minifier-terser` | `minify(html, options)` with `collapseWhitespace`, `removeComments` and `useShortDoctype` (off unless set, like html-minifier) |
| `eleventy-plugin-edgejs` | Nothing to do: Edge is built in |
| `eleventy-plugin-broken-links` | A warning that it isn't available |

The same modules are importable as `ssqch:image`, `ssqch:rss` and `ssqch:minify`. Options ssqch
can't honor, such as sharp's `effort` or a `transform` function, are ignored with a warning. An
`Image()` call whose `outputDir` or `urlPath` doesn't match the build is an error, not a surprise.
The ReverentGeek blog builds from its real `.eleventy.js` with a one-line `ssqch.config.js`:

```js
export { default } from "./.eleventy.js";
```

Dates and numbers format like Node for `en-US`: `toLocaleDateString()`, `toLocaleTimeString()`,
`toLocaleString()`, `Intl.DateTimeFormat` and `Intl.NumberFormat` match Node 24 on
[902 cases](crates/sitesquatch-js/tests/fixtures/intl-cases.mjs). QuickJS has no `Intl` of its own, so
other locales, and time zones other than UTC and the machine's, throw instead of formatting
something else.

> **Note:** these aren't supported yet: other npm packages, CommonJS (`require`,
> `module.exports`), Node built-ins beyond the ones above (such as `node:crypto`), paired
> shortcodes, `addExtension`, the `eleventy.beforeWatch` event, timers and `fetch`. Calling an
> unsupported method fails with a message saying so. After editing the config, restart
> `ssqch serve` to pick up the changes.

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
Rust binary. That's how the ReverentGeek blog is built:

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
with named slots and isolated scope, `~` whitespace control. Newlines and escaping follow
Edge.js exactly, checked against Edge.js 6.5 on
[42 whitespace cases](crates/sitesquatch-edge/tests/fixtures/whitespace-cases.json). One
difference: an undefined value prints nothing, where Edge.js prints `undefined`.

Expressions cover the JavaScript the blog uses and a bit more: object/array literals with
shorthand and spread, template literals, optional chaining, arrow functions, ternaries, `??`,
`typeof`, `await` (a no-op), `new Date()`, plus common String/Array/Number/Date methods and
`JSON`, `Object`, `Math`, `Array` globals. Errors report `template:line` through the
include/component chain.

## Benchmarks vs. Eleventy

These numbers come from building the ReverentGeek blog (161 HTML pages plus feed, sitemap and
Netlify files) on an Apple M5 Pro (15 cores) in November 2026, all in production mode (HTML
minification on) against the same copy of the blog. Eleventy 4.0.0-alpha.10 ran as the blog's
`build:eleventy` step (`eleventy` called directly, no npx/pnpm wrapper). The ssqch builds are the
Rust port (`examples/reverentgeek`) with and without AVIF, and the `ssqch` binary running the blog's
real `.eleventy.js`. Each wrote to its own output folder, so no image cache was shared.

| Build | Eleventy 4.0.0-alpha.10 | ssqch default (no AVIF) | ssqch `--features avif` (same formats) | ssqch running `.eleventy.js` (AVIF) |
| --- | --- | --- | --- | --- |
| **Cold** (no images cached) | **91.3 s** | **8.0 s** (11x faster) | **30.8 s** (3.0x faster) | **25.0 s** (3.7x faster) |
| CPU time, cold (user + sys) | 1,042 s | 79 s | 323 s | 335 s |
| Peak memory, cold | 1.75 GB | 1.41 GB | 1.54 GB | 1.80 GB |
| **Warm** (images cached, median of 3) | **1.28 s** | **0.09 s** (14x faster) | **0.10 s** (13x faster) | **0.16 s** (8x faster) |
| Peak memory, warm | ~378 MB | ~52 MB | ~50 MB | ~47 MB |
| Image files written | 4,980 (273 MB) | 3,160 (233 MB) | 4,689 (268 MB) | 4,689 (268 MB) |

- **Warm builds** are what the dev server and cached CI builds do. Eleventy's own log reports about
  1.2 s; ssqch reports about 67 ms for the Rust port. Wall times above include process startup
  (Node vs. a native binary).
- **Running the JavaScript config** costs about 70 ms more than the Rust port on a warm build:
  that's the blog's collections, filters and data files running in QuickJS.
- **Cold builds** are dominated by image encoding, and AVIF is the most expensive format. They're
  single runs and vary: the two AVIF builds do the same encoding work, and AVIF cold builds ranged
  from 21 s to 31 s across four runs.
- The AVIF encoders differ: Eleventy uses sharp/libaom at effort 4, ssqch uses ravif at speed 8.
  Total sizes came out about the same, but image quality wasn't compared.
- Eleventy writes more image files, mostly AVIF/WebP versions of GIF first frames and of SVGs;
  ssqch copies GIFs (keeping them animated) and serves SVGs as they are.
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
your `.gitignore` (Eleventy uses it too), or turn the cache off with `hashCache: false` on the
`ssqch:image` plugin (`ImageOptions::hash_cache` in Rust). It lives outside the output folder
because it names your source paths, and the output gets published.

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

The ReverentGeek blog builds two ways: from its real `.eleventy.js` (the one-line
`ssqch.config.js` above), and from the Rust port in `examples/reverentgeek`. Both were compared
file by file with Eleventy 4.0.0-alpha.10's build of the same source, all three built with
`TZ=UTC` (as on Netlify) and AVIF on:

- The two ssqch builds are identical on all 183 files.
- Against Eleventy, the file set is the same, the blog's `test/smoke.test.js` passes, and
  `sitemap.xml`, `_headers`, `_redirects`, `robots.txt`, `llms.txt` and `webfinger` are
  byte-identical.
- 169 of 182 files are identical once image file names (each tool hashes its own), attribute
  order, and the minifier differences listed below are ignored. The other 13:
  - **Animated GIFs stay animated** (11 pages). eleventy-img (without `sharpOptions.animated`)
    keeps only the first frame; ssqch copies GIFs for `auto` output.
  - **SVGs are served as SVGs** (`/portfolio/`). eleventy-img also rasterizes them to AVIF and
    WebP.
  - **`feed.xml`:** raw `<br />` and `<img ... />` that a post's author wrote stay as written;
    Eleventy's RSS plugin reserializes them as `<br>`. The posts' text is otherwise identical.

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
- The minifier doesn't rewrite attribute values like html-minifier does (`defer="defer"`, spaces
  in a viewport `content`).
- Images: no SVG rasterizing, and no color-profile conversion (profiles are dropped).
- Custom collections see pages that aren't paginated over collections. Pages paginated over
  collections are added to `all`/tags afterwards.
- No `eleventy-plugin-broken-links` equivalent. The output directory isn't cleaned (like Eleventy).
- `{{ eleventy.version }}` renders SiteSquatch's version.
