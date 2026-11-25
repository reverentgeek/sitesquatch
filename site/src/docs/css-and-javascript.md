---
title: "CSS and JavaScript"
description: "ssqch doesn't bundle CSS or JavaScript."
---
ssqch doesn't bundle CSS or JavaScript. It gets them into a site in one of four ways, and the tools you already use stay in charge of the rest:

- **Plain CSS and ES modules:** copy them with `passthrough` (`passthrough: [{ "src/assets": "assets" }]`). Browsers load modules and `@import` without a bundler, which is often all a small site needs.
- **Sass:** `sassPlugin()` from `ssqch/sass` compiles it on each build, with a compiler built into ssqch ([Built-in plugins](plugins.md)).
- **Any other tool, for builds:** run it in `beforeBuild` (`{ run: "npx esbuild src/app.js --bundle --outfile=dist/app.js" }`), so `ssqch build` writes the CSS and JavaScript before it checks links and fingerprints them.
- **Any other tool, while serving:** list its watcher in `serve.run`. `ssqch serve` starts it with the server, shows its output, and stops it (and whatever it started) when the server stops. When the watcher writes a file, the page picks it up: stylesheets swap without a reload. The server waits for the watchers' first compile before its first build (up to 2 seconds, then it says they wrote nothing yet and builds anyway: what they write goes in when it's ready, and a stylesheet a page links isn't warned about as missing while one of them is still running, for 30 seconds), so the first page has its CSS, and after a rebuild it holds the browser's update until they have finished writing (150 ms of quiet), so an edit that adds Tailwind classes is one reload with the new CSS, not the page first and its CSS a moment later. If something else deletes what the watchers wrote (a production build into the same folder), the server starts them again and rebuilds. A watcher stops when its standard input closes, which happens however the server ends, even killed: one told to ignore it (esbuild's `--watch=forever`) is stopped only when the server stops cleanly (Ctrl-C), and can be left running after a test runner or a host's dev server ends it from above, so give esbuild `--watch`.
- **Dark mode:** the starters follow the reader's setting with CSS alone: colors are custom properties on `:root`, set again under `@media (prefers-color-scheme: dark)`. The docs starter adds a switch: `docs.js` sets `data-theme="light"` or `"dark"` on `<html>` and remembers it, and its dark colors apply under `:root:not([data-theme="light"])` in that media query and under `:root[data-theme="dark"]` always. Nothing in ssqch is involved, so the same works in any site's stylesheet.

`serve.ignore` lists the files only a watcher reads, so saving one doesn't rebuild the site: `serve: { run: ["npx postcss src/_css/main.css -o dist/main.css --watch"], ignore: ["src/_css/**"] }`. A glob (or a list of them) from the project root, as `passthrough`'s globs are; a folder covers what's in it (`src/_css` is `src/_css/**`). Without it, `ssqch serve` rebuilds for any change in the input folder, since a filter or a data file of the site's might read the file, and a rebuild for a stylesheet the build never reads renders every page and changes none (1.6 s on v8.dev). With it, the watcher's new CSS still reaches the browser: the server sees the output change and swaps the stylesheet in. List only what the build doesn't read: a page, a partial or a data file in it would be left stale until the next rebuild. Two kinds of file rebuild even when a glob matches them: the config and the modules it loads, and a file the last build said it read, like a Sass partial `sassPlugin()` compiled, for which the server warns once (`serve.ignore lists src/_css/_vars.scss, but the last build read it`). A glob that isn't valid is the config's error. In `sitesquatch.toml`, `ignore = [...]` under `[serve]`.

`assetsPlugin()` from `ssqch/assets` then fingerprints what the tools wrote, for production builds (`app.css` becomes `app.3dc88db1.css`, and every link to it is rewritten).

Tailwind, for example, built once for `ssqch build` and watched for `ssqch serve`:

```js
import { defineConfig } from "ssqch";
import { assetsPlugin } from "ssqch/assets";

// $SSQCH_OUTPUT is the output folder, wherever --output or --base puts it (%SSQCH_OUTPUT% in cmd on Windows).
const tailwind = "npx @tailwindcss/cli -i src/app.css -o $SSQCH_OUTPUT/assets/app.css";

export default defineConfig(({ serving }) => ({
  dirs: { input: "src", output: "dist" },
  // A build runs it once; the server keeps it watching instead of running it on every rebuild.
  beforeBuild: serving ? [] : { run: `${tailwind} --minify` },
  // Tailwind's watcher reads src/app.css, and the build never does: saving it needs no rebuild.
  serve: { run: [`${tailwind} --watch`], ignore: ["src/app.css"] },
  plugins: [assetsPlugin({ files: ["/assets/app.css"] })],
}));
```

The command writes into `$SSQCH_OUTPUT`, the output folder ssqch is building, rather than `dist/` by name: with `--output` or `--base` the build goes to another folder, and a stylesheet written to `dist/` isn't in it (the link checker then fails the build). In `src/app.css`, tell Tailwind where the class names are and nowhere else, so it doesn't scan the site's notes and scripts and ship classes no page uses:

```css
@import "tailwindcss" source(none);
@source "../src";
```

The layout links `/assets/app.css`. With `ignore`, saving `src/app.css` while serving rebuilds nothing: Tailwind writes the new stylesheet, and the server swaps it into the page. Without it, the save also starts a build that renders every page and changes none. A template you edit still rebuilds, and Tailwind's watcher sees it too, so a new class is one reload with its CSS.

PostCSS, the same way, with its stylesheets in a folder of their own (`src/_css/`, which holds only CSS: the build doesn't read a `.css` file in the input folder, or copy it, unless `passthrough` says to):

```js
import { defineConfig } from "ssqch";

const postcss = "npx postcss src/_css/main.css -o $SSQCH_OUTPUT/main.css";

export default defineConfig(({ serving }) => ({
  dirs: { input: "src", output: "dist" },
  beforeBuild: serving ? [] : { run: postcss },
  // The folder covers every file in it, so a partial that main.css imports doesn't rebuild either.
  serve: { run: [`${postcss} --watch`], ignore: ["src/_css"] },
}));
```

List only what the build never reads. A Sass partial that `sassPlugin()` compiles is the build's, so it rebuilds anyway, and the server says so once (`serve.ignore lists src/_css/_vars.scss, but the last build read it`); a data file or a template in an ignored folder would be left stale until something else rebuilds. [Eleventy's](trailheads/from-eleventy.md) `watchIgnores` is the same idea.

When a page links a stylesheet or script that isn't in the output, `ssqch serve` says so instead of leaving an unstyled page to explain itself: a note in the corner of the page, and a warning in the terminal that names the `serve.run` tool that should have written it (or suggests one), repeated after each build until the file turns up. For the first 30 seconds of a tool that's still running, the note says it hasn't written the file yet instead (`/assets/index.css isn't in dist yet: serve.run's tailwindcss is still running and hasn't written it`), and the warning comes only if the file still isn't there after that, or once none of them is running. So a stylesheet that's linked wrong waits those 30 seconds for its warning.
