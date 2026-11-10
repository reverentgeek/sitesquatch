# SiteSquatch

[![CI](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml/badge.svg)](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/reverentgeek/sitesquatch)](https://github.com/reverentgeek/sitesquatch/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

SiteSquatch (`ssqch`) is a static site generator that fits in a single binary. You write templates in [Edge.js](https://edgejs.dev), [Liquid](https://shopify.github.io/liquid/), [Nunjucks](https://mozilla.github.io/nunjucks/), [Jinja](https://jinja.palletsprojects.com/), [Handlebars](https://handlebarsjs.com/) or [Mustache](https://mustache.github.io/), plus Markdown, configure the site in JavaScript, and `ssqch build` turns it all into plain HTML. No Node required at all: the JavaScript runs on an engine built into `ssqch`.

It's quick, too. [reverentgeek.com](https://reverentgeek.com) (168 pages, a feed, a sitemap and about 4,700 responsive image files) rebuilds in about **0.1 s** once its images are cached. See [Benchmarks](#benchmarks) for the details.

What's in the box:

- **A data cascade, layouts, collections, pagination and permalinks**, so a blog or docs site needs no custom code.
- **A JavaScript config** with filters, global data, custom collections, transforms and build hooks, plus npm packages, `fetch` (with a cache) and the Node built-ins configs usually reach for.
- **Markdown that does the work of a plugin stack:** heading ids, footnotes, containers, render hooks in any template language, and syntax highlighting at build time.
- **Responsive images:** every `<img>` becomes a `<picture>` with AVIF, WebP and fallback sources, cached by content so later builds skip the encoding.
- **Checks that run with every build:** [content schemas](#content-schemas) for front matter, a link checker, [`ssqch diff`](#comparing-two-builds) to see what a change did to the output, and [`ssqch inspect`](#where-a-value-comes-from) to see where a page's data came from.
- **Themes without a package manager, custom elements that load only where they're used**, Sass, a sitemap, redirects, RSS helpers, HTML minification and asset fingerprinting.
- **A quick start and a way in:** `ssqch init` (a blog, or a docs site with a sidebar and search), `ssqch import` for Eleventy and Zola sites, [`ssqch new`](#starting-a-new-page) for the next post, and a dev server that reloads pages and the config.
- **A Rust API** for when JavaScript isn't enough: custom template engines, heavy transforms, or a whole site as its own binary.

SiteSquatch is young (0.x), so expect some breaking changes between minor versions. Each one is listed in the [changelog](CHANGELOG.md) with what you'd need to change.

## Install

On **Linux (x86_64)** and **macOS** (Apple Silicon or Intel), install the prebuilt binary with the installer script. The Linux binary is statically linked, so it runs on any distribution:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.sh | sh
```

With [Homebrew](https://brew.sh) (macOS or Linux):

```sh
brew install reverentgeek/tap/ssqch
```

On **Windows (x86_64)**, use the PowerShell installer:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.ps1 | iex"
```

The installers check the download's SHA-256 checksum, install `ssqch` into `$CARGO_HOME/bin` (usually `~/.cargo/bin`), and add that folder to your `PATH`. Every release binary runs a smoke test on its own platform before it's published. To pin a version, as you'd want in CI, use that release's installer instead: replace `latest/download` with `download/v0.3.4`. You can also download an archive for your platform from the [releases page](https://github.com/reverentgeek/sitesquatch/releases), or, if you use [cargo-binstall](https://github.com/cargo-bins/cargo-binstall), run `cargo binstall ssqch` to fetch the same archive.

On other platforms (Linux on ARM, say), build it from [crates.io](https://crates.io/crates/ssqch) with a recent stable [Rust toolchain](https://rustup.rs):

```sh
cargo install ssqch --locked --features avif
```

In **GitHub Actions**, [`reverentgeek/setup-ssqch`](https://github.com/reverentgeek/setup-ssqch) installs a pinned version on Linux, macOS and Windows runners:

```yaml
- uses: reverentgeek/setup-ssqch@v1
  with:
    version: 0.3.4
- run: ssqch build
```

> **Note:** AVIF support on an x86_64 machine needs the [nasm](https://nasm.us) assembler installed first (`brew install nasm`, `apt-get install nasm`, `choco install nasm`). ARM machines don't need it. Leave off `--features avif` to skip AVIF, and the build gets faster too.

Check that it worked:

```sh
ssqch --version
```

## Build your first site

The quickest start is `ssqch init`, which creates a starter site (a config, a layout, a home page, a post, a data file, an archetype for the next post, and editor types) and then gets out of the way:

```sh
ssqch init my-site
cd my-site && ssqch serve
```

Open <http://localhost:8080>, edit `src/posts/hello-world.md`, and watch the page reload. `ssqch init` never overwrites a file that's already there, so it's safe to run in a folder you've started.

The layout and home page are [Edge](#templates-and-data) templates. To start in another language, pass `--engine liquid`, `--engine njk` (Nunjucks) or `--engine hbs` (Handlebars); the config then lists that engine in `templateFormats` and runs Markdown through it.

Writing documentation? `ssqch init my-docs --starter docs` creates a docs site instead: a sidebar, breadcrumbs and previous/next links from one `nav.yml`, a table of contents on each page, notes and tabs, highlighted code, a schema that checks each page's front matter, the link checker, and Pagefind search with `SEARCH=1`. The pages are plain HTML that reads fine without JavaScript (a small script turns tab sections into tabs), and every file is yours to edit: there's no theme package underneath.

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

Layouts live in `src/_includes`. In `src/_includes/layout.edge`, `{{{ content }}}` (three braces, so it isn't escaped) is where each page's body goes:

```html
<!doctype html>
<html lang="en">
  <head><title>{{ title }}</title></head>
  <body>
    <main>{{{ content }}}</main>
  </body>
</html>
```

### Step 3: A post and a home page

Front matter sets each page's data, and it has to come first in the file. Tagging the post `posts` puts it in `collections.posts`. Save this as `src/posts/pine-cone-crunch.md`:

```markdown
---
layout: layout.edge
title: Pine Cone Crunch
tags: posts
---
Crunchy, foresty, and only slightly sticky.
```

The home page, `src/index.edge`, uses the filter and loops over the posts:

```html
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

`ssqch build` uses production mode and `ssqch serve` uses development mode, unless you pass `--env development|production` (or set `$SSQCH_ENV` or `$NODE_ENV`). The other options are `--output DIR`, `--base /path/` to serve the site [under a path](#serving-a-site-under-a-path), `--offline` to answer `fetch()` from saved copies only, `--port N` for `serve` (0 picks a free port), `--quiet` to print only warnings and errors, and `--verbose` to also list the slowest images to encode. The other commands are `ssqch init`, `ssqch types`, [`ssqch new`](#starting-a-new-page), [`ssqch inspect`](#where-a-value-comes-from), [`ssqch diff`](#comparing-two-builds), [`ssqch import`](#moving-from-another-generator) and [`ssqch capabilities`](#scripts-and-coding-agents), and `ssqch build --format json` reports to a [script or a coding agent](#scripts-and-coding-agents).

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
| `dirs` | `input` (default `.`), `output` (`_site`), and `includes` (`_includes`), `layouts` (the includes folder) and `data` (`_data`), relative to the input. |
| `templateFormats` | File extensions to render (default `["edge", "md", "html"]`). |
| `markdownEngine`, `htmlEngine` | The engine that runs over `.md` and `.html` files first (default `"edge"`; `false` for none). |
| `markdown` | Heading IDs, footnotes and the other Markdown extensions; see [Markdown](#markdown). |
| `deepMerge` | Merge objects and concatenate arrays through the data cascade (default `true`). |
| `clean` | Delete stale files from the output: pages and passthrough files an earlier build wrote that this one didn't, like a deleted post (default `false`). ssqch keeps a list of what it writes in `.cache/ssqch/output-files.json`, so files other tools write into the output (your CSS build, say) are never touched. |
| `filters` | `{ name: function }`, callable from templates: `{{ slug(title) }}`. Async functions are awaited. |
| `data` | `{ name: value }` for every template. A function (sync or async) is called on each build. |
| `collections` | `{ name: (pages) => ... }`. `pages` has `all()`, `byTag(tag)`, `byTags(...tags)` and `byGlob(glob or globs)`, oldest first. |
| `transforms` | `{ name: (content, page) => content }`, run on every output file. `page` has `url`, `inputPath` and `outputPath`. Return the content, changed or not. Async works. |
| `engines` | Template engines of your own: `{ extension: (source, data) => html }`, or an object with a `render(source, data)` method (async is fine). Add the extension to `templateFormats` to render those files; layouts in that extension work too, and `markdownEngine` can name one. `edge`, `md`, `html` and `txt` can't be replaced. |
| `ignore` | Globs, relative to the input folder, of files that aren't pages: `["drafts/**", "**/README.md"]`. |
| `bundles` | Page bundles: a folder whose page is `index.md` (or any `index.*` template) gets its other files, like photos and downloads, copied next to the page, so `![](photo.jpg)` just works. Subfolders with templates of their own, and data files, are left out (default `false`). |
| `strict` | Printing an undefined value (`{{ titel }}`) is an error that names the template and line, in every template language. Conditionals and defaults (`@if(subtitle)`, `{% if subtitle %}`, `x ?? "none"`) still work (default `false`). |
| `passthrough` | Files or folders to copy: a path, or `{ from: to }`, or an array of them. A path can be a glob: `"src/**/*.pdf"` keeps each file's own path, and `{ "assets/**/*.png": "images" }` puts them under `images/` by their path below `assets/`. |
| `watch` | More paths for `ssqch serve` to watch. |
| `beforeBuild`, `afterBuild` | Build hooks (a function or an array). They get `{ env, serving, dirs }`, plus `written` (the files written) after the build. Async works. A hook can also run a program: `afterBuild: { run: "npx -y pagefind --site dist" }` runs it in the project root (through `sh -c`, or `cmd /C` on Windows) with its output shown, and a failure fails the build. It gets `SSQCH_ENV`, `SSQCH_SERVING`, `SSQCH_INPUT` and `SSQCH_OUTPUT`. In `sitesquatch.toml`, `before_build` and `after_build` take lists of commands. |
| `theme` | A theme under the site: a folder (`"themes/docs"`), or a git repository pinned to a commit or tag (`"https://github.com/you/theme#v1.2.0"`). The site's own files win over the theme's, one by one. See [Themes](#themes). |
| `schemas` | What each kind of page's data has to look like, checked on every build: `{ posts: { fields: { title: "string", date: "date" } } }`. See [Content schemas](#content-schemas). |
| `base` | The path the site is served under, when that isn't the root of its domain: `base: "/repo/"` for a GitHub Pages project site at `https://you.github.io/repo/`. Templates, Markdown links and `page.url` stay as they are (`/about/`); ssqch adds the base to every URL from the site's root in the HTML it writes. See [Serving a site under a path](#serving-a-site-under-a-path). |
| `lastModified` | `page.lastModified`: `"git"` for when the page's file last changed in a commit (its modification time if it has uncommitted changes), or `"file"` for the modification time. Off by default. In CI, check out the full history (`fetch-depth: 0` in GitHub Actions), or every page gets the date of the last commit; the build warns about a shallow clone. |
| `plugins` | More config: objects with any of the keys above except the settings (`dirs`, `templateFormats`, `markdownEngine`, `htmlEngine`, `markdown`, `deepMerge`, `clean`, `ignore`, `bundles`, `strict`, `lastModified`, `base`, `schemas`, `theme`), or functions that return one. `false`, `null` and `undefined` are skipped, so `env === "production" && minifyPlugin()` works. Give a plugin a `name` and errors will mention it. |

Mistakes get caught early. A misspelled key or option is an error, and so are two plugins that define the same filter, data or collection name (the message names both). When something in your code throws, you get `ssqch.config.js: too many pine cones` and a stack trace that points at your file, like `at bad (lib/filters.js:3:9)`.

### What you can import

Config and data files can import relative files (`./lib/filters.js`, with or without the extension), JSON (`import site from "./site.json"`), npm packages from `node_modules`, the built-in modules (`ssqch`, which has `defineConfig`, `markdown(text, { inline })` and `readData(path)` for JSON, YAML and TOML files, `ssqch/image`, `ssqch/rss`, `ssqch/minify`, `ssqch/assets`, `ssqch/links`, `ssqch/sitemap`, `ssqch/redirects`, `ssqch/sass`), and these Node built-ins, with or without the `node:` prefix:

| Module | What's there |
| --- | --- |
| `node:fs` | `readFileSync`, `writeFileSync`, `appendFileSync`, `existsSync`, `statSync`, `lstatSync`, `readdirSync` (with `withFileTypes`), `mkdirSync`, `rmSync`, `unlinkSync`, `renameSync`, `copyFileSync`, `realpathSync`, `accessSync`, and `fs.promises` |
| `node:fs/promises` | The async versions of the above |
| `node:path` | All of `path.posix`, matching Node's results on [a set of edge cases](crates/sitesquatch-js/tests/fixtures/path-cases.mjs) |
| `node:url` | `fileURLToPath`, `pathToFileURL`, `URL`, `URLSearchParams`, and the legacy `parse`, `format` and `resolve` (and `import.meta.url` is set) |
| `node:crypto` | `createHash` with `md5`, `sha1`, `sha256`, `sha384` and `sha512` (`update()` with strings or Buffers, `digest()` to a Buffer or `hex`, `base64`, `base64url` or `latin1`), and `getHashes()` |
| `node:process`, `node:buffer` | `process.env`, `process.cwd()`, `process.platform`, `process.nextTick`, `process.hrtime`, and `Buffer` (also a global) with `utf8`, `hex`, `base64`, `base64url` and `latin1` |
| `node:module` | `createRequire(import.meta.url)`, `builtinModules`, `isBuiltin` |
| `node:util` | `format`, `inspect`, `promisify`, `callbackify`, `inherits`, `deprecate`, `isDeepStrictEqual`, `types` |
| `node:events` | `EventEmitter` (works with `util.inherits` and `EventEmitter.call(this)`) and `once` |
| `node:timers`, `node:timers/promises` | `setTimeout`, `setInterval`, `setImmediate` and their `clear` functions (also globals), and the promise versions |
| `node:os`, `node:assert`, `node:string_decoder` | `EOL`, `platform()`, `tmpdir()`, `homedir()` and the like; `assert` and `assert/strict`; `StringDecoder` |
| `node:http`, `node:https`, `node:stream`, `node:child_process`, and other server modules | Load, so packages that require them at the top still work, but their functions throw. `stream`'s classes can be extended but don't move data. |

Errors carry Node's codes (`err.code === "ENOENT"`), and relative paths resolve against the project root, as if you ran Node from there. Dates and numbers format like Node does for `en-US`: `toLocaleDateString()`, `toLocaleString()`, `Intl.DateTimeFormat` and `Intl.NumberFormat` match Node 24 on [902 cases](crates/sitesquatch-js/tests/fixtures/intl-cases.mjs), and `localeCompare` and `Intl.Collator` sort English text in Node's order. Other locales, and time zones other than UTC and the machine's, throw an error rather than quietly formatting something else.

> **Note:** `ssqch serve` reads the config again when it changes, or when a module it imports does (your own files, not packages in `node_modules`). If the new config has a mistake, the error is printed and the server carries on with the last one that loaded.

The globals include `fetch` (with `Headers`, `Request`, `Response`, `AbortController` and `AbortSignal.timeout()`), `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `EventTarget` and the timers. `fetch` follows redirects, decompresses gzip, and rejects with a `TypeError` naming the URL when a request fails. Requests run on threads of their own (up to 8 at once), so `await Promise.all(urls.map(u => fetch(u)))` fetches them in parallel. Only `http:` and `https:` URLs can be fetched.

A data file that fetches runs on every build, including each rebuild in `ssqch serve`. To keep an API from being asked every time, give the request a `cache`:

```js
// src/_data/snacks.js
export default async function () {
  const response = await fetch("https://api.example.com/snacks", { cache: "1h" });
  return response.json();
}
```

- **A duration** (`"90s"`, `"30m"`, `"1h"`, `"7d"`, `"2w"`, or seconds as a number): a successful response is saved in `.cache/ssqch/fetch/`, and requests reuse it until it's that old. The key is the method, URL, request headers and body, so another query or token is another entry. The URL, request headers and cookies aren't written to disk (an API key is usually in one of them), only the response.
- **When a refresh fails** (the network is down, or the server answers 5xx or 429) and there's an older copy, the build uses it and warns: `warn: fetch: https://api.example.com/snacks answered 503; using the copy saved 3 hours ago`. Without a copy, the failure is the response, as usual. `cache: "0s"` asks every time and keeps the copy only for that.
- **The standard modes** work too: `"force-cache"` (a copy of any age, else ask), `"reload"` (ask, and save), `"only-if-cached"` (a copy, or fail) and `"no-store"` (the default).
- **Offline:** `ssqch build --offline` (or `SSQCH_OFFLINE=1`) answers every request from its saved copy, whatever its age, and fails a request that has none, so a build on a plane or in a sandbox never touches the network.
- **Seeing it:** a response from a copy has an `x-ssqch-cache` header (`hit`, or `stale` after a failed refresh), and the build summary counts them: `Fetch   12 requests, 9 from the cache`.

CI starts without `.cache/`, so production builds fetch fresh data unless you restore that folder.

### npm packages

Install packages with npm, pnpm or yarn as usual, and import them: `import { DateTime } from "luxon"`. ssqch finds them the way Node does: in `node_modules` folders from the importing file's folder up (so monorepos and pnpm's symlinks work), using `package.json`'s `exports` (with the `import`, `require`, `node` and `default` conditions), `imports` (`#internal`), and `main`. CommonJS works too: `.cjs` files, and `.js` files in packages without `"type": "module"`, run with `require`, `module.exports`, `__dirname` and `__filename`, and importing one gives `module.exports` as the default export and its properties as named exports. Your own `.js` files are ES modules if they use `import` or `export`, and CommonJS otherwise, whatever your `package.json` says, so `module.exports = { ... }` in `_data/site.js` works. In an ES module, `createRequire(import.meta.url)` from `node:module` gives you a `require`.

Packages run on QuickJS, not Node, so a package that needs a real server, a child process, native addons or the file system's streams won't work. These do (each checked by building a page with it): luxon, dayjs, date-fns, lodash, lodash-es, slugify, js-yaml, gray-matter, markdown-it and its plugins, marked, highlight.js, prismjs, nunjucks, sanitize-html, html-minifier-terser, clean-css, feed, string-strip-html, chroma-js and dotenv. Some have a faster built-in in ssqch (the `markdown` filter, `readingTime`, `ssqch/minify`, and `markdown: { highlight: true }` for highlighting), so reach for those packages when you need their particular output.

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

Data functions run on every build. `ssqch serve` reloads a data file when it changes, and the modules it imports too. Data files work in TOML-configured sites too.

### Built-in plugins

- **`ssqch/image`:** `imagePlugin(options)` turns every local `<img>` in HTML output into a `<picture>`. Options: `formats` (`avif`, `webp`, `jpeg`, `png`, `auto`), `widths`, `defaultAttributes`, `outputDir`, `urlPath`, `webpQuality`, `avifQuality`, `avifSpeed`, `jpegQuality`, `minimumThreshold`, `prune`, `hashCache` and `linkedImages`. On an `<img>`, `ssqch:widths="300,600"` picks that image's widths, a plain `width` attribute pins it to one width, and `ssqch:ignore` leaves it alone. Images with a color profile other than sRGB (Display P3, Adobe RGB) are converted to sRGB first, so their colors stay true. A link to a local image (`<a href="/photos/big.jpg">`, the click-to-enlarge pattern) is pointed at a generated copy in the image's own format, at its own width capped at the largest of `widths`, so the link works without publishing the source file; `ssqch:ignore` on the `<a>`, or `linkedImages: false`, leaves links alone. `image(src, { widths, formats })` makes one image's files with the same settings and cache, returning `{ webp: [{ url, width, height, srcset, sourceType, ... }] }`. Its files are named after a hash of the source; `name` gives them a name and folder of your own, for URLs other things link to (`image("logos/acme.png", { widths: [200], name: "/assets/sponsors/acme" })` writes `/assets/sponsors/acme-200.webp`, and a name without a leading `/` is inside the image folder). Data files can call it even without the plugin.
- **`ssqch/minify`:** `minifyPlugin(options)` minifies HTML output, after the image transform. `minify(html, options)` does the same for a string. Options: `collapseWhitespace`, `removeComments`, `shortDoctype` and `shortenAttributes` (all `true` by default). `shortenAttributes` drops the values of boolean attributes (`defer="defer"` becomes `defer`) and whitespace that doesn't matter in `class`, `srcset`, `sizes`, URL attributes and the viewport `<meta>`.
- **`ssqch/rss`:** `rssPlugin()` adds the filters `getNewestCollectionItemDate`, `dateToRfc3339`, `dateToRfc822`, `absoluteUrl` and `htmlToAbsoluteUrls`. They're also named exports, for your own code.
- **`ssqch/assets`:** `assetsPlugin({ files })` fingerprints CSS and JS for long-lived caching. Templates link the plain paths (`<link rel="stylesheet" href="/assets/index.css">`). In a production build, each listed file in the output folder (written there by your CSS or JS tool before `ssqch build`) is renamed to `index.<hash>.css`, older fingerprinted copies are deleted, and every `href` and `src` in the HTML that points at it is rewritten, keeping any query string. `ssqch serve` leaves the plain paths alone, unless the plain file isn't there but the last production build left a fingerprinted copy: then pages link to that copy (with a warning), so serving after a build without running your CSS and JS watchers still has styles. A listed file that's missing fails a production build. `assetUrl("/assets/index.css")` returns the URL to use, for places outside an `href` or `src`. `url()` references inside CSS and imports inside JavaScript aren't rewritten. Options: `files` (URL paths, required), `fingerprint` (`true` or `false`; on for production builds by default) and `integrity` (add `integrity="sha384-..."` to the `<link>` and `<script>` elements that load a fingerprinted file; default `false`).
- **`ssqch/links`:** `linksPlugin(options)` checks the built site's internal links after each build. Every `href` (on `a`, `link` and `area`), `src` (images, scripts, iframes, media) and `srcset` URL has to point at something in the output, and a `#fragment` has to match an `id` on the page it points to. External links aren't checked, and neither are paths a Netlify `_redirects` file in the output covers. Broken links fail production builds, listing each page and link, and are warnings in `ssqch serve`. Options: `anchors` (check `#fragments`; default `true`), `ignore` (URL path prefixes to skip, like `["/downloads/"]`) and `fail` (`true` or `false`; production builds only by default).
- **`ssqch/sass`:** `sassPlugin({ files: { "src/scss": "/css" } })` compiles Sass with [grass](https://github.com/connorskees/grass) (pure Rust: no Dart Sass or Node). A folder compiles every `.scss` and `.sass` file in it that doesn't start with `_`, keeping their paths; a file (`{ "src/app.scss": "/app.css" }`) compiles to the path given. The CSS is written at the start of each build, so `ssqch/assets` can fingerprint it and the link checker sees it, and `ssqch serve` rebuilds when a source changes. Options: `files` (required), `style` (`"compressed"` for production builds and `"expanded"` otherwise, by default) and `loadPaths`.
- **`ssqch/sitemap`:** `sitemapPlugin({ url: "https://example.com" })` writes `sitemap.xml` listing every HTML page with its absolute URL and its date as `<lastmod>`. Left out: pages with `sitemap: false` in their data, 404 pages, pages 2 and on of a list split into pages (pagination with a `size` over 1; a page per tag is still listed), and URLs matching `exclude` globs (`["/tags/**"]`). Options: `url` (required), `exclude`, `lastmod` (default `true`), `output` (default `"/sitemap.xml"`) and `paginated` (list every page of a split list).
- **`ssqch/elements`:** `elementsPlugin()` is interactivity without a framework. A custom element is a tag with a hyphen (`<like-button>`) and a script that defines it. Put `like-button.js` in `src/elements/` (and `like-button.css` next to it, if it has styles), write the tag in any page or layout, and that page gets the script and the stylesheet; pages without the tag get neither, so a page with no elements loads no JavaScript. What's inside the tag is the fallback a visitor sees before the script runs, or without JavaScript: `<like-button><a href="/likes/">3 likes</a></like-button>`. `ssqch:load` on a tag says when its script loads: `eager` (with the page, the default), `idle` (when the browser has a quiet moment) or `visible` (when the element scrolls into view), which is the "islands" idea without a framework to run it. The whole folder is copied to `/elements/`, so elements can import shared modules (a file without a hyphen in its name isn't an element). Options: `dir` (default: `elements` in the input folder), `url` (default `/elements/`) and `load` (the default for tags without `ssqch:load`). The [`islands` example](examples/sites/islands/) has three small elements.

- **`ssqch/redirects`:** `redirectsPlugin(options)` keeps old URLs working. A page lists its old URLs in front matter (`aliases: [/2019/pine-cones/, /pine.html]`), and the `redirects` option adds others (`{ "/feed/": "/feed.xml" }`, where the new URL can be on another site). Each old URL gets a small page that sends visitors on (a meta refresh, a canonical link and `noindex`), and with `netlify: true`, a `/old  /new  301` line in `_redirects`, after any lines your own `_redirects` template writes. An old URL that's another page's URL is an error. For redirect pages in your own markup, add `_includes/hooks/redirect.*` (any engine): it gets `redirect.from` and `redirect.to` with the site's global data. Options: `pages` (default `true`), `netlify` (default `false`) and `redirects`.

### Configuring with TOML

A site that needs no code at all can use a `sitesquatch.toml` instead (one or the other, not both). Every key is optional; `crates/sitesquatch/src/site_toml.rs` has the full list.

```toml
input = "src"
output = "public"
template_formats = ["edge", "md", "html"]

ignore = ["drafts/**"]

[markdown]
heading_ids = "blackfriday"

[passthrough]
"src/robots.txt" = ""   # empty keeps the path relative to the input directory
```

## Moving from another generator

Guides map another generator's config, front matter and templates onto ssqch's: [from Zola](docs/guides/from-zola.md), [from Eleventy](docs/guides/from-eleventy.md), [from Docusaurus](docs/guides/from-docusaurus.md), [from MkDocs](docs/guides/from-mkdocs.md), [from Hexo](docs/guides/from-hexo.md) and [from component frameworks](docs/guides/from-component-frameworks.md) (Astro, VitePress, Next.js, Gatsby). [`examples/sites/`](examples/sites/) has small, complete sites to start from or copy parts of, each built in CI: `blog-tags`, `blog-categories`, `docs-sidebar`, `glossary-docs`, `versioned-docs`, `component-docs`, `reference-pages` and `islands`.

For a Zola site, `ssqch import zola` moves `tags` out of `[taxonomies]` and turns `path` into `permalink` in each page's front matter, writes a first `ssqch.config.js` from `config.toml` (the site's data, Markdown options, Sass, redirects, a sitemap), and lists what the Tera templates, shortcodes and sections need.

For an Eleventy site, `ssqch import eleventy` does the mechanical part. It renames `*.11tydata.*` files, rewrites front matter keys and image attributes to ssqch's names, writes a first `ssqch.config.js` from what it can read in the Eleventy config (folders, passthrough copies, template engines, `pathPrefix`), and lists what's left to port by hand, each with its file and line and what it becomes: filters, shortcodes, collections, plugins and their ssqch equivalents. Without `--write` it only prints the list, so run it in a clean git checkout, read it, then run it again with `--write`:

```sh
ssqch import eleventy            # what would change, and what's left (or: ssqch import zola)
ssqch import eleventy --write    # make the changes
```

Whichever generator you're leaving, build the site with it and with ssqch and run [`ssqch diff`](#comparing-two-builds) on the two output folders: it shows which pages differ and how, so you know when the move is done.

## Templates and data

Here's what's supported:

- **The data cascade:** a page's data comes from several places, and each one replaces what the ones before it set: global data, the front matter of its layouts, directory data, the page's data file, its front matter, then `computed`. [Where a value comes from](#where-a-value-comes-from) has the exact order, and `ssqch inspect` shows it for any page.
- **Collections:** tags become collections, sorted by date, plus your custom ones. `excludeFromCollections: true` keeps a page out.
- **Pagination:** `data`, `size`, `alias`, `reverse`, `filter`, `addAllPagesToCollections` and hrefs. `data: collections` goes over the collections' names, for a page per tag (`filter: [all]` leaves `all` out).
- **Permalinks:** dynamic permalinks, `permalink: false` and `dynamicPermalink`. A permalink (or `computed` value) with `{{ }}` renders in the page's own template language, so a Liquid page can write `permalink: "/{{ title | slugify }}/"`; Markdown and HTML pages use their `markdownEngine` or `htmlEngine`, or Edge.
- **Front matter:** YAML between `---` lines, TOML between `+++` lines, or JSON after `---json` (`---yaml` and `---toml` work too). `.markdown` files are Markdown, like `.md`.
- **Navigation:** `navTree(nav, page.url)` takes a tree from data (`_data/nav.yml`: entries with `title`, `url`, and children under `children`, `items` or `pages`) and marks each entry `current`, `ancestor` or `open`, for a sidebar that highlights where you are. `navPager(nav, page.url)` returns `{ previous, next }` in reading order, and `navBreadcrumbs(nav, page.url)` the entries from the top down to the page. To build the tree from front matter instead, give pages `nav: { title, parent, order }` (or `nav: true`) and use `pagesTree(collections.docs)`. URLs match with or without `index.html` and the last `/`.
- **Dates:** a page's `date` comes from its data, then from the start of its file name (`2024-06-01-post.md`), then from when the file last changed. `computed.date` works too.
- **Drafts:** `draft: true` builds the page in development (`ssqch serve`, or `--env development`) and leaves it out of production builds, collections included.
- **Excerpts and reading time:** `page.excerpt` is the HTML before a `<!-- more -->` comment, or else the first paragraph, for layouts and collections (`post.page.excerpt` in a list of posts). `readingTime(content)` is the minutes it takes to read some HTML at 200 words a minute (`readingTime(content, 250)` for another pace), at least 1.
- **Choosing engines:** `.md` files run through Edge first, then Markdown (change that with `markdownEngine` and `htmlEngine`). Layouts follow the same rules, so a `.html` layout is an Edge template by default. A template's `render` front matter overrides it: `render: md` for Markdown only (handy for a post full of `{{ }}` code samples), `render: [edge, md]` for a chain, or `render: false` to write the body as it is.
- **Everything else:** layout chaining, `page.*`, `templateContent` in collections, and an error when two pages would write the same file. Every template can read `ssqch.version`, `ssqch.env`, `ssqch.serving` and `ssqch.generator`.

Edge.js support covers `{{ }}`, `{{{ }}}`, `{{-- --}}`, `@{{ }}`, `@if/@elseif/@else/@unless`, `@each` (with index, objects, `@else` and `$loop`), `@let`, `@assign`, `@include`, `@includeIf`, `@component`/`@!component` with named slots and isolated scope, and `~` whitespace control. Newlines and escaping match Edge.js 6.5 on [42 whitespace cases](crates/sitesquatch-edge/tests/fixtures/whitespace-cases.json). One difference: an undefined value prints nothing, where Edge.js prints `undefined`.

Expressions cover object and array literals (with shorthand and spread), template literals, optional chaining, arrow functions, ternaries, `??`, `typeof`, `await` (a no-op), `new Date()`, the common String, Array, Number and Date methods, and the `JSON`, `Object`, `Math` and `Array` globals. Errors report `template:line` through the include and component chain.

### Markdown

Markdown is [CommonMark](https://commonmark.org) with GitHub's extensions: tables, strikethrough, footnotes, task lists, bare URLs as links, and alerts. Headings get `id`s, so every section can be linked to. The `markdown` config key turns the extensions on and off:

```js
export default defineConfig({
  markdown: {
    headingIds: "blackfriday", // or "github" (the default), or false
    smartPunctuation: true,
  },
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `headingIds` | `"github"` | Automatic heading `id`s. `"github"` matches GitHub's anchors (`Hello, World!` becomes `hello-world`); `"blackfriday"` matches Hugo's older ones (`A -- B` becomes `a-b`, not `a----b`); `"ascii"` transliterates first (`Straße 🦀` becomes `strasse-crab`, like Zola's). A function of the heading's text makes your own: `headingIds: (text) => ...`. A repeated heading gets `-1`, `-2` and so on. `false` turns them off. |
| `headingAttributes` | `true` | `## Install {#setup .wide}` sets the heading's `id` and `class`. An `id` given this way always wins. |
| `footnotes` | `true` | `[^1]` references, with the notes in a `<section class="footnotes">` at the end and links back to each reference. |
| `taskLists` | `true` | `- [ ]` and `- [x]` items, as disabled checkboxes. |
| `autolinks` | `true` | Bare `https://` and `www.` URLs become links. |
| `alerts` | `true` | GitHub's `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]`, as `<div class="markdown-alert markdown-alert-note">` with a title, the same markup GitHub uses (or a container template of that name, below). |
| `containers` | `true` | `::: name args` blocks (below). |
| `definitionLists` | `false` | A term, then `: definition` lines, as `<dl>`. |
| `smartPunctuation` | `false` | Curly quotes, `--` and `---` as dashes, `...` as an ellipsis. A `--` that follows a space and runs into a word stays as it is, so `run it with --fix` keeps its flag. |
| `indentedCode` | `true` | Lines indented four spaces are code. `false` makes them ordinary Markdown, for HTML indented inside Markdown; fences are still code. |
| `highlight` | `false` | Syntax highlighting at build time (below). `true`, or `{ css: "/assets/code.css" }` to put the stylesheet somewhere else, or `{ css: false }` to leave it out. |

**Syntax highlighting:** with `highlight: true`, fenced code is highlighted while the site builds, so pages need no highlighting script. The grammars are Sublime Text's and TextMate's (about 200 languages, from [syntect](https://github.com/trishume/syntect) and [bat](https://github.com/sharkdp/bat)), plus ssqch's own for the template languages those don't cover (`edge`, `liquid`, `hbs` and `mustache`: the tags, over highlighted HTML), and each token gets one class for what it is: `hl-keyword`, `hl-string`, `hl-comment`, `hl-function`, `hl-type`, `hl-number` and so on. The build writes a stylesheet for them to `/highlight.css` (link it from your layout) with GitHub's colors, light and dark. Each color is a CSS custom property, like `--hl-keyword`, so a theme switch or your own palette only has to set those. Mark lines with braces in the fence's info string, ```` ```js {1,4-6} ````, and those lines get `class="line highlighted"`. A language without a grammar renders as plain `<pre><code class="language-x">`.

**A table of contents:** after a page's content renders, `page.headings` lists its headings (`level`, `id` and `text`), so its layouts can build a table of contents. The built-in `toc` filter does it for you: `{{{ toc(page.headings) }}}` writes nested `<ul>` links to the `h2` and `h3` headings, and `toc(page.headings, { from: 2, to: 4, ordered: true })` changes the levels or uses `<ol>`. In Liquid that's `{{ page.headings | toc: 2, 4 }}`, and in Nunjucks, `{{ toc(page.headings) | safe }}`. The headings come from the HTML, so they work for pages in any template language. Collections have them too (`post.page.headings`).

**Highlighting anywhere:** `highlight(code, lang)` returns the highlighted HTML for the inside of a `<code>` (escaped text for a language without a grammar), for code that isn't a Markdown fence: an example container's source, a snippet from a data file.

**Markdown anywhere:** the `markdown` filter renders a string, such as a description from front matter: `{{{ markdown(summary) }}}`, or `markdown(title, "inline")` (in Liquid, `{{ title | markdown: "inline" }}`) to leave out the `<p>`. Config and data files can `import { markdown } from "ssqch"`.

**Containers:** a block between `::: name` and `:::` renders through `_includes/containers/name.*`, a template in any engine. It gets the page's data plus `container.name`, `container.args` (the rest of the opening line, without `[` `]` around it: `:::tip[Watch out]` works), `container.content` (the block's Markdown, rendered) and `container.source` (the block's lines as written, for an example that shows its own code). One template covers admonitions, tabs, figures or anything else that wraps content:

```markdown
::: warning Hot pine cones
They're **very** crunchy.
:::
```

```njk
{# src/_includes/containers/warning.njk #}
<aside class="callout warning">
  <p class="callout-title">{{ container.args or "Warning" }}</p>
  {{ container.content | safe }}
</aside>
```

Containers nest: an outer one opens with more colons (`::::`) and closes with as many. Without a template, a container renders as `<div class="name">` (with the arguments as a `<p class="container-title">`). An alert renders through a container template with its name, if there is one, so `containers/warning.njk` styles `> [!WARNING]` too.

**Render hooks:** templates in `_includes/hooks/` take over how parts of Markdown render, in any engine. Each gets the page's data plus one value:

| Template | Gets | For example |
| --- | --- | --- |
| `heading.*` | `heading.level`, `id`, `text`, `content` (the inner HTML) and `attrs` | Anchor links next to headings |
| `link.*` | `link.href`, `title`, `text` and `content` | `target="_blank"` and an icon on external links |
| `image.*` | `image.src`, `alt` and `title` | `<figure>` with a caption |
| `footnote-ref.*` | `footnote.number`, `label`, `id` (the note's), `refId` (this reference's) and `index` (1 for a note's first reference) | Footnote links in another generator's markup |
| `footnotes.*` | `footnotes`: a list of `number`, `label`, `id`, `content` (the note's HTML) and `refs` (the ids of its references) | The notes as a `<div>` each, or as sidenotes |
| `fence.*`, or `fence-<lang>.*` for one language | `fence.lang`, `info` (the whole line after the backticks, like `js {1,3} title="app.js"`), `code`, and `highlighted` (the highlighted HTML, with `highlight` on) | Diagrams from `mermaid` fences, titled code blocks |

```edge
{{-- src/_includes/hooks/heading.edge --}}
<h{{ heading.level }} id="{{ heading.id }}">{{{ heading.content }}} <a href="#{{ heading.id }}" class="anchor" aria-hidden="true">#</a></h{{ heading.level }}>
```

Put `aria-hidden="true"` on decoration like that `#`, and `page.headings` leaves it out of the heading's text.

### Liquid

Coming from Jekyll or a Shopify theme? Add `"liquid"` to `templateFormats` and `.liquid` pages and layouts render with [Liquid](https://shopify.github.io/liquid/) (the [`liquid`](https://crates.io/crates/liquid) crate). Use `markdownEngine: "liquid"` to run Markdown through Liquid instead of Edge, or `render: [liquid, md]` for one post.

```js
import { defineConfig } from "ssqch";

export default defineConfig({
  templateFormats: ["liquid", "md"],
  markdownEngine: "liquid",
  filters: { shout: (s) => s.toUpperCase() },
});
```

- **Data:** Liquid templates get the same data as Edge ones: front matter, the cascade, `page`, `collections` and `content` in layouts. Unknown variables and properties print nothing, as in Jekyll.
- **Filters:** Liquid's standard filters, Jekyll's `slugify`, `push`, `pop`, `shift`, `unshift` and `array_to_sentence_string`, and Shopify's `pluralize`. Your config `filters` work too: `{{ title | shout }}` calls `shout(title)`, and `{{ x | wrap: "[", "]" }}` calls `wrap(x, "[", "]")`. A config filter replaces a built-in one with the same name.
- **Includes:** `{% include "nav.html" %}` and Jekyll's `{% include nav.html section="home" %}` (read as `include.section`) see the page's variables. `{% render "footer", year: 2026 %}` sees only what it's given, and an unknown variable inside it is an error. Both read from `_includes`, adding `.liquid` when the name has none.
- **Mixing engines:** a Liquid page can use an Edge layout and the other way around.

### Nunjucks and Jinja

Add `"njk"` (Nunjucks) or `"jinja"` / `"j2"` (Jinja) to `templateFormats`, and those files render with [minijinja](https://github.com/mitsuhiko/minijinja), a Rust implementation of Jinja2 that covers most of Nunjucks. `markdownEngine: "njk"` runs Markdown through it, and `render: [njk, md]` does it for one post.

- **Data:** the same as Edge and Liquid. Undefined values, and properties of undefined values, print nothing.
- **Escaping:** output is HTML-escaped, as in Nunjucks and Jinja; use `| safe` to opt out. A layout's `content` is already marked safe, so `{{ content }}` works.
- **Filters and functions:** Jinja's built-in filters, plus Nunjucks' `dump` and `truncate`, and `pluralize`, `filesizeformat`, `striptags`, `cycler()` and `joiner()`. Your config `filters` work both ways: `{{ title | shout }}` and `{{ shout(title) }}`. On a page whose data has a field with a function's name, the call finds the field first, so use the filter form there.
- **Dates:** `{{ page.date | dateformat }}` prints `Mar 14 2026`. `dateformat`, `timeformat` and `datetimeformat` take `"short"`, `"medium"`, `"long"`, `"full"`, `"iso"`, `"unix"`, or a `strftime` pattern (`dateformat("%B %-d, %Y")`), in UTC. Dates also have Python's `strftime()` and `isoformat()` and JavaScript's `toISOString()` and friends, and `now()` is the build's time.
- **Your own tags:** in `.njk` files, a config filter is a tag too. `{% image "/a.png", "A pine" %}` prints what `image("/a.png", "A pine")` returns, without escaping it. With a closing tag, the function gets what's between them first: `{% callout "tip" %}...{% endcallout %}` calls `callout(content, "tip")`. That covers the built-in filters as well, so `{% markdown %}...{% endmarkdown %}` renders Markdown inside a template.
- **Includes and inheritance:** `{% include %}`, `{% extends %}` with `{% block %}`, `{% import %}` and `{% from ... import %}` read from `_includes`. Front-matter `layout` works too.
- **Nunjucks syntax:** in `.njk` files, `{% elseif %}` and `{% for key, value in object %}` work as in Nunjucks. Not supported: Nunjucks' async tags (`asyncEach`, `asyncAll`) and extensions that parse a tag's arguments themselves.
- **Errors** name the template and line: `broken.njk:2: syntax error`.

### Handlebars and Mustache

Add `"hbs"` (or `"handlebars"`) or `"mustache"` to `templateFormats`, and those files render with the [`handlebars`](https://crates.io/crates/handlebars) crate. Mustache templates render as Handlebars.

- **Data:** the same as the other engines, converted to JSON for each page. Dates become ISO 8601 strings, and very large collections cost more than in Edge, Liquid or Nunjucks. Missing values print nothing.
- **Escaping:** `{{ }}` escapes HTML and `{{{ }}}` doesn't, so a layout writes `{{{content}}}`.
- **Helpers:** Handlebars' built-ins (`if`, `unless`, `each`, `with`, `lookup`, `len`, `eq` and the other comparisons). Your config `filters` are helpers: `{{shout title}}`, `{{wrap title "[" "]"}}`, and hash arguments (`size=2`) arrive as a trailing object. Use `{{len list}}`, not `list.length`.
- **Partials:** every file in `_includes`, by its path with or without the extension: `{{> nav}}` or `{{> nav.hbs}}`.
- **Mustache:** variables, `{{{ }}}`, partials, sections over lists and truthy values (`{{#items}}{{.}}{{/items}}`) and inverted sections (`{{^items}}none{{/items}}`). Inside a section, reach outer values with `../name`, as in Handlebars. Not supported: lambdas and changing delimiters.

## Themes

A theme is a folder shaped like a site's input folder: `_includes/` (layouts, partials, render hooks, containers), `_data/`, pages, and files to copy, like stylesheets and fonts. Your site sits on top of it:

```js
export default defineConfig({
  theme: "themes/trail",
});
```

```text
themes/trail/                 src/                        what the build uses
  _includes/base.edge                                     the theme's layout
  _includes/footer.edge       _includes/footer.edge       your footer
  _data/site.json             _data/site.json             both, merged; your values win
  404.md                                                  the theme's 404 page
  about.md                    about.md                    your about page
  assets/theme.css                                        copied to /assets/theme.css
```

- **File by file:** an include, layout, hook or container you have wins over the theme's at the same path, so changing a theme's footer means adding one file, not forking the theme. Data is merged, with your values winning. A page or file in the theme is built or copied unless your input folder has a file at that path.
- **Any engine:** the fallback works for Edge, Liquid, Nunjucks, Jinja and Handlebars includes alike, and a theme can mix them.
- **No package manager:** a theme can be a git repository pinned to a tag or a commit (its full 40-character hash): `theme: "https://github.com/you/trail-theme#v1.2.0"`, or `#v1.2.0:theme` when the theme is in a folder of its repository (`{ git, ref, dir }` says the same as an object). ssqch fetches it once with `git` and keeps it in `.cache/ssqch/themes/`, so later builds don't touch the network; changing the commit or tag fetches the new one. An unpinned URL is an error, so a build next year gets the theme you tested with.
- **Layers:** `theme` takes a list, and earlier themes sit on top of later ones.
- **Not part of a theme:** the files about it at the top of its folder (`README`, `LICENSE`, `CHANGELOG`, `package.json`).

To change something in a git theme, copy that one file from `.cache/ssqch/themes/` to the same path in your input folder and edit it there. In `sitesquatch.toml`, it's `theme = ["themes/trail"]`.

## Content schemas

Front matter is easy to get wrong: a misspelled key, a date that isn't one, a hero image that was renamed. A schema says what a kind of page's data has to look like, and every build checks it:

```js
export default defineConfig({
  schemas: {
    posts: {
      fields: {
        title: "string",
        date: "date",
        description: "string?",
        status: "'draft' | 'published'",
        topics: "string[]",
        hero: { src: "file", alt: "string" },
        "author?": { name: "string", url: "string?" },
        slug: (value) => /^[a-z0-9-]+$/.test(value) || "must be lowercase letters, digits and dashes",
      },
      unknown: "error",
    },
    docs: { files: "docs/**/*.md", fields: { title: "string", order: "integer?" } },
  },
});
```

```text
error: 3 content errors:
  - src/posts/cedar.md: `status` must be "draft" or "published", not "drfat" (schema `posts`)
  - src/posts/cedar.md: `hero.src` is "cedar.jpg", but there's no such file next to the page (schema `posts`)
  - src/posts/cedar.md: `descripton` isn't a field of this schema (did you mean `description`?) (schema `posts`)
```

- **Which pages:** a schema covers the pages tagged with its name (the pages in `collections.posts`; `all` is every page in collections), or the files matching `files`, globs relative to the input folder.
- **What's checked:** each page's data after the data cascade and `computed`, so a value from a directory data file counts. Every problem in every page is reported in one go, with the file and the field.
- **Types:** `string`, `number`, `integer`, `boolean`, `date` (a date, or a string that reads as one), `file` (a path to a file that exists: next to the page, or from the input folder with a leading `/`), `object`, `array` and `any`. A quoted value, number, `true`, `false` or `null` is that exact value, `|` is either-or, `[]` is a list, and a `?` at the end makes the field optional.
- **Nested data:** an object of fields, or a one-item array for a list of them: `links: [{ href: "string", text: "string" }]`. A key that ends in `?` is optional too.
- **Your own rules:** a function gets the value and the page's data, and returns `true`, `false`, or what's wrong (`` `slug` must be lowercase letters, digits and dashes ``).
- **`unknown`:** what to do about keys in a page's own front matter that aren't fields: `"allow"` (the default), `"warn"` or `"error"`. Keys ssqch reads itself (`layout`, `tags`, `permalink`, `date` and the like) are always fine, and so is data from the rest of the cascade.
- **Editor types:** `ssqch types` adds the schemas to `ssqch.d.ts`, so `pages.byTag("posts")` in a collection function knows each page's fields.

In `sitesquatch.toml`, a schema is a table: `[schemas.posts]` with `fields = { title = "string", date = "date" }`.

## Starting a new page

`ssqch new` creates a page from an archetype: a page to start from, kept in `_archetypes/` in the input folder and named after the folder its pages go in. Here's `src/_archetypes/posts.md`:

```md
---
# Fill in the description before publishing.
title:
date:
description:
draft: true
---
Write here. The title is {{ title }}.
```

```sh
ssqch new posts --title "Pine cones: a field guide"
```

```text
Created src/posts/pine-cones-a-field-guide.md from src/_archetypes/posts.md
```

The new post:

```md
---
# Fill in the description before publishing.
title: "Pine cones: a field guide"
date: 2026-11-10
description:
draft: true
---
Write here. The title is {{ title }}.
```

- **Only front matter is filled in.** `title` is set, `date` is set to today when the archetype has that key (or you pass `--date`), and `--set key=value` sets anything else (`--set draft=false`, `--set "tags=[news, trails]"`). Comments and the order of the keys stay. The body is copied as it is, so an archetype isn't a template with a syntax of its own: `{{ title }}` in it is for the page.
- **Which archetype:** the one named after the page's folder, the most specific first. `docs/guides/install.md` uses `_archetypes/docs/guides.md`, then `_archetypes/docs.md`, then `_archetypes/default.md`, and with none of them the page gets a `title` and a `date`. `--archetype notes` picks one by name. An archetype can be in any template language (`posts.edge`), and a [theme](#themes) can bring its own in its `_archetypes/`.
- **A file, or a folder and a title:** `ssqch new posts/pine-cones.md` names the file itself (the title is then "Pine cones", unless you pass `--title`). Given a folder, the file is named after the title, the way the folder's other pages are: with the date in front (`2026-11-10-pine-cones.md`) when most of them have one, and as `pine-cones/index.md` when most are folders with an index file.
- **Nothing is overwritten,** and `--format json` prints the new file's `path`, its `archetype`, `title` and `date`.

## Where a value comes from

A page's data is a cascade. From the lowest level to the highest:

1. **Global data:** files in a theme's `_data/`, then the site's `_data/` (`site.json` is `site`), then the config's `data`.
2. **Layouts:** the front matter of the page's layouts, the outermost layout first.
3. **Directory data:** `posts/posts.json` (or `.yaml`, `.toml`, `posts.data.js`) applies to everything in `posts/` and below it. The outermost folder goes first.
4. **The page's data file:** `pine.json` or `pine.data.js` next to `pine.md`.
5. **Front matter.**
6. **`computed`:** worked out last, from everything above.

A higher level replaces what a lower one set. Objects merge key by key and lists are joined (a post's `tags` add to its folder's), unless `deepMerge` is off. `page` and `ssqch` are built in.

When a value isn't what you expected, `ssqch inspect` says which level set it. Give it a page's URL or its template's path:

```sh
ssqch inspect /guides/pine/
```

```text
/guides/pine/
  From        src/guides/2024-03-02-pine.md (edge, md)
  Writes      dist/guides/pine/index.html
  Layouts     _includes/guide.edge > _includes/base.edge
  Date        2024-03-02T00:00:00Z (from the file's name)
  Collections all, guides

  Data (name, value, and the level of the cascade that set it)
    site       {name, author}        src/_data/site.json
    section    "guides"              layout _includes/guide.edge (over layout _includes/base.edge)
    layout     "guide.edge"          src/guides/guides.json
    level      "hard"                front matter (over src/guides/guides.json, src/guides/2024-03-02-pine.json)
    title      "Pine"                front matter
    label      "Pine (hard)"         computed
```

`--field` shows one value in full, with every level that set it:

```sh
ssqch inspect src/guides/2024-03-02-pine.md --field level
```

```text
level = "hard"

Set by (the last one wins):
    src/guides/guides.json                    "easy"
    src/guides/2024-03-02-pine.json           "medium"
  > front matter                              "hard"
```

- **Inside a value:** a dotted path reaches into objects (`--field site.author.name`, `--field hero.alt`).
- **Pages made by pagination:** a template that makes many pages needs the URL of one of them. `ssqch inspect src/tags.edge` lists them.
- **Scripts and agents:** `--format json` prints the report as JSON (`schemaVersion: 1`), with `value`, `from` and `setBy` for each field.
- **No page is built:** it reads the site as a build does, up to the point of rendering. `beforeBuild` hooks run, since data can depend on them (a command that writes a data file, a plugin that sets itself up there), but no page is rendered or written, and `afterBuild` doesn't run. Standard output is only the report; anything a hook or `console.log` prints goes to standard error.

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

## Comparing two builds

A build that succeeds isn't proof that an upgrade, a refactor or a migration left the site alone. `ssqch diff` compares two output folders and says what changed:

```sh
ssqch build --output dist-before   # before the change
# upgrade ssqch, edit a layout, move to another template language...
ssqch build
ssqch diff dist-before dist
```

```text
Comparing dist-before with dist
Ignoring asset fingerprints, integrity hashes, the generator's version, and whitespace between tags (--exact compares bytes).

Added (1)
  + /trails/cedar/

Removed (1)
  - /trails/old-growth/

Changed (2)
  ~ /trails/  (text and markup)
      ids removed (links to them break): #old-growth
      - <h2 id="old-growth">
      - Old growth
      + <h2 id="cedar">
      + Cedar
  ~ /assets/index.css  (index.3f2a1b4c.css -> index.9d8e7f6a.css)
      - body { color: #222 }
      + body { color: #111 }

2 changed, 1 added, 1 removed; 148 pages and 4,730 other files are the same.
```

- **What's ignored:** differences that don't change what a visitor gets. A fingerprinted file (`index.3f2a1b4c.css`: eight hex digits before the extension, unless they read as a date) is matched with its counterpart and compared by content, `integrity` hashes and the generator's version are left out, and HTML is compared as a list of tags and text, so whitespace between block tags doesn't count. A space next to an inline tag (`a <b>b</b>`) does, and so does whitespace inside `<pre>`, `<script>`, `<style>` and `<textarea>`. `--exact` compares bytes instead.
- **What each page says:** whether its text, its markup or both changed, a changed `<title>`, and any `id`s that are gone (links to those anchors break).
- **Your own noise:** `--ignore <regex>` leaves matching text out of both sides, like a build date in the footer: `--ignore 'Built on [^<]+'`. Repeat it for more patterns.
- **Part of the site:** `--only '**/*.html'` compares only matching files (repeatable).
- **Longer diffs:** each file shows 10 changed lines; `--lines 0` shows them all.
- **Scripts and agents:** `--format json` prints the same report as JSON (`schemaVersion: 1`), and the exit code is 0 when the builds are the same, 1 when they differ and 2 on an error, like `diff`.

It works on any two folders of HTML, so it can also compare another generator's output with ssqch's while you move a site over.

## Scripts and coding agents

The same commands work for a script, a CI job or a coding agent, with JSON in place of the text a person reads. Every JSON document has a `schemaVersion`, which changes only when a field is removed or changes meaning.

`ssqch build --format json` prints one report on standard output, whether the build worked or not (the exit code is 0 or 1 as usual):

```sh
ssqch build --format json
```

```json
{
  "schemaVersion": 1,
  "ok": false,
  "environment": "production",
  "output": "dist",
  "warnings": [
    {
      "code": "schema",
      "message": "src/guides/pine.md: `lvl` isn't a field of this schema (did you mean `level`?) (schema `guides`)",
      "file": "src/guides/pine.md",
      "field": "lvl"
    }
  ],
  "errors": [
    {
      "code": "template",
      "message": "rendering index.edge with `edge`: index.edge:4: Cannot read properties of undefined (reading 'toUpperCase') in `guide.data.name`",
      "file": "src/index.edge",
      "line": 7
    }
  ]
}
```

- **Each warning and error** has a `code` and the `message` a person would have read. `file` (from the project root) is there when the problem is in a file that exists, `line` when the line is known, `field` for a [schema](#content-schemas) problem, and `url` for a problem in a written page, like a broken link.
- **`line` is a line of the file.** Template languages count from the end of the front matter, which is the number in the message (`index.edge:4`); the report adds the front matter back (`"line": 7`).
- **The codes:** `config`, `data`, `front-matter`, `template`, `schema`, `conflict` (two pages write the same file), `links`, `images`, `assets`, `fetch`, `passthrough`, `last-modified`, `hook`, and `build` for anything else.
- **A build that works** also has `durationMs`, `pages` (`written`, `templates`, `bytes`), `copied`, `removed`, `written` (each page's file, from the output folder), `summary` (the lines plugins add to the [build summary](#reading-the-build-summary)) and `timings`.
- **Standard output is only the report.** The lines a person would have read (`[ssqch] Writing ...`), `console.log` from your config and the output of `beforeBuild` commands go to standard error; `--quiet` leaves the progress lines out.

`ssqch capabilities --format json` says what this binary supports, so nothing has to be guessed from the documentation of another version: its `version`, `commands`, optional `features` (`avif`, `fetch`, `sass` and each template language, which a build from source can leave out), `templateLanguages` with their extensions, `configOptions`, the built-in `modules` with what each exports, `nodeModules`, `globals` and `imageFormats`. Without `--format json` it prints the same as text.

`ssqch serve --ready-file <file>` writes a file once the first build is done and the site is being served, so a script can wait for the file instead of reading the server's output or sleeping:

```sh
ssqch serve --port 0 --ready-file .cache/ready.json &
```

```json
{
  "schemaVersion": 1,
  "url": "http://localhost:60768/",
  "port": 60768,
  "base": "",
  "output": "/home/sam/site/dist",
  "pid": 39675,
  "ok": true
}
```

`ok` is whether that first build worked (the server keeps running either way, and rebuilds when a file changes). The file is deleted when the server starts, so one from an earlier run never counts, and it's written again when a changed config loads, since `output` and `base` can change with it.

The other commands with JSON are [`ssqch inspect --format json`](#where-a-value-comes-from) (where a page's data came from) and [`ssqch diff --format json`](#comparing-two-builds) (what a change did to the output; it exits with 0, 1 or 2 like `diff`).

## Deploying

### Keep the image cache between builds

Encoding images is by far the slowest part of a build, so it's worth never doing it twice. Each image file is named by a hash of the source image's contents and the encoder settings, not its path or modification time. Restore the output's `img/` folder from the last build, and a build with no new images encodes nothing, even on a fresh clone in CI.

ssqch also remembers each source image's hash, size and modification time in `.cache/ssqch/image-hashes.json`, so unchanged images aren't read again. Cache that folder too. (A fresh clone gives every file a new modification time, so its first build re-hashes everything, which takes about 20 ms on the blog's 420 MB of images.) Add `.cache/` to your `.gitignore`, or turn the hash cache off with `hashCache: false`. It's kept outside the output folder because it names your source paths, and the output gets published.

Set `prune: true` on `imagePlugin()` to delete image files the build didn't use, so the cache doesn't keep growing as images change. Only turn it on for full builds, where every image goes through the image plugin.

### Serving a site under a path

A GitHub Pages project site lives at `https://you.github.io/repo/`, not at the root of a domain, so a link to `/about/` would miss. Set `base` and leave the templates alone:

```js
export default defineConfig({
  base: "/repo/",
});
```

- **HTML:** in every page ssqch writes, a URL that starts with `/` gets the base in front: `href`, `src`, `srcset`, `action`, `poster` and the other URL attributes, a meta refresh, and `url()` in `style` attributes and `<style>` elements. That covers Markdown links, images from `imagePlugin()`, fingerprinted assets, redirect pages and Sass output. Relative URLs, `#fragments` and URLs with a domain aren't changed, so a link to something else on the same domain needs the whole address (`https://you.github.io/other-project/`).
- **Everywhere else:** in an inline script, a JSON file or a feed, call `withBase("/search.json")`, or print `ssqch.base` (`/repo`, or an empty string without a base). Don't use `withBase()` inside an HTML attribute, or the URL gets the base twice (the link checker reports it).
- **`page.url` and collections:** unchanged, so `page.url == item.url` and the navigation helpers work the same with or without a base.
- **The output folder:** unchanged too. `dist/about/index.html` is what the host serves at `/repo/about/`.
- **Plugins:** `linksPlugin()` checks links under the base (other paths on the domain count as external), and `sitemapPlugin({ url })` takes the address with or without the base in it.
- **`ssqch serve`:** serves the site at `http://localhost:8080/repo/`, so what you click through locally is what the host will serve.

`ssqch build --base /repo/` sets it from the command line (for a preview deployed under another path, say) and wins over the config. In `sitesquatch.toml` it's `base = "/repo/"`.

### Search

ssqch doesn't build a search index itself; [Pagefind](https://pagefind.app) does it well and runs after the build. Add it as a command (with Node for `npx`, or install Pagefind's own binary):

```js
export default defineConfig(({ env }) => ({
  afterBuild: env === "production" ? [{ run: "npx -y pagefind --site dist" }] : [],
}));
```

Then load `/pagefind/pagefind-ui.js` and `pagefind-ui.css` in your layout and add a `<div id="search">` for its search box. The `docs-sidebar` example does this.

### Netlify

Netlify can build the site itself, with no deploy token to manage. This is the ReverentGeek blog's `netlify.toml` (it builds its CSS and JavaScript with npm scripts first, so it runs `pnpm run build`; a site without that step can run `.cache/bin/ssqch build` instead):

```toml
[build]
  command = "curl --proto '=https' --tlsv1.2 -fsSL https://github.com/reverentgeek/sitesquatch/releases/download/v$SSQCH_VERSION/ssqch-installer.sh | SSQCH_UNMANAGED_INSTALL=.cache/bin sh && SSQCH_BIN=.cache/bin/ssqch pnpm run build && node --test test/smoke.test.js"
  publish = "dist/"

[build.environment]
  NODE_VERSION = "24"
  SSQCH_VERSION = "0.3.4"

[[plugins]]
  package = "netlify-plugin-cache"
  [plugins.inputs]
    paths = ["dist/img", ".cache/ssqch"]
```

- **`SSQCH_VERSION`** pins the release, so a new SiteSquatch version can't surprise a deploy. Bump it when you're ready.
- **`SSQCH_UNMANAGED_INSTALL=.cache/bin`** installs the binary into that folder and leaves shell profiles alone.
- **[`netlify-plugin-cache`](https://github.com/jakejarvis/netlify-plugin-cache)** carries the image files and the hash cache over to the next build. Add it to your `devDependencies`.

On the blog, the first Netlify build (which encoded every image) took about 4 minutes, and the next one took 18 seconds, including Netlify's own setup.

### GitHub Pages

A project site is served at `https://you.github.io/<repository>/`, so the build needs that path as its [`base`](#serving-a-site-under-a-path). This workflow builds on every push to `main` and deploys with GitHub's own Pages actions (in the repository's settings, set Pages' source to "GitHub Actions"):

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: reverentgeek/setup-ssqch@v1
      - run: ssqch build --output dist --base "/${{ github.event.repository.name }}/"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- **`--base`** takes the repository's name from the workflow, so the config doesn't have to know it and `ssqch serve` on your machine still serves the site at `/`. A user site (`you.github.io`) or one with a custom domain is at the root: leave `--base` off.
- **Pin the version** as in [Install](#install) (`with: version:`), so a new release can't surprise a deploy.
- **A 404 page:** GitHub Pages serves `404.html` from the site's root, so give your 404 page `permalink: /404.html`.
- **Images:** to keep encoded images between builds, cache `dist/img` and `.cache/ssqch` with `actions/cache` (see [Keep the image cache between builds](#keep-the-image-cache-between-builds)).

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

For a bigger site, `scripts/synthetic-site.py <folder> [pages] [engine]` writes a synthetic documentation site: 9,001 Markdown pages by default (about the size of kubernetes.io's English docs) in 60 sections, each page with a 9,000-entry sidebar from a data file, a table of contents, a highlighted code fence, a schema check and the link checker. On the same machine, production builds of it take:

| Layout in | Build | CPU time | Peak memory |
| --- | --- | --- | --- |
| Edge | **1.5 s** | 11 s | 0.5 GB |
| Nunjucks | **1.4 s** | 11 s | 0.6 GB |
| Liquid | **12 s** | 159 s | 1.1 GB |

Each build writes 156 MB of HTML and checks 1.4 million links. Liquid is slower because the `liquid` crate copies a value each time a template reads it, and this layout hands the whole sidebar to a filter on every page (see [Known gaps](#known-gaps)).

To reproduce the blog's table on macOS, run `scripts/bench.sh [path/to/blog] [warm-runs]` (the blog defaults to `../blog`). It works on a copy-on-write clone of the blog in a temporary folder, so your copy is never touched, and writes `results.csv`, `bench.log` and `summary.txt` to `bench-results/<timestamp>/`.

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
| `add_template_engine(ext, factory)` | `engines` (Markdown and Edge use this same trait) |
| `on_before_build`, `on_after_build`, `run_before_build`, `run_after_build` | `beforeBuild`, `afterBuild` |
| `add_passthrough_copy[_to]`, `add_watch_target` | `passthrough`, `watch` |
| `set_base("/repo/")` | `base` |
| `add_schema(Schema::parse(name, &spec)?)` | `schemas` |
| `add_theme("themes/trail")` | `theme` |
| `add_generator(name, \|ctx, pages\| ...)` | not available (files made from the pages that were written: a sitemap, redirect pages) |
| `add_file_builder(name, \|ctx\| ...)` | not available (files built from their own sources before the pages: compiled CSS) |
| `add_config_file(path)` | not available (a file `ssqch serve` reads the configuration again for) |
| `add_summary(label, \|ctx\| ...)` | not available (adds a line to the build summary) |

A site binary whose setup can fail uses `sitesquatch::cli::try_run_with`, whose closure returns a `Result` and is called again by `ssqch serve` when a config file changes. `sitesquatch::diff::compare` is `ssqch diff` as a function. `sitesquatch::inspect::inspect` is `ssqch inspect`, and `sitesquatch::archetype::new_page` is `ssqch new`. A plugin reports a warning with `sitesquatch::diagnostics::warn(Diagnostic::warning("code", message).file(path))`, which prints `warn: ...` and puts it in the JSON report, and fails with a `Diagnostics` error to keep its problems apart there.

Plugins can share services. The image plugin exposes an `ImageProcessor`, and the blog's plugin uses it for its hero image data and its `socialImage` filter.

## Working on SiteSquatch

```text
crates/ssqch             The `ssqch` command-line tool
crates/sitesquatch       Generator core, CLI and dev server, as a library
crates/sitesquatch-edge  Edge.js template engine (parser + JavaScript expression evaluator)
crates/sitesquatch-js    ssqch.config.js support, on an embedded QuickJS engine
plugins/rss              Feed filters: getNewestCollectionItemDate, dateToRfc3339/822, absoluteUrl, htmlToAbsoluteUrls
plugins/image            <img> -> responsive <picture>, and image() for data files
plugins/minify           Conservative HTML minifier
plugins/assets           Asset fingerprinting: content-hashed names and rewritten references
plugins/links            Link checker: internal links and anchors in the built site
plugins/sitemap          sitemap.xml from the pages a build writes
plugins/redirects        Redirect pages and Netlify rules from `aliases`
plugins/sass             Sass, compiled with grass
plugins/elements         Custom elements: scripts loaded only on the pages that use them
plugins/liquid           Liquid templates
plugins/jinja            Nunjucks and Jinja templates
plugins/handlebars       Handlebars and Mustache templates
examples/sites           Example sites, built by the tests
examples/reverentgeek    The blog's config ported to Rust, as an example of the Rust API
```

Run the tests with `cargo test --workspace` (add `--features ssqch/avif` to include the AVIF encoder). [CI](.github/workflows/ci.yml) runs them on Linux, macOS and Windows (with AVIF on Linux), plus `cargo clippy` with warnings as errors.

The ReverentGeek blog is the real-world test site. To build it with your changes, clone it next to this repository and use its own build script, which also builds the CSS and JavaScript:

```sh
git clone https://github.com/reverentgeek/blog.git ../blog
cargo build --release -p ssqch --features avif
(cd ../blog && pnpm install && SSQCH_BIN=../ssqch/target/release/ssqch pnpm test)
```

`scripts/examples.sh` builds every site in `examples/sites/` with the checkout's `ssqch`, and `scripts/examples.sh <name>` serves one at <http://localhost:8080>. `pnpm test` builds the site and runs the blog's smoke tests. The first build encodes every image, so give it a few minutes; later builds reuse them.

Releases are built by [`dist`](https://opensource.axo.dev/cargo-dist/) from a version tag. The steps are in [`CLAUDE.md`](CLAUDE.md#releasing).

## Known gaps

- **JavaScript:** npm packages run on QuickJS, not Node, so servers, child processes, streams and native addons aren't there (see [npm packages](#npm-packages)), and regular expressions can't use the `v` flag's set operations (`[\p{L}--\p{ASCII}]`), which breaks `@sindresorhus/slugify`. A CommonJS file imported from an ES module runs when the module is loaded, so it runs before an earlier `import` of a module that's there for its side effects (Node runs them in order). JavaScript is interpreted (QuickJS has no JIT), so heavy collection code is slower than in Node: reading a page in a collection costs about 2 µs the first time, and the blog's `topics` and `postsByYear` collections over 2,000 posts take about 45 ms together.
- **Edge:** no `@inject`, `@debugger`, `@svg`, components as tags (`@!card()`), destructuring in `@let`, scoped slots, regex literals, or the `in` operator. Array `reverse` and `sort` return copies instead of changing the array.
- **Markdown:** containers have to close inside the block they opened in (the same list item, say). Highlighting parses more slowly than tree-sitter would: the blog's 350 fences add about 60 ms to a build.
- **Images:** no SVG rasterizing, and HDR photos (the PQ, gain-map profiles of newer iPhones) can't be converted to sRGB, so they look washed out; the build warns about them, and converting the source to sRGB once fixes it. SVGs are served as they are, and GIFs are copied for `auto` output, so animations keep working.
- **Liquid:** the `liquid` crate copies a value every time a template reads it, so a template that reads a big list on every page (`for post in collections.posts`, or a whole sidebar passed to `navTree`) pays for the copy each time. A 9,000-page site with a 9,000-entry sidebar builds in 12 s in Liquid and 1.5 s in Edge or Nunjucks. `{% render %}` partials are strict about unknown variables, and errors name the template but not the line.
- **Collections:** custom collections don't see pages that are paginated over collections. Those pages are added to `all` and their tags afterwards.
- **Platforms:** prebuilt binaries cover Linux x86_64, macOS and Windows x86_64, but not Linux on ARM yet; see [TODO.md](TODO.md) for what's next.

Found a bug, or have an idea? [Open an issue](https://github.com/reverentgeek/sitesquatch/issues). Happy building, and may your pages load faster than a Squatch sighting disappears.
