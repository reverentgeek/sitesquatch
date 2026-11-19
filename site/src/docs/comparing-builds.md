---
title: "Comparing two builds"
description: "A build that succeeds isn't proof that an upgrade, a refactor or a migration left the site alone."
---
<img align="right" src="../../../docs/assets/stickers/footprint.svg" alt="" width="96">

A build that succeeds isn't proof that an upgrade, a refactor or a migration left the site alone. `ssqch diff` compares two output folders and says what changed, which is better evidence than most sightings get:

```sh
ssqch build --output dist-before   # before the change
# upgrade ssqch, edit a layout, move to another template language...
ssqch build
ssqch diff dist-before dist
```

```text
Comparing dist-before with dist
Ignoring asset fingerprints, integrity hashes, the generator's version, and whitespace between tags (--exact compares bytes).

Added (1)
  + /trails/cedar/

Removed (1)
  - /trails/old-growth/

Changed (2)
  ~ /trails/  (text and markup)
      ids removed (links to them break): #old-growth
      - <h2 id="old-growth">
      - Old growth
      + <h2 id="cedar">
      + Cedar
  ~ /assets/index.css  (index.3f2a1b4c.css -> index.9d8e7f6a.css)
      - body { color: #222 }
      + body { color: #111 }

Changes found: 3 pages and 1 other file (2 changed, 1 added, 1 removed); 148 pages and 4,730 other files are the same. The stump has moved.
```

- **What's ignored:** differences that don't change what a visitor gets. A fingerprinted file (`index.3f2a1b4c.css`: eight hex digits before the extension, unless they read as a date) is matched with its counterpart and compared by content, `integrity` hashes and the generator's version are left out, and HTML is compared as a list of tags and text, so whitespace between block tags doesn't count. A space next to an inline tag (`a <b>b</b>`) does, and so does whitespace inside `<pre>`, `<script>`, `<style>` and `<textarea>` (blank lines and indents included) and inside an attribute's value. `--exact` compares bytes instead.
- **What each page says:** whether its text, its markup or both changed, a changed `<title>`, any `id`s it no longer has (links to those anchors break), and `only dates changed (2025 -> 2026)` when every change on it is a date or a year.
- **Dates that changed:** when changed files differ only in dates or years, the summary says how many (`All 94 changed files differ only in dates or years`), and the JSON has `onlyDates: true` for each. The usual cause is a page with no `date` of its own (none in front matter or the file name): its date is the file's modification time, which a fresh checkout, a copy or another generator sets differently (Eleventy uses the file's creation time), so a footer with `{{ page.date.getFullYear() }}` changes on every page. Give pages that print it a `date`, use `{{ now() | dateformat("%Y") }}` for a copyright year, or `--ignore` the pattern while comparing.
- **Your own noise:** `--ignore <regex>` leaves matching text out of both sides, like a build date in the footer: `--ignore 'Built on [^<]+'`. Repeat it for more patterns. The pattern is a JavaScript regular expression, in its Unicode mode (the `u` flag): flags at the start (`(?i)`) and named groups written `(?P<name>...)` still work, but syntax only Rust had (`(?x)`, `\A`, `\z`, an escaped `-` outside `[...]`) is refused with JavaScript's words, and `\d` and `\w` are ASCII, so write `\p{Nd}` or `\p{L}` for other scripts' digits and letters.
- **Part of the site:** `--only '**/*.html'` compares only matching files (repeatable).
- **Longer diffs:** each file shows 10 changed lines; `--lines 0` shows them all.
- **Nothing to report:** `No differences: 148 pages and 4,730 other files are the same. The stump has not moved.`
- **Scripts and agents:** `--format json` prints the same report as JSON (`schemaVersion: 1`), and the exit code is 0 when the builds are the same, 1 when they differ and 2 on an error, like `diff`.

It works on any two folders of HTML, so it can also compare another generator's output with ssqch's while you move a site over.

**Several builds:** give it three or more folders and it lists what varies between them instead: `ssqch diff ref-1 ref-2 ref-3`. Build the same site the same way into each (from fresh copies), and it names each file that isn't the same in all of them, which builds agree (`ref-1, ref-2 agree; ref-3 differs`, or `only in ref-2`), and the lines that differ between the most common version and the next. "The same" is what a diff of two calls the same, so fingerprints and whitespace between tags don't count (`--exact`, `--ignore` and `--only` work as above). Do it first when moving a site from another generator: if its own build changes by itself (Jekyll printing the build's time, ids from `Math.random()`), pin that or `--ignore` it before comparing its output with ssqch's. The exit code is 0 when every build is the same and 1 when something varies; `--format json` has `runs`, `same`, `summary` (`varies`, `steadyPages`, `steadyFiles`) and `varies` (each file's `url`, `path`, `kind`, `versions` with their `runs` and `missing`, `changedLines` and `hunks`).
