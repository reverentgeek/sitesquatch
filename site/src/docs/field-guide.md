---
title: "Field guide: build your first site"
navTitle: "Field guide"
description: "The quickest way in is ssqch init, which sets up camp (a config, a layout, a home page, seven posts with tags, a page for each tag and one listing them, an Atom feed, a 404 page, a data file, a blueprint for the next post, editor types, and an AGENTS.md for coding agents) and then leaves you to it."
---
<img align="right" src="../../../docs/assets/stickers/compass.svg" alt="" width="96">

The quickest way in is `ssqch init`, which sets up camp (a config, a layout, a home page, seven posts with tags, a page for each tag and one listing them, an Atom feed at `/feed.xml`, a 404 page, a data file, a blueprint for the next post, editor types, and an `AGENTS.md` for coding agents) and then leaves you to it:

```sh
ssqch init my-site
cd my-site && ssqch serve
```

Haven't installed it yet? `npx ssqch init my-site`, then `npx ssqch serve` in the new folder, works too. Open <http://localhost:8080>, edit `src/posts/i-know-what-i-saw.md`, and watch the page reload. (The starter is an amateur investigator's field notes: a sighting, a correction, a stump, an old map, a raccoon's cache, a forwarding address and a beaver's pack. The posts are short, and each one shows you something.) `ssqch init` never overwrites a file that's already there, so it's safe to run in a folder you've started. In a folder with a `package.json`, it sets `"type": "module"` (the config is an ES module, and `npm init -y` writes `"type": "commonjs"`) and adds `build` and `serve` scripts that aren't there, and says so (`updated package.json: ...`). A project with JavaScript of its own keeps its `type`, since its files may be CommonJS, and gets `ssqch.config.mjs` instead of `ssqch.config.js`. Without a `package.json`, it writes none.

