// From crates/sitesquatch/src/build.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeCodeMentionsForTest as edgeCodeMentions } from "./build.ts";
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
