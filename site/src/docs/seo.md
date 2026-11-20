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

**From jekyll-seo-tag:** Jekyll's `{% seo %}` becomes an include, `{% include seo.liquid %}` in the layout. This one writes the tags jekyll-seo-tag 2.8 writes, in its order, for a site whose `_config.yml` is read as `site` (`data: { site: readData("_config.yml") }`) and whose pages have `title`, `description` and `image` in front matter (as jekyll-seo-tag does, the title and description go through `markdownify` for their quotes and dashes, and the canonical link and `og:url` need `site.url`); add the tags your site's options turn on (`twitter`, `facebook`, `logo`, authors):

```liquid
{%- comment -%} _includes/seo.liquid {%- endcomment -%}
{%- assign site_title = site.title | default: site.name | markdownify | strip_html | normalize_whitespace | escape_once -%}
{%- assign page_title = title | markdownify | strip_html | normalize_whitespace | escape_once | default: site_title -%}
{%- assign about = description | default: site.description | markdownify | strip_html | normalize_whitespace | escape_once -%}
{%- if page_title != site_title -%}{%- assign full_title = page_title | append: " | " | append: site_title -%}{%- elsif site.description -%}{%- assign full_title = site_title | append: " | " | append: about -%}{%- else -%}{%- assign full_title = site_title -%}{%- endif -%}
{%- assign canonical = site.url | append: page.url -%}
<!-- Begin Jekyll SEO tag v2.8.0 -->
<title>{{ full_title }}</title>
<meta property="og:title" content="{{ page_title }}" />
<meta property="og:locale" content="{{ lang | default: site.lang | default: "en_US" | replace: "-", "_" }}" />
{% if about %}<meta name="description" content="{{ about }}" />
<meta property="og:description" content="{{ about }}" />
{% endif %}{% if site.url %}<link rel="canonical" href="{{ canonical }}" />
<meta property="og:url" content="{{ canonical }}" />
{% endif %}<meta property="og:site_name" content="{{ site_title }}" />
{% if image %}<meta property="og:image" content="{{ site.url | append: image }}" />
{% endif %}<meta property="og:type" content="website" />
<meta name="twitter:card" content="{% if image %}summary_large_image{% else %}summary{% endif %}" />
{% if image %}<meta property="twitter:image" content="{{ site.url | append: image }}" />
{% endif %}<meta property="twitter:title" content="{{ page_title }}" />
<!-- End Jekyll SEO tag -->
```

jekyll-seo-tag also writes `<meta name="generator">` (Jekyll's version; leave it out, or write ssqch's with `ssqch.generator`) and a JSON-LD script. A function can write all of it instead, when the template passes it what it needs: functions are Liquid tags too, so `{% seo page, title, description %}` calls `seo(page, title, description)` (a function doesn't see the page unless it's given). opensource.guide's port did that, writing jekyll-seo-tag's bytes, JSON-LD included, in 100 lines.
