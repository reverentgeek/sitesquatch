# Changelog

SiteSquatch follows [semantic versioning](https://semver.org). While it's at 0.x, a release that
breaks existing sites bumps the minor version (0.2.0 to 0.3.0), and everything else bumps the
patch version (0.2.0 to 0.2.1). Breaking changes are listed under **Breaking**, with what a site
has to change.

The version is `version` in `packages/ssqch/package.json` (up to 0.7, `[workspace.package]
version` in `Cargo.toml`, shared by every crate). A release is a `v<version>` tag on a commit
where that version matches.

## Unreleased

Found moving opensource.guide (Jekyll) and expressjs.com (Astro) to 0.8.0.

### Breaking

- A `computed` value named `page` is an error (`` `page` in computed isn't applied, because `page`
  is ssqch's ``). It was thrown away without a word, since ssqch sets `page` after `computed` runs.
  A site that has one: give it another name (`computed: { meta: ... }`) and use that in templates.
- `headingIds: "github"` (the default) follows github-slugger 2.0.0 character for character, the
  slugger rehype-slug uses (so Astro's, VitePress's and Docusaurus's anchors) and GitHub's anchors
  match. A heading's id changes when it has a combining accent (`e` + U+0301, which stays), an
  emoji's variation selector or a zero-width joiner (which stay), or a superscript or fraction
  (`x²`, `½`, which go). A site linking to such a heading's old id: link to the new one, or give
  the heading its id (`## x² {#x2}`). expressjs.com had 29 pages linking to ids ssqch wrote
  differently.
- `slot` is ssqch's container name (named slots, below), so `_includes/containers/slot.*` is an
  error. A site that has one: rename the container.

### Added

- `SOURCE_DATE_EPOCH` pins the build's time: `now()`, Liquid's `"now"`, Edge's `new Date()`, and
  the date of every page without one (which then sort by path), as Jekyll's `time:` does. A
  reference build that's the same every time took pinning in both 2026-11-18 studies.
- `sitemapPlugin({ alternates })`: a function that returns a page's translations, written as
  `<xhtml:link rel="alternate" hreflang>` under its `<loc>`, as @astrojs/sitemap and Google list
  them. expressjs.com's port wrote its sitemap in an `afterBuild` hook for them.
- A trailhead for Jekyll (`docs/trailheads/from-jekyll.md`, `ssqch docs --from jekyll`): the config,
  `page` and `site`, includes and plugin tags, Ruby Liquid's differences, the plugins, and kramdown,
  from moving opensource.guide.
- `toc` takes `id`, `class`, `sublistClass`, `itemClass` (`{level}` is the heading's level) and
  `linkClass`, so a table of contents can keep another generator's markup and CSS (jekyll-toc's
  `section-nav` and `toc-entry toc-h2`).
- Containers get `container.props`, their arguments read as a component's attributes
  (`::: card type="tip" open items='["a","b"]'`), and named slots: a `::: slot title` block inside
  a container is its `container.slots.title`, left out of `container.content`, as MDX's
  `<Fragment slot>` is. A slot with no template around it to take it renders where it is.
- The config's functions are Liquid tags, as they are in Nunjucks, so a Jekyll plugin's tag can be a
  function: `{% seo title=false %}` calls `seo({ title: false })` and prints its answer unescaped,
  and `{% callout "tip" %}...{% endcallout %}` passes what's between first. Liquid's own tags keep
  their names.
- Jekyll's `{% include_relative parts/intro.md who="rangers" %}` in Liquid: a file beside the
  template, with `include.who`; `{{ }}` in the name works and `..` is refused, as in Jekyll.
- Config and data files can import the site's own files through `tsconfig.json`'s or
  `jsconfig.json`'s `compilerOptions.paths` (`import { menu } from "@/config/menu"`), as Astro,
  Vite and Next.js codebases do, with TypeScript's rules: the longest matching pattern, its targets
  in order, from `baseUrl` or the tsconfig's folder. An import Node resolves itself is unchanged.
- A warning when a Nunjucks template gives one of the config's filters' names to a macro, an
  import, a `set` or a loop variable and then calls that name as a function
  (`{% from "ui.njk" import postCard %}` … `postCard(post)`): the call means the template's own
  thing, not the filter, and printed `function () { [native code] }` without a word. It names the
  file and line.
- Build hooks get `quiet` and `verbose` (whether the build was run with `--quiet` or
  `--verbose`), and a hook's command and `serve.run` commands get `SSQCH_QUIET`, so their own
  messages can follow `-q`.

### Changed

- `ssqch docs` answers a name with the paragraph that leads with it in bold too (`**Containers:**`),
  not only a table row that points at it. `ssqch docs pagination` explains pagination (it listed
  option names), `data` says a value that's a function is called for that name, and `i18n`,
  `translations`, `hreflang`, `multilingual` and `seo` find new sections: what isn't built in yet,
  and the recipes two migrations used.

### Faster

- Liquid's `where` and `reject` don't run liquidjs' generator and new scope for every item when
  they filter a list by a property (`collections.posts | where: "data.lang", "fr"`), with the same
  answers. A layout that looks pages up in a collection on every page builds 8.6 times faster: the
  benchmark's new Liquid case went from 39.8 s to 4.6 s, and opensource.guide's idiomatic port from
  6.8 s to 1.4 s.

### Fixed

- With `"js"` in `templateFormats` (for `.js` files with front matter), the config and the modules
  it imports were built as pages (`_site/ssqch.config/index.html`). They're code, and skipped. The
  README has the recipe for text files with front matter.

- The hint for Jekyll's `jsonify` in a Jinja or Nunjucks template said Liquid's is `json`; it says
  `jsonify` works in Liquid.

- An error that many pages hit at one spot (a broken include in a layout) shows that spot's lines
  once, not up to three times, so a second, different error gets its own.

- `ssqch/sass` finds an `@import`, `@use` or `@forward` that names its extension
  (`"primer-core/index.scss"`) in the load paths, as Dart Sass and Ruby Sass do; it looked only
  beside the importing file, so GitHub's primer, whose files all import that way, didn't compile.
  And a stylesheet that starts with front matter (Jekyll's `---` lines) compiles, the lines left
  blank so error lines still match.
- A folder Bundler installed gems into (`bundle install --path vendor/bundle`, which Jekyll
  sites do) isn't read as the site's pages: its gems' templates were built, and failed.
- A page's `page.headings` read before the page had rendered (from a `computed` value, say) stayed
  an empty list for the rest of the build, so a table of contents built from it later was empty.
  Now an early read is empty and a read after the page renders has its headings.

## 0.8.0 - 2026-11-18

ssqch 0.8 is a TypeScript program on Node (22.18 or newer), installed from npm. The contract is
0.7's: the commands and flags, the config, `ssqch.d.ts`, the JSON reports, the diagnostic codes and
the voice. Rendering, Markdown, minify and Sass give 0.7's output, and the blog, the examples and
the starters build to the same bytes, apart from image bytes (sharp encodes the images now), the
starters' editor types and the docs starter's Install and Deploying pages. Most sites change
nothing. Breaking lists what a site might have to change, by theme: installing, a site's
JavaScript, data, templates, Markdown, images and feeds, builds, `serve.run` tools, `diff` and Rust
plugins. Changed lists what's new, what works now that didn't, and the messages that read
differently.

### Breaking

#### Installing

- **How ssqch is installed: from npm, and only from npm.** The npm package is ssqch itself,
  JavaScript that runs on Node 22.18 or newer, with sharp as its one dependency; the
  `@ssqch/<platform>` packages are gone, so a `pnpm-workspace.yaml` that lists them under
  `minimumReleaseAgeExclude` needs only `ssqch`. There's no standalone executable: no installer
  scripts, no release archives, and no `setup-ssqch` action. In a site, `npm install --save-dev
  ssqch`; outside one, `npm install --global ssqch` or `npx ssqch@<version>`. Homebrew's formula
  (`brew install reverentgeek/tap/ssqch`) installs the npm package with Homebrew's Node, so
  `brew upgrade` moves to 0.8 by itself. In GitHub Actions, replace `setup-ssqch` with
  `actions/setup-node` and `npm ci` (or `npm install --global ssqch@<version>`). On Netlify, run
  ssqch from the site's dev dependency, or `npx --yes ssqch@<version> build`, in place of the
  installer. Once 0.8.0 is the latest release, `releases/latest/download/ssqch-installer.sh` and
  `.ps1` are gone (a pinned `download/v0.7.0/` installer still installs 0.7.0). Delete 0.7's
  binary from `~/.cargo/bin`, where its installer put it, so it doesn't stand in front of the new
  one on your `PATH`. `cargo install ssqch` and `cargo binstall ssqch` end at 0.7.

#### A site's JavaScript

- **A site's JavaScript runs on Node.** The config and data files are loaded by Node, by its
  rules for ES modules and CommonJS, with every package and built-in Node has. What 0.7's own
  runtime did differently goes:
  - A CommonJS package's exports are imported by name only where Node can read the names from
    its source. `import legacy, { twice } from "legacy"` fails for a package that writes
    `module.exports = { name: "legacy", twice }` with other values in it; import the default and
    take it apart (`import legacy from "legacy"; const { twice } = legacy;`).
  - `fs.createReadStream` and the other functions 0.7 only pretended to have are Node's own: a
    stream for a file that isn't there fails later, as an error of the build, where 0.7 threw
    when it was called.
  - `console.log` prints objects as Node prints them, where 0.7 printed JSON.
  - On Windows, paths are Windows' own, as in Node: `node:path` joins with `\`, and
    `process.cwd()`, `__dirname` and `__filename` have drive letters and `\`, where 0.7 gave
    POSIX paths on every system. Code that builds URLs from paths should use `node:path/posix`
    or replace the separators. What ssqch itself hands a site (`page.inputPath`, `page.url`,
    a hook's `dirs`) still has `/` everywhere.
- **`ssqch capabilities` has no stand-in Node modules.** 0.7 listed `node:http`, `node:net`,
  `node:child_process` and 12 more under `nodeModules.stubs`: they loaded and threw when used.
  They are Node's own now, so `nodeModules.available` has all 32 and `stubs` is an empty list
  (the key stays). A script that skips a site's work when a module is a stub should drop the
  check.
- **`fetch` is Node's own, with 0.7's error words and `cache` option on top.** The reason after
  `fetch failed: <url>:` is Node's (`connect ECONNREFUSED 127.0.0.1:9`, `getaddrinfo ENOTFOUND
  ...`), where 0.7 gave its HTTP library's (`io: Connection refused`); a script that matched that
  text should match the `cause` or the URL. Requests go out as 0.7 sent them, where the Fetch
  standard would refuse or change them: credentials in the URL are Basic auth, the user agent is
  `ssqch/<version>`, and a request for a port the standard blocks (6000, 6665 to 6669, 10080 and
  the others) or with a `Host`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade` or `Expect` header
  goes out through `node:http`. Three things are Node's: a response's `statusText` is the server's
  own (`"Pine OK"`), where 0.7 gave the standard words for its status (`"OK"`, and `""` for a
  status without any); a response's `url` has no credentials in it, where 0.7 kept them; and an
  error names the URL without its password. A response saved with `cache` lists its headers in
  name order, with repeated ones joined (`"a, b"`), as Node's `Headers` gives them, where 0.7's
  file had the server's order; a site reads them the same either way.

#### Data

- **Filters and templates get your real objects.** 0.7 handed them copies that kept writes to
  themselves; now a filter that sorts or changes what it's given changes it for the pages
  rendered after it. Copy first (`[...posts].sort()`). Data that refers to itself (`a.self = a`)
  is only data now; 0.7 refused it as "nested too deeply".
- **An object's keys that look like whole numbers come first, in number order**, as JavaScript
  keeps them: paginating over `{ "2024": ..., "b": ..., "2023": ... }` makes the pages for 2023,
  2024, then b, where 0.7 kept the file's order. Use a list where the order matters.
- **YAML dates are dates in every key**, as js-yaml (and so Eleventy) reads them: `updated:
  2026-03-14` is a `Date`, where 0.7 kept it as text for every key but `date`. A template that
  printed the text gets the date printed (ISO 8601 in Jinja and Nunjucks); quote the value to
  keep it as text.
- **YAML numbers and merge keys are js-yaml's too.** `017` is the number 17 and `1_000` is 1000,
  where 0.7 kept both as text, so a value with a leading zero that matters (a ZIP code, `007`)
  needs quotes. `<<: *defaults` merges the anchored mapping in, where 0.7 kept a key named `<<`.

#### Templates

- **Jinja (`.jinja`, `.j2`) and Nunjucks (`.njk`) render with Nunjucks**, ssqch's own fork of
  it, where 0.7 used MiniJinja. Jinja's filters, tests and functions, Python's string, list and
  dict methods, slices, the date filters, tags from your functions and the escaping are kept, so
  most templates render as they did. What doesn't:
  - **`.njk` prints values as Nunjucks does**, as a site from Eleventy expects: `true`, a list as
    `a,b`, an object as `[object Object]` and `none` as nothing, and `dump` is compact JSON
    (`dump(2)` indents it), escaped unless it's followed by `| safe`. 0.7 printed `True`,
    `['a', 'b']` and a spaced, unescaped `dump`, as Jinja does, which `.jinja` still does. A date
    prints as ISO 8601 in both, whatever the machine's time zone.
  - A variable set inside a loop or an `if` keeps its value after it, as in Nunjucks:
    `{% set total = 0 %}{% for x in xs %}{% set total = total + x %}{% endfor %}` ends with the
    sum, where Jinja's scoping left it at 0 (`namespace()` still works).
  - A variable set in an include stays in the include: `{% set shared = "changed" %}` in
    `_includes/i.jinja` doesn't change the page's `shared`, and a name it sets isn't the page's.
    0.7 let both out. Set the value in the page, or have the include print it.
  - `{% break %}`, `{% continue %}`, `{% with %}`, `{% autoescape %}`, the loop filter
    `{% for x in xs if x.ok %}` and recursive loops (`{% for x in xs recursive %}` with
    `loop(...)`) are errors that name their line and say what to write instead. Put an
    `{% if %}` inside the loop, filter the list first (`xs | selectattr("ok")`), or write a
    macro that calls itself for a tree.
  - `loop.previtem`, `loop.nextitem` and `loop.depth` are undefined (`loop.cycle()` and
    `loop.changed()` work).
  - Numbers have no separate float type: `{{ 4 / 2 }}` and `{{ 3.5 | round }}` print `2` and
    `4`, where 0.7 printed `2.0` and `4.0`.
  - `+` and `*` are JavaScript's: `xs + ys` joins two lists as text (use `xs | chain(ys)`), and
    `"ab" * 3` isn't `"ababab"`.
- **Liquid is liquidjs**, the library 0.7's Rust crate followed, with 0.7's own behavior kept where
  the two differ: dates print as 0.7 printed them (`2026-01-02 00:00:00 +0000`, in UTC) in every
  filter; numbers keep the crate's whole numbers and floats (`10 | times: 1.0 | divided_by: 4` is
  2.5, `7 | divided_by: 2` is 3, and a missing or non-numeric operand, or dividing by zero, is an
  error); a missing value reaches a config function as `null`; and `capitalize`, `escape`,
  `escape_once`, `url_encode`, `url_decode`, `split`, `truncate`, `truncatewords`, `map`, `uniq`
  and `size` give 0.7's output. Two of 0.7's answers are Shopify's and Jekyll's now: `"abc" |
  split: ""` is `a`, `b`, `c` (0.7 put an empty string at each end), and `array_to_sentence_string`
  joins two items as `pine and cedar` (0.7 wrote `pine, and cedar`; three or more still have the
  comma). What's liquidjs' own: `{{ some_object }}` prints `[object Object]`, where 0.7 ran its
  keys and values together in no fixed order (`{z: 1, a: "two"}` printed `z1atwo`), so write
  `{{ some_object | json }}`; `{{ some_object.size }}` is its number of keys, where 0.7 printed
  nothing; a string's `size` counts as JavaScript does, where 0.7 counted UTF-8 bytes (`café` is
  4, not 5); and a variable named `empty` or `blank` is Liquid's keyword (`{% if empty %}`), so
  rename it.
- **Edge templates are edge.js 6.5's**, with what 0.7's own Edge did kept around it (an undefined
  value prints nothing, a call reaches the filter beside a page field of the same name,
  `$loop`, `reverse()` and `sort()` giving copies, dates in UTC and as ISO 8601 text, strings
  indexed by character, numbers never in exponent notation). What changes:
  - `{{ safe(html) }}` prints `html` as it is, as edge.js's `html.safe` does. 0.7's `safe()`
    changed nothing, so the value was escaped anyway; drop `safe()` where the escaping was wanted.
  - A variable an include declares with `@let`, that the template including it doesn't have,
    is the include's only, as edge.js scopes it; 0.7 declared it in the including template too.
    Declare it before the `@include` (an `@assign` or `@let` of a variable the including template
    has reaches it, as in 0.7), or make the include a component and pass it as a prop.
  - An async function (an async filter) called inside a callback is awaited in `map`
    (`posts.map(p => cover(p))`), and is an error that says to call it first with `@let` in
    `filter`, `find` and the others, where 0.7 awaited it anywhere.
  - Node's globals are there in expressions (`process`, `URL`), as in any JavaScript; a page's
    value or a config function of the same name still wins, as in 0.7.
  - A parse error is in edge.js's words (`parse error in page.edge: line 2: Unexpected token`),
    with the file and line as before.
- **EJS prints a date at UTC** (`Sun Apr 05 2026 06:07:08 GMT+0000`), in `<%= %>`, `<%- %>`, a list
  and a promise's answer, where 0.7 printed it in the machine's time zone (the two agree on a
  machine set to UTC). Format the date in the template to show it otherwise
  (`date.toLocaleString("en-US", { timeZone: "America/New_York" })`).
- **A Handlebars helper gets a date inside an object as a `Date`.** 0.7 turned the page's data into
  JSON first, so every date was ISO 8601 text; a date passed to a helper itself (`{{year date}}`)
  still arrives as that text, but one inside an object it's given (`{{byline post}}`) is a `Date`
  now.

#### Markdown

- **Markdown is ssqch's own, as in 0.7** (its Rust, built as WebAssembly), so pages come out as
  they did. A page's own Markdown waits for an async `headingIds` function or highlighter in
  `markdown.highlight.languages`, as 0.7 did. Markdown made while a template renders doesn't:
  where such a function answers with a promise, `markdown()` and `highlight()` in a template and
  `markdown()` from `"ssqch"` are errors that name the function, and so is a render hook or
  container template whose engine answers with one (an async filter, function or engine), where
  0.7 waited for them. Make those functions synchronous.

#### Images and feeds

- **`dateToRfc3339` and `dateToRfc822` refuse an invalid date.** An invalid `Date` (`new
  Date("2024-13-45")`) or `NaN` is an error, `dateToRfc3339: not a date: Invalid Date` (or
  `NaN`), as it is for ssqch's other date filters, where 0.7 wrote `1970-01-01T00:00:00Z` into
  the feed without a word. Fix the date, or leave the element out when there's none.
- **The image plugin's quality options are sharp's numbers, and `avifEffort` replaces
  `avifSpeed`.** 0.7's numbers were its own encoders', which read them differently: its AVIF 50
  looks like sharp's 41, and its JPEG 80 like sharp's 89 with mozjpeg. `webpQuality`,
  `avifQuality` and `jpegQuality` now go to sharp as they are, as whole numbers from 1 to 100,
  and `avifEffort` is sharp's AVIF effort, from 0 (fastest) to 9 (slowest, with the smallest
  files). The defaults are 0.7's converted (WebP 75, AVIF 41 at effort 2, JPEG 89), so a site
  that sets none encodes as it did. A site that set one converts it with this table, from the
  calibration at equal SSIMULACRA2 (between rows, along the line; `src/image/quality.ts` has the
  measurements). WebP's numbers are the same in both.

  | 0.7's number | `avifQuality` | `jpegQuality` |
  | --- | --- | --- |
  | 30 | 28 | 54 |
  | 40 | 34 | 60 |
  | 45 | 38 | 63 |
  | 50 | 41 (0.7's AVIF default) | 66 |
  | 55 | 45 | 69 |
  | 60 | 48 | 72 |
  | 65 | 52 | 76 |
  | 70 | 55 | 80 |
  | 75 | 58 | 85 |
  | 80 | 61 | 89 (0.7's JPEG default) |
  | 85 | 74 | 93 |
  | 90 | 86 | 97 |
  | 92 | 90 | 100 |
  | 95 | 96 | 100 |
  | 98 and up | 100 | 100 |

  | 0.7's `avifSpeed` | 1 | 2, 3 | 4, 5, 6 | 7, 8 (the default) | 9 | 10 |
  | --- | --- | --- | --- | --- | --- | --- |
  | `avifEffort` | 5 | 4 | 3 | 2 | 1 | 0 |

  So 0.7's `avifQuality: 60, avifSpeed: 4` is `avifQuality: 48, avifEffort: 3`. A converted
  number keeps 0.7's image names (each file's name holds the settings as the 0.7 number they
  convert from), so the image cache carries over and nothing encodes again. `avifSpeed` fails the
  build with the conversion, and so does a number that isn't whole or is out of range (0.7
  clamped it). At the top of the scale sharp can't match 0.7: from JPEG 92 and AVIF 98 up,
  sharp's best (100) is a little below what 0.7 made there.
- **An image that can't be encoded after its markup is written fails the build.** The image
  plugin writes a page's `<picture>` (and a link's copy, a feed's copy, `imageUrl()`'s URL) from
  the image's header while sharp encodes the files beside the build, so it reads a source through
  before anything points at a file it has to make, and what 0.7 couldn't decode is still a
  warning that leaves the tag as written, in 0.7's words (a file that ends too soon, a damaged
  chunk, a header that doesn't read). What that can't see, such as a PNG whose compressed data is
  damaged under correct checksums, or a cache folder that can't be written, comes to light after
  the pages are written, and the build fails where 0.7 warned, rather than publish markup for a
  file that isn't there: `images: encoding ./dist/img/<id>-300.webp from ./src/hike.png: <why>.
  ./src/posts/hike.md already points at it, so the build stops here rather than publish tracks
  that lead nowhere`. With `--format json` each source is an `images` error, with the source as
  its `file` and the page's address as its `url`. Fix or replace the image, or leave it out with
  `ssqch:ignore`.
- **`files(pattern, { dimensions: true })` reads the sizes of PNG, JPEG, GIF, TIFF, WebP, HEIF and
  AVIF, BMP, PSD, ICO and QOI files.** 0.7 also read EXR, Radiance HDR, JPEG XL, KTX2, DDS, TGA,
  PNM, farbfeld, Aseprite, ILBM and VTF files, whose `width` and `height` are `null` now.

#### Builds and `templateContent`

- **A build that fails can leave pages in the output folder.** Pages are written as they render,
  so the ones rendered before the error are there; 0.7 wrote nothing when any page failed. The
  exit code still says the build failed: don't deploy the folder of a build that failed.
- **A page's `templateContent` is rendered when it's first read.** In 0.7 a page read before it
  had rendered gave an empty string. A page whose own templates are async (an async filter or
  engine) can't be rendered on demand, and reading it too early is an error that names it.

#### `serve.run` tools

- **A `serve.run` tool has no terminal on Linux and macOS, and hears Ctrl-C on Windows.** 0.7
  started each in a process group of its own, so stopping it stopped what it started, and Ctrl-C
  was ssqch's to pass on. Node can only do that by giving the tool a session of its own too
  (Linux, macOS), where nothing opens `/dev/tty`, or a console of its own too (Windows), where
  each program the tool starts opens a window. So on Linux and macOS a tool that asks something
  through the terminal (a password, `npx`'s "Ok to proceed?") can't: give it what it needs on
  its command line (`npx --yes`). On Windows a tool shares ssqch's console and gets Ctrl-C
  itself, as it would from a terminal; what it says once ssqch is stopping isn't shown (cmd.exe's
  "Terminate batch job (Y/N)?"), and ssqch still stops it and what it started.

#### `diff`

- **`ssqch diff --ignore` refuses two kinds of pattern JavaScript can't match.** Patterns are still
  in the syntax of Rust's regex crate, read as 0.7 read them (`\w`, `\d`, `\s` and `\b` in every
  script, `.` up to a `\n` only, flags partway through, `(?x)`, `\A`, `\z`, `[a-z&&[^aeiou]]`, and
  the crate's error messages) and matched by JavaScript. What's refused, with a message that says
  so: the Unicode properties JavaScript doesn't have (`Age`, `Grapheme_Cluster_Break`,
  `Word_Break`, `Sentence_Break`, `Hyphen`, `Grapheme_Link`, `IDS_Unary_Operator`,
  `ID_Compat_Math_Start` and `_Continue`, `Modifier_Combining_Mark`,
  `Prepended_Concatenation_Mark` and the `Other_` ones), and, on Node 22, a property in a
  case-insensitive group that's only part of the pattern (`(?i:\p{Lu})x`). Write the property's
  characters out, or put `(?i)` at the start of the pattern (or use Node 23 or newer).

#### Rust plugins

- **Plugins written in Rust are `.wasm` files.** 0.7's Rust API (a site as its own Rust program,
  `sitesquatch::Plugin`, modules of Rust functions) ends with 0.7. A Rust plugin is now a crate
  built with `ssqch-plugin` for `wasm32-wasip1` (its `Plugin` trait and `export!`), one file that
  runs on every platform, shipped in an npm package whose function returns `{ name, rust: { wasm,
  options } }`. It can have a transform, filters and engines; `crates/ssqch-plugin/README.md`
  and `examples/rust-plugin` show how.
- **The Rust API is gone for good.** The Rust implementation isn't in the repository any more:
  the `sitesquatch`, `sitesquatch-edge` and `sitesquatch-js` crates, the `sitesquatch-plugin-*`
  crates and the `ssqch` crate end at 0.7.x on crates.io, and their source is on the
  `release/0.7` branch. `ssqch-plugin` is the one crate 0.8 publishes. What 0.8 kept of 0.7's
  Rust is built as WebAssembly inside the npm package: the Markdown and highlighter, the minifier
  and Sass (grass), so their output doesn't change.

### Changed

#### The config and a site's JavaScript

- **`import "ssqch"` works from plain Node too.** The npm package's `exports` map names ssqch's
  own modules, which a config, a test or a script can import, where 0.7's package had stubs that
  said to build with ssqch.
- The config can be `ssqch.config.cjs`, `ssqch.config.ts` or `ssqch.config.mts`, besides `.js`
  and `.mjs`.
- A warning a package raises with `process.emitWarning` is one of the build's warnings (`code:
  "console"` in the JSON report), like `console.warn`.
- A stack frame in an error or a warning has the column Node gives: `throw new Error("...")` is
  at `new`, where 0.7 (on QuickJS) pointed at `Error`.

#### Data

- A YAML integer too big for 128 bits (`123456789012345678901234567890`) is a rounded number,
  where 0.7 refused the file. TOML's integers past 2^53 are rounded numbers, as in 0.7.
- A leap second in a page's `date` (`2016-12-31T23:59:60Z`, which TOML can write) is the
  second before it, since a JavaScript date has no 60th second; 0.7 kept it. In any other key a
  TOML date is its text, as 0.7 wrote it, the 60th second included.

#### Templates

- Liquid, Handlebars, Mustache and EJS templates render with liquidjs 10.30, handlebars.js 4.7 (for
  Mustache too, as 0.7 did with its Rust port) and ejs 3.1.10, and their output is 0.7's apart from
  what's under Breaking (the Liquid, Handlebars and EJS starters build to the same bytes). Each
  function a template calls runs once a page, an async one included. Their errors say `file:line` as
  the other engines' do, and the JSON report has the `line` (0.7's Liquid parse errors drew an
  excerpt with a line of their own, its Handlebars errors said `line 2, column 1:`, and its other
  Liquid errors named only the file); an unknown helper or filter gets the closest name ("did you
  mean"), and an error in an include or partial names that file. A function's error starts with its
  name (`boom(): ...`), as in the other languages. `strict` refuses what 0.7 refused: in Liquid a
  missing variable anywhere but `{% if %}` and `{% unless %}` asking whether it's there, and in
  Handlebars a missing argument to `each`, `with`, `lookup` and the comparisons. A Handlebars
  partial named without its extension (`{{> nav}}`) is the Handlebars file when there's one, where
  0.7 took whichever file of that name the folder listed last. What 0.7 refused or got wrong that
  works now: an EJS function's promise that's printed (`<%= later(x) %>`) is awaited where 0.7
  printed `[object Promise]`, and an EJS template can `await`; Liquid's `{% render %}` partials
  print nothing for an unknown variable, where 0.7 failed; Liquid's `date` reads ISO 8601 text
  (`2024-03-04`), Jekyll's `date_to_xmlschema`, `date_to_rfc822`, `date_to_string` and
  `date_to_long_string` are there, and so are liquidjs' other filters and tags (`where_exp`, `sum`,
  `{% liquid %}`, `{% echo %}`); a Mustache-style section in a `.hbs` file (`{{#items}}`) works,
  where 0.7 said "Helper not found"; and `--verbose`'s list of templates nothing used covers Liquid,
  Handlebars and Mustache too.
- Nunjucks' own syntax and filters work in `.jinja` files too (`{% elseif %}`, `===`,
  `{ title: x }`, `forceescape`, `nl2br`, `urlize`, `wordcount`, `center`, `random`), and
  `{% for key, value in object %}` works there. A Jinja or Nunjucks error in an include points
  at the include's own line, where 0.7 pointed at the `{% include %}` in the page.
- Tags from the config's functions (`{% image "/a.png", "A pine" %}`, and paired with `{% endimage
  %}`) work in `.jinja` files too, where 0.7 had them in `.njk` only.
- Edge has what edge.js has: destructuring in `@let`, block-bodied arrow functions, regular
  expressions, the `in` operator, `@eval`, `@inject`, `@stack` and `@pushTo`, and edge.js's
  helpers (`excerpt`, `html.attrs`, and `nl2br`, which gives HTML to print as it is, so escape
  what it's given: `{{{ nl2br(html.escape(text)) }}}`). `await` waits for a promise. A number's
  `toString(16)` uses its radix, which 0.7 ignored; `new Date(2024, 0, 5, 9)` keeps its hours
  (in UTC), where 0.7 dropped everything after the day; and a date's `toLocaleString()` and
  `toLocaleTimeString()`, which 0.7 didn't have, are `Intl`'s, in UTC unless they're given a
  `timeZone`. A function that isn't there says which one was probably meant (``index.edge:2:
  `uper` is not a function (did you mean `upper`?)``), or ssqch's name for another generator's
  (`slug`).

#### Images

- **Images are encoded by sharp** (libvips, with libaom for AVIF, libwebp and mozjpeg), where 0.7
  had encoders of its own, so an image file's bytes aren't 0.7's. The rest is: the markup, the
  files' names, widths and heights, and the cache. At the defaults, which are 0.7's converted
  (Breaking has the table), the files are smaller and quicker to make: AVIF about a quarter
  smaller at effort 2 (11 to 19% at effort 3, 0.7's speed 4) in well under half the time, WebP 1%
  smaller, and JPEG a tenth smaller at 0.7's quality 80. PNG files are compressed at zlib's level
  6, as 0.7's were, without its row-by-row filters (sharp's default): 18% smaller in all on the
  blog's PNGs, and a tenth less CPU time for a cold build, though a few photos from an iPhone are
  up to a fifth bigger. They stay grey or 16 bits when the source is. A JPEG of a transparent
  image keeps the colour under the transparency, as 0.7's did. A site's image cache from 0.7 is
  used as it is, since the names are the same, so the output has 0.7's files next to sharp's
  until the cache goes: delete `.cache/ssqch/img` to encode every file again. AVIF is always
  there, where 0.7 needed its `avif` feature.
- Images are encoded as many at once as there are cores (`os.availableParallelism()`), on libuv's
  thread pool, which the `ssqch` command sizes to the cores plus 4 so page writes keep threads.
  Each file is encoded on one thread, since libaom's AVIF bytes change with the threads it's
  given, so a file comes out the same on every machine, whatever its cores or
  `UV_THREADPOOL_SIZE`.
- `[ssqch] Encoded ...` lines come as each image's files are done, while pages go on rendering,
  so they're among the `Writing` lines, not before the page that shows the image. The build waits
  for every file before the link checker, the other plugins' files, `afterBuild` hooks and the
  summary, and the `Time` line counts the wait under `write`, as 0.7 did.
- A warning about an image that can't be read gives the decoder's reason once, where 0.7 repeated
  it (`reading <file>: Format error decoding Png: Invalid PNG signature.`, without 0.7's second
  `: Invalid PNG signature.`).

#### Builds

- **A glob matches a path by its characters.** `?` is one character and a class's members are
  characters, so `?.jpg` matches `é.jpg` and `[é]` matches `é`; 0.7 matched UTF-8 bytes, where
  neither did. That's every glob: `diff --only`, schemas' `files`, the config's `ignore` and
  `passthrough`, the sitemap's `exclude`, and `files()`. Ignoring case is still for ASCII letters
  only.
- `--output ../public`, an output folder outside the project given from it, builds there. 0.7
  refused it with `permalink Some("/src/") points outside the output directory`, by mistake: its
  check for a permalink that leaves the output folder counted the folder's own `..` (an absolute
  path, `--output /srv/www`, worked).
- **Highlighted code is kept between builds** in `.cache/ssqch/highlight/fences.json`, so a new
  process (`ssqch build`, the first build of `ssqch serve`) takes each fence's HTML from there
  instead of loading syntect's grammars: the blog's build takes 0.64 s instead of 1.0 s. 0.7 kept
  fences in memory only, for the rebuilds of `ssqch serve`, as 0.8 still does. A fence is kept by
  its language, code, marked lines and the site's `languages`, under the highlighter's version (a
  hash of what it's built from), and not when a site's own function highlights it. The file has
  the fences the last build used, is written only when they change, and is ignored and written
  again when it's damaged or another version's. Pages come out the same, byte for byte, with or
  without it.

#### Messages

- Messages that quote a parser are that parser's: YAML, JSON and TOML errors keep `at line N
  column M` (which the JSON report's `line` comes from), with js-yaml's, Node's and smol-toml's
  words before it. The error for a permalink outside the output folder names the permalink
  (`"/../up.html"`, where 0.7 printed `Some("/../up.html")`), and the warning for a data file
  nothing can read says to provide it in the config's `data` (0.7 named the Rust API). A TOML
  date that can't be (`2023-02-30`) says what 0.7 said (`invalid date, expected day between 01
  and 28`), and a number past what 0.7 held says `integer number overflowed` (0.7: `u64 value
  was too large`) or `floating-point number overflowed`. An error in `sitesquatch.toml` names
  the file as 0.7 did (`./sitesquatch.toml`), with its line and the excerpt under the message,
  and says what a key must be (`input must be a string`) where 0.7 quoted its TOML library
  (`invalid type: integer 3, expected path string`). An error from the file system keeps 0.7's
  words for what was being done and has Node's for what went wrong: `creating f: EEXIST: file
  already exists, mkdir 'f'`, where 0.7 said `creating f: File exists (os error 17)` (in `init`,
  `types`, `new`, and the `footprint` and `diff` walks).

#### The dev server

- `ssqch serve` builds in a process of its own, which it starts again when the config changes
  (or a module it imports, a JavaScript data file, or a module that imports). Everything the
  site's JavaScript loaded is read again: ES modules, CommonJS ones and what they `require`, JSON,
  and whatever a module kept in memory. Packages in `node_modules` start over with it, though a
  change to one of their files still isn't watched. The commands, the messages and the ready
  file are 0.7's, and so is the reload script the browser gets.
  - A site whose code ends the process (`process.exit()`, or an error nothing catches in a
    timer) fails that build, shown in the browser like any other, with what was thrown. Another
    process loads the configuration at once, so the server goes on building with the last one
    that loaded, as 0.7 did, unless the config's files changed in that moment: then nothing
    builds until one loads, and the config's error says so. An error thrown after a build has
    reported fails the next build, with that error, as in 0.7 (where timers ran during the next
    build). The server stays up, and Ctrl-C in the middle of a build says nothing about it.
  - A folder renamed away and back again rebuilds both times, and a config file that's deleted
    and put back (or made while the defaults build) is read again. 0.7 missed both.
  - A rebuild compares each page with what the last build found in its file, from memory, and
    reads the file again only when its size, its modification time or its change time is
    different, or it's another file. So a page that something else rewrote is written again
    even when that kept the modification time (`cp -p`, `rsync -a`, `touch -r`), as in 0.7,
    which read every page.
  - On Linux, the server watches each folder itself and leaves out the ones named `.cache`,
    `.git` and `node_modules` (0.7 watched them and ignored what they reported), so a site whose
    input folder is the project root doesn't spend a watch on every folder of its packages.
    When the system has no watches left (`fs.inotify.max_user_watches`), a warning names the
    first folder that wasn't watched, and the server goes on.

#### The importer

- `ssqch import eleventy` and `ssqch import zola` do what 0.7's did, word for word. Two things
  follow from the rest of 0.8: a draft config isn't written where one of the new config names is
  already there, and a date in a Zola site's `[extra]` (`founded = 2019-05-01`) goes into the
  draft as its text, `"2019-05-01"`, where 0.7 wrote an object with a `$__toml_private_datetime`
  key that no template could print. Three things are fixed. `package.json` is edited where it
  changes and kept as it's written everywhere else, where 0.7 printed the whole file again (a
  list on several lines, `1e5` as `100000.0`, escapes written out, the dev dependencies sorted).
  A template literal with `${...}` in it (`` addPassthroughCopy(`${dir}/img`) ``) and a filter
  whose default value reads the config (`(value, format = dateFormat) => ...`) are left for a
  person to port, where 0.7 put them in the draft as they were, a path and a name that don't
  exist and a function that needs a variable the draft doesn't have. A Zola `config.toml` that
  isn't TOML shows its line and the spot, as 0.7's did, with smol-toml's words for what's wrong.

#### The tools

- `ssqch init --starter docs` writes Install and Deploying pages for 0.8: ssqch as a dev
  dependency from npm or pnpm, run with `npx ssqch`; Netlify running `npx ssqch build` with
  `NODE_VERSION`; and a GitHub Pages workflow with `actions/setup-node`. 0.7's pages showed the
  installer script, `cargo install` and `setup-ssqch`, and its Netlify command fetched
  `latest/download/ssqch-installer.sh`, which 0.8.0's release doesn't have.
- `ssqch capabilities` lists `ssqch.config.cjs`, `.ts` and `.mts` under `configFiles`, and says
  `avif` and `sass` only when this build can do them (sharp writes the AVIF files).
- `ssqch inspect` shows a date that isn't one (`new Date(NaN)` in the config's `data`) as `null`,
  as `JSON.stringify` does; 0.7 showed the first moment of 1970, which no page had.
- `ssqch diff` compares every file when a fingerprinted name is another file's name without its
  last fingerprint (`x.11111111.22222222.css` beside `x.11111111.css` and `x.css`). 0.7 lost one
  of the two from the report.
- `ssqch/minify` and `ssqch/sass` are 0.7's minifier and 0.7's Sass compiler (grass 0.13.4),
  built as WebAssembly, so pages and stylesheets come out as 0.7 wrote them. A Sass error's last
  line names the file from the project root (`./styles/blog.scss:1:16`), where 0.7 printed its
  absolute path after `./`; so do the paths in `@warn` and `@debug` lines.
- `base` and the plugins read a page's HTML where 0.7's HTML rewriter (lol_html) read it, except
  where lol_html wasn't the same from one use to the next, and there they read it as browsers
  do: after a tag that ends in `=>` (`<script src=>`), the element's content is text, where some
  of 0.7's plugins read it as markup; and SVG's `<title>`, `<desc>`, `<foreignObject>` and
  `<font>`, and MathML's `<mi>`, `<mo>`, `<mn>`, `<ms>` and `<mtext>`, are seen right after an
  end tag (`<path></path><title id="t">`), where 0.7 skipped them, so the link checker finds an
  `id` there. A `<style>`, `<title>`, `<textarea>` or `<iframe>` inside a `<select>`, or after a
  `<frameset>`, holds text, where 0.7 refused the page ("The parser has encountered a text
  content tag").

## 0.7.1 - 2026-11-18

The last release of the Rust implementation. 0.8 runs on Node: the same sites, commands and
output, built by a TypeScript program with ssqch's own Markdown, highlighter, minifier and Sass
as WebAssembly. Move to it with `npm install --save-dev ssqch` once 0.8.0 is out; its changelog
lists what a site has to change. 0.7.x gets no more releases, and nothing else changed since
0.7.0.

## 0.7.0 - 2026-11-17

Found moving lit.dev from Eleventy.

### Breaking

- A `layout` in `computed` that depends on the page (a function, or a string with template
  tags) is an error: the layout is chosen before `computed` runs, so it was ignored without a
  word, and the page was built without it. Set `layout` in the front matter or a data file. A
  computed `layout` that's plain text (`computed: { layout: "article" }`) is now applied.

### Changed

- Blank lines after the front matter's closing `---` stay in the page's body, as gray-matter
  (and so Eleventy) keeps them; only the fence's own line ending goes. A JSON or text page
  written from a template that starts with a blank line used to lose it. Markdown renders the
  same; an HTML page keeps the blank lines at its top.
- Passthrough copies of a folder follow links (symlinks) and copy the files they point at,
  as globs already did. A link was skipped without a word (lit.dev lost 360 sample files),
  and a link to nothing is now an error that names it.
- `process.versions.node` is `24.0.0` (and `process.version` is `v24.0.0`), the Node version
  the shims follow. Packages that check it when they load, fast-glob among them, crashed.
- `node:fs` has the callback versions of its functions (`fs.readdir(dir, options, callback)`,
  `fs.stat`, `fs.readFile`, `fs.exists`, ...), which older packages and fast-glob's async API
  use; `readlinkSync` and `symlinkSync`; and `createReadStream`, `createWriteStream`,
  `ReadStream`, `WriteStream` and `watch`, which throw when called, so packages that import
  them by name (node-fetch 3, and with it Lit's server rendering) load.
- `import(pathToFileURL(file).href)` works: `import` and `require` take `file:` URLs, as in
  Node.
- `ssqch import eleventy` doesn't read settings or calls from comments (a commented-out
  `markdownTemplateEngine: 'njk'` set the wrong engine); lists `addNunjucksAsyncShortcode`,
  the paired Nunjucks and Liquid shortcodes, `addNunjucksTag`, `addLiquidTag`,
  `addNunjucksGlobal` and `addMarkdownHighlighter`; says when a shortcode's name comes from a
  variable instead of listing the variable as a shortcode; says when a plugin is one ssqch
  doesn't know (the site's own), instead of pointing at a package list it isn't in; rewrites
  `eleventy` in wireit's `command`s; and leaves `eleventyNavigation` front matter alone when
  templates call the `eleventyNavigation` filter, which reads it (renaming it emptied
  lit.dev's navigation), with how to keep that filter.
- The warning for `eleventyNavigation` front matter says that templates and filters that
  read it still can, instead of "it isn't in the navigation".

### Fixed

- `## Install {#setup}` in Markdown no longer starts a Jinja comment: Markdown runs through
  Jinja (or Nunjucks) first by default, and `{#` opened a comment that swallowed the page up
  to the next `#}`. `{#...}` at the end of a line, closed by `}`, is left for the Markdown
  heading attributes ssqch documents.
