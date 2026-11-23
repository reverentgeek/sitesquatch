// Edge, for `.edge`: the edge.js library itself, with what 0.7's Edge did around it.
//
// 0.7's Edge was ssqch's own (`crates/sitesquatch-edge`), written to match edge.js, and in a few
// places it did what edge.js doesn't. Those are kept by adjusting a template's code as edge.js
// compiles it, through its parser (`adjust` below): an undefined value prints nothing, a
// mustache can start with an object literal (`{{ { tip: 'T' }[kind] }}`), a call reaches the
// filter when the page has a field of that name (`{{ image(...) }}` beside `image:`), `@let` reads
// the value it replaces (`@let(n = n - 1)`) and can be said twice, an include gives back the
// variables it changed, `@each` has `$loop`, `reverse()` and `sort()` give copies (so a page
// can't reorder a collection under the next one), and lines end with `\n` on every system.
// Values are 0.7's too, in `edge-values.ts`: dates in UTC whatever the machine's time zone, and
// as ISO 8601 text, strings indexed by character, numbers never in exponent notation.
//
// Compiled templates are kept: a page's or a layout's by its cache key, an include by its file
// and the variables it shares (edge.js compiles an include again each time it's used).
//
// A template renders synchronously, as 0.7's did, until something in it gives a promise (an
// async filter). Then that template is compiled again in edge.js's async mode, where every call
// is awaited, as 0.7 awaited every function's answer, and it renders that way from then on; what
// the first attempt called is answered from its record, so a function runs once. A page whose
// body has nothing async still renders on demand, when another page reads its
// `templateContent`, even when its layout is async.
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { Edge, EdgeError, Template, edgeGlobals } from "edge.js";
import type { CompiledTemplate, LoaderContract, TagContract } from "edge.js/types";
import { Parser } from "edge-parser";
import type { Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { readText } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { describeThrown, watchSettle } from "../modules.ts";
import { isSafe } from "../rendering.ts";
import { compareText, isFile, relative, walkFiles } from "../paths.ts";
import { closest } from "../suggest.ts";
import * as voice from "../voice.ts";
import * as values from "./edge-values.ts";
import { siteFunction } from "./engine.ts";
import type { EngineEnv, RenderContext, TemplateEngine } from "./engine.ts";

/** How deep includes and components go before it's a loop, as in 0.7. */
const MAX_DEPTH = 64;

/** Thrown in a synchronous render when something gave a promise: the template is rendered again, in async mode. */
const NEEDS_ASYNC = new Error("ssqch: an Edge template needs async mode");

const escapeHtml: (value: unknown) => string = edgeGlobals.html.escape;
const SafeValue = edgeGlobals.html.safe("").constructor as new (value: unknown) => { value: unknown };

/** An Edge engine's settings, for its parser, found by the edge.js instance's tags (which every parser it makes has). */
interface Settings {
	strict: boolean;
	/** The globals that are functions, which a call reaches when the page has a field of the same name. */
	functions: Set<string>;
	/** ssqch's own globals and the config's: what "did you mean" suggests, and what a JavaScript global of the same name yields to. */
	globals: Set<string>;
}
const ENGINES = new WeakMap<object, Settings>();

export function edgeEngine(env: EngineEnv): TemplateEngine {
	const root = env.config.root;
	const loader = new Includes(env.includeDirs, root);
	const edge = Edge.create({ cache: true, loader });
	install();
	for (const tag of [letTag, eachTag, includeTag, includeIfTag, endTag]) edge.registerTag(tag);
	edge.registerTag(insideBlocks(edge.tags.else, ["if", "unless", "each"]));
	edge.registerTag(insideBlocks(edge.tags.elseif, ["if", "unless"]));

	// 0.7's own helpers, then ssqch's functions and the config's, which replace any of the same name.
	edge.global("stringify", (value: unknown, _replacer?: unknown, indent?: unknown) => stringify(value, null, indent));
	// `safe(html)` prints its value as it is, as edge.js's `html.safe` does (0.7's changed nothing).
	edge.global("safe", (value: unknown) => (value instanceof SafeValue ? value : new SafeValue(value)));
	edge.global("escape", (value: unknown) => escapeHtml(String(value)));
	edge.global("truncate", (value: unknown, length?: unknown) => {
		const chars = [...String(value)];
		const n = Math.max(Math.trunc(Number(length)) || 0, 0);
		return chars.length > n ? `${chars.slice(0, n).join("")}...` : String(value);
	});
	const running: Running = { syncDepth: 0, recording: undefined };
	for (const [name, fn] of env.globals) edge.global(name, settled(name, fn, root, running));
	const functions: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(edge.globals)) if (typeof value === "function") functions[name] = value;
	// Other generators' filters that are aliases (`url`, `markdownify`) work here as calls only:
	// `url("/about/")` reaches the alias, and `{{ url }}` stays the page's data (blog #4).
	for (const [name, fn] of env.pipeFilters) if (!(name in functions)) functions[name] = settled(name, fn, root, running);
	const globals = new Set(["stringify", "safe", "escape", "truncate", ...env.globals.keys()]);
	ENGINES.set(edge.tags, { strict: env.strict, functions: new Set(Object.keys(functions)), globals });

	const helpers = makeHelpers(functions);
	const used = new Set<string>();
	const engine: EngineState = { edge, loader, helpers, used };

	// edge.js compiles an include again each time it's used (its cache skips an include that's
	// given variables, and every include is given a list, if an empty one). Kept here instead,
	// by the file and the variables it shares. An include gives those variables back as it
	// leaves them (`template.ssqchShared`), so an `@assign` in it reaches the template that
	// included it, as in 0.7, where an include shared its includer's scope.
	let sharing: string[] | undefined;
	edge.processor.process("compiled", ({ compiled: code }) => (sharing?.length ? code.replace(/return out;\s*$/, `template.ssqchShared = [${sharing.join(", ")}];\nreturn out;`) : undefined));
	for (const compiler of [edge.compiler, edge.asyncCompiler]) {
		const compile = compiler.compile.bind(compiler);
		const kept = new Map<string, CompiledTemplate>();
		compiler.compile = (templatePath: string, localVariables?: string[]) => {
			if (!localVariables) return compile(templatePath);
			const key = `${loader.makePath(templatePath)}\n${localVariables.join(",")}`;
			let fn = kept.get(key);
			if (!fn) {
				sharing = localVariables;
				try { fn = compile(templatePath, localVariables); } finally { sharing = undefined; }
				kept.set(key, fn);
			}
			return fn;
		};
	}

	const compiled = new Map<string, Compiled>();
	const fail = (e: unknown, ctx: RenderContext): BuildError => {
		if (e instanceof TemplateError) return new BuildError(e.message);
		if (e instanceof EdgeError) return new BuildError(`parse error in ${ctx.name}: line ${e.line}: ${edgeMessage(e)}`);
		if (e instanceof BuildError) return e;
		return new BuildError(`${ctx.name}: ${describeThrown(e, root)}`);
	};
	const finish = (template: Render, out: string) => template.stacks.fillPlaceholders(out.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));

	return {
		render(source, data, ctx) {
			// Nothing for edge.js to do: its lines, as it would give them back.
			if (!source.includes("{{") && !source.includes("@")) return source.replace(/\r\n?/g, "\n").replace(/^\n/, "").replace(/\n$/, "");
			const key = ctx.cacheKey ?? `${ctx.name}\0${source}`;
			let entry = compiled.get(key);
			if (entry?.source !== source) compiled.set(key, entry = { source, async: false });
			const calls: Call[] = [];
			if (!entry.async) {
				let fn: CompiledTemplate;
				try { fn = entry.sync ??= edge.compiler.compileRaw(source, ctx.name); } catch (e) { throw fail(e, ctx); }
				const template = new Render(engine, edge.compiler, ctx.name, source);
				const outer = running.recording;
				running.recording = calls;
				running.syncDepth++;
				try {
					return finish(template, fn(template, { ...edge.globals, ...data }, {}));
				} catch (e) {
					if (e !== NEEDS_ASYNC) throw fail(e, ctx);
					entry.async = true;
				} finally {
					running.syncDepth--;
					running.recording = outer;
				}
			}
			let fn: CompiledTemplate;
			try { fn = entry.asyncFn ??= edge.asyncCompiler.compileRaw(source, ctx.name); } catch (e) { throw fail(e, ctx); }
			const template = new Render(engine, edge.asyncCompiler, ctx.name, source);
			return replays.run({ calls, at: 0 }, () => watchSettle(fn(template, { ...edge.globals, ...data }, {}) as Promise<string>)).then((out) => finish(template, out), (e) => { throw fail(e, ctx); });
		},
		included: () => [...used],
	};
}

