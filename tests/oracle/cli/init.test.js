// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { ssqch, expectedVersion, tempDir, write, read, exists, isFile } from "../lib/ssqch.js";

// A path that doesn't exist yet, as the Rust tests' temp_dir gives.
const fresh = (name) => path.join(tempDir(name), "site");

test("init_creates_a_site_that_builds", () => {
	const dir = fresh("init");
	const d = dir;
	let r = ssqch(["init", d]);
	assert.ok(r.ok, r.log);
	for (const file of ["ssqch.config.js", "src/_includes/layout.jinja", "src/index.jinja", "src/posts/i-know-what-i-saw.md", "src/posts/upon-further-review-a-stump.md", "src/posts/the-stump-has-moved.md", "src/posts/raiders-of-the-lost-path.md", "src/posts/the-cache-of-the-wild.md", "src/404.md", "src/_data/site.json", "ssqch.d.ts", "jsconfig.json", ".gitignore", "AGENTS.md", "CLAUDE.md"]) {
		assert.ok(isFile(dir, file), `${file} wasn't created:\n${r.log}`);
	}
	assert.ok(r.log.includes("Camp is set up. Next: cd "), r.log);
	// Instructions for coding agents: short, since an agent carries them through a session, and
	// pointing at what answers for this version. CLAUDE.md is the one-line import.
	const agents = read(dir, "AGENTS.md");
	assert.ok(Buffer.byteLength(agents) <= 1536 && agents.includes("`ssqch docs <name>`") && agents.includes("`src/posts/` has the posts") && agents.includes("(Jinja)") && agents.includes("`ssqch new posts --title"), `${Buffer.byteLength(agents)} bytes:\n${agents}`);
	assert.equal(read(dir, "CLAUDE.md"), "@AGENTS.md\n");
	const generic = ssqch(["docs", "agents"]);
	assert.ok(generic.ok && Buffer.byteLength(generic.log) <= 1536 && generic.log.startsWith("# A SiteSquatch site\n") && generic.log.includes("its `dirs` say where"), generic.log);
	// A site's own AGENTS.md is never replaced.
	write(dir, { "AGENTS.md": "Ours.\n" });
	r = ssqch(["init", d]);
	assert.ok(r.ok && r.log.includes("kept    AGENTS.md (already there)"), r.log);
	assert.equal(read(dir, "AGENTS.md"), "Ours.\n");

	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("Links   14 checked, 0 broken"), r.log);
	let home = read(dir, "dist/index.html");
	assert.ok(home.includes("<a href=\"/posts/i-know-what-i-saw/\">I Know What I Saw</a> (January 1, 2026)"), home);
	// Newest first.
	const at = (title) => {
		const i = home.indexOf(title);
		assert.notEqual(i, -1, `${title} isn't on the home page: ${home}`);
		return i;
	};
	assert.ok(at("The Stump Has Moved") < at("Upon Further Review, a Stump") && at("Upon Further Review, a Stump") < at("I Know What I Saw"), home);
	assert.ok(read(dir, "dist/404.html").includes("several eyewitness accounts"));
	// A site's first build says so; the next one doesn't.
	assert.ok(r.log.includes("First confirmed siting. Built in "), r.log);

	// The next post starts from the starter's blueprint, and is on the home page.
	r = ssqch(["new", "--root", d, "posts", "--title", "My second post", "--date", "2026-02-03"]);
	assert.deepEqual([r.ok, r.log], [true, "Created src/posts/my-second-post.md from src/_blueprints/posts.md. Field notes started.\n"]);
	assert.equal(read(dir, "src/posts/my-second-post.md"), "---\ntitle: My second post\ndate: 2026-02-03\n---\nWrite down what you saw.\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("Built in ") && !r.log.includes("First confirmed siting"), r.log);
	home = read(dir, "dist/index.html");
	assert.ok(home.includes("<a href=\"/posts/my-second-post/\">My second post</a> (February 3, 2026)") && !exists(dir, "dist/_blueprints"), home);

	// Running it again keeps what's there.
	write(dir, { "src/index.jinja": "mine" });
	r = ssqch(["init", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("Nothing to do"), r.log);
	assert.equal(read(dir, "src/index.jinja"), "mine");

	// --quiet prints only warnings and errors.
	const quiet = fresh("init-quiet");
	r = ssqch(["init", quiet, "--quiet"]);
	assert.ok(r.ok && r.log === "" && isFile(quiet, "src/index.jinja"), r.log);
});

test("init_starts_a_site_in_each_engine", () => {
	for (const engine of ["njk", "edge", "liquid", "hbs", "ejs"]) {
		const dir = fresh(`init-${engine}`);
		const d = dir;
		let r = ssqch(["init", d, "--engine", engine]);
		assert.ok(r.ok, r.log);
		for (const file of [`src/_includes/layout.${engine}`, `src/index.${engine}`]) {
			assert.ok(isFile(dir, file), `${file} wasn't created:\n${r.log}`);
		}
		assert.ok(!exists(dir, "src/index.jinja"), engine);
		const config = read(dir, "ssqch.config.js");
		assert.ok(config.includes(`templateFormats: ["${engine}", "md"],\n  markdownEngine: "${engine}",`), config);

		r = ssqch(["build", "--root", d]);
		assert.ok(r.ok, `${engine}: ${r.log}`);
		assert.ok(r.log.includes("Links   14 checked, 0 broken") && !r.log.includes("warn"), `${engine}: ${r.log}`);
		const home = read(dir, "dist/index.html");
		assert.ok(home.includes("<a href=\"/posts/i-know-what-i-saw/\">I Know What I Saw</a> (January 1, 2026)"), `${engine}: ${home}`);
		assert.ok(home.includes("<title>Field Notes</title>"), `${engine}: ${home}`);
		const post = read(dir, "dist/posts/i-know-what-i-saw/index.html");
		assert.ok(post.includes("<title>I Know What I Saw | Field Notes</title>") && post.includes("<h1>I Know What I Saw</h1>") && post.includes("<code>posts.json</code>"), `${engine}: ${post}`);
		assert.ok(post.includes(`Built with SiteSquatch ${expectedVersion()}. Allegedly.`), `${engine}: ${post}`);
		const missing = read(dir, "dist/404.html");
		assert.ok(missing.includes("<h1>Page not found</h1>") && missing.includes("<a href=\"/\">Back to the trailhead</a>"), `${engine}: ${missing}`);
	}
});

test("init_starts_a_docs_site", () => {
	const dir = fresh("init-docs");
	const d = dir;
	let r = ssqch(["init", d, "--starter", "docs"]);
	assert.ok(r.ok, r.log);
	for (const file of ["ssqch.config.js", "src/_data/nav.yml", "src/_includes/doc.jinja", "src/assets/docs.css", "src/docs/guides/writing.md", "ssqch.d.ts", ".gitignore"]) {
		assert.ok(isFile(dir, file), `${file} wasn't created:\n${r.log}`);
	}
	// The same pages, whichever language the templates are in.
	const check = (dir, engine) => {
		const r = ssqch(["build", "--root", dir]);
		assert.ok(r.ok, `${engine}: ${r.log}`);
		assert.ok(r.log.includes(", 0 broken") && !r.log.includes("warn"), `${engine}: ${r.log}`);
		const rd = (p) => read(dir, path.join("dist", p));
		const page = rd("docs/guides/writing/index.html");
		for (const expected of [
			"<title>Writing pages | Squatch Docs</title>",
			"<span>Guides</span> › <span aria-current=\"page\">Writing pages</span>",
			"<a href=\"/docs/guides/writing/\" aria-current=\"page\">Writing pages</a>",
			"<a rel=\"prev\" href=\"/docs/install/\">← Installation</a>",
			"<a rel=\"next\" href=\"/docs/guides/deploying/\">Deploying →</a>",
			"<a href=\"#tabs\">Tabs</a>",
			"<h2 id=\"notes\">Notes <a class=\"anchor\" href=\"#notes\"",
			"<div class=\"tabs\"><section class=\"tab\" data-label=\"npm\"><p class=\"tab-label\">npm</p>",
			"<div class=\"warning\"><p class=\"container-title\">Check twice</p>",
			"<details><summary>How do these work?</summary>",
			"<span class=\"line highlighted\">",
			"this site is called Squatch Docs.",
			// The page names the starter's own files.
			`<code>src/_includes/containers/name.${engine}</code>`,
		]) {
			assert.ok(page.includes(expected), `${engine}: missing ${JSON.stringify(expected)} in\n${page}`);
		}
		assert.ok(rd("404.html").includes("Page not found") && rd("index.html").includes("Read the docs"), engine);
		// The home page has no title of its own.
		assert.ok(rd("index.html").includes("<title>Squatch Docs</title>"), `${engine}: ${rd("index.html")}`);
	};
	check(dir, "jinja");
	const rd = (p) => read(dir, path.join("dist", p));
	// A new page from the starter's blueprint passes the starter's schema.
	r = ssqch(["new", "--root", d, "docs/guides", "--title", "Search"]);
	assert.deepEqual([r.ok, r.log], [true, "Created src/docs/guides/search.md from src/_blueprints/docs.md. Field notes started.\n"]);
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes("warn") && rd("docs/guides/search/index.html").includes("<title>Search | Squatch Docs</title>"), r.log);
	assert.ok(isFile(dir, "dist/assets/docs.js") && isFile(dir, "dist/highlight.css"));

	for (const engine of ["njk", "edge", "liquid", "hbs", "ejs"]) {
		const other = fresh(`init-docs-${engine}`);
		const r = ssqch(["init", other, "--starter", "docs", "--engine", engine]);
		assert.ok(r.ok, `${engine}: ${r.log}`);
		assert.ok(isFile(other, `src/_includes/doc.${engine}`) && !exists(other, "src/_includes/doc.jinja"), `${engine}: ${r.log}`);
		const config = read(other, "ssqch.config.js");
		assert.ok(config.includes(`templateFormats: ["${engine}", "md"],\n  markdownEngine: "${engine}",`), config);
		check(other, engine);
	}

	const other = fresh("init-docs-shop");
	r = ssqch(["init", other, "--starter", "shop"]);
	assert.ok(!r.ok && r.log.includes("--starter shop: not a starter (use site or docs)"), r.log);
	assert.ok(!fs.existsSync(other));
});

test("init_rejects_an_unknown_engine", () => {
	const dir = fresh("init-pug");
	const r = ssqch(["init", dir, "--engine", "pug"]);
	assert.ok(!r.ok);
	assert.ok(r.log.includes("--engine pug: not a starter engine (use jinja, njk, edge, liquid, hbs, ejs)"), r.log);
	assert.ok(!fs.existsSync(dir));
});
