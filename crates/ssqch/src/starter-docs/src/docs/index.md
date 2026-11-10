---
title: Introduction
description: What's in this starter, and where things live.
---
Welcome! This is a documentation site built with [SiteSquatch](https://github.com/reverentgeek/sitesquatch). It's yours to change: every file is in this folder, and there's no theme to fight.

## Where things live

| Path | What it is |
| --- | --- |
| `src/docs/` | The pages, in Markdown. A folder is a section of the URL. |
| `src/_data/nav.yml` | The sidebar, which also gives each page its breadcrumbs and previous and next links. |
| `src/_data/site.json` | The site's name and description. |
| `src/_includes/` | The layouts (`base.edge`, `doc.edge`), and the templates behind headings, tabs and details. |
| `src/assets/` | The stylesheet, and a small script for tabs and search. |
| `ssqch.config.js` | The config: highlighting, the link checker, the schema for front matter. |

## Add a page

1. Create `src/docs/guides/my-page.md` with a `title` in its front matter.
2. List it in `src/_data/nav.yml`.

That's it. Run `ssqch serve` and it's at `/docs/guides/my-page/`.

Next: [install ssqch](/docs/install/), or see [what a page can do](/docs/guides/writing/).
