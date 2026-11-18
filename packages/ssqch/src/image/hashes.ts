// Each source image's id between builds, so a warm build doesn't read every image to hash it.
// From 0.7's `plugins/image/src/hash_cache.rs`, in the same file and format, so a site keeps it
// across the upgrade.
//
// Ids are hashes of file contents (see `ImageProcessor.hashId`), which keeps them the same in a
// fresh clone. This cache keeps `(size, modification time, settings) -> id` in
// `.cache/ssqch/image-hashes.json`; a file whose size or modification time changed is read and
// hashed again, so a fresh CI checkout (new modification times) hashes everything once and still
// gets the same ids. It names source paths, which is why it's in `.cache/` and not next to the
// published images.
import fs from "node:fs";
import path from "node:path";

/** Where the cache lives, from the project root. */
export const CACHE_FILE = ".cache/ssqch/image-hashes.json";

interface Entry {
	size: number;
	/** Nanoseconds, as text: too big for a JSON number. */
	mtime: string;
	settings: string;
	id: string;
}

/** A file's size and modification time in nanoseconds (as text), what its id is checked against. */
export function stamp(file: string): { size: number; mtime: string } {
	const stat = fs.statSync(file, { bigint: true });
	return { size: Number(stat.size), mtime: stat.mtimeNs.toString() };
}

export class HashCache {
	private file: string | undefined;
	private entries = new Map<string, Entry>();
	private used = new Set<string>();
	private dirty = false;

	/** The cache at `file`, once per process: later builds reuse what's in memory. A missing or unreadable file is an empty cache. */
	load(file: string): void {
		this.used.clear();
		if (this.file === file) return;
		this.entries = parse(file) ?? new Map();
		this.file = file;
		this.dirty = false;
	}

	get(src: string, size: number, mtime: string, settings: string): string | undefined {
		const e = this.entries.get(src);
		if (e && e.size === size && e.mtime === mtime && e.settings === settings) {
			this.used.add(src);
			return e.id;
		}
		return undefined;
	}

	put(src: string, size: number, mtime: string, settings: string, id: string): void {
		const e = this.entries.get(src);
		if (!(e && e.size === size && e.mtime === mtime && e.settings === settings && e.id === id)) {
			this.entries.set(src, { size, mtime, settings, id });
			this.dirty = true;
		}
		this.used.add(src);
	}

	/** Writes the cache if it changed, keeping only the images this build used. Nothing for a build that used no images and has no cache. */
	save(): void {
		const file = this.file;
		if (file === undefined) return;
		const before = this.entries.size;
		for (const key of [...this.entries.keys()]) if (!this.used.has(key)) this.entries.delete(key);
		if (!this.dirty && this.entries.size === before) return;
		if (this.entries.size === 0 && !fs.existsSync(file)) return;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = file.replace(/\.json$/, ".json.tmp");
		fs.writeFileSync(tmp, serialize(this.entries));
		fs.renameSync(tmp, file);
		this.dirty = false;
	}
}

function serialize(entries: Map<string, Entry>): string {
	// Sorted by path, as 0.7 wrote it.
	const keys = [...entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const files: Record<string, unknown> = {};
	for (const key of keys) {
		const e = entries.get(key)!;
		files[key] = { size: e.size, mtime: e.mtime, settings: e.settings, id: e.id };
	}
	return JSON.stringify({ version: 1, files }, null, 2) + "\n";
}

function parse(file: string): Map<string, Entry> | undefined {
	let doc: any;
	try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
	if (doc?.version !== 1 || typeof doc.files !== "object" || doc.files === null) return undefined;
	const out = new Map<string, Entry>();
	for (const [key, v] of Object.entries<any>(doc.files)) {
		if (Number.isInteger(v?.size) && v.size >= 0 && typeof v.mtime === "string" && /^\d+$/.test(v.mtime) && typeof v.settings === "string" && typeof v.id === "string") {
			out.set(key, { size: v.size, mtime: v.mtime, settings: v.settings, id: v.id });
		}
	}
	return out;
}
