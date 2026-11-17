// From crates/sitesquatch/src/suggest.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closest, closestPath } from "./suggest.ts";

test("the_closest_name_is_a_few_edits_away", () => {
	assert.equal(closest("descripton", ["title", "description"]), "description");
	assert.equal(closest("ouput", ["input", "output"]), "output");
	assert.equal(closest("colour", ["title", "date"]), undefined);
	// A short name isn't "close" to every other short name.
	assert.equal(closest("a", ["b", "c"]), undefined);

	const pages = ["/", "/contact/", "/about/", "/posts/pine-cone-crunch/"];
	assert.equal(closestPath("/contactt/", pages), "/contact/");
	assert.equal(closestPath("/contact", pages), undefined, "the same but for the slash isn't a suggestion");
	assert.equal(closestPath("/posts/pinecone-crunch/", pages), "/posts/pine-cone-crunch/");
	assert.equal(closestPath("/nope/", pages), undefined);
	assert.equal(closestPath("/x/", ["/a/", "/b/"]), undefined);
});
