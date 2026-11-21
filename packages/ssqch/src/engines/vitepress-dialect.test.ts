// `dialect: "vitepress"`, from the vuejs.org move: each expected string is what that move's port
// matched in VitePress's own HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VITEPRESS_HOOKS, vitepressAfter, vitepressBefore, vitepressHref, vitepressSlug } from "./vitepress-dialect.ts";

test("vitepress_slugs_are_mdit_vues", () => {
	assert.equal(vitepressSlug("What's Vue?"), "what-s-vue");
	assert.equal(vitepressSlug("1. Third level"), "_1-third-level");
	assert.equal(vitepressSlug("Café — “quoted” <tag>"), "cafe-—-quoted-tag");
	assert.equal(vitepressSlug("  --Lots   of  -- space--  "), "lots-of-space");
});

test("vues_parts_of_a_page_are_left_out_and_vue_fences_read", () => {
	const page = "<script setup>\nimport X from './X.vue'\n</script>\n\n# Pines\n\n<style scoped>\n.a {}\n</style>\n<ClientOnly>\n<Map />\n</ClientOnly>\n\n```html\n<script>kept in a fence</script>\n```\n\n```sh-vue\nnpm i {{ 'vue' }}@{{ \"3\" }}\n```\n";
	assert.equal(vitepressBefore(page), "\n# Pines\n\n\n```html\n<script>kept in a fence</script>\n```\n\n```sh\nnpm i vue@3\n```\n");
});

test("vitepress_links_and_urls", () => {
	assert.equal(vitepressHref("./essentials.md#x", true), "./essentials.html#x");
	assert.equal(vitepressHref("essentials.md", false), "./essentials");
	assert.equal(vitepressHref("../api/index.md", true), "./../api/");
	assert.equal(vitepressHref("/guide/intro", true), "/guide/intro.html");
	assert.equal(vitepressHref("/guide/intro", false), "/guide/intro");
	assert.equal(vitepressHref("/logo.svg", true), "/logo.svg");
	assert.equal(vitepressHref("#top", true), "#top");
	const link = VITEPRESS_HOOKS["hooks/link"];
	assert.equal(link({ href: "https://vueschool.io/ä", content: "Vue School" }, { htmlUrls: true }), "<a href=\"https://vueschool.io/%C3%A4\" target=\"_blank\" rel=\"noreferrer\">Vue School</a>");
	assert.equal(link({ href: "/guide/x", title: "X", content: "x" }, { htmlUrls: true }), "<a href=\"/guide/x.html\" title=\"X\">x</a>");
});

test("vitepress_blocks_have_its_markup", () => {
	const o = { htmlUrls: true };
	assert.equal(VITEPRESS_HOOKS["hooks/heading"]({ level: 2, id: "pines", text: "Pines ", content: "<em>Pines</em>" }, o), "<h2 id=\"pines\" tabindex=\"-1\"><em>Pines</em> <a class=\"header-anchor\" href=\"#pines\" aria-label=\"Permalink to “Pines”\">​</a></h2>");
	assert.equal(VITEPRESS_HOOKS["containers/info"]({ args: "", content: "<p>x</p>\n" }, o), "<div class=\"info custom-block\"><p class=\"custom-block-title custom-block-title-default\">INFO</p>\n<p>x</p>\n</div>");
	assert.equal(VITEPRESS_HOOKS["containers/details"]({ args: "", content: "<p>x</p>\n" }, o), "<details class=\"details custom-block\"><summary>Details</summary>\n<p>x</p>\n</details>");
	assert.equal(VITEPRESS_HOOKS["hooks/fence"]({ lang: "vue-html", info: "vue-html [App.vue]", code: "<div>\n</div>\n" }, o), "<div class=\"vp-code-block-title\"><div class=\"vp-code-block-title-bar\"><span class=\"vp-code-block-title-text\" data-title=\"App.vue\">App.vue</span></div><div class=\"language-template vp-adaptive-theme\"><button title=\"Copy Code\" class=\"copy\"></button><span class=\"lang\">template</span><pre class=\"shiki vp-code\" tabindex=\"0\"><code><span class=\"line\">&lt;div&gt;</span>\n<span class=\"line\">&lt;/div&gt;</span></code></pre></div></div>");
	// A highlighted token over a line break is closed and opened again, as Shiki's lines are.
	assert.equal(VITEPRESS_HOOKS["hooks/fence"]({ lang: "js", info: "js", code: "", highlighted: "<span class=\"hl-string\">`a\nb`</span>\n" }, o).includes("<span class=\"line\"><span class=\"hl-string\">`a</span></span>\n<span class=\"line\"><span class=\"hl-string\">b`</span></span>"), true);
});

test("toc_markers_and_comments_after", () => {
	const html = "<p>[[TOC]]</p>\n<!-- note -->\n<h2 id=\"a\" tabindex=\"-1\">A <a class=\"header-anchor\" href=\"#a\">​</a></h2>\n<h3 id=\"b\">B</h3>\n<h2 id=\"c\">C</h2>\n<pre><code>&lt;!-- kept --&gt;<!-- kept --></code></pre>";
	assert.equal(vitepressAfter(html), "<nav class=\"table-of-contents\"><ul><li><a href=\"#a\">A</a><ul><li><a href=\"#b\">B</a></li></ul></li><li><a href=\"#c\">C</a></li></ul></nav>\n\n<h2 id=\"a\" tabindex=\"-1\">A <a class=\"header-anchor\" href=\"#a\">​</a></h2>\n<h3 id=\"b\">B</h3>\n<h2 id=\"c\">C</h2>\n<pre><code>&lt;!-- kept --&gt;<!-- kept --></code></pre>");
});
