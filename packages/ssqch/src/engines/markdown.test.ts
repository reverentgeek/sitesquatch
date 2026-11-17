// The Node side of ssqch's Markdown: what goes into the wasm and what comes back. The Markdown
// itself is 0.7's, tested in crates/sitesquatch/src/markdown.rs (and again in
// crates/ssqch-markdown); the oracle compares whole sites with 0.7's.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultMarkdownOptions } from "../markdown-options.ts";
import type { MarkdownOptions } from "../markdown-options.ts";
import { capture, takeWarnings } from "../diagnostics.ts";
import { Engines, plainEngine } from "./engine.ts";
import type { TemplateEngine } from "./engine.ts";
import { checkLanguages, loadHookTemplates, markdownEngine, rendering } from "./markdown.ts";
import type { HookTemplate } from "./markdown.ts";

const options = (change: Partial<MarkdownOptions> = {}): MarkdownOptions => ({ ...defaultMarkdownOptions(), ...change });
const ctx = { name: "page.md", inputPath: "/site/page.md" };

/** An engine whose templates are `{{ key.field }}` and `{{ md:key.field }}` (Markdown of it, inline). */
function tiny(markdown: () => ReturnType<typeof markdownEngine>): TemplateEngine {
	return {
		render: (source, data) => source.replace(/\{\{ (md:)?([\w.]+) \}\}/g, (_, md: string | undefined, name: string) => {
			const value = String(name.split(".").reduce((v: any, k) => v?.[k], data));
			return md ? markdown().html(value, true) : value;
		}),
	};
}

function hooked(templates: Record<string, string>, engine: (md: () => ReturnType<typeof markdownEngine>) => TemplateEngine = tiny) {
	const md = markdownEngine(options());
	const engines = new Engines();
	engines.byName.set("t", engine(() => md));
	engines.byName.set("md", md);
	engines.byName.set("html", plainEngine);
	const hooks = new Map<string, HookTemplate>(Object.entries(templates).map(([name, body]) => [name, { name: `_includes/${name}.t`, engines: ["t"], body, path: `/site/_includes/${name}.t` }]));
	md.useHooks(hooks, engines);
	return md;
}

test("markdown_is_0_7s", () => {
	const md = markdownEngine(options());
	assert.equal(md.render("# Hi\n\n::: tip Look\nA[^1] **b**\n:::\n\n[^1]: Note.\n", {}, ctx), "<h1 id=\"hi\">Hi</h1>\n<div class=\"tip\">\n<p class=\"container-title\">Look</p>\n<p>A<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup> <strong>b</strong></p>\n</div>\n<section class=\"footnotes\">\n<ol>\n<li id=\"fn-1\">\n<p>Note. <a href=\"#fnref-1\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a></p>\n</li>\n</ol>\n</section>\n");
	assert.equal(md.html("*one* paragraph", true), "<em>one</em> paragraph");
	assert.equal(md.plain("ünï 🦀 \"q\"", false), "<p>ünï 🦀 &quot;q&quot;</p>\n");
	assert.equal(markdownEngine(options({ headingIds: "blackfriday", smartPunctuation: true })).render("# A -- B\n", {}, ctx), "<h1 id=\"a-b\">A – B</h1>\n");
	assert.equal(md.highlight("let a = 1;", "js"), "<span class=\"hl-keyword\">let</span> a <span class=\"hl-operator\">=</span> <span class=\"hl-number\">1</span>;");
	assert.equal(md.highlight("x", "nonsense"), undefined);
	assert.ok(md.css().includes(".hl-keyword { color: var(--hl-keyword); }"));
});

test("render_hooks_get_the_page_and_can_render_markdown_themselves", () => {
	const md = hooked({ "hooks/heading": "<h{{ heading.level }} data-t=\"{{ title }}\">{{ md:heading.text }}</h{{ heading.level }}>", "containers/note": "<aside>{{ container.args }}|{{ md:container.args }}</aside>" });
	assert.equal(md.render("# A *b*\n\n::: note *x*\n:::\n", { title: "Trail" }, ctx), "<h1 data-t=\"Trail\">A b</h1>\n<aside>*x*|<em>x</em></aside>\n");
	// `markdown()` in a template runs the hooks without the page's data; the `ssqch` module's doesn't run them.
	assert.equal(md.html("# Hi", false), "<h1 data-t=\"undefined\">Hi</h1>\n");
	assert.equal(md.plain("# Hi", false), "<h1 id=\"hi\">Hi</h1>\n");
});

