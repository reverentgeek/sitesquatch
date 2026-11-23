// What `strict` says about an undefined value: its name, and the nearest name beside it in the
// page's data (`t.buttons.allSnaks` is undefined; did you mean `t.buttons.allSnacks`?). Squatch
// Snacks mistyped a key in a strings file, and the error named only the line (E4). Each engine
// finds the name its own way; the data is the render's (`currentRendering()`).
import type { Data } from "./data.ts";
import { currentRendering } from "./rendering.ts";
import { closest } from "./suggest.ts";

/** A dotted name at the start of an expression: `t.buttons.allSnaks`, `post.tags[0]`. */
const PATH = /^\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*|\[\s*\d+\s*\])*)/;

/** The parts of a dotted name (`post.tags[0]` -> post, tags, 0). */
function partsOf(name: string): string[] {
	return name.replace(/\s+/g, "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
}

/** The first `count` parts of `name` as it's written, ready for the next (`posts[0].`). */
function written(name: string, count: number): string {
	const tokens = name.replace(/\s+/g, "").match(/[A-Za-z_$][\w$]*|\[\d+\]/g) ?? [];
	return tokens.slice(0, count).map((t, i) => (t.startsWith("[") || i === 0 ? t : `.${t}`)).join("") + (count ? "." : "");
}

/** A value's property, or `undefined`, without throwing on a getter or a proxy. */
function get(value: unknown, key: string): unknown {
	if (value === null || value === undefined || (typeof value !== "object" && typeof value !== "function")) return undefined;
	try { return (value as Record<string, unknown>)[key]; } catch { return undefined; }
}

/** The names a value has, its own and inherited (a layout's data sees the page's through its prototype). */
function keysOf(value: unknown): string[] {
	if (value === null || typeof value !== "object") return [];
	const out = new Set<string>();
	try { for (const key in value as object) out.add(key); } catch { return [...out]; }
	return [...out];
}

/** The render's data, if a page is rendering. */
export const renderData = (): Data | undefined => currentRendering()?.data;

/**
 * `; did you mean `t.buttons.allSnacks`?` for an undefined `name`, to go inside "(strict is on)":
 * the first part that isn't there, swapped for the closest name its parent has. Nothing when no
 * name is close, when nothing is rendering, or when the name's start isn't in the data (a loop's
 * variable).
 */
export function didYouMean(name: string, data: Data | undefined = renderData()): string {
	if (data === undefined) return "";
	const parts = partsOf(name);
	let at: unknown = data;
	for (let i = 0; i < parts.length; i++) {
		const next = get(at, parts[i]);
		if (next === undefined) {
			// `item.nme` in a loop: `item` is the loop's, not the data's, and `items` would mislead.
			if (i === 0 && parts.length > 1) return "";
			const near = closest(parts[i], keysOf(at));
			return near === undefined ? "" : `; did you mean \`${written(name, i)}${near}\`?`;
		}
		at = next;
	}
	return "";
}

/** `` `name` is undefined (strict is on) ``, with the nearest name when one is close. */
export function undefinedMessage(name: string, data?: Data): string {
	return `\`${name}\` is undefined (strict is on${didYouMean(name, data ?? renderData())})`;
}

/**
 * The one name on a line that a template printed undefined, for an engine that says only that
 * something was (Nunjucks' "attempted to output null or undefined value"): each `open ... close`
 * on the line is read for the name at its start, and the ones the data has are passed over. More
 * than one left, or none, is `undefined`: the message stays general rather than name the wrong one.
 */
export function undefinedOnLine(line: string, open: string, close: string, data: Data | undefined = renderData()): string | undefined {
	const names: string[] = [];
	for (let at = line.indexOf(open); at !== -1; at = line.indexOf(open, at + open.length)) {
		const end = line.indexOf(close, at + open.length);
		const inside = line.slice(at + open.length, end === -1 ? undefined : end).replace(/^[-~=]/, "");
		const name = PATH.exec(inside)?.[1];
		if (name === undefined || ["true", "false", "none", "null", "loop", "super"].includes(name)) continue;
		let value: unknown = data;
		for (const part of partsOf(name)) value = get(value, part);
		if (data === undefined || value === undefined || value === null) names.push(name.replace(/\s+/g, ""));
	}
	const distinct = [...new Set(names)];
	return distinct.length === 1 ? distinct[0] : undefined;
}
