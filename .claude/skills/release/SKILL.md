---
name: release
description: Release a new version of ssqch (the release commit, the pull request, the tag, npm, Homebrew, crates.io and the blog's bump), or recover from a release that went wrong. Use it whenever the user says to release, ship, cut, publish or tag a version, asks "can we release this?", wants a patch or minor release, or a release run failed or published something wrong, even when they only say "let's get this out". Not for the 0.7 line (`release/0.7`).
---

# Releasing ssqch

A release is one commit, one tag, and a workflow that publishes to GitHub, npm and Homebrew. Most of it can't be taken back: a version on npm is there for good, and a GitHub release marked Latest is what installs fetch. So the order below is strict, and each step that publishes waits for a check you read yourself.

AGENTS.md ("Releasing") says why each piece is as it is. If this page and the workflow disagree, the workflow is right: read `.github/workflows/release.yml`.

## Before you start

- **Ask before the steps that publish.** Merging the pull request, pushing the tag, `cargo publish` and pushing to the blog are the owner's to approve, each time, unless they said to carry the whole release through. Everything before the merge is safe to do.
- **Pick the version.** While ssqch is 0.x, a `### Breaking` heading under `## Unreleased` in `CHANGELOG.md` means the minor version goes up (0.13.4 to 0.14.0); anything else is a patch. No `## Unreleased` section, or an empty one, means there's nothing to release: say so.
- **Start from an up-to-date `main`** with a clean tree, on a branch named `release-<version>`. When the release rides on a feature's pull request, the release commit is that branch's last commit instead.

## 1. The release commit

One commit, `Release <version>`. A patch release touches seven files; 0.13.3's (`git show --stat cb596ce`) is the pattern.

1. **`CHANGELOG.md`:** rename `## Unreleased` to `## <version> - <YYYY-MM-DD>` (today, UTC). This section becomes the GitHub release's notes, and the workflow refuses a tag without it.
2. **`packages/ssqch/package.json`:** set `version`, then `npm install` in `packages/ssqch/` so `package-lock.json` has it.
3. **`Cargo.toml`:** the workspace's `version` (`ssqch-plugin` is published at ssqch's version), then `cargo update --workspace`, which rewrites only the workspace's own lines in `Cargo.lock`. Look at the diff: version lines and nothing else.
4. **The docs' pinned versions:** `git grep -n "ssqch@0\.\|SSQCH_VERSION" site/src/docs`. `site/src/docs/netlify.md` has two and `github-pages.md` one (it stayed at 0.12.0 through five releases, which is why `preflight.mjs` checks them).
5. **"Not released yet" notes:** `node scripts/unreleased-notes.mjs` lists the ones this release ships. Take each out (the `> [!NOTE]` line and the line under it). The workflow refuses a tag while one is left.
6. **The site's changelog, which is for people** (`site/src/changelog/`):
   - **A patch release:** in its minor's entry (`0.13.md`), add the version to `releases`, set `lastRelease` and `lastDate`, and add a section at the end: `## And in <version>`, then one paragraph that starts with the date in bold (`**22 November 2026.**`).
   - **A minor release:** a new `<major>.<minor>.md`, with the front matter the last entry has (`title`, `release`, `releases`, `date`). The headlines, then "What you might need to change" with every Breaking item, in about 250 words. Draft it with the `write` skill and tell the owner it's a first draft for them to edit.
   - **Either way:** lead with what the reader notices or can do, not with what it's built on. Numbers come from `CHANGELOG.md` only. Don't name other people's sites ("tested on several migrations"), and don't tell ssqch's story as starting from another generator.
7. **Check the commit before pushing it:**

   ```sh
   node .claude/skills/release/scripts/preflight.mjs        # the version in package.json
   (cd site && node --test "tests/*.test.ts")
   ```

   `preflight.mjs` checks what the workflow would refuse the tag for, and what a release commit tends to forget: the five places the version lives, the changelog's section, the docs' pins, the notes, and the site's entry. Fix what it lists and run it again.

Commit, push the branch, and open the pull request. If the branch is behind `main`, bring it up to date first: a merge commit whose tree the pull request didn't test runs all of CI again.

## 2. The pull request's CI, then the merge

CI runs once, on the pull request. Wait for it, then read the result as data:

```sh
gh pr checks <number> --json name,state,bucket
```

Every check is `pass` (or `skipping`, for jobs that don't apply) before the merge. Merge with a merge commit, with the owner's go.

## 3. The tag

The merge commit's CI sees the same tree and skips in about a minute (`already-tested` in `ci.yml`). Wait for it anyway, on that exact commit:

```sh
sha=$(git rev-parse origin/main)   # after `git fetch`; check it's the merge commit
gh run list --commit "$sha" --json name,status,conclusion
```

Tag only when every run there is `completed` and `success`. Then, with the owner's go:

```sh
git tag v<version> "$sha" && git push origin v<version>
```

**Never judge CI from a pipeline's exit code.** `gh run watch ... | tail; echo $?` prints `tail`'s exit code, and that is how 0.3.4 was tagged on a red commit and published an empty release marked Latest. Read `conclusion` from the JSON.

## 4. The release workflow

`gh run list --workflow release.yml --limit 1 --json databaseId,status,conclusion`, then `gh run view <id> --json jobs`. Its jobs, in order: `plan` (the tag is the package's version, the changelog has its section, no notes are left), `package`, `npm-test` on Node 22.18, 24 and 26, `check-ci`, then `release` (the GitHub release), `npm`, and `homebrew`.

- **A failure before `release`:** nothing is published. Fix it on `main` through a pull request, delete the tag (`git push origin :refs/tags/v<version>`, `git tag -d v<version>`), and tag the fixed commit with the same version.
- **`npm` succeeded but the version 404s:** that's normal. npm validates a new version for some minutes before it serves it. Wait; don't rerun, and don't tag again. Check with `npm view ssqch@<version> version`. Don't `curl` the tarball's own URL to check: npm's CDN keeps a 404 for five minutes, and that would keep `brew install` failing after the package is there.
- **`homebrew` timed out:** npm hadn't served the package in 45 minutes, and no formula went out. Rerun that job (`gh run rerun <id> --failed`).
- **`npm` failed on signing in:** the trusted publisher may have expired (AGENTS.md, "npm", has the command that adds it again). A version already on npm is skipped, so the run can be rerun.
- **A release was published and is wrong:** point Latest back first, so installs work again (`gh release edit v<previous> --latest`), then tell the owner what happened before deleting anything. The npm version can't be reused.

## 5. After it's out

1. **Confirm it:** `npm view ssqch version` is the new one, `gh release view v<version>` has the tarball and its checksum, and `reverentgeek/homebrew-tap`'s `Formula/ssqch.rb` names it (not for a prerelease, which goes to npm's `next` tag and gets no formula).
2. **`ssqch-plugin` on crates.io**, by hand, from the tag, with the owner's go: `git checkout v<version> && cargo publish -p ssqch-plugin`. No workflow does it.
3. **The blog** (`../blog`; follow its `CLAUDE.md`): `pnpm add -D ssqch@<version>`, `pnpm test`, and `pnpm run lint` if JavaScript changed. Do it in the same session when the release has a Breaking item the blog meets. Its deploy preview's `<meta name="generator">` says the new version.
4. **The two lists:** in `research/TODO.md`, mark what the release shipped (`released in <version>`), update each **Blog:** note, and move ticked items to `research/archive/`. The blog's list is `../blog/notes/TODO.md`.
5. **Tell the owner** what was published and where, what was skipped, and anything that's still waiting (the formula, crates.io, the site's changelog entry for them to edit).
