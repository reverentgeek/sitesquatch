---
title: "Field guide: build your first site"
navTitle: "Field guide"
description: "The quickest way in is ssqch init, which sets up camp (a config, a layout, a home page, five posts with tags, a page for each tag and one listing them, an Atom feed, a 404 page, a data file, a blueprint for the next post, editor types, and an AGENTS.md for coding agents) and then leaves you to it."
---
<img align="right" src="../../../docs/assets/stickers/compass.svg" alt="" width="96">

The quickest way in is `ssqch init`, which sets up camp (a config, a layout, a home page, five posts with tags, a page for each tag and one listing them, an Atom feed at `/feed.xml`, a 404 page, a data file, a blueprint for the next post, editor types, and an `AGENTS.md` for coding agents) and then leaves you to it:

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: the blog starter's tags, tag pages and feed.

```sh
ssqch init my-site
cd my-site && ssqch serve
```

Haven't installed it yet? `npx ssqch init my-site`, then `npx ssqch serve` in the new folder, works too. Open <http://localhost:8080>, edit `src/posts/i-know-what-i-saw.md`, and watch the page reload. (The starter is an amateur investigator's field notes: a sighting, a correction, a stump, an old map and a raccoon's cache. The posts are short, and each one shows you something.) `ssqch init` never overwrites a file that's already there, so it's safe to run in a folder you've started. In a folder with a `package.json`, it sets `"type": "module"` (the config is an ES module, and `npm init -y` writes `"type": "commonjs"`) and adds `build` and `serve` scripts that aren't there, and says so (`updated package.json: ...`). A project with JavaScript of its own keeps its `type`, since its files may be CommonJS, and gets `ssqch.config.mjs` instead of `ssqch.config.js`. Without a `package.json`, it writes none.

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: `ssqch init` making `package.json` ready.

The layout and home page are [Jinja](template-languages.md#jinja-and-nunjucks) templates, ssqch's default language. To start in another one, pass `--engine edge`, `--engine liquid`, `--engine njk` (Nunjucks) or `--engine hbs` (Handlebars); the config then lists that engine in `templateFormats` and runs Markdown through it. `--engine` works with `--starter docs` too.

Writing documentation? `ssqch init my-docs --starter docs` creates a docs site instead: a light and dark switch, a sidebar, breadcrumbs and previous/next links from one `nav.yml`, a table of contents on each page, notes and tabs, highlighted code, a schema that checks each page's front matter, the link checker, and Pagefind search with `SEARCH=1`. The pages are plain HTML that reads fine without JavaScript (a small script turns tab sections into tabs), and every file is yours to edit: there's no theme package underneath.

To see how the pieces fit, here's a small site built by hand: a home page that lists posts. This is all of it:

```text
ssqch.config.js
src/
  _includes/layout.jinja
  index.jinja
  posts/pine-cone-crunch.md
```


## Step 1: The config

`ssqch.config.js` sits in your project root. This one reads templates from `src`, writes to `dist`, and adds a `shout` filter:

```js
// ssqch.config.js
import { defineConfig } from "ssqch";

export default defineConfig({
  dirs: { input: "src", output: "dist" },
  filters: {
    shout: (text) => `${text.toUpperCase()}!`,
  },
});
```


## Step 2: A layout

Layouts live in `src/_includes`. In `src/_includes/layout.jinja`, `{{ content }}` is where each page's body goes (Jinja escapes what it prints, but `content` is already HTML, so it's marked safe):

```html
<!doctype html>
<html lang="en">
  <head><title>{{ title }}</title></head>
  <body>
    <main>{{ content }}</main>
  </body>
</html>
```


## Step 3: A post and a home page

Front matter sets each page's data, and it has to come first in the file. Tagging the post `posts` puts it in `collections.posts`. Save this as `src/posts/pine-cone-crunch.md`:

```markdown
---
layout: layout.jinja
title: Pine Cone Crunch
tags: posts
---
Crunchy, foresty, and only slightly sticky.
```

The home page, `src/index.jinja`, uses the filter and loops over the posts:

```html
---
layout: layout.jinja
title: Squatch Snacks
---
<h1>{{ title | shout }}</h1>
<ul>
  {% for post in collections.posts %}
    <li><a href="{{ post.url }}">{{ post.data.title }}</a></li>
  {% endfor %}
</ul>
```


## Step 4: Build it

```sh
ssqch build
```

You'll see a summary of what it built (`--verbose` adds a line for each page as it's written):

```text
First confirmed sighting. Built in 2.75 ms (production)
  Pages   2 written from 2 templates, 410 B
  Output  dist: 2 files, 410 B
  Time    setup 224 µs, data 435 µs, read 1.54 ms, paginate 45 µs, render 205 µs, write 282 µs, copy 0 µs, after 20 µs
```

