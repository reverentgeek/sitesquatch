// From crates/ssqch/src/import.rs (0.7's importer, whose detectors scout's are).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readToml } from "./data.ts";
import { blankComments, detect, draftConfig, eleventy, hugo, jekyll, mkdocs, other, vitepress, patchOf, scoutReport, scoutText, setIn, siteConfig, unifiedHunks, jekyllPermalink, rewriteData, jekyllTemplateNotes, rewriteScript, rewriteTemplate, rewriteZolaFrontMatter, SEO_INCLUDE, tomlError, zola } from "./scout.ts";
import { VERSION } from "./version.ts";

test("zola_front_matter_gets_ssqch_names", () => {
	let [text, changes] = rewriteZolaFrontMatter("+++\ntitle = \"Pine\"\ndate = 2024-01-02\npath = \"blog/2024/pine\"\n\n[taxonomies]\ntags = [\"trees\", \"cones\"]\n\n[extra]\nauthor = \"Sam\"\n+++\nBody with path = \"x\" and [taxonomies] in it.\n");
	assert.equal(text, "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\ntags = [\"trees\", \"cones\"]\n\n[extra]\nauthor = \"Sam\"\n+++\nBody with path = \"x\" and [taxonomies] in it.\n");
	assert.deepEqual(changes, ["path -> permalink", "[taxonomies] tags -> tags"]);
	// Other taxonomies stay, and so does a table's own `path` or `tags`.
	[text, changes] = rewriteZolaFrontMatter("+++\ntitle = \"x\"\n[taxonomies]\ntags = [\n  \"a\",\n  \"b\",\n]\ncategories = [\"c\"]\n[extra]\npath = \"keep\"\ntags = \"keep\"\n+++\nBody\n");
	assert.equal(text, "+++\ntitle = \"x\"\ntags = [\n  \"a\",\n  \"b\",\n]\n[taxonomies]\ncategories = [\"c\"]\n[extra]\npath = \"keep\"\ntags = \"keep\"\n+++\nBody\n");
	assert.deepEqual(changes, ["[taxonomies] tags -> tags"]);
	// Nothing to do: the text comes back untouched, whatever it is.
	for (const same of ["+++\ntitle = \"x\"\n+++\nBody\n", "---\ntitle: x\n---\nBody\n", "No front matter\n", "+++\nnever closed\n"]) {
		assert.deepEqual(rewriteZolaFrontMatter(same), [same, []]);
	}
	// The result is still TOML.
	const parsed = readToml(text.split("+++")[1]) as { tags: unknown[]; taxonomies: { categories: unknown[] } };
	assert.equal(parsed.tags.length, 2);
	assert.equal(parsed.taxonomies.categories.length, 1);
	// Line breaks stay as the file has them, except the `\r` of a last line that's rewritten, as
	// 0.7 wrote it (TOML reads both).
	assert.equal(rewriteZolaFrontMatter("+++\r\ntitle = \"x\"\r\npath = \"a/b\"\r\nslug = \"c\"\r\n+++\r\nBody\r\n")[0], "+++\r\ntitle = \"x\"\r\npermalink = \"/a/b/\"\r\nslug = \"c\"\r\n+++\r\nBody\r\n");
	assert.equal(rewriteZolaFrontMatter("+++\r\ntitle = \"x\"\r\npath = \"a/b\"\r\n+++\r\nBody\r\n")[0], "+++\r\ntitle = \"x\"\r\npermalink = \"/a/b/\"\n+++\r\nBody\r\n");
});

test("templates_and_data_get_ssqch_names", () => {
	let [text, changes] = rewriteTemplate(
		"---\ntitle: Pine\neleventyExcludeFromCollections: true\neleventyComputed:\n  slug: \"{{ title | slugify }}\"\ntemplateEngineOverride: njk,md\neleventyNavigation:\n  key: Pine\n---\nUse eleventyComputed in prose. <img src=\"a.png\" eleventy:widths=\"300\" eleventy:ignore> {{ eleventy.generator }}\n",
		false,
	);
	// DELIBERATE (0.11): front matter keys stay as they are (Eleventy's work in ssqch, and
	// `eleventyNavigation` is listed instead); the image attributes and the generator still change.
	assert.equal(text, "---\ntitle: Pine\neleventyExcludeFromCollections: true\neleventyComputed:\n  slug: \"{{ title | slugify }}\"\ntemplateEngineOverride: njk,md\neleventyNavigation:\n  key: Pine\n---\nUse eleventyComputed in prose. <img src=\"a.png\" ssqch:widths=\"300\" ssqch:ignore> {{ ssqch.generator }}\n");
	assert.equal(changes.length, 2);
	const [same, none] = rewriteTemplate("No front matter, and eleventyComputed is only a word here.\n", true);
	assert.deepEqual([same, none.length], ["No front matter, and eleventyComputed is only a word here.\n", 0]);
	let data: string;
	const json = "{ \"layout\": \"post\", \"eleventyComputed\": { \"permalink\": \"/x/\" } }";
	[data, changes] = rewriteData(json);
	assert.deepEqual([data, changes], [json, []]);

	// A post about Eleventy keeps its prose and its code samples.
	const post = "---\ntitle: Images in Eleventy\n---\nAdd `eleventy:ignore` to skip one, as in `<img eleventy:ignore>`, and print {{ eleventy.version }}.\n\n```html\n<img src=\"a.png\" eleventy:widths=\"300\"> {{ eleventy.generator }}\n```\n\n<img src=\"b.png\" eleventy:ignore>\n";
	[text, changes] = rewriteTemplate(post, true);
	assert.equal(text, post.replace("and print {{ eleventy.version }}", "and print {{ ssqch.version }}").replace("<img src=\"b.png\" eleventy:ignore>", "<img src=\"b.png\" ssqch:ignore>"));
	assert.equal(changes.length, 2);
});

/** lit.dev's config: a commented-out setting, Nunjucks-only calls, a helper that registers shortcodes by name, and a plugin from the site's own monorepo. */
test("comments_helpers_and_local_plugins", () => {
	const config = `const { playgroundPlugin } = require("lit-dev-tools-cjs/lib/playground-plugin/plugin.js");
const pluginRss = require("@11ty/eleventy-plugin-rss");
module.exports = function (eleventyConfig) {
  // markdownTemplateEngine: 'njk',
  /* eleventyConfig.addFilter("ghost", (x) => x); */
  eleventyConfig.addPlugin(playgroundPlugin);
  eleventyConfig.addPlugin(pluginRss);
  eleventyConfig.addNunjucksAsyncShortcode("algoliaid", async () => "id");
  const api = (shortcodeName) => eleventyConfig.addShortcode(shortcodeName, (x) => x);
  eleventyConfig.addPairedNunjucksShortcode("aside", (content) => content);
  eleventyConfig.addMarkdownHighlighter((code) => code);
  return { dir: { input: "site" } };
};
`;
	const [draft, byHand] = draftConfig(".eleventy.js", config, new Set());
	assert.ok(draft.includes("markdownEngine: \"liquid\""), draft);
	assert.ok(!draft.includes("ghost"), draft);
	const list = byHand.map(([at, what]) => `${at}: ${(what.split(/[:-]/)[0] ?? "").trim()}`);
	assert.deepEqual(list, [
		".eleventy.js:6: addPlugin(playgroundPlugin) (from lit",
		".eleventy.js:7: addPlugin(pluginRss) (from @11ty/eleventy",
		".eleventy.js:9: addShortcode(shortcodeName, ...) takes its name from a variable",
		".eleventy.js:11: addMarkdownHighlighter",
		".eleventy.js: @11ty/eleventy",
	]);
	// Self-contained, so they move as written.
	assert.ok(draft.includes("algoliaid: async () => \"id\"") && draft.includes("aside: (content) => content"), draft);
	assert.ok(byHand[0][1].includes("a plugin ssqch doesn't know"), byHand[0][1]);
	assert.ok(byHand[1][1].endsWith("see its package below"), byHand[1][1]);
	assert.equal(blankComments("a // b\nc /* d\ne */ \"//\" `/*`"), "a     \nc     \n     \"//\" `/*`");
});

