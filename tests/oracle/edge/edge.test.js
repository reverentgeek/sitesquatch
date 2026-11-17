// From crates/sitesquatch-edge/tests/edge.rs.
//
// The Rust tests call the Edge engine directly: `render(src, json)` renders a template string with
// data. Here each render is a tiny site built by the binary: `index.edge` (templateFormats is
// ["edge"], no layout), with the data in its front matter (or in the config's `data` for the tests
// that read an error's line numbers, so the front matter doesn't move them), the partials and
// components in `_includes/`, and the Rust engine's `upper` global as a config filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, project, read, FIXTURES } from "../lib/ssqch.js";

const CONFIG = (data) => `export default { templateFormats: ["edge"], filters: { upper: (s) => String(s).toUpperCase() }${data ? `, data: ${JSON.stringify(data)}` : ""} };\n`;

/** The files of a site whose one page is `src`; `partials` maps include names to template text. */
function files(src, data, partials, { inConfig = false } = {}) {
	const out = { "ssqch.config.js": CONFIG(inConfig ? data : undefined) };
	for (const [name, text] of Object.entries(partials)) out[`_includes/${name}.edge`] = text;
	if (inConfig) {
		out["index.edge"] = src;
	} else {
		// A page's `page` is the site's own, so the page that wants page.url gets that URL.
		const url = data.page?.url ?? "/out.html";
		const { page, ...rest } = data;
		out["index.edge"] = `---\n${JSON.stringify({ ...rest, permalink: url })}\n---\n${src}`;
	}
	return out;
}

/** Renders `src` with `data` (an object) and `partials`; returns the output. */
function render(src, data = "{}", partials = {}) {
	if (typeof data === "string") data = JSON.parse(data);
	const root = project(files(src, data, partials));
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(r.ok, r.log);
	const url = data.page?.url ?? "/out.html";
	return read(root, url.endsWith("/") ? `_site${url}index.html` : `_site${url}`);
}

/** The error text of rendering `src` (the binary's `error: ` prefix removed). */
function renderError(src, data = "{}", partials = {}) {
	if (typeof data === "string") data = JSON.parse(data);
	const root = project(files(src, data, partials, { inConfig: true }));
	const r = ssqch(["build", "--root", root, "--quiet"]);
	assert.ok(!r.ok, `expected an error, but the build worked:\n${r.log}`);
	return r.log.replace(/^error: /, "");
}

test("mustaches_escape_and_raw", () => {
	assert.equal(render("{{ a }}|{{{ a }}}", `{"a":"<b>"}`), "&lt;b&gt;|<b>");
	assert.equal(render("{{ missing }}", "{}"), "");
	assert.equal(render("{{-- gone --}}x", "{}"), "x");
	assert.equal(render("@{{ raw }}", "{}"), "{{ raw }}");
});

test("js_expressions", () => {
	const d = `{"site":{"url":"https://x.com"},"page":{"url":"/a/"},"n":2,"tags":["posts","js"],"s":"/img/a.png"}`;
	assert.equal(render("{{ site.url + page.url }}", d), "https://x.com/a/");
	assert.equal(render("{{ n ? 'Page ' + (n + 1) : 'Home' }}", d), "Page 3");
	assert.equal(render("{{ tags.includes('posts') && tags.length }}", d), "2");
	assert.equal(render("{{ s.startsWith('http') ? s : site.url + s }}", d), "https://x.com/img/a.png");
	assert.equal(render("{{ tags.slice().reverse().slice(0, 1) }}", d), "js");
	assert.equal(render("{{ { tip: 'T', note: 'N' }[kind || 'note'] || 'X' }}", d), "N");
	assert.equal(render("{{ tags.map(t => upper(t)).join(' ') }}", d), "POSTS JS");
	assert.equal(render("{{ `${n * 1.5}rem` }}", d), "3rem");
	assert.equal(render("{{ await upper('x') }}", d), "X");
	assert.equal(render("{{ nope?.deep.chain }}", d), "");
	assert.equal(render("{{{ JSON.stringify({ a: 1, b: [true] }) }}}", d), `{"a":1,"b":[true]}`);
});

test("conditionals_loops_and_whitespace", () => {
	let src = "<ul>\n  @each((item, i) in items)\n  <li>{{ i }}:{{ item }}</li>\n  @end\n</ul>";
	assert.equal(render(src, `{"items":["a","b"]}`), "<ul>\n  <li>0:a</li>\n  <li>1:b</li>\n</ul>");

	// Expected values are Edge.js 6.5.1's output.
	src = "@if(x)\nyes\n@elseif(y)\nmaybe\n@else\nno\n@end\n";
	assert.equal(render(src, `{"x":1}`), "yes");
	assert.equal(render(src, `{"y":1}`), "maybe");

	// Same as Edge.js: `~` drops the newline that would precede the next text line.
	src = "  <title>\n@if(t)~\n{{ t }}\n@end~\n  </title>";
	assert.equal(render(src, `{"t":"Hi"}`), "  <title>Hi  </title>");

	src = "@each(x in list)\n{{ x }}\n@else\nempty\n@end";
	assert.equal(render(src, `{"list":[]}`), "empty");
});

