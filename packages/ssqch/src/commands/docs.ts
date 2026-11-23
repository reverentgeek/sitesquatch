// `ssqch docs`: the documentation of the installed version, from the package. The docs are the
// website's pages (`site/src/docs/` in the repository, `bundled/docs/` in the package; their order
// is `nav.yml`), read as one text, so an answer always matches the version, with no network. `ssqch docs` alone is a card: every command, config option, template function
// and module export, one line each. `ssqch docs <name>` prints the section that answers, found
// by name (`base`, `imagePlugin`, `toc`), by another generator's word (`pathPrefix`, which says
// ssqch's), by heading (`content schemas`), or by the text. `--from <generator>` is the card for
// someone arriving from one.
//
// The one-line descriptions come from where the names are defined: `ssqch.d.ts` for config
// options and module exports, the command line's grammar for commands, and `BUILTIN_FILTERS`
// for template functions. A test checks that every name `ssqch capabilities` lists has a
// description and a section. Ported from `crates/ssqch/src/docs.rs`.
import yaml from "js-yaml";
import { longHelp } from "../args.ts";
import type { Grammar } from "../args.ts";
import { bundled, bundledNames, types } from "../bundled.ts";
import { configOptions } from "../config.ts";
import { red } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import type { Equivalent } from "../equivalents.ts";
import { BUILTIN_FILTERS } from "../filters.ts";
import { closest } from "../suggest.ts";
import { VERSION } from "../version.ts";
import { modules } from "./capabilities.ts";
import { agentsMd } from "./init.ts";

/** Where the docs are on the web: sitesquatch.dev, which follows `main`. */
const SITE_URL = "https://sitesquatch.dev";

/** A docs page's file: its front matter's `title`, and its Markdown. */
export function docsPage(text: string): { title: string; body: string } {
	const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	const data = front ? (yaml.load(front[1]) as Record<string, unknown> | null) ?? {} : {};
	return { title: String(data.title ?? ""), body: front ? text.slice(front[0].length) : text };
}

/** `body` with every heading one level down (`##` is `###`), except in code blocks. */
function headingsDown(body: string): string {
	let fence: string | null = null;
	return body.split(/\r?\n/).map((line) => {
		const trimmed = line.trimStart();
		const marker = ["```", "~~~"].find((m) => trimmed.startsWith(m));
		if (marker !== undefined) {
			if (fence === null) fence = marker;
			else if (fence === marker && trimmed.trimEnd().replace(new RegExp(`^\\${marker[0]}+`), "") === "") fence = null;
			return line;
		}
		return fence === null && /^#{1,5} /.test(line) ? `#${line}` : line;
	}).join("\n");
}

/**
 * The docs as one text, in `nav.yml`'s order: the front page as `# <title>`, and each other page
 * as `## <title>` with its own headings one level down, so a page's sections are inside it. The
 * trailheads (`trailheads/`) aren't in it: `--from` prints them.
 */
export function docsText(): string {
	const nav = (yaml.load(bundled("docs/nav.yml")) as Array<{ pages: unknown[] }> | null) ?? [];
	const files = nav.flatMap((group) => group.pages).filter((p): p is string => typeof p === "string" && !p.startsWith("trailheads/"));
	return files.map((file, i) => {
		const { title, body } = docsPage(bundled(`docs/${file}`));
		return i === 0 ? `# ${title}\n\n${body.trim()}\n` : `## ${title}\n\n${headingsDown(body).trim()}\n`;
	}).join("\n");
}

/** A part of the docs: a heading and the text under it, up to the next heading. */
export interface Section {
	level: number;
	title: string;
	body: string;
}

const byteLength = (text: string) => Buffer.byteLength(text);
const ALNUM = /[\p{Alphabetic}\p{N}]/u;

/** A line that's only an HTML image, perhaps in a `<p>` of its own. */
const IMAGE_LINE = /^\s*(<p\b[^>]*>\s*)?<img\b[^>]*>(\s*<\/p>)?\s*$/i;