/** wireit's commands run Eleventy in monorepos, and templates that call eleventy-navigation's filter keep their `eleventyNavigation` front matter (lit.dev). */
test("wireit_commands_and_navigation_filters", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-wireit-"));
	try {
		fs.mkdirSync(path.join(dir, "site/_includes"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".eleventy.js"), "module.exports = () => ({ dir: { input: \"site\" } });\n");
		fs.writeFileSync(path.join(dir, "package.json"), "{\n  \"scripts\": { \"build\": \"wireit\" },\n  \"wireit\": { \"build\": { \"command\": \"eleventy --config .eleventy.js\" } },\n  \"devDependencies\": { \"@11ty/eleventy\": \"^2.0.1\" }\n}\n");
		fs.writeFileSync(path.join(dir, "site/a.md"), "---\neleventyNavigation:\n  key: A\neleventyComputed:\n  x: 1\n---\nA\n");
		fs.writeFileSync(path.join(dir, "site/_includes/nav.html"), "{% set nav = collections.all | eleventyNavigation('docs') %}\n");
		const plan = eleventy(dir);
		const pkg = plan.edits.find(([p]) => p === "package.json")!;
		assert.ok(pkg[2].includes("\"command\": \"ssqch build"), pkg[2]);
		assert.ok(pkg[1].some((c) => c.startsWith("wireit commands")), pkg[1].join("\n"));
		// DELIBERATE (0.11): the page isn't edited; its keys work as they are.
		assert.ok(!plan.edits.some(([p]) => p === "site/a.md"), JSON.stringify(plan.edits.map(([p]) => p)));
		assert.ok(plan.byHand.some(([, what]) => what.includes("findNavigationEntries")), JSON.stringify(plan.byHand));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("package_scripts_run_ssqch", () => {
	const cases: Array<[string, string, string]> = [
		["eleventy", "ssqch build", ""],
		["npm run clean && eleventy --serve", "npm run clean && ssqch serve", ""],
		["npx @11ty/eleventy --serve --port=8081 --quiet", "ssqch serve --port 8081 --quiet", ""],
		["ELEVENTY_ENV=production eleventy --pathprefix=/gahlee/ --output dist", "ELEVENTY_ENV=production ssqch build --base /gahlee/ --output dist", ""],
		["eleventy --formats=md,njk", "ssqch build", "--formats"],
		["eslint src/**/*.js", "eslint src/**/*.js", ""],
		// Script names stay: a11yproject.com's `start`, the blog's `run-s` and v8.dev's `npm run
		// eleventy` all pointed at scripts that didn't exist after the import.
		["npm run eleventy-watch & npm run gulp-watch", "npm run eleventy-watch & npm run gulp-watch", ""],
		["run-s clean build:css build:eleventy build:prune", "run-s clean build:css build:eleventy build:prune", ""],
		["npm run clean && npm run eleventy && npm run html", "npm run clean && npm run eleventy && npm run html", ""],
		["pnpm run eleventy; yarn eleventy", "pnpm run eleventy; yarn eleventy", ""],
		["run-p eleventy watch:css", "run-p eleventy watch:css", ""],
		["eslint eleventy.config.js && DEBUG=Eleventy* eleventy", "eslint eleventy.config.js && DEBUG=Eleventy* ssqch build", ""],
		["npm run css && npx eleventy --serve", "npm run css && ssqch serve", ""],
	];
	for (const [script, want, unknown] of cases) {
		const [out, flags] = rewriteScript(script, ["eleventy"]);
		assert.deepEqual([out, flags.join(" ")], [want, unknown], script);
	}
});

// blog #2: the header said "listed at the end" when nothing was.
test("a_draft_promises_a_list_only_when_there_is_one", () => {
	const [draft] = draftConfig("eleventy.config.js", "export default function (eleventyConfig) {\n\televentyConfig.addPassthroughCopy(\"img\");\n}\n", new Set(["md"]));
	assert.ok(!draft.includes("listed at the end") && !draft.includes("// To port from"), draft);
	assert.ok(draft.includes("// `ssqch docs --from eleventy` has the whole mapping.\n"), draft);
});

test("a_config_becomes_a_draft_and_a_list", () => {
	let config = `const pluginRss = require("@11ty/eleventy-plugin-rss");
const markdownItAnchor = require("markdown-it-anchor");
module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(pluginRss);
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });
  eleventyConfig.addWatchTarget("./src/css/");
  eleventyConfig.addFilter("readableDate", (d) => d.toDateString());
  eleventyConfig.addShortcode("year", () => \`\${new Date().getFullYear()}\`);
  eleventyConfig.addPairedShortcode("callout", (content) => content);
  eleventyConfig.addCollection("posts", (api) => api.getFilteredByGlob("src/posts/*.md"));
  eleventyConfig.on("eleventy.after", () => {});
  return {
    dir: { input: "src", output: "public", includes: "_includes" },
    markdownTemplateEngine: "njk",
    pathPrefix: "/blog/",
  };
};
`;
	const extensions = new Set(["md", "njk"]);
	let [draft, byHand] = draftConfig(".eleventy.js", config, extensions);
	for (const expected of [
		"dirs: { input: \"src\", output: \"public\", includes: \"_includes\" },",
		"templateFormats: [\"md\", \"njk\"],",
		"  // From the Eleventy config's markdownTemplateEngine; HTML runs through Liquid first, Eleventy's default.\n  markdownEngine: \"njk\",\n  htmlEngine: \"liquid\",",
		"base: \"/blog/\",",
		"passthrough: [\"src/assets\", { \"src/static\": \"/\" }],",
		"watch: [\"./src/css/\"],",
		// Self-contained functions move as written; shortcodes are filters. Everything was ported,
		// so there's no placeholder.
		"  filters: {\n    // From .eleventy.js, as written.\n    readableDate: (d) => d.toDateString(),\n    year: () => `${new Date().getFullYear()}`,\n    callout: (content) => content,\n  },\n",
		"//   collections: posts\n",
	]) {
		assert.ok(draft.includes(expected), `missing ${JSON.stringify(expected)} in\n${draft}`);
	}
	assert.ok(!draft.includes("//   filters:"), draft);
	assert.ok(draft.includes("// What it couldn't carry over is listed at the end;"), draft);
	let list = byHand.map(([at, what]) => `${at}: ${what.split(" -> ")[0]}`);
	assert.deepEqual(list, [".eleventy.js:4: addPlugin(pluginRss) (from @11ty/eleventy-plugin-rss)", ".eleventy.js:11: addCollection(\"posts\")", ".eleventy.js:12: on(\"eleventy.after\")", ".eleventy.js: @11ty/eleventy-plugin-rss", ".eleventy.js: markdown-it-anchor"]);

	// Tabs and spaces inside brackets, as the config has them; a function that needs something
	// else in the config stays for a person, and so does a variable.
	config = "import { DateTime } from \"luxon\";\nconst assets = { \"images\": \"images\" };\nexport default function ( eleventyConfig ) {\n\televentyConfig.addPassthroughCopy( assets );\n\televentyConfig.addPassthroughCopy( { \"images\": \"images\", fonts: 'static/fonts' } );\n\televentyConfig.addFilter( \"snake_case\", ( str ) => {\n\t\treturn str\n\t\t\t.toLowerCase()\n\t\t\t.replace( /[^a-z0-9]+/g, \"_\" );\n\t} );\n\televentyConfig.addFilter( \"year\", ( d ) => DateTime.fromJSDate( d ).year );\n\televentyConfig.addShortcode( \"url\", function ( path ) { return this.page.url + path; } );\n\treturn { templateFormats: [ \"njk\", \"md\" ] };\n}\n";
	[draft, byHand] = draftConfig("eleventy.config.js", config, extensions);
	for (const expected of [
		"export default defineConfig( {\n\ttemplateFormats: [ \"njk\", \"md\" ],\n\t// Eleventy's defaults: Markdown and HTML run through Liquid first.\n\tmarkdownEngine: \"liquid\",\n\thtmlEngine: \"liquid\",\n",
		"\tpassthrough: [ { images: \"images\" }, { fonts: \"static/fonts\" } ],\n",
		// Some are left by hand, so the placeholder follows the ported ones.
		"\t\tsnake_case: ( str ) => {\n\t\t\treturn str\n\t\t\t\t.toLowerCase()\n\t\t\t\t.replace( /[^a-z0-9]+/g, \"_\" );\n\t\t},\n\t\t// Port each filter and shortcode here: name: (value, ...args) => result\n\t},\n",
		"} );\n",
		"//   filters: year\n//   filters: url\n",
	]) {
		assert.ok(draft.includes(expected), `missing ${JSON.stringify(expected)} in\n${draft}`);
	}
	// Gahlee House's config: no trailing commas, so the draft has none, and only the keys that
	// need them are quoted.
	const gahlee = "export default function ( eleventyConfig ) {\n\televentyConfig.addPassthroughCopy( { \"images\": \"images\" } );\n\televentyConfig.addFilter( \"snake_case\", ( str ) => {\n\t\treturn str.toLowerCase();\n\t} );\n\treturn {\n\t\tdir: {\n\t\t\tinput: \"src\",\n\t\t\toutput: \"_site\"\n\t\t},\n\t\thtmlTemplateEngine: \"njk\"\n\t};\n}\n";
	[draft] = draftConfig("eleventy.config.js", gahlee, extensions);
	assert.ok(draft.includes("\tpassthrough: [ { images: \"images\" } ],\n"), draft);
	assert.ok(draft.includes("\tfilters: {\n\t\t// From eleventy.config.js, as written.\n\t\tsnake_case: ( str ) => {\n\t\t\treturn str.toLowerCase();\n\t\t}\n\t},\n"), draft);
	assert.ok(draft.includes("\tplugins: []\n} );\n") && !draft.includes(",\n}"), draft);
	list = byHand.map(([at, what]) => `${at}: ${what.split(" -> ")[0]}`);
	assert.deepEqual(list, ["eleventy.config.js:4: addPassthroughCopy with a variable or a computed value", "eleventy.config.js:11: addFilter(\"year\")", "eleventy.config.js:12: addShortcode(\"url\")"]);
});

test("names, flags and indentation in any script, and a byte-order mark", () => {
	// `\w` is Unicode's, as in Rust: the plugin is `pluginÉté`, and `--verbosé` is one flag.
	const config = "﻿const pluginÉté = require(\"@11ty/eleventy-plugin-rss\");\nmodule.exports = function (eleventyConfig) {\n\televentyConfig.addPlugin(pluginÉté);\n\televentyConfig.addFilter(\"shout\", (value) => {\n\t\treturn value;\n\t});\n};\n";
	const [draft, byHand] = draftConfig("eleventy.config.js", config, new Set(["md"]));
	assert.ok(byHand.some(([at, what]) => at === "eleventy.config.js:3" && what === "addPlugin(pluginÉté) (from @11ty/eleventy-plugin-rss) -> see its package below"), JSON.stringify(byHand));
	// The byte-order mark isn't indentation (Rust's `trim_start` keeps it): the draft has tabs.
	assert.ok(draft.includes("\n\tmarkdownEngine: \"liquid\",\n") && draft.includes("\t\tshout: (value) => {\n\t\t\treturn value;\n\t\t},\n"), draft);
	assert.deepEqual(rewriteScript("eleventy --pathprefix /x/ --verbosé", []), ["ssqch build --base /x/", ["--verbosé"]]);
});

test("template literals and default values that read the config stay for a person", () => {
	const config = "const dir = \"static\";\nconst dateFormat = \"%Y\";\nmodule.exports = function (eleventyConfig) {\n\televentyConfig.addPassthroughCopy(`${dir}/img`);\n\televentyConfig.addPassthroughCopy(`fonts`);\n\televentyConfig.addWatchTarget(`${dir}/css`);\n\televentyConfig.addFilter(\"year\", (value, format = dateFormat) => format + value);\n\televentyConfig.addFilter(\"shout\", (value, mark = \"!\") => value + mark);\n\televentyConfig.addShortcode(\"pick\", ({ a, b = dir } = {}, ...rest) => a + b + rest.length);\n};\n";
	const [draft, byHand] = draftConfig("eleventy.config.js", config, new Set(["md"]));
	assert.ok(draft.includes("\tpassthrough: [\"fonts\"],\n") && !draft.includes("${dir}"), draft);
	assert.ok(draft.includes("\t\tshout: (value, mark = \"!\") => value + mark,\n") && !draft.includes("dateFormat") && !draft.includes("pick:"), draft);
	assert.deepEqual(byHand.map(([at, what]) => `${at}: ${what.split(" -> ")[0]}`), ["eleventy.config.js:4: addPassthroughCopy with a variable or a computed value", "eleventy.config.js:6: addWatchTarget", "eleventy.config.js:7: addFilter(\"year\")", "eleventy.config.js:9: addShortcode(\"pick\")"]);
});

test("package.json changes where it changes, and is kept as written everywhere else", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-package-"));
	try {
		fs.writeFileSync(path.join(dir, "eleventy.config.js"), "module.exports = () => ({});\n");
		const text = "{\n\t\"name\": \"trail-guide\",\n\t\"2024\": \"year\",\n\t\"weight\": 1.0,\n\t\"exp\": 1e5,\n\t\"big\": 12345678901234567890,\n\t\"keywords\": [\"pine\", \"cone\"],\n\t\"scripts\": { \"build\": \"eleventy\", \"serve\": \"eleventy --serve\" },\n\t\"devDependencies\": {\n\t\t\"@11ty/eleventy\": \"^3.0.0\",\n\t\t\"zed\": \"1\"\n\t}\n}\n";
		fs.writeFileSync(path.join(dir, "package.json"), text);
		const [, changes, written] = eleventy(dir).edits.find(([p]) => p === "package.json")!;
		assert.equal(written, text.replace("\"build\": \"eleventy\", \"serve\": \"eleventy --serve\"", "\"build\": \"ssqch build\", \"serve\": \"ssqch serve\"").replace("\"@11ty/eleventy\": \"^3.0.0\"", `"ssqch": ${JSON.stringify(VERSION)}`));
		assert.deepEqual(changes, [`@11ty/eleventy -> ssqch ${VERSION} in devDependencies`, "scripts: eleventy -> ssqch build, eleventy --serve -> ssqch serve"]);
		// Without devDependencies, they're added at the end, laid out as the file is.
		fs.writeFileSync(path.join(dir, "package.json"), "{\n  \"name\": \"x\",\n  \"dependencies\": {\n    \"@11ty/eleventy\": \"3\"\n  }\n}\n");
		assert.equal(eleventy(dir).edits.find(([p]) => p === "package.json")![2], `{\n  "name": "x",\n  "devDependencies": {\n    "ssqch": ${JSON.stringify(VERSION)}\n  }\n}\n`);
	} finally {
		fs.rmSync(path.join(dir), { recursive: true, force: true });
	}
});

test("zola: a TOML error shows its line, and a file named templates is a template", () => {
	assert.equal(tomlError((() => { try { readToml("title = \"x\"\n= 2\n"); } catch (e) { return e; } })(), "title = \"x\"\n= 2\n"), "TOML parse error at line 2, column 1\n  |\n2 | = 2\n  | ^\nunexpected end of key\n");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-zola-"));
	try {
		fs.writeFileSync(path.join(dir, "config.toml"), "title = \"x\"\n");
		fs.writeFileSync(path.join(dir, "templates"), "{{ page.title }} {{ get_url(path=\"x\") }}");
		const byHand = zola(dir).byHand.filter(([at]) => at === "templates/").map(([, what]) => what.split(":")[0]);
		assert.deepEqual(byHand, ["1 Tera templates", "1 x Tera functions (get_url, get_section, load_data, resize_image...)", "1 x `page.title`, `page.extra`, `page.taxonomies`"]);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// A site's markdown-it can come along as it is (`engines: { md }`), or give way to ssqch's.
test("set_library_for_markdown_says_how_to_keep_it", () => {
	const config = (library: string) => `const markdownIt = require("markdown-it");\nconst md = markdownIt({ html: true });\nmodule.exports = function (eleventyConfig) {\n  eleventyConfig.setLibrary(${library});\n};\n`;
	const said = (library: string) => draftConfig(".eleventy.js", config(library), new Set(["md"]))[1].find(([at]) => at === ".eleventy.js:4")?.[1];
	assert.equal(said("\"md\", md"), "setLibrary(\"md\", md) -> keep your markdown-it as it is with `engines: { md }` (bring its import and setup into the config; `ssqch docs \"moving with identical output first\"`), or ssqch's own Markdown: `markdown: { ... }` options, render hooks and containers");
	assert.ok(said("\"md\", markdownLibrary")?.includes("`engines: { md: markdownLibrary }`"));
	assert.ok(said("\"md\", markdownIt({ html: true })")?.startsWith("setLibrary(\"md\", markdownIt({ html: true })) -> keep your markdown-it as it is with `engines: { md: yourMarkdownIt }`"));
	assert.equal(said("\"liquid\", liquid"), "setLibrary(\"liquid\") -> ssqch has its own; a library of your own is an engine: `engines: { liquid: { render: (source, data) => ... } }`");
});

// markdown-it's options that ssqch's Markdown has come along as `markdown` options (a11y #12,
// #25; v8 #24): v8.dev's config sets `breaks` in a variable, and uses implicit figures.
test("markdown_its_options_come_along", () => {
	const config = `const markdownIt = require("markdown-it");
const figures = require("markdown-it-implicit-figures");
const options = { html: true, breaks: true, linkify: true, typographer: false };
module.exports = function (eleventyConfig) {
  eleventyConfig.setLibrary("md", markdownIt(options).use(figures, { figcaption: true }));
};
`;
	const [draft, byHand] = draftConfig(".eleventy.js", config, new Set(["md"]));
	assert.ok(draft.includes("  markdown: {\n    // Eleventy's markdown-it gave headings no ids (no markdown-it-anchor); take this out for ssqch's.\n    headingIds: false,\n    // From the Eleventy config's markdown-it options.\n    breaks: true,\n    autolinks: \"fuzzy\",\n    figures: true,\n  },"), draft);
	// Eleventy 3 turns indented code off in a site's own markdown-it; with markdown-it-anchor, headings have ids.
	const three = draftConfig(".eleventy.js", config.replace("const figures", "const anchor = require(\"markdown-it-anchor\");\nconst figures"), new Set(["md"]), [], 3)[0];
	assert.ok(three.includes("    // Eleventy 3 turns off markdown-it's indented code blocks (`md.disable(\"code\")`).\n    indentedCode: false,\n") && three.includes("    // markdown-it-anchor's ids (encodeURIComponent of the text); take this out for ssqch's.\n    headingIds: \"markdown-it-anchor\",\n"), three);
	// Its own `slugify` is the site's: ssqch's ids, and the importer lists the option.
	const own = draftConfig(".eleventy.js", config.replace("const figures", "const anchor = require(\"markdown-it-anchor\");\nmd.use(anchor, { slugify: (s) => s });\nconst figures"), new Set(["md"]), [], 3)[0];
	assert.ok(!own.includes("headingIds"), own);
	// Eleventy 2 only in its own, so a site's library keeps them.
	assert.ok(!draftConfig(".eleventy.js", config, new Set(["md"]), [], 2)[0].includes("indentedCode"));
	assert.ok(byHand.some(([, what]) => what.startsWith("markdown-it-implicit-figures -> `markdown: { figures: true }`")), JSON.stringify(byHand));
	assert.ok(!draftConfig(".eleventy.js", "module.exports = () => ({ breaks: true });\n", new Set(["md"]))[0].includes("breaks"));
});

// Removing @11ty/eleventy removes what it installed, and a site's own code imports some of it
// without listing it (a11y #19: browser-sync and gray-matter; v8.dev lost `slugify`; lit.dev's
// `videos.js` imports gray-matter). Each goes into package.json at the version installed.
test("packages_that_came_with_eleventy_are_added", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-deps-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w("package.json", `{\n  "name": "trail",\n  "devDependencies": {\n    "@11ty/eleventy": "^3.1.0",\n    "sharp": "^0.34.0"\n  }\n}\n`);
	w("eleventy.config.js", "const slugify = require(\"slugify\");\nconst sharp = require(\"sharp\");\nmodule.exports = (c) => { c.addFilter(\"slug\", (s) => slugify(s)); };\n");
	w("_data/site.js", "import { DateTime } from \"luxon\";\nimport fs from \"node:fs\";\nimport path from \"path\";\n// require(\"moo\") in a comment doesn't count\nexport default { year: DateTime.now().year };\n");
	w("node_modules/@11ty/eleventy/package.json", JSON.stringify({ name: "@11ty/eleventy", version: "3.1.0", dependencies: { luxon: "^3.5.0", slugify: "^1.6.6", moo: "^0.5.2" } }));
	w("node_modules/luxon/package.json", JSON.stringify({ name: "luxon", version: "3.5.0" }));
	w("node_modules/slugify/package.json", JSON.stringify({ name: "slugify", version: "1.6.6" }));
	const plan = eleventy(dir);
	const [, changes, written] = plan.edits.find(([p]) => p === "package.json")!;
	assert.ok(changes[0].startsWith("luxon 3.5.0, slugify 1.6.6 added to devDependencies: the site's own code imports them, and they came with @11ty/eleventy"), changes.join("\n"));
	const pkg = JSON.parse(written);
	assert.deepEqual(Object.keys(pkg.devDependencies), ["luxon", "sharp", "slugify", "ssqch"]);
	assert.equal(pkg.devDependencies.luxon, "3.5.0");

	// Without node_modules, the packages sites were found importing, by name: listed for a person.
	fs.rmSync(path.join(dir, "node_modules"), { recursive: true });
	const later = eleventy(dir);
	assert.ok(later.byHand.some(([at, what]) => at === "_data/site.js" && what.startsWith("imports luxon, which came with @11ty/eleventy and isn't in package.json: add it")), JSON.stringify(later.byHand));
});

// Filters and shortcodes templates use that nothing defines are named before the first build
// fails on one (a11y #5): Eleventy's own (some ported into the draft), its plugins', and the rest.
test("filters_nothing_defines_are_listed", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-filters-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w(".eleventy.js", "module.exports = (c) => {\n  c.addFilter(\"readable\", (d) => d);\n  c.addPairedShortcode(\"callout\", (s) => s);\n};\n");
	w("_includes/post.njk", "{{ title | upper | slug }} {{ date | readable }}\n{% set prev = collections.posts | getPreviousCollectionItem(page) %}{% set here = collections.posts | getCollectionItem(page) %}\n{% callout %}x{% endcallout %}\n{{ \"a | b\" }} {{ x | mystery | safe }}{% youtube \"id\" %}\n");
	w("feed.liquid", "{{ collections.posts | rssLastUpdatedDate }} {{ \"x\" | upcase | slug }}");
	// Nunjucks' `elseif`, and the end of a tag ssqch knows (`highlight`), aren't shortcodes.
	w("_includes/more.njk", "{% if a %}a{% elseif b %}b{% endif %}{% highlight \"js\" %}x{% endhighlight %}");
	const plan = eleventy(dir);
	const said = Object.fromEntries(plan.byHand.filter(([, what]) => what.startsWith("`")).map(([at, what]) => [what.slice(1, what.indexOf("`", 1)), [at, what]]));
	assert.deepEqual(Object.keys(said).sort(), ["getCollectionItem", "mystery", "rssLastUpdatedDate", "slug", "youtube"]);
	// Outside Eleventy's input folder, a template isn't one of the site's.
	fs.writeFileSync(path.join(dir, ".eleventy.js"), fs.readFileSync(path.join(dir, ".eleventy.js"), "utf8").replace("};\n", "  return { dir: { input: \"_includes\" } };\n};\n"));
	const inside = eleventy(dir).byHand.filter(([, what]) => what.startsWith("`")).map(([, what]) => what.slice(1, what.indexOf("`", 1)));
	assert.ok(!inside.includes("rssLastUpdatedDate") && inside.includes("mystery"), JSON.stringify(inside));
	assert.equal(said.slug[0], "_includes/post.njk:1");
	assert.ok(said.slug[1].startsWith("`slug` (in 2 templates; this is the first): Eleventy's built-in `slug`"), said.slug[1]);
	assert.equal(said.youtube[0], "_includes/post.njk:4");
	assert.ok(said.mystery[1].includes("is a filter or shortcode nothing defines"), said.mystery[1]);
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("    // Eleventy's own filters the templates use, ported.\n    getCollectionItem: (collection, page) => collection.find((item) => item.url === page.url),\n"), draft);
	// `getPreviousCollectionItem` and `getNextCollectionItem` work in ssqch (aliases of `navPager`).
	assert.ok(!draft.includes("getPreviousCollectionItem"), draft);
});

// A data file that runs eleventy-img or eleventy-fetch itself is listed too (blog #3), not only
// the config's packages.
test("eleventy_packages_in_other_modules_are_listed", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-modules-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w(".eleventy.js", "const rss = require(\"@11ty/eleventy-plugin-rss\");\nmodule.exports = (c) => { c.addPlugin(rss); };\n");
	w("_data/gallery.js", "// photos\nconst Image = require(\"@11ty/eleventy-img\");\nconst EleventyFetch = require(\"@11ty/eleventy-fetch\");\nmodule.exports = async () => Image(\"a.jpg\");\n");
	const said = eleventy(dir).byHand.filter(([at]) => at.startsWith("_data/")).map(([at, what]) => `${at}: ${what.split(" -> ")[0]}`);
	assert.deepEqual(said, ["_data/gallery.js:2: @11ty/eleventy-img", "_data/gallery.js:3: @11ty/eleventy-fetch"]);
});

