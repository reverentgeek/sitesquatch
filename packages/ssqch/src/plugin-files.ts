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
	return [...all].sort();
}
