import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonText } from "./json-edit.ts";

const PACKAGE = `{
\t"name": "trail-guide",
\t"weight": 1.0,
\t"exp": 1e5,
\t"big": 12345678901234567890,
\t"2024": "year",
\t"keywords": ["pine", "cone"],
\t"esc": "a\\u00e9\\/b",
\t"scripts": {
\t\t"build": "eleventy",
\t\t"serve": "eleventy --serve"
\t},
\t"dependencies": {
\t\t"@11ty/eleventy": "^3.0.0"
\t},
\t"devDependencies": {
\t\t"alpha": "2",
\t\t"@11ty/eleventy": "^3.0.0",
\t\t"zed": "1"
\t}
}
`;

test("a changed value, and everything else as it's written", () => {
	const json = new JsonText(PACKAGE);
	json.replace(["scripts", "build"], JSON.stringify("ssqch build"));
	assert.equal(json.text, PACKAGE.replace("\"build\": \"eleventy\"", "\"build\": \"ssqch build\""));
	JSON.parse(json.text);
});

test("members come out with their commas and lines, and an object left empty is {}", () => {
	const json = new JsonText(PACKAGE);
	json.remove(["devDependencies"], "@11ty/eleventy");
	json.remove(["dependencies"], "@11ty/eleventy");
	assert.ok(json.text.includes("\t\"dependencies\": {},\n\t\"devDependencies\": {\n\t\t\"alpha\": \"2\",\n\t\t\"zed\": \"1\"\n\t}\n}\n"), json.text);
	json.remove([], "dependencies");
	json.remove(["devDependencies"], "zed");
	assert.ok(json.text.endsWith("\t},\n\t\"devDependencies\": {\n\t\t\"alpha\": \"2\"\n\t}\n}\n"), json.text);
	json.remove([], "name");
	assert.ok(json.text.startsWith("{\n\t\"weight\": 1.0,\n\t\"exp\": 1e5,\n\t\"big\": 12345678901234567890,\n"), json.text);
	assert.deepEqual(Object.keys(JSON.parse(json.text)), ["2024", "weight", "exp", "big", "keywords", "esc", "scripts", "devDependencies"]);
	// Every member of that name goes, as `JSON.parse` keeps one of them.
	const twice = new JsonText("{\"a\": 1, \"b\": 2, \"a\": 3}");
	twice.remove([], "a");
	assert.equal(twice.text, "{\"b\": 2}");
});

test("a member goes in among its neighbours, spaced as they are", () => {
	const json = new JsonText(PACKAGE);
	const sorted = (other: string) => other > "ssqch";
	json.insert(["devDependencies"], "ssqch", "\"0.8.0\"", sorted);
	assert.ok(json.text.includes("\t\t\"@11ty/eleventy\": \"^3.0.0\",\n\t\t\"ssqch\": \"0.8.0\",\n\t\t\"zed\": \"1\"\n"), json.text);
	json.insert(["scripts"], "test", "\"node --test\"");
	assert.ok(json.text.includes("\t\t\"serve\": \"eleventy --serve\",\n\t\t\"test\": \"node --test\"\n\t},"), json.text);
	const inline = new JsonText("{\"devDependencies\": {\"zed\": \"1\"}}");
	inline.insert(["devDependencies"], "ssqch", "\"0.8.0\"", sorted);
	assert.equal(inline.text, "{\"devDependencies\": {\"ssqch\": \"0.8.0\", \"zed\": \"1\"}}");
	inline.insert(["devDependencies"], "zzz", "\"2\"", (other) => other > "zzz");
	assert.equal(inline.text, "{\"devDependencies\": {\"ssqch\": \"0.8.0\", \"zed\": \"1\", \"zzz\": \"2\"}}");
});

test("a new object is laid out as the file is", () => {
	const pretty = new JsonText("{\n  \"name\": \"x\",\n  \"empty\": {}\n}\n");
	pretty.insert([], "devDependencies", pretty.object([["ssqch", "\"0.8.0\""]], 1));
	pretty.insert(["empty"], "a", "1");
	assert.equal(pretty.text, "{\n  \"name\": \"x\",\n  \"empty\": {\n    \"a\": 1\n  },\n  \"devDependencies\": {\n    \"ssqch\": \"0.8.0\"\n  }\n}\n");
	const crlf = new JsonText("{\r\n\t\"name\": \"x\"\r\n}\r\n");
	crlf.insert([], "devDependencies", crlf.object([["ssqch", "\"0.8.0\""]], 1));
	assert.equal(crlf.text, "{\r\n\t\"name\": \"x\",\r\n\t\"devDependencies\": {\r\n\t\t\"ssqch\": \"0.8.0\"\r\n\t}\r\n}\r\n");
	const oneLine = new JsonText("{\"name\": \"x\"}");
	oneLine.insert([], "devDependencies", oneLine.object([["ssqch", "\"0.8.0\""]], 1));
	assert.equal(oneLine.text, "{\"name\": \"x\", \"devDependencies\": {\"ssqch\": \"0.8.0\"}}");
});
