---
title: "Trailhead: moving from MkDocs"
navTitle: "From MkDocs"
description: "MkDocs and SiteSquatch both build a site from a folder of Markdown and one config file."
---
MkDocs and SiteSquatch both build a site from a folder of Markdown and one config file. MkDocs' theme templates are Jinja, which ssqch renders with Jinja's filters, tests and methods on a fork of Nunjucks (`.jinja` files), so a custom theme or `overrides/` folder ports with few changes ([Jinja and Nunjucks](../template-languages.md#jinja-and-nunjucks) lists where Nunjucks isn't Jinja: a `{% set %}` inside a loop keeps its value, and there is no `{% break %}`); Material for MkDocs' features map onto containers, hooks and the navigation helpers.

The [`docs-sidebar`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/docs-sidebar/) example is distilled from the FastAPI docs (and hexo.io): a sidebar from a YAML nav, a table of contents, admonitions, code from files and Pagefind search.

## Scouting

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: `ssqch scout` for MkDocs sites, and the `admonitions`, `tabs`, `sourceLinks`, `headingIds: "python-markdown"` and `highlight: { classes: "pygments" }` Markdown options.

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) reads `mkdocs.yml` and the pages: each plugin and Markdown extension with ssqch's way to do it, and the MkDocs syntax the pages use, counted (links to `.md` files, admonitions, tabs, snippets, icons). Its draft (`--write-draft`) is an `ssqch.config.js` that reads the pages as MkDocs writes them, with no page changed, and the nav as `_data/nav.yml` (titles from the nav, or each page's first heading). On Material for MkDocs' own docs, the draft built every page from a fresh checkout:

```js
export default defineConfig({
  dirs: { input: "docs", output: "site", includes: "../_includes", data: "../_data" },
  base: "/mkdocs-material/",   // site_url's path
  markdownEngine: false,       // MkDocs doesn't run template code in pages
  markdown: { admonitions: "mkdocs", tabs: "mkdocs", sourceLinks: "relative", headingIds: "python-markdown", highlight: { classes: "pygments" } },
  passthrough: [{ "docs/**/*.png": "." }],   // MkDocs copies the docs folder's other files
  plugins: [sitemapPlugin({ url: "https://squidfunk.github.io/mkdocs-material" }), redirectsPlugin({ redirects: { "/old/": "/new/" } }), linksPlugin()],
});
```

## The config

| `mkdocs.yml` | `ssqch.config.js` |
| --- | --- |
| `docs_dir`, `site_dir` | `dirs: { input, output }` |
| `nav:` | `_data/nav.yml`, in the shape the nav helpers read: `- { title: Install, url: /install/ }`, with sections holding `children` (or `items`, `pages`). `navTree(nav, page.url)` marks the current page and its sections, `navPager` gives previous and next, `navBreadcrumbs` the trail. |
| `theme: material` and its options | Templates of your own (start from `docs-sidebar`) |
| `theme.custom_dir` / `overrides/` (Jinja) | `.jinja` templates in `_includes`; `{% extends %}`, blocks and macros work |
| `extra:` | `_data/site.yml` |
| `use_directory_urls: true` | The default: `install.md` is `/install/` |
| `plugins: [search]` | [Pagefind](https://pagefind.app) after the build: `afterBuild: { run: "npx -y pagefind --site dist" }` |
| `mkdocs-redirects` | `redirectsPlugin({ redirects })` from `ssqch/redirects`, or `aliases` on each page |
| `git-revision-date-localized` | `lastModified: "git"`, then `page.lastModified` |
| `mkdocs-macros` (Jinja in Markdown) | Built in: Markdown runs through Jinja first (`markdownEngine: "jinja"`, the default) |
| `extra_css` with Sass | `sassPlugin()` from `ssqch/sass` |
| `strict: true` | `linksPlugin()` for broken links, and `strict: true` for undefined template values |

## Markdown extensions

| Python-Markdown / PyMdown | SiteSquatch |
| --- | --- |
| `admonition`: `!!! note "Title"` and an indented body | `markdown: { admonitions: "mkdocs" }` reads them as they are, and writes Python-Markdown's markup (`<div class="admonition note">`), which Material's CSS styles. Or, in ssqch's own syntax, a container: `::: note Title` ... `:::`. GitHub's `> [!NOTE]` works too. |
| `pymdownx.details`: `??? note` | `admonitions: "mkdocs"` too: `<details class="note">`, open with `???+`. Or a container whose template writes `<details>` (see `docs-sidebar`'s `details` container) |
| `pymdownx.tabbed`: `=== "Tab"` | `markdown: { tabs: "mkdocs" }` reads them as they are, in the alternate style's markup. Or `:::: tabs` holding `::: tab Name` containers (see `versioned-docs`) |
| `pymdownx.superfences` custom fences (`mermaid`) | A `fence-mermaid` hook |
| `pymdownx.highlight`, `hl_lines="2 3"` | `markdown: { highlight: { classes: "pygments" } }`, with Pygments' class names for the theme's CSS, and `{2,3}` in the fence's info string |
| `pymdownx.snippets`: `--8<-- "file.py"` | `{% include "samples/file.py" %}` inside the fence |
| `toc` with `permalink: true` | `markdown: { headingIds: "python-markdown" }` gives toc's default ids (a repeated heading gets `-1`, not `_1`); a heading hook adds the permalink. `toc(page.headings)` builds the table of contents. |
| `attr_list`: `## Title { #id }` | `## Title {#id}` |
| Links to other pages' `.md` files | `markdown: { sourceLinks: "relative" }`: each goes to that page's URL, written from the page as MkDocs writes it, and images and other files are read from the Markdown file's folder too |
| `footnotes`, `tables` | Built in |
| `def_list` | `markdown: { definitionLists: true }` |
| `md_in_html` (`markdown="1"`) | The `markdown` filter, or a container |
| `pymdownx.emoji` (`:smile:`) | Not built in; write the emoji |

## Pages

Front matter (`title`, `description`, and anything else) is the same YAML. MkDocs reads a page's title from its first heading when there's no `title`; in ssqch, give each page a `title` or use `page.headings[0].text` in the layout. A schema makes the first a rule: `schemas: { docs: { files: "docs/**/*.md", fields: { title: "string" } } }` fails the build for a page without one.

`ssqch init --starter docs` creates a docs site with a sidebar from `nav.yml`, a table of contents, notes, tabs and search, to move your pages into. To check the move, build both sites and run `ssqch diff site dist`.
