// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ssqch, tempDir, write, read, exists, isFile, project } from "../lib/ssqch.js";

const unixOnly = { skip: process.platform === "win32" && "unix only" };

// The Rust `walk`: every file under `dir`, as forward-slash paths relative to it.
function walk(dir) {
	const out = [];
	const stack = [dir];
	while (stack.length) {
		const d = stack.pop();
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, entry.name);
			if (fs.statSync(p).isDirectory()) stack.push(p);
			else out.push(path.relative(dir, p).replaceAll("\\", "/"));
		}
	}
	return out;
}

test("development_builds_link_the_assets_a_production_build_left", () => {
	const dir = tempDir("assets-after-build");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "import { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [assetsPlugin({ files: [\"/assets/index.css\"] })] };\n");
	w("src/index.html", "<link rel=\"stylesheet\" href=\"/assets/index.css\"><p>hi</p>");
	w("dist/assets/index.css", "p { color: green }");

	let r = ssqch(["build", "--root", d, "--env", "production"]);
	assert.ok(r.ok, r.log);
	const built = read(dir, "dist/index.html");
	const href = built.split("href=\"")[1].split("\"")[0];
	assert.ok(href.startsWith("/assets/index.") && href !== "/assets/index.css", built);
	assert.ok(!exists(dir, "dist/assets/index.css"));

	// `ssqch serve` (a development build) without a CSS watcher links the built copy.
	r = ssqch(["build", "--root", d, "--env", "development"]);
	assert.ok(r.ok, r.log);
	const page = read(dir, "dist/index.html");
	assert.ok(page.includes(`href="${href}"`), page);
	assert.ok(r.log.includes("pages link to") && r.log.includes("from the last production build"), r.log);

	// Once a watcher writes the plain file, pages link to it.
	w("dist/assets/index.css", "p { color: blue }");
	r = ssqch(["build", "--root", d, "--env", "development"]);
	assert.ok(r.ok, r.log);
	assert.ok(read(dir, "dist/index.html").includes("href=\"/assets/index.css\""));
});

test("types_writes_the_declarations", () => {
	const dir = tempDir("types");
	const out = path.join(dir, "types/ssqch.d.ts");
	const r = ssqch(["types", "--out", out]);
	assert.ok(r.ok, r.log);
	const types = fs.readFileSync(out, "utf8");
	for (const module of ["\"ssqch\"", "\"ssqch/image\"", "\"ssqch/rss\"", "\"ssqch/minify\"", "\"ssqch/assets\"", "\"ssqch/links\""]) {
		assert.ok(types.includes(`declare module ${module}`), `missing ${module}`);
	}
	// A glob like `**/README.md` in a doc comment ends the comment early, and
	// the rest of the file stops parsing.
	types.split("\n").forEach((raw, n) => {
		const line = raw.trim();
		if (line.includes("*/")) {
			assert.ok(line.split("*/").length - 1 === 1 && line.endsWith("*/"), `ssqch.d.ts line ${n + 1}: a \`*/\` inside the comment closes it early: ${line}`);
		}
	});
});

