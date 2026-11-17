// Markdown, for `.md` files and the `markdown()` and `highlight()` functions: ssqch's own, 0.7's
// `markdown.rs` and `highlight.rs` built as WebAssembly (`wasm/markdown.wasm`, from
// `crates/ssqch-markdown`; `scripts/build-wasm.ts` builds it again). So a page comes out as 0.7
// wrote it: the same HTML, heading ids, footnotes, alerts, containers and `hl-*` classes, and a
// site's `.sublime-syntax` grammars.
//
// The wasm calls back here for what's the site's: render hooks and containers
// (`_includes/hooks/*`, `_includes/containers/*`), rendered by the site's engines with the page's
// data, and the config's functions (`headingIds: text => id`, highlighters in
// `markdown.highlight.languages`). Those calls are synchronous, so a hook whose engine answers
// with a promise is an error that names the hook. `crates/ssqch-markdown/src/wasm.rs` is the
// other side of this file, and the two change together.
//
// One instance serves the whole process, so the fences it has highlighted are kept across the
// builds `ssqch serve` runs (the wasm drops them when the languages change, or when a build
// didn't use them).
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Data } from "../data.ts";
import { isPlainObject, parseFrontMatter, readText } from "../data.ts";
import { BuildError, Diagnostics, context, messageOf, warn, warning } from "../diagnostics.ts";
import type { MarkdownOptions } from "../markdown-options.ts";
import { describeThrown } from "../modules.ts";
import { comparePaths } from "../paths.ts";
import * as voice from "../voice.ts";
import type { Engines, RenderContext, TemplateEngine } from "./engine.ts";
import { WebAssembly } from "./webassembly.ts";
import type { WasmImports, WasmMemory, WasmModule } from "./webassembly.ts";

export interface Markdown extends TemplateEngine {
	/** `markdown(text)` in a template: the site's options and render hooks (which get no page data), or without the `<p>` when `inline`. */
	html(text: string, inline: boolean): string;
	/** The `ssqch` module's `markdown()`: the site's options, without render hooks. */
	plain(text: string, inline: boolean): string;
	/** `highlight(code, lang)`: highlighted HTML for inside a `<code>`, or `undefined` for a language without a highlighter. */
	highlight(code: string, lang: string): string | undefined;
	/** The highlighting stylesheet. */
	css(): string;
	/** The site's render hooks and containers, and the engines that render them. */
	useHooks(hooks: Map<string, HookTemplate>, engines: Engines): void;
}

/** A render hook or container template from `_includes/hooks/` or `_includes/containers/`. */
export interface HookTemplate {
	/** `_includes/hooks/heading.edge`, for errors. */
	name: string;
	/** The engines it runs through (`.html` ones get `htmlEngine` first). */
	engines: string[];
	body: string;
	/** The file, for includes relative to it. */
	path: string;
}

/**
 * Reads `_includes/hooks/*` and `_includes/containers/*` from `dir`, keyed by `hooks/heading`,
 * `containers/note`. Each name can have one template, in any engine. `name` is how errors name
 * the folder (`_includes`, or `_includes (theme)`).
 */
export function loadHookTemplates(dir: string, name: string, engines: Engines, chain: (ext: string) => string[]): Map<string, HookTemplate> {
	const out = new Map<string, HookTemplate>();
	for (const kind of ["hooks", "containers"]) {
		let files: string[];
		try { files = fs.readdirSync(path.join(dir, kind)); } catch { continue; }
		for (const file of files.sort(comparePaths)) {
			const full = path.join(dir, kind, file);
			if (file.startsWith(".") || !fs.statSync(full, { throwIfNoEntry: false })?.isFile()) continue;
			const dot = file.lastIndexOf(".");
			if (dot <= 0) continue;
			const shown = `${name}/${kind}/${file}`;
			const ext = file.slice(dot + 1).toLowerCase();
			try { engines.get(ext); } catch (e) { throw context(e, shown); }
			const key = `${kind}/${file.slice(0, dot)}`;
			const other = out.get(key);
			if (other) throw new BuildError(`${other.name} and ${shown} are both templates for \`${key}\`; keep one`);
			let src: string;
			try { src = readText(full); } catch (e) { throw context(e, `reading ${shown}`); }
			let body: string;
			try { body = parseFrontMatter(src).body; } catch (e) { throw context(e, shown); }
			out.set(key, { name: shown, engines: chain(ext), body, path: full });
		}
	}
	return out;
}

