---
title: Deploying
description: Publish the built site on any static host.
---
`ssqch build` writes plain files to `dist/`. Any static host can serve them.

## Netlify

```toml
# netlify.toml
[build]
  publish = "dist"
  command = "npx ssqch build"

[build.environment]
  NODE_VERSION = "24"
```

With `ssqch` in the site's `devDependencies` (see [Installation](/docs/install/)), Netlify installs it at the version in the lockfile, so a build next year uses the ssqch you tested with. `NODE_VERSION` can be any Node from 22.18 on.

## GitHub Pages

A project site is served under its repository's name, like `https://you.github.io/repo/`. Set that path in `ssqch.config.js`, and leave the links in your pages as they are:

```js
export default defineConfig({
  base: "/repo/",
});
```

Then build it in a workflow with `actions/setup-node`, and deploy `dist/` with GitHub's own Pages actions (in the repository's settings, set Pages' source to "GitHub Actions"):

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # every commit, for each page's "Last updated" date
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx ssqch build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

## Check before you publish

Build the site before and after a big change, and compare the two:

```sh
npx ssqch build --output dist-before
# ...make the change...
npx ssqch build
npx ssqch diff dist-before dist
```

It lists the pages that were added, removed and changed, and ignores what doesn't matter.

:::note[Beaver's build notes]
Beaver keeps `dist-before/` until the diff shows only what she meant to change. A dam is easier to fix before the water arrives.
:::
