// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, exists } from "../lib/ssqch.js";

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

// Not from a Rust test: a failed build reports what 0.7's did. 0.7 rendered every page's body
// before any layout and stopped at the first phase that failed, so a broken filter in a body is
// one error, not one more for each layout that would have shown it.
test("a_failed_build_reports_the_first_phase_that_failed", () => {
	const dir = tempDir("phases");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\" }, templateFormats: [\"njk\"], filters: { boom: () => { throw new Error(\"no snacks\"); } } };\n",
		"src/_includes/base.njk": "{{ content | safe }}{{ \"x\" | layoutboom }}\n",
		"src/p1.njk": "---\nlayout: base.njk\n---\npage 1\n",
		"src/p2.njk": "---\nlayout: base.njk\n---\npage 2\n",
		"src/z.njk": "---\nlayout: base.njk\n---\n{{ \"x\" | boom }}\n",
		"src/late.njk": "---\nlayout: base.njk\n---\n{% for p in collections.all %}{{ p.url | boom }}{% endfor %}\n",
	});
	const errors = () => {
		const r = ssqch(["build", "--root", dir, "-q"]);
		assert.ok(!r.ok, r.log);
		return r.log.split("\n").filter((line) => line.startsWith("  - ")).map((line) => line.slice(4, line.indexOf(":")));
	};
	// The bodies of pages that don't read collections, then those that do, then layouts.
	assert.deepEqual(errors(), ["rendering z.njk with `njk`"]);
	write(dir, { "src/z.njk": "---\nlayout: base.njk\n---\nfine\n" });
	assert.deepEqual(errors(), ["rendering late.njk with `njk`"]);
	write(dir, { "src/late.njk": "---\nlayout: base.njk\n---\nfine\n" });
	// DELIBERATE (0.12): the layout's one error on the 4 pages is one line with the count
	// (vuejs.org's move printed one layout error 86 times); `--format json` still lists each.
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.log.includes("4 error(s):\n") && r.log.includes("(and 3 more pages with the same error: "), r.log);
	assert.deepEqual(errors().length, 1);
});

// `--profile` lists where the time went after the summary, the slowest of each kind, and prints
// it with --quiet too: it was asked for.
test("build_profile_lists_the_slowest_of_each_kind", () => {
	const dir = tempDir("profile");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"md\", \"njk\"], filters: { shout: (s) => String(s).toUpperCase() } };\n",
		"src/_includes/base.njk": "<main>{{ content | safe }}</main>\n",
		"src/index.njk": "---\nlayout: base.njk\n---\n{{ \"pine\" | shout }}\n",
	});
	let r = ssqch(["build", "--root", dir, "--profile"]);
	assert.ok(r.ok, r.log);
	assert.ok(r.stdout.includes("Built in ") && r.stdout.includes("Profile: where the time went, slowest first"), r.stdout);
	for (const heading of ["  Pages\n", "  Layouts (renders)\n", "  Template engines (renders)\n", "  Filters (calls)\n"]) assert.ok(r.stdout.includes(heading), `${heading.trim()} in:\n${r.stdout}`);
	assert.match(r.stdout, /\n {4}[\d.]+ [µm]?s {2}shout \(1\)\n/);
	r = ssqch(["build", "--root", dir, "--profile", "-q"]);
	assert.ok(!r.stdout.includes("Built in ") && r.stdout.includes("Profile: where the time went"), r.stdout);
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.stdout.includes("Profile:"), r.stdout);
});

