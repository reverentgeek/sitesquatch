// From crates/ssqch/tests/plugins.rs: configs that use the built-in plugin modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ssqch, project, read, tempDir, write, FIXTURES } from "../lib/ssqch.js";

const PNG = fs.readFileSync(path.join(FIXTURES, "cli/squatch.png"));

/** `ssqch build --root <root>` plus `args`: `{ ok, log }`. */
function build(root, args = []) {
	return ssqch(["build", "--root", root, ...args]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIG = `
import { defineConfig } from "ssqch";
import { imagePlugin } from "ssqch/image";
import { rssPlugin, absoluteUrl } from "ssqch/rss";
import { minifyPlugin } from "ssqch/minify";

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
  filters: { abs: (url) => absoluteUrl(url, "https://example.com/blog/") },
  plugins: [
    // Listed before the image plugin, but minifying still runs after images.
    env === "production" && minifyPlugin(),
    imagePlugin({ formats: ["webp", "auto"], widths: [16, 32], defaultAttributes: { loading: "lazy" }, webpQuality: 80 }),
    rssPlugin(),
  ],
}));
`;

const HERO = `
import { image } from "ssqch/image";
export default async function () {
  const derivatives = await image("src/img/squatch.png", { widths: [24, "auto"], formats: ["webp", "png"] });
  return { formats: Object.keys(derivatives), png: derivatives.png.map((e) => \`\${e.width}x\${e.height} \${e.sourceType} \${e.url.startsWith("/img/")} \${e.size > 0}\`) };
}
`;

const PAGE = "---\ndate: 2026-03-14\n---\n<!-- a comment -->\n<p>\n  <img src=\"/img/squatch.png\" alt=\"Squatch\">\n  <img src=\"/img/squatch.png\" alt=\"Small\" ssqch:widths=\"16\">\n  <img src=\"/img/squatch.png\" alt=\"Plain\" ssqch:ignore>\n</p>\n<p>{{ hero.formats.join(',') }} | {{ hero.png.join(' / ') }}</p>\n<p>{{ abs('#top') }} {{ abs('https://example.com') }} {{ dateToRfc3339(page.date) }}</p>\n";

test("the_built_in_plugins_work_together", () => {
	const root = project({
		"ssqch.config.js": CONFIG,
		"src/_data/hero.js": HERO,
		"src/img/squatch.png": PNG,
		"src/index.edge": PAGE,
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");

	// The image transform ran before minifying, and its markup was minified with the rest.
	assert.ok(!html.includes("a comment") && !html.includes("\n"), html);
	assert.ok(html.includes("<picture><source type=\"image/webp\" srcset=\"/img/"), html);
	assert.ok(html.includes("-16.webp 16w,/img/") && html.includes("-32.webp 32w"), html);
	assert.ok(html.includes("loading=\"lazy\"") && html.includes("width=\"32\" height=\"16\""), html);

	// Per-image attributes: ssqch:widths picks the widths, ssqch:ignore leaves the tag alone.
	assert.ok(html.includes("alt=\"Small\""), html);
	assert.ok(html.includes("<img src=\"/img/squatch.png\" alt=\"Plain\">"), html);
	assert.ok(!html.includes("ssqch:"), `ssqch: attributes are removed from the output: ${html}`);

	// image() in a data file shares the plugin's processor.
	assert.ok(html.includes("webp,png | 24x12 image/png true true / 64x32 image/png true true"), html);

	// RSS plugin filters and the named absoluteUrl export (WHATWG URL rules).
	assert.ok(html.includes("https://example.com/blog/#top https://example.com/ 2026-03-14T00:00:00Z"), html);

	// A line per page written and per image encoded.
	assert.ok(log.includes("[ssqch] Writing ./dist/index.html from ./src/index.edge (edge)"), log);
	assert.ok(log.includes("[ssqch] Encoded ./src/img/squatch.png into "), log);
	assert.ok(!log.includes("warn"), log);

	// The summary at the end: every image file is new on the first build, and reused on the next.
	assert.ok(log.includes("Built in ") && log.includes(" (production)\n"), log);
	assert.ok(log.includes("  Pages   1 written from 1 template, "), log);
	assert.ok(log.includes("  Images  8 files from 1 source, ") && log.includes(": 8 encoded, 0 reused"), log);
	assert.ok(log.includes("  Output  dist: 9 files, "), log);
	assert.ok(log.includes("  Time    setup ") && log.includes(", write "), log);
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.ok(log.includes(": 0 encoded, 8 reused"), log);
});

test("bad_plugin_options_fail_clearly", () => {
	const cases = [
		[
			"ssqch.config.js",
			"import { imagePlugin } from \"ssqch/image\"; export default { plugins: [imagePlugin({ sharpWebpOptions: { quality: 80 } })] };",
			"plugin \"ssqch/image\": unknown option \"sharpWebpOptions\" (options: formats, widths",
		],
		[
			"src/_data/hero.js",
			"import { image } from \"ssqch/image\"; export default () => image(\"src/img/squatch.png\", { outputDir: \"./public/images\" });",
			"image(): unknown option \"outputDir\" (options: widths, formats, name; encoder settings go on imagePlugin())",
		],
		["src/_data/hero.js", "import { image } from \"ssqch/image\"; export default () => image(\"https://example.com/a.png\");", "image(): remote images aren't supported"],
		["src/_data/hero.js", "import { minify } from \"ssqch/minify\"; export default () => minify(\"<p>\", { useShortDoctype: true });", "minify(): unknown option \"useShortDoctype\""],
		// Nearly right: what it probably meant.
		["src/_data/hero.js", "import { minify } from \"ssqch/minify\"; export default () => minify(\"<p>\", { removeComment: false });", "minify(): unknown option \"removeComment\" (did you mean \"removeComments\"?)"],
		["src/_data/hero.js", "import { image } from \"ssqch/image\"; export default () => image(\"src/img/squatch.png\", { width: [100], formats: [\"webpp\"] });", "image(): unknown option \"width\" (did you mean \"widths\"?)"],
	];
	for (const [file, source, want] of cases) {
		const files = { "src/img/squatch.png": PNG, "src/index.edge": "{{ hero }}" };
		if (file !== "ssqch.config.js") files["ssqch.config.js"] = "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\"], markdownEngine: \"edge\" };";
		files[file] = source;
		const root = project(files);
		const { ok, log } = build(root);
		assert.ok(!ok, `expected a failure for ${want}`);
		assert.ok(log.includes(want), `wanted: ${want}\n  got: ${log}`);
	}
});

const ASSETS_CONFIG = `
import { assetsPlugin } from "ssqch/assets";
export default {
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
  plugins: [assetsPlugin({ files: ["/assets/index.css", "/assets/index.js"] })],
};
`;

const ASSETS_PAGE = "<link rel=\"stylesheet\" href=\"/assets/index.css\"><link rel=\"preload\" href=\"/assets/index.js?v=2\" as=\"script\"><script src=\"/assets/index.js\" defer></script><p>{{ assetUrl('/assets/index.css') }}</p>";

test("assets_are_fingerprinted_in_production_builds", () => {
	// The CSS and JS tools write into the output folder before ssqch runs.
	const root = project({
		"ssqch.config.js": ASSETS_CONFIG,
		"src/index.edge": ASSETS_PAGE,
		"dist/assets/index.css": "body { color: green }",
		"dist/assets/index.js": "console.log('squatch');",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	const css = fs.readdirSync(path.join(root, "dist/assets")).find((n) => n.endsWith(".css"));
	assert.ok(css.length === "index.12345678.css".length && css.startsWith("index.") && css !== "index.css", css);
	assert.ok(!fs.existsSync(path.join(root, "dist/assets/index.css")) && !fs.existsSync(path.join(root, "dist/assets/index.js")), "plain files are renamed");
	assert.ok(html.includes(`href="/assets/${css}"`), html);
	assert.ok(html.includes(`<p>/assets/${css}</p>`), `assetUrl() returns the fingerprinted URL: ${html}`);
	assert.ok(html.includes(".js?v=2\"") && !html.includes("\"/assets/index.js"), `every reference to index.js is rewritten, keeping the query: ${html}`);
	assert.ok(log.includes("  Assets  2 fingerprinted (index."), log);

	// A second build without rebuilding the CSS and JS reuses the fingerprinted files.
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.equal(read(root, "dist/index.html"), html);
});

test("development_builds_use_the_plain_paths", () => {
	const root = project({
		"ssqch.config.js": ASSETS_CONFIG,
		"src/index.edge": ASSETS_PAGE,
		"dist/assets/index.css": "body { color: green }",
		"dist/assets/index.js": "console.log('squatch');",
	});
	const { ok, log } = build(root, ["--env", "development"]);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	assert.ok(html.includes("href=\"/assets/index.css\"") && html.includes("<p>/assets/index.css</p>"), html);
	assert.ok(fs.existsSync(path.join(root, "dist/assets/index.css")), "nothing is renamed");
	assert.ok(!log.includes("Assets"), log);
});

test("a_missing_asset_fails_a_production_build", () => {
	const root = project({ "ssqch.config.js": ASSETS_CONFIG, "src/index.edge": ASSETS_PAGE, "dist/assets/index.css": "body {}" });
	const { ok, log } = build(root);
	assert.ok(!ok);
	assert.ok(log.includes("index.js doesn't exist; build the CSS and JS before ssqch"), log);
});

const LINKS_CONFIG = `
import { linksPlugin } from "ssqch/links";
export default {
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
  plugins: [linksPlugin({ ignore: ["/downloads/"] })],
};
`;

function linksSite(index) {
	return project({
		"ssqch.config.js": LINKS_CONFIG,
		"src/index.edge": index,
		"src/about.edge": "---\npermalink: /about/\n---\n<h2 id=\"team\">Team</h2><h2 id=\"tl%3Bdr\">tl;dr</h2><h2 id=\"café\">Café</h2>",
		"src/feed.xml": "<feed/>",
		"src/_redirects": "/old-post /about/ 301\n/archive/* /about/ 301\n",
	});
}

test("the_link_checker_passes_a_clean_site", () => {
	const root = linksSite(
		"<h1 id=\"top\">Hi</h1><a href=\"/about/\">about</a><a href=\"/about/#team\">team</a><a href=\"/about/#tl%3Bdr\">as written</a><a href=\"/about/#caf%C3%A9\">decoded</a><a href=\"about/\">relative</a><a href=\"#top\">top</a><a href=\"/feed.xml\">feed</a><a href=\"/old-post\">redirected</a><a href=\"/archive/2019/\">archived</a><a href=\"/downloads/missing.zip\">ignored</a><a href=\"https://example.com/nope\">external</a><a href=\"mailto:squatch@example.com\">mail</a>",
	);
	fs.writeFileSync(path.join(root, "src/_redirects"), "/old-post /about/ 301\n/archive/* /about/ 301\n");
	const config = LINKS_CONFIG.replace("  templateFormats: [\"edge\", \"md\"],", "  templateFormats: [\"edge\"],\n  passthrough: [\"src/_redirects\", \"src/feed.xml\"],");
	fs.writeFileSync(path.join(root, "ssqch.config.js"), config);
	const { ok, log } = build(root);
	assert.ok(ok, log);
	assert.ok(log.includes("  Links   "), log);
	assert.ok(log.includes("checked, 0 broken"), log);
});

test("broken_links_fail_a_production_build_and_warn_in_development", () => {
	const root = linksSite("<a href=\"/abuot/\">typo</a><a href=\"/about/#tema\">anchor</a><a href=\"#nowhere\">here</a><img src=\"/img/missing.png\" alt=\"\">");
	let { ok, log } = build(root);
	assert.ok(!ok, log);
	assert.ok(log.includes("4 broken links:"), log);
	assert.ok(log.includes("/ -> /abuot/ (not found; did you mean /about/?)"), log);
	assert.ok(log.includes("/ -> /about/#tema (no id \"tema\" on that page; did you mean #team?)"), log);
	assert.ok(log.includes("/ -> #nowhere (no id \"nowhere\" on this page)"), log);
	assert.ok(log.includes("/ -> /img/missing.png (not found)"), log);

	({ ok, log } = build(root, ["--env", "development"]));
	assert.ok(ok, log);
	assert.ok(log.includes("warn: the trail goes cold on 4 broken links:") && log.includes("checked, 4 broken"), log);
});

function linkedImagesSite(options) {
	const config = `import { imagePlugin } from "ssqch/image";\nexport default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge", "md"], markdownEngine: "edge", plugins: [imagePlugin({ formats: ["webp", "auto"], widths: [16, 48]${options} })] };`;
	const page = "<a href=\"/img/squatch.png\"><img src=\"/img/squatch.png\" width=\"16\" alt=\"Squatch\"></a>\n<a href=\"img/squatch.png\" ssqch:ignore>raw</a>\n<a href=\"/about/\">about</a>\n<a href=\"/img/missing.png\">missing</a>";
	return project({ "ssqch.config.js": config, "src/img/squatch.png": PNG, "src/index.edge": page });
}

test("links_to_images_point_at_a_generated_copy", () => {
	const root = linkedImagesSite("");
	const { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	const first = html.split("\n")[0];
	// The source is 64 px wide; the largest configured width is 48, so the link gets a 48 px PNG.
	const href = first.split("href=\"")[1].split("\"")[0];
	assert.ok(href.startsWith("/img/") && href.endsWith("-48.png"), first);
	assert.ok(fs.statSync(path.join(root, "dist", href.replace(/^\//, "")), { throwIfNoEntry: false })?.isFile(), `${href} exists`);
	assert.ok(first.includes("<picture>"), `the image inside is still a <picture>: ${first}`);
	assert.ok(html.includes("<a href=\"img/squatch.png\">raw</a>"), `ssqch:ignore keeps the link (and is removed): ${html}`);
	assert.ok(html.includes("<a href=\"/about/\">about</a>"), `links to pages are left alone: ${html}`);
	assert.ok(html.includes("<a href=\"/img/missing.png\">") && log.includes("linked image not found: /img/missing.png"), `${html}\n${log}`);
});

test("linked_images_can_be_turned_off", () => {
	const root = linkedImagesSite(", linkedImages: false");
	const { ok, log } = build(root);
	assert.ok(ok, log);
	assert.ok(read(root, "dist/index.html").startsWith("<a href=\"/img/squatch.png\">"), read(root, "dist/index.html"));
});

/** A PNG of noise (it doesn't compress away, so a third of it ends inside the image data), made without an image library. */
function noisePng(width, height) {
	const chunk = (type, data) => {
		const named = Buffer.concat([Buffer.from(type, "latin1"), data]);
		const out = Buffer.alloc(named.length + 8);
		out.writeUInt32BE(data.length, 0);
		named.copy(out, 4);
		out.writeUInt32BE(zlib.crc32(named) >>> 0, named.length + 4);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	// Each row: filter 0, then its pixels.
	const rows = Buffer.alloc(height * (1 + width * 3));
	let s = 76;
	for (let i = 0; i < rows.length; i++) if (i % (1 + width * 3)) rows[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 23;
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// An image that can't be decoded is a warning, and the tags that name it stay as they were
// written: no markup points at files that weren't made, and the summary counts what was.
// `imageUrl()` of it is the page's error, with the decoder's words and not an encoder's.
test("an_image_that_cant_be_decoded_is_left_as_written", () => {
	const whole = noisePng(120, 80);
	const root = project({
		"ssqch.config.js": `import { imagePlugin } from "ssqch/image";\nexport default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge", "html"], htmlEngine: "edge", plugins: [imagePlugin({ formats: ["webp"], widths: [60] })] };`,
		"src/pics/t.png": whole.subarray(0, Math.floor(whole.length / 3)),
		"src/pics/ok.png": whole,
		"src/index.html": "<p><img src=\"/pics/t.png\" alt=\"t\"><a href=\"/pics/t.png\">big</a> <img src=\"/pics/ok.png\" alt=\"ok\"></p>\n",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	assert.ok(html.startsWith("<p><img src=\"/pics/t.png\" alt=\"t\"><a href=\"/pics/t.png\">big</a> <img "), html);
	assert.ok(log.includes(`warn: decoding `) && log.includes(`pics/t.png: unexpected end of file\n`), log);
	assert.ok(!/vips|\.tmp/.test(log), log);
	assert.ok(log.includes("  Images  1 file from 1 source, ") && log.includes(": 1 encoded, 0 reused"), log);
	assert.equal(fs.readdirSync(path.join(root, "dist/img")).length, 1);

	fs.writeFileSync(path.join(root, "src/meta.edge"), "---\npermalink: /meta/\n---\n<meta property=\"og:image\" content=\"{{ imageUrl('/pics/t.png', { width: 60 }).url }}\">\n");
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("meta.edge") && log.includes("pics/t.png: unexpected end of file") && !/vips|\.tmp|\.cache/.test(log), log);
});

test("sitemap_and_redirects", () => {
	const root = project({
		"ssqch.config.js": `
import { sitemapPlugin } from "ssqch/sitemap";
import { redirectsPlugin } from "ssqch/redirects";
import { linksPlugin } from "ssqch/links";
export default {
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md", "txt"],
  markdownEngine: "edge",
  plugins: [
    sitemapPlugin({ url: "https://example.com/", exclude: ["/tags/**"] }),
    redirectsPlugin({ netlify: true, redirects: { "/feed/": "/feed.xml", "/elsewhere": "https://other.example/" } }),
    linksPlugin(),
  ],
};
`,
		"src/index.md": "---\ndate: 2024-01-02\n---\nHome, see [the post](/2019/pine/).",
		"src/posts/pine.md": "---\ndate: 2024-03-04\naliases: [/2019/pine/, /pine.html]\n---\nPine",
		"src/secret.md": "---\nsitemap: false\n---\nshh",
		"src/tags/x.md": "tag page",
		"src/404.md": "---\npermalink: /404.html\n---\nnope",
		"src/feed.edge": "---\npermalink: /feed.xml\n---\n<rss/>",
		"src/redirects.txt": "---\npermalink: /_redirects\n---\n/mine  /  302",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const sitemap = read(root, "dist/sitemap.xml");
	assert.ok(sitemap.includes("<loc>https://example.com/</loc>\n    <lastmod>2024-01-02</lastmod>"), sitemap);
	assert.ok(sitemap.includes("<loc>https://example.com/posts/pine/</loc>\n    <lastmod>2024-03-04</lastmod>"), sitemap);
	for (const leftOut of ["secret", "tags", "404", "feed", "2019"]) {
		assert.ok(!sitemap.includes(leftOut), `${leftOut} in ${sitemap}`);
	}
	const page = read(root, "dist/2019/pine/index.html");
	assert.ok(page.includes("<meta http-equiv=\"refresh\" content=\"0; url=/posts/pine/\">") && page.includes("<link rel=\"canonical\" href=\"/posts/pine/\">"), page);
	assert.ok(read(root, "dist/pine.html").includes("url=/posts/pine/"));
	assert.ok(read(root, "dist/elsewhere/index.html").includes("url=https://other.example/"));
	assert.equal(
		read(root, "dist/_redirects"),
		"/mine  /  302\n/2019/pine/  /posts/pine/  301\n/elsewhere  https://other.example/  301\n/feed/  /feed.xml  301\n/pine.html  /posts/pine/  301\n",
	);
	// A second build doesn't add the lines twice.
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.equal(read(root, "dist/_redirects").split("/pine.html").length - 1, 1);

	// An alias that's another page's URL.
	fs.writeFileSync(path.join(root, "src/secret.md"), "---\nsitemap: false\naliases: /posts/pine/\n---\nshh");
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("./src/secret.md: /posts/pine/ is the URL of src/posts/pine.md"), log);
	fs.writeFileSync(path.join(root, "ssqch.config.js"), "import { sitemapPlugin } from \"ssqch/sitemap\";\nexport default { plugins: [sitemapPlugin({ url: \"example.com\" })] };");
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("url must be the site's address, like \"https://example.com\""), log);
});

test("assets_get_integrity_hashes", () => {
	const root = project({
		"ssqch.config.js": "import { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [assetsPlugin({ files: [\"/app.css\"], integrity: true })] };",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/app.css\">",
		"dist/app.css": "abc",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	assert.ok(html.includes("integrity=\"sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn\""), html);
	// Not without fingerprinting (ssqch serve), where a watcher may rewrite the file.
	fs.writeFileSync(path.join(root, "dist/app.css"), "abc");
	({ ok, log } = build(root, ["--env", "development"]));
	assert.ok(ok, log);
	assert.ok(!read(root, "dist/index.html").includes("integrity"));
});

test("sass_compiles_folders_and_files", () => {
	const root = project({
		"ssqch.config.js": "import { sassPlugin } from \"ssqch/sass\";\nimport { linksPlugin } from \"ssqch/links\";\nimport { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [sassPlugin({ files: { \"styles\": \"/css\", \"print.sass\": \"/print.css\" } }), assetsPlugin({ files: [\"/css/app.css\"] }), linksPlugin()] };",
		"styles/app.scss": "@use \"colors\";\nbody { color: colors.$pine; a { color: red; } }\n",
		"styles/_colors.scss": "$pine: #01796f;\n",
		"styles/pages/blog.scss": ".post { margin: 0 auto; }\n",
		"print.sass": "body\n  font-size: 12pt\n",
		"src/index.html": "<link rel=\"stylesheet\" href=\"/css/app.css\"><link rel=\"stylesheet\" href=\"/css/pages/blog.css\"><link rel=\"stylesheet\" href=\"/print.css\">",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	assert.ok(log.includes("Sass    3 files (compressed)"), log);
	assert.ok(log.includes("Links   3 checked, 0 broken"), log);
	// The assets plugin fingerprinted the compiled CSS.
	const html = read(root, "dist/index.html");
	const app = html.split("\"").find((s) => s.startsWith("/css/app.") && s.endsWith(".css"));
	assert.ok(app, html);
	assert.equal(read(root, `dist${app}`), "body{color:#01796f}body a{color:red}");
	assert.equal(read(root, "dist/css/pages/blog.css"), ".post{margin:0 auto}");
	assert.equal(read(root, "dist/print.css"), "body{font-size:12pt}");
	assert.ok(!fs.existsSync(path.join(root, "dist/css/_colors.css")));

	// Expanded in development, and a mistake names the file.
	({ ok, log } = build(root, ["--env", "development"]));
	assert.ok(ok, log);
	assert.ok(read(root, "dist/css/pages/blog.css").includes(".post {\n  margin: 0 auto;\n}"));
	fs.writeFileSync(path.join(root, "styles/pages/blog.scss"), ".post { color: $missing; }");
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("styles/pages/blog.scss") && log.includes("Undefined variable"), log);
});

test("a_base_goes_in_front_of_urls_from_the_root", () => {
	const root = project({
		"ssqch.config.js": `
import { sitemapPlugin } from "ssqch/sitemap";
import { redirectsPlugin } from "ssqch/redirects";
import { linksPlugin } from "ssqch/links";
import { imagePlugin } from "ssqch/image";
import { sassPlugin } from "ssqch/sass";
export default {
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
  base: "/repo/",
  plugins: [
    imagePlugin({ formats: ["webp"], widths: [16] }),
    sassPlugin({ files: { "styles/site.scss": "/site.css" } }),
    sitemapPlugin({ url: "https://you.github.io" }),
    redirectsPlugin(),
    linksPlugin(),
  ],
};
`,
		"styles/site.scss": "body { background: url(/img/squatch.png); }",
		"src/img/squatch.png": PNG,
		"src/_includes/layout.edge": "<html><head><link rel=\"stylesheet\" href=\"/site.css\"></head><body><nav><a href=\"/\">Home</a> <a href=\"/about/#team\">About</a> <a href=\"https://you.github.io/other-project/\">Other</a></nav>{{{ content }}}<script>const feed = \"{{ withBase('/feed.json') }}\";</script><p>{{ page.url }} {{ ssqch.base }}</p></body></html>",
		"src/index.md": "---\nlayout: layout.edge\n---\nSee [about](/about/), [next door](about/) and [the old page](/old/).\n\n![Squatch](/img/squatch.png)\n",
		"src/about.md": "---\nlayout: layout.edge\naliases: /old/\n---\n## Team\n",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	assert.ok(log.includes("0 broken"), log);
	// The output folder is the same with or without a base.
	const home = read(root, "dist/index.html");
	for (const expected of [
		"<link rel=\"stylesheet\" href=\"/repo/site.css\">",
		"<a href=\"/repo/\">Home</a>",
		"<a href=\"/repo/about/#team\">About</a>",
		"<a href=\"/repo/about/\">about</a>",
		"<a href=\"about/\">next door</a>",
		"const feed = \"/repo/feed.json\";",
		"<p>/ /repo</p>",
		"decoding=\"async\" src=\"/repo/img/",
	]) {
		assert.ok(home.includes(expected), `missing ${expected}\nin ${home}`);
	}
	assert.ok(!home.includes("/repo/repo"), home);
	assert.ok(read(root, "dist/site.css").includes("url(/repo/img/squatch.png)"));
	assert.ok(read(root, "dist/sitemap.xml").includes("<loc>https://you.github.io/repo/about/</loc>"));
	const old = read(root, "dist/old/index.html");
	assert.ok(old.includes("url=/repo/about/") && old.includes("location.replace(\"/repo/about/\" + location.hash)"), old);

	// --base wins over the config. A broken link is still caught, and reported as the template has it.
	fs.writeFileSync(path.join(root, "src/about.md"), "---\nlayout: layout.edge\naliases: /old/\n---\n## Team\n\n[gone](/nope/)\n");
	({ ok, log } = build(root, ["--base", "/preview/pr-7"]));
	assert.ok(!ok && log.includes("1 broken link:\n  /about/ -> /nope/ (not found)"), log);
	assert.ok(read(root, "dist/about/index.html").includes("<a href=\"/preview/pr-7/nope/\">gone</a>"));
	({ ok, log } = build(root, ["--base", "preview"]));
	assert.ok(!ok && log.includes("--base: base must be a URL path starting with /"), log);
});

test("a_hook_template_writes_redirect_pages_and_footnotes", () => {
	const root = project({
		"ssqch.config.js": "import { redirectsPlugin } from \"ssqch/redirects\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\"], markdownEngine: \"edge\", base: \"/docs\", data: { site: { name: \"Trails\" } }, plugins: [redirectsPlugin()] };",
		"src/_includes/hooks/redirect.liquid": "<!doctype html><title>{{ site.name }}</title><meta http-equiv=\"refresh\" content=\"0; url={{ redirect.to }}\"><p>{{ redirect.from }} is now <a href=\"{{ redirect.to }}\">here</a>.</p>\n",
		"src/_includes/hooks/footnote-ref.edge": "<sup><a href=\"#{{ footnote.label }}\">{{ footnote.label }}</a></sup>",
		"src/_includes/hooks/footnotes.edge": "@each(note in footnotes)\n<div class=\"footnote-definition\" id=\"{{ note.label }}\"><sup>{{ note.label }}</sup>{{{ note.content }}}</div>\n@end",
		"src/pine.md": "---\naliases: /old-pine/\n---\nPines[^1] are tall.\n\n[^1]: Mostly.\n",
	});
	const { ok, log } = build(root);
	assert.ok(ok, log);
	assert.equal(read(root, "dist/old-pine/index.html"), "<!doctype html><title>Trails</title><meta http-equiv=\"refresh\" content=\"0; url=/docs/pine/\"><p>/old-pine/ is now <a href=\"/docs/pine/\">here</a>.</p>\n");
	const page = read(root, "dist/pine/index.html");
	assert.ok(page.includes("<p>Pines<sup><a href=\"#1\">1</a></sup> are tall.</p>"), page);
	assert.ok(page.includes("<div class=\"footnote-definition\" id=\"1\"><sup>1</sup><p>Mostly.</p>\n</div>"), page);
});

const mtime = (root, file) => fs.statSync(path.join(root, file)).mtimeMs;

test("image_takes_a_name_for_its_files", async () => {
	const root = project({
		"ssqch.config.js": "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\"], markdownEngine: \"edge\" };",
		"src/img/squatch.png": PNG,
		"src/_data/logos.js": `import { image } from "ssqch/image";
const named = await image("src/img/squatch.png", { widths: [16, 24], formats: ["webp", "png"], name: "/assets/sponsors/acme" });
const inside = await image("src/img/squatch.png", { widths: [16], formats: ["webp"], name: "cards/pine" });
let bad;
try { await image("src/img/squatch.png", { name: "../up" }); } catch (e) { bad = e.message; }
export default { urls: [...named.webp, ...named.png, ...inside.webp].map((e) => e.url).join(" "), bad };
`,
		"src/index.edge": "{{ logos.urls }}|{{ logos.bad }}",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	assert.equal(
		read(root, "dist/index.html"),
		"/assets/sponsors/acme-16.webp /assets/sponsors/acme-24.webp /assets/sponsors/acme-16.png /assets/sponsors/acme-24.png /img/cards/pine-16.webp|image(): image name &quot;../up&quot; must be a URL path without the width and extension, like &quot;/assets/sponsors/acme&quot;",
	);
	for (const file of ["dist/assets/sponsors/acme-16.webp", "dist/assets/sponsors/acme-24.png", "dist/img/cards/pine-16.webp"]) {
		assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
	}
	// A newer source is encoded again under the same name.
	const before = mtime(root, "dist/assets/sponsors/acme-16.webp");
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.equal(mtime(root, "dist/assets/sponsors/acme-16.webp"), before, "an unchanged source was encoded again");
	await sleep(1100);
	fs.writeFileSync(path.join(root, "src/img/squatch.png"), PNG);
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.ok(mtime(root, "dist/assets/sponsors/acme-16.webp") > before, "a changed source wasn't encoded again");
});

// What's outside `<img>` gets published copies: `imageUrl()` for metadata, `feedHtml()` for a
// feed's content, `image()`'s `auto` key, and `ssqch:preload` for the banner.
test("images_outside_img_tags_point_at_generated_copies", () => {
	const root = project({
		"ssqch.config.js": `import { imagePlugin } from "ssqch/image";
import { rssPlugin } from "ssqch/rss";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge", "md"], markdownEngine: "edge",
  plugins: [rssPlugin(), imagePlugin({ formats: ["webp", "auto"], widths: [16, 32], defaultAttributes: { loading: "lazy", sizes: "auto" } })] };`,
		"src/img/squatch.png": PNG,
		"src/posts/hike/map.png": PNG,
		"src/_data/logo.js": `import { image, imageUrl } from "ssqch/image";
const d = await image("src/img/squatch.png", { formats: ["auto"], widths: [20] });
export default { keys: Object.keys(d).join(","), same: d.auto[0].url === d.png[0].url, url: imageUrl("/img/squatch.png", { width: 10, format: "webp" }).url };
`,
		"src/posts/hike/index.md": "---\ntags: posts\n---\n<img src=\"./map.png\" alt=\"Map\" loading=\"lazy\" ssqch:widths=\"16\"> <a href=\"/img/squatch.png\">big</a> <img src=\"/img/squatch.png\" width=\"20\" alt=\"Small\">\n",
		"src/feed.edge": "---\npermalink: feed.xml\n---\n@each(post in collections.posts)\n<content>{{ feedHtml(post.templateContent, \"https://example.com\" + post.url) }}</content>\n@end\n",
		"src/index.edge": "<html><head><meta property=\"og:image\" content=\"{{ imageUrl('/img/squatch.png', { width: 1200 }).url }}\"><link rel=\"stylesheet\" href=\"/s.css\"></head><body><img src=\"/img/squatch.png\" alt=\"Banner\" ssqch:preload sizes=\"auto, 50vw\"><p>{{ logo.keys }} {{ logo.same }} {{ logo.url }} {{ JSON.stringify(imageUrl('https://cdn.example.com/a.png')) }}</p></body></html>",
		"src/bad.edge": "---\npermalink: false\n---\n",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	// The source is 64 px wide, so the 1200 px copy is the original's width, as a PNG.
	const og = html.split("og:image\" content=\"")[1].split("\"")[0];
	assert.ok(og.startsWith("/img/") && og.endsWith("-64.png") && fs.existsSync(path.join(root, "dist", og.replace(/^\//, ""))), html);
	assert.ok(html.includes("<p>png,auto true /img/") && html.includes("-10.webp {&quot;url&quot;:&quot;https://cdn.example.com/a.png&quot;}</p>"), html);
	// The preload goes before the stylesheet, for the first format, without `auto` in its sizes;
	// the image loads eagerly with a high priority.
	const preload = html.indexOf("<link rel=\"preload\" as=\"image\" type=\"image/webp\" fetchpriority=\"high\" imagesrcset=\"/img/");
	assert.notEqual(preload, -1, html);
	assert.ok(preload < html.indexOf("<link rel=\"stylesheet\""), html);
	assert.ok(html.includes("-32.webp 32w\" imagesizes=\"50vw\">"), html);
	const banner = html.split("alt=\"Banner\"")[0].split("<img").pop() + html.split("alt=\"Banner\"")[1].slice(0, 80);
	assert.ok(!banner.includes("lazy") && banner.includes("fetchpriority=\"high\"") && !banner.includes("ssqch:"), banner);

	const feed = read(root, "dist/feed.xml");
	// One absolute URL per image (the page's own width when it has one), no srcset or lazy loading,
	// and a link to an image goes to its published copy.
	assert.ok(!feed.includes("srcset") && !feed.includes("loading") && !feed.includes("ssqch:") && !feed.includes("picture"), feed);
	assert.ok(feed.includes("&lt;img src=&quot;https://example.com/img/") && feed.includes("-64.png&quot; alt=&quot;Map&quot;&gt;"), feed);
	assert.ok(feed.includes("-20.png&quot; width=&quot;20&quot; alt=&quot;Small&quot;&gt;"), feed);
	assert.ok(feed.includes("&lt;a href=&quot;https://example.com/img/") && !feed.includes("/img/squatch.png"), feed);

	// Mistakes are named.
	fs.writeFileSync(path.join(root, "src/bad.edge"), "---\npermalink: /bad/\n---\n{{ imageUrl('/img/nope.png').url }}");
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("imageUrl(): image not found: /img/nope.png (looked for ./src/img/nope.png)") && !log.includes("imageUrl(): imageUrl()"), log);
	fs.writeFileSync(path.join(root, "src/bad.edge"), "---\npermalink: /bad/\n---\n{{ imageUrl('/img/squatch.png', { size: 3 }).url }}");
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("imageUrl(): unknown option \"size\" (options: width, format)"), log);
});

// Images are encoded into `.cache/ssqch/img` and linked into the output, so the output folder
// can go without encoding anything again, and an output from before the cache is kept.
test("images_are_kept_in_the_cache_outside_the_output", () => {
	const config = `import { imagePlugin } from "ssqch/image";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge"], plugins: [imagePlugin({ formats: ["webp", "auto"], widths: [16, 32], prune: true })] };`;
	const root = project({ "ssqch.config.js": config, "src/img/squatch.png": PNG, "src/index.edge": "<img src=\"/img/squatch.png\" alt=\"\">" });
	let { ok, log } = build(root);
	assert.ok(ok, log);
	assert.ok(log.includes("4 files from 1 source") && log.includes("4 encoded, 0 reused"), log);
	const cached = fs.readdirSync(path.join(root, ".cache/ssqch/img"));
	assert.equal(cached.length, 4, JSON.stringify(cached));

	fs.rmSync(path.join(root, "dist"), { recursive: true });
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.ok(log.includes("0 encoded, 4 reused"), log);
	for (const name of cached) {
		assert.ok(fs.statSync(path.join(root, "dist/img", name), { throwIfNoEntry: false })?.isFile(), `${name} is in the output`);
	}

	// An output from before the cache (or a deploy that only kept dist/img): its files are taken in.
	fs.rmSync(path.join(root, ".cache"), { recursive: true });
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.ok(log.includes("0 encoded, 4 reused"), log);
	assert.equal(fs.readdirSync(path.join(root, ".cache/ssqch/img")).length, 4);

	// `prune` cleans the cache too.
	fs.writeFileSync(path.join(root, "src/index.edge"), "<img src=\"/img/squatch.png\" alt=\"\" ssqch:widths=\"16\">");
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.equal(fs.readdirSync(path.join(root, ".cache/ssqch/img")).length, 2);
	assert.equal(fs.readdirSync(path.join(root, "dist/img")).length, 2);
});

// 0.8's quality options are sharp's own numbers (CHANGELOG.md, "Breaking"), and `avifEffort`
// replaces 0.7's `avifSpeed`. The defaults are 0.7's converted, so setting them changes nothing,
// names included.
test("image_quality_options_are_sharps_numbers", () => {
	const config = (options) => `import { imagePlugin } from "ssqch/image";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge"], plugins: [imagePlugin({ formats: ["avif", "webp", "jpeg"], widths: [16]${options} })] };`;
	const root = project({ "ssqch.config.js": config(""), "src/img/squatch.png": PNG, "src/index.edge": "<img src=\"/img/squatch.png\" alt=\"\">" });
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const defaults = read(root, "dist/index.html");
	fs.writeFileSync(path.join(root, "ssqch.config.js"), config(", webpQuality: 75, avifQuality: 41, avifEffort: 2, jpegQuality: 89"));
	({ ok, log } = build(root));
	assert.ok(ok && log.includes("0 encoded, 3 reused"), log);
	assert.equal(read(root, "dist/index.html"), defaults, "the defaults, written out, are the same files");
	for (const [options, want] of [
		[", avifSpeed: 4", "plugin \"ssqch/image\": avifSpeed is 0.7's option: ssqch 0.8 has avifEffort, sharp's AVIF effort from 0 (fastest) to 9 (smallest files). 0.7's speed 8 is effort 2 (the default) and speed 4 is effort 3"],
		[", avifQuality: 60.5", "plugin \"ssqch/image\": avifQuality must be a whole number from 1 to 100 (sharp's quality), got 60.5"],
		[", avifEffort: 10", "plugin \"ssqch/image\": avifEffort must be a whole number from 0 to 9 (0 is fastest, 9 makes the smallest files), got 10"],
	]) {
		fs.writeFileSync(path.join(root, "ssqch.config.js"), config(options));
		({ ok, log } = build(root));
		assert.ok(!ok && log.includes(want), `wanted: ${want}\n  got: ${log}`);
	}
});

// The link checker reads URLs outside HTML attributes: a feed's escaped HTML, `<meta>` values,
// JSON-LD and `imagesrcset`, and absolute links on the site's own address.
test("the_link_checker_reads_feeds_meta_and_json_ld", () => {
	const root = project({
		"ssqch.config.js": `import { linksPlugin } from "ssqch/links";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge"], passthrough: ["src/content"], plugins: [linksPlugin({ url: "https://example.com" })] };`,
		"src/content/logo.png": PNG,
		"src/about.edge": "---\npermalink: /about/\n---\n<p>About</p>",
		"src/index.edge": `<head><meta property="og:image" content="https://example.com/content/missing.png"><meta property="og:url" content="https://example.com/"><meta name="twitter:image" content="/content/logo.png"><meta name="description" content="/not/a/link"><link rel="preload" as="image" imagesrcset="/img/gone-300.webp 300w"><script type="application/ld+json">{"@context":"https://schema.org","@id":"https://example.com/#org","logo":{"url":"https://example.com/content/images/logo.png"},"url":"https://example.com/about/"}</script></head><a href="http://example.com/wp-content/talk.pdf">old</a><a href="https://other.example/x">elsewhere</a>`,
		"src/feed.edge": "---\npermalink: feed.xml\n---\n<feed><link href=\"https://example.com/feed.xml\" rel=\"self\"/><entry><id>https://example.com/about/</id><content type=\"html\">{{ '<p><img src=\"https://example.com/content/images/a.png\"><a href=\"/about/\">a</a></p>' }}</content></entry></feed>",
	});
	let { ok, log } = build(root);
	assert.ok(!ok, log);
	assert.ok(log.includes("5 broken links:"), log);
	for (const line of [
		"/ -> https://example.com/content/missing.png (not found)",
		"/ -> https://example.com/content/images/logo.png (not found)",
		"/ -> /img/gone-300.webp (not found)",
		"/ -> http://example.com/wp-content/talk.pdf (not found)",
		"/feed.xml -> https://example.com/content/images/a.png (not found)",
	]) {
		assert.ok(log.includes(line), `${line}: ${log}`);
	}

	// Without `url`, the sitemap's address is the site's.
	fs.writeFileSync(path.join(root, "ssqch.config.js"), `import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge"], passthrough: ["src/content"], plugins: [sitemapPlugin({ url: "https://example.com" }), linksPlugin()] };`);
	({ ok, log } = build(root));
	assert.ok(!ok && log.includes("5 broken links:"), log);
});

// A listed asset can be a passthrough copy, and imports in inline module scripts are rewritten.
test("assets_rewrite_inline_module_imports_of_passthrough_files", () => {
	const root = project({
		"ssqch.config.js": `import { assetsPlugin } from "ssqch/assets";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["edge"], passthrough: [{ "js/pco.js": "assets/pco.js" }], plugins: [assetsPlugin({ files: ["/assets/pco.js"] })] };`,
		"js/pco.js": "export function setup() {}",
		"src/index.edge": "<script type=\"module\">\n import { setup } from \"/assets/pco.js\";\nsetup();\n</script>",
	});
	let { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	const hashed = html.split("from \"")[1].split("\"")[0];
	assert.ok(hashed.startsWith("/assets/pco.") && hashed.endsWith(".js") && hashed.length === "/assets/pco.12345678.js".length, html);
	assert.ok(fs.existsSync(path.join(root, "dist", hashed.replace(/^\//, ""))), hashed);
	// DELIBERATE (0.10): the passthrough copy is renamed, not copied twice. The copy step put the
	// plain file back beside the fingerprinted one, which nothing links to.
	assert.ok(!fs.existsSync(path.join(root, "dist/assets/pco.js")), "the plain passthrough copy is left in the output");
	// Built again, the passthrough copy and the fingerprinted one agree.
	fs.writeFileSync(path.join(root, "js/pco.js"), "export function setup() { return 1; }");
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.ok(!read(root, "dist/index.html").includes(hashed), "a changed file gets a new name");
	assert.deepEqual(fs.readdirSync(path.join(root, "dist/assets")).length, 1, "one fingerprinted copy, and no plain one");

	// In development, the plain path, with no warning about a tool that hasn't written it.
	fs.rmSync(path.join(root, "dist"), { recursive: true });
	({ ok, log } = build(root, ["--env", "development"]));
	assert.ok(ok && !log.includes("isn't in the output"), log);
	assert.ok(read(root, "dist/index.html").includes("from \"/assets/pco.js\""));
});

// Not from a Rust test: the plugins and `base` find URLs where 0.7's lol_html found them, which is
// where browsers do, in HTML that's written oddly.
test("urls_in_odd_html_are_found_where_browsers_find_them", () => {
	const root = project({
		"ssqch.config.js": `import { linksPlugin } from "ssqch/links";
import { imagePlugin } from "ssqch/image";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["html"], base: "/repo/", plugins: [imagePlugin({ formats: ["webp"], widths: [16] }), linksPlugin({ fail: false })] };`,
		"src/img/squatch.png": PNG,
		"src/index.html": `<!doctype html><html><head><title>Probe</title></head><body>
<iframe src="https://www.youtube.com/embed/abc" />
<p><img src="/img/squatch.png" alt="Pine"> <a href="/next/">Next</a></p>
</iframe>
<p><img src="/img/squatch.png" alt="After"> <a href="/">Home</a></p>
<svg><title><a href="/b6/">x</a></title><style>.a{fill:url(/grad.svg#g)}</style></svg>
<!--><a href="/b3/">x</a><!-- -->
<script><!--<script></script><a href="/in-script/"></script>--><a href="/after-script/">after</a>
<p></p data-x="><a href='/in-end-tag/'>"><a href="/after-end-tag/">e</a>
<textarea/><a href="/in-textarea/"></textarea>
</body></html>
`,
	});
	const { ok, log } = build(root);
	assert.ok(ok, log);
	const html = read(root, "dist/index.html");
	for (const expected of [
		// A self-closed <iframe /> holds text to its end tag: HTML ignores the slash.
		"<p><img src=\"/img/squatch.png\" alt=\"Pine\"> <a href=\"/next/\">Next</a></p>",
		"alt=\"After\" width=\"16\" height=\"8\"> <a href=\"/repo/\">Home</a>",
		// In SVG, <title> holds markup, and <style> is still a style.
		"<svg><title><a href=\"/repo/b6/\">x</a></title><style>.a{fill:url(/repo/grad.svg#g)}</style></svg>",
		// <!--> is a whole comment.
		"<!--><a href=\"/repo/b3/\">x</a><!-- -->",
		// <!--<script> in a script starts a part that the next </script> doesn't end.
		"<a href=\"/in-script/\"></script>--><a href=\"/repo/after-script/\">after</a>",
		// A > in an end tag's quoted attribute doesn't end the tag.
		"<a href='/in-end-tag/'>\"><a href=\"/repo/after-end-tag/\">e</a>",
		"<textarea/><a href=\"/in-textarea/\"></textarea>",
	]) {
		assert.ok(html.includes(expected), `missing ${expected}\nin ${html}`);
	}
	assert.ok(log.includes("4 broken links:\n  / -> /after-end-tag/ (not found)\n  / -> /after-script/ (not found)\n  / -> /b3/ (not found)\n  / -> /b6/ (not found)"), log);
	assert.ok(log.includes("Links   7 checked, 4 broken"), log);
});

// DELIBERATE (0.10): under a `base`, the `_redirects` lines have it on both URLs, as a host
// matches the request's whole path (they had neither, so no old URL was redirected), and the link
// checker reads them with the base off, as it reads links.
test("redirects_under_a_base", () => {
	const root = project({
		"ssqch.config.js": `import { redirectsPlugin } from "ssqch/redirects";
import { linksPlugin } from "ssqch/links";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["md"], base: "/repo/", plugins: [redirectsPlugin({ pages: false, netlify: true, redirects: { "/elsewhere": "https://other.example/" } }), linksPlugin()] };`,
		"src/index.md": "See [the old post](/old/).",
		"src/posts/pine.md": "---\naliases: [/old/]\n---\nPine",
	});
	const { ok, log } = build(root);
	assert.ok(ok, log);
	assert.equal(read(root, "dist/_redirects"), "/repo/elsewhere  https://other.example/  301\n/repo/old/  /repo/posts/pine/  301\n");
	assert.ok(read(root, "dist/index.html").includes("href=\"/repo/old/\""));
});

// Not from a Rust test: an alias YAML reads as a date is the path it looks like.
test("aliases_that_look_like_dates_are_paths", () => {
	const root = project({
		"ssqch.config.js": `import { redirectsPlugin } from "ssqch/redirects";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["md"], plugins: [redirectsPlugin({ netlify: true })] };`,
		"src/a.md": "---\naliases: 2024-01-01\n---\nA\n",
		"src/b.md": "---\naliases: [2019-05-15, /old/]\n---\nB\n",
	});
	const { ok, log } = build(root);
	assert.ok(ok, log);
	assert.equal(read(root, "dist/_redirects"), "/2019-05-15  /b/  301\n/2024-01-01  /a/  301\n/old/  /b/  301\n");
	assert.ok(read(root, "dist/2024-01-01/index.html").includes("url=/a/"));
	assert.ok(read(root, "dist/2019-05-15/index.html").includes("url=/b/"));
});

// Not from a Rust test: a link to a path the system can't look up (a NUL byte, from `%00`, or a
// name too long) is broken, not an error of the build.
test("a_link_the_system_cant_look_up_is_not_found", () => {
	const long = `/${"a".repeat(3000)}/`;
	const root = project({
		"ssqch.config.js": `import { linksPlugin } from "ssqch/links";
export default { dirs: { input: "src", output: "dist" }, templateFormats: ["html"], plugins: [linksPlugin({ fail: false })] };`,
		"src/index.html": `<a href="/x%00y">nul</a> <a href="/x%00y/">nul folder</a> <a href="${long}">long</a>`,
	});
	const { ok, log } = build(root);
	assert.ok(ok, log);
	assert.ok(log.includes(`3 broken links:\n  / -> ${long} (not found)\n  / -> /x%00y (not found)\n  / -> /x%00y/ (not found)`), log);
});

// expressjs.com (ex, i18n.md): @astrojs/sitemap lists each page's translations as hreflang links,
// and the port wrote its own sitemap in an afterBuild hook for them. ssqch has no languages yet, so
// the site's `alternates` function says what a page's are.
test("sitemap_lists_a_pages_translations", () => {
	const root = project({
		"ssqch.config.js": `import { sitemapPlugin } from "ssqch/sitemap";
const langs = ["en", "fr"];
export default { base: "/trail/", templateFormats: ["njk"], plugins: [sitemapPlugin({ url: "https://example.com", lastmod: false, alternates: (page) => {
	if (page.url === "/") return null;
	const rest = page.url.replace(/^\\/(en|fr)\\//, "/");
	return [...langs.map((l) => ({ hreflang: l, href: \`/\${l}\${rest}\` })), { hreflang: "x-default", href: "https://example.com/trail/en" + rest }];
} })] };
`,
		"index.njk": "Squatch Snacks\n",
		"en/cedar.njk": "Cedar Trail\n",
		"fr/cedar.njk": "Sentier des cèdres\n",
	});
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(r.ok, r.log);
	const links = [
		"    <xhtml:link rel=\"alternate\" hreflang=\"en\" href=\"https://example.com/trail/en/cedar/\"/>",
		"    <xhtml:link rel=\"alternate\" hreflang=\"fr\" href=\"https://example.com/trail/fr/cedar/\"/>",
		"    <xhtml:link rel=\"alternate\" hreflang=\"x-default\" href=\"https://example.com/trail/en/cedar/\"/>",
	];
	assert.equal(read(root, "_site/sitemap.xml"), [
		"<?xml version=\"1.0\" encoding=\"utf-8\"?>",
		"<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\">",
		"  <url>", "    <loc>https://example.com/trail/</loc>", "  </url>",
		"  <url>", "    <loc>https://example.com/trail/en/cedar/</loc>", ...links, "  </url>",
		"  <url>", "    <loc>https://example.com/trail/fr/cedar/</loc>", ...links, "  </url>",
		"</urlset>", "",
	].join("\n"));

	const wrong = (alternates) => {
		const site = project({ "ssqch.config.js": `import { sitemapPlugin } from "ssqch/sitemap";\nexport default { templateFormats: ["njk"], plugins: [sitemapPlugin({ url: "https://example.com", alternates: ${alternates} })] };\n`, "index.njk": "x\n" });
		return ssqch(["build", "--root", site]).log;
	};
	assert.match(wrong("[\"fr\"]"), /alternates must be a function/);
	assert.match(wrong("() => [{ lang: \"fr\" }]"), /alternates\(\), for \/: each one is \{ hreflang: "fr", href: "\/fr\/page\/" \}/);
	assert.match(wrong("() => { throw new Error(\"no map of the trail\"); }"), /alternates\(\), for \/: no map of the trail/);
});

// Added in 0.11, from the fresh opensource.guide move: a Jekyll site's `url` is often empty, and
// jekyll-sitemap writes paths then. DELIBERATE (0.13): a sitemap of paths is one search engines
// can't read, so sitemapPlugin() asks for the address instead of warning on every build.
test("a_sitemap_without_a_url_asks_for_one", () => {
	const root = tempDir("sitemap-no-url");
	write(root, { "index.md": "# Pine\n" });
	for (const options of ["{ url: \"\" }", "{}"]) {
		write(root, { "ssqch.config.js": `import { sitemapPlugin } from "ssqch/sitemap";\nexport default { plugins: [sitemapPlugin(${options})] };\n` });
		const r = ssqch(["build", "--root", root]);
		assert.ok(!r.ok && r.log.includes("needs the site's address, like sitemapPlugin({ url: \"https://example.com\" })"), r.log);
	}
});

// Added in 0.11, from the fresh opensource.guide move: grass starts CSS with a character outside
// ASCII with a byte order mark (or `@charset` when expanded); `charset: false` leaves it out, as
// jekyll-sass-converter did.
test("sass_charset_false_leaves_out_the_byte_order_mark", () => {
	const root = tempDir("sass-charset");
	write(root, { "app.scss": ".quote::before { content: \"“\"; }\n", "index.md": "# Pine\n" });
	for (const [style, charset, starts] of [["compressed", undefined, "﻿.quote"], ["compressed", false, ".quote"], ["expanded", undefined, "@charset \"UTF-8\";\n.quote"], ["expanded", false, ".quote"]]) {
		write(root, { "ssqch.config.js": `import { sassPlugin } from "ssqch/sass";\nexport default { plugins: [sassPlugin({ files: { "app.scss": "/app.css" }, style: "${style}"${charset === false ? ", charset: false" : ""} })] };\n` });
		const r = ssqch(["build", "--root", root, "-q"]);
		assert.ok(r.ok, r.log);
		assert.ok(read(root, "_site/app.css").startsWith(starts), `${style} ${charset}: ${JSON.stringify(read(root, "_site/app.css"))}`);
	}
});

// Added in 0.11: the Eleventy RSS plugin's first names, which its sample feed still uses.
test("rss_has_the_eleventy_plugins_first_names", () => {
	const root = tempDir("rss-old-names");
	write(root, {
		"ssqch.config.js": "import { rssPlugin } from \"ssqch/rss\";\nexport default { templateFormats: [\"md\", \"njk\"], plugins: [rssPlugin()] };\n",
		"posts/a.md": "---\ntags: posts\ndate: 2026-01-02\n---\nA",
		"posts/b.md": "---\ntags: posts\ndate: 2026-03-04\n---\nB",
		"feed.njk": "---\npermalink: /feed.xml\n---\n{{ collections.posts | rssLastUpdatedDate }}|{{ collections.posts[0].date | rssDate }}",
	});
	const r = ssqch(["build", "--root", root, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(root, "_site/feed.xml"), "2026-03-04T00:00:00Z|2026-01-02T00:00:00Z");
});

// Added in 0.12, from the fresh vuejs.org run: vitepress-plugin-llms wrote 96 files the move left
// out. `llms.txt` lists the pages, each with a Markdown copy, and llms-full.txt has them all.
// DELIBERATE (0.13): a copy is what the page says (its Markdown after its template engine, or a
// page from a template as Markdown), its links are whole addresses that go to the copies, and
// `hint` is gone for `markdownCopy(page.url)`: a build adds no markup of its own, and hidden text
// for models reads as cloaking (the audit's plan, 2026-11-21).
test("llms_plugin_writes_the_site_for_language_models", () => {
	const dir = tempDir("llms");
	write(dir, {
		"ssqch.config.js": "import { llmsPlugin } from \"ssqch/llms\";\nexport default { urls: \"html\", data: { layout: \"base.jinja\" }, plugins: [llmsPlugin({ url: \"https://trail.example\", description: \"Hikes and the gear for them.\", exclude: [\"/drafts/**\"] })] };\n",
		"_data/site.json": "{ \"title\": \"Trail Guide\", \"trails\": [\"Cedar\", \"Old Growth\"] }\n",
		"_includes/base.jinja": "<html><head>{% if markdownCopy(page.url) %}<link rel=\"alternate\" type=\"text/markdown\" href=\"{{ markdownCopy(page.url) }}\">{% endif %}</head><body><nav><a href=\"/\">Home</a></nav><main>{{ content | safe }}</main></body></html>",
		"index.md": "---\ntitle: Home\n---\nWelcome to the trails. Start with [the intro](guide/intro.md).\n",
		"guide/index.md": "# Guide\n",
		"guide/intro.md": "---\ndescription: Where to start.\n---\n# Getting started\n\nOn {{ site.title }}:\n{% for t in site.trails %}\n- {{ t }}\n{% endfor %}\n\nPack water, then [the gear](/about.html#packs).\n",
		"guide/secret.md": "---\nllms: false\n---\n# Ranger only\n",
		"drafts/wip.md": "# Not yet\n",
		"about.jinja": "---\ntitle: About\n---\n<h1>About</h1><p>Squatch <em>Snacks</em> for the <a href=\"guide/intro.html\">trail</a>.</p><ul><li>Pine Cone Crunch</ul>",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/llms.txt"), "# Trail Guide\n\n> Hikes and the gear for them.\n\n## Pages\n\n- [Home](https://trail.example/index.md)\n- [About](https://trail.example/about.md)\n\n## Guide\n\n- [Guide](https://trail.example/guide/index.md)\n- [Getting started](https://trail.example/guide/intro.md): Where to start.\n");
	assert.equal(read(dir, "_site/guide/intro.md"), "# Getting started\n\nOn Trail Guide:\n\n- Cedar\n\n- Old Growth\n\nPack water, then [the gear](https://trail.example/about.md#packs).\n");
	assert.equal(read(dir, "_site/index.md"), "# Home\n\nWelcome to the trails. Start with [the intro](https://trail.example/guide/intro.md).\n");
	assert.equal(read(dir, "_site/about.md"), "# About\n\nSquatch *Snacks* for the [trail](https://trail.example/guide/intro.md).\n\n- Pine Cone Crunch\n");
	assert.ok(read(dir, "_site/llms-full.txt").startsWith("# Trail Guide\n\n> Hikes and the gear for them.\n\n---\nurl: https://trail.example/\n---\n\n# Home\n"));
	assert.ok(!fs.existsSync(path.join(dir, "_site/drafts/wip.md")) && !fs.existsSync(path.join(dir, "_site/guide/secret.md")));
	// The layout links the copy; a page without one gets "".
	assert.ok(read(dir, "_site/guide/intro.html").startsWith("<html><head><link rel=\"alternate\" type=\"text/markdown\" href=\"/guide/intro.md\"></head><body><nav>"));
	assert.ok(read(dir, "_site/guide/secret.html").startsWith("<html><head></head>"));
	write(dir, { "ssqch.config.js": "import { llmsPlugin } from \"ssqch/llms\";\nexport default { plugins: [llmsPlugin({ hint: true })] };\n" });
	const gone = ssqch(["build", "--root", dir]);
	assert.ok(!gone.ok && gone.log.includes("`hint` is gone") && gone.log.includes("markdownCopy(page.url)"), gone.log);
	write(dir, { "ssqch.config.js": "import { llmsPlugin } from \"ssqch/llms\";\nexport default { plugins: [llmsPlugin({ detail: \"x\" })] };\n" });
	const bad = ssqch(["build", "--root", dir]);
	assert.ok(!bad.ok && bad.log.includes("unknown option \"detail\" (did you mean \"details\"?)"), bad.log);
});

// Added in 0.12, from the fresh vuejs.org run: Vue's components render with the site's own Vite,
// @vitejs/plugin-vue and Vue. Without them, the error says what to install.
test("vue_plugin_without_vite_says_what_to_install", () => {
	const dir = tempDir("vue-no-vite");
	write(dir, {
		"package.json": "{ \"name\": \"trail\", \"private\": true }\n",
		"ssqch.config.js": "import { vuePlugin } from \"ssqch/vue\";\nexport default { plugins: [vuePlugin({ hydrate: \"visible\" })] };\n",
		"index.md": "<script setup>\nimport Counter from './Counter.vue'\n</script>\n\n# Trail\n\n<Counter />\n",
		"Counter.vue": "<template><button>0</button></template>\n",
	});
	const r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("vuePlugin() needs vite in the site's packages, as a VitePress site has it: `npm install -D vite @vitejs/plugin-vue vue`"), r.log);
	write(dir, { "ssqch.config.js": "import { vuePlugin } from \"ssqch/vue\";\nexport default { plugins: [vuePlugin({ hydrate: \"later\" })] };\n" });
	const bad = ssqch(["build", "--root", dir]);
	assert.ok(!bad.ok && bad.log.includes("hydrate must be false, \"load\", \"idle\" or \"visible\" (got \"later\")"), bad.log);
});

// Added in 0.13 (the audit's plan, step 6): a plugin's own Markdown steps, its render hooks as
// functions (which a site's template replaces), and defaults under the site's own options.
test("a_plugin_adds_markdown_steps_hooks_and_defaults", () => {
	const dir = tempDir("plugin-markdown");
	const plugin = (extra = "") => `const trail = {
	name: "trailLinks",
	markdown: {
		before: (source, context) => source.replace(/\\[\\[([^\\]]+)\\]\\]/g, (_, t) => \`[\${t}](/trails/\${t.toLowerCase()}/)\`),
		after: (html, context) => html + \`<!-- \${context.page.url} -->\`,
		hooks: { "containers/aside": (c, context) => \`<aside class="\${c.args}">\${c.content}</aside>\`, heading: (h) => \`<h\${h.level} class="trail">\${h.content}</h\${h.level}>\` },
	},
	defaults: { markdown: { headingIds: false, smartPunctuation: true } },${extra}
};
export default { markdown: { smartPunctuation: false }, plugins: [trail] };
`;
	write(dir, { "ssqch.config.js": plugin(), "index.md": "# Pine\n\nSee [[Cedar]], \"quoted\".\n\n::: aside tip\nPack *water*.\n:::\n" });
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	// The step's link, the plugin's hooks, its `headingIds: false` (no id), and the site's own smartPunctuation over the plugin's.
	assert.equal(read(dir, "_site/index.html"), "<h1 class=\"trail\">Pine</h1>\n<p>See <a href=\"/trails/cedar/\">Cedar</a>, &quot;quoted&quot;.</p>\n<aside class=\"tip\"><p>Pack <em>water</em>.</p>\n</aside>\n<!-- / -->");
	// A site's own template of a hook's name replaces the plugin's.
	write(dir, { "_includes/hooks/heading.jinja": "<h{{ heading.level }}>{{ heading.text }}!</h{{ heading.level }}>" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok && read(dir, "_site/index.html").startsWith("<h1>Pine!</h1>"), read(dir, "_site/index.html"));
	for (const [extra, says] of [
		["\n\tmarkdown: { befor: () => \"\" },", "plugin \"trailLinks\": markdown.befor isn't a plugin's Markdown step (did you mean `before`?)"],
		["\n\tdefaults: { urls: \"html\" },", "plugin \"trailLinks\": defaults.urls: a plugin's defaults can be markdown options only"],
	]) {
		write(dir, { "ssqch.config.js": plugin(extra).replace(/\n\tmarkdown: \{\n[\s\S]*?\n\t\},\n\tdefaults: \{ markdown: \{ headingIds: false, smartPunctuation: true \} \},/, "") });
		r = ssqch(["build", "--root", dir]);
		assert.ok(!r.ok && r.log.includes(says), r.log);
	}
	write(dir, { "ssqch.config.js": "export default { plugins: [{ name: \"slow\", markdown: { after: async (html) => html } }] };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("plugin \"slow\": markdown.after answered with a promise"), r.log);
});

// Added in 0.13: `ssqch/from-vitepress`, VitePress's Markdown as a plugin, writes what the dialect did.
test("from_vitepress_is_the_vitepress_dialect_as_a_plugin", () => {
	const dir = tempDir("from-vitepress");
	const page = "<script setup>\nimport X from './x.vue'\n</script>\n\n# What's Vue?\n\n::: tip\nPack *water*.\n:::\n\n[[toc]]\n";
	write(dir, { "ssqch.config.js": "import { fromVitepress } from \"ssqch/from-vitepress\";\nexport default { plugins: [fromVitepress()] };\n", "index.md": page });
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	const before = read(dir, "_site/index.html");
	// DELIBERATE (0.13): the old option is refused with the module's name.
	write(dir, { "ssqch.config.js": "export default { markdown: { dialect: \"vitepress\" } };\n" });
	const old = ssqch(["build", "--root", dir]);
	assert.ok(!old.ok && old.log.includes("markdown.dialect is fromVitepress() from \"ssqch/from-vitepress\" now"), old.log);
	assert.ok(before.includes("id=\"what-s-vue\"") && before.includes("class=\"tip custom-block\"") && !before.includes("<script"), before);
});

// Added in 0.13: `fromJekyll()` from "ssqch/from-jekyll": kramdown's Markdown as defaults the
// site's own options replace, and Jekyll's `page` and `site` in templates.
test("from_jekyll_gives_kramdown_and_jekylls_templates", () => {
	const dir = tempDir("from-jekyll");
	write(dir, {
		"ssqch.config.js": "import { fromJekyll } from \"ssqch/from-jekyll\";\nexport default { templateFormats: [\"liquid\", \"md\"], markdownEngine: \"liquid\", markdown: { smartPunctuation: false }, data: { layout: \"base.liquid\" }, plugins: [fromJekyll()] };\n",
		"_includes/base.liquid": "<title>{{ page.title }}</title>{{ content }}",
		"index.md": "---\ntitle: Pine\n---\n<aside markdown=\"1\">\n*Hush*, \"pine\" at https://example.com\n</aside>\n",
	});
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	// `page.title` is the front matter's; Markdown inside the aside; the site's own smartPunctuation; no bare-URL link.
	assert.equal(read(dir, "_site/index.html"), "<title>Pine</title><aside>\n<p><em>Hush</em>, &quot;pine&quot; at https://example.com</p>\n</aside>\n");
	write(dir, { "ssqch.config.js": "import { fromJekyll } from \"ssqch/from-jekyll\";\nexport default { plugins: [fromJekyll({ kramdwon: true })] };\n" });
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("unknown option \"kramdwon\" (did you mean \"kramdown\"?)"), r.log);
	// DELIBERATE (0.13): the old options are refused with their module's name.
	for (const [config, says] of [["{ jekyllTemplates: true }", "\"jekyllTemplates\" is gone: it's fromJekyll() from \"ssqch/from-jekyll\" now"], ["{ markdown: { admonitions: \"mkdocs\" } }", "markdown.admonitions is fromMkdocs() from \"ssqch/from-mkdocs\" now"]]) {
		write(dir, { "ssqch.config.js": `export default ${config};\n` });
		r = ssqch(["build", "--root", dir]);
		assert.ok(!r.ok && r.log.includes(says), r.log);
	}
});

// Added in 0.13: `fromHugo()` from "ssqch/from-hugo": Hugo's shortcodes as containers, as
// `markdown: { shortcodes: "hugo" }` reads them.
test("from_hugo_reads_shortcodes_as_containers", () => {
	const dir = tempDir("from-hugo");
	write(dir, {
		"ssqch.config.js": "import { fromHugo } from \"ssqch/from-hugo\";\nexport default { markdownEngine: false, plugins: [fromHugo()] };\n",
		"_includes/containers/note.jinja": "<div class=\"note {{ container.props.type }}\">{{ container.content | safe }}</div>",
		"index.md": "{{< note type=\"tip\" >}}\nPack *water*.\n{{< /note >}}\n",
	});
	assert.ok(ssqch(["build", "--root", dir, "-q"]).ok);
	const withPlugin = read(dir, "_site/index.html");
	assert.ok(withPlugin.startsWith("<div class=\"note tip\"><p>Pack <em>water</em>.</p>"), withPlugin);
	// DELIBERATE (0.13): the option on its own is refused with the module's name.
	write(dir, { "ssqch.config.js": "export default { markdownEngine: false, markdown: { shortcodes: \"hugo\" } };\n" });
	const old = ssqch(["build", "--root", dir]);
	assert.ok(!old.ok && old.log.includes("markdown.shortcodes is fromHugo() from \"ssqch/from-hugo\" now"), old.log);
	write(dir, { "ssqch.config.js": "import { fromHugo } from \"ssqch/from-hugo\";\nexport default { plugins: [fromHugo({ shortcodes: true })] };\n" });
	const bad = ssqch(["build", "--root", dir]);
	assert.ok(!bad.ok && bad.log.includes("this plugin takes no options (got \"shortcodes\")"), bad.log);
});
