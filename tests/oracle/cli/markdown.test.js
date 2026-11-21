// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, project } from "../lib/ssqch.js";

test("markdown_options_hooks_containers_and_headings", () => {
	const dir = tempDir("markdown");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "import { defineConfig, markdown } from \"ssqch\";\nexport default defineConfig({\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"edge\", \"md\", \"njk\", \"liquid\"],\n  markdownEngine: \"edge\",\n  markdown: { headingIds: \"blackfriday\", smartPunctuation: true },\n  data: { blurb: markdown(\"Made with *care*\", { inline: true }) },\n});\n");
	w("src/_includes/doc.edge", "<nav>{{{ toc(page.headings, { to: 4 }) }}}</nav>\n<p>{{{ blurb }}}</p>\n<main>{{{ content }}}</main>\n");
	w("src/_includes/hooks/heading.liquid", "<h{{ heading.level }} id=\"{{ heading.id }}\">{{ heading.content }} <a href=\"#{{ heading.id }}\" aria-hidden=\"true\">#</a></h{{ heading.level }}>\n");
	w("src/_includes/hooks/fence-mermaid.edge", "<pre class=\"mermaid\" data-info=\"{{ fence.info }}\">{{ fence.code }}</pre>\n");
	w("src/_includes/containers/warning.njk", "<aside class=\"warning\" data-page=\"{{ title }}\"><strong>{{ container.args or \"Warning\" }}</strong>\n{{ container.content | safe }}</aside>\n");
	w("src/docs/intro.md", "---\ntitle: Intro\nlayout: doc.edge\n---\n# Getting started\n\nSome \"quotes\" -- and a note.[^1] See https://example.com.\n\n## Install it {#setup}\n\n::: warning Careful\nDon't eat the *pine* cones.\n:::\n\n> [!TIP]\n> Use {{ title }}.\n\n### What's next?\n\n```mermaid {theme=dark}\ngraph TD\n```\n\n{{{ markdown(\"**bold**\", \"inline\") }}}\n\n[^1]: The note.\n");
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const page = read(dir, "dist/docs/intro/index.html");
	for (const expected of [
		"<nav><ul><li><a href=\"#setup\">Install it</a><ul><li><a href=\"#what-s-next\">What’s next?</a></li></ul></li></ul></nav>",
		"<p>Made with <em>care</em></p>",
		"<h1 id=\"getting-started\">Getting started <a href=\"#getting-started\" aria-hidden=\"true\">#</a></h1>",
		"<p>Some “quotes” – and a note.<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup> See <a href=\"https://example.com\">https://example.com</a>.</p>",
		"<aside class=\"warning\" data-page=\"Intro\"><strong>Careful</strong>\n<p>Don’t eat the <em>pine</em> cones.</p>\n</aside>",
		"<div class=\"markdown-alert markdown-alert-tip\">\n<p class=\"markdown-alert-title\">Tip</p>\n<p>Use Intro.</p>\n</div>",
		"<pre class=\"mermaid\" data-info=\"mermaid {theme=dark}\">graph TD\n</pre>",
		"<p><strong>bold</strong></p>",
		"<li id=\"fn-1\">\n<p>The note. <a href=\"#fnref-1\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a></p>\n</li>",
	]) {
		assert.ok(page.includes(expected), `missing ${JSON.stringify(expected)} in\n${page}`);
	}

	// Mistakes name the option or the file.
	w("ssqch.config.js", "export default { markdown: { footnote: false } };\n");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("markdown.footnote isn't an option (did you mean `footnotes`?) (options: headingIds,"), r.log);
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" } };\n");
	w("src/_includes/hooks/link.pug", "a");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("_includes/hooks/link.pug: no template engine named `pug`"), r.log);
});

