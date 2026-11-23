---
title: "A build's footprint"
description: "ssqch footprint says how much the last build weighs, by kind of file, and which pages and files leave the largest footprints."
---
`ssqch footprint` says how much the last build weighs, by kind of file, and which pages and files leave the largest footprints:

```text
$ ssqch footprint
Footprint of dist: 4,965 files, 302 MB
  Pages             163 files  6.91 MB  2%
  Images          4,782 files   291 MB  96%
  CSS                 1 file   58.2 KB  <1%
  JavaScript          2 files  7.61 KB  <1%
  Fonts               9 files   708 KB  <1%

Largest footprints: pages
   108 KB  /build-a-secure-node-js-application-with-javascript-async-await-using-hapi/
   104 KB  /avatars/

Largest footprints: other files
  3.15 MB  /static/job-hunt-ai-cheat-sheet.pdf
  2.10 MB  /img/ElD54Br0Nm-1200.png
```

It reads the site's output folder, or any build folder you name (`ssqch footprint dist-before`), so build first. `--top 20` lists more of the heaviest (0 for none), and `--format json` gives the same as data: `files`, `bytes`, `kinds` and `largest.pages` and `largest.files`, each with its `path` and `bytes`.

To keep a site light, give the config `budgets`. Every build then checks the output against them, after plugins like `assetsPlugin()` have run, and warns about whatever is over: `warn: 2 pages are over the pages budget of 100 KB: /build-a-secure-node-js-application-with-javascript-async-await-using-hapi/ (108 KB), /avatars/ (104 KB)`.

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch.

To make a budget a rule rather than a reminder, add `fail: true`: `budgets: { pages: "100 KB", images: "500 KB", fail: true }`. Then whatever is over is an error (`error: /avatars/ (104 KB) is over the pages budget of 100 KB`, with the same `over-budget` code in `--format json`), and a production build exits 1, so CI or a host's deploy stops there. A development build (`--env development`) and `ssqch serve` still only warn, as they do for broken links, so you can fix the page while it's open. `fail` must be `true` or `false`.
