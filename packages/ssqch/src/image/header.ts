// What an image's first bytes say: its format, its size, how it's turned (EXIF orientation) and
// its colour profile, read without decoding a pixel. Synchronous, so a template's `imageUrl()`
// and `files(pattern, { dimensions: true })` can answer at once; only encoding waits for sharp.
//
// `probe` reads what 0.7's image plugin read through the `image` crate (JPEG, PNG, GIF and WebP,
// its decoders), and `imageSize` what `files()` read through the `imagesize` crate (more formats,
// no orientation), so both give 0.7's numbers.
import fs from "node:fs";
import zlib from "node:zlib";

/** Reads a file at any position, keeping its first 16 KB, where headers usually are, in memory. */
class FileBytes {
	private fd: number;
	readonly size: number;
	private head: Buffer;

	constructor(file: string) {
		this.fd = fs.openSync(file, "r");
		try {
			this.size = fs.fstatSync(this.fd).size;
			this.head = Buffer.allocUnsafe(Math.min(this.size, 16384));
			fs.readSync(this.fd, this.head, 0, this.head.length, 0);
		} catch (e) {
			fs.closeSync(this.fd);
			throw e;
		}
	}

	/** Exactly `length` bytes at `at`, or an error past the end. */
	read(at: number, length: number): Buffer {
		if (at < 0 || at + length > this.size) throw new Error("unexpected end of file");
		if (at + length <= this.head.length) return this.head.subarray(at, at + length);
		const out = Buffer.alloc(length);
		fs.readSync(this.fd, out, 0, length, at);
		return out;
	}

	close(): void {
		fs.closeSync(this.fd);
	}
}

function withBytes<T>(file: string, read: (bytes: FileBytes) => T): T {
	const bytes = new FileBytes(file);
	try {
		return read(bytes);
	} finally {
		bytes.close();
	}
}

/** The formats ssqch decodes. */
export type Decodable = "jpeg" | "png" | "gif" | "webp";

/** The format the file's first bytes say, as the `image` crate guessed it: one it decodes, `"other"` for one it knows but doesn't decode, or `undefined`. */
export function guessFormat(head: Uint8Array): Decodable | "other" | undefined {
	const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
	const text = (at: number, s: string) => [...s].every((c, i) => head[at + i] === c.charCodeAt(0));
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
	if (starts(0xff, 0xd8, 0xff)) return "jpeg";
	if (text(0, "GIF89a") || text(0, "GIF87a")) return "gif";
	if (text(0, "RIFF") && text(8, "WEBP")) return "webp";
	if (text(0, "MM\x00*") || text(0, "II*\x00") || text(0, "BM") || starts(0, 0, 1, 0) || text(0, "#?RADIANCE") || text(0, "qoif") || text(4, "ftyp") || text(0, "DDS ") || starts(0x76, 0x2f, 0x31, 0x01) || text(0, "farbfeld") || /^P[1-7]$/.test(String.fromCharCode(head[0] ?? 0, head[1] ?? 0))) return "other";
	return undefined;
}

export interface Probe {
	format: Decodable;
	/** Before the orientation is applied. */
	width: number;
	height: number;
	/** EXIF orientation, 1 to 8 (1 when there's none). */
	orientation: number;
	/** The embedded ICC profile, if any. */
	icc?: Buffer;
}

/**
 * The real format of `file` from its first bytes (a `.png` may hold a JPEG), or `named` (from its
 * extension) when they don't say one ssqch decodes, and that format's header, in one read.
 * `undefined` when it's neither.
 */
export function probeFile(file: string, named: Decodable | undefined): Probe | undefined {
	return withBytes(file, (bytes) => {
		const guessed = guessFormat(bytes.read(0, Math.min(32, bytes.size)));
		const format = guessed !== undefined && guessed !== "other" ? guessed : named;
		return format === undefined ? undefined : probeBytes(bytes, format);
	});
}

/** The size, orientation and colour profile of a JPEG, PNG, GIF or WebP file (`format`, from its contents). */
export function probe(file: string, format: Decodable): Probe {
	return withBytes(file, (bytes) => probeBytes(bytes, format));
}

function probeBytes(bytes: FileBytes, format: Decodable): Probe {
	switch (format) {
		case "jpeg": return probeJpeg(bytes);
		case "png": return probePng(bytes);
		case "gif": return { format, width: bytes.read(6, 2).readUInt16LE(0), height: bytes.read(8, 2).readUInt16LE(0), orientation: 1 };
		case "webp": return probeWebp(bytes);
	}
}

