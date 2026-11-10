# Moving from Eleventy

SiteSquatch keeps many of the same ideas as Eleventy (a data cascade, collections, pagination, layouts) but isn't a drop-in replacement: the config is one object instead of method calls, and names are SiteSquatch's own. Nunjucks and Liquid templates render as they are, so the first build usually comes early, and what's left is the config and a few front-matter keys.

The [ReverentGeek blog](https://github.com/reverentgeek/blog) made this move (from Eleventy with Edge templates), and the [`blog-categories`](../../examples/sites/blog-categories/) example is distilled from eslint.org, an Eleventy site.

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
| `addFilter`, `addShortcode`, `addNunjucksFilter` | `filters: { name: fn }`, callable from every template language (`{{ name(x) }}` in Edge, `{{ x \| name }}` in Nunjucks and Liquid). Async functions are awaited. |
| `addPairedShortcode` | A `::: name` container (`_includes/containers/name.*`), or an Edge component |
| `addCollection(name, api => ...)` | `collections: { name: (pages) => ... }`. `getAll()` is `pages.all()`, `getFilteredByTag(t)` is `pages.byTag(t)`, `getFilteredByGlob(g)` is `pages.byGlob(g)`. |
| `addGlobalData` | `data: { name: value or function }` |
| `addTransform` | `transforms: { name: (content, page) => content }` |
| `addPassthroughCopy` | `passthrough`: a path, a glob, or `{ from: to }` |
| `addWatchTarget` | `watch` |
| `addPlugin` | `plugins`: objects with any of these keys, or functions that return one |
| `on("eleventy.before")`, `on("eleventy.after")` | `beforeBuild`, `afterBuild` |
| `dir` | `dirs` |
| `markdownTemplateEngine`, `htmlTemplateEngine` | `markdownEngine`, `htmlEngine` |
| `setLibrary("md", markdownIt(...).use(...))` | `markdown: { ... }` options, render hooks and containers (below) |
| `pathPrefix` | Not supported yet |

The config is ESM: `require` and `module.exports` become `import` and `export`, and npm packages can't be imported yet (relative files, JSON and `node:fs`, `node:path` and other built-ins can).

## Front matter and data

| Eleventy | SiteSquatch |
| --- | --- |
| `eleventyComputed` | `computed` |
| `eleventyExcludeFromCollections` | `excludeFromCollections` |
| `templateEngineOverride: md` | `render: md` (or a list, or `false`) |
| `permalink`, `layout`, `tags`, `pagination`, `date` | The same |
| `*.11tydata.js`, `*.11tydata.json` | `*.data.js`, `*.data.json` |
| `_data/*.js` and directory data (`posts/posts.json`) | The same |
| `page.url`, `page.fileSlug`, `page.inputPath`, `page.outputPath`, `page.date` | The same, plus `page.headings` and `page.excerpt` in layouts. Dates in file names (`2024-06-01-post.md`) work the same way. |
| `layouts: "_includes/layouts"` and `layout: post` | `dirs: { layouts: "_includes/layouts" }` |
| `addDataExtension("yml", ...)` with js-yaml | Built in: YAML, TOML and JSON data files load as they are, and `readData(path)` from `ssqch` reads one in code |
| `eleventyNavigation` | A data file such as `_data/nav.yml` (see the `docs-sidebar` example) |
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

Nunjucks (`.njk`) renders with minijinja, and Liquid with the `liquid` crate. Most templates work unchanged; the README lists what differs (Nunjucks async tags and custom tag extensions aren't supported). JavaScript templates (`.11ty.js`) need rewriting in a template language, or an engine of your own for a new extension: `engines: { page: (source, data) => html }` renders `.page` files. WebC isn't supported.

## Things that work differently

- **Templates in a passthrough folder aren't pages.** Eleventy renders a `feed.njk` inside a copied `static/` folder and also copies it. ssqch only copies it. Move templates out, or use a glob for the files to copy (`{ "src/static/*.{png,ico,svg}": "." }`).
- **A filter called as a function loses to page data of the same name.** With `image:` in a post's front matter, `image(src)` is that string, not the filter. `src | image` works, or give the filter another name.
- **A printed date is ISO 8601** (`2024-06-01T00:00:00.000Z`), not JavaScript's `Date.toString()`, which depends on the machine's time zone. Format dates with a filter.
- **Markdown differs from markdown-it in a few places:** smart punctuation turns every `--` into a dash (markdown-it's typographer only a spaced one), bare domains like `example.com` aren't links (only `https://` and `www.` URLs are, as on GitHub), and with `indentedCode: false`, indented HTML renders as HTML (markdown-it wraps it in `<p>`).
- **markdown-it-anchor's ids** need a slugger: `markdown: { headingIds: (text) => encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "-")) }`, and a heading hook if you want its `tabindex="-1"`.

## Checking the move

Build the old site and the new one, and compare the output folders with a diff tool: the differences should be ones you meant. The link checker (`linksPlugin()`) catches pages and anchors that moved.
