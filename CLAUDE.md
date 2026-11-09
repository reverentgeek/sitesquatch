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

## Conventions

- Commit subjects are short, imperative, in sentence case (`Fix unstyled pages when serving
  after a production build`).
- README and TODO prose wraps at 100 columns.
- Error messages name the file and what went wrong (`ssqch.config.js: too many pine cones`).