// Added in 0.11, from the fresh a11yproject.com move: Eleventy's `addLayoutAlias("post",
// "layouts/post.njk")` made `layout: post` that file, and without it ssqch found
// `_includes/post.njk`, a partial. `layoutAliases` names it; the page's `layout` stays `post`.
test("layout_aliases_name_another_layout", () => {
	const dir = tempDir("layout-aliases");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"md\", \"njk\"], layoutAliases: { post: \"layouts/post.njk\" } };\n",
		"_includes/post.njk": "a post card",
		"_includes/layouts/post.njk": "<article data-layout=\"{{ layout }}\">{{ content | safe }}</article>",
		"pine.md": "---\nlayout: post\n---\nCones\n",
	});
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/pine/index.html"), "<article data-layout=\"post\"><p>Cones</p>\n</article>");
	write(dir, { "ssqch.config.js": "export default { layoutAliases: { a: \"b\", b: \"a\" } };\n", "pine.md": "---\nlayout: a\n---\nCones\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("Layout alias loop: a -> b -> a (layoutAliases)"), r.log);
	write(dir, { "ssqch.config.js": "export default { layoutAliases: [\"post\"] };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("layoutAliases must be an object of { name: layout }"), r.log);
});

// Added in 0.11, from the fresh opensource.guide move: Jekyll drops the blank lines after the
// closing `---` (every page and layout had one more `\n` in ssqch's build). DELIBERATE (0.13):
// `trimAfterFrontMatter` is gone. Those lines are whitespace browsers and `ssqch diff` don't see;
// where one matters (a feed), the template loses it, which `ssqch scout --patch` does.
test("trim_after_front_matter_is_gone", () => {
	const dir = tempDir("trim-front-matter");
	write(dir, {
		"ssqch.config.js": "export default { trimAfterFrontMatter: true, templateFormats: [\"liquid\"] };\n",
		"index.liquid": "---\n---\n\n<p>x</p>\n",
	});
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("\"trimAfterFrontMatter\" is gone: the blank lines after a template's front matter") && r.log.includes("`ssqch scout --patch`"), r.log);
	write(dir, { "ssqch.config.js": "export default { templateFormats: [\"liquid\"] };\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "\n<p>x</p>\n");
});

// Added in 0.11, from the fresh opensource.guide move: Jekyll's own `_site` was read as 405 more
// pages when ssqch wrote to `dist`.
test("another_generators_site_folder_isnt_read_as_pages", () => {
	const dir = tempDir("other-site-folder");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { output: \"dist\" } };\n",
		"index.md": "# Pine\n",
		"_site/index.html": "<p>Jekyll's</p>\n",
		"_site/trail/index.html": "<p>Jekyll's</p>\n",
		"guides/_site/index.md": "# Not at the top\n",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.ok(exists(dir, "dist/index.html") && !exists(dir, "dist/_site") && !exists(dir, "dist/trail"));
	assert.ok(exists(dir, "dist/guides/_site/index.html"));
});

// Added in 0.11, from the a11yproject.com rerun: a site that keeps eleventy-navigation's filter
// (as `ssqch import eleventy` does when templates call it) reads `eleventyNavigation` on purpose.
test("a_foreign_key_a_site_filter_reads_isnt_warned_about", () => {
	const dir = tempDir("foreign-key-kept");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"md\", \"liquid\"] };\n",
		"index.md": "---\neleventyNavigation:\n  key: Pine\n---\n# Pine\n",
	});
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && r.log.includes("sets `eleventyNavigation`"), r.log);
	write(dir, { "ssqch.config.js": "export default { templateFormats: [\"md\", \"liquid\"], filters: { eleventyNavigation: (pages) => pages } };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && !r.log.includes("eleventyNavigation"), r.log);
});

// Added in 0.11, from the fresh opensource.guide rerun: `/{{ page.filePathStem }}/` made every
// article's URL `//ar/metrics/`, and the files landed where they should, so nothing said so.
test("a_url_with_a_double_slash_is_warned_about", () => {
	const dir = tempDir("double-slash");
	write(dir, {
		"ssqch.config.js": "export default {};\n",
		"guides/guides.json": "{ \"permalink\": \"/{{ page.filePathStem }}/\" }\n",
		"guides/pine.md": "# Pine\n",
		"index.md": "# Home\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && r.log.includes("warn: 1 page has `//` in its URL: //guides/pine/ (./guides/pine.md). Its permalink puts a `/` before a value that starts with one"), r.log);
});

// Added in 0.11, from the fresh opensource.guide rerun: `site.articles` (a Jekyll collection) was
// empty on 380 pages with no word; it's warned about as `site.posts` is.
test("a_jekyll_collection_under_site_is_warned_about", () => {
	const dir = tempDir("site-collection");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"md\", \"liquid\"] };\n",
		"_articles/pine.md": "---\ntags: articles\n---\n# Pine\n",
		"index.liquid": "{% for a in site.articles %}{{ a.url }}{% endfor %}",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && r.log.includes("warn: index.liquid uses `site.articles` (Jekyll's). ssqch's lists of pages are `collections`: `collections.articles` is the pages tagged `articles`"), r.log);
});

// Added in 0.12, from the fresh vuejs.org run: VitePress's data loaders (`api/api.data.ts`) are
// named the way ssqch names a folder's data, and `ignore` didn't keep them out.
test("ignore_keeps_a_data_file_out_and_a_data_error_says_why_it_was_read", () => {
	const dir = tempDir("data-ignore");
	write(dir, {
		"ssqch.config.js": "export default {};\n",
		"api/api.data.js": "import md from \"markdown-it-not-installed\";\nexport default { load: () => md };\n",
		"api/index.md": "# API\n",
	});
	let r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("ssqch read api/api.data.js as the directory data for api/, by its name: if it isn't ssqch data (a VitePress loader is named this way too), list it in `ignore`"), r.log);
	write(dir, { "ssqch.config.js": "export default { ignore: [\"**/*.data.js\"] };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && exists(dir, "_site/api/index.html"), r.log);
});

// Added in 0.12, from the fresh vuejs.org run: VitePress's `page: true` on 9 pages was replaced by
// ssqch's `page` with no word.
test("front_matter_page_is_warned_about", () => {
	const dir = tempDir("front-matter-page");
	write(dir, {
		"ssqch.config.js": "export default {};\n",
		"index.md": "---\npage: true\n---\n# Home\n",
		"about.md": "# About\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && r.log.includes("warn: index.md sets `page` in its front matter. `page` is ssqch's (the page's url, inputPath, date and headings), so the front matter's value is replaced"), r.log);
});

// Added in 0.12, from the fresh vuejs.org run: one layout's error printed once for each of 86 pages.
test("the_same_error_on_many_pages_is_one_line", () => {
	const dir = tempDir("same-error");
	const pages = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i + 1}.md`, "---\nlayout: base.jinja\n---\nhi\n"]));
	write(dir, { "ssqch.config.js": "export default {};\n", "_includes/base.jinja": "{% if x is matching %}y{% endif %}{{ content }}\n", ...pages });
	const r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("5 error(s):\n  - rendering layout _includes/base.jinja for p1.md: _includes/base.jinja:1: unknown test `matching` (and 4 more pages with the same error: p2.md, p3.md, p4.md, ...)\n"), r.log);
});

// Added in 0.12, from the fresh vuejs.org run: what a VitePress site needed as hooks and filters.
// DELIBERATE (0.13): `containers: "markdown-it"` is what `containers: true` does (step 7), so the
// indented closing `:::` below needs no option.
test("vitepress_habits_have_options", () => {
	const dir = tempDir("vitepress-options");
	write(dir, {
		"ssqch.config.js": [
			"import { sitemapPlugin } from \"ssqch/sitemap\";",
			"export default {",
			"\turls: \"html\",",
			"\tmarkdown: { autolinks: \"email\", preprocess: async (source) => source.replace(/<script setup>[\\s\\S]*?<\\/script>\\n?/g, \"\") },",
			"\tplugins: [sitemapPlugin({ url: \"https://trail.example\" })],",
			"};",
		].join("\n"),
		"_includes/hooks/table.jinja": "<table tabindex=\"0\">{{ table.content | safe }}</table>",
		"index.md": "# Home\n",
		"guide/index.md": "# Guide\n",
		"guide/intro.md": "<script setup>\nimport Pine from \"./Pine.vue\"\n</script>\n\n::: info\n- Write ranger@example.com\n- not example.com\n  :::\n\n| Trail | Miles |\n| --- | --- |\n| Cedar | 3 |\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.ok(exists(dir, "_site/guide/intro.html") && exists(dir, "_site/guide/index.html") && exists(dir, "_site/index.html"));
	assert.equal(read(dir, "_site/guide/intro.html"), "<div class=\"info\">\n<ul>\n<li>Write <a href=\"mailto:ranger@example.com\">ranger@example.com</a></li>\n<li>not example.com</li>\n</ul>\n</div>\n<table tabindex=\"0\"><thead><tr><th>Trail</th><th>Miles</th></tr></thead><tbody>\n<tr><td>Cedar</td><td>3</td></tr>\n</tbody></table>\n");
	// DELIBERATE (0.13): `format: "vitepress"` is gone (byte parity no reader of a sitemap needs);
	// `urls: "html"` still gives the same URLs, in ssqch's sitemap.
	const sitemap = read(dir, "_site/sitemap.xml");
	for (const loc of ["https://trail.example/</loc>", "https://trail.example/guide/</loc>", "https://trail.example/guide/intro.html</loc>"]) assert.ok(sitemap.includes(`<loc>${loc}`), sitemap);
	write(dir, { "ssqch.config.js": "import { sitemapPlugin } from \"ssqch/sitemap\";\nexport default { plugins: [sitemapPlugin({ url: \"https://trail.example\", format: \"vitepress\" })] };\n" });
	const gone = ssqch(["build", "--root", dir]);
	assert.ok(!gone.ok && gone.log.includes("`format` is gone: the sitemap is ssqch's own"), gone.log);
	// Wrong values say what they can be.
	write(dir, { "ssqch.config.js": "export default { urls: \"ugly\" };\n" });
	const bad = ssqch(["build", "--root", dir]);
	assert.ok(!bad.ok && bad.log.includes("urls must be \"folders\" (/guide/intro/) or \"html\" (/guide/intro.html), not \"ugly\""), bad.log);
	write(dir, { "ssqch.config.js": "export default { markdown: { containers: \"markdown-it\" } };\n" });
	const old = ssqch(["build", "--root", dir]);
	assert.ok(!old.ok && old.log.includes("markdown.containers: \"markdown-it\" is what `containers: true` does now"), old.log);
});

// Added in 0.12, from the fresh vuejs.org run: VitePress's Markdown, as one option.
// DELIBERATE (0.13): VitePress's Markdown is fromVitepress() from "ssqch/from-vitepress" (the
// audit's plan, step 6), which writes what `dialect: "vitepress"` did.
test("the_vitepress_dialect_writes_vitepress_markup", () => {
	const dir = tempDir("vitepress-dialect");
	write(dir, {
		"ssqch.config.js": "import { fromVitepress } from \"ssqch/from-vitepress\";\nexport default { urls: \"html\", markdownEngine: false, plugins: [fromVitepress()] };\n",
		"_includes/containers/warning.jinja": "<aside class=\"own\">{{ container.content | safe }}</aside>",
		"guide/intro.md": "<script setup>\nimport { ref } from 'vue'\n</script>\n\n## What's Vue?\n\nRead [the guide](./next.md) or [Vue School](https://vueschool.io).\n\n::: tip\n- one\n  :::\n\n::: warning\nOurs\n:::\n",
		"guide/next.md": "# Next\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/guide/intro.html"), "<h2 id=\"what-s-vue\" tabindex=\"-1\">What's Vue? <a class=\"header-anchor\" href=\"#what-s-vue\" aria-label=\"Permalink to “What's Vue?”\">​</a></h2>\n<p>Read <a href=\"./next.html\">the guide</a> or <a href=\"https://vueschool.io\" target=\"_blank\" rel=\"noreferrer\">Vue School</a>.</p>\n<div class=\"tip custom-block\"><p class=\"custom-block-title custom-block-title-default\">TIP</p>\n<ul>\n<li>one</li>\n</ul>\n</div>\n<aside class=\"own\"><p>Ours</p>\n</aside>\n");
});

// Not from a Rust test (the Squatch Snacks rerun, 2026-11-23): an error rendering a paginated
// page, or working out its `computed`, says which item it was on, as a schema's error does, and
// the same error on two items is still one line, naming the others.
test("errors_on_a_paginated_page_name_the_item", () => {
	const dir = tempDir("paginated-errors");
	write(dir, {
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, filters: { money: (n) => n.toFixed(2) } };\n",
		"src/_data/snacks.json": "[{ \"name\": \"Pine Cone Crunch\", \"price\": 3 }, { \"name\": \"Moss Mix\" }, { \"name\": \"Summit Brittle\" }]",
		"src/snack.jinja": "---\npagination: { data: snacks, size: 1, alias: snack }\npermalink: \"/{{ snack.name | slugify }}/\"\n---\n{{ snack.price | money }}\n",
	});
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("  - rendering snack.jinja with `jinja` (item 2 of snacks, \"Moss Mix\"): snack.jinja:5: money(): "), r.log);
	assert.ok(r.log.includes("(and 1 more page with the same error: snack.jinja (item 3 of snacks, \"Summit Brittle\"))"), r.log);
	write(dir, { "src/snack.jinja": "---\npagination: { data: snacks, size: 1, alias: snack }\npermalink: \"/{{ snack.name | slugify }}/\"\ncomputed:\n  cents: \"{{ snack.price.toFixed(2) }}\"\n---\nx\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("in snack.jinja: computed.cents (item 2 of snacks, \"Moss Mix\"): "), r.log);
});
