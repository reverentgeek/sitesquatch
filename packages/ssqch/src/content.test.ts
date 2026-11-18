// Headings' text, from the HTML a page renders (crates/sitesquatch/src/markdown.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities } from "./content.ts";

test("entities_decode_and_others_stay", () => {
	assert.equal(decodeEntities("Pine &amp; cedar &lt;3 &#39;a&#x27; &nbsp;"), "Pine & cedar <3 'a'  ");
	// An object's own keys aren't entities: `&constructor;` stays as written.
	assert.equal(decodeEntities("Use &constructor; and &toString; here"), "Use &constructor; and &toString; here");
	assert.equal(decodeEntities("&#xD800; &#1114112;"), "&#xD800; &#1114112;");
});
