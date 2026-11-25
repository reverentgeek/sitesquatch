// `SSQCH_CHECK_REBUILDS=1 ssqch serve`: after each rebuild, a clean build of the same files in a
// process of its own, compared with what the rebuild left in the output, byte for byte.
//
// The rule the dev server keeps (the roadmap's design for faster rebuilds): after any rebuild
// while serving, the output is what a clean build of the same files would write. A rebuild keeps
// things between builds while its process lives (highlighted fences, an engine's rendered bodies
// with `cache: true`, what each page's file held), and anything that skips work later has to be
// proven right the same way. This is the proof, for ssqch's own tests and for a builder who wants
// to look. It's slow: every rebuild is built twice.
import fs from "node:fs";
import path from "node:path";
import { compareText } from "../paths.ts";
import { isAsset } from "./live.ts";

/** Where a check builds, under the project root: `.cache` is never a change to the site, so the server doesn't rebuild for it. */
export const checkFolder = (root: string) => path.join(root, ".cache", "ssqch", "check-rebuilds");

/** What a check found: the files that differ, and those only one side has, by their path from the output folder with `/`. */
export interface Comparison {
	differ: string[];
	onlyClean: string[];
	onlyServed: string[];
	/** Stylesheets and scripts only the served output has, left out because `serve.run`'s tools write them there. */
	tools: string[];
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
 * Compare what a rebuild left in `served` with a clean build in `clean`. With `tools` (the site
 * has `serve.run` tools, which write stylesheets and scripts into the output and not into the
 * clean build's folder), a stylesheet or script only the served output has is theirs, not a
 * difference.
 */
export function compareOutputs(served: string, clean: string, tools: boolean): Comparison {
	const a = files(served);
	const b = files(clean);
	const out: Comparison = { differ: [], onlyClean: [], onlyServed: [], tools: [], same: 0 };
	for (const [rel, file] of a) {
		const other = b.get(rel);
		if (other === undefined) (tools && isAsset(rel) ? out.tools : out.onlyServed).push(rel);
		else if (sameBytes(file, other)) out.same += 1;
		else out.differ.push(rel);
	}
	for (const rel of b.keys()) if (!a.has(rel)) out.onlyClean.push(rel);
	for (const list of [out.differ, out.onlyClean, out.onlyServed, out.tools]) list.sort(compareText);
	return out;
}

/** What the terminal says about a comparison: one line, with up to three files of each kind. */
export function verdict(c: Comparison, changed: string, outputName: string): string {
	const some = (list: string[]) => list.slice(0, 3).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
	const tools = c.tools.length ? `; left out ${c.tools.length} stylesheet${c.tools.length === 1 ? "" : "s"} or script${c.tools.length === 1 ? "" : "s"} only serve.run's tools wrote` : "";
	if (!c.differ.length && !c.onlyClean.length && !c.onlyServed.length) return `check-rebuilds: the rebuild after ${changed} wrote what a clean build writes (${c.same} file${c.same === 1 ? "" : "s"} the same${tools})`;
	const parts = [
		c.differ.length ? `${c.differ.length} differ (${some(c.differ)})` : "",
		c.onlyClean.length ? `${c.onlyClean.length} only in the clean build (${some(c.onlyClean)})` : "",
		c.onlyServed.length ? `${c.onlyServed.length} only in ${outputName} (${some(c.onlyServed)})` : "",
	].filter(Boolean);
	return `check-rebuilds: the rebuild after ${changed} isn't what a clean build writes: ${parts.join("; ")}${tools}. A page that prints the time differs on every build, and a file only in ${outputName} may be one an earlier build or another tool left there; anything else is a page the dev server got wrong`;
}
