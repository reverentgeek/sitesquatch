// The order pages are built and listed in is 0.7's: paths compared folder by folder, each name
// by its UTF-8 bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { comparePaths, compareText, joinAsGiven, parentAsGiven } from "./paths.ts";

test("paths are ordered folder by folder", () => {
	const p = (s: string) => s.split("/").join(path.sep);
	const sorted = ["a-b/x.md", "a/b.md", "a.md", "a/a.md", "B.md", "é.md", "z.md"].map(p).sort(comparePaths);
	// `a/` before `a-b/` (the folder `a` is a shorter name than `a-b`), though `-` sorts before `/`.
	assert.deepEqual(sorted, ["B.md", "a/a.md", "a/b.md", "a-b/x.md", "a.md", "z.md", "é.md"].map(p));
});

test("text is ordered by its UTF-8 bytes", () => {
	// U+FF5E (three bytes) is before U+1F332 (four), which UTF-16 has the other way round.
	assert.ok(compareText("～", "\u{1f332}") < 0);
	assert.ok(compareText("a", "ab") < 0 && compareText("b", "ab") > 0 && compareText("x", "x") === 0);
});

// 0.7's messages named paths as Rust's `Path::join` and `Path::parent` give them, untidied.
test("paths are joined and split as rust did", () => {
	const s = path.sep;
	assert.equal(joinAsGiven("nope", "."), `nope${s}.`);
	assert.equal(joinAsGiven("broken/", "dead"), "broken/dead");
	assert.equal(joinAsGiven("site", path.resolve("/srv/www")), path.resolve("/srv/www"));
	assert.equal(parentAsGiven(`f${s}posts${s}x.md`), `f${s}posts`);
	assert.equal(parentAsGiven("x.d.ts"), "");
	assert.equal(parentAsGiven(`.${s}x`), ".");
	assert.equal(parentAsGiven(`a${s}${s}b${s}`), "a");
});
