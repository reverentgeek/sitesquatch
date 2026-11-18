# TODO

The ReverentGeek blog (`../blog`) is the main real-world site. Its own tasks are in
`../blog/TODO.md`. Items here that the blog is waiting on say **Blog:**, and blog items that need a
change here say **Needs ssqch:**. When one side finishes, tick it and update the other list.

The current release is 0.7.0 (2026-11-17; `CHANGELOG.md` has every release). Work goes to `main`.
The blog builds with the npm package, pinned exactly.

Finished work, and the reasons and measurements behind it, are in `docs/archive/todo-2026-11-17.md`
(everything up to 0.7.0) and the changelog. When a section here is done, move it to the archive
rather than letting ticked items pile up.

## The move to Node (decided 2026-11-17)

ssqch becomes a TypeScript program on Node, using the JavaScript libraries themselves for templates
and front matter, with Rust plugins as `.wasm` files. The plan, the decisions and how to
run the work with coding agents are in `docs/node-migration.md`; the study and the two spikes are in
`research/architecture/` (`round-3-spikes.md`). Why: a spike core builds 10,000 pages in 1.30 s on
one thread (0.7.0: 1.15 s on 15 cores; Eleventy 7.78 s) and v8.dev's exact port in 0.54 s from its
unchanged config (0.7.0: 1.72 s), byte-identical; Node runs all 21 tools the next migrations bring
(QuickJS runs 4); and a Rust core under Node added 0.2 s or less except on heavy transforms. The
contract (`ssqch.d.ts`, commands, JSON reports, diagnostic codes, the voice) doesn't change. The
release is 0.8.0, "Breaking" in full; 0.7.x gets fixes until then.

This replaces "2. Faster JavaScript" and "Node compatibility (QuickJS)" below, and the parked Linux
ARM builds, and it settles several "Silent wrong answers" (YAML dates as js-yaml makes them, `Date`
and `Intl` time zones, `templateContent` read before its page renders). Those stay listed for 0.7.x
until 0.8 ships.

