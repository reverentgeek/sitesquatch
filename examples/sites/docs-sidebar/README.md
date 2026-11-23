# docs-sidebar

A documentation site, in Nunjucks. Distilled from [hexo.io](https://hexo.io) (Hexo) and the [FastAPI docs](https://fastapi.tiangolo.com) (MkDocs).

What it shows:

- A sidebar with sections from `_data/nav.yml`, with the current page and its section marked (`navTree`), breadcrumbs (`navBreadcrumbs`), and previous and next links in the order the nav lists them (`navPager`).
- A table of contents for each page from `page.headings` and the `toc` filter, and anchor links on headings from a render hook.
- Code samples kept as real files in `_includes/samples/` and included into fences, so they can be linted and tested, with build-time highlighting.
- Admonitions: `::: tip`, `::: warning` and `::: details` containers, and GitHub-style `> [!NOTE]` alerts.

- Search with [Pagefind](https://pagefind.app): `SEARCH=1 ssqch build` runs `npx -y pagefind@1.6.0 --site dist` after the build (an `afterBuild` command), which indexes the pages' `<main>` into `/pagefind/`. The sidebar's search button (Pagefind's Component UI, which opens a search dialog; Ctrl+K or Cmd+K does too) works once the index is there: `ssqch serve --built` serves that build to try it.

Build it with `ssqch build`, or `SEARCH=1 ssqch build` (needs Node for `npx`) to add search.
