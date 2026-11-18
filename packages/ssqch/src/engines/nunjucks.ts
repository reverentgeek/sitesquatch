// Nunjucks and Jinja: `.njk`, and `.jinja` and `.j2` (ssqch's default template language), on
// ssqch's own fork of nunjucks (`vendor/nunjucks`; D1 in docs/node-migration.md). The library
// renders; what's ssqch's is around it: what 0.7's Jinja had that nunjucks hasn't (`jinja.ts`),
// includes from the site's and its themes' folders, the config's functions as filters, as
// globals and (in `.njk`) as tags, async functions (a render that makes a promise renders again
// once it's settled; see `render`), and errors that name the file and the line.
//
// The two flavors differ where 0.7's did, and where a site from Eleventy expects Nunjucks: `.njk`
// escapes `\` as `&#92;` and prints values as Nunjucks does (`true`, `a,b`, a compact `dump`);
// `.jinja` leaves `\` as it is and prints as Jinja does (`True`, `['a', 'b']`).
import fs from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import type { Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { describeThrown, watchSettle } from "../modules.ts";
import { closest, closestPath } from "../suggest.ts";
import * as voice from "../voice.ts";
import type { EngineEnv, RenderContext, TemplateEngine } from "./engine.ts";
import { JINJA_ESCAPE, JinjaError, escapeJinja, installRuntime, jinjaFilters, jinjaGlobals, jinjaTests, markdownAttributes, njkString, pyString, siteArgs } from "./jinja.ts";

/** `.njk` (Nunjucks' escaping and the config's functions as tags) or `.jinja` and `.j2`. */
export type Flavor = "njk" | "jinja";

// ---- a render's calls ------------------------------------------------------------------------

/** A call of a site's function in one render: what it was given, and what it gave. */
interface Call {
	name: string;
	args: unknown[];
	value?: unknown;
	error?: unknown;
	/** Settled into `value` or `error`, for a function that answered with a promise. */
	promise?: Promise<void>;
}

/** One synchronous render of a template: its calls in order, and the last render's to give back. */
class Pass {
	calls: Call[] = [];
	promises: Promise<void>[] = [];
	private before = new Map<string, Call[]>();
	constructor(previous?: Call[]) {
		for (const c of previous ?? []) {
			let list = this.before.get(c.name);
			if (!list) this.before.set(c.name, (list = []));
			list.push(c);
		}
	}
	/** The last render's call with these arguments, the first one not given back yet. */
	take(name: string, args: unknown[]): Call | undefined {
		const list = this.before.get(name);
		if (!list) return undefined;
		const at = list.findIndex((c) => sameArgs(c.args, args));
		return at === -1 ? undefined : list.splice(at, 1)[0];
	}
}

/** The render that's running (renders are synchronous; one can start inside another, for `templateContent`). */
let current: Pass | undefined;
/** How many times a template renders for its async functions before it's an error. */
const MAX_ROUNDS = 10;

/** A site's function, called in the render that's running: what it gave last time if it ran then, or what it gives now. */
function callSite(name: string, fn: Filter, args: unknown[], root: string): unknown {
	const pass = current;
	const kept = pass?.take(name, args);
	if (kept) {
		pass!.calls.push(kept);
		if ("error" in kept) throw kept.error;
		return kept.value;
	}
	const thrown = (e: unknown) => (e instanceof BuildError && e.message.startsWith(`${name}(): `) ? e : new BuildError(`${name}(): ${describeThrown(e, root)}`));
	let out: unknown;
	try {
		// `this` is nothing, as in 0.7, so a stack frame says `at shout`.
		out = fn.apply(undefined, args);
	} catch (e) {
		const error = thrown(e);
		pass?.calls.push({ name, args, error });
		throw error;
	}
	if (out instanceof Promise && pass) {
		const c: Call = { name, args };
		c.promise = watchSettle(out).then((value) => { c.value = value; }, (e) => { c.error = thrown(e); });
		pass.calls.push(c);
		pass.promises.push(c.promise);
		return undefined;
	}
	pass?.calls.push({ name, args, value: out });
	return out;
}

/** Whether two calls had the same arguments: the same values, or lists and dicts of them (a template makes new ones each time). */
function sameArgs(a: unknown[], b: unknown[]): boolean {
	return a.length === b.length && a.every((v, i) => same(v, b[i], 0));
}
function same(a: unknown, b: unknown, depth: number): boolean {
	if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
	if (depth > 8 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (a instanceof SafeString || b instanceof SafeString) return a instanceof SafeString && b instanceof SafeString && String(a) === String(b);
	if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i], depth + 1));
	if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
}

