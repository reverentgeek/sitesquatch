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

Each warning has a code. The checks are the ones a build folder can answer from the two public lists of what agents need (the Agent-Friendly Documentation Spec and isitagentready.com); what needs the live site (a host's headers, `Accept: text/markdown`) isn't checked yet.

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
| `copy-differs` | A Markdown copy that doesn't say what its page says: under 80% of its words are on the page, or under half the page's are in it (template code where the text should be, or a layout that adds most of the page). |
| `copy-long`, `copy-cut-off` | A Markdown copy over 50,000 characters, long for one fetch, or over 100,000, where Claude Code's fetch stops reading. Split the page. |
| `copy-broken` | A Markdown copy that links the site's own file that isn't in the build: often a picture's source path, which an image plugin published under another name. `llmsPlugin()` writes the published addresses. |
| `copy-fence` | A code fence in a copy that never closes, so the rest reads as code. |
| `relative-links` | A link in `llms.txt` or a copy that isn't a whole address or a path from the root: it breaks once the text is read away from its page. `llmsPlugin({ url })` writes whole addresses. |

A page that only sends a reader on (a redirect, with `http-equiv="refresh"`) isn't checked, and neither is `404.html`. A Markdown copy is the one the page links, or the one at the address llms.txt's proposal gives it (`/guide/intro/` has `/guide/intro/index.md`).
