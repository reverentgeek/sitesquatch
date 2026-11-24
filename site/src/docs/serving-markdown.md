---
title: "Serving Markdown to agents"
description: "A coding agent asks for a page with Accept: text/markdown. ssqch serve answers with the page's Markdown copy; on a host, a few lines of the host's own code do the same."
---
Claude Code, Cursor and OpenCode ask for a page with `Accept: text/markdown`, and a page's Markdown copy (written by `llmsPlugin()`) is what they'd rather read: the text without the navigation, scripts and styles. A browser never asks for it, and neither does a crawler, so the same address can answer both.

## While you work

`ssqch serve` and `ssqch serve --built` answer a request for a page with its copy when the request asks for `text/markdown` by name, at a q-value at least as high as HTML's: `Accept: text/markdown, text/html;q=0.9` gets the copy, a browser's `text/html,...,*/*;q=0.8` gets the page, and `*/*` alone (curl's) gets the page too. The copy is the page's file with `.md` for `.html` (`guide/intro/index.html` has `guide/intro/index.md`), sent as `text/markdown; charset=utf-8`; a page that has a copy is sent with `Vary: Accept` either way, and one without is the page whatever the request asks. A copy at its own address (`/guide/intro/index.md`) is Markdown too.

```sh
curl -H "Accept: text/markdown" http://localhost:8080/guide/intro/
```

## On a host

A static host sends the HTML file for a page's address whatever the request asks for, so answering with the copy takes a few lines of the host's own code. Each version below does the same thing: it checks the `Accept` header as `ssqch serve` does, finds the copy beside the page, sends it as Markdown with `Vary: Accept` and a `Link` header naming the page as the canonical address, and leaves every other request alone. They differ in where the code lives and what it costs.

Every version uses these three functions; paste them above it:

```js
/** Whether `accept` asks for text/markdown by name, at least as much as for HTML (by q-values). */
function prefersMarkdown(accept) {
  const q = new Map();
  for (const part of accept.split(",")) {
    const [type, ...params] = part.split(";").map((p) => p.trim().toLowerCase());
    const given = params.find((p) => p.startsWith("q="));
    if (type) q.set(type, given === undefined ? 1 : Number(given.slice(2)) || 0);
  }
  const markdown = q.get("text/markdown") ?? 0;
  return markdown > 0 && markdown >= (q.get("text/html") ?? q.get("text/*") ?? q.get("*/*") ?? 0);
}

/** A page's Markdown copy, as llmsPlugin() writes it: `/guide/intro/` (or `/guide/intro`) is `/guide/intro/index.md`, `/about.html` is `/about.md`; a file of another kind has none. */
function copyOf(pathname) {
  if (pathname.endsWith("/")) return `${pathname}index.md`;
  if (/\.html?$/.test(pathname)) return pathname.replace(/\.html?$/, ".md");
  return /\.[a-z0-9]+$/i.test(pathname) ? undefined : `${pathname}/index.md`;
}

/** The page's own address, for the copy's `Link` header: `/guide/intro` is the folder's page, `/guide/intro/`. */
function pageOf(pathname) {
  return pathname.endsWith("/") || /\.[a-z0-9]+$/i.test(pathname) ? pathname : `${pathname}/`;
}
```

### Cloudflare

Workers with static assets (what Cloudflare suggests for a new site): a Worker that runs before the files for the pages with a copy. This is sitesquatch.dev's own `worker.js`, which serves this page. In `wrangler.jsonc`:

```jsonc
{
  "main": "worker.js",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    // The pages with a copy; everything else is a file, served without the Worker.
    "run_worker_first": ["/", "/docs", "/docs/*"],
    "not_found_handling": "404-page"
  }
}
```

And `worker.js`:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const copy = copyOf(url.pathname);
    if (copy && prefersMarkdown(request.headers.get("Accept") ?? "")) {
      const found = await env.ASSETS.fetch(new URL(copy, url));
      if (found.ok) {
        const out = new Response(found.body, found);
        out.headers.set("Content-Type", "text/markdown; charset=utf-8");
        out.headers.set("Link", `<${url.origin}${pageOf(url.pathname)}>; rel="canonical"`);
        out.headers.append("Vary", "Accept");
        return out;
      }
    }
    const response = await env.ASSETS.fetch(request);
    // A copy at its own address: _headers rules don't reach what a Worker answers.
    if (url.pathname.endsWith(".md") && response.ok) {
      const out = new Response(response.body, response);
      out.headers.set("Content-Type", "text/markdown; charset=utf-8");
      out.headers.set("X-Robots-Tag", "noindex");
      return out;
    }
    if (!copy) return response;
    const out = new Response(response.body, response);
    out.headers.append("Vary", "Accept");
    return out;
  },
};
```

It costs a Worker request for each page view in `run_worker_first` (the free plan has 100,000 a day); files outside it don't run the Worker. `_headers` rules don't apply to what a Worker answers, so the headers are set here, a copy's at its own address included (a copy outside `run_worker_first` gets them from `_headers`, below). Checked on Cloudflare (sitesquatch.dev, November 2026): a browser's request and an agent's, one after the other on the same address, each get theirs, with `Vary: Accept`, even while Cloudflare's cache has the page (`cf-cache-status: HIT`): the Worker runs before the cache and picks which file to answer with.

### Netlify

An edge function, which Netlify runs only for a request whose `Accept` mentions `text/markdown` (the `header` setting), so a browser's request never reaches it. `netlify/edge-functions/markdown.js`, the whole file, the three functions above included:

```js
/** Whether `accept` asks for text/markdown by name, at least as much as for HTML (by q-values). */
function prefersMarkdown(accept) {
  const q = new Map();
  for (const part of accept.split(",")) {
    const [type, ...params] = part.split(";").map((p) => p.trim().toLowerCase());
    const given = params.find((p) => p.startsWith("q="));
    if (type) q.set(type, given === undefined ? 1 : Number(given.slice(2)) || 0);
  }
  const markdown = q.get("text/markdown") ?? 0;
  return markdown > 0 && markdown >= (q.get("text/html") ?? q.get("text/*") ?? q.get("*/*") ?? 0);
}

