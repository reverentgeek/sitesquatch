---
title: "Patrol: what agents and crawlers find"
description: "ssqch patrol walks a built site the way a coding agent or a crawler reads it: the posted signs, each page's shape, and each page's Markdown copy."
---
`ssqch patrol` walks a built site the way a coding agent or a crawler reads it, and warns about what would trip one up: a missing `robots.txt`, sitemap or `llms.txt`, a page with two `<h1>`s or no description, a Markdown copy that doesn't say what its page says.

```text
$ ssqch build
$ ssqch patrol
Patrol of _site: 12 pages, 12 with a Markdown copy
  robots.txt posted, sitemap posted, llms.txt posted, 404.html posted

warn[no-description]: pages with no <meta name="description">: what search results and agents show for a link (2)
  posts/pine-cones/index.html
  tags/index.html

1 kind of warning in 2 files. `ssqch docs "what patrol checks"` says what each code means.
```

It reads the site's output folder, or any build folder you name, another generator's included (`ssqch patrol _site` before a move shows what the move can fix). It needs no config and changes nothing. With `--format json`, standard output is one JSON document: `pages`, `copies` (the pages with a Markdown copy), `signs` (`robots`, `sitemap`, `llms` and `notFound`, each `true` or `false`) and `warnings`, each with its `code`, `message` and every one of its `files`. It exits with 0 when it found nothing, 1 when it warned, and 2 on an error (a folder that isn't there), so a CI step can run it after the build.

## What patrol checks

Each warning has a code. The checks are the ones a build folder can answer from the two public lists of what agents need (the Agent-Friendly Documentation Spec and isitagentready.com), and with `--url`, how the deployed site answers ([below](#the-live-site)).

| Code | What it means, and the fix |
| --- | --- |
| `no-robots` | No `robots.txt`. `robotsPlugin()` writes one, with the sitemap's address and rules for AI crawlers ([Posted signs](robots.md)). |
| `no-sitemap` | No `sitemap.xml`, and `robots.txt` names none. `sitemapPlugin({ url })` writes one. |
| `no-404` | No `404.html`, or one that's the home page. A missing page should say so, with a 404 status: a page with `permalink: /404.html`. |
| `no-llms` | No `llms.txt`. `llmsPlugin()` writes it, with a Markdown copy of each page. |
| `llms-shape` | `llms.txt` doesn't start with a `# ` heading (the site's name), the one part llmstxt.org's format requires. |
| `llms-long` | `llms.txt` is over 50,000 characters: more than an agent reads before deciding where to go. Leave sections out with `exclude`, or link a section's own file. |
| `llms-broken` | A link in `llms.txt` to the site's own file that isn't in the build. |
| `llms-html` | `llms.txt` links pages, not their Markdown. An agent reads Markdown without the page's navigation and scripts. |
| `llms-coverage` | `llms.txt` lists under 95% of the sitemap's pages, so an agent misses some. |
| `no-h1`, `h1s` | A page with no `<h1>`, or more than one. An agent takes the first heading as what the page is about. |
| `no-description` | A page with no `<meta name="description">`, which search results and agents show for a link. |
| `no-main` | A page whose content is in neither `<main>` nor `<article>`, so a reader can't tell it from the navigation (`llmsPlugin()` copies a template page's `<article>` or `<main>` for the same reason). |
| `content-late` | A page whose `<main>` comes after most of its text: an agent with a short read sees the menus. Put the navigation after the content in the HTML (CSS can still show it first). |
| `copy-missing` | A page whose `<link rel="alternate" type="text/markdown">` points at a file that isn't in the build. |
| `copy-differs` | A Markdown copy that doesn't say what its page says: under 80% of its words are on the page, or under half the page's are in it (template code where the text should be, or a layout that adds most of the page). It compares the page's own part, as `llmsPlugin()` copies it (its one `<article>`, or else its `<main>`), with the edges of block elements as breaks between words, so a minified page reads as a browser shows it. The page's `<nav>` elements don't count: breadcrumbs, a pager or a map of the site that the layout puts inside `<main>` is navigation, not what the page says, so mark it up as `<nav>`. |
| `copy-long`, `copy-cut-off` | A Markdown copy over 50,000 characters, long for one fetch, or over 100,000, where Claude Code's fetch stops reading. Split the page. |
| `copy-broken` | A Markdown copy that links the site's own file that isn't in the build: often a picture's source path, which an image plugin published under another name. `llmsPlugin()` writes the published addresses. |
| `copy-fence` | A code fence in a copy that never closes, so the rest reads as code. |
| `relative-links` | A link in `llms.txt` or a copy that isn't a whole address or a path from the root: it breaks once the text is read away from its page. `llmsPlugin({ url })` writes whole addresses. |
| `live-copy-missing` | With `--url`: a copy the build has that the live site doesn't serve at its own address. The build isn't deployed yet, or the host's rules hide `.md` files. |
| `live-no-markdown` | With `--url`: a page that answers an agent's `Accept: text/markdown` with its HTML. The host needs a few lines of its own code ([Serving Markdown](serving-markdown.md)). |
| `live-no-vary` | With `--url`: a Markdown answer without `Vary: Accept`, so a cache in between can hand the Markdown to a browser, or the page to an agent. |
| `live-browser-markdown` | With `--url`: a page that answers a browser with Markdown, so people get the copy instead of the page. |

A page that only sends a reader on (a redirect, with `http-equiv="refresh"`) isn't checked, and neither is `404.html`. A Markdown copy is the one the page links, or the one at the address llms.txt's proposal gives it (`/guide/intro/` has `/guide/intro/index.md`).

## The live site

`ssqch patrol --url https://example.com` checks the build folder as usual, then asks the deployed site at that address about up to ten of the build's pages with a Markdown copy: always the same ten, spread evenly over their sorted addresses, so two runs compare. For each, it asks for the copy at its own address, for the page with an agent's `Accept: text/markdown, text/html;q=0.9`, and for the page with a browser's `Accept`, and warns with the `live-` codes above. That's 30 requests, one at a time, each given 15 seconds.

```text
$ ssqch patrol --url https://example.com
Patrol of _site: 168 pages, 156 with a Markdown copy
  robots.txt posted, sitemap posted, llms.txt posted, 404.html posted
  Live at https://example.com: asked about 10 pages as an agent and as a browser

All clear: nothing on the trail for an agent to trip on.
```

The address is the site's root, or the folder it's served from (`https://example.com/docs` for a site built with `base: "/docs/"`). Build what's deployed first: patrol asks about the pages in the folder, so a page that's only in a newer build shows up as `live-copy-missing`. The JSON report adds `live`, with the `url` it asked and how many pages (`asked`); a `live-` warning's `files` are addresses on the site (`/about/`). An address that isn't one, or a site that doesn't answer, is an error (exit 2).
