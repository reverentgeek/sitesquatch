// The feed helpers, from the unit tests in plugins/rss (0.7). Expected values are what Node's
// `new URL(url, base).toString()` returns (the url, unchanged, when it throws).
import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrl, dateToRfc3339, dateToRfc822, getNewestCollectionItemDate, htmlToAbsoluteUrls } from "./rss.ts";

test("urls resolve like node", () => {
	assert.equal(absoluteUrl("/a/", "https://x.com"), "https://x.com/a/");
	assert.equal(absoluteUrl("img.png", "https://x.com/post/"), "https://x.com/post/img.png");
	assert.equal(absoluteUrl("../b", "https://x.com/a/c/"), "https://x.com/a/b");
	assert.equal(absoluteUrl("https://y.com/z", "https://x.com"), "https://y.com/z");
	assert.equal(absoluteUrl("#gear-list", "https://reverentgeek.com/my-video-streaming-setup/"), "https://reverentgeek.com/my-video-streaming-setup/#gear-list");
	assert.equal(absoluteUrl("?q=1", "https://x.com/a/b"), "https://x.com/a/b?q=1");
	assert.equal(absoluteUrl("//cdn.x.com/a.js", "https://x.com/"), "https://cdn.x.com/a.js");
	assert.equal(absoluteUrl("mailto:a@b.com", "https://x.com/"), "mailto:a@b.com");
	assert.equal(absoluteUrl("HTTPS://Example.COM/A%20B", "https://x.com/"), "https://example.com/A%20B");
	assert.equal(absoluteUrl("a b.png", "https://x.com/p/"), "https://x.com/p/a%20b.png");
	assert.equal(absoluteUrl("", "https://x.com/p/"), "https://x.com/p/");
	assert.equal(absoluteUrl("https://x.com:443/a", "https://x.com/"), "https://x.com/a");
	assert.equal(absoluteUrl("./", "https://x.com/a/b/"), "https://x.com/a/b/");
	assert.equal(absoluteUrl("https://bad host/", "https://x.com/"), "https://bad host/");
});

test("html gets absolute urls", () => {
	const html = `<p><a href="/a/">a</a><img src="/i.png" srcset="/i-1.png 1x, /i-2.png 2x"></p>`;
	const out = htmlToAbsoluteUrls(html, "https://x.com/post/");
	assert.ok(out.includes(`href="https://x.com/a/"`));
	assert.ok(out.includes(`srcset="https://x.com/i-1.png 1x, https://x.com/i-2.png 2x"`));
});

// Under a `base`, the filters pass the site's base: a URL from the site's root gets it once, so
// `absoluteUrl(page.url, site.url)` is on the site whether the address has the path or not.
test("a url from the site's root gets the base once", () => {
	assert.equal(absoluteUrl("/posts/pine/", "https://example.com", "/repo"), "https://example.com/repo/posts/pine/");
	assert.equal(absoluteUrl("/posts/pine/", "https://example.com/repo/", "/repo"), "https://example.com/repo/posts/pine/");
	assert.equal(absoluteUrl("/repo/feed.xml", "https://example.com", "/repo"), "https://example.com/repo/feed.xml");
	assert.equal(absoluteUrl("/repository/", "https://example.com", "/repo"), "https://example.com/repo/repository/");
	assert.equal(absoluteUrl("https://other.example/x", "https://example.com", "/repo"), "https://other.example/x");
	assert.equal(absoluteUrl("//cdn.example.com/x.js", "https://example.com", "/repo"), "https://cdn.example.com/x.js");
	assert.equal(absoluteUrl("/posts/pine/", "https://example.com/repo/"), "https://example.com/posts/pine/", "the named export, without a base, resolves as new URL does");
	assert.equal(htmlToAbsoluteUrls('<a href="/posts/pine/"><img src="/img/p.png" srcset="/img/p.png 1x, /repo/img/p2.png 2x"></a>', "https://example.com", "/repo"), '<a href="https://example.com/repo/posts/pine/"><img src="https://example.com/repo/img/p.png" srcset="https://example.com/repo/img/p.png 1x, https://example.com/repo/img/p2.png 2x"></a>');
});

test("dates are written in UTC", () => {
	const d = new Date(Date.UTC(2026, 2, 14, 1, 2, 3));
	assert.equal(dateToRfc3339(d), "2026-03-14T01:02:03Z");
	assert.equal(dateToRfc822(d), "Sat, 14 Mar 2026 01:02:03 +0000");
	assert.equal(dateToRfc3339("2024-01-05"), "2024-01-05T00:00:00Z");
	assert.throws(() => dateToRfc3339("tomorrow"), /^BuildError: dateToRfc3339: not a date: "tomorrow"$/);
	assert.throws(() => dateToRfc822(undefined), /^BuildError: dateToRfc822: not a date: undefined$/);
	// 0.7 wrote 1970-01-01 for these (a deliberate difference, in CHANGELOG.md).
	assert.throws(() => dateToRfc3339(new Date("2024-13-45")), /^BuildError: dateToRfc3339: not a date: Invalid Date$/);
	assert.throws(() => dateToRfc822(Number.NaN), /^BuildError: dateToRfc822: not a date: NaN$/);
	assert.throws(() => dateToRfc3339(Infinity), /^BuildError: dateToRfc3339: not a date: Infinity$/);
});

test("years before 0 and after 9999 are written as 0.7 wrote them", () => {
	const year = (n: number) => { const d = new Date(0); d.setUTCFullYear(n, 0, 2); return d; };
	assert.equal(dateToRfc3339(year(10000)), "+10000-01-02T00:00:00Z");
	assert.equal(dateToRfc3339(year(-1)), "-0001-01-02T00:00:00Z");
	assert.equal(dateToRfc3339(year(0)), "0000-01-02T00:00:00Z");
	assert.equal(dateToRfc3339(year(12)), "0012-01-02T00:00:00Z");
	assert.equal(dateToRfc822(year(10000)), "Sun, 02 Jan +10000 00:00:00 +0000");
	assert.equal(dateToRfc822(year(-1)), "Sat, 02 Jan -0001 00:00:00 +0000");
});

test("the newest date in a collection", () => {
	const items = [{ date: new Date("2020-01-02") }, { date: "2024-05-06" }, { title: "none" }, null, 3];
	assert.equal(getNewestCollectionItemDate(items)?.toISOString(), "2024-05-06T00:00:00.000Z");
	assert.equal(getNewestCollectionItemDate([]), undefined);
	assert.equal(getNewestCollectionItemDate(undefined), undefined);
});
