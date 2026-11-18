// Front matter, data files and the data cascade's merge.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { parse as parseToml, TomlDate, TomlError } from "smol-toml";
import { BuildError, context } from "./diagnostics.ts";

export type Data = Record<string, any>;

/** An object written as `{ ... }` (or made with no prototype): what the cascade merges key by key. Dates, lists and class instances are values. */
export const isPlainObject = (v: unknown): v is Data => {
	if (v === null || typeof v !== "object") return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

/** JavaScript's `typeof`, as error messages name a value's type. */
export const typeOf = (v: unknown): string => typeof v;

// ---- front matter --------------------------------------------------------------------------

/**
 * Splits front matter from a template body: `---` YAML (or `---yaml`, `---json`, `---toml`), or
 * `+++` TOML. A file without front matter is all body.
 */
export function parseFrontMatter(src: string): { data: Data; body: string } {
	let format: "yaml" | "json" | "toml";
	let fence: string;
	let rest: string;
	if (src.startsWith("+++")) {
		[format, fence, rest] = ["toml", "+++", src.slice(3)];
	} else if (src.startsWith("---")) {
		rest = src.slice(3);
		const end = rest.search(/[\r\n]/);
		const lang = (end === -1 ? rest : rest.slice(0, end)).trim();
		if (lang === "" || lang === "yaml" || lang === "yml") format = "yaml";
		else if (lang === "json") format = "json";
		else if (lang === "toml") format = "toml";
		else return { data: {}, body: src };
		fence = "---";
		rest = end === -1 ? "" : rest.slice(end);
	} else {
		return { data: {}, body: src };
	}
	if (rest.startsWith("\r\n")) rest = rest.slice(2);
	else if (rest.startsWith("\n")) rest = rest.slice(1);
	else return { data: {}, body: src };
	// Closing fence: a line that is exactly `---` (or `+++`).
	let offset = 0;
	while (offset < rest.length) {
		const newline = rest.indexOf("\n", offset);
		const next = newline === -1 ? rest.length : newline + 1;
		if (rest.slice(offset, next).trimEnd() === fence) {
			const text = rest.slice(0, offset);
			// The body starts on the line after the fence, and blank lines there are kept, as
			// gray-matter keeps them.
			const body = rest.slice(next);
			if (format === "json") {
				let value: unknown;
				try { value = JSON.parse(text.trim() === "" ? "{}" : text); } catch (e) { throw new BuildError(`invalid JSON front matter: ${jsonReason(e, text)}`); }
				return { data: frontMatterObject(value, "JSON"), body };
			}
			if (format === "toml") {
				let value: unknown;
				try { value = readToml(text); } catch (e) { throw new BuildError(`invalid TOML front matter: ${tomlReason(e)}`); }
				return { data: frontMatterObject(value, "TOML"), body };
			}
			try { return { data: parseYaml(text), body }; } catch (e) { throw new BuildError(`invalid YAML front matter: ${yamlReason(e)}`); }
		}
		offset = next;
	}
	throw new BuildError(`front matter is missing its closing \`${fence}\``);
}

function frontMatterObject(v: unknown, format: string): Data {
	if (isPlainObject(v)) return v;
	throw new BuildError(`${format} front matter must be an object, not ${Array.isArray(v) || v === null ? "object" : typeof v}`);
}

// js-yaml's default schema with one change: its timestamps are made with `Date.UTC`, which
// reads the years 0 to 99 as 1900 to 1999 (`0099-12-31` was 1999). The 1900 years it added are
// taken back off, after any offset in the text has moved the date.
// (`@types/js-yaml` leaves out the built-in types, which js-yaml exports as `types`.)
type BuiltIn = yaml.Type & { resolve(text: string): boolean; construct(text: string): unknown; represent?: (value: object) => string };
const types = (yaml as unknown as { types: Record<"timestamp" | "merge" | "binary" | "omap" | "pairs" | "set", BuiltIn> }).types;
const timestamp = types.timestamp;
const YAML_SCHEMA = yaml.CORE_SCHEMA.extend({
	implicit: [
		new yaml.Type("tag:yaml.org,2002:timestamp", {
			kind: "scalar",
			resolve: timestamp.resolve,
			construct(text: string) {
				const date = timestamp.construct(text) as Date;
				if (Number(/^\d{4}/.exec(text)?.[0]) < 100) date.setUTCFullYear(date.getUTCFullYear() - 1900);
				return date;
			},
			instanceOf: Date,
			represent: timestamp.represent,
		}),
		types.merge,
	],
	explicit: [types.binary, types.omap, types.pairs, types.set],
});

/** YAML text as a value, by js-yaml's rules and with the years before 100 kept. */
export function loadYaml(text: string): unknown {
	return yaml.load(text, { schema: YAML_SCHEMA });
}

/** YAML as a site's data: an empty document is no data, and the top level is a mapping. */
export function parseYaml(src: string): Data {
	if (src.trim() === "") return {};
	const value = loadYaml(src);
	if (value === null || value === undefined) return {};
	if (isPlainObject(value)) return value;
	throw new BuildError("expected a mapping at the top level");
}

// A parser's error as one line that ends in where it is (`... at line 3 column 5`), which
// diagnostics read the line from.
function yamlReason(e: unknown): string {
	if (e instanceof yaml.YAMLException) {
		const where = e.mark ? ` at line ${e.mark.line + 1} column ${e.mark.column + 1}` : "";
		return `${e.reason}${where}`;
	}
	return e instanceof Error ? e.message : String(e);
}

function jsonReason(e: unknown, text: string): string {
	const message = e instanceof Error ? e.message : String(e);
	// V8 says `... in JSON at position 17 (line 1 column 18)`: keep what happened and where.
	const found = /^(.*?)(?: in JSON)? at position \d+ \(line (\d+) column (\d+)\)$/s.exec(message);
	if (found) return `${found[1]} at line ${found[2]} column ${found[3]}`;
	// For some mistakes it quotes the text and gives no place (`Unexpected token '}', "{"a": }" is
	// not valid JSON`): the place is found by reading the text again.
	const at = jsonErrorOffset(text);
	if (at === undefined) return message;
	const before = text.slice(0, at);
	const what = /^(Unexpected [^,]+|Unterminated [^,]+|Bad [^,]+)/.exec(message)?.[1] ?? message;
	return `${what} at line ${before.split("\n").length} column ${at - before.lastIndexOf("\n")}`;
}

/** Where JSON text first goes wrong (an offset into it), or nothing for text that's valid. */
export function jsonErrorOffset(text: string): number | undefined {
	let i = 0;
	const space = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
	// Each reader moves past one thing, or answers false where it stops being JSON.
	const value = (): boolean => {
		space();
		const c = text[i];
		if (c === "{") {
			i++;
			space();
			if (text[i] === "}") { i++; return true; }
			for (;;) {
				space();
				if (text[i] !== "\"" || !string()) return false;
				space();
				if (text[i] !== ":") return false;
				i++;
				if (!value()) return false;
				space();
				if (text[i] === ",") { i++; continue; }
				if (text[i] === "}") { i++; return true; }
				return false;
			}
		}
		if (c === "[") {
			i++;
			space();
			if (text[i] === "]") { i++; return true; }
			for (;;) {
				if (!value()) return false;
				space();
				if (text[i] === ",") { i++; continue; }
				if (text[i] === "]") { i++; return true; }
				return false;
			}
		}
		if (c === "\"") return string();
		const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 400));
		if (!literal) return false;
		i += literal[0].length;
		return true;
	};
	const string = (): boolean => {
		i++;
		for (; i < text.length; i++) {
			const c = text[i];
			if (c === "\"") { i++; return true; }
			if (c === "\\") {
				if (text[i + 1] === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return false; i += 5; }
				else if ("\"\\/bfnrt".includes(text[i + 1] ?? "!")) i++;
				else return false;
			} else if (c < " ") return false;
		}
		return false;
	};
	if (!value()) return i;
	space();
	return i < text.length ? i : undefined;
}

