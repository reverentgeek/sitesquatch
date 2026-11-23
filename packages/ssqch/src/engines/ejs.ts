// EJS, for `.ejs`: the ejs package itself (3.1.10, whose output 0.7 matched with its own copy of
// EJS's compiler on QuickJS, `crates/sitesquatch-js/src/ejs.js`). What's ssqch's is around it, as
// 0.7 had it: the page's data and the config's functions as variables, includes from the
// includes folders (and the themes') or from the template's own folder, a date printed in UTC,
// and errors that name the template and the line.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type EjsLib from "ejs";
import type { Data } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
import { isSafe } from "../rendering.ts";
import { describeThrown, shownPath, watchSettle } from "../modules.ts";
import { closestPath } from "../suggest.ts";
import { isDataString, lazyEngine, siteFunction } from "./engine.ts";
import type { EngineEnv, TemplateEngine } from "./engine.ts";

/** A template as code: its function, or its text when it has no tags. */
interface Compiled {
	name: string;
	text?: string;
	fn?: (locals: Data, print: Print, include: (name: string, data?: Data) => unknown, rethrow: Rethrow) => string | Promise<string>;
}

/** An include as it was found: its file, its source, and its name in errors (from the project root). */
interface Included { file: string; source: string; name: string }

/**
 * How a value is printed: escaped for `<%=`, as it is (`raw`) for `<%-`, with the template and
 * line it's printed at. Its `globals` are the config's functions, in scope by name, and `scope`
 * makes the variables a template sees.
 */
type Print = ((value: unknown, raw?: boolean, line?: number, name?: string) => string) & { globals: Data; scope: (locals: Data) => Data };
type Rethrow = (e: unknown, lines: string, name: string, line: number) => never;

/** An error that says which template and line it's from (`index.ejs:3: ...`); an include's error keeps its own place. */
class Located extends BuildError {}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&#34;", "'": "&#39;" };

// The code around a template's own, in place of ejs' (`Template.compile` uses a source it's
// given): what `<%-` prints goes through `print` too, so a date prints in UTC; and the config's
// functions are a scope under the page's data, so a page's own `title` comes first and nothing is
// copied. The variables are the page's data seen through `scope`, which keeps the names the
// code itself uses (`include`, `locals`) the engine's, as 0.7 did: a page with `include:` in its
// front matter can still include.
const BEFORE = "  var __output = \"\", __scope = escapeFn.scope(locals || {});\n  function __append(s) { if (s !== undefined && s !== null) __output += escapeFn(s, true, __line, __filename) }\n  with (escapeFn.globals) { with (__scope) {\n";
const AFTER = "  } }\n  return __output;\n";

/** The names a page's data can't take over (`with` skips them), as 0.7 reserved them. */
const RESERVED: Record<string, boolean> = Object.assign(Object.create(null), Object.fromEntries(["include", "locals", "escapeFn", "rethrow", "__output", "__append", "__line", "__lines", "__filename", "__scope", "arguments", "eval", "undefined", "NaN", "Infinity"].map((name) => [name, true])));

/** Marks a printed promise's place in the output until it settles. */
const MARK = "\u0000ssqch-ejs-";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date as 0.7's EJS printed one (`Fri Jan 02 2026 00:00:00 GMT+0000`, JavaScript's own form),
 * at UTC: JavaScript would print it in the machine's time zone, and a build's output may not
 * depend on that.
 */
