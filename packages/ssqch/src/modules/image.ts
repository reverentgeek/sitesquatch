// `ssqch/image`: responsive images, from 0.7's `crates/ssqch/src/js/image.js` and the plugin's
// options in `main.rs`.
//
//   import { imagePlugin, image } from "ssqch/image";
//
//   export default defineConfig({
//     plugins: [imagePlugin({ formats: ["avif", "webp", "auto"], widths: [600, 1200] })],
//   });
//
//   const derivatives = await image("src/hero.png", { widths: [600, 1200], formats: ["webp", "png"] });
//
// imagePlugin() turns every local <img> in HTML output into a <picture>. image() makes one
// image's files with the same processor, so both share its cache, encoder settings and folder.
// The processor itself is in `src/image/processor.ts`.
import fs from "node:fs";
import path from "node:path";
import { BUILTINS, meant } from "../config.ts";
import { bail } from "../diagnostics.ts";
import { addImagePlugin, currentProcessor, defaultImageOptions, imageOptionsFor, parseFormat } from "../image/processor.ts";
import type { Format } from "../image/processor.ts";
import { Options } from "./options.ts";
import { ssqchWork } from "../profile.ts";
import { readFile } from "../plugin-files.ts";

const FORMATS = ["avif", "webp", "jpeg", "jpg", "png", "gif", "svg", "auto"];
const IMAGE_OPTIONS = ["widths", "formats", "name"];
const PLUGIN_OPTIONS = ["formats", "widths", "defaultAttributes", "outputDir", "urlPath", "webpQuality", "avifQuality", "avifEffort", "jpegQuality", "minimumThreshold", "prune", "hashCache", "linkedImages", "cacheDir"];

/** The <img> transform, with the encoder settings image() also uses. */
export function imagePlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/image", builtin: "ssqch/image", options };
}

function fail(message: string): never {
	throw new TypeError(`image(): ${message}`);
}

function checkFormats(formats: unknown): Format[] {
	if (!Array.isArray(formats)) fail("formats must be an array");
	for (const f of formats) {
		if (!FORMATS.includes(f)) fail(`unknown format "${f}"${meant(f, FORMATS)} (use ${FORMATS.join(", ")})`);
	}
	return formats.map((f) => parseFormat(f)!);
}

// "auto" (or 0) is the original width.
function checkWidths(widths: unknown): number[] {
	if (!Array.isArray(widths)) fail("widths must be an array");
	return widths.map((w) => {
		if (w === "auto") return 0;
		if (!(Number.isInteger(w) && w >= 0)) fail(`widths must be whole numbers or "auto", got ${JSON.stringify(w)}`);
		return Math.min(w, 0xffffffff);
	});
}

/** One generated file, as `image()` describes it. */
interface Entry {
	format: string;
	width: number;
	height: number;
	url: string;
	sourceType: string;
	srcset: string;
	filename: string;
	outputPath: string;
	size: number;
}

/**
 * Generate an image's derivatives. Returns `{ [format]: [entry] }`, smallest first, where each
 * entry has format, width, height, url, sourceType, srcset, filename, outputPath and size. With
 * "auto" in `formats`, the files are under the format it became (`png`) and under `auto` too.
 * Files are named after a hash of the source, in the plugin's output folder; `name` gives them a
 * name and folder of your own ("/assets/sponsors/acme" writes /assets/sponsors/acme-200.webp).
 */
