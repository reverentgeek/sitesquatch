// What the dev server answers (crates/sitesquatch/src/serve.rs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentType, icon, inside, linksAnIcon, mounted, notFoundPage, pageFile, pageUrls, percentDecode, prefersMarkdown, queryValue } from "./http.ts";

function tempDir(name: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `ssqch-${name}-`));
}

/** Removes a test's folder. On Windows a process that's ending can hold a file a moment longer: tried again, then left for the system to clear. */
function remove(dir: string): void {
	try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* left in the temporary folder */ }
}

function write(dir: string, rel: string, text: string): void {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
}

test("request_paths_stay_inside_the_output", () => {
	for (const ok of ["", "about/", "posts/pine/index.html", "my file.pdf", "a..b/c", "a/./b"]) assert.ok(inside(ok), ok);
	// `/%2Fetc/hosts` decodes to a second leading slash, which would replace the folder.
	for (const bad of ["/etc/hosts", "../secret", "a/../../b", "./x", "..\\..\\x", "C:\\Windows", "a\0b"]) assert.ok(!inside(bad), bad);
	assert.equal(percentDecode("/%2Fetc/hosts").replace(/^\/+/, ""), "etc/hosts");
	assert.equal(percentDecode("/caf%C3%A9/%zz/100%"), "/café/%zz/100%");
	// Bytes that aren't UTF-8 don't stop the server.
	assert.equal(percentDecode("/%ff/"), "/\ufffd/");
});

test("a_base_mounts_the_site_under_its_path", () => {
	const at = (url: string, base: string) => {
		const found = mounted(url, base);
		return found === "outside" ? "outside" : "path" in found ? `path ${found.path}` : `redirect ${found.redirect}`;
	};
	assert.equal(at("/about/", ""), "path /about/");
	assert.equal(at("/repo/about/", "/repo"), "path /about/");
	assert.equal(at("/repo/", "/repo"), "path /");
	assert.equal(at("/repo", "/repo"), "redirect /repo/");
	assert.equal(at("/", "/repo"), "redirect /repo/");
	assert.equal(at("/about/", "/repo"), "outside");
	assert.equal(at("/repository/", "/repo"), "outside");
});

test("a_missing_page_names_the_closest_one", () => {
	const dir = tempDir("serve-404");
	try {
		write(dir, "contact/index.html", "<p>Hi</p>");
		write(dir, "index.html", "<p>Home</p>");
		write(dir, "feed.xml", "<feed/>");
		assert.deepEqual(pageUrls(dir).sort(), ["/", "/contact/"]);

		let page = notFoundPage(dir, "/contactt/", "/repo");
		assert.ok(page.includes("The trail goes cold at <code>/contactt/</code>"), page);
		assert.ok(page.includes("Did you mean <a href=\"/repo/contact/\">/contact/</a>?"), page);
		assert.ok(page.includes("<a href=\"/repo/\">Back to the trailhead</a>"), page);
		// Nothing close: no guess. And the URL is escaped.
		page = notFoundPage(dir, "/<script>alert(1)</script>/", "");
		assert.ok(!page.includes("Did you mean"), page);
		assert.ok(!page.includes("<script>alert"), page);
		assert.ok(page.includes("<a href=\"/\">Back to the trailhead</a>"), page);
		// A URL with the page's own placeholders in it stays as it was typed.
		page = notFoundPage(dir, "/{{home}}/", "");
		assert.ok(page.includes("<code>/{{home}}/</code>"), page);
	} finally {
		remove(dir);
	}
});

test("a_page_with_an_icon_keeps_it", () => {
	assert.ok(linksAnIcon("<head><link rel=\"icon\" href=\"/i.png\"></head>"));
	assert.ok(linksAnIcon("<LINK href=\"/i.ico\" REL='shortcut icon'>"));
	assert.ok(linksAnIcon("<link rel=apple-touch-icon href=/a.png>"));
	assert.ok(!linksAnIcon("<link rel=\"stylesheet\" href=\"/icons.css\"><p>icon</p>"));
});

test("a_browsers_questions_are_read", () => {
	assert.equal(pageFile("/repo/about/", "/repo"), "about/index.html");
	assert.equal(pageFile("/", ""), "index.html");
	assert.equal(pageFile("/notes.html", ""), "notes.html");
	assert.equal(queryValue("v=3&p=%2Fabout%2F", "p"), "/about/");
	assert.equal(queryValue("v=&p=%2F", "v"), "");
	assert.equal(queryValue("p=%2F", "v"), undefined);
	assert.equal(contentType("a/site.css"), "text/css; charset=utf-8");
	assert.equal(contentType("a/app.mjs"), "text/javascript; charset=utf-8");
	assert.equal(contentType("a/photo.JPG"), "application/octet-stream");
});

// Added in 0.13: a request that asks for Markdown by name gets a page's copy.
test("a_request_that_prefers_markdown_by_name_gets_it", () => {
	for (const yes of ["text/markdown", "text/markdown, text/html;q=0.9", "text/markdown, text/html", "text/html;q=0.5, text/markdown;q=0.8", "TEXT/MARKDOWN; charset=utf-8", "text/markdown, */*"]) assert.ok(prefersMarkdown(yes), yes);
	// A browser's, curl's, and a request that ranks HTML higher or turns Markdown off.
	for (const no of [undefined, "", "*/*", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "text/html, text/markdown;q=0.5", "text/markdown;q=0", "text/*"]) assert.ok(!prefersMarkdown(no), String(no));
	assert.equal(contentType("guide/index.md"), "text/markdown; charset=utf-8");
});

// The tab icon for a site without one is sitesquatch.dev's, so a new site's tab looks like the
// site's (it was the hand-drawn stand-in after the site's changed in ba21477).
test("the tab icon is sitesquatch.dev's (copy site/src/favicon.svg into tab-icon.ts after it changes)", () => {
	const site = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "..", "..", "site", "src", "favicon.svg"), "utf8").trimEnd();
	assert.equal(icon(false), site);
	assert.equal(icon(true), site.replace("fill=\"#233b2b\"", "fill=\"#a23e20\""));
	assert.notEqual(icon(true), site);
});

// The 404 page's patch has the same drawing, in pine on its stripes, placed as the site's trail
// patch places it.
test("the 404 page's patch is the illustrated footprint", () => {
	const page = notFoundPage(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-patch-")), "/nope/", "");
	const drawing = /<g fill="#fff3d6" transform="[^"]*">([\s\S]*)<\/g><\/svg>$/.exec(icon(false))?.[1];
	assert.ok(drawing && drawing.length > 1000);
	assert.ok(page.includes(`<g fill="#233b2b" transform="rotate(14 100 100) translate(100 100) scale(0.2272) translate(-186.5 -290.5)">${drawing}</g></svg>`), page);
	assert.ok(page.includes("#e8af43") && page.includes("#a9b66a"), page);
});
