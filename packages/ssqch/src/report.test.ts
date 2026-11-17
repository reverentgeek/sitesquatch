// From crates/sitesquatch/src/report.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes, count, duration } from "./report.ts";

test("counts_get_thousands_separators", () => {
	assert.equal(count(0), "0");
	assert.equal(count(999), "999");
	assert.equal(count(1000), "1,000");
	assert.equal(count(4689), "4,689");
	assert.equal(count(1234567), "1,234,567");
});

test("sizes_and_durations_read_naturally", () => {
	assert.equal(bytes(512), "512 B");
	assert.equal(bytes(14_200), "14.2 KB");
	assert.equal(bytes(268_000_000), "268 MB");
	assert.equal(bytes(1_410_000_000), "1.41 GB");
	assert.equal(bytes(999_999), "1.00 MB");
	assert.equal(duration(0.85), "850 µs");
	assert.equal(duration(129.4), "129 ms");
	assert.equal(duration(1240), "1.24 s");
	assert.equal(duration(125_000), "2m 05s");
});

// Rust rounds a value that's exactly halfway to the even digit, and so does the summary.
test("a tie goes to the even digit", () => {
	assert.equal(bytes(12_250), "12.2 KB");
	assert.equal(bytes(12_350), "12.3 KB");
	assert.equal(bytes(12_750), "12.8 KB");
	assert.equal(bytes(100_500), "100 KB");
	assert.equal(bytes(101_500), "102 KB");
	assert.equal(bytes(1_125), "1.12 KB");
	assert.equal(bytes(1_375), "1.38 KB");
});
