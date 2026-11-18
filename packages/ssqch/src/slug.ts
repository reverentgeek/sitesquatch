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

/**
 * `slugify`'s options: a separator (`"_"`), or `{ separator, apostrophes }`, where `apostrophes`
 * is `"drop"` (the default) or `"separate"`. Returns the separator and whether apostrophes
 * separate words.
 */
export function slugOptions(option: unknown): [string, boolean] {
	if (option === undefined || option === null) return ["-", false];
	if (typeof option === "string") return [option, false];
	if (isPlainObject(option)) {
		const unknown = Object.keys(option).find((k) => k !== "separator" && k !== "apostrophes");
		if (unknown !== undefined) throw new BuildError(`slugify: unknown option \`${unknown}\` (options: separator, apostrophes)`);
		const separator = option.separator === undefined || option.separator === null ? "-" : String(option.separator);
		const a = option.apostrophes;
		if (a === undefined || a === null || a === "drop") return [separator, false];
		if (a === "separate") return [separator, true];
		throw new BuildError(`slugify: \`apostrophes\` is "drop" or "separate", not ${String(a)}`);
	}
	throw new BuildError(`slugify: the second argument is a separator ("_") or { separator, apostrophes }, not a ${typeof option}`);
}

/** The `slugify` every template has, and `slugify` from "ssqch". */
export function slugify(text: unknown, options?: unknown): string {
	const [separator, apostrophes] = slugOptions(options);
	return slugWith(text === undefined || text === null ? "" : String(text), separator, apostrophes);
}
