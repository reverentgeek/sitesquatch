// `ssqch diff`: compare two builds of a site, file by file.
//
// Build the site before a change (an upgrade, a refactor, a migration) into one folder and after
// it into another, and this says what the change did to the output: which URLs were added and
// removed, and what changed on the pages that differ.
//
// Unless `exact` is set, differences that don't matter are ignored:
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
import { diffOps } from "./myers.ts";
import { compareText } from "./paths.ts";
import { charCount, firstChars, quoted } from "./quote.ts";
import { bytes, count } from "./report.ts";

export interface DiffOptions {
	/** Compare bytes: no fingerprint matching, and nothing ignored. */
	exact: boolean;
	/** Text matching one of these is left out of both sides before comparing. */
	ignore: RegExp[];
	/** Only compare files whose path (from the build's root, with `/`) matches one of these. */
	only: RegExp[] | undefined;
	/** The changed lines to keep for each file (0 for all): the report shows no more, so a big change doesn't fill memory. */
	lines: number;
}

/** One side of a removed or added run of lines. */
export interface Hunk {
	removed: string[];
	added: string[];
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
}

export interface DiffReport {
	before: string;
	after: string;
	exact: boolean;
	/** URLs only in the second build. */
	added: string[];
	/** URLs only in the first build. */
	removed: string[];
	changed: FileDiff[];
	unchangedPages: number;
	unchangedFiles: number;
}

export const isSame = (r: DiffReport) => !r.added.length && !r.removed.length && !r.changed.length;

// What Rust's regular expressions mean by a word character, a digit and a space.
const WORD = String.raw`[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]`;
const START = `(?<!${WORD})`;
const END = `(?!${WORD})`;