- `layout: ""` means no layout, as `false` and `null` do (and as in Eleventy). It was an
  error, `layout `` not found`.
- A layout file named only `.html` no longer panics ssqch.
- The Nunjucks and Jinja rewriter no longer panics on a character like `’` or `—` inside a
  tag.

## 0.6.5 - 2026-11-17

### Changed

- The config `ssqch import eleventy` drafts leaves out `// Port each filter and shortcode here`
  when it ported every filter and shortcode, and puts it after the ported ones when some are
  left (the list at the end names them).
- Commands in `beforeBuild`, `afterBuild` and `serve.run` find the tools a site installed: each
  `node_modules/.bin` from the project's folder up goes in front of their `PATH`, as npm, pnpm
  and yarn do for scripts. `{ run: "postcss ..." }` used to work under `npm run build` and fail
  with `postcss: not found` under `ssqch build` (found moving the ReverentGeek blog and v8.dev).
- A page's `render` replaces its folder's instead of joining it: `render: [njk]` over a
  folder's `render: [mdit]` is `njk`, not `mdit, njk`. `render` is an engine chain, so the list
  form now behaves like the string form. `tags` and other lists still join. A site that relied
  on the joined chain lists every engine in the page's `render`.
- `{{ title | slug }}`, Eleventy's filter, is refused with what differs: ssqch's `slugify` turns
  `.` into `-` (`Node.js` is `node-js`, Eleventy's `slug` gives `node.js`), and how to keep the
  old URLs with the `slugify` package. It used to suggest `sum`.

### Fixed

- An apostrophe in a Nunjucks or Jinja comment (`{# we don't #}`) no longer turns off
  ssqch's rewrites for the rest of the file. Below it, `.length` printed nothing, `===` and
  `!==` were syntax errors, and `{% for k, v in obj %}` and config tags weren't rewritten.
  Found moving a11yproject.com, where it removed the table of contents from 35 pages.
- A quoted word in a page's text that names an include (`The "footer" of your page`) no
  longer moves the page to the second render pass when that include reads `collections`.
  Before, that left the page's `templateContent` empty in a feed or any other page that showed
  it. Only names inside template code count now.
- `ssqch import eleventy` leaves script names alone in `package.json`: `npm run eleventy-watch`,
  `npm run eleventy` and `run-s clean build:eleventy` stay as they are (the scripts they name
  keep their names). It turned them into `npm run ssqch build` and the like, which pointed at
  scripts that didn't exist. Only the `eleventy` command itself becomes `ssqch build`.
- Nunjucks escapes `\` as `&#92;`, as Nunjucks does (`.njk` only; Jinja leaves it), so feeds and
  pages with a backslash in escaped text match Eleventy's.
- The link checker matches a `#fragment` as written before decoding it, as browsers do, so
  `#tl%3Bdr` reaches markdown-it-anchor's `id="tl%3Bdr"`. It reported every such link as
  broken (150 on v8.dev).

## 0.6.4 - 2026-11-17

### Added

- `files()` gives each file a `dateFrom`, `"name"` or `"modified"`, so a data file can tell a
  photo's date from its name from a modification time, which only says when the file was copied.
- `slugify(title, { apostrophes: "separate" })` splits words at an apostrophe
  (`drew-s-brownies`) instead of dropping it (`drews-brownies`, still the default), for a site
  whose URLs were made that way. `slugger()` takes it too.

### Changed

- `files(pattern, { dimensions: true })` keeps image sizes in `.cache/ssqch/image-sizes.json` by
  path, size and modification time, so a build reads only new and changed images, and reads
  them on several threads. 1,043 photos: 5 ms with the cache, from about 18 ms (warm) or 110 ms
  (cold) before.
- `ssqch import eleventy` puts ssqch in `devDependencies`, pinned exactly, as the README says,
  instead of where `@11ty/eleventy` was (an emptied `dependencies` goes). For a pnpm 11 site
  without ssqch in `minimumReleaseAgeExclude`, it lists the five names to add.
- The draft config follows the Eleventy config's trailing commas (none if it has none) and
  quotes only the keys that need them (`{ images: "images" }`), unless the config quotes every
  key. Gahlee House's draft passes its own ESLint config apart from `n/no-unpublished-import`,
  which the README covers.
- The README's Install section recommends excluding the five packages from pnpm's release age
  by name, and says how to upgrade when they're excluded by version: add the new version's
  lines beside the old ones, install, then remove the old ones. Swapping them locks every
  install out (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`) while the old version is under a day
  old.

## 0.6.3 - 2026-11-17

### Added

- `files(pattern, { dimensions })` from `ssqch` lists the files a glob matches, for data files:
  `{ path, url, name, stem, ext, date, size }` for each, sorted by path, with `width` and
  `height` from the image's header when `dimensions` is on. The glob ignores case (`*.jpg` finds
  `.JPG`), `date` comes from the start of the name (`20011222_08.JPG`, `2001-12-22-camp.jpg`) or
  the modification time, and `url` is from the input folder for a file inside it. It replaces
  `readdirSync`, an extension filter and a date parser in a data file.
- `slugify` takes a separator: `slugify(title, { separator: "_" })` (or `slugify(title, "_")`,
  `{{ title | slugify: "_" }}` in Liquid) is `taco_bake`. Another option is an error. Data files
  can import `slugify` from `ssqch`, and `slugger()`, a `slugify` that counts, so two albums
  called "Misc Pictures" get `misc-pictures` and `misc-pictures-1` in the data, and a paginated
  page's permalink and the links to it agree.
- `ssqch diff` notes a page whose changes are all dates or years (`only dates changed (2025 ->
  2026)`), says how many changed files differ only that way, and has `onlyDates` in the JSON. A
  page with no date of its own gets its file's modification time, which another generator or a
  fresh checkout sets differently; `ssqch docs "dates that changed"` explains.
- `ssqch import eleventy` carries more over:
  - `addPassthroughCopy({ "images": "images" })` with keys and values written out becomes a
    `passthrough` entry; only variables and computed values are left to a person.
  - Filters and shortcodes whose function uses only its own arguments are copied into the
    draft's `filters` as written, instead of being listed.
  - `package.json`: `@11ty/eleventy` becomes `ssqch`, and scripts that run `eleventy` run
    `ssqch build` (`eleventy --serve` is `ssqch serve`; `--port`, `--quiet`, `--output` and
    `--pathprefix` carry over, and other flags are listed). A lockfile from another package
    manager than the one `packageManager` names is listed to delete, and the site's own to
    update.
  - The draft config is written in the Eleventy config's style: its indentation (tabs, or its
    number of spaces) and spaces inside brackets.
- The README's Install section says how to install a release on the day it comes out with
  pnpm 11 and later, which wait a day: list `ssqch` and the four `@ssqch/*` platform packages
  under `minimumReleaseAgeExclude`.
- The `islands` example has a trail cam page: photos listed from a folder with `files()`, in a
  `<photo-gallery>` element, a lightbox with previous and next, the arrow keys, Escape and
  captions.

### Fixed

- `.length` printed nothing in Nunjucks and Jinja templates (`{{ albums.length }}`), with no
  warning. It counts a list's items or a string's characters now, like `| length`, in `.njk`
  and `.jinja` files; `loop.length` and an object's own `length` key keep their meaning.
- A UTF-8 byte-order mark at the start of a file stopped the build (`invalid JSON in
  src/_data/tblPhoto.json: expected value at line 1 column 1`, from SQL Server's JSON exports).
  It's skipped in JSON, YAML and TOML data files, `readData()`, JavaScript and JSON modules,
  and pages and layouts, where it hid the front matter.
- The config `ssqch import eleventy` drafts said `Eleventy's defaults: Markdown and HTML run
  through Liquid first.` above engines that came from the site's own config. It says where
  they came from.

- `ssqch serve` with `serve.run` tools updates the browser once where it used to update it
  twice. The first build waits for the tools' first compile (up to 2 seconds), so its pages link
  the tools' files instead of a production build's fingerprinted ones, and the first page served
  has its CSS. After a rebuild, the browser's update waits until the tools have stopped writing
  (150 ms of quiet), so a template edit that adds Tailwind classes is one reload with the new
  CSS. A tab left open from an earlier `ssqch serve` reloads once, after the new server's first
  build.
- `ssqch serve` says `swapping it in` for a stylesheet another tool wrote, instead of
  `reloading`: the page swaps it without a reload.

## 0.6.2 - 2026-11-16

### Changed

- `ssqch docs` answers a search with the paragraph whose bold label has every word of it
  (`ssqch docs "your own languages"`), and `ssqch docs languages` with the paragraph on adding
  highlighting languages, not only the options table's row.
- The Eleventy, Docusaurus and component-framework trailheads say where a custom highlighting
  language goes (`markdown: { highlight: { languages } }`).
- TOML front matter and `site.toml` are read as TOML 1.1, so an inline table can span lines and
  end with a comma (`snack = { name = "Pine Cone Crunch", count = 3, }`). Everything that read
  before still reads the same.
- Updated dependencies: toml 1, similar 3, sha1, sha2 and md-5 0.11, and ravif 0.13. The blog's
  pages, feed and AVIF images build byte-for-byte the same as with 0.6.1.

## 0.6.1 - 2026-11-15

### Added

- Sites can add highlighting for a language ssqch doesn't have, or replace a built-in one, with
  `markdown: { highlight: { languages } }`. A language is a function, `(code, lang) => tokens`
  (`[text, kind]` pairs or `{ text, kind }` objects, where `kind` is an `hl-*` name like
  `keyword`), another language's name (`cho: "chordpro"`), or a `.sublime-syntax` grammar file.
  A site's languages come before the built-in ones, keep line marking (`{1,4-6}`) and the
  `hl-*` classes, and apply to fences, `highlight(code, lang)` and the fence hook's
  `highlighted`. A highlighter that throws, returns an unknown kind or tokens that aren't the
  code gets a warning naming the page, and that fence is plain text.
- ChordPro is highlighted (`chordpro` and `cho` fences): directive names as keywords, their
  values as strings (comments for `{comment: ...}`), `[G7]` chords anywhere in a lyric line, and
  `#` comment lines. Lyrics stay plain.

### Fixed

- `ssqch serve` kept serving with the last good configuration after a changed one failed to
  load, but without its image processor, so the next rebuild failed in `feedHtml()` and
  `imageUrl()` ("the image processor isn't set up"). The processor is put back too.

## 0.6.0 - 2026-11-14

### Breaking

- The link checker (`linksPlugin()`) reads every URL the build writes on the site, not only
  HTML attributes: `.xml` output (feeds and the sitemap, including the escaped HTML of a feed
  entry's content), `<meta>` values that are URLs (`og:image`, `og:url`, `twitter:image`),
  strings in JSON-LD blocks, `imagesrcset`, and absolute links on the site's own address (the
  new `url` option, or the address `sitemap.xml` uses). A production build that passed before
  can fail on a link it never looked at. Fix the link, or skip its path with `ignore`.
- Generated images are encoded into `.cache/ssqch/img/` and linked (or copied) into the
  output's `img/` folder on each build, so deleting the output folder no longer means encoding
  every image again. Cache `.cache/ssqch` between deploys instead of `<output>/img` (on Netlify,
  `paths = [".cache/ssqch"]` for `netlify-plugin-cache`). Nothing is encoded again on the way:
  a build takes in the files already in `<output>/img` (from before, or a deploy cache) when
  the cache doesn't have them, so keep caching both for the first deploy. `cacheDir` on
  `imagePlugin()` moves the cache, and `cacheDir: false` keeps the old behaviour.

### Added

- `imageUrl(src, { width, format })`, a template function on every site and an export of
  `ssqch/image`: the URL, size and type of one generated copy of an image, for `og:image`,
  JSON-LD and feeds, where the image plugin's `<picture>` doesn't reach. The default is the
  original's width in the source's own format.
- `feedHtml(html, base, { width, format })` from `ssqch/rss` (and a filter with
  `rssPlugin()`): a post's HTML for a feed, with each local image pointing at one generated
  copy (1200 pixels wide at most by default), page-only attributes removed, and every URL
  absolute.
- `ssqch:preload` on an `<img>` adds a `<link rel="preload" as="image">` for it to `<head>`,
  before the first stylesheet, and loads it eagerly with `fetchpriority="high"`.
- `ssqch serve --built` serves the output folder as the last build left it, the way a host
  would: no build, no watching, nothing added to pages, and gzip for text. `ssqch preview`
  (Vite's and Astro's word) is the same command.
- `assetsPlugin()` rewrites imports in inline module scripts (`import { setup } from
  "/assets/pco.js"`), and a listed file can be a passthrough copy: it's copied into the output
  before it's fingerprinted. Listing one used to fail a clean build.
- The npm package has an `exports` map for `ssqch` and the `ssqch/*` modules, with their types,
  so ESLint's `n/no-missing-import` and TypeScript resolve them without `ssqch types`. (Running
  one with plain Node says to build with ssqch instead.)
- `BuildContext::passthrough_source`, for a Rust plugin that needs a passthrough file before
  it's copied.

### Fixed

- `image()` with `formats: ["auto"]` returns the files under `auto` too, next to the format it
  became (`png`), so `derivatives.auto[0]` works.

## 0.5.2 - 2026-11-13

### Added

- ssqch is on npm: `npm install --save-dev ssqch` (or `pnpm add -D ssqch`) pins it in a site's
  lockfile, and `npx ssqch build` runs it. The `ssqch` package runs the binary from an optional
  dependency for the platform (`@ssqch/darwin-arm64`, `@ssqch/darwin-x64`, `@ssqch/linux-x64`,
  `@ssqch/win32-x64`), so installing runs no install scripts and downloads nothing from GitHub.
  On Netlify, a site with ssqch in its `devDependencies` gets it from the install step, with no
  installer in the build command. Each release publishes them after the GitHub release, with
  provenance.

## 0.5.1 - 2026-11-13

### Fixed

- `ssqch serve` no longer leaves pages unstyled after another build writes into its output
  folder (a production build cleans it and renames the CSS and JavaScript to fingerprinted
  names, and a `serve.run` watcher only writes again when a source changes). When a stylesheet
  or script it has seen is deleted by something else, the server waits for the output to go
  quiet, starts the `serve.run` tools again, waits for them to write their files, and rebuilds.

## 0.5.0 - 2026-11-12

### Breaking

- Archetypes are blueprints now: `ssqch new` starts a page from a file in `_blueprints/`
  (`_blueprints/posts.md`), and `--archetype` is `--blueprint`. Rename a site's `_archetypes/`
  folder (and a theme's) to `_blueprints/`. The JSON from `ssqch new --format json` has
  `blueprint` in place of `archetype`. Hugo's `--kind` gets a hint naming `--blueprint`.
- Jinja is the default template language of the `ssqch` command, in place of Edge: the
  defaults are `templateFormats: ["jinja", "md", "html"]`, `markdownEngine: "jinja"` and
  `htmlEngine: "jinja"`. A site in Edge that relied on the defaults keeps working by setting
  them: `templateFormats: ["edge", "md", "html"]` (or the list it uses), `markdownEngine:
  "edge"` and `htmlEngine: "edge"` (`template_formats`, `markdown_engine` and `html_engine` in
  `sitesquatch.toml`). A site that lists `"edge"` in `templateFormats` but not the other two
  only needs `markdownEngine: "edge"`, and `htmlEngine: "edge"` if it has `.html` pages or
  layouts. The Rust library's `Config::new` still defaults to Edge, the engine it has without
  plugins, and so does an `ssqch` built without the `jinja` feature.
- `ssqch init` starts a site in Jinja (`src/_includes/layout.jinja`, `src/index.jinja`), and
  `ssqch init --starter docs` writes its layouts, render hook and containers in Jinja. Pass
  `--engine edge` for the starters as they were.
- Page bundles (`bundles: true`) and themes no longer copy a template the site doesn't render: a
  file in a template language that isn't in `templateFormats` (`private.edge` next to
  `index.md`, or in a theme), or a `.md` file, stays out of the output, since its front matter
  could be a draft. A theme's gets the same warning as the site's own. Copy one on purpose with
  `passthrough`.
- Rust library: `MarkdownEngine::render_html` doesn't take the page's path any more, and a
  layout's or hook template's `RenderContext::input_path` is that file, not the page's.

### Added

- `ssqch init` writes an `AGENTS.md` for coding agents (and a one-line `CLAUDE.md`,
  `@AGENTS.md`): what each file in the starter is, how to look a name up (`ssqch docs`), how to
  check a change (`ssqch build --format json`) and how to compare builds. It never replaces one
  that's there. `ssqch docs agents` prints it for a site that already exists.
- `ssqch docs`: the documentation of the installed version, from the binary, with no network
  or README on disk. Alone, it lists every command, config option, template function and module
  export with one line each. `ssqch docs base` (or `imagePlugin`, `toc`, `serve`, `--starter`)
  prints what the README says about it, `ssqch docs "content schemas"` prints a section, and
  other words search the text. Another generator's word says ssqch's: `ssqch docs pathPrefix`.
  `ssqch docs --from eleventy` (or `hugo`, `jekyll`, `zola`, ...) lists that generator's words
  with ssqch's for each, then its trailhead. `--format json` is for scripts and agents.
- `ssqch init --starter docs` takes `--engine` too: `jinja` (the default), `njk`, `edge`,
  `liquid`, `hbs` or `ejs`. Each one builds the same pages. The site starter gains `--engine jinja`,
  and `--engine njk` writes the Jinja templates as `.njk` files.
- A build warns about files in a template language the site has but doesn't list in
  `templateFormats`, which it leaves out, instead of leaving them out without a word:
  `index.edge isn't rendered: templateFormats is jinja, md, html. Add "edge" to render it, or
  list it in ignore.` (diagnostic code `template-formats`).
- `ssqch capabilities` reports the `defaults` (`templateFormats`, `markdownEngine`,
  `htmlEngine`) and the `starterEngines` that `ssqch init --engine` takes.
- EJS templates (`.ejs`): add `"ejs"` to `templateFormats` (and `markdownEngine: "ejs"` for
  Markdown). They run on the JavaScript engine built into ssqch, so no npm install, with
  EJS 3's tags and output, `include()` from `_includes`, and config filters and ssqch's
  functions in scope by name. `ssqch init --engine ejs` starts either starter in EJS, `ssqch import eleventy`
  carries `.ejs` templates over, and
  ` ```ejs ` fences are highlighted.
- `ssqch footprint [dir]`: what a build weighs, by kind of file (pages, images, CSS,
  JavaScript, fonts, ...), and its largest footprints, the heaviest pages and the heaviest other
  files. It reads the site's output folder or any build folder, with `--top N` and
  `--format json`.
- `budgets: { pages: "150 KB", images: "500 KB", total: "300 MB" }` (`[budgets]` in
  `sitesquatch.toml`): after each build, files over their kind's budget are a warning
  (`over-budget`).
- `serve: { run: [...] }` (`[serve] run` in `sitesquatch.toml`): programs `ssqch serve` starts
  with the server and stops with it, such as `npx @tailwindcss/cli ... --watch`. Their output
  is shown with the tool's name in front (`[tailwindcss] Done in 16ms`), they keep running
  across a config reload that doesn't change them, and stopping the server (Ctrl-C, SIGTERM)
  stops them and whatever they started. One that stops early is a warning. Builds don't run
  them. The README has a new "CSS and JavaScript" section, with a Tailwind example.
- When a page `ssqch serve` sends links a stylesheet or script that isn't in the output, a
  note on the page and a warning in the terminal say so (diagnostic code `missing-asset`),
  naming the `serve.run` tool that should have written it, and the warning repeats after each
  build until the file is there.
- Other generators' words that mean the same thing in ssqch work, as aliases, and say ssqch's
  name once (`note: pathPrefix works; ssqch calls it base (ssqch docs base)`; `--quiet` hides
  it, and a JSON report lists them in `aliases`, not `warnings`): the commands `dev`, `start`,
  `server`, `watch` and `generate`; the flags `--watch` and `--serve` (they serve), `-d`,
  `--destination` and `--pathprefix`; the config options `pathPrefix`, `dir`, `publishDir`,
  `outDir`, `markdownTemplateEngine` and `htmlTemplateEngine`; the front-matter keys
  `eleventyComputed`, `eleventyExcludeFromCollections`, `redirect_from` and
  `templateEngineOverride` (which used to be an error); and the filters `url`, `relative_url`
  and `markdownify` in Jinja, Nunjucks and Liquid. A front-matter alias takes ssqch's key's
  place in the cascade (a page's `computed` is above its folder's `eleventyComputed`), and a
  schema with `unknown: "error"` reads it as that key. Setting an alias and ssqch's name
  together, in one file, is an error. `ssqch docs --from <generator>` marks the ones that work.
- A `slugify` filter in every template language: `{{ "Pine Cone Crunch!" | slugify }}` is
  `pine-cone-crunch`. In Liquid it replaces Jekyll's, which turned an apostrophe into a dash.
- The other words from other generators get ssqch's name for them: a command (`ssqch check`),
  flag (`--drafts`), config option (`baseURL`, `config.addPassthroughCopy()`), filter
  (`absolute_url`, `jsonify`) or front-matter key (`eleventyNavigation`, `published: false`)
  is refused or warned about as before, now with ssqch's name for it and where to read more
  (`More: ssqch docs base`), and a `hint` in the JSON report. Every unknown config option is reported in one run. A folder with
  another generator's config and none of ssqch's gets a warning (`other-generator`) naming
  `ssqch import` (for Eleventy and Zola) and `ssqch docs --from <generator>`.
  Front-matter keys are warnings (`foreign-key`); they used to be ignored without a word. So are
  templates that read `eleventy.*` or Jekyll's `site.posts` (`foreign-global`), which print
  nothing or an empty list.
- Liquid's unknown-filter error names the filter (``unknown filter `upcse` (did you mean
  `upcase`?)``) instead of listing every filter there is.
- `image()` and `minify()` say which option or image format was probably meant
  (``unknown option "removeComment" (did you mean "removeComments"?)``).
- `console.warn` in a config or data file is one of the JSON report's `warnings` (code
  `console`) in `ssqch build --format json`.
- `--verbose`'s `Uninhabited` line covers Jinja, Nunjucks and EJS includes as well as Edge's,
  and says `templates` instead of `Edge templates`.
- Jinja and Nunjucks errors say which name was probably meant: a template that isn't there
  (`include`, `extends`, `import`) suggests a file in the includes folders (``can't include
  `partials/navv.jinja` (did you mean `partials/nav.jinja`?)``), and an unknown filter, test
  or function suggests one that exists, the config's own included. The name is quoted, so the
  lines under the error get carets under it.

### Fixed

- A page bundle copied a template in a language the site doesn't render as it was, front
  matter and all, so a draft beside a page was published (see Breaking).
- A file name that isn't ASCII (`森林步道.md`) crashed the build while looking for a date in it.
- EJS: a variable used only after `...` (`[...animals]`) wasn't defined; EJS tags in
  `permalink` and `computed` strings weren't rendered (`permalink: /<%= title %>/`); and a
  relative include (`./card.ejs`) in a theme's page or in a layout looked in the input folder
  instead of beside the file.
- `sassPlugin`: editing a partial beside a Sass file outside the input folder, or in a
  `loadPaths` folder, didn't rebuild the CSS while serving.
- `ssqch new --set draft=true` from a TOML blueprint with a table (`[extra]`) put the key in
  the table, so the page wasn't a draft. Keys go above the first table now, a key of the same
  name in a table stays the table's, and a value over several lines is replaced whole.
- `ssqch inspect /myindex.html` could show the page at `/my/`: `index.html` only ends a URL
  when it's a whole part of it, and the exact URL wins.
- `ssqch diff` called pages the same when whitespace that shows had changed: in an attribute's
  value (`title="pine  cone"`), or a blank line or indent in `<pre>`, `<textarea>`, `<script>`
  or `<style>`.
- A template error's message gives the file's own line (`posts/pine.md:8:`), as the lines
  printed under it and the JSON report's `line` already did. Template engines count from the
  end of the front matter, so it used to say `posts/pine.md:3:` for the same line.
- `ssqch.d.ts` declares `process` (`env`, `cwd()`, `platform`), so a config that reads
  `process.env` type-checks without `@types/node` (and still does with it). The docs starter's
  `docs.js` type-checks too.
- `ssqch serve` could leave a page unstyled after a CSS change until it was reloaded by hand.
  Swapping a stylesheet dropped the old one before the new one loaded, so a request that got
  an empty or half-written file (PostCSS empties the file before it writes it) left the page
  without CSS. Now the old stylesheet stays until the new one has loaded with rules, and one
  that doesn't load or is empty is tried again. The server also waits for a stylesheet or
  script another tool is writing to stop changing before telling browsers, and no longer
  misses one written while a build was running.
- `--quiet` quiets `ssqch init` (it listed the files and said camp is set up) and `ssqch serve`
  (it said `Squatch Watch is on.` and `Fresh tracks in ...` for every change): `serve --quiet`
  prints the address once, and then only warnings and errors.
- The error overlay in `ssqch serve` has a "Copy diagnostic" button (it says "Copied"), and
  Escape hides it like "Hide" does. It takes the keyboard focus when it opens, so Tab reaches
  its buttons, and gives it back when it goes.
- The docs starter has a "Skip to content" link, the first thing Tab reaches on each page, in
  every engine.

### Changed

- `ssqch serve` says where first: `Serving dist at http://localhost:8080/. Squatch Watch is
  on.` A script that waits for the line can match `Serving ` again, as it could before 0.4 (the
  ready file, `--ready-file`, is still the way to wait).
- A build's report has one themed line at most, the one that matters most: nothing to build, a
  first build (`First confirmed siting.`), files removed (`left no trace`), drafts
  (`unconfirmed`), then unused templates (`Uninhabited:`). The others say it plainly
  (`Drafts  3 left out`, `Unused: 2 templates ...`).
- The migration guides are trailheads, in `docs/trailheads/` ("Trailhead: moving from
  Eleventy"), and `ssqch docs --from <generator>` prints them. `ssqch import` points at
  `ssqch docs --from` instead of a file in the repository. The README's getting-started
  section is "Field guide: build your first site", and `ssqch capabilities` says "What's in
  the pack".
- The starters and examples have forest creatures in them: Owl's field guide, Beaver's build
  notes and Deer's shortcut in the docs starter, Raccoon's cache in the site starter's second
  post, and Owl, Beaver, Raccoon and Squirrel in the examples.
- While serving, the first build that works after one that failed says so: `Build recovered.
  Back on the trail. Built in ...`. It's the build's one themed line.
- `ssqch new` says which blueprint it used, or `the built-in blueprint` when the folder has
  none, and ends with `Field notes started.` (left out with `--quiet`). A page that's already
  there is refused as before: `src/posts/cedar.md already exists. Those tracks are taken;
  choose another file name (the file is left as it is)`.
- `ssqch docs` with words that find nothing suggests a next step when one of them leads
  somewhere: a generator's trailhead (`Try ssqch docs --from eleventy`), or a word that's a
  name or another generator's word (`Try ssqch docs base`). The JSON has it as `tryInstead`.
- `ssqch diff` ends a report that found differences with `Changes found: 3 pages and 1 other
  file (2 changed, 1 added, 1 removed); ... The stump has moved.`, to go with `The stump has
  not moved.`
- The site starter has two more field notes: *Raiders of the Lost Path* (the link checker, an
  old map and a renamed heading) and *The Cache of the Wild* (a data file that fetches with
  `cache`, and `--offline`).
- The examples are in the Ranger Station '76 palette, light and dark, like the starters.
- The `versioned-docs` and `islands` examples are written in Jinja. `component-docs` stays in
  Edge for its components with slots, and sets `markdownEngine: "edge"`.

## 0.4.0 - 2026-11-10

### Breaking

- Markdown turns on GitHub's extensions by default: heading `id`s, `{#id}` heading attributes,
  footnotes, task lists, bare URLs as links, `> [!NOTE]` alerts, and `:::` containers. Most
  sites only gain `id`s on their headings. A site that adds heading `id`s itself (in a transform,
  say) should drop that code or set `markdown: { headingIds: false }`, and one that writes `:::`
  or `[^1]` as plain text can turn `containers` or `footnotes` off the same way.
- `.html` and `.md` layouts run through `htmlEngine` and `markdownEngine` first, as pages do:
  a `.html` layout is now an Edge template by default. A site with `.html` layouts that hold
  literal `{{ }}` can set `htmlEngine: false` or rename them.
- A page without a `date` takes the date at the start of its file name (`2024-06-01-post.md`)
  before the file's modification time.
- A permalink ending in `/index.html` (`/about/index.html`) gives the page the URL `/about/`.
  It still writes the same file.
- A permalink or `computed` string with `{{ }}` (or `{% %}`) renders in the page's own template
  language instead of always in Edge: a `.liquid` page's permalink is Liquid, and a Markdown page's
  uses `markdownEngine`. Pages in Edge, and Markdown with the default `markdownEngine`, are
  unchanged. A Liquid, Nunjucks or Handlebars page whose permalink uses Edge syntax needs it
  rewritten in its own language.

- The `url()` filter that `rssPlugin()` added is gone. It returned its argument, so use the
  path itself (`absoluteUrl(post.url, site.url)`), or `withBase()` with the new `base` setting.
- The text `ssqch` prints has changed in places (below, "The Sasquatch voice"). A script that
  reads it should use `ssqch build --format json` or `ssqch serve --ready-file`, which haven't.
  What it would have matched: `Serving dist at ...` now starts with `Squatch Watch is on.`,
  `Changed: <file>` is `Fresh tracks in <file>`, `<n> broken links:` is `the trail goes cold on
  <n> broken links:`, and a site's first build prints `First confirmed siting.` before `Built
  in`.
- Rust API: `Config::clean` is `Config::leave_no_trace`, and `BuildReport` has new fields
  (`drafts`, `first_build`, `pages_changed`, `pages_new`, `pages_gone`, `unused`), so build one
  with `..Default::default()`. Config files don't have to change: `clean` still works there.
- Errors are red only on a terminal now. A script that matched the colour codes around
  `error:` in piped output should match the plain word.

### Added

- **The Sasquatch voice.** ssqch reports like a deadpan park ranger: what happened comes first,
  and now and then something large walks through the log. The rules are in `CLAUDE.md`: a
  themed line still names the file and what went wrong, JSON output and diagnostic codes stay
  plain, nothing is random, and a build never adds anything of its own to a site's output.
  - `leaveNoTrace: true` is the new name for `clean` (`leave_no_trace` in `sitesquatch.toml`):
    it removes only what earlier builds wrote, and leaves other tools' files alone. `clean`
    stays as another name for it; setting both is an error.
  - `ssqch serve` is Squatch Watch, and says `Fresh tracks in <file>` when a source changes.
  - A layout that leads back to itself names the loop instead of `layout chain is too deep`:
    `in index.md: we've passed this tree before. Layout loop: base.edge -> wrap.edge ->
    base.edge`. So do Edge includes and components (`Include loop: a -> b -> a`), which used
    to print `included from` 64 times.
  - A layout that isn't there says which one you probably meant: ``layout `bse` not found: no
    sightings in src/_includes (did you mean `base`?)``.
  - `ssqch serve` answers a URL that isn't there, in a site with no `404.html`, with a page of
    its own: where the trail went cold, the closest URL in the site, and a way back to the
    trailhead. It's never written to the output.
  - A port that's taken: `can't listen on port 8080: something else is squatting on it (--port
    0 picks a free one)`.
  - A production build counts the drafts it left out (`Drafts  3 unconfirmed (built in
    development only)`, and `drafts` in the JSON report), and a build with no pages says why
    (`Nothing sighted: no file in src matches templateFormats (edge, md).`).
  - The starter site is an amateur investigator's field notes: three short posts that each
    show one thing, a 404 page, and a footer that says `Built with SiteSquatch. Allegedly.`
    The docs starter's 404 page has several eyewitness accounts too.
  - `ssqch serve` reloads a browser only when the page it's showing came out different (a
    rebuild leaves identical pages alone, and the summary says how many changed), and swaps a
    changed stylesheet in place, so the page keeps its scroll position and its forms.
  - A build that fails while serving is shown in the browser, over the page, with the error
    and the lines it's about, and in the tab's title and icon. It only went to the terminal
    before, while the browser kept showing the old page. The next good build clears it.
  - The dev server gives a site without a `favicon.ico` a footprint for its tab, where there
    was a 404 on every page load. Each page links it as an SVG icon, since browsers only take an
    ICO or PNG from `/favicon.ico`.
  - "Did you mean" for a broken link (`/about/ -> /contactt/ (not found; did you mean
    /contact/?)`) and a missing `id`, a config key (`"templateFormat" isn't a config option
    (did you mean "templateFormats"?)`, and `output` at the top level says it goes in `dirs`),
    a plugin or Markdown option, and an Edge include that isn't there.
  - A template or schema error is followed by the lines it's about, numbered as the file is
    (a template engine counts from the end of the front matter), with carets under what the
    message names or under the schema field.
  - The `Pages` row says what's different from the last build to that folder: `(2 new, 1
    gone)`. The JSON report has them as `pages.new` and `pages.gone`.
  - `--verbose` names the Edge templates in the includes folder that nothing used in the
    build: `Uninhabited: 1 Edge template that nothing used in this build (...)`.
  - `ssqch completions <shell>` prints a completion script for bash, zsh, fish, PowerShell or
    elvish.
  - Colour codes are left out of errors when standard error isn't a terminal, or `NO_COLOR` is
    set (`FORCE_COLOR` keeps them).
  - The starters and the dev server's own pages use the Ranger Station '76 palette: soft
    white (or a green charcoal in dark mode) with neutral text, pine headings and navigation,
    burnt orange links and selection markers, avocado for selected navigation and code,
    harvest gold callout borders, a narrow four-color stripe under the header, and focus rings
    to match. The docs
    starter has a light and dark switch (it follows the system until the reader picks one),
    and its code highlighting matches. The dev server's 404 page shows the footprint as a trail
    patch (broad gold and avocado stripes in a pine ring), and a site without an icon gets a
    map-paper footprint on a pine circle in the tab (burnt orange while the build is broken).
  - `ssqch serve` prints the site's address after each build's report, not before the first
    one, so a long build doesn't push it out of sight.
  - Smaller things: `--offline` builds are `living off the cache`, `ssqch diff` with nothing
    to report adds that the stump has not moved, a panic inside the build says that something
    large walked through it and where to report the bug, and the dev server's responses are
    powered by pine cones.

- `base: "/repo/"` (or `ssqch build --base /repo/`) for a site served below the root of its
  domain, like a GitHub Pages project site. Templates and `page.url` stay as they are; ssqch
  puts the base in front of every URL from the site's root in the HTML it writes (attributes,
  `srcset`, meta refreshes, `url()` in styles), in redirect pages and in Sass output. The link
  checker and the sitemap know about it, `ssqch serve` serves the site under it, and
  `withBase(path)` and `ssqch.base` cover scripts, JSON and feeds.
- `ssqch import eleventy` does the mechanical part of moving an Eleventy site: it renames
  `*.11tydata.*` files, rewrites front matter keys and image attributes, drafts
  `ssqch.config.js` from the Eleventy config, and lists what's left to port with file and line.
  `ssqch import zola` does the same for a Zola site: `tags` out of `[taxonomies]`, `path` to
  `permalink`, a config drafted from `config.toml`, and a list for the Tera templates,
  shortcodes and sections. Both are dry runs unless `--write` is given.
- Themes: `theme: "themes/trail"` puts the site on top of a folder of includes, data, pages
  and files, and the site's own file wins at each path, in every template language. A theme
  can be a git repository pinned to a commit or tag (`"https://github.com/you/theme#v1.2.0"`),
  fetched once with `git` into `.cache/ssqch/themes/`: no package manager. Rust:
  `Config::add_theme`.
- `ssqch/elements`: `elementsPlugin()` loads a custom element's script (and stylesheet) only on
  the pages that have its tag. `like-button.js` in `src/elements/` is `<like-button>`, the tag's
  content is its fallback, and `ssqch:load="idle"` or `"visible"` delays the script until the
  browser is idle or the element is in view. The `islands` example uses it.
- `ssqch init --starter docs` creates a documentation site: a sidebar, breadcrumbs and
  previous/next links from `nav.yml`, a table of contents per page, notes, tabs, highlighted
  code, a front matter schema, the link checker, and optional Pagefind search. It reads without
  JavaScript, in light and dark.
- Nunjucks: a config filter is a tag too. `{% image "/a.png", "Alt" %}` prints what the
  function returns, and `{% callout "tip" %}...{% endcallout %}` passes it the content first
  (`{% markdown %}...{% endmarkdown %}` works the same way).
- Jinja and Nunjucks: `dateformat`, `timeformat` and `datetimeformat` filters (named formats or
  a `strftime` pattern), `now()`, `strftime()` and `isoformat()` on dates, and `pluralize`,
  `filesizeformat`, `striptags`, `cycler()` and `joiner()`.
- Highlighting for `edge`, `liquid`, `hbs`/`handlebars` and `mustache` fences: the template
  tags (keywords, filters, strings, comments) over highlighted HTML.
- More render hooks: `_includes/hooks/footnote-ref.*` and `footnotes.*` write footnote
  references and the notes in a site's own markup, and `hooks/redirect.*` writes the redirect
  pages of `ssqch/redirects`.
- `image(src, { name: "/assets/sponsors/acme" })` names an image's files and folder
  (`/assets/sponsors/acme-200.webp`) instead of using a hash of the source. A named file is
  encoded again when its source is newer.
- `smartPunctuation` leaves a `--` in front of a word alone, so command-line flags in running
  text (`--fix`) aren't turned into dashes.
- `ssqch serve` reads the configuration again when `ssqch.config.js` (or `sitesquatch.toml`)
  changes, or a module the config or a data file imports, so there's no need to restart it. A
  config that doesn't load is reported, and the last good one keeps serving. `--port 0` picks
  a free port. Rust: `cli::try_run_with` (a `configure` that can fail), `serve::serve_reloading`
  and `Config::add_config_file`.
- `fetch(url, { cache: "1h" })` saves a successful response in `.cache/ssqch/fetch/` and reuses
  it until it's that old, so rebuilds (and `ssqch serve`) don't ask the API every time. When a
  refresh fails and an older copy is there, the build uses it and warns. `"force-cache"`,
  `"reload"` and `"only-if-cached"` work, `ssqch build --offline` (or `SSQCH_OFFLINE=1`) answers
  only from saved copies, and the build summary has a `Fetch` line.
- Content schemas: `schemas: { posts: { fields: { title: "string", date: "date", status:
  "'draft' | 'published'", hero: { src: "file", alt: "string" } } } }` checks the data of every
  page tagged `posts` (or matching `files` globs) on each build, and reports every problem with
  its file and field. Types are short strings (`string?`, `string[]`, unions and literals,
  `file` for a path that has to exist), nested objects, or functions; `unknown: "error"` catches
  misspelled front matter keys. `ssqch types` adds the schemas to `ssqch.d.ts`, so
  `pages.byTag("posts")` is typed. Rust: `Config::add_schema`.
- `ssqch new` creates a page from an archetype: a file in `_archetypes/` (in the input folder
  or a theme) named after the folder its pages go in, such as `_archetypes/posts.md`, then
  `default`. Only front matter is filled in (`title`, `date` when the archetype has the key,
  and `--set key=value`); the body is copied as it is. `ssqch new posts --title "Pine cones"`
  names the file as the folder's other pages are named (a date in front, or a folder with an
  index file). Both `ssqch init` starters come with an archetype. A folder named
  `_archetypes` at the top of the input folder is no longer rendered as pages.
- For scripts and coding agents: `ssqch build --format json` prints one JSON report on standard
  output, with what the build wrote and its warnings and errors as data: each has a `code`, the
  `message`, the `file` and `line` when they're known (the line of the file, front matter
  included), the `field` for a schema problem and the `url` for a broken link. Progress lines,
  `console.log` and the output of `beforeBuild` commands go to standard error.
  `ssqch capabilities` (`--format json`) says what the binary supports: commands, optional
  features, template languages, config options, built-in modules and their exports, Node
  modules and globals. `ssqch serve --ready-file <file>` writes the URL, port and output folder
  once the first build is done. Rust: `sitesquatch::diagnostics` (`warn`, `Diagnostic`,
  `Diagnostics`) for plugins, and `serve::serve_reloading` takes a `ServeOptions`.
- `ssqch inspect <url or file>` shows where a page comes from: its template, layouts, date and
  collections, and for each value in its data, which level of the data cascade set it and
  which levels it replaced. `--field level` shows one value in full with every level that set
  it (`--field hero.alt` reaches inside), and `--format json` is for scripts. The site is read
  as a build reads it, up to rendering: `beforeBuild` hooks run, but no page is rendered or
  written. The README's "Where a value comes from" now gives the cascade's exact order.
- `pagination: { data: collections }` goes over the collections' names, for a page per tag
  without a custom collection. It used to fail with "pagination data `collections` is
  undefined".
- `ssqch diff <before> <after>` compares two builds: URLs added and removed, and for each
  changed page whether its text or markup changed, a changed title, and `id`s that are gone.
  Asset fingerprints, `integrity` hashes, the generator's version and whitespace between tags
  are ignored (`--exact` compares bytes), `--ignore <regex>` drops a site's own noise, and
  `--format json` is for scripts. Exits with 1 when the builds differ. Rust: `sitesquatch::diff`.
- npm packages: `import` and `require` find packages in `node_modules` the way Node does
  (`exports` with `import`, `require`, `node` and `default` conditions, `imports`, `main`,
  folders above the site, pnpm's symlinks). luxon, date-fns, lodash, markdown-it, highlight.js,
  prismjs, nunjucks, sanitize-html, html-minifier-terser and a dozen more were checked.
- CommonJS: `.cjs` files, `.js` files in packages without `"type": "module"`, and the site's own
  `.js` files that don't use `import` or `export` run with `require`, `module.exports`,
  `__dirname` and `__filename`. `_data/*.cjs` and `*.data.cjs` are data files.
  `createRequire` from `node:module`.
- `fetch()`, with `Headers`, `Request`, `Response`, `AbortController` and
  `AbortSignal.timeout()`. Requests run in parallel (up to 8 at once). A `fetch` cargo feature,
  on by default, about 2.3 MB.
- Timers (`setTimeout`, `setInterval`, `setImmediate`, `node:timers/promises`), which wait for
  real while a promise is waiting, as in Node.
- `URL` and `URLSearchParams` (WHATWG, from the `url` crate), `TextEncoder`, `TextDecoder`,
  `EventTarget`, and the Node built-ins `module`, `util`, `events`, `os`, `assert`, `timers`
  and `string_decoder`. `http`, `https`, `stream`, `child_process` and other server modules load
  (so packages that require them at the top work) but throw when used.
- A `markdown` config key (`[markdown]` in `sitesquatch.toml`): `headingIds` (`"github"`, the
  default, `"blackfriday"` to match Hugo's older anchors, or `false`), `headingAttributes`,
  `footnotes`, `taskLists`, `autolinks`, `alerts`, `containers`, `definitionLists`,
  `smartPunctuation` and `highlight`.
- Build-time syntax highlighting: `markdown: { highlight: true }` highlights fenced code with
  about 200 Sublime Text and TextMate grammars, as `hl-keyword`, `hl-string` and similar classes,
  and writes a stylesheet with GitHub's light and dark colors to `/highlight.css`. `{1,4-6}` in a
  fence's info string marks lines. It adds about 1.7 MB to the binary; build without the
  `highlight` feature of `sitesquatch` to leave it out.
- Render hooks: templates in `_includes/hooks/` (`heading`, `link`, `image`, `fence`, or
  `fence-<lang>` for one language), in any engine, decide how those parts of Markdown render.
  A fence hook gets the whole info string (`js {1,3} title="app.js"`), not just the language.
- Containers: `::: name args` blocks render through `_includes/containers/name.*` with the
  block's rendered Markdown as `container.content`, or as `<div class="name">` without a
  template. Alerts use a container template with their name when there is one.
- `page.headings` (`level`, `id` and `text`), for layouts and collections, and a `toc` filter that
  turns it into nested links: `{{{ toc(page.headings, { from: 2, to: 3 }) }}}`.
- A `markdown` filter (`{{{ markdown(summary) }}}`, or `markdown(title, "inline")` without the
  `<p>`), and `markdown(text, { inline })` from `ssqch` for config and data files.
- `ssqch/sitemap`: `sitemapPlugin({ url })` writes `sitemap.xml` from the pages the build wrote,
  leaving out `sitemap: false` pages, 404 pages, pages 2 and on of a split list, and `exclude`
  globs. On the blog it matches the hand-written `sitemap.edge` URL for URL.
- `ssqch/redirects`: `aliases` front matter and a `redirects` option, as redirect pages (meta
  refresh, canonical link, `noindex`), Netlify `_redirects` lines (`netlify: true`, added after the
  site's own `_redirects` template), or both.
- `assetsPlugin({ integrity: true })` adds `integrity="sha384-..."` to the `<link>` and `<script>`
  elements that load a fingerprinted file.
- TOML front matter between `+++` lines, and JSON or TOML after `---json` or `---toml`. `.md` sites
  also render `.markdown` files.
- `ignore` (globs of files that aren't pages), `draft: true` (built in development only),
  `bundles: true` (a folder's `index` page gets its other files copied next to it), and globs in
  `passthrough` (`{ "assets/**/*.png": "images" }`).
- `page.excerpt` (the HTML before `<!-- more -->`, or else the first paragraph) and a
  `readingTime(content)` filter.
- `strict: true`: printing an undefined value is an error, in Edge, Liquid, Nunjucks, Jinja,
  Handlebars and Mustache. Conditionals and defaults on missing values still work.
- Rust: `Config::add_generator` adds files made from the list of written pages (the sitemap and
  redirects plugins use it); the build writes them, records them for `clean`, and reports
  collisions with pages.
- `markdown.headingIds` also takes `"ascii"` (Unicode transliterated: `🦀` is `crab`, as Zola's
  anchors are) or a function of the heading's text, for a site's own slugs.
- `markdown: { indentedCode: false }`: lines indented four spaces are Markdown, not code.
- `dirs.layouts`: layouts in their own folder (`_includes/layouts`), so `layout: post` finds
  `_includes/layouts/post.njk`.
- `readData(path)` from `ssqch` reads a JSON, YAML or TOML file in config and data code.
- `Intl.Collator` and `String.prototype.localeCompare`, with `sensitivity`, `numeric` and
  `ignorePunctuation`, matching Node's order for English text.
- Nunjucks templates can use object literals (`{ title: x }`), properties that start with a
  digit (`site.404_page`), `===` and `!==`, macros with defaults before other parameters, string
  methods in JavaScript's or Python's spelling (`title.startsWith("A")`), and JavaScript `Date`
  methods (`page.date.toISOString()`). Jinja templates get the Python string methods.
- `ssqch build --verbose` lists every broken link instead of the first 20.
- `ssqch/sass`: `sassPlugin({ files: { "src/scss": "/css" } })` compiles Sass with grass (pure
  Rust), at the start of each build so fingerprinting and the link checker see the CSS. About
  2.7 MB; the `sass` feature of `ssqch` (on by default).
- Navigation helpers for templates: `navTree(nav, page.url)` marks the current page and its
  sections in a tree from data, `navPager` gives previous and next, `navBreadcrumbs` the trail,
  and `pagesTree(collection)` builds a tree from `nav` front matter.
- `lastModified: "git"` (or `"file"`) sets `page.lastModified` from the last commit that changed
  each page's file, with one `git log` per build. The sitemap uses it for `<lastmod>`.
- `beforeBuild` and `afterBuild` can run programs: `{ run: "npx -y pagefind --site dist" }`
  (and `before_build`/`after_build` lists in `sitesquatch.toml`). The README's Search section
  uses it for Pagefind.
- A `highlight(code, lang)` filter, and `container.source` (a container's lines as written) for
  container templates. `:::tip[Title]` gives the arguments `Title`.
- Rust: `Config::add_file_builder` for files built from their own sources at the start of a
  build, and `Config::run_before_build`/`run_after_build`.
- Examples in `examples/sites/` (`blog-tags`, `blog-categories`, `docs-sidebar`,
  `glossary-docs`, `versioned-docs`, `component-docs`, `reference-pages` and `islands`), each
  built in CI with the link checker, and guides in `docs/guides/` for moving from Zola,
  Eleventy, Docusaurus, MkDocs, Hexo and component frameworks (Astro, VitePress, Next.js,
  Gatsby).

### Faster

- `navTree`, `navPager` and `navBreadcrumbs` index a tree once instead of walking all of it
  for every page. A 9,000-page site with a 9,000-entry sidebar went from 5.2 s to 1.5 s.
- The link checker looks each target up on disk once, not once per link (1.6 s to 0.5 s for
  1.4 million links).
- Liquid: a config filter no longer tries to parse every string it's given as a date, which
  compiled a regular expression each time. The same site in Liquid went from over 7 minutes
  to 12 s, and any Liquid site that calls config filters gains.

### Fixed

- A version tag on a commit whose CI failed no longer publishes a GitHub release with no
  binaries, marked Latest (which broke the install scripts' `latest` links, as 0.3.4 did for
  a while). The CI check now runs after the builds, where its failure stops the release.
- `AbortSignal.timeout(Infinity)` (or any huge number) no longer stops the build with a panic.
- A TOML date written without quotes (`date = 2024-01-02`, in `+++` front matter or a `.toml`
  data file) is read as a date. It failed with "can't parse date".
- In Edge, `{{ image(src) }}` calls the `image` filter on a page whose data has an `image`
  field. The field shadowed the filter, and the call failed with "is not a function".
- `computed.date` is the page's date (in collections, feeds and `page.date`).
- Redirect pages keep the old URL's `#fragment`, `aliases` without a leading `/` are from the
  site's root, and an alias like `/releases/1.85.0` is a folder, not a file.
- Page bundles don't copy ignored files or templates.
- A `link` render hook gets `mailto:` in `link.href` for `<user@example.com>`.

- Pages paginated over a collection (`pagination: { data: collections.categoryPages }`) see each
  item's `content` and `page.excerpt`. They rendered before any page's content existed.
- A page that includes or imports a template that reads `collections` (a macro in
  `_includes/macros.njk`, say) renders after the collections are complete, as a page that reads
  them itself does. Only the page's own body counted before.

## 0.3.4 - 2026-11-10

- **Security:** `ssqch serve` could be asked for any file on the machine: `/%2Fetc/hosts`
  decoded to a path that replaced the output folder. Request paths are decoded first and have
  to stay inside the output folder now. The server only listens on localhost, but a web page
  open in the same browser could have made the request.
- `ssqch serve` no longer rebuilds in a loop when the input folder is the project root (the
  default `dirs`). Each build rewrote `.cache/ssqch/output-files.json`, which is inside the
  watched folder, and that counted as a change. Changes under `.cache`, `.git` and
  `node_modules` are ignored, the list is only written when it changes, and a source written
  again with the same contents (by a `beforeBuild` hook, say) isn't a change either.
- `ssqch serve` on Linux no longer counts reading a file as a change to it. In a site whose
  input folder is the project root, files that were read all the time (by the server, an
  editor or an indexer) could hold a rebuild back for as long as the reads went on. A burst of
  changes is also waited on for a second at most.
- Liquid: `{% include "nav.html" %}` with the name in quotes finds the file. Only the unquoted
  form (`{% include nav.html %}`) did.
- Liquid: a config filter no longer tries to parse every string it's given as a date, which
  compiled a regular expression each time. Sites that call config filters from Liquid build
  much faster.
- A date written without quotes in a `.toml` data file (`updated = 2024-01-02`) is its text
  (`2024-01-02`) in templates, not an object.

## 0.3.3 - 2026-11-09

- A mistake in `ssqch.config.js` names the file once (`ssqch.config.js: dirs.ouput isn't
  supported`), not twice, and `ssqch.config.mjs` errors name that file.
- `ssqch --help` describes `--quiet` (only warnings and errors) and `--verbose` (also list the
  slowest images to encode) correctly.
- README: the tutorial's code blocks no longer start with a filename comment, which put text
  before the front matter and broke the build when copied as they were. The Liquid example
  imports `defineConfig`, and the Netlify example pins a current release.

## 0.3.2 - 2026-11-09

- Fix unstyled pages when running `ssqch serve` after a production build without the CSS and JS
  watchers. A production build renames `index.css` to `index.<hash>.css`, and development
  pages linked the plain name, which no longer existed. `ssqch/assets` now links to the
  fingerprinted copy in that case, with a warning that names it.

## 0.3.1 - 2026-11-09

- `ssqch init --engine liquid` (or `njk`, `hbs`) starts the site with a layout and home page in
  that template language, and a config that lists it in `templateFormats` and uses it for
  Markdown. The default is still Edge.
- Homebrew: releases publish a formula to `reverentgeek/homebrew-tap`, so
  `brew install reverentgeek/tap/ssqch` works on macOS and Linux.
- GitHub Actions: `reverentgeek/setup-ssqch` installs a prebuilt ssqch on Linux, macOS and
  Windows runners.

## 0.3.0 - 2026-11-09

### Breaking

- The `templateEngineOverride` front-matter key is now `render`. Rename it in your templates
  (`render: md`). A build that finds the old key stops with an error that says so. `render` also
  takes a list (`render: [edge, md]`) and `false`, which writes the body without processing it.

### Added

- The macOS binaries are signed with a Developer ID and notarized by Apple, so a binary
  downloaded with a browser runs without a Gatekeeper warning.
- `clean: true` in the config (or `clean = true` in `sitesquatch.toml`) deletes stale files from
  the output: pages and passthrough files an earlier build wrote that this one didn't, like a
  deleted post, and the folders they leave empty. Each build lists what it wrote in
  `.cache/ssqch/output-files.json`, so files other tools write into the output are never touched.
  Off by default.
- `cargo binstall ssqch` installs the release binary instead of compiling (with
  [cargo-binstall](https://github.com/cargo-bins/cargo-binstall)).
- Template engines in the config: `engines: { ext: (source, data) => html }` (or an object with a
  `render` method, sync or async). Add the extension to `templateFormats` to render those files,
  use it for layouts, or name it in `markdownEngine`.
- Liquid templates: add `"liquid"` to `templateFormats` to render `.liquid` pages and layouts, or
  use `markdownEngine: "liquid"`. Config filters work as Liquid filters, `include` and `render`
  read from `_includes`, and Jekyll's filters and `include` parameters are there too. Liquid adds
  about 2 MB to the binary; Rust builds can leave it out with `--no-default-features`.
- Nunjucks and Jinja templates (`.njk`, `.jinja`, `.j2`) with minijinja: config filters work as
  filters and functions, `include`, `extends`, `import` and `from` read from `_includes`, output is
  HTML-escaped (a layout's `content` is safe), and errors name the line. In `.njk` files,
  Nunjucks' `elseif` and `for key, value in object` work too.
- Handlebars and Mustache templates (`.hbs`, `.handlebars`, `.mustache`): config filters are
  helpers, every file in `_includes` is a partial, and Mustache sections, inverted sections and
  `{{.}}` work. Data is converted to JSON per page, so dates are ISO strings.

### Changed

- Markdown escapes `"` in text and inline code as `&quot;`, like the CommonMark reference
  renderer. Raw HTML in Markdown is left as written.
- The minifier shortens attributes (`shortenAttributes`, on by default): boolean attributes lose
  their values (`defer="defer"` becomes `defer`), and whitespace that doesn't matter comes out of
  `class`, `srcset`, `sizes`, URL attributes and the viewport `<meta>`. On the blog, quote
  escaping adds about 10 KB of HTML and the attribute changes save about 4 KB.

## 0.2.7 - 2026-11-09

### Added

- `ssqch init [dir]` creates a starter site: `ssqch.config.js`, a layout, a home page, a post
  with directory data, a data file, editor types and a `.gitignore`. It never overwrites an
  existing file.
- `ssqch types` writes `ssqch.d.ts`, type definitions for `ssqch.config.js` and the `ssqch/*`
  modules, so editors autocomplete and check configs (with `checkJs` in `jsconfig.json`).
- Rust: `sitesquatch::cli::run_with` lets a binary add its own subcommands
  (`ExtraCommand`), and `sitesquatch::cli::clap` re-exports the clap it uses.

## 0.2.6 - 2026-11-08

### Fixed

- Windows: relative paths handed to templates and JavaScript (`page.inputPath`, a transform's
  `inputPath`, the hook event's `dirs`, the build log) use `/`, so `byGlob()` matches. Paths
  are canonicalized without the `\\?\` prefix, so `image()` finds its files, and
  `import.meta.url`, `pathToFileURL` and `fileURLToPath` handle `file:///C:/...` URLs.

### Added

- The crates are on crates.io: `cargo install ssqch --locked --features avif`.
- Prebuilt binaries for macOS (Apple Silicon and Intel) and Windows (x86_64), alongside Linux,
  with a PowerShell installer for Windows. Each one runs a smoke test on its own platform
  before a release is published.
- CI runs the tests on Windows too.

## 0.2.5 - 2026-11-08

### Added

- Links to local images (`<a href="/photos/big.jpg">`, the click-to-enlarge pattern) point at a
  generated copy: the image's own format (JPEG, PNG), at its own width capped at the largest of
  `widths`. Before, they pointed at the source file, which isn't published, so they were broken.
  Copies are cached and named like the rest; a copy the `<picture>` already uses is reused. Turn
  it off with `linkedImages: false`, or per link with `ssqch:ignore` on the `<a>`.

## 0.2.4 - 2026-11-08

### Added

- A link checker: `linksPlugin(options)` from `ssqch/links`. After each build, every internal
  `href`, `src` and `srcset` URL in the HTML has to point at something in the output, and a
  `#fragment` at an `id` on that page. External links, and paths a Netlify `_redirects` file
  covers, aren't checked. Broken links fail production builds and are warnings in `ssqch serve`.
  Options: `anchors`, `ignore` and `fail`.
- `node:crypto` in configs and data files: `createHash` (`md5`, `sha1`, `sha256`, `sha384`,
  `sha512`) with Node's `update()` and `digest()`, and `getHashes()`.

### Fixed

- `ssqch serve` reloads the browser when another tool (a PostCSS or esbuild watcher) writes a
  CSS or JavaScript file into the output folder. Before, a CSS edit could reload the page before
  the new CSS was written, leaving the old styles until the next change.

## 0.2.3 - 2026-11-08

### Fixed

- `ssqch --version` and `--help` name the binary (`ssqch 0.2.2`), not the library crate
  (`sitesquatch 0.2.2`). A site's own Rust binary shows its own name.

### Added

- Asset fingerprinting: `assetsPlugin({ files })` from `ssqch/assets`. Templates link plain
  paths like `/assets/index.css`; production builds rename each listed file in the output to
  `index.<hash>.css` (8 hex characters of a content hash), delete older fingerprinted copies,
  and rewrite every `href` and `src` that points at it. `ssqch serve` keeps the plain paths.
  `assetUrl(path)` returns the URL to use elsewhere.
- Releases run a smoke test before publishing: the Linux binary has to be static, report its
  version, and build a small site with AVIF and WebP images.

## 0.2.2 - 2026-11-08

### Fixed

- Images with a color profile other than sRGB (Display P3 from iPhones and Macs, Adobe RGB,
  Generic RGB, display profiles) are converted to sRGB before encoding, instead of having the
  profile dropped. Their colors no longer look washed out. Against macOS ColorSync's conversion,
  the result is within about one level (0-255) on average. Images without a profile, or with an
  sRGB one, are unchanged, and only converted images get new file names, so an upgrade
  re-encodes just those. The build summary counts them ("converted to sRGB").
- Profiles that can't be converted, such as the HDR (PQ, gain map) profiles of newer iPhone
  photos, no longer stop the image from being processed: it's encoded as before, with a warning
  that suggests converting the source to sRGB.

## 0.2.1 - 2026-11-08

### Changed

- The static Linux build (`x86_64-unknown-linux-musl`) uses mimalloc instead of musl's
  allocator, which was slow under a build's many threads. A warm build of the ReverentGeek blog
  on a GitHub runner went from 0.73 s to 0.30 s, the same as a glibc build; a cold build (every
  image encoded) went from 301 s to 283 s. Peak memory during a cold build is higher: about
  700 MB, up from 368 MB.

## 0.2.0 - 2026-11-08

The first release.

### Breaking

Eleventy compatibility is gone. Sites configured like Eleventy need these changes:

- **The config.** `ssqch.config.js` exports `defineConfig({ ... })` from `ssqch`: an object, or a
  function that gets `{ env, serving }` and returns one. Instead of calling `config.addFilter()`,
  `addCollection()` and the rest, set `filters`, `data`, `collections`, `transforms`,
  `passthrough`, `watch`, `beforeBuild`, `afterBuild` and `plugins`. Directories are `dirs`
  (not a returned `dir`); `markdownTemplateEngine` and `htmlTemplateEngine` are `markdownEngine`
  and `htmlEngine`; `setDataDeepMerge()` is `deepMerge`. Shortcodes are filters.
- **Plugins** are pieces of config (or functions that return one) in `plugins`, not functions
  that receive the config. Two plugins defining the same filter, data or collection name is an
  error.
- **Collections** get `pages.all()`, `byTag()`, `byTags()` and `byGlob()` instead of `getAll()`,
  `getFilteredByTag()` and so on. **Transforms** are `(content, page) => content`, with `url`,
  `inputPath` and `outputPath` on `page` instead of `this`.
- **Hooks** are `beforeBuild` and `afterBuild` (were `eleventy.before` and `eleventy.after`), and
  get `{ env, serving, dirs }`, plus `written` (a list of paths) after the build.
- **Built-in modules** are `ssqch/image`, `ssqch/rss` and `ssqch/minify`. The Eleventy package
  names (`@11ty/eleventy-img`, `@11ty/eleventy-plugin-rss`, `eleventy-plugin-edgejs`,
  `eleventy-plugin-broken-links`, `html-minifier-terser`) no longer resolve.
  - `imagePlugin(options)` replaces `eleventyImageTransformPlugin`, and `image(src, { widths,
    formats })` replaces `Image()`. Encoder settings (`webpQuality`, `avifQuality`, `avifSpeed`,
    ...) go on `imagePlugin()`; sharp options (`sharpWebpOptions`, `effort`, `transform`) and
    `image()`'s `outputDir` and `urlPath` are errors.
  - `rssPlugin()` adds the feed filters; `convertHtmlToAbsoluteUrls` is `htmlToAbsoluteUrls`.
  - `minifyPlugin(options)` minifies HTML output. `minify(html, options)` takes
    `collapseWhitespace`, `removeComments` and `shortDoctype`, all on by default.
- **Templates and data:** the template global is `ssqch` (was `eleventy`); front matter uses
  `computed` (was `eleventyComputed`) and `excludeFromCollections` (was
  `eleventyExcludeFromCollections`); template and directory data files are `*.data.js` and
  `*.data.json` (were `*.11tydata.*`); image attributes are `ssqch:widths` and `ssqch:ignore`
  (were `eleventy:widths` and `eleventy:ignore`).
- **Environment:** `ELEVENTY_ENV` is no longer read. Use `--env`, `SSQCH_ENV` or `NODE_ENV`.
- **Rust API:** `Config::markdown_template_engine` and `html_template_engine` are `markdown_engine`
  and `html_engine` (also the `sitesquatch.toml` keys); `CollectionApi::get_all`,
  `get_filtered_by_tag` and `get_filtered_by_tags` are `all`, `by_tag` and `by_tags`;
  `add_shortcode` is gone (use `add_filter`).

### Added

- A summary after every build: pages written, files copied, images encoded and reused, the
  output folder's size, and how long each phase took. Plugins add lines with
  `Config::add_summary`.
- CI: tests with and without AVIF on Linux and macOS, and clippy.
