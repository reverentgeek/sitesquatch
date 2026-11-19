---
title: "CSS and JavaScript"
description: "ssqch doesn't bundle CSS or JavaScript."
---
ssqch doesn't bundle CSS or JavaScript. It gets them into a site in one of four ways, and the tools you already use stay in charge of the rest:

- **Plain CSS and ES modules:** copy them with `passthrough` (`passthrough: [{ "src/assets": "assets" }]`). Browsers load modules and `@import` without a bundler, which is often all a small site needs.
- **Sass:** `sassPlugin()` from `ssqch/sass` compiles it on each build, with a compiler built into ssqch ([Built-in plugins](plugins.md)).
- **Any other tool, for builds:** run it in `beforeBuild` (`{ run: "npx esbuild src/app.js --bundle --outfile=dist/app.js" }`), so `ssqch build` writes the CSS and JavaScript before it checks links and fingerprints them.
- **Any other tool, while serving:** list its watcher in `serve.run`. `ssqch serve` starts it with the server, shows its output, and stops it (and whatever it started) when the server stops. When the watcher writes a file, the page picks it up: stylesheets swap without a reload. The server waits for the watchers' first compile before its first build (up to 2 seconds, then it says they wrote nothing and builds anyway), so the first page has its CSS, and after a rebuild it holds the browser's update until they have finished writing (150 ms of quiet), so an edit that adds Tailwind classes is one reload with the new CSS, not the page first and its CSS a moment later. If something else deletes what the watchers wrote (a production build into the same folder), the server starts them again and rebuilds.

`assetsPlugin()` from `ssqch/assets` then fingerprints what the tools wrote, for production builds (`app.css` becomes `app.3dc88db1.css`, and every link to it is rewritten).

Tailwind, for example, built once for `ssqch build` and watched for `ssqch serve`:

```js
import { defineConfig } from "ssqch";
import { assetsPlugin } from "ssqch/assets";

const tailwind = "npx @tailwindcss/cli -i src/app.css -o dist/assets/app.css";

export default defineConfig(({ serving }) => ({
  dirs: { input: "src", output: "dist" },
  // A build runs it once; the server keeps it watching instead of running it on every rebuild.
  beforeBuild: serving ? [] : { run: `${tailwind} --minify` },
  serve: { run: [`${tailwind} --watch`] },
  plugins: [assetsPlugin({ files: ["/assets/app.css"] })],
}));
```

The layout links `/assets/app.css`. Tailwind reads the templates for class names on its own; `@source "../src";` in `app.css` tells it where they are if it doesn't find them.

When a page links a stylesheet or script that isn't in the output, `ssqch serve` says so instead of leaving an unstyled page to explain itself: a note in the corner of the page, and a warning in the terminal that names the `serve.run` tool that should have written it (or suggests one), repeated after each build until the file turns up.
