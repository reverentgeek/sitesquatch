// Watching folders for changes, with `node:fs` alone.
//
// macOS and Windows watch a whole tree with one watcher (FSEvents, ReadDirectoryChangesW). Linux
// has no such thing: inotify watches one folder, so each folder in the tree gets a watcher of its
// own, and a folder made later gets one when it appears. That's written here rather than left to
// Node's `recursive` option, which on Linux walks into `node_modules` and `.git` (a site whose
// input folder is the project root has both, and thousands of watches run a machine out of
// them), and whose behavior has changed between Node releases. Every change is reported as the
// path it happened to; what a change means is the server's to decide.
import fs from "node:fs";
import path from "node:path";
import { realPath } from "../paths.ts";

/**
 * What's sent from one part of the server to another, in order: the watcher's changes, read by
 * the loop that rebuilds. One reader at a time.
 */
export class Channel<T> {
	private items: T[] = [];
	private wake: (() => void) | undefined;

	send(item: T): void {
		this.items.push(item);
		this.wake?.();
	}

	/** The next item if one is waiting. */
	tryRecv(): T | undefined {
		return this.items.shift();
	}

	/** The next item, whenever it comes. */
	async recv(): Promise<T> {
		while (!this.items.length) await new Promise<void>((resolve) => { this.wake = resolve; });
		this.wake = undefined;
		return this.items.shift()!;
	}

	/** The next item, or nothing when none comes within `ms`. */
	async recvTimeout(ms: number): Promise<T | undefined> {
		if (!this.items.length && ms > 0) {
			let timer: NodeJS.Timeout | undefined;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
				timer = setTimeout(resolve, ms);
			});
			clearTimeout(timer);
			this.wake = undefined;
		}
		return this.items.shift();
	}

	/** Forget what's waiting. */
	drain(): void {
		this.items.length = 0;
	}
}

/** `tree`: one watcher for a folder and everything below it, where the system has one. `folders`: a watcher for each folder. */
export type Strategy = "tree" | "folders";

export const defaultStrategy = (): Strategy => (process.platform === "darwin" || process.platform === "win32" ? "tree" : "folders");

/**
 * Folders a watch of each folder doesn't go into: what a build writes for itself, a repository's
 * own files and installed packages. A change in one isn't a change to the site (the server
 * leaves them out too), and they can hold more folders than the system gives watches.
 */
const SKIPPED = new Set([".cache", ".git", "node_modules"]);

interface Watched {
	recursive: boolean;
	/** The watcher of each folder, by its path. With `tree`, the one for the top. */
	folders: Map<string, fs.FSWatcher>;
	/** The folders' real paths, so a link that leads back up isn't followed around again. */
	real: Set<string>;
	/** A folder below the top couldn't be watched, and that's been said. */
	failed?: boolean;
}

export class Watcher {
	private onChange: (file: string) => void;
	private strategy: Strategy;
	private watched = new Map<string, Watched>();
	/** A folder below a watched one that couldn't be watched itself. */
	onError: (dir: string, e: unknown) => void = () => {};

	constructor(onChange: (file: string) => void, strategy: Strategy = defaultStrategy()) {
		this.onChange = onChange;
		this.strategy = strategy;
	}

	/**
	 * Watch `dir`: the files in it, and with `recursive` everything below it. A folder that's
	 * watched already stays as it is, unless this asks for more of it. A folder that can't be
	 * watched throws; one below it that can't goes to `onError`.
	 */
	watch(dir: string, recursive: boolean): void {
		const had = this.watched.get(dir);
		if (had && (had.recursive || !recursive)) return;
		if (had) this.unwatch(dir);
		const top: Watched = { recursive, folders: new Map(), real: new Set() };
		if (this.strategy === "tree" || !recursive) this.listen(top, dir, recursive && this.strategy === "tree");
		else this.walk(top, dir, true);
		this.watched.set(dir, top);
	}

	unwatch(dir: string): void {
		const top = this.watched.get(dir);
		if (!top) return;
		for (const watcher of top.folders.values()) watcher.close();
		this.watched.delete(dir);
	}

	close(): void {
		for (const dir of [...this.watched.keys()]) this.unwatch(dir);
	}

	/** How many folders have a watcher (for tests). */
	get size(): number {
		let n = 0;
		for (const top of this.watched.values()) n += top.folders.size;
		return n;
	}

	private listen(top: Watched, dir: string, tree: boolean): void {
		const watcher = fs.watch(dir, { recursive: tree }, (event, name) => this.changed(top, dir, name === null ? undefined : String(name), tree, event === "rename"));
		// A folder that's deleted ends its watch, on Windows with an error.
		watcher.on("error", () => this.forget(top, dir));
		top.folders.set(dir, watcher);
	}

	/** A watcher for `dir` and each folder below it. Linked folders are followed, as the build follows them. */
	private walk(top: Watched, dir: string, first = false): void {
		if (top.folders.has(dir)) return;
		const real = realPath(dir);
		if (top.real.has(real)) return;
		try {
			this.listen(top, dir, false);
		} catch (e) {
			if (first) throw e;
			// Said once for a tree: when the system has no watches left, every folder after
			// this one fails the same way.
			if (!top.failed) this.onError(dir, e);
			top.failed = true;
			return;
		}
		top.real.add(real);
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			if (SKIPPED.has(entry.name)) continue;
			const file = path.join(dir, entry.name);
			if (entry.isDirectory() || (entry.isSymbolicLink() && isDir(file))) this.walk(top, file);
		}
	}

	private changed(top: Watched, dir: string, name: string | undefined, tree: boolean, renamed: boolean): void {
		// The system didn't say which file: the folder itself, then.
		if (name === undefined) return this.onChange(dir);
		const file = path.join(dir, name);
		this.onChange(file);
		if (tree || !top.recursive) return;
		if (isDir(file)) {
			if (SKIPPED.has(name)) return;
			// A folder that was watched and is new again (deleted and made again before this heard
			// of either) has a watcher on the one that's gone.
			if (renamed && top.folders.has(file)) this.forget(top, file);
			// A new folder: watch it, and report what was put in it before the watch began.
			if (!top.folders.has(file)) {
				this.walk(top, file);
				for (const inside of filesIn(file)) this.onChange(inside);
			}
		} else if (top.folders.has(file)) {
			this.forget(top, file);
		}
	}

	/** `dir` is gone: so are its watcher and those of the folders that were in it. */
	private forget(top: Watched, dir: string): void {
		for (const [folder, watcher] of [...top.folders]) {
			if (folder !== dir && !folder.startsWith(dir + path.sep)) continue;
			watcher.close();
			top.folders.delete(folder);
		}
		// Its real path is free again, for a folder made again under the same name.
		top.real = new Set([...top.folders.keys()].map(realPath));
	}
}

const isDir = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Every file below `dir`, outside the folders a watch leaves alone. */
function filesIn(dir: string): string[] {
	const out: string[] = [];
	const visit = (folder: string, depth: number) => {
		let entries: fs.Dirent[];
		try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) { if (!SKIPPED.has(entry.name) && depth < 32) visit(file, depth + 1); }
			else out.push(file);
		}
	};
	visit(dir, 0);
	return out;
}
