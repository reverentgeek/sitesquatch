// From `slug_with` in crates/sitesquatch/src/blueprint.rs, which lowercased a character at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugger } from "./api.ts";
import { slug } from "./commands/new.ts";
import { slugify } from "./slug.ts";

test("slugs_lowercase_each_character_on_its_own", () => {
	// JavaScript's toLowerCase() makes a word's last Σ a final sigma; 0.7 didn't.
	assert.equal(slugify("ΟΔΟΣ ΚΑΙ ΣΟΦΙΑΣ"), "οδοσ-και-σοφιασ");
	assert.equal(slug("ΟΔΟΣ"), "οδοσ");
	const next = slugger();
	assert.deepEqual([next("ΟΔΟΣ"), next("οδοσ")], ["οδοσ", "οδοσ-1"]);
	assert.equal(slugify("Pine Cone Crunch!"), "pine-cone-crunch");
	// İ lowercases to i and a combining dot, which is punctuation here, as in 0.7.
	assert.equal(slugify("İstanbul"), "i-stanbul");
	assert.equal(slugify("Drew's Brownies", { apostrophes: "separate", separator: "_" }), "drew_s_brownies");
});
