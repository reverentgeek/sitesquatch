---
title: "Templates and data"
description: "The lay of the land."
---
The lay of the land:

- **The data cascade:** a page's data comes from several places, and each one replaces what the ones before it set: global data, the front matter of its layouts, directory data, the page's data file, its front matter, then `computed`. [Where a value comes from](where-values-come-from.md) has the exact order, and `ssqch trace` shows it for any page.
- **Collections:** tags become collections, sorted by date, plus your custom ones. `excludeFromCollections: true` keeps a page out. A page for each tag: the blog starter (`ssqch init`) has a `tagList` collection in its config (each tag with its posts, newest first) and `src/tag.jinja`, which paginates over it with `size: 1` and `permalink: /tags/{{ tag.name | slugify }}/`, and `src/tags.jinja` lists them all ([Tags and tag pages](#tags-and-tag-pages) has the whole example).

- **Pagination:** one template makes a page for each item, or each group of items, in a list. In its front matter, `pagination: { data: "collections.posts", size: 10, alias: "posts" }` and a `permalink` with the page number (`/blog/{% if pagination.pageNumber > 0 %}{{ pagination.pageNumber + 1 }}/{% endif %}`). `data` names the list: global data (`snacks`), a collection (`collections.posts`, a custom collection included, even one that returns plain objects, so one template can write a page per route of a route table), or `collections` itself, the collections' names, for a page per tag (`filter: [all]` leaves `all` out). `size: 1` gives a page per item, and `alias` names the item (`alias: post`, then `{{ post.data.title }}`). Each page gets `pagination.items` (its items), `pageNumber` (from 0), `pages` (every page's items), `hrefs` (every page's URL), `href.previous`, `href.next`, `href.first` and `href.last`. More options: `reverse`, `filter` (values to leave out) and `addAllPagesToCollections` (every page in the template's collections, not just the first). A `computed` value in a data file beside the template sees the alias, so each page's data can come from its item.
- **Permalinks:** dynamic permalinks, `permalink: false` and `dynamicPermalink`. A permalink (or `computed` value) with `{{ }}` renders in the page's own template language, so a Liquid page can write `permalink: "/{{ title | slugify }}/"`; Markdown and HTML pages use their `markdownEngine` or `htmlEngine` (Edge when that's `false`). A permalink or `computed` string is data, not HTML, so nothing in it is escaped as it's worked out: `title: "Tagged {{ tag.name }}"` with a tag `Rock & Roll` is `Tagged Rock & Roll`, and the layout that prints `{{ title }}` escapes it, once.
- **Front matter:** YAML between `---` lines, TOML between `+++` lines, or JSON after `---json` (`---yaml` and `---toml` work too). `.markdown` files are Markdown, like `.md`.
- **Navigation:** `navTree(nav, page.url)` takes a tree from data (`_data/nav.yml`: entries with `title`, `url`, and children under `children`, `items` or `pages`) and marks each entry `current`, `ancestor` or `open`, for a sidebar that highlights where you are. `navPager(nav, page.url)` returns `{ previous, next }` in reading order (a collection works as the tree too: `navPager(collections.posts, page.url).next` is the next post, which is Eleventy's `collections.posts | getNextCollectionItem(page)`, and that and `getPreviousCollectionItem` work as they are), and `navBreadcrumbs(nav, page.url)` the entries from the top down to the page. To build the tree from front matter instead, give pages `nav: { title, parent, order }` (or `nav: true`) and use `pagesTree(collections.docs)`: an entry's key is its `nav.key`, or else its title; `parent` names another entry's key, and a `parent` no page has becomes a heading (an entry with that title and no `url`) holding its children. The title is `nav.title`, the page's `title`, or `nav.key`; `nav.url` replaces the page's URL (a link elsewhere), and any other `nav` key (`excerpt`) is copied onto the entry. `pagesTree(collections.all, { root: "Feature" })` (`{{ collections.all | pagesTree: root: "Feature" }}` in Liquid) is the tree below the key `Feature`, page or heading, which is eleventy-navigation's `eleventyNavigation: "Feature"`; an unknown option is an error. URLs match with or without `index.html` and the last `/`.
- **Components:** a PascalCase tag in a page or a layout, `<VueSchoolLink href="https://vueschool.io/lessons/x" title="Free lesson">Watch it</VueSchoolLink>` or `<Badge type="tip" text="new" />`, renders `_includes/components/VueSchoolLink.*` in its place, a template in any engine, as VitePress, Astro and MDX pages use components. It gets the page's data and `component`: `component.name`, `component.props` (each attribute: `href="x"` is `"x"`, a bare `disabled` is `true`, a `kebab-case` name is there in camelCase too, and Vue's bindings are read against the page's data: `:text="title"` is the page's title, `:count="3"` is 3, `:items="['a', 'b']"` a list; anything more is the expression as written), `component.content` (what's between its tags, as HTML, with the components inside it rendered: print it with `| safe`) and `component.attrs` (the plain attributes as written, ` class="x" href="y"`, to put on the element the template writes). Vue's directives and events (`v-if`, `@click`, `#title`) are left out of both. The page's components render with its body, so its layouts and `templateContent` get the HTML, and a layout's own (`<SiteFooter />`) after the layouts. What's inside `<pre>`, `<code>`, `<script>`, `<style>`, `<textarea>` and comments isn't read, so a code sample's `<Badge />` stays text; HTML's names are lower case and SVG's camelCase ones start lower case, so only PascalCase tags are components, and a custom element (`<trail-map>`) has a hyphen. A PascalCase tag with no template is a warning that names the pages it's on (browsers would drop the tag and show what's inside it), and is left as written. A component with state (a counter, a REPL) needs JavaScript in the browser: a custom element from `ssqch/elements` for that part, or, for Vue's own `.vue` components, `vuePlugin()` from `ssqch/vue`, which renders the tags `_includes/components/` has no template for, and with `hydrate` runs them in the browser too.
- **Dates:** a page's `date` comes from its data, then from the start of its file name (`2024-06-01-post.md`), then from when the file last changed. `computed.date` works too. A date is `2026-11-22`, or with a time, `2026-11-22T09:30:00Z` (YAML's own dates, and text a JavaScript `Date` reads, work too); one that isn't (`date: last Tuesday`) fails the build with a `front-matter` error at its line, listed with the page's schema errors. Collections are oldest first; undated pages come after the dated ones, in path order, so a fresh checkout or an edit (which changes file times) doesn't reorder them.

- **`SOURCE_DATE_EPOCH`:** set it (whole seconds since 1970, the reproducible-builds convention: `SOURCE_DATE_EPOCH=1767225600 ssqch build`) to pin the build's time, as Jekyll's `time:` does. `now()` in every engine, Liquid's `"now"`, Edge's `new Date()`, the date of every page without one and a `page.lastModified` that comes from a file's time become that time, so two builds of the same files write the same pages. A value that isn't a number is an error before the build starts. A site's own JavaScript (`Date.now()` in a filter) isn't changed.
- **Drafts:** `draft: true` builds the page in development (`ssqch serve`, or `--env development`) and leaves it out of production builds, collections included.
- **Excerpts and reading time:** `page.excerpt` is the HTML before a `<!-- more -->` comment, or else the first paragraph, for layouts and collections (`post.page.excerpt` in a list of posts). `readingTime(content)` is the minutes it takes to read some HTML at 200 words a minute (`readingTime(content, 250)` for another pace), at least 1.
- **Slugs:** `slugify("Pine Cone Crunch!")` is `pine-cone-crunch`: lowercase letters and digits, with a dash for each run of anything else (apostrophes are dropped, and letters outside ASCII are kept). It's the same function in every template language (`{{ title | slugify }}` in Jinja, Nunjucks and Liquid), and a config filter named `slugify` replaces it. `slugify(title, { separator: "_" })` (or `slugify(title, "_")`, `{{ title | slugify: "_" }}` in Liquid) puts another separator between the words, for URLs like `/recipes/taco_bake/`. Apostrophes are dropped (`Drew's Brownies` is `drews-brownies`); `apostrophes: "separate"` splits words there instead (`drew-s-brownies`), for a site whose URLs were made that way. `ascii: true` takes accents off and spells out a few letters and symbols first, as the slugify package (Eleventy's `slugify`) does (`Thomas Sjögren` is `thomas-sjogren`, `Straße & 50%` is `strasse-and-50-percent`; other scripts stay as they are), and `stripTags: true` drops HTML tags first (`Use <code>title</code>` is `use-title`). Another option is an error. Before replacing a site's own slug filter with `slugify`, build with both and compare with `ssqch diff`: one changed URL is a broken link. Data files can import it, and `slugger()`, from `ssqch`.
- **Choosing engines:** pages are Jinja (`.jinja`) unless you list other languages in `templateFormats`, and `.md` files run through Jinja first, then Markdown (change that with `markdownEngine` and `htmlEngine`). Layouts follow the same rules, so a `.html` layout is a Jinja template by default. A template's `render` front matter overrides it: `render: md` for Markdown only (handy for a post full of `{{ }}` code samples), `render: [edge, md]` for a chain, or `render: false` to write the body as it is. A layout chain can mix languages (a Markdown post in a Liquid layout that sits in an Edge one). Around here that's called trail mix.
- **Text files with front matter** (Jekyll renders any file that starts with `---`, like a `.js` or `.txt` file): give the extension an engine that hands the text back, `engines: { js: (s) => s }`, add it to `templateFormats`, and in that folder's directory data (`assets/js/js.json`), or in each file's front matter, set `"render": "liquid,js"` (Liquid first, or the engine you use) and `"permalink": "{{ page.filePathStem }}.js"` (`filePathStem` starts with its own `/`), so the file keeps its name instead of becoming `app/index.html`. `ssqch scout` drafts all three for a Jekyll site. The config and the modules it imports are never pages, so `lib/filters.js` stays code. A `.scss` file with front matter needs nothing: `sassPlugin()` blanks it.
- **Everything else:** layout chaining, `page.*`, `templateContent` in collections, and an error when two pages would write the same file. Every template can read `ssqch.version`, `ssqch.env`, `ssqch.serving` and `ssqch.generator`.

Templates are [Jinja](template-languages.md#jinja-and-nunjucks) by default; [Edge](template-languages.md#edge), [Liquid](template-languages.md#liquid), [Nunjucks](template-languages.md#jinja-and-nunjucks), [Handlebars and Mustache](template-languages.md#handlebars-and-mustache) and [EJS](template-languages.md#ejs) are a `templateFormats` entry away, and one site can use several.

When a template fails, the error names the file and line (counted as the file is, front matter included) and is followed by the lines it's about, with carets under the part the message names when it quotes one:

```text
error: 1 error(s):
  - rendering posts/pine.md with `jinja`: posts/pine.md:8: unknown filter `rnd` (did you mean `round`?)

  --> src/posts/pine.md:8
   6 | Crunchy, foresty, and only slightly sticky.
   7 |
   8 | The count is {{ sightings.total | rnd(1) }} so far.
     |                                   ^^^
```

A Jinja filter, test or function that doesn't exist says which one you probably meant, and so does a layout, a Jinja or Nunjucks template (`include`, `extends`, `import`) or an Edge include that isn't there (``layout `bse` not found: no sightings in src/_includes (did you mean `base`?)``). One that leads back to itself names the loop instead of running out of patience: `we've passed this tree before. Layout loop: base.edge -> wrap.edge -> base.edge`.

## Tags and tag pages

A post's `tags` (`tags: [sightings, trails]` in its front matter, or in a directory data file such as `src/posts/posts.json`, which gives every post the `posts` tag) put it in a collection for each tag: `collections.sightings` is every page tagged `sightings`, oldest first. The blog starter (`ssqch init`) builds a page for each tag and one that lists them all from three pieces, ready to copy.

**The list of tags,** a collection in `ssqch.config.js`: each tag on a post, with its posts newest first, sorted by name. `posts` is left out, since every post has it.

```js
collections: {
  tagList: (pages) => {
    const tags = new Map();
    for (const post of [...pages.byTag("posts")].reverse()) {
      for (const name of post.data.tags) if (name !== "posts") tags.set(name, [...(tags.get(name) ?? []), post]);
    }
    return [...tags.keys()].sort().map((name) => ({ name, posts: tags.get(name) }));
  },
},
```

**A page for each tag,** `src/tag.jinja`: pagination over that list with `size: 1` writes one page per tag, `alias: tag` names the one a page is for, and the permalink and title come from it.

```jinja
---
layout: layout.jinja
pagination:
  data: collections.tagList
  size: 1
  alias: tag
permalink: /tags/{{ tag.name | slugify }}/
computed:
  title: "Tagged {{ tag.name }}"
---
<ul>
  {% for post in tag.posts %}
    <li><a href="{{ post.url }}">{{ post.data.title }}</a></li>
  {% endfor %}
</ul>
```

**Every tag,** `src/tags.jinja`, at `/tags/`:

```jinja
---
layout: layout.jinja
title: Tags
---
<ul>
  {% for tag in collections.tagList %}
    <li><a href="/tags/{{ tag.name | slugify }}/">{{ tag.name }}</a> ({{ tag.posts | length }})</li>
  {% endfor %}
</ul>
```

A post links its own tags the same way. The starter's layout has `ownTags(tags)`, a function in its config that leaves out `posts`: `{% for name in ownTags(tags) %}<a href="/tags/{{ name | slugify }}/">{{ name }}</a>{% endfor %}`. With `slugify` in every URL, a tag with spaces or capitals (`Old Growth`) gets a clean address (`/tags/old-growth/`). Use it in all three places (the permalink, `tags.jinja` and the layout): a link without it fails the production build's link check with `/tags/Old Growth/ (not found; did you mean /tags/old-growth/?)`. Two tags that slugify alike (`Old Growth` and `old-growth`) would write the same page, which fails the build with `output conflicts` and `tag.jinja makes 2 pages that write to .../tags/old-growth/index.html`. The sitemap lists every tag page (`exclude: ["/tags/**"]` leaves them out).

Without a config collection, pagination over `collections` itself makes a page per tag too: `pagination: { data: "collections", size: 1, alias: "tag", filter: ["all", "posts"] }`, then `collections[tag]` for its pages, oldest first. `collections` has the config's own collections in it as well (the starter's `newestPosts` and `tagList`), so add those to `filter`. The `tagList` collection above is what gives newest first and the counts, in one place.
