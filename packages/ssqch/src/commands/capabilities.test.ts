import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../exports/ssqch.ts";
import * as image from "../exports/image.ts";
import * as rss from "../exports/rss.ts";
import * as assets from "../exports/assets.ts";
import * as links from "../exports/links.ts";
import * as sitemap from "../exports/sitemap.ts";
import * as redirects from "../exports/redirects.ts";
import * as sass from "../exports/sass.ts";
import * as elements from "../exports/elements.ts";
import * as minify from "../exports/minify.ts";
import { typedNames } from "./docs.ts";
import { MODULE_EXPORTS } from "./capabilities.ts";

// What `ssqch capabilities` says each module exports is what the module has, what `ssqch.d.ts` declares, and all it has.
test("each module exports what capabilities says", () => {
	const actual: Record<string, Record<string, unknown>> = { ssqch: api, "ssqch/image": image, "ssqch/rss": rss, "ssqch/assets": assets, "ssqch/links": links, "ssqch/sitemap": sitemap, "ssqch/redirects": redirects, "ssqch/sass": sass, "ssqch/elements": elements, "ssqch/minify": minify };
	assert.deepEqual(MODULE_EXPORTS.map(([name]) => name), Object.keys(actual));
	const declared = typedNames().filter((n) => n.kind === "module export");
	for (const [name, exports] of MODULE_EXPORTS) {
		for (const exported of exports) assert.equal(typeof actual[name][exported], "function", `${name} lacks ${exported}`);
		assert.deepEqual([...exports].sort(), declared.filter((n) => n.module === name).map((n) => n.name).sort(), `${name}: ssqch.d.ts declares other exports`);
		// `ssqch` has a default export too (`export default ssqch` in ssqch.d.ts); the build's helpers are no module's.
		assert.deepEqual(Object.keys(actual[name]).sort(), [...exports, ...(name === "ssqch" ? ["default"] : [])].sort(), `${name} exports more than ssqch.d.ts declares`);
	}
});
