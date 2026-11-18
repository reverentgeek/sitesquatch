---
title: Installation
description: Install ssqch and run this site.
---
`ssqch` is a single program. Install it once, with whichever of these you like:

::::tabs
:::tab Homebrew
```sh
brew install reverentgeek/tap/ssqch
```
:::
:::tab Shell
```sh
curl -fsSL https://github.com/reverentgeek/sitesquatch/releases/latest/download/ssqch-installer.sh | sh
```
:::
:::tab Cargo
```sh
cargo install ssqch
```
:::
::::

## Run the site

```sh
ssqch serve
```

Open <http://localhost:8080>. Pages rebuild and the browser reloads as you save, and that includes `ssqch.config.js`.

## Build it

```sh
ssqch build
```

The site is in `dist/`, ready for any static host. A broken link or a page without a `title` stops the build and says where.

:::tip
`SEARCH=1 ssqch build` also builds a search index with [Pagefind](https://pagefind.app) and adds a search box to the header. It needs `npx` (Node.js) for that one step.
:::
