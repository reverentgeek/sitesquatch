// `ssqch diff`: compare two builds of a site, file by file.
//
// Build the site before a change (an upgrade, a refactor, a migration) into one folder and after
// it into another, and this says what the change did to the output: which URLs were added and
// removed, and what changed on the pages that differ.
//
// Unless `exact` is set, differences that don't matter are ignored (with `exact`, only the `ignore`
// patterns are, so "byte for byte but this" can be said):
//
// - asset fingerprints (`index.3f2a1b4c.css` and `index.9d8e7f6a.css` are the same file,
//   compared by content) and `integrity` hashes,
// - the generator's version (`SiteSquatch v0.4.0`),
// - whitespace between tags, inside text and between attributes (but not in `<pre>`,
//   `<script>`, `<style>` or `<textarea>`, or in an attribute's value),
// - anything matching one of the `ignore` patterns.
//
// HTML is compared as a list of tags and pieces of text, so a minified page still gets a
// readable diff, and each changed page says whether its text, its markup or both changed.
// Ported from 0.7's `diff.rs`; its regular expressions were Rust's, where `\d`, `\s` and `\b`
// are Unicode's, so these spell those out.
import fs from "node:fs";
import path from "node:path";
import { BuildError, bail } from "./diagnostics.ts";
import { buildFiles, urlOf } from "./footprint.ts";
import { redirectRules, ruleFor } from "./modules/links.ts";
import { diffOps } from "./myers.ts";
import { compareText } from "./paths.ts";
import { firstChars, quoted } from "./quote.ts";
import { bytes, count } from "./report.ts";
import * as voice from "./voice.ts";

export interface DiffOptions {
	/** Compare bytes: no fingerprint matching, and nothing ignored but the `ignore` patterns. */
	exact: boolean;
	/** Text matching one of these is left out of both sides before comparing. */
	ignore: RegExp[];
	/** List each file with all its changes, without groups (`--ungrouped`). */
	ungrouped?: boolean;
	/** Only compare files whose path (from the build's root, with `/`) matches one of these. */
	only: RegExp[] | undefined;
	/** `--only` as it was given, for the error when it matches nothing. */
	onlyGiven?: string[];
	/** Leave out files whose path matches one of these (after `only`). */
	exclude?: RegExp[];
	/** The changed lines to keep for each file (0 for all): the report shows no more, so a big change doesn't fill memory. */
	lines: number;
}

/** One side of a removed or added run of lines. */
export interface Hunk {
	removed: string[];
	added: string[];
	/** Where on a page it is: the nearest heading above it, `#its-id` or its text in quotes. */
	at?: string;
}

/** A file that's in both builds with different contents. */
export interface FileDiff {
	/** The file's path in the build, without a fingerprint: `assets/index.css`. */
	path: string;
	/** `/about/` for `about/index.html`, `/feed.xml` for `feed.xml`. */
	url: string;
	/** The file's own paths, when a fingerprint makes them differ. */
	renamed: [string, string] | undefined;
	kind: "page" | "text" | "binary";
	/** For a page: `text`, `markup` or both. */
	what: string[];
	/** For a page: a changed title, ids that are gone. */
	notes: string[];
	/** The changed lines, up to `lines` of them. */
	hunks: Hunk[];
	/** How many lines changed (removed and added), all of them. */
	changedLines: number;
	/** Every change is a date or a year (`2025` to `2026`): the first one. */
	onlyDates: [string, string] | undefined;
	sizeBefore: number;
	sizeAfter: number;
	/** Every changed run, while the comparison groups them; gone from the report. */
	allHunks?: Hunk[];
	/** The groups (by their place in `groups`) that hold some of its changes. */
	groups: number[];
	/** Its changes no group holds, up to `lines` of them: what's left to show for it alone. */
	ownHunks: Hunk[];
	/** How many changed lines no group holds, all of them. */
	ownLines: number;
}

/**
 * One change on more than one file (a hunk the same on each, or the same but for its attribute
 * values): what a migration fixes once for all of them. Every move ran the loop "fix the biggest
 * group of differences, repeat" by hand, and opensource.guide's 387 changed pages took a
 * classifier of their own to turn into groups (osg `scripts/compare.py`).
 */
export interface DiffGroup {
	/** The files that have it, by their URL, in the report's order. */
	urls: string[];
	/** `false` when its lines differ from file to file (the lines are the first file's). */
	same: boolean;
	/** How alike its changes are: `lines` (the same), `values` (the same but for attribute values), `tags` (the same tags, with other attributes, or a line repeated another number of times), or `dates` (the same dates changed, in other text). */
	match: "lines" | "values" | "tags" | "dates";
	/** What it changes: `dates`, `order` (the same lines, moved), `markup`, `text`, or `markup and text`. */
	kind: string;
	/** The change, as the first file has it. */
	hunk: Hunk;
	/** What the change is, when it's one a move from another generator always has (`a client app's scripts`, Shiki's colors): it's expected, not a mistake in the port. */
	known?: string;
}

export interface DiffReport {
	before: string;
	after: string;
	exact: boolean;
	/** URLs only in the second build. */
	added: string[];
	/** URLs only in the first build. */
	removed: string[];
	/** Each removed URL the second build's `_redirects` sends on, and where. */
	redirects: Record<string, string>;
	changed: FileDiff[];
	/** Changes on more than one file, the most files first. Empty with `--ungrouped`. */
	groups: DiffGroup[];
	unchangedPages: number;
	unchangedFiles: number;
}

export const isSame = (r: DiffReport) => !r.added.length && !r.removed.length && !r.changed.length;

// What Rust's regular expressions mean by a word character, a digit and a space.
const WORD = String.raw`[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]`;
const START = `(?<!${WORD})`;
const END = `(?!${WORD})`;

const FINGERPRINT = new RegExp(String.raw`([.\-])([0-9A-Za-z_\-]{8})\.(css|js|mjs|map|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|json|xml|txt|pdf|wasm)` + END, "gu");
// Vue's scoped-style attributes and its server renderer's fragment markers, and Astro's scope
// attributes: ids from the build, which a port that writes the same markup another way doesn't
// have (vuejs.org's move: 172 groups of them).
const FRAMEWORK_MARKERS = /\p{White_Space}data-(?:v-[0-9a-f]{8}|astro-cid-[0-9a-z]{8})(?:=(?:""|''))?(?=[\p{White_Space}/>])|<!--\[-->|<!--\]-->|<!---->/gu;
const INTEGRITY = /\p{White_Space}+integrity=("[^"]*"|'[^']*'|[^\p{White_Space}>]+)/gu;
const GENERATOR = new RegExp(String.raw`SiteSquatch v\p{Nd}+\.\p{Nd}+\.\p{Nd}+[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}.+\-]*`, "gu");
const ID_ATTR = /\p{White_Space}id=(?:"([^"]*)"|'([^']*)'|([^\p{White_Space}>]+))/u;
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const DATE = new RegExp([
	// Mon Mar 08 2021 00:00:00 GMT+0000 (Coordinated Universal Time): JavaScript's Date.toString(),
	// as Eleventy's Nunjucks printed a date (a11yproject.com's JSON-LD, against ssqch's ISO 8601).
	String.raw`${START}(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\p{White_Space}+${MONTH}\p{White_Space}+\p{Nd}{2}\p{White_Space}+\p{Nd}{4}\p{White_Space}+\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2}\p{White_Space}+GMT[+\-]\p{Nd}{4}(?:\p{White_Space}+\([^)]*\))?`,
	// 2026-03-14T09:05:00Z
	String.raw`\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2}(?:[T ]\p{Nd}{2}:\p{Nd}{2}(?::\p{Nd}{2}(?:\.\p{Nd}+)?)?(?:Z|[+\-]\p{Nd}{2}:?\p{Nd}{2})?)?`,
	// March 14, 2026
	String.raw`${START}${MONTH}[a-z]*\.?\p{White_Space}+\p{Nd}{1,2}(?:st|nd|rd|th)?,?\p{White_Space}+\p{Nd}{4}${END}`,
	// 14 March 2026
	String.raw`${START}\p{Nd}{1,2}\p{White_Space}+${MONTH}[a-z]*\.?\p{White_Space}+\p{Nd}{4}${END}`,
	// 3/14/2026
	String.raw`${START}\p{Nd}{1,2}/\p{Nd}{1,2}/\p{Nd}{2,4}${END}`,
	// 2026
	String.raw`${START}(?:19|20)\p{Nd}{2}${END}`,
].join("|"), "gu");

/**
 * An image named by its id, as eleventy-img and `imagePlugin()` name them: ten characters of a
 * hash, then the width (`/img/LeC3bj9CzE-256.webp`). Two builds that hash differently (another
 * generator, other image settings) give every image another id. A plain word that happens to be
 * ten letters long (`screenshot-1200.png`) or a number (`2024061512-800.jpg`) is a name, not an id.
 */