interface EngineState {
	edge: Edge;
	loader: Includes;
	helpers: Helpers;
	/** The includes and components rendered so far, by the names they were asked for, without `.edge`. */
	used: Set<string>;
}

interface Compiled {
	source: string;
	sync?: CompiledTemplate;
	asyncFn?: CompiledTemplate;
	/** Something in it gave a promise: it renders in async mode from now on. */
	async: boolean;
}

/** A call of a site's function, and its answer. */
interface Call { name: string; args: unknown[]; out: unknown }

/** Where renders stand: how many synchronous ones are running (one inside another, for `templateContent`), and the calls the innermost has made. */
interface Running {
	syncDepth: number;
	recording: Call[] | undefined;
}

/**
 * The calls a synchronous attempt made before something gave a promise, which the render in
 * async mode answers again, in the same order, without calling: a filter that logs or counts
 * runs once, as it did in 0.7. An async render's own (AsyncLocalStorage, so two renders can't
 * take each other's).
 */
const replays = new AsyncLocalStorage<{ calls: Call[]; at: number }>();

/** The same arguments: equal values, and plain objects and lists with equal contents (a template makes `{ width: 1200 }` again each time). */
function sameArgs(a: unknown, b: unknown, depth = 0): boolean {
	if (Object.is(a, b)) return true;
	if (depth > 4 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameArgs(x, b[i], depth + 1));
	if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((k) => sameArgs((a as Data)[k], (b as Data)[k], depth + 1));
}

/**
 * A site's function as Edge templates call it. In a synchronous render, a promise from it means
 * the template has to be rendered again in async mode, where it's awaited; what it was called
 * with before that is answered from the attempt's record.
 */
function settled(name: string, fn: Filter, root: string, running: Running): Filter {
	const site = siteFunction(name, fn, root);
	return function (this: unknown, ...args: unknown[]) {
		if (running.syncDepth > 0) {
			const out = site.apply(this, args);
			running.recording?.push({ name, args, out });
			if (out instanceof Promise) {
				// Awaited by the render in async mode, which gets this same promise from the record.
				out.catch(() => {});
				throw NEEDS_ASYNC;
			}
			return out;
		}
		const replay = replays.getStore();
		if (replay && replay.at < replay.calls.length) {
			const before = replay.calls[replay.at];
			if (before.name === name && sameArgs(before.args, args)) {
				replay.at++;
				return before.out;
			}
			// The render took another path: everything from here is called.
			replay.at = replay.calls.length;
		}
		return site.apply(this, args);
	};
}

// ---- what compiled templates call ----------------------------------------------------------

