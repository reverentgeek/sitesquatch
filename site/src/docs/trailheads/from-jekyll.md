---
title: "Trailhead: moving from Jekyll"
navTitle: "From Jekyll"
description: "Jekyll sites move well."
---
Jekyll sites move well: Liquid runs as it is, `_layouts/`, `_includes/` and `_data/` keep their names, and `redirect_from`, `relative_url`, `markdownify` and `jsonify` work. What takes the time is the Ruby around the templates (Jekyll's `page` and `site`, its plugins) and kramdown, Jekyll's Markdown.

opensource.guide (382 pages in 29 languages, on GitHub Pages' gem) was moved this way as a study: the same 478 files, 95% of pages with the same text, and builds 5.9 times faster. Two thirds of the work was kramdown's `markdown="1"`, which ssqch doesn't read yet (below).

## Build it both ways first

Build the Jekyll site from a fresh checkout twice and compare the two: a page that prints the build's time (an undated article gets `site.time`) differs on every build. Pin it with a second config file holding `time: 2026-01-01 00:00:00 +0000` (`jekyll build --config _config.yml,pin.yml`), and build ssqch with the same time: `SOURCE_DATE_EPOCH=1767225600`. GitHub Pages' gem needs `PAGES_REPO_NWO=owner/repo` in a checkout without a git remote. Then build with ssqch into an empty folder and compare the two with `ssqch diff jekyll-site ssqch-site`.

## The config

Start with `templateFormats: ["liquid", "md", "html"]`, `markdownEngine: "liquid"` and `htmlEngine: "liquid"`, so Markdown and HTML pages run through Liquid first, as in Jekyll, and `dirs: { layouts: "_layouts" }`.

```js
import { defineConfig, readData } from "ssqch";
import { sitemapPlugin } from "ssqch/sitemap";
import { redirectsPlugin } from "ssqch/redirects";

const site = readData("_config.yml");

export default defineConfig({
  templateFormats: ["liquid", "md", "html"],
  markdownEngine: "liquid",
  htmlEngine: "liquid",
  dirs: { layouts: "_layouts" },
  ignore: ["Gemfile", "Gemfile.lock", "README.md", "script/**"],
  data: { site },
  plugins: [sitemapPlugin({ url: site.url }), redirectsPlugin()],
});
```

| Jekyll (`_config.yml`) | ssqch (`ssqch.config.js`) |
| --- | --- |
| `title`, `description`, `url`, any key | `readData("_config.yml")` as `data: { site }`, so `site.title` still works |
| `exclude: [docs, Gemfile]` | `ignore: ["docs/**", "Gemfile"]`. A Bundler install (`vendor/bundle`) is skipped by itself. |
| `_data/locales/fr.yml` as `site.data.locales.fr` | `locales.fr`: `_data` is global data, and a folder in it is an object. Add `data: { site: { ...site, data: ... } }` only if templates must keep `site.data`. |
| `collections: { guides: { output: true, permalink: "/:path/" } }` | `collections: { guides: (c) => c.byGlob("_guides/**") }`, and `_guides/_guides.json` with the permalink: `{ "permalink": "{{ page.filePathStem \| remove_first: '/_guides' }}/" }` |
| `defaults` for a `path` | Directory data in that folder: `_guides/_guides.json` with `{ "layout": "guide" }` |
| `layouts_dir` | `dirs: { layouts: "_layouts" }` |
| `sass: { load_paths }` | `sassPlugin({ files, loadPaths })` from `ssqch/sass`. Front matter on a `.scss` file is fine. |
| `time:` | `SOURCE_DATE_EPOCH=1767225600 ssqch build` (seconds since 1970): `now()` and every undated page get that time, as with `time:` |

## Templates

- **`page` and front matter:** in ssqch, front matter is at the top level (`{{ title }}`), and `page` has the file's facts (`page.url`, `page.inputPath`, `page.date`, `page.headings`). Rename `page.title` to `title` in layouts and includes (the build warns once for each `page.<key>` that's front matter, naming a page that reads it), and look for a template whose own variable has a front matter key's name (`{% assign lang = ... %}` next to `page.lang`).
- **`site.posts` and collections:** `collections.posts` (the pages tagged `posts`) and your own collections. Items have `url` and `data`: `post.data.title`, `| where: "data.lang", "fr"`.
- **Includes:** `{% include nav.html section="home" %}` works, with `include.section`, and so does `{% include_relative parts/intro.md %}`. A file read by `include_relative` is a page of its own too, if it's Markdown: give its folder `permalink: false` in directory data.
- **Plugin tags** (`{% seo %}`, `{% feed_meta %}`): the config's functions are Liquid tags, so each is a function in `filters` that returns the HTML (`{% seo title=false %}` calls `seo({ title: false })`), or an include. `ssqch docs seo` has a starting point.
- **Filters:** `relative_url`, `markdownify` and `jsonify` work, and `where` is fast. Math, `split` and blocks that only `assign` behave as in Ruby's Liquid (`"r>" | times: 1` is 0, which jekyll-toc depends on). Jekyll's own `sort` differs from Liquid's: it sorts a hash into `[key, value]` pairs and puts pages missing the property first, where ssqch's `sort` (Liquid's) does neither, so pass a list from the config, or `sort` then handle the missing ones. A whole float prints as `5` (Ruby writes `5.0`).
- **A table of contents:** `toc(page.headings, { class: "section-nav", itemClass: "toc-entry toc-h{level}" })` writes jekyll-toc's markup, so its CSS keeps working (`{{ page.headings | toc: class: "section-nav" }}` in Liquid). It reads the page's headings after it renders, so it goes in the layout.
- **Files with front matter:** Jekyll renders any file that starts with `---`. In ssqch a `.js` (or `.txt`) file needs an engine: `engines: { js: (s) => s }`, `"js"` in `templateFormats`, and `"render": "liquid,js"` with a `.js` permalink in that folder's directory data ("Text files with front matter" in [Templates and data](../templates.md)).

## Plugins

| Jekyll | ssqch |
| --- | --- |
| jekyll-redirect-from | `redirect_from` works (ssqch calls it `aliases`), with `redirectsPlugin()`; `_includes/hooks/redirect.*` for its page's markup |
| jekyll-sitemap | `sitemapPlugin({ url })` |
| jekyll-feed | `rssPlugin()` and a feed template |
| jekyll-seo-tag | A `seo` function (a tag), or an include with the tags you use |
| jekyll-toc | `toc(page.headings, ...)`, above |
| jekyll-github-metadata | Data in the config (`site.github.repository_nwo`) |
| github-pages' default theme (jekyll-theme-primer) | Nothing: it writes `/assets/css/style.css`. Check whether a page links to it. |

## Markdown

ssqch's Markdown is CommonMark; Jekyll's is kramdown. `markdown: { smartPunctuation: true, autolinks: false }` comes closest. What differs:

- **`markdown="1"`** on an HTML element (kramdown reads its content as Markdown): ssqch writes the element as it is, so Markdown inside stays text. It's on the way; count them first, with `grep -rc 'markdown="1"' .`. A container (`::: name`) is ssqch's way to wrap Markdown in HTML.
- **HTML blocks** end at a blank line in CommonMark, and at their end tag in kramdown: keep blank lines out of HTML elements, or a line indented by four spaces inside one becomes code.
- **Heading ids:** kramdown's GFM ids keep accents and other letters, as ssqch's do; headings inside HTML get kramdown's ASCII ids (`section`, `section-1`).
- **Bold next to punctuation** (`**完成。**下一步`) closes in kramdown but not in CommonMark.
- **Code:** GitHub Pages adds Rouge's `class="language-plaintext highlighter-rouge"` to code; ssqch doesn't (`markdown: { highlight: true }` highlights, with its own classes). To keep those classes on code spans, write them in a `code` render hook: `_includes/hooks/code.liquid` with `<code class="language-plaintext highlighter-rouge">{{ code.code | escape }}</code>` ([Code spans](../markdown.md)).
- Smart quotes next to non-Latin letters, and non-ASCII characters in link URLs (which ssqch percent-encodes), come out differently; readers see the same page.

## Checking the move

`ssqch baseline "bundle exec jekyll build"` builds the Jekyll site three times from fresh copies, with the clock pinned, into `ref-1` to `ref-3`, and says what changes by itself (Jekyll prints `site.time`); then `ssqch diff ref-1 _site` lists the files that differ and how. Most of what's left after the steps above is Markdown: `markdown="1"`, then kramdown's spacing and quotes. `linksPlugin()` from `ssqch/links` checks every internal link and anchor on each build.
