---
title: "Trailhead: moving from VitePress"
navTitle: "From VitePress"
description: "VitePress builds each Markdown page into a Vue component; SiteSquatch reads the same Markdown and writes HTML."
---
VitePress builds each Markdown page into a Vue component and ships a client app that hydrates it. SiteSquatch reads the same Markdown and writes HTML, so a move keeps your pages as they are and turns the theme into templates. What takes the work is Vue in your pages: the components they use, and the parts that run in the browser. The vuejs.org docs (111 pages, 33 component names) moved with no Markdown page edited, 99.9% of their article text the same as VitePress's, and the generator step at 0.54 s against VitePress's 5.7 s.

## Scouting

`ssqch scout` (see [Scouting a site](../trailheads.md#scouting-a-site)) reads `.vitepress/config.ts` (`srcDir`, `srcExclude`, `cleanUrls`, the sitemap's `hostname`, `head`, the markdown-it plugins it `use`s) and lists what your pages use, each with its file and line: Vue's `<script setup>` blocks, containers and the closing `:::`s Prettier indents, `-vue` fences, `[[toc]]`, every component by name with the `.vue` file it comes from and whether it has state, the front matter the theme reads (`layout`, `hero`, `outline`, `aside`, `page: true`), data loaders named like ssqch's data, and dynamic routes. `--write-draft` writes a first `ssqch.config.js`, and `ssqch baseline "pnpm run build" --from .vitepress/dist` builds the reference to compare with. Run scout again as you go: what the config or a template does counts as done.

```js
// ssqch.config.js, as scout drafts it for vuejs.org
import { sitemapPlugin } from "ssqch/sitemap";
import { vuePlugin } from "ssqch/vue";

export default {
	dirs: { input: "src", output: "dist" },
	templateFormats: ["md"],
	markdownEngine: false,
	urls: "html",
	ignore: ["api/api.data.ts", "error-reference/errors.data.ts", "examples/examples.data.ts", "tutorial/tutorial.data.ts", "tutorial/**/description.md", ".vitepress/**", "public/**"],
	passthrough: { "src/public/**": "." },
	markdown: { dialect: "vitepress", highlight: true },
	plugins: [
		vuePlugin({ components: { VueSchoolLink: ".vitepress/theme/components/VueSchoolLink.vue", ScrimbaLink: ".vitepress/theme/components/ScrimbaLink.vue" }, hydrate: "visible" }),
		sitemapPlugin({ url: "https://vuejs.org" }),
	],
};
```

- **`templateFormats: ["md"]` and `markdownEngine: false`:** VitePress's pages are its Markdown, and Vue's `{{ }}` in them isn't a template language's.
- **`urls: "html"`:** with `cleanUrls` off (VitePress's default) a page is `/guide/intro.html`. With `cleanUrls: true`, leave it out: ssqch's URLs are folders (`/guide/intro/`).
- **`ignore`:** VitePress's data loaders are `*.data.ts`, and `api/api.data.ts` is the name ssqch gives a folder's data. Listed by their paths, they aren't read as data, and the `.data.js` files the move adds (a dynamic route's pagination) still are; `vuePlugin()` runs the loaders for the components and pages that import their `data`.
- **`vuePlugin()`:** the Vue components the pages use, rendered with your Vite and Vue (`npm install -D vite @vitejs/plugin-vue vue`, which a VitePress site has already), with the ones the theme registers for every page in `components`, and `hydrate: "visible"` when one has state.
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
| A `.vue` component a page imports, or the theme registers | `vuePlugin()` from `ssqch/vue` renders it with your Vite and Vue at build time, loaders and `useData()` included; `hydrate: "visible"` runs it in the browser as an island (the vuejs.org demos work this way). Scout drafts it, with the theme's `app.component()`s. |
| A component with state, without Vue | Its HTML from a template, and what it does from a custom element in `ssqch/elements` |
| `themeConfig.nav` and `sidebar` | Data: move them to `_data/themeConfig.js` and import that file in `.vitepress/config.ts`, so both read one list. `navTree` marks the page you're on; a sidebar keyed by path is the longest key the page's URL starts with. In Jinja, read `link.get("items")`: `link.items` is the dict's method where there's no key. |
| The default theme's `Layout`, a theme's slots | A layout in `_includes/`. The theme's markup is in your build's HTML; `toc()`, `navTree` and `navPager` make the outline, the sidebar and the pager. |
| `page: true`, `layout: home` | `page` is ssqch's own (it's warned about): give those pages a layout of their own (`layout: home.jinja`) |
| `[param].md` with `[param].paths.ts` | `pagination` over the same list, `size: 1`, a `permalink` with the item's value, and `addAllPagesToCollections: true`, in `[param].data.js` beside the page |
| `head` in the config | The layout's `<head>` |
| `sitemap: { hostname }` | `sitemapPlugin({ url })`, with the same URLs. The file is ssqch's own (a tag a line, pages by URL, with `<lastmod>`; `lastmod: false` leaves it out), so `ssqch diff` lists `sitemap.xml` as changed, and that's expected: no reader of a sitemap needs VitePress's bytes |
| `markdown.config(md)` plugins | A render hook, a container, or `markdown.preprocess` |
| `vitepress-plugin-llms` | `llmsPlugin()` from `ssqch/llms`: `llms.txt`, a Markdown copy of each page and `llms-full.txt` |

## Keeping your VitePress theme

You don't have to rebuild your theme as templates: `vuePlugin()` can render it around each page, so its nav, sidebar, outline and footer are the HTML VitePress writes (the vuejs.org move's theme came out with no differences). It takes a wrapper component and a layout, about 30 lines, and nothing in your pages changes. ssqch has no option for this: a theme's way of placing the page (`<Content />`) and reading `useData()` is VitePress's own.

