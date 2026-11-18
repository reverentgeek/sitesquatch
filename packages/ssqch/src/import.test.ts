// From crates/ssqch/src/import.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readToml } from "./data.ts";
import { blankComments, draftConfig, eleventy, rewriteData, rewriteScript, rewriteTemplate, rewriteZolaFrontMatter } from "./import.ts";

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
