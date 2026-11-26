// Warnings and errors as data, for `ssqch build --format json`.
//
// A build prints its warnings (`warn: ...`) and fails with its error as text. A script or a
// coding agent wants the same things with their parts apart: a code, the file, the line when
// it's known, and the field for a content error. `warn` is how the build and its plugins report
// a warning, `Diagnostics` is an error that keeps its problems apart, and `fromError` turns any
// build error into a list.
import fs from "node:fs";
import path from "node:path";
import { parseFrontMatter } from "./data.ts";
import * as equivalents from "./equivalents.ts";
import type { Equivalent } from "./equivalents.ts";
import { realPath } from "./paths.ts";

/**
 * One problem. The codes: `config`, `data`, `front-matter`, `template`, `schema`, `conflict`,
 * `links`, `images`, `assets`, `fetch`, `passthrough`, `last-modified`, `hook` and `build`
 * (anything else).
 */
export interface Diagnostic {
	severity: "warning" | "error";
	code: string;
	/** What a person reads; it names the file too. */
	message: string;
	/** From the project root, with forward slashes. */
	file?: string;
	/** A line of `file`, from 1. */
	line?: number;
	/** The field of the page's data (a schema problem). */
	field?: string;
	/** The page's URL, when the problem is in what was written (a broken link). */
	url?: string;
	/** The key of the page's front matter the code frame points at, when it isn't `field`: a misspelled field's frame shows the misspelling. Not in the JSON. */
	at?: string;
}

type Extra = Pick<Diagnostic, "file" | "line" | "field" | "url" | "at">;

/** A file as diagnostics name it: from the root, forward slashes, no `./` in front. */
const shownFile = (file: string) => file.replaceAll("\\", "/").replace(/^(\.\/)+/, "");

export function warning(code: string, message: string, extra: Extra = {}): Diagnostic {
	const found: Diagnostic = { severity: "warning", code, message, ...extra };
	if (found.file !== undefined) found.file = shownFile(found.file);
	return found;
}

export function error(code: string, message: string, extra: Extra = {}): Diagnostic {
	return { ...warning(code, message, extra), severity: "error" };
}

/** `code` and `message` always; the rest when known. The key order is the report's. */
export function toJson(d: Diagnostic): Record<string, unknown> {
	const out: Record<string, unknown> = { code: d.code, message: d.message };
	// Another generator's word, and ssqch's name for it, as data.
	const equivalent = equivalents.inMessage(d.message);
	if (equivalent) out.hint = equivalents.toJson(equivalent);
	if (d.file !== undefined) out.file = d.file;
	if (d.line !== undefined) out.line = d.line;
	if (d.field !== undefined) out.field = d.field;
	if (d.url !== undefined) out.url = d.url;
	return out;
}

/**
 * An error made of several problems. Its message lists them the way the build always has.
 * `context` puts words in front of the message and keeps the problems as they are.
 */
export class Diagnostics extends Error {
	items: Diagnostic[];
	constructor(message: string, items: Diagnostic[]) {
		super(message);
		this.name = "Diagnostics";
		this.items = items;
	}
}

/** A build's own error: what went wrong in the site, said in the message. Its stack isn't shown. */
export class BuildError extends Error {
	/** The problems apart, when the error was made from several (or from one with its file known). */
	items?: Diagnostic[];
	constructor(message: string, items?: Diagnostic[]) {
		super(message);
		this.name = "BuildError";
		this.items = items;
	}
}

/** A message for anything thrown. */
export function messageOf(e: unknown): string {
	if (e instanceof Error) return e.message;
	return String(e);
}

/** `e` with `words: ` in front of its message, keeping the problems it holds apart. */
export function context(e: unknown, words: string): BuildError {
	const items = e instanceof Diagnostics || e instanceof BuildError ? e.items : undefined;
	return new BuildError(`${words}: ${messageOf(e)}`, items);
}

/** Fails with `message`. */
export function bail(message: string): never {
	throw new BuildError(message);
}

// ---- what a run has said so far ------------------------------------------------------------

let capturing = false;
let quiet = false;
let warnings: Diagnostic[] = [];
let aliases: Equivalent[] = [];