/** The docs' sections, in order. `#` lines in code blocks aren't headings, and a line that's only an image is left out. */
export function sections(readme: string = docsText()): Section[] {
	const out: Section[] = [];
	let fence: string | null = null;
	for (const line of readme.split(/\r?\n/)) {
		const trimmed = line.trimStart();
		const marker = ["```", "~~~"].find((m) => trimmed.startsWith(m));
		if (marker !== undefined) {
			if (fence === null) fence = marker;
			// A closing fence is the marker alone; an opening one can name a language.
			else if (fence === marker && trimmed.trimEnd().replace(new RegExp(`^\\${marker[0]}+`), "") === "") fence = null;
		}
		// A line that's only an image (the docs' stickers) is for the page, not the terminal.
		if (fence === null && marker === undefined && IMAGE_LINE.test(line)) continue;
		const hashes = line.length - line.replace(/^#+/, "").length;
		if (fence === null && marker === undefined && hashes >= 1 && hashes <= 4 && line[hashes] === " ") {
			out.push({ level: hashes, title: line.slice(hashes).trim(), body: "" });
			continue;
		}
		const last = out[out.length - 1];
		if (last) last.body += line + "\n";
	}
	for (const section of out) section.body = section.body.replace(/^\n+|\n+$/g, "");
	return out;
}

/** The sections inside section `i` (one level down). */
function children(all: Section[], i: number): number[] {
	const level = all[i].level;
	const out: number[] = [];
	for (let j = i + 1; j < all.length; j++) {
		if (all[j].level <= level) break;
		if (all[j].level === level + 1) out.push(j);
	}
	return out;
}

/** A name ssqch has, with what it is. */
export interface Name {
	name: string;
	/** `command`, `config option`, `template function`, `module export` or `flag`. */
	kind: string;
	/** The module a module export is from, or the command a flag is for (none for a global flag). */
	module: string | null;
	/** What it does, as its definition says. */
	summary: string;
}

/** The first sentence of `text`, for a line of the card. A long one stops at its colon, when what's before it says enough. */
function firstSentence(text: string): string {
	let inCode = false;
	let colon: number | undefined;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "`") inCode = !inCode;
		if (c === ":" && !inCode && colon === undefined && text[i + 1] === " ") colon = i;
		if (c === "." && !inCode && text[i + 1] === " ") {
			const sentence = text.slice(0, i + 1);
			return colon !== undefined && byteLength(sentence) > 100 && byteLength(text.slice(0, colon)) > 25 ? `${text.slice(0, colon)}.` : sentence;
		}
	}
	return colon !== undefined && byteLength(text) > 100 && byteLength(text.slice(0, colon)) > 25 ? `${text.slice(0, colon)}.` : text;
}

/** Config options and module exports, with their doc comments, from `ssqch.d.ts`. */
export function typedNames(dts: string = types()): Name[] {
	const out: Name[] = [];
	let module = "", iface = "", doc = "", inDoc = false;
	for (const line of dts.split(/\r?\n/)) {
		const t = line.trim();
		if (inDoc) {
			if (t.startsWith("*/")) inDoc = false;
			else doc += " " + t.replace(/^\*+/, "").trim();
			continue;
		}
		if (t.startsWith("/**")) {
			const rest = t.slice(3);
			if (rest.endsWith("*/")) doc = rest.slice(0, -2).trim();
			else { doc = rest.trim(); inDoc = true; }
			continue;
		}
		let m: RegExpExecArray | null;
		if (line.startsWith("declare module \"")) {
			module = line.slice(16).split("\"")[0];
		} else if ((m = /^\texport interface (\w+)/.exec(line))) {
			iface = m[1];
		} else if (line === "\t}") {
			iface = "";
		} else if ((m = /^\texport function (\w+)/.exec(line))) {
			if (!out.some((n) => n.name === m![1] && n.module === module)) out.push({ name: m[1], kind: "module export", module, summary: doc.trim() });
		} else if ((m = /^\t\t(\w+)\??:/.exec(line))) {
			if (module === "ssqch" && (iface === "Config" || iface === "ConfigParts") && !out.some((n) => n.name === m![1] && n.kind === "config option")) {
				out.push({ name: m[1], kind: "config option", module: null, summary: doc.trim() });
			}
		}
		doc = "";
	}
	return out;
}

/** The commands the card lists: the ones `--help` lists. */
function visibleCommands(grammar: Grammar) {
	return grammar.commands.filter((c) => !c.hidden);
}

/** Every name the card lists: commands, config options (in the order a config's errors list them), template functions, then module exports, then flags (which the card leaves to `--help`). */
export function names(grammar: Grammar): Name[] {
	const out: Name[] = [];
	for (const command of visibleCommands(grammar)) out.push({ name: command.name, kind: "command", module: null, summary: command.about });
	const typed = typedNames();
	for (const option of configOptions()) {
		out.push({ name: option, kind: "config option", module: null, summary: typed.find((n) => n.kind === "config option" && n.name === option)?.summary ?? "" });
	}
	for (const [name, summary] of BUILTIN_FILTERS) out.push({ name, kind: "template function", module: null, summary });
	// Only the modules this build has (`ssqch/sass` is a plugin that may not be there).
	const have = modules().map((m) => m.name);
	out.push(...typed.filter((n) => n.kind === "module export" && n.module !== null && have.includes(n.module)));
	// Flags, for looking up: the global ones once, then each command's. `--help` is on the program and on every command.
	const flag = (long: string, help: string, command: string | null): Name => ({ name: `--${long}`, kind: "flag", module: command, summary: help.replace(/\n/g, " ") });
	out.push(...[...grammar.globals, { long: "help", help: "Print help" }, { long: "version", help: "Print version" }].map((o) => flag(o.long, o.help, null)));
	for (const command of visibleCommands(grammar)) {
		out.push(...[...command.options, { long: "help", help: "Print help" }].map((o) => flag(o.long, o.help, command.name)));
	}
	return out;
}

