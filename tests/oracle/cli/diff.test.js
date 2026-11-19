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
	// `--exclude` leaves out what `--only` would have to list (the blog needed nine `--only`s).
	[code, log] = run(["diff", "before", "after", "--format", "json", "--exclude", "index.html", "--exclude", "new/**"]);
	assert.equal(code, 1, log);
	assert.deepEqual(JSON.parse(log).summary, { added: 0, removed: 1, changed: 0, unchangedPages: 0, unchangedFiles: 0 });
	[code, log] = run(["diff", "before", "after", "--only", "**/*.html", "--exclude", "about/**", "--exclude", "new/**", "--ignore", "(Pine|Cedar) trail\\.|Trails|Paths|trails|paths"]);
	assert.equal(code, 0, log);
	[code, log] = run(["diff", "before", "after", "--exclude", "[a"]);
	assert.equal(code, 2, log);
	assert.ok(log.includes("--exclude \"[a\" isn't a glob"), log);
	[code, log] = run(["diff", "before", "missing"]);
	assert.equal(code, 2, log);
	assert.ok(log.includes("missing isn't a folder"), log);
	[code, log] = run(["diff", "before", "after", "--ignore", "("]);
	assert.equal(code, 2, log);
	assert.ok(log.includes("--ignore \"(\" isn't a regular expression"), log);
});

// `--ignore` is Rust's regex syntax, where `\w`, `\s` and `\b` know every script, `.` stops only
// at `\n`, and flags can change partway through.
test("diff_ignore_patterns_are_rust_regex", () => {
	const dir = tempDir("diff-ignore");
	// Whether the two files are the same once the pattern's matches are gone.
	const same = (pattern, a, b = "") => {
		fs.rmSync(path.join(dir, "a"), { recursive: true, force: true });
		fs.rmSync(path.join(dir, "b"), { recursive: true, force: true });
		write(dir, { "a/notes.txt": a, "b/notes.txt": b });
		const r = ssqch(["diff", "a", "b", "--ignore", pattern], { cwd: dir });
		assert.ok(r.code === 0 || r.code === 1, r.log);
		return r.code === 0;
	};
	assert.equal(same("é\\b..", "café x", "café y"), true);
	assert.equal(same("x\\wy", "xéy"), true);
	assert.equal(same("x\\wy", "x‍y"), true);
	assert.equal(same("a\\sb", "a\u0085b"), true);
	assert.equal(same("a\\sb", "a﻿b"), false);
	assert.equal(same("\\d+", "٣٤"), true);
	assert.equal(same("a.b", "a\rb"), true);
	assert.equal(same("a.b", "a b"), true);
	assert.equal(same("a.b", "a\nb"), false);
	assert.equal(same("(?m)^b", "a\rb", "a\rb"), true);
	assert.equal(same("(?m)^b", "a\rb", "a\r"), false);
	assert.equal(same("(?i:pine) cone", "PINE cone"), true);
	assert.equal(same("(?i:pine) cone", "PINE CONE"), false);
	assert.equal(same("(?i)k", "K"), true);
	assert.equal(same("(?x) pine \\  cone # a comment", "pine cone"), true);
	assert.equal(same("\\Apine\\z", "pine"), true);
	assert.equal(same("\\p{Greek}+", "αβγ"), true);
	assert.equal(same("[\\w&&\\p{Greek}]+", "αβ"), true);

	write(dir, { "a/notes.txt": "x", "b/notes.txt": "x" });
	const r = ssqch(["diff", "a", "b", "--ignore", "a(?=b)"], { cwd: dir });
	assert.equal(r.code, 2, r.log);
	assert.equal(r.stderr, "error: --ignore \"a(?=b)\" isn't a regular expression: regex parse error:\n    a(?=b)\n     ^^^\nerror: look-around, including look-ahead and look-behind, is not supported\n");
});

// A path kept whole because two files share a key can itself be a third file's key without a
// fingerprint. 0.7 lost one of those files; the Node build reports it.
test("diff_keeps_files_whose_fingerprinted_names_collide", () => {
	const dir = tempDir("diff-keys");
	write(dir, { "a/x.css": "a", "a/x.11111111.css": "b", "a/x.11111111.22222222.css": "c", "b/x.22222222.css": "a" });
	const r = ssqch(["diff", "a", "b", "--format", "json"], { cwd: dir });
	assert.equal(r.code, 1, r.log);
	const json = JSON.parse(r.stdout);
	const removed = [...json.removed].sort();
	assert.deepEqual(removed, ["/x.11111111.22222222.css", "/x.11111111.css"]);
	assert.equal(json.summary.unchangedFiles, 1);
});

