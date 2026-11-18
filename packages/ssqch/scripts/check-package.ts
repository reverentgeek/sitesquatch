// Checks ssqch the way a site gets it: the npm package installed from its tarball. It's the
// release candidate's test, run by CI and by the release workflow before anything is published.
//
//   node scripts/check-package.ts                    builds the package, packs it, installs it, checks it
//   node scripts/check-package.ts --tarball <tgz>    installs that tarball and checks it
//   --oracle                                         also runs the oracle (tests/oracle) with it
//   --keep                                           keeps the temporary folder, and says where
//
// Everything runs in a temporary folder outside the repository, with copies of the sites, so
// nothing can come from the checkout by accident. What it checks:
//
// - `ssqch --version` is packages/ssqch/package.json's version;
// - every site in examples/sites/ builds, to the bytes the source (`node bin/ssqch.ts`) builds;
// - `ssqch init` makes the starter, and it builds;
// - a site with images (sharp), highlighted Markdown, minify, Sass and the example Rust plugin
//   builds to the source's bytes, so ssqch's own .wasm files and a plugin's run the same;
// - Node finds every module in its `exports` map, and the types beside it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.dirname(here);
const REPO = path.resolve(PACKAGE, "../..");
const SOURCE_BIN = path.join(PACKAGE, "bin/ssqch.ts");
const windows = process.platform === "win32";

const { values } = parseArgs({ options: { tarball: { type: "string" }, oracle: { type: "boolean" }, keep: { type: "boolean" } } });
const version: string = JSON.parse(fs.readFileSync(path.join(PACKAGE, "package.json"), "utf8")).version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-check-"));
let failures = 0;

