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
interface HelperOptions { name: string; hash: Data; loc?: Loc; fn: (context: unknown, options?: unknown) => string; inverse: (context: unknown, options?: unknown) => string }

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
	if (Array.isArray(value)) return `[${value.map((item) => { const s = printable(item); return s === undefined || s === null ? "" : String(s); }).join(", ")}]`;
	if (isPlainObject(value)) return "[object]";
	return value;
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

function makeHandlebars(env: EngineEnv): TemplateEngine {
	const root = env.config.root;
	const hb = handlebarsLib().create();
	useCompiler(hb);
	// `{{log}}` says nothing, as in 0.7.
	(hb as any).logger.level = "error";
	const loaded = new Set<string>();
	const compileOptions = { strict: env.strict };
	const runtimeOptions = { allowProtoPropertiesByDefault: true };

	// A helper that answers with a promise is awaited: the template is rendered again with the
	// answer, until nothing new is waited for. Templates whose helpers all answer at once render
	// once, synchronously.
	let round: Round | undefined;
	/** The partials being rendered, innermost last: an error in a helper names the one it's in. */
	const inside: string[] = [];

	// The handlebars crate's helpers, which 0.7 had: comparisons (as blocks too), `len` and `raw`.
	const boolean = (name: string, test: (args: unknown[]) => boolean) => {
		hb.registerHelper(name, function (this: unknown, ...args: unknown[]) {
			const options = args.pop() as HelperOptions;
			const value = test(args);
			if (options.fn === undefined) return value;
			return value ? options.fn(this) : options.inverse(this);
		});
	};
	boolean("eq", ([a, b]) => same(a, b));
	boolean("ne", ([a, b]) => !same(a, b));
	boolean("gt", ([a, b]) => compare(a, b) === 1);
	boolean("gte", ([a, b]) => { const c = compare(a, b); return c !== undefined && c !== -1; });
	boolean("lt", ([a, b]) => compare(a, b) === -1);
	boolean("lte", ([a, b]) => { const c = compare(a, b); return c !== undefined && c !== 1; });
	boolean("and", (args) => args.every(truthy));
	boolean("or", (args) => args.some(truthy));
	boolean("not", ([a]) => !truthy(a));
	// `if` and `unless` tell truth as the crate does, so `{{#if settings}}` is false for `{}` as in 0.7.
	for (const [name, wanted] of [["if", true], ["unless", false]] as const) {
		hb.registerHelper(name, function (this: unknown, ...args: unknown[]) {
			const options = args.pop() as HelperOptions;
			if (args.length !== 1) throw new Located(`#${name} requires exactly one argument`, options.loc?.start.line, inside.at(-1));
			let value = args[0];
			if (typeof value === "function") value = value.call(this);
			const truth = (options.hash?.includeZero && value === 0) || truthy(value);
			return truth === wanted ? options.fn(this) : options.inverse(this);
		});
	}
	hb.registerHelper("len", (value: unknown) => (Array.isArray(value) ? value.length : typeof value === "string" ? Buffer.byteLength(value) : isPlainObject(value) ? Object.keys(value).length : 0));
	hb.registerHelper("raw", (options: HelperOptions) => options.fn(undefined));
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
		throw new Located(unknownHelper(options.name, [...BUILTIN_HELPERS, ...env.globals.keys()]), options.loc?.start.line, inside.at(-1));
	});

	// The config's functions are helpers: `{{shout title}}`, `{{wrap title "[" "]"}}`, and hash
	// arguments (`size=2`) arrive as one object at the end.
	for (const [name, fn] of env.globals) {
		hb.registerHelper(name, function (this: unknown, ...params: unknown[]) {
			const options = params.pop() as HelperOptions;
			const args = Object.keys(options.hash ?? {}).length ? [...params, { ...options.hash }] : params;
			const line = options.loc?.start.line;
			const known = round?.answer(fn, args);
			if (known) return known.value;
			let out: unknown;
			const file = inside.at(-1);
			try { out = fn.apply(this, args); } catch (e) { throw new Located(`${name}(): ${describeThrown(e, root)}`, line, file); }
			if (out instanceof Promise) {
				round!.wait(fn, args, watchSettle(out).catch((e) => { throw new Located(`${name}(): ${describeThrown(e, root)}`, line, file); }));
				return "";
			}
			return out;
		});
	}

	// Every file in the includes folders is a partial, by its path with and without the
	// extension (`{{> nav}}` or `{{> nav.hbs}}`); the site's own replaces a theme's. Read when the
	// first template renders.
	let partialsReady = false;
	const registerPartials = () => {
		partialsReady = true;
		let broken: BuildError | undefined;
		for (const dir of [...env.includeDirs].reverse()) {
			for (const rel of filesUnder(dir)) {
				const file = path.join(dir, rel);
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
						// An error in a partial names the partial's file and its line.
						throw located(e, source, file, Object.keys(hb.partials));
					} finally {
						inside.pop();
					}
				};
				hb.registerPartial(rel, partial as any);
				const dot = rel.lastIndexOf(".");
				if (dot > 0 && !rel.slice(dot).includes("/")) hb.registerPartial(rel.slice(0, dot), partial as any);
			}
		}
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
		const at = located(e, source, undefined, Object.keys(hb.partials));
		throw new BuildError(`${at.file ? shownPath(at.file, root) : ctx.name}${at.line === undefined ? "" : `:${at.line}`}: ${at.message}`);
	};
	const once = (source: string, data: Data, ctx: RenderContext, now: Round): string => {
		// Another page's `templateContent` can render in the middle of this one: its round is put back after.
		const was = round;
		round = now;
		try {
			return template(source, ctx)(data, runtimeOptions);
		} catch (e) {
			return fail(e, source, ctx);
		} finally {
			round = was;
		}
	};
	return {
		render(source, data, ctx) {
			if (!partialsReady) registerPartials();
			if (!source.includes("{{")) return source;
			const first = new Round();
			const out = once(source, data, ctx, first);
			if (!first.waiting.length) return out;
			const again = async (last: Round): Promise<string> => {
				await last.settle();
				const next = last.next();
				const text = once(source, data, ctx, next);
				return next.waiting.length ? again(next) : text;
			};
			return again(first).catch((e) => fail(e, source, ctx));
		},
		included: () => [...loaded],
	};
}

