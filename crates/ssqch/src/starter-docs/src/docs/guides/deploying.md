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
  command = "curl -fsSL https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.sh | SSQCH_UNMANAGED_INSTALL=.cache/bin sh && .cache/bin/ssqch build"
```

Pin a version in that URL (`download/v0.4.0/`) so a build next year uses the ssqch you tested with.

## GitHub Pages

A project site is served under its repository's name, like `https://you.github.io/repo/`. Set that path in `ssqch.config.js`, and leave the links in your pages as they are:

```js
export default defineConfig({
  base: "/repo/",
});
```

Then build with the [`setup-ssqch`](https://github.com/reverentgeek/setup-ssqch) action and upload `dist/`.

## Check before you publish

Build the site before and after a big change, and compare the two:

```sh
ssqch build --output dist-before
# ...make the change...
ssqch build
ssqch diff dist-before dist
```

It lists the pages that were added, removed and changed, and ignores what doesn't matter.
