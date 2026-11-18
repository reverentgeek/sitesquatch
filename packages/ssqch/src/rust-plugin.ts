// Plugins written in Rust: a `.wasm` file built with the `ssqch-plugin` crate
// (`crates/ssqch-plugin`), run in Node's own WebAssembly, the same file on every platform. A
// plugin's npm package returns `{ name, rust: { wasm, options } }`, and the config wires its
// hooks in: its transform, its filters and its engines, as its manifest lists them.
//
// ABI v1, which the crate documents (`crates/ssqch-plugin/src/lib.rs`, `__wasm`): the manifest is
// the module's custom section `ssqch_plugin`, read without running anything; a call writes its
// inputs one after another into a buffer the plugin keeps (`ssqch_reserve`), and the answer is in
// the result slot (`ssqch_result`). A plugin imports only `wasi_snapshot_preview1`, which this
// answers with no files, network or environment. A trap (a panic) throws the instance away, and
// the next call starts a fresh one with the same options.
//
// ssqch's own minifier is a plugin like this one (`wasm/minify.wasm`, `modules/minify.ts`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BuildError, messageOf } from "./diagnostics.ts";
import { displayPath } from "./paths.ts";
import { WebAssembly } from "./engines/webassembly.ts";
import type { WasmMemory, WasmModule } from "./engines/webassembly.ts";

/** The plugin ABI this ssqch loads. */
export const ABI_VERSION = 1;

/** What a plugin says about itself: the `ssqch_plugin` section. */
export interface Manifest {
	abi: number;
	name: string;
	version: string;
	sdk: string;
	hooks: string[];
	filters: string[];
	engines: string[];
}

/** The page a call is about. */
export interface PluginPage {
	url?: string;
	inputPath?: string;
	outputPath?: string;
	/** The page's data as JSON text (engines only). */
	dataJson?: string;
}

const OK = 0;
const UNCHANGED = 1;
const ERROR = 2;
const WASI_EBADF = 8;
const WASI_ENOSYS = 52;

const EXPORTS = ["memory", "ssqch_reserve", "ssqch_result", "ssqch_init", "ssqch_transform", "ssqch_filter", "ssqch_render"] as const;

interface Exports {
	memory: WasmMemory;
	_initialize?: () => void;
	ssqch_reserve(len: number): number;
	ssqch_result(): number;
	ssqch_init(optionsLen: number): number;
	ssqch_transform(htmlLen: number, pageLen: number): number;
	ssqch_filter(nameLen: number, argsLen: number): number;
	ssqch_render(extLen: number, sourceLen: number, pageLen: number): number;
}

/** The manifest of a compiled plugin, refused when it isn't one or was built for another ABI. `file` is how errors name it. */
export function readManifest(module: WasmModule, file: string): Manifest {
	const sections = WebAssembly.Module.customSections(module, "ssqch_plugin");
	if (sections.length === 0) throw new BuildError(`${file}: not an ssqch plugin (it has no ssqch_plugin section; was it built with ssqch_plugin::export!?)`);
	let manifest: Manifest;
	try {
		manifest = JSON.parse(Buffer.from(sections[0]).toString("utf8"));
	} catch (e) {
		throw new BuildError(`${file}: not an ssqch plugin (its ssqch_plugin section isn't JSON: ${messageOf(e)})`);
	}
	if (manifest.abi !== ABI_VERSION) {
		const hint = typeof manifest.abi === "number" && manifest.abi > ABI_VERSION ? `update ssqch, or use a version of the plugin built for ABI ${ABI_VERSION}` : "rebuild it with a current ssqch-plugin";
		throw new BuildError(`${file}: built for plugin ABI ${manifest.abi}, and this ssqch loads ABI ${ABI_VERSION}: ${hint}`);
	}
	for (const key of ["hooks", "filters", "engines"] as const) {
		if (!Array.isArray(manifest[key])) throw new BuildError(`${file}: not an ssqch plugin (its manifest has no ${key} list)`);
	}
	if (typeof manifest.name !== "string" || manifest.name === "") throw new BuildError(`${file}: not an ssqch plugin (its manifest has no name)`);
	return manifest;
}

/** What a plugin answered with an error (or a panic): `plugin: what: detail`, or `plugin: detail` for its options. */
export class PluginCallError extends BuildError {
	plugin: string;
	what: string;
	detail: string;
	constructor(plugin: string, what: string, detail: string) {
		super(what === "" ? `${plugin}: ${detail}` : `${plugin}: ${what}: ${detail}`);
		this.plugin = plugin;
		this.what = what;
		this.detail = detail;
	}
}

/** Compiled plugins by file, kept while the file doesn't change (`ssqch serve` reads the config again). */
const compiled = new Map<string, { stamp: string; module: WasmModule }>();