/** One rendering of a template: the answers async helpers gave before it, and what it's waiting for. */
class Round {
	answers: Array<{ fn: Filter; args: unknown[]; value: unknown }>;
	waiting: Array<{ fn: Filter; args: unknown[]; promise: Promise<unknown> }> = [];
	count: number;
	constructor(answers: Round["answers"] = [], count = 0) {
		this.answers = answers;
		this.count = count;
	}
	answer(fn: Filter, args: unknown[]): { value: unknown } | undefined {
		return this.answers.find((a) => a.fn === fn && sameArgs(a.args, args));
	}
	wait(fn: Filter, args: unknown[], promise: Promise<unknown>): void {
		if (!this.waiting.some((w) => w.fn === fn && sameArgs(w.args, args))) this.waiting.push({ fn, args, promise });
	}
	async settle(): Promise<void> {
		for (const w of this.waiting) this.answers.push({ fn: w.fn, args: w.args, value: await w.promise });
	}
	next(): Round {
		// Each round answers something new, so this ends unless a helper's arguments are new every time.
		if (this.count >= 50) throw new Located("an async helper got new arguments each time the template rendered (50 times)");
		return new Round(this.answers, this.count + 1);
	}
}

/** The same arguments: the same values, or objects (a hash) with the same values. */
function sameArgs(a: unknown[], b: unknown[]): boolean {
	const one = (x: unknown, y: unknown, depth: number): boolean => {
		if (x === y || (Number.isNaN(x) && Number.isNaN(y))) return true;
		if (depth > 2 || typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
		if (x instanceof Date && y instanceof Date) return x.getTime() === y.getTime();
		if (Array.isArray(x) !== Array.isArray(y)) return false;
		const keys = Object.keys(x);
		return keys.length === Object.keys(y).length && keys.every((k) => one((x as Data)[k], (y as Data)[k], depth + 1));
	};
	return a.length === b.length && a.every((x, i) => one(x, b[i], 0));
}

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
