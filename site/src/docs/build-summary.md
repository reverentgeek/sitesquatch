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

- **The first line** is `First confirmed siting. Built in ...` for a site's first build (there's no `.cache/ssqch/output-files.json` yet), which is every build on a CI machine that doesn't keep `.cache`.
- **Pages** also says what's different from the last build to that folder: `(2 new, 1 gone)` when a page appeared or stopped being written (a post you added, a permalink you changed), and `(3 changed)` in `ssqch serve`, which leaves a page alone when it comes out the same.
- **Drafts** is in production builds that left `draft: true` pages out: `Drafts  3 unconfirmed (built in development only)`, or `3 left out` when the report's themed line is another one.
- **Removed** is the stale files `leaveNoTrace` deleted: `Removed  2 stale files, left no trace`, or just `2 stale files`.
- **One themed line at most:** a report says one thing in the ranger's voice, the one that matters most (in this order: nothing to build, a first build, files removed, drafts, unused templates), and says the rest plainly.
- **Images** counts the image files this build used, the source images they came from, and how many had to be encoded. With `prune` on, it also says how many stale files it deleted.
- **Output** is everything in the output folder, including files left from earlier builds.
- **Time** splits the build into phases. `write` includes layouts, transforms and image encoding, so a build that encodes images spends most of its time there. `after` is the `afterBuild` hooks.

With `--verbose`, a line under the summary names the templates in the includes folder that nothing used as a layout, an include or a component in this build: `Uninhabited: 1 template that nothing used in this build (src/_includes/cabin.jinja).` (`Unused:` when the report's themed line is another one.) It covers every template language: Jinja, Nunjucks, Edge, Liquid, Handlebars, Mustache and EJS.

`ssqch serve` prints the same summary after every rebuild.
