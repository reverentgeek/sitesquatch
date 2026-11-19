---
title: "Benchmarks"
description: "No blurry footage here."
---
No blurry footage here: these numbers come from building the ReverentGeek blog (161 HTML pages plus a feed, a sitemap and Netlify files) on an Apple M5 Pro (15 cores), in production mode with HTML minification on, with ssqch 0.8.0 on Node 26.

| Build | Time | Peak memory |
| --- | --- | --- |
| **Cold** (every image encoded: 4,985 files, 266 MB) | **25.6 s** (341 s of CPU) | 2.6 GB |
| **Warm** (images cached, median of 3) | **0.92 s** | 328 MB |

- **Warm builds** are what the dev server and cached CI builds do, and the time includes starting Node.
- **Cold builds** are mostly image encoding, and AVIF is the most expensive format (the blog uses `avifEffort: 3`). They're single runs and vary.
- **One thread renders, the thread pool encodes:** pages render one at a time on one thread (there are no worker threads), written as they render, and image encoding runs on libuv's thread pool, which uses every core. A site with heavy per-page JavaScript uses one core for it.
- Only site generation is measured, not building the CSS and JavaScript.

The speed check ssqch runs on itself is a synthetic site of 10,000 pages, built on one thread (`node packages/ssqch/bench/bench.ts` in the repository), plus v8.dev's exact port from Eleventy: on the same machine, the 10,000 pages build in 1.12 s and 370 MB, and v8.dev in 0.58 s. CI compares each commit with its parent on the same runner and fails a change that makes the 10,000-page build more than 15% slower.

For a bigger site, `scripts/synthetic-site.py <folder> [pages] [engine]` writes a synthetic documentation site: 9,001 Markdown pages by default (about the size of kubernetes.io's English docs) in 60 sections, each page with a 9,000-entry sidebar from a data file, a table of contents, a highlighted code fence, a schema check and the link checker. On the same machine, production builds of it take:

| Layout in | Build | CPU time | Peak memory |
| --- | --- | --- | --- |
| Edge | 2.85 s | 7.4 s | 465 MB |
| Nunjucks | 2.74 s | 7.0 s | 454 MB |
| Liquid | 9.23 s | 14.3 s | 610 MB |

Each build writes 156 MB of HTML and checks 1.4 million links. Templates get your real objects, not copies, so handing the whole sidebar to a filter on every page copies nothing in any language.

`scripts/bench.sh [path/to/blog] [warm-runs]` runs the blog's table on macOS (the blog defaults to `../blog`) on a copy-on-write clone in a temporary folder, so your copy is never touched, and writes `results.csv`, `bench.log` and `summary.txt` to `bench-results/<timestamp>/`. It times the npm package as it's published, and needs pnpm for the blog's CSS and JavaScript.
