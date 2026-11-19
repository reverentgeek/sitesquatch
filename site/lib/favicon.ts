// The tab icon (src/favicon.svg): the header's patch as an SVG of its own, the illustrated
// footprint (docs/assets/footprint.svg) in map paper on a pine circle. A tab icon can't mask with
// another file the way the header's CSS does, so the drawing's paths go into the icon, placed as
// the patch places them (`.patch::before` in src/assets/site.css: a box 58% wide and 72% tall,
// the drawing contained in it, turned 8 degrees). tests/favicon.test.ts checks the committed
// icon is what this makes, so after editing the drawing, run `node lib/favicon.ts` from site/.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FAVICON = path.join(SITE, "src", "favicon.svg");
const DRAWING = path.join(SITE, "..", "docs", "assets", "footprint.svg");

const SIZE = 200;
const BOX = { width: 0.58, height: 0.72 };
const TURN = 8;
const PINE = "#233b2b";
const PAPER = "#fff3d6";

/** The icon's SVG, from the drawing. */
export function favicon(): string {
	const drawing = readFileSync(DRAWING, "utf8");
	const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(drawing) ?? [];
	const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(drawing)?.[1];
	if (!w || !body) throw new Error(`${path.relative(SITE, DRAWING)}: no viewBox or no drawing in it`);
	const scale = Math.min((SIZE * BOX.width) / Number(w), (SIZE * BOX.height) / Number(h));
	const c = SIZE / 2;
	const round = (n: number) => Number(n.toFixed(4));
	const paths = body.replace(/\s*\n\s*/g, "").replace(/ style="fill-rule:nonzero;"/g, "").replace(/ id="[^"]*"/g, "");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}"><circle cx="${c}" cy="${c}" r="${c}" fill="${PINE}"/><g fill="${PAPER}" transform="rotate(${TURN} ${c} ${c}) translate(${c} ${c}) scale(${round(scale)}) translate(${round(-Number(w) / 2)} ${round(-Number(h) / 2)})">${paths}</g></svg>\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	writeFileSync(FAVICON, favicon());
	console.log(`Wrote ${path.relative(process.cwd(), FAVICON)}`);
}
