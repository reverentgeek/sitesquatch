// What ssqch's `.jinja`, `.j2` and `.njk` templates have beyond nunjucks: what 0.7's Jinja engine
// (MiniJinja, `plugins/jinja/src/lib.rs`) gave them. Jinja's filters, tests and functions where
// nunjucks has none or answers differently, Python's string, list and dict methods, slices,
// dates, and values printed as 0.7 printed them. Where nunjucks has something 0.7 didn't
// (`forceescape`, `nl2br`, `urlize`), it stays.
import nunjucks from "nunjucks";
import { shownAsUtc, toDate } from "../data.ts";
import { BadPattern, strftime } from "../strftime.ts";

// nunjucks' internals, which its type definitions leave out.
interface Runtime {
	SafeString: new (value: string) => object;
	suppressValue(value: unknown, autoescape: unknown): unknown;
	memberLookup(obj: unknown, val: unknown, ...slice: unknown[]): unknown;
	contextOrFrameLookup(context: unknown, frame: unknown, name: string): unknown;
	ensureDefined(value: unknown, lineno: number, colno: number): unknown;
	// The fork's hooks (vendor/nunjucks/src/runtime.js).
	methodLookup(obj: unknown, val: unknown): unknown;
	truthy(value: unknown): boolean;
	eq(a: unknown, b: unknown): boolean;
	mod(a: unknown, b: unknown): unknown;
	concat(a: unknown, b: unknown, autoescape: unknown): unknown;
	tuple(items: unknown[]): unknown[];
	setAttribute(obj: unknown, key: unknown, value: unknown): void;
}
const runtime = nunjucks.runtime as unknown as Runtime;
const SURROGATES = /[\uD800-\uDFFF]/;
const lib = nunjucks.lib as unknown as { escape(text: string): string; TemplateError: new (message: string, lineno?: number, colno?: number) => Error };
const SafeString = runtime.SafeString;
const safe = (text: string) => new SafeString(text);

/** The `autoescape` a `.jinja` environment has: escaping as Jinja does, which leaves `\` alone (nunjucks writes `&#92;`). */
export const JINJA_ESCAPE = Object.freeze({ jinja: true });
/** The `autoescape` of a `.jinja` environment with `jinja: { autoescape: false }`: Jinja's printing, and nothing escaped, as MkDocs' Jinja has it. */
export const JINJA_RAW = Object.freeze({ jinja: true, raw: true });
const isJinja = (autoescape: unknown) => autoescape === JINJA_ESCAPE || autoescape === JINJA_RAW;

/** An error in a template that ssqch's own filters report as 0.7 did (`invalid operation: not a date: nope`): its message is the whole story. */
export class JinjaError extends Error {}
const invalid = (what: string) => new JinjaError(`invalid operation: ${what}`);

type Fn = (this: any, ...args: any[]) => unknown;
type Kwargs = Record<string, unknown>;

// ---- values -------------------------------------------------------------------------------

const isKwargs = (v: unknown): v is Kwargs => typeof v === "object" && v !== null && (v as Kwargs).__keywords === true;
const isPlain = (v: unknown): v is Record<string, unknown> => {
	if (typeof v !== "object" || v === null) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};
const isString = (v: unknown): boolean => typeof v === "string" || v instanceof SafeString;

/**
 * A call's arguments by position, with keyword ones put in their place: `round(2,
 * method="floor")` and `round(precision=2, method="floor")` are `[2, "floor"]` for `names`
 * `["precision", "method"]`. A keyword nothing names is left out.
 */
function named(args: unknown[], names: string[]): unknown[] {
	const last = args[args.length - 1];
	if (!isKwargs(last)) return args;
	const out = args.slice(0, -1);
	for (const [key, value] of Object.entries(last)) {
		const at = names.indexOf(key);
		if (at !== -1) out[at] = value;
	}
	return out;
}

/** Keyword arguments without nunjucks' marker, for a value a template keeps (`dict(a=1)`). */
function withoutMarker(kwargs: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (typeof kwargs === "object" && kwargs !== null) for (const [k, v] of Object.entries(kwargs)) if (k !== "__keywords") out[k] = v;
	return out;
}

/** Python's (and Jinja's) truth: an empty list, dict or string is false. */
export function truthy(v: unknown): boolean {
	if (!v) return false;
	if (v === true || typeof v === "string" || typeof v === "number") return true;
	if (Array.isArray(v)) return v.length > 0;
	if (v instanceof SafeString) return String(v).length > 0;
	if (isPlain(v)) return Object.keys(v).length > 0;
	if (v instanceof Map || v instanceof Set) return v.size > 0;
	return true;
}

/** Jinja's `==`: by value for lists and dicts, numbers with numbers, text with text (`0 == ""` is false). */
export function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	const ta = typeof a, tb = typeof b;
	if ((ta === "number" || ta === "boolean") && (tb === "number" || tb === "boolean")) return Number(a) === Number(b);
	if (isString(a) || isString(b)) return isString(a) && isString(b) && String(a) === String(b);
	if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
	if (isPlain(a) && isPlain(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
	}
	return false;
}

/** What Jinja calls a value's type, in its messages. */
function kind(v: unknown): string {
	if (v === undefined) return "undefined";
	if (v === null) return "none";
	if (typeof v === "boolean") return "bool";
	if (typeof v === "number") return "number";
	if (isString(v)) return "string";
	if (Array.isArray(v)) return "sequence";
	if (typeof v === "function") return "function";
	return "map";
}

// Tuples (`(a, b)`, a dict's items) are lists that print as `(a, b)`; a `namespace()` is the one
// thing `{% set ns.x = ... %}` may change.
const tuples = new WeakSet<object>();
const namespaces = new WeakSet<object>();
const tuple = <T extends unknown[]>(items: T): T => {
	tuples.add(items);
	return items;
};

/** How 0.7 printed a function. */
const FUNCTION = "function () { [native code] }";

/** An attribute or a dotted path (`author.name`, `tags.0`) of a value. */
function attribute(value: unknown, path: unknown): unknown {
	let v = value;
	for (const part of String(path).split(".")) {
		if (v === undefined || v === null) return undefined;
		v = (v as Record<string, unknown>)[part];
	}
	return v;
}

/**
 * A value as Nunjucks makes it text, for `.njk` (and so as a site from Eleventy expects it):
 * `true`, `a,b` for a list, `[object Object]`, nothing for `none`. A date is still ISO 8601:
 * Nunjucks' own would be in the machine's time zone, and a build's output may not depend on it.
 */
export function njkString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v === undefined || v === null) return "";
	if (typeof v === "function") return FUNCTION;
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : shownAsUtc(v).toISOString();
	if (Array.isArray(v)) return v.map(njkString).join(",");
	return String(v);
}

/**
 * A value as Jinja makes it text (`str()`): `True`, `None`, `['a', 'b']`, `{'a': 1}`, `(1, 2)`.
 * Dates are ISO 8601 (a JavaScript date would print in the machine's time zone). Printed on its
 * own, `none` is nothing; that's `suppressValue`'s.
 */
