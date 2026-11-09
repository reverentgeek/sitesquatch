# TODO

The ReverentGeek blog (`../blog`) is the main real-world site. Its own tasks are in
`../blog/TODO.md`. Items here that the blog is waiting on say **Blog:**, and blog items that need
a change here say **Needs ssqch:**. When one side finishes, tick it and update the other list.

The order of work:

1. ~~**Remove Eleventy**, and convert the blog to a native `ssqch.config.js`.~~ Done (below).
2. ~~**A Linux x86_64 release and an install script**, so the blog can go back to Netlify
   builds.~~ Done: v0.2.1, and the blog builds on Netlify (2026-11-08).
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
- [x] **Blog:** pin the ssqch it builds with. It now installs a pinned release instead
      (`SSQCH_VERSION` in its `netlify.toml`).
- [ ] Type definitions for `defineConfig` and the `ssqch/*` modules (a `.d.ts`), for editor
      hints. They'd ship in the npm package, if there is one.

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
- [ ] macOS Gatekeeper: decide whether to sign and notarize, or document
      `xattr -d com.apple.quarantine ssqch` for browser downloads. The install script and
      Homebrew don't hit the quarantine.
- [x] Release only `ssqch`, not the `reverentgeek` example binary (`dist = false` in its
      `Cargo.toml`).

### Installing

Order matters here: the install script comes first because the Netlify recipe and the Action
reuse it, and crates.io comes before `cargo binstall`.

- [x] Publish the crates to crates.io (`cargo install ssqch`), from 0.2.6. Each release runs
      `cargo publish --workspace` after the tag (see `CLAUDE.md`).
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
      version with the install script, for sites that build in GitHub Actions. The blog doesn't
      need it (it builds on Netlify).

### Getting started

- [ ] Rewrite the README's "Try it" around installing a prebuilt binary and `ssqch init`, rather
      than cloning the blog and running `cargo`.
- [ ] `ssqch init`: scaffold a starter site (an `ssqch.config.js`, a layout, a post, and an
      `_data` file). Decide whether the starter is embedded in the binary or fetched, and add a
      test that the scaffolded site builds.
- [ ] Possible design changes:
  - Clearer, documented data-cascade rules.
  - An image API that names its output formats explicitly, instead of an `auto` setting.
