// `ssqch baseline "<command>"`: the old generator's builds to compare a move with.
//
// Every move from another generator started the same way, by hand: build the site with its own
// generator from fresh copies, with the time zone and the files' times pinned, a few times over,
// and see what changes by itself (the build's time, ids from `Math.random()`) before comparing
// anything with ssqch. v8.dev wrote `scripts/parity.sh` for it and lit.dev `stability.py`. This
// does it for any generator: the copies, the pinned clock, the runs, and `ssqch diff`'s
// comparison of several builds at the end.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { commandLine } from "../command-line.ts";
import { red } from "../diagnostics.ts";
import { compareRuns, runsText } from "../diff.ts";
import { compareText } from "../paths.ts";

export interface BaselineOptions {
	/** The site's folder: the copies are of it, and the reference builds go beside it. */
	root: string;
	/** The old generator's build command, run in each copy (`npx @11ty/eleventy`). */
	command: string;
	/** The folder the command writes, in the site's folder (`_site`). */
	from: string;
	/** How many builds: 1 makes one; 2 or more compare them. */
	runs: number;
	/** A commit to build instead of the working tree (the one before `ssqch import --write`). */
	commit: string | undefined;
	/** What the reference builds are called: `ref` makes `ref-1`, `ref-2` and `ref-3`. */
	to: string;
	/** More of the site's folders to link into each copy, beside the installs found by themselves (`--link`). */
	link: string[];
	quiet: boolean;
}

/** The time every copied file gets, so pages dated by their file's time agree from build to build: the commit's, or 2026-01-01. */
const FALLBACK_TIME = Date.UTC(2026, 0, 1) / 1000;

class BaselineError extends Error {}

const git = (root: string, args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: 1 << 30 });

