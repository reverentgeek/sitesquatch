// The Edge engine on its own: what 0.7's Edge did that edge.js doesn't, and errors that name the
// template's line. (The oracle's edge/edge.test.js checks the rest through whole builds.)
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config, Filter } from "../config.ts";
import { edgeEngine } from "./edge.ts";
import type { RenderContext, TemplateEngine } from "./engine.ts";

const made: string[] = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

/** An engine over a folder of includes (`{ name: text }`), with `upper`, `boom` and `later` as the config's functions. */
function engine(includes: Record<string, string> = {}, { strict = false, theme = {} as Record<string, string> } = {}): TemplateEngine {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-edge-"));
	made.push(root);
	const write = (dir: string, files: Record<string, string>) => {
		for (const [name, text] of Object.entries(files)) {
			const file = path.join(root, dir, name);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
		}
	};
	write("_includes", includes);
	write("theme/_includes", theme);
	const globals = new Map<string, Filter>([
		["upper", (s: unknown) => String(s).toUpperCase()],
		["boom", () => { throw new Error("the snack drawer is empty"); }],
		["later", async (s: unknown) => { await null; return `${s}!`; }],
	]);
	return edgeEngine({
		config: { root } as Config,
		dirs: { includes: path.join(root, "_includes") } as any,
		includeDirs: [path.join(root, "_includes"), path.join(root, "theme/_includes")],
		globals,
		pipeFilters: new Map(),
		strict,
	});
}

const ctx = (name = "page.edge", cacheKey?: string): RenderContext => ({ name, inputPath: name, cacheKey });

function failure(fn: () => unknown): string {
	try {
		fn();
	} catch (e) {
		return (e as Error).message;
	}
	throw new Error("expected an error");
}

async function asyncFailure(fn: () => unknown): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return (e as Error).message;
	}
	throw new Error("expected an error");
}

