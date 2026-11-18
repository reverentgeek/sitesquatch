// From crates/sitesquatch-js/src/ejs.rs and ejs.js, which 0.7 ran EJS with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ejsEngine } from "./ejs.ts";
import { failure, testSite } from "./fixture.ts";

const filters = {
	shout: (s: unknown) => String(s).toUpperCase(),
	boom: () => { throw new Error("the snack drawer is empty"); },
	later: async (s: unknown) => `later:${s}`,
};

test("an_unknown_function_names_its_line", async () => {
	const site = testSite({}, filters);
	const ejs = ejsEngine(site.env);
	// EJS has functions, not filters: one that isn't there is a ReferenceError, as in EJS.
	const message = await failure(() => ejs.render("line one\n<%= shot(title) %>\n", { title: "x" }, site.ctx("page.ejs")));
	assert.equal(message, "page.ejs:2: shot is not defined");
	assert.equal(ejs.render("<%= typeof shot %> <%= shout(title) %>", { title: "x" }, site.ctx("page.ejs")), "undefined X");
});

test("a_function_that_throws_names_its_line_and_the_function", async () => {
	const site = testSite({ "_includes/nav.ejs": "a\n<%= boom() %>" }, filters);
	const ejs = ejsEngine(site.env);
	let message = await failure(() => ejs.render("line one\n\n<%= boom(title) %>\n", { title: "x" }, site.ctx("page.ejs")));
	assert.ok(message.startsWith("page.ejs:3: boom(): the snack drawer is empty"), message);
	// In an include, the include's file and line.
	message = await failure(() => ejs.render("<%- include('nav') %>", {}, site.ctx("page.ejs")));
	assert.ok(message.startsWith("_includes/nav.ejs:2: boom(): the snack drawer is empty"), message);
});

test("syntax_errors_name_the_tag", async () => {
	const site = testSite({});
	const ejs = ejsEngine(site.env);
	assert.equal(await failure(() => ejs.render("one\n<% if (x) {\n", {}, site.ctx("page.ejs"))), "page.ejs:2: this <% tag is never closed (with %>)");
	assert.equal(await failure(() => ejs.render("one\n<% if (true) { %>open", {}, site.ctx("page.ejs"))), "page.ejs:2: a block opened in a <% %> tag isn't closed (a `}` is missing)");
});

test("includes_come_from_the_includes_folders_or_the_templates_own", async () => {
	const site = testSite({
		"_includes/card.ejs": "[<%= name %><% if (typeof extra !== \"undefined\") { %> <%= extra %><% } %>]",
		"themes/trail/_includes/deep/owl.ejs": "owl <%= title %>",
		"pages/sibling.ejs": "sib",
	}, filters);
	const ejs = ejsEngine(site.env);
	const out = ejs.render("<%- include('card', { name: 'Cedar' }) %><%- include('card', { name: 'Old', extra: 'x' }) %><%- include('deep/owl') %>|<%- include('./sibling') %>", { title: "T" }, site.ctx("pages/page.ejs"));
	assert.equal(out, "[Cedar][Old x]owl T|sib");
	assert.deepEqual(ejs.included!().sort(), ["card.ejs", "deep/owl.ejs", "sibling.ejs"]);
	const message = await failure(() => ejs.render("\n<%- include('crd') %>", {}, site.ctx("page.ejs")));
	assert.equal(message, "page.ejs:2: template not found: can't include `crd`: no sightings in _includes (did you mean `card`?)");
});

test("printed_promises_are_awaited", async () => {
	const site = testSite({}, filters);
	const ejs = ejsEngine(site.env);
	const out = ejs.render("<%= later('<x>') %>|<%- later('<y>') %>", {}, site.ctx("page.ejs"));
	assert.ok(out instanceof Promise);
	assert.equal(await out, "later:&lt;x&gt;|later:<y>");
	// A template that awaits is an async function.
	assert.equal(await ejs.render("<% const v = await later('z') %><%= v %>", {}, site.ctx("await.ejs")), "later:z");
});

test("a_date_prints_as_0_7_printed_it_at_utc", () => {
	const site = testSite({});
	const ejs = ejsEngine(site.env);
	const when = new Date("2026-01-02T10:20:30Z");
	assert.equal(ejs.render("<%= when %>|<%- when %>", { when }, site.ctx("page.ejs")), "Fri Jan 02 2026 10:20:30 GMT+0000|Fri Jan 02 2026 10:20:30 GMT+0000");
});
