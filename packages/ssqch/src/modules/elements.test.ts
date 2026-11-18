// Islands, from the unit tests in plugins/elements (0.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUsed, insertBefore, isElementName, tags } from "./elements.ts";

const known = () => new Map([
	["like-button", { script: "/elements/like-button.js", style: "/elements/like-button.css" }],
	["trail-map", { script: "/elements/maps/trail-map.js", style: undefined }],
]);

test("the elements a page uses are found", () => {
	const html = `<p><like-button count="3">3 likes</like-button> <trail-map ssqch:load="visible"></trail-map><trail-map ssqch:load="idle"></trail-map><other-thing></other-thing></p>`;
	const { html: out, used } = findUsed(html, known(), "eager");
	assert.equal(out, `<p><like-button count="3">3 likes</like-button> <trail-map></trail-map><trail-map></trail-map><other-thing></other-thing></p>`);
	assert.deepEqual([...used], [["like-button", "eager"], ["trail-map", "idle"]]);
	assert.equal(findUsed("<p>none</p>", known(), "eager").used.size, 0);
	assert.throws(() => findUsed(`<like-button ssqch:load="later"></like-button>`, known(), "eager"), /^BuildError: <like-button ssqch:load="later">: use eager, idle or visible$/);
});

test("the tags for a page", () => {
	const used = new Map<string, "eager" | "idle" | "visible">([["like-button", "eager"], ["trail-map", "visible"]]);
	const [head, body] = tags(used, known(), "/repo");
	assert.equal(head, `<link rel="stylesheet" href="/elements/like-button.css">\n`);
	assert.ok(body.startsWith(`<script type="module" src="/elements/like-button.js"></script>\n<script type="module">`), body);
	// The lazy loader's URLs are in a script, so they carry the base themselves.
	assert.ok(body.includes(`["trail-map","/repo/elements/maps/trail-map.js","visible"]`), body);

	let html = "<html><head><title>x</title></head><body><p>hi</p></body></html>";
	html = insertBefore(html, "</head>", "<link>", false);
	html = insertBefore(html, "</body>", "<script></script>", true);
	assert.equal(html, "<html><head><title>x</title><link></head><body><p>hi</p><script></script></body></html>");
	assert.equal(insertBefore("<p>hi</p>", "</body>", "<script></script>", true), "<p>hi</p><script></script>");
});

test("element names have a hyphen", () => {
	for (const name of ["like-button", "x-1", "trail-map.v2"]) assert.ok(isElementName(name), name);
	for (const name of ["button", "Like-Button", "-x", "1-x", "shared"]) assert.ok(!isElementName(name), name);
});
