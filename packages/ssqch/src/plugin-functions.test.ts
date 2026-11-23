// PLUGIN_FUNCTIONS is every template function a plugin registers: the list `ssqch docs` prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_FUNCTIONS } from "./filters.ts";

const ALIASES = ["rssDate", "rssLastUpdatedDate"];

test("the plugins' template functions are the ones listed", () => {
	const registered = new Set<string>();
	for (const file of ["image/processor.ts", ...fs.readdirSync(path.join(import.meta.dirname, "modules")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `modules/${f}`)]) {
		const source = fs.readFileSync(path.join(import.meta.dirname, file), "utf8");
		for (const m of source.matchAll(/filters\.set\("([^"]+)"/g)) registered.add(m[1]);
	}
	const listed = PLUGIN_FUNCTIONS.flatMap(([, names]) => names);
	assert.deepEqual([...listed, ...ALIASES].sort(), [...registered].sort());
});
