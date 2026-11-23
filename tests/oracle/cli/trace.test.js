// From crates/ssqch/tests/cli.rs. DELIBERATE (0.13): `ssqch inspect` is `ssqch trace` (the audit's
// plan, step 5: it follows a value's tracks back through the cascade), with the same options and JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
		const r = ssqch(["trace", "--root", d, ...args]);
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
	let r = ssqch(["trace", "--root", d, "/guides/pine/", "--field", "made.by", "--format", "json"]);
	assert.ok(r.ok, r.stderr);
	let json;
	try { json = JSON.parse(r.stdout); } catch (e) { throw new Error(`${e.message}: ${r.stdout}`); }
	assert.deepEqual(json.field, { name: "made.by", value: "the hook", from: "src/_data/made.json", setBy: [{ from: "src/_data/made.json", value: "the hook" }] });
	// DELIBERATE (0.14): a command's output is held while tracing, as under `-q` (Squatch Snacks,
	// E10: Tailwind's banner printed on every trace), and printed only if the command fails.
	assert.ok(r.stderr.includes("from the config") && !r.stderr.includes("from-a-command"), r.stderr);

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

// Squatch Snacks (B6): `trace --format json` had the machine's whole path in it, as
// `data.page.outputPath`, which is the value a template gets. 0.7 gave the output folder's path
// joined to the page's, and a page that printed it wasn't the same on two machines.
// DELIBERATE (0.14): `page.outputPath` is named as `page.inputPath` is, from the project root
// (`./dist/about/index.html`), for a template, a collection's item, `this.page` in a filter and a
// transform. A plugin's pages (`alternates()`, an `afterBuild` hook's `written`) keep whole paths,
// with which they read files.
test("a_pages_output_path_is_from_the_project_root", () => {
	const dir = tempDir("output-path");
	write(dir, {
		"ssqch.config.js": `export default {
  dirs: { input: "src", output: "dist" },
  filters: { where() { return this.page.outputPath; } },
  transforms: { stamp: (content, page) => (page.outputPath.endsWith(".html") ? content + "[transform " + page.outputPath + " " + page.inputPath + "]" : content) },
};
`,
		"src/about.jinja": "[page {{ page.outputPath }} {{ page.inputPath }}][filter {{ where() }}]{% for p in collections.all %}[item {{ p.outputPath }}]{% endfor %}",
		"src/none.jinja": "---\npermalink: false\n---\n{{ page.outputPath }}",
	});
	const built = ssqch(["build", "--root", dir, "--quiet"]);
	assert.ok(built.ok, built.log);
	assert.equal(fs.readFileSync(path.join(dir, "dist/about/index.html"), "utf8"), "[page ./dist/about/index.html ./src/about.jinja][filter ./dist/about/index.html][item ./dist/about/index.html][item False][transform ./dist/about/index.html ./src/about.jinja]");
	const traced = JSON.parse(ssqch(["trace", "--root", dir, "/about/", "--format", "json"]).stdout);
	assert.equal(traced.outputPath, "dist/about/index.html");
	assert.equal(traced.data.page.value.outputPath, "./dist/about/index.html");
	// Nothing in the report says where the project is on this machine.
	assert.ok(!JSON.stringify(traced).includes(JSON.stringify(dir).slice(1, -1)), JSON.stringify(traced));
	// A page that isn't written has none, as before (`[item False]` above is its item, in Jinja).
	const unwritten = JSON.parse(ssqch(["trace", "--root", dir, "src/none.jinja", "--format", "json"]).stdout);
	assert.equal(unwritten.data.page.value.outputPath, false);
});

// Added in 0.14.1: where `page.lastModified` (and an undated page's date, with `dateFallback:
// "git"`) came from, and why it's the file's time when git had nothing: Squatch Snacks' request 2
// was this question, and `trace` said "built in" while the build fell back quietly (E8).
test("trace_says_where_git_dates_came_from", () => {
	const dir = tempDir("trace-git");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, lastModified: \"git\", dateFallback: \"git\" };\n",
		"src/privacy.md": "---\ntitle: Privacy\n---\nHi\n",
	});
	let r = ssqch(["trace", "/privacy/", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.match(r.log, /Date {8}\S+ \(from the file's modification time: `dateFallback: "git"`, but the project isn't in a git repository\)/);
	assert.match(r.log, /Modified {4}\S+ \(from the file's modification time: `lastModified: "git"`, but the project isn't in a git repository\)/);
	r = ssqch(["trace", "/privacy/", "--root", dir, "--field", "page.lastModified"]);
	assert.ok(r.log.includes("> the file's modification time: `lastModified: \"git\"`, but the project isn't in a git repository"), r.log);
	const git = (...args) => spawnSync("git", ["-C", dir, "-c", "user.email=ranger@example.com", "-c", "user.name=Ranger", ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-03-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-03-01T12:00:00Z" } });
	if (git("--version").status !== 0) return;
	git("init", "-q");
	git("add", "-A");
	git("commit", "-qm", "First tracks");
	r = ssqch(["trace", "/privacy/", "--root", dir, "--format", "json"]);
	const report = JSON.parse(r.log);
	assert.deepEqual(report.lastModified, { value: "2026-03-01T12:00:00Z", from: "git: the last commit to src/privacy.md" }, r.log);
	assert.equal(report.date.from, "git: the last commit to src/privacy.md", r.log);
	fs.appendFileSync(path.join(dir, "src/privacy.md"), "More\n");
	r = ssqch(["trace", "/privacy/", "--root", dir]);
	assert.ok(r.log.includes("`lastModified: \"git\"`, but it has changes that aren't committed"), r.log);
});
