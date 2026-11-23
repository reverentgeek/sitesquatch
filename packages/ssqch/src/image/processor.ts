// Responsive images, ported from 0.7's `plugins/image` (`lib.rs`), with sharp as the encoder (D4).
//
// Every local `<img>` in HTML output becomes a `<picture>` with one `<source>` per modern format
// and a fallback `<img>`. Files are encoded into `.cache/ssqch/img/`, named by a hash of the
// source's contents and the encoder settings, and hard-linked (or copied) into `<output>/img/` on
// each build, so anything already made is reused, in a fresh CI checkout that restores
// `.cache/ssqch` too, and the output folder can go without encoding anything again.
//
// Per image: `ssqch:widths="300,600"` sets its widths, `ssqch:ignore` leaves the tag alone,
// `ssqch:preload` preloads it (a `<link rel="preload">` in `<head>`, and an eager load with
// `fetchpriority="high"`), and a plain `width` pins it to that one width.
//
// What's different from 0.7 is when the encoding happens. Everything a page's markup needs (the
// names, widths and heights) comes from the source's header and the hash, at once; the encodes
// are queued for sharp, which runs them on libuv's thread pool while pages go on rendering, and
// the build waits for them after the last page (before generators, `afterBuild` hooks and the
// summary, and counted as writing). `image()` waits for its own files, since it reports their
// sizes.
//
// Markup that points at files before they're made has to be right about them, so a source with
// a file to encode is read through first (`undecodable` in `header.ts`): one that 0.7 couldn't
// decode is a warning and its tag as written, as in 0.7, before any page points at a file of it.
// What's left (sharp failing on a source that read well, a full disk) can't take back the pages
// already written, so it fails the build, naming the source and the pages that point at it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { progressed, working } from "../activity.ts";
import { createRequire } from "node:module";
import { mapSrcset } from "../base.ts";
import { blake3 } from "../blake3.ts";
import type { Config } from "../config.ts";
import { BuildError, error, progress, warn, warning } from "../diagnostics.ts";
import { rewriteHtml } from "../html.ts";
import { displayPath, shown } from "../paths.ts";
import { bytes, count } from "../report.ts";
import { debugString, escapeHtml } from "../modules/plugin-util.ts";
import { colorPlan } from "./color.ts";
import type { ColorPlan } from "./color.ts";
import { CACHE_FILE, HashCache, stamp } from "./hashes.ts";
import { oriented, probeFile, undecodable } from "./header.ts";
import type { Decodable, Probe } from "./header.ts";
import { DEFAULTS, encodeSettings, legacySettings } from "./quality.ts";
import type { EncodeSettings } from "./quality.ts";

export type Format = "avif" | "webp" | "jpeg" | "png" | "gif" | "svg" | "auto";

const FORMATS: readonly Format[] = ["avif", "webp", "jpeg", "png", "gif", "svg", "auto"];

/** A format by name: `avif`, `webp`, `jpeg` (or `jpg`), `png`, `gif`, `svg` or `auto`. */
export function parseFormat(name: string): Format | undefined {
	if (name === "jpg") return "jpeg";
	return (FORMATS as readonly string[]).includes(name) ? (name as Format) : undefined;
}

export function mime(format: Format): string {
	return format === "svg" ? "image/svg+xml" : format === "avif" || format === "webp" || format === "jpeg" || format === "png" ? `image/${format}` : "image/gif";
}

/** How Rust's `{:?}` names a format, for 0.7's "cannot encode Gif". */
const debugName = (f: Format) => f[0].toUpperCase() + f.slice(1);

/** A format from a file's extension. */
function fromPath(file: string): Format | undefined {
	const ext = path.extname(file).slice(1).toLowerCase();
	if (ext === "jpg" || ext === "jpeg") return "jpeg";
	return ext === "png" || ext === "gif" || ext === "svg" || ext === "webp" ? ext : undefined;
}

export interface ImageOptions {
	/** Output formats; the last one is the `<img>` fallback. */
	formats: Format[];
	widths: number[];
	/** Attributes added to every `<img>` unless it already sets them. */
	defaultAttributes: Array<[string, string]>;
	/** The output folder (from the output directory) and its public URL. */
	outputSubdir: string;
	/** Where files are encoded and kept between builds, from the project root; `null` encodes straight into the output. */
	cacheDir: string | null;
	urlPath: string;
	/** sharp's numbers, 1 to 100; the defaults encode as 0.7's did (`quality.ts`). */
	webpQuality: number;
	avifQuality: number;
	/** sharp's AVIF effort: 0 (fastest) to 9 (slowest, smallest). */
	avifEffort: number;
	jpegQuality: number;
	/** A too-large width is clamped to the original only when the previous width is this many times smaller than it. */
	minimumThreshold: number;
	/** Delete files in the output folder (and the cache) that the build didn't use. */
	prune: boolean;
	/** Remember each image's id in `.cache/ssqch/image-hashes.json`. */
	hashCache: boolean;
	/** Point links to local images at a generated copy. */
	linkedImages: boolean;
}

export function defaultImageOptions(): ImageOptions {
	return {
		formats: ["webp", "auto"],
		widths: [300, 600, 900, 1200, 1500],
		defaultAttributes: [["loading", "lazy"], ["decoding", "async"], ["sizes", "auto"]],
		outputSubdir: "img",
		cacheDir: ".cache/ssqch/img",
		urlPath: "/img/",
		...DEFAULTS,
		minimumThreshold: 1.25,
		prune: false,
		hashCache: true,
		linkedImages: true,
	};
}

export interface ImageEntry {
	format: Format;
	width: number;
	height: number;
	url: string;
	/** In the output. */
	path: string;
	sourceType: string;
	/** `<url> <width>w` */
	srcset: string;
}

/** Generated files, by format in the order asked for. */
export interface ImageMetadata {
	formats: Map<Format, ImageEntry[]>;
	/** What `auto` became (the source's own format), when it was asked for. */
	auto?: Format;
	/** Settles when every file is encoded and in the output: with the error, if one couldn't be. */
	ready: Promise<Error | undefined>;
}

/** The fallback format's entries (the last format generated). */
const fallbackOf = (meta: ImageMetadata): ImageEntry[] => [...meta.formats.values()].at(-1) ?? [];

/** One file to encode. */
interface Job {
	src: string;
	/** The source's format, from its contents. */
	source: Decodable;
	/** What its header says about its pixels (grey, 16 bits). */
	probe: Probe;
	format: Format;
	width: number;
	height: number;
	/** Where it's written: the cache, or the output without one. */
	file: string;
	/** The source's EXIF orientation, as ssqch read it. */
	orientation: number;
	/** Where it goes in the output, linked from `file` when there's a cache. */
	out: string;
	/** For a name of the site's own: the source's modification time, which the file has to be as new as. */
	sourceTime: bigint | undefined;
	plan: ColorPlan;
	/** When the first encode of the request that made this job started, for its `Encoded` line. */
	started: { at?: number };
}

/** A source decoded once, turned and in sRGB, for all of a request's files. */
interface Pixels {
	data: Buffer;
	info: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
}

/** What a build knows of a source once it's read its header. */
interface Source {
	format: Decodable | "svg";
	probe?: Probe;
	id?: string;
	/** Why it can't be decoded (`null` when it can), once something of it had to be encoded. */
	damage?: string | null;
	/** Its bytes, while a request that read them for its id still needs them for `damage`. */
	contents?: Buffer;
}

/**
 * How sensitive sharp is to a broken file, as 0.7's decoders were: a JPEG that ends too soon is
 * padded with grey (0.7's decoder and libjpeg both do), and anything else that's broken is
 * refused rather than padded with black. A file that ends too soon was found by `undecodable`
 * already, so what sharp refuses here is damage in data that read whole.
 */
const failOn = (source: Decodable) => (source === "jpeg" ? "none" : "truncated");

