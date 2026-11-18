// Nunjucks and Jinja: `.njk`, and `.jinja` and `.j2` (ssqch's default template language), on
// ssqch's own fork of nunjucks (`vendor/nunjucks`; D1 in docs/node-migration.md). The library
// renders; what's ssqch's is around it: what 0.7's Jinja had that nunjucks hasn't (`jinja.ts`),
// includes from the site's and its themes' folders, the config's functions as filters, as
// globals and (in `.njk`) as tags, filters that turn out to be async, and errors that name the
// file and the line.
//
// The two flavors differ where 0.7's did: `.njk` escapes `\` as `&#92;`, as Nunjucks does, and
// has tags named after the config's functions; `.jinja` leaves `\` as it is, as Jinja does.
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
import { JINJA_ESCAPE, JinjaError, escapeJinja, installRuntime, jinjaFilters, jinjaGlobals, jinjaTests, markdownAttributes, pyString, siteArgs } from "./jinja.ts";

/** `.njk` (Nunjucks' escaping and the config's functions as tags) or `.jinja` and `.j2`. */
export type Flavor = "njk" | "jinja";

/** What a synchronous filter or tag throws when its function answered with a promise: the template is rendered again with it async. */
class NeedsAsync extends Error {
	filter: string;
	constructor(filter: string) {
		super(`ssqch-needs-async:${filter}`);
		this.filter = filter;
	}
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
	const escape = flavor === "jinja" ? escapeJinja : (nunjucks.lib as unknown as { escape(s: string): string }).escape;
	if (flavor === "jinja") (njk as unknown as { opts: { autoescape: unknown } }).opts.autoescape = JINJA_ESCAPE;
	for (const [name, fn] of Object.entries(jinjaFilters(escape))) njk.addFilter(name, fn);
	for (const [name, fn] of Object.entries(jinjaTests(njk))) (njk as unknown as { addTest(name: string, fn: unknown): void }).addTest(name, fn);
	for (const [name, value] of Object.entries(jinjaGlobals())) njk.addGlobal(name, value);

	// A function is synchronous until it first answers with a promise. Then it becomes a
	// Nunjucks async filter (or tag), compiled templates are dropped, and that render runs again:
	// sites keep the synchronous path unless they use an async filter, and `ssqch.d.ts`'s "async
	// functions are awaited" holds even for a function that returns a promise without being
	// `async`.
	let generation = 0;
	const functions = new Map<string, Filter>([...env.pipeFilters, ...env.globals]);
	const thrown = (name: string, e: unknown) => (e instanceof NeedsAsync ? e : new BuildError(`${name}(): ${describeThrown(e, root)}`));
	/** Calls a site's function, synchronously: a promise means it has to be async. */
	const callSync = (name: string, fn: Filter, self: unknown, args: unknown[]) => {
		let out: unknown;
		try { out = fn.apply(self, siteArgs(args)); } catch (e) { throw thrown(name, e); }
		if (out instanceof Promise) {
			// Nothing else will look at this promise: it's asked for again, async.
			out.catch(() => {});
			throw new NeedsAsync(name);
		}
		return out;
	};
	const callAsync = (name: string, fn: Filter, self: unknown, args: unknown[], done: (e: unknown, value?: unknown) => void) => {
		let out: unknown;
		try { out = fn.apply(self, siteArgs(args)); } catch (e) { return done(thrown(name, e)); }
		watchSettle(Promise.resolve(out)).then((value) => done(null, value), (e) => done(thrown(name, e)));
	};
	const register = (name: string, fn: Filter, isAsync: boolean) => {
		if (isAsync) {
			njk.addFilter(name, function (this: unknown, ...args: any[]) {
				const done = args.pop() as (e: unknown, value?: unknown) => void;
				callAsync(name, fn, this, args, done);
			}, true);
		} else {
			njk.addFilter(name, function (this: unknown, ...args: any[]) { return callSync(name, fn, this, args); });
		}
	};
	for (const [name, fn] of functions) register(name, fn, false);
	// Called as functions too: `{{ shout(title) }}`. (A function called this way can't be async.)
	for (const [name, fn] of env.globals) {
		njk.addGlobal(name, function (this: unknown, ...args: any[]) {
			try { return fn.apply(this, siteArgs(args)); } catch (e) { throw thrown(name, e); }
		});
	}