test("an_unknown_function_names_its_line_and_what_was_meant", () => {
	const edge = engine();
	assert.equal(failure(() => edge.render("one\n{{ uper(title) }}", { title: "x" }, ctx())), "page.edge:2: `uper` is not a function (did you mean `upper`?)");
	// Another generator's filter says ssqch's name for it.
	assert.match(failure(() => edge.render("{{ slug(title) }}", { title: "x" }, ctx())), /^page\.edge:1: `slug` is not a function\. ssqch's is `slugify`/);
});

test("a_function_that_throws_names_its_line", () => {
	const edge = engine();
	assert.match(failure(() => edge.render("one\ntwo\n{{ boom() }}", {}, ctx())), /^page\.edge:3: boom\(\): the snack drawer is empty/);
	// From an include: where it was included from, then the include's own line.
	const nested = engine({ "p.edge": "p\n{{ boom() }}" });
	assert.match(failure(() => nested.render("one\n@include('p')", {}, ctx())), /^included from page\.edge:2: p\.edge:2: boom\(\): the snack drawer is empty/);
});

test("an_include_that_isnt_there_says_what_was_meant", () => {
	const edge = engine({ "partials/nav.edge": "<nav>" });
	const message = failure(() => edge.render("one\n@include('partials/navv')", {}, ctx()));
	assert.match(message, /^page\.edge:2: @include\('partials\/navv'\): template not found: .*partials[\\/]navv\.edge \(did you mean `partials\/nav`\?\)$/);
	assert.match(failure(() => edge.render("@!component('partials/nab')", {}, ctx())), /^page\.edge:1: @component\('partials\/nab'\): template not found: .* \(did you mean `partials\/nav`\?\)$/);
});

test("includes_come_from_the_site_then_the_theme", () => {
	const edge = engine({ "footer.edge": "my footer" }, { theme: { "footer.edge": "theme footer", "header.edge": "---\ntitle: x\n---\ntheme header" } });
	assert.equal(edge.render("@include('header')\n@include('footer')", {}, ctx()), "theme header\nmy footer");
	assert.deepEqual(edge.included?.().sort(), ["footer", "header"]);
});

test("a_loop_is_named_once", () => {
	const edge = engine({ "a.edge": "A\n@include('b')\n", "b.edge": "B\n@include('a')\n" });
	assert.equal(failure(() => edge.render("@include('a')", {}, ctx())), "b.edge:2: we've passed this tree before. Include loop: a -> b -> a");
});

test("values_print_as_0_7_printed_them", () => {
	const edge = engine();
	assert.equal(edge.render("[{{ nope }}|{{{ nope }}}|{{ gone }}|{{ when }}]", { gone: null, when: new Date(Date.UTC(2024, 5, 1)) }, ctx()), "[|||2024-06-01T00:00:00.000Z]");
	assert.equal(edge.render("{{ { tip: 'T', note: 'N' }[kind] }}", { kind: "tip" }, ctx()), "T");
	assert.equal(edge.render("{{ upper }}|{{ upper('x') }}", { upper: "a field" }, ctx()), "a field|X");
	// `reverse()` gives a copy: the page's list stays as it was.
	const tags = ["a", "b"];
	assert.equal(edge.render("{{ tags.reverse() }}|{{ tags }}", { tags }, ctx()), "b,a|a,b");
	assert.deepEqual(tags, ["a", "b"]);
	assert.equal(edge.render("@let(n = n - 1)\n@let(n = n - 1)\n{{ n }}", { n: 3 }, ctx()), "1");
	assert.equal(edge.render("@each(x in xs)\n{{ $loop.index }}{{ x }}{{ $loop.last ? '.' : ',' }}\n@end", { xs: ["a", "b"] }, ctx()), "0a,\n1b.");
	// A JavaScript global's name is the page's when the page has it.
	assert.equal(edge.render("{{ crypto }}", { crypto: "secret" }, ctx()), "secret");
});

test("strict_names_what_was_undefined", () => {
	const edge = engine({}, { strict: true });
	assert.equal(failure(() => edge.render("one\n{{ titel }}", {}, ctx())), "page.edge:2: `titel` is undefined (strict is on)");
	assert.equal(edge.render("[{{ gone }}]", { gone: null }, ctx()), "[]");
});

test("a_template_is_synchronous_until_something_gives_a_promise", async () => {
	const edge = engine({ "c.edge": "<{{{ await $slots.main() }}}>" });
	// `await` on what isn't a promise is nothing to wait for: the answer comes at once.
	assert.equal(edge.render("@component('c')\n{{ await upper('x') }}\n@end", {}, ctx()), "<X>");
	const out = edge.render("{{ later('a') }}|{{ ['b'].map(x => later(x)) }}", {}, ctx("async.edge", "async.edge"));
	assert.ok(out instanceof Promise);
	assert.equal(await out, "a!|b!");
	// Rendered again, it goes to async mode straight away.
	assert.equal(await edge.render("{{ later('a') }}|{{ ['b'].map(x => later(x)) }}", {}, ctx("async.edge", "async.edge")), "a!|b!");
	assert.match(await asyncFailure(() => edge.render("{{ ['b'].filter(x => later(x)) }}", {}, ctx())), /^page\.edge:1: `later\(\)` gave a promise inside a function/);
});

test("dates_are_utc_whatever_the_time_zone", () => {
	const edge = engine();
	const data = { page: { date: new Date("2024-03-04T23:30:00Z") } };
	const src = [
		"{{ page.date.getFullYear() }}-{{ page.date.getMonth() }}-{{ page.date.getDate() }} {{ page.date.getDay() }} {{ page.date.getHours() }}",
		"{{ page.date.toString() }}|{{ [page.date] }}|{{ String(page.date) }}|{{ `${page.date}` }}|{{ 'on ' + page.date }}",
		"{{ page.date.toDateString() }}|{{ page.date.toLocaleDateString('en-US', { month: 'long' }) }}|{{ page.date.toLocaleDateString() }}",
		"{{ new Date(2024, 0, 5).toISOString() }}|{{ new Date('2024-01-05 10:00').toISOString() }}|[{{ new Date('nope') }}]|{{ Date.parse('2024-01-05T10:00:00') }}",
	].join("\n");
	const want = [
		"2024-2-4 1 23",
		"2024-03-04T23:30:00.000Z|2024-03-04T23:30:00.000Z|2024-03-04T23:30:00.000Z|2024-03-04T23:30:00.000Z|on 2024-03-04T23:30:00.000Z",
		"Mon Mar 04 2024|March 4, 2024|3/4/2024",
		"2024-01-05T00:00:00.000Z|2024-01-05T10:00:00.000Z|[]|1704448800000",
	].join("\n");
	const zone = process.env.TZ;
	try {
		for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
			process.env.TZ = tz;
			assert.equal(edge.render(src, data, ctx()), want, tz);
		}
	} finally {
		if (zone === undefined) delete process.env.TZ;
		else process.env.TZ = zone;
	}
});