test("markdown_highlights_code_and_writes_the_stylesheet", () => {
	const dir = tempDir("highlight");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, markdown: { highlight: { css: \"/assets/code.css\" } } };\n");
	w("src/index.md", "```js {2}\nconst a = 1;\nlet b = \"two\";\n```\n\n```nonsense\n<x>\n```\n\n```diagram\nA -> B\n```\n");
	w("src/_includes/hooks/fence-diagram.edge", "<figure data-lang=\"{{ fence.lang }}\">{{ fence.highlighted ?? fence.code }}</figure>\n");
	let r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(r.ok, r.log);
	const page = read(dir, "dist/index.html");
	assert.equal(
		page,
		"<pre class=\"highlight\"><code class=\"language-js\"><span class=\"line\"><span class=\"hl-keyword\">const</span> a <span class=\"hl-operator\">=</span> <span class=\"hl-number\">1</span>;</span>\n" +
		"<span class=\"line highlighted\"><span class=\"hl-keyword\">let</span> b <span class=\"hl-operator\">=</span> <span class=\"hl-string\">&quot;two&quot;</span>;</span>\n</code></pre>\n" +
		"<pre><code class=\"language-nonsense\">&lt;x&gt;\n</code></pre>\n" +
		"<figure data-lang=\"diagram\">A -&gt; B\n</figure>\n",
	);
	const css = read(dir, "dist/assets/code.css");
	assert.ok(css.includes(".hl-keyword { color: var(--hl-keyword); }") && css.includes("prefers-color-scheme: dark"), css);

	w("ssqch.config.js", "export default { markdown: { highlight: { css: \"code.css\" } } };\n");
	r = ssqch(["build", "--root", d, "-q"]);
	assert.ok(!r.ok && r.log.includes("markdown.highlight.css must be a path like \"/assets/highlight.css\", or false, not \"code.css\""), r.log);
});

test("sites_add_and_replace_highlighted_languages", () => {
	const dir = tempDir("highlight-languages");
	const d = dir;
	const w = (p, t) => write(dir, { [p]: t });
	// Chords in brackets are keywords; the rest is plain. `js` is replaced: every line is a comment.
	w("ssqch.config.js",
		"const chords = code => code.split(/(\\[[^\\]]*\\])/).filter(Boolean).map(t => t.startsWith(\"[\") ? [t, \"keyword\"] : [t]);\n" +
		"export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  markdown: { highlight: { css: false, languages: {\n    chordpro: chords,\n    cho: \"chordpro\",\n    js: code => [{ text: code, kind: \"comment\" }],\n    snack: \"grammars/snack.sublime-syntax\",\n    broken: () => { throw new Error(\"no pine cones\"); },\n    wrong: () => [[\"x\", \"chord\"]],\n    short: () => [[\"half\"]],\n  } } },\n};\n");
	w("grammars/snack.sublime-syntax", "%YAML 1.2\n---\nname: Snack\nscope: source.snack\ncontexts:\n  main:\n    - match: '\\bcrunch\\b'\n      scope: keyword.control.snack\n");
	w("src/index.md", "```ChordPro {2}\n{title: Trail}\nA[G]mazing [D/F#]grace\n```\n\n```cho\n[C]x\n```\n\n```js\nlet a = 1;\n```\n\n```javascript\nlet a = 1;\n```\n\n```snack\nPine Cone crunch\n```\n\n{{ highlight(\"[Am]y\", \"chordpro\") | safe }}\n");
	w("src/bad.md", "```broken\nx\n```\n\n```wrong\nx\n```\n\n```short\nwhole\n```\n");
	let r = ssqch(["build", "--root", d]);
	assert.ok(r.ok, r.log);
	const page = read(dir, "dist/index.html");
	assert.ok(
		page.includes("<pre class=\"highlight\"><code class=\"language-ChordPro\"><span class=\"line\">{title: Trail}</span>\n<span class=\"line highlighted\">A<span class=\"hl-keyword\">[G]</span>mazing <span class=\"hl-keyword\">[D/F#]</span>grace</span>\n</code></pre>"),
		page,
	);
	assert.ok(page.includes("<code class=\"language-cho\"><span class=\"hl-keyword\">[C]</span>x\n</code>"), page);
	assert.ok(page.includes("<code class=\"language-js\"><span class=\"hl-comment\">let a = 1;</span>\n</code>"), page);
	// Only the name that's configured: `javascript` is still the built-in grammar.
	assert.ok(page.includes("<code class=\"language-javascript\"><span class=\"hl-keyword\">let</span>"), page);
	assert.ok(page.includes("<code class=\"language-snack\">Pine Cone <span class=\"hl-keyword\">crunch</span>\n</code>"), page);
	assert.ok(page.includes("<p><span class=\"hl-keyword\">[Am]</span>y</p>"), page);
	const bad = read(dir, "dist/bad/index.html");
	assert.equal(bad, "<pre><code class=\"language-broken\">x\n</code></pre>\n<pre><code class=\"language-wrong\">x\n</code></pre>\n<pre><code class=\"language-short\">whole\n</code></pre>\n");
	// DELIBERATE (0.8): the column in a stack frame is where Node (V8) says the error was made,
	// at `new` in `throw new Error(...)`; 0.7 ran the config on QuickJS, which said `Error` (31).
	const column = 27;
	for (const expected of [
		`warn: src/bad.md: a \`broken\` fence is plain text: markdown.highlight.languages.broken failed: no pine cones\n    at broken (ssqch.config.js:9:${column})`,
		"warn: src/bad.md: a `wrong` fence is plain text: markdown.highlight.languages.wrong returned the kind \"chord\", which isn't one of comment, keyword,",
		"warn: src/bad.md: a `short` fence is plain text: markdown.highlight.languages.short returned tokens whose text isn't the code (they differ from line 1)",
	]) {
		assert.ok(r.log.includes(expected), `${expected}\n${r.log}`);
	}

	for (const [config, error] of [
		["languages: { a: \"b\", b: \"a\" }", "markdown.highlight.languages: these aliases go in a circle: a -> b -> a"],
		["languages: { cone: \"pinecone\" }", "markdown.highlight.languages.cone: \"pinecone\" isn't a language ssqch highlights; give it a highlighter of its own"],
		["languages: { x: 3 }", "markdown.highlight.languages.x must be a function (code, lang) => tokens, another language's name, or a path to a .sublime-syntax file, not number"],
		["languages: { x: \"grammars/missing.sublime-syntax\" }", "markdown.highlight.languages.x: reading grammars/missing.sublime-syntax"],
	]) {
		w("ssqch.config.js", `export default { markdown: { highlight: { ${config} } } };\n`);
		const r = ssqch(["build", "--root", d, "-q"]);
		assert.ok(!r.ok && r.log.includes(error), `${error}\n${r.log}`);
	}
});

// 0.8: highlighted fences are kept in .cache/ssqch/highlight/ for the next process, which then
// doesn't load the grammars. 0.7 kept them in memory only.
test("highlighted_fences_are_cached_between_builds_and_never_change_a_page", () => {
	const dir = tempDir("highlight-cache");
	const w = (p, t) => write(dir, { [p]: t });
	const cache = path.join(dir, ".cache/ssqch/highlight/fences.json");
	w("ssqch.config.js", "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  markdown: { highlight: { languages: { trail: (code) => [[code, \"keyword\"]] } } },\n};\n");
	w("src/index.md", "```js {2}\nconst a = 1;\nlet b = \"two\";\n```\n\n```nonsense\n<x>\n```\n\n```trail\nOld Growth\n```\n\n```edge\n{{ snack }}\n```\n");
	w("src/more.md", "```bash\necho \"Pine Cone Crunch\"\n```\n");
	const build = () => {
		const r = ssqch(["build", "--root", dir, "-q"]);
		assert.ok(r.ok, r.log);
		return ["dist/index.html", "dist/more/index.html", "dist/highlight.css"].map((f) => read(dir, f));
	};
	const cold = build();
	assert.ok(cold[0].includes("<span class=\"line highlighted\"><span class=\"hl-keyword\">let</span>"), cold[0]);
	const text = fs.readFileSync(cache, "utf8");
	// The site's own highlighter isn't ssqch's to keep: it runs on every build.
	for (const [expected, kept] of [["\"js\",\"const a = 1;\\nlet b = \\\"two\\\";\\n\",[2],", true], ["\"nonsense\",\"<x>\\n\",[],null]", true], ["\"edge\"", true], ["\"bash\"", true], ["Old Growth", false]]) {
		assert.equal(text.includes(expected), kept, `${expected} in\n${text}`);
	}

	// Warm: the same bytes, and a cache with nothing new isn't written.
	fs.utimesSync(cache, new Date(0), new Date(0));
	assert.deepEqual(build(), cold);
	assert.equal(fs.statSync(cache).mtimeMs, 0);

	// A cache that can't be read, or another highlighter's, is ignored and written again.
	for (const bad of [text.slice(0, text.length / 2), "pine cones", text.replace(/"highlighter":"[^"]*"/, "\"highlighter\":\"an old one\"").replaceAll("hl-keyword", "hl-stump")]) {
		fs.writeFileSync(cache, bad);
		assert.deepEqual(build(), cold);
		assert.equal(fs.readFileSync(cache, "utf8"), text);
	}

	// Fences the build no longer has leave the cache.
	fs.rmSync(path.join(dir, "src/more.md"));
	build();
	assert.ok(!fs.readFileSync(cache, "utf8").includes("\"bash\""));
});

