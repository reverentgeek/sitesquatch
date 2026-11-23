# AGENTS.md

SiteSquatch (`ssqch`) is a static site generator: a TypeScript program on Node, in
`packages/ssqch/`, with ssqch's own Markdown, highlighter, minifier and Sass as `.wasm` files
built from Rust. The docs are the pages in `site/src/docs/` (sitesquatch.dev/docs, and
`ssqch docs`), the README is the front page, and `research/TODO.md` has the plan. `research/` is
gitignored: the roadmap is the owner's, on this machine, and not published (moved there
2026-11-19, with the archived lists in `research/archive/`). If it isn't there, ask for it.

ssqch 0.7, the Rust binary, was removed from `main` before 0.8.0 (it lives on in the
`release/0.7` branch and the `v0.7.x` tags). What it was is frozen in the oracle (`tests/oracle/`):
its black-box tests and the output 0.7.0 built for every example and starter.
`docs/node-migration.md` has the move's plan, its decisions D1 to D7, what each stage found, and
the switch. The Rust left in `crates/` is what the `.wasm` files are built from, and the plugin
SDK. Comments that say a file is "from" or "ported from" `crates/...` or `plugins/...` name 0.7's
source, on `release/0.7`.

## What ssqch is for

ssqch is for developers, and more and more for builders who work with a coding agent. What comes
first is the least friction and a tool that's a delight to use, one that's genuinely useful to
them (the owner, 2026-11-17 and 2026-11-22). Judge a design choice by that: does what the builder
already has just work, does the error say what to fix, is the install one line, does `ssqch docs`
have the answer an agent needs. Don't judge it by the size of the install, by "no Node", or by
keeping the Rust: one binary with no runtime was an experiment, and 0.8 moved to Node because a
site's own npm packages working unchanged mattered more.

- **Its own design:** the best ideas from many generators and the gaps they leave (checking
  content, knowing what a change did, errors that point at the spot, a site that agents can
  read), and a clone of none. "Working with the blog", below, has the rules.
- **Easy for everyone:** every option is documented, tested and learned by every user, so a
  feature has to be worth that to all of them ("Gaps a move finds", below).
- **Fun:** "If you're going to use a tool, make it fun to work with." "The Sasquatch voice",
  below, says how.
- **Speed and memory are "icing on the cake":** they're part of done ("Speed is part of done",
  below), and not what the next piece of work is chosen for.

When two pieces of work compete, this is the order:

1. A bug, or a page that's silently wrong, in what ships.
2. Friction any site meets: installing, starting, writing with the dev server, reading what a
   command prints, deploying.
3. What makes a site ready for the agents that read it.
4. Documentation owed for what shipped: an agent can use only what `ssqch docs` answers.
5. Moving in from another generator, by "Gaps a move finds".
6. Bets, each waiting on its evidence.

`research/TODO.md` opens with the same list ("What the list is measured against") and is in that
order, and `research/positioning.md` has the reasons and what changed on 2026-11-17.

## Working with the blog

The ReverentGeek blog in `../blog` (github.com/reverentgeek/blog) is the main real-world site and
the integration test. Start sessions with `--add-dir ../blog` (or `/add-dir ../blog`) when a
change affects it.

- Not a clone of Eleventy or of any other generator. ssqch started as an Eleventy-compatible
  build for the blog, and that was removed (see "Remove Eleventy" in
  `research/archive/todo-2026-11-17.md`): ssqch has its own design, and doesn't copy another
  generator's API wholesale. Take the best ideas from existing generators, fill the gaps they
  leave, and design each feature as ssqch's own, so the result is something unique that appeals
  to lots of developers. Making the move easy is part of that: things should feel familiar and
  inviting, so an alias for a word people bring from another generator (Eleventy's included:
  `ssqch dev`, `pathPrefix`) is welcome where it makes moving easier and doesn't mean something
  else in ssqch. ssqch's own name stays the one the docs teach. Blog content about Eleventy
  (posts, their URLs) isn't an API and stays. Research on other generators goes in `research/`
  (gitignored); the work items go in `research/TODO.md`.
