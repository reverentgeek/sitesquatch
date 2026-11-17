// The diagnostic codes in `--format json` reports (README, "The codes"): each provoked by a small
// site, with where it lands (warnings or errors), whether the build still succeeds, and the
// file, line, field and url it carries. Messages are checked by the behavior tests in cli/.
//
// Not here: `fetch` (a failed fetch with a saved copy, which needs a server) and `missing-asset`
// (`ssqch serve` only; cli/serve.test.js covers it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, ssqch } from "../lib/ssqch.js";

const base = (more = "") => `export default { dirs: { input: "src", output: "dist" }, templateFormats: ["md", "njk"]${more} };\n`;
const plugin = (mod, fn, opts = "") => `import { ${fn} } from "ssqch/${mod}";\nexport default { dirs: { input: "src", output: "dist" }, plugins: [${fn}(${opts})] };\n`;

// [code, files, expected: { ok, in: "warnings" | "errors", file?, line?, field?, url? }, extra args]
const CASES = [
	["config", { "ssqch.config.js": base(", pineCones: 3") }, { ok: false, in: "errors", file: "ssqch.config.js" }],
	["data", { "ssqch.config.js": base(), "src/_data/site.json": "{ nope", "src/index.md": "hi" }, { ok: false, in: "errors", file: "src/_data/site.json", line: 1 }],
	["front-matter", { "ssqch.config.js": base(), "src/index.md": "---\ntitle: [unclosed\n---\nhi" }, { ok: false, in: "errors", file: "src/index.md", line: 3 }],
	["template", { "ssqch.config.js": base(), "src/index.njk": "line one\n{{ nope | nofilter }}\n" }, { ok: false, in: "errors", file: "src/index.njk", line: 2 }],
	["schema", { "ssqch.config.js": base(", schemas: { posts: { fields: { title: \"string\" } } }"), "src/posts/a.md": "---\ntags: posts\n---\nhi" }, { ok: false, in: "errors", file: "src/posts/a.md", field: "title" }],
	["conflict", { "ssqch.config.js": base(), "src/a.md": "---\npermalink: /x/\n---\na", "src/b.md": "---\npermalink: /x/\n---\nb" }, { ok: false, in: "errors", file: "src/b.md" }],
	["links", { "ssqch.config.js": plugin("links", "linksPlugin"), "src/index.md": "[gone](/nowhere/)" }, { ok: false, in: "errors", url: "/" }],
	["images", { "ssqch.config.js": plugin("image", "imagePlugin"), "src/index.md": "![x](/img/missing.png)" }, { ok: true, in: "warnings" }],
	["assets", { "ssqch.config.js": plugin("assets", "assetsPlugin", "{ files: [\"/app.css\"] }"), "src/index.md": "hi" }, { ok: true, in: "warnings" }, ["--env", "development"]],
	["passthrough", { "ssqch.config.js": base(", passthrough: [\"./src/**/*.nope\"]"), "src/index.md": "hi" }, { ok: true, in: "warnings" }],
	["last-modified", { "ssqch.config.js": base(", lastModified: \"git\""), "src/index.md": "hi" }, { ok: true, in: "warnings" }],
	["hook", { "ssqch.config.js": base(", afterBuild: [{ run: \"exit 3\" }]"), "src/index.md": "hi" }, { ok: false, in: "errors" }],
	["console", { "ssqch.config.js": `console.warn("careful");\n${base()}`, "src/index.md": "hi" }, { ok: true, in: "warnings" }],
	["template-formats", { "ssqch.config.js": `export default { dirs: { input: "src", output: "dist" }, templateFormats: ["md"] };\n`, "src/index.md": "hi", "src/other.liquid": "x" }, { ok: true, in: "warnings", file: "src/other.liquid" }],
	["other-generator", { ".eleventy.js": "module.exports = () => ({});\n", "index.md": "hi" }, { ok: true, in: "warnings" }],
	["foreign-key", { "ssqch.config.js": base(), "src/index.md": "---\npublished: false\n---\nhi" }, { ok: true, in: "warnings", file: "src/index.md", field: "published" }],
	["foreign-global", { "ssqch.config.js": base(), "src/index.njk": "{{ eleventy.generator }}" }, { ok: true, in: "warnings", file: "src/index.njk" }],
	["over-budget", { "ssqch.config.js": base(", budgets: { pages: \"10 B\" }"), "src/index.md": "a page longer than ten bytes" }, { ok: true, in: "warnings" }],
	["build", { "ssqch.config.js": base(", passthrough: [\"./nothing-here\"]"), "src/index.md": "hi" }, { ok: false, in: "errors" }],
];

for (const [code, files, want, args = []] of CASES) {
	test(`the ${code} code`, () => {
		const dir = project(files, code);
		const r = ssqch(["build", "--root", dir, "--format", "json", ...args]);
		const report = JSON.parse(r.stdout);
		assert.equal(report.ok, want.ok, r.log);
		assert.equal(r.ok, want.ok, `the exit code should match "ok": ${r.log}`);
		const found = report[want.in].filter((d) => d.code === code);
		assert.equal(found.length, 1, `one ${code} in ${want.in}: ${JSON.stringify(report[want.in])}`);
		const other = want.in === "errors" ? "warnings" : "errors";
		assert.deepEqual(report[other].filter((d) => d.code === code), [], `no ${code} in ${other}`);
		const d = found[0];
		assert.equal(typeof d.message, "string");
		assert.ok(d.message.length > 0);
		for (const key of ["file", "line", "field", "url"]) assert.equal(d[key], want[key], `${code}.${key}: ${JSON.stringify(d)}`);
	});
}
