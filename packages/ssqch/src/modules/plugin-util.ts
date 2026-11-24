// Small helpers the built-in plugins share.
import { shownAsUtc } from "../data.ts";

/** Escapes text for HTML as 0.7's `escape_html` did (the same entities as Edge): `&`, `<`, `>`, `"`, `'` and `` ` ``. */
export function escapeHtml(s: string): string {
	return s.replace(/[&<>"'`]/g, (c) => ENTITIES[c]);
}
const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#x27;", "`": "&#x60;" };

/** A string as Rust's `{:?}` writes it: in double quotes, with `"`, `\` and control characters escaped. */
export function debugString(s: string): string {
	let out = "\"";
	for (const c of s) {
		if (c === "\"") out += "\\\"";
		else if (c === "\\") out += "\\\\";
		else if (c === "\n") out += "\\n";
		else if (c === "\r") out += "\\r";
		else if (c === "\t") out += "\\t";
		else if (c === "\0") out += "\\0";
		else if (c.charCodeAt(0) < 0x20 || c === "\x7f") out += `\\u{${c.charCodeAt(0).toString(16)}}`;
		else out += c;
	}
	return `${out}"`;
}

/** `YYYY-MM-DD`, in UTC. */
export function isoDay(given: Date): string {
	const d = shownAsUtc(given);
	return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
