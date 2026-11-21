// From plugins/jinja/src/lib.rs, and the errors the plan asks every engine for: an unknown filter
// and a filter that throws both name the template's line.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Filter } from "../config.ts";
import { BuildError } from "../diagnostics.ts";
import type { EngineEnv, RenderContext } from "./engine.ts";
import { markdownAttributes } from "./jinja.ts";
import nunjucks from "nunjucks";
import { nunjucksEngine } from "./nunjucks.ts";
import type { Flavor } from "./nunjucks.ts";

function engine(flavor: Flavor, functions: Record<string, Filter> = {}, includes: Record<string, string> = {}, strict = false) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-nunjucks-"));
	const dir = path.join(root, "_includes");
	for (const [name, text] of Object.entries(includes)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), text);
	}
	const env = { config: { root }, dirs: {}, includeDirs: [dir], globals: new Map(Object.entries(functions)), pipeFilters: new Map(), strict } as unknown as EngineEnv;
	return nunjucksEngine(env, flavor);
}

const ctx = (name = "page.njk"): RenderContext => ({ name, inputPath: `/site/${name}` });

/** What rendering `source` throws, as the build reports it. */
async function error(render: () => string | Promise<string>): Promise<string> {
	try {
		await render();
	} catch (e) {
		assert.ok(e instanceof BuildError, String(e));
		return e.message;
	}
	assert.fail("it rendered");
}

test("an_unknown_filter_names_its_line", async () => {
	for (const flavor of ["njk", "jinja"] as const) {
		const e = engine(flavor, { shout: (s) => String(s).toUpperCase() });
		assert.equal(await error(() => e.render("one\n{{ shout('x') }}\n{{ title | shot }}", {}, ctx())), "page.njk:3: unknown filter `shot` (did you mean `shout`?)");
		assert.equal(await error(() => e.render("{{ title | uper }}", {}, ctx())), "page.njk:1: unknown filter `uper` (did you mean `upper`?)");
		// Another generator's filter says ssqch's way.
		assert.match(await error(() => e.render("\n{{ title | absolute_url }}", {}, ctx())), /^page\.njk:2: unknown filter `absolute_url`\. /);
	}
});

test("a_filter_that_throws_names_its_line_and_the_function", async () => {
	const e = engine("njk", { boom: () => { throw new Error("the snack drawer is empty"); } });
	const message = await error(() => e.render("a\nb\n{{ 'x' | boom }}", {}, ctx()));
	assert.match(message, /^page\.njk:3: boom\(\): the snack drawer is empty/);
	// Called as a function, and as a tag.
	assert.match(await error(() => e.render("a\n{{ boom() }}", {}, ctx())), /^page\.njk:2: boom\(\): the snack drawer is empty/);
	assert.match(await error(() => e.render("a\n\n{% boom %}", {}, ctx())), /^page\.njk:3: boom\(\): the snack drawer is empty/);
	// An async one that rejects.
	const later = engine("jinja", { later: async () => { throw new Error("not yet"); } });
	assert.match(await error(() => later.render("a\n{{ 'x' | later }}", {}, ctx("page.jinja"))), /^page\.jinja:2: later\(\): not yet/);
});

test("runtime_errors_arent_a_line_short", async () => {
	const e = engine("jinja");
	assert.equal(await error(() => e.render("a\nb\n{% if 3 is od %}{% endif %}", {}, ctx("p.jinja"))), "p.jinja:3: unknown test `od` (did you mean `odd`?)");
	assert.equal(await error(() => e.render("a\n{{ shoutt(1) }}", {}, ctx("p.jinja"))), "p.jinja:2: unknown function `shoutt`");
	assert.equal(await error(() => e.render("ok\n{% if %}", {}, ctx("p.jinja"))), "p.jinja:2: syntax error: unexpected end of block");
	assert.equal(await error(() => e.render("{{ 1 + }}", {}, ctx("p.jinja"))), "p.jinja:1: syntax error: unexpected end of variable block");
});