// The config hands `eleventyConfig` to the site's own modules (blog #2: `registerSiteFilters`
// hid 11 filters, 2 collections and a transform): their calls are listed with their own file and
// line, and what can be copied as written goes into the draft.
test("the_config_is_followed_into_the_sites_own_modules", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-helpers-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w(".eleventy.js", "const registerSiteFilters = require(\"./lib/filters\");\nconst sitePlugin = require(\"./lib/plugin.js\");\nconst unused = require(\"./lib/plain.js\");\nmodule.exports = (c) => {\n  registerSiteFilters(c);\n  c.addPlugin(sitePlugin);\n};\n");
	w("lib/filters.js", "const more = require(\"./more\");\nmodule.exports = (config) => {\n  config.addFilter(\"shout\", (s) => s.toUpperCase());\n  config.addCollection(\"posts\", (api) => api.getAll());\n  more(config);\n};\n");
	w("lib/more.js", "module.exports = (config) => {\n  config.addTransform(\"tidy\", (content) => content);\n};\n");
	w("lib/plugin.js", "module.exports = (config) => {\n  config.addShortcode(\"year\", () => \"2026\");\n};\n");
	w("lib/plain.js", "module.exports = { a: 1 };\n");
	const plan = eleventy(dir);
	const listed = plan.byHand.filter(([at]) => at.startsWith("lib/") || at.startsWith(".eleventy.js:6")).map(([at, what]) => `${at}: ${what.split(" -> ")[0].split(":")[0]}`);
	assert.deepEqual(listed, [".eleventy.js:6: addPlugin(sitePlugin) (from ./lib/plugin.js)", "lib/filters.js:4: addCollection(\"posts\")", "lib/more.js:2: addTransform(\"tidy\")"]);
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("    // From lib/filters.js, as written.\n    shout: (s) => s.toUpperCase(),\n") && draft.includes("    // From lib/plugin.js, as written.\n    year: () => \"2026\","), draft);
});

