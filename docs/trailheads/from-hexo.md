# Trailhead: moving from Hexo

Hexo sites are Markdown posts, a theme of templates (often Nunjucks, sometimes EJS or Pug) and tag plugins inside the posts. Nunjucks themes render in ssqch as they are, posts keep their front matter, and tag plugins become filters that keep the same `{% tag %}` syntax. What takes work is the theme's helpers and anything that leans on Hexo's `site` object.

The [`docs-sidebar`](../../examples/sites/docs-sidebar/) example is distilled from hexo.io (and the FastAPI docs), and [`blog-tags`](../../examples/sites/blog-tags/) shows a blog with tag pages and feeds.

## The config

`_config.yml` becomes `ssqch.config.js`. Keep the site's own values (`title`, `url`, `author`) where templates expect them by moving them to `src/_data/config.yml`, so `{{ config.title }}` still works.

| Hexo | SiteSquatch |
| --- | --- |
| `source_dir: source`, `public_dir: public` | `dirs: { input: "source", output: "public" }` |
| `themes/<name>/layout/` | `dirs: { includes: "_includes" }`, or keep the theme where it is as a [theme](../../README.md#themes): `theme: "themes/<name>"`, with its templates under `_includes/` |
| `themes/<name>/source/` (CSS, JS, images) | The theme folder's other files are copied as they are, or `passthrough` |
| `_config.yml` values in templates (`config.title`) | `src/_data/config.yml`: every file in `_data` is a template variable |
| `theme_config`, `themes/<name>/_config.yml` (`theme.menu`) | `src/_data/theme.yml` |
| `permalink: :year/:month/:day/:title/` | A `permalink` in the posts' directory data: `"/{{ page.date \| dateformat('%Y/%m/%d') }}/{{ page.fileSlug }}/"` |
| `new_post_name: :year-:month-:day-:title.md` | The same file names: a date at the start of a file name is the page's date |
| `root: /blog/` | `base: "/blog/"`. Links stay as written; `url_for()` isn't needed. |
| `per_page`, `pagination_dir` | `pagination: { data: collections.posts, size: 10 }` on the index template |
| `skip_render` | `passthrough`, or `ignore` |
| `highlight` / `prismjs` | `markdown: { highlight: true }`, at build time |
| `hexo-generator-feed` | A feed template with `rssPlugin()`'s filters (see `blog-tags`) |
| `hexo-generator-sitemap` | `sitemapPlugin({ url })` |
| `hexo-generator-alias` (`alias:` front matter) | `redirectsPlugin()` and `aliases` front matter |
| `hexo-generator-search`, a build-time lunr index | Pagefind after the build: `afterBuild: { run: "npx -y pagefind --site public" }` |
| `hexo-renderer-sass` / `stylus` | `sassPlugin()` from `ssqch/sass`. Stylus needs converting, or running as a `beforeBuild` command. |
| `hexo server` | `ssqch serve` |

## Posts and pages

| Hexo | SiteSquatch |
| --- | --- |
| `source/_posts/*.md` | The same folder, with a directory data file `source/_posts/_posts.json`: `{ "layout": "post.njk", "tags": "posts" }` plus the `permalink` above |
| `title`, `date`, `updated`, `tags`, `permalink` | The same. `tags` build `collections.<tag>`. |
| `categories` | A front matter list like any other; group pages by it in a custom collection (the `blog-categories` example) |
| `layout: false` | `layout: false`; `permalink: false` for a page that isn't written |
| `<!-- more -->` | The same: `page.excerpt` is the HTML before it |
| `source/_drafts/`, `published: false` | `draft: true` (built in development only) |
| `source/_data/*.yml` (`site.data.menu`) | `_data/menu.yml` is `{{ menu }}` |
| Post asset folders (`post_asset_folder`) | `bundles: true`: a post that's `my-post/index.md` gets the folder's other files next to it |
| `lang` and `i18n_dir` | Not yet: folders per language work with directory data, but there's no translation lookup |

## Themes and helpers

Nunjucks templates render with minijinja. Most theme code works; these are the differences that come up:

| Hexo | SiteSquatch |
| --- | --- |
| `layout/layout.njk` wraps every layout through `body` | A layout chain: `post.njk` has `layout: layout.njk` in its front matter and prints `{{ content \| safe }}` |
| `partial('_partial/header', { ... })` | `{% include "_partial/header.njk" %}`, or a macro for a partial that takes arguments |
| `page.title`, `page.content`, `page.date` | `title`, `content` and `page.date`: front matter is at the top level, and `page` has the URL, the date and the file's details |
| `site.posts`, `site.pages`, `site.tags` | `collections.posts`, `collections.all`, and one collection per tag. Collections are oldest first: `collections.posts \| reverse`. |
| `url_for(path)`, `relative_url` | The path itself; with `base` set, ssqch adds it to links in the HTML |
| `full_url_for(path)` | `absoluteUrl(path, config.url)` from `rssPlugin()` |
| `date(post.date, "YYYY-MM-DD")` (Moment formats) | `post.date \| dateformat("%Y-%m-%d")`, or a config filter that uses luxon or date-fns from `node_modules` |
| `css('css/style')`, `js('js/app')` | Plain `<link>` and `<script>` tags |
| `is_home()`, `is_post()`, `is_current(path)` | Compare `page.url`, or set a flag in each layout's front matter |
| `toc(page.content)` | `toc(page.headings)` in a layout |
| `paginator(...)` | `pagination.href.previous`, `pagination.href.next` and `pagination.hrefs` |
| `list_categories()`, `tagcloud()`, `list_archives()` | A loop over a collection built in the config |
| `strip_html`, `truncate`, `titlecase`, `markdown(text)` | `striptags`, `truncate`, `title` and `markdown(text)` |
| `__('key')`, `_p('key', n)` | A config filter over `_data/languages/<lang>.yml`: `t: (key) => strings[key] ?? key` |
| Helpers in `scripts/*.js` (`hexo.extend.helper.register`) | `filters` in the config. The function bodies usually move over unchanged; `this.page` becomes an argument. |
| Generators (`hexo.extend.generator.register`) | Pagination over data or a collection, with a `permalink` per page |
| EJS, Pug or Swig themes | Rewrite the theme in Nunjucks (Swig is close already). An engine of your own is possible too, `engines: { ejs: (source, data) => ejs.render(source, data) }`, if the package runs on ssqch's JavaScript engine (it isn't Node). |

## Tag plugins

A config filter is also a tag in Nunjucks, so most tag plugins port by moving their function into `filters` and setting `markdownEngine: "njk"` so tags in posts run:

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
