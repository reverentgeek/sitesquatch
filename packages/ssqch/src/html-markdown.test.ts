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

// Squatch Snacks (B3): three pricing plans inside `<billing-toggle>` were one line in the copy,
// `4 snacks a monthFree shippingSkip any month`. What's inside an element of `elementsPlugin()`'s
// is the page as it reads without the script, so its blocks are blocks.
test("a custom element around blocks is read as a div is", () => {
	const inside = "<section><h2>Day Hike</h2><p>For weekend walkers.</p><ul><li>4 snacks a month</li><li>Free shipping</li></ul></section>";
	const plain = htmlToMarkdown(`<main><h1>Plans</h1><div>${inside}</div></main>`);
	assert.equal(plain, "# Plans\n\n## Day Hike\n\nFor weekend walkers.\n\n- 4 snacks a month\n- Free shipping\n");
	assert.equal(htmlToMarkdown(`<main><h1>Plans</h1><billing-toggle>${inside}</billing-toggle></main>`), plain);
	// One inside another, and text beside the wrapper, which is a paragraph of its own.
	assert.equal(htmlToMarkdown("<main>Before <x-outer><x-inner><p>One</p><p>Two</p></x-inner></x-outer> after</main>"), "Before\n\nOne\n\nTwo\n\nafter\n");
	// In a list item, as any block there.
	assert.equal(htmlToMarkdown("<main><ul><li><x-card><h3>Crunch</h3><p>Pine cones.</p></x-card></li></ul></main>"), "- ### Crunch\n  Pine cones.\n");
	// One with only text stays in its line, and a hidden one stays out, with what it wraps.
	assert.equal(htmlToMarkdown("<main><p>Pine Cone Crunch <x-badge>New</x-badge> today</p><x-badge>Sold out</x-badge> everywhere</main>"), "Pine Cone Crunch New today\n\nSold out everywhere\n");
	assert.equal(htmlToMarkdown("<main><p>Shown</p><x-menu hidden><p>Not shown</p></x-menu><x-tip><p hidden>Nor this</p> but this</x-tip></main>"), "Shown\n\nbut this\n");
});

test("any element around blocks is read as a div is, and a link around them links the first", () => {
	// A `<search>` and a `<span>` around a card, which ran together as `Find a trailCedarOld Growth`.
	assert.equal(htmlToMarkdown("<main><search><h2>Find a trail</h2><ul><li>Cedar</li><li>Old Growth</li></ul></search><span class=\"card\"><h3>Ranger</h3><p>On duty.</p></span></main>"), "## Find a trail\n\n- Cedar\n- Old Growth\n\n### Ranger\n\nOn duty.\n");
	// A link around a card: its heading is the link, or its first paragraph.
	assert.equal(htmlToMarkdown("<main><a href=\"/plans/day/\" title=\"The plan\"><h3>Day Hike</h3><p>For weekend walkers.</p></a><a href=\"/plans/thru/\"><p>Thru Hike</p><p>For the long trail.</p></a></main>"), "### [Day Hike](/plans/day/ \"The plan\")\n\nFor weekend walkers.\n\n[Thru Hike](/plans/thru/)\n\nFor the long trail.\n");
	// When the first block can't be the link (a list), the address follows on its own line.
	assert.equal(htmlToMarkdown("<main><a href=\"/snacks/\"><ul><li>Crunch</li></ul></a></main>"), "- Crunch\n\n[/snacks/](/snacks/)\n");
	// Text only, a link stays in its line; code is its text.
	assert.equal(htmlToMarkdown("<main><p>See <a href=\"/x/\">the trail</a> and <span>this</span>.</p></main>"), "See [the trail](/x/) and this.\n");
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
