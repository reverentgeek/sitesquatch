// The npm package's build (build.ts): how it rewrites ssqch's source, and that what it builds
// runs and finds the files beside its code. scripts/check-package.ts checks the packed package
// installed the way a site gets it; this is the quick check `node --test` runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildPackage, ownModules, rewriteSource } from "./build.ts";

test("import.meta.url becomes the URL the source file would have in the package", () => {
	const out = rewriteSource(`const WASM = new URL("../../wasm/markdown.wasm", import.meta.url);`, "src/engines/markdown.ts");
	assert.equal(out, `const WASM = new URL("../../wasm/markdown.wasm", new URL("../src/engines/markdown.ts", import.meta.url).href);`);
});

test("a library loaded on first use becomes a require esbuild bundles", () => {
	assert.equal(rewriteSource(`library = createRequire(import.meta.url)("liquidjs");`, "src/engines/liquid.ts"), `library = require("liquidjs");`);
	assert.throws(() => rewriteSource(`const req = createRequire(import.meta.url);\nreq("ejs");`, "src/x.ts"), /src\/x\.ts: createRequire\(import\.meta\.url\) has to be called at once/);
});

test("import.meta.dirname and filename are refused, with what to write", () => {
	assert.throws(() => rewriteSource("const here = import.meta.dirname;", "src/x.ts"), /src\/x\.ts: import\.meta\.dirname can't be rewritten for the package; use fileURLToPath/);
	// Only in code: a comment that names one is fine.
	assert.equal(rewriteSource("// not import.meta.filename\nconst a = 1;", "src/x.ts"), "// not import.meta.filename\nconst a = 1;");
});

test("every module in ssqch.d.ts has its source", () => {
	const specifiers = ownModules().map((m) => m.specifier);
	assert.ok(specifiers.includes("ssqch") && specifiers.includes("ssqch/image") && specifiers.includes("ssqch/sass"), specifiers.join(", "));
});

test("the built package runs, and finds its .wasm, its docs and its starters", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-build-test-"));
	try {
		const out = path.join(dir, "package");
		const built = await buildPackage({ out, quiet: true });
		const manifest = JSON.parse(fs.readFileSync(path.join(out, "package.json"), "utf8"));
		assert.equal(manifest.private, true);
		assert.deepEqual(Object.keys(manifest.dependencies), ["sharp"]);
		assert.equal(manifest.exports["./image"].default, "./lib/image.js");
		for (const file of ["bin/ssqch.js", "lib/cli.js", "lib/ssqch.js", "wasm/markdown.wasm", "bundled/docs/nav.yml", "bundled/docs/install.md", "bundled/docs/trailheads/from-eleventy.md", "src/serve/live.js", "types/index.d.ts"]) assert.ok(fs.existsSync(path.join(out, file)), `no ${file}`);
		// A module has ssqch.d.ts's exports, not its own helpers.
		assert.deepEqual(Object.keys(await import(pathToFileURL(path.join(out, "lib/links.js")).href)), ["linksPlugin"]);

		const ssqch = (...args: string[]) => spawnSync(process.execPath, [path.join(out, "bin/ssqch.js"), ...args], { encoding: "utf8", cwd: dir });
		assert.equal(ssqch("--version").stdout.trim(), `ssqch ${built.version}`);
		assert.match(ssqch("docs", "passthrough").stdout, /passthrough/);
		const site = path.join(dir, "site");
		assert.equal(ssqch("init", "--quiet", site).status, 0);
		fs.writeFileSync(path.join(site, "src/notes.md"), "# Field notes\n\n```js\nconst pineCones = 3;\n```\n");
		const r = ssqch("build", "--quiet", "--root", site);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(fs.readFileSync(path.join(site, "dist/notes/index.html"), "utf8"), /<h1[^>]*>Field notes<\/h1>/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
