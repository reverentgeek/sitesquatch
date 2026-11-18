# ssqch

[SiteSquatch](https://github.com/reverentgeek/sitesquatch) is a fast static site generator, configured with JavaScript (`ssqch.config.js`). It runs on Node.js 22.18 or newer. Install it in a site as a dev dependency, so the lockfile pins the version:

```sh
npm install --save-dev ssqch
npx ssqch build
```

Or with pnpm (`pnpm add -D ssqch`, `pnpm ssqch build`) or yarn. In `package.json` scripts, call it by name: `"build": "ssqch build"`. `npx ssqch init` starts a new site.

The package is JavaScript, with its template and Markdown libraries bundled in, and its Markdown, highlighter, minifier and Sass as WebAssembly, so it's the same on every platform. Installing it brings one other package: [sharp](https://sharp.pixelplumbing.com), which encodes images.

The modules a config imports (`ssqch`, `ssqch/image` and the rest) are in the package's `exports` map, with their types, so editors, TypeScript and ESLint's `n/no-missing-import` find them.

Without Node, install the standalone `ssqch` executable instead, with Homebrew (`brew install reverentgeek/tap/ssqch`) or the installer script. See the [README](https://github.com/reverentgeek/sitesquatch#readme) for those and everything else.
