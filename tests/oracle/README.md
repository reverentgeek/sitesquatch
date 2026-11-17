# The oracle

Black-box tests for any ssqch: arguments in; files, standard output, standard error and the exit code out. They check ssqch 0.7 (the Rust build) today and the Node implementation (`packages/ssqch/`) during the move, with the same expectations, until the release that switches. The plan is in `docs/node-migration.md`.

```sh
cargo build --release -p ssqch --features avif   # the implementation under test
cd tests/oracle && node --test                   # everything (Node 22.18 or newer, no dependencies)
SSQCH_BIN=packages/ssqch/bin/ssqch.ts node --test   # another ssqch (from the repository root); a .js or .ts file runs with this Node
node --test cli/init.test.js                     # one file
```

`SSQCH_BIN` is the ssqch under test, as a path from the repository root (default `target/release/ssqch`). `SSQCH_EXPECT_VERSION` overrides the version the tests expect (otherwise Cargo.toml's, or `packages/ssqch/package.json`'s when `SSQCH_BIN` points there). `SSQCH_KEEP=1` keeps the temporary folders.

## What's here

| Path | What it is |
| --- | --- |
| `lib/ssqch.js` | Running ssqch (`ssqch`, `ssqchOk`, `ssqchFails`), temporary projects (`project`, `tempDir`, `write`, `read`), `expectedVersion()`, `RUST_07`, `hasCapability()` |
| `lib/serve.js` | `ssqch serve` in the background (`start`, `serveSite`), `waitFor`, `changeAndWait`, raw HTTP (`httpGet`, `live`) |
| `lib/sites.js` | The frozen sites: building in a copy, normalizing, snapshots |
| `sites.test.js` | Every example, starter and (where present) the blog and trial ports build to 0.7.0's output |
| `freeze.js` | Makes the snapshots (`node freeze.js [site...]`) |
| `snapshots/` | Committed: `<site>/manifest.json` (the normalized JSON report, the build summary, every output file's kind or hash) and the text files under `output/` (and `source/`, what `ssqch init` wrote) |
| `snapshots-local/` | Gitignored: the same for sites outside this repository (`../blog`, `../trials/*`) |
| `cli/`, `config/`, `edge/` | Tests converted from the Rust integration tests (`crates/ssqch/tests/`, `crates/sitesquatch-js/tests/`, `crates/sitesquatch-edge/tests/`) |
| `fixtures/` | Files the tests read, copied from those crates' `tests/fixtures/` |

## How the frozen sites are built

Each site is copied to a temporary folder (an example's folder; a starter from `ssqch init --starter <s> --engine <e>`; a local site's files as git would commit them, plus the ignored paths it needs, with `node_modules` linked). Every file gets the same time (2026-01-01 UTC), since undated pages take their dates from file times, and builds run with `TZ=UTC`. A site is built once with `--format json` and once in a second copy for the text summary.

Compared, after normalizing: every output file (text byte for byte, binaries by SHA-256, links by target), the JSON report without `durationMs`, `timings` and absolute paths and with `written` sorted, the summary without `Writing` lines, the `Time` line and durations, and for starters the files `init` wrote. The implementation's version becomes `{{version}}` wherever it follows `SiteSquatch `, `ssqch ` or `ssqch@`, so 0.7.0's snapshots fit 0.8.0. `freeze.js` builds every site twice and refuses one whose builds differ.

## Rules for tests

- A test is named after the Rust test it came from (`init_creates_a_site_that_builds`), and keeps its assertions and expected strings word for word. The file says which Rust file it came from.
- Only ssqch's command line counts: no imports of ssqch's code, no reading its source.
- A Rust `#[cfg(unix)]` test is `{ skip: process.platform === "win32" && "..." }`; a test of an optional feature checks `hasCapability("avif")`.
- **A deliberate difference from 0.7.0** is recorded where it's tested, with its reason, and in `CHANGELOG.md`: in `DELIBERATE` in `sites.test.js` for a frozen site, or with `RUST_07` for a behavior test that only 0.7 has (QuickJS's limits).
- Tests run in parallel (`--test-concurrency=4` in `npm test`); each makes its own folders with `tempDir`/`project`, and servers listen on `--port 0`.
