# AGENTS.md

SiteSquatch (`ssqch`) is a static site generator in Rust. The README covers usage, the workspace
layout and the known gaps; `TODO.md` has the plan.

## Working with the blog

The ReverentGeek blog in `../blog` (github.com/reverentgeek/blog) is the main real-world site and
the integration test. Start sessions with `--add-dir ../blog` (or `/add-dir ../blog`) when a
change affects it.

- Not a clone of Eleventy or of any other generator. ssqch started as an Eleventy-compatible
  build for the blog, and that was removed (see "Remove Eleventy" in `TODO.md`): ssqch has its
  own design, and doesn't copy another generator's API wholesale. Take the best ideas from
  existing generators, fill the gaps they leave, and design each feature as ssqch's own, so the
  result is something unique that appeals to lots of developers. Making the move easy is part
  of that: things should feel familiar and inviting, so an alias for a word people bring from
  another generator (Eleventy's included: `ssqch dev`, `pathPrefix`) is welcome where it makes
  moving easier and doesn't mean something else in ssqch. ssqch's own name stays the one the
  docs teach. Blog content about Eleventy (posts, their URLs) isn't an API and stays. Research
  on other generators goes in `research/` (gitignored); the work items go in `TODO.md`.
- Other generators' words come from one table, `crates/sitesquatch/src/equivalents.rs`: ssqch's
  name for each, what to say, and where to read more. Errors and warnings use it to name
  ssqch's word (`"pathPrefix" isn't a config option. In ssqch it's base`), and each row is
  tested (`other_generators_words_get_ssqch_names`). A row that becomes an alias belongs there
  too.
- After a change that affects output, build the blog and run its smoke tests:
  `cargo build --release -p ssqch --features avif`, then in `../blog`,
  `SSQCH_BIN=../ssqch/target/release/ssqch pnpm test`.
- The two TODO lists coordinate the work. This repository's `TODO.md` marks what the blog is
  waiting on with **Blog:**, and `../blog/TODO.md` marks what needs a change here with
  **Needs ssqch:**. When work lands on one side, update both lists.
- A change that breaks existing sites goes under a "Breaking" heading in the changelog, saying
  what a site has to change. Then update the blog in the same session.
- `../blog` has its own `CLAUDE.md` (run `pnpm run lint` after JavaScript changes). Follow it
  when editing files there.

## Commands

- `cargo test --workspace` runs all tests. Add `--features avif` to cover the AVIF encoder (on
  x86_64 that needs `nasm` installed).
- `cargo build --release -p ssqch` builds the CLI. `-p reverentgeek` builds the Rust port of the
  blog in `examples/reverentgeek`, an example of the Rust API (it doesn't have to match the
  blog's config).
- `scripts/bench.sh` runs the benchmarks in the README; results go to `bench-results/`.
- CI (`.github/workflows/ci.yml`) runs the tests on Linux, macOS and Windows (with AVIF on
  Linux only), and `cargo clippy --workspace --all-targets --features ssqch/avif -- -D
  warnings`. Keep clippy clean. Pull requests don't build the release binaries
  (`pr-run-mode = "plan"`); version tags do. When a pull request changes how releases are
  built, set `pr-run-mode = "upload"` in it (and run `dist generate`) to build them there. The code isn't formatted with rustfmt (it uses long lines), so don't run `cargo fmt`.

## Releasing

Releases are built by [`dist`](https://opensource.axo.dev/cargo-dist/), configured in
`dist-workspace.toml`. `.github/workflows/release.yml` is generated: change the config and run
`dist generate` instead of editing it. `dist plan` shows what a release would contain.

1. In `CHANGELOG.md`, rename `## Unreleased` to `## <version> - <YYYY-MM-DD>` (semver; while
   0.x, a breaking change bumps the minor version).
2. Set `[workspace.package] version` in `Cargo.toml` to match, along with the `version` of each
   `sitesquatch*` entry in `[workspace.dependencies]`, and run `cargo build` to update
   `Cargo.lock`. Update the pinned versions in the README too (`download/v<version>`, the
   `setup-ssqch` example's `version:` and the Netlify example's `SSQCH_VERSION`).
3. Commit and push to `main`.
4. Wait for CI to pass on that commit, then tag and push: `git tag v<version> && git push
   origin v<version>`. The release workflow refuses a tag that doesn't match a package
   version, builds the archives, smoke-tests and notarizes them, waits for CI to pass on the
   tagged commit (`.github/workflows/check-ci.yml`), and only then publishes the GitHub
   release with that version's changelog section as its notes. If CI fails, nothing is
   published: fix it and tag the fixed commit with the same version (delete the old tag
   first). The CI check runs after the builds on purpose: as a plan job, a failure made the
   builds skip, and dist publishes when builds are skipped (an empty release marked Latest,
   which is what happened to 0.3.4).
5. Publish the crates from the tag: `cargo publish --workspace --locked`. It publishes them in
   dependency order, using the crates.io token in `~/.cargo/credentials.toml`.

### macOS signing and notarization

dist signs the macOS binaries (`macos-sign`, hardened runtime from `.github/build-setup.yml`),
and `.github/workflows/notarize.yml` notarizes them before a release is published. They need
these repository secrets (`gh secret set NAME < file`):

- `CODESIGN_CERTIFICATE`: a Developer ID Application certificate exported from Keychain Access
  as a `.p12`, base64-encoded (`base64 -i cert.p12`).
- `CODESIGN_CERTIFICATE_PASSWORD`: the password chosen when exporting it.
- `CODESIGN_IDENTITY`: the certificate's name, like `Developer ID Application: Name (TEAMID)`
  (`security find-identity -v -p codesigning`).
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`: for notarization, the Apple ID's email, an
  app-specific password for it (appleid.apple.com, Sign-In and Security), and the 10-character
  Developer Team ID. These are the same names as in `reverentgeek/metermaid`, whose
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY` hold the
  same values as the three `CODESIGN_*` secrets here (dist needs those names).
- `HOMEBREW_TAP_TOKEN`: a fine-grained personal access token with Contents read and write
  access to `reverentgeek/homebrew-tap`. dist's `publish-homebrew-formula` job uses it to push
  `Formula/ssqch.rb` after each release.

Without them, the release builds fail: GitHub passes a missing secret as an empty string, and
dist tries to sign with it.

## Conventions

- Commit subjects are short, imperative, in sentence case (`Fix unstyled pages when serving
  after a production build`).
- The README is built into the binary for `ssqch docs`, which answers a name with the table row
  or list item that starts with it in backticks. A new config option, module export or template
  function needs one, and a description where it's defined (`ssqch.d.ts`, or `BUILTIN_FILTERS`
  in `build.rs`); `docs_answer_for_every_name` checks.
- README paragraphs, list items and callouts are one line each (no hard wrapping). TODO and
  CHANGELOG prose wraps at 100 columns.
- Error messages name the file and what went wrong (`ssqch.config.js: too many pine cones`).

## The Sasquatch voice

ssqch reports like a deadpan park ranger who knows a lot about HTML: what happened comes first,
and now and then something large walks through the log (`Fresh tracks in src/posts/hello.md`,
`we've passed this tree before. Layout loop: ...`). The lines that are shared are in
`crates/sitesquatch/src/voice.rs`. When adding or changing a message:

- Facts first. A themed line still names the file and what went wrong, and keeps the words
  people search for (`Built in`, `broken`, `not found`). The joke is a few extra words, never
  a replacement, and the best ones explain the problem.
- Machines get plain output: `--format json`, diagnostic codes, exit codes, `--version` and the
  ready file. `diagnostics::locate` and `code_for` read error text (`in <file>: `, `rendering
  <file> with`, ``layout ` ``, `output conflicts`, ` loop: `), so keep those parts.
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
