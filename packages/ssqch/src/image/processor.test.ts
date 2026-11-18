import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "../build.ts";
import { loadConfig } from "../config.ts";
import type { Config } from "../config.ts";
import { colorPlan } from "./color.ts";
import { CACHE_FILE } from "./hashes.ts";
import { probe } from "./header.ts";
import { BuildError, capture, takeWarnings } from "../diagnostics.ts";
import { ImageProcessor, defaultImageOptions, imageOptionsFor, insertPreloads, joinUrlPath, mayLinkImages, validWidths, withoutAuto } from "./processor.ts";
import { AVIF, DEFAULTS, JPEG, WEBP, effortFromSpeed, encodeSettings, fromLegacy, legacySettings, lookup } from "./quality.ts";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp").default;

// From the tests in 0.7's plugins/image/src/lib.rs and color.rs.

test("widths never upscale", () => {
	const defaults = [300, 600, 900, 1200, 1500];
	assert.deepEqual(validWidths(810, defaults, 1.25), [300, 600, 810]);
	assert.deepEqual(validWidths(672, defaults, 1.25), [300, 600]);
	assert.deepEqual(validWidths(2000, defaults, 1.25), [300, 600, 900, 1200, 1500]);
	assert.deepEqual(validWidths(256, [48, 96, 144], 1.25), [48, 96, 144]);
	assert.deepEqual(validWidths(200, [300, 600], 1.25), [200]);
	assert.deepEqual(validWidths(64, [0, 16, 16], 1.25), [16, 64], "0 is the original's width, and repeats go");
});

test("relative paths join the page's path", () => {
	assert.equal(joinUrlPath("/posts/hike/", "./map.png"), "/posts/hike/map.png");
	assert.equal(joinUrlPath("/posts/hike/index.html", "map.png"), "/posts/hike/map.png");
	assert.equal(joinUrlPath("/posts/hike/", "../shared/a.png"), "/posts/shared/a.png");
	assert.equal(joinUrlPath("/", "a.png"), "/a.png");
});

test("preloads go before the first stylesheet in head", () => {
	const link = "<link rel=\"preload\" as=\"image\">";
	assert.equal(
		insertPreloads("<html><head><meta charset=\"utf-8\"><link rel=\"icon\" href=\"/i.png\"><link rel=\"stylesheet\" href=\"/s.css\"></head><body></body></html>", link),
		"<html><head><meta charset=\"utf-8\"><link rel=\"icon\" href=\"/i.png\"><link rel=\"preload\" as=\"image\"><link rel=\"stylesheet\" href=\"/s.css\"></head><body></body></html>",
	);
	assert.equal(insertPreloads("<head><title>x</title></head><body><script></script></body>", link), "<head><title>x</title><link rel=\"preload\" as=\"image\"></head><body><script></script></body>");
	assert.equal(insertPreloads("<p>no head</p>", link), undefined);
	assert.equal(
		insertPreloads("<head><script type=\"application/ld+json\">{}</script><script type=\"module\" src=\"/a.js\"></script></head>", link),
		"<head><script type=\"application/ld+json\">{}</script><link rel=\"preload\" as=\"image\"><script type=\"module\" src=\"/a.js\"></script></head>",
	);
	assert.equal(withoutAuto("auto, (min-width: 896px) 832px, 100vw"), "(min-width: 896px) 832px, 100vw");
	assert.equal(withoutAuto("auto"), "");
});

test("imageUrl() and feedHtml() options name what's wrong", () => {
	assert.deepEqual(imageOptionsFor("imageUrl()", undefined, 0), [0, "auto"]);
	assert.deepEqual(imageOptionsFor("feedHtml()", { format: "jpg" }, 1200), [1200, "jpeg"]);
	assert.deepEqual(imageOptionsFor("imageUrl()", { width: "auto" }, 640), [0, "auto"]);
	assert.throws(() => imageOptionsFor("imageUrl()", { size: 3 }, 0), { message: "imageUrl(): unknown option \"size\" (options: width, format)" });
	assert.throws(() => imageOptionsFor("imageUrl()", { width: 1.5 }, 0), { message: "imageUrl(): width must be a whole number of pixels or \"auto\", got 1.5" });
	assert.throws(() => imageOptionsFor("feedHtml()", { format: "bmp" }, 0), { message: "feedHtml(): unknown format \"bmp\" (use avif, webp, jpeg, png, gif, svg or auto)" });
	assert.throws(() => imageOptionsFor("imageUrl()", "big", 0), { message: "imageUrl(): options must be an object like { width: 1200, format: \"png\" }" });
});