/** `ssqch baseline`: prints the comparison of the builds and answers 0 when they're the same, 1 when something varies, and 2 when a build couldn't be made. */
export async function runBaseline(options: BaselineOptions): Promise<number> {
	const say = (line: string) => { if (!options.quiet) process.stderr.write(`${line}\n`); };
	const root = path.resolve(options.root);
	// The copies, apart from the builds (`.cache/ssqch/baseline/ref-1` by default), which an
	// earlier run's copies mustn't take with them.
	const work = path.join(root, ".cache", "ssqch", "baseline-copies");
	const worktrees: string[] = [];
	try {
		if (!options.command.trim()) throw new BaselineError("give the old generator's build command: `ssqch baseline \"npx @11ty/eleventy\"`");
		if (!Number.isInteger(options.runs) || options.runs < 1) throw new BaselineError(`--runs ${options.runs}: give a number of builds, 1 or more`);
		if (path.isAbsolute(options.from) || options.from.split(/[\\/]/).includes("..")) throw new BaselineError(`--from ${options.from}: the folder the command writes, inside the site's folder (\`_site\`)`);
		const inGit = git(root, ["rev-parse", "--is-inside-work-tree"]).status === 0;
		if (options.commit !== undefined && !inGit) throw new BaselineError(`--commit ${options.commit}: ${root} isn't in a git repository`);
		const rev = options.commit ?? "HEAD";
		const time = inGit ? Number(git(root, ["log", "-1", "--format=%ct", rev]).stdout.toString().trim()) || FALLBACK_TIME : FALLBACK_TIME;
		if (options.commit !== undefined && git(root, ["rev-parse", "--verify", "--quiet", `${options.commit}^{commit}`]).status !== 0) throw new BaselineError(`--commit ${options.commit}: no such commit`);
		if (path.isAbsolute(options.to) || options.to.split(/[\\/]/).includes("..")) throw new BaselineError(`--to ${options.to}: a name inside the site's folder (\`ref\`, or \`.refs/jekyll\`)`);
		// Jekyll prints its own clock (`site.time`) and doesn't read SOURCE_DATE_EPOCH: a config of
		// its own pins it, unless the command gives its configs itself (opensource.guide's 380 files).
		let command = options.command;
		let clock = "TZ=UTC, SOURCE_DATE_EPOCH and every file's time pinned; a generator that reads its own clock isn't, so pin it in its config if the builds vary";
		if (/\bjekyll\s+build\b/.test(command) && !/--config\b/.test(command)) {
			const pin = path.join(work, "..", "baseline-time.yml");
			fs.mkdirSync(path.dirname(pin), { recursive: true });
			fs.writeFileSync(pin, `# Written by ssqch baseline: Jekyll's site.time, pinned.\ntime: ${new Date(time * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " +0000")}\n`);
			command = command.replace(/\bjekyll\s+build\b/, (m) => `${m} --config _config.yml,${JSON.stringify(pin)}`);
			clock = "TZ=UTC, SOURCE_DATE_EPOCH, every file's time and Jekyll's site.time pinned (with --config _config.yml and a time: of its own)";
		}

		fs.rmSync(work, { recursive: true, force: true });
		fs.mkdirSync(work, { recursive: true });
		const names: string[] = [];
		for (let run = 1; run <= options.runs; run++) {
			const copy = path.join(work, `run-${run}`);
			// A fresh copy each time: what one build leaves (a cache, a stale file) doesn't reach the next.
			if (options.commit !== undefined) {
				const added = git(root, ["worktree", "add", "--detach", "--force", copy, options.commit]);
				if (added.status !== 0) throw new BaselineError(`couldn't check out ${options.commit}: ${added.stderr.toString().trim()}`);
				worktrees.push(copy);
			} else {
				copyWorkingTree(root, copy, inGit, [options.from, ".cache", "node_modules"], options.to);
			}
			pinTimes(copy, time);
			// The site's installed packages, shared: an install in each copy would take minutes, and
			// git ignores them, so a copy has none.
			for (const rel of installs(root, options.link)) {
				const from = path.join(root, ...rel.split("/"));
				const to = path.join(copy, ...rel.split("/"));
				if (!fs.existsSync(from) || fs.existsSync(to)) continue;
				fs.mkdirSync(path.dirname(to), { recursive: true });
				const dir = fs.statSync(from).isDirectory();
				if (dir) fs.symlinkSync(from, to, process.platform === "win32" ? "junction" : "dir");
				else fs.copyFileSync(from, to);
			}

			say(`Building ${run} of ${options.runs}: ${command}`);
			const { file, args, options: spawnOptions } = commandLine(command, copy, { TZ: "UTC", SOURCE_DATE_EPOCH: String(time) });
			// The command's output is for a person: it goes to standard error, with ssqch's.
			const result = spawnSync(file, args, { ...spawnOptions, stdio: ["ignore", options.quiet ? "ignore" : process.stderr, options.quiet ? "ignore" : process.stderr] });
			if (result.error) throw new BaselineError(`couldn't run \`${options.command}\`: ${result.error.message}`);
			if (result.status !== 0) throw new BaselineError(`\`${options.command}\` failed in build ${run} (exit code ${result.status ?? result.signal}); its output is above`);
			const built = path.join(copy, options.from);
			if (!fs.statSync(built, { throwIfNoEntry: false })?.isDirectory()) throw new BaselineError(`\`${options.command}\` wrote no ${options.from}/ in build ${run}: give the folder it writes with --from (Eleventy and Jekyll write _site, Hugo public, Astro dist)`);
			const name = `${options.to}-${run}`;
			const target = path.join(root, ...name.split("/"));
			fs.rmSync(target, { recursive: true, force: true });
			// `--to .refs/jekyll` names a folder that may not be there yet.
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.renameSync(built, target);
			names.push(name);
		}

		// A build an earlier, longer run left (`ref-3` after `--runs 2`) would be read as one of these.
		for (let run = options.runs + 1; fs.existsSync(path.join(root, `${options.to}-${run}`)); run++) fs.rmSync(path.join(root, `${options.to}-${run}`), { recursive: true, force: true });
		const shown = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
		say(`Base camp is set: ${shown}, built from ${options.commit ?? "the working tree"} with ${clock}.`);
		let code = 0;
		if (names.length > 1) {
			const report = await compareRuns(names.map((n) => path.join(root, n)), { exact: false, ignore: [], only: undefined, lines: 10 });
			process.stdout.write(runsText({ ...report, runs: names }, 10, process.stdout.isTTY === true));
			code = report.varies.length ? 1 : 0;
		}
		process.stdout.write(`\nNext: build with ssqch into an empty folder, then \`ssqch diff ${names[0]} <ssqch's output>\`${code ? ", with an --ignore for what varies above" : ""}, and fix the biggest group first. The whole loop: \`ssqch docs "moving a site with an agent"\`.\n`);
		return code;
	} catch (e) {
		process.stderr.write(`${red("error:")} ${e instanceof BaselineError ? e.message : e instanceof Error ? e.message : String(e)}\n`);
		return 2;
	} finally {
		for (const tree of worktrees) git(root, ["worktree", "remove", "--force", tree]);
		fs.rmSync(work, { recursive: true, force: true });
		if (worktrees.length) git(root, ["worktree", "prune"]);
	}
}

