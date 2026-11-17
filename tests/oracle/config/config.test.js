// From crates/sitesquatch-js/tests/config.rs (and its common/mod.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, project, read, exists, RUST_07 } from "../lib/ssqch.js";

/** Builds `root` the way the Rust tests did: production, quiet. */
function build(root, extra = []) {
	return ssqch(["build", "--root", root, "--quiet", ...extra]);
}

/** The error text of a build that must fail (the binary's `error: ` prefix removed). */
function buildError(root) {
	const r = build(root);
	assert.ok(!r.ok, `expected an error, but the build worked:\n${r.log}`);
	return r.log.replace(/^error: /, "");
}

function buildOk(root, extra) {
	const r = build(root, extra);
	assert.ok(r.ok, r.log);
	return r;
}

const SITE_CONFIG = `
import { defineConfig } from "ssqch";
import { shout } from "./lib/text";
import site from "./lib/site.json";

let calls = 0;

// A plugin is a piece of config, or a function that returns one.
const wave = (emoji) => ({ name: "wave", filters: { wave: (n) => \`\${emoji} \${n}\` } });
// Rust API only: the Rust test registers "test:greeter" from Rust; a plugin with the same filter stands in.
const greeter = (greeting) => ({ name: "greeter", filters: { greet: (n) => \`\${greeting}, \${n}\` } });

export default defineConfig(async ({ env }) => ({
  dirs: { input: "src", output: "public" },
  templateFormats: ["edge"],
  filters: {
    shout,
    count: () => ++calls,
    year: (d) => d.getUTCFullYear(),
    nextDay: (d) => new Date(d.getTime() + 86400000),
    later: async (s) => { await null; return s + " (async)"; },
    applyTwice: (fn, x) => fn(fn(x)),
    envName: () => \`\${env}/\${process.env.SSQCH_ENV}\`,
    hashtags: (list) => list.map((t) => "#" + t).join(" "),
  },
  data: {
    site,
    snacks: async () => [{ name: "Pine Cone Crunch" }, { name: "Bigfoot Brittle" }],
  },
  passthrough: [{ "static/robots.txt": "robots.txt" }, "src/plain.txt"],
  plugins: [wave("o/"), async () => greeter("Howdy"), null, false],
}));
`;

const SITE_PAGE = `---
title: snack report
date: 2026-03-14
tags: [snacks, forest]
---
{{ shout(title) }}|{{ year(page.date) }}|{{ year(nextDay(page.date)) }}|{{ later("crunchy") }}|{{ applyTwice(shout, "hi") }}
{{ hashtags(tags) }}|{{ site.title }}|{{ greet(site.author) }}|{{ wave("bye") }}|{{ count() }}{{ count() }}|{{ envName() }}
@each(snack in snacks)
{{ snack.name }};
@end
`;

test("builds_a_site_configured_in_javascript", () => {
	const root = project({
		"ssqch.config.js": SITE_CONFIG,
		"lib/text.js": "export const shout = (s) => String(s).toUpperCase() + \"!\";\n",
		"lib/site.json": `{ "title": "Squatch Snacks", "author": "Sasquatch" }`,
		"static/robots.txt": "User-agent: *\n",
		"src/plain.txt": "plain\n",
		"src/index.edge": SITE_PAGE,
		"src/skipped.md": "# not a template format here\n",
	});
	buildOk(root);

	const html = read(root, "public/index.html");
	const lines = html.split("\n");
	if (lines.at(-1) === "") lines.pop();
	assert.equal(lines[0], "SNACK REPORT!|2026|2026|crunchy (async)|HI!!");
	assert.equal(lines[1], "#snacks #forest|Squatch Snacks|Howdy, Sasquatch|o/ bye|12|production/production");
	assert.deepEqual(lines.slice(2), ["Pine Cone Crunch;", "Bigfoot Brittle;"]);
	assert.equal(read(root, "public/robots.txt"), "User-agent: *\n");
	assert.equal(read(root, "public/plain.txt"), "plain\n");
	assert.ok(!exists(root, "public/skipped/index.html"), "templateFormats should exclude .md");
});

test("builds_a_site_configured_in_javascript (built-in plugin)", { skip: "needs the Rust API: a BuiltinPlugin registered from Rust ({ builtin: \"test:greeter\", options: { greeting } }); the test above uses a JavaScript plugin with the same filter instead" }, () => {});

test("development_env_is_visible_to_the_config", () => {
	const root = project({
		"ssqch.config.js": "export default ({ env, serving }) => ({ templateFormats: [\"edge\"], data: { mode: { env, serving } } });",
		"index.edge": "{{ mode.env }} {{ mode.serving }} {{ ssqch.env }}",
	});
	buildOk(root, ["--env", "development"]);
	assert.equal(read(root, "_site/index.html"), "development false development");
});

test("javascript_calls_are_serialized_across_parallel_pages", () => {
	const files = { "ssqch.config.js": "let n = 0; export default { templateFormats: [\"edge\"], filters: { tick: () => ++n } };" };
	for (let i = 0; i < 300; i++) files[`p${i}.edge`] = "{{ tick() }}";
	const root = project(files);
	buildOk(root);

	const seen = Array.from({ length: 300 }, (_, i) => Number(read(root, `_site/p${i}/index.html`).trim()));
	seen.sort((a, b) => a - b);
	assert.deepEqual(seen, Array.from({ length: 300 }, (_, i) => i + 1), "every call should see the previous one's update");
});