/** The width and height once the orientation is applied: turned a quarter for 5 to 8. */
export function oriented(p: Probe): [number, number] {
	return p.orientation >= 5 && p.orientation <= 8 ? [p.height, p.width] : [p.width, p.height];
}

function probeJpeg(bytes: FileBytes): Probe {
	let at = 2;
	let size: [number, number] | undefined;
	let exif: Buffer | undefined;
	const icc: Array<[number, Buffer]> = [];
	while (at + 4 <= bytes.size) {
		const head = bytes.read(at, 2);
		if (head[0] !== 0xff) throw new Error("not a JPEG marker");
		const marker = head[1];
		// Fill bytes, and markers without a length.
		if (marker === 0xff) { at += 1; continue; }
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }
		if (marker === 0xd9 || marker === 0xda) break;
		const length = bytes.read(at + 2, 2).readUInt16BE(0);
		const body = at + 4;
		if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (!size) {
				const sof = bytes.read(body, 5);
				size = [sof.readUInt16BE(3), sof.readUInt16BE(1)];
			}
		} else if (marker === 0xe1 && length >= 8) {
			const data = bytes.read(body, length - 2);
			if (!exif && data.subarray(0, 6).toString("latin1") === "Exif\0\0") exif = data.subarray(6);
		} else if (marker === 0xe2 && length >= 16) {
			const data = bytes.read(body, length - 2);
			if (data.subarray(0, 12).toString("latin1") === "ICC_PROFILE\0") icc.push([data[12], data.subarray(14)]);
		}
		at = body + length - 2;
	}
	if (!size) throw new Error("no frame header (SOF) found");
	icc.sort((a, b) => a[0] - b[0]);
	return { format: "jpeg", width: size[0], height: size[1], orientation: exif ? exifOrientation(exif) : 1, icc: icc.length ? Buffer.concat(icc.map(([, part]) => part)) : undefined };
}

function probePng(bytes: FileBytes): Probe {
	const ihdr = bytes.read(16, 8);
	const out: Probe = { format: "png", width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), orientation: 1 };
	// The chunks before the image data: iCCP (the profile) and eXIf.
	let at = 8;
	while (at + 8 <= bytes.size) {
		const head = bytes.read(at, 8);
		const length = head.readUInt32BE(0);
		const type = head.subarray(4, 8).toString("latin1");
		if (type === "IDAT" || type === "IEND") break;
		if (type === "iCCP" && !out.icc) {
			const data = bytes.read(at + 8, length);
			const name = data.indexOf(0);
			try { out.icc = zlib.inflateSync(data.subarray(name + 2)); } catch { /* an unreadable profile is none */ }
		} else if (type === "eXIf") {
			out.orientation = exifOrientation(bytes.read(at + 8, length));
		}
		at += 12 + length;
	}
	return out;
}

function probeWebp(bytes: FileBytes): Probe {
	const out: Probe = { format: "webp", width: 0, height: 0, orientation: 1 };
	let at = 12;
	let sized = false;
	while (at + 8 <= bytes.size) {
		const head = bytes.read(at, 8);
		const type = head.subarray(0, 4).toString("latin1");
		const length = head.readUInt32LE(4);
		const body = at + 8;
		if (type === "VP8X") {
			const d = bytes.read(body, 10);
			[out.width, out.height] = [d.readUIntLE(4, 3) + 1, d.readUIntLE(7, 3) + 1];
			sized = true;
		} else if (type === "VP8 " && !sized) {
			const d = bytes.read(body, 10);
			[out.width, out.height] = [d.readUInt16LE(6) & 0x3fff, d.readUInt16LE(8) & 0x3fff];
			sized = true;
		} else if (type === "VP8L" && !sized) {
			const bits = bytes.read(body + 1, 4).readUInt32LE(0);
			[out.width, out.height] = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
			sized = true;
		} else if (type === "ICCP") {
			out.icc = Buffer.from(bytes.read(body, length));
		}
		// A WebP's EXIF orientation isn't read: 0.7's decoder didn't, and its sizes and names
		// are of the image as it's stored.
		at = body + length + (length & 1);
	}
	if (!sized) throw new Error("no image data in the WebP file");
	return out;
}

