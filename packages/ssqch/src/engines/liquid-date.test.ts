// From liquid-core's `strftime.rs` and `datetime.rs` (the liquid crate 0.7 used).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateFormatError, parseDate, strftime } from "./liquid-date.ts";
import type { Instant } from "./liquid-date.ts";

/** A date and time at an offset (`+06:00` is 360), as the Rust tests write them. */
const at = (iso: string, offset: number): Instant => ({ ms: Date.parse(iso) - offset * 60_000, offset });
const eq = (when: Instant, cases: Record<string, string>) => {
	for (const [fmt, want] of Object.entries(cases)) assert.equal(strftime(when, fmt), want, fmt);
};

// 2022-11-03 07:56:37.666 +06:00 (JavaScript keeps milliseconds, so %N ends in zeros).
const SIMPLE = at("2022-11-03T07:56:37.666Z", 360);

test("basic", () => {
	eq(SIMPLE, {
		"%Y": "2022", "%C": "20", "%y": "22", "%m": "11", "%B": "November", "%b": "Nov", "%h": "Nov",
		"%d": "03", "%e": " 3", "%j": "307", "%H": "07", "%k": " 7", "%I": "07", "%l": " 7", "%P": "am", "%p": "AM",
		"%M": "56", "%S": "37", "%L": "666", "%N": "666000000", "%1N": "6", "%3N": "666", "%12N": "666000000000",
		"%z": "+0600", "%Z": "+06:00", "%A": "Thursday", "%a": "Thu", "%u": "4", "%w": "4", "%G": "2022", "%g": "22", "%V": "44",
		"%U": "44", "%W": "44", "%s": "1667440597", "%n": "\n", "%t": "\t", "%%": "%",
		"%c": "Thu Nov  3 07:56:37 2022", "%D": "11/03/22", "%F": "2022-11-03", "%v": " 3-NOV-2022", "%x": "11/03/22",
		"%T": "07:56:37", "%X": "07:56:37", "%r": "07:56:37 AM", "%R": "07:56",
	});
});

test("iso_composites", () => {
	eq(at("2007-11-19T08:37:48Z", -360), {
		"%Y%m%d": "20071119", "%Y%j": "2007323", "%GW%V%u": "2007W471", "%G-W%V-%u": "2007-W47-1", "%H%M%S,%L": "083748,000",
		"%H%M%S%z": "083748-0600", "%T%:z": "08:37:48-06:00", "%FT%T%:z": "2007-11-19T08:37:48-06:00", "%Y-%jT%RZ": "2007-323T08:37Z",
	});
});

test("upper_and_change_flags", () => {
	eq(at("2007-01-19T08:37:48Z", -360), { "%^b": "JAN", "%^B": "JANUARY", "%^a": "FRI", "%^A": "FRIDAY", "%^p": "AM", "%^P": "AM", "%^v": "19-JAN-2007" });
	eq(at("2007-12-19T18:37:48Z", 480), { "%#b": "DEC", "%#B": "DECEMBER", "%#a": "WED", "%#p": "pm", "%#P": "PM", "%#v": "19-DEC-2007" });
});

test("padding", () => {
	eq(at("2022-01-03T07:56:37.666Z", 360), {
		"%8Y": "00002022", "%_11Y": "       2022", "%1C": "20", "%3C": "020", "%_4C": "  20", "%_5y": "   22", "%-_5y": "22", "%-5y": "22",
		"%13m": "0000000000001", "%_13m": "            1", "%7B": "January", "%8B": " January", "%08B": "0January", "%7b": "    Jan", "%07h": "0000Jan", "%-07h": "Jan",
		"%3d": "003", "%_5d": "    3", "%3e": "  3", "%03e": "003", "%j": "003", "%_j": "  3", "%1j": "3",
		"%_H": " 7", "%0k": "07", "%04l": "0007", "%4P": "  am", "%04p": "00AM", "%01p": "AM", "%9M": "000000056", "%_10S": "        37",
		"%1z": "+0600", "%6z": "+00600", "%10z": "+000000600", "%10Z": "+000006:00", "%10::z": "+006:00:00",
		"%10A": "    Monday", "%-10a": "Mon", "%04a": "0Mon", "%05u": "00001", "%_5w": "    1", "%13G": "0000000002022", "%V": "01", "%U": "01", "%W": "01",
		"%20s": "00000000001641174997", "%2n": " \n", "%05t": "0000\t", "%10%": "         %",
		"%30c": "      Mon Jan  3 07:56:37 2022", "%012F": "002022-01-03", "%012v": "0 3-JAN-2022", "%11T": "   07:56:37", "%010X": "0007:56:37", "%12r": " 07:56:37 AM", "%-6R": " 07:56",
	});
	eq(at("-000020-06-13T17:56:37Z", -445), { "%Y": "-0020", "%_Y": "  -20", "%4Y": "-020", "%_4Y": " -20", "%1z": "-0725", "%6z": "-00725", "%10Z": "-000007:25" });
});

test("handles_unknown_and_errors", () => {
	eq(at("-000020-06-13T17:56:37Z", -360), { "%:b": "%:b", "%-_::xX%Y": "%-_::xX-0020", "%_0-^#^q": "%_0-^#^q" });
	for (const fmt of ["%9", "%9E", "%010", "X%"]) assert.throws(() => strftime(SIMPLE, fmt), DateFormatError, fmt);
});

test("strings_read_as_dates_at_utc_unless_they_say", () => {
	const ms = (s: string) => parseDate(s)?.ms;
	assert.equal(ms("2024-03-04 10:20:30 +0300"), Date.parse("2024-03-04T07:20:30Z"));
	assert.equal(parseDate("2024-03-04 10:20:30 +0300")?.offset, 180);
	assert.equal(ms("2024-03-04 10:20:30"), Date.parse("2024-03-04T10:20:30Z"));
	assert.equal(ms("13 June 2016 02:30:00 +0300"), Date.parse("2016-06-12T23:30:00Z"));
	assert.equal(ms("13 Jun 2016 02:30:00"), Date.parse("2016-06-13T02:30:00Z"));
	assert.equal(ms("06/13/2016 02:30:00"), Date.parse("2016-06-13T02:30:00Z"));
	assert.equal(ms("Mon Jun 13 02:30:00 2016"), Date.parse("2016-06-13T02:30:00Z"));
	assert.equal(ms("1700000000"), 1_700_000_000_000);
	assert.equal(ms("2024-03-04"), Date.parse("2024-03-04T00:00:00Z"));
	assert.equal(ms("2024-03-04T10:00:00+02:00"), Date.parse("2024-03-04T08:00:00Z"));
	for (const bad of ["", "aaaaa", "2024-13-01", "2024-02-30", "31 Juin 2016 02:30:00"]) assert.equal(parseDate(bad), undefined, bad);
});
