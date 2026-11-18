// What an image's colour profile asks for, from 0.7's `plugins/image/src/color.rs`.
//
// Browsers show pixels without a profile as sRGB, so a photo in a wider space (Display P3 from a
// phone, Adobe RGB from a camera) has to be converted, or its colours come out washed out. sharp
// converts every embedded profile to sRGB when it encodes; what's decided here is what 0.7 decided
// (with moxcms), because it's in each image's name: a converted image's id has `|srgb` in it, so
// an upgraded site's names, and its image cache, stay the same. Images without a profile, with
// an sRGB one, or with one that isn't RGB, are kept as they are.

export type ColorPlan = { kind: "keep" } | { kind: "convert" } | { kind: "unsupported"; why: string };

/** sRGB's colorants, adapted to D50, as moxcms has them. */
const SRGB: Array<[number, number, number]> = [
	[0.4358437020317384, 0.22237346998171753, 0.01392884984376424],
	[0.3853088106132035, 0.7170281521655508, 0.09715675318321043],
	[0.14305951977573775, 0.060598377591300316, 0.7141027109713133],
];

interface Profile {
	colorSpace: string;
	pcs: string;
	tags: Map<string, { type: string; data: Buffer }>;
}

function parse(icc: Buffer): Profile | undefined {
	if (icc.length < 132) return undefined;
	const size = icc.readUInt32BE(0);
	if (size > icc.length || size < 132 || icc.subarray(36, 40).toString("latin1") !== "acsp") return undefined;
	const count = icc.readUInt32BE(128);
	if (132 + count * 12 > size) return undefined;
	const tags = new Map<string, { type: string; data: Buffer }>();
	for (let i = 0; i < count; i++) {
		const at = 132 + i * 12;
		const signature = icc.subarray(at, at + 4).toString("latin1");
		const offset = icc.readUInt32BE(at + 4);
		const length = icc.readUInt32BE(at + 8);
		if (offset + length > size || length < 8) return undefined;
		const data = icc.subarray(offset, offset + length);
		tags.set(signature, { type: data.subarray(0, 4).toString("latin1"), data });
	}
	return { colorSpace: icc.subarray(16, 20).toString("latin1"), pcs: icc.subarray(20, 24).toString("latin1"), tags };
}

/** A colorant tag's X, Y and Z (s15Fixed16), or undefined. */
function xyz(profile: Profile, tag: string): [number, number, number] | undefined {
	const found = profile.tags.get(tag);
	if (!found || found.type !== "XYZ " || found.data.length < 20) return undefined;
	const s15 = (at: number) => found.data.readInt32BE(at) / 65536;
	return [s15(8), s15(12), s15(16)];
}

/** A tone curve moxcms reads: a table (`curv`) or one of the five parametric functions (`para`). */
function readableCurve(profile: Profile, tag: string): boolean {
	const found = profile.tags.get(tag);
	if (!found) return false;
	if (found.type === "curv") return found.data.length >= 12;
	if (found.type === "para") return found.data.length >= 12 && found.data.readUInt16BE(8) <= 4;
	return false;
}

/** What to do with the profile `icc` (none, for an image without one). */
export function colorPlan(icc: Buffer | undefined): ColorPlan {
	if (!icc) return { kind: "keep" };
	const profile = parse(icc);
	if (!profile || profile.colorSpace !== "RGB ") return { kind: "keep" };
	const colorants = [xyz(profile, "rXYZ"), xyz(profile, "gXYZ"), xyz(profile, "bXYZ")];
	const hasCurves = ["rTRC", "gTRC", "bTRC"].every((t) => profile.tags.has(t));
	const matrixShaper = colorants.every((c) => c !== undefined && (c[0] !== 0 || c[1] !== 0 || c[2] !== 0)) && hasCurves;
	const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 0.002);
	if (matrixShaper && colorants.every((c, i) => close(c!, SRGB[i]))) return { kind: "keep" };
	const lut = ["A2B0", "A2B1", "A2B2"].some((t) => profile.tags.has(t));
	if (profile.pcs !== "XYZ " && profile.pcs !== "Lab ") return { kind: "unsupported", why: "UnsupportedProfileConnection" };
	if (lut) return { kind: "convert" };
	if (!matrixShaper) return { kind: "unsupported", why: "UnsupportedProfileConnection" };
	if (!["rTRC", "gTRC", "bTRC"].every((t) => readableCurve(profile, t))) return { kind: "unsupported", why: "UnsupportedTrc" };
	return { kind: "convert" };
}
