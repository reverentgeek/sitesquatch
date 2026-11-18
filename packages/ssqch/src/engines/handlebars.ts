// Handlebars and Mustache, for `.hbs`, `.handlebars` and `.mustache`: handlebars.js itself, which
// reads Mustache's tags too. What's ssqch's is around it, as 0.7 had it (the handlebars crate,
// `plugins/handlebars`): every file in the includes folders as a partial, the config's functions
// as helpers (awaited when they're async), the crate's built-in helpers (`len`, `eq` and the other
// comparisons), Mustache's sections, values printed as 0.7 printed them, and errors that name the
// file and the line.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type HandlebarsLib from "handlebars";
import type { Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { isPlainObject } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
import { describeThrown, shownPath, watchSettle } from "../modules.ts";
import { closest, closestPath } from "../suggest.ts";
import { lazyEngine } from "./engine.ts";
import type { EngineEnv, RenderContext, TemplateEngine } from "./engine.ts";

/** The extensions that are Handlebars: a partial with one that doesn't parse is an error, and other files that don't are skipped. */
const EXTENSIONS = ["hbs", "handlebars", "mustache"];

/** The helpers every template has: handlebars.js' own and the handlebars crate's, which 0.7 had. */
const BUILTIN_HELPERS = ["if", "unless", "each", "with", "lookup", "log", "raw", "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not", "len"];

/** Where in a template something happened, from handlebars.js' `options.loc`. */
interface Loc { start: { line: number; column: number } }
interface HelperOptions { name: string; hash: Data; loc?: Loc; ids?: unknown[]; fn: (context: unknown, options?: unknown) => string; inverse: (context: unknown, options?: unknown) => string }

/** An error that already says where it happened: the template's line, and the partial's file when it was in one. */
class Located extends Error {
	line?: number;
	file?: string;
	constructor(message: string, line?: number, file?: string) {
		super(message);
		this.line = line;
		this.file = file;
	}
}

// How `{{ }}` and `{{{ }}}` print a value: as 0.7 did, which printed the page's data as JSON
// (a date as ISO 8601, a list as `[a, b, c]`, an object as `[object]`), not in the machine's
// time zone. `{{{ }}}` goes through it too (see `useCompiler`), with `raw` set.
let library: typeof HandlebarsLib | undefined;

/** handlebars.js, loaded with the first Handlebars template (`require`, since rendering is synchronous). */
function handlebarsLib(): typeof HandlebarsLib {
	if (library) return library;
	library = createRequire(import.meta.url)("handlebars") as typeof HandlebarsLib;
	const utils = library.Utils as unknown as { escapeExpression(value: unknown, raw?: boolean): string; ssqch?: boolean };
	if (!utils.ssqch) {
		const escape = utils.escapeExpression;
		utils.escapeExpression = (value, raw) => {
			const shown = printable(value);
			if (!raw) return escape(shown);
			return shown === undefined || shown === null ? "" : typeof shown === "object" && typeof (shown as any).toHTML === "function" ? (shown as any).toHTML() : String(shown);
		};
		utils.ssqch = true;
	}
	return library;
}

function printable(value: unknown): unknown {
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
	if (typeof value === "number") return jsonNumber(value);
	if (Array.isArray(value)) return `[${value.map((item) => { const s = printable(item); return s === undefined || s === null ? "" : String(s); }).join(", ")}]`;
	if (isPlainObject(value)) return "[object]";
	return value;
}

/**
 * A number as 0.7 printed it, from JSON: a whole number below 9e15 as it is, anything else the
 * shortest way that reads back (as JavaScript finds it), laid out as Rust's `ryu` lays it out
 * (`1e-6`, `1.2345678901234567e+19`, `0.00001`).
 */
function jsonNumber(n: number): string | null {
	if (!Number.isFinite(n)) return null;
	if (Number.isInteger(n) && Math.abs(n) < 9e15) return String(n);
	const [mantissa, exponent] = n.toExponential().split("e");
	const digits = mantissa.replace("-", "").replace(".", "");
	const sign = n < 0 ? "-" : "";
	const point = Number(exponent) + 1;
	if (digits.length <= point && point <= 16) return `${sign}${digits}${"0".repeat(point - digits.length)}.0`;
	if (point > 0 && point <= 16) return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
	if (point > -5 && point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
	const e = point - 1;
	return `${sign}${digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`}e${e < 0 ? "-" : "+"}${Math.abs(e)}`;
}

/** handlebars.js' compiler, with `{{{ }}}` printing through `printable` as `{{ }}` does. */
function useCompiler(hb: typeof HandlebarsLib): void {
	const Base = (hb as any).JavaScriptCompiler;
	function Compiler(this: unknown, ...args: unknown[]) { Base.apply(this, args); }
	Compiler.prototype = Object.create(Base.prototype);
	Compiler.prototype.compiler = Compiler;
	Compiler.prototype.append = function (this: any) {
		this.pushSource(this.appendToBuffer([this.aliasable("container.escapeExpression"), "(", this.popStack(), ", true)"]));
	};
	(hb as any).JavaScriptCompiler = Compiler;
}

/** Truth as the handlebars crate tells it: `0`, `""`, `[]` and `{}` are false. */
function truthy(v: unknown): boolean {
	if (v === null || v === undefined || v === false) return false;
	if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
	if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
	if (isPlainObject(v)) return Object.keys(v).length > 0;
	return true;
}

/** Equality as JSON sees it (`[5]` is `[5]`; `5` isn't `"5"`). */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : false;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((k) => k in b && same(a[k], b[k]));
	}
	return false;
}

/** Order as the handlebars crate gives it: numbers, strings, booleans, and a number against a string that is one. */
function compare(a: unknown, b: unknown): number | undefined {
	const asNumber = (s: string) => (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s) ? Number(s) : undefined);
	if (typeof a === "string" && typeof b === "number") { const n = asNumber(a); return n === undefined ? undefined : Math.sign(n - b); }
	if (typeof a === "number" && typeof b === "string") { const n = asNumber(b); return n === undefined ? undefined : Math.sign(a - n); }
	if (typeof a === "number" && typeof b === "number") return Number.isNaN(a - b) ? undefined : Math.sign(a - b);
	if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
	if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
	return undefined;
}

export function handlebarsEngine(env: EngineEnv): TemplateEngine {
	return lazyEngine(() => makeHandlebars(env));
}

/** A value as a helper gets it, as 0.7 gave it after turning the data into JSON: a date as ISO 8601 text, a missing value as `null`. */
const given = (v: unknown) => (v === undefined ? null : v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString()) : v);

function makeHandlebars(env: EngineEnv): TemplateEngine {
	const root = env.config.root;
	const hb = handlebarsLib().create();
	useCompiler(hb);
	// `{{log}}` says nothing, as in 0.7.
	(hb as any).logger.level = "error";
	const loaded = new Set<string>();
	// With `strict`, helpers learn their arguments' names (`ids`), to say which one isn't there.
	const compileOptions = { strict: env.strict, trackIds: env.strict };
	const runtimeOptions = { allowProtoPropertiesByDefault: true };

	// A helper that answers with a promise is awaited: the rendering stops there, and once the
	// promise settles the template renders again, every call before it answered as it was the
	// first time, so each helper runs once a page. Templates whose helpers all answer at once
	// render once, synchronously.
	let answers: Answers | undefined;
	/** The partials being rendered, innermost last: an error in a helper names the one it's in. */
	const inside: string[] = [];
	const at = (options: HelperOptions) => options.loc?.start.line;
	/** A value that isn't there while `strict` is on, named as the template names it (0.7 refused it too). */
	const missing = (options: HelperOptions, index: number) => new Located(`\`${typeof options.ids?.[index] === "string" ? options.ids[index] : `${options.name}'s argument ${index + 1}`}\` is undefined (strict is on)`, at(options), inside.at(-1));

	// The handlebars crate's helpers, which 0.7 had: comparisons (as blocks too), `len` and `raw`.
	// They see a date as its ISO 8601 text, as 0.7's did, and need their arguments.
	const boolean = (name: string, arity: number | undefined, test: (args: unknown[]) => boolean) => {
		hb.registerHelper(name, function (this: unknown, ...args: unknown[]) {
			const options = args.pop() as HelperOptions;
			if (arity !== undefined) {
				if (args.length < arity) throw new Located(`\`${name}\` needs ${arity === 1 ? "an argument" : `${arity} arguments`}`, at(options), inside.at(-1));
				if (env.strict) for (let i = 0; i < arity; i++) if (args[i] === undefined) throw missing(options, i);
			}
			const value = test(args.map(given));
			if (options.fn === undefined) return value;
			return value ? options.fn(this) : options.inverse(this);
		});
	};
	boolean("eq", 2, ([a, b]) => same(a, b));
	boolean("ne", 2, ([a, b]) => !same(a, b));
	boolean("gt", 2, ([a, b]) => compare(a, b) === 1);
	boolean("gte", 2, ([a, b]) => { const c = compare(a, b); return c !== undefined && c !== -1; });
	boolean("lt", 2, ([a, b]) => compare(a, b) === -1);
	boolean("lte", 2, ([a, b]) => { const c = compare(a, b); return c !== undefined && c !== 1; });
	boolean("and", undefined, (args) => args.every(truthy));
	boolean("or", undefined, (args) => args.some(truthy));
	boolean("not", 1, ([a]) => !truthy(a));
	// `if` and `unless` tell truth as the crate does, so `{{#if settings}}` is false for `{}` as in 0.7.
	for (const [name, wanted] of [["if", true], ["unless", false]] as const) {
		hb.registerHelper(name, function (this: unknown, ...args: unknown[]) {
			const options = args.pop() as HelperOptions;
			if (args.length !== 1) throw new Located(`#${name} requires exactly one argument`, at(options), inside.at(-1));
			let value = args[0];
			if (typeof value === "function") value = value.call(this);
			const truth = (options.hash?.includeZero && value === 0) || truthy(value);
			return truth === wanted ? options.fn(this) : options.inverse(this);
		});
	}
	hb.registerHelper("len", function (this: unknown, ...args: unknown[]) {
		const options = args.pop() as HelperOptions;
		if (!args.length) throw new Located("`len` needs an argument", at(options), inside.at(-1));
		if (env.strict && args[0] === undefined) throw missing(options, 0);
		const value = given(args[0]);
		return Array.isArray(value) ? value.length : typeof value === "string" ? Buffer.byteLength(value) : isPlainObject(value) ? Object.keys(value).length : 0;
	});
	// The crate's raw block leaves out the space it starts with.
	hb.registerHelper("raw", (options: HelperOptions) => options.fn(undefined).replace(/^\s+/, ""));
	// `each`, `with` and `lookup` as the crate had them: they need their argument, a list has no
	// `@key`, and with `strict` on a value that isn't there is an error.
	const builtin = { each: hb.helpers.each, with: hb.helpers.with, lookup: hb.helpers.lookup } as Record<string, (...args: unknown[]) => unknown>;
	hb.registerHelper("each", function (this: unknown, ...args: unknown[]) {
		let options = args[args.length - 1] as HelperOptions;
		if (args.length < 2) throw new Located("Must pass iterator to #each", at(options), inside.at(-1));
		if (env.strict && args[0] === undefined) throw missing(options, 0);
		if (Array.isArray(args[0])) {
			const fn = options.fn;
			options = { ...options, fn: (value: unknown, frame?: any) => { if (frame?.data) frame.data.key = undefined; return fn(value, frame); } };
		}
		return builtin.each.call(this, args[0], options);
	});
	hb.registerHelper("with", function (this: unknown, ...args: unknown[]) {
		const options = args[args.length - 1] as HelperOptions;
		if (args.length !== 2) throw new Located("#with requires exactly one argument", at(options), inside.at(-1));
		if (env.strict && args[0] === undefined) throw missing(options, 0);
		return builtin.with.apply(this, args);
	});
	hb.registerHelper("lookup", function (this: unknown, ...args: unknown[]) {
		const options = args[args.length - 1] as HelperOptions;
		const found = builtin.lookup.apply(this, args);
		if (env.strict && found === undefined) throw new Located(`\`${typeof options.ids?.[0] === "string" ? options.ids[0] : "the value"}\` has no \`${String(args[1])}\` (strict is on)`, at(options), inside.at(-1));
		return found;
	});
	// Mustache's sections, as 0.7 had them: `{{#items}}` goes over a list, renders once with any
	// other value that isn't false or empty, and `{{^items}}` renders when the value is false.
	const noop = (hb as any).VM.noop;
	hb.registerHelper("blockHelperMissing", function (this: unknown, value: unknown, options: HelperOptions) {
		if (options.fn === noop) return truthy(value) ? "" : options.inverse(this);
		if (Array.isArray(value)) return (hb.helpers.each as any).call(this, value, options);
		if (value === null || value === undefined || value === false || value === "") return options.inverse(this);
		return options.fn(value);
	});
	// A helper that isn't there names itself and its line (`{{shot title}}`); `{{shot}}` alone is a value that's missing.
	hb.registerHelper("helperMissing", (...args: unknown[]) => {
		const options = args[args.length - 1] as HelperOptions;
		if (args.length === 1) return undefined;
		throw new Located(unknownHelper(options.name, [...BUILTIN_HELPERS, ...env.globals.keys()]), at(options), inside.at(-1));
	});

	// The config's functions are helpers: `{{shout title}}`, `{{wrap title "[" "]"}}`, and hash
	// arguments (`size=2`) arrive as one object at the end, its keys in order as the crate kept them.
	for (const [name, fn] of env.globals) {
		hb.registerHelper(name, function (this: unknown, ...params: unknown[]) {
			const options = params.pop() as HelperOptions;
			const hash = Object.entries(options.hash ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
			const args = params.map(given);
			if (hash.length) args.push(Object.fromEntries(hash.map(([k, v]) => [k, given(v)])));
			const line = at(options);
			const file = inside.at(-1);
			const position = answers ? answers.at++ : -1;
			const known = answers?.calls[position];
			if (known?.fn === fn) return known.value;
			let out: unknown;
			try { out = fn.apply(this, args); } catch (e) { throw new Located(`${name}(): ${describeThrown(e, root)}`, line, file); }
			if (out instanceof Promise && answers) {
				answers.waiting = { at: position, fn, promise: watchSettle(out).catch((e) => { throw new Located(`${name}(): ${describeThrown(e, root)}`, line, file); }) };
				throw new Waiting();
			}
			answers?.calls.splice(position, Infinity, { fn, value: out });
			return out;
		});
	}

	// Every file in the includes folders is a partial, by its path with and without the
	// extension (`{{> nav}}` or `{{> nav.hbs}}`); the site's own replaces a theme's. A name
	// without the extension is the Handlebars file's when there's one (`nav` is `nav.hbs`, not
	// `nav.njk`), the site's before a theme's. Read when the first template renders.
	let partialsReady = false;
	const registerPartials = () => {
		partialsReady = true;
		let broken: BuildError | undefined;
		const stems = new Map<string, { rank: number; partial: unknown }>();
		const dirs = env.includeDirs;
		for (let d = dirs.length - 1; d >= 0; d--) {
			for (const rel of filesUnder(dirs[d])) {
				const file = path.join(dirs[d], rel);
				let source: string;
				try { source = fs.readFileSync(file, "utf8"); } catch { continue; }
				const ext = path.extname(rel).slice(1).toLowerCase();
				let ast: hbs.AST.Program;
				try {
					ast = hb.parse(source);
				} catch (e) {
					// The includes folder holds other engines' files too: only a Handlebars file has to
					// parse. The first page to render says so; the other partials are there for the rest.
					if (!EXTENSIONS.includes(ext)) continue;
					const { line, message } = parseError(e, source);
					broken ??= new BuildError(`${shownPath(file, root)}${line === undefined ? "" : `:${line}`}: ${message}`);
					continue;
				}
				let compiled: HandlebarsTemplateDelegate | undefined;
				const partial = (context: unknown, options: unknown) => {
					loaded.add(rel);
					compiled ??= hb.compile(ast, compileOptions);
					inside.push(file);
					try {
						return compiled(context, options as any);
					} catch (e) {
						if (e instanceof Waiting) throw e;
						// An error in a partial names the partial's file and its line.
						throw located(e, source, file, Object.keys(hb.partials));
					} finally {
						inside.pop();
					}
				};
				hb.registerPartial(rel, partial as any);
				const dot = rel.lastIndexOf(".");
				if (dot > 0 && !rel.slice(dot).includes("/")) {
					// Lower is better: a Handlebars file, then the folder (the site's is 0), then `.hbs`
					// before `.handlebars` before `.mustache`. Among other files, the first by name.
					const kind = EXTENSIONS.indexOf(ext);
					const rank = (kind === -1 ? 1_000_000 : 0) + d * 10 + (kind === -1 ? 9 : kind);
					const stem = rel.slice(0, dot);
					const had = stems.get(stem);
					if (!had || rank < had.rank) stems.set(stem, { rank, partial });
				}
			}
		}
		for (const [stem, { partial }] of stems) hb.registerPartial(stem, partial as any);
		if (broken) throw broken;
	};

	const compiled = new Map<string, HandlebarsTemplateDelegate>();
	const template = (source: string, ctx: RenderContext) => {
		let made = ctx.cacheKey === undefined ? undefined : compiled.get(ctx.cacheKey);
		if (!made) {
			made = hb.compile(source, compileOptions);
			if (ctx.cacheKey !== undefined) compiled.set(ctx.cacheKey, made);
		}
		return made;
	};
	const fail = (e: unknown, source: string, ctx: RenderContext): never => {
		if (e instanceof BuildError) throw e;
		const found = located(e, source, undefined, Object.keys(hb.partials));
		throw new BuildError(`${found.file ? shownPath(found.file, root) : ctx.name}${found.line === undefined ? "" : `:${found.line}`}: ${found.message}`);
	};
	/** One rendering, with the answers so far; it throws `Waiting` where a helper's promise has to settle first. */
	const once = (source: string, data: Data, ctx: RenderContext, now: Answers): string => {
		// Another page's `templateContent` can render in the middle of this one: its answers are put back after.
		const was = answers;
		answers = now;
		now.at = 0;
		now.waiting = undefined;
		try {
			return template(source, ctx)(data, runtimeOptions);
		} catch (e) {
			if (e instanceof Waiting) throw e;
			return fail(e, source, ctx);
		} finally {
			answers = was;
		}
	};
	return {
		render(source, data, ctx) {
			if (!partialsReady) registerPartials();
			if (!source.includes("{{")) return source;
			const now = new Answers();
			try {
				return once(source, data, ctx, now);
			} catch (e) {
				if (!(e instanceof Waiting)) throw e;
			}
			const later = async (): Promise<string> => {
				for (;;) {
					const { at: position, fn, promise } = now.waiting!;
					now.calls.splice(position, Infinity, { fn, value: await promise });
					try {
						return once(source, data, ctx, now);
					} catch (e) {
						if (!(e instanceof Waiting)) throw e;
					}
				}
			};
			return later().catch((e) => fail(e, source, ctx));
		},
		included: () => [...loaded],
	};
}

/** What the config's helpers answered in one page's rendering, in the order they were called, and the promise the last rendering stopped at. */
class Answers {
	calls: Array<{ fn: Filter; value: unknown }> = [];
	at = 0;
	waiting?: { at: number; fn: Filter; promise: Promise<unknown> };
}

/** Thrown where a helper answered with a promise: the rendering stops there, and goes again once the promise has settled. */
class Waiting extends Error {}

function unknownHelper(name: string, helpers: string[]): string {
	const near = closest(name, helpers.filter((h) => h !== name));
	return `unknown helper \`${name}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
}

/**
 * handlebars.js' parse error, without the excerpt it draws (the build shows the file's own
 * lines). A block that's never closed is found at the end of the file, so it's named where it
 * opens.
 */
function parseError(e: unknown, source: string): { line?: number; message: string } {
	const text = String((e as Error)?.message ?? e);
	const parse = /^Parse error on line (\d+):\n[^\n]*\n[^\n]*\n(.*)$/s.exec(text);
	if (parse && /got 'EOF'$/.test(parse[2].trim())) {
		const open = unclosedBlock(source);
		if (open) return { line: open.line, message: `invalid Handlebars syntax: \`{{${open.mark}${open.name}}}\` is never closed (a \`{{/${open.name}}}\` is missing)` };
	}
	if (parse) return { line: Number(parse[1]), message: `invalid Handlebars syntax: ${parse[2].trim()}` };
	const lexical = /^Lexical error on line (\d+)\. ([^\n]*)/.exec(text);
	if (lexical) return { line: Number(lexical[1]), message: `invalid Handlebars syntax: ${lexical[2].trim()}` };
	const located = / - (\d+):(\d+)$/.exec(text);
	if (located) return { line: Number(located[1]), message: text.slice(0, located.index) };
	return { line: (e as { lineNumber?: number })?.lineNumber, message: text };
}

