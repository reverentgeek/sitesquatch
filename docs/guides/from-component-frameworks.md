# Moving from Astro, VitePress, Next.js or Gatsby

These are component frameworks: a page is a tree of components, rendered on a server or at build time and, for some of them, run again in the browser. ssqch is a template-and-Markdown generator that ships HTML and only the JavaScript you write. So this move isn't a port of the framework. It's a sort of what you have into three piles:

1. **Content** (Markdown, front matter, data files): moves as it is.
2. **Presentational components** (cards, callouts, layouts, navigation): become templates, with no JavaScript in the browser.
3. **Interactive components** (a search box, tabs with state, a live editor): stay JavaScript, as custom elements that load on the pages that use them, or as an app that lives beside the site.

On the sites studied for this guide, most components were in the second pile: about 80% of getbootstrap.com's (Astro) and 37% of vuejs.org's (VitePress). A site whose pages are mostly the third pile (react.dev, with a live editor in most pages) is an app, and should stay one.

The [`component-docs`](../../examples/sites/component-docs/) example is distilled from getbootstrap.com: components in place of MDX, live examples with their source, and values read from Sass files. [`islands`](../../examples/sites/islands/) shows interactive parts as custom elements.

## Is ssqch a fit?

| The site is | Then |
| --- | --- |
| A blog, docs or marketing site with a few interactive widgets | Yes: content and templates in ssqch, widgets as custom elements |
| Docs where every page embeds a live playground | Partly: the prose pages, with the playground as its own bundle that pages load |
| Server-rendered per request (auth, personalization, API routes, ISR) | No: ssqch only builds static files. Keep those routes where they are and move the static section. |
| A framework's own docs (vuejs.org, react.dev) | No: they exist to show the framework |

Moving one section at a time works: build the docs or blog with ssqch into a folder, and let the host serve it under its path (`base: "/docs/"`).

## Content

| Astro, VitePress, Next.js, Gatsby | SiteSquatch |
| --- | --- |
| Markdown with YAML front matter | The same. `title`, `description`, `date`, `tags` are read as they are. |
| Content collections with a Zod schema (`src/content/config.ts`) | `schemas` in the config: `{ posts: { fields: { title: "string", date: "date", tags: "string[]" } } }`, checked on every build, with types from `ssqch types` |
| `getCollection("blog")`, GraphQL page queries, `getStaticProps` | `collections.<tag>` in templates, custom `collections` in the config, and `_data/*.js` files that fetch or read whatever the query did |
| `getStaticPaths`, `[slug].astro`, `createPages` | Pagination over data with a `permalink` per item: one template, one page per entry |
| Remote data at build time | `fetch()` in a data file, with `{ cache: "1h" }` so rebuilds don't refetch |
| File-based routing (`src/pages/about.astro`) | The same idea: `src/about.md` is `/about/`. `permalink` overrides it. |
| `:::tip` containers (VitePress, Starlight) | The same syntax, built in |
| `{#custom-id}` on headings, `[[toc]]` | `{#custom-id}` works; the table of contents is `toc(page.headings)` in the layout |
| Code blocks with Shiki, line highlighting `{1,3}`, titles | `markdown: { highlight: true }`, `{1,3}` in the fence's info string; a `fence` render hook for titles and copy buttons |
| Twoslash, or anything that needs a compiler at build time | A `beforeBuild` command that writes HTML or JSON for templates to include |
| `<Image>` / `gatsby-plugin-image` | `imagePlugin()`: every `<img>`, including Markdown images, becomes a responsive `<picture>` |
| i18n routing | Not yet |

## MDX and components

MDX mixes Markdown with JSX. In ssqch, Markdown runs through a template language first (Jinja by default), so a component call sits in the Markdown the same way. With `markdownEngine: "edge"`, an Edge component reads most like MDX:

```mdx
<Callout type="warning" title="Careful">
  This **cannot** be undone.
</Callout>
```

```md
@component('components/callout', { type: 'warning', title: 'Careful' })
This **cannot** be undone.
@end
```

