// `ssqch footprint`: how much a build weighs, by kind of file, and its largest footprints (the
// heaviest pages, and the heaviest other files). It reads an output folder, as `ssqch diff`
// does, so it works on any build. Budgets (`budgets` in the config) are checked against the same
// measurements after each build. Ported from 0.7's `footprint.rs`.
import fs from "node:fs";
import path from "node:path";
import { BUDGETS } from "./budgets.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { bail, warning } from "./diagnostics.ts";
import { compareText } from "./paths.ts";
import { padEnd, padStart } from "./quote.ts";
import { bytes, count, fixed } from "./report.ts";

/** The kinds of file a build is split into, in the order they're listed. */
const KINDS: ReadonlyArray<readonly [string, readonly string[]]> = [
	["Pages", ["html", "htm"]],
	["Images", ["avif", "webp", "jpg", "jpeg", "png", "gif", "svg", "ico", "bmp", "tif", "tiff", "jxl"]],
	["CSS", ["css"]],
	["JavaScript", ["js", "mjs", "cjs", "wasm"]],
	["Fonts", ["woff2", "woff", "ttf", "otf", "eot"]],
	["Media", ["mp4", "webm", "mov", "mp3", "ogg", "wav", "m4a", "flac"]],
	["Documents", ["pdf", "zip", "epub"]],
	["Data and feeds", ["xml", "json", "txt", "webmanifest", "csv", "map", "rss", "atom"]],
];
const OTHER = "Other";
const KIND_OF_EXTENSION = new Map(KINDS.flatMap(([name, exts]) => exts.map((ext) => [ext, name] as const)));

/** One file: its path from the output folder, with `/`, and its size. */
export interface File {
	path: string;
	bytes: number;
}

/** A kind of file, and how much of it there is. */
export interface Kind {
	name: string;
	files: number;
	bytes: number;
}

export interface Footprint {
	files: number;
	bytes: number;
	/** The kinds with any files, in `KINDS` order, `Other` last. */
	kinds: Kind[];
	/** Pages, heaviest first. */
	pages: File[];
	/** Every other file, heaviest first. */
	others: File[];
}

/** The kind of a file, by what follows the last `.` in its path. */
export function kindOf(file: string): string {
	const dot = file.lastIndexOf(".");
	return dot === -1 ? OTHER : KIND_OF_EXTENSION.get(asciiLower(file.slice(dot + 1))) ?? OTHER;
}

const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** `about/index.html` is `/about/`; anything else is its path. */
export function urlOf(file: string): string {
	if (file.endsWith("index.html")) {
		const dir = file.slice(0, -10);
		if (dir === "" || dir.endsWith("/")) return `/${dir}`;
	}
	return `/${file}`;
}

/**
 * Every file in a build folder, following links, as paths from it with `/`, in no particular
 * order; with their sizes when `sizes` is set. A Finder's `.DS_Store` isn't part of a build. A
 * link that leads back up the folders, or to nothing, fails as 0.7's walk did.
 */
export function buildFiles(dir: string, sizes: boolean): Array<[path: string, bytes: number]> {
	const out: Array<[string, number]> = [];
	const failed = (detail: string): never => bail(`reading ${dir}: ${detail}`);
	const walk = (folder: string, rel: string, above: string[]) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch (e) { return failed(`IO error for operation on ${folder}: ${(e as Error).message}`); }
		for (const entry of entries) {
			const file = path.join(folder, entry.name);
			const name = rel === "" ? entry.name : `${rel}/${entry.name}`;
			let isDir = entry.isDirectory(), isFile = entry.isFile();
			let size = -1;
			if (entry.isSymbolicLink()) {
				const stat = fs.statSync(file, { throwIfNoEntry: false });
				if (!stat) failed(`IO error for operation on ${file}: No such file or directory (os error 2)`);
				isDir = stat!.isDirectory();
				isFile = stat!.isFile();
				size = stat!.size;
				if (isDir) {
					const real = fs.realpathSync(file);
					const loop = above.find((a) => a === real);
					if (loop !== undefined) failed(`File system loop found: ${file} points to an ancestor ${loop}`);
					walk(file, name, [...above, real]);
					continue;
				}
			}
			// A folder's real path is its parent's and its name (asking the disk for each is slow).
			if (isDir) walk(file, name, [...above, path.join(above[above.length - 1], entry.name)]);
			else if (isFile && entry.name !== ".DS_Store") {
				if (sizes && size === -1) size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
				out.push([name, sizes ? size : 0]);
			}
		}
	};
	walk(dir, "", [fs.realpathSync(dir)]);
	return out;
}