export function pyString(v: unknown): string {
	return pyStringOf(v);
}

function pyStringOf(v: unknown): string {
	if (typeof v === "string") return v;
	if (v === undefined) return "";
	if (v === null) return "None";
	if (typeof v === "boolean") return v ? "True" : "False";
	if (typeof v === "function") return FUNCTION;
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : shownAsUtc(v).toISOString();
	if (Array.isArray(v) || isPlain(v)) return pyRepr(v, new Set());
	return String(v);
}

function pyRepr(v: unknown, seen: Set<unknown>, indent?: number, depth = 0): string {
	if (v === undefined) return "undefined";
	if (v === null) return "None";
	if (typeof v === "boolean") return v ? "True" : "False";
	if (typeof v === "string" || v instanceof SafeString) return quote(String(v));
	// A date is ISO 8601, as 0.7 printed it (unquoted).
	if (v instanceof Date || typeof v === "function") return pyString(v);
	if (!(Array.isArray(v) || isPlain(v))) return String(v);
	if (seen.has(v)) return "...";
	seen.add(v);
	const items = Array.isArray(v) ? v.map((item) => pyRepr(item, seen, indent, depth + 1)) : Object.entries(v).map(([k, item]) => `${quote(k)}: ${pyRepr(item, seen, indent, depth + 1)}`);
	seen.delete(v);
	const [open, close] = tuples.has(v) ? ["(", ")"] : Array.isArray(v) ? ["[", "]"] : ["{", "}"];
	if (!items.length) return open + close;
	if (tuples.has(v) && items.length === 1 && indent === undefined) return `(${items[0]},)`;
	// `pprint`: Rust's `{:#?}`, an item a line with a comma after each.
	if (indent !== undefined) {
		const pad = " ".repeat(indent * (depth + 1));
		return `${open}\n${items.map((item) => `${pad}${item},\n`).join("")}${" ".repeat(indent * depth)}${close}`;
	}
	return `${open}${items.join(", ")}${close}`;
}

/** A string in Python's quotes: single ones, unless it has a `'` and no `"`. */
function quote(s: string): string {
	const mark = s.includes("'") && !s.includes('"') ? '"' : "'";
	return mark + s.replaceAll("\\", "\\\\").replaceAll(mark, `\\${mark}`).replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t") + mark;
}

/**
 * JSON as Jinja's `tojson` writes it: `{"a": 1, "b": [2, 3]}`, or indented, with `<`, `>`, `&`
 * and `'` escaped so it's safe in HTML and in a `<script>`. `sortKeys` writes a dict's keys in
 * order, as Jinja does (`json.dumps(sort_keys=True)`); `.njk` keeps them as they were set.
 */
