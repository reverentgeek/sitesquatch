import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUTPUT_LIST } from "../build.ts";
import { lastSiting } from "./sighting.ts";

test("the last build is the last siting", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-sighting-"));
	try {
		fs.mkdirSync(path.join(dir, ".cache/ssqch"), { recursive: true });
		fs.mkdirSync(path.join(dir, "dist/about"), { recursive: true });
		assert.equal(lastSiting(dir, Date.now()), "No confirmed sitings here yet. `ssqch build` would be the first.");
		fs.writeFileSync(path.join(dir, "dist/index.html"), "home");
		fs.writeFileSync(path.join(dir, "dist/about/index.html"), "about");
		fs.writeFileSync(path.join(dir, OUTPUT_LIST), JSON.stringify({ output: "dist", files: ["index.html", "about/index.html", "site.css"], pages: ["index.html", "about/index.html"] }));
		const built = fs.statSync(path.join(dir, "dist/about/index.html")).mtimeMs;
		const later = (seconds: number) => lastSiting(dir, built + seconds * 1000);
		assert.equal(later(5), "Last confirmed siting: 2 pages in dist/, just now.");
		assert.equal(later(60), "Last confirmed siting: 2 pages in dist/, 1 minute ago.");
		assert.equal(later(12 * 60), "Last confirmed siting: 2 pages in dist/, 12 minutes ago.");
		assert.equal(later(3 * 3600), "Last confirmed siting: 2 pages in dist/, 3 hours ago.");
		assert.equal(later(2 * 86400), "Last confirmed siting: 2 pages in dist/, 2 days ago.");
		// A list from an older ssqch has no `pages`.
		fs.writeFileSync(path.join(dir, OUTPUT_LIST), JSON.stringify({ output: "dist", files: ["index.html", "site.css"] }));
		assert.equal(later(5), "Last confirmed siting: 1 page in dist/, just now.");
		// A list that's JSON but not one: nothing sighted, as in 0.7.
		for (const odd of ["null", "[]", "\"dist\"", "3"]) {
			fs.writeFileSync(path.join(dir, OUTPUT_LIST), odd);
			assert.equal(later(5), "No confirmed sitings here yet. `ssqch build` would be the first.", odd);
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