// The changelog's conversion, for a site moving from 0.7: the same numbers as its table.
const CONVERSION = {
	jpeg: [[50, 66], [60, 72], [70, 80], [75, 85], [80, 89], [85, 93], [90, 97], [92, 100], [95, 100]],
	avif: [[30, 28], [40, 34], [45, 38], [50, 41], [55, 45], [60, 48], [65, 52], [70, 55], [75, 58], [80, 61], [85, 74], [90, 86], [95, 96], [98, 100]],
	speed: [[1, 5], [2, 4], [3, 4], [4, 3], [5, 3], [6, 3], [7, 2], [8, 2], [9, 1], [10, 0]],
};

test("the quality options are sharp's numbers, and the defaults encode as 0.7's did", () => {
	assert.deepEqual({ ...DEFAULTS }, { webpQuality: 75, avifQuality: 41, avifEffort: 2, jpegQuality: 89 });
	assert.deepEqual({ ...DEFAULTS }, { webpQuality: fromLegacy(WEBP, 75), avifQuality: fromLegacy(AVIF, 50), avifEffort: effortFromSpeed(8), jpegQuality: fromLegacy(JPEG, 80) }, "0.7's defaults, converted");
	// sharp's numbers go to sharp as they are; PNGs without adaptive filtering (decided 2026-11-18).
	const png = { adaptiveFiltering: false, compressionLevel: 6 };
	assert.deepEqual(encodeSettings(defaultImageOptions()), { jpeg: { quality: 89, mozjpeg: true }, png, webp: { quality: 75 }, avif: { quality: 41, effort: 2 } });
	assert.deepEqual(encodeSettings({ ...defaultImageOptions(), avifQuality: 48, avifEffort: 3 }).avif, { quality: 48, effort: 3 });
	assert.equal(lookup(AVIF, 55), 44.5);
	for (const [from, to] of CONVERSION.jpeg) assert.equal(fromLegacy(JPEG, from), to, `JPEG ${from}`);
	for (const [from, to] of CONVERSION.avif) assert.equal(fromLegacy(AVIF, from), to, `AVIF ${from}`);
	for (const [from, to] of CONVERSION.speed) assert.equal(effortFromSpeed(from), to, `speed ${from}`);
	for (const q of [1, 50, 75, 100]) assert.equal(fromLegacy(WEBP, q), q, "WebP's numbers are the same");
});

// A file's name has the settings in it as 0.7 wrote them, so a site that converts its numbers
// with the table keeps its names and its image cache.
test("converted settings keep 0.7's names", () => {
	assert.equal(legacySettings(DEFAULTS), "75|50|8|80");
	// The blog's: AVIF 60 at speed 4 in 0.7, 48 at effort 3 now.
	assert.equal(legacySettings({ ...DEFAULTS, avifQuality: 48, avifEffort: 3 }), "75|60|4|80");
	for (const [from, to] of CONVERSION.jpeg.filter(([, q]) => q < 100)) assert.equal(legacySettings({ ...DEFAULTS, jpegQuality: to }).split("|")[3], String(from));
	for (const [from, to] of CONVERSION.avif.filter(([, q]) => q < 100)) assert.equal(legacySettings({ ...DEFAULTS, avifQuality: to }).split("|")[1], String(from));
	// sharp's 100 is where 0.7's JPEG 92 and up and AVIF 98 and up all land: named as 0.7's 100.
	assert.equal(legacySettings({ ...DEFAULTS, avifQuality: 100, jpegQuality: 100 }), "75|100|8|100");
	for (const speed of [1, 4, 8, 9, 10]) assert.equal(legacySettings({ ...DEFAULTS, avifEffort: effortFromSpeed(speed) }).split("|")[2], String(speed));
	for (let q = 5; q <= 100; q += 5) assert.equal(legacySettings({ ...DEFAULTS, webpQuality: q }).split("|")[0], String(q));
	// A number no 0.7 number converts to is sharp's, marked so it can't be taken for one.
	assert.equal(legacySettings({ ...DEFAULTS, avifQuality: 5, avifEffort: 7, jpegQuality: 98 }), "75|s5|s7|s98");
});

