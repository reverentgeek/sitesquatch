import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { minify, minifyCss, minifyJson, minifyXml } from "./minify.ts";

const page = "<!DOCTYPE html>\n<html>\n  <head><title> Hi </title></head>\n  <body>\n  <!-- gone -->\n  <p>Hello   <strong>big</strong>\n  world</p>\n  <script defer=\"defer\">\n  var a = 1;\n</script>\n</body></html>\n";

test("minify() gives 0.7's bytes, with its options", () => {
	assert.equal(minify(page), "<!doctype html><html><head><title>Hi</title></head><body><p>Hello <strong>big</strong> world</p><script defer>var a = 1;</script></body></html>");
	assert.equal(minify(page, { removeComments: false, shortDoctype: false, shortenAttributes: false }), "<!DOCTYPE html><html><head><title>Hi</title></head><body><!-- gone --><p>Hello <strong>big</strong> world</p><script defer=\"defer\">var a = 1;</script></body></html>");
	// a11yproject.com (a11y #24) saw `checked="checked"` shortened with the option off, in 0.7.
	assert.equal(minify("<input type=\"checkbox\" checked=\"checked\">", { shortenAttributes: false }), "<input type=\"checkbox\" checked=\"checked\">");
	assert.equal(minify("<p>a  b</p>\n", { collapseWhitespace: false }), "<p>a  b</p>\n");
	// Options are read as true or false, as 0.7 read them.
	assert.equal(minify("<p>a  b</p>\n", { collapseWhitespace: 0 }), "<p>a  b</p>\n");
	assert.equal(minify(42), "42");
	assert.equal(minify("<p>é — ü</p>"), "<p>é — ü</p>");
});

test("minify() names an option it doesn't know", () => {
	assert.throws(() => minify("<p>", { useShortDoctype: true }), { message: "minify(): unknown option \"useShortDoctype\" (options: collapseWhitespace, removeComments, shortDoctype, shortenAttributes)" });
	assert.throws(() => minify("<p>", { removeComment: false }), { message: "minify(): unknown option \"removeComment\" (did you mean \"removeComments\"?) (options: collapseWhitespace, removeComments, shortDoctype, shortenAttributes)" });
});

test("minifyPlugin() minifies HTML pages only, and checks its options", async () => {
	const register = BUILTINS.get("ssqch/minify")!;
	const config = { transforms: [] } as unknown as Config;
	await register(config, { shortDoctype: false });
	const [[name, transform]] = config.transforms;
	assert.equal(name, "minify-html");
	assert.equal(await transform("<!DOCTYPE html>\n<p>a  b</p>", { url: "/", inputPath: "./index.md", outputPath: "/site/_site/index.html" }), "<!DOCTYPE html><p>a b</p>");
	assert.equal(await transform("<feed>\n  <title> a </title>\n</feed>", { url: "/feed.xml", inputPath: "./feed.njk", outputPath: "/site/_site/feed.xml" }), "<feed>\n  <title> a </title>\n</feed>");
	await assert.rejects(async () => register(config, { removeComment: false }), { message: "unknown option \"removeComment\" (did you mean \"removeComments\"?) (options: collapseWhitespace, removeComments, shortDoctype, shortenAttributes, css, xml, json)" });
	await assert.rejects(async () => register(config, { removeComments: "no" }), { message: "removeComments must be true or false" });
	await assert.rejects(async () => register(config, "all" as never), { message: "options must be an object" });
});

// html-minifier's minifyCSS, and feeds and manifests (lit.dev inlines 30-60 KB of CSS a page; v8 C4).
test("minifyPlugin() compresses inline CSS, XML and JSON when asked", async () => {
	const register = BUILTINS.get("ssqch/minify")!;
	const config = { transforms: [], root: "/site" } as unknown as Config;
	await register(config, { css: true, xml: true, json: true });
	const [[, transform]] = config.transforms;
	const at = (outputPath: string) => ({ url: "/", inputPath: "./x", outputPath });
	assert.equal(await transform("<style>\n  .a { color: #ffffff; }\n</style><style type=\"text/x-template\"> a { } </style><p>x</p>", at("/site/_site/index.html")), "<style>.a{color:#fff}</style><style type=\"text/x-template\">a { }</style><p>x</p>");
	assert.equal(await transform("<feed>\n  <title> a </title>\n  <content><![CDATA[ <p>x</p>\n y ]]></content>\n</feed>\n", at("/site/_site/feed.xml")), "<feed><title> a </title><content><![CDATA[ <p>x</p>\n y ]]></content></feed>\n");
	assert.equal(await transform("{\n  \"name\": \"Trail\",\n  \"icons\": [ 1, 2 ]\n}\n", at("/site/_site/site.webmanifest")), "{\"name\":\"Trail\",\"icons\":[1,2]}\n");
	// Off by default.
	const plain = { transforms: [], root: "/site" } as unknown as Config;
	await register(plain, {});
	assert.equal(await plain.transforms[0][1]("<style> .a { b: c } </style>", at("/site/_site/index.html")), "<style>.a { b: c }</style>");
	assert.equal(minifyCss(".a {\n  margin: 0 auto;\n}\n"), ".a{margin:0 auto}");
	assert.throws(() => minifyCss(".a { $x: 1; }"), /minifyCss\(\): /);
	assert.equal(minifyXml("<a>\n <b>Hi <![CDATA[x]]></b>\n</a>"), "<a><b>Hi <![CDATA[x]]></b></a>");
	assert.equal(minifyJson("not json"), "not json");
});
