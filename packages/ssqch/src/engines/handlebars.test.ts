// From plugins/handlebars/src/lib.rs and the handlebars crate's helpers 0.7 had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { failure, testSite } from "./fixture.ts";
import { handlebarsEngine } from "./handlebars.ts";

const filters = {
	shout: (s: unknown) => String(s).toUpperCase(),
	boom: () => { throw new Error("the snack drawer is empty"); },
	later: async (s: unknown) => `later:${s}`,
};

test("an_unknown_helper_names_its_line_and_what_was_meant", async () => {
	const site = testSite({}, filters);
	const hbs = handlebarsEngine(site.env);
	const message = await failure(() => hbs.render("line one\n{{shot title}}\n", { title: "x" }, site.ctx("page.hbs")));
	assert.equal(message, "page.hbs:2: unknown helper `shot` (did you mean `shout`?)");
	// Without arguments it's a value that isn't there, and prints nothing.
	assert.equal(hbs.render("[{{shot}}]", {}, site.ctx("page.hbs")), "[]");
});

test("a_helper_that_throws_names_its_line_and_the_function", async () => {
	const site = testSite({ "_includes/nav.hbs": "a\n{{boom title}}" }, filters);
	const hbs = handlebarsEngine(site.env);
	let message = await failure(() => hbs.render("line one\n\n{{boom title}}\n", { title: "x" }, site.ctx("page.hbs")));
	assert.ok(message.startsWith("page.hbs:3: boom(): the snack drawer is empty"), message);
	// In a partial, the partial's file and line.
	message = await failure(() => hbs.render("{{> nav}}", { title: "x" }, site.ctx("page.hbs")));
	assert.ok(message.startsWith("_includes/nav.hbs:2: boom(): the snack drawer is empty"), message);
});

test("async_helpers_are_awaited_wherever_they_are", async () => {
	const site = testSite({}, filters);
	const hbs = handlebarsEngine(site.env);
	assert.equal(hbs.render("{{shout title}}", { title: "x" }, site.ctx("page.hbs")), "X");
	const out = hbs.render("{{later title}} {{shout (later title)}} {{#if (later title)}}yes{{/if}}", { title: "x" }, site.ctx("async.hbs"));
	assert.ok(out instanceof Promise);
	assert.equal(await out, "later:x LATER:X yes");
});

test("partials_come_from_the_site_then_its_themes", async () => {
	const site = testSite({
		"_includes/nav.hbs": "<nav>{{title}}</nav>",
		"_includes/footer.hbs": "site footer",
		"themes/trail/_includes/footer.hbs": "theme footer",
		"themes/trail/_includes/cards/card.hbs": "<card>{{n}}</card>",
		"_includes/plain.html": "<p>{{title}}</p>",
		"_includes/other.njk": "{% if x %}{{ y | safe }}{% endif %}",
	});
	const hbs = handlebarsEngine(site.env);
	const out = hbs.render("{{> nav}}{{> footer.hbs}}|{{> cards/card n=2}}|{{> plain}}", { title: "T" }, site.ctx("page.hbs"));
	assert.equal(out, "<nav>T</nav>site footer|<card>2</card>|<p>T</p>");
	assert.deepEqual(hbs.included!().sort(), ["cards/card.hbs", "footer.hbs", "nav.hbs", "plain.html"]);
	const message = await failure(() => hbs.render("\n{{> nva}}", {}, site.ctx("page.hbs")));
	assert.equal(message, "page.hbs:2: template not found: can't include `nva` (did you mean `nav`?)");
});

test("values_print_as_0_7_printed_them", () => {
	const site = testSite({}, filters);
	const hbs = handlebarsEngine(site.env);
	const data = { when: new Date("2026-01-02T10:20:30Z"), list: ["a", 1, [true]], obj: { a: 1 }, q: "a&b<c>\"d' `e` =f" };
	assert.equal(hbs.render("{{when}}|{{{when}}}|{{list}}|{{obj}}|{{q}}|{{{q}}}", data, site.ctx("page.hbs")), "2026-01-02T10:20:30.000Z|2026-01-02T10:20:30.000Z|[a, 1, [true]]|[object]|a&amp;b&lt;c&gt;&quot;d&#x27; &#x60;e&#x60; &#x3D;f|a&b<c>\"d' `e` =f");
});

test("the_crates_helpers_and_mustache_sections", () => {
	const site = testSite({}, filters);
	const hbs = handlebarsEngine(site.env);
	const data = { n: 7, list: ["a", "b"], empty: [], obj: {}, flag: true, name: "outer", person: { name: "inner" }, blank: "" };
	assert.equal(hbs.render("{{len list}} {{len \"café\"}} {{eq n 7}} {{gt \"10\" 9}} {{#lt n 3}}small{{else}}big{{/lt}} {{and flag n}} {{not blank}} {{#if obj}}t{{else}}f{{/if}}", data, site.ctx("page.hbs")), "2 5 true true big true true f");
	assert.equal(hbs.render("{{#list}}{{.}}{{/list}}|{{#person}}{{name}}{{/person}}|{{#flag}}{{../name}}{{/flag}}|{{^empty}}none{{/empty}}|{{#blank}}x{{/blank}}|{{^blank}}blank{{/blank}}", data, site.ctx("page.mustache")), "ab|inner|outer|none||blank");
	assert.equal(hbs.render("{{{{raw}}}}{{not}}{{{{/raw}}}}", data, site.ctx("page.hbs")), "{{not}}");
});

test("parse_errors_name_the_line_where_a_block_opens", async () => {
	const site = testSite({ "_includes/broken.hbs": "{{#each items}}" });
	const hbs = handlebarsEngine(site.env);
	const message = await failure(() => hbs.render("ok", {}, site.ctx("page.hbs")));
	assert.equal(message, "_includes/broken.hbs:1: invalid Handlebars syntax: `{{#each}}` is never closed (a `{{/each}}` is missing)");
	const other = handlebarsEngine(testSite({}).env);
	const unclosed = await failure(() => other.render("one\n{{#if title}}\ntwo", {}, site.ctx("page.hbs")));
	assert.equal(unclosed, "page.hbs:2: invalid Handlebars syntax: `{{#if}}` is never closed (a `{{/if}}` is missing)");
});

test("strict_names_the_path_that_is_missing", async () => {
	const site = testSite({}, {}, true);
	const hbs = handlebarsEngine(site.env);
	assert.equal(hbs.render("{{#if nope}}x{{/if}}ok", {}, site.ctx("page.hbs")), "ok");
	const message = await failure(() => hbs.render("\n{{page.nope}}", { page: {} }, site.ctx("page.hbs")));
	assert.equal(message, "page.hbs:2: `page.nope` is undefined (strict is on)");
});