function toJson(value: unknown, indent?: number, sortKeys = false): string {
	const write = (v: unknown, depth: number): string => {
		if (v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v))) return "null";
		if (typeof v === "boolean" || typeof v === "number") return String(v);
		if (typeof v === "string" || v instanceof SafeString) return JSON.stringify(String(v));
		if (v instanceof Date) return JSON.stringify(pyString(v));
		if (typeof v === "function") return "null";
		const entries: Array<[string | undefined, unknown]> = Array.isArray(v) ? v.map((item) => [undefined, item]) : Object.entries(v as object).filter(([, item]) => item !== undefined && typeof item !== "function");
		if (sortKeys && !Array.isArray(v)) entries.sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0));
		const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
		if (!entries.length) return open + close;
		const parts = entries.map(([k, item]) => (k === undefined ? "" : `${JSON.stringify(k)}: `) + write(item, depth + 1));
		if (indent === undefined) return `${open}${parts.join(", ")}${close}`;
		const pad = " ".repeat(indent * (depth + 1));
		return `${open}\n${parts.map((p) => pad + p).join(",\n")}\n${" ".repeat(indent * depth)}${close}`;
	};
	return write(value, 0).replace(/[<>&']/g, (c) => `\\u00${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** A number with one decimal as Rust's `{:.1}` writes it: a tie goes to the even digit. */
function oneDecimal(n: number): string {
	return roundHalfEven(n, 1).toFixed(1);
}

/** `n` rounded to `precision` decimals the way Python and Rust round: a tie goes to the even digit. */
function roundHalfEven(n: number, precision: number): number {
	const scale = 10 ** precision;
	const scaled = n * scale;
	const floor = Math.floor(scaled);
	const diff = scaled - floor;
	// Only an exact tie (2.5, 0.125) is decided differently from `toFixed`.
	if (diff === 0.5) return (floor % 2 === 0 ? floor : floor + 1) / scale;
	return Number(n.toFixed(precision));
}

// ---- printing and looking up ----------------------------------------------------------------

const jinjaEscapes: Record<string, string> = { "&": "&amp;", "\"": "&quot;", "'": "&#39;", "<": "&lt;", ">": "&gt;" };
/** HTML-escaped as Jinja does it: `& < > " '` (nunjucks also writes `\` as `&#92;`). */
export const escapeJinja = (text: string) => text.replace(/[&"'<>]/g, (c) => jinjaEscapes[c]);

const STRING_METHODS: Record<string, (s: string, ...args: any[]) => unknown> = {
	upper: (s) => s.toUpperCase(),
	lower: (s) => s.toLowerCase(),
	islower: (s) => /\p{L}/u.test(s) && s === s.toLowerCase(),
	isupper: (s) => /\p{L}/u.test(s) && s === s.toUpperCase(),
	isspace: (s) => s.length > 0 && /^\s+$/u.test(s),
	isdigit: (s) => s.length > 0 && /^\p{N}+$/u.test(s),
	isnumeric: (s) => s.length > 0 && /^\p{N}+$/u.test(s),
	isalnum: (s) => s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s),
	isalpha: (s) => s.length > 0 && /^\p{L}+$/u.test(s),
	isascii: (s) => /^[\x00-\x7f]*$/.test(s),
	strip: (s, chars?: string) => trimChars(s, chars, true, true),
	lstrip: (s, chars?: string) => trimChars(s, chars, true, false),
	rstrip: (s, chars?: string) => trimChars(s, chars, false, true),
	// A regular expression (`r/a+/g`) is JavaScript's `replace`; a string is Python's, which replaces every one.
	replace: (s, from: unknown, to: unknown, count?: number) => (from instanceof RegExp ? s.replace(from, String(to)) : replaceCount(s, String(from), String(to), count)),
	title: (s) => titleCase(s),
	split: (s, sep?: unknown, max?: number) => (sep instanceof RegExp ? s.split(sep) : pySplit(s, sep, max)),
	splitlines: (s) => lines(s),
	capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
	count: (s, needle: string) => (needle === "" ? [...s].length + 1 : s.split(String(needle)).length - 1),
	find: (s, needle: string) => charIndex(s, s.indexOf(String(needle))),
	rfind: (s, needle: string) => charIndex(s, s.lastIndexOf(String(needle))),
	startswith: (s, prefix: unknown) => (Array.isArray(prefix) ? prefix : [prefix]).some((p) => s.startsWith(String(p))),
	endswith: (s, suffix: unknown) => (Array.isArray(suffix) ? suffix : [suffix]).some((p) => s.endsWith(String(p))),
	join: (s, items: unknown) => (Array.isArray(items) ? items.map(pyString).join(s) : ""),
	format: (s, ...args: unknown[]) => {
		let next = 0;
		return s.replace(/\{(\d*)\}/g, (_, n: string) => pyString(args[n === "" ? next++ : Number(n)]));
	},
};
const DICT_METHODS: Record<string, (o: Record<string, unknown>, ...args: any[]) => unknown> = {
	keys: (o) => Object.keys(o),
	values: (o) => Object.values(o),
	items: (o) => Object.entries(o),
	get: (o, key: string, fallback: unknown = null) => (Object.hasOwn(o, key) && o[key] !== undefined ? o[key] : fallback),
};
const LIST_METHODS: Record<string, (a: unknown[], ...args: any[]) => unknown> = {
	count: (a, item: unknown) => a.filter((x) => x === item).length,
};
const DATE_METHODS: Record<string, (d: Date, ...args: any[]) => unknown> = {
	strftime: (d, pattern = "%Y-%m-%d") => formatPattern(d, String(pattern)),
	isoformat: (d) => strftime(d, "%Y-%m-%dT%H:%M:%S+00:00"),
};
// A date's parts in UTC, as 0.7 gave them: `page.date.getFullYear()` mustn't depend on where the
// site is built.
const DATE_UTC: Record<string, (d: Date) => number> = {
	getFullYear: (d) => shownAsUtc(d).getUTCFullYear(),
	getMonth: (d) => shownAsUtc(d).getUTCMonth(),
	getDate: (d) => shownAsUtc(d).getUTCDate(),
	getDay: (d) => shownAsUtc(d).getUTCDay(),
	getHours: (d) => shownAsUtc(d).getUTCHours(),
	getMinutes: (d) => shownAsUtc(d).getUTCMinutes(),
	getSeconds: (d) => shownAsUtc(d).getUTCSeconds(),
	getMilliseconds: (d) => shownAsUtc(d).getUTCMilliseconds(),
	getTimezoneOffset: () => 0,
};
// `loop.cycle()` and `loop.changed()`, which nunjucks' loops don't have.
const changedBefore = new WeakMap<object, unknown[]>();
const LOOP_METHODS: Record<string, (loop: Record<string, unknown>, ...args: any[]) => unknown> = {
	cycle: (loop, ...items: unknown[]) => (items.length ? items[Number(loop.index0) % items.length] : undefined),
	changed: (loop, ...args: unknown[]) => {
		const before = changedBefore.get(loop);
		changedBefore.set(loop, args);
		return !before || before.length !== args.length || before.some((v, i) => v !== args[i]);
	},
};
const isLoop = (o: Record<string, unknown>) => "index0" in o && "revindex0" in o && "first" in o && "last" in o;

/** A method Python (or Jinja's loop) has that the value doesn't: `"a".upper()`, `post.items()`, `date.strftime("%Y")`. */
function pythonMethod(obj: unknown, name: string): Fn | undefined {
	// A table's own methods only: `constructor` or `toString` aren't Python's.
	const own = <T,>(table: Record<string, T>): T | undefined => (Object.hasOwn(table, name) ? table[name] : undefined);
	if (isString(obj)) {
		const m = own(STRING_METHODS);
		return m && ((...args) => m(String(obj), ...args.filter((a) => !isKwargs(a))));
	}
	if (Array.isArray(obj)) {
		const m = own(LIST_METHODS);
		return m && ((...args) => m(obj, ...args));
	}
	if (obj instanceof Date) {
		const m = own(DATE_METHODS);
		return m && ((...args) => m(obj, ...args));
	}
	if (isPlain(obj)) {
		const m = (isLoop(obj) ? own(LOOP_METHODS) : undefined) ?? own(DICT_METHODS);
		return m && ((...args) => m(obj, ...args));
	}
	return undefined;
}

/** `xs[1:3]`, `title[::-1]`, as Python slices: a string's slice is a string. */
function sliceOf(obj: unknown, start: unknown, stop: unknown, step: unknown): unknown {
	if (obj === undefined || obj === null) return undefined;
	const text = isString(obj);
	const items: unknown[] = text ? [...String(obj)] : Array.isArray(obj) ? obj : [];
	const n = items.length;
	const by = step === null || step === undefined ? 1 : Number(step);
	if (by === 0) throw invalid("cannot slice by step size of 0");
	const at = (v: unknown, fallback: number) => {
		if (v === null || v === undefined) return fallback;
		let i = Math.trunc(Number(v));
		if (i < 0) i += n;
		return by > 0 ? Math.min(Math.max(i, 0), n) : Math.min(Math.max(i, -1), n - 1);
	};
	const from = at(start, by > 0 ? 0 : n - 1), to = at(stop, by > 0 ? n : -1);
	const out: unknown[] = [];
	for (let i = from; by > 0 ? i < to : i > to; i += by) out.push(items[i]);
	return text ? out.join("") : out;
}

let installed = false;

/**
 * Changes to nunjucks' runtime that every ssqch environment shares (they're the same module):
 * how values print, what a lookup finds, slices, and strict mode. Done once.
 */
export function installRuntime(): void {
	if (installed) return;
	installed = true;
	// Slices (`crumbs[:-1]`) are nunjucks' own, from its Jinja compatibility. Its lookups are
	// replaced below: they find a Python method before a key of the same name (a post's `items`
	// would be a function), and they make every name that's missing a second lookup for `True`,
	// `False` and `None` (which are globals here instead).
	const variable = runtime.contextOrFrameLookup;
	nunjucks.installJinjaCompat();
	runtime.contextOrFrameLookup = variable;
	runtime.memberLookup = function memberLookup(obj: unknown, val: unknown, stop?: unknown, step?: unknown) {
		// `memberLookup(obj, start, stop, step)` is a slice.
		if (arguments.length === 4) return sliceOf(obj, val, stop, step);
		if (obj === undefined || obj === null) return undefined;
		// A string counts and indexes by character, as Python (and 0.7) do: JavaScript counts
		// UTF-16 units, so an emoji was two, and `title[0]` half of one.
		if (typeof obj === "string" && (val === "length" || typeof val === "number") && SURROGATES.test(obj)) {
			const chars = [...obj];
			if (val === "length") return chars.length;
			return chars[(val as number) < 0 ? chars.length + (val as number) : (val as number)];
		}
		const found = (obj as Record<string, unknown>)[val as string];
		if (typeof found === "function") {
			// Its own keys only: `toString` would be Object's, called on nothing (`[object Undefined]`,
			// a11yproject.com's JSON-LD), where a date's own `toString` is meant.
			const utc = obj instanceof Date && Object.hasOwn(DATE_UTC, val as string) ? DATE_UTC[val as string] : undefined;
			if (utc) return () => utc(obj as Date);
			// A string's `split` and `replace` are Python's, as they were in 0.7: JavaScript's
			// `"a-a".replace("-", " ")` replaces only the first.
			if ((val === "split" || val === "replace") && isString(obj)) return pythonMethod(obj, val);
			return (...args: unknown[]) => (found as Fn).apply(obj, args);
		}
		if (found !== undefined) return found;
		// `xs[-1]` is the last item, as in Python.
		if (typeof val === "number" && val < 0 && (Array.isArray(obj) || isString(obj))) {
			const items = Array.isArray(obj) ? obj : String(obj);
			return items[items.length + val];
		}
		return typeof val === "string" ? pythonMethod(obj, val) : undefined;
	};

	// Values print as Jinja prints them in `.jinja` (`True`, `['a', 'b']`) and as Nunjucks does
	// in `.njk` (`true`, `a,b`), a date in ISO 8601 in both, and escape as each language does.
	// The flavor is the environment's `autoescape`, which nunjucks passes to every output.
	runtime.suppressValue = function suppressValue(value: unknown, autoescape: unknown) {
		if (value === undefined || value === null) return "";
		if (value instanceof SafeString) return value;
		const text = typeof value === "string" ? value : isJinja(autoescape) ? pyString(value) : njkString(value);
		if (!autoescape || autoescape === JINJA_RAW) return text;
		return autoescape === JINJA_ESCAPE ? escapeJinja(text) : lib.escape(text);
	};

	// `obj.items()` is the method even where `obj` has an `items` key that isn't one, as in Jinja.
	runtime.methodLookup = function methodLookup(obj: unknown, val: unknown) {
		const found = runtime.memberLookup(obj, val);
		if (typeof found === "function" || typeof val !== "string" || obj === undefined || obj === null) return found;
		return pythonMethod(obj, val) ?? found;
	};

	// Jinja's truth, `==`, `%` and `~`, and its tuples and namespaces, where the fork asks.
	runtime.truthy = truthy;
	runtime.eq = equal;
	runtime.mod = function mod(a: unknown, b: unknown) {
		if (typeof a !== "number" || typeof b !== "number") throw invalid(`tried to use % operator on unsupported types ${kind(a)} and ${kind(b)}`);
		if (b === 0) throw invalid("tried to use % operator with a divisor of 0");
		return a - b * Math.floor(a / b);
	};
	// `~` joins values as they'd print (an undefined value is nothing, `none` is `None`). With a
	// safe side, the result is safe and the other side is escaped, as in Jinja.
	runtime.concat = function concat(a: unknown, b: unknown, autoescape: unknown) {
		const str = isJinja(autoescape) ? pyString : njkString;
		if (autoescape === JINJA_RAW || (!(a instanceof SafeString) && !(b instanceof SafeString))) return str(a) + str(b);
		const part = (v: unknown) => (v instanceof SafeString ? String(v) : autoescape === JINJA_ESCAPE ? escapeJinja(str(v)) : lib.escape(str(v)));
		return safe(part(a) + part(b));
	};
	runtime.tuple = tuple;
	runtime.setAttribute = function setAttribute(obj: unknown, key: unknown, value: unknown) {
		if (typeof obj !== "object" || obj === null || !namespaces.has(obj)) throw invalid(`can only assign to namespaces, not ${kind(obj)}`);
		(obj as Record<string, unknown>)[String(key)] = value;
	};

	// `strict: true` makes printing an undefined value an error. `none` prints nothing, as in 0.7.
	runtime.ensureDefined = function ensureDefined(value: unknown, lineno: number, colno: number) {
		if (value === undefined) throw new lib.TemplateError("attempted to output null or undefined value", lineno + 1, colno + 1);
		return value;
	};

	// Jinja's `self`: `{{ self.title() }}` renders the block `title` as the page's templates have
	// it (the child's over the parent's), wherever it's called, as Material for MkDocs' base.html
	// does with `self.announce()`. A variable or a value named `self` comes first.
	const lookup = runtime.contextOrFrameLookup;
	runtime.contextOrFrameLookup = function contextOrFrameLookup(context: unknown, frame: unknown, name: string) {
		const found = lookup(context, frame, name);
		if (found !== undefined || name !== "self" || !isBlockContext(context)) return found;
		return selfOf(context);
	};
}

interface BlockContext { env: unknown; blocks: Record<string, Fn[]>; getBlock(name: string): Fn }
const isBlockContext = (v: unknown): v is BlockContext => typeof v === "object" && v !== null && typeof (v as BlockContext).blocks === "object" && typeof (v as BlockContext).getBlock === "function";
const selves = new WeakMap<BlockContext, object>();

/** The `self` of a render: each block of its templates as a function that renders it. */
function selfOf(context: BlockContext): object {
	let self = selves.get(context);
	if (self) return self;
	const Frame = (nunjucks.runtime as unknown as { Frame: new () => unknown }).Frame;
	self = new Proxy({}, {
		get(_target, name) {
			if (typeof name !== "string" || !context.blocks[name]) return undefined;
			return () => {
				let out = "";
				context.getBlock(name)(context.env, context, new Frame(), nunjucks.runtime, (err: unknown, text: string) => {
					if (err) throw err;
					out = text;
				});
				return safe(out);
			};
		},
		has: (_target, name) => typeof name === "string" && Boolean(context.blocks[name]),
	});
	selves.set(context, self);
	return self;
}

// ---- filters --------------------------------------------------------------------------------

function trimChars(s: string, chars: string | undefined | null, start: boolean, end: boolean): string {
	if (chars === undefined || chars === null) return start && end ? s.trim() : start ? s.trimStart() : s.trimEnd();
	const set = new Set([...String(chars)]);
	const list = [...s];
	let a = 0, b = list.length;
	if (start) while (a < b && set.has(list[a])) a++;
	if (end) while (b > a && set.has(list[b - 1])) b--;
	return list.slice(a, b).join("");
}

function replaceCount(s: string, from: string, to: string, count?: unknown): string {
	if (count === undefined || count === null || Number(count) < 0) return s.split(from).join(to);
	let out = "", rest = s, n = Number(count);
	while (n-- > 0) {
		const at = rest.indexOf(from);
		if (at === -1) break;
		out += rest.slice(0, at) + to;
		rest = rest.slice(at + from.length);
		if (from === "") { out += rest.slice(0, 1); rest = rest.slice(1); }
	}
	return out + rest;
}

/** Each word's first letter upper case and the rest lower case, a word being letters and digits. */
function titleCase(s: string): string {
	// MiniJinja's: a word starts after whitespace, `-`, `(`, `{`, `[` or `<`, so `don't` stays `Don't`.
	let out = "", start = true;
	for (const c of s) {
		const separator = /\s/u.test(c) || "-({[<".includes(c);
		out += separator ? c : start ? c.toUpperCase() : c.toLowerCase();
		start = separator;
	}
	return out;
}

/** A string filter's text: a missing value is an error, as in 0.7. */
function text(v: unknown): string {
	if (!isString(v)) throw invalid("value is not a string");
	return String(v);
}

/** A string's characters, as Python counts them (an emoji is one). */
const chars = (s: string) => (SURROGATES.test(s) ? [...s] : s.split(""));

/** MiniJinja's `urlencode`: everything but letters, digits and `/ . - _` percent-encoded, a dict as a query string. */
function urlencode(v: unknown): string {
	const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replaceAll("%2F", "/");
	if (v === undefined || v === null) return "";
	if (isPlain(v)) return Object.entries(v).filter(([, item]) => item !== undefined && item !== null).map(([key, item]) => `${encode(key)}=${encode(pyString(item))}`).join("&");
	return encode(pyString(v));
}

/** Python's `str.split`: on runs of whitespace (dropping empty parts) with no separator. */
function pySplit(s: string, sep?: unknown, max?: unknown): string[] {
	const limit = max === undefined || max === null || Number(max) < 0 ? Infinity : Number(max);
	if (sep === undefined || sep === null) {
		const out: string[] = [];
		let rest = s.trimStart();
		while (rest !== "" && out.length < limit) {
			const m = /\s+/u.exec(rest);
			if (!m) break;
			out.push(rest.slice(0, m.index));
			rest = rest.slice(m.index + m[0].length);
		}
		if (rest !== "") out.push(limit === Infinity ? rest : out.length === limit ? rest.trimEnd() : rest);
		return out.filter((part) => part !== "");
	}
	const parts = s.split(String(sep));
	return limit === Infinity || parts.length <= limit + 1 ? parts : [...parts.slice(0, limit), parts.slice(limit).join(String(sep))];
}

/** Rust's `str::lines`: on `\n` or `\r\n`, and a newline at the end adds no empty line. */
function lines(s: string): string[] {
	if (s === "") return [];
	const parts = s.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	if (s.endsWith("\n")) parts.pop();
	return parts;
}

/** An index into a string in characters, as Python counts (JavaScript counts UTF-16 units). */
const charIndex = (s: string, at: number) => (at === -1 ? -1 : [...s.slice(0, at)].length);

/** Python's `%` formatting, for the `format` filter: `"%s-%05.1f" | format(name, 3.14159)`. */
function printf(pattern: string, args: unknown[]): string {
	let next = 0;
	return pattern.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdifFeEgGxXorc%])/g, (whole, flags: string, width?: string, precision?: string, kind?: string) => {
		if (kind === "%") return "%";
		const v = args[next++];
		let out: string;
		const num = Number(v);
		const p = precision === undefined ? undefined : Number(precision);
		switch (kind) {
			case "s": out = pyString(v); if (p !== undefined) out = out.slice(0, p); break;
			case "r": out = pyRepr(v, new Set()); break;
			case "d": case "i": out = String(Math.trunc(num)); break;
			case "f": case "F": out = num.toFixed(p ?? 6); break;
			case "e": case "E": out = num.toExponential(p ?? 6).replace(/e([+-])(\d)$/, "e$10$2"); if (kind === "E") out = out.toUpperCase(); break;
			case "g": case "G": out = String(Number(num.toPrecision(p || 6))); if (kind === "G") out = out.toUpperCase(); break;
			case "x": out = Math.trunc(num).toString(16); break;
			case "X": out = Math.trunc(num).toString(16).toUpperCase(); break;
			case "o": out = Math.trunc(num).toString(8); break;
			case "c": out = typeof v === "number" ? String.fromCodePoint(v) : String(v).slice(0, 1); break;
			default: return whole;
		}
		if (/[dioxXfFeEgG]/.test(kind!) && num >= 0) {
			if (flags.includes("+")) out = `+${out}`;
			else if (flags.includes(" ")) out = ` ${out}`;
		}
		const w = width === undefined ? 0 : Number(width);
		if (out.length < w) {
			if (flags.includes("-")) out = out.padEnd(w);
			else if (flags.includes("0") && /[dioxXfFeEgG]/.test(kind!)) {
				const sign = /^[+\- ]/.test(out) ? out[0] : "";
				out = sign + out.slice(sign.length).padStart(w - sign.length, "0");
			} else out = out.padStart(w);
		}
		return out;
	});
}

