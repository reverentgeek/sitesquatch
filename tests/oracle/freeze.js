// Freezes the expected output: builds every site with the ssqch under test (ssqch 0.7.0 while the
// move to Node runs) and writes snapshots/ (committed) and snapshots-local/ (the blog and the
// trial ports, gitignored).
//
//   node freeze.js              every site that's available
//   node freeze.js blog example-islands
//
// Each site is built twice; a site whose two builds differ is reported and not frozen, since its
// snapshot couldn't be checked.
import path from "node:path";
import { sites, buildSite, snapshotOf, saveSnapshot, differences, SNAPSHOTS, LOCAL_SNAPSHOTS } from "./lib/sites.js";
import { BIN, expectedVersion } from "./lib/ssqch.js";

const only = process.argv.slice(2);
console.log(`Freezing with ${BIN} (${expectedVersion()})`);
let failed = 0;
for (const site of sites()) {
	if (only.length && !only.includes(site.name)) continue;
	if (site.local && !site.available) { console.log(`  ${site.name}: not on this machine, skipped`); continue; }
	const first = buildSite(site);
	const a = snapshotOf(first, site);
	const b = snapshotOf(buildSite(site), site);
	const unstable = differences(a, b);
	if (unstable.length) {
		failed++;
		console.log(`  ${site.name}: two builds differ, not frozen:\n    ${unstable.slice(0, 10).join("\n    ")}`);
		continue;
	}
	saveSnapshot(path.join(site.local ? LOCAL_SNAPSHOTS : SNAPSHOTS, site.name), a);
	console.log(`  ${site.name}: ${Object.keys(a.files).length} files${a.ok ? "" : " (the build fails; frozen as a failure)"}${a.ok ? "" : `\n${first.log.split("\n").slice(-6).join("\n")}`}`);
}
process.exitCode = failed ? 1 : 0;
