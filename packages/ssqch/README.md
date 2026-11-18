# ssqch

<img align="right" src="https://raw.githubusercontent.com/reverentgeek/sitesquatch/main/docs/assets/stickers/sitesquatch.svg" alt="SiteSquatch, a Sasquatch with a deadpan stare" width="160">

[SiteSquatch](https://github.com/reverentgeek/sitesquatch) is a fast static site generator, configured with JavaScript (`ssqch.config.js`). It runs on Node.js 22.18 or newer. Install it in a site as a dev dependency, so the lockfile pins the version:

```sh
npm install --save-dev ssqch
npx ssqch build
```

Or with pnpm (`pnpm add -D ssqch`, `pnpm ssqch build`) or yarn. In `package.json` scripts, call it by name: `"build": "ssqch build"`. `npx ssqch init` starts a new site.

The package is JavaScript, with its template and Markdown libraries bundled in, and its Markdown, highlighter, minifier and Sass as WebAssembly, so it's the same on every platform. Installing it brings one other package: [sharp](https://sharp.pixelplumbing.com), which encodes images.

The modules a config imports (`ssqch`, `ssqch/image` and the rest) are in the package's `exports` map, with their types, so editors, TypeScript and ESLint's `n/no-missing-import` find them.

Outside a site, `npm install --global ssqch` puts `ssqch` on your `PATH`, and Homebrew (`brew install reverentgeek/tap/ssqch`) installs this package with Homebrew's own Node. See the [README](https://github.com/reverentgeek/sitesquatch#readme) for everything else.
