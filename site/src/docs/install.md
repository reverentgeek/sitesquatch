---
title: "Gear up: install"
description: "You'll need Node.js 22.18 or newer."
---
<img align="right" src="../../../docs/assets/stickers/backpack.svg" alt="" width="96">

You'll need [Node.js](https://nodejs.org) 22.18 or newer. In a site with a `package.json`, add ssqch as a dev dependency, so the lockfile pins the version you built with:

```sh
npm install --save-dev ssqch
```

(Or `pnpm add -D ssqch`, or `yarn add -D ssqch`.) Then run `npx ssqch build`, or `ssqch build` from a `package.json` script.

A site whose `.npmrc` holds new releases back (`min-release-age=2`, a supply-chain cooldown) gets a new ssqch that many days after it's published, and until then npm says `ETARGET No matching version found for ssqch@<version> with a date before ...`: install the version before it, or wait. `ignore-scripts=true` is fine: ssqch runs no install script, and sharp, its one dependency, comes with its binaries prebuilt.

To have `ssqch` everywhere instead, install it globally with `npm install --global ssqch`, or with [Homebrew](https://brew.sh) on macOS or Linux: `brew install reverentgeek/tap/ssqch` (it brings Node along if you don't have it).

Confirm the sighting:

```sh
ssqch --version
```

**pnpm's release age:** pnpm 11 and newer hold a version back for a day after it's published (`minimumReleaseAge`). If `pnpm add -D ssqch` fails on a release day, or installs the version before, list `ssqch` under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.

For Tab completion of commands and options, `ssqch completions zsh` (or `bash`, `fish`, `powershell`, `elvish`) prints a script for your shell, and `ssqch completions --help` says where each shell wants it.
