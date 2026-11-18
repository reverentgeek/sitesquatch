// The table of other generators' words is in two places: here, and (as a copy, since the oracle
// may not import ssqch's code) in the oracle's `cli/aliases.test.js`. This keeps them the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TABLE } from "./equivalents.ts";

const REPO = new URL("../../../", import.meta.url);
const kinds: Record<string, string> = { Command: "command", Flag: "flag", Config: "config", FrontMatter: "frontMatter", Filter: "filter", Global: "global" };

test("the oracle's copy of the table is this table", () => {
	const source = fs.readFileSync(new URL("tests/oracle/cli/aliases.test.js", REPO), "utf8");
	const rows = [...source.matchAll(/^\t(\{"word":.*\}),$/gm)].map((found) => JSON.parse(found[1]));
	assert.equal(rows.length, TABLE.length);
	rows.forEach((row, i) => {
		const { word, kind, alias, ssqch, say, more } = TABLE[i];
		assert.deepEqual({ ...row, kind: kinds[row.kind] }, { word, kind, alias, ssqch, say, more }, row.word);
	});
});
