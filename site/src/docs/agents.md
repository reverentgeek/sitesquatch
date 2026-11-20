---
title: "Scripts and coding agents"
description: "The voice is for people."
---
The voice is for people. The same commands work for a script, a CI job or a coding agent, with JSON in place of the text a person reads, and no jokes in it. Every JSON document has a `schemaVersion`, which changes only when a field is removed or changes meaning.

`ssqch build --format json` prints one report on standard output, whether the build worked or not (the exit code is 0 or 1 as usual):

```sh
ssqch build --format json
```

```json
{
  "schemaVersion": 1,
  "ok": false,
  "environment": "production",
  "output": "dist",
  "warnings": [
    {
      "code": "schema",
      "message": "src/guides/pine.md: `lvl` isn't a field of this schema (did you mean `level`?) (schema `guides`)",
      "file": "src/guides/pine.md",
      "field": "lvl"
    }
  ],
  "errors": [
    {
      "code": "template",
      "message": "rendering index.edge with `edge`: index.edge:4: Cannot read properties of undefined (reading 'toUpperCase') in `guide.data.name`",
      "file": "src/index.edge",
      "line": 7
    }
  ]
}
```

- **Each warning and error** has a `code` and the `message` a person would have read. `file` (from the project root) is there when the problem is in a file that exists, `line` when the line is known, `field` for a [schema](content-schemas.md) problem, and `url` for a problem in a written page, like a broken link.
- **`line` is a line of the file.** Template languages count from the end of the front matter, which is the number in the message (`index.edge:4`); the report adds the front matter back (`"line": 7`).
- **The codes:** `config`, `data`, `front-matter`, `template`, `schema`, `conflict` (two pages write the same file), `links`, `images`, `assets`, `fetch`, `passthrough`, `last-modified`, `hook`, `console` (`console.warn` in a config), `template-formats` (files in a template language the site doesn't list), `other-generator`, `foreign-key` and `foreign-global` (another generator's config, front matter or template data), `over-budget` (a [footprint budget](footprint.md)), `slow-call` (a filter, transform or collection of the site's that took a second or more in one call: [Where the time went](build-summary.md#where-the-time-went)), `missing-asset` (from `ssqch serve`), and `build` for anything else.
- **A build that works** also has `durationMs`, `pages` (`written`, `templates`, `bytes`, and `new` and `gone` since the last build to that folder, or `null` when there wasn't one), `copied`, `removed`, `drafts` (the `draft: true` pages a production build left out), `written` (each page's file, from the output folder), `summary` (the lines plugins add to the [build summary](build-summary.md)) and `timings`.
- **Standard output is only the report.** The lines a person would have read (`[ssqch] Writing ...`), `console.log` from your config and the output of `beforeBuild` commands go to standard error; `--quiet` leaves the progress lines out.

`ssqch capabilities --format json` says what the installed ssqch supports, so nothing has to be guessed from the documentation of another version: its `version`, `commands`, `features` (`avif`, `fetch`, `sass` and each template language, listed only when this build can do them), `templateLanguages` with their extensions, `configFiles`, `configOptions`, the built-in `modules` with what each exports, `nodeModules` (Node's built-in modules), `globals` and `imageFormats`. Without `--format json` it prints the same as text, under "What's in the pack".

`ssqch docs` is this documentation, from the package, so it matches the version that's installed and works without the network. Alone, it lists every command, config option, template function and module export with one line each. `ssqch docs base` (or `imagePlugin`, `toc`, `serve`) prints what these docs say about that name and which other sections mention it, `ssqch docs "content schemas"` prints a section, and other words search the text. Another generator's word gets ssqch's (`ssqch docs pathPrefix`), and `ssqch docs --from eleventy` lists that generator's words with ssqch's for each, then its trailhead. `--format json` has the same, with each answer's `names`, `section` and `also`.

`ssqch init` writes an `AGENTS.md` for coding agents, with a one-line `CLAUDE.md` that imports it: what each file is, and the commands above for looking a name up, checking a change and comparing builds. It's about 1 KB, since an agent carries it through a whole session, and `init` never replaces one a site already has. For a site that doesn't have one, `ssqch docs agents > AGENTS.md` writes it.

`ssqch serve --ready-file <file>` writes a file once the first build is done and the site is being served, so a script can wait for the file instead of reading the server's output or sleeping:

```sh
ssqch serve --port 0 --ready-file .cache/ready.json &
```

```json
{
  "schemaVersion": 1,
  "url": "http://localhost:60768/",
  "port": 60768,
  "base": "",
  "output": "/home/sam/site/dist",
  "pid": 39675,
  "ok": true
}
```

`ok` is whether that first build worked (the server keeps running either way, and rebuilds when a file changes). The file is deleted when the server starts, so one from an earlier run never counts, and it's written again when a changed config loads, since `output` and `base` can change with it.

The other commands with JSON are [`ssqch inspect --format json`](where-values-come-from.md) (where a page's data came from) and [`ssqch diff --format json`](comparing-builds.md) (what a change did to the output; it exits with 0, 1 or 2 like `diff`).

## Moving a site with an agent

Every move from another generator so far ran the same loop: build the old site, build the new one, compare, fix the biggest group of differences, repeat. It's a loop an agent can run, as long as each step has an answer it can read:

1. **Reference builds you can trust.** `ssqch baseline "<old build command>"` builds the old site with its own generator three times, each in a fresh copy with every file's time pinned and `TZ=UTC`, into `.cache/ssqch/baseline/ref-1` to `-3`, and names what changes by itself (the build's time, ids from `Math.random()`): pin it, or note an `--ignore` pattern for it, before anything else. After `ssqch import --write`, build the commit before it: `--commit <rev>`.
2. **The mechanical part.** `ssqch import <generator>` (Eleventy and Zola) lists what it would change and what's left to port, each with its file and line; read it, then run it again with `--write`. `ssqch docs --from <generator>` has that generator's words with ssqch's for each, and its trailhead.
3. **A build that works.** Build into an empty folder (files an earlier build left count as differences): `rm -rf dist && TZ=UTC ssqch build --format json`, until `ok` is true. Each error has a `code`, a `file` and a `line`.
4. **The biggest group first.** `ssqch diff .cache/ssqch/baseline/ref-1 dist --format json --lines 0` lists the changes on more than one file as `groups`, the most files first. One cause (a filter that formats dates another way, a layout that lost a `<meta>`) is often hundreds of pages, and fixing it shows what's under it. Build and compare again after each fix. What browsers read the same (attribute order, quotes, entities, `<br/>`), fingerprints and image ids don't count, so what's left is a real difference.
5. **Done is a decision.** Stop at `No differences`, or when what's left is on purpose: write each one down with why (an `--ignore` pattern with a comment, or a line in the move's notes). `ssqch diff --exact` shows the bytes that still differ, such as a minifier's.
6. **Then ssqch's own features,** one at a time (its Markdown, highlighting, minifying, `toc()`), with a diff after each, so every change in the output has one cause.
