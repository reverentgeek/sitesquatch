// What the browsers ask about: what changed in the output, and whether the build works.
//
// A page reloads when its own file changed, or a file any page may use (a script, an image). A
// stylesheet is swapped in place, and another page's change is no news. The reload script listens
// on `/__ssqch/events?v=<the id it last heard>&p=<its page>`, which sends `answer` at once and at
// each change (`listen`), and asks `/__ssqch/build` with the same query where it can't.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as diagnostics from "../diagnostics.ts";
import { compareText, filesBelow, realPath, slashes } from "../paths.ts";

/** What tells one version of an output file from the next: its size, and a mark (see `stamp`). */
type Stamp = readonly [size: number, mark: number | string];

const sameStamp = (a: Stamp | undefined, b: Stamp | undefined) => (a === undefined || b === undefined ? a === b : a[0] === b[0] && a[1] === b[1]);

/** A stylesheet or a script: what other tools write into the output while serving. */
export function isAsset(file: string): boolean {
	const ext = path.extname(file);
	return ext === ".css" || ext === ".js" || ext === ".mjs";
}

/** A hash of a file's contents, or nothing for a folder or a file that's gone. */
export function fingerprint(file: string): string | undefined {
	try { return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("base64"); } catch { return undefined; }
}

/**
 * What tells one version of an output file from the next: its size, and when it was written.
 * Stylesheets and scripts are told apart by their contents instead, since the tools that write
 * them (Sass, PostCSS, esbuild) write them again whether or not anything changed.
 */
function stamp(file: string, stat: fs.Stats): Stamp {
	return [stat.size, isAsset(file) ? fingerprint(file) ?? 0 : stat.mtimeMs];
}

/** Every file under `dir` (or those `only` names) with what `fs.stat` says of it, by its path from `dir` with `/`. Links aren't followed. */
function walk(dir: string, each: (rel: string, file: string, stat: fs.Stats) => void, only?: (name: string) => boolean): void {
	for (const file of filesBelow(dir, only)) {
		// A file that went between the listing and the look isn't there.
		const stat = fs.statSync(file, { throwIfNoEntry: false });
		if (stat) each(slashes(path.relative(dir, file)), file, stat);
	}
}

/** A file's size and when it was written: what a build left, so a tool's write (even of the same contents) is told from it. */
export type Written = readonly [size: number, mtimeMs: number];

/** Each stylesheet and script in `output`, by its resolved path, with its size and when it was written. */
export function assetStamps(output: string): Map<string, Written> {
	const found = new Map<string, Written>();
	walk(realPath(output), (_, file, stat) => found.set(file, [stat.size, stat.mtimeMs]), isAsset);
	return found;
}

export function sameStamps(a: Map<string, Written>, b: Map<string, Written>): boolean {
	if (a.size !== b.size) return false;
	for (const [file, at] of a) {
		const other = b.get(file);
		if (!other || other[0] !== at[0] || other[1] !== at[1]) return false;
	}
	return true;
}

/**
 * The stamps of files another tool may still be writing, once they have stopped changing: two
 * looks 40 ms apart that agree, and not empty (PostCSS empties a file before it writes the new
 * one) unless it stays that way for a second. Nothing for one that's gone.
 */
async function settled(files: string[]): Promise<Array<Stamp | undefined>> {
	const look = (file: string) => { const stat = fs.statSync(file, { throwIfNoEntry: false }); return stat ? stamp(file, stat) : undefined; };
	const start = performance.now();
	const last = files.map(look);
	const done = files.map(() => false);
	while (done.includes(false)) {
		await sleep(40);
		const late = performance.now() - start > 1000;
		files.forEach((file, i) => {
			if (done[i]) return;
			const now = look(file);
			done[i] = late || now === undefined || (sameStamp(now, last[i]) && now[0] > 0);
			last[i] = now;
		});
	}
	return last;
}

