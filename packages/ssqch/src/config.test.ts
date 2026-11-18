// `sitesquatch.toml`'s errors point at the key that's wrong, as 0.7's TOML library did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tomlKeyLine } from "./config.ts";

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
