---
title: "Uncharted territory: known gaps"
description: "The uncharted parts of the map, as of this release."
---
<img align="right" src="../../../docs/assets/stickers/direction-sign.svg" alt="" width="96">

The uncharted parts of the map, as of this release:

- **JavaScript:** there are no worker threads: pages render one at a time on one thread (image encoding uses every core), so a site with heavy per-page JavaScript doesn't spread it across cores, and module-level state in your config (a counter in a filter) is one counter. `Intl`, `toLocaleDateString()` and `localeCompare` are Node's, and their results can differ between Node releases (Node 22.18 ships an older ICU than 24 and 26). ssqch's own date filters and sorting never use `Intl`, so only a site's own `Intl` calls can make a build's output depend on the Node version; pin `NODE_VERSION` where that matters.
- **Async functions and Markdown:** a page's own Markdown waits for an async `headingIds` function or highlighter, but Markdown made while a template renders can't: `markdown()` and `highlight()` in a template, `markdown()` from `"ssqch"`, a render hook or a container whose template calls an async function are errors that name the function when it answers with a promise. Make those functions synchronous. A page whose own templates are async can't be rendered on demand either: reading its `templateContent` before it has rendered is an error that names it.
- **Edge:** the async functions inside a callback of `filter`, `find` and the other array methods aren't awaited (an error says to call them first with `@let`).
- **Markdown:** containers have to close inside the block they opened in (the same list item, say). Highlighting parses more slowly than tree-sitter would: the blog's 350 fences add about 60 ms to a build, and a process's first highlight compiles each grammar it uses (about 0.3 s for the blog's first build), unless [the highlighting cache](markdown.md) has the fence, and not again for the rebuilds of `ssqch serve`. A site with `.sublime-syntax` grammars of its own (or an alias to a built-in grammar, `jsx: "js"`) still loads the set of built-in grammars when its config is read, a few dozen milliseconds, though the cache spares it each grammar's patterns.
- **Images:** no SVG rasterizing, and HDR photos (the PQ, gain-map profiles of newer iPhones) can't be converted to sRGB, so they look washed out; the build warns about them, and converting the source to sRGB once fixes it. SVGs are served as they are, and GIFs are copied for `auto` output, so animations keep working.
- **The dev server:** it listens on `127.0.0.1` only (no `--host`), doesn't watch `node_modules`, and rebuilds the whole site on a change, on one thread: after one edit, a 10,000-page site takes about 0.9 s.
- **Collections:** custom collections don't see pages that are paginated over collections. Those pages are added to `all` and their tags afterwards.
- **Platforms:** ssqch needs Node 22.18 or newer, and runs wherever that Node and sharp do: macOS, Windows and Linux, Alpine and ARM included.

Found a bug, or have an idea? [Open an issue](https://github.com/reverentgeek/sitesquatch/issues). Happy building, and may your pages load faster than a Squatch sighting disappears.
