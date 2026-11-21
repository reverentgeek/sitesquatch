// Headings' text, from the HTML a page renders (crates/sitesquatch/src/markdown.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, headings } from "./content.ts";

test("entities_decode_and_others_stay", () => {
	assert.equal(decodeEntities("Pine &amp; cedar &lt;3 &#39;a&#x27; &nbsp;"), "Pine & cedar <3 'a'  ");
	// An object's own keys aren't entities: `&constructor;` stays as written.
	assert.equal(decodeEntities("Use &constructor; and &toString; here"), "Use &constructor; and &toString; here");
	assert.equal(decodeEntities("&#xD800; &#1114112;"), "&#xD800; &#1114112;");
});

// A heading's own inline code is part of its text (`## The \`toc\` filter`): six of
// a11yproject.com's tables of contents lost words. A heading written inside code is still none.
test("a_headings_inline_code_is_part_of_its_text", () => {
	assert.deepEqual(headings("<h2 id=\"toc\">The <code>toc</code> filter</h2><p><code><h3>an example</h3></code></p><pre><h4>also code</h4></pre>"), [{ level: 2, id: "toc", text: "The toc filter" }]);
});

// The vuejs.org rerun: VitePress's anchor (and markdown-it-anchor's) has no `aria-hidden`, and its
// zero-width space ended up in every heading's text, and so in a `<title>` made from it.
test("a_header_anchor_isnt_part_of_its_headings_text", () => {
	assert.deepEqual(headings("<h2 id=\"intro\" tabindex=\"-1\">Introduction <a class=\"header-anchor\" href=\"#intro\" aria-label=\"Permalink to “Introduction”\">​</a></h2>").map((h) => h.text), ["Introduction"]);
	assert.deepEqual(headings("<h2 id=\"a\">Trails <a class=\"anchor\" href=\"#a\">#</a></h2>").map((h) => h.text), ["Trails #"]);
});