// expressjs.com (ex #4): MDX components take props and named slots (`<Fragment slot="title">`), and
// every container template in the port parsed `container.args` and split marked slots itself.
test("containers_get_props_and_named_slots", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"njk\", \"md\"] };\n",
		"_includes/containers/card.njk": "<div class=\"card {{ container.props.type }}\" data-open=\"{{ container.props.open }}\" data-size=\"{{ container.props.size }}\" data-n=\"{{ container.props.items | length }}\"><h3>{{ container.slots.title | safe }}</h3>{{ container.content | safe }}<footer>{{ container.slots.footer | safe }}</footer></div>\n",
		"index.md": [
			":::: card type=\"tip\" open size=3 items='[\"Cedar\",\"Old Growth\"]'",
			"Squatch Snacks, **crunchy**.",
			"",
			"::: slot title",
			"Pine *Cone* Crunch",
			":::",
			"",
			"::: slot name=\"footer\"",
			"Leave no trace.",
			":::",
			"::::",
			"",
			"::: note",
			"::: slot aside",
			"No template takes this slot, so it stays where it is.",
			":::",
			":::",
			"",
		].join("\n"),
	});
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(root, "_site/index.html"), [
		"<div class=\"card tip\" data-open=\"true\" data-size=\"3\" data-n=\"2\"><h3><p>Pine <em>Cone</em> Crunch</p>",
		"</h3><p>Squatch Snacks, <strong>crunchy</strong>.</p>",
		"<footer><p>Leave no trace.</p>",
		"</footer></div>",
		"<div class=\"note\">",
		"<p>No template takes this slot, so it stays where it is.</p>",
		"</div>",
		"",
	].join("\n"));

	// `slot` is ssqch's, so a template for it is refused.
	const own = project({ "ssqch.config.js": "export default { templateFormats: [\"njk\", \"md\"] };\n", "_includes/containers/slot.njk": "x", "index.md": "hi\n" });
	const b = ssqch(["build", "--root", own]);
	assert.ok(!b.ok);
	assert.match(b.log, /containers\/slot\.njk: `slot` is ssqch's container for a named slot/);
});

