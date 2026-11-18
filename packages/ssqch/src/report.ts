// The summary printed after a build:
//
//     Built in 129 ms (production)
//       Pages    168 written from 160 templates, 14.2 MB
//       Drafts   3 unconfirmed (built in development only)
//       Copied   12 files, 3 unchanged, 1.1 MB
//       Images   4,689 files from 812 sources, 268 MB: 0 encoded, 4,689 reused
//       Output   dist: 4,882 files, 284 MB
//       Time     setup 2 ms, data 21 ms, read 9 ms, ..., after 18 ms
//
// Plugins add lines (like `Images`) through the config's `summaries`, and can use `count`,
// `bytes` and `duration` to format them the same way.
import fs from "node:fs";
import path from "node:path";
import type { BuildReport } from "./build.ts";
import type { Config } from "./config.ts";
import { dirsOf, shownOutput } from "./dirs.ts";
import { relative } from "./paths.ts";
import * as voice from "./voice.ts";

/** The summary's themed lines, of which it says one. */
type Aside = "recovered" | "nothingSighted" | "firstSiting" | "leftNoTrace" | "unconfirmed" | "uninhabited";

/** The whole summary, ending in a newline. `recovered`: for a build that worked after one that failed (while serving), which is the aside then. */
export function summary(config: Config, report: BuildReport, recovered = false): string {
	const dirs = dirsOf(config);
	// One themed line at most, the one that says the most, in this order; the rest are plain.
	const nothing = report.templates === 0 && report.drafts === 0 && report.pagesWritten === 0;
	const asides: Array<[boolean, Aside]> = [
		[recovered, "recovered"],
		[nothing, "nothingSighted"],
		[report.firstBuild, "firstSiting"],
		[report.filesRemoved > 0, "leftNoTrace"],
		[report.drafts > 0, "unconfirmed"],
		[report.unused.length > 0, "uninhabited"],
	];
	const aside = asides.find(([happened]) => happened)?.[1];
	const lines: Array<[string, string]> = [];

	let pages = `${count(report.pagesWritten)} written`;
	if (report.templates > 0) pages += ` from ${count(report.templates)} template${plural(report.templates)}`;
	if (report.pagesWritten > 0) pages += `, ${bytes(report.pageBytes)}`;
	// Since the last build: what's new, what's gone, and (while serving) what changed.
	const since: string[] = [];
	if (report.pagesNew) since.push(`${count(report.pagesNew)} new`);
	if (report.pagesGone) since.push(`${count(report.pagesGone)} gone`);
	if (report.pagesChanged !== undefined) since.push(`${count(report.pagesChanged)} changed`);
	if (since.length) pages += ` (${since.join(", ")})`;
	lines.push(["Pages", pages]);
	if (report.drafts > 0) lines.push(["Drafts", `${count(report.drafts)}${aside === "unconfirmed" ? " unconfirmed" : " left out"} (built in development only)`]);

	if (report.filesCopied + report.filesUnchanged > 0) {
		let copied = `${count(report.filesCopied)} file${plural(report.filesCopied)}`;
		if (report.filesUnchanged > 0) copied += `, ${count(report.filesUnchanged)} unchanged`;
		lines.push(["Copied", `${copied}, ${bytes(report.passthroughBytes)}`]);
	}
	if (report.filesRemoved > 0) lines.push(["Removed", `${count(report.filesRemoved)} stale file${plural(report.filesRemoved)}${aside === "leftNoTrace" ? `, ${voice.LEFT_NO_TRACE}` : ""}`]);

	lines.push(...report.summary);

	const [files, size] = dirSize(dirs.output);
	const output = shownOutput(config, true);
	lines.push(["Output", `${output}: ${count(files)} file${plural(files)}, ${bytes(size)}`]);

	if (report.timings.length) lines.push(["Time", report.timings.map(([label, ms]) => `${label} ${duration(ms)}`).join(", ")]);

	const width = Math.max(0, ...lines.map(([label]) => label.length));
	// A site's first build, or one that works again, gets a word before the usual line.
	const first = aside === "firstSiting" ? `${voice.FIRST_SITING} ` : aside === "recovered" ? `${voice.RECOVERED} ` : "";
	let out = `${first}Built in ${duration(report.durationMs)} (${config.env})\n`;
	for (const [label, text] of lines) out += `  ${label.padEnd(width)}  ${text}\n`;
	if (report.unused.length) {
		const n = report.unused.length;
		out += `${aside === "uninhabited" ? "Uninhabited" : "Unused"}: ${count(n)} template${plural(n)} that nothing used in this build (${report.unused.join(", ")}).\n`;
	}
	// Nothing to build is usually a wrong folder or a missing extension.
	if (nothing) {
		// The project root itself is `.`, not an empty name.
		const folder = relative(dirs.root, dirs.input) || ".";
		out += `Nothing sighted: no file in ${folder} matches templateFormats (${config.templateFormats.join(", ")}).\n`;
	}
	return out;
}

/** Every file under `dir` (in every folder, not following links) and their total size. */
function dirSize(dir: string): [number, number] {
	let files = 0, size = 0;
	const walk = (folder: string) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const p = path.join(folder, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.isFile()) {
				files++;
				size += fs.statSync(p, { throwIfNoEntry: false })?.size ?? 0;
			}
		}
	};
	walk(dir);
	return [files, size];
}

const plural = (n: number) => (n === 1 ? "" : "s");

/** `4689` as `4,689`. */
export function count(n: number): string {
	return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A size in bytes, as `512 B`, `14.2 KB`, `268 MB` or `1.41 GB` (powers of 1,000). */
export function bytes(n: number): string {
	if (n < 1000) return `${n} B`;
	let value = n;
	let unit = "";
	for (const u of ["KB", "MB", "GB", "TB"]) {
		value /= 1000;
		unit = u;
		// 999.5 and up would round to "1000", so move to the next unit.
		if (value < 999.5) break;
	}
	return `${threeDigits(value)} ${unit}`;
}

/** A duration in milliseconds, as `850 µs`, `129 ms`, `1.24 s` or `2m 05s`. */
export function duration(ms: number): string {
	const secs = ms / 1000;
	if (secs >= 60) {
		const whole = Math.round(secs);
		return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
	}
	if (secs >= 1) return `${threeDigits(secs)} s`;
	if (secs >= 0.001) return `${threeDigits(secs * 1000)} ms`;
	return `${Math.round(secs * 1_000_000)} µs`;
}

/** About three significant digits: `1.24`, `14.2`, `268`. */
function threeDigits(v: number): string {
	return fixed(v, v >= 99.95 ? 0 : v >= 9.995 ? 1 : 2);
}

/**
 * `v` with `digits` after the point. A value exactly halfway between two (12.25 at one digit)
 * goes to the even one, as 0.7 printed it; `toFixed` alone takes the larger, and the summary
 * would differ by a digit.
 */
export function fixed(v: number, digits: number): string {
	const exact = v.toFixed(digits + 30);
	const kept = exact.slice(0, exact.length - 30);
	if (!/^50*$/.test(exact.slice(-30))) return v.toFixed(digits);
	const last = Number(kept[kept.length - 1] === "." ? kept[kept.length - 2] : kept[kept.length - 1]);
	const down = digits === 0 ? kept.slice(0, -1) : kept;
	if (last % 2 === 0) return down;
	// Odd: up, which is what `toFixed` does with a tie.
	return v.toFixed(digits);
}