function showDate(d: Date): string {
	if (Number.isNaN(d.getTime())) return "Invalid Date";
	const two = (n: number) => String(n).padStart(2, "0");
	const year = d.getUTCFullYear();
	return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCDate())} ${year < 0 ? "-" : ""}${String(Math.abs(year)).padStart(4, "0")} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} GMT+0000`;
}

/** A value as JavaScript prints it (`String(value)`), with dates, in a list too, at UTC. */
function text(value: unknown): string {
	if (value instanceof Date) return showDate(value);
	if (Array.isArray(value) && value.some((item) => item instanceof Date || Array.isArray(item))) return value.map((item) => (item === undefined || item === null ? "" : text(item))).join(",");
	return String(value);
}

/** The data a template's code sees, the engine's own names left out (see `RESERVED`). */
function scope(locals: Data): Data {
	const seen = Object.create(locals);
	seen[Symbol.unscopables] = RESERVED;
	return seen;
}

// ejs is loaded with the first EJS template, not when ssqch starts (`require`, since rendering is synchronous).
let library: typeof EjsLib | undefined;
const ejsLib = () => (library ??= createRequire(import.meta.url)("ejs") as typeof EjsLib);

export function ejsEngine(env: EngineEnv): TemplateEngine {
	return lazyEngine(() => makeEjs(env));
}

function makeEjs(env: EngineEnv): TemplateEngine {
	const ejs = ejsLib();
	const root = env.config.root;
	const loaded = new Set<string>();
	const globals: Data = Object.create(null);
	for (const [name, fn] of env.globals) globals[name] = siteFunction(name, fn, root);
	globals[Symbol.unscopables as any] = RESERVED;
	const compiled = new Map<string, Compiled>();

	const shown = (file: string) => shownPath(file, root);
	const compile = (source: string, name: string): Compiled => {
		// Most Markdown pages have no tags: their text is their output.
		if (!source.includes("<%") && !source.includes("%%>")) return { name, text: source };
		const template = new (ejs as any).Template(source, { client: true, filename: name, async: /\bawait\b/.test(source), compileDebug: true });
		try {
			template.generateSource();
		} catch (e) {
			const open = unclosed(source);
			throw new Located(`${name}:${open?.line ?? 1}: ${open ? `this ${open.tag} tag is never closed (with %>)` : (e as Error).message}`);
		}
		template.source = BEFORE + template.source + AFTER;
		try {
			return { name, fn: template.compile() };
		} catch (e) {
			// A syntax error in the template's code, at the last tag (JavaScript can't say which line
			// of the template it was). An unclosed block runs into the code around the template.
			const said = String((e as Error).message ?? e).replace(/(?: in \S+)? while compiling ejs[\s\S]*$/, "");
			const block = /Unexpected end of input|Unexpected token 'catch'/.test(said);
			const message = block ? "a block opened in a <% %> tag isn't closed (a `}` is missing)" : `syntax error in the template's code: ${said}`;
			throw new Located(`${name}:${lastTagLine(source)}: ${message}`);
		}
	};
	const cached = (key: string | undefined, source: string, name: string) => {
		let found = key === undefined ? undefined : compiled.get(key);
		if (!found) {
			found = compile(source, name);
			if (key !== undefined) compiled.set(key, found);
		}
		return found;
	};

	// Includes found so far, by the folder a relative one is looked for in (none for the includes
	// folders) and the name asked for: an include used on every page is looked for, read and named
	// once a build.
	const found = new Map<string, Included>();
	/** The include `wanted` from the template at `from`, as 0.7 found it. */
	const findInclude = (from: string, wanted: string): Included => {
		const name = path.extname(wanted) ? wanted : `${wanted}.ejs`;
		const relative = name.startsWith("./") || name.startsWith("../");
		const key = `${relative ? path.dirname(from) : ""}\0${name}`;
		const known = found.get(key);
		if (known) return known;
		const dirs = relative ? [path.dirname(from)] : env.includeDirs;
		for (const dir of dirs) {
			const file = path.join(dir, name);
			if (!(fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false)) continue;
			const base = [...env.includeDirs, dir].find((d) => isInsideDir(d, file));
			if (base) loaded.add(path.relative(base, file).split(path.sep).join("/"));
			let source: string;
			try {
				source = fs.readFileSync(file, "utf8");
			} catch (e) {
				throw new Error(`reading ${shown(file)}: ${(e as Error).message}`);
			}
			const include = { file, source, name: shown(file) };
			found.set(key, include);
			return include;
		}
		// Not found: the closest file name in the same folders.
		const have = dirs.flatMap((dir) => filesUnder(dir, "", relative ? 1 : Infinity));
		const near = closestPath(name.replace(/^(\.\/)+/, ""), have);
		const hint = near ? ` (did you mean \`${near.replace(/\.ejs$/, "")}\`?)` : "";
		throw new Error(`template not found: can't include \`${wanted}\`: no sightings in ${dirs.length ? shown(dirs[0]) : ""}${hint}`);
	};

	const rethrow: Rethrow = (e, _lines, name, line) => {
		if (e instanceof Located) throw e;
		throw new Located(`${name}:${line}: ${describeThrown(e, root)}`);
	};

	return {
		render(source, data, ctx) {
			const template = cached(ctx.cacheKey, source, ctx.name);
			if (template.text !== undefined) return template.text;
			// A promise printed by `<%= %>` (an async function's answer) is awaited, and its answer
			// takes the place it was printed in.
			const waiting: Array<{ mark: string; raw: boolean; promise: Promise<unknown>; name?: string; line?: number }> = [];
			const plain = isDataString(ctx);
			const print = ((value: unknown, raw?: boolean, line?: number, name?: string) => {
				if (value instanceof Promise) {
					const mark = `${MARK}${waiting.length}\u0000`;
					waiting.push({ mark, raw: Boolean(raw), promise: watchSettle(value), name, line });
					return mark;
				}
				// A function's answer marked with `safe()` prints as it is, and so does all of a
				// `permalink` or `computed` string, which is data.
				if (!raw) return value === undefined || value === null ? "" : isSafe(value) ? String(value) : plain ? text(value) : text(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
				if (typeof value !== "string") return text(value);
				// `<%= %>` has printed it already; this is where it goes, for a promise's error to name.
				if (value.startsWith(MARK)) {
					const w = waiting[Number.parseInt(value.slice(MARK.length), 10)];
					if (w && w.line === undefined) Object.assign(w, { line, name });
				}
				return value;
			}) as Print;
			print.globals = globals;
			print.scope = scope;
			const run = (template: Compiled, locals: Data, file: string, depth: number): string | Promise<string> => {
				if (template.text !== undefined) return template.text;
				const include = (wanted: string, extra?: Data) => {
					if (depth > 64) throw new Error(`we've passed this tree before. Include loop: ${wanted} includes itself`);
					const found = findInclude(file, String(wanted));
					const inner = cached(`include:${found.file}`, found.source, found.name);
					// As in EJS, an include gets what its parent had, with its own data on top.
					return run(inner, extra ? Object.assign(Object.create(locals), extra) : locals, found.file, depth + 1);
				};
				return template.fn!(locals, print, include, rethrow);
			};
			const finish = (out: string): string | Promise<string> => {
				if (!waiting.length) return out;
				return Promise.all(waiting.map((w) => w.promise.catch((e) => {
					throw new BuildError(`${w.name ?? ctx.name}${w.line === undefined ? "" : `:${w.line}`}: ${describeThrown(e, root)}`);
				}))).then((values) => {
					for (const [i, w] of waiting.entries()) out = out.replace(w.mark, () => (w.raw && (values[i] === undefined || values[i] === null) ? "" : print(values[i], w.raw)));
					return out;
				});
			};
			const file = path.resolve(env.dirs.input, ctx.inputPath);
			const out = run(template, data, file, 0);
			return typeof out === "string" ? finish(out) : out.then(finish);
		},
		included: () => [...loaded],
	};
}