- Other generators' words come from one table, `packages/ssqch/src/equivalents.ts`: ssqch's name
  for each, what to say, and where to read more. Errors and warnings use it to name ssqch's
  word (`"pathPrefix" isn't a config option. In ssqch it's base`), and each row is tested
  (`other_generators_words_get_ssqch_names`). A row is an alias (`alias: true`: the word works
  and says ssqch's name once, `note: pathPrefix works; ssqch calls it base`) when it means the
  same thing in ssqch, and a hint (refused, with ssqch's name) when it would mean something
  else; the test checks that an alias works and a hint refuses. `equivalents.test.ts` keeps it
  equal to the oracle's copy (`tests/oracle/cli/aliases.test.js`).
- Gaps a move finds: document a workaround, or build for everyone. A trial or a fresh run finds
  what a move from another framework needed, and not every gap is closed in ssqch. For each one:
  1. **A reasonable workaround exists:** a person or an agent gets what they need with what ssqch
     has (a few lines of config, a template, a hook, a transform, a data file). Write it in that
     framework's trailhead (`site/src/docs/trailheads/from-<framework>.md`), ready to paste, with
     what it costs, and have scout point at it when it finds the case. Don't build it into ssqch
     unless building it is small and worth having for everyone, not just for people moving from
     that one framework.
  2. **No reasonable workaround:** judge the feature by what it's worth to every ssqch site. Build
     it when it's useful beyond the migration (a good idea from that framework that ssqch's own
     users would want). One that only reproduces a framework's behavior for the people leaving it
     needs a strong reason, written down; otherwise list it in the trailhead as a known gap.

  "Reasonable" means an agent following the trailhead does it in minutes, without reading ssqch's
  source, and it keeps working as the site changes; code that has to be redone on every upgrade,
  or copies ssqch's internals, doesn't count. Bugs in what ssqch already has are fixed as bugs.
  Why: ssqch is meant to be approachable and easy for everyone, with the best ideas from many
  frameworks, not a set of compatibility layers for each. Every option is documented, tested and
  learned by every user, so it has to be worth that to all of them. In `research/TODO.md`
  ("Moving in: what the runs left, sorted"), mark each gap from a run **document**, **build** or
  **known gap**, with the reason.
- After a change that affects output, build the blog with the Node build and run its smoke tests:
  in `../blog`, `SSQCH_BIN=../ssqch/packages/ssqch/bin/ssqch.ts pnpm test`. The oracle has the
  blog's frozen output too (`node --test --test-name-pattern="^blog builds" sites.test.js` in
  `tests/oracle/`, where `../blog` and the local snapshot are there).
- The two TODO lists coordinate the work. This repository's `research/TODO.md` marks what the
  blog is waiting on with **Blog:**, and `../blog/notes/TODO.md` (the blog's `notes/` folder,
  gitignored too) marks what needs a change here with **Needs ssqch:**. When work lands on one
  side, update both lists.
- A change that breaks existing sites goes under a "Breaking" heading in the changelog, saying
  what a site has to change. Then update the blog in the same session.
- `../blog` has its own `CLAUDE.md` (run `pnpm run lint` after JavaScript changes). Follow it
  when editing files there.

## Commands

Run from `packages/ssqch/` unless it says otherwise.

- `node bin/ssqch.ts build --root <site>` runs ssqch from its source, with no build step: Node
  strips the types.
