---
title: "Trailheads: moving from another generator"
navTitle: "Moving to ssqch"
description: "Everything migrates eventually."
---
Everything migrates eventually. The trailheads map another generator's config, front matter and templates onto ssqch's, and `ssqch docs --from <generator>` prints the one you need: [from Zola](trailheads/from-zola.md), [from Eleventy](trailheads/from-eleventy.md), [from Docusaurus](trailheads/from-docusaurus.md), [from MkDocs](trailheads/from-mkdocs.md), [from Hexo](trailheads/from-hexo.md), [from Jekyll](trailheads/from-jekyll.md) and [from component frameworks](trailheads/from-component-frameworks.md) (Astro, VitePress, Next.js, Gatsby). [`examples/sites/`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/) has small, complete sites to start from or copy parts of, each built in CI: `blog-tags`, `blog-categories`, `docs-sidebar`, `glossary-docs`, `versioned-docs`, `component-docs`, `reference-pages` and `islands`.

For a Zola site, `ssqch import zola` moves `tags` out of `[taxonomies]` and turns `path` into `permalink` in each page's front matter, writes a first `ssqch.config.js` from `config.toml` (the site's data, Markdown options, Sass, redirects, a sitemap), and lists what the Tera templates, shortcodes and sections need.

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: `ssqch import jekyll`.

For a Jekyll site, `ssqch import jekyll` writes a first `ssqch.config.js` from `_config.yml` (Liquid for pages, kramdown's Markdown options, `exclude`, the files Jekyll copies, the plugins it knows), directory data for `_posts` and each collection with their permalinks, renames `page.title` and the other front matter keys in templates to `title`, and writes jekyll-seo-tag's tags as an include; the [Jekyll trailhead](trailheads/from-jekyll.md#importing) has the rest.

For an Eleventy site, `ssqch import eleventy` does the mechanical part. It renames `*.11tydata.*` files, rewrites front matter keys and image attributes to ssqch's names, writes a first `ssqch.config.js` from what it can read in the Eleventy config (folders, passthrough copies, template engines, `pathPrefix`), and lists what's left to port by hand, each with its file and line and what it becomes: filters, shortcodes, collections, plugins and their ssqch equivalents. Without `--write` it only prints the list, so run it in a clean git checkout, read it, then run it again with `--write`:

```sh
ssqch import eleventy            # what would change, and what's left (or: ssqch import jekyll, ssqch import zola)
ssqch import eleventy --write    # make the changes
```

Habits come along too. Where another generator's word means the same thing in ssqch, it works, and says ssqch's name once (`--quiet` hides it):

```text
$ ssqch dev
note: dev works; ssqch calls it serve (ssqch docs serve)
```

The words that work: the commands `dev`, `start`, `server` and `watch` (for `ssqch serve`), `preview` (`ssqch serve --built`) and `generate` (`ssqch build`); the flags `--watch` and `--serve` (`ssqch serve`), `-d` and `--destination` (`--output`) and `--pathprefix` (`--base`); the config options `pathPrefix` (`base`), `dir` (`dirs`), `publishDir` and `outDir` (`dirs.output`), and `markdownTemplateEngine` and `htmlTemplateEngine` (`markdownEngine` and `htmlEngine`); the front-matter keys `eleventyComputed` (`computed`), `eleventyExcludeFromCollections` (`excludeFromCollections`), `redirect_from` (`aliases`) and `templateEngineOverride` (`render`, its `"njk,md"` string included); and, in Jinja, Nunjucks and Liquid, the filters `url` and `relative_url` (they give the URL back as it is, since the build adds `base` itself) and `markdownify` (`markdown`). An alias and ssqch's name for the same thing together are an error (`pathPrefix and base are two names for one option`). The docs, starters and messages use ssqch's names, and `ssqch build --format json` lists the aliases a site used in `aliases` rather than in `warnings`.

A word that would mean something else in ssqch is refused, with ssqch's name for it and where to read more:

```text
$ ssqch check
error: unrecognized subcommand 'check'

  `ssqch build` checks as it builds: content schemas on every build, and internal links with `linksPlugin()`.
  More: ssqch docs "Content schemas"
```

Hugo's `baseURL` (a full URL, where `base` is a path), `--drafts` and `-D` (ssqch builds drafts in development, not with a flag), `addPassthroughCopy` and the other `add*` calls (an ssqch config is an object), `{{ eleventy.generator }}`, Jekyll's `site.posts` and `published: false`, and `eleventyNavigation` (ssqch's own navigation reads `nav`; templates that call eleventy-navigation's filter still read it) get the same treatment (every unknown config option is listed in one go), and `ssqch build --format json` carries the answer as data, in a `hint` with `use` (ssqch's name) and `more`. A folder that has another generator's config and no ssqch config gets a warning naming the importer and `ssqch docs --from`, instead of a build with ssqch's defaults that nobody asked for. `ssqch docs --from eleventy` (or `hugo`, `jekyll`, `zola`, ...) lists that generator's words with ssqch's for each, marking the ones that work, then prints its trailhead, and `ssqch docs pathPrefix` answers for one word.

Whichever generator you're leaving, build the site with it and with ssqch and run [`ssqch diff`](comparing-builds.md) on the two output folders: it shows which pages differ and how, so you know when the move is done.
