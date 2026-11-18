// Size budgets: `budgets: { pages: "150 KB", total: "300 MB" }` in the config. A file over its
// kind's budget is an `over-budget` warning after each build (the footprint module measures).
import { bail } from "./diagnostics.ts";
import { quoted } from "./quote.ts";
import { closest } from "./suggest.ts";

/** The names `budgets` takes: each kind of file, as the config writes it and as reports print it, and `total`. */
export const BUDGETS: ReadonlyArray<readonly [string, string]> = [
	["pages", "Pages"],
	["images", "Images"],
	["css", "CSS"],
	["javascript", "JavaScript"],
	["fonts", "Fonts"],
	["media", "Media"],
	["documents", "Documents"],
	["data", "Data and feeds"],
	["other", "Other"],
	["total", ""],
];

/** A size as a config writes it: bytes, or `"150 KB"`, `"1.5 MB"`, `"500 B"` (powers of 1,000, as ssqch's reports print them). */
export function parseSize(text: string): number | undefined {
	const trimmed = text.trim();
	const split = trimmed.search(/[A-Za-z]/);
	const digits = (split === -1 ? trimmed : trimmed.slice(0, split)).trim();
	// As Rust reads a float, which takes a sign (`-0` is 0, and anything else below it isn't a
	// size). An exponent never gets here: its `e` starts the unit.
	if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(digits) || !(Number(digits) >= 0)) return undefined;
	const unit = { "": 1, B: 1, KB: 1e3, K: 1e3, MB: 1e6, M: 1e6, GB: 1e9, G: 1e9 }[(split === -1 ? "" : trimmed.slice(split)).trim().toUpperCase()];
	if (unit === undefined) return undefined;
	return Math.round(Number(digits) * unit);
}

/** A `budgets` entry, checked: the name and the size in bytes. */
export function budget(name: string, given: unknown): [string, number] {
	// A BigInt (`10n`) is a number, as 0.7 read one.
	const size = typeof given === "bigint" ? Number(given) : given;
	const names = BUDGETS.map(([key]) => key);
	if (!names.includes(name)) {
		const near = closest(name, names);
		bail(`budgets.${name} isn't a kind of file${near ? ` (did you mean \`${near}\`?)` : ""} (use ${names.join(", ")})`);
	}
	if (typeof size === "number" && size >= 0) return [name, Math.trunc(size)];
	if (typeof size === "string") {
		const bytes = parseSize(size);
		if (bytes === undefined) bail(`budgets.${name}: ${quoted(size)} isn't a size (write it like "150 KB" or "1.5 MB")`);
		return [name, bytes];
	}
	return bail(`budgets.${name} must be a size like "150 KB", not ${typeof size}`);
}
