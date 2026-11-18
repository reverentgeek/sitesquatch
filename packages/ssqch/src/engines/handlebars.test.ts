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

test("a_page_rendered_in_the_middle_of_another_leaves_it_as_it_was", async () => {
	// Reading another page's `templateContent` renders that page there and then.
	let hbs: ReturnType<typeof handlebarsEngine>;
	const site = testSite({}, { ...filters, other: () => hbs.render("{{shout \"inner\"}}", {}, site.ctx("other.hbs")) });
	hbs = handlebarsEngine(site.env);
	assert.equal(await hbs.render("{{other}} {{later title}}", { title: "x" }, site.ctx("page.hbs")), "INNER later:x");
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
	// What the crate's helpers need, as 0.7 refused it.
	for (const [source, said] of [["{{#each nolist}}x{{/each}}", "`nolist` is undefined"], ["{{#with nope}}x{{/with}}", "`nope` is undefined"], ["{{eq nope 1}}", "`nope` is undefined"], ["{{len nope}}", "`nope` is undefined"], ["{{lookup list 5}}", "`list` has no `5`"], ["{{#each list}}{{nope}}{{/each}}", "`nope` is undefined"]]) {
		const text = await failure(() => hbs.render(`\n${source}`, { list: ["a"] }, site.ctx("page.hbs")));
		assert.ok(text.startsWith("page.hbs:2: ") && text.includes(said), `${source}: ${text}`);
	}
	assert.equal(hbs.render("{{and nope 1}} {{#unless nope}}u{{/unless}}", {}, site.ctx("page.hbs")), "false u");
});

test("each_helper_runs_once_a_page_though_one_is_async", async () => {
	let count = 0;
	const site = testSite({ "_includes/inner.hbs": "{{count}}" }, { ...filters, count: () => ++count });
	const hbs = handlebarsEngine(site.env);
	const out = hbs.render("{{count}} {{> inner}} {{later title}} {{#if (later title)}}{{count}}{{/if}} {{count}}", { title: "x" }, site.ctx("page.hbs"));
	assert.equal(await out, "1 2 later:x 3 4");
});

test("a_name_without_its_extension_is_the_handlebars_file", () => {
	const site = testSite({
		"_includes/nav.hbs": "hbs", "_includes/nav.njk": "njk", "_includes/nav.liquid": "liquid",
		"themes/trail/_includes/card.hbs": "theme hbs", "_includes/card.njk": "site njk",
		"_includes/used.mustache": "mustache", "_includes/used.hbs": "used hbs",
	});
	const hbs = handlebarsEngine(site.env);
	assert.equal(hbs.render("{{> nav}} {{> card}} {{> used}} {{> nav.njk}}", {}, site.ctx("page.hbs")), "hbs theme hbs used hbs njk");
});

test("helpers_get_values_as_0_7_gave_them", () => {
	const site = testSite({}, { kind: (v: unknown) => (v === null ? "null" : Object.prototype.toString.call(v)), two: (a: unknown, b: unknown = "B") => `${a}+${b}`, hashed: (o: unknown) => JSON.stringify(o) });
	const hbs = handlebarsEngine(site.env);
	const date = new Date("2026-01-02T00:00:00Z");
	assert.equal(hbs.render("{{kind date}} {{kind nope}} {{two \"x\" nope}} {{hashed k=nope d=date}} {{eq date \"2026-01-02T00:00:00.000Z\"}}", { date }, site.ctx("page.hbs")), "[object String] null x+null {&quot;d&quot;:&quot;2026-01-02T00:00:00.000Z&quot;,&quot;k&quot;:null} true");
});

test("the_crates_quirks_stay", async () => {
	const site = testSite({});
	const hbs = handlebarsEngine(site.env);
	// A list's items have no `@key`, a raw block leaves out its leading space, and numbers print as 0.7's JSON did.
	assert.equal(hbs.render("[{{#each list}}{{@key}}{{@index}}{{/each}}] [{{{{raw}}}}  {{x}}{{{{/raw}}}}] [{{big}}] [{{small}}] [{{huge}}] [{{n}}] [{{f}}]", { list: ["a", "b"], big: 12345678901234567890, small: 0.000001, huge: 1e23, n: 7, f: 2.5 }, site.ctx("page.hbs")), "[01] [{{x}}] [1.2345678901234567e+19] [1e-6] [1e+23] [7] [2.5]");
	// A block helper with nothing to work on names its line.
	assert.equal(await failure(() => hbs.render("\n{{#each}}{{/each}}", {}, site.ctx("page.hbs"))), "page.hbs:2: Must pass iterator to #each");
	assert.equal(await failure(() => hbs.render("\n{{eq 1}}", {}, site.ctx("page.hbs"))), "page.hbs:2: `eq` needs 2 arguments");
});