/** Keep warnings for `takeWarnings` instead of printing them, and leave standard output to the report: progress lines go to standard error. */
export function capture(on = true): void {
	capturing = on;
}

export function isCapturing(): boolean {
	return capturing;
}

/** The warnings since `capture` (or the last call). */
export function takeWarnings(): Diagnostic[] {
	const taken = warnings;
	warnings = [];
	return taken;
}

/** Report a warning: printed as `warn: <message>`, or kept when capturing. */
/** How many warnings have been said in this process: a step that said none can be skipped later without losing one. */
export let warnedCount = 0;

/** Hears each warning as it's said: the dev server's renderer, which keeps each page's (`build.ts`). */
let hearing: ((diagnostic: Diagnostic) => void) | undefined;
export function hearWarnings(listener: ((diagnostic: Diagnostic) => void) | undefined): void {
	hearing = listener;
}

export function warn(diagnostic: Diagnostic): void {
	warnedCount += 1;
	hearing?.(diagnostic);
	if (capturing) warnings.push(diagnostic);
	else process.stderr.write(`warn: ${diagnostic.message}\n`);
}

/** `--quiet`: aliases don't say what ssqch calls them. */
export function setQuiet(on: boolean): void {
	quiet = on;
}

/**
 * Another generator's word was used as an alias (`pathPrefix`): say ssqch's name for it, once a
 * run (`note: pathPrefix works; ssqch calls it base ...`), on standard error. Not a warning: when
 * capturing, it's kept for the JSON report's `aliases`. `--quiet` hides it.
 */
export function aliasUsed(row: Equivalent): void {
	if (aliases.includes(row)) return;
	aliases.push(row);
	if (!capturing && !quiet) process.stderr.write(`note: ${equivalents.note(row)}\n`);
}

/** Aliases that have been said already, by the server a build is for: they aren't said again. */
export function aliasesKnown(rows: Equivalent[]): void {
	for (const row of rows) if (!aliases.includes(row)) aliases.push(row);
}

/** The aliases used so far, for the JSON report. */
export function aliasesUsed(): Equivalent[] {
	return [...aliases];
}

/** Forget what this run has said (for tests, and for a server that reads its config again). */
export function reset(): void {
	capturing = false;
	quiet = false;
	warnings = [];
	aliases = [];
}

/** A line of progress (`[ssqch] Writing ...`): standard output, or standard error when that's kept for a JSON report. */
export function progress(line: string): void {
	(capturing ? process.stderr : process.stdout).write(line + "\n");
}

/**
 * `label` (`error:`) in red, when standard error is a terminal that takes colour. A log file or
 * a CI job gets the plain word, and so does anyone who sets `NO_COLOR`; `FORCE_COLOR` is for a
 * pager that understands the codes.
 */
export function red(label: string): string {
	const set = (name: string) => (process.env[name] ?? "") !== "";
	const colour = !set("NO_COLOR") && (set("FORCE_COLOR") || (process.stderr.isTTY === true && process.env.TERM !== "dumb"));
	return colour ? `\x1b[31m${label}\x1b[0m` : label;
}

// ---- where an error is ---------------------------------------------------------------------

/** Where the files an error names can be: the project root, then the input folder and the folders in it that templates and data are named from. */
export class Locator {
	root: string;
	dirs: string[];
	constructor(root: string, dirs: string[] = []) {
		this.root = root;
		this.dirs = [root, ...dirs];
	}

