// BLAKE3, the hash 0.7 named generated files by: an image's derivatives (`hGyF3aNj8J-600.webp`)
// and a fingerprinted asset (`index.9106c1a5.css`). Node's crypto has no BLAKE3, and the names
// have to stay what 0.7 gave them, so an upgraded site keeps its image cache and its URLs.
//
// The unkeyed hash with a 32-byte output, from the reference implementation
// (github.com/BLAKE3-team/BLAKE3, reference_impl.rs), written for V8: the state and the message
// are local variables, so a block's seven rounds run without touching memory.
import os from "node:os";

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;
const BLOCK_LEN = 64;
const CHUNK_LEN = 1024;
const LITTLE_ENDIAN = os.endianness() === "LE";

/**
 * Compresses one block: `m` holds its 16 words from `mo`, `cv` the chaining value from `co`.
 * The first 8 words of the result (the next chaining value, or the root hash) go to `out` at `oo`.
 */
function compress(cv: Uint32Array, co: number, m: Uint32Array, mo: number, counter: number, blockLen: number, flags: number, out: Uint32Array, oo: number): void {
	let m0 = m[mo] | 0, m1 = m[mo + 1] | 0, m2 = m[mo + 2] | 0, m3 = m[mo + 3] | 0, m4 = m[mo + 4] | 0, m5 = m[mo + 5] | 0, m6 = m[mo + 6] | 0, m7 = m[mo + 7] | 0;
	let m8 = m[mo + 8] | 0, m9 = m[mo + 9] | 0, m10 = m[mo + 10] | 0, m11 = m[mo + 11] | 0, m12 = m[mo + 12] | 0, m13 = m[mo + 13] | 0, m14 = m[mo + 14] | 0, m15 = m[mo + 15] | 0;
	let s0 = cv[co] | 0, s1 = cv[co + 1] | 0, s2 = cv[co + 2] | 0, s3 = cv[co + 3] | 0, s4 = cv[co + 4] | 0, s5 = cv[co + 5] | 0, s6 = cv[co + 6] | 0, s7 = cv[co + 7] | 0;
	let s8 = IV[0] | 0, s9 = IV[1] | 0, s10 = IV[2] | 0, s11 = IV[3] | 0;
	// The counter is a chunk's index, below 2^53 for any file Node can read.
	let s12 = counter | 0, s13 = Math.floor(counter / 0x100000000) | 0, s14 = blockLen | 0, s15 = flags | 0;
	let t = 0;
	for (let round = 0; round < 7; round++) {
		// The columns.
		s0 = (s0 + s4 + m0) | 0; t = s12 ^ s0; s12 = (t >>> 16) | (t << 16); s8 = (s8 + s12) | 0; t = s4 ^ s8; s4 = (t >>> 12) | (t << 20);
		s0 = (s0 + s4 + m1) | 0; t = s12 ^ s0; s12 = (t >>> 8) | (t << 24); s8 = (s8 + s12) | 0; t = s4 ^ s8; s4 = (t >>> 7) | (t << 25);
		s1 = (s1 + s5 + m2) | 0; t = s13 ^ s1; s13 = (t >>> 16) | (t << 16); s9 = (s9 + s13) | 0; t = s5 ^ s9; s5 = (t >>> 12) | (t << 20);
		s1 = (s1 + s5 + m3) | 0; t = s13 ^ s1; s13 = (t >>> 8) | (t << 24); s9 = (s9 + s13) | 0; t = s5 ^ s9; s5 = (t >>> 7) | (t << 25);
		s2 = (s2 + s6 + m4) | 0; t = s14 ^ s2; s14 = (t >>> 16) | (t << 16); s10 = (s10 + s14) | 0; t = s6 ^ s10; s6 = (t >>> 12) | (t << 20);
		s2 = (s2 + s6 + m5) | 0; t = s14 ^ s2; s14 = (t >>> 8) | (t << 24); s10 = (s10 + s14) | 0; t = s6 ^ s10; s6 = (t >>> 7) | (t << 25);
		s3 = (s3 + s7 + m6) | 0; t = s15 ^ s3; s15 = (t >>> 16) | (t << 16); s11 = (s11 + s15) | 0; t = s7 ^ s11; s7 = (t >>> 12) | (t << 20);
		s3 = (s3 + s7 + m7) | 0; t = s15 ^ s3; s15 = (t >>> 8) | (t << 24); s11 = (s11 + s15) | 0; t = s7 ^ s11; s7 = (t >>> 7) | (t << 25);
		// The diagonals.
		s0 = (s0 + s5 + m8) | 0; t = s15 ^ s0; s15 = (t >>> 16) | (t << 16); s10 = (s10 + s15) | 0; t = s5 ^ s10; s5 = (t >>> 12) | (t << 20);
		s0 = (s0 + s5 + m9) | 0; t = s15 ^ s0; s15 = (t >>> 8) | (t << 24); s10 = (s10 + s15) | 0; t = s5 ^ s10; s5 = (t >>> 7) | (t << 25);
		s1 = (s1 + s6 + m10) | 0; t = s12 ^ s1; s12 = (t >>> 16) | (t << 16); s11 = (s11 + s12) | 0; t = s6 ^ s11; s6 = (t >>> 12) | (t << 20);
		s1 = (s1 + s6 + m11) | 0; t = s12 ^ s1; s12 = (t >>> 8) | (t << 24); s11 = (s11 + s12) | 0; t = s6 ^ s11; s6 = (t >>> 7) | (t << 25);
		s2 = (s2 + s7 + m12) | 0; t = s13 ^ s2; s13 = (t >>> 16) | (t << 16); s8 = (s8 + s13) | 0; t = s7 ^ s8; s7 = (t >>> 12) | (t << 20);
		s2 = (s2 + s7 + m13) | 0; t = s13 ^ s2; s13 = (t >>> 8) | (t << 24); s8 = (s8 + s13) | 0; t = s7 ^ s8; s7 = (t >>> 7) | (t << 25);
		s3 = (s3 + s4 + m14) | 0; t = s14 ^ s3; s14 = (t >>> 16) | (t << 16); s9 = (s9 + s14) | 0; t = s4 ^ s9; s4 = (t >>> 12) | (t << 20);
		s3 = (s3 + s4 + m15) | 0; t = s14 ^ s3; s14 = (t >>> 8) | (t << 24); s9 = (s9 + s14) | 0; t = s4 ^ s9; s4 = (t >>> 7) | (t << 25);
		// The message permutation, between rounds: 2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8.
		const p0 = m0, p1 = m1, p4 = m4, p5 = m5, p8 = m8;
		m0 = m2; m1 = m6; m2 = m3; m3 = m10; m4 = m7; m5 = p0; m6 = p4; m7 = m13;
		m8 = p1; m10 = m12; m12 = m9; m9 = m11; m11 = p5; m13 = m14; m14 = m15; m15 = p8;
	}
	out[oo] = s0 ^ s8; out[oo + 1] = s1 ^ s9; out[oo + 2] = s2 ^ s10; out[oo + 3] = s3 ^ s11;
	out[oo + 4] = s4 ^ s12; out[oo + 5] = s5 ^ s13; out[oo + 6] = s6 ^ s14; out[oo + 7] = s7 ^ s15;
}

