// From crates/ssqch/tests/cli.rs, where these were `ssqch import`'s tests.
//
// DELIBERATE (0.11): `ssqch import <generator> [--write]` became `ssqch scout [dir]`, with no
// alias. It finds the generator itself (`--from` chooses), changes nothing unless asked, and is
// safe to run again during a move to see what's left: `--write-draft` writes the new files (never
// over one), and `--patch <file>` writes the edits as a patch, which a person or an agent reads
// and applies. What `import --write` did is both, and `git apply`: `move()` below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ssqch, tempDir, write, read, exists, isFile, expectedVersion } from "../lib/ssqch.js";

/** What `ssqch import --write` did: scout's draft written, and its patch applied with `git apply`. */
function move(dir, from) {
	const patch = path.join(tempDir("scout-patch"), "move.patch");
	const r = ssqch(["scout", dir, "--from", from, "--write-draft", "--patch", patch]);
	if (!r.ok) return r;
	if (read(path.dirname(patch), "move.patch") === "") return r;
	// Windows' git writes CRLF when it applies a patch (core.autocrlf), which is the machine's setting, not the patch's.
	const applied = spawnSync("git", ["-c", "core.autocrlf=false", "apply", patch], { cwd: dir, encoding: "utf8" });
	assert.equal(applied.status, 0, `git apply: ${applied.stderr}\n${read(path.dirname(patch), "move.patch")}`);
	return r;
}

