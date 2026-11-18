// The tokenizer reads HTML where lol_html 2.9.0 (0.7's) reads it. Each expected value is what
// lol_html gave for the same input: the start tags its element handlers saw (with their namespace
// and attributes), the text of elements whose content is text, and what it wrote after a rewrite
// that adds `!` to every `href`, sets `data-t` on a tag with `x-set` and turns `url(` into `URL(`
// in styles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteHtml } from "./html.ts";

/** The start tags in `html`: `name@namespace[attr=value ...]`, the namespace only when it isn't HTML. */
function tags(html: string): string[] {
	const out: string[] = [];
	rewriteHtml(html, {
		tag(el) {
			const attributes = el.entries().map(([k, v]) => `${k}=${v}`).join(" ");
			out.push(`${el.name}${el.namespace === "html" ? "" : `@${el.namespace}`}${attributes ? `[${attributes}]` : ""}`);
		},
	});
	return out;
}

/** The text of each element whose content is text. */
function texts(html: string): string[] {
	const out: string[] = [];
	rewriteHtml(html, { rawText: (el, text) => { if (el.namespace === "html") out.push(`${el.name}:${text}`); } });
	return out;
}

function rewrite(html: string): string {
	return rewriteHtml(html, {
		tag(el) {
			const href = el.get("href");
			if (href !== undefined) el.set("href", `${href}!`);
			if (el.get("x-set") !== undefined) el.set("data-t", "1");
		},
		style: (css) => css.replaceAll("url(", "URL("),
	});
}

test("a self-closed element whose content is text still holds text to its end tag", () => {
	// HTML ignores the slash on `<iframe />`, `<script />`, `<textarea/>` and `<title/>`.
	assert.deepEqual(tags("<iframe src=x /><img src=y></iframe><img src=z>"), ["iframe[src=x]", "img[src=z]"]);
	assert.deepEqual(texts("<iframe src=x /><img src=y></iframe><img src=z>"), ["iframe:<img src=y>"]);
	assert.deepEqual(tags("<script src=a.js /><a href=/in></script><a href=/out>"), ["script[src=a.js]", "a[href=/out]"]);
	assert.equal(rewrite("<script src=a.js /><a href=/in></script><a href=/out>"), "<script src=a.js /><a href=/in></script><a href=\"/out!\">");
	assert.deepEqual(tags("<textarea/><a href=/in></textarea><title/><a href=/in2></title><a href=/out>"), ["textarea", "title", "a[href=/out]"]);
});

test("svg and math hold markup, until an integration point or a tag that breaks out", () => {
	const svg = "<svg><style>a{fill:url(/x)}<a href=/q>t</a></style><title><a href=/b6/>x</a></title></svg><style><a href=/no></style>";
	assert.deepEqual(tags(svg), ["svg@svg", "style@svg", "a@svg[href=/q]", "title", "a[href=/b6/]", "style"]);
	assert.deepEqual(texts(svg), ["style:<a href=/no>"]);
	// A `<style>` in SVG is still a style: its text is rewritten, and so is the markup in it.
	assert.equal(rewrite(svg), "<svg><style>a{fill:URL(/x)}<a href=\"/q!\">t</a></style><title><a href=\"/b6/!\">x</a></title></svg><style><a href=/no></style>");
	assert.deepEqual(tags("<math><style><a href=/m></style><mi><style><a href=/no></style></mi></math>"), ["math@math", "style@math", "a@math[href=/m]", "mi", "style"]);
	assert.deepEqual(tags("<svg><foreignObject><style><a href=/no></style></foreignObject><p><style><a href=/no2></style>"), ["svg@svg", "foreignobject", "style", "p", "style"]);
	// A self-closed integration point is closed.
	assert.deepEqual(tags("<svg><desc/><style><a href=/yes></style></svg>"), ["svg@svg", "desc@svg", "style@svg", "a@svg[href=/yes]"]);
	// CDATA is text in foreign content, and a bogus comment to the first `>` elsewhere.
	assert.deepEqual(tags("<svg><![CDATA[<a href=/no>]]><a href=/yes></svg><![CDATA[<a href=/x>]]><a href=/y>"), ["svg@svg", "a@svg[href=/yes]", "a[href=/y]"]);
	assert.equal(rewrite("<svg><style><![CDATA[.a{fill:url(/c)}]]></style></svg>"), "<svg><style><![CDATA[.a{fill:URL(/c)}]]></style></svg>");
	// A `<style>` in SVG closes where lol_html closes it: at its end tag, or the `</svg>` around it.
	assert.equal(rewrite("<svg><style>.a{}</svg><p style=x>url(</p>"), "<svg><style>.a{}</svg><p style=x>url(</p>");
});

