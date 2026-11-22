---
name: fresh-run
description: Set up, start and follow up a fresh run: an agent that has never seen ssqch builds a new site with it, or moves a real site to it from another generator, and what it stumbles on becomes the evidence the roadmap is ordered by. Use it whenever the user asks for a fresh run, a trial, a rerun, a migration study or case study of a site, wants to "see how an agent gets on" with ssqch or a feature, wants to measure whether a change made ssqch easier to use, or asks to sort or slim a run that has finished.
---

# Fresh runs

A fresh run answers one question with evidence: what does ssqch cost a builder and their agent who meet it for the first time? An agent that knows nothing about ssqch is given a fixed task, and every guess, retry and workaround it makes is a missing doc, a missing diagnostic or a missing feature. The roadmap (`research/TODO.md`) is ordered by what these runs find, so a run is only worth its cost if it's set up the same way each time, left alone while it works, and sorted afterwards.

There are two kinds:

- **A new site:** the agent builds a blog or a docs site from nothing. This measures what most builders do first, and what it finds is friction every site meets. Brief: `references/new-site-brief.md`.
- **A move:** the agent moves a real site from another generator. This measures the way in from that generator. Brief: `references/migration-brief.md`.

Runs live outside this repository, in `../trials/fresh/`, whose `README.md` has the folder layout. Read it first.

## 1. Set up

1. **Name the run:** `../trials/fresh/<YYYY-MM-DD>-<site>/` for a move, `../trials/fresh/<YYYY-MM-DD>-new-blog/` or `-new-docs/` for a new site. Add `-rerun` for a second run of the same thing on one day. One folder per run; never write into another run's folder.
2. **Choose the ssqch it uses.** The latest release on npm measures what people have today. A tarball packed from a branch measures a change before it ships:

   ```sh
   cd packages/ssqch && node scripts/build.ts
   npm pack ./dist --pack-destination <run> && mv <run>/ssqch-*.tgz <run>/ssqch-next.tgz
   ```

   Write down which it was (the version, and the commit for a tarball) in the run's folder as `SSQCH.txt`.
3. **For a move, clone the site** into the run's folder (`git clone <url> <run>/<site>`), and note the commit. For a new site, make an empty folder `<run>/site/`.
4. **Fill in the brief.** Copy the brief's text, and fill in the blanks at its top: the folder, the version or tarball, and for a new site, which task. Change nothing else. The brief stays the same from run to run so that runs can be compared; if a brief needs to change, change the file in `references/` and say so in the run's notes.

## 2. Start the agent, and leave it alone

Start one background agent for the run (the Agent tool, a general-purpose agent), with the filled-in brief as its whole prompt. One agent per run. Start several runs at once only when the user asked for several: each is a long session.

- **It must be fresh.** Don't tell it anything you know about ssqch, the site, or what earlier runs found. Don't hand it this repository's `research/` folder or another run's notes: an agent given the answers finds no friction.
- **Know the limit of "fresh".** An agent started from this session may be handed this repository's `AGENTS.md`, which describes ssqch from the inside. For a move that's acceptable (the brief asks it to find causes in ssqch). For a new-site run it weakens the result: say so in the run's notes, or have the owner start a new session in the run's folder with the brief, which is cleaner.
- **Don't help it mid-run.** Each hint you give is a finding the run loses. If it's blocked by something that isn't ssqch (no network, a missing toolchain for the old generator), fix that, note it in the run's folder, and let it continue.
- **Note when it started.** The time a run takes is one of its results.

While it runs, carry on with other work. You're told when it finishes.

## 3. Read what it found, and check it

The agent leaves `ssqch-case-study/` in the site's folder: `README.md`, `friction-log.md`, `issues.md`, `suggestions.md`, and its benchmarks or checkpoints.

- **Check its headline claims yourself** before repeating them: build the site, run `ssqch diff` or `ssqch patrol` as the brief's "done" says, and count the hand edits (`git status`, `git diff --stat`). An agent reports its mistakes in the same confident voice as its findings.
- **Read the friction log, not only the summary.** The summary is what the agent thought mattered. The log has the guesses and retries, which is where the missing docs are.
- **Stop the agent** once its report is read.

## 4. Sort the findings

Every finding gets one of these, and goes into `research/TODO.md` with the run's tag (add the run to the table of tags at the top of that file when an item cites it):

- **A bug in what ssqch has:** fix it as a bug. It goes in "Bugs in what ships".
- **From a new-site run:** it's friction every site meets, so there's nothing more to sort. Place it by the order in AGENTS.md ("What ssqch is for"): the dev server, what a command prints, the docs `ssqch docs` didn't have, the starters.
- **From a move,** by AGENTS.md's "Gaps a move finds", in the roadmap's "Moving in" section:
  - **document:** a person or an agent gets there with what ssqch has, in minutes, without reading ssqch's source. Write it in `site/src/docs/trailheads/from-<generator>.md`, ready to paste, and have scout point at it.
  - **build:** there's no reasonable workaround and every ssqch site would gain, or it's small and worth having for everyone.
  - **known gap:** it only reproduces the old generator's behavior. List it in the trailhead.
- **Where a rewrite of the site's templates seems needed,** don't put it in `ssqch scout`: scout lists and drafts, and a generator's `from-*` module carries its compatibility (the owner's decision, 2026-11-20).

Mark your own sorting **(suggested)** until the owner agrees, and record the run's numbers beside it: minutes to the first good build, hand edits, lines of JavaScript written beside the config, and how close the output got.

Other people's sites are named in `research/` and in the oracle, where it's measurement. They aren't named in the site's changelog or other public copy without the owner reading it first.

## 5. Afterwards

- **Measure the fix with a rerun.** A finding is closed when a new run doesn't stumble there, not when the code is merged. Same brief, same site, a new folder.
- **Slim a run whose findings are fixed** (`../trials/fresh/README.md`, "When a run's findings are fixed"): keep `ssqch-case-study/`, save the port as `port.patch` (`git diff --binary HEAD`) and its new files as `port-new-files.tar`, note the base commit in `BASE.txt`, and delete the clone. Installs and builds (`node_modules`, `vendor`, `_site`, `.refs`, `.cache`) are never kept. Don't touch `../trials/a11yproject.com` or `../trials/v8.dev`: the oracle builds them.
- **Tell the owner:** the numbers, the top five findings, where each was sorted, and what's theirs to decide.
