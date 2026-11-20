---
title: "Trailhead: moving from Jekyll"
navTitle: "From Jekyll"
description: "Jekyll sites move well."
---
Jekyll sites move well: Liquid runs as it is, `_layouts/`, `_includes/` and `_data/` keep their names, and `redirect_from`, `relative_url`, `markdownify` and `jsonify` work. What takes the time is the Ruby around the templates (Jekyll's `page` and `site`, its plugins) and kramdown, Jekyll's Markdown.

opensource.guide (382 pages in 29 languages, on GitHub Pages' gem) was moved this way as a study: the same 478 files, 95% of pages with the same text, and builds 5.9 times faster. Two thirds of the work was kramdown's `markdown="1"`, which ssqch reads now: `markdown: { htmlMarkdown: "kramdown" }` (below).

## Importing

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch.

`ssqch import jekyll` does the mechanical part of this guide (`--write` makes the changes; without it, it says what it would do). It reads the files a fresh checkout has: ones git doesn't track (notes, a scratch folder) are left out of `passthrough`, and listed. It writes a first `ssqch.config.js` from `_config.yml`: Liquid for Markdown and HTML pages, `layouts_dir`, `trimAfterFrontMatter`, kramdown's Markdown options, `exclude` as `ignore`, the files Jekyll copies as they are (those without front matter) as `passthrough`, `site` read from `_config.yml`, the `defaults` for every page as data, and the plugins it knows (jekyll-sitemap, jekyll-redirect-from, jekyll-feed; Sass when there's a `_sass` folder or a stylesheet with front matter). It writes directory data for `_posts` (the `posts` tag and the `permalink` style) and for each collection (its tag, its `defaults`, and its `permalink`, or none when `output` isn't true), and for the other folders `defaults` names. In layouts, includes and pages, `page.title` and every other front matter key become `title`, `site.posts` and each collection (`site.articles`) become `collections.posts` and `collections.articles`, with what's read from their items under `data` (`article.title` is `article.data.title`, `article.content` is `article.templateContent`, `where: "lang"` is `where: "data.lang"`), wherever a loop or an `assign` over the collection names the items; `site.data.locales` becomes `locales`; and a template's own variable with one of those names (`{% assign lang = ... %}` beside `page.lang`, `{% assign locales = site.data.locales | sort %}`) becomes `my_lang` or `my_locales` in that file, since Liquid's `assign` is global and would replace the page's value for every include after it; `{{ page.path }}` becomes `{{ page.inputPath | remove_first: "./" }}`, and `{% seo %}` includes `_includes/seo.liquid`, which it writes (jekyll-seo-tag's tags). It lists the rest with file and line: each variable it renamed (an include that reads it without assigning it needs the new name too), Jekyll's own `page` keys (`page.content`, `page.next`), plugins' tags, kramdown's attribute lists (`{: .class}`), files with front matter Jekyll renders (`.js`), and what each plugin is in ssqch. opensource.guide went from a fresh checkout to a full build (382 pages in 0.3 s) with it, the language menus and Markdown spacing left to do.

```sh
ssqch import jekyll            # what would change, and what's left
ssqch import jekyll --write    # make the changes
```

## Build it both ways first

Build the Jekyll site from a fresh checkout twice and compare the two: a page that prints the build's time (an undated article gets `site.time`) differs on every build. Pin it with a second config file holding `time: 2026-01-01 00:00:00 +0000` (`jekyll build --config _config.yml,pin.yml`), and build ssqch with the same time: `SOURCE_DATE_EPOCH=1767225600`. GitHub Pages' gem needs `PAGES_REPO_NWO=owner/repo` in a checkout without a git remote. Then build with ssqch into an empty folder and compare the two with `ssqch diff jekyll-site ssqch-site`.

## The config

Start with `templateFormats: ["liquid", "md", "html"]`, `markdownEngine: "liquid"` and `htmlEngine: "liquid"`, so Markdown and HTML pages run through Liquid first, as in Jekyll, `dirs: { layouts: "_layouts" }`, and `trimAfterFrontMatter: true`, so a layout's body starts where Jekyll's does (Jekyll drops the blank lines after the closing `---`).

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
  trimAfterFrontMatter: true,
  // kramdown's habits: markdown="1", its heading ids, smart quotes, no bare-URL links.
  markdown: { htmlMarkdown: "kramdown", headingIds: "kramdown", smartPunctuation: true, autolinks: false },
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
- **Plugin tags** (`{% seo %}`, `{% feed_meta %}`): an include, or a function in `filters` that returns the HTML: the config's functions are Liquid tags (`{% seo title=false %}` calls `seo({ title: false })`). A function sees only what it's given, so pass it the page and the front matter it reads (`{% seo page, title, description %}`). `ssqch docs "From jekyll-seo-tag"` has an include that writes jekyll-seo-tag's tags.
- **Filters:** `relative_url`, `markdownify` and `jsonify` work, and `where` is fast. Math, `split` and blocks that only `assign` behave as in Ruby's Liquid (`"r>" | times: 1` is 0, which jekyll-toc depends on). `xml_escape` (`'` as `&apos;`), `normalize_whitespace`, `where_exp`, `group_by` and `sort` of a hash (into `[key, value]` pairs, by key) write what Jekyll's do. With a property, Jekyll's `sort` puts pages missing it first and ssqch's (Liquid's) last, so `sort` then handle the missing ones, or pass a list from the config. A whole float prints as `5` (Ruby writes `5.0`).
- **A table of contents:** `toc(page.headings, { class: "section-nav", itemClass: "toc-entry toc-h{level}" })` writes jekyll-toc's markup, so its CSS keeps working (`{{ page.headings | toc: class: "section-nav" }}` in Liquid). It reads the page's headings after it renders, so it goes in the layout.
- **Files with front matter:** Jekyll renders any file that starts with `---`. In ssqch a `.js` (or `.txt`) file needs an engine: `engines: { js: (s) => s }`, `"js"` in `templateFormats`, and `"render": "liquid,js"` with a `.js` permalink in that folder's directory data ("Text files with front matter" in [Templates and data](../templates.md)).

## Plugins

| Jekyll | ssqch |
| --- | --- |
| jekyll-redirect-from | `redirect_from` works (ssqch calls it `aliases`), with `redirectsPlugin()`; `_includes/hooks/redirect.*` for its page's markup |
| jekyll-sitemap | `sitemapPlugin({ url: site.url })`; with an empty `url`, paths from the root, as jekyll-sitemap writes them, and a warning |
| jekyll-feed | `rssPlugin()` and a feed template |
| jekyll-seo-tag | A `seo` function (a tag), or an include with the tags you use |
| jekyll-toc | `toc(page.headings, ...)`, above |
| jekyll-github-metadata | Data in the config (`site.github.repository_nwo`) |
| github-pages' default theme (jekyll-theme-primer) | Nothing: it writes `/assets/css/style.css`. Check whether a page links to it. |

## Markdown

ssqch's Markdown is CommonMark; Jekyll's is kramdown. `markdown: { smartPunctuation: true, autolinks: false, htmlMarkdown: "kramdown", headingIds: "kramdown" }` comes closest. What differs:

- **`markdown="1"`** on an HTML element (kramdown reads its content as Markdown): `htmlMarkdown: "kramdown"` reads it the same way, and keeps kramdown's HTML rules (a block element is raw to its end tag, blank lines and all). Without it, ssqch writes the element as it is and Markdown inside stays text. A container (`::: name`) is ssqch's own way to wrap Markdown in HTML.
- **Heading ids:** `headingIds: "kramdown"` gives kramdown's: its GFM ids for the page's headings (accents and other letters kept, emoji dropped), and its ASCII ids for headings inside `markdown="1"` HTML (`section`, `section-1`). Repeats are counted within each, where kramdown counts them across the page.
- **Bold next to punctuation** (`**完成。**下一步`) closes in kramdown but not in CommonMark.
- **Code:** GitHub Pages adds Rouge's `class="language-plaintext highlighter-rouge"` to code; ssqch doesn't (`markdown: { highlight: true }` highlights, with its own classes). To keep those classes on code spans, write them in a `code` render hook: `_includes/hooks/code.liquid` with `<code class="language-plaintext highlighter-rouge">{{ code.code | escape }}</code>` ([Code spans](../markdown.md)).
- Smart quotes next to non-Latin letters, and non-ASCII characters in link URLs (which ssqch percent-encodes), come out differently; readers see the same page.

## Checking the move

`ssqch baseline "bundle exec jekyll build"` builds the Jekyll site three times from fresh copies, with the clock pinned and the site's gems linked in (`.bundle` and its `BUNDLE_PATH`), into `.cache/ssqch/baseline/ref-1` to `-3`, with Jekyll's `site.time` pinned by a `time:` config of its own, and says what changes by itself; then `ssqch diff .cache/ssqch/baseline/ref-1 _site` lists the files that differ and how. Most of what's left after the steps above is Markdown: kramdown's spacing and quotes. `linksPlugin()` from `ssqch/links` checks every internal link and anchor on each build.
