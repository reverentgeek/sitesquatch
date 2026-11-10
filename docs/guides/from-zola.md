# Moving from Zola

Zola and SiteSquatch are both single Rust binaries, so the move is mostly about templates: Tera becomes Nunjucks or Jinja (minijinja, which reads almost the same), and `config.toml` becomes `ssqch.config.js`. Your content can stay as it is: SiteSquatch reads TOML front matter between `+++` lines.

blog.rust-lang.org was ported this way as a trial: all of its URLs and most pages came out the same. The [`blog-tags`](../../examples/sites/blog-tags/) example is a small blog laid out like a Zola site (sections, tags with feeds, aliases, highlighting), distilled from blog.rust-lang.org.

## The config

| Zola (`config.toml`) | SiteSquatch (`ssqch.config.js`) |
| --- | --- |
| `base_url` | Data: `data: { site: { url: "https://example.com" } }`, then `{{ site.url }}` |
| `title`, `description`, `[extra]` | The same `site` data, or `_data/site.toml` (TOML data files work) |
| `highlight_code = true`, `highlight_theme` | `markdown: { highlight: true }`. Colors come from `/highlight.css` and its `--hl-*` properties instead of a theme name. |
| `generate_feeds = true` | `rssPlugin()` from `ssqch/rss`, plus a feed template (see `blog-tags/src/feed.njk`) |
| `taxonomies = [{ name = "tags", feed = true }]` | Tags are built in: `tags: [...]` in front matter, `collections.<tag>` in templates. Tag pages and per-tag feeds are a template paginated over the tag list. |
| Automatic `sitemap.xml` | `sitemapPlugin({ url })` from `ssqch/sitemap` |
| `insert_anchor_links` | A heading render hook: `_includes/hooks/heading.njk` |
| `slugify` settings (Zola's default anchors) | `markdown: { headingIds: "ascii" }`, which transliterates the same way (`🦀` is `crab`) |
| `compile_sass` | Not built in yet; run Sass before `ssqch build` |
| `build_search_index` | Not built in yet |
| `zola check` | `linksPlugin()` checks internal links and anchors on every build. External links aren't checked. |

## Content

| Zola | SiteSquatch |
| --- | --- |
| `content/blog/_index.md` (a section) | A folder with directory data, `blog/blog.json` (layout, tags, permalink), and an `index` page that lists its posts |
| `content/blog/post/index.md` with images (a page bundle) | The same, with `bundles: true` in the config |
| `+++` TOML front matter | Works as is |
| `title`, `date`, `description` | The same names |
| `draft = true` | The same: built by `ssqch serve`, left out of `ssqch build` |
| `aliases = ["2019/05/15/post.html"]` | The same, with `redirectsPlugin()` from `ssqch/redirects`. Without a leading `/`, an alias is still from the site's root, and old URLs keep their `#fragment`. |
| `slug`, `path` | `permalink`, which can use data: `permalink: "/blog/{{ page.date \| datePath }}/{{ page.fileSlug }}/"` |
| `weight` | Any field; sort by it in a custom collection |
| `[taxonomies]` `tags = [...]` | `tags = [...]` at the top level of the front matter |
| `[extra]` fields | Stay where they are: `{{ extra.subtitle }}` |
| No `date`, with the date in `path` | `computed: { date: (data) => ... }` in a directory data file (`content/content.data.js`); a computed date is the page's date |
| `_index.md` section front matter | A data file (`_data/sections.json`), and `ignore: ["**/_index.md"]` |
| `<!-- more -->` summaries | The same: `page.excerpt` is the HTML before it |
| Internal links (`@/blog/post.md`) | URL paths (`/blog/2024/01/15/post/`); the link checker catches mistakes |
| Footnotes | Built in |

## Templates

Use `.njk` (Nunjucks) or `.jinja` files and set `markdownEngine` to the same, so shortcode calls in Markdown keep working as macros.

| Tera | Nunjucks in SiteSquatch |
| --- | --- |
| `{% extends "base.html" %}`, `{% block %}` | The same. Layouts can also use `layout:` front matter with `{{ content \| safe }}`. |
| `{{ page.title }}`, `{{ page.content \| safe }}` | `{{ title }}`, `{{ content \| safe }}`: a page's data is at the top level |
| `{{ section.pages }}` | `collections.<name>`: a tag, or a custom collection from `collections` in the config |
| `{{ get_url(path="...") }}` | The plain path |
| `get_page(path="...")` | Look the page up in a collection |
| `{{ page.date \| date(format="%Y") }}` | A config filter: `filters: { year: d => d.getUTCFullYear() }` |
| `{{ page.toc }}` | `{{ toc(page.headings) \| safe }}`, in the layout |
| `{{ page.reading_time }}` | `{{ readingTime(content) }}` |
| Macros (`{% import "macros.html" as m %}`) | The same; add `with context` if the macro reads page data or collections |
| Shortcodes (`{{ youtube(id="x") }}`) | Macros in an include, imported where they're used, or a config filter |
| Body shortcodes (`{% note() %}...{% end %}`) | Containers: `::: note` renders `_includes/containers/note.njk` with the body as `container.content` |

Config filters are JavaScript functions with positional arguments: Tera's `date(format="%Y")` becomes `date("%Y")`.

## What's missing

Sass, a search index, translations and external link checking aren't built in yet; they're planned (see `TODO.md`). Until then, Sass and Pagefind run fine before and after `ssqch build` in the same build command.
