import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { exifOrientation, guessFormat, imageSize, oriented, probe } from "./header.ts";

const u16be = (n: number) => Buffer.from([n >> 8, n & 255]);
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** A big-endian EXIF block (TIFF header, one IFD) with an orientation. */
function exif(orientation: number): Buffer {
	return Buffer.concat([Buffer.from("MM\x00\x2a", "latin1"), u32be(8), u16be(1), u16be(0x0112), u16be(3), u32be(1), u16be(orientation), u16be(0), u32be(0)]);
}

function segment(marker: number, body: Buffer): Buffer {
	return Buffer.concat([Buffer.from([0xff, marker]), u16be(body.length + 2), body]);
}

/** A JPEG's headers: an EXIF block, an ICC profile in two parts, and a frame `width` by `height`. */
function jpeg(width: number, height: number, orientation: number): Buffer {
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exif(orientation)])),
		segment(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([2, 2]), Buffer.from("second")])),
		segment(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([1, 2]), Buffer.from("first-")])),
		segment(0xc0, Buffer.concat([Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])])),
		Buffer.from([0xff, 0xda]),
	]);
}

function chunk(type: string, data: Buffer): Buffer {
	return Buffer.concat([u32be(data.length), Buffer.from(type, "latin1"), data, u32be(0)]);
}

function png(width: number, height: number, extra: Buffer[] = []): Buffer {
	return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), chunk("IHDR", Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 6, 0, 0, 0])])), ...extra, chunk("IDAT", Buffer.alloc(2)), chunk("IEND", Buffer.alloc(0))]);
}

function file(name: string, bytes: Buffer): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-header-"));
	const p = path.join(dir, name);
	fs.writeFileSync(p, bytes);
	return p;
}

test("formats are guessed from the first bytes", () => {
	assert.equal(guessFormat(png(1, 1)), "png");
	assert.equal(guessFormat(jpeg(1, 1, 1)), "jpeg");
	assert.equal(guessFormat(Buffer.from("GIF89a....", "latin1")), "gif");
	assert.equal(guessFormat(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1")), "webp");
	assert.equal(guessFormat(Buffer.from("BM........", "latin1")), "other");
	assert.equal(guessFormat(Buffer.from("not an image", "latin1")), undefined);
});

test("a JPEG's size, orientation and profile", () => {
	const p = probe(file("turned.jpg", jpeg(30, 20, 6)), "jpeg");
	assert.deepEqual([p.width, p.height, p.orientation], [30, 20, 6]);
	assert.deepEqual(oriented(p), [20, 30], "a quarter turn swaps width and height");
	assert.equal(p.icc?.toString(), "first-second", "the profile's parts in their order");
	assert.deepEqual(oriented(probe(file("upside.jpg", jpeg(30, 20, 3)), "jpeg")), [30, 20]);
	assert.deepEqual(imageSize(file("size.jpg", jpeg(30, 20, 6))), [30, 20], "files() doesn't turn it");
});

test("a PNG's size, orientation and profile", () => {
	const icc = Buffer.from("a profile");
	const p = probe(file("a.png", png(64, 32, [chunk("iCCP", Buffer.concat([Buffer.from("ICC\0\0", "latin1"), zlib.deflateSync(icc)])), chunk("eXIf", exif(8))])), "png");
	assert.deepEqual([p.width, p.height, p.orientation, p.icc?.toString()], [64, 32, 8, "a profile"]);
	assert.deepEqual(imageSize(file("b.png", png(3, 2))), [3, 2]);
});

test("GIF and WebP sizes", () => {
	const gif = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([10, 0, 7, 0]), Buffer.alloc(8)]);
	assert.deepEqual([probe(file("a.gif", gif), "gif").width, probe(file("b.gif", gif), "gif").height], [10, 7]);
	assert.deepEqual(imageSize(file("c.gif", gif)), [10, 7]);
	// Lossless (VP8L): 14 bits each of width and height, less one.
	const bits = (100 - 1) | ((50 - 1) << 14);
	const vp8l = Buffer.concat([Buffer.from("RIFF", "latin1"), u32le(0), Buffer.from("WEBPVP8L", "latin1"), u32le(5), Buffer.from([0x2f]), u32le(bits), Buffer.alloc(1)]);
	const p = probe(file("a.webp", vp8l), "webp");
	assert.deepEqual([p.width, p.height, p.orientation], [100, 50, 1]);
	assert.deepEqual(imageSize(file("b.webp", vp8l)), [100, 50]);
});

test("files() reads more formats, and nothing from what isn't an image", () => {
	const bmp = Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(16), Buffer.from([12, 0, 0, 0, 9, 0, 0, 0]), Buffer.alloc(8)]);
	assert.deepEqual(imageSize(file("a.bmp", bmp)), [12, 9]);
	const qoi = Buffer.concat([Buffer.from("qoif", "latin1"), u32be(5), u32be(4), Buffer.alloc(6)]);
	assert.deepEqual(imageSize(file("a.qoi", qoi)), [5, 4]);
	const psd = Buffer.concat([Buffer.from("8BPS", "latin1"), Buffer.alloc(10), u32be(6), u32be(8), Buffer.alloc(4)]);
	assert.deepEqual(imageSize(file("a.psd", psd)), [8, 6]);
	const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 2, 0]), Buffer.from([16, 16]), Buffer.alloc(14), Buffer.from([0, 0]), Buffer.alloc(14)]);
	assert.deepEqual(imageSize(file("a.ico", ico)), [256, 256], "0 is 256, and the largest wins");
	const tiff = Buffer.concat([Buffer.from("II\x2a\x00", "latin1"), u32le(8), Buffer.from([2, 0]), Buffer.from([0, 1, 3, 0]), u32le(1), Buffer.from([40, 0, 0, 0]), Buffer.from([1, 1, 4, 0]), u32le(1), u32le(30), u32le(0)]);
	assert.deepEqual(imageSize(file("a.tiff", tiff)), [40, 30]);
	assert.equal(imageSize(file("notes.txt", Buffer.from("not a photo"))), undefined);
	assert.equal(imageSize(file("short.png", Buffer.from("\x89PNG", "latin1"))), undefined);
});

test("an EXIF block that says nothing is orientation 1", () => {
	assert.equal(exifOrientation(exif(9)), 1);
	assert.equal(exifOrientation(Buffer.from("junk")), 1);
	assert.equal(exifOrientation(Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exif(5)])), 5);
});
