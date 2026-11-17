// The `ssqch` module that configs and data files import: `import { defineConfig } from "ssqch"`.
// Its exports are 0.7's, described in `ssqch.d.ts`.
import fs from "node:fs";
import path from "node:path";
import { BuildError } from "./diagnostics.ts";
import { loadStaticDataFile } from "./data.ts";
import { globBase, globToRegExp, isGlob } from "./glob.ts";
import { markdownEngine } from "./engines/markdown.ts";
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

export function markdown(text: unknown, options: { inline?: boolean } | null = {}): string {
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
	if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new BuildError(`readData(${JSON.stringify(rel)}): no such file`);
	const value = loadStaticDataFile(abs);
	if (value === undefined) throw new BuildError(`readData(${JSON.stringify(rel)}): not a JSON, YAML or TOML file`);
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
	if (options?.dimensions) throw new BuildError(`${call}: { dimensions } isn't in this build yet (it arrives with images, stage 5 of the move to Node)`);
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
	return found.map(([rel, abs, stat]) => {
		const name = path.basename(abs);
		const dot = name.lastIndexOf(".");
		const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot + 1).toLowerCase()] : [name, ""];
		// The URL a passthrough copy to the same path gets: from the input folder when it's inside it.
		const fromInput = site.input && abs.startsWith(site.input + path.sep) ? path.relative(site.input, abs).split(path.sep).join("/") : rel;
		const named = dateInName(name);
		return { path: rel, url: `/${fromInput}`, name, stem, ext, date: named ?? stat.mtime, dateFrom: named ? "name" : "modified", size: stat.size };
	});
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

export default { defineConfig, markdown, readData, files, slugify, slugger };