test("a_hook_that_fails_or_waits_says_which_it_is", () => {
	const failing = hooked({ "hooks/link": "x" }, () => ({ render: () => { throw new Error("no pine cones"); } }));
	assert.throws(() => failing.render("[a](/b)\n", {}, ctx), { message: "rendering _includes/hooks/link.t: no pine cones" });
	const waiting = hooked({ "hooks/link": "x" }, () => ({ render: async () => "late" }));
	assert.throws(() => waiting.render("[a](/b)\n", {}, ctx), { message: /^rendering _includes\/hooks\/link\.t: it answered with a promise/ });
	// The instance carries on after an error.
	assert.equal(waiting.render("plain\n", {}, ctx), "<p>plain</p>\n");
});

test("the_sites_functions_are_called_back", () => {
	const md = markdownEngine(options({ sluggerFn: (text) => `id-${String(text).length}`, highlight: true, languages: [["trail", (code: string) => [[code, "keyword"]]], ["path", { alias: "trail" }], ["nope", () => undefined]] }));
	assert.equal(md.render("# Hi\n\n# Hi\n\n```path\nx\n```\n", {}, ctx), "<h1 id=\"id-2\">Hi</h1>\n<h1 id=\"id-2-1\">Hi</h1>\n<pre class=\"highlight\"><code class=\"language-path\"><span class=\"hl-keyword\">x</span>\n</code></pre>\n");
	capture();
	try {
		const before = rendering("./src/page.md");
		assert.equal(md.highlight("x", "nope"), undefined);
		rendering(before);
		const [warning] = takeWarnings();
		assert.equal(warning.message, "src/page.md: a `nope` fence is plain text: markdown.highlight.languages.nope returned undefined, not a list of tokens ([text, kind] pairs or { text, kind } objects)");
		assert.equal(warning.file, "src/page.md");
		assert.equal(warning.code, "config");
	} finally {
		capture(false);
	}
	const throwing = markdownEngine(options({ sluggerFn: () => { throw new Error("no ids"); } }));
	assert.throws(() => throwing.render("# Hi\n", {}, ctx), { message: /^markdown\.headingIds: no ids/ });
});

test("grammars_and_aliases_are_checked_with_the_config", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-md-"));
	fs.mkdirSync(path.join(root, "grammars"));
	fs.writeFileSync(path.join(root, "grammars/snack.sublime-syntax"), "%YAML 1.2\n---\nname: Snack\nscope: source.snack\ncontexts:\n  main:\n    - match: '\\bcrunch\\b'\n      scope: keyword.control.snack\n");
	const snack = options({ highlight: true, languages: [["snack", { grammar: "grammars/snack.sublime-syntax" }], ["bite", { alias: "snack" }]] });
	checkLanguages(snack, root);
	assert.equal(markdownEngine(snack, root).highlight("crunch", "bite"), "<span class=\"hl-keyword\">crunch</span>");
	assert.throws(() => checkLanguages(options({ languages: [["x", { grammar: "grammars/missing.sublime-syntax" }]] }), root), { message: /^markdown\.highlight\.languages\.x: reading grammars\/missing\.sublime-syntax: / });
	assert.throws(() => checkLanguages(options({ languages: [["a", { alias: "b" }], ["b", { alias: "a" }]] }), root), { message: "markdown.highlight.languages: these aliases go in a circle: a -> b -> a" });
	fs.rmSync(root, { recursive: true });
});

test("hook_templates_are_found_as_0_7_found_them", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-hooks-"));
	const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
	write("hooks/heading.t", "---\nx: 1\n---\n<h1>");
	write("hooks/.hidden.t", "no");
	write("hooks/README", "no");
	write("containers/note.html", "<aside>");
	const engines = new Engines();
	engines.byName.set("t", plainEngine);
	engines.byName.set("html", plainEngine);
	const found = loadHookTemplates(root, "_includes", engines, (ext) => (ext === "html" ? ["t", "html"] : [ext]));
	assert.deepEqual([...found.entries()].map(([key, t]) => [key, t.name, t.engines, t.body]), [["hooks/heading", "_includes/hooks/heading.t", ["t"], "<h1>"], ["containers/note", "_includes/containers/note.html", ["t", "html"], "<aside>"]]);
	write("hooks/heading.html", "again");
	assert.throws(() => loadHookTemplates(root, "_includes", engines, (ext) => [ext]), { message: "_includes/hooks/heading.html and _includes/hooks/heading.t are both templates for `hooks/heading`; keep one" });
	write("hooks/link.pug", "a");
	assert.throws(() => loadHookTemplates(root, "_includes", engines, (ext) => [ext]), { message: /^_includes\/hooks\/heading\.html and/ });
	fs.rmSync(path.join(root, "hooks/heading.html"));
	assert.throws(() => loadHookTemplates(root, "_includes", engines, (ext) => [ext]), { message: "_includes/hooks/link.pug: no template engine named `pug` (known: html, t)" });
	fs.rmSync(root, { recursive: true });
});