`dist/index.html` has a `SQUATCH SNACKS!` heading and a link to `/posts/pine-cone-crunch/`. You've got a website! (A site's first build is its first confirmed sighting. After that it's plain `Built in`.)

To work on it with live reload, run the dev server and open <http://localhost:8080>:

```sh
ssqch serve
```

```text
First confirmed sighting. Built in 2.75 ms (development)
  ...
Serving dist at http://localhost:8080/. Squatch Watch is on.
Fresh tracks in src/posts/pine-cone-crunch.md
Built in 1.92 ms (development)
  ...
Serving dist at http://localhost:8080/. Squatch Watch is on.
```

The address comes after each build's report, so it's on the last line however long the build was. With `--quiet`, the server prints the address once, without its name, and then only warnings and errors.

`ssqch serve` (it answers to Squatch Watch) rebuilds when your sources change, and it's careful about what it disturbs:

- **Only the page you're on reloads,** and only if it came out different. Edit another post, and the tab you're looking at stays where it is. The summary says how many pages changed: `Pages  168 written from 140 templates, 6.83 MB (1 changed)`.
- **A stylesheet is swapped in place,** without a reload, so the page keeps its scroll position and a half-filled form. That goes for CSS another tool writes into the output folder too (a PostCSS watcher, say): the browser hears about it without a rebuild, once the tool has finished writing it, so a page never reloads before its new CSS is there. The old stylesheet stays until the new one has loaded, so the page is never unstyled in between, and a new one that doesn't load (or comes back empty) leaves the old one in place. A changed script or image reloads the page.
- **A build that fails shows up in the browser,** over the page, with the error and the lines it's about. The tab's title and icon say so too, which is how you find out from another window. "Copy diagnostic" copies the error to paste into an issue or a chat, and Escape (or "Hide") puts it away until the error changes. The page underneath is from the last build that worked, and the next good build clears the error and says so in the terminal: `Build recovered. Back on the trail.`
- **A URL that isn't there** gets the site's `404.html`, or, when the site has none, a page of the server's own that says where the trail went cold and suggests the closest URL.
- **A site without a `favicon.ico`** gets a map-paper footprint on a pine circle in the tab. While the build is broken, the circle turns burnt orange.

None of that is written to the output folder: the server adds it to pages as it sends them.

**What it watches:** the input folder, a theme's folder, the config and the modules it imports, the config's `watch` paths, and the files plugins read (a Sass partial in a folder the config never named). The watch begins before the first build, so an edit made while it runs is built next. An editor's own files beside the one you edit start no build: `sed -i`'s `.!12345!post.md`, backups (`post.md~`), Emacs' `.#post.md`, Vim's `.post.md.swp` and `4913`, and JetBrains' `___jb_tmp___` files. A change to the config, or to code it imports, reloads all of it, so a filter you edited is the new one on the next build. Builds run in a process of their own, so the server keeps answering while a build runs, and a site's code that crashes or calls `process.exit()` fails that one build rather than the server. It listens on `127.0.0.1` only.

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: the watch beginning before the first build, and an editor's own files starting no build.

To look at a production build the way a host will serve it (for Lighthouse, or a last check before deploying), run `ssqch build`, then `ssqch serve --built`: it serves the output folder as the build left it, with no build, no watching and nothing added to pages, and compresses text with gzip as hosts do. `ssqch preview` is the same command, for people coming from Vite or Astro.

`ssqch build` uses production mode and `ssqch serve` uses development mode, unless you pass `--env development|production` (or set `$SSQCH_ENV` or `$NODE_ENV`). The other options are `--output DIR`, `--base /path/` to serve the site [under a path](deploying.md#serving-a-site-under-a-path), `--offline` to answer `fetch()` from saved copies only, `--port N` for `serve` (0 picks a free port), `--quiet` to print only warnings and errors, and `--verbose` to also list each page as it's written (`[ssqch] Writing ./dist/index.html from ./src/index.jinja (jinja)`), the slowest images to encode and the templates nothing used. Errors are red on a terminal and plain in a pipe, a log, or anywhere `NO_COLOR` is set. The other commands are `ssqch init`, `ssqch types`, `ssqch completions`, [`ssqch new`](new-pages.md), [`ssqch trace`](where-values-come-from.md), [`ssqch diff`](comparing-builds.md), [`ssqch footprint`](footprint.md), [`ssqch scout`](trailheads.md#scouting-a-site), [`ssqch capabilities`](agents.md) and [`ssqch docs`](agents.md), and `ssqch build --format json` reports to a [script or a coding agent](agents.md).

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: the summary without a line for each page, which `--verbose` lists.