test("scout_moves_an_eleventy_site", () => {
	const dir = tempDir("scout");
	const d = dir;
	write(dir, {
		".eleventy.js": "const pluginRss = require(\"@11ty/eleventy-plugin-rss\");\nmodule.exports = function (eleventyConfig) {\n  eleventyConfig.addPlugin(pluginRss);\n  eleventyConfig.addPassthroughCopy(\"src/css\");\n  eleventyConfig.addFilter(\"shout\", (s) => s.toUpperCase());\n  return { dir: { input: \"src\", output: \"_site\" }, markdownTemplateEngine: \"njk\", htmlTemplateEngine: \"njk\" };\n};\n",
		"src/_includes/base.njk": "<title>{{ label or title }}</title>{{ content | safe }}",
		"src/index.njk": "---\ntitle: Home\neleventyExcludeFromCollections: true\n---\n{% for post in collections.post %}<a href=\"{{ post.url }}\">{{ post.data.label }}</a>{% endfor %} {{ collections.all | length }}",
		"src/posts/posts.11tydata.json": "{ \"layout\": \"base.njk\", \"tags\": \"post\", \"eleventyComputed\": { \"label\": \"Post: {{ title }}\" } }",
		"src/posts/pine.md": "---\ntitle: Pine\ntemplateEngineOverride: njk,md\n---\n*{{ title }}* <img src=\"/css/x.png\" eleventy:ignore>\n",
		"src/feed.11ty.js": "module.exports = class {};",
		"src/css/site.css": "body {}",
		"_site/old/index.html": "from the last Eleventy build",
		"package.json": "{\n  \"scripts\": {\n    \"build\": \"eleventy\",\n    \"start\": \"eleventy --serve\"\n  },\n  \"dependencies\": {\n    \"@11ty/eleventy\": \"^3.1.8\"\n  },\n  \"packageManager\": \"pnpm@12.21.0\"\n}\n",
		"pnpm-lock.yaml": "packages:\n  '@11ty/eleventy@3.1.8': {}\n",
		"package-lock.json": "{ \"packages\": { \"node_modules/@11ty/eleventy\": {} } }",
	});
	const before = read(dir, "src/index.njk");

	// A dry run says what it would do, and does nothing.
	let r = ssqch(["scout", d]);
	assert.ok(r.ok, r.log);
	for (const expected of [
		"Scouting the Eleventy site in ",
		" (found .eleventy.js)\n",
		"Draft (1 to write): --write-draft writes them, and never overwrites a file\n  ssqch.config.js (a first draft, from .eleventy.js)\n",
		"  src/posts/posts.11tydata.json -> src/posts/posts.data.json\n",
		// DELIBERATE (0.11): Eleventy's front matter keys work in ssqch, so pages aren't edited for
		// them; the image attributes still change.
		"  src/posts/pine.md: eleventy:widths/ignore -> ssqch:widths/ignore\n",
		"  [not yet] src/feed.11ty.js: JavaScript templates don't run in ssqch",
		`  package.json: @11ty/eleventy -> ssqch ${expectedVersion()} in devDependencies, scripts: eleventy -> ssqch build, eleventy --serve -> ssqch serve\n`,
		"  pnpm-workspace.yaml: pnpm waits a day before installing a new release, so if ssqch ",
		"  pnpm-lock.yaml: run `pnpm install` to update it for ssqch\n",
		"  package-lock.json: npm's lockfile, but the site uses pnpm: delete it (a host that installs from it gets Eleventy and no ssqch)\n",
		"  .eleventy.js: @11ty/eleventy-plugin-rss -> `rssPlugin()` from \"ssqch/rss\"",
	]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
	// The filter moves to the draft as written, so it isn't on the list.
	assert.ok(!r.log.includes("addFilter(\"shout\")"), r.log);
	assert.ok(!r.log.includes("_site/old"), r.log);
	assert.equal(read(dir, "src/index.njk"), before);
	assert.ok(!exists(dir, "ssqch.config.js") && exists(dir, "src/posts/posts.11tydata.json"));

	// With --write, the site builds with ssqch.
	r = move(d, "eleventy");
	assert.ok(r.ok && r.log.includes("Wrote 1 draft file.") && r.log.includes("Wrote 3 edits to "), r.log);
	assert.equal(
		read(dir, "package.json"),
		`{\n  "scripts": {\n    "build": "ssqch build",\n    "start": "ssqch serve"\n  },\n  "packageManager": "pnpm@12.21.0",\n  "devDependencies": {\n    "ssqch": "${expectedVersion()}"\n  }\n}\n`,
	);
	assert.ok(read(dir, "src/posts/posts.data.json").includes("\"eleventyComputed\""));
	const config = read(dir, "ssqch.config.js");
	assert.ok(config.includes("dirs: { input: \"src\", output: \"_site\" },") && config.includes("markdownEngine: \"njk\",\n  htmlEngine: \"njk\",") && config.includes("passthrough: [\"src/css\"],") && config.includes("    shout: (s) => s.toUpperCase(),\n"), config);
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `_site/${p}`);
	assert.equal(out("index.html"), "<a href=\"/posts/pine/\">Post: Pine</a> 1");
	assert.equal(out("posts/pine/index.html"), "<title>Post: Pine</title><p><em>Pine</em> <img src=\"/css/x.png\" ssqch:ignore></p>\n");
	assert.ok(isFile(dir, "_site/css/site.css"));

	// A second run has nothing left to change, and keeps the config that's there.
	// A second run is a progress check: the draft is there, and nothing's left to edit.
	r = ssqch(["scout", d]);
	// DELIBERATE (0.16.2): the config's own file name, where it said "an ssqch.config.js" for a
	// `.mjs` one too (redux.js.org's and a Gatsby blog's moves).
	assert.ok(r.ok && r.log.includes(": a move under way, with ssqch.config.js\n") && r.log.includes("Draft (0 to write, 1 there already)") && r.log.includes("  ssqch.config.js (a first draft, from .eleventy.js) [there already]\n") && !r.log.includes("Edits ("), r.log);
	// A folder with no generator's files, or two generators', asks for --from.
	const empty = tempDir("scout-empty");
	r = ssqch(["scout", empty]);
	assert.ok(!r.ok && r.log.includes("couldn't tell which generator builds the site in ") && r.log.includes("Name it with --from (eleventy, jekyll, zola, hugo, mkdocs,"), r.log);
	write(empty, { "mkdocs.yml": "site_name: Trail\n", "_config.yml": "title: Trail\n" });
	r = ssqch(["scout", empty]);
	assert.ok(!r.ok && r.log.includes("more than one generator's files are in ") && r.log.includes("(MkDocs: mkdocs.yml; Jekyll: _config.yml): choose with --from"), r.log);
	// DELIBERATE (0.16.2): Gatsby and Next.js are read lightly, as Astro is (a Gatsby blog's move:
	// `ssqch build` sent it to scout, which refused Gatsby).
	r = ssqch(["scout", empty, "--from", "pelican"]);
	assert.ok(!r.ok && r.log.includes("pelican: not a generator scout knows"), r.log);
	const gatsby = tempDir("scout-gatsby");
	write(gatsby, {
		"gatsby-config.js": "module.exports = { plugins: [\"gatsby-plugin-sitemap\", \"gatsby-remark-prismjs\"] };\n",
		"package.json": JSON.stringify({ scripts: { build: "gatsby build" }, dependencies: { gatsby: "5.15.0", "gatsby-plugin-sitemap": "6.15.0", "gatsby-remark-prismjs": "7.15.0" } }),
		"src/pages/index.jsx": "import { graphql } from \"gatsby\";\nexport const query = graphql`{ site { siteMetadata { title } } }`;\nexport default function Home() { return <h1>Trail</h1>; }\n",
		"src/pages/index.test.jsx": "test(\"home\", () => {});\n",
		"content/posts/pine.md": "---\ntitle: Pine\ndate: 2026-01-02\n---\nCones\n",
		"static/cone.png": "",
	});
	const scouted = JSON.parse(ssqch(["scout", gatsby, "--format", "json"]).stdout);
	assert.equal(scouted.generator, "gatsby", JSON.stringify(scouted));
	const codes = scouted.todo.map((t) => t.code);
	for (const code of ["gatsby-react", "gatsby-graphql", "gatsby-static", "gatsby-plugin"]) assert.ok(codes.includes(code), `${code}: ${codes}`);
	assert.equal(scouted.todo.find((t) => t.code === "gatsby-react").files, 1, "the test file isn't a component");
	assert.equal(scouted.build.command, "npm run build", JSON.stringify(scouted.build));
	assert.ok(ssqch(["docs", "--from", "next"]).log.startsWith("Next.js's words"));
});