const FINGERPRINT = new RegExp(String.raw`\.([0-9a-f]{8})\.(css|js|mjs|map|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|json|xml|txt|pdf|wasm)` + END, "gu");
const INTEGRITY = /\p{White_Space}+integrity=("[^"]*"|'[^']*'|[^\p{White_Space}>]+)/gu;
const GENERATOR = new RegExp(String.raw`SiteSquatch v\p{Nd}+\.\p{Nd}+\.\p{Nd}+[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}.+\-]*`, "gu");
const ID_ATTR = /\p{White_Space}id=(?:"([^"]*)"|'([^']*)'|([^\p{White_Space}>]+))/u;
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const DATE = new RegExp([
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

/** `name` (or a whole text) without asset fingerprints: eight hex digits before the extension. Eight digits that read as a date (`report.20240101.pdf`) are part of the name, not a fingerprint. */
export function withoutFingerprints(text: string): string {
	if (!text.includes(".")) return text;
	return text.replace(FINGERPRINT, (whole, hash: string, ext: string) => (/^(19|20)\d{6}$/.test(hash) ? whole : `.${ext}`));
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
	if (options.exact) return text;
	let out = text.replaceAll("\r\n", "\n");
	for (const re of options.ignore) out = out.replace(re, "");
	out = withoutFingerprints(out);
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
function keyed(paths: string[], exact: boolean): Map<string, string> {
	if (exact) return new Map(paths.map((p) => [p, p]));
	const keys = paths.map(withoutFingerprints);
	const counts = new Map<string, number>();
	for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
	const pairs = paths.map((p, i): [string, string] => (counts.get(keys[i])! > 1 ? [p, p] : [keys[i], p]));
	return new Map(pairs.sort((a, b) => compareText(a[0], b[0])));
}

const isPage = (file: string) => file.endsWith(".html") || file.endsWith(".htm");

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
/** Whitespace a tag can't keep as it is: any but a plain space, two together, or a space before its end. */
const TAG_SPACE = new RegExp(`[${SPACE_CHARS.replace(" ", "")}]|  | [>/]`);

/** Words with one space between them, and none at either end (Rust's `split_whitespace` and `join(" ")`). */
function collapse(s: string): string {
	// Most text between a page's tags is only the indentation of the next one.
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

const RAW = new Set(["script", "style", "pre", "textarea"]);
const CLOSING = new Map([...RAW].map((name) => [name, new RegExp(`</${name}`, "gi")]));

/** Whether a character can start a tag after `<`: a letter, `/`, `!` or `?`. */
const startsTag = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 47 || c === 33 || c === 63;

/** HTML as a list of tags and pieces of text. Whitespace is collapsed, except in elements where it matters, whose content is kept line by line. */
export function tokens(html: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	let textStart = 0;
	// Whitespace is collapsed, and dropped next to block tags, where it doesn't show. Next to an
	// inline tag it does (`a <b>b</b>` isn't `a<b>b</b>`), so one space stays.
	const pushText = (s: string, nextTag: string | undefined) => {
		if (s === "") return;
		const last = out[out.length - 1];
		const before = isSpace(s.codePointAt(0)!) && last !== undefined && last.tag && isInline(last.text);
		const after = isSpace(s.charCodeAt(s.length - 1)) && nextTag !== undefined && isInline(nextTag);
		let t = collapse(s);
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
		out.push({ tag: true, text: collapseTag(tag) });
		i += end;
		textStart = i;
		// Raw content: kept exactly as it is (blank lines, indents), a line at a time. Tags inside
		// <pre> (highlighting spans) are markup like any other, but the diff is easier to read
		// with the line whole.
		const name = nameAt(tag, 1);
		if (RAW.has(name) && !tag.endsWith("/>")) {
			const closing = CLOSING.get(name)!;
			closing.lastIndex = i;
			const found = closing.exec(html);
			const len = (found ? found.index : html.length) - i;
			let raw = html.slice(i, i + len);
			// A browser drops the newline right after `<pre>` and `<textarea>`.
			if (name === "pre" || name === "textarea") raw = raw.startsWith("\r\n") ? raw.slice(2) : raw.startsWith("\n") ? raw.slice(1) : raw;
			if (raw !== "") for (const line of raw.split("\n")) out.push({ tag: false, text: line.endsWith("\r") ? line.slice(0, -1) : line });
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
function hunks<T>(before: T[], after: T[], kind: (item: T) => number, show: (item: T) => string): [Hunk[], Array<[boolean, number]>] {
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
		out.push({ removed: before.slice(op.oldIndex, op.oldIndex + op.oldLen).map(show), added: after.slice(op.newIndex, op.newIndex + op.newLen).map(show) });
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
		out.push({ removed, added });
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
	};
	const textA = decode(a), textB = decode(b);
	if (textA === undefined || textB === undefined) return diff;
	const before = normalize(textA, options), after = normalize(textB, options);
	if (before === after) return undefined;
	let found: Hunk[];
	if (isPage(pair.key) && !options.exact) {
		diff.kind = "page";
		const ta = tokens(before), tb = tokens(after);
		const [list, changed] = hunks(ta, tb, (t) => (t.tag ? 1 : 0), (t) => t.text);
		if (!list.length) return undefined;
		const isTag = ([first, i]: [boolean, number]) => (first ? ta[i] : tb[i]).tag;
		if (changed.some((c) => !isTag(c))) diff.what.push("text");
		if (changed.some(isTag)) diff.what.push("markup");
		const [old, now] = [title(ta), title(tb)];
		if (old !== undefined && now !== undefined && old !== now) diff.notes.push(`title: ${quoted(old)} -> ${quoted(now)}`);
		const kept = new Set(ids(tb));
		const gone = ids(ta).filter((id) => !kept.has(id)).map((id) => `#${id}`);
		if (gone.length) diff.notes.push(`ids removed (links to them break): ${gone.slice(0, 8).join(", ")}${gone.length > 8 ? ` and ${gone.length - 8} more` : ""}`);
		diff.onlyDates = onlyDates(list);
		if (diff.onlyDates) diff.notes.push(`only dates changed (${diff.onlyDates[0]} -> ${diff.onlyDates[1]})`);
		found = list;
	} else {
		diff.kind = isPage(pair.key) ? "page" : "text";
		const la = lines(before), lb = lines(after);
		found = hunks(la, lb, () => 0, (l) => l)[0];
		// Only the line endings at the end of the file.
		if (!found.length) found = [{ removed: [`(${Buffer.byteLength(before)} bytes)`], added: [`(${Buffer.byteLength(after)} bytes)`] }];
	}
	diff.changedLines = found.reduce((sum, h) => sum + h.removed.length + h.added.length, 0);
	diff.hunks = firstLines(found, options.lines);
	return diff;
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

/** Compares the build in `before` with the one in `after`. */
export async function compare(before: string, after: string, options: DiffOptions): Promise<DiffReport> {
	const keep = (paths: string[]) => (options.only ? paths.filter((p) => options.only!.some((re) => re.test(p))) : paths);
	// Both folders must be there before either is walked, so a missing one is said first.
	const [listA, listB] = await Promise.all([files(before), files(after)]);
	const a = keyed(keep(listA), options.exact);
	const b = keyed(keep(listB), options.exact);
	const report: DiffReport = { before, after, exact: options.exact, added: [], removed: [], changed: [], unchangedPages: 0, unchangedFiles: 0 };
	for (const key of a.keys()) if (!b.has(key)) report.removed.push(urlOf(key));
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
	return report;
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

function clip(line: string): string {
	const MAX = 200;
	const n = charCount(line);
	return n <= MAX ? line : `${firstChars(line, MAX)}… (${n - MAX} more characters)`;
}

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** The report for a terminal. `lines` is how many changed lines to show for each file (0 for all of them). */
export function diffText(report: DiffReport, limit: number, color: boolean): string {
	const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
	let out = `Comparing ${report.before} with ${report.after}\n`;
	out += report.exact ? "Comparing bytes (--exact).\n" : "Ignoring asset fingerprints, integrity hashes, the generator's version, and whitespace between tags (--exact compares bytes).\n";
	const unchanged = `${plural(report.unchangedPages, "page", "pages")} and ${plural(report.unchangedFiles, "other file", "other files")}`;
	if (isSame(report)) return `${out}\nNo differences: ${unchanged} are the same. The stump has not moved.\n`;
	if (report.added.length) {
		out += `\nAdded (${report.added.length})\n`;
		for (const url of report.added) out += paint("32", `  + ${url}\n`);
	}
	if (report.removed.length) {
		out += `\nRemoved (${report.removed.length})\n`;
		for (const url of report.removed) out += paint("31", `  - ${url}\n`);
	}
	if (report.changed.length) out += `\nChanged (${report.changed.length})\n`;
	for (const file of report.changed) {
		const about: string[] = [];
		if (file.what.length) about.push(file.what.join(" and "));
		if (file.renamed) {
			const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
			about.push(`${name(file.renamed[0])} -> ${name(file.renamed[1])}`);
		}
		if (file.kind === "binary") about.push(`binary, ${bytes(file.sizeBefore)} -> ${bytes(file.sizeAfter)}`);
		out += `  ~ ${file.url}${about.length ? `  (${about.join("; ")})` : ""}\n`;
		for (const note of file.notes) out += `      ${note}\n`;
		let shown = 0;
		done: for (const hunk of file.hunks) {
			for (const [sign, code, side] of [["-", "31", hunk.removed], ["+", "32", hunk.added]] as const) {
				for (const line of side) {
					if (limit > 0 && shown >= limit) break done;
					out += paint(code, `      ${sign} ${clip(line)}\n`);
					shown += 1;
				}
			}
		}
		if (file.changedLines > shown) out += `      ... ${count(file.changedLines - shown)} more changed ${file.changedLines - shown === 1 ? "line" : "lines"} (--lines 0 shows all)\n`;
	}
	// How many pages and other files differ, before the detail.
	const pageUrl = (url: string) => url.endsWith("/") || isPage(url);
	const pages = [...report.added, ...report.removed].filter(pageUrl).length + report.changed.filter((f) => isPage(f.path)).length;
	const others = report.added.length + report.removed.length + report.changed.length - pages;
	const found = others === 0 ? plural(pages, "page", "pages") : pages === 0 ? plural(others, "other file", "other files") : `${plural(pages, "page", "pages")} and ${plural(others, "other file", "other files")}`;
	const dated = report.changed.filter((f) => f.onlyDates).length;
	if (dated > 0) {
		const which = dated === report.changed.length ? `All ${plural(dated, "changed file", "changed files")}` : `${count(dated)} of the ${plural(report.changed.length, "changed file", "changed files")}`;
		out += `\n${which} differ only in dates or years. See \`ssqch docs "dates that changed"\`: a page with no date of its own gets its file's modification time.\n`;
	}
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
		changed,
	};
}
