// From plugins/liquid/src/lib.rs, and the errors 0.7 gave without a line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { failure, testSite } from "./fixture.ts";
import { liquidEngine } from "./liquid.ts";

test("an_unknown_filter_names_its_line_and_what_was_meant", async () => {
	const site = testSite({}, { shout: (s: unknown) => String(s).toUpperCase() });
	const liquid = liquidEngine(site.env);
	const message = await failure(() => liquid.render("line one\n{{ title | shot }}\n", { title: "x" }, site.ctx("page.liquid")));
	assert.equal(message, "page.liquid:2: unknown filter `shot` (did you mean `shout`?)");
	// Another generator's filter gets ssqch's way instead of a guess.
	const other = await failure(() => liquid.render("{{ url | absolute_url }}", {}, site.ctx("page.liquid")));
	assert.ok(other.startsWith("page.liquid:1: unknown filter `absolute_url`. `absoluteUrl(url, base)`"), other);
});

test("a_filter_that_throws_names_its_line_and_the_function", async () => {
	const site = testSite({ "_includes/nav.liquid": "a\n{{ title | boom }}" }, { boom: () => { throw new Error("the snack drawer is empty"); } });
	const liquid = liquidEngine(site.env);
	let message = await failure(() => liquid.render("line one\n\n{{ title | boom }}\n", { title: "x" }, site.ctx("page.liquid")));
	// (The stack's frames are the site's own files; this one's are ssqch's, so there are none.)
	assert.ok(message.startsWith("page.liquid:3: boom(): the snack drawer is empty"), message);
	// In an include, the include's file and line.
	message = await failure(() => liquid.render("{% include \"nav\" %}", { title: "x" }, site.ctx("page.liquid")));
	assert.ok(message.startsWith("_includes/nav.liquid:2: boom(): the snack drawer is empty"), message);
});

test("filters_get_values_as_they_are", () => {
	const site = testSite({}, { describe: (...args: unknown[]) => args.map((a) => `${a instanceof Date ? "date" : typeof a}:${JSON.stringify(a)}`).join(" ") });
	const liquid = liquidEngine(site.env);
	const when = new Date("2026-03-14T00:00:00Z");
	const out = liquid.render("{{ nav | describe: 2, 'x', when, size: 3 }}", { nav: [{ on: "2026-03-14" }, "Intro"], when }, site.ctx("page.liquid"));
	assert.equal(out, "object:[{\"on\":\"2026-03-14\"},\"Intro\"] number:2 string:\"x\" date:\"2026-03-14T00:00:00.000Z\" object:{\"size\":3}");
});

test("async_filters_are_awaited", async () => {
	const site = testSite({}, { later: async (s: unknown) => `later:${s}`, shout: (s: unknown) => String(s).toUpperCase() });
	const liquid = liquidEngine(site.env);
	const ctx = site.ctx("page.liquid", "page.liquid");
	assert.equal(liquid.render("{{ title | shout }}", { title: "x" }, ctx), "X");
	const out = liquid.render("{{ title | later | shout }}", { title: "x" }, site.ctx("async.liquid", "async.liquid"));
	assert.ok(out instanceof Promise);
	assert.equal(await out, "LATER:X");
});

test("includes_come_from_the_site_then_its_themes", async () => {
	const site = testSite({
		"_includes/nav.html": "<nav>{{ include.section }}</nav>",
		"_includes/footer.liquid": "site footer",
		"themes/trail/_includes/footer.liquid": "theme footer",
		"themes/trail/_includes/card.liquid": "<card>{{ year }}</card>",
		"_includes/unused.liquid": "x",
	});
	const liquid = liquidEngine(site.env);
	const out = liquid.render("{% include nav.html section=\"home\" %}{% include \"footer\" %}|{% render \"card\", year: 2026 %}", {}, site.ctx("page.liquid"));
	assert.equal(out, "<nav>home</nav>site footer|<card>2026</card>");
	assert.deepEqual(liquid.included!().sort(), ["card.liquid", "footer.liquid", "nav.html"]);
	const message = await failure(() => liquid.render("\n{% include \"nva.html\" %}", {}, site.ctx("page.liquid")));
	assert.equal(message, "page.liquid:2: template not found: can't include `nva.html` (did you mean `nav.html`?)");
});

test("dates_print_and_format_in_utc", () => {
	const site = testSite({});
	const liquid = liquidEngine(site.env);
	const date = new Date("2026-01-02T10:20:30Z");
	assert.equal(liquid.render("{{ date }}|{{ date | date: \"%a %b %e %Y %H:%M %Z\" }}|{{ \"2024-03-04 10:00:00\" | date: \"%H:%M %z\" }}|{{ \"pine\" | date: \"%Y\" }}|{{ date | date_to_xmlschema }}", { date }, site.ctx("page.liquid")), "2026-01-02 10:20:30 +0000|Fri Jan  2 2026 10:20 +00:00|10:00 +0000|pine|2026-01-02T10:20:30+00:00");
});

test("strict_names_what_is_missing_in_0_7_words", async () => {
	const site = testSite({}, {}, true);
	const liquid = liquidEngine(site.env);
	assert.equal(liquid.render("{% if nope %}x{% endif %}ok", {}, site.ctx("page.liquid")), "ok");
	const message = await failure(() => liquid.render("{{ titel }}", {}, site.ctx("page.liquid")));
	assert.ok(message.startsWith("page.liquid:1: ") && message.includes("requested variable=titel"), message);
});
