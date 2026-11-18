// Liquid, for `.liquid`: liquidjs itself. What's ssqch's is around it, as 0.7 had it (the liquid
// crate, `plugins/liquid`): includes from the site's and its themes' folders, Jekyll's
// `{% include nav.html section="home" %}`, the config's functions as filters, Jekyll's and
// Shopify's filters, dates in UTC, and errors that name the file and the line.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type * as LiquidJs from "liquidjs";
import type { FS, Liquid } from "liquidjs";
import type { Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
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
	token?: { file?: string; getPosition(): [number, number] };
}

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

// liquidjs is loaded when the first Liquid template renders, not when ssqch starts: most sites
// have none, and loading it takes about 5 ms. `require`, because rendering is synchronous.
let library: typeof LiquidJs | undefined;
const liquidjs = () => (library ??= createRequire(import.meta.url)("liquidjs") as typeof LiquidJs);

/** liquidjs, set up for the site; it adds the includes it reads to `loaded`. */
function liquidRenderer(env: EngineEnv, loaded: Set<string>): TemplateEngine["render"] {
	const { Liquid, TypeGuards } = liquidjs();
	const root = env.config.root;
	const isFile = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
	const read = (file: string) => {
		const dir = env.includeDirs.find((d) => isInsideDir(d, file));
		if (dir) loaded.add(path.relative(dir, file).split(path.sep).join("/"));
		return fs.readFileSync(file, "utf8");
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
		// `strict` is about printing: `{% if nope %}` is still false.
		lenientIf: true,
		// A date prints as 0.7 printed it (`2026-01-02 00:00:00 +0000`), not in the machine's time zone.
		outputEscape: printable as (v: unknown) => string,
	});

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
	liquid.registerFilter("date_to_string", dateString("%b"));
	liquid.registerFilter("date_to_long_string", dateString("%B"));
	// Whole numbers divide to a whole number, as in 0.7 and Shopify (`10 | divided_by: 4` is 2,
	// rounded toward zero as the liquid crate does); a divisor written with a decimal point (`4.0`)
	// divides exactly. `modulo` keeps the dividend's sign (`7 | modulo: -3` is 1).
	liquid.registerFilter("divided_by", function (this: any, dividend: unknown, divisor: unknown) {
		const [a, b] = [Number(dividend), Number(divisor)];
		const written = this.token?.args?.[0];
		const exact = TypeGuards.isNumberToken(written) && written.getText().includes(".");
		return Number.isInteger(a) && Number.isInteger(b) && !exact && b !== 0 ? Math.trunc(a / b) : a / b;
	});
	liquid.registerFilter("modulo", (dividend: unknown, divisor: unknown) => Number(dividend) % Number(divisor));
	// Where the liquid crate's filters say otherwise than liquidjs', 0.7's output stays:
	// `capitalize` changes the first letter only (`Pine CONE`), `url_encode` writes a space as
	// `%20`, `split` keeps empty strings at the end, and `array_to_sentence_string` puts a comma
	// before the last word (`a, and b`).
	liquid.registerFilter("capitalize", (input: unknown) => {
		const [first = "", ...rest] = [...text(input)];
		return first.toUpperCase() + rest.join("");
	});
	liquid.registerFilter("url_encode", (input: unknown) => (input === undefined || input === null ? input : Array.from(new TextEncoder().encode(text(input)), (b) => (/[A-Za-z0-9._-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`)).join("")));
	liquid.registerFilter("split", (input: unknown, pattern: unknown) => {
		const s = text(input), by = text(pattern);
		if (s === "") return [];
		return by === "" ? ["", ...s, ""] : s.split(by);
	});
	liquid.registerFilter("array_to_sentence_string", (input: unknown, connector: unknown) => {
		if (!Array.isArray(input)) throw new BuildError("invalid input: Array expected");
		const and = connector === undefined || connector === null ? "and" : text(connector);
		return input.map((item, i) => (i === 0 ? text(item) : i === input.length - 1 ? `, ${and} ${text(item)}` : `, ${text(item)}`)).join("");
	});
	// Shopify's `pluralize`: `{{ n | pluralize: "pine cone", "pine cones" }}`.
	liquid.registerFilter("pluralize", (n: unknown, singular: unknown, plural: unknown) => {
		const count = typeof n === "string" && /^[+-]?\d+$/.test(n.trim()) ? Number(n) : n;
		if (typeof count !== "number" || !Number.isInteger(count)) throw new BuildError("invalid input: Whole number expected");
		return count === 1 ? singular : plural;
	});

	// The config's functions as filters: `{{ x | wrap: "[", "]" }}` calls `wrap(x, "[", "]")`, and
	// keyword arguments (`| f: size: 2`) arrive as one object at the end. A function is awaited
	// when it answers with a promise; until one does, templates render synchronously.
	let syncRender = false;
	const functions = new Map<string, Filter>([...env.pipeFilters, ...env.globals]);
	for (const [name, fn] of functions) {
		liquid.registerFilter(name, function (this: any, input: unknown, ...rest: unknown[]) {
			const args: unknown[] = [input];
			let options: Data | undefined;
			rest.forEach((arg, i) => {
				if (Array.isArray(this.token?.args?.[i]) && Array.isArray(arg)) (options ??= {})[arg[0]] = arg[1];
				else args.push(arg);
			});
			if (options) args.push(options);
			let out: unknown;
			try { out = fn(...args); } catch (e) { throw thrown(name, e, root); }
			if (out instanceof Promise) {
				if (syncRender) {
					out.catch(() => {});
					throw new NeedsAsync();
				}
				return watchSettle(out).catch((e) => { throw thrown(name, e, root); });
			}
			return out;
		});
	}
	const filterNames = () => Object.keys(liquid.filters);

	const compiled = new Map<string, ReturnType<Liquid["parse"]>>();
	/** Templates that needed a promise awaited once: they render asynchronously from then on. */
	const isAsync = new Set<string>();
	const fail = (e: unknown, ctx: RenderContext): never => {
		throw new BuildError(describe(e, ctx, env, filterNames()));
	};
	return (source, data, ctx) => {
		let templates = ctx.cacheKey === undefined ? undefined : compiled.get(ctx.cacheKey);
		if (!templates) {
			try { templates = liquid.parse(source, ctx.inputPath); } catch (e) { return fail(e, ctx); }
			if (ctx.cacheKey !== undefined) compiled.set(ctx.cacheKey, templates);
		}
		const later = () => liquid.render(templates, data).then((out: unknown) => String(out), (e: unknown) => fail(e, ctx));
		if (ctx.cacheKey !== undefined && isAsync.has(ctx.cacheKey)) return later();
		// Another page's `templateContent` can render in the middle of this one: the flag is put back as it was.
		const was = syncRender;
		syncRender = true;
		try {
			return String(liquid.renderSync(templates, data));
		} catch (e) {
			if (!needsAsync(e)) return fail(e, ctx);
		} finally {
			syncRender = was;
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

/** A value as `{{ }}` prints it: a date as 0.7 printed it, in UTC. */
function printable(v: unknown): unknown {
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : showDate(v);
	if (Array.isArray(v) && v.some((item) => item instanceof Date || Array.isArray(item))) return v.map(printable);
	return v;
}

/** A value as text, as `{{ }}` would print it. */
function text(v: unknown): string {
	const shown = printable(v);
	if (shown === undefined || shown === null) return "";
	if (Array.isArray(shown)) return shown.map(text).join("");
	return String(shown);
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
function describe(e: unknown, ctx: RenderContext, env: EngineEnv, filters: string[]): string {
	if (e instanceof BuildError) return e.message;
	const failure = e as LiquidFailure;
	// The innermost error is the one that says what happened.
	let inner: unknown = failure.originalError;
	while ((inner as LiquidFailure)?.originalError) inner = (inner as LiquidFailure).originalError;
	let message = inner instanceof Error ? inner.message : String(failure.message ?? e);
	// liquidjs puts the place at the end (`, file:/site/page.liquid, line:2, col:6`); the build says it its own way.
	if (!(inner instanceof Error)) message = message.replace(/(?:, file:.*?)?, line:\d+, col:\d+$/s, "");
	const token = failure.token;
	const file = token?.file;
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
		const have = env.includeDirs.flatMap((dir) => filesUnder(dir));
		const near = closestPath(wanted, have) ?? closestPath(`${wanted}.liquid`, have);
		message = `template not found: can't include \`${wanted}\`${near ? ` (did you mean \`${near}\`?)` : ""}`;
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

/** Every file under `dir`, as paths from it with forward slashes. */
function filesUnder(dir: string, rel = ""): string[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
	return entries.flatMap((entry) => {
		const p = rel ? `${rel}/${entry.name}` : entry.name;
		return entry.isDirectory() ? filesUnder(dir, p) : [p];
	});
}
