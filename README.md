# SiteSquatch

[![CI](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml/badge.svg)](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/reverentgeek/sitesquatch)](https://github.com/reverentgeek/sitesquatch/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

SiteSquatch (`ssqch`) is a static site generator that fits in a single binary. You write templates in [Edge.js](https://edgejs.dev) and Markdown, configure the site in JavaScript, and `ssqch build` turns it all into plain HTML. No Node required at all: the JavaScript runs on an engine built into `ssqch`.

It's quick, too. [reverentgeek.com](https://reverentgeek.com) (168 pages, a feed, a sitemap and about 4,700 responsive image files) rebuilds in about **0.1 s** once its images are cached. See [Benchmarks](#benchmarks) for the details.

What's in the box:

- **A data cascade, layouts, collections, pagination and permalinks**, so a blog or docs site needs no custom code.
- **A JavaScript config** with filters, global data, custom collections, transforms and build hooks, plus the Node built-ins configs usually reach for (`fs`, `path`, `url`, `process`, `Buffer`).
- **Responsive images:** every `<img>` becomes a `<picture>` with AVIF, WebP and fallback sources, cached by content so later builds skip the encoding.
- **RSS helpers, HTML minification, asset fingerprinting, a link checker** and a dev server with live reload.
- **A Rust API** for when JavaScript isn't enough: custom template engines, heavy transforms, or a whole site as its own binary.

SiteSquatch is young (0.x), so expect some breaking changes between minor versions. Each one is listed in the [changelog](CHANGELOG.md) with what you'd need to change.

## Install

On **Linux (x86_64)** and **macOS** (Apple Silicon or Intel), install the prebuilt binary with the installer script. The Linux binary is statically linked, so it runs on any distribution:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.sh | sh
```

On **Windows (x86_64)**, use the PowerShell installer:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.ps1 | iex"
```

The installers check the download's SHA-256 checksum, install `ssqch` into `$CARGO_HOME/bin` (usually `~/.cargo/bin`), and add that folder to your `PATH`. Every release binary runs a smoke test on its own platform before it's published. To pin a version, as you'd want in CI, use that release's installer instead: replace `latest/download` with `download/v0.2.7`. You can also download an archive for your platform from the [releases page](https://github.com/reverentgeek/sitesquatch/releases), or, if you use [cargo-binstall](https://github.com/cargo-bins/cargo-binstall), run `cargo binstall ssqch` to fetch the same archive.

On other platforms (Linux on ARM, say), build it from [crates.io](https://crates.io/crates/ssqch) with a recent stable [Rust toolchain](https://rustup.rs):

```sh
cargo install ssqch --locked --features avif
```

> **Note:** AVIF support on an x86_64 machine needs the [nasm](https://nasm.us) assembler installed first (`brew install nasm`, `apt-get install nasm`, `choco install nasm`). ARM machines don't need it. Leave off `--features avif` to skip AVIF, and the build gets faster too.

Check that it worked:

```sh
ssqch --version
```

## Build your first site

The quickest start is `ssqch init`, which creates a starter site (a config, a layout, a home page, a post, a data file, and editor types) and then gets out of the way:

```sh
ssqch init my-site
cd my-site && ssqch serve
```

Open <http://localhost:8080>, edit `src/posts/hello-world.md`, and watch the page reload. `ssqch init` never overwrites a file that's already there, so it's safe to run in a folder you've started.

To see how the pieces fit, here's a tiny site built by hand: a home page that lists posts. Here's the whole thing:

```text
ssqch.config.js
src/
  _includes/layout.edge
  index.edge
  posts/pine-cone-crunch.md
```

### Step 1: The config

`ssqch.config.js` sits in your project root. This one reads templates from `src`, writes to `dist`, and adds a `shout` filter:

```js
// ssqch.config.js
import { defineConfig } from "ssqch";

export default defineConfig({
  dirs: { input: "src", output: "dist" },
  filters: {
    shout: (text) => `${text.toUpperCase()}!`,
  },
});
```

### Step 2: A layout

Layouts live in `src/_includes`. `{{{ content }}}` (three braces, so it isn't escaped) is where each page's body goes:

```html
<!-- src/_includes/layout.edge -->
<!doctype html>
<html lang="en">
  <head><title>{{ title }}</title></head>
  <body>
    <main>{{{ content }}}</main>
  </body>
</html>
```

### Step 3: A post and a home page

Front matter sets each page's data. Tagging the post `posts` puts it in `collections.posts`:

```markdown
<!-- src/posts/pine-cone-crunch.md -->
---
layout: layout.edge
title: Pine Cone Crunch
tags: posts
---
Crunchy, foresty, and only slightly sticky.
```

The home page uses the filter and loops over the posts:

```html
<!-- src/index.edge -->
---
layout: layout.edge
title: Squatch Snacks
---
<h1>{{ shout(title) }}</h1>
<ul>
  @each(post in collections.posts)
    <li><a href="{{ post.url }}">{{ post.data.title }}</a></li>
  @end
</ul>
```

### Step 4: Build it

```sh
ssqch build
```

You'll see a line for each page, then a summary:

```text
[ssqch] Writing ./dist/index.html from ./src/index.edge (edge)
[ssqch] Writing ./dist/posts/pine-cone-crunch/index.html from ./src/posts/pine-cone-crunch.md (edge, md)
Built in 2.75 ms (production)
  Pages   2 written from 2 templates, 401 B
  Output  dist: 2 files, 401 B
  Time    setup 224 µs, data 435 µs, read 1.54 ms, paginate 45 µs, render 205 µs, write 282 µs, copy 0 µs, after 20 µs
```

`dist/index.html` has a `SQUATCH SNACKS!` heading and a link to `/posts/pine-cone-crunch/`. You've got a website!

To work on it with live reload, run the dev server and open <http://localhost:8080>:

```sh
ssqch serve
```

`ssqch serve` rebuilds when your sources change and reloads the browser. It also reloads (without a rebuild) when another tool, like a PostCSS or esbuild watcher, writes a CSS or JavaScript file into the output folder, so the page never reloads before its new CSS is there.

`ssqch build` uses production mode and `ssqch serve` uses development mode, unless you pass `--env development|production` (or set `$SSQCH_ENV` or `$NODE_ENV`). The other options are `--output DIR`, `--port N` for `serve`, `--quiet` to print only warnings and errors, and `--verbose` to also list the slowest images to encode.

## Configuring a site

> **Pro tip:** run `ssqch types` to write `ssqch.d.ts`, and list it in `jsconfig.json`'s `"include"` (`ssqch init` does both). Your editor then autocompletes config keys and plugin options, and underlines mistakes like `ouput` or `linksPlugin({ fail: "yes" })`, without any npm packages. Run it again after upgrading ssqch.

Here's a fuller config, with data, a custom collection and the built-in plugins:

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
    favorites: (pages) => pages.byTag("snacks").filter((p) => p.data.stars > 3),
  },

  plugins: [
    rssPlugin(),
    imagePlugin({ widths: [300, 600, 1200], formats: ["webp", "auto"] }),
    env === "production" && minifyPlugin(),
  ],
}));
```

The default export is the config: an object, or a function (sync or async) that gets `{ env, serving }` and returns one. `defineConfig` returns whatever you give it; it's there so the file reads like a config. Every key is optional:

| Key | What it does |
| --- | --- |
| `dirs` | `input` (default `.`), `output` (`_site`), and `includes` (`_includes`) and `data` (`_data`), relative to the input. |
| `templateFormats` | File extensions to render (default `["edge", "md", "html"]`). |
| `markdownEngine`, `htmlEngine` | The engine that runs over `.md` and `.html` files first (default `"edge"`; `false` for none). |
| `deepMerge` | Merge objects and concatenate arrays through the data cascade (default `true`). |
| `clean` | Delete stale files from the output: pages and passthrough files an earlier build wrote that this one didn't, like a deleted post (default `false`). ssqch keeps a list of what it writes in `.cache/ssqch/output-files.json`, so files other tools write into the output (your CSS build, say) are never touched. |
| `filters` | `{ name: function }`, callable from templates: `{{ slug(title) }}`. Async functions are awaited. |
| `data` | `{ name: value }` for every template. A function (sync or async) is called on each build. |
| `collections` | `{ name: (pages) => ... }`. `pages` has `all()`, `byTag(tag)`, `byTags(...tags)` and `byGlob(glob or globs)`, oldest first. |
| `transforms` | `{ name: (content, page) => content }`, run on every output file. `page` has `url`, `inputPath` and `outputPath`. Return the content, changed or not. Async works. |
| `engines` | Template engines of your own: `{ extension: (source, data) => html }`, or an object with a `render(source, data)` method (async is fine). Add the extension to `templateFormats` to render those files; layouts in that extension work too, and `markdownEngine` can name one. `edge`, `md`, `html` and `txt` can't be replaced. |
| `passthrough` | Files or folders to copy: a path, or `{ from: to }`, or an array of them. |
| `watch` | More paths for `ssqch serve` to watch. |
| `beforeBuild`, `afterBuild` | Build hooks (a function or an array). They get `{ env, serving, dirs }`, plus `written` (the files written) after the build. Async works. |
| `plugins` | More config: objects with any of the keys above except the settings (`dirs`, `templateFormats`, `markdownEngine`, `htmlEngine`, `deepMerge`, `clean`), or functions that return one. `false`, `null` and `undefined` are skipped, so `env === "production" && minifyPlugin()` works. Give a plugin a `name` and errors will mention it. |

Mistakes get caught early. A misspelled key or option is an error, and so are two plugins that define the same filter, data or collection name (the message names both). When something in your code throws, you get `ssqch.config.js: too many pine cones` and a stack trace that points at your file, like `at bad (lib/filters.js:3:9)`.

### What you can import

Config and data files can import relative files (`./lib/filters.js`, with or without the extension), JSON (`import site from "./site.json"`), the built-in modules (`ssqch`, `ssqch/image`, `ssqch/rss`, `ssqch/minify`, `ssqch/assets`, `ssqch/links`), and these Node built-ins, with or without the `node:` prefix:

| Module | What's there |
| --- | --- |
| `node:fs` | `readFileSync`, `writeFileSync`, `appendFileSync`, `existsSync`, `statSync`, `lstatSync`, `readdirSync` (with `withFileTypes`), `mkdirSync`, `rmSync`, `unlinkSync`, `renameSync`, `copyFileSync`, `realpathSync`, `accessSync`, and `fs.promises` |
| `node:fs/promises` | The async versions of the above |
| `node:path` | All of `path.posix`, matching Node's results on [a set of edge cases](crates/sitesquatch-js/tests/fixtures/path-cases.mjs) |
| `node:url` | `fileURLToPath`, `pathToFileURL` (and `import.meta.url` is set) |
| `node:crypto` | `createHash` with `md5`, `sha1`, `sha256`, `sha384` and `sha512` (`update()` with strings or Buffers, `digest()` to a Buffer or `hex`, `base64`, `base64url` or `latin1`), and `getHashes()` |
| `node:process`, `node:buffer` | `process.env`, `process.cwd()`, `process.platform`, and `Buffer` (also a global) with `utf8`, `hex`, `base64`, `base64url` and `latin1` |

Errors carry Node's codes (`err.code === "ENOENT"`), and relative paths resolve against the project root, as if you ran Node from there. Dates and numbers format like Node does for `en-US`: `toLocaleDateString()`, `toLocaleString()`, `Intl.DateTimeFormat` and `Intl.NumberFormat` match Node 24 on [902 cases](crates/sitesquatch-js/tests/fixtures/intl-cases.mjs). Other locales, and time zones other than UTC and the machine's, throw an error rather than quietly formatting something else.

> **Note:** these aren't supported yet: npm packages, CommonJS (`require`, `module.exports`), other Node built-ins (such as `node:http`), timers and `fetch`. After editing the config, restart `ssqch serve` to pick up the changes.

The config runs on [QuickJS](https://github.com/quickjs-ng/quickjs), which adds about 1.2 MB to the binary and supports modern JavaScript: ES modules, `async`/`await`, arrow functions and the standard built-ins. Template values arrive as ordinary-looking objects, arrays and `Date`s. Behind the scenes, big ones (a page's data, a collection) are lazy views that only copy a property from Rust when you read it, so passing `collections.posts` to a filter costs nothing until the filter looks inside. Changes you make stay in JavaScript: a filter that sorts `collections.posts` doesn't reorder it for other pages. Pages render in parallel, but JavaScript runs one call at a time, so module-level state in your config behaves as it would in Node.

### JavaScript data files

`_data/*.js` files are global data, and `*.data.js` files next to a template or in a folder (`posts/posts.data.js`) are template and directory data. The default export is the data, or a function (sync or async) that returns it:

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

Data functions run on every build. `ssqch serve` reloads a data file when it changes (the files it imports stay cached until you restart). Data files work in TOML-configured sites too.

### Built-in plugins

- **`ssqch/image`:** `imagePlugin(options)` turns every local `<img>` in HTML output into a `<picture>`. Options: `formats` (`avif`, `webp`, `jpeg`, `png`, `auto`), `widths`, `defaultAttributes`, `outputDir`, `urlPath`, `webpQuality`, `avifQuality`, `avifSpeed`, `jpegQuality`, `minimumThreshold`, `prune`, `hashCache` and `linkedImages`. On an `<img>`, `ssqch:widths="300,600"` picks that image's widths, a plain `width` attribute pins it to one width, and `ssqch:ignore` leaves it alone. Images with a color profile other than sRGB (Display P3, Adobe RGB) are converted to sRGB first, so their colors stay true. A link to a local image (`<a href="/photos/big.jpg">`, the click-to-enlarge pattern) is pointed at a generated copy in the image's own format, at its own width capped at the largest of `widths`, so the link works without publishing the source file; `ssqch:ignore` on the `<a>`, or `linkedImages: false`, leaves links alone. `image(src, { widths, formats })` makes one image's files with the same settings and cache, returning `{ webp: [{ url, width, height, srcset, sourceType, ... }] }`. Data files can call it even without the plugin.
- **`ssqch/minify`:** `minifyPlugin(options)` minifies HTML output, after the image transform. `minify(html, options)` does the same for a string. Options: `collapseWhitespace`, `removeComments`, `shortDoctype` and `shortenAttributes` (all `true` by default). `shortenAttributes` drops the values of boolean attributes (`defer="defer"` becomes `defer`) and whitespace that doesn't matter in `class`, `srcset`, `sizes`, URL attributes and the viewport `<meta>`.
- **`ssqch/rss`:** `rssPlugin()` adds the filters `getNewestCollectionItemDate`, `dateToRfc3339`, `dateToRfc822`, `absoluteUrl`, `htmlToAbsoluteUrls` and `url`. They're also named exports, for your own code.
- **`ssqch/assets`:** `assetsPlugin({ files })` fingerprints CSS and JS for long-lived caching. Templates link the plain paths (`<link rel="stylesheet" href="/assets/index.css">`). In a production build, each listed file in the output folder (written there by your CSS or JS tool before `ssqch build`) is renamed to `index.<hash>.css`, older fingerprinted copies are deleted, and every `href` and `src` in the HTML that points at it is rewritten, keeping any query string. `ssqch serve` leaves the plain paths alone. A listed file that's missing fails a production build. `assetUrl("/assets/index.css")` returns the URL to use, for places outside an `href` or `src`. `url()` references inside CSS and imports inside JavaScript aren't rewritten. Options: `files` (URL paths, required) and `fingerprint` (`true` or `false`; on for production builds by default).
- **`ssqch/links`:** `linksPlugin(options)` checks the built site's internal links after each build. Every `href` (on `a`, `link` and `area`), `src` (images, scripts, iframes, media) and `srcset` URL has to point at something in the output, and a `#fragment` has to match an `id` on the page it points to. External links aren't checked, and neither are paths a Netlify `_redirects` file in the output covers. Broken links fail production builds, listing each page and link, and are warnings in `ssqch serve`. Options: `anchors` (check `#fragments`; default `true`), `ignore` (URL path prefixes to skip, like `["/downloads/"]`) and `fail` (`true` or `false`; production builds only by default).

### Configuring with TOML

A site that needs no code at all can use a `sitesquatch.toml` instead (one or the other, not both). Every key is optional; `crates/sitesquatch/src/site_toml.rs` has the full list.

```toml
input = "src"
output = "public"
template_formats = ["edge", "md", "html"]

[passthrough]
"src/robots.txt" = ""   # empty keeps the path relative to the input directory
```

## Templates and data

Here's what's supported:

- **The data cascade**, from lowest to highest priority: global `_data` files (JSON, YAML, TOML or JavaScript), layout front matter, directory data, template data files, front matter, then `computed`. Objects merge and arrays concatenate, unless `deepMerge` is off.
- **Collections:** tags become collections, sorted by date, plus your custom ones. `excludeFromCollections: true` keeps a page out.
- **Pagination:** `data`, `size`, `alias`, `reverse`, `filter`, `addAllPagesToCollections` and hrefs.
- **Permalinks:** dynamic permalinks, `permalink: false` and `dynamicPermalink`.
- **Choosing engines:** `.md` files run through Edge first, then Markdown (change that with `markdownEngine` and `htmlEngine`). A template's `render` front matter overrides it: `render: md` for Markdown only (handy for a post full of `{{ }}` code samples), `render: [edge, md]` for a chain, or `render: false` to write the body as it is.
- **Everything else:** layout chaining, `page.*`, `templateContent` in collections, and an error when two pages would write the same file. Every template can read `ssqch.version`, `ssqch.env`, `ssqch.serving` and `ssqch.generator`.

Edge.js support covers `{{ }}`, `{{{ }}}`, `{{-- --}}`, `@{{ }}`, `@if/@elseif/@else/@unless`, `@each` (with index, objects, `@else` and `$loop`), `@let`, `@assign`, `@include`, `@includeIf`, `@component`/`@!component` with named slots and isolated scope, and `~` whitespace control. Newlines and escaping match Edge.js 6.5 on [42 whitespace cases](crates/sitesquatch-edge/tests/fixtures/whitespace-cases.json). One difference: an undefined value prints nothing, where Edge.js prints `undefined`.

Expressions cover object and array literals (with shorthand and spread), template literals, optional chaining, arrow functions, ternaries, `??`, `typeof`, `await` (a no-op), `new Date()`, the common String, Array, Number and Date methods, and the `JSON`, `Object`, `Math` and `Array` globals. Errors report `template:line` through the include and component chain.

## Reading the build summary

Every build ends with a summary. Here's the ReverentGeek blog with its images cached:

```text
Built in 110 ms (production)
  Pages   168 written from 140 templates, 6.83 MB
  Copied  0 files, 12 unchanged, 3.88 MB
  Images  4,689 files from 737 sources, 271 MB: 0 encoded, 4,689 reused
  Output  dist: 4,872 files, 282 MB
  Time    setup 1.11 ms, data 1.31 ms, read 32.3 ms, paginate 2.81 ms, render 7.56 ms, write 55.9 ms, copy 193 µs, after 9.21 ms
```

- **Images** counts the image files this build used, the source images they came from, and how many had to be encoded. With `prune` on, it also says how many stale files it deleted.
- **Output** is everything in the output folder, including files left from earlier builds.
- **Time** splits the build into phases. `write` includes layouts, transforms and image encoding, so a build that encodes images spends most of its time there. `after` is the `afterBuild` hooks.

`ssqch serve` prints the same summary after every rebuild.

## Deploying

### Keep the image cache between builds

Encoding images is by far the slowest part of a build, so it's worth never doing it twice. Each image file is named by a hash of the source image's contents and the encoder settings, not its path or modification time. Restore the output's `img/` folder from the last build, and a build with no new images encodes nothing, even on a fresh clone in CI.

ssqch also remembers each source image's hash, size and modification time in `.cache/ssqch/image-hashes.json`, so unchanged images aren't read again. Cache that folder too. (A fresh clone gives every file a new modification time, so its first build re-hashes everything, which takes about 20 ms on the blog's 420 MB of images.) Add `.cache/` to your `.gitignore`, or turn the hash cache off with `hashCache: false`. It's kept outside the output folder because it names your source paths, and the output gets published.

Set `prune: true` on `imagePlugin()` to delete image files the build didn't use, so the cache doesn't keep growing as images change. Only turn it on for full builds, where every image goes through the image plugin.

### Netlify

Netlify can build the site itself, with no deploy token to manage. This is the ReverentGeek blog's `netlify.toml` (it builds its CSS and JavaScript with npm scripts first, so it runs `pnpm run build`; a site without that step can run `.cache/bin/ssqch build` instead):

```toml
[build]
  command = "curl --proto '=https' --tlsv1.2 -fsSL https://github.com/reverentgeek/sitesquatch/releases/download/v$SSQCH_VERSION/ssqch-installer.sh | SSQCH_UNMANAGED_INSTALL=.cache/bin sh && SSQCH_BIN=.cache/bin/ssqch pnpm run build && node --test test/smoke.test.js"
  publish = "dist/"

[build.environment]
  NODE_VERSION = "24"
  SSQCH_VERSION = "0.2.1"

[[plugins]]
  package = "netlify-plugin-cache"
  [plugins.inputs]
    paths = ["dist/img", ".cache/ssqch"]
```

- **`SSQCH_VERSION`** pins the release, so a new SiteSquatch version can't surprise a deploy. Bump it when you're ready.
- **`SSQCH_UNMANAGED_INSTALL=.cache/bin`** installs the binary into that folder and leaves shell profiles alone.
- **[`netlify-plugin-cache`](https://github.com/jakejarvis/netlify-plugin-cache)** carries the image files and the hash cache over to the next build. Add it to your `devDependencies`.

On the blog, the first Netlify build (which encoded every image) took about 4 minutes, and the next one took 18 seconds, including Netlify's own setup.

## Benchmarks

These numbers come from building the ReverentGeek blog (161 HTML pages plus a feed, a sitemap and Netlify files) on an Apple M5 Pro (15 cores) in November 2026, in production mode with HTML minification on. Each build wrote to its own output folder, so no image cache was shared.

| Build | Rust port (no AVIF) | Rust port, `--features avif` | `ssqch` with the JavaScript config (AVIF) |
| --- | --- | --- | --- |
| **Cold** (no images cached) | **8.0 s** | **30.8 s** | **25.0 s** |
| CPU time, cold (user + sys) | 79 s | 323 s | 335 s |
| Peak memory, cold | 1.41 GB | 1.54 GB | 1.80 GB |
| **Warm** (images cached, median of 3) | **0.09 s** | **0.10 s** | **0.16 s** |
| Peak memory, warm | ~52 MB | ~50 MB | ~47 MB |
| Image files written | 3,160 (233 MB) | 4,689 (268 MB) | 4,689 (268 MB) |

- **Warm builds** are what the dev server and cached CI builds do. Wall times include starting the process.
- **The JavaScript config** costs about 70 ms more than the Rust port on a warm build: that's the blog's collections, filters and data files running in QuickJS. These were measured before the blog's config moved to `defineConfig`; it runs the same code.
- **Cold builds** are mostly image encoding, and AVIF is the most expensive format. They're single runs and vary: the two AVIF builds do the same work, and AVIF cold builds ranged from 21 s to 31 s across four runs. ssqch encodes AVIF with ravif at speed 8 (`avifSpeed`).
- Only site generation is measured, not building the CSS and JavaScript.

On a 4-core GitHub Actions runner, the v0.2.1 release builds the blog in about 0.3 s warm and 4m 45s cold.

To reproduce the table on macOS, run `scripts/bench.sh [path/to/blog] [warm-runs]` (the blog defaults to `../blog`). It works on a copy-on-write clone of the blog in a temporary folder, so your copy is never touched, and writes `results.csv`, `bench.log` and `summary.txt` to `bench-results/<timestamp>/`.

## Extending SiteSquatch in Rust

When JavaScript isn't enough, a site can be its own small Rust binary. `examples/reverentgeek` builds the ReverentGeek blog this way:

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

A plugin implements `sitesquatch::Plugin` (any `Fn(&mut Config)` works too) and registers things on the `Config`:

| Rust API | In `ssqch.config.js` |
| --- | --- |
| `add_filter`, `add_global` | `filters` (Edge globals) |
| `add_global_data(name, \|ctx\| ...)` | `data`, or a JavaScript file in `_data/` |
| `add_collection(name, \|api\| ...)` | `collections` (`all`, `by_tag`, `by_tags`) |
| `add_transform(name, \|ctx, html\| ...)` | `transforms` |
| `add_template_engine(ext, factory)` | not available (Markdown and Edge use this same trait) |
| `on_before_build`, `on_after_build` | `beforeBuild`, `afterBuild` |
| `add_passthrough_copy[_to]`, `add_watch_target` | `passthrough`, `watch` |
| `add_summary(label, \|ctx\| ...)` | not available (adds a line to the build summary) |

Plugins can share services. The image plugin exposes an `ImageProcessor`, and the blog's plugin uses it for its hero image data and its `socialImage` filter.

## Working on SiteSquatch

```text
crates/ssqch             The `ssqch` command-line tool
crates/sitesquatch       Generator core, CLI and dev server, as a library
crates/sitesquatch-edge  Edge.js template engine (parser + JavaScript expression evaluator)
crates/sitesquatch-js    ssqch.config.js support, on an embedded QuickJS engine
plugins/rss              Feed filters: getNewestCollectionItemDate, dateToRfc3339/822, absoluteUrl, htmlToAbsoluteUrls, url
plugins/image            <img> -> responsive <picture>, and image() for data files
plugins/minify           Conservative HTML minifier
plugins/assets           Asset fingerprinting: content-hashed names and rewritten references
plugins/links            Link checker: internal links and anchors in the built site
examples/reverentgeek    The blog's config ported to Rust, as an example of the Rust API
```

Run the tests with `cargo test --workspace` (add `--features ssqch/avif` to include the AVIF encoder). [CI](.github/workflows/ci.yml) runs them on Linux and macOS, with and without AVIF, plus `cargo clippy` with warnings as errors.

The ReverentGeek blog is the real-world test site. To build it with your changes, clone it next to this repository and use its own build script, which also builds the CSS and JavaScript:

```sh
git clone https://github.com/reverentgeek/blog.git ../blog
cargo build --release -p ssqch --features avif
(cd ../blog && pnpm install && SSQCH_BIN=../ssqch/target/release/ssqch pnpm test)
```

`pnpm test` builds the site and runs the blog's smoke tests. The first build encodes every image, so give it a few minutes; later builds reuse them.

Releases are built by [`dist`](https://opensource.axo.dev/cargo-dist/) from a version tag. The steps are in [`CLAUDE.md`](CLAUDE.md#releasing).

## Known gaps

- **JavaScript:** no npm packages or CommonJS yet (see the note under [Configuring a site](#configuring-a-site)). JavaScript is interpreted (QuickJS has no JIT), so heavy collection code is slower than in Node: reading a page in a collection costs about 2 µs the first time, and the blog's `topics` and `postsByYear` collections over 2,000 posts take about 45 ms together.
- **Edge:** no `@inject`, `@debugger`, `@svg`, components as tags (`@!card()`), destructuring in `@let`, scoped slots, regex literals, or the `in` operator. Array `reverse` and `sort` return copies instead of changing the array.
- **Markdown:** pulldown-cmark with tables and strikethrough, adjusted to match markdown-it (`<s>`, a single `~` left as it is, `<img>`, `<hr>` and `<br>` without a slash, table alignment styles, line breaks in alt text).
- **Images:** no SVG rasterizing, and HDR photos (the PQ, gain-map profiles of newer iPhones) can't be converted to sRGB, so they look washed out; the build warns about them, and converting the source to sRGB once fixes it. SVGs are served as they are, and GIFs are copied for `auto` output, so animations keep working.
- **Collections:** custom collections don't see pages that are paginated over collections. Those pages are added to `all` and their tags afterwards.
- **Platforms:** prebuilt binaries cover Linux x86_64, macOS and Windows x86_64, but not Linux on ARM yet; see [TODO.md](TODO.md) for what's next.

Found a bug, or have an idea? [Open an issue](https://github.com/reverentgeek/sitesquatch/issues). Happy building, and may your pages load faster than a Squatch sighting disappears.