// Both 2026-11-18 studies began by finding that the other generator's build changed by itself
// (Jekyll printing the build's time, Astro's ids from Math.random()). Three or more folders:
// which files vary between builds made the same way, and which builds agree.
test("diff_of_several_builds_lists_what_varies", () => {
	const dir = tempDir("diff-runs");
	for (const [run, minute] of [["ref-1", "01"], ["ref-2", "01"], ["ref-3", "07"]]) {
		write(dir, {
			[`${run}/index.html`]: "<p>Squatch Snacks</p>\n",
			[`${run}/trail/index.html`]: `<p>Built at <time>10:${minute}</time></p>\n`,
			[`${run}/app.${run === "ref-2" ? "aaaa1111" : "bbbb2222"}.css`]: "body { color: pine; }\n",
		});
	}
	write(dir, { "ref-2/stray.txt": "pine cone\n" });
	const r = ssqch(["diff", "ref-1", "ref-2", "ref-3"], { cwd: dir });
	assert.equal(r.code, 1, r.log);
	assert.ok(r.stdout.startsWith("Comparing 3 builds: ref-1, ref-2, ref-3\n"), r.stdout);
	assert.match(r.stdout, /~ \/trail\/  \(2 versions: ref-1, ref-2 agree; ref-3 differs\)\n      - 10:01\n      \+ 10:07\n/);
	assert.match(r.stdout, /~ \/stray\.txt  \(2 versions: missing from ref-1, ref-3; only in ref-2\)/);
	// A fingerprint doesn't count, as in a diff of two.
	assert.ok(!r.stdout.includes("app."), r.stdout);
	assert.match(r.stdout, /2 files vary between builds made the same way; 1 page and 1 other file are the same in all of them\./);
	const json = JSON.parse(ssqch(["diff", "ref-1", "ref-2", "ref-3", "--format", "json"], { cwd: dir }).stdout);
	assert.deepEqual(json.summary, { varies: 2, steadyPages: 1, steadyFiles: 1 });
	assert.deepEqual(json.varies.find((v) => v.url === "/stray.txt").versions, [{ runs: ["ref-1", "ref-3"], missing: true }, { runs: ["ref-2"], missing: false }]);
	// The same three times: exit 0.
	const same = ssqch(["diff", "ref-1", "ref-1", "ref-1"], { cwd: dir });
	assert.equal(same.code, 0, same.log);
	assert.match(same.stdout, /Every build is the same: 2 pages and 1 other file\. The tracks match every time\./);
});

// Every move fixed "the biggest group of differences" first, and found it by hand (osg's
// `scripts/compare.py` for 387 pages): a change on more than one file is listed once, the most
// files first, and `--ungrouped` lists each file with all its changes.
test("diff_groups_the_same_change_on_several_files", () => {
	const dir = tempDir("diff-groups");
	const pages = (footer) => Object.fromEntries(["pine", "cedar", "spruce"].map((name) => [`${footer}/${name}/index.html`, `<p>${name}</p><footer>${footer === "before" ? "Built with Eleventy" : "Built with ssqch"}</footer>`]));
	write(dir, { ...pages("before"), ...pages("after"), "after/cedar/index.html": "<p>cedar, again</p><footer>Built with ssqch</footer>" });
	let r = ssqch(["diff", "before", "after"], { cwd: dir });
	assert.equal(r.code, 1, r.log);
	assert.ok(r.log.includes("  ~ 3 pages: /cedar/, /pine/, /spruce/\n      - Built with Eleventy\n      + Built with ssqch\n  And what's left on 1 file:\n  ~ /cedar/  (text)\n      - cedar\n      + cedar, again\n"), r.log);
	r = ssqch(["diff", "before", "after", "--format", "json"], { cwd: dir });
	const json = JSON.parse(r.stdout);
	assert.deepEqual(json.groups, [{ files: 3, urls: ["/cedar/", "/pine/", "/spruce/"], same: true, match: "lines", kind: "text", hunk: { removed: ["Built with Eleventy"], added: ["Built with ssqch"] } }]);
	assert.deepEqual(json.changed.map((f) => f.groups), [[0], [0], [0]]);
	r = ssqch(["diff", "before", "after", "--ungrouped"], { cwd: dir });
	assert.ok(!r.log.includes("The same change on more than one file") && r.log.includes("  ~ /pine/  (text)\n      - Built with Eleventy\n"), r.log);
});
