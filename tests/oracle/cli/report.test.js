// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write } from "../lib/ssqch.js";

test("build_reports_in_json", () => {
	const dir = tempDir("build-json");
	const d = dir;
	const w = (file, text) => write(dir, { [file]: text });
	const config = (schema) => `import { linksPlugin } from "ssqch/links";\nconsole.log("from the config");\nconsole.warn("pine cones are low");\nexport default {\n  dirs: { input: "src", output: "dist" },\n  templateFormats: ["edge", "md"],\n  passthrough: ["nothing/**"],\n  schemas: { posts: { unknown: "warn", fields: { ${schema} } } },\n  beforeBuild: { run: "echo from-a-command" },\n  plugins: [linksPlugin({ fail: false })],\n};\n`;
	w("ssqch.config.js", config("title: \"string\""));
	w("src/posts/posts.json", "{ \"tags\": \"posts\" }");
	w("src/posts/pine.md", "---\ntitle: Pine\nextra: 1\n---\n[gone](/nope/)\n");
	w("src/index.edge", "---\ntitle: Home\n---\n\n<p>\n{{ title }}\n");
	const report = (args) => {
		const r = ssqch(["build", "--format", "json", "--root", d, ...args]);
		// Standard output is the report and nothing else.
		let json;
		try { json = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${JSON.stringify(r.stdout)}\n${r.stderr}`); }
		assert.equal(json.schemaVersion, 1);
		assert.equal(json.ok, r.ok, r.stdout);
		return [json, r.stderr];
	};

	// A build that works: what it wrote, and its warnings as data.
	let [json, stderr] = report([]);
	assert.equal(json.ok, true, JSON.stringify(json));
	assert.equal(json.environment, "production");
	assert.equal(json.output, "dist");
	assert.equal(json.pages.written, 2);
	assert.deepEqual([...json.written].sort(), ["index.html", "posts/pine/index.html"]);
	assert.ok(json.durationMs > 0 && json.timings[0].phase === "setup", JSON.stringify(json));
	assert.deepEqual(json.summary[0], { label: "Links", value: "1 checked, 1 broken" });
	assert.deepEqual(json.errors, []);
	assert.deepEqual(json.warnings, [
		// console.warn in the config is one of the warnings.
		{ code: "console", message: "pine cones are low" },
		{ code: "schema", message: "src/posts/pine.md: `extra` isn't a field of this schema (schema `posts`)", file: "src/posts/pine.md", field: "extra" },
		{ code: "passthrough", message: "passthrough glob \"nothing/**\" matches no files" },
		{ code: "links", message: "/posts/pine/ -> /nope/ (not found)", url: "/posts/pine/" },
	]);
	// What a person would have read went to standard error.
	for (const line of ["from the config", "from-a-command"]) {
		assert.ok(stderr.includes(line), `missing ${JSON.stringify(line)} in ${stderr}`);
	}
	// DELIBERATE (0.13.5): a line per page only with --verbose (osg, the new-blog run).
	assert.ok(!stderr.includes("[ssqch] Writing "), stderr);
	[, stderr] = report(["--verbose"]);
	assert.ok(stderr.includes("[ssqch] Writing ./dist/index.html from ./src/index.edge (edge)"), stderr);
	assert.ok(!stderr.includes("warn:") && !stderr.includes("Built in"), stderr);
	[, stderr] = report(["--quiet"]);
	assert.ok(!stderr.includes("[ssqch]"), stderr);

	// Content errors: the file and the field.
	w("ssqch.config.js", config("title: \"string\", hero: \"string\""));
	[json] = report([]);
	assert.deepEqual(json.errors, [{ code: "schema", message: "src/posts/pine.md: `hero` is required (a string) (schema `posts`)", file: "src/posts/pine.md", field: "hero" }]);
	assert.equal(json.warnings[1].field, "extra");
	assert.ok(!("pages" in json), JSON.stringify(json));
	w("ssqch.config.js", config("title: \"string\""));

	// Template errors: each one apart, with the line of the file (not of the template's body).
	w("src/index.edge", "---\ntitle: Home\n---\n\n<p>\n{{ nope.x }}\n");
	w("src/about.edge", "---\ntitle: About\n---\n@if(title\n");
	[json] = report([]);
	const errors = json.errors.map((e) => [e.code, e.file ?? "", e.line ?? 0]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]) || a[2] - b[2]);
	assert.deepEqual(errors, [["template", "src/about.edge", 4], ["template", "src/index.edge", 6]], JSON.stringify(json));
	fs.rmSync(path.join(dir, "src/about.edge"));
	w("src/index.edge", "---\ntitle: [Home\n---\nx\n");
	[json] = report([]);
	assert.deepEqual([json.errors[0].code, json.errors[0].file], ["front-matter", "src/index.edge"], JSON.stringify(json));
	w("src/index.edge", "---\ntitle: Home\n---\nx\n");

	// A broken link that fails the build names the page.
	w("ssqch.config.js", config("title: \"string\"").replace("fail: false", "fail: true"));
	[json] = report([]);
	assert.deepEqual(json.errors, [{ code: "links", message: "/posts/pine/ -> /nope/ (not found)", url: "/posts/pine/" }]);

	// A config that doesn't load.
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\" },\n  plugins: [nope()],\n};\n");
	[json] = report([]);
	assert.equal(json.errors.length, 1, JSON.stringify(json));
	assert.deepEqual([json.errors[0].code, json.errors[0].file, json.errors[0].line], ["config", "ssqch.config.js", 3], JSON.stringify(json));
	assert.ok(!("output" in json), JSON.stringify(json));

	// The usual output is as it was.
	w("ssqch.config.js", config("title: \"string\""));
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.stdout.includes("from the config") && r.stdout.includes("from-a-command") && r.stdout.includes("Built in"), `${r.stdout}\n${r.stderr}`);
	assert.equal(r.stderr.split("warn: ").length - 1, 3, r.stderr);
	assert.ok(r.stderr.includes("warn: the trail goes cold on 1 broken link:\n  /posts/pine/ -> /nope/ (not found)"), r.stderr);
	r = ssqch(["build", "--format", "yaml", "--root", d]);
	assert.ok(!r.ok && r.log.includes("--format yaml: use text or json"), r.log);
});
