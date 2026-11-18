#!/usr/bin/env node
// Writes a sticker of each drawing in docs/assets/: the drawing on a white shape that follows its
// outline, insides filled, with a white border around it, so the same file reads on a light page
// and a dark one (black line art on a transparent background disappears on a dark one).
//
//   node scripts/stickers.mjs [--border 8] [--at 160] [drawing.svg ...]
//
// The border is `--border` pixels when the sticker's longer side is shown `--at` pixels wide (8 at
// 160 by default: 5% of the longer side), so every sticker has the same border at the same size,
// whatever the drawing's own units. Stickers go to docs/assets/stickers/, with the drawing's name.
//
// How: the drawing is drawn at about 2,000 pixels with sharp (ssqch's own dependency), the inside
// of its outline is filled (whatever a flood from the edges can't reach), the shape is grown by
// the border (an exact distance, so corners round off), and its edge is traced back into a path
// (marching squares, simplified). The drawing itself goes on top, as it was.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(path.join(ROOT, "packages/ssqch/package.json"))("sharp");
const ASSETS = path.join(ROOT, "docs/assets");
const OUT = path.join(ASSETS, "stickers");

const { values, positionals } = parseArgs({ options: { border: { type: "string", default: "8" }, at: { type: "string", default: "160" } }, allowPositionals: true });
const ratio = Number(values.border) / Number(values.at);
if (!(ratio > 0 && ratio < 0.5)) throw new Error(`stickers: --border ${values.border} at --at ${values.at} isn't a border`);

/** The raster's longer side: enough that the traced edge is smooth at any size it's shown. */
const RASTER = 2000;

/** Drawings whose outline is open (the mountain has no line along its foot): their sticker is the convex hull of the drawing, so the inside is filled too. */
const HULL = new Set(["mountain"]);

const files = positionals.length ? positionals.map((f) => path.resolve(f)) : fs.readdirSync(ASSETS).filter((f) => f.endsWith(".svg")).sort().map((f) => path.join(ASSETS, f));
fs.mkdirSync(OUT, { recursive: true });
for (const file of files) {
	const svg = fs.readFileSync(file, "utf8");
	const sticker = await stickerOf(svg, path.basename(file));
	fs.writeFileSync(path.join(OUT, path.basename(file)), sticker);
	console.log(`${path.relative(ROOT, path.join(OUT, path.basename(file)))} (${(sticker.length / 1024).toFixed(1)} KB)`);
}