// `import pluginRSS, { dateToRfc3339 } from "@11ty/eleventy-plugin-rss"`, the blog's: the plugin's
// package is found when the default import has named ones beside it, either way round.
test("a_plugins_package_is_found_beside_named_imports", () => {
	const config = "import pluginRSS, {\n  dateToRfc3339,\n} from \"@11ty/eleventy-plugin-rss\";\nimport Image, { eleventyImageTransformPlugin } from \"@11ty/eleventy-img\";\nexport default (c) => {\n  c.addPlugin(pluginRSS);\n  c.addPlugin(eleventyImageTransformPlugin);\n};\n";
	const said = draftConfig("eleventy.config.js", config, new Set())[1].filter(([, what]) => what.startsWith("addPlugin")).map(([, what]) => what);
	assert.deepEqual(said, ["addPlugin(pluginRSS) (from @11ty/eleventy-plugin-rss) -> see its package below", "addPlugin(eleventyImageTransformPlugin) (from @11ty/eleventy-img) -> see its package below"]);
});

// What the fresh a11yproject.com move found the importer missing: addLayoutAlias (`layout: post`
// found a partial), .eleventyignore (a KSS doc became a page), dataTemplateEngine, and
// `eleventy.generator`, which Eleventy 1 printed as nothing (rewritten, 112 pages changed).
test("layout_aliases_ignores_and_eleventy_1s_generator_come_along", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-aliases-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w("package.json", "{\n  \"name\": \"a11y\",\n  \"devDependencies\": {\n    \"@11ty/eleventy\": \"^1.0.0\"\n  }\n}\n");
	w(".eleventy.js", "module.exports = (c) => {\n  c.addLayoutAlias(\"post\", \"layouts/post.njk\");\n  return { dir: { input: \"src\" }, dataTemplateEngine: \"njk\" };\n};\n");
	w("src/.eleventyignore", "# styleguide sources\ncss/\nimg/\n");
	w("src/_includes/layouts/base.njk", "<meta name=\"generator\" content=\"{{ eleventy.generator }}\">");
	const plan = eleventy(dir);
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("  layoutAliases: { post: \"layouts/post.njk\" },\n"), draft);
	assert.ok(draft.includes("  // From .eleventyignore.\n  ignore: [\"css/**\", \"img/**\"],\n"), draft);
	assert.ok(plan.byHand.some(([, what]) => what.startsWith("dataTemplateEngine: \"njk\" -> ssqch doesn't render data files' strings")), JSON.stringify(plan.byHand));
	assert.ok(!plan.edits.some(([file]) => file === "src/_includes/layouts/base.njk"), "Eleventy 1's generator tag stays");
	assert.ok(plan.byHand.some(([at, what]) => at === "src/_includes/layouts/base.njk" && what.includes("Eleventy 1 printed nothing for them")));
	// A notes file outside the input folder that mentions it isn't one of the site's templates.
	w("notes/move.md", "We kept `{{ eleventy.generator }}` as it was.\n");
	assert.ok(!eleventy(dir).byHand.some(([at]) => at === "notes/move.md"));
	// Eleventy 2 printed it: rewritten as before.
	w("package.json", "{\n  \"name\": \"a11y\",\n  \"devDependencies\": {\n    \"@11ty/eleventy\": \"^2.0.1\"\n  }\n}\n");
	assert.ok(eleventy(dir).edits.some(([file, changes]) => file === "src/_includes/layouts/base.njk" && changes.includes("eleventy.generator/version -> ssqch.generator/version")));
});

// From the a11yproject.com rerun: `eleventy & gulp` runs both at once, so npm's script returns
// while ssqch may still be writing; and a file passed through twice is listed once.
test("scripts_that_run_ssqch_beside_another_command_are_listed", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-amp-"));
	fs.writeFileSync(path.join(dir, ".eleventy.js"), "module.exports = (c) => {\n  c.addPassthroughCopy(\"src/logo.png\");\n  c.addPassthroughCopy(\"src/logo.png\");\n  return { dir: { input: \"src\" } };\n};\n");
	fs.mkdirSync(path.join(dir, "src"));
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { publish: "eleventy & gulp", build: "eleventy && gulp" }, devDependencies: { "@11ty/eleventy": "^1.0.0" } }, null, 2));
	const plan = eleventy(dir);
	const said = plan.byHand.filter(([at, what]) => at === "package.json" && what.includes("at the same time"));
	assert.equal(said.length, 1, JSON.stringify(plan.byHand));
	assert.ok(said[0][1].startsWith("the `publish` script runs `ssqch build` and another command at the same time (`&`)"), said[0][1]);
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.equal(draft.split("src/logo.png").length, 2, draft);
});

// From the a11yproject.com rerun: Eleventy 1's `dataTemplateEngine` rendered `{{ '/x/' | url }}`
// in data files (27 strings in 4 files); ssqch prints them as written.
test("data_files_url_literals_become_the_literal", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-data-engine-"));
	fs.writeFileSync(path.join(dir, ".eleventy.js"), "module.exports = () => ({ dataTemplateEngine: \"njk\", dir: { input: \"src\" } });\n");
	fs.mkdirSync(path.join(dir, "src/_data"), { recursive: true });
	fs.writeFileSync(path.join(dir, "src/_data/nav.json"), "[{ \"url\": \"{{ '/about//team/../' | url }}\" }, { \"url\": \"{{ \\\"/x/\\\" | url }}\" }, { \"title\": \"{{ site.title }}\" }]\n");
	const plan = eleventy(dir);
	const edit = plan.edits.find(([file]) => file === "src/_data/nav.json");
	assert.ok(edit, JSON.stringify(plan.edits));
	assert.equal(edit![2], "[{ \"url\": \"/about/\" }, { \"url\": \"/x/\" }, { \"title\": \"{{ site.title }}\" }]\n");
	assert.ok(edit![1].includes("2 `{{ \"/x/\" | url }}` -> \"/x/\" (dataTemplateEngine rendered them)"), JSON.stringify(edit![1]));
	assert.ok(plan.byHand.some(([at, what]) => at === "src/_data/nav.json" && what.startsWith("1 value has template code")), JSON.stringify(plan.byHand));
});

// Only the input folder's data is Eleventy's: a JSON file elsewhere (scout's own saved report, in
// the a11yproject.com run on 0.11) is left as it is.
test("data_files_outside_the_input_folder_are_left_alone", () => {
	const dir = site("data-outside", {
		".eleventy.js": "module.exports = () => ({ dataTemplateEngine: \"njk\", dir: { input: \"src\" } });\n",
		"src/_data/nav.json": "[{ \"url\": \"{{ '/about/' | url }}\" }]\n",
		"src/posts/posts.json": "{ \"img\": \"{{ '/img/x.png' | url }}\" }\n",
		"notes/scout-before.json": "{ \"what\": \"{{ '/x/' | url }} -> /x/\", \"title\": \"{{ site.title }}\" }\n",
	});
	const plan = eleventy(dir);
	assert.deepEqual(plan.edits.map(([file]) => file).sort(), ["src/_data/nav.json", "src/posts/posts.json"]);
	assert.ok(!plan.byHand.some(([at]) => at.startsWith("notes/")), JSON.stringify(plan.byHand));
});

