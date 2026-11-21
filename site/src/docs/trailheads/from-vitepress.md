---
title: "Trailhead: moving from VitePress"
navTitle: "From VitePress"
description: "VitePress builds each Markdown page into a Vue component; SiteSquatch reads the same Markdown and writes HTML."
---
> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: scout's VitePress draft, `dialect: "vitepress"`, components, `urls: "html"`, `sitemapPlugin({ format: "vitepress" })` and `ssqch/llms`.

VitePress builds each Markdown page into a Vue component and ships a client app that hydrates it. SiteSquatch reads the same Markdown and writes HTML, so a move keeps your pages as they are and turns the theme into templates. What takes the work is Vue in your pages: the components they use, and the parts that run in the browser. The vuejs.org docs (111 pages, 33 component names) moved with no Markdown page edited, 99.9% of their article text the same as VitePress's, and the generator step at 0.54 s against VitePress's 5.7 s.

## Scouting

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) reads `.vitepress/config.ts` (`srcDir`, `srcExclude`, `cleanUrls`, the sitemap's `hostname`, `head`, the markdown-it plugins it `use`s) and lists what your pages use, each with its file and line: Vue's `<script setup>` blocks, containers and the closing `:::`s Prettier indents, `-vue` fences, `[[toc]]`, every component by name with the `.vue` file it comes from and whether it has state, the front matter the theme reads (`layout`, `hero`, `outline`, `aside`, `page: true`), data loaders named like ssqch's data, and dynamic routes. `--write-draft` writes a first `ssqch.config.js`, and `ssqch baseline "pnpm run build" --from .vitepress/dist` builds the reference to compare with. Run scout again as you go: what the config or a template does counts as done.

```js
// ssqch.config.js, as scout drafts it for vuejs.org
import { sitemapPlugin } from "ssqch/sitemap";

export default {
	dirs: { input: "src", output: "dist" },
	templateFormats: ["md"],
	markdownEngine: false,
	urls: "html",
	ignore: ["**/*.data.ts", "**/*.data.js", "tutorial/**/description.md", ".vitepress/**", "public/**"],
	passthrough: { "src/public/**": "." },
	markdown: { dialect: "vitepress", highlight: true },
	plugins: [sitemapPlugin({ url: "https://vuejs.org", format: "vitepress" })],
};
```

- **`templateFormats: ["md"]` and `markdownEngine: false`:** VitePress's pages are its Markdown, and Vue's `{{ }}` in them isn't a template language's.
- **`urls: "html"`:** with `cleanUrls` off (VitePress's default) a page is `/guide/intro.html`. With `cleanUrls: true`, leave it out: ssqch's URLs are folders (`/guide/intro/`).
- **`ignore`:** VitePress's data loaders are `*.data.ts`, and `api/api.data.ts` is the name ssqch gives a folder's data. Listed, they aren't read; a `_data/*.js` file can import a loader's `load()` if a page needs its data.
- **`passthrough: { "src/public/**": "." }`:** `public/`'s files at the site's root. `{ "src/public": "." }` would copy the folder by its name.
- **`dialect: "vitepress"`:** VitePress's Markdown (below).

## What maps

| VitePress | SiteSquatch |
| --- | --- |
| Pages, front matter, `{#id}` on headings | The same |
| `::: tip`, `info`, `warning`, `danger`, `details`, `raw`, `code-group` | `dialect: "vitepress"` writes VitePress's markup, default titles and all. A template in `_includes/containers/tip.*` replaces one. |
| A closing `:::` indented under a list (Prettier writes them) | `containers: "markdown-it"`, which the dialect turns on |
| Heading anchors, `tabindex`, VitePress's ids | The dialect's heading, with `headingIds: "vitepress"` (`What's Vue?` is `what-s-vue`) |
| Links to `.md` files, external links in a new tab | The dialect's links: `.html` with `urls: "html"`, `./` in front of a relative one, `target="_blank" rel="noreferrer"` on an external one |
| Code blocks, `[title]`, `vue-html`, `-vue` fences | The dialect's wrapper, copy button and label; `highlight: true` for colors, with ssqch's classes rather than Shiki's |
| `[[toc]]` | The same, in any case |
| `<script setup>`, `<style>`, `<ClientOnly>` in a page | Left out by the dialect, as VitePress writes none of it |
| A component in a page (`<VueSchoolLink href="..." />`) | A template in `_includes/components/VueSchoolLink.*`, with `component.props` and `component.content` ([components](../templates.md)) |
| A component with state (a counter, a demo, a REPL) | Its HTML from a template, and what it does from a custom element in `ssqch/elements` (or Vue, loaded in the browser for that part) |
| `themeConfig.nav` and `sidebar` | Data: move them to `_data/themeConfig.js` and import that file in `.vitepress/config.ts`, so both read one list. `navTree` marks the page you're on; a sidebar keyed by path is the longest key the page's URL starts with. In Jinja, read `link.get("items")`: `link.items` is the dict's method where there's no key. |
| The default theme's `Layout`, a theme's slots | A layout in `_includes/`. The theme's markup is in your build's HTML; `toc()`, `navTree` and `navPager` make the outline, the sidebar and the pager. |
| `page: true`, `layout: home` | `page` is ssqch's own (it's warned about): give those pages a layout of their own (`layout: home.jinja`) |
| `[param].md` with `[param].paths.ts` | `pagination` over the same list, `size: 1`, a `permalink` with the item's value, and `addAllPagesToCollections: true`, in `[param].data.js` beside the page |
| `head` in the config | The layout's `<head>` |
| `sitemap: { hostname }` | `sitemapPlugin({ url, format: "vitepress" })`, the same file byte for byte |
| `markdown.config(md)` plugins | A render hook, a container, or `markdown.preprocess` |
| `vitepress-plugin-llms` | `llmsPlugin()` from `ssqch/llms`: `llms.txt`, a Markdown copy of each page and `llms-full.txt` |

## Checking the move

`ssqch diff .cache/ssqch/baseline/ref-1 dist` leaves out Vue's scoped-style attributes (`data-v-*`), its server renderer's `<!--[-->` markers and Vite's fingerprints (`style.Bfpn8qS8.css`). Expect two differences on every page: VitePress's client app in `<head>` (its scripts and preloads), and Shiki's inline colors where ssqch writes classes. The text should match. A Vite build's asset names and Vue's scope ids depend on the folder it ran in, so the reference builds' are their own; the comparison takes that into account.