- `node --test` runs the package's own unit tests (`*.test.ts` next to the code they test).
- `npx tsc --noEmit` type-checks. Keep it clean; CI runs it.
- The oracle (`tests/oracle/`, see its README) is the black-box suite: arguments in; files,
  output and exit codes out. From `tests/oracle/`, `node --test` runs all of it with ssqch from
  its source (one file: add its path, such as `cli/init.test.js`; `SSQCH_BIN` runs another
  ssqch). Run it on Node 22.18 (the lowest supported), 24 and 26 before calling something done;
  every test passes. `node freeze.js <site>...` freezes a site's output again, which is how a
  deliberate change to it is accepted (the oracle's README, "Changing a site's output").
- `node bench/bench.ts` is the speed check: 10,000 pages in 2 s on one thread and v8.dev in
  0.72 s, on the machine those limits were set on (an Apple M-series laptop). Run it alone,
  with nothing compiling beside it. With `--baseline <another checkout's packages/ssqch>` it
  compares two builds instead, which is what CI does.
- `node scripts/build.ts` builds the npm package into `dist/` (bundled with esbuild; sharp is its
  one dependency), and `node scripts/check-package.ts` installs that tarball in an empty folder
  and builds every example with it. "Releasing" has the rest.
- `packages/ssqch/bundled/` holds what the package reads at run time beside its code:
  `ssqch.d.ts`, the starters (`starter/`, `starter-docs/`) and the completion scripts. Edit them
  there. The docs (`ssqch docs`, and the trailheads for `ssqch docs --from`) are the website's
  pages in `site/src/docs/`: from the source, `src/bundled.ts` reads them there, and
  `scripts/build.ts` copies them (the `.md` files and `nav.yml`) into the package's
  `bundled/docs/`.
- `node scripts/build-wasm.ts` builds the Rust the Node build runs as WebAssembly: ssqch's
  Markdown and highlighter (`crates/ssqch-markdown`, 0.7's `markdown.rs` and `highlight.rs`,
  moved there) as `wasm/markdown.wasm`, its minifier (`crates/ssqch-minify`, 0.7's
  `plugins/minify`, moved there) as `wasm/minify.wasm`, its Sass (`crates/ssqch-sass`, grass at 0.7's
  version) as `wasm/sass.wasm`, and the example Rust plugin
  (`examples/rust-plugin/trail_guide.wasm`). They're committed so the Node build needs no Rust.
  Run it after changing that Rust (`node scripts/build-wasm.ts minify` builds one; the lists are
  in `scripts/wasm-inputs.ts`); `scripts/wasm-inputs.test.ts` fails until then. It needs
  `rustup target add wasm32-wasip1`.
- `site/` is sitesquatch.dev, built with this repository's ssqch (`research/TODO.md`, "The website",
  has the plan). From `site/`: `node build.ts` builds it and fails on any warning, `node --test
  "tests/*.test.ts"` checks its colors' contrast, that the docs back its numbers and that every docs
  page is in `nav.yml`, and `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it. The docs
  pages are the documentation's one source: `site/src/docs/`, in the order `site/src/docs/nav.yml`
  gives (the sidebar, and the order `ssqch docs` reads them in, the first page as its top section
  and each other as a `##` section). A new page goes in `nav.yml` (the tests fail until it's there).
  After changing a number the landing page shows (the benchmarks, a known gap), update
  `site/src/_data/benchmarks.js` or the page; the `check` job in `.github/workflows/site.yml` fails
  until they agree. That workflow also deploys the site to Cloudflare: a preview for each pull
  request, and production from `main`, so the site can be ahead of npm. Documentation for a feature
  that's merged and not released starts with `> [!NOTE]` and `> **Not released yet.** This ships
  with the next version of ssqch.`, until the release (step 2 of "Releasing").
- `docs/assets/` holds the drawings (black line art, SVG) for the README, the docs, examples and
  website, and `docs/assets/stickers/` a sticker of each: the drawing on a white shape with a
  border, so it reads on a light page and a dark one. After adding or editing a drawing, run
  `node scripts/stickers.mjs` from the repository root (or name the drawings to make); `HULL` in it
  lists drawings whose outline is open, like the mountain. The README and the docs pages float a
  sticker beside a section with `<img align="right" ... alt="" width="96">` on a line of its own
  (a docs page's `src` is relative, `../../../docs/assets/stickers/...`, which the site points at
  its copy), which `ssqch docs` leaves out.
- Plugins written in Rust are `.wasm` files built with `crates/ssqch-plugin` (ABI v1, its
  README), loaded by `src/rust-plugin.ts` from a config's `{ name, rust: { wasm, options } }`.
- The Rust, from the repository's root: `cargo test --workspace` runs the `.wasm` crates', the
  SDK's and the example plugin's tests, and `cargo clippy --workspace --all-targets -- -D
  warnings` (and again with `--lib --target wasm32-wasip1`) lints them. To see what 0.7 did,
  read the oracle; to run it, install it (`npm install --prefix <dir> ssqch@0.7.0`, then
  `<dir>/node_modules/@ssqch/<platform>/bin/ssqch`) and compare with `ssqch diff <0.7 output>
  <0.8 output>`.
- CI (`.github/workflows/ci.yml`) runs the Node build's unit tests and the whole oracle on
  Linux, macOS and Windows on Node 22.18, 24 and 26; builds and checks the npm package on Linux
  on the same three (`package`, see "Releasing"); runs `node-benchmark` (below); and runs the
  Rust's tests and clippy, natively and for `wasm32-wasip1` (`rust`). Keep clippy clean. A push
  whose tree a pull request's CI already passed with (a merge commit, when the branch was up to
  date) skips those jobs and passes (`already-tested`), and a change only to `site/` (and its
  workflow) or the repository's prose (the README, `CONTRIBUTING.md`, `AGENTS.md`,
  `CHANGELOG.md`, `docs/`) or the agents' skills (`.claude/`) doesn't run CI at all: `site.yml`
  checks and deploys the site. A
  change to a docs page (`site/src/docs/`) does run CI, since `ssqch docs` reads the pages. When
  something CI tests starts reading one of those files, take it out of `paths` in `ci.yml`. A
  pull request that changes the
  release's own files runs `release.yml` up to the release, unsigned. The Rust isn't formatted
  with rustfmt (it uses long lines), so don't run `cargo fmt`.

## Rules

- **The contract is frozen in the oracle.** `ssqch.d.ts`, the commands and flags, the JSON
  reports (`tests/oracle/contract/shapes.json`), the diagnostic codes, exit codes, folder
  conventions, the build summary's lines and the voice: 0.7's, as 0.8 kept them, with 0.8's
  deliberate differences. A change to any of them is deliberate, and recorded where it's
  tested (a `DELIBERATE (0.8)` comment, `DELIBERATE` in `sites.test.js`, or a site frozen again
  with `node freeze.js <site>`) with its reason, and in `CHANGELOG.md` (under "Breaking" when a
  site has to change). Never edit a snapshot or `shapes.json` by hand to make a test pass. A JSON
  document 0.7 didn't print gets its shape from the version that adds it: list it in `ADDED` in
  `contract/shapes.test.js` and run it with `SSQCH_FREEZE_SHAPES=new`, which leaves the others as
  they are.
- **ssqch's own designs stay ssqch's** (the cascade, schemas, the link checker, `diff`,
  `trace`, `scout`, the equivalents table, the voice lines). To see what one does, read
  its module and its tests here and in the oracle; 0.7's Rust is on `release/0.7`, and a
  subagent can brief you on a module.
- **TypeScript with erasable syntax only** (`erasableSyntaxOnly` in `tsconfig.json`): no
  `enum`, `namespace` or constructor parameter properties, and `import type` for types.
  Relative imports name the `.ts` file. ES modules throughout.
- **Dependencies:** the template and Markdown libraries pinned exactly, and sharp. Nothing else
  at run time without a reason in the commit message; the published package bundles them (and
  `scripts/build.ts` lists what stays outside the bundle in `EXTERNAL`). ssqch's own Markdown,
  highlighter, minifier and Sass are `.wasm` built from the Rust (D2, D3).
- **Same output everywhere.** Nothing a build writes may depend on the machine's time zone, the
  locale, the order the file system lists files in, the number of threads, or the Node version.
  ssqch's own date filters and sorting don't use `Intl` (its results change between Node
  releases); a site's code may.
- **Speed is part of done.** CI's `node-benchmark` job builds the 10,000-page site with a
  commit and with its parent on the same runner, and fails a change that makes it more than
  15% slower (a time measured on one machine doesn't hold on another). The times themselves,
  2 s on one thread and 0.72 s for v8.dev, are checked with `bench/bench.ts`. Write pages as
  they render, through a queue with back-pressure, and don't copy per page what can be shared.
- **Errors point at the spot.** A library's error (nunjucks, liquidjs, edge.js, a site's
  filter) becomes ssqch's: the site's file and line, an excerpt, the diagnostic code, and
  "did you mean". Each engine has a test for an unknown filter and for a filter that throws.
- **Windows:** paths through `node:path`, URLs and output paths with forward slashes, and no
  shell-only commands in code or tests.
- **`ssqch serve` builds in a second process** (`src/serve/builder.ts`), which it starts again
  when the config or a module it loaded changes. What a module keeps between builds (a cache)
  lasts until then, and is never the server's: the server learns about a build from what the
  builder sends it. A plugin that reads files of its own lists them (`config.watch`, or
  `startReading` in `src/plugin-files.ts`) so a change to one rebuilds.
- **The bundle** (`scripts/build.ts`): `createRequire(import.meta.url)` is called inline,
  `import.meta.dirname` and `filename` aren't used, and a dynamic `import()` of a relative path
  that isn't a literal breaks in it. A new module needs its exports in `ssqch.d.ts` and an entry
  in `BUILT_IN`; a bundled library that looks for files beside itself goes in `KNOWN_LOOKUPS`.
- **Style:** tabs, double quotes and semicolons, as the rest of the repository's JavaScript;
  long lines are fine. Comments say why, in the voice of the docs.

## Skills

Three procedures are skills in `.claude/skills/`, each a `SKILL.md` that an agent loads when the
work calls for it (or reads as a page, if it doesn't load skills):

- `release`: a release from the commit to the blog's bump, with what to do when a step fails.
  `scripts/preflight.mjs` checks a release commit for what the workflow would refuse its tag for.
- `done-check`: what "done" means for a change, as one pass over "Commands", "Rules" and
  "Conventions". `scripts/checks.mjs` lists the checks the changed files call for.
- `fresh-run`: an agent that has never seen ssqch builds a new site or moves a real one, and how
  its findings are sorted into `research/TODO.md`. Its briefs are in `references/`.

This file says why each rule is as it is; a skill is the order to do things in. When one changes,
change the other.

## Releasing

A release is ssqch's npm package, from `packages/ssqch/`, built and published by
`.github/workflows/release.yml` (written by hand) from a version tag, and a Homebrew formula that
installs it. ssqch ships through npm only: there's no standalone executable and no installer
script (the owner's call, 2026-11-18). dist, which built the Rust binaries, is retired, and so
are the npm wrapper and its platform packages (`npm/ssqch`, `@ssqch/<platform>`,
`scripts/npm-packages.mjs`) and `setup-ssqch`: the package is JavaScript, the same on every
platform. `docs/node-migration.md` ("Stage 8") says why each piece is as it is.

- **The npm package:** `node scripts/build.ts` in `packages/ssqch/` builds it in `dist/` (esbuild
  bundles the code and the template libraries; sharp is the one dependency), and `npm pack
  ./dist` packs it. It's private until `--release`, which the release workflow passes.
- **The check:** `node scripts/check-package.ts` (or `--tarball <tgz>`) installs it in an empty
  folder outside the repository, builds every example, a starter, and a site with images,
  Markdown, minify, Sass and the example Rust plugin, and compares the output with the source's,
  byte for byte. `--oracle` runs the oracle with it too. CI runs it on Linux on Node 22.18, 24
  and 26 (with the oracle on 22.18), and the release on the same three, without the oracle.
- **The Homebrew formula:** `scripts/release-files.mjs` writes it (`ssqch.rb`) and `sha256.sum`
  from the packed tarball. The formula is Homebrew's pattern for an npm package: `depends_on
  "node"`, `npm install` with `std_npm_args` from the registry's tarball URL and the tarball's
  SHA-256 (`npm publish` uploads the tarball as it is), and a link to `ssqch` in `bin`. Its test
  builds a page.

To release (CI runs once: on the pull request; its merge commit's run sees the same tree and
skips, see `already-tested` in `ci.yml`):

1. On the pull request's branch, as its last commit (`Release <version>`), or on a branch of its
   own: in `CHANGELOG.md`, rename `## Unreleased` to `## <version> - <YYYY-MM-DD>` (semver;
   while 0.x, a breaking change bumps the minor version). The workflow refuses a tag whose
   version has no section, which becomes the release's notes.