// The a11yproject.com run on 0.11: Eleventy writes `dist`, its `publish` script runs gulp beside
// it, and `.nvmrc` asks for Node 16.
test("the_reference_build_is_the_sites_own", () => {
	const dir = site("reference-build", {
		".eleventy.js": "module.exports = () => ({ dir: { input: \"src\", output: \"dist\" } });\n",
		"package.json": JSON.stringify({ scripts: { start: "eleventy --serve & gulp watch", publish: "eleventy & gulp" }, devDependencies: { "@11ty/eleventy": "^1.0.0" } }),
		"gulpfile.js": "const gulp = require(\"gulp\");\n",
		".nvmrc": "16\n",
	});
	const report = scoutReport(eleventy(dir), dir, "eleventy", ".eleventy.js");
	assert.equal(report.build.command, "eleventy && gulp");
	assert.equal(report.build.output, "dist");
	assert.equal(report.build.baseline, "ssqch baseline \"eleventy && gulp\" --from dist");
	assert.ok(report.build.needs.some((n) => n.startsWith("The site asks for Node 16 (.nvmrc), and ssqch needs 22.18 or later")), JSON.stringify(report.build.needs));
	// Mid-move, the script runs ssqch: the reference is Eleventy again, with gulp after it.
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { publish: "ssqch build & gulp" }, engines: { node: ">=16" } }));
	fs.rmSync(path.join(dir, ".nvmrc"));
	const moving = scoutReport(eleventy(dir), dir, "eleventy", ".eleventy.js");
	assert.equal(moving.build.command, "npx @11ty/eleventy && gulp");
	// A range open at the top takes ssqch's Node too.
	assert.deepEqual(moving.build.needs, []);
	// A gulpfile no script runs is added after the generator.
	fs.writeFileSync(path.join(dir, "package.json"), "{}");
	assert.equal(scoutReport(eleventy(dir), dir, "eleventy", ".eleventy.js").build.command, "npx @11ty/eleventy && npx gulp");
});

// The a11yproject.com run on 0.11: 29 to-dos before the move, 37 when the output was identical,
// none done. What the ssqch config defines under the same name is done, and its own imports of
// Eleventy's packages (an identical first build keeps them) aren't to-dos.
test("scout_counts_what_an_eleventy_sites_config_defines_as_done", async () => {
	const dir = site("eleventy-done", {
		".eleventy.js": "const pluginRss = require(\"@11ty/eleventy-plugin-rss\");\nconst markdownIt = require(\"markdown-it\");\nconst slugify = require(\"./lib/slugify\");\nmodule.exports = (eleventyConfig) => {\n\televentyConfig.addPlugin(pluginRss);\n\televentyConfig.addFilter(\"slugify\", slugify);\n\televentyConfig.addCollection(\"posts\", (api) => api.getAll());\n\televentyConfig.addTransform(\"htmlmin\", minify);\n\televentyConfig.setLibrary(\"md\", markdownIt());\n\treturn { dir: { input: \"src\" } };\n};\n",
		"src/feed.njk": "{{ site.url | absoluteUrl }} {{ posts | trailMix }}\n",
	});
	const codes = (r: ReturnType<typeof scoutReport>) => r.todo.map((t) => t.what.split(" -> ")[0].split(":")[0]);
	const before = scoutReport(eleventy(dir), dir, "eleventy", ".eleventy.js", await siteConfig(dir));
	assert.equal(before.summary.done, 0);
	for (const want of ["addPlugin(pluginRss) (from @11ty/eleventy-plugin-rss)", "addFilter(\"slugify\")", "addCollection(\"posts\")", "addTransform(\"htmlmin\")", "`absoluteUrl`", "`trailMix` is a filter or shortcode nothing defines", "@11ty/eleventy-plugin-rss", "markdown-it"]) {
		assert.ok(codes(before).some((c) => c.startsWith(want)), `${want} in ${JSON.stringify(codes(before))}`);
	}
	// The identical first build: the old packages imported as they are, the site's functions by name.
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), "const rss = () => import(\"@11ty/eleventy-plugin-rss\");\nconst md = () => import(\"markdown-it\");\nexport default {\n\tengines: { md: {} },\n\tfilters: { slugify: (s) => s, absoluteUrl: (s) => s },\n\tcollections: { posts: (pages) => pages.all() },\n\tplugins: [{ name: \"ssqch/minify\" }],\n};\n");
	const after = scoutReport(eleventy(dir), dir, "eleventy", ".eleventy.js", await siteConfig(dir));
	assert.deepEqual(codes(after), ["`trailMix` is a filter or shortcode nothing defines"]);
	assert.equal(after.summary.done, before.todo.length - 1);
	assert.deepEqual([...new Set(after.done.map((d) => d.option))].sort(), ["collections.posts", "engines.md", "filters.absoluteUrl", "filters.slugify", "import \"@11ty/eleventy-plugin-rss\"", "ssqch/minify"]);
	assert.ok(!after.todo.some((t) => t.at.startsWith("ssqch.config.js")), "the config's own imports aren't to-dos");
	// ssqch's own way counts too: `rssPlugin()` has the RSS plugin's filters.
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), "export default { plugins: [{ name: \"ssqch/rss\" }] };\n");
	const rss = scoutReport(eleventy(dir), dir, "eleventy", ".eleventy.js", await siteConfig(dir));
	assert.ok(!codes(rss).some((c) => c.startsWith("`absoluteUrl`") || c.startsWith("addPlugin(pluginRss)") || c === "@11ty/eleventy-plugin-rss"), JSON.stringify(codes(rss)));
	assert.match(scoutText(rss, { writeDraft: false }), /done already: ssqch\.config\.js has `ssqch\/rss`\./);
});

// What changes output beyond the mechanical edits, found before the first diff (a11y #3, #13;
// v8 #12, #13; the a11yproject.com rerun).
test("output_changes_are_listed_before_the_first_diff", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-output-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w(".eleventy.js", "module.exports = (c) => {\n  c.ignores.add(\"src/drafts/**\");\n  c.addPassthroughCopy(\"src/demos\");\n  c.addFilter(\"day\", (d) => d.toLocaleDateString(\"en-US\"));\n  c.addFilter(\"utc\", (d) => d.toLocaleDateString(\"en-US\", { timeZone: \"UTC\" }));\n  return { dir: { input: \"src\" } };\n};\n");
	w("src/_includes/post.njk", "<time>{{ date }}</time>\n<p>{{ page.date }}</p>\n");
	w("src/tags.njk", "---\npagination:\n  data: collections\n  size: 1\n---\n{{ pagination.items[0] }}\n");
	w("src/demos/one.njk", "{{ 1 + 1 }}");
	const plan = eleventy(dir);
	const at = (where: string) => plan.byHand.find(([a]) => a === where)?.[1] ?? "";
	assert.ok(at("src/_includes/post.njk:1").startsWith("`{{ date }}` prints a Date as it is (in 1 template, 1 time; this is the first)"), JSON.stringify(plan.byHand));
	assert.ok(at("src/tags.njk:2").startsWith("`pagination: { data: collections }`"), JSON.stringify(plan.byHand));
	assert.ok(at(".eleventy.js:4").startsWith("`toLocaleDateString` without a time zone"), JSON.stringify(plan.byHand));
	assert.equal(at(".eleventy.js:5"), "");
	assert.ok(at("src/demos").startsWith("is passed through, and has 1 template (src/demos/one.njk)"), JSON.stringify(plan.byHand));
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("\"drafts/**\""), draft);
});

// Jekyll's permalinks as ssqch's (Liquid, for a folder's directory data).
test("jekyll_permalinks_become_liquid", () => {
	assert.equal(jekyllPermalink("pretty", ""), "{% if categories %}/{{ categories | join: '/' | downcase }}{% endif %}/{{ page.date | date: '%Y' }}/{{ page.date | date: '%m' }}/{{ page.date | date: '%d' }}/{{ page.fileSlug }}/");
	// `filePathStem` starts with `/` (opensource.guide's URLs were `//ar/metrics/`).
	assert.equal(jekyllPermalink("/:collection/:path/", "_guides"), "/guides{{ page.filePathStem | remove_first: '/_guides' }}/");
	assert.equal(jekyllPermalink("/:path/", "_articles"), "{{ page.filePathStem | remove_first: '/_articles' }}/");
	assert.equal(jekyllPermalink("/blog/:title:output_ext", ""), "/blog/{{ page.fileSlug }}.html");
	assert.equal(jekyllPermalink("/:title/", ""), "/{{ page.fileSlug }}/");
	assert.equal(jekyllPermalink("/:week/:title/", ""), undefined);
});

// The importer edits no template: `jekyllTemplates: true` gives Jekyll's `page` and `site`. What
// it doesn't give is listed (the fresh runs: excerpts, `sort`, `page.next`).
test("jekyll_templates_are_listed_not_rewritten", () => {
	const notes = jekyllTemplateNotes("{{ page.title }}{{ page.next.url }}{{ page.next.title }}{% assign list = site.articles | sort: 'order' %}{{ post.excerpt }}{{ page.path }}", ["posts", "articles"]);
	assert.deepEqual(notes, [
		"`page.next` (2): `navPager(collections.posts, page.url).next`",
		"`excerpt` isn't Jekyll's: Jekyll's is the source up to `excerpt_separator` (the first blank line), rendered; ssqch's is the page up to `<!-- more -->`, or else its first paragraph. They differ when a page starts with something else than a paragraph",
		"`sort: 'order'` on a collection: Jekyll's `sort` puts the items without `order` first, ssqch's (Liquid's) last; with some missing it, sort them in the config, or a filter of your own",
	]);
});

test("the_seo_include_is_the_docs_one", () => {
	const docs = fs.readFileSync(new URL("../../../site/src/docs/trailheads/from-jekyll.md", import.meta.url), "utf8");
	assert.equal(SEO_INCLUDE, /```liquid\n([\s\S]*?)```/.exec(docs)?.[1]);
});

// A second build tool (a11yproject.com's gulpfile), with ssqch's way for each part it does.
test("other_build_tools_are_listed_with_ssqchs_ways", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-gulp-"));
	fs.writeFileSync(path.join(dir, ".eleventy.js"), "module.exports = () => ({});\n");
	fs.writeFileSync(path.join(dir, "gulpfile.js"), "const sass = require(\"gulp-sass\")(require(\"sass\"));\nconst kss = require(\"kss\");\nconst svgmin = require(\"gulp-svgmin\");\n");
	const said = eleventy(dir).byHand.find(([at]) => at === "gulpfile.js")?.[1] ?? "";
	assert.ok(said.startsWith("Gulp builds part of the site too: keep it for the first, identical build"), said);
	assert.ok(said.includes("Sass -> `sassPlugin()`") && said.includes("SVG optimizing") && said.includes("a style guide (KSS)") && !said.includes("autoprefixer"), said);
});

// From the fresh opensource.guide rerun: the agent's notes (untracked) went into `passthrough`.
test("jekyll_import_leaves_untracked_files_out", { skip: spawnSync("git", ["--version"]).status !== 0 && "needs git" }, () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-untracked-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w("_config.yml", "title: Trail\n");
	w("robots.txt", "User-agent: *\n");
	w("assets/stump.png", "png");
	spawnSync("git", ["-C", dir, "init", "-q"]);
	spawnSync("git", ["-C", dir, "add", "-A"]);
	w("notes/raw/today.txt", "notes");
	const plan = jekyll(dir);
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("passthrough: [\"robots.txt\", \"assets\"],"), draft);
	assert.ok(plan.byHand.some(([at, what]) => at === "notes/" && what.startsWith("1 file git doesn't track (notes/) left out of `passthrough`")), JSON.stringify(plan.byHand));
});

