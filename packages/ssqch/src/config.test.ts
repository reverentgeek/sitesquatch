import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineCache, tomlKeyLine } from "./config.ts";

// `sitesquatch.toml`'s errors point at the key that's wrong, as 0.7's TOML library did.
test("a_sitesquatch_toml_error_has_its_key_s_line", () => {
	const text = "input = \"src\"\n\"output\" = 3\n\n[budgets]\n# sizes\npages = [1]\n\n[markdown]\nheading_ids = 1\n";
	assert.equal(tomlKeyLine(text, ["input"]), 1);
	assert.equal(tomlKeyLine(text, ["output"]), 2);
	assert.equal(tomlKeyLine(text, ["budgets", "pages"]), 6);
	// A key that isn't under its table is the table's line.
	assert.equal(tomlKeyLine(text, ["budgets", "images"]), 4);
	assert.equal(tomlKeyLine(text, ["markdown"]), 8);
	assert.equal(tomlKeyLine("budgets = { pages = [1] }\n", ["budgets", "pages"]), 1);
	assert.equal(tomlKeyLine(text, ["theme"]), undefined);
});

// `ssqch serve` builds again and again in one process: an engine's cache keeps what the last
// build rendered, and what neither build rendered goes, so it never holds more than two builds.
test("an_engine_cache_keeps_the_bodies_of_the_last_two_builds", () => {
	const cache = new EngineCache();
	cache.startBuild();
	cache.set("Pine", "<p>Pine</p>");
	cache.set("Cedar", "<p>Cedar</p>");
	cache.startBuild();
	// Used again in this build: kept for the next one too.
	assert.equal(cache.get("Pine"), "<p>Pine</p>");
	cache.startBuild();
	assert.equal(cache.get("Pine"), "<p>Pine</p>");
	// Not used in the build before: gone.
	assert.equal(cache.get("Cedar"), undefined);
	assert.equal(cache.now.size + cache.before.size, 2);
});
