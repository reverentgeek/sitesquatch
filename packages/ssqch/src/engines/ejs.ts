// EJS, for `.ejs`: the ejs package itself (3.1.10, whose output 0.7 matched with its own copy of
// EJS's compiler on QuickJS, `crates/sitesquatch-js/src/ejs.js`). What's ssqch's is around it, as
// 0.7 had it: the page's data and the config's functions as variables, includes from the
// includes folders (and the themes') or from the template's own folder, a date printed in UTC,
// and errors that name the template and the line.
import fs from "node:fs";
import path from "node:path";
import ejs from "ejs";
import type { Data } from "../data.ts";
import { BuildError } from "../diagnostics.ts";
import { describeThrown, shownPath, watchSettle } from "../modules.ts";
import { closestPath } from "../suggest.ts";
import { siteFunction } from "./engine.ts";
import type { EngineEnv, RenderContext, TemplateEngine } from "./engine.ts";

/** A template as code: its function, or its text when it has no tags. */
interface Compiled {
	name: string;
	text?: string;
	fn?: (locals: Data, print: Print, include: (name: string, data?: Data) => unknown, rethrow: Rethrow) => string | Promise<string>;
}

/** How a value is printed: escaped for `<%=`, as it is (`raw`) for `<%-`. Its `globals` are the config's functions, in scope by name. */
type Print = ((value: unknown, raw?: boolean) => string) & { globals: Data };
type Rethrow = (e: unknown, lines: string, name: string, line: number) => never;

/** An error that says which template and line it's from (`index.ejs:3: ...`); an include's error keeps its own place. */
class Located extends BuildError {}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&#34;", "'": "&#39;" };

// The code around a template's own, in place of ejs' (`Template.compile` uses a source it's
// given): what `<%-` prints goes through `print` too, so a date prints in UTC; and the config's
// functions are a scope under the page's data, so a page's own `title` comes first and nothing is
// copied.
const BEFORE = "  var __output = \"\";\n  function __append(s) { if (s !== undefined && s !== null) __output += escapeFn(s, true) }\n  with (escapeFn.globals) { with (locals || {}) {\n";
const AFTER = "  } }\n  return __output;\n";

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

export function ejsEngine(env: EngineEnv): TemplateEngine {
	const root = env.config.root;
	const loaded = new Set<string>();
	const globals: Data = Object.create(null);
	for (const [name, fn] of env.globals) globals[name] = siteFunction(name, fn, root);
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
			const block = /Unexpected end of input|Unexpected token '(?:\)|catch|\})'/.test(said);
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

	/** The include `wanted` from the template at `from`: its file and source, as 0.7 found them. */
	const findInclude = (from: string, wanted: string): { file: string; source: string } => {
		const name = path.extname(wanted) ? wanted : `${wanted}.ejs`;
		const relative = name.startsWith("./") || name.startsWith("../");
		const dirs = relative ? [path.dirname(from)] : env.includeDirs;
		for (const dir of dirs) {
			const file = path.join(dir, name);
			if (!(fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false)) continue;
			const base = [...env.includeDirs, dir].find((d) => isInsideDir(d, file));
			if (base) loaded.add(path.relative(base, file).split(path.sep).join("/"));
			try {
				return { file, source: fs.readFileSync(file, "utf8") };
			} catch (e) {
				throw new Error(`reading ${shown(file)}: ${(e as Error).message}`);
			}
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
			const waiting: Array<{ mark: string; raw: boolean; promise: Promise<unknown> }> = [];
			const print = ((value: unknown, raw?: boolean) => {
				if (value instanceof Date) value = showDate(value);
				else if (value instanceof Promise) {
					const mark = `\u0000ssqch-ejs-${waiting.length}\u0000`;
					waiting.push({ mark, raw: Boolean(raw), promise: watchSettle(value) });
					return mark;
				}
				if (raw) return String(value);
				return value === undefined || value === null ? "" : String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
			}) as Print;
			print.globals = globals;
			const run = (template: Compiled, locals: Data, file: string, depth: number): string | Promise<string> => {
				if (template.text !== undefined) return template.text;
				const include = (wanted: string, extra?: Data) => {
					if (depth > 64) throw new Error(`we've passed this tree before. Include loop: ${wanted} includes itself`);
					const found = findInclude(file, String(wanted));
					const inner = cached(`include:${found.file}`, found.source, shown(found.file));
					// As in EJS, an include gets what its parent had, with its own data on top.
					return run(inner, extra ? Object.assign(Object.create(locals), extra) : locals, found.file, depth + 1);
				};
				return template.fn!(locals, print, include, rethrow);
			};
			const finish = (out: string): string | Promise<string> => {
				if (!waiting.length) return out;
				return Promise.all(waiting.map((w) => w.promise)).then((values) => {
					for (const [i, w] of waiting.entries()) out = out.replace(w.mark, () => (w.raw ? String(values[i] ?? "") : print(values[i])));
					return out;
				}, (e) => { throw new BuildError(`${ctx.name}: ${describeThrown(e, root)}`); });
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