// From the fresh opensource.guide rerun: GitHub Pages gave `site.url` from the CNAME (381 pages),
// and the importer named the plugins' other files without writing them.
test("jekyll_import_writes_what_github_pages_and_its_plugins_did", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-pages-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w("_config.yml", "title: Trail\n");
	w("CNAME", "trail.example\n");
	w("Gemfile", "gem \"github-pages\", group: :jekyll_plugins\n");
	w("index.md", "---\n---\n# Pine\n");
	const plan = jekyll(dir);
	const file = (name: string) => plan.newFiles.find(([f]) => f === name)?.[2] ?? "";
	assert.ok(file("ssqch.config.js").includes("const site = { ...readData(\"_config.yml\"), url: \"https://trail.example\" };"), file("ssqch.config.js"));
	assert.ok(file("_includes/hooks/fence.liquid").startsWith("<div class=\"language-{% if fence.lang"), JSON.stringify(plan.newFiles.map(([f]) => f)));
	assert.ok(file("_includes/hooks/code.liquid").includes("highlighter-rouge"));
	// github-pages has neither jekyll-sitemap nor jekyll-redirect-from by itself.
	assert.equal(file("robots.liquid"), "");
	w("_config.yml", "title: Trail\nurl: https://example.com\nplugins: [jekyll-sitemap, jekyll-redirect-from]\n");
	const again = jekyll(dir);
	const other = (name: string) => again.newFiles.find(([f]) => f === name)?.[2] ?? "";
	assert.ok(other("ssqch.config.js").includes("const site = readData(\"_config.yml\");"), other("ssqch.config.js"));
	assert.ok(other("robots.liquid").includes("Sitemap: {{ site.url }}/sitemap.xml") && other("redirects.liquid").includes("permalink: /redirects.json"));
	assert.ok(other("_includes/hooks/redirect.liquid").includes("{%- assign to = site.url | append: redirect.to -%}"));
});

// From the fresh www.ruby-lang.org move: the importer wrote front matter into `_data` (the build
// failed), missed every `_posts` folder but the top one, said nothing of `_plugins/`, left a `.rss`
// layout that never ran Liquid, copied `images/_obsolete/`, and renamed `site.data` in 1,002 pages.
test("jekyll_import_reads_a_site_like_rubys", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-import-ruby-"));
	const w = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	w("_config.yml", "title: Ruby\npermalink: pretty\n");
	w("_data/locales.yml", "---\nen: { posted_by: \"Posted by %a\" }\n");
	w("en/news/_posts/2016-07-26-pine.md", "---\ntitle: Pine\n---\n{{ site.data.locales.en.posted_by }}\n");
	w("_layouts/news_feed.rss", "<rss>{{ content }}</rss>\n");
	w("_plugins/posted_by.rb", "module Jekyll\n  module PostedByFilter\n    def posted_by(date)\n    end\n  end\nend\nLiquid::Template.register_filter(Jekyll::PostedByFilter)\n");
	w("_plugins/llms.rb", "Jekyll::Hooks.register :site, :post_write do |site|\nend\n");
	w("images/logo.png", "png");
	w("images/_obsolete/old.png", "png");
	const plan = jekyll(dir);
	assert.ok(!plan.edits.some(([f]) => f.startsWith("_data/")) && !plan.newFiles.some(([f]) => f.startsWith("_data/")), JSON.stringify(plan.edits.map(([f]) => f)));
	// `site.data` stays as it's written, and the config puts the data under it.
	assert.ok(!plan.edits.some(([f]) => f.startsWith("en/news/")), JSON.stringify(plan.edits.map(([f]) => f)));
	const config = plan.newFiles.find(([f]) => f === "ssqch.config.js")![2];
	assert.ok(config.includes("import { fromJekyll } from \"ssqch/from-jekyll\";") && config.includes("plugins: [fromJekyll()"), config);
	assert.ok(config.includes("passthrough: [\"images/logo.png\"]"), config);
	const posts = plan.newFiles.find(([f]) => f === "en/news/_posts/_posts.json")?.[2] ?? "";
	assert.ok(posts.includes("\"permalink\": \"/en/news{% if categories %}"), posts);
	assert.deepEqual(plan.renames, [["_layouts/news_feed.rss", "_layouts/news_feed.liquid"]]);
	const said = (at: string) => plan.byHand.find(([a]) => a === at)?.[1] ?? "";
	assert.ok(said("_plugins/posted_by.rb").startsWith("a Ruby plugin, which ssqch doesn't run: filters `posted_by`: functions in the config's `filters`"), said("_plugins/posted_by.rb"));
	assert.ok(said("_plugins/llms.rb").includes("a `site` `post_write` hook: `afterBuild`"), said("_plugins/llms.rb"));
});

/** A folder with these files in it. */
function site(name: string, files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-scout-${name}-`));
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	}
	return dir;
}

test("scout_finds_the_generator_from_its_files", () => {
	assert.deepEqual(detect(site("eleventy", { "eleventy.config.js": "" })), [["eleventy", "eleventy.config.js"]]);
	assert.deepEqual(detect(site("eleventy-pkg", { "package.json": "{\"devDependencies\":{\"@11ty/eleventy\":\"3\"}}" })), [["eleventy", "package.json (@11ty/eleventy)"]]);
	assert.deepEqual(detect(site("jekyll", { "_config.yml": "title: x\n" })), [["jekyll", "_config.yml"]]);
	assert.deepEqual(detect(site("jekyll-gem", { "Gemfile": "gem \"github-pages\"\n" })), [["jekyll", "Gemfile"]]);
	// Hexo has a _config.yml too: its package says which.
	assert.deepEqual(detect(site("hexo", { "_config.yml": "title: x\n", "package.json": "{\"dependencies\":{\"hexo\":\"7\"}}" })), [["hexo", "_config.yml and package.json (hexo)"]]);
	// config.toml is Hugo's old name and Zola's only one.
	assert.deepEqual(detect(site("hugo-old", { "config.toml": "baseURL = \"https://x\"\n" })), [["hugo", "config.toml (baseURL)"]]);
	assert.deepEqual(detect(site("zola", { "config.toml": "base_url = \"https://x\"\n" })), [["zola", "config.toml (base_url)"]]);
	assert.deepEqual(detect(site("hugo", { "hugo.toml": "" })), [["hugo", "hugo.toml"]]);
	assert.deepEqual(detect(site("mkdocs", { "mkdocs.yml": "" })), [["mkdocs", "mkdocs.yml"]]);
	assert.deepEqual(detect(site("docusaurus", { "docusaurus.config.ts": "" })), [["docusaurus", "docusaurus.config.ts"]]);
	assert.deepEqual(detect(site("nothing", { "index.html": "" })), []);
	assert.equal(detect(site("two", { "mkdocs.yml": "", "hugo.toml": "" })).length, 2);
});

test("scout_patches_apply_with_git", () => {
	// Three lines of context, hunks that share context joined, and a file without a last newline.
	const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}\n`).join("");
	const after = before.replace("line 2\n", "line two\n").replace("line 5\n", "line five\n").replace("line 18\n", "");
	assert.equal(unifiedHunks(before, after), "@@ -1,8 +1,8 @@\n line 1\n-line 2\n+line two\n line 3\n line 4\n-line 5\n+line five\n line 6\n line 7\n line 8\n@@ -15,6 +15,5 @@\n line 15\n line 16\n line 17\n-line 18\n line 19\n line 20\n");
	assert.equal(unifiedHunks("a\nb", "a\nc"), "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n");
	assert.equal(unifiedHunks("", "a\n"), "@@ -0,0 +1,1 @@\n+a\n");
	// A rename with an edit, and one without, applied by git to the files as they are.
	const dir = site("patch", { "a.json": before, "b.11tydata.json": "{}\n", "c.md": "x\n" });
	const patch = patchOf({ from: "Eleventy", renames: [["b.11tydata.json", "b.data.json"], ["c.md", "d.md"]], edits: [["a.json", ["edited"], after], ["c.md", ["edited"], "y\n"]], newFiles: [], byHand: [] }, dir);
	fs.writeFileSync(path.join(dir, "move.patch"), patch);
	// Windows' git writes CRLF when it applies a patch (core.autocrlf), which is the machine's setting, not the patch's.
	const r = spawnSync("git", ["-c", "core.autocrlf=false", "apply", "move.patch"], { cwd: dir, encoding: "utf8" });
	assert.equal(r.status, 0, `${r.stderr}\n${patch}`);
	assert.equal(fs.readFileSync(path.join(dir, "a.json"), "utf8"), after);
	assert.equal(fs.readFileSync(path.join(dir, "b.data.json"), "utf8"), "{}\n");
	assert.equal(fs.readFileSync(path.join(dir, "d.md"), "utf8"), "y\n");
	assert.ok(!fs.existsSync(path.join(dir, "b.11tydata.json")) && !fs.existsSync(path.join(dir, "c.md")));
});

test("scout_lists_what_a_hugo_site_uses", () => {
	const dir = site("hugo-list", {
		"hugo.toml": "baseURL = \"https://example.com/\"\n",
		"content/trails/_index.md": "---\ntitle: Trails\ncascade:\n  layout: trail\n---\n",
		"content/trails/cedar.md": "---\ntitle: Cedar\n---\n{{< note >}}\nPack water\n{{< /note >}}\n\n{{< youtube abc >}}\nSee {{< ref \"old-growth\" >}}.\n",
		"content/trails/old-growth.md": "---\ntitle: Old Growth\n---\nWrite `{{ .Title }}` in a template.\n",
		"layouts/baseof.html": "{{ $js := resources.Get \"app.js\" | js.Build }}{{ block \"main\" . }}{{ end }}\n",
		"layouts/shortcodes/note.html": "<aside>{{ .Inner }}</aside>",
		"layouts/_markup/render-link.html": "<a href=\"{{ .Destination }}\">{{ .Text }}</a>",
		"layouts/_markup/render-table.html": "<table></table>",
		"static/robots.txt": "",
	});
	const plan = hugo(dir);
	const said = plan.byHand.map(([at, what]) => `${at}: ${what}`);
	const has = (text: string) => assert.ok(said.some((line) => line.includes(text)), `${text}\n${said.join("\n")}`);
	has("content: 3 shortcodes, called in 1 page: `fromHugo()` (in the draft)");
	has("content/trails/cedar.md:4: `{{< note >}}`, the site's own (layouts/shortcodes/note.html) (1 use in 1 file; this is the first): a container; port its template into _includes/containers/note.jinja (in the draft)");
	has("content/trails/cedar.md:8: `{{< youtube >}}`, Hugo's (1 use in 1 file; this is the first): a container; write `_includes/containers/youtube.jinja`");
	has("content/trails/cedar.md:9: `{{< ref >}}` inside a line of text, Hugo's (1 use in 1 file; this is the first): its container template renders it in place, with `container.inline` true; write `_includes/containers/ref.jinja`");
	has("content/trails/old-growth.md:4: `{{ }}` or `{% %}` as text in 1 page");
	has("content: 1 section (`_index.md`)");
	has("`cascade` in 1 page's front matter");
	has("layouts/_markup/render-link.html: a render hook: ssqch's is `_includes/hooks/link.<ext>`");
	has("layouts/_markup/render-table.html: a table hook: not in ssqch yet");
	has("layouts: 4 Go templates to port:");
	has("layouts/baseof.html:1: `js.Build` (esbuild)");
	// A closing tag isn't a call.
	assert.ok(!said.some((line) => line.includes("{{< /note")), said.join("\n"));
	// The draft reads the content as it is, with a container to port for the site's own shortcode.
	const config = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	for (const part of ["dirs: { input: \"content\", output: \"public\", includes: \"../_includes\" },", "markdownEngine: false,", "markdown: { highlight: { classes: \"pygments\" } },", "passthrough: [{ static: \".\" }],", "data: { site: {\"url\":\"https://example.com\"} },", "plugins: [fromHugo(), sitemapPlugin({ url: \"https://example.com\" }), linksPlugin({ fail: false })],", "import { fromHugo } from \"ssqch/from-hugo\";"]) assert.ok(config.includes(part), `${part}\n${config}`);
	assert.ok(plan.newFiles.some(([file]) => file === "_includes/containers/note.jinja"));
	assert.equal(plan.pages, 3);
});

