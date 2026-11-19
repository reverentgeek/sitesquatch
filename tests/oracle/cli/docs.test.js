// From crates/ssqch/tests/cli.rs.
//
// `ssqch docs` keeps up with `ssqch capabilities`: every command, config option and module export
// it lists has a line on the card and an answer by name, and so does every word in the table of
// other generators' words, with its hint's `More: ssqch docs ...` answered too.
//
// The Rust test walks `sitesquatch::equivalents::TABLE` and `OTHER_CONFIGS` directly. Here the
// generators come from `ssqch docs --from nope`'s list, and each generator's words from
// `ssqch docs --from <generator>`, the same table as ssqch prints it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ssqch, expectedVersion } from "../lib/ssqch.js";

test("docs_answer_for_every_name", () => {
	const json = (args) => {
		const r = ssqch(["docs", "--format", "json", ...args]);
		try { return JSON.parse(r.stdout); } catch (e) { throw new Error(`${JSON.stringify(args)}: ${e.message}: ${r.stdout}${r.stderr}`); }
	};
	const caps = JSON.parse(ssqch(["capabilities", "--format", "json"]).stdout);
	const names = (value, key) => value.map((v) => (v !== null && typeof v === "object" ? v[key] : undefined) ?? v);

	// The card has everything capabilities lists, each with a line.
	const card = json([]);
	assert.equal(card.version, expectedVersion());
	assert.deepEqual(names(card.commands, "name").sort(), names(caps.commands, "name").sort());
	assert.deepEqual(names(card.configOptions, "name"), names(caps.configOptions, "name"));
	for (const module of caps.modules) {
		const onCard = card.modules.find((m) => m.name === module.name);
		assert.ok(onCard, `the card lacks ${module.name}`);
		assert.deepEqual(names(onCard.exports, "name").sort(), names(module.exports, "name").sort(), module.name);
	}
	for (const key of ["commands", "configOptions", "templateFunctions"]) {
		for (const row of card[key]) {
			assert.ok(row.summary.length > 0, `${key} ${row.name} has no description`);
		}
	}
	for (const module of card.modules) {
		for (const row of module.exports) {
			assert.ok(row.summary.length > 0, `${module.name} ${row.name} has no description in ssqch.d.ts`);
		}
	}

	// Each name has an answer: a command its --help, the rest a part of the docs that writes it as code.
	for (const command of names(card.commands, "name")) {
		const a = json([command]);
		assert.ok(typeof a.help === "string" && a.help.includes(`Usage: ssqch ${command}`), `${command}: ${JSON.stringify(a)}`);
	}
	const documented = [...names(card.configOptions, "name"), ...names(card.templateFunctions, "name")];
	for (const module of card.modules) documented.push(...names(module.exports, "name"));
	for (const name of documented) {
		const a = json([name]);
		assert.ok(a.found === true && Array.isArray(a.names) && a.names.length > 0, `${name}: ${JSON.stringify(a)}`);
		assert.ok(typeof a.section?.text === "string" && a.section.text.includes(`\`${name}`), `the docs don't document \`${name}\`: ${JSON.stringify(a)}`);
	}

	// Another generator's word says ssqch's, and its hint's `More:` answers.
	const generators = /There are: (.*)$/m.exec(ssqch(["docs", "--from", "nope"]).log)?.[1].split(", ");
	assert.ok(generators && generators.length >= 5, "no list of generators");
	let words = 0;
	for (const generator of generators) {
		const { ok, stdout } = ssqch(["docs", "--from", generator]);
		assert.ok(ok, `${generator}: ${stdout}`);
		assert.ok(stdout.toLowerCase().startsWith(`${generator}'s words`), `${generator}: ${stdout}`);
		for (const line of stdout.split("\n")) {
			if (line.startsWith("The trailhead (")) break;
			if (!/^  \S/.test(line)) continue;
			const word = line.trim().split(/\s{2,}/)[0].replace(/ \(works\)$/, "");
			// The table prints a word that ends a family (`eleventy.*`) with its star; the row itself is `eleventy.`.
			const row = word.replace(/\*$/, "");
			words++;
			const a = json(["--", row]);
			// A word that's ssqch's too, as something else (`watch`, a command elsewhere, is a config option), answers as ssqch's.
			assert.ok(a.equivalent?.word === row || (Array.isArray(a.names) && a.names.length > 0), `${word}: ${JSON.stringify(a)}`);
			const more = a.equivalent?.more;
			if (typeof more !== "string") continue;
			if (more.startsWith("ssqch docs ")) {
				const query = more.slice("ssqch docs ".length).replace(/^"+|"+$/g, "");
				const answer = json(["--", query]);
				assert.ok(typeof answer.help === "string" || typeof answer.section?.text === "string", `${word}: More: ${more} has no answer: ${JSON.stringify(answer)}`);
			} else {
				assert.ok(more.endsWith("--help"), `${word}: More: ${more} is neither \`ssqch docs\` nor --help`);
			}
		}
	}
	assert.ok(words > 20, `only ${words} words`);

	// As text.
	let r = ssqch(["docs", "pathPrefix"]);
	assert.ok(r.ok && r.log.startsWith("`pathPrefix` (Eleventy) works in ssqch too. In ssqch it's `base`") && r.log.includes("| `base` |"), r.log);
	r = ssqch(["docs", "baseURL"]);
	assert.ok(r.ok && r.log.startsWith("`baseURL` (Hugo) isn't ssqch's word."), r.log);
	r = ssqch(["docs", "content", "schemas"]);
	assert.ok(r.ok && r.log.startsWith("## Content schemas\n"), r.log);
	// A paragraph's bold label answers its words; a sub-option it defines, its name.
	for (const query of [["your", "own", "languages"], ["languages"], ["custom", "syntax", "highlighter"]]) {
		r = ssqch(["docs", ...query]);
		assert.ok(r.ok && r.log.includes("**Your own languages:**"), `${JSON.stringify(query)}: ${r.log}`);
	}
	// New features answer with their whole explanation, not only a line.
	for (const [query, want] of [[["files"], "**Files as data:**"], [["files"], "{ dimensions: true }` adds `width`"], [["dates", "that", "changed"], "**Dates that changed:**"], [["release", "age"], "under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`"], [["javascript", "properties", "and", "methods"], "`.length` counts a list's items"]]) {
		r = ssqch(["docs", ...query]);
		assert.ok(r.ok && r.log.includes(want), `${JSON.stringify(query)}: ${r.log}`);
	}
	// The image quality options, on sharp's scale, with their defaults.
	r = ssqch(["docs", "avifEffort"]);
	assert.ok(r.ok && r.log.includes("`avifQuality` 41") && r.log.includes("`avifEffort` 2"), r.log);
	r = ssqch(["docs"]);
	assert.ok(r.ok && r.log.includes("\n  leaveNoTrace ") && r.log.includes("\n    imagePlugin ") && r.log.includes("\nTopics\n  Install, "), r.log);
	r = ssqch(["docs", "pinecone", "crunch", "sightings"]);
	assert.ok(!r.ok && r.log.includes("no tracks of \"pinecone crunch sightings\" in the docs"), r.log);
	r = ssqch(["docs", "leaveNoTrance"]);
	assert.ok(!r.ok && r.log.includes("(did you mean `leaveNoTrace`?)"), r.log);
	// Words that miss can still point somewhere: a generator's card, or one word that has an answer.
	r = ssqch(["docs", "eleventy", "shortcode", "sightings"]);
	assert.ok(!r.ok && r.log.includes("in the docs. Try `ssqch docs --from eleventy`, or `ssqch docs` for everything."), r.log);
	r = ssqch(["docs", "pinecone", "base", "sightings"]);
	assert.ok(!r.ok && r.log.includes("in the docs. Try `ssqch docs base`, or `ssqch docs` for everything."), r.log);

	// Every generator that has a row or a config ssqch recognizes has field notes (see the top of this file).
	// DELIBERATE (0.10): the docs are sitesquatch.dev's pages (site/src/docs/), so a trailhead is
	// named by its page there, not a path in the repository.
	r = ssqch(["docs", "--from", "eleventy"]);
	assert.ok(r.ok && r.log.includes("\n  pathPrefix ") && r.log.includes("The trailhead (https://sitesquatch.dev/docs/trailheads/from-eleventy/):\n\n# Trailhead: moving from Eleventy"), r.log);
	r = ssqch(["docs", "--from", "hugoo"]);
	// Jekyll's trailhead (2026-11-18, from the opensource.guide study).
	const jekyll = ssqch(["docs", "--from", "jekyll"]);
	assert.ok(jekyll.ok && jekyll.log.includes("The trailhead (https://sitesquatch.dev/docs/trailheads/from-jekyll/):\n\n# Trailhead: moving from Jekyll"), jekyll.log);
	assert.ok(!r.ok && r.log.includes("--from hugoo: no trailhead for that generator (did you mean `hugo`?)"), r.log);
});

// The two migrations of 2026-11-18 asked `ssqch docs` for these and got a table row, a list of
// option names, or nothing (opensource.guide's and expressjs.com's issues.md): each answers with
// its explanation now.
test("docs_explain_what_migrations_asked_about", () => {
	const answer = (query) => JSON.parse(ssqch(["docs", "--format", "json", query]).stdout);
	for (const [query, says] of [
		["containers", "a block between `::: name` and `:::`"],
		["pagination", "one template makes a page for each item"],
		["data", "is called on each build, and what it answers is that name's value"],
		["i18n", "ssqch has no built-in i18n yet"],
		["translations", "A page's translations"],
		["hreflang", "x-default"],
		["seo", "a partial in its layout"],
	]) {
		const a = answer(query);
		assert.ok(a.found && a.section.text.includes(says), `${query}: ${JSON.stringify(a).slice(0, 400)}`);
	}
});
