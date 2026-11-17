// From crates/ssqch/tests/examples.rs: every site in examples/sites/ builds, with no broken links
// (each one uses linksPlugin, which fails a production build on a broken link).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, copyDir, read, isFile, REPO } from "../lib/ssqch.js";

function build(site, env = {}, extra = []) {
	return ssqch(["build", ...extra, "--root", site], { env });
}

function sites() {
	const dir = path.join(REPO, "examples/sites");
	return fs.readdirSync(dir).map((n) => path.join(dir, n)).filter((p) => isFile(p, "ssqch.config.js")).sort();
}

function copyOf(name, site) {
	const copy = tempDir(`example-${name}`);
	copyDir(site, copy, ["dist", ".cache"]);
	return copy;
}

test("every_example_builds_without_broken_links", () => {
	const all = sites();
	assert.ok(all.length >= 4, all.join(", "));
	for (const site of all) {
		const name = path.basename(site);
		const copy = copyOf(name, site);
		const { ok, log } = build(copy);
		assert.ok(ok, `${name} failed to build:\n${log}`);
		assert.ok(log.includes(", 0 broken"), `${name}: no link check in\n${log}`);
		assert.ok(isFile(copy, "README.md"), `${name} needs a README.md`);
	}
});

test("blog_categories_builds_the_staging_site", () => {
	const site = sites().find((s) => path.basename(s) === "blog-categories");
	const copy = copyOf("staging", site);
	const { ok, log } = build(copy, { SITE: "staging" });
	assert.ok(ok, log);
	const home = read(copy, "dist/index.html");
	assert.ok(home.includes("This is the staging site."), home);
	assert.ok(read(copy, "dist/sitemap.xml").includes("https://staging.blog-categories.sitesquatch.dev/"));
});

test("islands_load_scripts_only_where_they_are_used", () => {
	const site = sites().find((s) => path.basename(s) === "islands");
	const copy = copyOf("islands", site);
	let { ok, log } = build(copy);
	assert.ok(ok, log);
	assert.ok(log.includes("Elements  4 defined, 4 used on 3 pages"), log);
	const readOut = (p) => read(copy, path.join("dist", p));
	const home = readOut("index.html");
	assert.ok(home.includes("<link rel=\"stylesheet\" href=\"/elements/like-button.css\">\n</head>"), home);
	assert.ok(home.includes("<script type=\"module\" src=\"/elements/like-button.js\"></script>"), home);
	assert.ok(home.includes("[\"local-time\",\"/elements/local-time.js\",\"idle\"]") && !home.includes("trail-filter") && !home.includes("ssqch:load"), home);
	const trails = readOut("trails/index.html");
	assert.ok(trails.includes("[\"trail-filter\",\"/elements/trail-filter.js\",\"visible\"]") && trails.includes("like-button.js") && !trails.includes("local-time"), trails);
	assert.ok(trails.includes("<li data-level=\"easy\">Cedar Hollow: 3.2 miles, easy</li>"), trails);
	assert.ok(!readOut("about/index.html").includes("<script"), "the about page has no islands, so no scripts");
	// The trail cam's photos come from a folder, through files(), with their sizes and dates.
	const cam = readOut("trail-cam/index.html");
	assert.ok(cam.includes("[\"photo-gallery\",\"/elements/photo-gallery.js\",\"idle\"]") && cam.includes("href=\"/elements/photo-gallery.css\"") && !cam.includes("like-button"), cam);
	assert.ok(cam.includes("<a href=\"/images/trail-cam/20260616_01.png\" data-caption=\"The stump, which has moved.\">\n        <img src=\"/images/trail-cam/20260616_01.png\" width=\"320\" height=\"240\"") && cam.includes("<time datetime=\"2026-06-14\">June 14</time>"), cam);
	assert.ok(isFile(copy, "dist/images/trail-cam/20260614_01.png"));
	for (const file of ["like-button.js", "like-button.css", "local-time.js", "trail-filter.js", "photo-gallery.js", "photo-gallery.css", "shared/storage.js"]) {
		assert.ok(isFile(copy, path.join("dist/elements", file)), `${file} wasn't copied`);
	}

	// Under a base, the tags and the lazy loader's URLs both get it.
	({ ok, log } = build(copy, {}, ["--base", "/repo/"]));
	assert.ok(ok, log);
	const based = readOut("index.html");
	assert.ok(based.includes("src=\"/repo/elements/like-button.js\"") && based.includes("\"/repo/elements/local-time.js\""), based);
});
