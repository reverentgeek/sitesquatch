// From crates/sitesquatch/src/suggest.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closest, closestPath, closestPathFinder } from "./suggest.ts";

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

test("closestPathFinder answers as closestPath does", () => {
	const pages = ["/", "/contact/", "/about/", "/posts/pine-cone-crunch/", "/posts/pine-cone-crunch-2/", "/Ünïcode/𝒳/", "/posts/a/", "/posts/b/", "/posts/ab/", "/posts/ba/"];
	const find = closestPathFinder(pages);
	for (const wanted of ["/contactt/", "/contact", "/posts/pinecone-crunch/", "/nope/", "/x/", "/posts/pine-cone-crunch-3/", "/ünïcode/𝒴/", "/posts/c/", "/posts/abc/", "/POSTS/AB", "", "/"]) {
		assert.equal(find(wanted), closestPath(wanted, pages), wanted);
	}
	// Ties go to the first page listed.
	assert.equal(closestPathFinder(["/b2/", "/a1/"])("/c3/"), closestPath("/c3/", ["/b2/", "/a1/"]));
	// Random paths of a few letters, so many are near one another.
	let seed = 7;
	const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const path = () => `/${Array.from({ length: 1 + Math.floor(random() * 8) }, () => "abc/"[Math.floor(random() * 4)]).join("")}`;
	const many = Array.from({ length: 300 }, path);
	const findMany = closestPathFinder(many);
	for (let i = 0; i < 300; i++) {
		const wanted = path();
		assert.equal(findMany(wanted), closestPath(wanted, many), wanted);
	}
});
