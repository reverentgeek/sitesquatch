// Liquid, for `.liquid`: liquidjs itself. What's ssqch's is around it, as 0.7 had it (the liquid
// crate, `plugins/liquid`): includes from the site's and its themes' folders, Jekyll's
// `{% include nav.html section="home" %}`, the config's functions as filters, Jekyll's and
// Shopify's filters, 0.7's numbers and dates, and errors that name the file and the line.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type * as LiquidJs from "liquidjs";
import type { FS, Liquid } from "liquidjs";
import type { Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { isPlainObject } from "../data.ts";
import { BuildError, warn, warning } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { describeThrown, shownPath, watchSettle } from "../modules.ts";
import { closest, closestPath } from "../suggest.ts";
import type { EngineEnv, RenderContext, TemplateEngine } from "./engine.ts";
import { DateFormatError, showDate, strftime, toInstant } from "./liquid-date.ts";
import type { Instant } from "./liquid-date.ts";

/** What a filter throws in a synchronous render when its function answered with a promise: the template is rendered again, asynchronously. */
class NeedsAsync extends Error {}

/** The parts of a liquidjs error this engine reads. */
interface LiquidFailure {
	message?: string;
	originalError?: unknown;
	token?: { file?: string; input?: string; getPosition(): [number, number] };
}

/**
 * What the config's functions answered in one rendering of a template, in the order they were
 * called. A template that turns out to need a promise awaited renders again asynchronously, and
 * the calls it had made are answered from here, so each function runs once a page.
 */
interface Answers {
	calls: Array<{ fn: Filter; value: unknown }>;
	at: number;
}
const ANSWERS = Symbol("ssqch answers");

const TAGS = /\{[{%]/;

/** An include's name as it's written: Jekyll's include reads `"nav.html"` with its quotes, and `nav.html` without. */
const unquoted = (name: string) => name.replace(/^(["'])(.*)\1$/s, "$2");

export function liquidEngine(env: EngineEnv): TemplateEngine {
	const loaded = new Set<string>();
	// Made when the first Liquid template renders: setting liquidjs up takes a few milliseconds
	// the first time, which a site without Liquid shouldn't spend.
	let render: TemplateEngine["render"] | undefined;
	return {
		render(source, data, ctx) {
			if (!TAGS.test(source)) return source;
			render ??= liquidRenderer(env, loaded);
			return render(source, data, ctx);
		},
		included: () => [...loaded],
	};
}

/**
 * A number the liquid crate kept as a float though it's whole (`10.0`, `10 | times: 1.0`): it
 * divides exactly (`| divided_by: 4` is 2.5), where a whole number divides to a whole number.
 * liquidjs' own code reads it as the number (it's a Drop with `valueOf`). Made with liquidjs.
 */
interface LiquidFloat { n: number }
let FloatValue: (new (n: number) => LiquidFloat) | undefined;
const isFloat = (v: unknown): v is LiquidFloat => FloatValue !== undefined && v instanceof FloatValue;

// liquidjs is loaded when the first Liquid template renders, not when ssqch starts: most sites
// have none, and loading it takes about 5 ms. `require`, because rendering is synchronous.
let library: typeof LiquidJs | undefined;
function liquidjs(): typeof LiquidJs {
	if (library) return library;
	library = createRequire(import.meta.url)("liquidjs") as typeof LiquidJs;
	const { Drop, Tokenizer } = library;
	FloatValue = class extends Drop implements LiquidFloat {
		n: number;
		constructor(n: number) {
			super();
			this.n = n;
		}
		valueOf() { return this.n; }
		toString() { return String(this.n); }
	};
	// How liquidjs reads a template's literals, where 0.7's crate read them otherwise (ssqch's
	// own copy of liquidjs; nothing else uses it):
	const tokenizer = Tokenizer.prototype as any;
	// A number written with a decimal point is a float, however whole it is. Digits run into
	// letters (`1e3`, `2nd`) aren't a number or a name, where liquidjs would look up a variable.
	const readNumber = tokenizer.readNumber;
	tokenizer.readNumber = function (this: any) {
		const token = readNumber.call(this);
		if (token && token.getText().includes(".") && Number.isInteger(token.content)) token.content = new FloatValue!(token.content);
		if (!token) {
			const word = /^[+-]?\d[\w-]*/.exec(this.input.slice(this.p, this.N))?.[0];
			if (word && /[A-Za-z_]/.test(word)) throw this.error(`\`${word}\` isn't a number, and a variable's name starts with a letter`, this.p);
		}
		return token;
	};
	// A quoted string is the text between its quotes: `"a\nb"` is a backslash and an `n`.
	const readQuoted = tokenizer.readQuoted;
	tokenizer.readQuoted = function (this: any) {
		const token = readQuoted.call(this);
		if (token) token.content = token.getText().slice(1, -1);
		return token;
	};
	// A `|` with no filter after it (`{{ title | }}`) is a mistake, as in 0.7, not nothing.
	const readFilter = tokenizer.readFilter;
	tokenizer.readFilter = function (this: any) {
		const from = this.p;
		const filter = readFilter.call(this);
		if (!filter && this.input.slice(from, this.p).includes("|")) throw this.error("expected a filter's name after `|`", from);
		return filter;
	};
	return library;
}

/** liquidjs, set up for the site; it adds the includes it reads to `loaded`. */
function liquidRenderer(env: EngineEnv, loaded: Set<string>): TemplateEngine["render"] {
	const { Liquid, IfTag, IncludeTag, UnlessTag, Tag, Hash, TypeGuards, evalToken } = liquidjs();
	const root = env.config.root;
	const isFile = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
	// Each include's file by its text: some of liquidjs' errors (a variable `strict` refuses) carry
	// the template's text but not its file.
	const includes = new Map<string, string>();
	const read = (file: string) => {
		const dir = env.includeDirs.find((d) => isInsideDir(d, file));
		if (dir) loaded.add(path.relative(dir, file).split(path.sep).join("/"));
		const text = fs.readFileSync(file, "utf8");
		includes.set(text, file);
		return text;
	};
	// Includes come from the includes folders only, as in 0.7: the name as it is, or with
	// `.liquid` added when there's no file by that name.
	const files: FS = {
		exists: async (file) => isFile(file),
		existsSync: isFile,
		readFile: async (file) => read(file),
		readFileSync: read,
		resolve(dir, file, ext) {
			const full = path.resolve(dir, unquoted(file));
			return isFile(full) || full.endsWith(ext) ? full : full + ext;
		},
		contains: async (dir, file) => isInsideDir(dir, file),
		containsSync: isInsideDir,
		dirname: path.dirname,
		sep: path.sep,
	};
	const liquid = new Liquid({
		root: env.includeDirs,
		partials: env.includeDirs,
		layouts: env.includeDirs,
		extname: ".liquid",
		fs: files,
		cache: true,
		// Jekyll's include, as in 0.7: `{% include nav.html section="home" %}` passes `include.section`,
		// and a name without quotes is the file's own (liquidjs would otherwise read it as a variable).
		jekyllInclude: true,
		// An unknown filter is an error, as in 0.7 (liquidjs would print the value as it is).
		strictFilters: true,
		strictVariables: env.strict,
		// A date prints as 0.7 printed it (`2026-01-02 00:00:00 +0000`), not in the machine's time zone.
		outputEscape: printable as (v: unknown) => string,
	});

	// Jekyll's include takes `name=value` and nothing else, as 0.7's did: liquidjs would read
	// `a: 1` as `a` being true, and pass over `with x` and `for x`.
	liquid.registerTag("include", class extends IncludeTag {
		constructor(token: any, remain: any, liquid: any, parser: any) {
			const rest = String(token.args).replace(/^\s*(?:"[^"]*"|'[^']*'|\S+)/, "").replace(/"[^"]*"|'[^']*'/g, "\"\"");
			if (/^\s*(?:with|for)\b/.test(rest)) throw new BuildError("Jekyll's include takes `name=value` arguments, not `with` or `for`");
			if (/[\w-]\s*:/.test(rest)) throw new BuildError("expected \"=\" to be used for the assignment (Jekyll's include takes `name=value`)");
			super(token, remain, liquid, parser);
		}
	});
	// Jekyll's `{% include_relative part.md lang="fr" %}` (osg #8): a file beside the template that
	// has the tag, not in `_includes`, rendered with the page's variables and `include.lang`. As in
	// Jekyll, the name can have `{{ }}` in it, and can't go up a folder.
	const relative = new Map<string, any[]>();
	liquid.registerTag("include_relative", class extends Tag {
		file: string;
		hash: any;
		from: string;
		constructor(token: any, remain: any[], engine: any) {
			super(token, remain, engine);
			const tk = this.tokenizer as any;
			tk.skipBlank();
			const begin = tk.p;
			const quoted = tk.readQuoted();
			if (quoted) this.file = quoted.content;
			else {
				// Up to a space, reading `{{ p }}` whole.
				while (!tk.end() && !/\s/.test(tk.peek())) {
					if (tk.input.startsWith("{{", tk.p)) {
						const close = tk.input.indexOf("}}", tk.p);
						if (close === -1) throw tk.error("include_relative: `{{` without `}}` in the file name");
						tk.p = close + 2;
					} else tk.advance();
				}
				this.file = tk.input.slice(begin, tk.p);
			}
			if (!this.file) throw tk.error("include_relative needs a file name (`{% include_relative part.md %}`)");
			this.hash = new Hash(tk, true);
			const file = token.file ?? "";
			this.from = path.dirname(path.isAbsolute(file) ? file : path.resolve(root, file));
		}
		*render(ctx: any, emitter: any): Generator<unknown, void, unknown> {
			const r = (this.liquid as any).renderer;
			let name = this.file;
			if (name.includes("{{")) name = String(yield r.renderTemplates((this.liquid as any).parse(name), ctx));
			if (name.split(/[\\/]/).includes("..")) throw new BuildError(`include_relative "${name}": the file has to be in the template's folder or below it, without ".."`);
			const file = path.resolve(this.from, name);
			let templates = relative.get(file);
			if (!templates) {
				if (!isFile(file)) throw new BuildError(`include_relative "${name}": ${path.relative(root, file).split(path.sep).join("/")} not found (it's read beside the template, not in _includes)`);
				const text = fs.readFileSync(file, "utf8");
				includes.set(text, file);
				templates = (this.liquid as any).parse(text, file) as any[];
				relative.set(file, templates);
			}
			const include = yield this.hash.render(ctx);
			ctx.push({ include });
			try { emitter.write(yield r.renderTemplates(templates, ctx)); } finally { ctx.pop(); }
		}
	});

	// With `strict` on, a missing variable fails everywhere 0.7's did: in a comparison, `case`,
	// `assign` and `default`. Only an `if` or `unless` that asks whether it's there (`{% if nope
	// %}`, `{% if a and b %}`) stays false, as it did in 0.7.
	if (env.strict) {
		const existence = (value: any) => value.filters.length === 0 && value.initial.postfix.every((t: any) => !TypeGuards.isOperatorToken(t) || ["and", "or", "not"].includes(t.operator));
		const lenientWhereAsked = (branches: any[]) => {
			for (const { value } of branches) {
				if (!existence(value)) continue;
				const evaluate = value.value.bind(value);
				value.value = (ctx: unknown) => evaluate(ctx, true);
			}
		};
		liquid.registerTag("if", class extends IfTag { constructor(...args: any[]) { super(...(args as [any, any, any, any])); lenientWhereAsked((this as any).branches); } });
		liquid.registerTag("unless", class extends UnlessTag { constructor(...args: any[]) { super(...(args as [any, any, any, any])); lenientWhereAsked((this as any).branches); } });
	}

	// A block that only sets variables writes nothing, as in Ruby's Liquid (`Block#blank?`): an
	// `if` or `for` whose bodies are whitespace, `assign`, `capture` and comments still runs, but
	// its whitespace isn't written. liquidjs (and 0.7) wrote it, so Jekyll layouts that compute in
	// blocks came out with runs of blank lines (osg #7). Outside a block, whitespace is written.
	const BLANK_TAGS = new Set(["assign", "capture", "comment", "#"]);
	const isBlank = (templates: any[] | undefined): boolean => (templates ?? []).every((t) => {
		if (t.blankBlock === true) return true;
		if (typeof t.name === "string") return BLANK_TAGS.has(t.name);
		return typeof t.str === "string" && /^\s*$/.test(t.str);
	});
	const discard = { write() {}, buffer: "" };
	for (const name of ["if", "unless", "for", "case"]) {
		const Base = (liquid.tags as Record<string, any>)[name];
		liquid.registerTag(name, (class extends Base {
			blankBlock: boolean;
			constructor(...args: any[]) {
				super(...args);
				const self = this as any;
				this.blankBlock = isBlank(self.templates) && isBlank(self.elseTemplates) && (self.branches ?? []).every((b: any) => isBlank(b.templates));
			}
			*render(ctx: any, emitter: any): Generator<unknown, unknown, unknown> {
				return yield super.render(ctx, this.blankBlock ? discard : emitter);
			}
		}) as any);
	}

	// liquidjs' own filters turn a value into text with `String()`: a date as the machine's time
	// zone gives it, a float as a plain number. They get 0.7's text for a date (`2026-01-02
	// 00:00:00 +0000`) and the number for a float, in a list too. JSON is JSON's.
	for (const [name, impl] of Object.entries(liquid.filters as Record<string, any>)) {
		if (["json", "jsonify", "inspect"].includes(name)) continue;
		const handler = typeof impl === "function" ? impl : impl.handler;
		liquid.registerFilter(name, { ...(typeof impl === "function" ? {} : impl), handler(this: unknown, input: unknown, ...args: unknown[]) { return handler.call(this, asText(input), ...args.map(asText)); } });
	}

	// Dates are formatted in UTC with English names, whatever the machine's settings (see
	// liquid-date.ts). A value that isn't a date comes back as it is, as in 0.7.
	const dateFilter = (format: (when: Instant, args: unknown[]) => string | undefined) => (input: unknown, ...args: unknown[]) => {
		const when = toInstant(input);
		if (when === undefined) return input;
		try {
			return format(when, args) ?? input;
		} catch (e) {
			if (e instanceof DateFormatError) throw new BuildError(`Invalid date-format string: ${args[0]}`);
			throw e;
		}
	};
	liquid.registerFilter("date", dateFilter((when, [format]) => (format === undefined || format === null || String(format) === "" ? undefined : strftime(when, String(format)))));
	liquid.registerFilter("date_to_xmlschema", dateFilter((when) => strftime(when, "%Y-%m-%dT%H:%M:%S%:z")));
	liquid.registerFilter("date_to_rfc822", dateFilter((when) => strftime(when, "%a, %d %b %Y %H:%M:%S %z")));
	const dateString = (month: string) => dateFilter((when, [type, style]) => {
		if (type !== "ordinal") return strftime(when, `%d ${month} %Y`);
		const day = Number(strftime(when, "%-d"));
		const nth = `${day}${ordinal(day)}`;
		return style === "US" ? strftime(when, `${month} ${nth}, %Y`) : strftime(when, `${nth} ${month} %Y`);
	});
	// Jekyll's filters as Jekyll writes them (opensource.guide's search index and language menus):
	// `xml_escape` is Ruby's `encode(xml: :attr)` (`'` is `&apos;`, where liquidjs writes `&#39;`),
	// `normalize_whitespace` folds ASCII whitespace only (Ruby's `\s`) and trims, and `sort` of an
	// object sorts its `[key, value]` pairs by key, as Ruby's `Hash#sort` (liquidjs gives nothing
	// useful for one).
	const XML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" };
	liquid.registerFilter("xml_escape", (input: unknown) => (input === undefined || input === null ? "" : text(input).replace(/[&<>"']/g, (c) => XML[c])));
	liquid.registerFilter("normalize_whitespace", (input: unknown) => text(input ?? "").replace(/[ \t\n\v\f\r]+/g, " ").replace(/^ | $/g, ""));
	const liquidSort = liquid.filters.sort as any;
	const sortHandler = typeof liquidSort === "function" ? liquidSort : liquidSort.handler;
	liquid.registerFilter("sort", function (this: unknown, input: unknown, ...args: unknown[]) {
		if (isPlainObject(input) && args.length === 0) return Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return sortHandler.call(this, input, ...args);
	});
	liquid.registerFilter("date_to_string", dateString("%b"));
	liquid.registerFilter("date_to_long_string", dateString("%B"));
	for (const [name, fn] of Object.entries(MATH)) liquid.registerFilter(name, fn);
	for (const [name, fn] of Object.entries(TEXT)) liquid.registerFilter(name, fn);
	fastWhere(liquid);

	// The config's functions as filters: `{{ x | wrap: "[", "]" }}` calls `wrap(x, "[", "]")`, and
	// keyword arguments (`| f: size: 2`) arrive as one object at the end. A value that isn't there
	// arrives as `null`, as in 0.7. A function is awaited when it answers with a promise; until one
	// does, templates render synchronously.
	const functions = new Map<string, Filter>([...env.pipeFilters, ...env.globals]);
	/**
	 * Calls a config function for a filter or a tag. A render that ran before (asynchronously)
	 * gets each call's earlier answer; a promise in a synchronous render starts it again async.
	 */
	const invoke = (context: any, name: string, fn: Filter, args: unknown[]): unknown => {
		const answers: Answers | undefined = context?.globals?.[ANSWERS];
		const at = answers ? answers.at++ : -1;
		const known = answers?.calls[at];
		if (known?.fn === fn) return known.value;
		let out: unknown;
		try { out = fn(...args); } catch (e) { throw thrown(name, e, root); }
		if (out instanceof Promise) {
			const settled = watchSettle(out).catch((e) => { throw thrown(name, e, root); });
			answers?.calls.splice(at, Infinity, { fn, value: settled });
			if (context?.sync) {
				settled.catch(() => {});
				throw new NeedsAsync();
			}
			return settled;
		}
		answers?.calls.splice(at, Infinity, { fn, value: out });
		return out;
	};
	for (const [name, fn] of functions) {
		liquid.registerFilter(name, function (this: any, input: unknown, ...rest: unknown[]) {
			const args: unknown[] = [given(input)];
			let options: Data | undefined;
			rest.forEach((arg, i) => {
				if (Array.isArray(this.token?.args?.[i]) && Array.isArray(arg)) (options ??= {})[arg[0]] = given(arg[1]);
				else args.push(given(arg));
			});
			if (options) args.push(options);
			return invoke(this.context, name, fn, args);
		});
	}

	// The config's functions as tags too, as in Nunjucks: `{% seo %}` prints what `seo()` returns,
	// unescaped (Jekyll's jekyll-seo-tag, osg #6). Arguments are values, by commas or spaces, and
	// `name: value` or Jekyll's `name=value` arrive as one object at the end (`{% seo title=false
	// %}` calls `seo({ title: false })`). With an `{% endname %}`, the function gets what's between
	// them first. Liquid's own tags keep their names: a function `include` is a filter only.
	for (const [name, fn] of functions) {
		if (name in liquid.tags) continue;
		liquid.registerTag(name, class extends Tag {
			values: any[] = [];
			named: Array<[string, any]> = [];
			templates: any[] | undefined;
			constructor(token: any, remain: any[], engine: any, parser: any) {
				super(token, remain, engine);
				const tk = this.tokenizer as any;
				for (;;) {
					tk.skipBlank();
					if (tk.peek() === ",") { tk.advance(); tk.skipBlank(); }
					if (tk.end()) break;
					const start = tk.p;
					const key = tk.readIdentifier();
					tk.skipBlank();
					const sep = tk.peek();
					if (key.content && (sep === ":" || (sep === "=" && tk.input[tk.p + 1] !== "="))) {
						tk.advance();
						this.named.push([key.content, tk.readValueOrThrow()]);
						continue;
					}
					tk.p = start;
					const value = tk.readValue();
					if (!value && tk.peek() === "|") throw tk.error(`a filter can't go in {% ${name} %}'s arguments ("${tk.remaining().trim()}"): \`assign\` the value first, then pass the variable`);
					if (!value) throw tk.error(`expected a value in {% ${name} %}'s arguments, at "${tk.remaining()}"`);
					this.values.push(value);
				}
				// Paired when the template closes it, as in Nunjucks.
				if (remain.some((t) => TypeGuards.isTagToken(t) && t.name === `end${name}`)) {
					this.templates = [];
					while (remain.length) {
						const next = remain.shift();
						if (TypeGuards.isTagToken(next) && next.name === `end${name}`) break;
						this.templates.push(parser.parseToken(next, remain));
					}
				}
			}
			*render(ctx: any, emitter: any): Generator<unknown, void, unknown> {
				const args: unknown[] = [];
				if (this.templates) args.push(yield (this.liquid as any).renderer.renderTemplates(this.templates, ctx));
				for (const value of this.values) args.push(given(yield evalToken(value, ctx)));
				if (this.named.length) {
					const options: Data = {};
					for (const [key, value] of this.named) options[key] = given(yield evalToken(value, ctx));
					args.push(options);
				}
				const out = yield invoke(ctx, name, fn, args);
				emitter.write(tagText(out));
			}
			*children(): Generator<unknown, any[], unknown> { return this.templates ?? []; }
		});
	}
	const filterNames = () => Object.keys(liquid.filters);

	const compiled = new Map<string, ReturnType<Liquid["parse"]>>();
	/** Templates that needed a promise awaited once: they render asynchronously from then on. */
	const isAsync = new Set<string>();
	const fail = (e: unknown, ctx: RenderContext): never => {
		throw new BuildError(describe(e, ctx, env, filterNames(), includes));
	};
	// Jekyll's templates read front matter through `page` (`page.title`); in ssqch it's at the top
	// level, and `page` has the file's facts. Reading a key `page` lacks and the front matter has
	// says the rename once, for the whole build (osg #5; decided against a fallback, so `page`
	// means the same in every engine).
	const told = new Set<string>();
	const watched = (data: Data, ctx: RenderContext): Data => {
		const page = data.page;
		if (!isPlainObject(page) || told.size >= 20) return data;
		const look = (key: string | symbol) => {
			if (typeof key !== "string" || told.has(key) || Object.hasOwn(page, key) || !Object.hasOwn(data, key) || data[key] === undefined) return;
			told.add(key);
			// The page, not the template: the read can be in a layout or an include.
			const shown = typeof page.inputPath === "string" ? page.inputPath.replace(/^\.\//, "") : path.relative(root, path.resolve(root, ctx.inputPath)).split(path.sep).join("/");
			warn(warning("template", `rendering ${shown}: \`page.${key}\` is empty: in ssqch, front matter is at the top level, so it's \`${key}\` (\`page\` has the page's url, inputPath, date and headings). Said once for each name.`, { file: shown }));
		};
		const proxy = new Proxy(page, {
			getOwnPropertyDescriptor(target, key) { look(key); return Reflect.getOwnPropertyDescriptor(target, key); },
			get(target, key, receiver) { if (!(key in target)) look(key); return Reflect.get(target, key, receiver); },
		});
		return { ...data, page: proxy };
	};
	return (source, given, ctx) => {
		const data = watched(given, ctx);
		let templates = ctx.cacheKey === undefined ? undefined : compiled.get(ctx.cacheKey);
		if (!templates) {
			try { templates = liquid.parse(source, ctx.inputPath); } catch (e) { return fail(e, ctx); }
			if (ctx.cacheKey !== undefined) compiled.set(ctx.cacheKey, templates);
		}
		const answers: Answers = { calls: [], at: 0 };
		const options = { globals: { [ANSWERS]: answers } };
		const later = () => {
			answers.at = 0;
			return liquid.render(templates, data, options).then((out: unknown) => String(out), (e: unknown) => fail(e, ctx));
		};
		if (ctx.cacheKey !== undefined && isAsync.has(ctx.cacheKey)) return later();
		try {
			return String(liquid.renderSync(templates, data, options));
		} catch (e) {
			if (!needsAsync(e)) return fail(e, ctx);
		}
		if (ctx.cacheKey !== undefined) isAsync.add(ctx.cacheKey);
		return later();
	};
}

/** What a function threw, naming it (`boom(): the snack drawer is empty`, then the site's frames). */
const thrown = (name: string, e: unknown, root: string) => (e instanceof BuildError && e.message.startsWith(`${name}(): `) ? e : new BuildError(`${name}(): ${describeThrown(e, root)}`));

/** Whether `e`, or what it wraps, says a filter answered with a promise during a synchronous render. */
function needsAsync(e: unknown): boolean {
	for (let at: any = e; at; at = at.originalError) if (at instanceof NeedsAsync) return true;
	return false;
}

/** A value as a config function gets it: a missing one is `null`, as in 0.7, and a float its number. */
const given = (v: unknown) => (v === undefined ? null : isFloat(v) ? v.n : v);

/** What a tag prints for a function's answer: nothing for none, a list's items one after another. */
function tagText(v: unknown): string {
	if (v === undefined || v === null) return "";
	if (Array.isArray(v)) return v.map(tagText).join("");
	const shown = printable(v);
	return typeof shown === "string" ? shown : String(shown);
}

/** A value as `{{ }}` prints it: a date as 0.7 printed it, in UTC, and a float as its number. */
function printable(v: unknown): unknown {
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : showDate(v);
	if (isFloat(v)) return v.n;
	if (Array.isArray(v) && v.some((item) => item instanceof Date || isFloat(item) || Array.isArray(item))) return v.map(printable);
	return v;
}

/** A value for liquidjs' own filters: a date as 0.7's text, a float as its number, in a list too. */
function asText(v: unknown): unknown {
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? v : showDate(v);
	if (isFloat(v)) return v.n;
	if (Array.isArray(v) && v.some((item) => item instanceof Date || isFloat(item))) return v.map(asText);
	return v;
}

/** A value as text, as `{{ }}` would print it. */
function text(v: unknown): string {
	const shown = printable(v);
	if (shown === undefined || shown === null) return "";
	if (Array.isArray(shown)) return shown.map(text).join("");
	return String(shown);
}

/** A number as the liquid crate read one: a whole number, a float, or text that is one of them. */
function number(v: unknown, what: "input" | "operand"): { value: number; float: boolean } {
	if (isFloat(v)) return { value: v.n, float: true };
	if (typeof v === "number") return { value: v, float: !Number.isInteger(v) };
	if (typeof v === "string") {
		if (/^[+-]?\d+$/.test(v)) return { value: Number(v), float: false };
		if (/^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf|infinity|nan)$/i.test(v)) return { value: Number(v.replace(/inf(inity)?/i, "Infinity").replace(/nan/i, "NaN")), float: true };
	}
	throw new BuildError(what === "input" ? "invalid input: Number expected" : "invalid argument `operand`: Number expected");
}

/**
 * A number for the math filters, as Ruby's Liquid reads one (`Utils.to_number`, Liquid 4.0.4, which
 * Jekyll and GitHub Pages run): text that's a decimal (`"3.5"`) is a float, other text is its
 * leading whole number or 0 (`"3.5x"` is 3, `"r>"` is 0), and nothing, `true` or a list is 0.
 * jekyll-toc multiplies text by 1 and depends on it (osg #7); 0.7, after the liquid crate, said
 * "Number expected".
 */
function toNumber(v: unknown): { value: number; float: boolean } {
	if (isFloat(v)) return { value: v.n, float: true };
	if (typeof v === "number") return { value: v, float: !Number.isInteger(v) };
	if (typeof v === "string") {
		const t = v.trim();
		if (/^-?\d+\.\d+$/.test(t)) return { value: Number(t), float: true };
		const whole = /^[+-]?\d+(?:_\d+)*/.exec(t)?.[0];
		return { value: whole === undefined ? 0 : Number(whole.replaceAll("_", "")), float: false };
	}
	return { value: 0, float: false };
}

/** A float that's whole stays one (see `LiquidFloat`). */
const float = (n: number) => (Number.isInteger(n) ? new FloatValue!(n) : n);

/** Two numbers through `whole` when both are whole numbers, and through `exact` as floats otherwise, as the liquid crate did. */
const arithmetic = (whole: (a: number, b: number) => number, exact: (a: number, b: number) => number, checkZero = false) => (input: unknown, operand: unknown) => {
	const a = toNumber(input), b = toNumber(operand);
	if (checkZero && b.value === 0) throw new BuildError("invalid argument `operand`: Can't divide by zero");
	return a.float || b.float ? float(exact(a.value, b.value)) : whole(a.value, b.value);
};

/** Rounding half away from zero, as Rust rounds. */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

/**
 * `where` and `reject` without liquidjs' generator and new scope for each item, for the common
 * case: a list, and a property that's names and literals (`"data.lang"`). It reads each item the
 * way liquidjs does (its scope's `findScope` and `readProperty`: `size`, `first`, drops, methods)
 * and compares with its `equals`, so the answers are the same. Anything else (strict variables, a
 * `[x]` in the property, an item that isn't an object, a value that's a promise) goes to liquidjs'
 * own. expressjs.com's layouts call `where` 56 times a page over 380 items: its idiomatic port built
 * in 7.4 s with liquidjs' `where` and in 1.06 s with a config filter like this one (ex #2).
 */
function fastWhere(liquid: Liquid): void {
	const { Tokenizer, TypeGuards, evalTokenValue, toValueSync, isTruthy, toValue } = liquidjs();
	const comparable = (v: any) => v && typeof v.equals === "function" && typeof v.gt === "function" && typeof v.geq === "function" && typeof v.lt === "function" && typeof v.leq === "function";
	const SLOW = Symbol("slow");
	// liquidjs' `equals`, synchronous; SLOW when a drop answers with something else.
	const equals = (lhs: any, rhs: any): boolean | typeof SLOW => {
		if (comparable(lhs)) { const r = lhs.equals(rhs); return typeof r === "boolean" ? r : SLOW; }
		if (comparable(rhs)) { const r = rhs.equals(lhs); return typeof r === "boolean" ? r : SLOW; }
		lhs = toValue(lhs);
		rhs = toValue(rhs);
		if (Array.isArray(lhs)) {
			if (!Array.isArray(rhs) || lhs.length !== rhs.length) return false;
			for (let i = 0; i < lhs.length; i++) {
				const same = equals(lhs[i], rhs[i]);
				if (same !== true) return same;
			}
			return true;
		}
		return lhs === rhs;
	};
	const isAsync = (v: any) => v !== null && typeof v === "object" && (typeof v.then === "function" || typeof v.next === "function");
	for (const [name, include] of [["where", true], ["reject", false]] as const) {
		const slow = liquid.filters[name] as any;
		const slowHandler = typeof slow === "function" ? slow : slow.handler;
		liquid.registerFilter(name, function (this: any, input: unknown, property: unknown, ...rest: unknown[]) {
			const fallback = () => slowHandler.call(this, input, property, ...rest);
			const ctx = this.context;
			const list = asText(input);
			if (!Array.isArray(list) || ctx.strictVariables || rest.length > 1) return fallback();
			const token = new Tokenizer(String(property ?? "")).readScopeValue() as any;
			if (!token || token.variable || !token.props.every((p: any) => TypeGuards.isWordToken(p) || TypeGuards.isQuotedToken(p) || TypeGuards.isNumberToken(p))) return fallback();
			const keys = token.props.map((p: any) => toValueSync(evalTokenValue(p, ctx)));
			const expected = rest.length ? asText(rest[0]) : undefined;
			ctx.memoryLimit.use(list.length);
			const out: unknown[] = [];
			for (const item of list) {
				if (item === null || (typeof item !== "object" && typeof item !== "function")) return fallback();
				// A scope spawned on the item: the first name from the item if it has it, else the globals.
				let value: any = keys[0] in (item as object) ? item : ctx.globals;
				for (const key of keys) {
					value = ctx.readProperty(value, key);
					if (isAsync(value)) return fallback();
				}
				const matched = expected === undefined ? isTruthy(value, ctx) : equals(value, expected);
				if (matched === SLOW) return fallback();
				if (matched === include) out.push(item);
			}
			return out;
		});
	}
}

/** Whole numbers stay whole (`7 | divided_by: 2` is 3) and a float stays a float, as in 0.7 and Ruby; text is read as Ruby reads it (`toNumber`). */
const MATH: Record<string, (...args: any[]) => unknown> = {
	plus: arithmetic((a, b) => a + b, (a, b) => a + b),
	minus: arithmetic((a, b) => a - b, (a, b) => a - b),
	times: arithmetic((a, b) => a * b, (a, b) => a * b),
	divided_by: arithmetic((a, b) => Math.trunc(a / b), (a, b) => a / b, true),
	modulo: arithmetic((a, b) => a % b, (a, b) => a % b, true),
	at_least: arithmetic((a, b) => Math.max(a, b), (a, b) => Math.max(a, b)),
	at_most: arithmetic((a, b) => Math.min(a, b), (a, b) => Math.min(a, b)),
	abs: (input: unknown) => {
		const n = toNumber(input);
		return n.float ? float(Math.abs(n.value)) : Math.abs(n.value);
	},
	round: (input: unknown, places: unknown) => {
		const n = toNumber(input).value;
		const p = places === undefined || places === null ? 0 : toNumber(places).value;
		if (p <= 0) return round(n);
		const m = 10 ** p;
		return float(round(n * m) / m);
	},
	ceil: (input: unknown) => Math.ceil(toNumber(input).value),
	floor: (input: unknown) => Math.floor(toNumber(input).value),
};

/** Equality as the liquid crate tells it: by value, objects and lists too. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (isFloat(a) || isFloat(b)) return same(isFloat(a) ? a.n : a, isFloat(b) ? b.n : b);
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
	}
	return false;
}

/** How the liquid crate escaped HTML: `"` is `&quot;`, and `escape_once` leaves 0.7's five entities as they are. */
function escape(input: unknown, once: boolean): unknown {
	if (input === undefined || input === null) return input;
	const ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;", "&": "&amp;" };
	return text(input).replace(/[<>'"&]/g, (c, at: number, s: string) => (c === "&" && once && /^&(?:lt|gt|#39|quot|amp);/.test(s.slice(at)) ? "&" : ENTITIES[c]));
}

/** Rust's `as usize` for a length: a negative one is as long as can be. */
const length = (v: unknown, otherwise: number) => {
	if (v === undefined || v === null) return otherwise;
	const n = number(v, "operand").value;
	return n < 0 ? Infinity : Math.trunc(n);
};

/**
 * Where the liquid crate's filters say otherwise than liquidjs', 0.7's output stays: `capitalize`
 * changes the first letter only (`Pine CONE`), `url_encode` writes a space as `%20`, `split`
 * is Ruby's (below), `truncate` counts the ellipsis' bytes, `truncatewords` splits at each space,
 * `map` leaves out what isn't an object, `uniq` compares values, and `size` is a value's text's.
 */
const TEXT: Record<string, (...args: any[]) => unknown> = {
	capitalize: (input: unknown) => {
		const [first = "", ...rest] = [...text(input)];
		return first.toUpperCase() + rest.join("");
	},
	url_encode: (input: unknown) => (input === undefined || input === null ? input : Array.from(new TextEncoder().encode(text(input)), (b) => (/[A-Za-z0-9._-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`)).join("")),
	url_decode: (input: unknown) => {
		if (input === undefined || input === null) return input;
		// A `%` that doesn't start an escape is left as it is; bytes that aren't UTF-8 are an error.
		try { return new TextDecoder("utf-8", { fatal: true }).decode(percentDecode(text(input).replaceAll("+", " "))); } catch { throw new BuildError("invalid input: Malformed UTF-8"); }
	},
	// Ruby's `String#split`, as Ruby's Liquid calls it: by nothing, the characters; by one space, at
	// each run of whitespace, with none at the start; and empty strings at the end dropped
	// (`"a,b,,"` is two). 0.7, after the liquid crate, kept them and split at each space.
	split: (input: unknown, pattern: unknown) => {
		const s = text(input), by = text(pattern);
		if (s === "") return [];
		if (by === "") return [...s];
		const parts = by === " " ? s.replace(/^[ \t\n\v\f\r]+/, "").split(/[ \t\n\v\f\r]+/) : s.split(by);
		while (parts.length && parts[parts.length - 1] === "") parts.pop();
		return parts;
	},
	array_to_sentence_string: (input: unknown, connector: unknown) => {
		if (!Array.isArray(input)) throw new BuildError("invalid input: Array expected");
		const and = connector === undefined || connector === null ? "and" : text(connector);
		// As Jekyll writes it: `a and b` for two (0.7 wrote `a, and b`), `a, b, and c` for more.
		if (input.length === 2) return `${text(input[0])} ${and} ${text(input[1])}`;
		return input.map((item, i) => (i === 0 ? text(item) : i === input.length - 1 ? `, ${and} ${text(item)}` : `, ${text(item)}`)).join("");
	},
	escape: (input: unknown) => escape(input, false),
	escape_once: (input: unknown) => escape(input, true),
	truncate: (input: unknown, size: unknown, ellipsis: unknown) => {
		const s = text(input), end = ellipsis === undefined || ellipsis === null ? "..." : text(ellipsis);
		const n = length(size, 50);
		if (n >= Buffer.byteLength(s)) return input;
		return [...s].slice(0, Math.max(n - Buffer.byteLength(end), 0)).join("") + end;
	},
	truncatewords: (input: unknown, count: unknown, ellipsis: unknown) => {
		const words = text(input).split(" "), end = ellipsis === undefined || ellipsis === null ? "..." : text(ellipsis);
		const n = length(count, 50);
		return n < words.length ? words.slice(0, n).join(" ") + end : input;
	},
	map: (input: unknown, property: unknown) => {
		if (!Array.isArray(input)) throw new BuildError("invalid input: Array expected");
		const key = text(property);
		return input.filter((item) => isPlainObject(item)).map((item) => (item as Data)[key] ?? null);
	},
	uniq: (input: unknown) => {
		if (!Array.isArray(input)) throw new BuildError("invalid input: Array expected");
		const kept: unknown[] = [];
		for (const item of input) if (!kept.some((k) => same(k, item))) kept.push(item);
		return kept;
	},
	// A string's size is JavaScript's (see the changelog); anything else that prints is its text's.
	size: (input: unknown) => {
		if (input === undefined || input === null) return 0;
		if (Array.isArray(input)) return input.length;
		if (isPlainObject(input)) return Object.keys(input).length;
		return text(input).length;
	},
	// Shopify's `pluralize`: `{{ n | pluralize: "pine cone", "pine cones" }}`.
	pluralize: (n: unknown, singular: unknown, plural: unknown) => {
		const count = isFloat(n) ? n.n : typeof n === "string" && /^[+-]?\d+$/.test(n.trim()) ? Number(n) : n;
		if (typeof count !== "number" || !Number.isInteger(count)) throw new BuildError("invalid input: Whole number expected");
		return count === 1 ? singular : plural;
	},
};

/** Percent escapes as bytes, the rest as its UTF-8. */
function percentDecode(s: string): Uint8Array {
	const out: number[] = [];
	const raw = Buffer.from(s, "utf8");
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === 0x25 && i + 2 < raw.length && /^[0-9A-Fa-f]{2}$/.test(String.fromCharCode(raw[i + 1], raw[i + 2]))) {
			out.push(Number.parseInt(String.fromCharCode(raw[i + 1], raw[i + 2]), 16));
			i += 2;
		} else out.push(raw[i]);
	}
	return Uint8Array.from(out);
}

/** `1st`, `2nd`, `3rd`, `4th`, `11th`, `21st`. */
function ordinal(day: number): string {
	if (day % 100 >= 11 && day % 100 <= 13) return "th";
	return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}

function isInsideDir(dir: string, file: string): boolean {
	const rel = path.relative(dir, file);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * liquidjs' error as ssqch says it: `page.liquid:3: unknown filter \`upcse\` (did you mean
 * \`upcase\`?)`. The line is the template's own, from where liquidjs found the problem; an error
 * in an include names the include.
 */
function describe(e: unknown, ctx: RenderContext, env: EngineEnv, filters: string[], includes: Map<string, string>): string {
	if (e instanceof BuildError) return e.message;
	const failure = e as LiquidFailure;
	// The innermost error is the one that says what happened, and the innermost place is where.
	let inner: unknown = failure.originalError;
	let token = failure.token;
	while ((inner as LiquidFailure)?.originalError || (inner as LiquidFailure)?.token) {
		token = (inner as LiquidFailure).token ?? token;
		if (!(inner as LiquidFailure).originalError) break;
		inner = (inner as LiquidFailure).originalError;
	}
	let message = inner instanceof Error ? inner.message : String(failure.message ?? e);
	// liquidjs puts the place at the end (`, file:/site/page.liquid, line:2, col:6`); the build says it its own way.
	message = message.replace(/(?:, file:.*?)?, line:\d+, col:\d+$/s, "");
	const file = token?.file ?? (token?.input === undefined ? undefined : includes.get(token.input));
	const name = file && path.resolve(file) !== path.resolve(ctx.inputPath) ? shownPath(file, env.config.root) : ctx.name;
	const line = token ? token.getPosition()[0] : undefined;
	let found: RegExpExecArray | null;
	if (inner instanceof BuildError) {
		// A function of the site's threw, or one of ssqch's filters refused its input.
		message = inner.message;
	} else if ((found = /^undefined filter: (\S+)$/.exec(message))) {
		const wanted = found[1];
		// Another generator's filter (`absolute_url`): ssqch's way, instead of a guess from the spelling.
		const equivalent = equivalents.find(wanted, "filter");
		if (equivalent) message = `unknown filter \`${wanted}\`. ${equivalent.say}\n  More: ${equivalent.more}`;
		else {
			const near = closest(wanted, filters.filter((f) => f !== wanted));
			message = `unknown filter \`${wanted}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
		}
	} else if ((found = /^tag "([^"]+)" not found$/.exec(message))) {
		const near = closest(found[1], ["assign", "break", "capture", "case", "comment", "continue", "cycle", "decrement", "echo", "for", "if", "include", "increment", "layout", "liquid", "raw", "render", "tablerow", "unless"].filter((t) => t !== found![1]));
		message = `unknown tag \`${found[1]}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
	} else if ((found = /^ENOENT: Failed to lookup "(.*)" in "/s.exec(message))) {
		const wanted = unquoted(found[1]);
		// What's there, by its name and, for a Liquid file, by its name without `.liquid` too (as it can be included).
		const named = new Map<string, string>();
		for (const have of env.includeDirs.flatMap((dir) => filesUnder(dir))) {
			named.set(have, have);
			if (have.endsWith(".liquid")) named.set(have.slice(0, -7), have);
		}
		const near = closestPath(wanted, named.keys()) ?? closest(wanted, named.keys());
		message = `template not found: can't include \`${wanted}\`${near ? ` (did you mean \`${named.get(near)}\`?)` : ""}`;
	} else if ((found = /^undefined variable: (.+)$/.exec(message))) {
		// `strict`, in 0.7's words.
		message = strictMessage(found[1]);
	}
	return `${name}${line === undefined ? "" : `:${line}`}: ${message}`;
}

/** 0.7's words for a variable or property that isn't there while `strict` is on. */
function strictMessage(wanted: string): string {
	const parts = wanted.split(".");
	if (parts.length === 1) return `Unknown variable (strict is on)\n  with:\n    requested variable=${wanted}`;
	return `Unknown index (strict is on)\n  with:\n    variable=${parts.slice(0, -1).join(".")}\n    requested index=${parts[parts.length - 1]}`;
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
