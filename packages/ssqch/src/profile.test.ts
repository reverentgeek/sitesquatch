import { test } from "node:test";
import assert from "node:assert/strict";
import { Profile, SLOW_MS, ssqchWork } from "./profile.ts";

test("a wrapped function is timed, keeps its `this`, and returns what it returns", () => {
	const profile = new Profile(true);
	const shout = profile.wrap("filters", "shout", function (this: { mark: string }, s: string) { return `${s.toUpperCase()}${this.mark}`; }, true);
	assert.equal(shout.call({ mark: "!" }, "pine"), "PINE!");
	shout.call({ mark: "?" }, "cedar");
	assert.deepEqual(profile.report().filters.map((e) => [e.name, e.calls, e.async]), [["shout", 2, false]]);
});

test("a promise is timed until it settles, and a rejection is still counted", async () => {
	const profile = new Profile(true);
	const later = profile.wrap("filters", "later", (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), true);
	await later(30);
	const fails = profile.wrap("transforms", "fails", () => Promise.reject(new Error("no")), true);
	await assert.rejects(fails(), /no/);
	await new Promise((resolve) => setImmediate(resolve));
	const report = profile.report();
	assert.ok(report.filters[0].ms >= 25, String(report.filters[0].ms));
	assert.equal(report.filters[0].async, true, "a call that returned a promise is async");
	assert.equal(report.transforms[0].calls, 1);
});

test("lists are slowest first, then by name, and every kind is there", () => {
	const profile = new Profile(true);
	profile.add("pages", "/b/", 5, false);
	profile.add("pages", "/a/", 5, false);
	profile.add("pages", "/c/", 9, false);
	const report = profile.report();
	assert.deepEqual(report.pages.map((e) => e.name), ["/c/", "/a/", "/b/"]);
	assert.deepEqual(Object.keys(report), ["pages", "templates", "layouts", "engines", "filters", "transforms", "data", "collections", "hooks"]);
});

test("without --profile, only the site's own slow calls are kept, and nothing is reported", () => {
	const profile = new Profile(false);
	profile.add("filters", "quick", 2, true);
	profile.add("filters", "builtin", SLOW_MS + 5, false);
	profile.at = "src/posts/pine.md";
	profile.add("transforms", "minify", SLOW_MS + 200, true, "ssqch.config.js");
	profile.at = "src/posts/cedar.md";
	profile.add("transforms", "minify", SLOW_MS + 900, true, "ssqch.config.js");
	assert.deepEqual(profile.report().transforms, []);
	const warnings = profile.slowCalls();
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].code, "slow-call");
	// The first slow call, not the slowest: the same page every build.
	assert.equal(warnings[0].message, "transform `minify` (from ssqch.config.js) took 1.2 s working on src/posts/pine.md, the first of 2 calls that took over a second. `ssqch build --profile` shows where a build's time goes");
});

test("a call under a second is no warning", () => {
	const profile = new Profile(true);
	profile.add("filters", "toc", SLOW_MS - 1, true);
	assert.deepEqual(profile.slowCalls(), []);
});

test("a site's call isn't slow for the time it waits on ssqch's own image work", async () => {
	const profile = new Profile(false);
	const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
	// A filter that asks image() for a crop: the encoding is ssqch's second, not the filter's.
	await profile.time("filters", "crop", true, () => ssqchWork.wait(pause(SLOW_MS + 50)), "ssqch.config.js");
	assert.deepEqual(profile.slowCalls(), []);
	// Its own second still counts.
	await profile.time("filters", "slow", true, async () => { await ssqchWork.wait(pause(20)); await pause(SLOW_MS + 50); }, "ssqch.config.js");
	assert.equal(profile.slowCalls().length, 1);
});
