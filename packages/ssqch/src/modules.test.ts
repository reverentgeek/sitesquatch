// A site's stack frames, as errors show them (crates/sitesquatch-js/src/lib.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteFrames } from "./modules.ts";

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
