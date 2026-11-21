import { test } from "node:test";
import assert from "node:assert/strict";
import { hugoShortcodes, INLINE_SHORTCODE_MARKER, type InlineShortcode, inlineShortcodeMarker, inlineShortcodeNumber, pythonMarkdownAfter, pythonMarkdownBefore, pythonMarkdownBlocks, pythonMarkdownIds, pythonMarkdownSlug, sourceLinks } from "./markdown-dialects.ts";

const both = { admonitions: true, tabs: true };

test("mkdocs_admonitions_become_python_markdowns_html", () => {
	assert.equal(pythonMarkdownBlocks("!!! note \"Pack\"\n    Water\n\nAfter\n", both), "<div class=\"admonition note\">\n<p class=\"admonition-title\">Pack</p>\n\nWater\n\n</div>\n\nAfter\n");
	// The title is the type's name when there's none, and gone when it's "".
	assert.equal(pythonMarkdownBlocks("!!! danger\n    x", both), "<div class=\"admonition danger\">\n<p class=\"admonition-title\">Danger</p>\n\nx\n\n</div>");
	assert.equal(pythonMarkdownBlocks("!!! note inline end \"\"\n    x", both), "<div class=\"admonition note inline end\">\n\nx\n\n</div>");
	// `???` is pymdownx.details; `???+` is open.
	assert.equal(pythonMarkdownBlocks("???+ tip\n    x", both), "<details class=\"tip\" open=\"open\">\n<summary>Tip</summary>\n\nx\n\n</details>");
	// Nested, and inside a list item, they keep their place.
	assert.equal(pythonMarkdownBlocks("- a\n\n    !!! note\n        b\n", both), "- a\n\n    <div class=\"admonition note\">\n    <p class=\"admonition-title\">Note</p>\n\n    b\n\n    </div>\n");
	// Fences are left alone, and so is everything when the option is off.
	assert.equal(pythonMarkdownBlocks("```\n!!! note\n    x\n```\n", both), "```\n!!! note\n    x\n```\n");
	assert.equal(pythonMarkdownBlocks("!!! note\n    x", { admonitions: false, tabs: true }), "!!! note\n    x");
});

test("mkdocs_tabs_become_pymdownx_tabbeds_html", () => {
	const html = pythonMarkdownBlocks("=== \"A\"\n\n    one\n\n===+ \"B\"\n    two\n\nAfter\n\n=== \"C\"\n    three\n", both);
	assert.ok(html.startsWith("<div class=\"tabbed-set tabbed-alternate\" data-tabs=\"1:2\"><input id=\"__tabbed_1_1\" name=\"__tabbed_1\" type=\"radio\" /><input checked=\"checked\" id=\"__tabbed_1_2\" name=\"__tabbed_1\" type=\"radio\" /><div class=\"tabbed-labels\"><label for=\"__tabbed_1_1\">A</label><label for=\"__tabbed_1_2\">B</label></div>\n<div class=\"tabbed-content\">\n<div class=\"tabbed-block\">\n\none\n\n</div>\n<div class=\"tabbed-block\">\n\ntwo\n\n</div>\n</div>\n</div>"), html);
	// Text between them starts a second set, numbered on.
	assert.ok(html.includes("After\n\n<div class=\"tabbed-set tabbed-alternate\" data-tabs=\"2:1\">"), html);
});

test("hugo_shortcodes_become_containers", () => {
	assert.equal(hugoShortcodes("{{< note type=\"tip\" >}}\nA *b*\n{{< /note >}}\n"), "::: note type=\"tip\"\nA *b*\n:::\n");
	assert.equal(hugoShortcodes("{{% details %}}\n{{< youtube abc >}}\n{{% /details %}}"), ":::: details\n::: youtube abc\n:::\n::::");
	assert.equal(hugoShortcodes("{{< img src=\"a.png\" />}}"), "::: img src=\"a.png\"\n:::");
	// Inside a line of text, and inside fences, they stay; `/* */` shows one without calling it.
	assert.equal(hugoShortcodes("See {{< ref \"a\" >}} here.\n```\n{{< note >}}\n{{</* note */>}}\n```"), "See {{< ref \"a\" >}} here.\n```\n{{< note >}}\n{{< note >}}\n```");
	// One written with `/* */` on a line of its own is shown, not called.
	assert.equal(hugoShortcodes("{{</* note */>}}\n"), "{{< note >}}\n");
	// With a template for it, one inside a line is a marker, kept with its arguments and what's inside a pair.
	const inline: InlineShortcode[] = [];
	const has = (name: string) => name !== "unknown";
	const out = hugoShortcodes("A {{< ref \"a\" >}} {{% b %}}x {{< c />}}{{% /b %}} {{< unknown >}} {{</* ref */>}}\n# Title {{< c />}}", inline, has);
	assert.equal(out, `A ${inlineShortcodeMarker(0)} ${inlineShortcodeMarker(1)} {{< unknown >}} {{< ref >}}\n# Title${inlineShortcodeMarker(2)}`);
	assert.deepEqual(inline, [{ name: "ref", args: "\"a\"", inner: undefined }, { name: "b", args: "", inner: "x {{< c />}}" }, { name: "c", args: "", inner: undefined, spaces: [" ", ""] }]);
	assert.equal(inlineShortcodeMarker(12), "\uE020\uE031\uE032\uE021");
	assert.deepEqual([..."%EE%80%A0%EE%80%B1%EE%80%B2%EE%80%A1".matchAll(INLINE_SHORTCODE_MARKER)].map((m) => inlineShortcodeNumber(m[1], m[2])), [12]);
});