// opensource.guide (osg #11): jekyll-toc's markup (`<ul class="section-nav">`, `toc-entry toc-h2`)
// is CSS a site keeps, so `toc` can write it.
test("toc_sets_the_lists_items_and_links_classes", () => {
	const root = project({
		"ssqch.config.js": "export default { templateFormats: [\"njk\", \"md\", \"liquid\"] };\n",
		"_includes/trail.njk": "{{ toc(page.headings, { id: \"toc\", class: \"section-nav\", sublistClass: \"sub\", itemClass: \"toc-entry toc-h{level}\", linkClass: \"jump\" }) | safe }}\n",
		"_includes/trail.liquid": "{{ page.headings | toc: class: \"section-nav\", itemClass: \"toc-entry toc-h{level}\" }}\n",
		"cedar.md": "---\nlayout: trail.njk\n---\n## Pine cones\n### Crunch\n## Stumps\n",
		"ridge.md": "---\nlayout: trail.liquid\n---\n## Pine cones\n### Crunch\n",
	});
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(root, "_site/cedar/index.html"), "<ul id=\"toc\" class=\"section-nav\"><li class=\"toc-entry toc-h2\"><a href=\"#pine-cones\" class=\"jump\">Pine cones</a><ul class=\"sub\"><li class=\"toc-entry toc-h3\"><a href=\"#crunch\" class=\"jump\">Crunch</a></li></ul></li><li class=\"toc-entry toc-h2\"><a href=\"#stumps\" class=\"jump\">Stumps</a></li></ul>\n");
	assert.equal(read(root, "_site/ridge/index.html"), "<ul class=\"section-nav\"><li class=\"toc-entry toc-h2\"><a href=\"#pine-cones\">Pine cones</a><ul><li class=\"toc-entry toc-h3\"><a href=\"#crunch\">Crunch</a></li></ul></li></ul>\n");
	const bad = project({ "ssqch.config.js": "export default { templateFormats: [\"njk\", \"md\"] };\n", "_includes/t.njk": "{{ toc(page.headings, { klass: \"x\" }) | safe }}\n", "a.md": "---\nlayout: t.njk\n---\n## A\n" });
	assert.match(ssqch(["build", "--root", bad]).log, /unknown option `klass` \(options: from, to, ordered, id, class, sublistClass, itemClass, linkClass\)/);
});