/** Measures the build in `dir`. */
export async function measure(dir: string): Promise<Footprint> {
	if (!(fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false)) bail(`${dir} isn't a folder; build the site first, or give \`ssqch footprint\` a build folder (\`ssqch footprint dist\`)`);
	const pages: File[] = [];
	const others: File[] = [];
	for (const [file, size] of buildFiles(dir, true)) (kindOf(file) === "Pages" ? pages : others).push({ path: file, bytes: size });
	const heaviest = (a: File, b: File) => b.bytes - a.bytes || compareText(a.path, b.path);
	pages.sort(heaviest);
	others.sort(heaviest);
	const kinds: Kind[] = [...KINDS.map(([name]) => name), OTHER].map((name) => ({ name, files: 0, bytes: 0 }));
	for (const file of [...pages, ...others]) {
		const kind = kinds.find((k) => k.name === kindOf(file.path))!;
		kind.files += 1;
		kind.bytes += file.bytes;
	}
	const used = kinds.filter((k) => k.files > 0);
	return { files: pages.length + others.length, bytes: used.reduce((sum, k) => sum + k.bytes, 0), kinds: used, pages, others };
}

/** The share of `total` that `part` is, as a whole percent (`<1%` for a sliver). */
function share(part: number, total: number): string {
	if (total === 0) return "0%";
	const percent = (part * 100) / total;
	return percent > 0 && percent < 1 ? "<1%" : `${fixed(percent, 0)}%`;
}

/** The report, with up to `top` of each list of largest footprints. */
export function footprintText(footprint: Footprint, shown: string, top: number): string {
	let out = `Footprint of ${shown}: ${count(footprint.files)} file${footprint.files === 1 ? "" : "s"}, ${bytes(footprint.bytes)}\n`;
	if (footprint.files === 0) return `${out}Nothing sighted: the folder is empty.\n`;
	const rows = footprint.kinds.map((k) => [k.name, count(k.files), k.files === 1 ? "file" : "files", bytes(k.bytes), share(k.bytes, footprint.bytes)]);
	const width = (i: number) => Math.max(0, ...rows.map((r) => [...r[i]].length));
	const [w0, w1, w2, w3] = [width(0), width(1), width(2), width(3)];
	for (const [name, files, word, size, part] of rows) out += `  ${padEnd(name, w0)}  ${padStart(files, w1)} ${padEnd(word, w2)}  ${padStart(size, w3)}  ${part}\n`;
	const list = (title: string, files: File[], name: (f: File) => string) => {
		if (!files.length || top === 0) return;
		out += `\n${title}\n`;
		const listed = files.slice(0, top).map((f) => [bytes(f.bytes), name(f)]);
		const w = Math.max(0, ...listed.map(([size]) => [...size].length));
		for (const [size, file] of listed) out += `  ${padStart(size, w)}  ${file}\n`;
	};
	list("Largest footprints: pages", footprint.pages, (f) => urlOf(f.path));
	list("Largest footprints: other files", footprint.others, (f) => `/${f.path}`);
	return out;
}

/** The report as JSON (`schemaVersion` 1). */
export function footprintJson(footprint: Footprint, output: string, top: number): Record<string, unknown> {
	const files = (list: File[], page: boolean) => list.slice(0, top).map((f) => (page ? { path: f.path, bytes: f.bytes, url: urlOf(f.path) } : { path: f.path, bytes: f.bytes, kind: kindOf(f.path) }));
	return {
		schemaVersion: 1,
		output,
		files: footprint.files,
		bytes: footprint.bytes,
		kinds: footprint.kinds.map((k) => ({ kind: k.name, files: k.files, bytes: k.bytes })),
		largest: { pages: files(footprint.pages, true), files: files(footprint.others, false) },
	};
}

/** The files in `footprint` over their kind's budget (and the build, over `total`), each kind as one `over-budget` warning. */
export function overBudget(footprint: Footprint, budgets: Array<[string, number]>): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const [name, limit] of budgets) {
		if (name === "total") {
			if (footprint.bytes > limit) out.push(warning("over-budget", `the build is ${bytes(footprint.bytes)}, over its total budget of ${bytes(limit)}`));
			continue;
		}
		const kind = BUDGETS.find(([key]) => key === name)?.[1];
		if (kind === undefined) continue;
		const page = kind === "Pages";
		const over = [...footprint.pages, ...footprint.others].filter((f) => kindOf(f.path) === kind && f.bytes > limit);
		const shown = (f: File) => `${page ? urlOf(f.path) : `/${f.path}`} (${bytes(f.bytes)})`;
		const what = page ? "page" : "file";
		if (!over.length) continue;
		const message = over.length === 1
			? `${shown(over[0])} is over the ${name} budget of ${bytes(limit)}`
			: `${over.length} ${what}s are over the ${name} budget of ${bytes(limit)}: ${over.slice(0, 5).map(shown).join(", ")}${over.length > 5 ? ", ..." : ""}`;
		out.push(warning("over-budget", message));
	}
	return out;
}
