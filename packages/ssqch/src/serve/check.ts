// `SSQCH_CHECK_REBUILDS=1 ssqch serve`: after each rebuild, a clean build of the same files in a
// process of its own, compared with what the rebuild left in the output, byte for byte.
//
// The rule the dev server keeps (the roadmap's design for faster rebuilds): after any rebuild
// while serving, the output is what a clean build of the same files would write. A rebuild keeps
// things between builds while its process lives (highlighted fences, an engine's rendered bodies
// with `cache: true`, what each page's file held), and anything that skips work later has to be
// proven right the same way. This is the proof, for ssqch's own tests and for a builder who wants
// to look. It's slow: every rebuild is built twice.
//
// What a pass proves: the rebuild wrote what a new process writes. Both builds share
// `.cache/ssqch` (encoded images, fetched answers), so it isn't "what an empty cache writes": a
// result kept on disk there would pass stale. Anything that keeps work between rebuilds on disk
// is checked another way.
import fs from "node:fs";
import path from "node:path";
import { compareText } from "../paths.ts";

/** `OUTPUT_LIST` in build.ts (the server doesn't load the build; `check.test.ts` keeps them the same). */
export const OUTPUT_LIST = ".cache/ssqch/output-files.json";

/** Where a check builds, under the project root: `.cache` is never a change to the site, so the server doesn't rebuild for it. */
export const checkFolder = (root: string) => path.join(root, ".cache", "ssqch", "check-rebuilds");

/**
 * What the served build recorded as its own files in `outputName` (`OUTPUT_LIST` in build.ts,
 * where each folder built into keeps its own list), by their path from it with `/`.
 */
export function ownFiles(root: string, outputName: string): Set<string> {
	try {
		const list = JSON.parse(fs.readFileSync(path.join(root, OUTPUT_LIST), "utf8"));
		const entry = list?.output === outputName ? list : list?.outputs?.[outputName];
		if (Array.isArray(entry?.files)) return new Set(entry.files.filter((f: unknown) => typeof f === "string"));
	} catch { /* no list: nothing is the build's, so nothing is counted against it */ }
	return new Set();
}

/** What a check found: the files that differ, and those only one side has, by their path from the output folder with `/`. */
export interface Comparison {
	differ: string[];
	onlyClean: string[];
	onlyServed: string[];
	/** Files only the served output has that its build didn't write, left out because `serve.run`'s tools write into the output. */
	tools: string[];
	/** Files only the served output has that its build didn't write, left there by an earlier one because `leaveNoTrace` is off, as `ssqch build` leaves them. */
	left: string[];
	/** How many files both have. */
	same: number;
}

/** Every file under `dir`, by its path from `dir` with `/`. */
function files(dir: string): Map<string, string> {
	const found = new Map<string, string>();
	const visit = (folder: string, prefix: string) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) visit(file, `${prefix}${entry.name}/`);
			else if (entry.isFile()) found.set(`${prefix}${entry.name}`, file);
		}
	};
	visit(dir, "");
	return found;
}

const sameBytes = (a: string, b: string) => {
	try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
};

/**
 * Compare what a rebuild left in `served` with a clean build in `clean`. With `leaves` (the
 * site's `leaveNoTrace` is off), every file only the served output has may be one an earlier
 * build wrote, which stays, as it does with `ssqch build`: the build's list keeps those as its
 * own on purpose, so it can't tell them apart. A page the rebuild failed to write is still
 * caught: it's only in the clean build. `own` is given when the
 * site has `serve.run` tools, which write into the output and not into the clean build's folder:
 * it's what the served build recorded as its own (`ownFiles`), and a file only the served output
 * has that isn't on it is a tool's, and isn't counted (Tailwind's stylesheet, a11yproject.com's
 * gulp writing images and a style guide's pages, v8.dev's `.webmanifest`). A file the build
 * recorded and the clean build didn't write is still a difference.
 */
export function compareOutputs(served: string, clean: string, own?: ReadonlySet<string>, leaves = false): Comparison {
	const a = files(served);
	const b = files(clean);
	const out: Comparison = { differ: [], onlyClean: [], onlyServed: [], tools: [], left: [], same: 0 };
	for (const [rel, file] of a) {
		const other = b.get(rel);
		if (other === undefined) (leaves ? out.left : own && !own.has(rel) ? out.tools : out.onlyServed).push(rel);
		else if (sameBytes(file, other)) out.same += 1;
		else out.differ.push(rel);
	}
	for (const rel of b.keys()) if (!a.has(rel)) out.onlyClean.push(rel);
	for (const list of [out.differ, out.onlyClean, out.onlyServed, out.tools, out.left]) list.sort(compareText);
	return out;
}

/** What the terminal says about a comparison: one line, with up to three files of each kind. */
export function verdict(c: Comparison, changed: string, outputName: string): string {
	const some = (list: string[]) => list.slice(0, 3).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
	const tools = (c.tools.length ? `; left out ${c.tools.length} file${c.tools.length === 1 ? "" : "s"} only in ${outputName} that its build didn't write, which serve.run's tools did` : "") + (c.left.length ? `; left out ${c.left.length} only in ${outputName} (${some(c.left)}), which an earlier build may have written: with leaveNoTrace off they stay, as ssqch build leaves them` : "");
	if (!c.differ.length && !c.onlyClean.length && !c.onlyServed.length) return `check-rebuilds: the rebuild after ${changed} wrote what a clean build writes (${c.same} file${c.same === 1 ? "" : "s"} the same${tools})`;
	const parts = [
		c.differ.length ? `${c.differ.length} differ (${some(c.differ)})` : "",
		c.onlyClean.length ? `${c.onlyClean.length} only in the clean build (${some(c.onlyClean)})` : "",
		c.onlyServed.length ? `${c.onlyServed.length} only in ${outputName} (${some(c.onlyServed)})` : "",
	].filter(Boolean);
	return `check-rebuilds: the rebuild after ${changed} isn't what a clean build writes: ${parts.join("; ")}${tools}. A page that prints the time differs on every build, and a file only in ${outputName} may be one an earlier build or another tool left there; anything else is a page the dev server got wrong`;
}
