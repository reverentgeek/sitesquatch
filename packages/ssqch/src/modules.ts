// Running a site's JavaScript: the config, data files and the modules they import.
//
// A site's code runs on Node as it is. Two things are ssqch's: `import ... from "ssqch"` (and
// `"ssqch/image"` and the rest) resolves to this package's own modules, whatever the site's
// `node_modules` holds, and two habits 0.7 allowed keep working (a relative import without its
// extension, and a JSON import without `with { type: "json" }`).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BuildError } from "./diagnostics.ts";
import { realPath } from "./paths.ts";

/** This package's folder: frames inside it are ssqch's own, not the site's. */
const SELF = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The modules a site imports from ssqch itself, besides `ssqch`. */
export const BUILT_IN = ["ssqch/image", "ssqch/rss", "ssqch/assets", "ssqch/links", "ssqch/sitemap", "ssqch/redirects", "ssqch/sass", "ssqch/elements", "ssqch/minify", "ssqch/llms", "ssqch/vue", "ssqch/robots", "ssqch/from-vitepress"];
/**
 * Where `ssqch` and `ssqch/image` are, as Node loads them: from source, `src/exports/ssqch.ts`
 * and `src/exports/image.ts`, which export what ssqch.d.ts declares and nothing else; in the npm
 * package, compiled from those to `lib/ssqch.js` and `lib/image.js` (`scripts/build.ts`), the
 * files its `exports` name, so a config's `ssqch` is the build's.
 */
const COMPILED = fs.existsSync(path.join(SELF, "lib", "ssqch.js"));
const API = COMPILED ? pathToFileURL(path.join(SELF, "lib", "ssqch.js")).href : new URL("./exports/ssqch.ts", import.meta.url).href;
const builtInUrl = (specifier: string): URL => (COMPILED ? pathToFileURL(path.join(SELF, "lib", `${specifier.slice(6)}.js`)) : new URL(`./exports/${specifier.slice(6)}.ts`, import.meta.url));

/** The site's own files that were loaded as modules (not packages'), in the order they loaded: `ssqch serve` reads the configuration again when one changes. */
export const loadedFiles = new Set<string>();

const isSiteUrl = (url: string | undefined): url is string => {
	if (!url?.startsWith("file:")) return false;
	const file = fileURLToPath(url);
	return !file.startsWith(SELF + path.sep) && !file.split(path.sep).includes("node_modules");
};

/** What a relative import without its extension can mean, in the order 0.7 tried them. */
const ENDINGS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".json", "/index.js", "/index.mjs", "/index.cjs", "/index.ts"];

