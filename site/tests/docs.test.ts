// The docs pages (src/docs/), the documentation's one source: nav.yml lists every page once (so
// each is in the sidebar and in `ssqch docs`), each page's `ssqch docs` command prints that page,
// each trailhead is what `ssqch docs --from` prints, and every name `ssqch capabilities` lists is
// on the reference page with the page that explains it. That every link between the pages
// lands, anchors included, is the link checker's job in the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { GRAMMAR } from "../../packages/ssqch/src/cli.ts";
import { answer, names, sections } from "../../packages/ssqch/src/commands/docs.ts";
import { commandOf, DOCS_DIR, pages, REPO } from "../lib/docs.ts";
import nav from "../src/_data/nav.js";
import reference from "../src/_data/reference.js";

const ssqch = (...args: string[]) => spawnSync(process.execPath, [path.join(REPO, "packages/ssqch/bin/ssqch.ts"), ...args], { encoding: "utf8" });

test("nav.yml lists every docs page once", () => {
	const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
	const files = walk(DOCS_DIR).filter((f) => f.endsWith(".md")).map((f) => path.relative(DOCS_DIR, f).split(path.sep).join("/")).sort();
	const listed = pages().map((p) => p.file).filter((f) => f !== "");
	assert.deepEqual([...listed].sort(), files, "nav.yml and the files in src/docs/ differ");
	assert.equal(new Set(listed).size, listed.length, "nav.yml lists a page twice");
	assert.equal(listed[0], "index.md", "the docs' front page comes first: `ssqch docs` reads it as the top section");
});

test("each page's `ssqch docs` command prints that page", () => {
	const all = sections();
	const known = names(GRAMMAR);
	for (const page of pages()) {
		const command = commandOf(page);
		const query = /^ssqch docs "(.+)"$/.exec(command)?.[1];
		if (query === undefined) continue;
		const found = answer(GRAMMAR, all, known, query);
		assert.equal(found?.section === undefined ? undefined : all[found.section].title, page.title, `\`${command}\` answers with another section than ${page.url}`);
		assert.deepEqual(found?.passages, [], `\`${command}\` answers with part of a section, not ${page.url}`);
	}
});

test("each trailhead is what `ssqch docs --from` prints", () => {
	const trailheads = pages().filter((p) => p.file.startsWith("trailheads/"));
	assert.equal(trailheads.length, 7);
	for (const page of trailheads) {
		const generator = /^ssqch docs --from (\S+)$/.exec(commandOf(page))?.[1];
		assert.ok(generator, `${page.file}: ${commandOf(page)}`);
		const run = ssqch("docs", "--from", generator);
		assert.equal(run.status, 0, run.stderr);
		assert.ok(run.stdout.includes(`# ${page.title}\n`), `\`ssqch docs --from ${generator}\` doesn't print ${page.file}`);
		assert.ok(run.stdout.includes(`https://sitesquatch.dev${page.url}`), `\`ssqch docs --from ${generator}\` doesn't link ${page.url}`);
	}
});

test("every name `ssqch capabilities` lists is on the reference page, with the page that explains it", () => {
	const run = ssqch("capabilities", "--format", "json");
	assert.equal(run.status, 0, run.stderr);
	const capabilities = JSON.parse(run.stdout);
	const listed = reference().groups.flatMap((g: { title: string; names: Array<{ name: string; where?: { url: string } }> }) => g.names.map((n) => ({ ...n, group: g.title })));
	const want: Array<[string, string]> = [
		...capabilities.commands.map((name: string) => ["Commands", name]),
		...capabilities.configOptions.map((name: string) => ["Config options", name]),
		...capabilities.modules.flatMap((m: { name: string; exports: string[] }) => m.exports.map((name) => [`From "${m.name}"`, name])),
	];
	for (const [group, name] of want) {
		const entry = listed.find((n: { group: string; name: string }) => n.group === group && n.name === name);
		assert.ok(entry, `${group}: ${name} isn't on the reference page`);
		assert.match(entry.where?.url ?? "", /^\/docs\//, `${group}: ${name} has no docs page`);
	}
});

test("the sidebar is nav.yml's groups and pages, in order", () => {
	const sidebar: Array<{ title: string; pages: Array<{ url: string }> }> = nav();
	assert.deepEqual(sidebar.flatMap((g) => g.pages.map((p) => p.url)), pages().map((p) => p.url));
	assert.deepEqual(sidebar.map((g) => g.title), [...new Set(pages().map((p) => p.group))]);
});

test("the README's and CONTRIBUTING.md's links to the docs go to pages that exist", () => {
	const urls = new Set(pages().map((p) => p.url));
	for (const file of ["README.md", "CONTRIBUTING.md", "packages/ssqch/README.md"]) {
		const text = readFileSync(path.join(REPO, file), "utf8");
		for (const [, url] of text.matchAll(/https:\/\/sitesquatch\.dev(\/docs\/[^)#\s"]*)/g)) assert.ok(urls.has(url), `${file} links ${url}, which isn't a docs page`);
	}
});
