// From the unit tests in `crates/sitesquatch/src/blueprint.rs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { fillFrontMatter, newPage, slug, yamlString } from "./new.ts";

test("slugs and titles", () => {
	assert.equal(slug("Pine Cone Crunch!"), "pine-cone-crunch");
	assert.equal(slug("  What's new in 0.4?  "), "whats-new-in-0-4");
	assert.equal(slug("Crème brûlée & café"), "crème-brûlée-café");
	assert.equal(slug("!!!"), "");
	assert.equal(yamlString("Pine cone crunch"), "Pine cone crunch");
	for (const [text, written] of [["Pines: a guide", "\"Pines: a guide\""], ["true", "\"true\""], ["2024 in review", "\"2024 in review\""], ["Say \"hi\"", "\"Say \\\"hi\\\"\""], ["#1 tip", "\"#1 tip\""], ["A - B", "\"A - B\""]]) {
		assert.equal(yamlString(text), written);
	}
});

test("front matter is filled in place", () => {
	const fill = (source: string) => fillFrontMatter(source, [["title", { text: "Pines: a guide" }, true], ["date", { raw: "2026-03-02" }, false], ["draft", { raw: "true" }, false]]);
	// YAML: the keys that are there keep their place, comments stay, new ones are added.
	assert.equal(
		fill("---\n# A guide.\nlayout: guide.edge\ntitle:\ntags:\n  - guides\n  - draft\ndate: 2020-01-01 # filled in\n---\n\n# {{ title }}\n"),
		"---\n# A guide.\nlayout: guide.edge\ntitle: \"Pines: a guide\"\ntags:\n  - guides\n  - draft\ndate: 2026-03-02\ndraft: true\n---\n\n# {{ title }}\n",
	);
	// A value over several lines is replaced whole.
	assert.equal(fill("---\ntitle: >\n  An old\n  title\ndate:\n\n---\nBody\n"), "---\ntitle: \"Pines: a guide\"\ndate: 2026-03-02\ndraft: true\n\n---\nBody\n");
	// Without the keys, and without front matter.
	assert.equal(fill("---\nlayout: a.edge\n---\nBody\n"), "---\ntitle: \"Pines: a guide\"\nlayout: a.edge\ndate: 2026-03-02\ndraft: true\n---\nBody\n");
	assert.equal(fill("Just a body\n"), "---\ntitle: \"Pines: a guide\"\ndate: 2026-03-02\ndraft: true\n---\nJust a body\n");
	// TOML and JSON.
	assert.equal(fill("+++\ntitle = \"\"\nweight = 3\n+++\nBody\n"), "+++\ntitle = \"Pines: a guide\"\nweight = 3\ndate = 2026-03-02\ndraft = true\n+++\nBody\n");
	// Keys are the page's own, above its tables: one missing goes before `[extra]`, and a table's key of the same name stays the table's.
	assert.equal(
		fill("+++\ntitle = \"New post\"\n[extra]\nanimal = \"owl\"\ndraft = false\n+++\n\n# Trail\n"),
		"+++\ntitle = \"Pines: a guide\"\ndate = 2026-03-02\ndraft = true\n[extra]\nanimal = \"owl\"\ndraft = false\n+++\n\n# Trail\n",
	);
	// A value over several lines is replaced whole, and brackets in strings aren't tables.
	assert.equal(
		fill("+++\ntags = [\n  \"a\",\n  \"[b]\",\n]\ndraft = \"\"\"\n[x]\n\"\"\"\n# pine\n\n[[cones]]\nn = 1\n+++\n"),
		"+++\ntitle = \"Pines: a guide\"\ntags = [\n  \"a\",\n  \"[b]\",\n]\ndraft = true\ndate = 2026-03-02\n# pine\n\n[[cones]]\nn = 1\n+++\n",
	);
	assert.equal(fill("---json\n{ \"layout\": \"a.edge\", \"title\": \"\" }\n---\nBody\n"), "---json\n{\n  \"layout\": \"a.edge\",\n  \"title\": \"Pines: a guide\",\n  \"date\": \"2026-03-02\",\n  \"draft\": true\n}\n---\nBody\n");
	// Windows line endings stay.
	assert.equal(fill("---\r\ntitle:\r\n---\r\nBody\r\n"), "---\r\ntitle: \"Pines: a guide\"\r\ndate: 2026-03-02\r\ndraft: true\r\n---\r\nBody\r\n");
	assert.throws(() => fillFrontMatter("---\ntitle:\nBody\n", []), /missing the closing `---`/);
});