async function stickerOf(svg, name) {
	const vb = /viewBox="([-\d.\s]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number);
	if (!vb || vb.length !== 4) throw new Error(`stickers: ${name} has no viewBox`);
	const [vx, vy, vw, vh] = vb;
	const border = Math.max(vw, vh) * ratio; // in the drawing's units
	// The canvas the sticker needs: the drawing, the border, and a little room for the trace.
	const pad = border * 1.25;
	const scale = RASTER / (Math.max(vw, vh) + 2 * pad);
	const W = Math.ceil((vw + 2 * pad) * scale), H = Math.ceil((vh + 2 * pad) * scale);
	// The drawing, rendered alone (its own viewBox) at the scale, then placed on the padded canvas.
	// sharp draws an SVG at its `width` (or its viewBox's, for a `width="100%"`) times density/72.
	const declared = Number(/<svg\b[^>]*?\swidth="([\d.]+)"/.exec(svg)?.[1]) || vw;
	const drawn = await sharp(Buffer.from(svg), { density: 72 * scale * (vw / declared) })
		.resize(Math.round(vw * scale), Math.round(vh * scale), { fit: "fill" })
		.ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
	const ox = Math.round(pad * scale), oy = Math.round(pad * scale);
	const ink = new Uint8Array(W * H);
	for (let y = 0; y < drawn.info.height; y++) for (let x = 0; x < drawn.info.width; x++) {
		if (drawn.data[y * drawn.info.width + x] > 24) ink[(y + oy) * W + (x + ox)] = 1;
	}
	const inside = fillInside(ink, W, H);
	if (HULL.has(name.replace(/\.svg$/, ""))) fillHull(inside, W, H);
	const shape = grow(inside, W, H, border * scale);
	const loops = trace(fillInside(shape, W, H), W, H).map((loop) => simplify(loop, 0.6)).filter((loop) => loop.length >= 3);
	// Back to the drawing's units: the canvas starts `pad` before the viewBox.
	const toUnits = ([x, y]) => [vx - pad + x / scale, vy - pad + y / scale];
	const d = loops.map((loop) => smoothPath(loop.map(toUnits))).join("");
	const sx = vx - border, sy = vy - border, sw = vw + 2 * border, sh = vh + 2 * border;
	// The drawing, as it was: what its own <svg> element said (Affinity's exports set
	// `fill-rule: evenodd` there, and its namespaces) goes on a group around it.
	const root = /<svg\b[^>]*>/.exec(svg)[0];
	const body = svg.slice(svg.indexOf(root) + root.length).replace(/<\/svg>\s*$/, "");
	const namespaces = [...root.matchAll(/\s(xmlns:[\w-]+="[^"]*")/g)].map((m) => ` ${m[1]}`).join("");
	const kept = [...root.matchAll(/\s((?:style|fill|fill-rule|clip-rule|stroke[\w-]*|xml:space)="[^"]*")/g)].map((m) => ` ${m[1]}`).join("");
	const n = (v) => +v.toFixed(2);
	return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${namespaces} version="1.1" width="${n(sw)}" height="${n(sh)}" viewBox="${n(sx)} ${n(sy)} ${n(sw)} ${n(sh)}">\n` +
		`  <!-- A sticker of ${name}, written by scripts/stickers.mjs: edit the drawing, then run it again. -->\n` +
		`  <path fill="#ffffff" d="${d}"/>\n  <g${kept}>\n${body.trim()}\n  </g>\n</svg>\n`;
}

/** The mask with every pixel a flood from the canvas's edges can't reach set: the inside of the outline. */
function fillInside(mask, W, H) {
	const outside = new Uint8Array(W * H);
	const stack = [];
	const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
	for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
	for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
	while (stack.length) {
		const i = stack.pop(), x = i % W;
		if (x > 0) push(i - 1);
		if (x < W - 1) push(i + 1);
		if (i >= W) push(i - W);
		if (i < W * (H - 1)) push(i + W);
	}
	const filled = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) filled[i] = outside[i] ? 0 : 1;
	return filled;
}

/** Sets every pixel inside the convex hull of the mask's set pixels (Andrew's monotone chain, then a scanline fill). */
function fillHull(mask, W, H) {
	const pts = [];
	for (let y = 0; y < H; y++) {
		let left = -1, right = -1;
		for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (left < 0) left = x; right = x; }
		if (left >= 0) pts.push([left, y], [right, y]);
	}
	pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list) => {
		const out = [];
		for (const p of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); }
		return out.slice(0, -1);
	};
	const hull = [...half(pts), ...half([...pts].reverse())];
	for (let y = 0; y < H; y++) {
		const xs = [];
		for (let i = 0; i < hull.length; i++) {
			const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
			if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
		}
		xs.sort((a, b) => a - b);
		for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) mask[y * W + x] = 1;
	}
}

/** The mask grown by `r` pixels: every pixel within `r` of a set one (an exact Euclidean distance, Felzenszwalb and Huttenlocher's). */
function grow(mask, W, H, r) {
	const INF = 1e20;
	const f = new Float64Array(Math.max(W, H)), dt = new Float64Array(Math.max(W, H));
	const v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
	const pass = (n) => {
		let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
		for (let q = 1; q < n; q++) {
			let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
			k++; v[k] = q; z[k] = s; z[k + 1] = INF;
		}
		k = 0;
		for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; dt[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
	};
	const dist = new Float64Array(W * H);
	for (let i = 0; i < W * H; i++) dist[i] = mask[i] ? 0 : INF;
	for (let x = 0; x < W; x++) {
		for (let y = 0; y < H; y++) f[y] = dist[y * W + x];
		pass(H);
		for (let y = 0; y < H; y++) dist[y * W + x] = dt[y];
	}
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) f[x] = dist[y * W + x];
		pass(W);
		for (let x = 0; x < W; x++) dist[y * W + x] = dt[x];
	}
	const out = new Uint8Array(W * H);
	const r2 = r * r;
	for (let i = 0; i < W * H; i++) out[i] = dist[i] <= r2 ? 1 : 0;
	return out;
}

/** The closed edges of the mask, as loops of points between pixel centers (marching squares). */
function trace(mask, W, H) {
	const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? mask[y * W + x] : 0);
	// Each edge crossing is a point on a cell's side; segments join them, and follow into loops.
	const next = new Map();
	const key = (x, y) => `${x},${y}`;
	const add = (a, b) => next.set(key(...a), b);
	for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
		const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
		const c = tl * 8 + tr * 4 + br * 2 + bl;
		const top = [x + 0.5, y], right = [x + 1, y + 0.5], bottom = [x + 0.5, y + 1], left = [x, y + 0.5];
		// Segments with the set side on the left, so every loop turns the same way.
		switch (c) {
			case 1: add(bottom, left); break;
			case 2: add(right, bottom); break;
			case 3: add(right, left); break;
			case 4: add(top, right); break;
			case 5: add(top, left); add(bottom, right); break;
			case 6: add(top, bottom); break;
			case 7: add(top, left); break;
			case 8: add(left, top); break;
			case 9: add(bottom, top); break;
			case 10: add(left, bottom); add(right, top); break;
			case 11: add(right, top); break;
			case 12: add(left, right); break;
			case 13: add(bottom, right); break;
			case 14: add(left, bottom); break;
		}
	}
	const loops = [];
	for (const start of next.keys()) {
		if (!next.has(start)) continue;
		const loop = [];
		let k = start;
		while (next.has(k)) {
			const p = next.get(k);
			next.delete(k);
			loop.push(p);
			k = key(...p);
		}
		loops.push(loop);
	}
	return loops;
}

/** The loop with points that lie within `eps` of the line between their neighbors dropped (Ramer, Douglas and Peucker). */
function simplify(loop, eps) {
	if (loop.length < 8) return loop;
	const rdp = (pts) => {
		let max = 0, at = 0;
		const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
		const len = Math.hypot(bx - ax, by - ay) || 1;
		for (let i = 1; i < pts.length - 1; i++) {
			const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
			if (d > max) { max = d; at = i; }
		}
		if (max <= eps) return [pts[0], pts[pts.length - 1]];
		return [...rdp(pts.slice(0, at + 1)).slice(0, -1), ...rdp(pts.slice(at))];
	};
	const half = Math.floor(loop.length / 2);
	return [...rdp(loop.slice(0, half + 1)).slice(0, -1), ...rdp([...loop.slice(half), loop[0]]).slice(0, -1)];
}

/** A closed path through the loop's points, rounded with quadratic curves through their midpoints. */
function smoothPath(pts) {
	const n = (v) => +v.toFixed(1);
	const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	let d = `M${n(mid(pts[pts.length - 1], pts[0])[0])} ${n(mid(pts[pts.length - 1], pts[0])[1])}`;
	for (let i = 0; i < pts.length; i++) {
		const m = mid(pts[i], pts[(i + 1) % pts.length]);
		d += `Q${n(pts[i][0])} ${n(pts[i][1])} ${n(m[0])} ${n(m[1])}`;
	}
	return d + "Z";
}
