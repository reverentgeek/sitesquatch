# The oracle

Black-box tests for ssqch: arguments in; files, standard output, standard error and the exit code out. They were written against ssqch 0.7 (the Rust implementation) and held the Node implementation (`packages/ssqch/`) to the same expectations while it was built; 0.7 is gone from this repository now (it's on the `release/0.7` branch and the `v0.7.x` tags), and the tests and the frozen output it left are the contract. The move is in `docs/node-migration.md`.

```sh
cd tests/oracle && node --test                       # everything, with ssqch from its source (Node 22.18 or newer, no dependencies)
node --test cli/init.test.js                         # one file
SSQCH_BIN=/path/to/node_modules/ssqch/bin/ssqch.js node --test   # another ssqch, such as an installed package
```

`SSQCH_BIN` is the ssqch under test, as a path from the repository root or an absolute one (default `packages/ssqch/bin/ssqch.ts`); a `.js` or `.ts` file runs with the Node that runs the tests. `SSQCH_EXPECT_VERSION` overrides the version the tests expect (otherwise `packages/ssqch/package.json`'s). `SSQCH_KEEP=1` keeps the temporary folders. CI runs the whole oracle on Linux, macOS and Windows, on Node 22.18.0, 24 and 26, and `packages/ssqch/scripts/check-package.ts --oracle` runs it against the packed npm package.

## What's here

| Path | What it is |
| --- | --- |
| `lib/ssqch.js` | Running ssqch (`ssqch`, `ssqchOk`, `ssqchFails`), temporary projects (`project`, `tempDir`, `write`, `read`), `expectedVersion()`, `hasCapability()` |
| `lib/serve.js` | `ssqch serve` in the background (`start`, `serveSite`), `waitFor`, `changeAndWait`, raw HTTP (`httpGet`, `live`) |
| `lib/sites.js` | The frozen sites: building in a copy, normalizing, snapshots |
| `contract/` | The frozen contract: `shapes.json` (every JSON document's keys and types, 0.7.0's, and documents added since, each listed in `ADDED` in `shapes.test.js` with the version that froze it: `SSQCH_FREEZE_SHAPES=new node --test contract/shapes.test.js` adds those and changes nothing else) and the diagnostic codes |
| `sites.test.js` | Every example, starter and (where present) the blog and trial ports build to their frozen output |
| `freeze.js` | Makes the snapshots (`node freeze.js <site>...`): see "Changing a site's output" |
| `snapshots/` | Committed: `<site>/manifest.json` (the version that froze it, the normalized JSON report, the build summary, every output file's kind or hash) and the text files under `output/` (and `source/`, what `ssqch init` wrote) |
| `snapshots-local/` | Gitignored: the same for sites outside this repository (`../blog`, `../trials/*`) |
| `cli/`, `config/`, `edge/` | Tests converted from 0.7's Rust integration tests (`crates/ssqch/tests/`, `crates/sitesquatch-js/tests/`, `crates/sitesquatch-edge/tests/`, on `release/0.7`) |
| `fixtures/` | Files the tests read, copied from those crates' `tests/fixtures/` |

## How the frozen sites are built

Each site is copied to a temporary folder (an example's folder; a starter from `ssqch init --starter <s> --engine <e>`; a local site's files as git would commit them, plus the ignored paths it needs, with `node_modules` linked). Every file gets the same time (2026-01-01 UTC), since undated pages take their dates from file times, and builds run with `TZ=UTC`. A site is built once with `--format json` and once in a second copy for the text summary.

Compared, after normalizing: every output file (text byte for byte, binaries by SHA-256, links by target), the JSON report without `durationMs`, `timings` and absolute paths and with `written` sorted, the summary without `Writing` lines, the `Time` line and durations, and for starters the files `init` wrote. The implementation's version becomes `{{version}}` wherever it follows `SiteSquatch `, `ssqch ` or `ssqch@`, so a snapshot fits the next version, and the report's byte count for pages is counted as if the version were as long as the one that froze the snapshot (a starter's footer prints it), so 0.7.0's snapshots fit `0.8.0-dev`. The build summary's sizes, in tenths of a kilobyte, aren't adjusted. `freeze.js` builds every site twice and refuses one whose builds differ.

## Changing a site's output

The committed snapshots are what ssqch 0.7.0 built, the reference 0.8 was held to, except where 0.8 changed a site's output on purpose. There are two ways to record a change like that, and both go in `CHANGELOG.md` too:

- **Freeze the site again** when its new output is the one to keep checking: `node freeze.js <site>` with ssqch from its source, for only the sites the change affects. Read the snapshot's diff in git before committing it, and say in the commit what changed and why. The docs starters were frozen again this way, when their Install and Deploying pages moved to npm. Never edit a snapshot by hand.
- **`DELIBERATE` in `sites.test.js`**, with its reason, when the snapshot should stay as it is and one file is allowed to differ: the site starters' `ssqch.d.ts`, whose 0.8 types aren't 0.7's, while the rest of each starter is still checked against 0.7.0's output.

## Rules for tests

- A test is named after the Rust test it came from (`init_creates_a_site_that_builds`), and keeps its assertions and expected strings word for word. The file says which Rust file it came from.
- Only ssqch's command line counts: no imports of ssqch's code, no reading its source.
- A Rust `#[cfg(unix)]` test is `{ skip: process.platform === "win32" && "..." }`; a test of an optional feature checks `hasCapability("avif")`.
- **A deliberate difference from 0.7** is recorded where it's tested, with its reason (a `DELIBERATE (0.8)` comment), and in `CHANGELOG.md`; for a frozen site, see "Changing a site's output". A Rust test of something only 0.7 had (QuickJS's stand-ins for Node's modules, its `Intl`, copy-on-write views) is gone, with a comment where it was.
- Tests run in parallel (`--test-concurrency=4` in `npm test`); each makes its own folders with `tempDir`/`project`, and servers listen on `--port 0`.
