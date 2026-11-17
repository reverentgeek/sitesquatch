// Every example, starter and (where they're present) the blog and the trial ports build to the
// output ssqch 0.7.0 built (`node freeze.js` made the snapshots). A deliberate difference goes in
// DELIBERATE with its reason, and in the changelog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sites, buildSite, snapshotOf, loadSnapshot, differences, SNAPSHOTS, LOCAL_SNAPSHOTS } from "./lib/sites.js";

/** `{ "<site>": { "<path or 'report' or 'log'>": "why it differs on purpose" } }`. */
const DELIBERATE = {};

for (const site of sites()) {
	const dir = path.join(site.local ? LOCAL_SNAPSHOTS : SNAPSHOTS, site.name);
	const skip = site.local && (!site.available || !fs.existsSync(dir)) ? "not on this machine (run node freeze.js where it is)" : !fs.existsSync(dir) ? false : false;
	test(`${site.name} builds as 0.7.0 did`, { skip, timeout: 600_000 }, () => {
		assert.ok(fs.existsSync(dir), `no snapshot in ${path.relative(process.cwd(), dir)}: run node freeze.js ${site.name}`);
		const allowed = DELIBERATE[site.name] ?? {};
		const diff = differences(loadSnapshot(dir), snapshotOf(buildSite(site), site))
			.filter((line) => !Object.keys(allowed).some((key) => line.startsWith(key)));
		assert.deepEqual(diff, [], `${site.name} differs from its snapshot:\n  ${diff.join("\n  ")}`);
	});
}