/** Reads and compiles a plugin file. `shown` is how errors name it. */
export function compilePlugin(file: string, shown: string): WasmModule {
	let stat: fs.Stats;
	try { stat = fs.statSync(file); } catch { throw new BuildError(`${shown} doesn't exist`); }
	if (!stat.isFile()) throw new BuildError(`${shown} isn't a file`);
	const stamp = `${stat.size}:${stat.mtimeMs}`;
	const kept = compiled.get(file);
	if (kept?.stamp === stamp) return kept.module;
	let module: WasmModule;
	try {
		module = new WebAssembly.Module(fs.readFileSync(file));
	} catch (e) {
		throw new BuildError(`${shown}: not an ssqch plugin (it isn't WebAssembly: ${messageOf(e).replace(/^WebAssembly\.Module\(\): /, "")})`);
	}
	compiled.set(file, { stamp, module });
	return module;
}

/**
 * One plugin, from its compiled module and its options: one instance at a time, started again
 * after a trap. Calls are synchronous, and a plugin never calls back, so they don't nest.
 */
export class RustPlugin {
	readonly manifest: Manifest;
	readonly file: string;
	#module: WasmModule;
	#options: string;
	#x: Exports | null = null;
	#bytes = Buffer.alloc(0);
	#slot = 0;
	#scratch = 0;
	#room = -1;

	/** Starts the plugin, so options it refuses fail now, before any page. */
	constructor(module: WasmModule, options: unknown, file: string) {
		this.#module = module;
		this.file = file;
		this.manifest = readManifest(module, file);
		for (const i of WebAssembly.Module.imports(module)) {
			if (i.module !== "wasi_snapshot_preview1") throw new BuildError(`${file}: it imports ${i.module}.${i.name}, which ssqch doesn't provide (plugins can use std; ssqch answers wasi_snapshot_preview1 calls without files or network)`);
		}
		let json: string;
		try { json = options === undefined ? "" : JSON.stringify(options) ?? ""; } catch (e) { throw new BuildError(`${this.name}: options: ${messageOf(e)}`); }
		this.#options = json;
		this.#start();
	}

	get name(): string {
		return this.manifest.name;
	}

	#start(): Exports {
		let memory: WasmMemory | undefined;
		const instance = new WebAssembly.Instance(this.#module, { wasi_snapshot_preview1: wasi(() => memory!) });
		const x = instance.exports as unknown as Exports;
		for (const name of EXPORTS) {
			if (x[name] === undefined) throw new BuildError(`${this.file}: not an ssqch plugin (no ${name} export)`);
		}
		memory = x.memory;
		this.#x = x;
		// A fresh instance has its own memory: its buffer is reserved on the first call.
		this.#bytes = Buffer.alloc(0);
		this.#room = -1;
		this.#scratch = 0;
		try {
			x._initialize?.();
		} catch (e) {
			this.#x = null;
			throw new BuildError(`${this.name}: crashed while starting (${messageOf(e)})`);
		}
		this.#slot = x.ssqch_result();
		const status = this.#call([this.#options], (l) => x.ssqch_init(l[0]), () => "options");
		if (status !== OK && status !== UNCHANGED) {
			const message = status === ERROR ? this.#result() : `answered with status ${status}`;
			this.#x = null;
			throw new PluginCallError(this.name, "", message);
		}
		return x;
	}

	#view(): Buffer {
		const memory = this.#x!.memory.buffer;
		if (this.#bytes.buffer !== memory) this.#bytes = Buffer.from(memory);
		return this.#bytes;
	}

	#result(): string {
		const b = this.#view();
		const ptr = b.readUInt32LE(this.#slot);
		const len = b.readUInt32LE(this.#slot + 4);
		return b.toString("utf8", ptr, ptr + len);
	}

	/** Writes the inputs one after another into the plugin's buffer, then makes the call. `what` names the call for errors. */
	#call(inputs: string[], call: (lens: number[]) => number, what: () => string): number {
		const x = this.#x ?? this.#start();
		let total = 0;
		const lens = inputs.map((s) => {
			const n = Buffer.byteLength(s, "utf8");
			total += n;
			return n;
		});
		try {
			if (total > this.#room) {
				this.#scratch = x.ssqch_reserve(total);
				this.#room = total;
			}
			const b = this.#view();
			let at = this.#scratch;
			for (let i = 0; i < inputs.length; i++) at += b.write(inputs[i], at, lens[i], "utf8");
			return call(lens);
		} catch (e) {
			if (e instanceof BuildError) throw e;
			// A trap: this instance's memory can't be trusted. The next call starts another.
			let panicked = false;
			let message = "";
			try {
				panicked = this.#view().readUInt32LE(this.#slot + 8) === 1;
				if (panicked) message = this.#result().replace(/^panicked at /, "").replace(/\s*\n\s*/g, " ");
			} catch {}
			this.#x = null;
			throw new PluginCallError(this.name, what(), panicked ? `panicked at ${message}` : `crashed (${messageOf(e)})`);
		}
	}