/** The input as little-endian words: a view when the bytes allow one, otherwise a copy. */
function words(input: Uint8Array): Uint32Array {
	const whole = input.length & ~3;
	if (LITTLE_ENDIAN && (input.byteOffset & 3) === 0) return new Uint32Array(input.buffer, input.byteOffset, whole >>> 2);
	const out = new Uint32Array(whole >>> 2);
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
	return out;
}

/** BLAKE3 of `input`: 32 bytes. */
export function blake3(input: Uint8Array): Uint8Array {
	const w = words(input);
	const iv = Uint32Array.from(IV);
	const block = new Uint32Array(16);
	const blockBytes = new Uint8Array(block.buffer);
	// A stack of the chaining values of finished subtrees (at most one per level), and a parent's block.
	const stack = new Uint32Array(8 * 54);
	let depth = 0;
	const parent = new Uint32Array(16);
	const cv = new Uint32Array(8);
	const chunks = Math.max(1, Math.ceil(input.length / CHUNK_LEN));

	// Every chunk but the last is whole, and its chaining value goes on the stack.
	for (let chunk = 0; chunk < chunks - 1; chunk++) {
		cv.set(iv);
		const start = chunk * (CHUNK_LEN / 4);
		for (let b = 0; b < 16; b++) {
			const flags = (b === 0 ? CHUNK_START : 0) | (b === 15 ? CHUNK_END : 0);
			compress(cv, 0, w, start + b * 16, chunk, BLOCK_LEN, flags, cv, 0);
		}
		// Merge with the subtrees this chunk completes: one per trailing zero of the chunk count.
		let total = chunk + 1;
		while ((total & 1) === 0) {
			depth--;
			parent.set(stack.subarray(depth * 8, depth * 8 + 8), 0);
			parent.set(cv, 8);
			compress(iv, 0, parent, 0, 0, BLOCK_LEN, PARENT, cv, 0);
			total >>>= 1;
		}
		stack.set(cv, depth * 8);
		depth++;
	}

	// The last chunk: its blocks but the last, then the last as an output that may be the root.
	const last = chunks - 1;
	const begin = last * CHUNK_LEN;
	const length = input.length - begin;
	const blocks = Math.max(1, Math.ceil(length / BLOCK_LEN));
	cv.set(iv);
	for (let b = 0; b < blocks - 1; b++) {
		compress(cv, 0, w, (begin >>> 2) + b * 16, last, BLOCK_LEN, b === 0 ? CHUNK_START : 0, cv, 0);
	}
	const tail = begin + (blocks - 1) * BLOCK_LEN;
	const tailLength = input.length - tail;
	block.fill(0);
	blockBytes.set(input.subarray(tail, input.length));
	if (!LITTLE_ENDIAN) for (let i = 0; i < 16; i++) block[i] = new DataView(blockBytes.buffer).getUint32(i * 4, true);
	let flags = CHUNK_END | (blocks === 1 ? CHUNK_START : 0);
	let outCv: Uint32Array = cv;
	let outBlock: Uint32Array = block;
	let counter = last;
	let blockLen = tailLength;
	// Fold the stack into the output, right to left; the last fold is the root.
	const out = new Uint32Array(8);
	while (depth > 0) {
		compress(outCv, 0, outBlock, 0, counter, blockLen, flags, out, 0);
		depth--;
		parent.set(stack.subarray(depth * 8, depth * 8 + 8), 0);
		parent.set(out, 8);
		outCv = iv;
		outBlock = parent;
		counter = 0;
		blockLen = BLOCK_LEN;
		flags = PARENT;
	}
	compress(outCv, 0, outBlock, 0, counter, blockLen, flags | ROOT, out, 0);
	const bytes = new Uint8Array(32);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < 8; i++) view.setUint32(i * 4, out[i], true);
	return bytes;
}

/** BLAKE3 of `input`, in lowercase hex. */
export function blake3Hex(input: Uint8Array): string {
	return Buffer.from(blake3(input)).toString("hex");
}
