// Paths as the build names and orders them.
import fs from "node:fs";
import path from "node:path";

/** A path with `/` separators, whatever the platform. */
export const slashes = (p: string) => (path.sep === "/" ? p : p.split(path.sep).join("/"));

/**
 * `./dist/about/index.html` for a path inside the project, else the full path. Always with `/`,
 * on Windows too: it's what templates, globs and JavaScript see (`page.inputPath`), and what the
 * build log prints.
 */
export function displayPath(root: string, file: string): string {
	if (file === root) return "./";
	return file.startsWith(root + path.sep) ? `./${slashes(file.slice(root.length + 1))}` : file;
}

/** `displayPath` without the `./` in front: how errors and warnings name a file. */
export const shown = (root: string, file: string) => displayPath(root, file).replace(/^\.\//, "");

/** `file` from `dir`, with `/` separators. */
export const relative = (dir: string, file: string) => slashes(path.relative(dir, file));

/**
 * Two paths joined as Rust joins them, which is how 0.7's messages named a path given on the
 * command line: nothing tidied (`.` and `x` are `./x`), and an absolute second path is itself.
 */
export const joinAsGiven = (base: string, rel: string) => (path.isAbsolute(rel) || base === "" ? rel : /[\\/]$/.test(base) ? base + rel : base + path.sep + rel);

/** A path's folder as Rust names it (`Path::parent`): what's before its last part (`f/posts` for `f/posts/x.md`), or `""` for a bare name. */
export function parentAsGiven(p: string): string {
	const separators = path.sep === "/" ? "/" : "\\/";
	let end = p.length;
	while (end > 1 && separators.includes(p[end - 1])) end--;
	let at = end - 1;
	while (at >= 0 && !separators.includes(p[at])) at--;
	if (at < 0) return "";
	let parent = at;
	while (parent > 0 && separators.includes(p[parent - 1])) parent--;
	return parent === 0 ? p.slice(0, 1) : p.slice(0, parent);
}

/**
 * A path with its links followed, as the system itself names it. (The system's own answer, not
 * Node's reading of the path: on Windows that's the one with a folder's long name where the
 * path had its short one, `RUNNER~1`, which is how Node names a module's file in a stack.)
 */
export const realPath = (p: string) => { try { return fs.realpathSync.native(p); } catch { return p; } };
export const isFile = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
export const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Whether `file` is `dir` or inside it. */
export const isInside = (dir: string, file: string) => file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/**
 * Orders strings by their UTF-8 bytes, which is how 0.7 ordered them, on every platform and
 * whatever the locale. (JavaScript's own `<` compares UTF-16 units, which puts an emoji before
 * some CJK punctuation and UTF-8 doesn't.)
 */
export function compareText(a: string, b: string): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		let x = a.charCodeAt(i), y = b.charCodeAt(i);
		if (x === y) continue;
		// Surrogates sort after the rest of the Basic Multilingual Plane, as their code points do.
		if (x >= 0xd800 && y >= 0xd800) {
			x = x >= 0xe000 ? x - 0x800 : x + 0x2000;
			y = y >= 0xe000 ? y - 0x800 : y + 0x2000;
		}
		return x - y;
	}
	return a.length - b.length;
}

/** Orders paths folder by folder (`a/b` before `a-b`), each name by its bytes: the order pages are built and listed in. */
export function comparePaths(a: string, b: string): number {
	if (a === b) return 0;
	const x = a.split(path.sep), y = b.split(path.sep);
	const n = Math.min(x.length, y.length);
	for (let i = 0; i < n; i++) {
		if (x[i] === y[i]) continue;
		return compareText(x[i], y[i]);
	}
	return x.length - y.length;
}

/** Every file under `dir` (not following links to folders), as absolute paths. Missing folders have none. */
export function walkFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const p = path.join(d, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (entry.isFile()) out.push(p);
		}
	};
	walk(dir);
	return out;
}

/** A folder's entry as a walk that follows links sees it. */
export interface Followed {
	name: string;
	path: string;
	isDirectory: boolean;
	isFile: boolean;
	/** Its real path: the folder's real path and its name, or where a link leads. */
	real: string;
}

/**
 * The entries of `dir`, with links followed: a link to a folder is a folder. `above` is the real
 * paths of the folders the walk came down through, so a link that leads back up to one of them is
 * told from a folder; `onError` gets that, and a link to nothing, and what it returns isn't used
 * (it throws, or the entry is skipped).
 */
export function readFollowing(dir: string, above: string[], onError: (problem: { path: string; loop?: string; broken?: true }) => void): Followed[] {
	const out: Followed[] = [];
	// The folder's own real path is the last one the walk came through (asking the disk for every
	// file's real path is a tenth of a second on a big site).
	const here = above[above.length - 1] ?? realPath(dir);
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const file = path.join(dir, entry.name);
		if (!entry.isSymbolicLink()) {
			out.push({ name: entry.name, path: file, isDirectory: entry.isDirectory(), isFile: entry.isFile(), real: path.join(here, entry.name) });
			continue;
		}
		const stat = fs.statSync(file, { throwIfNoEntry: false });
		if (!stat) { onError({ path: file, broken: true }); continue; }
		const real = realPath(file);
		if (stat.isDirectory()) {
			const at = above.indexOf(real);
			if (at !== -1) { onError({ path: file, loop: above[at] }); continue; }
		}
		out.push({ name: entry.name, path: file, isDirectory: stat.isDirectory(), isFile: stat.isFile(), real });
	}
	return out;
}

/**
 * Every file below `dir` (links to folders aren't followed), by its path, with `only` choosing by name
 * before anything else is asked of it. One recursive listing: a 10,000-page output, a folder a
 * page, listed folder by folder took 220 ms and at once 111. A listing that fails part way (a
 * folder deleted meanwhile, as a build that cleans up deletes them) is done folder by folder
 * instead, which passes over what went.
 */
export function filesBelow(dir: string, only?: (name: string) => boolean): string[] {
	const out: string[] = [];
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
		// The listing goes into linked folders, and a walk of the output doesn't.
		const links = entries.filter((entry) => entry.isSymbolicLink()).map((entry) => path.join(entry.parentPath, entry.name));
		const below = (folder: string) => links.some((link) => folder === link || folder.startsWith(link + path.sep));
		for (const entry of entries) {
			if (entry.isFile() && (!only || only(entry.name)) && !(links.length && below(entry.parentPath))) out.push(path.join(entry.parentPath, entry.name));
		}
		return out;
	} catch {
		out.length = 0;
	}
	const visit = (folder: string) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) visit(file);
			else if (entry.isFile() && (!only || only(entry.name))) out.push(file);
		}
	};
	visit(dir);
	return out;
}