/** The first line of a libvips error: its error buffer is shared, and the lines after it can be another encode's. */
function libvips(e: unknown): string {
	const lines = (e instanceof Error ? e.message : String(e)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (!lines.length) return "unknown error";
	return lines[0].endsWith(":") && lines.length > 1 ? `${lines[0]} ${lines[1]}` : lines[0];
}

/** The most pixels sharp decodes (its `limitInputPixels`). */
const PIXEL_LIMIT = 0x3fff * 0x3fff;
/** The widest and tallest image each of sharp's encoders writes. */
const LARGEST: Partial<Record<Format, number>> = { avif: 16384, webp: 16383, jpeg: 65535 };

/**
 * Each EXIF orientation as sharp's steps: an explicit turn from the orientation ssqch read, not
 * sharp's own reading, so the pixels always match the size the markup says. (sharp mirrors
 * before it turns: 5, `rotate 90 then mirror`, is a vertical flip, then the turn.)
 */
const ORIENT: Record<number, (image: import("sharp").Sharp) => import("sharp").Sharp> = {
	2: (i) => i.flop(),
	3: (i) => i.rotate(180),
	4: (i) => i.flip(),
	5: (i) => i.flip().rotate(90),
	6: (i) => i.rotate(90),
	7: (i) => i.flip().rotate(270),
	8: (i) => i.rotate(270),
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The widths to make of an image `original` pixels wide: never wider than the original, and a
 * too-large width is clamped to the original only when the previous width is `minimumThreshold`
 * times smaller than it.
 */
export function validWidths(original: number, requested: number[], minimumThreshold: number): number[] {
	const sorted = requested.map((w) => (w === 0 ? original : w)).sort((a, b) => a - b);
	let lastBigEnough = true;
	const out: number[] = [];
	for (const w of sorted) {
		if (w > original) {
			if (lastBigEnough) out.push(original);
			continue;
		}
		lastBigEnough = original > Math.floor(w * minimumThreshold);
		out.push(w);
	}
	const deduped = out.filter((w, i) => i === 0 || w !== out[i - 1]);
	return deduped.length ? deduped : [original];
}

/** A single candidate needs no width descriptor. */
function srcsetAttr(entries: ImageEntry[]): string {
	return entries.length === 1 ? entries[0].url : entries.map((e) => e.srcset).join(", ");
}

/** `sizes` without `auto`, which only lazy images can use: `auto, 50vw` is `50vw`, and `auto` alone is nothing. */
export function withoutAuto(sizes: string): string {
	return sizes.split(",").map((s) => s.trim()).filter((s) => s.toLowerCase() !== "auto").join(", ");
}

/**
 * A path as Rust's `PathBuf` compares it: `a/./b` and `a//b` are `a/b`, but `a/../b` is itself.
 * Sources and memo entries are keyed so, as 0.7 counted them.
 */
function samePath(p: string): string {
	const parts = p.split(path.sep === "\\" ? /[\\/]/ : "/");
	return parts.filter((part, i) => i === 0 || (part !== "" && part !== ".")).join("/");
}

/** `%XX` decoded as bytes, the rest as it is (invalid UTF-8 replaced). */
function percentDecode(s: string): string {
	if (!s.includes("%")) return s;
	const bytes = Buffer.from(s, "utf8");
	const out: number[] = [];
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0x25 && i + 2 < bytes.length) {
			const hex = String.fromCharCode(bytes[i + 1], bytes[i + 2]);
			if (/^[0-9a-fA-F]{2}$/.test(hex)) {
				out.push(parseInt(hex, 16));
				i += 2;
				continue;
			}
		}
		out.push(bytes[i]);
	}
	return Buffer.from(out).toString("utf8");
}

/** `base` and `rel` joined as Rust's `Path::join` does: without tidying `.` and `..` away, so each spelling of a path is its own source, as in 0.7. */
function joinPath(base: string, rel: string): string {
	if (path.isAbsolute(rel)) return rel;
	return base.endsWith(path.sep) || base.endsWith("/") ? base + rel : base + path.sep + rel;
}

