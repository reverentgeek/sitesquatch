---
title: "Trailhead: moving from Hugo"
navTitle: "From Hugo"
description: "Hugo and SiteSquatch both build pages from Markdown with front matter, a data folder, layouts and static files."
---
Hugo and SiteSquatch both build pages from Markdown with front matter, a data folder, layouts and static files. Hugo's content usually moves as it is: the gohugo.io docs (1,007 content files) moved with none of them changed, and 764 of 787 pages came out byte for byte the same. The templates are the work: Hugo's are Go templates, which ssqch doesn't run, and Jinja (ssqch's default) is the closest, since Go's `define` and `block` map onto Jinja's `extends` and `block`, and both trim whitespace with `{{- -}}`.

## Scouting

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) lists what your site uses, each with its file and line: every shortcode with how many pages call it, the sections (`_index.md`) and `cascade`, the render hooks and ssqch's hook for each, the Go templates, and the Hugo Pipes and functions they call (`js.Build`, `css.TailwindCSS`, `.GetPage`, `.Related`). Its draft (`--write-draft`) is an `ssqch.config.js` that reads the content as Hugo does, and a container template to port for each of the site's own shortcodes:

```js
export default defineConfig({
  dirs: { input: "content", output: "public", includes: "../_includes", data: "../data" },
  // Hugo doesn't run template code in content, and its shortcodes on a line of their own are containers.
  markdownEngine: false,
  markdown: { highlight: { classes: "pygments" } },
  passthrough: [{ static: "." }],
  data: { site: { title: "Trail Notes", url: "https://example.com", params: {} } },
  plugins: [fromHugo(), sitemapPlugin({ url: "https://example.com" }), linksPlugin({ fail: false })],
});
```

`fromHugo()` from `ssqch/from-hugo` reads Hugo's shortcodes as containers, below: a default (`shortcodes: "hugo"`) your own `markdown` can change.

## The config

