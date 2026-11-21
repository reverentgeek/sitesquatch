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

**From jekyll-seo-tag:** Jekyll's `{% seo %}` becomes an include, `{% include seo.liquid %}` in the layout. This one writes what jekyll-seo-tag 2.8 writes, in its order and its bytes, for a site whose `_config.yml` is read as `site` (`data: { site: readData("_config.yml") }`) and whose pages have `title`, `description` and `image` in front matter. As jekyll-seo-tag does, the title and description go through `markdownify` for their quotes and dashes; the canonical link and `og:url` need `site.url`; a dated page (front matter `date`, or a post's or collection's `tags`) is an `article` with its `published_time` and a `BlogPosting`; the home page (`/` or `/about/`) is a `WebSite` with a `name`; `site.twitter.username`, `site.facebook.publisher` and `site.logo` add their tags; and the generator is ssqch's (`ssqch scout`'s draft for a Jekyll site writes Jekyll's version there instead, from `Gemfile.lock`, so the first build matches). Add the tags for options this leaves out (authors, `fb:app_id`, webmaster verifications):

```liquid
{%- comment -%} _includes/seo.liquid {%- endcomment -%}
{%- assign site_title = site.title | default: site.name | markdownify | strip_html | normalize_whitespace | escape_once -%}
{%- assign page_title = title | markdownify | strip_html | normalize_whitespace | escape_once | default: site_title -%}
{%- assign about = description | default: site.description | markdownify | strip_html | normalize_whitespace | escape_once -%}
{%- if page_title != site_title -%}{%- assign full_title = page_title | append: " | " | append: site_title -%}{%- elsif site.description -%}{%- assign full_title = site_title | append: " | " | append: about -%}{%- else -%}{%- assign full_title = site_title -%}{%- endif -%}
{%- assign canonical = site.url | append: page.url -%}
{%- if image -%}{%- assign image_url = site.url | append: image -%}{%- endif -%}
{%- if date or tags -%}{%- assign published = page.date | date_to_xmlschema -%}{%- endif -%}
{%- if page.url == "/" or page.url == "/about/" -%}{%- assign ld_type = "WebSite" -%}{%- elsif published -%}{%- assign ld_type = "BlogPosting" -%}{%- else -%}{%- assign ld_type = "WebPage" -%}{%- endif -%}
<!-- Begin Jekyll SEO tag v2.8.0 -->
<title>{{ full_title }}</title>
<meta name="generator" content="{{ ssqch.generator }}" />
<meta property="og:title" content="{{ page_title }}" />
<meta property="og:locale" content="{{ lang | default: site.lang | default: "en_US" | replace: "-", "_" }}" />
{% if about %}<meta name="description" content="{{ about }}" />
<meta property="og:description" content="{{ about }}" />
{% endif %}{% if site.url %}<link rel="canonical" href="{{ canonical }}" />
<meta property="og:url" content="{{ canonical }}" />
{% endif %}<meta property="og:site_name" content="{{ site_title }}" />
{% if image_url %}<meta property="og:image" content="{{ image_url }}" />
{% endif %}{% if published %}<meta property="og:type" content="article" />
<meta property="article:published_time" content="{{ published }}" />
{% else %}<meta property="og:type" content="website" />
{% endif %}<meta name="twitter:card" content="{% if image_url %}summary_large_image{% else %}summary{% endif %}" />
{% if image_url %}<meta property="twitter:image" content="{{ image_url }}" />
{% endif %}<meta property="twitter:title" content="{{ page_title }}" />
{% if site.twitter.username %}<meta name="twitter:site" content="@{{ site.twitter.username | remove: "@" }}" />
{% endif %}{% if site.facebook.publisher %}<meta property="article:publisher" content="{{ site.facebook.publisher }}" />
{% endif %}<script type="application/ld+json">
{"@context":"https://schema.org","@type":{{ ld_type | jsonify }}{% if published %},"dateModified":{{ published | jsonify }},"datePublished":{{ published | jsonify }}{% endif %}{% if about %},"description":{{ about | jsonify }}{% endif %},"headline":{{ page_title | jsonify }}{% if image_url %},"image":{{ image_url | jsonify }}{% endif %}{% if ld_type == "BlogPosting" %},"mainEntityOfPage":{"@type":"WebPage","@id":{{ canonical | jsonify }}}{% endif %}{% if ld_type == "WebSite" %},"name":{{ site_title | jsonify }}{% endif %}{% if site.logo %},"publisher":{"@type":"Organization","logo":{"@type":"ImageObject","url":{{ site.url | append: site.logo | jsonify }}}}{% endif %},"url":{{ canonical | jsonify }}}</script>
<!-- End Jekyll SEO tag -->
```

A function can write all of it instead, when the template passes it what it needs: functions are Liquid tags too, so `{% seo page, title, description %}` calls `seo(page, title, description)` (a function doesn't see the page unless it's given). opensource.guide's port did that, writing jekyll-seo-tag's bytes, JSON-LD included, in 100 lines.
