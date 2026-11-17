// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, exists } from "../lib/ssqch.js";

test("inspect_says_where_a_page_and_its_data_come_from", () => {
	const dir = tempDir("inspect");
	const d = dir;
	// The hook makes a data file, as a build's would; it and `console.log` mustn't get into the report.
	write(dir, {
		"ssqch.config.js": "import { writeFileSync } from \"node:fs\";\nconsole.log(\"from the config\");\nexport default {\n  dirs: { input: \"src\", output: \"dist\" },\n  data: { build: () => ({ n: 7 }) },\n  beforeBuild: [() => writeFileSync(\"src/_data/made.json\", \"{ \\\"by\\\": \\\"the hook\\\" }\"), { run: \"echo from-a-command\" }],\n  afterBuild: () => writeFileSync(\"after.txt\", \"ran\"),\n};\n",
		"src/_data/site.json": "{ \"name\": \"Trails\", \"author\": { \"name\": \"Sam\" } }",
		"src/_includes/base.jinja": "---\nsection: none\ntheme: light\n---\n{{ content }}",
		"src/_includes/guide.jinja": "---\nlayout: base.jinja\nsection: guides\n---\n{{ content }}",
		"src/guides/guides.json": "{ \"layout\": \"guide.jinja\", \"tags\": \"guides\", \"level\": \"easy\", \"permalink\": \"/guides/{{ page.fileSlug }}/\", \"computed\": { \"label\": \"{{ title }} ({{ level }})\" } }",
		"src/guides/2024-03-02-pine.md": "---\ntitle: Pine\nlevel: hard\nhero: { alt: A pine }\n---\nPine.\n",
		"src/guides/2024-03-02-pine.json": "{ \"level\": \"medium\", \"reviewed\": true }",
		"src/tags.jinja": "---\npagination: { data: collections, size: 1, alias: tag }\npermalink: \"/tags/{{ tag }}/\"\n---\n{{ tag }}",
	});
	// The report (standard output), or what went wrong.
	const run = (args) => {
		const r = ssqch(["inspect", "--root", d, ...args]);
		return [r.ok, r.ok ? r.stdout : r.stderr];
	};

	let [ok, log] = run(["/guides/pine/"]);
	assert.ok(ok, log);
	assert.ok(log.startsWith("/guides/pine/\n  From        src/guides/2024-03-02-pine.md (jinja, md)\n  Writes      dist/guides/pine/index.html\n  Layouts     _includes/guide.jinja > _includes/base.jinja\n  Date        2024-03-02T00:00:00Z (from the file's name)\n  Collections all, guides\n"), log);
	// The columns are as wide as the longest name, so compare the rows without their padding.
	const rows = log.split("\n").map((l) => l.split(/\s+/).filter(Boolean).join(" "));
	for (const expected of [
		"site {name, author} src/_data/site.json",
		"build {n} the config's `data`",
		"ssqch {version, generator, env, serving, …} built in",
		"section \"guides\" layout _includes/guide.jinja (over layout _includes/base.jinja)",
		"theme \"light\" layout _includes/base.jinja",
		"layout \"guide.jinja\" src/guides/guides.json",
		"level \"hard\" front matter (over src/guides/guides.json, src/guides/2024-03-02-pine.json)",
		"reviewed true src/guides/2024-03-02-pine.json",
		"hero {alt} front matter",
		"label \"Pine (hard)\" computed",
		"page {url, outputPath, inputPath, fileSlug, …} built in",
	]) {
		assert.ok(rows.some((r) => r === expected), `missing ${JSON.stringify(expected)} in\n${log}`);
	}
	// No page was built, and `afterBuild` didn't run.
	assert.ok(!exists(dir, "dist") && !exists(dir, "after.txt"));
	// `beforeBuild` did, since data can depend on it. What it and the config print isn't in the report.
	let r = ssqch(["inspect", "--root", d, "/guides/pine/", "--field", "made.by", "--format", "json"]);
	assert.ok(r.ok, r.stderr);
	let json;
	try { json = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.deepEqual(json.field, { name: "made.by", value: "the hook", from: "src/_data/made.json", setBy: [{ from: "src/_data/made.json", value: "the hook" }] });
	assert.ok(r.stderr.includes("from the config") && r.stderr.includes("from-a-command"), r.stderr);

	// One field, by the template's path, with every level that set it.
	[ok, log] = run(["src/guides/2024-03-02-pine.md", "--field", "level"]);
	assert.ok(ok, log);
	assert.equal(log, "level = \"hard\"\n\nSet by (the last one wins):\n    src/guides/guides.json                    \"easy\"\n    src/guides/2024-03-02-pine.json           \"medium\"\n  > front matter                              \"hard\"\n");
	[ok, log] = run(["/guides/pine", "--field", "site.author.name", "--format", "json"]);
	assert.ok(ok, log);
	try { json = JSON.parse(log); } catch (e) { throw new Error(`${e.message}: ${log}`); }
	assert.equal(json.schemaVersion, 1);
	assert.deepEqual(json.date, { value: "2024-03-02T00:00:00Z", from: "the file's name" });
	assert.deepEqual(json.field, { name: "site.author.name", value: "Sam", from: "src/_data/site.json", setBy: [{ from: "src/_data/site.json", value: "Sam" }] });
	[ok, log] = run(["/guides/pine/", "--format", "json"]);
	assert.ok(ok, log);
	json = JSON.parse(log);
	assert.deepEqual(json.data.title, { value: "Pine", from: "front matter", setBy: [{ from: "front matter", value: "Pine" }] });

	// A page of a paginated template, and what goes wrong.
	[ok, log] = run(["/tags/guides/", "--field", "tag"]);
	assert.ok(ok && log.includes("tag = \"guides\"") && log.includes("> pagination (its `alias`)"), log);
	[ok, log] = run(["src/tags.jinja"]);
	assert.ok(!ok && log.includes("src/tags.jinja makes 2 pages; give the URL of one: /tags/all/, /tags/guides/"), log);
	[ok, log] = run(["/guides/pines/"]);
	assert.ok(!ok && log.includes("no page at \"/guides/pines/\""), log);
	[ok, log] = run(["/guides/pine/", "--field", "titel"]);
	assert.ok(!ok && log.includes("/guides/pine/ has no `titel` in its data (it has: "), log);

	// `index.html` is only the end of a URL when it's a whole part of it.
	write(dir, { "src/a.md": "---\npermalink: /my/\ntitle: Cedar\n---\n" });
	write(dir, { "src/b.md": "---\npermalink: /myindex.html\ntitle: Pine\n---\n" });
	for (const [url, title] of [["/myindex.html", "\"Pine\""], ["/my/", "\"Cedar\""], ["/my/index.html", "\"Cedar\""], ["/my", "\"Cedar\""]]) {
		[ok, log] = run([url, "--field", "title", "--format", "json"]);
		assert.ok(ok, log);
		json = JSON.parse(log);
		assert.equal(JSON.stringify(json.field.value), title, `${url}: ${log}`);
	}
});
