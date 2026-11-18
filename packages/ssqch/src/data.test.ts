// From crates/sitesquatch/src/data.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, normalizeTags, parseDate, parseFrontMatter } from "./data.ts";

test("front_matter_formats", () => {
	let { data: d, body } = parseFrontMatter("---\ntitle: Y\n---\nbody");
	assert.deepEqual([d.title, body], ["Y", "body"]);
	({ data: d, body } = parseFrontMatter("+++\ntitle = \"T\"\ntags = [\"a\"]\n+++\n\nbody"));
	assert.deepEqual([d.title, d.tags.length, body], ["T", 1, "\nbody"]);
	// Only the fence's own line ending goes, as in gray-matter (lit.dev's JSON pages lost a line).
	assert.equal(parseFrontMatter("---\nx: 1\n---\r\n\r\n\n[1]").body, "\r\n\n[1]");
	({ data: d, body } = parseFrontMatter("---json\n{ \"title\": \"J\", \"n\": 2 }\n---\nbody"));
	assert.deepEqual([d.title, d.n, body], ["J", 2, "body"]);
	// A TOML date without quotes is its text, which reads as a date.
	({ data: d } = parseFrontMatter("+++\ndate = 2024-01-02\nupdated = 2024-03-04T10:00:00Z\n[extra]\nwhen = 2020-05-06\n+++\n"));
	assert.equal(d.date, "2024-01-02");
	assert.equal(parseDate(d.date)?.toISOString().slice(0, 10), "2024-01-02");
	assert.equal(d.updated, "2024-03-04T10:00:00Z");
	assert.equal(d.extra.when, "2020-05-06");
	({ data: d } = parseFrontMatter("---toml\ntitle = \"T2\"\n---\n"));
	assert.equal(d.title, "T2");
	// An integer past 2^53 is a rounded number, as 0.7 read it, not a refusal of the whole page.
	({ data: d } = parseFrontMatter("+++\nid = 9007199254740993\nsmall = 0xDEAD\n+++\n"));
	assert.deepEqual([d.id, d.small], [9007199254740992, 57005]);
	// Not front matter: a rule, or an unknown language.
	assert.equal(parseFrontMatter("----\nx").body, "----\nx");
	assert.equal(parseFrontMatter("---ruby\nx\n---\n").body, "---ruby\nx\n---\n");
	assert.throws(() => parseFrontMatter("---json\n[1]\n---\n"), /JSON front matter must be an object/);
	assert.throws(() => parseFrontMatter("+++\ntitle = 1\n"), /closing `\+\+\+`/);
});

// A page's `render` replaces its folder's (v8.dev: `[njk]` over `["mdit"]` was `mdit, njk`),
// while `tags` and lists inside objects still join.
test("render_replaces_and_tags_join", () => {
	const folder = parseFrontMatter("---\nrender: [mdit]\ntags: [posts]\nsite: { links: [a] }\n---\n").data;
	const page = parseFrontMatter("---\nrender: [njk]\ntags: [snacks]\nsite: { links: [b] }\n---\n").data;
	const merged = merge(folder, page, true);
	assert.equal(merged.render.join(","), "njk");
	assert.equal(merged.tags.join(","), "posts,snacks");
	assert.equal(merged.site.links.join(","), "a,b");
	// Neither side is changed by the merge.
	assert.deepEqual([folder.tags, folder.site.links, page.tags], [["posts"], ["a"], ["snacks"]]);
});

// From stage 0 (G2): a folder's `"tags": "posts"` joins a page's own list rather than being replaced by it.
test("a folder's tag joins a page's tags", () => {
	const folder = { tags: "posts" };
	normalizeTags(folder);
	const page = { tags: ["snacks", "posts"] };
	normalizeTags(page);
	const merged = merge(folder, page, true);
	normalizeTags(merged);
	assert.deepEqual(merged.tags, ["posts", "snacks"]);
});

test("front matter errors say where", () => {
	assert.throws(() => parseFrontMatter("---\ntitle: [Home\n---\nx\n"), /invalid YAML front matter: .* at line \d+ column \d+/s);
	assert.throws(() => parseFrontMatter("---json\n{ \"a\": 1, }\n---\n"), /invalid JSON front matter: .* at line 1 column \d+/s);
	assert.throws(() => parseFrontMatter("+++\ntitle = \n+++\n"), /invalid TOML front matter: .* at line 1 column \d+/s);
	assert.throws(() => parseFrontMatter("---\n- a\n---\n"), /invalid YAML front matter: expected a mapping at the top level/);
});

// YAML timestamps are dates in every key, as js-yaml makes them (0.7 kept them as text).
test("yaml dates are dates", () => {
	const { data } = parseFrontMatter("---\ndate: 2026-03-14\nwhen: 2026-03-14T09:05:00Z\ntext: \"2026-03-14\"\n---\n");
	assert.ok(data.date instanceof Date && data.when instanceof Date);
	assert.equal(data.when.toISOString(), "2026-03-14T09:05:00.000Z");
	assert.equal(data.text, "2026-03-14");
});

test("dates are read as UTC, whatever the machine's zone", () => {
	const iso = (s: string) => parseDate(s)?.toISOString();
	assert.equal(iso("2024-06-01"), "2024-06-01T00:00:00.000Z");
	assert.equal(iso("2024-06-01 10:30:15"), "2024-06-01T10:30:15.000Z");
	assert.equal(iso("2024-06-01T10:30:15"), "2024-06-01T10:30:15.000Z");
	assert.equal(iso("2024-06-01 10:30"), "2024-06-01T10:30:00.000Z");
	assert.equal(iso("2024-06-01T10:30:15.250"), "2024-06-01T10:30:15.250Z");
	assert.equal(iso("2024-06-01T10:30:15-05:00"), "2024-06-01T15:30:15.000Z");
	assert.equal(iso("2024-06-01T10:30:15Z"), "2024-06-01T10:30:15.000Z");
	for (const not of ["June 1, 2024", "2024-13-01", "2024-02-30", "2024-06-01T10:30", "", "2024"]) assert.equal(parseDate(not), undefined, not);
});

// A date in `tags` (YAML reads `2024-01-01` as one) is the tag as it was written, in any time zone.
test("a tag that's a date is its text", () => {
	const { data } = parseFrontMatter("---\ntags: [2024-01-01, 2024-01-01T10:00:00Z, snacks]\n---\n");
	normalizeTags(data);
	assert.deepEqual(data.tags, ["2024-01-01", "2024-01-01T10:00:00.000Z", "snacks"]);
});

test("dates written loosely are read as 0.7 read them", () => {
	assert.equal(parseDate("2024-1-5")?.toISOString(), "2024-01-05T00:00:00.000Z");
	assert.equal(parseDate("+2024-06-01")?.toISOString(), "2024-06-01T00:00:00.000Z");
});

test("a JSON error says where, whatever V8 says", () => {
	assert.throws(() => parseFrontMatter("---json\n{\"a\": }\n---\n"), /invalid JSON front matter: .* at line 1 column 7$/);
	assert.throws(() => parseFrontMatter("---json\n{\n  \"a\": 1,\n}\n---\n"), /invalid JSON front matter: .* at line 3 column 1$/);
});
