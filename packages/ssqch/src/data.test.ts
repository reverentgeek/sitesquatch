// From crates/sitesquatch/src/data.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadYaml, merge, normalizeTags, parseDate, parseFrontMatter, readToml } from "./data.ts";

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

// js-yaml reads the years 0 to 99 as 1900 to 1999 (Date.UTC's rule); ssqch keeps them.
test("yaml_dates_before_the_year_100_keep_their_year", () => {
	const at = (text: string) => (loadYaml(`d: ${text}`) as { d: Date }).d.toISOString();
	assert.equal(at("0099-12-31"), "0099-12-31T00:00:00.000Z");
	assert.equal(at("0005-01-02T03:04:05Z"), "0005-01-02T03:04:05.000Z");
	// An offset that moves the date into the year before.
	assert.equal(at("0001-01-01T00:30:00+01:00"), "0000-12-31T23:30:00.000Z");
	assert.equal(at("1999-12-31"), "1999-12-31T00:00:00.000Z");
	// The rest of js-yaml's default schema is still there.
	assert.deepEqual(loadYaml("base: &b { x: 1 }\nm:\n  <<: *b\n  y: 2"), { base: { x: 1 }, m: { x: 1, y: 2 } });
});

// A day that doesn't exist stays text, as 0.7 kept it, where js-yaml would roll it over to the
// next month and nothing would say so; a schema can catch the text.
test("yaml_dates_that_dont_exist_stay_text", () => {
	const value = (text: string) => (loadYaml(`d: ${text}`) as { d: unknown }).d;
	assert.equal(value("2026-02-30"), "2026-02-30");
	assert.equal(value("2023-02-29"), "2023-02-29");
	assert.equal(value("2026-04-31T10:00:00Z"), "2026-04-31T10:00:00Z");
	assert.ok(value("2024-02-29") instanceof Date);
});

// 0.7's TOML library kept a table's keys in name order, so a loop over one gave that order.
test("toml_tables_are_in_name_order", () => {
	const d = parseFrontMatter("+++\nzebra = 1\napple = 2\nmango = 3\n[t]\nb = 1\na = 2\n+++\n").data;
	assert.deepEqual(Object.keys(d), ["apple", "mango", "t", "zebra"]);
	assert.deepEqual(Object.keys(d.t), ["a", "b"]);
});

// 0.7's TOML library (toml_datetime) checked a date's day against its month, took a leap second,
// and wrote a date back as it was written, every digit of a second kept.
test("toml_dates_are_checked_and_kept_as_0_7_wrote_them", () => {
	const toml = (text: string) => (readToml(text) as { d: unknown }).d;
	assert.throws(() => toml("d = 2023-02-30"), /^Error: Invalid TOML document: invalid date, expected day between 01 and 28\n/);
	assert.throws(() => toml("d = 2024-02-30"), /expected day between 01 and 29/);
	assert.throws(() => toml("d = 2023-04-31T10:00:00Z"), /expected day between 01 and 30/);
	assert.throws(() => toml("d = 2023-13-01"), /invalid date, expected month between 01 and 12/);
	assert.throws(() => toml("d = 24:00:00"), /invalid time, expected hour between 00 and 23/);
	assert.throws(() => toml("d = 1979-05-27T07:32:00+24:00"), /invalid offset, expected hours between 00 and 23/);
	assert.throws(() => toml("a = 1\nd = { x = [1979-02-29] }"), (e: Error & { line: number; column: number }) => e.line === 2 && e.column === 12);
	assert.equal(toml("d = 1979-05-27T07:32:60Z"), "1979-05-27T07:32:60Z");
	assert.equal(toml("d = 23:59:60"), "23:59:60");
	assert.equal(toml("d = 2024-02-29"), "2024-02-29");
	assert.equal(toml("d = 1979-05-27 07:32"), "1979-05-27T07:32");
	assert.equal(toml("d = 07:32"), "07:32");
	assert.equal(toml("d = 1979-05-27t07:32:00z"), "1979-05-27T07:32:00Z");
	assert.equal(toml("d = 1979-05-27T07:32:00-00:00"), "1979-05-27T07:32:00+00:00");
	assert.equal(toml("d = 1979-05-27T00:32:00.999999-07:00"), "1979-05-27T00:32:00.999999-07:00");
	assert.equal(toml("d = 1979-05-27T07:32:00.1234567891"), "1979-05-27T07:32:00.123456789");
	assert.equal(toml("d = 1979-05-27T07:32:00.000"), "1979-05-27T07:32:00.0");
	// What looks like a date in a string, a comment or a key isn't one.
	assert.deepEqual(readToml("d = \"2023-02-30\" # 2023-02-30\ns = '''\n2023-02-30'''\n2023-02-30 = 1\n[2023-02-31]"), { d: "2023-02-30", s: "2023-02-30", "2023-02-30": 1, "2023-02-31": {} });
	assert.deepEqual(readToml("d = [\"]\", 2023-02-28, { a = 07:32:00 }]"), { d: ["]", "2023-02-28", { a: "07:32:00" }] });
	// A string can't pass for a date, whatever it holds.
	assert.deepEqual(readToml("a = \"\uE000\"\nd = 2024-01-02"), { a: "\uE000", d: "2024-01-02" });
});

test("toml_numbers_past_64_bits_are_errors", () => {
	const toml = (text: string) => (readToml(text) as { n: unknown }).n;
	assert.equal(toml("n = 9223372036854775807"), 9223372036854775807);
	assert.equal(toml("n = -9223372036854775808"), -9223372036854775808);
	for (const n of ["9223372036854775808", "-9223372036854775809", "9_223_372_036_854_775_808", "0xFFFFFFFFFFFFFFFF"]) {
		assert.throws(() => toml(`n = ${n}`), /^Error: Invalid TOML document: integer number overflowed\n/, n);
	}
	for (const n of ["1e400", "-1e400", "2e308"]) assert.throws(() => toml(`n = ${n}`), /floating-point number overflowed/, n);
	assert.equal(toml("n = inf"), Infinity);
	assert.equal(toml("n = 1e-400"), 0);
});

// A key named `__proto__` is a key like any other, as in 0.7, and nothing reaches an object's
// prototype through it.
test("a_proto_key_is_a_key", () => {
	const fromToml = readToml("[extra]\n__proto__ = { polluted = true }") as { extra: Record<string, unknown> };
	assert.deepEqual(Object.keys(fromToml.extra), ["__proto__"]);
	assert.equal(fromToml.extra.polluted, undefined);
	const fromYaml = parseFrontMatter("---\nextra:\n  __proto__:\n    polluted: true\n---\n").data;
	const fromJson = parseFrontMatter("---json\n{ \"extra\": { \"__proto__\": { \"polluted\": true } } }\n---\n").data;
	for (const d of [fromYaml, fromJson]) {
		assert.deepEqual(Object.keys(d.extra), ["__proto__"]);
		assert.equal(d.extra.polluted, undefined);
	}
	const merged = merge({ a: 1 }, JSON.parse("{ \"__proto__\": { \"polluted\": true } }"));
	assert.deepEqual(Object.keys(merged), ["a", "__proto__"]);
	assert.equal(merged.polluted, undefined);
	assert.equal(Object.getPrototypeOf(merged), Object.prototype);
});