- [x] **Stage 0, gates** (2026-11-17; results in `docs/node-migration.md`, "Stage 0 results"): G2
      passes (the blog byte-identical on Node 22.18.0, 22.23, 24 and 26 and in three time zones);
      G3 passes on size (sharp's AVIF 16% smaller at equal SSIMULACRA2) and takes 1.2 times
      ssqch's time; G4 fails (minijinja-js 4.8 to 5.4 times Nunjucks with ssqch's escaping); G5
      passes (128 of 128 of the blog's Markdown files byte-identical as `.wasm`).
- [x] **For stage 2, from G2** (2026-11-17): JSON imports without `with { type: "json" }` (the
      module hook adds the attribute), folder data's `"tags": "posts"` joined with a page's own
      `tags`, and the oracle on the lowest supported Node too (CI runs the Node build on 22.18.0,
      24 and 26).
- [x] **For stage 3, from G2 and G5** (2026-11-17): edge.js templates kept by file and includes
      by file and scope; render hooks, containers, `headingIds` functions and custom
      highlighters call back from the Markdown `.wasm` through synchronous imports (its own
      interface, not ABI v1); highlighted fences cached in the `.wasm` across a process's
      builds. A cache on disk is below.
- [ ] **Decide** D1 to D7 in `docs/node-migration.md`: the default template language, ssqch's
      Markdown and highlighter as `.wasm` or markdown-it, the minifier, images, the lowest Node
      version (22.18 proposed), the version and the last Rust release, the standalone executable.
- [x] **Stage 1, the oracle** (`tests/oracle/`, 2026-11-17): `cli.rs`, `plugins.rs`,
      `examples.rs` and the `sitesquatch-js` and `sitesquatch-edge` suites as 132 black-box tests
      run against `SSQCH_BIN`; the diagnostic codes and every JSON document's shape as contract
      tests; 0.7.0's output frozen for the 10 example builds, the 12 starters, the blog,
      a11yproject.com and v8.dev. 180 pass on 0.7.0 in 24 s; 4 skipped (below).
- [x] The oracle in CI on Linux, macOS and Windows (`ci.yml`, after `cargo test`, on Node
      22.18.0). First run on `0a6c172`: 177 pass on Linux and macOS, 172 on Windows (5 more are
      unix only), none fail; the blog and trial ports skip there, being outside the repository.
- [ ] Freeze lit.dev (`node freeze.js trial-lit.dev`): its exact port's `beforeBuild` helper needs
      lit.dev's own SSR build (`rollupout/server/ssr.js`), which the trial checkout doesn't have.
- [x] Three oracle tests skipped because they needed the Rust API (a `BuiltinPlugin` registered
      from Rust, `JsModule` native functions). They test 0.8's Rust plugins now (2026-11-18), with
      `examples/rust-plugin`: a plugin made from its options whose filter reads them, the
      refusals (a file that isn't a plugin, another ABI, unknown options), and Rust functions
      called with values from templates. 0.7 skips them; an unknown built-in's message is checked
      on both.
- [x] `cli/aliases.test.js` holds a copy of the equivalents table (57 rows from
      `equivalents.rs`), since the oracle may not import ssqch's code. The table is in TypeScript
      now (`packages/ssqch/src/equivalents.ts`), and `equivalents.test.ts` fails when the three
      copies differ.
- [x] `AGENTS.md`: a section for `packages/ssqch/` (commands, `node --test`, `tsc --noEmit`,
      conventions) before stage 2.
- [x] **Stage 2, the core** in `packages/ssqch/`, from the spike core (2026-11-17; the results
      are in `docs/node-migration.md`, "Stage 2, so far").
  - [x] Config and validation (`config.ts`: 0.7's checks and messages, aliases, plugins as parts of
        config, `sitesquatch.toml`), the `ssqch` module, the module hook, errors from a site's
        JavaScript with its own file and line.
  - [x] Data files, front matter (YAML, TOML, JSON), the cascade with the layers `inspect` needs,
        computed data, pagination, permalinks, collections, layouts, drafts, themes, bundles,
        `lastModified`, transforms, hooks (functions and commands), passthrough with links,
        conflicts, `base`, `leaveNoTrace`, the summary, `--format json`, diagnostics (`locate`,
        `code_for`, frames), the voice, the command line (0.7's flags, aliases and refusals).
  - [x] `templateContent` rendered on demand, and pages written as they render through a queue
        with back-pressure.
  - [x] The benchmark (`packages/ssqch/bench/bench.ts`): 10,000 pages in 1.41 s on one thread
        (0.7.0: 2.67 s on one thread; the limit is 2 s), 370 MB, the output byte-identical to
        0.7.0's; v8.dev in 0.57 s (the limit is 0.72 s). Those are times on the laptop the limits
        were set on. CI's `node-benchmark` job compares instead: a commit against its parent on
        the same runner, failing above 15% slower. (Its first run timed the Node build at 3.75 s
        and 0.7.0 at 3.42 s on one thread on a Linux runner, so a limit taken from 0.7's time
        doesn't travel either.)
  - [x] The oracle against the Node build: `node progress.js` in `tests/oracle/` runs it and holds
        the build to `node-passing.txt` (61 of 184 today, the same on Node 22.18.0, 24 and 26,
        v8.dev's frozen site among them). Each stage adds to the list.
  - [x] **Windows** (2026-11-17): CI's `node` job passes there on Node 22.18.0, 24 and 26, and
        fails the workflow like the others. Its first runs found real paths that Node spells
        differently from the system (a folder's short name in the temporary folder), edge.js
        ending lines with `\r\n`, and three places where Node on Windows is Windows' own
        (`node:path`, `__dirname`, a missing file's error), which the oracle and the changelog
        record. 58 of the list's tests run there; the others are unix-only or need a site
        that isn't in the repository.
  - [x] The navigation functions (`navTree`, `navPager`, `navBreadcrumbs`, `pagesTree`):
        `nav.ts`, from `nav.rs` with its tests; the same answers as 0.7.0 on a site that uses all
        four.
  - [x] Worker threads: left out for now (decided 2026-11-17; "Parked" has why, and what
        they'd need).
  - [x] An independent review of the core against the Rust (a fresh agent, reading both and
        building about 30 small sites with each): 17 differences, fixed or recorded
        (`docs/node-migration.md`, "Stage 2, so far"). It didn't read `args.ts` beyond the lines
        it ran, `modules.ts`, `api.ts`, `content.ts` or the engines; review those with stage 3.
  - [x] Stage 3 replaced the stand-ins the core was run and measured with (markdown-it, edge.js
        called plainly, nunjucks as published).
- [ ] **Stage 3, engines:** Nunjucks or Jinja (D1), liquidjs, edge.js, handlebars, mustache, ejs;
      Markdown (D2); front matter in YAML, TOML and JSON; async filters. Started 2026-11-17 as
      four ports in parallel worktrees; the results are in `docs/node-migration.md` ("Stage 3,
      so far").
  - [x] Markdown (D2): 0.7's `markdown.rs` and `highlight.rs`, unchanged, as
        `packages/ssqch/wasm/markdown.wasm` (3.76 MB, committed; `crates/ssqch-markdown/`,
        rebuilt by `node packages/ssqch/scripts/build-wasm.ts`, and a unit test fails when it's
        older than its Rust). The blog's 128 Markdown files are byte-identical to 0.7's on Node
        22.18, 24 and 26; 3.5 to 3.9 times markdown-it's speed. markdown-it left the package.
  - [x] Jinja and Nunjucks (D1) on ssqch's fork, `packages/ssqch/vendor/nunjucks/` (3.2.4 as
        published, then about 60 lines: errors with their lines, `for` over an object's keys,
        `set ns.x`). `.njk` and `.jinja` keep 0.7's two flavors. What MiniJinja did that
        Nunjucks doesn't is in the changelog.
  - [x] Edge on edge.js with its parser hooked for what 0.7's own Edge did; async as 0.7
        awaited it; includes kept by file. A 3,000-page Edge site builds in 405 ms (0.7 on one
        thread: 738 ms).
  - [x] Liquid (liquidjs 10.30.1, with 0.7's filters and a port of its `strftime`), Handlebars
        and Mustache (handlebars.js 4.7.10, as 0.7 used one engine for both), EJS (ejs 3.1.10).
        Their libraries load with their first template.
  - [x] Front matter: 24 unusual cases built with both; TOML's integers past 2^53 fixed, and
        js-yaml's numbers and merge keys and smol-toml's milliseconds recorded
        (`cli/front-matter.test.js`).
  - [x] Node 22.18 gave CommonJS modules no `require.cache` while ssqch's `load` hook was
        registered (fixed in 22.23); the hook is gone, and a11yproject.com builds there.
  - [x] The oracle: 96 of 196 on Node 22.18, 24 and 26 (61 before), a11yproject.com's frozen
        site and the review's new tests among them. The benchmark, alone on the laptop: 10,000
        pages in 1.14 s on one thread, 366 MB (1.42 s before the stage; the limit is 2 s);
        v8.dev in 0.58 s (0.72 s).
  - [x] An independent review (two fresh agents, reading the ports beside the Rust and building
        small sites with both builds, under three time zones and on three Node versions), with
        `args.ts`, `modules.ts`, `api.ts` and `content.ts`, which stage 2's review left: 36
        findings, fixed by the agents that wrote each port or recorded in the changelog. The
        worst gave wrong output with no warning: async functions called as functions printed
        `[object Promise]` in Jinja; empty lists were true; `~`, tuples and `==` were
        JavaScript's; dates in Edge and in Liquid's own filters followed the machine's time zone;
        an async function made Liquid and Handlebars run every other function twice; a site's
        `set site.title` changed it for every later page. Also: EJS includes went from 1.68 s
        to 0.36 s on 2,000 pages of 20 (0.7: 1.47 s), and YAML dates before the year 100 keep
        their century.
  - [ ] Every example site and the starters, the stage's "done when": they wait for stage 5's
        plugins (all eight examples use `ssqch/links`) and stage 4's `init`. Built with the
        plugins taken out of both builds' copies, the 12 starters match 0.7 except the version in
        their footers, and so do all eight examples (the six in Jinja and Nunjucks, and
        `component-docs` and `reference-pages` in Handlebars).
  - [x] Decided 2026-11-17: Edge's `safe()` prints raw HTML, as edge.js's `html.safe` does;
        `.njk` prints as Nunjucks does (`true`, `a,b`, a compact `dump`), as a site from Eleventy
        expects, until someone reports otherwise, while `.jinja` keeps Jinja's printing; tags
        from functions work in `.jinja` too; Liquid's `split: ""` and two-item
        `array_to_sentence_string` follow Shopify and Jekyll instead of 0.7; Nunjucks' `random`
        filter stays random.
  - [ ] A cache of highlighted fences on disk (`.cache/ssqch/`, keyed by the `.wasm`'s inputs):
        a process's first build of the blog spends about 0.3 s compiling syntect's grammars.
  - [x] Stage 8 ships `wasm/markdown.wasm` in the package (the loader finds it next to `src/`).
  - [x] The README's Edge, Jinja and Nunjucks, Liquid, Handlebars and EJS sections describe 0.8
        (2026-11-18).
- [ ] **Stage 4, checks and tools:** schemas and `types`, links, `diff`, `inspect`, footprint and
      budgets, `docs`, `new`, `init` and the starters, `capabilities`.
  - [x] Content schemas (`schema.ts`), `inspect`, `diff` and footprint with budgets (2026-11-18),
        with 0.7's messages and reports: 27 broken schemas, 35 `inspect` cases, the footprint and
        budget cases and 240 random pairs of builds give 0.7's output through the binary. `diff`
        ports what 0.7 diffed with, the `similar` crate's Myers (`myers.ts`), so hunks split as
        0.7's do. On two builds of the 10,000-page site it takes 0.44 s (0.7.0: 0.5 s on every
        core) at 150 MB; with every page changed, 2.1 s on one thread, where 0.7.0 takes 0.7 s on
        15 cores. Worker threads for the comparison would close that, if wanted (no site code runs
        in `diff`). `cli/report.test.js` and the shapes of the build, inspect, diff and footprint
        reports wait for `ssqch/links`; they pass with the plugin taken out of their sites.
- [ ] **Stage 5, plugins:** images (D4), rss, minify (D3), assets, sitemap, redirects, Sass,
      elements, themes; the Rust plugin SDK (`ssqch-plugin` crate, the `.wasm` loader, an example,
      and docs on when a Rust plugin pays).
  - [x] minify (D3): 0.7's `plugins/minify` compiled by path into `crates/ssqch-minify`, an ABI v1
        plugin committed as `wasm/minify.wasm` (0.2 MB). The 12 starters' production builds
        (without images) and the blog's 169 pages minified by both are 0.7's bytes.
  - [x] Sass: grass at 0.7's version as `wasm/sass.wasm` (`crates/ssqch-sass`, 2 MB), reading
        files through Node. 0.7's bytes for the oracle's, component-docs' and eslint.org's 47
        stylesheets in both styles; Dart Sass differs on 15 of eslint.org's 43 compressed.
        `filesRead(config)` (`src/plugin-files.ts`) lists what the last build read, for stage 6.
  - [x] The Rust plugin SDK: `crates/ssqch-plugin` (ABI v1, `publish = false` until 0.8.0's
        release), `src/rust-plugin.ts` (a config's `{ name, rust: { wasm, options } }`), and
        `examples/rust-plugin` (trail-guide: an engine, three filters and a transform),
        committed built. `docs/rust-plugins.md` is the README section's draft, for stage 9.
  - [x] Rust plugins are in the README ("Plugins in Rust", `ssqch docs plugin sdk`), and
        `ssqch.d.ts` has `RustPlugin` in the `Plugin` type (2026-11-18).
  - [ ] Publish `ssqch-plugin` to crates.io with 0.8.0, and the example's npm package if it's to
        be installable.
  - [x] Images on sharp 0.35.5 and assets (2026-11-18), with 0.7's names (BLAKE3 in TypeScript),
        so a site's image cache and asset URLs carry over: a copy of the blog with its cache
        builds its 4,985 image files byte for byte as frozen. The quality options keep 0.7's
        numbers, turned into sharp's from a calibration at equal SSIMULACRA2
        (`src/image/quality.ts`); a cold build of the blog's images takes 28 s (0.7: 68 s) and
        makes 7% fewer bytes. `files(pattern, { dimensions: true })` reads sizes too.
  - [x] Documented in the README (2026-11-18): the quality numbers are 0.7's scale on sharp,
        AVIF needs no feature now, and `[ssqch] Encoded` lines come while pages render.
- [ ] **Stage 6, the dev server.** Started 2026-11-18; the results are in
      `docs/node-migration.md` ("Stage 6, so far").
  - [x] `ssqch serve` (`packages/ssqch/src/serve/`), from `serve.rs` and `companions.rs`:
        watching, rebuilding, what browsers hear (a page reloads for its own change, a
        stylesheet is swapped), a failed build over the page, the 404 page and the tab icon,
        `--ready-file`, `--port`, `--built` and `preview`, `serve.run`'s tools (started, waited
        for, started again), and the voice's lines. Checked in Chromium.
  - [x] A changed config is read again by a new process, not from a bundled copy: the build runs
        in a process of its own, which the server starts again when the config, a module it
        imports, a JavaScript data file or a module that imports changes. That fixes what stage
        3's review found (`importFile` imports a changed file fresh but not the modules it
        imports, so a filter in the config's `./lib/filters.js`, as the blog has, stayed the old
        one), for CommonJS files too, which a new URL doesn't reload.
  - [x] Watching with `node:fs` alone: one watcher for a tree on macOS and Windows, one for each
        folder on Linux (without `node_modules`, `.git` and `.cache`). No dependency.
  - [x] A rebuild keeps what each page's file held when it was last compared, and doesn't read
        it again. Without its plugins the blog rebuilds in 95 ms after one edit (0.7: 175 ms).
  - [ ] The blog as it is rebuilds in 0.31 s after one edit (0.7: 0.23 s). A fifth of that is
        `stat` calls from the image plugin and the link checker, which ask the disk about every
        file they know on every build: what they found can be kept from one build to the next
        while serving, as the page comparison is now.
  - [x] What a plugin read for the last build is watched too (`filesRead` in
        `src/plugin-files.ts`, which `ssqch/sass` fills), besides what it lists in the config's
        `watch`: a partial in a folder the config never named rebuilds the site.
  - [x] The oracle: all ten tests in `cli/serve.test.js` and `cli/serve-browser.test.js`, and
        "serve ready file", on Node 22.18, 24 and 26, with stage 5's plugins merged in (four of
        the tests' configs use one).
  - [ ] **Decide:** a rebuild of 10,000 pages takes 0.97 s after one edit, twice 0.7's (which
        used every core). Worker threads, or rendering only the pages an edit can reach, would
        change that; the second needs the plugins that count across pages to take part. Both
        are described in "Stage 6, so far".
  - [ ] The server spends about 60 ms of its start loading the build's modules, which only the
        process that builds uses (`cli.ts` imports `build.ts`, and so every engine). Import
        them when a command needs them, once the stages that add commands to `cli.ts` have
        merged. Starting to serve a one-page site takes 0.26 s (0.7: 0.07 s).
  - [ ] Windows and Linux: the server's own unit tests run both ways of watching on each, but
        the oracle's serve tests have only run on macOS. Watch CI's first run.
- [x] **Stage 7, importers:** Eleventy and Zola (2026-11-18): `src/import.ts`, from `import.rs`
      with its tests. 0.7's importer reads a site's files as text and runs none of them, so it had
      nothing for QuickJS to drop. On the Eleventy sources of a11yproject.com, v8.dev, lit.dev,
      Gahlee House, eslint.org and the blog's trial, and on the Rust blog's Zola source (776
      edits), the dry run prints what 0.7's prints and `--write` writes the same files (but the
      version). The drafts then build as 0.7's do: Gahlee House with no differences, the others
      stopping at what the list leaves by hand (a missing `},` in a11yproject.com's `team.json`,
      v8.dev's `slug`, lit.dev's `LITDEV_ENV`). The oracle's 3 import tests pass on Node 22.18,
      24 and 26.
- [ ] **Stage 8, distribution:** the compiled, bundled npm package (sharp its only dependency), the
      standalone executable (D7) for Homebrew and the install script, `setup-ssqch`, Netlify; retire
      `dist` and the binary-only release steps; CI installs the packed tarball.
  - [x] The npm package (`scripts/build.ts`), the standalone executable (`scripts/build-sea.ts`,
        D7 decided: Node's single executable, unpacking the package on its first run), and their
        check (`scripts/check-package.ts`), which builds every example, a starter and a site with
        images, Markdown, minify, Sass and a Rust plugin to the source's bytes, and runs the
        oracle's list (2026-11-18). `release.yml` written by hand, with `notarize.yml`,
        `check-ci.yml` and `publish-npm.yml` for one package; the installers
        (`scripts/install.sh`, `install.ps1`); CI's `package` and `standalone` jobs. dist, the npm
        wrapper and the platform packages are gone. `docs/node-migration.md` ("Stage 8") has the
        numbers.
  - [ ] Watch the first runs on Linux and Windows: the executable and the package were checked on
        macOS only. Windows: whether `--build-sea` leaves Node's Authenticode signature invalid
        (then strip it before building, or sign), and long paths in the unpack folder.
  - [ ] A pull request that touches `release.yml` (it runs the release unsigned) before the first
        tag, and the first notarization of a Node executable: the entitlements in
        `scripts/sea-entitlements.plist` are Node's own, untried with the notary service here.
  - [ ] `setup-ssqch` for 0.8: the branch `ssqch-0.8` in `../setup-ssqch` (Linux's target is
        `x86_64-unknown-linux-gnu` from 0.8), merged and tagged once 0.8.0 is out.
  - [ ] Release the last 0.7.x from `release/0.7` before 0.8.0 (`docs/node-migration.md`, "One
        last 0.7.x"), then deprecate the `@ssqch/<platform>` packages after 0.8.0 (`AGENTS.md`).
  - [x] Stage 9: the README's Install, Netlify and GitHub Pages sections, and `ssqch docs
        standalone` (the unpack folder, `SSQCH_UNPACK_DIR`, glibc); `import "ssqch"` from plain
        Node works (2026-11-18). The version numbers in them are for the release step.
  - [ ] A Linux arm64 executable (`ubuntu-24.04-arm`) and a musl one (Node's unofficial musl
        builds), so Alpine and ARM servers have the executable too. The npm package covers both
        today.
- [ ] **Stage 9, Blog:** move the blog, then the examples, starters and trial ports; the README,
      trailheads, changelog and benchmarks; `AGENTS.md` for the TypeScript codebase. Release 0.8.0.

## How this list works

**Now** is what to work on next, in order. **Next** follows it. The **Backlog** is grouped by area,
roughly most useful first within each. **Parked** holds ideas that were decided against or wait for
someone to ask, so the decision is on record.

Items name their evidence in parentheses: the site that found the problem and its number in that
move's notes.

| Tag | Move | Notes |
| --- | --- | --- |
| `a11y #n` | a11yproject.com (Eleventy 1.0, byte-identical, 0.6.3) | `../trials/a11yproject.com/ssqch-case-study/` |
| `blog #n` | The ReverentGeek blog, again from its last Eleventy commit (0.6.4) | `../trials/reverentgeek-blog-ssqch-migration-notes.md` |
| `v8 #n` | v8.dev (Eleventy 3.1.8, 323 pages, 0.6.4) | `../trials/v8.dev/ssqch-case-study/` |
| `lit X#` | lit.dev (Eleventy 2.0.1, 332 pages, 0.6.4) | `../trials/lit.dev/ssqch-case-study/` |
| Gahlee | Gahlee House (Eleventy 3.1.8, 0.6.2) | `../gahlee` |

What the moves agree on: the importer and `ssqch diff` do their jobs, and the costly problems are
silent ones (output that's wrong with no warning) and slow JavaScript. lit.dev's verdict was "don't
move yet": byte parity needed Eleventy's libraries, a Node helper and Chromium, and was slower than
Eleventy (32.9 s against 24.9 s), while ssqch's own features built the site in 4.2 s but without
Lit's server rendering or the site's highlighting styles.

## Now

### 1. Profiling

- [ ] **`ssqch build --profile`:** time per config filter, transform, engine and data file (calls
      and total), per template and per page, and layouts apart from writing. The same numbers in
      `ssqch build --format json` (`timings.filters`, `timings.transforms`, `timings.engines`).
      Every move found its slow code by wrapping functions by hand: the summary's `write 1.42 s` was
      layout filters, `toc` (830 ms) and `eleventyNavigation` (550 ms) (a11y #28); lit.dev's first
      build took 9 min 8 s and `write 23 s` named nothing (lit A5).
- [ ] **A warning when one JavaScript call takes over a second**, naming the function and the
      package it's from (lit A5: html-minifier, 5.2 s per page).
- [ ] Document both, and use them to measure the sites in "Faster JavaScript" below.

### 2. Faster JavaScript: an opt-in Node or Bun runtime

Superseded by "The move to Node" above. Kept for 0.7.x until 0.8 ships.

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

### 3. Silent wrong answers

Each of these built a site that was wrong in a way nothing reported. Fix the behavior where it's
clear; otherwise warn.

- [ ] **`computed` sees `collections`** (lit B4: the learn page lists `data.collections.articles` in
      `eleventyComputed`). Evaluate computed values that read `collections` after collections are
      built (Eleventy passes collections built without the computed values), or at least an error
      that says computed can't see them.
- [ ] **A computed `layout` that depends on the page** (lit B3): it's refused since 0.7.0; resolve
      the layout chain after `computed` instead.
- [ ] **Reading the `templateContent` of a page that hasn't rendered yet** gives an empty string
      (a11y #17). Render it on demand, or order the passes from the reads; at least warn, naming
      both pages.
- [ ] **YAML timestamps as Dates in every key**, as js-yaml does (a11y #11; v8.dev's `updated:` and
      lit.dev's `publishDate` printed `Invalid DateTime`). At least warn when a date-looking string
      reaches a date filter.
- [ ] **Dates and time zones:**
  - `Date#toString()` leaves out the zone's name (`GMT-0500` without ` (Eastern Standard Time)`;
    a11y #13, lit A6, both worked around in their configs), and `Intl.DateTimeFormat` has no
    `timeZoneName` and `resolvedOptions().timeZone` is `undefined`.
  - A time zone for the build's JavaScript and date filters (`timeZone: "UTC"`): 137 of v8.dev's
    pages differ between a laptop in EST and CI in UTC (v8 C11).
  - A fixed date for undated pages (`dateFallback: "git"`), so their order and `<lastmod>` don't
    depend on when a checkout wrote the files: every move's sitemap changed with file times (v8 C9).
    Maybe `date: "created"` too (a11y #22).
  - `Intl.DateTimeFormat` ignores options that don't exist, as ECMA-402 and Node do (a11y #8: a
    misspelled `timezone` threw). Keep refusing a known option ssqch can't honor.
- [ ] **The `url` filter on a non-string** (a11y #16: `false` from a `permalink: false` page printed
      `/false` in the sitemap): normalize as Eleventy does, or warn.
- [ ] **Two passthrough sources that write one file** (v8 #19): warn unless they're identical.
- [ ] **`minify()` shortens `checked="checked"` with `shortenAttributes: false`** (a11y #24): make
      it part of that option, or document that boolean attributes are always shortened.

### 4. One Markdown engine

Keeping a site's markdown-it is how a big move gets identical output first (the Eleventy trailhead's
"Moving with identical output first"), and today it takes a custom engine, `render` chains and
guesswork.

- [ ] **Replace the Markdown engine once** (`engines.md`, or `markdown: { render }`) instead of a
      custom engine plus `render` in every folder's data (a11y #12). v8.dev changed nine content
      files for it, because `render` from a folder's data reaches its `.njk` pages too; lit.dev put
      `render` in the config's global `data`. Then `ssqch import eleventy` can carry
      `setLibrary("md", ...)` over as written.
- [ ] **Custom engines get context** (lit B8): a third argument, `{ kind: "body" | "layout" |
      "permalink" | "computed", path }`. lit.dev's engine guessed (`data.page.url` undefined meant a
      front matter string; layouts found by matching their body).
- [ ] **Permalinks render with the first template language in the chain** (or `markdownEngine`),
      never a Markdown renderer or a custom engine that isn't one (v8 #6: `<p>/blog/tags/{{ tag |
      slug }}/</p>`). Say so when a permalink still has `{{`/`{%` or starts with `<p>` after
      rendering.
- [ ] **Cache a custom engine's output by source** (`engines: { mdit: { render, cache: true } }`):
      v8.dev's serve rebuild went from 1.8 s to 0.28 s with a cache in its config.
- [ ] Document `data: { render: "x" }` in the README as the one-line way to send every page through
      an engine (lit B9), until the first item lands; then the trailhead's "Keeping markdown-it"
      gets shorter.

## Next

### 5. The migration loop

All four moves ran the same loop by hand: build with Eleventy from a fresh copy, build with ssqch,
diff, fix the biggest group, repeat.

- [ ] **`ssqch diff` for migrations** (blog #8, v8 C10: for the blog it was about 25,000 lines of
      serialization noise for 161 pages):
  - Treat as equal what browsers treat as equal: attribute order, `defer` and `defer="defer"`,
    `<path/>` and `<path></path>`, spacing in `srcset` and `sizes`, `'` and `&#39;` in an `id` (v8
    #23: "links to them break").
  - Recognize eleventy-img names (`/img/<10 chars>-<width>.<ext>`) as it does 8-hex fingerprints,
    and `imagePlugin()`'s.
  - Compare a feed's escaped `<content>` as HTML, and say "same entries in another order" for
    reordered XML and lists. Call out changed canonical links, redirects and feed entries the way
    titles and `id`s are.
  - `--exclude` (the blog needed nine `--only`s), and `--format json` with a kind per change
    (`order`, `dates`, `entities`, `whitespace`, `content`) for agents (v8 F4).
  - Compare symlinks by target (it follows them; lit.dev's output has 33 links whose targets
    matter).
  - Say in its first line that the default ignores blank lines and leading whitespace, so a
    byte-for-byte check needs `--exact` (lit B7 hid behind it).
- [ ] **`ssqch import eleventy --verify`** (or `--compare`): build with the project's own Eleventy
      into a fresh copy (`TZ=UTC`, files written in checkout order, as `git archive` gives), build
      with ssqch, and run `ssqch diff`. It's what tells a person or an agent the move is done
      (v8.dev's `scripts/parity.sh`).
- [ ] **A stability check**: build N times and report the files that vary and the most common
      variant (`ssqch diff --runs`, or a command). Eleventy's lit.dev output differs on 11 pages
      between builds, and finding the target took 20 builds and `scripts/stability.py`.
- [ ] **A migration recipe for agents** in `ssqch docs agents` and the trailhead (a11y's
      `ssqch-improvements.md` has a draft checklist; v8 F6): baseline with `TZ=UTC` from fresh
      copies, `ssqch diff`, fix the largest group, repeat, finish with `--exact`.

### 6. Output that matches what sites already style

- [ ] **Highlighting with another highlighter's classes:** `markdown: { highlight: { classes:
      "prism" } }` (Prism's `token keyword` classes, `language-x` on `<pre>` and `<code>`, line
      marks and `lineSeparator`), or a class map for others (CodeMirror's `tok-keyword`), so a site
      keeps its theme's CSS. Most Eleventy sites with code use the syntax-highlight plugin (v8 B3);
      lit.dev's CSS styles CodeMirror's classes (263 pages). Then the importer can map the plugin
      exactly, and a `class="highlight"` on fences with no grammar could come along.
- [ ] **Minifying like html-minifier(-terser):** its common options (`removeOptionalTags`,
      `removeAttributeQuotes`, `collapseBooleanAttributes`, `decodeEntities`, `sortAttributes`,
      inline CSS and JS; v8 C3: 1.1 s of a 3.5 s build), closing unclosed elements, the viewport
      `<meta>` (`initial-scale=1.0` becomes `1`: 309 lit.dev pages differ only in that) and `class`
      whitespace (a11y #24). Or document each difference.
- [ ] **CSS minifying for inline CSS** (`minifyCss()`; grass already writes compressed CSS): lit.dev
      inlines 30-60 KB per page (234 pages). With it, XML and JSON minifying (v8 C4: feeds,
      manifests).
- [ ] **markdown-it's habits as options:** `markdown.breaks` (a single newline becomes `<br>`, in
      lists and every other block; 374 on a11yproject.com, 24 pages on v8.dev; a11y #12, #25),
      `markdown.autolinks: "fuzzy"` for bare domains like `linkify` (a11y #25), and implicit figures
      (an image alone in a paragraph becomes `<figure>` with a caption from its alt text, as
      `markdown: { figures: true }`; 74 v8.dev pages, and a transform can't do it because it doesn't
      reach `templateContent`, v8 #24).

### 7. Importer gaps

- [ ] **Packages that came with `@11ty/eleventy`:** before removing it, find the project's own
      imports (config, data, gulpfile) that resolve only through it (liquidjs, nunjucks, moo,
      gray-matter, markdown-it, luxon, slugify, browser-sync) and add them to `package.json` (a11y
      #19; v8.dev lost `slugify`; lit E6: `videos.js` imports gray-matter).
- [ ] **Follow `eleventyConfig` into helper modules and the site's own plugins** (blog #2:
      `registerSiteFilters(config)` hid 11 filters, 2 collections and a transform; lit D4: a
      monorepo plugin with seven shortcodes and a Markdown highlighter). List their `add*` calls
      with file and line. Since 0.7.0 the list at least says a plugin isn't read.
- [ ] **Find filters templates use that nothing defines** (a11y #5): scan for filter and function
      names, subtract the built-ins and the config's, and name what's left (Eleventy 1.0's `slug`,
      `getPreviousCollectionItem`, `getNextCollectionItem`, `getCollectionItem`, `log`; plugin
      filters such as `eleventyNavigationBreadcrumb`, `rssLastUpdatedDate`, `rssDate`,
      `dateToRfc3339`, `absoluteUrl`, `htmlToAbsoluteUrls`). Write ports of the small ones into the
      draft.
- [ ] **Say what the Markdown setup changes:** name markdown-it options and plugins with no ssqch
      equivalent (`breaks`, `linkify`'s bare domains, `typographer`, markdown-it-anchor) with the
      trailhead's recipe where there is one (a11y #12, #25); what Eleventy does to a
      `setLibrary("md", ...)` library (`md.disable("code")`, ssqch's `indentedCode: false`; the
      syntax-highlight plugin's `lineSeparator: "<br>"`; v8 #3); and the defaults that change markup
      (`markdown: { headingIds: false }` when the site uses markdown-it without markdown-it-anchor,
      380 headings on the blog; what `linkedImages` does; blog #5, #6). Point a configured
      `setLibrary` at "Moving with identical output first".
- [ ] **Scan data files and other modules for Eleventy packages** (blog #3): eleventy-img in a data
      file becomes `image()`/`imageUrl()`, eleventy-fetch becomes `fetch(..., { cache })`.

## Backlog

### Markdown

- [ ] The alt text as HTML in the image hook (`image.altHtml`: links and code in captions, 25 v8.dev
      pages).
- [ ] Attributes on images, links and blocks (`![](a.png){.no-darkening}`, `{#id}` after a
      paragraph), as markdown-it-attrs does; ssqch has them for headings only (3 v8.dev pages).
- [ ] markdown-it-multimd-table's tables (`^^` rowspan, multi-line cells holding code fences), or a
      table and cell hook (3 v8.dev pages).
- [ ] markdown-it's URL normalization (`%` becomes `%25`, as mdurl does; 1 v8.dev page).
- [ ] `markdown(text, { html: false })`: lit.dev's API pages render doc comments with HTML turned
      off (41 pages).
- [ ] A cache for highlighted fences, if big sites find it slow.

### Templates, data and navigation

- [ ] `pagesTree`: parents that are only a key (`parent: Feature`), `nav.url`, `title` falling back
      to `key`, and docs on what `parent` matches (a11y #23). Then `pagesTree(collections.all, {
      root: "Feature" })` replaces eleventy-navigation, which lit.dev kept (sidebar and
      previous/next matched on all 213 and 202 pages with it).
- [ ] `pagination.before(data, fullData)`: sort, filter or map before chunking, in data files and
      the config (v8 #13).
- [ ] A filter's result can be circular (lit B12: nav items whose `prev` and `next` point at each
      other fail `value is nested too deeply`). Keep JavaScript objects as lazy views toward
      templates too, or copy with cycle detection.
- [ ] Includes from the project root, as Eleventy's Nunjucks loader searches it, or a `readFile`
      built-in (lit B13: sample sources included into code blocks).
- [ ] `layoutAliases: { post: "layouts/post.njk" }`, with `page.layout` staying `post` (a11y #9:
      `layout: post` silently picked an unused `_includes/post.njk`). Warn when a layout has no `{{
      content }}`, or is `include`d elsewhere.
- [ ] `url` in Edge (blog #4): the trailhead and `ssqch docs url` say `url` works, but in an Edge
      template it's `` `url` is not a function``. Add it to Edge, or fix both docs.
- [ ] Build-time components for custom tags in Markdown and HTML (v8 C8: `<feature-support
      chrome="71">` rendered by `_includes/components/feature-support.*`, 45 pages).
      `elementsPlugin` is the client-side half.
- [ ] URLs without the trailing slash (`trailingSlash: false`, v8 C5): `page.url` is `/blog/foo`,
      and `ssqch serve` answers it from `blog/foo/index.html` without a redirect, as Firebase's
      `cleanUrls` and Netlify's pretty URLs do.
- [ ] Eleventy's names as aliases where they mean the same: `getPreviousCollectionItem` and
      `getNextCollectionItem` (a11y #5); `rssPlugin()` giving the Eleventy plugin's filter names
      (`absoluteUrl`, `htmlToAbsoluteUrls`, `dateToRfc3339`/`rssDate`,
      `getNewestCollectionItemDate`/`rssLastUpdatedDate`) so feeds from its sample work; a `slugify`
      option that keeps what Eleventy's `slug` keeps (`.` and the like); Nunjucks
      `striptags(preserveLinebreaks)` (a11y #7).
- [ ] `collections: { sort: "eleventy" }` (date, then `inputPath` as a string), or document the
      tie-break and that defining `collections.all` replaces it (a11y #18).
- [ ] Liquid's speed on big sites: 8x slower than the other engines on the 9,000-page benchmark,
      because the `liquid` crate copies a variable's value on every read (`Runtime::get` calls
      `into_owned`). A patch upstream, or a runtime of our own over liquid-core.
- [ ] Peak memory is about 0.5 GB for 9,000 pages (every page's HTML is held until it's written):
      stream pages out if a bigger site needs it.

### Node compatibility (QuickJS)

Superseded by "The move to Node" above: on Node, every Node API and package works. For 0.7.x only.

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

### The dev server

- [ ] Incremental rebuilds in `ssqch serve` (a11y #20: 460 ms for all 115 pages, Eleventy 1.0 350
      ms; v8.dev 1.8 s, Eleventy `--incremental` 0.05 s; lit.dev's idiomatic port 2.9 s, Eleventy 22
      s).
- [ ] Don't rebuild for files nothing in the build reads (v8 #18: saving a stylesheet only PostCSS
      reads rebuilt the site, 1.6 s, 0 pages changed), or a `watchIgnore`. Ignore editor temp files
      (`.!*!*`, `*~`, `.#*`, `*.swp`, files that vanish within the debounce), and say an unchanged
      warning once per session (a11y #20).
- [ ] `serve.run`'s first compile: the wait is 2 s, and Tailwind took longer, so the first page
      warned (blog #14); a slow tool (a big `tsc --watch`) still races the first build. Wait while a
      watcher is on its first build, or `serve: { run: [{ command, waitFor }] }`.
- [ ] `ssqch serve` sometimes missed an edit made right after startup (a11y #21, 2 of 17 runs, while
      `serve.run`'s gulp was on its first pass). Write a stress test that edits within a second of
      ready.
- [ ] `ssqch serve` misses a config save during a reload: the watcher is set up again after the
      reload's first build, so a save in between isn't seen until the next one (CI caught it in
      `serve_restarts_companions_on_reload`). Compare the config files' contents once the new
      watcher is up, and reload again if they changed.
- [ ] `ssqch serve --host 0.0.0.0`, printing the LAN URL (a11y #20).
- [ ] A `beforeBuild` that gets the changed paths, so a site's caches are easy to invalidate (lit,
      agent experience 8).

### Diagnostics and reports

- [ ] `ssqch inspect` answers when the build would fail (v8 #8, A6): report conflicts and the like
      as warnings, then the page's data.
- [ ] Group output conflicts by path (v8 #6): one line with a count, not 58 lines of `blog/tag.njk
      and blog/tag.njk both write to ...`.
- [ ] The build summary's `Pages` size is measured before `afterBuild` (4.43 MB against 4.07 MB on
      disk after minifying, a11y #20). Measure after the hooks, or label it.
- [ ] Carry the file and line in errors instead of reading them from the message
      (`diagnostics::locate`), starting with the template engines. Then maybe explain each
      diagnostic code (`ssqch docs links`).
- [ ] Link checker: read redirects from `firebase.json` and `vercel.json` (v8 #21: 324 false
      reports), and let `ignore` take fragments a script handles (`ignore: ["#navigation-toggle"]`,
      322 reports). `redirectsPlugin({ firebase: true })` could write them.

### Images

- [ ] Copied GIFs and SVGs count as "encoded" on every build and aren't kept in `.cache/ssqch/img`
      (blog #10): cache them, and count them as copied.
- [ ] `image()` and `imageUrl()` take different kinds of path; say which `image()` takes, next to
      `imageUrl()`'s (blog #15).
- [ ] SVG sizes in `files({ dimensions: true })`, from `width`/`height` or the `viewBox` (v8 #22).
- [ ] Image sizes without re-encoding (v8 C7): `width`, `height` and `loading="lazy"` on every local
      `<img>`, an `@2x` file as `srcset`, and inline SVG on request, for sites that already ship
      optimized images.
- [ ] HDR photos (newer iPhones: Display P3, PQ curve, gain map) can't be converted: `moxcms` fails
      with `InvalidAtoBLut`, and they need tone mapping, not a color conversion. They're encoded as
      they are, with a warning. Doing it properly means reading the gain map (ISO 21496-1) or
      tone-mapping PQ to SDR the way ColorSync does. The blog converted its 4 with `sips`.
- [ ] Maybe: an image API that names its output formats explicitly, instead of an `auto` setting.

### Plugins

- [ ] Precompression: `.br` and `.gz` next to each file over a size (lit.dev's `preCompress`: 1,435
      files, 9.7 s of Node after each build). Common for sites served by Node or nginx.
- [ ] Server rendering of custom elements (declarative shadow DOM), or a documented recipe for
      `@lit-labs/ssr` as a transform (it works on QuickJS at 15x Node's time, now that node-fetch
      loads): lit.dev's header, drawer and asides, 273 pages.
- [ ] Later, **Blog:** an `ssqch/seo` plugin for Open Graph, Twitter cards, canonical links and
      JSON-LD `Article`, which every blog writes by hand (the blog's `partials/head.edge` and
      `jsonLdArticle`). A sketch: `seoPlugin({ url, siteName, twitter, image })` adds `seoTags({
      title, description, image, type, date })`, which returns the canonical link, `og:*` and
      `twitter:*` tags (the image through `imageUrl(..., { width: 1200, format: "png" })`) and, for
      `type: "article"`, a JSON-LD `Article` with the publisher's logo. Templates put it in `<head>`
      themselves. Open: which page fields it reads by default, and whether the blog's extras
      (`og:image:alt`, `article:author`, `rel="author"`) are options.
- [ ] Maybe: `feedPlugin({ collection, limit, format: "atom" | "rss" | "json" })`, which writes the
      feed. Matters more for new sites than for the blog's 30-line `feed.edge`.
- [ ] Maybe: `afterBuild` `run` hooks get the written files in `SSQCH_WRITTEN` (a JSON file), so
      post-processing doesn't need a function hook to write the list (a11y #24).
- [ ] Elements: fingerprint the elements' files, and `modulepreload` for eager ones.

### Importer, the rest

- [ ] `.eleventyignore` becomes `ignore` globs (a11y #6; v8.dev too: `**/_*.md` would have built a
      partial as a page), and `eleventyConfig.ignores.add()`, with paths resolved from the project
      root to globs relative to the input folder.
- [ ] `addLayoutAlias` (a11y #9): rewrite the `layout` values and list templates that compare
      `layout == "post"`, or emit `layoutAliases` (above).
- [ ] `dataTemplateEngine` (a11y #15): list data files with `{{ }}` or `{% %}` in their values, and
      unwrap `{{ '/x/' | url }}` when `pathPrefix` is `/`.
- [ ] Flag what changes output beyond the mechanical edits (a11y #3: `eleventy.generator` becomes
      `ssqch.generator`, which adds a `content` to every page), `{{ date }}`-style printing of Dates
      (a11y #13), date code that uses the machine's time zone (luxon's `fromJSDate` without `zone`,
      `toLocaleDateString` without `timeZone`; v8 #13), `pagination: { data: collections }`, whose
      names come in another order (v8 #13), and templates inside `addPassthroughCopy` folders, which
      Eleventy renders and ssqch only copies (v8 #12).
- [ ] Concrete answers for more plugins: `eleventy-plugin-edgejs` isn't needed (Edge is built in),
      `eleventy-plugin-broken-links` is `linksPlugin()`, an html-minifier-terser transform is
      `minifyPlugin()`, `setDataDeepMerge(true)` is the default (blog);
      `@lit-labs/eleventy-plugin-lit` has no equivalent (keep it as a transform),
      `eleventy-plugin-nesting-toc` is `toc(page.headings)` and how it differs (lit D9).
- [ ] Don't edit front matter for aliases (lit D7: `eleventyComputed` and
      `eleventyExcludeFromCollections` work as they are, and the renames touched 6 files), or put
      those edits behind a flag. Keep `if (!DEV)` conditions on passthrough copies, drop dead globs,
      and use the config's indentation (lit D10).
- [ ] `ELEVENTY_ENV=` prefixes in scripts (blog #1): say ssqch reads `SSQCH_ENV` or `--env`, or map
      it.
- [ ] The draft's header promises a list that isn't there (blog #2: "What it couldn't carry over is
      listed at the end"). Write the list into the config, or drop the sentence.
- [ ] `ssqch import --format json` (each item with `file`, `line`, `kind` and the ssqch equivalent),
      and `--help` without the build-only options (`--base`, `--offline`, `--env`, `--verbose`; v8
      #26).
- [ ] The table of equivalents: check it against the tables in `docs/trailheads/`, and move
      `import`'s method and package hints (`CALL`, `replacement`) into it. Aliases in
      `sitesquatch.toml` (snake_case keys, so Eleventy's words don't apply) and in `ssqch.d.ts` (a
      typed config that uses `pathPrefix` gets a type error, which keeps the docs on ssqch's names)
      are open questions, not plans.
- [ ] `ssqch import zola`: write each section's directory data from its `_index.md`, and rewrite the
      Tera constructs that map one to one (`page.content`, named filter arguments).
- [ ] `ssqch import jekyll` and `ssqch import hugo`. Weigh them against WordPress (below).

### Docs

Per AGENTS.md, every feature ships with a README entry `ssqch docs` finds; these are the fuller
write-ups that are still owed.

- [ ] The Eleventy trailhead:
  - "Things that work differently": the defaults that change markup (heading ids, `linkedImages`,
    GIFs kept animated, SVGs not rasterized, the `defer="defer"`-style differences that come from
    eleventy-img's rewriter), Eleventy's implicit behaviors (built-in filters, `url`'s normalizing,
    `addLayoutAlias`, `dataTemplateEngine`, `.eleventyignore`, creation-time dates, the `inputPath`
    tie-break, Dates printed in local time), and removing `@11ty/eleventy` removing what came with
    it. v8.dev's `suggestions.md` (E) has text to start from.
  - "Keeping markdown-it": the engine, `render` in folder or global data and `render: njk` on other
    templates, what Eleventy does to the library, `npm install punycode`, the speed to expect
    (v8.dev: 1.9 s against 0.7 s), and Prism through a fence hook and `pagesTree` against
    eleventy-navigation side by side. Shorter once `markdown: { render }` lands.
  - "Matching Eleventy's output byte for byte": a baseline from a worktree, `TZ` pinned, the same
    `src/` timestamps, unminified first, `ssqch diff` to "No differences", then `--exact` on the
    minified builds (`git archive HEAD | tar -xmf -` for fresh copies, the `--ignore` pattern for
    eleventy-img names); bisect what's silent.
  - Plugins table: eleventy-img in data files (`Image(src, opts)` becomes `await image(src, {
    widths, formats })`, with the result's shape), an `Image()`-based social image as `imageUrl(src,
    { width: 1200, format: "png" })`, and the RSS plugin 1.x names. A worked example of keeping
    eleventy-navigation's filter.
  - The table of slow packages (added in 0.7.0) grown with numbers for posthtml and markdown-it with
    Prism, and "what to use instead" for each.
- [ ] README: overriding `collections.all` (document it or refuse it); the `afterBuild` event's
      `written` (pages only, absolute) and mixing function and `{ run }` hooks; hook commands should
      write to `$SSQCH_OUTPUT` so `--output` works (v8 #17); what `node:fs` doesn't have; transforms
      don't reach `templateContent`, so Markdown features belong in render hooks (v8 #24); `.length`
      and `===` being rewrites of the template text; html-minifier-terser listed under "these work"
      without saying it's too slow; and the known gaps (`Date#toString()`'s zone name,
      `timeZoneName`, `--host`, string-slicing parsers in QuickJS, `node:stream`).
- [ ] Custom highlighters (done so far: the README paragraph, the `highlight` row, `ssqch.d.ts`,
      CHANGELOG, a row in the Eleventy, Docusaurus and component-framework trailheads). Left: a
      how-to (a highlighter in its own file imported into the config, the token shape and kinds,
      checking it with `{1,2}` line marking and the warning a bad one gives, when to use an alias or
      a `.sublime-syntax` file instead; the blog's ChordPro highlighter before it was built in is
      the worked example); the Hexo (highlight.js and Prism languages), MkDocs (Pygments lexers) and
      Zola (`extra_syntaxes_and_themes`) trailheads; the docs starter's writing guide; an example
      site with a small custom language.
- [ ] Gahlee House's features: a how-to for a photo album from a folder (`files()`, `imagePlugin()`
      for the sizes, a paginated page per album) with its `albums.js` as the worked example,
      mentioned in the Hexo and Jekyll trailheads; a pagination how-to with repeated titles
      (`slugger()`, `slugify`'s separator; `blog-tags` could use `slugger()`); `ssqch diff`'s "only
      dates changed" in every trailhead's "Checking the move"; and the worked Eleventy import rerun
      on Gahlee House and the `blog-categories` source.
- [ ] 0.7.0's Node shims (callback `fs`, the `fs` stream stubs, `file:` imports) in a page about
      which packages load.
- [ ] When troubleshooting docs get written: call the section (or page) "Ranger station:
      troubleshooting".

### Deploying and examples

- [ ] Deploy the examples, one Netlify site each at `<name>.sitesquatch.dev`.
      `.github/workflows/examples.yml` builds them with the same commit's ssqch and uploads each
      through Netlify's deploy API on pushes to `main`. Left: create a Netlify site per example
      (eight now), add the `NETLIFY_AUTH_TOKEN` secret and the `NETLIFY_SITE_*` variables (the
      workflow lists them), and run it; a CNAME per example on Namecheap's DNS and the custom domain
      in each Netlify site; link the live URLs from `examples/sites/README.md` and the README.
- [ ] Deploy guides:
  - Netlify: grow the README's recipe into a guide with the blog's `netlify.toml` as the worked
    example: `netlify-plugin-cache`, `redirectsPlugin({ netlify: true })` and `_redirects`, a
    `_headers` file (cache headers for `/img/`), deploy previews and branch deploys, and bumping the
    pinned version.
  - Cloudflare: work out the recommended path (Workers static assets or Pages; a Git build or
    `wrangler` from GitHub Actions with `setup-ssqch`), whether its build cache can keep
    `.cache/ssqch` (if not, build in Actions with `actions/cache`), whether `redirectsPlugin`'s
    `_redirects` lines work there, and whether the option needs a host-neutral name. Deploy an
    example to prove each step.
  - Decide where guides live (`docs/deploying/` beside `docs/trailheads/`, or the README) and
    whether `ssqch docs` answers from them; link them from the trailheads and the starters' READMEs.
- [ ] CI: build the blog and compare it against a known-good output, as a regression test (today
      it's by hand: build with the release and the branch, then `ssqch diff --exact`).
- [ ] The starter: a suitably blurry picture for the second post (**Needs David**: a drawing beats
      anything generated), versions (the `versioned-docs` example shows how) and i18n (after the
      i18n work) as options of the docs starter, "Copy link" on its headings, and the review's other
      example posts (*The stump has a forwarding address*, *Honey, I Shrunk the Site*).
- [ ] A searchable-directory example: structured data, one page per record, filters as a custom
      element, Pagefind for search.
- [ ] Offering the Rust blog or eslint.org port upstream, once eslint.org's other languages work
      (i18n, below). Their broken internal links (25 and 28; lists in `../trials/`) are worth
      reporting on their own.

### Bigger features

- [ ] **Migrating from WordPress.** It runs a large share of the web, and the move is bigger than
      from a generator: content lives in a database, URLs come from permalink settings, and themes
      and plugins do work a static site has to replace.
  - Research (notes in `research/wordpress.md`): how people move today (the WXR export, the REST
    API, `wordpress-export-to-markdown`, the Jekyll and Hugo exporters) and where they get stuck;
    what a typical blog has (posts and pages, categories and tags, authors, drafts and scheduled
    posts, featured images and `wp-content/uploads/` with its resized copies, Gutenberg and classic
    markup, shortcodes, embeds, galleries, comments, SEO, redirect, form and search plugins).
  - Decide: an `ssqch import wordpress <export.xml>` that writes pages with front matter, brings the
    media in for `imagePlugin()` and writes `aliases` for old permalinks and `?p=123` URLs, plus a
    by-hand list; or a guide that leans on an existing converter.
  - Migrate a real WordPress site end to end and compare URLs, feed and sitemap with the live site,
    as the trial migrations did. Then write `docs/trailheads/from-wordpress.md`, a README pointer,
    an `ssqch docs wordpress` answer and a CHANGELOG entry.
- [ ] **Internationalization.** A design write-up first: a `locales` config key, `page.lang` from
      the folder, `page.translations` grouped by a translation key, a `t(key)` filter over
      `_data/i18n/<lang>.*`, fallback pages for untranslated content, and hreflang. `Intl` for more
      locales than en-US (ICU4X with a chosen set; eslint.org's 7 other language sites and
      letsencrypt.org's number formats need it, and eslint.org's English site needs `NumberFormat`'s
      currency style and compact notation). An example `multilingual-liquid`, guides from Jekyll and
      Hugo, and a trial with letsencrypt.org.
- [ ] **Content and structure:** references in schemas (a field that names a page in another
      collection, `author: "ref:authors"`) and checks on the rendered output (every guide has a
      previous and next link); named data sources (`sources: { snacks: { url, cache, schema } }`
      with `ssqch refresh`, so a build can run offline from pinned snapshots); `ssqch move <from>
      <to>` (move a page, fix the links to it, add an alias); and more output formats for a page
      (the same content as JSON or Markdown, for a search index, an app or `llms.txt`).
- [ ] **Themes:** a theme's own config (filters, plugins), `ssqch theme` to list a theme's files and
      copy one into the site, a report of upstream changes that overlap the site's overrides, and
      the docs starter published as a theme.

## Parked

Decided against for now, or waiting for someone to need it. Move an item up when that changes.

- Worker threads for the Node build's rendering (left out 2026-11-17, at stage 2 of the move to
  Node). One thread builds the 10,000-page site in 1.41 s against a limit of 2 s. A worker
  loads the config itself, so a config's own state (a counter in a filter, `let n = 0`) would be
  kept apart in each worker, which 0.7 never did
  (`javascript_calls_are_serialized_across_parallel_pages` in the oracle). The spike's workers
  took about 140 MB each and helped only where JavaScript is the cost (v8.dev: 0.54 s to
  0.45 s). If a site needs them: only above a page count, never for a config with state they'd
  split, and with the benchmark recording memory.

- Built-in CSS processing with Lightning CSS (`@import` bundling, nesting, minifying, browser
  targets): only if a real gap shows up; `serve.run` and the missing-file note have covered every
  site so far. JavaScript bundling in Rust costs too much binary for what it gives.
- Linux aarch64 release builds (static musl), when someone needs them.
- Go templates (Hugo; no Rust implementation matches Go's `text/template` closely) and MDX/JSX
  (needs a JavaScript toolchain and a component model).
- Liquid and Handlebars includes in "did you mean" and in `--verbose`'s list of unused templates:
  their crates don't say what they loaded.
- A lighter built-in search, or Pagefind as an opt-in download.
- A page inspector in the browser, a component workbench, an MCP server (as a thin layer over the
  JSON interface), preview at a future date, a local form editor for front matter, diagnostic
  bundles.
- Proposed in the 0.5 reviews, not decided: renaming `ssqch inspect` to `ssqch trace` (Breaking),
  and display titles for the docs ("SiteSquatch Field Guide", "Trail log" for release notes, "Travel
  light: build size and budgets", "Connecting trails" for the trailheads). The reviews are in
  `research/reviews/`.
