// `markdown.math`: the option, the markup ssqch's Markdown writes (its rules are tested in
// crates/ssqch-markdown, `cargo test -p ssqch-markdown math`), and KaTeX at build time, with a
// stand-in for the site's `katex` package.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { headings } from "../content.ts";
import { htmlToMarkdown } from "../html-markdown.ts";
import { applyMarkdownOptions, defaultMarkdownOptions } from "../markdown-options.ts";
import { markdownEngine } from "./markdown.ts";
import { lineOf, mathmlOnly, renderMath, siteKatex } from "./math.ts";

const ctx = { name: "page.md", inputPath: "/site/page.md" };

/** A site folder with a stand-in `katex` that writes `<k d|i>tex</k>` and refuses `\fraq`, as KaTeX's ParseError does. */
function siteWithKatex(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-math-"));
	const pkg = path.join(root, "node_modules", "katex");
	fs.mkdirSync(path.join(pkg, "dist"), { recursive: true });
	fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "katex", main: "dist/katex.js" }));
	fs.writeFileSync(path.join(pkg, "dist", "katex.js"), [
		"class ParseError extends Error { constructor(raw, position) { super(`KaTeX parse error: ${raw} at position ${position + 1}: ...`); this.rawMessage = raw; this.position = position; } }",
		"exports.renderToString = (tex, o) => {",
		"  const at = tex.indexOf(\"\\\\fraq\");",
		"  if (at !== -1) throw new ParseError(\"Undefined control sequence: \\\\fraq\", at);",
		"  for (const [name, value] of Object.entries(o.macros ?? {})) tex = tex.split(name).join(value);",
		"  return `<k ${o.displayMode ? \"d\" : \"i\"}>${tex.replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\")}</k>`;",
		"};",
	].join("\n"));
	return root;
}

function mathOption(value: unknown) {
	const o = defaultMarkdownOptions();
	applyMarkdownOptions(o, { math: value });
	return o;
}

