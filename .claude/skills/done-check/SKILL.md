---
name: done-check
description: Check that a change to ssqch is really done before saying so: which tests to run for what changed (type-check, unit tests, the oracle on three Node versions, the benchmark, the blog), and what a feature owes besides its code (a docs entry `ssqch docs` finds, types, a changelog entry, the "Not released yet" note, a deliberate-change record, a roadmap task). Use it before calling any code change finished, before opening or updating a pull request, before a release commit, and whenever the user asks "is this done?", "what's left?", "is it ready to merge?" or "did you run everything?".
---

# Is it done?

"Done" in this repository is more than passing tests. A feature that an agent can't find with `ssqch docs` doesn't exist for the people ssqch is for, and a change to the frozen contract that isn't written down looks like a regression to the next person. The rules are spread over AGENTS.md ("Commands", "Rules", "Conventions", "Working with the blog"); this is all of them as one pass, so none gets skipped.

Do the pass in order: what changed, the checks that can run, then the questions only reading the change can answer. Report at the end what ran, what passed, and what you skipped and why. A check that didn't run is reported as not run, never as fine.

## 1. What changed

```sh
node .claude/skills/done-check/scripts/checks.mjs            # against origin/main, with uncommitted and untracked files
node .claude/skills/done-check/scripts/checks.mjs v0.13.4    # or against any commit
```