/** The tags of a template as ejs splits it (`<%`, `%>` and the others between the text). */
function tags(source: string): string[] {
	source = source.replace(/[ \t]*<%_/gm, "<%_").replace(/_%>[ \t]*/gm, "_%>");
	return source.split(/(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)/).filter((part) => part !== "");
}

/** The first tag that's opened and never closed, and its line, as ejs finds it. */
function unclosed(source: string): { tag: string; line: number } | undefined {
	const parts = tags(source);
	let line = 1;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part.startsWith("<%") && part !== "<%%" && !["%>", "-%>", "_%>"].includes(parts[i + 2])) return { tag: part, line };
		line += part.split("\n").length - 1;
	}
	return undefined;
}

/** The line of the last tag opened in a template. */
function lastTagLine(source: string): number {
	let line = 1, last = 1;
	for (const part of tags(source)) {
		if (part.startsWith("<%") && part !== "<%%") last = line;
		line += part.split("\n").length - 1;
	}
	return last;
}

function isInsideDir(dir: string, file: string): boolean {
	const rel = path.relative(dir, file);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The files under `dir`, as paths from it with forward slashes, `depth` folders down at most. */
function filesUnder(dir: string, rel: string, depth: number): string[] {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return entries.flatMap((entry) => {
		const p = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return depth > 1 ? filesUnder(dir, p, depth - 1) : [];
		return [p];
	});
}
