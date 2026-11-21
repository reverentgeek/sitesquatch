// The `ssqch` module that configs and data files import: `import { defineConfig } from "ssqch"`.
// Its exports are 0.7's, described in `ssqch.d.ts`.
import fs from "node:fs";
import path from "node:path";
import { BuildError } from "./diagnostics.ts";
import { loadStaticDataFile } from "./data.ts";
import { globBase, globProblem, globToRegExp, isGlob } from "./glob.ts";
import { imageSize } from "./image/header.ts";
import { markdownEngine } from "./engines/markdown.ts";
import { safe } from "./rendering.ts";
import { defaultMarkdownOptions } from "./markdown-options.ts";
import { slugify as slug } from "./slug.ts";

function defaultMarkdown() {
	const engine = markdownEngine(defaultMarkdownOptions());
	return (text: string, inline: boolean) => engine.plain(text, inline);
}

/**
 * What the functions here need from the site being built: its root (paths are from there), its
 * input folder, and its Markdown. The build sets these before it runs any of the site's code.
 */
export const site: { root: string; input: string | null; markdown: ((text: string, inline: boolean) => string) | null } = { root: process.cwd(), input: null, markdown: null };

export const defineConfig = <T>(config: T): T => config;

export function markdown(text: unknown, options: { inline?: boolean } | "inline" | null = {}): string {
	// `markdown(text, "inline")`, as the template function takes it.
	if (options === "inline") options = { inline: true };
	if (typeof options === "string") throw new TypeError(`markdown(): unknown option "${options}" (give "inline", or { inline: true })`);
	for (const key of Object.keys(options ?? {})) {
		if (key !== "inline") throw new TypeError(`markdown(): unknown option "${key}" (options: inline)`);
	}
	// Before the first build (while the config loads), Markdown has its default options.
	site.markdown ??= defaultMarkdown();
	return site.markdown(String(text ?? ""), Boolean(options?.inline));
}

/** `readData("src/_data/sites/en.yml")`: a JSON, YAML or TOML file, from the project root. */
export function readData(file: unknown): unknown {
	const rel = String(file);
	const abs = path.resolve(site.root, rel);
	const call = `readData(${JSON.stringify(rel)})`;
	// The kind of file first, as 0.7 checked it: a folder, or a name without one of these endings, isn't data.
	if (!/\.(json|ya?ml|toml)$/i.test(rel)) throw new BuildError(`${call}: not a JSON, YAML or TOML file`);
	if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new BuildError(`${call}: no such file (reading ${abs})`);
	const value = loadStaticDataFile(abs);
	if (value === undefined) throw new BuildError(`${call}: not a JSON, YAML or TOML file`);
	return value;
}

export interface FileInfo {
	path: string;
	url: string;
	name: string;
	stem: string;
	ext: string;
	date: Date;
	dateFrom: "name" | "modified";
	size: number;
	width?: number | null;
	height?: number | null;
}

/**
 * `files("images/albums/v1/*.{jpg,png}")`: the files under the project root that a glob matches
 * (ignoring case), sorted by path.
 */
export function files(pattern: unknown, options: { dimensions?: boolean } | null = {}): FileInfo[] {
	for (const key of Object.keys(options ?? {})) {
		if (key !== "dimensions") throw new TypeError(`files(): unknown option "${key}" (options: dimensions)`);
	}
	const given = String(pattern ?? "");
	const call = `files(${JSON.stringify(given)})`;
	const glob = given.trim().replace(/^(\.\/)+/, "");
	if (glob === "") throw new BuildError(`${call}: give a glob, like files("images/*.jpg")`);
	if (path.isAbsolute(glob) || glob.split("/").includes("..")) throw new BuildError(`${call}: the glob is from the project root, and can't leave it`);
	const problem = globProblem(glob);
	if (problem) throw new BuildError(`${call}: not a glob (error parsing glob '${glob}': ${problem})`);
	const matches = globToRegExp(glob, { ignoreCase: true });
	// Walk only below the part of the pattern without wildcards.
	const base = isGlob(glob) ? globBase(glob) : path.posix.dirname(glob) === "." ? "" : path.posix.dirname(glob);
	const found: Array<[string, string, fs.Stats]> = [];
	const walk = (dir: string, rel: string) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const abs = path.join(dir, entry.name);
			const p = rel ? `${rel}/${entry.name}` : entry.name;
			const stat = fs.statSync(abs, { throwIfNoEntry: false });
			if (!stat) continue;
			if (stat.isDirectory()) walk(abs, p);
			else if (stat.isFile() && entry.name !== ".DS_Store" && matches.test(p)) found.push([p, abs, stat]);
		}
	};
	walk(path.join(site.root, base), base);
	found.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	const sizes = options?.dimensions ? imageSizes(found) : [];
	return found.map(([rel, abs, stat], i) => {
		const name = path.basename(abs);
		const dot = name.lastIndexOf(".");
		const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot + 1).toLowerCase()] : [name, ""];
		// The URL a passthrough copy to the same path gets: from the input folder when it's inside it.
		const fromInput = site.input && abs.startsWith(site.input + path.sep) ? path.relative(site.input, abs).split(path.sep).join("/") : rel;
		const named = dateInName(name);
		const info: FileInfo = { path: rel, url: `/${fromInput}`, name, stem, ext, date: named ?? stat.mtime, dateFrom: named ? "name" : "modified", size: stat.size };
		if (options?.dimensions) [info.width, info.height] = sizes[i] ?? [null, null];
		return info;
	});
}

