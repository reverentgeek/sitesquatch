---
title: "Trailhead: moving from Eleventy"
navTitle: "From Eleventy"
description: "SiteSquatch keeps many of the same ideas as Eleventy (a data cascade, collections, pagination, layouts) but isn't a drop-in replacement."
---
SiteSquatch keeps many of the same ideas as Eleventy (a data cascade, collections, pagination, layouts) but isn't a drop-in replacement: the config is one object instead of method calls, and names are SiteSquatch's own. Nunjucks and Liquid templates render as they are, so the first build usually comes early, and what's left is the config and a few front-matter keys.

The [ReverentGeek blog](https://github.com/reverentgeek/blog) made this move (from Eleventy with Edge templates), and the [`blog-categories`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/blog-categories/) example is distilled from eslint.org, an Eleventy site.

## Scouting

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) lists what this guide describes for your site, with file and line, and drafts the mechanical part: it renames `*.11tydata.*` data files and the `eleventy:` image attributes below (Eleventy's front matter keys work as they are), writes a first `ssqch.config.js` from the Eleventy config (folders, passthrough copies, watch targets, template engines, `pathPrefix`, and filters and shortcodes that use only their own arguments, copied as written, in the config's own indentation), swaps `@11ty/eleventy` for `ssqch` in `package.json` and its scripts (`eleventy` is `ssqch build`, `eleventy --serve` is `ssqch serve`), and lists what's left, including a lockfile to update or a stale one from another package manager, each with its file and line: every filter, shortcode, collection, transform and plugin, and what it becomes. It changes nothing on its own: `--write-draft` writes the new files and `--patch move.patch` the edits, to read and `git apply`. Run it again during the move to see what's left.

A whole move with the loop, scout's report before, halfway and at the end, with `baseline` and `diff` between: [A move, step by step](../agents.md#a-move-step-by-step).