2. Set `version` in `packages/ssqch/package.json` to match (and run `npm install` there, so
   `package-lock.json` has it), and the workspace's `version` in `Cargo.toml` (`ssqch-plugin` is
   published at ssqch's version). Update the pinned versions in the docs too
   (`site/src/docs/netlify.md`'s `ssqch@<version>` and `SSQCH_VERSION`, and any other
   `ssqch@<version>`: `git grep -n "ssqch@0\." site/src/docs`). Take out the "Not released
   yet" notes the release ships (`node scripts/unreleased-notes.mjs` lists them); the workflow
   refuses a tag while one is left. Write the release's entry for the site's changelog, which is
   for people:
   for a minor release, `site/src/changelog/<major>.<minor>.md` (the headlines, "What you might
   need to change" for every Breaking item, about 250 words, numbers only from `CHANGELOG.md`; a
   first draft with the `write` skill, for the owner to edit), and for a patch release, its
   version in its minor's entry's `releases` and a dated paragraph about it.
   `site/tests/changelog.test.ts` fails until the package's version has an entry.
3. Bring the branch up to date with `main` if it isn't (a merge commit with a tree the pull
   request didn't test runs all of CI again), wait for its CI to pass, and merge it.
4. Wait for CI on the merge commit (it skips in a minute when its tree passed on the pull
   request), then tag that commit and push: `git tag v<version> && git push origin
   v<version>`. The release workflow refuses a tag that isn't the package's version; builds and
   packs the package; checks the tarball on Linux on Node 22.18, 24 and 26 (`check-package.ts`,
   without the oracle, which CI ran on the commit); waits for CI to pass on the tagged commit
   (`check-ci.yml`); and
   only then publishes the GitHub release, with the npm tarball and its checksum. Then it
   publishes the package to npm (`publish-npm.yml`) and, once npm serves it (npm validates a
   new version first, which takes minutes, and the `homebrew` job waits until `npm view` lists
   it and its tarball downloads), the formula to `reverentgeek/homebrew-tap` (not for a
   prerelease, which goes to npm's `next` tag). If npm hasn't served it when that job times out,
   no formula goes out: rerun the job. If
   anything fails before the GitHub release, nothing is published: fix it and tag the fixed
   commit with the same version (delete the old tag first). The job that publishes names every
   job before it in `needs` and has no `always()`, on purpose: dist's published when its builds
   were skipped, and a red commit got an empty release marked Latest (0.3.4). Keep it so.
5. Publish `ssqch-plugin` to crates.io from the tag (`cargo publish -p ssqch-plugin`, below).
   It's part of every release, by hand, since no workflow does it (the owner, 2026-11-23; 0.13.6
   went out without it).

