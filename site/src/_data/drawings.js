// The drawings' sizes, from their viewBoxes, so an <img> gets a width and height that hold its
// space while it loads (and nobody types an aspect ratio by hand). Keys are paths below
// docs/assets/: "sitesquatch-head-shoulders" and "stickers/owl".
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../../../docs/assets/", import.meta.url);

function size(path) {
	const svg = readFileSync(new URL(`${path}.svg`, root), "utf8");
	const box = /viewBox="([^"]+)"/.exec(svg);
	if (!box) throw new Error(`docs/assets/${path}.svg: no viewBox to size it by`);
	const [, , width, height] = box[1].trim().split(/[\s,]+/).map(Number);
	return { width, height };
}

const drawings = { "sitesquatch-head-shoulders": size("sitesquatch-head-shoulders"), footprint: size("footprint") };
for (const name of readdirSync(new URL("stickers/", root)).sort()) {
	if (name.endsWith(".svg")) drawings[`stickers/${name.slice(0, -4)}`] = size(`stickers/${name.slice(0, -4)}`);
}

export default drawings;
