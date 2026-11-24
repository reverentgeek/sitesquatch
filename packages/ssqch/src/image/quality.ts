// imagePlugin()'s quality options are sharp's own numbers (decided 2026-11-18): `avifQuality: 48`
// is what sharp's `avif({ quality: 48 })` makes. The defaults are the numbers that encode as 0.7's
// defaults did: 0.7's encoders read numbers differently (its AVIF 50 looks like sharp's 41, its
// JPEG 80 like sharp's 89 with mozjpeg), so a site that sets nothing gets the pictures it had.
//
// The tables pair 0.7's number with sharp's at the same mean SSIMULACRA2, measured on 36 of the
// blog's photos and screenshots (20 in Display P3) at 300, 900 and 1,500 pixels: 108 files a
// format, each scored against its own encoder's lossless resize, so the scores compare encoders.
// Between rows, sharp's number is read off the line between them. At equal quality, against 0.7:
//
//   AVIF  0.7's speed 8 (its default) is effort 2: 22 to 27% smaller up to quality 80, in 40% of
//         0.7's time; speed 4 (the blog's) is effort 3: 11 to 19% smaller up to quality 70, as
//         big at 80, in a third of the time or less. Above 90, sharp's files are the bigger.
//   WebP  the same numbers (sharp's libwebp reads them as 0.7's did): 1% smaller
//   JPEG  mozjpeg: 10% smaller at 0.7's 80, 25% at 50; a tenth of 0.7's time
//
// A higher effort makes smaller files still (a third smaller at effort 4) and takes three times
// as long, which a first build of the blog's 4,985 files would feel. From about 0.7's JPEG 92
// and AVIF 98 up, sharp's best (its 100) doesn't reach 0.7's score.
//
// The tables do two more jobs now: the changelog's conversion for a site moving from 0.7, and
// the image names. A file's name has the settings in it, written as 0.7 wrote them (`75|50|8|80`),
// so the same settings in sharp's numbers (`75|41|2|89`) are written as the 0.7 numbers they came
// from (`legacySettings`), and a site that converts its numbers keeps its names and its cache.
//
// PNG is lossless, so there's no number to turn. 0.7's encoder chose a filter for each row
// (adaptive); sharp here doesn't (its default, decided 2026-11-18), at zlib's level 6 as 0.7. On
// a quarter of the blog's PNGs at five widths (563 files) that's 18% smaller in all than 0.7's,
// and a tenth less CPU time for a cold build, though some photos from an iPhone come out up to a
// fifth bigger. A PNG's name doesn't change with it (the names never said which encoder made a
// file), so a cache made with the filters is kept. A grey PNG stays grey and a 16-bit one 16
// bits, as 0.7 wrote them, where sharp would make them 8-bit RGB (`encodeFrom` in `processor.ts`).
import type { ImageOptions } from "./processor.ts";

type Table = ReadonlyArray<readonly [number, number]>;

/** WebP: 0.7's libwebp quality is sharp's (libwebp too). */
export const WEBP: Table = [[0, 0], [100, 100]];
/** JPEG: 0.7's (the `image` crate's encoder) to sharp's (mozjpeg). */
export const JPEG: Table = [[50, 66], [60, 72], [70, 80], [80, 89], [90, 97], [92, 100]];
/** AVIF: 0.7's (rav1e) quality to sharp's (libaom), the same within a point for speed 8 at effort 2 and speed 4 at effort 3. */
export const AVIF: Table = [[30, 28], [40, 34], [50, 41], [60, 48], [70, 55], [80, 61], [90, 86], [95, 96], [98, 100]];
/** 0.7's AVIF speed (1, slowest, to 10) as sharp's effort (9, slowest, to 0). */
export const EFFORT: Table = [[1, 5], [4, 3], [8, 2], [10, 0]];