test("leave_no_trace_removes_only_stale_files_ssqch_wrote", () => {
	const dir = tempDir("leave-no-trace");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	const config = (on) => `export default { leaveNoTrace: ${on}, passthrough: "files" };\n`;
	w("ssqch.config.js", config(false));
	w("keep.md", "Keep\n");
	w("gone.md", "Gone\n");
	w("files/old.txt", "old\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	// Another tool (a CSS build, say) writes into the output too.
	w("_site/assets/index.css", "body{}");

	fs.rmSync(path.join(dir, "gone.md"));
	fs.rmSync(path.join(dir, "files/old.txt"));
	const site = path.join(dir, "_site");
	// With it off, nothing goes.
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(isFile(site, "gone/index.html") && isFile(site, "files/old.txt"));

	w("ssqch.config.js", config(true));
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("Removed  2 stale files, left no trace"), r.log);
	assert.ok(!exists(site, "gone"), "the emptied folder goes too");
	assert.ok(!exists(site, "files/old.txt"));
	assert.ok(isFile(site, "keep/index.html"));
	assert.ok(isFile(site, "assets/index.css"), "files other tools wrote stay");

	// Nothing stale the next time.
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && !r.log.includes("Removed"), r.log);

	// `clean` is the option's other name.
	w("ssqch.config.js", "export default { clean: true, passthrough: \"files\" };\n");
	fs.rmSync(path.join(dir, "keep.md"));
	w("stay.md", "Stay\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(r.ok && r.log.includes("Removed  1 stale file, left no trace") && !exists(site, "keep"), r.log);
	// One name at a time.
	w("ssqch.config.js", "export default { leaveNoTrace: true, clean: true };\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("leaveNoTrace and clean are two names for one option; set one of them"), r.log);
	// In TOML it's `leave_no_trace`, or `clean`.
	fs.rmSync(path.join(dir, "ssqch.config.js"));
	for (const key of ["leave_no_trace", "clean"]) {
		w("sitesquatch.toml", `${key} = true\n`);
		const r = ssqch(["build", "--root", d]);
		assert.ok(r.ok, `${key}: ${r.log}`);
	}
});

// What moving lit.dev found: heading ids through the default Jinja, `layout: ""`, a computed
// layout, a layout file with no stem, linked passthrough files, the blank line after front
// matter, and the Node functions fast-glob, node-fetch and Lit's plugin load.
test("lit_dev_layouts_links_and_front_matter", () => {
	const dir = tempDir("lit-dev");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	const unix = process.platform !== "win32";
	w("ssqch.config.js", String.raw`import { pathToFileURL } from "node:url";
import path from "node:path";
import fs, { createReadStream } from "node:fs";
export default {
  dirs: { input: "src", output: "dist" },
  passthrough: ["src/samples"],
  data: { checks: async () => {
    const helper = await import(pathToFileURL(path.resolve("helper.js")).href);
    const names = await new Promise((resolve, reject) => fs.readdir("src", (err, list) => err ? reject(err) : resolve(list)));
    const missing = await new Promise((resolve) => fs.stat("nope", (err) => resolve(err.code)));
    fs.rmSync("link.js", { force: true });
    fs.symlinkSync("helper.js", "link.js");
    let stream;
    stream = typeof createReadStream;
    return [process.versions.node.split(".")[0], helper.pines, names.length, missing, fs.readlinkSync("link.js"), fs.lstatSync("link.js").isSymbolicLink(), stream].join(" ");
  } },
};
`);
	w("helper.js", "export const pines = 7;\n");
	w("src/index.md", "---\ntitle: Trails\n---\n## Cedar {#cedar .wide}\n\nIt’s {# a ranger's note #}open.\n\n## Old Growth {#old-growth}\n");
	w("src/robots.html", "---\nlayout: \"\"\n---\nUser-agent: *\n");
	w("src/_includes/article.html", "<article>{{ content }}</article>");
	w("src/_includes/.html", "<bare>{{ content }}</bare>");
	w("src/articles/articles.data.js", "export default { computed: { layout: \"article\" } };\n");
	w("src/articles/a.md", "Pine cones\n");
	w("src/stump.html", "---\nlayout: .html\n---\nstump");
	w("src/keywords.json.html", "---\npermalink: keywords.json\n---\n\n[\"pine\"]");
	w("src/checks.html", "{{ checks }}");
	w("src/samples/ts/a.ts", "export {};\n");
	fs.mkdirSync(path.join(dir, "src/samples/js"), { recursive: true });
	if (unix) fs.symlinkSync("../ts/a.ts", path.join(dir, "src/samples/js/a.ts"));
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const rd = (p) => read(dir, `dist/${p}`);
	assert.equal(rd("index.html"), "<h2 id=\"cedar\" class=\"wide\">Cedar</h2>\n<p>It’s open.</p>\n<h2 id=\"old-growth\">Old Growth</h2>\n");
	assert.equal(rd("robots/index.html"), "User-agent: *\n");
	assert.equal(rd("articles/a/index.html"), "<article><p>Pine cones</p>\n</article>");
	assert.equal(rd("stump/index.html"), "<bare>stump</bare>");
	assert.equal(rd("keywords.json"), "\n[\"pine\"]");
	// DELIBERATE (0.8): 0.7's QuickJS reported Node 24 and had no fs.createReadStream (calling it
	// threw); on Node both are Node's own.
	assert.match(rd("checks/index.html"), /^\d+ 7 8 ENOENT helper\.js true function$/);
	if (unix) assert.equal(rd("samples/js/a.ts"), "export {};\n");

	// A computed layout that depends on the page can't be applied, so it's an error.
	w("src/articles/articles.data.js", "export default { computed: { layout: (data) => \"article\" } };\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("`layout` in computed isn't applied"), r.log);
	// DELIBERATE (after 0.8.0): a computed `page` is refused too. It was thrown away without a word
	// (`page` is set after computed runs), and opensource.guide lost time to it (osg #5).
	w("src/articles/articles.data.js", "export default { computed: { page: (data) => ({ ...data.page, title: data.title }) } };\n");
	r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("`page` in computed isn't applied, because `page` is ssqch's"), r.log);
	w("src/articles/articles.data.js", "export default {};\n");
	// A link to nothing is named, not skipped.
	if (unix) {
		fs.symlinkSync("gone.ts", path.join(dir, "src/samples/js/b.ts"));
		r = ssqch(["build", "--root", d]);
		assert.ok(!r.ok && r.log.includes("src/samples/js/b.ts is a link to gone.ts, which doesn't exist"), r.log);
	}
});

test("site_plumbing", () => {
	const dir = tempDir("plumbing");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"edge\", \"md\", \"liquid\"],\n  ignore: [\"drafts/**\", \"**/README.md\"],\n  bundles: true,\n  passthrough: [{ \"assets/**/*.png\": \"images\" }],\n};\n");
	w("src/_includes/post.edge", "<p class=\"x\">{{{ page.excerpt }}}</p><p>{{ readingTime(content) }} min</p>{{{ content }}}");
	w("src/posts/trip/index.md", "+++\ntitle = \"Trip\"\nlayout = \"post.edge\"\n+++\nIntro *para*.\n\n<!-- more -->\nRest.\n");
	w("src/posts/trip/photo.jpg", "jpg");
	w("src/posts/trip/trip.json", "{ \"tags\": \"trips\" }");
	w("src/posts/old.markdown", "---json\n{ \"title\": \"Old\", \"draft\": true }\n---\n# Old\n");
	w("src/hi.liquid", "---\ntitle: Hi There\npermalink: \"/{{ title | slugify }}/\"\n---\n{{ title }}\n");
	w("src/drafts/wip.md", "wip");
	w("src/README.md", "readme");
	w("assets/icons/a.png", "png");
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const files = walk(path.join(dir, "dist")).filter((f) => !f.startsWith(".cache"));
	files.sort();
	assert.deepEqual(files, ["hi-there/index.html", "images/icons/a.png", "posts/trip/index.html", "posts/trip/photo.jpg"]);
	assert.equal(read(dir, "dist/posts/trip/index.html"), "<p class=\"x\"><p>Intro <em>para</em>.</p></p><p>1 min</p><p>Intro <em>para</em>.</p>\n<!-- more -->\n<p>Rest.</p>");
	// Drafts build in development.
	r = ssqch(["build", "--root", d, "-q", "--env", "development"]);
	assert.ok(r.ok, r.log);
	assert.ok(read(dir, "dist/posts/old/index.html").includes("<h1 id=\"old\">Old</h1>"));

	// strict: printing an undefined value fails, in any engine.
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"liquid\"], ignore: [\"posts/**\", \"drafts/**\", \"*.md\"], strict: true };\n");
	w("src/hi.liquid", "{% if nope %}x{% endif %}{{ titel }}");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("requested variable=titel"), r.log);
	w("src/hi.liquid", "fine");
	w("src/x.edge", "{{ page.url }} {{ titel }}");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("x.edge:1: `titel` is undefined (strict is on)"), r.log);
});

