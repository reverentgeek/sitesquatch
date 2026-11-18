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
	assert.equal(await error(() => e.render("ok\n{% if %}", {}, ctx("p.jinja"))), "p.jinja:2: syntax error: unexpected token: %}");
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
