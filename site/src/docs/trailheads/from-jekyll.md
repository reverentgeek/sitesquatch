---
title: "Trailhead: moving from Jekyll"
navTitle: "From Jekyll"
description: "Jekyll sites move well."
---
Jekyll sites move well: Liquid runs as it is, `_layouts/`, `_includes/` and `_data/` keep their names, and `redirect_from`, `relative_url`, `markdownify` and `jsonify` work. What takes the time is the Ruby around the templates (Jekyll's `page` and `site`, its plugins) and kramdown, Jekyll's Markdown.

opensource.guide (382 pages in 29 languages, on GitHub Pages' gem) was moved this way as a study: the same 478 files, 95% of pages with the same text, and builds 5.9 times faster. Two thirds of the work was kramdown's `markdown="1"`, which ssqch reads now: `markdown: { htmlMarkdown: "kramdown" }` (below).

## Scouting

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) lists what this guide describes for your site, with file and line, and drafts the mechanical part. It reads the files a fresh checkout has: ones git doesn't track (notes, a scratch folder) are left out of `passthrough`, and listed. Its draft is a first `ssqch.config.js` from `_config.yml`: Liquid for Markdown and HTML pages, `layouts_dir`, `trimAfterFrontMatter`, kramdown's Markdown options, `exclude` as `ignore`, the files Jekyll copies as they are (those without front matter) as `passthrough`, `site` read from `_config.yml`, the `defaults` for every page as data, and the plugins it knows (jekyll-sitemap, jekyll-redirect-from, jekyll-feed; Sass when there's a `_sass` folder or a stylesheet with front matter). It drafts directory data for `_posts` (the `posts` tag and the `permalink` style) and for each collection (its tag, its `defaults`, and its `permalink`, or none when `output` isn't true), and for the other folders `defaults` names. It turns on `jekyllTemplates`, so layouts, includes and pages keep Jekyll's `page` and `site` as they're written (`page.title`, `site.posts`, `site.data.locales`, `post.title`). For what the plugins wrote beside the pages it drafts `_includes/seo.liquid` (jekyll-seo-tag's tags), `redirects.liquid` (jekyll-redirect-from's `/redirects.json`), `robots.liquid` (jekyll-sitemap's `/robots.txt`, when the site has none) and a redirect hook with the new URL whole; for a GitHub Pages site, `site.url` from `CNAME` (as jekyll-github-metadata gave it) and Rouge's markup on code. Its edits are only what's mechanical: `{% seo %}` includes `_includes/seo.liquid`, a `.rss` or `.xml` layout becomes `.liquid`, and a file with front matter in another extension gets `render` and a permalink. It lists the rest with file and line: where Jekyll's `excerpt` and `sort` mean something else, Jekyll's own `page` keys (`page.next`), plugins' tags, kramdown's attribute lists (`{: .class}`), each `_plugins/*.rb` and what it registers, and what each plugin is in ssqch. It changes nothing on its own: `--write-draft` writes the draft and `--patch move.patch` the edits, to read and `git apply`. opensource.guide went from a fresh checkout to a full build with no hand edits this way, and 306 of its 404 pages matched Jekyll's.

```sh
ssqch scout                                   # what moving the site takes
ssqch scout --write-draft --patch move.patch  # write the draft, and the edits as a patch
git apply move.patch                          # after reading it
```

The [`jekyll-guides`](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/jekyll-guides/) example is a small Jekyll site laid out as Jekyll lays one out, with these settings: its layouts and pages are written for Jekyll and run as they are.

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
  markdown: { htmlMarkdown: "kramdown", headingIds: "kramdown", smartPunctuation: true, autolinks: false, encodeUrls: false },
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

- **`page`, `site` and front matter:** `jekyllTemplates: true` (scout's draft turns it on) gives templates Jekyll's `page` and `site`: `page.title` and the rest of the front matter, `site.posts` (newest first), `site.<collection>`, `site.data`, `site.categories` and `site.tags`, with items in Jekyll's shape (`post.title`, `post.content`, `post.excerpt`), so layouts and includes run as they're written. Without it, front matter is at the top level (`{{ title }}`), `page` has the file's facts (`page.url`, `page.inputPath`, `page.date`, `page.headings`), and items keep front matter under `data`; the build warns once for each `page.<key>` that's front matter.
- **`site.posts` and collections:** with `jekyllTemplates`, `site.posts` and `site.articles` are there as in Jekyll. ssqch's own names for them are `collections.posts` and `collections.articles` (a folder's directory data tags its pages `articles`), whose items keep front matter under `data` (`post.data.title`, `| where: "data.lang", "fr"`), with `post.templateContent` and `post.page.excerpt`.
- **Excerpts:** Jekyll's `excerpt` is the source up to `excerpt_separator` (the first blank line by default), rendered; ssqch's `page.excerpt` is the rendered page up to a `<!-- more -->` comment, or else its first paragraph. They're the same for a post that starts with a paragraph; for one that starts with a heading, a list or a quote, put `<!-- more -->` where Jekyll's separator was. `excerpt_separator: <!--more-->` in `_config.yml` is the same as ssqch's.
- **A language menu and hreflang links** (each page's translations, looked up in a loop over every page): ssqch has no built-in i18n yet. The Liquid loop works as it is, but it runs on every page; a filter that groups the pages once is faster, `translations: (pages, url) => ...` in the config's `filters` (`ssqch docs "Multilingual sites"`).
- **Jekyll's tags:** `{% highlight ruby %}...{% endhighlight %}` writes Jekyll's `<figure class="highlight">` with ssqch's highlighter, and `{% link _posts/2016-07-26-pine.md %}` and `{% post_url 2016-07-26-pine %}` are that page's URL (a path no page has is an error that names it). A site's own `highlight` function keeps that tag.
- **`site.data`:** `_data` is global data (`site.data.locales` is `locales` in ssqch); with `jekyllTemplates`, `site.data.locales` works too.
- **Includes:** `{% include nav.html section="home" %}` works, with `include.section`, and so does `{% include_relative parts/intro.md %}`. A file read by `include_relative` is a page of its own too, if it's Markdown: give its folder `permalink: false` in directory data.
- **Plugin tags** (`{% seo %}`, `{% feed_meta %}`): an include, or a function in `filters` that returns the HTML: the config's functions are Liquid tags (`{% seo title=false %}` calls `seo({ title: false })`). A function sees only what it's given, so pass it the page and the front matter it reads (`{% seo page, title, description %}`). `ssqch docs "From jekyll-seo-tag"` has an include that writes jekyll-seo-tag's tags.
- **Filters:** `relative_url`, `markdownify` and `jsonify` work, and `where` is fast. Math, `split` and blocks that only `assign` behave as in Ruby's Liquid (`"r>" | times: 1` is 0, which jekyll-toc depends on). `xml_escape` (`'` as `&apos;`), `normalize_whitespace`, `where_exp`, `group_by` and `sort` of a hash (into `[key, value]` pairs, by key) write what Jekyll's do. With a property, Jekyll's `sort` puts pages missing it first and ssqch's (Liquid's) last, so `sort` then handle the missing ones, or pass a list from the config. A whole float prints as `5` (Ruby writes `5.0`). `truncate` and `truncatewords` are Ruby's Liquid 4's. Front matter dates in Jekyll's form (`2009-12-25 10:41:06 +0000`) are read, and a key written twice is the last one, with a warning.
- **A table of contents:** `toc(page.headings, { class: "section-nav", itemClass: "toc-entry toc-h{level}" })` writes jekyll-toc's markup, so its CSS keeps working (`{{ page.headings | toc: class: "section-nav" }}` in Liquid). It reads the page's headings after it renders, so it goes in the layout.
- **Files with front matter:** Jekyll renders any file that starts with `---`. In ssqch a `.js` (or `.txt`) file needs an engine: `engines: { js: (s) => s }`, `"js"` in `templateFormats`, and `"render": "liquid,js"` with a `.js` permalink in that folder's directory data ("Text files with front matter" in [Templates and data](../templates.md)).

## Plugins

| Jekyll | ssqch |
| --- | --- |
| jekyll-redirect-from | `redirect_from` works (ssqch calls it `aliases`, and templates read it as `aliases`: `p.data.aliases`), with `redirectsPlugin()`; `_includes/hooks/redirect.*` for its page's markup (`ssqch scout` drafts jekyll-redirect-from's). Its `redirects.json` is a template of your own over `collections.all`. |
| jekyll-sitemap | `sitemapPlugin({ url: site.url })`; with an empty `url`, paths from the root, as jekyll-sitemap writes them, and a warning |
| jekyll-feed | `rssPlugin()` and a feed template |
| jekyll-seo-tag | A `seo` function (a tag), or an include with the tags you use |
| jekyll-toc | `toc(page.headings, ...)`, above |
| jekyll-github-metadata | Data in the config (`site.github.repository_nwo`) |
| github-pages' default theme (jekyll-theme-primer) | Nothing: it writes `/assets/css/style.css`. Check whether a page links to it. |

## Porting a site's own plugins

A Jekyll site's own Ruby plugins (`_plugins/*.rb`) can't run in ssqch, but each kind has an ssqch feature that does its job. `ssqch scout` lists each file with what it registers; port each to that feature, in a module of the site's own that the config imports (`lib/jekyll.js`), and build and compare with `ssqch diff` after each. www.ruby-lang.org's 8 plugins (705 lines of Ruby) became 572 lines of JavaScript.

| In the Ruby | What it is | In ssqch |
| --- | --- | --- |
| `Liquid::Template.register_filter(Module)` | A filter for each method of the module | A function in `filters`: `posted_by: (date, author) => ...`; the method's arguments are the function's |
| `Liquid::Template.register_tag("name", Class)` | A tag | A function in `filters` is a tag too: `{% translation_status %}` calls `translation_status()` and prints what it returns; a block tag's function gets the content first |
| `@context.registers[:site]`, `@context.environments.first["page"]` | The site or the page, read from Liquid's context | A function sees only its arguments: pass what it reads (`{{ post.date \| posted_by: post.author, lang }}`), or keep site-wide lists in the module, filled by a collection function |
| `class X < Jekyll::Generator` that adds `Jekyll::Page`s | Pages made from data (archives by year and month) | A collection function that returns one object per page (`{ url, layout, title, posts }`), and one template paginated over it with `size: 1` and a `permalink` from the item |
| `Jekyll::Hooks.register :site, :post_read` that sets `page.data[...]` | Data on every page | `computed` in the config's `data` |
| `Jekyll::Hooks.register :site, :post_write` that writes files | Files written after the build: a search index, `llms.txt` | `afterBuild`: a function, or a program (`{ run: "npx pagefind --site _site" }`) |
| `Jekyll::Converter` | A file type of its own | An engine for its extension (`engines`) |

What a plugin printed with Ruby's own methods (`strftime`, `Time#to_s`, `Hash` order) has to be written the same way in JavaScript: Ruby's `sort` isn't stable, and a whole `Float` prints as `4.0`. If Jekyll's build needs a file a tool writes first (a Tailwind `compiled.css` that's in `.gitignore`), put that step in the baseline's command (`ssqch baseline "npm run build-css && bundle exec jekyll build"`) and in ssqch's: `beforeBuild: [{ run: "npm run build-css" }]`.

## Markdown

ssqch's Markdown is CommonMark; Jekyll's is kramdown. `markdown: { smartPunctuation: true, autolinks: false, htmlMarkdown: "kramdown", headingIds: "kramdown", encodeUrls: false }` comes closest. What differs:

- **`markdown="1"`** on an HTML element (kramdown reads its content as Markdown): `htmlMarkdown: "kramdown"` reads it the same way, and keeps kramdown's HTML rules (a block element is raw to its end tag, blank lines and all). Without it, ssqch writes the element as it is and Markdown inside stays text. A container (`::: name`) is ssqch's own way to wrap Markdown in HTML.
- **Heading ids:** `headingIds: "kramdown"` gives kramdown's: its GFM ids for the page's headings (accents and other letters kept, emoji dropped), and its ASCII ids for headings inside `markdown="1"` HTML (`section`, `section-1`). Repeats are counted within each, where kramdown counts them across the page.
- **Bold next to punctuation** (`**完成。**下一步`) closes in kramdown but not in CommonMark.
- **Code:** GitHub Pages adds Rouge's `class="language-plaintext highlighter-rouge"` to code; ssqch doesn't (`markdown: { highlight: true }` highlights, with its own classes). To keep those classes on code spans, write them in a `code` render hook: `_includes/hooks/code.liquid` with `<code class="language-plaintext highlighter-rouge">{{ code.code | escape }}</code>` ([Code spans](../markdown.md)).
- **Link URLs:** ssqch percent-encodes non-ASCII characters in them (`#كتابة` as `#%D9%83...`) and kramdown keeps them; `encodeUrls: false` writes them as kramdown does. Smart quotes next to non-Latin letters can come out differently; readers see the same page.

## Checking the move

`ssqch baseline "bundle exec jekyll build"` builds the Jekyll site three times from fresh copies, with the clock pinned and the site's gems linked in (`.bundle` and its `BUNDLE_PATH`), into `.cache/ssqch/baseline/ref-1` to `-3`, with Jekyll's `site.time` pinned by a `time:` config of its own, and says what changes by itself; then `ssqch diff .cache/ssqch/baseline/ref-1 _site` lists the files that differ and how. Most of what's left after the steps above is Markdown: kramdown's spacing and quotes. `linksPlugin()` from `ssqch/links` checks every internal link and anchor on each build.
