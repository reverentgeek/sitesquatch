# Changelog

SiteSquatch follows [semantic versioning](https://semver.org). While it's at 0.x, a release that
breaks existing sites bumps the minor version (0.2.0 to 0.3.0), and everything else bumps the
patch version (0.2.0 to 0.2.1). Breaking changes are listed under **Breaking**, with what a site
has to change.

The version is `version` in `packages/ssqch/package.json` (up to 0.7, `[workspace.package]
version` in `Cargo.toml`, shared by every crate). A release is a `v<version>` tag on a commit
where that version matches.

## Unreleased

### Added
- `feedPlugin({ url })` from `ssqch/rss` writes the site's feed: Atom (or `format: "rss"`) at
  `/feed.xml`, from the `posts` collection, newest first (`limit`, default 20), each entry's
  content as `feedHtml()` makes it, its title and subtitle from the site's data. A new blog wrote
  its feed by hand in a template (the new-blog fresh run did it from memory). The blog starter
  uses it in place of its feed template.
- `ssqch serve` ends a build that's stopped making progress for a minute (no page written, no
  image encoded, none of the site's code starting or settling), and says what it waited on:
  `in src/index.jinja: the build stopped making progress: for 60 s nothing happened, and it was
  waiting on filter \`latest\` (rendering src/index.jinja)`. A promise that never settled, while a
  `setInterval` kept Node running, wedged every rebuild after it with no word. Code that never
  returns is ended too (`the build stopped answering`). A `run` command isn't counted.
- `ssqch serve --host 0.0.0.0` listens on every network the machine is on, so the site opens on
  a phone, and prints the address for it: `On your network: http://192.168.1.20:8080/ (anyone on
  it can see the site)`. `--host <address>` listens on that one. The default is still
  `127.0.0.1`. `ssqch serve --built` takes it too.

### Changed
- `ssqch init` makes a `package.json` that's there ready for the site: `"type": "module"`, which
  the config's `export default` needs (`npm init -y` on npm 12 writes `"type": "commonjs"`, and
  every command warned `Failed to load the ES module ... ssqch.config.js`), and `build` and
  `serve` scripts that aren't there, said as `updated package.json: ...`. A project with
  JavaScript of its own keeps its `type` and gets `ssqch.config.mjs`. A config that's there under
  any of its names is kept. Without a `package.json`, none is written.
- The blog starter (`ssqch init`) is a blog: its posts have tags, with a page for each tag
  (`/tags/stumps/`) and one listing them (`/tags/`), each post links its tags, and an Atom feed
  is at `/feed.xml` (`feedPlugin()`), linked from every page.
  Code is highlighted (`markdown: { highlight: true }`, and the layout links `/highlight.css`),
  and `leaveNoTrace: true` deletes a removed post's page. The same in every `--engine`.
- The docs starter's search is Pagefind's Component UI (a search button and dialog, Ctrl+K or
  Cmd+K), in the theme's colors in light and dark, with Pagefind pinned to 1.6.0: it was the
  newest Pagefind, whose 1.5 and later print a notice about the old UI. Its install page says
  how to try search locally (`SEARCH=1 npx ssqch build`, then `npx ssqch serve --built`). Both
  starters have a tab icon, the footprint.
- Both starters show a date a reader can see: each docs page ends with "Last updated" (its
  `page.lastModified`, from git), and each post shows its date under the title, with "updated"
  when it last changed on a later day. The starters set `lastModified: "git"`, and the docs
  starter's GitHub Pages workflow checks out the whole history (`fetch-depth: 0`).
- `lastModified: "git"` in a folder that isn't a repository yet uses the files' times quietly; it
  warned on every build (`not a git repository, so pages use their files' times`), which every
  new site met before `git init`. `SOURCE_DATE_EPOCH` pins a `page.lastModified` that comes from
  a file's time, as it does an undated page's date.
- The blog starter's second post has its photo: a blurry one of something tall between the
  birches, which the post insists is the stump. It shows the image plugin on a real picture (a
  `<picture>` in three sizes, and one copy in the feed).

### Fixed
- A Markdown copy (`llmsPlugin()`) keeps picture paths in code as they're written: a code span
  or fenced block showing `![The stump](/img/stump.jpg)` got the published file's name, as the
  page's own picture does.
- A footnote in a page's Markdown copy (`llmsPlugin()`'s `index.md` and `llms-full.txt`) keeps
  its text: `[^1]: Two raccoons agree.` was read as a link definition and written as
  `[^1]: https://example.com/post/Two raccoons agree.`, which `ssqch patrol` then reported as
  `copy-broken`. Patrol doesn't read a footnote as a link either.
- Other generators' filters that work in ssqch (`url`, `relative_url`, `markdownify`) work in
  Edge too, as calls: `{{ url("/about/") }}` was an error (`` `url` is not a function ``) while
  Jinja, Nunjucks and Liquid took it. `{{ url }}` in Edge is still the page's data.
- The build summary's `Pages` size is what's on disk after the `afterBuild` hooks, which can
  minify the pages (it said 4.43 MB for 4.07 MB).
- `ssqch diff` shows text printed unescaped that browsers read as a tag with a name no element
  has (a Python repr, `<httpx._client.UseClientDefault object at 0x10>`) as it's written, not
  lowercased with its words sorted as attributes.
- `ssqch scout`'s config draft says "what it couldn't carry over is listed at the end" only when
  there's a list at the end.
- `ssqch serve` sees an edit made during its first build: the watch began after it, so a page
  edited after the build read it was served as it was until the next edit, with no word why (an
  agent that edits as soon as a page answers lands there).
- `ssqch serve` reads a config saved after its build process loaded it and before the watch
  began (during a reload's first build), where it was missed until the next save.
- An editor's own files start no rebuild while serving: `sed -i`'s `.!12345!post.md`, backups
  (`post.md~`), Emacs' locks, Vim's swap files and JetBrains' safe writes. The server said
  `Fresh tracks in src/posts/.!64277!post.md` and rebuilt for nothing.
- A front matter `date` that isn't one (`date: last Tuesday`) is a `front-matter` error that
  points at its line (`src/t.md: \`date\` isn't a date: "last Tuesday". Write it as
  2026-11-22, ...`), listed with the page's schema errors. It was `in t.md: can't parse date
  "last Tuesday"`, with the code `build`, no line, and the page's other mistakes unsaid.
- A page open in a browser asks a stopped `ssqch serve` less and less often (up to every 10 s),
  and says so once in the console; it asked every 0.7 s, and logged an error each time.
- `ssqch build` and `ssqch serve` print the summary without a line for each page:
  `[ssqch] Writing ./dist/index.html from ./src/index.jinja (jinja)` comes with `--verbose`.
  opensource.guide printed 404 of them on every build, and a dev server every one of its pages on
  every save, which an agent reads as tokens and a person scrolls past. Images still say when
  they're encoded.
- Output conflicts are one line for each pair of templates, with how many paths and the first
  three (a paginated template whose pages share a permalink printed a line for every page), from
  the site's root rather than as absolute paths; a template that conflicts with itself says to
  give its pages a part of their own (`{{ pagination.pageNumber }}`).
- Edge's `$loop` has edge.js's `isFirst` and `isLast` as well as `first` and `last`: `isLast` was
  undefined, with no warning, so `{{ $loop.isLast ? "" : ", " }}` put a comma after every item.

## 0.13.4 - 2026-11-22

### Added
- `ssqch patrol --url https://example.com` asks the deployed site too: up to ten of the build's
  pages with a Markdown copy (the same ten each run), each as an agent (`Accept: text/markdown`)
  and as a browser, and its copy at its own address. New warnings: `live-no-markdown` (the agent
  gets HTML), `live-no-vary` (no `Vary: Accept`), `live-browser-markdown` (people get the copy)
  and `live-copy-missing`. The JSON report adds `live` (`url`, `asked`) when it's given.

### Fixed
- Every named HTML entity is decoded where ssqch reads a page's text: `llmsPlugin()`'s copy of a
  template page and its titles, and a heading's text (`page.headings`, the `toc` filter). Only six
  were (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`), so `3 posts &middot;` became
  `3 posts \&middot;` in a copy, which an agent reads as those letters. The table is `he`'s,
  which the package already bundled for Edge.

## 0.13.3 - 2026-11-22

### Changed
- `ssqch patrol`'s `copy-differs` leaves a page's `<nav>` elements out when it compares the page
  with its Markdown copy: breadcrumbs, a pager or a map of the site inside `<main>` is navigation
  the layout adds, not what the page says. A layout's map that isn't in a `<nav>` still counts.
- `copy-differs` compares a copy with the page's own part as `llmsPlugin()` reads it (its one
  `<article>`, so a post's related posts and comments around it don't count), and reads a
  minified page as a browser shows it: `2017</span></li><li>Community` was one word, so a
  minified list's copy looked like it said something else.

### Fixed
- `llmsPlugin()`'s copy of a page with several `<article>`s (a list of posts, each a card) is
  the page's `<main>`, not the first card: a blog's topic pages were copied as their newest post.
- The code on "Serving Markdown" names a folder's page with its slash in the `Link` header
  (`/about` is `/about/`), and is checked on Netlify now (the ReverentGeek blog).

## 0.13.2 - 2026-11-22

### Changed
- Liquid's `where` looks a value up instead of going through the whole list each time, when the
  list's items are plain objects and the values are text, numbers or `nil`: a multilingual layout
  that finds each language's pages (`site.articles | where: "lang", lang` in a loop) builds about
  a third faster (the bench's Liquid case, 1.63 s to 1.07 s; opensource.guide, 1.30 s to 1.05 s,
  with the same output). The answers are liquidjs' own, and each page looks again, so a list a
  site changes between pages is read as it is.
- The starters' layouts link the `llms.txt` that covers each page, `llmsTxt(page.url)`, in
  place of `/llms.txt`, so a starter site that gives a part of itself an `llms.txt` of its own
  (`llmsPlugin({ paths })`) points each page at the right one. Their output is the same until
  then.

### Fixed
- A `%` in a Markdown link or image URL that doesn't start an escape is written `%25`, as
  CommonMark's reference implementation and markdown-it write it:
  `[spec](https://tc39.es/ecma262/#sec-%arrayiteratorprototype%-object)` was an invalid URL. An
  escape (`%2F`, `%C3%A9`) stays as it is, and a link hook's `link.href` is still the URL as the
  page wrote it.
- `ssqch diff` reads a bare `%` and `%25` as the same, where the `%` doesn't start an escape
  (`/100%` and `/100%25`), as it already did the rest of percent-encoding.

## 0.13.1 - 2026-11-21

### Added
- **A big site's `llms.txt`** (llms.txt's v2, August 2026): `llmsPlugin({ paths: ["/docs/"] })`
  gives a part of the site an `llms.txt` of its own, which covers the pages under it and which
  `/llms.txt` lists in their place; a section named "Optional" (links an agent can skip) always
  comes last; and past `budget` characters (default 50,000, where `ssqch patrol` warns), pages
  from the end move into "Optional" without their descriptions. A file that can't fit warns.
  The template function `llmsTxt(page.url)` gives the `llms.txt` that covers a page, for the
  layout's `<link rel="describedby">`.
- `ssqch patrol` checks every `llms.txt` that `/llms.txt` links, and counts their pages for
  `llms-coverage`.

## 0.13.0 - 2026-11-21

### Breaking

- `llmsPlugin()` no longer has `hint`, the hidden `<div>` it wrote at the top of each page's
  `<body>`: hidden text written for models reads as cloaking, and a build adds no markup of its
  own. A config that sets it fails with what to write instead: the plugin's new template function,
  `markdownCopy(page.url)`, in the layout's `<head>`:
  `<link rel="alternate" type="text/markdown" href="{{ markdownCopy(page.url) }}">`.
- `llmsPlugin()`'s copies are what the page says, not the file it came from. A Markdown page's
  copy is its Markdown after its template engine ran, so `{{ site.title }}` is the title and a
  `{% for %}` is the list it wrote (before, a copy had the template code in it). Pages that aren't
  Markdown (a home page in Jinja) are listed now too, with their `<article>`, `<main>` or `<body>`
  as Markdown. Links in a copy are whole addresses, and a link to a page that has a copy goes to
  the copy. Its pictures, and links to them, are the files the page shows (`imagePlugin()`'s
  resized copies, where the source isn't published). A page leaves the list with `llms: false` in its front matter, or with `exclude`.
- `llms-full.txt` starts with `llms.txt`'s heading and description, then the pages.
- `llmsPlugin()` writes a page's copy where llms.txt's v2 proposal (August 2026) puts it: a URL
  without a file name gets `index.md` (`/guide/intro/` is `/guide/intro/index.md`, where it was
  `/guide/intro.md`); one with a file name has its extension replaced (`/guide/intro.html` is
  `/guide/intro.md`, as before). `markdownCopy(page.url)` gives the new address.
- Options that were there only so a move could match another generator's bytes are gone, each
  with an error that says what to do instead:
  - `trimAfterFrontMatter`. The blank lines after a template's front matter are whitespace that
    browsers and `ssqch diff` don't see. Where one matters (a feed that has to start with `<?xml`,
    a text file), take it out of that template; `ssqch scout --patch` does it for a Jekyll site.
  - `markdown.encodeUrls`. Link and image URLs are percent-encoded, as CommonMark writes them;
    browsers go to the same place either way.
  - `sitemapPlugin({ format: "vitepress" })`. The sitemap is ssqch's own, with the same URLs.
- `sitemapPlugin()` needs `url`: a sitemap of paths from the root (what it wrote without one, as
  jekyll-sitemap does) is one search engines can't read. A build without it stops and asks for the
  site's address, where it used to warn on every build. `ssqch scout` leaves the plugin commented
  out in a Jekyll draft until `_config.yml` has a `url`.
- `ssqch inspect` is `ssqch trace`: it follows a page's values back along their tracks through
  the data cascade. The options and the JSON are the same. `ssqch inspect` is refused with the
  new name, and the starters' `AGENTS.md`, the completions and the docs say `trace`.
- "First confirmed siting." is "First confirmed sighting.", spelled as `ssqch sighting` is, and so
  are `ssqch sighting`'s own lines ("Last confirmed sighting", "No confirmed sightings here
  yet"). A script that looked for the old spelling in the build summary needs the new one.
- Another generator's options are modules now, each a plugin documented in its trailhead (the
  audit's plan, step 6), so a site that doesn't move from one never meets them. Each old name is
  refused with its module's:
  - `jekyllTemplates: true` and `markdown: { htmlMarkdown: "kramdown" }`: `fromJekyll()` from
    `ssqch/from-jekyll` (both on by default; `templates: false` or `kramdown: false` for one).
  - `mkdocsTemplates`, and `markdown: { dialect: "python-markdown" }`, `admonitions: "mkdocs"` and
    `tabs: "mkdocs"`: `fromMkdocs()` from `ssqch/from-mkdocs` (`templates: true` for the theme's
    context, `config` for another mkdocs.yml).
  - `markdown: { dialect: "vitepress" }`: `fromVitepress()` from `ssqch/from-vitepress`.
  - `markdown: { shortcodes: "hugo" }`: `fromHugo()` from `ssqch/from-hugo`.

  Add the module to `plugins` and leave the option out; the module's Markdown settings are
  defaults, so the site's own `markdown` still changes one (`headingIds: false`). `ssqch scout`
  drafts the modules. The `jekyll-guides` example uses `fromJekyll()`.
- `markdown: { containers: "markdown-it" }` is what `containers: true` does now: a closing `:::`
  indented less than four spaces closes the innermost open container, so Prettier's `:::` under a
  list closes it. The old value is refused; write `true`, or leave it out. Every site in the oracle
  builds the same.
- `vuePlugin({ vitepress })` is gone, and a `.vitepress` folder no longer turns VitePress's ways on
  by itself: `fromVitepress()` does, before or after `vuePlugin()` in `plugins` (VitePress's
  `useData()` stand-in, `@theme/`, and `./x.data` imports running its data loaders). The vuejs.org
  port builds byte for byte the same with both plugins.
- `clean` is no longer another name for `leaveNoTrace` in `ssqch.config.js` (a rename replaces the
  old name): it's refused with ssqch's name, as the `clean` command is. `sitesquatch.toml` keeps
  it.

### Fixed

- The dev server and `ssqch serve --built` send a `.md` file as `text/markdown; charset=utf-8`,
  where they sent `application/octet-stream`.
- `ssqch diff` reads a URL the same percent-encoded or not (`#كتابة` and `#%D9%83...`, `café.png`
  and `caf%C3%A9.png`), as browsers do. ASCII that means something in a URL (`%2F`) still counts.
- `ssqch docs "<heading>"` answers with a trailhead's section when that's the heading's own page,
  rather than with a page that only mentions the words (`ssqch docs "From jekyll-seo-tag"`).

### Added

- `ssqch patrol [DIR]` checks a build for what agents and crawlers read, in any generator's
  output: the posted signs (`robots.txt`, a sitemap, `llms.txt`, a real `404.html`), each page's
  shape (one `<h1>`, its content in `<main>` or `<article>` and before the navigation, a
  description), and each page's Markdown copy (there when it's linked, saying what its page says,
  under the length an agent's fetch reads, its code fences closed, its links whole, and the site's
  own files it links there). Each warning
  has a code (`ssqch docs "what patrol checks"`), `--format json` gives them with every file, and
  it exits with 0 when it found nothing, 1 when it warned and 2 on an error. On the ReverentGeek
  blog, its first real site, it found two links in the hand-written `llms.txt` to pages that
  aren't there.
- `robotsPlugin()` from `ssqch/robots` writes `robots.txt`: the paths no crawler reads
  (`disallow`), the sitemap's address from `sitemapPlugin()`, and what AI crawlers may do by what
  they're for (`ai: { training, search, fetch }`), from one table of their names, each from its
  company's documentation. A docs page, "Posted signs", lists them.
- The starters are ready for agents: `sitemapPlugin()`, `robotsPlugin()` and `llmsPlugin()` are on
  (with the site's `url` in `src/_data/site.json`), and the layouts link each page's canonical
  address, its Markdown copy and `llms.txt` (`rel="describedby"`). The docs starter's pages have
  "View as Markdown" and a "Copy as Markdown" button, and the blog starter's home page an `<h1>`.
  Their `AGENTS.md` names `ssqch patrol`.
- `ssqch check`, refused with ssqch's word, names `ssqch patrol` too.
- A plugin can add to ssqch's Markdown: `markdown: { before, after, hooks }` (the page's Markdown
  before ssqch's reads it, the HTML after, and render hooks and containers as functions, which a
  site's own template of the same name replaces), and `defaults: { markdown }`, options for any
  key the site's own `markdown` doesn't set. Each step gets the page and the engine's tools
  (`markdown()`, `renderHook()`, `hasHook()`). A new docs page, "Writing a plugin", has a worked
  example.
- `fromVitepress()` from `ssqch/from-vitepress` is VitePress's Markdown as a plugin of that kind:
  the same steps, hooks and defaults as `markdown: { dialect: "vitepress" }`, which it replaces
  (the vuejs.org port builds byte for byte the same with either). `ssqch scout` drafts it.
- `fromMkdocs()` from `ssqch/from-mkdocs` is MkDocs' Markdown as one plugin (Python-Markdown's
  reading, admonitions, tabs, toc's ids and `.md` links from the page, each a default under the
  site's own `markdown`), and with `templates: true` what `mkdocsTemplates` gives an MkDocs
  theme's templates. The httpx docs, with Material's own templates, build byte for byte the same
  with it as with those options and `mkdocsTemplates` written out. `ssqch scout` drafts it.
- `fromJekyll()` from `ssqch/from-jekyll` is what a Jekyll site's templates and Markdown expect,
  as one plugin: Jekyll's `page` and `site` in templates (what `jekyllTemplates` did), and
  kramdown's habits as defaults under the site's own `markdown` (`markdown="1"`, its heading
  ids, smart quotes, no bare-URL links). www.ruby-lang.org's port (7,647 pages) builds the same
  with it as with those options written out, and the `jekyll-guides` example uses it with its
  output unchanged. `ssqch scout` drafts it.
- `fromHugo()` from `ssqch/from-hugo` reads Hugo's shortcodes as containers, as
  `markdown: { shortcodes: "hugo" }` does, as a default under the site's own `markdown`.
  `ssqch scout` drafts it.
- `ssqch serve` and `ssqch serve --built` answer a request for a page with its Markdown copy
  when the request asks for `text/markdown` by name, at a q-value at least HTML's, as Claude Code,
  Cursor and OpenCode do: `text/markdown; charset=utf-8`, with `Vary: Accept` on both of a page's
  answers. A browser's request (and curl's `*/*`) gets the page. A new docs page, "Serving
  Markdown to agents", has the same for Cloudflare (sitesquatch.dev's own Worker), Netlify (an
  edge function) and Vercel (Routing Middleware), ready to paste, and what GitHub Pages does
  instead.