let hooked = false;
export function hookModules(): void {
	if (hooked) return;
	hooked = true;
	// Only a `resolve` hook: on Node 22.18 any `load` hook gives every CommonJS module a `require`
	// without `require.cache` (fixed by 22.23), and packages use it (Prism's language loader,
	// which a11yproject.com's highlighting calls). The site's files are noted as they resolve.
	const note = (resolved: { url: string }) => {
		if (isSiteUrl(resolved.url)) loadedFiles.add(fileURLToPath(resolved.url));
		return resolved;
	};
	registerHooks({
		resolve(specifier, context, next) {
			return note(resolveFor(specifier, context, next));
		},
	});
	type Resolve = NonNullable<Parameters<typeof registerHooks>[0]["resolve"]>;
	function resolveFor(...[specifier, context, next]: Parameters<Resolve>): ReturnType<Resolve> {
		if (specifier.startsWith("file:") && specifier.endsWith(FORCE_ESM)) return { ...next(specifier, context), format: "module" };
		if (specifier === "ssqch") return { url: API, shortCircuit: true };
		if (specifier.startsWith("ssqch/")) {
			const url = builtInUrl(specifier);
			if (BUILT_IN.includes(specifier) && fs.existsSync(url)) return { url: url.href, shortCircuit: true };
		}
		const fromSite = isSiteUrl(context.parentURL);
		// 0.7 let a config import JSON without `with { type: "json" }`, and Node doesn't; supplying
		// the attribute keeps such configs working (the blog's has one).
		const attempt = (name: string) => {
			if (fromSite && /\.json(\?.*)?$/i.test(name) && !context.importAttributes?.type) {
				const importAttributes = { ...context.importAttributes, type: "json" };
				return { ...next(name, { ...context, importAttributes }), importAttributes };
			}
			return next(name, context);
		};
		// A file, as written or with an extension, or a folder's index.
		const withEndings = (name: string) => {
			const [bare, query = ""] = name.split(/(?=\?)/, 2);
			try { return attempt(name); } catch { /* with an ending */ }
			for (const ending of ENDINGS) {
				try { return attempt(bare.replace(/\/$/, "") + ending + query); } catch { /* the next ending */ }
			}
			return undefined;
		};
		try {
			return attempt(specifier);
		} catch (e: any) {
			// A `#…` alias with no package.json `imports` is Node's ERR_PACKAGE_IMPORT_NOT_DEFINED, and
			// `#/…` is ERR_INVALID_MODULE_SPECIFIER on Node 22 (later Nodes allow it in `imports`).
			const hashAlias = specifier.startsWith("#") && ["ERR_PACKAGE_IMPORT_NOT_DEFINED", "ERR_INVALID_MODULE_SPECIFIER"].includes(e?.code);
			if (!fromSite || (!hashAlias && !["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(e?.code))) throw e;
			// `import { shout } from "./lib/text"`: the file with an extension, or a folder's index.
			const relative = specifier.startsWith("./") || specifier.startsWith("../") || path.isAbsolute(specifier) || specifier.startsWith("file:");
			if (relative) return withEndings(specifier) ?? (() => { throw e; })();
			// `import { menu } from "@/config/menu"`: tsconfig.json's (or jsconfig.json's) `paths`,
			// which Astro, Vite and Next.js sites import their own files through (expressjs.com, ex #5).
			for (const file of aliasTargets(specifier, path.dirname(fileURLToPath(context.parentURL!)))) {
				const found = withEndings(pathToFileURL(file).href);
				if (found) return found;
			}
			throw e;
		}
	}
}

// ---- tsconfig.json paths ----------------------------------------------------------------------

/** `compilerOptions.paths` of the nearest tsconfig.json or jsconfig.json, with the folder its targets are from. */
interface Aliases { base: string; paths: Array<[string, string[]]> }
const aliasesByDir = new Map<string, Aliases | null>();

/** JSON with comments and trailing commas, as tsconfig.json is written. */
function parseJsonc(text: string): any {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "\"") {
			const end = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i))?.[0] ?? c;
			out += end;
			i += end.length - 1;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 1;
		} else out += c;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** A tsconfig's `paths` and the folder they're from (`baseUrl`, else its own folder), following a local `extends`. */
function readAliases(file: string, seen = new Set<string>()): Aliases | null {
	if (seen.has(file)) return null;
	seen.add(file);
	let json: any;
	try { json = parseJsonc(fs.readFileSync(file, "utf8")); } catch { return null; }
	const dir = path.dirname(file);
	const options = json?.compilerOptions ?? {};
	if (options.paths && typeof options.paths === "object") {
		const base = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : dir;
		const paths = Object.entries(options.paths).filter((e): e is [string, string[]] => Array.isArray(e[1])).map(([k, v]) => [k, v.filter((t) => typeof t === "string")] as [string, string[]]);
		return { base, paths };
	}
	const parents = (Array.isArray(json?.extends) ? json.extends : [json?.extends]).filter((x: unknown): x is string => typeof x === "string" && (x.startsWith("./") || x.startsWith("../")));
	for (const parent of parents) {
		const found = readAliases(path.resolve(dir, parent.endsWith(".json") ? parent : `${parent}.json`), seen);
		if (found) return found;
	}
	return null;
}

/** The nearest tsconfig.json or jsconfig.json's paths, from `dir` up. */
function aliasesFor(dir: string): Aliases | null {
	if (aliasesByDir.has(dir)) return aliasesByDir.get(dir)!;
	let found: Aliases | null = null;
	for (const name of ["tsconfig.json", "jsconfig.json"]) {
		const file = path.join(dir, name);
		if (fs.existsSync(file)) { found = readAliases(file); break; }
	}
	if (!found && !fs.existsSync(path.join(dir, "tsconfig.json")) && !fs.existsSync(path.join(dir, "jsconfig.json"))) {
		const up = path.dirname(dir);
		if (up !== dir) found = aliasesFor(up);
	}
	aliasesByDir.set(dir, found);
	return found;
}

/**
 * The files `specifier` names through the nearest tsconfig's `paths`, as TypeScript reads them:
 * the pattern with the longest prefix before its `*` wins, and its targets are tried in order.
 */
export function aliasTargets(specifier: string, fromDir: string): string[] {
	const aliases = aliasesFor(fromDir);
	if (!aliases) return [];
	let best: { pattern: string; star: string; targets: string[] } | undefined;
	for (const [pattern, targets] of aliases.paths) {
		const at = pattern.indexOf("*");
		if (at === -1) {
			if (pattern === specifier) return targets.map((t) => path.resolve(aliases.base, t));
			continue;
		}
		const prefix = pattern.slice(0, at), suffix = pattern.slice(at + 1);
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) continue;
		if (best && prefix.length <= best.pattern.indexOf("*")) continue;
		best = { pattern, star: specifier.slice(prefix.length, specifier.length - suffix.length), targets };
	}
	return best ? best.targets.map((t) => path.resolve(aliases.base, t.replace("*", best!.star))) : [];
}

