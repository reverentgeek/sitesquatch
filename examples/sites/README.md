# Example sites

Small, complete sites, each distilled from a real one and written against a feature of ssqch, so each doubles as that feature's test. `crates/ssqch/tests/examples.rs` builds every one with the link checker on, and `.github/workflows/examples.yml` deploys them to Netlify.

| Example | Engine | Shows | Live |
| --- | --- | --- | --- |
| [`blog-tags`](blog-tags/) | Nunjucks | Two sections, dated permalinks, tag pages with a feed each, aliases, footnotes, highlighting | blog-tags.sitesquatch.dev (soon) |
| [`blog-categories`](blog-categories/) | Nunjucks | Category pages from a custom collection, reading time, excerpts, an Atom feed, a site chosen by an environment variable | blog-categories.sitesquatch.dev (soon) |
| [`docs-sidebar`](docs-sidebar/) | Nunjucks | A sidebar, breadcrumbs and previous/next from `_data/nav.yml`, a table of contents, code samples from files, admonitions, Pagefind search | docs-sidebar.sitesquatch.dev (soon) |
| [`glossary-docs`](glossary-docs/) | Nunjucks | A headless glossary with tooltips, callout containers, a generated `_redirects` | glossary-docs.sitesquatch.dev (soon) |
| [`versioned-docs`](versioned-docs/) | Edge | Versions as folders with their own sidebars, a version switcher, tabs from containers, a blog with authors | versioned-docs.sitesquatch.dev (soon) |
| [`component-docs`](component-docs/) | Edge | Edge components in place of MDX, live examples with highlighted source, Sass variables read from the source, `ssqch/sass` | component-docs.sitesquatch.dev (soon) |
| [`islands`](islands/) | Edge | Custom elements whose scripts load only on the pages that use them, some when idle or visible, each with a fallback | islands.sitesquatch.dev (soon) |
| [`reference-pages`](reference-pages/) | Handlebars | One page per option, generated from a JSON schema, grouped by category | reference-pages.sitesquatch.dev (soon) |

To try one, copy its folder and run `ssqch serve` in it.