// 0.7 read a JSON blueprint with serde_json, which kept the keys in the file's order and wrote
// each number back as its own types held it. (These are 0.7's answers, from `ssqch new`.)
test("a json blueprint keeps its order and its numbers", () => {
	const source = "---json\n{\"title\": \"\", \"2024\": \"year\", \"weight\": 1.0, \"big\": 12345678901234567890, \"exp\": 1e5, \"tiny\": 2.5e-5, \"small\": 1e-6, \"huge\": 1e16, \"past\": 123456789012345678901234567890, \"low\": -9223372036854775809, \"y\": [1, {\"z\": 1, \"1\": 2}], \"e\": {}}\n---\nBody\n";
	const filled = fillFrontMatter(source, [["title", { text: "N1" }, true], ["inf", { raw: "1e400" }, false], ["obj", { raw: "{\"z\":1,\"1\":3}" }, false], ["neg", { raw: "-0" }, false], ["weight", { raw: "2.0" }, false]]);
	assert.equal(filled, "---json\n{\n  \"title\": \"N1\",\n  \"2024\": \"year\",\n  \"weight\": 2.0,\n  \"big\": 12345678901234567890,\n  \"exp\": 100000.0,\n  \"tiny\": 0.000025,\n  \"small\": 1e-6,\n  \"huge\": 1e+16,\n  \"past\": 1.2345678901234568e+29,\n  \"low\": -9.223372036854776e+18,\n  \"y\": [\n    1,\n    {\n      \"z\": 1,\n      \"1\": 2\n    }\n  ],\n  \"e\": {},\n  \"inf\": \"1e400\",\n  \"obj\": {\n    \"z\": 1,\n    \"1\": 3\n  },\n  \"neg\": -0.0\n}\n---\nBody\n");
	assert.throws(() => fillFrontMatter("---json\n{\"n\": 1e400}\n---\n", []), /^BuildError: its JSON front matter doesn't parse: number out of range$/);
	assert.throws(() => fillFrontMatter("---json\n{\"n\": }\n---\n", []), /^BuildError: its JSON front matter doesn't parse: /);
});

test("new's blueprints and files fail as 0.7's did", async () => {
	// The system's spelling of the folder (Windows' temporary folder has a short name JavaScript's realpath keeps).
	const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-new-")));
	// Loading a config moves into the site's folder; the test goes back before removing it.
	const cwd = process.cwd();
	const config = await loadConfig({ root: dir, env: "development", quiet: true });
	fs.mkdirSync(path.join(dir, "_blueprints"));
	// A blueprint that isn't UTF-8 is an error, not a page with U+FFFD in it.
	fs.writeFileSync(path.join(dir, "_blueprints/posts.md"), Buffer.from("---\ntitle:\n---\ncaf\xe9\n", "latin1"));
	assert.throws(() => newPage(config, { path: "posts/x.md", set: [] }), (e: Error) => e.message === `reading ${dir}${path.sep}.${path.sep}_blueprints${path.sep}posts.md: stream did not contain valid UTF-8`);
	assert.ok(!fs.existsSync(path.join(dir, "posts")));
	// A byte-order mark is kept, as text.
	fs.writeFileSync(path.join(dir, "_blueprints/posts.md"), "\uFEFF---\ntitle:\n---\nBOM\n");
	newPage(config, { path: "posts/bom.md", set: [] });
	assert.ok(fs.readFileSync(path.join(dir, "posts/bom.md"), "utf8").includes("\uFEFF---\ntitle:\n---\nBOM\n"));
	// What's in the way of the new file says what was being done.
	fs.writeFileSync(path.join(dir, "f"), "");
	assert.throws(() => newPage(config, { path: "f/posts/x.md", set: [] }), (e: Error) => e.message.startsWith(`creating ${path.join(dir, "f", "posts")}: `));
	// A link to nothing isn't a blueprint: the next one is used.
	if (process.platform !== "win32") {
		fs.rmSync(path.join(dir, "_blueprints/posts.md"));
		fs.symlinkSync("nowhere", path.join(dir, "_blueprints/posts.md"));
		fs.writeFileSync(path.join(dir, "_blueprints/default.md"), "---\ntitle:\n---\nDefault\n");
		assert.equal(newPage(config, { path: "posts/y.md", set: [] }).blueprint, path.join(dir, "_blueprints", "default.md"));
	}
	process.chdir(cwd);
	fs.rmSync(dir, { recursive: true, force: true });
});
