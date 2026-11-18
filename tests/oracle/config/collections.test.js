// From crates/sitesquatch-js/tests/collections.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, project, read } from "../lib/ssqch.js";

/** Builds `root` the way the Rust tests did: production, quiet. */
function build(root) {
	return ssqch(["build", "--root", root, "--quiet"]);
}

function buildOk(root) {
	const r = build(root);
	assert.ok(r.ok, r.log);
	return r;
}

/** The error text of a build that must fail (the binary's `error: ` prefix removed). */
function buildError(root) {
	const r = build(root);
	assert.ok(!r.ok, `expected an error, but the build worked:\n${r.log}`);
	return r.log.replace(/^error: /, "");
}

// The Rust API's default template formats (edge, md, html) are not the command line's: say so.
const FORMATS = `templateFormats: ["edge", "md", "html"],`;

const POSTS = {
	"src/posts/pine.md": "---\ntitle: Pine Cone Crunch\ndate: 2024-06-01\ntags: [posts, snacks]\n---\n# Pine\n",
	"src/posts/brittle.md": "---\ntitle: Bigfoot Brittle\ndate: 2025-02-03\ntags: [posts, snacks, sweet]\n---\n# Brittle\n",
	"src/posts/yogurt.md": "---\ntitle: Yeti Yogurt\ndate: 2025-07-04\ntags: [posts, dairy]\n---\n# Yogurt\n",
	"src/notes/a.md": "---\ntitle: Note A\ndate: 2023-01-01\n---\nnote\n",
	"src/notes/deep/b.txt.md": "---\ntitle: Note B\ndate: 2023-01-02\n---\nnote\n",
};

function site(config, index) {
	return project({ ...POSTS, "ssqch.config.js": config, "src/index.edge": index });
}

test("the_collection_api", () => {
	const root = site(
		`export default {
  dirs: { input: "src" },
  ${FORMATS}
  collections: {
    all2: (pages) => pages.all(),
    sorted: (pages) => pages.all().map((p) => p.fileSlug),
    snacks: (pages) => pages.byTag("snacks"),
    sweetSnacks: (pages) => pages.byTags("snacks", "sweet"),
    notes: (pages) => pages.byGlob("./src/notes/**/*.md"),
    shallowNotes: (pages) => pages.byGlob("src/notes/*.md"),
    either: (pages) => pages.byGlob(["src/posts/{pine,yogurt}.md", "src/notes/?.md"]),
    newestFirst: (pages) => pages.byTag("posts").sort((a, b) => b.date - a.date),
    summary: (pages) => pages.byTag("snacks").map((p) => ({ title: p.data.title, year: p.date.getUTCFullYear(), html: p.templateContent.trim() })),
  },
};`,
		`all2={{ collections.all2.length }}/{{ collections.all.length }}
sorted={{ collections.sorted.join(",") }}
snacks={{ collections.snacks.map(p => p.data.title).join(",") }}
sweet={{ collections.sweetSnacks.map(p => p.fileSlug).join(",") }}
notes={{ collections.notes.map(p => p.inputPath).join(",") }}
shallow={{ collections.shallowNotes.map(p => p.fileSlug).join(",") }}
either={{ collections.either.map(p => p.fileSlug).join(",") }}
newest={{ collections.newestFirst.map(p => p.fileSlug).join(",") }}
summary={{ JSON.stringify(collections.summary) }}
original={{ collections.posts.map(p => p.fileSlug).join(",") }}`,
	);
	buildOk(root);
	const html = read(root, "_site/index.html");
	const lines = html.split("\n");
	assert.equal(lines[0], "all2=6/6");
	assert.equal(lines[1], "sorted=a,b.txt,pine,brittle,yogurt,", "oldest first; a root index has an empty fileSlug");
	assert.equal(lines[2], "snacks=Pine Cone Crunch,Bigfoot Brittle");
	assert.equal(lines[3], "sweet=brittle");
	assert.equal(lines[4], "notes=./src/notes/a.md,./src/notes/deep/b.txt.md");
	assert.equal(lines[5], "shallow=a");
	assert.equal(lines[6], "either=a,pine,yogurt");
	assert.equal(lines[7], "newest=yogurt,brittle,pine");
	assert.equal(
		lines[8],
		String.raw`summary=[{&quot;title&quot;:&quot;Pine Cone Crunch&quot;,&quot;year&quot;:2024,&quot;html&quot;:&quot;&lt;h1 id=\&quot;pine\&quot;&gt;Pine&lt;/h1&gt;&quot;},{&quot;title&quot;:&quot;Bigfoot Brittle&quot;,&quot;year&quot;:2025,&quot;html&quot;:&quot;&lt;h1 id=\&quot;brittle\&quot;&gt;Brittle&lt;/h1&gt;&quot;}]`,
	);
	assert.equal(lines[9], "original=pine,brittle,yogurt", "sorting in a collection must not reorder collections.posts");
});

