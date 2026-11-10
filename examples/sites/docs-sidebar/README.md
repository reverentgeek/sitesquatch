# docs-sidebar

A documentation site, in Nunjucks. Distilled from [hexo.io](https://hexo.io) (Hexo) and the [FastAPI docs](https://fastapi.tiangolo.com) (MkDocs).

What it shows:

- A sidebar with sections from `_data/nav.yml`, the current page marked, and previous and next links in the order the nav lists them (`navPager` in `ssqch.config.js`).
- A table of contents for each page from `page.headings` and the `toc` filter, and anchor links on headings from a render hook.
- Code samples kept as real files in `_includes/samples/` and included into fences, so they can be linted and tested, with build-time highlighting.
- Admonitions: `::: tip`, `::: warning` and `::: details` containers, and GitHub-style `> [!NOTE]` alerts.

Not yet: client-side search (Pagefind is planned for ssqch's docs features).

Build it with `ssqch build`.
