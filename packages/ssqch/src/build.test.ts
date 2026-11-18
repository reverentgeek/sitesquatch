// From crates/sitesquatch/src/build.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asTextForTest as asText, edgeCodeMentionsForTest as edgeCodeMentions } from "./build.ts";
import { BuildError } from "./diagnostics.ts";
import { BUILTIN_FILTERS, builtinFilters } from "./filters.ts";
import { markdownEngine } from "./engines/markdown.ts";
import { defaultMarkdownOptions } from "./markdown-options.ts";

test("the_filter_list_names_every_builtin_filter", () => {
	const have = [...builtinFilters(markdownEngine(defaultMarkdownOptions()), { base: "" } as any).keys()].sort();
	assert.deepEqual(have, BUILTIN_FILTERS.map(([name]) => name).sort());
});

test("collections_in_prose_is_not_code", () => {
	const code = [
		"{{ collections.posts.length }}",
		"{{{ collections.all[0].templateContent }}}",
		"<ul>\n  @each(post in collections.posts)\n  <li>{{ post.url }}</li>\n  @end\n</ul>",
		"{{ adjacentPosts(\n  collections.posts, page.url) }}",
	];
	for (const body of code) assert.ok(edgeCodeMentions(body, "collections"), body);
	const prose = [
		"I have mugs, hats, toys and other collections.",
		"Collections in ssqch are {{ \"great\" }}, and so are collections.",
		"{{-- collections are rendered later --}}",
		"Use `collections.posts` in a template.",
	];
	for (const body of prose) assert.ok(!edgeCodeMentions(body, "collections"), body);
});

test("an_engine_that_answers_with_something_other_than_text_is_one_clear_error", async () => {
	// What nunjucks gave for an include that didn't parse: `null`, then a crash in what read it.
	for (const [out, said] of [[null, "null"], [undefined, "undefined"], [5, "number"]] as const) {
		assert.throws(() => asText(out, "njk", "index.njk"), (e: unknown) => e instanceof BuildError && e.message.includes(`internal error while processing index.njk: the \`njk\` engine gave ${said} instead of text`));
	}
	await assert.rejects(asText(Promise.resolve(null), "liquid", "_includes/base.liquid"), (e: unknown) => e instanceof BuildError && e.message.includes("the `liquid` engine gave null instead of text"));
	assert.equal(await asText(Promise.resolve("<p>Pine Cone Crunch</p>"), "edge", "index.edge"), "<p>Pine Cone Crunch</p>");
});