**What scout also finds:** what the site's own modules add: the config is followed through its relative imports (`registerSiteFilters(eleventyConfig)` in `lib/`, a plugin of the site's own), and each module's filters, shortcodes, collections and transforms are listed with its own file and line, the self-contained filters copied into the draft as the config's are. Eleventy's packages in data files and other modules (eleventy-img or eleventy-fetch run by a data file) are listed with what replaces them. The packages that came with `@11ty/eleventy` and that the site's own code imports without listing them (`slugify` in the config, `browser-sync` in a gulpfile, `gray-matter` in a data file): it adds each to `package.json` beside where Eleventy was, at the version installed, since the output can depend on it, or, with no `node_modules` to read the version from, lists it to add by hand. The filters and shortcodes the templates use that nothing defines (not the template language, not ssqch, not the Eleventy config), each with how many templates use it and the first place: Eleventy's built-ins (`log`, `getCollectionItem` and `getCollectionItemIndex`, which it ports into the draft's `filters`, and `slug`, which it says how to port: Eleventy's keeps punctuation ssqch's `slugify` drops), the RSS and navigation plugins' (and what replaces them), and any other name, which is usually a plugin's or a helper module's. markdown-it's `breaks`, `linkify` and `typographer` and markdown-it-implicit-figures come along as the draft's `markdown` options, and so do the defaults where the two Markdowns write different markup, each with a comment: `headingIds: false` when the site has no markdown-it-anchor (Eleventy's headings had no ids; the ReverentGeek blog had 380), and `indentedCode: false` for Eleventy 3 (and Eleventy 2 without a library of its own), which turns indented code blocks off. Take a line out to move to ssqch's. It also lists what changes the output before the first diff: a Date printed as it is (`{{ date }}`: `Date.toString()` in Eleventy, ISO 8601 in ssqch), date code that reads the machine's time zone (`toLocaleDateString` without `timeZone`, luxon's `fromJSDate` without `zone`), `pagination` over `collections`, templates in a folder that's passed through (Eleventy rendered them, ssqch copies them), a script that runs `ssqch build` beside another command with `&`, and a second build tool (a gulpfile, webpack, PostCSS) with what ssqch has for each part it does. With markdown-it-anchor (and no `slugify` of the site's), the draft has `headingIds: "markdown-it-anchor"`; with `dataTemplateEngine`, a data file's `{{ '/about/' | url }}` becomes `"/about/"`; `ignores.add()` joins `.eleventyignore` in `ignore`; and a file passed through twice is listed once.

## The config

`.eleventy.js` becomes `ssqch.config.js`, an ES module whose default export is the config: an object, or a function of `{ env, serving }` that returns one.

```js
import { defineConfig } from "ssqch";
import { rssPlugin } from "ssqch/rss";

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "_site" },
  templateFormats: ["njk", "md"],
  markdownEngine: "njk",
  filters: { year: (d) => d.getUTCFullYear() },
  collections: { posts: (pages) => pages.byGlob("src/posts/*.md") },
  plugins: [rssPlugin()],
}));
```

| Eleventy | SiteSquatch |
| --- | --- |
| `addFilter`, `addNunjucksFilter` | `filters: { name: fn }`, callable from every template language (`{{ name(x) }}` in Edge, `{{ x \| name }}` in Nunjucks and Liquid). Async functions are awaited. |
| `addShortcode` | A filter too. In Nunjucks, a config filter is also a tag, so `{% image "a.png", "Alt" %}` keeps working as it is. |
| `addPairedShortcode` | In Nunjucks, the same filter with a closing tag: `{% callout "tip" %}...{% endcallout %}` calls `callout(content, "tip")`. In Markdown, a `::: name` container (`_includes/containers/name.*`). In Edge, a component. |
| `addCollection(name, api => ...)` | `collections: { name: (pages) => ... }`. `getAll()` is `pages.all()`, `getFilteredByTag(t)` is `pages.byTag(t)`, `getFilteredByGlob(g)` is `pages.byGlob(g)`. |
| `addGlobalData` | `data: { name: value or function }` |
| `addTransform` | `transforms: { name: (content, page) => content }` |
| `addPassthroughCopy` | `passthrough`: a path, a glob, or `{ from: to }` |
| `addWatchTarget` | `watch` |
| `watchIgnores` | `serve: { ignore: [...] }`: files only a watcher (Tailwind, PostCSS) reads, so saving one doesn't rebuild |
| `addPlugin` | `plugins`: objects with any of these keys, or functions that return one |
| `on("eleventy.before")`, `on("eleventy.after")` | `beforeBuild`, `afterBuild` |
| `dir` | `dirs` (`dir` works too) |
| `markdownTemplateEngine`, `htmlTemplateEngine` | `markdownEngine`, `htmlEngine` (Eleventy's names work too) |
| `setLibrary("md", markdownIt(...).use(...))` | `markdown: { ... }` options, render hooks and containers (below), or keep your markdown-it as it is: `engines: { md }` ([Your own Markdown library](../markdown.md#your-own-markdown-library)) |
| `pathPrefix` | `base: "/repo/"` (`pathPrefix` works too). Links in templates need no `url` filter (it works, and gives the URL back as it is): ssqch adds the base to every URL from the site's root in the HTML it writes, and `withBase()` covers scripts and JSON. |

The config is ESM, though your own CommonJS files (`require`, `module.exports`) load too. ssqch runs on Node, like Eleventy, so a site's packages run as they are: luxon, date-fns, lodash, markdown-it, slugify-style helpers and the libraries Eleventy brought along all work, and so do servers, child processes and native addons.

Where Eleventy's word means the same thing in ssqch, it works as it is: `ssqch dev` and `ssqch build --serve` serve, `--pathprefix` is `--base`, and the config options and front matter keys marked "works too" in these tables do what ssqch's names do, so a site can move first and rename later. Each one says ssqch's name once (`note: pathPrefix works; ssqch calls it base`), and setting both names is an error. Filters too: `url`, and a `slugify` that's the same in every template language.

`ssqch serve` reads the config again when it changes, so there's no restart while you port it.

## Front matter and data

| Eleventy | SiteSquatch |
| --- | --- |
| `eleventyComputed` | `computed` (`eleventyComputed` works too) |
| `eleventyExcludeFromCollections` | `excludeFromCollections` (Eleventy's name works too) |
| `templateEngineOverride: md` | `render: md` (or a list, or `false`). `templateEngineOverride` works too, `"njk,md"` included. |
| `permalink`, `layout`, `tags`, `pagination`, `date` | The same |
| `*.11tydata.js`, `*.11tydata.json` | `*.data.js`, `*.data.json` |
| `_data/*.js` and directory data (`posts/posts.json`) | The same |
| `page.url`, `page.fileSlug`, `page.inputPath`, `page.outputPath`, `page.date` | The same, plus `page.headings` and `page.excerpt` in layouts. Dates in file names (`2024-06-01-post.md`) work the same way. |
| `layouts: "_includes/layouts"` and `layout: post` | `dirs: { layouts: "_includes/layouts" }` |
| `addDataExtension("yml", ...)` with js-yaml | Built in: YAML, TOML and JSON data files load as they are, and `readData(path)` from `ssqch` reads one in code |
| `eleventyNavigation` | `nav` front matter with the same `key`, `parent`, `order`, `title` and `url`, turned into a tree with `pagesTree(collections.all)`, and `collections.all \| eleventyNavigation: "Feature"` is `pagesTree(collections.all, { root: "Feature" })` (a `parent` no page has is a heading, and `title` falls back to `key`, as in eleventy-navigation); or a data file such as `_data/nav.yml`. `navTree`, `navPager` and `navBreadcrumbs` mark the current page, and give previous/next and the trail. To keep eleventy-navigation's filter instead, leave the front matter as it is and define the filter with the package's function: `import navigation from "@11ty/eleventy-navigation/eleventy-navigation.js"`, then `filters: { eleventyNavigation: (pages, key) => navigation.findNavigationEntries(pages, key) }` (`ssqch scout` leaves the front matter alone when templates call that filter). |
| `eleventy.env`, `process.env.ELEVENTY_ENV` | The `ssqch` template global (`ssqch.env`, `ssqch.serving`), and `SSQCH_ENV` |

## Plugins

| Eleventy plugin | SiteSquatch |
| --- | --- |
| `@11ty/eleventy-img` | `imagePlugin()` from `ssqch/image`: every `<img>` becomes a `<picture>` |
| `@11ty/eleventy-plugin-rss` | `rssPlugin()` from `ssqch/rss` for a feed template's filters, or its `feedPlugin({ url })` for the feed itself (v2's `feedPlugin`, with ssqch's names: `type` is `format`, `outputPath` is `output`, `collection: { name, limit }` is `collection` and `limit`, `metadata` is `url`, `title`, `description` and `author`) |
| `@11ty/eleventy-plugin-syntaxhighlight` | `markdown: { highlight: true }`, or `highlight: { classes: "prism", css: false }` to keep your Prism theme's CSS ([Another highlighter's classes](../markdown.md#another-highlighters-classes)) |
| A Prism language added in the plugin's `init({ Prism })`, or its `alias` option | `markdown: { highlight: { languages } }`: a function that returns `[text, kind]` tokens, another language's name (`cho: "chordpro"`), or a `.sublime-syntax` file (`ssqch docs languages`) |
| markdown-it-anchor | Heading IDs are built in; add anchor links with a heading render hook |
| markdown-it-footnote | Built in |
| markdown-it-container | Built in: `::: name` |
| markdown-it-attrs | `{#id .class}` on headings |
| markdown-it-implicit-figures | `markdown: { figures: true }` |
| An HTML minifier transform | `minifyPlugin()` from `ssqch/minify` |
| A link checker | `linksPlugin()` from `ssqch/links` |
| A sitemap template | `sitemapPlugin({ url })` from `ssqch/sitemap` |
| Redirect pages made with pagination | `redirectsPlugin()` from `ssqch/redirects`, with `aliases` front matter |

## Templates

Nunjucks (`.njk`) renders with Nunjucks, the library Eleventy uses (ssqch's fork of it, which prints values as Nunjucks does: `true`, `a,b`), Liquid with liquidjs, Eleventy's Liquid library, and EJS (`.ejs`) with ejs (`include()` reads from `_includes`, as in Eleventy). Most templates work unchanged, shortcodes included; [Each template language](../template-languages.md) lists what differs (Liquid shortcodes become filters, for one). JavaScript templates (`.11ty.js`) need rewriting in a template language, or an engine of your own for a new extension: `engines: { page: (source, data) => html }` renders `.page` files. WebC isn't supported.

## Things that work differently

- **Templates in a passthrough folder aren't pages.** Eleventy renders a `feed.njk` inside a copied `static/` folder and also copies it. ssqch only copies it. Move templates out, or use a glob for the files to copy (`{ "src/static/*.{png,ico,svg}": "." }`).
- **In Nunjucks, a filter called as a function loses to page data of the same name.** With `image:` in a post's front matter, `image(src)` is that string, not the filter. `src | image` and the tag form (`{% image src %}`) always reach the filter, and Edge's `image(src)` does too.
- **A page without a date has its file's modification time,** not its creation time as in Eleventy. A footer with `{{ page.date.getFullYear() }}` can print a different year on every page, and `ssqch diff` says `differ only in dates or years`. For a copyright year, use the build's time: `{{ now() | dateformat("%Y") }}`. In data files, `dateformat` also saves formatting dates by hand (`toLocaleDateString`). While serving, every save of one renders the pages that show its date (every page that reads collections, when the site's code sorts by dates); `dateFallback: "git"` gives it its last commit's date instead (`ssqch scout` counts the pages that have none).
- **`slugify` drops apostrophes** (`drews-brownies`), where a slug filter of your own might have split the words there (`drew_s_brownies`). `slugify(title, { separator: "_", apostrophes: "separate" })` matches that. It drops symbols too, where Eleventy's spells them out (`Old Growth & Cedar` is `old-growth-cedar`, and `old-growth-and-cedar` in Eleventy): `slugify(title, { ascii: true })` spells them out as Eleventy's does. Either way, `ssqch diff` shows any URL that changed before you swap one for the other.
- **`.length` works in Nunjucks,** on lists and strings, as in Eleventy (`{{ collections.post.length }}`); `| length` is the Jinja way and does the same.
- **A data file can start with a byte-order mark** (SQL Server's and Excel's exports do): ssqch skips it in JSON, YAML, TOML, JavaScript and templates, as Node does.
- **A folder of full-size photos** is what `imagePlugin()` from `ssqch/image` is for: every `<img>` gets sized, modern-format copies in a `<picture>`, and `image()` in a data file gives the URLs and dimensions without markup.
- **A printed date is ISO 8601** (`2024-06-01T00:00:00.000Z`), not JavaScript's `Date.toString()`, which depends on the machine's time zone. Format dates with a filter.
- **Markdown differs from markdown-it in a few places:** bare domains like `example.com` aren't links (only `https://` and `www.` URLs are, as on GitHub) unless `markdown: { autolinks: "fuzzy" }`, and with `indentedCode: false`, indented HTML renders as HTML (markdown-it wraps it in `<p>`). markdown-it's `breaks` and markdown-it-implicit-figures are `markdown: { breaks: true, figures: true }` ([markdown-it's habits](../markdown.md#markdown-its-habits)); `ssqch scout` carries them, `linkify` and `typographer` into the draft config.
- **The layout is chosen before `computed` runs.** A computed `layout` that's plain text (`eleventyComputed: { layout: "article" }`) is used; one that depends on the page is an error. Set it in the front matter or a data file.
- **`computed` doesn't see `collections`.** Build lists that need collections in a filter or a collection instead.
- **Includes come from `_includes`** (and themes), not from the project root as in Eleventy's Nunjucks. To show a source file in a page, read it in a filter: `filters: { readFile: (p) => fs.readFileSync(p, "utf8") }`.
- **Filters get your real objects,** as in Eleventy, not copies: a filter that sorts or changes what it's given changes it for the pages rendered after it. Copy first (`[...posts].sort()`). Data that refers to itself (nav items whose `prev` and `next` point at each other) is fine.
- **`{#id}` at the end of a Markdown line is a heading attribute,** not a Nunjucks comment, even though Markdown runs through Nunjucks or Jinja first.
- **markdown-it-anchor's ids** need a slugger: `markdown: { headingIds: (text) => encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "-")) }`, and a heading hook if you want its `tabindex="-1"`.

## Moving with identical output first

A big site moves most safely in two steps: first the same pages, byte for byte, then ssqch's own features one at a time. For the first step, keep Eleventy's template libraries and let ssqch do the rest (finding pages, the data cascade, pagination, collections, layouts, transforms, writing):

- **Markdown:** your markdown-it as it is, `engines: { md }` (the instance you gave `setLibrary("md", ...)`), and `markdownEngine: "liquid"`, since Eleventy runs Markdown through Liquid first. Indented code blocks depend on the Eleventy version: Eleventy 3 turns them off in every markdown-it, a site's own included (`md.disable("code")` in your instance, for the same output), Eleventy 2 only in its own, and Eleventy 1 leaves them on. `cache: true` keeps what it renders between `ssqch serve`'s rebuilds ([Your own Markdown library](../markdown.md#your-own-markdown-library)).
- **Liquid and Nunjucks:** ssqch's Liquid is liquidjs, as Eleventy's is, and its Nunjucks a fork of Nunjucks, so most pages match as they are. Its Liquid follows Ruby's in a few places, as Jekyll's does (math on text, `split`); `ssqch diff` shows the pages that differ.
- **Front matter strings:** `permalink` and `computed` strings never go through an engine of your own: they render with ssqch's template language (for a `.md` page, the `markdownEngine`), so your markdown-it never sees them.
- **Install what Eleventy brought along:** liquidjs, nunjucks, gray-matter and luxon came with `@11ty/eleventy`, and a site's data files often import them without listing them. Pin the versions Eleventy had (`npm ls liquidjs nunjucks`), since the output depends on them.
- **Plugins' filters, as they were:** the RSS plugin's are its exports (`const rss = require("@11ty/eleventy-plugin-rss")`, then `filters: { absoluteUrl: rss.absoluteUrl, htmlToAbsoluteUrls: (html, base) => (html ? rss.convertHtmlToAbsoluteUrls(html, base, { closingSingleTag: "slash" }) : ""), rssDate: rss.dateToRfc3339 }`), and eleventy-navigation's is `findNavigationEntries` (above). ssqch's own `absoluteUrl(url, base)` is on every site already, with the site's `base` in front, so `rss.absoluteUrl` is only for Eleventy's answer to the letter.
- **Dates printed bare:** `{{ date }}` is `Date.toString()` in Eleventy (`Mon Mar 08 2021 00:00:00 GMT+0000 (Coordinated Universal Time)` with `TZ=UTC`) and ISO 8601 in ssqch. To match first, a transform can put Eleventy's text back; then format the date in the template (`{{ date | dateformat("iso") }}`), which also stops the page depending on the build machine's time zone. `ssqch diff` counts the two forms as dates and groups them.
- **Pages with the same date** (every undated page, with `SOURCE_DATE_EPOCH` or a baseline's pinned times) sort by path, folder by folder; Eleventy compares the paths as text, so `about-us.md` comes before `about/index.md` there and after it here. For Eleventy's order in a list that shows it (a sitemap over `collections.all`), sort in the template or define the collection: `collections: { all: (pages) => [...pages.all()].sort((a, b) => a.date - b.date || (a.inputPath < b.inputPath ? -1 : a.inputPath > b.inputPath ? 1 : 0)) }`.
- **Undated pages' dates:** Eleventy gives them the file's creation time, so a sitemap's `<lastmod>` is the checkout's time and changes on every clone. `ssqch baseline` pins file times to the commit's; set `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)` for `ssqch build`, and the two agree.
- **Compare bytes:** `ssqch diff --exact`. Without `--exact`, whitespace between tags, image ids and how tags are written (attribute order, quotes, entities) are ignored.

Then move one feature at a time to ssqch's (Markdown, highlighting, minifying, the table of contents), with `ssqch diff` after each.

## Packages

ssqch runs a site's JavaScript on Node, so every package that worked with Eleventy works here, at Node's speed, with nothing to port. A few notes:

| Package | On ssqch | Instead |
| --- | --- | --- |
| html-minifier, html-minifier-terser | Works, as a transform of your own (`transforms: { minify: async (content, page) => page.outputPath.endsWith(".html") ? await minify(content, options) : content }`). It gives Eleventy's bytes, which is what you want while the move is checked with `ssqch diff --exact` | `minifyPlugin()` from `ssqch/minify`, several times faster, with bytes of its own; switch when the bytes stop mattering |
| cheerio, @lit-labs/ssr | Work | `page.headings`, `toc()` and transforms on strings are cheaper for a little work |
| Anything that drives a browser (Playwright, Puppeteer) | Works, but a build that opens a browser is slow | A `beforeBuild` `run:` step that renders once, or a small local server your config `fetch`es |

Pages render one at a time on one thread (there are no worker threads), so if a build is much slower than with Eleventy, time the filters and transforms with `console.time`: one slow package is usually most of it.

## Checking the move

Build the old site with Eleventy and the new one with ssqch, and compare the two output folders. `ssqch baseline` makes Eleventy's build from fresh copies with the clock pinned, three times, and says what changes by itself:

```sh
ssqch baseline "npx @11ty/eleventy" --commit <the commit before the import>
ssqch build
ssqch diff .cache/ssqch/baseline/ref-1 dist    # or ref-common, when the builds vary
```

It lists the URLs that were added and removed and what changed on each page, ignoring whitespace between tags, fingerprinted file names, eleventy-img's and `imagePlugin()`'s image ids, and markup browsers read the same (attribute order, `defer="defer"`, `<br/>`, `&#39;`); `--ignore <regex>` drops differences you expect (a generator meta tag, say). The link checker (`linksPlugin()`) catches pages and anchors that moved, and a `schemas` entry catches front matter that didn't survive the trip.

If the site has a second build tool (Gulp, webpack, PostCSS) writing into the same folder, keep it for the first step: build with `ssqch build && <the tool>` (ssqch never touches files it didn't write) and give `ssqch baseline` both commands (`ssqch baseline "npx @11ty/eleventy && npx gulp build"`). ssqch needs Node 22.18 or newer, so a site pinned to an older Node moves its other tools too: build the old site once on the new Node and compare it with the old Node's build, so a difference the new Node makes isn't blamed on ssqch. When `ssqch baseline` says files vary, three builds show that they do, not which version is usual: `--runs 20` (or more) counts each version, and `.cache/ssqch/baseline/ref-common` has each file's most common one to compare with.

`ssqch scout` drafts the mechanical renames above for you; see [Scouting](#scouting). For the whole loop as steps a coding agent can follow (reference builds, the biggest group of differences first, when to stop), see [Moving a site with an agent](../agents.md#moving-a-site-with-an-agent).