const IMAGE_ID = /(?<=[/"'=,\p{White_Space}]|^)([A-Za-z0-9_-]{10})(?=-\p{Nd}{1,5}\.(?:avif|webp|jpe?g|png|gif|svg)(?![A-Za-z0-9]))/gu;
const isImageId = (id: string) => !/^(?:[a-z]+|[0-9]+)$/.test(id);
/** Whether a path is an image named by its id (`img/LeC3bj9CzE-256.webp`). */
export const isHashedImage = (file: string) => [...file.slice(file.lastIndexOf("/") + 1).matchAll(IMAGE_ID)].some((m) => m.index === 0 && isImageId(m[1]));

/** Text with image ids written as `{id}`: `/img/{id}-256.webp`. */
export function withoutImageIds(text: string): string {
	if (!text.includes("-")) return text;
	return text.replace(IMAGE_ID, (id: string) => (isImageId(id) ? "{id}" : id));
}

/**
 * `name` (or a whole text) without asset fingerprints before the extension: eight hex digits
 * after a `.` (`index.3f2a1b4c.css`), or the eight base64url characters Vite and Rollup write,
 * after a `.` or a `-` (`style.Bfpn8qS8.css`, `index-D_xVD091.js`). Eight digits that read as a
 * date (`report.20240101.pdf`) are part of the name, and so is a word (`my-Template.js`): Vite's
 * hash mixes cases with a digit, `-` or `_`.
 */
export function withoutFingerprints(text: string): string {
	if (!text.includes(".")) return text;
	return text.replace(FINGERPRINT, (whole, before: string, hash: string, ext: string) => (isFingerprint(before, hash) ? `.${ext}` : whole));
}

function isFingerprint(before: string, hash: string): boolean {
	if (before === "." && /^[0-9a-f]{8}$/.test(hash)) return !/^(19|20)\d{6}$/.test(hash);
	// base64url: an upper-case letter with lower case or digits. After a `-`, where a name's own
	// words are (`my-Template.js`), a digit, `-` or `_` too.
	if (!/[A-Z]/.test(hash) || !/[a-z0-9]/.test(hash)) return false;
	return before === "." || /[0-9_\-]/.test(hash);
}

/** Elements that sit in a line of text, where a space next to the tag shows. */
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "button", "cite", "code", "data", "dfn", "em", "i", "img", "input", "kbd", "label", "mark", "q", "s", "samp", "select", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr"]);

const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The letters and digits at `from` in `text`, in lower case (an element's name). */
function nameAt(text: string, from: number): string {
	let end = from;
	for (; end < text.length; end++) {
		const c = text.charCodeAt(end);
		if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) break;
	}
	const name = text.slice(from, end);
	return /[A-Z]/.test(name) ? asciiLower(name) : name;
}

/** Whether `tag` (`<b>`, `</a>`, `<span class="x">`) is an inline element's. */
function isInline(tag: string): boolean {
	let i = 0;
	while (i < tag.length && (tag.charCodeAt(i) === 60 || tag.charCodeAt(i) === 47)) i++;
	return INLINE.has(nameAt(tag, i));
}

/** The text to compare for a file's contents. */
function normalize(text: string, options: DiffOptions): string {
	let out = options.exact ? text : text.replaceAll("\r\n", "\n");
	for (const re of options.ignore) out = out.replace(re, "");
	if (options.exact) return out;
	out = withoutFingerprints(out);
	out = withoutImageIds(out);
	if (out.includes("data-") || out.includes("<!--")) out = out.replace(FRAMEWORK_MARKERS, "");
	if (out.includes("integrity=")) out = out.replace(INTEGRITY, "");
	if (out.includes("SiteSquatch v")) out = out.replace(GENERATOR, "SiteSquatch");
	return out;
}

/** Every file under `dir`, as a path from it with `/`, in order. */
async function files(dir: string): Promise<string[]> {
	if (!(fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false)) bail(`${dir} isn't a folder; give \`ssqch diff\` two build folders, like \`ssqch diff dist-before dist\``);
	return (await buildFiles(dir, false)).map(([file]) => file).sort(compareText);
}

/**
 * Each file under a key that's the same in both builds: its path without a fingerprint. Two
 * files with the same key (a stale fingerprinted copy next to the current one) keep their own
 * paths. In the keys' order.
 */
export function keyed(paths: string[], exact: boolean): Map<string, string> {
	if (exact) return new Map(paths.map((p) => [p, p]));
	const stripped = paths.map(withoutFingerprints);
	// A path kept as its own key can be another file's key without a fingerprint
	// (`x.11111111.css` is the key of `x.11111111.22222222.css`): that file keeps its path too,
	// until no two files share a key. 0.7 let the second replace the first, and lost a file.
	const own = new Set<number>();
	for (let changed = true; changed;) {
		changed = false;
		const counts = new Map<string, number>();
		const keyOf = (i: number) => (own.has(i) ? paths[i] : stripped[i]);
		for (let i = 0; i < paths.length; i++) counts.set(keyOf(i), (counts.get(keyOf(i)) ?? 0) + 1);
		for (let i = 0; i < paths.length; i++) {
			if (!own.has(i) && counts.get(stripped[i])! > 1) {
				own.add(i);
				changed = true;
			}
		}
	}
	const pairs = paths.map((p, i): [string, string] => [own.has(i) ? p : stripped[i], p]);
	return new Map(pairs.sort((a, b) => compareText(a[0], b[0])));
}

const isPage = (file: string) => file.endsWith(".html") || file.endsWith(".htm");
const isXml = (file: string) => /\.(?:xml|rss|atom|xsl)$/.test(file);

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const ESCAPED_TEXT = /(?<=>)([^<]*&lt;[^<]*)(?=<)/g;

/**
 * An XML file with the HTML it holds as markup: a feed's `<content>`, `<description>` and
 * `<summary>` carry a page's HTML escaped (`&lt;p&gt;`) or in CDATA, which one generator writes
 * `<br />` and the next `<br>`. Read as HTML, its tags compare the way a page's do.
 */
function xmlWithMarkup(text: string): string {
	let out = text.includes("<![CDATA[") ? text.replace(CDATA, (_, inside: string) => inside) : text;
	if (out.includes("&lt;")) out = out.replace(ESCAPED_TEXT, (escaped: string) => decodeEntitiesOnce(escaped));
	return out;
}

/** One level of escaping undone: `&lt;p&gt;` is `<p>`, `&amp;lt;` is `&lt;`, and a number is its character (Zola writes `=` as `&#x3D;` in a feed's HTML). */
function decodeEntitiesOnce(s: string): string {
	return s.replace(/&(lt|gt|quot|apos|amp|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});/g, (whole, name: string) => {
		const named: Record<string, string> = { lt: "<", gt: ">", quot: "\"", apos: "'", amp: "&" };
		if (Object.hasOwn(named, name)) return named[name];
		const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
		return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
	});
}

// ---- tokens ----------------------------------------------------------------------------------

export interface Token {
	tag: boolean;
	text: string;
}

/** Rust's `char::is_whitespace`: Unicode's White_Space. */
function isSpace(c: number): boolean {
	return c === 32 || (c >= 9 && c <= 13) || (c >= 0x80 && (c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000));
}

// Unicode's White_Space, spelled out: a class without the `u` flag is much faster.
const SPACE_CHARS = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACE_RUN = new RegExp(`[${SPACE_CHARS}]+`, "g");
const ALL_SPACE = new RegExp(`^[${SPACE_CHARS}]*$`);
/** Text that collapsing would change: any space but a plain one, two together, or one at an end. */
const UNCOLLAPSED = new RegExp(`[${SPACE_CHARS.replace(" ", "")}]|  |^ | $|^$`);
/** Whitespace a tag can't keep as it is: any but a plain space, two together, or a space before its end. */
const TAG_SPACE = new RegExp(`[${SPACE_CHARS.replace(" ", "")}]|  | [>/]`);

/** Words with one space between them, and none at either end (Rust's `split_whitespace` and `join(" ")`). */
function collapse(s: string): string {
	// Most text between a page's tags is only the indentation of the next one, and most of the
	// rest has single spaces already.
	if (!UNCOLLAPSED.test(s)) return s;
	if (ALL_SPACE.test(s)) return "";
	const t = s.replace(SPACE_RUN, " ");
	const start = t.charCodeAt(0) === 32 ? 1 : 0;
	const end = t.length > start && t.charCodeAt(t.length - 1) === 32 ? t.length - 1 : t.length;
	return start === 0 && end === t.length ? t : t.slice(start, end);
}

/** A tag with its whitespace collapsed, except inside quoted attribute values (`title="pine  cone"` isn't `title="pine cone"`). */
function collapseTag(tag: string): string {
	// Most tags have only single spaces between their attributes: nothing to do.
	if (!TAG_SPACE.test(tag)) return tag;
	let out = "";
	let quote = 0;
	let space = false;
	for (let i = 0; i < tag.length; i++) {
		const c = tag.charCodeAt(i);
		if (quote) {
			out += tag[i];
			if (c === quote) quote = 0;
		} else if (isSpace(c)) space = true;
		else {
			if (space && out !== "" && c !== 62 && c !== 47) out += " ";
			space = false;
			if (c === 34 || c === 39) quote = c;
			out += tag[i];
		}
	}
	return out;
}

const QUOTE_OR_END = /["'>]/g;

/** The length of the tag at `from` in `s` (through its `>`), skipping quoted attribute values. */
function tagEnd(s: string, from: number): number | undefined {
	// The first quote or `>`: when it's the `>`, that's the end.
	QUOTE_OR_END.lastIndex = from;
	const first = QUOTE_OR_END.exec(s);
	if (!first) return undefined;
	if (first[0] === ">") return first.index + 1 - from;
	let quote = 0;
	for (let i = first.index; i < s.length; i++) {
		const b = s.charCodeAt(i);
		if (quote) {
			if (b === quote) quote = 0;
		} else if (b === 34 || b === 39) quote = b;
		else if (b === 62) return i + 1 - from;
	}
	return undefined;
}

// ---- markup as browsers read it ----------------------------------------------------------------
//
// Two generators write the same page in different ways: attributes in another order, `'` or `"`
// around values (or none), `&#39;` for `'`, `defer="defer"` for `defer`, `<br/>` for `<br>`, and
// `<path/>` for `<path></path>` in an SVG. A browser reads them the same, so a migration's diff
// shouldn't list them: the blog's first comparison was about 25,000 lines of them for 161 pages.
// Unless `exact`, each tag is written one way (`canonicalTag`), and so is the text between tags
// (`canonicalText`), before they're compared. What browsers read differently stays different:
// an attribute's value, the order of `class` names, `&nbsp;` and a space.

/** Attributes whose presence is what counts: `defer`, `defer=""` and `defer="defer"` are the same. */
const BOOLEAN = new Set(["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"]);
/** Attributes that hold lists, whose spacing doesn't count: `srcset="a.jpg 1x,b.jpg 2x"` is `srcset="a.jpg 1x, b.jpg 2x"`. */
const SPACED = new Set(["class", "rel", "sizes", "srcset"]);
/** Elements with no end tag, where a `/` before `>` means nothing. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const ENTITY_OR_AMP = /&(?:(#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]*);)?/g;
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

/** The character an entity names, when it's one browsers and generators commonly write both ways; otherwise undefined. */
function entityChar(name: string): string | undefined {
	if (name[0] !== "#") return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : undefined;
	const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
	// A non-breaking space stays `&nbsp;`: as a character, it would collapse with the spaces.
	if (code === 0xa0) return undefined;
	return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : undefined;
}

/** Text with its entities written one way: characters as themselves, apart from `&` and `<` (`&amp;`, `&lt;`), and a lone `&` as `&amp;`. `&#160;` is `&nbsp;`; entities it doesn't know stay as they are. */
export function canonicalText(text: string): string {
	if (!text.includes("&") && !text.includes(">")) return text;
	return text.replace(ENTITY_OR_AMP, (whole, name: string | undefined) => {
		if (name === undefined) return "&amp;";
		if (name === "#160" || /^#[xX]0*[aA]0$/.test(name)) return "&nbsp;";
		const c = entityChar(name);
		return c === undefined ? whole : c === "&" ? "&amp;" : c === "<" ? "&lt;" : c;
	}).replaceAll("&gt;", ">");
}

/** An attribute's value as the browser reads it: its entities decoded. */
function attributeValue(raw: string): string {
	if (!raw.includes("&")) return raw;
	return raw.replace(ENTITY_OR_AMP, (whole, name: string | undefined) => (name === undefined ? whole : name === "nbsp" ? "\u00a0" : (entityChar(name) ?? whole)));
}

/** Attributes that hold one URL, which browsers read the same percent-encoded or not. */
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "cite", "data"]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * A URL with the characters a browser encodes itself written as themselves: `#%D9%83` is `#ك`,
 * `caf%C3%A9.png` is `café.png` and `%20` a space, as CommonMark's renderer and kramdown write the
 * same link (opensource.guide's Arabic pages). ASCII that means something in a URL (`%2F`, `%23`,
 * `%3F`) stays encoded: `a%2Fb` and `a/b` are different paths. A `%` that doesn't start an escape
 * is the same as `%25` (`100%` and `100%25`, as CommonMark writes it), but `%2541` stays: it's the
 * text `%41`, where `%41` is `A`.
 */
export function canonicalUrl(url: string): string {
	if (!url.includes("%")) return url;
	return url.replace(/%25(?![0-9A-Fa-f]{2})/g, "%").replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
		const bytes = Uint8Array.from(run.slice(1).split("%"), (h) => Number.parseInt(h, 16));
		let text: string;
		try { text = UTF8.decode(bytes); } catch { return run; }
		let out = "";
		let at = 0;
		for (const c of text) {
			const n = Buffer.byteLength(c);
			out += c.charCodeAt(0) > 0x7f || " \"<>`{}".includes(c) ? c : run.slice(at * 3, (at + n) * 3);
			at += n;
		}
		return out;
	});
}