	// `{% image "/a.png", "A pine" %}` prints what `image("/a.png", "A pine")` returns, without
	// escaping it; with an `{% endimage %}`, the function gets what's between them first. Every
	// function is a tag (Nunjucks' own tags come first: `include` stays `include`).
	const asyncTags = new Set<string>();
	if (flavor === "njk" && env.globals.size) {
		const value = (out: unknown) => (out === undefined || out === null ? "" : out instanceof SafeString ? out : new SafeString(pyString(out)));
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
				const node = asyncTags.has(name) ? new nodes.CallExtensionAsync(this, "runAsync", args, body ? [body] : []) : new nodes.CallExtension(this, "run", args, body ? [body] : []);
				// Where the tag is, for an error its function throws (the fork reads it).
				Object.assign(node, { lineno: tok.lineno, colno: tok.colno });
				return node;
			},
			run(context: unknown, name: string, paired: boolean, ...args: any[]) {
				if (paired) args.unshift(String(args.pop()()));
				return value(callSync(name, env.globals.get(name)!, context, args));
			},
			runAsync(context: unknown, name: string, paired: boolean, ...args: any[]) {
				const done = args.pop() as (e: unknown, value?: unknown) => void;
				const go = () => callAsync(name, env.globals.get(name)!, context, args, (e, out) => (e ? done(e) : done(null, value(out))));
				if (!paired) return go();
				const body = args.pop() as (cb: (e: unknown, text?: string) => void) => void;
				body((e, text) => {
					if (e) return done(e);
					args.unshift(String(text));
					go();
				});
			},
		} as unknown as nunjucks.Extension);
	}

	const compiled = new Map<string, { generation: number; template: any }>();
	const template = (source: string, ctx: RenderContext) => {
		const kept = ctx.cacheKey === undefined ? undefined : compiled.get(ctx.cacheKey);
		if (kept?.generation === generation) return kept.template;
		const made = new nunjucks.Template(MARKDOWN.test(ctx.inputPath) ? markdownAttributes(source) : source, njk, ctx.inputPath, true);
		if (ctx.cacheKey !== undefined) compiled.set(ctx.cacheKey, { generation, template: made });
		return made;
	};
	/** The filter or tag that needs to be async, if that's what `e` says. */
	const needsAsync = (e: unknown): string | undefined => {
		if (e instanceof NeedsAsync) return e.filter;
		const cause = (e as { cause?: unknown })?.cause;
		if (cause instanceof NeedsAsync) return cause.filter;
		return /ssqch-needs-async:([^\s)]+)/.exec(String((e as Error)?.message ?? ""))?.[1];
	};
	const upgrade = (name: string) => {
		register(name, functions.get(name)!, true);
		asyncTags.add(name);
		generation++;
		(loader as any).cache = {};
	};

	const fail = (e: unknown, source: string, ctx: RenderContext): never => {
		throw new BuildError(describe(e, source, ctx, { env, njk, names, sources }));
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
			if (name === undefined || !functions.has(name)) return fail(e, source, ctx);
			upgrade(name);
			return attempt();
		});
		return attempt();
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
	const err = (e ?? {}) as { message?: unknown; lineno?: number; cause?: unknown };
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
	else if (cause === undefined && message !== STRICT && e instanceof (nunjucks.lib.TemplateError as unknown as typeof Error)) message = `syntax error: ${message.replace(/^unknown block tag: /, "unknown statement ")}`;
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