test("source_links_go_to_the_pages_built_from_them", () => {
	const all = [{ inputPath: "./docs/index.md", url: "/" }, { inputPath: "./docs/setup/install.md", url: "/setup/install/" }];
	const data = (inputPath: string, url: string) => ({ page: { inputPath, url }, collections: { all } });
	const html = "<a href=\"setup/install.md#first\">x</a> <a href=\"gone.md\">y</a> <a href=\"https://x.org/a.md\">z</a>";
	assert.equal(sourceLinks(html, data("./docs/index.md", "/"), true), "<a href=\"/setup/install/#first\">x</a> <a href=\"gone.md\">y</a> <a href=\"https://x.org/a.md\">z</a>");
	assert.equal(sourceLinks(html, data("./docs/index.md", "/"), "relative"), "<a href=\"setup/install/#first\">x</a> <a href=\"gone.md\">y</a> <a href=\"https://x.org/a.md\">z</a>");
	assert.equal(sourceLinks("<a href=\"../index.md\">h</a>", data("./docs/setup/install.md", "/setup/install/"), "relative"), "<a href=\"../../\">h</a>");
	// Images and other files are read from the Markdown file's folder too.
	assert.equal(sourceLinks("<img src=\"img/stump.png\" alt=\"\"> <img src=\"/abs.png\"> <img src=\"https://x.org/a.png\">", data("./docs/setup/install.md", "/setup/install/"), "relative"), "<img src=\"../img/stump.png\" alt=\"\"> <img src=\"/abs.png\"> <img src=\"https://x.org/a.png\">");
	assert.equal(sourceLinks("<img src=\"img/stump.png\">", data("./docs/setup/install.md", "/setup/install/"), true), "<img src=\"/setup/img/stump.png\">");
	// A theme's own page (its 404) is outside the input folder; the site's input folder still decides.
	const themed = { page: { inputPath: "./docs/setup/install.md", url: "/setup/install/" }, collections: { all: [...all, { inputPath: "./theme/404.jinja", url: "/404.html" }] } };
	assert.equal(sourceLinks("<img src=\"../img/stump.png\">", themed, "relative", "docs/"), "<img src=\"../../img/stump.png\">");
});

test("python_markdown_slugs_as_tocs_default", () => {
	assert.equal(pythonMarkdownSlug("Café Trail Notes"), "cafe-trail-notes");
	assert.equal(pythonMarkdownSlug("What's new? (2026)"), "whats-new-2026");
	assert.equal(pythonMarkdownSlug("a -- b"), "a-b");
	assert.equal(pythonMarkdownSlug("中文"), "");
});

test("python_markdown_reads_raw_html_and_lists_as_it_does", () => {
	// A raw HTML block runs to its closing tag, blank lines and all, and comes back as written.
	const { source, raw } = pythonMarkdownBefore("# Camp\n\n<div class=\"x\">\n\n*not markdown*\n\n</div>\nAfter\n");
	assert.equal(source, "# Camp\n\n<!--ssqch-raw-0-->\n\nAfter\n");
	assert.deepEqual(raw, ["<div class=\"x\">\n\n*not markdown*\n\n</div>"]);
	assert.equal(pythonMarkdownAfter("<h1>Camp</h1>\n<!--ssqch-raw-0-->\n<p>After</p>\n", raw), "<h1>Camp</h1>\n<div class=\"x\">\n\n*not markdown*\n\n</div>\n\n<p>After</p>");
	// `markdown` attributes are md_in_html's, and fences are left alone.
	assert.deepEqual(pythonMarkdownBefore("<div markdown>\n\n*a*\n\n</div>\n").raw, []);
	assert.deepEqual(pythonMarkdownBefore("```\n<div>\n\nx\n```\n").raw, []);
	// Lists nest at four spaces: two is the next item.
	assert.equal(pythonMarkdownBefore("* a\n  * b\n    * c\n").source, "* a\n* b\n    * c\n");
	// One space at the end of a line stays.
	assert.equal(pythonMarkdownAfter(pythonMarkdownBefore("mounts. \nnext").source.replace("\n", "\n"), []).endsWith(" \nnext"), true);
});

test("python_markdown_writes_html_as_it_does", () => {
	assert.equal(pythonMarkdownAfter("<p>Say &quot;hi&quot; <a title=\"&quot;x&quot;\">a</a></p>\n<hr>\n<p>a<br>\n<img src=\"/a.png\" alt=\"A\"></p>\n", []), "<p>Say \"hi\" <a title=\"&quot;x&quot;\">a</a></p>\n<hr />\n<p>a<br />\n<img alt=\"A\" src=\"/a.png\" /></p>");
	assert.equal(pythonMarkdownAfter("<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n", []), "<ul>\n<li>a<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>");
	// toc's ids for a repeated heading, and the page's links to them.
	assert.equal(pythonMarkdownIds("<h2 id=\"example\">Example</h2><h2 id=\"example-1\">Example</h2><a href=\"#example-1\">x</a><h2 id=\"step-1\">Step 1</h2>"), "<h2 id=\"example\">Example</h2><h2 id=\"example_1\">Example</h2><a href=\"#example_1\">x</a><h2 id=\"step-1\">Step 1</h2>");
});