/** A project with `files`, and a processor started on it as a build would. */
function project(files: Record<string, Buffer>, options = defaultImageOptions()): { root: string; p: ImageProcessor } {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-images-")));
	for (const [name, bytes] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.writeFileSync(path.join(root, name), bytes);
	}
	const p = new ImageProcessor(options);
	p.quiet = true;
	p.startBuild({ root, input: "src", output: "dist", verbose: false } as Config);
	return { root, p };
}

const pixels = (width: number, height: number, colour: string) => sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
const idOf = (url: string) => path.basename(url).split("-")[0];

test("ids depend on the contents, not the path or the time", async () => {
	const same = await pixels(8, 4, "#228b22");
	const other = await pixels(8, 4, "#a0522d");
	const { root, p } = project({ "src/a.png": same, "src/b.png": same, "src/c.png": other });
	const url = (name: string) => p.imageUrl(`/${name}`, 0, "auto").url as string;
	const id = idOf(url("a.png"));
	assert.match(id, /^[A-Za-z0-9_-]{10}$/);
	assert.equal(idOf(url("b.png")), id, "a moved or renamed image keeps its files");
	assert.notEqual(idOf(url("c.png")), id);
	// A fresh checkout gives files a new time; the id stays.
	fs.utimesSync(path.join(root, "src/a.png"), new Date(0), new Date(0));
	const again = new ImageProcessor(defaultImageOptions());
	again.startBuild({ root, input: "src", output: "dist", verbose: false } as Config);
	assert.equal(idOf(again.imageUrl("/a.png", 0, "auto").url as string), id);
	const tuned = new ImageProcessor({ ...defaultImageOptions(), webpQuality: 90 });
	tuned.startBuild({ root, input: "src", output: "dist", verbose: false } as Config);
	assert.notEqual(idOf(tuned.imageUrl("/a.png", 0, "auto").url as string), id, "encoder settings are part of the id");
	await p.settle();
	await again.settle();
	await tuned.settle();
	fs.rmSync(root, { recursive: true });
});

test("the hash cache skips unchanged files and reads changed ones again", async () => {
	const { root, p } = project({ "src/a.png": await pixels(8, 4, "#228b22") });
	const file = path.join(root, "src/a.png");
	// A time in whole seconds, which setting it again gives back exactly.
	const mtime = new Date(1_700_000_000_000);
	fs.utimesSync(file, mtime, mtime);
	const id = idOf(p.imageUrl("/a.png", 0, "auto").url as string);
	await p.settle();
	p.finishBuild();
	const cache = JSON.parse(fs.readFileSync(path.join(root, CACHE_FILE), "utf8"));
	const entry = cache.files[path.join(root, "src/a.png")];
	assert.equal(cache.version, 1);
	assert.deepEqual([entry.id, entry.settings, typeof entry.mtime], [id, "75|50|8|80|color1", "string"]);
	// The same size and time with other bytes (another green, as long): the id comes from the
	// cache. That's the trade.
	const other = await pixels(8, 4, "#228b23");
	assert.equal(other.length, fs.statSync(file).size);
	fs.writeFileSync(file, other);
	fs.utimesSync(file, mtime, mtime);
	p.startBuild({ root, input: "src", output: "dist", verbose: false } as Config);
	assert.equal(idOf(p.imageUrl("/a.png", 0, "auto").url as string), id);
	// A new time (an edit, or a fresh checkout) means reading the file again.
	fs.utimesSync(file, new Date(mtime.getTime() + 1000), new Date(mtime.getTime() + 1000));
	p.startBuild({ root, input: "src", output: "dist", verbose: false } as Config);
	assert.notEqual(idOf(p.imageUrl("/a.png", 0, "auto").url as string), id);
	// A broken cache is an empty one.
	fs.writeFileSync(path.join(root, CACHE_FILE), "not json");
	const fresh = new ImageProcessor(defaultImageOptions());
	fresh.startBuild({ root, input: "src", output: "dist", verbose: false } as Config);
	assert.notEqual(idOf(fresh.imageUrl("/a.png", 0, "auto").url as string), id);
	await p.settle();
	await fresh.settle();
	fs.rmSync(root, { recursive: true });
});