The 0.7 line is released from `release/0.7` (cut before these workflows), with dist, as it
always was; see "One last 0.7.x" in `docs/node-migration.md`. The `sitesquatch` crates and the
`ssqch` crate end at 0.7. From `main`, only `ssqch-plugin` goes to crates.io: with 0.8.0, set
the workspace's version in `Cargo.toml` to the release's, remove `publish = false` from
`crates/ssqch-plugin/Cargo.toml`, and `cargo publish -p ssqch-plugin` from the tag with every
release (step 5 above; by hand, since no workflow does it).

### npm

`ssqch` is one package, published with npm's trusted publishing (OIDC, no token), which adds
provenance. Its trusted publisher on npmjs.com is GitHub Actions, repository
`reverentgeek/sitesquatch`, workflow `release.yml` (npm checks the calling workflow, not
`publish-npm.yml`), no environment; it's set already. A trusted publisher that hasn't
published within two days of being added expires; if it has, revoke it and add it again
shortly before the release: `npm trust github ssqch --repo reverentgeek/sitesquatch --file
release.yml --allow-publish --yes`, and `npm trust list ssqch` checks it. In the package's
settings, publishing requires two-factor authentication and disallows tokens. A version that's
already on npm is skipped, so a failed run can be rerun.

The `@ssqch/<platform>` packages (`darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`) get no
new versions. Every version of each is deprecated (2026-11-18), so an old lockfile says why: "ssqch
0.8 is JavaScript and needs no platform package".