/** `x` read off `table`, past its ends along its first and last lines. */
export function lookup(table: Table, x: number): number {
	let i = 1;
	while (i < table.length - 1 && x > table[i][0]) i++;
	const [[x0, y0], [x1, y1]] = [table[i - 1], table[i]];
	return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/** sharp's quality for 0.7's `x`. */
export const fromLegacy = (table: Table, x: number): number => Math.min(100, Math.max(1, Math.round(lookup(table, x))));
/** sharp's AVIF effort for 0.7's speed. */
export const effortFromSpeed = (speed: number): number => Math.min(9, Math.max(0, Math.round(lookup(EFFORT, speed))));

/** The defaults: 0.7's (WebP 75, AVIF 50 at speed 8, JPEG 80) in sharp's numbers. */
export const DEFAULTS = { webpQuality: fromLegacy(WEBP, 75), avifQuality: fromLegacy(AVIF, 50), avifEffort: effortFromSpeed(8), jpegQuality: fromLegacy(JPEG, 80) } as const;

/**
 * The 0.7 number that becomes sharp's `value` (`convert`), from `low` to `high`: the roundest, as
 * sites chose round numbers (a multiple of 10, then of 5), then the nearest, then the smallest.
 * `undefined` when none does.
 */
function legacyOf(value: number, low: number, high: number, convert: (x: number) => number, exact: (x: number) => number, round: boolean): number | undefined {
	let best: { v: number; rank: number; off: number } | undefined;
	for (let v = low; v <= high; v++) {
		if (convert(v) !== value) continue;
		const rank = round ? (v % 10 === 0 ? 0 : v % 5 === 0 ? 1 : 2) : 0;
		const off = Math.abs(exact(v) - value);
		if (!best || rank < best.rank || (rank === best.rank && off < best.off)) best = { v, rank, off };
	}
	return best?.v;
}

/**
 * The settings as an image's name holds them: each as the 0.7 number that converts to it, so a
 * site that converted its numbers keeps 0.7's names, or `s<n>` (sharp's) for one no 0.7 number
 * converts to, which can't be mistaken for one that does.
 */
export function legacySettings(o: Pick<ImageOptions, "webpQuality" | "avifQuality" | "avifEffort" | "jpegQuality">): string {
	const name = (n: number | undefined, value: number) => (n === undefined ? `s${value}` : String(n));
	const quality = (table: Table, value: number) => name(legacyOf(value, 1, 100, (x) => fromLegacy(table, x), (x) => lookup(table, x), true), value);
	const speed = name(legacyOf(o.avifEffort, 1, 10, effortFromSpeed, (x) => lookup(EFFORT, x), false), o.avifEffort);
	return `${quality(WEBP, o.webpQuality)}|${quality(AVIF, o.avifQuality)}|${speed}|${quality(JPEG, o.jpegQuality)}`;
}

/**
 * One format's part of `legacySettings`, which its copies' names hash: changing `jpegQuality`
 * renames the JPEG copies and leaves the AVIF and WebP ones as they were (the owner, 2026-11-24,
 * after the Squatch Snacks rerun, where it renamed them all and browsers fetched them again).
 * PNG, GIF and SVG have no settings of their own.
 */
export function formatSettings(o: Pick<ImageOptions, "webpQuality" | "avifQuality" | "avifEffort" | "jpegQuality">, format: string): string {
	const [webp, avif, speed, jpeg] = legacySettings(o).split("|");
	if (format === "webp") return `webp|${webp}`;
	if (format === "avif") return `avif|${avif}|${speed}`;
	if (format === "jpeg") return `jpeg|${jpeg}`;
	return format;
}

export interface EncodeSettings {
	jpeg: { quality: number; mozjpeg: boolean };
	png: { adaptiveFiltering: boolean; compressionLevel: number };
	webp: { quality: number };
	avif: { quality: number; effort: number };
}

/** sharp's settings for a plugin's options: its numbers, as they are. */
export function encodeSettings(o: Pick<ImageOptions, "webpQuality" | "avifQuality" | "avifEffort" | "jpegQuality">): EncodeSettings {
	return {
		jpeg: { quality: o.jpegQuality, mozjpeg: true },
		png: { adaptiveFiltering: false, compressionLevel: 6 },
		webp: { quality: o.webpQuality },
		avif: { quality: o.avifQuality, effort: o.avifEffort },
	};
}
