// The oracle against the Node implementation (`packages/ssqch/`) while it's being built.
//
// Until the release that switches, the Node build passes only part of the oracle: each stage of
// the move adds to it. `node-passing.txt` lists the tests it passes today, and this runs the
// whole oracle and checks that every one of them still does, so what a stage finished stays
// finished.
//
//     node progress.js             fails if a listed test fails; names tests that pass and aren't listed
//     node progress.js --update    writes the list again from this run
//     node progress.js cli/build.test.js   only some files (their part of the list)
//
// A test that's skipped where it runs (a unix-only test on Windows, a site that isn't on this
// machine) is neither. The list is in the order the oracle's files are in.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ORACLE = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(ORACLE, "node-passing.txt");
const args = process.argv.slice(2);
const update = args.includes("--update");
const files = args.filter((arg) => !arg.startsWith("--"));

// The reporter as a URL: on Windows, Node takes `D:\...` for a URL with the scheme `d:`.
const reporter = pathToFileURL(path.join(ORACLE, "lib/names-reporter.js")).href;
const ran = spawnSync(process.execPath, ["--test", "--test-concurrency=4", `--test-reporter=${reporter}`, ...files], {
	cwd: ORACLE,
	encoding: "utf8",
	env: { ...process.env, SSQCH_BIN: process.env.SSQCH_BIN ?? "packages/ssqch/bin/ssqch.ts" },
	maxBuffer: 1 << 28,
});
const results = new Map();
for (const line of ran.stdout.split("\n")) {
	const [outcome, file, name] = line.split("\t");
	if (name !== undefined) results.set(`${file}: ${name}`, outcome);
}
if (!results.size) {
	process.stderr.write(`the oracle didn't run:\n${ran.stdout}\n${ran.stderr}\n`);
	process.exit(1);
}
const outcomes = [...results.values()];
const count = (outcome) => outcomes.filter((o) => o === outcome).length;
process.stdout.write(`${count("pass")} pass, ${count("fail")} fail, ${count("skip")} skipped, of ${results.size}\n`);

const header = "# The oracle tests the Node implementation passes today (see progress.js). A stage that makes more\n# pass adds them with `node progress.js --update`; a test never leaves this list without a reason\n# in the commit that takes it out.\n";
const listed = fs.existsSync(LIST) ? fs.readFileSync(LIST, "utf8").split("\n").filter((line) => line !== "" && !line.startsWith("#")) : [];
const inScope = (key) => !files.length || files.some((file) => key.startsWith(`${file.replace(/^\.\//, "")}: `) || key.startsWith(file.replace(/\/?$/, "/")));

if (update) {
	// Skipped here doesn't mean failing: a listed test that didn't run on this machine stays.
	const keep = listed.filter((key) => !inScope(key) || results.get(key) === "skip" || !results.has(key));
	const passing = [...results].filter(([, outcome]) => outcome === "pass").map(([key]) => key);
	const all = [...new Set([...keep, ...passing])].sort();
	fs.writeFileSync(LIST, `${header}${all.join("\n")}\n`);
	process.stdout.write(`node-passing.txt: ${all.length} tests\n`);
	process.exit(0);
}

const broken = listed.filter((key) => inScope(key) && results.get(key) === "fail");
const gone = listed.filter((key) => inScope(key) && !results.has(key));
const fresh = [...results].filter(([key, outcome]) => outcome === "pass" && !listed.includes(key)).map(([key]) => key);
if (fresh.length) process.stdout.write(`\nPassing now, and not in node-passing.txt (node progress.js --update adds them):\n${fresh.map((key) => `  ${key}`).join("\n")}\n`);
if (gone.length) process.stdout.write(`\nIn node-passing.txt, and not in the oracle any more (renamed?):\n${gone.map((key) => `  ${key}`).join("\n")}\n`);
if (broken.length) {
	process.stdout.write(`\nThese passed before and fail now:\n${broken.map((key) => `  ${key}`).join("\n")}\n`);
	// Why, from running those tests again (where this runs may not be where it can be run by hand: CI).
	for (const file of new Set(broken.map((key) => key.slice(0, key.indexOf(": "))))) {
		const names = broken.filter((key) => key.startsWith(`${file}: `)).map((key) => key.slice(file.length + 2));
		const pattern = `^(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;
		const again = spawnSync(process.execPath, ["--test", "--test-reporter=spec", `--test-name-pattern=${pattern}`, file], { cwd: ORACLE, encoding: "utf8", env: { ...process.env, SSQCH_BIN: process.env.SSQCH_BIN ?? "packages/ssqch/bin/ssqch.ts" }, maxBuffer: 1 << 28 });
		const lines = again.stdout.split("\n").filter((line) => !/^\s+at |^ℹ/.test(line));
		process.stdout.write(`\n---- ${file}\n${lines.slice(0, 120).join("\n")}${lines.length > 120 ? "\n..." : ""}\n`);
	}
	process.exit(1);
}
process.exit(gone.length ? 1 : 0);
