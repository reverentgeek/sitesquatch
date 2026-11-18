import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../api.ts";
import * as image from "../modules/image.ts";
import * as rss from "../modules/rss.ts";
import * as assets from "../modules/assets.ts";
import * as links from "../modules/links.ts";
import * as sitemap from "../modules/sitemap.ts";
import * as redirects from "../modules/redirects.ts";
import * as sass from "../modules/sass.ts";
import * as elements from "../modules/elements.ts";
import * as minify from "../modules/minify.ts";
import { typedNames } from "./docs.ts";
import { MODULE_EXPORTS } from "./capabilities.ts";

// What `ssqch capabilities` says each module exports is what the module has, and what `ssqch.d.ts` declares.
test("each module exports what capabilities says", () => {
	const actual: Record<string, Record<string, unknown>> = { ssqch: api, "ssqch/image": image, "ssqch/rss": rss, "ssqch/assets": assets, "ssqch/links": links, "ssqch/sitemap": sitemap, "ssqch/redirects": redirects, "ssqch/sass": sass, "ssqch/elements": elements, "ssqch/minify": minify };
	assert.deepEqual(MODULE_EXPORTS.map(([name]) => name), Object.keys(actual));
	const declared = typedNames().filter((n) => n.kind === "module export");
	for (const [name, exports] of MODULE_EXPORTS) {
		for (const exported of exports) assert.equal(typeof actual[name][exported], "function", `${name} lacks ${exported}`);
		assert.deepEqual([...exports].sort(), declared.filter((n) => n.module === name).map((n) => n.name).sort(), `${name}: ssqch.d.ts declares other exports`);
	}
});
