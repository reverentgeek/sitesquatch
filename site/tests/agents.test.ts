// What agents get equals what people get. Reads the built site (`node build.ts` first; CI's
// `check` job builds before it tests): every docs page has its Markdown copy, /llms.txt
// lists exactly the docs pages, and each copy, rendered, has the same text as its page (the
// title and the part marked `data-copy` in src/_includes/doc.jinja).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { markdown } from "../../packages/ssqch/src/exports/ssqch.ts";
import { copyUrl as copyOf } from "../../packages/ssqch/src/modules/llms.ts";
import { SITE } from "../lib/docs.ts";

const dist = path.join(SITE, "dist");
const built = existsSync(path.join(dist, "llms.txt"));

/** The docs pages the build wrote: their URLs. */
function docsPages(): string[] {
	const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
	return walk(path.join(dist, "docs")).filter((f) => f.endsWith("index.html")).map((f) => `/${path.relative(dist, path.dirname(f)).split(path.sep).join("/")}/`).sort();
}

/** HTML's text, as a reader gets it: no tags, the heading links' `#` left out, entities read, spaces collapsed. */
function text(html: string): string {
	return html
		.replace(/<a class="?anchor"?[^>]*>#<\/a>/g, "")
		// Inline tags (highlighting's <span>s, links, code) join what's around them; the rest separate it.
		.replace(/<\/?(?:span|a|code|em|strong|b|i|sup|sub|kbd|mark|del|ins)\b[^>]*>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

test("the site is built", { skip: built ? false : "run `node build.ts` first" }, () => {});

test("every docs page has its Markdown copy", { skip: !built }, () => {
	const urls = docsPages();
	assert.ok(urls.length > 30, `only ${urls.length} docs pages in dist/`);
	for (const url of urls) {
		const copy = copyOf(url);
		assert.ok(existsSync(path.join(dist, copy)), `${url} has no ${copy}`);
		const html = readFileSync(path.join(dist, url, "index.html"), "utf8");
		assert.match(html, new RegExp(`<link rel="?alternate"? type="?text/markdown"? href="?${copy.replace(/\./g, "\\.")}"?>`), `${url} doesn't link its copy in <head>`);
	}
});

test("/llms.txt lists exactly the docs pages", { skip: !built }, () => {
	const listed = [...readFileSync(path.join(dist, "llms.txt"), "utf8").matchAll(/\]\(https:\/\/sitesquatch\.dev(\/docs[^)]*\.md)\)/g)].map(([, url]) => url).sort();
	assert.deepEqual(listed, docsPages().map(copyOf).sort());
});

test("each copy has the same text as its page", { skip: !built }, () => {
	for (const url of docsPages()) {
		const html = readFileSync(path.join(dist, url, "index.html"), "utf8");
		const title = /<h1 data-copy[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1];
		// The page's own text runs from its data-copy <div> to what the layout adds after it.
		const body = /<div data-copy[^>]*>([\s\S]*?)<\/div>\s*(?=<h2 id="?the-map|<aside class="?see-it|<nav class="?pager)/.exec(html)?.[1];
		assert.ok(title !== undefined && body !== undefined, `${url}: no data-copy title and text`);
		const copy = readFileSync(path.join(dist, copyOf(url)), "utf8");
		assert.equal(text(markdown(copy)), text(`<h1>${title}</h1>${body}`), `${copyOf(url)} doesn't read as ${url} does`);
	}
});
