---
title: "Netlify"
description: "Netlify can build the site itself, with no deploy token to manage."
---
Netlify can build the site itself, with no deploy token to manage. With `ssqch` in the site's `devDependencies` (see [Install](install.md)), Netlify installs it with the site's other packages, at the version in the lockfile, and runs it on the Node it has: set `NODE_VERSION` to 22.18 or newer, as below. This is the ReverentGeek blog's `netlify.toml` (it builds its CSS and JavaScript with npm scripts first, so it runs `pnpm run build`; a site without that step can run `npx ssqch build` instead):

## The build

```toml
# netlify.toml
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

- **The `ssqch` dev dependency** pins the version, so a new SiteSquatch release can't surprise a deploy. Pin it exactly (`pnpm add -D ssqch@0.15.1`) and bump it when you're ready.
- **`NODE_VERSION`** is the Node that runs the build: anything from 22.18 on. ssqch builds the same bytes on every supported Node, so pick the one your other build tools like.
- **[`netlify-plugin-cache`](https://github.com/jakejarvis/netlify-plugin-cache)** carries `.cache/ssqch` (the encoded images and their hashes, highlighted code, and any `fetch` copies) over to the next build. Add it to your `devDependencies`.

A site without a `package.json` can run a pinned release straight from npm in the build command, with `SSQCH_VERSION = "0.15.1"` under `[build.environment]` to pin it (and `NODE_VERSION` there as well):

```toml
[build]
  command = "npx --yes ssqch@$SSQCH_VERSION build"
```

The build command can run more than the build. The ReverentGeek blog, the site ssqch is tested on, runs its smoke tests after it (`node --test`), so a page that renders wrong stops the deploy and the site that's live stays as it was. `ssqch build` already exits with an error on a broken link, a schema that doesn't match or a budget with `fail: true`, so even without tests a broken build never goes out.

## Redirects

`redirectsPlugin({ hostFile: true })` writes a `301` line to `_redirects` for each old address (a page's `aliases`, and the plugin's `redirects`), which Netlify reads:

```js
// ssqch.config.js
import { redirectsPlugin } from "ssqch/redirects";

