# TODO

The ReverentGeek blog (`../blog`) is the main real-world site. Its own tasks are in
`../blog/TODO.md`. Items here that the blog is waiting on say **Blog:**, and blog items that need
a change here say **Needs ssqch:**. When one side finishes, tick it and update the other list.

0.4 (the adoption work below) is built on the `release/0.4` branch, not `main`. Don't tag or
release it until all of it is done and tested, and its examples are deployed. Fixes for 0.3 still
go to `main` (and merge into `release/0.4`).

The order of work:

1. ~~**Remove Eleventy**, and convert the blog to a native `ssqch.config.js`.~~ Done (below).
2. ~~**A Linux x86_64 release and an install script**, so the blog can go back to Netlify
   builds.~~ Done: v0.2.1, and the blog builds on Netlify (2026-11-08).
3. ~~**The blog's other requests** (fingerprinting, color profiles, link checking).~~ Done, apart
   from HDR photos (below).
4. **The rest of the release and adoption work**: 0.4, on `release/0.4`.

Where 0.4 stands (2026-11-10): every phase of the adoption study below is built and tested,
and so are the features that set ssqch apart (render hooks and containers, content schemas,
`ssqch diff`, the docs starter, themes, custom elements, and `ssqch import` for Eleventy and
Zola). Three more came from the research: `ssqch inspect`, the JSON interface for scripts and
coding agents (`build --format json`, `capabilities`, `serve --ready-file`), and `ssqch new`.
The blog builds with it, `ssqch diff` against its 0.3.3 build shows only the new heading
`id`s, and `ssqch inspect` and `ssqch build --format json` work on it.
Left before a release:

- ~~Run CI for `release/0.4` on Linux and Windows.~~ It runs on pushes to the branch, and is
  green on every platform since `.gitattributes` pins LF line endings (2026-11-10; Windows
  checked out CRLF, which broke `collation_matches_node` and the starter's archetype).
- ~~Close the hole in the release workflow that 0.3.4 fell into.~~ Done (2026-11-10): the CI
  check is a `global-artifacts-jobs` job now, after the builds, and dist's host job doesn't
  publish when it fails. As a plan job, its failure made the builds skip, and host publishes
  over skipped builds (an empty release marked Latest).

- **Blog:** after the release, switch to `sitemapPlugin()`, `highlight: true` (dropping Prism)
  and a `posts` schema (`../blog/TODO.md`).

Deferred to 0.5 (decided 2026-11-10): deploying the examples ("Site plumbing" below, and
restyling them in the Ranger Station palette), a drawing for the starter's second post,
`ssqch footprint`, "Say ssqch's name for another generator's word", and every unticked "Later"
and "Not yet" item below.

### CSS and JavaScript (0.5)

Found 2026-11-10: a bare `ssqch serve` on the blog after deleting `dist/` gave an unstyled page,
because PostCSS and esbuild write `dist/assets/` and only `pnpm run serve` starts them. Nothing
in the README or the starters says how CSS and JavaScript get into a site, so someone who adds
a tool finds out the same way. The only clue is a warning that scrolls past.

- [x] **A "CSS and JavaScript" section in the README:** the three ways today (Sass with
      `sassPlugin`; plain CSS and ES modules copied with `passthrough`; any other tool from
      `beforeBuild` with `watch`), how `assetsPlugin` fingerprints the result, and a Tailwind
      example. Done: the four ways (with `serve.run`), and a Tailwind example checked end to
      end with Tailwind 4.1.11 (a production build fingerprints it; serving rebuilds it).
- [x] **Companion processes for `ssqch serve`:** long-running watchers ssqch starts with the
      server, shows the output of, and stops with it (`serve: { run: [ "npx postcss ...
      --watch", ... ] }`), so one command serves a site that has its own CSS and JS tools.
      It also lets ssqch say which tool should have written a missing file. Measured on the
      blog (2026-11-10, ssqch 0.4.0): the tools in `beforeBuild` (with `watch` on
      `src/assets/`) make `ssqch build` and `ssqch serve` work alone, with production output
      identical to `pnpm run build`, but every rebuild reruns PostCSS and Tailwind: an edit
      reaches the browser in about 540 ms instead of 300 ms with the watchers, and the server
      is ready in 1.1 s instead of 0.6 s. Companion processes would keep the watchers' speed.
      Done: `serve: { run }` (`crates/sitesquatch/src/companions.rs`). Each runs in its own
      process group (a tree on Windows, stopped with `taskkill /T`), with standard input held
      open (Tailwind's and esbuild's `--watch` quit when it closes), and Ctrl-C, SIGTERM and
      SIGHUP stop them (`ctrlc`). Test: `serve_runs_companion_processes` (Unix).
  - [ ] **Blog:** after the 0.5 release, `serve: { run: ["pnpm run serve:css", "pnpm run
        serve:js"] }`, so a bare `ssqch serve` has styles (0.4.0 rejects the key).
- [x] **A louder missing asset:** when a linked file never appears, repeat it under the
      summary and in the browser overlay (`/assets/index.css is linked but nothing wrote it`),
      pointing at the README section. Done: the dev server's page script checks the page's
      own stylesheets and scripts, a corner note says what's missing, and the terminal warning
      (`missing-asset`) names the `serve.run` tool or suggests one, repeated after each build.
      Checked in a browser (2026-11-10): the note shows, then clears and the stylesheet swaps
      in when the tool writes it. Test: `serve_says_when_a_linked_file_is_missing`.
- [ ] **Maybe built-in CSS processing** with Lightning CSS (Rust: `@import` bundling, nesting,
      minifying, browser targets), only if the items above leave a real gap. It wouldn't
      replace Tailwind. JavaScript bundling in Rust costs too much binary for what it gives.
      Not started: with `serve.run` and the missing-file note, no gap has shown up yet.

### Jinja by default (0.5)

Decided 2026-11-10: Jinja is the most familiar template language across ecosystems (Python's
Jinja2, Nunjucks, Rust's Tera and MiniJinja) and the most capable of the ones ssqch has
(inheritance, macros, real expressions), so it's the default instead of Edge.

- [x] The `ssqch` command's defaults are `templateFormats: ["jinja", "md", "html"]`,
      `markdownEngine: "jinja"` and `htmlEngine: "jinja"` (Edge in a build without the `jinja`
      feature, and in the Rust library's `Config::new`). Breaking, in the changelog.
- [x] Both starters are written in Jinja, and both take `--engine jinja|njk|edge|liquid|hbs`
      (the docs starter was Edge only). Each engine's docs starter builds the same pages.
- [x] A warning names the files in a template language the site has but doesn't list in
      `templateFormats`, which a build used to leave out without a word (`template-formats`).
- [x] `ssqch capabilities` reports the defaults and the starter engines.
- [x] Examples: `versioned-docs` and `islands` are Jinja (the same pages as before, apart from
      whitespace). `component-docs` stays Edge, for its components with slots.
- [x] **Blog:** stays in Edge, so its config sets `markdownEngine: "edge"` and
      `htmlEngine: "edge"` (it already listed `edge` in `templateFormats`).
- [x] Jinja errors as good as Edge's: a missing `include`, `extends` or `import` says which
      file it probably meant (`did you mean `partials/nav.jinja`?`), and so does an unknown
      filter, test or function. The name is in backticks, so the frame's carets go under it
      (they went under nothing, or under the engine's name). Nunjucks gets the same.
      Test: `jinja_errors_point_at_the_name_and_say_what_was_meant`.
- [x] `--verbose`'s "Uninhabited" line covers Jinja includes, now that most new sites have them:
      `TemplateEngine::included()` (Edge, Jinja and Nunjucks, EJS), and an include counts
      whichever engine read it. Liquid and Handlebars still don't say.
- [x] Found while checking the docs starter's types (2026-11-10, already so in 0.4.0): `tsc`
      on the docs starter reports 9 errors, in `src/assets/docs.js` (DOM `Element` lacks
      `dataset` and `hidden`, and `PagefindUI` is unknown) and `process` in `ssqch.config.js`.
      JSDoc casts, a `PagefindUI` declaration, and `process` in `ssqch.d.ts` would fix them.
      Done: no errors, with or without `@types/node` installed (`process` is declared as
      `NodeJS.Process`, the way those types declare it, so the two merge).

## The Sasquatch voice (done, apart from two items)

Built 2026-11-10, after David's review. ssqch reports like a deadpan park ranger who knows a
lot about HTML: what happened comes first, and now and then something large walks through the
log. The rules are in `AGENTS.md` ("The Sasquatch voice"), and the shared lines are in
`crates/sitesquatch/src/voice.rs`. Decided in the review: `leaveNoTrace` with `clean` kept as
another name (both work), the stump trilogy as the starter, no switch to turn the voice off,
and `ssqch footprint` in 0.5.

- [x] **Status lines:** `Squatch Watch is on. Serving ...` and `Fresh tracks in <file>` from
      `ssqch serve`; `First confirmed siting.` before a site's first `Built in`; `Nothing
      sighted: ...` for a build with no pages; a `Drafts  3 unconfirmed` row (and `drafts` in
      the JSON report); `the trail goes cold on 4 broken links:`; `The stump has not moved.`
      from `ssqch diff`; `Camp is set up.` from `ssqch init`; `Welcome to the woods.` from
      `ssqch import --write`; `living off the cache` with `--offline`.
- [x] **Errors:** a port something else is squatting on; layout, include and component loops
      that name the loop (`we've passed this tree before. Layout loop: base.edge -> wrap.edge
      -> base.edge`; Edge used to print `included from` 64 times); `output conflicts (two sets
      of tracks lead to the same place)`; a missing layout with `no sightings in` and a "did
      you mean"; a panic that says something large walked through the build and where to
      report it; the dev server's own 404 page (footprint, where the trail went cold, the
      closest URL, back to the trailhead) and `Wrong trailhead` outside `base`.
- [x] **Names:** `leaveNoTrace` (`leave_no_trace` in Rust and TOML), with `clean` as another
      name in config files; setting both is an error. That's an exception to "no
      backwards-compatible aliases", made on purpose. The Rust field is renamed, since a field
      can't have two names. Squatch Watch, trail mix and Sassquatch are in the README, and
      `ssqch sighting` is hidden from `--help` and `ssqch capabilities`.
- [x] **Starters:** the site starter is an investigator's field notes (*I Know What I Saw*,
      *Upon Further Review, a Stump*, *The Stump Has Moved*, each showing one thing), with a
      404 page, `Write down what you saw.` in the blueprint and `Built with SiteSquatch.
      Allegedly.` in the footer. The docs starter's 404 has the eyewitness accounts too.
  - [ ] **Needs David:** a suitably blurry picture for the second post. It explains where a
        photo goes but has none, because a drawing would beat anything generated.
- [x] **Small things:** `X-Powered-By: pine cones` from the dev server, and `[ssqch] Fresh
      tracks. Reloading.` in the browser console.
- [x] Tests: `the_ranger_reports_what_happened` and the serve tests in
      `crates/ssqch/tests/cli.rs`, `an_include_loop_is_named` in the Edge tests, and a check
      that nothing of ssqch's own is in what a build writes.
- [x] **Blog:** the footer says `Built with SiteSquatch. Allegedly.` Its 404 page ("Oh
      Noes!") stays. Nothing there reads ssqch's output text, and it doesn't set `clean`.
      Checked: `pnpm test` passes with the branch, and `ssqch diff` against a 0.3.3 build of
      the same sources shows no differences once the new heading `id`s are ignored.
- [x] **0.5: `ssqch footprint [dir]`**, a new command: the size of a build by kind of file,
      with `Largest footprints` (the heaviest pages and files) and `--format json`. It reads
      an output folder, as `ssqch diff` does. Done (`crates/sitesquatch/src/footprint.rs`); on
      the blog, 4,965 files, 302 MB, 96% of it images.
  - [x] Budgets in the config, with an `over-budget` warning for a page over its budget:
        `budgets: { pages: "150 KB", ... }` by kind of file, and `total`, checked after the
        after-build hooks.
- Left alone on purpose: front matter errors, Edge expression errors (they copy JavaScript's
  wording), and option errors, which are already as clear as they get.

### More delight (2026-11-10, done)

The second round, picked because each one also fixes something. All built the same day:

- [x] **Build errors in the page:** `ssqch serve` shows a failed rebuild over the page (it
      only went to the terminal, while the browser kept the old page), in the tab's title and
      icon too, and clears it on the next good build.
- [x] **A footprint favicon** from the dev server for a site without `favicon.ico` (it was a
      404 on every page load), and a red one while the build is broken.
- [x] **CSS swaps without a reload,** keeping the scroll position and half-filled forms.
      Stylesheets and scripts are compared by content, since the tools that write them write
      them again whether or not anything changed.
- [x] **Reload only when your page changed:** a rebuild leaves identical pages alone while
      serving, the browser reloads only for the page it's on (or for a changed script or
      image), and the summary says how many pages changed.
- [x] **"Did you mean" everywhere:** broken links and anchors, config keys and `dirs`, plugin
      and Markdown options, and missing Edge includes (`sitesquatch::suggest`).
  - [x] `image()` and `minify()` call options and image formats (0.5: the prelude's `meant`
        is shared with the built-in modules). Jinja and Nunjucks includes too (0.5, above).
  - [ ] Not yet: includes in Liquid and Handlebars.
- [x] **Point at the spot:** a template or schema error prints the lines it's about, with the
      file's own line number and carets under what the message quotes or the schema field
      (`diagnostics::frames`). The message itself still counts from the end of the front
      matter (the item under the JSON interface, below).
- [x] **No colour codes in logs:** `error:` is red only on a terminal, and never with
      `NO_COLOR`.
- [x] **What changed since the last build:** `Pages  170 written ... (2 new, 1 gone)`, and
      `pages.new` and `pages.gone` in the JSON report. The list of a build's files
      (`.cache/ssqch/output-files.json`) has its pages now.
- [x] **`ssqch sighting` earns its keep:** under the drawing, the last build's pages, folder
      and age.
- [x] **Uninhabited templates:** `--verbose` names the Edge includes nothing used.
  - [ ] Not yet: Liquid and Handlebars includes (their crates don't say what they loaded).
        Jinja, Nunjucks and EJS are covered since 0.5.
- [x] **Shell completions:** `ssqch completions zsh` (and bash, fish, PowerShell, elvish).
- [x] The README, in the voice: the introduction, the tutorial, each section's opening and
      the new behaviour. The option tables and reference lists are as they were.
- Checked in a browser (2026-11-10): editing another post leaves the open page alone, a
  stylesheet edit swaps in place, a broken post shows the error over the page and a fix clears
  it, and editing the open post reloads it.

## Remove Eleventy (done)

No API, name, field, front-matter key, attribute, environment variable, module alias or config
file mentions Eleventy, and there are no backwards-compatible aliases. The blog builds from a
native `ssqch.config.js` with identical output (apart from sitemap dates for the templates that
were edited). What changed, for the changelog's first "Breaking" entry:

- The config is `export default defineConfig({ ... })` (from `ssqch`): an object, or a function
  of `{ env, serving }` that returns one, with `dirs`, `templateFormats`, `markdownEngine`,
  `htmlEngine`, `deepMerge`, `filters`, `data`, `collections`, `transforms`, `passthrough`,
  `watch`, `beforeBuild`, `afterBuild` and `plugins`. Plugins are pieces of config (or functions
  that return one); duplicate names are errors. The `config.add*()` / `set*()` methods,
  shortcodes as a separate kind, `export const config`, and the returned `{ dir }` object are gone.
- Collections get `pages.all()`, `byTag()`, `byTags()` and `byGlob()` (Rust: `all`, `by_tag`,
  `by_tags`). Transforms are `(content, page) => content`.
- Built-in modules are `ssqch/image` (`imagePlugin()`, `image()`), `ssqch/rss` (`rssPlugin()`
  and the helpers) and `ssqch/minify` (`minifyPlugin()`, `minify()`). Slash names rather than
  `ssqch:image`, so ESLint and TypeScript treat them as subpaths of an `ssqch` package. `image()`
  and plugin options reject unknown keys (no more sharp options).
- Template global `ssqch` (version, env, serving, generator); front matter `computed` and
  `excludeFromCollections`; data files `*.data.js` / `*.data.json`; image attributes
  `ssqch:widths` and `ssqch:ignore`; `SSQCH_ENV` (with `NODE_ENV` as a fallback); Rust
  `Config::markdown_engine` / `html_engine` (and the TOML keys); `add_shortcode` removed.
- `scripts/bench.sh` and the README's benchmarks cover ssqch builds only. `examples/reverentgeek`
  stays as an example of the Rust API (and for the benchmarks).

Follow-ups:

- [x] Write the `CHANGELOG.md` entry above (under "Unreleased" until the first release).
- [x] **Blog:** pin the ssqch it builds with. It now installs a pinned release instead
      (`SSQCH_VERSION` in its `netlify.toml`).
- [x] Type definitions for `defineConfig` and the `ssqch/*` modules: `ssqch types` writes
      `ssqch.d.ts` (ambient `declare module` declarations, so no npm package is needed), and
      `ssqch init` includes it with a `jsconfig.json`. Checked with `tsc` against the starter,
      the README's example and the blog's config. Not released yet.

## What else the blog is waiting on

- [x] **Asset fingerprinting in `ssqch`:** `assetsPlugin({ files })` from `ssqch/assets`
      (`plugins/assets`). Templates link plain paths; production builds rename the files to
      content-hashed names and rewrite `href` and `src` references. Released in 0.2.3.
      **Blog:** switched over locally (templates use plain paths; `hash-assets.js`,
      `_data/assets.js` and `build:hash` are gone), waiting for the release.
- [x] `node:crypto` (`createHash` with md5, sha1, sha256, sha384, sha512) for user code in
      configs and data files. Released in 0.2.4.
- [x] **Color profiles in the image plugin.** Images with a non-sRGB RGB profile are converted
      to sRGB with `moxcms` (`plugins/image/src/color.rs`), within about one level of macOS
      ColorSync. Only converted images get new ids, so upgrading re-encodes just those (39 of the
      blog's 737 sources). Released in 0.2.2.
- [x] Clean stale files from the output: `clean: true`. Each build lists the pages and
      passthrough files it wrote in `.cache/ssqch/output-files.json`, and a build with `clean`
      deletes listed files it didn't write again. Files from other tools (the blog's CSS and JS)
      and the image folder aren't on the list, so no `keep` option is needed. Off by default.
- [ ] HDR photos (newer iPhones: Display P3 primaries, PQ curve, gain-map lookup table) can't be
      converted: `moxcms` fails with `InvalidAtoBLut`, and they need HDR-to-SDR tone mapping, not
      a color conversion. They're encoded as they are, with a warning. Doing it properly means
      reading the gain map (ISO 21496-1) or tone-mapping PQ to SDR the way ColorSync does.
      **Blog:** has 4 (the Helix roller case post); converting those sources once with `sips`
      fixes them now.
- [x] **A built-in link checker:** `linksPlugin()` from `ssqch/links` (`plugins/links`). Released
      in 0.2.4.
      **Blog:** it found 413 broken links on 8 pages, all to full-size originals under
      `/content/images/` that the build never publishes (they 404 on the live site too).
- [x] Links to local images point at a generated copy (`linkedImages`, on by default), which
      fixes those 413: on the blog, 17,423 links checked, 0 broken, with 31 new image files.
      Released in 0.2.5.
- [x] **Check `serve` against the blog.** With `pnpm run serve`, a post edit rebuilds and
      reloads in about 0.4 s, and a CSS edit reloads after PostCSS has written the new CSS.
- [x] Make CSS reloads robust: `ssqch serve` also watches the output and reloads (without a
      rebuild) when another tool writes a CSS or JavaScript file there after the last build.
      Released in 0.2.4.
- [x] Output differences found comparing against the blog's old build: none have to match
      anymore, so just fix the ones that are wrong:
  - Markdown leaves `"` unescaped in text. Fixed: it's escaped like the CommonMark reference
    renderer (on the blog, about 10 KB more HTML).
  - The minifier doesn't rewrite attribute values (`defer="defer"`, spaces in the viewport
    `content`). Fixed: `shortenAttributes` (about 4 KB less on the blog).
  - `feed.xml` keeps `<br />` and `<img ... />` as written. That's fine.

## More template languages

Goal: people coming from another generator can keep the template language they already know.
Today ssqch renders Edge, Markdown and plain HTML. A Rust binary can add an engine with
`add_template_engine`, but `ssqch.config.js` can't. The blog stays on Edge and doesn't need any
of this.

In priority order, by how widely each is used across static site generators and themes:

- [x] **Liquid** (`.liquid`): `plugins/liquid` on the `liquid` crate, a default `ssqch` feature
      (about 2 MB). Data reaches Liquid through a view, without copying. Config filters,
      Jekyll's `include` (with `include.*` parameters) and filters, `render`, mixed layout chains
      and lax unknown variables work. Left: `{% render %}` partials are strict about unknown
      variables (the crate's runtime), and errors name the template but not the line.
- [x] **Nunjucks and Jinja** (`.njk`, `.jinja`, `.j2`): `plugins/jinja` on minijinja, a default
      `ssqch` feature. Data through minijinja objects without copying, config filters as filters
      and functions, includes, inheritance and macros from `_includes`, Nunjucks-style escaping
      (not `/`) with a safe `content`, chainable undefined, `dump` and `truncate`, and errors with
      `template:line`. For `.njk`, `elseif` and `for key, value in object` are rewritten to
      minijinja's syntax. Not supported: Nunjucks' async tags and custom tag extensions.
- [x] **Handlebars and Mustache** (`.hbs`, `.handlebars`, `.mustache`): `plugins/handlebars`
      on the `handlebars` crate, a default `ssqch` feature. Config filters are helpers, every
      include is a partial, inverted sections are rewritten to `unless`, and for `.mustache`,
      `{{.}}` and sections over lists or truthy values work through a `__section` helper. The
      crate needs JSON, so each page's data is converted (dates become strings); it's the one
      engine where big collections cost per page. Not supported: Mustache lambdas and delimiter
      changes, and `.length` on lists (use `len`).
- [x] **JavaScript engines from the config**: `engines: { ext: (source, data) => html }` or
      `{ render(source, data) }`, sync or async, on QuickJS. Page data arrives as lazy views, so
      passing it costs little. Libraries like Pug still need npm packages or CommonJS, which
      ssqch doesn't load yet (README, Known gaps).
- [x] **EJS** (`.ejs`, 0.5): `crates/sitesquatch-js/src/ejs.{js,rs}`, a compiler for EJS 3's
      tags on the config's QuickJS engine, so config filters are called directly and page data
      is lazy views. Output is byte-for-byte EJS 3.1.10's on the test cases. Names are
      parameters, not `with ( locals )` (which made each name a Proxy lookup); pages without
      tags skip compiling. Measured (2026-11-10, 2,000 posts): 216 ms against Jinja's 168 ms
      with prose posts, 290 ms against 182 ms with tags in every post. What's left is QuickJS
      compiling each page (about 10 µs) and JavaScript running one call at a time.
  - [x] `ssqch init --engine ejs` for both starters (the same pages as Jinja's, apart from
        whitespace and the file names they mention), and highlighting for ` ```ejs ` fences.
  - [x] EJS in `ssqch import`: an Eleventy site's `.ejs` files get their front matter
        rewritten and `"ejs"` in `templateFormats`, and render as they are
        (`import_carries_over_ejs_templates`).
  - [ ] Maybe: an opt-in Bun runtime (a project's own `node_modules/.bin/bun`). Measured
        (2026-11-10, the real `ejs` package, a layout with small data): 22 µs per render
        sent to Bun one at a time (Node 12 µs), against about 8 µs for a call into QuickJS
        in-process, before copying any collections (views can't cross a process). Batched,
        3 µs. So Bun only pays if a whole render stage goes over at once, and templates
        calling ssqch's Rust functions (`markdown`, `highlight`, `image`) would each be a
        round trip back. Its better use is Node compatibility for config and data files
        that need npm packages QuickJS can't load, which run once per build.
  - [ ] A Rust function that calls back into JavaScript from inside an EJS template (say
        `markdown()` on a site with EJS render hooks) is an error ("called from inside another
        JavaScript call"), like a config filter doing the same today.
- [ ] Not planned unless someone asks: Go templates (Hugo; no Rust implementation matches Go's
      `text/template` closely) and MDX/JSX (needs a JavaScript toolchain and a component model).

Shared work, done with the first engine (Liquid) and reused by the rest:

- [x] One path for every engine to get what Edge gets: config filters, the `ssqch.*` globals,
      the data cascade, `_includes`, layouts and the compiled-template cache come through
      `EngineEnv` and `RenderContext`. Pages that read `collections` in `{{ }}` or `{% %}` render
      after the others, like Edge pages. Errors name `template:line` only for Edge so far.
- [x] `markdownEngine` and `htmlEngine` accept the new names (`markdownEngine: "liquid"`), and
      `templateFormats` the new extensions.
- [x] Each engine is a cargo feature that the release builds turn on (`liquid` is a default
      feature of `ssqch`). Liquid adds about 2.1 MB (11.4 MB to 13.6 MB on macOS arm64).
- [x] Docs and tooling: the README has a section per engine, and `ssqch types` mentions the
      names. `ssqch init --engine liquid` (or `njk`, `hbs`, `edge`) starts a site in that language.
- [x] Tests: a small site per engine in `crates/ssqch/tests/cli.rs`, including layout chains
      that mix engines.
- [x] Rename the `templateEngineOverride` front-matter key to `render` (`render: md`,
      `render: [liquid, md]`, `render: false`). Breaking; the old key is an error that names the
      new one.
      **Blog:** one post's front matter uses it (`edgejs-template-plugin-for-11ty.md`). Switch it
      to `render: md` with the release bump. The post's text about Eleventy's key stays.

## Adoption study

The research is in `research/` (gitignored, local only). `adoption-study.md` looks at what it
would take to move 12 high-profile sites (eslint.org, blog.rust-lang.org, letsencrypt.org,
opensource.guide, hexo.io, the FastAPI docs, reactnative.dev, typescriptlang.org,
kubernetes.io, getbootstrap.com, vuejs.org, react.dev) to ssqch. `positioning.md` covers which
ideas to take from other generators and the gaps none of them fill.

The goal isn't to clone any generator: take the best ideas, fill the gaps, and design each
feature as ssqch's own. What sets ssqch apart is a single binary that is still flexible (a
JavaScript config, six template languages, mixed freely). The items below build on that, in the
order to do them. Each phase adds the examples (`examples/sites/<name>/`, built in CI) and
migration guides it unblocks.

### What makes ssqch distinct (design these first, build them across the phases)

- [x] **Render hooks and containers in any engine:** templates in `_includes/hooks/` (`heading`,
      `link`, `image`, `fence`) decide how Markdown renders, and `::: name args` renders
      `_includes/containers/name.*`. One idea covers admonitions, tabs, anchors, figures and
      diagram fences. Hugo's render hooks only work in Go templates.
- [x] **Content schemas:** `schemas` in the config, one per collection (tag) or set of files,
      checked on every build, with errors naming the file and field, and types in `ssqch types`
      (`sitesquatch::schema`). Only Astro has this; the Rust blog and opensource.guide wrote
      their own checkers.
  - [ ] Later: references between pages (an `author` that has to be a page in `authors`), and
        checks on the rendered output (every guide has a previous and next link).
  - [ ] **Blog:** could add a `posts` schema (title, date, `feature_image` as a `file`).
- [x] **`ssqch diff`:** compares two builds page by page, ignoring noise such as fingerprints
      (`sitesquatch::diff`). It's the safety net for upgrades, refactors and migrations. Each
      changed page says whether its text or markup changed, and which `id`s are gone;
      `--format json` for scripts and agents.
  - [ ] Later: changed canonical links, redirects and feed entries called out the way titles
        and `id`s are, and image ids from `imagePlugin()` matched like fingerprints.
- [x] **A docs starter:** `ssqch init --starter docs`: sidebar, breadcrumbs, pager, TOC,
      admonitions, tabs, highlighting, a schema, the link checker and opt-in Pagefind search, as
      static HTML that needs no JavaScript to read (looked at in a browser, wide and phone
      width). It's the answer to "why not Docusaurus or VitePress?", and timely while Material
      for MkDocs is in maintenance mode.
  - [ ] Versions (the `versioned-docs` example shows how) and i18n (after the i18n release) as
        options of the starter.
- [x] **Themes without a package manager:** `theme` is a folder or a git URL pinned to a commit
      or tag, fetched with `git` and cached in `.cache/ssqch/themes/`, and overridden file by
      file: includes (in every engine), layouts, hooks, containers, data, pages and static files
      (`sitesquatch::theme`).
  - [ ] Later: a theme's own config (filters, plugins), `ssqch theme` to list a theme's files
        and copy one into the site, a report of upstream changes that overlap the site's
        overrides, and the docs starter published as a theme.
- [ ] **`ssqch import <generator>`:** codemods for the mechanical parts (front matter, data
      file names, shortcodes into ssqch's syntax), plus a report of what needs a hand. Liquid
      and Nunjucks templates render as they are, so the first build comes early.
  - [x] The command, as a dry run with `--write` to apply, and `eleventy` as the first
        generator (`crates/ssqch/src/import.rs`): renames, front matter keys, image
        attributes, a drafted config, and a by-hand list with file and line.
  - [x] `zola`: front matter (`[taxonomies] tags`, `path`), a config drafted from
        `config.toml`, and a list for sections, shortcodes and Tera constructs.
  - [ ] `jekyll` and `hugo`.
- [x] **Interactivity without a framework:** `ssqch/elements` (`plugins/elements`): a custom
      element's script and stylesheet are included only on the pages that have its tag, with
      `ssqch:load="idle"` or `"visible"` for islands. Checked in a browser with the `islands`
      example.
  - [ ] Later: fingerprint the elements' files, and `modulepreload` for eager ones.

### 1. Markdown core (every site needs something here)

- [x] Automatic heading IDs, with a choice of slugger (`headingIds: "github"`, the default, or
      `"blackfriday"` for letsencrypt.org's anchors). On the blog, the only change to the HTML
      is the new `id`s (17,423 links checked, 0 broken).
- [x] `{#id}` heading attributes (pulldown-cmark's `ENABLE_HEADING_ATTRIBUTES`).
- [x] `page.headings` (level, id, text) and a `toc` filter. The headings come from the rendered
      HTML, so they work in every engine; layouts and collections see them, the page's own body
      doesn't (it hasn't rendered yet).
- [x] A `markdown: { ... }` config key: footnotes (GitHub-style, collected at the end), definition
      lists, task lists, smart punctuation, autolinked URLs, and GitHub's `> [!NOTE]` alerts.
- [x] A `markdown` filter in every engine, also exported from `ssqch`, for Markdown inside HTML
      and component bodies (Jekyll's `markdown="1"`, Hexo's `{% note %}`). `markdown="1"` on raw
      HTML itself isn't supported; opensource.guide's 3,803 uses would need it or a codemod.
- [x] Keep a fence's whole info string (`title=`, `{1,3}`) and pass it to the `fence` hook.
- [x] The render hooks and containers above (admonitions on Docusaurus, VitePress, MkDocs and
      Hexo all become containers). Left: containers must close in the block they opened in.
- [x] Build-time syntax highlighting: `markdown: { highlight: true }`, classes, light and dark
      themes, line highlighting. Evaluated (2026-11-09): giallo is EUPL-1.2 (copyleft, awkward
      in an MIT binary); arborium (tree-sitter) adds 44 MB for 30 languages; syntect with
      two-face's grammars adds 1.7 MB for about 200, pure Rust, but parses about 7x slower (the
      blog's 350 fences add 60 ms). Went with syntect, mapping scopes to a small set of `hl-*`
      classes so the HTML stays small.
  - [x] Edge, Liquid, Handlebars and Mustache fences highlight (two-face has no grammars for
        them): a small lexer for the template tags, over the HTML grammar with the tags blanked
        out, so no grammar files and no extra parse of the syntax set.
  - [ ] A cache for highlighted fences, if big sites find it slow.
  - [ ] **Blog:** can switch from Prism (`prism.js`, 20 KB) to `highlight: true` once 0.4 is
        released: its 9 `edge` fences highlight now (checked on the Edge.js plugin post).
- [x] Examples `blog-tags` and `docs-sidebar` (done at the end of phase 2).

### 2. Site plumbing

- [x] `ssqch/sitemap`: `sitemapPlugin({ url, exclude })`. On the blog it lists the same 150 URLs
      and dates as `sitemap.edge`. **Blog:** can replace `sitemap.edge` (and the `isSiteMapSafe`
      and `htmlDateString` filters, if nothing else uses them) once 0.4 is released.
- [x] Front matter `aliases`, and `ssqch/redirects`: meta-refresh pages, Netlify `_redirects`
      lines (after the site's own `_redirects` template), or both. Built on a new core API,
      `Config::add_generator`, for files made from the written pages.
- [x] TOML (`+++`) and `---json` front matter; `.markdown` as Markdown.
- [x] An `ignore` config key (globs), and `draft: true` pages built only in development.
- [x] `page.excerpt` (`<!-- more -->` or the first paragraph) and a `readingTime` filter.
- [x] Globs in `passthrough`, and copying the non-template files next to a page (page bundles,
      `bundles: true`, off by default: the blog's input root has files next to `index.edge`).
- [x] Render a string `permalink` (and `computed`) with the page's own engine, not always Edge.
- [x] `assetsPlugin({ integrity: true })` for SRI hashes (fingerprinted builds only).
- [x] `strict: true`: printing undefined template values is an error in every engine;
      conditionals and defaults still work.
- [x] Examples `blog-categories` and `glossary-docs` (and `blog-tags` and `docs-sidebar` from
      phase 1), in `examples/sites/`, built by `crates/ssqch/tests/examples.rs`; guides from Zola
      and from Eleventy in `docs/guides/`. Writing them fixed two bugs: pages paginated over a
      collection had items without `content`, and pages whose includes read `collections`
      rendered too early.
- [x] Test the examples locally: `scripts/examples.sh` builds them all (with link checks), and
      `scripts/examples.sh blog-tags` serves one with live reload.
- [x] The examples in the Ranger Station '76 palette (0.5): soft white and green charcoal
      pages, pine headings and navigation, burnt orange links, avocado for the selected page,
      tabs and code, harvest gold callouts, the four-color stripe, and highlighting and
      Pagefind's search box in the same colors. `component-docs`' own library colors moved to
      the palette too. Checked in a browser in light and dark mode (2026-11-10).
- [ ] Later (not now): deploy the examples to Netlify, one site each, at `<name>.sitesquatch.dev`.
      `.github/workflows/examples.yml` builds them with the branch's ssqch and uploads each
      through Netlify's deploy API, from `release/0.4` for now (switch to `main` after 0.4).
  - [ ] Create a Netlify site per example (eight now), add the `NETLIFY_AUTH_TOKEN` secret and
        the `NETLIFY_SITE_*` variables (the workflow lists them), and run the workflow.
  - [ ] DNS: `sitesquatch.dev` is on Namecheap's DNS. Add a CNAME per example to its
        `.netlify.app` name, and the custom domain in each Netlify site.
  - [ ] Link the live URLs from `examples/sites/README.md` and the README.
- [x] `base: "/repo/"` (and `--base`) for sites served below the domain root (GitHub Pages
      project sites): the build puts it in front of root-relative URLs in the HTML it writes,
      `withBase()` and `ssqch.base` cover the rest, and `ssqch serve` mounts the site under it.
      Left: a root-relative link to something outside the base needs the full address.
- [x] `docs-sidebar` search: it uses Pagefind with `SEARCH=1` (phase 5).
- [x] The `url()` filter from `rssPlugin()` (an identity function left over from the Eleventy
      days) is removed. **Blog:** `feed.edge` and `sitemap.edge` used it; they pass the URL
      straight to `absoluteUrl()` now, which works with 0.3 too. `ssqch diff` of the blog built
      by 0.3.3 and by this branch: 72 pages and the feed differ, only by the new heading `id`s.

### 3. Trial migrations

- [x] Port eslint.org and blog.rust-lang.org (local clones, `ssqch-port` branches in
      `../trials/`, not pushed) and diff the output with samples of the live sites. Notes in
      `research/trial-migrations.md`. The Rust blog: all 792 sitemap URLs, 56 of 66 sampled
      pages identical, 818 pages in 0.33 s. eslint.org (English, no playground): 637 pages in
      about 1.6 s, 11 of 61 identical, every other difference explained. Fixed along the way:
      `computed.date`, root-relative and version-number aliases, fragments kept by redirect
      pages, bundles skipping ignored files, `mailto:` in link hooks, `headingIds: "ascii"` and
      slugger functions, `dirs.layouts`, `readData()`, `.html`/`.md` layouts through their
      engines, `/index.html` permalinks, dates from file names, `indentedCode: false`,
      `Intl.Collator`/`localeCompare`, Nunjucks object literals, `site.404_page`, `===`, macro
      parameter order, string and `Date` methods, and `--verbose` listing every broken link.
- [ ] Not yet: offering either port upstream. Both need Sass, and eslint.org its other
      languages. Their broken internal links (25 on the Rust blog, 28 on eslint.org; lists in
      `../trials/`) are worth reporting on their own.

Found by the trials, not fixed yet:

- [x] Footnote markup of a site's own (Zola's `[1]` and `fr-1-1` ids): the `footnote-ref` and
      `footnotes` hooks.
- [x] Redirect page markup of a site's own: `_includes/hooks/redirect.*` (a generator's file
      can name a hook template, `GeneratedFile::with_hook`).
- [x] `image()` file names and folders per call: `name: "/assets/sponsors/acme"`.
- [x] A filter called as a function lost to page data with the same name (`image()` vs an
      `image:` field). In Edge, a call now reaches the filter when the data isn't callable.
      Nunjucks and Jinja still look in the page's data first; the filter form
      (`{{ src | image }}`) always works there.
- [x] Smart punctuation leaves `--flag` alone, as markdown-it's typographer does.
- [x] `ssqch import zola`: `path` to `permalink`, `[taxonomies] tags` to `tags`, a drafted
      config, and a by-hand list for `_index.md` sections, shortcodes and Tera templates.
      Writing it found that an unquoted TOML date (`date = 2024-01-02`) failed to parse; fixed.
  - [ ] Write each section's directory data from its `_index.md`, and rewrite the Tera
        constructs that map one to one (`page.content`, named filter arguments).
- [x] `ssqch import eleventy`: `.11tydata.*` renames, Eleventy front-matter keys, a drafted
      config and a list of filters, shortcodes and plugins to port. CommonJS needs no change
      (ssqch loads it), and Nunjucks shortcodes keep their `{% name %}` form.
  - [ ] Port simple `addFilter` and `addShortcode` bodies into the drafted config instead of
        listing them.

### 4. Internationalization (not in 0.4)

Moved to a later release (decided 2026-11-09); 0.4 ships without it.

- [ ] A design write-up first: a `locales` config key, `page.lang` from the folder,
      `page.translations` grouped by a translation key, a `t(key)` filter over
      `_data/i18n/<lang>.*`, fallback pages for untranslated content, and hreflang.
- [ ] `Intl` for more locales than en-US (ICU4X with a chosen set of locales). eslint.org's 7
      other language sites and letsencrypt.org's number formats need it, and eslint.org's English
      site needs `NumberFormat`'s currency style and compact notation.
- [ ] Example `multilingual-liquid`; guides from Jekyll and from Hugo; trial with letsencrypt.org.

### 5. Docs-site features

- [x] Navigation helpers: `navTree` (current, ancestor and open flags), `navPager`,
      `navBreadcrumbs`, and `pagesTree` for a tree from `nav` front matter.
- [x] Sass with `grass` (pure Rust), as `ssqch/sass`, on a new `Config::add_file_builder` (files
      written before `before_build` hooks, so fingerprinting sees them). eslint.org's 43
      stylesheets compile, within 0.2% of Dart Sass's size (grass writes `hsl()` as hex). Adds
      about 2.7 MB; a default feature.
- [x] Search: evaluated (2026-11-09). Pagefind's library API works (eslint.org's 632 pages in
      0.38 s) but adds about 13 MB to the binary. Decided: no built-in search for now; the README
      shows Pagefind after the build, and `docs-sidebar` uses it with `SEARCH=1`.
  - [ ] Maybe later: a lighter built-in search, or Pagefind as an opt-in download.
- [x] Hooks can run programs: `{ run: "command" }` in `beforeBuild`/`afterBuild` (decided
      2026-11-09).
- [x] `page.lastModified` from git (`lastModified: "git"`), opt-in, with a warning for shallow
      clones; the sitemap uses it.
- [x] Examples `versioned-docs`, `component-docs` and `reference-pages`; guides from Docusaurus
      and from MkDocs. Writing them added the `highlight` filter, `container.source` and
      `:::tip[Title]` arguments.

### 6. JavaScript ecosystem

- [x] `ssqch serve` reads the configuration again when the config file changes, or a module
      it or a data file imports (a new engine each time, so nothing stays cached). A config
      that fails to load keeps the last good one serving.

- [x] npm packages, CommonJS and `fetch`. Resolution follows Node (`exports` conditions and
      patterns, `imports`, `main`, parent folders, pnpm symlinks); CommonJS by Node's rules, with
      the site's own `.js` files detected by syntax; `fetch` on ureq (rustls), up to 8 requests
      in parallel, about 2.3 MB as a default `fetch` feature; timers that wait for real; `URL`
      from the `url` crate; `util`, `events`, `os`, `assert`, `module`, and loadable stubs for
      `http`, `stream` and other server modules. 20 popular packages checked (luxon, date-fns,
      lodash, markdown-it, highlight.js, prismjs, nunjucks, sanitize-html, html-minifier-terser,
      ...); `@sindresorhus/slugify` fails on QuickJS's regex `v` flag (no set operations).
  - [x] A cache for `fetch`: `fetch(url, { cache: "1h" })` saves responses in
        `.cache/ssqch/fetch/`, falls back to an older copy when a refresh fails, and `--offline`
        builds from saved copies only.
  - [ ] Later: named data sources with a schema for the response, and a `refresh` command.
  - [ ] Named exports of CommonJS modules are found by running the module, not read from the
        source as Node does. Checked (2026-11-10): it is visible. An ES module that imports a
        side-effect module and then a CommonJS file runs the CommonJS file first (Node runs
        them in import order), because the file runs while the module graph loads. Fix: read
        the names from the source for the plain forms (`exports.x =`, `module.exports = { a, b
        }`, `Object.defineProperty(exports, "x"`), as Node's lexer does, and only run the file
        early when it assigns something else to `module.exports`.
- [x] Nunjucks: config functions as tags (`{% image "a.png", "Alt" %}`, and around content
      with `{% endimage %}`), rewritten to calls before minijinja parses the template.
- [x] Jinja: `pluralize`, `filesizeformat`, `striptags`, `cycler`, `joiner` from
      minijinja-contrib, and date filters of our own on chrono (contrib's need `jiff`).
- [x] A synthetic 9,000-page benchmark (kubernetes.io's size): `scripts/synthetic-site.py`
      (Edge, Nunjucks or Liquid). It found three things, now fixed: the nav helpers walked the
      whole tree for every page (5.2 s to 1.5 s), the link checker hit the disk for every link,
      and Liquid filters compiled a regex for every string argument (7m 17s to 12 s).
  - [ ] Liquid is still 8x slower there: the `liquid` crate copies a variable's value on
        every read (`Runtime::get` calls `into_owned`). Fixing it means a patch upstream or a
        runtime of our own over liquid-core.
  - [ ] Peak memory is about 0.5 GB for 9,000 pages (every page's HTML is held until it's
        written); stream pages out if a bigger site needs it.
- [x] Example `islands` (custom elements with `ssqch/elements`).
- [x] Guides from Hexo and from component frameworks (Astro, VitePress, Next.js, Gatsby: what
      ports, and what stays client JavaScript), in `docs/guides/`.

## From the research, not planned yet

`research/` was read in full on 2026-11-10 (`developer-friction.md`, `product-opportunities.md`,
`positioning.md`, `adoption-study.md`, `trial-migrations.md`). Its "first" priorities are done
in 0.4: reloading the config, cached remote data, `base`, and `ssqch diff`. So are the eight
gaps in `positioning.md`. What it proposes that isn't built or listed above, in the order
I'd take them (the first three went into 0.4):

- [x] **`ssqch inspect <url or file>`:** where a page comes from: its template and layout
      chain, its date, its collections, and for each value in its data the level of the
      cascade that set it and the levels it replaced. `--field title` shows one value with
      every level, and `--format json` is for scripts. The README's "Where a value comes from"
      documents the cascade's order (the "Clearer, documented data-cascade rules" item).
      Building it turned up that `pagination: { data: collections }` didn't work; it does now.
- [x] **A machine-readable interface for scripts and coding agents:** `ssqch build --format
      json` (one report: what was written, and warnings and errors with a code, the file, the
      line when known, the field for schema problems and the URL for broken links),
      `ssqch capabilities` (version, commands, features, template languages, config options,
      modules with their exports, Node modules, globals) and `ssqch serve --ready-file <path>`
      (URL, port, output folder and pid, written once the first build is done). With
      `inspect --format json` and `diff --format json`, every command a script needs speaks
      JSON. Left to do:
  - [x] Error messages from templates count lines from the end of the front matter
        (`index.edge:4` for line 7 of the file). The JSON report's `line` is right; make the
        text say the file's line too. Done: `diagnostics::file_lines`, after the file and line
        are located, for the terminal, the dev server's overlay and the JSON `message`.
  - [ ] The file and line of an error that isn't a schema, link or conflict problem are read
        from its message (`diagnostics::locate`). Carry them in the error instead, starting
        with the template engines.
  - [x] `console.warn` in a config goes to standard error, not into the report's `warnings`.
        Done: in a JSON build it's a warning with the code `console` (the terminal is as it was).
- [x] **`ssqch new <path>`:** a new post or page from a blueprint (a file in `_blueprints/`,
      named after the page's folder; "archetypes" until 0.5), with the title and date filled in
      as front matter keys rather than through a second template syntax. Given a folder and a
      title, the file is named as the folder's other pages are. Both starters have one.
- [ ] **References in schemas:** a field that has to name a page in another collection
      (`author: "ref:authors"`), and output checks (every guide has a previous and next link).
- [ ] **Named data sources:** `sources: { snacks: { url, cache, schema } }` with a
      `ssqch refresh` command, so a build can run offline from pinned snapshots on purpose.
- [ ] **`ssqch move <from> <to>`:** move a page, fix the links to it, and add an alias.
- [ ] **More output formats for a page:** the same content as JSON or Markdown (for a search
      index, an app, or `llms.txt`), from explicitly listed collections and fields.
- [ ] **A searchable-directory example:** structured data, one page per record, filters as a
      custom element, Pagefind for search.
- [x] **Say ssqch's name for another generator's word** (decided 2026-11-10; the design and
      what each case printed before is in `research/exact-agent-first.md`). Where a command,
      flag, config option, filter or front-matter key is common in other generators and ssqch
      has the same thing under its own name, the error says the equivalent and where to read
      about it, so people and agents learn as they go. Every row refuses its word
      (aliases were decided against at first; that changed on 2026-11-11, see below). Built for
      0.5.
  - [x] One table of equivalents (the word, its kind, whose it is, ssqch's name, what to say,
        where to read more): `crates/sitesquatch/src/equivalents.rs`. `ssqch import` reads its
        front-matter renames from it. Every row is tested
        (`other_generators_words_get_ssqch_names`): the word is refused or warned about, the
        message is the row's, and the name it gives is in `capabilities`, `--help` or the
        README.
    - [ ] Not yet: checking the table against the tables in `docs/trailheads/`, and moving
          `import`'s method and package hints (`CALL`, `replacement`) into it.
  - [x] First slice: commands and flags (`dev`, `start`, `server`, `preview`, `check`, `clean`,
        `generate`, `version`, `deploy`, `--watch`, `--drafts`, `-D`, `-d`, `--destination`,
        `--input`, `--pathprefix`, `--baseURL`, `--minify`, `--incremental`, `init
        --template`), under clap's error in place of its spelling guess; config options
        (`pathPrefix`, `dir`, `publishDir`, `outDir`, `integrations`, `baseURL`, `title`, the
        `*TemplateEngine` options and the `add*` methods), all unknown keys in one run, and a
        config written as calls (`config.addPassthroughCopy()`); a folder with another
        generator's config and none of ssqch's (Eleventy, Hugo, Zola, Jekyll, Hexo, MkDocs,
        Docusaurus, Astro, Gatsby, VitePress): a warning, `other-generator`.
  - [x] Then: filters in Jinja, Nunjucks and Liquid (`url`, `relative_url`, `absolute_url`,
        `slugify`, `markdownify`, `jsonify`), warnings for front-matter keys that can't be a
        site's own (`foreign-key`: `eleventyComputed`, `eleventyExcludeFromCollections`,
        `eleventyNavigation`, `redirect_from`, `published: false`; `templateEngineOverride`
        stays an error), and a `hint` in the JSON report (`word`, `kind`, `use`, `from`,
        `more`).
  - [x] Template globals: `eleventy.*`, and Jekyll's `site.posts` and `site.pages` (unless the
        site's `site` data has them), read in template code in pages, layouts and includes:
        a warning, `foreign-global`.
  - [x] `ssqch docs <foreign name>` and `ssqch docs --from <generator>`: each row's `More:`
        is an `ssqch docs` lookup now (or a command's `--help`, for flags), and the test checks
        it answers.
  - [x] With it: a sentence in `AGENTS.md` saying a hint that names another generator's word
        isn't an API.
  - [x] Found on the way: Liquid's `Unknown filter` didn't name the filter; it does now, with a
        "did you mean". (`Nothing sighted` had an empty folder name when the input folder is
        the project root; fixed: it says `.`.)
- [ ] **Aliases for other generators' words** (decided 2026-11-11: familiar and inviting is
      the goal, and an alias that eases the move is welcome; copying a generator wholesale
      isn't). The rows of the equivalents table whose word means the same in ssqch start
      working. An alias works and prints one line, once per build, naming ssqch's word and
      where to read about it (`note: pathPrefix works; ssqch calls it base (ssqch docs
      base)`). `--quiet` hides it, and it isn't a warning in the JSON report. The docs keep
      teaching ssqch's names. The row says whether it's an alias, and the test checks that
      an alias works and a hint still refuses.
  - [ ] Commands: `dev`, `start`, `server` (Hugo) and `watch` run `ssqch serve`; `generate`
        (Hexo) runs `ssqch build`.
  - [ ] Flags: `--watch` and `--serve` serve, `-d` and `--destination` are `--output`, and
        `--pathprefix` is `--base`.
  - [ ] Config: `pathPrefix` is `base`, `dir` is `dirs` (Eleventy's keys are the same),
        `publishDir` and `outDir` are `dirs.output`, and `markdownTemplateEngine` and
        `htmlTemplateEngine` are `markdownEngine` and `htmlEngine`.
  - [ ] Front matter: `eleventyComputed` is `computed`, `eleventyExcludeFromCollections` is
        `excludeFromCollections`, `redirect_from` is `aliases`, and `templateEngineOverride`
        is `render` (its `njk,md` string becomes the list).
  - [ ] Filters: `url` and `relative_url` return the URL as it is (the build adds `base`
        already), `markdownify` is `markdown`, and a real `slugify` filter in every template
        language.
  - [ ] Stay hints, since they mean something else in ssqch: `check` (sounds like it doesn't
        write, but `build` does), Jekyll's `published: false` (never built; ssqch's drafts
        build in development), Hugo's `baseURL` (a full URL; `base` is a path), `--drafts`,
        `-D` and `--buildDrafts` (they'd switch the whole environment, not just drafts),
        `site.posts` and `site.pages` (they can clash with a site's own `site` data),
        `eleventyNavigation` (its fields don't match `nav`'s), and the `add*` method calls (a
        different shape of config).
  - [ ] With it: the README's "Trailheads" section says which words work, AGENTS.md's line on
        the table, and the trailheads' tables.
- [x] **`ssqch docs`: the documentation of the installed version, from the binary** (item 2 in
      `research/exact-agent-first.md`). The README and the trailheads in `docs/trailheads/` are built
      in (`crates/ssqch/build.rs`; a crate from crates.io has only the README, and `--from`
      links to the guide for that version). `ssqch docs` alone is a card: every command, config
      option, template function and module export, one line each, from where they're defined
      (clap, `ssqch.d.ts`, `BUILTIN_FILTERS`). `ssqch docs <name>` prints the table row or list
      item that defines it and where else it comes up; another generator's word says ssqch's
      first; heading words print a section; anything else searches the text. `--format json`
      for agents. `docs_answer_for_every_name` checks that every name `capabilities` lists has
      a line and an answer. Found on the way: `ssqch.d.ts` didn't declare `readData`, and the
      rss functions, `minify`, `beforeBuild` and `afterBuild` had no descriptions.
  - [x] `ssqch init` writes an `AGENTS.md` that points at `ssqch docs` (item 3 in the
        research), with a one-line `CLAUDE.md` (`@AGENTS.md`), and `ssqch docs agents` prints
        it for a site that exists already. A test holds both to 1,536 bytes.
  - [ ] Maybe: explain each diagnostic code (`ssqch docs links`), once errors carry a finer id.
- [ ] **When troubleshooting docs get written:** call the section (or page) "Ranger station:
      troubleshooting", so it's where to go for help and still says what it is.
- [ ] Not for now: a page inspector in the browser, a component workbench, an MCP server (after
      the JSON interface exists, as a thin layer over it), preview at a future date, a local
      form editor for front matter, diagnostic bundles.

## Prebuilt binaries and easier adoption

Goal: anyone can use `ssqch` without installing Rust or compiling it, and can start a new site
in a couple of minutes.

### Netlify first

The smallest part of this section that lets the blog go back to Netlify building the site
itself (**Blog:** "Step 2" in `../blog/TODO.md`):

- [x] A release workflow (`dist`, see `dist-workspace.toml`) that builds Linux x86_64 with AVIF
      as a musl static binary, with SHA-256 checksums and build attestations. Pull requests run
      the same build without publishing. The other platforms can follow in later releases.
- [x] See the release build pass on a pull request, then tag `v0.2.0` (released 2026-11-08).
- [x] Release 0.2.1 with mimalloc in the musl build (PR #2). The v0.2.0 musl binary's warm build
      of the blog was 2.4x slower than glibc's (0.73 s against 0.30 s); with mimalloc it matches
      glibc. Cold builds gained about 6% (one run each), and peak memory went from 368 MB to
      700 MB.
- [x] An install script: dist's `ssqch-installer.sh`, attached to each release. Its URL pins the
      version, it checks the archive's checksum, and `SSQCH_UNMANAGED_INSTALL=<dir>` installs
      into that directory without touching shell profiles:
      `curl -fsSL https://github.com/reverentgeek/sitesquatch/releases/download/v0.2.0/ssqch-installer.sh | SSQCH_UNMANAGED_INSTALL=.cache/bin sh`.
- [x] Check a cold build of the blog fits Netlify's build timeout. The first Netlify build
      (deploy `6af12456`, ssqch 0.2.1) took 259 s; a warm one takes 18 s. On a 4-core GitHub
      runner a cold build takes about 4m 45s (PR #2's benchmark).
- [x] **Blog:** builds on Netlify from `netlify.toml`, installing the pinned release. Its
      GitHub Actions deploy and `scripts/build-native.sh` are deleted.
- Note: if a benchmark is needed again, don't compile in it: trigger on `workflow_run` of the
      Release workflow, download its PR artifact (the musl binary that would ship), and compare
      it with the latest release from its installer. No glibc reference build. Use a stratified
      sample of the blog's source images (about 80–100, matching the mix of formats and sizes),
      run 5–10 cold builds per binary interleaved (A, B, A, B, ...), and report the median and
      spread, plus CPU time. PR #2's `bench-allocator.yml` is the starting point (it's in that
      PR's history).
- [x] Document the Netlify recipe in the README ("Deploying"), using the blog's `netlify.toml`
      as the example. It replaces the old GitHub Actions description.

### Versioning

Settle this before the first tag, since the release workflow keys off it.

- [x] Semver from 0.x, with a `CHANGELOG.md` whose **Breaking** sections say what a site has to
      change. Removing Eleventy is the first entry.
- [x] Release by bumping `[workspace.package] version` (still `0.1.0`) and tagging to match; the
      steps are in `AGENTS.md`. `ssqch --version` and the template global's `version` already
      report the workspace version.
- [x] The release workflow fails if the tag doesn't match a package version (`dist` checks).

### CI

- [x] A test workflow on pushes and pull requests (`.github/workflows/ci.yml`): `cargo test`
      with and without AVIF on Linux and macOS, and clippy with `-D warnings`. Windows isn't
      tested yet; add it with the Windows release build.
- [ ] Optionally build the blog and compare it against a known-good output, as a regression
      test.

### Release builds

- [x] Try [`dist`](https://opensource.axo.dev/cargo-dist/) (formerly cargo-dist) before
      writing the workflow by hand. It generates the tag-triggered workflow, per-platform
      archives, checksums, a `curl | sh` installer, a Homebrew formula pushed to a tap, an npm
      wrapper package and `cargo binstall` metadata. It also handles feature flags and system
      packages like nasm (`[dist.dependencies]`). That covers most of this section and
      "Installing" below, including "Netlify first".
- [x] A GitHub Actions release workflow that runs on a version tag (`v0.2.0`) and publishes
      `ssqch` to a GitHub release: done with `dist`. It waits for CI to pass on the tagged
      commit before building (`.github/workflows/check-ci.yml`, a dist `plan-jobs` job).
- [x] Build for the common platforms: Linux x86_64 (static musl), macOS arm64 and x86_64, and
      Windows x86_64, each on its native runner, with nasm from apt, Homebrew or Chocolatey
      (`.github/build-setup.yml` puts Chocolatey's on PATH). Each binary is smoke-tested on its
      own platform before publishing. Released in 0.2.6.
- [ ] Linux aarch64 (static musl), when someone needs it.
- [x] Ship AVIF support in the release builds (`features = ["avif"]` in `crates/ssqch/Cargo.toml`;
      dist installs `nasm` from apt). ARM builds won't need nasm.
- [x] Smoke-test the Linux binary before publishing (`.github/workflows/smoke-test.yml`, run by
      dist through `global-artifacts-jobs`): static linking, `ssqch --version`, and a small site
      with AVIF and WebP output. Extend it when more platforms ship.
- [x] Put `LICENSE` and `README.md` in each archive (and `CHANGELOG.md`; dist does this).
- [x] Publish a SHA-256 checksum file alongside the archives, so installs can be verified.
- [x] Add build provenance (`github-attestations = true` in `dist-workspace.toml`).
- [x] macOS Gatekeeper: the macOS binaries are signed (dist, hardened runtime) and notarized
      (`.github/workflows/notarize.yml`, Apple ID), and a check confirms Gatekeeper accepts a
      browser-downloaded binary as `Notarized Developer ID`. Verified on the PR, 2026-11-09.
- [x] Release only `ssqch`, not the `reverentgeek` example binary (`dist = false` in its
      `Cargo.toml`).

### Installing

Order matters here: the install script comes first because the Netlify recipe and the Action
reuse it, and crates.io comes before `cargo binstall`.

- [x] Publish the crates to crates.io (`cargo install ssqch`), from 0.2.6. Each release runs
      `cargo publish --workspace` after the tag (see `AGENTS.md`).
- [x] Support `cargo binstall ssqch`: `[package.metadata.binstall]` in `crates/ssqch/Cargo.toml`
      points at the release archives (the Windows zip has no folder inside). It takes effect from
      the first release published with it; check `cargo binstall ssqch` then.
- [x] A Homebrew tap (`brew install reverentgeek/tap/ssqch`): dist's `homebrew` installer
      writes the formula, and its publish job pushes it to `reverentgeek/homebrew-tap` with the
      `HOMEBREW_TAP_TOKEN` secret. First published with the next release.
- [ ] Consider an npm package that downloads the matching binary (like esbuild's platform
      packages), so a site with a `package.json` can pin ssqch as a dev dependency and run
      `npx ssqch build`. That would also make a Netlify build pick up ssqch from `pnpm install`,
      with no install script.

### Using it in CI

- [x] A GitHub Action (`reverentgeek/setup-ssqch`, a separate repository) that installs a pinned
      version (or the latest) on Linux, macOS and Windows runners, checking the archive's
      checksum and using the tool cache. The blog doesn't need it (it builds on Netlify).

### Getting started

- [x] Rewrite the README's "Try it" around installing a prebuilt binary and `ssqch init`: the
      README leads with Install and "Build your first site" (`ssqch init`), and building the
      blog moved to "Working on SiteSquatch".
- [x] `ssqch init [dir]`: scaffolds a starter site (config, layout, home page, a post with
      directory data, `_data/site.json`, `ssqch.d.ts`, `jsconfig.json`, `.gitignore`), keeping
      existing files. A test builds what it writes. Released in 0.2.7.
- [ ] Possible design changes:
  - Done: clearer, documented data-cascade rules (README, "Where a value comes from", and
    `ssqch inspect`).
  - An image API that names its output formats explicitly, instead of an `auto` setting.
