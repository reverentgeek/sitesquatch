// `ssqch footprint`: how much a build weighs, by kind of file, and its largest footprints (the
// heaviest pages, and the heaviest other files). It reads an output folder, as `ssqch diff`
// does, so it works on any build. Budgets (`budgets` in the config) are checked against the same
// measurements after each build. Ported from 0.7's `footprint.rs`.
import fs from "node:fs";
import path from "node:path";
import { BUDGETS } from "./budgets.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { BuildError, bail, warning } from "./diagnostics.ts";
import { compareText, realPath } from "./paths.ts";
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

/** How many folder reads (or a file's size) wait at once: enough to keep Node's file threads busy, and few enough that a big build doesn't fill memory with requests. */
const AT_ONCE = 32;

/** A folder to read: where it is, its path from the build folder, its real path, and the folder it's in (for a link that leads back up). */
interface Folder {
	path: string;
	rel: string;
	real: string;
	parent: Folder | undefined;
}

/**
 * Every file in a build folder, following links, as paths from it with `/`, in no particular
 * order; with their sizes when `sizes` is set. A Finder's `.DS_Store` isn't part of a build. A
 * link that leads back up the folders, or to nothing, fails as 0.7's walk did. Folders are read
 * in parallel: a build with a folder per page has as many folders as pages, and reading them one
 * at a time was most of the time `diff` took.
 */
export function buildFiles(dir: string, sizes: boolean): Promise<Array<[path: string, bytes: number]>> {
	const out: Array<[string, number]> = [];
	const folders: Folder[] = [{ path: dir, rel: "", real: realPath(dir), parent: undefined }];
	const files: Array<[string, string]> = [];
	let active = 0;
	// Every problem the walk meets, by the path it's at: the one reported is the first of them by
	// path, so it's the same however the reads finish (a walk in parallel finds them in any order).
	const failures: Array<[at: string, message: string]> = [];
	return new Promise((resolve, reject) => {
		const fail = (at: string, detail: string) => {
			failures.push([at, `reading ${dir}: ${detail}`]);
		};
		// A path in the folder as 0.7's walk named it: `broken/` and `dead` are `broken/dead`.
		const inside = (folder: Folder, name: string) => (folder.parent === undefined && /[\\/]$/.test(folder.path) ? folder.path + name : folder.path + path.sep + name);
		const done = () => {
			active--;
			pump();
		};
		const read = (folder: Folder) => {
			fs.readdir(folder.path, { withFileTypes: true }, (e, entries) => {
				if (e) fail(folder.path, `IO error for operation on ${folder.path}: ${e.message}`);
				else for (const entry of entries) {
					const file = inside(folder, entry.name);
					const rel = folder.rel === "" ? entry.name : `${folder.rel}/${entry.name}`;
					let isDir = entry.isDirectory(), isFile = entry.isFile();
					// A link is followed (they're rare in a build, so this asks the disk as it goes).
					if (entry.isSymbolicLink()) {
						const stat = fs.statSync(file, { throwIfNoEntry: false });
						if (!stat) {
							// 0.7 said it twice: the walk's error, then its cause.
							fail(file, `IO error for operation on ${file}: No such file or directory (os error 2): No such file or directory (os error 2)`);
							continue;
						}
						[isDir, isFile] = [stat.isDirectory(), stat.isFile()];
						if (isDir) {
							const real = realPath(file);
							let loop = folder as Folder | undefined;
							while (loop && loop.real !== real) loop = loop.parent;
							// The ancestor as the walk reached it (`loop/a`), as 0.7 named it.
							if (loop) {
								fail(file, `File system loop found: ${file} points to an ancestor ${loop.path}`);
								continue;
							}
							folders.push({ path: file, rel, real, parent: folder });
							continue;
						}
					}
					// A folder's real path is its parent's and its name (asking the disk for each is slow).
					if (isDir) folders.push({ path: file, rel, real: folder.real + path.sep + entry.name, parent: folder });
					else if (isFile && entry.name !== ".DS_Store") {
						if (sizes) files.push([file, rel]);
						else out.push([rel, 0]);
					}
				}
				done();
			});
		};
		const size = (file: string, rel: string) => {
			fs.stat(file, (e, stat) => {
				if (e) fail(file, `IO error for operation on ${file}: ${e.message}`);
				else out.push([rel, stat.size]);
				done();
			});
		};
		const pump = () => {
			while (active < AT_ONCE && (folders.length || files.length)) {
				active++;
				if (folders.length) read(folders.pop()!);
				else size(...files.pop()!);
			}
			if (active === 0) {
				if (failures.length) reject(new BuildError(failures.sort((a, b) => compareText(a[0], b[0]))[0][1]));
				else resolve(out);
			}
		};
		pump();
	});
}

/** Measures the build in `dir`. */
export async function measure(dir: string): Promise<Footprint> {
	if (!(fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false)) bail(`${dir} isn't a folder; build the site first, or give \`ssqch footprint\` a build folder (\`ssqch footprint dist\`)`);
	const pages: File[] = [];
	const others: File[] = [];
	for (const [file, size] of await buildFiles(dir, true)) (kindOf(file) === "Pages" ? pages : others).push({ path: file, bytes: size });
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
