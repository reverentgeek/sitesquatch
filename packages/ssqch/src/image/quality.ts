// imagePlugin()'s quality numbers are 0.7's, and sharp's encoders read numbers differently: 0.7's
// AVIF 60 looks like sharp's 48, its JPEG 80 like sharp's 89 (with mozjpeg). So a site's numbers
// (and the defaults) are turned into sharp's here, from measurements, and a site keeps the files
// it had: as good, and no bigger. Its names don't change either (the settings in an image's id
// are the site's numbers), so its image cache carries over.
//
// The tables pair 0.7's number with sharp's at the same mean SSIMULACRA2, measured on 36 of the
// blog's photos and screenshots (20 in Display P3) at 300, 900 and 1,500 pixels: 108 files a
// format, each scored against its own encoder's lossless resize, so the scores compare encoders.
// Between rows, sharp's number is read off the line between them. At equal quality, against 0.7:
//
//   AVIF  speed 8 (the default) as effort 2: 22 to 27% smaller up to quality 80, in 40% of
//         0.7's time; speed 4 (the blog's) as effort 3: 11 to 19% smaller up to quality 70, as
//         big at 80, in a third of the time or less. Above 90, sharp's files are the bigger.
//   WebP  the same numbers (sharp's libwebp reads them as 0.7's did): 1% smaller
//   JPEG  mozjpeg: 10% smaller at 0.7's 80, 25% at 50; a tenth of 0.7's time
//
// A higher effort makes smaller files still (a third smaller at effort 4) and takes three times
// as long, which a first build of the blog's 4,985 files would feel. From about 0.7's JPEG 92
// and AVIF 98 up, sharp's best (its 100) doesn't reach 0.7's score, so that's what they are:
// the tables' last rows. Between 0.7's JPEG 90 (sharp's 97) and 92, and AVIF 95 (96) and 98,
// sharp's number climbs to 100 along the line.
//
// PNG is lossless, so there's no number to turn: 0.7's encoder chose a filter for each row
// (adaptive) and compressed at zlib's level 6, and so does sharp here. On a quarter of the
// blog's PNGs at five widths (563 files), every file is then within 3% of 0.7's size, and
// they're 13% smaller in all. Without the filters (sharp's default) they're 18% smaller in all,
// but its pictures from an iPhone come out up to a fifth bigger than 0.7's, so it isn't
// what 0.7 made; the filters cost a cold build of the blog about a tenth more CPU time. A grey
// PNG stays grey and a 16-bit one 16 bits, as 0.7 wrote them, where sharp would make them 8-bit
// RGB (`encodeFrom` in `processor.ts`): that, not the filters, was why grey ones doubled.
import type { ImageOptions } from "./processor.ts";

type Table = ReadonlyArray<readonly [number, number]>;

/** WebP: 0.7's libwebp quality is sharp's (libwebp too). */
export const WEBP: Table = [[0, 0], [100, 100]];
/** JPEG: 0.7's (the `image` crate's encoder) to sharp's (mozjpeg). */
export const JPEG: Table = [[50, 66], [60, 72], [70, 80], [80, 89], [90, 97], [92, 100]];
/** AVIF: 0.7's (rav1e) quality to sharp's (libaom), the same within a point for speed 8 at effort 2 and speed 4 at effort 3. */
export const AVIF: Table = [[30, 28], [40, 34], [50, 41], [60, 48], [70, 55], [80, 61], [90, 86], [95, 96], [98, 100]];
/** 0.7's AVIF speed (1, slowest, to 10) as sharp's effort (9, slowest, to 0): faster than 0.7, and smaller. */
export const EFFORT: Table = [[1, 5], [4, 3], [8, 2], [10, 0]];

/** `x` read off `table`, past its ends along its first and last lines. */
export function lookup(table: Table, x: number): number {
	let i = 1;
	while (i < table.length - 1 && x > table[i][0]) i++;
	const [[x0, y0], [x1, y1]] = [table[i - 1], table[i]];
	return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

const quality = (table: Table, x: number) => Math.min(100, Math.max(1, Math.round(lookup(table, x))));

export interface EncodeSettings {
	jpeg: { quality: number; mozjpeg: boolean };
	png: { adaptiveFiltering: boolean; compressionLevel: number };
	webp: { quality: number };
	avif: { quality: number; effort: number };
}

/** sharp's settings for a plugin's options. */
export function encodeSettings(o: Pick<ImageOptions, "webpQuality" | "avifQuality" | "avifSpeed" | "jpegQuality">): EncodeSettings {
	return {
		jpeg: { quality: quality(JPEG, o.jpegQuality), mozjpeg: true },
		png: { adaptiveFiltering: true, compressionLevel: 6 },
		webp: { quality: quality(WEBP, o.webpQuality) },
		avif: { quality: quality(AVIF, o.avifQuality), effort: Math.min(9, Math.max(0, Math.round(lookup(EFFORT, o.avifSpeed)))) },
	};
}