/** A page's Markdown copy, as llmsPlugin() writes it: `/guide/intro/` (or `/guide/intro`) is `/guide/intro/index.md`, `/about.html` is `/about.md`; a file of another kind has none. */
function copyOf(pathname) {
  if (pathname.endsWith("/")) return `${pathname}index.md`;
  if (/\.html?$/.test(pathname)) return pathname.replace(/\.html?$/, ".md");
  return /\.[a-z0-9]+$/i.test(pathname) ? undefined : `${pathname}/index.md`;
}

/** The page's own address, for the copy's `Link` header: `/guide/intro` is the folder's page, `/guide/intro/`. */
function pageOf(pathname) {
  return pathname.endsWith("/") || /\.[a-z0-9]+$/i.test(pathname) ? pathname : `${pathname}/`;
}

export default async (request) => {
  if (!prefersMarkdown(request.headers.get("accept") ?? "")) return;
  const url = new URL(request.url);
  const copy = copyOf(url.pathname);
  if (!copy) return;
  const found = await fetch(new URL(copy, url));
  if (!found.ok) return;
  return new Response(found.body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Vary": "Accept", "Link": `<${url.origin}${pageOf(url.pathname)}>; rel="canonical"` } });
};

export const config = { path: "/*", excludedPath: ["/*.md"], header: { accept: "text/markdown" } };
```

Returning nothing hands the request on to the page as usual. `_redirects` can't do this: its conditions are country, language, role and cookie, not `Accept`. Edge functions are billed by invocation; with the `header` setting, only agents' requests count. Checked on Netlify (the ReverentGeek blog, November 2026): an agent's `Accept: text/markdown`, or one that prefers it by q-value, gets the copy, and a browser's request, `*/*`, a missing page and a feed get what they always did. Edge functions run before Netlify's cache, so a page Netlify has cached as HTML still answers an agent with Markdown. The HTML itself goes out without `Vary: Accept`, and adding it to every page would split Netlify's cache by each browser's `Accept`, so a shared cache between Netlify and an agent could hand it the HTML; agents fetch directly, so it's rare. A deploy preview adds `X-Robots-Tag: noindex` to everything; production doesn't.

### Vercel

Routing Middleware, which works for a site without a framework: `middleware.js` at the project's root (with `"type": "module"` in `package.json`) and `npm install @vercel/functions`:

```js
import { next } from "@vercel/functions";

export default async function middleware(request) {
  const url = new URL(request.url);
  const copy = copyOf(url.pathname);
  if (!copy || !prefersMarkdown(request.headers.get("accept") ?? "")) return next();
  const found = await fetch(new URL(copy, url));
  if (!found.ok) return next();
  return new Response(found.body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Vary": "Accept", "Link": `<${url.origin}${pageOf(url.pathname)}>; rel="canonical"` } });
}
```

Without a `matcher`, it runs for every request, files included, and each counts as a middleware invocation. A `rewrites` entry in `vercel.json` with a `has` condition on the `accept` header is the other way people try; Vercel's docs don't say it wins over a page's own file, so the middleware is the one to rely on. With no framework, a `vercel.json` of `{ "buildCommand": "ssqch build", "outputDirectory": "dist" }` builds the site and serves it, with `ssqch` in the `devDependencies` (pinned, as everywhere) and the middleware's `@vercel/functions` in `dependencies`. Checked on Vercel (the blog starter, built there with ssqch 0.13.4, November 2026): an agent's `Accept: text/markdown`, or one that prefers it by q-value, gets the copy with `Vary: Accept` and the `Link` header, with or without the trailing slash, and a browser's request, `*/*`, a missing page (404) and `robots.txt` get what they always did. The middleware runs before Vercel's cache, so a page cached as HTML (`x-vercel-cache: HIT`) still answers an agent with Markdown; the HTML goes out without `Vary: Accept`, as on Netlify. A preview's own address (`<project>-<hash>-<team>.vercel.app`) is behind Vercel's login by default (Deployment Protection), so ask the project's public alias, or production, and `ssqch patrol --url` it.

### GitHub Pages

GitHub Pages has no code that runs per request and no headers file, so a page's address is always its HTML. An agent finds the copy through the page's `<link rel="alternate" type="text/markdown">` and `llms.txt` instead ([Posted signs](robots.md#the-links-in-the-layout)), which is enough for one that reads them.

## The copies' own headers

A copy at its own address is a second version of the page, which a search engine shouldn't list beside it. On Netlify and Cloudflare, a `_headers` file in the output says so (a template with `permalink: /_headers`, or a file in `passthrough`):

```text
/*.md
  X-Robots-Tag: noindex
  Content-Type: text/markdown; charset=utf-8
```

Cloudflare allows 100 rules in `_headers`, each with one `*` at most; Netlify's apply only to the files it serves, not to an edge function's answers (which set their own, above). Checked on Netlify (the ReverentGeek blog, November 2026): a copy at its own address gets both headers.

On Vercel, the same headers go in `vercel.json` (checked: the copy at its own address gets both, and the middleware's answers set their own):

```json
{
  "headers": [
    { "source": "/(.*)\\.md", "headers": [{ "key": "X-Robots-Tag", "value": "noindex" }, { "key": "Content-Type", "value": "text/markdown; charset=utf-8" }] }
  ]
}
```

`ssqch patrol` checks the copies themselves, and with `--url https://example.com`, whether the deployed site answers an agent with the copy, with `Vary: Accept`, and a browser with the page ([Patrol](patrol.md#the-live-site)).