function tomlReason(e: unknown): string {
	if (e instanceof TomlError) {
		// The message is what's wrong, then a blank line and the lines around it.
		const what = e.message.split("\n")[0].replace(/^Invalid TOML document: /, "");
		return `${what} at line ${e.line} column ${e.column}`;
	}
	return e instanceof Error ? e.message : String(e);
}

/**
 * A TOML document as a site's data. An integer too big for a JavaScript number is a number
 * anyway, as 0.7 read it (rounded), where smol-toml would refuse the whole file.
 */
export function readToml(text: string): unknown {
	return tomlValue(parseToml(text, { integersAsBigInt: "asNeeded" }));
}

/**
 * A TOML value as a site's data. A date or time (`2024-01-02`, without quotes) is its text, as
 * 0.7 has it; the page's `date` becomes a real date either way.
 */
export function tomlValue(v: unknown): unknown {
	if (v instanceof TomlDate) return tomlDateText(v);
	if (Array.isArray(v)) return v.map(tomlValue);
	if (isPlainObject(v)) {
		const out: Data = {};
		for (const [key, value] of Object.entries(v)) out[key] = tomlValue(value);
		return out;
	}
	if (typeof v === "bigint") return Number(v);
	return v;
}

/** A TOML date as it's written: no fraction of a second unless it has one, and its zeros dropped. */
function tomlDateText(d: TomlDate): string {
	return d.toISOString().replace(/\.(\d*?)0+(?=$|Z|[+-]\d\d:\d\d$)/, (_, digits: string) => (digits ? `.${digits}` : ""));
}

