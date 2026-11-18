// What the build reads from a page's rendered HTML: its headings (`page.headings`), its excerpt
// (`page.excerpt`), its text (for `readingTime`), and the table of contents the `toc` filter makes.

/** A heading found in a page's HTML, for `page.headings`. `text` is without tags and without anything inside an `aria-hidden="true"` element (such as an anchor link's `#`). */
export interface Heading {
	level: number;
	id: string | undefined;
	text: string;
}

const HEADING = /<h([1-6])(\s[^>]*)?>(.*?)<\/h[1-6]\s*>/gis;
const ID_ATTR = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)([^>]*)>|<!--.*?-->/gs;
const HIDDEN = /\saria-hidden\s*=\s*["']?true/i;
const CODE = /<!--.*?-->|<(pre|code|script|style|template|textarea)\b.*?<\/(?:pre|code|script|style|template|textarea)\s*>/gis;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** The `<h1>` to `<h6>` headings in some HTML, in order. Headings shown as code (inside `<pre>`, `<code>`, a script, a comment) don't count. */
export function headings(html: string): Heading[] {
	if (!html.includes("<h") && !html.includes("<H")) return [];
	const out: Heading[] = [];
	for (const found of html.replace(CODE, "").matchAll(HEADING)) {
		const id = ID_ATTR.exec(found[2] ?? "");
		const value = id ? id[1] ?? id[2] ?? id[3] : undefined;
		out.push({ level: Number(found[1]), id: value === undefined ? undefined : decodeEntities(value), text: htmlText(found[3]) });
	}
	return out;
}

/** The text of some HTML: tags removed, entities decoded, whitespace collapsed, and `aria-hidden="true"` elements left out. */
export function htmlText(html: string): string {
	let text = "";
	let hidden = 0;
	let last = 0;
	for (const found of html.matchAll(TAG)) {
		if (hidden === 0) text += html.slice(last, found.index);
		last = found.index + found[0].length;
		if (found[2] === undefined) continue;
		const name = found[2].toLowerCase();
		const attrs = found[3] ?? "";
		if (VOID.has(name) || attrs.endsWith("/")) {
			if (name === "br" && hidden === 0) text += " ";
			continue;
		}
		if (found[1] === "/") hidden = Math.max(0, hidden - 1);
		else if (hidden > 0 || HIDDEN.test(attrs)) hidden++;
	}
	if (hidden === 0) text += html.slice(last);
	return splitWhitespace(decodeEntities(text)).join(" ");
}

/** A text's words: split at Unicode whitespace, with no empty ones. */
export function splitWhitespace(text: string): string[] {
	return text.split(/[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/).filter((word) => word !== "");
}

const ENTITY = /&(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z]+);/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** Decodes the entities Markdown and templates write: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&apos;`, `&nbsp;` and numeric ones. */
export function decodeEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(ENTITY, (whole, name: string) => {
		// Its own keys only: `&constructor;` isn't an entity.
		if (Object.hasOwn(NAMED, name)) return NAMED[name];
		if (name[0] !== "#") return whole;
		const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
		// A number that isn't a character (a surrogate, or past the last one) stays as written.
		return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
	});
}

/** Escapes text for HTML: `&`, `<`, `>` and `"`. */
export function escapeText(s: string): string {
	return s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}

/** Escapes a value for an attribute or for text, as template engines do: `&`, `<`, `>`, `"` and `'`. */
export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "\"" ? "&quot;" : "&#39;"));
}

/** The HTML before a `<!-- more -->` comment, or else the first paragraph. */
export function excerpt(html: string): string | undefined {
	const more = /<!--\s*more\s*-->/.exec(html);
	if (more) return html.slice(0, more.index).trim();
	return /<p(?:\s[^>]*)?>.*?<\/p>/is.exec(html)?.[0];
}

/** A nested list of links to the headings with an `id` from level `from` to `to`, for the `toc` filter. */
export function toc(list: unknown[], from: number, to: number, ordered: boolean): string {
	const tag = ordered ? "ol" : "ul";
	const items: Heading[] = [];
	for (const v of list) {
		const h = v as Partial<Heading> | null | undefined;
		if (typeof h?.level !== "number") continue;
		const level = Math.trunc(h.level);
		const id = typeof h.id === "string" && h.id !== "" ? h.id : undefined;
		if (id !== undefined && level >= from && level <= to) items.push({ level, id, text: String(h.text) });
	}
	let out = "";
	const stack: number[] = [];
	for (const h of items) {
		if (!stack.length) {
			out += `<${tag}>`;
			stack.push(h.level);
		} else {
			while (stack.length > 1 && h.level < stack[stack.length - 1]) {
				out += `</li></${tag}>`;
				stack.pop();
			}
			if (h.level > stack[stack.length - 1]) {
				out += `<${tag}>`;
				stack.push(h.level);
			} else {
				out += "</li>";
			}
		}
		out += `<li><a href="#${escapeHtml(h.id ?? "")}">${escapeText(h.text)}</a>`;
	}
	for (const _ of stack) out += `</li></${tag}>`;
	return out;
}
