// Content schemas: what each kind of page's data has to look like.
//
//   schemas: {
//     posts: {                          // pages tagged `posts`
//       fields: {
//         title: "string",
//         date: "date",
//         description: "string?",       // optional
//         status: "'draft' | 'published'",
//         topics: "string[]",
//         hero: { src: "file", alt: "string" },
//         "author?": { name: "string", url: "string?" },
//         slug: (value) => /^[a-z0-9-]+$/.test(value) || "must be lowercase letters, digits and dashes",
//       },
//       unknown: "error",               // front matter keys that aren't fields
//     },
//     docs: { files: "docs/**/*.md", fields: { title: "string", order: "integer?" } },
//   }
//
// A schema applies to the pages with the tag it's named after (the pages in that collection;
// `all` is every page in collections), or to the files its `files` globs match. Every build
// checks each page's data (after the data cascade and `computed`), and reports every problem
// together, naming the file and the field. Ported from 0.7's `schema.rs`, messages and all.
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Data } from "./data.ts";
import { shownAsUtc, toDate } from "./data.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { BuildError, Diagnostics, bail, error, isCapturing, warn, warning } from "./diagnostics.ts";
import * as equivalents from "./equivalents.ts";
import { globProblem, globToRegExp } from "./glob.ts";
import { describeThrown } from "./modules.ts";
import { charCount, firstChars, jsString, quoted, quotedChar } from "./quote.ts";
import type { Site } from "./site.ts";
import { closest } from "./suggest.ts";

/** What to do about front matter keys that aren't one of the schema's fields. */
export type Unknown = "allow" | "warn" | "error";

export type Type =
	| { kind: "any" | "string" | "number" | "integer" | "boolean" | "date" | "object" | "array" }
	/** A path to a file that exists: from the input folder with a leading `/`, otherwise next to the page. */
	| { kind: "file" }
	| { kind: "literal"; value: string | number | boolean | null }
	| { kind: "union"; types: Type[] }
	| { kind: "list"; item: Type }
	| { kind: "fields"; fields: Field[] }
	/** A function of (value, page data): `true` (or nothing) passes, a string is what's wrong, `false` is a plain "isn't valid". */
	| { kind: "check"; fn: (value: unknown, page: Data) => unknown };

export interface Field {
	name: string;
	optional: boolean;
	type: Type;
}

export interface Schema {
	name: string;
	/** The `files` globs, or none: the pages tagged with the schema's name. */
	files: RegExp[] | undefined;
	/** The `files` globs as written, for a message. */
	globs?: string[];
	fields: Field[];
	unknown: Unknown;
}

/** Something wrong with one page's data. */
export interface Problem {
	/** The field's path, like `hero.alt` or `topics[2]`. */
	field: string;
	message: string;
	/** From `unknown: "warn"`: reported, but the build goes on. */
	warning: boolean;
	/** The front matter key the code frame points at, when it isn't `field` (a misspelling). */
	at?: string;
}

/** Where a page is, for `file` fields. */
export interface PageFiles {
	input: string;
	/** The folder the page's file is in. */
	pageDir: string;
}

/** Front matter keys ssqch and its plugins read, which `unknown` never flags. Another generator's word for one (`eleventyComputed`) is that key. */
const BUILT_IN_KEYS = ["layout", "permalink", "dynamicPermalink", "tags", "date", "pagination", "computed", "render", "draft", "aliases", "excludeFromCollections", "sitemap", "nav", "title", "description", "lang"];

// ---- parsing ---------------------------------------------------------------------------------

const TYPE_NAMES = "string, number, integer, boolean, date, file, object, array, any";

/** A number as Rust's `str::parse::<f64>` reads one (`1`, `-2.5`, `1e3`, `.5`, `inf`, `NaN`). */
function parseNumber(word: string): number | undefined {
	if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(word)) return Number(word);
	const m = /^([+-]?)(inf|infinity|nan)$/i.exec(word);
	if (!m) return undefined;
	if (m[2].toLowerCase() === "nan") return NaN;
	return m[1] === "-" ? -Infinity : Infinity;
}