// A config's names, a script's flags and its indentation, in any script and after a byte-order
// mark, read as 0.7's Rust patterns read them.
test("scout_reads_names_in_any_script", () => {
	const dir = tempDir("scout-unicode");
	write(dir, {
		"eleventy.config.js": "﻿const pluginÉté = require(\"@11ty/eleventy-plugin-rss\");\nmodule.exports = function (eleventyConfig) {\n\televentyConfig.addPlugin(pluginÉté);\n\televentyConfig.addFilter(\"shout\", (value) => {\n\t\treturn value;\n\t});\n};\n",
		"package.json": "{\n  \"scripts\": {\n    \"build\": \"eleventy --pathprefix /x/ --verbosé\"\n  }\n}\n",
	});
	let r = move(dir, "eleventy");
	assert.ok(r.ok, r.log);
	for (const expected of ["  eleventy.config.js:3: addPlugin(pluginÉté) (from @11ty/eleventy-plugin-rss) -> see its package below\n", "  package.json: the `build` script's --verbosé flag is Eleventy's"]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
	assert.equal(read(dir, "package.json"), "{\n  \"scripts\": {\n    \"build\": \"ssqch build --base /x/\"\n  }\n}\n");
	const config = read(dir, "ssqch.config.js");
	assert.ok(config.includes("\n\tmarkdownEngine: \"liquid\",\n") && config.includes("\t\tshout: (value) => {\n\t\t\treturn value;\n\t\t},\n"), config);

	// A Zola config that isn't TOML shows the line and the spot, in TOML's words.
	const zola = tempDir("scout-zola-error");
	write(zola, { "config.toml": "title = \"x\"\n= 2\n", "templates": "{{ page.title }}" });
	r = ssqch(["scout", "--from", "zola", zola]);
	assert.equal(r.code, 1, r.log);
	assert.ok(r.stderr.startsWith("error: config.toml: TOML parse error at line 2, column 1\n  |\n2 | = 2\n  | ^\n"), r.stderr);
	// `templates` can be a file, and it's a template.
	write(zola, { "config.toml": "title = \"x\"\n" });
	r = ssqch(["scout", "--from", "zola", zola]);
	assert.ok(r.ok && r.log.includes("  templates/: 1 Tera templates: ") && r.log.includes("  templates/: 1 x `page.title`"), r.log);
});

// package.json changes where it changes. 0.7 printed the whole file again (a list on several
// lines, `1e5` as `100000.0`, its dev dependencies sorted); the Node build edits the text in place.
test("scout_keeps_package_json_as_written", () => {
	const dir = tempDir("scout-package");
	write(dir, {
		"eleventy.config.js": "module.exports = () => ({});\n",
		"package.json": "{\n\t\"name\": \"trail-guide\",\n\t\"weight\": 1.0,\n\t\"exp\": 1e5,\n\t\"keywords\": [\"pine\", \"cone\"],\n\t\"scripts\": { \"build\": \"eleventy\" },\n\t\"devDependencies\": {\n\t\t\"@11ty/eleventy\": \"^3.0.0\",\n\t\t\"zed\": \"1\"\n\t}\n}\n",
	});
	const r = move(dir, "eleventy");
	assert.ok(r.ok, r.log);
	const v = expectedVersion();
	assert.equal(read(dir, "package.json"), `{\n\t"name": "trail-guide",\n\t"weight": 1.0,\n\t"exp": 1e5,\n\t"keywords": ["pine", "cone"],\n\t"scripts": { "build": "ssqch build" },\n\t"devDependencies": {\n\t\t"ssqch": "${v}",\n\t\t"zed": "1"\n\t}\n}\n`);
});

// A template literal with `${...}` is worked out when the config runs, and a default value that
// reads the config needs it: 0.7 put both in the draft as they were, the Node build lists them.
test("scout_leaves_computed_names_and_config_defaults_for_a_person", () => {
	const dir = tempDir("scout-computed");
	write(dir, { "eleventy.config.js": "const dir = \"static\";\nconst dateFormat = \"%Y\";\nmodule.exports = function (eleventyConfig) {\n\televentyConfig.addPassthroughCopy(`${dir}/img`);\n\televentyConfig.addFilter(\"year\", (value, format = dateFormat) => format + value);\n};\n" });
	const r = move(dir, "eleventy");
	assert.ok(r.ok, r.log);
	const config = read(dir, "ssqch.config.js");
	assert.ok(!config.includes("${dir}") && !config.includes("dateFormat") && config.includes("//   filters: year\n"), config);
	for (const expected of ["  eleventy.config.js:4: addPassthroughCopy with a variable or a computed value -> ", "  eleventy.config.js:5: addFilter(\"year\") -> "]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
});

// Eleventy's EJS templates render in ssqch as they are: `include()` reads from `_includes` in both.
test("scout_carries_over_ejs_templates", () => {
	const dir = tempDir("scout-ejs");
	const d = dir;
	write(dir, {
		"eleventy.config.js": "module.exports = function (eleventyConfig) {\n  return { dir: { input: \"src\" }, markdownTemplateEngine: false };\n};\n",
		"src/_includes/base.ejs": "<%- include(\"nav\") %><main><%- content %></main>",
		"src/_includes/nav.ejs": "<nav><%= title %></nav>",
		"src/index.ejs": "---\nlayout: base.ejs\ntitle: Camp\neleventyExcludeFromCollections: true\n---\n<% for (const post of collections.all) { %><a href=\"<%= post.url %>\"><%= post.data.title %></a><% } %>",
		"src/trail.md": "---\nlayout: base.ejs\ntitle: Trail\n---\nOld Growth.\n",
	});
	let r = move(d, "eleventy");
	// DELIBERATE (0.11): `eleventyExcludeFromCollections` works as it is; the page isn't edited.
	assert.ok(r.ok && !r.log.includes("src/index.ejs: eleventyExcludeFromCollections"), r.log);
	const config = read(dir, "ssqch.config.js");
	assert.ok(config.includes("templateFormats: [\"ejs\", \"md\"],"), config);
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `_site/${p}`);
	assert.equal(out("index.html"), "<nav>Camp</nav><main><a href=\"/trail/\">Trail</a></main>");
	assert.equal(out("trail/index.html"), "<nav>Trail</nav><main><p>Old Growth.</p>\n</main>");
});

test("scout_moves_a_zola_site", () => {
	const dir = tempDir("scout-zola");
	const d = dir;
	write(dir, {
		"config.toml": "base_url = \"https://example.com\"\ntitle = \"Trail Notes\"\ngenerate_feeds = true\ntaxonomies = [{ name = \"tags\" }]\n\n[markdown]\nhighlight_code = true\n\n[extra]\nauthor = \"Sam\"\nfounded = 2019-05-01\n",
		"content/_index.md": "+++\ntitle = \"Home\"\n+++\n",
		"content/blog/_index.md": "+++\ntitle = \"Blog\"\nsort_by = \"date\"\npage_template = \"page.html\"\n+++\n",
		"content/blog/pine.md": "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npath = \"blog/2024/pine\"\naliases = [\"old-pine.html\"]\n\n[taxonomies]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube(id=\"abc\") }}\n",
		"templates/page.html": "<h1>{{ page.title }}</h1>{{ page.content | safe }}{{ get_url(path=\"@/blog/pine.md\") }}{{ page.date | date(format=\"%Y\") }}",
		"templates/shortcodes/youtube.html": "<iframe src=\"https://www.youtube.com/embed/{{ id }}\"></iframe>",
		"static/robots.txt": "User-agent: *\n",
	});

	let r = ssqch(["scout", "--from", "zola", d]);
	assert.ok(r.ok, r.log);
	for (const expected of [
		"Scouting the Zola site in",
		"Reference build\n  ssqch baseline \"zola build\" --from public\n",
		"Edits (1): --patch <file> writes them as a patch to review, and changes nothing\n  content/blog/pine.md: path -> permalink, [taxonomies] tags -> tags\n",
		"Draft (1 to write): --write-draft writes them, and never overwrites a file\n  ssqch.config.js (a first draft, from config.toml)\n",
		"  content/blog/_index.md: a section: its settings",
		"(content/blog/blog.json: `layout`, `tags`, `permalink`)",
		"  templates/shortcodes/youtube.html: a shortcode used in content",
		"  templates/: 2 Tera templates: they run as Jinja",
		"  templates/: 1 x Tera functions (get_url",
		"  templates/: 1 x filters with named arguments",
		"  templates/: 1 x `page.content`, `section.content`: `content` in a layout",
		"  config.toml: generate_feeds: a feed template",
		// DELIBERATE (0.11, from the fresh migrations, where neither agent found the loop): the next
		// step is a baseline of the old site, with its command, and the line names the loop's docs.
		"Next: `ssqch baseline \"zola build\" --from public` builds the site with Zola to compare with (before the patch, or with --commit); then `ssqch build` and `ssqch diff .cache/ssqch/baseline/ref-1 <ssqch's output>`, the biggest group first. `ssqch docs --from zola` has Zola's words and trailhead, and `ssqch docs \"moving a site with an agent\"` the whole loop. Run scout again to see what's left.",
	]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
	assert.ok(!exists(dir, "ssqch.config.js"));

	r = move(d, "zola");
	assert.ok(r.ok && r.log.includes("Wrote 1 draft file.") && r.log.includes("Wrote 1 edit to "), r.log);
	assert.equal(
		read(dir, "content/blog/pine.md"),
		"+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\naliases = [\"old-pine.html\"]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube(id=\"abc\") }}\n",
	);
	const config = read(dir, "ssqch.config.js");
	for (const expected of ["dirs: { input: \"content\", output: \"public\", includes: \"../templates\" },", "ignore: [\"**/_index.md\"],", "markdown: { headingIds: \"ascii\", highlight: true },", "passthrough: [{ static: \".\" }],", "\"title\": \"Trail Notes\"", "\"author\": \"Sam\"", "plugins: [sitemapPlugin({ url: \"https://example.com\" }), redirectsPlugin(), linksPlugin()],"]) {
		assert.ok(config.includes(expected), `missing ${JSON.stringify(expected)} in\n${config}`);
	}
	// A date in `[extra]` is its text. 0.7 wrote the TOML library's own object for it, which no
	// template could print (a deliberate difference: 0.7 was wrong).
	const founded = "\"founded\": \"2019-05-01\"";
	assert.ok(config.includes(founded), `missing ${JSON.stringify(founded)} in\n${config}`);

	// The by-hand part, done: the template, the shortcode as a filter, and the section's data.
	write(dir, {
		"templates/page.html": "<h1>{{ title }}</h1>{{ content | safe }}{{ config.title }} by {{ config.extra.author }}, {{ page.date | dateformat(\"%Y\") }}, {{ tags | join(\",\") }}",
		"content/blog/blog.json": "{ \"layout\": \"page.html\" }",
		"ssqch.config.js": config.replace("    // Port shortcodes and Tera functions here: name: (...args) => result\n", "    youtube: () => \"<iframe></iframe>\",\n"),
		"content/blog/pine.md": "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\naliases = [\"old-pine.html\"]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube() | safe }}\n",
	});
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `public/${p}`);
	assert.equal(out("blog/2024/pine/index.html"), "<h1>Pine</h1><p>A <em>pine</em>. <iframe></iframe></p>\nTrail Notes by Sam, 2024, trees");
	assert.ok(out("old-pine.html").includes("url=/blog/2024/pine/") && out("robots.txt").includes("User-agent") && out("sitemap.xml").includes("https://example.com/blog/2024/pine/"));
	assert.ok(!exists(dir, "public/blog/_index/index.html") && !exists(dir, "public/_index/index.html"));
});

// Added in 0.11, from opensource.guide (9 of its 13 kinds of edit were mechanical): a Jekyll site
// is imported, and builds.
test("scout_jekyll_drafts_a_config_that_builds", () => {
	const dir = tempDir("scout-jekyll");
	write(dir, {
		"_config.yml": "title: Trail Guide\ndescription: Into the Mild\nexclude: [script, README.md]\npermalink: pretty\ncollections:\n  guides:\n    output: true\n    permalink: /:collection/:path/\ndefaults:\n  - scope: { path: \"\" }\n    values: { image: /og.png }\n  - scope: { path: _guides }\n    values: { layout: guide }\nplugins: [jekyll-sitemap, jekyll-seo-tag, jekyll-redirect-from]\n",
		"Gemfile": "source \"https://rubygems.org\"\ngem \"jekyll\"\n",
		"README.md": "# Readme\n",
		"script/run": "echo",
		"_layouts/default.html": "<html><head>{% seo %}</head><body>{{ content }}<a href=\"https://example.com/edit/{{ page.path }}\">Edit</a></body></html>\n",
		"_layouts/guide.html": "---\nlayout: default\n---\n\n<h1>{{ page.title }}</h1>{{ content }}{% assign lang = \"en\" %}{{ page.lang }}\n",
		"_guides/trail.md": "---\ntitle: Old Growth\nlang: fr\n---\n<aside markdown=\"1\">\n*Hush*\n</aside>\n\n## Cedar\n",
		"_posts/2026-01-02-pine.md": "---\ntitle: Pine\nlayout: default\n---\nPine {{ site.data.trails.count }}\n",
		"_data/trails.yml": "count: 3\n",
		"index.html": "---\nlayout: default\n---\n{% for post in site.posts %}{{ post.title }}{% endfor %}\n",
		"assets/img/stump.png": "png",
		"robots.txt": "User-agent: *\n",
		// Jekyll renders a file with front matter, and copies a collection's file without it.
		"assets/app.js": "---\n---\nconst title = {{ site.title | jsonify }};\n",
		"_guides/zh/README.md": "Read me as I am\n",
		"Gemfile.lock": "GEM\n  specs:\n    jekyll (3.10.0)\n",
		"_guides/old.md": "---\ntitle: Moved\nredirect_from: [/legacy/]\n---\nMoved\n",
		// Added in 0.13: a feed whose blank line after the front matter would come before `<?xml`.
		"feed.xml": "---\nlayout: null\n---\n\n<?xml version=\"1.0\"?><feed/>\n",
	});
	let r = ssqch(["scout", "--from", "jekyll", dir]);
	assert.ok(r.ok, r.log);
	for (const said of [
		// DELIBERATE (0.11): templates aren't rewritten; `jekyllTemplates: true` gives Jekyll's `page`
		// and `site`. The one edit to a layout is the include `{% seo %}` stands for.
		"_layouts/default.html: {% seo %} -> {% include seo.liquid %}",
		"_guides/_guides.json (the `guides` collection: its tag and permalink)",
		"_posts/_posts.json (Jekyll's posts: the `posts` tag, and the permalink)",
		"_includes/seo.liquid (jekyll-seo-tag's tags",
		".: 1 `markdown=\"1\"` elements: `htmlMarkdown: \"kramdown\"` (in the draft) reads them as kramdown does",
		// DELIBERATE (0.13): `trimAfterFrontMatter` is gone; the blank line goes where it matters.
		"feed.xml: the blank line after the front matter out",
		// DELIBERATE (0.13): sitemapPlugin() needs the address, which this site's config doesn't have.
		"no `url`: `sitemapPlugin()` needs the site's address",
	]) assert.ok(r.log.includes(said), `${said}\n${r.log}`);
	r = move(dir, "jekyll");
	assert.ok(r.ok, r.log);
	const config = read(dir, "ssqch.config.js");
	for (const part of ["import { fromJekyll } from \"ssqch/from-jekyll\";", "ignore: [\"script/**\", \"README.md\", \"Gemfile\", \"Gemfile.lock\"],", "passthrough: [\"robots.txt\", \"assets/img\", { \"_guides/zh/README.md\": \"guides/zh/README.md\" }],", "data: { site, image: \"/og.png\" },", "plugins: [fromJekyll(), redirectsPlugin(), /* sitemapPlugin({ url: site.url }): needs `url` in _config.yml */],"]) assert.ok(config.includes(part), `${part}\n${config}`);
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && !r.log.includes("`//`"), r.log);
	assert.ok(read(dir, "_site/guides/trail/index.html").includes("<aside>\n<p><em>Hush</em></p>\n</aside>"), read(dir, "_site/guides/trail/index.html"));
	// `page.lang` is the page's, whatever the template assigns to its own `lang`.
	assert.ok(read(dir, "_site/guides/trail/index.html").includes("</h1>") && /<\/h1>[\s\S]*fr/.test(read(dir, "_site/guides/trail/index.html")), read(dir, "_site/guides/trail/index.html"));
	assert.ok(read(dir, "_site/guides/trail/index.html").includes("<h1>Old Growth</h1>") && read(dir, "_site/guides/trail/index.html").includes("<title>Old Growth | Trail Guide</title>"), read(dir, "_site/guides/trail/index.html"));
	assert.ok(read(dir, "_site/2026/01/02/pine/index.html").includes("Pine 3") && read(dir, "_site/2026/01/02/pine/index.html").includes("/edit/_posts/2026-01-02-pine.md"), read(dir, "_site/2026/01/02/pine/index.html"));
	assert.ok(read(dir, "_site/index.html").includes("Pine"), read(dir, "_site/index.html"));
	assert.ok(isFile(dir, "_site/assets/img/stump.png") && isFile(dir, "_site/robots.txt") && !isFile(dir, "_site/README/index.html"));
	// The rendered `.js` keeps its name; the collection's README is copied as it is; the old URL gets
	// jekyll-redirect-from's page; the generator is Jekyll's.
	assert.equal(read(dir, "_site/assets/app.js"), "const title = \"Trail Guide\";\n");
	assert.ok(read(dir, "_site/feed.xml").startsWith("<?xml"), read(dir, "_site/feed.xml"));
	assert.equal(read(dir, "_site/guides/zh/README.md"), "Read me as I am\n");
	assert.ok(read(dir, "_site/legacy/index.html").startsWith("<!DOCTYPE html>\n<html lang=\"en-US\">\n  <meta charset=\"utf-8\">\n  <title>Redirecting&hellip;</title>"), read(dir, "_site/legacy/index.html"));
	assert.ok(read(dir, "_site/guides/trail/index.html").includes("<meta name=\"generator\" content=\"Jekyll v3.10.0\" />") && read(dir, "_site/guides/trail/index.html").includes("\"@type\":\"BlogPosting\""), read(dir, "_site/guides/trail/index.html"));
	r = ssqch(["scout", "--from", "jekyll", `${dir}/assets`]);
	assert.ok(!r.ok && r.log.includes("there's no _config.yml in"), r.log);
});