test("transforms_get_the_content_and_the_page", () => {
	const root = site(
		`export default {
  dirs: { input: "src" },
  ${FORMATS}
  transforms: {
    upper: async (content, page) => {
      if (page.outputPath.endsWith(".html")) return content.replace(/<h1( [^>]*)?>(.*?)<\\/h1>/g, (_, a, t) => \`<h1>\${t.toUpperCase()}</h1>\`);
      return content;
    },
    stamp: (content, { url, inputPath, outputPath }) => outputPath.endsWith(".html") ? \`\${content}<!-- \${url} \${inputPath} -->\` : content,
  },
};`,
		"home",
	);
	buildOk(root);
	assert.equal(read(root, "_site/posts/pine/index.html"), "<h1>PINE</h1>\n<!-- /posts/pine/ ./src/posts/pine.md -->");
});

test("a_transform_must_return_content", () => {
	const root = site(
		`export default {
  dirs: { input: "src" },
  ${FORMATS}
  transforms: { forgetful: (content, page) => { if (page.url === "/never/") return content; } },
};`,
		"home",
	);
	const e = buildError(root);
	assert.ok(e.includes("transform `forgetful` failed"), e);
	assert.ok(e.includes("transform \"forgetful\" returned undefined") && e.includes("return the content (unchanged if there's nothing to do)"), e);
});

test("build_hooks_run_before_and_after", () => {
	const root = site(
		`import fs from "node:fs";
const log = [];
export default {
  dirs: { input: "src", output: "public" },
  ${FORMATS}
  beforeBuild: async ({ env, serving, dirs }) => {
    await null;
    log.push(\`before \${env} \${serving} \${dirs.input} \${dirs.output} \${dirs.includes} \${dirs.data}\`);
  },
  afterBuild: ({ written }) => {
    log.push(\`after \${written.length} \${written.every((p) => p.endsWith(".html"))}\`);
    fs.writeFileSync("hooks.txt", log.join("\\n"));
  },
  plugins: [{ name: "second", beforeBuild: [() => log.push("plugin before")] }],
};`,
		"home",
	);
	buildOk(root);
	assert.equal(read(root, "hooks.txt"), "before production false ./src/ ./public/ ./src/_includes/ ./src/_data/\nplugin before\nafter 6 true");
});

test("hook_errors_stop_the_build", () => {
	let root = site(`export default { dirs: { input: "src" }, ${FORMATS} plugins: [{ name: "grumpy", beforeBuild: () => { throw new Error("no snacks today"); } }] };`, "home");
	let e = buildError(root);
	assert.ok(e.includes("beforeBuild (plugin \"grumpy\")") && e.includes("no snacks today"), e);

	root = site(`export default { beforeWatch: () => {} };`, "home");
	e = buildError(root);
	assert.ok(e.includes("\"beforeWatch\" isn't a config option"), e);
});

// The Rust test views_behave_like_plain_objects checked 0.7's copy-on-write views of the site's
// data, which filters got. On Node, filters get the objects themselves (the changelog's
// "Breaking"), so there are no views to check.

// expressjs.com (ex #2): a route paginated over a collection read its page's headings from a data
// file's `computed`, before that page had rendered, and the empty list stuck, so every table of
// contents built from it was empty. Read early, they're empty; read after the page renders, they're there.
test("headings_read_before_a_page_renders_are_found_after_it_renders", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"njk\", \"md\"], collections: { docs: (pages) => pages.byGlob(\"docs/**\") } };\n",
		"docs/guide.md": "---\npermalink: false\n---\n## Install\n\n## Use\n",
		"routes.njk": "---\npagination: { data: collections.docs, size: 1, alias: doc }\npermalink: \"/guide/\"\n---\n{{ doc.templateContent | safe }}early {{ early }}, after {{ doc.page.headings | length }}: {% for h in doc.page.headings %}{{ h.id }} {% endfor %}\n",
		"routes.data.js": "export default { computed: { early: (data) => data.doc.page.headings.length } };\n",
	});
	buildOk(root);
	assert.match(read(root, "_site/guide/index.html"), /early 0, after 2: install use /);
});

// opensource.guide (osg #12): Bundler's `--path vendor/gems` put Jekyll's own templates in the
// site, and ssqch built them as pages (5 errors, from gems' layouts). A Bundler install folder is
// skipped as node_modules is; a site's own `vendor/` folder isn't.
test("a_bundler_install_folder_is_not_the_sites_pages", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"md\"] };\n",
		"index.md": "# Home\n",
		"vendor/bundle/ruby/3.3.0/gems/jekyll-3.10.0/lib/site_template/about.md": "---\nlayout: page\n---\nAbout\n",
		"vendor/notes.md": "# Our own vendor notes\n",
	});
	buildOk(root);
	assert.match(read(root, "_site/vendor/notes/index.html"), /Our own vendor notes/);
	assert.throws(() => read(root, "_site/vendor/bundle/ruby/3.3.0/gems/jekyll-3.10.0/lib/site_template/about/index.html"));
});
