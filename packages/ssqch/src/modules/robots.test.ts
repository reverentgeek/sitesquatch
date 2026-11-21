import { test } from "node:test";
import assert from "node:assert/strict";
import { CRAWLERS, robotsTxt } from "./robots.ts";

test("robots.txt has everyone's group, a group for each purpose turned off, and the sitemap", () => {
	assert.equal(robotsTxt([], { training: true, search: true, fetch: true }, undefined), "User-agent: *\nAllow: /\n");
	const txt = robotsTxt(["/drafts/"], { training: false, search: true, fetch: false }, "https://trail.example/sitemap.xml");
	const fetchers = CRAWLERS.filter((c) => c.purpose === "fetch").map((c) => `User-agent: ${c.token}`).join("\n");
	assert.ok(txt.startsWith("User-agent: *\nDisallow: /drafts/\n\nUser-agent: GPTBot\n"), txt);
	assert.ok(txt.includes(`\n\n${fetchers}\nDisallow: /\n`), txt);
	assert.ok(!txt.includes("OAI-SearchBot"), "search is allowed, so its crawlers read everyone's group");
	assert.ok(txt.endsWith("\n\nSitemap: https://trail.example/sitemap.xml\n"), txt);
});

test("every crawler has a purpose, a name and where it's documented", () => {
	for (const c of CRAWLERS) assert.ok(/^[A-Za-z-]+$/.test(c.token) && c.who && c.source.startsWith("https://"), c.token);
	assert.equal(new Set(CRAWLERS.map((c) => c.token.toLowerCase())).size, CRAWLERS.length);
});
