// Builds the standalone executable (D7) for the platform it runs on: Node's single executable
// with ssqch's npm package inside it, for Homebrew, the installer scripts and the release
// archives. The Node that runs this is the Node in the executable, so the release workflow runs
// it with a pinned one (Node 25.5 or newer has `--build-sea`).
//
//   node scripts/build-sea.ts                       builds the package, then dist-sea/ssqch
//   node scripts/build-sea.ts --tarball <tgz>       from a packed package (the release's)
//   node scripts/build-sea.ts --out <dir>           somewhere else
//   node scripts/build-sea.ts --sign <identity>     on macOS, signs with a Developer ID for notarizing
//
// The executable's assets are the package as `npm install` lays it out, sharp and its platform's
// native addon included, and `scripts/sea-main.ts` is its entry, which unpacks them on the first
// run and starts ssqch from there (it says why). On macOS the executable is signed again, since
// adding the assets breaks Node's signature: ad hoc by default, which runs on this machine, and
// with `--sign` for a release, with the hardened runtime and the entitlements V8 needs
// (`sea-entitlements.plist`).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.dirname(here);
const windows = process.platform === "win32";

const { values } = parseArgs({ options: { tarball: { type: "string" }, out: { type: "string" }, sign: { type: "string" }, keep: { type: "boolean" } } });
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 25 || (major === 25 && minor < 5)) {
	console.error(`build-sea: Node ${process.versions.node} can't build a single executable; it takes Node 25.5 or newer (--build-sea), and the executable is that Node`);
	process.exit(2);
}
const out = path.resolve(values.out ?? path.join(PACKAGE, "dist-sea"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-sea-"));

function run(command: string, args: string[], cwd = work): string {
	const shell = windows && command === "npm";
	const r = spawnSync(shell ? `npm ${args.map((a) => `"${a}"`).join(" ")}` : command, shell ? [] : args, { cwd, encoding: "utf8", shell, maxBuffer: 1 << 28 });
	if (r.error) throw r.error;
	if (r.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`);
	return `${r.stdout}${r.stderr}`;
}

const started = performance.now();
let tarball = values.tarball && path.resolve(values.tarball);
if (!tarball) {
	const { buildPackage } = await import("./build.ts");
	const pkg = path.join(work, "package");
	await buildPackage({ out: pkg, quiet: true });
	tarball = path.join(work, run("npm", ["pack", "--silent", "--pack-destination", work, pkg]).trim().split("\n").pop()!.trim());
}

// The package as a site gets it: `npm install`, for this platform, with nothing else.
const stage = path.join(work, "stage");
fs.mkdirSync(stage);
fs.writeFileSync(path.join(stage, "package.json"), "{ \"private\": true }\n");
run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", "--omit=dev", "--ignore-scripts", tarball], stage);
const modules = path.join(stage, "node_modules");
const entry = "node_modules/ssqch/bin/ssqch.js";
const version: string = JSON.parse(fs.readFileSync(path.join(modules, "ssqch/package.json"), "utf8")).version;

const assets: Record<string, string> = {};
const hash = crypto.createHash("sha256");
for (const entryInfo of fs.readdirSync(modules, { withFileTypes: true, recursive: true })) {
	if (!entryInfo.isFile()) continue;
	const file = path.join(entryInfo.parentPath, entryInfo.name);
	const key = path.relative(stage, file).split(path.sep).join("/");
	// npm's own records, and the command links: the executable is the command.
	if (key.startsWith("node_modules/.")) continue;
	assets[key] = file;
}
const keys = Object.keys(assets).sort();
for (const key of keys) hash.update(`${key}\0`).update(fs.readFileSync(assets[key])).update("\0");
const id = `${version}-${hash.digest("hex").slice(0, 12)}`;
const unpackJson = path.join(work, "unpack.json");
fs.writeFileSync(unpackJson, `${JSON.stringify({ id, entry })}\n`);

// The entry, as JavaScript: Node runs an executable's entry as it is.
const { transformSync } = await import("esbuild");
const main = path.join(work, "sea-main.mjs");
fs.writeFileSync(main, transformSync(fs.readFileSync(path.join(here, "sea-main.ts"), "utf8"), { loader: "ts", format: "esm", target: `node${major}` }).code);

fs.mkdirSync(out, { recursive: true });
const exe = path.join(out, windows ? "ssqch.exe" : "ssqch");
fs.rmSync(exe, { force: true });
const config = path.join(work, "sea.json");
fs.writeFileSync(config, JSON.stringify({
	main,
	mainFormat: "module",
	output: exe,
	disableExperimentalSEAWarning: true,
	useCodeCache: false,
	assets: { "unpack.json": unpackJson, ...Object.fromEntries(keys.map((key) => [key, assets[key]])) },
}, null, "\t"));
run(process.execPath, ["--build-sea", config]);

if (process.platform === "darwin") {
	const sign = values.sign ?? "-";
	const args = ["--sign", sign, "--force", "--options", "runtime", "--entitlements", path.join(here, "sea-entitlements.plist")];
	if (sign !== "-") args.push("--timestamp");
	run("codesign", [...args, exe]);
	run("codesign", ["--verify", "--strict", exe]);
}

// It runs, and unpacks itself, from a folder of its own.
const unpackDir = path.join(work, "unpack");
const said = spawnSync(exe, ["--version"], { encoding: "utf8", env: { ...process.env, SSQCH_UNPACK_DIR: unpackDir } });
if (said.status !== 0 || said.stdout.trim() !== `ssqch ${version}`) {
	console.error(`build-sea: ${exe} --version said:\n${said.stdout}${said.stderr}`);
	process.exit(1);
}
const unpackedBytes = keys.reduce((sum, key) => sum + fs.statSync(assets[key]).size, 0);
console.log(`Built ${path.relative(process.cwd(), exe) || exe}: ssqch ${version} on Node ${process.versions.node}, ${(fs.statSync(exe).size / 1e6).toFixed(1)} MB (${keys.length} files, ${(unpackedBytes / 1e6).toFixed(1)} MB unpacked, as ${id}), in ${((performance.now() - started) / 1000).toFixed(1)} s`);
if (values.keep) console.log(`Kept ${work}`);
else fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
