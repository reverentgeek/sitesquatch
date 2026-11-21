import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildNav, loadMkdocs, normalizeUrl, relativeUrl, tocOf } from "./mkdocs.ts";
import type { NavPage } from "./mkdocs.ts";

const site = (files: Record<string, string>) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-mkdocs-"));
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	}
	return dir;
};
const page = (src: string, url: string, title: string | null = null, heading: string | null = null): NavPage => ({ src, url, title, meta: {}, firstHeading: () => heading });

test("urls_as_mkdocs_makes_them", () => {
	assert.equal(relativeUrl(".", "advanced/clients/"), "../..");
	assert.equal(relativeUrl(".", ""), ".");
	assert.equal(relativeUrl("assets/app.css", "advanced/clients/"), "../../assets/app.css");
	assert.equal(relativeUrl("advanced/", "async/"), "../advanced/");
	assert.equal(normalizeUrl("assets/app.css", "advanced/clients/"), "../../assets/app.css");
	assert.equal(normalizeUrl("https://x.org/a.js", "a/"), "https://x.org/a.js");
	assert.equal(normalizeUrl("#top", "a/"), "#top");
	// The 404 page has no page: under the site's path.
	assert.equal(normalizeUrl("assets/app.css", null, "/docs/"), "/docs/assets/app.css");
});

test("mkdocs_yml_with_the_themes_defaults_under_it", () => {
	const dir = site({
		"mkdocs.yml": "site_name: Trail\nsite_url: https://example.com/docs/\nrepo_url: https://github.com/you/trail\ntheme:\n  name: material\n  features: [navigation.tabs]\nmarkdown_extensions:\n  - toc:\n      slugify: !!python/name:pymdownx.slugs.uslugify\n",
		"theme/mkdocs_theme.yml": "language: en\nfont:\n  text: Roboto\nfeatures: []\nstatic_templates: [404.html]\n",
	});
	const mk = loadMkdocs(dir, "mkdocs.yml", [path.join(dir, "theme")]);
	const theme = mk.config.theme as Record<string, unknown>;
	assert.deepEqual(theme.features, ["navigation.tabs"]);
	assert.deepEqual(theme.font, { text: "Roboto" });
	assert.equal(theme.static_templates, undefined);
	// No `plugins`: MkDocs' search, which is Material's own with its theme.
	assert.deepEqual(Object.keys(mk.config.plugins as object), ["material/search"]);
	assert.equal(mk.config.repo_name, "GitHub");
	assert.equal(mk.config.edit_uri, "edit/master/docs/");
	assert.throws(() => loadMkdocs(dir, "nope.yml", []), /mkdocsTemplates: there's no nope\.yml/);
});

test("the_nav_is_mkdocs_with_the_page_active", () => {
	const dir = site({ "mkdocs.yml": "site_name: Trail\nsite_url: https://example.com/\nnav:\n  - Home: index.md\n  - Trails:\n    - trails/cedar.md\n    - Old Growth: trails/old.md\n  - Map: https://example.com/map\n" });
	const mk = loadMkdocs(dir, "mkdocs.yml", []);
	const pages = [page("index.md", "/"), page("trails/cedar.md", "/trails/cedar/", null, "Cedar Trail"), page("trails/old.md", "/trails/old/"), page("extra.md", "/extra/", "Extra")];
	const { nav, page: cedar } = buildNav(mk, pages, "trails/cedar.md");
	assert.equal(nav.length, 3);
	const trails = nav[1];
	assert.equal(trails.is_section, true);
	assert.equal(trails.active, true);
	assert.equal((trails.children as unknown[])[0], cedar);
	assert.equal(cedar!.title, "Cedar Trail");
	assert.equal(cedar!.url, "trails/cedar/");
	assert.equal(cedar!.canonical_url, "https://example.com/trails/cedar/");
	assert.equal((cedar!.previous_page as Record<string, unknown>).title, "Home");
	assert.equal((cedar!.next_page as Record<string, unknown>).title, "Old Growth");
	assert.deepEqual((cedar!.ancestors as unknown[]).length, 1);
	assert.equal(nav[2].is_link, true);
	assert.equal((nav.homepage as Record<string, unknown>).url, "");
	// A page the nav doesn't list is a page all the same.
	assert.equal(buildNav(mk, pages, "extra.md").page!.title, "Extra");
	assert.equal(buildNav(mk, pages, null).page, null);
});

test("no_nav_is_the_files_by_folder", () => {
	const dir = site({ "mkdocs.yml": "site_name: Trail\n" });
	const mk = loadMkdocs(dir, "mkdocs.yml", []);
	const { nav } = buildNav(mk, [page("getting-started.md", "/getting-started/"), page("index.md", "/"), page("trail_guides/cedar.md", "/trail_guides/cedar/")], null);
	assert.deepEqual(nav.map((n) => n.title), ["Home", "Getting started", "Trail guides"]);
});

test("the_toc_is_python_markdowns_tokens", () => {
	const toc = tocOf([{ level: 1, id: "camp", text: "Camp" }, { level: 2, id: "water", text: "Water" }, { level: 3, id: "filter", text: "Filter" }, { level: 2, id: "fire", text: "Fire" }, { level: 2, text: "No id" }]);
	assert.equal(toc.length, 1);
	assert.deepEqual((toc[0].children as Array<Record<string, unknown>>).map((t) => [t.title, t.url, (t.children as unknown[]).length]), [["Water", "#water", 1], ["Fire", "#fire", 0]]);
});