test("scout_lists_what_an_mkdocs_site_uses", () => {
	const dir = site("mkdocs-list", {
		// MkDocs' YAML tags read as plain values.
		"mkdocs.yml": "site_name: Trail\nsite_url: https://example.com/\nrepo_url: https://example.com/repo\ntheme:\n  name: material\nnav:\n  - Home: index.md\n  - Trails:\n    - trails/cedar.md\n    - Old Growth: trails/old.md\nplugins:\n  - search\n  - redirects:\n      redirect_maps: {}\n  - pine-cones\nmarkdown_extensions:\n  - admonition\n  - toc:\n      slugify: !!python/object/apply:pymdownx.slugs.slugify\n        kwds:\n          case: lower\n  - pymdownx.emoji:\n      emoji_index: !!python/name:material.extensions.emoji.twemoji\nextra:\n  analytics: !ENV [ANALYTICS, none]\n",
		"docs/index.md": "# Home\n\n!!! note \"Pack\"\n    Water\n\n=== \"Cedar\"\n\n    Flat\n\nSee [Cedar](trails/cedar.md#trailhead) and [old].\n\n[old]: trails/old.md\n",
		"docs/trails/cedar.md": "---\ndate:\n  created: 2026-01-02\n---\n:material-pine-tree: Cedar\n",
	});
	const said = mkdocs(dir).byHand.map(([at, what]) => `${at}: ${what}`);
	const has = (text: string) => assert.ok(said.some((line) => line.includes(text)), `${text}\n${said.join("\n")}`);
	has("mkdocs.yml: theme: the Material theme's templates are Jinja, which ssqch runs as written with `fromMkdocs({ templates: true })`");
	has("mkdocs.yml: plugins: `search`: MkDocs writes `search/search_index.json`");
	has("mkdocs.yml: plugins: `redirects`: `redirectsPlugin({ redirects })`");
	has("mkdocs.yml: markdown_extensions: `admonition`: `!!!` admonitions: `fromMkdocs()` (in the draft)");
	has("mkdocs.yml: plugins: `pine-cones`: not in ssqch yet: port it as a plugin");
	has("mkdocs.yml: markdown_extensions: `toc`: `fromMkdocs()` (in the draft)");
	has("mkdocs.yml: markdown_extensions: `pymdownx.emoji`: `:icon:` shortcodes: not in ssqch yet");
	has("docs/index.md:10: links to .md files (2 uses in 1 file; this is the first): `fromMkdocs()` (in the draft)");
	has("docs/index.md:3: admonitions (`!!!`, `???`) (1 use in 1 file");
	has("docs/index.md:6: tabs (`===`) (1 use in 1 file");
	has("docs/trails/cedar.md:5: icons and emoji (`:name:`) (1 use in 1 file");
	has("docs/trails/cedar.md: `date: { created, updated }` front matter");
	// The draft: the config with the pages' syntax on, and the nav as data, with URLs for paths.
	const plan = mkdocs(dir);
	const config = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	for (const part of ["dirs: { input: \"docs\", output: \"site\", includes: \"../_includes\", data: \"../_data\" },", "markdown: { footnotes: false },", "import { fromMkdocs } from \"ssqch/from-mkdocs\";", "plugins: [fromMkdocs(), ", "\"name\":\"Trail\"", "redirectsPlugin({ redirects: {} })", "sitemapPlugin({ url: \"https://example.com\" })"]) assert.ok(config.includes(part), `${part}\n${config}`);
	assert.equal(plan.newFiles.find(([file]) => file === "_data/nav.yml")![2], "# From mkdocs.yml's nav, by ssqch scout: titles as the nav gives them, or each page's first heading.\n- title: Home\n  url: /\n- title: Trails\n  children:\n    - title: cedar\n      url: /trails/cedar/\n    - title: Old Growth\n      url: /trails/old/\n");
	assert.equal(plan.pages, 2);
});

test("scout_lists_what_docusaurus_astro_vitepress_and_hexo_sites_use", () => {
	const lines = (plan: ReturnType<typeof other>) => plan.byHand.map(([at, what, meta]) => `${meta?.status}: ${at}: ${what}`);
	const has = (said: string[], text: string) => assert.ok(said.some((line) => line.includes(text)), `${text}\n${said.join("\n")}`);
	const docusaurus = lines(other(site("docusaurus-list", {
		"docusaurus.config.js": "", "sidebars.js": "", "package.json": "{\"dependencies\":{\"@docusaurus/plugin-client-redirects\":\"3\",\"docusaurus-plugin-pine\":\"1\"}}",
		"docs/intro.mdx": "import Tabs from '@theme/Tabs';\n\n<Tabs>\n</Tabs>\n\n:::tip\nx\n:::\n",
		"blog/2026-01-02-pine.md": "Hi\n\n<!-- truncate -->\n",
	}), "docusaurus"));
	has(docusaurus, "site: docs/intro.mdx: 1 MDX page");
	has(docusaurus, "site: docs/intro.mdx:1: `import` of components in pages (1 use in 1 file");
	has(docusaurus, "ssqch: docs/intro.mdx:6: admonitions (`:::note`)");
	has(docusaurus, "not-yet: blog/2026-01-02-pine.md:3: `<!-- truncate -->`");
	has(docusaurus, "ssqch: sidebars.js: the sidebar");
	has(docusaurus, "ssqch: package.json: @docusaurus/plugin-client-redirects: `redirectsPlugin()`");
	has(docusaurus, "site: package.json: docusaurus-plugin-pine: not in ssqch yet");
	const astro = lines(other(site("astro-list", { "astro.config.mjs": "", "src/pages/index.astro": "", "src/components/Map.tsx": "", "src/content.config.ts": "", "package.json": "{\"dependencies\":{\"@astrojs/sitemap\":\"3\"}}" }), "astro"));
	has(astro, "site: src/components/Map.tsx: 1 framework component");
	has(astro, "site: src/pages/index.astro: 1 `.astro` component to port");
	has(astro, "ssqch: src/content.config.ts: content collections");
	has(astro, "ssqch: package.json: @astrojs/sitemap: `sitemapPlugin()`");
	const hexo = lines(other(site("hexo-list", { "_config.yml": "", "scaffolds/post.md": "", "source/_posts/pine.md": "Hi\n<!-- more -->\n{% asset_img stump.png %}\n", "package.json": "{\"dependencies\":{\"hexo\":\"7\",\"hexo-generator-feed\":\"3\"}}" }), "hexo"));
	has(hexo, "not-yet: source/_posts/pine.md:3: tag plugins");
	has(hexo, "ssqch: scaffolds: scaffolds are ssqch's blueprints");
	// hexo.io's move (2026-11-27): the feed is `feedPlugin()`, as the trailhead says; `hexo-server`
	// is `ssqch serve`; the theme's languages come from its files; a tag in a code block isn't a use.
	has(hexo, "ssqch: package.json: hexo-generator-feed: `feedPlugin()`");
	const io = lines(other(site("hexo-io", {
		"_config.yml": "post_asset_folder: true\n",
		"source/_posts/pine.md": "Hi\n\n```\n{% youtube abc %}\n```\n\nAnd `{% note %}` too.\n",
		"source/_posts/cedar.md": "{% raw %}{{ x }}{% endraw %}\n",
		"themes/navy/layout/layout.njk": "{{ body }}",
		"themes/navy/source/css/style.styl": "a\n  color red\n",
		"themes/navy/languages/en.yml": "home: Home\n",
		"scripts/helpers.js": "hexo.extend.helper.register(\"a\", () => 1);\nhexo.extend.filter.register(\"after_generate\", () => {});\n",
		"package.json": "{\"dependencies\":{\"hexo\":\"8\",\"hexo-server\":\"3\",\"hexo-renderer-stylus\":\"3\"}}",
	}), "hexo"));
	assert.ok(!io.some((line) => line.includes("tag plugins")), io.join("\n"));
	has(io, "the theme's files (1 Nunjucks, 1 Stylus)");
	has(io, "1 theme language files");
	has(io, "`scripts/` (1 file: 1 helper (filters), 1 filter (transforms or hooks))");
	has(io, "post_asset_folder: true");
	has(io, "ssqch: package.json: hexo-server: `ssqch serve`");
	has(io, "site: package.json: hexo-renderer-stylus: Stylus runs as a `beforeBuild` command");
});