test("markdown.math is true, false or { render, katex }", () => {
	assert.equal(defaultMarkdownOptions().math, null);
	assert.deepEqual(mathOption(true).math, { render: null, katex: {} });
	assert.equal(mathOption(false).math, null);
	assert.deepEqual(mathOption({ render: "katex", katex: { strict: false } }).math, { render: "katex", katex: { strict: false } });
	assert.throws(() => mathOption("katex"), /markdown\.math must be true, false or \{ render: "katex", katex \}, not "katex"/);
	assert.throws(() => mathOption({ render: "mathjax" }), /markdown\.math\.render must be "katex" \(KaTeX renders each formula while the site builds\) or false \(a script in the page renders them\), not "mathjax"/);
	assert.throws(() => mathOption({ rendr: "katex" }), /markdown\.math\.rendr isn't an option \(did you mean `render`\?\) \(options: render, katex\)/);
	assert.throws(() => mathOption({ katex: { macros: {} } }), /markdown\.math\.katex is KaTeX's options for rendering at build time: add render: "katex"/);
	assert.throws(() => mathOption({ render: "katex", katex: "fast" }), /markdown\.math\.katex must be an object of KaTeX's options/);
	const near = defaultMarkdownOptions();
	assert.throws(() => applyMarkdownOptions(near, { maths: true }), /markdown\.maths isn't an option \(did you mean `math`\?\)/);
});

test("with math on, a page's TeX comes out as written, for a script in the page", () => {
	const md = markdownEngine(mathOption(true));
	assert.equal(md.render("Pine cones: $n_{cone} = 2^k$ and $a<b$.\n\n$$\n\\begin{cases} a \\\\ b \\end{cases}\n$$\n", {}, ctx), "<p>Pine cones: <span class=\"math math-inline\">\\(n_{cone} = 2^k\\)</span> and <span class=\"math math-inline\">\\(a&lt;b\\)</span>.</p>\n<div class=\"math math-display\">\\[\n\\begin{cases} a \\\\ b \\end{cases}\n\\]</div>\n");
	// The filter and `markdown()` from "ssqch" read it the same way.
	assert.equal(md.html("$x^2$", true), "<span class=\"math math-inline\">\\(x^2\\)</span>");
	assert.equal(md.plain("$x^2$", false), "<p><span class=\"math math-inline\">\\(x^2\\)</span></p>\n");
	// Off, it's CommonMark, as it was.
	assert.equal(markdownEngine(defaultMarkdownOptions()).render("$a*b*c$\n", {}, ctx), "<p>$a<em>b</em>c$</p>\n");
});

test("render: \"katex\" renders each formula with the site's katex", () => {
	const root = siteWithKatex();
	const md = markdownEngine(mathOption({ render: "katex", katex: { macros: { "\\RR": "\\mathbb{R}" } } }), root);
	assert.equal(md.render("In $\\RR$, $a<b$:\n\n$$\na &= b\n$$\n\nSo $$x$$ too.\n", {}, ctx), "<p>In <span class=\"math math-inline\"><k i>\\mathbb{R}</k></span>, <span class=\"math math-inline\"><k i>a&lt;b</k></span>:</p>\n<div class=\"math math-display\"><k d>\na &amp;= b\n</k></div>\n<p>So <span class=\"math math-display\"><k d>x</k></span> too.</p>\n");
	assert.equal(md.html("$x$", true), "<span class=\"math math-inline\"><k i>x</k></span>");
	fs.rmSync(root, { recursive: true, force: true });
});

test("a formula KaTeX refuses is an error at its line", () => {
	const root = siteWithKatex();
	const md = markdownEngine(mathOption({ render: "katex" }), root);
	assert.throws(() => md.render("# Trail math\n\nFine $x$.\n\nBroken $\\fraq{a}{b}$ here.\n", { page: { inputPath: "./src/trail.md" } }, ctx), (e: Error) => {
		assert.equal(e.message, "src/trail.md:5: KaTeX can't render $\\fraq{a}{b}$: Undefined control sequence: \\fraq (at character 1)");
		return true;
	});
	// From a filter, it's the page's, without a line.
	assert.throws(() => md.html("$\\fraq$", true), { message: /^KaTeX can't render \$\\fraq\$/ });
	fs.rmSync(root, { recursive: true, force: true });
});

test("render: \"katex\" without katex installed says how to install it", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-math-"));
	fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
	const md = markdownEngine(mathOption({ render: "katex" }), root);
	// A page without math doesn't need it.
	assert.equal(md.render("No math, $5 and $10.\n", {}, ctx), "<p>No math, $5 and $10.</p>\n");
	assert.throws(() => md.render("$x$\n", {}, ctx), /markdown\.math: render: "katex" needs the katex package in the site's packages: `pnpm add -D katex` \(and link its stylesheet, katex\/dist\/katex\.min\.css, from your layout\)/);
	fs.rmSync(root, { recursive: true, force: true });
	assert.throws(() => siteKatex(root), /needs the katex package/);
});

test("renderMath leaves HTML without formulas as it is", () => {
	const html = "<p>$5 and <span class=\"mathy\">\\(x\\)</span></p>";
	assert.equal(renderMath(html, { render: "katex", katex: {} }, () => { throw new Error("not called"); }, () => ""), html);
});

test("a formula's line is its first line's in the page", () => {
	assert.equal(lineOf("a\n\n$$\n\\frac{a}{b}\n$$\n", "\n\\frac{a}{b}\n"), 4);
	assert.equal(lineOf("one $x$\n", "x"), 1);
	assert.equal(lineOf("one\n", "y"), undefined);
	// The formula, not the same text earlier in the page.
	assert.equal(lineOf("Snacks & more, `x_1`.\n\nThen $&$ and $x_1$.\n", "&"), 3);
	assert.equal(lineOf("x_1 is it.\n\nThen $x_1$.\n", "x_1"), 3);
	assert.equal(lineOf("> quote\n> $$\n> \\fraq\n> $$\n", "\n\\fraq\n"), 3);
});

test("a feed gets KaTeX's MathML alone", () => {
	const katex = "<span class=\"katex\"><span class=\"katex-mathml\"><math><mi>α</mi></math></span><span class=\"katex-html\" aria-hidden=\"true\"><span class=\"base\"><span class=\"mord\">α</span></span></span></span>";
	assert.equal(mathmlOnly(`<p>The ${katex} case, and ${katex}.</p>`), "<p>The <span class=\"katex\"><span class=\"katex-mathml\"><math><mi>α</mi></math></span></span> case, and <span class=\"katex\"><span class=\"katex-mathml\"><math><mi>α</mi></math></span></span>.</p>");
	assert.equal(mathmlOnly("<p>No math</p>"), "<p>No math</p>");
});

test("a formula in a heading or a Markdown copy is its text", () => {
	const rendered = "<span class=\"math math-inline\"><span class=\"katex\"><span class=\"katex-mathml\"><math><semantics><mrow><mi>α</mi></mrow><annotation encoding=\"application/x-tex\">\\alpha</annotation></semantics></math></span><span class=\"katex-html\" aria-hidden=\"true\"><span class=\"mord\">α</span></span></span></span>";
	assert.deepEqual(headings(`<h2 id="the-alpha-case">The ${rendered} case</h2>`), [{ level: 2, id: "the-alpha-case", text: "The α case" }]);
	assert.deepEqual(headings("<h2 id=\"a\">The <span class=\"math math-inline\">\\(\\alpha\\)</span> case</h2>"), [{ level: 2, id: "a", text: "The \\(\\alpha\\) case" }]);
	assert.equal(htmlToMarkdown(`<main><h2>The ${rendered} case</h2><p>So <span class="math math-inline">\\(a_1 * b\\)</span>.</p><div class="math math-display">\\[\nx^2\n\\]</div></main>`), "## The $\\alpha$ case\n\nSo $a_1 * b$.\n\n$$\nx^2\n$$\n");
});