| Hugo (`hugo.toml`) | SiteSquatch (`ssqch.config.js`) |
| --- | --- |
| `contentDir` (`content/`) | `dirs.input` |
| `layouts/` | `dirs.includes` (and `dirs.layouts`): templates you write in Jinja |
| `data/` | `dirs.data` |
| `static/` | `passthrough: [{ static: "." }]` |
| `publishDir` | `dirs.output` (`publishDir` works, and says ssqch's name) |
| `baseURL` | the site's address goes in data and in `sitemapPlugin({ url })`; `base` is the path only, for a site served under one (`/repo/`) |
| `title`, `params` | global data: `data: { site: { title, params } }`, read as `site.title` |
| `menus` | global data (`_data/nav.yml`), and `navTree` |
| `taxonomies` | tags are collections; a page per tag is a page paginated over `collections` |
| `outputs` (RSS, `_redirects`) | a page per output file, with its `permalink` (`/index.xml`) and `layout: false`; `rssPlugin()` for feeds |
| `markup.goldmark.parser.autoHeadingIDType` | `markdown.headingIds`: `"github"` (Hugo's default) or `"blackfriday"` |
| `markup.goldmark.extensions.typographer` | `markdown.smartPunctuation` (it writes characters, where Goldmark writes entities) |
| `markup.highlight` | `markdown.highlight`, with `classes: "pygments"` for Chroma's class names; inline styles (`noClasses`, Hugo's default) aren't in ssqch, so make a stylesheet (`hugo gen chromastyles`) |
| `minify` / `--minify` | `minifyPlugin()` from `ssqch/minify` (its own bytes, not Hugo's) |
| `cascade` | directory data (`posts/posts.json`), which every page below it gets |
| `aliases` | `redirectsPlugin()`: front matter `aliases` works as it is |

## Content

- **Template code in your Markdown:** Hugo's docs and many tutorials have `{{ .Title }}` in code samples. ssqch runs Markdown through a template engine first unless `markdownEngine: false`, so set that before the first build.
- **Shortcodes:** with `fromHugo()`, a shortcode on a line of its own is a container ([Markdown](../markdown.md), "Containers"): `{{< note type="tip" >}}` to `{{< /note >}}` (or `{{% %}}`) renders `_includes/containers/note.*`, with `container.args` (what the call wrote), `container.props` (its `key="value"` parameters) `container.content` (the inside, rendered as Markdown) and `container.source` (the inside as written, for a `{{< >}}` shortcode, whose inside Hugo doesn't read as Markdown). One without a closing tag (`{{< youtube abc >}}`) has no content. Port each shortcode's Go template into its container template. A shortcode inside a line of text (`{{< new-in 0.148 />}}`, `[About]({{< ref "about" >}})`) renders through the same container template in its place, with `container.inline` true, so a template that's called both ways can check it: `{% if container.inline %}<span>...</span>{% else %}<div>...</div>{% endif %}`.
- **URLs:** Hugo lowercases paths and reads `slug` and `url`. In ssqch, `permalink` in front matter or directory data sets a page's URL; `computed` can make one from the path for every page.
- **Sections:** an `_index.md` is a section's list page. In ssqch it's a page like any other: give it a layout in its folder's directory data, and list its folder's pages with a collection: a tag, or one in the config (`collections: { functions: (api) => api.byGlob("content/functions/**") }`).
- **Page bundles:** a folder with `index.md` and its images is a bundle in both; set `bundles: true`.
- **Headless pages** (`build.render: never`, snippets included elsewhere): `permalink: false`, or `ignore` them.
- **Summaries:** Hugo's `.Summary` is about the first 70 words, in whole paragraphs; ssqch's `page.excerpt` is what's before `<!-- more -->`, or else the first paragraph.

## Templates: Go templates in Jinja

| Go template | Jinja |
| --- | --- |
| `{{ .Title }}`, `{{ .Params.x }}` | `{{ title }}`, `{{ params.x }}` (the page's data is the context) |
| `{{ site.Title }}`, `{{ .Site.Params.x }}` | `{{ site.title }}`, `{{ site.params.x }}` (global data) |
| `{{ with .Description }}{{ . }}{{ end }}` | `{% if description %}{{ description }}{% endif %}` |
| `{{ range .Pages }}...{{ end }}` | `{% for p in collections.x %}...{% endfor %}` |
| `{{ range $i, $p := ... }}` | `loop.index0` |
| `{{ partial "x.html" . }}` | `{% include "partials/x.jinja" %}` (it shares the context) |
| `{{ partial "x.html" (dict "a" 1) }}` | a macro: `{% from "partials/x.jinja" import x %}{{ x(a=1) }}` |
| a partial that `return`s a value | a filter in `ssqch.config.js` |
| `{{ define "main" }}` in `baseof.html` | `{% extends "baseof.jinja" %}{% block main %}...{% endblock %}` |
| `{{ block "x" . }}default{{ end }}` | `{% block x %}default{% endblock %}` |
| `{{- ... -}}` | `{%- ... -%}` and `{{- ... -}}` (the same trimming) |
| `{{/* comment */}}` | `{# comment #}` |
| `{{ .Content }}` | `{{ content }}` in a layout |
| `{{ .TableOfContents }}` | `{{ toc(page.headings) | safe }}` |
| `{{ .Date.Format "January 2, 2006" }}` | `{{ page.date | dateformat("%B %-d, %Y") }}` |
| `markdownify`, `.RenderString` | `markdown(text)`, `markdown(text, "inline")` |
| `urlize`, `anchorize` | `slugify` |
| `site.GetPage "/x"` | a filter over `collections.all` |

## Render hooks

| Hugo `layouts/_markup/` | ssqch `_includes/hooks/` |
| --- | --- |
| `render-link.html` (`.Destination`, `.Text`, `.Title`) | `link.*` (`link.href`, `link.content`, `link.title`) |
| `render-image.html` | `image.*` (`image.src`, `alt`, `title`) |
| `render-heading.html` | `heading.*` |
| `render-codeblock.html` (`.Type`, `.Inner`, `.Attributes`) | `fence.*` (`fence.lang`, `fence.code`, `fence.info`), or `fence-<lang>.*` for one language |
| `render-blockquote.html` for alerts | GitHub's `> [!NOTE]` alerts are built in (`alerts`), styled by `containers/note.*` |
| `render-table.html`, `render-passthrough.html` | not in ssqch yet |

## Hugo Pipes

| Hugo | SiteSquatch |
| --- | --- |
| `css.TailwindCSS` | Tailwind's CLI as a `beforeBuild` step |
| `js.Build` | esbuild as a `beforeBuild` step, or `ssqch/assets` |
| `css.Sass`, `toCSS` | `sassPlugin()` from `ssqch/sass` |
| `fingerprint` | `assetsPlugin()` from `ssqch/assets` |
| `minify` | `minifyPlugin()` |
| `resources.Get` | `passthrough` |
| `.Resize`, `.Fill` | `imagePlugin()` from `ssqch/image` makes responsive `<picture>`s; `image()` for one file |

## Build it both ways

`ssqch baseline "hugo --gc --minify" --from public` builds the site with Hugo, in fresh copies with the clock pinned; it copies `node_modules` into each copy, since Hugo's `js.Build` refuses one linked from outside. Then `TZ=UTC ssqch build`, and `ssqch scout --compare` (or `ssqch diff .cache/ssqch/baseline/ref-common public`) lists the biggest groups of differences first. `ssqch docs "moving a site with an agent"` has the whole loop.
