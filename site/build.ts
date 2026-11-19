// Builds sitesquatch.dev for production with this repository's ssqch (or SSQCH_BIN), and fails
// on any warning as well as any error: a broken link, a page over its budget (`budgets` in
// ssqch.config.js) or anything else ssqch would only warn about isn't something to deploy.
//
//   node build.ts
//
// Later stages add to it: the docs split from the README before the build, the examples built
// under /examples/, and Pagefind after (TODO.md, section 9).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const bin = process.env.SSQCH_BIN ?? path.join(root, "..", "packages", "ssqch", "bin", "ssqch.ts");
const command = bin.endsWith(".ts") ? [process.execPath, [bin]] as const : [bin, []] as const;

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
console.log(`site: built ${report.pages.written} pages into ${path.relative(process.cwd(), path.join(root, report.output)) || "."} in ${Math.round(report.durationMs)} ms, with no warnings`);
