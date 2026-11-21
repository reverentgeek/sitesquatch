---
title: "SiteSquatch"
navTitle: "Introduction"
description: "SiteSquatch (ssqch) is a static site generator for Node.js."
---
<img align="right" src="../../../docs/assets/stickers/sitesquatch.svg" alt="SiteSquatch, a Sasquatch with a deadpan stare" width="180">

SiteSquatch (`ssqch`) is a static site generator for Node.js: large, quick, and rarely photographed. Write your pages in Markdown and [Jinja](https://jinja.palletsprojects.com/) (the default), [Edge.js](https://edgejs.dev), [Liquid](https://shopify.github.io/liquid/), [Nunjucks](https://mozilla.github.io/nunjucks/), [Handlebars](https://handlebarsjs.com/), [Mustache](https://mustache.github.io/) or [EJS](https://ejs.co/), configure the site in JavaScript, and `ssqch build` turns it all into plain HTML. Your config runs on Node, so any npm package you already know works in it.

It moves fast for its size. [reverentgeek.com](https://reverentgeek.com) (168 pages, a feed, a sitemap and about 4,700 responsive image files) rebuilds in **under a second** once its images are cached, which is gone before you've found your camera. [Benchmarks](benchmarks.md) has the measurements.

It reports like a park ranger who has seen some things. What happened comes first, with the file and the line, and now and then something large walks through the log. The jokes never stand in for the facts, the JSON output has none, and nothing of ssqch's own is ever added to the pages it builds.

What's in the pack:

- **A data cascade, layouts, collections, pagination and permalinks**, so a blog or docs site needs no custom code.
- **A JavaScript config** with filters, global data, custom collections, transforms and build hooks, plus any npm package, `fetch` (with a cache) and every Node built-in, since the config runs on Node.
- **Markdown that does the work of a plugin stack:** heading ids, footnotes, containers, render hooks in any template language, and syntax highlighting at build time.
- **Responsive images:** every `<img>` becomes a `<picture>` with AVIF, WebP and fallback sources, cached by content so later builds skip the encoding.
- **Checks that run with every build:** [content schemas](content-schemas.md) for front matter, a link checker, [`ssqch diff`](comparing-builds.md) to see what a change did to the output, and [`ssqch trace`](where-values-come-from.md) to see where a page's data came from.
- **Errors that point at the spot:** the line a problem is on, with carets under it, and a guess at what you meant (`did you mean /contact/?`) for a link, a layout, an include or an option that's nearly right.
- **Themes without a package manager, custom elements that load only where they're used**, Sass (yes, Sassquatch), a sitemap, redirects, RSS helpers, HTML minification and asset fingerprinting.
- **A quick start and a way in:** `ssqch init` (a blog, or a docs site with a sidebar and search), `ssqch scout` for what moving an Eleventy, Jekyll, Hugo, MkDocs or Zola site takes, [`ssqch new`](new-pages.md) for the next post, and a dev server (it answers to Squatch Watch) that reloads only the page you changed, swaps stylesheets in place, and shows a broken build in the browser.
- **Plugins in Rust** for the heavy lifting: transforms, filters and template languages built to one `.wasm` file that runs on every platform.

SiteSquatch is a young one (0.x), so expect some breaking changes between minor versions. Each is listed in the [changelog](https://github.com/reverentgeek/sitesquatch/blob/main/CHANGELOG.md) with what you'd need to change.
