// Builds sitesquatch.dev for production with this repository's ssqch (or SSQCH_BIN), and fails
// on any warning as well as any error: a broken link, a page over its budget (`budgets` in
// ssqch.config.js) or anything else ssqch would only warn about isn't something to deploy.
//
//   node build.ts
//
// Then Pagefind (https://pagefind.app) indexes the docs for the search (src/elements/site-search.js),
// unless SEARCH=0. It's after ssqch's build so its files aren't held to the site's budgets: they
// load only when someone searches. The docs pages themselves are split from the README by the
// config's beforeBuild hook (lib/split.ts). A later stage adds the examples, built under
// /examples/ (TODO.md, section 9).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const bin = process.env.SSQCH_BIN ?? path.join(root, "..", "packages", "ssqch", "bin", "ssqch.ts");
const command = bin.endsWith(".ts") ? [process.execPath, [bin]] as const : [bin, []] as const;

// Pagefind's files from the last build would count against the budgets: they're made again after.
rmSync(path.join(root, "dist", "pagefind"), { recursive: true, force: true });

const run = spawnSync(command[0], [...command[1], "build", "--root", root, "--env", "production", "--format", "json", "--quiet"], {
	encoding: "utf8",
	stdio: ["ignore", "pipe", "inherit"],
});
if (run.error) throw run.error;

let report;
try {
	report = JSON.parse(run.stdout);
} catch {
	process.stderr.write(run.stdout);
	console.error(`site: ssqch didn't print a report (exit code ${run.status})`);
	process.exit(1);
}

for (const problem of [...report.errors, ...report.warnings]) {
	console.error(`${report.errors.includes(problem) ? "error" : "warning"} [${problem.code}]: ${problem.message}`);
}
if (!report.ok || report.warnings.length > 0) {
	console.error(`site: the build ${report.ok ? `has ${report.warnings.length === 1 ? "a warning, which fails" : `${report.warnings.length} warnings, which fail`} the site's build` : "failed"}`);
	process.exit(1);
}
for (const line of report.summary ?? []) console.log(typeof line === "string" ? line : `  ${line.label.padEnd(7)} ${line.value}`);

// Pinned: the index's format and the search UI's look come with the version.
const PAGEFIND = "pagefind@1.5.2";
if (process.env.SEARCH !== "0") {
	const npx = process.platform === "win32" ? "npx.cmd" : "npx";
	const search = spawnSync(npx, ["--yes", PAGEFIND, "--site", path.join(root, report.output)], { encoding: "utf8", shell: process.platform === "win32" });
	if (search.status !== 0) {
		process.stderr.write(search.stdout + search.stderr);
		console.error(`site: Pagefind (${PAGEFIND}) failed. SEARCH=0 builds without the search.`);
		process.exit(1);
	}
	const indexed = /Indexed (\d+) pages?/.exec(search.stdout)?.[1];
	console.log(`  Search  ${indexed ?? "?"} pages indexed by ${PAGEFIND}`);
}
console.log(`site: built ${report.pages.written} pages into ${path.relative(process.cwd(), path.join(root, report.output)) || "."} in ${Math.round(report.durationMs)} ms, with no warnings`);
