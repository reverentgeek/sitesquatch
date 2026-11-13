# ssqch

[SiteSquatch](https://github.com/reverentgeek/sitesquatch) is a fast static site generator, written in Rust and configured with JavaScript (`ssqch.config.js`). This package installs the prebuilt `ssqch` binary for your platform, so a site can pin it as a dev dependency:

```sh
npm install --save-dev ssqch
npx ssqch build
```

Or with pnpm (`pnpm add -D ssqch`, `pnpm ssqch build`) or yarn. In `package.json` scripts, call it by name: `"build": "ssqch build"`.

The binary comes from an optional dependency for your platform (`@ssqch/darwin-arm64`, `@ssqch/darwin-x64`, `@ssqch/linux-x64` or `@ssqch/win32-x64`). Installing runs no scripts and downloads nothing beyond the packages. The Linux binary is statically linked, so it runs on any distribution, Alpine included. On other platforms, install from source with `cargo install ssqch --locked`.

See the [README](https://github.com/reverentgeek/sitesquatch#readme) for everything else, including the other ways to install it.