test("scout_counts_what_the_sites_config_sets_as_done", async () => {
	const dir = site("mkdocs-done", {
		"mkdocs.yml": "site_name: Trail\nmarkdown_extensions:\n  - admonition\n  - pymdownx.tabbed\n",
		"docs/index.md": "!!! note\n    Pack out what you pack in.\n\n=== \"Cedar\"\n    Shady.\n",
	});
	const before = scoutReport(mkdocs(dir), dir, "mkdocs", "mkdocs.yml", await siteConfig(dir));
	assert.ok(before.todo.some((t) => t.code === "mkdocs-admonitions"));
	assert.equal(before.summary.done, 0);
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), `export default { markdown: { admonitions: "mkdocs", highlight: { classes: "pygments" } } };\n`);
	const after = scoutReport(mkdocs(dir), dir, "mkdocs", "mkdocs.yml", await siteConfig(dir));
	assert.ok(!after.todo.some((t) => t.code === "mkdocs-admonitions"), "the admonitions are done");
	assert.ok(after.todo.some((t) => t.code === "mkdocs-tabs"), "the tabs aren't");
	assert.deepEqual([...new Set(after.done.map((d) => d.option))], ['markdown: { admonitions: "mkdocs" }']);
	assert.equal(after.summary.done, after.done.length);
	assert.match(scoutText(after, { writeDraft: false }), /done already: ssqch\.config\.js has `markdown: \{ admonitions: "mkdocs" \}`/);
	// A config that's a function of the build is read as a production build calls it (the
	// Squatch Snacks rerun: 0.14.2 said its default export wasn't an object).
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), `export default ({ env }) => ({ markdown: { admonitions: env === "production" ? "mkdocs" : false } });\n`);
	const called = await siteConfig(dir);
	assert.equal(called.error, undefined);
	assert.ok(!scoutReport(mkdocs(dir), dir, "mkdocs", "mkdocs.yml", called).todo.some((t) => t.code === "mkdocs-admonitions"));
	// A config that doesn't load counts nothing as done, and says why.
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), "export default {\n");
	const broken = scoutReport(mkdocs(dir), dir, "mkdocs", "mkdocs.yml", await siteConfig(dir));
	assert.equal(broken.done.length, 0);
	assert.ok(broken.configError?.startsWith("ssqch.config.js: "), String(broken.configError));
	// Values only: a plugin call or a list is for a person to check.
	assert.equal(setIn({ markdown: { tabs: "mkdocs" } }, 'markdown: { tabs: "mkdocs" }'), true);
	assert.equal(setIn({ markdown: { tabs: "mkdocs" } }, "markdown: { tabs: true }"), false);
	assert.equal(setIn({ plugins: [] }, "plugins: [sitemapPlugin()]"), false);
});

test("scout_finds_what_mkdocs_writes_on_its_own", () => {
	const dir = site("mkdocs-own", {
		// No `plugins`: MkDocs turns search on. mkautodoc's `:::` and a CNAME.
		"mkdocs.yml": "site_name: Trail\nsite_url: https://example.com/\ntheme:\n  name: material\n  custom_dir: docs/overrides\nmarkdown_extensions:\n  - mkautodoc\n  - codehilite\n",
		"requirements.txt": "mkdocs\nmkautodoc\n",
		"docs/index.md": "# Home\n",
		"docs/api.md": "# API\n\n::: trail.Client\n    :docstring:\n",
		"docs/CNAME": "trail.example.com\n",
		"docs/img/pine.png": "",
		"docs/overrides/partials/nav.html": "<nav></nav>",
	});
	const plan = mkdocs(dir);
	const said = plan.byHand.map(([at, what]) => `${at}: ${what}`);
	const has = (text: string) => assert.ok(said.some((line) => line.includes(text)), `${text}\n${said.join("\n")}`);
	has("mkdocs.yml: plugins: `search`: MkDocs writes `search/search_index.json`");
	has("mkdocs.yml: markdown_extensions: `mkautodoc`: API pages from Python docstrings");
	has("mkdocs.yml: markdown_extensions: `codehilite`: `markdown: { highlight: { classes: \"pygments\" } }` (in the draft) gives tokens Pygments' class names");
	has("docs/api.md:3: API docs (`::: package.name`) (1 use in 1 file");
	has("mkdocs.yml: theme.custom_dir: `docs/overrides` (1 file) overrides the theme's templates");
	has("mkdocs.yml: theme: MkDocs writes `404.html`");
	has("mkdocs.yml: site_url: MkDocs writes `sitemap.xml.gz`");
	assert.ok(!said.some((line) => line.includes("module of its own")));
	const config = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	for (const part of ["includes: \"overrides\"", "containers: false", "{ \"docs/**/*.png\": \".\" }, { \"docs/CNAME\": \"CNAME\" }", "linksPlugin({ fail: false })"]) assert.ok(config.includes(part), `${part}\n${config}`);
	assert.ok(!config.includes("*.html"), "the overrides aren't copied");
	const report = scoutReport(plan, dir, "mkdocs", "mkdocs.yml");
	assert.ok(report.build.needs.some((n) => n.startsWith("Python with MkDocs and the site's packages, in a virtual environment: `pip install -r requirements.txt`")), report.build.needs.join("\n"));
});

test("scout_drafts_codehilites_wrapper_as_a_fence_hook", () => {
	const dir = site("mkdocs-hilite", { "mkdocs.yml": "site_name: Trail\nmarkdown_extensions:\n  - codehilite\n", "docs/index.md": "# Home\n\n```py\nx = 1\n```\n" });
	const hook = mkdocs(dir).newFiles.find(([file]) => file === "_includes/hooks/fence.jinja");
	assert.ok(hook, "a fence hook");
	assert.match(hook![2], /<div class="codehilite"><pre><span><\/span><code>\{% if fence\.highlighted %\}/);
});

// The fresh vuejs.org run: scout listed 7 items, the same before, halfway and done, counted every
// `.md` in the repository (121; VitePress builds 111) and drafted nothing.
test("scout_reads_a_vitepress_site_and_drafts_its_config", async () => {
	const dir = site("vitepress-scout", {
		".vitepress/config.ts": "export default defineConfig({\n  srcDir: 'src',\n  srcExclude: ['tutorial/**/description.md'],\n  sitemap: { hostname: 'https://trail.example' },\n  head: [['meta', { name: 'x' }], ['script', {}, 'y']],\n  markdown: { config(md) { md.use(headerPlugin) } },\n  themeConfig: { nav: [], sidebar: {} },\n})\n",
		".vitepress/theme/index.ts": "import DefaultTheme from 'vitepress/theme'\nimport Badge from './components/Badge.vue'\nexport default { extends: DefaultTheme, enhanceApp({ app }) { app.component('Badge', Badge) } }\n",
		".vitepress/theme/components/Badge.vue": "<template><span><slot /></span></template>\n",
		"README.md": "# Not a page\n",
		"package.json": JSON.stringify({ scripts: { dev: "vitepress", build: "vitepress build" }, packageManager: "pnpm@10.33.0" }),
		"src/index.md": "---\npage: true\nlayout: home\n---\n<script setup>\nimport Counter from './Counter.vue'\n</script>\n\n# Trails <Badge text=\"new\" />\n\n<Counter />\n\n::: tip\n- one\n  :::\n\n{{ count }}\n\n```js\n<Badge /> {{ not.counted }}\n```\n",
		"src/Counter.vue": "<script setup>\nimport { ref } from 'vue'\nconst n = ref(0)\n</script>\n<template><button @click=\"n++\">{{ n }}</button></template>\n",
		"src/api/api.data.ts": "export default { load() { return [] } }\n",
		"src/api/index.md": "# API\n",
		"src/tutorial/step-1/description.md": "# Not a page either\n",
		"src/public/logo.svg": "<svg/>",
	});
	const plan = vitepress(dir);
	assert.equal(plan.pages, 2);
	const said = plan.byHand.map(([at, what, meta]) => `${meta?.code}: ${at}: ${what}`);
	const has = (text: string) => assert.ok(said.some((line) => line.includes(text)), `${text}\n${said.join("\n")}`);
	has("vitepress-script-setup: src/index.md:5:");
	has("vitepress-indented-container: src/index.md:15:");
	has("vitepress-interpolations: src/index.md:17:");
	has("vitepress-component: src/index.md:9: `<Badge>` (.vitepress/theme/components/Badge.vue) (1 use in 1 file; this is the first): `vuePlugin()` from \"ssqch/vue\" renders it with Vue");
	has("vitepress-component: src/index.md:11: `<Counter>` (src/Counter.vue) (1 use in 1 file; this is the first): it has state (it runs in the browser): `vuePlugin()`");
	has("vitepress-page: src/index.md: `page: true`");
	has("vitepress-loaders: src/api/api.data.ts: 1 VitePress data loader (`*.data.ts`), 1 named like a folder's or a page's data");
	has("vitepress-urls: .vitepress/config.ts:");
	has("vitepress-head: .vitepress/config.ts: `head` (2 tags, scripts among them)");
	has("vitepress-markdown-plugin: .vitepress/config.ts: `md.use(headerPlugin)`");
	has("vitepress-theme: .vitepress/theme/index.ts: a theme that extends VitePress's default one");
	has("vitepress-public: src/public:");
	assert.ok(!said.some((line) => line.includes("not.counted")), "fences aren't read");
	const report = scoutReport(plan, dir, "vitepress", ".vitepress", await siteConfig(dir));
	assert.equal(report.build.command, "pnpm run build");
	assert.equal(report.build.output, ".vitepress/dist");
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("dirs: { input: \"src\", output: \"dist\" },") && draft.includes("urls: \"html\",") && draft.includes("ignore: [\"api/api.data.ts\", \"tutorial/**/description.md\", \".vitepress/**\", \"public/**\"],") && draft.includes("passthrough: { \"src/public/**\": \".\" },") && draft.includes("markdown: { highlight: true },") && draft.includes("import { fromVitepress } from \"ssqch/from-vitepress\";") && draft.includes("\t\tfromVitepress(),") && draft.includes("vuePlugin({ components: { Badge: \".vitepress/theme/components/Badge.vue\" }, hydrate: \"visible\" }),") && draft.includes("sitemapPlugin({ url: \"https://trail.example\" }),"), draft);
	// With the draft and a template for `<Badge>`, those are done.
	fs.writeFileSync(path.join(dir, "ssqch.config.js"), draft.replace(/^import .*\n/gm, "").replace(/\tplugins: \[[\s\S]*?\n\t\],\n/, "\tplugins: [{ name: \"ssqch/sitemap\" }, { name: \"fromVitepress\" }],\n"));
	fs.mkdirSync(path.join(dir, "src/_includes/components"), { recursive: true });
	fs.writeFileSync(path.join(dir, "src/_includes/components/Badge.jinja"), "<span>{{ component.content | safe }}</span>");
	// The layout's own work counts too (the vuejs.org rerun: 11 of 17 to-dos were done in files scout didn't read).
	fs.writeFileSync(path.join(dir, "src/_includes/base.njk"), "<html><head><title>{{ title }}</title></head><body class=\"{{ layout }}\">{{ content | safe }}</body></html>");
	const after = scoutReport(vitepress(dir), dir, "vitepress", ".vitepress", await siteConfig(dir));
	const done = after.done.map((d) => d.code);
	for (const code of ["vitepress-script-setup", "vitepress-indented-container", "vitepress-containers", "vitepress-urls", "vitepress-loaders", "vitepress-sitemap", "vitepress-public", "vitepress-component", "vitepress-head", "vitepress-theme", "vitepress-front-matter"]) assert.ok(done.includes(code), `${code} done: ${JSON.stringify(after.done)}`);
	assert.ok(after.todo.some((t) => t.what.startsWith("`<Counter>`")), "Counter has no template yet");
});
