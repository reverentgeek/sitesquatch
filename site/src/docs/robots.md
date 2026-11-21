---
title: "Posted signs: robots.txt and AI crawlers"
description: "robotsPlugin() writes robots.txt: the sitemap's address, the paths no crawler reads, and what AI crawlers may do, by what they're for. With llmsPlugin() and three links in the layout, a site is ready for agents."
---
> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch.

A crawler reads the signs at the trailhead before it walks in: `robots.txt` says what it may read and where the sitemap is, and `llms.txt` is the map an agent reads first. ssqch writes both with plugins, and three links in the layout's `<head>` point agents at them.

```js
import { defineConfig } from "ssqch";
import { llmsPlugin } from "ssqch/llms";
import { robotsPlugin } from "ssqch/robots";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig({
  plugins: [
    sitemapPlugin({ url: "https://example.com" }),
    robotsPlugin({ ai: { training: false } }),
    llmsPlugin({ url: "https://example.com" }),
  ],
});
```

`ssqch patrol` checks the result ([Patrol](patrol.md)).

## robots.txt

`robotsPlugin(options)` from `ssqch/robots` writes `/robots.txt`. With the options above:

```text
User-agent: *
Allow: /

User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
User-agent: meta-externalagent
User-agent: Bytespider
Disallow: /

Sitemap: https://example.com/sitemap.xml
```

Options:

- `ai`: what AI crawlers may do, by what they're for, each `true` (the default) or `false`. `training` is collecting pages to train models on (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent, Bytespider); `search` is indexing them for an AI search's answers (OAI-SearchBot, Claude-SearchBot, PerplexityBot); `fetch` is reading a page because a person asked about it (ChatGPT-User, Claude-User, Perplexity-User, meta-externalfetcher). A purpose that's `false` gets a group with `Disallow: /`; one that's `true` gets none, so its crawlers read everyone's. Google-Extended and Applebot-Extended only say what may be trained on: Google Search, Siri and Spotlight still index the site. OpenAI and Perplexity say a fetch a person asked for may not read robots.txt at all.
- `disallow`: URL paths no crawler should read (`["/drafts/"]`), as `Disallow:` lines in everyone's group, with the site's `base` in front.
- `sitemap`: the `Sitemap:` line. By default it's `sitemapPlugin()`'s address when that's on, and there's none without it; `false` leaves it out, and a string is another sitemap's whole address.

The names come from each company's documentation, checked on 2026-11-21, and ssqch keeps the list as they change, so a site says what it wants once, by purpose. A site that copies its own `robots.txt` (in `passthrough`) and turns the plugin on is an error that says to keep one. A site served under a `base` (`/repo/`) has its `robots.txt` there too, where crawlers don't look: they read only the domain's own `/robots.txt`.

Not written yet, because nothing reads them yet: the IETF draft's shared group for training (`User-agent: __usage_ai-training`, a draft of October 2026) and Cloudflare's `Content-Signal` line.

## llms.txt and the Markdown copies

`llmsPlugin()` writes `/llms.txt`, a Markdown copy of each page and `/llms-full.txt` ([Built-in plugins](plugins.md)). A copy is what the page says (a Markdown page's text after its template ran, a template page's `<article>` or `<main>` as Markdown), at the address llms.txt's proposal gives it: `/guide/intro/` has `/guide/intro/index.md`.

## The links in the layout

llms.txt's proposal (v2) has agents find both from any page by two links, which a layout writes in its `<head>` (a build adds no markup of its own):

```html
<link rel="canonical" href="{{ site.url }}{{ page.url }}">
{% if markdownCopy(page.url) %}<link rel="alternate" type="text/markdown" href="{{ markdownCopy(page.url) }}">{% endif %}
<link rel="describedby" href="/llms.txt">
```

`markdownCopy(page.url)` comes with `llmsPlugin()`: the copy's URL, or `""` for a page without one. The starters' layouts have all three.

## When an agent asks for Markdown

Claude Code, Cursor and OpenCode ask for a page with `Accept: text/markdown`. `ssqch serve` answers with the page's copy, and on a host it takes a few lines of the host's own code: [Serving Markdown to agents](serving-markdown.md) has them for Cloudflare, Netlify and Vercel, and what GitHub Pages does instead.
