---
title: "Trailhead: moving from MkDocs"
navTitle: "From MkDocs"
description: "MkDocs and SiteSquatch both build a site from a folder of Markdown and one config file."
---
MkDocs and SiteSquatch both build a site from a folder of Markdown and one config file. MkDocs' theme templates are Jinja, which ssqch renders with Jinja's filters, tests and methods on a fork of Nunjucks (`.jinja` files), so a custom theme or `overrides/` folder ports with few changes ([Jinja and Nunjucks](../template-languages.md#jinja-and-nunjucks) lists where Nunjucks isn't Jinja: a `{% set %}` inside a loop keeps its value, and there is no `{% break %}`); Material for MkDocs' features map onto containers, hooks and the navigation helpers.

The [`docs-sidebar`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/docs-sidebar/) example is distilled from the FastAPI docs (and hexo.io): a sidebar from a YAML nav, a table of contents, admonitions, code from files and Pagefind search.

## Scouting

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) reads `mkdocs.yml` and the pages: each plugin and Markdown extension with ssqch's way to do it, and the MkDocs syntax the pages use, counted (links to `.md` files, admonitions, tabs, snippets, icons, mkautodoc's and mkdocstrings' `:::` blocks), and what MkDocs writes on its own (`search/search_index.json`, `404.html`, `sitemap.xml.gz`). Its reference build names the Python environment MkDocs needs (`pip install -r requirements.txt`, and a `.venv`'s `mkdocs` when there is one). Its draft (`--write-draft`) is an `ssqch.config.js` that reads the pages as MkDocs writes them, with no page changed, and the nav as `_data/nav.yml` (titles from the nav, or each page's first heading). On Material for MkDocs' own docs, the draft built every page from a fresh checkout:

```js
export default defineConfig({
  dirs: { input: "docs", output: "site", includes: "../_includes", data: "../_data" },
  base: "/mkdocs-material/",   // site_url's path
  markdownEngine: false,       // MkDocs doesn't run template code in pages
  markdown: { highlight: { classes: "pygments" } },
  passthrough: [{ "docs/**/*.png": "." }, { "docs/CNAME": "CNAME" }],   // MkDocs copies the docs folder's other files
  // MkDocs warns about a broken link unless strict: true, and so does the draft.
  // MkDocs' Markdown: Python-Markdown's reading, admonitions, tabs, toc's ids, `.md` links.
  plugins: [fromMkdocs(), sitemapPlugin({ url: "https://squidfunk.github.io/mkdocs-material" }), redirectsPlugin({ redirects: { "/old/": "/new/" } }), linksPlugin({ fail: false })],
});
```

`fromMkdocs()` from `ssqch/from-mkdocs` is MkDocs' Markdown as one plugin, each part a default your own `markdown` can change: `dialect: "python-markdown"` (a raw HTML block runs to its closing tag, lists nest at four spaces), `admonitions` and `tabs` as Material writes them, toc's heading ids (`headingIds: "python-markdown"`) and `.md` links from the page (`sourceLinks: "relative"`). `fromMkdocs({ templates: true, config: "mkdocs.yml" })` adds the theme's context, below.

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: `fromMkdocs()`. In 0.12.0, write its parts as options: `markdown: { dialect: "python-markdown", admonitions: "mkdocs", tabs: "mkdocs", headingIds: "python-markdown", sourceLinks: "relative" }`, and `mkdocsTemplates: true` for `templates`.

## The theme

`fromMkdocs({ templates: true })` gives templates what MkDocs gives a theme's, so the theme's Jinja templates, Material for MkDocs' included, run as they're written: `config` (`mkdocs.yml`, with the theme's `mkdocs_theme.yml` under its `theme`), `nav` (MkDocs' Sections, Pages and Links, with `active` on the page being rendered), `page` (MkDocs' page, with `content`, `toc`, `meta`, `previous_page` and `next_page`), `base_url`, and the `url` and `script_tag` filters, which make URLs relative to the page. Each Markdown page renders with the theme's `main.html` (or its front matter's `template`), the theme's `404.html` makes `/404.html`, and Jinja doesn't escape, as MkDocs' doesn't. `ssqch docs fromMkdocs` has the details.

A theme from pip is Python's, so copy its templates into an ssqch theme: the templates in `_includes`, the files to copy (`assets/`) beside it. For Material:

```sh
M=$(python -c "import material, os; print(os.path.dirname(material.__file__))")/templates
mkdir -p theme/_includes && cp -R "$M"/. theme/_includes/ && mv theme/_includes/assets theme/assets
```

```js
export default defineConfig({
  dirs: { input: "docs", output: "site", includes: "overrides" },   // theme.custom_dir, from docs_dir
  theme: "theme",
  markdownEngine: false,
  markdown: { highlight: { classes: "pygments" } },
  plugins: [fromMkdocs({ templates: true })],
});
```

On the httpx docs (Material, 24 pages), this config, with no template changed and no code of the site's own, built every page with Material's nav, table of contents, header and footer byte for byte as MkDocs wrote them; the differences left were highlighted code (Pygments' tokens), the two pages mkautodoc writes from Python, and the search index. What it doesn't do: MkDocs' plugins (Material's search index, `sitemap.xml.gz`, its blog and social cards), and Python's own code in hooks.

## The config

| `mkdocs.yml` | `ssqch.config.js` |
| --- | --- |
| `docs_dir`, `site_dir` | `dirs: { input, output }` |
| `nav:` | `_data/nav.yml`, in the shape the nav helpers read: `- { title: Install, url: /install/ }`, with sections holding `children` (or `items`, `pages`). `navTree(nav, page.url)` marks the current page and its sections, `navPager` gives previous and next, `navBreadcrumbs` the trail. |
| `theme: material` and its options | The theme's own templates with `fromMkdocs({ templates: true })` ([The theme](#the-theme), below), or templates of your own (start from `docs-sidebar`) |
| `theme.custom_dir` / `overrides/` (Jinja) | The includes folder (`dirs.includes`, which the draft sets to it): read before a theme's, so a template there replaces the theme's of the same name; `{% extends %}`, blocks and macros work |
| `extra:` | `_data/site.yml` |
| `use_directory_urls: true` | The default: `install.md` is `/install/` |
| `plugins: [search]` (on when `plugins` isn't set) | [Pagefind](https://pagefind.app) after the build: `afterBuild: { run: "npx -y pagefind --site dist" }`. Material's own search box reads MkDocs' `search/search_index.json`, which isn't in ssqch yet: a page that loops over `collections.all` can write it |
| `mkdocs-redirects` | `redirectsPlugin({ redirects })` from `ssqch/redirects`, or `aliases` on each page |
| `git-revision-date-localized` | `lastModified: "git"`, then `page.lastModified` |
| `mkdocs-macros` (Jinja in Markdown) | Built in: Markdown runs through Jinja first (`markdownEngine: "jinja"`, the default) |
| `extra_css` with Sass | `sassPlugin()` from `ssqch/sass` |
| `strict: true` | `linksPlugin()` fails the build on a broken link (`linksPlugin({ fail: false })` warns, as MkDocs does without `strict`), and `strict: true` for undefined template values |
| `404.html`, `sitemap.xml.gz` (written by MkDocs) | With `fromMkdocs({ templates: true })`, the theme's `404.html` makes `/404.html`; otherwise a page with `permalink: /404.html`. `sitemapPlugin()` writes `sitemap.xml`, and the gzipped copy is an `afterBuild` step (`node:zlib`) |

## Markdown extensions

| Python-Markdown / PyMdown | SiteSquatch |
| --- | --- |
| `admonition`: `!!! note "Title"` and an indented body | `fromMkdocs()` reads them as they are, and writes Python-Markdown's markup (`<div class="admonition note">`), which Material's CSS styles. Or, in ssqch's own syntax, a container: `::: note Title` ... `:::`. GitHub's `> [!NOTE]` works too. |
| `pymdownx.details`: `??? note` | `fromMkdocs()` too: `<details class="note">`, open with `???+`. Or a container whose template writes `<details>` (see `docs-sidebar`'s `details` container) |
| `pymdownx.tabbed`: `=== "Tab"` | `fromMkdocs()` reads them as they are, in the alternate style's markup. Or `:::: tabs` holding `::: tab Name` containers (see `versioned-docs`) |
| `pymdownx.superfences` custom fences (`mermaid`) | A `fence-mermaid` hook |
| `pymdownx.highlight`, `codehilite`, `hl_lines="2 3"` | `markdown: { highlight: { classes: "pygments" } }`, with Pygments' class names for the theme's CSS, and `{2,3}` in the fence's info string. The tokens are cut by ssqch's grammars, not Pygments', and the wrapper (`<div class="highlight"><pre><span></span><code>`) is a fence hook's (`_includes/hooks/fence.jinja`, which the draft writes), so the theme's styles fit, but not byte for byte |
| `mkautodoc`, `mkdocstrings` (`::: package.module`) | Not in ssqch yet: Python writes the API pages. Their `:::` lines would read as ssqch's containers, so set `markdown: { containers: false }` (the draft does), and render the pages with the extension in Python |
| `pymdownx.snippets`: `--8<-- "file.py"` | `{% include "samples/file.py" %}` inside the fence |
| `toc` with `permalink: true` | `fromMkdocs()` gives toc's default ids (`headingIds: "python-markdown"`) (a repeated heading gets `_1`, as toc writes it); a heading hook adds the permalink. `toc(page.headings)` builds the table of contents. |
| `attr_list`: `## Title { #id }` | `## Title {#id}` |
| Links to other pages' `.md` files | `fromMkdocs()` (`sourceLinks: "relative"`): each goes to that page's URL, written from the page as MkDocs writes it, and images and other files are read from the Markdown file's folder too |
| `footnotes`, `tables` | Built in |
| `def_list` | `markdown: { definitionLists: true }` |
| `md_in_html` (`markdown="1"`) | The `markdown` filter, or a container |
| `pymdownx.emoji` (`:smile:`) | Not built in; write the emoji |

> [!NOTE]
> **Byte for byte:** a move that has to match MkDocs' output exactly needs four things from Python today: Pygments for highlighted code (codehilite's markup and tokens), mkautodoc or mkdocstrings for API pages, Material's search indexer for `search/search_index.json`, and Python's gzip for `sitemap.xml.gz`. Run them once per build in `beforeBuild` or `afterBuild`. For the rest of Python-Markdown's ways (raw HTML blocks to their closing tag, lists nested at four spaces, `"` as it is in text, `<hr />`), set `markdown: { dialect: "python-markdown" }`. The fresh httpx move matched MkDocs byte for byte this way.

## Pages

Front matter (`title`, `description`, and anything else) is the same YAML. MkDocs reads a page's title from its first heading when there's no `title`; in ssqch, give each page a `title` or use `page.headings[0].text` in the layout. A schema makes the first a rule: `schemas: { docs: { files: "docs/**/*.md", fields: { title: "string" } } }` fails the build for a page without one.

`ssqch init --starter docs` creates a docs site with a sidebar from `nav.yml`, a table of contents, notes, tabs and search, to move your pages into. To check the move, build both sites and run `ssqch diff site dist`.