	/** The file `name` means, and its path from the root. */
	find(name: string): { path: string; shown: string } | undefined {
		name = name.replace(/^["'`]+|["'`]+$/g, "");
		if (name === "") return undefined;
		for (const dir of this.dirs) {
			let file = path.resolve(dir, name);
			if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
			file = realPath(file);
			// From the root when it's inside it, otherwise the whole path, as 0.7 showed it (a
			// linked package's file isn't `../../../..` from the site).
			const rel = path.relative(realPath(this.root), file);
			const outside = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
			const shown = (outside ? file : rel).split(path.sep).join("/");
			return { path: file, shown };
		}
		return undefined;
	}
}


/** The lines of a template before its body: its front matter, and the blank lines after it. Template engines count lines from the body. */
function linesBeforeBody(file: string): number | undefined {
	try {
		const src = fs.readFileSync(file, "utf8");
		const { body } = parseFrontMatter(src);
		return src.slice(0, src.length - body.length).split("\n").length - 1;
	} catch {
		return undefined;
	}
}

type Kind = "file" | "fileLine" | "bodyLine" | "frontMatterLine";

// `fileLine`: the line is a line of the file. `bodyLine`: it counts from the template's body.
// `frontMatterLine`: it counts from the start of the front matter.
const PATTERNS: Array<[RegExp, Kind]> = [
	// A JavaScript stack frame: `at shout (ssqch.config.js:3:67)`.
	[/\(([^()\s:]+):(\d+):\d+\)/g, "fileLine"],
	// A data file: `invalid JSON in /site/src/_data/site.json: trailing comma at line 1 column 17`.
	[/invalid (?:JSON|YAML|TOML) in (.+?): [^\n]*?\bline (\d+)/g, "fileLine"],
	[/invalid (?:JSON|YAML|TOML) in (.+?): /g, "file"],
	// Front matter: its lines start after the opening fence.
	[/\bin (\S+): invalid (?:JSON|YAML|TOML) front matter: [^\n]*?\bline (\d+)/g, "frontMatterLine"],
	// A permalink or `computed` string: its line isn't a line of the file.
	[/parse error in (\S+) \(/g, "file"],
	// A template, innermost first: `parse error in bad.edge: line 3`, then `page.njk:2:`.
	[/parse error in (\S+): line (\d+)/g, "bodyLine"],
	[/(?:^|[\s:(])([^\s:()]+\.[A-Za-z0-9]+):(\d+): /g, "bodyLine"],
	[/rendering layout (\S+) for /g, "file"],
	[/rendering (\S+) with /g, "file"],
	[/(?:^|\n|- )in (\S+?): /g, "file"],
	// `ssqch.config.js: "ouput" isn't a config option`.
	[/^([^\s:]+\.[A-Za-z0-9]+): /g, "file"],
];

/** The file (and line) a message names, when the file exists. */
function locate(message: string, at: Locator): { file?: string; line?: number } {
	for (const [pattern, kind] of PATTERNS) {
		const all = [...message.matchAll(pattern)];
		if (!all.length) continue;
		// The last match is the innermost file (an include inside a page).
		const found = kind === "bodyLine" ? all[all.length - 1] : all[0];
		const where = at.find(found[1]);
		if (!where) continue;
		const number = found[2] === undefined ? undefined : Number.parseInt(found[2], 10);
		let line: number | undefined;
		if (number !== undefined && Number.isFinite(number)) {
			if (kind === "fileLine") line = number;
			else if (kind === "bodyLine") {
				const before = linesBeforeBody(where.path);
				line = before === undefined ? undefined : before + number;
			} else if (kind === "frontMatterLine") line = number + 1;
		}
		return { file: where.shown, line };
	}
	return {};
}

/** A code for a message that came without one. */
export function codeFor(message: string, fallback: string): string {
	if (message.includes("front matter")) return "front-matter";
	if (message.startsWith("output conflicts")) return "conflict";
	if (message.includes("rendering ") || message.includes("parse error in ") || message.includes("layout `") || message.includes(" loop: ")) return "template";
	if (message.startsWith("invalid JSON in ") || message.startsWith("invalid YAML in ") || message.startsWith("invalid TOML in ") || message.includes("_data/") || message.includes("global data `")) return "data";
	if (message.includes("hook failed") || message.startsWith("beforeBuild") || message.startsWith("afterBuild")) return "hook";
	return fallback;
}

/**
 * A build's error as a list of problems. An error that holds its problems apart gives them; any
 * other is one problem. Each gets the file and line its message names, when it has none and the
 * file exists. `fallback` is the code for a message nothing else fits (`config` for an error
 * from reading the configuration, `build` otherwise).
 */
export function fromError(e: unknown, fallback: string, at: Locator): Diagnostic[] {
	const held = e instanceof Diagnostics || e instanceof BuildError ? e.items : undefined;
	const items: Diagnostic[] = held ? held.map((item) => ({ ...item })) : [error("", messageOf(e))];
	for (const item of items) {
		if (item.code === "") item.code = codeFor(item.message, fallback);
		if (item.file === undefined) {
			const found = locate(item.message, at);
			if (found.file !== undefined) item.file = found.file;
			if (found.line !== undefined) item.line = found.line;
		}
		item.message = fileLines(item.message, at);
	}
	return items;
}

/**
 * `message` with each template line it names counted as the file counts them: template engines
 * count from the end of the front matter, so `page.jinja:2:` is `page.jinja:5:` in a page with
 * three lines of it.
 */
export function fileLines(message: string, at: Locator): string {
	const shift = (name: string, n: string): number | undefined => {
		const where = at.find(name);
		if (!where) return undefined;
		const before = linesBeforeBody(where.path);
		if (!before) return undefined;
		return before + Number.parseInt(n, 10);
	};
	message = message.replace(/(^|[\s:(])([^\s:()]+\.[A-Za-z0-9]+):(\d+): /g, (whole, lead: string, name: string, n: string) => {
		const line = shift(name, n);
		return line === undefined ? whole : `${lead}${name}:${line}: `;
	});
	return message.replace(/(parse error in )(\S+): line (\d+)/g, (whole, lead: string, name: string, n: string) => {
		const line = shift(name, n);
		return line === undefined ? whole : `${lead}${name}: line ${line}`;
	});
}

/**
 * The lines an error points at, for up to three of its problems, each place once:
 *
 *     --> src/index.edge:7
 *      5 | <h1>Guides</h1>
 *      6 | <ul>
 *      7 |   <li>{{ guide.data.name.toUpperCase() }}</li>
 *        |          ^^^^^^^^^^^^^^^
 *      8 | </ul>
 *
 * The line is the file's own (a template engine counts from the end of the front matter). The
 * carets go under the part of the line that the message quotes, when it quotes one; a schema
 * problem points at its field.
 */
export function frames(e: unknown, fallback: string, at: Locator): string | undefined {
	const found: string[] = [];
	for (const problem of fromError(e, fallback, at)) {
		const shown = frame(problem, at);
		// Many pages that include one broken partial fail at the same spot: show it once.
		if (shown !== undefined && !found.includes(shown)) found.push(shown);
		if (found.length === 3) break;
	}
	return found.length ? found.join("\n\n") : undefined;
}

function frame(problem: Diagnostic, at: Locator): string | undefined {
	const WIDEST = 160;
	if (problem.file === undefined) return undefined;
	let source: string;
	try { source = fs.readFileSync(path.resolve(at.root, problem.file), "utf8"); } catch { return undefined; }
	const lines = splitLines(source);
	let number: number | undefined = problem.line;
	if (number === undefined) {
		const key = problem.at ?? problem.field;
		if (key === undefined) return undefined;
		number = fieldLine(lines, key);
		if (number === undefined) return undefined;
	}
	if (number < 1 || number > lines.length) return undefined;
	const untab = (line: string) => line.replaceAll("\t", "    ");
	const text = untab(lines[number - 1]);
	// What the message quotes (`in backticks` or 'in quotes') that's on the line: the longest first.
	const quoted: string[] = [];
	for (const mark of ["`", "'"]) {
		let rest = problem.message;
		for (;;) {
			const start = rest.indexOf(mark);
			if (start === -1) break;
			const end = rest.indexOf(mark, start + 1);
			if (end === -1) break;
			quoted.push(rest.slice(start + 1, end));
			rest = rest.slice(end + 1);
		}
	}
	// Longest first; the sort is stable, so ties keep the order they were found in.
	quoted.sort((a, b) => Buffer.byteLength(b) - Buffer.byteLength(a));
	// The field's own key: the last part of a dotted path (`src` of `hero.src`, on its own line now),
	// then the first, where the nested key wasn't found.
	const parts = (problem.at ?? problem.field)?.split(".").filter((p) => !/^\d+$/.test(p)) ?? [];
	const keys = [...new Set([parts.at(-1), parts[0]].filter((p): p is string => p !== undefined))];
	let under: [number, number] | undefined;
	for (const part of [...keys, ...quoted]) {
		if (Buffer.byteLength(part.trim()) <= 1) continue;
		const at = text.indexOf(part);
		if (at === -1) continue;
		under = [[...text.slice(0, at)].length, [...part].length];
		break;
	}
	const from = Math.max(number - 2, 1);
	const to = Math.min(number + 1, lines.length);
	const width = Math.max(String(to).length, 2);
	let out = `  --> ${problem.file}:${number}`;
	for (let n = from; n <= to; n++) {
		const line = n === number ? text : untab(lines[n - 1]);
		const chars = [...line];
		out += `\n  ${String(n).padStart(width)} | ${chars.slice(0, WIDEST).join("")}${chars.length > WIDEST ? "..." : ""}`.trimEnd();
		if (n === number && under && under[0] + under[1] <= WIDEST) {
			out += `\n  ${"".padStart(width)} | ${" ".repeat(under[0])}${"^".repeat(under[1])}`;
		}
	}
	return out;
}

/** A text's lines, without their endings (`\n` or `\r\n`); a last line ending adds no empty line. */
function splitLines(text: string): string[] {
	const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	if (lines.length && lines[lines.length - 1] === "" && text.endsWith("\n")) lines.pop();
	return lines;
}

/**
 * The line of a file's front matter that sets `field`, from 1: for a dotted path in YAML
 * (`hero.src`), the nested key's line under its parent's, or the deepest one found (The North
 * Fake study, E5: the caret was on `hero:` for a problem in `src:`).
 */
function fieldLine(lines: string[], field: string): number | undefined {
	const [key, ...rest] = field.split(".");
	if (!lines.length) return undefined;
	const fence = lines[0].trimEnd();
	const close = fence === "+++" ? "+++" : fence.startsWith("---") ? "---" : undefined;
	if (close === undefined) return undefined;
	let end = lines.length;
	for (let i = 1; i < lines.length; i++) if (lines[i].trimEnd() === close) { end = i; break; }
	const sets = (line: string, name: string) => {
		const text = line.replace(/^["']+/, "");
		return text.startsWith(name) && /^[:=]/.test(text.slice(name.length).replace(/^["']+/, "").trimStart());
	};
	let found: number | undefined;
	for (let i = 1; i < end; i++) if (sets(lines[i], key)) { found = i; break; }
	if (found === undefined || close !== "---") return found === undefined ? undefined : found + 1;
	// Down through the nested keys, each indented under the one before (a list item's `- ` too).
	const indent = (line: string) => line.length - line.trimStart().length;
	for (const part of rest) {
		if (/^\d+$/.test(part)) continue;
		const parent = indent(lines[found]);
		// Only the parent's own keys, at the indent of its first one: `hero.related.src` isn't
		// `hero.src` (the 2026-11-24 review). A key on a list item's line (`- src:`) counts at the
		// indent after its dash.
		let own: number | undefined;
		let next: number | undefined;
		for (let i = found + 1; i < end; i++) {
			const line = lines[i];
			if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
			const item = /^(\s*)-\s+/.exec(line);
			const at = item ? item[0].length : indent(line);
			if (indent(line) <= parent && !(item && indent(line) === parent)) break;
			own ??= at;
			if (at !== own) continue;
			if (sets(line.slice(at), part)) { next = i; break; }
		}
		if (next === undefined) break;
		found = next;
	}
	return found + 1;
}

/** An error as a person reads it: its message, then the lines it's about (`frames`), when they can be found. */
export function describe(e: unknown, fallback: string, at: Locator): string {
	const message = fileLines(messageOf(e), at);
	const lines = frames(e, fallback, at);
	return lines === undefined ? message : `${message}\n\n${lines}`;
}

/** Print `describe` after a red `label` on standard error. */
export function printError(label: string, e: unknown, fallback: string, at: Locator): void {
	process.stderr.write(`${red(label)} ${describe(e, fallback, at)}\n`);
}