test("Display P3 is converted, sRGB and no profile are kept", async () => {
	const tagged = async (profile: string) => {
		const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#c86450" } }).withIccProfile(profile).png().toBuffer();
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-icc-")), "a.png");
		fs.writeFileSync(file, bytes);
		return colorPlan(probe(file, "png").icc).kind;
	};
	assert.equal(await tagged("p3"), "convert");
	assert.equal(await tagged("srgb"), "keep");
	assert.equal(colorPlan(undefined).kind, "keep");
	assert.equal(colorPlan(Buffer.from("not a profile")).kind, "keep");
});

test("a page's images become a picture, and the files are made", async () => {
	const { root, p } = project({ "src/img/a.png": await pixels(64, 32, "#228b22") }, { ...defaultImageOptions(), formats: ["webp", "auto"], widths: [16, 32] });
	const page = path.join(root, "src/index.html");
	const html = p.transformHtml("<p><img src=\"/img/a.png\" alt=\"A\"> <img src=\"https://x.example/b.png\"> <img src=\"a.png\" alt=\"Plain\" ssqch:ignore></p>", page);
	assert.match(html, /^<p><picture><source type="image\/webp" srcset="\/img\/[\w-]{10}-16\.webp 16w, \/img\/[\w-]{10}-32\.webp 32w" sizes="auto"><img loading="lazy" decoding="async" src="\/img\/[\w-]{10}-16\.png" alt="A" srcset="[^"]+" sizes="auto" width="32" height="16"><\/picture> <img src="https:\/\/x\.example\/b\.png"> <img src="a\.png" alt="Plain"><\/p>$/);
	await p.settle();
	assert.equal(fs.readdirSync(path.join(root, "dist/img")).length, 4);
	assert.equal(p.summary()?.replace(/, [\d.]+ [KM]?B:/, ", <size>:"), "4 files from 1 source, <size>: 4 encoded, 0 reused");
	const meta = await sharp(fs.readdirSync(path.join(root, "dist/img")).map((n) => path.join(root, "dist/img", n)).find((n) => n.endsWith("-16.webp"))!).metadata();
	assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 16, 8]);
	fs.rmSync(root, { recursive: true });
});

