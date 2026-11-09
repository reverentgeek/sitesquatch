# TODO

The ReverentGeek blog (`../blog`) is the main real-world site. Its own tasks are in
`../blog/TODO.md`. Items here that the blog is waiting on say **Blog:**, and blog items that need
a change here say **Needs ssqch:**. When one side finishes, tick it and update the other list.

The order of work:

1. ~~**Remove Eleventy**, and convert the blog to a native `ssqch.config.js`.~~ Done (below).
2. **A Linux x86_64 release and an install script**, the smallest part of "Prebuilt binaries"
   that lets the blog go back to Netlify builds.
3. **The blog's other requests** (fingerprinting, color profiles, link checking).
4. **The rest of the release and adoption work.**

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
- [ ] **Blog:** pin `SSQCH_REF` in its deploy workflow to the commit that adds `defineConfig`,
      once it's pushed. Push this repository first: the blog's deploy builds ssqch from it.
- [ ] Type definitions for `defineConfig` and the `ssqch/*` modules (a `.d.ts`), for editor
      hints. They'd ship in the npm package, if there is one.

## What else the blog is waiting on

- [ ] **Asset fingerprinting in `ssqch`.** Today only the Rust port fingerprints CSS and JS
      (`examples/reverentgeek/src/assets.rs`). Move it into `ssqch` as a built-in that's
      configured from `ssqch.config.js`: which files to hash, and a global with the hashed URLs
      (like the blog's `{{ assets.css }}`). Adding `node:crypto` (`createHash`) for user code is
      a separate, smaller item. `modules.rs` provides `fs`, `fs/promises`, `path`, `path/posix`,
      `url`, `process` and `buffer` today.
      **Blog:** replaces `scripts/hash-assets.js`, `.asset-manifest.json` and `_data/assets.js`.
- [ ] **Color profiles in the image plugin.** It drops ICC profiles without converting colors, so
      Display P3 photos come out washed out (the blog has 40). Read the profile from the decoder
      (`ImageDecoder::icc_profile` in `image` 0.25) and convert to sRGB before encoding. `moxcms`
      is pure Rust; `lcms2` would add another C dependency to the cross-compiles. Check PNGs too.
      **Blog:** the sharp `transform` workaround is gone with the Eleventy packages, so until
      this lands, those photos stay slightly washed out (or the source files get converted
      once).
- [ ] **A built-in link checker.** ssqch has every output page and URL, so check internal links
      and anchors after the build, and fail a production build on a broken one. External links
      can stay with an outside tool like `lychee`.
      **Blog:** it had a broken-links plugin in development before the move to ssqch.
- [ ] **Check `serve` against the blog.** It starts and serves pages with the native config;
      live reload of template and CSS edits hasn't been checked yet.
- [ ] Output differences found comparing against the blog's old build: none have to match
      anymore, so just fix the ones that are wrong:
  - Markdown leaves `"` unescaped in text. Escaping it is the safer default.
  - The minifier doesn't rewrite attribute values (`defer="defer"`, spaces in the viewport
    `content`). Add the rewrites that shrink output.
  - `feed.xml` keeps `<br />` and `<img ... />` as written. That's fine.

## Prebuilt binaries and easier adoption

Goal: anyone can use `ssqch` without installing Rust or compiling it, and can start a new site
in a couple of minutes.

### Netlify first

The smallest part of this section that lets the blog go back to Netlify building the site
itself (**Blog:** "Step 2" in `../blog/TODO.md`):

- [x] A release workflow (`dist`, see `dist-workspace.toml`) that builds Linux x86_64 with AVIF
      as a musl static binary, with SHA-256 checksums and build attestations. Pull requests run
      the same build without publishing. The other platforms can follow in later releases.
