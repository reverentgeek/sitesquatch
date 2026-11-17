// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ssqch, project, write } from "../lib/ssqch.js";

test("footprint_weighs_a_build", () => {
	const dir = project({
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: [{ \"src/big.bin\": \"big.bin\" }] };\n",
		"src/index.html": "<p>camp</p>",
		"src/big.bin": Buffer.alloc(5000),
	}, "footprint");
	const d = dir;
	// Before a build: nothing to weigh.
	let r = ssqch(["footprint", "--root", d]);
	assert.ok(!r.ok && r.log.includes("isn't a folder; build the site first"), r.log);
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	// The site's output folder, from its config.
	r = ssqch(["footprint", "--root", d]);
	assert.ok(r.ok && r.stdout.startsWith("Footprint of dist: 2 files, 5.01 KB\n") && r.stdout.includes("\nLargest footprints: other files\n  5.00 KB  /big.bin\n"), r.stdout);
	// Any folder, as JSON, without a config.
	r = ssqch(["footprint", path.join(dir, "dist"), "--format", "json", "--top", "0"]);
	let json;
	try { json = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.ok(r.ok && json.files === 2 && json.kinds[0].kind === "Pages" && Array.isArray(json.largest.pages) && json.largest.pages.length === 0, r.stdout);

	// Budgets: a file over its kind's budget is a warning after the build.
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: [{ \"src/big.bin\": \"big.bin\" }], budgets: { other: \"4 KB\", pages: 1000 } };\n" });
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes("warn: /big.bin (5.00 KB) is over the other budget of 4.00 KB\n") && !r.log.includes("pages budget"), r.log);
	r = ssqch(["build", "--root", d, "--format", "json"]);
	assert.ok(r.stdout.includes("\"code\": \"over-budget\""), r.stdout);
	write(dir, { "ssqch.config.js": "export default { budgets: { page: \"100 KB\" } };\n" });
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("budgets.page isn't a kind of file (did you mean `pages`?)"), r.log);
});
