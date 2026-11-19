// `ssqch/sass`: Sass to CSS at the start of each build, so fingerprinting and the link checker
// see the CSS. Ported from `plugins/sass`, with its compiler: grass, at 0.7's version, built as
// WebAssembly (`wasm/sass.wasm`, from `crates/ssqch-sass`), so the CSS is 0.7's to the byte.
// (Dart Sass, the `sass` package, writes it differently in places: `@media(` without the space
// when compressed, `hsl(0, 0%, 60%)` where grass has `0deg`, custom properties' whitespace.)
//
//   sassPlugin({ files: { "src/scss": "/css", "src/print.sass": "/print.css" }, style, loadPaths })
//
// A folder compiles every .scss and .sass file in it whose name doesn't start with `_` (those
// are partials), keeping their paths; a file compiles to the path given. The wasm reads files
// through Node, so the build knows every file a stylesheet used (`filesRead` in
// plugin-files.ts), for `ssqch serve` to rebuild when a partial changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssWithBase } from "../base.ts";
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile } from "../config.ts";
import { BuildError, bail, messageOf } from "../diagnostics.ts";
import { WebAssembly } from "../engines/webassembly.ts";
import type { WasmMemory, WasmModule } from "../engines/webassembly.ts";
import { comparePaths, displayPath, isInside, realPath, slashes } from "../paths.ts";
import { startReading } from "../plugin-files.ts";
import { wasi } from "../rust-plugin.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

type Style = "compressed" | "expanded";

export function sassPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/sass", builtin: "ssqch/sass", options };
}

const isSass = (file: string) => file.endsWith(".scss") || file.endsWith(".sass");