- `llmsPlugin()`: `details` (Markdown after the description: what a model should know first),
  `sort` (the pages' order), and the template function `markdownCopy(page.url)`, the URL of a
  page's copy, or an empty string when it has none.

### Changed

- Options' descriptions say what each does first, and another generator's name for it last
  (`urls`, `jinja`, `layoutAliases`, `breaks`, `figures`, `sassPlugin({ charset })`). The Markdown
  page says why ssqch keeps other generators' heading id styles: an id is part of a URL others
  link to.
- The docs pages have display titles, with their plain words after the theme: "Gear up:
  install", "The gear shed: built-in plugins", "Getting spotted: SEO tags", "Following the tracks:
  where a value comes from", "Has the stump moved? Comparing two builds", "Out of the woods:
  deploying" and "Uncharted territory: known gaps". `ssqch docs` finds each by either, and names
  it by the plain words (`ssqch docs "SEO tags"`). The first group of the docs is "Base camp", and
  sitesquatch.dev's changelog is the "Trail log".
- When builds made the same way differ, the report starts its last line with "The eyewitness
  accounts differ:" (`ssqch diff` with three builds, and `ssqch baseline`).
- `rssDate` and `rssLastUpdatedDate` (the Eleventy RSS plugin's first names, with `rssPlugin()`)
  are aliases: they work as before, and say ssqch's names once (`dateToRfc3339`,
  `getNewestCollectionItemDate`).
- jekyll-seo-tag's include moved from "SEO tags" to the Jekyll trailhead.
- `llmsPlugin()` knows nothing of VitePress: `<script>` and `<style>` blocks are left out of every
  copy (a VitePress page's `<script setup>` among them), and so are pictures with `alt=""`.

## 0.12.0 - 2026-11-21

### Added

- `markdown: { shortcodes: "hugo" }` reads a Hugo shortcode inside a line of text too, through
  the same container template as one on a line of its own: `Added in {{< new-in 0.148 />}}`,
  `[About]({{< ref "about" >}})` and `{{% kbd %}}Ctrl{{% /kbd %}}` render
  `_includes/containers/<name>.*` in place, with `container.inline` true and what's between a
  pair's tags as `container.content`. In a heading, the call leaves the id alone. A call with no
  template is left as written, as before. The gohugo.io move had calls like these in 65 files and
  no way to give them a template, and `ssqch scout` drafts one for each of the site's own.
- With `admonitions: "mkdocs"` and `tabs: "mkdocs"`, a title is inline Markdown, as
  Python-Markdown reads it: `=== "\`base.html\`"` labels its tab with `<code>`, and
  `??? tip "Read [the guide]"` links with the page's reference definition. Before, a title was
  plain text (27 of Material for MkDocs' pages have one with code or a link).

- `urls: "html"` builds a page without a permalink as `/guide/intro.html` instead of
  `/guide/intro/`, as VitePress does without `cleanUrls` (and Hugo with `uglyURLs`); an index
  page is still its folder. vuejs.org's move set a global permalink for it. `uglyURLs` and
  `cleanUrls` in the config say what ssqch calls it.
- `markdown: { autolinks: "email" }` links URLs and email addresses but not bare domains, as
  VitePress's markdown-it does (`fuzzy` made `Dev.to` a link on one of vuejs.org's pages).
- `markdown: { containers: "markdown-it" }` closes a container at a `:::` indented under the
  list it ends, as markdown-it-container does: Prettier writes them that way, and 20 of
  vuejs.org's pages failed on one.
- `markdown: { preprocess: (source, data) => source }` changes a page's Markdown before ssqch
  reads it (Vue's `<script setup>` blocks out, say). The vuejs.org move used an engine for it.
- `_includes/hooks/table.*` writes a Markdown table, with its rows as `table.content`:
  VitePress's `<table tabindex="0">`.
- `sitemapPlugin({ format: "vitepress" })` writes the sitemap VitePress does, byte for byte.
- While serving, `beforeBuild` and `afterBuild` get `changed`, the files whose change started the
  build, so a hook can skip work an edit doesn't touch: vuejs.org's Vite build of its components
  took a rebuild from 343 ms to 867 ms when only Markdown had changed.

- Components as HTML tags: a PascalCase tag in a page or a layout (`<Badge type="tip" />`,
  `<VueSchoolLink href="...">Watch</VueSchoolLink>`) renders `_includes/components/<Name>.*` in
  its place, with `component.props` (Vue's `:bound` attributes read against the page's data),
  `component.content` and `component.attrs`. One with no template is a warning that names its
  pages. VitePress, Astro and MDX pages use components this way: the vuejs.org move rebuilt its
  two presentational ones with 51 lines of a transform.

- `markdown: { dialect: "vitepress" }` reads and writes Markdown as VitePress does: Vue's
  `<script>` and `<style>` blocks and `<ClientOnly>` left out, `-vue` fences, and VitePress's
  markup as built-in render hooks and containers that a site's own templates replace (heading
  anchors, `.html` links and external ones in a new tab, code blocks with the copy button and
  language label, tables, `tip`, `info`, `warning`, `danger`, `details`, `raw` and `code-group`),
  `[[toc]]` in any case, and VitePress's heading ids (`headingIds: "vitepress"`, which works on
  its own too). On vuejs.org it replaces three hooks, six container templates, a preprocess
  engine and about 80 lines of filters.

- `ssqch scout` reads VitePress sites in depth, and drafts their config: `srcDir` and
  `srcExclude` (so it counts the pages VitePress builds: vuejs.org's run counted every `.md` in
  the repository), `cleanUrls`, the sitemap, `head`, markdown-it plugins, and what the pages use,
  each with what ssqch does for it (Vue's `<script setup>`, containers, Prettier's indented `:::`,
  each component by name with its `.vue` file and whether it has state, the front matter the
  theme reads, data loaders named like ssqch's data, dynamic routes). The draft turns on
  `dialect: "vitepress"`, `urls: "html"`, `ignore` for the loaders, `public/` and the sitemap, and
  a component counts as done once it has a template; the reference build uses the site's package
  manager (`pnpm run build`). On vuejs.org, 57 to-dos became 44 with the draft written, and the
  draft built the site first time. A trailhead of its own: `ssqch docs --from vitepress`.

- `llmsPlugin()` from `ssqch/llms` writes the site for language models, as llmstxt.org describes
  it: `/llms.txt` lists the pages that came from Markdown with links to their Markdown, each gets
  a Markdown copy beside its URL (`/guide/intro.md`), and `/llms-full.txt` has them all. A hidden
  link to the copy in each page is opt-in (`hint: true`). vitepress-plugin-llms wrote 96 files
  that the vuejs.org move left out.

- `ssqch diff <before> <after> --text` says how much of each page's article text matches, word
  by word: the number for a move that can't be byte for byte (vuejs.org's: 99.9% of 125,249
  words, 99 of 109 pages identical, which the move measured with a script of its own).
- `ssqch baseline` says, for a site that builds with Vite, that the copies' asset names and Vue's
  scope ids aren't a build in the site's own folder's.

- `ssqch diff` names the groups a move from a component framework always has (the old
  generator's client app, Shiki's inline colors where ssqch writes classes) as expected in a move,
  and its JSON gives such a group `known`.

- `vuePlugin()` from `ssqch/vue` renders the Vue components a site's pages use at build time,
  with the site's own Vite, @vitejs/plugin-vue and Vue: the ones a page's `<script setup>`
  imports and the ones the config names for every page, with bindings read as Vue reads them
  (VitePress's data loaders, a dynamic route's `params`, `useData()`), and with `hydrate`, as
  islands in the browser. A component inside another's slot renders (a layout component that
  holds the page), Vue renders with its production build in a production build, the fonts and
  images the styles point at are copied, and with pnpm, vite is found beside vitepress. On
  vuejs.org, scout's draft and one data file build every page with
  its components (the move wrote 241 lines for that), and the demos run in the browser again.
  Scout drafts it for a VitePress site, and lists the site's data loaders in `ignore` by their
  paths, so the move's own `.data.js` files stay ssqch's.

- `ssqch scout` counts a VitePress to-do as done when the site's templates do it (the layout reads
  the front matter the theme did, has the `<head>`, renders the theme; a heading hook; a dynamic
  route's data file), and drafts `llmsPlugin()` for a site with vitepress-plugin-llms. On the
  vuejs.org rerun's finished port, "what's left" went from 17 (11 of them done) to 8.
- `dialect: "vitepress"` writes a page's raw HTML as Vue's compiler does: a self-closing element
  (`<sup class="vt-badge" />`) gets its end tag, as a browser would leave it open (32 of
  vuejs.org's pages), and `v-pre` and event listeners (`@click`) are left out.
- The VitePress trailhead has the rest as recipes: keeping the site's own theme, rendered by
  `vuePlugin()` around each page (a wrapper component and a layout); Vue in a page's HTML; and
  the known gaps.

### Fixed

- A Hugo shortcode shown with `/* */` (`{{</* note */>}}`) on a line of its own was read as a
  container named `/`; it prints `{{< note >}}`, as in Hugo.
- `ssqch scout`'s list for an Eleventy site shrinks as the move goes. A filter, collection or
  transform the site's `ssqch.config.js` defines under the same name is done, and so is a plugin
  or library the config does (`rssPlugin()`, `engines: { md }`) or imports as it is; the config's
  own imports of Eleventy's packages aren't to-dos any more. The a11yproject.com move listed 29
  to-dos before and 37 when its output was identical, with none done; now it's 6, with 23 done.
  The text says `ssqch.config.js has ...` (it said `sets`), and JSON's `done[].option` names what
  in the config did it (`filters.slugify`, `ssqch/rss`, `import "markdown-it"`).
- `ssqch scout`'s reference build for Eleventy is the site's: the config's output folder
  (`--from dist`, not `_site`), a script that runs Eleventy under any name (not only `build`),
  with a tool beside it run after it (`eleventy & gulp` becomes `eleventy && gulp`), a gulpfile
  no script runs added, and the Node a site pins (`.nvmrc`, `.node-version`, `engines`) named
  when it's older than ssqch's.
- `ignore` keeps a data file beside the templates out too (`ignore: ["**/*.data.ts"]`).
  VitePress names its data loaders the way ssqch names a folder's data (`api/api.data.ts`), and
  the vuejs.org move's first build failed on one with an error about markdown-it, which it had
  to rename to get past. A data file that fails to load now says ssqch read it by its name.
- Front matter `page` (VitePress's `page: true`, on 9 of vuejs.org's pages) is warned about
  (`foreign-key`): ssqch's own `page` replaced it without a word.
- `ssqch diff` takes Vite's and Rollup's base64url hashes for fingerprints
  (`style.Bfpn8qS8.css`, `index-D_xVD091.js`), and leaves out Vue's scoped-style attributes
  (`data-v-ba3e0d0a`), its server renderer's fragment markers (`<!--[-->`) and Astro's
  `data-astro-cid-*`. On vuejs.org, the 20 reference builds looked like 111 varying pages, and
  the first diff had 172 groups of these, until two `--ignore` patterns.
- `ssqch baseline` with 20 builds or more no longer suggests `--runs 20` when every build has its
  own version of a file; it says more builds won't find a common one.
- The same error on several pages is one line, with how many more pages have it: one unknown
  Jinja test in a layout printed 86 times.
- `ssqch scout` rewrote every JSON and YAML file in an Eleventy project as data, its own saved
  reports included; only data in the input folder is. It no longer prints Node's
  `MODULE_TYPELESS_PACKAGE_JSON` warning when it loads a site's config, as `ssqch build` doesn't.
- A heading's `header-anchor` link (VitePress's, markdown-it-anchor's) isn't part of its text in
  `page.headings`: VitePress's zero-width space ended up in every heading's text, and in a
  `<title>` made from it.
- `ssqch diff --text` reads a `<` or `>` inside a quoted attribute as part of it, not as a tag's end
  (one of vuejs.org's pages scored 24% though its text matched).
- `ssqch diff` shows a long changed line around where it differs (`(from character 181,203)`),
  not from its start: a minified stylesheet's two versions showed as identical excerpts.
- `ssqch baseline` doesn't name a build "most like the others" when every build has its own
  version of every file that varies.
- `vuePlugin()`'s `useRoute()` for a dynamic route's page is the page's own path
  (`partners/vehikl.md`), as in VitePress, not its file's (`[partnerId].md`).

## 0.11.0 - 2026-11-20

### Breaking

- `ssqch import <generator> [--write]` is now `ssqch scout [dir]`, with no alias: a report of
  what moving a site takes that's safe to run any time, before and during a move. It finds the
  generator from its files (`--from` chooses), names the reference build for `ssqch baseline`
  and what it needs, and lists what the site uses with file and line, ssqch's way to do each or
  "not in ssqch yet"; run again, it shows what's left. It changes nothing unless asked:
  `--write-draft` writes the new files (the config draft, directory data, includes, hooks) and
  never overwrites one, and `--patch <file>` writes the mechanical edits as a patch to read and
  `git apply`. `--format json` prints the report as data. What `import --write` did is
  `ssqch scout --write-draft --patch move.patch && git apply move.patch`. Besides Eleventy,
  Jekyll and Zola it reads Hugo sites (shortcodes and their calls, sections, render hooks, Go
  templates, Hugo Pipes) and MkDocs sites (the nav, theme, plugins and Markdown extensions, and
  the MkDocs syntax pages use), from the fresh moves of gohugo.io and Material for MkDocs' docs.
  `ssqch capabilities` lists them under "Scout reads" (`importers` in its JSON).
- `.jinja` and `.j2` templates read as Jinja reads them, so a theme written for Jinja (Material
  for MkDocs) prints what it printed there (from the fresh httpx move, where these four cost 45
  minutes): each template loses one newline at its end (Jinja's `keep_trailing_newline=False`;
  0.7 kept it), so an include adds no blank line and a page's output has no final newline, and
  `tojson` writes a dict's keys sorted. A site that wants the blank line back adds an empty line
  at the end of the template. In both flavors, `"\u003c"`, `"\x3c"` and `"\U0001F332"` in a
  string are the characters they name (they were `u003c`), and `in` searches a safe string's
  text (`"<h1" in content` was always false).

### Added

- `mkdocsTemplates: true`: templates see what MkDocs gives a theme's (`config`, with the theme's
  `mkdocs_theme.yml` under it, `nav` with the page active, MkDocs' `page` with `content` and
  `toc`, `base_url`, and the page-relative `url` and `script_tag` filters), each Markdown page
  renders with the theme's `main.html`, its `404.html` makes `/404.html`, and Jinja doesn't
  escape. Material for MkDocs' templates, copied from its package unchanged, built the httpx
  docs with MkDocs' nav, table of contents, header and footer byte for byte; each fresh MkDocs
  move had written this context itself, the httpx one in about 220 lines. `ssqch scout` drafts it for
  an MkDocs site with a theme.
- `jinja: { autoescape: false }` prints `.jinja` values as they are, as MkDocs' Jinja does.
- `markdown: { dialect: "python-markdown" }`: raw HTML blocks run to their closing tag, lists
  nest at four spaces, a line keeps its one space at the end, and the HTML is Python-Markdown's
  (`"` in text, `<hr />`, `<br />`, `<img alt src />`, a tight item's nested list after its
  text). `headingIds: "python-markdown"` gives a repeated heading toc's `_1`. With both, the
  httpx docs' pages matched MkDocs' but for highlighted code and the pages Python writes.
- `this.page` and `this.data` in a config filter written as a `function`: the page being
  rendered and its data, in every template language, in a layout and an async filter too (four
  fresh moves wanted them; MkDocs' `url` filter is relative to the page). And `safe(html)` from
  `ssqch`, which every template language prints as it is.
- `ssqch scout` loads a move's `ssqch.config.js`, so an `[option]` it sets already is done: off
  the list, counted in the summary (`3 done already`), and in `done` and `summary.done` in its
  JSON, with `configError` when the config doesn't load. In the httpx move, "what's left" listed
  the same six items before, halfway and after.
- `ssqch scout` on MkDocs sites, from the fresh httpx move: it finds `search` when `plugins`
  isn't set (MkDocs turns it on), mkautodoc's and mkdocstrings' `::: package.name` blocks (the
  draft sets `markdown: { containers: false }`, since `:::` starts ssqch's containers),
  `theme.custom_dir` (the draft's includes folder), the `404.html` and `sitemap.xml.gz` MkDocs
  writes, and the Python environment the reference build needs (and a `.venv`'s `mkdocs`). The
  draft copies files with no extension (`CNAME`), and its `linksPlugin({ fail: false })` warns
  about broken links, as MkDocs and Hugo do. codehilite is no longer called the same as
  `highlight: { classes: "pygments" }`, and the draft writes its wrapper (or
  pymdownx.highlight's) as a fence hook. `--compare` builds with the clock baseline pins
  (`SOURCE_DATE_EPOCH`), and lists the files that differ (`compare.files`).
- `passthrough`: a file given a folder (`{ "docs/CNAME": "." }`, a `to` ending in `/`, or a
  folder that's there) goes into it by its own name. It was an EISDIR error.
- Other generators' Markdown, read as it's written, so a site's pages move unchanged (from the
  fresh MkDocs and Hugo moves, whose agents wrote 624 and 674 lines to do it):
  `markdown: { admonitions: "mkdocs" }` writes `!!! note "Title"` and `??? note` as
  Python-Markdown's admonition and pymdownx.details do, `tabs: "mkdocs"` writes `=== "Tab"` as
  pymdownx.tabbed's alternate style, `shortcodes: "hugo"` reads a Hugo shortcode on a line of
  its own as a container (`_includes/containers/<name>.*`), and `sourceLinks: true` (or
  `"relative"`, as MkDocs writes them) sends links to `.md` files to the page built from them,
  and reads images and other relative URLs from the Markdown file's folder.
  `headingIds: "python-markdown"` gives MkDocs' ids, and `highlight: { classes: "pygments" }`
  (or `"chroma"`) Pygments' class names, which MkDocs' and Hugo's themes style.
- A Hugo trailhead (`ssqch docs --from hugo`), from the fresh gohugo.io move.
- `ssqch scout`'s report says how big the move is first (how many to-dos ssqch does, an option
  does, aren't in ssqch yet, or are the site's own code), marks each line, and ranks them by the
  files they touch; in JSON each has a stable `code`, its `status`, its counts, the option that
  does it and an `ssqch docs` query. `--compare` builds the site, compares it with the
  `ssqch baseline` reference and lists the biggest groups of differences. Its Hugo and MkDocs
  drafts turn on the options above, write MkDocs' nav as `_data/nav.yml`, `base` from the
  site's URL and its redirects, and a container template to port for each Hugo shortcode; and it
  lists what Docusaurus, Astro, VitePress and Hexo sites use. A fresh clone of Material for
  MkDocs' docs builds every page from scout's draft with no page changed.
- Material for MkDocs' blog dates, `date: { created, updated }`: the page's date is `created`.
- `ssqch docs "<a heading>"` finds headings in the trailheads too (`"moving with identical
  output first"`), which other answers and `ssqch scout` point at.
- A site can replace ssqch's Markdown once: `engines: { md }` renders every `.md` file, and every
  `md` in a `render` chain, with the site's own library, after the `markdownEngine` as before. A
  markdown-it instance works as it is (its `render(source, env)` gets the page's data as `env`,
  as Eleventy's `setLibrary("md", ...)` gave it). Keeping a site's markdown-it took an engine of
  its own and `render` in every folder's data, which reached the folder's `.njk` pages too:
  v8.dev changed nine content files for it. The `markdown` filter stays ssqch's Markdown, and
  `ssqch scout` says how to carry `setLibrary("md", md)` over.
- `cache: true` on a site's engine (`engines: { md: { render, cache: true } }`) keeps the page
  bodies it renders by their source, so a page whose text didn't change isn't rendered again in
  `ssqch serve`'s next build. Layouts and render hooks render each time. It holds the last two
  builds, in memory, and is for an engine whose output depends on the source alone. v8.dev's
  serve rebuild went from 1.8 s to 0.28 s with a cache like it in its config.

- Three of markdown-it's habits as `markdown` options, each writing the bytes markdown-it 13
  writes: `breaks: true` (a single newline in a paragraph is a `<br>`; 374 on a11yproject.com),
  `autolinks: "fuzzy"` (bare domains and email addresses become links, as `linkify` makes them)
  and `figures: true` (an image alone in a paragraph is a `<figure>` with its alt text as the
  `<figcaption>`, as markdown-it-implicit-figures makes it; 74 v8.dev pages). `ssqch
  scout` carries markdown-it's `breaks`, `linkify` and `typographer` and the implicit-figures
  plugin into the draft's `markdown`.
- `markdown: { highlight: { classes } }` names highlighted tokens as another highlighter does,
  so a site keeps its theme's CSS. `classes: "prism"` writes Prism's names (`token keyword`),
  `<pre class="language-js">` and marked lines as `<mark class="highlight-line
  highlight-line-active">`, as Eleventy's syntax-highlight plugin does; an object names some
  kinds (`{ keyword: "tok-keyword" }`, lit.dev's CodeMirror theme). `/highlight.css` uses the
  same names. `ssqch scout` suggests it for the syntax-highlight plugin.
- `ssqch scout` adds the packages that came with `@11ty/eleventy` to `package.json`
  when the site's own code imports them without listing them (`slugify` in a config,
  `browser-sync` in a gulpfile), at the version installed; removing Eleventy used to remove them
  too. It lists the filters and shortcodes the templates use that nothing defines, with how many
  templates use each and the first place, says what Eleventy's and its plugins' become, and ports
  Eleventy's `log` and collection-item filters into the draft. On a11yproject.com it names every
  filter that move found by hand.
- `ssqch scout` follows the config into the site's own modules (a `registerSiteFilters`
  in `lib/`, a plugin of the site's own) and lists what each adds with its file and line, copying
  the self-contained filters into the draft; on the ReverentGeek blog's last Eleventy commit that's
  8 filters, 2 collections and a transform the list didn't have. Data files and other modules that
  use eleventy-img or eleventy-fetch are listed with what replaces them, and a plugin imported
  beside named imports (`import pluginRSS, { dateToRfc3339 } from ...`) is recognized.
- `ssqch scout`'s draft sets the Markdown defaults where Eleventy's Markdown wrote other
  markup, each with a comment: `headingIds: false` without markdown-it-anchor (380 headings on the
  ReverentGeek blog had ids they didn't have before) and `indentedCode: false` for Eleventy 3.
- `minifyPlugin({ css: true, xml: true, json: true })` also compresses each page's `<style>`
  elements (with ssqch's Sass, as html-minifier's `minifyCSS` does; lit.dev inlines 30 to 60 KB a
  page), feeds and sitemaps, and JSON files and manifests. All three are off by default.
  `minifyCss(css)`, from `ssqch/minify`, compresses CSS text for a filter of your own.
- A `code.*` render hook writes inline code spans, given `code.code`: a site from GitHub Pages
  keeps Rouge's `class="language-plaintext highlighter-rouge"` (opensource.guide).
- `ssqch baseline "<command>"` builds the site with its old generator three times, each in a fresh
  copy (the files git would commit, or `--commit <rev>`) with every file's time set to the
  commit's, `TZ=UTC` and `SOURCE_DATE_EPOCH` (and Jekyll's `time:`), into
  `.cache/ssqch/baseline/ref-1` to `-3`, and compares the builds, so
  what changes by itself is known before ssqch's build is compared with them. `--from` is the
  folder the command writes (`_site`), `--runs` and `--to` the builds and their names. The site's
  installs are linked into each copy (`node_modules`, Bundler's `.bundle` and its `BUNDLE_PATH`,
  `vendor/bundle`, `.venv`), and `--link` adds others. Every move wrote a script of its own for
  this (v8.dev's `parity.sh`, lit.dev's `stability.py`). opensource.guide's three Jekyll builds
  take 37 s and vary on 380 files, one group: the build's time.
- `ssqch diff` groups the same change on more than one file: it's listed once, the most files
  first, with how many files have it, and each file is listed after the groups with what's left.
  A group's tags can differ in their attribute values from file to file, and a run of three
  changed lines or more joins a group with the same tags. `--format json` has `groups` (each with
  `files`, `urls`, `same`, `match`, `kind` and `hunk`) and each changed file's `groups`;
  A change that's only dates groups by the form of the dates that changed. `--ungrouped` lists each file with
  all its changes. `ssqch diff a b c` groups what varies the same way on several files (a build's
  time on every page) too. opensource.guide's 172 changed
  pages are 12 groups, one of them on 102 pages; every move found its biggest group by hand.
- `layoutAliases: { post: "layouts/post.njk" }` gives a layout another name, as Eleventy's
  `addLayoutAlias` did; a page's `layout` stays the name it gave. Without it, a moved site's
  `layout: post` quietly found `_includes/post.njk`, a partial (a11yproject.com).
  `ssqch scout` writes it, and carries `.eleventyignore` into `ignore`, lists
  `dataTemplateEngine`, and leaves `eleventy.generator` as it is for Eleventy 1, which printed
  nothing for it.
- `ssqch diff --exclude <glob>` leaves matching files out (repeatable, after `--only`): the blog's
  comparison with its Eleventy build needed nine `--only`s to leave out its images.

- `pagesTree(collections.all, { root: "Feature" })` (or `pagesTree(pages, "Feature")`) is the
  tree below one key, as eleventy-navigation's `eleventyNavigation: "Feature"` was; `nav.url`
  replaces a page's URL, any other `nav` key (`excerpt`) is copied onto its entry, and the title
  falls back to `nav.key`.
- `getPreviousCollectionItem` and `getNextCollectionItem`, Eleventy's filters, work (and say once
  that ssqch's is `navPager(collection, page.url)`), so `ssqch scout` no longer ports
  them into the draft.
- `ssqch docs <page>` answers with the page a file name names (`ssqch docs comparing-builds`,
  `ssqch docs /docs/comparing-builds/`), and a trailhead's as `--from` does (`ssqch docs
  from-eleventy`), where it searched for the words.
- `ssqch baseline --patch <file>` applies a patch to each copy before it's built, for a commit
  that needs a fix to build at all.
- `ssqch baseline` and `ssqch diff a b c` name the build most like the others (the most common
  version of the most files that vary), and `baseline`'s `Next:` compares with it; a version
  more than four builds share is a count (`34 of 50 builds (ref-1, ref-2, ref-4, ...) agree`).
  `--format json` has it as `typical`.
- `markdown(text, "inline")` in config code, as templates call it, where it failed with
  `unknown option "0"`.

- `ssqch scout` reads Jekyll sites: a first `ssqch.config.js` from `_config.yml` (Liquid for pages,
  kramdown's Markdown options, `exclude`, the files Jekyll copies, `site`, the `defaults` for every
  page, the plugins it knows, and `jekyllTemplates`), directory data for `_posts` and each
  collection with their tags and permalinks, and `{% seo %}` as an include it writes; it edits no
  other template, and lists the rest with file and line. opensource.guide goes from a fresh
  checkout to a full build with it.
- `markdown: { htmlMarkdown: "kramdown" }` reads kramdown's Markdown inside HTML: an element with
  `markdown="1"` (or `"block"`, `"span"`) has its content rendered, and kramdown's HTML rules hold
  around it. opensource.guide's 3,791 such elements come out as Jekyll wrote them.
- `headingIds: "kramdown"` (kramdown's GFM ids, emoji dropped, and its ASCII ids for headings
  inside `markdown="1"` HTML) and `headingIds: "markdown-it-anchor"` (that plugin's default,
  percent-encoded). `ssqch scout` writes the second for a site with markdown-it-anchor.
- `trimAfterFrontMatter: true` starts a template's body at its first line with text, as Jekyll
  does.
- `sassPlugin({ charset: false })` leaves out the byte order mark (or `@charset`) that CSS with a
  character outside ASCII starts with, as Dart Sass's `--no-charset` does.
- Jekyll's `xml_escape` (`&apos;`), `normalize_whitespace` and `sort` of a hash (into `[key, value]`
  pairs) write what Jekyll's do.
- `rssPlugin()` has the Eleventy RSS plugin's first names too: `rssDate` and `rssLastUpdatedDate`.
- `slugify(text, { ascii: true, stripTags: true })`: accents off and symbols spelled out, as the
  slugify package does (`Thomas Sjögren` is `thomas-sjogren`), and HTML tags left out first.
- `toc(html)` reads the headings in HTML, for headings a layout adds (`toc(content)` in an outer
  layout).
- `ssqch baseline` writes `ref-common` beside its builds when they vary: each file's most common
  version, which its `Next:` compares with, and it says which files have none yet.
- `ssqch diff` calls out a changed canonical link or refresh redirect on a page, and a feed's
  entries that went or came, by their id.
- `ssqch scout` lists what changes the output before the first diff (a Date printed as
  it is, date code that reads the machine's time zone, `pagination` over `collections`,
  templates in a passed-through folder, `&` beside `ssqch build` in a script, a second build tool
  with ssqch's way for each part), unwraps `{{ '/x/' | url }}` in data files when the site had
  `dataTemplateEngine`, reads `ignores.add()`, and lists a passthrough entry once.
- `sitemapPlugin()` without a `url` (or with `""`) writes paths from the root, as jekyll-sitemap
  does, and warns on each build.
- The SEO docs have an include that writes jekyll-seo-tag's tags.

- `ssqch scout` writes more of what Jekyll's plugins wrote, so the first build matches:
  the SEO include has jekyll-seo-tag's generator tag (Jekyll's version, from `Gemfile.lock`),
  article tags for dated pages, `twitter:site`, `article:publisher` and its JSON-LD;
  jekyll-redirect-from's page for each old URL (a redirect hook); and Rouge's classes on inline
  code for a GitHub Pages site (a code hook). A file with front matter in any extension (`.js`,
  `.xml`, `.txt`) gets an engine and a permalink that keeps its name, and a collection's file
  without front matter is copied as Jekyll copied it. opensource.guide's import matches Jekyll's
  build on 247 of 404 pages, up from 1.
- `ssqch diff` says which heading a page's change is under (`@ under #its-id`), and the JSON has it
  as each hunk's `at`.

- `markdown: { encodeUrls: false }` writes link and image URLs as the page has them,
  HTML-escaped only, as kramdown does, where ssqch percent-encodes them (`#كتابة` as
  `#%D9%83...`); `ssqch scout` turns it on. Browsers go to the same place either way.

- Jekyll's `{% highlight lang %}` (in Jekyll's `<figure>`, with ssqch's highlighter), `{% link path %}`
  and `{% post_url name %}` in Liquid; a path no page has is an error that names it.
- `ssqch scout` lists each `_plugins/*.rb` with what it registers (filters, tags,
  generators, hooks) and ssqch's way to do each, writes directory data for every `_posts` folder
  (`en/news/_posts`, its folders as the first categories), renames a `.rss` or `.xml` layout to
  `.liquid` so it runs Liquid. The Jekyll trailhead has "Porting a site's own plugins".
- `jekyllTemplates: true` gives templates Jekyll's `page` (front matter too: `page.title`, with
  `page.path` and `page.categories`) and `site` (`site.posts`, newest first, each collection,
  `pages`, `categories`, `tags`, `data`, `time`), with items in Jekyll's shape (`post.title`,
  `post.content`, `post.excerpt`), in every template language. A Jekyll site's layouts and
  includes run as written: www.ruby-lang.org imports with 17 edits where it took 1,056.

### Changed

- `ssqch scout` leaves Eleventy's front matter keys as they are (`eleventyComputed`,
  `eleventyExcludeFromCollections`, `templateEngineOverride` work in ssqch), where it renamed them in
  every page, and lists `eleventyNavigation` pages instead of renaming the key to `nav`. The
  importers now list what needs doing and make only edits that are mechanical and clearly right.
- Liquid's `truncate` counts characters and `truncatewords` splits at any whitespace and adds
  the ellipsis from `n` words, as Ruby's Liquid 4 (Jekyll's) does; 0.7 counted bytes, so a
  Cyrillic or CJK text under the limit got a `...`. `truncatewords`' default is 15, as in Ruby.
- A front matter key written twice is the last one, with a warning, as in Jekyll, where it was an
  error.
- A link's or image's hook gets no `title` (null) when it has none, where it got `""`, which
  Liquid counts as true.
- `ssqch scout`, `ssqch diff` and `ssqch baseline` list only the global options that do
  something for them in `--help` (all are still accepted).
- ssqch's smart quotes close an open quote where pulldown-cmark opened a second one (a `"`
  between two letters, as in `比如"进展 ISSUE-123"；`).
