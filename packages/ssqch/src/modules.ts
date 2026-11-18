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
const API = new URL("./api.ts", import.meta.url).href;
/** The modules a site imports from ssqch itself, besides `ssqch`. */
export const BUILT_IN = ["ssqch/image", "ssqch/rss", "ssqch/assets", "ssqch/links", "ssqch/sitemap", "ssqch/redirects", "ssqch/sass", "ssqch/elements", "ssqch/minify"];

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
		if (specifier === "ssqch") return { url: API, shortCircuit: true };
		if (specifier.startsWith("ssqch/")) {
			const url = new URL(`./modules/${specifier.slice(6)}.ts`, import.meta.url);
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
		try {
			return attempt(specifier);
		} catch (e: any) {
			// `import { shout } from "./lib/text"`: the file with an extension, or a folder's index.
			const relative = specifier.startsWith("./") || specifier.startsWith("../") || path.isAbsolute(specifier) || specifier.startsWith("file:");
			if (!fromSite || !relative || !["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(e?.code)) throw e;
			const [bare, query = ""] = specifier.split(/(?=\?)/, 2);
			for (const ending of ENDINGS) {
				try { return attempt(bare.replace(/\/$/, "") + ending + query); } catch { /* the next ending */ }
			}
			throw e;
		}
	}
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
	return watchSettle(import(url));
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
export function siteFrames(stack: string, root: string): string[] {
	const out: string[] = [];
	for (const line of stack.split("\n")) {
		const found = /^\s+at (?:(.*?) \()?((?:file:\/\/|\/|[A-Za-z]:[\\/])[^()]*?):(\d+):(\d+)\)?$/.exec(line);
		if (!found) continue;
		const [, name, where, row, column] = found;
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