/**
 * With `markdown.highlight`, writes the highlighting stylesheet to its place in `output` (unless
 * `css` is false), and only when it changed, so a server doesn't see a new file each build.
 * Returns the file, for the build's list of what it wrote.
 */
export function writeHighlightCss(options: MarkdownOptions, output: string, markdown: Markdown): string[] {
	const url = options.highlight ? options.highlightCss : null;
	if (url === null) return [];
	const file = path.join(output, ...url.replace(/^\/+/, "").split("/"));
	const css = markdown.css();
	let before: string | undefined;
	try { before = fs.readFileSync(file, "utf8"); } catch {}
	if (before !== css) {
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, css);
		} catch (e) {
			throw context(e, `writing ${file}`);
		}
	}
	return [file];
}

// ---- the page being rendered ---------------------------------------------------------------

let page: string | undefined;

/**
 * While a page renders, warnings from its Markdown and its `highlight()` calls name it (a site's
 * highlighter that failed). Returns the page named before, to put back.
 */
export function rendering(file: string | undefined): string | undefined {
	const before = page;
	page = file?.replace(/^(\.\/)+/, "");
	return before;
}

// ---- the engine ----------------------------------------------------------------------------

const INLINE = 1;
const HOOKS = 2;

/** ssqch's Markdown with the site's options. `root` is the project root, where grammar files are read from. */
export function markdownEngine(options: MarkdownOptions, root = process.cwd()): Markdown {
	return new WasmMarkdown(options, root);
}

/**
 * Reads the site's `.sublime-syntax` grammars and checks its highlighters' aliases, as 0.7 did
 * when it read the config: a grammar that isn't there or can't be read, or aliases that go in a
 * circle, are the config's errors.
 */
export function checkLanguages(options: MarkdownOptions, root: string): void {
	if (!options.languages.length) return;
	const engine = new WasmMarkdown(options, root);
	engine.check();
	engine.close();
}

class WasmMarkdown implements Markdown {
	#options: MarkdownOptions;
	#root: string;
	#hooks = new Map<string, HookTemplate>();
	#engines: Engines | undefined;
	/** The config's functions, by the numbers the wasm calls them with. */
	#functions: Array<(...args: unknown[]) => unknown> = [];
	#setup: { json: string; files: Map<string, Buffer> } | undefined;
	#handle = -1;
	#wasm: Wasm | undefined;

	constructor(options: MarkdownOptions, root: string) {
		this.#options = options;
		this.#root = root;
	}

	render(source: string, data: Data, _ctx: RenderContext): string {
		return this.#markdown(source, HOOKS, data, page ?? pageOf(data));
	}

	html(text: string, inline: boolean): string {
		return this.#markdown(text, HOOKS | (inline ? INLINE : 0), {}, page);
	}

	plain(text: string, inline: boolean): string {
		return this.#markdown(text, inline ? INLINE : 0, {}, page);
	}

