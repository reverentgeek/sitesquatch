// Front matter, data files and the data cascade's merge.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { parse as parseToml, TomlDate, TomlError } from "smol-toml";
import { BuildError, context } from "./diagnostics.ts";

/**
 * The build's time: `now()` in templates, and the date of a page that has none of its own.
 * `SOURCE_DATE_EPOCH` (seconds since 1970, the reproducible-builds convention, which Jekyll's
 * `time:` is for too) pins it, so two builds of the same files write the same pages.
 */
export function buildTime(): Date {
	const epoch = sourceDateEpoch();
	return epoch === undefined ? new Date() : new Date(epoch);
}

/** `SOURCE_DATE_EPOCH` in milliseconds, if it's set. */
export function sourceDateEpoch(): number | undefined {
	const value = process.env.SOURCE_DATE_EPOCH;
	if (value === undefined || value === "") return undefined;
	if (!/^\d+$/.test(value.trim())) throw new BuildError(`SOURCE_DATE_EPOCH must be whole seconds since 1970 (like 1767225600 for 2026-01-01), not "${value}"`);
	return Number(value.trim()) * 1000;
}

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
export function parseFrontMatter(src: string): { data: Data; body: string; duplicate?: { key: string; line: number } } {
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
			try { return { data: parseYaml(text), body }; } catch (e) {
				// A key written twice (a translation that kept the English `title:`): the last one
				// wins, as in Jekyll (Ruby's YAML), and the page says which (www.ruby-lang.org's 4 posts).
				if (e instanceof yaml.YAMLException && /duplicated mapping key/.test(e.reason)) {
					try {
						const value = yaml.load(text, { schema: YAML_SCHEMA, json: true });
						const line = e.mark ? e.mark.line + 1 : 0;
						const key = e.mark ? /^\s*["']?([^"':]+)["']?\s*:/.exec(text.split("\n")[e.mark.line] ?? "")?.[1]?.trim() : undefined;
						return { data: frontMatterObject(value ?? {}, "YAML"), body, duplicate: { key: key ?? "", line } };
					} catch { /* the error below says what's wrong */ }
				}
				const hint = colonHint(e, text);
				throw new BuildError(`invalid YAML front matter: ${hint ? `${hint} (${yamlReason(e)})` : yamlReason(e)}`);
			}
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
				// A day that doesn't exist (`2026-02-30`) stays text, as 0.7 kept it, where js-yaml
				// would roll it over to March 2: a schema can say so, and nothing moves silently.
				const [year, month, day] = text.slice(0, 10).split("-").map(Number);
				const real = new Date(Date.UTC(2000, month - 1, day));
				if (month < 1 || month > 12 || real.getUTCMonth() !== month - 1 || (month === 2 && day === 29 && !leapYear(year))) return text;
				if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text.trim())) return dayDate(year, month, day);
				const date = timestamp.construct(text) as Date;
				if (year < 100) date.setUTCFullYear(date.getUTCFullYear() - 1900);
				return date;
			},
			instanceOf: Date,
			represent: timestamp.represent,
		}),
		types.merge,
	],
	explicit: [types.binary, types.omap, types.pairs, types.set],
});

const leapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

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
/**
 * What to do about the YAML mistake a second author makes first: a plain value with `: ` inside
 * (`summary: Hours: early mornings`), which js-yaml calls "bad indentation of a mapping entry".
 * Empty for any other mistake. It has no line number: the reason after it has the one the excerpt is found by.
 */
