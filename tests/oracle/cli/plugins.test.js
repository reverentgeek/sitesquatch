// From crates/ssqch/tests/plugins.rs: configs that use the built-in plugin modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, project, read, FIXTURES } from "../lib/ssqch.js";

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
	// Built again, the passthrough copy and the fingerprinted one agree.
	fs.writeFileSync(path.join(root, "js/pco.js"), "export function setup() { return 1; }");
	({ ok, log } = build(root));
	assert.ok(ok, log);
	assert.ok(!read(root, "dist/index.html").includes(hashed), "a changed file gets a new name");

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