/** What's said about a stylesheet or script a page links that isn't in the output. */
export function missingMessage(url: string, tools: string[], output: string): string {
	if (tools.length === 0) return `${url} is linked but nothing wrote it to ${output}. If a tool makes it, run its watcher with \`serve.run\` (\`ssqch docs "CSS and JavaScript"\`)`;
	if (tools.length === 1) return `${url} is linked but isn't in ${output}: serve.run's ${tools[0]} hasn't written it (its output is in the terminal)`;
	return `${url} is linked but isn't in ${output}: none of serve.run's ${tools.slice(0, -1).join(", ")} or ${tools[tools.length - 1]} has written it (their output is in the terminal)`;
}

/** What's said about such a file while the `serve.run` tools are on their first compile, which may not have written it yet (blog #14: Tailwind's took longer than the first build's wait). */
export function compilingMessage(url: string, tools: string[], output: string): string {
	const who = tools.length === 1 ? `serve.run's ${tools[0]} is still running and hasn't written it` : "serve.run's tools are still running and haven't written it";
	return `${url} isn't in ${output} yet: ${who}. The page gets it when it's written`;
}

/** What `/__ssqch/build` answers with. */
export interface Answer {
	id: number;
	error: string | null;
	reload: boolean;
	css: string[];
}

/** Another page, a feed, a map: what a page doesn't load, so its change is no reason to reload. */
const PAGES = new Set(["html", "htm", "xml", "txt", "json", "map", "webmanifest"]);

export class Live {
	/** Goes up with everything a browser should hear about. */
	id: number;
	/** The last build's error, until a build works. */
	error: string | null = null;
	/** Each file in the output as it was last seen (`stamp`), by its path from the output folder. */
	private seen = new Map<string, Stamp>();
	/** The `id` at which each file last changed (or went away). */
	private changedAt = new Map<string, number>();
	/** Stylesheets and scripts a page linked that weren't in the output, by their path from the output folder, with the URL a page used. */
	private missingFiles = new Map<string, string>();
	/** While the `serve.run` tools are on their first compile: whether one is still running, and the timer that gives up on them. */
	private compiling: { running: () => boolean; timer: NodeJS.Timeout } | undefined;
	/** Files a page linked while they were compiling, which they may still write, by path from the output folder, with the URL. */
	private pending = new Map<string, string>();
	/** The `serve.run` tools (`tailwindcss`), and the output folder as shown, for what's said about a missing file. */
	tools: string[] = [];
	private outputName = "";
	/** Who's told when `id` goes up: each browser's open `/__ssqch/events`. */
	private listeners = new Set<() => void>();

