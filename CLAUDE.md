# CLAUDE.md

SiteSquatch (`ssqch`) is a static site generator in Rust. The README covers usage, the workspace
layout and the known gaps; `TODO.md` has the plan.

## Working with the blog

The ReverentGeek blog in `../blog` (github.com/reverentgeek/blog) is the main real-world site and
the integration test. Start sessions with `--add-dir ../blog` (or `/add-dir ../blog`) when a
change affects it.

- No Eleventy compatibility. ssqch started as an Eleventy-compatible build for the blog, and
  that was removed (see "Remove Eleventy" in `TODO.md`). Don't add APIs, names, fields,
  front-matter keys, attributes, env vars or module aliases that mention Eleventy or 11ty, and
  don't add backwards-compatible aliases. Use ssqch's own design and update `../blog` to match.
  Blog content about Eleventy (posts, their URLs) isn't an API and stays.
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
- CI (`.github/workflows/ci.yml`) runs the tests with and without AVIF on Linux and macOS, and
  `cargo clippy --workspace --all-targets --features ssqch/avif -- -D warnings`. Keep clippy
  clean. The code isn't formatted with rustfmt (it uses long lines), so don't run `cargo fmt`.

## Releasing

Releases are built by [`dist`](https://opensource.axo.dev/cargo-dist/), configured in
`dist-workspace.toml`. `.github/workflows/release.yml` is generated: change the config and run
`dist generate` instead of editing it. `dist plan` shows what a release would contain.

1. In `CHANGELOG.md`, rename `## Unreleased` to `## <version> - <YYYY-MM-DD>` (semver; while
   0.x, a breaking change bumps the minor version).
2. Set `[workspace.package] version` in `Cargo.toml` to match, and run `cargo build` to update
   `Cargo.lock`.
3. Commit, push to `main`, and wait for CI to pass.
4. Tag and push: `git tag v<version> && git push origin v<version>`. The release workflow
   builds the archives, refuses a tag that doesn't match a package version, and publishes the
   GitHub release with that version's changelog section as its notes.
5. Publish the crates from the tag: `cargo publish --workspace --locked`. It publishes them in
   dependency order, using the crates.io token in `~/.cargo/credentials.toml`.

## Conventions

- Commit subjects are short, imperative, in sentence case (`Fix unstyled pages when serving
  after a production build`).
- README paragraphs, list items and callouts are one line each (no hard wrapping). TODO and
  CHANGELOG prose wraps at 100 columns.
- Error messages name the file and what went wrong (`ssqch.config.js: too many pine cones`).
