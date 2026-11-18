// Values quoted and padded as 0.7 printed them in its messages and reports.
//
// 0.7 quoted a string in a message with Rust's `{:?}`: in double quotes, with `\n`, `\t`, `\"`
// and `\\` escaped, and every character that doesn't print (a control character, a format
// character such as a zero-width space, any space but the plain one, and a combining mark) as
// `\u{hex}`. `JSON.stringify` is close, but not the same for those, so messages that quote what
// a site wrote use this.

/** Characters Rust's `{:?}` writes as `\u{hex}`: what isn't printable (any space but ` `), and combining marks. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}\p{Grapheme_Extend}]/u;

function escaped(c: string, quote: string): string {
	switch (c) {
		case "\0": return "\\0";
		case "\t": return "\\t";
		case "\r": return "\\r";
		case "\n": return "\\n";
		case "\\": return "\\\\";
		case quote: return `\\${quote}`;
		case " ": return " ";
	}
	return UNPRINTABLE.test(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c;
}

/** A string as Rust's `{:?}` writes it: `"pine \"cone\""`. */
export function quoted(text: string): string {
	let out = "\"";
	// The usual case, printable ASCII, as it is.
	if (/^[\x20-\x7e]*$/.test(text) && !/["\\]/.test(text)) return `"${text}"`;
	for (const c of text) out += escaped(c, "\"");
	return out + "\"";
}

/** A character as Rust's `{:?}` writes it: `'|'`. */
export function quotedChar(c: string): string {
	return `'${escaped(c, "'")}'`;
}

/** How many characters `text` has, as Rust counts them (code points, not UTF-16 units). */
export const charCount = (text: string) => {
	let n = 0;
	for (const _ of text) n++;
	return n;
};

/** `text` and spaces, to `width` characters (Rust's `{:<width$}`). */
export const padEnd = (text: string, width: number) => text + " ".repeat(Math.max(0, width - charCount(text)));

/** Spaces and `text`, to `width` characters (Rust's `{:>width$}`). */
export const padStart = (text: string, width: number) => " ".repeat(Math.max(0, width - charCount(text))) + text;

/** The first `n` characters of `text`, by code point. */
export function firstChars(text: string, n: number): string {
	if (text.length <= n) return text;
	let out = "";
	let i = 0;
	for (const c of text) {
		if (i++ === n) break;
		out += c;
	}
	return out;
}

/** JavaScript's `String(value)` as 0.7 had it: a date in UTC with milliseconds (`String(date)` is in the machine's time zone, and a report mustn't depend on that), and a list's items joined with commas. */
export function jsString(value: unknown): string {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
	if (Array.isArray(value)) return value.map((v) => (v === undefined || v === null ? "" : jsString(v))).join(",");
	if (typeof value === "function") return "function () { [native code] }";
	if (value !== null && typeof value === "object") return "[object Object]";
	return String(value);
}

/**
 * A value as 0.7's reports wrote it in JSON: dates as ISO 8601 in UTC, functions and
 * `undefined` left out of objects (and `null` in lists), numbers that aren't finite as `null`.
 * Data that refers to itself (which Node allows) stops at the repeat, as `null`.
 */
export function toJsonValue(value: unknown, above: Set<object> = new Set()): unknown {
	if (value === undefined || value === null || typeof value === "function" || typeof value === "symbol") return null;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "bigint") return Number(value);
	if (typeof value !== "object") return value;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
	if (above.has(value)) return null;
	above.add(value);
	let out: unknown;
	if (Array.isArray(value)) out = value.map((v) => toJsonValue(v, above));
	else {
		const obj: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
			obj[key] = toJsonValue(v, above);
		}
		out = obj;
	}
	above.delete(value);
	return out;
}