/** Where image sizes are kept between builds, by path, size and modification time (0.7's file and format). */
const SIZES_CACHE = ".cache/ssqch/image-sizes.json";

/**
 * Each file's width and height, from the cache when its size and modification time haven't
 * changed, otherwise from its header. New sizes go back in the cache. `undefined` for a file
 * that isn't an image.
 */
function imageSizes(found: Array<[string, string, fs.Stats]>): Array<[number, number] | undefined> {
	const file = path.join(site.root, SIZES_CACHE);
	// `[size, modified, [width, height] or null]` by path. The modification time is in
	// nanoseconds, past what a JavaScript number holds, so numbers are kept as their digits.
	let cache: Record<string, [string, string, [string, string] | null]> = {};
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"), (_key, value, context?: { source?: string }) => (typeof value === "number" ? context?.source ?? String(value) : value));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cache = parsed;
	} catch { /* no cache yet, or a broken one: read every file */ }
	let changed = false;
	const sizes = found.map(([rel, abs]) => {
		const stat = fs.statSync(abs, { bigint: true, throwIfNoEntry: false });
		const stamp: [string, string] = [String(stat?.size ?? 0), String(stat?.mtimeNs ?? 0)];
		const kept = cache[rel];
		if (Array.isArray(kept) && kept[0] === stamp[0] && kept[1] === stamp[1]) {
			const size = kept[2];
			return Array.isArray(size) ? ([Number(size[0]), Number(size[1])] as [number, number]) : undefined;
		}
		const size = imageSize(abs);
		cache[rel] = [stamp[0], stamp[1], size ? [String(size[0]), String(size[1])] : null];
		changed = true;
		return size;
	});
	if (changed) {
		const json = `{${Object.entries(cache).map(([rel, [size, modified, dims]]) => `${JSON.stringify(rel)}:[${size},${modified},${dims ? `[${dims[0]},${dims[1]}]` : "null"}]`).join(",")}}`;
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, json);
		} catch { /* a cache that can't be written only costs time */ }
	}
	return sizes;
}

/** A date at the start of a file name: `2001-12-22-camp.jpg` or `20011222_08.JPG`, at midnight UTC. */
export function dateInName(name: string): Date | undefined {
	const compact = /^(\d{4})(\d{2})(\d{2})(?!\d)/.exec(name);
	const dashed = /^(\d{4})-(\d{2})-(\d{2})/.exec(name);
	const found = compact ?? dashed;
	if (!found) return undefined;
	const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	// A month or a day that doesn't exist isn't a date.
	return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

export function slugify(text: unknown, options?: unknown): string {
	return slug(text, options);
}

/** A `slugify` that remembers what it gave: a repeat gets `-1`, `-2`, and never a slug it has given. */
export function slugger(options: unknown = {}): (text: unknown) => string {
	const separator = slugify("a b", options).slice(1, -1);
	const seen = new Map<string, number>();
	return (text) => {
		const base = slugify(text, options);
		if (!seen.has(base)) {
			seen.set(base, 0);
			return base;
		}
		let n = seen.get(base)!;
		let made: string;
		do {
			n++;
			made = `${base}${separator}${n}`;
		} while (seen.has(made));
		seen.set(base, n);
		seen.set(made, 0);
		return made;
	};
}

export { safe } from "./rendering.ts";
export default { defineConfig, markdown, readData, files, slugify, slugger, safe };
