// From the unit tests in `crates/sitesquatch/src/blueprint.rs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFrontMatter, slug, yamlString } from "./new.ts";

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