export async function image(src: unknown, options: Record<string, unknown> = {}): Promise<Record<string, Entry[]>> {
	if (typeof src !== "string") fail("the source must be a file path");
	if (/^https?:\/\//.test(src)) fail(`remote images aren't supported (${src})`);
	for (const key of Object.keys(options ?? {})) {
		if (!IMAGE_OPTIONS.includes(key)) fail(`unknown option "${key}"${meant(key, IMAGE_OPTIONS)} (options: ${IMAGE_OPTIONS.join(", ")}; encoder settings go on imagePlugin())`);
	}
	const { formats = ["webp", "jpeg"], widths = ["auto"], name } = options ?? {};
	if (!(name === undefined || (typeof name === "string" && name.trim()))) fail("name must be a URL path without the width and extension, like \"/assets/sponsors/acme\"");
	const file = path.resolve(src);
	const checkedWidths = checkWidths(widths);
	const checkedFormats = checkFormats(formats);
	const p = currentProcessor();
	if (!(fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false)) {
		// image() takes a path from the project and imageUrl() one from the site's root, and Squatch
		// Snacks (D5) and the blog (#15) both gave image() the site's: say which, and the one meant.
		const shown = (f: string) => { const rel = path.relative(p.root(), f); return rel.startsWith("..") || path.isAbsolute(rel) ? f : rel.split(path.sep).join("/"); };
		const site = src.startsWith("/") ? p.resolveSiteSrc(src) : undefined;
		const meant = site !== undefined && (fs.statSync(site, { throwIfNoEntry: false })?.isFile() ?? false) ? `; that's a path from the site's root, which imageUrl() takes: image() takes one from the project, "${shown(site)}"` : "; image() takes a path from the project, like \"src/img/hero.jpg\"";
		bail(`image(): file not found: ${src} (looked for ${shown(file)}${meant})`);
	}
	readFile(file);
	let meta;
	try { meta = p.generateNamed(file, checkedWidths, checkedFormats, name as string | undefined); } catch (e) { bail(`image(): ${(e as Error).message}`); }
	// Encoding is ssqch's time, not the calling filter's (see `ssqchWork`).
	const failed = await ssqchWork.wait(meta.ready);
	if (failed) bail(`image(): ${failed.message}`);
	const root = p.root();
	const out: Record<string, Entry[]> = {};
	for (const [format, entries] of meta.formats) {
		out[format] = entries.map((e) => ({
			format,
			width: e.width,
			height: e.height,
			url: e.url,
			sourceType: e.sourceType,
			srcset: e.srcset,
			filename: path.basename(e.path),
			outputPath: e.path.startsWith(root + path.sep) ? e.path.slice(root.length + 1) : e.path,
			size: fs.statSync(e.path, { throwIfNoEntry: false })?.size ?? 0,
		}));
	}
	// `formats: ["auto"]` is also there as `auto`, next to the format it became.
	if (meta.auto !== undefined && out[meta.auto]) out.auto = out[meta.auto];
	return out;
}

/**
 * One generated copy of an image: `{ url, width, height, type, format }`. `src` is a site path,
 * from the input folder the way an <img src> starting with / is ("/content/logo.png"). `width`
 * is at most that many pixels ("auto", the default, is the original's), and `format` defaults to
 * "auto", the source's own. A remote URL comes back as `{ url }`. The same function is
 * `imageUrl()` in templates.
 */
export function imageUrl(src: unknown, options?: unknown): Record<string, unknown> {
	if (typeof src !== "string") throw new TypeError("imageUrl(): the source must be a site path like \"/content/logo.png\"");
	const [width, format] = imageOptionsFor("imageUrl()", options, 0);
	return currentProcessor().imageUrl(src, width, format);
}

/**
 * A post's HTML with its local images pointed at one generated copy each (1200 pixels wide at
 * most, by default, in the source's format), as a feed needs them: what `feedHtml()` from
 * `ssqch/rss` does before it makes every URL absolute against `base`, the post's address.
 */
export function feedImages(html: string, base: string, options?: unknown): string {
	const [width, format] = imageOptionsFor("feedHtml()", options, 1200);
	return currentProcessor().feedImages(html, base, width, format);
}

/** Every encode asked for so far, done: for a generator that asks for copies after the pages' were made (`feedPlugin()`). */
export function settleImages(): Promise<void> {
	return currentProcessor().settle();
}

BUILTINS.set("ssqch/image", (config, given) => {
	// 0.7's AVIF speed is sharp's effort now, which counts the other way.
	if (typeof given === "object" && given !== null && (given as Record<string, unknown>).avifSpeed !== undefined) {
		bail("avifSpeed is 0.7's option: ssqch 0.8 has avifEffort, sharp's AVIF effort from 0 (fastest) to 9 (smallest files). 0.7's speed 8 is effort 2 (the default) and speed 4 is effort 3");
	}
	const o = new Options(given, PLUGIN_OPTIONS);
	const opts = defaultImageOptions();
	const formats = o.list("formats");
	if (formats !== undefined) {
		opts.formats = formats.map((f) => parseFormat(f) ?? bail(`unknown image format "${f}" (use avif, webp, jpeg, png, gif, svg or auto)`));
		if (!opts.formats.length) bail("formats can't be empty");
	}
	const widths = o.get("widths");
	if (widths !== undefined) {
		if (!Array.isArray(widths)) bail("widths must be an array of numbers");
		opts.widths = widths.map((w) => (Number.isInteger(w) && w >= 0 ? Math.min(w, 0xffffffff) : bail(`widths must be positive whole numbers, got ${JSON.stringify(w) ?? "null"}`)));
		opts.widthsGiven = true;
	}
	const attributes = o.get("defaultAttributes");
	if (attributes !== undefined) {
		if (typeof attributes !== "object" || Array.isArray(attributes)) bail("defaultAttributes must be an object");
		opts.defaultAttributes = Object.entries(attributes as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v) ?? "null"]);
	}
	const outputDir = o.string("outputDir");
	if (outputDir !== undefined) opts.outputSubdir = outputDir;
	const urlPath = o.string("urlPath");
	if (urlPath !== undefined) opts.urlPath = urlPath.endsWith("/") ? urlPath : `${urlPath}/`;
	// sharp's own numbers, as sharp takes them: whole, and in its range.
	const whole = (key: "webpQuality" | "avifQuality" | "jpegQuality" | "avifEffort", low: number, high: number, what: string) => {
		const n = o.number(key);
		if (n === undefined) return;
		if (!(Number.isInteger(n) && n >= low && n <= high)) bail(`${key} must be a whole number from ${low} to ${high} (${what}), got ${n}`);
		opts[key] = n;
	};
	whole("webpQuality", 1, 100, "sharp's quality");
	whole("avifQuality", 1, 100, "sharp's quality");
	whole("jpegQuality", 1, 100, "sharp's quality");
	whole("avifEffort", 0, 9, "0 is fastest, 9 makes the smallest files");
	const threshold = o.number("minimumThreshold");
	if (threshold !== undefined) opts.minimumThreshold = threshold;
	opts.prune = o.bool("prune") ?? opts.prune;
	opts.hashCache = o.bool("hashCache") ?? opts.hashCache;
	opts.linkedImages = o.bool("linkedImages") ?? opts.linkedImages;
	const cacheDir = o.get("cacheDir");
	if (cacheDir === false) opts.cacheDir = null;
	else if (typeof cacheDir === "string" && cacheDir.trim() !== "") opts.cacheDir = cacheDir;
	else if (cacheDir !== undefined) bail("cacheDir must be a folder from the project root, like \".cache/ssqch/img\", or false");
	addImagePlugin(config, opts);
});
