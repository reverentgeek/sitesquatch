// `ssqch new`: a new page from a blueprint. Ported from `crates/sitesquatch/src/blueprint.rs`.
//
// A blueprint is a page to start from: a file in `_blueprints/` in the input folder (or a
// theme's), named after the folder its pages go in. `ssqch new posts/pine.md` copies
// `_blueprints/posts.md` (or `_blueprints/default.md`, or a title and a date when there's
// neither) and fills in its front matter: the `title`, the `date` when the blueprint has that
// key, and anything given with `--set`.
//
// A blueprint isn't a template. Its body is copied as it is, so it can hold `{{ }}` for the page
// itself, and only front matter keys are filled in: there's no second template syntax to learn
// or to clash with.
//
// Given a folder and a title (`ssqch new posts --title "Pine cones"`), the file is named as the
// folder's other pages are: with the date in front when most of them have one, and as
// `pine-cones/index.md` when most are folders with an index file.
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import { dirsOf, shownDir } from "../config.ts";
import { parseFrontMatter } from "../data.ts";
import { bail, context } from "../diagnostics.ts";
import { isDir, isFile, isInside, realPath, slashes } from "../paths.ts";
import { serdeFloat } from "../quote.ts";
import { slugWith } from "../slug.ts";
import { FIELD_NOTES } from "../voice.ts";

/** What to create. */
export interface NewOptions {
	/** The new file, from the input folder (`posts/pine.md`), or the folder it goes in (`posts`), with a `title` to name it after. */
	path: string;
	title?: string;
	/** The page's date, as it's written in front matter (default: today). */
	date?: string;
	/** The blueprint's name (default: the page's folders, then `default`). */
	blueprint?: string;
	/** More front matter: each key and the value as it's written (`draft`, `true`). */
	set: Array<[key: string, value: string]>;
}

/** What was created. */
export interface Created {
	path: string;
	/** The blueprint it came from; `null` for the built-in one. */
	blueprint: string | null;
	title: string;
	date: string;
	/** The folder had no pages to follow, and the site has `bundles`: a page with files of its own is a folder, which the file made isn't. */
	firstInBundles?: boolean;
}

/** Lowercase letters and digits, with a dash for each run of anything else. */
export const slug = (text: string): string => slugWith(text, "-", false);

