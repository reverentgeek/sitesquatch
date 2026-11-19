// The live examples: site/src/_data/examples.yml (the gallery, the landing page's campsites, the
// "See it working" boxes) lists exactly the example sites in examples/sites/, in the order
// examples/sites/README.md lists them, with the same engine, and each one's README row links to
// it live. That each example builds under its path with no warnings, and every link to it from
// the site lands, is site/build.ts's job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { REPO, SITE } from "../lib/split.ts";

// ssqch's own YAML library, from its package.
const yaml = createRequire(path.join(REPO, "packages", "ssqch", "package.json"))("js-yaml");
const listed: Array<{ name: string; engine: string; features: Array<{ label: string; docs: string }> }> = yaml.load(readFileSync(path.join(SITE, "src", "_data", "examples.yml"), "utf8"));
const dir = path.join(REPO, "examples", "sites");
const readme = readFileSync(path.join(dir, "README.md"), "utf8");
const rows = [...readme.matchAll(/^\| \[`([\w-]+)`\]\([\w-]+\/\) \| (\w+) \| [^|]+ \| (.+) \|$/gm)].map(([, name, engine, live]) => ({ name, engine, live }));

test("examples.yml lists every example site, in the README's order, with its engine", () => {
	const sites = readdirSync(dir).filter((name) => existsSync(path.join(dir, name, "ssqch.config.js")));
	assert.deepEqual([...listed.map((e) => e.name)].sort(), sites.sort(), "examples.yml and examples/sites/ have different examples");
	assert.deepEqual(listed.map((e) => e.name), rows.map((r) => r.name), "examples.yml isn't in the order of examples/sites/README.md");
	for (const e of listed) assert.equal(e.engine, rows.find((r) => r.name === e.name)?.engine, `${e.name}'s engine`);
});

test("each example's README row links to it live", () => {
	for (const r of rows) assert.equal(r.live, `[sitesquatch.dev/examples/${r.name}/](https://sitesquatch.dev/examples/${r.name}/)`, `${r.name}'s Live column`);
});

test("each example has features, each with a docs page", () => {
	for (const e of listed) {
		assert.ok(e.features.length > 0, `${e.name} has no features`);
		for (const f of e.features) assert.match(f.docs, /^\/docs\//, `${e.name}: "${f.label}" goes to ${f.docs}`);
	}
});