### Homebrew

The `homebrew` job pushes `Formula/ssqch.rb` to `reverentgeek/homebrew-tap` with the
`HOMEBREW_TAP_TOKEN` repository secret (`gh secret set HOMEBREW_TAP_TOKEN`): a fine-grained
personal access token with Contents read and write access to that repository. The `release` job
checks that it's set before it publishes anything. Homebrew installs a formula's npm
dependencies with `--min-release-age`, so a dependency (sharp) published within the last day
holds an install back until it's a day old; ssqch itself comes from the formula's URL and isn't
held back.

## Conventions

- Commit subjects are short, imperative, in sentence case (`Fix unstyled pages when serving
  after a production build`).
- The docs pages ship with the package for `ssqch docs` (as `bundled/docs/`), which answers a
  name with the table row or list item that starts with it in backticks. A new config option,
  module export or template function needs one, on the page that explains it, and a description
  where it's defined (`ssqch.d.ts`, or `BUILTIN_FILTERS` in `src/filters.ts`);
  `docs_answer_for_every_name` checks. Pages are plain Markdown (no template code runs in them),
  link each other with relative `.md` links (`content-schemas.md#types`), and use GitHub's
  `> [!NOTE]` alerts for callouts, so GitHub, `ssqch docs` and the site show the same text.