/** The last block (`{{#if x}}`, `{{^items}}`) that's opened and not closed, and its line. */
function unclosedBlock(source: string): { mark: string; name: string; line: number } | undefined {
	const open: Array<{ mark: string; name: string; at: number }> = [];
	for (const m of source.matchAll(/\{\{~?\s*(#\*?>?|\^|\/)\s*([^\s}~]+)/g)) {
		if (m[1] === "/") {
			const i = open.findLastIndex((b) => b.name === m[2]);
			if (i !== -1) open.splice(i);
		} else open.push({ mark: m[1], name: m[2], at: m.index });
	}
	const last = open.at(-1);
	return last && { mark: last.mark, name: last.name, line: source.slice(0, last.at).split("\n").length };
}

/**
 * handlebars.js' error as ssqch says it, and where it happened: `unknown helper \`shot\` (did you
 * mean \`shout\`?)` on line 3. The line counts from the template's body (`source`), and `file` is
 * the partial's, when the error is in one.
 */
function located(e: unknown, source: string, file: string | undefined, partials: string[]): Located {
	if (e instanceof Located) return e;
	if (e instanceof BuildError) return new Located(e.message, undefined, file);
	let { line, message } = parseError(e, source);
	const lines = source.split("\n");
	const word = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let found: RegExpExecArray | null;
	if ((found = /^The partial (.+) could not be found$/.exec(message))) {
		const wanted = found[1];
		if (line === undefined) {
			const at = lines.findIndex((text) => new RegExp(`\\{\\{~?>\\s*${word(wanted)}`).test(text));
			if (at !== -1) line = at + 1;
		}
		const others = partials.filter((p) => p !== wanted);
		const near = closestPath(wanted, others) ?? closest(wanted, others);
		message = `template not found: can't include \`${wanted}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
	} else if ((found = /^Cannot use 'in' operator to search for '([^']+)' in /.exec(message))) {
		// `strict` with `this` a plain value (`{{#each names}}{{nope}}{{/each}}`): handlebars.js tries `in` on it.
		const wanted = found[1];
		if (line === undefined) {
			const index = lines.findIndex((text) => new RegExp(`\\{\\{[{~#^&]?\\s*(?:[\\w@$-]+[./])*${word(wanted)}\\s*~?\\}`).test(text));
			if (index !== -1) line = index + 1;
		}
		message = `\`${wanted}\` is undefined (strict is on)`;
	} else if ((found = /^"([^"]+)" not defined in /.exec(message))) {
		// The whole path, from the line handlebars.js names (it says only the last part).
		const text = line === undefined ? "" : lines[line - 1] ?? "";
		const whole = new RegExp(`\\{\\{[{~#^&]?\\s*((?:[\\w@$-]+[./])*${word(found[1])})\\s*~?\\}`).exec(text)?.[1] ?? found[1];
		message = `\`${whole}\` is undefined (strict is on)`;
	}
	return new Located(message, line, file);
}

/** Every file under `dir`, as paths from it with forward slashes, in a fixed order. */
function filesUnder(dir: string, rel = ""): string[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return entries.flatMap((entry) => {
		const p = rel ? `${rel}/${entry.name}` : entry.name;
		return entry.isDirectory() ? filesUnder(dir, p) : [p];
	});
}
