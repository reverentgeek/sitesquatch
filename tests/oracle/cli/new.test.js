// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists, isFile } from "../lib/ssqch.js";

/** Today's date as `ssqch new` writes it (the local date): asked of ssqch itself. */
function todayAsNewWritesIt() {
	const dir = tempDir("today");
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	const { ok, log } = ssqch(["new", "--root", dir, "today.md", "--format", "json"]);
	assert.ok(ok, log);
	const date = JSON.parse(log).date;
	assert.ok(date.length === 10 && date.startsWith("20"), date);
	return date;
}

test("new_creates_a_page_from_an_blueprint", () => {
	const dir = tempDir("new");
	const d = dir;
	const w = (file, text) => write(dir, { [file]: text });
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, theme: \"theme\" };\n");
	w("src/index.md", "Home\n");
	w("theme/_blueprints/notes.md", "---\ntitle:\nkind: note\n---\n\nFrom the theme.\n");
	const make = (args) => ssqch(["new", "--root", d, ...args]);
	const today = todayAsNewWritesIt();

	// No blueprint: a title from the file's name, and today's date.
	let { ok, log } = make(["posts/pine-cone-crunch.md"]);
	assert.ok(ok, log);
	assert.equal(log, "Created src/posts/pine-cone-crunch.md from the built-in blueprint (a title and a date; src/_blueprints/ has none for it). Field notes started.\n");
	assert.equal(read(dir, "src/posts/pine-cone-crunch.md"), `---\ntitle: Pine cone crunch\ndate: ${today}\n---\n\n`);
	// Nothing is overwritten.
	({ ok, log } = make(["posts/pine-cone-crunch.md", "--title", "Other"]));
	assert.ok(!ok && log.includes("src/posts/pine-cone-crunch.md already exists. Those tracks are taken; choose another file name (the file is left as it is)"), log);
	assert.ok(read(dir, "src/posts/pine-cone-crunch.md").includes("title: Pine cone crunch"));

	// The folder's blueprint: its front matter is filled in, and its body is copied as it is.
	w("src/_blueprints/posts.md", "---\n# Fill in the description.\ntitle:\ndate:\ndescription:\ndraft: true\n---\n\nThe title is {{ title }}.\n");
	w("src/_blueprints/docs.md", "---\ntitle:\norder: 0\n---\n\nA doc.\n");
	w("src/_blueprints/docs/guides.jinja", "---\ntitle:\n---\n<p>A guide.</p>\n");
	w("src/_blueprints/default.md", "---\ntitle:\n---\n\nA page.\n");
	({ ok, log } = make(["src/posts/2026-01-05-winter-trails.md", "--title", "Winter trails: a guide", "--set", "tags=[news, trails]", "--set", "draft=false"]));
	assert.deepEqual([ok, log], [true, "Created src/posts/2026-01-05-winter-trails.md from src/_blueprints/posts.md. Field notes started.\n"]);
	assert.equal(read(dir, "src/posts/2026-01-05-winter-trails.md"), `---\n# Fill in the description.\ntitle: "Winter trails: a guide"\ndate: ${today}\ndescription:\ndraft: false\ntags: [news, trails]\n---\n\nThe title is {{ title }}.\n`);

	// The most specific folder's blueprint, by the new file's extension; then the folders above; then `default`.
	({ ok, log } = make(["docs/guides/install.jinja"]));
	assert.ok(ok && log.endsWith("from src/_blueprints/docs/guides.jinja. Field notes started.\n"), log);
	assert.equal(read(dir, "src/docs/guides/install.jinja"), "---\ntitle: Install\n---\n<p>A guide.</p>\n");
	({ ok, log } = make(["docs/reference/cli/index.md", "--date", "2026-03-02"]));
	assert.ok(ok && log.endsWith("from src/_blueprints/docs.md. Field notes started.\n"), log);
	// An index page is named by its folder, and --date adds a date the blueprint doesn't have.
	assert.equal(read(dir, "src/docs/reference/cli/index.md"), "---\ntitle: Cli\norder: 0\ndate: 2026-03-02\n---\n\nA doc.\n");
	({ ok, log } = make(["about.md"]));
	assert.ok(ok && log.endsWith("from src/_blueprints/default.md. Field notes started.\n"), log);
	assert.equal(read(dir, "src/about.md"), "---\ntitle: About\n---\n\nA page.\n");
	// By name, and from a theme.
	({ ok, log } = make(["ideas/cedar.md", "--blueprint", "notes", "--format", "json"]));
	assert.ok(ok, log);
	let json;
	try { json = JSON.parse(log); } catch (e) { throw new Error(`${e.message}: ${log}`); }
	assert.deepEqual(json, { schemaVersion: 1, path: "src/ideas/cedar.md", blueprint: "theme/_blueprints/notes.md", title: "Cedar", date: today });
	assert.equal(read(dir, "src/ideas/cedar.md"), "---\ntitle: Cedar\nkind: note\n---\n\nFrom the theme.\n");

	// A folder and a title: the file is named as the folder's other pages are.
	({ ok, log } = make(["docs", "--title", "Getting started"]));
	assert.deepEqual([ok, log], [true, "Created src/docs/getting-started.md from src/_blueprints/docs.md. Field notes started.\n"]);
	// Most of the pages in posts/ have the date in front now.
	w("src/posts/2026-01-09-snow.md", "---\ntitle: Snow\n---\n");
	({ ok, log } = make(["posts/", "--title", "What's new in 0.4?", "--date", "2026-03-02"]));
	assert.deepEqual([ok, log], [true, "Created src/posts/2026-03-02-whats-new-in-0-4.md from src/_blueprints/posts.md. Field notes started.\n"]);
	assert.ok(read(dir, "src/posts/2026-03-02-whats-new-in-0-4.md").includes("title: What's new in 0.4?\ndate: 2026-03-02\n"));
	// Folders with an index file.
	w("src/trails/cedar/index.jinja", "---\ntitle: Cedar\n---\n");
	w("src/trails/fir/index.jinja", "---\ntitle: Fir\n---\n");
	fs.rmSync(path.join(dir, "src/_blueprints/default.md"));
	({ ok, log } = make(["trails", "--title", "Old Growth Loop"]));
	assert.ok(ok && log.startsWith("Created src/trails/old-growth-loop/index.jinja from the built-in blueprint (a title and a date"), log);

	// What goes wrong.
	for (const [args, expected] of [
		[["posts"], "posts is a folder, so give the page a title to name its file after: ssqch new posts --title \"Pine cones\""],
		[["posts", "--title", "!!!"], "--title \"!!!\" has no letters or digits to name the file after"],
		[["../outside.md"], "../outside.md: a new page goes in the input folder (src/), so give a path from there"],
		[["_data/x.md"], "_data/x.md: _data/ isn't a folder for pages"],
		[["x.md", "--blueprint", "nope"], "no blueprint named \"nope\" in src/_blueprints/ (there's docs, docs/guides, notes, posts)"],
		[["x.md", "--set", "draft"], "--set draft: give a key and a value, like --set draft=true"],
		[["x.md", "--format", "yaml"], "--format yaml: use text or json"],
	]) {
		({ ok, log } = make(args));
		assert.ok(!ok && log.includes(expected), `${JSON.stringify(args)}: ${log}`);
	}
	assert.ok(!exists(dir, "src/x.md") && !exists(dir, "outside.md"));

	// The blueprints aren't pages of the site (the site's or the theme's), and the new pages are.
	({ ok, log } = ssqch(["build", "--root", d]));
	assert.ok(ok, log);
	assert.ok(!exists(dir, "dist/_blueprints") && !log.includes("_blueprints"), log);
	assert.ok(read(dir, "dist/about/index.html").includes("A page."));
	assert.ok(isFile(dir, "dist/posts/pine-cone-crunch/index.html") && isFile(dir, "dist/trails/old-growth-loop/index.html"));
	// A draft isn't built in production.
	assert.ok(!exists(dir, "dist/posts/2026-03-02-whats-new-in-0-4") && isFile(dir, "dist/posts/2026-01-05-winter-trails/index.html"));
});
