// The files that ship with the package (see `scripts/sync-bundled.ts`): the README, the
// editor types and the starters.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The package's `bundled/` folder. */
export const BUNDLED = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "bundled");

const cache = new Map<string, string>();

/** A bundled text file, by its path under `bundled/` (read once). */
export function bundled(rel: string): string {
	let text = cache.get(rel);
	if (text === undefined) cache.set(rel, text = fs.readFileSync(path.join(BUNDLED, rel), "utf8"));
	return text;
}

/** The file names in a bundled folder, sorted. */
export function bundledNames(rel: string): string[] {
	return fs.readdirSync(path.join(BUNDLED, rel)).sort();
}

/** The type definitions for `ssqch.config.js` and the `ssqch/*` modules. */
export const types = (): string => bundled("ssqch.d.ts");
