// The speed check for the Node implementation (docs/node-migration.md, "Speed is part of done").
//
//     node bench/bench.ts                          the limits on this machine: 10,000 pages in 2 s, v8.dev in 0.72 s
//     node bench/bench.ts --reference <ssqch 0.7>  the 10,000-page limit from 0.7 on this machine (for CI)
//     node bench/bench.ts --pages 1000 --runs 3    a quicker look
//
// The 10,000-page site is made by make-site.ts and built on one thread (the Node build has no
// worker threads yet, and wouldn't be given any here). The limit of 2 s was set on the machine
// the move was studied on, where 0.7.0 takes 2.79 s on one thread; a CI runner is slower, so
// with --reference the limit is 0.72 of 0.7's own time on the same runner
// (RAYON_NUM_THREADS=1), which is the same line.
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
const defaultV8 = path.resolve(here, "../../../research/architecture/spikes/v8-site");
const v8 = option("v8") ?? (fs.existsSync(path.join(defaultV8, "ssqch.config.js")) ? defaultV8 : undefined);

const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

interface Timing { wall: number; memory: number | undefined }

/** One warm-up, then `runs` builds into an emptied output folder: the median time, and the most memory (the Node build says its own). */
function time(label: string, site: string, output: string, command: string, argv: string[], env: Record<string, string> = {}): Timing {
	const walls: number[] = [];
	let memory: number | undefined;
	for (let i = 0; i <= runs; i++) {
		fs.rmSync(path.join(site, output), { recursive: true, force: true });
		fs.rmSync(path.join(site, ".cache"), { recursive: true, force: true });
		const started = performance.now();
		const ran = spawnSync(command, argv, { cwd: site, encoding: "utf8", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", ...env }, maxBuffer: 1 << 28 });
		const wall = performance.now() - started;
		if (ran.status !== 0) {
			process.stderr.write(`${label} failed in ${site}:\n${ran.stderr}\n`);
			process.exit(1);
		}
		if (i === 0) continue;
		walls.push(wall);
		const said = /ssqch-bench maxrss (\d+)/.exec(ran.stderr);
		if (said) memory = Math.max(memory ?? 0, Number(said[1]) / 1024);
	}
	return { wall: median(walls), memory };
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
let limit: number | undefined = pages === 10_000 ? 2000 : undefined;
let note = "";
if (reference) {
	const old = time("ssqch 0.7", site, "_out", path.resolve(reference), ["build", "--quiet"], { RAYON_NUM_THREADS: "1" });
	report(`ssqch 0.7, one thread, ${pages} pages`, old, undefined);
	limit = old.wall * 0.72;
	note = " (0.72 of 0.7's time here)";
}
report(`Node build, ${pages} pages`, time("the Node build", site, "_out", process.execPath, node(["build", "--quiet"])), limit, note);
if (v8) report("Node build, v8.dev", time("the Node build", v8, "dist", process.execPath, node(["build", "--quiet"]), { V8_SITE_ONLY: "1" }), 720);

process.stdout.write(`${`Node ${process.versions.node}, ${os.cpus()[0]?.model ?? "?"}`}\n${"".padEnd(34)} ${"time".padStart(8)} ${"memory".padStart(8)}\n${rows.join("\n")}\n`);
process.exit(failed ? 1 : 0);