class TypeParser {
	src: string;
	pos = 0;
	constructor(src: string) {
		this.src = src;
	}
	rest(): string {
		return this.src.slice(this.pos);
	}
	skipSpaces(): void {
		const rest = this.rest();
		this.pos += rest.length - rest.trimStart().length;
	}
	eat(token: string): boolean {
		this.skipSpaces();
		if (this.rest().startsWith(token)) {
			this.pos += token.length;
			return true;
		}
		return false;
	}
	union(): Type {
		const types = [this.postfix()];
		while (this.eat("|")) types.push(this.postfix());
		return types.length === 1 ? types[0] : { kind: "union", types };
	}
	postfix(): Type {
		let type = this.primary();
		while (this.eat("[]")) type = { kind: "list", item: type };
		return type;
	}
	primary(): Type {
		this.skipSpaces();
		const rest = this.rest();
		const first = rest.codePointAt(0) === undefined ? undefined : String.fromCodePoint(rest.codePointAt(0)!);
		if (first === undefined) bail(`a type is missing (types: ${TYPE_NAMES})`);
		if (first === "(") {
			this.pos += 1;
			const type = this.union();
			if (!this.eat(")")) bail("a `(` has no `)`");
			return type;
		}
		if (first === "'" || first === "\"") {
			const end = rest.indexOf(first, 1);
			if (end === -1) bail(`a quoted value has no closing ${first}`);
			this.pos += end + 1;
			return { kind: "literal", value: rest.slice(1, end) };
		}
		const word = /^[A-Za-z0-9._-]*/.exec(rest)![0];
		this.pos += word.length;
		switch (word) {
			case "string": case "number": case "integer": case "boolean": case "date": case "file": case "object": case "array": case "any":
				return { kind: word };
			case "true": return { kind: "literal", value: true };
			case "false": return { kind: "literal", value: false };
			case "null": return { kind: "literal", value: null };
			case "": return bail(`unexpected ${quotedChar(first)} (types: ${TYPE_NAMES})`);
		}
		const n = parseNumber(word);
		if (n === undefined) bail(`unknown type ${quoted(word)} (types: ${TYPE_NAMES}; quote a literal value, like "'draft' | 'published'")`);
		return { kind: "literal", value: n };
	}
}

/** A type written as a string: `string`, `string?`, `string[]`, `'draft' | 'published'`, `(string | number)[]`. With whether it ended in `?` (optional). */
export function parseType(src: string): [Type, boolean] {
	const trimmed = src.trim();
	const optional = trimmed.endsWith("?");
	const parser = new TypeParser(optional ? trimmed.slice(0, -1) : trimmed);
	const type = parser.union();
	parser.skipSpaces();
	if (parser.rest() !== "") bail(`unexpected ${quoted(parser.rest())} in type ${quoted(src)}`);
	return [type, optional];
}

/** What a value is, in the words 0.7's messages used (JavaScript's `typeof`, where a date and a list are objects). */
const typeOf = (v: unknown) => (v === null ? "object" : typeof v);

/** A list, a date and a function aren't objects here; anything else that's an object is. */
const isObject = (v: unknown): v is Data => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

function parseFields(spec: unknown, at: string): Field[] {
	if (!isObject(spec)) bail(`${at} must be an object of { field: type }, not ${typeOf(spec)}`);
	const fields: Field[] = [];
	for (const [key, value] of Object.entries(spec)) {
		const name = key.endsWith("?") ? key.slice(0, -1) : key;
		const [type, optional] = parseFieldType(value, `${at}.${name}`);
		fields.push({ name, optional: optional || key.endsWith("?"), type });
	}
	return fields;
}

