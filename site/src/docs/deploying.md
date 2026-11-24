---
title: "Out of the woods: deploying"
description: "Encoding images is by far the slowest part of a build, so it's worth never doing it twice."
---
<img align="right" src="../../../docs/assets/stickers/canoe.svg" alt="" width="96">


## Pick a host

A build is a folder of files, so any static host serves it. Three have a page of their own here, with a config to copy: [Netlify](netlify.md) (it builds the site itself, and reads `_redirects` and `_headers`), [Cloudflare](cloudflare.md) (a Worker with static assets, the same `_redirects` and `_headers`) and [GitHub Pages](github-pages.md) (a project site under its repository's path). Whichever it is, keep ssqch's cache between builds (below), and give the build a `base` if the site lives under a path.

## Keep the image cache between builds

Encoding images is by far the slowest part of a build, so it's worth never doing it twice. Each image file is named by a hash of the source image's contents and the encoder settings, not its path or modification time, and it's encoded into `.cache/ssqch/img/`, outside the output. Each build links the files it uses into the output's `img/` folder (a hard link, so no extra space, or a copy where links don't work), so you can delete the output folder whenever you like and the next build encodes nothing. Restore `.cache/ssqch` from the last build in CI, and a build with no new images encodes nothing there either, even on a fresh clone. (An output folder from before the cache, or one a deploy cache restored, is taken in as it is: its files move into the cache instead of being encoded again.) `cacheDir` on `imagePlugin()` puts the cache somewhere else, and `cacheDir: false` encodes straight into the output, which then has to be kept to keep the images.

ssqch also remembers each source image's hash, size and modification time in `.cache/ssqch/image-hashes.json`, so unchanged images aren't read again. (A fresh clone gives every file a new modification time, so its first build re-hashes everything, which takes about 20 ms on the blog's 420 MB of images.) Add `.cache/` to your `.gitignore`, or turn the hash cache off with `hashCache: false`. It's kept outside the output folder because it names your source paths, and the output gets published.

Set `prune: true` on `imagePlugin()` to delete image files the build didn't use, in the output and in the cache, so the cache doesn't keep growing as images change. Only turn it on for full builds, where every image goes through the image plugin.


## Serving a site under a path

A GitHub Pages project site lives at `https://you.github.io/repo/`, not at the root of a domain, so a link to `/about/` would miss. Set `base` and leave the templates alone:

```js
export default defineConfig({
  base: "/repo/",
});
```

- **HTML:** in every page ssqch writes, a URL that starts with `/` gets the base in front: `href`, `src`, `srcset`, `action`, `poster` and the other URL attributes, a meta refresh, and `url()` in `style` attributes and `<style>` elements. That covers Markdown links, images from `imagePlugin()`, fingerprinted assets, redirect pages and Sass output. Relative URLs, `#fragments` and URLs with a domain aren't changed, so a link to something else on the same domain needs the whole address (`https://you.github.io/other-project/`).
- **Everywhere else:** in an inline script, a JSON file or a feed, call `withBase("/search.json")`, or print `ssqch.base` (`/repo`, or an empty string without a base). In a site's own code (a data file, a filter, `computed`), it's an export: `import { withBase } from "ssqch"`, and `absoluteUrl("/provisions/moss-mix/", site.url)` (also from `ssqch`) for a whole address with the base in it (structured data wants those). It has the build's base, `--base` included, so the config's own top-level code, which runs first, gets none. The feed filters add it for you: `absoluteUrl(post.url, site.url)` is `https://example.com/repo/posts/pine/`, with or without the path in `site.url`, and a URL that already has the base keeps one. Don't use `withBase()` inside an HTML attribute, or the URL gets the base twice (the link checker reports it).
- **`page.url` and collections:** unchanged, so `page.url == item.url` and the navigation helpers work the same with or without a base.
- **The output folder:** unchanged too. `dist/about/index.html` is what the host serves at `/repo/about/`.
- **Plugins:** `linksPlugin()` checks links under the base (other paths on the domain count as external), and `sitemapPlugin({ url })` takes the address with or without the base in it.
- **`ssqch serve`:** serves the site at `http://localhost:8080/repo/`, so what you click through locally is what the host will serve.
- **The host's own files:** Netlify and Cloudflare read `_redirects` and `_headers` only at the top of the folder they publish, and crawlers look for `robots.txt` and `sitemap.xml` only at the domain's root. A GitHub Pages project site is the domain's folder already, so there's nothing to do there. On Netlify or Cloudflare, where the folder you publish is the domain's root and the site is one path in it (a preview beside the real site, say), build into that path inside the folder and move the host's two files to its top:

```sh
ssqch build --base /preview/snacks/ --output dist-preview/preview/snacks
mv dist-preview/preview/snacks/_redirects dist-preview/preview/snacks/_headers dist-preview/
```

Publish `dist-preview`. Their lines have the base in them already (`redirectsPlugin()` writes it, and a `_redirects` or `_headers` template uses `withBase`), so they match where they are now. Netlify answers a miss with the site's 404 page by itself only at the root, so there, add `notFound: "/404.html"` to `redirectsPlugin({ hostFile: true })`, which writes `/preview/snacks/*  /preview/snacks/404.html  404` as the file's last line. Cloudflare doesn't need it: its `not_found_handling: "404-page"` finds the nearest `404.html` going up the folders.

`ssqch build --base /repo/` sets it from the command line (for a preview deployed under another path, say) and wins over the config. In `sitesquatch.toml` it's `base = "/repo/"`.


## Search

ssqch doesn't build a search index itself; [Pagefind](https://pagefind.app) does it well and runs after the build. Add it as a command, with its version pinned so every build gets the same one (`npx` comes with Node; or `npm install --save-dev pagefind` and run `pagefind`):

```js
import fs from "node:fs";

export default defineConfig(({ env }) => ({
  afterBuild: env === "production" ? [
    ({ dirs }) => fs.rmSync(`${dirs.output}pagefind`, { recursive: true, force: true }),
    { run: "npx -y pagefind@1.6.0 --site dist" },
  ] : [],
}));
```

The first hook empties the last index: Pagefind names its files by their contents and never deletes any, and `leaveNoTrace` leaves another tool's files alone, so without it every build's index stays in `dist/pagefind/` beside the new one, and a fresh copy of the site builds something else (The North Fake study's fresh copy had six such files). A function and not `rm -rf`, so it works on Windows too.

Then Pagefind's Component UI in your layout: its stylesheet and script, and a search button with its dialog (Ctrl+K or Cmd+K opens it too). Mark the part of each page to index with `data-pagefind-body` (the `<main>`), or Pagefind indexes everything, navigation included:

```html
<link rel="stylesheet" href="/pagefind/pagefind-component-ui.css">
<script src="/pagefind/pagefind-component-ui.js" type="module"></script>

<div id="search"><pagefind-config bundle-path="{{ "/pagefind/" | withBase }}"></pagefind-config><pagefind-modal-trigger></pagefind-modal-trigger><pagefind-modal></pagefind-modal></div>
```

`<pagefind-config bundle-path>` tells the search where its index is. Pagefind's script is a module, which can't see the address it was loaded from, so without it the search looks in `/pagefind/` at the root of the domain: under a [`base`](#serving-a-site-under-a-path) (a GitHub Pages project site, `/repo/`), that's nothing, or another site's index, and every search comes up empty. ssqch adds the base to URL attributes, and `bundle-path` isn't one, so `withBase` adds it (`{{ withBase("/pagefind/") }}` in Edge, `<%= withBase("/pagefind/") %>` in EJS, `{{withBase "/pagefind/"}}` in Handlebars).

Its colors are custom properties (`--pf-text`, `--pf-background`, `--pf-border` and the rest). Pagefind's stylesheet sets them on `:root`, so set yours on an element around the search (`#search { --pf-text: var(--text); }`), and they follow your light and dark themes. `ssqch serve` builds without the `afterBuild` command, so to try search, build for production and serve that build: `ssqch build`, then `ssqch serve --built`. The docs starter (`ssqch init --starter docs`) has all of this, behind `SEARCH=1`.