test("an_include_gives_back_what_it_changed", () => {
	const edge = engine({ "inc.edge": "@assign(counter = counter + 1)", "set.edge": "@let(label = 'from include')" });
	const words = (out: unknown) => String(out).split(/\s+/).filter(Boolean).join(" ");
	assert.equal(words(edge.render("@let(counter = 0)\n@include('inc')\n@include('inc')\n@includeIf(true, 'inc')\n[{{ counter }}]", {}, ctx())), "[3]");
	assert.equal(words(edge.render("@let(label = 'mine')\n@include('set')\n[{{ label }}]", {}, ctx())), "[from include]");
	assert.equal(words(edge.render("@each(n in [1, 2])\n@let(counter = n * 10)\n@include('inc')\n{{ counter }}\n@end", {}, ctx())), "11 21");
});

test("a_tag_where_it_cant_be_names_its_line", () => {
	const edge = engine();
	assert.equal(failure(() => edge.render("before\n@end\nafter", {}, ctx())), "parse error in page.edge: line 2: unexpected @end");
	assert.equal(failure(() => edge.render("x\n@else\ny", {}, ctx())), "parse error in page.edge: line 2: unexpected @else");
	assert.equal(failure(() => edge.render("@if(a)\n@else\n@elseif(b)\n@end", {}, ctx())), "parse error in page.edge: line 3: unexpected @elseif");
	assert.equal(failure(() => edge.render("x\n@let(= 1)", {}, ctx())), "parse error in page.edge: line 2: invalid @let arguments: expected an identifier but found `=`");
	// `@else` where it belongs is fine.
	assert.equal(edge.render("@each(x in [])\n{{ x }}\n@else\nnone\n@end", {}, ctx()), "none");
});

test("functions_run_once_when_a_template_turns_async", async () => {
	const calls: string[] = [];
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-edge-"));
	made.push(root);
	const edge = edgeEngine({
		config: { root } as Config,
		dirs: { includes: path.join(root, "_includes") } as any,
		includeDirs: [path.join(root, "_includes")],
		globals: new Map<string, Filter>([
			["note", (s: unknown) => { calls.push(String(s)); return s; }],
			["later", async (s: unknown) => `L:${s}`],
		]),
		pipeFilters: new Map(),
		strict: false,
	});
	assert.equal(await edge.render("{{ note('a') }} {{ note({ n: [1] }.n.length) }} {{ later('b') }} {{ note('c') }}", {}, ctx()), "a 1 L:b c");
	assert.deepEqual(calls, ["a", "1", "c"]);
});

test("strings_and_numbers_print_as_0_7_printed_them", () => {
	const edge = engine();
	assert.equal(edge.render("{{ t[0] }}|{{ t.slice(0, 1) }}|{{ t.charAt(1) }}|{{ t.indexOf('a') }}|{{ t.length }}|{{ 'abc'[1] }}", { t: "🌲🌲a" }, ctx()), "🌲|🌲|🌲|2|5|b");
	assert.equal(edge.render("{{ upper }}|{{ 1e21 }}|{{ -0 }}|{{ 1.5e-7 }}|{{ 'n' + 1e21 }}|{{{ stringify(nope) }}}|{{{ JSON.stringify(nope) }}}", {}, ctx()), "function () { [native code] }|1000000000000000000000|-0|0.00000015|n1000000000000000000000|null|null");
	// What was undefined, as 0.7 named it.
	assert.equal(failure(() => edge.render("x\n{{ a.b.c }}", {}, ctx())), "page.edge:2: Cannot read properties of undefined (reading 'b') in `a`");
});

test("lines_end_with_a_newline_on_every_system", () => {
	const edge = engine();
	assert.equal(edge.render("a\r\n@if(true)\r\nyes {{ 1 }}\r\n@end\r\nb\r\n", {}, ctx()), "a\nyes 1\nb");
	assert.equal(edge.render("plain\r\ntext\r\n", {}, ctx()), "plain\ntext");
});
