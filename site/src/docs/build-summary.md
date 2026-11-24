---
title: "Reading the build summary"
description: "Every build ends with a ranger's report."
---
Every build ends with a ranger's report. Here's the ReverentGeek blog with its images cached:

```text
Built in 110 ms (production)
  Pages   168 written from 140 templates, 6.83 MB
  Copied  0 files, 12 unchanged, 3.88 MB
  Images  4,689 files from 737 sources, 271 MB: 0 encoded, 4,689 reused
  Output  dist: 4,872 files, 282 MB
  Time    setup 1.11 ms, data 1.31 ms, read 32.3 ms, paginate 2.81 ms, render 7.56 ms, write 55.9 ms, copy 193 µs, after 9.21 ms
```

- **The first line** is `First confirmed sighting. Built in ...` for a site's first build (there's no `.cache/ssqch/output-files.json` yet), which is every build on a CI machine that doesn't keep `.cache`.
- **Pages** also says what's different from the last build to that folder: `(2 new, 1 gone)` when a page appeared or stopped being written (a post you added, a permalink you changed), and `(3 changed)` in `ssqch serve`, which leaves a page alone when it comes out the same.
- **Drafts** is in production builds that left `draft: true` pages out: `Drafts  3 unconfirmed (built in development only)`, or `3 left out` when the report's themed line is another one.
- **Removed** is the stale files `leaveNoTrace` deleted: `Removed  2 stale files, left no trace`, or just `2 stale files`.
- **One themed line at most:** a report says one thing in the ranger's voice, the one that matters most (in this order: nothing to build, a first build, files removed, drafts, unused templates), and says the rest plainly.
- **Images** counts the image files this build used, the source images they came from, how many had to be encoded, and how many were copied as they are (GIFs that keep their animation, and SVGs), when there are some. With `prune` on, it also says how many stale files it deleted.
- **Output** is everything in the output folder, including files left from earlier builds.
- **Time** splits the build into phases. `write` includes layouts, transforms and image encoding, so a build that encodes images spends most of its time there. `after` is the `afterBuild` hooks.

With `--verbose`, a line under the summary names the templates in the includes folder that nothing used as a layout, an include or a component in this build: `Uninhabited: 1 template that nothing used in this build (src/_includes/cabin.jinja).` (`Unused:` when the report's themed line is another one.) It covers every template language: Jinja, Nunjucks, Edge, Liquid, Handlebars, Mustache and EJS.

`ssqch serve` prints the same summary after every rebuild.

## Where the time went

`Time` says which phase was slow, not what in it. `ssqch build --profile` times everything the build calls, and lists the slowest of each kind after the summary. Here's part of the ReverentGeek blog's, a development build:

```text
Profile: where the time went, slowest first (a call's time includes the calls it makes)
  Pages
     233 ms  /avatars/
    71.4 ms  /illustrations/
    ...and 174 more (--format json lists them all)
  Template engines (renders)
     152 ms  edge (692)
    17.8 ms  md (128)
  Filters (calls)
    45.1 ms  imageUrl (357)
    21.3 ms  postDate (819)
    ...
  Transforms (pages)
    1.42 s  image (176)
    142 µs  assets (176)
```

- **The kinds:** pages (by URL), templates (each with its pages), layouts, template engines, filters (yours and ssqch's), transforms, data files and data functions, collections, and `beforeBuild` and `afterBuild` hooks. Each lists the ten that took the most time in total, with how many calls (or pages, or renders) that was.
- **A call's time includes the calls it makes**, from the moment it starts until it returns, or until its promise settles. A template engine's time has its filters' in it, and a page's has its layouts' and transforms'.
- **`async`** marks a function with a call that returned a promise (`htmlToAbsoluteUrls (65, async)`). It's timed until the promise settles, and calls that ran at the same time overlap, so its total can add up to more than the build took: look at the others first.
- **`--format json`** has every one, under `profile`: `pages`, `templates`, `layouts`, `engines`, `filters`, `transforms`, `data`, `collections` and `hooks`, each a list of `{ "name", "calls", "ms", "async" }`, slowest first. A build without `--profile` has no `profile`.
- **What it costs:** a little time per call, for the timing itself. Leave it off for the builds you ship.

Without `--profile`, a build still times your own filters, transforms and collections (not ssqch's), one call at a time, because they run for every page: a second each is minutes on a big site. One that takes a second or more is a `slow-call` warning at the end of the build, with where the function came from and the first page it was slow on: `transform \`squeeze\` (from ssqch.config.js) took 1.1 s working on src/b.md, the first of 2 calls that took over a second`. The time a call spends waiting on `image()` to encode a picture is ssqch's, so a filter that asks for another crop isn't slow on a cold build; `--profile` still counts it in the filter's time. Data functions and hooks run once a build, and a slow one (a `fetch`, Pagefind) is often the point, so they're no warning; `--profile` times them.
