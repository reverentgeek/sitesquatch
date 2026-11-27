---
title: "Trailhead: moving from Hexo"
navTitle: "From Hexo"
description: "Hexo sites are Markdown posts, a theme of templates (often Nunjucks, sometimes EJS or Pug) and tag plugins inside the posts."
---
Hexo sites are Markdown posts, a theme of templates (often Nunjucks, sometimes EJS or Pug) and tag plugins inside the posts. A Nunjucks theme carries over with a few changes (below: `body`, `partial()`, `page` and escaping), posts keep their front matter, and tag plugins become filters called with quoted arguments. What takes work is the theme's helpers, the site's own `scripts/`, and anything that leans on Hexo's `site` object. `ssqch scout` lists each of them in a Hexo site, with counts.

The [`docs-sidebar`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/docs-sidebar/) example is distilled from hexo.io (and the FastAPI docs), and [`blog-tags`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/blog-tags/) shows a blog with tag pages and feeds.

## The config

`_config.yml` becomes `ssqch.config.js`. Keep the site's own values (`title`, `url`, `author`) where templates expect them by moving them to `src/_data/config.yml`, so `{{ config.title }}` still works.

| Hexo | SiteSquatch |
| --- | --- |
| `source_dir: source`, `public_dir: public` | `dirs: { input: "source", output: "public" }` |
| `themes/<name>/layout/` | `dirs: { includes: "_includes" }`, or keep the theme where it is as a [theme](../themes.md): `theme: "themes/<name>"`, with its templates under `_includes/` |
| `themes/<name>/source/` (CSS, JS, images) | The theme folder's other files are copied as they are, or `passthrough` |
| `_config.yml` values in templates (`config.title`) | `src/_data/config.yml`: every file in `_data` is a template variable |
| `theme_config`, `themes/<name>/_config.yml` (`theme.menu`) | `src/_data/theme.yml` |
| `permalink: :year/:month/:day/:title/` | A `permalink` in the posts' directory data: `"/{{ page.date \| dateformat('%Y/%m/%d') }}/{{ page.fileSlug }}/"` |
| `new_post_name: :year-:month-:day-:title.md` | The same file names: a date at the start of a file name is the page's date |
| `root: /blog/` | `base: "/blog/"`. Links stay as written; `url_for()` isn't needed. |
| `timezone: America/New_York` | `timeZone: "America/New_York"`. A date written without a time (`date: 2026-11-02`) is that day, midnight in this zone, as Hexo reads it; without `timeZone`, ssqch uses UTC |
| `per_page`, `pagination_dir` | `pagination: { data: collections.posts, size: 10 }` on the index template |
| `skip_render` | `passthrough`, or `ignore` |
| `highlight` / `prismjs` | `markdown: { highlight: true }`, at build time |
| `hexo-generator-feed` | `feedPlugin({ url })` from `ssqch/rss` (`format: "rss"` for RSS 2.0); a template with `rssPlugin()`'s filters for a feed of your own (see `blog-tags`) |
| `hexo-generator-sitemap` | `sitemapPlugin({ url })` |
| `hexo-generator-alias` (`alias:` front matter) | `redirectsPlugin()` and `aliases` front matter |
| `hexo-generator-search`, a build-time lunr index | Pagefind after the build: `afterBuild: { run: "npx -y pagefind --site public" }` |
| `hexo-renderer-sass` | `sassPlugin()` from `ssqch/sass` |
| `hexo-renderer-stylus` | Stylus as a `beforeBuild` command, with nib, which hexo-renderer-stylus loads and Hexo themes import: `beforeBuild: { run: "npx stylus --use nib --include themes/<theme>/source/css -o $SSQCH_OUTPUT/css themes/<theme>/source/css/style.styl" }` (install `stylus` and `nib`) |
| `hexo-clean-css` | `minifyPlugin({ css: true })` from `ssqch/minify` |
| `hexo-uglify` | ssqch doesn't minify JavaScript: terser in `afterBuild`, `afterBuild: { run: "npx terser public/js/app.js -o public/js/app.js" }` |
| `hexo-filter-nofollow`, `external_link` | A transform over the HTML: every outside `<a>` without a `rel` gets `rel="noopener external nofollow noreferrer"` |
| `pretty_urls: { trailing_html: false }` | `urls: "html"` writes `docs/setup.html` as Hexo does; links written without `.html` (`/docs/setup`) are the host's to serve (Netlify and Cloudflare do) |
| `per_page: 0` | One archive page: pagination with `size` the collection's length |
| `hexo server`, `hexo generate` | `ssqch serve`, `ssqch build` (`ssqch server` and `ssqch generate` work too) |
| Heading ids (`#Join-us`, case kept) | `` headingIds: (text) => text.replace(/[\s~`!@#$%^&*()\-_+=[\]{}\|\\;:"'<>,.?/]+/g, "-").replace(/^-+\|-+$/g, "") ``, hexo-util's `slugize` |
| highlight.js's classes (`<span class="keyword">`) | `markdown: { highlight: { css: false, classes: { keyword: "keyword", string: "string", comment: "comment" } } }`, and a `fence` render hook for Hexo's `<figure class="highlight">` |
| `sitemap.txt`, or another file a generator writes | A template with that `permalink` (`permalink: /sitemap.txt`) that loops over `collections.all` |

## Posts and pages

| Hexo | SiteSquatch |
| --- | --- |
| `source/_posts/*.md` | The same folder, with a directory data file `source/_posts/_posts.json`: `{ "layout": "post.njk", "tags": "posts" }` plus the `permalink` above |
| `title`, `date`, `updated`, `tags`, `permalink` | The same. `tags` build `collections.<tag>`. A date written with slashes (`2026/05/08 12:00`) is read as the same date with dashes. |
| A page with no date of its own | Its file's time in ssqch, which a checkout or a save moves: dates and the order of lists change from one build to the next, and on each save `ssqch serve` renders the pages that show it (every page that reads collections, when the site's code sorts by dates). `dateFallback: "git"` gives it its last commit's date (`ssqch scout` counts the pages that have none) |
| `categories` | A front matter list like any other; group pages by it in a custom collection (the `blog-categories` example) |
| `layout: false` | `layout: false`; `permalink: false` for a page that isn't written |
| `<!-- more -->` | The same: `page.excerpt` is the HTML before it |
| `source/_drafts/`, `published: false` | `draft: true` (built in development only) |
| `source/_data/*.yml` (`site.data.menu`) | `_data/menu.yml` is `{{ menu }}` |
| Post asset folders (`post_asset_folder: true`, `_posts/x.md` with `_posts/x/` beside it) | `passthrough` each post's folder to its URL (`{ "source/_posts/x": "2026/05/08/x" }`, or a glob per year); `bundles: true` covers only a post written as `x/index.md`, which gets the folder's other files next to it |
| `lang` and `i18n_dir` | Not yet: folders per language work with directory data, but there's no translation lookup |

## Themes and helpers

Nunjucks templates render with Nunjucks (ssqch's fork of it), the library Hexo's Nunjucks renderer uses, so most theme code works. Three things Hexo's Nunjucks does that ssqch's doesn't:

- **No escaping.** Hexo's Nunjucks has `autoescape` off, so themes print helpers' HTML and `page.content` without `| safe`. In ssqch, `.njk` always escapes: add `| safe` where a value is HTML, or have the config's filter return `safe(html)`.
- **`page` is the page's data.** Hexo's `page.title` is ssqch's `title`, and `page.lang`, `page.layout` and `page.comments` are top-level names. `page` in ssqch is the URL, the dates and the file. A global data value named `page` never reaches a page, and the build warns about it.
- **Layouts wrap through `body`.** Hexo renders `post.njk`, then `layout.njk` around it as `{{ body }}`. In ssqch, `post.njk` has `layout: layout.njk` in its front matter, and `layout.njk` prints `{{ content | safe }}`.

The other differences that come up:

| Hexo | SiteSquatch |
| --- | --- |
| `layout/layout.njk` wraps every layout through `body` | A layout chain: `post.njk` has `layout: layout.njk` in its front matter and prints `{{ content \| safe }}` |
| `partial('_partial/header', { ... })` | `{% include "_partial/header.njk" %}`, or a macro for a partial that takes arguments |
| `page.title`, `page.content`, `page.date` | `title`, `content` and `page.date`: front matter is at the top level, and `page` has the URL, the date and the file's details |
| `site.posts`, `site.pages`, `site.tags` | `collections.posts`, `collections.all`, and one collection per tag. Collections are oldest first: `collections.posts \| reverse`. |
| `url_for(path)`, `relative_url` | The path itself; with `base` set, ssqch adds it to links in the HTML (`relative_url` works, and gives the path back as it is) |
| `full_url_for(path)` | `absoluteUrl(path, config.url)`, a template function on every site, with the site's `base` in front |
| `date(post.date, "YYYY-MM-DD")` (Moment formats) | `post.date \| dateformat("%Y-%m-%d")`, or a config filter that uses luxon or date-fns from `node_modules` |
| `css('css/style')`, `js('js/app')` | Plain `<link>` and `<script>` tags |
| `is_home()`, `is_post()`, `is_current(path)` | Compare `page.url`, or set a flag in each layout's front matter |
| `toc(page.content)` | `toc(page.headings)` in a layout |
| `paginator(...)` | `pagination.href.previous`, `pagination.href.next` and `pagination.hrefs` |
| `list_categories()`, `tagcloud()`, `list_archives()` | A loop over a collection built in the config |
| `strip_html`, `truncate`, `titlecase`, `markdown(text)` | `striptags`, `truncate`, `title` and `markdown(text)` |
| `__('key')`, `_p('key', n)`, the theme's `languages/*.yml` | `readData()` each file into an object by language, and a `__` filter: `function (key) { return strings[this.data.lang]?.[key] ?? strings.en[key] ?? key; }` |
| Helpers in `scripts/*.js` (`hexo.extend.helper.register`) | `filters` in the config. The function bodies usually move over unchanged; `this.page` becomes an argument. |
| Generators (`hexo.extend.generator.register`) | Pagination over data or a collection, with a `permalink` per page |
| EJS, Pug or Swig themes | EJS renders as it is: add `"ejs"` to `templateFormats`. For Pug or Swig, rewrite the theme in Nunjucks (Swig is close already), or give ssqch an engine of your own, `engines: { pug: (source, data) => pug.render(source, data) }`: ssqch runs on Node, so the package runs as it does in Hexo. |

## Tag plugins

Hexo's tags take arguments separated by spaces, without quotes (`{% note info A title %}`, `{% codeblock lang:js %}`), which Nunjucks reads as variables, and Hexo runs them before Markdown, outside code blocks and `{% raw %}`. ssqch doesn't read that syntax as it's written. Two ways to move them:

- Rewrite them once with quotes and commas (`{% note "info", "A title" %}`): a config filter is also a tag in Nunjucks, so the function moves into `filters`, and `markdownEngine: "njk"` runs the tags in posts.
- Or keep them as written: `markdownEngine: false` and a `markdown.preprocess` function that turns each tag into Markdown or HTML (a block tag into a container, `{% codeblock lang:js %}` into a fence, `{% youtube id %}` into its `<iframe>`). Skip fences and code spans: a page that shows tag syntax has it in code.

Count the tags that really run from the built HTML, not the source: a docs site's examples of tags are in code. `ssqch scout` counts the ones outside code.

| Hexo | SiteSquatch |
| --- | --- |
| `{% youtube id %}`, `{% vimeo id %}` | `filters: { youtube: (id) => '<iframe ...>' }`, called the same way. Arguments are comma-separated and strings are quoted: `{% youtube "dQw4w9WgXcQ" %}`. |
| `{% note info %}...{% endnote %}` | `filters: { note: (content, kind) => ... }` with `{% note "info" %}...{% endnote %}`, or a `::: note` container in Markdown |
| `{% codeblock lang:js %}...{% endcodeblock %}` | A fenced code block |
| `{% blockquote Author %}...{% endblockquote %}`, `{% pullquote %}` | A filter with a closing tag, or a container |
| `{% post_link slug %}`, `{% asset_path %}`, `{% asset_img %}` | A link to the post's URL; with `bundles: true`, assets are relative paths |
| `{% raw %}...{% endraw %}` | The same |

Posts that show `{{ }}` or `{% %}` in code samples need `{% raw %}` around them once Markdown runs through Nunjucks, or `render: md` in their front matter to skip it.

## Checking the move

Build with Hexo and with ssqch, then compare:

```sh
ssqch diff public-hexo public
```

It lists the URLs that were added and removed, and what changed on each page. Hexo and ssqch escape and wrap a few things differently, so expect markup-only differences at first; `--ignore <regex>` hides the ones you've accepted. `linksPlugin()` catches posts whose URLs moved.

## Reference builds of a Hexo site

Hexo dates a page with no `date` by its file's `ctime`, and a post by its `birthtime`. `ssqch baseline` pins every file's modification time, but no program can set a file's `ctime`, so every undated page of a Hexo build carries the time of the copy it was built in, and the builds differ on every such page. A preload that reports `ctime` and `birthtime` as the modification time pins them:

```js
// pin-ctime.cjs, beside the site
const fs = require("node:fs");
const pin = (s) => {
  if (s?.mtime) for (const k of ["ctime", "birthtime"]) Object.defineProperty(s, k, { value: new Date(s.mtime), configurable: true });
  return s;
};
for (const name of ["stat", "lstat", "fstat"]) {
  const callback = fs[name], sync = fs[`${name}Sync`], promised = fs.promises[name];
  fs[name] = (...args) => { const done = args.pop(); return callback(...args, (e, s) => done(e, pin(s))); };
  fs[`${name}Sync`] = (...args) => pin(sync(...args));
  if (promised) fs.promises[name] = async (...args) => pin(await promised(...args));
}
```

```sh
ssqch baseline "NODE_OPTIONS=--require=$PWD/pin-ctime.cjs npx hexo generate" --from public
```

What still differs between Hexo's own builds is order: Hexo loads files in parallel, so a list sorted by a value that ties (hexo-generator-sitemap sorts by `updated` alone, and a checkout writes many files in the same millisecond), or not sorted at all, comes out in another order each time. `ssqch baseline --runs 20` shows which files those are; compare them with their lines sorted.