// `--compare` builds with ssqch and compares with the reference build: the move's loop in one command.
test("scout_compare_builds_and_lists_the_biggest_groups", () => {
	const dir = tempDir("scout-compare");
	write(dir, {
		"mkdocs.yml": "site_name: Trail\ndocs_dir: docs\nmarkdown_extensions:\n  - admonition\n",
		"docs/index.md": "# Trail\n\n!!! tip \"Pack\"\n    Water\n\nSee [Cedar](cedar.md).\n",
		"docs/cedar.md": "# Cedar\n\nFlat.\n",
	});
	// Before a reference build, it says how to make one.
	let r = ssqch(["scout", dir, "--write-draft", "--compare"]);
	assert.ok(r.ok && r.log.includes("Compared with .cache/ssqch/baseline/ref-1\n  there's no reference build in .cache/ssqch/baseline/ref-1: `ssqch baseline \"<the old build command>\"` makes one\n"), r.log);
	// A reference that differs in one place: the group names it.
	write(dir, {
		".cache/ssqch/baseline/ref-1/index.html": "<h1 id=\"trail\">Trail</h1>\n<div class=\"admonition tip\">\n<p class=\"admonition-title\">Pack</p>\n<p>Water</p>\n</div>\n<p>See <a href=\"cedar/\">Cedar</a>.</p>\n",
		".cache/ssqch/baseline/ref-1/cedar/index.html": "<h1 id=\"cedar\">Cedar</h1>\n<p>Flat!</p>\n",
	});
	r = ssqch(["scout", dir, "--compare", "--format", "json"]);
	assert.ok(r.ok, r.log);
	const { compare } = JSON.parse(r.stdout);
	assert.equal(compare.built, true, r.stdout);
	assert.deepEqual(compare.summary, { added: 0, removed: 0, changed: 1, unchangedPages: 1, unchangedFiles: 0 }, r.stdout);
	r = ssqch(["scout", dir, "--compare"]);
	assert.ok(r.log.includes("  1 changed, 0 only in ssqch's, 0 only in the reference; 1 pages and 0 other files the same\n") && r.log.includes("Next: fix the biggest group above"), r.log);
});

