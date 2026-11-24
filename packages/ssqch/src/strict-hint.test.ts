import { test } from "node:test";
import assert from "node:assert/strict";
import { didYouMean, undefinedMessage, undefinedOnLine } from "./strict-hint.ts";

const data = { title: "Snacks", t: { buttons: { allSnacks: "All snacks" } }, posts: [{ title: "Pine" }] };

test("an undefined name gets the nearest name beside it", () => {
	assert.equal(undefinedMessage("t.buttons.allSnaks", data), "`t.buttons.allSnaks` is undefined (strict is on; did you mean `t.buttons.allSnacks`?)");
	assert.equal(undefinedMessage("titel", data), "`titel` is undefined (strict is on; did you mean `title`?)");
	assert.equal(didYouMean("posts[0].titel", data), "; did you mean `posts[0].title`?");
	// Nothing close, nothing rendering, or a loop's variable (`post` isn't the data's): no guess.
	assert.equal(didYouMean("t.buttons.pinecones", data), "");
	assert.equal(didYouMean("titel", undefined), "");
	assert.equal(didYouMean("post.titel", { posts: [] }), "");
});

test("the one undefined name on a line is found", () => {
	assert.equal(undefinedOnLine("<h1>{{ title }}</h1><a>{{- t.buttons.allSnaks | upper -}}</a>", "{{", "}}", data), "t.buttons.allSnaks");
	// Two names that could be it: neither is named.
	assert.equal(undefinedOnLine("{{ item.name }} {{ item.nme }}", "{{", "}}", data), undefined);
	assert.equal(undefinedOnLine("{{ title }}", "{{", "}}", data), undefined);
});
