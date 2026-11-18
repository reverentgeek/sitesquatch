// From crates/ssqch/tests/cli.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, read, RUST_07 } from "../lib/ssqch.js";

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
	// at `new` in `throw new Error(...)`; 0.7 ran the config on QuickJS, which says `Error`.
	const column = RUST_07 ? 31 : 27;
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
test("highlighted_fences_are_cached_between_builds_and_never_change_a_page", { skip: RUST_07 && "0.7 kept highlighted fences in memory only" }, () => {
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