function loadError(config) {
	const root = project({ "ssqch.config.js": config, "lib/bad.js": "export const bad = () => { throw new RangeError(\"too many pine cones\"); };\n" });
	return buildError(root);
}

test("errors_point_at_the_config_source", () => {
	let e = loadError("export default {\n  filters: { x: () => 1 + },\n};\n");
	assert.ok(e.startsWith("ssqch.config.js: "), e);
	assert.ok(e.includes("at ssqch.config.js:2:"), e);

	e = loadError("import { bad } from \"./lib/bad.js\";\nexport default () => bad();\n");
	assert.ok(e.includes("too many pine cones"), e);
	assert.ok(e.includes("at bad (lib/bad.js:1:"), e);
	assert.ok(!e.includes("<ssqch>"), `internal frames should be hidden: ${e}`);
});

test("mistakes_in_the_config_say_what_to_fix", () => {
	// [config, wanted, skip reason]: a "QuickJS only" case runs only on 0.7; a "needs the Rust API" case is covered by the skipped test below.
	const cases = [
		["import x from \"left-pad\"; export default {};", "package \"left-pad\" isn't installed (no node_modules/left-pad folder here or in a parent folder; run npm install)"],
		["import h from \"node:http\"; h.request(\"http://localhost\"); export default {};", "node:http isn't available in ssqch", "QuickJS only: node:http is a stub that throws"],
		["import s from \"node:sqlite\"; export default {};", "node:sqlite isn't available in ssqch (available: node:fs, ", "QuickJS only: the list of node: modules ssqch shims"],
		["export const config = {};", "needs a default export: export default defineConfig({ ... })"],
		["export default { dirs: { assets: \"_assets\" } };", "dirs.assets isn't supported (use input, output, includes, layouts, data)"],
		["export default { dirz: { input: \"src\" } };", "\"dirz\" isn't a config option (did you mean \"dirs\"?) (options: dirs, templateFormats"],
		// Another generator's word gets ssqch's, from the table, instead of a guess.
		["export default { integrations: [] };", "\"integrations\" isn't a config option. In ssqch it's `plugins`: plugins: [imagePlugin()].\n  More: ssqch docs plugins"],
		// Every unknown option in one run.
		["export default { baseURL: \"/x/\", tittle: \"x\" };", "\"baseURL\" isn't a config option. ssqch's `base` is the path only (base: \"/repo/\"); the site's full URL goes in your data, for sitemapPlugin({ url }).\n  More: ssqch docs base\nssqch.config.js: \"tittle\" isn't a config option (options: dirs,"],
		// An alias (`dir` for `dirs`) works, but not with ssqch's name too.
		["export default { dir: { input: \"src\" }, dirs: { input: \"site\" } };", "dir.input and dirs.input are two names for one option; set one of them"],
		["export default { publishDir: \"a\", outDir: \"b\" };", "outDir and publishDir are two names for one option; set one of them"],
		["export default { plugins: [{ builtin: \"test:gretter\" }] };", "unknown plugin \"test:gretter\" (built-in plugins: test:greeter)", "needs the Rust API: the test:greeter built-in plugin is registered from Rust"],
		["export default async () => { await new Promise(() => {}); };", "never settled"],
		["export default { filters: { x: 1 } };", "filters.x must be a function"],
		["export default { plugins: [{ name: \"snacks\", dirs: { input: \"src\" } }] };", "plugin \"snacks\": \"dirs\" can only be set in the config itself"],
		[
			"export default { filters: { x: () => 1 }, plugins: [{ name: \"snacks\", filters: { x: () => 2 } }] };",
			"plugin \"snacks\": filter \"x\" is already defined by ssqch.config.js",
		],
		["export default { plugins: [() => ({ plugins: [{ beforeBuild: 1 }] })] };", "plugins[0] > plugins[0]: beforeBuild must be a function"],
	];
	for (const [config, want, skip] of cases) {
		if (skip && (skip.startsWith("needs the Rust API") || !RUST_07)) continue;
		const e = loadError(config);
		assert.ok(e.includes(want), `${config}\n  wanted: ${want}\n  got: ${e}`);
		assert.ok(e.startsWith("ssqch.config.js") && !e.includes("ssqch.config.js: ssqch.config.js"), `name the file once: ${e}`);
	}
});

test("mistakes_in_the_config_say_what_to_fix (unknown built-in plugin)", { skip: "needs the Rust API: the test:greeter built-in plugin is registered from Rust" }, () => {});

test("filter_errors_carry_the_javascript_stack", () => {
	const root = project({
		"ssqch.config.js": "export default {\n  templateFormats: [\"edge\"], filters: { boom: () => { throw new Error(\"the snack drawer is empty\"); } },\n};\n",
		"index.edge": "{{ boom() }}",
	});
	const e = buildError(root);
	assert.ok(e.includes("boom(): the snack drawer is empty"), e);
	assert.ok(e.includes("(ssqch.config.js:2:"), e);
});

test("circular_data_is_an_error_not_a_hang", () => {
	const root = project({
		"ssqch.config.js": "const a = {}; a.self = a; export default { templateFormats: [\"edge\"], data: { loop: () => a } };",
		"index.edge": "{{ loop }}",
	});
	const e = buildError(root);
	assert.ok(e.includes("nested too deeply"), e);
});
