# TODO

The ReverentGeek blog (`../blog`) is the main real-world site. Its own tasks are in
`../blog/TODO.md`. Items here that the blog is waiting on say **Blog:**, and blog items that need a
change here say **Needs ssqch:**. When one side finishes, tick it and update the other list.

The current release is 0.8.0 (2026-11-18), on Node; 0.7.1 was the last of the Rust implementation (`CHANGELOG.md` has every release). Work goes to `main`.
The blog builds with the npm package, pinned exactly.

Finished work, and the reasons and measurements behind it, are in `docs/archive/todo-2026-11-17.md`
(everything up to 0.7.0) and the changelog; what was listed for 0.7.x only is in
`docs/archive/todo-0.7-only.md`. When a section here is done, move it to the archive
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

This replaces "Faster JavaScript" and "Node compatibility (QuickJS)", and the parked Linux ARM
builds, and it settles several "Silent wrong answers" (YAML dates as js-yaml makes them, `Date` and
`Intl` time zones, `templateContent` read before its page renders). They were listed for 0.7.x
until the switch removed 0.7 from `main`; they're in `docs/archive/todo-0.7-only.md` now.

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
  - [x] A cache of highlighted fences on disk (`.cache/ssqch/highlight/fences.json`, keyed by
        the `.wasm`'s inputs, 2026-11-18): a build whose fences are all there never loads
        syntect's grammars, so the blog's first build in a new process renders in 48 ms instead
        of 390 (0.64 s instead of 1.0 s in all), with the same bytes.
  - [x] Stage 8 ships `wasm/markdown.wasm` in the package (the loader finds it next to `src/`).
  - [x] The README's Edge, Jinja and Nunjucks, Liquid, Handlebars and EJS sections describe 0.8
        (2026-11-18).
- [x] **Stage 4, checks and tools:** schemas and `types`, links, `diff`, `inspect`, footprint and
      budgets, `docs`, `new`, `init` and the starters, `capabilities` (2026-11-18).
  - [x] Content schemas (`schema.ts`), `inspect`, `diff` and footprint with budgets (2026-11-18),
        with 0.7's messages and reports: 27 broken schemas, 35 `inspect` cases, the footprint and
        budget cases and 240 random pairs of builds give 0.7's output through the binary. `diff`
        ports what 0.7 diffed with, the `similar` crate's Myers (`myers.ts`), so hunks split as
        0.7's do. On two builds of the 10,000-page site it takes 0.44 s (0.7.0: 0.5 s on every
        core) at 150 MB; with every page changed, 2.1 s on one thread, where 0.7.0 takes 0.7 s on
        15 cores. Worker threads for the comparison would close that, if wanted (no site code runs
        in `diff`). `cli/report.test.js` and the report shapes pass now that `ssqch/links` is in.
  - [x] `init` and the starters (all 12 byte for byte), `new` with blueprints, `types`, `docs`
        (the README bundled in `packages/ssqch/bundled/`), `capabilities`, `completions` (0.7's
        five scripts, bundled) and `sighting`.
  - [x] An independent review (2026-11-18), with the importers and `fetch`: `build -o .` wrote
        over the site's source; globs read `\` and `**/` otherwise than globset; impossible TOML
        dates rolled over; `ssqch new` rewrote a blueprint's JSON values and a non-UTF-8 one's
        bytes; slugs lowercased Greek's final sigma; `fetch` refused requests 0.7 made. Each fixed
        with a test (`cli/core-details.test.js`), or recorded in the changelog. Globs now match
        by character, not by byte (decided 2026-11-18).