test("comments end where browsers end them", () => {
	const html = "<!--><a href=/b3/>x</a><!-- --><!--->a<!-- --!><b><!-- -- --!-> --><i>";
	assert.deepEqual(tags(html), ["a[href=/b3/]", "b", "i"]);
	assert.equal(rewrite(html), "<!--><a href=\"/b3/!\">x</a><!-- --><!--->a<!-- --!><b><!-- -- --!-> --><i>");
});

test("a script's <!--<script> part isn't ended by the first </script>", () => {
	const html = "<script><!--<script></script><a href=/no></script>--><i></script><u>";
	assert.deepEqual(tags(html), ["script", "i", "u"]);
	assert.deepEqual(texts(html), ["script:<!--<script></script><a href=/no>"]);
	assert.deepEqual(texts("<script><!-- <a href=/no> --></script><b><script><!--<script>--></script><i>"), ["script:<!-- <a href=/no> -->", "script:<!--<script>-->"]);
	assert.deepEqual(tags("<script><!-- <a href=/no> --></script><b><script><!--<script>--></script><i>"), ["script", "b", "script", "i"]);
});

test("repeated attributes are kept, and the first is the one read", () => {
	assert.deepEqual(tags("<img alt=a ALT=b x-set>"), ["img[alt=a alt=b x-set=]"]);
	assert.equal(rewrite("<img alt=a ALT=b x-set>"), "<img alt=a ALT=b x-set data-t=\"1\">");
	let alt: string | undefined;
	rewriteHtml("<img alt=a alt=b>", { tag: (el) => { alt = el.get("alt"); } });
	assert.equal(alt, "a");
});

test("an end tag's attributes are read as a start tag's are", () => {
	const html = "</p x=\"><a href='/no'>\"><a href=/w></a b='>'>";
	assert.deepEqual(tags(html), ["a[href=/w]"]);
	assert.equal(rewrite(html), "</p x=\"><a href='/no'>\"><a href=\"/w!\"></a b='>'>");
});

test("a changed tag is written as lol_html writes it", () => {
	// An attribute written `b=` with nothing after it is written again as its name.
	assert.equal(rewrite("<img x-set b=><img x-set c = >"), "<img x-set b data-t=\"1\"><img x-set c data-t=\"1\">");
	assert.equal(rewrite("<a HREF='/a' class = x/>"), "<a HREF=\"/a!\" class = x/>");
	assert.equal(rewrite("<x-a x-set/>"), "<x-a x-set data-t=\"1\" />");
	// Taking off an attribute the tag doesn't have leaves it as it was.
	assert.equal(rewriteHtml("<img  src=a   alt=b>", { tag: (el) => el.remove("title") }), "<img  src=a   alt=b>");
	assert.equal(rewriteHtml("<img  src=a   alt=b>", { tag: (el) => el.remove("src") }), "<img alt=b>");
});

// Where lol_html isn't the same from one use to the next, or has a bug, browsers decide.
test("where lol_html contradicts itself, the tokenizer reads as browsers do", () => {
	// After `<script src=>`, lol_html reads markup when nothing asked to see the script, and its
	// text otherwise; browsers read its text.
	assert.deepEqual(tags("<script src=><a href=/no></script><a href=/yes>"), ["script[src=]", "a[href=/yes]"]);
	assert.equal(rewrite("<script src=><a href=/no></script><a href=/yes>"), "<script src=><a href=/no></script><a href=\"/yes!\">");
	// lol_html skips the handlers of SVG's `<title>`, `<desc>`, `<foreignObject>` and `<font>`, and
	// MathML's `<mi>`..., right after an end tag, in its fast path.
	assert.equal(rewrite("<svg><path></path><title x-set>t</title></svg>"), "<svg><path></path><title x-set data-t=\"1\">t</title></svg>");
});