- Every new feature ships discoverable, with enough documentation that another coding agent could
  understand it and use it without reading the code: what it's for, its exact shape (names,
  arguments, return values), an example that works, what happens when it's used wrong, and how
  it interacts with what's already there. At minimum: an entry in the docs that `ssqch docs <name>`
  finds (check it answers with the full explanation, not only a table row, and add the query to
  `docs_answer_for_every_name`), types and descriptions where they're defined (`ssqch.d.ts`,
  `BUILTIN_FILTERS`), and a CHANGELOG entry. Then add a task to `research/TODO.md`, in the
  feature's section, to document it fully: a how-to or worked example, the trailheads in
  `site/src/docs/trailheads/`
  and starters that could use it, and the blog or examples that could show it off.
- Docs pages' and the README's paragraphs, list items and callouts are one line each (no hard
  wrapping). TODO and
  CHANGELOG prose wraps at 100 columns.
- Error messages name the file and what went wrong (`ssqch.config.js: too many pine cones`).

## The Sasquatch voice

ssqch reports like a deadpan park ranger who knows a lot about HTML: what happened comes first,
and now and then something large walks through the log (`Fresh tracks in src/posts/hello.md`,
`we've passed this tree before. Layout loop: ...`). The lines that are shared are in
`packages/ssqch/src/voice.ts`. When adding or changing a message:

- Facts first. A themed line still names the file and what went wrong, and keeps the words
  people search for (`Built in`, `broken`, `not found`). The joke is a few extra words, never
  a replacement, and the best ones explain the problem.
- Machines get plain output: `--format json`, diagnostic codes, exit codes, `--version` and the
  ready file. `locate` and `codeFor` in `src/diagnostics.ts` read error text (`in <file>: `,
  `rendering <file> with`, ``layout ` ``, `output conflicts`, ` loop: `), so keep those parts.
- Nothing random: a message depends on what happened, so tests, logs and `ssqch diff` repeat.
- Never in a site's output. A build adds no comments, headers or markup of its own. The
  starters' files belong to the site, so they can be silly.
- One per command at most, no emoji, and no switch to turn it off. `--quiet` hides them.
- Family-friendly. The theme is pop-culture Bigfoot (blurry photos, footprints, eyewitnesses),
  the forest and its creatures, forest rangers, and the outdoors: camping and hiking. No figures
  from Indigenous traditions.
- Puns on and parodies of popular adventure and outdoor books, movies and brands are a good
  source of names and examples (a trail guide called *Into the Mild*, a pack from *The North
  Fake*). Parody, not the real thing: no real product names, logos or trademarks as they are,
  and nothing that reads as an endorsement.
- Examples and fixtures share a canon: pine cones, Squatch Snacks, Pine Cone Crunch, rangers,
  the Cedar and Old Growth trails, the starter's stump, and forest creatures.
- Look for chances to suggest puns, humor and themed renames in that theme: commands, options,
  documentation headings and messages. Until developers depend on ssqch, breaking changes are
  fine (with a "Breaking" changelog entry), so anything is fair game when it improves the
  experience. A themed name has to stay predictable for people and coding agents: it says what
  the thing does (`footprint`, `leaveNoTrace`, `_blueprints/`), a rename replaces the old
  name rather than keeping both (aliases are for words people bring from other generators),
  and the machine-facing parts stay plain (diagnostic codes, JSON keys, exit codes). Suggest the bigger renames before making them.
- The palette is Ranger Station '76: pine `#233B2B`, burnt orange `#A23E20`, harvest gold
  `#E8AF43`, avocado `#A9B66A` and map paper `#FFF3D6`. On pages (the starters, the dev
  server's pages, sitesquatch.dev): soft white `#FAFAF7` in light mode and a slightly green
  charcoal `#1B201D` in dark mode, with neutral body text (`#29332C`, `#E5E9E1`). Pine gives
  headings and navigation their identity (`#D6E4C8` in dark mode), and the bright colors take
  small areas: burnt orange for underlined links and selection markers (`#F0A17D` in dark
  mode), avocado for selected navigation and code, harvest gold for callout borders. A narrow
  four-color stripe (pine, burnt orange, gold, avocado, in equal widths) under the header
  carries the retro theme in both modes. Navigation links are pine, not burnt orange. Gold and avocado are never text on a light page. Merchandise (stickers,
  shirts) puts broad gold and avocado stripes behind the footprint, the trail patch. Small
  sizes (the tab icon) use a map-paper footprint on a solid pine circle instead: the stripes
  don't read at 16 pixels.
- Commands, hooks, plugin and option names, and summary labels take a themed name only when it
  describes the thing at least as well as the plain one (`leaveNoTrace` over `clean`,
  `footprint`); otherwise they stay literal.

## Finishing work

Do not stop while there is still work left to do that the user asked for. Status notes are fine. If the next step does not need an answer, keep going. For errors, timeouts or failing tools, diagnose first, then retry or use another tool. For a hard blocker (do-not-touch file, safety guardrail), leave it, say/document what you found, and find another safe way. Stop only when there is no work left to do, absolutely need user input, or the blocker is deliberate. This does not skip confirmation on risky or destructive actions.
