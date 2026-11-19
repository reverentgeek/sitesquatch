// From crates/ssqch/src/import.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readToml } from "./data.ts";
import { blankComments, draftConfig, eleventy, rewriteData, rewriteScript, rewriteTemplate, rewriteZolaFrontMatter, tomlError, zola } from "./import.ts";
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
	assert.equal(text, "---\ntitle: Pine\nexcludeFromCollections: true\ncomputed:\n  slug: \"{{ title | slugify }}\"\nrender: njk,md\nnav:\n  key: Pine\n---\nUse eleventyComputed in prose. <img src=\"a.png\" ssqch:widths=\"300\" ssqch:ignore> {{ ssqch.generator }}\n");
	assert.equal(changes.length, 6);
	const [same, none] = rewriteTemplate("No front matter, and eleventyComputed is only a word here.\n", true);
	assert.deepEqual([same, none.length], ["No front matter, and eleventyComputed is only a word here.\n", 0]);
	let data: string;
	[data, changes] = rewriteData("{ \"layout\": \"post\", \"eleventyComputed\": { \"permalink\": \"/x/\" }, \"note\": \"about eleventyComputed: a key\" }");
	assert.equal(data, "{ \"layout\": \"post\", \"computed\": { \"permalink\": \"/x/\" }, \"note\": \"about eleventyComputed: a key\" }");
	assert.deepEqual(changes, ["eleventyComputed -> computed"]);
	assert.equal(rewriteData("module.exports = {\n  eleventyComputed: { a: 1 },\n  note: \"eleventyNavigation\",\n};\n")[0], "module.exports = {\n  computed: { a: 1 },\n  note: \"eleventyNavigation\",\n};\n");

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
		const page = plan.edits.find(([p]) => p === "site/a.md")!;
		assert.ok(page[2].includes("eleventyNavigation:") && page[2].includes("computed:"), page[2]);
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
	assert.ok(three.includes("    // Eleventy 3 turns off markdown-it's indented code blocks (`md.disable(\"code\")`).\n    indentedCode: false,\n") && !three.includes("headingIds"), three);
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
	w("_includes/post.njk", "{{ title | upper | slug }} {{ date | readable }}\n{% set prev = collections.posts | getPreviousCollectionItem(page) %}\n{% callout %}x{% endcallout %}\n{{ \"a | b\" }} {{ x | mystery | safe }}{% youtube \"id\" %}\n");
	w("feed.liquid", "{{ collections.posts | rssLastUpdatedDate }} {{ \"x\" | upcase | slug }}");
	const plan = eleventy(dir);
	const said = Object.fromEntries(plan.byHand.filter(([, what]) => what.startsWith("`")).map(([at, what]) => [what.slice(1, what.indexOf("`", 1)), [at, what]]));
	assert.deepEqual(Object.keys(said).sort(), ["getPreviousCollectionItem", "mystery", "rssLastUpdatedDate", "slug", "youtube"]);
	assert.equal(said.slug[0], "_includes/post.njk:1");
	assert.ok(said.slug[1].startsWith("`slug` (in 2 templates; this is the first): Eleventy's built-in `slug`"), said.slug[1]);
	assert.equal(said.youtube[0], "_includes/post.njk:4");
	assert.ok(said.mystery[1].includes("is a filter or shortcode nothing defines"), said.mystery[1]);
	const draft = plan.newFiles.find(([file]) => file === "ssqch.config.js")![2];
	assert.ok(draft.includes("    // Eleventy's own filters the templates use, ported.\n    getPreviousCollectionItem: (collection, page) => {\n      const i = collection.findIndex((item) => item.url === page.url);\n"), draft);
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
