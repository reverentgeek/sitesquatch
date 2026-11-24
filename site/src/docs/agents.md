---
title: "Scripts and coding agents"
description: "The voice is for people."
---
The voice is for people. The same commands work for a script, a CI job or a coding agent, with JSON in place of the text a person reads, and no jokes in it. Every JSON document has a `schemaVersion`, which changes only when a field is removed or changes meaning.

`ssqch build --format json` prints one report on standard output, whether the build worked or not (the exit code is 0 or 1 as usual):

```sh
ssqch build --format json
```

```json
{
  "schemaVersion": 1,
  "ok": false,
  "environment": "production",
  "output": "dist",
  "warnings": [
    {
      "code": "schema",
      "message": "src/guides/pine.md: `lvl` isn't a field of this schema (did you mean `level`?) (schema `guides`)",
      "file": "src/guides/pine.md",
      "field": "lvl"
    }
  ],
  "errors": [
    {
      "code": "template",
      "message": "rendering index.edge with `edge`: index.edge:4: Cannot read properties of undefined (reading 'toUpperCase') in `guide.data.name`",
      "file": "src/index.edge",
      "line": 7
    }
  ]
}
```

- **Each warning and error** has a `code` and the `message` a person would have read. `file` (from the project root) is there when the problem is in a file that exists, `line` when the line is known, `field` for a [schema](content-schemas.md) problem, and `url` for a problem in a written page, like a broken link.
- **`line` is a line of the file.** Template languages count from the end of the front matter, which is the number in the message (`index.edge:4`); the report adds the front matter back (`"line": 7`).
- **The codes:** `config`, `data`, `front-matter`, `template`, `schema`, `conflict` (two pages write the same file), `links`, `images`, `assets`, `fetch`, `passthrough`, `last-modified`, `hook`, `console` (`console.warn` in a config), `template-formats` (files in a template language the site doesn't list), `other-generator`, `foreign-key` and `foreign-global` (another generator's config, front matter or template data), `over-budget` (a [footprint budget](footprint.md)), `slow-call` (a filter, transform or collection of the site's that took a second or more in one call: [Where the time went](build-summary.md#where-the-time-went)), `missing-asset` (from `ssqch serve`), and `build` for anything else.
- **A build that works** also has `durationMs`, `pages` (`written`, `templates`, `bytes`, and `new` and `gone` since the last build to that folder, or `null` when there wasn't one), `copied`, `removed`, `drafts` (the `draft: true` pages a production build left out), `written` (each page's file, from the output folder), `summary` (the lines plugins add to the [build summary](build-summary.md)) and `timings`.
- **Standard output is only the report.** The lines a person would have read (an image's `[ssqch] Encoded ...`, and with `--verbose`, `[ssqch] Writing ...` for each page), `console.log` from your config and the output of `beforeBuild` commands go to standard error; `--quiet` leaves the progress lines out.

`ssqch capabilities --format json` says what the installed ssqch supports, so nothing has to be guessed from the documentation of another version: its `version`, `commands`, `json` (every command that prints JSON with `--format json`, and `serve --ready-file`), `features` (`avif`, `fetch`, `sass` and each template language, listed only when this build can do them), `templateLanguages` with their extensions, `configFiles`, `configOptions`, the built-in `modules` with what each exports, `nodeModules` (Node's built-in modules), `globals` and `imageFormats`. Without `--format json` it prints the same as text, under "What's in the pack".

`ssqch docs` is this documentation, from the package, so it matches the version that's installed and works without the network. Alone, it lists every command, config option, template function and module export with one line each. `ssqch docs base` (or `imagePlugin`, `toc`, `serve`) prints what these docs say about that name and which other sections mention it, `ssqch docs "content schemas"` prints a section, `ssqch docs "On a host > Netlify"` a section inside another (for a title two pages share; a section's list of what's in it writes them that way), and other words search the text. Another generator's word gets ssqch's (`ssqch docs pathPrefix`), and `ssqch docs --from eleventy` lists that generator's words with ssqch's for each, then its trailhead. `--format json` has the same, with each answer's `names`, `section` and `also`.

`ssqch init` writes an `AGENTS.md` for coding agents, with a one-line `CLAUDE.md` that imports it: what each file is, and the commands above for looking a name up, checking a change and comparing builds. It's about 1 KB, since an agent carries it through a whole session, and `init` never replaces one a site already has. For a site that doesn't have one, `ssqch docs agents > AGENTS.md` writes it.

`ssqch serve --ready-file <file>` writes a file once the first build is done and the site is being served, so a script can wait for the file instead of reading the server's output or sleeping:

```sh
ssqch serve --port 0 --ready-file .cache/ready.json &
```

```json
{
  "schemaVersion": 1,
  "url": "http://localhost:60768/",
  "port": 60768,
  "base": "",
  "output": "/home/sam/site/dist",
  "pid": 39675,
  "ok": true
}
```

`ok` is whether that first build worked (the server keeps running either way, and rebuilds when a file changes). The file is deleted when the server starts, so one from an earlier run never counts, and it's written again when a changed config loads, since `output` and `base` can change with it.

The other commands with JSON are [`ssqch trace --format json`](where-values-come-from.md) (where a page's data came from), [`ssqch diff --format json`](comparing-builds.md) (what a change did to the output; it exits with 0, 1 or 2 like `diff`), [`ssqch footprint --format json`](footprint.md) (what the build weighs), [`ssqch patrol --format json`](patrol.md) (what agents and crawlers find in it), `ssqch new --format json` (the file it made), `ssqch scout --format json` (what a move takes) and `ssqch docs --format json`. `ssqch capabilities --format json` lists them all as `json`.

## Moving a site with an agent

Every move from another generator so far ran the same loop: build the old site, build the new one, compare, fix the biggest group of differences, repeat. It's a loop an agent can run, as long as each step has an answer it can read:

1. **Reference builds you can trust.** `ssqch baseline "<old build command>"` builds the old site with its own generator three times, each in a fresh copy with every file's time pinned and `TZ=UTC`, into `.cache/ssqch/baseline/ref-1` to `-3`, and names what changes by itself (the build's time, ids from `Math.random()`): pin it, or note an `--ignore` pattern for it, before anything else. After the move's first commit, build the commit before it: `--commit <rev>`. When builds vary, run more of them (`--runs 20`): the summary counts how many builds agree on each file and names the one most like the others, and `.cache/ssqch/baseline/ref-common` has each file's most common version, which is the one to compare with. A commit that needs a fix to build at all takes `--patch fix.patch`; a tool that won't follow a link out of its folder (Hugo's `js.Build`) takes `--copy-installs` (a `hugo` command gets it by itself). Watch the first build's warnings: GitHub Pages' placeholder `github.com/pages/...` URLs mean the reference build is wrong on every page.
2. **What the move takes.** `ssqch scout` finds the old generator and lists what the site uses that needs doing, each with its file and line and ssqch's way to do it (or "not in ssqch yet"), with the `ssqch baseline` command for step 1; `--format json` has it as data. `--write-draft` writes the config draft and the other new files, and `--patch move.patch` writes the mechanical edits as a patch to read and `git apply`. Run it again at any point to see what's left. `ssqch docs --from <generator>` has that generator's words with ssqch's for each, and its trailhead.
3. **A build that works.** Build into an empty folder (files an earlier build left count as differences): `rm -rf dist && TZ=UTC ssqch build --format json`, until `ok` is true. Each error has a `code`, a `file` and a `line`.
4. **The biggest group first.** `ssqch diff .cache/ssqch/baseline/ref-1 dist --format json --lines 0` lists the changes on more than one file as `groups`, the most files first. One cause (a filter that formats dates another way, a layout that lost a `<meta>`) is often hundreds of pages, and fixing it shows what's under it. Each change on a page says which heading it's under (`@ under #its-id`, or `at` in the JSON), to find it in the source, and the notes call out what moves a reader: a changed `<title>`, canonical link or redirect, ids that links point at, and a feed's entries. Build and compare again after each fix. What browsers read the same (attribute order, quotes, entities, percent-encoding in URLs, `<br/>`), fingerprints and image ids don't count, so what's left is a real difference.
5. **Done is a decision.** Stop at `No differences`, or when what's left is on purpose: write each one down with why (an `--ignore` pattern with a comment, or a line in the move's notes). `ssqch diff --exact` shows the bytes that still differ, such as a minifier's.
6. **Then ssqch's own features,** one at a time (its Markdown, highlighting, minifying, `toc()`), with a diff after each, so every change in the output has one cause.

### A move, step by step

A small Eleventy blog (three posts, an About page, a feed from `@11ty/eleventy-plugin-rss`, a `posts` collection and two date filters) moved with the loop above, with each command's real output, trimmed. The site is in git, and each step is a commit an agent can go back to.

**1. Scout it.** In the old site's folder, before changing anything:

```text
$ ssqch scout
Scouting the Eleventy site in . (found eleventy.config.js)

4 to do: 4 ssqch does.

Reference build
  ssqch baseline "npm run build"

To do (4)
  package-lock.json: run `npm install` to update it for ssqch
  eleventy.config.js:8: addCollection("posts") -> `collections: { posts: (pages) => ... }`: getAll() is pages.all(), getFilteredByTag is pages.byTag, getFilteredByGlob is pages.byGlob
  eleventy.config.js:9: addPlugin(feedPlugin) (from @11ty/eleventy-plugin-rss) -> see its package below
  eleventy.config.js: @11ty/eleventy-plugin-rss -> `rssPlugin()` from "ssqch/rss" for a feed template's filters, or its `feedPlugin({ url })` for the feed itself (...)

Draft (1 to write): --write-draft writes them, and never overwrites a file
  ssqch.config.js (a first draft, from eleventy.config.js)

Edits (1): --patch <file> writes them as a patch to review, and changes nothing
  package.json: @11ty/eleventy -> ssqch 0.14.1 in devDependencies, scripts: eleventy -> ssqch build, eleventy --serve -> ssqch serve
```

**2. Build the reference.** The command is the one scout found. After the move has started, `--commit HEAD` (or the commit before the move) builds the old site and not the working tree, whose `npm run build` is ssqch's by then:

```text
$ ssqch baseline "npm run build" --commit HEAD
Base camp is set: .cache/ssqch/baseline/ref-1, .cache/ssqch/baseline/ref-2 and .cache/ssqch/baseline/ref-3, built from ... with TZ=UTC, SOURCE_DATE_EPOCH and every file's time pinned; ...
Every build is the same: 5 pages and 2 other files. The tracks match every time.
```

When the builds don't agree, it says what varies before anything is compared. With a random `?v=` on the stylesheet's link, and `--runs 5`:

```text
Varies (4)
  ~ 4 pages, the same but for attribute values: /, /posts/cedar-trail-reopens/, /posts/footprints-at-the-stump/ and 1 more
      - <link href="/style.css?v=p3eijx" rel="stylesheet">
      + <link href="/style.css?v=8fvwrb" rel="stylesheet">

The eyewitness accounts differ: 4 files vary between builds made the same way; 0 pages and 2 other files are the same in all of them. Pin what changes (the build's time, random ids) before comparing another build with these, or leave it out with --ignore.
4 files have no most common version: each build has its own. More builds (--runs 20) show whether one is usual.
Wrote .cache/ssqch/baseline/ref-common: each file's most common version of the 5 builds, to compare ssqch's with.
```

Pin it in the old site if you can (a fixed value, or one from the commit). If not, leave it out of every comparison: `ssqch diff .cache/ssqch/baseline/ref-common dist --ignore '\?v=\w+'`. Compare with `ref-common` whenever builds vary: it's each file's version that most builds wrote, where `ref-1` is one build's luck. A file with no most common version (each build its own, as here) is what `--ignore` is for.

**3. The draft and the patch.** `ssqch scout --write-draft --patch move.patch` writes `ssqch.config.js` (the old config's directories, engines, passthrough copies and self-contained filters, as written) and the patch, which changes only `package.json` here. Read it, then `git apply move.patch` and `npm install`. The draft ends with what it couldn't carry over:

```js
// To port from eleventy.config.js:
//   collections: posts
```

**4. Build, and compare.** Into an empty folder, so nothing an earlier build left looks like a difference:

```text
$ rm -rf _site && TZ=UTC ssqch build
$ ssqch diff .cache/ssqch/baseline/ref-1 _site
Removed (1)
  - /feed.xml

Changed (1)
  ~ /  (text and markup)
      the same lines, in another order
      - <a href="/posts/pine-cone-count/">
      + <a href="/posts/cedar-trail-reopens/">
      ...
```

The two differences are the two to-dos: the home page lists the posts oldest first without the `posts` collection, and there's no feed without a feed plugin. Port the collection (`posts: (pages) => pages.byGlob("src/posts/*.md").reverse()`), build and compare again, and the home page is the same.

**5. Scout again, halfway.** It reads the config the move has written so far, and what's done is off the list:

```text
$ ssqch scout
Scouting the Eleventy site in . (found eleventy.config.js): a move under way, with an ssqch.config.js

3 to do: 3 ssqch does.
1 done already: ssqch.config.js has `collections.posts`.
```

**6. The next group.** After `feedPlugin({ url: "https://example.com", limit: 10, author: "A Ranger" })` from `ssqch/rss`, a change on the About page says which heading it's under, to find it in the template:

```text
Changed (1)
  ~ /about/  (markup)
      @ under #trails
      - <a href="/maps/#old-growth-and-cedar">
      + <a href="/maps/#old-growth-cedar">
```

Eleventy's `slugify` spells out `&` as `and`, and ssqch's drops it; `slugify({ ascii: true })` spells out symbols as Eleventy's does. With that in the template, every page is the same.

**7. Done is a decision.** What's left is the feed, and it's on purpose: Eleventy's listed the posts oldest first (the plugin reverses the collection, which this site had already put newest first) and its subtitle was the plugin's placeholder (`This is a longer description about your blog.`), and ssqch's is newest first, which is what feed readers expect, with the site's `description` as the subtitle. Its picture is a generated copy (`/img/uAgOSjhLVO-4.png`), as `feedHtml()` writes one. Each goes in the move's notes with why, and scout's last to-do is `npm install`.

**An agent's loop, as data.** Each step has a JSON answer, so an agent can run the loop without reading prose:

- `ssqch scout --format json`: `todo` (each with `code`, `at` and `what`), `done`, `summary` (`ssqch`, `option`, `notYet`, `site` and `done` counts) and `build.baseline` (the command for step 2). The move is finished when `todo` is empty or each one left is written down.
- `rm -rf dist && TZ=UTC ssqch build --format json`: `ok`, and `errors`, each with `code`, `file` and `line`. Fix until `ok` is true.
- `ssqch diff <reference> dist --format json --lines 0`: `groups` (changes on more than one file, the most files first: fix the first), then `changed` (each file's `hunks`, with `at`, the heading a change is under), `added` and `removed`. `summary` says how many are left, which is the loop's measure of progress.