function colonHint(e: unknown, text: string): string {
	if (!(e instanceof yaml.YAMLException) || !e.mark || !/bad indentation of a mapping entry/.test(e.reason)) return "";
	const found = /^\s*([\w.-]+):[ \t]+([^"'\s[{|>&*!#-][^#]*?:[ \t].*?)\s*$/.exec(text.split("\n")[e.mark.line] ?? "");
	if (!found) return "";
	const [, key, value] = found;
	return `${key}'s value has a ": " in it, so YAML reads it as another key; put the value in quotes: ${key}: ${JSON.stringify(value)}`;
}

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

export function tomlReason(e: unknown): string {
	if (e instanceof TomlError) {
		// The message is what's wrong, then a blank line and the lines around it.
		const what = e.message.split("\n")[0].replace(/^Invalid TOML document: /, "");
		return `${what} at line ${e.line} column ${e.column}`;
	}
	return e instanceof Error ? e.message : String(e);
}

/**
 * A TOML document as a site's data, as 0.7's TOML library read it. An integer too big for a
 * JavaScript number is a number anyway (rounded), where smol-toml would refuse the whole file,
 * but one past 64 bits is an error, and so is a float too big for one (`1e400`). A date or a time
 * is its text as 0.7 wrote it, and one that can't be (`2023-02-30`) is an error, where JavaScript's
 * dates would roll it over to March; a leap second (`23:59:60`) is fine.
 */
export function readToml(text: string): unknown {
	// smol-toml reads a date as a JavaScript date, so its own text is gone by the time it's
	// read, and its seconds stop at 59. So each date is checked here, as 0.7's library checked it,
	// and handed to smol-toml as a string that stands for it, of the same length where it fits,
	// so the columns in smol-toml's errors stay right.
	const values = bareValues(text);
	let problem: TomlError | undefined;
	const dates: string[] = [];
	let marker = "";
	let replaced = "";
	let last = 0;
	for (const { start, end } of values) {
		const literal = text.slice(start, end);
		const why = DATE_TIME.test(literal) ? dateProblem(literal) : numberProblem(literal);
		if (why === null) continue;
		if (why !== undefined) {
			problem ??= new TomlError(why, { toml: text, ptr: start });
			continue;
		}
		if (!marker) marker = placeholder(text);
		const stand = marker + dates.length.toString(36);
		replaced += text.slice(last, start) + JSON.stringify(stand.padEnd(Math.max(stand.length, literal.length - 2), marker));
		last = end;
		dates.push(dateText(literal));
	}
	let parsed: unknown;
	try {
		parsed = parseToml(dates.length ? replaced + text.slice(last) : text, { integersAsBigInt: "asNeeded" });
	} catch (e) {
		// The first problem in the file is the one to report, as 0.7's parser stopped there, and
		// a date's own words when smol-toml stops at the same place.
		if (problem && !(e instanceof TomlError && (e.line < problem.line || (e.line === problem.line && e.column < problem.column)))) throw problem;
		throw e;
	}
	if (problem) throw problem;
	return tomlValue(parsed, marker, dates);
}

/** A character for a document's dates to stand for themselves as, in strings: a private-use one the document doesn't have. */
function placeholder(text: string): string {
	for (let code = 0xe000; code <= 0xf8ff; code++) if (!text.includes(String.fromCharCode(code))) return String.fromCharCode(code);
	throw new Error("a TOML document with every private-use character can't have dates");
}

/** A TOML date, a date and time, or a time, as the format writes them (TOML 1.1: seconds optional). */
const DATE_TIME = /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/** What's wrong with a date or time that's written right, in the words of 0.7's TOML library (toml_datetime), or nothing. */
function dateProblem(literal: string): string | undefined {
	const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(literal);
	if (date) {
		const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
		if (month < 1 || month > 12) return "invalid date, expected month between 01 and 12";
		const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
		const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
		if (day < 1 || day > days) return `invalid date, expected day between 01 and ${days}`;
	}
	const time = /(?:^|[Tt ])(\d{2}):(\d{2})(?::(\d{2}))?/.exec(literal);
	if (time) {
		if (Number(time[1]) > 23) return "invalid time, expected hour between 00 and 23";
		if (Number(time[2]) > 59) return "invalid time, expected minute between 00 and 59";
		// 60 is a leap second.
		if (Number(time[3] ?? 0) > 60) return "invalid time, expected second between 00 and 60";
	}
	const offset = /[+-](\d{2}):(\d{2})$/.exec(date && time ? literal.slice(10) : "");
	if (offset) {
		if (Number(offset[1]) > 23) return "invalid offset, expected hours between 00 and 23";
		if (Number(offset[2]) > 59) return "invalid offset, expected minutes between 00 and 59";
	}
	return undefined;
}

/**
 * What's wrong with a number 0.7 couldn't hold, or `null` for a value that isn't a date: an
 * integer past 64 bits, or a float past the largest double. smol-toml takes both (the integer as
 * a BigInt, the float as `Infinity`).
 */
function numberProblem(literal: string): string | null {
	const plain = literal.replaceAll("_", "");
	if (/^[+-]?\d+$|^0[xob][0-9a-fA-F]+$/.test(plain)) {
		let n: bigint;
		try { n = BigInt(plain); } catch { return null; }
		return n > 0x7fffffffffffffffn || n < -0x8000000000000000n ? "integer number overflowed" : null;
	}
	if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(plain) && !Number.isFinite(Number(plain))) return "floating-point number overflowed";
	return null;
}

/** A date or time as 0.7 wrote it (toml_datetime's `Display`): a `T` between date and time, at most nine digits of a second, and `Z` or `+HH:MM`. */
function dateText(literal: string): string {
	const m = /^(\d{4}-\d{2}-\d{2})?[Tt ]?(?:(\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?)?([Zz]|[+-]\d{2}:\d{2})?$/.exec(literal)!;
	const [, date, hm, seconds, fraction, offset] = m;
	let out = date ?? "";
	if (hm !== undefined) {
		out += (date ? "T" : "") + hm;
		if (seconds !== undefined) out += `:${seconds}`;
		if (fraction !== undefined) out += `.${fraction.slice(0, 9).padEnd(9, "0").replace(/0+$/, "") || "0"}`;
	}
	// An offset of zero minutes is `+00:00`, however it's written, as 0.7 wrote it.
	if (offset !== undefined) out += /^[Zz]$/.test(offset) ? "Z" : offset.slice(1) === "00:00" ? "+00:00" : offset;
	return out;
}

/**
 * Where a TOML document's bare values are (numbers, booleans, dates and times): what comes after
 * a key's `=`, or in an array or an inline table, outside strings and comments. What doesn't
 * read as TOML is skipped, for smol-toml to report.
 */
function bareValues(text: string): Array<{ start: number; end: number }> {
	const found: Array<{ start: number; end: number }> = [];
	const n = text.length;
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	const space = () => {
		while (text[i] === " " || text[i] === "\t") i++;
	};
	// Space, line breaks and comments, as arrays and inline tables can have.
	const blank = () => {
		for (;;) {
			space();
			if (text[i] === "#") while (i < n && text[i] !== "\n") i++;
			else if (text[i] === "\n" || text[i] === "\r") i++;
			else return;
		}
	};
	const string = () => {
		const q = text[i];
		const fence = q.repeat(3);
		if (text.startsWith(fence, i)) {
			for (i += 3; i < n; i++) {
				if (q === "\"" && text[i] === "\\") i++;
				else if (text.startsWith(fence, i)) {
					// Up to two more quotes are the string's own.
					i += 3;
					for (let extra = 0; extra < 2 && text[i] === q; extra++) i++;
					return;
				}
			}
			return;
		}
		for (i++; i < n && text[i] !== q && text[i] !== "\n"; i++) if (q === "\"" && text[i] === "\\") i++;
		i++;
	};
	// A key, dotted or quoted, up to its `=`.
	const key = () => {
		for (;;) {
			space();
			if (i >= n || text[i] === "=" || text[i] === "\n" || text[i] === "#") return;
			if (text[i] === "\"" || text[i] === "'") string();
			else i++;
		}
	};
	const ENDS = " \t\r\n,]}#";
	const value = () => {
		const c = text[i];
		if (c === "\"" || c === "'") return string();
		if (c === "[" || c === "{") {
			const close = c === "[" ? "]" : "}";
			for (i++; ;) {
				blank();
				if (i >= n) return;
				if (text[i] === close) { i++; return; }
				if (close === "}") {
					key();
					if (text[i] !== "=") return;
					i++;
					space();
				}
				value();
				blank();
				if (text[i] === ",") i++;
				else if (text[i] === close) { i++; return; } else return;
			}
		}
		const start = i;
		while (i < n && !ENDS.includes(text[i])) i++;
		// A date and its time can be apart by a space.
		if (i - start === 10 && text[i] === " " && /^\d{4}-\d{2}-\d{2}$/.test(text.slice(start, i)) && /^\d{2}:/.test(text.slice(i + 1, i + 4))) {
			for (i++; i < n && !ENDS.includes(text[i]); i++);
		}
		if (i > start) found.push({ start, end: i });
	};
	while (i < n) {
		blank();
		if (i >= n) break;
		// A table's name: skipped, quoted parts and all.
		if (text[i] === "[") {
			while (i < n && text[i] !== "\n" && text[i] !== "#") {
				if (text[i] === "\"" || text[i] === "'") string();
				else i++;
			}
			continue;
		}
		key();
		if (text[i] !== "=") {
			while (i < n && text[i] !== "\n") i++;
			continue;
		}
		i++;
		space();
		value();
	}
	return found;
}

/**
 * A TOML value as a site's data. A date or time (`2024-01-02`, without quotes) is its text, as
 * 0.7 has it; the page's `date` becomes a real date either way. `marker` and `dates` are the
 * strings `readToml` handed smol-toml for the document's dates, and the text each stands for.
 */
export function tomlValue(v: unknown, marker = "", dates: string[] = []): unknown {
	if (typeof v === "string") return marker && v.startsWith(marker) ? dates[parseInt(v.replaceAll(marker, ""), 36)] : v;
	if (v instanceof TomlDate) return tomlDateText(v);
	if (Array.isArray(v)) return v.map((item) => tomlValue(item, marker, dates));
	if (isPlainObject(v)) {
		// A table's keys in name order, as 0.7's TOML library sorted them (a loop over a TOML
		// file's table gave the same order there); TOML itself says tables have none.
		const out: Data = {};
		for (const key of Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) setOwn(out, key, tomlValue((v as Data)[key], marker, dates));
		return out;
	}
	if (typeof v === "bigint") return Number(v);
	return v;
}

/**
 * Sets `key` on `target` as its own property, `__proto__` included: assigning that one sets the
 * object's prototype instead, which drops the key and lets its values show through every key
 * the object doesn't have.
 */
export function setOwn(target: Data, key: string, value: unknown): void {
	if (key === "__proto__") Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
	else target[key] = value;
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
		// `out.__proto__` would be Object.prototype, not a value of the data's.
		const existing = key === "__proto__" && !Object.hasOwn(out, key) ? undefined : out[key], incoming = over[key];
		// A key named `__proto__` is data like any other (setOwn), as in 0.7.
		if (deep && isPlainObject(existing) && isPlainObject(incoming)) setOwn(out, key, mergeLevel(existing, incoming, deep, false));
		else if (deep && Array.isArray(existing) && Array.isArray(incoming) && !(top && REPLACED.has(key))) setOwn(out, key, existing.concat(incoming));
		else setOwn(out, key, incoming);
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
	const iso = shownAsUtc(value).toISOString();
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
 * A date written without a time (`date: 2026-11-02`) is that day wherever it's read (the owner,
 * 2026-11-24, after the Squatch Snacks rerun: a page dated November 2 said November 1 west of
 * UTC). It's midnight in the site's `timeZone`, so a site's own `Date` code (`toLocaleDateString()`,
 * `getDate()`) prints the day as written, and midnight UTC without one, as it always was. ssqch's
 * own printers (`dateformat`, Liquid's `date`, the feed and sitemap dates, a date printed as
 * text) take `shownAsUtc()` first, so they print the written day too: the same text as before in
 * every zone, and nothing that depends on Node's time-zone data.
 */
const WRITTEN_DAY = new WeakMap<Date, { day: number; ms: number }>();
let localDays = false;

/** Whether a date without a time is midnight in the site's zone: on when the config sets `timeZone`. */
export function setLocalDays(on: boolean): void {
	localDays = on;
}

/** The day `year`-`month`-`day` (month from 1) as a date without a time: midnight in the site's zone, or UTC. */
export function dayDate(year: number, month: number, day: number): Date {
	const date = new Date(0);
	if (localDays) {
		// The local setters take the year as it is, as `setUTCFullYear` does (`Date.UTC` reads 24 as 1924).
		date.setFullYear(year, month - 1, day);
		date.setHours(0, 0, 0, 0);
	} else {
		date.setUTCFullYear(year, month - 1, day);
		date.setUTCHours(0, 0, 0, 0);
	}
	const utc = new Date(0);
	utc.setUTCFullYear(year, month - 1, day);
	WRITTEN_DAY.set(date, { day: utc.getTime(), ms: date.getTime() });
	return date;
}

/** For a date written without a time, its day at midnight UTC (what ssqch prints); any other date as it is. A date changed since it was read is a moment. */
export function shownAsUtc(d: Date): Date {
	const written = WRITTEN_DAY.get(d);
	return written === undefined || written.ms !== d.getTime() || written.day === written.ms ? d : new Date(written.day);
}

/** Whether `d` was written without a time and hasn't changed since. */
export function isWrittenDay(d: Date): boolean {
	const written = WRITTEN_DAY.get(d);
	return written !== undefined && written.ms === d.getTime();
}

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
// Jekyll's documented form, and what Ruby's `Time.parse` takes besides: a space before the zone,
// no colon in it, a one-digit hour, no seconds (`2009-12-25 10:41:06 +0000`, `2024-03-21 9:00 +09:00`):
// www.ruby-lang.org's 3,545 posts.
const ZONED = /^(\d{4})-(\d{1,2})-(\d{1,2})[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)? ?([Zz]|[+-]\d{2}:?\d{2}|UTC)$/;
// Without a zone, the parts can be written loosely (`2024-1-5`, `+2024-06-01`), as 0.7 read them.
const DATE_ONLY = /^([+-]?\d{1,6})-(\d{1,2})-(\d{1,2})$/;
const NAIVE = /^([+-]?\d{1,6})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(\.\d+)?)?$/;

export function parseDate(text: string): Date | undefined {
	let s = text.trim();
	// Hexo's and moment's slashes (`2026/05/08`, `2026/05/08 12:00`) are the dashed form: read the
	// same way, so a day is that day in `timeZone` and a time without a zone is UTC (hexo.io #9).
	const slashed = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?=$|[Tt ])/.exec(s);
	if (slashed) s = `${slashed[1]}-${slashed[2]}-${slashed[3]}${s.slice(slashed[0].length)}`;
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
	m = ZONED.exec(s);
	if (m) {
		const utc = utcMs(m[1], m[2], m[3], m[4], m[5], m[6] ?? "0", m[7]);
		if (utc === undefined) return undefined;
		const zone = m[8].replace(":", "");
		const minutes = /^[Zz]|UTC$/.test(zone) ? 0 : Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5));
		return new Date(utc - (zone[0] === "-" ? -minutes : minutes) * 60_000);
	}
	m = DATE_ONLY.exec(s);
	if (m) {
		const utc = utcMs(m[1], m[2], m[3]);
		return utc === undefined ? undefined : dayDate(Number(m[1]), Number(m[2]), Number(m[3]));
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
