// From crates/sitesquatch/src/diagnostics.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BuildError, Diagnostics, Locator, context, describe, error, frames, fromError, toJson } from "./diagnostics.ts";

test("errors_name_their_file_and_line", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-diagnostics-"));
	try {
		const w = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
		// Three lines of front matter and a blank line: the body starts on line 5.
		w("src/page.edge", "---\ntitle: T\n---\n\n<p>\n{{ nope.x }}\n");
		w("src/_includes/bad.edge", "<p>\n\n@if(\n");
		w("src/_data/site.json", "{ \"a\": 1, }");
		w("ssqch.config.js", "export default {};\n");
		const at = new Locator(dir, [path.join(dir, "src"), path.join(dir, "src/_includes")]);
		const one = (message: string, fallback: string) => {
			const found = fromError(new Error(message), fallback, at);
			assert.equal(found.length, 1);
			return [found[0].code, found[0].file ?? "", found[0].line];
		};
		const data = path.join(dir, "src/_data/site.json");
		const cases: Array<[string, string, string, string, number | undefined]> = [
			// A template's lines count from its body.
			["rendering page.edge with `edge`: page.edge:3: Cannot read properties of undefined", "build", "template", "src/page.edge", 6],
			["rendering page.edge with `edge`: parse error in page.edge: line 2: unclosed @if(", "build", "template", "src/page.edge", 5],
			// The innermost file.
			["rendering page.edge with `edge`: page.edge:1: @include('bad.edge'): parse error in bad.edge: line 3: invalid @if arguments", "build", "template", "src/_includes/bad.edge", 3],
			["rendering layout _includes/bad.edge for page.edge: _includes/bad.edge:2: nope", "build", "template", "src/_includes/bad.edge", 2],
			["in page.edge: invalid YAML front matter: did not find expected ',' or ']' at line 2 column 1, while parsing a flow sequence at line 1 column 8", "build", "front-matter", "src/page.edge", 3],
			["in page.edge: computed.x: parse error in page.edge (computed): line 1: invalid expression", "build", "template", "src/page.edge", undefined],
			["in page.edge: layout `nope.edge` not found: no sightings in /site/src/_includes", "build", "template", "src/page.edge", undefined],
			["in page.edge: we've passed this tree before. Layout loop: a.edge -> b.edge -> a.edge", "build", "template", "src/page.edge", undefined],
			[`invalid JSON in ${data}: trailing comma at line 1 column 11`, "build", "data", "src/_data/site.json", 1],
			["ssqch.config.js: nope is not defined\n    at <anonymous> (ssqch.config.js:1:52)", "config", "config", "ssqch.config.js", 1],
			["ssqch.config.js: \"ouput\" isn't a config option", "config", "config", "ssqch.config.js", undefined],
			["rendering page.edge with `edge`: page.edge:1: shout(): cannot read property 'x' of undefined\n    at shout (ssqch.config.js:3:67)", "build", "template", "ssqch.config.js", 3],
			// A file that isn't there isn't named.
			["rendering gone.edge with `edge`: gone.edge:2: nope", "build", "template", "", undefined],
			["too many pine cones", "build", "build", "", undefined],
		];
		for (const [message, fallback, code, file, line] of cases) assert.deepEqual(one(message, fallback), [code, file, line], message);

		// An error that keeps its problems apart, under a context.
		const held = context(new Diagnostics("2 content errors", [
			error("schema", "src/page.edge: `title` is required", { file: "./src/page.edge", field: "title" }),
			error("", "in page.edge: front matter is missing its closing `---`"),
		]), "checking content");
		assert.equal(held.message, "checking content: 2 content errors");
		const found = fromError(held, "build", at);
		// The field's line, where its frame points (the page sets `title` on line 2), so the JSON has it too.
		assert.deepEqual(toJson(found[0]), { code: "schema", message: "src/page.edge: `title` is required", file: "src/page.edge", line: 2, field: "title" });
		assert.deepEqual(toJson(found[1]), { code: "front-matter", message: "in page.edge: front matter is missing its closing `---`", file: "src/page.edge" });

		// The lines an error is about: the file's own line, with carets under what the message quotes.
		const shown = (message: string) => frames(new Error(message), "build", at) ?? "";
		assert.equal(shown("rendering page.edge with `edge`: page.edge:3: Cannot read properties of undefined (reading 'x') in `nope`"), "  --> src/page.edge:6\n   4 |\n   5 | <p>\n   6 | {{ nope.x }}\n     |    ^^^^");
		assert.equal(shown("rendering page.edge with `edge`: parse error in page.edge: line 2: unclosed @if("), "  --> src/page.edge:5\n   3 | ---\n   4 |\n   5 | <p>\n   6 | {{ nope.x }}");
		assert.equal(shown("too many pine cones"), "");
		// A schema problem points at its field in the front matter.
		const schema = new Diagnostics("1 content error", [error("schema", "src/page.edge: `title` must be a string", { file: "src/page.edge", field: "title" })]);
		assert.equal(frames(schema, "build", at), "  --> src/page.edge:2\n   1 | ---\n   2 | title: T\n     | ^^^^^\n   3 | ---");
		assert.equal(describe(schema, "build", at), "1 content error\n\n  --> src/page.edge:2\n   1 | ---\n   2 | title: T\n     | ^^^^^\n   3 | ---");
		// A template's line in a message is the file's line too.
		assert.equal(describe(new BuildError("rendering page.edge with `edge`: page.edge:2: nope"), "build", at).split("\n")[0], "rendering page.edge with `edge`: page.edge:5: nope");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
