import { test } from "node:test";
import assert from "node:assert/strict";
import { bindingValue, mayHaveComponents, renderComponents } from "./components.ts";
import type { ComponentValue } from "./components.ts";

const seen: ComponentValue[] = [];
const render = (name: string, value: ComponentValue) => {
	seen.push(value);
	if (name === "Badge") return `<span class="badge">${String(value.props.text ?? value.content)}</span>`;
	if (name === "VueSchoolLink") return `<a href="${String(value.props.href)}">${value.content}</a>`;
	return undefined;
};

test("components_render_through_their_templates", () => {
	seen.length = 0;
	const unknown: string[] = [];
	const html = renderComponents("<p><VueSchoolLink href=\"/x\" title='Free'>Watch <Badge text=\"new\" /></VueSchoolLink> and <Trail-Map>?</Trail-Map> <Mystery a=1>kept</Mystery></p>", render, {}, (n) => unknown.push(n));
	assert.equal(html, "<p><a href=\"/x\">Watch <span class=\"badge\">new</span></a> and <Trail-Map>?</Trail-Map> <Mystery a=1>kept</Mystery></p>");
	assert.deepEqual(unknown, ["Mystery"]);
	// The innermost first, and its attributes as written.
	assert.deepEqual(seen.map((v) => v.name), ["Badge", "VueSchoolLink", "Mystery"]);
	assert.equal(seen[1].attrs, " href=\"/x\" title=\"Free\"");
});

test("code_comments_and_html_names_are_left_alone", () => {
	const html = "<pre><code>&lt;Badge /&gt;<Badge text=\"x\" /></code></pre><!-- <Badge /> --><script>const a = \"<Badge />\";</script><DIV>caps</DIV><linearGradient></linearGradient>";
	assert.equal(renderComponents(html, render, {}), html);
	assert.equal(mayHaveComponents("<div><p>pine</p></div>"), false);
});

test("nesting_the_same_component_finds_its_own_end_tag", () => {
	const nest = (name: string, v: ComponentValue) => (name === "Box" ? `[${v.content}]` : undefined);
	assert.equal(renderComponents("<Box>a<Box>b</Box>c</Box><Box/>", nest, {}), "[a[b]c][]");
});

test("bindings_read_the_pages_data_and_vues_literals", () => {
	const data = { title: "Cedar Trail", page: { url: "/cedar/" } };
	assert.equal(bindingValue("title", data), "Cedar Trail");
	assert.equal(bindingValue("$frontmatter.title", data), "Cedar Trail");
	assert.equal(bindingValue("page.url", data), "/cedar/");
	assert.equal(bindingValue("3", data), 3);
	assert.equal(bindingValue("true", data), true);
	assert.equal(bindingValue("'pine cones'", data), "pine cones");
	assert.deepEqual(bindingValue("['a', 'b',]", data), ["a", "b"]);
	assert.deepEqual(bindingValue("{ size: 2, name: 'x' }", data), { size: 2, name: "x" });
	assert.equal(bindingValue("count + 1", data), "count + 1");
	seen.length = 0;
	renderComponents("<Badge :count=\"2\" v-if=\"ok\" @click=\"go\" data-size=\"lg\" disabled />", render, data);
	assert.deepEqual(seen[0].props, { count: 2, "data-size": "lg", dataSize: "lg", disabled: true });
	assert.equal(seen[0].attrs, " data-size=\"lg\" disabled");
});

// JSX's values, as MDX and React pages write them (a layout's or an HTML page's tag, which no
// Markdown step rewrites): before, `height={500}` was the text "{500}", and a space split it.
test("jsx_values_are_bindings", () => {
	const data = { title: "Cedar Trail" };
	seen.length = 0;
	renderComponents("<Badge height={500} open={true} style={{ color: \"red\" }} text={title} label=\"{cones}\" />", render, data);
	assert.deepEqual(seen[0].props, { height: 500, open: true, style: { color: "red" }, text: "Cedar Trail", label: "{cones}" });
	assert.deepEqual(seen[0].bindings, { height: "500", open: "true", style: "{ color: \"red\" }", text: "title" });
	assert.equal(seen[0].attrs, " label=\"{cones}\"");
});
