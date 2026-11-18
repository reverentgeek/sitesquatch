// From crates/sitesquatch/src/footprint.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSize } from "./budgets.ts";
import { footprintJson, footprintText, measure, overBudget, urlOf } from "./footprint.ts";

test("a_build_is_measured_by_kind", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-footprint-"));
	for (const [file, size] of [["index.html", 300], ["about/index.html", 1200], ["img/a.avif", 5000], ["img/b.webp", 2000], ["assets/app.css", 400], ["feed.xml", 100], ["CNAME", 10], [".DS_Store", 6000]] as const) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), Buffer.alloc(size, 120));
	}
	const footprint = await measure(dir);
	assert.deepEqual([footprint.files, footprint.bytes], [7, 9010]);
	assert.equal(footprintText(footprint, "dist", 2), "Footprint of dist: 7 files, 9.01 KB\n  Pages           2 files  1.50 KB  17%\n  Images          2 files  7.00 KB  78%\n  CSS             1 file     400 B  4%\n  Data and feeds  1 file     100 B  1%\n  Other           1 file      10 B  <1%\n\nLargest footprints: pages\n  1.20 KB  /about/\n    300 B  /\n\nLargest footprints: other files\n  5.00 KB  /img/a.avif\n  2.00 KB  /img/b.webp\n");
	const json = footprintJson(footprint, "dist", 1) as { largest: { pages: unknown[] }; kinds: unknown[] };
	assert.deepEqual(json.largest.pages, [{ path: "about/index.html", bytes: 1200, url: "/about/" }]);
	assert.deepEqual(json.kinds[1], { kind: "Images", files: 2, bytes: 7000 });
	// Budgets: one warning per kind, and the total.
	const budgets: Array<[string, number]> = [["pages", 1000], ["images", parseSize("1 KB")!], ["css", 1000], ["total", parseSize("9 KB")!]];
	assert.deepEqual(overBudget(footprint, budgets).map((d) => d.message), ["/about/ (1.20 KB) is over the pages budget of 1.00 KB", "2 files are over the images budget of 1.00 KB: /img/a.avif (5.00 KB), /img/b.webp (2.00 KB)", "the build is 9.01 KB, over its total budget of 9.00 KB"]);
	assert.deepEqual([parseSize("150 KB"), parseSize("1.5MB"), parseSize("12"), parseSize("lots")], [150_000, 1_500_000, 12, undefined]);
	// An empty folder, and one that isn't there.
	fs.mkdirSync(path.join(dir, "empty"));
	assert.equal(footprintText(await measure(path.join(dir, "empty")), "empty", 5), "Footprint of empty: 0 files, 0 B\nNothing sighted: the folder is empty.\n");
	await assert.rejects(measure(path.join(dir, "nope")), /isn't a folder; build the site first/);
	fs.rmSync(dir, { recursive: true });
});

test("links_are_followed_and_loops_refused", { skip: process.platform === "win32" && "links need privileges on Windows" }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-footprint-"));
	fs.mkdirSync(path.join(dir, "img"));
	fs.writeFileSync(path.join(dir, "img/a.png"), "png");
	fs.symlinkSync(path.join(dir, "img"), path.join(dir, "linked"));
	const footprint = await measure(dir);
	assert.deepEqual(footprint.others.map((f) => f.path).sort(), ["img/a.png", "linked/a.png"]);
	fs.symlinkSync(dir, path.join(dir, "img/up"));
	await assert.rejects(measure(dir), /File system loop found/);
	fs.rmSync(dir, { recursive: true });
});

// The walk is in parallel, so problems are found in any order: the one reported is the first by
// path, every time. Paths are named as 0.7's walk named them, from the folder as it was given.
test("a_walk_reports_the_same_problem_every_time", { skip: process.platform === "win32" && "links need privileges on Windows" }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-footprint-"));
	for (const name of ["b", "c", "d"]) fs.mkdirSync(path.join(dir, name, "deep"), { recursive: true });
	for (const name of ["c", "d"]) fs.symlinkSync("nowhere", path.join(dir, name, "deep", "dead"));
	fs.symlinkSync("..", path.join(dir, "b", "deep", "up"));
	const given = `${dir}${path.sep}`;
	for (let i = 0; i < 5; i++) {
		await assert.rejects(measure(given), (e: Error) => e.message === `reading ${given}: File system loop found: ${path.join(dir, "b", "deep", "up")} points to an ancestor ${path.join(dir, "b")}`);
	}
	fs.rmSync(path.join(dir, "b"), { recursive: true });
	await assert.rejects(measure(given), (e: Error) => e.message === `reading ${given}: IO error for operation on ${path.join(dir, "c", "deep", "dead")}: No such file or directory (os error 2): No such file or directory (os error 2)`);
	fs.rmSync(dir, { recursive: true });
});

test("urls_of_pages", () => {
	assert.equal(urlOf("index.html"), "/");
	assert.equal(urlOf("about/index.html"), "/about/");
	assert.equal(urlOf("myindex.html"), "/myindex.html");
	assert.equal(urlOf("feed.xml"), "/feed.xml");
});
