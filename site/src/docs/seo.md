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
- **Escaping:** `tojson` writes `'` as `\u0027` (`"S\u0027mores Mix"`) and `<` as `\u003c`, which is the same JSON, and keeps a `</script>` in a value from closing the block.
- **Checking:** `linksPlugin()` checks the site's own addresses in a JSON-LD block, and Schema.org's validator (validator.schema.org) or Google's Rich Results Test reads the rest.

> [!NOTE]
> **Not released yet.** `absoluteUrl` without `rssPlugin()`, and as an export of `ssqch`, ships with the next version of ssqch.

A Jekyll site's `{% seo %}` (jekyll-seo-tag) becomes an include that writes the same tags: it's in [the Jekyll trailhead](trailheads/from-jekyll.md#from-jekyll-seo-tag), and `ssqch scout` drafts it.
