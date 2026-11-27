// From crates/sitesquatch-js/tests/config.rs (and its common/mod.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ssqch, project, read, exists, tempDir, REPO } from "../lib/ssqch.js";

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

// The Rust test registered "test:greeter" from Rust: a plugin that isn't JavaScript, made from its
// options, whose filter reads them. In 0.8 that's a plugin written in Rust, a .wasm file (the
// example in examples/rust-plugin, whose `greet` filter says its `greeting` option).
const TRAIL_GUIDE = JSON.stringify(pathToFileURL(path.join(REPO, "examples/rust-plugin/index.js")).href);

test("builds_a_site_configured_in_javascript (built-in plugin)", () => {
	const config = SITE_CONFIG
		.replace("import { shout } from \"./lib/text\";", `import { shout } from "./lib/text";\nimport trailGuide from ${TRAIL_GUIDE};`)
		.replace(/^const greeter = .*$/m, "const greeter = (greeting) => trailGuide({ greeting });");
	assert.ok(config.includes("trailGuide({ greeting })"));
	const root = project({
		"ssqch.config.js": config,
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
	// [config, wanted]. The Rust test's cases for 0.7's stand-ins for node:http and node:sqlite are
	// gone with QuickJS: on Node, every node: module is Node's own.
	const cases = [
		["import x from \"left-pad\"; export default {};", "package \"left-pad\" isn't installed (no node_modules/left-pad folder here or in a parent folder; run npm install)"],
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
		// The Rust test's "test:gretter" was one letter from a plugin registered from Rust; ssqch's own are listed.
		// DELIBERATE (0.12): `ssqch/llms` and `ssqch/vue` are built-in plugins too (from the fresh vuejs.org run).
		// DELIBERATE (0.13): and `ssqch/robots` (the audit's plan, step 3), `ssqch/from-mkdocs`, `ssqch/from-jekyll`, `ssqch/from-hugo` and `ssqch/from-vitepress` (steps 6 and 7).
		// DELIBERATE (0.16.2): and `ssqch/react` (reactPlugin(), from the Docusaurus and Gatsby moves).
		["export default { plugins: [{ builtin: \"ssqch/sas\" }] };", "unknown plugin \"ssqch/sas\" (built-in plugins: ssqch/rss, ssqch/image, ssqch/minify, ssqch/assets, ssqch/links, ssqch/sitemap, ssqch/redirects, ssqch/sass, ssqch/elements, ssqch/llms, ssqch/vue, ssqch/react, ssqch/robots, ssqch/from-mkdocs, ssqch/from-jekyll, ssqch/from-hugo, ssqch/from-vitepress)"],
		["export default async () => { await new Promise(() => {}); };", "never settled"],
		["export default { filters: { x: 1 } };", "filters.x must be a function"],
		["export default { plugins: [{ name: \"snacks\", dirs: { input: \"src\" } }] };", "plugin \"snacks\": \"dirs\" can only be set in the config itself"],
		[
			"export default { filters: { x: () => 1 }, plugins: [{ name: \"snacks\", filters: { x: () => 2 } }] };",
			"plugin \"snacks\": filter \"x\" is already defined by ssqch.config.js",
		],
		["export default { plugins: [() => ({ plugins: [{ beforeBuild: 1 }] })] };", "plugins[0] > plugins[0]: beforeBuild must be a function"],
	];
	for (const [config, want] of cases) {
		const e = loadError(config);
		assert.ok(e.includes(want), `${config}\n  wanted: ${want}\n  got: ${e}`);
		assert.ok(e.startsWith("ssqch.config.js") && !e.includes("ssqch.config.js: ssqch.config.js"), `name the file once: ${e}`);
	}
});

// The Rust test's mistake was a plugin that isn't there. In 0.8 the plugins that aren't
// JavaScript are .wasm files: one that isn't there, isn't a plugin, or was built for another
// plugin ABI is refused, and so are options it doesn't take.
test("mistakes_in_the_config_say_what_to_fix (unknown built-in plugin)", () => {
	const wasm = path.join(REPO, "examples/rust-plugin/trail_guide.wasm");
	const dir = tempDir("wasm");
	const bytes = fs.readFileSync(wasm);
	const marker = Buffer.from("ssqch_plugin{\"abi\":1,");
	bytes[bytes.indexOf(marker) + marker.length - 2] = "2".charCodeAt(0);
	fs.writeFileSync(path.join(dir, "future.wasm"), bytes);
	fs.writeFileSync(path.join(dir, "empty.wasm"), Buffer.from("0061736d01000000", "hex"));
	fs.writeFileSync(path.join(dir, "pine-cones.wasm"), "pine cones");
	const plugin = (rust) => `export default { plugins: [{ name: "trail-guide", rust: ${JSON.stringify(rust)} }] };`;
	const cases = [
		[plugin({ wasm: "plugins/trail.wasm" }), "plugin \"trail-guide\": ./plugins/trail.wasm doesn't exist"],
		[plugin({ wasm: path.join(dir, "empty.wasm") }), "empty.wasm: not an ssqch plugin (it has no ssqch_plugin section; was it built with ssqch_plugin::export!?)"],
		[plugin({ wasm: path.join(dir, "pine-cones.wasm") }), "pine-cones.wasm: not an ssqch plugin (it isn't WebAssembly: "],
		[plugin({ wasm: path.join(dir, "future.wasm") }), "future.wasm: built for plugin ABI 2, and this ssqch loads ABI 1: update ssqch, or use a version of the plugin built for ABI 1"],
		[plugin({ wasm, options: { greting: "Howdy" } }), "plugin \"trail-guide\": options: unknown field `greting`, expected one of `greeting`, `wordsPerMinute`, `externalRel`"],
		[plugin({ wasm, options: { wordsPerMinute: 0 } }), "plugin \"trail-guide\": wordsPerMinute must be at least 1"],
		[plugin({ wasm, opts: {} }), "plugin \"trail-guide\": rust.opts isn't an option (options: wasm, options)"],
		[plugin("trail.wasm"), "plugin \"trail-guide\": rust must be an object, like { wasm: \"/path/to/plugin.wasm\", options: {} }"],
		[`export default { filters: { greet: () => "hi" }, plugins: [{ name: "trail-guide", rust: ${JSON.stringify({ wasm })} }] };`, "plugin \"trail-guide\": filter \"greet\" is already defined by ssqch.config.js"],
	];
	for (const [config, want] of cases) {
		const e = loadError(config);
		assert.ok(e.includes(want), `${config}\n  wanted: ${want}\n  got: ${e}`);
		assert.ok(e.startsWith("ssqch.config.js") && !e.includes("ssqch.config.js: ssqch.config.js"), `name the file once: ${e}`);
	}
});

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
		"index.edge": "{{ loop.self === loop }}",
	});
	// DELIBERATE (0.8): 0.7 copied a config's values out of QuickJS, and refused one that referred
	// to itself ("nested too deeply"). On Node, templates get the config's own objects, so
	// circular data is only data.
	buildOk(root);
	assert.equal(read(root, "_site/index.html"), "true");
});