export default {
  plugins: [redirectsPlugin({ hostFile: true, redirects: { "/feed/": "/feed.xml" } })],
};
```

Netlify serves a file that exists before it reads `_redirects`, so with `hostFile` on, the plugin writes no redirect pages (`pages` is `false`): with both, an old address would answer 200 with the page and never the 301. The status is on every line, since hosts' defaults differ (Netlify's is 301, Cloudflare's 302).

A redirect with another status (a `302` while a page is away, a `410` for one that's gone) or a forced one (`!`, which Netlify follows even when a file is there) is a line of your own: write `_redirects` as a template, and the plugin's lines go after yours. Put `withBase` on each path, as the plugin does on its own lines, so they still work under `--base`:

```jinja
---
permalink: /_redirects
---
{{ "/store/" | withBase }}  https://example.com/squatch-snacks/  302
{{ "/trails/closed/" | withBase }}  {{ "/trails/" | withBase }}  302!
{{ "/old-map.pdf" | withBase }}  {{ "/404.html" | withBase }}  410
```

`linksPlugin()` reads every line, yours too, as Netlify does: a link to `/store/` is a working link and not a broken one, a line that isn't forced covers only an address with no file there, and a `4xx` line isn't a redirect, so a link to `/old-map.pdf` is still a broken link (as is any link a catch-all `/*  /404.html  404` answers). Netlify takes the first line that matches, which is why yours come first. A site under a path needs its own catch-all to its 404 page, after every other line: `redirectsPlugin({ hostFile: true, notFound: "/404.html" })` writes it last ([Serving a site under a path](deploying.md#serving-a-site-under-a-path) has the rest).

## Headers

A `_headers` file in the output sets response headers, and Cloudflare reads the same file, so headers there move with the site if it changes hosts. Write it as a template, so its paths can follow `base`. Images that `imagePlugin()` encoded, and files `assetsPlugin()` fingerprinted, are named by their contents, so a browser can keep them for good: a new version is a new name.

```jinja
---
permalink: /_headers
---
{{ "/img/*" | withBase }}
  Cache-Control: public, max-age=31536000, immutable

{{ "/assets/*" | withBase }}
  Cache-Control: public, max-age=31536000, immutable

{{ "/*.md" | withBase }}
  X-Robots-Tag: noindex
  Content-Type: text/markdown; charset=utf-8

/*
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
```

Only cache a folder forever when everything in it is named by its contents: a stylesheet at `/assets/site.css` that isn't fingerprinted would stay stale in browsers for a year. The `*.md` rule is for the Markdown copies `llmsPlugin()` writes ([The copies' own headers](serving-markdown.md#the-copies-own-headers)).

`netlify.toml`'s `[[headers]]` work too, but `netlify.toml` is Netlify's and not the build's, so its paths are written as the site is served: under `--base /repo`, a `[[headers]]` block needs `for = "/repo/*"`, where a `_headers` template gets the base from `withBase`.

## Forms

Netlify Forms work on a page ssqch built as on any static page: when it deploys, Netlify reads the HTML for a `<form>` with a `name` and `data-netlify="true"`, and takes its submissions. Write the form as Netlify's docs describe it (a form sent with JavaScript also needs a hidden `<input type="hidden" name="form-name" value="contact">`); ssqch changes none of it, and `minifyPlugin()` keeps `data-netlify`, `netlify-honeypot` and hidden inputs as written. Since Netlify finds forms at deploy, try one on a deploy preview: `ssqch serve` has no server behind a form's `action`. It answers a form's `POST` with the page at the `action`'s address, as it answers a `GET`, so a form whose `action` is its thank-you page (`action="/thanks/"`) clicks through locally, though nothing is kept.

## Rebuilding on a schedule

A page made from an outside answer (stock from an API, a `fetch` in a data file) or from the build's day ("new this week") is only as fresh as the last build. Netlify builds when it's asked to: make a build hook in the site's build settings, which gives a URL that starts a build when it's sent a `POST`, and call it on a schedule, from a GitHub Actions workflow with `on: { schedule: [{ cron: "15 5 * * *" }] }` and a step that runs `curl -X POST -d '{}' "$BUILD_HOOK"` (the URL in a repository secret), or from a Netlify scheduled function. With `netlify-plugin-cache` keeping `.cache/ssqch` (above), a scheduled build encodes no picture twice, and a `fetch` with a `cache` has its last answer when the API is down; a build that fails leaves the last deploy serving.

## Deploy previews and branch deploys

Netlify builds every pull request as a deploy preview, and any branch you turn on as a branch deploy, with the same `[build]` command, so a preview is the production build of that branch at its own address. The build can tell which it is from the `CONTEXT` variable Netlify sets (`production`, `deploy-preview` or `branch-deploy`), and `DEPLOY_PRIME_URL` is the preview's address:

```js
// ssqch.config.js: a preview's sitemap and feed link the preview, and production's the domain.
const url = process.env.CONTEXT === "production" ? "https://example.com" : (process.env.DEPLOY_PRIME_URL ?? "https://example.com");
```

A command for one context goes in `netlify.toml` under `[context.deploy-preview]` (or `[context.branch-deploy]`), beside `[build]`. To see what a pull request changes on the site, page by page, build `main` and the branch and compare them with [`ssqch diff`](comparing-builds.md).

## Updating ssqch

The version in the lockfile is the one Netlify builds with, so a new release never reaches the site until you choose it. To move up: `pnpm add -D ssqch@0.15.1` (or `npm install -D ssqch@0.15.1`), build and test locally, and open a pull request: its deploy preview is the site on the new version, and `ssqch diff` between the old build and the new one shows every page that changed. The [changelog](https://sitesquatch.dev/changelog/) says what each release changes, with what a site has to change under "Breaking". When it says a release renames encoded images, the first build after the move encodes every picture again, as if the cache were empty, so expect that one build to take as long as a site's first (the blog's took 5 minutes instead of 37 seconds); the cache keeps the new copies, and the next build is fast.

## Markdown for agents

Netlify answers a coding agent's `Accept: text/markdown` with the HTML page, the build's Markdown copies notwithstanding, until the site has an edge function for it: [Serving Markdown to agents](serving-markdown.md#netlify) has it, ready to paste (`netlify/edge-functions/markdown.js`). `ssqch patrol --url https://your-site.netlify.app/` checks a deploy (`live-no-markdown` names each page that answers with HTML), and `--url http://localhost:8888` checks `netlify dev`.
