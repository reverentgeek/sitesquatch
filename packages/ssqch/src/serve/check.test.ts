import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareOutputs, verdict } from "./check.ts";

function folder(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-check-"));
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	}
	return dir;
}

test("a rebuild that wrote what a clean build writes is the same, file for file", () => {
	const served = folder({ "index.html": "camp", "posts/hike/index.html": "cedar" });
	const clean = folder({ "index.html": "camp", "posts/hike/index.html": "cedar" });
	const c = compareOutputs(served, clean, false);
	assert.deepEqual(c, { differ: [], onlyClean: [], onlyServed: [], tools: [], same: 2 });
	assert.equal(verdict(c, "src/index.md", "dist"), "check-rebuilds: the rebuild after src/index.md wrote what a clean build writes (2 files the same)");
});

test("what differs, and what only one side has, is named, three of each at most", () => {
	const served = folder({ "a.html": "1", "b.html": "1", "c.html": "1", "d.html": "1", "old/index.html": "gone", "app.css": "tool" });
	const clean = folder({ "a.html": "2", "b.html": "2", "c.html": "2", "d.html": "2", "new/index.html": "here" });
	const c = compareOutputs(served, clean, false);
	assert.deepEqual(c.differ, ["a.html", "b.html", "c.html", "d.html"]);
	assert.deepEqual(c.onlyClean, ["new/index.html"]);
	assert.deepEqual(c.onlyServed, ["app.css", "old/index.html"]);
	assert.match(verdict(c, "src/a.md", "dist"), /isn't what a clean build writes: 4 differ \(a\.html, b\.html, c\.html and 1 more\); 1 only in the clean build \(new\/index\.html\); 2 only in dist \(app\.css, old\/index\.html\)\./);
});

test("with serve.run's tools, a stylesheet or script only the served output has is theirs", () => {
	const served = folder({ "index.html": "camp", "assets/app.css": "body {}", "assets/app.js": "", "stale.html": "old" });
	const clean = folder({ "index.html": "camp" });
	const c = compareOutputs(served, clean, true);
	assert.deepEqual(c.tools, ["assets/app.css", "assets/app.js"]);
	assert.deepEqual(c.onlyServed, ["stale.html"]);
	assert.match(verdict(c, "src/index.md", "dist"), /1 only in dist \(stale\.html\); left out 2 stylesheets or scripts only serve\.run's tools wrote\./);
});
