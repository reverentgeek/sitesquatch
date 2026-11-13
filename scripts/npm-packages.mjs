#!/usr/bin/env node
// Builds the npm packages from the release archives: `ssqch` (the wrapper in
// npm/ssqch) and one `@ssqch/<platform>-<arch>` package per binary, which the
// wrapper lists as optional dependencies.
//
//   node scripts/npm-packages.mjs --archives <dir> --out <dir> [--version 0.5.1] [--only linux-x64]
//
// <dir> holds the archives as dist names them (ssqch-<target>.tar.gz, .zip for
// Windows), like the release workflow's artifacts or
// `gh release download v0.5.1 -p 'ssqch-*'`. --version defaults to the
// workspace version in Cargo.toml. --only builds the wrapper and that one
// platform package, for testing on one machine. Each package ends up in
// <out>/<platform> (and <out>/ssqch), ready for `npm publish`.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({
  options: { archives: { type: "string" }, out: { type: "string" }, version: { type: "string" }, only: { type: "string" } },
});
if (!args.archives || !args.out) {
  console.error("usage: node scripts/npm-packages.mjs --archives <dir> --out <dir> [--version <version>] [--only <platform>]");
  process.exit(2);
}

const version = args.version ?? workspaceVersion();
const platforms = JSON.parse(readFileSync(join(root, "npm/ssqch/platforms.json"), "utf8"));
if (args.only && !platforms[args.only]) {
  console.error(`npm-packages: --only ${args.only} isn't a platform in npm/ssqch/platforms.json (${Object.keys(platforms).join(", ")})`);
  process.exit(2);
}
const out = resolve(args.out);
const common = {
  version,
  license: "MIT",
  homepage: "https://github.com/reverentgeek/sitesquatch#readme",
  repository: { type: "git", url: "git+https://github.com/reverentgeek/sitesquatch.git" },
  bugs: "https://github.com/reverentgeek/sitesquatch/issues",
};

rmSync(out, { recursive: true, force: true });
for (const [platform, { target, archive, os, cpu }] of Object.entries(platforms)) {
  if (args.only && platform !== args.only) continue;
  const file = join(resolve(args.archives), `ssqch-${target}.${archive}`);
  if (!existsSync(file)) {
    console.error(`npm-packages: ${file} not found (the ${platform} package needs it)`);
    process.exit(1);
  }
  const exe = os === "win32" ? "ssqch.exe" : "ssqch";
  const dir = join(out, platform);
  mkdirSync(join(dir, "bin"), { recursive: true });
  const binary = join(dir, "bin", exe);
  copyFileSync(extract(file, exe), binary);
  chmodSync(binary, 0o755);
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  writeJson(join(dir, "package.json"), {
    name: `@ssqch/${platform}`,
    description: `The ssqch binary for ${platform}. Install ssqch instead, which picks the right one.`,
    ...common,
    os: [os],
    cpu: [cpu],
    files: ["bin"],
    preferUnplugged: true,
  });
  writeFileSync(join(dir, "README.md"), `# @ssqch/${platform}\n\nThe [SiteSquatch](https://github.com/reverentgeek/sitesquatch) binary for ${platform}. Install [\`ssqch\`](https://www.npmjs.com/package/ssqch) instead: it depends on this package and runs the binary.\n`);
  console.log(`${dir}: @ssqch/${platform}@${version}`);
}

const main = join(out, "ssqch");
cpSync(join(root, "npm/ssqch"), main, { recursive: true });
chmodSync(join(main, "bin/ssqch.js"), 0o755);
copyFileSync(join(root, "LICENSE"), join(main, "LICENSE"));
writeJson(join(main, "package.json"), {
  name: "ssqch",
  description: "SiteSquatch, a fast static site generator configured with JavaScript",
  ...common,
  keywords: ["static site generator", "ssg", "blog", "markdown", "jinja", "liquid"],
  bin: { ssqch: "bin/ssqch.js" },
  files: ["bin", "platforms.json"],
  engines: { node: ">=18" },
  optionalDependencies: Object.fromEntries(Object.keys(platforms).map((p) => [`@ssqch/${p}`, version])),
});
console.log(`${main}: ssqch@${version}`);

function workspaceVersion() {
  const toml = readFileSync(join(root, "Cargo.toml"), "utf8");
  const section = toml.split(/^\[workspace\.package\]$/m)[1]?.split(/^\[/m)[0] ?? "";
  const match = section.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Cargo.toml: no version in [workspace.package]; pass --version");
  return match[1];
}

// Unpacks an archive into a temporary folder and returns the path of `exe` in it.
function extract(file, exe) {
  const tmp = mkdtempSync(join(tmpdir(), "ssqch-npm-"));
  if (file.endsWith(".zip")) execFileSync("unzip", ["-q", file, "-d", tmp]);
  else execFileSync("tar", ["xzf", file, "-C", tmp]);
  const found = find(tmp, exe);
  if (!found) throw new Error(`${file}: no ${exe} in the archive`);
  return found;
}

function find(dir, name) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const found = find(path, name);
      if (found) return found;
    } else if (entry === name) return path;
  }
  return null;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