A wrapper that renders the theme, with the page as its slot. On the server, the theme's `<Content />` is the page ssqch rendered; in the browser (with `hydrate`), it's the HTML the server wrote:

```vue
<!-- src/_includes/vue/SiteLayout.vue -->
<script setup>
import { getCurrentInstance, h, useSlots } from "vue";
import { current } from "vitepress";
import Theme from "../../../.vitepress/theme/index.ts";

// What useData() has for the page: the layout passes it in.
const props = defineProps({ page: { type: String, required: true } });
const given = JSON.parse(decodeURIComponent(props.page));
const headers = [];
for (const heading of given.headings) {
	const header = { level: heading.level, title: heading.text, slug: heading.id, link: `#${heading.id}`, children: [] };
	if (heading.level === 2) headers.push(header);
	else if (heading.level === 3 && headers.length) headers.at(-1).children.push(header);
}
current.page.value = { ...current.page.value, relativePath: given.relativePath, title: given.title, headers, frontmatter: given.frontmatter };
current.frontmatter.value = given.frontmatter;

const slots = useSlots();
const html = typeof document === "undefined" ? undefined : document.querySelector("[data-page]")?.innerHTML;
const app = getCurrentInstance().appContext.app;
app.component("Content", { setup: () => () => (html === undefined ? h("div", { "data-page": "" }, slots.default?.()) : h("div", { "data-page": "", innerHTML: html })) });
Theme.enhanceApp?.({ app });
</script>

<template>
	<component :is="Theme.Layout" />
</template>
```

A layout every page gets (`layout: "vitepress.njk"` in `src/src.data.js`, the input folder's data), which passes the page's data to it as `useData()` reads it, and the page as its slot:

```njk
{# src/_includes/vitepress.njk #}
{%- set vitepress = { relativePath: page.inputPath | replace(r/^.*?src\//, ""), title: title or "", headings: page.headings, frontmatter: { aside: aside, outline: outline, footer: footer, sidebar: sidebar, editLink: editLink } } -%}
<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta charset="utf-8">
	<title>{{ title }}</title>
	<link rel="stylesheet" href="/assets/vue.css">
	{# What `head` in .vitepress/config.ts has. #}
</head>
<body>
	<div id="app"><SiteLayout page="{{ vitepress | dump | urlencode }}">{{ content | safe }}</SiteLayout></div>
</body>
</html>
```

And in `ssqch.config.js`, the wrapper as a component every page can use, with `hydrate` if the theme should run in the browser (dark mode, the sidebar on a phone, search): `vuePlugin({ components: { SiteLayout: "src/_includes/vue/SiteLayout.vue" }, hydrate: "visible" })`. A theme that imports something virtual (`virtual:group-icons.css`) needs the Vite plugin that makes it: `vite: { plugins: [groupIconVitePlugin()] }`.

What it costs, and the choices:

- **`hydrate` is for every component.** With it, the theme runs in the browser too (the vuejs.org move's dark mode, Options/Composition switch and sidebar work), and so does every demo; without it, the pages are HTML only, and the parts that need JavaScript are custom elements from `ssqch/elements`.
- **`page: true`:** ssqch's `page` is its own. Give those pages a layout of their own (`layout: "page.njk"`), or read the value from the file in a `computed` (`vitepressPage: (data) => /^page:\s*true$/m.test(readFileSync(data.page.inputPath, "utf8"))`, in the input folder's data) and pass it to `frontmatter` as `page`.
- **A dynamic route's `relativePath`** is its page's own: `vuePlugin()` gives `useRoute()` the page's URL, and the layout can pass `page.url` the same way.

## Inline Vue in pages

VitePress compiles each page into a Vue component, so a page can have Vue in its HTML: `{{ count }}`, `v-model`, `v-if`. ssqch's pages are HTML, and with `markdownEngine: false` those print as written (scout lists each, with its line). For each, either write the text itself (a version number, a link), or move that part into a `.vue` component of its own, beside the page, and use it there (`<CountDemo />`, imported in the page's `<script setup>`): `vuePlugin()` renders it, and with `hydrate`, runs it. `dialect: "vitepress"` does what Vue's compiler does to the rest of the page's HTML: a self-closing `<sup />` gets its end tag, and `v-pre` and event listeners (`@click`) are left out.

## Known gaps

- **Shiki's colors:** ssqch highlights with its own classes (`highlight: true`), so code is colored by its stylesheet, not inline. A site with one Shiki theme (VitePress's `markdown.theme: "github-dark"`) has no `vp-adaptive-theme` on its code blocks: a fence hook of your own (`_includes/hooks/fence.*`, starting from the dialect's markup) writes them without it.
- **`llms.txt`:** `llmsPlugin()` writes llmstxt.org's format, not vitepress-plugin-llms' word for word. For the same bytes, a page with `permalink: /llms.txt` that lists `collections.all` writes your own.
- **What only runs in VitePress's app:** a REPL, `<Teleport>`, and components that read the router at run time need their own JavaScript in the browser: a custom element, or Vue loaded for that part.
- **Speed in the dev server:** VitePress compiles the one module the browser asks for (a few milliseconds); ssqch builds the site again (about half a second for vuejs.org, the Vue components kept from the last build when only pages changed).

## Checking the move

`ssqch diff .cache/ssqch/baseline/ref-1 dist` leaves out Vue's scoped-style attributes (`data-v-*`), its server renderer's `<!--[-->` markers and Vite's fingerprints (`style.Bfpn8qS8.css`). Expect two differences on every page: VitePress's client app in `<head>` (its scripts and preloads), and Shiki's inline colors where ssqch writes classes. The text should match. A Vite build's asset names and Vue's scope ids depend on the folder it ran in, so the reference builds' are their own; the comparison takes that into account.
