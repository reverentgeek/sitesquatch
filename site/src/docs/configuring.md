---
title: "Configuring a site"
description: "Here's a fuller config, with data, a custom collection and the built-in plugins."
---
> **Pro tip:** with ssqch as a dev dependency, your editor finds its types in the package: it autocompletes config keys and plugin options, and underlines mistakes like `ouput` or `linksPlugin({ fail: "yes" })`. With ssqch installed globally, `ssqch types` writes the same types to `ssqch.d.ts` for `jsconfig.json`'s `"include"` (`ssqch init` does both), with your [content schemas](content-schemas.md) in them too.

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
| `markdown` | Heading IDs, footnotes and the other Markdown extensions; see [Markdown](markdown.md). |
| `deepMerge` | Merge objects and concatenate arrays through the data cascade (default `true`). |
| `leaveNoTrace` | Delete stale files from the output: pages and passthrough files an earlier build wrote that this one didn't, like a deleted post (default `false`). ssqch keeps a list of what it writes in `.cache/ssqch/output-files.json`, so files other tools write into the output (your CSS build, say) are never touched: it packs out only what it packed in. `clean` is another name for the same option (set one of them). |
| `filters` | `{ name: function }`, callable from templates: `{{ title | slug }}` or `{{ slug(title) }}`. Async functions are awaited. A function gets text where a template holds HTML marked safe (a layout's `content`), and a value it gives back unchanged stays safe, so `{{ content | myFilter }}` prints HTML; one that returns new text prints it escaped in Nunjucks and Jinja, unless `| safe` or the function returns `safe(html)`. A filter written as a `function` sees the page being rendered as `this.page` (see [What a filter sees](#what-a-filter-sees)). |
| `data` | `{ name: value }` for every template. A value that's a function (sync or async) is called on each build, and what it answers is that name's value: `data: { snacks: async () => fetchSnacks() }`. |
| `collections` | `{ name: (pages) => ... }`. `pages` has `all()`, `byTag(tag)`, `byTags(...tags)` and `byGlob(glob or globs)`, oldest first. |
| `transforms` | `{ name: (content, page) => content }`, run on every output file. `page` has `url`, `inputPath` and `outputPath`. Return the content, changed or not. Async works. |
| `engines` | Template engines of your own: `{ extension: (source, data, context) => html }`, or an object with a `render(source, data, context)` method (async is fine). `context` says what's being rendered: `{ kind, path }`, where `kind` is `"body"` (a page), `"layout"`, `"hook"` (a Markdown render hook), `"permalink"` or `"computed"`, and `path` is the file as `page.inputPath` names it (`./src/posts/pine.md`). Add the extension to `templateFormats` to render those files; layouts in that extension work too, and `markdownEngine` can name one. A page's `permalink` and `computed` strings never go through an engine of your own (it's usually a Markdown renderer): they render with the first of ssqch's template languages in the page's chain, then the `markdownEngine`, then Edge. `md` replaces ssqch's Markdown with your own library (a markdown-it instance works as it is), and `cache: true` keeps the pages an engine renders by their source ([Your own Markdown library](markdown.md#your-own-markdown-library)). `edge`, `html` and `txt` can't be replaced. |
| `ignore` | Globs, relative to the input folder, of files that aren't pages: `["drafts/**", "**/README.md"]`. Folders starting with `.`, `node_modules` a folder Bundler installed gems into (`vendor/bundle`, with `ruby/<version>/gems/` inside), and `_site` at the top of the input folder (where Jekyll and Eleventy write their builds, so the old generator's output isn't read as pages while ssqch writes elsewhere) are skipped without it. It keeps data files out too: a file beside the templates is data by its name (`api/api.data.ts` is the data for `api/`, `intro.json` for `intro.md`), so another generator's file named that way (VitePress's data loaders) is read as data until it's listed: `ignore: ["**/*.data.ts"]`. A data file that fails to load says it was read by its name. |
| `bundles` | Page bundles: a folder whose page is `index.md` (or any `index.*` template) gets its other files, like photos and downloads, copied next to the page, so `![](photo.jpg)` just works. Subfolders with templates of their own, and data files, are left out (default `false`). |
| `strict` | Printing an undefined value (`{{ titel }}`) is an error that names the template and line, in every template language. Conditionals and defaults (`@if(subtitle)`, `{% if subtitle %}`, `x ?? "none"`) still work (default `false`). |
| `passthrough` | Files or folders to copy: a path, or `{ from: to }`, or an array of them. A path can be a glob: `"src/**/*.pdf"` keeps each file's own path, and `{ "assets/**/*.png": "images" }` puts them under `images/` by their path below `assets/`. A file's `to` is the file it's copied to (`{ "docs/CNAME": "CNAME" }`), or a folder it goes into by its own name: `"."` (the output's root), a path that ends with `/` (`"well-known/"`), or a folder that's there. So `{ "src/public": "." }` copies the folder to `/public/`; for its contents at the root (VitePress's and Vite's `public/`), give the files: `{ "src/public/**": "." }`. Linked files and folders (symlinks) are followed and copied as files, and a link to nothing is an error that names it. When two sources copy to the same file, the one listed later is written, with a warning if the two differ. |
| `watch` | More paths for `ssqch serve` to watch. |
| `budgets` | Size budgets by kind of file, checked after each build: `budgets: { pages: "150 KB", images: "500 KB", total: "300 MB" }`. A file over its kind's budget is a warning (`bigfootprint`). The kinds are `ssqch footprint`'s: `pages`, `images`, `css`, `javascript`, `fonts`, `media`, `documents`, `data` and `other`, plus `total`. See [A build's footprint](footprint.md). |
| `serve` | `serve: { run: ["npx postcss src/app.css -o dist/app.css --watch"] }`: programs `ssqch serve` starts with the server and stops with it, such as the watchers of your CSS and JavaScript tools. Their output is shown with the tool's name in front (`[postcss] ...`). The first build waits for their first compile, and each update waits until they have stopped writing. Builds don't run them. See [CSS and JavaScript](css-and-javascript.md). In `sitesquatch.toml`, `[serve]` with `run = [...]`. |
| `beforeBuild`, `afterBuild` | Build hooks (a function or an array). They get `{ env, serving, quiet, verbose, dirs }`, plus `written` (the files written) after the build, and while serving, `changed`: the files whose change started the build (`["./src/guide/intro.md"]`, not there on the first build), so a hook can skip what an edit doesn't touch (`if (changed?.every((f) => f.endsWith(".md"))) return;`); `quiet` and `verbose` say whether the build was run with `--quiet` or `--verbose`, so a hook's own messages can follow them. Async works. A hook can also run a program: `afterBuild: { run: "npx -y pagefind --site dist" }` runs it in the project root (through `sh -c`, or `cmd /C` on Windows) with its output shown, and a failure fails the build. It gets `SSQCH_ENV`, `SSQCH_SERVING`, `SSQCH_QUIET` (`true` with `--quiet`), `SSQCH_INPUT` and `SSQCH_OUTPUT`, and each `node_modules/.bin` from the project's folder up goes in front of its `PATH`, as in an npm script, so a tool the site installed runs by name (`{ run: "postcss src/app.css -o $SSQCH_OUTPUT/app.css" }`) whether the build started from `npm run build` or a global `ssqch`. `serve.run` commands get the same (`SSQCH_QUIET` from `ssqch serve --quiet`). In `sitesquatch.toml`, `before_build` and `after_build` take lists of commands. |
| `theme` | A theme under the site: a folder (`"themes/docs"`), or a git repository pinned to a commit or tag (`"https://github.com/you/theme#v1.2.0"`). The site's own files win over the theme's, one by one. See [Themes](themes.md). |
| `schemas` | What each kind of page's data has to look like, checked on every build: `{ posts: { fields: { title: "string", date: "date" } } }`. See [Content schemas](content-schemas.md). |
| `base` | The path the site is served under, when that isn't the root of its domain: `base: "/repo/"` for a GitHub Pages project site at `https://you.github.io/repo/`. Templates, Markdown links and `page.url` stay as they are (`/about/`); ssqch adds the base to every URL from the site's root in the HTML it writes. See [Serving a site under a path](deploying.md#serving-a-site-under-a-path). |
| `trimAfterFrontMatter` | `true` starts each template's body (pages, layouts and includes with front matter) at its first line with text, dropping the blank lines after the closing `---`, as Jekyll does, so a layout prints no blank line where Jekyll's printed none. Off (the default), the body starts on the line after `---`, as in Eleventy. Error lines still count from the top of the file. |
| `jekyllTemplates` | `true` gives templates Jekyll's `page` and `site`, so a Jekyll site's layouts and includes run as they're written. `page` has the page's front matter too (`page.title`, `page.lang`; ssqch's own keys, like `url`, `date` and `headings`, win), and `page.path` and `page.categories` (the folders above `_posts`, then its own). `site` keeps the site's own keys and gets `posts` (newest first), each collection by its tag (`site.articles`), `pages`, `html_pages`, `categories`, `tags`, `data` (the global data, so `site.data.locales` works) and `time`. Their items read in Jekyll's shape: `post.title`, `post.content` (the rendered page), `post.excerpt` and `post.path`, and `where: "lang"` and `sort: "title"` read front matter. It applies to every template language. Off (the default), front matter is at the top level (`{{ title }}`) and items keep it under `data` (`post.data.title`). `ssqch scout`'s draft for a Jekyll site turns it on. |
| `mkdocsTemplates` | `true` gives templates what MkDocs gives a theme's, so an MkDocs theme's Jinja templates (Material for MkDocs') run as written: `config` (`mkdocs.yml`, with the theme's `mkdocs_theme.yml` under its `theme`), `nav` (Sections, Pages and Links, with `active` on the page being rendered and its sections), `page` in a layout (MkDocs' page: `title`, `url` without its first `/`, `abs_url`, `canonical_url`, `edit_url`, `content`, `toc`, `meta`, `previous_page`, `next_page`, `ancestors`, `is_homepage`), `base_url`, `mkdocs_version` and `build_date_utc`, and the `url` and `script_tag` filters, which write URLs relative to the page. A Markdown page's layout is the theme's `main.html` (or the one its front matter's `template` names), the theme's `404.html` makes `/404.html` with no page, and Jinja doesn't escape, as MkDocs' doesn't (`jinja: { autoescape: true }` turns it back on). A string names another file: `mkdocsTemplates: "docs/mkdocs.yml"`. The search index and `sitemap.xml.gz` aren't written. See [moving from MkDocs](trailheads/from-mkdocs.md). |
| `jinja` | Jinja's settings, for `.jinja` and `.j2` templates (and `.html` read as Jinja): `{ autoescape: false }` prints values as they are, as MkDocs' Jinja does, where they're HTML-escaped by default (`| e` still escapes; `.njk` always does). `mkdocsTemplates` turns it off. |
| `dateFallback` | The date of a page with no date of its own (in its data or its file name): `"git"` for the last commit that changed its file, or `"file"` (the default) for the file's modification time. A checkout writes every file at once, so with `"file"`, `page.date` and a sitemap's `<lastmod>` change from one clone to the next; `"git"` is the same in every checkout (a file with uncommitted changes uses its time). Either way the page sorts after the dated pages, by path. `SOURCE_DATE_EPOCH` pins the build's time instead, for every undated page at once. In CI, check out the full history (`fetch-depth: 0`). |
| `lastModified` | `page.lastModified`: `"git"` for when the page's file last changed in a commit (its modification time if it has uncommitted changes), or `"file"` for the modification time. Off by default. In CI, check out the full history (`fetch-depth: 0` in GitHub Actions), or every page gets the date of the last commit; the build warns about a shallow clone. |
| `timeZone` | The time zone the site's own JavaScript runs in, as an IANA name: `timeZone: "UTC"`. `Date`'s local methods (`getHours()`, `toLocaleDateString()`) and libraries that use the local zone (luxon, date-fns), in data files, filters and hooks, follow it, so a laptop in New York and CI in UTC build the same pages. ssqch's own date filters are UTC whatever it says. Default: the machine's zone. An unknown name is an error. The config file's own top-level code runs before it applies, so work dates out in a function or a data file. |
| `urls` | A page's URL when it has no `permalink`: `"folders"` (the default) builds `guide/intro.md` as `/guide/intro/` (`guide/intro/index.html`), and `"html"` as `/guide/intro.html`, as VitePress does without `cleanUrls`, Hugo with `uglyURLs` and Docusaurus with `trailingSlash: false`. An index page is its folder either way (`guide/index.md` is `/guide/`), and page 2 of a list is `/blog/1.html`. A `permalink` wins, and so does one set in data for a folder or the whole site. |
| `layoutAliases` | Other names for layouts, as Eleventy's `addLayoutAlias` gave them: `layoutAliases: { post: "layouts/post.njk" }` makes `layout: post` that file, where it would otherwise be `_includes/post.*` (a partial, on a site moving from Eleventy). A page's `layout` is still the name it gave, so a template that tests `layout == "post"` keeps working. An alias can name another alias; a loop of them is an error, and so is a value that isn't a layout's name. `ssqch scout`'s draft for an Eleventy site writes it from `addLayoutAlias`. |
| `plugins` | More config: objects with any of the keys above except the settings (`dirs`, `templateFormats`, `markdownEngine`, `htmlEngine`, `markdown`, `deepMerge`, `leaveNoTrace`, `ignore`, `bundles`, `strict`, `lastModified`, `dateFallback`, `base`, `schemas`, `theme`), or functions that return one, or a plugin written in Rust (`{ name, rust: { wasm, options } }`, what its npm package's function returns: see [Plugins in Rust](rust-plugins.md)). `false`, `null` and `undefined` are skipped, so `env === "production" && minifyPlugin()` works. Give a plugin a `name` and errors will mention it. |

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: `urls`, `beforeBuild`'s `changed`, and `ignore` for data files.

Mistakes get caught at the trailhead. A misspelled key or option is an error that says what you probably meant (`"templateFormat" isn't a config option (did you mean "templateFormats"?)`, or `unknown option "widhts" (did you mean "widths"?)` for a plugin), and so are two plugins that define the same filter, data or collection name (the message names both). When something in your code throws, you get `ssqch.config.js: too many pine cones` and a stack trace that points at your file, like `at bad (lib/filters.js:3:9)`.


## What a filter sees

A filter's arguments are what the template passes it. Two more things make the filters a theme from another generator calls (MkDocs' page-relative `url`, Hugo's `relURL`, a `toc` that writes HTML) work as they're written:

- `this.page` and `this.data`: in a filter written as a `function` (not an arrow function, which has no `this`), `this.page` is the page being rendered, as its templates see `page` (`url`, `inputPath`, `outputPath`, `date`, and in a layout `headings` and `excerpt`), and `this.data` everything the template sees (front matter, the cascade, `collections`, and in a layout `content`). In a layout it's the page the layout is rendering. It works in every template language, in an async filter too, and in a filter called from an include. Outside a render (a collection, a data file, a hook calling the function) `this` is `undefined`.
- `safe(html)`, from `ssqch`: marks a function's answer as HTML, so every template language prints it as it is (Jinja and Nunjucks without `| safe`, Edge in `{{ }}`, Handlebars in `{{ }}`, EJS in `<%= %>`). It's still a string to JavaScript (`String(x)`, `x.length`, `"<h1" in x` in Jinja). Escape what you put in it that isn't yours.

```js
import { defineConfig, safe } from "ssqch";
import path from "node:path/posix";

export default defineConfig({
  filters: {
    // `{{ "assets/app.css" | url }}`: a URL relative to the page, as MkDocs writes them.
    url: function (to) { return path.relative(this.page.url, `/${to}`) || "."; },
    badge: (text) => safe(`<span class="badge">${text}</span>`),
  },
});
```

## What you can import

Config and data files are loaded by Node, by its rules for ES modules and CommonJS, so they can import what Node can: relative files (`./lib/filters.js`, with or without the extension), your own files through the path aliases in `tsconfig.json` or `jsconfig.json` (`compilerOptions.paths`, as Astro, Vite and Next.js sites have them: `import { menu } from "@/config/menu"`), JSON (`import site from "./site.json"`; ssqch adds the `with { type: "json" }` that Node wants if you leave it off), npm packages from `node_modules`, every Node built-in (`node:fs`, `node:path`, `node:child_process`, `node:http` and the rest, with or without the `node:` prefix), and the modules built into ssqch: `ssqch` (which has `defineConfig`, `markdown(text, { inline })`, `readData(path)` for JSON, YAML and TOML files, `files(pattern)` for the files a glob matches, and `safe(html)`), `ssqch/image`, `ssqch/rss`, `ssqch/minify`, `ssqch/assets`, `ssqch/links`, `ssqch/sitemap`, `ssqch/redirects`, `ssqch/sass` and `ssqch/elements`. The config itself can be `ssqch.config.js` or `.mjs`, `.cjs`, or `.ts` or `.mts` (Node strips the types, so only syntax that erases to JavaScript works: no `enum` or `namespace`). The modules load in plain Node too, so a test or a script can `import { markdown, slugify } from "ssqch"`. ESLint's `n/no-unpublished-import` flags imports of a dev dependency, so turn it off for build-time files like `ssqch.config.js` and data files, which a site never ships.

A site's code runs in its project root (ssqch changes into it before loading anything), so `process.cwd()` and `readFileSync("data/snacks.json")` are from there. Relative paths in `fs` calls are Node's own, and so are its errors (`err.code === "ENOENT"`). On Windows, `node:path` joins with `\`, as Node does there; what ssqch hands your code (`page.inputPath`, `page.url`, a hook's `dirs`) has `/` everywhere.

Dates and numbers format as Node does, so `toLocaleDateString()`, `Intl.DateTimeFormat` and `localeCompare` use Node's own ICU, and their results can differ between Node releases (22.18 ships an older ICU than 24 and 26). ssqch's own date filters and sorting don't use `Intl`, so a build's output doesn't change with the Node version, the time zone or the locale unless your code asks it to ([Known gaps](known-gaps.md)).

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

- **A duration** (`"90s"`, `"30m"`, `"1h"`, `"7d"`, `"2w"`, or seconds as a number): a successful response is saved in `.cache/ssqch/fetch/`, and requests reuse it until it's that old. The key is the method, URL, request headers and body, so another query or token is another entry. The URL, request headers and cookies aren't written to disk (an API key is usually in one of them), only the response.
- **When a refresh fails** (the network is down, or the server answers 5xx or 429) and there's an older copy, the build uses it and warns: `warn: fetch: https://api.example.com/snacks answered 503; using the copy saved 3 hours ago`. Without a copy, the failure is the response, as usual. `cache: "0s"` asks every time and keeps the copy only for that.
- **The standard modes** work too: `"force-cache"` (a copy of any age, else ask), `"reload"` (ask, and save), `"only-if-cached"` (a copy, or fail) and `"no-store"` (the default).
- **Offline:** `ssqch build --offline` (or `SSQCH_OFFLINE=1`) answers every request from its saved copy, whatever its age, and fails a request that has none, so a build on a plane or in a sandbox never touches the network.
- **Seeing it:** a response from a copy has an `x-ssqch-cache` header (`hit`, or `stale` after a failed refresh), and the build summary counts them: `Fetch   12 requests, 9 from the cache`.

CI starts without `.cache/`, so production builds fetch fresh data unless you restore that folder.


## npm packages

Install packages with npm, pnpm or yarn as usual, and import them: `import { DateTime } from "luxon"`. Node finds them as it always does, in `node_modules` folders from the importing file's folder up (so monorepos and pnpm's symlinks work), using `package.json`'s `exports`, `imports` (`#internal`) and `main`. CommonJS works too: `.cjs` files, and `.js` files in packages without `"type": "module"`, run with `require`, `module.exports`, `__dirname` and `__filename`, and importing one gives `module.exports` as the default export and, where Node can read the names from its source, its properties as named exports (`import legacy from "legacy"; const { twice } = legacy;` is the safe way for a package whose exports are built at run time). Your own `.js` files follow Node's rules: `"type"` in your `package.json` decides, and without one Node 22 reads a file with `import` or `export` as an ES module and any other as CommonJS, so `module.exports = { ... }` in `_data/site.js` works. In an ES module, `createRequire(import.meta.url)` from `node:module` gives you a `require`.

Packages run on Node, as they are, so anything that works in a Node script works here: servers, child processes, streams, native addons and the file system. Eleventy's own libraries (liquidjs, nunjucks, markdown-it and its plugins, gray-matter), luxon, dayjs, date-fns, lodash, slugify, js-yaml, marked, highlight.js, prismjs, sanitize-html, html-minifier-terser, clean-css, feed, cheerio and @lit-labs/ssr all run, at Node's speed. Some have a faster built-in in ssqch (the `markdown` filter, `readingTime`, `ssqch/minify`, and `markdown: { highlight: true }` for highlighting), so reach for those packages when you need their particular output.

Every page is rendered on one thread, one call at a time (there are no worker threads), so module-level state in your config behaves as it would in any Node script: a counter in a filter counts every page in order. A filter or template gets your real objects, not copies, so a filter that sorts `collections.posts` in place reorders it for the pages rendered after it: copy first (`[...posts].sort()`).


## Configuring with TOML

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
