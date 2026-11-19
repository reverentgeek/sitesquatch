// The docs pages: every section of the README is on one page (or left on GitHub on purpose), each
// page's `ssqch docs` command prints that page, every name `ssqch capabilities` lists is on the
// reference page with the page that explains it, and splitting again writes nothing (so the dev
// server's watcher doesn't rebuild in a loop). That every link between the pages lands, anchors
// included, is the link checker's job in the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GRAMMAR } from "../../packages/ssqch/src/cli.ts";
import { answer, names, sections as docsSections } from "../../packages/ssqch/src/commands/docs.ts";
import { DOCS, NOT_ON_THE_SITE } from "../lib/docs-map.ts";
import { pages, REPO, sections, splitDocs } from "../lib/split.ts";
import reference from "../src/_data/reference.js";

const readme = readFileSync(path.join(REPO, "README.md"), "utf8");

test("every README section is on exactly one docs page, or left on GitHub on purpose", () => {
	const written = pages();
	const headings = sections(readme).filter((s) => s.level >= 2);
	const skipped = new Set<string>();
	for (const title of NOT_ON_THE_SITE) {
		const at = headings.findIndex((s) => s.title === title);
		assert.notEqual(at, -1, `NOT_ON_THE_SITE names "${title}", which the README doesn't have`);
		for (let i = at; i < headings.length && (i === at || headings[i].level > headings[at].level); i++) skipped.add(headings[i].title);
	}
	for (const s of headings) {
		if (skipped.has(s.title)) continue;
		const on = written.filter((p) => p.source === "README.md" && (p.title === s.title || new RegExp(`^#{1,6} ${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(p.markdown)));
		assert.equal(on.length, 1, `"${s.title}" is on ${on.length === 0 ? "no page" : on.map((p) => p.url).join(", ")}`);
	}
});

test("every ## section of the README is in the map, so a new one gets a page of its own", () => {
	const mapped = new Set([...DOCS.flatMap((g) => g.pages.flatMap((p) => p.from ?? [])), ...NOT_ON_THE_SITE]);
	for (const s of sections(readme).filter((s) => s.level === 2)) {
		assert.ok(mapped.has(s.title), `README's "## ${s.title}" isn't in site/lib/docs-map.ts: give it a page (or a place on one), or list it in NOT_ON_THE_SITE`);
	}
});

test("each page's `ssqch docs` command prints that page", () => {
	const all = docsSections(readme);
	const known = names(GRAMMAR);
	for (const p of pages()) {
		// The map sets a command for the intro: `ssqch docs` alone, which prints the card.
		if (p.source !== "README.md" || p.page.command) continue;
		const query = /^ssqch docs "(.+)"$/.exec(p.command)?.[1];
		assert.ok(query, `${p.url}: "${p.command}" isn't \`ssqch docs "<heading>"\``);
		const found = answer(GRAMMAR, all, known, query);
		assert.equal(found?.section === undefined ? undefined : all[found.section].title, p.page.from![0], `\`${p.command}\` answers with another section than ${p.url}`);
		assert.deepEqual(found?.passages, [], `\`${p.command}\` answers with part of a section, not ${p.url}`);
	}
});

test("each trailhead's `ssqch docs --from` prints it", () => {
	for (const p of pages().filter((p) => p.page.file)) {
		const generator = /^ssqch docs --from (\S+)$/.exec(p.command)?.[1];
		assert.ok(generator, p.command);
		const run = spawnSync(process.execPath, [path.join(REPO, "packages/ssqch/bin/ssqch.ts"), "docs", "--from", generator], { encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		const first = readFileSync(path.join(REPO, p.page.file!), "utf8").split("\n")[0];
		assert.ok(run.stdout.includes(first), `\`${p.command}\` doesn't print ${p.page.file}`);
	}
});

test("every name `ssqch capabilities` lists is on the reference page, with the page that explains it", () => {
	const run = spawnSync(process.execPath, [path.join(REPO, "packages/ssqch/bin/ssqch.ts"), "capabilities", "--format", "json"], { encoding: "utf8" });
	assert.equal(run.status, 0, run.stderr);
	const capabilities = JSON.parse(run.stdout);
	const listed = reference().groups.flatMap((g: { title: string; names: Array<{ name: string; where?: { url: string } }> }) => g.names.map((n) => ({ ...n, group: g.title })));
	const want: Array<[string, string]> = [
		...capabilities.commands.map((name: string) => ["Commands", name]),
		...capabilities.configOptions.map((name: string) => ["Config options", name]),
		...capabilities.modules.flatMap((m: { name: string; exports: string[] }) => m.exports.map((name) => [`From "${m.name}"`, name])),
	];
	for (const [group, name] of want) {
		const entry = listed.find((n) => n.group === group && n.name === name);
		assert.ok(entry, `${group}: ${name} isn't on the reference page`);
		assert.match(entry.where?.url ?? "", /^\/docs\//, `${group}: ${name} has no docs page`);
	}
});

test("the sidebar has every page of the map, in its order", () => {
	const nav = JSON.parse(readFileSync(path.join(REPO, "site/src/_data/nav.json"), "utf8"));
	assert.deepEqual(nav.map((g: { title: string }) => g.title), DOCS.map((g) => g.title));
	assert.deepEqual(nav.flatMap((g: { pages: Array<{ url: string }> }) => g.pages.map((p) => p.url)), DOCS.flatMap((g) => g.pages.map((p) => (p.slug === "" ? "/docs/" : `/docs/${p.slug}/`))));
});

test("splitting again writes nothing", () => {
	splitDocs();
	assert.deepEqual(splitDocs(), []);
});
