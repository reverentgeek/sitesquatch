# Changelog

SiteSquatch follows [semantic versioning](https://semver.org). While it's at 0.x, a release that
breaks existing sites bumps the minor version (0.2.0 to 0.3.0), and everything else bumps the
patch version (0.2.0 to 0.2.1). Breaking changes are listed under **Breaking**, with what a site
has to change.

The version is `[workspace.package] version` in `Cargo.toml`, shared by every crate. A release is
a `v<version>` tag on a commit where that version matches.

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