// ---- data files ----------------------------------------------------------------------------

/**
 * Reads a text file without its UTF-8 byte-order mark, which editors and database exports (SQL
 * Server's JSON, Excel's CSV) put at the start, and which JSON, YAML and TOML parsers, front
 * matter and scripts don't expect.
 */
export function readText(file: string): string {
	return decodeText(fs.readFileSync(file));
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A file's bytes as text, without a byte-order mark. Bytes that aren't UTF-8 are an error, not characters quietly replaced. */
export function decodeText(bytes: Uint8Array): string {
	try {
		return stripBom(utf8.decode(bytes));
	} catch {
		throw new BuildError("stream did not contain valid UTF-8");
	}
}

export const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Loads a data file in a format the core doesn't read itself: JavaScript (`.js`, `.mjs`, `.cjs`, `.ts`). */
export type DataLoader = (file: string) => unknown | Promise<unknown>;

/** The value of a JSON, YAML or TOML data file. `undefined` means the format isn't one of those. */
export function loadStaticDataFile(file: string): unknown {
	const ext = path.extname(file).slice(1);
	const read = () => {
		try { return readText(file); } catch (e) { throw context(e, `reading ${file}`); }
	};
	if (ext === "json") {
		const text = read();
		try { return JSON.parse(text); } catch (e) { throw new BuildError(`invalid JSON in ${file}: ${jsonReason(e, text)}`); }
	}
	if (ext === "yaml" || ext === "yml") {
		const text = read();
		try { return loadYaml(text) ?? null; } catch (e) { throw new BuildError(`invalid YAML in ${file}: ${yamlReason(e)}`); }
	}
	if (ext === "toml") {
		const text = read();
		try { return readToml(text); } catch (e) { throw new BuildError(`invalid TOML in ${file}: ${tomlReason(e)}`); }
	}
	return undefined;
}

export const STATIC_DATA_EXTENSIONS = ["json", "yaml", "yml", "toml"];

/**
 * A data file's value: JSON, YAML or TOML, or one of the `extra` formats (JavaScript). The
 * answer is a promise only when the file's loader gave one, so sites without JavaScript data
 * stay on the synchronous path. `NOT_DATA` means the format isn't known.
 */
export function loadDataFile(file: string, extra: ReadonlyMap<string, DataLoader>): unknown | Promise<unknown> {
	const ext = path.extname(file).slice(1);
	if (STATIC_DATA_EXTENSIONS.includes(ext)) return loadStaticDataFile(file);
	const load = extra.get(ext);
	return load ? load(file) : NOT_DATA;
}

/** What `loadDataFile` answers for a file in a format nothing reads. */
export const NOT_DATA = Symbol("not a data file");

// ---- the cascade's merge -------------------------------------------------------------------

/** Top-level keys that a deeper level replaces even when they're lists: `render` is an engine chain, not a list to add to, so a page's `render: [njk]` replaces its folder's `[mdit]`. */
const REPLACED = new Set(["render"]);

/**
 * `over` merged onto `base`, as a new object: objects merge key by key and lists are joined;
 * everything else, or everything when `deep` is false, is replaced. Neither argument is
 * changed, and values that aren't merged are shared, not copied.
 */
export function merge(base: Data, over: Data, deep = true): Data {
	return mergeLevel(base, over, deep, true);
}

function mergeLevel(base: Data, over: Data, deep: boolean, top: boolean): Data {
	const out: Data = { ...base };
	for (const key of Object.keys(over)) {
		const existing = out[key], incoming = over[key];
		if (deep && isPlainObject(existing) && isPlainObject(incoming)) out[key] = mergeLevel(existing, incoming, deep, false);
		else if (deep && Array.isArray(existing) && Array.isArray(incoming) && !(top && REPLACED.has(key))) out[key] = existing.concat(incoming);
		else out[key] = incoming;
	}
	return out;
}

/** `tags: posts` and `tags: [a, b]` both become a list of strings, each once. Changes `data`. */
export function normalizeTags(data: Data): void {
	if (!("tags" in data)) return;
	const value = data.tags;
	let tags: string[];
	if (typeof value === "string") tags = [value];
	else if (Array.isArray(value)) tags = value.filter((v) => v !== null && v !== undefined).map(tagName);
	else if (value === null || value === undefined) tags = [];
	else tags = [tagName(value)];
	data.tags = [...new Set(tags)];
}

/**
 * A tag's name. YAML reads `tags: [2024-01-01]` as a date, and a date's own text is in the
 * machine's time zone: the tag is the date as it was written (`2024-01-01`), or ISO 8601 when it
 * has a time.
 */
function tagName(value: unknown): string {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) return String(value);
	const iso = value.toISOString();
	return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/** Whether two values are the same for a list's `filter`: the same value, or dates at the same moment. */
export function sameValue(a: unknown, b: unknown): boolean {
	return a === b || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());
}