const versions = new Map<string, { mtimeMs: number; version: number }>();

/**
 * Imports a site's module from its file. A file that changed since it was last imported (while
 * serving) is imported fresh.
 */
export async function importFile(file: string): Promise<Record<string, unknown>> {
	hookModules();
	const mtimeMs = fs.statSync(file).mtimeMs;
	let entry = versions.get(file);
	if (!entry) versions.set(file, entry = { mtimeMs, version: 0 });
	else if (entry.mtimeMs !== mtimeMs) { entry.mtimeMs = mtimeMs; entry.version++; }
	const url = pathToFileURL(file).href + (entry.version ? `?v=${entry.version}` : "");
	try {
		return await watchSettle(import(url));
	} catch (e) {
		// Node 22.18 only retries a file as an ES module when its first syntax error is one of the
		// module kind, so `[await get()]` above an `export` fails as CommonJS (`Unexpected token`, `missing )`).
		// A file that exports or imports is a module: say so, as later Nodes do. Only when Node
		// couldn't compile this file as CommonJS, so none of it ran: a `SyntaxError` the file threw
		// while it ran (`JSON.parse`) is its error, and running it again would do what it did twice.
		if (!(e instanceof SyntaxError) || !failedAsCommonJS(e, file) || !MODULE_SYNTAX.test(fs.readFileSync(file, "utf8"))) throw e;
		return watchSettle(import(url + (url.includes("?") ? "&" : "?") + FORCE_ESM));
	}
}