- A `_site` folder at the top of the input folder (where Jekyll and Eleventy write) is skipped, so
  the old generator's build isn't read as pages while ssqch writes elsewhere.
- With `classes: "prism"`, a fence in a language with no grammar gets Prism's
  `<pre class="language-x">` too.
- The build summary's `render` time includes layouts, which it counted as `write`.
- The `eleventyNavigation` warning is left out when the site defines a filter of that name.
- `pagesTree`: a `parent` no page has is a heading (an entry with that title and no `url`)
  holding its children, where they went to the top of the tree.
- `ssqch diff` leaves out what browsers read the same. Each tag is compared in one form (names
  in lower case, attributes sorted, values decoded and in double quotes, `defer="defer"` as
  `defer`, no `/` before `>`, and `<path/>` as `<path></path>` in an SVG), and so is text (`&#39;`
  and `'`, `&gt;` and `>`). Images named by an id, as `imagePlugin()` and eleventy-img name them
  (`/img/LeC3bj9CzE-256.webp`), are compared by their widths and formats, and more than five of
  them added or removed are one counted line. A feed's escaped or CDATA HTML is compared as HTML,
  XML files say `only dates changed` and `the same lines, in another order`, and a report with
  added or removed files says to build each side into an empty folder. The ReverentGeek blog's
  comparison with its Eleventy build went from 24,659 changed lines on 161 pages to 225 on 14,
  which are the real differences. `--exact` compares bytes, as before. A symbolic link is compared
  by its target, not by the file it points at, and a link that's a file in the other build is a
  change.
- `ssqch/minify` writes the viewport `<meta>`'s numbers as html-minifier-terser does
  (`initial-scale=1.0` is `initial-scale=1`) and takes all its whitespace out: 309 lit.dev pages
  differed from Eleventy's only in that. A site with a decimal there gets other bytes.
- `markdownify` (Jekyll's and Hugo's name for `markdown`) calls the site's own `markdown` filter
  when it has one. It called ssqch's built-in one whatever the config said.

### Fixed

- Jinja and Nunjucks errors named the wrong place: one after an `{% include %}` was the include's
  line 1, and one in a layout (a template another `{% extends %}`) the page's `{% block %}` line.
  Each names its own file and line now, an error in `{{ }}` or an `{% if %}` included: they
  named the last tag before them that had a filter or a call. (Material's `self.announce()` was
  reported at the site's own layout, line 83, from the theme's `base.html:111`.)
- Jinja's `self`: `{{ self.title() }}` renders a block by name, as the page's templates have it.
  Material for MkDocs' `base.html` calls `self.announce()` and `self.outdated()`.
- A `layout` in global data (the config's `data`, `_data/layout.*`) gave no page a layout, though
  `ssqch inspect` said it did. It's every page's that doesn't set one lower down.
- With `markdown: { sourceLinks }`, a theme that had pages of its own (a 404 page) sent every
  relative image to `../../docs/img/...`: the input folder was the common folder of every page's
  source, which a theme's page moved up to the project's root. It's the site's input folder.
- Includes are read once a build, and images (SVG too), fonts and media in them not at all:
  every file of every include folder was read three times for checks on template code. A
  25-page site with Material for MkDocs' 14,376 icons took 614 ms to build; it takes 46 ms.
- `ssqch diff --exact` ignored `--ignore`: `--exact --ignore 'object at 0x[0-9a-f]+'` checks
  every byte but a Python memory address.
- `ssqch baseline` and `ssqch scout` accepted the global options that do nothing for them, and
  did nothing: `baseline --output x` built into `.cache/ssqch/baseline/` all the same. They're
  refused now, and `--output` says to use `--to`.
- `ssqch baseline` couldn't build a Hugo site that bundles JavaScript: Hugo's `js.Build` refused the
  linked `node_modules` ("outside the project"). For a `hugo` command the installs are copied
  (copy-on-write where the file system has it), and `--copy-installs` copies them for any other.
- Front matter dates in Jekyll's documented form (`2009-12-25 10:41:06 +0000`, a space before a
  zone without a colon, a one-digit hour) were refused.
- `ssqch scout` wrote front matter into `_data` files that start with YAML's `---`, and the
  build failed; it copied `_` folders inside a passed-through folder, which Jekyll skips.
- `ssqch baseline` left Jekyll's `site.time` unpinned when the command gave its own `--config`
  (every article varied): the time goes last in that list. It warns when Jekyll's build has GitHub
  Pages' placeholder `github.com/pages/...` URLs.
- `ssqch scout` takes `site.url` from `CNAME` for a GitHub Pages site, says where Jekyll's
  `excerpt` and `sort` differ, and writes what it only named: `redirects.json`, `robots.txt`, Rouge's
  wrapper for code blocks, and whole URLs in the redirect page. opensource.guide's import matches
  Jekyll's build on 306 of 404 pages with no hand edits.
- `sassPlugin()`'s compressed CSS kept a `;` before `}` when a comment followed the last
  declaration (normalize.css's `-webkit-text-size-adjust: 100%; /* 2 */`).
- With `htmlMarkdown: "kramdown"`, an indented code block inside a `markdown="1"` element lost its
  blank lines.
- `ssqch scout` wrote collection permalinks with `//` in front (`//ar/metrics/`): a
  page's `filePathStem` starts with its own `/`. A build now warns about any page whose URL has
  `//` in it.
- `site.articles` (a Jekyll collection) was empty with no word: with `jekyllTemplates` it's there,
  and without it the build warns about `site.<collection>` as it does about `site.posts`.
- Smart quotes: a closing `"` after a letter came out `“` when it closed an outer quote or had no
  partner (`... p5.js Edition“`).
- `ssqch baseline` says when files git doesn't track go into its copies, and `ssqch scout`
  leaves them out of `passthrough`.
Found by fresh moves of a11yproject.com and opensource.guide, run as if for the first time.

- `{{ date.toString() }}` printed `[object Undefined]`, with no warning: a date's own methods work
  in templates, as in Eleventy (in the site's `timeZone`). Every post's JSON-LD had it.
- A site's own filters got a layout's `content` as a SafeString in Nunjucks and Jinja, so one that
  checks `typeof content === "string"` returned nothing (a table of contents, on 70 pages). They
  get text, as in Eleventy; a filter that gives its argument back unchanged still prints HTML.
- `page.headings` (and `toc()`) left a heading's inline code out of its text: `The <code>toc</code>
  filter` was `The filter`.
- `ssqch diff` didn't read JavaScript's `Date.toString()` (`Mon Mar 08 2021 00:00:00 GMT+0000
  ...`) as a date, so 70 pages whose Eleventy build printed dates that way were listed one by one;
  they're a date change, grouped. `--only /posts/pine/` (a folder, as a URL is written) matches
  what's in it, and `--only` that matches no file in either build is an error, not "No
  differences".
- `ssqch scout` listed `eleventy.generator` in files outside Eleventy's input folder (a
  notes file).
- `url`, Eleventy's filter, normalizes its path as Eleventy did: `""` is `.`, `/a//b/../c/` is
  `/a/c/`.
- `sassPlugin()` didn't find a partial with a dot in its name (`@import "logic/variables.paths"`
  for `_variables.paths.scss`), so a whole stylesheet failed to compile.

## 0.10.1 - 2026-11-19

### Added

- `ssqch build --profile` says where a build's time went. After the summary, it lists the
  slowest pages, templates, layouts, template engines, filters (the site's and ssqch's),
  transforms, data files and data functions, collections and hooks, ten of each, with their
  calls and their total time; `--format json` has every one, under `profile` (a list of
  `{ name, calls, ms, async }` for each kind). A call's time includes the calls it makes, and
  `async` marks one whose promise was timed until it settled: calls that ran at once overlap, so
  their total can pass the build's own time. Every move to ssqch found its slow code by wrapping
  functions by hand, because `Time` named a phase and nothing in it.
- A `slow-call` warning names a filter, transform or collection of the site's own that took a
  second or more in one call, with where it came from (`ssqch.config.js`, or the plugin) and the
  first page it was slow on. They run for every page, so a second each is minutes on a big site
  (an HTML minifier as a transform took 5.2 s a page in a migration). It's timed one call at a
  time in every build; data functions and hooks, which run once, aren't.
- A site's own template engine (`engines`) gets a third argument, `{ kind, path }`: what it's
  rendering (`"body"`, `"layout"`, `"hook"` for a Markdown render hook, `"permalink"` or
  `"computed"`) and the file, as `page.inputPath` names it. An engine that only had `source` and
  `data` had to guess, from what was in them. One that takes two arguments works as before.

### Changed

- The image summary counts GIFs and SVGs copied as they are apart from the files it encoded:
  `0 encoded, 35 copied, 4,950 reused`. A clean build of the ReverentGeek blog said `35 encoded`
  every time, which read as a cache that didn't work. The copies are made on Node's thread pool
  too, while pages go on rendering.

### Fixed

- A page's `permalink` and `computed` strings render with the first of ssqch's template languages
  in its chain, then the `markdownEngine`, then Edge, and never with a site's own engine: a page
  sent through a markdown-it engine (`render: mdit`) had its permalink rendered by markdown-it, as
  `<p>/blog/tags/{{ tag | slug }}/</p>`, and a page written at that path. A permalink that still
  has template tags after rendering, or starts with `<p>`, is an error naming it, rather than a
  URL. Tested on several migrations.

### Faster

- A build into an empty output folder (every CI build, and a local one after deleting it) puts
  the image plugin's cached files there with hard links made on Node's thread pool, while pages
  go on rendering, instead of one at a time on the main thread. On macOS a hard link takes about
  0.2 ms, so the ReverentGeek blog's 4,950 cached files took a second: its build into an empty
  folder went from 1.58 s to 0.86 s. A build whose output has them already is as it was.

## 0.10.0 - 2026-11-19

### Breaking

- `ssqch docs` reads the docs pages, not the README: the documentation moved into pages of its
  own (`site/src/docs/` in the repository, `bundled/docs/` in the package), which sitesquatch.dev
  renders and GitHub shows, and the README is a short front page. Every name still answers with
  the same section and the same text, with three differences. A page that was a `###` section of
  the README (Markdown, Built-in plugins, Netlify and the rest) is a `##` section, so it's a topic
  on `ssqch docs`' card. Links in an answer are the pages' relative `.md` links
  (`content-schemas.md`), not the README's `#anchors`. And "Working on SiteSquatch" isn't in the
  docs: it's `CONTRIBUTING.md`. `ssqch docs --from <generator>` names the trailhead's page on
  sitesquatch.dev (`The trailhead (https://sitesquatch.dev/docs/trailheads/from-eleventy/):`), and
  its JSON's `trailhead.file` is `site/src/docs/trailheads/from-eleventy.md`. The dev server's
  message about a linked file nothing wrote ends with `` (`ssqch docs "CSS and JavaScript"`) ``
  where it said to see the README. No site has to change; a script that reads these does.
- `assetsPlugin()` no longer leaves a passthrough copy's plain file beside its fingerprinted one:
  a listed file that's a passthrough copy was copied in, renamed, and then copied in again by the
  passthrough step, so `site.css` sat next to `site.7d041850.css` (and counted against `budgets`
  twice). Only the fingerprinted file is in the output now. HTML that links the plain path is
  rewritten as before; a reference the plugin doesn't rewrite (an `import` inside another
  JavaScript file, a `url()` in CSS, a JSON file) has to use `assetUrl("/assets/site.css")` or
  leave the file out of `files`.

### Changed

- ssqch has a website: [sitesquatch.dev](https://sitesquatch.dev), with the documentation, the
  example sites running live, a changelog written for people, and every docs page as Markdown
  for coding agents (`/llms.txt`). The npm package's `homepage` is the site.
- The example sites run live on sitesquatch.dev, each under its own path
  (`https://sitesquatch.dev/examples/blog-tags/`), instead of a subdomain each. The six that name
  their address (`blog-tags`, `blog-categories`, `docs-sidebar`, `glossary-docs`,
  `versioned-docs`, `islands`) say `https://sitesquatch.dev`. Their frozen outputs in the oracle
  changed with the address, and nothing else.
- Under a `base`, the feed filters put it in front of a URL from the site's root that doesn't
  have it yet: `absoluteUrl(post.url, site.url)` is `https://example.com/repo/posts/pine/`, with
  or without the path in `site.url`, and `htmlToAbsoluteUrls` and `feedHtml` do the same for
  every URL in the HTML. A feed isn't HTML, so the base wasn't added for it, and `absoluteUrl`
  against an address with a path dropped the path for a URL that starts with `/`: every link in
  a feed under a path went to the domain's root. A URL that has the base already (from
  `withBase()`) keeps one. The named exports, called from a site's own code, resolve as
  `new URL(url, address)` does, as before.
- A computed `layout` can depend on the page (`layout: (data) => data.wide ? "wide.html" :
  "post.html"`, or a string with template tags): each page gets the layouts its value names, with
  their front matter below the page's data, and `""` or `false` for none. It was an error since
  0.7.0, because the layout was chosen before `computed` ran; the chain is chosen after it now,
  page by page. Tested on several migrations.
