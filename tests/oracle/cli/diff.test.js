// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write } from "../lib/ssqch.js";

test("diff_compares_two_builds", () => {
	const dir = tempDir("diff");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	// Runs in the project folder; returns the exit code and the log.
	const run = (args) => {
		const r = ssqch(args, { cwd: dir });
		return [r.code, r.log];
	};
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" } };\n");
	w("src/_includes/layout.edge", "<html><head><title>{{ title }}</title><meta name=\"generator\" content=\"{{ ssqch.generator }}\"></head><body>{{{ content }}}</body></html>");
	w("src/index.md", "---\ntitle: Home\nlayout: layout.edge\n---\n## Trails\n\nPine trail.\n");
	w("src/about.md", "---\ntitle: About\nlayout: layout.edge\n---\nAbout.\n");
	let r = ssqch(["build", "--root", d, "-q", "--output", "before"]);
	assert.ok(r.ok, r.log);
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	let [code, log] = run(["diff", "before", "dist"]);
	assert.equal(code, 0, log);
	assert.ok(log.includes("No differences: 2 pages and 0 other files are the same. The stump has not moved."), log);

	w("src/index.md", "---\ntitle: Home\nlayout: layout.edge\n---\n## Paths\n\nCedar trail.\n");
	w("src/new.md", "---\ntitle: New\nlayout: layout.edge\n---\nNew.\n");
	fs.rmSync(path.join(dir, "src/about.md"));
	r = ssqch(["build", "--root", d, "-q", "--output", "after"]);
	assert.ok(r.ok, r.log);
	[code, log] = run(["diff", "before", "after"]);
	assert.equal(code, 1, log);
	for (const expected of [
		"Added (1)\n  + /new/\n",
		"Removed (1)\n  - /about/\n",
		"  ~ /  (text and markup)\n      ids removed (links to them break): #trails\n      - <h2 id=\"trails\">\n      - Trails\n      + <h2 id=\"paths\">\n      + Paths\n      - Pine trail.\n      + Cedar trail.\n",
		"Changes found: 3 pages (1 changed, 1 added, 1 removed); 0 pages and 0 other files are the same. The stump has moved.\n",
	]) {
		assert.ok(log.includes(expected), `missing ${JSON.stringify(expected)} in\n${log}`);
	}
	[code, log] = run(["diff", "before", "after", "--format", "json", "--only", "index.html"]);
	assert.equal(code, 1, log);
	let json;
	try { json = JSON.parse(log); } catch (e) { assert.fail(`${e.message}: ${log}`); }
	assert.equal(json.schemaVersion, 1);
	assert.deepEqual(json.summary, { added: 0, removed: 0, changed: 1, unchangedPages: 0, unchangedFiles: 0 });
	assert.equal(json.changed[0].url, "/");
	assert.deepEqual(json.changed[0].changes, ["text", "markup"]);

	[code, log] = run(["diff", "before", "after", "--ignore", "(Pine|Cedar) trail\\.|Trails|Paths|trails|paths", "--only", "index.html"]);
	assert.equal(code, 0, log);
	[code, log] = run(["diff", "before", "missing"]);
	assert.equal(code, 2, log);
	assert.ok(log.includes("missing isn't a folder"), log);
	[code, log] = run(["diff", "before", "after", "--ignore", "("]);
	assert.equal(code, 2, log);
	assert.ok(log.includes("--ignore \"(\" isn't a regular expression"), log);
});
