// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read, exists, isFile, expectedVersion } from "../lib/ssqch.js";

test("import_moves_an_eleventy_site", () => {
	const dir = tempDir("import");
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
	let r = ssqch(["import", "eleventy", d]);
	assert.ok(r.ok, r.log);
	for (const expected of [
		"(a dry run: nothing is changed; add --write to make the changes)",
		"Rename (1)\n  src/posts/posts.11tydata.json -> src/posts/posts.data.json\n",
		"  src/index.njk: eleventyExcludeFromCollections -> excludeFromCollections\n",
		"  src/posts/pine.md: templateEngineOverride -> render, eleventy:widths/ignore -> ssqch:widths/ignore\n",
		"  src/posts/posts.11tydata.json: eleventyComputed -> computed\n",
		"Create (1)\n  ssqch.config.js (a first draft, from .eleventy.js)\n",
		"  src/feed.11ty.js: JavaScript templates don't run in ssqch",
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
	r = ssqch(["import", "eleventy", d, "--write"]);
	assert.ok(r.ok && r.log.includes("Done: 1 renamed, 4 edited, 1 created."), r.log);
	assert.equal(
		read(dir, "package.json"),
		`{\n  "scripts": {\n    "build": "ssqch build",\n    "start": "ssqch serve"\n  },\n  "packageManager": "pnpm@12.21.0",\n  "devDependencies": {\n    "ssqch": "${expectedVersion()}"\n  }\n}\n`,
	);
	assert.ok(read(dir, "src/posts/posts.data.json").includes("\"computed\""));
	const config = read(dir, "ssqch.config.js");
	assert.ok(config.includes("dirs: { input: \"src\", output: \"_site\" },") && config.includes("markdownEngine: \"njk\",\n  htmlEngine: \"njk\",") && config.includes("passthrough: [\"src/css\"],") && config.includes("    shout: (s) => s.toUpperCase(),\n"), config);
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `_site/${p}`);
	assert.equal(out("index.html"), "<a href=\"/posts/pine/\">Post: Pine</a> 1");
	assert.equal(out("posts/pine/index.html"), "<title>Post: Pine</title><p><em>Pine</em> <img src=\"/css/x.png\" ssqch:ignore></p>\n");
	assert.ok(isFile(dir, "_site/css/site.css"));

	// A second run has nothing left to change, and keeps the config that's there.
	r = ssqch(["import", "eleventy", d]);
	assert.ok(r.ok && r.log.includes("Nothing to rename, edit or create.") && r.log.includes("ssqch.config.js: it's already there"), r.log);
	r = ssqch(["import", "hugo", d]);
	assert.ok(!r.ok && r.log.includes("there's no importer for hugo yet (only eleventy and zola)"), r.log);
});

// Eleventy's EJS templates render in ssqch as they are: `include()` reads from `_includes` in both.
test("import_carries_over_ejs_templates", () => {
	const dir = tempDir("import-ejs");
	const d = dir;
	write(dir, {
		"eleventy.config.js": "module.exports = function (eleventyConfig) {\n  return { dir: { input: \"src\" }, markdownTemplateEngine: false };\n};\n",
		"src/_includes/base.ejs": "<%- include(\"nav\") %><main><%- content %></main>",
		"src/_includes/nav.ejs": "<nav><%= title %></nav>",
		"src/index.ejs": "---\nlayout: base.ejs\ntitle: Camp\neleventyExcludeFromCollections: true\n---\n<% for (const post of collections.all) { %><a href=\"<%= post.url %>\"><%= post.data.title %></a><% } %>",
		"src/trail.md": "---\nlayout: base.ejs\ntitle: Trail\n---\nOld Growth.\n",
	});
	let r = ssqch(["import", "eleventy", d, "--write"]);
	assert.ok(r.ok && r.log.includes("  src/index.ejs: eleventyExcludeFromCollections -> excludeFromCollections\n"), r.log);
	const config = read(dir, "ssqch.config.js");
	assert.ok(config.includes("templateFormats: [\"ejs\", \"md\"],"), config);
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const out = (p) => read(dir, `_site/${p}`);
	assert.equal(out("index.html"), "<nav>Camp</nav><main><a href=\"/trail/\">Trail</a></main>");
	assert.equal(out("trail/index.html"), "<nav>Trail</nav><main><p>Old Growth.</p>\n</main>");
});

test("import_moves_a_zola_site", () => {
	const dir = tempDir("import-zola");
	const d = dir;
	write(dir, {
		"config.toml": "base_url = \"https://example.com\"\ntitle = \"Trail Notes\"\ngenerate_feeds = true\ntaxonomies = [{ name = \"tags\" }]\n\n[markdown]\nhighlight_code = true\n\n[extra]\nauthor = \"Sam\"\n",
		"content/_index.md": "+++\ntitle = \"Home\"\n+++\n",
		"content/blog/_index.md": "+++\ntitle = \"Blog\"\nsort_by = \"date\"\npage_template = \"page.html\"\n+++\n",
		"content/blog/pine.md": "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npath = \"blog/2024/pine\"\naliases = [\"old-pine.html\"]\n\n[taxonomies]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube(id=\"abc\") }}\n",
		"templates/page.html": "<h1>{{ page.title }}</h1>{{ page.content | safe }}{{ get_url(path=\"@/blog/pine.md\") }}{{ page.date | date(format=\"%Y\") }}",
		"templates/shortcodes/youtube.html": "<iframe src=\"https://www.youtube.com/embed/{{ id }}\"></iframe>",
		"static/robots.txt": "User-agent: *\n",
	});

	let r = ssqch(["import", "zola", d]);
	assert.ok(r.ok, r.log);
	for (const expected of [
		"Importing the Zola site in",
		"Edit (1)\n  content/blog/pine.md: path -> permalink, [taxonomies] tags -> tags\n",
		"Create (1)\n  ssqch.config.js (a first draft, from config.toml)\n",
		"  content/blog/_index.md: a section: its settings",
		"(content/blog/blog.json: `layout`, `tags`, `permalink`)",
		"  templates/shortcodes/youtube.html: a shortcode used in content",
		"  templates/: 2 Tera templates: they run as Jinja",
		"  templates/: 1 x Tera functions (get_url",
		"  templates/: 1 x filters with named arguments",
		"  templates/: 1 x `page.content`, `section.content`: `content` in a layout",
		"  config.toml: generate_feeds: a feed template",
		"compare with the site Zola built: `ssqch diff <Zola's output> <ssqch's output>`",
	]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
	assert.ok(!exists(dir, "ssqch.config.js"));

	r = ssqch(["import", "zola", d, "--write"]);
	assert.ok(r.ok && r.log.includes("Done: 0 renamed, 1 edited, 1 created."), r.log);
	assert.equal(
		read(dir, "content/blog/pine.md"),
		"+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\naliases = [\"old-pine.html\"]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube(id=\"abc\") }}\n",
	);
	const config = read(dir, "ssqch.config.js");
	for (const expected of ["dirs: { input: \"content\", output: \"public\", includes: \"../templates\" },", "ignore: [\"**/_index.md\"],", "markdown: { headingIds: \"ascii\", highlight: true },", "passthrough: [{ static: \".\" }],", "\"title\": \"Trail Notes\"", "\"author\": \"Sam\"", "plugins: [sitemapPlugin({ url: \"https://example.com\" }), redirectsPlugin(), linksPlugin()],"]) {
		assert.ok(config.includes(expected), `missing ${JSON.stringify(expected)} in\n${config}`);
	}

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
