# Moving from MkDocs

MkDocs and SiteSquatch both build a site from a folder of Markdown and one config file. MkDocs' theme templates are Jinja, which ssqch renders as it is (`.jinja` files), so a custom theme or `overrides/` folder ports with few changes; Material for MkDocs' features map onto containers, hooks and the navigation helpers.

The [`docs-sidebar`](../../examples/sites/docs-sidebar/) example is distilled from the FastAPI docs (and hexo.io): a sidebar from a YAML nav, a table of contents, admonitions, code from files and Pagefind search.

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
| `admonition`: `!!! note "Title"` and an indented body | A container: `::: note Title` ... `:::` (`_includes/containers/note.*`). GitHub's `> [!NOTE]` works too. |
| `pymdownx.details`: `??? note` | A container whose template writes `<details>` (see `docs-sidebar`'s `details` container) |
| `pymdownx.tabbed`: `=== "Tab"` | `:::: tabs` holding `::: tab Name` containers (see `versioned-docs`) |
| `pymdownx.superfences` custom fences (`mermaid`) | A `fence-mermaid` hook |
| `pymdownx.highlight`, `hl_lines="2 3"` | `markdown: { highlight: true }`, with `{2,3}` in the fence's info string |
| `pymdownx.snippets`: `--8<-- "file.py"` | `{% include "samples/file.py" %}` inside the fence |
| `toc` with `permalink: true` | Heading ids are built in; a heading hook adds the permalink. `toc(page.headings)` builds the table of contents. |
| `attr_list`: `## Title { #id }` | `## Title {#id}` |
| `footnotes`, `tables` | Built in |
| `def_list` | `markdown: { definitionLists: true }` |
| `md_in_html` (`markdown="1"`) | The `markdown` filter, or a container |
| `pymdownx.emoji` (`:smile:`) | Not built in; write the emoji |

## Pages

Front matter (`title`, `description`, and anything else) is the same YAML. MkDocs reads a page's title from its first heading when there's no `title`; in ssqch, give each page a `title` or use `page.headings[0].text` in the layout. A schema makes the first a rule: `schemas: { docs: { files: "docs/**/*.md", fields: { title: "string" } } }` fails the build for a page without one.

`ssqch init --starter docs` creates a docs site with a sidebar from `nav.yml`, a table of contents, notes, tabs and search, to move your pages into. To check the move, build both sites and run `ssqch diff site dist`.