function run(command: string, args: string[], options: { cwd?: string } = {}): { ok: boolean; out: string } {
	// npm is a .cmd file on Windows, which only a shell runs.
	const shell = windows && command === "npm";
	const r = spawnSync(shell ? `npm ${args.map((a) => `"${a}"`).join(" ")}` : command, shell ? [] : args, { cwd: options.cwd ?? work, encoding: "utf8", shell, env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 1 << 28 });
	if (r.error) throw r.error;
	return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function check(name: string, fn: () => void): void {
	const started = performance.now();
	try {
		fn();
		console.log(`ok    ${name} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
	} catch (e) {
		failures++;
		console.log(`FAIL  ${name}\n${String(e instanceof Error ? e.message : e).replace(/^/gm, "      ")}`);
	}
}

let tarball = values.tarball && path.resolve(values.tarball);
if (!tarball) {
	const { buildPackage } = await import("./build.ts");
	const out = path.join(work, "package");
	await buildPackage({ out, quiet: true });
	const packed = run("npm", ["pack", "--silent", "--pack-destination", work, out]);
	if (!packed.ok) throw new Error(`npm pack failed:\n${packed.out}`);
	tarball = path.join(work, packed.out.trim().split("\n").pop()!.trim());
}
const tarballSize = fs.statSync(tarball).size;
const installed = path.join(work, "site");
fs.mkdirSync(installed);
fs.writeFileSync(path.join(installed, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
const install = run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", tarball], { cwd: installed });
if (!install.ok) throw new Error(`npm install ${tarball} failed:\n${install.out}`);
const modules = path.join(installed, "node_modules");
const packages = fs.readdirSync(modules).filter((n) => !n.startsWith(".")).flatMap((n) => (n.startsWith("@") ? fs.readdirSync(path.join(modules, n)).map((m) => `${n}/${m}`) : [n]));
console.log(`Installed ${path.basename(tarball)} (${(tarballSize / 1e6).toFixed(2)} MB): ${packages.length} packages, ${(sizeOf(path.join(modules, "ssqch")) / 1e6).toFixed(1)} MB for ssqch and ${(sizeOf(modules) / 1e6).toFixed(1)} MB in all (${packages.join(", ")})`);
/** The ssqch under test: the installed package's bin. */
const bin = path.join(modules, "ssqch/bin/ssqch.js");

const ssqch = (args: string[], cwd = work) => run(process.execPath, [bin, ...args], { cwd });
const source = (args: string[], cwd = work) => run(process.execPath, [SOURCE_BIN, ...args], { cwd });

check(`ssqch --version is ${version}`, () => {
	const r = ssqch(["--version"]);
	if (!r.ok || r.out.trim() !== `ssqch ${version}`) throw new Error(`said: ${r.out.trim()}`);
});

/** Copies `from` to `name` twice, builds one copy with the candidate and one from source, and compares their output. */
function sameAsSource(name: string, from: string, output = "dist"): void {
	const mine = path.join(work, "candidate", name);
	const theirs = path.join(work, "source", name);
	for (const dir of [mine, theirs]) fs.cpSync(from, dir, { recursive: true, preserveTimestamps: true, filter: (f) => !/[\\/](dist|\.cache|node_modules)$/.test(f) });
	const built = ssqch(["build", "--quiet", "--root", mine]);
	if (!built.ok) throw new Error(`ssqch build failed:\n${built.out}`);
	const reference = source(["build", "--quiet", "--root", theirs]);
	if (!reference.ok) throw new Error(`the source's build failed:\n${reference.out}`);
	const a = tree(path.join(mine, output));
	const b = tree(path.join(theirs, output));
	if (a.size === 0) throw new Error(`nothing in ${output}/`);
	const differ = [...new Set([...a.keys(), ...b.keys()])].sort().filter((rel) => !a.get(rel)?.equals(b.get(rel) ?? Buffer.alloc(0)) || !b.has(rel));
	if (differ.length) throw new Error(`${differ.length} of ${b.size} files differ from the source's build: ${differ.slice(0, 8).join(", ")}${differ.length > 8 ? ", ..." : ""}`);
}

for (const site of fs.readdirSync(path.join(REPO, "examples/sites")).sort()) {
	const dir = path.join(REPO, "examples/sites", site);
	if (!fs.existsSync(path.join(dir, "ssqch.config.js"))) continue;
	check(`examples/sites/${site} builds as from source`, () => sameAsSource(site, dir));
}

check("ssqch init makes a starter that builds", () => {
	const dir = path.join(work, "starter");
	const made = ssqch(["init", "--quiet", dir]);
	if (!made.ok) throw new Error(`ssqch init failed:\n${made.out}`);
	const built = ssqch(["build", "--quiet", "--root", dir]);
	if (!built.ok) throw new Error(`ssqch build failed:\n${built.out}`);
	if (!fs.existsSync(path.join(dir, "dist/index.html"))) throw new Error("no dist/index.html");
});

check("images, Markdown, minify, Sass and a Rust plugin build as from source", () => {
	const dir = path.join(work, "smoke-site");
	fs.mkdirSync(path.join(dir, "src/img"), { recursive: true });
	fs.mkdirSync(path.join(dir, "src/scss"), { recursive: true });
	fs.mkdirSync(path.join(dir, "plugins/trail-guide"), { recursive: true });
	fs.copyFileSync(path.join(REPO, "tests/oracle/fixtures/cli/squatch.png"), path.join(dir, "src/img/squatch.png"));
	for (const file of ["index.js", "trail_guide.wasm"]) fs.copyFileSync(path.join(REPO, "examples/rust-plugin", file), path.join(dir, "plugins/trail-guide", file));
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), [
		`import { defineConfig } from "ssqch";`,
		`import { imagePlugin } from "ssqch/image";`,
		`import { minifyPlugin } from "ssqch/minify";`,
		`import { sassPlugin } from "ssqch/sass";`,
		`import trailGuide from "./plugins/trail-guide/index.js";`,
		`export default defineConfig({`,
		`\tdirs: { input: "src", output: "dist" },`,
		`\ttemplateFormats: ["jinja", "md", "trail"],`,
		`\tfilters: { shout: (s) => s.toUpperCase() },`,
		`\tplugins: [imagePlugin({ formats: ["avif", "webp", "auto"], widths: [16, 32] }), minifyPlugin(), sassPlugin({ files: { "src/scss": "/css" } }), trailGuide({ greeting: "Howdy" })],`,
		`});`,
		"",
	].join("\n"));
	fs.writeFileSync(path.join(dir, "src/index.jinja"), `---\ntitle: smoke test\n---\n<h1>{{ shout(title) }}</h1>\n<p>{{ greet("Sasquatch") }}</p>\n<img src="/img/squatch.png" alt="Squatch">\n`);
	fs.writeFileSync(path.join(dir, "src/notes.md"), "---\ntitle: Field notes\n---\n# Field notes\n\nTracks by the *Cedar Trail*.\n\n```js\nconst pineCones = 3;\n```\n");
	fs.writeFileSync(path.join(dir, "src/cedar.trail"), "---\ntitle: Cedar Trail\n---\n0.0 Ranger station\n1.2 Old Growth junction | Fork left.\n");
	fs.writeFileSync(path.join(dir, "src/scss/site.scss"), "$pine: #233b2b;\nbody { color: $pine; h1 { font-weight: bold; } }\n");
	sameAsSource("smoke-site", dir);
	const html = fs.readFileSync(path.join(work, "candidate/smoke-site/dist/index.html"), "utf8");
	for (const want of ["<h1>SMOKE TEST</h1>", "<picture>", "Howdy, Sasquatch"]) if (!html.includes(want)) throw new Error(`dist/index.html has no ${want}:\n${html}`);
	const img = fs.readdirSync(path.join(work, "candidate/smoke-site/dist/img"));
	for (const ext of [".avif", ".webp"]) if (!img.some((f) => f.endsWith(ext))) throw new Error(`no ${ext} in dist/img: ${img.join(", ")}`);
	if (!fs.existsSync(path.join(work, "candidate/smoke-site/dist/css/site.css"))) throw new Error("no dist/css/site.css");
});

check("Node finds every module in the exports map, and its types", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(installed, "node_modules/ssqch/package.json"), "utf8"));
	const names = Object.keys(pkg.exports).filter((k) => k !== "./package.json").map((k) => (k === "." ? "ssqch" : `ssqch/${k.slice(2)}`));
	const script = `for (const name of ${JSON.stringify(names)}) { await import(name); import.meta.resolve(name); }\nconst fs = await import("node:fs");\nfor (const entry of Object.values(${JSON.stringify(pkg.exports)})) if (entry.types && !fs.existsSync(new URL("./node_modules/ssqch/" + entry.types, ${JSON.stringify(pathToFileURL(installed + path.sep).href)}))) throw new Error("no " + entry.types);\nconsole.log("ok");`;
	fs.writeFileSync(path.join(installed, "exports-check.mjs"), script);
	const r = run(process.execPath, ["exports-check.mjs"], { cwd: installed });
	if (!r.ok) throw new Error(r.out);
});

if (values.oracle) {
	// The whole oracle, with this ssqch.
	console.log("The oracle, with this ssqch:");
	const r = spawnSync(process.execPath, ["--test", "--test-concurrency=4", "--test-reporter=dot"], { cwd: path.join(REPO, "tests/oracle"), stdio: "inherit", env: { ...process.env, SSQCH_BIN: bin, SSQCH_EXPECT_VERSION: version } });
	if (r.status !== 0) failures++;
}

if (values.keep) console.log(`Kept ${work}`);
else fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
console.log(failures ? `${failures} check${failures === 1 ? "" : "s"} failed` : "Every check passed");
process.exit(failures ? 1 : 0);

function tree(dir: string): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue;
		const full = path.join(entry.parentPath, entry.name);
		out.set(path.relative(dir, full).split(path.sep).join("/"), fs.readFileSync(full));
	}
	return out;
}

function sizeOf(dir: string): number {
	let bytes = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (entry.isFile()) bytes += fs.statSync(path.join(entry.parentPath, entry.name)).size;
	return bytes;
}
