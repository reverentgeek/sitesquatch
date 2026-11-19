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

- **The `ssqch` dev dependency** pins the version, so a new SiteSquatch release can't surprise a deploy. Pin it exactly (`pnpm add -D ssqch@0.10.0`) and bump it when you're ready.
- **`NODE_VERSION`** is the Node that runs the build: anything from 22.18 on. ssqch builds the same bytes on every supported Node, so pick the one your other build tools like.
- **[`netlify-plugin-cache`](https://github.com/jakejarvis/netlify-plugin-cache)** carries `.cache/ssqch` (the encoded images and their hashes, highlighted code, and any `fetch` copies) over to the next build. Add it to your `devDependencies`.

A site without a `package.json` can run a pinned release straight from npm in the build command, with `SSQCH_VERSION = "0.10.0"` under `[build.environment]` to pin it (and `NODE_VERSION` there as well):

```toml
[build]
  command = "npx --yes ssqch@$SSQCH_VERSION build"
```