function parseFieldType(value: unknown, at: string): [Type, boolean] {
	if (typeof value === "string") {
		try { return parseType(value); } catch (e) { throw new BuildError(`${at}: ${(e as Error).message}`); }
	}
	if (typeof value === "function") return [{ kind: "check", fn: value as (value: unknown, page: Data) => unknown }, false];
	if (Array.isArray(value)) {
		if (value.length !== 1) bail(`${at}: a list type has one item, the type of each entry, like ["string"] or [{ name: "string" }]`);
		return [{ kind: "list", item: parseFieldType(value[0], `${at}[]`)[0] }, false];
	}
	if (isObject(value)) return [{ kind: "fields", fields: parseFields(value, at) }, false];
	return bail(`${at} must be a type ("string"), an object of fields, a one-item list, or a function, not ${typeOf(value)}`);
}

/** A schema from its config value: `{ fields, files, unknown }`. */
export function parseSchema(name: string, spec: unknown): Schema {
	const at = `schemas.${name}`;
	if (!isObject(spec)) bail(`${at} must be an object with \`fields\`, not ${typeOf(spec)}`);
	const extra = Object.keys(spec).find((k) => !["fields", "files", "unknown"].includes(k));
	if (extra !== undefined) bail(`${at}: "${extra}" isn't an option (options: fields, files, unknown); a schema's fields go in \`fields\``);
	if (!("fields" in spec) || spec.fields === undefined) bail(`${at} needs \`fields\`: { title: "string", date: "date" }`);
	const fields = parseFields(spec.fields, `${at}.fields`);
	let files: RegExp[] | undefined;
	let written: string[] | undefined;
	const given = spec.files;
	if (given !== undefined && given !== null) {
		let globs: string[];
		if (typeof given === "string") globs = [given];
		else if (Array.isArray(given)) globs = given.map((g) => (typeof g === "string" ? g : bail(`${at}.files must be a glob or a list of globs`)));
		else bail(`${at}.files must be a glob or a list of globs, not ${typeOf(given)}`);
		written = globs;
		files = globs.map((g) => {
			const glob = g.replace(/^(\.\/)+/, "");
			const problem = globProblem(glob);
			if (problem !== undefined) bail(`${at}.files: invalid glob ${quoted(g)}: error parsing glob '${glob}': ${problem}`);
			return globToRegExp(glob);
		});
	}
	let unknown: Unknown = "allow";
	if (spec.unknown !== undefined && spec.unknown !== null) {
		const word = jsString(spec.unknown);
		if (word !== "allow" && word !== "warn" && word !== "error") bail(`${at}.unknown must be "allow", "warn" or "error", not ${quoted(word)}`);
		unknown = word;
	}
	return { name, files, ...(written ? { globs: written } : {}), fields, unknown };
}

/** The site's schemas as TypeScript object types, for `ssqch types`: each name, and its type as 0.7's `Schema::typescript` wrote it (fields three tabs in). */
export function schemaTypes(config: Config): Array<[name: string, typescript: string]> {
	return config.schemas.map((schema) => [schema.name, objectTs(schema.fields, 2)]);
}

// ---- checking --------------------------------------------------------------------------------

/** Whether `schema` covers a page: `rel` is its file's path from the input folder, `tags` its tags (empty when it's kept out of collections). */
export function covers(schema: Schema, rel: string, tags: string[], inCollections: boolean): boolean {
	if (schema.files) return schema.files.some((re) => re.test(rel));
	return inCollections && (schema.name === "all" || tags.includes(schema.name));
}

