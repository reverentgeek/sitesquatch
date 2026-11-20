import { test } from "node:test";
import assert from "node:assert/strict";
import { kramdownHtml, kramdownId, withKramdownIds } from "./kramdown-html.ts";

// A stand-in for the site's Markdown: says what it was given, and how.
const render = { block: (text: string) => `[block ${text}]`, span: (text: string) => `[span ${text}]` };

test("markdown_1_renders_an_elements_content", () => {
	// Block-level for a block element, span-level for `p`, headings and inline elements; the attribute goes.
	assert.equal(kramdownHtml("<aside markdown=\"1\" class=\"note\">\n- a\n</aside>\n", render), "<aside class=\"note\">\n[block - a]\n</aside>\n");
	assert.equal(kramdownHtml("<p markdown=\"1\">*a*</p>", render), "<p>[span *a*]</p>");
	assert.equal(kramdownHtml("x <span markdown='1'>*a*</span>", render), "x <span>[span *a*]</span>");
	// `"block"` and `"span"` choose.
	assert.equal(kramdownHtml("<p markdown=\"block\">*a*</p>", render), "<p>\n[block *a*]\n</p>");
	assert.equal(kramdownHtml("<div markdown=\"span\">*a*</div>", render), "<div>[span *a*]</div>");
	// Innermost first.
	assert.equal(kramdownHtml("<div markdown=\"1\">\n<p markdown=\"1\">*a*</p>\n</div>", render), "<div>\n[block <p>[span *a*]</p>]\n</div>");
	// Span-level lines can't become lists: the mark in front comes out again.
	assert.equal(kramdownHtml("<p markdown=\"1\">- @name</p>", { ...render, span: (t: string) => (t.startsWith("- ") ? "<ul>" : t) }), "<p>- @name</p>");
});

test("kramdowns_html_rules_hold_around_it", () => {
	// A block element without the attribute is raw to its end tag: its blank lines go, so CommonMark keeps it one block.
	assert.equal(kramdownHtml("<div>\na\n\n    b\n</div>\n", render), "<div>\na\n    b\n</div>\n");
	// A block tag that doesn't start a line, or is indented four spaces, is left as it is.
	assert.equal(kramdownHtml("x <div markdown=\"1\">*a*</div>", render), "x <div markdown=\"1\">*a*</div>");
	assert.equal(kramdownHtml("    <div markdown=\"1\">*a*</div>", render), "    <div markdown=\"1\">*a*</div>");
	// No end tag: it closes at the end of what holds it.
	assert.equal(kramdownHtml("<div markdown=\"1\">\n*a*", render), "<div>\n[block *a*]\n</div>");
	// A blank line after a block's end tag, so a heading on the next line is a heading.
	assert.equal(kramdownHtml("<aside>\nx\n</aside>\n## Next\n", render), "<aside>\nx\n</aside>\n\n## Next\n");
	// Nothing to do without HTML.
	assert.equal(kramdownHtml("# Pine\n\n- a\n", render), "# Pine\n\n- a\n");
});

test("headings_inside_html_get_kramdowns_own_ids", () => {
	const seen = new Map<string, number>();
	assert.equal(kramdownId("Café notes", seen), "caf-notes");
	assert.equal(kramdownId("1. Getting started", seen), "getting-started");
	assert.equal(kramdownId("Ελληνικά", seen), "section");
	assert.equal(kramdownId("中文", seen), "section-1");
	// A `{#id}` the page wrote stays, and so does a heading that was HTML already (a nested block's).
	const html = "<h2 id=\"caf\">Café</h2>\n<h3 id=\"own\">Own</h3>\n<h2 id=\"x\">Nested</h2>";
	assert.equal(withKramdownIds(html, "## Café\n### Own {#own}\n<h2 id=\"x\">Nested</h2>", new Map()), "<h2 id=\"caf\">Café</h2>\n<h3 id=\"own\">Own</h3>\n<h2 id=\"x\">Nested</h2>");
	assert.equal(withKramdownIds("<h2 id=\"café-x\">Café <em>x</em></h2>", "## Café *x*", new Map()), "<h2 id=\"caf-x\">Café <em>x</em></h2>");
});