/** Reads `a.b.c` from a value: each part is a key (or a list's index). */
export function getPath(value: unknown, dotted: string): unknown {
	let v: any = value;
	for (const key of dotted.split(".")) {
		if (v === null || v === undefined) return undefined;
		v = v[key];
	}
	return v;
}

// ---- dates ---------------------------------------------------------------------------------

/**
 * A value as a date: dates pass through, numbers are milliseconds, and strings are ISO 8601,
 * `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM:SS` (with a space or a `T`), read as UTC when they name no
 * zone. Nothing here depends on the machine's time zone. `undefined` for anything else.
 */
export function toDate(value: unknown): Date | undefined {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
	if (typeof value === "number") {
		const d = new Date(Math.trunc(value));
		return Number.isNaN(d.getTime()) ? undefined : d;
	}
	if (typeof value === "string") return parseDate(value);
	return undefined;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
// Without a zone, the parts can be written loosely (`2024-1-5`, `+2024-06-01`), as 0.7 read them.
const DATE_ONLY = /^([+-]?\d{1,6})-(\d{1,2})-(\d{1,2})$/;
const NAIVE = /^([+-]?\d{1,6})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(\.\d+)?)?$/;

export function parseDate(text: string): Date | undefined {
	const s = text.trim();
	let m = RFC3339.exec(s);
	if (m) {
		const utc = utcMs(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
		if (utc === undefined) return undefined;
		const zone = m[8];
		let offset = 0;
		if (zone !== "Z" && zone !== "z") {
			const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6));
			offset = (zone[0] === "-" ? -minutes : minutes) * 60_000;
		}
		return new Date(utc - offset);
	}
	m = DATE_ONLY.exec(s);
	if (m) {
		const utc = utcMs(m[1], m[2], m[3]);
		return utc === undefined ? undefined : new Date(utc);
	}
	m = NAIVE.exec(s);
	if (m) {
		// `2024-06-01 10:00` has no seconds; a fraction comes only with a `T`.
		if (m[7] !== undefined && !s.includes("T")) return undefined;
		if (m[6] === undefined && s.includes("T")) return undefined;
		const utc = utcMs(m[1], m[2], m[3], m[4], m[5], m[6] ?? "0", m[7]);
		return utc === undefined ? undefined : new Date(utc);
	}
	return undefined;
}

function utcMs(y: string, mo: string, d: string, h = "0", mi = "0", s = "0", fraction?: string): number | undefined {
	const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
	if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 60) return undefined;
	const date = new Date(0);
	// `setUTCFullYear` takes the year as it is (`Date.UTC` reads 24 as 1924).
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(hour, minute, Math.min(second, 59), fraction ? Math.floor(Number(`0${fraction}`) * 1000) : 0);
	// A day the month doesn't have (`2024-02-30`) isn't a date.
	if (date.getUTCDate() !== day || Number.isNaN(date.getTime())) return undefined;
	return date.getTime();
}
