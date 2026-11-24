---
title: "Getting spotted: SEO tags"
description: "ssqch writes no <head> tags of its own, so a site's title, description, canonical link, Open Graph and Twitter tags are a partial in its layout."
---
ssqch writes no `<head>` tags of its own, so a site's title, description, canonical link, Open Graph and Twitter tags are a partial in its layout. A starting point (Nunjucks):

```njk
{# _includes/seo.njk #}
<title>{{ title ~ " · " ~ site.title if title else site.title }}</title>
<meta name="description" content="{{ description or site.description }}">
<link rel="canonical" href="{{ site.url ~ page.url }}">
<meta property="og:title" content="{{ title or site.title }}">
<meta property="og:description" content="{{ description or site.description }}">
<meta property="og:url" content="{{ site.url ~ page.url }}">
<meta property="og:image" content="{{ site.url ~ (image or "/og.png") }}">
<meta name="twitter:card" content="summary_large_image">
```

## Structured data (JSON-LD)

Structured data, the JSON-LD that search engines read for a company, a product or a page of questions, is a `json` (Liquid), `tojson` (Jinja) or `dump` (Nunjucks) of an object built in the template or by a filter. In Jinja, a company on every page and a product on its own page:

```jinja
<script type="application/ld+json">{{ {
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": site.title,
  "url": site.url,
  "logo": site.url ~ imageUrl("/img/logo.png", { width: 512 }).url
} | tojson }}</script>
{% if snack %}<script type="application/ld+json">{{ {
  "@context": "https://schema.org",
  "@type": "Product",
  "name": snack.name,
  "image": site.url ~ imageUrl(snack.image, { width: 1200 }).url,
  "offers": { "@type": "Offer", "price": snack.price, "priceCurrency": "USD" }
} | tojson }}</script>{% endif %}
```

- **Addresses:** structured data wants whole ones. `imageUrl()` is a picture's published copy, and `site.url ~` makes it whole. Under a [`base`](deploying.md#serving-a-site-under-a-path), use `absoluteUrl(url, site.url)` instead, which every site has and which puts the base in (in a data file, `import { absoluteUrl } from "ssqch"`).
- **From a data file:** when the block is built in code, beside a paginated template, `absoluteUrl` and `withBase` are exports of `ssqch` and get the build's base, `--base` included. The [company-site example](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/company-site)'s `src/provisions/snack.data.js`, shortened, and its layout prints `{{ jsonld | tojson }}`:

  ```js
  import { absoluteUrl, readData } from "ssqch";
  import { imageUrl } from "ssqch/image";

  const site = readData("src/_data/site.json");

  export default {
    computed: {
      jsonld: ({ snack }) => ({
        "@context": "https://schema.org",
        "@type": "Product",
        name: snack.name,
        url: absoluteUrl(`/provisions/${snack.slug}/`, site.url),
        image: absoluteUrl(imageUrl(snack.image, { width: 800 }).url, site.url),
        offers: { "@type": "Offer", price: String(snack.price), priceCurrency: "USD" }
      })
    }
  };
  ```

  Under `--base /preview/`, `url` is `https://squatchsnacks.example/preview/provisions/pine-cone-crunch/`, and the base is added once even to a URL that has it (`imageUrl()`'s does). `withBase("/search.json")` is the same without the domain, for a path. The config's own top-level code runs before the build knows its base, so call them inside `computed` or a function, as here.
- **Escaping:** `tojson` writes `'` as `\u0027` (`"S\u0027mores Mix"`) and `<` as `\u003c`, which is the same JSON, and keeps a `</script>` in a value from closing the block.
- **Checking:** `linksPlugin()` checks the site's own addresses in a JSON-LD block, and Schema.org's validator (validator.schema.org) or Google's Rich Results Test reads the rest.

A Jekyll site's `{% seo %}` (jekyll-seo-tag) becomes an include that writes the same tags: it's in [the Jekyll trailhead](trailheads/from-jekyll.md#from-jekyll-seo-tag), and `ssqch scout` drafts it.
