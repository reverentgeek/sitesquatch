// The link checker's readers, from the unit tests in plugins/links (0.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inSite, originOf, redirected, resolve, scanHtml, scanXml, stripOrigin, unescapeXml } from "./links.ts";

test("links resolve relative to the page", () => {
	const r = (link: string) => resolve("/posts/pine/", link);
	assert.deepEqual(r("/about/"), ["/about/", undefined]);
	assert.deepEqual(r("../brittle/#top"), ["/posts/brittle/", "top"]);
	assert.deepEqual(r("photo.jpg?v=2"), ["/posts/pine/photo.jpg", undefined]);
	assert.deepEqual(r("#comments"), ["", "comments"]);
	assert.deepEqual(r("/my%20file.pdf"), ["/my file.pdf", undefined]);
	for (const external of ["https://example.com/", "mailto:a@b.c", "//cdn.example.com/x.js", "data:image/png;base64,xx", "tel:123", "#", ""]) {
		assert.equal(r(external), undefined, external);
	}
	assert.deepEqual(resolve("/feed.xml", "style.css"), ["/style.css", undefined]);
});

test("a base is taken off links before checking", () => {
	assert.equal(inSite("/repo/about/", "/repo"), "/about/");
	assert.equal(inSite("/repo", "/repo"), "/");
	assert.equal(inSite("/repo#top", "/repo"), "#top");
	assert.equal(inSite("/other/", "/repo"), undefined);
	assert.equal(inSite("/repository/", "/repo"), undefined);
	assert.equal(inSite("next/", "/repo"), "next/");
	assert.equal(inSite("//cdn.example.com/x.js", "/repo"), "//cdn.example.com/x.js");
	assert.equal(inSite("/about/", ""), "/about/");
});

test("ids and links are scanned from a page", () => {
	const page = scanHtml(`<h2 id="one">x</h2><a name="two"></a><a href="/a/">a</a><link rel="preconnect" href="https://fonts.example"><link rel="stylesheet" href="/s.css"><img src="/i.png" srcset="/i-300.webp 300w, /i-600.webp 600w">`);
	assert.deepEqual([...page.ids], ["one", "two"]);
	assert.deepEqual(page.links, ["/a/", "/s.css", "/i.png", "/i-300.webp", "/i-600.webp"]);
});

test("urls outside attributes are scanned", () => {
	const page = scanHtml(`<head><meta property="og:image" content="https://example.com/img/a.png"><meta name="twitter:image" content="/img/b.png"><meta name="description" content="/not a url"><meta property="og:title" content="/slash/"><link rel="preload" as="image" imagesrcset="/img/c-300.avif 300w, /img/c-600.avif 600w"><script type="application/ld+json">{"@context":"https://schema.org","logo":{"url":"https://example.com/content/logo.png"},"@id":"https://example.com/#org","name":"A / B"}</script></head>`);
	assert.deepEqual(page.links, ["/img/c-300.avif", "/img/c-600.avif"]);
	assert.deepEqual(page.siteLinks, ["https://example.com/img/a.png", "/img/b.png"]);
	assert.deepEqual(page.sitePaths, ["https://schema.org", "https://example.com/content/logo.png", "https://example.com/#org"]);
});

test("feeds and their escaped HTML are scanned", () => {
	const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><link href="https://example.com/feed.xml" rel="self"/><entry><id>https://example.com/posts/a/</id><content type="html">&lt;p&gt;&lt;img src=&quot;https://example.com/content/images/a.png&quot; srcset=&quot;/i-1.png 1x, /i-2.png 2x&quot;&gt; &lt;a href=&quot;/x/?a=1&amp;amp;b=2&quot;&gt;x&lt;/a&gt;&lt;/p&gt;</content></entry><item><description><![CDATA[<a href="/cdata/">c</a>]]></description></item></feed>`;
	assert.deepEqual(scanXml(feed).sort(), ["/cdata/", "/i-1.png", "/i-2.png", "/x/?a=1&b=2", "https://example.com/content/images/a.png", "https://example.com/feed.xml", "https://example.com/posts/a/"]);
	assert.equal(unescapeXml("a &amp;lt; &#39;b&#x27; &bogus; &"), "a &lt; 'b' &bogus; &");
});

test("a path in a feed's code is an example, not a link", () => {
	const feed = `<feed><entry><id>/posts/a/</id><content type="html">&lt;p&gt;&lt;code&gt;/snacks/*&lt;/code&gt; and &lt;kbd&gt;/help&lt;/kbd&gt;&lt;/p&gt;&lt;pre class=&quot;x&quot;&gt;&lt;code&gt;/etc/hosts&lt;/code&gt;&lt;/pre&gt;&lt;pre&gt;&lt;a href=&quot;/real/&quot;&gt;r&lt;/a&gt;&lt;/pre&gt;</content></entry></feed>`;
	assert.deepEqual(scanXml(feed).sort(), ["/posts/a/", "/real/"]);
	// A custom element named like one isn't code.
	assert.deepEqual(scanXml(`<feed><content type="html">&lt;code-block&gt;&lt;/code-block&gt;&lt;p&gt;/one/&lt;/p&gt;&lt;code&gt;x&lt;/code&gt;</content></feed>`), ["/one/"]);
});

test("absolute links on the site are its paths", () => {
	assert.equal(originOf("https://Example.com/blog/"), "https://example.com");
	assert.equal(originOf("example.com"), undefined);
	const o = "https://example.com";
	assert.equal(stripOrigin("https://example.com/about/", o), "/about/");
	assert.equal(stripOrigin("http://EXAMPLE.com", o), "/");
	assert.equal(stripOrigin("https://example.com#top", o), "#top");
	assert.equal(stripOrigin("https://example.com.evil/x", o), undefined);
	assert.equal(stripOrigin("https://other.com/x", o), undefined);
	assert.equal(stripOrigin("/about/", o), undefined);
});

test("redirect rules cover their sources", () => {
	const sources = ["/old-post", "/archive/*"];
	assert.ok(redirected(sources, "/old-post/"));
	assert.ok(redirected(sources, "/archive/2019/"));
	assert.ok(!redirected(sources, "/new-post/"));
});

test("a redirect with placeholders covers each segment they stand for", () => {
	const sources = ["/news/:year/:slug/", "/trails/:name/*"];
	assert.ok(redirected(sources, "/news/2019/pine-cones/"));
	assert.ok(redirected(sources, "/news/2019/pine-cones"));
	assert.ok(!redirected(sources, "/news/2019/"));
	assert.ok(!redirected(sources, "/news/2019/pine-cones/photos/"));
	assert.ok(!redirected(sources, "/news//pine-cones/"));
	assert.ok(redirected(sources, "/trails/cedar/map/"));
	assert.ok(redirected(sources, "/trails/cedar/"));
	assert.ok(!redirected(sources, "/trail/cedar/map/"));
});
