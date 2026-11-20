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
	// DELIBERATE (0.11): there's an importer for Jekyll now.
	assert.ok(!r.ok && r.log.includes("there's no importer for hugo yet (only eleventy, jekyll and zola)"), r.log);
});

// A config's names, a script's flags and its indentation, in any script and after a byte-order
// mark, read as 0.7's Rust patterns read them.
test("import_reads_names_in_any_script", () => {
	const dir = tempDir("import-unicode");
	write(dir, {
		"eleventy.config.js": "﻿const pluginÉté = require(\"@11ty/eleventy-plugin-rss\");\nmodule.exports = function (eleventyConfig) {\n\televentyConfig.addPlugin(pluginÉté);\n\televentyConfig.addFilter(\"shout\", (value) => {\n\t\treturn value;\n\t});\n};\n",
		"package.json": "{\n  \"scripts\": {\n    \"build\": \"eleventy --pathprefix /x/ --verbosé\"\n  }\n}\n",
	});
	let r = ssqch(["import", "eleventy", dir, "--write"]);
	assert.ok(r.ok, r.log);
	for (const expected of ["  eleventy.config.js:3: addPlugin(pluginÉté) (from @11ty/eleventy-plugin-rss) -> see its package below\n", "  package.json: the `build` script's --verbosé flag is Eleventy's"]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
	assert.equal(read(dir, "package.json"), "{\n  \"scripts\": {\n    \"build\": \"ssqch build --base /x/\"\n  }\n}\n");
	const config = read(dir, "ssqch.config.js");
	assert.ok(config.includes("\n\tmarkdownEngine: \"liquid\",\n") && config.includes("\t\tshout: (value) => {\n\t\t\treturn value;\n\t\t},\n"), config);

	// A Zola config that isn't TOML shows the line and the spot, in TOML's words.
	const zola = tempDir("import-zola-error");
	write(zola, { "config.toml": "title = \"x\"\n= 2\n", "templates": "{{ page.title }}" });
	r = ssqch(["import", "zola", zola]);
	assert.equal(r.code, 1, r.log);
	assert.ok(r.stderr.startsWith("error: config.toml: TOML parse error at line 2, column 1\n  |\n2 | = 2\n  | ^\n"), r.stderr);
	// `templates` can be a file, and it's a template.
	write(zola, { "config.toml": "title = \"x\"\n" });
	r = ssqch(["import", "zola", zola]);
	assert.ok(r.ok && r.log.includes("  templates/: 1 Tera templates: ") && r.log.includes("  templates/: 1 x `page.title`"), r.log);
});

// package.json changes where it changes. 0.7 printed the whole file again (a list on several
// lines, `1e5` as `100000.0`, its dev dependencies sorted); the Node build edits the text in place.
test("import_keeps_package_json_as_written", () => {
	const dir = tempDir("import-package");
	write(dir, {
		"eleventy.config.js": "module.exports = () => ({});\n",
		"package.json": "{\n\t\"name\": \"trail-guide\",\n\t\"weight\": 1.0,\n\t\"exp\": 1e5,\n\t\"keywords\": [\"pine\", \"cone\"],\n\t\"scripts\": { \"build\": \"eleventy\" },\n\t\"devDependencies\": {\n\t\t\"@11ty/eleventy\": \"^3.0.0\",\n\t\t\"zed\": \"1\"\n\t}\n}\n",
	});
	const r = ssqch(["import", "eleventy", dir, "--write"]);
	assert.ok(r.ok, r.log);
	const v = expectedVersion();
	assert.equal(read(dir, "package.json"), `{\n\t"name": "trail-guide",\n\t"weight": 1.0,\n\t"exp": 1e5,\n\t"keywords": ["pine", "cone"],\n\t"scripts": { "build": "ssqch build" },\n\t"devDependencies": {\n\t\t"ssqch": "${v}",\n\t\t"zed": "1"\n\t}\n}\n`);
});

// A template literal with `${...}` is worked out when the config runs, and a default value that
// reads the config needs it: 0.7 put both in the draft as they were, the Node build lists them.
test("import_leaves_computed_names_and_config_defaults_for_a_person", () => {
	const dir = tempDir("import-computed");
	write(dir, { "eleventy.config.js": "const dir = \"static\";\nconst dateFormat = \"%Y\";\nmodule.exports = function (eleventyConfig) {\n\televentyConfig.addPassthroughCopy(`${dir}/img`);\n\televentyConfig.addFilter(\"year\", (value, format = dateFormat) => format + value);\n};\n" });
	const r = ssqch(["import", "eleventy", dir, "--write"]);
	assert.ok(r.ok, r.log);
	const config = read(dir, "ssqch.config.js");
	assert.ok(!config.includes("${dir}") && !config.includes("dateFormat") && config.includes("//   filters: year\n"), config);
	for (const expected of ["  eleventy.config.js:4: addPassthroughCopy with a variable or a computed value -> ", "  eleventy.config.js:5: addFilter(\"year\") -> "]) {
		assert.ok(r.log.includes(expected), `missing ${JSON.stringify(expected)} in\n${r.log}`);
	}
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
		"config.toml": "base_url = \"https://example.com\"\ntitle = \"Trail Notes\"\ngenerate_feeds = true\ntaxonomies = [{ name = \"tags\" }]\n\n[markdown]\nhighlight_code = true\n\n[extra]\nauthor = \"Sam\"\nfounded = 2019-05-01\n",
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
		// DELIBERATE (0.11, from the fresh migrations, where neither agent found the loop): the next
		// step is a baseline of the old site, and the line names the loop's docs.
		"Next: `ssqch baseline \"<Zola's build command>\"` (before --write, or with --commit) builds the site with Zola to compare with; then `ssqch build` and `ssqch diff <the baseline> <ssqch's output>`, the biggest group first. The whole loop: `ssqch docs \"moving a site with an agent\"`.",
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
test("import_jekyll_drafts_a_config_that_builds", () => {
	const dir = tempDir("import-jekyll");
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
		"index.html": "---\nlayout: default\n---\n{% for post in site.posts %}{{ post.data.title }}{% endfor %}\n",
		"assets/img/stump.png": "png",
		"robots.txt": "User-agent: *\n",
	});
	let r = ssqch(["import", "jekyll", dir]);
	assert.ok(r.ok, r.log);
	for (const said of [
		"_layouts/guide.html: lang (the template's own variable) -> my_lang, page.title -> title, page.lang -> lang",
		"_layouts/default.html: page.path -> page.inputPath | remove_first: \"./\", {% seo %} -> {% include seo.liquid %}",
		"_posts/2026-01-02-pine.md: site.data.<name> -> <name>",
		"index.html: site.posts -> collections.posts",
		"_guides/_guides.json (the `guides` collection: its tag and permalink)",
		"_posts/_posts.json (Jekyll's posts: the `posts` tag, and the permalink)",
		"_includes/seo.liquid (jekyll-seo-tag's tags",
		"_layouts/guide.html: `lang`, the template's own variable, is `my_lang` now (`page.lang` is `lang`)",
		".: 1 `markdown=\"1\"` elements: `htmlMarkdown: \"kramdown\"` (in the draft) reads them as kramdown does",
	]) assert.ok(r.log.includes(said), `${said}\n${r.log}`);
	r = ssqch(["import", "jekyll", dir, "--write"]);
	assert.ok(r.ok, r.log);
	const config = read(dir, "ssqch.config.js");
	for (const part of ["trimAfterFrontMatter: true,", "markdown: { htmlMarkdown: \"kramdown\", headingIds: \"kramdown\", smartPunctuation: true, autolinks: false },", "ignore: [\"script/**\", \"README.md\", \"Gemfile\", \"Gemfile.lock\"],", "passthrough: [\"robots.txt\", \"assets\"],", "data: { site, image: \"/og.png\" },", "plugins: [redirectsPlugin(), sitemapPlugin({ url: site.url })],"]) assert.ok(config.includes(part), `${part}\n${config}`);
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok && !r.log.includes("`//`"), r.log);
	assert.ok(read(dir, "_site/guides/trail/index.html").includes("<aside>\n<p><em>Hush</em></p>\n</aside>"), read(dir, "_site/guides/trail/index.html"));
	assert.ok(read(dir, "_site/guides/trail/index.html").includes("<h1>Old Growth</h1>") && read(dir, "_site/guides/trail/index.html").includes("<title>Old Growth | Trail Guide</title>"), read(dir, "_site/guides/trail/index.html"));
	assert.ok(read(dir, "_site/2026/01/02/pine/index.html").includes("Pine 3") && read(dir, "_site/2026/01/02/pine/index.html").includes("/edit/_posts/2026-01-02-pine.md"), read(dir, "_site/2026/01/02/pine/index.html"));
	assert.ok(read(dir, "_site/index.html").includes("Pine"), read(dir, "_site/index.html"));
	assert.ok(isFile(dir, "_site/assets/img/stump.png") && isFile(dir, "_site/robots.txt") && !isFile(dir, "_site/README/index.html"));
	r = ssqch(["import", "jekyll", `${dir}/assets`]);
	assert.ok(!r.ok && r.log.includes("there's no _config.yml in"), r.log);
});
