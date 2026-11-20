# SiteSquatch

[![CI](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml/badge.svg)](https://github.com/reverentgeek/sitesquatch/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/reverentgeek/sitesquatch)](https://github.com/reverentgeek/sitesquatch/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Docs: sitesquatch.dev](https://img.shields.io/badge/docs-sitesquatch.dev-233b2b)](https://sitesquatch.dev/docs/)

<img align="right" src="docs/assets/stickers/sitesquatch.svg" alt="SiteSquatch, a Sasquatch with a deadpan stare" width="180">

SiteSquatch (`ssqch`) is a static site generator that's fun to work with: large, quick, and rarely photographed. Write your pages in Markdown and [Jinja](https://jinja.palletsprojects.com/) (the default), [Edge.js](https://edgejs.dev), [Liquid](https://shopify.github.io/liquid/), [Nunjucks](https://mozilla.github.io/nunjucks/), [Handlebars](https://handlebarsjs.com/), [Mustache](https://mustache.github.io/) or [EJS](https://ejs.co/), configure the site in JavaScript, and `ssqch build` turns it all into plain HTML. Your config runs on Node, so any npm package you already know works in it.

It moves fast for its size. [reverentgeek.com](https://reverentgeek.com) (168 pages, a feed, a sitemap and about 4,700 responsive image files) rebuilds in **under a second** once its images are cached, which is gone before you've found your camera. [Benchmarks](https://sitesquatch.dev/docs/benchmarks/) has the measurements.

It reports like a park ranger who has seen some things. What happened comes first, with the file and the line, and now and then something large walks through the log. The jokes never stand in for the facts, the JSON output has none, and nothing of ssqch's own is ever added to the pages it builds.

What's in the pack:

- **A data cascade, layouts, collections, pagination and permalinks**, so a blog or docs site needs no custom code.
- **A JavaScript config** with filters, global data, custom collections, transforms and build hooks, plus any npm package, `fetch` (with a cache) and every Node built-in, since the config runs on Node.
- **Markdown that does the work of a plugin stack:** heading ids, footnotes, containers, render hooks in any template language, and syntax highlighting at build time.
- **Responsive images:** every `<img>` becomes a `<picture>` with AVIF, WebP and fallback sources, cached by content so later builds skip the encoding.
- **Checks that run with every build:** [content schemas](https://sitesquatch.dev/docs/content-schemas/) for front matter, a link checker, [`ssqch diff`](https://sitesquatch.dev/docs/comparing-builds/) to see what a change did to the output (and `ssqch baseline` to build the site with its old generator to compare with), and [`ssqch inspect`](https://sitesquatch.dev/docs/where-values-come-from/) to see where a page's data came from.
- **Errors that point at the spot:** the line a problem is on, with carets under it, and a guess at what you meant (`did you mean /contact/?`) for a link, a layout, an include or an option that's nearly right.
- **Themes without a package manager, custom elements that load only where they're used**, Sass (yes, Sassquatch), a sitemap, redirects, RSS helpers, HTML minification and asset fingerprinting.
- **A quick start and a way in:** `ssqch init` (a blog, or a docs site with a sidebar and search), `ssqch scout` for what moving an Eleventy, Jekyll, Hugo, MkDocs or Zola site takes, [`ssqch new`](https://sitesquatch.dev/docs/new-pages/) for the next post, and a dev server (it answers to Squatch Watch) that reloads only the page you changed, swaps stylesheets in place, and shows a broken build in the browser.
- **Plugins in Rust** for the heavy lifting: transforms, filters and template languages built to one `.wasm` file that runs on every platform.

SiteSquatch is a young one (0.x), so expect some breaking changes between minor versions. Each is listed in the [changelog](CHANGELOG.md) with what you'd need to change, and [sitesquatch.dev/changelog](https://sitesquatch.dev/changelog/) says what's new in each release.

## Install

<img align="right" src="docs/assets/stickers/backpack.svg" alt="" width="96">

You'll need [Node.js](https://nodejs.org) 22.18 or newer. In a site with a `package.json`, add ssqch as a dev dependency, so the lockfile pins the version you built with:

```sh
npm install --save-dev ssqch
```

To have `ssqch` everywhere instead, `npm install --global ssqch`, or `brew install reverentgeek/tap/ssqch` with [Homebrew](https://brew.sh). [Install](https://sitesquatch.dev/docs/install/) has the rest: pnpm and yarn, release ages, and Tab completion.

## Your first site

```sh
npx ssqch init my-site
cd my-site
npx ssqch serve
```

That sets up camp (a config, a layout, a home page, five posts, a 404 page and an `AGENTS.md` for coding agents) and serves it at http://localhost:8080, reloading the page you're on when you save. `npx ssqch init my-docs --starter docs` makes a docs site with a sidebar and search instead. The [field guide](https://sitesquatch.dev/docs/field-guide/) builds one from scratch, a file at a time.

## The documentation

<img align="right" src="docs/assets/stickers/compass.svg" alt="" width="96">

It's all at [sitesquatch.dev/docs](https://sitesquatch.dev/docs/), and it ships with ssqch: `ssqch docs <name>` prints what the docs say about a command, an option or a function, for the version you have installed and with no network (`ssqch docs base`, `ssqch docs "content schemas"`, `ssqch docs --from eleventy`). The pages are in [`site/src/docs/`](site/src/docs/), as Markdown.

- **Start here:** [Install](https://sitesquatch.dev/docs/install/), [Field guide](https://sitesquatch.dev/docs/field-guide/)
- **Build:** [Configuring a site](https://sitesquatch.dev/docs/configuring/), [Data files](https://sitesquatch.dev/docs/data-files/), [Built-in plugins](https://sitesquatch.dev/docs/plugins/), [Templates and data](https://sitesquatch.dev/docs/templates/), [Markdown](https://sitesquatch.dev/docs/markdown/), [Template languages](https://sitesquatch.dev/docs/template-languages/), [CSS and JavaScript](https://sitesquatch.dev/docs/css-and-javascript/), [Multilingual sites](https://sitesquatch.dev/docs/multilingual/), [SEO tags](https://sitesquatch.dev/docs/seo/), [Themes](https://sitesquatch.dev/docs/themes/), [Starting a new page](https://sitesquatch.dev/docs/new-pages/)
- **Check:** [Content schemas](https://sitesquatch.dev/docs/content-schemas/), [Where a value comes from](https://sitesquatch.dev/docs/where-values-come-from/), [Reading the build summary](https://sitesquatch.dev/docs/build-summary/), [Comparing two builds](https://sitesquatch.dev/docs/comparing-builds/), [A build's footprint](https://sitesquatch.dev/docs/footprint/)
- **Ship:** [Deploying](https://sitesquatch.dev/docs/deploying/), [Netlify](https://sitesquatch.dev/docs/netlify/), [GitHub Pages](https://sitesquatch.dev/docs/github-pages/), [Scripts and coding agents](https://sitesquatch.dev/docs/agents/), [Plugins in Rust](https://sitesquatch.dev/docs/rust-plugins/)
- **Trailheads:** [Moving to ssqch](https://sitesquatch.dev/docs/trailheads/), [From Eleventy](https://sitesquatch.dev/docs/trailheads/from-eleventy/), [From Jekyll](https://sitesquatch.dev/docs/trailheads/from-jekyll/), [From Zola](https://sitesquatch.dev/docs/trailheads/from-zola/), [From Docusaurus](https://sitesquatch.dev/docs/trailheads/from-docusaurus/), [From MkDocs](https://sitesquatch.dev/docs/trailheads/from-mkdocs/), [From Hexo](https://sitesquatch.dev/docs/trailheads/from-hexo/), [From Astro, VitePress, Next.js, Gatsby](https://sitesquatch.dev/docs/trailheads/from-component-frameworks/)
- **Reference:** [Every name](https://sitesquatch.dev/docs/reference/), [Benchmarks](https://sitesquatch.dev/docs/benchmarks/), [Known gaps](https://sitesquatch.dev/docs/known-gaps/)

The [example sites](https://sitesquatch.dev/examples/) run live, each with its source in [`examples/sites/`](examples/sites/).

## Working on SiteSquatch

[`CONTRIBUTING.md`](CONTRIBUTING.md) has how the repository fits together, how to run ssqch from its source and how to test a change, and [`AGENTS.md`](AGENTS.md) the rules. Found a bug, or have an idea? [Open an issue](https://github.com/reverentgeek/sitesquatch/issues). Happy building, and may your pages load faster than a Squatch sighting disappears.

SiteSquatch is [MIT licensed](LICENSE).
