---
title: "SEO tags"
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

JSON-LD, if the site wants it, is a `json` (Liquid), `tojson` (Jinja) or `dump` (Nunjucks) of an object built in the template or by a filter.

A Jekyll site's `{% seo %}` (jekyll-seo-tag) becomes an include that writes the same tags: it's in [the Jekyll trailhead](trailheads/from-jekyll.md#from-jekyll-seo-tag), and `ssqch scout` drafts it.
