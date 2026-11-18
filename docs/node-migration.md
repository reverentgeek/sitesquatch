# Moving ssqch to Node.js: the implementation plan

Decided 2026-11-17. ssqch becomes a TypeScript program on Node, using the JavaScript template libraries themselves, with Rust plugins as `.wasm` files. This file is the plan; `TODO.md` ("The move to Node") has the checkboxes. The study behind the decision, and the two spikes, are in `research/architecture/` (gitignored, so only on the machine that ran them): `README.md` is the recommendation, `round-3-spikes.md` the spikes' results, `evidence.md` the measurements.

## Why, in numbers

- **Speed holds.** A spike core on the real libraries builds a 10,000-page site in 1.30 s on one thread (ssqch 0.7.0: 1.15 s on 15 cores, 2.79 s on one; Eleventy 7.78 s) and 1.10 s on four worker threads, at 308 MB (ssqch 0.7.0: 472 MB). The build is bound by the file system, and Node's thread pool writes files while JavaScript renders.
- **Exact ports get faster, not slower.** v8.dev's port builds in 0.54 s from its unchanged config (ssqch 0.7.0: 1.72 s with markdown-it on QuickJS; Eleventy 0.72 s), byte-identical.
- **What builders bring works.** Node runs all 21 tools the next migrations need (QuickJS runs 4), and a quarter of ssqch's own migration problems came from Rust versions of JavaScript libraries behaving differently.
- **Rust stays where it pays, as plugins.** A Rust plugin compiles to one `.wasm` file that runs in Node's WebAssembly on every platform. minify-html as a plugin runs 3.6 times faster than html-minifier-terser in the same Node process.
- **A Rust core under Node adds little.** A hybrid with ssqch's Rust Markdown and a Rust write pipeline built the same site in 1.12 s, and only clearly beat all Node on heavy per-page transforms (1.15 s against 3.07 s on one thread, 1.60 s on four workers).

## What stays the same

The contract is the product, so it doesn't move: `ssqch.d.ts` (the config, the modules and their exports), the commands and flags, the JSON reports' keys and `schemaVersion`, the diagnostic codes, the exit codes, the folder conventions, the build summary's lines and the voice. A site's `ssqch.config.js` keeps working; it now runs on Node. Everything that is ssqch's own design is ported, not redesigned: the cascade and its levels, content schemas, the link checker, `ssqch diff`, `ssqch inspect`, the importers, `ssqch docs`, the footprint and budgets, the errors that point at the spot.

## What we're building

