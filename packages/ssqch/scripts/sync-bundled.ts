// The files the package needs at run time and that live elsewhere while both implementations
// do: the README (`ssqch docs`), the trailheads and the starters' files (`ssqch init`). Stage 8 publishes this package alone, so it carries its
// own copies in `bundled/`; `bundled.test.ts` fails when one differs from its original.
//
//   node scripts/sync-bundled.ts     copies the originals over the copies
//
// When the release that switches removes the Rust implementation, the copies become the
// originals: this script and the test go, and the files are edited in `bundled/`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE = path.dirname(here);
export const REPO = path.resolve(PACKAGE, "../..");
export const BUNDLED = path.join(PACKAGE, "bundled");

/** Every file under `dir`, as paths from it with forward slashes, sorted. */
function walk(dir: string, within = ""): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(path.join(dir, within), { withFileTypes: true })) {
		const rel = within ? `${within}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...walk(dir, rel));
		else out.push(rel);
	}
	return out.sort();
}

/** The originals' folders and files, and where each is copied to in `bundled/`. */
const SOURCES: Array<[from: string, to: string]> = [
	["README.md", "README.md"],
	["docs/trailheads", "trailheads"],
	["crates/ssqch/src/starter", "starter"],
	["crates/ssqch/src/starter-docs", "starter-docs"],
];

/** Every original and its copy, as absolute paths. A file that is only in the copies isn't listed here (the test checks for those). */
export function pairs(): Array<{ original: string; copy: string }> {
	const out: Array<{ original: string; copy: string }> = [];
	for (const [from, to] of SOURCES) {
		const original = path.join(REPO, from);
		if (fs.statSync(original).isDirectory()) {
			for (const rel of walk(original)) out.push({ original: path.join(original, rel), copy: path.join(BUNDLED, to, rel) });
		} else {
			out.push({ original, copy: path.join(BUNDLED, to) });
		}
	}
	return out;
}

/**
 * What in `bundled/` is the package's own, with no original elsewhere: 0.7's completion scripts,
 * and `ssqch.d.ts`, whose 0.8 types differ from what 0.7's binary writes (`crates/ssqch/src/`).
 */
const OWN = ["completions/", "ssqch.d.ts"];

/** Every copy in `bundled/` (not the package's own files), as absolute paths. */
export function copies(): string[] {
	return fs.existsSync(BUNDLED) ? walk(BUNDLED).filter((rel) => !OWN.some((own) => rel.startsWith(own))).map((rel) => path.join(BUNDLED, rel)) : [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const wanted = new Set<string>();
	let changed = 0;
	for (const { original, copy } of pairs()) {
		wanted.add(copy);
		if (fs.existsSync(copy) && fs.readFileSync(copy).equals(fs.readFileSync(original))) continue;
		fs.mkdirSync(path.dirname(copy), { recursive: true });
		fs.copyFileSync(original, copy);
		changed++;
	}
	let removed = 0;
	for (const copy of copies()) {
		if (wanted.has(copy)) continue;
		fs.rmSync(copy);
		removed++;
	}
	console.log(`bundled/: ${changed} copied, ${removed} removed`);
}