- [x] **Stage 5, plugins:** images (D4), rss, minify (D3), assets, sitemap, redirects, Sass,
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
        committed built; the README has its section ("Plugins in Rust").
  - [x] Rust plugins are in the README ("Plugins in Rust", `ssqch docs plugin sdk`), and
        `ssqch.d.ts` has `RustPlugin` in the `Plugin` type (2026-11-18).
  - [x] `ssqch-plugin` 0.8.0 is on crates.io (2026-11-18). The example plugin stays in the
        repository, not on npm.
  - [x] Images on sharp 0.35.5 and assets (2026-11-18), with 0.7's names (BLAKE3 in TypeScript),
        so a site's image cache and asset URLs carry over: a copy of the blog with its cache
        builds its 4,985 image files byte for byte as frozen. The quality options keep 0.7's
        numbers, turned into sharp's from a calibration at equal SSIMULACRA2
        (`src/image/quality.ts`); a cold build of the blog's images takes 28 s (0.7: 68 s) and
        makes 7% fewer bytes. `files(pattern, { dimensions: true })` reads sizes too.
  - [x] Documented in the README (2026-11-18): the quality numbers are 0.7's scale on sharp,
        AVIF needs no feature now, and `[ssqch] Encoded` lines come while pages render.
  - [x] links, rss, sitemap, redirects and elements (2026-11-18), on ssqch's own HTML tokenizer.
  - [x] An independent review (2026-11-18): a failed image encode left markup pointing at files
        never written; a JPEG of a transparent PNG went black; the HTML tokenizer read malformed
        HTML (`<iframe ... />`, SVG's `<title>`, `<!-->`) otherwise than lol_html, for `base` and
        every plugin; the link checker crashed on `%00` and held every page's HTML; minify was
        quadratic on raw blocks in WebAssembly; the modules exported their helpers. Each fixed
        with a test, or recorded. The tokenizer, rewritten after lol_html 2.9.0, agrees with it
        on all 778 frozen pages and about 400,000 random ones, apart from three recorded cases.
  - [x] Decided 2026-11-18: an invalid date in the rss date filters is an error (0.7 wrote 1970).
- [x] **Stage 6, the dev server** (2026-11-18); the results are in
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
  - [x] The server no longer loads the build's modules (2026-11-18): `cli.ts` imports each
        command's when it runs, and the build process's half of `serve/builder.ts` is
        `serve/build-process.ts`, loaded only there. From source, `--help` takes 40 ms (70 ms
        before) and serving a one-page site is ready in 151 ms (166 ms). The npm package bundles
        everything into one file, so there it changes little (`--help` 45 to 30 ms; serving
        about 125 ms either way): the time left is the build process, which loads the bundle and
        builds before the server is ready. 0.7 was ready in 70 ms.
  - [ ] Windows and Linux: the server's own unit tests run both ways of watching on each, but
        the oracle's serve tests have only run on macOS. Watch CI's first run.
  - [x] The review's findings (2026-11-18), each with a unit test or an oracle test in
        `cli/serve.test.js`: a syntax error in an included Jinja or Nunjucks template is an
        error at its line (the fork answered later, with `null`, and the build process died);
        deleting a tree of thousands of watched folders on Linux takes time in step with it
        (it was minutes: every folder asked about every other); after the build process ends,
        another loads the last configuration at once; the ES module retry for Node 22.18 only
        follows a CommonJS compile error, so a file isn't run twice; the written-pages cache
        compares the change time too; an error thrown after a build fails the next one; Ctrl-C
        says nothing false; the site's commands don't get ssqch's `UV_THREADPOOL_SIZE` and
        run through `cmd /C` with AutoRun; the 404 and 400 answers have 0.7's types and
        lengths. And two of 0.7's own bugs: a folder renamed back rebuilds, and a config file
        that's put back is read.
  - [ ] A promise in the site's code that never settles wedges every rebuild for good when
        something keeps the event loop busy (a `setInterval` in the config), as in 0.7: the
        "never settled" check only fires when nothing is left to run. Now that the build runs in
        a process of its own, the server could give a build a time limit, end its process, and
        say which hook or filter it was in. Needs a limit that a slow first build (images)
        doesn't hit: count from the last thing the build did, not from its start.
  - [ ] The process that replaces one that ended loads the config's files as they are then: a
        config saved in the instant between (the oracle waits 3 s) can't be the last one that
        loaded, and nothing builds until one loads. A spare process, loaded beside the one that
        builds, would close that, at the cost of running the config's top-level code twice.
- [x] **Stage 7, importers:** Eleventy and Zola (2026-11-18): `src/import.ts`, from `import.rs`
      with its tests. 0.7's importer reads a site's files as text and runs none of them, so it had
      nothing for QuickJS to drop. On the Eleventy sources of a11yproject.com, v8.dev, lit.dev,
      Gahlee House, eslint.org and the blog's trial, and on the Rust blog's Zola source (776
      edits), the dry run prints what 0.7's prints and `--write` writes the same files (but the
      version). The drafts then build as 0.7's do: Gahlee House with no differences, the others
      stopping at what the list leaves by hand (a missing `},` in a11yproject.com's `team.json`,
      v8.dev's `slug`, lit.dev's `LITDEV_ENV`). The oracle's 3 import tests pass on Node 22.18,
      24 and 26.
