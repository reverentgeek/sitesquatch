// Front matter in YAML, TOML and JSON, as each version reads it. Not from a Rust test: written for
// stage 3 of the move to Node, to pin what changes on purpose (CHANGELOG.md, 0.8.0) and what doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read, RUST_07 } from "../lib/ssqch.js";

const CONFIG = "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\"], filters: { json: (v) => JSON.stringify(v) } };\n";
const PRINT = "\n{{{ json([a, b, c, d]) }}}";

test("front_matter_reads_yaml_toml_and_json", () => {
	const dir = tempDir("front-matter");
	write(dir, {
		"ssqch.config.js": CONFIG,
		// YAML 1.2's words: `yes` and `on` are text, `True` is true, `~` is null.
		"src/words.edge": `---\na: yes\nb: True\nc: ~\nd: 'it''s'\n---${PRINT}`,
		"src/numbers.edge": `---\na: 0o17\nb: 0x1F\nc: 017\nd: 1_000\n---${PRINT}`,
		"src/merge.edge": `---\nbase: &b { x: 1, y: 2 }\na: *b\nb:\n  <<: *b\n  y: 3\nc: 1\nd: 2\n---${PRINT}`,
		"src/toml.edge": `+++\na = 1979-05-27T07:32:00Z\nb = 1979-05-27 07:32:00.5\nc = 9007199254740993\nd = 0xDEAD\n+++${PRINT}`,
		"src/micro.edge": `+++\na = 1979-05-27T00:32:00.999999-07:00\nb = 1\nc = 2\nd = 3\n+++${PRINT}`,
		"src/json.edge": `---json\n{ "a": [1, 2], "b": { "x": null }, "c": "three", "d": false }\n---${PRINT}`,
		"src/crlf.edge": `---\r\na: one\r\nb: two\r\nc: 3\r\nd: 4\r\n---\r\n{{{ json([a, b, c, d]) }}}`,
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (name) => read(dir, `dist/${name}/index.html`).trim();
	assert.equal(out("words"), "[\"yes\",true,null,\"it's\"]");
	assert.equal(out("toml"), "[\"1979-05-27T07:32:00Z\",\"1979-05-27T07:32:00.5\",9007199254740992,57005]");
	assert.equal(out("json"), "[[1,2],{\"x\":null},\"three\",false]");
	assert.equal(out("crlf"), "[\"one\",\"two\",3,4]");
	assert.equal(out("micro"), "[\"1979-05-27T00:32:00.999999-07:00\",1,2,3]");
	if (RUST_07) {
		assert.equal(out("numbers"), "[15,31,\"017\",\"1_000\"]");
		assert.equal(out("merge"), "[{\"x\":1,\"y\":2},{\"<<\":{\"x\":1,\"y\":2},\"y\":3},1,2]");
	} else {
		// 0.8 reads YAML as js-yaml does (and so Eleventy): `017` and `1_000` are numbers, and `<<`
		// merges.
		assert.equal(out("numbers"), "[15,31,17,1000]");
		assert.equal(out("merge"), "[{\"x\":1,\"y\":2},{\"x\":1,\"y\":3},1,2]");
	}
});

test("front_matter_errors_name_the_page", () => {
	const dir = tempDir("front-matter-errors");
	write(dir, { "ssqch.config.js": CONFIG, "src/open.edge": "---\na: one\n\nno closing fence\n" });
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in open.edge: front matter is missing its closing `---`"), r.log);
	write(dir, { "src/open.edge": "---json\n[1, 2]\n---\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in open.edge: JSON front matter must be an object, not "), r.log);
	write(dir, { "src/open.edge": "---\na: one\na: two\n---\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in open.edge: invalid YAML front matter: "), r.log);
});
