---
title: "Trailhead: moving from Eleventy"
navTitle: "From Eleventy"
description: "SiteSquatch keeps many of the same ideas as Eleventy (a data cascade, collections, pagination, layouts) but isn't a drop-in replacement."
---
SiteSquatch keeps many of the same ideas as Eleventy (a data cascade, collections, pagination, layouts) but isn't a drop-in replacement: the config is one object instead of method calls, and names are SiteSquatch's own. Nunjucks and Liquid templates render as they are, so the first build usually comes early, and what's left is the config and a few front-matter keys.

The [ReverentGeek blog](https://github.com/reverentgeek/blog) made this move (from Eleventy with Edge templates), and the [`blog-categories`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/blog-categories/) example is distilled from eslint.org, an Eleventy site.

## Importing

`ssqch import eleventy` does the mechanical part of what this guide describes: it renames `*.11tydata.*` data files, rewrites the front matter keys and `eleventy:` image attributes below, writes a first `ssqch.config.js` from the Eleventy config (folders, passthrough copies, watch targets, template engines, `pathPrefix`, and filters and shortcodes that use only their own arguments, copied as written, in the config's own indentation), swaps `@11ty/eleventy` for `ssqch` in `package.json` and its scripts (`eleventy` is `ssqch build`, `eleventy --serve` is `ssqch serve`), and lists what's left, including a lockfile to update or a stale one from another package manager, each with its file and line: every filter, shortcode, collection, transform and plugin, and what it becomes. Run it once to read the list (it changes nothing), then with `--write` in a clean git checkout.

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
| `addPlugin` | `plugins`: objects with any of these keys, or functions that return one |
| `on("eleventy.before")`, `on("eleventy.after")` | `beforeBuild`, `afterBuild` |
| `dir` | `dirs` (`dir` works too) |
| `markdownTemplateEngine`, `htmlTemplateEngine` | `markdownEngine`, `htmlEngine` (Eleventy's names work too) |
| `setLibrary("md", markdownIt(...).use(...))` | `markdown: { ... }` options, render hooks and containers (below) |
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
| `eleventyNavigation` | `nav` front matter with the same `key`, `parent`, `order` and `title` (for now, `parent` has to be another page's `key` or title, and `title` doesn't fall back to `key`), turned into a tree with `pagesTree(collections.all)`; or a data file such as `_data/nav.yml`. `navTree`, `navPager` and `navBreadcrumbs` mark the current page, and give previous/next and the trail. To keep eleventy-navigation's filter instead, leave the front matter as it is and define the filter with the package's function: `import navigation from "@11ty/eleventy-navigation/eleventy-navigation.js"`, then `filters: { eleventyNavigation: (pages, key) => navigation.findNavigationEntries(pages, key) }` (`ssqch import eleventy` leaves the front matter alone when templates call that filter). |
| `eleventy.env`, `process.env.ELEVENTY_ENV` | The `ssqch` template global (`ssqch.env`, `ssqch.serving`), and `SSQCH_ENV` |

## Plugins

| Eleventy plugin | SiteSquatch |
| --- | --- |
| `@11ty/eleventy-img` | `imagePlugin()` from `ssqch/image`: every `<img>` becomes a `<picture>` |
| `@11ty/eleventy-plugin-rss` | `rssPlugin()` from `ssqch/rss` |
| `@11ty/eleventy-plugin-syntaxhighlight` | `markdown: { highlight: true }` |
| A Prism language added in the plugin's `init({ Prism })`, or its `alias` option | `markdown: { highlight: { languages } }`: a function that returns `[text, kind]` tokens, another language's name (`cho: "chordpro"`), or a `.sublime-syntax` file (`ssqch docs languages`) |
| markdown-it-anchor | Heading IDs are built in; add anchor links with a heading render hook |
| markdown-it-footnote | Built in |
| markdown-it-container | Built in: `::: name` |
| markdown-it-attrs | `{#id .class}` on headings |
| An HTML minifier transform | `minifyPlugin()` from `ssqch/minify` |
| A link checker | `linksPlugin()` from `ssqch/links` |
| A sitemap template | `sitemapPlugin({ url })` from `ssqch/sitemap` |
| Redirect pages made with pagination | `redirectsPlugin()` from `ssqch/redirects`, with `aliases` front matter |

## Templates

Nunjucks (`.njk`) renders with Nunjucks, the library Eleventy uses (ssqch's fork of it, which prints values as Nunjucks does: `true`, `a,b`), Liquid with liquidjs, Eleventy's Liquid library, and EJS (`.ejs`) with ejs (`include()` reads from `_includes`, as in Eleventy). Most templates work unchanged, shortcodes included; [Each template language](../template-languages.md) lists what differs (Liquid shortcodes become filters, for one). JavaScript templates (`.11ty.js`) need rewriting in a template language, or an engine of your own for a new extension: `engines: { page: (source, data) => html }` renders `.page` files. WebC isn't supported.

## Things that work differently

- **Templates in a passthrough folder aren't pages.** Eleventy renders a `feed.njk` inside a copied `static/` folder and also copies it. ssqch only copies it. Move templates out, or use a glob for the files to copy (`{ "src/static/*.{png,ico,svg}": "." }`).
- **In Nunjucks, a filter called as a function loses to page data of the same name.** With `image:` in a post's front matter, `image(src)` is that string, not the filter. `src | image` and the tag form (`{% image src %}`) always reach the filter, and Edge's `image(src)` does too.
- **A page without a date has its file's modification time,** not its creation time as in Eleventy. A footer with `{{ page.date.getFullYear() }}` can print a different year on every page, and `ssqch diff` says `differ only in dates or years`. For a copyright year, use the build's time: `{{ now() | dateformat("%Y") }}`. In data files, `dateformat` also saves formatting dates by hand (`toLocaleDateString`).
- **`slugify` drops apostrophes** (`drews-brownies`), where a slug filter of your own might have split the words there (`drew_s_brownies`). `slugify(title, { separator: "_", apostrophes: "separate" })` matches that, and `ssqch diff` shows any URL that changed before you swap one for the other.
- **`.length` works in Nunjucks,** on lists and strings, as in Eleventy (`{{ collections.post.length }}`); `| length` is the Jinja way and does the same.
- **A data file can start with a byte-order mark** (SQL Server's and Excel's exports do): ssqch skips it in JSON, YAML, TOML, JavaScript and templates, as Node does.
- **A folder of full-size photos** is what `imagePlugin()` from `ssqch/image` is for: every `<img>` gets sized, modern-format copies in a `<picture>`, and `image()` in a data file gives the URLs and dimensions without markup.
- **A printed date is ISO 8601** (`2024-06-01T00:00:00.000Z`), not JavaScript's `Date.toString()`, which depends on the machine's time zone. Format dates with a filter.
- **Markdown differs from markdown-it in a few places:** bare domains like `example.com` aren't links (only `https://` and `www.` URLs are, as on GitHub), and with `indentedCode: false`, indented HTML renders as HTML (markdown-it wraps it in `<p>`).
- **The layout is chosen before `computed` runs.** A computed `layout` that's plain text (`eleventyComputed: { layout: "article" }`) is used; one that depends on the page is an error. Set it in the front matter or a data file.
- **`computed` doesn't see `collections`.** Build lists that need collections in a filter or a collection instead.
- **Includes come from `_includes`** (and themes), not from the project root as in Eleventy's Nunjucks. To show a source file in a page, read it in a filter: `filters: { readFile: (p) => fs.readFileSync(p, "utf8") }`.
- **Filters get your real objects,** as in Eleventy, not copies: a filter that sorts or changes what it's given changes it for the pages rendered after it. Copy first (`[...posts].sort()`). Data that refers to itself (nav items whose `prev` and `next` point at each other) is fine.
- **`{#id}` at the end of a Markdown line is a heading attribute,** not a Nunjucks comment, even though Markdown runs through Nunjucks or Jinja first.
- **markdown-it-anchor's ids** need a slugger: `markdown: { headingIds: (text) => encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "-")) }`, and a heading hook if you want its `tabindex="-1"`.

## Moving with identical output first

A big site moves most safely in two steps: first the same pages, byte for byte, then ssqch's own features one at a time. For the first step, keep Eleventy's template libraries and let ssqch do the rest (finding pages, the data cascade, pagination, collections, layouts, transforms, writing):

- **Markdown and HTML:** an engine of your own (`engines` in the config) that runs liquidjs and then your markdown-it for `.md`, and your Nunjucks for `.njk` and `.html`, set for every page with one line, `data: { render: "eleventy" }` (global data reaches every page), and for layouts with `htmlEngine: "eleventy"`. Branch on `data.page.inputPath`. Eleventy's defaults: Markdown runs through Liquid first, and markdown-it has `code` (indented code blocks) turned off.
- **Front matter strings:** the same engine renders `computed` strings and permalinks before the page has a URL (`data.page.url` is undefined): render those with the template language only, not Markdown.
- **Install what Eleventy brought along:** liquidjs, nunjucks, gray-matter and luxon came with `@11ty/eleventy`, and a site's data files often import them without listing them. Pin the versions Eleventy had (`npm ls liquidjs nunjucks`), since the output depends on them.
- **Compare bytes:** `ssqch diff --exact`. Without `--exact`, whitespace between tags is ignored.

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

Build the old site with Eleventy and the new one with ssqch, and compare the two output folders:

```sh
ssqch diff _site-eleventy dist
```

It lists the URLs that were added and removed and what changed on each page, ignoring whitespace between tags and fingerprinted file names; `--ignore <regex>` drops differences you expect (a generator meta tag, say). The link checker (`linksPlugin()`) catches pages and anchors that moved, and a `schemas` entry catches front matter that didn't survive the trip.

`ssqch import eleventy` does the mechanical renames above for you; see [Importing](#importing).
