// `ssqch diff <before> <after> --text`: how much of each page's article text is the same in two
// builds, word by word. When a move can't be byte for byte (another highlighter, a framework's
// client app in every page), it's the number a person deciding on the move wants: vuejs.org's
// came to 99.9% of 125,249 words, 99 of 109 pages identical, measured with a 50-line script that
// this replaces. The text is what's inside `<main>` (or `<article>`, or `<body>`), without its
// scripts, styles and comments, compared as words with the edit script `ssqch diff` uses.
import fs from "node:fs";
import path from "node:path";
import { diffOps } from "./myers.ts";
import { compareText } from "./paths.ts";

export interface TextPage {
	/** The page's URL, from the first build. */
	url: string;
	/** Its article's words in each build; `after` is null when the second build doesn't have the page. */
	before: number;
	after: number | null;
	/** The words in common over the longer side's (1 for two pages with no text). */
	match: number;
}

export interface TextReport {
	before: string;
	after: string;
	pages: TextPage[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ZeroWidthSpace: "" };
const BREAKS = new Set(["p", "li", "ul", "ol", "div", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th", "table", "thead", "tbody", "pre", "br", "hr", "section", "article", "header", "footer", "nav", "main", "aside", "details", "summary", "blockquote", "dl", "dt", "dd", "label", "button", "input", "img", "figure", "figcaption"]);
/** A tag, its attributes' quoted values read as values: a `<` or `>` inside one (an island's `data-props`) isn't the tag's end (the vuejs.org rerun's error reference scored 24% for that). */
const TAG = /<(\/?)([A-Za-z][\w:-]*)(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/g;

/** A page's article text as words: `<main>`, else `<article>`, else `<body>`, else the whole file. */
export function articleWords(html: string): string[] {
	const part = /<main\b[\s\S]*<\/main>/i.exec(html)?.[0] ?? /<article\b[\s\S]*<\/article>/i.exec(html)?.[0] ?? /<body\b[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
	return part
		.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(TAG, (_, _close: string, name: string) => (BREAKS.has(name.toLowerCase()) ? " " : ""))
		.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? whole))
		.replace(/​/g, "")
		.split(/\s+/)
		.filter(Boolean);
}

/** How many words two lists have in common, in order (the longest common subsequence). */
export function commonWords(a: string[], b: string[]): number {
	const ids = new Map<string, number>();
	const intern = (words: string[]) => Int32Array.from(words, (w) => { let id = ids.get(w); if (id === undefined) { id = ids.size; ids.set(w, id); } return id; });
	let common = 0;
	for (const op of diffOps(intern(a), intern(b))) if (op.tag === "equal") common += op.oldLen;
	return common;
}

function htmlFiles(dir: string, base = dir): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? htmlFiles(path.join(dir, e.name), base) : e.name.endsWith(".html") ? [path.relative(base, path.join(dir, e.name)).split(path.sep).join("/")] : []));
}

/** Each HTML page of `before`, its words and how many `after` has the same. `keep` says which files to compare (`--only`, `--exclude`). */
export function compareArticleText(before: string, after: string, keep: (file: string) => boolean = () => true, ignore: RegExp[] = []): TextReport {
	const read = (file: string) => ignore.reduce((html, re) => html.replace(re, ""), fs.readFileSync(file, "utf8"));
	const pages: TextPage[] = [];
	for (const file of htmlFiles(before).filter(keep).sort(compareText)) {
		const url = `/${file}`;
		const a = articleWords(read(path.join(before, file)));
		const other = path.join(after, file);
		if (!fs.existsSync(other)) { pages.push({ url, before: a.length, after: null, match: 0 }); continue; }
		const b = articleWords(read(other));
		const longer = Math.max(a.length, b.length);
		pages.push({ url, before: a.length, after: b.length, match: longer === 0 ? 1 : commonWords(a, b) / longer });
	}
	return { before, after, pages };
}

const pct = (x: number) => `${(Math.floor(x * 1000) / 10).toFixed(1)}%`;
/** `125,249`: thousands with commas, without `Intl` (its output can change between Node releases). */
const n = (x: number) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The summary: pages compared (those with text in the first build), how many match, and the words over all. */
export function textSummary(report: TextReport) {
	const compared = report.pages.filter((p) => p.before > 0 && p.after !== null);
	const words = compared.reduce((s, p) => s + p.before, 0);
	const longer = compared.reduce((s, p) => s + Math.max(p.before, p.after!), 0);
	const common = compared.reduce((s, p) => s + p.match * Math.max(p.before, p.after!), 0);
	return {
		pages: compared.length,
		identical: compared.filter((p) => p.match === 1).length,
		atLeast99: compared.filter((p) => p.match >= 0.99).length,
		atLeast95: compared.filter((p) => p.match >= 0.95).length,
		words,
		match: longer === 0 ? 1 : common / longer,
		noText: report.pages.filter((p) => p.before === 0).map((p) => p.url),
		missing: report.pages.filter((p) => p.after === null && p.before > 0).map((p) => p.url),
	};
}

export function textMatchText(report: TextReport, lines: number): string {
	const s = textSummary(report);
	const shown = (dir: string) => path.basename(path.resolve(dir));
	let out = `Comparing the article text (in <main>, or else <article> or <body>) of ${s.pages} ${s.pages === 1 ? "page" : "pages"}: ${report.before} and ${report.after}, word by word.\n\n`;
	out += `Identical: ${s.identical} of ${s.pages}; at least 99%: ${s.atLeast99}; at least 95%: ${s.atLeast95}.\n`;
	out += `All the words together: ${pct(s.match)} of ${n(s.words)} match.\n`;
	const differ = report.pages.filter((p) => p.before > 0 && p.after !== null && p.match < 1).sort((a, b) => a.match - b.match || compareText(a.url, b.url));
	if (differ.length) {
		const list = lines === 0 ? differ : differ.slice(0, lines);
		out += `\nThe least alike${list.length < differ.length ? ` (${list.length} of ${differ.length}; --lines 0 for all)` : ""}:\n`;
		for (const p of list) out += `  ${pct(p.match).padStart(6)}  ${p.url}  (${n(p.before)} words, ${n(p.after!)} in ${shown(report.after)})\n`;
	}
	if (s.missing.length) out += `\nNot in ${shown(report.after)}: ${s.missing.slice(0, 10).join(", ")}${s.missing.length > 10 ? `, and ${s.missing.length - 10} more` : ""}\n`;
	if (s.noText.length) out += `\nNo article text in ${shown(report.before)}: ${s.noText.slice(0, 10).join(", ")}${s.noText.length > 10 ? `, and ${s.noText.length - 10} more` : ""}\n`;
	const off = s.pages - s.identical + s.missing.length;
	out += off === 0 ? "\nThe text matches on every page.\n" : `\nThe text differs on ${off} ${off === 1 ? "page" : "pages"}; \`ssqch diff\` without --text shows how.\n`;
	return out;
}

export function textMatchJson(report: TextReport): Record<string, unknown> {
	const s = textSummary(report);
	return {
		schemaVersion: 1,
		before: report.before.replaceAll("\\", "/"),
		after: report.after.replaceAll("\\", "/"),
		summary: { pages: s.pages, identical: s.identical, atLeast99: s.atLeast99, atLeast95: s.atLeast95, words: s.words, match: Math.round(s.match * 10000) / 10000 },
		pages: report.pages.map((p) => ({ url: p.url, before: p.before, after: p.after, match: Math.round(p.match * 10000) / 10000 })),
	};
}