/** A PNG of noise, which doesn't compress away, so a third of it ends inside its image data. */
const noise = (width: number, height: number) => {
	const raw = Buffer.alloc(width * height * 3);
	let s = 76;
	for (let i = 0; i < raw.length; i++) raw[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 23;
	return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
};

// 0.7 decoded an image before it wrote anything that pointed at it, and left the tag as it was
// written when it couldn't; the Node build writes markup from the header, so it reads a source
// through before any of its files are promised (#1, #4, #6 of stage 5's review).
test("an image that can't be decoded is a warning, and its tags stay as written", async () => {
	const whole = await noise(120, 80);
	const options = { ...defaultImageOptions(), formats: ["webp" as const], widths: [60] };
	const { root, p } = project({ "src/pics/t.png": whole.subarray(0, Math.floor(whole.length / 3)), "src/pics/ok.png": whole }, options);
	const page = path.join(root, "src/index.html");
	// The URL's path joined to the input folder as it's written, as 0.7's `Path::join` did.
	const broken = `${path.join(root, "src")}${path.sep}pics/t.png`;
	const html = "<img src=\"/pics/t.png\" alt=\"t\"><a href=\"/pics/t.png\">big</a><img src=\"/pics/ok.png\" alt=\"ok\">";
	capture();
	try {
		const out = p.transformHtml(html, page);
		assert.ok(out.startsWith("<img src=\"/pics/t.png\" alt=\"t\"><a href=\"/pics/t.png\">big</a><img loading=\"lazy\""), out);
		assert.deepEqual(takeWarnings().map((w) => w.message), [`decoding ${broken}: unexpected end of file`]);
		// The feed's copy and a template's URL alike.
		const feed = p.feedImages("<p><img src=\"/pics/t.png\"></p>", "/posts/a/", 1200, "auto");
		assert.equal(feed, "<p><img src=\"/pics/t.png\"></p>");
		assert.throws(() => p.imageUrl("/pics/t.png", 1200, "png"), { message: `decoding ${broken}: unexpected end of file` });
		await p.settle();
		// Only what was made is counted, and only it is in the output.
		assert.equal(p.summary()?.replace(/, [\d.]+ [KM]?B:/, ", <size>:"), "1 file from 1 source, <size>: 1 encoded, 0 reused");
		assert.deepEqual(fs.readdirSync(path.join(root, "dist/img")).map((n) => n.replace(/^[\w-]{10}/, "<id>")), ["<id>-60.webp"]);
		assert.deepEqual(takeWarnings(), [], "said once");
	} finally {
		capture(false);
		fs.rmSync(root, { recursive: true });
	}
});

// What sharp can't do is known from the header too: an image of more pixels than it decodes, and
// a file wider than its format allows, are warnings before any markup points at them.
test("an image too big for sharp is a warning, and its tag stays as written", async () => {
	const wide = await sharp({ create: { width: 17000, height: 4, channels: 3, background: "#228b22" } }).png().toBuffer();
	// A header that says 20,000 pixels square, with no more behind it than its first row.
	const huge = Buffer.from(await pixels(1, 1, "#228b22"));
	huge.writeUInt32BE(20000, 16);
	huge.writeUInt32BE(20000, 20);
	const { root, p } = project({ "src/wide.png": wide, "src/huge.png": huge }, { ...defaultImageOptions(), formats: ["webp"], widths: [0] });
	capture();
	try {
		const html = "<img src=\"/wide.png\" alt=\"Wide\"><img src=\"/huge.png\" alt=\"Huge\">";
		assert.equal(p.transformHtml(html, path.join(root, "src/index.html")), html);
		const messages = takeWarnings().map((w) => w.message.replace(root, "<root>").replaceAll("\\", "/"));
		assert.match(messages[0], /^encoding \.\/dist\/img\/[\w-]{10}-17000\.webp from <root>\/src\/wide\.png: 17000x4 is larger than WEBP allows \(16383 pixels a side\)$/);
		assert.equal(messages[1], "decoding <root>/src/huge.png: 20000x20000 is more pixels than ssqch decodes (268,402,689)");
		await p.settle();
	} finally {
		capture(false);
		fs.rmSync(root, { recursive: true });
	}
});

// 0.7's JPEG decoder padded a JPEG that ends inside its image data with grey, and so does sharp's
// when it isn't told to fail on it.
test("a JPEG that ends too soon is made, padded with grey, as 0.7 made it", async () => {
	const raw = Buffer.alloc(120 * 80 * 3);
	for (let i = 0; i < raw.length; i++) raw[i] = (i * 31) & 255;
	const jpeg = await sharp(raw, { raw: { width: 120, height: 80, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
	const { root, p } = project({ "src/t.jpg": jpeg.subarray(0, Math.floor(jpeg.length / 3)) }, { ...defaultImageOptions(), formats: ["webp", "auto"], widths: [120] });
	capture();
	try {
		const out = p.transformHtml("<img src=\"/t.jpg\" alt=\"T\">", path.join(root, "src/index.html"));
		assert.ok(out.startsWith("<picture>"), out);
		await p.settle();
		assert.deepEqual(takeWarnings(), []);
		const made = fs.readdirSync(path.join(root, "dist/img")).find((n) => n.endsWith(".jpeg"))!;
		const { data, info } = await sharp(path.join(root, "dist/img", made)).raw().toBuffer({ resolveWithObject: true });
		const last = data.subarray(data.length - info.width * info.channels);
		assert.ok(Math.abs(last.reduce((sum, b) => sum + b, 0) / last.length - 128) < 4, "its last row is grey");
	} finally {
		capture(false);
		fs.rmSync(root, { recursive: true });
	}
});

// What the check can't see (sharp failing on a source that read whole, a full disk) is found
// after pages that point at its files were written, so the build fails rather than ship them.
test("a file that fails after its markup is out fails the build, naming the source and the page", async () => {
	const { root, p } = project({ "src/pics/a.png": await noise(40, 20), "src/pics/b.png": await noise(30, 20) }, { ...defaultImageOptions(), formats: ["webp"], widths: [20] });
	// The cache folder is a file now: nothing can be written there.
	const html = p.transformHtml("<img src=\"/pics/a.png\" alt=\"a\">", path.join(root, "src/index.html"), "/");
	assert.match(html, /<img [^>]*src="\/img\/[\w-]{10}-20\.webp"/);
	p.transformHtml("<img src=\"/pics/a.png\" alt=\"a\"><img src=\"/pics/b.png\" alt=\"b\">", path.join(root, "src/hike.html"), "/hike/");
	p.imageUrl("/pics/a.png", 20, "webp");
	const cache = path.join(root, ".cache/ssqch/img");
	// The encodes started with the markup (one for each core), and on Windows a folder one is
	// writing into can't be removed that instant: try again, and what's still encoding then
	// finds a file where its folder was.
	fs.rmSync(cache, { recursive: true, maxRetries: 20, retryDelay: 10 });
	fs.writeFileSync(cache, "not a folder");
	await assert.rejects(p.settle(), (e: BuildError) => {
		assert.match(e.message, /^images: encoding \.\/dist\/img\/[\w-]{10}-20\.webp from \.\/src\/pics\/a\.png: .+\. \.\/src\/index\.html and 2 more already point at it, so the build stops here rather than publish tracks that lead nowhere \(and 1 more image that failed\)$/);
		assert.ok(!e.message.includes("\n"), "one line of libvips's: the rest of its buffer can be another encode's");
		// For `--format json`: an `images` error for each source, with the source and the first page.
		const items = (e.items ?? []).map(({ severity, code, file, url }) => ({ severity, code, file, url }));
		assert.deepEqual(items, [
			{ severity: "error", code: "images", file: "src/pics/a.png", url: "/" },
			{ severity: "error", code: "images", file: "src/pics/b.png", url: "/hike/" },
		]);
		assert.match(e.items![1].message, /^images: encoding \.\/dist\/img\/[\w-]{10}-20\.webp from \.\/src\/pics\/b\.png: .+\. \.\/src\/hike\.html already points at it, so the build stops here/);
		return true;
	});
	fs.rmSync(root, { recursive: true });
});

// 0.7 dropped the alpha channel for a JPEG and kept the colour under it; sharp resizes with the
// colour weighted by the alpha, black where it's clear, so the alpha goes before the resize (#2).
test("a JPEG of a transparent PNG keeps the colour under the transparency", async () => {
	const rgba = Buffer.alloc(200 * 100 * 4);
	for (let y = 0; y < 100; y++) for (let x = 0; x < 200; x++) rgba.set(x < 100 ? [255, 0, 0, 255] : [255, 255, 255, 0], (y * 200 + x) * 4);
	const logo = await sharp(rgba, { raw: { width: 200, height: 100, channels: 4 } }).png().toBuffer();
	const { root, p } = project({ "src/logo.png": logo }, { ...defaultImageOptions(), formats: ["jpeg"], widths: [100, 200] });
	// One file from the file, and two from pixels decoded once.
	const one = p.imageUrl("/logo.png", 0, "jpeg").url as string;
	p.transformHtml("<img src=\"/logo.png\" alt=\"Logo\">", path.join(root, "src/index.html"));
	await p.settle();
	const pixel = async (file: string, x: number, y: number) => {
		const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
		return [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
	};
	assert.deepEqual(await pixel(path.join(root, "dist", one), 150, 50), [255, 255, 255]);
	const half = fs.readdirSync(path.join(root, "dist/img")).find((n) => n.endsWith("-100.jpeg"))!;
	assert.deepEqual(await pixel(path.join(root, "dist/img", half), 75, 25), [255, 255, 255]);
	assert.ok((await pixel(path.join(root, "dist/img", half), 25, 25))[0] > 250, "and the red stays red");
	fs.rmSync(root, { recursive: true });
});

// 0.7 wrote a PNG in the source's own kind of pixels: sharp would make every one 8-bit RGB, and
// a grey screenshot twice as big (#10).
test("a PNG of a grey or 16-bit source stays grey or 16 bits", async () => {
	const grey = await sharp(Buffer.alloc(64 * 32, 128), { raw: { width: 64, height: 32, channels: 1 } }).toColourspace("b-w").png().toBuffer();
	assert.equal(grey[25], 0, "a grey PNG");
	const deep = await sharp(Buffer.alloc(64 * 32 * 6, 200), { raw: { width: 64, height: 32, channels: 3, premultiplied: false } }).toColourspace("rgb16").png().toBuffer();
	const { root, p } = project({ "src/grey.png": grey, "src/deep.png": deep }, { ...defaultImageOptions(), formats: ["webp", "auto"], widths: [16, 32] });
	const out = p.transformHtml("<img src=\"/grey.png\" alt=\"Grey\"><img src=\"/deep.png\" alt=\"Deep\">", path.join(root, "src/index.html"));
	await p.settle();
	const files = [...out.matchAll(/\/img\/[\w-]+-32\.(?:png|webp)/g)].map((m) => path.join(root, "dist", m[0]));
	const kinds = await Promise.all(files.map(async (f) => { const m = await sharp(f).metadata(); return `${path.extname(f)} ${m.channels} ${m.depth}`; }));
	assert.deepEqual(kinds, [".webp 3 uchar", ".png 1 uchar", ".webp 3 uchar", ".png 3 ushort"]);
	fs.rmSync(root, { recursive: true });
});

// sharp can't shrink a PNG while it decodes it, as it does a JPEG, so a PNG's files come from its
// pixels decoded once, not once a file (#9).
test("a PNG is decoded once for all its files", async () => {
	const { root, p } = project({ "src/a.png": await noise(64, 48) }, { ...defaultImageOptions(), formats: ["avif", "webp", "auto"], widths: [16, 32, 48] });
	const decodes: string[] = [];
	const decode = (p as unknown as { decode: (job: { src: string }) => Promise<unknown> }).decode.bind(p);
	(p as unknown as { decode: (job: { src: string }) => Promise<unknown> }).decode = (job) => { decodes.push(job.src); return decode(job); };
	p.transformHtml("<img src=\"/a.png\" alt=\"A\">", path.join(root, "src/index.html"));
	await p.settle();
	assert.equal(decodes.length, 1);
	assert.equal(fs.readdirSync(path.join(root, "dist/img")).length, 9);
	fs.rmSync(root, { recursive: true });
});

// 0.7 encoded a page's images as it wrote the page, so its `Time` line counted them under
// `write`; the Node build waits for them after the last page, and that's still writing (#13).
test("the wait for image files is part of writing, as 0.7's Time line had it", async () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-images-time-")));
	fs.mkdirSync(path.join(root, "src/img"), { recursive: true });
	fs.writeFileSync(path.join(root, "ssqch.config.js"), "import { imagePlugin } from \"ssqch/image\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [imagePlugin({ formats: [\"webp\"], widths: [16] })] };\n");
	fs.writeFileSync(path.join(root, "src/img/a.png"), await pixels(32, 16, "#228b22"));
	fs.writeFileSync(path.join(root, "src/index.html"), "<p><img src=\"/img/a.png\" alt=\"A\"></p>\n");
	const cwd = process.cwd();
	try {
		const config = await loadConfig({ root, env: "production", quiet: true });
		assert.ok(!config.generators.some(([name]) => name === "ssqch/image"), "not a generator, which `copy` counts");
		assert.equal(config.settle.length, 1);
		// Waiting longer than the rest of the build takes, so the times can't be mistaken.
		const wait = config.settle[0];
		config.settle[0] = async () => { await wait(); await new Promise((resolve) => setTimeout(resolve, 300)); };
		const report = await build(config);
		const time = Object.fromEntries(report.timings);
		assert.ok(time.write >= 290 && time.copy < 290, JSON.stringify(report.timings));
		assert.ok(fs.readFileSync(path.join(root, "dist/index.html"), "utf8").includes("<img loading=\"lazy\""));
	} finally {
		process.chdir(cwd);
		fs.rmSync(root, { recursive: true });
	}
});

test("a page without a link to an image isn't read for links", () => {
	assert.equal(mayLinkImages("<p><a href=\"/posts/hike/\">Hike</a> <a href=\"https://x.example/\">x</a></p>"), false);
	assert.equal(mayLinkImages("<a href=\"/pics/map.PNG\">Map</a>"), true);
	assert.equal(mayLinkImages("<a href=\"/pics/map%2Epng\">Map</a>"), true, "an escape could spell an extension");
	assert.equal(mayLinkImages("<a href=\"/about/\" ssqch:ignore>About</a>"), true, "ssqch:ignore comes off the link");
	assert.equal(mayLinkImages("<p>map.png</p>"), false, "no link at all");
});
