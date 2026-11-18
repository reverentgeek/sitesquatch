// Every example, starter and (where they're present) the blog and the trial ports build to their
// frozen output: what ssqch 0.7.0 built (`node freeze.js` made the snapshots), or for a site whose
// output 0.8 changed on purpose, what the Node build built when it was frozen again. A deliberate
// difference that a snapshot keeps goes in DELIBERATE with its reason, and in the changelog; one
// that replaces the snapshot is frozen again (`node freeze.js <site>`), and the commit says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sites, buildSite, snapshotOf, loadSnapshot, differences, SNAPSHOTS, LOCAL_SNAPSHOTS } from "./lib/sites.js";

/** `{ "<site>": { "<path or 'report' or 'log'>": "why it differs on purpose" } }`. */
const STARTER_TYPES = "0.8's editor types describe 0.8 (its Rust plugins, fetch, serve, images), so the ssqch.d.ts that init writes isn't 0.7's";
const DELIBERATE = {
	"starter-site-jinja": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-site-njk": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-site-edge": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-site-liquid": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-site-hbs": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-site-ejs": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-docs-jinja": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-docs-njk": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-docs-edge": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-docs-liquid": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-docs-hbs": { "init wrote ssqch.d.ts": STARTER_TYPES },
	"starter-docs-ejs": { "init wrote ssqch.d.ts": STARTER_TYPES },
};

for (const site of sites()) {
	const dir = path.join(site.local ? LOCAL_SNAPSHOTS : SNAPSHOTS, site.name);
	const skip = site.local && (!site.available || !fs.existsSync(dir)) ? "not on this machine (run node freeze.js where it is)" : !fs.existsSync(dir) ? false : false;
	test(`${site.name} builds to its frozen output`, { skip, timeout: 600_000 }, () => {
		assert.ok(fs.existsSync(dir), `no snapshot in ${path.relative(process.cwd(), dir)}: run node freeze.js ${site.name}`);
		const allowed = DELIBERATE[site.name] ?? {};
		const frozen = loadSnapshot(dir);
		const diff = differences(frozen, snapshotOf(buildSite(site), site, frozen.version))
			.filter((line) => !Object.keys(allowed).some((key) => line.startsWith(key)));
		assert.deepEqual(diff, [], `${site.name} differs from its snapshot:\n  ${diff.join("\n  ")}`);
	});
}