	highlight(code: string, lang: string): string | undefined {
		const wasm = this.#ready();
		const [ptr, lens] = wasm.input([code, lang, page ?? ""]);
		const [status, text, thrown] = wasm.run(this, {}, () => wasm.x.md_highlight(this.#handle, ptr, lens[0], lens[1], lens[2]));
		if (status === NOTHING) return undefined;
		if (status !== DONE) throw failure(text, thrown);
		return text;
	}

	css(): string {
		const wasm = this.#ready();
		const [status, text] = wasm.run(this, {}, () => wasm.x.md_css());
		return status === DONE ? text : "";
	}

	useHooks(hooks: Map<string, HookTemplate>, engines: Engines): void {
		this.#hooks = hooks;
		this.#engines = engines;
		// The wasm learns the hooks' names when it sets up.
		this.close();
		this.#setup = undefined;
	}

	/** Sets up now, so that what's wrong with the options is said now. */
	check(): void {
		this.#ready();
	}

	/** Lets the wasm forget this setup. */
	close(): void {
		if (this.#wasm && this.#handle >= 0 && !this.#wasm.dead) this.#wasm.x.md_drop(this.#handle);
		handles.unregister(this);
		this.#handle = -1;
		this.#wasm = undefined;
	}

	#markdown(source: string, flags: number, data: Data, file: string | undefined): string {
		const wasm = this.#ready();
		const [ptr, lens] = wasm.input([source, file ?? ""]);
		const [status, text, thrown] = wasm.run(this, data, () => wasm.x.md_render(this.#handle, ptr, lens[0], lens[1], flags));
		if (status !== DONE) throw failure(text, thrown);
		return text;
	}

	/** The wasm, with this setup made in it. */
	#ready(): Wasm {
		const wasm = instance();
		if (this.#wasm === wasm && this.#handle >= 0) return wasm;
		// A new instance (the first, or one after a panic) needs the setup made again.
		this.close();
		this.#setup ??= this.#describe();
		wasm.files = this.#setup.files;
		const [ptr, [len]] = wasm.input([this.#setup.json]);
		let handle: number;
		try {
			[handle] = wasm.run(this, {}, () => wasm.x.md_new(ptr, len));
		} finally {
			wasm.files = new Map();
		}
		if (handle < 0) throw new BuildError(wasm.result());
		this.#wasm = wasm;
		this.#handle = handle;
		handles.register(this, { wasm, handle }, this);
		return wasm;
	}

	/** The options as the wasm reads them (`crates/ssqch-markdown/src/options.rs`), and the grammar files it reads. */
	#describe(): { json: string; files: Map<string, Buffer> } {
		const o = this.#options;
		this.#functions = [];
		const number = (fn: (...args: unknown[]) => unknown) => this.#functions.push(fn) - 1;
		const files = new Map<string, Buffer>();
		// The same languages and grammars make the same key: their fences are shared between builds.
		const key: unknown[] = [];
		const languages = o.languages.map(([name, language]) => {
			if (typeof language === "function") {
				key.push([name]);
				return [name, { function: number(language as (...args: unknown[]) => unknown) }];
			}
			if ("alias" in language) {
				key.push([name, language.alias]);
				return [name, { alias: language.alias }];
			}
			const text = readGrammar(this.#root, name, language.grammar);
			files.set(wasmPath(language.grammar), text);
			key.push([name, language.grammar, crypto.createHash("sha256").update(text).digest("hex")]);
			return [name, { grammar: language.grammar }];
		});
		const json = JSON.stringify({
			headingIds: o.headingIds,
			headingAttributes: o.headingAttributes,
			footnotes: o.footnotes,
			taskLists: o.taskLists,
			autolinks: o.autolinks,
			alerts: o.alerts,
			containers: o.containers,
			definitionLists: o.definitionLists,
			smartPunctuation: o.smartPunctuation,
			indentedCode: o.indentedCode,
			highlight: o.highlight,
			highlightCss: o.highlightCss,
			languages,
			headingIdsFunction: o.sluggerFn ? number(o.sluggerFn as (...args: unknown[]) => unknown) : null,
			hooks: [...this.#hooks.keys()],
			languagesKey: JSON.stringify(key),
		});
		return { json, files };
	}

	/** A render hook for the wasm: the template `name` with the page's data and `value` as `key`. */
	renderHook(name: string, key: string, value: unknown, data: Data): string {
		const template = this.#hooks.get(name);
		const engines = this.#engines;
		if (!template || !engines) throw new BuildError(`no template for \`${name}\``);
		const hookData: Data = { ...(isPlainObject(data) ? data : {}), [key]: value };
		let text = template.body;
		for (const name of template.engines) {
			const engine = engines.get(name);
			const ctx: RenderContext = { name: template.name, inputPath: template.path, cacheKey: `${template.name}#${name}` };
			let out: string | Promise<string>;
			try { out = engine.render(text, hookData, ctx); } catch (e) { throw context(e, `rendering ${template.name}`); }
			if (typeof out !== "string") {
				out.catch(() => {});
				throw new BuildError(`rendering ${template.name}: it answered with a promise (from an async filter, function or engine), and render hooks and containers can't wait for one: they render while the Markdown around them does. Make what it calls synchronous`);
			}
			text = out;
		}
		return text;
	}

	/** One of the config's functions, for the wasm. */
	call(n: number, args: unknown[]): unknown {
		const fn = this.#functions[n];
		if (!fn) throw new BuildError(`no function ${n}`);
		const out = fn(...args);
		// 0.7 ran functions synchronously: a promise is what an async one returns, and its result is lost.
		if (out instanceof Promise) out.catch(() => {});
		return out;
	}

	/** What a function threw, as 0.7 said it: the message and the site's frames. */
	thrown(e: unknown): string {
		return describeThrown(e, this.#root);
	}
}

/** Lets the wasm forget a setup whose engine is gone (each build makes one). */
const handles = new FinalizationRegistry<{ wasm: Wasm; handle: number }>(({ wasm, handle }) => {
	if (!wasm.dead) wasm.x.md_drop(handle);
});

/** The page `data` belongs to, from the project root. */
function pageOf(data: Data): string | undefined {
	const input = isPlainObject(data) && isPlainObject(data.page) ? data.page.inputPath : undefined;
	return typeof input === "string" ? input.replace(/^(\.\/)+/, "") : undefined;
}

/** The error a call ended with: what a hook or function threw, kept as it was when the wasm passed it on unchanged. */
function failure(message: string, thrown: unknown): Error {
	if (thrown !== undefined && (thrown instanceof BuildError || thrown instanceof Diagnostics)) {
		const inner = messageOf(thrown);
		if (message === inner) return thrown;
		if (message.endsWith(`: ${inner}`)) return context(thrown, message.slice(0, -inner.length - 2));
	}
	return new BuildError(message);
}

/** A grammar file, from the project root, or the error 0.7 gave for one it couldn't read. */
function readGrammar(root: string, name: string, file: string): Buffer {
	try {
		return fs.readFileSync(path.resolve(root, file));
	} catch (e) {
		throw new BuildError(`markdown.highlight.languages.${name}: reading ${file}: ${ioError(e)}`);
	}
}

/** A file system error in Rust's words, as 0.7 printed it. */
function ioError(e: unknown): string {
	const code = (e as NodeJS.ErrnoException).code;
	if (code === "ENOENT") return process.platform === "win32" ? "The system cannot find the file specified. (os error 2)" : "No such file or directory (os error 2)";
	if (code === "EISDIR") return "Is a directory (os error 21)";
	if (code === "EACCES") return process.platform === "win32" ? "Access is denied. (os error 5)" : "Permission denied (os error 13)";
	return messageOf(e);
}

/** A grammar's path as the wasm asks for it: from `/`, its root. */
function wasmPath(file: string): string {
	return path.posix.normalize(file.replace(/^\/+/, ""));
}

// ---- the instance --------------------------------------------------------------------------

const DONE = 0;
const ERROR = 1;
const NOTHING = 2;

interface Exports {
	memory: WasmMemory;
	_initialize(): void;
	md_alloc(len: number): number;
	md_free(ptr: number, len: number): void;
	md_result_ptr(): number;
	md_result_len(): number;
	md_panic(): number;
	md_new(ptr: number, len: number): number;
	md_drop(handle: number): void;
	md_render(handle: number, ptr: number, sourceLen: number, pageLen: number, flags: number): number;
	md_highlight(handle: number, ptr: number, codeLen: number, langLen: number, pageLen: number): number;
	md_css(): number;
}

/** The file, next to `src/`. */
const WASM_FILE = fileURLToPath(new URL("../../wasm/markdown.wasm", import.meta.url));

let compiled: WasmModule | undefined;
let current: Wasm | undefined;

function instance(): Wasm {
	if (!current) {
		if (!compiled) {
			let bytes: Buffer;
			try { bytes = fs.readFileSync(WASM_FILE); } catch (e) { throw new BuildError(`ssqch's Markdown isn't there (${WASM_FILE}: ${messageOf(e)}); build it with node packages/ssqch/scripts/build-wasm.ts`); }
			compiled = new WebAssembly.Module(bytes);
		}
		current = new Wasm(compiled);
	}
	return current;
}

/** A call in progress: whose it is, the data its hooks get, and what a hook or function threw in it. */
interface Frame {
	owner: WasmMarkdown;
	data: Data;
	thrown?: unknown;
}

const WASI_EBADF = 8;
const WASI_ENOENT = 44;
const WASI_ENOSYS = 52;
/** The one folder the wasm can open files in: `/`, holding the files Node gives it. */
const ROOT_FD = 3;

class Wasm {
	x: Exports;
	/** Set by a trap (a panic in the Rust): this instance is done, and the next call starts another. */
	dead = false;
	/** Files the wasm can read while it sets up (a site's grammars), by their paths from `/`. */
	files = new Map<string, Buffer>();
	#open = new Map<number, { data: Buffer; at: number }>();
	#nextFd = ROOT_FD + 1;
	#frames: Frame[] = [];
	#bytes = Buffer.alloc(0);

	constructor(module: WasmModule) {
		const wasi = this.#wasi();
		const imports: WasmImports = {
			// Anything else std might ask for isn't there.
			wasi_snapshot_preview1: new Proxy(wasi, { get: (target, name: string) => target[name] ?? (() => WASI_ENOSYS) }),
			ssqch: this.#host(),
		};
		this.x = new WebAssembly.Instance(module, imports).exports as unknown as Exports;
		this.x._initialize();
	}

	/** The wasm's memory as a Buffer (a new one after the memory grows). */
	bytes(): Buffer {
		const buffer = this.x.memory.buffer;
		if (this.#bytes.buffer !== buffer) this.#bytes = Buffer.from(buffer);
		return this.#bytes;
	}

	/** Copies strings into one buffer the wasm takes: its address, and each string's length in bytes. */
	input(parts: string[]): [number, number[]] {
		const lens = parts.map((part) => Buffer.byteLength(part, "utf8"));
		const ptr = this.x.md_alloc(lens.reduce((sum, n) => sum + n, 0));
		const bytes = this.bytes();
		let at = ptr;
		parts.forEach((part, i) => { at += bytes.write(part, at, lens[i], "utf8"); });
		return [ptr, lens];
	}

	result(): string {
		const ptr = this.x.md_result_ptr();
		return this.bytes().toString("utf8", ptr, ptr + this.x.md_result_len());
	}

	/** Makes a call for `owner`, whose hooks get `data`: its status, its result, and what a call back threw. */
	run(owner: WasmMarkdown, data: Data, call: () => number): [number, string, unknown] {
		if (this.dead) throw internal("its WebAssembly stopped");
		const frame: Frame = { owner, data };
		this.#frames.push(frame);
		try {
			const status = call();
			if (this.dead) throw internal("its WebAssembly stopped");
			return [status, this.result(), frame.thrown];
		} catch (e) {
			if (e instanceof WebAssembly.RuntimeError) throw this.#trapped(e);
			// Anything else that came out through the wasm (a stack overflow) left it in a state
			// nothing can rely on.
			this.#stop();
			throw e;
		} finally {
			this.#frames.pop();
		}
	}

	#stop(): void {
		this.dead = true;
		if (current === this) current = undefined;
	}

	#trapped(e: Error): Error {
		this.#stop();
		let message = "";
		try {
			this.x.md_panic();
			message = this.result();
		} catch {}
		return internal(message || `it crashed (${e.message})`);
	}

	/** Leaves Node's answer to a call back where the wasm reads it. */
	#reply(out: number, status: number, text: string): number {
		const len = Buffer.byteLength(text, "utf8");
		const ptr = this.x.md_alloc(len);
		const bytes = this.bytes();
		bytes.write(text, ptr, len, "utf8");
		bytes.writeUInt32LE(ptr, out);
		bytes.writeUInt32LE(len, out + 4);
		return status;
	}

	#text(ptr: number, len: number): string {
		return this.bytes().toString("utf8", ptr, ptr + len);
	}

	/** What the wasm calls: nothing here may throw into it, so every answer is a status. */
	#host(): Record<string, unknown> {
		return {
			hook: (namePtr: number, nameLen: number, keyPtr: number, keyLen: number, valuePtr: number, valueLen: number, out: number) => {
				const frame = this.#frames[this.#frames.length - 1];
				try {
					const value = JSON.parse(this.#text(valuePtr, valueLen));
					return this.#reply(out, DONE, frame.owner.renderHook(this.#text(namePtr, nameLen), this.#text(keyPtr, keyLen), value, frame.data));
				} catch (e) {
					frame.thrown = e;
					return this.#reply(out, ERROR, messageOf(e));
				}
			},
			call: (n: number, argsPtr: number, argsLen: number, out: number) => {
				const frame = this.#frames[this.#frames.length - 1];
				try {
					const args = JSON.parse(this.#text(argsPtr, argsLen)) as unknown[];
					return this.#reply(out, DONE, toWasm(frame.owner.call(n, args)));
				} catch (e) {
					frame.thrown = e;
					return this.#reply(out, ERROR, frame.owner.thrown(e));
				}
			},
			warn: (codePtr: number, codeLen: number, messagePtr: number, messageLen: number, filePtr: number, fileLen: number) => {
				try {
					const file = this.#text(filePtr, fileLen);
					warn(warning(this.#text(codePtr, codeLen), this.#text(messagePtr, messageLen), file === "" ? {} : { file }));
				} catch {}
			},
		};
	}

	/**
	 * The calls Rust's std makes on `wasm32-wasip1`: no environment, real clocks, a fixed-seed
	 * random generator (a `HashMap`'s order then repeats), standard error for a stray print, and
	 * one folder, `/`, holding only the files Node gives it.
	 */
	#wasi(): Record<string, (...args: any[]) => number> {
		const view = () => new DataView(this.x.memory.buffer);
		let seed = 0x5eed5ca7c4edf007n;
		const mask = (1n << 64n) - 1n;
		return {
			environ_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
			environ_get: () => 0,
			args_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
			args_get: () => 0,
			clock_time_get: (id: number, _precision: bigint, out: number) => {
				view().setBigUint64(out, id === 0 ? BigInt(Date.now()) * 1000000n : process.hrtime.bigint(), true);
				return 0;
			},
			random_get: (ptr: number, len: number) => {
				const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
				for (let at = 0; at < len; at += 8) {
					// xorshift64*
					seed ^= seed >> 12n;
					seed = (seed ^ (seed << 25n)) & mask;
					seed ^= seed >> 27n;
					let v = (seed * 0x2545f4914f6cdd1dn) & mask;
					for (let i = 0; i < 8 && at + i < len; i++) {
						bytes[at + i] = Number(v & 0xffn);
						v >>= 8n;
					}
				}
				return 0;
			},
			fd_write: (fd: number, iovs: number, count: number, written: number) => {
				const v = view();
				let total = 0;
				for (let i = 0; i < count; i++) {
					const ptr = v.getUint32(iovs + i * 8, true);
					const len = v.getUint32(iovs + i * 8 + 4, true);
					if (fd === 1 || fd === 2) process.stderr.write(new Uint8Array(this.x.memory.buffer, ptr, len).slice());
					total += len;
				}
				v.setUint32(written, total, true);
				return 0;
			},
			fd_prestat_get: (fd: number, out: number) => {
				if (fd !== ROOT_FD) return WASI_EBADF;
				view().setUint8(out, 0);
				view().setUint32(out + 4, 1, true);
				return 0;
			},
			fd_prestat_dir_name: (fd: number, ptr: number, len: number) => {
				if (fd !== ROOT_FD || len < 1) return WASI_EBADF;
				view().setUint8(ptr, "/".charCodeAt(0));
				return 0;
			},
			fd_fdstat_get: (fd: number, out: number) => {
				const filetype = fd === ROOT_FD ? 3 : this.#open.has(fd) ? 4 : fd <= 2 ? 2 : -1;
				if (filetype < 0) return WASI_EBADF;
				const v = view();
				v.setUint8(out, filetype);
				v.setUint16(out + 2, 0, true);
				v.setBigUint64(out + 8, mask, true);
				v.setBigUint64(out + 16, mask, true);
				return 0;
			},
			fd_filestat_get: (fd: number, out: number) => {
				const file = this.#open.get(fd);
				if (!file) return WASI_EBADF;
				new Uint8Array(this.x.memory.buffer, out, 64).fill(0);
				view().setUint8(out + 16, 4);
				view().setBigUint64(out + 32, BigInt(file.data.length), true);
				return 0;
			},
			path_open: (dirfd: number, _dirflags: number, ptr: number, len: number, _oflags: number, _base: bigint, _inheriting: bigint, _fdflags: number, out: number) => {
				if (dirfd !== ROOT_FD) return WASI_EBADF;
				const data = this.files.get(wasmPath(this.#text(ptr, len)));
				if (!data) return WASI_ENOENT;
				const fd = this.#nextFd++;
				this.#open.set(fd, { data, at: 0 });
				view().setUint32(out, fd, true);
				return 0;
			},
			fd_read: (fd: number, iovs: number, count: number, read: number) => {
				const file = this.#open.get(fd);
				if (!file) return WASI_EBADF;
				const v = view();
				let total = 0;
				for (let i = 0; i < count && file.at < file.data.length; i++) {
					const ptr = v.getUint32(iovs + i * 8, true);
					const len = v.getUint32(iovs + i * 8 + 4, true);
					const n = file.data.copy(this.bytes(), ptr, file.at, Math.min(file.at + len, file.data.length));
					file.at += n;
					total += n;
				}
				v.setUint32(read, total, true);
				return 0;
			},
			fd_close: (fd: number) => (this.#open.delete(fd) || fd === ROOT_FD ? 0 : WASI_EBADF),
			proc_exit: (code: number) => { throw new Error(`exited with ${code}`); },
		};
	}
}

/** A panic in the Rust: a bug in ssqch, said as 0.7 said one (with the panic's message). */
function internal(message: string): BuildError {
	return new BuildError(`${voice.SOMETHING_LARGE}: internal error while processing ${page ?? "Markdown"}: ${message} (this is a bug in ssqch; please report it at ${voice.ISSUES_URL})`);
}

// What JSON loses that 0.7's messages name (`returned undefined, not a list of tokens`), marked
// as `crates/ssqch-markdown/src/json.rs` reads it.
const UNDEFINED = { "\0": "undefined" };
const FUNCTION = { "\0": "function" };

/** A value from a site's function as JSON for the wasm. */
function toWasm(value: unknown): string {
	return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
		const original = this[key];
		if (original instanceof Date) return { "\0": "date", v: Number.isNaN(original.getTime()) ? "" : original.toISOString() };
		if (v === undefined || typeof v === "symbol") return UNDEFINED;
		if (typeof v === "function") return FUNCTION;
		if (typeof v === "number" && !Number.isFinite(v)) return { "\0": String(v) };
		if (typeof v === "bigint") return Number(v);
		return v;
	});
}
