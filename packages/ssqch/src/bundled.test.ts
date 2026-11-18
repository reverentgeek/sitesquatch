// `bundled/` holds copies of files that live elsewhere while both implementations do (see
// `scripts/sync-bundled.ts`). One source to edit: this fails when a copy has drifted.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO, copies, pairs } from "../scripts/sync-bundled.ts";

const rust = fs.existsSync(path.join(REPO, "crates/ssqch/src/ssqch.d.ts"));

test("the bundled copies are their originals", { skip: !rust && "the Rust implementation is gone: the copies are the originals" }, () => {
	const listed = pairs();
	assert.ok(listed.length > 40, `only ${listed.length} files`);
	const differ: string[] = [];
	for (const { original, copy } of listed) {
		if (!fs.existsSync(copy) || !fs.readFileSync(copy).equals(fs.readFileSync(original))) differ.push(path.relative(REPO, copy));
	}
	assert.deepEqual(differ, [], "run `node scripts/sync-bundled.ts` in packages/ssqch to copy the originals over these");
	const known = new Set(listed.map((p) => p.copy));
	assert.deepEqual(copies().filter((copy) => !known.has(copy)).map((copy) => path.relative(REPO, copy)), [], "these have no original any more: run `node scripts/sync-bundled.ts`");
});