/** A page's data checked against `schema`. `frontKeys` are the keys in the page's own front matter, for `unknown`. */
export async function check(schema: Schema, data: Data, frontKeys: string[], files: PageFiles, root: string): Promise<Problem[]> {
	const found: Found[] = [];
	checkFields(schema.fields, data, "", { page: data, files, root }, found);
	// Only a check that returns a promise is waited for, and the problems stay in the fields' order.
	const problems = found.some((p) => p instanceof Promise) ? (await Promise.all(found)).filter((p) => p !== undefined) : found as Problem[];
	// A misspelled field is two problems, and the one to read came second: `location` is
	// required, then `loaction` isn't a field (Squatch Snacks, E6). It's one: the required field,
	// and the key in the page that's nearly it.
	const misspelt = new Set<string>();
	for (const [i, problem] of problems.entries()) {
		if (!problem.message.startsWith(`\`${problem.field}\` is required`) || problem.field.includes(".")) continue;
		const typo = frontKeys.find((key) => !schema.fields.some((f) => f.name === key) && closest(key, [problem.field]) === problem.field);
		if (typo === undefined) continue;
		misspelt.add(typo);
		problems[i] = { ...problem, message: `${problem.message}, and the page has \`${typo}\`: did you mean \`${problem.field}\`?`, at: typo };
	}
	if (schema.unknown !== "allow") {
		for (const key of frontKeys) {
			if (misspelt.has(key)) continue;
			const row = equivalents.find(key, "frontMatter");
			const readAs = row?.alias ? row.ssqch : key;
			if (schema.fields.some((f) => f.name === key || f.name === readAs) || BUILT_IN_KEYS.includes(readAs)) continue;
			const near = closest(key, schema.fields.map((f) => f.name));
			problems.push({ field: key, message: `\`${key}\` isn't a field of this schema${near === undefined ? "" : ` (did you mean \`${near}\`?)`}`, warning: schema.unknown === "warn" });
		}
	}
	return problems;
}

/** A problem, or what an async check will say (nothing when it passes). */
type Found = Problem | Promise<Problem | undefined>;

interface Checking {
	page: Data;
	files: PageFiles;
	root: string;
}

function checkFields(fields: Field[], data: Data, prefix: string, at: Checking, out: Found[]): void {
	for (const field of fields) {
		const fieldPath = prefix === "" ? field.name : `${prefix}.${field.name}`;
		const value = Object.prototype.hasOwnProperty.call(data, field.name) ? data[field.name] : undefined;
		if (field.type.kind === "check") {
			checkValue(field.type, value, fieldPath, at, out);
			continue;
		}
		if (value === undefined || value === null) {
			const nullOk = value === null && acceptsNull(field.type);
			if (!field.optional && !nullOk) out.push({ field: fieldPath, message: `\`${fieldPath}\` is required (${describe(field.type)})`, warning: false });
			continue;
		}
		checkValue(field.type, value, fieldPath, at, out);
	}
}

function acceptsNull(type: Type): boolean {
	if (type.kind === "any") return true;
	if (type.kind === "literal") return type.value === null;
	if (type.kind === "union") return type.types.some(acceptsNull);
	return false;
}

/** Whether `value` is of `type`, without the details (for unions, whose types are written as text, so never a function). */
function matches(type: Type, value: unknown, at: Checking): boolean {
	const found: Found[] = [];
	checkValue(type, value, "", at, found);
	return found.length === 0;
}