/** `pine-cone_crunch` as a title: "Pine cone crunch". */
function titleFrom(name: string): string {
	const words = name.replace(/[-_]/g, " ").trim();
	return words === "" ? "" : words[0].toUpperCase() + words.slice(1);
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;

/** A path's extension and stem, as Rust's `Path::extension` and `file_stem` have them. */
function parts(file: string): { stem: string; ext: string | undefined } {
	const name = path.basename(file);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? { stem: name, ext: undefined } : { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

const entries = (dir: string): fs.Dirent[] => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

/** The template files in `dir`, and the folders in it with an index file (the index files). */
function pagesIn(config: Config, dir: string): { files: string[]; folders: string[] } {
	const isPage = (file: string) => {
		const ext = parts(file).ext;
		return ext !== undefined && config.templateFormats.some((f) => f.toLowerCase() === ext.toLowerCase());
	};
	const files: string[] = [], folders: string[] = [];
	for (const entry of entries(dir)) {
		const file = path.join(dir, entry.name);
		if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
		if (isDir(file)) {
			const index = entries(file).map((e) => path.join(file, e.name)).find((p) => parts(p).stem === "index" && isPage(p));
			if (index !== undefined) folders.push(index);
		} else if (isPage(file) && parts(file).stem !== "index") {
			files.push(file);
		}
	}
	return { files, folders };
}

/** Every file under `dir`, links left out, as 0.7's walk had them. */
function filesUnder(dir: string): string[] {
	const out: string[] = [];
	for (const entry of entries(dir)) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...filesUnder(file));
		else if (entry.isFile()) out.push(file);
	}
	return out;
}

/** The blueprint for a page in `folders` (`docs/guides`), with `ext` when there's a choice: the most specific folder's, then `default`. */
function findBlueprint(config: Config, root: string, named: string | undefined, folders: string, ext: string | undefined): string | null {
	const dirs = [dirsOf(config).input, ...config.themes].map((d) => path.join(d, "_blueprints"));
	const names: string[] = [];
	if (named !== undefined) names.push(named.replace(/^\/+|\/+$/g, ""));
	else {
		let rest = folders.replace(/^\/+|\/+$/g, "");
		while (rest !== "") {
			names.push(rest);
			const slash = rest.lastIndexOf("/");
			rest = slash === -1 ? "" : rest.slice(0, slash);
		}
		names.push("default");
	}
	for (const name of names) {
		for (const dir of dirs) {
			const at = path.join(dir, name);
			const found = entries(path.dirname(at)).filter((e) => parts(e.name).stem === path.basename(at)).map((e) => path.join(path.dirname(at), e.name)).filter(isFile).sort(); // a link to nothing isn't a blueprint, as in 0.7
			const wanted = found.find((p) => ext !== undefined && parts(p).ext?.toLowerCase() === ext.toLowerCase());
			const pick = wanted ?? found[0];
			if (pick !== undefined) return pick;
		}
	}
	if (named !== undefined) {
		const have = new Set<string>();
		for (const dir of dirs) {
			for (const file of filesUnder(dir)) {
				const rel = slashes(path.relative(dir, file));
				const dot = rel.lastIndexOf(".");
				have.add(dot > rel.lastIndexOf("/") + 1 ? rel.slice(0, dot) : rel);
			}
		}
		const shownDir = slashes(path.relative(root, dirs[0]));
		const list = [...have].sort();
		bail(`no blueprint named ${JSON.stringify(named)} in ${shownDir}/ (${list.length === 0 ? "there are none" : `there's ${list.join(", ")}`})`);
	}
	return null;
}

/** A string as a YAML value: as it is when that's safe, quoted when not. */
export function yamlString(text: string): string {
	const plain = /^\p{L}[\p{L}\p{N} _.,'()!?&/+-]*$/u;
	const word = ["true", "false", "null", "yes", "no", "on", "off", "y", "n"].includes(text.toLowerCase());
	// A JSON string is a YAML one too.
	return plain.test(text) && !word && !text.endsWith(" ") && !text.includes(" -") ? text : JSON.stringify(text);
}

/** A value for a key: text (quoted as the format needs), or written as given. */
export type Fill = { text: string } | { raw: string };
type FillRow = [key: string, fill: Fill, first: boolean];

/** The lines a TOML front matter's top-level entries take, and the line the first table starts on (or `close`). */
function tomlEntries(lines: string[], close: number): [Array<[number, number]>, number] {
	const found: Array<[number, number]> = [];
	let depth = 0;
	let multi: string | null = null;
	let start: number | null = null;
	for (let i = 1; i < close; i++) {
		const line = lines[i];
		if (depth === 0 && multi === null) {
			const text = line.trimStart();
			if (text.startsWith("[")) return [found, i];
			if (text !== "" && !text.startsWith("#")) start = i;
		}
		scan: for (let j = 0; j < line.length; j++) {
			if (multi !== null) {
				if (line.startsWith(multi, j)) { multi = null; j += 2; }
				else if (multi === "\"\"\"" && line[j] === "\\") j += 1;
				continue;
			}
			const c = line[j];
			switch (c) {
				case "#": break scan;
				case "\"": case "'": {
					const triple = c.repeat(3);
					if (line.startsWith(triple, j)) { multi = triple; j += 2; continue; }
					j += 1;
					while (j < line.length && line[j] !== c) j += c === "\"" && line[j] === "\\" ? 2 : 1;
					break;
				}
				case "[": case "{": depth++; break;
				case "]": case "}": depth--; break;
			}
		}
		if (depth <= 0 && multi === null) {
			depth = 0;
			if (start !== null) { found.push([start, i + 1]); start = null; }
		}
	}
	return [found, close];
}

/**
 * JSON as 0.7 read and wrote a blueprint's (serde_json, keeping the order): an object keeps its
 * keys in the file's order (a `Map`, since a JavaScript object puts `"2024"` first), and a number
 * is the text serde_json wrote for it, which keeps what a JavaScript number can't: a whole number
 * up to 64 bits (`12345678901234567890`), a float that's whole (`1.0`, and `1e5` is `100000.0`),
 * and `-0.0`.
 */
type Json = null | boolean | string | { number: string } | Json[] | Map<string, Json>;

/** Reads JSON as serde_json did. Throws what's wrong: `JSON.parse`'s words, or a number past a double's range. */
function readJson(text: string): Json {
	// JSON.parse says what's wrong with text that isn't JSON; what's left to read is JSON.
	JSON.parse(text);
	let i = 0;
	const space = () => {
		while (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r") i++;
	};
	const token = (re: RegExp) => {
		re.lastIndex = i;
		const found = re.exec(text)![0];
		i += found.length;
		return found;
	};
	const value = (): Json => {
		space();
		const c = text[i];
		if (c === "{" || c === "[") {
			i++;
			const close = c === "{" ? "}" : "]";
			const map = new Map<string, Json>(), list: Json[] = [];
			space();
			if (text[i] === close) { i++; return c === "{" ? map : list; }
			for (;;) {
				if (c === "{") {
					space();
					const key = JSON.parse(token(STRING)) as string;
					space();
					i++;
					map.set(key, value());
				} else list.push(value());
				space();
				if (text[i++] === close) return c === "{" ? map : list;
			}
		}
		if (c === "\"") return JSON.parse(token(STRING)) as string;
		const word = token(/true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y);
		if (word === "true" || word === "false") return word === "true";
		return word === "null" ? null : { number: serdeNumber(word) };
	};
	return value();
}

const STRING = /"(?:[^"\\]|\\.)*"/y;
const I64_MIN = -(2n ** 63n), U64_MAX = 2n ** 64n - 1n;

/** A JSON number as serde_json wrote it back: a whole number in 64 bits as it is, anything else as a double. */
function serdeNumber(text: string): string {
	if (!/[.eE]/.test(text)) {
		const n = BigInt(text);
		// serde_json read `-0` as the float -0.0.
		if (text.startsWith("-") ? n !== 0n && n >= I64_MIN : n <= U64_MAX) return n.toString();
	}
	const x = Number(text);
	if (!Number.isFinite(x)) throw new RangeError("number out of range");
	return serdeFloat(x);
}

/** JSON as serde_json's `to_string_pretty` wrote it: two spaces a level. */
function jsonText(v: Json, indent = ""): string {
	if (v === null || typeof v === "boolean") return String(v);
	if (typeof v === "string") return JSON.stringify(v);
	const inner = indent + "  ";
	if (v instanceof Map) return v.size === 0 ? "{}" : `{\n${[...v].map(([key, item]) => `${inner}${JSON.stringify(key)}: ${jsonText(item, inner)}`).join(",\n")}\n${indent}}`;
	if (Array.isArray(v)) return v.length === 0 ? "[]" : `[\n${v.map((item) => inner + jsonText(item, inner)).join(",\n")}\n${indent}]`;
	return v.number;
}

/**
 * Sets top-level keys in a page's front matter, keeping everything else (comments, the order,
 * the body) as it is. A key that isn't there is added: at the top when `first`, else at the end.
 */
export function fillFrontMatter(source: string, fills: FillRow[]): string {
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	const firstLine = (source.split("\n")[0] ?? "").replace(/\r$/, "").trimEnd();
	let format: "yaml" | "toml" | "json", fence: string;
	switch (firstLine) {
		case "+++": [format, fence] = ["toml", "+++"]; break;
		case "---toml": [format, fence] = ["toml", "---"]; break;
		case "---json": [format, fence] = ["json", "---"]; break;
		case "---": case "---yaml": case "---yml": [format, fence] = ["yaml", "---"]; break;
		// No front matter: give it one.
		default: return fillFrontMatter(`---${newline}---${newline}${source}`, fills);
	}
	const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	const closeAt = lines.slice(1).findIndex((l) => l.trimEnd() === fence);
	if (closeAt === -1) bail(`its front matter is missing the closing \`${fence}\``);
	let close = closeAt + 1;

	if (format === "json") {
		const text = lines.slice(1, close).join("");
		let data: Json;
		try { data = readJson(text.trim() === "" ? "{}" : text); } catch (e) { throw context(e, "its JSON front matter doesn't parse"); }
		if (!(data instanceof Map)) bail("its JSON front matter isn't an object");
		for (const [key, fill] of fills) {
			if ("text" in fill) data.set(key, fill.text);
			else { try { data.set(key, readJson(fill.raw)); } catch { data.set(key, fill.raw); } }
		}
		lines.splice(1, close - 1, jsonText(data).replace(/\n/g, newline) + newline);
		return lines.join("");
	}

	const toml = format === "toml";
	const written = (key: string, fill: Fill): string => {
		const value = "raw" in fill ? fill.raw : toml ? JSON.stringify(fill.text) : yamlString(fill.text);
		return `${key}${toml ? " = " : ": "}${value}${newline}`;
	};
	let atTop = 1;
	for (const [key, fill, first] of fills) {
		const starts = (line: string) => {
			const bare = line.replace(/^[ \t]+/, "");
			const rest = bare.startsWith(key) ? bare.slice(key.length) : bare.startsWith(`"${key}"`) ? bare.slice(key.length + 2) : undefined;
			return rest !== undefined && rest.trimStart().startsWith(toml ? "=" : ":");
		};
		if (toml) {
			// Only the keys above the first table are the page's own: `draft` under `[extra]` isn't.
			const [found, rootEnd] = tomlEntries(lines, close);
			const hit = found.find(([at]) => starts(lines[at]));
			if (hit) {
				const [at, end] = hit;
				lines.splice(at, end - at, written(key, fill));
				close -= end - at - 1;
				continue;
			}
			let line: number;
			if (first) line = atTop;
			else if (found.length) line = found[found.length - 1][1];
			else {
				line = rootEnd;
				while (line > 1 && lines[line - 1].trim() === "") line--;
			}
			if (first) atTop++;
			lines.splice(line, 0, written(key, fill));
			close++;
			continue;
		}
		const index = lines.slice(1, close).findIndex((l) => !/^[ \t]/.test(l) && starts(l));
		if (index !== -1) {
			const at = index + 1;
			// The lines of a value that goes on below its key.
			let end = at + 1;
			while (end < close && (/^[ \t]/.test(lines[end]) || lines[end].startsWith("- "))) end++;
			lines.splice(at, end - at, written(key, fill));
			close -= end - at - 1;
		} else if (first) {
			lines.splice(atTop, 0, written(key, fill));
			atTop++;
			close++;
		} else {
			// After the last line that isn't blank.
			let at = close;
			while (at > 1 && lines[at - 1].trim() === "") at--;
			lines.splice(at, 0, written(key, fill));
			close++;
		}
	}
	return lines.join("");
}

/** Whether the blueprint's front matter has `key` (so it's filled in). */
function hasKey(source: string, key: string): boolean {
	try { return Object.hasOwn(parseFrontMatter(source).data, key); } catch { return false; }
}

/** The path as pieces under `base`, or nothing when it climbs out or starts at a root. */
function under(base: string, given: string): string | undefined {
	let out = base;
	for (const part of given.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === ".." || (path.sep === "\\" && /^[A-Za-z]:/.test(part))) return undefined;
		out = path.join(out, part);
	}
	return given.startsWith("/") ? undefined : out;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Today's date, the local one, as front matter writes it. */
const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A blueprint's text, as it is (a byte-order mark included, as 0.7 kept it). Bytes that aren't
 * UTF-8 are an error, as they were in 0.7, rather than characters quietly replaced in the new
 * page. The error names the file as 0.7 did, from the input folder as the config gives it.
 */
function readBlueprint(file: string, blueprints: string, shownInput: string): string {
	const shown = isInside(blueprints, file) ? [shownInput, "_blueprints", path.relative(blueprints, file)].join(path.sep) : file;
	let bytes: Buffer;
	try { bytes = fs.readFileSync(file); } catch (e) { throw context(e, `reading ${shown}`); }
	try { return utf8.decode(bytes); } catch { return bail(`reading ${shown}: stream did not contain valid UTF-8`); }
}

/** Creates the page `options` describe. Nothing is overwritten. */
export function newPage(config: Config, options: NewOptions): Created {
	const dirs = dirsOf(config);
	let given = options.path.replace(/\\/g, "/");
	while (given.startsWith("./")) given = given.slice(2);
	if (given === "") bail("give the new page's path, like posts/pine-cones.md");
	// From the input folder, or from the project root when that lands in it.
	const shownInput = shownDir(config, config.input);
	let input: string;
	try { input = fs.realpathSync.native(dirs.input); } catch (e) { throw context(e, `input directory ${shownInput} does not exist`); }
	const root = realPath(dirs.root);
	const shownIn = (file: string) => slashes(path.relative(root, file));
	const fromInput = under(input, given);
	if (fromInput === undefined) bail(`${options.path}: a new page goes in the input folder (${slashes(path.relative(root, input))}/), so give a path from there`);
	const fromRoot = under(root, given);
	const target = fromRoot !== undefined && input !== root && (fromRoot === input || fromRoot.startsWith(input + path.sep)) ? fromRoot : fromInput!;
	const rel = slashes(path.relative(input, target));
	if (rel.split("/")[0].startsWith("_")) bail(`${options.path}: ${rel.split("/")[0]}/ isn't a folder for pages`);

	const date = options.date ?? today();
	const isFolder = given.endsWith("/") || isDir(target) || parts(target).ext === undefined;
	let file: string, blueprint: string | null, title: string;
	let firstInBundles = false;
	if (isFolder) {
		const given = options.title;
		if (given === undefined || given.trim() === "") bail(`${options.path} is a folder, so give the page a title to name its file after: ssqch new ${options.path.replace(/\/+$/, "")} --title "Pine cones"`);
		title = given!;
		const name = slug(title);
		if (name === "") bail(`--title ${JSON.stringify(title)} has no letters or digits to name the file after`);
		blueprint = findBlueprint(config, root, options.blueprint, rel, undefined);
		// Named as the folder's other pages are.
		const { files, folders } = pagesIn(config, target);
		// The blueprint's extension, or the one most of the folder's pages have.
		const counts: Array<[number, string]> = [];
		for (const found of [...files, ...folders].map((p) => parts(p).ext)) {
			if (found === undefined) continue;
			const row = counts.find(([, e]) => e === found);
			if (row) row[0]++;
			else counts.push([1, found]);
		}
		counts.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
		const ext = (blueprint === null ? undefined : parts(blueprint).ext) ?? counts[0]?.[1] ?? "md";
		const dated = [...files, ...folders].filter((p) => DATE_PREFIX.test(parts(p).stem === "index" ? path.basename(path.dirname(p)) : path.basename(p))).length;
		const day = date.slice(0, 10);
		const stem = dated * 2 > files.length + folders.length && DATE_PREFIX.test(`${day}-`) ? `${day}-${name}` : name;
		file = folders.length > files.length ? path.join(target, stem, `index.${ext}`) : path.join(target, `${stem}.${ext}`);
		firstInBundles = config.bundles && files.length + folders.length === 0;
	} else {
		const slash = rel.lastIndexOf("/");
		let folders = slash === -1 ? "" : rel.slice(0, slash);
		const { ext, stem } = parts(target);
		let name = stem;
		// `pine/index.md` is named by its folder, and for the blueprint it's a page of the folder above.
		if (stem === "index") {
			name = folders.slice(folders.lastIndexOf("/") + 1);
			folders = folders.includes("/") ? folders.slice(0, folders.lastIndexOf("/")) : "";
		}
		blueprint = findBlueprint(config, root, options.blueprint, folders, ext);
		title = options.title ?? titleFrom(name.replace(DATE_PREFIX, ""));
		file = target;
	}
	if (fs.existsSync(file)) {
		const another = isFolder ? "give it another --title" : "choose another file name";
		bail(`${shownIn(file)} already exists. Those tracks are taken; ${another} (the file is left as it is)`);
	}

	const source = blueprint !== null ? readBlueprint(blueprint, path.join(dirs.input, "_blueprints"), shownInput) : "---\ntitle:\ndate:\n---\n\n";
	const fills: FillRow[] = [["title", { text: title }, true]];
	// A date only where the blueprint asks for one: a page whose file name has the date doesn't need it.
	if (hasKey(source, "date") || options.date !== undefined) fills.push(["date", { raw: date }, false]);
	for (const [key, value] of options.set) {
		if (key === "" || /[.: =]/.test(key)) bail(`--set ${key}=${value}: the key is one front matter key, like draft=true`);
		fills.push([key, { raw: value }, false]);
	}
	let text: string;
	try {
		text = fillFrontMatter(source, fills);
	} catch (e) {
		throw context(e, blueprint !== null ? `in ${shownIn(realPath(blueprint))}` : "in the built-in blueprint");
	}
	try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { throw context(e, `creating ${path.dirname(file)}`); }
	try { fs.writeFileSync(file, text); } catch (e) { throw context(e, `writing ${file}`); }
	return { path: file, blueprint: blueprint === null ? null : realPath(blueprint), title, date, firstInBundles };
}

export interface NewCommand {
	path: string;
	title?: string;
	date?: string;
	blueprint?: string;
	set: string[];
	format: string;
}

/** `ssqch new`: creates the page and says what was made. Throws what went wrong. */
export function runNew(config: Config, command: NewCommand): void {
	if (command.format !== "text" && command.format !== "json") bail(`--format ${command.format}: use text or json`);
	const set: Array<[string, string]> = [];
	for (const pair of command.set) {
		const eq = pair.indexOf("=");
		if (eq === -1) bail(`--set ${pair}: give a key and a value, like --set draft=true`);
		set.push([pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()]);
	}
	const created = newPage(config, { path: command.path, title: command.title, date: command.date, blueprint: command.blueprint, set });
	const dirs = dirsOf(config);
	const root = realPath(dirs.root);
	const shown = (file: string) => slashes(path.relative(root, file));
	if (command.format === "json") {
		const out = { schemaVersion: 1, path: shown(created.path), blueprint: created.blueprint === null ? null : shown(created.blueprint), title: created.title, date: created.date };
		process.stdout.write(JSON.stringify(out, null, 2) + "\n");
		return;
	}
	const from = created.blueprint !== null ? shown(created.blueprint) : `the built-in blueprint (a title and a date; ${shown(realPath(dirs.input))}/_blueprints/ has none for it)`;
	const aside = config.quiet ? "" : ` ${FIELD_NOTES}`;
	process.stdout.write(`Created ${shown(created.path)} from ${from}.${aside}\n`);
	// The folder's first page is a file, as nothing says otherwise: with `bundles`, one that keeps its
	// photo beside it is a folder (Pack Mule's first trail tip). The next page follows the folder's.
	if (created.firstInBundles && !config.quiet) {
		const folder = shown(path.join(path.dirname(created.path), path.basename(created.path, path.extname(created.path)), `index${path.extname(created.path)}`));
		process.stdout.write(`note: the folder had no pages to follow, so this one is a file. With bundles, a page with files of its own (a photo) is a folder, ${folder}, and the next page made here follows whichever the folder has more of.\n`);
	}
}
