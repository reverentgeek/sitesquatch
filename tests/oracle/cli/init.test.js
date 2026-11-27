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
	for (const file of ["ssqch.config.js", "src/_includes/layout.jinja", "src/index.jinja", "src/tags.jinja", "src/tag.jinja", "src/img/stump.jpg", "src/posts/i-know-what-i-saw.md", "src/posts/upon-further-review-a-stump.md", "src/posts/the-stump-has-moved.md", "src/posts/raiders-of-the-lost-path.md", "src/posts/the-cache-of-the-wild.md", "src/posts/the-stump-has-a-forwarding-address.md", "src/posts/honey-i-shrunk-the-site.md", "src/404.md", "src/_data/site.json", "ssqch.d.ts", "jsconfig.json", ".gitignore", "AGENTS.md", "CLAUDE.md"]) {
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
	// DELIBERATE (0.13): the starter links each page's canonical address, its Markdown copy and llms.txt
	// (the audit's plan, step 3), and the copies' links are checked too.
	// DELIBERATE (0.13.5): the starter is a blog, with a page for each tag, a page of tags and a feed
	// (the new-blog run), so it has more links.
	// DELIBERATE (0.14): two more posts, on redirects and footprint budgets (the 0.5 review's
	// examples), and a redirect page for the one that moved.
	// DELIBERATE (0.14.1): paths in the feed's code (`/feed.xml`, the old address in backticks) are
	// examples, not links, as they are on a page.
	assert.ok(r.log.includes("Links   219 checked, 0 broken"), r.log);
	// The post that moved: its old address sends readers on, and stays out of the sitemap.
	assert.ok(read(dir, "dist/posts/where-did-the-stump-go/index.html").includes("<meta http-equiv=\"refresh\" content=\"0; url=/posts/the-stump-has-a-forwarding-address/\">") && !read(dir, "dist/sitemap.xml").includes("where-did-the-stump-go"), r.log);
	// The stump's photo, copied as its bytes, and made a <picture> in the post.
	assert.ok(fs.readFileSync(path.join(dir, "src/img/stump.jpg")).subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])), "a JPEG");
	assert.ok(read(dir, "dist/posts/upon-further-review-a-stump/index.html").includes("<picture><source type=\"image/webp\""), r.log);
	// The tab icon: the footprint, linked from every page.
	assert.ok(isFile(dir, "dist/favicon.svg") && read(dir, "dist/index.html").includes("<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\">"), r.log);
	assert.ok(read(dir, "dist/tags/stumps/index.html").includes("<title>Tagged stumps | Field Notes</title>") && read(dir, "dist/tags/index.html").includes("<a href=\"/tags/trails/\">trails</a> (2)"), r.log);
	assert.ok(read(dir, "dist/posts/the-cache-of-the-wild/index.html").includes("Tagged <a href=\"/tags/raccoons/\">raccoons</a>, <a href=\"/tags/trails/\">trails</a></p>"));
	assert.ok(read(dir, "dist/feed.xml").includes("<entry>\n    <title>The Cache of the Wild</title>\n    <link href=\"https://example.com/posts/the-cache-of-the-wild/\"/>") && read(dir, "dist/feed.xml").includes("<content type=\"html\">&lt;p&gt;"), read(dir, "dist/feed.xml"));
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
	assert.ok(r.log.includes("First confirmed sighting. Built in "), r.log);

	// The next post starts from the starter's blueprint, and is on the home page.
	r = ssqch(["new", "--root", d, "posts", "--title", "My second post", "--date", "2026-02-03"]);
	assert.deepEqual([r.ok, r.log], [true, "Created src/posts/my-second-post.md from src/_blueprints/posts.md. Fresh tracks: fill in its fields, then build.\n"]);
	assert.equal(read(dir, "src/posts/my-second-post.md"), "---\ntitle: My second post\ndate: 2026-02-03\n---\nWrite down what you saw.\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("Built in ") && !r.log.includes("First confirmed sighting"), r.log);
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
		for (const file of [`src/_includes/layout.${engine}`, `src/index.${engine}`, `src/tags.${engine}`, `src/tag.${engine}`]) {
			assert.ok(isFile(dir, file), `${file} wasn't created:\n${r.log}`);
		}
		assert.ok(!exists(dir, "src/index.jinja"), engine);
		const config = read(dir, "ssqch.config.js");
		assert.ok(config.includes(`templateFormats: ["${engine}", "md"],\n  markdownEngine: "${engine}",`), config);

		r = ssqch(["build", "--root", d]);
		assert.ok(r.ok, `${engine}: ${r.log}`);
		assert.ok(r.log.includes("Links   219 checked, 0 broken") && !r.log.includes("warn"), `${engine}: ${r.log}`);
		assert.ok(read(dir, "dist/posts/the-cache-of-the-wild/index.html").includes("Tagged <a href=\"/tags/raccoons/\">raccoons</a>, <a href=\"/tags/trails/\">trails</a></p>") && read(dir, "dist/feed.xml").includes("<content type=\"html\">&lt;p&gt;"), `${engine}: tags and feed`);
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

// The docs starter runs Pagefind (npx) on a production build; SEARCH=0 skips it, so a test
// doesn't fetch it.
const NO_SEARCH = { SEARCH: "0" };

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
		const r = ssqch(["build", "--root", dir], { env: NO_SEARCH });
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
			"<h2 id=\"notes\">Notes <a class=\"anchor\" data-pagefind-ignore href=\"#notes\"",
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
	assert.deepEqual([r.ok, r.log], [true, "Created src/docs/guides/search.md from src/_blueprints/docs.md. Fresh tracks: fill in its fields, then build.\n"]);
	r = ssqch(["build", "--root", d], { env: NO_SEARCH });
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

// Both new-site runs (2026-11-22): `npm init -y` on npm 12 writes `"type": "commonjs"`, and every
// command then warned `Failed to load the ES module ... ssqch.config.js`. DELIBERATE (0.13.5):
// init sets `"type": "module"` and adds `build` and `serve` scripts; a project with JavaScript of
// its own keeps its type and gets `ssqch.config.mjs`. No package.json, none written.
test("init_makes_package_json_ready", () => {
	const npmInit = "{\n  \"name\": \"camp\",\n  \"version\": \"1.0.0\",\n  \"main\": \"index.js\",\n  \"scripts\": {\n    \"test\": \"echo \\\"Error: no test specified\\\" && exit 1\"\n  },\n  \"type\": \"commonjs\"\n}\n";
	let dir = tempDir("init-package");
	write(dir, { "package.json": npmInit });
	let r = ssqch(["init", dir]);
	assert.ok(r.ok && r.stdout.includes("  updated package.json: \"type\": \"module\" and the build and serve scripts\n"), r.log);
	const pkg = JSON.parse(read(dir, "package.json"));
	assert.equal(pkg.type, "module");
	assert.deepEqual(pkg.scripts, { test: "echo \"Error: no test specified\" && exit 1", build: "ssqch build", serve: "ssqch serve" });
	assert.ok(read(dir, "package.json").startsWith("{\n  \"name\": \"camp\",") && read(dir, "package.json").endsWith("}\n"));
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && !r.log.includes("Failed to load the ES module"), r.log);
	// Again: nothing to change.
	r = ssqch(["init", dir]);
	assert.ok(r.ok && !r.stdout.includes("package.json") && r.stdout.includes("Nothing to do"), r.log);

	// A project with CommonJS of its own keeps its type, and the config is a .mjs.
	dir = tempDir("init-package-cjs");
	write(dir, { "package.json": npmInit, "lib/server.js": "module.exports = 1;\n" });
	r = ssqch(["init", dir]);
	assert.ok(r.ok && r.stdout.includes("  created ssqch.config.mjs\n") && !exists(dir, "ssqch.config.js"), r.log);
	assert.equal(JSON.parse(read(dir, "package.json")).type, "commonjs");
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && !r.log.includes("Failed to load the ES module"), r.log);
	r = ssqch(["init", dir]);
	assert.ok(r.stdout.includes("  kept    ssqch.config.mjs (already there)\n") && !exists(dir, "ssqch.config.js"), r.log);

	// DELIBERATE (0.16.2, the new docs site's rerun): with ssqch installed in the project, a bare
	// `ssqch serve` isn't on the PATH, so the last line says the script, or the package manager's
	// way to run it.
	dir = tempDir("init-package-local");
	write(dir, { "package.json": "{\n  \"name\": \"camp\",\n  \"devDependencies\": { \"ssqch\": \"^0.16.1\" }\n}\n" });
	r = ssqch(["init", dir], { env: { npm_command: "" } });
	assert.ok(r.ok && r.stdout.includes(` && npm run serve, then open http://localhost:8080\n`), r.log);
	dir = tempDir("init-package-pnpm");
	write(dir, { "package.json": "{\n  \"name\": \"camp\",\n  \"scripts\": { \"serve\": \"vite\" },\n  \"devDependencies\": { \"ssqch\": \"^0.16.1\" }\n}\n", "pnpm-lock.yaml": "" });
	r = ssqch(["init", dir], { env: { npm_command: "" } });
	assert.ok(r.ok && r.stdout.includes(` && pnpm exec ssqch serve, then open`), r.log);

	// No package.json: none is written.
	dir = fresh("init-no-package");
	assert.ok(ssqch(["init", dir]).ok);
	assert.ok(!exists(dir, "package.json"));
});

// Not from a Rust test (the Squatch Snacks rerun, 2026-11-23): beside a config of the site's own,
// init writes what any site uses (AGENTS.md, the types) and leaves the starter's pages out, since
// they need its config: 0.14.2 wrote src/tag.jinja, and the site stopped building on
// `collections.tagList`.
test("init_beside_a_config_of_its_own_leaves_the_starters_pages_out", () => {
	const dir = tempDir("init-own-config");
	write(dir, { "ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" } };\n", "src/index.md": "Ours\n" });
	let r = ssqch(["init", dir]);
	assert.ok(r.ok && r.stdout.includes("  kept    ssqch.config.js (already there)\n") && r.stdout.includes("  created AGENTS.md\n"), r.log);
	assert.match(r.stdout, /  left out the starter's \d+ files in src\/: they need the starter's config, and ssqch.config.js is this site's own\n/);
	assert.ok(!exists(dir, "src/tag.jinja") && !exists(dir, "src/posts") && isFile(dir, "ssqch.d.ts"), r.log);
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
});
