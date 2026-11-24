---
title: "Netlify"
description: "Netlify can build the site itself, with no deploy token to manage."
---
Netlify can build the site itself, with no deploy token to manage. With `ssqch` in the site's `devDependencies` (see [Install](install.md)), Netlify installs it with the site's other packages, at the version in the lockfile, and runs it on the Node it has: set `NODE_VERSION` to 22.18 or newer, as below. This is the ReverentGeek blog's `netlify.toml` (it builds its CSS and JavaScript with npm scripts first, so it runs `pnpm run build`; a site without that step can run `npx ssqch build` instead):

```toml
[build]
  command = "pnpm run build && node --test test/smoke.test.js"
  publish = "dist/"

[build.environment]
  NODE_VERSION = "24"

[[plugins]]
  package = "netlify-plugin-cache"
  [plugins.inputs]
    paths = [".cache/ssqch"]
```

- **The `ssqch` dev dependency** pins the version, so a new SiteSquatch release can't surprise a deploy. Pin it exactly (`pnpm add -D ssqch@0.14.1`) and bump it when you're ready.
- **`NODE_VERSION`** is the Node that runs the build: anything from 22.18 on. ssqch builds the same bytes on every supported Node, so pick the one your other build tools like.
- **[`netlify-plugin-cache`](https://github.com/jakejarvis/netlify-plugin-cache)** carries `.cache/ssqch` (the encoded images and their hashes, highlighted code, and any `fetch` copies) over to the next build. Add it to your `devDependencies`.

A site without a `package.json` can run a pinned release straight from npm in the build command, with `SSQCH_VERSION = "0.14.1"` under `[build.environment]` to pin it (and `NODE_VERSION` there as well):

```toml
[build]
  command = "npx --yes ssqch@$SSQCH_VERSION build"
```

**Forms:** Netlify Forms work on a page ssqch built as on any static page: when it deploys, Netlify reads the HTML for a `<form>` with a `name` and `data-netlify="true"`, and takes its submissions. Write the form as Netlify's docs describe it (a form sent with JavaScript also needs a hidden `<input type="hidden" name="form-name" value="contact">`); ssqch changes none of it, and `minifyPlugin()` keeps `data-netlify`, `netlify-honeypot` and hidden inputs as written. Since Netlify finds forms at deploy, try one on a deploy preview: `ssqch serve` has no server behind a form's `action`.

**Redirects:** `redirectsPlugin({ hostFile: true })` writes a `301` line to `_redirects` for each old address, which Netlify reads. A redirect with another status (a `302` while a page is away, a `410` for one that's gone) or a forced one (`!`, which Netlify follows even when a file is there) is a line of your own: write `_redirects` as a template, and the plugin's lines go after yours. Put `withBase` on each path, as the plugin does on its own lines, so they still work under `--base`:

```jinja
---
permalink: /_redirects
---
{{ "/store/" | withBase }}  https://example.com/squatch-snacks/  302
{{ "/trails/closed/" | withBase }}  {{ "/trails/" | withBase }}  302!
{{ "/old-map.pdf" | withBase }}  {{ "/404.html" | withBase }}  410
```

`linksPlugin()` reads every line, yours too, so a link to `/store/` is a working link and not a broken one. Netlify takes the first line that matches, which is why yours come first.

**Headers:** `netlify.toml` is Netlify's and not the build's, so its paths are written as the site is served: under `--base /repo`, a `[[headers]]` block needs `for = "/repo/*"`, where `_redirects` gets the base from the build. To have headers follow the base as well, write `_headers` as a template (`permalink: /_headers`, with `withBase` on each path), as `_redirects` above.

To answer a coding agent's `Accept: text/markdown` with a page's Markdown copy, add an edge function: [Serving Markdown to agents](serving-markdown.md#netlify) has it, ready to paste.
