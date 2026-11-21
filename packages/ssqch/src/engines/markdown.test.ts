// The Node side of ssqch's Markdown: what goes into the wasm and what comes back. The Markdown
// itself is 0.7's, tested in crates/ssqch-markdown (`cargo test -p ssqch-markdown`); the oracle
// compares whole sites with their frozen output.
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
import { FENCE_CACHE, beginFenceCache, checkLanguages, crashForTest, loadHookTemplates, markdownEngine, rendering, saveFenceCache } from "./markdown.ts";
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

function hooked(templates: Record<string, string>, engine: (md: () => ReturnType<typeof markdownEngine>) => TemplateEngine = tiny, change: Partial<MarkdownOptions> = {}) {
	const md = markdownEngine(options(change));
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

test("hugo_shortcodes_inside_a_line_render_through_their_container_templates", () => {
	const md = hooked({ "containers/new-in": "<b>{{ container.args }}</b>", "containers/ref": "/docs/about/", "containers/kbd": "<kbd>{{ container.content }}|{{ container.source }}|{{ container.inline }}</kbd>" }, tiny, { shortcodes: "hugo" });
	const out = md.render("## Formats {{< new-in 1.2 />}}\n\nSee [it]({{< ref \"about\" >}}), press {{% kbd %}}*K* {{< new-in 2 />}}{{% /kbd %}}, {{< unknown x >}} and `{{< new-in 3 />}}`.\n", {}, ctx);
	assert.equal(out, "<h2 id=\"formats\">Formats <b>1.2</b></h2>\n<p>See <a href=\"/docs/about/\">it</a>, press <kbd><em>K</em> <b>2</b>|*K* {{< new-in 2 />}}|true</kbd>, {{&lt; unknown x &gt;}} and <code><b>3</b></code>.</p>\n");
	// In `markdown()` in a template too, and a shortcode in a fence or written with `/* */` stays.
	assert.equal(md.html("A {{< new-in 4 />}} {{</* new-in 5 */>}}\n\n```\n{{< new-in 6 />}}\n```", false), "<p>A <b>4</b> {{&lt; new-in 5 &gt;}}</p>\n<pre><code>{{&lt; new-in 6 /&gt;}}\n</code></pre>\n");
});

test("mkdocs_titles_are_inline_markdown", () => {
	const md = markdownEngine(options({ admonitions: "mkdocs", tabs: "mkdocs" }));
	const out = md.render("??? tip \"Read [the guide]\"\n    Body\n\n=== \"`base.html`\"\n    A\n\n!!! note\n    C\n\n[the guide]: /guide/\n", {}, ctx) as string;
	assert.ok(out.includes("<summary>Read <a href=\"/guide/\">the guide</a></summary>"), out);
	assert.ok(out.includes("<label for=\"__tabbed_1_1\"><code>base.html</code></label>"), out);
	assert.ok(out.includes("<p class=\"admonition-title\">Note</p>"), out);
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

test("a_pages_markdown_waits_for_async_functions_and_calls_each_once", async () => {
	const calls: string[] = [];
	const md = markdownEngine(options({
		highlight: true,
		sluggerFn: async (text) => { calls.push(`id ${text}`); await new Promise((r) => setTimeout(r, 1)); return text === "Same" ? "same" : `id-${calls.length}`; },
		languages: [["trail", async (code: string) => { calls.push(`trail ${code}`); return [[code, "keyword"]]; }], ["late", async () => { throw new Error("no pine cones"); }]],
	}));
	const out = md.render("# Same\n\n# Same\n\n## Other\n\n```trail\nA b\n```\n", {}, ctx);
	assert.ok(out instanceof Promise, "an async function makes the render async");
	assert.equal(await out, "<h1 id=\"same\">Same</h1>\n<h1 id=\"same-1\">Same</h1>\n<h2 id=\"id-3\">Other</h2>\n<pre class=\"highlight\"><code class=\"language-trail\"><span class=\"hl-keyword\">A b</span>\n</code></pre>\n");
	assert.deepEqual(calls, ["id Same", "id Same", "id Other", "trail A b\n"], "each called once, in 0.7's order");
	capture();
	try {
		assert.equal(await md.render("```late\nx\n```\n", {}, ctx), "<pre><code class=\"language-late\">x\n</code></pre>\n");
		assert.match(takeWarnings()[0].message, /a `late` fence is plain text: markdown\.highlight\.languages\.late failed: no pine cones/);
	} finally {
		capture(false);
	}
	const rejecting = markdownEngine(options({ sluggerFn: async () => { throw new Error("no ids"); } }));
	await assert.rejects(async () => rejecting.render("# Hi\n", {}, ctx), { message: /^markdown\.headingIds: no ids/ });
});

test("synchronous_functions_and_hooks_run_once_and_the_render_stays_synchronous", () => {
	let ids = 0;
	let hooks = 0;
	const md = hooked({ "hooks/heading": "<h{{ heading.level }} id=\"{{ heading.id }}\">{{ heading.text }}</h{{ heading.level }}>" }, (markdown) => {
		const engine = tiny(markdown);
		return { render: (source, data, c) => { hooks++; return engine.render(source, data, c); } };
	}, { sluggerFn: (text) => `${text}-${++ids}` });
	// A string, not a promise: a page that another reads (`templateContent`) can render on demand.
	assert.equal(md.render("# A\n\n# B\n", {}, ctx), "<h1 id=\"A-1\">A</h1>\n<h1 id=\"B-2\">B</h1>\n");
	assert.equal(ids, 2, "the slugger ran once a heading");
	assert.equal(hooks, 2, "the hook ran once a heading");
});

test("markdown_made_inside_a_template_says_it_cant_wait", () => {
	const md = markdownEngine(options({ sluggerFn: async () => "x", languages: [["trail", async (code: string) => [[code, "keyword"]]]] }));
	assert.throws(() => md.html("# Hi", false), { message: "markdown.headingIds answered with a promise, and markdown() in a template can't wait for one: it's made at once, while the template around it renders. Make the function synchronous (a page's own Markdown waits for it)" });
	assert.throws(() => md.plain("# Hi", false), { message: /^markdown\.headingIds answered with a promise, and markdown\(\) from "ssqch" can't wait for one/ });
	assert.throws(() => md.highlight("x", "trail"), { message: /^markdown\.highlight\.languages\.trail answered with a promise, and highlight\(\) in a template can't wait for one/ });
	// What has no function in it still renders.
	assert.equal(md.html("*a*", true), "<em>a</em>");
});

test("a_crash_in_the_wasm_names_the_page_and_the_next_render_starts_afresh", () => {
	const md = markdownEngine(options());
	assert.throws(() => crashForTest(md, "src/posts/trail.md"), { message: /^something large walked through the build: internal error while processing src\/posts\/trail\.md: it crashed \(.+\) \(this is a bug in ssqch; please report it at / });
	assert.equal(md.render("# Hi\n", {}, ctx), "<h1 id=\"hi\">Hi</h1>\n");
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

test("highlighted_fences_are_kept_on_disk_and_a_bad_cache_is_ignored", () => {
	const site = () => fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-fences-"));
	const md = markdownEngine(options({ highlight: true }));
	const fence = (code: string) => md.render("```js\n" + code + "\n```\n", {}, ctx) as string;
	// Each site's fences are code no other has, so the instance's memory can't answer for the disk.
	const build = (root: string, code: string) => {
		beginFenceCache(root);
		const html = fence(code);
		saveFenceCache();
		return html;
	};
	const cacheOf = (root: string) => path.join(root, FENCE_CACHE);

	const first = site();
	const html = build(first, "let snacks = 1;");
	assert.match(html, /<span class="hl-keyword">let<\/span>/);
	const text = fs.readFileSync(cacheOf(first), "utf8");
	assert.match(text, /^\{"highlighter":"[0-9a-f]{64}","languages":\["\[\]"\],"fences":\[\n\[0,"js","let snacks = 1;\\n",\[\],"<span/);
	// The same fences again: the file isn't written.
	fs.utimesSync(cacheOf(first), new Date(0), new Date(0));
	assert.equal(build(first, "let snacks = 1;"), html);
	assert.equal(fs.statSync(cacheOf(first)).mtimeMs, 0);
	// A build with other fences keeps only those; one with none leaves no file.
	build(first, "let crunch = 2;");
	assert.doesNotMatch(fs.readFileSync(cacheOf(first), "utf8"), /snacks/);
	beginFenceCache(first);
	saveFenceCache();
	assert.equal(fs.existsSync(cacheOf(first)), false);

	// A file of this highlighter's is taken as it is (which is how a new process gets its HTML).
	const put = (code: string, change: (text: string) => string) => {
		const root = site();
		fs.mkdirSync(path.dirname(cacheOf(root)), { recursive: true });
		fs.writeFileSync(cacheOf(root), change(text.replace("let snacks = 1;", code)));
		return root;
	};
	const poisoned = (t: string) => t.replace('"<span class=\\"hl-keyword\\">let</span>', '"<b>made up</b>');
	const taken = put("let ranger = 3;", poisoned);
	assert.match(build(taken, "let ranger = 3;"), /made up/);
	// Another highlighter's, half a file, or not JSON: ignored, highlighted afresh, and written again.
	const bad: Array<[string, (t: string) => string]> = [
		["let stump = 4;", (t) => poisoned(t).replace(/"highlighter":"[0-9a-f]+"/, `"highlighter":"${"0".repeat(64)}"`)],
		["let cone = 5;", (t) => poisoned(t).slice(0, t.length / 2)],
		["let trail = 6;", () => "pine cones"],
	];
	for (const [code, change] of bad) {
		const root = put(code, change);
		const fresh = build(root, code);
		assert.doesNotMatch(fresh, /made up/, code);
		assert.match(fresh, /hl-keyword/);
		assert.match(fs.readFileSync(cacheOf(root), "utf8"), /^\{"highlighter":"[0-9a-f]{64}".*\n.*hl-keyword.*\n\]\}\n$/s);
		fs.rmSync(root, { recursive: true });
	}
	for (const root of [first, taken]) fs.rmSync(root, { recursive: true });
});
