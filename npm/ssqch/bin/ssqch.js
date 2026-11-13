#!/usr/bin/env node
// Runs the ssqch binary from the platform package that npm, pnpm or yarn
// installed next to this one (`@ssqch/<platform>-<arch>`, an optional
// dependency limited to its `os` and `cpu`, so only the matching one installs).
"use strict";

const { spawn } = require("node:child_process");
const platforms = require("../platforms.json");

const key = `${process.platform}-${process.arch}`;
const exe = process.platform === "win32" ? "ssqch.exe" : "ssqch";

function fail(message) {
  process.stderr.write(`ssqch: ${message}\n`);
  process.exit(1);
}

function findBinary() {
  if (!platforms[key]) {
    fail(`no prebuilt binary for ${key}. The npm package covers ${Object.keys(platforms).join(", ")}. Build it from source with \`cargo install ssqch --locked\`; see https://github.com/reverentgeek/sitesquatch#install`);
  }
  const pkg = `@ssqch/${key}`;
  try {
    return require.resolve(`${pkg}/bin/${exe}`);
  } catch {
    const { version } = require("../package.json");
    fail(`${pkg} isn't installed, so there's no binary to run. It's an optional dependency of ssqch, and npm skips one it can't download: check that ${pkg}@${version} is on the registry, and reinstall without \`--no-optional\` or \`--omit=optional\` (with a lockfile made on another platform, run the install again here). Tracks lead here, but nobody's home.`);
  }
}

const binary = findBinary();
const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });

// A terminal's Ctrl-C reaches both processes, but a process manager (concurrently,
// a container, CI) signals only this one: pass it on, so `ssqch serve` stops too.
const forwarded = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of forwarded) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => fail(`couldn't run ${binary}: ${error.message}`));
child.on("exit", (code, signal) => {
  if (signal) {
    // Exit the way the binary did.
    for (const s of forwarded) process.removeAllListeners(s);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
