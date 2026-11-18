import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { exifOrientation, guessFormat, imageSize, oriented, probe, probeFile, undecodable } from "./header.ts";

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
		segment(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])),
	]);
}

function chunk(type: string, data: Buffer): Buffer {
	const named = Buffer.concat([Buffer.from(type, "latin1"), data]);
	return Buffer.concat([u32be(data.length), named, u32be(zlib.crc32(named) >>> 0)]);
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

const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (width: number, height: number, depth: number, colour: number) => chunk("IHDR", Buffer.concat([u32be(width), u32be(height), Buffer.from([depth, colour, 0, 0, 0])]));

// 0.7's decoders, through the `image` crate, said what was wrong with a file in their own words,
// and its warnings and errors quote them: `reading <file>: <this>` for a header, `decoding <file>:
// <this>` for the rest.
test("a broken header is named as 0.7's decoders named it", () => {
	const fails = (name: string, bytes: Buffer, format: "png" | "jpeg" | "gif" | "webp") => {
		try { probeFile(file(name, bytes), format); } catch (e) { return (e as Error).message; }
		return "read";
	};
	const text = Buffer.from("this is not an image\n");
	assert.equal(fails("text.png", text, "png"), "Format error decoding Png: Invalid PNG signature.");
	assert.equal(fails("text.jpg", text, "jpeg"), "Format error decoding Jpeg: Error parsing image. Illegal start bytes:7468");
	assert.equal(fails("text.gif", text, "gif"), "Format error decoding Gif: malformed GIF header");
	assert.equal(fails("text.webp", text, "webp"), "Format error decoding WebP: Invalid Chunk header: [52, 49, 46, 46]");
	assert.equal(fails("empty.jpg", Buffer.alloc(0), "jpeg"), "Format error decoding Jpeg: I/O errors Not enough bytes, expected 2 but found 0");
	const whole = jpeg(30, 20, 1);
	const sos = whole.lastIndexOf(Buffer.from([0xff, 0xda]));
	assert.equal(fails("headers.jpg", whole.subarray(0, sos), "jpeg"), "Format error decoding Jpeg: I/O errors Not enough bytes, expected 1 but found 0", "it ends before its image data");
	const dqt = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64)]))]);
	assert.equal(fails("dqt.jpg", dqt.subarray(0, 40), "jpeg"), "Format error decoding Jpeg: I/O errors Not enough bytes, expected 64 but found 33");
	assert.equal(fails("whole.jpg", whole, "jpeg"), "read");
	assert.equal(fails("short.png", png(4, 4).subarray(0, 30), "png"), "unexpected end of file");
	assert.equal(fails("nodata.png", Buffer.concat([PNG_START, ihdr(4, 4, 8, 6), chunk("IEND", Buffer.alloc(0))]), "png"), "Format error decoding Png: IDAT or fdAT chunk is missing.");
	assert.equal(fails("short.gif", Buffer.from("GIF89a\x01", "latin1"), "gif"), "Format error decoding Gif: Unexpected End of File");
	assert.equal(fails("short.webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"), "webp"), "failed to fill whole buffer");
	assert.equal(fails("avi.webp", Buffer.from("RIFF\0\0\0\0AVI LIST\0\0\0\0", "latin1"), "webp"), "Format error decoding WebP: Invalid WebP signature: [41, 56, 49, 20]");
	// What 0.7 wrote a PNG of in grey, and in 16 bits.
	const grey = probeFile(file("grey.png", Buffer.concat([PNG_START, ihdr(4, 4, 16, 0), chunk("IDAT", Buffer.alloc(2)), chunk("IEND", Buffer.alloc(0))])), "png");
	assert.deepEqual([grey?.grey, grey?.sixteen], [true, true]);
	assert.deepEqual([probe(file("rgba.png", png(4, 4)), "png").grey, probe(file("rgba.png", png(4, 4)), "png").sixteen], [false, false]);
});

test("what 0.7 couldn't decode past the header is found before anything is encoded", () => {
	const whole = png(4, 4);
	assert.equal(undecodable(whole, "png"), undefined);
	assert.equal(undecodable(whole.subarray(0, whole.length - 12), "png"), "unexpected end of file", "no end chunk");
	assert.equal(undecodable(whole.subarray(0, whole.length - 20), "png"), "unexpected end of file", "the image data cut short");
	const damaged = Buffer.from(whole);
	damaged[damaged.indexOf("IDAT") + 4] ^= 0x55;
	assert.match(undecodable(damaged, "png") ?? "", /^Format error decoding Png: CRC error: expected 0x[0-9a-f]+ have 0x[0-9a-f]+ while decoding ChunkType \{ type: IDAT, critical: true, private: false, reserved: false, safecopy: false \} chunk\.$/);
	// A damaged chunk a decoder can do without isn't checked: 0.7's decoder passed over it.
	const noted = png(4, 4, [chunk("tEXt", Buffer.from("Comment\0pine cones"))]);
	noted[noted.indexOf("pine")] ^= 1;
	assert.equal(undecodable(noted, "png"), undefined);
	// A GIF's first frame: its descriptor, then sub-blocks up to a 0.
	const gif = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([2, 0, 2, 0, 0x80, 0, 0]), Buffer.alloc(6), Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b])]);
	assert.equal(undecodable(gif, "gif"), undefined);
	assert.equal(undecodable(gif.subarray(0, 24), "gif"), "Format error decoding Gif: Unexpected End of File");
	const bits = (100 - 1) | ((50 - 1) << 14);
	const vp8l = Buffer.concat([Buffer.from("RIFF", "latin1"), u32le(26), Buffer.from("WEBPVP8L", "latin1"), u32le(10), Buffer.from([0x2f]), u32le(bits), Buffer.alloc(5)]);
	assert.equal(undecodable(vp8l, "webp"), undefined);
	assert.equal(undecodable(vp8l.subarray(0, 25), "webp"), "Format error decoding WebP: Corrupt bitstream");
	assert.equal(undecodable(Buffer.from([0xff, 0xd8, 0xff]), "jpeg"), undefined, "a JPEG's image data is decoded padded, as 0.7's decoder did");
});