test("an_include_that_doesnt_parse_is_an_error_at_its_line", async () => {
	// The half-typed tag a dev server sees most. nunjucks answered a synchronous render with
	// `null` for it and threw the error later, where nothing caught it.
	const includes = { "nav.njk": "<nav>\n{% if %}</nav>", "deeper.njk": "a {% include \"nav.njk\" %}", "macros.njk": "{% macro x() %}\n{% if %}{% endmacro %}", "base.njk": "{% block a %}{% endblock %}\n\n{% if %}" };
	for (const flavor of ["njk", "jinja"] as const) {
		const e = engine(flavor, { later: async (s) => `${s}!` }, includes);
		for (const source of ["{% include \"nav.njk\" %}", "{% include \"deeper.njk\" %}", "{% for i in [1, 2] %}{% include \"nav.njk\" %}{% endfor %}", "{{ 'x' | later }}{% include \"nav.njk\" %}"]) {
			assert.equal(await error(() => e.render(source, {}, ctx())), "nav.njk:2: syntax error: unexpected end of block", source);
		}
		// A macro file names itself, not the template that imported it.
		assert.equal(await error(() => e.render("{% import \"macros.njk\" as m %}{{ m.x() }}", {}, ctx())), "macros.njk:2: syntax error: unexpected end of block");
		assert.equal(await error(() => e.render("{% from \"macros.njk\" import x %}{{ x() }}", {}, ctx())), "macros.njk:2: syntax error: unexpected end of block");
		assert.equal(await error(() => e.render("{% extends \"base.njk\" %}{% block a %}hi{% endblock %}", {}, ctx())), "base.njk:3: syntax error: unexpected end of block");
	}
});

test("a_missing_template_names_its_tag_and_what_was_meant", async () => {
	const e = engine("jinja", {}, { "partials/nav.jinja": "<nav></nav>", "base.jinja": "{{ content }}" });
	assert.equal(await error(() => e.render("a\n{% include \"partials/navv.jinja\" %}", {}, ctx("p.jinja"))), "p.jinja:2: template not found: can't include `partials/navv.jinja` (did you mean `partials/nav.jinja`?)");
	assert.equal(await error(() => e.render("{% extends \"bse.jinja\" %}", {}, ctx("p.jinja"))), "p.jinja:1: template not found: no template named `bse.jinja` (did you mean `base.jinja`?)");
});

test("an_error_in_an_include_names_the_include", async () => {
	const e = engine("njk", {}, { "nav.njk": "<nav>\n{{ x | nope }}</nav>" });
	assert.equal(await error(() => e.render("a\n\n{% include \"nav.njk\" %}", {}, ctx())), "nav.njk:2: unknown filter `nope`");
});

test("async_filters_are_awaited_and_stay_async", async () => {
	const e = engine("njk", { later: async (s) => `${s}!`, shout: (s) => String(s).toUpperCase() });
	assert.equal(e.render("{{ 'a' | shout }}", {}, ctx()), "A");
	assert.equal(await e.render("{{ 'a' | later }} {{ 'b' | shout }}", {}, ctx()), "a! B");
	// Once a function is async, a page that uses it answers with a promise.
	assert.equal(await e.render("{{ 'c' | later }}", {}, ctx()), "c!");
	// A tag can be async too.
	assert.equal(await e.render("{% later 'd' %}", {}, ctx()), "d!");
});

test("tags_from_functions_in_njk", () => {
	const e = engine("njk", { image: (src, alt) => `<img src="${src}" alt="${alt}">`, callout: (content, kind = "note") => `<aside class="${kind}">${String(content).trim()}</aside>`, include: () => "never called" }, { "part.njk": "part" });
	assert.equal(e.render("{% image \"/a.png\", t %}|{%- callout \"tip\" -%}\n  <b>{{ t }}</b>\n{%- endcallout %}|{% callout %}Plain{% endcallout %}|{% include \"part.njk\" %}", { t: "Pines" }, ctx()), "<img src=\"/a.png\" alt=\"Pines\">|<aside class=\"tip\"><b>Pines</b></aside>|<aside class=\"note\">Plain</aside>|part");
});

test("escaping_as_nunjucks_in_njk_and_as_jinja_in_jinja", () => {
	const data = { win: "C:\\trail <'\"&>" };
	assert.equal(engine("njk").render("{{ win }}|{{ win | e }}|{{ win | safe }}", data, ctx()), "C:&#92;trail &lt;&#39;&quot;&amp;&gt;|C:&#92;trail &lt;&#39;&quot;&amp;&gt;|C:\\trail <'\"&>");
	assert.equal(engine("jinja").render("{{ win }}|{{ win | e }}|{{ win | safe }}", data, ctx()), "C:\\trail &lt;&#39;&quot;&amp;&gt;|C:\\trail &lt;&#39;&quot;&amp;&gt;|C:\\trail <'\"&>");
});