// markdown-it's habits as options, for a site that moves with the output it had: `breaks` (374
// line breaks on a11yproject.com, a11y #12, #25), `autolinks: "fuzzy"` (its `linkify`), and
// `figures` (markdown-it-implicit-figures, 74 v8.dev pages, v8 #24). Each expected string is what
// markdown-it 13.0.2 wrote for the same Markdown.
test("markdown_its_habits_are_options", () => {
	const dir = tempDir("markdown-habits");
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default { markdown: { breaks: true, figures: true, autolinks: \"fuzzy\" } };\n");
	w("index.md", "Pine\ncone at example.com or ranger@example.com, not node.js.\n\n![A *pine* cone](/cone.jpg)\n\n[![Map](/map.png)](/trails/)\n");
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<p>Pine<br>\ncone at <a href=\"http://example.com\">example.com</a> or <a href=\"mailto:ranger@example.com\">ranger@example.com</a>, not node.js.</p>\n<figure><img src=\"/cone.jpg\" alt=\"\"><figcaption>A <em>pine</em> cone</figcaption></figure>\n<figure><a href=\"/trails/\"><img src=\"/map.png\" alt=\"\"></a><figcaption>Map</figcaption></figure>\n");
	w("ssqch.config.js", "export default { markdown: { autolinks: \"lots\" } };\n");
	r = ssqch(["build", "--root", dir]);
	// DELIBERATE (0.12): `"email"` is a value too (VitePress's markdown-it, from the vuejs.org run).
	assert.ok(!r.ok && r.log.includes("markdown.autolinks must be true, false, \"email\" or \"fuzzy\", not \"lots\""), r.log);
	w("ssqch.config.js", "export default { markdown: { figures: \"yes\" } };\n");
	r = ssqch(["build", "--root", dir]);
	assert.ok(!r.ok && r.log.includes("markdown.figures must be true or false, not string"), r.log);
});

