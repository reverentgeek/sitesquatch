// The speed check for the Node implementation (docs/node-migration.md, "Speed is part of done").
//
//     node bench/bench.ts                              the limits on the machine the move was studied on:
//                                                      10,000 pages in 2 s on one thread, v8.dev in 0.72 s
//     node bench/bench.ts --baseline <packages/ssqch>  against another checkout of the Node build (CI: the
//                                                      parent commit), failing when this one is over 15% slower
//     node bench/bench.ts --reference <ssqch 0.7>      also time 0.7 on one thread, for the record
//     node bench/bench.ts --pages 1000 --runs 3        a quicker look
//
// The 10,000-page site is made by make-site.ts and built on one thread (the Node build has no
// worker threads yet, and wouldn't be given any here).
//
// The 2 s limit is a time on one machine (an Apple M-series laptop, where 0.7.0 takes about
// 2.7 s on one thread). It doesn't travel: on CI's Linux runners the Node build's first run took
// 3.75 s and 0.7.0 3.42 s, because the cores are slower and 0.7's one-thread run isn't held up
// by the file system there. So CI doesn't check a time. It builds the site with this commit and
// with its parent on the same runner, turn about, and fails a change that makes it more than
// 15% slower; the times themselves are checked on the laptop, before a stage is called done.
//
// v8.dev's exact port is timed too, where a copy is at hand (--v8 <folder>, or
// research/architecture/spikes/v8-site, which only the machine that ran the study has), with
// V8_SITE_ONLY=1 so its npm scripts don't run. CI doesn't have it.
//
// Exits with 1 when a limit is passed. Run it alone: a compiler running beside it doubled
// some timings in the study.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeSite } from "./make-site.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? undefined : args[at + 1];
};
const pages = Number(option("pages") ?? 10_000);
const runs = Number(option("runs") ?? 5);
const reference = option("reference");
const baseline = option("baseline");
const defaultV8 = path.resolve(here, "../../../research/architecture/spikes/v8-site");
const v8 = option("v8") ?? (fs.existsSync(path.join(defaultV8, "ssqch.config.js")) ? defaultV8 : undefined);
/** How much slower than the baseline a change may make the build. Runs on a shared runner differ by a few percent. */
const SLOWER = 1.15;

const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

interface Timing { wall: number; memory: number | undefined }
interface Build { label: string; command: string; argv: string[]; env?: Record<string, string> }

/**
 * One warm-up, then `runs` rounds of each build in turn, into an emptied output folder: each
 * build's median time, and the most memory (the Node build says its own). Turn about, so a
 * runner that slows down halfway slows every build alike.
 */
function time(site: string, output: string, builds: Build[]): Timing[] {
	const walls = builds.map((): number[] => []);
	const memory = builds.map((): number | undefined => undefined);
	for (let i = 0; i <= runs; i++) {
		builds.forEach((build, b) => {
			fs.rmSync(path.join(site, output), { recursive: true, force: true });
			fs.rmSync(path.join(site, ".cache"), { recursive: true, force: true });
			const started = performance.now();
			const ran = spawnSync(build.command, build.argv, { cwd: site, encoding: "utf8", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", ...build.env }, maxBuffer: 1 << 28 });
			const wall = performance.now() - started;
			if (ran.status !== 0) {
				process.stderr.write(`${build.label} failed in ${site}:\n${ran.stderr}\n`);
				process.exit(1);
			}
			if (i === 0) return;
			walls[b].push(wall);
			const said = /ssqch-bench maxrss (\d+)/.exec(ran.stderr);
			if (said) memory[b] = Math.max(memory[b] ?? 0, Number(said[1]) / 1024);
		});
	}
	return builds.map((_, b) => ({ wall: median(walls[b]), memory: memory[b] }));
}

const node = (argv: string[]) => [path.join(here, "run.ts"), ...argv];
const rows: string[] = [];
let failed = false;
const report = (what: string, timing: Timing, limit: number | undefined, note = "") => {
	const over = limit !== undefined && timing.wall > limit;
	failed ||= over;
	rows.push(`${what.padEnd(34)} ${seconds(timing.wall).padStart(8)} ${(timing.memory === undefined ? "" : `${Math.round(timing.memory)} MB`).padStart(8)}  ${limit === undefined ? "" : `${over ? "OVER" : "within"} ${seconds(limit)}`}${note}`);
};

const site = path.join(os.tmpdir(), `ssqch-bench-${pages}`);
if (!fs.existsSync(path.join(site, "ssqch.config.js"))) makeSite(site, pages);
const head: Build = { label: "the Node build", command: process.execPath, argv: node(["build", "--quiet"]) };
if (reference) {
	const [old] = time(site, "_out", [{ label: "ssqch 0.7", command: path.resolve(reference), argv: ["build", "--quiet"], env: { RAYON_NUM_THREADS: "1" } }]);
	report(`ssqch 0.7, one thread, ${pages} pages`, old, undefined);
}
const runner = baseline === undefined ? undefined : path.join(path.resolve(baseline), "bench/run.ts");
if (runner !== undefined && fs.existsSync(runner)) {
	const [before, now] = time(site, "_out", [{ label: "the baseline", command: process.execPath, argv: [runner, "build", "--quiet"] }, head]);
	report(`Node build before, ${pages} pages`, before, undefined);
	report(`Node build, ${pages} pages`, now, before.wall * SLOWER, ` (${SLOWER} of the build before; this one is ${(now.wall / before.wall).toFixed(2)})`);
} else {
	if (baseline !== undefined) rows.push(`  no Node build in ${baseline} to compare with: timed without a limit`);
	// The time itself is a limit only on the machine it was set on.
	report(`Node build, ${pages} pages`, time(site, "_out", [head])[0], baseline === undefined && pages === 10_000 ? 2000 : undefined);
}
// Where the time goes, from one more build's own report: what to read when the limit is passed.
fs.rmSync(path.join(site, "_out"), { recursive: true, force: true });
const phases = spawnSync(process.execPath, node(["build", "--quiet", "--format", "json"]), { cwd: site, encoding: "utf8", env: { ...process.env, TZ: "UTC" }, maxBuffer: 1 << 28 });
try {
	const timings: Array<{ phase: string; ms: number }> = JSON.parse(phases.stdout).timings;
	rows.push(`  phases: ${timings.map((t) => `${t.phase} ${Math.round(t.ms)} ms`).join(", ")}`);
} catch { /* the timed runs already said whether it builds */ }
if (v8) report("Node build, v8.dev", time(v8, "dist", [{ ...head, env: { V8_SITE_ONLY: "1" } }])[0], baseline === undefined ? 720 : undefined);

process.stdout.write(`${`Node ${process.versions.node}, ${os.cpus()[0]?.model ?? "?"}`}\n${"".padEnd(34)} ${"time".padStart(8)} ${"memory".padStart(8)}\n${rows.join("\n")}\n`);
process.exit(failed ? 1 : 0);
