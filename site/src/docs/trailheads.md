---
title: "Trailheads: moving from another generator"
navTitle: "Moving to ssqch"
description: "Everything migrates eventually."
---
Everything migrates eventually. The trailheads map another generator's config, front matter and templates onto ssqch's, and `ssqch docs --from <generator>` prints the one you need: [from Zola](trailheads/from-zola.md), [from Eleventy](trailheads/from-eleventy.md), [from Docusaurus](trailheads/from-docusaurus.md), [from MkDocs](trailheads/from-mkdocs.md), [from Hexo](trailheads/from-hexo.md), [from Jekyll](trailheads/from-jekyll.md) and [from component frameworks](trailheads/from-component-frameworks.md) (Astro, VitePress, Next.js, Gatsby). [`examples/sites/`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/) has small, complete sites to start from or copy parts of, each built in CI: `blog-tags`, `blog-categories`, `docs-sidebar`, `glossary-docs`, `versioned-docs`, `component-docs`, `reference-pages`, `islands` and `jekyll-guides`.

## Scouting a site

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: `ssqch scout`, which replaces `ssqch import`.

`ssqch scout` tells you what moving a site to ssqch takes, before you start and at any point during the move. Run it in the old site's folder (or name the folder: `ssqch scout ../old-site`). It finds the generator from its files (`_config.yml`, `hugo.toml`, `mkdocs.yml`, an Eleventy config; `--from <generator>` chooses when it can't tell or guesses wrong) and prints:

- **Reference build:** the `ssqch baseline` command that builds the site with its own generator to compare with, from the site's own build command (`netlify.toml`, a `build` script), and what that build needs (`PAGES_REPO_NWO` for a GitHub Pages site, an `npm install` for Tailwind).
- **To do:** what the site uses that needs doing in ssqch, each with its file and line, ssqch's way to do it, or "not in ssqch yet". A thing used many times is one line, with a count and the first place it's used.
- **Draft:** the new files a move starts with: a first `ssqch.config.js` from the old config, directory data for posts and collections, includes and render hooks for the old generator's plugins. `--write-draft` writes the ones that aren't there, and never overwrites a file.
- **Edits:** the changes to the site's own files that are mechanical and clearly right (a data file's name, an image attribute, `{% seo %}` to an include, a `package.json` script). `--patch move.patch` writes them as a patch to read and apply with `git apply move.patch`; scout never applies it. It doesn't rewrite templates: where a template would need a rewrite, ssqch has the compatibility instead (`jekyllTemplates`, Eleventy's front matter keys as aliases), or the list says so.

It changes nothing unless it's asked, so it's safe to run again during a move: the draft files you've written show as there already, applied edits are gone from the list, and what's left is what still needs doing. `--format json` prints the same report for agents and scripts: `generator`, `detectedBy`, `underWay` (an `ssqch.config.js` is there), `build` (`command`, `output`, `baseline`, `needs`), `todo` (`at`, `what`), `draft` (`path`, `from`, `there`), `edits` (`path`, `to` for a rename, `changes`), `wroteDraft`, `patch` and `trailhead`.

```sh
ssqch scout                                   # what moving this site takes
ssqch scout --write-draft --patch move.patch  # write the draft and the patch
git apply move.patch                          # after reading it
ssqch scout                                   # later: what's left
```

What it reads in depth: Eleventy (the config and the modules it loads, filters and shortcodes, plugins, data files, `package.json`), Jekyll (`_config.yml`, the Gemfile's plugins, collections, `_plugins/*.rb`, templates that read Jekyll's `page` and `site`), Zola (`config.toml`, sections, Tera templates and shortcodes), Hugo (shortcodes and their calls, sections and `cascade`, render hooks, Go templates and Hugo Pipes) and MkDocs (`mkdocs.yml`'s nav, theme, plugins and Markdown extensions, and the MkDocs syntax the pages use: admonitions, tabs, `.md` links, icons). For Docusaurus, Astro, VitePress and Hexo it prints the reference build and points at the trailhead. If it finds no generator's files, or two generators', it says so and asks for `--from`.


## Words you bring with you

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