- [x] **Stage 8, distribution:** the compiled, bundled npm package (sharp its only dependency), the
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
  - [x] npm only (the owner, 2026-11-18): the standalone executable is gone (`build-sea.ts`,
        `sea-main.ts`, the entitlements, `notarize.yml`, the signing steps, CI's `standalone`
        job, `check-package.ts --exe`), and so are the installers (`scripts/install.sh`,
        `install.ps1`). `release-files.mjs` writes the Homebrew formula, which depends on
        Homebrew's `node` and installs the npm package from the registry, and `sha256.sum` for
        the tarball. CI's `package` job and the release's check run on Linux only, on Node 22.18,
        24 and 26. The README shows `actions/setup-node` with npm for GitHub Actions.
        `docs/node-migration.md` ("Stage 8") has why.
  - [ ] A pull request that touches `release.yml` (it runs the release up to publishing) before
        the first tag, and the first formula in `reverentgeek/homebrew-tap`: `brew install`,
        `brew test` and `brew audit --strict` on it (it was checked with `ruby -c` and by running
        its install and test steps by hand, not by Homebrew).
  - [x] `setup-ssqch` is retired: 0.8 installs from npm with `actions/setup-node`. The owner
        archives the repository (its `ssqch-0.8` branch isn't needed).
  - [x] The docs starter's Install and Deploying pages show 0.8's ways (2026-11-18, at the switch):
        a dev dependency from npm or pnpm and `npx ssqch`, Netlify with `npx ssqch build` and
        `NODE_VERSION`, and a GitHub Pages workflow with `actions/setup-node`. 0.7's showed the
        installer script, `cargo install` and `setup-ssqch`. The six docs starters' snapshots were
        frozen again with the Node build (`node freeze.js`), and the changelog says so.
  - [x] The last 0.7.x, 0.7.1, from `release/0.7` (2026-11-18): the binaries, npm, Homebrew and
        the 16 crates.
  - [x] The `@ssqch/<platform>` packages are deprecated (2026-11-18): all 11 versions of each of
        the four say "ssqch 0.8 is JavaScript and needs no platform package".
  - [x] Stage 9: the README's Install, Netlify and GitHub Pages sections; `import "ssqch"` from
        plain Node works (2026-11-18). The version numbers in them are for the release step.
  - [x] ~~A Linux arm64 executable and a musl one~~: there's no executable (npm only). The npm
        package runs on Alpine and Linux on ARM with their own Node.
- [ ] **Stage 9, Blog:** move the blog, then the examples, starters and trial ports; the README,
      trailheads, changelog and benchmarks; `AGENTS.md` for the TypeScript codebase. Release 0.8.0.
  - [x] The README for 0.8, the trailheads, `ssqch.d.ts`'s `RustPlugin`, `AGENTS.md` for the
        TypeScript codebase, the changelog as one entry (`## Unreleased`), and the benchmarks,
        measured alone (2026-11-18): the blog 25.6 s cold and 0.92 s warm (0.7: 60.2 s and
        0.38 s), the 10,000-page site 1.12 s on one thread, v8.dev 0.58 s.
  - [x] The oracle: 212 of 230 pass on Node 22.18, 24 and 26. The 13 that fail are the 12
        starters and the blog's frozen output, which match 0.7.0 byte for byte with the package's
        version at `0.8.0` (at `0.8.0-dev` the JSON report's byte counts include the longer
        version). The examples, a11yproject.com and v8.dev match now.
  - [ ] The owner's answers (2026-11-18), to act on:
    - [x] Pushed `main`; CI's first run failed. Fixed: three tests that assumed macOS, and 0.7's
      `ssqch.d.ts` (restored; the package's is its own now). Still to fix: on Windows with the
      tarball on Node 22.18, `a_theme_sits_under_the_site_file_by_file` (the message has `\`
      where the test wants `themes/missing`) and `fetch_sends_requests_as_written` (`10+20`
      where 0.7 gave `8+22`). Fixed: the message names the folder with the system's separator,
      and a build's saved `fetch` replies are found in memory (Windows couldn't read a cache file
      while another request moved its copy into place). CI is green on every system.
    - [x] 0.7.1 from the `v0.7.0` tag: only the version and a note pointing to 0.8.
    - [x] Remove the Rust implementation before 0.8.0, on a branch, and check everything again.
    - [x] Publish the `ssqch-plugin` crate with 0.8.0; keep the example plugin in the repository.
    - [x] npm only: drop the standalone executable (build-sea, sea-main, signing, notarizing, the
      `standalone` job) and the install scripts. The Homebrew formula depends on Homebrew's
      node and installs the npm package. Retire `setup-ssqch` (the README shows
      `actions/setup-node` and `npm install -g ssqch@<version>`). The `package` job runs on
      Linux only, on the three Node versions.
    - [x] Images: quality options on sharp's own scale, with defaults that encode as 0.7's did
      (Breaking; the blog's config changes with its move to 0.8.0). AVIF speed 4 stays effort 3.
      One encode per core. PNG adaptive filtering off. An image that fails after its page is
      written fails the build. Done 2026-11-18: `webpQuality`, `avifQuality` and `jpegQuality` go
      to sharp as they are (defaults 75, 41 and 89), `avifEffort` (default 2) replaces
      `avifSpeed`, which fails with the conversion; names keep 0.7's settings (`legacySettings`
      in `src/image/quality.ts`), so a converted config keeps its cache. `ENCODES` is
      `os.availableParallelism()`, each encode on one libvips thread (AVIF's bytes change with
      libaom's threads). The late failure is an `images` error naming the source and the pages.
      **Blog:** `src/utils/site/image-options.js` becomes `avifQuality: 48, avifEffort: 3` with
      its move to 0.8.0.
    - [x] Before 0.8.0: a disk cache for highlighted fences in `.cache/ssqch/`, keyed by the
      highlighter's version. Done 2026-11-18 (stage 3's item).
    - After 0.8.0 (backlog): worker threads for `diff`; faster dev-server rebuilds on big sites;
      a time limit for a stuck build; the config-save gap while a builder restarts (accepted).
    - Kept: a late error in `serve` fails the next build, as in 0.7; the importer edits
      `package.json` in place. The `@ssqch/<platform>` packages are deprecated (above).
  - [x] Pushed, and CI watched on Linux and Windows (2026-11-18): the Windows tests above, and a
        dozen timing races in the serve and timer tests that only busy runners showed.
  - [x] The last 0.7.x: 0.7.1, from `v0.7.0`, released before 0.8.0 (2026-11-18).
  - [x] The switch (2026-11-18, on a branch, for the owner to merge): 0.7 is gone from `main`
        (`crates/sitesquatch*`, `crates/ssqch`, `plugins/`, `examples/reverentgeek`); what the
        `.wasm` crates compiled moved into them, and the `.wasm` files give the same output. The
        oracle runs the Node build by default and all of it passes (`progress.js` and
        `node-passing.txt` are gone: the version's length is allowed for); `freeze.js` freezes
        with the Node build; `bundled/` holds the originals (the README and trailheads stay where
        they are, and the package build copies them in). `docs/node-migration.md` ("The switch")
        has what moved where, the decisions and the checks.
  - [ ] **Needs the owner:** after merging the switch, update the branch protection's required
        checks if it names CI's old jobs (`test (...)`, `clippy`): CI's jobs are `node`,
        `package`, `node-benchmark` and `rust` now.
  - [x] 0.8.0 released (2026-11-18): npm with provenance, the GitHub release, Homebrew (a formula
        on Homebrew's Node), and `ssqch-plugin` on crates.io. A rehearsal pull request (#29) ran the
        release up to publishing first; the tag's first run still failed at npm (`npm publish
        npm-package/x.tgz` read the path as a GitHub repository), so the release and tag were
        deleted and `v0.8.0` tagged on the fix (`193b407`).
  - [x] **Blog:** moved to `ssqch@0.8.0` and deployed (2026-11-18, `7fdba164`): the image options
        in sharp's numbers, `pnpm test` and lint pass, every image reused from its cache, the
        oracle's blog test passes, and Netlify built and published it.
  - [ ] Check the new Homebrew formula: `brew install reverentgeek/tap/ssqch`, `brew test ssqch`,
        `brew audit --strict --online ssqch`.
  - [ ] lit.dev's frozen output (`node freeze.js trial-lit.dev`), which needs lit.dev's SSR build.

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
| `osg #n` | opensource.guide (Jekyll 3.10, github-pages 232, 382 pages in 29 languages, 0.8.0) | `../trials/opensource.guide/ssqch-case-study/` (`issues.md`) |
| `ex #n` | expressjs.com (Astro 7.4, MDX, 1,332 pages in 10 languages, 0.8.0) | `../trials/expressjs.com/ssqch-case-study/` (`issues.md`) |

What the moves agree on: the importer and `ssqch diff` do their jobs, and the costly problems are
silent ones (output that's wrong with no warning) and slow JavaScript. lit.dev's verdict was "don't
move yet": byte parity needed Eleventy's libraries, a Node helper and Chromium, and was slower than
Eleventy (32.9 s against 24.9 s), while ssqch's own features built the site in 4.2 s but without
Lit's server rendering or the site's highlighting styles. opensource.guide, the first move from
Jekyll, was the same site with no content changed (the same 478 files, nothing unexplained) and 5.9
times faster, but two thirds of the work was kramdown's Markdown inside HTML, and liquidjs' `where`
made the build 3 to 7 times slower until the config replaced it.
expressjs.com, the first move from a component framework, matched Astro's URL set and its <head> on
every page, the article text on 96%, and built in 2.0 s against 32.4 s; the work was a codemod for
the MDX and a hand-written route table for its languages, and Astro's dev server still shows an edit
faster (0.35 s against 1.2 s).

## Now

### 1. Profiling

- [ ] **`ssqch build --profile`:** time per config filter, transform, engine and data file (calls
      and total), per template and per page, and layouts apart from writing. The same numbers in
      `ssqch build --format json` (`timings.filters`, `timings.transforms`, `timings.engines`).
      Every move found its slow code by wrapping functions by hand: the summary's `write 1.42 s` was
      layout filters, `toc` (830 ms) and `eleventyNavigation` (550 ms) (a11y #28); lit.dev's first
      build took 9 min 8 s and `write 23 s` named nothing (lit A5); opensource.guide's `write 6.84
      s` was liquidjs' `where`, found with `node --cpu-prof` (osg #2).
- [ ] **A warning when one JavaScript call takes over a second**, naming the function and the
      package it's from (lit A5: html-minifier, 5.2 s per page).
- [ ] Document both, and use them to measure the sites the move to Node was measured on.
- [ ] **Native Liquid `where`** (`where` and `reject` done 2026-11-18: the bench's Liquid case 39.8
      s → 4.6 s; `where_exp`, `map`, `sort`, `group_by`, `find` still liquidjs') (and `where_exp`,
      `map`, `sort`, `group_by`, `find` for a property path), keeping liquidjs' for expressions (osg
      #2). liquidjs' `where` takes a generator and a new scope for every item: opensource.guide's
      layouts call it 56 times a page over 380 articles, and a 10-line config `where` took its build
      from 7.4 s to 1.06 s with the same output. Add a `bench/bench.ts` case: a layout that filters
      a collection on every page.

### 2. Silent wrong answers

Each of these built a site that was wrong in a way nothing reported. Fix the behavior where it's
clear; otherwise warn.

- [ ] **`computed` sees `collections`** (lit B4: the learn page lists `data.collections.articles` in
      `eleventyComputed`). Evaluate computed values that read `collections` after collections are
      built (Eleventy passes collections built without the computed values), or at least an error
      that says computed can't see them.
- [x] **`computed.page` is dropped without a word** (osg #5; done 2026-11-18): `site.ts:760` sets
      `page` after `computed` runs. Make it an error that says `page` is built in and names another
      key.
- [x] **`page.headings` read before the page renders is `[]` for good** (ex #2; fixed 2026-11-18):
      `pageWithBody()` (`site.ts:864-872`) memoizes `headings(contentOf(page) ?? "")` with `found
      ??=`, so a `computed` value that reads it caches the empty list, and every table of contents
      built from it is empty. Don't memoize while the content is undefined, or throw naming the
      page.
- [ ] **Warn when a template name shadows a filter or function** (ex #3): an imported macro
      `postCard` printed `function () { [native code] }` where the config's `postCard` was meant; a
      macro parameter `icon` hid `icon()`. Silent in Nunjucks; `strict` (off by default) catches
      only undefined values.
- [ ] **A computed `layout` that depends on the page** (lit B3): it's refused since 0.7.0; resolve
      the layout chain after `computed` instead.
- [ ] **Dates and time zones:**
  - A time zone for the build's JavaScript and date filters (`timeZone: "UTC"`): 137 of v8.dev's
    pages differ between a laptop in EST and CI in UTC (v8 C11).
  - A fixed date for undated pages (`dateFallback: "git"`), so their order and `<lastmod>` don't
    depend on when a checkout wrote the files: every move's sitemap changed with file times (v8 C9).
    Maybe `date: "created"` too (a11y #22). Undated pages also sort by file time, so one edit
    reorders a collection: sort them by path, as Jekyll does (osg #13). And honor
    `SOURCE_DATE_EPOCH` as the fallback date and build time, which Jekyll's `time:` does for a
    pinned baseline (osg #14).
- [ ] **The `url` filter on a non-string** (a11y #16: `false` from a `permalink: false` page printed
      `/false` in the sitemap): normalize as Eleventy does, or warn.
- [ ] **Two passthrough sources that write one file** (v8 #19): warn unless they're identical.
- [ ] **`minify()` shortens `checked="checked"` with `shortenAttributes: false`** (a11y #24): make
      it part of that option, or document that boolean attributes are always shortened.

### 3. One Markdown engine

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

### 4. The migration loop

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
  - Classes of difference: an HTML-aware normalization (`/>`, attribute quoting and spacing,
    entities, tag case) as a flag, and `--classes <file>` for a site's own normalizations, reporting
    the classes each page needs. opensource.guide's "Changed (387)" took a classifier of its own to
    turn into counted groups (osg `scripts/compare.py`, suggestions.md "Agent experience").
  - Say to build each side into an empty folder: stale files from an earlier build show up as
    differences (osg #15).
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

### 5. Output that matches what sites already style

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

### 6. Importer gaps

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

### 7. Moving from Jekyll

From opensource.guide (osg). The trailhead draft is in its `suggestions.md`.

- [ ] **Markdown inside HTML: `markdown="1"`** (and `"block"`, `"span"`) in `crates/ssqch-markdown`
      (osg #1): 3,791 elements in 327 of the site's files, and without it 325 pages show quote
      credits as raw `[@name](url)`. kramdown's and Python-Markdown's (MkDocs `md_in_html`). With
      `markdown: { htmlMarkdown: "kramdown" }` for kramdown's HTML rules: a block ends at its end
      tag, block tags only at a line's start (up to three spaces), unclosed elements close at their
      parent's end. The port's `markdownInHtml` (`_ssqch/jekyll.js`, 90 lines) is the behavior to
      port, and the site is the test. MDX needs it too, as an `"mdx"` mode (every element's
      content): 39 of the 53 expressjs.com pages whose text differs from Astro's (ex #6).
- [ ] **Ruby Liquid's behavior** where 0.7 followed the liquid crate (osg #7): `times`, `plus` and
      `minus` read text as Ruby's `to_number` does (`"r>"` is 0; jekyll-toc needs it); `split` drops
      trailing empty strings and splits `" "` on whitespace; `sort` on a hash gives `[key, value]`
      pairs, with missing values first by property; a block of only `assign`s renders nothing; the
      blank line after front matter goes with it. Deliberate changes with oracle entries, or a
      `liquid: { flavor: "jekyll" }`.
- [ ] **`page.<front matter key>` in Liquid** (osg #5): fall back to the page's data for keys `page`
      doesn't have, as Jekyll templates expect (42 edits in 7 templates, and a collision with the
      site's own `lang` variable). A design note first.
- [ ] **Config functions as Liquid tags** (osg #6): `{% seo %}`, as Nunjucks already does.
- [ ] **`{% include_relative %}`** (osg #8), reading beside the template.
- [ ] **ssqch/sass:** patch grass' `find_import` to search load paths for an import that names its
      extension (`visitor.rs:829-837`, "todo: consider load paths"; every primer file does it), and
      strip a leading empty front matter (osg #9, #10). Until then, an error that says so.
- [ ] **`headingIds: "kramdown"`** (kramdown's GFM ids, and its own ASCII ones inside HTML) and a
      **`code` render hook** for code spans (Rouge's `highlighter-rouge` classes) (osg #4).
- [x] **Skip `vendor/bundle` and `vendor/gems`** when walking the site (osg #12; done 2026-11-18,
      any folder with `ruby/<version>/gems/`).
- [ ] **Text templates in other formats** (`.js` with front matter): a recipe in the README, or
      `templateFormats: ["js:liquid"]` (osg #9).
- [ ] **`toc` options** for the list's, items' and links' classes and the list's `id` (osg #11).
- [ ] **`ssqch import jekyll`** (moved up from "Importer, the rest"): 9 of the move's 13 kinds of
      edit were mechanical (osg `edits.md`): `exclude`, collections and their permalinks,
      `defaults`, `site` and `site.data`, static files, front matter on `.js`/`.scss`, `page.`
      renames (listing collisions), the plugins (seo, sitemap, redirect-from, feed, github-metadata,
      github-pages' implicit ones and default theme), unknown tags, and a count of kramdown syntax.
- [ ] **`docs/trailheads/from-jekyll.md`** from the draft in osg `suggestions.md`, and the rows
      `ssqch docs --from jekyll` lacks (osg #16): `page.title`, `site.data`, `site.<collection>`,
      `collections`, `defaults`, `exclude`, `{% seo %}`, `include_relative`, jekyll-sitemap,
      `markdown="1"`, kramdown, Rouge, `site.time`. `jsonify` works in Liquid but its row says it's
      refused (`equivalents.ts:97`).
- [ ] Report the site's own bugs upstream (osg `issues.md`, last section): dead search, the
      language menu on one-word URLs, the breadcrumb, jekyll-toc's missing last heading, and the 21
      drifted untranslated copies.

### 8. Moving from component frameworks

From expressjs.com (ex). Its `suggestions.md` has ready-to-paste text for the component-frameworks
trailhead.

- [ ] **`tsconfig.json` `paths` in the module loader** (ex #5): Astro, Vite and Next.js sites import
      their own helpers through `@/` aliases, and ssqch says the package isn't installed; the port
      copied a helper with relative imports. Read `compilerOptions.paths` (and `jsconfig.json`).
- [ ] **Named slots in containers** (ex #4): `container.slots.<name>` from nested `::: slot
      name="…"` blocks, as MDX's `<Fragment slot>` and Edge components have them; the port marks
      slot output with comments and splits it in the parent's template. And `container.props` parsed
      from the arguments (`a="b" c='{"x":1}' flag`), which every container template here needed.
- [ ] **`ssqch import mdx`** (ex `edits.md`): component tags to containers by a map in the config,
      imports and `{/* */}` out, JSX props as arguments, fences left alone (indented ones in list
      items included), bodies dedented, links around cards folded in. The study's
      `scripts/codemod.mjs` (183 lines) converted 663 files and about 2,600 component uses with no
      hand edits; with a report of `getStaticPaths` files, path aliases, integrations and their
      ssqch answers, and env variables read at build.
- [ ] **`headingIds: "github"` byte for byte as github-slugger** (ex #6a): it keeps an emoji's
      variation selector (`#️-what-you-should-do`) and numbers punctuation-only headings (`#-1`),
      and ssqch's ids don't, so 29 expressjs.com pages link to anchors that aren't there.
      rehype-slug, Astro, VitePress and Docusaurus all use github-slugger. Also say in the
      component-frameworks trailhead that remark-gfm links a bare URL after a quote and GFM's spec
      (and ssqch) doesn't (11 pages).
- [ ] **A cache for generated images** (ex benchmarks.md): social images from a function (satori),
      kept by their inputs; the port's own `.cache/og` took the build from 6.3 to 2.0 s. Maybe an
      `ogImagePlugin({ render: (page) => element })`.
- [ ] **`quiet` and `verbose` in `BuildEvent`** (ex #11), and one code frame per distinct error
      location (a 222-page error printed the same frame three times).
- [ ] **Docs** (ex #12): `ssqch docs containers`, `pagination` and `data` answer with a table row or
      a feature list instead of the explanation (add them to `docs_answer_for_every_name`); when
      `page.headings`, `page.excerpt` and `templateContent` are available (after the page renders,
      not in `computed`); a fence hook example that writes `highlighted` (HTML) and escapes `code`
      (raw text); a release-age cooldown (`min-release-age` in `.npmrc`) holding back a new ssqch
      release, and sharp installing with `ignore-scripts`.
- [ ] Report the site's bugs upstream (ex `issues.md`, last section): 345 alerts with a translated
      `type`, ids from `Math.random()`, `llms` files without their `import` lines.

## Backlog

### Markdown

- [ ] **CJK-friendly emphasis** (osg #3): `**完成。**下一步` stays literal under CommonMark's
      flanking rules (16 opensource.guide pages, in 8 languages). `markdown: { cjkEmphasis: true }`,
      as markdown-it-cjk-friendly does; on by default, since it only adds emphasis where CommonMark
      printed asterisks.

- [ ] The alt text as HTML in the image hook (`image.altHtml`: links and code in captions, 25 v8.dev
      pages).
- [ ] Attributes on images, links and blocks (`![](a.png){.no-darkening}`, `{#id}` after a
      paragraph), as markdown-it-attrs does; ssqch has them for headings only (3 v8.dev pages).
- [ ] markdown-it-multimd-table's tables (`^^` rowspan, multi-line cells holding code fences), or a
      table and cell hook (3 v8.dev pages).
- [ ] markdown-it's URL normalization (`%` becomes `%25`, as mdurl does; 1 v8.dev page).
- [ ] `markdown(text, { html: false })`: lit.dev's API pages render doc comments with HTML turned
      off (41 pages).
- [x] A cache for highlighted fences: in memory across `ssqch serve`'s builds, and on disk in
      `.cache/ssqch/highlight/` for a new process (2026-11-18).
- [ ] Document the highlighting cache fully (done so far: the README paragraph, the Netlify
      recipe's list of what `.cache/ssqch` holds, the changelog): the GitHub Pages recipe's
      "Images" bullet becomes one about `.cache/ssqch` as a whole, and the README's benchmarks
      give a first build with and without it. (The blog's `netlify.toml` restores `.cache/ssqch`
      already, and its comment names the highlighted code now.)

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
- [ ] Liquid's speed beyond `where` (Now, 1): every liquidjs filter is wrapped in `asText`
      (`engines/liquid.ts:196-201`), which converts its input on each call. Measure it on the
      10,000-page benchmark in Liquid, and opensource.guide's exact port (the rest of its 1.6 s).
- [ ] Peak memory is about 0.5 GB for 9,000 pages (every page's HTML is held until it's written):
      stream pages out if a bigger site needs it.

### The dev server

- [ ] Incremental rebuilds in `ssqch serve` (a11y #20: 460 ms for all 115 pages, Eleventy 1.0 350
      ms; v8.dev 1.8 s, Eleventy `--incremental` 0.05 s; lit.dev's idiomatic port 2.9 s, Eleventy 22
      s). expressjs.com: `astro dev` shows a saved edit in 0.35 s, `ssqch serve` rebuilds 2,500
      pages in 1.2-1.4 s (ex benchmarks.md).
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

- [ ] Document the quality options on sharp's scale fully (2026-11-18): a how-to for moving a 0.7
      site's numbers (the changelog's table, and that converted numbers keep the cache), what
      `avifEffort` costs and saves on a cold build, the trailheads in `docs/trailheads/` (none
      says yet what Eleventy Image's `sharpAvifOptions` or Hugo's and Astro's `quality` become),
      and the blog's config as the worked example.
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
- [ ] `ssqch import hugo`. Weigh it against WordPress (below). (`import jekyll` is in Next, 7.)

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
- [ ] Answers for `ssqch docs seo` (it suggests `new`), `i18n`, `translations`, `hreflang` and
      `multilingual`, even if the answer is "not built in yet" with the recipe (osg #16), and an SEO
      tags example (or a `seoTags(page)` built in; every site writes the same 20 lines, osg #6).
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
    `wrangler` from GitHub Actions with `actions/setup-node`), whether its build cache can keep
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
      Hugo, and a trial with letsencrypt.org. opensource.guide's `i18n.md` is design input from a
      real site, ranked by pages affected: `page.translations` (it does two `where`s per language
      per page), hreflang, `t()` with fallback, fallback pages instead of copies (its 21 copies have
      all drifted), `site.languages` with direction (15 pages wrap their body in `<div dir="rtl">`).
      expressjs.com's `i18n.md` adds an Astro site's needs: shared untranslated sections (540
      pages), version aliases on top of languages, links localized from the source, sitemap
      alternates, retired languages (1,185 redirects), a content page's language in containers (ex
      #1).
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
