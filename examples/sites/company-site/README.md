# company-site

The marketing site of Squatch Snacks, a trail-snack company in Bend, Oregon, in Jinja and plain CSS. It has what a company's site needs: a home page with a hero, featured products, testimonials and questions; a page per product from one data file; pricing with a monthly and yearly switch; a contact form; careers with a page per opening; the legal pages; and what search engines, link previews, hosts and agents read.

What it shows:

- Product pages from data: `src/provisions/snack.jinja` paginates over `src/_data/snacks.json` into `/provisions/<slug>/`, and `snack.data.js` beside it gives each page its title, description, link-preview picture and Product structured data. The pages are tagged `snack` (with `addAllPagesToCollections`), so the `snack` schema in `ssqch.config.js` checks all six: a snack without a `price` or an `image` fails the build, and the error names it: item 4 of snacks, "Moss Mix", `snack.price` is required.
- Job openings from Markdown: `src/careers/jobs/*.md`, with their layout and tag from directory data (`jobs.data.js`), checked by the `jobs` schema (`type` is one of three values, `picture` is a file that's there, and a field the schema doesn't have is an error). `ssqch new careers/jobs --title "Trail Cook"` starts one from the blueprint, `src/_blueprints/careers/jobs.md`, whose comments say what goes on each line.
- A custom element with a fallback: `<price-toggle>` on the pricing page (`src/elements/price-toggle.js` and its `.css`) adds a monthly/yearly switch. `elementsPlugin()` loads it on that page only, and without JavaScript the element is never defined, so both prices show as written ("$12 a month, or $120 a year").
- Components: `<Section>`, `<Card>`, `<Button>` and `<Testimonial>` in `src/_includes/components/`, written as tags in any page.
- A contact form and a sign-up form as Netlify Forms (`data-netlify`, a `bot-field` honeypot), with a thank-you page (`src/thanks.jinja`) left out of the sitemap and `llms.txt`.
- The legal pages, `src/privacy.md` and `src/terms.md`, show "Last changed" from `page.lastModified` (`lastModified: "git"`: the last commit to the file).
- Search engines and link previews: `src/_includes/seo.jinja` writes the title, the description, the canonical address, Open Graph tags with a picture from `imageUrl()`, and the company's Organization structured data; the home page adds its questions as FAQPage (`src/index.data.js`). Whole addresses come from `absoluteUrl()` (`rssPlugin()`) in templates, and from `ssqch.base` and `site.url` in `snack.data.js`, so they're right under a base too.
- Pictures: `imagePlugin()` makes AVIF, WebP and JPEG copies at several widths of every `<img>`, the snack page preloads its picture (`ssqch:preload`), and the hero has another crop on a phone, from the `crop` filter in the config.
- The host's files as templates: `src/_headers.jinja` (long caching for fingerprinted files, security headers) and `src/_redirects.jinja` (a short `/go/` address for each snack with a `goLink`, and the old `/snacks/` addresses).
- Plain CSS with no build step: `src/assets/site.css`, with the design's values as custom properties on `:root`, a dark look, and class names that say what a thing is. `assetsPlugin()` fingerprints it and the element's files in a production build.
- For agents and crawlers: `sitemapPlugin()`, `robotsPlugin()` (no AI training; AI search and fetching allowed), and `llmsPlugin()`'s `llms.txt` and a Markdown copy of each page. `ssqch patrol` checks them after a build.

Build it with `ssqch build`, and check it with `ssqch patrol`. `strict: true` makes a misspelled value in a template an error that names it, and `linksPlugin()` fails the build on a broken link.
