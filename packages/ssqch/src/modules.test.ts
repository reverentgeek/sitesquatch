// A site's stack frames, as errors show them (crates/sitesquatch-js/src/lib.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importFile, siteFrames } from "./modules.ts";

test("frames_keep_folders_with_parentheses", () => {
	const root = "/camp/paren site (copy)";
	const stack = [
		"Error: the snack drawer is empty",
		"    at boom (/camp/paren site (copy)/ssqch.config.js:2:27)",
		"    at /camp/paren site (copy)/lib/a.js:4:1",
		"    at async Promise.all (index 0)",
		"    at Object.<anonymous> (file:///camp/paren%20site%20(copy)/b.js:1:2)",
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
		// A real syntax error stays the file's own.
		fs.writeFileSync(path.join(dir, "bad.js"), "export default [;\n");
		await assert.rejects(importFile(path.join(dir, "bad.js")), SyntaxError);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