/** What compiled templates reach as `template.ssqch`. */
interface Helpers {
	/** A `{{ }}`: nothing for `undefined` and `null`, a date in ISO 8601, the rest escaped. `source` is there when `strict` is on. */
	esc(value: unknown, source?: string): string;
	/** A `{{{ }}}`: the same, not escaped. */
	raw(value: unknown, source?: string): string;
	/** `await` in a synchronous render: a value as it is, and a promise sends the template to async mode. */
	awaitSync(value: unknown): unknown;
	/** A call inside a function, in async mode, where its answer can't be awaited. */
	notAsync(value: unknown, what: string): unknown;
	/** What a `map` with an async callback gave: the list, once every answer is in. */
	all(value: unknown): unknown;
	/** The globals that are functions, for a call whose name the page's data has too. */
	functions: Record<string, unknown>;
	reverse(list: any, ...args: unknown[]): unknown;
	sort(list: any, ...args: unknown[]): unknown;
	loop(collection: unknown, iteratee: (value: unknown, key: unknown, $loop: LoopInfo) => void): void;
	loopAsync(collection: unknown, iteratee: (value: unknown, key: unknown, $loop: LoopInfo) => Promise<void>): Promise<void>;
	// 0.7's values (see `edge-values.ts`): a date in UTC and as ISO 8601, a string by character.
	str: typeof values.jsString;
	add: typeof values.add;
	call: typeof values.call;
	index: typeof values.index;
	newDate: typeof values.newDate;
	parseDate(text: unknown): number;
	/** `JSON.stringify` (and `stringify`), as 0.7 had them: `null` for nothing or a function, where JavaScript gives nothing at all. */
	stringify(value: unknown, replacer?: unknown, indent?: unknown): string;
}

/** `$loop`: 0.7's `first` and `last`, and edge.js's own names for them, `isFirst` and `isLast`, which were undefined here, silently (a trailing comma after the last item). */
interface LoopInfo { index: number; total: number; first: boolean; last: boolean; isFirst: boolean; isLast: boolean; isOdd: boolean; isEven: boolean }

function stringify(value: unknown, replacer?: unknown, indent?: unknown): string {
	const space = typeof indent === "number" || typeof indent === "string" ? indent : undefined;
	return JSON.stringify(value === undefined || typeof value === "function" ? null : value, replacer as (string | number)[] | null, space);
}

function makeHelpers(functions: Record<string, unknown>): Helpers {
	const text = (value: unknown, source: string | undefined, escape: boolean): string => {
		if (value === undefined || value === null) {
			if (value === undefined && source !== undefined) throw new BuildError(`\`${source}\` is undefined (strict is on)`);
			return "";
		}
		if (value instanceof Promise) {
			value.catch(() => {});
			throw NEEDS_ASYNC;
		}
		if (value instanceof SafeValue) return text(value.value, undefined, false);
		// `safe()` from ssqch, as the other template languages read it.
		if (isSafe(value)) return String(value);
		const out = values.jsString(value);
		return escape ? escapeHtml(out) : out;
	};
	const entries = (collection: unknown): Array<[unknown, unknown]> => {
		if (Array.isArray(collection)) {
			const out: Array<[unknown, unknown]> = [];
			for (let i = 0; i < collection.length; i++) out.push([collection[i], i]);
			return out;
		}
		if (typeof collection === "string") return [...collection].map((c, i) => [c, i]);
		if (collection && typeof collection === "object") return Object.entries(collection).map(([k, v]) => [v, k]);
		return [];
	};
	const info = (index: number, total: number): LoopInfo => ({ index, total, first: index === 0, last: index === total - 1, isFirst: index === 0, isLast: index === total - 1, isOdd: index % 2 === 1, isEven: index % 2 === 0 });
	return {
		esc: (value, source) => text(value, source, true),
		raw: (value, source) => text(value, source, false),
		awaitSync(value) {
			if (value instanceof Promise) {
				value.catch(() => {});
				throw NEEDS_ASYNC;
			}
			return value;
		},
		notAsync(value, what) {
			if (!(value instanceof Promise)) return value;
			value.catch(() => {});
			throw new BuildError(`\`${what}()\` gave a promise inside a function (\`x => ...\`), where it can't be awaited: call it outside the function first, with @let`);
		},
		all: (value) => (Array.isArray(value) ? Promise.all(value) : value),
		functions,
		// 0.7's lists couldn't change, so these gave copies, and a page's `collections.posts.reverse()`
		// doesn't reorder the list for the next page.
		reverse: (list, ...args) => (Array.isArray(list) ? list.toReversed() : list.reverse(...args)),
		sort: (list, ...args) => (Array.isArray(list) ? list.toSorted(...(args as [])) : list.sort(...args)),
		loop(collection, iteratee) {
			const all = entries(collection);
			for (let i = 0; i < all.length; i++) iteratee(all[i][0], all[i][1], info(i, all.length));
		},
		async loopAsync(collection, iteratee) {
			const all = entries(collection);
			for (let i = 0; i < all.length; i++) await iteratee(all[i][0], all[i][1], info(i, all.length));
		},
		str: values.jsString,
		add: values.add,
		call: values.call,
		index: values.index,
		newDate: values.newDate,
		parseDate: (text) => (typeof text === "string" ? values.parseDate(text) : Date.parse(text as string)),
		stringify,
	};
}

// ---- one render ----------------------------------------------------------------------------

/** An error from a template, as ssqch says it: `p.edge:2: what happened`, with where it was included from in front. */
class TemplateError extends Error {
	/** The template it was last placed in, as edge.js names it (an include's file, or the page's name). */
	file: string;
	/** What it just came out of, until the line that used that goes in front. */
	crossed: "Include" | "Component" | undefined;
	/** A loop's message has its whole trail, so nothing goes in front of it. */
	final: boolean;
	constructor(message: string, file: string, final = false) {
		super(message);
		this.file = file;
		this.crossed = undefined;
		this.final = final;
	}
}

/** An include or component that leads back to itself: placed by the template that asked for it. */
class Loop extends Error {}

/** An include or component that couldn't be compiled: `@include('nav'): template not found: ...`. */
class UseFailed extends Error {}

/**
 * One render of a page, a layout or a data string. edge.js gives the same template object to
 * every include and component in it, so this is where the trail of includes (for a loop) and
 * the include chain of an error are kept.
 */
class Render extends Template {
	ssqch: Helpers;
	/** The variables an include gives back to the template that included it (see `includeTag`). */
	ssqchShared: unknown[] = [];
	private engine: EngineState;
	private trail: string[] = [];
	/** The page's, layout's or data string's own name and text, for the line an error is on. */
	private name: string;
	private source: string;

	constructor(engine: EngineState, compiler: Edge["compiler"], name: string, source: string) {
		super(compiler, engine.edge.globals, {}, engine.edge.processor);
		this.engine = engine;
		this.ssqch = engine.helpers;
		this.name = name;
		this.source = source;
	}