// ---- include loops ----------------------------------------------------------------------------

/** How deep includes go before it's a loop, as in 0.7 and Edge. */
const MAX_DEPTH = 64;
/** The templates being rendered, outermost first, with the names they were included by. */
const trail: string[] = [];
/** Each environment's names for its includes' files. */
const includeNames = new WeakMap<object, Map<string, string>>();
{
	const Template = nunjucks.Template as unknown as { prototype: { render(...args: unknown[]): unknown; path?: string; env?: object } };
	const render = Template.prototype.render;
	Template.prototype.render = function (this: { path?: string; env?: object }, ...args: unknown[]) {
		const name = (this.env && this.path && includeNames.get(this.env)?.get(this.path)) || path.basename(this.path ?? "");
		if (trail.length >= MAX_DEPTH) {
			// The loop from the last time this one was in the trail, as Edge says it.
			const at = trail.lastIndexOf(name);
			throw new JinjaError(`${voice.PASSED_THIS_TREE}. Include loop: ${[...trail.slice(at === -1 ? Math.max(trail.length - 3, 0) : at), name].join(" -> ")}`);
		}
		trail.push(name);
		try {
			return render.apply(this, args);
		} finally {
			trail.pop();
		}
	};
}

const TAGS = /\{[{%#]/;
const MARKDOWN = /\.(?:md|markdown)$/i;
const SafeString = nunjucks.runtime.SafeString;
const STRICT = "attempted to output null or undefined value";

export function nunjucksEngine(env: EngineEnv, flavor: Flavor = "njk"): TemplateEngine {
	installRuntime();
	const root = env.config.root;
	const loaded = new Set<string>();
	const sources = new Map<string, { src: string; path: string; noCache: boolean } | null>();
	/** An include's name, by its file: errors in it name it as the template that included it did. */
	const names = new Map<string, string>();

	// Includes, imports and extends: plain paths inside the site's includes folder, then each theme's.
	const Loader = (nunjucks.Loader as any).extend({
		getSource(name: string) {
			if (sources.has(name)) return sources.get(name);
			const plain = !path.isAbsolute(name) && !name.split(/[/\\]/).some((part) => part === ".." || part === "");
			const found = plain ? env.includeDirs.map((dir) => path.join(dir, name)).find((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile()) : undefined;
			if (found) {
				loaded.add(name.replaceAll("\\", "/"));
				names.set(found, name.replaceAll("\\", "/"));
			}
			const source = found ? { src: fs.readFileSync(found, "utf8"), path: found, noCache: false } : null;
			sources.set(name, source);
			return source;
		},
	});
	const loader = new Loader();
	// `dev` keeps nunjucks' own error, with its line and what was thrown, instead of a copy of its message.
	const njk = new nunjucks.Environment(loader, { autoescape: true, throwOnUndefined: env.strict, dev: true } as nunjucks.ConfigureOptions);
	includeNames.set(njk, names);
	const escape = flavor === "jinja" ? escapeJinja : (nunjucks.lib as unknown as { escape(s: string): string }).escape;
	if (flavor === "jinja") (njk as unknown as { opts: { autoescape: unknown } }).opts.autoescape = JINJA_ESCAPE;
	for (const [name, fn] of Object.entries(jinjaFilters(escape, flavor))) njk.addFilter(name, fn);
	for (const [name, fn] of Object.entries(jinjaTests(njk))) (njk as unknown as { addTest(name: string, fn: unknown): void }).addTest(name, fn);
	for (const [name, value] of Object.entries(jinjaGlobals())) njk.addGlobal(name, value);

	// The config's functions, as filters (`{{ title | shout }}`) and as functions
	// (`{{ shout(title) }}`). A call goes through `call`, which keeps what it gave for the render
	// that's running (see `Pass`): that's how an async function's answer reaches the template.
	const functions = new Map<string, Filter>([...env.pipeFilters, ...env.globals]);
	const call = (name: string, fn: Filter, args: unknown[]) => callSite(name, fn, siteArgs(args), root);
	for (const [name, fn] of functions) njk.addFilter(name, (...args: unknown[]) => call(name, fn, args));
	for (const [name, fn] of env.globals) njk.addGlobal(name, (...args: unknown[]) => call(name, fn, args));
	// `now()` is the build's time: kept like a site's function, so a render that runs again sees the same one.
	const now = () => new Date();
	njk.addGlobal("now", (...args: unknown[]) => call("now", now, args));

	// `{% image "/a.png", "A pine" %}` prints what `image("/a.png", "A pine")` returns, without
	// escaping it; with an `{% endimage %}`, the function gets what's between them first. Every
	// function is a tag (Nunjucks' own tags come first: `include` stays `include`), in `.njk` and
	// `.jinja` alike (0.7 had them in `.njk` only).
	if (env.globals.size) {
		const text = flavor === "njk" ? njkString : pyString;
		const value = (out: unknown) => (out === undefined || out === null ? "" : out instanceof SafeString ? out : new SafeString(text(out)));
		njk.addExtension("ssqchTags", {
			tags: [...env.globals.keys()],
			parse(parser: any, nodes: any) {
				const tok = parser.nextToken();
				const name: string = tok.value;
				const args = parser.parseSignature(null, true);
				parser.advanceAfterBlockEnd(name);
				// Paired when the template closes it anywhere, as in 0.7.
				const paired = new RegExp(`\\{%-?\\s*end${name}\\s*-?%\\}`).test(parser.tokens.str);
				args.children.unshift(new nodes.Literal(tok.lineno, tok.colno, name), new nodes.Literal(tok.lineno, tok.colno, paired));
				let body = null;
				if (paired) {
					body = parser.parseUntilBlocks(`end${name}`);
					parser.advanceAfterBlockEnd();
				}
				const node = new nodes.CallExtension(this, "run", args, body ? [body] : []);
				// Where the tag is, for an error its function throws (the fork reads it).
				Object.assign(node, { lineno: tok.lineno, colno: tok.colno });
				return node;
			},
			run(_context: unknown, name: string, paired: boolean, ...args: any[]) {
				if (paired) args.unshift(String(args.pop()()));
				return value(call(name, env.globals.get(name)!, args));
			},
		} as unknown as nunjucks.Extension);
	}

	const compiled = new Map<string, any>();
	const template = (source: string, ctx: RenderContext) => {
		const kept = ctx.cacheKey === undefined ? undefined : compiled.get(ctx.cacheKey);
		if (kept) return kept;
		const made = new nunjucks.Template(MARKDOWN.test(ctx.inputPath) ? markdownAttributes(source) : source, njk, ctx.inputPath, true);
		if (ctx.cacheKey !== undefined) compiled.set(ctx.cacheKey, made);
		return made;
	};
	const fail = (e: unknown, source: string, ctx: RenderContext): never => {
		throw new BuildError(describe(e, source, ctx, { env, njk, names, sources }));
	};

	/**
	 * Renders synchronously, as nunjucks does. A function that answers with a promise gives
	 * `undefined` for now; then, once every promise this render made is settled, the template
	 * renders again, and each call gets what it gave the first time (the async ones what they
	 * settled to), so no function runs twice. So an async function works anywhere: in a macro,
	 * a `{% set %}` block, `{% filter %}`, `map()`, an `{% if %}`. A render that makes no promise
	 * is a string, at once, whatever other pages do.
	 */
	const render = (source: string, data: Data, ctx: RenderContext, previous?: Call[], round = 1): string | Promise<string> => {
		const pass = new Pass(previous);
		const outer = current;
		current = pass;
		let out: string | undefined, failure: unknown, failed = false;
		try {
			out = template(source, ctx).render(data);
		} catch (e) {
			failed = true;
			failure = e;
		} finally {
			current = outer;
		}
		// What failed while a promise was outstanding may have failed for want of its answer.
		if (!pass.promises.length) return failed ? fail(failure, source, ctx) : out!;
		if (round >= MAX_ROUNDS) return Promise.reject(new BuildError(`${ctx.name}: its async functions kept asking for more: ${MAX_ROUNDS} renders, each with answers the one before didn't have`));
		return Promise.all(pass.promises).then(() => render(source, data, ctx, pass.calls, round + 1));
	};

	return {
		render(source, data, ctx) {
			if (!TAGS.test(source)) return source;
			// A layout's `content` is already HTML, so `{{ content }}` prints it as it is.
			if (typeof data.content === "string") data = { ...data, content: new SafeString(data.content) };
			return render(source, data, ctx);
		},
		included: () => [...loaded],
	};
}

interface Where {
	env: EngineEnv;
	njk: nunjucks.Environment;
	names: Map<string, string>;
	sources: Map<string, { src: string } | null>;
}

/**
 * Nunjucks' error as ssqch says it: `page.njk:3: unknown filter \`upcase\` (did you mean
 * \`upper\`?)`, naming the template it happened in (an include by the name it was included
 * by) and the line, counted from the template's body.
 */
function describe(e: unknown, source: string, ctx: RenderContext, at: Where): string {
	if (e instanceof BuildError) return e.message;
	const err = (e ?? {}) as { message?: unknown; lineno?: number; colno?: number; cause?: unknown };
	let message = String(err.message ?? e);
	// `(page path)\n (include path) [Line 2, Column 7]\n  Error: what happened`: the template with
	// the line is where it happened; without one, the last one named.
	const places: Array<{ file: string; line?: number }> = [];
	for (;;) {
		const place = /^\(((?:[^()]|\([^()]*\))*)\)(?: \[Line (\d+)(?:, Column \d+)?\])?\s*/.exec(message);
		const label = /^(?:Template render error|[A-Za-z]*Error): (?=\()/.exec(message);
		if (place) places.push({ file: place[1], line: place[2] === undefined ? undefined : Number(place[2]) });
		else if (!label) break;
		message = message.slice((place ?? label)![0].length);
	}
	const where = places.find((p) => p.line !== undefined) ?? places[places.length - 1];
	const line = typeof err.lineno === "number" && err.lineno > 0 ? err.lineno : where?.line;
	const include = where === undefined ? undefined : at.names.get(where.file);
	const name = include ?? ctx.name;
	const text = include === undefined ? source : at.sources.get(include)?.src ?? source;
	const cause = err.cause;
	if (cause instanceof BuildError || cause instanceof JinjaError) message = cause.message;
	// What the parser found: an error with nothing thrown behind it (and not strict mode's).
	else if (cause === undefined && message !== STRICT && e instanceof (nunjucks.lib.TemplateError as unknown as typeof Error)) message = `syntax error: ${syntax(message, line === undefined ? "" : text.split("\n")[line - 1] ?? "", typeof err.colno === "number" ? err.colno : undefined)}`;
	else message = message.replace(/^(?:Template render error|[A-Za-z]*Error): /, "");

	const word = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const all = at.njk as unknown as { filters: Record<string, unknown>; tests: Record<string, unknown>; globals: Record<string, unknown> };
	let found: RegExpExecArray | null;
	if ((found = /^filter not found: (\S+)/.exec(message))) {
		const wanted = found[1];
		// Another generator's filter (`slug`, `absolute_url`): ssqch's way, instead of a guess from the spelling.
		const equivalent = equivalents.find(wanted, "filter");
		if (equivalent) message = `unknown filter \`${wanted}\`. ${equivalent.say}\n  More: ${equivalent.more}`;
		else message = `unknown filter \`${wanted}\`${meant(wanted, Object.keys(all.filters))}`;
	} else if ((found = /^test not found: (\S+)/.exec(message))) {
		message = `unknown test \`${found[1]}\`${meant(found[1], Object.keys(all.tests))}`;
	} else if ((found = /^Unable to call `([A-Za-z_$][\w$]*)`, which is undefined or falsey$/.exec(message))) {
		const functions = Object.keys(all.globals).filter((key) => typeof all.globals[key] === "function");
		message = `unknown function \`${found[1]}\`${meant(found[1], functions)}`;
	} else if ((found = /^Unable to call `(.+)\["([^"]+)"\]`, which is undefined or falsey$/.exec(message))) {
		message = `unknown method \`${found[2]}\` (\`${found[1].replaceAll("\"]", "").replaceAll("[\"", ".")}\` has no method of that name)`;
	} else if ((found = /^template not found: (.+)$/s.exec(message))) {
		const wanted = found[1].trim();
		const have = at.env.includeDirs.flatMap((dir) => filesUnder(dir));
		const near = closestPath(wanted, have);
		// `{% include %}` can't include it; `extends`, `import` and `from` name a template that isn't there.
		const tag = line === undefined ? "" : text.split("\n")[line - 1] ?? "";
		const including = new RegExp(`\\{%-?\\s*include\\s[^%]*["']${word(wanted)}["']`).test(tag) || (line === undefined && /\{%-?\s*include\b/.test(text));
		message = `template not found: ${including ? "can't include" : "no template named"} \`${wanted}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
	} else if (message === STRICT) {
		message = "printed an undefined value (strict is on)";
	}
	return `${name}${line === undefined ? "" : `:${line}`}: ${message}`;
}

/** Jinja's tags that nunjucks hasn't, and what to write instead. */
const UNSUPPORTED: Record<string, string> = {
	break: "`{% break %}` isn't supported: put the rest of the loop in an `{% if %}`, or filter the list first (`| selectattr`, `| select`)",
	continue: "`{% continue %}` isn't supported: put the rest of the loop in an `{% if %}`, or filter the list first (`| selectattr`, `| select`)",
	with: "`{% with %}` isn't supported: use `{% set %}` (a variable set inside a `{% for %}` or a macro stays there)",
	autoescape: "`{% autoescape %}` isn't supported: what's printed is always escaped, so print a value with `| safe` to keep its HTML",
};

/** The parser's message (what it found on `source`, the line it names) in ssqch's words, where they say more. */
function syntax(message: string, source: string, column?: number): string {
	const unknown = /^unknown block tag: (\w+)/.exec(message);
	if (unknown) return UNSUPPORTED[unknown[1]] ?? `unknown statement ${unknown[1]}`;
	// The file ended inside a block: the parser names the line of the tag that opened it.
	if (/end of file|got EOF/.test(message)) {
		const tag = (column === undefined ? undefined : /^\w+/.exec(source.slice(column - 1))?.[0]) ?? /\{%-?\s*(\w+)/.exec(source)?.[1];
		if (tag) return `the \`{% ${tag} %}\` here is never closed (\`{% end${tag} %}\` is missing before the end of the template)`;
	}
	return message;
}

/** ` (did you mean \`x\`?)`, or nothing. */
function meant(name: string, candidates: string[]): string {
	const near = closest(name, candidates.filter((c) => c !== name && !c.startsWith("__")));
	return near ? ` (did you mean \`${near}\`?)` : "";
}

/** Every file under `dir`, as paths from it with forward slashes. */
function filesUnder(dir: string, rel = ""): string[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
	return entries.flatMap((entry) => {
		const p = rel ? `${rel}/${entry.name}` : entry.name;
		return entry.isDirectory() ? filesUnder(dir, p) : [p];
	});
}