test("text_files_keep_their_lines", () => {
	const src = "/feed.xml\n  type: atom\n@if(on)\n/a  /b\n@end\n# end\n";
	assert.equal(render(src, `{"on":true}`), "/feed.xml\n  type: atom\n/a  /b\n# end");
	assert.equal(render(src, "{}"), "/feed.xml\n  type: atom\n# end");
});

test("let_and_assign_with_multiline_args", () => {
	const src = "@let(label = {\n  tip: 'Pro tip',\n  note: 'Note'\n}[type || 'note'] || 'Note')\n@if(force)\n  @assign(label = 'Forced')\n@end\n{{ label }}";
	assert.equal(render(src, `{"type":"tip"}`), "Pro tip");
	assert.equal(render(src, `{"force":true}`), "Forced");
});

test("includes_share_scope_and_components_isolate", () => {
	const partials = {
		"partials/greet": "Hello {{ name }}",
		"components/card": "[{{ title }}|{{ name }}|{{{ await $slots.main() }}}|{{{ $slots.foot ? $slots.foot() : '' }}}]",
	};
	const d = `{"name":"Ada"}`;
	assert.equal(render("@include('partials/greet')", d, partials), "Hello Ada");
	assert.equal(render("@!component('components/card', { title: 'T' })", d, partials), "[T|||]");
	const src = "@component('components/card', { title: 'T' })\nbody {{ name }}\n@slot('foot')\nF\n@end\n@end";
	// Edge.js gives "[T|undefined|body Ada|F]": it prints undefined values,
	// where ssqch prints nothing.
	assert.equal(render(src, d, partials), "[T||body Ada|F]");
});

test("errors_report_template_and_line", () => {
	const msg = renderError("line1\n{{ a.b.c }}", "{}");
	assert.ok(msg.includes("index.edge:2"), msg);
	assert.ok(msg.includes("Cannot read properties of undefined"), msg);
});

test("unknown_at_words_are_text", () => {
	assert.equal(render("@media (x) {}\nemail me @ home", "{}"), "@media (x) {}\nemail me @ home");
});

test("escapes_like_edge_js", () => {
	// Edge.js 6.5.1 renders `{{ s }}` with this value as the expected string. (The Rust test calls
	// the engine's `escape_html` function; here the escaping is checked through a mustache.)
	const s = "a & b < c > d \" e ' f ` g = h";
	assert.equal(render("{{ s }}", { s }), "a &amp; b &lt; c &gt; d &quot; e &#x27; f &#x60; g = h");
});

// Newline and `~` handling, checked against Edge.js 6.5.1: the expected
// outputs are what `edge.renderRaw(template, { xs: [1, 2] })` returns, with
// the same `c` component and `p` partial registered.
test("whitespace_matches_edge_js", () => {
	const cases = JSON.parse(fs.readFileSync(path.join(FIXTURES, "edge/whitespace-cases.json"), "utf8"));
	const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "edge/whitespace-expected.json"), "utf8"));
	const failures = [];
	cases.forEach((src, i) => {
		const want = expected[i];
		const got = render(src, `{"xs":[1,2]}`, { c: "<{{{ await $slots.main() }}}>[{{{ $slots.foot ? await $slots.foot() : \"\" }}}]", p: "\nP1\nP2\n" });
		if (got !== want) failures.push(`case ${i}: ${JSON.stringify(src)}\n  edge.js: ${JSON.stringify(want)}\n  ssqch:   ${JSON.stringify(got)}`);
	});
	assert.ok(failures.length === 0, failures.join("\n"));
});

test("a_call_reaches_the_filter_when_data_has_the_same_name", () => {
	// Page data named like a filter shadows it as a value, but calling it means the filter.
	const d = `{"upper":"a field","items":["a"]}`;
	assert.equal(render("{{ upper }}|{{ upper('x') }}|{{ items.map(i => upper(i)).join('') }}", d), "a field|X|A");
	// A loop variable or `@let` that's a function still wins.
	assert.equal(render("@let(upper = (s) => s + '!')\n{{ upper('x') }}", "{}"), "x!");
	const err = renderError("{{ nope('x') }}", `{"nope":"text"}`);
	assert.ok(err.includes("`nope` is not a function"), err);
});

test("an_include_loop_is_named", () => {
	// Two partials that include each other: the error has the loop once, not a line for each lap.
	let error = renderError("@include('a')\n", "{}", { a: "A\n@include('b')\n", b: "B\n@include('a')\n" });
	assert.ok(error.includes("b.edge:2: we've passed this tree before. Include loop: a -> b -> a"), error);
	// A component that uses itself. (A template's name is its file here: b.edge and card.edge, where the Rust engine said b and card.)
	error = renderError("@!component('card')\n", "{}", { card: "@!component('card')\n" });
	assert.ok(error.includes("card.edge:1: we've passed this tree before. Component loop: card -> card"), error);
	// A partial that includes itself a few levels deep (a tree) is fine, and the trail is empty after.
	const out = render("@include('node')\n", `{"n":3}`, { node: "{{ n }}\n@let(n = n - 1)\n@includeIf(n > 0, 'node')\n" });
	assert.equal(out.split(/\s+/).join(""), "321");
});