It lists the files that changed, the checks they call for with the command for each, and a few things it can tell from paths alone (code changed and `CHANGELOG.md` didn't; a snapshot changed). It runs nothing. Use its list as the floor: add a check when you know the change reaches further than its paths show.

## 2. The checks that run

Run what the script listed. What each is for, so you can judge the edge cases:

| Check | Command | When |
| --- | --- | --- |
| Types | `npx tsc --noEmit` in `packages/ssqch/` | Any TypeScript or `ssqch.d.ts` change. CI runs it. |
| Unit tests | `node --test` in `packages/ssqch/` | Any code change. |
| The oracle | `node --test` in `tests/oracle/`, on Node 22.18, 24 and 26 | Anything a build, a command or `ssqch docs` could show: code, starters, docs pages, examples, the `.wasm` files. |
| Speed | `node bench/bench.ts` in `packages/ssqch/`, alone | Code a build runs. The limits are 2 s for 10,000 pages on one thread and 0.72 s for v8.dev, on the owner's laptop; CI fails a change that's more than 15% slower than its parent. |
| The blog | `SSQCH_BIN=../ssqch/packages/ssqch/bin/ssqch.ts pnpm test` in `../blog` | Anything that could change a site's output. |
| The package | `node scripts/build.ts && node scripts/check-package.ts` in `packages/ssqch/` | A new module, a new dependency, a dynamic `import()`, the bundled files, or the build scripts. |
| The Rust | `node scripts/build-wasm.ts`, `node --test scripts/wasm-inputs.test.ts`, `cargo test --workspace`, clippy natively and for `wasm32-wasip1` | Anything under `crates/` or the example plugin. Never `cargo fmt`. |
| The site | `node build.ts && node --test "tests/*.test.ts"` in `site/` | Anything under `site/`, docs pages included. |

Notes on running them:

- **Three Node versions:** `for v in 22.18 24 26; do nvm exec $v node --test || break; done` in `tests/oracle/`. Every test passes on each; 22.18 is the lowest supported and the one that catches a too-new API.
- **A test that fails only sometimes is a finding**, not noise to rerun past. Say which one and how often.
- **The benchmark needs a quiet machine.** Don't run it while the oracle or a compile is going; a slow number from a busy machine means nothing.
- **The blog, all of it:** the smoke tests read a few pages. For a change that touches rendering, compare every page: build the blog with its installed release (`pnpm run build`), copy `dist/` without `img/` to the scratchpad, run the smoke tests with `SSQCH_BIN` as above (which builds with the source), then `node packages/ssqch/bin/ssqch.ts diff <copy> ../blog/dist`. Every difference is one you meant, or it's a bug.
- **The frozen sites:** when a site's output changes on purpose, `node freeze.js <site>` in `tests/oracle/` accepts it, for only the sites the change affects. Never edit a snapshot or `contract/shapes.json` by hand to make a test pass: that hides exactly the change the oracle exists to show.

## 3. What only reading the change can answer

Go through these against the diff. Each is a rule in AGENTS.md; the reason is beside it.

**A new name (a config option, a module's export, a template function, a filter, a command, a flag):**

- [ ] A row or list item that starts with the name in backticks, on the docs page that explains it, and the fuller explanation near it: what it's for, its exact shape, an example that works, what happens when it's used wrong, and how it meets what's already there. An agent should be able to use it without reading the code.
- [ ] `node packages/ssqch/bin/ssqch.ts docs <name>` answers with that explanation, not only the table row, and the query is in `docs_answer_for_every_name` (`tests/oracle/cli/docs.test.js`).
- [ ] A description where it's defined: `packages/ssqch/bundled/ssqch.d.ts`, or `BUILTIN_FILTERS` in `src/filters.ts`. No `*/` inside a doc comment (a `**/` glob closes the comment, and the file stops parsing with no test failing).
- [ ] A new module: its exports in `ssqch.d.ts` and an entry in `BUILT_IN`. A new docs page: listed in `site/src/docs/nav.yml`.
- [ ] The docs for something merged and not released start with `> [!NOTE]` and `> **Not released yet.** This ships with the next version of ssqch.`
- [ ] A task in `research/TODO.md`, in the feature's section, to document it fully: a how-to or worked example, the trailheads and starters that could use it, the blog or an example that could show it off.

**Every change that a user could notice:**

- [ ] An entry under `## Unreleased` in `CHANGELOG.md` (add the heading if the last release took it), prose wrapped at 100 columns. Under `### Breaking` when a site has to change, saying what to change.
- [ ] A Breaking change: the blog is updated in the same session, and both lists say so (**Blog:** in `research/TODO.md`, **Needs ssqch:** in `../blog/notes/TODO.md`).

**A change to the frozen contract** (`ssqch.d.ts`, commands and flags, JSON reports, diagnostic codes, exit codes, folder conventions, the summary's lines, the voice):

- [ ] It's deliberate, and recorded where it's tested: a `DELIBERATE (0.8)` comment, `DELIBERATE` in `sites.test.js`, or the site frozen again, each with its reason.
- [ ] A new JSON document: listed in `ADDED` in `contract/shapes.test.js` and frozen with `SSQCH_FREEZE_SHAPES=new`.
- [ ] A word from another generator: its row in `src/equivalents.ts` (an alias when it means the same thing in ssqch, a hint when it doesn't), and the oracle's copy in `tests/oracle/cli/aliases.test.js` kept equal.

**Who it's for** (AGENTS.md, "What ssqch is for"):

- [ ] A new option is worth learning for every ssqch site. If it helps only the people leaving one generator, it belongs in that generator's trailhead or `from-*` module ("Gaps a move finds").
- [ ] An error names the file and what went wrong, points at the line, and suggests what was meant. A themed line keeps the facts and the words people search for, and `--format json` has none of it.

**The same output everywhere:**

- [ ] Nothing a build writes depends on the time zone, the locale, the order the file system lists files in, the number of threads, or the Node version. No `Intl` in ssqch's own date filters or sorting.
- [ ] Paths go through `node:path`, URLs and output paths use forward slashes, and nothing in code or tests needs a shell.
- [ ] TypeScript stays erasable: no `enum`, `namespace` or constructor parameter properties; `import type` for types; relative imports name the `.ts` file.
- [ ] A new run-time dependency has its reason in the commit message.

## 4. Say what you found

End with a short table: each check, whether it ran, and its result, with the failing output for anything that failed. Then the list items above that aren't met yet. If something was skipped (no `../blog` in this session, no Rust toolchain, a busy machine for the benchmark), say so in the same place, so "done" means what the reader thinks it means.
