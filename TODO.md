# TODO

## Prebuilt binaries and easier adoption

Goal: anyone can use `ssqch` without installing Rust or compiling it, and an Eleventy user can try
it on their site in a couple of minutes.

### Release builds

- [ ] Add a GitHub Actions release workflow that runs on a version tag (`v0.2.0`) and publishes
      `ssqch` to a GitHub release.
- [ ] Build for the common platforms: Linux x86_64 and aarch64, macOS arm64 and x86_64, and
      Windows x86_64.
- [ ] Ship AVIF support in the release builds (`--features avif`). On x86_64 the build needs the
      `nasm` assembler installed first (the AVIF encoder uses it); ARM builds don't.
- [ ] Publish a SHA-256 checksum file alongside the archives, so installs can be verified.
- [ ] Decide whether releases also include the `reverentgeek` example binary, or only `ssqch`.
      The blog deploys with the example today; with prebuilt `ssqch` and the blog's
      `.eleventy.js` (via a one-line `ssqch.config.js`), it could use the release instead.

### Installing

- [ ] An install script (`curl -fsSL .../install.sh | sh`) that picks the right archive for the
      platform and checks the checksum.
- [ ] Support `cargo binstall ssqch` (it reads GitHub release assets).
- [ ] A Homebrew tap (`brew install reverentgeek/tap/ssqch`).
- [ ] Consider an npm package that downloads the matching binary (like esbuild's
      platform packages), so Eleventy users can run `npx ssqch build` in an existing project.
- [ ] Publish the crates to crates.io (`cargo install ssqch`).

### Using it in CI

- [ ] A GitHub Action (`reverentgeek/setup-ssqch`) that installs a pinned version, so a deploy
      workflow doesn't have to compile anything. That would cut the blog's first-run compile
      (about 2 minutes) to a few seconds.
- [ ] A documented Netlify recipe: Netlify builds from git by downloading the release binary, so
      there is no expiring deploy token to manage.

### Versioning

- [ ] Pick a versioning policy (semver, starting from 0.x) and keep a `CHANGELOG.md`.
- [ ] Have `ssqch --version` and `{{ eleventy.version }}` report the release version.

### Getting started

- [ ] Rewrite the README's "Try it" around installing a prebuilt binary rather than cloning the
      blog and running `cargo`.
- [ ] `ssqch init`: scaffold a starter site (an `ssqch.config.js`, a layout, a post, and an
      `_data` file).
- [ ] A "Migrating from Eleventy" guide: which config APIs and plugins work unchanged, what the
      compat modules cover, and the known differences (see the README's known gaps).
