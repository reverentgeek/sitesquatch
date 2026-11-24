// From crates/sitesquatch/src/schema.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Data } from "./data.ts";
import { check, covers, parseSchema, parseType, schemaTypes } from "./schema.ts";
import type { Config } from "./config.ts";

const problems = async (spec: unknown, data: Data, frontKeys: string[] = []) => {
	const dir = os.tmpdir();
	const found = await check(parseSchema("posts", spec), data, frontKeys, { input: dir, pageDir: dir }, dir);
	return found.map((p) => `${p.warning ? "warn: " : ""}${p.message}`);
};
const failure = (fn: () => unknown) => {
	try { fn(); } catch (e) { return (e as Error).message; }
	return "";
};

test("types_parse", () => {
	for (const ok of ["string", "string?", "string[]", "(string | number)[]", "'draft' | 'published'", "\"a\" | 1 | true | null", " integer ? ", "date", "file", "object", "array", "any", "string[][]"]) {
		assert.doesNotThrow(() => parseType(ok), ok);
	}
	assert.equal(parseType("string?")[1], true);
	for (const [bad, why] of [["strng", "unknown type \"strng\""], ["string |", "a type is missing"], ["(string", "a `(` has no `)`"], ["'draft", "no closing '"], ["string number", "unexpected \"number\""], ["|", "unexpected '|'"]]) {
		assert.ok(failure(() => parseType(bad)).includes(why), bad);
	}
});

test("data_is_checked_against_fields", async () => {
	const spec = {
		fields: {
			title: "string",
			date: "date",
			description: "string?",
			status: "'draft' | 'published'",
			topics: "string[]",
			weight: "integer?",
			hero: { src: "string", alt: "string" },
			"author?": { name: "string" },
			links: [{ href: "string" }],
		},
		unknown: "error",
	};
	const good = { title: "Pine", date: "2026-03-14", status: "draft", topics: ["trees"], hero: { src: "/a.png", alt: "A" }, links: [], site: { name: "global data is fine" } };
	assert.deepEqual(await problems(spec, good, ["title", "date", "layout", "tags"]), []);
	// Another generator's word for a key ssqch reads is that key.
	assert.deepEqual(await problems(spec, good, ["eleventyComputed", "redirect_from", "templateEngineOverride"]), []);

	const bad = { title: 7, date: "tomorrow", description: null, status: "drfat", topics: ["trees", 2], weight: 1.5, hero: { src: "/a.png" }, author: "Sam", links: [{ href: 1 }], descripton: "x" };
	assert.deepEqual(await problems(spec, bad, ["title", "descripton", "zebra"]), [
		"`title` must be a string, not 7",
		"`date` must be a date, like 2026-03-14, not \"tomorrow\"",
		"`status` must be \"draft\" or \"published\", not \"drfat\"",
		"`topics[1]` must be a string, not 2",
		"`weight` must be a whole number, not 1.5",
		"`hero.alt` is required (a string)",
		"`author` must be an object, not \"Sam\"",
		"`links[0].href` must be a string, not 1",
		"`descripton` isn't a field of this schema (did you mean `description`?)",
		"`zebra` isn't a field of this schema",
	]);
	assert.equal((await problems(spec, {})).length, 6);
	// A date is a date, and a long string is cut short.
	assert.deepEqual(await problems({ fields: { a: "string", b: "number" } }, { a: new Date(Date.UTC(2026, 2, 14)), b: "x".repeat(70) }), ["`a` must be a string, not the date 2026-03-14", `\`b\` must be a number, not "${"x".repeat(60)}"...`]);
});

test("schemas_cover_tags_or_files", () => {
	const byTag = parseSchema("posts", { fields: {} });
	assert.ok(covers(byTag, "posts/a.md", ["posts"], true));
	assert.ok(!covers(byTag, "posts/a.md", ["notes"], true));
	assert.ok(!covers(byTag, "posts/a.md", ["posts"], false));
	const byFile = parseSchema("docs", { files: ["docs/**/*.md"], fields: {}, unknown: "warn" });
	assert.ok(covers(byFile, "docs/a/b.md", [], false));
	assert.ok(!covers(byFile, "posts/a.md", ["docs"], true));
	assert.equal(byFile.unknown, "warn");
	assert.ok(covers(parseSchema("all", { fields: {} }), "x.md", [], true));

	for (const [spec, why] of [
		[{ title: "string" }, "\"title\" isn't an option (options: fields, files, unknown); a schema's fields go in `fields`"],
		[{}, "schemas.posts needs `fields`"],
		[{ fields: { title: "text" } }, "schemas.posts.fields.title: unknown type \"text\""],
		[{ fields: { title: 1 } }, "schemas.posts.fields.title must be a type"],
		[{ fields: {}, unknown: "ignore" }, "schemas.posts.unknown must be \"allow\", \"warn\" or \"error\""],
		[{ fields: { a: ["string", "number"] } }, "a list type has one item"],
		[{ fields: {}, files: "[a" }, "schemas.posts.files: invalid glob \"[a\": error parsing glob '[a': unclosed character class; missing ']'"],
	] as const) {
		const said = failure(() => parseSchema("posts", spec));
		assert.ok(said.includes(why), said);
	}
});

