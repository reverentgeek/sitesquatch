---
title: "Writing a plugin"
description: "A plugin is an object with the config's parts, plus what only a plugin can give: steps in ssqch's Markdown, render hooks as functions, and defaults the site's own config replaces."
---
> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: a plugin's `markdown` and `defaults`. The config's parts in a plugin work in 0.12.0.

A plugin is an object in the config's `plugins`, or a function that returns one. It can have any of the config's parts (`data`, `filters`, `collections`, `transforms`, `engines`, `passthrough`, `watch`, `beforeBuild`, `afterBuild`, `plugins`), which add to the site's own, and three things of its own: a `name` for its errors, `markdown` (steps in ssqch's Markdown and render hooks as functions) and `defaults` (settings the site's config replaces). Settings that change where files go (`dirs`, `base`) are the site's, and a plugin that sets one is an error.

Here's a plugin that turns `[[Page title]]` into a link to the page with that title, and writes `::: aside` blocks as `<aside>`:

```js
// trail-links.js
export function trailLinks({ folder = "/guide/" } = {}) {
  const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    name: "trailLinks",
    markdown: {
      // The page's Markdown, before ssqch's reads it.
      before: (source) => source.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](${folder}${slug(title)}/)`),
      hooks: {
        "containers/aside": (container) => `<aside class="${container.args || "note"}">${container.content}</aside>`,
      },
    },
    defaults: { markdown: { containers: true } },
  };
}
```

```js
// ssqch.config.js
import { defineConfig } from "ssqch";
import { trailLinks } from "./trail-links.js";

export default defineConfig({
  plugins: [trailLinks({ folder: "/trails/" })],
});
```

## Markdown steps

`markdown` has three keys, each optional:

- `before(source, context)`: the page's Markdown before ssqch's reads it, after its template engine ran. Return the Markdown to read.
- `after(html, context)`: the HTML ssqch's Markdown wrote for the page, before its layouts. Return the HTML.
- `hooks`: render hooks and containers as functions that return HTML, by the name the template would have: `heading`, `link`, `image`, `fence`, `code`, `table`, or `containers/<name>` for a `::: name` block. Each gets what the template of that name gets (`heading.level`, `heading.id`, `heading.content`; `container.args`, `container.content`), as [Render hooks](markdown.md) lists them. A site's own template of the same name (`_includes/hooks/heading.*`, `_includes/containers/aside.*`) replaces the plugin's, so a site can change one piece of a plugin's markup.

Steps run on a page's own Markdown (not on the `markdown()` function's text), in the order the plugins are listed, and `before` runs before the site's `markdown.preprocess`. A later plugin's hook of a name replaces an earlier one's. Each answers at once: a step or hook that returns a promise is an error that says so (work out what it needs in `beforeBuild` or a data file first), and one that returns something other than text names the plugin.

`context`, the second argument, has:

| Key | What it is |
| --- | --- |
| `data` | The page's data, as its templates see it |
| `page` | `data.page`: its `url`, `inputPath` and the rest |
| `urls` | The site's `urls`: `"folders"` or `"html"` |
| `markdown(text, { inline })` | Markdown rendered with the site's options and hooks, for a title or a block's inside; `inline: true` leaves out the `<p>` |
| `hasHook(name)` | Whether the site or a plugin has the hook or container `name` |
| `renderHook(name, key, value)` | Calls a hook as ssqch's Markdown does (`renderHook("containers/aside", "container", { args, content })`): the site's template if it has one, else a plugin's |

## Defaults

`defaults: { markdown: { ... } }` gives values for the site's `markdown` options, for each key the site's own `markdown` doesn't set: a plugin for a kind of site can turn on what it needs (`containers`, `headingIds`) and the site can still say otherwise. A plugin's defaults are `markdown` options only, for now.

## Plugins that come with ssqch

The built-in plugins (`ssqch docs "built-in plugins"`) are written this way where they can be. `fromVitepress()` from `ssqch/from-vitepress` is VitePress's Markdown as a plugin: a `before` and an `after` step, eleven hooks and three defaults ([Moving from VitePress](trailheads/from-vitepress.md)). `fromMkdocs()` from `ssqch/from-mkdocs` gives MkDocs' Markdown as defaults, and its theme context with `templates: true` ([Moving from MkDocs](trailheads/from-mkdocs.md)).