- `dateFallback: "git"` gives a page with no date of its own the date of the last commit that
  changed its file, the same in every checkout. Its date was the file's time, which is when the
  checkout wrote it, so `page.date` and a sitemap's `<lastmod>` changed from one clone to the
  next. `"file"` (the file's time) is the default. Either way, an undated page sorts after the
  dated ones, by path.

### Fixed

- A page that no template language reads (`render: md`, or a plain `.html` page with
  `htmlEngine: false`) no longer gets a `foreign-global` warning for another generator's globals
  in its text: it prints `{{ eleventy.generator }}` as written, so a page about Eleventy isn't
  using it. Its layouts and includes are still checked. Found building sitesquatch.dev's
  trailheads page.
- A page's `computed` values can read `collections`. Pages were expanded before collections were
  built, so a computed value that read them got nothing, and a list built from it came out empty
  without a word. A page whose `computed` mentions `collections` (in a string, or in a function's
  source) now waits for them, as a page paginated over a collection does, and sees them as they
  are without the pages that wait. Tested on several migrations.
- `redirectsPlugin({ netlify: true })` under a `base` writes the base on both URLs of each
  `_redirects` line (`/repo/old/  /repo/posts/pine/  301`). A host matches a line against the
  request's whole path, so the lines without it redirected nothing. The link checker reads a
  `_redirects` line with the base off, as it reads links, and still reads a line without it.
- `ssqch serve` names a changed file outside the site's root from the root
  (`Fresh tracks in ../docs/guide.md`), as it names one inside, instead of by its absolute path.

## 0.9.0 - 2026-11-18

Found moving opensource.guide (Jekyll) and expressjs.com (Astro) to 0.8.0.

### Breaking

- Liquid follows Ruby's Liquid (Jekyll's) where 0.7 followed the Rust liquid crate, each checked
  against Ruby's Liquid 4.0.4. Math filters read text as Ruby does (`"r>" | times: 1` is 0, not
  an error; jekyll-toc depends on it). `split` drops empty strings at the end (`"a,b,,"` is two)
  and splits `" "` at every run of whitespace. A block that only sets variables writes nothing.
  A site that relied on the old output: `"a,b,," | split` has two items now, and the blank lines
  such blocks wrote are gone.
- Pages without a date sort after the dated ones in a collection, in path order, not by their
  files' times. A fresh clone or an edit gives files new times, so a collection's order changed
  with them (opensource.guide, v8.dev). Their `date` is still the file's time. A site that relied
  on the old order: give those pages dates, or sort the collection itself.
- A `computed` value named `page` is an error (`` `page` in computed isn't applied, because `page`
  is ssqch's ``). It was thrown away without a word, since ssqch sets `page` after `computed` runs.
  A site that has one: give it another name (`computed: { meta: ... }`) and use that in templates.
- `headingIds: "github"` (the default) follows github-slugger 2.0.0 character for character, the
  slugger rehype-slug uses (so Astro's, VitePress's and Docusaurus's anchors) and GitHub's anchors
  match. A heading's id changes when it has a combining accent (`e` + U+0301, which stays), an
  emoji's variation selector or a zero-width joiner (which stay), or a superscript or fraction
  (`x²`, `½`, which go). A site linking to such a heading's old id: link to the new one, or give
  the heading its id (`## x² {#x2}`). expressjs.com had 29 pages linking to ids ssqch wrote
  differently.
- `slot` is ssqch's container name (named slots, below), so `_includes/containers/slot.*` is an
  error. A site that has one: rename the container.

### Added

- A warning when a Liquid template reads front matter through `page` (`page.title`, as Jekyll's
  do): it's empty in ssqch, where front matter is at the top level. Once for each name, naming the
  page, including reads in layouts and includes.
- `ssqch diff` with three or more folders lists what varies between builds made the same way:
  each file that isn't the same in all of them, which builds agree, and the lines that differ. A
  reference build that changes by itself was the first hour of both 2026-11-18 studies.
- `timeZone` (`timeZone: "UTC"`): the time zone the site's own JavaScript runs in, for `Date`'s
  local methods and libraries like luxon, so a laptop and CI build the same pages. v8.dev's dates
  differed on 137 pages between EST and UTC. ssqch's own date filters stay UTC.
- `SOURCE_DATE_EPOCH` pins the build's time: `now()`, Liquid's `"now"`, Edge's `new Date()`, and
  the date of every page without one, as Jekyll's `time:` does. A
  reference build that's the same every time took pinning in both 2026-11-18 studies.
- `sitemapPlugin({ alternates })`: a function that returns a page's translations, written as
  `<xhtml:link rel="alternate" hreflang>` under its `<loc>`, as @astrojs/sitemap and Google list
  them. expressjs.com's port wrote its sitemap in an `afterBuild` hook for them.
- A trailhead for Jekyll (`docs/trailheads/from-jekyll.md`, `ssqch docs --from jekyll`): the config,
  `page` and `site`, includes and plugin tags, Ruby Liquid's differences, the plugins, and kramdown,
  from moving opensource.guide.
- `toc` takes `id`, `class`, `sublistClass`, `itemClass` (`{level}` is the heading's level) and
  `linkClass`, so a table of contents can keep another generator's markup and CSS (jekyll-toc's
  `section-nav` and `toc-entry toc-h2`).
- Containers get `container.props`, their arguments read as a component's attributes
  (`::: card type="tip" open items='["a","b"]'`), and named slots: a `::: slot title` block inside
  a container is its `container.slots.title`, left out of `container.content`, as MDX's
  `<Fragment slot>` is. A slot with no template around it to take it renders where it is.
- The config's functions are Liquid tags, as they are in Nunjucks, so a Jekyll plugin's tag can be a
  function: `{% seo title=false %}` calls `seo({ title: false })` and prints its answer unescaped,
  and `{% callout "tip" %}...{% endcallout %}` passes what's between first. Liquid's own tags keep
  their names.
- Jekyll's `{% include_relative parts/intro.md who="rangers" %}` in Liquid: a file beside the
  template, with `include.who`; `{{ }}` in the name works and `..` is refused, as in Jekyll.
- Config and data files can import the site's own files through `tsconfig.json`'s or
  `jsconfig.json`'s `compilerOptions.paths` (`import { menu } from "@/config/menu"`), as Astro,
  Vite and Next.js codebases do, with TypeScript's rules: the longest matching pattern, its targets
  in order, from `baseUrl` or the tsconfig's folder. An import Node resolves itself is unchanged.
- A warning when a Nunjucks template gives one of the config's filters' names to a macro, an
  import, a `set` or a loop variable and then calls that name as a function
  (`{% from "ui.njk" import postCard %}` … `postCard(post)`): the call means the template's own
  thing, not the filter, and printed `function () { [native code] }` without a word. It names the
  file and line.
- Build hooks get `quiet` and `verbose` (whether the build was run with `--quiet` or
  `--verbose`), and a hook's command and `serve.run` commands get `SSQCH_QUIET`, so their own
  messages can follow `-q`.

### Changed

- `ssqch docs` answers a name with the paragraph that leads with it in bold too (`**Containers:**`),
  not only a table row that points at it. `ssqch docs pagination` explains pagination (it listed
  option names), `data` says a value that's a function is called for that name, and `i18n`,
  `translations`, `hreflang`, `multilingual` and `seo` find new sections: what isn't built in yet,
  and the recipes two migrations used.

### Faster

- Liquid's `where` and `reject` don't run liquidjs' generator and new scope for every item when
  they filter a list by a property (`collections.posts | where: "data.lang", "fr"`), with the same
  answers. A layout that looks pages up in a collection on every page builds 8.6 times faster: the
  benchmark's new Liquid case went from 39.8 s to 4.6 s, and opensource.guide's idiomatic port from
  6.8 s to 1.4 s.

### Fixed

- Two passthrough sources copied to one file raced, so either could be written. The one listed
  later is written every time, with a warning naming both when they differ.

- `url` and `relative_url` on the url of a page with `permalink: false` printed `false` (a sitemap
  got `/false`). They print nothing, with one warning.

- With `"js"` in `templateFormats` (for `.js` files with front matter), the config and the modules
  it imports were built as pages (`_site/ssqch.config/index.html`). They're code, and skipped. The
  README has the recipe for text files with front matter.

- The hint for Jekyll's `jsonify` in a Jinja or Nunjucks template said Liquid's is `json`; it says
  `jsonify` works in Liquid.

- An error that many pages hit at one spot (a broken include in a layout) shows that spot's lines
  once, not up to three times, so a second, different error gets its own.

- `ssqch/sass` finds an `@import`, `@use` or `@forward` that names its extension
  (`"primer-core/index.scss"`) in the load paths, as Dart Sass and Ruby Sass do; it looked only
  beside the importing file, so GitHub's primer, whose files all import that way, didn't compile.
  And a stylesheet that starts with front matter (Jekyll's `---` lines) compiles, the lines left
  blank so error lines still match.
- A folder Bundler installed gems into (`bundle install --path vendor/bundle`, which Jekyll
  sites do) isn't read as the site's pages: its gems' templates were built, and failed.
- A page's `page.headings` read before the page had rendered (from a `computed` value, say) stayed
  an empty list for the rest of the build, so a table of contents built from it later was empty.
  Now an early read is empty and a read after the page renders has its headings.

## 0.8.0 - 2026-11-18

ssqch 0.8 is a TypeScript program on Node (22.18 or newer), installed from npm. The contract is
0.7's: the commands and flags, the config, `ssqch.d.ts`, the JSON reports, the diagnostic codes and
the voice. Rendering, Markdown, minify and Sass give 0.7's output, and the blog, the examples and
the starters build to the same bytes, apart from image bytes (sharp encodes the images now), the
starters' editor types and the docs starter's Install and Deploying pages. Most sites change
nothing. Breaking lists what a site might have to change, by theme: installing, a site's
JavaScript, data, templates, Markdown, images and feeds, builds, `serve.run` tools, `diff` and Rust
plugins. Changed lists what's new, what works now that didn't, and the messages that read
differently.

### Breaking

#### Installing

- **How ssqch is installed: from npm, and only from npm.** The npm package is ssqch itself,
  JavaScript that runs on Node 22.18 or newer, with sharp as its one dependency; the
  `@ssqch/<platform>` packages are gone, so a `pnpm-workspace.yaml` that lists them under
  `minimumReleaseAgeExclude` needs only `ssqch`. There's no standalone executable: no installer
  scripts, no release archives, and no `setup-ssqch` action. In a site, `npm install --save-dev
  ssqch`; outside one, `npm install --global ssqch` or `npx ssqch@<version>`. Homebrew's formula
  (`brew install reverentgeek/tap/ssqch`) installs the npm package with Homebrew's Node, so
  `brew upgrade` moves to 0.8 by itself. In GitHub Actions, replace `setup-ssqch` with
  `actions/setup-node` and `npm ci` (or `npm install --global ssqch@<version>`). On Netlify, run
  ssqch from the site's dev dependency, or `npx --yes ssqch@<version> build`, in place of the
  installer. Once 0.8.0 is the latest release, `releases/latest/download/ssqch-installer.sh` and
  `.ps1` are gone (a pinned `download/v0.7.0/` installer still installs 0.7.0). Delete 0.7's
  binary from `~/.cargo/bin`, where its installer put it, so it doesn't stand in front of the new
  one on your `PATH`. `cargo install ssqch` and `cargo binstall ssqch` end at 0.7.

#### A site's JavaScript

- **A site's JavaScript runs on Node.** The config and data files are loaded by Node, by its
  rules for ES modules and CommonJS, with every package and built-in Node has. What 0.7's own
  runtime did differently goes:
  - A CommonJS package's exports are imported by name only where Node can read the names from
    its source. `import legacy, { twice } from "legacy"` fails for a package that writes
    `module.exports = { name: "legacy", twice }` with other values in it; import the default and
    take it apart (`import legacy from "legacy"; const { twice } = legacy;`).
  - `fs.createReadStream` and the other functions 0.7 only pretended to have are Node's own: a
    stream for a file that isn't there fails later, as an error of the build, where 0.7 threw
    when it was called.
  - `console.log` prints objects as Node prints them, where 0.7 printed JSON.
  - On Windows, paths are Windows' own, as in Node: `node:path` joins with `\`, and
    `process.cwd()`, `__dirname` and `__filename` have drive letters and `\`, where 0.7 gave
    POSIX paths on every system. Code that builds URLs from paths should use `node:path/posix`
    or replace the separators. What ssqch itself hands a site (`page.inputPath`, `page.url`,
    a hook's `dirs`) still has `/` everywhere.
- **`ssqch capabilities` has no stand-in Node modules.** 0.7 listed `node:http`, `node:net`,
  `node:child_process` and 12 more under `nodeModules.stubs`: they loaded and threw when used.
  They are Node's own now, so `nodeModules.available` has all 32 and `stubs` is an empty list
  (the key stays). A script that skips a site's work when a module is a stub should drop the
  check.
- **`fetch` is Node's own, with 0.7's error words and `cache` option on top.** The reason after
  `fetch failed: <url>:` is Node's (`connect ECONNREFUSED 127.0.0.1:9`, `getaddrinfo ENOTFOUND
  ...`), where 0.7 gave its HTTP library's (`io: Connection refused`); a script that matched that
  text should match the `cause` or the URL. Requests go out as 0.7 sent them, where the Fetch
  standard would refuse or change them: credentials in the URL are Basic auth, the user agent is
  `ssqch/<version>`, and a request for a port the standard blocks (6000, 6665 to 6669, 10080 and
  the others) or with a `Host`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade` or `Expect` header
  goes out through `node:http`. Three things are Node's: a response's `statusText` is the server's
  own (`"Pine OK"`), where 0.7 gave the standard words for its status (`"OK"`, and `""` for a
  status without any); a response's `url` has no credentials in it, where 0.7 kept them; and an
  error names the URL without its password. A response saved with `cache` lists its headers in
  name order, with repeated ones joined (`"a, b"`), as Node's `Headers` gives them, where 0.7's
  file had the server's order; a site reads them the same either way.

#### Data

- **Filters and templates get your real objects.** 0.7 handed them copies that kept writes to
  themselves; now a filter that sorts or changes what it's given changes it for the pages
  rendered after it. Copy first (`[...posts].sort()`). Data that refers to itself (`a.self = a`)
  is only data now; 0.7 refused it as "nested too deeply".
- **An object's keys that look like whole numbers come first, in number order**, as JavaScript
  keeps them: paginating over `{ "2024": ..., "b": ..., "2023": ... }` makes the pages for 2023,
  2024, then b, where 0.7 kept the file's order. Use a list where the order matters.
- **YAML dates are dates in every key**, as js-yaml (and so Eleventy) reads them: `updated:
  2026-03-14` is a `Date`, where 0.7 kept it as text for every key but `date`. A template that
  printed the text gets the date printed (ISO 8601 in Jinja and Nunjucks); quote the value to
  keep it as text.
- **YAML numbers and merge keys are js-yaml's too.** `017` is the number 17 and `1_000` is 1000,
  where 0.7 kept both as text, so a value with a leading zero that matters (a ZIP code, `007`)
  needs quotes. `<<: *defaults` merges the anchored mapping in, where 0.7 kept a key named `<<`.

#### Templates

- **Jinja (`.jinja`, `.j2`) and Nunjucks (`.njk`) render with Nunjucks**, ssqch's own fork of
  it, where 0.7 used MiniJinja. Jinja's filters, tests and functions, Python's string, list and
  dict methods, slices, the date filters, tags from your functions and the escaping are kept, so
  most templates render as they did. What doesn't:
  - **`.njk` prints values as Nunjucks does**, as a site from Eleventy expects: `true`, a list as
    `a,b`, an object as `[object Object]` and `none` as nothing, and `dump` is compact JSON
    (`dump(2)` indents it), escaped unless it's followed by `| safe`. 0.7 printed `True`,
    `['a', 'b']` and a spaced, unescaped `dump`, as Jinja does, which `.jinja` still does. A date
    prints as ISO 8601 in both, whatever the machine's time zone.
  - A variable set inside a loop or an `if` keeps its value after it, as in Nunjucks:
    `{% set total = 0 %}{% for x in xs %}{% set total = total + x %}{% endfor %}` ends with the
    sum, where Jinja's scoping left it at 0 (`namespace()` still works).
  - A variable set in an include stays in the include: `{% set shared = "changed" %}` in
    `_includes/i.jinja` doesn't change the page's `shared`, and a name it sets isn't the page's.
    0.7 let both out. Set the value in the page, or have the include print it.
  - `{% break %}`, `{% continue %}`, `{% with %}`, `{% autoescape %}`, the loop filter
    `{% for x in xs if x.ok %}` and recursive loops (`{% for x in xs recursive %}` with
    `loop(...)`) are errors that name their line and say what to write instead. Put an
    `{% if %}` inside the loop, filter the list first (`xs | selectattr("ok")`), or write a
    macro that calls itself for a tree.
  - `loop.previtem`, `loop.nextitem` and `loop.depth` are undefined (`loop.cycle()` and
    `loop.changed()` work).
  - Numbers have no separate float type: `{{ 4 / 2 }}` and `{{ 3.5 | round }}` print `2` and
    `4`, where 0.7 printed `2.0` and `4.0`.
  - `+` and `*` are JavaScript's: `xs + ys` joins two lists as text (use `xs | chain(ys)`), and
    `"ab" * 3` isn't `"ababab"`.
- **Liquid is liquidjs**, the library 0.7's Rust crate followed, with 0.7's own behavior kept where
  the two differ: dates print as 0.7 printed them (`2026-01-02 00:00:00 +0000`, in UTC) in every
  filter; numbers keep the crate's whole numbers and floats (`10 | times: 1.0 | divided_by: 4` is
  2.5, `7 | divided_by: 2` is 3, and a missing or non-numeric operand, or dividing by zero, is an
  error); a missing value reaches a config function as `null`; and `capitalize`, `escape`,
  `escape_once`, `url_encode`, `url_decode`, `split`, `truncate`, `truncatewords`, `map`, `uniq`
  and `size` give 0.7's output. Two of 0.7's answers are Shopify's and Jekyll's now: `"abc" |
  split: ""` is `a`, `b`, `c` (0.7 put an empty string at each end), and `array_to_sentence_string`
  joins two items as `pine and cedar` (0.7 wrote `pine, and cedar`; three or more still have the
  comma). What's liquidjs' own: `{{ some_object }}` prints `[object Object]`, where 0.7 ran its
  keys and values together in no fixed order (`{z: 1, a: "two"}` printed `z1atwo`), so write
  `{{ some_object | json }}`; `{{ some_object.size }}` is its number of keys, where 0.7 printed
  nothing; a string's `size` counts as JavaScript does, where 0.7 counted UTF-8 bytes (`café` is
  4, not 5); and a variable named `empty` or `blank` is Liquid's keyword (`{% if empty %}`), so
  rename it.
- **Edge templates are edge.js 6.5's**, with what 0.7's own Edge did kept around it (an undefined
  value prints nothing, a call reaches the filter beside a page field of the same name,
  `$loop`, `reverse()` and `sort()` giving copies, dates in UTC and as ISO 8601 text, strings
  indexed by character, numbers never in exponent notation). What changes:
  - `{{ safe(html) }}` prints `html` as it is, as edge.js's `html.safe` does. 0.7's `safe()`
    changed nothing, so the value was escaped anyway; drop `safe()` where the escaping was wanted.
  - A variable an include declares with `@let`, that the template including it doesn't have,
    is the include's only, as edge.js scopes it; 0.7 declared it in the including template too.
    Declare it before the `@include` (an `@assign` or `@let` of a variable the including template
    has reaches it, as in 0.7), or make the include a component and pass it as a prop.
  - An async function (an async filter) called inside a callback is awaited in `map`
    (`posts.map(p => cover(p))`), and is an error that says to call it first with `@let` in
    `filter`, `find` and the others, where 0.7 awaited it anywhere.
  - Node's globals are there in expressions (`process`, `URL`), as in any JavaScript; a page's
    value or a config function of the same name still wins, as in 0.7.
  - A parse error is in edge.js's words (`parse error in page.edge: line 2: Unexpected token`),
    with the file and line as before.
- **EJS prints a date at UTC** (`Sun Apr 05 2026 06:07:08 GMT+0000`), in `<%= %>`, `<%- %>`, a list
  and a promise's answer, where 0.7 printed it in the machine's time zone (the two agree on a
  machine set to UTC). Format the date in the template to show it otherwise
  (`date.toLocaleString("en-US", { timeZone: "America/New_York" })`).
- **A Handlebars helper gets a date inside an object as a `Date`.** 0.7 turned the page's data into
  JSON first, so every date was ISO 8601 text; a date passed to a helper itself (`{{year date}}`)
  still arrives as that text, but one inside an object it's given (`{{byline post}}`) is a `Date`
  now.

#### Markdown

- **Markdown is ssqch's own, as in 0.7** (its Rust, built as WebAssembly), so pages come out as
  they did. A page's own Markdown waits for an async `headingIds` function or highlighter in
  `markdown.highlight.languages`, as 0.7 did. Markdown made while a template renders doesn't:
  where such a function answers with a promise, `markdown()` and `highlight()` in a template and
  `markdown()` from `"ssqch"` are errors that name the function, and so is a render hook or
  container template whose engine answers with one (an async filter, function or engine), where
  0.7 waited for them. Make those functions synchronous.

#### Images and feeds

- **`dateToRfc3339` and `dateToRfc822` refuse an invalid date.** An invalid `Date` (`new
  Date("2024-13-45")`) or `NaN` is an error, `dateToRfc3339: not a date: Invalid Date` (or
  `NaN`), as it is for ssqch's other date filters, where 0.7 wrote `1970-01-01T00:00:00Z` into
  the feed without a word. Fix the date, or leave the element out when there's none.
- **The image plugin's quality options are sharp's numbers, and `avifEffort` replaces
  `avifSpeed`.** 0.7's numbers were its own encoders', which read them differently: its AVIF 50
  looks like sharp's 41, and its JPEG 80 like sharp's 89 with mozjpeg. `webpQuality`,
  `avifQuality` and `jpegQuality` now go to sharp as they are, as whole numbers from 1 to 100,
  and `avifEffort` is sharp's AVIF effort, from 0 (fastest) to 9 (slowest, with the smallest
  files). The defaults are 0.7's converted (WebP 75, AVIF 41 at effort 2, JPEG 89), so a site
  that sets none encodes as it did. A site that set one converts it with this table, from the
  calibration at equal SSIMULACRA2 (between rows, along the line; `src/image/quality.ts` has the
  measurements). WebP's numbers are the same in both.

  | 0.7's number | `avifQuality` | `jpegQuality` |
  | --- | --- | --- |
  | 30 | 28 | 54 |
  | 40 | 34 | 60 |
  | 45 | 38 | 63 |
  | 50 | 41 (0.7's AVIF default) | 66 |
  | 55 | 45 | 69 |
  | 60 | 48 | 72 |
  | 65 | 52 | 76 |
  | 70 | 55 | 80 |
  | 75 | 58 | 85 |
  | 80 | 61 | 89 (0.7's JPEG default) |
  | 85 | 74 | 93 |
  | 90 | 86 | 97 |
  | 92 | 90 | 100 |
  | 95 | 96 | 100 |
  | 98 and up | 100 | 100 |

  | 0.7's `avifSpeed` | 1 | 2, 3 | 4, 5, 6 | 7, 8 (the default) | 9 | 10 |
  | --- | --- | --- | --- | --- | --- | --- |
  | `avifEffort` | 5 | 4 | 3 | 2 | 1 | 0 |

  So 0.7's `avifQuality: 60, avifSpeed: 4` is `avifQuality: 48, avifEffort: 3`. A converted
  number keeps 0.7's image names (each file's name holds the settings as the 0.7 number they
  convert from), so the image cache carries over and nothing encodes again. `avifSpeed` fails the
  build with the conversion, and so does a number that isn't whole or is out of range (0.7
  clamped it). At the top of the scale sharp can't match 0.7: from JPEG 92 and AVIF 98 up,
  sharp's best (100) is a little below what 0.7 made there.
