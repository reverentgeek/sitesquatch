---
name: fresh-run
description: Set up, start and follow up a fresh run: an agent that has never seen ssqch builds a new site with it, or moves a real site to it from another generator, and what it stumbles on becomes the evidence the roadmap is ordered by. Use it whenever the user asks for a fresh run, a trial, a rerun, a new-site study (Squatch Snacks, The North Fake, Pack Mule), a migration study or case study of a site, wants to "see how an agent gets on" with ssqch or a feature, wants to measure whether a change made ssqch easier to use, or asks to sort or slim a run that has finished.
---

# Fresh runs

A fresh run answers one question with evidence: what does ssqch cost a builder and their agent who meet it for the first time? An agent that knows nothing about ssqch is given a fixed task, and every guess, retry and workaround it makes is a missing doc, a missing diagnostic or a missing feature. The roadmap (`research/TODO.md`) is ordered by what these runs find, so a run is only worth its cost if it's set up the same way each time, left alone while it works, and sorted afterwards.

There are three kinds:

- **A new site:** the agent builds a blog or a docs site from nothing. This measures what most builders do first, and what it finds is friction every site meets. Both tasks start from a starter and take minutes, so they're the fixed reruns: the check that a release didn't make the first ten minutes worse. Brief: `references/new-site-brief.md`.
- **A study:** the agent builds a complete site of a kind no starter fits (a company's marketing site, a catalog from a spreadsheet, a small web app), then lives with it: seven requests from its owner, a tour of everything it didn't use, and checks with tools that aren't ssqch's. This measures whether a stranger finds ssqch's parts without being told their names, and what a kind of site needs that ssqch doesn't have. It's a long session: the first took about an hour. Brief: `references/new-site-study-brief.md`, with the sites' specs and the requests; `research/new-site-studies-plan.md` has which site is next, why each requirement is there, and the answer key.
- **A move:** the agent moves a real site from another generator. This measures the way in from that generator. Brief: `references/migration-brief.md`.

Runs live outside this repository, in `../trials/fresh/`, whose `README.md` has the folder layout. Read it first.

## 1. Set up

1. **Name the run:** `../trials/fresh/<YYYY-MM-DD>-<site>/` for a move, `../trials/fresh/<YYYY-MM-DD>-new-blog/` or `-new-docs/` for a new site, and `-new-snacks/`, `-new-catalog/` or `-new-app/` for a study (a new study site gets a short name of its own). Add `-rerun` for a second run of the same thing on one day. One folder per run; never write into another run's folder.
2. **Choose the ssqch it uses.** The latest release on npm measures what people have today. A tarball packed from a branch measures a change before it ships:

   ```sh
   cd packages/ssqch && node scripts/build.ts
   npm pack ./dist --pack-destination <run> && mv <run>/ssqch-*.tgz <run>/ssqch-next.tgz
   ```

   Write down which it was (the version, and the commit for a tarball) in the run's notes: `research/runs/<run>.md` in this repository (gitignored), named after the run's folder. Nothing about the run goes in the run's folder itself, which the agent can read: the Snacks rerun's agent read its `SSQCH.txt`, which said it was a rerun and named the first run's folder (the owner, 2026-11-24, moved the notes).
3. **For a move, clone the site** into the run's folder (`git clone <url> <run>/<site>`), and note the commit. For a new site or a study, make an empty folder `<run>/site/`.
4. **For a study, write the requests** into `<run>/requests/`, beside `site/` and not in it: `01.md` to `07.md`, each one request from the brief's "The requests" with the site's words filled in from its table. Leave out the upgrade unless the run has two versions of ssqch, a release and a tarball, and then number the files with no gap (`01.md` to `06.md`, the request's own number in its first line): The North Fake's agent, told not to read ahead, found no `06.md` and stopped before request 07. The agent opens them one at a time, so they mustn't be where a search of the site finds them.
5. **For a study, let it deploy.** Check the hosts' command-line tools are signed in (`npx netlify-cli status`, `npx wrangler whoami`), and write `<run>/site/.claude/settings.json` allowing `npx netlify-cli`, `npx wrangler` and reading `../requests/` (`additionalDirectories`, and a `Read(//<absolute path>/**)` rule), or the session stops at both (The North Fake). The brief has it deploy only to projects named `ssqch-study-<run>`; delete them once the run is sorted, with the owner's go.
6. **Fill in the brief.** Copy the brief's text, and fill in the blanks at its top: the folder, the version or tarball, and for a new site, which task; for a study, paste the one site's spec. Change nothing else. The brief stays the same from run to run so that runs can be compared; if a brief needs to change, change the file in `references/` and say so in the run's notes. Save the filled-in brief as `<run>/BRIEF.md`, beside `site/` (the brief only, nothing about the run), so whoever starts the run has it where they start: the 2026-11-25 reruns were set up with the brief only in their notes, and couldn't be started from their folders.

   The run's folder then holds only what the agent may read: the site's folder, `requests/` for a study, the tarball, and `BRIEF.md`, which is the agent's own prompt. The notes (`research/runs/<run>.md`) have the version, the brief as filled in, when and how it started, anything said or fixed mid-run, and later the checks and the sorting.

## 2. Start the agent, and leave it alone

Start one background agent for the run (the Agent tool, a general-purpose agent), with the filled-in brief as its whole prompt. A study is the exception: the owner starts it (below). One agent per run. Start several runs at once only when the user asked for several: each is a long session.

- **It must be fresh.** Don't tell it anything you know about ssqch, the site, or what earlier runs found. Don't hand it this repository's `research/` folder or another run's notes: an agent given the answers finds no friction.
- **Know the limit of "fresh".** An agent started from this session may be handed this repository's `AGENTS.md`, which describes ssqch from the inside. For a move that's acceptable (the brief asks it to find causes in ssqch). For a new-site run it weakens the result: say so in the run's notes, or have the owner start a new session in the run's folder with the brief, which is cleaner.
- **A study isn't started from here at all.** Its spec never names a part of ssqch, and an agent that has read `AGENTS.md` knows them all, so the run would measure nothing. Set the run up, hand the owner the filled-in brief (save it in the run's notes, `research/runs/<run>.md`, under "Brief"), and have them start a new session in `<run>/site/` with it as the prompt. Note in the run's notes how and when it was started. The starter's own `AGENTS.md`, if the agent runs `ssqch init`, is fair: it ships.
- **Don't help it mid-run.** Each hint you give is a finding the run loses. If it's blocked by something that isn't ssqch (no network, a missing toolchain for the old generator), fix that, note it in the run's notes, and let it continue.
- **Note when it started.** The time a run takes is one of its results.

While it runs, carry on with other work. You're told when it finishes.

## 3. Read what it found, and check it

The agent leaves `ssqch-case-study/` in the site's folder: `README.md`, `friction-log.md`, `issues.md`, `suggestions.md`, and its benchmarks or checkpoints. A study leaves `notes.md`, `lookups.md`, `tour.md` and `checks.md` too, and Pack Mule a `boundary.md`.

- **Check its headline claims yourself** before repeating them: build the site, run `ssqch diff` or `ssqch patrol` as the brief's "done" says, and count the hand edits (`git status`, `git diff --stat`). An agent reports its mistakes in the same confident voice as its findings.
- **For a study, check the same things every time,** so studies can be compared: build a fresh copy of the folder from its lockfile, compare two builds with `ssqch diff`, run `ssqch patrol`, run its outside checks again (the tools and versions are in `checks.md`), and count the lines it wrote by kind (nothing is committed, so `git` can't count them). Then read `tour.md` against the answer key in `research/new-site-studies-plan.md`: a part of ssqch the site needed and the agent met only on the tour is a finding about the docs, and "couldn't tell what it's for" is one too. Check a cell of the key against the docs before calling something missed. And reproduce each bug it claims from its smallest site, with the release and with `main`, before it goes in "Bugs in what ships": the first study's agent took back eight of its own findings, six of them commands it had run with `2>/dev/null`.
- **Read the friction log, not only the summary.** The summary is what the agent thought mattered. The log has the guesses and retries, which is where the missing docs are.
- **Stop the agent** once its report is read.

## 4. Sort the findings

Every finding gets one of these, and goes into `research/TODO.md` with the run's tag (add the run to the table of tags at the top of that file when an item cites it):

- **A bug in what ssqch has:** fix it as a bug. It goes in "Bugs in what ships".
- **From a new-site run:** it's friction every site meets, so there's nothing more to sort. Place it by the order in AGENTS.md ("What ssqch is for"): the dev server, what a command prints, the docs `ssqch docs` didn't have, the starters.
- **From a study,** `suggestions.md` marks each finding "every site" or "this kind of site". A study's suggestions are numbered inside their groups, so cite the group and the number (`snacks B3`, `snacks F1`), and say so in the tag's row. The first is sorted as a new-site run's. The second is what a blog and a docs site never showed, and it gets the test AGENTS.md gives a move's gaps ("Gaps a move finds", and the paragraph after it for a kind of site), for the same reason (every option is documented, tested and learned by every user), with "a kind of site" where that says "a framework":
  - **document:** a person or an agent gets there with what ssqch has, in minutes, without reading ssqch's source, and it keeps working. Write it as a how-to on the docs page it belongs to, an example in `examples/sites/`, or a line in a deploy guide. A podcast feed's enclosures are a recipe.
  - **build:** there's no reasonable way and every site would gain, or it's small and worth having for everyone.
  - **known gap:** only that kind of site needs it, and ssqch isn't the tool for that part. Say so in the docs where someone would look.

  Pack Mule's findings go to a write-up first (`research/web-app-boundary.md`: what ssqch should make smooth under someone else's JavaScript, and what stays another tool's job), and features come from that by the same test.
- **From a move,** by AGENTS.md's "Gaps a move finds", in the roadmap's "Moving in" section:
  - **document:** a person or an agent gets there with what ssqch has, in minutes, without reading ssqch's source. Write it in `site/src/docs/trailheads/from-<generator>.md`, ready to paste, and have scout point at it.
  - **build:** there's no reasonable workaround and every ssqch site would gain, or it's small and worth having for everyone.
  - **known gap:** it only reproduces the old generator's behavior. List it in the trailhead.
- **Where a rewrite of the site's templates seems needed,** don't put it in `ssqch scout`: scout lists and drafts, and a generator's `from-*` module carries its compatibility (the owner's decision, 2026-11-20).

Mark your own sorting **(suggested)** until the owner agrees, and record the run's numbers beside it: minutes to the first good build, hand edits, lines of JavaScript written beside the config, and how close the output got. A study's numbers are the ones `research/new-site-studies-plan.md` lists ("What a study records"): minutes for each part, builds that failed by accident, lookups outside the package and `ssqch docs` answers that missed, lines written by kind, packages and tools beside ssqch, what it used before the tour, the outside checks' scores, and the build's times and size.

Other people's sites are named in `research/` and in the oracle, where it's measurement. They aren't named in the site's changelog or other public copy without the owner reading it first.

## 5. Afterwards

- **Measure the fix with a rerun.** A finding is closed when a new run doesn't stumble there, not when the code is merged. Same brief, same site, a new folder.
- **Decide what a study's site becomes:** nothing, or an example in `examples/sites/` (the oracle then builds it and freezes its output). A starter is something every user reads past in `init --help`, so it takes more than one study asking for it. It's the owner's call.
- **Slim a run whose findings are fixed** (`../trials/fresh/README.md`, "When a run's findings are fixed"): keep `ssqch-case-study/`, save the port as `port.patch` (`git diff --binary HEAD`) and its new files as `port-new-files.tar`, note the base commit in `BASE.txt`, and delete the clone. Installs and builds (`node_modules`, `vendor`, `_site`, `.refs`, `.cache`) are never kept. Don't touch `../trials/a11yproject.com` or `../trials/v8.dev`: the oracle builds them.
- **Tell the owner:** the numbers, the top five findings, where each was sorted, and what's theirs to decide.