const FORCE_ESM = "ssqch-esm";
/** `export`, `import` or `import.meta` as a statement would start, anywhere (`const v = [await x]; export default { v };` is one line). */
const MODULE_SYNTAX = /(?:^|[;{}()\s])(?:export\s|import\s*[\w{*'"]|import\.meta)/m;

/**
 * Whether `e` is Node's CommonJS loader failing to compile `file`. Node starts that error's stack
 * with the file and the line, and an error thrown while code runs has no such line.
 */
function failedAsCommonJS(e: SyntaxError, file: string): boolean {
	const named = /^(.+):\d+\r?\n/.exec(e.stack ?? "")?.[1];
	return named !== undefined && (named === file || named === realPath(file));
}

// ---- promises that never settle --------------------------------------------------------------

const waiting: Array<(e: Error) => void> = [];
let watching = false;

/**
 * `promise`, or a failure when it can never settle: Node is about to exit because nothing is
 * left to resolve it (no timers, no requests), which would end the build without a word.
 */
export function watchSettle<T>(promise: Promise<T>): Promise<T> {
	if (!watching) {
		watching = true;
		process.on("beforeExit", () => {
			const reject = waiting.pop();
			reject?.(new BuildError("a Promise never settled (nothing was left to resolve it: no timers or requests were pending)"));
		});
	}
	return new Promise<T>((resolve, reject) => {
		waiting.push(reject);
		const done = () => { const i = waiting.lastIndexOf(reject); if (i !== -1) waiting.splice(i, 1); };
		promise.then((v) => { done(); resolve(v); }, (e) => { done(); reject(e); });
	});
}

/** Awaits a value a site's code returned, when it's a promise. */
export function settle<T>(value: T | Promise<T>): T | Promise<T> {
	return value instanceof Promise ? watchSettle(value) : value;
}

// ---- a site's errors, as ssqch says them -----------------------------------------------------


/** A file as errors name it: from the project root with forward slashes, or the whole path outside it. */
export function shownPath(file: string, root: string): string {
	const rel = path.relative(realPath(root), realPath(file));
	return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel.split(path.sep).join("/");
}

/**
 * What a site's code threw, as text: the message, then the stack's frames in the site's own
 * files and its packages, each as `at name (file:line:column)` with the file from the project
 * root. Node's and ssqch's own frames are left out.
 */
export function describeThrown(e: unknown, root: string): string {
	if (e instanceof BuildError) return e.message;
	if (!(e instanceof Error)) return `uncaught ${typeof e === "string" ? e : safeString(e)}`;
	const message = packageMessage(e, root) ?? e.message;
	const frames = e instanceof SyntaxError ? syntaxFrames(e, root) : [];
	frames.push(...siteFrames(e.stack ?? "", root));
	return frames.length ? `${message}\n${frames.join("\n")}` : message;
}

/**
 * Node's errors for a package that isn't there, or doesn't export what was asked for, in 0.7's
 * words: they say what to do. Nothing for any other error.
 */
function packageMessage(e: Error, root: string): string | undefined {
	const code = (e as { code?: unknown }).code;
	const notInstalled = (name: string) => `package "${name}" isn't installed (no node_modules/${name} folder here or in a parent folder; run npm install)`;
	const packageOf = (specifier: string) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
	if (code === "ERR_MODULE_NOT_FOUND") {
		const found = /^Cannot find package '([^']+)'/.exec(e.message);
		if (found) return notInstalled(packageOf(found[1]));
	}
	if (code === "MODULE_NOT_FOUND") {
		// `require("left-pad")`: Node lists the files that asked, the nearest first.
		const found = /^Cannot find module '([^']+)'\nRequire stack:\n- ([^\n]+)/.exec(e.message);
		if (found) {
			const [, specifier, from] = found;
			const bare = !specifier.startsWith(".") && !path.isAbsolute(specifier);
			return `Cannot find module '${specifier}' from '${shownPath(from, root)}': ${bare ? notInstalled(packageOf(specifier)) : "file not found"}`;
		}
	}
	if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
		const found = /^Package subpath '([^']+)' is not defined by "exports" in (.+?)[\\/]package\.json/.exec(e.message);
		if (found) {
			const name = found[2].split(/[\\/]node_modules[\\/]/).pop()!.replaceAll("\\", "/");
			const required = /\n\s+at (?:Module\.)?require \(/.test(e.stack ?? "") || /\n\s+at Module\._resolveFilename/.test(e.stack ?? "");
			return `package "${name}" doesn't export "${found[1]}" for ${required ? "require" : "import"} (see the "exports" in its package.json)`;
		}
	}
	return undefined;
}