const NO_ATTRIBUTES = /^<\/?[a-z][a-z0-9-]*>$/;

/**
 * A start or end tag written one way: its name and attribute names in lower case, attributes
 * sorted by name (the first of two with one name, which is the one a browser keeps), each value
 * decoded and written in double quotes (`&` and `"` escaped), a boolean attribute without a value,
 * and no `/` before the `>`. Returns the tag, and whether it closed itself (`<path/>` in an SVG,
 * which is `<path></path>`). A comment, a doctype and anything that doesn't parse as a tag come
 * back as they are, a doctype in lower case.
 */
export function canonicalTag(tag: string, foreign: boolean, xml = false): [string, boolean] {
	if (NO_ATTRIBUTES.test(tag)) return [tag, false];
	// XML's names keep their case (`<pubDate>`), and every element can close itself.
	const lower = xml ? (t: string) => t : asciiLower;
	if (tag.startsWith("<!--")) return [tag, false];
	if (/^<!doctype/i.test(tag)) return [asciiLower(tag), false];
	const closing = tag.charCodeAt(1) === 47;
	let i = closing ? 2 : 1;
	const name = nameAt(tag, i);
	if (name === "") return [tag, false];
	i += name.length;
	// Custom elements' names go on past letters and digits (`<site-header>`).
	while (i < tag.length && /[A-Za-z0-9_:.-]/.test(tag[i])) i++;
	const element = lower(tag.slice(closing ? 2 : 1, i));
	// A name no element has (`.` or `_`, and no `-` as a custom element's has): text that a page
	// printed unescaped, like a Python repr (`<httpx._client.UseClientDefault object at 0x10>`,
	// httpx). Browsers read it as a tag, but shown lowercased with its words sorted as attributes it
	// can't be found in the source, so it's compared as it's written.
	if (!xml && /[._]/.test(element) && !element.includes("-")) return [tag, false];
	const attrs = new Map<string, string | undefined>();
	let selfClosing = false;
	const end = tag.length - 1;
	while (i < end) {
		const c = tag.charCodeAt(i);
		if (isSpace(c)) { i++; continue; }
		if (c === 47) {
			// A `/` right before the `>` closes the element; anywhere else it's nothing.
			let j = i + 1;
			while (j < end && isSpace(tag.charCodeAt(j))) j++;
			if (j === end) selfClosing = true;
			i++;
			continue;
		}
		let j = i;
		while (j < end && !isSpace(tag.charCodeAt(j)) && tag[j] !== "=" && tag[j] !== ">" && !(tag[j] === "/" && j > i)) j++;
		if (j === i) j++;
		const attr = lower(tag.slice(i, j));
		// Not a name a browser would read (an `=` written as an entity, a stray quote): the tag isn't
		// one to rewrite, so it's compared as it's written.
		if (/["'<]/.test(attr)) return [tag, false];
		i = j;
		while (i < end && isSpace(tag.charCodeAt(i))) i++;
		let value: string | undefined;
		if (tag[i] === "=") {
			i++;
			while (i < end && isSpace(tag.charCodeAt(i))) i++;
			const q = tag[i];
			if (q === "\"" || q === "'") {
				const close = tag.indexOf(q, i + 1);
				// An unclosed quote: not a tag a browser would read this way, so leave it be.
				if (close === -1) return [tag, false];
				value = attributeValue(tag.slice(i + 1, close));
				i = close + 1;
			} else {
				let k = i;
				while (k < end && !isSpace(tag.charCodeAt(k))) k++;
				value = attributeValue(tag.slice(i, k));
				i = k;
			}
		}
		if (attrs.has(attr)) continue;
		if (value !== undefined && BOOLEAN.has(attr) && !foreign && (value === "" || asciiLower(value) === attr)) value = undefined;
		if (value !== undefined && SPACED.has(attr)) value = collapse(value).replace(/ ?, ?/g, ", ");
		if (value !== undefined && URL_ATTRS.has(attr)) value = canonicalUrl(value);
		attrs.set(attr, value);
	}
	if (closing) return [`</${element}>`, false];
	let out = `<${element}`;
	for (const attr of [...attrs.keys()].sort()) {
		const value = attrs.get(attr);
		out += value === undefined ? ` ${attr}` : ` ${attr}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
	}
	return [`${out}>`, selfClosing && (xml || foreign || element === "svg" || element === "math") && !VOID.has(element)];
}

const RAW = new Set(["script", "style", "pre", "textarea"]);
const CLOSING = new Map([...RAW].map((name) => [name, new RegExp(`</${name}`, "gi")]));

/** Whether a character can start a tag after `<`: a letter, `/`, `!` or `?`. */
const startsTag = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 47 || c === 33 || c === 63;

/** HTML as a list of tags and pieces of text. Whitespace is collapsed, except in elements where it matters, whose content is kept line by line. */
export function tokens(html: string, xml = false): Token[] {
	const out: Token[] = [];
	let i = 0;
	let textStart = 0;
	// How deep in an `<svg>` or `<math>`, where a tag can close itself.
	let foreign = 0;
	// Whitespace is collapsed, and dropped next to block tags, where it doesn't show. Next to an
	// inline tag it does (`a <b>b</b>` isn't `a<b>b</b>`), so one space stays.
	const pushText = (s: string, nextTag: string | undefined) => {
		if (s === "") return;
		const last = out[out.length - 1];
		const before = isSpace(s.codePointAt(0)!) && last !== undefined && last.tag && isInline(last.text);
		const after = isSpace(s.charCodeAt(s.length - 1)) && nextTag !== undefined && isInline(nextTag);
		let t = canonicalText(collapse(s));
		if (t === "") {
			if (before && after) out.push({ tag: false, text: " " });
			return;
		}
		if (before) t = ` ${t}`;
		if (after) t = `${t} `;
		out.push({ tag: false, text: t });
	};
	for (;;) {
		i = html.indexOf("<", i);
		if (i === -1) break;
		let end: number | undefined;
		if (html.startsWith("<!--", i)) {
			const close = html.indexOf("-->", i);
			end = close === -1 ? undefined : close - i + 3;
		} else if (i + 1 < html.length && startsTag(html.charCodeAt(i + 1))) end = tagEnd(html, i);
		if (end === undefined) {
			i += 1;
			continue;
		}
		const tag = html.slice(i, i + end);
		pushText(html.slice(textStart, i), tag);
		const [text, closes] = canonicalTag(collapseTag(tag), foreign > 0, xml);
		out.push({ tag: true, text });
		const name = xml ? "" : nameAt(tag, 1);
		// Inside an SVG or MathML, `<path/>` is `<path></path>`.
		if (name === "svg" || name === "math") {
			if (!closes) foreign++;
		} else if (tag.charCodeAt(1) === 47 && (nameAt(tag, 2) === "svg" || nameAt(tag, 2) === "math")) foreign = Math.max(0, foreign - 1);
		if (closes) out.push({ tag: true, text: `</${text.slice(1, text.search(/[ >]/))}>` });
		i += end;
		textStart = i;
		// Raw content: kept exactly as it is (blank lines, indents), a line at a time. Tags inside
		// <pre> (highlighting spans) are markup like any other, but the diff is easier to read
		// with the line whole. A `<pre>`'s and a `<textarea>`'s entities are read as in other
		// text (highlighters write `'` as `&#39;` or not); a script's and a style's aren't entities.
		if (RAW.has(name) && !tag.endsWith("/>")) {
			const closing = CLOSING.get(name)!;
			closing.lastIndex = i;
			const found = closing.exec(html);
			const len = (found ? found.index : html.length) - i;
			let raw = html.slice(i, i + len);
			// A browser drops the newline right after `<pre>` and `<textarea>`.
			if (name === "pre" || name === "textarea") raw = raw.startsWith("\r\n") ? raw.slice(2) : raw.startsWith("\n") ? raw.slice(1) : raw;
			const entities = name === "pre" || name === "textarea";
			if (raw !== "") {
				for (const line of raw.split("\n")) {
					const text = line.endsWith("\r") ? line.slice(0, -1) : line;
					out.push({ tag: false, text: entities ? canonicalText(text) : text });
				}
			}
			i += len;
			textStart = i;
		}
	}
	pushText(html.slice(textStart), undefined);
	return out;
}

function ids(list: Token[]): string[] {
	const found = new Set<string>();
	for (const t of list) {
		if (!t.tag || !t.text.includes("id=")) continue;
		const m = ID_ATTR.exec(t.text);
		if (m) found.add(m[1] ?? m[2] ?? m[3]);
	}
	return [...found].sort(compareText);
}

/** `<title>`, or `<title ...>`, in any case (ASCII only, as Rust compared it: `i` without `u` folds no other letter into these). */
const TITLE = /^<title(?:>$| )/i;

function title(list: Token[]): string | undefined {
	const i = list.findIndex((t) => t.tag && TITLE.test(t.text));
	if (i === -1) return undefined;
	const next = list[i + 1];
	return next && !next.tag ? next.text : undefined;
}

/**
 * Where a change on a page is: the nearest heading above it, as `#its-id` (what a link to it
 * names) or its text in quotes. "+ </p>" on 8 pages said nothing about where on a 900-line page
 * (the fresh opensource.guide move).
 */
function headingAbove(list: Token[]): (index: number) => string | undefined {
	const found = new Map<number, string | undefined>();
	return (index) => {
		for (let i = Math.min(index, list.length) - 1; i >= 0; i--) {
			const t = list[i];
			if (!t.tag || !/^<h[1-6][\s>]/i.test(t.text)) continue;
			if (found.has(i)) return found.get(i);
			const id = attr(t.text, "id");
			let text = "";
			for (let j = i + 1; j < list.length && !/^<\/h[1-6]>/i.test(list[j].text); j++) if (!list[j].tag) text += list[j].text;
			const at = id ? `#${id}` : text.trim() ? `"${clip(text.trim())}"` : undefined;
			found.set(i, at);
			return at;
		}
		return undefined;
	};
}

/** An attribute's value in a tag as `canonicalTag` writes it (double quotes, entities decoded), or undefined. */
function attr(tag: string, name: string): string | undefined {
	const m = new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag);
	return m?.[1];
}

/** The page's canonical link, and where a refresh sends it: what a search engine and a reader end up at. */
function wayfinding(list: Token[]): { canonical?: string; redirect?: string } {
	const out: { canonical?: string; redirect?: string } = {};
	for (const t of list) {
		if (!t.tag) continue;
		if (out.canonical === undefined && /^<link\s/i.test(t.text) && /\srel="canonical"/i.test(t.text)) out.canonical = attr(t.text, "href");
		if (out.redirect === undefined && /^<meta\s/i.test(t.text) && /\shttp-equiv="refresh"/i.test(t.text)) out.redirect = /url=\s*['"]?([^'"\s>]+)/i.exec(attr(t.text, "content") ?? "")?.[1];
	}
	return out;
}

/** A feed's entries, by their id (`<guid>` or `<id>`), else their `<link>`: the ones a reader's app tracks. */
function feedEntries(list: Token[]): string[] {
	const out: string[] = [];
	let inEntry = false;
	let id: string | undefined;
	let link: string | undefined;
	for (let i = 0; i < list.length; i++) {
		const t = list[i];
		if (!t.tag) continue;
		if (/^<(item|entry)[\s>]/i.test(t.text)) { inEntry = true; id = link = undefined; continue; }
		if (/^<\/(item|entry)>/i.test(t.text)) { if (inEntry) out.push(id ?? link ?? `(entry ${out.length + 1})`); inEntry = false; continue; }
		if (!inEntry) continue;
		const next = list[i + 1];
		const text = next && !next.tag ? next.text.trim() : undefined;
		if (/^<(guid|id)[\s>]/i.test(t.text) && text) id ??= text;
		else if (/^<link[\s>]/i.test(t.text)) link ??= attr(t.text, "href") ?? text;
	}
	return out;
}

// ---- compare ---------------------------------------------------------------------------------

/** Rust's `str::lines`: split at `\n`, a `\r` before it dropped, and no empty line after a last `\n`. */
function lines(text: string): string[] {
	if (text === "") return [];
	const out = text.split("\n");
	if (out[out.length - 1] === "") out.pop();
	for (let i = 0; i < out.length; i++) {
		// The last line keeps a lone `\r` (it had no `\n` after it).
		if (out[i].endsWith("\r") && (i < out.length - 1 || text.endsWith("\n"))) out[i] = out[i].slice(0, -1);
	}
	return out;
}

/** The changed runs between two lists, and (whether from the first list, index) for every changed item. */
function hunks<T>(before: T[], after: T[], kind: (item: T) => number, show: (item: T) => string, where?: (oldIndex: number) => string | undefined): [Hunk[], Array<[boolean, number]>] {
	// The algorithm compares numbers: each distinct item (its kind, and its text) gets one.
	const numbers = [new Map<string, number>(), new Map<string, number>()];
	let count = 0;
	const number = (item: T) => {
		const map = numbers[kind(item)];
		const text = show(item);
		let n = map.get(text);
		if (n === undefined) {
			n = count++;
			map.set(text, n);
		}
		return n;
	};
	const a = new Int32Array(before.length), b = new Int32Array(after.length);
	for (let i = 0; i < before.length; i++) a[i] = number(before[i]);
	for (let i = 0; i < after.length; i++) b[i] = number(after[i]);
	const out: Hunk[] = [];
	const changed: Array<[boolean, number]> = [];
	for (const op of diffOps(a, b)) {
		if (op.tag === "equal") continue;
		for (let i = op.oldIndex; i < op.oldIndex + op.oldLen; i++) changed.push([true, i]);
		for (let i = op.newIndex; i < op.newIndex + op.newLen; i++) changed.push([false, i]);
		const hunk: Hunk = { removed: before.slice(op.oldIndex, op.oldIndex + op.oldLen).map(show), added: after.slice(op.newIndex, op.newIndex + op.newLen).map(show) };
		const at = where?.(op.oldIndex);
		if (at !== undefined) hunk.at = at;
		out.push(hunk);
	}
	return [out, changed];
}

/** The hunks, cut to the first `limit` changed lines (0 for all): each hunk's removed lines, then its added ones. */
function firstLines(list: Hunk[], limit: number): Hunk[] {
	if (limit === 0) return list;
	let left = limit;
	const out: Hunk[] = [];
	for (const h of list) {
		if (left === 0) break;
		const removed = h.removed.slice(0, left);
		left -= removed.length;
		const added = h.added.slice(0, left);
		left -= added.length;
		out.push(h.at === undefined ? { removed, added } : { removed, added, at: h.at });
	}
	return out;
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decode = (data: Uint8Array): string | undefined => {
	try { return utf8.decode(data); } catch { return undefined; }
};

interface Pair {
	key: string;
	before: string;
	after: string;
}

function comparePair(a: Buffer, b: Buffer, pair: Pair, options: DiffOptions): FileDiff | undefined {
	if (a.equals(b)) return undefined;
	const diff: FileDiff = {
		path: pair.key,
		url: urlOf(pair.key),
		renamed: pair.before !== pair.after ? [pair.before, pair.after] : undefined,
		kind: "binary",
		what: [],
		notes: [],
		hunks: [],
		changedLines: 0,
		onlyDates: undefined,
		sizeBefore: a.length,
		sizeAfter: b.length,
		groups: [],
		ownHunks: [],
		ownLines: 0,
	};
	const textA = decode(a), textB = decode(b);
	if (textA === undefined || textB === undefined) return diff;
	const before = normalize(textA, options), after = normalize(textB, options);
	if (before === after) return undefined;
	let found: Hunk[];
	if (isPage(pair.key) && !options.exact) {
		diff.kind = "page";
		const ta = tokens(before), tb = tokens(after);
		const [list, changed] = hunks(ta, tb, (t) => (t.tag ? 1 : 0), (t) => t.text, headingAbove(ta));
		if (!list.length) return undefined;
		const isTag = ([first, i]: [boolean, number]) => (first ? ta[i] : tb[i]).tag;
		if (changed.some((c) => !isTag(c))) diff.what.push("text");
		if (changed.some(isTag)) diff.what.push("markup");
		const [old, now] = [title(ta), title(tb)];
		if (old !== undefined && now !== undefined && old !== now) diff.notes.push(`title: ${quoted(old)} -> ${quoted(now)}`);
		const kept = new Set(ids(tb));
		const gone = ids(ta).filter((id) => !kept.has(id)).map((id) => `#${id}`);
		if (gone.length) diff.notes.push(`ids removed (links to them break): ${gone.slice(0, 8).join(", ")}${gone.length > 8 ? ` and ${gone.length - 8} more` : ""}`);
		// Where search engines and readers end up: a changed canonical link or refresh is a page
		// that moved, whatever else is the same.
		const [wa, wb] = [wayfinding(ta), wayfinding(tb)];
		if (wa.canonical !== wb.canonical) diff.notes.push(`canonical link: ${wa.canonical ?? "none"} -> ${wb.canonical ?? "none"}`);
		if (wa.redirect !== wb.redirect) diff.notes.push(`redirects to: ${wa.redirect ?? "nowhere"} -> ${wb.redirect ?? "nowhere"}`);
		diff.onlyDates = onlyDates(list);
		if (diff.onlyDates) diff.notes.push(`only dates changed (${diff.onlyDates[0]} -> ${diff.onlyDates[1]})`);
		found = list;
	} else if (isXml(pair.key) && !options.exact) {
		// Tags and text, as a page is compared, with the HTML a feed holds read as HTML.
		diff.kind = "text";
		const ta = tokens(xmlWithMarkup(before), true), tb = tokens(xmlWithMarkup(after), true);
		found = hunks(ta, tb, (t) => (t.tag ? 1 : 0), (t) => t.text)[0];
		if (!found.length) return undefined;
		// A feed's entries that went or came: readers' apps track them by id.
		const [ea, eb] = [feedEntries(ta), feedEntries(tb)];
		if (ea.length || eb.length) {
			const kept = new Set(eb), had = new Set(ea);
			const gone = ea.filter((e) => !kept.has(e)), came = eb.filter((e) => !had.has(e));
			const some = (list: string[]) => `${list.slice(0, 3).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;
			if (gone.length) diff.notes.push(`feed entries removed (readers see them go): ${some(gone)}`);
			if (came.length) diff.notes.push(`feed entries added (readers see them as new): ${some(came)}`);
		}
		// A sitemap's `<lastmod>` and a feed's `<updated>` follow the files' dates.
		diff.onlyDates = onlyDates(found);
		if (diff.onlyDates) diff.notes.push(`only dates changed (${diff.onlyDates[0]} -> ${diff.onlyDates[1]})`);
	} else {
		diff.kind = isPage(pair.key) ? "page" : "text";
		const la = lines(before), lb = lines(after);
		found = hunks(la, lb, () => 0, (l) => l)[0];
		// Only the line endings at the end of the file.
		if (!found.length) found = [{ removed: [`(${Buffer.byteLength(before)} bytes)`], added: [`(${Buffer.byteLength(after)} bytes)`] }];
		// A JSON file's `"updated"` follows the build's time too (the Rust blog's releases.json).
		else if (!isPage(pair.key)) {
			diff.onlyDates = onlyDates(found);
			if (diff.onlyDates) diff.notes.push(`only dates changed (${diff.onlyDates[0]} -> ${diff.onlyDates[1]})`);
		}
	}
	// A sitemap's or a list's entries in another order: every line that went is one that came.
	if (!diff.onlyDates && sameLines(found)) diff.notes.push("the same lines, in another order");
	diff.allHunks = found;
	diff.changedLines = found.reduce((sum, h) => sum + h.removed.length + h.added.length, 0);
	diff.hunks = firstLines(found, options.lines);
	return diff;
}

/** Where a link points (with `/`), or undefined for a file that isn't a link. */
async function linkTarget(file: string): Promise<string | undefined> {
	try { return (await fs.promises.readlink(file)).replaceAll("\\", "/"); } catch { return undefined; }
}

/**
 * A pair where either side is a link (lit.dev's output has 33 whose targets matter): links to the
 * same place are the same, whatever is there (that file is compared on its own), and a link that
 * points elsewhere, or that's a file in the other build, is a change.
 */
function compareLinks(a: string | undefined, b: string | undefined, pair: Pair): FileDiff | undefined {
	if (a === b) return undefined;
	const side = (target: string | undefined) => (target === undefined ? "(a file, not a link)" : `-> ${target}`);
	return {
		path: pair.key,
		url: urlOf(pair.key),
		renamed: pair.before !== pair.after ? [pair.before, pair.after] : undefined,
		kind: "text",
		what: [],
		notes: [a !== undefined && b !== undefined ? "a link, to somewhere else" : "a link in one build and a file in the other"],
		hunks: [{ removed: [side(a)], added: [side(b)] }],
		changedLines: 2,
		onlyDates: undefined,
		sizeBefore: 0,
		sizeAfter: 0,
		groups: [],
		ownHunks: [],
		ownLines: 0,
	};
}

/** How many pairs of files are read at once: enough to keep Node's file threads busy, few enough that memory stays flat. */
const READS_AT_ONCE = 32;

/** Reads whole files into a buffer of its own, which grows to the largest and is used again: what it answers is good until the next read. */
class Reader {
	private buffer = Buffer.allocUnsafe(64 * 1024);

	read(file: string): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const failed = (e: Error) => reject(new BuildError(`reading ${file}: ${e.message}`));
			fs.open(file, "r", (e, fd) => {
				if (e) return failed(e);
				const finish = (error: Error | null, length: number) => fs.close(fd, () => (error ? failed(error) : resolve(this.buffer.subarray(0, length))));
				fs.fstat(fd, (e, stat) => {
					if (e) return finish(e, 0);
					// One byte more than its size, so reaching the end takes one read.
					if (this.buffer.length < stat.size + 1) this.buffer = Buffer.allocUnsafe(stat.size + 1);
					const more = (length: number) => {
						if (length === this.buffer.length) {
							// It grew while being read.
							const bigger = Buffer.allocUnsafe(this.buffer.length * 2);
							this.buffer.copy(bigger);
							this.buffer = bigger;
						}
						fs.read(fd, this.buffer, length, this.buffer.length - length, null, (e, n) => (e ? finish(e, 0) : n === 0 ? finish(null, length) : more(length + n)));
					};
					more(0);
				});
			});
		});
	}
}

/** The paths `--only` and `--exclude` leave in. */
function kept(paths: string[], options: DiffOptions): string[] {
	const { only, exclude } = options;
	return paths.filter((p) => (!only || only.some((re) => re.test(p))) && !(exclude ?? []).some((re) => re.test(p)));
}

/** `--only` that matched no file in any build: "No differences" would read as an answer (a page's URL given where a path is meant). */
function checkOnly(lists: string[][], options: DiffOptions): void {
	if (!options.only || lists.some((list) => list.some((p) => options.only!.some((re) => re.test(p))))) return;
	const given = (options.onlyGiven ?? []).map((g) => `"${g}"`).join(", ");
	bail(`--only ${given || "(its globs)"} matched no file in ${lists.length === 2 ? "either build" : "any of the builds"}: it's a glob of paths in the build folder, like \`posts/pine/index.html\`, \`posts/**\` or \`/posts/pine/\` (a folder: everything in it)`);
}

/** Compares the build in `before` with the one in `after`. */
export async function compare(before: string, after: string, options: DiffOptions): Promise<DiffReport> {
	const keep = (paths: string[]) => kept(paths, options);
	// Both folders must be there before either is walked, so a missing one is said first.
	// Both are walked at once, and when both fail it's the first folder's error, as 0.7 walked it
	// first: which walk failed sooner is up to the disk.
	const [walkA, walkB] = await Promise.allSettled([files(before), files(after)]);
	if (walkA.status === "rejected") throw walkA.reason;
	if (walkB.status === "rejected") throw walkB.reason;
	const [listA, listB] = [walkA.value, walkB.value];
	checkOnly([listA, listB], options);
	const a = keyed(keep(listA), options.exact);
	const b = keyed(keep(listB), options.exact);
	const report: DiffReport = { before, after, exact: options.exact, added: [], removed: [], redirects: {}, changed: [], groups: [], unchangedPages: 0, unchangedFiles: 0 };
	for (const key of a.keys()) if (!b.has(key)) report.removed.push(urlOf(key));
	// A removed page the second build redirects isn't gone for a visitor: say where it goes.
	if (report.removed.length) {
		// Under a base (`/repo/`), the lines have it and the build's own paths don't: the first folder
		// every line starts with, when the build has no such folder, is the base, and comes off before
		// a removed page is compared with them (the 2026-11-24 review: `/repo/old/ /repo/new/ 301`
		// didn't count for a removed `/old/`).
		const raw = redirectRules(after, "");
		const firsts = new Set(raw.map((r) => /^\/([^/*]+)\//.exec(r.from)?.[1]));
		const only = firsts.size === 1 ? [...firsts][0] : undefined;
		const based = only !== undefined && !fs.existsSync(path.join(after, only)) ? redirectRules(after, `/${only}`) : undefined;
		for (const url of report.removed) {
			// The page is gone from the second build, so the first line that covers it is the one
			// a host follows, and a 4xx line (a catch-all to the 404 page) isn't a redirect. The
			// lines as written first: `/old/ /new/` starts with a folder the build lacks too.
			const rule = ruleFor(raw, url, false) ?? (based && ruleFor(based, url, false));
			if (rule !== undefined && !rule.notFound) report.redirects[url] = rule.to;
		}
	}
	for (const key of b.keys()) if (!a.has(key)) report.added.push(urlOf(key));
	const pairs: Pair[] = [];
	for (const [key, from] of a) {
		const to = b.get(key);
		if (to !== undefined) pairs.push({ key, before: from, after: to });
	}
	// Read in parallel, a bounded number at a time, and keep only what differs. Each reader keeps
	// its buffer from file to file, so a big build isn't allocated a second time as garbage.
	const results: Array<FileDiff | undefined | null> = new Array(pairs.length).fill(null);
	let next = 0;
	const worker = async () => {
		const x = new Reader(), y = new Reader();
		while (next < pairs.length) {
			const i = next++;
			const pair = pairs[i];
			const [fromLink, toLink] = await Promise.all([linkTarget(path.join(before, pair.before)), linkTarget(path.join(after, pair.after))]);
			if (fromLink !== undefined || toLink !== undefined) {
				results[i] = compareLinks(fromLink, toLink, pair);
				continue;
			}
			const [one, two] = await Promise.all([x.read(path.join(before, pair.before)), y.read(path.join(after, pair.after))]);
			results[i] = comparePair(one, two, pair, options);
		}
	};
	await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, pairs.length) }, worker));
	pairs.forEach((pair, i) => {
		const found = results[i];
		if (found) report.changed.push(found);
		else if (isPage(pair.key)) report.unchangedPages += 1;
		else report.unchangedFiles += 1;
	});
	report.groups = options.ungrouped ? [] : groupChanges(report.changed);
	for (const file of report.changed) {
		if (!report.groups.length) file.ownHunks = file.allHunks ?? file.hunks;
		file.ownLines = file.ownHunks.reduce((sum, h) => sum + h.removed.length + h.added.length, 0);
		file.ownHunks = firstLines(file.ownHunks, options.lines);
		delete file.allHunks;
	}
	return report;
}

// ---- groups --------------------------------------------------------------------------------

/** A hunk's lines as one key: the same lines, the same key. */
const hunkKey = (h: Hunk) => JSON.stringify([h.removed, h.added]);

/** A tag line with its attribute values blanked (`<meta content="…" name="…">`); text stays. Two hunks with the same shape are the same change with other values. */
const lineShape = (line: string) => (line.startsWith("<") ? line.replace(/="[^"]*"/g, "=\"…\"") : line);
const shapeKeyOf = (h: Hunk) => JSON.stringify([h.removed.map(lineShape), h.added.map(lineShape)]);

/** Every date that changed in a hunk that changed only dates, as `old>new` pairs; undefined for any other hunk. */
function changedDates(h: Hunk): string[] | undefined {
	if (!onlyDates([h])) return undefined;
	const pairs = new Set<string>();
	h.removed.forEach((line, i) => {
		const old = [...line.matchAll(DATE)].map((m) => m[0]);
		const now = [...h.added[i].matchAll(DATE)].map((m) => m[0]);
		old.forEach((d, k) => { if (d !== now[k]) pairs.add(`${d}>${now[k]}`); });
	});
	return [...pairs].sort();
}

/**
 * What groups a hunk: when all it changed is dates (a build's time in each page's own JSON-LD),
 * the form of those dates, digits and letters blanked (`Mon Mar 08` and `Tue Mar 09` are one form): each file of a build can be stamped a few milliseconds
 * after the last (the Rust blog's feeds), and that's still one change. Else its shape.
 */
const shapeKey = (h: Hunk) => {
	const dates = changedDates(h);
	return dates ? `dates:${JSON.stringify([...new Set(dates.map((pair) => pair.split(">")[0].replace(/\p{Nd}/gu, "0").replace(/\p{L}/gu, "a")))].sort())}` : shapeKeyOf(h);
};

/** A tag line as its name alone (`<source>`); text stays. A run of one line counts once, so a `<picture>` with two `<source>`s and one with three are alike. */
const tagLine = (line: string) => (line.startsWith("<") ? (/^<\/?[^\s>]+/.exec(line)?.[0] ?? line) + ">" : line);
const once = (lines: string[]) => lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
const tagKey = (h: Hunk) => JSON.stringify([once(h.removed.map(tagLine)), once(h.added.map(tagLine))]);

/** What a hunk changes, for agents sorting the groups. */
function kindOf(h: Hunk): string {
	if (onlyDates([h])) return "dates";
	if (sameLines([h])) return "order";
	const lines = [...h.removed, ...h.added];
	const tags = lines.filter((l) => l.startsWith("<")).length;
	return tags === lines.length ? "markup" : tags === 0 ? "text" : "markup and text";
}

/**
 * The changes on more than one file: hunks whose tags are the same but for their attribute values,
 * and whose text is the same (`same` when every one is the same line for line). One pass, not
 * the exact ones first: links that each moved to an encoded anchor are one change on 70
 * opensource.guide pages, not 70 pairs. Each file's `groups` and `ownHunks` (what no group holds)
 * are set.
 */
export function groupChanges(changed: FileDiff[]): DiffGroup[] {
	// Each shape's files, in the report's order, its first hunk, and whether every hunk is that one.
	const found = new Map<string, { files: Set<number>; hunk: Hunk; first: number; same: boolean }>();
	changed.forEach((f, i) => {
		for (const h of f.allHunks ?? f.hunks) {
			if (!h.removed.length && !h.added.length) continue;
			const k = shapeKey(h);
			const entry = found.get(k);
			if (!entry) found.set(k, { files: new Set([i]), hunk: h, first: i, same: true });
			else {
				entry.files.add(i);
				if (entry.same && hunkKey(h) !== hunkKey(entry.hunk)) entry.same = false;
			}
		}
	});
	// Each group's files, as places in `changed`, while groups gain the looser ones.
	type Draft = { files: Set<number>; hunk: Hunk; first: number; match: DiffGroup["match"] };
	const drafts: Draft[] = [];
	const byShape = new Map<string, number>();
	for (const [k, e] of found) {
		if (e.files.size < 2) continue;
		byShape.set(k, drafts.length);
		drafts.push({ files: new Set(e.files), hunk: e.hunk, first: e.first, match: e.same ? "lines" : k.startsWith("dates:") ? "dates" : "values" });
	}
	// What no group took joins the group with the same tags (the blog's `<picture>`s with other
	// widths), or, with another file's like it, makes a group of its own.
	// Groups with the same tags are one: the biggest takes the others' files.
	const byTags = new Map<string, number>();
	const merged = new Map<number, number>();
	// By its tags alone, only a run of three lines or more: one `<meta>` that changed looks like any
	// other `<meta>` that did, and the group would show only the first one's lines.
	const hasTags = (h: Hunk) => h.removed.length + h.added.length >= 3 && h.removed.concat(h.added).some((l) => l.startsWith("<"));
	[...drafts.keys()].sort((a, b) => drafts[b].files.size - drafts[a].files.size || drafts[a].first - drafts[b].first).forEach((i) => {
		const k = tagKey(drafts[i].hunk);
		const into = hasTags(drafts[i].hunk) ? byTags.get(k) : undefined;
		if (into === undefined) { byTags.set(k, i); return; }
		for (const f of drafts[i].files) drafts[into].files.add(f);
		drafts[into].match = "tags";
		merged.set(i, into);
	});
	for (const [shape, i] of byShape) if (merged.has(i)) byShape.set(shape, merged.get(i)!);
	const placed = new Map<FileDiff, Map<Hunk, number>>();
	const loose = new Map<string, { files: Set<number>; hunk: Hunk; first: number; hunks: Array<[number, Hunk]> }>();
	changed.forEach((f, i) => {
		const at = new Map<Hunk, number>();
		placed.set(f, at);
		for (const h of f.allHunks ?? f.hunks) {
			if (!h.removed.length && !h.added.length) continue;
			const shaped = byShape.get(shapeKey(h));
			if (shaped !== undefined) { at.set(h, shaped); continue; }
			const tags = byTags.get(tagKey(h));
			if (tags !== undefined && hasTags(h)) {
				drafts[tags].files.add(i);
				drafts[tags].match = "tags";
				at.set(h, tags);
				continue;
			}
			const k = tagKey(h);
			const entry = loose.get(k) ?? { files: new Set<number>(), hunk: h, first: i, hunks: [] };
			entry.files.add(i);
			entry.hunks.push([i, h]);
			loose.set(k, entry);
		}
	});
	for (const e of loose.values()) {
		if (e.files.size < 2 || !hasTags(e.hunk)) continue;
		const index = drafts.length;
		drafts.push({ files: e.files, hunk: e.hunk, first: e.first, match: "tags" });
		for (const [i, h] of e.hunks) placed.get(changed[i])!.set(h, index);
	}
	// The most files first; the groups' places in the report follow. A merged group is gone.
	const order = drafts.map((_, i) => i).filter((i) => !merged.has(i)).sort((a, b) => drafts[b].files.size - drafts[a].files.size || drafts[a].first - drafts[b].first);
	const number = new Map(order.map((old, i) => [old, i]));
	// Where a group is: the heading every one of its hunks is under, or nowhere. The hunk shown is
	// the first file's, and its own place (`@ under #contact-us`) read as every file's: a footer
	// that changed on 16 pages was "under" the 404 page's heading (the Squatch Snacks study, B4).
	const places = new Map<number, Set<string | undefined>>();
	for (const at of placed.values()) {
		for (const [h, draft] of at) {
			const seen = places.get(draft);
			if (seen) seen.add(h.at);
			else places.set(draft, new Set([h.at]));
		}
	}
	const groups: DiffGroup[] = order.map((i) => {
		const d = drafts[i];
		const known = knownChange(d.hunk);
		// A copy: the hunk is still the first file's, with its place, for `--ungrouped` and a file's own list.
		const hunk: Hunk = d.hunk.at === undefined || places.get(i)?.size === 1 ? d.hunk : { removed: d.hunk.removed, added: d.hunk.added };
		return { urls: [...d.files].sort((a, b) => a - b).map((f) => changed[f].url), same: d.match === "lines", match: d.match, kind: kindOf(d.hunk), hunk, ...(known ? { known } : {}) };
	});
	for (const f of changed) {
		const at = placed.get(f)!;
		const all = f.allHunks ?? f.hunks;
		f.groups = [...new Set(all.map((h) => at.get(h)).filter((g): g is number => g !== undefined).map((g) => number.get(g)!))].sort((a, b) => a - b);
		f.ownHunks = all.filter((h) => !at.has(h));
	}
	return groups;
}

/** Whether the lines removed are the lines added, each as many times: the same lines, moved. */
function sameLines(list: Hunk[]): boolean {
	const counts = new Map<string, number>();
	let lines = 0;
	for (const hunk of list) {
		for (const line of hunk.removed) counts.set(line, (counts.get(line) ?? 0) + 1);
		for (const line of hunk.added) counts.set(line, (counts.get(line) ?? 0) - 1);
		lines += hunk.removed.length;
	}
	return lines > 0 && [...counts.values()].every((n) => n === 0);
}

/** When every changed line is the same apart from its dates and years: the first date that changed, before and after. */
function onlyDates(list: Hunk[]): [string, string] | undefined {
	const blank = (lines: string[]) => lines.map((l) => l.replace(DATE, "\0"));
	let first: [string, string] | undefined;
	for (const hunk of list) {
		if (hunk.removed.length !== hunk.added.length) return undefined;
		const [x, y] = [blank(hunk.removed), blank(hunk.added)];
		if (x.some((line, i) => line !== y[i])) return undefined;
		if (first === undefined) {
			for (let i = 0; i < hunk.removed.length && first === undefined; i++) {
				const old = [...hunk.removed[i].matchAll(DATE)].map((m) => m[0]);
				const now = [...hunk.added[i].matchAll(DATE)].map((m) => m[0]);
				for (let k = 0; k < Math.min(old.length, now.length); k++) {
					if (old[k] !== now[k]) {
						first = [old[k], now[k]];
						break;
					}
				}
			}
		}
	}
	return first;
}

// ---- output ----------------------------------------------------------------------------------

/** What a comparison that isn't `--exact` leaves out, said first: what differs only in these doesn't count. */
const IGNORING = "Ignoring asset fingerprints, image ids, integrity hashes, the generator's version, Vue's and Astro's scope ids and fragment markers, whitespace between tags, and how tags are written where browsers read them the same (attribute order, quotes, entities, percent-encoding in URLs, `<br/>`) (--exact compares bytes).\n";

/** More images named by their id than this, added or removed, are counted in one line rather than listed. */
const IMAGES_LISTED = 5;

/** The URLs in an Added or Removed list: each one, apart from a long run of images named by their id, which is one line. */
function listed(urls: string[], sign: string): string[] {
	const images = urls.filter(isHashedImage);
	if (images.length <= IMAGES_LISTED) return urls.map((url) => `  ${sign} ${url}\n`);
	const out = urls.filter((url) => !isHashedImage(url)).map((url) => `  ${sign} ${url}\n`);
	out.push(`  ${sign} ${plural(images.length, "image", "images")} named by an id (${images[0].replace(IMAGE_ID, "{id}")} and the like): two builds that hash images differently name them differently, so they're counted here (--format json lists them)\n`);
	return out;
}

/**
 * A long line, cut to 200 characters. With `at` (where a changed line first differs from the one it
 * replaces), the part around it: a minified stylesheet's difference 180 KB in showed as two
 * identical excerpts of its start (the vuejs.org rerun).
 */
function clip(line: string, at = 0): string {
	const MAX = 200;
	const chars = Array.from(line);
	const n = chars.length;
	if (n <= MAX) return line;
	const from = at > 60 ? Math.min(at - 40, n - MAX) : 0;
	if (from <= 0) return `${firstChars(line, MAX)}… (${n - MAX} more characters)`;
	const rest = n - from - MAX;
	return `(from character ${count(from + 1)}) …${chars.slice(from, from + MAX).join("")}${rest > 0 ? `… (${count(rest)} more characters)` : ""}`;
}

/** Where two lines first differ, in characters, or 0. */
function firstDifference(a: string | undefined, b: string | undefined): number {
	if (a === undefined || b === undefined) return 0;
	const x = Array.from(a), y = Array.from(b);
	let i = 0;
	while (i < x.length && i < y.length && x[i] === y[i]) i++;
	return i;
}

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

type Paint = (code: string, s: string) => string;

/** A file's changed lines, up to `limit` of them (0 for all), and how many more there are. */
function linesText(hunks: Hunk[], total: number, limit: number, paint: Paint, indent = "      "): string {
	let shown = 0;
	let text = "";
	let place: string | undefined;
	done: for (const hunk of hunks) {
		// Where it is on the page, when that's another place than the hunk before's.
		if (hunk.at !== undefined && hunk.at !== place && !(limit > 0 && shown >= limit)) text += paint("2", `${indent}@ under ${hunk.at}\n`);
		place = hunk.at;
		// A line replaced by one line: both shown around where they first differ.
		const at = hunk.removed.length === 1 && hunk.added.length === 1 ? firstDifference(hunk.removed[0], hunk.added[0]) : 0;
		for (const [sign, code, side] of [["-", "31", hunk.removed], ["+", "32", hunk.added]] as const) {
			for (const line of side) {
				if (limit > 0 && shown >= limit) break done;
				text += paint(code, `${indent}${sign} ${clip(line, at)}\n`);
				shown += 1;
			}
		}
	}
	if (total > shown) text += `${indent}... ${count(total - shown)} more changed ${total - shown === 1 ? "line" : "lines"} (--lines 0 shows all)\n`;
	return text;
}

const isPageUrl = (url: string) => url.endsWith("/") || isPage(url);

/**
 * A change every move from a component framework has, by what it removes and adds: the old
 * generator's client app (the scripts and preloads it puts in each page), and Shiki's inline colors
 * where ssqch's highlighter writes classes. From the vuejs.org move, whose two biggest groups were
 * these on every page, and which an agent took time to rule out.
 */
export function knownChange(hunk: Hunk): string | undefined {
	const removed = hunk.removed.join("\n");
	const added = hunk.added.join("\n");
	if (/__VP_HASH_MAP__|__VP_SITE_DATA__|\/assets\/chunks\/|\/assets\/app\.[\w-]+\.js/.test(removed) && !/__VP_/.test(added)) return "VitePress's client app: the scripts and preloads it puts in each page, to run the page in the browser. ssqch writes the HTML alone";
	if (/<astro-island\b|\/_astro\/[\w.-]+\.js/.test(removed) && !/<astro-island\b/.test(added)) return "Astro's islands and scripts, which run the page's components in the browser. ssqch writes the HTML alone";
	if (/__NEXT_DATA__|\/_next\/static\//.test(removed)) return "Next.js's client app: its scripts and page data. ssqch writes the HTML alone";
	if (/___gatsby|\/page-data\/|webpack-runtime-/.test(removed)) return "Gatsby's client app: its scripts and page data. ssqch writes the HTML alone";
	if (/style="(?:color:#|--shiki-)|class="shiki\b/.test(removed) && /class="(?:hl-|token |highlight)/.test(added)) return "Shiki's inline colors, where ssqch's highlighter writes classes (its stylesheet colors them): the code's text is the same";
	return undefined;
}

/** The groups, the most files first: how many files, the first three, how alike, and the change. `what` is the heading's verb phrase. */
function groupsText(groups: DiffGroup[], limit: number, paint: Paint, heading: string): string {
	let out = `  ${heading}, the most files first (--ungrouped lists each file with all of it):\n`;
	for (const group of groups) {
		const n = group.urls.length;
		const what = group.urls.every(isPageUrl) ? (n === 1 ? "page" : "pages") : n === 1 ? "file" : "files";
		const some = group.urls.slice(0, 3).join(", ");
		const alike = group.match === "lines" ? "" : group.match === "values" ? ", the same but for attribute values" : group.match === "dates" ? ", the same dates in other text" : ", the same tags with other attributes";
		out += `  ~ ${count(n)} ${what}${alike}: ${some}${n > 3 ? ` and ${count(n - 3)} more` : ""}\n`;
		if (group.known) out += `      expected in a move: ${group.known}\n`;
		out += linesText([group.hunk], group.hunk.removed.length + group.hunk.added.length, limit, paint);
	}
	return out;
}

/** The report for a terminal. `lines` is how many changed lines to show for each file (0 for all of them). */
export function diffText(report: DiffReport, limit: number, color: boolean): string {
	const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
	let out = `Comparing ${report.before} with ${report.after}\n`;
	out += report.exact ? "Comparing bytes (--exact).\n" : IGNORING;
	const pageUrl = isPageUrl;
	const unchanged = `${plural(report.unchangedPages, "page", "pages")} and ${plural(report.unchangedFiles, "other file", "other files")}`;
	if (isSame(report)) return `${out}\nNo differences: ${unchanged} are the same. The stump has not moved.\n`;
	if (report.added.length) {
		out += `\nAdded (${report.added.length})\n`;
		for (const line of listed(report.added, "+")) out += paint("32", line);
	}
	if (report.removed.length) {
		out += `\nRemoved (${report.removed.length})\n`;
		for (const line of listed(report.removed, "-")) {
			const url = line.slice(4, -1);
			out += paint("31", Object.hasOwn(report.redirects, url) ? `${line.slice(0, -1)} (redirected to ${report.redirects[url]})\n` : line);
		}
	}
	if (report.changed.length) out += `\nChanged (${report.changed.length})\n`;
	const grouped = report.groups.length > 0;
	if (grouped) {
		out += groupsText(report.groups, limit, paint, "The same change on more than one file");
		const rest = report.changed.filter((f) => f.ownLines > 0);
		if (rest.length) out += `  And what's left on ${plural(rest.length, "file", "files")}:\n`;
	}
	for (const file of report.changed) {
		if (grouped && file.ownLines === 0) continue;
		const about: string[] = [];
		if (file.what.length) about.push(file.what.join(" and "));
		if (file.renamed) {
			const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
			about.push(`${name(file.renamed[0])} -> ${name(file.renamed[1])}`);
		}
		if (file.kind === "binary") about.push(`binary, ${bytes(file.sizeBefore)} -> ${bytes(file.sizeAfter)}`);
		out += `  ~ ${file.url}${about.length ? `  (${about.join("; ")})` : ""}\n`;
		for (const note of file.notes) out += `      ${note}\n`;
		out += grouped ? linesText(file.ownHunks, file.ownLines, limit, paint) : linesText(file.hunks, file.changedLines, limit, paint);
	}
	const pages = [...report.added, ...report.removed].filter(pageUrl).length + report.changed.filter((f) => isPage(f.path)).length;
	const others = report.added.length + report.removed.length + report.changed.length - pages;
	const found = others === 0 ? plural(pages, "page", "pages") : pages === 0 ? plural(others, "other file", "other files") : `${plural(pages, "page", "pages")} and ${plural(others, "other file", "other files")}`;
	const dated = report.changed.filter((f) => f.onlyDates).length;
	if (dated > 0) {
		const which = dated === report.changed.length ? `All ${plural(dated, "changed file", "changed files")}` : `${count(dated)} of the ${plural(report.changed.length, "changed file", "changed files")}`;
		out += `\n${which} differ only in dates or years. See \`ssqch docs "dates that changed"\`: a page with no date of its own gets its file's modification time.\n`;
	}
	// Files an earlier build left behind are added or removed files too (osg #15).
	if (report.added.length || report.removed.length) out += "\nIf a folder held an earlier build, its leftover files are among the added and removed: to rule that out, build each side into an empty folder.\n";
	out += `\nChanges found: ${found} (${count(report.changed.length)} changed, ${count(report.added.length)} added, ${count(report.removed.length)} removed); ${unchanged} are the same. The stump has moved.\n`;
	return out;
}

/** The report as JSON (`schemaVersion` 1). `changedLines` has the full count; the hunks, the first `lines` (0 for all). */
export function diffJson(report: DiffReport, limit: number): Record<string, unknown> {
	const changed = report.changed.map((f) => {
		const entry: Record<string, unknown> = {
			url: f.url,
			path: f.path,
			kind: f.kind,
			changes: f.what,
			notes: f.notes,
			changedLines: f.changedLines,
			onlyDates: f.onlyDates !== undefined,
			sizeBefore: f.sizeBefore,
			sizeAfter: f.sizeAfter,
			hunks: firstLines(f.hunks, limit),
			groups: f.groups,
		};
		if (f.renamed) entry.renamed = { before: f.renamed[0], after: f.renamed[1] };
		return entry;
	});
	return {
		schemaVersion: 1,
		before: report.before.replaceAll("\\", "/"),
		after: report.after.replaceAll("\\", "/"),
		exact: report.exact,
		same: isSame(report),
		summary: { added: report.added.length, removed: report.removed.length, changed: report.changed.length, unchangedPages: report.unchangedPages, unchangedFiles: report.unchangedFiles },
		added: report.added,
		removed: report.removed,
		redirects: report.redirects,
		changed,
		// Each change on more than one file, the most files first; a file's `groups` are places in this list.
		groups: report.groups.map((g) => ({ files: g.urls.length, urls: g.urls, same: g.same, match: g.match, kind: g.kind, hunk: g.hunk, ...(g.known ? { known: g.known } : {}) })),
	};
}

// ---- several builds: what varies ---------------------------------------------------------------

/** One version of a file that varies: the builds that have it (by their place in the list), or the builds that lack it. */
export interface Version {
	runs: number[];
	missing: boolean;
}

/** A file that isn't the same in every build. */
export interface Varies {
	path: string;
	url: string;
	kind: "page" | "text" | "binary";
	/** Most builds first. */
	versions: Version[];
	/** What differs between the most common version and the next one, when both are there. */
	sample: FileDiff | undefined;
	/** The file's name in each build (by its place in the list), or undefined where it's missing. */
	files: Array<string | undefined>;
}

export interface RunsReport {
	runs: string[];
	exact: boolean;
	varies: Varies[];
	/** The same difference on more than one varying file (`site.time` on every page), the most files first. Empty with `--ungrouped`. */
	groups: DiffGroup[];
	steadyPages: number;
	steadyFiles: number;
	/** The build with the most common version of the most files that vary (by its place in the list): the one to compare another build with. */
	typical: number;
}

/**
 * Builds of one site made the same way, compared with each other: the files that aren't the same
 * in all of them, and which builds agree. A reference build that changes by itself (Jekyll printing
 * the build's time, Astro's ids from `Math.random()`) is the first thing to find in a migration,
 * and both 2026-11-18 studies spent their first hour finding it by hand. "The same" is what `ssqch
 * diff` calls the same: fingerprints, integrity hashes and whitespace between tags don't count,
 * unless `exact`.
 */
export async function compareRuns(dirs: string[], options: DiffOptions): Promise<RunsReport> {
	const keep = (paths: string[]) => kept(paths, options);
	const walks = await Promise.allSettled(dirs.map(files));
	for (const walk of walks) if (walk.status === "rejected") throw walk.reason;
	checkOnly(walks.map((w) => (w as PromiseFulfilledResult<string[]>).value), options);
	const maps = walks.map((w) => keyed(keep((w as PromiseFulfilledResult<string[]>).value), options.exact));
	const keys = [...new Set(maps.flatMap((m) => [...m.keys()]))].sort(compareText);
	const report: RunsReport = { runs: dirs, exact: options.exact, varies: [], groups: [], steadyPages: 0, steadyFiles: 0, typical: 0 };
	const found: Array<Varies | undefined> = new Array(keys.length);
	let next = 0;
	const worker = async () => {
		while (next < keys.length) {
			const i = next++;
			const key = keys[i];
			const buffers = await Promise.all(maps.map(async (m, run) => {
				const file = m.get(key);
				return file === undefined ? undefined : Buffer.from(await fs.promises.readFile(path.join(dirs[run], file)));
			}));
			found[i] = varies(key, buffers, maps, options);
		}
	};
	await Promise.all(Array.from({ length: Math.min(READS_AT_ONCE, keys.length) }, worker));
	keys.forEach((key, i) => {
		const v = found[i];
		if (v) report.varies.push(v);
		else if (isPage(key)) report.steadyPages += 1;
		else report.steadyFiles += 1;
	});
	// A race (a11yproject.com's KSS) needs many builds, and the one most like the rest is the
	// reference: the most files where it has the most common version (the first build on a tie).
	const typical = dirs.map(() => 0);
	for (const v of report.varies) if (!v.versions[0].missing) for (const run of v.versions[0].runs) typical[run] += 1;
	report.typical = typical.indexOf(Math.max(...typical));
	// A build's time on every page varies the same way on each: one group, as in a diff of two.
	const samples = report.varies.map((v) => v.sample).filter((s): s is FileDiff => s !== undefined);
	report.groups = options.ungrouped ? [] : groupChanges(samples);
	for (const sample of samples) {
		if (!report.groups.length) sample.ownHunks = sample.allHunks ?? sample.hunks;
		sample.ownLines = sample.ownHunks.reduce((sum, h) => sum + h.removed.length + h.added.length, 0);
		sample.ownHunks = firstLines(sample.ownHunks, options.lines);
		delete sample.allHunks;
	}
	return report;
}

/** How `diff` sees a file: its normalized tokens (a page) or text, or its bytes. Two builds agree when these are equal. */
function seen(key: string, data: Buffer, options: DiffOptions): string {
	const text = decode(data);
	if (text === undefined) return `b:${data.toString("base64")}`;
	const normal = normalize(text, options);
	if (isPage(key) && !options.exact) return `p:${tokens(normal).map((t) => `${t.tag ? 1 : 0}${t.text}`).join("\0")}`;
	if (isXml(key) && !options.exact) return `x:${tokens(xmlWithMarkup(normal), true).map((t) => `${t.tag ? 1 : 0}${t.text}`).join("\0")}`;
	return `t:${normal}`;
}

function varies(key: string, buffers: Array<Buffer | undefined>, maps: Array<Map<string, string>>, options: DiffOptions): Varies | undefined {
	const groups = new Map<string, number[]>();
	buffers.forEach((data, run) => {
		const id = data === undefined ? "missing" : seen(key, data, options);
		const list = groups.get(id);
		if (list) list.push(run);
		else groups.set(id, [run]);
	});
	if (groups.size === 1 && !groups.has("missing")) return undefined;
	const versions = [...groups].map(([id, runs]) => ({ runs, missing: id === "missing" }));
	versions.sort((a, b) => b.runs.length - a.runs.length || a.runs[0] - b.runs[0]);
	const present = versions.filter((v) => !v.missing);
	let sample: FileDiff | undefined;
	if (present.length >= 2) {
		const [x, y] = [present[0].runs[0], present[1].runs[0]];
		sample = comparePair(buffers[x]!, buffers[y]!, { key, before: maps[x].get(key)!, after: maps[y].get(key)! }, options);
	}
	const first = buffers.find((b) => b !== undefined)!;
	const kind = decode(first) === undefined ? "binary" : isPage(key) ? "page" : "text";
	return { path: key, url: urlOf(key), kind, versions, sample, files: maps.map((m) => m.get(key)) };
}

/** The builds in `runs`, by name: `dist-1, dist-3`, or with a count for more than four: `34 of 50 builds (dist-1, dist-2, dist-4, ...)`. */
const named = (report: RunsReport, runs: number[]) => (runs.length > 4 ? `${runs.length} of ${report.runs.length} builds (${runs.slice(0, 3).map((r) => report.runs[r]).join(", ")}, ...)` : runs.map((r) => report.runs[r]).join(", "));

/** The comparison of several builds, for a terminal. */
export function runsText(report: RunsReport, limit: number, color: boolean): string {
	const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
	let out = `Comparing ${count(report.runs.length)} builds: ${report.runs.join(", ")}\n`;
	out += report.exact ? "Comparing bytes (--exact).\n" : IGNORING;
	const steady = `${plural(report.steadyPages, "page", "pages")} and ${plural(report.steadyFiles, "other file", "other files")}`;
	if (!report.varies.length) return `${out}\nEvery build is the same: ${steady}. The tracks match every time.\n`;
	out += `\nVaries (${report.varies.length})\n`;
	const grouped = report.groups.length > 0;
	if (grouped) {
		out += groupsText(report.groups, limit, paint, "The same difference on more than one file");
		const rest = report.varies.filter((f) => !f.sample || f.sample.ownLines > 0);
		if (rest.length) out += `  And each file, with what's left:\n`;
	}
	for (const file of report.varies) {
		if (grouped && file.sample && file.sample.ownLines === 0) continue;
		const [most, ...rest] = file.versions;
		// A file most builds lack is "only in" the ones that have it, when they all have the same one.
		const onlyIn = most.missing && rest.length === 1;
		const others = rest.map((v) => (v.missing ? `missing from ${named(report, v.runs)}` : onlyIn ? `only in ${named(report, v.runs)}` : `${named(report, v.runs)} differ${v.runs.length === 1 ? "s" : ""}`));
		const agree = most.missing ? `missing from ${named(report, most.runs)}` : `${named(report, most.runs)} agree${most.runs.length === 1 ? "s" : ""}`;
		out += `  ~ ${file.url}  (${file.versions.length} versions: ${agree}; ${others.join("; ")})\n`;
		const sample = file.sample;
		if (!sample) continue;
		for (const note of sample.notes) out += `      ${note}\n`;
		out += grouped ? linesText(sample.ownHunks, sample.ownLines, limit, paint) : linesText(sample.hunks, sample.changedLines, limit, paint);
	}
	out += `\n${voice.ACCOUNTS_DIFFER} ${plural(report.varies.length, "file varies", "files vary")} between builds made the same way; ${steady} are the same in all of them. Pin what changes (the build's time, random ids) before comparing another build with these, or leave it out with --ignore.\n`;
	const common = report.varies.filter((v) => !v.versions[0].missing && v.versions[0].runs.includes(report.typical)).length;
	// With no file in a most common version, no build is more like the others than another.
	if (common > 0 && report.varies.some((v) => v.versions[0].runs.length >= 2)) out += `The build most like the others: ${report.runs[report.typical]}, with the most common version of ${common} of the ${plural(report.varies.length, "file", "files")} that vary.\n`;
	// Every build different: no version is the usual one yet (a race needs more builds to show it).
	const unsettled = report.varies.filter((v) => v.versions[0].runs.length < 2).length;
	// After 20 builds or more, more won't settle it: the file is made differently every time.
	if (unsettled) out += `${unsettled === 1 ? "1 file has" : `${unsettled} files have`} no most common version: each build has its own. ${report.runs.length < 20 ? "More builds (--runs 20) show whether one is usual." : `With ${report.runs.length} builds, more won't find one: something writes ${unsettled === 1 ? "it" : "them"} differently each time (a tool's output order, a time). Pin that, or leave ${unsettled === 1 ? "it" : "them"} out with --ignore or --only.`}\n`;
	return out;
}

/** The comparison of several builds as JSON (`schemaVersion` 1). */
export function runsJson(report: RunsReport, limit: number): Record<string, unknown> {
	const runs = report.runs.map((r) => r.replaceAll("\\", "/"));
	return {
		schemaVersion: 1,
		runs,
		exact: report.exact,
		same: report.varies.length === 0,
		summary: { varies: report.varies.length, steadyPages: report.steadyPages, steadyFiles: report.steadyFiles },
		// The build with the most common version of the most files that vary.
		typical: runs[report.typical],
		varies: report.varies.map((f) => ({
			url: f.url,
			path: f.path,
			kind: f.kind,
			versions: f.versions.map((v) => ({ runs: v.runs.map((r) => runs[r]), missing: v.missing })),
			changedLines: f.sample?.changedLines ?? 0,
			hunks: f.sample ? firstLines(f.sample.hunks, limit) : [],
			groups: f.sample?.groups ?? [],
		})),
		// Each difference on more than one varying file, the most files first; a file's `groups` are places in this list.
		groups: report.groups.map((g) => ({ files: g.urls.length, urls: g.urls, same: g.same, match: g.match, kind: g.kind, hunk: g.hunk, ...(g.known ? { known: g.known } : {}) })),
	};
}
