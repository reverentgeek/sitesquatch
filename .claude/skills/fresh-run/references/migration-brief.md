# Migration brief

Fill in the two blanks, then give everything below the line to the agent as its whole prompt. Keep the rest as it is, so runs can be compared.

This is `research/migration-prompt.md` as it was on 2026-11-22, with one change: the compatibility options it named (`jekyllTemplates`, kramdown's Markdown options) became the `from-*` modules in 0.13.0. This copy is the one runs use.

- **Folder:** `<the clone's folder>`
- **ssqch:** `<"the latest release on npm" or "the tarball ../ssqch-next.tgz">`

---

Goal: a case study of moving this site to ssqch, used to improve ssqch itself: its features, its configuration options, `ssqch scout`, and its migration docs (especially for AI agents using ssqch). What you find should point at a change to ssqch, not at a rewrite of the site.

The site is in **[Folder]**. Version: **[ssqch]**. For npm, use the latest published version (check `npm view ssqch version`). For a tarball (`../ssqch-next.tgz`, packed from a branch), install that and build with it; note any differences from the npm release. Write down the version you built with.

1. **Baseline.** Profile the site (structure, content, templates, plugins, data, build pipeline, the tools besides the generator: Tailwind, esbuild, PostCSS) and benchmark it. Build the reference output with `ssqch baseline "<the site's build command>"` (it builds fresh copies with the clock pinned and `TZ=UTC`). If its builds vary, run more of them (`--runs 20`) and compare with `.cache/ssqch/baseline/ref-common`. If `baseline` can't build the site, write down why, work around it, and keep going.
2. **Scout.** On a new branch `ssqch-migration` (don't commit), run `ssqch scout` first, before reading the site by hand, and save its report (`ssqch scout --format json > ssqch-case-study/scout-before.json`). Use `--write-draft` and `--patch` if they help, and read the patch before applying it. Record what the report got right, what it missed, what it got wrong, and what you had to find yourself. Run it again when you're halfway and when you're done, and record whether "what's left" matched what was left.
3. **Done when:** the full build's output is byte-identical (`ssqch diff --exact`) to the reference, both built from fresh checkouts with `TZ=UTC`. If the site's own output isn't stable, prove it and match its most common output. If a part can't be byte-identical (images drawn by another language's libraries, a feature only the old generator's language has), prove why, match everything else, and count what's left. Don't change the site's content or layouts unless it's unavoidable; list every content file you touch and why. Prefer ssqch's own way in for the generator (its module, such as `fromJekyll()` or `fromMkdocs()`, the aliases, and what its trailhead says: `ssqch docs --from <generator>`) over editing templates, and when ssqch has nothing for something, write it down as a missing feature before you work around it.
4. **Then an idiomatic port:** ssqch's built-in features instead of the site's own libraries and your workarounds (its Markdown, highlighter, minifier, plugins). It doesn't need to match exactly: measure how close it gets (`ssqch diff`, byte-identical and normalized) and how fast it is, and rank the missing features by pages affected.
5. **Benchmarks for both generators:** the generator step and the full build (median of 10 and of 5), the dev server's rebuild after an edit, peak memory, and install size. Keep the scripts in `ssqch-case-study/` so they can be rerun.

Keep a **friction log** as you go (`ssqch-case-study/friction-log.md`), one line per stumble, with the time: what you tried, what happened, and how long it cost. It's the raw material for everything below, so write it while it's fresh, not at the end.

Deliverables, in `ssqch-case-study/` in this repo:

- **README.md:** a summary for someone deciding whether to move: how close it got, how long it took, what it needed, the benchmarks, and the top five issues.
- **issues.md:** each problem with its symptom, its cause (with the ssqch source location), the workaround, and the fix. Mark each as a bug in ssqch, a missing feature, a gap in the docs, or a bug in the site itself (list those; don't fix them).
- **suggestions.md:** ssqch improvements ranked by impact, with effort estimates, in these groups:
  - bug fixes;
  - compatibility features and configuration options: what would let this site's templates, content and config run as they're written (name the option, its values and what it would do);
  - features useful to this and other sites;
  - `ssqch scout`: what it should detect, list or draft for this generator, with counts from this site (how many files and uses each thing has);
  - `ssqch baseline` and `ssqch diff`: what would have made the compare loop faster;
  - docs, with ready-to-paste text for the trailhead (`site/src/docs/trailheads/`);
  - agent experience: where you lost the most time, and what output or docs would have saved it.
- **benchmarks.md,** plus the raw data.
- **How much JavaScript the move needed:** a section in README.md with the lines of code you wrote beside the config, split into rebuilding the old generator's behavior, the site's own logic, and front-end tools; which npm packages you added and why; and which of those lines an ssqch feature would replace.

Out of scope unless I ask: editing ssqch's own repository, fixing bugs in the site (list them instead), committing or pushing. Work in this folder only. Don't stop until step 3 passes or you've proven what can't; if something blocks you, work around it, document it, and keep going.
