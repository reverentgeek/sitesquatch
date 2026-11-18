// `ssqch sighting`: not in `--help`. A picture, and when the site was last built.
import fs from "node:fs";
import path from "node:path";
import { OUTPUT_LIST } from "../build.ts";
import { count } from "../report.ts";

const PHOTO = `
       /\\                                 /\\
      /  \\             /\\                /  \\
     /    \\           /  \\       _      /    \\
    /      \\         /    \\     (_)    /      \\
   /        \\       /      \\   /| |\\  /        \\
  /__________\\     /________\\  '| |' /__________\\
       ||              ||       / \\       ||
       ||              ||      /   \\      ||
`;

/** The last build of the site in `root`, from the list a build keeps of what it wrote: how many pages, where, and how long ago. */
export function lastSiting(root: string, now: number): string {
	const none = "No confirmed sitings here yet. `ssqch build` would be the first.";
	let list: { output?: unknown; pages?: unknown; files?: unknown };
	try {
		// Whatever JSON it is: `null` has no keys either, as 0.7 read it.
		list = JSON.parse(fs.readFileSync(path.join(root, OUTPUT_LIST), "utf8")) ?? {};
	} catch {
		return none;
	}
	const output = typeof list.output === "string" ? list.output : "";
	const named = (value: unknown): string[] => (Array.isArray(value) ? value.filter((f): f is string => typeof f === "string") : []);
	// A list from before 0.4 doesn't tell pages from other files.
	const pages = Array.isArray(list.pages) ? named(list.pages) : named(list.files).filter((f) => f.endsWith(".html"));
	let newest: number | undefined;
	for (const page of pages) {
		try {
			const time = fs.statSync(path.resolve(root, output, page)).mtimeMs;
			if (newest === undefined || time > newest) newest = time;
		} catch { /* a page that's gone */ }
	}
	if (newest === undefined) return none;
	const minutes = Math.max(0, Math.floor((now - newest) / 60_000));
	const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"} ago`;
	const ago = minutes === 0 ? "just now" : minutes < 60 ? unit(minutes, "minute") : minutes < 1440 ? unit(Math.floor(minutes / 60), "hour") : unit(Math.floor(minutes / 1440), "day");
	return `Last confirmed siting: ${count(pages.length)} page${pages.length === 1 ? "" : "s"} in ${output}/, ${ago}.`;
}

/** `ssqch sighting`. */
export function runSighting(root: string): number {
	process.stdout.write(`${PHOTO}\n  Image quality meets cryptozoological standards.\n\n  ${lastSiting(root, Date.now())}\n`);
	return 0;
}