The layout and home page are [Jinja](template-languages.md#jinja-and-nunjucks) templates, ssqch's default language. To start in another one, pass `--engine edge`, `--engine liquid`, `--engine njk` (Nunjucks) or `--engine hbs` (Handlebars); the config then lists that engine in `templateFormats` and runs Markdown through it. `--engine` works with `--starter docs` too.

Writing documentation? `ssqch init my-docs --starter docs` creates a docs site instead: a light and dark switch, a sidebar, breadcrumbs and previous/next links from one `nav.yml`, a table of contents on each page, notes and tabs, highlighted code, a schema that checks each page's front matter, the link checker, and Pagefind search on every production build. The pages are plain HTML that reads fine without JavaScript (a small script turns tab sections into tabs), and every file is yours to edit: there's no theme package underneath.

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

**What a rebuild renders:** only the pages an edit can reach. Every rebuild works out every page's data, the collections and the pagination again, and then renders the page you changed and the pages that show something of it. An edit to a post's text renders the post and the pages that show its text (a feed). An edit to its front matter, or a page added, renamed or deleted, renders the page and every page that read `collections` last time (a list of titles, a tag page, prev and next links), however it read them, a filter of your own included. A page with no date of its own has its file's time, which a save moves: the pages that showed its date render too (a list of "last updated" dates), and a list of titles doesn't. When the site's code read its date before the pages rendered (a collection of its own sorted by date, computed data that copies it), the server can't tell who shows it, so every page that read `collections` renders, and it says so once; with `dateFallback: "git"` (the starters set it) the date is its last commit's, and a save doesn't move it. A page that includes it from beside it (EJS's `include("./part.ejs")`, Liquid's `include_relative`) renders too, and so does one whose own code read its file: a filter that reads `src/snippets/install.md` with `fs.readFileSync` or `fs/promises`' `readFile`, or asked whether it's there (`existsSync`, `stat`); one whose code listed a folder (`readdirSync`) renders when a page comes to it or leaves it. The server hears those through Node's `fs` while serving only, and not a read outside JavaScript (a command your code runs, a native module) or through a file handle (`fs.open`): code that shows a page's file that way needs `SSQCH_INCREMENTAL=0`. A change to anything else (a layout, an include, a data file, a picture, the config) renders every page, and so does the rebuild after one that failed. So does every rebuild on a site with a transform of its own, which sees each page as it renders, or with `fromJekyll()` or `fromMkdocs()`, and on a site with an `afterBuild` hook of its own, unless the hook says it reads only the output: `afterBuild: { run: (event) => writeSitemap(event), reads: "output" }` (or `{ run: "npx -y pagefind --site dist", reads: "output" }`). That's a hook that reads the output folder, its event (`written`, `dirs`) and the site's files and data, and nothing the site's code kept in memory while pages rendered (a list a filter added each page to), which a rebuild that renders only some pages would leave short. A page a rebuild doesn't render keeps the file the last build wrote, and its warnings are said again. `SSQCH_INCREMENTAL=0 ssqch serve` renders every page on every rebuild: if a page is out of date while serving and right with it, that's a bug in ssqch (please report it).

**What it watches:** the input folder, a theme's folder, the config and the modules it imports, the config's `watch` paths, the files plugins read (a Sass partial in a folder the config never named), and the files your code read with `readData()`, `files()` or `image()` outside those folders (`readData("data/snacks.yml")` beside `input: "src"`). A change to a file `readData()` read reads the configuration again, since its values may be in the config; one a `beforeBuild` hook wrote just before it was read is what the build used, and isn't a change. A change to a file `files()` matched or `image()` was given rebuilds. A new file a `files()` glob would match, in a folder nothing watches, isn't seen until another change: put the folder in `watch`. The watch begins before the first build, so an edit made while it runs is built next. An editor's own files beside the one you edit start no build: `sed -i`'s `.!12345!post.md`, backups (`post.md~`), Emacs' `.#post.md`, Vim's `.post.md.swp` and `4913`, and JetBrains' `___jb_tmp___` files. A change to the config, or to code it imports, reloads all of it, so a filter you edited is the new one on the next build. Builds run in a process of their own, so the server keeps answering while a build runs, and a site's code that crashes or calls `process.exit()` fails that one build rather than the server. A build that stops making progress is ended, and the next change builds again: [A build that stops making progress](#a-build-that-stops-making-progress), below. It listens on this machine only, unless you give it `--host`: [On your phone](#on-your-phone).

**When changes aren't seen:** the server hears of a change from the system's file events, and some places send none: a Windows drive opened from WSL (`/mnt/c/...`), some Docker bind mounts, network shares. There it would build once and never again. Under WSL, a site on a Windows drive is watched by polling on its own; anywhere else, set `SSQCH_WATCH=poll` (`SSQCH_WATCH=poll ssqch serve`). Polling looks at every watched file's size and time every quarter of a second, or four times as long as a look takes (a 10,000-page site's look took 44 ms on a laptop, about a sixth of one core while serving), so a change shows a moment later than with events. The server says when it polls, and `SSQCH_WATCH=events` turns it off. On Linux, a site too big for the system's watches says so (`can't watch ...`): raise `fs.inotify.max_user_watches`, or poll.

### On your phone

The dev server listens on `127.0.0.1`, so only this machine can open the site. To look at it on a phone or a tablet (a real touch screen, the real small screen, a browser you don't have on your laptop), give it `--host`:

```sh
ssqch serve --host 0.0.0.0
```

```text
Serving dist at http://localhost:8080/. Squatch Watch is on.
On your network: http://192.168.1.20:8080/ (anyone on it can see the site)
```

Open the second address on the phone, on the same Wi-Fi as the machine. It's the same server: an edit reloads the page on the phone as it does on the laptop, a stylesheet swaps in place, and a failed build shows its error over the page. `0.0.0.0` listens on every network the machine is on, so anyone on that network can see the site while the server runs, as the line says: use it at home or the office, not on a café's Wi-Fi. `--host 192.168.1.20` listens on that one address. `ssqch serve --built --host 0.0.0.0` does the same for a production build.

- **The phone can't open it:** the machine's firewall may be refusing the connection (on macOS, allow incoming connections for `node` when it asks), or the phone is on another network (a guest network, or mobile data).
- **`On your network: no network address found (is this machine on one?)`:** the machine isn't on a network; connect it and start the server again.
- **Wrong:** a name isn't an address (`` "example.com" isn't an IP address: use 0.0.0.0 for every network this machine is on, or one of its addresses (192.168.1.20) ``), and neither is an address the machine doesn't have (`can't listen on 10.9.9.9: it isn't one of this machine's addresses`).

The ready file's `url` stays `localhost`'s, for the tools on this machine that read it.

### A build that stops making progress

A build that stops making progress for a minute (no page written, no image encoded, none of your code starting or finishing) is ended by the dev server, and the error says what it was waiting on. There are two messages, each with what it looks like:

- **`the build stopped making progress: for 60 s nothing happened, and it was waiting on ...`:** your code started something that never finished, while something else kept Node running. A promise that never settles is the usual one, with a `setInterval` or an open connection keeping the process alive. The message names what the build was waiting on, and the page it was rendering, which is where the error points:

  ```text
  Build failed: in src/index.jinja: the build stopped making progress: for 60 s nothing happened, and it was waiting on filter `latest` (rendering src/index.jinja). A promise in the site's code that never settles, while something else keeps Node running (a setInterval, an open connection), looks like this. ssqch ended that build; the next change builds again. ...
  ```

  Look at that filter (or hook, or data file) for a promise that never resolves: a `fetch` with no timeout to a server that never answers, a `new Promise` whose `resolve` is never called, an event that never fires.
- **`the build stopped answering for 60 s`:** code that never returns, so the build couldn't even say what it was doing: a loop that doesn't end, in a filter, a `computed` function or a collection. When the build was waiting on something of yours before it, the message names that too (`, last waiting on ...`).

The minute counts from the last thing the build did, so a long build that's still writing pages isn't cut short, and a `{ run: "..." }` command (Pagefind, a CSS tool) is never counted: it takes as long as it takes. The ended build stays failed, with its error in the terminal and over the page; it isn't tried again by itself, since the same code would most likely wait the same way. Fix the code, save, and the next build runs. Something that waits a minute on purpose (a hook that runs a long tool through its API, not as a command) is ended too: make it a `{ run: "..." }` command, or skip it while serving (a hook gets `serving`: `if (serving) return;`). `ssqch build` has no such limit; there, a promise that can never settle (nothing left to resolve it) fails the build when Node is about to exit, naming the code it was waiting on.

`ssqch serve` builds for development into the same output folder `ssqch build` writes (`dist`), so a production build there is replaced by a development one, and a check that reads the folder afterwards (Lighthouse, a validator, `ssqch serve --built`) reads that one: build for production again first. To look at a production build the way a host will serve it (for Lighthouse, or a last check before deploying), run `ssqch build`, then `ssqch serve --built`: it serves the output folder as the build left it, with no build, no watching and nothing added to pages, and compresses text with gzip as hosts do. `ssqch preview` is the same command, for people coming from Vite or Astro. It's a plain static server, so it doesn't follow a host's own rules: `_redirects` lines (the redirect pages `redirectsPlugin()` writes do work), `_headers`, `netlify.toml`'s `[[redirects]]` and `[[headers]]`, forms, or a host's functions. To try those before a deploy, serve the output folder with the host's own CLI: `npx netlify-cli dev --dir dist` for Netlify, `npx wrangler pages dev dist` for Cloudflare Pages.

`ssqch build` uses production mode and `ssqch serve` uses development mode, unless you pass `--env development|production` (or set `$SSQCH_ENV` or `$NODE_ENV`). The other options are `--output DIR`, `--base /path/` to serve the site [under a path](deploying.md#serving-a-site-under-a-path), `--offline` to answer `fetch()` from saved copies only, `--port N` for `serve` (0 picks a free port), `--host 0.0.0.0` for `serve` to open the site from another device on your network, `--quiet` to print only warnings and errors, and `--verbose` to also list each page as it's written (`[ssqch] Writing ./dist/index.html from ./src/index.jinja (jinja)`), the slowest images to encode and the templates nothing used. Errors are red on a terminal and plain in a pipe, a log, or anywhere `NO_COLOR` is set. The other commands are `ssqch init`, `ssqch types`, `ssqch completions`, [`ssqch new`](new-pages.md), [`ssqch trace`](where-values-come-from.md), [`ssqch diff`](comparing-builds.md), [`ssqch footprint`](footprint.md), [`ssqch scout`](trailheads.md#scouting-a-site), [`ssqch capabilities`](agents.md) and [`ssqch docs`](agents.md), and `ssqch build --format json` reports to a [script or a coding agent](agents.md).