/** Lowercase words, for comparing headings and queries. */
function words(text: string): string[] {
	return text.toLowerCase().split(/[^\p{Alphabetic}\p{N}]+/u).filter((w) => w !== "");
}

/** A heading's anchor on GitHub: `where-a-value-comes-from`. */
export function slug(title: string): string {
	let out = "";
	for (const c of title.toLowerCase()) {
		if (ALNUM.test(c) || c === "-" || c === "_") out += c;
		else if (c === " ") out += "-";
	}
	return out;
}

const isNameChar = (c: string | undefined) => c !== undefined && (ALNUM.test(c) || c === "_" || c === "-");
const charAt = (text: string, i: number): string | undefined => { const c = text.codePointAt(i); return c === undefined ? undefined : String.fromCodePoint(c); };

/** Where `name` is written as code (`` `base` ``, `` `base: "/x/"` ``, `` `toc(page.headings)` ``) in `text`, not counting longer names that start with it. */
function mentionsAt(text: string, name: string): number[] {
	const needle = `\`${name}`;
	const found: number[] = [];
	for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
		if (!isNameChar(charAt(text, i + needle.length))) found.push(i);
	}
	return found;
}
const mentions = (text: string, name: string) => mentionsAt(text, name).length;

/** A section's body in pieces: paragraphs, list items, table rows (each with the table's header) and code blocks. */
function blocks(body: string): string[] {
	const out: string[] = [];
	let current = "";
	let fence: string | null = null;
	let header = "";
	const flush = () => {
		if (current.trim() !== "") out.push(current.trimEnd());
		current = "";
	};
	const lines = body.split(/\r?\n/);
	const isSeparator = (l: string) => l.includes("---") && [...l].every((c) => "|-: ".includes(c));
	for (let n = 0; n < lines.length; n++) {
		const line = lines[n];
		const trimmed = line.trimStart();
		if (fence !== null) {
			current += line + "\n";
			if (trimmed.startsWith(fence) && trimmed.trimEnd().replace(new RegExp(`^\\${fence[0]}+`), "") === "") {
				fence = null;
				flush();
			}
			continue;
		}
		const open = ["```", "~~~"].find((m) => trimmed.startsWith(m));
		if (open !== undefined) {
			flush();
			fence = open;
			current += line + "\n";
			continue;
		}
		if (line.trim() === "") {
			flush();
			header = "";
			continue;
		}
		if (line.startsWith("|")) {
			flush();
			if (isSeparator(line)) continue;
			if (header === "" && n + 1 < lines.length && isSeparator(lines[n + 1])) header = `${line}\n${lines[n + 1]}\n`;
			else out.push(`${header}${line}`);
			continue;
		}
		const item = trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\. /.test(trimmed);
		if (item && !line.startsWith("  ")) flush();
		current += line + "\n";
	}
	flush();
	return out;
}

/** How far into `block`, past a list or table marker, `name` is first written as code (in bytes), if it is. */
function firstMention(block: string, name: string): number | undefined {
	const row = block.split("\n").at(-1) ?? "";
	const text = (block.startsWith("|") ? row : block).replace(/^[|\-* ]+/, "");
	const at = mentionsAt(text, name)[0];
	return at === undefined ? undefined : byteLength(text.slice(0, at));
}

/**
 * A block that starts with `name` in bold (`**Containers:**` for `containers`, `- **Pagination:**`):
 * the paragraph that explains it, which a table row (`| \`containers\` | ... (below). |`) only points at.
 */
function leadsWith(block: string, name: string): boolean {
	const lead = /^(?:[-*] )?\*\*([^*]+?):?\*\*/.exec(block)?.[1];
	return lead !== undefined && words(lead).join(" ") === words(name).join(" ");
}

/**
 * Where the README documents `name`: the blocks that define it (it's the first thing they write
 * as code, as in a table row or a list item), in the section that has the best one, and that
 * section. Without a definition, the block that writes it as code most often.
 */
function passages(all: Section[], name: string): [number, string[], boolean] | undefined {
	let best: [number, number, string] | undefined;
	const defining: Array<[number, string]> = [];
	all.forEach((s, i) => {
		for (const block of blocks(s.body)) {
			const n = mentions(block, name);
			const leads = leadsWith(block, name);
			if (n === 0 && !leads) continue;
			const at = firstMention(block, name);
			const defines = (at !== undefined && at < 60) || leads;
			if (defines) defining.push([i, block]);
			const score = n + (defines ? 1000 : 0) + mentions(s.title, name) * 100;
			if (best === undefined || score > best[1]) best = [i, score, block];
		}
	});
	if (best === undefined) return undefined;
	const [section, , block] = best;
	let found = defining.filter(([i]) => i === section).map(([, b]) => b).slice(0, 3);
	const defined = found.length > 0;
	if (!defined) found = [block];
	return [section, found, defined];
}

