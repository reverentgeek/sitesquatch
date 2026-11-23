// The docs back every number on the landing page. The benchmarks come from
// src/_data/benchmarks.js, whose `backedBy` phrases have to be in the docs word for word; the
// rest of the page's claims are listed here with the docs' words for each. When the docs'
// numbers change, this fails until the page says the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import benchmarks from "../src/_data/benchmarks.js";
import latest from "../src/_data/latest.js";
import { docsText } from "../../packages/ssqch/src/commands/docs.ts";

const repo = new URL("../../", import.meta.url);
// The docs as `ssqch docs` reads them: each page a `## <title>` section.
const readme = docsText();
const page = readFileSync(new URL("../src/index.jinja", import.meta.url), "utf8");

function section(heading: string) {
	const start = readme.indexOf(`\n## ${heading}\n`);
	assert.notEqual(start, -1, `the docs have no "${heading}" page`);
	const end = readme.indexOf("\n## ", start + 1);
	return readme.slice(start, end === -1 ? undefined : end);
}

test("each mileage board's figure and its conditions are in the docs' Benchmarks", () => {
	const text = section("Benchmarks");
	for (const board of benchmarks.boards) {
		assert.ok(board.says.length > 0);
		for (const phrase of board.backedBy) assert.ok(text.includes(phrase), `Benchmarks doesn't say "${phrase}" (for the ${board.figure} board)`);
		assert.ok(board.backedBy.some((phrase) => phrase.includes(board.figure)), `no backedBy phrase for ${board.figure} has the figure itself`);
	}
	for (const phrase of benchmarks.conditionsBackedBy) assert.ok(text.includes(phrase), `Benchmarks doesn't say "${phrase}"`);
});

test("the Node version the page asks for is the package's and the docs'", () => {
	assert.match(latest.node, /^\d+\.\d+$/);
	assert.ok(readme.includes(`[Node.js](https://nodejs.org) ${latest.node} or newer`), `Install doesn't ask for Node.js ${latest.node}`);
});

// [what the landing page says, what the docs say]
const claims: [string, string, string][] = [
	["Uncharted territory: known gaps", "about 0.9 s after one edit on a 10,000-page site", "a 10,000-page site takes about 0.9 s"],
	["Uncharted territory: known gaps", "Pages render one at a time on one thread", "pages render one at a time on one thread"],
	["Uncharted territory: known gaps", "HDR photos need converting to sRGB first", "converting the source to sRGB once fixes it"],
	["Has the stump moved? Comparing two builds", "No differences: 148 pages and 4,730 other files are the same.", "No differences: 148 pages and 4,730 other files are the same."],
	["Content schemas", "`hero.src` is \"cedar.jpg\", but there's no such file next to the page (looked for src/posts/cedar.jpg) (schema `posts`)", "`hero.src` is \"cedar.jpg\", but there's no such file next to the page (looked for src/posts/cedar.jpg) (schema `posts`)"],
	["Field guide: build your first site", "seven posts with tag pages and a feed", "seven posts with tags, a page for each tag and one listing them, an Atom feed"],
];

test("the page's other claims are the docs'", () => {
	for (const [heading, onPage, inReadme] of claims) {
		assert.ok(page.includes(onPage), `the landing page no longer says "${onPage}": update this test`);
		assert.ok(section(heading).includes(inReadme), `the docs' "${heading}" doesn't say "${inReadme}"`);
	}
});

test("the AGENTS.md that ssqch init writes is about 1 KB", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "ssqch-site-"));
	try {
		const bin = process.env.SSQCH_BIN ?? fileURLToPath(new URL("packages/ssqch/bin/ssqch.ts", repo));
		const [command, args] = bin.endsWith(".ts") ? [process.execPath, [bin]] : [bin, []];
		const run = spawnSync(command, [...args, "init", "camp", "--quiet"], { cwd: dir, encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		const size = statSync(path.join(dir, "camp", "AGENTS.md")).size;
		assert.ok(size >= 500 && size < 1536, `AGENTS.md is ${size} bytes; the landing page says 1 KB`);
		assert.ok(page.includes("a 1 KB <code>AGENTS.md</code>"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
