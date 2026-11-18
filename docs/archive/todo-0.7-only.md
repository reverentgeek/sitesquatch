# TODO archive: for 0.7.x only

What `TODO.md` listed for 0.7.x until 0.8 shipped, moved here on 2026-11-18 when the switch
removed the Rust implementation from `main` (`docs/node-migration.md`, "The switch"). Each item is
about 0.7's QuickJS runtime, or is something 0.8's move to Node settles. 0.7.x is released from the
`release/0.7` branch; an item that's wanted there is done there. This file isn't updated any more.

---

## Faster JavaScript: an opt-in Node or Bun runtime

Superseded by the move to Node (0.8).

QuickJS is small and starts fast, but it's 10-100x slower than V8 or JavaScriptCore on code that
parses HTML in JavaScript: it copies substrings (`html = html.substring(n)` per token goes
quadratic), and it has no JIT. On a11yproject.com, html-minifier took 66 s for 112 pages (about 240
ms per page; Node 2-3 ms), cheerio's TOC 830 ms (Node about 70 ms), and markdown-it with Prism about
220 ms. On v8.dev (323 pages), markdown-it took about 1.1 s and Prism 0.3 s: 85% of a 1.88 s build
that Eleventy does in 0.70 s. lit.dev (200 KB pages) is the worst case: html-minifier 5,224 ms per
page against 12.6 ms in Node (415x), Lit SSR 15x, cheerio 15x, markdown-it 10x, clean-css 5x,
Nunjucks 6x.

Two routes compete for the same time: a faster runtime, and native features that make the JavaScript
unnecessary. With ssqch's own Markdown and hooks, v8.dev generates in 0.61-0.85 s, and lit.dev's
idiomatic port in 4.2 s. The research should weigh both per site. Per-call IPC costs more than a
QuickJS call (measured 2026-11-10 with the `ejs` package: Bun 22 µs, Node 12 µs, QuickJS 8 µs;
batched 3 µs), and lazy views can't cross a process, so an external runtime pays only for coarse
work: whole passes, or JavaScript that runs long per call.

- [ ] Research first (notes in `research/js-runtimes.md`): where config JavaScript spends its time
      on real sites (the blog, a11yproject.com, v8.dev, lit.dev, Gahlee House, eslint.org), with
      `--profile`. Compare QuickJS with fixes (rope or shared substrings, if upstream or `rquickjs`
      allows), QuickJS-ng, an embedded V8 (`deno_core`/`rusty_v8`: binary size, build time,
      Windows), and an external Node or Bun (the project's own, found on `PATH` or in
      `node_modules/.bin`).
- [ ] Decide the shape. Candidates, coarsest first:
  - A **transform and `afterBuild` worker**: transforms or hooks marked to run in Node or Bun get
    every page at once (or in batches), so html-minifier runs as fast as in Node with no per-call
    cost. a11yproject.com does this by hand (an `afterBuild` hook writes the list, a `run` hook runs
    `scripts/htmlmin.js`), and lit.dev with a helper server.
  - **Config and data files in Node or Bun**: `_data` files and the config's setup run there once
    per build, and values come back as JSON (functions in the config stay in QuickJS, or the whole
    config moves). This is also the answer for packages QuickJS can't load.
  - **Filters and engines in Node or Bun**: `engines.mdit` and heavy filters, batched per render
    pass. A template calling ssqch's Rust functions (`markdown`, `highlight`, `image`) would be a
    round trip each.
  - Something like `js: { runtime: "node" | "bun" | "quickjs" }` (default `quickjs`), per function
    or per file, with a clear error when the runtime isn't installed, and the same output whichever
    runs.
- [ ] Measure each against a11yproject.com (its config has `HTMLMIN=node|quickjs|native`), v8.dev
      (`scripts/bench.py`, and `native-experiment/` for the native route), lit.dev
      (`scripts/bench.sh`) and the blog before building it. The cheapest test of the coarse shape:
      v8.dev's `mdit` engine batched to one Node process per build, against 1.1 s in QuickJS. Keep
      QuickJS the default: no install, and the same output on every machine.

## Node compatibility (QuickJS)

Superseded by the move to Node (0.8): on Node, every Node API and package works.

- [ ] Name the missing Node API (v8 #9): `fs.openSync isn't available in ssqch` instead of QuickJS's
      `not a function`. Add what header readers need: `fs.openSync`, `fstatSync`, `readSync`,
      `closeSync`, `fs.promises.open` with `FileHandle.read`/`close` (image-size, file-type).
- [ ] `punycode` (and `node:punycode`) as a built-in module (v8 #4): markdown-it 13 and older and
      many URL packages require it. Until then the error could say `npm install punycode`.
- [ ] When a package fails to load, name the package that was imported, not the file deep inside it
      (blog #3: `@11ty/eleventy-img` failed as `brotli-size/dist/index.js: cannot read property
      'nodejs.util.promisify.custom'`), and for known Eleventy packages, ssqch's replacement.
- [ ] A working `node:stream` (lit A3): a minimal `Readable`/`PassThrough`/`Writable` (object mode,
      `push`, `write`, `data`/`end` events, async iteration) is enough for fast-glob's async API,
      globby and "stream an array" code. Until then, name fast-glob's async API in the known gaps
      (`fastGlob.sync` works).
- [ ] Named exports of CommonJS modules are found by running the module, not read from the source as
      Node does, so an ES module that imports a side-effect module and then a CommonJS file runs the
      CommonJS file first. Read the names from the source for the plain forms (`exports.x =`,
      `module.exports = { a, b }`, `Object.defineProperty(exports, "x"`), as Node's lexer does, and
      only run the file early when it assigns something else to `module.exports`.
- [ ] Native HTML helpers, `ssqch/html` (a11y #24): `parse(html).queryAll("h2[id]")` with `text()`
      and attributes, `rewriteUrls(html, fn)` (`htmlToAbsoluteUrls`), `headings(html, { tags })`,
      and `toc()` taking an HTML string as well as `page.headings` (it would have replaced
      eleventy-plugin-nesting-toc on two sites; on lit.dev `page.headings` matched 150 of 193
      pages). The native route for the cheerio code in "Faster JavaScript".

## Silent wrong answers that 0.8 settles

From "Silent wrong answers": on Node, `templateContent` renders on demand, YAML is read as js-yaml
reads it, and `Date` and `Intl` are Node's own.

- [ ] **Reading the `templateContent` of a page that hasn't rendered yet** gives an empty string
      (a11y #17). Render it on demand, or order the passes from the reads; at least warn, naming
      both pages.
- [ ] **YAML timestamps as Dates in every key**, as js-yaml does (a11y #11; v8.dev's `updated:` and
      lit.dev's `publishDate` printed `Invalid DateTime`). At least warn when a date-looking string
      reaches a date filter.
  - `Date#toString()` leaves out the zone's name (`GMT-0500` without ` (Eastern Standard Time)`;
    a11y #13, lit A6, both worked around in their configs), and `Intl.DateTimeFormat` has no
    `timeZoneName` and `resolvedOptions().timeZone` is `undefined`.
  - `Intl.DateTimeFormat` ignores options that don't exist, as ECMA-402 and Node do (a11y #8: a
    misspelled `timezone` threw). Keep refusing a known option ssqch can't honor.