/**
 * The folders a generator's packages are installed in, which git ignores: npm's `node_modules`,
 * Bundler's `.bundle` (its config) and the path that config gives gems (`BUNDLE_PATH`, or
 * `vendor/bundle`), a Python `.venv`, and `--link`'s. opensource.guide's Jekyll wouldn't start in
 * a copy without its `vendor/gems`.
 */
function installs(root: string, more: string[]): string[] {
	const found = ["node_modules", ".bundle", "vendor/bundle", ".venv"];
	try {
		const config = fs.readFileSync(path.join(root, ".bundle", "config"), "utf8");
		const gems = /^BUNDLE_PATH:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(config)?.[1];
		if (gems && !path.isAbsolute(gems) && !gems.startsWith("~")) found.push(gems.replace(/^\.\//, "").replace(/\/+$/, ""));
	} catch { /* no Bundler config */ }
	for (const rel of more) {
		if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new BaselineError(`--link ${rel}: a folder inside the site's folder (\`vendor/bundle\`)`);
		found.push(rel.replaceAll("\\", "/").replace(/\/+$/, ""));
	}
	return [...new Set(found)];
}

/** The site's files as git would commit them (tracked, and new ones it doesn't ignore), or every file but `skip`'s outside git, copied into `copy`. */
function copyWorkingTree(root: string, copy: string, inGit: boolean, skip: string[], to: string): void {
	// Earlier reference builds (`ref-1/`) aren't the site's files.
	const build = new RegExp(`^${to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+(?:/|$)`);
	const skipped = (rel: string) => rel === ".git" || rel.startsWith(".git/") || build.test(rel) || skip.some((s) => rel === s || rel.startsWith(`${s}/`));
	let files: string[];
	if (inGit) {
		const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
		if (listed.status !== 0) throw new BaselineError(`couldn't list the site's files: ${listed.stderr.toString().trim()}`);
		files = listed.stdout.toString().split("\0").filter(Boolean);
	} else {
		files = [];
		const walk = (rel: string) => {
			for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
				const child = rel ? `${rel}/${entry.name}` : entry.name;
				if (skipped(child)) continue;
				if (entry.isDirectory()) walk(child);
				else if (entry.isFile()) files.push(child);
			}
		};
		walk("");
	}
	for (const rel of files) {
		if (skipped(rel)) continue;
		const from = path.join(root, ...rel.split("/"));
		// A file git lists but the working tree has deleted.
		if (!fs.statSync(from, { throwIfNoEntry: false })?.isFile()) continue;
		const to = path.join(copy, ...rel.split("/"));
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.copyFileSync(from, to);
	}
}

/** Every file in `dir` (not through `node_modules`) gets `time`, in seconds. */
function pinTimes(dir: string, time: number): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) pinTimes(full, time);
		else if (entry.isFile()) fs.utimesSync(full, time, time);
	}
}