/** The orientation (tag 0x0112) in an EXIF block's first IFD, or 1. */
export function exifOrientation(exif: Buffer): number {
	try {
		const data = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? exif.subarray(6) : exif;
		const order = data.subarray(0, 2).toString("latin1");
		if (order !== "II" && order !== "MM") return 1;
		const le = order === "II";
		const u16 = (at: number) => (le ? data.readUInt16LE(at) : data.readUInt16BE(at));
		const u32 = (at: number) => (le ? data.readUInt32LE(at) : data.readUInt32BE(at));
		if (u16(2) !== 42) return 1;
		const ifd = u32(4);
		const count = u16(ifd);
		for (let i = 0; i < count; i++) {
			const entry = ifd + 2 + i * 12;
			if (u16(entry) === 0x0112) {
				const value = u16(entry + 8);
				return value >= 1 && value <= 8 ? value : 1;
			}
		}
	} catch { /* a short or broken block says nothing */ }
	return 1;
}

/**
 * The width and height in an image file's header, as `files(pattern, { dimensions: true })` gives
 * them (the `imagesize` crate's reading: no orientation): PNG, JPEG, GIF, TIFF, WebP, HEIF and
 * AVIF, BMP, PSD, ICO and QOI. `undefined` for anything else, or a file that ends too soon.
 */
export function imageSize(file: string): [number, number] | undefined {
	try {
		return withBytes(file, (bytes) => {
			const head = bytes.read(0, 12);
			const text = (at: number, s: string) => head.subarray(at, at + s.length).toString("latin1") === s;
			if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return jpegSize(bytes);
			if (text(0, "\x89PNG")) return [bytes.read(16, 4).readUInt32BE(0), bytes.read(20, 4).readUInt32BE(0)];
			if (text(0, "GIF8")) return [bytes.read(6, 2).readUInt16LE(0), bytes.read(8, 2).readUInt16LE(0)];
			if ((text(0, "II") && (head[2] === 0x2a || head[2] === 0x2b) && head[3] === 0) || (text(0, "MM\x00") && (head[3] === 0x2a || head[3] === 0x2b))) return tiffSize(bytes);
			if (text(0, "RIFF") && text(8, "WEBP")) return webpSize(bytes);
			if (text(4, "ftyp")) return heifSize(bytes);
			if (text(0, "BM")) return [bytes.read(0x12, 4).readUInt32LE(0), bytes.read(0x16, 4).readUInt32LE(0)];
			if (text(0, "8BPS")) return [bytes.read(0x12, 4).readUInt32BE(0), bytes.read(0x0e, 4).readUInt32BE(0)];
			if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return icoSize(bytes);
			if (text(0, "qoif")) return [bytes.read(4, 4).readUInt32BE(0), bytes.read(8, 4).readUInt32BE(0)];
			return undefined;
		});
	} catch {
		return undefined;
	}
}

function jpegSize(bytes: FileBytes): [number, number] {
	let at = 2;
	let depth = 0;
	for (;;) {
		const marker = bytes.read(at, 2);
		if (marker[0] !== 0xff) throw new Error("corrupted");
		const page = marker[1];
		if ((page >= 0xc0 && page <= 0xc3) || (page >= 0xc5 && page <= 0xc7) || (page >= 0xc9 && page <= 0xcb) || (page >= 0xcd && page <= 0xcf)) {
			if (depth === 0) {
				const sof = bytes.read(at + 5, 4);
				return [sof.readUInt16BE(2), sof.readUInt16BE(0)];
			}
		} else if (page === 0xd8) depth++;
		else if (page === 0xd9) {
			depth--;
			if (depth < 0) throw new Error("corrupted");
		}
		at += 2 + bytes.read(at + 2, 2).readUInt16BE(0);
	}
}

function webpSize(bytes: FileBytes): [number, number] {
	const tag = bytes.read(12, 4)[3];
	if (tag === 0x20) return [bytes.read(0x1a, 2).readUInt16LE(0), bytes.read(0x1c, 2).readUInt16LE(0)];
	if (tag === 0x4c) {
		const dims = bytes.read(0x15, 4).readUInt32LE(0);
		return [(dims & 0x3fff) + 1, ((dims >>> 14) & 0x3fff) + 1];
	}
	if (tag === 0x58) return [bytes.read(0x18, 3).readUIntLE(0, 3) + 1, bytes.read(0x1b, 3).readUIntLE(0, 3) + 1];
	throw new Error("invalid VP8 tag");
}