/** MiniJinja's `striptags` (from minijinja-contrib): tags and comments out, entities read, whitespace runs one space. */
function stripTags(s: string): string {
	const ENTITIES: Record<string, string> = { amp: "&", gt: ">", lt: "<", quot: "\"" };
	let out = "", entity = "";
	let state: "text" | "tagStart" | "tag" | "entity" | "c1" | "c2" | "comment" | "e1" | "e2" = "text";
	const push = (c: string) => {
		if (/\s/u.test(c)) {
			if (out !== "" && !/\s$/u.test(out)) out += " ";
		} else out += c;
	};
	const chars = [...s, undefined];
	for (const c of chars) {
		switch (state) {
			case "text":
				if (c === "<") state = "tagStart";
				else if (c === "&") { entity = ""; state = "entity"; }
				else if (c !== undefined) push(c);
				break;
			case "tagStart":
				state = c === ">" ? "text" : c === "!" ? "c1" : "tag";
				break;
			case "tag":
				if (c === ">") state = "text";
				break;
			case "c1": state = c === "-" ? "c2" : "tag"; break;
			case "c2": state = c === "-" ? "comment" : "tag"; break;
			case "comment": if (c === "-") state = "e1"; break;
			case "e1": state = c === "-" ? "e2" : "comment"; break;
			case "e2": state = c === ">" ? "text" : "comment"; break;
			case "entity": {
				if (c === undefined || c === ";" || c === "<" || c === "&" || /\s/u.test(c)) {
					const numeric = /^#(x[0-9a-f]+|[0-9]+)$/i.exec(entity);
					const code = numeric ? (numeric[1][0].toLowerCase() === "x" ? Number.parseInt(numeric[1].slice(1), 16) : Number.parseInt(numeric[1], 10)) : undefined;
					if (code !== undefined && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) push(String.fromCodePoint(code));
					else if (Object.hasOwn(ENTITIES, entity)) push(ENTITIES[entity]);
					else { out += `&${entity}`; if (c === ";") out += ";"; }
					if (c === "<") state = "tagStart";
					else if (c === "&") { entity = ""; state = "entity"; }
					else { state = "text"; if (c !== undefined && c !== ";") push(c); }
				} else entity += c;
				break;
			}
		}
	}
	return out.trim();
}