- **An image that can't be encoded after its markup is written fails the build.** The image
  plugin writes a page's `<picture>` (and a link's copy, a feed's copy, `imageUrl()`'s URL) from
  the image's header while sharp encodes the files beside the build, so it reads a source through
  before anything points at a file it has to make, and what 0.7 couldn't decode is still a
  warning that leaves the tag as written, in 0.7's words (a file that ends too soon, a damaged
  chunk, a header that doesn't read). What that can't see, such as a PNG whose compressed data is
  damaged under correct checksums, or a cache folder that can't be written, comes to light after
  the pages are written, and the build fails where 0.7 warned, rather than publish markup for a
  file that isn't there: `images: encoding ./dist/img/<id>-300.webp from ./src/hike.png: <why>.
  ./src/posts/hike.md already points at it, so the build stops here rather than publish tracks
  that lead nowhere`. With `--format json` each source is an `images` error, with the source as
  its `file` and the page's address as its `url`. Fix or replace the image, or leave it out with
  `ssqch:ignore`.
- **`files(pattern, { dimensions: true })` reads the sizes of PNG, JPEG, GIF, TIFF, WebP, HEIF and
  AVIF, BMP, PSD, ICO and QOI files.** 0.7 also read EXR, Radiance HDR, JPEG XL, KTX2, DDS, TGA,
  PNM, farbfeld, Aseprite, ILBM and VTF files, whose `width` and `height` are `null` now.

#### Builds and `templateContent`

- **A build that fails can leave pages in the output folder.** Pages are written as they render,
  so the ones rendered before the error are there; 0.7 wrote nothing when any page failed. The
  exit code still says the build failed: don't deploy the folder of a build that failed.
- **A page's `templateContent` is rendered when it's first read.** In 0.7 a page read before it
  had rendered gave an empty string. A page whose own templates are async (an async filter or
  engine) can't be rendered on demand, and reading it too early is an error that names it.

#### `serve.run` tools

- **A `serve.run` tool has no terminal on Linux and macOS, and hears Ctrl-C on Windows.** 0.7
  started each in a process group of its own, so stopping it stopped what it started, and Ctrl-C
  was ssqch's to pass on. Node can only do that by giving the tool a session of its own too
  (Linux, macOS), where nothing opens `/dev/tty`, or a console of its own too (Windows), where
  each program the tool starts opens a window. So on Linux and macOS a tool that asks something
  through the terminal (a password, `npx`'s "Ok to proceed?") can't: give it what it needs on
  its command line (`npx --yes`). On Windows a tool shares ssqch's console and gets Ctrl-C
  itself, as it would from a terminal; what it says once ssqch is stopping isn't shown (cmd.exe's
  "Terminate batch job (Y/N)?"), and ssqch still stops it and what it started.

#### `diff`

- **`ssqch diff --ignore` refuses two kinds of pattern JavaScript can't match.** Patterns are still
  in the syntax of Rust's regex crate, read as 0.7 read them (`\w`, `\d`, `\s` and `\b` in every
  script, `.` up to a `\n` only, flags partway through, `(?x)`, `\A`, `\z`, `[a-z&&[^aeiou]]`, and
  the crate's error messages) and matched by JavaScript. What's refused, with a message that says
  so: the Unicode properties JavaScript doesn't have (`Age`, `Grapheme_Cluster_Break`,
  `Word_Break`, `Sentence_Break`, `Hyphen`, `Grapheme_Link`, `IDS_Unary_Operator`,
  `ID_Compat_Math_Start` and `_Continue`, `Modifier_Combining_Mark`,
  `Prepended_Concatenation_Mark` and the `Other_` ones), and, on Node 22, a property in a
  case-insensitive group that's only part of the pattern (`(?i:\p{Lu})x`). Write the property's
  characters out, or put `(?i)` at the start of the pattern (or use Node 23 or newer).

#### Rust plugins

- **Plugins written in Rust are `.wasm` files.** 0.7's Rust API (a site as its own Rust program,
  `sitesquatch::Plugin`, modules of Rust functions) ends with 0.7. A Rust plugin is now a crate
  built with `ssqch-plugin` for `wasm32-wasip1` (its `Plugin` trait and `export!`), one file that
  runs on every platform, shipped in an npm package whose function returns `{ name, rust: { wasm,
  options } }`. It can have a transform, filters and engines; `crates/ssqch-plugin/README.md`
  and `examples/rust-plugin` show how.
- **The Rust API is gone for good.** The Rust implementation isn't in the repository any more:
  the `sitesquatch`, `sitesquatch-edge` and `sitesquatch-js` crates, the `sitesquatch-plugin-*`
  crates and the `ssqch` crate end at 0.7.x on crates.io, and their source is on the
  `release/0.7` branch. `ssqch-plugin` is the one crate 0.8 publishes. What 0.8 kept of 0.7's
  Rust is built as WebAssembly inside the npm package: the Markdown and highlighter, the minifier
  and Sass (grass), so their output doesn't change.

### Changed

#### The config and a site's JavaScript

- **`import "ssqch"` works from plain Node too.** The npm package's `exports` map names ssqch's
  own modules, which a config, a test or a script can import, where 0.7's package had stubs that
  said to build with ssqch.
- The config can be `ssqch.config.cjs`, `ssqch.config.ts` or `ssqch.config.mts`, besides `.js`
  and `.mjs`.
- A warning a package raises with `process.emitWarning` is one of the build's warnings (`code:
  "console"` in the JSON report), like `console.warn`.
- A stack frame in an error or a warning has the column Node gives: `throw new Error("...")` is
  at `new`, where 0.7 (on QuickJS) pointed at `Error`.

#### Data

- A YAML integer too big for 128 bits (`123456789012345678901234567890`) is a rounded number,
  where 0.7 refused the file. TOML's integers past 2^53 are rounded numbers, as in 0.7.
- A leap second in a page's `date` (`2016-12-31T23:59:60Z`, which TOML can write) is the
  second before it, since a JavaScript date has no 60th second; 0.7 kept it. In any other key a
  TOML date is its text, as 0.7 wrote it, the 60th second included.

#### Templates

- Liquid, Handlebars, Mustache and EJS templates render with liquidjs 10.30, handlebars.js 4.7 (for
  Mustache too, as 0.7 did with its Rust port) and ejs 3.1.10, and their output is 0.7's apart from
  what's under Breaking (the Liquid, Handlebars and EJS starters build to the same bytes). Each
  function a template calls runs once a page, an async one included. Their errors say `file:line` as
  the other engines' do, and the JSON report has the `line` (0.7's Liquid parse errors drew an
  excerpt with a line of their own, its Handlebars errors said `line 2, column 1:`, and its other
  Liquid errors named only the file); an unknown helper or filter gets the closest name ("did you
  mean"), and an error in an include or partial names that file. A function's error starts with its
  name (`boom(): ...`), as in the other languages. `strict` refuses what 0.7 refused: in Liquid a
  missing variable anywhere but `{% if %}` and `{% unless %}` asking whether it's there, and in
  Handlebars a missing argument to `each`, `with`, `lookup` and the comparisons. A Handlebars
  partial named without its extension (`{{> nav}}`) is the Handlebars file when there's one, where
  0.7 took whichever file of that name the folder listed last. What 0.7 refused or got wrong that
  works now: an EJS function's promise that's printed (`<%= later(x) %>`) is awaited where 0.7
  printed `[object Promise]`, and an EJS template can `await`; Liquid's `{% render %}` partials
  print nothing for an unknown variable, where 0.7 failed; Liquid's `date` reads ISO 8601 text
  (`2024-03-04`), Jekyll's `date_to_xmlschema`, `date_to_rfc822`, `date_to_string` and
  `date_to_long_string` are there, and so are liquidjs' other filters and tags (`where_exp`, `sum`,
  `{% liquid %}`, `{% echo %}`); a Mustache-style section in a `.hbs` file (`{{#items}}`) works,
  where 0.7 said "Helper not found"; and `--verbose`'s list of templates nothing used covers Liquid,
  Handlebars and Mustache too.
- Nunjucks' own syntax and filters work in `.jinja` files too (`{% elseif %}`, `===`,
  `{ title: x }`, `forceescape`, `nl2br`, `urlize`, `wordcount`, `center`, `random`), and
  `{% for key, value in object %}` works there. A Jinja or Nunjucks error in an include points
  at the include's own line, where 0.7 pointed at the `{% include %}` in the page.
- Tags from the config's functions (`{% image "/a.png", "A pine" %}`, and paired with `{% endimage
  %}`) work in `.jinja` files too, where 0.7 had them in `.njk` only.
- Edge has what edge.js has: destructuring in `@let`, block-bodied arrow functions, regular
  expressions, the `in` operator, `@eval`, `@inject`, `@stack` and `@pushTo`, and edge.js's
  helpers (`excerpt`, `html.attrs`, and `nl2br`, which gives HTML to print as it is, so escape
  what it's given: `{{{ nl2br(html.escape(text)) }}}`). `await` waits for a promise. A number's
  `toString(16)` uses its radix, which 0.7 ignored; `new Date(2024, 0, 5, 9)` keeps its hours
  (in UTC), where 0.7 dropped everything after the day; and a date's `toLocaleString()` and
  `toLocaleTimeString()`, which 0.7 didn't have, are `Intl`'s, in UTC unless they're given a
  `timeZone`. A function that isn't there says which one was probably meant (``index.edge:2:
  `uper` is not a function (did you mean `upper`?)``), or ssqch's name for another generator's
  (`slug`).

#### Images

- **Images are encoded by sharp** (libvips, with libaom for AVIF, libwebp and mozjpeg), where 0.7
  had encoders of its own, so an image file's bytes aren't 0.7's. The rest is: the markup, the
  files' names, widths and heights, and the cache. At the defaults, which are 0.7's converted
  (Breaking has the table), the files are smaller and quicker to make: AVIF about a quarter
  smaller at effort 2 (11 to 19% at effort 3, 0.7's speed 4) in well under half the time, WebP 1%
  smaller, and JPEG a tenth smaller at 0.7's quality 80. PNG files are compressed at zlib's level
  6, as 0.7's were, without its row-by-row filters (sharp's default): 18% smaller in all on the
  blog's PNGs, and a tenth less CPU time for a cold build, though a few photos from an iPhone are
  up to a fifth bigger. They stay grey or 16 bits when the source is. A JPEG of a transparent
  image keeps the colour under the transparency, as 0.7's did. A site's image cache from 0.7 is
  used as it is, since the names are the same, so the output has 0.7's files next to sharp's
  until the cache goes: delete `.cache/ssqch/img` to encode every file again. AVIF is always
  there, where 0.7 needed its `avif` feature.
- Images are encoded as many at once as there are cores (`os.availableParallelism()`), on libuv's
  thread pool, which the `ssqch` command sizes to the cores plus 4 so page writes keep threads.
  Each file is encoded on one thread, since libaom's AVIF bytes change with the threads it's
  given, so a file comes out the same on every machine, whatever its cores or
  `UV_THREADPOOL_SIZE`.
- `[ssqch] Encoded ...` lines come as each image's files are done, while pages go on rendering,
  so they're among the `Writing` lines, not before the page that shows the image. The build waits
  for every file before the link checker, the other plugins' files, `afterBuild` hooks and the
  summary, and the `Time` line counts the wait under `write`, as 0.7 did.
- A warning about an image that can't be read gives the decoder's reason once, where 0.7 repeated
  it (`reading <file>: Format error decoding Png: Invalid PNG signature.`, without 0.7's second
  `: Invalid PNG signature.`).

#### Builds

- **A glob matches a path by its characters.** `?` is one character and a class's members are
  characters, so `?.jpg` matches `é.jpg` and `[é]` matches `é`; 0.7 matched UTF-8 bytes, where
  neither did. That's every glob: `diff --only`, schemas' `files`, the config's `ignore` and
  `passthrough`, the sitemap's `exclude`, and `files()`. Ignoring case is still for ASCII letters
  only.
- `--output ../public`, an output folder outside the project given from it, builds there. 0.7
  refused it with `permalink Some("/src/") points outside the output directory`, by mistake: its
  check for a permalink that leaves the output folder counted the folder's own `..` (an absolute
  path, `--output /srv/www`, worked).
- **Highlighted code is kept between builds** in `.cache/ssqch/highlight/fences.json`, so a new
  process (`ssqch build`, the first build of `ssqch serve`) takes each fence's HTML from there
  instead of loading syntect's grammars: the blog's build takes 0.64 s instead of 1.0 s. 0.7 kept
  fences in memory only, for the rebuilds of `ssqch serve`, as 0.8 still does. A fence is kept by
  its language, code, marked lines and the site's `languages`, under the highlighter's version (a
  hash of what it's built from), and not when a site's own function highlights it. The file has
  the fences the last build used, is written only when they change, and is ignored and written
  again when it's damaged or another version's. Pages come out the same, byte for byte, with or
  without it.

#### Messages

- Messages that quote a parser are that parser's: YAML, JSON and TOML errors keep `at line N
  column M` (which the JSON report's `line` comes from), with js-yaml's, Node's and smol-toml's
  words before it. The error for a permalink outside the output folder names the permalink
  (`"/../up.html"`, where 0.7 printed `Some("/../up.html")`), and the warning for a data file
  nothing can read says to provide it in the config's `data` (0.7 named the Rust API). A TOML
  date that can't be (`2023-02-30`) says what 0.7 said (`invalid date, expected day between 01
  and 28`), and a number past what 0.7 held says `integer number overflowed` (0.7: `u64 value
  was too large`) or `floating-point number overflowed`. An error in `sitesquatch.toml` names
  the file as 0.7 did (`./sitesquatch.toml`), with its line and the excerpt under the message,
  and says what a key must be (`input must be a string`) where 0.7 quoted its TOML library
  (`invalid type: integer 3, expected path string`). An error from the file system keeps 0.7's
  words for what was being done and has Node's for what went wrong: `creating f: EEXIST: file
  already exists, mkdir 'f'`, where 0.7 said `creating f: File exists (os error 17)` (in `init`,
  `types`, `new`, and the `footprint` and `diff` walks).

#### The dev server

- `ssqch serve` builds in a process of its own, which it starts again when the config changes
  (or a module it imports, a JavaScript data file, or a module that imports). Everything the
  site's JavaScript loaded is read again: ES modules, CommonJS ones and what they `require`, JSON,
  and whatever a module kept in memory. Packages in `node_modules` start over with it, though a
  change to one of their files still isn't watched. The commands, the messages and the ready
  file are 0.7's, and so is the reload script the browser gets.
  - A site whose code ends the process (`process.exit()`, or an error nothing catches in a
    timer) fails that build, shown in the browser like any other, with what was thrown. Another
    process loads the configuration at once, so the server goes on building with the last one
    that loaded, as 0.7 did, unless the config's files changed in that moment: then nothing
    builds until one loads, and the config's error says so. An error thrown after a build has
    reported fails the next build, with that error, as in 0.7 (where timers ran during the next
    build). The server stays up, and Ctrl-C in the middle of a build says nothing about it.
  - A folder renamed away and back again rebuilds both times, and a config file that's deleted
    and put back (or made while the defaults build) is read again. 0.7 missed both.
  - A rebuild compares each page with what the last build found in its file, from memory, and
    reads the file again only when its size, its modification time or its change time is
    different, or it's another file. So a page that something else rewrote is written again
    even when that kept the modification time (`cp -p`, `rsync -a`, `touch -r`), as in 0.7,
    which read every page.
  - On Linux, the server watches each folder itself and leaves out the ones named `.cache`,
    `.git` and `node_modules` (0.7 watched them and ignored what they reported), so a site whose
    input folder is the project root doesn't spend a watch on every folder of its packages.
    When the system has no watches left (`fs.inotify.max_user_watches`), a warning names the
    first folder that wasn't watched, and the server goes on.

#### The importer

- `ssqch import eleventy` and `ssqch import zola` do what 0.7's did, word for word. Two things
  follow from the rest of 0.8: a draft config isn't written where one of the new config names is
  already there, and a date in a Zola site's `[extra]` (`founded = 2019-05-01`) goes into the
  draft as its text, `"2019-05-01"`, where 0.7 wrote an object with a `$__toml_private_datetime`
  key that no template could print. Three things are fixed. `package.json` is edited where it
  changes and kept as it's written everywhere else, where 0.7 printed the whole file again (a
  list on several lines, `1e5` as `100000.0`, escapes written out, the dev dependencies sorted).
  A template literal with `${...}` in it (`` addPassthroughCopy(`${dir}/img`) ``) and a filter
  whose default value reads the config (`(value, format = dateFormat) => ...`) are left for a
  person to port, where 0.7 put them in the draft as they were, a path and a name that don't
  exist and a function that needs a variable the draft doesn't have. A Zola `config.toml` that
  isn't TOML shows its line and the spot, as 0.7's did, with smol-toml's words for what's wrong.

#### The tools

- `ssqch init --starter docs` writes Install and Deploying pages for 0.8: ssqch as a dev
  dependency from npm or pnpm, run with `npx ssqch`; Netlify running `npx ssqch build` with
  `NODE_VERSION`; and a GitHub Pages workflow with `actions/setup-node`. 0.7's pages showed the
  installer script, `cargo install` and `setup-ssqch`, and its Netlify command fetched
  `latest/download/ssqch-installer.sh`, which 0.8.0's release doesn't have.
- `ssqch capabilities` lists `ssqch.config.cjs`, `.ts` and `.mts` under `configFiles`, and says
  `avif` and `sass` only when this build can do them (sharp writes the AVIF files).
- `ssqch inspect` shows a date that isn't one (`new Date(NaN)` in the config's `data`) as `null`,
  as `JSON.stringify` does; 0.7 showed the first moment of 1970, which no page had.
- `ssqch diff` compares every file when a fingerprinted name is another file's name without its
  last fingerprint (`x.11111111.22222222.css` beside `x.11111111.css` and `x.css`). 0.7 lost one
  of the two from the report.
- `ssqch/minify` and `ssqch/sass` are 0.7's minifier and 0.7's Sass compiler (grass 0.13.4),
  built as WebAssembly, so pages and stylesheets come out as 0.7 wrote them. A Sass error's last
  line names the file from the project root (`./styles/blog.scss:1:16`), where 0.7 printed its
  absolute path after `./`; so do the paths in `@warn` and `@debug` lines.
- `base` and the plugins read a page's HTML where 0.7's HTML rewriter (lol_html) read it, except
  where lol_html wasn't the same from one use to the next, and there they read it as browsers
  do: after a tag that ends in `=>` (`<script src=>`), the element's content is text, where some
  of 0.7's plugins read it as markup; and SVG's `<title>`, `<desc>`, `<foreignObject>` and
  `<font>`, and MathML's `<mi>`, `<mo>`, `<mn>`, `<ms>` and `<mtext>`, are seen right after an
  end tag (`<path></path><title id="t">`), where 0.7 skipped them, so the link checker finds an
  `id` there. A `<style>`, `<title>`, `<textarea>` or `<iframe>` inside a `<select>`, or after a
  `<frameset>`, holds text, where 0.7 refused the page ("The parser has encountered a text
  content tag").

## 0.7.1 - 2026-11-18

The last release of the Rust implementation. 0.8 runs on Node: the same sites, commands and
output, built by a TypeScript program with ssqch's own Markdown, highlighter, minifier and Sass
as WebAssembly. Move to it with `npm install --save-dev ssqch` once 0.8.0 is out; its changelog
lists what a site has to change. 0.7.x gets no more releases, and nothing else changed since
0.7.0.

## 0.7.0 - 2026-11-17

Found moving lit.dev from Eleventy.

### Breaking

- A `layout` in `computed` that depends on the page (a function, or a string with template
  tags) is an error: the layout is chosen before `computed` runs, so it was ignored without a
  word, and the page was built without it. Set `layout` in the front matter or a data file. A
  computed `layout` that's plain text (`computed: { layout: "article" }`) is now applied.

### Changed

- Blank lines after the front matter's closing `---` stay in the page's body, as gray-matter
  (and so Eleventy) keeps them; only the fence's own line ending goes. A JSON or text page
  written from a template that starts with a blank line used to lose it. Markdown renders the
  same; an HTML page keeps the blank lines at its top.
- Passthrough copies of a folder follow links (symlinks) and copy the files they point at,
  as globs already did. A link was skipped without a word (lit.dev lost 360 sample files),
  and a link to nothing is now an error that names it.
- `process.versions.node` is `24.0.0` (and `process.version` is `v24.0.0`), the Node version
  the shims follow. Packages that check it when they load, fast-glob among them, crashed.
- `node:fs` has the callback versions of its functions (`fs.readdir(dir, options, callback)`,
  `fs.stat`, `fs.readFile`, `fs.exists`, ...), which older packages and fast-glob's async API
  use; `readlinkSync` and `symlinkSync`; and `createReadStream`, `createWriteStream`,
  `ReadStream`, `WriteStream` and `watch`, which throw when called, so packages that import
  them by name (node-fetch 3, and with it Lit's server rendering) load.
- `import(pathToFileURL(file).href)` works: `import` and `require` take `file:` URLs, as in
  Node.
- `ssqch import eleventy` doesn't read settings or calls from comments (a commented-out
  `markdownTemplateEngine: 'njk'` set the wrong engine); lists `addNunjucksAsyncShortcode`,
  the paired Nunjucks and Liquid shortcodes, `addNunjucksTag`, `addLiquidTag`,
  `addNunjucksGlobal` and `addMarkdownHighlighter`; says when a shortcode's name comes from a
  variable instead of listing the variable as a shortcode; says when a plugin is one ssqch
  doesn't know (the site's own), instead of pointing at a package list it isn't in; rewrites
  `eleventy` in wireit's `command`s; and leaves `eleventyNavigation` front matter alone when
  templates call the `eleventyNavigation` filter, which reads it (renaming it emptied
  lit.dev's navigation), with how to keep that filter.
- The warning for `eleventyNavigation` front matter says that templates and filters that
  read it still can, instead of "it isn't in the navigation".

### Fixed

- `## Install {#setup}` in Markdown no longer starts a Jinja comment: Markdown runs through
  Jinja (or Nunjucks) first by default, and `{#` opened a comment that swallowed the page up
  to the next `#}`. `{#...}` at the end of a line, closed by `}`, is left for the Markdown
  heading attributes ssqch documents.
