// Values in Edge templates as 0.7's Edge had them, where JavaScript's own differ.
//
// 0.7's Edge evaluated expressions itself (`crates/sitesquatch-edge/src/eval.rs`), and three
// things it did differently matter for a site's output:
//
// - Dates were always UTC: `page.date.getDate()`, `toDateString()` and `new Date(2024, 0, 5)`
//   gave the same answer on every machine, where JavaScript's follow the machine's time zone. A
//   build's output may not depend on that.
// - A date as text was ISO 8601 (`String(date)`, `` `${date}` ``, `'on ' + date`, `[date]`), where
//   JavaScript's `toString` is a local, English sentence.
// - A string was indexed by character: `"🌲a"[0]` is the tree, where JavaScript gives half of it.
//
// The template's code calls these through `template.ssqch` (see `adjust` in `edge.ts`), so a
// site's own JavaScript, and the values themselves, stay JavaScript's.
import { buildTime, shownAsUtc } from "../data.ts";

/** How a function prints, as 0.7 printed every one (JavaScript prints its source, ssqch's own wrappers included). */
const FUNCTION_TEXT = "function () { [native code] }";

/** A number as 0.7 printed it: never in exponent notation (`1e21` is `1000000000000000000000`), and `-0` as `-0`. */
export function jsNumber(n: number): string {
	if (Object.is(n, -0)) return "-0";
	const text = String(n);
	const found = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
	if (!found) return text;
	const [, sign, first, rest = "", e] = found;
	const exp = Number(e);
	const digits = first + rest;
	if (exp < 0) return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
	const point = exp + 1;
	return sign + (digits.length <= point ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`);
}

/** A value as text, as 0.7 made it (`String(value)`, with a date in ISO 8601 and a list's empty places empty). */
export function jsString(value: unknown): string {
	switch (typeof value) {
		case "string": return value;
		case "number": return jsNumber(value);
		case "function": return FUNCTION_TEXT;
		case "object":
			if (value === null) return "null";
			if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : shownAsUtc(value).toISOString();
			if (Array.isArray(value)) return value.map((item) => (item === undefined || item === null ? "" : jsString(item))).join(",");
			return String(value);
		default: return String(value);
	}
}

/** `a + b`: text when either side is text, a list, an object or a date, as 0.7 joined them; numbers otherwise. */
export function add(a: unknown, b: unknown): unknown {
	if (typeof a === "number" && typeof b === "number") return a + b;
	const text = (v: unknown) => typeof v === "string" || typeof v === "function" || (typeof v === "object" && v !== null);
	if (text(a) || text(b)) return jsString(a) + jsString(b);
	return (a as number) + (b as number);
}

// ---- dates, in UTC ---------------------------------------------------------------------------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n: number) => String(n).padStart(2, "0");

/** The methods of a date that answer in the machine's time zone, as 0.7 answered them: in UTC. */
const DATE_METHODS: Record<string, (d: Date, args: unknown[]) => unknown> = {
	getFullYear: (d) => shownAsUtc(d).getUTCFullYear(),
	getYear: (d) => shownAsUtc(d).getUTCFullYear() - 1900,
	getMonth: (d) => shownAsUtc(d).getUTCMonth(),
	getDate: (d) => shownAsUtc(d).getUTCDate(),
	getDay: (d) => shownAsUtc(d).getUTCDay(),
	getHours: (d) => shownAsUtc(d).getUTCHours(),
	getMinutes: (d) => shownAsUtc(d).getUTCMinutes(),
	getSeconds: (d) => shownAsUtc(d).getUTCSeconds(),
	getMilliseconds: (d) => shownAsUtc(d).getUTCMilliseconds(),
	getTimezoneOffset: () => 0,
	setFullYear: (d, a) => d.setUTCFullYear(...(a as [number])),
	setMonth: (d, a) => d.setUTCMonth(...(a as [number])),
	setDate: (d, a) => d.setUTCDate(...(a as [number])),
	setHours: (d, a) => d.setUTCHours(...(a as [number])),
	setMinutes: (d, a) => d.setUTCMinutes(...(a as [number])),
	setSeconds: (d, a) => d.setUTCSeconds(...(a as [number])),
	setMilliseconds: (d, a) => d.setUTCMilliseconds(...(a as [number])),
	toString: (d: Date) => jsString(d),
	toDateString: (d) => (Number.isNaN(d.getTime()) ? "Invalid Date" : `${DAYS[shownAsUtc(d).getUTCDay()]} ${MONTHS[shownAsUtc(d).getUTCMonth()].slice(0, 3)} ${two(shownAsUtc(d).getUTCDate())} ${String(shownAsUtc(d).getUTCFullYear()).padStart(4, "0")}`),
	toTimeString: (d) => (Number.isNaN(d.getTime()) ? "Invalid Date" : `${two(shownAsUtc(d).getUTCHours())}:${two(shownAsUtc(d).getUTCMinutes())}:${two(shownAsUtc(d).getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`),
	// 0.7's, word for word: `{ month: "long" }` is `March 4, 2024`, `"short"` is `Mar 4, 2024`, and
	// anything else `3/4/2024`, whatever the locale (which keeps it off `Intl`, whose answers
	// change between Node releases).
	toLocaleDateString: (d, args) => {
		const options = args[1];
		const month = options !== null && typeof options === "object" ? (options as Record<string, unknown>).month : undefined;
		const [y, m, day] = [shownAsUtc(d).getUTCFullYear(), shownAsUtc(d).getUTCMonth(), shownAsUtc(d).getUTCDate()];
		if (month === "long") return `${MONTHS[m]} ${day}, ${y}`;
		if (month === "short") return `${MONTHS[m].slice(0, 3)} ${day}, ${y}`;
		return `${m + 1}/${day}/${y}`;
	},
	// Not in 0.7: `Intl`'s, in UTC unless the template names a time zone.
	toLocaleString: (d: Date, args: unknown[]) => d.toLocaleString(args[0] as string, { timeZone: "UTC", ...(args[1] as object) }),
	toLocaleTimeString: (d, args) => d.toLocaleTimeString(args[0] as string, { timeZone: "UTC", ...(args[1] as object) }),
};

/** A date string with no time zone, read as UTC, as 0.7 read it: `2024-01-05`, `2024-01-05 10:00`, `2024-01-05T10:00:00.5`. */
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/;
/** A date string that says its time zone, which JavaScript reads as it says. */
const ZONED = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT)\b[+-]?\d*)\s*$/i;

/** When `text` is, as 0.7 read it (UTC unless it says otherwise), or `NaN`. */
export function parseDate(text: string): number {
	const s = text.trim();
	const naive = NAIVE.exec(s);
	if (naive) {
		const [, y, mo, d, h = "0", mi = "0", sec = "0", frac = ""] = naive;
		return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), Number(frac.slice(0, 3).padEnd(3, "0")));
	}
	const at = Date.parse(s);
	if (Number.isNaN(at) || ZONED.test(s)) return at;
	// JavaScript read it in the machine's time zone: the same clock time in UTC.
	return at - new Date(at).getTimezoneOffset() * 60_000;
}

/** `new Date(...)` in a template, as 0.7 made it: in UTC, and nothing (not an invalid date) for what isn't one. */
export function newDate(...args: unknown[]): Date | null {
	let date: Date;
	if (args.length === 0) date = buildTime();
	else if (args.length === 1) {
		const [value] = args;
		date = typeof value === "string" ? new Date(parseDate(value)) : new Date(value as number);
	} else {
		const [y, m, ...rest] = args.map(Number);
		date = new Date(Date.UTC(y, m, ...(rest as [])));
	}
	return Number.isNaN(date.getTime()) ? null : date;
}

// ---- strings, by character --------------------------------------------------------------------

/** A string with a character that JavaScript counts as two (an emoji): only then do its answers differ from 0.7's. */
const PAIRED = /[\uD800-\uDFFF]/;

/** A place in characters, as JavaScript counts places in `slice` (negative from the end). */
const place = (n: unknown, length: number, otherwise: number): number => {
	if (n === undefined) return otherwise;
	const i = Math.trunc(Number(n)) || 0;
	return i < 0 ? Math.max(length + i, 0) : Math.min(i, length);
};
/** A place in characters as a place in UTF-16 units. */
const units = (chars: string[], at: number) => chars.slice(0, at).join("").length;
const charsBefore = (s: string, unit: number) => (unit < 0 ? -1 : [...s.slice(0, unit)].length);

/** The methods 0.7 gave strings that count characters, where JavaScript counts UTF-16 units. */
const STRING_METHODS: Record<string, (s: string, chars: string[], args: unknown[]) => unknown> = {
	slice: (_, c, [a, b]) => c.slice(place(a, c.length, 0), place(b, c.length, c.length)).join(""),
	substring: (_, c, [a, b]) => {
		const clamp = (n: unknown, otherwise: number) => (n === undefined ? otherwise : Math.min(Math.max(Math.trunc(Number(n)) || 0, 0), c.length));
		const [x, y] = [clamp(a, 0), clamp(b, c.length)];
		return c.slice(Math.min(x, y), Math.max(x, y)).join("");
	},
	charAt: (_, c, [i]) => c[Math.trunc(Number(i ?? 0)) || 0] ?? "",
	at: (_, c, [i]) => {
		const n = Math.trunc(Number(i ?? 0)) || 0;
		return c[n < 0 ? c.length + n : n];
	},
	indexOf: (s, c, [x, from]) => charsBefore(s, s.indexOf(String(x), from === undefined ? undefined : units(c, place(from, c.length, 0)))),
	lastIndexOf: (s, c, [x, from]) => charsBefore(s, s.lastIndexOf(String(x), from === undefined ? undefined : units(c, place(from, c.length, c.length)))),
	includes: (s, c, [x, from]) => s.includes(String(x), from === undefined ? undefined : units(c, place(from, c.length, 0))),
	startsWith: (s, c, [x, from]) => s.startsWith(String(x), from === undefined ? undefined : units(c, place(from, c.length, 0))),
	endsWith: (s, c, [x, end]) => s.endsWith(String(x), end === undefined ? undefined : units(c, place(end, c.length, c.length))),
	split: (s, c, [sep, limit]) => (sep === "" ? c.slice(0, limit === undefined ? undefined : Number(limit)) : s.split(sep as string, limit as number)),
	padStart: (s, c, [width, fill]) => pad(s, c, width, fill, true),
	padEnd: (s, c, [width, fill]) => pad(s, c, width, fill, false),
};

function pad(s: string, chars: string[], width: unknown, fill: unknown, start: boolean): string {
	const filler = [...(fill === undefined ? " " : String(fill))];
	const n = Math.trunc(Number(width)) || 0;
	if (chars.length >= n || !filler.length) return s;
	const padding = Array.from({ length: n - chars.length }, (_, i) => filler[i % filler.length]).join("");
	return start ? padding + s : s + padding;
}

/** The methods that `call` answers as 0.7 did; a template's call of any other goes to the value as it is. */
export const ADJUSTED_METHODS = new Set([...Object.keys(DATE_METHODS), ...Object.keys(STRING_METHODS), "join"]);

/**
 * `value.name(...args)`, as 0.7 answered it for a date, a string, a list or a number;
 * JavaScript's for anything else. `optional` is a call in an optional chain, which gives nothing
 * for nothing, and `path` is how the template wrote the call (`a.join`), for the error when it
 * isn't a function.
 */
export function call(value: any, name: string, optional: boolean, path: string, ...args: unknown[]): unknown {
	if (value === undefined || value === null) {
		if (optional) return undefined;
		throw new TypeError(`Cannot read properties of ${value} (reading '${name}')`);
	}
	if (value instanceof Date) {
		const method = DATE_METHODS[name];
		if (method) return method(value, args);
	} else if (typeof value === "string") {
		const method = STRING_METHODS[name];
		if (method && PAIRED.test(value)) return method(value, [...value], args);
	} else if (Array.isArray(value)) {
		if (name === "toString") return jsString(value);
		if (name === "join") return value.map((item) => (item === undefined || item === null ? "" : jsString(item))).join(args[0] === undefined ? "," : jsString(args[0]));
	} else if (typeof value === "number" && name === "toString" && args.length === 0) {
		return jsNumber(value);
	}
	if (typeof value[name] !== "function") throw new TypeError(`${path} is not a function`);
	return value[name](...args);
}

/** `value[key]`: a string's character, as 0.7 indexed strings; anything else as JavaScript has it. */
export function index(value: any, key: unknown): unknown {
	if (typeof value === "string" && PAIRED.test(value) && (typeof key === "number" || (typeof key === "string" && /^\d+$/.test(key)))) return [...value][Number(key)];
	return value[key as PropertyKey];
}
