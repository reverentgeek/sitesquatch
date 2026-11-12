# Trailhead: moving from Eleventy

SiteSquatch keeps many of the same ideas as Eleventy (a data cascade, collections, pagination, layouts) but isn't a drop-in replacement: the config is one object instead of method calls, and names are SiteSquatch's own. Nunjucks and Liquid templates render as they are, so the first build usually comes early, and what's left is the config and a few front-matter keys.

The [ReverentGeek blog](https://github.com/reverentgeek/blog) made this move (from Eleventy with Edge templates), and the [`blog-categories`](../../examples/sites/blog-categories/) example is distilled from eslint.org, an Eleventy site.

## Importing

`ssqch import eleventy` does the mechanical part of what this guide describes: it renames `*.11tydata.*` data files, rewrites the front matter keys and `eleventy:` image attributes below, writes a first `ssqch.config.js` from the Eleventy config (folders, passthrough copies, watch targets, template engines, `pathPrefix`), and lists what's left, each with its file and line: every filter, shortcode, collection, transform and plugin, and what it becomes. Run it once to read the list (it changes nothing), then with `--write` in a clean git checkout.

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

The config is ESM, though your own CommonJS files (`require`, `module.exports`) load too. npm packages import from `node_modules` as they do in Node, as long as they don't need a server, child processes or native addons: luxon, date-fns, lodash, markdown-it and slugify-style helpers work.

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
| `eleventyNavigation` | `nav` front matter with the same `key`, `parent`, `order` and `title`, turned into a tree with `pagesTree(collections.all)`; or a data file such as `_data/nav.yml`. `navTree`, `navPager` and `navBreadcrumbs` mark the current page, and give previous/next and the trail. |
| `eleventy.env`, `process.env.ELEVENTY_ENV` | The `ssqch` template global (`ssqch.env`, `ssqch.serving`), and `SSQCH_ENV` |

## Plugins

| Eleventy plugin | SiteSquatch |
| --- | --- |
| `@11ty/eleventy-img` | `imagePlugin()` from `ssqch/image`: every `<img>` becomes a `<picture>` |
| `@11ty/eleventy-plugin-rss` | `rssPlugin()` from `ssqch/rss` |
| `@11ty/eleventy-plugin-syntaxhighlight` | `markdown: { highlight: true }` |
| markdown-it-anchor | Heading IDs are built in; add anchor links with a heading render hook |
| markdown-it-footnote | Built in |
| markdown-it-container | Built in: `::: name` |
| markdown-it-attrs | `{#id .class}` on headings |
| An HTML minifier transform | `minifyPlugin()` from `ssqch/minify` |
| A link checker | `linksPlugin()` from `ssqch/links` |
| A sitemap template | `sitemapPlugin({ url })` from `ssqch/sitemap` |
| Redirect pages made with pagination | `redirectsPlugin()` from `ssqch/redirects`, with `aliases` front matter |

## Templates

Nunjucks (`.njk`) renders with minijinja, Liquid with the `liquid` crate, and EJS (`.ejs`) with ssqch's own EJS on its built-in JavaScript engine (`include()` reads from `_includes`, as in Eleventy). Most templates work unchanged, shortcodes included; the README lists what differs (Nunjucks async tags aren't supported, and Liquid shortcodes become filters). JavaScript templates (`.11ty.js`) need rewriting in a template language, or an engine of your own for a new extension: `engines: { page: (source, data) => html }` renders `.page` files. WebC isn't supported.

## Things that work differently

- **Templates in a passthrough folder aren't pages.** Eleventy renders a `feed.njk` inside a copied `static/` folder and also copies it. ssqch only copies it. Move templates out, or use a glob for the files to copy (`{ "src/static/*.{png,ico,svg}": "." }`).
- **In Nunjucks, a filter called as a function loses to page data of the same name.** With `image:` in a post's front matter, `image(src)` is that string, not the filter. `src | image` and the tag form (`{% image src %}`) always reach the filter, and Edge's `image(src)` does too.
- **A printed date is ISO 8601** (`2024-06-01T00:00:00.000Z`), not JavaScript's `Date.toString()`, which depends on the machine's time zone. Format dates with a filter.
- **Markdown differs from markdown-it in a few places:** bare domains like `example.com` aren't links (only `https://` and `www.` URLs are, as on GitHub), and with `indentedCode: false`, indented HTML renders as HTML (markdown-it wraps it in `<p>`).
- **markdown-it-anchor's ids** need a slugger: `markdown: { headingIds: (text) => encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "-")) }`, and a heading hook if you want its `tabindex="-1"`.

## Checking the move

Build the old site with Eleventy and the new one with ssqch, and compare the two output folders:

```sh
ssqch diff _site-eleventy dist
```

It lists the URLs that were added and removed and what changed on each page, ignoring whitespace between tags and fingerprinted file names; `--ignore <regex>` drops differences you expect (a generator meta tag, say). The link checker (`linksPlugin()`) catches pages and anchors that moved, and a `schemas` entry catches front matter that didn't survive the trip.

`ssqch import eleventy` does the mechanical renames above for you; see [Importing](#importing).
