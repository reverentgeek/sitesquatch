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

test("dates are written in UTC", () => {
	const d = new Date(Date.UTC(2026, 2, 14, 1, 2, 3));
	assert.equal(dateToRfc3339(d), "2026-03-14T01:02:03Z");
	assert.equal(dateToRfc822(d), "Sat, 14 Mar 2026 01:02:03 +0000");
	assert.equal(dateToRfc3339("2024-01-05"), "2024-01-05T00:00:00Z");
	assert.throws(() => dateToRfc3339("tomorrow"), /^BuildError: dateToRfc3339: not a date: "tomorrow"$/);
	assert.throws(() => dateToRfc822(undefined), /^BuildError: dateToRfc822: not a date: undefined$/);
});

test("the newest date in a collection", () => {
	const items = [{ date: new Date("2020-01-02") }, { date: "2024-05-06" }, { title: "none" }, null, 3];
	assert.equal(getNewestCollectionItemDate(items)?.toISOString(), "2024-05-06T00:00:00.000Z");
	assert.equal(getNewestCollectionItemDate([]), undefined);
	assert.equal(getNewestCollectionItemDate(undefined), undefined);
});