/** Nunjucks' own `striptags(text, true)`, which keeps line breaks (0.7 had no such argument). */
function stripTagsKeepingLines(input: string): string {
	const tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>|<!--[\s\S]*?-->/gi;
	const trimmed = input.replace(tags, "").trim();
	return trimmed.split(/\n/).map((line) => line.replace(/\s+/g, " ").trim()).join("\n").replace(/\n\n\n+/g, "\n\n");
}

type DateParts = "date" | "time" | "both";

/** `dateformat`, `timeformat` and `datetimeformat`, as 0.7 wrote them: in UTC, a named style or a `strftime` pattern. */
function formatDate(value: unknown, format: unknown, parts: DateParts): string {
	const date = typeof value === "number" ? new Date(Math.trunc(value) * 1000) : value instanceof SafeString ? toDate(String(value)) : toDate(value);
	if (!date || Number.isNaN(date.getTime())) throw invalid(`not a date: ${pyString(value)}`);
	const style = format === undefined || format === null ? "medium" : String(format);
	if (style === "unix") return String(Math.floor(date.getTime() / 1000));
	const STYLES: Record<string, Record<DateParts, string>> = {
		iso: { date: "%Y-%m-%d", time: "%H:%M:%S", both: "%Y-%m-%dT%H:%M:%SZ" },
		short: { date: "%Y-%m-%d", time: "%H:%M", both: "%Y-%m-%d %H:%M" },
		medium: { date: "%b %-d %Y", time: "%H:%M", both: "%b %-d %Y %H:%M" },
		long: { date: "%B %-d %Y", time: "%H:%M:%S", both: "%B %-d %Y %H:%M:%S" },
		full: { date: "%A, %B %-d %Y", time: "%H:%M:%S", both: "%A, %B %-d %Y %H:%M:%S" },
	};
	return formatPattern(date, Object.hasOwn(STYLES, style) ? STYLES[style][parts] : style);
}