- [ ] See the release build pass on a pull request (it hasn't run yet), then tag `v0.2.0`.
- [x] An install script: dist's `ssqch-installer.sh`, attached to each release. Its URL pins the
      version, it checks the archive's checksum, and `SSQCH_UNMANAGED_INSTALL=<dir>` installs
      into that directory without touching shell profiles:
      `curl -fsSL https://github.com/reverentgeek/sitesquatch/releases/download/v0.2.0/ssqch-installer.sh | SSQCH_UNMANAGED_INSTALL=.cache/bin sh`.
- [ ] Measure a cold build of the blog (no `dist/img` cache, about 3,200 image derivatives with
      AVIF) on a Netlify-sized machine, and check it fits Netlify's build timeout. If it doesn't,
      lower `avifSpeed` for the first build, or prime the cache once.
- [ ] Document the Netlify recipe: the `netlify.toml` build command, caching `dist/img` and
      `.cache/ssqch` with `netlify-plugin-cache`, and pinning the ssqch version.

### Versioning

Settle this before the first tag, since the release workflow keys off it.

- [x] Semver from 0.x, with a `CHANGELOG.md` whose **Breaking** sections say what a site has to
      change. Removing Eleventy is the first entry.
- [x] Release by bumping `[workspace.package] version` (still `0.1.0`) and tagging to match; the
      steps are in `CLAUDE.md`. `ssqch --version` and the template global's `version` already
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
- [ ] A GitHub Actions release workflow that runs on a version tag (`v0.2.0`) and publishes
      `ssqch` to a GitHub release: done with `dist`, except that it doesn't wait for the test
      workflow. The release steps in `CLAUDE.md` say to wait for CI before tagging.
- [ ] Build for the common platforms: Linux x86_64 and aarch64, macOS arm64 and x86_64, and
      Windows x86_64.
  - Prefer native runners per target (`ubuntu-24.04-arm`, `macos-latest`, `windows-latest`).
    Besides nasm, `libwebp-sys` and `rquickjs-sys` compile C with `cc`, so cross-compiling needs
    a C toolchain for each target. Check that `rquickjs` ships prebuilt bindings for every
    target, or you'll also need bindgen and libclang.
  - Linux: ship musl static builds (or build on the oldest Ubuntu you'll support). A binary
    built on `ubuntu-latest` needs a recent glibc and won't run on older distros or CI images,
    including some Netlify build images.
  - macOS x86_64: Intel runners are being retired, so build `x86_64-apple-darwin` on an arm64
    runner (nasm from Homebrew works there).
- [x] Ship AVIF support in the release builds (`features = ["avif"]` in `crates/ssqch/Cargo.toml`;
      dist installs `nasm` from apt). ARM builds won't need nasm.
- [ ] Smoke-test each built binary in the release job: `ssqch --version`, then a build of a
      small fixture site that includes a JPEG and checks the WebP and AVIF output.
- [x] Put `LICENSE` and `README.md` in each archive (and `CHANGELOG.md`; dist does this).
- [x] Publish a SHA-256 checksum file alongside the archives, so installs can be verified.
- [x] Add build provenance (`github-attestations = true` in `dist-workspace.toml`).
- [ ] macOS Gatekeeper: decide whether to sign and notarize, or document
      `xattr -d com.apple.quarantine ssqch` for browser downloads. The install script and
      Homebrew don't hit the quarantine.
- [x] Release only `ssqch`, not the `reverentgeek` example binary (`dist = false` in its
      `Cargo.toml`).

### Installing

Order matters here: the install script comes first because the Netlify recipe and the Action
reuse it, and crates.io comes before `cargo binstall`.

- [ ] Publish the crates to crates.io (`cargo install ssqch`).
  - Give each path dependency in `[workspace.dependencies]` a `version` too
    (`sitesquatch = { path = "crates/sitesquatch", version = "0.2.0" }`); crates.io rejects
    path-only deps.
  - Publish in dependency order: `sitesquatch-edge`, `sitesquatch`, `sitesquatch-js`, the
    plugins, then `ssqch`.
  - Check that the `sitesquatch*` and `ssqch` names are free on crates.io (and `ssqch` on npm).
- [ ] Support `cargo binstall ssqch`. It finds the repository through the crates.io index, so it
      needs the crates.io publish first. Add `[package.metadata.binstall]` if the archive names
      don't follow its default pattern.
- [ ] A Homebrew tap (`brew install reverentgeek/tap/ssqch`). That needs a separate
      `reverentgeek/homebrew-tap` repository, plus a release job (and a token with access to it)
      that updates the formula.
- [ ] Consider an npm package that downloads the matching binary (like esbuild's platform
      packages), so a site with a `package.json` can pin ssqch as a dev dependency and run
      `npx ssqch build`. That would also make a Netlify build pick up ssqch from `pnpm install`,
      with no install script.

### Using it in CI

- [ ] A GitHub Action (`reverentgeek/setup-ssqch`, a separate repository) that installs a pinned
      version with the install script, for sites that build in GitHub Actions. The blog won't
      need it once it builds on Netlify.

### Getting started

- [ ] Rewrite the README's "Try it" around installing a prebuilt binary and `ssqch init`, rather
      than cloning the blog and running `cargo`.
- [ ] `ssqch init`: scaffold a starter site (an `ssqch.config.js`, a layout, a post, and an
      `_data` file). Decide whether the starter is embedded in the binary or fetched, and add a
      test that the scaffolded site builds.
- [ ] Possible design changes:
  - Clearer, documented data-cascade rules.
  - An image API that names its output formats explicitly, instead of an `auto` setting.
