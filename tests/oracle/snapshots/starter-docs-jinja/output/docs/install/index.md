# Installation

`ssqch` runs on [Node.js](https://nodejs.org) 22.18 or newer, and comes from npm. Install it in the site as a dev dependency, so the lockfile pins the version:

::::tabs
:::tab npm
```sh
npm init -y
npm install --save-dev ssqch
```
:::
:::tab pnpm
```sh
pnpm init
pnpm add -D ssqch
```
:::
::::

Then run it with `npx ssqch` (or `pnpm ssqch`), or by name in a `package.json` script: `"build": "ssqch build"`. To have `ssqch` on your `PATH` for every site, `npm install --global ssqch` or `brew install reverentgeek/tap/ssqch`.

## Run the site

```sh
npx ssqch serve
```

Open <http://localhost:8080>. Pages rebuild and the browser reloads as you save, and that includes `ssqch.config.js`.

## Build it

```sh
npx ssqch build
```

The site is in `dist/`, ready for any static host. A broken link or a page without a `title` stops the build and says where.

:::tip
`npx ssqch build` also builds a search index with [Pagefind](https://pagefind.app) and adds a search button to the header (or press Ctrl+K, or Cmd+K on a Mac). Pagefind is a program of its own, which `npx` fetches the first time, at the version `ssqch.config.js` pins; `SEARCH=0 npx ssqch build` skips it, for a build with no network. `npx ssqch serve` builds without it, so to try search, build and serve that build: `npx ssqch build`, then `npx ssqch serve --built`.
:::