// Added in 0.13.5: an Eleventy site that used the RSS plugin's v2 `feedPlugin`, moved to ssqch's
// `feedPlugin()`, has nothing left to do for it; and Eleventy's options, passed as they were,
// say ssqch's names.
test("scout_counts_feed_plugin_for_the_rss_plugin", () => {
	const dir = tempDir("scout-feed");
	write(dir, {
		"package.json": "{ \"devDependencies\": { \"@11ty/eleventy\": \"3.1.0\", \"@11ty/eleventy-plugin-rss\": \"2.0.0\" } }\n",
		"eleventy.config.js": "import { feedPlugin } from \"@11ty/eleventy-plugin-rss\";\nexport default function (c) { c.addPlugin(feedPlugin, { type: \"atom\", outputPath: \"/feed.xml\", collection: { name: \"posts\", limit: 10 } }); }\n",
		"src/index.md": "hi\n",
		"ssqch.config.js": "import { feedPlugin } from \"ssqch/rss\";\nexport default { plugins: [feedPlugin({ url: \"https://example.com\" })] };\n",
	});
	const r = ssqch(["scout", "--format", "json", dir]);
	const report = JSON.parse(r.stdout);
	assert.deepEqual(report.todo.filter((t) => /eleventy-plugin-rss/.test(t.what)), [], r.stdout);
	assert.ok(report.done.some((t) => t.option === "ssqch/feed"), r.stdout);
	write(dir, { "ssqch.config.js": "import { feedPlugin } from \"ssqch/rss\";\nexport default { plugins: [feedPlugin({ type: \"atom\", outputPath: \"/feed.xml\" })] };\n" });
	const built = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!built.ok && built.log.includes("these are the options of Eleventy's feedPlugin, which ssqch's names differently: `type` is `format`"), built.log);
});

