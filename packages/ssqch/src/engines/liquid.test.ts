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

test("a_page_rendered_in_the_middle_of_another_leaves_it_as_it_was", async () => {
	// Reading another page's `templateContent` renders that page there and then.
	let liquid: ReturnType<typeof liquidEngine>;
	const site = testSite({}, { other: () => liquid.render("{{ 'inner' }}", {}, site.ctx("other.liquid")), later: async (s: unknown) => `later:${s}` });
	liquid = liquidEngine(site.env);
	assert.equal(await liquid.render("{{ x | other }} {{ x | later }}", { x: "x" }, site.ctx("page.liquid")), "inner later:x");
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

test("strict_refuses_what_0_7_refused", async () => {
	const site = testSite({ "_includes/a.liquid": "x\n{{ nope }}" }, {}, true);
	const liquid = liquidEngine(site.env);
	// Asking whether a value is there is fine; using one that isn't is an error.
	assert.equal(liquid.render("{% if nope %}x{% endif %}{% unless nope.x %}u{% endunless %}{% if nope and nada %}y{% endif %}", {}, site.ctx("page.liquid")), "u");
	for (const source of ["{{ nope | default: \"d\" }}", "{% if title == nope %}{% endif %}", "{% case nope %}{% when 1 %}{% endcase %}", "{% assign y = nope %}"]) {
		const message = await failure(() => liquid.render(source, { title: "t" }, site.ctx("page.liquid")));
		assert.ok(message.includes("requested variable=nope"), `${source}: ${message}`);
	}
	// In an include, the include's file and line.
	const message = await failure(() => liquid.render("one\n{% include \"a\" %}", {}, site.ctx("page.liquid")));
	assert.ok(message.startsWith("_includes/a.liquid:2: Unknown variable"), message);
});

/** `run` with the machine's time zone set to `zone` (Node reads `TZ` again when it changes). */
function inZone<T>(zone: string, run: () => T): T {
	const was = process.env.TZ;
	process.env.TZ = zone;
	try { return run(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

test("liquids_own_filters_see_a_date_as_0_7_wrote_it", () => {
	const site = testSite({});
	const liquid = liquidEngine(site.env);
	const date = new Date("2026-01-02T03:04:05Z");
	const out = inZone("America/Los_Angeles", () => liquid.render("[{{ date | append: \"x\" }}] [{{ date | truncate: 15 }}] [{{ date | slice: 0, 10 }}] [{{ date | size }}] [{{ dates | join: \", \" }}] [{{ date | raw }}]", { date, dates: [date, date] }, site.ctx("page.liquid")));
	const shown = "2026-01-02 03:04:05 +0000";
	assert.equal(out, `[${shown}x] [2026-01-02 0...] [2026-01-02] [25] [${shown}, ${shown}] [${shown}]`);
});

test("each_function_runs_once_a_page_though_one_is_async", async () => {
	let count = 0;
	const site = testSite({}, { count: () => ++count, later: async (s: unknown) => `later:${s}` });
	const liquid = liquidEngine(site.env);
	const source = "{{ 1 | count }} {{ 1 | count }} {{ title | later }} {{ 1 | count }}";
	assert.equal(await liquid.render(source, { title: "x" }, site.ctx("page.liquid", "page.liquid")), "1 2 later:x 3");
	// The next page of the template renders asynchronously from the start.
	assert.equal(await liquid.render(source, { title: "y" }, site.ctx("page.liquid", "page.liquid")), "4 5 later:y 6");
});

test("numbers_are_0_7s_whole_numbers_and_floats", async () => {
	const site = testSite({});
	const liquid = liquidEngine(site.env);
	const out = liquid.render("{{ 10 | times: 1.0 | divided_by: 4 }}|{{ 10 | plus: 0.0 | divided_by: 4 }}|{{ ratio | times: 2 | divided_by: 2 }}|{{ 10.0 | divided_by: 4 }}|{% assign y = 4.0 %}{{ 10 | divided_by: y }}|{{ 7 | divided_by: 2 }}|{{ -7 | divided_by: 2 }}|{{ 7 | modulo: -3 }}|{{ 10 | times: 1.0 }}|{{ \"3\" | plus: 1 }}|{{ -2.5 | round }}|{{ 2.567 | round: 2 }}", { ratio: 2.5 }, site.ctx("page.liquid"));
	assert.equal(out, "2.5|2.5|2.5|2.5|2.5|3|-3|1|10|4|-3|2.57");
	// DELIBERATE (after 0.8.0): text and nothing are numbers as Ruby's Liquid reads them (Jekyll's,
	// decided 2026-11-18), where 0.7 said "Number expected": `"r>"` and nothing are 0, `"3.5x"` is 3.
	assert.equal(liquid.render("{{ nope | plus: 1 }}|{{ 1 | plus: nope }}|{{ \"r>\" | times: 1 }}|{{ \"3.5x\" | minus: 1 }}|{{ \"2.5\" | times: 2 }}", {}, site.ctx("page.liquid")), "1|1|0|2|5");
	for (const [source, said] of [["{{ 1 | divided_by: 0 }}", "Can't divide by zero"], ["{{ 1 | divided_by: \"x\" }}", "Can't divide by zero"]]) {
		const message = await failure(() => liquid.render(source, {}, site.ctx("page.liquid")));
		assert.ok(message.startsWith("page.liquid:1: ") && message.includes(said), message);
	}
});

test("a_missing_value_reaches_a_function_as_null", () => {
	const site = testSite({}, { show: (v: unknown) => (v === null ? "null" : typeof v), two: (a: unknown, b: unknown = "B") => `${a}+${b}` });
	const liquid = liquidEngine(site.env);
	assert.equal(liquid.render("{{ nope | show }} {{ \"x\" | two: nope }} {{ \"x\" | two }}", {}, site.ctx("page.liquid")), "null x+null x+B");
});

test("the_smaller_filters_give_0_7s_output", async () => {
	const site = testSite({ "_includes/nav.liquid": "nav" });
	const liquid = liquidEngine(site.env);
	const data = { obj: { a: 1, b: 2 }, list: ["a", "b"], same: [{ x: 1 }, { x: 1 }, { x: 2 }] };
	const out = liquid.render("{{ 'a\"b' | escape }}|{{ '&amp; \"x\"' | escape_once }}|{{ obj | size }}|{{ 5 | size }}|{{ same | uniq | size }}|{{ \"hello world\" | truncatewords: 0 }}|{{ \"a  b   c\" | truncatewords: 2 }}|{{ 'a\\nb' }}|{{ list | map: \"x\" | size }}|{{ \"a%20b+c%\" | url_decode }}|{{ \"hello world\" | truncate: 8, \"…\" }}", data, site.ctx("page.liquid"));
	// DELIBERATE (0.11, from the fresh www.ruby-lang.org move): `truncate` and `truncatewords` are Ruby's
	// Liquid 4's (Jekyll's), where 0.7 counted bytes (`…` was 3) and split at single spaces.
	assert.equal(out, "a&quot;b|&amp; &quot;x&quot;|2|1|2|hello...|a b...|a\\nb|0|a b c%|hello w…");
	// What 0.7 refused is still refused.
	for (const [source, said] of [["{% include \"nav\", a: 1 %}", "expected \"=\""], ["{% include \"nav\" with title %}", "not `with` or `for`"], ["{{ title | }}", "expected a filter's name"], ["{{ 1e3 }}", "`1e3` isn't a number"], ["{{ \"%E2%82\" | url_decode }}", "Malformed UTF-8"]]) {
		const message = await failure(() => liquid.render(source, { title: "t" }, site.ctx("page.liquid")));
		assert.ok(message.includes(said), `${source}: ${message}`);
	}
	// A missing include's suggestion is close to the name asked for.
	assert.equal(await failure(() => liquid.render("{% include \"zz\" %}", {}, site.ctx("page.liquid"))), "page.liquid:1: template not found: can't include `zz`");
	assert.equal(await failure(() => liquid.render("{% include \"nva\" %}", {}, site.ctx("page.liquid"))), "page.liquid:1: template not found: can't include `nva` (did you mean `nav.liquid`?)");
});

// Two places where 0.7 was odd and Shopify and Jekyll aren't: splitting by nothing gives the
// characters (0.7 put an empty string at each end), and two items join with `and` alone.
test("split_and_sentences_follow_shopify_and_jekyll", () => {
	const site = testSite({});
	const liquid = liquidEngine(site.env);
	const out = liquid.render("{{ \"abc\" | split: \"\" | join: \"-\" }}|{{ \"abc\" | split: \"\" | size }}|{{ two | array_to_sentence_string }}|{{ three | array_to_sentence_string }}|{{ one | array_to_sentence_string }}|{{ two | array_to_sentence_string: \"or\" }}", { one: ["pine"], two: ["pine", "cedar"], three: ["pine", "cedar", "fir"] }, site.ctx("page.liquid"));
	assert.equal(out, "a-b-c|3|pine and cedar|pine, cedar, and fir|pine|pine or cedar");
});

// `where` and `reject` take a fast path for lists and plain properties (liquid.ts fastWhere). Every
// answer has to be liquidjs' own: the same templates through liquidjs as it comes.
test("where_and_reject_answer_as_liquidjs_does", async () => {
	const { Liquid } = await import("liquidjs");
	const plain = new Liquid({ jekyllInclude: true, strictFilters: true });
	const site = testSite({});
	const liquid = liquidEngine(site.env);
	const items = [
		{ title: "Pine", data: { lang: "en", tags: ["a", "b"], order: 1, draft: false }, method() { return "m"; } },
		{ title: "Pin", data: { lang: "fr", tags: ["a"], order: "1", draft: true }, method() { return "n"; } },
		{ title: "Cedar", data: { lang: "en", tags: [], order: 2 } },
		{ title: "Fir", data: null },
		{ title: "", data: { lang: "" } },
	];
	const data = { items, site: "global", nested: [[1, 2], [3]], words: ["x", "y"], hash: { a: 1 } };
	for (const template of [
		"{{ items | where: 'data.lang', 'en' | map: 'title' | json }}",
		"{{ items | where: \"data.lang\", \"fr\" | map: 'title' | json }}",
		"{{ items | where: 'data.lang' | map: 'title' | json }}",
		"{{ items | where: 'title' | map: 'title' | json }}",
		"{{ items | where: 'data.draft' | map: 'title' | json }}",
		"{{ items | where: 'data.draft', false | map: 'title' | json }}",
		"{{ items | where: 'data.order', 1 | map: 'title' | json }}",
		"{{ items | where: 'data.order', '1' | map: 'title' | json }}",
		"{{ items | where: 'data.tags.size', 2 | map: 'title' | json }}",
		"{{ items | where: 'data.tags.first', 'a' | map: 'title' | json }}",
		"{{ items | where: 'data.tags', empty | map: 'title' | json }}",
		"{{ items | where: 'data.tags', blank | map: 'title' | json }}",
		"{{ items | where: 'method', 'm' | map: 'title' | json }}",
		"{{ items | where: 'missing.deeper', nil | map: 'title' | json }}",
		"{{ items | where: 'site', 'global' | map: 'title' | json }}",
		"{{ items | where: 'data[\"lang\"]', 'en' | map: 'title' | json }}",
		"{{ nested | where: 'size', 2 | json }}",
		"{{ words | where: 'size', 1 | json }}",
		"{{ hash | where: 'size', 1 | json }}",
		"{{ items | reject: 'data.lang', 'en' | map: 'title' | json }}",
		"{{ items | reject: 'data.draft' | map: 'title' | json }}",
	]) {
		assert.equal(await liquid.render(template, data, site.ctx("page.liquid")), await plain.parseAndRender(template, data), template);
	}
});

// A list whose items are plain objects with primitive values is grouped once a render, and each
// `where` after is a lookup (liquid.ts groupsFor): the answers are still liquidjs' own.
test("where_looks_a_grouped_list_up_as_liquidjs_does", async () => {
	const { Liquid } = await import("liquidjs");
	const plain = new Liquid({ jekyllInclude: true, strictFilters: true });
	const site = testSite({});
	const liquid = liquidEngine(site.env);
	const articles = [
		{ title: "Pine", lang: "en", order: 1, data: { slug: "pine" } },
		{ title: "Pin", lang: "fr", order: "1", data: { slug: "pin" } },
		{ title: "Cedar", lang: "en", order: 2, data: { slug: "cedar" } },
		{ title: "Nothing", lang: null, order: Number.NaN, data: { slug: null } },
		{ title: "Unset", order: 0, data: {} },
	];
	const template = [
		"{% for lang in langs %}{{ articles | where: 'lang', lang | map: 'title' | json }}{% endfor %}",
		"{% for lang in langs %}{{ articles | where: 'lang', lang | map: 'title' | json }}{% endfor %}",
		"{{ articles | where: 'order', 1 | map: 'title' | json }} {{ articles | where: 'order', '1' | map: 'title' | json }}",
		"{{ articles | where: 'order', nan | map: 'title' | json }} {{ articles | where: 'lang', nil | map: 'title' | json }}",
		"{{ articles | where: 'data.slug', 'cedar' | map: 'title' | json }} {{ articles | where: 'data.slug', nil | map: 'title' | json }}",
		"{{ articles | where: 'lang', 'en' | where: 'order', 2 | map: 'title' | json }} {{ articles | reject: 'lang', 'en' | map: 'title' | json }}",
	].join("\n");
	const data = { articles, langs: ["en", "fr", "de", ""], nan: Number.NaN };
	assert.equal(await liquid.render(template, data, site.ctx("page.liquid")), await plain.parseAndRender(template, data));
	// The groups last one render: a list the site changes before the next page answers anew.
	articles[0].lang = "fr";
	assert.equal(await liquid.render(template, data, site.ctx("page.liquid")), await plain.parseAndRender(template, data));
	// An item without the first name reads it from the globals, as liquidjs' scope does.
	const globals = { articles, langs: ["en", "fr"], lang: "fr" };
	const missing = "{{ articles | where: 'lang', 'fr' | map: 'title' | json }}";
	assert.equal(await liquid.render(missing, globals, site.ctx("page.liquid")), await plain.parseAndRender(missing, globals));
});