/** A relative URL path resolved against a page's path: `("/posts/hike/", "./map.png")` is `/posts/hike/map.png`. */
export function joinUrlPath(page: string, rel: string): string {
	const clean = page.split(/[?#]/)[0];
	const dir = clean.slice(0, clean.lastIndexOf("/") + 1);
	const parts: string[] = [];
	for (const part of [...dir.split("/"), ...rel.split("/")]) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

/** Width and height of an SVG from its root `width` and `height`, or its `viewBox`. */
function svgDimensions(file: string): [number, number] | undefined {
	let text: string;
	try { text = fs.readFileSync(file, "utf8"); } catch { return undefined; }
	const start = text.indexOf("<svg");
	if (start === -1) return undefined;
	const end = text.indexOf(">", start);
	if (end === -1) return undefined;
	const tag = text.slice(start, end);
	const attr = (name: string): string | undefined => {
		const i = tag.indexOf(` ${name}=`);
		if (i === -1) return undefined;
		const quote = tag[i + name.length + 2];
		if (quote === undefined) return undefined;
		const rest = tag.slice(i + name.length + 3);
		const close = rest.indexOf(quote);
		return close === -1 ? undefined : rest.slice(0, close);
	};
	const num = (v: string | undefined) => {
		if (v === undefined) return undefined;
		const n = rustFloat(v.replace(/(px)+$/, "").trim());
		return n === undefined ? undefined : n;
	};
	const [w, h] = [num(attr("width")), num(attr("height"))];
	if (w !== undefined && h !== undefined) return [toU32(w), toU32(h)];
	const box = attr("viewBox");
	if (box === undefined) return undefined;
	const vb = box.split(/[ ,]/).map(rustFloat).filter((n): n is number => n !== undefined);
	return vb.length === 4 ? [toU32(vb[2]), toU32(vb[3])] : undefined;
}

/** A number as Rust's `parse::<f64>()` reads it: no spaces, no hex, `inf` and `NaN` allowed. */
function rustFloat(s: string): number | undefined {
	if (/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$/.test(s)) return Number(s);
	if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
	if (/^[+-]?nan$/i.test(s)) return NaN;
	return undefined;
}

/** `as u32` in Rust: saturating, NaN is 0. */
const toU32 = (n: number) => (Number.isNaN(n) ? 0 : Math.min(0xffffffff, Math.max(0, Math.trunc(n))));

/** A duration as Rust's `{:.2?}` writes it: `498.00µs`, `12.34ms`, `1.23s`. */
function rustDuration(ms: number): string {
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	if (ms >= 1) return `${ms.toFixed(2)}ms`;
	if (ms >= 0.001) return `${(ms * 1000).toFixed(2)}µs`;
	return `${(ms * 1e6).toFixed(2)}ns`;
}

/** The URL-path part of a page's URL (`https://example.com/a/` is `/a/`). */
function pagePathOf(pageUrl: string): string {
	const scheme = pageUrl.indexOf("://");
	if (scheme === -1) return pageUrl;
	const rest = pageUrl.slice(scheme + 3);
	const slash = rest.indexOf("/");
	return slash === -1 ? "/" : rest.slice(slash);
}

// Synchronous on purpose: a warm build checks every file of the site's (the blog's 4,985), and
// `fs.promises` costs the main thread more for each than the system call itself does.
const statOf = (p: string): fs.BigIntStats | undefined => fs.statSync(p, { throwIfNoEntry: false, bigint: true });

/**
 * The cached file at `cache` (whose stat is `a`) in the output at `out`, unless it's there
 * already: a hard link (no extra space), or a copy where links don't work (another drive).
 * Returns the size in the output.
 */
function publish(cache: string, out: string, a = statOf(cache)): number {
	const b = statOf(out);
	if (a && b && a.size === b.size && b.mtimeNs >= a.mtimeNs) return Number(b.size);
	fs.rmSync(out, { force: true });
	linkOrCopy(cache, out);
	return Number(a?.size ?? statOf(out)?.size ?? 0);
}

/**
 * `publish`'s link, made on Node's thread pool: the cached file at `cache` in the output at `out`,
 * which isn't there. A build into an empty output folder links every image it uses, and on
 * macOS a hard link takes about 0.2 ms: the blog's 4,689 took a second, one after another on the
 * main thread. On the pool they're made four at a time, while pages go on rendering. Resolves to
 * the error, if there is one, so nothing waits on a rejection nobody's listening for.
 */
async function publishLater(cache: string, out: string): Promise<Error | undefined> {
	try {
		await fs.promises.link(cache, out);
	} catch {
		// Something else may have just put the same file there.
		const [there, source] = [statOf(out), statOf(cache)];
		if (there && source && there.size === source.size) return undefined;
		try { await fs.promises.copyFile(cache, out); } catch (e) { return new Error(`copying ${out} into the output: ${(e as Error).message}`); }
	}
	return undefined;
}

function linkOrCopy(from: string, to: string): void {
	try {
		fs.linkSync(from, to);
	} catch {
		// Something else may have just put the same file there.
		const [there, source] = [statOf(to), statOf(from)];
		if (there && source && there.size === source.size) return;
		fs.copyFileSync(from, to);
	}
}

/** What points at a source's files: a page (its path, and URL), a feed's `feedHtml()`, or `imageUrl()`. */
interface Pointer {
	name: string;
	url?: string;
}

/** A source whose files are being made, what points at them (in the order they asked), and what went wrong, if anything did. */
interface Watched {
	src: string;
	by: Map<string, Pointer>;
	error?: Error;
}

/** What a build answers when nothing has to wait. */
const READY: Promise<Error | undefined> = Promise.resolve(undefined);

const isFile = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
/** A folder's entry that's a file, or a link to one, without a `stat` for each plain file. */
const isEntryFile = (entry: fs.Dirent, p: string) => entry.isFile() || (entry.isSymbolicLink() && isFile(p));
const mtimeOf = (p: string) => fs.statSync(p, { throwIfNoEntry: false, bigint: true })?.mtimeNs;

// ---- sharp ---------------------------------------------------------------------------------

type Sharp = typeof import("sharp").default;
let sharpModule: Sharp | undefined;
/** sharp, loaded with the first encode: a build without images doesn't pay for it. */
function loadSharp(): Sharp {
	if (!sharpModule) {
		sharpModule = createRequire(import.meta.url)("sharp") as Sharp;
		// One libvips thread for each encode, and as many encodes at once as there are cores:
		// throughput without each encode's own threads fighting the others'. It keeps the bytes
		// the same on every machine too: libaom's AVIF changes with the threads it's given.
		sharpModule.concurrency(1);
		// The operation cache keeps decoded images for repeats a build doesn't make.
		sharpModule.cache(false);
	}
	return sharpModule;
}

/**
 * Encodes at once: one per core (decided 2026-11-18). sharp runs each on libuv's thread pool,
 * which the command line makes four threads bigger than this (`bin/ssqch.ts`), so page writes
 * still get threads; a smaller `UV_THREADPOOL_SIZE` makes encodes wait their turn there. Each
 * file is one encode on one libvips thread, so how many run at once changes when files are
 * done, never their bytes.
 */
export const ENCODES = os.availableParallelism();

class Queue {
	private running = 0;
	private waiting: Array<() => void> = [];
	private limit: number;

	constructor(limit: number) {
		this.limit = limit;
	}

	/** For tests: nothing starts until the answer is called, then as many as there are places. */
	hold(): () => void {
		this.running += this.limit;
		return () => {
			this.running -= this.limit;
			for (let i = 0; i < this.limit; i++) this.waiting.shift()?.();
		};
	}

	/** `task`, once a place is free; `first` goes ahead of everything waiting (the files of a source already decoded, so its pixels are let go of soon). */
	async run<T>(task: () => Promise<T>, first = false): Promise<T> {
		if (this.running >= this.limit) await new Promise<void>((resolve) => (first ? this.waiting.unshift(resolve) : this.waiting.push(resolve)));
		this.running++;
		// An encode running is the build working, however long one takes (`activity.ts`).
		const done = working();
		try {
			return await task();
		} finally {
			done();
			this.running--;
			this.waiting.shift()?.();
		}
	}
}

// ---- the processor -------------------------------------------------------------------------

interface Context {
	root: string;
	input: string;
	output: string;
	verbose: boolean;
}

let temporary = 0;

/**
 * Makes images. Shared by the HTML transform, `image()`, `imageUrl()` and `feedHtml()`, so they
 * share the cache, the encoder settings and the output folder.
 */
export class ImageProcessor {
	readonly options: ImageOptions;
	private ctx: Context | undefined;
	private memo = new Map<string, ImageMetadata | Error>();
	/** Each file this build makes or reuses, by where it's kept: a file two requests share is made once. */
	private files = new Map<string, "reused" | Promise<"encoded" | "reused">>();
	/** What each source's first bytes said this build, by its path as given. */
	private headers = new Map<string, Source>();
	/** Which paths are files, as the transform asks, once a build each. */
	private found = new Map<string, boolean>();
	/** The folders made this build. */
	private made = new Set<string>();
	/** The size of each file in the output, as it was made or found, for the summary. */
	private sizes = new Map<string, number>();
	/** Everything this build is still waiting for, settled or not. */
	private pending: Array<Promise<unknown>> = [];
	/** Cached files being linked into the output (publishLater), each resolving to its error if it failed. */
	private placing: Array<Promise<Error | undefined>> = [];
	/** Each source with files still to make that something points at, by its path: one that fails fails the build. */
	private watched = new Map<string, Watched>();
	private generated = 0;
	/** GIFs and SVGs copied as they are (no encode, and no cache), apart from `generated`. */
	private copied = 0;
	private pruned = 0;
	private converted = new Set<string>();
	private used = new Set<string>();
	private sources = new Set<string>();
	private hashes = new HashCache();
	quiet = false;
	private timings: Array<[string, number, number]> = [];
	private warned = new Set<string>();
	private queue = new Queue(ENCODES);
	private settings: EncodeSettings;

	/** For tests: holds every encode back until the answer is called, so a test can change what they'll find first. */
	holdEncodesForTest(): () => void {
		return this.queue.hold();
	}
	/** The settings as image names hold them (`legacySettings`). */
	private named: string;

	constructor(options: ImageOptions) {
		this.options = options;
		this.settings = encodeSettings(options);
		this.named = legacySettings(options);
	}

	/** The project root, once the build has started. */
	root(): string {
		return this.context().root;
	}

	private context(): Context {
		if (!this.ctx) throw new BuildError("the image plugin is used before the build started");
		return this.ctx;
	}

	private warnOnce(message: string): void {
		if (this.warned.has(message)) return;
		this.warned.add(message);
		warn(warning("images", message));
	}

	private display(file: string): string {
		return displayPath(this.context().root, file);
	}

	/** Before each build: what the last one did is forgotten (sources may have changed while serving). */
	startBuild(config: Config): void {
		const root = config.root;
		const input = path.resolve(root, config.input);
		this.ctx = { root, input, output: path.resolve(root, config.output), verbose: config.verbose };
		this.memo.clear();
		this.files.clear();
		this.headers.clear();
		this.found.clear();
		this.made.clear();
		this.sizes.clear();
		this.pending = [];
		this.placing = [];
		this.watched.clear();
		this.used.clear();
		this.sources.clear();
		this.converted.clear();
		this.timings = [];
		if (this.options.hashCache) this.hashes.load(path.join(root, CACHE_FILE));
		this.generated = 0;
		this.copied = 0;
		this.pruned = 0;
	}

	/**
	 * After the pages: every encode they asked for, done. A file that couldn't be made, after a
	 * page, a feed or `imageUrl()` pointed at it, fails the build here (decided 2026-11-18):
	 * they're written already, and a site shouldn't ship markup for a file that isn't there. The
	 * error names the source and what points at it, and in `--format json` each source is an
	 * `images` error with the source as its `file` and the first page's URL as its `url`.
	 */
	async settle(): Promise<void> {
		while (this.pending.length) {
			const waiting = this.pending;
			this.pending = [];
			await Promise.all(waiting);
		}
		// Every cached file the pages point at, in the output.
		const placing = this.placing;
		this.placing = [];
		const failed = (await Promise.all(placing)).find((e) => e !== undefined);
		if (failed) throw new BuildError(`images: ${failed.message}`);
		const root = this.context().root;
		// By the source's path, as plain text: the same order on every machine.
		const failures = [...this.watched.values()].filter((w) => w.error !== undefined).map((w) => ({ ...w, file: shown(root, w.src) })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
		if (!failures.length) return;
		const said = (f: Watched) => {
			const [first, ...others] = f.by.values();
			return `images: ${f.error!.message}. ${first.name}${others.length ? ` and ${count(others.length)} more` : ""} already ${others.length ? "point" : "points"} at it, so the build stops here rather than publish tracks that lead nowhere`;
		};
		const items = failures.map((f) => error("images", said(f), { file: f.file, url: [...f.by.values()].find((b) => b.url !== undefined)?.url }));
		const more = failures.length > 1 ? ` (and ${count(failures.length - 1)} more ${failures.length === 2 ? "image" : "images"} that failed)` : "";
		throw new BuildError(`${said(failures[0])}${more}`, items);
	}

	/** After the build: `prune`, the hash cache, and with `--verbose` the slowest encodes. */
	finishBuild(): void {
		const ctx = this.context();
		this.pruned = this.options.prune ? this.prune(path.join(ctx.output, this.options.outputSubdir)) : 0;
		if (this.options.hashCache) {
			// A cache that can't be written only costs time, so a warning, and on.
			try { this.hashes.save(); } catch (e) { this.warnOnce(`couldn't write ${path.join(ctx.root, CACHE_FILE)}: ${(e as Error).message}`); }
		}
		if (ctx.verbose && !this.quiet && this.timings.length) {
			const slowest = [...this.timings].sort((a, b) => b[2] - a[2]).slice(0, 10);
			progress("Slowest images to encode:");
			for (const [src, files, ms] of slowest) progress(`  ${rustDuration(ms).padStart(8)}  ${this.display(src)} (${files} files)`);
		}
	}

	/** An `<img src>` as a file: from the input folder for a path starting with `/`, otherwise from the page's own folder. */
	resolveSrc(src: string, pageInput: string): string | undefined {
		if (src === "" || src.includes("://") || src.startsWith("//") || src.startsWith("data:")) return undefined;
		const ctx = this.context();
		const clean = percentDecode(src.split(/[?#]/)[0]);
		return clean.startsWith("/") ? joinPath(ctx.input, clean.slice(1)) : joinPath(path.dirname(pageInput), clean);
	}

	/** A site path as a file in the input folder: `/content/logo.png` (or `content/logo.png`) is `<input>/content/logo.png`. `undefined` for a remote or `data:` URL. */
	resolveSiteSrc(src: string): string | undefined {
		if (src.includes("://") || src.startsWith("//") || src.startsWith("data:")) return undefined;
		const clean = percentDecode(src.split(/[?#]/)[0]);
		return joinPath(this.context().input, clean.replace(/^\/+/, ""));
	}

	/** What `imageUrl()` returns: one generated copy of the image at site path `src`, `width` pixels wide at most (0 is the original's), in `format`. A remote URL is only `{ url }`. */
	imageUrl(src: string, width: number, format: Format): Record<string, unknown> {
		if (src.trim() === "") throw new BuildError("imageUrl(): no image given");
		const file = this.resolveSiteSrc(src);
		if (file === undefined) return { url: src };
		if (!this.isSource(file)) throw new BuildError(`imageUrl(): image not found: ${src} (looked for ${this.display(file)})`);
		const meta = this.generate(file, [width], [format]);
		// The page uses the URL now; the file has to be there by the end of the build.
		this.watch(meta, file, { name: "imageUrl()" });
		const resolved = format === "auto" ? meta.auto : format;
		const entries = (resolved !== undefined ? meta.formats.get(resolved) : undefined) ?? [...meta.formats.values()][0];
		const e = widest(entries);
		if (!e) throw new BuildError(`imageUrl(): no image generated for ${src}`);
		return { url: e.url, width: e.width, height: e.height, type: e.sourceType, format: e.format };
	}

	/** The URL a link to `src` should point to: one copy in the source's own format, at its width capped at the largest of `widths`. GIFs and SVGs are their copied files. */
	private linkTarget(src: string, by: Pointer): string {
		const cap = this.options.widths.length ? Math.max(...this.options.widths) : 0;
		const meta = this.generate(src, [cap], ["auto"]);
		this.watch(meta, src, by);
		const entry = widest([...meta.formats.values()].flat());
		if (!entry) throw new Error(`no image generated for ${src}`);
		return entry.url;
	}

	/** Waits, before the build ends, for files of `src` that `by` already points at. One that can't be made fails the build (see `settle`). */
	private watch(meta: ImageMetadata, src: string, by: Pointer): void {
		if (meta.ready === READY) return;
		// What points at it is noted now, in the order the build asked: the encodes finish in
		// any order, and the error has to read the same every time.
		const key = samePath(src);
		let watched = this.watched.get(key);
		if (!watched) this.watched.set(key, watched = { src, by: new Map() });
		if (!watched.by.has(by.name)) watched.by.set(by.name, by);
		const noted = watched;
		this.pending.push(meta.ready.then((e) => {
			// A source with several files that fail: the same one named every time, whichever failed first.
			if (e && (noted.error === undefined || e.message < noted.error.message)) noted.error = e;
		}));
	}

	/** Makes (or reuses) `src` at `widths` in `formats`. */
	generate(src: string, widths: number[], formats: Format[]): ImageMetadata {
		return this.generateNamed(src, widths, formats, undefined);
	}

	/**
	 * `generate`, with file names of the site's own instead of ones from a hash: `name` is the
	 * output's URL path without the width and extension (`/assets/sponsors/acme` writes
	 * `/assets/sponsors/acme-200.webp`), inside the image folder without a leading `/`. A file is
	 * encoded again when its source is newer than it.
	 */
	generateNamed(src: string, widths: number[], formats: Format[], name: string | undefined): ImageMetadata {
		if (name !== undefined) {
			const last = name.split("/").at(-1) ?? "";
			if (last === "" || name.split("/").includes("..") || /[\\?#]/.test(name)) {
				throw new BuildError(`image name ${debugString(name)} must be a URL path without the width and extension, like "/assets/sponsors/acme"`);
			}
		}
		const key = JSON.stringify([samePath(src), widths, formats, name ?? null]);
		let found = this.memo.get(key);
		if (found === undefined) {
			try {
				found = this.generateUncached(src, widths, formats, name);
				for (const e of [...found.formats.values()].flat()) this.used.add(e.path);
				this.sources.add(samePath(src));
			} catch (e) {
				found = e instanceof Error ? e : new Error(String(e));
			} finally {
				// The bytes read for the id were for this request's check only.
				const source = this.headers.get(src);
				if (source) source.contents = undefined;
			}
			this.memo.set(key, found);
		}
		if (found instanceof Error) throw found;
		return found;
	}

	/**
	 * A source's format (the real one, from its contents: a `.png` may hold a JPEG; an SVG by its
	 * name), its header and its id, read once a build however many requests name it.
	 */
	private header(src: string): Source {
		let found = this.headers.get(src);
		if (!found) {
			const named = fromPath(src);
			if (named === "svg") found = { format: "svg" };
			else {
				let probed: Probe | undefined;
				try { probed = probeFile(src, named as Decodable | undefined); } catch (e) { throw new Error(`reading ${src}: ${(e as Error).message}`); }
				if (!probed) throw new Error(`unsupported image type: ${src}`);
				found = { format: probed.format, probe: probed };
			}
			this.headers.set(src, found);
		}
		return found;
	}

	/** Makes a folder, once a build. */
	private makeDir(dir: string): void {
		if (this.made.has(dir)) return;
		fs.mkdirSync(dir, { recursive: true });
		this.made.add(dir);
	}

	/** Whether `file` is a file, asked once a build. */
	private isSource(file: string): boolean {
		let found = this.found.get(file);
		if (found === undefined) this.found.set(file, found = isFile(file));
		return found;
	}

	private generateUncached(src: string, widths: number[], formats: Format[], name: string | undefined): ImageMetadata {
		const ctx = this.context();
		const source = this.header(src);
		const srcFormat = source.format;
		const readHeader = () => source.probe!;
		// The folder, its URL, and the start of each file's name.
		let outDir: string;
		let urlPath: string;
		let id: string;
		if (name === undefined) {
			outDir = path.join(ctx.output, this.options.outputSubdir);
			urlPath = this.options.urlPath;
			id = source.id ??= this.hashId(src, srcFormat === "svg" || srcFormat === "gif" ? undefined : readHeader, (contents) => { source.contents = contents; });
		} else {
			const rel = name.replace(/^\//, "");
			const slash = rel.lastIndexOf("/");
			const [dir, stem] = slash === -1 ? ["", rel] : [`${rel.slice(0, slash)}/`, rel.slice(slash + 1)];
			if (name.startsWith("/")) [outDir, urlPath] = [path.join(ctx.output, dir), `/${dir}`];
			else [outDir, urlPath] = [path.join(ctx.output, this.options.outputSubdir, dir), `${this.options.urlPath}${dir}`];
			id = stem;
		}
		this.makeDir(outDir);
		// Encoded files live in the cache, and the output gets links to them. Names of the site's
		// own get a folder there that mirrors the output.
		let cacheDir: string | undefined;
		if (this.options.cacheDir !== null) {
			const base = path.join(ctx.root, this.options.cacheDir);
			cacheDir = name === undefined ? base : path.join(base, "named", path.relative(ctx.output, outDir));
			try { this.makeDir(cacheDir); } catch (e) { throw new Error(`creating the image cache ${cacheDir}: ${(e as Error).message}`); }
		}
		// A hashed name says what's in the file. A name of the site's own doesn't, so its file is
		// stale when the source is newer.
		const sourceTime = name === undefined ? undefined : mtimeOf(src);
		const entry = (format: Format, width: number, height: number, file: string): ImageEntry => ({
			format, width, height, url: `${urlPath}${file}`, path: path.join(outDir, file), sourceType: mime(format), srcset: `${urlPath}${file} ${width}w`,
		});

		// SVGs are copied as they are, and so are GIFs in `auto` output (which keeps animations). A
		// GIF asked for as PNG or JPEG (a social card) is converted.
		const copyGif = srcFormat === "gif" && formats.every((f) => f === "auto" || f === "gif" || f === "webp" || f === "avif");
		if (srcFormat === "svg" || copyGif) {
			const [w, h] = srcFormat === "gif" ? [readHeader().width, readHeader().height] : svgDimensions(src) ?? [0, 0];
			const e = entry(srcFormat, w, h, w > 0 ? `${id}-${w}.${srcFormat}` : `${id}.${srcFormat}`);
			const t = mtimeOf(e.path);
			if (!(t !== undefined && (sourceTime === undefined || t >= sourceTime)) && !this.files.has(e.path)) {
				// A copy of the source, not an encode: counted as copied, and made on the thread
				// pool while pages go on rendering (settle waits for it).
				const out = e.path;
				this.placing.push(fs.promises.copyFile(src, out).then(() => undefined, (err) => new Error(`copying ${src} to ${out}: ${(err as Error).message}`)));
				this.copied++;
			}
			this.files.set(e.path, "reused");
			return { formats: new Map([[srcFormat, [e]]]), auto: formats.includes("auto") ? srcFormat : undefined, ready: READY };
		}

		const probed = readHeader();
		const [w0, h0] = oriented(probed);
		const targets = validWidths(w0, widths, this.options.minimumThreshold);
		const meta: ImageMetadata = { formats: new Map(), auto: formats.includes("auto") ? srcFormat : undefined, ready: READY };
		const plan = colorPlan(probed.icc);
		const started: { at?: number } = {};
		const fresh = (st: fs.BigIntStats | undefined) => st !== undefined && (sourceTime === undefined || st.mtimeNs >= sourceTime);
		// Each file: made or found already this build, being made for another request, or new to
		// this build: kept from the cache, taken in from the output (encoded there before there
		// was a cache, or restored there by a deploy's cache), or to encode.
		const steps: Array<{ e: ImageEntry; file: string; earlier?: "reused" | Promise<"encoded" | "reused">; found?: "cache" | "output"; stat?: fs.BigIntStats }> = [];
		for (const asked of formats) {
			const f = asked === "auto" ? srcFormat : asked;
			if (meta.formats.has(f)) continue;
			const entries: ImageEntry[] = [];
			for (const w of targets) {
				// Heights round down.
				const h = Math.max(1, Math.floor((h0 * w) / w0));
				const e = entry(f, w, h, `${id}-${w}.${f}`);
				const file = cacheDir === undefined ? e.path : path.join(cacheDir, path.basename(e.path));
				const step: (typeof steps)[number] = { e, file, earlier: this.files.get(file) };
				if (step.earlier === undefined) {
					const inCache = statOf(file);
					const inOutput = file !== e.path && !fresh(inCache) ? statOf(e.path) : undefined;
					if (fresh(inCache)) [step.found, step.stat] = ["cache", inCache];
					else if (fresh(inOutput)) [step.found, step.stat] = ["output", inOutput];
				}
				steps.push(step);
				entries.push(e);
			}
			meta.formats.set(f, entries);
		}
		const encodes = steps.filter((s) => s.earlier === undefined && s.found === undefined);
		// Before anything points at a file that has to be made: whether it can be, as 0.7 decoded
		// the source first. If not, nothing of this request is used, and its tag stays as written.
		if (encodes.length) {
			this.check(src, source, probed);
			for (const { e } of encodes) {
				const largest = LARGEST[e.format];
				if (largest !== undefined && (e.width > largest || e.height > largest)) throw new Error(`encoding ${this.display(e.path)} from ${src}: ${e.width}x${e.height} is larger than ${e.format.toUpperCase()} allows (${largest} pixels a side)`);
			}
		}
		// The files found, then the ones to make: one that can't be put in the output fails the
		// request before any encoding starts for it.
		for (const s of steps) {
			if (s.found === undefined) continue;
			const cached = s.file !== s.e.path;
			if (s.found === "cache") {
				if (cached) {
					// Already there and as new: nothing to do. Otherwise it's linked on the thread
					// pool (publishLater), and `settle` waits for it.
					const [a, b] = [s.stat, statOf(s.e.path)];
					if (!(a && b && a.size === b.size && b.mtimeNs >= a.mtimeNs)) {
						if (b) {
							try { fs.rmSync(s.e.path, { force: true }); } catch (e) { throw new Error(`copying ${s.e.path} into the output: ${(e as Error).message}`); }
						}
						this.placing.push(publishLater(s.file, s.e.path));
					}
					this.sizes.set(s.e.path, Number(a?.size ?? 0));
				} else this.sizes.set(s.e.path, Number(s.stat!.size));
			} else {
				try { linkOrCopy(s.e.path, s.file); } catch (e) { throw new Error(`copying ${s.e.path} into the image cache: ${(e as Error).message}`); }
				this.sizes.set(s.e.path, Number(s.stat!.size));
			}
			this.files.set(s.file, "reused");
		}
		const jobs: Job[] = encodes.map(({ e, file }) => ({ src, source: probed.format, probe: probed, format: e.format, width: e.width, height: e.height, file, orientation: probed.orientation, out: e.path, sourceTime, plan, started }));
		const made = this.encodeAll(jobs);
		jobs.forEach((job, i) => this.files.set(job.file, made[i]));
		// Others asked for these first; this request waits for them too.
		const theirs = steps.flatMap((s) => (s.earlier !== undefined && s.earlier !== "reused" ? [s.earlier] : []));
		if (!made.length && !theirs.length) return meta;
		meta.ready = Promise.all([Promise.all(made), ...theirs]).then(
			([done]) => {
				const encoded = done.filter((m) => m === "encoded").length;
				if (encoded) {
					if (plan.kind === "convert") this.converted.add(samePath(src));
					this.encoded(src, encoded, meta, performance.now() - (started.at ?? performance.now()));
				}
				return undefined;
			},
			(e) => e as Error,
		);
		return meta;
	}

	/**
	 * Whether `src` can be decoded, as 0.7's decoders would have found (see `undecodable`), read
	 * once a build. Throws 0.7's warning for one that can't: `decoding <file>: <why>`.
	 */
	private check(src: string, source: Source, probed: Probe): void {
		if (source.damage === undefined) {
			if (probed.width * probed.height > PIXEL_LIMIT) source.damage = `${probed.width}x${probed.height} is more pixels than ssqch decodes (${count(PIXEL_LIMIT)})`;
			else if (probed.format === "jpeg") source.damage = null;
			else {
				let contents = source.contents;
				if (!contents) {
					try { contents = fs.readFileSync(src); } catch (e) { throw new Error(`reading ${src}: ${(e as Error).message}`); }
				}
				source.damage = undecodable(contents, probed.format) ?? null;
			}
		}
		if (source.damage !== null) throw new Error(`decoding ${src}: ${source.damage}`);
	}

	/**
	 * A request's files to encode, each made into the cache and linked into the output (or made
	 * there without a cache). A PNG's are made from its pixels decoded once, since sharp can't
	 * shrink a PNG while it decodes it the way it does a JPEG or a WebP; a JPEG's and a WebP's are
	 * each made from the file, which is quicker for them.
	 */
	private encodeAll(jobs: Job[]): Array<Promise<"encoded">> {
		if (!jobs.length) return [];
		// A 16-bit PNG's PNG files are made in 16 bits, from the file.
		const shared = jobs.filter((j) => j.source === "png" && !(j.format === "png" && j.probe.sixteen));
		let pixels: Promise<Pixels> | undefined;
		if (shared.length > 1) {
			const first = shared[0];
			pixels = this.queue.run(() => {
				first.started.at ??= performance.now();
				this.notePlan(first.src, first.plan);
				return this.decode(first);
			});
			// Each file's encode waits for them, and reports the failure.
			pixels.catch(() => {});
		}
		return jobs.map((job) => {
			const done = pixels && shared.includes(job)
				? pixels.then((p) => this.queue.run(() => this.encodeFrom(job, p), true))
				: this.queue.run(() => {
					job.started.at ??= performance.now();
					this.notePlan(job.src, job.plan);
					return this.encodeFrom(job);
				});
			return done.then(() => {
				this.generated++;
				if (job.file !== job.out) {
					try { this.sizes.set(job.out, publish(job.file, job.out)); } catch (e) { throw new Error(`copying ${job.out} into the output: ${(e as Error).message}`); }
				} else this.sizes.set(job.out, Number(statOf(job.out)?.size ?? 0));
				return "encoded" as const;
			});
		});
	}

	/** A source whose profile can't be converted to sRGB is named, once, when it's first encoded. */
	private notePlan(src: string, plan: ColorPlan): void {
		if (plan.kind === "unsupported") {
			this.warnOnce(`${this.display(src)} has a color profile ssqch can't convert to sRGB (${plan.why}), so its colors may look washed out. HDR photos from newer iPhones do this; converting the source to sRGB once fixes it (on macOS: sips -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" <file>)`);
		}
	}

	/** A line for each source encoded, as it's done. */
	private encoded(src: string, files: number, meta: ImageMetadata, ms: number): void {
		progressed();
		if (!this.quiet) progress(`[ssqch] Encoded ${this.display(src)} into ${files} file${files === 1 ? "" : "s"} (${[...meta.formats.keys()].join(", ")}) in ${rustDuration(ms)}`);
		this.timings.push([src, files, ms]);
	}

	/**
	 * A short, URL-safe id from the source's contents and the encoder settings, as 0.7 made it
	 * (BLAKE3, and the settings written as the 0.7 numbers they convert from, `legacySettings`,
	 * so the names don't change with the upgrade). Not the path or the modification time: a
	 * fresh clone gives every file a new one, which would make every CI build a cold one. The
	 * hash cache only saves reading files whose size and time haven't changed. An image that
	 * gets converted to sRGB has that in its id too.
	 */
	private hashId(src: string, header: (() => Probe) | undefined, read?: (contents: Buffer) => void): string {
		const o = this.options;
		const settings = this.named;
		const cacheKey = `${settings}|color1`;
		let size: number;
		let mtime: string;
		try { ({ size, mtime } = stamp(src)); } catch { throw new Error(`image not found: ${src}`); }
		if (o.hashCache) {
			const id = this.hashes.get(src, size, mtime, cacheKey);
			if (id !== undefined) return id;
		}
		let contents: Buffer;
		try { contents = fs.readFileSync(src); } catch (e) { throw new Error(`reading ${src}: ${(e as Error).message}`); }
		read?.(contents);
		const parts = [contents, Buffer.from(settings)];
		if (header && colorPlan(header().icc).kind === "convert") parts.push(Buffer.from("|srgb"));
		const hash = blake3(Buffer.concat(parts));
		let id = "";
		for (let i = 0; i < 10; i++) id += ALPHABET[hash[i] & 63];
		if (o.hashCache) this.hashes.put(src, size, mtime, cacheKey, id);
		return id;
	}

	/**
	 * A source's pixels, turned by its EXIF orientation and converted to sRGB from its colour
	 * profile (which sharp does for any profile): what a PNG's files are made from.
	 */
	private async decode(job: Job): Promise<Pixels> {
		const sharp = loadSharp();
		try {
			const image = (ORIENT[job.orientation] ?? ((i) => i))(sharp(job.src, { failOn: failOn(job.source) }));
			return await image.raw().toBuffer({ resolveWithObject: true }) as Pixels;
		} catch (e) {
			throw new Error(`decoding ${this.display(job.src)}: ${libvips(e)}`);
		}
	}

	/**
	 * One file, from the source's decoded `pixels`, or from the file: turned, in sRGB, resized
	 * with Catmull-Rom (the filter 0.7 used), and encoded as 0.7 wrote it. A JPEG has no alpha, and
	 * 0.7 dropped it keeping the colour under it, so that's done before the resize: sharp resizes
	 * with the colour weighted by the alpha, which is black where it's clear. A PNG of a grey
	 * source is grey, and of a 16-bit one 16 bits, as 0.7's were.
	 */
	private async encodeFrom(job: Job, pixels?: Pixels): Promise<void> {
		if (job.format === "gif" || job.format === "svg" || job.format === "auto") throw new Error(`encoding ${job.file}: cannot encode ${debugName(job.format)}`);
		const sharp = loadSharp();
		const settings = this.settings;
		// A name of its own: two requests can share a file (the same source, overlapping widths).
		const tmp = `${job.file.slice(0, job.file.length - path.extname(job.file).length)}.${job.format}.${temporary++}.tmp`;
		try {
			const fromFile = () => (ORIENT[job.orientation] ?? ((i) => i))(sharp(job.src, { failOn: failOn(job.source) }));
			let image: import("sharp").Sharp;
			if (job.format === "jpeg" && job.source !== "jpeg" && (!pixels || pixels.info.channels % 2 === 0)) {
				const opaque = await (pixels ? sharp(pixels.data, { raw: pixels.info }) : fromFile()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
				image = sharp(opaque.data, { raw: opaque.info as Pixels["info"] });
			} else image = pixels ? sharp(pixels.data, { raw: pixels.info }) : fromFile();
			image = image.resize(job.width, job.height, { fit: "fill", kernel: "cubic" });
			if (job.format === "png" && (job.probe.grey || job.probe.sixteen)) image = image.toColourspace(job.probe.grey ? (job.probe.sixteen ? "grey16" : "b-w") : "rgb16");
			if (job.format === "jpeg") image = image.jpeg(settings.jpeg);
			else if (job.format === "png") image = image.png(settings.png);
			else if (job.format === "webp") image = image.webp(settings.webp);
			else image = image.avif(settings.avif);
			await image.toFile(tmp);
			fs.renameSync(tmp, job.file);
		} catch (e) {
			try { fs.rmSync(tmp, { force: true }); } catch { /* not there, or nowhere it could be */ }
			throw new Error(`encoding ${this.display(job.out)} from ${this.display(job.src)}: ${libvips(e)}`);
		}
	}

	/** The summary's `Images` line: the files this build used, from how many sources, and how many it had to encode. */
	summary(): string | undefined {
		if (this.used.size === 0 && this.pruned === 0) return undefined;
		let size = 0;
		for (const p of this.used) size += this.sizes.get(p) ?? fs.statSync(p, { throwIfNoEntry: false })?.size ?? 0;
		const sources = this.sources.size;
		// A file two pages ask for at once is made once, but don't count past the files used.
		const copied = Math.min(this.copied, this.used.size);
		const encoded = Math.min(this.generated, this.used.size - copied);
		// Copies of GIFs and SVGs are said apart: counted as encoded, a clean build of a site with
		// some said `35 encoded` every time, as if the cache didn't work.
		let line = `${count(this.used.size)} file${this.used.size === 1 ? "" : "s"} from ${count(sources)} source${sources === 1 ? "" : "s"}, ${bytes(size)}: ${count(encoded)} encoded, ${copied > 0 ? `${count(copied)} copied, ` : ""}${count(this.used.size - encoded - copied)} reused`;
		if (this.converted.size > 0) line += ` (${count(this.converted.size)} source${this.converted.size === 1 ? "" : "s"} converted to sRGB)`;
		if (this.options.prune) line += `, ${count(this.pruned)} pruned`;
		return line;
	}

	/** Deletes the files in `dir` that this build didn't make or reuse, and their copies in the cache. Counts the output's. */
	private prune(dir: string): number {
		const ctx = this.context();
		let removed = 0;
		let entries: fs.Dirent[] = [];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* nothing there */ }
		for (const entry of entries) {
			const p = path.join(dir, entry.name);
			if (!this.used.has(p) && isEntryFile(entry, p)) {
				try { fs.rmSync(p); } catch (e) { throw new Error(`pruning ${p}: ${(e as Error).message}`); }
				removed++;
			}
		}
		// The cache's hashed files (its `named/` folder isn't pruned).
		if (this.options.cacheDir !== null) {
			const names = new Set([...this.used].filter((p) => path.dirname(p) === dir).map((p) => path.basename(p)));
			const cache = path.join(ctx.root, this.options.cacheDir);
			let cached: fs.Dirent[] = [];
			try { cached = fs.readdirSync(cache, { withFileTypes: true }); } catch { /* no cache yet */ }
			for (const entry of cached) {
				const p = path.join(cache, entry.name);
				if (!names.has(entry.name) && isEntryFile(entry, p)) {
					try { fs.rmSync(p); } catch (e) { throw new Error(`pruning ${p}: ${(e as Error).message}`); }
				}
			}
		}
		return removed;
	}

	/** `<picture>` markup for generated images and the `<img>`'s attributes. */
	pictureHtml(meta: ImageMetadata, attrs: Array<[string, string]>): string {
		return this.pictureMarkup(meta, attrs, false)[0];
	}

	/**
	 * `pictureHtml`, and with `preload`, its `<link rel="preload">`: the image loads eagerly with `fetchpriority="high"`, and `sizes="auto"` (lazy images only) is left out.
	 * With `wrap` off, the `<source>`s and the `<img>` come without a `<picture>` around them, for an `<img>` that's inside one the page wrote.
	 */
	private pictureMarkup(meta: ImageMetadata, attrs: Array<[string, string]>, preload: boolean, wrap = true): [string, string | undefined] {
		const fallback = fallbackOf(meta);
		const low = fallback[0];
		const high = fallback.at(-1);
		if (!low || !high) return ["", undefined];
		const has = (name: string) => attrs.some(([a]) => a === name);
		let sizes: string | undefined;
		const img: Array<[string, string]> = [];
		for (const [k, v] of this.options.defaultAttributes) {
			if (k === "sizes") sizes = v;
			else if (preload && k === "loading") continue;
			else if (!has(k)) img.push([k, v]);
		}
		for (const [k, v] of attrs) {
			if (k === "width" || k === "height") continue;
			if (k === "sizes") sizes = v;
			else if (k === "src") img.push(["src", low.url]);
			else if (k === "loading" && preload && v.toLowerCase() === "lazy") continue;
			else img.push([k, v]);
		}
		if (preload) {
			sizes = sizes === undefined ? undefined : withoutAuto(sizes) || undefined;
			if (!has("fetchpriority")) img.push(["fetchpriority", "high"]);
		}
		if (fallback.length > 1) {
			img.push(["srcset", srcsetAttr(fallback)]);
			if (sizes !== undefined) img.push(["sizes", sizes]);
		}
		if (high.width > 0) img.push(["width", String(high.width)], ["height", String(high.height)]);
		// Values copied from the original tag are still entity-encoded, so only quotes need
		// escaping; generated values are plain URLs and numbers.
		const tag = `<img${img.map(([k, v]) => ` ${k}="${v.replaceAll("\"", "&quot;")}"`).join("")}>`;

		let link: string | undefined;
		if (preload) {
			const [format, entries] = [...meta.formats.entries()][0];
			link = `<link rel="preload" as="image" type="${mime(format)}" fetchpriority="high"`;
			if (entries.length === 1) link += ` href="${escapeHtml(entries[0].url)}"`;
			else {
				link += ` imagesrcset="${escapeHtml(srcsetAttr(entries))}"`;
				if (sizes !== undefined) link += ` imagesizes="${sizes.replaceAll("\"", "&quot;")}"`;
			}
			link += ">";
		}
		if (meta.formats.size < 2) return [tag, link];
		let html = wrap ? "<picture>" : "";
		const formats = [...meta.formats.entries()];
		for (const [format, entries] of formats.slice(0, -1)) {
			html += `<source type="${mime(format)}" srcset="${escapeHtml(srcsetAttr(entries))}"`;
			if (sizes !== undefined) html += ` sizes="${sizes.replaceAll("\"", "&quot;")}"`;
			html += ">";
		}
		return [`${html}${tag}${wrap ? "</picture>" : ""}`, link];
	}

	/**
	 * Some HTML made ready for a feed (what `feedHtml()` does before making URLs absolute): each
	 * local `<img src>` points at one generated copy (`width` pixels wide at most, or less when the
	 * tag's own `width` says so, in `format`), since feed readers drop `<picture>` and `srcset`; a
	 * link to a local image points at the copy a page's link would; and `srcset`, `sizes`,
	 * `loading`, `decoding`, `fetchpriority` and `ssqch:*` attributes go. `pageUrl` is the page
	 * the HTML is from (a path or a whole URL), for relative image paths.
	 */
	feedImages(html: string, pageUrl: string, width: number, format: Format): string {
		if (!html.includes("<img") && !html.includes("<a")) return html;
		const pagePath = pagePathOf(pageUrl);
		const by: Pointer = { name: `feedHtml() for ${pageUrl}` };
		const sitePath = (src: string) => (src.startsWith("/") || src.includes("://") || src.startsWith("data:") ? this.resolveSiteSrc(src) : this.resolveSiteSrc(joinUrlPath(pagePath, src)));
		return rewriteHtml(html, {
			tag: (el) => {
				if (el.name === "img" && el.get("src") !== undefined) {
					const ignored = el.get("ssqch:ignore") !== undefined;
					for (const n of el.names().filter((n) => n.startsWith("ssqch:"))) el.remove(n);
					if (ignored) return;
					const src = el.get("src") ?? "";
					const file = sitePath(src);
					if (file === undefined) return;
					if (!this.isSource(file)) {
						this.warnOnce(`feedHtml(): image not found: ${src}`);
						return;
					}
					const own = parseU32(el.get("width"));
					const w = own !== undefined && own > 0 && (width === 0 || own < width) ? own : width;
					let meta: ImageMetadata;
					try { meta = this.generate(file, [w], [format]); } catch (e) {
						this.warnOnce((e as Error).message);
						return;
					}
					this.watch(meta, file, by);
					const resolved = format === "auto" ? meta.auto : format;
					const e = widest((resolved !== undefined ? meta.formats.get(resolved) : undefined) ?? [...meta.formats.values()][0]);
					if (e) el.set("src", e.url);
					for (const attr of ["srcset", "sizes", "loading", "decoding", "fetchpriority"]) if (el.get(attr) !== undefined) el.remove(attr);
				} else if (el.name === "a" && el.get("href") !== undefined) {
					if (el.get("ssqch:ignore") !== undefined) {
						el.remove("ssqch:ignore");
						return;
					}
					const href = el.get("href") ?? "";
					const file = sitePath(href);
					if (file === undefined || fromPath(file) === undefined || !this.isSource(file)) return;
					try { el.set("href", this.linkTarget(file, by)); } catch (e) { this.warnOnce((e as Error).message); }
				}
			},
		});
	}

	/** Every local `<img>` in an HTML page made a `<picture>`, and links to local images pointed at a copy. `url` is the page's, for an error. */
	transformHtml(html: string, pageInput: string, url?: string): string {
		// Most pages link to other pages, not images: one that names no image file (an extension,
		// or a %-escape that could spell one) and no `ssqch:ignore` to take off isn't read for links.
		const links = this.options.linkedImages && mayLinkImages(html);
		if (!html.includes("<img") && !links) return html;
		const preloads: string[] = [];
		const by: Pointer = { name: this.display(pageInput), url };
		// A `<picture>` the page wrote itself, for a different crop at a `media` width (art
		// direction). Its `<img>` gets its formats beside the page's own `<source>`s, not a second
		// `<picture>` inside the first, which HTML doesn't allow; and each local picture a
		// `<source>` names is published as one copy, in its own format and at its own size, so the
		// crop the page chose is the one a reader gets (the Squatch Snacks study, B1: the `<source>`
		// pointed at a file that was never in the output). A picture is over at its `<img>`, so one
		// that's never closed doesn't take the rest of the page's images with it.
		let inPicture = false;
		const out = rewriteHtml(html, {
			endTag: (name) => {
				if (name === "picture") inPicture = false;
			},
			tag: (el) => {
				const inside = inPicture;
				if (el.name === "img") inPicture = false;
				if (el.name === "picture" && el.namespace === "html") {
					inPicture = true;
				} else if (el.name === "source" && inside && el.get("srcset") !== undefined) {
					if (el.get("ssqch:ignore") !== undefined) {
						el.remove("ssqch:ignore");
						return;
					}
					// A candidate that isn't a picture in the input folder stays as written, with no
					// warning: a page that makes its own `<picture>` with `image()` names files that are
					// already copies, and its `ssqch:ignore` is on the `<img>`, which comes later.
					const srcset = el.get("srcset") ?? "";
					const published = mapSrcset(srcset, (candidate) => {
						const file = this.resolveSrc(candidate, pageInput);
						if (file === undefined || fromPath(file) === undefined || !this.isSource(file)) return candidate;
						try {
							const meta = this.generate(file, [0], ["auto"]);
							this.watch(meta, file, by);
							return widest([...meta.formats.values()].flat())?.url ?? candidate;
						} catch (e) {
							this.warnOnce((e as Error).message);
							return candidate;
						}
					});
					if (published !== srcset) el.set("srcset", published);
				} else if (el.name === "a" && el.get("href") !== undefined) {
					// Links to local images (click to enlarge), pointed at a generated copy.
					if (el.get("ssqch:ignore") !== undefined) {
						el.remove("ssqch:ignore");
						return;
					}
					if (!links) return;
					const href = el.get("href") ?? "";
					const file = this.resolveSrc(href, pageInput);
					if (file === undefined || fromPath(file) === undefined) return;
					if (!this.isSource(file)) {
						this.warnOnce(`linked image not found: ${href} (in ${pageInput})`);
						return;
					}
					try { el.set("href", this.linkTarget(file, by)); } catch (e) { this.warnOnce((e as Error).message); }
				} else if (el.name === "img" && el.get("src") !== undefined) {
					if (el.get("ssqch:ignore") !== undefined) {
						el.remove("ssqch:ignore");
						if (el.get("ssqch:preload") !== undefined) el.remove("ssqch:preload");
						return;
					}
					const preload = el.get("ssqch:preload") !== undefined;
					const src = el.get("src") ?? "";
					const file = this.resolveSrc(src, pageInput);
					if (file === undefined) return;
					if (!this.isSource(file)) {
						this.warnOnce(`image not found: ${src} (in ${pageInput})`);
						return;
					}
					// A plain `width` pins the image to that one width.
					const listed = el.get("ssqch:widths");
					const own = parseU32(el.get("width"));
					const widths = listed !== undefined ? listed.split(",").map(parseU32).filter((w): w is number => w !== undefined) : own !== undefined ? [own] : this.options.widths;
					let meta: ImageMetadata;
					try { meta = this.generate(file, widths, this.options.formats); } catch (e) {
						this.warnOnce((e as Error).message);
						return;
					}
					this.watch(meta, file, by);
					const attrs = el.entries().filter(([name]) => !name.startsWith("ssqch:"));
					const [markup, link] = this.pictureMarkup(meta, attrs, preload, !inside);
					el.replaceWith(markup);
					if (link !== undefined) preloads.push(link);
				}
			},
		});
		if (!preloads.length) return out;
		const placed = insertPreloads(out, preloads.join(""));
		if (placed === undefined) throw new BuildError(`ssqch:preload in ${pageInput}: the page has no <head> to put the preload in`);
		return placed;
	}
}

/** What a page that links to an image has somewhere in it: the extensions `fromPath` knows, a %-escape that could spell one, or `ssqch:ignore` to take off a link. */
const MAY_LINK_IMAGES = /\.(?:png|jpe?g|gif|svg|webp)|%[0-9a-f]{2}|ssqch:ignore/i;

/** Whether the transform has to read a page's links: a cheap look first, since reading every tag of every page that has a link costs a big site a tenth of its build. */
export const mayLinkImages = (html: string): boolean => html.includes("<a") && MAY_LINK_IMAGES.test(html);

/** A whole number as Rust's `trim().parse::<u32>()` reads it. */
function parseU32(v: string | undefined): number | undefined {
	if (v === undefined) return undefined;
	const t = v.trim();
	if (!/^\+?\d+$/.test(t)) return undefined;
	const n = Number(t.replace(/^\+/, ""));
	return n <= 0xffffffff ? n : undefined;
}

/** The entry with the largest width (the first of equals). */
function widest(entries: ImageEntry[] | undefined): ImageEntry | undefined {
	let best: ImageEntry | undefined;
	for (const e of entries ?? []) if (!best || e.width > best.width) best = e;
	return best;
}

/**
 * `html` with `links` in its `<head>`: before the first stylesheet or script that runs there (so
 * the browser asks for the image early), or at the end of `<head>`. `undefined` without a `<head>`.
 */
export function insertPreloads(html: string, links: string): string | undefined {
	let inHead = false;
	let seen = false;
	let at = -1;
	rewriteHtml(html, {
		tag: (el) => {
			if (el.name === "head" && !seen) {
				seen = true;
				inHead = true;
				return;
			}
			if (!inHead || at !== -1) return;
			const type = el.get("type");
			// A script that runs (not JSON-LD or another data block), or a stylesheet.
			const script = el.name === "script" && (type === undefined || ((t) => t === "" || t === "module" || t.includes("javascript"))(type.trim().toLowerCase()));
			const rel = el.name === "link" ? el.get("rel") : undefined;
			if (script || (rel !== undefined && rel.toLowerCase().split(/\s+/).includes("stylesheet"))) at = el.start;
		},
		endTag: (name, start) => {
			if (name === "head" && inHead) {
				inHead = false;
				if (at === -1) at = start;
			}
		},
	});
	if (!seen || at === -1) return undefined;
	return html.slice(0, at) + links + html.slice(at);
}

/** `imageUrl()`'s and `feedHtml()`'s options, `{ width, format }`: `who` names the function in errors, and `defaultWidth` is used without a `width` (0 is the original's). */
export function imageOptionsFor(who: string, options: unknown, defaultWidth: number): [number, Format] {
	if (options === undefined || options === null) return [defaultWidth, "auto"];
	if (typeof options !== "object" || Array.isArray(options) || options instanceof Date) throw new BuildError(`${who}: options must be an object like { width: 1200, format: "png" }`);
	for (const key of Object.keys(options)) {
		if (key !== "width" && key !== "format") throw new BuildError(`${who}: unknown option "${key}" (options: width, format)`);
	}
	const o = options as { width?: unknown; format?: unknown };
	let width = defaultWidth;
	if (o.width !== undefined && o.width !== null) {
		if (o.width === "auto") width = 0;
		else {
			const n = Number(o.width);
			if (!(Number.isFinite(n) && n >= 1 && Number.isInteger(n))) throw new BuildError(`${who}: width must be a whole number of pixels or "auto", got ${String(o.width)}`);
			width = Math.min(n, 0xffffffff);
		}
	}
	let format: Format = "auto";
	if (o.format !== undefined && o.format !== null) {
		const parsed = parseFormat(String(o.format));
		if (parsed === undefined) throw new BuildError(`${who}: unknown format "${String(o.format)}" (use avif, webp, jpeg, png, gif, svg or auto)`);
		format = parsed;
	}
	return [width, format];
}

// ---- each configuration's processor --------------------------------------------------------

const processors = new WeakMap<Config, ImageProcessor>();
let current: ImageProcessor | undefined;

/** The processor of the configuration that loaded last: what `image()`, `imageUrl()` and `feedHtml()` use. */
export function currentProcessor(): ImageProcessor {
	if (!current) throw new BuildError("the image processor isn't set up");
	return current;
}

/** `imagePlugin()`: a processor with these options, and the `<img>` transform. */
export function addImagePlugin(config: Config, options: ImageOptions): void {
	if (processors.has(config)) throw new BuildError("the ssqch/image plugin was added twice");
	const p = new ImageProcessor(options);
	processors.set(config, p);
	register(config, p, true);
}

/**
 * Once a configuration has loaded: `image()`, `imageUrl()` and `feedHtml()` work without the
 * plugin too, with its default settings (and no transform), as in 0.7. A configuration that
 * fails to load leaves the last one's processor in place, for a server that goes on with it.
 */
export function useImages(config: Config): void {
	let p = processors.get(config);
	if (!p) {
		p = new ImageProcessor(defaultImageOptions());
		processors.set(config, p);
		register(config, p, false);
	}
	current = p;
}

function register(config: Config, p: ImageProcessor, transform: boolean): void {
	p.quiet = config.quiet;
	// First, so a site's own `beforeBuild` hooks can call `image()` too.
	config.beforeBuild.unshift({ label: "", fn: () => p.startBuild(config) });
	// Template engines name the function in front of its errors already.
	const unnamed = (e: unknown) => {
		if (e instanceof Error && e.message.startsWith("imageUrl(): ")) e.message = e.message.slice("imageUrl(): ".length);
		return e;
	};
	config.filters.set("imageUrl", (src?: unknown, options?: unknown) => {
		try {
			const [width, format] = imageOptionsFor("imageUrl()", options, 0);
			return p.imageUrl(src === undefined || src === null ? "" : String(src), width, format);
		} catch (e) {
			throw unnamed(e);
		}
	});
	if (transform) {
		config.htmlTransforms.push(["image", (content, info) => (path.extname(info.outputPath) === ".html" ? p.transformHtml(content, path.resolve(config.root, info.inputPath), info.url) : content)]);
	}
	// The encodes the pages asked for, done before anything reads the output: generators (a
	// sitemap, the link checker), `afterBuild` hooks and the summary. Waiting for them is part of
	// writing, as 0.7's `Time` line had it, where they were encoded with the pages.
	config.settle.push(() => p.settle());
	config.afterBuild.push({ label: "", fn: () => p.finishBuild() });
	config.summaries.push(["Images", () => p.summary()]);
}
