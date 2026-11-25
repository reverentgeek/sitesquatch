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
import type { BuildReport } from "./build.ts";
import type { Config } from "./config.ts";
import { dirsOf, shownOutput } from "./dirs.ts";
import { filesBelow, relative } from "./paths.ts";
import type { Listed } from "./paths.ts";
import { KINDS } from "./profile.ts";
import type { Kind, ProfileReport } from "./profile.ts";
import * as voice from "./voice.ts";

/** The summary's themed lines, of which it says one. */
type Aside = "recovered" | "nothingSighted" | "firstSighting" | "leftNoTrace" | "unconfirmed" | "uninhabited";

/** The whole summary, ending in a newline. `recovered`: for a build that worked after one that failed (while serving), which is the aside then. */
export function summary(config: Config, report: BuildReport, recovered = false, listing?: Listed[]): string {
	const dirs = dirsOf(config);
	// One themed line at most, the one that says the most, in this order; the rest are plain.
	const nothing = report.templates === 0 && report.drafts === 0 && report.pagesWritten === 0;
	const asides: Array<[boolean, Aside]> = [
		[recovered, "recovered"],
		[nothing, "nothingSighted"],
		[report.firstBuild, "firstSighting"],
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

	// The listing the dev server gets too, when it was made: the output listed once a build.
	const [files, size] = listing ? [listing.length, listing.reduce((sum, [, bytes]) => sum + bytes, 0)] : dirSize(dirs.output);
	const output = shownOutput(config, true);
	lines.push(["Output", `${output}: ${count(files)} file${plural(files)}, ${bytes(size)}`]);

	if (report.timings.length) lines.push(["Time", report.timings.map(([label, ms]) => `${label} ${duration(ms)}`).join(", ")]);

	const width = Math.max(0, ...lines.map(([label]) => label.length));
	// A site's first build, or one that works again, gets a word before the usual line.
	const first = aside === "firstSighting" ? `${voice.FIRST_SIGHTING} ` : aside === "recovered" ? `${voice.RECOVERED} ` : "";
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
	const files = filesBelow(dir);
	let size = 0;
	for (const file of files) size += fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
	return [files.length, size];
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

/** How many of each kind `--profile` prints; the JSON report has them all. */
const PROFILE_TOP = 10;

/** What `--profile` prints after the summary: the slowest of each kind, by total time, with their calls. */
export function profileText(profile: ProfileReport): string {
	const titles: Record<Kind, string> = { pages: "Pages", templates: "Templates (pages)", layouts: "Layouts (renders)", engines: "Template engines (renders)", filters: "Filters (calls)", transforms: "Transforms (pages)", data: "Data", collections: "Collections", hooks: "Hooks" };
	// Calls are worth showing where a name is called more than once: a filter, not a page.
	const withCalls = new Set<Kind>(["templates", "layouts", "engines", "filters", "transforms"]);
	let out = "Profile: where the time went, slowest first (a call's time includes the calls it makes)\n";
	// An async call is timed until its promise settles, and ones that ran at once overlap: their
	// total can pass the build's own time (an async filter on every page of a feed).
	if (KINDS.some((kind) => profile[kind].some((e) => e.async))) out += "Async ones are timed until they settle, and overlap: their totals can add up to more than the build took\n";
	for (const kind of KINDS) {
		const list = profile[kind];
		if (!list.length) continue;
		out += `  ${titles[kind]}\n`;
		const shown = list.slice(0, PROFILE_TOP);
		const width = Math.max(...shown.map((e) => duration(e.ms).length));
		for (const e of shown) {
			const notes = [...(withCalls.has(kind) ? [count(e.calls)] : []), ...(e.async ? ["async"] : [])];
			out += `    ${duration(e.ms).padStart(width)}  ${e.name}${notes.length ? ` (${notes.join(", ")})` : ""}\n`;
		}
		if (list.length > PROFILE_TOP) out += `    ...and ${count(list.length - PROFILE_TOP)} more (--format json lists them all)\n`;
	}
	return out;
}