function checkValue(type: Type, value: unknown, fieldPath: string, at: Checking, out: Found[]): void {
	const problem = (message: string): Problem => ({ field: fieldPath, message, warning: false });
	const wrong = (message: string) => { out.push(problem(message)); };
	const mismatch = () => wrong(`\`${fieldPath}\` must be ${describe(type)}, not ${show(value)}`);
	switch (type.kind) {
		case "any": return;
		case "string": if (typeof value !== "string") mismatch(); return;
		case "number": if (typeof value !== "number" || Number.isNaN(value)) mismatch(); return;
		case "integer": if (!Number.isInteger(value)) mismatch(); return;
		case "boolean": if (typeof value !== "boolean") mismatch(); return;
		case "date": {
			const ok = value instanceof Date || (typeof value === "string" && toDate(value) !== undefined);
			if (!ok) mismatch();
			return;
		}
		case "file": {
			if (typeof value !== "string" || value.trim() === "") return mismatch();
			const clean = value.split(/[?#]/)[0];
			const fromRoot = clean.startsWith("/");
			const file = fromRoot ? path.join(at.files.input, clean.slice(1)) : path.join(at.files.pageDir, clean);
			if (!(fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false)) wrong(`\`${fieldPath}\` is ${quoted(value)}, but there's no such file ${fromRoot ? "in the input folder" : "next to the page"} (${lookedFor(file, clean, at.root)})`);
			return;
		}
		case "object": if (!isObject(value)) mismatch(); return;
		case "array": if (!Array.isArray(value)) mismatch(); return;
		case "literal": if (type.value !== value) mismatch(); return;
		case "union": {
			if (!type.types.some((t) => matches(t, value, at))) mismatch();
			return;
		}
		case "list": {
			if (!Array.isArray(value)) return mismatch();
			for (let i = 0; i < value.length; i++) checkValue(type.item, value[i], `${fieldPath}[${i}]`, at, out);
			return;
		}
		case "fields": {
			if (!isObject(value)) return mismatch();
			return checkFields(type.fields, value, fieldPath, at, out);
		}
		case "check": {
			const failed = (e: unknown) => problem(`\`${fieldPath}\`: the check failed: ${describeThrown(e, at.root)}`);
			const judge = (answer: unknown): Problem | undefined => {
				if (answer === true || answer === undefined || answer === null) return undefined;
				if (typeof answer === "string") return problem(`\`${fieldPath}\`${PREDICATE.test(answer) ? " " : ": "}${answer}`);
				if (answer === false) return problem(`\`${fieldPath}\` isn't valid (${show(value)})`);
				return problem(`\`${fieldPath}\`: the check returned ${typeOf(answer)}; return true, false or a message`);
			};
			let answer: unknown;
			try {
				answer = type.fn(value, at.page);
			} catch (e) {
				out.push(failed(e));
				return;
			}
			// A check may be async, as in 0.7: its answer is waited for.
			if (answer instanceof Promise) out.push(answer.then(judge, failed));
			else {
				const found = judge(answer);
				if (found) out.push(found);
			}
			return;
		}
	}
}

/**
 * Where a `file` field was looked for, from the project, and the nearest name in that folder as
 * the field would write it (Squatch Snacks, E5: "no such file" alone sent the agent looking).
 */
function lookedFor(file: string, written: string, root: string): string {
	const at = `looked for ${path.relative(root, file).split(path.sep).join("/")}`;
	let names: string[];
	try { names = fs.readdirSync(path.dirname(file), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { return at; }
	const near = closest(path.basename(file), names);
	return near === undefined ? at : `${at}; did you mean ${quoted(written.slice(0, written.lastIndexOf("/") + 1) + near)}?`;
}

/**
 * A rule's answer that goes on from the field (`must be lowercase`, `isn't a trail`) follows it
 * with a space; anything else (`write the opening's own summary`, from Squatch Snacks, E3) after
 * a colon, so the two don't read as one sentence.
 */
const PREDICATE = /^(?:must|should|is|isn't|is not|are|aren't|needs?|has|hasn't|have|can|can't|cannot|may|will|won't|was|wasn't|does|doesn't|contains?|starts?|ends?|looks?|matches?|goes|comes|repeats?)\b/i;

/** A type in words, for "must be ...". */
function describe(type: Type): string {
	switch (type.kind) {
		case "any": return "set";
		case "string": return "a string";
		case "number": return "a number";
		case "integer": return "a whole number";
		case "boolean": return "true or false";
		case "date": return "a date, like 2026-03-14";
		case "file": return "a path to a file";
		case "object": return "an object";
		case "array": return "a list";
		case "literal": return show(type.value);
		case "union": {
			const parts = type.types.map(describe);
			return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : parts.join("");
		}
		case "list": {
			const item = type.item.kind;
			if (item === "string") return "a list of strings";
			if (item === "number" || item === "integer") return "a list of numbers";
			if (item === "fields" || item === "object") return "a list of objects";
			return "a list";
		}
		case "fields": return "an object";
		case "check": return "valid";
	}
}

/** A value, short enough for an error message. */
function show(value: unknown): string {
	if (value === undefined) return "missing";
	if (value === null) return "null";
	if (typeof value === "string") return `${quoted(firstChars(value, 60))}${charCount(value) > 60 ? "..." : ""}`;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value instanceof Date) return `the date ${Number.isNaN(value.getTime()) ? "Invalid Date" : shownAsUtc(value).toISOString().slice(0, 10)}`;
	if (Array.isArray(value)) return "a list";
	if (typeof value === "function") return "a function";
	return "an object";
}

// ---- TypeScript ------------------------------------------------------------------------------

function keyTs(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quoted(name);
}

function objectTs(fields: Field[], depth: number): string {
	if (!fields.length) return "{}";
	const indent = "\t".repeat(depth + 1);
	let out = "{\n";
	for (const f of fields) out += `${indent}${keyTs(f.name)}${f.optional ? "?" : ""}: ${typeTs(f.type, depth + 1)};\n`;
	return `${out}${"\t".repeat(depth)}}`;
}

function typeTs(type: Type, depth: number): string {
	switch (type.kind) {
		case "any": case "check": return "any";
		case "string": case "file": return "string";
		case "number": case "integer": return "number";
		case "boolean": return "boolean";
		case "date": return "Date | string";
		case "object": return "Record<string, any>";
		case "array": return "any[]";
		case "literal": return typeof type.value === "string" ? quoted(type.value) : String(type.value);
		case "union": return type.types.map((t) => typeTs(t, depth)).join(" | ");
		case "list": return type.item.kind === "union" || type.item.kind === "date" ? `(${typeTs(type.item, depth)})[]` : `${typeTs(type.item, depth)}[]`;
		case "fields": return objectTs(type.fields, depth);
	}
}

// ---- the build's check -----------------------------------------------------------------------

/**
 * Every page's data checked against the schemas that cover it. Warnings are reported as they're
 * found; errors fail the build, listed together (the first 30, or all with `--verbose`). A
 * template that makes many pages reports each problem once.
 */
/**
 * Which of a paginated template's pages a problem is on: ` (item 4 of snacks, "Ridge Runner
 * Jerky")`, named by the item's `title`, `name` or `slug` when it has one, or ` (page 2 of
 * posts)` for a page of several. Empty for a page that isn't paginated. Six errors that all said
 * `src/snack.jinja` sent Squatch Snacks to rule functions on made-up fields to find the item (E1).
 */
export function paginated(data: Data): string {
	const p = data.pagination;
	if (!isObject(p) || typeof p.pageNumber !== "number" || typeof p.data !== "string") return "";
	const items = Array.isArray(p.items) ? p.items : [];
	const one = items.length === 1 && Number(p.size ?? 1) === 1;
	if (!one) return ` (page ${p.pageNumber + 1} of ${p.data})`;
	const item = items[0];
	const label = isObject(item) ? [item.title, item.name, item.slug].find((v) => typeof v === "string" && v.trim() !== "") : typeof item === "string" || typeof item === "number" ? item : undefined;
	return ` (item ${p.pageNumber + 1} of ${p.data}${label === undefined ? "" : `, ${JSON.stringify(String(label))}`})`;
}

/**
 * A note when the site's `ssqch.d.ts` doesn't have its schemas as they are now: an editor then
 * offers last week's fields, and nothing said to run `ssqch types` (the Squatch Snacks rerun found
 * it on the tour). Only for a site that has the file, and not while serving or for `--format json`.
 */
function noteStaleTypes(config: Config, root: string): void {
	if (config.serving || config.quiet || isCapturing() || !config.schemas.length) return;
	let text: string;
	try { text = fs.readFileSync(path.join(root, "ssqch.d.ts"), "utf8"); } catch { return; }
	const stale = schemaTypes(config).filter(([name, ts]) => !text.includes(`${/^[A-Za-z0-9_]+$/.test(name) && !/^\d/.test(name) ? name : JSON.stringify(name)}: ${ts};`)).map(([name]) => name);
	if (stale.length) process.stderr.write(`note: ssqch.d.ts doesn't have ${stale.length === 1 ? "the schema" : "the schemas"} ${stale.map((n) => `\`${n}\``).join(", ")} as the config has ${stale.length === 1 ? "it" : "them"}, so an editor shows old fields: run ssqch types\n`);
}

export async function checkPages(site: Site): Promise<void> {
	const { config, dirs } = site;
	noteStaleTypes(config, dirs.root);
	// Front matter dates that aren't dates come first, with the schemas' errors on the same pages.
	const errors: Diagnostic[] = [...site.badDates];
	if (!config.schemas.length && !errors.length) return;
	const groups = new Map<string, { file: string; problem: Problem; schema: string; items: string[] }>();
	// A paginated template puts only its first page in its tags' collections, but a schema keyed
	// by a tag checks every page it makes: Squatch Snacks' schema on `tags: snack` checked one
	// snack of six, and said nothing of the rest (the rerun, 2026-11-23).
	const collected = new Set(site.pages.filter((p) => p.inCollections).map((p) => p.tpl));
	const matched = new Set<Schema>();
	for (const page of site.pages) {
		const tags = Array.isArray(page.data.tags) ? page.data.tags.filter((t: unknown): t is string => typeof t === "string") : [];
		const files: PageFiles = { input: dirs.input, pageDir: path.dirname(page.tpl.input) };
		const file = site.display(page.tpl.input);
		for (const schema of config.schemas) {
			if (!covers(schema, page.tpl.rel, tags, page.inCollections || collected.has(page.tpl))) continue;
			matched.add(schema);
			for (const problem of await check(schema, page.data, page.tpl.frontKeys, files, dirs.root)) {
				const key = `${file}\0${problem.message}\0${schema.name}`;
				const group = groups.get(key);
				if (group) group.items.push(paginated(page.data));
				else groups.set(key, { file, problem, schema: schema.name, items: [paginated(page.data)] });
			}
		}
	}
	// The same problem on several pages of one template is one line, which names the first page
	// and how many more: now that every page of a paginated template is checked, a problem in the
	// template's own front matter would otherwise be a line for each of them.
	for (const { file, problem, schema, items } of groups.values()) {
		const pages = [...new Set(items)];
		const more = pages.slice(1);
		const others = more.length ? ` (and ${more.length} more ${more.length === 1 ? "page" : "pages"} of it with the same problem: ${more.slice(0, 3).map((label) => label.slice(2, -1)).join("; ")}${more.length > 3 ? "; ..." : ""})` : "";
		const message = `${file.replace(/^(\.\/)+/, "")}${pages[0]}: ${problem.message} (schema \`${schema}\`)${others}`;
		const found = (problem.warning ? warning : error)("schema", message, { file, field: problem.field, ...(problem.at === undefined ? {} : { at: problem.at }) });
		if (problem.warning) warn(found);
		else errors.push(found);
	}
	// A schema for files that match no page checks nothing, and a build that passes says nothing
	// of it: after a folder moved, Squatch Snacks' validation was off without a word (the rerun).
	// A tag's schema with no pages is a collection that's empty for now, so it's left alone.
	for (const schema of config.schemas) {
		if (schema.globs && !matched.has(schema)) warn(warning("schema", `schema \`${schema.name}\` matches no pages (files: ${schema.globs.map((g) => JSON.stringify(g)).join(", ")}), so nothing is checked; a page that moved needs its new path here`));
	}
	if (!errors.length) return;
	const shown = config.verbose ? errors.length : 30;
	const more = errors.length > shown ? `\n  ... and ${errors.length - shown} more (--verbose lists them all)` : "";
	const listed = errors.slice(0, shown).map((d) => d.message);
	throw new Diagnostics(`${errors.length} content ${errors.length === 1 ? "error" : "errors"}:\n  - ${listed.join("\n  - ")}${more}`, errors);
}