/** The sources an entry compiles, and each one's output URL path. */
function entries(root: string, from: string, to: string): Array<[string, string]> {
	const src = path.resolve(root, from);
	const stat = fs.statSync(src, { throwIfNoEntry: false });
	if (stat?.isFile()) {
		if (!isSass(src)) bail(`files: ${from} isn't a .scss or .sass file`);
		return [[src, to.endsWith("/") ? `${to}${path.basename(src).replace(/\.s[ac]ss$/, "")}.css` : to]];
	}
	if (!stat?.isDirectory()) bail(`files: ${from} doesn't exist`);
	const out: Array<[string, string]> = [];
	// As walkdir did: links aren't followed, hidden folders aren't skipped.
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (entry.isFile() && isSass(entry.name) && !entry.name.startsWith("_")) {
				out.push([file, `${to.replace(/\/+$/, "")}/${slashes(path.relative(src, file)).replace(/\.s[ac]ss$/, "")}.css`]);
			}
		}
	};
	walk(src);
	return out.sort((a, b) => comparePaths(a[0], b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

BUILTINS.set("ssqch/sass", (config: Config, given) => {
	const o = new Options(given, ["files", "style", "loadPaths"]);
	const files: Array<[string, string]> = [];
	const map = o.get("files");
	if (map !== undefined) {
		if (typeof map !== "object" || Array.isArray(map)) bail("files must be an object of { source: \"/output\" }");
		for (const [from, to] of Object.entries(map as Record<string, unknown>)) {
			if (typeof to !== "string") bail(`files.${from}: the output must be a URL path string`);
			files.push([from, to]);
		}
	}
	const style = o.string("style");
	if (style !== undefined && style !== "compressed" && style !== "expanded") bail(`style must be "compressed" or "expanded", not ${debugString(style)}`);
	const loadPaths = o.list("loadPaths") ?? [];
	if (!files.length) bail("files is required: { \"src/scss\": \"/css\" } or { \"src/app.scss\": \"/app.css\" }");
	for (const [from, to] of files) {
		if (!to.startsWith("/") || to.includes("..")) bail(`files: ${debugString(to)} must be a URL path starting with / (like "/css/app.css" or "/css")`);
		if (from === "") bail("files: a source path can't be empty");
	}

	// A file's partials are usually beside it (`_colors.scss` next to `main.scss`), so its folder
	// is watched too, unless that's the project root. So are the load paths.
	for (const [from] of files) {
		config.watch.push(from);
		// The folder as Rust's `Path::parent` has it: none for a bare name (`app.scss`), `.` for `./app.scss`.
		const slash = Math.max(from.lastIndexOf("/"), from.lastIndexOf(path.sep));
		const dir = slash < 0 ? "" : slash === 0 ? from.slice(0, 1) : from.slice(0, slash);
		if (isSass(from) && dir !== "") config.watch.push(dir);
	}
	for (const dir of loadPaths) config.watch.push(dir);

	let count: [number, Style] | undefined;
	config.fileBuilders.push(["ssqch/sass", (config) => {
		const chosen: Style = (style as Style | undefined) ?? (config.env === "production" && !config.serving ? "compressed" : "expanded");
		// Sources, partials and anything they load (`filesRead` in plugin-files.ts).
		const used = startReading(config, "ssqch/sass");
		const compiler = new Compiler(config.root, used, loadPaths.map((dir) => path.resolve(config.root, dir)));
		const options = JSON.stringify({ style: chosen, loadPaths: loadPaths.map((dir) => compiler.name(path.resolve(config.root, dir))) });
		const out: GeneratedFile[] = [];
		for (const [from, to] of files) {
			for (const [src, url] of entries(config.root, from, to)) {
				const shown = displayPath(config.root, src);
				const css = compiler.compile(src, options, shown);
				// `url(/fonts/a.woff2)` gets the site's `base`, like URLs in HTML.
				out.push({ path: url, contents: cssWithBase(config.base, css) });
			}
		}
		count = [out.length, chosen];
		return out;
	}]);
	config.summaries.push(["Sass", () => (count === undefined ? undefined : `${count[0]} file${count[0] === 1 ? "" : "s"} (${count[1]})`)]);
});

// ---- the wasm --------------------------------------------------------------------------------

/** The file, next to `src/`. */
const WASM_FILE = fileURLToPath(new URL("../../wasm/sass.wasm", import.meta.url));

interface Exports {
	memory: WasmMemory;
	_initialize(): void;
	sass_alloc(len: number): number;
	sass_compile(ptr: number, pathLen: number, optionsLen: number): number;
	sass_result_ptr(): number;
	sass_result_len(): number;
	sass_panic(): void;
}

let compiled: WasmModule | undefined;
/** One instance for the process, made again after a crash. */
let current: Exports | undefined;
/** The build compiling now: who answers the wasm's reads. */
let active: Compiler | undefined;

/** Compiles stylesheets for one build, answering grass's reads from the project root. */
class Compiler {
	root: string;
	used: Set<string>;
	loadPaths: string[];
	constructor(root: string, used: Set<string>, loadPaths: string[] = []) {
		this.root = root;
		this.used = used;
		this.loadPaths = loadPaths;
	}

	/**
	 * A stylesheet as grass should read it. Two things other compilers take that grass doesn't:
	 *
	 * - Front matter (Jekyll's `---` lines at the top of a site's main stylesheet) becomes blank
	 *   lines, so error lines still match the file. Sass can't start with `---`, so nothing that
	 *   compiled before reads differently.
	 * - An `@import`, `@use` or `@forward` that names its extension (`"primer-core/index.scss"`)
	 *   is found in the load paths too: grass 0.13 looks for one only beside the importing file
	 *   (`find_import`, "todo: consider load paths"), and Dart Sass and Ruby Sass look in both.
	 *   Where the file isn't beside the importer but is in a load path, the import names it from
	 *   the importer's folder. primer's packages all import this way (opensource.guide, osg #10).
	 */
	source(file: string, data: Buffer): Buffer {
		if (!isSass(file)) return data;
		let text = data.toString("utf8");
		const front = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
		if (front) text = front[0].replace(/[^\n]/g, "") + text.slice(front[0].length);
		const dir = path.dirname(file);
		const exists = (base: string, name: string) => {
			const full = path.resolve(base, name);
			const partial = path.join(path.dirname(full), `_${path.basename(full)}`);
			return fs.existsSync(full) ? full : fs.existsSync(partial) ? partial : undefined;
		};
		const changed = text.replace(/@(import|use|forward)(\s+)([^;{}]+)/g, (statement, rule, space, rest) => `@${rule}${space}${rest.replace(/(["'])([^"'\n]+\.s[ac]ss)\1/g, (quoted: string, q: string, name: string) => {
			if (path.isAbsolute(name) || /^[a-z]+:/i.test(name) || exists(dir, name)) return quoted;
			for (const load of this.loadPaths) {
				const found = exists(load, name);
				if (found) return `${q}${slashes(path.relative(dir, path.join(path.dirname(found), path.basename(name))))}${q}`;
			}
			return quoted;
		})}`);
		return front || changed !== text ? Buffer.from(changed, "utf8") : data;
	}

	/** A path as grass sees it: from the root for the site's own files, else whole; with `/`. */
	name(file: string): string {
		return isInside(this.root, file) && file !== this.root ? slashes(path.relative(this.root, file)) : slashes(file);
	}

	/** A path grass gave back, as a real one. */
	file(name: string): string {
		return path.resolve(this.root, name);
	}

	compile(src: string, options: string, shown: string): string {
		const x = instance();
		const parts = [this.name(src), options];
		const lens = parts.map((p) => Buffer.byteLength(p, "utf8"));
		const ptr = x.sass_alloc(lens[0] + lens[1]);
		const bytes = Buffer.from(x.memory.buffer);
		bytes.write(parts[0], ptr, lens[0], "utf8");
		bytes.write(parts[1], ptr + lens[0], lens[1], "utf8");
		active = this;
		let status: number;
		try {
			status = x.sass_compile(ptr, lens[0], lens[1]);
		} catch (e) {
			current = undefined;
			let message = messageOf(e);
			if (e instanceof WebAssembly.RuntimeError) {
				try { x.sass_panic(); message = resultOf(x) || message; } catch {}
			}
			throw new BuildError(`compiling ${shown}: ssqch's Sass crashed (${message.replace(/\s*\n\s*/g, " ")})`);
		} finally {
			active = undefined;
		}
		const text = resultOf(x);
		if (status !== 0) throw new BuildError(`compiling ${shown}: ${shown}: ${text}`);
		return text;
	}
}

function resultOf(x: Exports): string {
	const ptr = x.sass_result_ptr();
	return Buffer.from(x.memory.buffer).toString("utf8", ptr, ptr + x.sass_result_len());
}

function instance(): Exports {
	if (current) return current;
	if (!compiled) {
		let bytes: Buffer;
		try { bytes = fs.readFileSync(WASM_FILE); } catch (e) { throw new BuildError(`ssqch's Sass isn't there (${WASM_FILE}: ${messageOf(e)}); build it with node packages/ssqch/scripts/build-wasm.ts sass`); }
		compiled = new WebAssembly.Module(bytes);
	}
	let x: Exports | undefined;
	const memory = () => x!.memory;
	const text = (ptr: number, len: number) => Buffer.from(x!.memory.buffer).toString("utf8", ptr, ptr + len);
	// Leaves `answer` where the wasm reads it: a buffer of its own, its address and length at `out`.
	const reply = (out: number, status: number, answer: Uint8Array | string): number => {
		const data = typeof answer === "string" ? Buffer.from(answer, "utf8") : answer;
		const ptr = x!.sass_alloc(data.length);
		const bytes = Buffer.from(x!.memory.buffer);
		bytes.set(data, ptr);
		bytes.writeUInt32LE(ptr, out);
		bytes.writeUInt32LE(data.length, out + 4);
		return status;
	};
	const stat = (ptr: number, len: number) => fs.statSync(active!.file(text(ptr, len)), { throwIfNoEntry: false });
	const host = {
		is_file: (ptr: number, len: number) => (stat(ptr, len)?.isFile() ? 1 : 0),
		is_dir: (ptr: number, len: number) => (stat(ptr, len)?.isDirectory() ? 1 : 0),
		read: (ptr: number, len: number, out: number) => {
			const file = active!.file(text(ptr, len));
			try {
				const data = active!.source(file, fs.readFileSync(file));
				active!.used.add(realPath(file));
				return reply(out, 0, data);
			} catch (e) {
				return reply(out, 1, messageOf(e));
			}
		},
		// The same file under two names is one module (grass uses it to load each once).
		canonicalize: (ptr: number, len: number, out: number) => {
			try {
				return reply(out, 0, active!.name(fs.realpathSync.native(active!.file(text(ptr, len)))));
			} catch (e) {
				return reply(out, 1, messageOf(e));
			}
		},
	};
	x = new WebAssembly.Instance(compiled, { wasi_snapshot_preview1: wasi(memory), ssqch: host }).exports as unknown as Exports;
	x._initialize();
	return current = x;
}
