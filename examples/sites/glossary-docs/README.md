# glossary-docs

Documentation with a glossary, in Nunjucks. Distilled from [kubernetes.io](https://kubernetes.io), which is built with Hugo.

What it shows:

- A headless glossary: each term is a file in `glossary/` with `permalink: false`, so it has no page of its own but is in `collections.glossary`. The glossary page lists them all, and a `term()` macro (`_includes/macros.njk`) turns a term's id into a link with its short definition as a tooltip, in any doc.
- Callouts as containers: `::: caution` renders `_includes/containers/caution.njk`, and GitHub's `> [!NOTE]` alerts use `containers/note.njk`.
- A generated `_redirects` for Netlify: docs that moved list their old URLs in `aliases`, and `redirectsPlugin({ netlify: true, pages: false })` writes the rules (the link checker follows them).
- A table of contents from `page.headings`, and a sitemap.

Build it with `ssqch build`.
