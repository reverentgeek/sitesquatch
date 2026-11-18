// Numbers in reports as 0.7 printed them (serde_json, with `Value::to_json` in
// crates/sitesquatch-edge/src/value.rs): the expected text is 0.7's `inspect --format json`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyJson, serdeFloat, toJsonValue } from "./quote.ts";

test("doubles_are_written_as_serde_json_wrote_them", () => {
	const cases: Array<[number, string]> = [[1, "1.0"], [1e5, "100000.0"], [1e15, "1000000000000000.0"], [1e16, "1e+16"], [1.5e16, "1.5e+16"], [1e-5, "0.00001"], [2.5e-5, "0.000025"], [1e-6, "1e-6"], [1.5e-7, "1.5e-7"], [123.456, "123.456"], [5e-324, "5e-324"], [1.7976931348623157e308, "1.7976931348623157e+308"], [-9223372036854775809, "-9.223372036854776e+18"], [-0, "-0.0"], [0, "0.0"]];
	for (const [x, text] of cases) assert.equal(serdeFloat(x), text, String(x));
});

test("reports_print_numbers_as_0_7_did", () => {
	const value = toJsonValue({ a: 1e16, b: 1e15, c: 1.5, d: 100, e: -0, f: 1e21, g: 0.1, h: 1e-7, i: 2.5e-5, j: 123456789012345680000, k: 5e-324, l: NaN, m: Infinity, n: 9.5e15, list: [], map: {} });
	assert.equal(prettyJson(value), "{\n  \"a\": 1e+16,\n  \"b\": 1000000000000000,\n  \"c\": 1.5,\n  \"d\": 100,\n  \"e\": 0,\n  \"f\": 1e+21,\n  \"g\": 0.1,\n  \"h\": 1e-7,\n  \"i\": 0.000025,\n  \"j\": 1.2345678901234568e+20,\n  \"k\": 5e-324,\n  \"l\": null,\n  \"m\": null,\n  \"n\": 9500000000000000.0,\n  \"list\": [],\n  \"map\": {}\n}");
	// The layout is JSON.stringify's, with two spaces.
	const plain = { s: "pine \"cone\"", t: true, z: null, deep: [{ x: [1, 2] }] };
	assert.equal(prettyJson(plain), JSON.stringify(plain, null, 2));
});
