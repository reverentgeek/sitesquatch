// The tab icon is the header's footprint: src/favicon.svg is what lib/favicon.ts makes from the
// drawing, so a change to docs/assets/footprint.svg changes both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { favicon, FAVICON } from "../lib/favicon.ts";

test("src/favicon.svg is the illustrated footprint (run `node lib/favicon.ts` after editing the drawing)", () => {
	assert.equal(readFileSync(FAVICON, "utf8"), favicon());
});