	#finish(status: number, what: () => string): string | null {
		if (status === OK) return this.#result();
		if (status === UNCHANGED) return null;
		throw new PluginCallError(this.name, what(), status === ERROR ? this.#result() : `answered with status ${status}`);
	}

	/** A page's HTML rewritten, or `null` when it's unchanged (or the plugin has no transform). */
	transform(html: string, page: PluginPage = {}): string | null {
		if (!this.manifest.hooks.includes("transform")) return null;
		const what = () => `transform of ${page.url || page.outputPath || "a page"}`;
		return this.#finish(this.#call([html, pageText(page)], (l) => this.#x!.ssqch_transform(l[0], l[1]), what), what);
	}

	/** A filter's answer, for arguments as JSON text, as JSON text. */
	filterJson(name: string, argsJson: string): string {
		if (!this.manifest.filters.includes(name)) throw new BuildError(`${this.name}: no filter named ${name} (it provides ${this.manifest.filters.join(", ") || "none"})`);
		const what = () => `filter ${name}`;
		return this.#finish(this.#call([name, argsJson], (l) => this.#x!.ssqch_filter(l[0], l[1]), what), what) ?? "null";
	}

	/** A filter's answer, for arguments JSON can carry. */
	filter(name: string, args: unknown[]): unknown {
		return JSON.parse(this.filterJson(name, toJson(args)));
	}

	/** A file of an extension the plugin renders (without the dot), as HTML. */
	render(ext: string, source: string, page: PluginPage = {}): string {
		if (!this.manifest.engines.includes(ext)) throw new BuildError(`${this.name}: doesn't render .${ext} files (it renders ${this.manifest.engines.map((e) => `.${e}`).join(", ") || "none"})`);
		const what = () => `render of ${page.inputPath || page.url || `a .${ext} file`}`;
		return this.#finish(this.#call([ext, source, pageText(page)], (l) => this.#x!.ssqch_render(l[0], l[1], l[2]), what), what) ?? "";
	}
}

function pageText(page: PluginPage): string {
	return `${page.url ?? ""}\0${page.inputPath ?? ""}\0${page.outputPath ?? ""}\0${page.dataJson ?? ""}`;
}

/**
 * Values as JSON for a plugin: what `JSON.stringify` writes, except that a getter isn't read
 * (a collection's page renders its content when `templateContent` is read), a value met again
 * inside itself is `null`, and a `bigint` is its digits.
 */
export function toJson(value: unknown, skip?: string): string {
	const inside = new Set<object>();
	const walk = (v: unknown): unknown => {
		if (v === null || typeof v !== "object") {
			if (typeof v === "bigint") return v.toString();
			return typeof v === "function" || typeof v === "symbol" ? undefined : v;
		}
		if (typeof (v as { toJSON?: unknown }).toJSON === "function") return walk((v as { toJSON: () => unknown }).toJSON());
		if (inside.has(v)) return null;
		inside.add(v);
		try {
			if (Array.isArray(v)) return v.map((item) => walk(item) ?? null);
			const out: Record<string, unknown> = {};
			for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
				if (!descriptor.enumerable || !("value" in descriptor)) continue;
				const item = walk(descriptor.value);
				if (item !== undefined) out[key] = item;
			}
			return out;
		} finally {
			inside.delete(v);
		}
	};
	if (skip !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)) {
		const { [skip]: _, ...rest } = value as Record<string, unknown>;
		value = rest;
	}
	return JSON.stringify(walk(value) ?? null);
}

/**
 * The `wasi_snapshot_preview1` calls Rust's std makes: no environment or arguments, real clocks,
 * a fixed-seed random generator (so a `HashMap`'s order repeats from build to build), and
 * standard error for anything printed. Anything else (files, sockets) isn't there: no folder is
 * open, and the rest answer "not supported".
 */