// Pages with no date of their own take their file's time in ssqch, which a checkout or a save moves:
// scout says how many, and `dateFallback: "git"` in the config takes the to-do off the list.
test("scout_suggests_git_dates_for_undated_pages", () => {
	const dir = tempDir("scout-undated");
	write(dir, {
		"package.json": "{ \"devDependencies\": { \"@11ty/eleventy\": \"3.1.0\" } }\n",
		"eleventy.config.js": "export default function (c) {}\n",
		"src/cedar.md": "---\ntitle: Cedar Trail\n---\nFour miles.\n",
		"src/2026-01-02-stump.md": "---\ntitle: The stump\n---\nA stump.\n",
		"src/ranger.md": "---\ntitle: Ranger station\ndate: 2026-01-01\n---\nOpen daily.\n",
		"README.md": "Not a page.\n",
	});
	let report = JSON.parse(ssqch(["scout", "--format", "json", dir]).stdout);
	const todo = report.todo.find((t) => t.code === "undated-pages");
	assert.ok(todo && todo.count === 1 && todo.what.startsWith("1 of 3 pages have no date of their own (src/cedar.md)") && todo.option === "dateFallback: \"git\"", JSON.stringify(report.todo));
	write(dir, { "ssqch.config.js": "export default { dateFallback: \"git\" };\n" });
	report = JSON.parse(ssqch(["scout", "--format", "json", dir]).stdout);
	assert.ok(!report.todo.some((t) => t.code === "undated-pages") && report.done.some((t) => t.code === "undated-pages"), JSON.stringify(report));
});
