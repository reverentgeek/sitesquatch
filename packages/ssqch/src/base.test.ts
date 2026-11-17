// From crates/sitesquatch/src/base.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cssWithBase, normalizeBase, rewriteBase, srcsetWithBase, withBase } from "./base.ts";

test("normalizes_the_setting", () => {
	for (const [given, kept] of [["", ""], ["/", ""], ["/docs", "/docs"], ["/docs/", "/docs"], [" /a/b/ ", "/a/b"]]) {
		assert.equal(normalizeBase(given), kept, JSON.stringify(given));
	}
	for (const bad of ["docs", "https://example.com/docs/", "//docs", "/a//b", "/a/../b", "/a b", "/a?b", "/a#b"]) {
		assert.throws(() => normalizeBase(bad), Error, JSON.stringify(bad));
	}
});

test("prefixes_urls_from_the_root_only", () => {
	assert.equal(withBase("/repo", "/about/"), "/repo/about/");
	assert.equal(withBase("/repo", "/"), "/repo/");
	for (const other of ["about/", "../x", "#top", "https://example.com/", "//cdn.example.com/x.js", "mailto:a@b.c", ""]) {
		assert.equal(withBase("/repo", other), other);
	}
	assert.equal(withBase("", "/about/"), "/about/");
});

test("rewrites_attributes_srcsets_styles_and_refreshes", () => {
	const html = [
		`<link rel="stylesheet" href="/site.css"><meta http-equiv="refresh" content="0; url=/new/">`,
		`<style>body { background: url(/bg.png) } .a { background: url("/a.png") } .b { background: url(b.png) } .c { background: url(//cdn.x/c.png) }</style>`,
		`<a href="/about/#team">a</a><a href="#top">t</a><a href="next/">n</a><a href="https://example.com/">e</a><a href="//example.com/">p</a>`,
		`<img src="/i.png" srcset="/i-300.webp 300w, /i-600.webp 600w, rel.webp 900w"><video poster="/p.jpg"></video>`,
		`<form action="/search/"><button formaction="/go/"></button></form><svg><use href="/sprite.svg#x"/><use xlink:href="/old.svg#y"/></svg>`,
		`<div style="background-image: url('/hero.jpg')"></div><script>const u = "/api/";</script>`,
	].join("");
	const out = rewriteBase(html, "/repo");
	for (const expected of [
		`href="/repo/site.css"`,
		`content="0; url=/repo/new/"`,
		"url(/repo/bg.png)",
		`url("/repo/a.png")`,
		"url(b.png)",
		"url(//cdn.x/c.png)",
		`href="/repo/about/#team"`,
		`href="#top"`,
		`href="next/"`,
		`href="https://example.com/"`,
		`href="//example.com/"`,
		`src="/repo/i.png"`,
		`srcset="/repo/i-300.webp 300w, /repo/i-600.webp 600w, rel.webp 900w"`,
		`poster="/repo/p.jpg"`,
		`action="/repo/search/"`,
		`formaction="/repo/go/"`,
		`href="/repo/sprite.svg#x"`,
		`xlink:href="/repo/old.svg#y"`,
		"url('/repo/hero.jpg')",
		`const u = "/api/";`,
	]) {
		assert.ok(out.includes(expected), `missing ${expected}\nin ${out}`);
	}
	assert.equal(rewriteBase(html, ""), html);
});

test("srcsets_and_styles_with_awkward_urls", () => {
	// The commas in a data: URI aren't between candidates (JPEG base64 starts with `/9j/`).
	assert.equal(
		srcsetWithBase("/repo", "data:image/jpeg;base64,/9j/4AAQ 1x, /real.jpg 2x,/tight.jpg 3x,\n  /last.jpg"),
		"data:image/jpeg;base64,/9j/4AAQ 1x, /repo/real.jpg 2x,/repo/tight.jpg 3x,\n  /repo/last.jpg",
	);
	assert.equal(srcsetWithBase("/repo", "/a.png, /b.png 2x"), "/repo/a.png, /repo/b.png 2x");
	assert.equal(srcsetWithBase("/repo", ""), "");
	// Quotes written as entities, and `&amp;` in a URL.
	const html = `<div style="background:url(&quot;/hero.jpg&quot;)"></div><p style="background:url(&#39;/a.png?x=1&amp;y=2&#39;), url(//cdn.x/b.png)"></p>`;
	const out = rewriteBase(html, "/repo");
	assert.ok(out.includes("url(&quot;/repo/hero.jpg&quot;)") && out.includes("url(&#39;/repo/a.png?x=1&amp;y=2&#39;)") && out.includes("url(//cdn.x/b.png)"), out);
	assert.equal(cssWithBase("/repo", "a { b: url('/c.png') }"), "a { b: url('/repo/c.png') }");
});

// What 0.7.0 writes for the same page (`ssqch build --base /repo`), byte for byte.
test("a page is otherwise left as it was written", () => {
	const html = "<A  HREF=/x   class=b>x</A><img SRC=\"/i.png\"\n  alt=a /><a href=\"/a\" href=\"/b\">d</a><noscript><img src=\"/n.png\"></noscript><a   href = '/q' >q</a><br/><a href=\"/s\"/><input disabled value=/v src=/w><p title=\"x\" data-k>k</p><a href=\" /sp\">sp</a><A HREF=\"/keep\" Class=\"B\" >c</A>";
	assert.equal(rewriteBase(html, "/repo"), "<A HREF=\"/repo/x\" class=b>x</A><img SRC=\"/repo/i.png\" alt=a /><a href=\"/repo/a\" href=\"/b\">d</a><noscript><img src=\"/n.png\"></noscript><a href=\"/repo/q\">q</a><br/><a href=\"/repo/s\" /><input disabled value=/v src=\"/repo/w\"><p title=\"x\" data-k>k</p><a href=\"/repo/sp\">sp</a><A HREF=\"/repo/keep\" Class=\"B\">c</A>");
	const untouched = "<!doctype html>\n<!-- <a href=\"/in-a-comment/\"> -->\n<textarea><a href=\"/in-text/\"></textarea>\n<p title=\"a > b\" data-x='/y/'>1 < 2</p>\n";
	assert.equal(rewriteBase(untouched, "/repo"), untouched);
});