test("last_modified_from_git", () => {
	const dir = tempDir("lastmod");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	const git = (args, date) => {
		try {
			execFileSync("git", ["-C", dir, ...args], { stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
		} catch (e) {
			assert.fail(`git ${JSON.stringify(args)}: ${e.stderr}`);
		}
	};
	w("ssqch.config.js", "import { sitemapPlugin } from \"ssqch/sitemap\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, lastModified: \"git\", plugins: [sitemapPlugin({ url: \"https://example.com\" })] };\n");
	w("src/a.jinja", "{{ page.lastModified.toISOString() }}");
	w("src/b.jinja", "{{ page.lastModified.toISOString() }}");
	git(["init", "-q"], "2020-01-01T00:00:00Z");
	git(["add", "."], "2020-01-01T00:00:00Z");
	git(["commit", "-q", "-m", "first"], "2021-03-04T05:06:07Z");
	w("src/b.jinja", "{{ page.lastModified.toISOString() }} ");
	git(["commit", "-q", "-am", "second"], "2022-05-06T07:08:09Z");
	w("src/c.jinja", "{{ page.lastModified.getFullYear() }}");
	const r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/a/index.html"), "2021-03-04T05:06:07.000Z");
	assert.equal(read(dir, "dist/b/index.html"), "2022-05-06T07:08:09.000Z ");
	// Not committed yet: the file's own time.
	assert.ok(parseInt(read(dir, "dist/c/index.html").trim(), 10) >= 2026);
	assert.ok(read(dir, "dist/sitemap.xml").includes("<loc>https://example.com/a/</loc>\n    <lastmod>2021-03-04</lastmod>"), read(dir, "dist/sitemap.xml"));
});

test("hooks_run_commands", unixOnly, () => {
	const dir = tempDir("run");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "import { linksPlugin } from \"ssqch/links\";\nexport default {\n  dirs: { input: \"src\", output: \"dist\" },\n  afterBuild: [{ run: \"mkdir -p \\\"$SSQCH_OUTPUT/search\\\" && echo \\\"$SSQCH_ENV $SSQCH_SERVING\\\" > dist/search/index.js\" }, () => {}],\n  plugins: [linksPlugin()],\n};\n");
	// The command runs before the link checker, so the link it makes resolves.
	w("src/index.html", "<script src=\"/search/index.js\"></script>");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	assert.ok(r.log.includes("[ssqch] afterBuild: mkdir -p"), r.log);
	assert.equal(read(dir, "dist/search/index.js"), "production false\n");

	// A tool installed in the project's node_modules runs by name, as in an npm script.
	w("node_modules/.bin/pinecone", "#!/bin/sh\necho crunch > \"$SSQCH_OUTPUT/snack.txt\"\n");
	fs.chmodSync(path.join(dir, "node_modules/.bin/pinecone"), 0o755);
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, afterBuild: { run: \"pinecone\" } };\n");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/snack.txt"), "crunch\n");

	w("ssqch.config.js", "export default { beforeBuild: { run: \"exit 3\" } };\n");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("beforeBuild: `exit 3` exited with status 3"), r.log);
	w("ssqch.config.js", "export default { afterBuild: { cmd: \"x\" } };\n");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("afterBuild: \"cmd\" isn't an option (use { run: \"command\" })"), r.log);
});

// expressjs.com (ex #11): a broken include in a layout failed 222 pages, and the error printed the
// same lines three times. Each place is shown once, so a second, different one gets a frame too.
test("each_error_location_is_shown_once", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"njk\"] };\n",
		"_includes/trail.njk": "{{ nope() }}\n",
		"cedar.njk": "{% include \"trail.njk\" %}\n",
		"old-growth.njk": "{% include \"trail.njk\" %}\n",
		"ridge.njk": "{% include \"trail.njk\" %}\n",
		"stump.njk": "{{ nah() }}\n",
	});
	const r = ssqch(["build", "--root", root]);
	assert.ok(!r.ok);
	assert.equal(r.log.split("--> _includes/trail.njk:1").length - 1, 1, r.log);
	assert.match(r.log, /--> stump\.njk:1/);
});