	compilePartial(templatePath: string, ...localVariables: string[]): CompiledTemplate {
		return this.enter("Include", templatePath, () => super.compilePartial(templatePath, ...localVariables));
	}

	compileComponent(templatePath: string): CompiledTemplate {
		return this.enter("Component", templatePath, () => super.compileComponent(templatePath));
	}

	private enter(kind: "Include" | "Component", name: string, compile: () => CompiledTemplate): CompiledTemplate {
		const { trail } = this;
		if (trail.length >= MAX_DEPTH) {
			// The loop from the last time this one was asked for (the wording is the voice's).
			const at = trail.lastIndexOf(name);
			const names = [...trail.slice(at === -1 ? Math.max(trail.length - 3, 0) : at), name];
			throw new Loop(`${voice.PASSED_THIS_TREE}. ${kind} loop: ${names.join(" -> ")}`);
		}
		const tag = `@${kind.toLowerCase()}('${name}')`;
		let fn: CompiledTemplate;
		try {
			fn = compile();
		} catch (e) {
			const reason = e instanceof EdgeError ? `parse error in ${this.nameOf(e.filename)}: line ${e.line}: ${edgeMessage(e)}` : String((e as Error)?.message ?? e);
			throw new UseFailed(`${tag}: ${reason}`);
		}
		this.engine.used.add(name.replace(/\.edge$/, ""));
		const file = this.engine.loader.makePath(name);
		// An error from the template's own lines goes up with this line in front of it; one from a
		// slot (the caller's own lines, which the component prints) stays as it is.
		const crossing = (e: unknown) => {
			if (e instanceof TemplateError && !e.final && e.file === file) e.crossed = kind;
			return e;
		};
		return (...args) => {
			trail.push(name);
			let out: unknown;
			try {
				out = fn(...args);
			} catch (e) {
				trail.pop();
				throw crossing(e);
			}
			if (out instanceof Promise) return out.then((value) => { trail.pop(); return value; }, (e) => { trail.pop(); throw crossing(e); });
			trail.pop();
			return out;
		};
	}

	/** What every compiled template's `catch` calls, innermost first, with the line it was on. */
	reThrow(error: unknown, filename: string, lineNumber: number): never {
		if (error === NEEDS_ASYNC) throw error;
		if (error instanceof TemplateError) {
			if (!error.final && error.crossed) {
				const lead = error.crossed === "Include" ? "included from" : "in component used at";
				error.message = `${lead} ${this.nameOf(filename)}:${lineNumber}: ${error.message}`;
				error.crossed = undefined;
				error.file = filename;
			}
			throw error;
		}
		const at = `${this.nameOf(filename)}:${lineNumber}`;
		if (error instanceof Loop) throw new TemplateError(`${at}: ${error.message}`, filename, true);
		if (error instanceof UseFailed) throw new TemplateError(`${at}: ${error.message}`, filename);
		// `@newError` says where it is.
		if (error instanceof EdgeError) throw new TemplateError(`${this.nameOf(error.filename)}:${error.line}: ${error.message}`, error.filename);
		throw new TemplateError(`${at}: ${this.describe(error, filename, lineNumber)}`, filename);
	}

	/** An include's file by its name in the includes folder (`partials/nav.edge`); a page's own name as it is. */
	private nameOf(file: string): string {
		return this.engine.loader.names.get(file) ?? file;
	}

	/** Line `n` of a template this render read: the page's own, or an include's. */
	private lineOf(file: string, n: number): string | undefined {
		const text = file === this.name ? this.source : this.engine.loader.texts.get(file);
		return text?.split("\n")[n - 1];
	}

