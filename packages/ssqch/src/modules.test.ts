// A site's stack frames, as errors show them (crates/sitesquatch-js/src/lib.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importFile, siteFrames } from "./modules.ts";

test("frames_keep_folders_with_parentheses", () => {
	// The system's own paths (a drive letter and `\` on Windows), and a file URL for one of them.
	const root = path.resolve("/camp/paren site (copy)");
	const stack = [
		"Error: the snack drawer is empty",
		`    at boom (${path.join(root, "ssqch.config.js")}:2:27)`,
		`    at ${path.join(root, "lib", "a.js")}:4:1`,
		"    at async Promise.all (index 0)",
		`    at Object.<anonymous> (${pathToFileURL(path.join(root, "b.js")).href}:1:2)`,
	].join("\n");
	assert.deepEqual(siteFrames(stack, root), ["    at boom (ssqch.config.js:2:27)", "    at <anonymous> (lib/a.js:4:1)", "    at <anonymous> (b.js:1:2)"]);
});

test("a file that awaits above its export loads as a module on every Node", async () => {
	// Node 22.18 reads this as CommonJS (`await` is only an identifier there) and fails on the first line.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-esm-"));
	try {
		const file = path.join(dir, "snacks.js");
		fs.writeFileSync(file, "const list = [await Promise.resolve(\"pine cones\")];\nexport default list;\n");
		assert.deepEqual((await importFile(file)).default, ["pine cones"]);
		// On one line, as a one-line data file has it.
		const line = path.join(dir, "line.js");
		fs.writeFileSync(line, "const v = [await Promise.resolve(1)]; export default { v };\n");
		assert.deepEqual((await importFile(line)).default, { v: [1] });
		// A real syntax error stays the file's own.
		fs.writeFileSync(path.join(dir, "bad.js"), "export default [;\n");
		await assert.rejects(importFile(path.join(dir, "bad.js")), SyntaxError);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a file that throws a SyntaxError while it runs runs once", async () => {
	// `JSON.parse` throws a SyntaxError too: the file ran, so it isn't run again as a module (a
	// config's `fetch` or a file it writes would happen twice).
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-esm-once-"));
	const runs = globalThis as { ssqchRuns?: Record<string, number> };
	runs.ssqchRuns = {};
	try {
		const count = (name: string) => `globalThis.ssqchRuns[${JSON.stringify(name)}] = (globalThis.ssqchRuns[${JSON.stringify(name)}] ?? 0) + 1;`;
		const files: Record<string, string> = {
			"esm.js": `${count("esm")}\nexport default JSON.parse("{bad json");\n`,
			"line.js": `${count("line")} export default JSON.parse("{bad json");\n`,
			"awaits.js": `${count("awaits")}\nconst v = [await Promise.resolve(1)];\nexport default JSON.parse("{bad json");\n`,
			"common.js": `${count("common")}\nmodule.exports = JSON.parse("{bad json");\n`,
		};
		for (const [name, text] of Object.entries(files)) {
			fs.writeFileSync(path.join(dir, name), text);
			await assert.rejects(importFile(path.join(dir, name)), (e: unknown) => e instanceof SyntaxError && /JSON/.test(e.message), name);
		}
		assert.deepEqual(runs.ssqchRuns, { esm: 1, line: 1, awaits: 1, common: 1 });
	} finally {
		delete runs.ssqchRuns;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