function tiffSize(bytes: FileBytes): [number, number] {
	const le = bytes.read(0, 2).toString("latin1") === "II";
	const u16 = (at: number) => (le ? bytes.read(at, 2).readUInt16LE(0) : bytes.read(at, 2).readUInt16BE(0));
	const u32 = (at: number) => (le ? bytes.read(at, 4).readUInt32LE(0) : bytes.read(at, 4).readUInt32BE(0));
	const u64 = (at: number) => Number(le ? bytes.read(at, 8).readBigUInt64LE(0) : bytes.read(at, 8).readBigUInt64BE(0));
	const big = u16(2) === 43;
	let at = 4;
	if (big) {
		if (u16(4) !== 8 || u16(6) !== 0) throw new Error("invalid BigTIFF header");
		at = 8;
	}
	const ifd = big ? u64(at) : u32(at);
	if (ifd === 0) throw new Error("invalid IFD offset");
	const count = big ? u64(ifd) : u16(ifd);
	let entry = ifd + (big ? 8 : 2);
	let width: number | undefined;
	let height: number | undefined;
	for (let i = 0; i < count; i++) {
		const tag = u16(entry);
		const kind = u16(entry + 2);
		const valueAt = entry + (big ? 12 : 8);
		const size = [1, 2, 6, 7].includes(kind) ? 1 : kind === 3 || kind === 8 ? 2 : [4, 9, 11, 13].includes(kind) ? 4 : kind === 5 || kind === 10 ? 8 : kind === 12 ? 8 : kind >= 16 && kind <= 18 && big ? 8 : -1;
		if (size === -1) throw new Error("invalid IFD type");
		bytes.read(valueAt, big ? 8 : 4);
		const value = size === 2 ? u16(valueAt) : size === 4 ? u32(valueAt) : undefined;
		if (tag === 0x100) width = value;
		else if (tag === 0x101) height = value;
		if (width !== undefined && height !== undefined) return [width, height];
		entry = valueAt + (big ? 8 : 4);
	}
	throw new Error("no dimensions in the IFD's tags");
}

function icoSize(bytes: FileBytes): [number, number] {
	const count = bytes.read(4, 2).readUInt16LE(0);
	let best: [number, number] | undefined;
	let at = 6;
	for (let i = 0; i < count; i++) {
		let entry: Buffer;
		try { entry = bytes.read(at, 2); } catch { break; }
		// 0 means 256.
		const size: [number, number] = [((entry[0] + 255) & 255) + 1, ((entry[1] + 255) & 255) + 1];
		if (!best || size[0] > best[0] || (size[0] === best[0] && size[1] > best[1])) best = size;
		at += 16;
	}
	if (!best) throw new Error("corrupted");
	return best;
}

function heifSize(bytes: FileBytes): [number, number] {
	// The box after `ftyp`, then `meta` (with a version after its header), `iprp`, `ipco`, and the
	// largest `ispe` there, turned by an `irot` of a quarter or three.
	let at = bytes.read(0, 4).readUInt32BE(0);
	const skipTo = (tag: string): number => {
		for (;;) {
			const head = bytes.read(at, 8);
			const size = head.readUInt32BE(0);
			at += 8;
			if (head.subarray(4, 8).toString("latin1") === tag) return size;
			if (size < 8) throw new Error(`invalid heif box size: ${size}`);
			at += size - 8;
		}
	};
	skipTo("meta");
	at += 4;
	skipTo("iprp");
	let ipco = skipTo("ipco");
	let [width, height] = [0, 0];
	let found = false;
	let rotation = 0;
	for (;;) {
		let head: Buffer;
		try { head = bytes.read(at, 8); } catch { break; }
		const size = head.readUInt32BE(0);
		const tag = head.subarray(4, 8).toString("latin1");
		at += 8;
		if (size < 8) {
			if (tag === "mdat") break;
			throw new Error("corrupted");
		}
		if (tag === "ispe") {
			found = true;
			const box = bytes.read(at, 12);
			at += 12;
			const [w, h] = [box.readUInt32BE(4), box.readUInt32BE(8)];
			if (w * h > width * height) [width, height] = [w, h];
		} else if (tag === "irot") {
			rotation = bytes.read(at, 1)[0];
			at += 1;
		} else if (size >= ipco) {
			break;
		} else {
			ipco -= size;
			at += size - 8;
		}
	}
	if (!found) throw new Error("not enough data");
	return rotation === 1 || rotation === 3 ? [height, width] : [width, height];
}
