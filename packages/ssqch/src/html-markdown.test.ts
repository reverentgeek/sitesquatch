import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, rewriteLinks } from "./html-markdown.ts";

test("a page's own part is its article, then its main, then its body", () => {
	const chrome = (inner: string) => `<!doctype html><html><head><title>x</title><style>p{}</style></head><body><header><nav><a href="/">Home</a></nav></header>${inner}<footer>Rangers</footer></body></html>`;
	assert.equal(htmlToMarkdown(chrome("<main><p>Lead</p><article><h1>Pines</h1><p>Tall.</p></article></main>")), "# Pines\n\nTall.\n");
	assert.equal(htmlToMarkdown(chrome("<main><h1>Pines</h1><p>Tall.</p></main>")), "# Pines\n\nTall.\n");
	assert.equal(htmlToMarkdown("<body><p>Only</p></body>"), "Only\n");
	// A list of articles (a topic's posts, each a card) is the main's, not the first card's.
	const cards = "<main><h1>Pine cones</h1><article><h2>Crunch</h2><p>One.</p></article><article><h2>Snacks</h2><p>Two.</p></article></main>";
	assert.equal(htmlToMarkdown(chrome(cards)), "# Pine cones\n\n## Crunch\n\nOne.\n\n## Snacks\n\nTwo.\n");
	// An article with articles inside it (comments) is still the page's one article.
	assert.equal(htmlToMarkdown(chrome("<main><p>Lead</p><article><h1>Pines</h1><article><p>Nice.</p></article></article></main>")), "# Pines\n\nNice.\n");
	// Several articles and no main: the first, as before.
	assert.equal(htmlToMarkdown("<body><article><p>A</p></article><article><p>B</p></article></body>"), "A\n");
});

test("an entity in the page is its character in the copy", () => {
	assert.equal(htmlToMarkdown("<main><p>3 posts &middot; <a href=\"/topics/\">all topics</a> &mdash; &amp; more</p></main>"), "3 posts · [all topics](/topics/) — & more\n");
});

test("what a reader reads becomes Markdown", () => {
	const html = [
		"<h2 id=\"gear\">Gear <a class=\"anchor\" href=\"#gear\">#</a></h2>",
		"<p>Pack <strong>water</strong>, <em>snacks</em> &amp; a <a href=\"/map/\" title=\"The map\">map</a>.<br>Then <code>ssqch build</code>.",
		"<ul><li>Pine Cone Crunch<li>Squatch Snacks<ul><li>Salted</ul></ul>",
		"<ol start=\"3\"><li><p>Third</p><p>More</p></li></ol>",
		"<pre class=\"language-js\"><code><span class=\"hl-k\">let</span> n = 1 &lt; 2;\n</code></pre>",
		"<blockquote><p>Leave no trace.</p></blockquote>",
		"<table><thead><tr><th>Trail</th><th>Miles</th></tr></thead><tbody><tr><td>Cedar | Old</td><td>3</td></tr></tbody></table>",
		"<img src=\"/sticker.svg\" alt=\"\"><img src=\"/stump.jpg\" alt=\"The stump\">",
		"<div hidden>secret</div><p aria-hidden=\"true\">also</p><form><button>Go</button></form><script>alert(1)</script>",
		"<dl><dt>Ranger</dt><dd>Keeps the trail.</dd></dl><hr>",
	].join("");
	assert.equal(htmlToMarkdown(html), [
		"## Gear",
		"Pack **water**, *snacks* & a [map](/map/ \"The map\").\\\nThen `ssqch build`.",
		"- Pine Cone Crunch\n- Squatch Snacks\n  - Salted",
		"3. Third\n\n   More",
		"```js\nlet n = 1 < 2;\n```",
		"> Leave no trace.",
		"| Trail | Miles |\n| --- | --- |\n| Cedar \\| Old | 3 |",
		"![The stump](/stump.jpg)",
		"**Ranger**",
		"Keeps the trail.",
		"---",
	].join("\n\n") + "\n");
});

test("text that Markdown would read as markup is escaped", () => {
	assert.equal(htmlToMarkdown("<p>2 * 3 is [six] and <b>_x_</b> but snake_case stays</p>"), "2 \\* 3 is \\[six\\] and **\\_x\\_** but snake_case stays\n");
	assert.equal(htmlToMarkdown("<p># not a heading</p><p>1. not a list</p><p>&lt;div&gt; is text</p>"), "\\# not a heading\n\n1\\. not a list\n\n\\<div> is text\n");
});

test("a footnote's text isn't a link to rewrite", () => {
	// The new-blog run: `[^raccoons]: Two raccoons...` became `[^raccoons]: https://.../Two raccoons...`.
	assert.equal(rewriteLinks("Crunch.[^1]\n\n[^1]: Two raccoons agree.\n[^a b]: also.\n[ref]: one.md", (h) => `/X/${h}`), "Crunch.[^1]\n\n[^1]: Two raccoons agree.\n[^a b]: also.\n[ref]: /X/one.md");
});

test("links are rewritten outside code", () => {
	const md = "[a](one.md) ![b](pic.png \"t\") `[c](kept.md)` <a href=\"two.md\">x</a>\n\n[ref]: three.md\n\n```\n[d](kept.md)\n```\n[e](<with space.md>)";
	assert.equal(rewriteLinks(md, (h) => `/X/${h}`), "[a](/X/one.md) ![b](/X/pic.png \"t\") `[c](kept.md)` <a href=\"/X/two.md\">x</a>\n\n[ref]: /X/three.md\n\n```\n[d](kept.md)\n```\n[e](</X/with space.md>)");
});
