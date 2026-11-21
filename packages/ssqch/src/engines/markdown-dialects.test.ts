import { test } from "node:test";
import assert from "node:assert/strict";
import { hugoShortcodes, pythonMarkdownBlocks, pythonMarkdownSlug, sourceLinks } from "./markdown-dialects.ts";

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
