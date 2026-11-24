// Front matter in YAML, TOML and JSON, as each version reads it. Not from a Rust test: written for
// stage 3 of the move to Node, to pin what changes on purpose (CHANGELOG.md, 0.8.0) and what doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read } from "../lib/ssqch.js";

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
	// 0.8 reads YAML as js-yaml does (and so Eleventy): `017` and `1_000` are numbers, and `<<`
	// merges. 0.7 kept the first two as text, and `<<` as a key.
	assert.equal(out("numbers"), "[15,31,17,1000]");
	assert.equal(out("merge"), "[{\"x\":1,\"y\":2},{\"x\":1,\"y\":3},1,2]");
});

test("front_matter_errors_name_the_page", () => {
	const dir = tempDir("front-matter-errors");
	write(dir, { "ssqch.config.js": CONFIG, "src/open.edge": "---\na: one\n\nno closing fence\n" });
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in open.edge: front matter is missing its closing `---`"), r.log);
	write(dir, { "src/open.edge": "---json\n[1, 2]\n---\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in open.edge: JSON front matter must be an object, not "), r.log);
	// DELIBERATE (0.11, from the fresh www.ruby-lang.org move): a key written twice is the last one, as
	// in Jekyll, with a warning that names it, where it was an error.
	write(dir, { "src/open.edge": "---\na: one\na: two\n---\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok && r.log.includes("warn: ./src/open.edge: front matter has `a` twice (line 3); the last one is used"), r.log);
	write(dir, { "src/open.edge": "---\na: [unclosed\n---\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in open.edge: invalid YAML front matter: "), r.log);
});

// Not from a Rust test (the owner, 2026-11-24, after the Squatch Snacks rerun): a date written
// without a time is that day wherever it's read. With `timeZone`, it's midnight there, so a site's
// own `Date` code prints the day as written (west of UTC it printed the day before), and ssqch's
// own printers print the written day in every zone, as they did in UTC.
test("a_date_without_a_time_is_that_day_in_every_zone", () => {
	for (const zone of ["America/Los_Angeles", "Asia/Tokyo"]) {
		const dir = tempDir(`date-only-${zone.replace("/", "-")}`);
		write(dir, {
			"ssqch.config.js": `import { sitemapPlugin } from "ssqch/sitemap";\nexport default { dirs: { input: "src", output: "dist" }, timeZone: "${zone}", templateFormats: ["jinja", "liquid"], plugins: [sitemapPlugin({ url: "https://example.com" })], filters: { own: (d) => \`\${d.getMonth() + 1}/\${d.getDate()}\` } };\n`,
			"src/j.jinja": "---\ndate: 2026-11-02\n---\n{{ page.date | own }} {{ page.date | dateformat(\"%Y-%m-%d\") }} {{ page.date }} {{ page.date.getDate() }}\n",
			"src/l.liquid": "---\ndate: 2026-11-02\n---\n{{ page.date | date: \"%Y-%m-%d\" }} {{ page.date }}\n",
		});
		const r = ssqch(["build", "--root", dir, "-q"]);
		assert.ok(r.ok, r.log);
		assert.equal(read(dir, "dist/j/index.html"), "11/2 2026-11-02 2026-11-02T00:00:00.000Z 2", zone);
		assert.equal(read(dir, "dist/l/index.html"), "2026-11-02 2026-11-02 00:00:00 +0000\n", zone);
		assert.ok(read(dir, "dist/sitemap.xml").includes("<lastmod>2026-11-02</lastmod>"), zone);
		// `trace` too, in its date row and its data rows alike (it said 2026-11-02T08:00:00Z for the
		// page and 2026-11-02T00:00:00.000Z for its `date` field, The North Fake study's B2).
		const traced = ssqch(["trace", "/j/", "--root", dir]);
		assert.match(traced.stdout, /Date +2026-11-02T00:00:00Z \(from front matter\)/, traced.log);
		assert.ok(!traced.stdout.includes("2026-11-02T08:") && !traced.stdout.includes("2026-11-01T15:"), traced.log);
	}
});