export function wasi(memory: () => WasmMemory): Record<string, (...args: any[]) => number> {
	let seed = 0x5eed5ca7c4edf007n;
	const mask = (1n << 64n) - 1n;
	const view = () => new DataView(memory().buffer);
	const known: Record<string, (...args: any[]) => number> = {
		environ_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
		environ_get: () => 0,
		args_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
		args_get: () => 0,
		clock_time_get: (id: number, _precision: bigint, out: number) => {
			view().setBigUint64(out, id === 0 ? BigInt(Date.now()) * 1000000n : process.hrtime.bigint(), true);
			return 0;
		},
		fd_write: (fd: number, iovs: number, count: number, written: number) => {
			const v = view();
			let total = 0;
			for (let i = 0; i < count; i++) {
				const ptr = v.getUint32(iovs + i * 8, true);
				const len = v.getUint32(iovs + i * 8 + 4, true);
				if (fd === 1 || fd === 2) process.stderr.write(new Uint8Array(memory().buffer, ptr, len).slice());
				total += len;
			}
			v.setUint32(written, total, true);
			return 0;
		},
		random_get: (ptr: number, len: number) => {
			const bytes = new Uint8Array(memory().buffer, ptr, len);
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
		fd_prestat_get: () => WASI_EBADF,
		proc_exit: (code: number) => { throw new WebAssembly.RuntimeError(`the plugin called exit(${code})`); },
	};
	return new Proxy(known, { get: (target, name: string) => target[name] ?? (() => WASI_ENOSYS) });
}

/** A Rust plugin as a config gives it: `rust: { wasm, options }`. */
export interface RustPart {
	plugin: RustPlugin;
	/** The transform, for HTML pages, named as the plugin is. */
	transform?: [string, (content: string, page: { url: string; inputPath: string; outputPath: string }) => string];
	filters: Array<[string, (...args: unknown[]) => unknown]>;
	engines: Array<[string, (source: string, data: Record<string, any>, inputPath: string) => string]>;
}

/**
 * Loads `rust: { wasm, options }` from a config (`where` names the plugin in errors) and makes
 * its hooks. `wasm` is a path, absolute or from the project root (a package gives it absolute,
 * from `import.meta.url`).
 */
export function loadRustPart(rust: unknown, where: string, root: string): RustPart {
	if (rust === null || typeof rust !== "object" || Array.isArray(rust)) throw new BuildError(`${where}: rust must be an object, like { wasm: "/path/to/plugin.wasm", options: {} }`);
	const part = rust as Record<string, unknown>;
	for (const key of Object.keys(part)) {
		if (key !== "wasm" && key !== "options") throw new BuildError(`${where}: rust.${key} isn't an option (options: wasm, options)`);
	}
	if (typeof part.wasm !== "string" || part.wasm.trim() === "") throw new BuildError(`${where}: rust.wasm must be the path to the plugin's .wasm file`);
	const file = path.resolve(root, part.wasm.startsWith("file:") ? fileURLToPath(part.wasm) : part.wasm);
	const shown = displayPath(root, file);
	let plugin: RustPlugin;
	try {
		plugin = new RustPlugin(compilePlugin(file, shown), part.options, shown);
	} catch (e) {
		// `plugin "trail-guide": options: ...`, without the name twice.
		if (e instanceof PluginCallError && where.endsWith(`"${e.plugin}"`)) throw new BuildError(`${where}: ${e.what === "" ? "" : `${e.what}: `}${e.detail}`);
		throw new BuildError(`${where}: ${messageOf(e)}`);
	}
	const { manifest } = plugin;
	const loaded: RustPart = { plugin, filters: [], engines: [] };
	// Each hook's error, in the words around it: the build already says which transform failed
	// for which page, and a template which filter it called.
	const said = <T>(call: () => T, words: (e: PluginCallError) => string): T => {
		try {
			return call();
		} catch (e) {
			throw e instanceof PluginCallError ? new BuildError(words(e)) : e;
		}
	};
	if (manifest.hooks.includes("transform")) {
		// HTML pages only, as 0.7's Rust transforms did (`TransformContext::is_html`).
		loaded.transform = [manifest.name, (content, page) => (page.outputPath.endsWith(".html") ? said(() => plugin.transform(content, page), (e) => e.detail) ?? content : content)];
	}
	for (const name of manifest.filters) loaded.filters.push([name, (...args: unknown[]) => said(() => plugin.filter(name, args), (e) => `${e.plugin}: ${e.detail}`)]);
	for (const ext of manifest.engines) {
		loaded.engines.push([ext, (source, data, inputPath) => {
			const page = data?.page ?? {};
			const dataJson = toJson(data, "collections");
			// `line 3: ...` is a line of the template (after its front matter): said as `file:3:`, the
			// build's errors count it as a line of the file and show it.
			return said(() => plugin.render(ext, source, { url: page.url ?? "", inputPath: page.inputPath ?? inputPath, outputPath: page.outputPath ?? "", dataJson }), (e) => `${e.plugin}: ${e.detail.replace(/^line (\d+): /, `${inputPath}:$1: `)}`);
		}]);
	}
	return loaded;
}