// v8.dev (v8 C11): its dates came from the site's own JavaScript in the machine's zone, so 137
// pages differed between a laptop in EST and CI in UTC. `timeZone` runs that code in one zone.
test("time_zone_sets_the_zone_the_sites_javascript_runs_in", () => {
	const files = (config) => ({
		"ssqch.config.js": `export default { ${config}templateFormats: ["njk"], filters: { hour: (s) => new Date(s).getHours() } };\n`,
		"_data/camp.js": "export default () => ({ opens: new Date(\"2026-01-01T03:00:00Z\").getDate() });\n",
		"index.njk": "{{ hour(\"2026-01-01T03:00:00Z\") }} {{ camp.opens }}\n",
	});
	const east = { env: { TZ: "America/New_York" } };
	const pinned = project(files("timeZone: \"UTC\", "));
	assert.ok(ssqch(["build", "--root", pinned, "--quiet"], east).ok);
	assert.equal(read(pinned, "_site/index.html"), "3 1\n");
	const machine = project(files(""));
	assert.ok(ssqch(["build", "--root", machine, "--quiet"], east).ok);
	assert.equal(read(machine, "_site/index.html"), "22 31\n");
	const wrong = ssqch(["build", "--root", project(files("timeZone: \"Mars/Olympus\", "))]);
	assert.ok(!wrong.ok && wrong.log.includes("ssqch.config.js: timeZone: \"Mars/Olympus\" isn't a time zone ssqch knows"), wrong.log);
});
