import crypto from "node:crypto";
import fs from "node:fs";
// The files a built-in plugin read for the last build, beyond the site's own pages and data: the
// stylesheets and partials `ssqch/sass` compiled. `ssqch serve` rebuilds when one changes. Kept
// here rather than in the plugin's module, whose exports are what a site can import.

const read = new WeakMap<object, Map<string, Set<string>>>();

/** Starts a plugin's list for a build of `config`, forgetting what it read the build before. */
export function startReading(config: object, plugin: string): Set<string> {
	let byPlugin = read.get(config);
	if (!byPlugin) read.set(config, byPlugin = new Map());
	const files = new Set<string>();
	byPlugin.set(plugin, files);
	return files;
}

/** The files (absolute, real paths) the plugins read for the last build of `config`, sorted. */
export function filesRead(config: object): string[] {
	const all = new Set<string>();
	for (const files of read.get(config)?.values() ?? []) for (const file of files) all.add(file);
	for (const file of siteRead.files) all.add(file);
	return [...all].sort();
}

/**
 * Files the site's code read through ssqch's own functions, for `ssqch serve`, which turns this on
 * in the process that builds (nothing is kept for `ssqch build`). Before, a file outside the input
 * folder was watched by nothing (`readData("data/snacks.yml")` with `input: "src"`), and an edit to
 * it left the page as it was until the server was started again.
 *
 * - `values`: data and settings (`readData()`, a Markdown grammar, `mkdocs.yml`), each with a hash
 *   of what was read, taken as it was read. They're reported with the config's own files, so a
 *   change reads the configuration again: right whether the file was read while the config loaded
 *   (it's in its values) or by a data module's top level, which runs once. The hash is of what
 *   the build used, so a `beforeBuild` hook that writes the file before it's read isn't a change.
 * - `files`: what `files()` matched and `image()` was given, which a build reads afresh each
 *   time. A change rebuilds, as a page's own picture does; nothing hashes them (a folder of photos).
 */
export const siteRead = { on: false, values: new Map<string, string>(), files: new Set<string>() };

/** `readData()` and the like: a file whose contents became values. */
export function readValues(file: string): void {
	if (!siteRead.on) return;
	let hash = "-";
	try { hash = crypto.hash("sha1", fs.readFileSync(file), "base64"); } catch { /* gone: a change when it's back */ }
	siteRead.values.set(file, hash);
}

/** `files()` and `image()`: a file a build reads again each time. */
export function readFile(file: string): void {
	if (siteRead.on) siteRead.files.add(file);
}
