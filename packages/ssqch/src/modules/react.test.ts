// `reactPlugin()`'s own parts. Rendering needs the site's React, react-dom and esbuild, so the
// whole plugin is checked by the oracle (`cli/react.test.js`) on a site that has them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mdxToMarkdown, pageImports, tagLine } from "./react.ts";

test("a_pages_imports_name_its_components", () => {
	const page = "import Counter from \"./Counter.jsx\"\nimport { Tabs, TabItem as Tab, useThing } from '../tabs.tsx';\nimport {\n  Trail,\n} from \"@site/src/trail.jsx\"\nimport data from \"./data.json\"\n\n# Trail\n\n```js\nimport Not from \"./No.jsx\"\n```\n";
	const found = pageImports(page);
	assert.deepEqual(found.components, {
		Counter: { spec: "./Counter.jsx", export: "default", line: 0 },
		Tabs: { spec: "../tabs.tsx", export: "Tabs", line: 1 },
		Tab: { spec: "../tabs.tsx", export: "TabItem", line: 1 },
		Trail: { spec: "@site/src/trail.jsx", export: "Trail", line: 2 },
	});
	// A lower-case import (data, a hook) isn't a tag, so its line stays.
	assert.deepEqual([...found.lines].sort(), [0, 1, 2, 3, 4]);
});

test("mdx_imports_go_and_jsx_values_become_bindings", () => {
	const page = "import Counter from \"./Counter.jsx\"\n\n<Counter start={3} style={{ color: \"red\" }} label=\"Pine {cones}\"\n  open={true} {...rest} />\n\nInline `<Counter start={1} />` stays.\n\n```jsx\n<Counter start={2} />\n```\n";
	assert.equal(mdxToMarkdown(page), "\n\n<Counter :start=\"3\" :style=\"{ color: &quot;red&quot; }\" label=\"Pine {cones}\"   :open=\"true\" {...rest} />\n\nInline `<Counter start={1} />` stays.\n\n```jsx\n<Counter start={2} />\n```\n");
	// Nested braces and strings with braces in them close where JSX closes them.
	assert.equal(mdxToMarkdown("<Map pins={[{ x: 1, y: \"}\" }]} />"), "<Map :pins=\"[{ x: 1, y: &quot;}&quot; }]\" />");
	// HTML's own tags and a page without components are left alone.
	assert.equal(mdxToMarkdown("<div a={1}>x</div>\n"), "<div a={1}>x</div>\n");
});

test("a_tags_line_counts_outside_code", () => {
	const source = "---\ntitle: x\n---\n```\n<Boom />\n```\n<Boom />\n\n<Boom/>\n";
	assert.equal(tagLine(source, "Boom", 0), 7);
	assert.equal(tagLine(source, "Boom", 1), 9);
	// More tags than the page has: one in its layout.
	assert.equal(tagLine(source, "Boom", 2), undefined);
	assert.equal(tagLine(source, "Boomerang", 0), undefined);
});