const safeString = (v: unknown) => { try { return String(v); } catch { return "a non-Error value"; } };

/** The stack's frames outside Node and ssqch, as `    at name (file:line:column)`. */
/**
 * A stack line's function, file, line and column: `at boom (/site/ssqch.config.js:2:27)` or
 * `at /site/ssqch.config.js:2:27`. The place is the last parenthesized part, found from the end,
 * since a folder's name can have parentheses in it (`paren site (copy)`).
 */
function frameOf(line: string): [name: string | undefined, where: string, row: string, column: string] | undefined {
	const at = /^\s+at /.exec(line);
	if (!at) return undefined;
	let rest = line.slice(at[0].length);
	let name: string | undefined;
	if (rest.endsWith(")")) {
		let depth = 0;
		let open = -1;
		for (let i = rest.length - 1; i >= 0; i--) {
			if (rest[i] === ")") depth++;
			else if (rest[i] === "(" && --depth === 0) { open = i; break; }
		}
		if (open <= 0 || rest[open - 1] !== " ") return undefined;
		name = rest.slice(0, open - 1);
		rest = rest.slice(open + 1, -1);
	}
	const place = /^((?:file:\/\/|\/|[A-Za-z]:[\\/]).*?):(\d+):(\d+)$/.exec(rest);
	return place ? [name, place[1], place[2], place[3]] : undefined;
}

export function siteFrames(stack: string, root: string): string[] {
	const out: string[] = [];
	for (const line of stack.split("\n")) {
		const found = frameOf(line);
		if (!found) continue;
		const [name, where, row, column] = found;
		let file: string;
		try { file = where.startsWith("file:") ? fileURLToPath(where.split("?")[0]) : where; } catch { continue; }
		if (file.startsWith(SELF + path.sep)) continue;
		// The function's own name: without V8's `async`, `Object.` and `[as alias]` around it.
		const plain = name?.replace(/^async /, "").replace(/ \[as [^\]]+\]$/, "").replace(/^(Object|Module)\./, "");
		out.push(`    at ${plain || "<anonymous>"} (${shownPath(file, root)}:${row}:${column})`);
	}
	return out;
}

/**
 * Where a syntax error is. Node says so only when it prints an uncaught one, so the files the
 * site loaded are checked again by Node itself (`node --check`), the last one loaded first.
 */
function syntaxFrames(e: SyntaxError, root: string): string[] {
	// A CommonJS file's error starts with `file:line`.
	const first = /^(.+):(\d+)\n/.exec(e.stack ?? "");
	if (first && fs.existsSync(first[1])) return [`    at ${shownPath(first[1], root)}:${first[2]}:1`];
	let tmp: string | undefined;
	try {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-check-"));
		for (const file of [...loadedFiles].reverse().slice(0, 8)) {
			// As a module, whatever the file's name and its package say.
			const ext = /\.(m|c)?ts$/.test(file) ? ".mts" : ".mjs";
			const copy = path.join(tmp, `check${ext}`);
			fs.copyFileSync(file, copy);
			try {
				execFileSync(process.execPath, ["--check", copy], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 20_000 });
			} catch (failed: any) {
				const lines = String(failed.stderr ?? "").split("\n");
				// Node names the copy by its real path, however that's spelled here: the file's name is enough.
				const at = lines.findIndex((l) => /[\\/]check\.m[jt]s:\d+$/.test(l.trimEnd()));
				const row = at === -1 ? undefined : /:(\d+)$/.exec(lines[at].trimEnd())?.[1];
				if (row === undefined) continue;
				const caret = lines[at + 2]?.indexOf("^") ?? -1;
				return [`    at ${shownPath(file, root)}:${row}:${caret === -1 ? 1 : caret + 1}`];
			}
		}
	} catch { /* the message alone */ } finally {
		if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
	}
	return [];
}
