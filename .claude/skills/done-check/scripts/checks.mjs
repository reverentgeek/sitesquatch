#!/usr/bin/env node
// Which of "done"'s checks a change calls for, from the files it touches (AGENTS.md, "Commands"
// and "Rules"). It lists them with their commands and runs nothing.
//
//   node .claude/skills/done-check/scripts/checks.mjs [base]
//
// `base` is the commit to compare with (default: origin/main, or main). Committed, uncommitted
// and untracked files all count.
import { execFileSync } from "node:child_process";

function git(...args) {
	try {
		return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}
const lines = (text) => (text ? text.split("\n").filter(Boolean) : []);

const base = process.argv[2] ?? (git("rev-parse", "--verify", "--quiet", "origin/main") ? "origin/main" : "main");
const from = git("merge-base", base, "HEAD");
if (from === null) {
	console.error(`checks: no commit called ${base} to compare with`);
	process.exit(2);
}
const changed = new Set([...lines(git("diff", "--name-only", from)), ...lines(git("ls-files", "--others", "--exclude-standard"))]);
const added = new Set([...lines(git("diff", "--name-only", "--diff-filter=A", from)), ...lines(git("ls-files", "--others", "--exclude-standard"))]);
const files = [...changed].sort();

const some = (re, list = files) => list.filter((f) => re.test(f));
const code = some(/^packages\/ssqch\/(src|bin|bench)\//);
const built = code.filter((f) => !/\.test\.ts$/.test(f) && !f.startsWith("packages/ssqch/bench/"));
const dts = some(/^packages\/ssqch\/bundled\/ssqch\.d\.ts$/);
const bundled = some(/^packages\/ssqch\/bundled\//);
const wasm = some(/^packages\/ssqch\/wasm\/|\.wasm$/);
const rust = some(/^(crates|examples\/rust-plugin)\/|^Cargo\.(toml|lock)$/);
const docsPages = some(/^site\/src\/docs\//);
const site = some(/^site\//);
const oracle = some(/^tests\/oracle\//);
const snapshots = some(/^tests\/oracle\/(snapshots(-local)?\/|contract\/shapes\.json$)/);
const examples = some(/^examples\//);
const packaging = some(/^packages\/ssqch\/(scripts\/|package(-lock)?\.json$)/);
const newModules = some(/^packages\/ssqch\/src\/.*(?<!\.test)\.ts$/, [...added]);
const drawings = some(/^docs\/assets\/[^/]+\.svg$/);
const workflows = some(/^\.github\/workflows\//);
const changelog = changed.has("CHANGELOG.md");

const checks = [
	{ name: "Types", because: [...code, ...dts, ...packaging], commands: ["cd packages/ssqch && npx tsc --noEmit"] },
	{ name: "Unit tests", because: [...code, ...packaging], commands: ["cd packages/ssqch && node --test"] },
	{
		name: "The oracle, on Node 22.18, 24 and 26",
		because: [...code, ...bundled, ...wasm, ...docsPages, ...oracle, ...examples],
		commands: ["cd tests/oracle && for v in 22.18 24 26; do nvm exec $v node --test || break; done"],
	},
	{ name: "Speed (alone, with nothing else running)", because: [...built, ...wasm], commands: ["cd packages/ssqch && node bench/bench.ts"] },
	{
		name: "The blog's build and smoke tests",
		because: [...built, ...wasm],
		commands: ["cd ../blog && SSQCH_BIN=../ssqch/packages/ssqch/bin/ssqch.ts pnpm test"],
	},
	{
		name: "The npm package",
		because: [...packaging, ...newModules, ...bundled],
		commands: ["cd packages/ssqch && node scripts/build.ts && node scripts/check-package.ts"],
	},
	{
		name: "The Rust and its .wasm files (no cargo fmt)",
		because: rust,
		commands: [
			"cd packages/ssqch && node scripts/build-wasm.ts && node --test scripts/wasm-inputs.test.ts",
			"cargo test --workspace",
			"cargo clippy --workspace --all-targets -- -D warnings",
			"cargo clippy --workspace --lib --target wasm32-wasip1 -- -D warnings",
		],
	},
	{ name: "The site", because: site, commands: ['cd site && node build.ts && node --test "tests/*.test.ts"'] },
	{ name: "Stickers for the drawings", because: drawings, commands: ["node scripts/stickers.mjs"] },
];

console.log(`${files.length} file${files.length === 1 ? "" : "s"} changed against ${base} (${from.slice(0, 7)}), uncommitted and untracked included.\n`);
if (files.length === 0) {
	console.log("Nothing to check.");
	process.exit(0);
}

const needed = checks.filter((c) => c.because.length > 0);
const skipped = checks.filter((c) => c.because.length === 0);
console.log("Run:\n");
for (const c of needed) {
	const why = [...new Set(c.because)];
	console.log(`- ${c.name}`);
	for (const command of c.commands) console.log(`    ${command}`);
	console.log(`    because of ${why.slice(0, 3).join(", ")}${why.length > 3 ? ` and ${why.length - 3} more` : ""}\n`);
}
if (needed.length === 0) console.log("- Nothing: no file here is one a check reads.\n");
if (skipped.length > 0) console.log(`Not called for by these files: ${skipped.map((c) => c.name).join("; ")}.\n`);

const flags = [];
if ((built.length > 0 || bundled.length > 0 || rust.length > 0) && !changelog) flags.push("Code changed and CHANGELOG.md didn't: a change a user could notice needs an entry under \"## Unreleased\".");
if (snapshots.length > 0) flags.push(`A frozen file changed (${snapshots.slice(0, 2).join(", ")}${snapshots.length > 2 ? ", ..." : ""}): it's from \`node freeze.js <site>\` or \`SSQCH_FREEZE_SHAPES=new\`, never a hand edit, and its reason is written where it's tested and in the changelog.`);
if (dts.length > 0) flags.push("ssqch.d.ts changed: it's the contract. No `*/` inside a doc comment, a description for each new name, and `ssqch docs <name>` answers for it.");
if (newModules.length > 0) flags.push(`New files in src (${newModules.slice(0, 3).join(", ")}${newModules.length > 3 ? ", ..." : ""}): a module a site imports needs its exports in ssqch.d.ts and an entry in BUILT_IN.`);
if (changed.has("packages/ssqch/src/equivalents.ts")) flags.push("equivalents.ts changed: keep the oracle's copy equal (tests/oracle/cli/aliases.test.js).");
if (some(/^site\/src\/docs\/[^/]+\.md$|^site\/src\/docs\/trailheads\//, [...added]).length > 0) flags.push("A new docs page: list it in site/src/docs/nav.yml.");
if (some(/^packages\/ssqch\/package\.json$/).length > 0) flags.push("package.json changed: a new run-time dependency needs its reason in the commit message, and scripts/build.ts's EXTERNAL or KNOWN_LOOKUPS may need it.");
if (workflows.length > 0) flags.push("A workflow changed: a pull request that changes the release's own files runs release.yml up to the release, unsigned.");
if (flags.length > 0) console.log(`Look at:\n\n${flags.map((f) => `- ${f}`).join("\n")}\n`);

console.log("Then the questions only reading the change can answer: step 3 of the done-check skill.");