	/** What a template's code threw, in 0.7's words: `` `upcase` is not a function `` rather than `state.upcase is not a function`. */
	private describe(error: unknown, file: string, line: number): string {
		if (error instanceof BuildError) return error.message;
		const text = describeThrown(error, this.engine.loader.root);
		if (!(error instanceof TypeError || error instanceof ReferenceError)) return text;
		// edge.js reads the page's data as `state.<name>`.
		const plain = text.replace(/(^|[\s(`'])state\./g, "$1");
		// `{{ a.b.c }}`: what was undefined, as 0.7 named it (`... (reading 'b') in \`a\``), when the
		// line has one such place.
		const reading = /^Cannot read properties of (?:undefined|null) \(reading '([^']+)'\)(?=\n|$)/.exec(plain);
		if (reading) {
			const word = reading[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const text = this.lineOf(file, line) ?? "";
			const paths = new Set([...text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*(?:\\??\\.[A-Za-z_$][\\w$]*)*)\\??\\.${word}\\b`, "g"))].map((m) => m[1].replaceAll("?", "")));
			// 0.7's name for what isn't a name: `new Date(x).getTime()`.
			if (!paths.size && new RegExp(`[)\\]]\\??\\.${word}\\b`).test(text)) paths.add("expression");
			if (paths.size === 1) return `${reading[0]} in \`${[...paths][0]}\`${plain.slice(reading[0].length)}`;
			return plain;
		}
		const found = /^(.+?) is not a function(?=\n|$)/.exec(plain);
		if (!found) return plain;
		const name = found[1];
		let more = "";
		if (/^[A-Za-z_$][\w$]*$/.test(name)) {
			const equivalent = equivalents.find(name, "filter");
			const globals = ENGINES.get(this.engine.edge.tags)?.globals ?? new Set<string>();
			const near = equivalent ? undefined : closest(name, [...globals].filter((f) => f !== name).sort(compareText));
			more = equivalent ? `. ${equivalent.say}\n  More: ${equivalent.more}` : near ? ` (did you mean \`${near}\`?)` : "";
		}
		return `\`${name}\` is not a function${more}${plain.slice(found[0].length)}`;
	}
}

/** edge.js's parse error in 0.7's words where they differ: `@if is never closed with @end`. */
function edgeMessage(e: EdgeError): string {
	const unclosed = e.code === "E_UNCLOSED_TAG" ? /^Unclosed tag (\S+)/.exec(e.message) : null;
	if (unclosed) return `@${unclosed[1]} is never closed with @end`;
	return e.message.trim();
}

// ---- includes and components ---------------------------------------------------------------

/**
 * Includes and components, by their paths in the includes folder (`partials/nav` or
 * `partials/nav.edge`): the site's, then each theme's. Front matter at the top of one is
 * skipped, so a layout can be included.
 */
class Includes implements LoaderContract {
	dirs: string[];
	/** The project root, for errors from a site's code. */
	root: string;
	/** An include's file, and its name in errors (`partials/nav.edge`). */
	names = new Map<string, string>();
	/** An include's text as edge.js was given it, for the line an error is on. */
	texts = new Map<string, string>();
	private found = new Map<string, string>();
	mounted = {};
	templates = {};

	constructor(dirs: string[], root: string) {
		this.dirs = dirs;
		this.root = root;
	}

	makePath(templatePath: string): string {
		const rel = templatePath.endsWith(".edge") ? templatePath : `${templatePath}.edge`;
		if (path.isAbsolute(rel)) return rel;
		let file = this.found.get(rel);
		if (file === undefined) {
			file = this.dirs.map((dir) => path.join(dir, rel)).find(isFile);
			if (file === undefined) throw this.notFound(rel);
			this.found.set(rel, file);
			this.names.set(file, rel);
		}
		return file;
	}

	resolve(templatePath: string): { template: string } {
		let text: string;
		try { text = readText(templatePath); } catch (e) {
			if ((e as NodeJS.ErrnoException)?.code === "ENOENT") throw this.notFound(templatePath);
			throw new BuildError(`${templatePath}: ${(e as Error)?.message ?? e}`);
		}
		const template = stripFrontMatter(text);
		this.texts.set(templatePath, template);
		return { template };
	}

	/** `template not found: .../_includes/partials/navv.edge (did you mean \`partials/nav\`?)` */
	private notFound(rel: string): BuildError {
		const wanted = rel.replace(/\.edge$/, "");
		const have = new Set<string>();
		for (const dir of this.dirs) {
			for (const file of walkFiles(dir)) if (file.endsWith(".edge")) have.add(relative(dir, file).slice(0, -5));
		}
		const near = closest(wanted, [...have].filter((name) => name !== wanted).sort(compareText));
		const where = path.isAbsolute(rel) ? rel : path.join(this.dirs[0] ?? "", rel);
		return new BuildError(`template not found: ${where}${near ? ` (did you mean \`${near}\`?)` : ""}`);
	}

	mount(): void {}
	unmount(): void {}
	register(): void {}
	remove(): void {}
	listComponents() { return []; }
	listTemplates() { return []; }
}

/** A template without the front matter at its top, as 0.7 skipped it in includes. */
function stripFrontMatter(src: string): string {
	if (!src.startsWith("---")) return src;
	const rest = src.slice(3);
	const end = rest.indexOf("\n---");
	if (end === -1) return src;
	const after = rest.slice(end + 4);
	return after.startsWith("\r\n") ? after.slice(2) : after.startsWith("\n") ? after.slice(1) : after;
}

// ---- the adjustments, as edge.js compiles ----------------------------------------------------

/**
 * edge.js's parser, adjusted for the instances an engine here made (the others are left alone):
 * each mustache prints through `template.ssqch`, a line ends with `\n` on every system (edge.js
 * uses the system's line ending), `@{{ }}` keeps its lines, and every expression goes through
 * `adjust`.
 */
function install(): void {
	const proto = Parser.prototype as any;
	if (proto.ssqchProcessToken) return;
	const processToken = proto.processToken;
	proto.ssqchProcessToken = processToken;
	proto.processToken = function (this: any, token: any, buffer: any) {
		const settings = ENGINES.get(this.tags);
		if (!settings) return processToken.call(this, token, buffer);
		if (!this.ssqch) prepare(this, settings);
		switch (token.type) {
			case "newline":
				buffer.outputRaw("\n");
				return;
			case "mustache":
			case "s__mustache":
				return mustache(this, token, buffer, settings);
			case "e__mustache":
				buffer.outputRaw(`{{${token.properties.jsArg}}}`);
				return;
			case "es__mustache":
				buffer.outputRaw(`{{{${token.properties.jsArg}}}}`);
				return;
			case "tag": {
				// The blocks it's inside, for an `@else` that isn't in one (see `insideBlocks`).
				if (!this.tags[token.properties.name]?.block) return processToken.call(this, token, buffer);
				const blocks: Block[] = (this.ssqchBlocks ??= []);
				blocks.push({ name: token.properties.name, otherwise: false });
				try { return processToken.call(this, token, buffer); } finally { blocks.pop(); }
			}
			default:
				return processToken.call(this, token, buffer);
		}
	};
}

/** A block tag being compiled, and whether it has had its `@else`. */
interface Block { name: string; otherwise: boolean }

/** Routes a parser's expressions (the tags' arguments, which go through `parser.utils`) through `adjust`. */
function prepare(parser: any, settings: Settings): void {
	const { generateAST, transformAst } = parser.utils;
	parser.utils = {
		...parser.utils,
		// A mustache or argument that starts with `{` is an object literal, not a block: `{{ { tip: 'T' }[kind] }}`.
		generateAST(jsArg: string, loc: any, filename: string) {
			if (!/^\s*\{/.test(jsArg)) return generateAST(jsArg, loc, filename);
			return generateAST(`(${jsArg})`, { ...loc, start: { ...loc.start, col: loc.start.col - 1 } }, filename);
		},
		transformAst(ast: any, filename: string, p: any) {
			return adjust(transformAst(p.asyncMode ? ast : syncAwaits(ast), filename, p), p, settings);
		},
	};
	parser.ssqch = true;
}

function mustache(parser: any, token: any, buffer: any, settings: Settings): void {
	const { jsArg } = token.properties;
	const node = parser.utils.transformAst(parser.utils.generateAST(jsArg, token.loc, token.filename), token.filename, parser);
	const code = parser.utils.stringify(node);
	const helper = token.type === "mustache" ? "esc" : "raw";
	const source = settings.strict ? `, ${JSON.stringify(jsArg.trim())}` : "";
	buffer.outputExpression(`template.ssqch.${helper}(${parser.asyncMode ? `await (${code})` : code}${source})`, token.filename, token.loc.start.line, false);
}

const id = (name: string) => ({ type: "Identifier", name });
const member = (object: any, name: string) => ({ type: "MemberExpression", object, property: id(name), computed: false, optional: false });
const helper = (name: string) => member(member(id("template"), "ssqch"), name);
const call = (callee: any, args: any[]) => ({ type: "CallExpression", callee, arguments: args, optional: false });
const AWAIT_MARK = "$ssqchAwait";
const isState = (node: any, name?: string) => node?.type === "MemberExpression" && !node.computed && node.object.type === "Identifier" && node.object.name === "state" && node.property.type === "Identifier" && (name === undefined || node.property.name === name);
const isFunction = (node: any) => node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration";

interface Where {
	/** Inside a function the template defines (`x => ...`), where an answer can't be awaited. */
	fn: boolean;
	/** Inside an optional chain, which is awaited as a whole. */
	chain: boolean;
	/** A name read as a value (not a property's name, a key or a parameter). */
	ref: boolean;
	/** What a call calls, or what's assigned to, changed or deleted: a member there stays as it is. */
	place: boolean;
	/** The parameters of the functions it's in. */
	params: ReadonlySet<string>;
}

const TOP: Where = { fn: false, chain: false, ref: true, place: false, params: new Set() };

type Visit = (node: any, where: Where) => any;

/** Visits `node`'s children, then `node`, with where each is. `enter` sees a node before its children. */
function walk(node: any, visit: Visit, where: Where = TOP, enter?: (node: any, where: Where) => void): any {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) node[i] = walk(node[i], visit, where, enter);
		return node;
	}
	if (!node || typeof node !== "object" || typeof node.type !== "string") return node;
	enter?.(node, where);
	const scope = isFunction(node);
	// A `map` callback made async (see `adjust`) can await what it calls.
	const fn = where.fn || (scope && !node.ssqchAwaited);
	const params = scope ? new Set([...where.params, ...node.params.flatMap(paramNames)]) : where.params;
	const chain = !scope && (where.chain || node.type === "ChainExpression");
	for (const key in node) {
		if (key === "loc" || key === "type") continue;
		const value = node[key];
		if (!value || typeof value !== "object") continue;
		const named = (node.type === "MemberExpression" && key === "property" && !node.computed) || (node.type === "Property" && key === "key" && !node.computed) || (scope && key === "params");
		const place = (node.type === "CallExpression" && key === "callee") || (node.type === "AssignmentExpression" && key === "left") || node.type === "UpdateExpression" || (node.type === "UnaryExpression" && node.operator === "delete");
		node[key] = walk(value, visit, { fn, chain, ref: !named, place, params }, enter);
	}
	return visit(node, where);
}

/** Whether there's a call anywhere in `node`. */
function hasCall(node: any): boolean {
	if (Array.isArray(node)) return node.some(hasCall);
	if (!node || typeof node !== "object") return false;
	if (node.type === "CallExpression") return true;
	for (const key in node) if (key !== "loc" && hasCall(node[key])) return true;
	return false;
}

/** The names a parameter (or a `@let`) declares: `x`, and those in `{ a, b = 1 }` and `[a, ...b]`. */
function paramNames(node: any): string[] {
	switch (node?.type) {
		case "Identifier": return [node.name];
		case "AssignmentPattern": return paramNames(node.left);
		case "RestElement": return paramNames(node.argument);
		case "ArrayPattern": return node.elements.flatMap(paramNames);
		case "ObjectPattern": return node.properties.flatMap((p: any) => paramNames(p.type === "RestElement" ? p.argument : p.value));
		default: return [];
	}
}

/** Before edge.js reads an expression, in a synchronous render: `await x` is `template.ssqch.awaitSync(x)` (edge.js refuses `await` outside async mode). */
function syncAwaits(ast: any): any {
	return walk(ast, (node) => (node.type === "AwaitExpression" ? call(member(id("state"), AWAIT_MARK), [node.argument]) : node));
}

/** The names edge.js's compiled templates have of their own. */
const INLINE = new Set(["$filename", "state", "$context"]);

/**
 * An expression as edge.js wrote it (the page's data is `state.<name>`), adjusted:
 *
 * - a name that's one of JavaScript's globals too (`escape`, `crypto`) is the page's or ssqch's
 *   when they have it, as in 0.7 (edge.js takes the global, and which names those are changes
 *   between Node releases);
 * - `upper('x')`, when the page has a field `upper` that isn't a function, calls the function;
 * - `reverse()` and `sort()` give copies, as 0.7's did;
 * - a date's methods answer in UTC, `new Date(2024, 0, 5)` is in UTC, and a date as text
 *   (`String(d)`, `` `${d}` ``, `'on ' + d`, `[d].join()`) is ISO 8601, as in 0.7;
 * - a string with an emoji is indexed and sliced by character, as in 0.7;
 * - in async mode, each call is awaited, as 0.7 awaited every function's answer, and so is
 *   each one in a `map` callback (`posts.map(p => imageUrl(p.image))`: the callback is made
 *   async, and the list waited for). One in another function can't be, and says so.
 */
function adjust(ast: any, parser: any, settings: Settings): any {
	const asyncMode: boolean = parser.asyncMode;
	const awaitable = (node: any, where: Where) => {
		if (!asyncMode || where.fn || where.chain || node.type !== "CallExpression") return;
		const [callback] = node.arguments;
		if (isMethod(node.callee, "map") && callback && (callback.type === "ArrowFunctionExpression" || callback.type === "FunctionExpression") && hasCall(callback.body)) {
			callback.async = true;
			callback.ssqchAwaited = true;
		}
	};
	const isNumber = (node: any) => node.type === "Literal" && typeof node.value === "number";
	return walk(ast, (node, where) => {
		switch (node.type) {
			case "Identifier": {
				const { name } = node;
				if (!where.ref || where.params.has(name) || INLINE.has(name) || parser.stack.has(name) || (globalThis as any)[name] === undefined) return node;
				if (settings.globals.has(name)) return member(id("state"), name);
				const test = { type: "BinaryExpression", operator: "in", left: { type: "Literal", value: name, raw: JSON.stringify(name) }, right: id("state") };
				return { type: "ConditionalExpression", test, consequent: member(id("state"), name), alternate: node, ssqchGlobal: name };
			}
			case "NewExpression":
				return node.callee.ssqchGlobal === "Date" ? call(helper("newDate"), node.arguments) : node;
			case "TemplateLiteral":
				node.expressions = node.expressions.map((e: any) => call(helper("str"), [e]));
				return node;
			case "BinaryExpression":
				return node.operator === "+" && !(isNumber(node.left) && isNumber(node.right)) ? call(helper("add"), [node.left, node.right]) : node;
			case "MemberExpression":
				// `t[0]`, not where it's assigned to or called.
				return node.computed && !node.optional && !where.place && !where.chain ? call(helper("index"), [node.object, node.property]) : node;
		}
		if (node.type === "CallExpression") {
			const callee = node.callee;
			if (isState(callee, AWAIT_MARK)) return call(helper("awaitSync"), node.arguments);
			const method = callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" ? callee.property.name : "";
			if (callee.ssqchGlobal === "String" && node.arguments.length === 1) {
				node = call(helper("str"), node.arguments);
			} else if (method === "parse" && callee.object.ssqchGlobal === "Date") {
				node = call(helper("parseDate"), node.arguments);
			} else if (method === "stringify" && callee.object.ssqchGlobal === "JSON") {
				node = call(helper("stringify"), node.arguments);
			} else if ((method === "reverse" || method === "sort") && !callee.optional && !where.chain && !node.optional) {
				node = call(helper(method), [callee.object, ...node.arguments]);
			} else if (values.ADJUSTED_METHODS.has(method) && !isState(callee) && !node.optional) {
				// In an optional chain (`page.date?.getDate()`), nothing gives nothing.
				const optional = { type: "Literal", value: Boolean(callee.optional || where.chain), raw: String(Boolean(callee.optional || where.chain)) };
				const path = calleeName(callee);
				node = call(helper("call"), [callee.object, { type: "Literal", value: method, raw: JSON.stringify(method) }, optional, { type: "Literal", value: path, raw: JSON.stringify(path) }, ...node.arguments]);
			} else if (isState(callee) && settings.functions.has(callee.property.name)) {
				const test = { type: "BinaryExpression", operator: "===", left: { type: "UnaryExpression", operator: "typeof", prefix: true, argument: member(id("state"), callee.property.name) }, right: { type: "Literal", value: "function", raw: "\"function\"" } };
				node.callee = { ...callee, object: { type: "ConditionalExpression", test, consequent: id("state"), alternate: helper("functions") } };
			}
			if (!asyncMode || where.chain) return node;
			if (where.fn) return call(helper("notAsync"), [node, { type: "Literal", value: calleeName(callee), raw: JSON.stringify(calleeName(callee)) }]);
			return { type: "AwaitExpression", argument: callee.type === "MemberExpression" && node.arguments[0]?.ssqchAwaited ? call(helper("all"), [node]) : node };
		}
		if (node.type === "ChainExpression" && asyncMode && !where.chain) {
			return where.fn ? node : { type: "AwaitExpression", argument: node };
		}
		return node;
	}, TOP, awaitable);
}

const isMethod = (callee: any, name: string) => callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier" && callee.property.name === name;

/** A call's name as the template wrote it, for an error: `imageUrl`, `site.helpers.load`. */
function calleeName(callee: any): string {
	if (callee.type === "Identifier") return callee.name;
	if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
		if (callee.object.type === "Identifier" && callee.object.name === "state") return callee.property.name;
		return `${calleeName(callee.object)}.${callee.property.name}`;
	}
	// What 0.7 called anything else.
	return "expression";
}

// ---- tags that work as 0.7's did -------------------------------------------------------------

const unallowed = (message: string, filename: string, loc: { line: number; col: number }): never => {
	throw new EdgeError(message, "E_UNALLOWED_EXPRESSION", { line: loc.line, col: loc.col, filename });
};

/** A tag where it can't be: `unexpected @end`, in 0.7's words. */
const unexpected = (token: any): never => {
	throw new EdgeError(`unexpected @${token.properties.name}`, "E_UNEXPECTED_TAG", { line: token.loc.start.line, col: token.loc.start.col, filename: token.filename });
};

/**
 * `@end` with nothing open. edge.js knows `@end` only as the end of what's open, and printed a
 * stray one as text; 0.7 said where it was.
 */
const endTag: TagContract = { block: false, seekable: false, tagName: "end", compile: (_parser, _buffer, token) => unexpected(token) };

/** `@else` and `@elseif` outside the blocks they belong to (edge.js wrote them into the template's code, which then didn't compile, with no line). */
function insideBlocks(tag: TagContract, blocks: string[]): TagContract {
	return {
		...tag,
		compile(parser: any, buffer: any, token: any) {
			const block: Block | undefined = parser.ssqchBlocks?.at(-1);
			if (!block || !blocks.includes(block.name) || block.otherwise) unexpected(token);
			if (token.properties.name === "else") block!.otherwise = true;
			return tag.compile(parser, buffer, token);
		},
	};
}

/**
 * `@include` and `@includeIf`, with what the include changed given back: an `@assign` or `@let`
 * of a variable the including template has reaches it, as in 0.7, where an include shared its
 * scope. (edge.js gives an include the template's variables as its function's arguments, so
 * what it changes stays in it.) The include hands them back as `template.ssqchShared`.
 */
function include(parser: any, buffer: any, token: any, path: any): void {
	const locals: string[] = [...new Set<string>(parser.stack.list())];
	const render = `template.compilePartial(${[parser.utils.stringify(path), ...locals.map((l) => JSON.stringify(l))].join(",")})(${["template", "state", "$context", ...locals].join(",")})`;
	buffer.outputExpression(`${parser.asyncMode ? "await " : ""}${render}`, token.filename, token.loc.start.line, false);
	if (locals.length) buffer.writeExpression(`[${locals.join(", ")}] = template.ssqchShared`, token.filename, token.loc.start.line);
}

const argument = (parser: any, token: any) => parser.utils.transformAst(parser.utils.generateAST(token.properties.jsArg, token.loc, token.filename), token.filename, parser);

const includeTag: TagContract = {
	block: false,
	seekable: true,
	tagName: "include",
	compile: (parser: any, buffer: any, token: any) => include(parser, buffer, token, argument(parser, token)),
};

const includeIfTag: TagContract = {
	block: false,
	seekable: true,
	tagName: "includeIf",
	compile(parser: any, buffer: any, token: any) {
		const parsed = argument(parser, token);
		if (parsed.type !== "SequenceExpression") unallowed(`"${token.properties.jsArg}" is not a valid argument type for the @includeIf tag`, token.filename, parser.utils.getExpressionLoc(parsed));
		if (parsed.expressions.length !== 2) throw new EdgeError("@includeIf expects a total of 2 arguments", "E_ARGUMENTS_MIS_MATCH", { line: token.loc.start.line, col: token.loc.start.col, filename: token.filename });
		const [condition, path] = parsed.expressions;
		buffer.writeStatement(`if (${parser.utils.stringify(condition)}) {`, token.filename, token.loc.start.line);
		include(parser, buffer, token, path);
		buffer.writeStatement("}", token.filename, -1);
	},
};

/**
 * `@let`, as 0.7 had it: the value is read before the name is declared, so `@let(n = n - 1)`
 * starts from the page's `n` (edge.js declares first, and reading it is an error), and a name
 * can be declared again, in an include that was given it too, or after an `@if` (a `var`, where
 * edge.js has a `let`, which can't be).
 */
const letTag: TagContract = {
	block: false,
	seekable: true,
	tagName: "let",
	noNewLine: true,
	compile(parser: any, buffer: any, token: any) {
		const { filename } = token;
		const declaration = parser.utils.generateAST(`let ${token.properties.jsArg}`, token.loc, filename);
		const parsed = declaration.type === "VariableDeclaration" ? declaration.declarations[0] : undefined;
		if (!parsed) {
			// `@let(= 1)`: JavaScript reads `let = 1` as setting a variable named `let`.
			const first = token.properties.jsArg.trim();
			const found = first === "" ? "end of input" : `\`${/^[A-Za-z_$][\w$]*/.exec(first)?.[0] ?? first[0]}\``;
			unallowed(`invalid @let arguments: expected an identifier but found ${found}`, filename, { line: token.loc.start.line, col: token.loc.start.col });
		}
		const key = parsed.id;
		if (!["Identifier", "ObjectPattern", "ArrayPattern"].includes(key.type)) unallowed("Invalid variable name for the @let tag", filename, parser.utils.getExpressionLoc(key));
		if (!parsed.init) unallowed("invalid @let arguments: expected `=`", filename, { line: token.loc.start.line, col: token.loc.start.col });
		const value = parser.utils.stringify(parser.utils.transformAst(parsed.init, filename, parser));
		for (const name of paramNames(key)) parser.stack.defineVariable(name);
		buffer.writeExpression(`var ${parser.utils.stringify(key)} = ${value}`, filename, token.loc.start.line);
	},
};

let lists = 0;

/**
 * `@each`, as 0.7 had it: with `$loop` (`index`, `total`, `first`, `last`, edge.js's `isFirst` and `isLast`, `isOdd`, `isEven`),
 * which edge.js 6 doesn't have, and the list read once, where edge.js reads it again for `@else`.
 */
const eachTag: TagContract = {
	block: true,
	seekable: true,
	tagName: "each",
	compile(parser: any, buffer: any, token: any) {
		const { filename } = token;
		const line = token.loc.start.line;
		const { expression } = parser.utils.generateAST(token.properties.jsArg, token.loc, filename);
		if (expression?.type !== "BinaryExpression") unallowed(`"${token.properties.jsArg}" is not valid expression for the @each tag`, filename, parser.utils.getExpressionLoc(expression ?? token));
		const left = expression.left;
		if (left.type !== "SequenceExpression" && left.type !== "Identifier") unallowed(`invalid left hand side "${left.type}" expression for the @each tag`, filename, parser.utils.getExpressionLoc(left));
		const names = left.type === "Identifier" ? [left] : left.expressions;
		for (const name of names) if (name.type !== "Identifier") unallowed(`"${name.type}" is not allowed as an identifier for @each tag`, filename, parser.utils.getExpressionLoc(name));
		const [item, index] = names.map((name: any) => name.name as string);
		const elseAt = token.children.findIndex((child: any) => child.type === "tag" && child.properties.name === "else");
		const otherwise = elseAt > -1 ? token.children.splice(elseAt) : [];
		const list = `$ssqchList${++lists}`;
		buffer.writeExpression(`const ${list} = ${parser.utils.stringify(parser.utils.transformAst(expression.right, filename, parser))}`, filename, line);
		if (otherwise.length) buffer.writeStatement(`if (template.size(${list})) {`, filename, line);
		const [awaiting, fn] = parser.asyncMode ? ["await ", "loopAsync"] : ["", "loop"];
		buffer.writeStatement(`${awaiting}template.ssqch.${fn}(${list}, ${parser.asyncMode ? "async " : ""}function (${item}, ${index ?? "$ssqchKey"}, $loop) {`, filename, line);
		parser.stack.defineScope();
		parser.stack.defineVariable(item);
		if (index) parser.stack.defineVariable(index);
		parser.stack.defineVariable("$loop");
		for (const child of token.children) parser.processToken(child, buffer);
		parser.stack.clearScope();
		buffer.writeExpression("})", filename, -1);
		if (otherwise.length) {
			for (const child of otherwise) parser.processToken(child, buffer);
			buffer.writeStatement("}", filename, -1);
		}
	},
};

