// From crates/sitesquatch/src/nav.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breadcrumbs, breadcrumbsOf, fromPages, pager, pagerOf, tree, treeOf } from "./nav.ts";
import { getPath } from "./data.ts";

const nav = (): any[] => [
	{ title: "Start", pages: [{ title: "Intro", url: "/docs/" }, { title: "Install", url: "/docs/install/" }] },
	{ title: "Guides", url: "/docs/guides/", children: [{ title: "Config", url: "/docs/guides/config/" }] },
];

const truthy = (v: unknown, dotted: string) => Boolean(getPath(v, dotted));

test("tree_marks_current_and_ancestors", () => {
	const t = tree(nav(), "/docs/guides/config/index.html");
	assert.ok(!truthy(t, "0.open"));
	assert.ok(truthy(t, "1.ancestor") && truthy(t, "1.open") && !truthy(t, "1.current"));
	assert.ok(truthy(t, "1.children.0.current"));
	assert.ok(truthy(tree(nav(), "/docs/install"), "0.pages.1.current"));
});

test("pager_and_breadcrumbs", () => {
	const p = pager(nav(), "/docs/install/");
	assert.equal((p.previous as any).title, "Intro");
	assert.equal((p.next as any).title, "Guides");
	assert.equal((p.next as any).children, undefined);
	assert.equal(pager(nav(), "/docs/").previous, null);
	assert.equal(pager(nav(), "/nowhere/").next, null);
	const crumbs = breadcrumbs(nav(), "/docs/guides/config/");
	assert.deepEqual(crumbs.map((c: any) => c.title), ["Guides", "Config"]);
});

// The remembered versions give what the plain ones do, for every page and for none.
test("remembered_trees_match", () => {
	const given: any[] = [
		{ title: "Start", pages: [{ title: "Intro", url: "/docs/" }, { title: "Install", url: "/docs/install/" }] },
		{ title: "Guides", url: "/docs/guides/", children: [{ title: "Overview", url: "/docs/guides/" }, { title: "Config", url: "/docs/guides/config/", items: [{ title: "Deep", url: "/docs/guides/config/deep/" }] }] },
		{ title: "Home", url: "/" },
		"not an entry",
	];
	// The first question about a tree is answered the plain way, the rest from its index.
	for (const url of ["/docs/", "/docs/", "/docs/install", "/docs/guides/", "/docs/guides/config/index.html", "/docs/guides/config/deep/#x", "/", "/nowhere/", ""]) {
		assert.deepEqual(treeOf(given, url), tree(given, url), `tree ${JSON.stringify(url)}`);
		assert.deepEqual(pagerOf(given, url), pager(given, url), `pager ${JSON.stringify(url)}`);
		assert.deepEqual(breadcrumbsOf(given, url), breadcrumbs(given, url), `breadcrumbs ${JSON.stringify(url)}`);
	}
	assert.deepEqual(treeOf(undefined, "/"), []);
});

test("tree_from_front_matter", () => {
	const item = (title: string, url: string, navValue: unknown) => ({ url, data: { title, nav: navValue } });
	const items = [
		item("Config", "/guides/config/", { parent: "Guides", order: 2 }),
		item("Guides", "/guides/", true),
		item("Deploy", "/guides/deploy/", { parent: "Guides", order: 1 }),
		item("Hidden", "/hidden/", false),
		item("Orphan", "/orphan/", { parent: "Nope", title: "Lost" }),
	];
	const t = fromPages(items);
	const titles = (v: any[]) => v.map((e) => e.title);
	assert.deepEqual(titles(t), ["Guides", "Lost"]);
	assert.deepEqual(titles(getPath(t, "0.children") as any[]), ["Deploy", "Config"]);
});

// Not in the Rust: the trees a template passes in belong to the site, so no call may change them.
test("trees_are_never_changed", () => {
	const given = nav();
	const before = structuredClone(given);
	for (const url of ["/docs/guides/config/", "/docs/install/", "/docs/guides/config/", "/docs/", "/nowhere/", ""]) {
		treeOf(given, url);
		pagerOf(given, url);
		breadcrumbsOf(given, url);
		assert.deepEqual(given, before, url);
	}
	const items = [{ url: "/a/", data: { title: "A", nav: { order: 1 } } }];
	const itemsBefore = structuredClone(items);
	fromPages(items);
	assert.deepEqual(items, itemsBefore);
});