function formatPattern(date: Date, pattern: string): string {
	try {
		return strftime(date, pattern);
	} catch (e) {
		if (e instanceof BadPattern) throw invalid(`${JSON.stringify(pattern)} isn't a date format (use short, medium, long, full, iso, unix, or a strftime pattern like "%B %-d, %Y")`);
		throw e;
	}
}

/** 0.7's `truncate(length=255, killwords=false, end="...")`: cut at `length` characters, back to the last space unless `killwords`. */
function truncate(value: unknown, ...args: unknown[]): string {
	const [length, killwords, end] = named(args, ["length", "killwords", "end"]);
	const s = value === undefined || value === null ? "" : String(value);
	const max = length === undefined || length === null ? 255 : Number(length);
	const tail = end === undefined || end === null ? "..." : String(end);
	const chars = [...s];
	if (chars.length <= max) return s;
	const cut = chars.slice(0, max).join("");
	if (killwords) return cut + tail;
	const space = cut.lastIndexOf(" ");
	return space > 0 ? cut.slice(0, space) + tail : cut + tail;
}

/** The items of a list, a string's characters, or a dict's keys. */
function itemsOf(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) return value;
	if (isString(value)) return [...String(value)];
	if (typeof value === "object" && Symbol.iterator in value) return [...(value as Iterable<unknown>)];
	if (typeof value === "object") return Object.keys(value);
	throw invalid(`${typeof value} is not iterable`);
}

