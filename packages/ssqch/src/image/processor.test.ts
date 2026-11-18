import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { Config } from "../config.ts";
import { colorPlan } from "./color.ts";
import { CACHE_FILE } from "./hashes.ts";
import { probe } from "./header.ts";
import { ImageProcessor, defaultImageOptions, f32String, imageOptionsFor, insertPreloads, joinUrlPath, validWidths, withoutAuto } from "./processor.ts";
import { encodeSettings, lookup, AVIF } from "./quality.ts";

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

test("encoder settings are written as Rust wrote an f32", () => {
	assert.equal(f32String(75), "75");
	assert.equal(f32String(60.5), "60.5");
	assert.equal(f32String(60.3), "60.3");
	assert.equal(f32String(0.1), "0.1");
	assert.equal(f32String(1e-7), "0.0000001");
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

test("0.7's quality numbers become sharp's", () => {
	assert.deepEqual(encodeSettings(defaultImageOptions()), { jpeg: { quality: 89, mozjpeg: true }, png: {}, webp: { quality: 75 }, avif: { quality: 41, effort: 2 } });
	// The blog's: AVIF 60 at speed 4.
	assert.deepEqual(encodeSettings({ ...defaultImageOptions(), avifQuality: 60, avifSpeed: 4 }).avif, { quality: 48, effort: 3 });
	assert.deepEqual(encodeSettings({ ...defaultImageOptions(), avifQuality: 0, avifSpeed: 10, jpegQuality: 100, webpQuality: 100 }), { jpeg: { quality: 100, mozjpeg: true }, png: {}, webp: { quality: 100 }, avif: { quality: 10, effort: 0 } });
	assert.equal(lookup(AVIF, 55), 44.5);
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
	// The same size and time with other bytes (the last of its end chunk): the id comes from the
	// cache. That's the trade.
	const bytes = fs.readFileSync(file);
	bytes[bytes.length - 1] ^= 1;
	fs.writeFileSync(file, bytes);
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
	// (Their files are of a PNG that's no longer quite one, and may not be made.)
	await p.settle().catch(() => {});
	await fresh.settle().catch(() => {});
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