/** Other sections that write `name` as code, most often first. */
function also(all: Section[], name: string, not: number): number[] {
	const found = all.map((s, i) => [i, mentions(s.body, name) + mentions(s.title, name) * 10] as const).filter(([i, n]) => i !== not && n > 0);
	found.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	return found.map(([i]) => i).slice(0, 4);
}

/** The section with heading `title`, by its words (`content schemas`, `Content schemas`) or its anchor. */
/**
 * A display title's plain words, after its theme: "Getting spotted: SEO tags" is "SEO tags", and
 * "Has the stump moved? Comparing two builds" is "Comparing two builds". A title without one is
 * itself. `ssqch docs` finds a page by either, and names it by the plain words.
 */
export function plainTitle(title: string): string {
	const at = /[:?] /.exec(title);
	return at ? title.slice(at.index + 2) : title;
}

function heading(all: Section[], query: string): number | undefined {
	const q = words(query);
	if (q.length === 0) return undefined;
	const anchor = query.replace(/^#+/, "");
	const exact = all.findIndex((s) => words(s.title).join(" ") === q.join(" ") || words(plainTitle(s.title)).join(" ") === q.join(" ") || slug(s.title) === anchor);
	if (exact !== -1) return exact;
	// Every word of the query starts a word of the heading (`schema` finds "Content schemas"); the shortest heading wins.
	let best: number | undefined;
	all.forEach((s, i) => {
		const title = words(s.title);
		if (q.every((w) => title.some((t) => t.startsWith(w))) && (best === undefined || byteLength(s.title) < byteLength(all[best].title))) best = i;
	});
	return best;
}

/** The blocks that have every word of `query` (as the start of a word, so `schema` finds "schemas"), best first: the most mentions for their length. */
function search(all: Section[], query: string): Array<[number, string]> {
	const q = words(query);
	const found: Array<[number, string, number]> = [];
	all.forEach((s, i) => {
		const title = words(s.title);
		for (const block of blocks(s.body)) {
			const text = words(block);
			const hits = q.map((w) => [...text, ...title].filter((t) => t.startsWith(w)).length);
			if (hits.every((n) => n > 0)) {
				// A word written as code (`<picture>`, `feedPlugin()`) is the thing itself, where prose
				// can use it in passing: `picture` found slugger's "Misc Pictures" before imagePlugin's
				// `<picture>`s, and `feed` a list about diff (Squatch Snacks, D1). Each, as the whole word, counts four times.
				const code = words((block.match(/`[^`\n]+`/g) ?? []).join(" "));
				for (const [k, w] of q.entries()) hits[k] += 3 * code.filter((t) => t === w).length;
				// A paragraph's bold label is a small heading (`**Your own languages:**`): one that has every word of the query is the answer.
				const labelEnd = block.startsWith("**") ? block.indexOf(":**") : -1;
				const label = labelEnd === -1 ? [] : words(block.slice(2, labelEnd));
				const labeled = q.every((w) => label.some((t) => t.startsWith(w)));
				const score = Math.floor((hits.reduce((a, b) => a + b, 0) * 100_000) / (byteLength(block) + 400)) + (labeled ? 1_000_000 : 0);
				found.push([i, block, score]);
			}
		}
	});
	found.sort((a, b) => b[2] - a[2] || a[0] - b[0]);
	return found.map(([i, block]) => [i, block]);
}

/** Another generator's word: `pathPrefix`, `--drafts`, `eleventy.generator`. */
function foreign(query: string): Equivalent | undefined {
	return equivalents.TABLE.find((e) => e.word === query || (e.kind === "global" && query.startsWith(e.word)) || (e.kind === "global" && e.word.replace(/\.+$/, "") === query));
}

/** What `ssqch docs <query>` found. */
export interface Answer {
	query: string;
	/** What the name is: one or more (`markdown` is a config option, a template function and an export). */
	names: Name[];
	equivalent?: Equivalent;
	/** A command's `--help`. */
	help?: string;
	section?: number;
	/** The parts of `section` about the name, when the answer isn't the whole section. */
	passages: string[];
	/** Other sections that mention it. */
	also: number[];
}

/** `ssqch serve --help`, as the long help prints it. */
function helpOf(grammar: Grammar, command: string): string | undefined {
	const found = grammar.commands.find((c) => c.name === command);
	return found && longHelp(grammar, found).trimEnd();
}

/** Looks `query` up: a name ssqch has (a command, config option, function, export or flag), another generator's word, a heading, then the text. */
export function answer(grammar: Grammar, all: Section[], known: Name[], rawQuery: string): Answer | undefined {
	let query = rawQuery.trim();
	if (query.startsWith("ssqch ")) query = query.slice(6);
	query = query.trim();
	if (query === "") return undefined;
	const blank: Answer = { query, names: [], passages: [], also: [] };
	const matching = known.filter((n) => n.name === query || (n.kind === "command" && n.name.toLowerCase() === query.toLowerCase()));
	if (matching.length) {
		// `serve` is a command and a config option: its --help, then the README on the option.
		const command = matching.find((n) => n.kind === "command");
		const help = command && helpOf(grammar, command.name);
		const others = matching.some((n) => n.kind !== "command");
		const a: Answer = { ...blank, names: matching, help };
		const found = others ? passages(all, query) : undefined;
		if (found) {
			a.also = also(all, query, found[0]);
			a.section = found[0];
			a.passages = found[1];
		}
		return a;
	}
	const e = foreign(query);
	if (e) {
		// The answer to the hint's own `More: ssqch docs ...`.
		const more = e.more.startsWith("ssqch docs ") ? e.more.slice(11).replace(/^"+|"+$/g, "") : undefined;
		const a = (more !== undefined && more !== query ? answer(grammar, all, known, more) : undefined) ?? blank;
		return { ...a, equivalent: e, query };
	}
	const i = heading(all, query);
	if (i !== undefined) return { ...blank, section: i };
	const bare = query.replace(/^`+|`+$/g, "");
	if (!/\s/.test(bare)) {
		const found = passages(all, bare);
		// A plain word no block defines, only mentions (`feed`, in a list about diff that names a
		// `feed.xml`), is a word to search for, as several are. One that looks like code
		// (`avifEffort`, `page.url`) keeps the block that writes it most.
		if (found && (found[2] || !/^[a-z]+$/.test(bare) || search(all, bare).length === 0)) return { ...blank, also: also(all, bare, found[0]), section: found[0], passages: found[1] };
	}
	const hits = search(all, query);
	if (hits.length === 0) return undefined;
	const [section, block] = hits[0];
	const others: number[] = [];
	for (const [j] of hits) if (j !== section && !others.includes(j)) others.push(j);
	return { ...blank, section, passages: [block], also: others.slice(0, 4) };
}

/** A name, heading or word close to `query`, for "did you mean". */
function closestName(all: Section[], known: Name[], query: string): string | undefined {
	return closest(query, [...known.map((n) => n.name), ...all.map((s) => s.title), ...equivalents.TABLE.map((e) => e.word)]);
}

function what(name: Name): string {
	if (name.kind === "flag") return name.module !== null ? `\`${name.name}\` (flag of ssqch ${name.module})` : `\`${name.name}\` (flag of every command)`;
	return name.module !== null ? `\`${name.name}\` (from "${name.module}")` : `\`${name.name}\` (${name.kind})`;
}

function sectionText(all: Section[], i: number): string {
	const s = all[i];
	let out = `${"#".repeat(Math.max(s.level, 2))} ${s.title}\n`;
	if (s.body !== "") out += `\n${s.body}\n`;
	const inside = children(all, i);
	if (inside.length) out += `\nIn this section (ssqch docs "<title>"): ${inside.map((j) => `"${all[j].title}"`).join(", ")}\n`;
	return out;
}

function answerText(all: Section[], a: Answer): string {
	let out = "";
	if (a.equivalent) {
		const e = a.equivalent;
		const from = e.from.length === 1 ? ` (${e.from[0]})` : "";
		out += `\`${e.word.replace(/\.+$/, "")}\`${from} ${e.alias ? "works in ssqch too" : "isn't ssqch's word"}. ${e.say}\n\n`;
	}
	if (a.help !== undefined) out += `${a.help}\n\n`;
	const described = a.names.filter((n) => n.kind !== "command" || a.help === undefined);
	for (const name of described) out += `${what(name)}: ${name.summary}\n`;
	if (described.length) out += "\n";
	if (a.section !== undefined && a.passages.length) {
		out += `From "${all[a.section].title}" (ssqch docs "${plainTitle(all[a.section].title)}"):\n\n${a.passages.join("\n\n")}\n`;
	} else if (a.section !== undefined) {
		out += sectionText(all, a.section);
	} else if (a.help === undefined && a.equivalent) {
		out += `More: ${a.equivalent.more}\n`;
	}
	if (a.also.length) out += `\nAlso in: ${a.also.map((j) => `"${all[j].title}"`).join(", ")}\n`;
	return out.trimEnd() + "\n";
}

function answerJson(all: Section[], a: Answer): Record<string, unknown> {
	const out: Record<string, unknown> = { query: a.query, found: true };
	if (a.names.length) out.names = a.names.map((n) => ({ name: n.name, kind: n.kind, module: n.module, summary: n.summary }));
	if (a.equivalent) out.equivalent = { ...equivalents.toJson(a.equivalent), say: a.equivalent.say };
	if (a.help !== undefined) out.help = a.help;
	if (a.section !== undefined) {
		const s = all[a.section];
		out.section = { title: s.title, anchor: slug(s.title), whole: a.passages.length === 0, text: a.passages.length === 0 ? s.body : a.passages.join("\n\n"), sections: children(all, a.section).map((j) => all[j].title) };
	}
	if (a.also.length) out.also = a.also.map((j) => all[j].title);
	return out;
}

/** `ssqch docs` alone: everything, one line each. */
function card(all: Section[], known: Name[]): string {
	let out = `ssqch ${VERSION}. \`ssqch docs <name>\` for one, \`ssqch docs --from <generator>\` for another generator's words, \`ssqch docs agents\` for an AGENTS.md.\n`;
	const group = (title: string, rows: Array<[string, string]>, indent: number) => {
		if (rows.length === 0) return;
		if (title !== "") out += `\n${title}\n`;
		const width = Math.max(...rows.map(([n]) => n.length));
		for (const [name, summary] of rows) out += `${" ".repeat(indent)}${name.padEnd(width)}  ${firstSentence(summary)}\n`;
	};
	const of = (kind: string): Array<[string, string]> => known.filter((n) => n.kind === kind).map((n) => [n.name, n.summary]);
	group("Commands", of("command"), 2);
	group("Config options (ssqch.config.js)", of("config option"), 2);
	group("Template functions", of("template function"), 2);
	const mods: string[] = [];
	for (const n of known.filter((n) => n.kind === "module export")) if (n.module !== null && !mods.includes(n.module)) mods.push(n.module);
	out += "\nModules (import { name } from \"module\")\n";
	for (const module of mods) {
		const rows = known.filter((n) => n.module === module && n.kind === "module export");
		const width = Math.max(...rows.map((n) => n.name.length));
		out += `  ${module}\n`;
		for (const n of rows) out += `    ${n.name.padEnd(width)}  ${firstSentence(n.summary)}\n`;
	}
	out += `\nTopics\n  ${all.filter((s) => s.level === 2).map((s) => s.title).join(", ")}\n`;
	return out;
}

function cardJson(all: Section[], known: Name[]): Record<string, unknown> {
	const rows = (kind: string) => known.filter((n) => n.kind === kind).map((n) => ({ name: n.name, summary: n.summary }));
	const mods: Array<{ name: string; exports: Array<{ name: string; summary: string }> }> = [];
	for (const n of known.filter((n) => n.kind === "module export")) {
		const module = n.module ?? "";
		const row = { name: n.name, summary: n.summary };
		const found = mods.find((m) => m.name === module);
		if (found) found.exports.push(row);
		else mods.push({ name: module, exports: [row] });
	}
	return { version: VERSION, commands: rows("command"), configOptions: rows("config option"), templateFunctions: rows("template function"), modules: mods, topics: all.filter((s) => s.level === 2).map((s) => s.title) };
}

/** The generators the table and the guides know, by name. */
function generators(): string[] {
	const out: string[] = [];
	for (const g of [...equivalents.TABLE.flatMap((e) => e.from), ...equivalents.OTHER_CONFIGS.map(([, generator]) => generator)]) {
		if (!out.includes(g)) out.push(g);
	}
	return out;
}

/** Where to look after a search found nothing: the card for a generator the words name (`ssqch docs --from eleventy`), or one of the words that's a name or another generator's word. */
function nextStep(grammar: Grammar, all: Section[], known: Name[], query: string): string | undefined {
	const ws = query.split(/[^\p{Alphabetic}\p{N}.-]+/u).filter((w) => w !== "");
	const list = generators();
	for (const w of ws) {
		const generator = list.find((g) => g.toLowerCase() === w.toLowerCase() || g.replace(/\./g, "").toLowerCase() === w.toLowerCase());
		if (generator) return `ssqch docs --from ${generator.toLowerCase()}`;
	}
	if (ws.length < 2) return undefined;
	// A name (a command, an option, a function) or another generator's word, not any word in the text.
	const word = ws.find((w) => known.some((n) => n.name === w) || answer(grammar, all, known, w)?.equivalent !== undefined);
	return word === undefined ? undefined : `ssqch docs ${word}`;
}

/** The guide for `generator`: its file name, and its text. */
function guide(generator: string): { file: string; text: string | null } | undefined {
	const configured = equivalents.OTHER_CONFIGS.find(([, g]) => g === generator)?.[3] ?? null;
	const available = bundledNames("docs/trailheads");
	const file = configured ?? (available.includes(`from-${generator.toLowerCase()}.md`) ? `from-${generator.toLowerCase()}.md` : undefined);
	if (file === undefined) return undefined;
	if (!available.includes(file)) return { file, text: null };
	// As the page reads: its title, then its text.
	const { title, body } = docsPage(bundled(`docs/trailheads/${file}`));
	return { file, text: `# ${title}\n\n${body.trim()}\n` };
}

/** The section of a trailhead whose heading is the query, ignoring case: its page, generator and text. */
function trailheadSection(query: string): { page: string; generator: string; heading: string; text: string } | undefined {
	const wanted = query.trim().toLowerCase();
	for (const file of bundledNames("docs/trailheads").sort()) {
		const { title, body } = docsPage(bundled(`docs/trailheads/${file}`));
		const lines = body.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const m = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
			if (!m || m[2].toLowerCase() !== wanted) continue;
			let end = i + 1;
			let fence = false;
			for (; end < lines.length; end++) {
				if (/^(```|~~~)/.test(lines[end])) fence = !fence;
				const next = !fence && /^(#{2,6})\s/.exec(lines[end]);
				if (next && next[1].length <= m[1].length) break;
			}
			return { page: title, generator: file.replace(/^from-/, "").replace(/\.md$/, ""), heading: m[2], text: `${lines.slice(i, end).join("\n").trim()}\n` };
		}
	}
	return undefined;
}

/** A trailhead's page on sitesquatch.dev: `from-eleventy.md` is `/docs/trailheads/from-eleventy/`. */
const guideUrl = (file: string) => `${SITE_URL}/docs/trailheads/${file.replace(/\.md$/, "")}/`;

/** `ssqch docs --from <generator>`: its words, ssqch's names for them, and its trailhead. */
function from(generator: string, json: boolean): string {
	const known = generators();
	const found = known.find((g) => g.toLowerCase() === generator.toLowerCase() || g.replace(/\./g, "").toLowerCase() === generator.toLowerCase());
	if (found === undefined) {
		const near = closest(generator.toLowerCase(), known.map((g) => g.toLowerCase()));
		throw new Error(`--from ${generator}: no trailhead for that generator${near ? ` (did you mean \`${near}\`?)` : ""}. There are: ${known.map((g) => g.toLowerCase()).join(", ")}`);
	}
	const theirs = equivalents.TABLE.filter((e) => e.from.includes(found));
	const everyone = equivalents.TABLE.filter((e) => e.from.length === 0);
	const g = guide(found);
	if (json) {
		const rows = (list: readonly Equivalent[]) => list.map((e) => ({ ...equivalents.toJson(e), say: e.say }));
		const value = { generator: found, words: rows(theirs), common: rows(everyone), trailhead: g ? { file: `site/src/docs/trailheads/${g.file}`, url: guideUrl(g.file), text: g.text } : null };
		return JSON.stringify(value, null, 2) + "\n";
	}
	let out = `${found}'s words, and ssqch's names for them. The ones marked (works) are aliases: they do the same as ssqch's name, and say it once. The others are refused with this hint.\n`;
	const kinds: Array<[equivalents.Kind, string]> = [["command", "Commands"], ["flag", "Flags"], ["config", "Config"], ["frontMatter", "Front matter"], ["filter", "Filters"], ["global", "In templates"]];
	const shown = (e: Equivalent) => {
		const word = e.kind === "global" && e.word.endsWith(".") ? `${e.word}*` : e.word;
		return e.alias ? `${word} (works)` : word;
	};
	const rows = (list: readonly Equivalent[]) => {
		const width = Math.max(...list.map((e) => shown(e).length));
		return list.map((e) => `  ${shown(e).padEnd(width)}  ${e.say}\n`).join("");
	};
	for (const [kind, label] of kinds) {
		const list = theirs.filter((e) => e.kind === kind);
		if (list.length) out += `\n${label}\n${rows(list)}`;
	}
	if (everyone.length) out += `\nWords most generators use\n${rows(everyone)}`;
	if (g && g.text !== null) out += `\nThe trailhead (${guideUrl(g.file)}):\n\n${g.text.trimEnd()}\n\nThe move, step by step (reference builds with \`ssqch baseline\`, the biggest group of differences first): \`ssqch docs "moving a site with an agent"\`.\n`;
	else if (g) out += `\nThe trailhead: ${guideUrl(g.file)}\n`;
	else out += "\nThere's no trailhead for it yet; `ssqch docs trailheads` has the general route.\n";
	return out;
}

/** The docs page a query names by its file (`comparing-builds`, `comparing-builds.md`, `/docs/comparing-builds/`): its title, or the generator for a trailhead. */
function pageNamed(query: string): { file: string; title?: string; trailhead?: string } | undefined {
	const name = query.trim().replace(/^.*\/docs\//, "").replace(/^\/+|\/+$/g, "").replace(/\.md$/, "");
	if (!/^[\w-]+(\/[\w-]+)?$/.test(name)) return undefined;
	const nav = (yaml.load(bundled("docs/nav.yml")) as Array<{ pages: unknown[] }> | null) ?? [];
	const files = nav.flatMap((group) => group.pages).filter((p): p is string => typeof p === "string");
	const file = files.find((f) => f.replace(/\.md$/, "") === name || (!name.includes("/") && f.replace(/\.md$/, "").split("/").pop() === name));
	if (file === undefined) return undefined;
	const trail = /^trailheads\/from-([\w-]+)\.md$/.exec(file);
	if (trail) return { file, trailhead: trail[1] };
	return { file, title: docsPage(bundled(`docs/${file}`)).title };
}

export interface DocsCommand {
	query: string[];
	from?: string;
	format: string;
}

/** `ssqch docs`. Answers the exit code. */
export function runDocs(grammar: Grammar, command: DocsCommand): number {
	const fail = (message: string) => { process.stderr.write(`${red("error:")} ${message}\n`); return 1; };
	if (command.format !== "text" && command.format !== "json") return fail(`--format ${command.format}: use text or json`);
	const json = command.format === "json";
	const out = (text: string) => { process.stdout.write(text); return 0; };
	if (command.from !== undefined) {
		if (command.query.length) return fail(`--from lists one generator's words; leave out \`${command.query.join(" ")}\`, or look it up without --from`);
		try {
			return out(from(command.from, json));
		} catch (e) {
			return fail((e as Error).message);
		}
	}
	const all = sections();
	const known = names(grammar);
	if (command.query.length === 0) return out(json ? JSON.stringify(cardJson(all, known), null, 2) + "\n" : card(all, known));
	const query = command.query.join(" ");
	// The AGENTS.md a starter has, for a site that doesn't have one yet.
	if (query === "agents") {
		const text = agentsMd();
		return out(json ? JSON.stringify({ query, found: true, agentsMd: text }, null, 2) + "\n" : text);
	}
	// A page's file name, as its link on the site ends (`comparing-builds`, `trailheads/from-eleventy.md`):
	// that page, and a trailhead as `--from` prints it.
	// A name ssqch has (`footprint` is a command and a page) answers as a name.
	const page = known.some((n) => n.name === query) ? undefined : pageNamed(query);
	if (page?.trailhead !== undefined) {
		try {
			return out(from(page.trailhead, json));
		} catch {
			// A trailhead no one generator's words name (`from-component-frameworks`): the page itself.
			const { title, body } = docsPage(bundled(`docs/${page.file}`));
			const text = `# ${title}\n\n${body.trim()}\n`;
			return out(json ? JSON.stringify({ query, found: true, page: { file: `site/src/docs/${page.file}`, url: guideUrl(page.file.replace(/^trailheads\//, "")), text } }, null, 2) + "\n" : text);
		}
	}
	// A heading in a trailhead (`"moving with identical output first"`): the main docs don't have
	// the trailheads (`--from` prints them), but scout's lines and the trailheads point at their
	// sections. A heading's own words beat a page that only mentions them, unless the main docs
	// have that heading or name too.
	const trail = page === undefined ? trailheadSection(query) : undefined;
	const exact = trail !== undefined && !known.some((n) => n.name === query) && !all.some((s) => s.title.toLowerCase() === query.trim().toLowerCase() || plainTitle(s.title).toLowerCase() === query.trim().toLowerCase());
	const a = page?.title !== undefined ? { query, names: [], passages: [], also: [], section: all.findIndex((s) => s.level <= 2 && s.title === page.title) } : exact ? undefined : answer(grammar, all, known, query);
	if (a && a.section !== -1) return out(json ? JSON.stringify(answerJson(all, a), null, 2) + "\n" : answerText(all, a));
	if (trail) return out(json ? JSON.stringify({ query, found: true, trailhead: trail }, null, 2) + "\n" : `From "${trail.page}" (ssqch docs --from ${trail.generator}):\n\n${trail.text}`);
	const near = closestName(all, known, query);
	const next = near === undefined ? nextStep(grammar, all, known, query) : undefined;
	if (json) {
		out(JSON.stringify({ query, found: false, didYouMean: near ?? null, tryInstead: next ?? null }, null, 2) + "\n");
	} else {
		const hint = near ? ` (did you mean \`${near}\`?)` : "";
		process.stderr.write(`${red("error:")} no tracks of "${query}" in the docs${hint}. ${next ? `Try \`${next}\`, or \`ssqch docs\` for everything.` : "`ssqch docs` lists everything."}\n`);
	}
	return 1;
}
