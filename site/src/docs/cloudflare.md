---
title: "Cloudflare"
description: "Cloudflare serves a built site from a Worker with static assets: a config file, no code."
---
Cloudflare serves a built site from a Worker with static assets: a `wrangler.jsonc` beside the site that names the output folder, and no code at all for a plain static site. Cloudflare says to start new projects on Workers rather than Pages, and sitesquatch.dev is deployed this way. `_redirects` and `_headers` work as they do on [Netlify](netlify.md), so the same build serves on either.

## The config

```jsonc
// wrangler.jsonc
{
	"name": "pine-cone-gazette",
	"compatibility_date": "2026-11-01",
	"assets": {
		"directory": "./dist",
		// The nearest 404.html going up the folders, with a 404 status.
		"not_found_handling": "404-page"
	}
}
```

- **`assets.directory`** is ssqch's output folder (`dirs.output`, `dist` by default), from the folder `wrangler.jsonc` is in.
- **`not_found_handling: "404-page"`** answers an address that isn't there with the site's `404.html` and a 404 status. Without it, a missing page is an empty 404.
- **`html_handling`** stays the default (`auto-trailing-slash`): it serves `about/index.html` at `/about/` and sends `/about` there, which is how ssqch writes pages. Nothing to set.
- **No `main`:** a Worker with only assets has no script. Add one (`"main": "worker.js"`, with `"binding": "ASSETS"` in `assets`) only for something a file can't do, such as [answering agents with Markdown](serving-markdown.md#cloudflare).
- **`compatibility_date`** is the Workers runtime's version to hold to; any recent date is fine for files, and it can't be newer than the Wrangler that deploys it.

## Deploying from GitHub Actions

What sitesquatch.dev does: GitHub Actions builds the site and runs its checks, and Wrangler (Cloudflare's command-line tool) uploads `dist/`. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      # ssqch's cache (encoded images, highlighted code) between runs: a new key each run, which
      # restores the newest one a run before it saved.
      - uses: actions/cache@v6
        with:
          path: .cache/ssqch
          key: ssqch-${{ github.run_id }}
          restore-keys: ssqch-
      - run: npx ssqch build
      - run: npx --yes wrangler@4.157.0 deploy --message "${GITHUB_SHA:0:7}"
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Pin Wrangler's version, as `ssqch` is pinned by the lockfile, so a deploy doesn't change under you; `cloudflare/wrangler-action` with `command: deploy` does the same as the last step. **A preview for each pull request:** add `"workers_dev": true`, `"preview_urls": true` and `"previews": {}` to `wrangler.jsonc`, and on a pull request run `wrangler preview --name pr-<number>` (Wrangler 4.135.0 or newer), which prints the preview's address (`pr-<number>-<name>.<your subdomain>.workers.dev`); `wrangler preview delete --name pr-<number>` removes it when the pull request closes. sitesquatch.dev's `.github/workflows/site.yml` does both, and comments each preview's address with an [`ssqch diff`](comparing-builds.md) of what the pull request changes on the site.

## Deploying with Workers Builds

Cloudflare can build the site itself from its repository (Workers Builds, under the Worker's Settings, "Builds"): connect the repository, set the build command to `npx ssqch build` (or `npm run build`) and leave the deploy command as `npx wrangler deploy`. Set `NODE_VERSION` (22.18 or newer) under the build's variables, so it runs the Node you test with, and `ssqch` comes from the site's `devDependencies` at the lockfile's version, as on Netlify. A push to the production branch deploys; a build of any other branch uploads a version with its own preview address.

> [!NOTE]
> Not checked yet: whether Workers Builds keeps `.cache/ssqch` from one build to the next (without it, every build encodes every image again, which is slow on a site with many), and which Node versions it offers (Node 26, say). GitHub Actions, above, is the way that's been tried.

## Redirects and headers

Workers' static assets read `_redirects` and `_headers` in the output folder, in Netlify's format, so [the Netlify page's](netlify.md#redirects) `redirectsPlugin({ hostFile: true })`, a `_redirects` template of your own, and a `_headers` template with cache headers work unchanged. The limits: 2,000 static redirects and 100 dynamic ones (with a `*` or a `:name`), and 100 header rules, each with at most one `*`. Every line `redirectsPlugin()` writes has its status, which matters here: a `_redirects` line without one is a 302 on Cloudflare and a 301 on Netlify, so write the status on lines of your own too. A forced line (`302!`) is Netlify's; check Cloudflare's docs before counting on it there.

## Markdown for agents

To answer a coding agent's `Accept: text/markdown` with a page's Markdown copy, the Worker gets a script: [Serving Markdown to agents](serving-markdown.md#cloudflare) has it, ready to paste, with the `run_worker_first` that sends only pages through it.