- `layout: ""` means no layout, as `false` and `null` do (and as in Eleventy). It was an
  error, `layout `` not found`.
- A layout file named only `.html` no longer panics ssqch.
- The Nunjucks and Jinja rewriter no longer panics on a character like `’` or `—` inside a
  tag.

## 0.6.5 - 2026-11-17

### Changed

- The config `ssqch import eleventy` drafts leaves out `// Port each filter and shortcode here`
  when it ported every filter and shortcode, and puts it after the ported ones when some are
  left (the list at the end names them).
- Commands in `beforeBuild`, `afterBuild` and `serve.run` find the tools a site installed: each
  `node_modules/.bin` from the project's folder up goes in front of their `PATH`, as npm, pnpm
  and yarn do for scripts. `{ run: "postcss ..." }` used to work under `npm run build` and fail
  with `postcss: not found` under `ssqch build` (found moving the ReverentGeek blog and v8.dev).
- A page's `render` replaces its folder's instead of joining it: `render: [njk]` over a
  folder's `render: [mdit]` is `njk`, not `mdit, njk`. `render` is an engine chain, so the list
  form now behaves like the string form. `tags` and other lists still join. A site that relied
  on the joined chain lists every engine in the page's `render`.
- `{{ title | slug }}`, Eleventy's filter, is refused with what differs: ssqch's `slugify` turns
  `.` into `-` (`Node.js` is `node-js`, Eleventy's `slug` gives `node.js`), and how to keep the
  old URLs with the `slugify` package. It used to suggest `sum`.

### Fixed

- An apostrophe in a Nunjucks or Jinja comment (`{# we don't #}`) no longer turns off
  ssqch's rewrites for the rest of the file. Below it, `.length` printed nothing, `===` and
  `!==` were syntax errors, and `{% for k, v in obj %}` and config tags weren't rewritten.
  Found moving a11yproject.com, where it removed the table of contents from 35 pages.
- A quoted word in a page's text that names an include (`The "footer" of your page`) no
  longer moves the page to the second render pass when that include reads `collections`.
  Before, that left the page's `templateContent` empty in a feed or any other page that showed
  it. Only names inside template code count now.
- `ssqch import eleventy` leaves script names alone in `package.json`: `npm run eleventy-watch`,
  `npm run eleventy` and `run-s clean build:eleventy` stay as they are (the scripts they name
  keep their names). It turned them into `npm run ssqch build` and the like, which pointed at
  scripts that didn't exist. Only the `eleventy` command itself becomes `ssqch build`.
- Nunjucks escapes `\` as `&#92;`, as Nunjucks does (`.njk` only; Jinja leaves it), so feeds and
  pages with a backslash in escaped text match Eleventy's.
- The link checker matches a `#fragment` as written before decoding it, as browsers do, so
  `#tl%3Bdr` reaches markdown-it-anchor's `id="tl%3Bdr"`. It reported every such link as
  broken (150 on v8.dev).

## 0.6.4 - 2026-11-17

### Added

- `files()` gives each file a `dateFrom`, `"name"` or `"modified"`, so a data file can tell a
  photo's date from its name from a modification time, which only says when the file was copied.
- `slugify(title, { apostrophes: "separate" })` splits words at an apostrophe
  (`drew-s-brownies`) instead of dropping it (`drews-brownies`, still the default), for a site
  whose URLs were made that way. `slugger()` takes it too.

### Changed

- `files(pattern, { dimensions: true })` keeps image sizes in `.cache/ssqch/image-sizes.json` by
  path, size and modification time, so a build reads only new and changed images, and reads
  them on several threads. 1,043 photos: 5 ms with the cache, from about 18 ms (warm) or 110 ms
  (cold) before.
- `ssqch import eleventy` puts ssqch in `devDependencies`, pinned exactly, as the README says,
  instead of where `@11ty/eleventy` was (an emptied `dependencies` goes). For a pnpm 11 site
  without ssqch in `minimumReleaseAgeExclude`, it lists the five names to add.
- The draft config follows the Eleventy config's trailing commas (none if it has none) and
  quotes only the keys that need them (`{ images: "images" }`), unless the config quotes every
  key. Gahlee House's draft passes its own ESLint config apart from `n/no-unpublished-import`,
  which the README covers.
- The README's Install section recommends excluding the five packages from pnpm's release age
  by name, and says how to upgrade when they're excluded by version: add the new version's
  lines beside the old ones, install, then remove the old ones. Swapping them locks every
  install out (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`) while the old version is under a day
  old.

## 0.6.3 - 2026-11-17

### Added

- `files(pattern, { dimensions })` from `ssqch` lists the files a glob matches, for data files:
  `{ path, url, name, stem, ext, date, size }` for each, sorted by path, with `width` and
  `height` from the image's header when `dimensions` is on. The glob ignores case (`*.jpg` finds
  `.JPG`), `date` comes from the start of the name (`20011222_08.JPG`, `2001-12-22-camp.jpg`) or
  the modification time, and `url` is from the input folder for a file inside it. It replaces
  `readdirSync`, an extension filter and a date parser in a data file.
- `slugify` takes a separator: `slugify(title, { separator: "_" })` (or `slugify(title, "_")`,
  `{{ title | slugify: "_" }}` in Liquid) is `taco_bake`. Another option is an error. Data files
  can import `slugify` from `ssqch`, and `slugger()`, a `slugify` that counts, so two albums
  called "Misc Pictures" get `misc-pictures` and `misc-pictures-1` in the data, and a paginated
  page's permalink and the links to it agree.
- `ssqch diff` notes a page whose changes are all dates or years (`only dates changed (2025 ->
  2026)`), says how many changed files differ only that way, and has `onlyDates` in the JSON. A
  page with no date of its own gets its file's modification time, which another generator or a
  fresh checkout sets differently; `ssqch docs "dates that changed"` explains.
- `ssqch import eleventy` carries more over:
  - `addPassthroughCopy({ "images": "images" })` with keys and values written out becomes a
    `passthrough` entry; only variables and computed values are left to a person.
  - Filters and shortcodes whose function uses only its own arguments are copied into the
    draft's `filters` as written, instead of being listed.
  - `package.json`: `@11ty/eleventy` becomes `ssqch`, and scripts that run `eleventy` run
    `ssqch build` (`eleventy --serve` is `ssqch serve`; `--port`, `--quiet`, `--output` and
    `--pathprefix` carry over, and other flags are listed). A lockfile from another package
    manager than the one `packageManager` names is listed to delete, and the site's own to
    update.
  - The draft config is written in the Eleventy config's style: its indentation (tabs, or its
    number of spaces) and spaces inside brackets.
- The README's Install section says how to install a release on the day it comes out with
  pnpm 11 and later, which wait a day: list `ssqch` and the four `@ssqch/*` platform packages
  under `minimumReleaseAgeExclude`.
- The `islands` example has a trail cam page: photos listed from a folder with `files()`, in a
  `<photo-gallery>` element, a lightbox with previous and next, the arrow keys, Escape and
  captions.

### Fixed

- `.length` printed nothing in Nunjucks and Jinja templates (`{{ albums.length }}`), with no
  warning. It counts a list's items or a string's characters now, like `| length`, in `.njk`
  and `.jinja` files; `loop.length` and an object's own `length` key keep their meaning.
- A UTF-8 byte-order mark at the start of a file stopped the build (`invalid JSON in
  src/_data/tblPhoto.json: expected value at line 1 column 1`, from SQL Server's JSON exports).
  It's skipped in JSON, YAML and TOML data files, `readData()`, JavaScript and JSON modules,
  and pages and layouts, where it hid the front matter.
- The config `ssqch import eleventy` drafts said `Eleventy's defaults: Markdown and HTML run
  through Liquid first.` above engines that came from the site's own config. It says where
  they came from.

- `ssqch serve` with `serve.run` tools updates the browser once where it used to update it
  twice. The first build waits for the tools' first compile (up to 2 seconds), so its pages link
  the tools' files instead of a production build's fingerprinted ones, and the first page served
  has its CSS. After a rebuild, the browser's update waits until the tools have stopped writing
  (150 ms of quiet), so a template edit that adds Tailwind classes is one reload with the new
  CSS. A tab left open from an earlier `ssqch serve` reloads once, after the new server's first
  build.
- `ssqch serve` says `swapping it in` for a stylesheet another tool wrote, instead of
  `reloading`: the page swaps it without a reload.

## 0.6.2 - 2026-11-16

### Changed

- `ssqch docs` answers a search with the paragraph whose bold label has every word of it
  (`ssqch docs "your own languages"`), and `ssqch docs languages` with the paragraph on adding
  highlighting languages, not only the options table's row.
- The Eleventy, Docusaurus and component-framework trailheads say where a custom highlighting
  language goes (`markdown: { highlight: { languages } }`).
- TOML front matter and `site.toml` are read as TOML 1.1, so an inline table can span lines and
  end with a comma (`snack = { name = "Pine Cone Crunch", count = 3, }`). Everything that read
  before still reads the same.
- Updated dependencies: toml 1, similar 3, sha1, sha2 and md-5 0.11, and ravif 0.13. The blog's
  pages, feed and AVIF images build byte-for-byte the same as with 0.6.1.

## 0.6.1 - 2026-11-15

### Added

- Sites can add highlighting for a language ssqch doesn't have, or replace a built-in one, with
  `markdown: { highlight: { languages } }`. A language is a function, `(code, lang) => tokens`
  (`[text, kind]` pairs or `{ text, kind }` objects, where `kind` is an `hl-*` name like
  `keyword`), another language's name (`cho: "chordpro"`), or a `.sublime-syntax` grammar file.
  A site's languages come before the built-in ones, keep line marking (`{1,4-6}`) and the
  `hl-*` classes, and apply to fences, `highlight(code, lang)` and the fence hook's
  `highlighted`. A highlighter that throws, returns an unknown kind or tokens that aren't the
  code gets a warning naming the page, and that fence is plain text.
- ChordPro is highlighted (`chordpro` and `cho` fences): directive names as keywords, their
  values as strings (comments for `{comment: ...}`), `[G7]` chords anywhere in a lyric line, and
  `#` comment lines. Lyrics stay plain.

### Fixed

- `ssqch serve` kept serving with the last good configuration after a changed one failed to
  load, but without its image processor, so the next rebuild failed in `feedHtml()` and
  `imageUrl()` ("the image processor isn't set up"). The processor is put back too.

## 0.6.0 - 2026-11-14

### Breaking

- The link checker (`linksPlugin()`) reads every URL the build writes on the site, not only
  HTML attributes: `.xml` output (feeds and the sitemap, including the escaped HTML of a feed
  entry's content), `<meta>` values that are URLs (`og:image`, `og:url`, `twitter:image`),
  strings in JSON-LD blocks, `imagesrcset`, and absolute links on the site's own address (the
  new `url` option, or the address `sitemap.xml` uses). A production build that passed before
  can fail on a link it never looked at. Fix the link, or skip its path with `ignore`.
- Generated images are encoded into `.cache/ssqch/img/` and linked (or copied) into the
  output's `img/` folder on each build, so deleting the output folder no longer means encoding
  every image again. Cache `.cache/ssqch` between deploys instead of `<output>/img` (on Netlify,
  `paths = [".cache/ssqch"]` for `netlify-plugin-cache`). Nothing is encoded again on the way:
  a build takes in the files already in `<output>/img` (from before, or a deploy cache) when
  the cache doesn't have them, so keep caching both for the first deploy. `cacheDir` on
  `imagePlugin()` moves the cache, and `cacheDir: false` keeps the old behaviour.

### Added

- `imageUrl(src, { width, format })`, a template function on every site and an export of
  `ssqch/image`: the URL, size and type of one generated copy of an image, for `og:image`,
  JSON-LD and feeds, where the image plugin's `<picture>` doesn't reach. The default is the
  original's width in the source's own format.
- `feedHtml(html, base, { width, format })` from `ssqch/rss` (and a filter with
  `rssPlugin()`): a post's HTML for a feed, with each local image pointing at one generated
  copy (1200 pixels wide at most by default), page-only attributes removed, and every URL
  absolute.
- `ssqch:preload` on an `<img>` adds a `<link rel="preload" as="image">` for it to `<head>`,
  before the first stylesheet, and loads it eagerly with `fetchpriority="high"`.
- `ssqch serve --built` serves the output folder as the last build left it, the way a host
  would: no build, no watching, nothing added to pages, and gzip for text. `ssqch preview`
  (Vite's and Astro's word) is the same command.
- `assetsPlugin()` rewrites imports in inline module scripts (`import { setup } from
  "/assets/pco.js"`), and a listed file can be a passthrough copy: it's copied into the output
  before it's fingerprinted. Listing one used to fail a clean build.
- The npm package has an `exports` map for `ssqch` and the `ssqch/*` modules, with their types,
  so ESLint's `n/no-missing-import` and TypeScript resolve them without `ssqch types`. (Running
  one with plain Node says to build with ssqch instead.)
- `BuildContext::passthrough_source`, for a Rust plugin that needs a passthrough file before
  it's copied.

### Fixed

- `image()` with `formats: ["auto"]` returns the files under `auto` too, next to the format it
  became (`png`), so `derivatives.auto[0]` works.

## 0.5.2 - 2026-11-13

### Added

- ssqch is on npm: `npm install --save-dev ssqch` (or `pnpm add -D ssqch`) pins it in a site's
  lockfile, and `npx ssqch build` runs it. The `ssqch` package runs the binary from an optional
  dependency for the platform (`@ssqch/darwin-arm64`, `@ssqch/darwin-x64`, `@ssqch/linux-x64`,
  `@ssqch/win32-x64`), so installing runs no install scripts and downloads nothing from GitHub.
  On Netlify, a site with ssqch in its `devDependencies` gets it from the install step, with no
  installer in the build command. Each release publishes them after the GitHub release, with
  provenance.

## 0.5.1 - 2026-11-13

### Fixed

- `ssqch serve` no longer leaves pages unstyled after another build writes into its output
  folder (a production build cleans it and renames the CSS and JavaScript to fingerprinted
  names, and a `serve.run` watcher only writes again when a source changes). When a stylesheet
  or script it has seen is deleted by something else, the server waits for the output to go
  quiet, starts the `serve.run` tools again, waits for them to write their files, and rebuilds.

## 0.5.0 - 2026-11-12

### Breaking

- Archetypes are blueprints now: `ssqch new` starts a page from a file in `_blueprints/`
  (`_blueprints/posts.md`), and `--archetype` is `--blueprint`. Rename a site's `_archetypes/`
  folder (and a theme's) to `_blueprints/`. The JSON from `ssqch new --format json` has
  `blueprint` in place of `archetype`. Hugo's `--kind` gets a hint naming `--blueprint`.
- Jinja is the default template language of the `ssqch` command, in place of Edge: the
  defaults are `templateFormats: ["jinja", "md", "html"]`, `markdownEngine: "jinja"` and
  `htmlEngine: "jinja"`. A site in Edge that relied on the defaults keeps working by setting
  them: `templateFormats: ["edge", "md", "html"]` (or the list it uses), `markdownEngine:
  "edge"` and `htmlEngine: "edge"` (`template_formats`, `markdown_engine` and `html_engine` in
  `sitesquatch.toml`). A site that lists `"edge"` in `templateFormats` but not the other two
  only needs `markdownEngine: "edge"`, and `htmlEngine: "edge"` if it has `.html` pages or
  layouts. The Rust library's `Config::new` still defaults to Edge, the engine it has without
  plugins, and so does an `ssqch` built without the `jinja` feature.
- `ssqch init` starts a site in Jinja (`src/_includes/layout.jinja`, `src/index.jinja`), and
  `ssqch init --starter docs` writes its layouts, render hook and containers in Jinja. Pass
  `--engine edge` for the starters as they were.
- Page bundles (`bundles: true`) and themes no longer copy a template the site doesn't render: a
  file in a template language that isn't in `templateFormats` (`private.edge` next to
  `index.md`, or in a theme), or a `.md` file, stays out of the output, since its front matter
  could be a draft. A theme's gets the same warning as the site's own. Copy one on purpose with
  `passthrough`.
- Rust library: `MarkdownEngine::render_html` doesn't take the page's path any more, and a
  layout's or hook template's `RenderContext::input_path` is that file, not the page's.

### Added

- `ssqch init` writes an `AGENTS.md` for coding agents (and a one-line `CLAUDE.md`,
  `@AGENTS.md`): what each file in the starter is, how to look a name up (`ssqch docs`), how to
  check a change (`ssqch build --format json`) and how to compare builds. It never replaces one
  that's there. `ssqch docs agents` prints it for a site that already exists.
- `ssqch docs`: the documentation of the installed version, from the binary, with no network
  or README on disk. Alone, it lists every command, config option, template function and module
  export with one line each. `ssqch docs base` (or `imagePlugin`, `toc`, `serve`, `--starter`)
  prints what the README says about it, `ssqch docs "content schemas"` prints a section, and
  other words search the text. Another generator's word says ssqch's: `ssqch docs pathPrefix`.
  `ssqch docs --from eleventy` (or `hugo`, `jekyll`, `zola`, ...) lists that generator's words
  with ssqch's for each, then its trailhead. `--format json` is for scripts and agents.
- `ssqch init --starter docs` takes `--engine` too: `jinja` (the default), `njk`, `edge`,
  `liquid`, `hbs` or `ejs`. Each one builds the same pages. The site starter gains `--engine jinja`,
  and `--engine njk` writes the Jinja templates as `.njk` files.
- A build warns about files in a template language the site has but doesn't list in
  `templateFormats`, which it leaves out, instead of leaving them out without a word:
  `index.edge isn't rendered: templateFormats is jinja, md, html. Add "edge" to render it, or
  list it in ignore.` (diagnostic code `template-formats`).
- `ssqch capabilities` reports the `defaults` (`templateFormats`, `markdownEngine`,
  `htmlEngine`) and the `starterEngines` that `ssqch init --engine` takes.
- EJS templates (`.ejs`): add `"ejs"` to `templateFormats` (and `markdownEngine: "ejs"` for
  Markdown). They run on the JavaScript engine built into ssqch, so no npm install, with
  EJS 3's tags and output, `include()` from `_includes`, and config filters and ssqch's
  functions in scope by name. `ssqch init --engine ejs` starts either starter in EJS, `ssqch import eleventy`
  carries `.ejs` templates over, and
  ` ```ejs ` fences are highlighted.
- `ssqch footprint [dir]`: what a build weighs, by kind of file (pages, images, CSS,
  JavaScript, fonts, ...), and its largest footprints, the heaviest pages and the heaviest other
  files. It reads the site's output folder or any build folder, with `--top N` and
  `--format json`.
- `budgets: { pages: "150 KB", images: "500 KB", total: "300 MB" }` (`[budgets]` in
  `sitesquatch.toml`): after each build, files over their kind's budget are a warning
  (`over-budget`).
- `serve: { run: [...] }` (`[serve] run` in `sitesquatch.toml`): programs `ssqch serve` starts
  with the server and stops with it, such as `npx @tailwindcss/cli ... --watch`. Their output
  is shown with the tool's name in front (`[tailwindcss] Done in 16ms`), they keep running
  across a config reload that doesn't change them, and stopping the server (Ctrl-C, SIGTERM)
  stops them and whatever they started. One that stops early is a warning. Builds don't run
  them. The README has a new "CSS and JavaScript" section, with a Tailwind example.
- When a page `ssqch serve` sends links a stylesheet or script that isn't in the output, a
  note on the page and a warning in the terminal say so (diagnostic code `missing-asset`),
  naming the `serve.run` tool that should have written it, and the warning repeats after each
  build until the file is there.
- Other generators' words that mean the same thing in ssqch work, as aliases, and say ssqch's
  name once (`note: pathPrefix works; ssqch calls it base (ssqch docs base)`; `--quiet` hides
  it, and a JSON report lists them in `aliases`, not `warnings`): the commands `dev`, `start`,
  `server`, `watch` and `generate`; the flags `--watch` and `--serve` (they serve), `-d`,
  `--destination` and `--pathprefix`; the config options `pathPrefix`, `dir`, `publishDir`,
  `outDir`, `markdownTemplateEngine` and `htmlTemplateEngine`; the front-matter keys
  `eleventyComputed`, `eleventyExcludeFromCollections`, `redirect_from` and
  `templateEngineOverride` (which used to be an error); and the filters `url`, `relative_url`
  and `markdownify` in Jinja, Nunjucks and Liquid. A front-matter alias takes ssqch's key's
  place in the cascade (a page's `computed` is above its folder's `eleventyComputed`), and a
  schema with `unknown: "error"` reads it as that key. Setting an alias and ssqch's name
  together, in one file, is an error. `ssqch docs --from <generator>` marks the ones that work.
- A `slugify` filter in every template language: `{{ "Pine Cone Crunch!" | slugify }}` is
  `pine-cone-crunch`. In Liquid it replaces Jekyll's, which turned an apostrophe into a dash.
- The other words from other generators get ssqch's name for them: a command (`ssqch check`),
  flag (`--drafts`), config option (`baseURL`, `config.addPassthroughCopy()`), filter
  (`absolute_url`, `jsonify`) or front-matter key (`eleventyNavigation`, `published: false`)
  is refused or warned about as before, now with ssqch's name for it and where to read more
  (`More: ssqch docs base`), and a `hint` in the JSON report. Every unknown config option is reported in one run. A folder with
  another generator's config and none of ssqch's gets a warning (`other-generator`) naming
  `ssqch import` (for Eleventy and Zola) and `ssqch docs --from <generator>`.
  Front-matter keys are warnings (`foreign-key`); they used to be ignored without a word. So are
  templates that read `eleventy.*` or Jekyll's `site.posts` (`foreign-global`), which print
  nothing or an empty list.
- Liquid's unknown-filter error names the filter (``unknown filter `upcse` (did you mean
  `upcase`?)``) instead of listing every filter there is.
- `image()` and `minify()` say which option or image format was probably meant
  (``unknown option "removeComment" (did you mean "removeComments"?)``).
- `console.warn` in a config or data file is one of the JSON report's `warnings` (code
  `console`) in `ssqch build --format json`.
- `--verbose`'s `Uninhabited` line covers Jinja, Nunjucks and EJS includes as well as Edge's,
  and says `templates` instead of `Edge templates`.
- Jinja and Nunjucks errors say which name was probably meant: a template that isn't there
  (`include`, `extends`, `import`) suggests a file in the includes folders (``can't include
  `partials/navv.jinja` (did you mean `partials/nav.jinja`?)``), and an unknown filter, test
  or function suggests one that exists, the config's own included. The name is quoted, so the
  lines under the error get carets under it.

### Fixed

- A page bundle copied a template in a language the site doesn't render as it was, front
  matter and all, so a draft beside a page was published (see Breaking).
- A file name that isn't ASCII (`森林步道.md`) crashed the build while looking for a date in it.
- EJS: a variable used only after `...` (`[...animals]`) wasn't defined; EJS tags in
  `permalink` and `computed` strings weren't rendered (`permalink: /<%= title %>/`); and a
  relative include (`./card.ejs`) in a theme's page or in a layout looked in the input folder
  instead of beside the file.
- `sassPlugin`: editing a partial beside a Sass file outside the input folder, or in a
  `loadPaths` folder, didn't rebuild the CSS while serving.
- `ssqch new --set draft=true` from a TOML blueprint with a table (`[extra]`) put the key in
  the table, so the page wasn't a draft. Keys go above the first table now, a key of the same
  name in a table stays the table's, and a value over several lines is replaced whole.
- `ssqch inspect /myindex.html` could show the page at `/my/`: `index.html` only ends a URL
  when it's a whole part of it, and the exact URL wins.
- `ssqch diff` called pages the same when whitespace that shows had changed: in an attribute's
  value (`title="pine  cone"`), or a blank line or indent in `<pre>`, `<textarea>`, `<script>`
  or `<style>`.
- A template error's message gives the file's own line (`posts/pine.md:8:`), as the lines
  printed under it and the JSON report's `line` already did. Template engines count from the
  end of the front matter, so it used to say `posts/pine.md:3:` for the same line.
- `ssqch.d.ts` declares `process` (`env`, `cwd()`, `platform`), so a config that reads
  `process.env` type-checks without `@types/node` (and still does with it). The docs starter's
  `docs.js` type-checks too.
- `ssqch serve` could leave a page unstyled after a CSS change until it was reloaded by hand.
  Swapping a stylesheet dropped the old one before the new one loaded, so a request that got
  an empty or half-written file (PostCSS empties the file before it writes it) left the page
  without CSS. Now the old stylesheet stays until the new one has loaded with rules, and one
  that doesn't load or is empty is tried again. The server also waits for a stylesheet or
  script another tool is writing to stop changing before telling browsers, and no longer
  misses one written while a build was running.
- `--quiet` quiets `ssqch init` (it listed the files and said camp is set up) and `ssqch serve`
  (it said `Squatch Watch is on.` and `Fresh tracks in ...` for every change): `serve --quiet`
  prints the address once, and then only warnings and errors.
- The error overlay in `ssqch serve` has a "Copy diagnostic" button (it says "Copied"), and
  Escape hides it like "Hide" does. It takes the keyboard focus when it opens, so Tab reaches
  its buttons, and gives it back when it goes.
- The docs starter has a "Skip to content" link, the first thing Tab reaches on each page, in
  every engine.

### Changed

- `ssqch serve` says where first: `Serving dist at http://localhost:8080/. Squatch Watch is
  on.` A script that waits for the line can match `Serving ` again, as it could before 0.4 (the
  ready file, `--ready-file`, is still the way to wait).
- A build's report has one themed line at most, the one that matters most: nothing to build, a
  first build (`First confirmed siting.`), files removed (`left no trace`), drafts
  (`unconfirmed`), then unused templates (`Uninhabited:`). The others say it plainly
  (`Drafts  3 left out`, `Unused: 2 templates ...`).
- The migration guides are trailheads, in `docs/trailheads/` ("Trailhead: moving from
  Eleventy"), and `ssqch docs --from <generator>` prints them. `ssqch import` points at
  `ssqch docs --from` instead of a file in the repository. The README's getting-started
  section is "Field guide: build your first site", and `ssqch capabilities` says "What's in
  the pack".
- The starters and examples have forest creatures in them: Owl's field guide, Beaver's build
  notes and Deer's shortcut in the docs starter, Raccoon's cache in the site starter's second
  post, and Owl, Beaver, Raccoon and Squirrel in the examples.
- While serving, the first build that works after one that failed says so: `Build recovered.
  Back on the trail. Built in ...`. It's the build's one themed line.
- `ssqch new` says which blueprint it used, or `the built-in blueprint` when the folder has
  none, and ends with `Field notes started.` (left out with `--quiet`). A page that's already
  there is refused as before: `src/posts/cedar.md already exists. Those tracks are taken;
  choose another file name (the file is left as it is)`.
- `ssqch docs` with words that find nothing suggests a next step when one of them leads
  somewhere: a generator's trailhead (`Try ssqch docs --from eleventy`), or a word that's a
  name or another generator's word (`Try ssqch docs base`). The JSON has it as `tryInstead`.
- `ssqch diff` ends a report that found differences with `Changes found: 3 pages and 1 other
  file (2 changed, 1 added, 1 removed); ... The stump has moved.`, to go with `The stump has
  not moved.`
- The site starter has two more field notes: *Raiders of the Lost Path* (the link checker, an
  old map and a renamed heading) and *The Cache of the Wild* (a data file that fetches with
  `cache`, and `--offline`).
- The examples are in the Ranger Station '76 palette, light and dark, like the starters.
- The `versioned-docs` and `islands` examples are written in Jinja. `component-docs` stays in
  Edge for its components with slots, and sets `markdownEngine: "edge"`.

## 0.4.0 - 2026-11-10

### Breaking

- Markdown turns on GitHub's extensions by default: heading `id`s, `{#id}` heading attributes,
  footnotes, task lists, bare URLs as links, `> [!NOTE]` alerts, and `:::` containers. Most
  sites only gain `id`s on their headings. A site that adds heading `id`s itself (in a transform,
  say) should drop that code or set `markdown: { headingIds: false }`, and one that writes `:::`
  or `[^1]` as plain text can turn `containers` or `footnotes` off the same way.
- `.html` and `.md` layouts run through `htmlEngine` and `markdownEngine` first, as pages do:
  a `.html` layout is now an Edge template by default. A site with `.html` layouts that hold
  literal `{{ }}` can set `htmlEngine: false` or rename them.
- A page without a `date` takes the date at the start of its file name (`2024-06-01-post.md`)
  before the file's modification time.
- A permalink ending in `/index.html` (`/about/index.html`) gives the page the URL `/about/`.
  It still writes the same file.
- A permalink or `computed` string with `{{ }}` (or `{% %}`) renders in the page's own template
  language instead of always in Edge: a `.liquid` page's permalink is Liquid, and a Markdown page's
  uses `markdownEngine`. Pages in Edge, and Markdown with the default `markdownEngine`, are
  unchanged. A Liquid, Nunjucks or Handlebars page whose permalink uses Edge syntax needs it
  rewritten in its own language.

- The `url()` filter that `rssPlugin()` added is gone. It returned its argument, so use the
  path itself (`absoluteUrl(post.url, site.url)`), or `withBase()` with the new `base` setting.
- The text `ssqch` prints has changed in places (below, "The Sasquatch voice"). A script that
  reads it should use `ssqch build --format json` or `ssqch serve --ready-file`, which haven't.
  What it would have matched: `Serving dist at ...` now starts with `Squatch Watch is on.`,
  `Changed: <file>` is `Fresh tracks in <file>`, `<n> broken links:` is `the trail goes cold on
  <n> broken links:`, and a site's first build prints `First confirmed siting.` before `Built
  in`.
- Rust API: `Config::clean` is `Config::leave_no_trace`, and `BuildReport` has new fields
  (`drafts`, `first_build`, `pages_changed`, `pages_new`, `pages_gone`, `unused`), so build one
  with `..Default::default()`. Config files don't have to change: `clean` still works there.
- Errors are red only on a terminal now. A script that matched the colour codes around
  `error:` in piped output should match the plain word.

### Added

- **The Sasquatch voice.** ssqch reports like a deadpan park ranger: what happened comes first,
  and now and then something large walks through the log. The rules are in `CLAUDE.md`: a
  themed line still names the file and what went wrong, JSON output and diagnostic codes stay
  plain, nothing is random, and a build never adds anything of its own to a site's output.
  - `leaveNoTrace: true` is the new name for `clean` (`leave_no_trace` in `sitesquatch.toml`):
    it removes only what earlier builds wrote, and leaves other tools' files alone. `clean`
    stays as another name for it; setting both is an error.
  - `ssqch serve` is Squatch Watch, and says `Fresh tracks in <file>` when a source changes.
  - A layout that leads back to itself names the loop instead of `layout chain is too deep`:
    `in index.md: we've passed this tree before. Layout loop: base.edge -> wrap.edge ->
    base.edge`. So do Edge includes and components (`Include loop: a -> b -> a`), which used
    to print `included from` 64 times.
  - A layout that isn't there says which one you probably meant: ``layout `bse` not found: no
    sightings in src/_includes (did you mean `base`?)``.
  - `ssqch serve` answers a URL that isn't there, in a site with no `404.html`, with a page of
    its own: where the trail went cold, the closest URL in the site, and a way back to the
    trailhead. It's never written to the output.
  - A port that's taken: `can't listen on port 8080: something else is squatting on it (--port
    0 picks a free one)`.
  - A production build counts the drafts it left out (`Drafts  3 unconfirmed (built in
    development only)`, and `drafts` in the JSON report), and a build with no pages says why
    (`Nothing sighted: no file in src matches templateFormats (edge, md).`).
  - The starter site is an amateur investigator's field notes: three short posts that each
    show one thing, a 404 page, and a footer that says `Built with SiteSquatch. Allegedly.`
    The docs starter's 404 page has several eyewitness accounts too.
  - `ssqch serve` reloads a browser only when the page it's showing came out different (a
    rebuild leaves identical pages alone, and the summary says how many changed), and swaps a
    changed stylesheet in place, so the page keeps its scroll position and its forms.
  - A build that fails while serving is shown in the browser, over the page, with the error
    and the lines it's about, and in the tab's title and icon. It only went to the terminal
    before, while the browser kept showing the old page. The next good build clears it.
  - The dev server gives a site without a `favicon.ico` a footprint for its tab, where there
    was a 404 on every page load. Each page links it as an SVG icon, since browsers only take an
    ICO or PNG from `/favicon.ico`.
  - "Did you mean" for a broken link (`/about/ -> /contactt/ (not found; did you mean
    /contact/?)`) and a missing `id`, a config key (`"templateFormat" isn't a config option
    (did you mean "templateFormats"?)`, and `output` at the top level says it goes in `dirs`),
    a plugin or Markdown option, and an Edge include that isn't there.
  - A template or schema error is followed by the lines it's about, numbered as the file is
    (a template engine counts from the end of the front matter), with carets under what the
    message names or under the schema field.
  - The `Pages` row says what's different from the last build to that folder: `(2 new, 1
    gone)`. The JSON report has them as `pages.new` and `pages.gone`.
  - `--verbose` names the Edge templates in the includes folder that nothing used in the
    build: `Uninhabited: 1 Edge template that nothing used in this build (...)`.
  - `ssqch completions <shell>` prints a completion script for bash, zsh, fish, PowerShell or
    elvish.
  - Colour codes are left out of errors when standard error isn't a terminal, or `NO_COLOR` is
    set (`FORCE_COLOR` keeps them).
  - The starters and the dev server's own pages use the Ranger Station '76 palette: soft
    white (or a green charcoal in dark mode) with neutral text, pine headings and navigation,
    burnt orange links and selection markers, avocado for selected navigation and code,
    harvest gold callout borders, a narrow four-color stripe under the header, and focus rings
    to match. The docs
    starter has a light and dark switch (it follows the system until the reader picks one),
    and its code highlighting matches. The dev server's 404 page shows the footprint as a trail
    patch (broad gold and avocado stripes in a pine ring), and a site without an icon gets a
    map-paper footprint on a pine circle in the tab (burnt orange while the build is broken).
  - `ssqch serve` prints the site's address after each build's report, not before the first
    one, so a long build doesn't push it out of sight.
  - Smaller things: `--offline` builds are `living off the cache`, `ssqch diff` with nothing
    to report adds that the stump has not moved, a panic inside the build says that something
    large walked through it and where to report the bug, and the dev server's responses are
    powered by pine cones.

- `base: "/repo/"` (or `ssqch build --base /repo/`) for a site served below the root of its
  domain, like a GitHub Pages project site. Templates and `page.url` stay as they are; ssqch
  puts the base in front of every URL from the site's root in the HTML it writes (attributes,
  `srcset`, meta refreshes, `url()` in styles), in redirect pages and in Sass output. The link
  checker and the sitemap know about it, `ssqch serve` serves the site under it, and
  `withBase(path)` and `ssqch.base` cover scripts, JSON and feeds.
- `ssqch import eleventy` does the mechanical part of moving an Eleventy site: it renames
  `*.11tydata.*` files, rewrites front matter keys and image attributes, drafts
  `ssqch.config.js` from the Eleventy config, and lists what's left to port with file and line.
  `ssqch import zola` does the same for a Zola site: `tags` out of `[taxonomies]`, `path` to
  `permalink`, a config drafted from `config.toml`, and a list for the Tera templates,
  shortcodes and sections. Both are dry runs unless `--write` is given.
- Themes: `theme: "themes/trail"` puts the site on top of a folder of includes, data, pages
  and files, and the site's own file wins at each path, in every template language. A theme
  can be a git repository pinned to a commit or tag (`"https://github.com/you/theme#v1.2.0"`),
  fetched once with `git` into `.cache/ssqch/themes/`: no package manager. Rust:
  `Config::add_theme`.
- `ssqch/elements`: `elementsPlugin()` loads a custom element's script (and stylesheet) only on
  the pages that have its tag. `like-button.js` in `src/elements/` is `<like-button>`, the tag's
  content is its fallback, and `ssqch:load="idle"` or `"visible"` delays the script until the
  browser is idle or the element is in view. The `islands` example uses it.
- `ssqch init --starter docs` creates a documentation site: a sidebar, breadcrumbs and
  previous/next links from `nav.yml`, a table of contents per page, notes, tabs, highlighted
  code, a front matter schema, the link checker, and optional Pagefind search. It reads without
  JavaScript, in light and dark.
- Nunjucks: a config filter is a tag too. `{% image "/a.png", "Alt" %}` prints what the
  function returns, and `{% callout "tip" %}...{% endcallout %}` passes it the content first
  (`{% markdown %}...{% endmarkdown %}` works the same way).
- Jinja and Nunjucks: `dateformat`, `timeformat` and `datetimeformat` filters (named formats or
  a `strftime` pattern), `now()`, `strftime()` and `isoformat()` on dates, and `pluralize`,
  `filesizeformat`, `striptags`, `cycler()` and `joiner()`.
- Highlighting for `edge`, `liquid`, `hbs`/`handlebars` and `mustache` fences: the template
  tags (keywords, filters, strings, comments) over highlighted HTML.
- More render hooks: `_includes/hooks/footnote-ref.*` and `footnotes.*` write footnote
  references and the notes in a site's own markup, and `hooks/redirect.*` writes the redirect
  pages of `ssqch/redirects`.
- `image(src, { name: "/assets/sponsors/acme" })` names an image's files and folder
  (`/assets/sponsors/acme-200.webp`) instead of using a hash of the source. A named file is
  encoded again when its source is newer.
- `smartPunctuation` leaves a `--` in front of a word alone, so command-line flags in running
  text (`--fix`) aren't turned into dashes.
- `ssqch serve` reads the configuration again when `ssqch.config.js` (or `sitesquatch.toml`)
  changes, or a module the config or a data file imports, so there's no need to restart it. A
  config that doesn't load is reported, and the last good one keeps serving. `--port 0` picks
  a free port. Rust: `cli::try_run_with` (a `configure` that can fail), `serve::serve_reloading`
  and `Config::add_config_file`.
- `fetch(url, { cache: "1h" })` saves a successful response in `.cache/ssqch/fetch/` and reuses
  it until it's that old, so rebuilds (and `ssqch serve`) don't ask the API every time. When a
  refresh fails and an older copy is there, the build uses it and warns. `"force-cache"`,
  `"reload"` and `"only-if-cached"` work, `ssqch build --offline` (or `SSQCH_OFFLINE=1`) answers
  only from saved copies, and the build summary has a `Fetch` line.
- Content schemas: `schemas: { posts: { fields: { title: "string", date: "date", status:
  "'draft' | 'published'", hero: { src: "file", alt: "string" } } } }` checks the data of every
  page tagged `posts` (or matching `files` globs) on each build, and reports every problem with
  its file and field. Types are short strings (`string?`, `string[]`, unions and literals,
  `file` for a path that has to exist), nested objects, or functions; `unknown: "error"` catches
  misspelled front matter keys. `ssqch types` adds the schemas to `ssqch.d.ts`, so
  `pages.byTag("posts")` is typed. Rust: `Config::add_schema`.
- `ssqch new` creates a page from an archetype: a file in `_archetypes/` (in the input folder
  or a theme) named after the folder its pages go in, such as `_archetypes/posts.md`, then
  `default`. Only front matter is filled in (`title`, `date` when the archetype has the key,
  and `--set key=value`); the body is copied as it is. `ssqch new posts --title "Pine cones"`
  names the file as the folder's other pages are named (a date in front, or a folder with an
  index file). Both `ssqch init` starters come with an archetype. A folder named
  `_archetypes` at the top of the input folder is no longer rendered as pages.
- For scripts and coding agents: `ssqch build --format json` prints one JSON report on standard
  output, with what the build wrote and its warnings and errors as data: each has a `code`, the
  `message`, the `file` and `line` when they're known (the line of the file, front matter
  included), the `field` for a schema problem and the `url` for a broken link. Progress lines,
  `console.log` and the output of `beforeBuild` commands go to standard error.
  `ssqch capabilities` (`--format json`) says what the binary supports: commands, optional
  features, template languages, config options, built-in modules and their exports, Node
  modules and globals. `ssqch serve --ready-file <file>` writes the URL, port and output folder
  once the first build is done. Rust: `sitesquatch::diagnostics` (`warn`, `Diagnostic`,
  `Diagnostics`) for plugins, and `serve::serve_reloading` takes a `ServeOptions`.
- `ssqch inspect <url or file>` shows where a page comes from: its template, layouts, date and
  collections, and for each value in its data, which level of the data cascade set it and
  which levels it replaced. `--field level` shows one value in full with every level that set
  it (`--field hero.alt` reaches inside), and `--format json` is for scripts. The site is read
  as a build reads it, up to rendering: `beforeBuild` hooks run, but no page is rendered or
  written. The README's "Where a value comes from" now gives the cascade's exact order.
- `pagination: { data: collections }` goes over the collections' names, for a page per tag
  without a custom collection. It used to fail with "pagination data `collections` is
  undefined".
- `ssqch diff <before> <after>` compares two builds: URLs added and removed, and for each
  changed page whether its text or markup changed, a changed title, and `id`s that are gone.
  Asset fingerprints, `integrity` hashes, the generator's version and whitespace between tags
  are ignored (`--exact` compares bytes), `--ignore <regex>` drops a site's own noise, and
  `--format json` is for scripts. Exits with 1 when the builds differ. Rust: `sitesquatch::diff`.
- npm packages: `import` and `require` find packages in `node_modules` the way Node does
  (`exports` with `import`, `require`, `node` and `default` conditions, `imports`, `main`,
  folders above the site, pnpm's symlinks). luxon, date-fns, lodash, markdown-it, highlight.js,
  prismjs, nunjucks, sanitize-html, html-minifier-terser and a dozen more were checked.
- CommonJS: `.cjs` files, `.js` files in packages without `"type": "module"`, and the site's own
  `.js` files that don't use `import` or `export` run with `require`, `module.exports`,
  `__dirname` and `__filename`. `_data/*.cjs` and `*.data.cjs` are data files.
  `createRequire` from `node:module`.
- `fetch()`, with `Headers`, `Request`, `Response`, `AbortController` and
  `AbortSignal.timeout()`. Requests run in parallel (up to 8 at once). A `fetch` cargo feature,
  on by default, about 2.3 MB.
- Timers (`setTimeout`, `setInterval`, `setImmediate`, `node:timers/promises`), which wait for
  real while a promise is waiting, as in Node.
- `URL` and `URLSearchParams` (WHATWG, from the `url` crate), `TextEncoder`, `TextDecoder`,
  `EventTarget`, and the Node built-ins `module`, `util`, `events`, `os`, `assert`, `timers`
  and `string_decoder`. `http`, `https`, `stream`, `child_process` and other server modules load
  (so packages that require them at the top work) but throw when used.
- A `markdown` config key (`[markdown]` in `sitesquatch.toml`): `headingIds` (`"github"`, the
  default, `"blackfriday"` to match Hugo's older anchors, or `false`), `headingAttributes`,
  `footnotes`, `taskLists`, `autolinks`, `alerts`, `containers`, `definitionLists`,
  `smartPunctuation` and `highlight`.
- Build-time syntax highlighting: `markdown: { highlight: true }` highlights fenced code with
  about 200 Sublime Text and TextMate grammars, as `hl-keyword`, `hl-string` and similar classes,
  and writes a stylesheet with GitHub's light and dark colors to `/highlight.css`. `{1,4-6}` in a
  fence's info string marks lines. It adds about 1.7 MB to the binary; build without the
  `highlight` feature of `sitesquatch` to leave it out.
- Render hooks: templates in `_includes/hooks/` (`heading`, `link`, `image`, `fence`, or
  `fence-<lang>` for one language), in any engine, decide how those parts of Markdown render.
  A fence hook gets the whole info string (`js {1,3} title="app.js"`), not just the language.
- Containers: `::: name args` blocks render through `_includes/containers/name.*` with the
  block's rendered Markdown as `container.content`, or as `<div class="name">` without a
  template. Alerts use a container template with their name when there is one.
- `page.headings` (`level`, `id` and `text`), for layouts and collections, and a `toc` filter that
  turns it into nested links: `{{{ toc(page.headings, { from: 2, to: 3 }) }}}`.
- A `markdown` filter (`{{{ markdown(summary) }}}`, or `markdown(title, "inline")` without the
  `<p>`), and `markdown(text, { inline })` from `ssqch` for config and data files.
- `ssqch/sitemap`: `sitemapPlugin({ url })` writes `sitemap.xml` from the pages the build wrote,
  leaving out `sitemap: false` pages, 404 pages, pages 2 and on of a split list, and `exclude`
  globs. On the blog it matches the hand-written `sitemap.edge` URL for URL.
- `ssqch/redirects`: `aliases` front matter and a `redirects` option, as redirect pages (meta
  refresh, canonical link, `noindex`), Netlify `_redirects` lines (`netlify: true`, added after the
  site's own `_redirects` template), or both.
- `assetsPlugin({ integrity: true })` adds `integrity="sha384-..."` to the `<link>` and `<script>`
  elements that load a fingerprinted file.
- TOML front matter between `+++` lines, and JSON or TOML after `---json` or `---toml`. `.md` sites
  also render `.markdown` files.
- `ignore` (globs of files that aren't pages), `draft: true` (built in development only),
  `bundles: true` (a folder's `index` page gets its other files copied next to it), and globs in
  `passthrough` (`{ "assets/**/*.png": "images" }`).
- `page.excerpt` (the HTML before `<!-- more -->`, or else the first paragraph) and a
  `readingTime(content)` filter.
- `strict: true`: printing an undefined value is an error, in Edge, Liquid, Nunjucks, Jinja,
  Handlebars and Mustache. Conditionals and defaults on missing values still work.
- Rust: `Config::add_generator` adds files made from the list of written pages (the sitemap and
  redirects plugins use it); the build writes them, records them for `clean`, and reports
  collisions with pages.
- `markdown.headingIds` also takes `"ascii"` (Unicode transliterated: `🦀` is `crab`, as Zola's
  anchors are) or a function of the heading's text, for a site's own slugs.
- `markdown: { indentedCode: false }`: lines indented four spaces are Markdown, not code.
- `dirs.layouts`: layouts in their own folder (`_includes/layouts`), so `layout: post` finds
  `_includes/layouts/post.njk`.
- `readData(path)` from `ssqch` reads a JSON, YAML or TOML file in config and data code.
- `Intl.Collator` and `String.prototype.localeCompare`, with `sensitivity`, `numeric` and
  `ignorePunctuation`, matching Node's order for English text.
- Nunjucks templates can use object literals (`{ title: x }`), properties that start with a
  digit (`site.404_page`), `===` and `!==`, macros with defaults before other parameters, string
  methods in JavaScript's or Python's spelling (`title.startsWith("A")`), and JavaScript `Date`
  methods (`page.date.toISOString()`). Jinja templates get the Python string methods.
- `ssqch build --verbose` lists every broken link instead of the first 20.
- `ssqch/sass`: `sassPlugin({ files: { "src/scss": "/css" } })` compiles Sass with grass (pure
  Rust), at the start of each build so fingerprinting and the link checker see the CSS. About
  2.7 MB; the `sass` feature of `ssqch` (on by default).
- Navigation helpers for templates: `navTree(nav, page.url)` marks the current page and its
  sections in a tree from data, `navPager` gives previous and next, `navBreadcrumbs` the trail,
  and `pagesTree(collection)` builds a tree from `nav` front matter.
- `lastModified: "git"` (or `"file"`) sets `page.lastModified` from the last commit that changed
  each page's file, with one `git log` per build. The sitemap uses it for `<lastmod>`.
- `beforeBuild` and `afterBuild` can run programs: `{ run: "npx -y pagefind --site dist" }`
  (and `before_build`/`after_build` lists in `sitesquatch.toml`). The README's Search section
  uses it for Pagefind.
- A `highlight(code, lang)` filter, and `container.source` (a container's lines as written) for
  container templates. `:::tip[Title]` gives the arguments `Title`.
- Rust: `Config::add_file_builder` for files built from their own sources at the start of a
  build, and `Config::run_before_build`/`run_after_build`.
- Examples in `examples/sites/` (`blog-tags`, `blog-categories`, `docs-sidebar`,
  `glossary-docs`, `versioned-docs`, `component-docs`, `reference-pages` and `islands`), each
  built in CI with the link checker, and guides in `docs/guides/` for moving from Zola,
  Eleventy, Docusaurus, MkDocs, Hexo and component frameworks (Astro, VitePress, Next.js,
  Gatsby).

### Faster

- `navTree`, `navPager` and `navBreadcrumbs` index a tree once instead of walking all of it
  for every page. A 9,000-page site with a 9,000-entry sidebar went from 5.2 s to 1.5 s.
- The link checker looks each target up on disk once, not once per link (1.6 s to 0.5 s for
  1.4 million links).
- Liquid: a config filter no longer tries to parse every string it's given as a date, which
  compiled a regular expression each time. The same site in Liquid went from over 7 minutes
  to 12 s, and any Liquid site that calls config filters gains.

### Fixed

- A version tag on a commit whose CI failed no longer publishes a GitHub release with no
  binaries, marked Latest (which broke the install scripts' `latest` links, as 0.3.4 did for
  a while). The CI check now runs after the builds, where its failure stops the release.
- `AbortSignal.timeout(Infinity)` (or any huge number) no longer stops the build with a panic.
- A TOML date written without quotes (`date = 2024-01-02`, in `+++` front matter or a `.toml`
  data file) is read as a date. It failed with "can't parse date".
- In Edge, `{{ image(src) }}` calls the `image` filter on a page whose data has an `image`
  field. The field shadowed the filter, and the call failed with "is not a function".
- `computed.date` is the page's date (in collections, feeds and `page.date`).
- Redirect pages keep the old URL's `#fragment`, `aliases` without a leading `/` are from the
  site's root, and an alias like `/releases/1.85.0` is a folder, not a file.
- Page bundles don't copy ignored files or templates.
- A `link` render hook gets `mailto:` in `link.href` for `<user@example.com>`.

- Pages paginated over a collection (`pagination: { data: collections.categoryPages }`) see each
  item's `content` and `page.excerpt`. They rendered before any page's content existed.
- A page that includes or imports a template that reads `collections` (a macro in
  `_includes/macros.njk`, say) renders after the collections are complete, as a page that reads
  them itself does. Only the page's own body counted before.

## 0.3.4 - 2026-11-10

- **Security:** `ssqch serve` could be asked for any file on the machine: `/%2Fetc/hosts`
  decoded to a path that replaced the output folder. Request paths are decoded first and have
  to stay inside the output folder now. The server only listens on localhost, but a web page
  open in the same browser could have made the request.
- `ssqch serve` no longer rebuilds in a loop when the input folder is the project root (the
  default `dirs`). Each build rewrote `.cache/ssqch/output-files.json`, which is inside the
  watched folder, and that counted as a change. Changes under `.cache`, `.git` and
  `node_modules` are ignored, the list is only written when it changes, and a source written
  again with the same contents (by a `beforeBuild` hook, say) isn't a change either.
- `ssqch serve` on Linux no longer counts reading a file as a change to it. In a site whose
  input folder is the project root, files that were read all the time (by the server, an
  editor or an indexer) could hold a rebuild back for as long as the reads went on. A burst of
  changes is also waited on for a second at most.
- Liquid: `{% include "nav.html" %}` with the name in quotes finds the file. Only the unquoted
  form (`{% include nav.html %}`) did.
- Liquid: a config filter no longer tries to parse every string it's given as a date, which
  compiled a regular expression each time. Sites that call config filters from Liquid build
  much faster.
- A date written without quotes in a `.toml` data file (`updated = 2024-01-02`) is its text
  (`2024-01-02`) in templates, not an object.

## 0.3.3 - 2026-11-09

- A mistake in `ssqch.config.js` names the file once (`ssqch.config.js: dirs.ouput isn't
  supported`), not twice, and `ssqch.config.mjs` errors name that file.
- `ssqch --help` describes `--quiet` (only warnings and errors) and `--verbose` (also list the
  slowest images to encode) correctly.
- README: the tutorial's code blocks no longer start with a filename comment, which put text
  before the front matter and broke the build when copied as they were. The Liquid example
  imports `defineConfig`, and the Netlify example pins a current release.

## 0.3.2 - 2026-11-09

- Fix unstyled pages when running `ssqch serve` after a production build without the CSS and JS
  watchers. A production build renames `index.css` to `index.<hash>.css`, and development
  pages linked the plain name, which no longer existed. `ssqch/assets` now links to the
  fingerprinted copy in that case, with a warning that names it.

## 0.3.1 - 2026-11-09

- `ssqch init --engine liquid` (or `njk`, `hbs`) starts the site with a layout and home page in
  that template language, and a config that lists it in `templateFormats` and uses it for
  Markdown. The default is still Edge.
- Homebrew: releases publish a formula to `reverentgeek/homebrew-tap`, so
  `brew install reverentgeek/tap/ssqch` works on macOS and Linux.
- GitHub Actions: `reverentgeek/setup-ssqch` installs a prebuilt ssqch on Linux, macOS and
  Windows runners.

## 0.3.0 - 2026-11-09

### Breaking

- The `templateEngineOverride` front-matter key is now `render`. Rename it in your templates
  (`render: md`). A build that finds the old key stops with an error that says so. `render` also
  takes a list (`render: [edge, md]`) and `false`, which writes the body without processing it.

### Added

- The macOS binaries are signed with a Developer ID and notarized by Apple, so a binary
  downloaded with a browser runs without a Gatekeeper warning.
- `clean: true` in the config (or `clean = true` in `sitesquatch.toml`) deletes stale files from
  the output: pages and passthrough files an earlier build wrote that this one didn't, like a
  deleted post, and the folders they leave empty. Each build lists what it wrote in
  `.cache/ssqch/output-files.json`, so files other tools write into the output are never touched.
  Off by default.
- `cargo binstall ssqch` installs the release binary instead of compiling (with
  [cargo-binstall](https://github.com/cargo-bins/cargo-binstall)).
- Template engines in the config: `engines: { ext: (source, data) => html }` (or an object with a
  `render` method, sync or async). Add the extension to `templateFormats` to render those files,
  use it for layouts, or name it in `markdownEngine`.
- Liquid templates: add `"liquid"` to `templateFormats` to render `.liquid` pages and layouts, or
  use `markdownEngine: "liquid"`. Config filters work as Liquid filters, `include` and `render`
  read from `_includes`, and Jekyll's filters and `include` parameters are there too. Liquid adds
  about 2 MB to the binary; Rust builds can leave it out with `--no-default-features`.
- Nunjucks and Jinja templates (`.njk`, `.jinja`, `.j2`) with minijinja: config filters work as
  filters and functions, `include`, `extends`, `import` and `from` read from `_includes`, output is
  HTML-escaped (a layout's `content` is safe), and errors name the line. In `.njk` files,
  Nunjucks' `elseif` and `for key, value in object` work too.
- Handlebars and Mustache templates (`.hbs`, `.handlebars`, `.mustache`): config filters are
  helpers, every file in `_includes` is a partial, and Mustache sections, inverted sections and
  `{{.}}` work. Data is converted to JSON per page, so dates are ISO strings.

### Changed

- Markdown escapes `"` in text and inline code as `&quot;`, like the CommonMark reference
  renderer. Raw HTML in Markdown is left as written.
- The minifier shortens attributes (`shortenAttributes`, on by default): boolean attributes lose
  their values (`defer="defer"` becomes `defer`), and whitespace that doesn't matter comes out of
  `class`, `srcset`, `sizes`, URL attributes and the viewport `<meta>`. On the blog, quote
  escaping adds about 10 KB of HTML and the attribute changes save about 4 KB.

## 0.2.7 - 2026-11-09

### Added

- `ssqch init [dir]` creates a starter site: `ssqch.config.js`, a layout, a home page, a post
  with directory data, a data file, editor types and a `.gitignore`. It never overwrites an
  existing file.
- `ssqch types` writes `ssqch.d.ts`, type definitions for `ssqch.config.js` and the `ssqch/*`
  modules, so editors autocomplete and check configs (with `checkJs` in `jsconfig.json`).
- Rust: `sitesquatch::cli::run_with` lets a binary add its own subcommands
  (`ExtraCommand`), and `sitesquatch::cli::clap` re-exports the clap it uses.

## 0.2.6 - 2026-11-08

### Fixed

- Windows: relative paths handed to templates and JavaScript (`page.inputPath`, a transform's
  `inputPath`, the hook event's `dirs`, the build log) use `/`, so `byGlob()` matches. Paths
  are canonicalized without the `\\?\` prefix, so `image()` finds its files, and
  `import.meta.url`, `pathToFileURL` and `fileURLToPath` handle `file:///C:/...` URLs.

### Added

- The crates are on crates.io: `cargo install ssqch --locked --features avif`.
- Prebuilt binaries for macOS (Apple Silicon and Intel) and Windows (x86_64), alongside Linux,
  with a PowerShell installer for Windows. Each one runs a smoke test on its own platform
  before a release is published.
- CI runs the tests on Windows too.

## 0.2.5 - 2026-11-08

### Added

- Links to local images (`<a href="/photos/big.jpg">`, the click-to-enlarge pattern) point at a
  generated copy: the image's own format (JPEG, PNG), at its own width capped at the largest of
  `widths`. Before, they pointed at the source file, which isn't published, so they were broken.
  Copies are cached and named like the rest; a copy the `<picture>` already uses is reused. Turn
  it off with `linkedImages: false`, or per link with `ssqch:ignore` on the `<a>`.

## 0.2.4 - 2026-11-08

### Added

- A link checker: `linksPlugin(options)` from `ssqch/links`. After each build, every internal
  `href`, `src` and `srcset` URL in the HTML has to point at something in the output, and a
  `#fragment` at an `id` on that page. External links, and paths a Netlify `_redirects` file
  covers, aren't checked. Broken links fail production builds and are warnings in `ssqch serve`.
  Options: `anchors`, `ignore` and `fail`.
- `node:crypto` in configs and data files: `createHash` (`md5`, `sha1`, `sha256`, `sha384`,
  `sha512`) with Node's `update()` and `digest()`, and `getHashes()`.

### Fixed

- `ssqch serve` reloads the browser when another tool (a PostCSS or esbuild watcher) writes a
  CSS or JavaScript file into the output folder. Before, a CSS edit could reload the page before
  the new CSS was written, leaving the old styles until the next change.

## 0.2.3 - 2026-11-08

### Fixed

- `ssqch --version` and `--help` name the binary (`ssqch 0.2.2`), not the library crate
  (`sitesquatch 0.2.2`). A site's own Rust binary shows its own name.

### Added

- Asset fingerprinting: `assetsPlugin({ files })` from `ssqch/assets`. Templates link plain
  paths like `/assets/index.css`; production builds rename each listed file in the output to
  `index.<hash>.css` (8 hex characters of a content hash), delete older fingerprinted copies,
  and rewrite every `href` and `src` that points at it. `ssqch serve` keeps the plain paths.
  `assetUrl(path)` returns the URL to use elsewhere.
- Releases run a smoke test before publishing: the Linux binary has to be static, report its
  version, and build a small site with AVIF and WebP images.

## 0.2.2 - 2026-11-08

### Fixed

- Images with a color profile other than sRGB (Display P3 from iPhones and Macs, Adobe RGB,
  Generic RGB, display profiles) are converted to sRGB before encoding, instead of having the
  profile dropped. Their colors no longer look washed out. Against macOS ColorSync's conversion,
  the result is within about one level (0-255) on average. Images without a profile, or with an
  sRGB one, are unchanged, and only converted images get new file names, so an upgrade
  re-encodes just those. The build summary counts them ("converted to sRGB").
- Profiles that can't be converted, such as the HDR (PQ, gain map) profiles of newer iPhone
  photos, no longer stop the image from being processed: it's encoded as before, with a warning
  that suggests converting the source to sRGB.

## 0.2.1 - 2026-11-08

### Changed

- The static Linux build (`x86_64-unknown-linux-musl`) uses mimalloc instead of musl's
  allocator, which was slow under a build's many threads. A warm build of the ReverentGeek blog
  on a GitHub runner went from 0.73 s to 0.30 s, the same as a glibc build; a cold build (every
  image encoded) went from 301 s to 283 s. Peak memory during a cold build is higher: about
  700 MB, up from 368 MB.

## 0.2.0 - 2026-11-08

The first release.

### Breaking

Eleventy compatibility is gone. Sites configured like Eleventy need these changes:

- **The config.** `ssqch.config.js` exports `defineConfig({ ... })` from `ssqch`: an object, or a
  function that gets `{ env, serving }` and returns one. Instead of calling `config.addFilter()`,
  `addCollection()` and the rest, set `filters`, `data`, `collections`, `transforms`,
  `passthrough`, `watch`, `beforeBuild`, `afterBuild` and `plugins`. Directories are `dirs`
  (not a returned `dir`); `markdownTemplateEngine` and `htmlTemplateEngine` are `markdownEngine`
  and `htmlEngine`; `setDataDeepMerge()` is `deepMerge`. Shortcodes are filters.
- **Plugins** are pieces of config (or functions that return one) in `plugins`, not functions
  that receive the config. Two plugins defining the same filter, data or collection name is an
  error.
- **Collections** get `pages.all()`, `byTag()`, `byTags()` and `byGlob()` instead of `getAll()`,
  `getFilteredByTag()` and so on. **Transforms** are `(content, page) => content`, with `url`,
  `inputPath` and `outputPath` on `page` instead of `this`.
- **Hooks** are `beforeBuild` and `afterBuild` (were `eleventy.before` and `eleventy.after`), and
  get `{ env, serving, dirs }`, plus `written` (a list of paths) after the build.
- **Built-in modules** are `ssqch/image`, `ssqch/rss` and `ssqch/minify`. The Eleventy package
  names (`@11ty/eleventy-img`, `@11ty/eleventy-plugin-rss`, `eleventy-plugin-edgejs`,
  `eleventy-plugin-broken-links`, `html-minifier-terser`) no longer resolve.
  - `imagePlugin(options)` replaces `eleventyImageTransformPlugin`, and `image(src, { widths,
    formats })` replaces `Image()`. Encoder settings (`webpQuality`, `avifQuality`, `avifSpeed`,
    ...) go on `imagePlugin()`; sharp options (`sharpWebpOptions`, `effort`, `transform`) and
    `image()`'s `outputDir` and `urlPath` are errors.
  - `rssPlugin()` adds the feed filters; `convertHtmlToAbsoluteUrls` is `htmlToAbsoluteUrls`.
  - `minifyPlugin(options)` minifies HTML output. `minify(html, options)` takes
    `collapseWhitespace`, `removeComments` and `shortDoctype`, all on by default.
- **Templates and data:** the template global is `ssqch` (was `eleventy`); front matter uses
  `computed` (was `eleventyComputed`) and `excludeFromCollections` (was
  `eleventyExcludeFromCollections`); template and directory data files are `*.data.js` and
  `*.data.json` (were `*.11tydata.*`); image attributes are `ssqch:widths` and `ssqch:ignore`
  (were `eleventy:widths` and `eleventy:ignore`).
- **Environment:** `ELEVENTY_ENV` is no longer read. Use `--env`, `SSQCH_ENV` or `NODE_ENV`.
- **Rust API:** `Config::markdown_template_engine` and `html_template_engine` are `markdown_engine`
  and `html_engine` (also the `sitesquatch.toml` keys); `CollectionApi::get_all`,
  `get_filtered_by_tag` and `get_filtered_by_tags` are `all`, `by_tag` and `by_tags`;
  `add_shortcode` is gone (use `add_filter`).

### Added

- A summary after every build: pages written, files copied, images encoded and reused, the
  output folder's size, and how long each phase took. Plugins add lines with
  `Config::add_summary`.
- CI: tests with and without AVIF on Linux and macOS, and clippy.