test("values_print_as_0_7_printed_them", () => {
	const e = engine("jinja");
	const when = new Date("2026-03-14T09:05:07.250Z");
	assert.equal(e.render("{{ t }}|{{ f }}|{{ n }}|{{ u }}|{{ xs }}|{{ o }}|{{ when }}", { t: true, f: false, n: null, xs: ["a", 1], o: { a: "it's" }, when }, ctx()), "True|False|||[&#39;a&#39;, 1]|{&#39;a&#39;: &quot;it&#39;s&quot;}|2026-03-14T09:05:07.250Z");
});

test("jinja_filters_tests_and_functions", () => {
	const e = engine("jinja");
	const people = [{ name: "Ann", age: 30, team: "red" }, { name: "Bo", age: 20, team: "blue" }, { name: "Cy", age: 25, team: "red" }];
	const cases: Array<[string, string]> = [
		["{{ people | map(attribute='name') | join(',') }}", "Ann,Bo,Cy"],
		["{{ people | selectattr('age', 'gt', 22) | map(attribute='name') | join }}", "AnnCy"],
		["{{ people | sum(attribute='age') }}", "75"],
		["{% for g in people | groupby('team') %}{{ g.grouper }}:{{ g.list | length }};{% endfor %}", "blue:1;red:2;"],
		["{{ ['a', 'a', 'b'] | unique | join }}|{{ [3, 1, 2] | min }}{{ [3, 1, 2] | max }}", "ab|13"],
		["{{ {'a': 1, 'b': 2} | tojson }}|{{ \"<a href='x'>\" | tojson }}", "{\"a\": 1, \"b\": 2}|\"\\u003ca href=\\u0027x\\u0027\\u003e\""],
		["{{ 'a,b' | split(',') | join('|') }}|{{ '%s-%05.1f' | format('x', 3.14159) }}|{{ 2.5 | round }}|{{ 3.5 | round }}", "a|b|x-003.1|2|4"],
		["{{ 2 | pluralize }}|{{ 1 | pluralize }}|{{ 2048 | filesizeformat }}|{{ '<b>x</b> &amp; y' | striptags }}", "s||2.0 kB|x &amp; y"],
		["{{ 'the quick fox' | truncate(9) }}|{{ 'the quick' | truncate(5, true) }}", "the...|the q..."],
		["{{ 'abc'.upper() }}|{{ ' a '.strip() }}|{{ 'a b'.split() | length }}|{{ {'a': 1}.items() | length }}|{{ 'abc'.startsWith('a') }}", "ABC|a|2|1|True"],
		["{{ xs[1:] | join }}|{{ xs[:-1] | join }}|{{ xs[::-1] | join }}|{{ xs[-1] }}|{{ 'abcd'[1:3] }}", "bc|ab|cba|c|bc"],
		["{{ 3 is integer }}|{{ 'abc' is startingwith('a') }}|{{ none is none }}|{{ 2 is in([1, 2]) }}|{{ 'upper' is filter }}", "True|True|True|True|True"],
		["{{ dict(a=1).a }}|{% set ns = namespace(n=0) %}{% for x in xs %}{% set ns.n = ns.n + 1 %}{% endfor %}{{ ns.n }}|{{ True }}{{ None }}", "1|3|True"],
		["{% for k in {'a': 1, 'b': 2} %}{{ k }}{% endfor %}|{% for x in xs %}{{ loop.cycle('o', 'e') }}{% endfor %}", "ab|oeo"],
		["{{ when | dateformat }}|{{ when | datetimeformat('short') }}|{{ when | dateformat('%B %-d, %Y') }}|{{ when.strftime('%Y') }}|{{ when.isoformat() }}|{{ 1700000000 | dateformat('iso') }}", "Mar 14 2026|2026-03-14 09:05|March 14, 2026|2026|2026-03-14T09:05:07+00:00|2023-11-14"],
	];
	const data = { people, xs: ["a", "b", "c"], when: new Date("2026-03-14T09:05:07.250Z") };
	for (const [source, want] of cases) assert.equal(e.render(source, data, ctx()), want, source);
});