- **`packages/ssqch/`:** the new package, TypeScript with erasable syntax only, so `node packages/ssqch/bin/ssqch.ts` runs the source as it is during development. Published compiled (Node doesn't strip types from files under `node_modules`), with its template libraries bundled so that installing it brings sharp and nothing else. It starts from the spike core (`research/architecture/spikes/node-core/`): config loading with a module hook for `import "ssqch"`, the site model, engines behind one interface, pages written as they render through the thread pool with back-pressure, worker threads that load the config themselves, and the accelerator seam.
- **Rust plugins as `.wasm`:** the SDK crate `ssqch-plugin` (from `research/architecture/spikes/hybrid/crates/ssqch-plugin`), a `wasm32-wasip1` target, ABI v1 (versioned; a plugin built for another ABI is refused with a message), and the Node loader with no dependencies. A plugin's npm package exports a function returning `{ name, rust: { wasm, options } }`. Native plugins stay out of v1.
- **The accelerator seam:** the core's leaf steps (Markdown, reading, the HTML pipeline, writing) behind an interface, so a native addon could take them over later without changing a site. Not shipped in 0.8. One rule for any accelerator: it may not change output.
- **The oracle:** black-box tests that run any `ssqch` given by `SSQCH_BIN`, and the outputs of 0.7.0 on every example, starter, the blog and the trial ports, so both implementations are checked by the same tests until the switch.

Layout during the move: `packages/ssqch/` (new), `crates/ssqch-plugin/` (new, published to crates.io), `tests/oracle/` (new), and the 0.7 implementation in `crates/` and `plugins/` unchanged until the release that switches, which removes it.

## Decisions before stage 2

Each is a product choice. A recommendation is given; the gate in brackets is the evidence to collect first.

**Decided 2026-11-17, after stage 0, as recommended:** D1 Nunjucks for `.jinja` and `.njk` (G4 failed), with a fork of nunjucks owned by ssqch; D2 ssqch's Markdown and highlighter as a built-in `.wasm` (G5); D3 ssqch's minifier as a built-in `.wasm`; D4 sharp, with its quality defaults chosen again from G3; D5 Node 22.18 as the lowest version; D6 0.8.0, with one last 0.7.x; D7 at stage 8, with both executables measured.

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | The default template language. ssqch teaches Jinja, on Rust's MiniJinja. | Keep Jinja if `minijinja-js` (MiniJinja as WebAssembly) renders a real layout within about twice Nunjucks' time [G4]. Otherwise make Nunjucks the default for `.jinja` files and list the differences; nunjucks was last published in April 2023, so plan to own a fork. |
| D2 | ssqch's built-in Markdown and highlighter: port them to markdown-it, or keep the Rust ones. | Keep them, as a built-in `.wasm` module, if G5 passes: existing ssqch sites (the blog) then don't change output, the `hl-*` classes and custom grammars (ChordPro) stay, and 2,500 lines of Rust aren't rewritten. Sites from Eleventy keep markdown-it through the config, as v8.dev does. If G5 fails, markdown-it with ssqch's extensions rebuilt on its tokens. |
| D3 | The minifier | ssqch's own (`plugins/minify`) as a built-in `.wasm`, for the same reasons; html-minifier-terser stays available through the config for byte parity. |
| D4 | Images | sharp, if G3 shows its files within about 15% of ssqch's at equal measured quality. |
| D5 | The lowest Node version | 22.18 (TypeScript configs load with no flag). The spike core gives byte-identical output on 22.23, 24.22 and 26.13 for the scale site and v8.dev. Node 22's support ends in April 2027, so plan the step to 24. |
| D6 | The version and the Rust line | 0.8.0, a "Breaking" release. One last 0.7.x of the binary and the crates with a note; no second line of development. |
| D7 | The standalone executable for Homebrew and the install script | `bun build --compile` (85 MB, measured in the study) or Node's single-executable feature (still "active development" in Node 26). Decide at stage 8 with both measured, including notarization and whether `.wasm` plugins run the same in it. |

## Stage 0 results (2026-11-17)

The full write-up, with every number and how to rerun it, is `research/architecture/stage-0-gates.md`; the scripts are in `research/architecture/spikes/` (`g2-blog/`, `images/g3.mjs`, `g4-jinja/`, `g5-markdown/` and `hybrid/plugins/markdown/`).

| Gate | Result | What it means for the decisions |
| --- | --- | --- |
| G2, the same output on every Node | **Pass.** The blog's 175 pages and 34 other files, built by a copy of the spike core with edge.js and G5's Markdown from the unchanged config, are byte-identical on Node 22.18.0, 22.23.5, 24.22.3 and 26.13.1, and with `TZ` at UTC, Los Angeles and Tokyo. | D5: 22.18 holds. The current Node releases all ship ICU 78.3, but 22.18.0 ships 77.1, and one of 91 `Intl` results differs between them (en-GB compact numbers). ssqch's own helpers stay off `Intl`, and the oracle runs on the lowest supported Node too. |
| G3, picture quality | **Pass on size, close on time.** At equal SSIMULACRA2, sharp's AVIF is 16% smaller than ssqch's, WebP 5% larger, JPEG 6% larger (3% smaller with mozjpeg). The blog's 531 files take sharp 17.4 s against ssqch's 14.4 s at AVIF effort 4 (1.2 times; effort 2 halves AVIF's time). | D4: sharp. Its quality numbers aren't ssqch's: ssqch's AVIF 60 matches sharp's 47, JPEG 80 matches 88, so the defaults are chosen again. |
| G4, Jinja through `minijinja-js` | **Fail.** 4.8 to 5.4 times Nunjucks with ssqch's (Nunjucks-style) escaping, because minijinja-js has no formatter and escaping runs in a JavaScript finalizer; 2.0 to 2.6 times with MiniJinja's own escaping (which changes output). Passing `collections` in each page's context is quadratic (350 to 525 times on 1,000 pages): page data is copied into WebAssembly on every render. | D1: Nunjucks for `.jinja` and `.njk`, by the fallback above. |
| G5, ssqch's Markdown and highlighter as `.wasm` | **Pass.** `markdown.rs` and `highlight.rs`, compiled unchanged through the plugin ABI (3.5 MB), give 0.7.0's bytes for all 128 of the blog's Markdown files on every Node version. Markdown runs 3.5 times faster than markdown-it; the highlighter (syntect) is 5 to 6 times slower than markdown-it with Prism, as it is natively (0.1 s for the blog on one thread). | D2: keep them as `.wasm`. Two things to design in stage 3: render hooks and custom highlighters call back into JavaScript, which ABI v1 can't do; and a cache for highlighted fences. |

Found on the way, for stage 2: a config that imports JSON without `with { type: "json" }` (the blog's does) fails on Node, and the spike's module hook now adds the attribute; folder data's `"tags": "posts"` has to join a page's own `tags` list, not be replaced by it; and edge.js's `renderRawSync` compiles on every call (the blog took 2 to 3 s in the spike, 0.1 s of it highlighting), so the Edge engine caches templates by file.

## Stage 2, so far (2026-11-17)

The core is in `packages/ssqch/src/`, ported from `crates/sitesquatch/src/build.rs`, `config.rs`, `data.rs`, `diagnostics.rs`, `report.rs`, `cli.rs`, `base.rs`, `theme.rs`, `equivalents.rs` and `voice.rs`, and from the config checks in `crates/sitesquatch-js/src/prelude.js`. `TODO.md` has what's left of the stage.

| Check | Result |
| --- | --- |
| The 10,000-page site, one thread | **1.41 s, 370 MB** on the laptop the limit was set on (0.7.0 on one thread: 2.67 s; the limit is 2 s). All 10,001 pages are byte-identical to 0.7.0's. On CI's Linux runner the same build takes 3.75 s and 0.7.0 3.42 s on one thread: the cores are slower, and 0.7's one-thread run isn't held up by the file system there. So CI compares a commit with its parent on the same runner and fails above 15% slower, and the times are checked on the laptop. |
| v8.dev's exact port | **0.57 s** whole (the limit is 0.72 s); rendering takes 0.27 s where 0.7.0 takes 1.5 s. Its frozen output (929 files), JSON report and summary match 0.7.0's on Node 22.18.0, 24 and 26. |
| The oracle | 61 of 184 tests pass, the same on the three Node versions: the config's checks and messages, data files, collections, transforms, hooks, `leaveNoTrace`, the cascade's aliases, bundles, the diagnostic codes. The rest wait for engines (stage 3), tools and starters (4), plugins (5), the server (6) and the importers (7). `tests/oracle/node-passing.txt` holds the build to what passes. |
| The same output everywhere | A site with pagination, collections, themes, bundles and passthrough copies builds to the same bytes on Node 22.18.0, 24 and 26, with `TZ` at UTC and Los Angeles. |
| Messages | Of 50 small sites that are broken or unusual in one way each, 33 print exactly what 0.7.0 prints. The others differ in a parser's own words (js-yaml, V8's JSON, smol-toml), in a path that's now absolute, or in a JavaScript error V8 words better. |

What the stage decided, or found:

- **Most of the oracle's core tests render with Edge**, so the core couldn't be checked without an Edge engine. edge.js is in, called plainly, a stage early; stage 3 finishes it (templates kept by file, async functions, themes' includes, errors as ssqch says them). Markdown is markdown-it for now, as in the spike core, so sites could be built and timed; stage 3 replaces it with ssqch's own as `.wasm` (D2).
- **`templateContent` is rendered on demand.** Pages are written as they render, one at a time; a page whose templates read `collections` renders last, as in 0.7, so the bodies it shows are ready and kept. A body that isn't ready is rendered when it's read, and a page that reads its own gets nothing, as before. Bodies are kept from the start when a template mentions `templateContent` or `.content`, and from the first read otherwise.
- **A site's code runs in its project root** (`process.chdir`), as 0.7 ran it: `process.cwd()`, `fs.readFileSync("x")` and `readData("x")` are from there.
- **A promise that never settles is caught on `beforeExit`.** Node would end the build without a word; the build fails with 0.7's message instead.
- **A syntax error's line comes from `node --check`.** Node gives the place only when it prints an uncaught error, so the files the site loaded are checked again, the last one first, in a copy.
- **Node's package errors are put in 0.7's words** (a package that isn't installed, a subpath `exports` doesn't have), and its warnings (`process.emitWarning`) are the build's warnings, without the process id.
- **Nunjucks prints a `Date` as ISO 8601**, as 0.7 did: JavaScript's own `String(date)` is in the machine's time zone, and a build's output may not depend on that.
- **Numbers in the summary round as Rust rounds them** (a tie goes to the even digit), so `12.2 KB` doesn't become `12.3 KB`.
- **No worker threads, for now** (decided 2026-11-17). One thread meets the limit with room. A worker loads the config itself, so module-level state in a config (a counter in a filter) would be split between workers, which 0.7 never did. `TODO.md` has it under "Parked", with what they'd need if a site asks for them.
- **An independent review found 17 differences from 0.7**, by reading the Rust and the TypeScript side by side and building about 30 small sites with both. Fixed: a date in `tags` named its tag in the machine's time zone; a linked folder in the input folder was built under one of its names, and a link back up or to nothing was skipped without a word; pages without a date were ordered by their files' times to the millisecond, where 0.7 has nanoseconds; a page that failed was reported once for each page that showed its content; `base` dropped a repeated attribute, lowercased a changed one's name and rewrote inside `<noscript>`; a file that isn't UTF-8 was built with replacement characters; `2024-1-5` wasn't a date; a glob that can't be read was matched as text, and `a**` crossed folders; a page's own data file wasn't found on a disk that doesn't tell `Page.md` from `page.md`; a JSON error could lose its line; and several flags' refusals. Recorded as deliberate, in the changelog: an object's keys that look like whole numbers come first, in number order, as JavaScript has them.
- **Windows passes the same list** (CI, on the three Node versions). Its first runs found three things to fix: Node spells a real path differently from the system where a folder has a short name (the runner's temporary folder), so real paths now come from the system; edge.js ends lines with the system's `\r\n`; and `node --test` wants its reporter as a file URL. And three places where Node on Windows is Windows' own, recorded in the tests and the changelog: `node:path`, `__dirname` and `__filename`, and the path in a missing file's error.
- **CI's benchmark compares, and doesn't check a time.** A commit's build against its parent's on the same runner, failing above 15% slower. Its phase line found a real cost on its second run: comparing a build's pages with the last build's searched a list for each page (1.8 s for 10,000 pages on the runner; 28 ms as two sets).
- **Four oracle tests record a deliberate difference** (each says why, and `CHANGELOG.md` has them under 0.8.0): data that refers to itself is allowed; filters get real objects, so there are no views to check; a CommonJS package's exports are named only where Node can read them; `fs.createReadStream` is Node's own.

## Stage 3, so far (2026-11-17)

Four ports ran in parallel, each in its own git worktree with its oracle tests as the definition of done, and were merged one by one: ssqch's Markdown as `.wasm`, Jinja and Nunjucks on a fork, Edge, and Liquid, Handlebars, Mustache and EJS. `TODO.md` has what's left of the stage.

| Check | Result |
| --- | --- |
| The 10,000-page site, one thread | **1.10 s, 363 MB** (1.45 s before the stage, measured with it; the limit is 2 s). Rendering went from markdown-it to the `.wasm`. |
| v8.dev's exact port | **0.59 s** (the limit is 0.72 s); it brings its own markdown-it, which still works. |
| The oracle | 86 of 186 tests pass, the same on Node 22.18, 24 and 26 (61 before): every engine's tests, the Markdown tests, front matter, and a11yproject.com's frozen site. What fails waits for `init` and the tools (stage 4), plugins (5), the server (6) and the importers (7). |
| Real sites, plugins taken out of both builds' copies | The 12 starters match 0.7 but for the version in their footers; the six Jinja and Nunjucks examples match; the blog's Edge pages and its 128 Markdown files (172 highlighted fences) match. |

What the stage decided, or found:

- **The Markdown `.wasm` is committed** (`packages/ssqch/wasm/markdown.wasm`, 3.76 MB, from `crates/ssqch-markdown/`, which compiles 0.7's `markdown.rs` and `highlight.rs` unchanged), so the Node build runs from a clone with `npm ci` and CI's Node jobs need no Rust. It carries a hash of its Rust inputs, and a unit test fails when they've changed without a rebuild. Its interface is its own, not plugin ABI v1: render hooks, containers, `headingIds` functions and custom highlighters are synchronous calls back into JavaScript, and a hook whose template answers with a promise is an error. Highlighted fences are cached in it across a process's builds; a process's first highlighting is slow (syntect compiles each grammar's patterns on first use: about 0.3 s of the blog's first build).
- **The nunjucks fork is in the repository** (`packages/ssqch/vendor/nunjucks/`, installed as `file:vendor/nunjucks`): its first commit is 3.2.4 as published, so `git diff` of the next shows the whole fork (about 60 lines, each marked `ssqch:`). `.jinja` keeps 0.7's MiniJinja library (filters, tests, Python's string methods, dates), and what Nunjucks does differently (scoping, `break`, floats) is in the changelog.
- **Edge stays edge.js**, with its parser hooked for ssqch's own engine's instances: what 0.7's Edge did that edge.js doesn't (an undefined value prints nothing, a call reaches the filter beside a field of the same name, object literals in mustaches, `@let` that reads what it replaces) and async rendering that starts synchronous. Templates and includes are compiled once.
- **Liquid, Handlebars and EJS load with their first template**, with `require` because rendering is synchronous: loading all three took about 12 ms of every build. liquidjs names months through `Intl` and reads dates in the machine's time zone, so the Liquid engine has a port of 0.7's `strftime`.
- **Node 22.18 has a bug the others don't:** with any `load` hook registered (`module.registerHooks`), a CommonJS module's `require` has no `cache` (fixed by 22.23). Prism's language loader uses it, so a11yproject.com failed only there. ssqch's module hooks have no `load` hook now.
- **Front matter** was checked with 24 unusual cases on both builds: TOML's integers past 2^53 are rounded numbers again; js-yaml's numbers (`017` is 17) and merge keys, and smol-toml's millisecond dates, are recorded in `cli/front-matter.test.js` and the changelog.
- **The examples can't pass yet:** all eight use `ssqch/links`, a stage 5 plugin, so the stage's "done when" for them moves with stage 5.

## Stages

Weeks are focused work for one person with coding agents, from the study's estimate. Stages 3 to 7 can run in parallel once stage 2 has fixed the core's interfaces.

| Stage | What | Done when | Weeks |
| --- | --- | --- | ---: |
| 0. Gates | G2: build the blog on Node 22, 24 and 26 and compare with `ssqch diff --exact`. G3: sharp against ssqch's AVIF and WebP at equal SSIM on the blog's photos. G4: Jinja through `minijinja-js` with real page data. G5: `crates/sitesquatch`'s `markdown.rs` and `highlight.rs` in a crate that builds for `wasm32-wasip1`, run through the plugin ABI in V8, against 0.7.0 on the blog's posts (byte-identical) and against markdown-it (time). Then D1 to D7. | Each gate has a written result and each decision is recorded in this file | 1 |
| 1. The oracle | Turn `crates/ssqch/tests/cli.rs` into tests that run `SSQCH_BIN` (black box: arguments in, files, stdout, stderr and exit code out). Freeze 0.7.0's output for every `examples/sites/` site, the starters (`ssqch init` for each engine), the blog, and the three trial ports. Write the JSON report's shape and the diagnostic codes down as tests. Run the oracle in CI against 0.7.0. | The oracle passes on 0.7.0 on Linux, macOS and Windows | 1 |
| 2. The core | Start from the spike core. Config and validation (the rules and messages in `crates/sitesquatch-js/src/prelude.js`, the equivalents table), data files (JSON, YAML, TOML, JS), the cascade with `ssqch inspect`'s record of who set each value, computed data, collections, pagination, permalinks, layouts, transforms, hooks, passthrough with symlinks, drafts, `base`, `leaveNoTrace`, conflicts, the build summary, `--format json`, diagnostics with file, line and excerpt (`locate` and `code_for` for each engine), the voice. A benchmark in CI. | The oracle's core tests pass on Node 22, 24 and 26; the 10,000-page site builds in 2 s or less on one thread and v8.dev in 0.72 s or less | 2 to 3 |
| 3. Engines and Markdown | Nunjucks and Jinja (D1), liquidjs, edge.js, handlebars, mustache, ejs, behind one interface, each with ssqch's built-in filters and its errors mapped to a file and a line. Markdown (D2), front matter (YAML, TOML, JSON), async filters (synchronous until a filter returns a promise, as in the spike). | The oracle's template tests and every example site pass | 2 |
| 4. Checks and tools | Schemas and `ssqch types`, the link checker, `diff`, `inspect`, footprint and budgets, `docs` (the README built in), `new` and blueprints, `init` and the starters, `capabilities`. | The oracle's tool tests pass | 2 |
| 5. Plugins | Images (D4) with the cache and hash names, `image()`, `imageUrl()`; rss, minify (D3), assets, sitemap, redirects, Sass, elements, themes. The Rust plugin SDK made public: the crate, the loader, an example plugin, and a README section that says when a Rust plugin pays (heavy work; a regex is as fast in JavaScript). | The oracle passes for every built-in plugin; the blog builds | 2 |
| 6. The dev server | Watching, page-only reload, stylesheet swap, errors in the browser, `serve.run`, `--ready-file`, reloading a changed config (bundle it to a temporary file and import that, as Vite does). | The oracle's serve tests pass | 1 to 2 |
| 7. Importers | `ssqch import eleventy` (simpler: a site's packages now run as they are) and `ssqch import zola`. | The trial ports import and build | 1 |
| 8. Distribution | The compiled, bundled npm package with provenance through `publish-npm.yml`, without platform packages; the standalone executable (D7) for Homebrew and the install script; the `setup-ssqch` action; Netlify. Retire `dist` and the notarization steps that only the Rust binary needed. Test installing the packed tarball in CI. | A release candidate installs and builds every example on Linux, macOS and Windows | 1 |
| 9. Sites and docs | **Blog:** move the blog and compare with `ssqch diff`. The examples, starters and trial ports; the README (the known gaps change), the trailheads, the changelog's "Breaking" entry, new benchmarks, and `AGENTS.md` rewritten for the TypeScript codebase. | 0.8.0 released, the blog deployed on it | 1 |

Before stage 2 starts, `AGENTS.md` gets a section for `packages/ssqch/` (its commands, `node --test`, type checking with `tsc --noEmit`, and the conventions), so every session after that works from it.

## Running it with coding agents

### Which model for which work

All four current models have a 1M-token context window. API list prices per million tokens, input and output, as a guide to relative cost: Claude Fable 5.2 $8 / $40, Claude Opus 5.5 $4 / $20, Claude Sonnet 5.5 $2 / $10, Claude Haiku 5.5 $0.10 / $0.50. Change them in Claude Code with `/model` and `/effort`.

| Work | Model and effort | Why |
| --- | --- | --- |
| Stage 2, the core; the worker model; the dev server's rebuilds; the cascade, pagination and collection ordering where the oracle disagrees in subtle ways | **Claude Fable 5.2 at `high`** | Long autonomous work that has to hold one design in mind, where a wrong early choice costs weeks. The most capable model. Start at `high`; use `xhigh` only where it measurably helps. |
| Most porting (stages 3 to 7), and the lead session of each stage | **Claude Opus 5.5 at `xhigh`** | The workhorse: strong at coding and agentic work, half Fable's price. `xhigh` is Claude Code's default for coding and suits this; don't lower it to save cost when the session is making design calls. |
| Well-specified ports with oracle tests already written: the built-in plugins, `docs`, `new`, `init`, `capabilities`, CLI flags, converting `cli.rs` to black-box tests, documentation edits | **Claude Sonnet 5.5 at `high`** (or `medium`) | Fast and capable for everyday coding when the spec and tests leave little to decide; half Opus' price. |
| Finding where the Rust code does something, summarizing a test run or a long `ssqch diff`, running benchmark matrices, checking links in the docs | **Claude Haiku 5.5 at `low`**, usually as a subagent | Cheap and quick for reading and summarizing. Escalate when it has to judge rather than find. |

A session that's going in circles on a hard problem should move up a model, not up in effort. A session doing mechanical work at Opus or Fable should move down.

### Where subagents help

- **A brief before each port.** Before porting a module, an Explore subagent (Sonnet or Haiku) reads the Rust module, its tests and its README section, and returns the behavior to keep: inputs, outputs, error messages word for word, and the edge cases its tests pin. The lead session keeps the conclusion, not 1,000 lines of Rust.
- **Parallel ports, after stage 2.** One subagent per engine, plugin, tool or importer, each in its own git worktree (`isolation: "worktree"`), with the oracle's tests for that feature as its definition of done. The lead reviews and merges. Run three or four at a time: more means merge conflicts in the files where features register (the config's keys, the engine table) and more review than one person can do well.
- **An independent review per stage.** A fresh agent, or `/code-review`, given the stage's diff and the oracle, not the lead's reasoning. A reviewer handed the lead's conclusion tends to confirm it.
- **Parity triage.** When the oracle fails across many sites, one subagent runs it, groups the `ssqch diff` output into causes and ranks them by pages affected. That's the migration loop the trial ports ran by hand.
- **Benchmarks in the background, alone.** Run them as a background task while nothing else compiles: in the spikes, a parallel Rust build doubled some timings and the run had to be repeated.

Where they don't help: stage 2 itself (one design, best done by one session), splitting one feature between agents, two agents editing the core's shared files at once, and lookups a single search answers.

For a bigger fan-out (stage 1's snapshots of every site, or stages 3 to 5 as port, test and review pipelines), Claude Code's workflows can orchestrate subagents with a verification step each. They run only when asked for ("use a workflow"), and they spend tokens quickly, so keep each one under about ten agents and to work whose pieces really are independent.

### How each session runs

- **One stage, or one feature, per session.** Start from this file, the stage's section in `TODO.md` and the oracle. End by ticking `TODO.md`, adding to `CHANGELOG.md` (under "Breaking" for anything a site has to change), and committing.
- **The oracle decides, not the session's judgment.** A port is done when its oracle tests pass on Linux, macOS and Windows and on Node 22, 24 and 26. A deliberate difference from 0.7.0 is recorded in the test with the reason and in the changelog.
- **Keep the Rust build working until the switch**, so the oracle's expected outputs can be made again (`cargo build --release -p ssqch`).
- **Add `../blog`** (`--add-dir ../blog`) for G2, G5 and stage 9.
- **Speed and memory stay in view.** The CI benchmark fails a change that makes the 10,000-page site slower than 2 s on one thread or v8.dev slower than 0.72 s.

## Risks, and what catches each

| Risk | What catches it |
| --- | --- |
| The core gets slower as features land | The CI benchmark and its thresholds |
| Output changes between Node versions (dates, sorting, `Intl`) | The oracle on Node 22, 24 and 26 in CI; ssqch's date filters don't depend on `Intl` |
| The libraries' errors are weaker than ssqch's (nunjucks gives no line for an unknown filter and drops the site's stack frame) | Diagnostics tests per engine: an unknown filter names its line, a thrown filter names the site's file and line |
| Async filters and synchronous reads (permalinks, `templateContent`) | Tests for both, from v8.dev's feed |
| Memory with worker threads (about 140 MB each) | Workers only above a page count; the benchmark records peak memory |
| A write queue without back-pressure (found in the spikes: 4.5 GB and a crash with 256 pages in flight) | A test with many pages in flight |
| A package that works from the repository but not from npm (type stripping doesn't apply in `node_modules`) | CI installs the packed tarball and builds every example |
| Windows paths and line endings | The oracle on Windows from stage 1 |
| Dependency rot | Bundled, pinned libraries; nunjucks forked if D1 keeps it |

## The release

0.8.0 is "Breaking" in full. The draft entry is in `research/architecture/plan.md` ("Changelog"): ssqch needs Node 22.18 or newer (or the standalone executable), configs and data files run on Node by Node's rules for ES modules and CommonJS, filters get the real objects, Rust plugins are `.wasm`, the Rust API and the `sitesquatch` crates end at 0.7. The Markdown and images lines depend on D2 and D4. Tag only after CI passes on the tagged commit, as `AGENTS.md` describes.
