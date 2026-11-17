// The table of other generators' words is in three places while both implementations live: here,
// in 0.7's `equivalents.rs`, and (as a copy, since the oracle may not import ssqch's code) in the
// oracle's `cli/aliases.test.js`. This keeps them the same.
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

const rust = new URL("crates/sitesquatch/src/equivalents.rs", REPO);
test("0.7's table is this table", { skip: !fs.existsSync(rust) && "the Rust implementation is gone" }, () => {
	const source = fs.readFileSync(rust, "utf8");
	const serve = JSON.parse(/const SERVE: &str = (".*");/.exec(source)![1]);
	const rows = [...source.matchAll(/^ {4}Equivalent \{ word: ("(?:[^"\\]|\\.)*"), kind: Kind::(\w+), alias: (true|false), from: &\[(.*?)\], ssqch: ("(?:[^"\\]|\\.)*"), say: (SERVE|"(?:[^"\\]|\\.)*"), more: ("(?:[^"\\]|\\.)*") \},$/gm)];
	assert.equal(rows.length, TABLE.length);
	rows.forEach((found, i) => {
		const row = { word: JSON.parse(found[1]), kind: kinds[found[2]], alias: found[3] === "true", from: JSON.parse(`[${found[4]}]`), ssqch: JSON.parse(found[5]), say: found[6] === "SERVE" ? serve : JSON.parse(found[6]), more: JSON.parse(found[7]) };
		assert.deepEqual(row, { ...TABLE[i], from: [...TABLE[i].from] }, row.word);
	});
});