test("files_have_to_exist", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-schema-"));
	fs.mkdirSync(path.join(dir, "posts/pine"), { recursive: true });
	fs.writeFileSync(path.join(dir, "posts/pine/photo.jpg"), "x");
	fs.writeFileSync(path.join(dir, "logo.svg"), "x");
	const schema = parseSchema("posts", { fields: { photo: "file", logo: "file", missing: "file" } });
	const found = await check(schema, { photo: "photo.jpg", logo: "/logo.svg?v=2", missing: "/nope.png" }, [], { input: dir, pageDir: path.join(dir, "posts/pine") }, dir);
	assert.deepEqual(found.map((p) => p.message), ["`missing` is \"/nope.png\", but there's no such file in the input folder (looked for nope.png)"]);
	// The nearest name in the folder it looked in, written as the field writes it (Squatch Snacks, E5).
	const near = await check(schema, { photo: "photo.jpeg", logo: "/logo.svg", missing: "/lgo.svg" }, [], { input: dir, pageDir: path.join(dir, "posts/pine") }, dir);
	assert.deepEqual(near.map((p) => p.message), ["`photo` is \"photo.jpeg\", but there's no such file next to the page (looked for posts/pine/photo.jpeg; did you mean \"photo.jpg\"?)", "`missing` is \"/lgo.svg\", but there's no such file in the input folder (looked for lgo.svg; did you mean \"/logo.svg\"?)"]);
	fs.rmSync(dir, { recursive: true });
});

test("functions_check_values", async () => {
	const spec = { fields: { slug: (v: unknown) => (typeof v === "string" && /^[a-z-]+$/.test(v)) || "must be lowercase letters and dashes", flag: (v: unknown) => Boolean(v) } };
	assert.deepEqual(await problems(spec, { slug: "pine-cone", flag: true }), []);
	assert.deepEqual(await problems(spec, { slug: "Pine Cone" }), ["`slug` must be lowercase letters and dashes", "`flag` isn't valid (missing)"]);
	// An answer that doesn't go on from the field's name comes after a colon (Squatch Snacks, E3).
	assert.deepEqual(await problems({ fields: { summary: () => "write the opening's own summary", trail: () => "Isn't on the map" } }, {}), ["`summary`: write the opening's own summary", "`trail` Isn't on the map"]);
	// One that's async is waited for, and its answer keeps the field's place.
	const later = { fields: { first: async () => "comes first", second: () => "comes second", third: () => { throw new Error("pine cones"); } } };
	const said = await problems(later, {});
	assert.deepEqual(said.slice(0, 2), ["`first` comes first", "`second` comes second"]);
	assert.ok(said[2].startsWith("`third`: the check failed: pine cones"), said[2]);
	assert.deepEqual(await problems({ fields: { n: () => 7 } }, {}), ["`n`: the check returned number; return true, false or a message"]);
});

test("schemas_become_typescript", () => {
	const schema = parseSchema("posts", { fields: { title: "string", date: "date", status: "'draft' | 'published'", topics: "string[]", "hero?": { src: "file", alt: "string?" }, "og:image": "string?", links: [{ href: "string" }] } });
	const config = { schemas: [schema] } as unknown as Config;
	assert.deepEqual(schemaTypes(config), [["posts", "{\n\t\t\ttitle: string;\n\t\t\tdate: Date | string;\n\t\t\tstatus: \"draft\" | \"published\";\n\t\t\ttopics: string[];\n\t\t\thero?: {\n\t\t\t\tsrc: string;\n\t\t\t\talt?: string;\n\t\t\t};\n\t\t\t\"og:image\"?: string;\n\t\t\tlinks: {\n\t\t\t\thref: string;\n\t\t\t}[];\n\t\t}"]]);
});
