// ssqch's slugs: `slugify("Pine Cone Crunch!")` is `pine-cone-crunch`.
import { BuildError } from "./diagnostics.ts";
import { isPlainObject } from "./data.ts";

const ALPHANUMERIC = /[\p{Alphabetic}\p{N}]/u;

/**
 * `text` lowercased a character at a time, as 0.7 (Rust's `char::to_lowercase`) did. JavaScript
 * lowercases a whole string by its context, and the one rule that has is the Greek final sigma:
 * `ΟΔΟΣ` is `οδος` there and `οδοσ` here.
 */
function lowercase(text: string): string {
	if (!text.includes("Σ")) return text.toLowerCase();
	let out = "";
	for (const c of text) out += c.toLowerCase();
	return out;
}

/**
 * Lowercase letters and digits (of any script), with `separator` for each run of anything else.
 * An apostrophe is dropped (`drews-brownies`), or separates words like other punctuation with
 * `apostrophesSeparate` (`drew-s-brownies`).
 */
export function slugWith(text: string, separator: string, apostrophesSeparate: boolean): string {
	let out = "";
	let gap = false;
	for (const c of lowercase(text)) {
		if (ALPHANUMERIC.test(c)) {
			if (gap && out !== "") out += separator;
			gap = false;
			out += c;
		} else if (apostrophesSeparate || (c !== "'" && c !== "’")) {
			gap = true;
		}
	}
	return out;
}

/** Letters NFD doesn't take apart, and the symbols the slugify package spells out, for `ascii: true`. */
const ASCII: Record<string, string> = { "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "œ": "oe", "Œ": "OE", "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "ł": "l", "Ł": "L", "þ": "th", "Þ": "TH", "ı": "i", "&": " and ", "$": " dollar ", "%": " percent ", "€": " euro ", "£": " pound ", "¥": " yen ", "©": " c ", "®": " r ", "™": " tm ", "<": " less ", ">": " greater ", "|": " or ", "♥": " love ", "∞": " infinity " };

/** `text` in ASCII where it can be: accents off (`ö` is `o`), a few letters spelled out (`ß` is `ss`), and the symbols the slugify package names (`&` is `and`). Other scripts stay as they are. */
export function toAscii(text: string): string {
	return text.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[ßæÆøØœŒđĐðÐłŁþÞı&$%€£¥©®™<>|♥∞]/g, (c) => ASCII[c]);
}

/** `text` without its HTML tags (`Use <code>title</code>` is `Use title`) and with `&amp;`-style entities read. */
function withoutTags(text: string): string {
	return text.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " " })[e] ?? "");
}

/**
 * `slugify`'s options: a separator (`"_"`), or `{ separator, apostrophes }`, where `apostrophes`
 * is `"drop"` (the default) or `"separate"`. Returns the separator and whether apostrophes
 * separate words.
 */
export function slugOptions(option: unknown): [string, boolean] {
	if (option === undefined || option === null) return ["-", false];
	if (typeof option === "string") return [option, false];
	if (isPlainObject(option)) {
		const unknown = Object.keys(option).find((k) => !["separator", "apostrophes", "ascii", "stripTags"].includes(k));
		if (unknown !== undefined) throw new BuildError(`slugify: unknown option \`${unknown}\` (options: separator, apostrophes, ascii, stripTags)`);
		for (const key of ["ascii", "stripTags"]) if (option[key] !== undefined && typeof option[key] !== "boolean") throw new BuildError(`slugify: \`${key}\` is true or false, not ${String(option[key])}`);
		const separator = option.separator === undefined || option.separator === null ? "-" : String(option.separator);
		const a = option.apostrophes;
		if (a === undefined || a === null || a === "drop") return [separator, false];
		if (a === "separate") return [separator, true];
		throw new BuildError(`slugify: \`apostrophes\` is "drop" or "separate", not ${String(a)}`);
	}
	throw new BuildError(`slugify: the second argument is a separator ("_") or { separator, apostrophes }, not a ${typeof option}`);
}

/** The text `slugify` slugs: without tags first with `stripTags`, then in ASCII with `ascii` (the slugify package's habits: `Thomas Sjögren` is `thomas-sjogren`). */
export function slugText(text: string, option: unknown): string {
	if (!isPlainObject(option)) return text;
	let out = text;
	if (option.stripTags === true) out = withoutTags(out);
	if (option.ascii === true) out = toAscii(out);
	return out;
}

/** The `slugify` every template has, and `slugify` from "ssqch". */
export function slugify(text: unknown, options?: unknown): string {
	const [separator, apostrophes] = slugOptions(options);
	return slugWith(slugText(text === undefined || text === null ? "" : String(text), options), separator, apostrophes);
}
