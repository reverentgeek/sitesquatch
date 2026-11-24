// The files that ship with the package: the docs (`ssqch docs`, and the trailheads for `ssqch docs
// --from`), the editor types, the completion scripts and the starters.
//
// Most of them live in the package's `bundled/` folder. The docs are the website's pages
// (`site/src/docs/`, sitesquatch.dev/docs/), so there's one copy to edit: from the source, ssqch
// reads them there, and `scripts/build.ts` copies them into the package's `bundled/docs/`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The package's `bundled/` folder. */
export const BUNDLED = path.join(PACKAGE, "bundled");

/** What's read from the repository when it isn't in `bundled/`: (path under `bundled/`, the original from the repository's root). */
export const FROM_REPOSITORY: ReadonlyArray<readonly [rel: string, original: string]> = [
	["docs", "site/src/docs"],
	// The example `multilingual.md` starts from, in the package where an agent in a site's folder
	// can copy it: the Squatch Snacks rerun looked in node_modules/ssqch and wrote its own.
	["examples/multilingual", "examples/sites/multilingual"],
];

/** Where a bundled file or folder is: in `bundled/`, or (running from the source) its original. */
export function bundledPath(rel: string): string {
	const inPackage = path.join(BUNDLED, rel);
	if (fs.existsSync(inPackage)) return inPackage;
	for (const [prefix, original] of FROM_REPOSITORY) {
		if (rel === prefix || rel.startsWith(`${prefix}/`)) return path.join(PACKAGE, "../..", original + rel.slice(prefix.length));
	}
	return inPackage;
}

const cache = new Map<string, string>();

/** A bundled text file, by its path under `bundled/` (read once). */
export function bundled(rel: string): string {
	let text = cache.get(rel);
	if (text === undefined) cache.set(rel, text = fs.readFileSync(bundledPath(rel), "utf8"));
	return text;
}

/** The file names in a bundled folder, sorted. */
export function bundledNames(rel: string): string[] {
	return fs.readdirSync(bundledPath(rel)).sort();
}

/** The type definitions for `ssqch.config.js` and the `ssqch/*` modules. */
export const types = (): string => bundled("ssqch.d.ts");