// A site keeps its highlighting theme's CSS (v8 B3: most Eleventy sites with code use the Prism
// plugin; lit.dev's CSS styles CodeMirror's classes): `highlight: { classes }` names the tokens
// as another highlighter does, and the stylesheet follows.
test("highlighting_can_use_another_highlighters_classes", () => {
	const dir = tempDir("highlight-classes");
	const w = (p, t) => write(dir, { [p]: t });
	w("ssqch.config.js", "export default { markdown: { highlight: { classes: \"prism\" } } };\n");
	w("index.md", "```js {2}\nlet a = 1;\nf(a);\n```\n");
	let r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<pre class=\"language-js\"><code class=\"language-js\"><span class=\"token keyword\">let</span> a <span class=\"token operator\">=</span> <span class=\"token number\">1</span>;\n<mark class=\"highlight-line highlight-line-active\"><span class=\"token function\">f</span>(a);</mark>\n</code></pre>\n");
	const css = read(dir, "_site/highlight.css");
	assert.ok(css.includes("\n.token.keyword { color: var(--hl-keyword); }\n") && css.includes("\n.highlight-line-active {") && !css.includes(".hl-keyword"), css);
	w("ssqch.config.js", "export default { markdown: { highlight: { classes: { keyword: \"tok-keyword\", type: \"tok-typeName\" } } } };\n");
	r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.ok(read(dir, "_site/index.html").startsWith("<pre class=\"highlight\"><code class=\"language-js\"><span class=\"line\"><span class=\"tok-keyword\">let</span>"), read(dir, "_site/index.html"));
	w("ssqch.config.js", "export default { markdown: { highlight: { classes: \"codemirror\" } } };\n");
	r = ssqch(["build", "--root", dir]);
	// DELIBERATE (0.11): "pygments" (and "chroma") are classes too, for MkDocs' and Hugo's themes.
	assert.ok(!r.ok && r.log.includes("markdown.highlight.classes must be \"prism\", \"pygments\" or an object of { kind: \"class names\" }, not \"codemirror\""), r.log);
});

// GitHub Pages' Rouge puts `class="language-plaintext highlighter-rouge"` on every code span, and a
// Jekyll site's CSS styles it (osg #4): `_includes/hooks/code.*` writes code spans, given their text.
test("a_code_hook_writes_code_spans", () => {
	const dir = tempDir("code-hook");
	const w = (p, t) => write(dir, { [p]: t });
	w("_includes/hooks/code.jinja", "<code class=\"language-plaintext highlighter-rouge\">{{ code.code }}</code>");
	w("index.md", "Run `ssqch build` and `a < b`.\n\n```js\nx\n```\n");
	const r = ssqch(["build", "--root", dir]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<p>Run <code class=\"language-plaintext highlighter-rouge\">ssqch build</code> and <code class=\"language-plaintext highlighter-rouge\">a &lt; b</code>.</p>\n<pre><code class=\"language-js\">x\n</code></pre>\n");
});

// Added in 0.11, from the fresh opensource.guide move: config code's `markdown()` takes the
// template function's `"inline"` too, where it failed with `unknown option "0"`.
test("config_markdown_takes_inline_as_templates_do", () => {
	const dir = tempDir("markdown-inline");
	write(dir, {
		"ssqch.config.js": "import { markdown } from \"ssqch\";\nexport default { data: { a: markdown(\"*a*\", \"inline\"), b: markdown(\"*b*\", { inline: true }) } };\n",
		"index.jinja": "{{ a | safe }}|{{ b | safe }}",
	});
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<em>a</em>|<em>b</em>");
	write(dir, { "ssqch.config.js": "import { markdown } from \"ssqch\";\nexport default { data: { a: markdown(\"*a*\", \"block\") } };\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("markdown(): unknown option \"block\" (give \"inline\", or { inline: true })"), r.log);
});