or, for block content, a container, which keeps the page plain Markdown:

```md
:::warning[Careful]
This **cannot** be undone.
:::
```

| Component | Becomes |
| --- | --- |
| A layout (`<BaseLayout>`, `layout.tsx`, a VitePress theme `Layout.vue`) | A layout in `_includes/`, chosen by `layout` in front matter or directory data |
| A presentational component with props (`<Card title>`) | A Jinja macro (`{% macro card(title) %}`, with `caller()` for its body), an Edge component (`_includes/components/card.edge`, with `$props` and slots), or a Handlebars partial |
| A component that wraps Markdown (`<Aside>`, `<Tabs>`) | A container: `_includes/containers/aside.jinja` gets the rendered body as `container.content` |
| Something that changes how Markdown elements render (`components={{ a, h2, pre }}`) | Render hooks: `_includes/hooks/link.*`, `heading.*`, `fence.*` |
| A component that reads data (`Astro.glob`, a `useData()` composable) | The template reads the same data: `collections`, `_data`, front matter |
| `import` of a JSON or YAML file in a page | A file in `_data/`, available by name |
| Styles scoped to a component | A class and a stylesheet; `sassPlugin()` if you use Sass |
| A React, Vue or Svelte component with state or effects | A custom element (below) |

A codemod is worth writing when one component is used hundreds of times: the JSX call maps to one line of template.

## Interactive parts

Write each one as a custom element, with what a visitor sees before (or without) JavaScript inside the tag:

```html
<like-button count="3"><a href="/likes/">3 likes</a></like-button>
```

`elementsPlugin()` from `ssqch/elements` loads `src/elements/like-button.js` on the pages that have the tag, and on no others, which is what `client:load` did. The other loading directives map too:

| Astro | SiteSquatch |
| --- | --- |
| `client:load` | The default: the script loads with the page |
| `client:idle` | `ssqch:load="idle"` on the tag |
| `client:visible` | `ssqch:load="visible"` |
| `client:only`, a component with no server-rendered HTML | An element with a fallback inside it (a link, a static version, or nothing) |
| `<ClientOnly>` (VitePress), `dynamic(() => ..., { ssr: false })` (Next.js) | The same |

An element's script can import your existing framework code: a Preact, Lit or Vue component mounted inside `connectedCallback` is still an island, bundled by your own esbuild or Vite step into the elements folder (`beforeBuild: { run: "esbuild ..." }`). What goes away is hydrating the whole page.

What doesn't have an equivalent: client-side routing between pages (links are ordinary page loads; the browser's View Transitions cover the animation), state shared across pages in memory (use `localStorage`, as the tabs in `ssqch init --starter docs` do), and server components.

## Per framework

- **Astro:** `.astro` components are the closest to templates: the frontmatter script becomes data (front matter, `_data`, or a filter) and the template below it becomes Jinja or Edge. Starlight sites map onto `ssqch init --starter docs`.
- **VitePress:** `.vitepress/config.js` `themeConfig.sidebar` becomes `_data/nav.yml`; `:::` containers, `{#id}` and line highlighting already match. Vue components in Markdown are the work.
- **Next.js:** only statically exported pages (`output: "export"`) move. `next/link` and `next/image` become `<a>` and `<img>`; `getStaticProps` becomes a data file.
- **Gatsby:** source plugins become data files (`fetch`, or reading files with `node:fs`), page queries become collections, and `gatsby-node.js` `createPages` becomes pagination. remark plugins map to the `markdown` options, render hooks and containers.

## Checking the move

Build both and compare the output:

```sh
ssqch diff dist-old dist --ignore 'data-astro-[\w-]+(="[^"]*")?' --ignore '<!--\[?-->'
```

`ssqch diff` compares tags and text, so framework noise shows up as markup-only differences: scoped-style attributes, hydration markers, inlined state. `--ignore` takes patterns for those. What's left is what a visitor would notice: the text of each page, its headings and ids, and its links.
