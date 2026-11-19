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
Ignoring asset fingerprints, image ids, integrity hashes, the generator's version, whitespace between tags, and how tags are written where browsers read them the same (attribute order, quotes, entities, `<br/>`) (--exact compares bytes).

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

Files left in a folder by an earlier build count as added or removed: build each side into an empty folder.

Changes found: 3 pages and 1 other file (2 changed, 1 added, 1 removed); 148 pages and 4,730 other files are the same. The stump has moved.
```

- **What's ignored:** differences that don't change what a visitor gets. A fingerprinted file (`index.3f2a1b4c.css`: eight hex digits before the extension, unless they read as a date) is matched with its counterpart and compared by content, `integrity` hashes and the generator's version are left out, and HTML is compared as a list of tags and text, so whitespace between block tags doesn't count. A space next to an inline tag (`a <b>b</b>`) does, and so does whitespace inside `<pre>`, `<script>`, `<style>` and `<textarea>` (blank lines and indents included) and inside an attribute's value. `--exact` compares bytes instead.
- **What each page says:** whether its text, its markup or both changed, a changed `<title>`, any `id`s it no longer has (links to those anchors break), and `only dates changed (2025 -> 2026)` when every change on it is a date or a year.
- **Dates that changed:** when changed files differ only in dates or years, the summary says how many (`All 94 changed files differ only in dates or years`), and the JSON has `onlyDates: true` for each. The usual cause is a page with no `date` of its own (none in front matter or the file name): its date is the file's modification time, which a fresh checkout, a copy or another generator sets differently (Eleventy uses the file's creation time), so a footer with `{{ page.date.getFullYear() }}` changes on every page. Give pages that print it a `date`, use `{{ now() | dateformat("%Y") }}` for a copyright year, or `--ignore` the pattern while comparing.
- **Your own noise:** `--ignore <regex>` leaves matching text out of both sides, like a build date in the footer: `--ignore 'Built on [^<]+'`. Repeat it for more patterns. The pattern is a JavaScript regular expression, in its Unicode mode (the `u` flag): flags at the start (`(?i)`) and named groups written `(?P<name>...)` still work, but syntax only Rust had (`(?x)`, `\A`, `\z`, an escaped `-` outside `[...]`) is refused with JavaScript's words, and `\d` and `\w` are ASCII, so write `\p{Nd}` or `\p{L}` for other scripts' digits and letters.
- **Part of the site:** `--only '**/*.html'` compares only matching files, and `--exclude 'img/**'` leaves matching files out (both repeatable; `--exclude` applies after `--only`). A file left in an output folder by an earlier build is an added or removed file too, so build each side into an empty folder.
- **Longer diffs:** each file shows 10 changed lines; `--lines 0` shows them all.
- **Nothing to report:** `No differences: 148 pages and 4,730 other files are the same. The stump has not moved.`
- **Scripts and agents:** `--format json` prints the same report as JSON (`schemaVersion: 1`), and the exit code is 0 when the builds are the same, 1 when they differ and 2 on an error, like `diff`.

It works on any two folders of HTML, so it can also compare another generator's output with ssqch's while you move a site over.

## Comparing another generator's output

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch.

**Markup browsers read the same:** two generators write the same page in different ways, and a browser reads them alike, so the diff doesn't list them. Each tag is compared in one form: element and attribute names in lower case, attributes in alphabetical order (the first of two with one name, as a browser keeps it), values with their entities decoded and in double quotes, a boolean attribute without a value (`defer`, `defer=""` and `defer="defer"`), no `/` before the `>` (`<br/>` is `<br>`), and in an SVG or MathML, `<path/>` as `<path></path>`. Spacing inside `class`, `rel`, `srcset` and `sizes` doesn't count (`a.jpg 1x,b.jpg 2x` is `a.jpg 1x, b.jpg 2x`). In text, and inside `<pre>` and `<textarea>`, an entity and its character are the same (`&#39;` and `'`, `&gt;` and `>`, `&amp;` and a lone `&`), apart from `&nbsp;`, which stays different from a space. What a browser reads differently still counts: an attribute's value, the order of `class` names, `<div/>` in HTML (which doesn't close the `div`), and entities in a `<script>` or `<style>`. The ReverentGeek blog's comparison with its Eleventy build went from 24,659 changed lines to 225 with it, and from 161 changed pages to 14.

**Image ids:** `imagePlugin()` and eleventy-img name an image by an id from a hash and its width (`/img/LeC3bj9CzE-256.webp`), and two builds that hash differently (another generator, other image settings) name every image differently. In pages and feeds the id reads as `{id}` (`/img/{id}-256.webp`), so a page compares by its widths and formats; the files keep their own names, so a replaced image is still a removed and an added file. More than five such images in the Added or Removed list are one counted line (`4,689 images named by an id`); `--format json` lists each. An id is ten letters, digits, `-` and `_` before `-<width>.<ext>`, and not a plain lower-case word or a number, so `screenshot-1200.png` keeps its name.

**Feeds and sitemaps:** an XML file is compared as tags and text too, with its names' case kept, and the HTML a feed carries in `<content>`, `<description>` or `<summary>`, escaped (`&lt;p&gt;`) or in CDATA, is compared as HTML. A file whose changes are only dates says `only dates changed`, as a page does, and one whose lines only moved says `the same lines, in another order` (a sitemap that lists its pages in another order).

**Groups:** when the same change is on more than one file, it's listed once, the most files first, with how many files have it, the first three, and its lines as the first file has them: `~ 102 pages, the same but for attribute values: /ar/building-community/, ... and 99 more`. A group's tags can differ in their attribute values from file to file (each link moved to another anchor), but its text is the same, and `the same but for attribute values` says when the values differ. After the groups, each file is listed with what's left (its changes no group holds), and a file whose changes are all in groups isn't listed again. That's the order to fix them in: one cause is often hundreds of pages. `--ungrouped` lists each file with all its changes instead. With `--format json`, `groups` has each one's `files` (how many), `urls`, `same`, `kind` (`dates`, `order`, `markup`, `text` or `markup and text`) and `hunk`, and each changed file's `groups` are places in that list. opensource.guide's comparison has 12 groups, one of them on 102 of its 172 changed pages.

**Links:** a symbolic link is compared by where it points, not by what's there (that file is compared on its own): two links to the same target are the same, a link that points elsewhere shows `- -> old.html` and `+ -> new.html` (`a link, to somewhere else`), and a link in one build that's a file in the other says so.

**Several builds:** give it three or more folders and it lists what varies between them instead: `ssqch diff ref-1 ref-2 ref-3`. Build the same site the same way into each (from fresh copies), and it names each file that isn't the same in all of them, which builds agree (`ref-1, ref-2 agree; ref-3 differs`, or `only in ref-2`), and the lines that differ between the most common version and the next. "The same" is what a diff of two calls the same, so fingerprints and whitespace between tags don't count (`--exact`, `--ignore` and `--only` work as above). Do it first when moving a site from another generator: if its own build changes by itself (Jekyll printing the build's time, ids from `Math.random()`), pin that or `--ignore` it before comparing its output with ssqch's. The exit code is 0 when every build is the same and 1 when something varies; `--format json` has `runs`, `same`, `summary` (`varies`, `steadyPages`, `steadyFiles`) and `varies` (each file's `url`, `path`, `kind`, `versions` with their `runs` and `missing`, `changedLines` and `hunks`).
