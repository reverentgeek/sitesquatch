# Changelog

SiteSquatch follows [semantic versioning](https://semver.org). While it's at 0.x, a release that
breaks existing sites bumps the minor version (0.2.0 to 0.3.0), and everything else bumps the
patch version (0.2.0 to 0.2.1). Breaking changes are listed under **Breaking**, with what a site
has to change.

The version is `[workspace.package] version` in `Cargo.toml`, shared by every crate. A release is
a `v<version>` tag on a commit where that version matches.

## Unreleased

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
