// Nunjucks, for `.njk` and `.jinja` (ssqch's default template language; see D1 in
// docs/node-migration.md). The library itself renders; what's ssqch's is around it: includes from
// the site's and its themes' folders, the config's functions as filters and as globals, filters
// that turn out to be async, and errors that name the file and the line.
import fs from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import type { Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { describeThrown, watchSettle } from "../modules.ts";
import { closest, closestPath } from "../suggest.ts";
import type { EngineEnv, RenderContext, TemplateEngine } from "./engine.ts";

/** Nunjucks' own filters, for "did you mean". */
const BUILTIN_FILTERS = ["abs", "batch", "capitalize", "center", "default", "dictsort", "dump", "escape", "first", "float", "forceescape", "groupby", "indent", "int", "join", "last", "length", "list", "lower", "nl2br", "random", "reject", "rejectattr", "replace", "reverse", "round", "safe", "select", "selectattr", "slice", "sort", "string", "striptags", "sum", "title", "trim", "truncate", "upper", "urlencode", "urlize", "wordcount"];

/** What a synchronous filter throws when its function answered with a promise: the template is rendered again with that filter async. */
class NeedsAsync extends Error {
	filter: string;
	constructor(filter: string) {
		super(`ssqch-needs-async:${filter}`);
		this.filter = filter;
	}
}

const TAGS = /\{[{%#]/;

// A date prints as ISO 8601 (`2024-06-01T00:00:00.000Z`), as 0.7 printed it. JavaScript's own
// `String(date)` is in the machine's time zone, and a build's output may not depend on that.
const runtime = nunjucks.runtime as unknown as { suppressValue(value: unknown, autoescape: boolean): unknown; ssqch?: boolean };
if (!runtime.ssqch) {
	const suppressValue = runtime.suppressValue;
	runtime.suppressValue = (value, autoescape) => suppressValue(value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value, autoescape);
	runtime.ssqch = true;
}

export function nunjucksEngine(env: EngineEnv): TemplateEngine {
	const root = env.config.root;
	const loaded = new Set<string>();
	const sources = new Map<string, { src: string; path: string; noCache: boolean } | null>();

	// Includes, imports and extends: plain paths inside the site's includes folder, then each theme's.
	const Loader = (nunjucks.Loader as any).extend({
		getSource(name: string) {
			if (sources.has(name)) return sources.get(name);
			const plain = !path.isAbsolute(name) && !name.split(/[/\\]/).some((part) => part === ".." || part === "");
			const found = plain ? env.includeDirs.map((dir) => path.join(dir, name)).find((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile()) : undefined;
			if (found) loaded.add(name.replaceAll("\\", "/"));
			const source = found ? { src: fs.readFileSync(found, "utf8"), path: found, noCache: false } : null;
			sources.set(name, source);
			return source;
		},
	});
	const loader = new Loader();
	const njk = new nunjucks.Environment(loader, { autoescape: true, throwOnUndefined: env.strict });

	// A function is synchronous until it first answers with a promise. Then it becomes a
	// Nunjucks async filter, compiled templates are dropped, and that render runs again: sites
	// keep the synchronous path unless they use an async filter, and `ssqch.d.ts`'s "async
	// functions are awaited" holds even for a function that returns a promise without being
	// `async`.
	let generation = 0;
	const functions = new Map<string, Filter>([...env.pipeFilters, ...env.globals]);
	const thrown = (name: string, e: unknown) => (e instanceof NeedsAsync ? e : new BuildError(`${name}(): ${describeThrown(e, root)}`));
	const register = (name: string, fn: Filter, isAsync: boolean) => {
		if (isAsync) {
			njk.addFilter(name, function (this: unknown, ...args: any[]) {
				const done = args.pop() as (e: unknown, value?: unknown) => void;
				let out: unknown;
				try { out = fn.apply(this, args); } catch (e) { return done(thrown(name, e)); }
				watchSettle(Promise.resolve(out)).then((value) => done(null, value), (e) => done(thrown(name, e)));
			}, true);
		} else {
			njk.addFilter(name, function (this: unknown, ...args: any[]) {
				let out: unknown;
				try { out = fn.apply(this, args); } catch (e) { throw thrown(name, e); }
				if (out instanceof Promise) {
					// Nothing else will look at this promise: it's asked for again, as an async filter.
					out.catch(() => {});
					throw new NeedsAsync(name);
				}
				return out;
			});
		}
	};
	for (const [name, fn] of functions) register(name, fn, false);
	// Called as functions too: `{{ shout(title) }}`. (A function called this way can't be async.)
	for (const [name, fn] of env.globals) {
		njk.addGlobal(name, function (this: unknown, ...args: any[]) {
			try { return fn.apply(this, args); } catch (e) { throw thrown(name, e); }
		});
	}

	const compiled = new Map<string, { generation: number; template: any }>();
	const template = (source: string, ctx: RenderContext) => {
		const kept = ctx.cacheKey === undefined ? undefined : compiled.get(ctx.cacheKey);
		if (kept?.generation === generation) return kept.template;
		const made = new nunjucks.Template(source, njk, ctx.inputPath, true);
		if (ctx.cacheKey !== undefined) compiled.set(ctx.cacheKey, { generation, template: made });
		return made;
	};
	/** The filter that needs to be async, if that's what `e` says (Nunjucks wraps what a filter throws). */
	const needsAsync = (e: unknown): string | undefined => {
		if (e instanceof NeedsAsync) return e.filter;
		return /ssqch-needs-async:([^\s)]+)/.exec(String((e as Error)?.message ?? ""))?.[1];
	};
	const upgrade = (name: string) => {
		register(name, functions.get(name)!, true);
		generation++;
		(loader as any).cache = {};
	};

	const fail = (e: unknown, source: string, ctx: RenderContext): never => {
		throw new BuildError(describe(e, source, ctx, env, [...functions.keys()]));
	};
	const render = (source: string, data: Data, ctx: RenderContext): string | Promise<string> => {
		if (generation === 0) {
			try {
				return template(source, ctx).render(data);
			} catch (e) {
				const name = needsAsync(e);
				if (name === undefined) return fail(e, source, ctx);
				upgrade(name);
			}
		}
		// With an async filter in play, Nunjucks answers through a callback.
		const attempt = (): Promise<string> => new Promise<string>((resolve, reject) => {
			let made;
			try { made = template(source, ctx); } catch (e) { return reject(e); }
			made.render(data, (e: unknown, out: string) => (e ? reject(e) : resolve(out)));
		}).catch((e) => {
			const name = needsAsync(e);
			if (name === undefined) return fail(e, source, ctx);
			upgrade(name);
			return attempt();
		});
		return attempt();
	};

	return {
		render(source, data, ctx) {
			if (!TAGS.test(source)) return source;
			// A layout's `content` is already HTML, so `{{ content }}` prints it as it is.
			if (typeof data.content === "string") data = { ...data, content: new nunjucks.runtime.SafeString(data.content) };
			return render(source, data, ctx);
		},
		included: () => [...loaded],
	};
}

/**
 * Nunjucks' error as ssqch says it: `page.njk:3: unknown filter \`upcase\` (did you mean
 * \`upper\`?)`. Nunjucks gives a line for some errors and none for others (an unknown filter, a
 * filter that throws), so those are looked for in the source.
 */
function describe(e: unknown, source: string, ctx: RenderContext, env: EngineEnv, functions: string[]): string {
	if (e instanceof BuildError) return e.message;
	let message = String((e as Error)?.message ?? e);
	let line: number | undefined;
	// `(path) [Line 2, Column 7]\n  Template render error: (path)\n  Error: what happened`
	for (;;) {
		const place = /^\((?:[^()]|\([^()]*\))*\)(?: \[Line (\d+)(?:, Column \d+)?\])?\s*/.exec(message);
		const label = /^(?:Template render error|[A-Za-z]*Error): /.exec(message);
		if (place) {
			if (place[1] !== undefined) line = Number(place[1]);
			message = message.slice(place[0].length);
		} else if (label) message = message.slice(label[0].length);
		else break;
	}
	const lineOf = (pattern: RegExp): number | undefined => {
		const at = source.split("\n").findIndex((text) => pattern.test(text));
		return at === -1 ? undefined : at + 1;
	};
	const word = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let found = /^filter not found: (\S+)/.exec(message);
	if (found) {
		const name = found[1];
		line ??= lineOf(new RegExp(`\\|\\s*${word(name)}\\b`));
		// Another generator's filter (`slug`, `absolute_url`): ssqch's way, instead of a guess from the spelling.
		const equivalent = equivalents.find(name, "filter");
		if (equivalent) message = `unknown filter \`${name}\`. ${equivalent.say}\n  More: ${equivalent.more}`;
		else {
			const near = closest(name, [...BUILTIN_FILTERS, ...functions].filter((c) => c !== name));
			message = `unknown filter \`${name}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
		}
	} else if ((found = /^template not found: (.+)$/s.exec(message))) {
		const wanted = found[1].trim();
		line ??= lineOf(new RegExp(`["']${word(wanted)}["']`));
		const have = env.includeDirs.flatMap((dir) => filesUnder(dir));
		const near = closestPath(wanted, have);
		message = `template not found: can't include \`${wanted}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
	} else if ((found = /^([A-Za-z_$][\w$]*)\(\): /.exec(message))) {
		// A function of the site's threw: the first line that calls it.
		line ??= lineOf(new RegExp(`\\b${word(found[1])}\\b`));
	} else if (message === "attempted to output null or undefined value") {
		message = "printed an undefined value (strict is on)";
	}
	return `${ctx.name}${line === undefined ? "" : `:${line}`}: ${message}`;
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
