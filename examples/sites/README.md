# Example sites

Small, complete sites, each distilled from a real one and written against a feature of ssqch, so each doubles as that feature's test. `crates/ssqch/tests/examples.rs` builds every one with the link checker on, and `.github/workflows/examples.yml` deploys them to Netlify.

| Example | Engine | Shows | Live |
| --- | --- | --- | --- |
| [`blog-tags`](blog-tags/) | Nunjucks | Two sections, dated permalinks, tag pages with a feed each, aliases, footnotes, highlighting | blog-tags.sitesquatch.dev (soon) |
| [`blog-categories`](blog-categories/) | Nunjucks | Category pages from a custom collection, reading time, excerpts, an Atom feed, a site chosen by an environment variable | blog-categories.sitesquatch.dev (soon) |
| [`docs-sidebar`](docs-sidebar/) | Nunjucks | A sidebar and previous/next from `_data/nav.yml`, a table of contents, code samples from files, admonitions | docs-sidebar.sitesquatch.dev (soon) |
| [`glossary-docs`](glossary-docs/) | Nunjucks | A headless glossary with tooltips, callout containers, a generated `_redirects` | glossary-docs.sitesquatch.dev (soon) |

To try one, copy its folder and run `ssqch serve` in it.