	/** Call `fn` each time there's something for browsers to hear; the answer stops it. */
	listen(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	private tell(): void {
		for (const fn of [...this.listeners]) fn();
	}

	/**
	 * Counting from `id`: by default from now, in milliseconds since 1970. A browser that was
	 * watching an earlier server holds a smaller number, so it reloads once this one has built
	 * (with the new server's CSS), even when it had seen as many updates as this one has made.
	 */
	constructor(id: number = Date.now()) {
		this.id = id;
	}

	/** Who could write a missing file: the `serve.run` tools, and the output folder's name. */
	setSite(tools: string[], outputName: string): void {
		this.tools = tools;
		this.outputName = outputName;
	}

	/**
	 * The `serve.run` tools started: until `graceMs` from now, or until none of them is running,
	 * a file a page links that isn't there yet is one they're still compiling, and isn't warned
	 * about. When that's over, the ones still missing are (`endFirstCompile`).
	 */
	startFirstCompile(output: string, graceMs: number, running: () => boolean): void {
		if (this.compiling) clearTimeout(this.compiling.timer);
		const timer = setTimeout(() => this.endFirstCompile(output), graceMs);
		timer.unref();
		this.compiling = { running, timer };
	}

	/** The first compile is over (or given up on): what pages linked meanwhile that's still not in `output` is warned about now. */
	endFirstCompile(output: string): void {
		if (this.compiling) clearTimeout(this.compiling.timer);
		this.compiling = undefined;
		const pending = [...this.pending].sort(([a], [b]) => compareText(a, b));
		this.pending.clear();
		let still = false;
		for (const [rel, url] of pending) {
			if (fs.statSync(path.join(output, rel), { throwIfNoEntry: false })?.isFile()) continue;
			this.missing(rel, url);
			still = true;
		}
		// Browsers ask about their missing files after each update: this one has nothing new but
		// what's said about them, which the note in the corner then shows.
		if (still) {
			this.id += 1;
			this.tell();
		}
	}

	/** A page linked `url` (the file `rel` in the output), and it wasn't there. The message, said in the terminal the first time (not while the tools are on their first compile). */
	missing(rel: string, url: string): string {
		if (this.compiling?.running() && this.tools.length > 0) {
			this.pending.set(rel, url);
			return compilingMessage(url, this.tools, this.outputName);
		}
		const message = missingMessage(url, this.tools, this.outputName);
		if (!this.missingFiles.has(rel)) diagnostics.warn(diagnostics.warning("missing-asset", message));
		this.missingFiles.set(rel, url);
		return message;
	}

	/** After a build: the files pages linked that still aren't in `output`, said again (so they don't scroll away); the ones that turned up are forgotten. */
	repeatMissing(output: string): void {
		for (const rel of [...this.missingFiles.keys()]) {
			if (fs.statSync(path.join(output, rel), { throwIfNoEntry: false })?.isFile()) this.missingFiles.delete(rel);
		}
		// In the order of their names, as 0.7 kept them.
		for (const rel of [...this.missingFiles.keys()].sort(compareText)) {
			diagnostics.warn(diagnostics.warning("missing-asset", missingMessage(this.missingFiles.get(rel)!, this.tools, this.outputName)));
		}
	}

	/**
	 * The output may have changed: a build finished, or another tool wrote there. Look at every
	 * file, and note the ones that differ (which this returns). A stylesheet or script that
	 * differs is looked at again once it has stopped changing, so browsers never fetch one half
	 * written.
	 */
	async changed(output: string): Promise<string[]> {
		const now = new Map<string, Stamp>();
		walk(output, (rel, file, stat) => now.set(rel, stamp(file, stat)));
		const differs = () => {
			const out: string[] = [];
			for (const [file, at] of now) if (!sameStamp(this.seen.get(file), at)) out.push(file);
			for (const file of this.seen.keys()) if (!now.has(file)) out.push(file);
			return out;
		};
		// Browsers' questions are answered meanwhile, with the last state: they don't hear of a
		// change until it has settled.
		const writing = differs().filter((file) => now.has(file) && isAsset(file));
		const stamps = await settled(writing.map((file) => path.join(output, file)));
		writing.forEach((file, i) => {
			const at = stamps[i];
			if (at) now.set(file, at);
			else now.delete(file);
		});
		const changed = differs();
		if (!changed.length && this.error === null) return changed;
		this.id += 1;
		this.error = null;
		for (const file of changed) this.changedAt.set(file, this.id);
		this.seen = now;
		this.tell();
		return changed;
	}

	/** A build failed: the output is as it was, and browsers show `error`. */
	failed(error: string): void {
		this.id += 1;
		this.error = error;
		this.tell();
	}

	/** The size the file `rel` had when it was last looked at. */
	sizeSeen(rel: string): number | undefined {
		return this.seen.get(rel)?.[0];
	}

	/**
	 * The answer for a browser that last heard `since` and is showing the page in `page` (a file
	 * in the output): the `id` now, the build's `error`, whether to `reload`, and the stylesheets
	 * (`css`, as URLs) to fetch again. A page reloads when its own file changed, or a file that
	 * isn't a page or a stylesheet (a script, an image: any page may use it).
	 */
	answer(since: number | undefined, page: string, base: string): Answer {
		let reload = false;
		const css: string[] = [];
		// A server that started again counts from the beginning.
		if (since !== undefined && since > this.id) reload = true;
		else if (since !== undefined) {
			const known = this.seen.has(page);
			for (const [file, at] of this.changedAt) {
				if (at <= since) continue;
				const dot = file.lastIndexOf(".");
				const kind = dot === -1 ? "" : file.slice(dot + 1);
				if (file === page) reload = true;
				else if (kind === "css") css.push(`${base}/${file}`);
				// Another page. One that isn't there yet (a 404) reloads to see if it is now.
				else if (PAGES.has(kind)) reload ||= !known;
				else reload = true;
			}
		}
		css.sort(compareText);
		return { id: this.id, error: this.error, reload, css };
	}
}
