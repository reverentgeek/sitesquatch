import { test } from "node:test";
import assert from "node:assert/strict";
import { categoriesOf, jekyllItem, jekyllPage, jekyllSite } from "./jekyll.ts";

const item = (url: string, inputPath: string, data: Record<string, unknown>, date = "2026-01-02") => ({ url, inputPath, date: new Date(date), data, templateContent: `<p>${String(data.title)}</p>`, page: { excerpt: `<p>${String(data.title)}…</p>` } });

test("an_item_reads_in_jekylls_shape", () => {
	const post = jekyllItem(item("/pine/", "./en/news/_posts/2026-01-02-pine.md", { title: "Pine", lang: "en", categories: "release" }));
	assert.equal(post.title, "Pine");
	assert.equal(post.url, "/pine/");
	assert.equal(post.content, "<p>Pine</p>");
	assert.equal(post.excerpt, "<p>Pine…</p>");
	assert.equal(post.path, "en/news/_posts/2026-01-02-pine.md");
	assert.deepEqual(post.categories, ["en", "news", "release"]);
	// Liquid reads only own properties: the fields are its own.
	assert.ok(Object.hasOwn(post, "title") && "lang" in post && !Object.hasOwn(post, "nope"));
	assert.equal(post.data.title, "Pine", "ssqch's own shape still works");
});

test("page_and_site_are_jekylls", () => {
	const page = jekyllPage({ title: "Pine", lang: "en", locales: { en: {} }, page: {} }, { url: "/pine/", inputPath: "./_posts/2026-01-02-pine.md", date: new Date(0) }, new Set(["locales", "site"]));
	assert.deepEqual([page.title, page.lang, page.url, page.path, page.locales], ["Pine", "en", "/pine/", "_posts/2026-01-02-pine.md", undefined]);
	const old = item("/old/", "./_posts/2025-01-01-old.md", { title: "Old", tags: ["trail"] }, "2025-01-01");
	const pine = item("/pine/", "./_posts/2026-01-02-pine.md", { title: "Pine", categories: ["release"] });
	const guide = item("/g/", "./_guides/g.md", { title: "Guide" });
	const about = item("/about/", "./about.md", { title: "About" });
	const site = jekyllSite({ title: "Trail", posts: undefined }, { all: [old, pine, guide, about], posts: [old, pine], guides: [guide] }, { site: {}, locales: { en: "Hi" } });
	assert.deepEqual(site.posts.map((p: { title: string }) => p.title), ["Pine", "Old"], "newest first");
	assert.deepEqual(site.guides.map((p: { title: string }) => p.title), ["Guide"]);
	assert.deepEqual(site.pages.map((p: { title: string }) => p.title), ["About"]);
	assert.deepEqual(Object.keys(site.categories), ["release"]);
	assert.deepEqual(Object.keys(site.tags), ["trail"]);
	assert.deepEqual(site.data, { locales: { en: "Hi" } });
	assert.equal(site.title, "Trail");
	assert.deepEqual(categoriesOf("./a/b/_posts/x.md", { categories: "c d" }), ["a", "b", "c", "d"]);
});