/** How Jinja compares values when it sorts: strings without case unless asked. */
function sortKey(v: unknown, caseSensitive: unknown): unknown {
	return !caseSensitive && isString(v) ? String(v).toLowerCase() : v instanceof Date ? v.getTime() : v;
}
const compare = (a: unknown, b: unknown) => ((a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0);

/**
 * The filters 0.7's Jinja had, where nunjucks has none or answers another way. `escape` is the
 * flavor's; in `.njk` a value becomes text as Nunjucks makes it (`true`, `a,b`).
 */
export function jinjaFilters(escape: (text: string) => string, flavor: "njk" | "jinja" = "jinja"): Record<string, Fn> {
	const toText = flavor === "njk" ? njkString : pyStringOf;
	const escapeFilter = (v: unknown) => (v instanceof SafeString ? v : safe(escape(v === undefined || v === null ? "" : toText(v))));
	const filters: Record<string, Fn> = {
		escape: escapeFilter,
		e: escapeFilter,
		forceescape: (v: unknown) => safe(escape(v === undefined || v === null ? "" : String(v))),
		truncate,
		tojson: (v: unknown, ...args: unknown[]) => {
			const [indent] = named(args, ["indent"]);
			return safe(toJson(v, indent === true ? 2 : typeof indent === "number" ? indent : undefined, flavor === "jinja"));
		},
		pprint: (v: unknown) => pyRepr(v, new Set(), 4),
		pluralize: (v: unknown, ...args: unknown[]) => {
			const [singular, plural] = named(args, ["singular", "plural"]);
			let one: boolean;
			if (Array.isArray(v)) one = v.length === 1;
			else if (isString(v)) one = [...String(v)].length === 1;
			else if (isPlain(v)) one = Object.keys(v).length === 1;
			else if (typeof v === "number" && Number.isInteger(v)) one = v === 1;
			else if (typeof v === "boolean") one = v;
			else throw invalid(`Pluralize argument is not an integer, or a sequence / object with a length but of type ${v === undefined ? "undefined" : v === null ? "none" : typeof v}`);
			const word = one ? singular : plural;
			return word === undefined || word === null ? (one ? "" : "s") : word;
		},
		filesizeformat: (v: unknown, ...args: unknown[]) => {
			const [binary] = named(args, ["binary"]);
			const [prefixes, base] = binary ? [["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"], 1024] : [["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"], 1000];
			if (typeof v !== "number" && !isString(v)) throw invalid(`cannot convert ${kind(v)} to f64`);
			let n = Number(v);
			if (n === 1) return "1 Byte";
			const sign = n < 0 ? "-" : "";
			n = Math.abs(n);
			if (n < base) return `${sign}${n} Bytes`;
			for (let i = 0; i < prefixes.length; i++) {
				const unit = base ** (i + 2);
				if (n < unit || i === prefixes.length - 1) return `${sign}${oneDecimal((base * n) / unit)} ${prefixes[i]}`;
			}
			return "";
		},
		striptags: (v: unknown, keepLines?: unknown) => {
			const s = v === undefined || v === null ? "" : String(v);
			return keepLines === true ? stripTagsKeepingLines(s) : stripTags(s);
		},
		dateformat: (v: unknown, format?: unknown) => formatDate(v, format, "date"),
		timeformat: (v: unknown, format?: unknown) => formatDate(v, format, "time"),
		datetimeformat: (v: unknown, format?: unknown) => formatDate(v, format, "both"),
		items: (v: unknown) => {
			if (v === undefined || v === null) return [];
			if (v instanceof Map) return [...v.entries()].map(tuple);
			if (typeof v === "object" && !Array.isArray(v)) return Object.entries(v).map(tuple);
			throw invalid("cannot convert value into pair list");
		},
		map: function (this: { env: nunjucks.Environment }, v: unknown, ...args: unknown[]) {
			const kwargs = isKwargs(args[args.length - 1]) ? (args.pop() as Kwargs) : undefined;
			const items = itemsOf(v);
			if (kwargs && "attribute" in kwargs) {
				return items.map((item) => {
					const found = attribute(item, kwargs.attribute);
					return found === undefined && "default" in kwargs ? kwargs.default : found;
				});
			}
			if (!args.length) return items;
			const filter = this.env.getFilter(String(args[0]));
			return items.map((item) => filter.call(this, item, ...args.slice(1), ...(kwargs ? [kwargs] : [])));
		},
		unique: (v: unknown, ...args: unknown[]) => {
			const [caseSensitive, attr] = named(args, ["case_sensitive", "attribute"]);
			const seen = new Set<unknown>();
			return itemsOf(v).filter((item) => {
				const key = sortKey(attr === undefined || attr === null ? item : attribute(item, attr), caseSensitive);
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		},
		min: (v: unknown, ...args: unknown[]) => extreme(v, args, -1),
		max: (v: unknown, ...args: unknown[]) => extreme(v, args, 1),
		split: (v: unknown, ...args: unknown[]) => {
			const [sep, max] = named(args, ["split", "maxsplits"]);
			return pySplit(text(v), sep, max);
		},
		lines: (v: unknown) => lines(text(v)),
		format: (v: unknown, ...args: unknown[]) => printf(text(v), args.filter((a) => !isKwargs(a))),
		int: (v: unknown, ...args: unknown[]) => {
			const [fallback, base] = named(args, ["default", "base"]);
			const n = typeof v === "number" ? Math.trunc(v) : typeof v === "boolean" ? Number(v) : isString(v) ? Number.parseInt(String(v), base === undefined || base === null ? 10 : Number(base)) : Number.NaN;
			return Number.isNaN(n) ? (fallback === undefined || fallback === null ? 0 : fallback) : n;
		},
		float: (v: unknown, ...args: unknown[]) => {
			const [fallback] = named(args, ["default"]);
			const n = typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : isString(v) ? Number.parseFloat(String(v)) : Number.NaN;
			return Number.isNaN(n) ? (fallback === undefined || fallback === null ? 0 : fallback) : n;
		},
		abs: (v: unknown) => {
			if (typeof v !== "number") throw invalid("cannot get absolute value");
			return Math.abs(v);
		},
		attr: (v: unknown, name: unknown) => (v === undefined || v === null ? undefined : (v as Record<string, unknown>)[String(name)]),
		bool: (v: unknown) => truthy(v),
		count: (v: unknown) => (v === undefined || v === null ? 0 : isPlain(v) ? Object.keys(v).length : (v as { length?: number }).length ?? 0),
		zip: (v: unknown, ...others: unknown[]) => {
			const lists = [itemsOf(v), ...others.filter((o) => !isKwargs(o)).map(itemsOf)];
			const n = Math.min(...lists.map((l) => l.length));
			return Array.from({ length: n }, (_, i) => tuple(lists.map((l) => l[i])));
		},
		chain: (v: unknown, ...others: unknown[]) => [v, ...others.filter((o) => !isKwargs(o))].flatMap(itemsOf),
		groupby: (v: unknown, ...args: unknown[]) => {
			const [attr, fallback, caseSensitive] = named(args, ["attribute", "default", "case_sensitive"]);
			const groups = new Map<unknown, { grouper: unknown; list: unknown[] }>();
			for (const item of itemsOf(v)) {
				let value = attribute(item, attr);
				if (value === undefined) value = fallback;
				const key = sortKey(value, caseSensitive);
				let group = groups.get(key);
				if (!group) groups.set(key, (group = { grouper: value, list: [] }));
				group.list.push(item);
			}
			// Jinja's groups, in order of their key: each is `[grouper, list]`, and has `.grouper` and `.list`.
			return [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, g]) => Object.assign([g.grouper, g.list], g));
		},
		sum: (v: unknown, ...args: unknown[]) => {
			const [attr, start] = named(args, ["attribute", "start"]);
			let total = start === undefined || start === null ? 0 : Number(start);
			for (const item of itemsOf(v)) total += Number(attr === undefined || attr === null ? item : attribute(item, attr));
			return total;
		},
		round: (v: unknown, ...args: unknown[]) => {
			const [precision, method] = named(args, ["precision", "method"]);
			const p = precision === undefined || precision === null ? 0 : Number(precision);
			const how = method === undefined || method === null ? "common" : String(method);
			if (typeof v !== "number") throw invalid(`cannot round value (${kind(v)})`);
			const n = v;
			if (how === "ceil" || how === "floor") return Math[how](n * 10 ** p) / 10 ** p;
			if (how !== "common") throw invalid("method must be common, ceil or floor");
			return roundHalfEven(n, p);
		},
		join: (v: unknown, ...args: unknown[]) => {
			const [sep, attr] = named(args, ["d", "attribute"]);
			return itemsOf(v).map((item) => toText(attr === undefined || attr === null ? item : attribute(item, attr))).join(sep === undefined || sep === null ? "" : String(sep));
		},
		dictsort: (v: unknown, ...args: unknown[]) => {
			const [caseSensitive, by, reverse] = named(args, ["case_sensitive", "by", "reverse"]);
			if (v === undefined || v === null || typeof v !== "object") throw invalid("cannot convert value into pair list");
			const at = by === "value" ? 1 : 0;
			const pairs = Object.entries(v).map(tuple);
			pairs.sort((a, b) => compare(sortKey(a[at], caseSensitive), sortKey(b[at], caseSensitive)));
			return reverse ? pairs.reverse() : pairs;
		},
		indent: (v: unknown, ...args: unknown[]) => {
			const [width, first, blank] = named(args, ["width", "first", "blank"]);
			const pad = typeof width === "string" ? width : " ".repeat(width === undefined || width === null ? 4 : Number(width));
			const parts = String(v ?? "").split("\n");
			return parts.map((line, i) => ((i === 0 && !first) || (!blank && line.trim() === "") ? line : pad + line)).join("\n");
		},
		title: (v: unknown) => titleCase(toText(v)),
		upper: (v: unknown) => toText(v).toUpperCase(),
		lower: (v: unknown) => toText(v).toLowerCase(),
		capitalize: (v: unknown) => STRING_METHODS.capitalize(toText(v)),
		urlencode,
		// `default(x, true)` replaces a false value by Jinja's truth (an empty list is false).
		default: (v: unknown, fallback: unknown = "", boolean?: unknown) => (boolean ? (truthy(v) ? v : fallback) : v === undefined ? fallback : v),
		// Nunjucks' `nl2br`, with what it's given escaped and its own `<br />` kept.
		nl2br: (v: unknown) => (v instanceof SafeString ? safe(String(v).replace(/\r\n|\n/g, "<br />\n")) : safe(escape(toText(v)).replace(/\r\n|\n/g, "<br />\n"))),
		// A missing value is an empty list here, as in 0.7 (nunjucks' own filters failed on it), and
		// a string is its characters, emoji and all.
		length: (v: unknown) => (v === undefined || v === null ? 0 : isString(v) ? chars(String(v)).length : v instanceof Map || v instanceof Set ? v.size : isPlain(v) ? Object.keys(v).length : (v as { length?: number }).length ?? 0),
		first: (v: unknown) => (isString(v) ? chars(String(v))[0] : Array.isArray(v) ? v[0] : v === undefined || v === null ? undefined : itemsOf(v)[0]),
		last: (v: unknown) => {
			const items = isString(v) ? chars(String(v)) : Array.isArray(v) ? v : v === undefined || v === null ? [] : itemsOf(v);
			return items[items.length - 1];
		},
		reverse: (v: unknown) => (v === undefined || v === null ? undefined : isString(v) ? chars(String(v)).reverse().join("") : [...itemsOf(v)].reverse()),
		batch: (v: unknown, size: unknown, fill?: unknown) => {
			const items = itemsOf(v), n = Math.max(Number(size) || 1, 1), out: unknown[][] = [];
			for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
			const last = out[out.length - 1];
			if (last && fill !== undefined && fill !== null) while (last.length < n) last.push(fill);
			return out;
		},
		slice: (v: unknown, count: unknown, fill?: unknown) => {
			const items = itemsOf(v), n = Math.max(Number(count) || 1, 1), out: unknown[][] = [];
			const per = Math.floor(items.length / n), extra = items.length % n;
			let at = 0;
			for (let i = 0; i < n; i++) {
				const size = per + (i < extra ? 1 : 0);
				const part = items.slice(at, at + size);
				at += size;
				if (fill !== undefined && fill !== null && i >= extra) part.push(fill);
				out.push(part);
			}
			return out;
		},
		trim: (v: unknown, chars?: unknown) => trimChars(String(v ?? ""), chars === undefined || chars === null ? undefined : String(chars), true, true),
		list: (v: unknown) => [...itemsOf(v)],
		string: (v: unknown) => (v instanceof SafeString ? v : toText(v)),
		select: function (this: unknown, v: unknown, ...args: unknown[]) { return selectBy(this, v, args, true, false); },
		reject: function (this: unknown, v: unknown, ...args: unknown[]) { return selectBy(this, v, args, false, false); },
		selectattr: function (this: unknown, v: unknown, ...args: unknown[]) { return selectBy(this, v, args, true, true); },
		rejectattr: function (this: unknown, v: unknown, ...args: unknown[]) { return selectBy(this, v, args, false, true); },
	};
	// Nunjucks' name for `tojson`, which 0.7 gave it in `.jinja`. In `.njk` it's Nunjucks' own:
	// compact JSON (`spaces` indents it), escaped when it's printed, as a site from Eleventy has it.
	if (flavor === "njk") filters.dump = (v: unknown, spaces?: unknown) => JSON.stringify(v, null, typeof spaces === "number" || typeof spaces === "string" ? spaces : undefined) ?? "";
	else filters.dump = filters.tojson;
	return filters;
}

function extreme(v: unknown, args: unknown[], direction: number): unknown {
	const [caseSensitive, attr] = named(args, ["case_sensitive", "attribute"]);
	let best: unknown, bestKey: unknown;
	for (const item of itemsOf(v)) {
		const key = sortKey(attr === undefined || attr === null ? item : attribute(item, attr), caseSensitive);
		if (best === undefined || compare(key, bestKey) === direction) [best, bestKey] = [item, key];
	}
	return best;
}

/** `select("odd")`, `selectattr("draft")`, `rejectattr("age", "gt", 20)`: a test for each item (truth when none is named). */
function selectBy(context: unknown, v: unknown, args: unknown[], keep: boolean, byAttribute: boolean): unknown[] {
	const list = args.filter((a) => !isKwargs(a));
	const attr = byAttribute ? list.shift() : undefined;
	const name = list.shift();
	const test = name === undefined ? undefined : (context as { env: { getTest(name: string): Fn } }).env.getTest(String(name));
	return itemsOf(v).filter((item) => {
		const value = byAttribute ? attribute(item, attr) : item;
		const ok = test ? test.call(context, value, ...list) === true : truthy(value);
		return ok === keep;
	});
}

// ---- tests and functions ----------------------------------------------------------------------

/** The tests 0.7's Jinja had that nunjucks hasn't, and the ones it answers another way. */
export function jinjaTests(env: nunjucks.Environment): Record<string, Fn> {
	const all = env as unknown as { filters: Record<string, unknown>; tests: Record<string, unknown> };
	return {
		truthy: (v: unknown) => truthy(v),
		falsy: (v: unknown) => !truthy(v),
		boolean: (v: unknown) => typeof v === "boolean",
		true: (v: unknown) => v === true,
		false: (v: unknown) => v === false,
		none: (v: unknown) => v === null,
		integer: (v: unknown) => Number.isInteger(v),
		int: (v: unknown) => Number.isInteger(v),
		float: (v: unknown) => typeof v === "number" && !Number.isInteger(v),
		string: (v: unknown) => isString(v),
		safe: (v: unknown) => v instanceof SafeString,
		escaped: (v: unknown) => v instanceof SafeString,
		sequence: (v: unknown) => Array.isArray(v),
		iterable: (v: unknown) => Array.isArray(v) || isString(v) || isPlain(v) || (typeof v === "object" && v !== null && Symbol.iterator in v),
		startingwith: (v: unknown, prefix: unknown) => isString(v) && String(v).startsWith(String(prefix)),
		endingwith: (v: unknown, suffix: unknown) => isString(v) && String(v).endsWith(String(suffix)),
		in: (v: unknown, seq: unknown) => (isString(seq) ? String(seq).includes(String(v)) : Array.isArray(seq) ? seq.includes(v) : typeof seq === "object" && seq !== null ? Object.hasOwn(seq, String(v)) : false),
		filter: (v: unknown) => typeof v === "string" && Object.hasOwn(all.filters, v),
		test: (v: unknown) => typeof v === "string" && Object.hasOwn(all.tests, v),
	};
}

/** The functions 0.7's Jinja had that nunjucks hasn't: `dict()`, `namespace()`, and Python's names for true, false and none (`now()` is the engine's). */
export function jinjaGlobals(): Record<string, unknown> {
	return {
		dict: (...args: unknown[]) => Object.assign({}, ...args.filter((a) => typeof a === "object" && a !== null).map(withoutMarker)),
		namespace: (...args: unknown[]) => {
			const ns = Object.assign({}, ...args.filter((a) => typeof a === "object" && a !== null).map(withoutMarker));
			namespaces.add(ns);
			return ns;
		},
		True: true,
		False: false,
		None: null,
	};
}

/** Keyword arguments as a plain object for a site's own function (`slugify(title, separator="_")`). */
export function siteArgs(args: unknown[]): unknown[] {
	const last = args[args.length - 1];
	return isKwargs(last) ? [...args.slice(0, -1), withoutMarker(last)] : args;
}

/**
 * In Markdown, `{#id}` at the end of a line is a heading attribute (`## Install {#setup
 * .wide}`), not the start of a comment: it's wrapped in `{% raw %}` so it reaches the Markdown
 * renderer as written. A comment that ends on the same line (`{# note #}`) stays a comment.
 */
export function markdownAttributes(source: string): string {
	if (!source.includes("{#")) return source;
	return source.replace(/\{#(?:[A-Za-z_][^}\n]*[^#}\n]|[A-Za-z_])\}[ \t]*\r?$/gm, "{% raw %}$&{% endraw %}");
}
