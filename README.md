# SiteSquatch

[![CI](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml/badge.svg)](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/reverentgeek/sitesquatch)](https://github.com/reverentgeek/sitesquatch/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

SiteSquatch (`ssqch`) is a static site generator that runs on Node.js: large, quick, and rarely photographed. You write templates in [Jinja](https://jinja.palletsprojects.com/) (the default), [Edge.js](https://edgejs.dev), [Liquid](https://shopify.github.io/liquid/), [Nunjucks](https://mozilla.github.io/nunjucks/), [Handlebars](https://handlebarsjs.com/), [Mustache](https://mustache.github.io/) or [EJS](https://ejs.co/), plus Markdown, configure the site in JavaScript, and `ssqch build` turns it all into plain HTML. Install it from npm into a site that has a `package.json` (Node 22.18 or newer), or use the standalone executable, which has Node inside, for a machine that has none. The JavaScript in your config and data files runs on Node itself, so any npm package that runs there works, and the libraries behind the template languages are the real ones.

It moves fast for its size. [reverentgeek.com](https://reverentgeek.com) (168 pages, a feed, a sitemap and about 4,700 responsive image files) rebuilds in **under a second** once its images are cached, which is gone before you've found your camera. [Benchmarks](#benchmarks) has the measurements.

It reports like a park ranger who has seen some things. What happened comes first, with the file and the line, and now and then something large walks through the log. The jokes never stand in for the facts, the JSON output has none, and nothing of ssqch's own is ever added to the pages it builds.

What's in the pack:

- **A data cascade, layouts, collections, pagination and permalinks**, so a blog or docs site needs no custom code.
- **A JavaScript config** with filters, global data, custom collections, transforms and build hooks, plus any npm package, `fetch` (with a cache) and every Node built-in, since the config runs on Node.
- **Markdown that does the work of a plugin stack:** heading ids, footnotes, containers, render hooks in any template language, and syntax highlighting at build time.
- **Responsive images:** every `<img>` becomes a `<picture>` with AVIF, WebP and fallback sources, cached by content so later builds skip the encoding.
- **Checks that run with every build:** [content schemas](#content-schemas) for front matter, a link checker, [`ssqch diff`](#comparing-two-builds) to see what a change did to the output, and [`ssqch inspect`](#where-a-value-comes-from) to see where a page's data came from.
- **Errors that point at the spot:** the line a problem is on, with carets under it, and a guess at what you meant (`did you mean /contact/?`) for a link, a layout, an include or an option that's nearly right.
- **Themes without a package manager, custom elements that load only where they're used**, Sass (yes, Sassquatch), a sitemap, redirects, RSS helpers, HTML minification and asset fingerprinting.
- **A quick start and a way in:** `ssqch init` (a blog, or a docs site with a sidebar and search), `ssqch import` for Eleventy and Zola sites, [`ssqch new`](#starting-a-new-page) for the next post, and a dev server (it answers to Squatch Watch) that reloads only the page you changed, swaps stylesheets in place, and shows a broken build in the browser.
- **Plugins in Rust** for when JavaScript isn't enough: heavy transforms, filters and template languages written in Rust build to one `.wasm` file that runs on every platform, with nothing to compile when a site installs it.

SiteSquatch is a young one (0.x), so expect some breaking changes between minor versions. Each is listed in the [changelog](CHANGELOG.md) with what you'd need to change.

## Install

ssqch is a program for [Node.js](https://nodejs.org) 22.18 or newer, and there are two ways to have it. In a site with a `package.json`, install it from **npm** as a dev dependency, so the lockfile pins the version: `npm install --save-dev ssqch` (or `pnpm add -D ssqch`, `yarn add -D ssqch`), then run `npx ssqch build`, or `ssqch build` in a `package.json` script. [sharp](https://sharp.pixelplumbing.com), which encodes images, is the package's one dependency: ssqch's template libraries are inside it, and so are its Markdown, highlighter, minifier and Sass, which are WebAssembly, so the package is the same on every platform, Alpine and Linux on ARM included.

**The standalone executable** is Node with ssqch inside it, for a machine that doesn't have Node, and for a site that has no `package.json`. On **Linux (x86_64)** and **macOS** (Apple Silicon or Intel), install it with the installer script:

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

The installers check the download's SHA-256 checksum and install `ssqch` into `~/.local/bin` (`%LOCALAPPDATA%\ssqch\bin` on Windows), or into `~/.cargo/bin` where 0.7's installer put it, so the new one doesn't hide behind the old. They add that folder to your `PATH`. `SSQCH_INSTALL_DIR` chooses another folder, `SSQCH_NO_MODIFY_PATH=1` leaves your shell profiles alone, and `SSQCH_UNMANAGED_INSTALL=<folder>` installs into a folder and touches nothing else (for CI and Netlify). Every release executable runs a smoke test on its own platform before it's published. To pin a version, as you'd want in CI, use that release's installer instead: replace `latest/download` with `download/v0.7.0`. You can also download an archive for your platform from the [releases page](https://github.com/reverentgeek/sitesquatch/releases).

**The standalone executable:** it's Node 26 with the npm package inside, about 174 MB (55 MB to download; 0.7's Rust binary was 29 MB), and it unpacks itself. On its first run it writes the package into a folder of its own, which takes a few dozen milliseconds, and runs from there: `~/Library/Caches/ssqch` on macOS, `%LOCALAPPDATA%\ssqch` on Windows, `$XDG_CACHE_HOME/ssqch` or `~/.cache/ssqch` on Linux (the temporary folder where none of those can be written). `SSQCH_UNPACK_DIR` chooses another folder, such as a CI cache or a home folder that is read-only. The folder is a cache: deleting it only means unpacking again. On Linux the executable is Node's own build, so it needs glibc 2.28 or newer (every mainstream distribution since 2018), where 0.7's static binary ran anywhere, and it's built for x86_64: on Alpine (musl) and on Linux on ARM, install Node and the npm package. There is no `cargo install ssqch` for 0.8, because ssqch is no longer Rust: the crates end at 0.7, apart from [`ssqch-plugin`](#plugins-in-rust), which is for writing plugins.

**A release from today and pnpm's release age:** pnpm 11 and later wait a day (`minimumReleaseAge`) before installing a new version, so `pnpm add -D ssqch` on the day of a release fails, or settles for the version before it. To take releases as they come out, list `ssqch` under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, by name, which trusts every version of it. It is the only package of ssqch's own (0.7 had a platform package for each system), so nothing else needs a line:

```yaml
minimumReleaseAgeExclude:
  - ssqch
```

**Excluding only one release** (`ssqch@<version>`) trusts that version and no other, but when the next release comes within a day, swapping the line for the new version locks pnpm out: every install fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, because the lockfile still has the old version, which is under a day old too and no longer excluded (`pnpm clean --lockfile` re-resolves every dependency, not only ssqch). To upgrade, add the new version's line beside the old one, install, then delete the old one; the lockfile no longer has the old version, so the new line is enough.

The npm package carries the modules built into ssqch (`ssqch`, `ssqch/image` and the rest) in its `exports` map, with their types, so editors, TypeScript and ESLint's `n/no-missing-import` find them without `ssqch types`. They load in plain Node too, which 0.7's stubs didn't: a test or a script can `import { markdown, slugify } from "ssqch"`. ESLint's `n/no-unpublished-import` flags imports of a dev dependency in files a package publishes, so turn it off for build-time files (`ssqch.config.js`, data files, and modules they import), which a site never ships.

In **GitHub Actions**, [`reverentgeek/setup-ssqch`](https://github.com/reverentgeek/setup-ssqch) installs a pinned version of the executable on Linux, macOS and Windows runners, with no Node setup step. (A site that installs ssqch from npm uses `actions/setup-node` and `npm ci` instead.)

```yaml
- uses: reverentgeek/setup-ssqch@v1
  with:
    version: 0.7.0
- run: ssqch build
```

> **Note:** AVIF needs no setup. sharp writes it, so there's no feature to turn on and no assembler to install first (0.7 needed `--features avif` and, on x86_64, nasm).

Confirm the sighting:

```sh
ssqch --version
```

For Tab completion of commands and options, `ssqch completions zsh` (or `bash`, `fish`, `powershell`, `elvish`) prints a script for your shell, and `ssqch completions --help` says where each shell wants it.

## Field guide: build your first site

The quickest way in is `ssqch init`, which sets up camp (a config, a layout, a home page, five posts, a 404 page, a data file, a blueprint for the next post, editor types, and an `AGENTS.md` for coding agents) and then leaves you to it:

```sh
ssqch init my-site
cd my-site && ssqch serve
```

Open <http://localhost:8080>, edit `src/posts/i-know-what-i-saw.md`, and watch the page reload. (The starter is an amateur investigator's field notes: a sighting, a correction, a stump, an old map and a raccoon's cache. The posts are short, and each one shows you something.) `ssqch init` never overwrites a file that's already there, so it's safe to run in a folder you've started.

The layout and home page are [Jinja](#jinja-and-nunjucks) templates, ssqch's default language. To start in another one, pass `--engine edge`, `--engine liquid`, `--engine njk` (Nunjucks) or `--engine hbs` (Handlebars); the config then lists that engine in `templateFormats` and runs Markdown through it. `--engine` works with `--starter docs` too.

Writing documentation? `ssqch init my-docs --starter docs` creates a docs site instead: a light and dark switch, a sidebar, breadcrumbs and previous/next links from one `nav.yml`, a table of contents on each page, notes and tabs, highlighted code, a schema that checks each page's front matter, the link checker, and Pagefind search with `SEARCH=1`. The pages are plain HTML that reads fine without JavaScript (a small script turns tab sections into tabs), and every file is yours to edit: there's no theme package underneath.

To see how the pieces fit, here's a small site built by hand: a home page that lists posts. This is all of it:

```text
ssqch.config.js
src/
  _includes/layout.jinja
  index.jinja
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

Layouts live in `src/_includes`. In `src/_includes/layout.jinja`, `{{ content }}` is where each page's body goes (Jinja escapes what it prints, but `content` is already HTML, so it's marked safe):

```html
<!doctype html>
<html lang="en">
  <head><title>{{ title }}</title></head>
  <body>
    <main>{{ content }}</main>
  </body>
</html>
```

### Step 3: A post and a home page

Front matter sets each page's data, and it has to come first in the file. Tagging the post `posts` puts it in `collections.posts`. Save this as `src/posts/pine-cone-crunch.md`:

```markdown
---
layout: layout.jinja
title: Pine Cone Crunch
tags: posts
---
Crunchy, foresty, and only slightly sticky.
```

The home page, `src/index.jinja`, uses the filter and loops over the posts:

```html
---
layout: layout.jinja
title: Squatch Snacks
---
<h1>{{ title | shout }}</h1>
<ul>
  {% for post in collections.posts %}
    <li><a href="{{ post.url }}">{{ post.data.title }}</a></li>
  {% endfor %}
</ul>
```

### Step 4: Build it

```sh
ssqch build
```

You'll see a line for each page, then a summary:

```text
[ssqch] Writing ./dist/index.html from ./src/index.jinja (jinja)
[ssqch] Writing ./dist/posts/pine-cone-crunch/index.html from ./src/posts/pine-cone-crunch.md (jinja, md)
First confirmed siting. Built in 2.75 ms (production)
  Pages   2 written from 2 templates, 410 B
  Output  dist: 2 files, 410 B
  Time    setup 224 µs, data 435 µs, read 1.54 ms, paginate 45 µs, render 205 µs, write 282 µs, copy 0 µs, after 20 µs
```

`dist/index.html` has a `SQUATCH SNACKS!` heading and a link to `/posts/pine-cone-crunch/`. You've got a website! (A site's first build is its first confirmed siting. After that it's plain `Built in`.)

To work on it with live reload, run the dev server and open <http://localhost:8080>:

```sh
ssqch serve
```

```text
First confirmed siting. Built in 2.75 ms (development)
  ...
Serving dist at http://localhost:8080/. Squatch Watch is on.
Fresh tracks in src/posts/pine-cone-crunch.md
Built in 1.92 ms (development)
  ...
Serving dist at http://localhost:8080/. Squatch Watch is on.
```

The address comes after each build's report, so it's on the last line however long the build was. With `--quiet`, the server prints the address once, without its name, and then only warnings and errors.

`ssqch serve` (it answers to Squatch Watch) rebuilds when your sources change, and it's careful about what it disturbs:

- **Only the page you're on reloads,** and only if it came out different. Edit another post, and the tab you're looking at stays where it is. The summary says how many pages changed: `Pages  168 written from 140 templates, 6.83 MB (1 changed)`.
- **A stylesheet is swapped in place,** without a reload, so the page keeps its scroll position and a half-filled form. That goes for CSS another tool writes into the output folder too (a PostCSS watcher, say): the browser hears about it without a rebuild, once the tool has finished writing it, so a page never reloads before its new CSS is there. The old stylesheet stays until the new one has loaded, so the page is never unstyled in between, and a new one that doesn't load (or comes back empty) leaves the old one in place. A changed script or image reloads the page.
- **A build that fails shows up in the browser,** over the page, with the error and the lines it's about. The tab's title and icon say so too, which is how you find out from another window. "Copy diagnostic" copies the error to paste into an issue or a chat, and Escape (or "Hide") puts it away until the error changes. The page underneath is from the last build that worked, and the next good build clears the error and says so in the terminal: `Build recovered. Back on the trail.`
- **A URL that isn't there** gets the site's `404.html`, or, when the site has none, a page of the server's own that says where the trail went cold and suggests the closest URL.
- **A site without a `favicon.ico`** gets a map-paper footprint on a pine circle in the tab, where there used to be a 404 on every page load. While the build is broken, the circle turns burnt orange.

None of that is written to the output folder: the server adds it to pages as it sends them.

**How the server runs:** `ssqch serve` builds in a second process, so it answers requests while a build runs. A site whose code ends the process (`process.exit()`, or an error nothing catches in a timer) fails that one build, shown in the browser like any other, and the next change builds in a new process: the server stays up. The build process starts again when the config changes, or a module it imports (including CommonJS ones), so everything the site's JavaScript loaded is read again and what it kept in memory starts over. It watches the input folder, the config's `watch` paths, a theme's folder, the config's own files and the files plugins read (a Sass partial in a folder the config never named), and a page that comes out the same as last time isn't read from the disk again. `node_modules` isn't watched. On Linux the server watches each folder itself and leaves out `.cache`, `.git` and `node_modules`; when the system has no watches left (`fs.inotify.max_user_watches`), a warning names the first folder that wasn't watched, and the server goes on. It listens on `127.0.0.1` only, and there's no `--host`.

To look at a production build the way a host will serve it (for Lighthouse, or a last check before deploying), run `ssqch build`, then `ssqch serve --built`: it serves the output folder as the build left it, with no build, no watching and nothing added to pages, and compresses text with gzip as hosts do. `ssqch preview` is the same command, for people coming from Vite or Astro.

`ssqch build` uses production mode and `ssqch serve` uses development mode, unless you pass `--env development|production` (or set `$SSQCH_ENV` or `$NODE_ENV`). The other options are `--output DIR`, `--base /path/` to serve the site [under a path](#serving-a-site-under-a-path), `--offline` to answer `fetch()` from saved copies only, `--port N` for `serve` (0 picks a free port), `--quiet` to print only warnings and errors, and `--verbose` to also list the slowest images to encode and the templates nothing used. Errors are red on a terminal and plain in a pipe, a log, or anywhere `NO_COLOR` is set. The other commands are `ssqch init`, `ssqch types`, `ssqch completions`, [`ssqch new`](#starting-a-new-page), [`ssqch inspect`](#where-a-value-comes-from), [`ssqch diff`](#comparing-two-builds), [`ssqch footprint`](#a-builds-footprint), [`ssqch import`](#trailheads-moving-from-another-generator), [`ssqch capabilities`](#scripts-and-coding-agents) and [`ssqch docs`](#scripts-and-coding-agents), and `ssqch build --format json` reports to a [script or a coding agent](#scripts-and-coding-agents).

## Configuring a site

> **Pro tip:** run `ssqch types` to write `ssqch.d.ts`, and list it in `jsconfig.json`'s `"include"` (`ssqch init` does both). Your editor then autocompletes config keys and plugin options, and underlines mistakes like `ouput` or `linksPlugin({ fail: "yes" })`, without any npm packages. Run it again after upgrading ssqch. (With ssqch from npm, the package has the same types, and you don't need both.)

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
  templateFormats: ["jinja", "md"],
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
| `templateFormats` | File extensions to render (default `["jinja", "md", "html"]`). A file in another template language the site has, like a `.edge` page when `edge` isn't listed, is left out with a warning that names it. |
| `markdownEngine`, `htmlEngine` | The engine that runs over `.md` and `.html` files first (default `"jinja"`; `false` for none). |
| `markdown` | Heading IDs, footnotes and the other Markdown extensions; see [Markdown](#markdown). |
| `deepMerge` | Merge objects and concatenate arrays through the data cascade (default `true`). |
| `leaveNoTrace` | Delete stale files from the output: pages and passthrough files an earlier build wrote that this one didn't, like a deleted post (default `false`). ssqch keeps a list of what it writes in `.cache/ssqch/output-files.json`, so files other tools write into the output (your CSS build, say) are never touched: it packs out only what it packed in. `clean` is another name for the same option (set one of them). |
| `filters` | `{ name: function }`, callable from templates: `{{ title | slug }}` or `{{ slug(title) }}`. Async functions are awaited. |
| `data` | `{ name: value }` for every template. A function (sync or async) is called on each build. |
| `collections` | `{ name: (pages) => ... }`. `pages` has `all()`, `byTag(tag)`, `byTags(...tags)` and `byGlob(glob or globs)`, oldest first. |
| `transforms` | `{ name: (content, page) => content }`, run on every output file. `page` has `url`, `inputPath` and `outputPath`. Return the content, changed or not. Async works. |
| `engines` | Template engines of your own: `{ extension: (source, data) => html }`, or an object with a `render(source, data)` method (async is fine). Add the extension to `templateFormats` to render those files; layouts in that extension work too, and `markdownEngine` can name one. `edge`, `md`, `html` and `txt` can't be replaced. |
| `ignore` | Globs, relative to the input folder, of files that aren't pages: `["drafts/**", "**/README.md"]`. |
| `bundles` | Page bundles: a folder whose page is `index.md` (or any `index.*` template) gets its other files, like photos and downloads, copied next to the page, so `![](photo.jpg)` just works. Subfolders with templates of their own, and data files, are left out (default `false`). |
| `strict` | Printing an undefined value (`{{ titel }}`) is an error that names the template and line, in every template language. Conditionals and defaults (`@if(subtitle)`, `{% if subtitle %}`, `x ?? "none"`) still work (default `false`). |
| `passthrough` | Files or folders to copy: a path, or `{ from: to }`, or an array of them. A path can be a glob: `"src/**/*.pdf"` keeps each file's own path, and `{ "assets/**/*.png": "images" }` puts them under `images/` by their path below `assets/`. Linked files and folders (symlinks) are followed and copied as files, and a link to nothing is an error that names it. |
| `watch` | More paths for `ssqch serve` to watch. |
| `budgets` | Size budgets by kind of file, checked after each build: `budgets: { pages: "150 KB", images: "500 KB", total: "300 MB" }`. A file over its kind's budget is a warning (`bigfootprint`). The kinds are `ssqch footprint`'s: `pages`, `images`, `css`, `javascript`, `fonts`, `media`, `documents`, `data` and `other`, plus `total`. See [A build's footprint](#a-builds-footprint). |
| `serve` | `serve: { run: ["npx postcss src/app.css -o dist/app.css --watch"] }`: programs `ssqch serve` starts with the server and stops with it, such as the watchers of your CSS and JavaScript tools. Their output is shown with the tool's name in front (`[postcss] ...`). The first build waits for their first compile, and each update waits until they have stopped writing. Builds don't run them. See [CSS and JavaScript](#css-and-javascript). In `sitesquatch.toml`, `[serve]` with `run = [...]`. |
| `beforeBuild`, `afterBuild` | Build hooks (a function or an array). They get `{ env, serving, dirs }`, plus `written` (the files written) after the build. Async works. A hook can also run a program: `afterBuild: { run: "npx -y pagefind --site dist" }` runs it in the project root (through `sh -c`, or `cmd /C` on Windows) with its output shown, and a failure fails the build. It gets `SSQCH_ENV`, `SSQCH_SERVING`, `SSQCH_INPUT` and `SSQCH_OUTPUT`, and each `node_modules/.bin` from the project's folder up goes in front of its `PATH`, as in an npm script, so a tool the site installed runs by name (`{ run: "postcss src/app.css -o $SSQCH_OUTPUT/app.css" }`) whether the build started from `npm run build` or a global `ssqch`. `serve.run` commands get the same. In `sitesquatch.toml`, `before_build` and `after_build` take lists of commands. |
| `theme` | A theme under the site: a folder (`"themes/docs"`), or a git repository pinned to a commit or tag (`"https://github.com/you/theme#v1.2.0"`). The site's own files win over the theme's, one by one. See [Themes](#themes). |
| `schemas` | What each kind of page's data has to look like, checked on every build: `{ posts: { fields: { title: "string", date: "date" } } }`. See [Content schemas](#content-schemas). |
| `base` | The path the site is served under, when that isn't the root of its domain: `base: "/repo/"` for a GitHub Pages project site at `https://you.github.io/repo/`. Templates, Markdown links and `page.url` stay as they are (`/about/`); ssqch adds the base to every URL from the site's root in the HTML it writes. See [Serving a site under a path](#serving-a-site-under-a-path). |
| `lastModified` | `page.lastModified`: `"git"` for when the page's file last changed in a commit (its modification time if it has uncommitted changes), or `"file"` for the modification time. Off by default. In CI, check out the full history (`fetch-depth: 0` in GitHub Actions), or every page gets the date of the last commit; the build warns about a shallow clone. |
| `plugins` | More config: objects with any of the keys above except the settings (`dirs`, `templateFormats`, `markdownEngine`, `htmlEngine`, `markdown`, `deepMerge`, `leaveNoTrace`, `ignore`, `bundles`, `strict`, `lastModified`, `base`, `schemas`, `theme`), or functions that return one, or a plugin written in Rust (`{ name, rust: { wasm, options } }`, what its npm package's function returns: see [Plugins in Rust](#plugins-in-rust)). `false`, `null` and `undefined` are skipped, so `env === "production" && minifyPlugin()` works. Give a plugin a `name` and errors will mention it. |

Mistakes get caught at the trailhead. A misspelled key or option is an error that says what you probably meant (`"templateFormat" isn't a config option (did you mean "templateFormats"?)`, or `unknown option "widhts" (did you mean "widths"?)` for a plugin), and so are two plugins that define the same filter, data or collection name (the message names both). When something in your code throws, you get `ssqch.config.js: too many pine cones` and a stack trace that points at your file, like `at bad (lib/filters.js:3:9)`.

### What you can import

Config and data files are loaded by Node, by its rules for ES modules and CommonJS, so they can import what Node can: relative files (`./lib/filters.js`, with or without the extension), JSON (`import site from "./site.json"`; ssqch adds the `with { type: "json" }` that Node wants if you leave it off), npm packages from `node_modules`, every Node built-in (`node:fs`, `node:path`, `node:child_process`, `node:http` and the rest, with or without the `node:` prefix), and the modules built into ssqch: `ssqch` (which has `defineConfig`, `markdown(text, { inline })`, `readData(path)` for JSON, YAML and TOML files, and `files(pattern)` for the files a glob matches), `ssqch/image`, `ssqch/rss`, `ssqch/minify`, `ssqch/assets`, `ssqch/links`, `ssqch/sitemap`, `ssqch/redirects`, `ssqch/sass` and `ssqch/elements`. The config itself can be `ssqch.config.js` or `.mjs`, `.cjs`, or `.ts` or `.mts` (Node strips the types, so only syntax that erases to JavaScript works: no `enum` or `namespace`).

A site's code runs in its project root (ssqch changes into it before loading anything), so `process.cwd()` and `readFileSync("data/snacks.json")` are from there. Relative paths in `fs` calls are Node's own, and so are its errors (`err.code === "ENOENT"`). On Windows, `node:path` joins with `\`, as Node does there; what ssqch hands your code (`page.inputPath`, `page.url`, a hook's `dirs`) has `/` everywhere.

Dates and numbers format as Node does, so `toLocaleDateString()`, `Intl.DateTimeFormat` and `localeCompare` use Node's own ICU, and their results can differ between Node releases (22.18 ships an older ICU than 24 and 26). ssqch's own date filters and sorting don't use `Intl`, so a build's output doesn't change with the Node version, the time zone or the locale unless your code asks it to ([Known gaps](#known-gaps)).

> **Note:** `ssqch serve` builds in a process of its own, and starts it again when the config changes, or when a module it imports does (your own files: ES modules, CommonJS ones and what they `require`, JSON, and JavaScript data files). Everything the site's code loaded is read again, and what a module kept in memory starts over, packages in `node_modules` included, though a change to a file inside `node_modules` isn't watched. If the new config has a mistake, the error is printed and the server carries on with the last configuration that loaded.

The globals are Node's: `fetch` (with `Headers`, `Request`, `Response`, `AbortController` and `AbortSignal.timeout()`), `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `EventTarget`, `Buffer`, `process` and the timers. A config or data file can use `await` above its `export` (top-level `await`) on every Node ssqch supports. `fetch` follows redirects and decompresses gzip, and rejects with a `TypeError` that names the URL when a request fails, with Node's reason after it (`fetch failed: http://127.0.0.1:9/: connect ECONNREFUSED 127.0.0.1:9`; the original error is the `cause`). Up to 8 requests are in flight at once, and the rest wait their turn, so `await Promise.all(urls.map(u => fetch(u)))` fetches in parallel without opening a thousand connections. Only `http:` and `https:` URLs can be fetched.

A data file that fetches runs on every build, including each rebuild in `ssqch serve`. To keep an API from being asked every time, give the request a `cache`:

```js
// src/_data/snacks.js
export default async function () {
  const response = await fetch("https://api.example.com/snacks", { cache: "1h" });
  return response.json();
}
```

- **A duration** (`"90s"`, `"30m"`, `"1h"`, `"7d"`, `"2w"`, or seconds as a number): a successful response is saved in `.cache/ssqch/fetch/`, and requests reuse it until it's that old. The key is the method, URL, request headers and body, so another query or token is another entry. The URL, request headers and cookies aren't written to disk (an API key is usually in one of them), only the response. The folder is the same format 0.7 used, so a copy saved by 0.7 is still good.
- **When a refresh fails** (the network is down, or the server answers 5xx or 429) and there's an older copy, the build uses it and warns: `warn: fetch: https://api.example.com/snacks answered 503; using the copy saved 3 hours ago`. Without a copy, the failure is the response, as usual. `cache: "0s"` asks every time and keeps the copy only for that.
- **The standard modes** work too: `"force-cache"` (a copy of any age, else ask), `"reload"` (ask, and save), `"only-if-cached"` (a copy, or fail) and `"no-store"` (the default).
- **Offline:** `ssqch build --offline` (or `SSQCH_OFFLINE=1`) answers every request from its saved copy, whatever its age, and fails a request that has none, so a build on a plane or in a sandbox never touches the network.
- **Seeing it:** a response from a copy has an `x-ssqch-cache` header (`hit`, or `stale` after a failed refresh), and the build summary counts them: `Fetch   12 requests, 9 from the cache`.

CI starts without `.cache/`, so production builds fetch fresh data unless you restore that folder.

### npm packages

Install packages with npm, pnpm or yarn as usual, and import them: `import { DateTime } from "luxon"`. Node finds them as it always does, in `node_modules` folders from the importing file's folder up (so monorepos and pnpm's symlinks work), using `package.json`'s `exports`, `imports` (`#internal`) and `main`. CommonJS works too: `.cjs` files, and `.js` files in packages without `"type": "module"`, run with `require`, `module.exports`, `__dirname` and `__filename`, and importing one gives `module.exports` as the default export and, where Node can read the names from its source, its properties as named exports (`import legacy from "legacy"; const { twice } = legacy;` is the safe way for a package whose exports are built at run time). Your own `.js` files follow Node's rules: `"type"` in your `package.json` decides, and without one Node 22 reads a file with `import` or `export` as an ES module and any other as CommonJS, so `module.exports = { ... }` in `_data/site.js` works. In an ES module, `createRequire(import.meta.url)` from `node:module` gives you a `require`.

Packages run on Node, as they are, so anything that works in a Node script works here: servers, child processes, streams, native addons and the file system. Eleventy's own libraries (liquidjs, nunjucks, markdown-it and its plugins, gray-matter), luxon, dayjs, date-fns, lodash, slugify, js-yaml, marked, highlight.js, prismjs, sanitize-html, html-minifier-terser, clean-css, feed, cheerio and @lit-labs/ssr all run, at Node's speed. Some have a faster built-in in ssqch (the `markdown` filter, `readingTime`, `ssqch/minify`, and `markdown: { highlight: true }` for highlighting), so reach for those packages when you need their particular output.

Every page is rendered on one thread, one call at a time (there are no worker threads), so module-level state in your config behaves as it would in any Node script: a counter in a filter counts every page in order. A filter or template gets your real objects, not copies, so a filter that sorts `collections.posts` in place reorders it for the pages rendered after it: copy first (`[...posts].sort()`).

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

**Files as data:** `files()` from `ssqch` lists the files a glob matches, for a photo album made from a folder or a page of downloads, without `readdirSync` and a date parser of your own:

```js
// src/_data/campPhotos.js
import { files } from "ssqch";

export default files("images/camp/*.{jpg,png}", { dimensions: true }).map((photo) => ({
  src: photo.url,
  width: photo.width,
  height: photo.height,
  taken: photo.date,
}));
```

- `files(pattern, { dimensions })`: the files `pattern` matches, from the project root, sorted by path. Each is `{ path, url, name, stem, ext, date, dateFrom, size }`: `path` from the project root (`images/camp/20011222_08.JPG`); `url` where a passthrough copy to the same path is served, from the input folder when the file is inside it (`src/images/a.jpg` is `/images/a.jpg`), otherwise from the project root (`/images/camp/20011222_08.JPG`); `name` (`20011222_08.JPG`), `stem` (`20011222_08`) and `ext` (`jpg`, lowercase); `date`, a date from the start of the name (`20011222_08.JPG` or `2001-12-22-camp.jpg`, at midnight UTC) or else the file's modification time; `dateFrom`, which says which (`"name"` or `"modified"`: a modification time is when the file was copied or edited, not when a photo was taken, so test `photo.dateFrom === "name"` before captioning one with its date); and `size` in bytes. The glob ignores case, so `*.jpg` finds `.JPG`, and `*` stops at `/` (`**` crosses folders). `{ dimensions: true }` adds `width` and `height`, read from each image's header: PNG, JPEG, GIF, TIFF, WebP, HEIF and AVIF, BMP, PSD, ICO and QOI files have them, and every other file (an EXR, a JPEG XL, a TGA, a text file) gets `null`. The first read takes a moment for a thousand photos (about 100 ms from a cold disk), so it's off by default; the sizes are kept in `.cache/ssqch/image-sizes.json` by path, size and modification time, so later builds read only new and changed files. No match is an empty list; a glob that isn't one, or that leaves the project (`../`, an absolute path), is an error naming the call. It lists files, nothing more: copy them to the output with `passthrough`, and resize them with `imagePlugin()`. In `ssqch.config.js` before the first build, `url` is from the project root, since the input folder isn't known yet.

**Unique slugs:** two items with the same title (two albums called "Misc Pictures") give a paginated template the same permalink, and the build stops with `output conflicts`, naming both. Make the slugs different in the data, with `slugger()` from `ssqch`, so the page's permalink and every link to it use the same one:

```js
// src/_data/albums.js
import { readData, slugger } from "ssqch";

const slug = slugger();
export default readData("data/albums.json").map((album) => ({ ...album, slug: slug(album.name) }));
```

- `slugger({ separator })`: a function that slugifies like `slugify(text, { separator })` and counts what it has made: the first `Misc Pictures` is `misc-pictures`, the next `misc-pictures-1`, then `misc-pictures-2`, skipping a number another title already took. Each `slugger()` counts on its own, so make one per list. In the template, `permalink: "photos/{{ album.slug }}/"` and the index page's `<a href="/photos/{{ album.slug }}/">` agree. `slugify(text, { separator })` from `ssqch` is the template filter, for data files.

### Built-in plugins

- **`ssqch/image`:** `imagePlugin(options)` turns every local `<img>` in HTML output into a `<picture>`. Options: `formats` (`avif`, `webp`, `jpeg`, `png`, `auto`), `widths`, `defaultAttributes`, `outputDir`, `urlPath`, `webpQuality`, `avifQuality`, `avifEffort`, `jpegQuality`, `minimumThreshold`, `prune`, `hashCache`, `linkedImages` and `cacheDir` (where images are encoded and kept, default `.cache/ssqch/img`; see [Keep the image cache between builds](#keep-the-image-cache-between-builds)). The quality options are sharp's own numbers, which go to its encoders as they are (libvips, with libaom for AVIF, libwebp, and mozjpeg for JPEG): `webpQuality` 75, `avifQuality` 41 and `jpegQuality` 89 by default (whole numbers from 1 to 100), and `avifEffort` 2 (0 is fastest, 9 slowest with the smallest files). Those are 0.7's defaults (WebP 75, AVIF 50 at speed 8, JPEG 80) converted at equal measured picture quality, so a site that sets none gets the pictures it had. Moving numbers from 0.7: WebP's are the same; AVIF 40 is 34, 50 is 41, 60 is 48, 70 is 55, 80 is 61 and 90 is 86; JPEG 60 is 72, 70 is 80, 80 is 89, 85 is 93 and 90 is 97 (from 0.7's JPEG 92 and AVIF 98 up it's sharp's 100, its best, a little short of 0.7's there); 0.7's `avifSpeed` is `avifEffort`, where speed 8 is effort 2 and speed 4 is effort 3 (0.8.0's changelog has the whole table). `avifSpeed`, or a number that isn't a whole one in range, fails the build and says what to use. A converted number keeps 0.7's image names, so an image cache from 0.7 in `.cache/ssqch/img` is used as it is (delete it to encode everything again); the files' bytes are sharp's, not 0.7's, and their widths and heights are 0.7's. PNGs are written without adaptive filtering (sharp's default), at zlib's level 6. AVIF is always there: sharp writes it, with no build feature. `[ssqch] Encoded ...` lines come as each image's files are done, while pages go on rendering, so they're among the `Writing` lines; the build waits for every file before the link checker, the other plugins' files, `afterBuild` hooks and the summary. Images are encoded on libuv's thread pool, as many at once as there are cores; the `ssqch` command sizes the pool to the number of cores plus 4 so page writes keep threads (set `UV_THREADPOOL_SIZE` to choose another size; with a smaller one, encodes wait their turn). Each file is encoded on one thread, so its bytes don't depend on the machine's cores. A file that can't be made after a page that points at it was written (sharp failing on a source that read well, a full disk) fails the build with an `images` error that names the source and the pages, rather than publish markup for a file that isn't there; a source ssqch can't decode is found before any page points at it, and is a warning that leaves its tag as written. On an `<img>`, `ssqch:widths="300,600"` picks that image's widths, a plain `width` attribute pins it to one width, and `ssqch:ignore` leaves it alone. `ssqch:preload` is for the image that's the page's largest paint (a banner): a `<link rel="preload" as="image">` with its `imagesrcset` and `imagesizes` goes in `<head>` before the first stylesheet, for the first of `formats`, and the image loads eagerly with `fetchpriority="high"` (`sizes="auto"` only works for lazy images, so `auto` is left out of its `sizes`). Images with a color profile other than sRGB (Display P3, Adobe RGB) are converted to sRGB first, so their colors stay true. A link to a local image (`<a href="/photos/big.jpg">`, the click-to-enlarge pattern) is pointed at a generated copy in the image's own format, at its own width capped at the largest of `widths`, so the link works without publishing the source file; `ssqch:ignore` on the `<a>`, or `linkedImages: false`, leaves links alone. `image(src, { widths, formats })` makes one image's files with the same settings and cache, returning `{ webp: [{ url, width, height, srcset, sourceType, ... }] }`; with `"auto"` in `formats`, the files are under `auto` too, next to the format it became (`png`). Its files are named after a hash of the source; `name` gives them a name and folder of your own, for URLs other things link to (`image("logos/acme.png", { widths: [200], name: "/assets/sponsors/acme" })` writes `/assets/sponsors/acme-200.webp`, and a name without a leading `/` is inside the image folder). Data files can call it even without the plugin. `imageUrl(src, { width, format })` is one generated copy, for URLs outside an `<img>` (`og:image`, JSON-LD, a feed): `{{ imageUrl(site.logo, { width: 1200 }).url }}` gives `{ url, width, height, type, format }`, at most `width` pixels wide (`"auto"`, the default, is the original's) in `format` (default `"auto"`, the source's own, which every reader can show). `src` is a site path, from the input folder, the way an `<img src>` starting with `/` is, and a remote URL comes back as `{ url }`. It's a template function on every site, and a named export of `ssqch/image` for data files.
- **`ssqch/minify`:** `minifyPlugin(options)` minifies HTML output, after the image transform. `minify(html, options)` does the same for a string. Options: `collapseWhitespace`, `removeComments`, `shortDoctype` and `shortenAttributes` (all `true` by default). `shortenAttributes` drops the values of boolean attributes (`defer="defer"` becomes `defer`) and whitespace that doesn't matter in `class`, `srcset`, `sizes`, URL attributes and the viewport `<meta>`. The minifier is ssqch's own, written in Rust and built into the package as WebAssembly (it minifies the blog's 169 pages in about 0.1 s). It doesn't write the same bytes as [html-minifier-terser](https://github.com/terser/html-minifier-terser): a site from Eleventy that wants those exact bytes, to compare with [`ssqch diff --exact`](#comparing-two-builds), keeps the package as a transform of its own, `transforms: { minify: async (content, page) => page.outputPath.endsWith(".html") ? await minify(content, options) : content }`, with `import { minify } from "html-minifier-terser"`, and moves to `minifyPlugin()` when the bytes stop mattering.
- **`ssqch/rss`:** `rssPlugin()` adds the filters `getNewestCollectionItemDate`, `dateToRfc3339`, `dateToRfc822`, `absoluteUrl`, `htmlToAbsoluteUrls` and `feedHtml`. They're also named exports, for your own code. `feedHtml(post.templateContent, absolutePostUrl)` is a post's HTML ready for a feed: a feed's HTML never goes through the image plugin, so each local `<img src>` is pointed at one generated copy (a single URL, not a `<picture>` or `srcset`, which many readers drop), a link to a local image at the copy a page's link gets, `loading`, `decoding`, `sizes`, `srcset`, `fetchpriority` and `ssqch:*` attributes go, and every URL is made absolute. Options, as a third argument: `width` (default 1200, never wider than the original; an `<img width>` that's smaller wins) and `format` (default `"auto"`, the source's). `feedHtml` makes the copies with the image plugin, so the config needs `imagePlugin()` as well; without it the build fails with `the image processor isn't set up`.
- **`ssqch/assets`:** `assetsPlugin({ files })` fingerprints CSS and JS for long-lived caching. Templates link the plain paths (`<link rel="stylesheet" href="/assets/index.css">`). In a production build, each listed file in the output folder (written there by your CSS or JS tool before `ssqch build`) is renamed to `index.<hash>.css`, older fingerprinted copies are deleted, and every `href` and `src` in the HTML that points at it is rewritten, keeping any query string. `ssqch serve` leaves the plain paths alone, unless the plain file isn't there but the last production build left a fingerprinted copy: then pages link to that copy (with a warning), so serving after a build without running your CSS and JS watchers still has styles. A listed file that's missing fails a production build. `assetUrl("/assets/index.css")` returns the URL to use, for places outside an `href` or `src`. Imports in inline module scripts are rewritten too (`<script type="module">import { setup } from "/assets/pco.js"</script>`, and `import("/assets/pco.js")` with a plain string), and a listed file can be a passthrough copy: it's copied into the output before it's fingerprinted. `url()` references inside CSS and imports inside JavaScript files aren't rewritten. Options: `files` (URL paths, required), `fingerprint` (`true` or `false`; on for production builds by default) and `integrity` (add `integrity="sha384-..."` to the `<link>` and `<script>` elements that load a fingerprinted file; default `false`).
- **`ssqch/links`:** `linksPlugin(options)` checks the built site's internal links after each build. Every `href` (on `a`, `link` and `area`), `src` (images, scripts, iframes, media), `srcset` and `imagesrcset` URL has to point at something in the output, and a `#fragment` has to match an `id` on the page it points to. URLs outside attributes are checked too, when they're on the site (from its root, or absolute on its address): `<meta>` values that are URLs (`og:image`, `og:url`, `twitter:image`), strings in `application/ld+json` blocks (without their `#fragment`, which names a thing there), and in `.xml` output (feeds, the sitemap), URLs in attributes and in elements like `<loc>` and `<id>`, including the escaped HTML of a feed entry's content. That's where an image URL the image plugin never saw shows up: a feed's `<img>` pointing at a source file that isn't published. The site's address is the `url` option, or the one `sitemap.xml` uses; links to it (`https://example.com/about/`, `http` or `https`) are checked like links from the root. Other external links aren't checked, and neither are paths a Netlify `_redirects` file in the output covers. Broken links fail production builds, listing each page and link (the first 20, then `... and N more (--verbose lists them all)`; `--verbose` lists every one), and are warnings in `ssqch serve`. One that's nearly right says what it probably meant: `/about/ -> /contactt/ (not found; did you mean /contact/?)`, and the same for an `id`. Options: `anchors` (check `#fragments`; default `true`), `ignore` (URL path prefixes to skip, like `["/downloads/"]`), `fail` (`true` or `false`; production builds only by default) and `url` (the site's address, like `"https://example.com"`; default: the address in `sitemap.xml`).
- **`ssqch/sass`:** `sassPlugin({ files: { "src/scss": "/css" } })` compiles Sass with [grass](https://github.com/connorskees/grass), a Rust compiler built into the package as WebAssembly (no Dart Sass to install). It's 0.7's compiler, so stylesheets come out as 0.7 wrote them; Dart Sass writes some CSS differently, and a site that needs its bytes can run the `sass` package from `beforeBuild` instead (`{ run: "sass src/scss:dist/css" }`). A folder compiles every `.scss` and `.sass` file in it that doesn't start with `_`, keeping their paths; a file (`{ "src/app.scss": "/app.css" }`) compiles to the path given. The CSS is written at the start of each build, so `ssqch/assets` can fingerprint it and the link checker sees it, and `ssqch serve` rebuilds when a source changes. Options: `files` (required), `style` (`"compressed"` for production builds and `"expanded"` otherwise, by default) and `loadPaths`. (Yes, that makes it Sassquatch.)
- **`ssqch/sitemap`:** `sitemapPlugin({ url: "https://example.com" })` writes `sitemap.xml` listing every HTML page with its absolute URL and its date as `<lastmod>`. Left out: pages with `sitemap: false` in their data, 404 pages, pages 2 and on of a list split into pages (pagination with a `size` over 1; a page per tag is still listed), and URLs matching `exclude` globs (`["/tags/**"]`). Options: `url` (required), `exclude`, `lastmod` (default `true`), `output` (default `"/sitemap.xml"`) and `paginated` (list every page of a split list).
- **`ssqch/elements`:** `elementsPlugin()` is interactivity without a framework. A custom element is a tag with a hyphen (`<like-button>`) and a script that defines it. Put `like-button.js` in `src/elements/` (and `like-button.css` next to it, if it has styles), write the tag in any page or layout, and that page gets the script and the stylesheet; pages without the tag get neither, so a page with no elements loads no JavaScript. What's inside the tag is the fallback a visitor sees before the script runs, or without JavaScript: `<like-button><a href="/likes/">3 likes</a></like-button>`. `ssqch:load` on a tag says when its script loads: `eager` (with the page, the default), `idle` (when the browser has a quiet moment) or `visible` (when the element scrolls into view), which is the "islands" idea without a framework to run it. The whole folder is copied to `/elements/`, so elements can import shared modules (a file without a hyphen in its name isn't an element). Options: `dir` (default: `elements` in the input folder, which has to exist), `url` (default `/elements/`) and `load` (`eager`, `idle` or `visible`: the default for tags without `ssqch:load`; any other value is an error that says so). The [`islands` example](examples/sites/islands/) has three small elements.

- **`ssqch/redirects`:** `redirectsPlugin(options)` keeps old URLs working. A page lists its old URLs in front matter (`aliases: [/2019/pine-cones/, /pine.html]`), and the `redirects` option adds others (`{ "/feed/": "/feed.xml" }`, where the new URL can be on another site). Each old URL gets a small page that sends visitors on (a meta refresh, a canonical link and `noindex`), and with `netlify: true`, a `/old  /new  301` line is appended to `_redirects`, after any lines your own `_redirects` template writes, and [`linksPlugin()`](#built-in-plugins) honors those lines. An old URL that's another page's URL is an error. For redirect pages in your own markup, add `_includes/hooks/redirect.*` (any engine): it gets `redirect.from` and `redirect.to` with the site's global data. Options: `pages` (default `true`), `netlify` (default `false`) and `redirects`.

### Configuring with TOML

A site that needs no code at all can use a `sitesquatch.toml` instead (one or the other, not both). Every key is optional, they're the config's settings in snake case (`template_formats`, `leave_no_trace`, `before_build`), and an unknown key is an error that lists all of them.

```toml
input = "src"
output = "public"
template_formats = ["jinja", "md", "html"]

ignore = ["drafts/**"]
leave_no_trace = true   # or `clean = true`, its other name

[serve]
run = ["npx postcss src/app.css -o public/app.css --watch"]

[markdown]
heading_ids = "blackfriday"

[passthrough]
"src/robots.txt" = ""   # empty keeps the path relative to the input directory
```

## CSS and JavaScript

ssqch doesn't bundle CSS or JavaScript. It gets them into a site in one of four ways, and the tools you already use stay in charge of the rest:

- **Plain CSS and ES modules:** copy them with `passthrough` (`passthrough: [{ "src/assets": "assets" }]`). Browsers load modules and `@import` without a bundler, which is often all a small site needs.
- **Sass:** `sassPlugin()` from `ssqch/sass` compiles it on each build, with a Rust compiler built into ssqch ([Built-in plugins](#built-in-plugins)).
- **Any other tool, for builds:** run it in `beforeBuild` (`{ run: "npx esbuild src/app.js --bundle --outfile=dist/app.js" }`), so `ssqch build` writes the CSS and JavaScript before it checks links and fingerprints them.
- **Any other tool, while serving:** list its watcher in `serve.run`. `ssqch serve` starts it with the server, shows its output, and stops it (and whatever it started) when the server stops. When the watcher writes a file, the page picks it up: stylesheets swap without a reload. The server waits for the watchers' first compile before its first build (up to 2 seconds, then it says they wrote nothing and builds anyway), so the first page has its CSS, and after a rebuild it holds the browser's update until they have finished writing (150 ms of quiet), so an edit that adds Tailwind classes is one reload with the new CSS, not the page first and its CSS a moment later. If something else deletes what the watchers wrote (a production build into the same folder), the server starts them again and rebuilds.

`assetsPlugin()` from `ssqch/assets` then fingerprints what the tools wrote, for production builds (`app.css` becomes `app.3dc88db1.css`, and every link to it is rewritten).

Tailwind, for example, built once for `ssqch build` and watched for `ssqch serve`:

```js
import { defineConfig } from "ssqch";
import { assetsPlugin } from "ssqch/assets";

const tailwind = "npx @tailwindcss/cli -i src/app.css -o dist/assets/app.css";

export default defineConfig(({ serving }) => ({
  dirs: { input: "src", output: "dist" },
  // A build runs it once; the server keeps it watching instead of running it on every rebuild.
  beforeBuild: serving ? [] : { run: `${tailwind} --minify` },
  serve: { run: [`${tailwind} --watch`] },
  plugins: [assetsPlugin({ files: ["/assets/app.css"] })],
}));
```

The layout links `/assets/app.css`. Tailwind reads the templates for class names on its own; `@source "../src";` in `app.css` tells it where they are if it doesn't find them.

When a page links a stylesheet or script that isn't in the output, `ssqch serve` says so instead of leaving an unstyled page to explain itself: a note in the corner of the page, and a warning in the terminal that names the `serve.run` tool that should have written it (or suggests one), repeated after each build until the file turns up.

## Trailheads: moving from another generator

Everything migrates eventually. The trailheads map another generator's config, front matter and templates onto ssqch's, and `ssqch docs --from <generator>` prints the one you need: [from Zola](docs/trailheads/from-zola.md), [from Eleventy](docs/trailheads/from-eleventy.md), [from Docusaurus](docs/trailheads/from-docusaurus.md), [from MkDocs](docs/trailheads/from-mkdocs.md), [from Hexo](docs/trailheads/from-hexo.md) and [from component frameworks](docs/trailheads/from-component-frameworks.md) (Astro, VitePress, Next.js, Gatsby). [`examples/sites/`](examples/sites/) has small, complete sites to start from or copy parts of, each built in CI: `blog-tags`, `blog-categories`, `docs-sidebar`, `glossary-docs`, `versioned-docs`, `component-docs`, `reference-pages` and `islands`.

For a Zola site, `ssqch import zola` moves `tags` out of `[taxonomies]` and turns `path` into `permalink` in each page's front matter, writes a first `ssqch.config.js` from `config.toml` (the site's data, Markdown options, Sass, redirects, a sitemap), and lists what the Tera templates, shortcodes and sections need.

For an Eleventy site, `ssqch import eleventy` does the mechanical part. It renames `*.11tydata.*` files, rewrites front matter keys and image attributes to ssqch's names, writes a first `ssqch.config.js` from what it can read in the Eleventy config (folders, passthrough copies, template engines, `pathPrefix`), and lists what's left to port by hand, each with its file and line and what it becomes: filters, shortcodes, collections, plugins and their ssqch equivalents. Without `--write` it only prints the list, so run it in a clean git checkout, read it, then run it again with `--write`:

```sh
ssqch import eleventy            # what would change, and what's left (or: ssqch import zola)
ssqch import eleventy --write    # make the changes
```

Habits come along too. Where another generator's word means the same thing in ssqch, it works, and says ssqch's name once (`--quiet` hides it):

```text
$ ssqch dev
note: dev works; ssqch calls it serve (ssqch docs serve)
```

The words that work: the commands `dev`, `start`, `server` and `watch` (for `ssqch serve`), `preview` (`ssqch serve --built`) and `generate` (`ssqch build`); the flags `--watch` and `--serve` (`ssqch serve`), `-d` and `--destination` (`--output`) and `--pathprefix` (`--base`); the config options `pathPrefix` (`base`), `dir` (`dirs`), `publishDir` and `outDir` (`dirs.output`), and `markdownTemplateEngine` and `htmlTemplateEngine` (`markdownEngine` and `htmlEngine`); the front-matter keys `eleventyComputed` (`computed`), `eleventyExcludeFromCollections` (`excludeFromCollections`), `redirect_from` (`aliases`) and `templateEngineOverride` (`render`, its `"njk,md"` string included); and, in Jinja, Nunjucks and Liquid, the filters `url` and `relative_url` (they give the URL back as it is, since the build adds `base` itself) and `markdownify` (`markdown`). An alias and ssqch's name for the same thing together are an error (`pathPrefix and base are two names for one option`). The docs, starters and messages use ssqch's names, and `ssqch build --format json` lists the aliases a site used in `aliases` rather than in `warnings`.

A word that would mean something else in ssqch is refused, with ssqch's name for it and where to read more:

```text
$ ssqch check
error: unrecognized subcommand 'check'

  `ssqch build` checks as it builds: content schemas on every build, and internal links with `linksPlugin()`.
  More: ssqch docs "Content schemas"
```

Hugo's `baseURL` (a full URL, where `base` is a path), `--drafts` and `-D` (ssqch builds drafts in development, not with a flag), `addPassthroughCopy` and the other `add*` calls (an ssqch config is an object), `{{ eleventy.generator }}`, Jekyll's `site.posts` and `published: false`, and `eleventyNavigation` (ssqch's own navigation reads `nav`; templates that call eleventy-navigation's filter still read it) get the same treatment (every unknown config option is listed in one go), and `ssqch build --format json` carries the answer as data, in a `hint` with `use` (ssqch's name) and `more`. A folder that has another generator's config and no ssqch config gets a warning naming the importer and `ssqch docs --from`, instead of a build with ssqch's defaults that nobody asked for. `ssqch docs --from eleventy` (or `hugo`, `jekyll`, `zola`, ...) lists that generator's words with ssqch's for each, marking the ones that work, then prints its trailhead, and `ssqch docs pathPrefix` answers for one word.

Whichever generator you're leaving, build the site with it and with ssqch and run [`ssqch diff`](#comparing-two-builds) on the two output folders: it shows which pages differ and how, so you know when the move is done.

## Templates and data

The lay of the land:

- **The data cascade:** a page's data comes from several places, and each one replaces what the ones before it set: global data, the front matter of its layouts, directory data, the page's data file, its front matter, then `computed`. [Where a value comes from](#where-a-value-comes-from) has the exact order, and `ssqch inspect` shows it for any page.
- **Collections:** tags become collections, sorted by date, plus your custom ones. `excludeFromCollections: true` keeps a page out.
- **Pagination:** `data`, `size`, `alias`, `reverse`, `filter`, `addAllPagesToCollections` and hrefs. `data: collections` goes over the collections' names, for a page per tag (`filter: [all]` leaves `all` out).
- **Permalinks:** dynamic permalinks, `permalink: false` and `dynamicPermalink`. A permalink (or `computed` value) with `{{ }}` renders in the page's own template language, so a Liquid page can write `permalink: "/{{ title | slugify }}/"`; Markdown and HTML pages use their `markdownEngine` or `htmlEngine` (Edge when that's `false`).
- **Front matter:** YAML between `---` lines, TOML between `+++` lines, or JSON after `---json` (`---yaml` and `---toml` work too). `.markdown` files are Markdown, like `.md`.
- **Navigation:** `navTree(nav, page.url)` takes a tree from data (`_data/nav.yml`: entries with `title`, `url`, and children under `children`, `items` or `pages`) and marks each entry `current`, `ancestor` or `open`, for a sidebar that highlights where you are. `navPager(nav, page.url)` returns `{ previous, next }` in reading order, and `navBreadcrumbs(nav, page.url)` the entries from the top down to the page. To build the tree from front matter instead, give pages `nav: { title, parent, order }` (or `nav: true`; `parent` names another entry's title, or its `key` when it has one) and use `pagesTree(collections.docs)`. URLs match with or without `index.html` and the last `/`.
- **Dates:** a page's `date` comes from its data, then from the start of its file name (`2024-06-01-post.md`), then from when the file last changed. `computed.date` works too.
- **Drafts:** `draft: true` builds the page in development (`ssqch serve`, or `--env development`) and leaves it out of production builds, collections included.
- **Excerpts and reading time:** `page.excerpt` is the HTML before a `<!-- more -->` comment, or else the first paragraph, for layouts and collections (`post.page.excerpt` in a list of posts). `readingTime(content)` is the minutes it takes to read some HTML at 200 words a minute (`readingTime(content, 250)` for another pace), at least 1.
- **Slugs:** `slugify("Pine Cone Crunch!")` is `pine-cone-crunch`: lowercase letters and digits, with a dash for each run of anything else (apostrophes are dropped, and letters outside ASCII are kept). It's the same function in every template language (`{{ title | slugify }}` in Jinja, Nunjucks and Liquid), and a config filter named `slugify` replaces it. `slugify(title, { separator: "_" })` (or `slugify(title, "_")`, `{{ title | slugify: "_" }}` in Liquid) puts another separator between the words, for URLs like `/recipes/taco_bake/`. Apostrophes are dropped (`Drew's Brownies` is `drews-brownies`); `apostrophes: "separate"` splits words there instead (`drew-s-brownies`), for a site whose URLs were made that way. Another option is an error. Before replacing a site's own slug filter with `slugify`, build with both and compare with `ssqch diff`: one changed URL is a broken link. Data files can import it, and `slugger()`, from `ssqch`.
- **Choosing engines:** pages are Jinja (`.jinja`) unless you list other languages in `templateFormats`, and `.md` files run through Jinja first, then Markdown (change that with `markdownEngine` and `htmlEngine`). Layouts follow the same rules, so a `.html` layout is a Jinja template by default. A template's `render` front matter overrides it: `render: md` for Markdown only (handy for a post full of `{{ }}` code samples), `render: [edge, md]` for a chain, or `render: false` to write the body as it is. A layout chain can mix languages (a Markdown post in a Liquid layout that sits in an Edge one). Around here that's called trail mix.
- **Everything else:** layout chaining, `page.*`, `templateContent` in collections, and an error when two pages would write the same file. Every template can read `ssqch.version`, `ssqch.env`, `ssqch.serving` and `ssqch.generator`.

Templates are [Jinja](#jinja-and-nunjucks) by default; [Edge](#edge), [Liquid](#liquid), [Nunjucks](#jinja-and-nunjucks), [Handlebars and Mustache](#handlebars-and-mustache) and [EJS](#ejs) are a `templateFormats` entry away, and one site can use several.

When a template fails, the error names the file and line (counted as the file is, front matter included) and is followed by the lines it's about, with carets under the part the message names when it quotes one:

```text
error: 1 error(s):
  - rendering posts/pine.md with `jinja`: posts/pine.md:8: unknown filter `rnd` (did you mean `round`?)

  --> src/posts/pine.md:8
   6 | Crunchy, foresty, and only slightly sticky.
   7 |
   8 | The count is {{ sightings.total | rnd(1) }} so far.
     |                                   ^^^
```

A Jinja filter, test or function that doesn't exist says which one you probably meant, and so does a layout, a Jinja or Nunjucks template (`include`, `extends`, `import`) or an Edge include that isn't there (``layout `bse` not found: no sightings in src/_includes (did you mean `base`?)``). One that leads back to itself names the loop instead of running out of patience: `we've passed this tree before. Layout loop: base.edge -> wrap.edge -> base.edge`.

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
| `headingAttributes` | `true` | `## Install {#setup .wide}` sets the heading's `id` and `class`. An `id` given this way always wins. Markdown that runs through Jinja or Nunjucks first (the default) keeps it: `{#` at the end of a line, closed by `}` rather than `#}`, isn't a comment there. |
| `footnotes` | `true` | `[^1]` references, with the notes in a `<section class="footnotes">` at the end and links back to each reference. |
| `taskLists` | `true` | `- [ ]` and `- [x]` items, as disabled checkboxes. |
| `autolinks` | `true` | Bare `https://` and `www.` URLs become links. |
| `alerts` | `true` | GitHub's `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]`, as `<div class="markdown-alert markdown-alert-note">` with a title, the same markup GitHub uses (or a container template of that name, below). |
| `containers` | `true` | `::: name args` blocks (below). |
| `definitionLists` | `false` | A term, then `: definition` lines, as `<dl>`. |
| `smartPunctuation` | `false` | Curly quotes, `--` and `---` as dashes, `...` as an ellipsis. A `--` that follows a space and runs into a word stays as it is, so `run it with --fix` keeps its flag. |
| `indentedCode` | `true` | Lines indented four spaces are code. `false` makes them ordinary Markdown, for HTML indented inside Markdown; fences are still code. |
| `highlight` | `false` | Syntax highlighting at build time (below). `true`, or `{ css: "/assets/code.css" }` to put the stylesheet somewhere else, or `{ css: false }` to leave it out. `languages` adds languages or replaces built-in ones: `{ languages: { chordpro: code => tokens, cho: "chordpro", snack: "grammars/snack.sublime-syntax" } }` (below). |

**Syntax highlighting:** with `highlight: true`, fenced code is highlighted while the site builds, so pages need no highlighting script. The grammars are Sublime Text's and TextMate's (about 200 languages, from [syntect](https://github.com/trishume/syntect) and [bat](https://github.com/sharkdp/bat)), plus ssqch's own for the template languages those don't cover (`edge`, `liquid`, `hbs`, `mustache` and `ejs`: the tags, over highlighted HTML) and for ChordPro songs (`chordpro` and `cho`: directives, `[G7]` chords and comments), and each token gets one class for what it is: `hl-keyword`, `hl-string`, `hl-comment`, `hl-function`, `hl-type`, `hl-number` and so on. The build writes a stylesheet for them to `/highlight.css` (link it from your layout) with GitHub's colors, light and dark. Each color is a CSS custom property, like `--hl-keyword`, so a theme switch or your own palette only has to set those. Mark lines with braces in the fence's info string, ```` ```js {1,4-6} ````, and those lines get `class="line highlighted"`. A language without a grammar renders as plain `<pre><code class="language-x">`.

**Your own languages:** `languages`, in `highlight: { languages: { ... } }`, gives a highlighter for a language ssqch doesn't have (a custom syntax highlighter), or replaces a built-in one. Each name is a fence's language, matched in any case, and it comes before the built-in grammars. A highlighter can be a function, `(code, lang) => tokens`, that returns the code cut into tokens, as `[text, kind]` pairs or `{ text, kind }` objects, where `kind` is one of the `hl-*` names without the prefix (`comment`, `keyword`, `operator`, `string`, `regexp`, `escape`, `number`, `constant`, `builtin`, `property`, `attribute`, `function`, `type`, `parameter`, `tag`, `heading`, `strong`, `emphasis`, `link`, `inserted` or `deleted`) and a token without one (or a plain string) is plain text. ssqch escapes the text and writes the spans, so marked lines and `/highlight.css` work as they do for the built-in languages. The tokens' text has to add up to the code; when it doesn't, or the function throws or returns another kind, the build warns (naming the page) and that fence is plain text. A highlighter can also be another language's name, an alias (`cho: "chordpro"`, `jsx: "js"`), or the path of a Sublime Text `.sublime-syntax` grammar from the project root, for a language that has one. A replacement only takes the name it's given: `js: fn` leaves `javascript` fences to the built-in grammar, unless you add `javascript: "js"`. The languages apply everywhere highlighting does: fences, `highlight(code, lang)` and a fence hook's `highlighted`.

```js
// Trail notes: a line that starts with `!` is a warning, and `@Cedar` names a trail.
const trailnotes = code => code.split( /(^!.*$|@\w+)/m ).filter( Boolean ).map( text => text.startsWith( "!" ) ? [ text, "deleted" ] : text.startsWith( "@" ) ? [ text, "type" ] : [ text ] );
export default { markdown: { highlight: { languages: { trailnotes, trail: "trailnotes" } } } };
```

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

```jinja
{# src/_includes/hooks/heading.jinja #}
<h{{ heading.level }} id="{{ heading.id }}">{{ heading.content | safe }} <a href="#{{ heading.id }}" class="anchor" aria-hidden="true">#</a></h{{ heading.level }}>
```

Put `aria-hidden="true"` on decoration like that `#`, and `page.headings` leaves it out of the heading's text.

### Jinja and Nunjucks

Jinja is ssqch's default template language: `.jinja` (and `.j2`) pages and layouts render with ssqch's own fork of [Nunjucks](https://mozilla.github.io/nunjucks/), the library Eleventy's Nunjucks templates run on, with Jinja's filters, tests, functions and string, list and dict methods on top, so templates written for Jinja (MkDocs themes, say) run too. Markdown and HTML files run through it first. `ssqch init` starts a site in it. `.njk` files render with the same library, printing values as Nunjucks does. Add `"njk"` (Nunjucks) or `"j2"` to `templateFormats` for those extensions, `markdownEngine: "njk"` to run Markdown through the Nunjucks flavor, and `render: [njk, md]` to do that for one post. A home page, `src/index.jinja`, that lists the posts:

```jinja
---
layout: base.jinja
title: Squatch Snacks
---
{% for post in collections.posts %}
  <h2><a href="{{ post.url }}">{{ post.data.title }}</a></h2>
  <p>{{ post.date | dateformat("%B %-d, %Y") }}</p>
{% endfor %}
```

- **Data:** front matter, the cascade, `page`, `collections` and `content` in layouts, the same as in the other engines. Undefined values, and properties of undefined values, print nothing (`strict: true` makes printing one an error).
- **Escaping:** output is HTML-escaped, as in Nunjucks and Jinja; use `| safe` to opt out. A layout's `content` is already marked safe, so `{{ content }}` works.
- **Filters and functions:** Jinja's built-in filters, plus Nunjucks' own (`dump`, `truncate`, `forceescape`, `nl2br`, `urlize`, `wordcount`, `center`, `random`), and `pluralize`, `filesizeformat`, `striptags`, `cycler()` and `joiner()`. Your config `filters` work both ways: `{{ title | shout }}` and `{{ shout(title) }}`. On a page whose data has a field with a function's name, the call finds the field first, so use the filter form there. An async function is awaited.
- **JavaScript properties and methods:** Nunjucks templates use JavaScript's, and they work in `.njk` and `.jinja` files alike. `.length` counts a list's items or a string's characters (`{{ collections.posts.length }}`, the same as `| length`); `loop.length` and an object's own `length` key keep their meaning, and on any other object `.length` is undefined, as in JavaScript. Strings and lists also have `startsWith()`, `endsWith()`, `includes()`, `indexOf()`, `toLowerCase()`, `toUpperCase()` and `trim()`, beside Python's (`startswith()`, `lower()`).
- **Dates:** `{{ page.date | dateformat }}` prints `Mar 14 2026`. `dateformat`, `timeformat` and `datetimeformat` take `"short"`, `"medium"`, `"long"`, `"full"`, `"iso"`, `"unix"`, or a `strftime` pattern (`dateformat("%B %-d, %Y")`), in UTC. Dates also have Python's `strftime()` and `isoformat()` and JavaScript's `toISOString()` and friends, and `now()` is the build's time.
- **Your own tags:** a config filter is a tag too, in `.njk` and `.jinja` files alike. `{% image "/a.png", "A pine" %}` prints what `image("/a.png", "A pine")` returns, without escaping it. With a closing tag, the function gets what's between them first: `{% callout "tip" %}...{% endcallout %}` calls `callout(content, "tip")`. That covers the built-in filters as well, so `{% markdown %}...{% endmarkdown %}` renders Markdown inside a template.
- **Includes and inheritance:** `{% include %}`, `{% extends %}` with `{% block %}`, `{% import %}` and `{% from ... import %}` read from `_includes`. Front-matter `layout` works too.
- **Nunjucks syntax:** `{% elseif %}`, `===`, `{ title: x }`, `{% for key, value in object %}` and Nunjucks' own filters work in `.jinja` files as in `.njk`. Not supported: extensions that parse a tag's arguments themselves.
- **Two flavors:** `.njk` prints values as Nunjucks does, as a site from Eleventy expects (`true`, a list as `a,b`, an object as `[object Object]`, `none` as nothing, and `dump` as compact JSON, escaped unless it's followed by `| safe`; `dump(2)` indents it). `.jinja` and `.j2` print as Jinja does (`True`, `['a', 'b']`, a spaced, unescaped `dump`). A date prints as ISO 8601 in both, whatever the machine's time zone.
- **Where Nunjucks isn't Jinja:** a variable set inside a loop or an `if` keeps its value after it (`{% set total = 0 %}{% for x in xs %}{% set total = total + x %}{% endfor %}` ends with the sum; `namespace()` still works), and a variable set in an include stays in the include, so set it in the page, or have the include print it. `{% break %}`, `{% continue %}`, `{% with %}`, `{% autoescape %}`, `{% for x in xs if x.ok %}` and `recursive` loops are errors that name their line and say what to write instead (an `{% if %}` inside the loop, `xs | selectattr("ok")`, a macro that calls itself). `loop.previtem`, `loop.nextitem` and `loop.depth` are undefined. Numbers have no separate float type (`{{ 4 / 2 }}` prints `2`), and `+` and `*` are JavaScript's: join lists with `xs | chain(ys)`.
- **Errors** name the template and line: `broken.njk:2: syntax error`.

### Edge

[Edge.js](https://edgejs.dev) templates (`.edge`) render with edge.js itself (6.5), so what its documentation describes works. Add `"edge"` to `templateFormats`, and `markdownEngine: "edge"` to run Markdown through it (`ssqch init --engine edge` does both). Its components with slots are handy in Markdown: [`component-docs`](examples/sites/component-docs/) uses them in place of MDX.

```js
export default defineConfig({
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
});
```

All of edge.js is there: `{{ }}`, `{{{ }}}`, `{{-- --}}`, `@{{ }}`, `@if/@elseif/@else/@unless`, `@each` (with index, objects, `@else` and `$loop`), `@let` (destructuring included) and `@assign`, `@include` and `@includeIf`, `@component` and `@!component` with named slots and isolated scope, `@eval`, `@inject`, `@stack` and `@pushTo`, `~` whitespace control, and edge.js's helpers (`excerpt`, `html.attrs`, `nl2br` and the rest; `nl2br` gives HTML to print as it is, so escape what it's given: `{{{ nl2br(html.escape(text)) }}}`). Expressions are JavaScript: object and array literals, template literals, optional chaining, arrow functions with block bodies, regular expressions, the `in` operator, `await`, and Node's globals (`process`, `URL`; a page's value or a config function of the same name wins). `await` waits for a promise, and an async function (an async config filter) is awaited when it's called in a mustache or `@let`. Inside a callback it's awaited in `map` (`posts.map(p => cover(p))`), and in `filter`, `find` and the others it's an error that says to call it first with `@let`.

ssqch keeps what its Edge did in 0.7 around edge.js, so a template that rendered then renders now: an undefined value prints nothing (edge.js prints `undefined`), a call reaches the config filter when the page has a field of the same name (`{{ image(...) }}` beside `image:` in front matter), a mustache can start with an object literal (`{{ { tip: 'T' }[kind] }}`), `@let(n = n - 1)` reads the value it replaces, `reverse()` and `sort()` give copies (so a page can't reorder a collection under the next one), dates are in UTC and print as ISO 8601, strings index by character, and numbers never print in exponent notation. `{{ safe(html) }}` prints `html` as it is, as edge.js's `html.safe` does. A variable an include declares with `@let` stays in the include unless the including template declares it first. Errors report `template:line` through the include and component chain, a parse error is in edge.js's words (`parse error in page.edge: line 2: Unexpected token`), and a function that isn't there says which one you probably meant (``index.edge:2: `uper` is not a function (did you mean `upper`?)``), or ssqch's name for another generator's (`slug`).

### Liquid

Coming from Jekyll or a Shopify theme? Add `"liquid"` to `templateFormats` and `.liquid` pages and layouts render with [liquidjs](https://liquidjs.com) (10.30), the Liquid library Eleventy uses. Use `markdownEngine: "liquid"` to run Markdown through Liquid instead of Jinja, or `render: [liquid, md]` for one post.

```js
import { defineConfig } from "ssqch";

export default defineConfig({
  templateFormats: ["liquid", "md"],
  markdownEngine: "liquid",
  filters: { shout: (s) => s.toUpperCase() },
});
```

- **Data:** Liquid templates get the same data as the other engines: front matter, the cascade, `page`, `collections` and `content` in layouts. Unknown variables and properties print nothing, as in Jekyll.
- **Filters:** liquidjs' standard filters and tags (`where_exp`, `sum`, `{% liquid %}`, `{% echo %}`), Jekyll's `push`, `pop`, `shift`, `unshift`, `array_to_sentence_string`, `date_to_xmlschema`, `date_to_rfc822`, `date_to_string` and `date_to_long_string`, and Shopify's `pluralize`. `slugify` is ssqch's, the same as in the other languages. Your config `filters` work too: `{{ title | shout }}` calls `shout(title)`, and `{{ x | wrap: "[", "]" }}` calls `wrap(x, "[", "]")`. A config filter replaces a built-in one with the same name.
- **Dates** print as ssqch's Liquid has always printed them (`2026-01-02 00:00:00 +0000`, in UTC, whatever the machine's time zone) in every filter, and `date` reads ISO 8601 text (`2024-03-04`).
- **Objects:** `{{ some_object }}` prints `[object Object]`, so write `{{ some_object | json }}`; `{{ some_object.size }}` is its number of keys, and a string's `size` counts as JavaScript does (`café` is 4). A variable named `empty` or `blank` is Liquid's keyword (`{% if empty %}`), so rename it.
- **Includes:** `{% include "nav.html" %}` and Jekyll's `{% include nav.html section="home" %}` (read as `include.section`) see the page's variables. `{% render "footer", year: 2026 %}` sees only what it's given, and prints nothing for a variable it wasn't given (with `strict`, that is an error). Both read from `_includes`, adding `.liquid` when the name has none.
- **Mixing engines:** a Liquid page can use a Jinja layout and the other way around.
- **Errors** name the file and line, and an unknown filter gets the closest name (`did you mean`).

### Handlebars and Mustache

Add `"hbs"` (or `"handlebars"`) or `"mustache"` to `templateFormats`, and those files render with [handlebars.js](https://handlebarsjs.com) (4.7). Mustache templates render as Handlebars.

- **Data:** the same as the other engines, so a template reads the page's real data and collections, and a missing value prints nothing. A date passed to a helper itself (`{{year date}}`) arrives as ISO 8601 text, and one inside an object the helper is given (`{{byline post}}`) is a `Date`.
- **Escaping:** `{{ }}` escapes HTML and `{{{ }}}` doesn't, so a layout writes `{{{content}}}`.
- **Helpers:** Handlebars' built-ins (`if`, `unless`, `each`, `with`, `lookup`, `len`, `eq` and the other comparisons). Your config `filters` are helpers: `{{shout title}}`, `{{wrap title "[" "]"}}`, and hash arguments (`size=2`) arrive as a trailing object. An unknown helper gets the closest name (`did you mean`). Use `{{len list}}`, not `list.length`.
- **Partials:** every file in `_includes`, by its path with or without the extension: `{{> nav}}` or `{{> nav.hbs}}`. A name without an extension is the Handlebars file when there is one.
- **Mustache:** variables, `{{{ }}}`, partials, sections over lists and truthy values (`{{#items}}{{.}}{{/items}}`) and inverted sections (`{{^items}}none{{/items}}`), also in `.hbs` files. Inside a section, reach outer values with `../name`, as in Handlebars. Not supported: lambdas and changing delimiters.
- **Errors** name the file and line, and an error in a partial names the partial's file.

### EJS

[EJS](https://ejs.co/) templates (`.ejs`) are plain JavaScript between tags, rendered with ejs 3.1, which is bundled in ssqch (no npm install). Add `"ejs"` to `templateFormats`, and `markdownEngine: "ejs"` to run Markdown through it. The output matches EJS 3's, whitespace included.

```ejs
<ul>
  <%_ for (const post of collections.posts) { _%>
    <li><a href="<%= post.url %>"><%= post.data.title %></a></li>
  <%_ } _%>
</ul>
```

- **Tags:** `<% code %>`, `<%= escaped %>`, `<%- raw %>` (a layout writes `<%- content %>`), `<%# comment %>` and `<%%` for a literal `<%`. `-%>` drops the newline after a tag, and `<%_`/`_%>` the spaces and tabs around it too.
- **Data:** the page's data, as variables (`title`, `page`, `collections`, and `locals` for all of it). Your config `filters` and ssqch's functions (`markdown`, `highlight`, `navTree`, ...) are functions by the same names: `<%= shout(title) %>`. A config filter is called directly, without converting anything.
- **Async:** a function's promise that's printed (`<%= later(x) %>`) is awaited, and a template can `await`.
- **Dates** print at UTC (`Sun Apr 05 2026 06:07:08 GMT+0000`), in `<%= %>`, `<%- %>` and lists, whatever the machine's time zone. Format a date in the template to show it otherwise (`date.toLocaleString("en-US", { timeZone: "America/New_York" })`).
- **Includes:** `<%- include("partials/nav") %>` reads `_includes/partials/nav.ejs` (and the themes'), `include("./card")` reads from the template's own folder, and a second argument adds variables: `include("card", { post })`. One that isn't there says which file you probably meant.
- **Errors** name the template and line, and the lines under them are the file's own. A variable nothing defines is a `ReferenceError`, as in EJS (`typeof x` is still safe).
- **Starters:** `ssqch init --engine ejs` (and `--starter docs --engine ejs`) writes the starters' layouts, render hook and containers in EJS.

## Themes

A theme is a folder shaped like a site's input folder: `_includes/` (layouts, partials, render hooks, containers), `_data/`, pages, and files to copy, like stylesheets and fonts. Your site sits on top of it:

```js
export default defineConfig({
  theme: "themes/trail",
});
```

```text
themes/trail/                 src/                        what the build uses
  _includes/base.jinja                                    the theme's layout
  _includes/footer.jinja      _includes/footer.jinja      your footer
  _data/site.json             _data/site.json             both, merged; your values win
  404.md                                                  the theme's 404 page
  about.md                    about.md                    your about page
  assets/theme.css                                        copied to /assets/theme.css
```

- **File by file:** an include, layout, hook or container you have wins over the theme's at the same path, so changing a theme's footer means adding one file, not forking the theme. Data is merged, with your values winning. A page or file in the theme is built or copied unless your input folder has a file at that path.
- **Any engine:** the fallback works for Jinja, Nunjucks, Edge, Liquid and Handlebars includes alike, and a theme can mix them.
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

  --> src/posts/cedar.md:5
   3 | date: 2026-03-02
   4 | tags: posts
   5 | status: drfat
     | ^^^^^^
   6 | hero: { src: cedar.jpg, alt: A cedar }
```

(The other two get their lines pointed at too.)

- **Which pages:** a schema covers the pages tagged with its name (the pages in `collections.posts`; `all` is every page in collections), or the files matching `files`, globs relative to the input folder.
- **What's checked:** each page's data after the data cascade and `computed`, so a value from a directory data file counts. Every problem in every page is reported in one go, with the file and the field.
- **Types:** `string`, `number`, `integer`, `boolean`, `date` (a date, or a string that reads as one), `file` (a path to a file that exists: next to the page, or from the input folder with a leading `/`), `object`, `array` and `any`. A quoted value, number, `true`, `false` or `null` is that exact value, `|` is either-or, `[]` is a list, and a `?` at the end makes the field optional.
- **Nested data:** an object of fields, or a one-item array for a list of them: `links: [{ href: "string", text: "string" }]`. A key that ends in `?` is optional too.
- **Your own rules:** a function gets the value and the page's data, and returns `true`, `false`, or what's wrong (`` `slug` must be lowercase letters, digits and dashes ``).
- **`unknown`:** what to do about keys in a page's own front matter that aren't fields: `"allow"` (the default), `"warn"` or `"error"`. Keys ssqch reads itself (`layout`, `tags`, `permalink`, `date` and the like) are always fine, and so is data from the rest of the cascade.
- **Editor types:** `ssqch types` adds the schemas to `ssqch.d.ts`, so `pages.byTag("posts")` in a collection function knows each page's fields.

In `sitesquatch.toml`, a schema is a table: `[schemas.posts]` with `fields = { title = "string", date = "date" }`.

## Starting a new page

`ssqch new` creates a page from a blueprint: a page to start from, kept in `_blueprints/` in the input folder and named after the folder its pages go in. Here's `src/_blueprints/posts.md`:

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
Created src/posts/pine-cones-a-field-guide.md from src/_blueprints/posts.md. Field notes started.
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

- **Only front matter is filled in.** `title` is set, `date` is set to today when the blueprint has that key (or you pass `--date`), and `--set key=value` sets anything else (`--set draft=false`, `--set "tags=[news, trails]"`). Comments and the order of the keys stay. The body is copied as it is, so a blueprint isn't a template with a syntax of its own: `{{ title }}` in it is for the page.
- **Which blueprint:** the one named after the page's folder, the most specific first. `docs/guides/install.md` uses `_blueprints/docs/guides.md`, then `_blueprints/docs.md`, then `_blueprints/default.md`, and with none of them the page gets a `title` and a `date`. `--blueprint notes` picks one by name. A blueprint can be in any template language (`posts.jinja`), and a [theme](#themes) can bring its own in its `_blueprints/`.
- **A file, or a folder and a title:** `ssqch new posts/pine-cones.md` names the file itself (the title is then "Pine cones", unless you pass `--title`). Given a folder, the file is named after the title, the way the folder's other pages are: with the date in front (`2026-11-10-pine-cones.md`) when most of them have one, and as `pine-cones/index.md` when most are folders with an index file.
- **Nothing is overwritten,** and `--format json` prints the new file's `path`, its `blueprint`, `title` and `date`.

## Where a value comes from

A page's data is a cascade. From the lowest level to the highest:

1. **Global data:** files in a theme's `_data/`, then the site's `_data/` (`site.json` is `site`), then the config's `data`.
2. **Layouts:** the front matter of the page's layouts, the outermost layout first.
3. **Directory data:** `posts/posts.json` (or `.yaml`, `.toml`, `posts.data.js`) applies to everything in `posts/` and below it. The outermost folder goes first.
4. **The page's data file:** `pine.json` or `pine.data.js` next to `pine.md`.
5. **Front matter.**
6. **`computed`:** worked out last, from everything above.

A higher level replaces what a lower one set. Objects merge key by key and lists are joined (a post's `tags` add to its folder's), unless `deepMerge` is off. `page` and `ssqch` are built in.

When a value isn't what you expected, `ssqch inspect` follows its tracks back to the level that set it. Give it a page's URL or its template's path:

```sh
ssqch inspect /guides/pine/
```

```text
/guides/pine/
  From        src/guides/2024-03-02-pine.md (jinja, md)
  Writes      dist/guides/pine/index.html
  Layouts     _includes/guide.jinja > _includes/base.jinja
  Date        2024-03-02T00:00:00Z (from the file's name)
  Collections all, guides

  Data (name, value, and the level of the cascade that set it)
    site       {name, author}        src/_data/site.json
    section    "guides"              layout _includes/guide.jinja (over layout _includes/base.jinja)
    layout     "guide.jinja"         src/guides/guides.json
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
- **Pages made by pagination:** a template that makes many pages needs the URL of one of them. `ssqch inspect src/tags.jinja` lists them.
- **Scripts and agents:** `--format json` prints the report as JSON (`schemaVersion: 1`), with `value`, `from` and `setBy` for each field.
- **No page is built:** it reads the site as a build does, up to the point of rendering. `beforeBuild` hooks run, since data can depend on them (a command that writes a data file, a plugin that sets itself up there), but no page is rendered or written, and `afterBuild` doesn't run. Standard output is only the report; anything a hook or `console.log` prints goes to standard error.

## Reading the build summary

Every build ends with a ranger's report. Here's the ReverentGeek blog with its images cached:

```text
Built in 110 ms (production)
  Pages   168 written from 140 templates, 6.83 MB
  Copied  0 files, 12 unchanged, 3.88 MB
  Images  4,689 files from 737 sources, 271 MB: 0 encoded, 4,689 reused
  Output  dist: 4,872 files, 282 MB
  Time    setup 1.11 ms, data 1.31 ms, read 32.3 ms, paginate 2.81 ms, render 7.56 ms, write 55.9 ms, copy 193 µs, after 9.21 ms
```

- **The first line** is `First confirmed siting. Built in ...` for a site's first build (there's no `.cache/ssqch/output-files.json` yet), which is every build on a CI machine that doesn't keep `.cache`.
- **Pages** also says what's different from the last build to that folder: `(2 new, 1 gone)` when a page appeared or stopped being written (a post you added, a permalink you changed), and `(3 changed)` in `ssqch serve`, which leaves a page alone when it comes out the same.
- **Drafts** is in production builds that left `draft: true` pages out: `Drafts  3 unconfirmed (built in development only)`, or `3 left out` when the report's themed line is another one.
- **Removed** is the stale files `leaveNoTrace` deleted: `Removed  2 stale files, left no trace`, or just `2 stale files`.
- **One themed line at most:** a report says one thing in the ranger's voice, the one that matters most (in this order: nothing to build, a first build, files removed, drafts, unused templates), and says the rest plainly.
- **Images** counts the image files this build used, the source images they came from, and how many had to be encoded. With `prune` on, it also says how many stale files it deleted.
- **Output** is everything in the output folder, including files left from earlier builds.
- **Time** splits the build into phases. `write` includes layouts, transforms and image encoding, so a build that encodes images spends most of its time there. `after` is the `afterBuild` hooks.

With `--verbose`, a line under the summary names the templates in the includes folder that nothing used as a layout, an include or a component in this build: `Uninhabited: 1 template that nothing used in this build (src/_includes/cabin.jinja).` (`Unused:` when the report's themed line is another one.) It covers every template language: Jinja, Nunjucks, Edge, Liquid, Handlebars, Mustache and EJS.

`ssqch serve` prints the same summary after every rebuild.

## Comparing two builds

A build that succeeds isn't proof that an upgrade, a refactor or a migration left the site alone. `ssqch diff` compares two output folders and says what changed, which is better evidence than most sightings get:

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

Changes found: 3 pages and 1 other file (2 changed, 1 added, 1 removed); 148 pages and 4,730 other files are the same. The stump has moved.
```

- **What's ignored:** differences that don't change what a visitor gets. A fingerprinted file (`index.3f2a1b4c.css`: eight hex digits before the extension, unless they read as a date) is matched with its counterpart and compared by content, `integrity` hashes and the generator's version are left out, and HTML is compared as a list of tags and text, so whitespace between block tags doesn't count. A space next to an inline tag (`a <b>b</b>`) does, and so does whitespace inside `<pre>`, `<script>`, `<style>` and `<textarea>` (blank lines and indents included) and inside an attribute's value. `--exact` compares bytes instead.
- **What each page says:** whether its text, its markup or both changed, a changed `<title>`, any `id`s it no longer has (links to those anchors break), and `only dates changed (2025 -> 2026)` when every change on it is a date or a year.
- **Dates that changed:** when changed files differ only in dates or years, the summary says how many (`All 94 changed files differ only in dates or years`), and the JSON has `onlyDates: true` for each. The usual cause is a page with no `date` of its own (none in front matter or the file name): its date is the file's modification time, which a fresh checkout, a copy or another generator sets differently (Eleventy uses the file's creation time), so a footer with `{{ page.date.getFullYear() }}` changes on every page. Give pages that print it a `date`, use `{{ now() | dateformat("%Y") }}` for a copyright year, or `--ignore` the pattern while comparing.
- **Your own noise:** `--ignore <regex>` leaves matching text out of both sides, like a build date in the footer: `--ignore 'Built on [^<]+'`. Repeat it for more patterns. The pattern is a JavaScript regular expression, in its Unicode mode (the `u` flag): flags at the start (`(?i)`) and named groups written `(?P<name>...)` still work, but syntax only Rust had (`(?x)`, `\A`, `\z`, an escaped `-` outside `[...]`) is refused with JavaScript's words, and `\d` and `\w` are ASCII, so write `\p{Nd}` or `\p{L}` for other scripts' digits and letters.
- **Part of the site:** `--only '**/*.html'` compares only matching files (repeatable).
- **Longer diffs:** each file shows 10 changed lines; `--lines 0` shows them all.
- **Nothing to report:** `No differences: 148 pages and 4,730 other files are the same. The stump has not moved.`
- **Scripts and agents:** `--format json` prints the same report as JSON (`schemaVersion: 1`), and the exit code is 0 when the builds are the same, 1 when they differ and 2 on an error, like `diff`.

It works on any two folders of HTML, so it can also compare another generator's output with ssqch's while you move a site over.

## A build's footprint

`ssqch footprint` says how much the last build weighs, by kind of file, and which pages and files leave the largest footprints:

```text
$ ssqch footprint
Footprint of dist: 4,965 files, 302 MB
  Pages             163 files  6.91 MB  2%
  Images          4,782 files   291 MB  96%
  CSS                 1 file   58.2 KB  <1%
  JavaScript          2 files  7.61 KB  <1%
  Fonts               9 files   708 KB  <1%

Largest footprints: pages
   108 KB  /build-a-secure-node-js-application-with-javascript-async-await-using-hapi/
   104 KB  /avatars/

Largest footprints: other files
  3.15 MB  /static/job-hunt-ai-cheat-sheet.pdf
  2.10 MB  /img/ElD54Br0Nm-1200.png
```

It reads the site's output folder, or any build folder you name (`ssqch footprint dist-before`), so build first. `--top 20` lists more of the heaviest (0 for none), and `--format json` gives the same as data: `files`, `bytes`, `kinds` and `largest.pages` and `largest.files`, each with its `path` and `bytes`.

To keep a site light, give the config `budgets`. Every build then checks the output against them, after plugins like `assetsPlugin()` have run, and warns about whatever is over: `warn: 2 pages are over the pages budget of 100 KB: /build-a-secure-node-js-application-with-javascript-async-await-using-hapi/ (108 KB), /avatars/ (104 KB)`.

## Scripts and coding agents

The voice is for people. The same commands work for a script, a CI job or a coding agent, with JSON in place of the text a person reads, and no jokes in it. Every JSON document has a `schemaVersion`, which changes only when a field is removed or changes meaning.

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
- **The codes:** `config`, `data`, `front-matter`, `template`, `schema`, `conflict` (two pages write the same file), `links`, `images`, `assets`, `fetch`, `passthrough`, `last-modified`, `hook`, `console` (`console.warn` in a config), `template-formats` (files in a template language the site doesn't list), `other-generator`, `foreign-key` and `foreign-global` (another generator's config, front matter or template data), `over-budget` (a [footprint budget](#a-builds-footprint)), `missing-asset` (from `ssqch serve`), and `build` for anything else.
- **A build that works** also has `durationMs`, `pages` (`written`, `templates`, `bytes`, and `new` and `gone` since the last build to that folder, or `null` when there wasn't one), `copied`, `removed`, `drafts` (the `draft: true` pages a production build left out), `written` (each page's file, from the output folder), `summary` (the lines plugins add to the [build summary](#reading-the-build-summary)) and `timings`.
- **Standard output is only the report.** The lines a person would have read (`[ssqch] Writing ...`), `console.log` from your config and the output of `beforeBuild` commands go to standard error; `--quiet` leaves the progress lines out.

`ssqch capabilities --format json` says what the installed ssqch supports, so nothing has to be guessed from the documentation of another version: its `version`, `commands`, `features` (`avif`, `fetch`, `sass` and each template language, listed only when this build can do them), `templateLanguages` with their extensions, `configFiles`, `configOptions`, the built-in `modules` with what each exports, `nodeModules` (they're Node's own, so all 32 are `available` and `stubs` is an empty list), `globals` and `imageFormats`. Without `--format json` it prints the same as text, under "What's in the pack".

`ssqch docs` is this documentation, from the package, so it matches the version that's installed and works without the network. Alone, it lists every command, config option, template function and module export with one line each. `ssqch docs base` (or `imagePlugin`, `toc`, `serve`) prints what this README says about that name and which other sections mention it, `ssqch docs "content schemas"` prints a section, and other words search the text. Another generator's word gets ssqch's (`ssqch docs pathPrefix`), and `ssqch docs --from eleventy` lists that generator's words with ssqch's for each, then its trailhead. `--format json` has the same, with each answer's `names`, `section` and `also`.

`ssqch init` writes an `AGENTS.md` for coding agents, with a one-line `CLAUDE.md` that imports it: what each file is, and the commands above for looking a name up, checking a change and comparing builds. It's about 1 KB, since an agent carries it through a whole session, and `init` never replaces one a site already has. For a site that doesn't have one, `ssqch docs agents > AGENTS.md` writes it.

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

Encoding images is by far the slowest part of a build, so it's worth never doing it twice. Each image file is named by a hash of the source image's contents and the encoder settings, not its path or modification time, and it's encoded into `.cache/ssqch/img/`, outside the output. Each build links the files it uses into the output's `img/` folder (a hard link, so no extra space, or a copy where links don't work), so you can delete the output folder whenever you like and the next build encodes nothing. Restore `.cache/ssqch` from the last build in CI, and a build with no new images encodes nothing there either, even on a fresh clone. (An output folder from before the cache, or one a deploy cache restored, is taken in as it is: its files move into the cache instead of being encoded again.) `cacheDir` on `imagePlugin()` puts the cache somewhere else, and `cacheDir: false` encodes straight into the output, which then has to be kept to keep the images.

ssqch also remembers each source image's hash, size and modification time in `.cache/ssqch/image-hashes.json`, so unchanged images aren't read again. (A fresh clone gives every file a new modification time, so its first build re-hashes everything, which takes about 20 ms on the blog's 420 MB of images.) Add `.cache/` to your `.gitignore`, or turn the hash cache off with `hashCache: false`. It's kept outside the output folder because it names your source paths, and the output gets published.

Set `prune: true` on `imagePlugin()` to delete image files the build didn't use, in the output and in the cache, so the cache doesn't keep growing as images change. Only turn it on for full builds, where every image goes through the image plugin.

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

ssqch doesn't build a search index itself; [Pagefind](https://pagefind.app) does it well and runs after the build. Add it as a command (`npx` comes with Node, or install Pagefind's own binary):

```js
export default defineConfig(({ env }) => ({
  afterBuild: env === "production" ? [{ run: "npx -y pagefind --site dist" }] : [],
}));
```

Then load `/pagefind/pagefind-ui.js` and `pagefind-ui.css` in your layout and add a `<div id="search">` for its search box. The `docs-sidebar` example does this.

### Netlify

Netlify can build the site itself, with no deploy token to manage. With `ssqch` in the site's `devDependencies` (see [Install](#install)), Netlify installs it with the site's other packages, at the version in the lockfile, and runs it on the Node it has: set `NODE_VERSION` to 22.18 or newer, as below. This is the ReverentGeek blog's `netlify.toml` (it builds its CSS and JavaScript with npm scripts first, so it runs `pnpm run build`; a site without that step can run `npx ssqch build` instead):

```toml
[build]
  command = "pnpm run build && node --test test/smoke.test.js"
  publish = "dist/"

[build.environment]
  NODE_VERSION = "24"

[[plugins]]
  package = "netlify-plugin-cache"
  [plugins.inputs]
    paths = [".cache/ssqch"]
```

- **The `ssqch` dev dependency** pins the version, so a new SiteSquatch release can't surprise a deploy. Pin it exactly (`pnpm add -D ssqch@0.7.0`) and bump it when you're ready. On the day of a release, pnpm's release age holds a new version back: list `ssqch` (the only package of ssqch's own) under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, as [Install](#install) shows.
- **`NODE_VERSION`** is the Node that runs the build: anything from 22.18 on. ssqch builds to the same bytes on 22.18, 24 and 26, so pick the one your other build tools like.
- **[`netlify-plugin-cache`](https://github.com/jakejarvis/netlify-plugin-cache)** carries `.cache/ssqch` (the encoded images and their hashes, and any `fetch` copies) over to the next build. Add it to your `devDependencies`.

A site without a `package.json` can run a pinned release straight from npm in the build command, with `SSQCH_VERSION = "0.7.0"` under `[build.environment]` to pin it (and `NODE_VERSION` there as well):

```toml
[build]
  command = "npx --yes ssqch@$SSQCH_VERSION build"
```

Or install the standalone executable instead, which needs no Node setting: `SSQCH_UNMANAGED_INSTALL=.cache/bin` installs it into that folder and leaves shell profiles alone.

```toml
[build]
  command = "curl --proto '=https' --tlsv1.2 -fsSL https://github.com/reverentgeek/sitesquatch/releases/download/v$SSQCH_VERSION/ssqch-installer.sh | SSQCH_UNMANAGED_INSTALL=.cache/bin sh && .cache/bin/ssqch build"
```

On the blog, the first Netlify build (which encoded every image) took about 4 minutes with 0.7, and the next one took 18 seconds, including Netlify's own setup. 0.8 encodes the blog's images in less than half 0.7's time on the same machine (see [Benchmarks](#benchmarks)).

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
- **Pin the version** as in [Install](#install) (`with: version:`), so a new release can't surprise a deploy. A site with a `package.json` can install ssqch from npm instead: replace the `setup-ssqch` step with `actions/setup-node@v4` (`node-version: 24`, or any 22.18 or newer) and `npm ci`, then run `npx ssqch build --output dist --base ...`; the lockfile pins the version.
- **A 404 page:** GitHub Pages serves `404.html` from the site's root, so give your 404 page `permalink: /404.html`.
- **Images:** to keep encoded images between builds, cache `.cache/ssqch` with `actions/cache` (see [Keep the image cache between builds](#keep-the-image-cache-between-builds)).

## Benchmarks

No blurry footage here: these numbers come from building the ReverentGeek blog (161 HTML pages plus a feed, a sitemap and Netlify files) on an Apple M5 Pro (15 cores), in production mode with HTML minification on, with ssqch 0.8 on Node 26. Each build wrote to its own output folder, so no image cache was shared.

| Build | `ssqch` 0.8 (Node) | `ssqch` 0.7 (Rust) |
| --- | --- | --- |
| **Cold** (no images cached) | **25.6 s** | 60.2 s |
| CPU time, cold (user + sys) | 341 s | 737 s |
| Peak memory, cold | 2.6 GB | 1.8 GB |
| **Warm** (images cached, median of 3) | **0.92 s** | 0.38 s |
| Peak memory, warm | 328 MB | 239 MB |
| Image files written | 4,985 (266 MB) | 4,985 (298 MB) |

- **Warm builds** are what the dev server and cached CI builds do. Wall times include starting the process: Node starts, and ssqch loads from its compile cache, in a few dozen milliseconds. The standalone executable starts the same way, and unpacks itself once on its first run (see [Install](#install)).
- **The JavaScript config** runs on Node's V8, with a JIT, so the blog's collections, filters and data files cost what they would in any Node script. (0.7 ran them in QuickJS, an interpreter.)
- **Cold builds** are mostly image encoding, and AVIF is the most expensive format. sharp encodes with libaom, at the blog's `avifEffort: 3` (0.7's speed 4): the files are smaller and quicker to make than 0.7's, which used rav1e. They're single runs and vary.
- **One thread renders, the thread pool encodes:** pages render one at a time on one thread (there are no worker threads), written as they render, and image encoding runs on libuv's thread pool, which uses every core. A site with heavy per-page JavaScript uses one core for it.
- Only site generation is measured, not building the CSS and JavaScript.

The speed check ssqch runs on itself is a synthetic site of 10,000 pages, built on one thread (`node packages/ssqch/bench/bench.ts` in the repository), plus v8.dev's exact port from Eleventy: on the same machine, the 10,000 pages build in 1.12 s and 370 MB (0.7 took 2.70 s on one thread), and v8.dev in 0.58 s. CI compares each commit with its parent on the same runner and fails a change that makes the 10,000-page build more than 15% slower.

For a bigger site, `scripts/synthetic-site.py <folder> [pages] [engine]` writes a synthetic documentation site: 9,001 Markdown pages by default (about the size of kubernetes.io's English docs) in 60 sections, each page with a 9,000-entry sidebar from a data file, a table of contents, a highlighted code fence, a schema check and the link checker. On the same machine, production builds of it take:

| Layout in | Build | CPU time | Peak memory |
| --- | --- | --- | --- |
| Edge | 2.85 s | 7.4 s | 465 MB |
| Nunjucks | 2.74 s | 7.0 s | 454 MB |
| Liquid | 9.23 s | 14.3 s | 610 MB |

Each build writes 156 MB of HTML and checks 1.4 million links. 0.7 built it in 1.68, 1.75 and 12.6 s on all 15 cores, with 12, 12 and 159 s of CPU time: 0.8 does less work, on one thread for the pages. Templates get your real objects, not copies, so handing the whole sidebar to a filter on every page copies nothing in any language.

`scripts/bench.sh [path/to/blog] [warm-runs]` runs the blog's table on macOS (the blog defaults to `../blog`) on a copy-on-write clone in a temporary folder, so your copy is never touched, and writes `results.csv`, `bench.log` and `summary.txt` to `bench-results/<timestamp>/`. It times the npm package as it's published, with ssqch 0.7's binary beside it when `target/release/ssqch` is there, and needs pnpm for the blog's CSS and JavaScript.

## Plugins in Rust

Most plugins should be JavaScript: a piece of config, in the config or an npm package (see [Configuring a site](#configuring-a-site)). When a plugin does heavy work, it can be written in Rust instead, with the [`ssqch-plugin`](https://crates.io/crates/ssqch-plugin) crate, the plugin SDK. It builds one `.wasm` file (for `wasm32-wasip1`) that ssqch runs in Node's own WebAssembly: the same file on macOS, Linux and Windows, with nothing to compile when a site installs it, no native code, and no files, network or environment for the plugin to reach. ssqch's own minifier (`ssqch/minify`) is built this way, and its Markdown and Sass are Rust compiled to WebAssembly too. (0.7's Rust API, a site as its own Rust program, ended with 0.7.)

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

**The plugin SDK:** a plugin is a Rust crate with `crate-type = ["cdylib", "rlib"]`, a type that implements `ssqch_plugin::Plugin` (its `Options`, its `NAME` and `HOOKS`, `new`, and the hooks it has) and the line `export!(MyPlugin);`. `cargo build --release --target wasm32-wasip1` builds the file (`rustup target add wasm32-wasip1` first), and `cargo test` tests the plugin as plain Rust. [`examples/rust-plugin`](examples/rust-plugin/) is a whole plugin with all three hooks and its npm package, and [the crate's README](crates/ssqch-plugin/README.md) has the rules and a complete example: the manifest, the options, what each hook sees, how errors and panics are reported, and the ABI.

### When a Rust plugin pays

Each call copies its text into the plugin's memory and the answer back out, and WebAssembly runs at most at native speed, so Rust pays for work that's heavy for each byte, not for a few edits.

- **Heavy work pays:** minifying, parsing a real grammar (a template language, a highlighter), work on images or fonts, hashing, compression, a search index. In the study behind ssqch 0.8, minify-html as a plugin minified 10,000 pages in 0.28 of html-minifier-terser's time (0.82 s against 2.97 s), and ssqch's own minifier minifies the ReverentGeek blog's 169 pages (7.9 MB) in about 0.1 s.
- **A regex doesn't.** Adding `loading="lazy"` to images, swapping a word, counting words: JavaScript's regular expressions compile to machine code. Adding attributes to 200,000 images on 10,000 pages took a JavaScript regex 53 ms, the same scan in Rust 81 ms as a plugin, and a real HTML tokenizer (lol_html) 311 ms. Write those as a transform in the config.
- **Many small calls cost.** A filter call costs about 0.25 µs besides its work (its arguments and answer cross as JSON): fifty a page on 10,000 pages is a tenth of a second. A filter that's called for every item of every list is better in JavaScript.
## Working on SiteSquatch

```text
packages/ssqch          ssqch itself: TypeScript on Node (src/, bin/, scripts/, bundled/ and wasm/)
packages/ssqch/vendor   The Nunjucks fork that renders Jinja and Nunjucks
crates/ssqch-markdown   Markdown and the syntax highlighter, built to packages/ssqch/wasm/markdown.wasm
crates/ssqch-minify     The HTML minifier (ssqch/minify), built to wasm/minify.wasm
crates/ssqch-sass       Sass, compiled with grass (ssqch/sass), built to wasm/sass.wasm
crates/ssqch-plugin     The SDK for writing plugins in Rust, published to crates.io
examples/sites          Example sites, built by the tests
examples/rust-plugin    A plugin written in Rust with all three hooks, and its npm package
tests/oracle            Black-box tests that run any ssqch (SSQCH_BIN) against frozen output
```

The Rust crates exist to build the `.wasm` files, which are committed (so a clone needs `npm ci` and nothing else, and CI's Node jobs have no Rust); `node packages/ssqch/scripts/build-wasm.ts` builds them again after the Rust changes (`rustup target add wasm32-wasip1` first), and a test fails until you do.

From `packages/ssqch/`, after `npm ci`:

```sh
node bin/ssqch.ts build --root ../../examples/sites/blog-tags   # runs from source: Node strips the types
node --test                                                     # the package's own unit tests
npx tsc --noEmit                                                # type-checks; keep it clean
```

The oracle is the definition of done for the commands and the output. From `tests/oracle/`, `SSQCH_BIN=packages/ssqch/bin/ssqch.ts node --test` (the path is from the repository root; add a test file's path to run only that one). [CI](.github/workflows/ci.yml) runs it, the unit tests and the type check on Linux, macOS and Windows, on Node 22.18, 24 and 26.

The ReverentGeek blog is the real-world test site. To build it with your changes, clone it next to this repository and point its build script at your checkout's `ssqch` (the script runs `$SSQCH_BIN` when it is set), which also builds the CSS and JavaScript:

```sh
git clone https://github.com/reverentgeek/blog.git ../blog
(cd ../blog && pnpm install && SSQCH_BIN=../ssqch/packages/ssqch/bin/ssqch.ts pnpm test)
```

`pnpm test` builds the site and runs the blog's smoke tests. The first build encodes every image, so give it a few minutes; later builds reuse them. To see an example site, build it with `node packages/ssqch/bin/ssqch.ts build --root examples/sites/<name>`, or serve it with `serve` in place of `build`.

Messages follow the rules in [`AGENTS.md`](AGENTS.md#the-sasquatch-voice): the facts first, plain output for machines, nothing random, and nothing added to a site's pages. The lines more than one place uses are in `packages/ssqch/src/voice.ts`.

Releases are built by a hand-written workflow (`.github/workflows/release.yml`) from a version tag: the npm package, with provenance, and the standalone executables, which are signed and notarized on macOS. The steps are in [`AGENTS.md`](AGENTS.md#releasing).

## Known gaps

The uncharted parts of the map, as of this release:

- **JavaScript:** a site's code runs on Node, so it has Node's limits and none of 0.7's. There are no worker threads: pages render one at a time on one thread (image encoding uses every core), so a site with heavy per-page JavaScript doesn't spread it across cores, and module-level state in your config (a counter in a filter) is one counter. `Intl`, `toLocaleDateString()` and `localeCompare` are Node's, and their results can differ between Node releases (Node 22.18 ships an older ICU than 24 and 26: one of 91 formats the study compared, compact numbers in en-GB, came out differently). ssqch's own date filters and sorting never use `Intl`, so only a site's own `Intl` calls can make a build's output depend on the Node version; pin `NODE_VERSION` where that matters.
- **Async functions and Markdown:** a page's own Markdown waits for an async `headingIds` function or highlighter, but Markdown made while a template renders can't: `markdown()` and `highlight()` in a template, `markdown()` from `"ssqch"`, a render hook or a container whose template calls an async function are errors that name the function when it answers with a promise. Make those functions synchronous. A page whose own templates are async can't be rendered on demand either: reading its `templateContent` before it has rendered is an error that names it.
- **Edge:** the async functions inside a callback of `filter`, `find` and the other array methods aren't awaited (an error says to call them first with `@let`).
- **Markdown:** containers have to close inside the block they opened in (the same list item, say). Highlighting parses more slowly than tree-sitter would: the blog's 350 fences add about 60 ms to a build, and a process's first highlight compiles each grammar it uses (about 0.3 s for the blog's first build, and not again for the rebuilds of `ssqch serve`).
- **Images:** no SVG rasterizing, and HDR photos (the PQ, gain-map profiles of newer iPhones) can't be converted to sRGB, so they look washed out; the build warns about them, and converting the source to sRGB once fixes it. SVGs are served as they are, and GIFs are copied for `auto` output, so animations keep working. The files' bytes are sharp's, not 0.7's, so a site that compared image bytes with `ssqch diff --exact` sees them change once.
- **The dev server:** it listens on `127.0.0.1` only (no `--host`), doesn't watch `node_modules`, and rebuilds the whole site on a change, on one thread: after one edit, a 10,000-page site takes about 0.9 s.
- **Collections:** custom collections don't see pages that are paginated over collections. Those pages are added to `all` and their tags afterwards.
- **Platforms:** the standalone executable covers Linux x86_64 (glibc 2.28 or newer), macOS and Windows x86_64; Linux on ARM and Alpine run the npm package on their own Node. See [TODO.md](TODO.md) for what's next.

Found a bug, or have an idea? [Open an issue](https://github.com/reverentgeek/sitesquatch/issues). Happy building, and may your pages load faster than a Squatch sighting disappears.