// Added in 0.11, from opensource.guide (3,791 `markdown="1"` elements, 325 pages with raw
// `[@name](url)` credits without them): kramdown's Markdown inside HTML, and its heading ids.
test("kramdowns_markdown_inside_html", () => {
	const dir = tempDir("markdown-kramdown");
	write(dir, {
		"ssqch.config.js": "export default { markdown: { htmlMarkdown: \"kramdown\", headingIds: \"kramdown\" } };\n",
		"index.md": "# Pine 🌲 trail\n\n<aside markdown=\"1\" class=\"note\">\n## Café *notes*\n\n- [@ranger](https://example.com)\n\n</aside>\n## After\n\n<p markdown=\"1\">A *quote*</p>\n\n<div>\nraw *stays*\n\nstill raw\n</div>\n",
		"other.jinja": "{{ markdown('<p markdown=\"1\">*a*</p>') | safe }}",
	});
	let r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<h1 id=\"pine--trail\">Pine 🌲 trail</h1>\n<aside class=\"note\">\n<h2 id=\"caf-notes\">Café <em>notes</em></h2>\n<ul>\n<li><a href=\"https://example.com\">@ranger</a></li>\n</ul>\n</aside>\n<h2 id=\"after\">After</h2>\n<p>A <em>quote</em></p>\n<div>\nraw *stays*\nstill raw\n</div>\n");
	// The `markdown` function too, as Jekyll's `markdownify`.
	assert.equal(read(dir, "_site/other/index.html"), "<p><em>a</em></p>");
	// Off (the default), the element is CommonMark's HTML.
	write(dir, { "ssqch.config.js": "export default {};\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(read(dir, "_site/index.html").includes("<p markdown=\"1\">A *quote*</p>"), read(dir, "_site/index.html"));
	write(dir, { "ssqch.config.js": "export default { markdown: { htmlMarkdown: true } };\n" });
	r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(!r.ok && r.log.includes("markdown.htmlMarkdown must be \"kramdown\" or false, not boolean"), r.log);
});

// Added in 0.11, from the a11yproject.com rerun: a layout adds the only `h2` on some pages, so
// `page.headings` has none; `toc()` takes HTML too, as eleventy-plugin-nesting-toc did.
test("toc_takes_html_for_headings_a_layout_adds", () => {
	const dir = tempDir("toc-html");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"md\", \"njk\"] };\n",
		"index.md": "---\nlayout: featured.njk\n---\nSome text.\n",
		"_includes/featured.njk": "---\nlayout: base.njk\n---\n<h2 id=\"spotlight\">Spotlight</h2>\n{{ content | safe }}",
		"_includes/base.njk": "<nav>{{ toc(content) | safe }}</nav><nav>{{ toc(page.headings) | safe }}</nav>",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<nav><ul><li><a href=\"#spotlight\">Spotlight</a></li></ul></nav><nav></nav>");
});

// Added in 0.11, from the a11yproject.com rerun: markdown-it-anchor's ids are encodeURIComponent's
// (50 pages' ids with `’`, `:` or `?` changed, and links to them broke).
test("heading_ids_like_markdown_it_anchors", () => {
	const dir = tempDir("markdown-it-anchor-ids");
	write(dir, {
		"ssqch.config.js": "export default { markdown: { headingIds: \"markdown-it-anchor\" } };\n",
		"index.md": "## What’s new: Café?\n\n## What’s new: Café?\n",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<h2 id=\"what%E2%80%99s-new%3A-caf%C3%A9%3F\">What’s new: Café?</h2>\n<h2 id=\"what%E2%80%99s-new%3A-caf%C3%A9%3F-1\">What’s new: Café?</h2>\n");
});

// Added in 0.11, from the fresh opensource.guide rerun: a link without a title had `link.title` as
// `""`, which Liquid counts as true (`title=""` on 343 pages). It's nothing now.
test("a_link_without_a_title_has_none_in_its_hook", () => {
	const dir = tempDir("link-title");
	write(dir, {
		"ssqch.config.js": "export default { templateFormats: [\"md\", \"liquid\"] };\n",
		"_includes/hooks/link.liquid": "<a href=\"{{ link.href }}\"{% if link.title %} title=\"{{ link.title }}\"{% endif %}>{{ link.text }}</a>",
		"_includes/hooks/image.liquid": "<img src=\"{{ image.src }}\" alt=\"{{ image.alt }}\"{% if image.title %} title=\"{{ image.title }}\"{% endif %}>",
		"index.md": "[a](/x) [b](/y \"Why\") ![c](/c.png)\n",
	});
	const r = ssqch(["build", "--root", dir, "-q"]);
	assert.ok(r.ok, r.log);
	assert.equal(read(dir, "_site/index.html"), "<p><a href=\"/x\">a</a> <a href=\"/y\" title=\"Why\">b</a> <img src=\"/c.png\" alt=\"c\"></p>\n");
});
