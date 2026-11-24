# Example sites

Small, complete sites, each distilled from a real one and written against a feature of ssqch, so each doubles as that feature's test. The oracle builds every one with the link checker on (`tests/oracle/cli/examples.test.js`) and compares it with its frozen output (`tests/oracle/sites.test.js`). Each runs live on sitesquatch.dev, under its own path (`/examples/<name>/`): the site's build (`site/build.ts`) builds every one with `--base` into the site, so each is also a test of `base`.

| Example | Engine | Shows | Live |
| --- | --- | --- | --- |
| [`blog-tags`](blog-tags/) | Nunjucks | Two sections, dated permalinks, tag pages with a feed each, aliases, footnotes, highlighting | [sitesquatch.dev/examples/blog-tags/](https://sitesquatch.dev/examples/blog-tags/) |
| [`blog-categories`](blog-categories/) | Nunjucks | Category pages from a custom collection, reading time, excerpts, an Atom feed, a site chosen by an environment variable | [sitesquatch.dev/examples/blog-categories/](https://sitesquatch.dev/examples/blog-categories/) |
| [`docs-sidebar`](docs-sidebar/) | Nunjucks | A sidebar, breadcrumbs and previous/next from `_data/nav.yml`, a table of contents, code samples from files, admonitions, Pagefind search | [sitesquatch.dev/examples/docs-sidebar/](https://sitesquatch.dev/examples/docs-sidebar/) |
| [`glossary-docs`](glossary-docs/) | Nunjucks | A headless glossary with tooltips, callout containers, a generated `_redirects` | [sitesquatch.dev/examples/glossary-docs/](https://sitesquatch.dev/examples/glossary-docs/) |
| [`versioned-docs`](versioned-docs/) | Jinja | Versions as folders with their own sidebars, a version switcher, tabs from containers, a blog with authors | [sitesquatch.dev/examples/versioned-docs/](https://sitesquatch.dev/examples/versioned-docs/) |
| [`component-docs`](component-docs/) | Edge | Edge components in place of MDX, live examples with highlighted source, Sass variables read from the source, `ssqch/sass` | [sitesquatch.dev/examples/component-docs/](https://sitesquatch.dev/examples/component-docs/) |
| [`islands`](islands/) | Jinja | Custom elements whose scripts load only on the pages that use them, some when idle or visible, each with a fallback | [sitesquatch.dev/examples/islands/](https://sitesquatch.dev/examples/islands/) |
| [`jekyll-guides`](jekyll-guides/) | Liquid | A Jekyll site as it's laid out, with `jekyllTemplates`: Jekyll's `page` and `site`, `markdown="1"`, kramdown's heading ids, `{% highlight %}`, `{% link %}` and `{% post_url %}` | [sitesquatch.dev/examples/jekyll-guides/](https://sitesquatch.dev/examples/jekyll-guides/) |
| [`reference-pages`](reference-pages/) | Handlebars | One page per option, generated from a JSON schema, grouped by category | [sitesquatch.dev/examples/reference-pages/](https://sitesquatch.dev/examples/reference-pages/) |
| [`searchable-directory`](searchable-directory/) | EJS | A page per record from one data file, filters as a custom element with the choice in the address, Pagefind search of the records only | [sitesquatch.dev/examples/searchable-directory/](https://sitesquatch.dev/examples/searchable-directory/) |
| [`multilingual`](multilingual/) | Jinja | English and Spanish from a folder each, a language switch, hreflang and the sitemap's alternates, strings that fall back, a fallback page for one not translated yet | [sitesquatch.dev/examples/multilingual/](https://sitesquatch.dev/examples/multilingual/) |
| [`company-site`](company-site/) | Jinja | A company's marketing site: product pages from data checked by a schema, pricing with a custom element and a no-JS fallback, Netlify forms, careers from Markdown with a blueprint, SEO and structured data, responsive pictures, plain CSS | [sitesquatch.dev/examples/company-site/](https://sitesquatch.dev/examples/company-site/) |

To try one, copy its folder and run `ssqch serve` in it.
