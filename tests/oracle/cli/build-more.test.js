// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read } from "../lib/ssqch.js";

/** Every file under `dir`, as paths with forward slashes. */
function walk(dir) {
	const out = [];
	const stack = [dir];
	while (stack.length) {
		const d = stack.pop();
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, entry.name);
			if (entry.isDirectory()) stack.push(p);
			else out.push(path.relative(dir, p).split(path.sep).join("/"));
		}
	}
	return out;
}

// EJS tags in `permalink` and `computed` are rendered, and a relative include in a theme's page
// or layout starts from that file's folder.
test("ejs_data_strings_and_theme_includes", () => {
	const dir = tempDir("ejs-data-strings");
	write(dir, {
		"ssqch.config.js": "export default { theme: \"themes/trail\", dirs: { input: \"src\" }, templateFormats: [\"ejs\"] };\n",
		"src/index.ejs": "---\ntitle: pine\npermalink: /<%= title %>/\ncomputed:\n  label: \"<%= title %> trail\"\nlayout: frame.ejs\n---\n<%= label %>\n",
		"themes/trail/cones.ejs": "<%- include(\"./card.ejs\") %>\n",
		"themes/trail/card.ejs": "Pine cones",
		"themes/trail/_includes/frame.ejs": "<main><%- content %></main><%- include(\"./frame-footer\") %>",
		"themes/trail/_includes/frame-footer.ejs": "<footer>stump</footer>",
	});
	const { ok, log } = ssqch(["build", "--root", dir]);
	assert.ok(ok, log);
	const r = (p) => { try { return read(dir, `_site/${p}`); } catch (e) { throw new Error(`${e.message}\n${log}`); } };
	assert.equal(r("pine/index.html"), "<main>pine trail\n</main><footer>stump</footer>");
	assert.equal(r("cones/index.html").trim(), "Pine cones");
});

// A page bundle and a theme leave out a template in a language the site doesn't render (it
// could be a draft), and a file name that isn't ASCII doesn't trip the check for a date in it.
test("bundles_leave_out_unrendered_templates", () => {
	let dir = tempDir("bundles-unrendered");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, bundles: true };\n",
		"src/trail/index.md": "# Trail\n",
		"src/trail/private.edge": "---\ndraft: true\ninternalNote: not ready to publish\n---\nUnpublished trail notes: {{ internalNote }}\n",
		"src/trail/notes.md": "---\npermalink: false\n---\nnot rendered here\n",
		"src/trail/map.svg": "<svg/>",
		"src/森林步道.md": "# Pine cones\n",
	});
	let { ok, log } = ssqch(["build", "--root", dir, "--env", "production", "--format", "json"]);
	assert.ok(ok, log);
	assert.ok(log.includes("private.edge isn't rendered"), log);
	let files = walk(path.join(dir, "dist"));
	assert.ok(files.some((f) => f.endsWith("trail/map.svg")), JSON.stringify(files));
	assert.ok(!files.some((f) => f.endsWith(".edge") || f.endsWith(".md")), JSON.stringify(files));
	assert.ok(files.some((f) => f.includes("森林步道")), JSON.stringify(files));

	// A theme's are left out the same way.
	dir = tempDir("theme-unrendered");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, theme: \"themes/trail\" };\n",
		"src/index.md": "# Trail\n",
		"themes/trail/private.edge": "---\ndraft: true\ninternalNote: unpublished\n---\nUnpublished trail notes: {{ internalNote }}\n",
		"themes/trail/cones.svg": "<svg/>",
	});
	({ ok, log } = ssqch(["build", "--root", dir, "--env", "production", "--format", "json"]));
	assert.ok(ok, log);
	assert.ok(log.includes("themes/trail/private.edge isn't rendered"), log);
	files = walk(path.join(dir, "dist"));
	assert.ok(files.some((f) => f.endsWith("cones.svg")), JSON.stringify(files));
	assert.ok(!files.some((f) => f.endsWith(".edge")), JSON.stringify(files));
});

// An alias is read as ssqch's key in its own layer of the cascade, so a page's `computed` is
// still above its folder's `eleventyComputed`; and a schema that flags unknown keys knows it.
test("aliases_keep_their_place_in_the_cascade", () => {
	const dir = tempDir("alias-cascade");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, schemas: { pages: { files: [\"**/*.md\"], fields: {}, unknown: \"error\" } } };\n",
		"src/posts/posts.json": "{ \"eleventyComputed\": { \"title\": \"Directory\" }, \"redirect_from\": [\"/old-trail/\"] }\n",
		"src/posts/pine.md": "---\ncomputed:\n  title: Page\n---\n{{ title }}\n",
		"src/posts/cedar.md": "---\neleventyComputed:\n  title: Cedar\nredirect_from: []\n---\n{{ title }}\n",
	});
	let { ok, log } = ssqch(["build", "--root", dir, "--format", "json"]);
	assert.ok(ok, log);
	const r = (p) => { try { return read(dir, `dist/${p}`); } catch (e) { throw new Error(`${e.message}\n${log}`); } };
	assert.equal(r("posts/pine/index.html").trim(), "<p>Page</p>");
	assert.equal(r("posts/cedar/index.html").trim(), "<p>Cedar</p>");

	// Both names in one layer is still an error, naming the file.
	write(dir, { "src/posts/posts.json": "{ \"eleventyComputed\": {}, \"computed\": {} }\n" });
	({ ok, log } = ssqch(["build", "--root", dir]));
	assert.ok(!ok && log.includes("posts.json") && log.includes("`eleventyComputed` and `computed` are two names for one key"), log);
});
