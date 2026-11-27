// `markdown.math` (0.17): TeX kept as written for a script in the page, or rendered with the
// site's own KaTeX at build time. Not in 0.7, so these are 0.8's; the frozen sites (math off)
// prove that a site without it is byte for byte as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, tempDir, write, read } from "../lib/ssqch.js";

const PAGE = [
	"---",
	"title: Trail math",
	"layout: base.jinja",
	"---",
	"Pine cones: $a*b*c$, $\\{x\\}$ and $n_{cone} < 2^k$.",
	"",
	"$$",
	"\\begin{cases} a \\\\ b \\end{cases}",
	"$$",
	"",
	"Snacks cost $5 and $10, or $20-$30. A \\$2 refund. `$code$` stays.",
	"",
].join("\n");

/** A stand-in for the site's `katex` package: `<k d|i>tex</k>`, and a ParseError for `\fraq`, as KaTeX throws it. */
const KATEX = [
	"class ParseError extends Error { constructor(raw, position) { super(`KaTeX parse error: ${raw} at position ${position + 1}`); this.rawMessage = raw; this.position = position; } }",
	"exports.renderToString = (tex, o) => {",
	"  const at = tex.indexOf(\"\\\\fraq\");",
	"  if (at !== -1) throw new ParseError(\"Undefined control sequence: \\\\fraq\", at);",
	"  return `<k ${o.displayMode ? \"d\" : \"i\"}>${tex.replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\")}</k>`;",
	"};",
].join("\n");

function site(config) {
	const dir = tempDir("math");
	write(dir, {
		"ssqch.config.js": `import { llmsPlugin } from "ssqch/llms";\nexport default { dirs: { input: "src", output: "dist" }, plugins: [llmsPlugin()], markdown: ${config} };\n`,
		"src/_includes/base.jinja": "<main>{{ content }}</main><aside>{{ \"$x^2$\" | markdown(\"inline\") | safe }}</aside>\n",
		"src/index.md": PAGE,
	});
	return dir;
}

test("markdown_math_keeps_tex_for_a_script_in_the_page", () => {
	const dir = site("{ math: true }");
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "dist/index.html"),
		"<main><p>Pine cones: <span class=\"math math-inline\">\\(a*b*c\\)</span>, <span class=\"math math-inline\">\\(\\{x\\}\\)</span> and <span class=\"math math-inline\">\\(n_{cone} &lt; 2^k\\)</span>.</p>\n" +
		"<div class=\"math math-display\">\\[\n\\begin{cases} a \\\\ b \\end{cases}\n\\]</div>\n" +
		"<p>Snacks cost $5 and $10, or $20-$30. A $2 refund. <code>$code$</code> stays.</p>\n" +
		"</main><aside><span class=\"math math-inline\">\\(x^2\\)</span></aside>");
	// The Markdown copy is the page's Markdown, TeX and all.
	assert.ok(read(dir, "dist/index.md").includes("$$\n\\begin{cases} a \\\\ b \\end{cases}\n$$"), read(dir, "dist/index.md"));
});

test("markdown_math_is_off_by_default", () => {
	const dir = site("{}");
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	// CommonMark's reading of it, as every site had before.
	assert.ok(read(dir, "dist/index.html").startsWith("<main><p>Pine cones: $a<em>b</em>c$, ${x}$ and $n_{cone} &lt; 2^k$.</p>\n<p>$$\n\\begin{cases} a \\ b \\end{cases}\n$$</p>\n"), read(dir, "dist/index.html"));
});

test("markdown_math_renders_with_the_sites_katex", () => {
	const dir = site("{ math: { render: \"katex\" } }");
	write(dir, { "node_modules/katex/package.json": "{ \"name\": \"katex\", \"main\": \"dist/katex.js\" }\n", "node_modules/katex/dist/katex.js": KATEX });
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	const page = read(dir, "dist/index.html");
	assert.ok(page.startsWith("<main><p>Pine cones: <span class=\"math math-inline\"><k i>a*b*c</k></span>, <span class=\"math math-inline\"><k i>\\{x\\}</k></span> and <span class=\"math math-inline\"><k i>n_{cone} &lt; 2^k</k></span>.</p>\n<div class=\"math math-display\"><k d>\n\\begin{cases} a \\\\ b \\end{cases}\n</k></div>\n"), page);
	assert.ok(page.endsWith("<aside><span class=\"math math-inline\"><k i>x^2</k></span></aside>"), page);

	// A formula KaTeX refuses names the page and its line (the front matter's lines counted).
	write(dir, { "src/index.md": `${PAGE}\nAnd $\\fraq{a}{b}$.\n` });
	r = ssqch(["build", "--root", dir, "--format", "json"]);
	assert.ok(!r.ok);
	const [error] = JSON.parse(r.stdout).errors;
	assert.equal(error.file, "src/index.md");
	assert.equal(error.line, 13);
	assert.ok(error.message.includes("src/index.md:13: KaTeX can't render $\\fraq{a}{b}$: Undefined control sequence: \\fraq (at character 1)"), error.message);
});

test("markdown_math_render_without_katex_says_what_to_install", () => {
	const dir = site("{ math: { render: \"katex\" } }");
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok);
	assert.ok(r.log.includes("markdown.math: render: \"katex\" needs the katex package in the site's packages: `npm install -D katex` (and link its stylesheet, katex/dist/katex.min.css, from your layout)"), r.log);
	write(dir, { "ssqch.config.js": "export default { markdown: { math: { render: \"mathjax\" } } };\n" });
	const bad = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!bad.ok && bad.log.includes("markdown.math.render must be \"katex\""), bad.log);
});