test("jinja_says_what_it_cant_do", async () => {
	const e = engine("jinja");
	assert.equal(await error(() => e.render("{{ when | dateformat('%Q') }}", { when: new Date(0) }, ctx("p.jinja"))), "p.jinja:1: invalid operation: \"%Q\" isn't a date format (use short, medium, long, full, iso, unix, or a strftime pattern like \"%B %-d, %Y\")");
	assert.equal(await error(() => e.render("\n{{ 'nope' | dateformat }}", {}, ctx("p.jinja"))), "p.jinja:2: invalid operation: not a date: nope");
	assert.match(await error(() => e.render("{% for x in xs if x %}{% endfor %}", { xs: [] }, ctx("p.jinja"))), /^p\.jinja:1: syntax error: a loop can't filter with `if`/);
});

test("strict_mode_refuses_undefined_and_prints_none", async () => {
	const e = engine("jinja", {}, {}, true);
	assert.equal(e.render("[{{ n }}]", { n: null }, ctx()), "[]");
	assert.equal(await error(() => e.render("a\n{{ nope }}", {}, ctx("p.jinja"))), "p.jinja:2: printed an undefined value (strict is on)");
});

test("dates_in_templates_are_utc", () => {
	const e = engine("njk");
	// 23:30 UTC on New Year's Eve is already next year east of Greenwich, and still this one west of it.
	const when = new Date("2025-12-31T23:30:00Z");
	assert.equal(e.render("{{ when.getFullYear() }}-{{ when.getMonth() }}-{{ when.getDate() }} {{ when.getHours() }}", { when }, ctx()), "2025-11-31 23");
});

test("heading_attributes_in_markdown_arent_comments", () => {
	const input = "## Install {#setup .wide}\n\nIt’s here {# a note #}\n## Later {#later}\r\n{#- trimmed -#}\n{#x} not at the end #}";
	const want = "## Install {% raw %}{#setup .wide}{% endraw %}\n\nIt’s here {# a note #}\n## Later {% raw %}{#later}\r{% endraw %}\n{#- trimmed -#}\n{#x} not at the end #}";
	assert.equal(markdownAttributes(input), want);
	const e = engine("njk");
	assert.equal(e.render("## Install {#setup}\n{{ 'x' }} {# gone #}", {}, { name: "a.md", inputPath: "/site/a.md" }), "## Install {#setup}\nx ");
});

// ---- from the stage 3 review: what 0.7 gave, kept --------------------------------------------

test("async_functions_work_anywhere_and_run_once", async () => {
	const seen: string[] = [];
	const e = engine("njk", { later: async (s) => `L:${s}`, nope: async () => false, note: (s) => { seen.push(String(s)); return s; } }, { "m.njk": "{% macro tag(x) %}<t>{{ x | later }}</t>{% endmacro %}" });
	const cases: Array<[string, string]> = [
		["[{{ later('b') }}]|{% set v = later('c') %}[{{ v }}]|{% if nope() %}t{% else %}f{% endif %}|{{ later('d') | upper }}", "[L:b]|[L:c]|f|L:D"],
		["{% macro local(x) %}<l>{{ x | later }}</l>{% endmacro %}{{ local('b') }} after", "<l>L:b</l> after"],
		["{% from 'm.njk' import tag %}{{ tag('a') }}", "<t>L:a</t>"],
		["{% set cap %}{{ 'e' | later }}{% endset %}[{{ cap }}]|{% filter upper %}{{ 'd' | later }}{% endfilter %}", "[L:e]|L:D"],
		["{% macro w() %}<w>{{ caller() }}</w>{% endmacro %}{% call w() %}{{ 'f' | later }}{% endcall %}|{{ ['i', 'j'] | map('later') | join(',') }}", "<w>L:f</w>|L:i,L:j"],
		["{% later 'g' %}|{{ later(later('h')) }}", "L:g|L:L:h"],
	];
	for (const [source, want] of cases) assert.equal(await e.render(source, {}, ctx()), want, source);
	// Each function runs once, even though the template renders again for the async one.
	assert.equal(await e.render("{{ 'a' | note }} {{ 'b' | later }} {{ 'c' | note }}", {}, ctx()), "a L:b c");
	assert.deepEqual(seen, ["a", "c"]);
	// A template with nothing async in it is still a string at once, whatever others did.
	assert.equal(e.render("{{ 'x' | upper }}", {}, ctx()), "X");
	// An async function that rejects names its line.
	const bad = engine("njk", { later: async () => { throw new Error("not yet"); } });
	assert.match(await error(() => bad.render("a\n{% macro m() %}{{ later() }}{% endmacro %}\n{{ m() }}", {}, ctx())), /^page\.njk:2: later\(\): not yet/);
});

test("truth_is_jinjas", () => {
	const e = engine("jinja");
	const data = { empty: [], obj0: {}, xs: ["a"] };
	assert.equal(e.render("{% if empty %}T{% else %}F{% endif %}|{% if obj0 %}T{% else %}F{% endif %}|{{ empty or 'default' }}|{{ 'yes' if empty else 'no' }}|{{ empty | default('d', true) }}|{% if not empty %}none{% endif %}", data, ctx()), "F|F|default|no|d|none");
	assert.equal(e.render("{{ empty and 'x' }}|{{ 0 or 'z' }}|{{ '' or 0 }}|{{ xs and 'has' }}|{{ none or false }}|{% if '0' %}s{% endif %}", data, ctx()), "[]|z|0|has|False|s");
});

test("tilde_joins_text_as_values_print", () => {
	// In `.njk` as Nunjucks prints values (`true`, `1,2`, nothing for none); in `.jinja` as Jinja does.
	const njk = engine("njk");
	assert.equal(njk.render("[{{ missing ~ ' | ' ~ missing2 }}]|{{ 'a' ~ none }}|{{ true ~ '' }}|{{ [1, 2] ~ '' }}|{{ '<b>' | safe ~ '<i>' }}|{{ '\\\\' | safe ~ '\\\\' }}", {}, ctx()), "[ | ]|a|true|1,2|<b>&lt;i&gt;|\\&#92;");
	const jinja = engine("jinja");
	assert.equal(jinja.render("[{{ missing ~ ' | ' ~ missing2 }}]|{{ 'a' ~ none }}|{{ true ~ '' }}|{{ [1, 2] ~ '' }}|{{ '<b>' | safe ~ '<i>' }}", {}, ctx("page.jinja")), "[ | ]|aNone|True|[1, 2]|<b>&lt;i&gt;");
});

// `.njk` prints as Nunjucks does, as a site from Eleventy expects; `.jinja` keeps Jinja's
// printing. A date is ISO 8601 in both, whatever the machine's time zone.
test("njk_prints_values_as_nunjucks_does", () => {
	const data = { ok: true, tags: ["a", "b"], obj: { x: 1 }, when: new Date("2024-03-04T05:06:07Z") };
	const page = "{{ ok }}|{{ tags }}|{{ obj }}|{{ tags | dump }}|{{ obj | dump | safe }}|{{ obj | dump(2) | safe }}|{{ ok | string }}|{{ [true, none, 2] | join(',') }}|{{ [when] }}";
	assert.equal(engine("njk").render(page, data, ctx()), "true|a,b|[object Object]|[&quot;a&quot;,&quot;b&quot;]|{\"x\":1}|{\n  \"x\": 1\n}|true|true,,2|2024-03-04T05:06:07.000Z");
	assert.equal(engine("jinja").render(page, data, ctx("page.jinja")), "True|[&#39;a&#39;, &#39;b&#39;]|{&#39;x&#39;: 1}|[\"a\", \"b\"]|{\"x\": 1}|{\n  \"x\": 1\n}|True|True,None,2|[2024-03-04T05:06:07.000Z]");
});

test("tags_from_functions_work_in_jinja_too", () => {
	const functions = { image: (src: unknown, alt: unknown) => `<img src="${src}" alt="${alt}">`, callout: (body: unknown, kind = "note") => `<aside class="${kind}">${String(body).trim()}</aside>` };
	for (const [flavor, name] of [["njk", "page.njk"], ["jinja", "page.jinja"]] as const) {
		assert.equal(engine(flavor, functions).render("{% image \"/a.png\", \"A pine\" %}{% callout \"tip\" %} Look up {% endcallout %}", {}, ctx(name)), "<img src=\"/a.png\" alt=\"A pine\"><aside class=\"tip\">Look up</aside>", flavor);
	}
});

test("an_import_sees_the_pages_data", () => {
	const e = engine("njk", {}, { "macros.njk": "{% macro link(path) %}<a href=\"{{ site.url }}{{ path }}\">{{ site.title }} / {{ page.url }}</a>{% endmacro %}" });
	const data = { site: { title: "Pine Cone Crunch", url: "https://example.com" }, page: { url: "/a/" } };
	assert.equal(e.render("{% import 'macros.njk' as m %}{{ m.link('/x/') }}|{% from 'macros.njk' import link %}{{ link('/y/') }}", data, ctx()), "<a href=\"https://example.com/x/\">Pine Cone Crunch / /a/</a>|<a href=\"https://example.com/y/\">Pine Cone Crunch / /a/</a>");
	assert.equal(e.render("{% import 'macros.njk' as m without context %}{{ m.link('/x/') }}", data, ctx()), "<a href=\"/x/\"> / </a>");
});

test("tuples_are_tuples", () => {
	const e = engine("jinja");
	assert.equal(e.render("{% for label, url in [('Home', '/'), ('Blog', '/blog/')] %}<a href=\"{{ url }}\">{{ label }}</a>{% endfor %}|{{ (1, 2) }}|{{ (1) }}|{{ {'a': 1} | items | list }}|{% set a, b = 1, 2 %}{{ a }}{{ b }}|{% set c, d = 3 %}{{ c }}{{ d }}", {}, ctx()), "<a href=\"/\">Home</a><a href=\"/blog/\">Blog</a>|(1, 2)|1|[(&#39;a&#39;, 1)]|12|33");
});

test("set_changes_only_a_namespace", async () => {
	const e = engine("jinja");
	const site = { title: "Pine" };
	assert.equal(await error(() => e.render("a\n{% set site.title = 'Changed' %}", { site }, ctx("p.jinja"))), "p.jinja:2: invalid operation: can only assign to namespaces, not map");
	assert.equal(site.title, "Pine");
	assert.equal(e.render("{% set ns = namespace(found=false) %}{% for x in xs %}{% if x == 'b' %}{% set ns.found = true %}{% endif %}{% endfor %}{{ ns.found }}", { xs: ["a", "b"] }, ctx()), "True");
});

test("comparisons_and_modulo_are_jinjas", async () => {
	const e = engine("jinja");
	assert.equal(e.render("{{ 0 == '' }}|{{ 1 == '1' }}|{{ [] == false }}|{{ '' == false }}|{{ [1] == [1] }}|{{ {'a': 1} == {'a': 1} }}|{{ 1 == 1.0 }}|{{ true == 1 }}|{{ none == none }}|{{ missing == none }}|{{ 1 != 2 }}|{{ 'a' != 'a' }}", {}, ctx()), "False|False|False|False|True|True|True|True|True|False|True|False");
	assert.equal(e.render("{{ -7 % 3 }}|{{ 7 % -3 }}|{{ 3 > 2 > 1 }}|{{ 1 < 3 > 2 }}|{{ 1 < 2 < 3 }}|{% if page.fileSlug == 0 %}zero{% endif %}", { page: { fileSlug: "" } }, ctx()), "2|-2|True|True|True|");
	assert.equal(await error(() => e.render("{{ 'Hello %s' % 'x' }}", {}, ctx("p.jinja"))), "p.jinja:1: invalid operation: tried to use % operator on unsupported types string and string");
});

test("a_missing_value_in_a_filter_is_empty", () => {
	const e = engine("njk");
	assert.equal(e.render("[{{ m | first }}][{{ m | last }}][{{ m | batch(2) | length }}][{{ m | slice(2) | length }}][{{ m | reverse }}][{{ m | sort | length }}][{{ m | sum }}][{{ m | join(',') }}][{{ m | length }}][{{ m | int }}][{{ m | upper }}]", {}, ctx()), "[][][0][2][][0][0][][0][0][]");
	assert.equal(e.render("{% for post in posts %}{{ post.tags | first }}{% endfor %}", { posts: [{}, { tags: ["pine"] }] }, ctx()), "pine");
});

test("title_starts_words_where_jinja_does", () => {
	assert.equal(engine("jinja").render("{{ \"don't stop | the trail's end\" | title }}|{{ \"it's\".title() }}|{{ 'hello-world foo_bar' | title }}", {}, ctx()), "Don&#39;t Stop | The Trail&#39;s End|It&#39;s|Hello-World Foo_bar");
});

test("jinja_syntax_nunjucks_lacked", async () => {
	const e = engine("jinja", {}, { "part.jinja": "PART" });
	assert.equal(e.render("{% for i in [3, 6, 7] %}{% if i is divisibleby 3 %}{{ i }}{% endif %}{% endfor %}|{{ 'abc' is startingwith 'a' }}|{% include 'part.jinja' with context %}|{% include 'part.jinja' without context %}|{% include ['nope.jinja', 'part.jinja'] %}", {}, ctx()), "36|True|PART|PART|PART");
	assert.equal(await error(() => e.render("{% include ['nope.jinja', 'nope2.jinja'] %}", {}, ctx("p.jinja"))), "p.jinja:1: template not found: can't include `nope.jinja`");
	// What isn't supported says so, at its line, with what to write instead.
	assert.match(await error(() => e.render("a\n{% for i in xs recursive %}{% endfor %}", {}, ctx("p.jinja"))), /^p\.jinja:2: syntax error: a recursive loop .* write a macro that calls itself/);
	assert.match(await error(() => e.render("a\n{% for x in xs %}{% break %}{% endfor %}", {}, ctx("p.jinja"))), /^p\.jinja:2: syntax error: `\{% break %\}` isn't supported: /);
	assert.match(await error(() => e.render("{% with a = 1 %}{% endwith %}", {}, ctx("p.jinja"))), /^p\.jinja:1: syntax error: `\{% with %\}` isn't supported: use `\{% set %\}`/);
	assert.equal(await error(() => e.render("l1\n{% if true %}\nline", {}, ctx("p.jinja"))), "p.jinja:2: syntax error: the `{% if %}` here is never closed (`{% endif %}` is missing before the end of the template)");
	assert.equal(await error(() => e.render("l1\n{% for x in xs %}\n{% if x %}{% endif %}", {}, ctx("p.jinja"))), "p.jinja:2: syntax error: the `{% for %}` here is never closed (`{% endfor %}` is missing before the end of the template)");
	assert.equal(await error(() => e.render("{% for x in 5 %}{% endfor %}", {}, ctx("p.jinja"))), "p.jinja:1: invalid operation: number is not iterable");
	assert.equal(await error(() => e.render("a\n{{ 'abc'[::0] }}", {}, ctx("p.jinja"))), "p.jinja:2: invalid operation: cannot slice by step size of 0");
});

test("an_include_loop_is_named", async () => {
	const e = engine("njk", {}, { "a.njk": "{% include 'b.njk' %}", "b.njk": "{% include 'a.njk' %}" });
	assert.match(await error(() => e.render("{% include 'a.njk' %}", {}, ctx())), /we've passed this tree before\. Include loop: (a\.njk -> b\.njk -> a\.njk|b\.njk -> a\.njk -> b\.njk)$/);
});

test("strings_count_characters_not_halves", () => {
	assert.equal(engine("jinja").render("{{ t | length }}|{{ t.length }}|{{ t[0] }}|{{ t | first }}|{{ t | reverse }}|{{ t | last }}|{{ t[-1] }}|{{ t[1:] }}", { t: "🌲🌲a" }, ctx()), "3|3|🌲|🌲|a🌲🌲|a|a|🌲a");
});

test("urlencode_keeps_slashes", () => {
	assert.equal(engine("jinja").render("{{ '/a/b/' | urlencode }}|{{ 'https://example.com/a b/' | urlencode }}|{{ ['x', 'y'] | urlencode }}|{{ {'a': 'x y', 'b': 1, 'c': none} | urlencode }}|{{ 'a&b=c?d#e+f~g_h.i-j' | urlencode }}|{{ 'é' | urlencode }}", {}, ctx()), "/a/b/|https%3A//example.com/a%20b/|%5B%27x%27%2C%20%27y%27%5D|a=x%20y&amp;b=1|a%26b%3Dc%3Fd%23e%2Bf%7Eg_h.i-j|%C3%A9");
});

test("small_things_print_as_in_0_7", async () => {
	const e = engine("jinja", { shout: (s) => String(s).toUpperCase() });
	assert.equal(e.render("{{ shout }}|{{ [none, 1] }}|{{ none | string }}|{{ none | upper }}|{{ '%s' | format(none) }}|{{ [none, 1] | join(',') }}|{{ [when] }}|{{ o.items() | length }}|{{ 'a\\nb' | nl2br }}", { when: new Date("2024-03-04T00:00:00Z"), o: { items: [1, 2, 3] } }, ctx()), "function () { [native code] }|[None, 1]|None|NONE|None|None,1|[2024-03-04T00:00:00.000Z]|1|a<br />\nb");
	assert.equal(await error(() => e.render("{{ none | dateformat }}", {}, ctx("p.jinja"))), "p.jinja:1: invalid operation: not a date: None");
	// A function's own stack frame, as 0.7 named it.
	const boom = engine("jinja", { boom: function boom() { throw new Error("kaboom"); } });
	assert.doesNotMatch(await error(() => boom.render("{{ boom() }}", {}, ctx("p.jinja"))), /Context\.boom/);
});

test("jinja_reads_templates_as_jinja_does", () => {
	const e = engine("jinja", {}, { "p.jinja": "<p>inc</p>\n", "pr.njk": "x\n" });
	// Python's escapes in strings, `in` on a safe string's text, one final newline dropped, and sorted keys.
	assert.equal(e.render(String.raw`{{ "<h1" }}|{{ "\x3c" }}|{{ "\U0001F332" }}|{{ "\q" }}`, {}, ctx("page.jinja")), "&lt;h1|&lt;|\u{1F332}|q");
	assert.equal(e.render(`{{ "<h1" in body }}|{{ "<h2" not in body }}`, { body: new (nunjucks.runtime.SafeString as any)("<h1>Hi</h1>") }, ctx("page.jinja")), "True|True");
	assert.equal(e.render(`[{% include "p.jinja" %}]\n`, {}, ctx("page.jinja")), "[<p>inc</p>]");
	assert.equal(e.render(`{{ {"b": 1, "a": {"d": 2, "c": 3} } | tojson }}`, {}, ctx("page.jinja")), `{"a": {"c": 3, "d": 2}, "b": 1}`);
	// `.njk` keeps Nunjucks' newline and the keys' order.
	const n = engine("njk", {}, { "p.njk": "<p>inc</p>\n" });
	assert.equal(n.render(`[{% include "p.njk" %}]\n`, {}, ctx()), "[<p>inc</p>\n]\n");
	assert.equal(n.render(`{{ "\\u003c" }}|{{ {"b": 1, "a": 2} | tojson }}`, {}, ctx()), `&lt;|{"b": 1, "a": 2}`);
});

test("self_renders_a_block_by_name", () => {
	const e = engine("jinja", {}, { "base.jinja": "<title>{% block title %}Camp{% endblock %}</title><h1>{{ self.title() }}</h1>{% block announce %}{% endblock %}[{{ self.announce() }}]" });
	assert.equal(e.render(`{% extends "base.jinja" %}{% block title %}Cedar {{ 1 + 1 }}{% endblock %}`, {}, ctx("page.jinja")), "<title>Cedar 2</title><h1>Cedar 2</h1>[]");
	// A value named `self` is that value.
	assert.equal(e.render(`{{ self.name }}`, { self: { name: "Stump" } }, ctx("page.jinja")), "Stump");
});

test("an_error_after_an_include_or_in_a_layout_names_its_own_file_and_line", async () => {
	for (const flavor of ["njk", "jinja"] as const) {
		const e = engine(flavor, {}, { "p.jinja": "<p>inc</p>\n", "b2.jinja": "one\ntwo\n{% block main %}{% endblock %}\n{{ 'x' in nothing }}\n" });
		// The rest of a page after an include ran inside the include's render, and was named p.jinja:1.
		assert.match(await error(() => e.render("one\n{% include \"p.jinja\" %}\n{{ 'x' in nothing }}\n", {}, ctx())), /^page\.njk:3: Cannot use "in" operator/);
		// A parent template's code ran inside its child's block, and was named the child's line 1.
		assert.match(await error(() => e.render("{% extends \"b2.jinja\" %}{% block main %}hi{% endblock %}", {}, ctx())), /^b2\.jinja:4: Cannot use "in" operator/);
		// An error in an `{% if %}` names the if's line.
		assert.match(await error(() => e.render("a\nb\n{% if 'x' in nothing %}y{% endif %}", {}, ctx())), /^page\.njk:3: /);
	}
});

test("jinja_autoescape_false_prints_as_mkdocs_jinja_does", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-raw-"));
	const make = (config: Record<string, unknown>, flavor: Flavor = "jinja") => nunjucksEngine({ config: { root, ...config }, dirs: {}, includeDirs: [root], globals: new Map(), pipeFilters: new Map(), strict: false } as unknown as EngineEnv, flavor);
	const src = `{{ x }}|{{ x | e }}|{{ x ~ "!" }}|{{ flag }}`;
	assert.equal(make({ jinjaAutoescape: false }).render(src, { x: "<b>", flag: true }, ctx("page.jinja")), "<b>|&lt;b&gt;|<b>!|True");
	// mkdocsTemplates turns it off, unless jinja.autoescape says otherwise; `.njk` always escapes.
	assert.equal(make({ mkdocsTemplates: "mkdocs.yml" }).render(src, { x: "<b>", flag: true }, ctx("page.jinja")), "<b>|&lt;b&gt;|<b>!|True");
	assert.equal(make({ mkdocsTemplates: "mkdocs.yml", jinjaAutoescape: true }).render(src, { x: "<b>", flag: true }, ctx("page.jinja")), "&lt;b&gt;|&lt;b&gt;|&lt;b&gt;!|True");
	assert.equal(make({ jinjaAutoescape: false }, "njk").render("{{ x }}", { x: "<b>" }, ctx()), "&lt;b&gt;");
});
