// The side of `ssqch serve`'s second process that builds (`builder.ts` has why there is one, and
// the server's side). The server starts it with the arguments `BUILDER` and its JSON; `cli.ts`
// imports this only then, so the server itself never loads the build, its engines or plugins.
import path from "node:path";
import type { Config } from "../config.ts";
import { dirsOf } from "../dirs.ts";
import { build } from "../build.ts";
import * as diagnostics from "../diagnostics.ts";
import { Locator } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { describeThrown, loadedFiles } from "../modules.ts";
import { filesRead } from "../plugin-files.ts";
import { isInside, realPath, relative, slashes } from "../paths.ts";
import { summary } from "../report.ts";
import { isAsset } from "./live.ts";
import { fileHash } from "./builder.ts";
import type { BuilderStart, FromBuilder, SiteInfo, State, ToBuilder } from "./builder.ts";

const key = (row: equivalents.Equivalent) => `${row.kind}:${row.word}`;

/** Where a site's files can be named from: its root, its input, includes and data folders, and its themes'. */
function locatorDirs(config: Config): string[] {
	const dirs = dirsOf(config);
	return [dirs.input, dirs.includes, dirs.data, ...config.themes.flatMap((theme) => [theme, path.join(theme, "_includes")])];
}

function siteInfo(config: Config): SiteInfo {
	const dirs = dirsOf(config);
	return {
		root: dirs.root,
		env: config.env,
		input: dirs.input,
		output: dirs.output,
		outputName: isInside(dirs.root, dirs.output) ? relative(dirs.root, dirs.output) : slashes(dirs.output),
		base: config.base,
		serveRun: config.serveRun,
		watch: [dirs.input, ...config.watch.map((target) => path.resolve(dirs.root, target))],
		locate: locatorDirs(config),
	};
}

/** Everything written so far is out, so what the server prints next comes after it. */
const flushed = () => Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => { stream.write("", () => resolve()); })));

/**
 * Runs as the process that builds for a server: loads the configuration, says so, then builds
 * each time it's asked. Returns only when the configuration doesn't load (its error is
 * printed), with the exit code.
 */
export async function runBuilder(start: BuilderStart, makeConfig: () => Promise<Config>, root: string): Promise<number> {
	const send = (message: FromBuilder) => new Promise<void>((resolve) => { process.send!(message, undefined, undefined, () => resolve()); });
	// Each file as it was when it first loaded: the configuration this process has.
	const loadedAs = new Map<string, string>();
	const state = (config: Config): State => {
		const files = [...loadedFiles].map(realPath);
		for (const file of files) if (!loadedAs.has(file)) loadedAs.set(file, fileHash(file));
		return { files, loadedAs: Object.fromEntries(loadedAs), read: filesRead(config), said: diagnostics.aliasesUsed().map(key) };
	};
	diagnostics.aliasesKnown(equivalents.TABLE.filter((row) => start.said.includes(key(row))));
	// The server went away without stopping this (it was killed): nothing to build for.
	process.on("disconnect", () => process.exit(0));
	// Ctrl-C reaches every process in the terminal's group, this one too: it's the server's to
	// stop this (and it says nothing of a build it stopped), not the signal's.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => {});

	// While the site's code runs (the configuration loading, a build), the channel to the server
	// doesn't keep this process going: when that code waits for a promise nothing can settle,
	// Node is about to end, which is how ssqch finds out and says so (`watchSettle`).
	const working = async <T>(work: () => Promise<T>): Promise<T> => {
		process.channel?.unref();
		try { return await work(); } finally { process.channel?.ref(); }
	};
	let config: Config;
	try {
		config = await working(makeConfig);
	} catch (e) {
		if (!start.reload) diagnostics.printError("error:", e, "config", new Locator(root));
		else if (start.fallback === false) process.stderr.write(`${diagnostics.red("Config error:")} ${diagnostics.messageOf(e)}\n(nothing builds until it loads: the process that built with the last configuration that loaded has ended)\n`);
		else process.stderr.write(`${diagnostics.red("Config error:")} ${diagnostics.messageOf(e)}\n(still serving with the last configuration that loaded)\n`);
		await flushed();
		await send({ type: "failed" });
		return 1;
	}
	const at = new Locator(config.root, locatorDirs(config));
	// From here, what the site's code throws where nothing catches it is said to the server, which
	// shows it as this build's error or the next one's, and this process ends (`crashed` in
	// `cli.ts` was for the configuration loading).
	let crashing = false;
	const crash = (e: unknown) => {
		if (crashing) return;
		crashing = true;
		// With where in the site's code it was thrown, and the lines there.
		const said = diagnostics.describe(new diagnostics.BuildError(describeThrown(e, config.root)), "build", at);
		const end = () => process.exit(1);
		setTimeout(end, 2000).unref();
		void send({ type: "crashed", error: said }).then(flushed).then(end, end);
	};
	process.removeAllListeners("uncaughtException");
	process.removeAllListeners("unhandledRejection");
	process.on("uncaughtException", crash);
	process.on("unhandledRejection", crash);
	const asked: ToBuilder[] = [];
	let wake: (() => void) | undefined;
	process.on("message", (message: ToBuilder) => { asked.push(message); wake?.(); });
	await send({ type: "loaded", site: siteInfo(config), ...state(config) });

	for (;;) {
		while (!asked.length) await new Promise<void>((resolve) => { wake = resolve; });
		wake = undefined;
		const { recovered } = asked.shift()!;
		let result: { ok: boolean; error?: string; assets: string[] };
		try {
			const report = await working(() => build(config));
			if (!config.quiet) process.stdout.write(summary(config, report, recovered));
			result = { ok: true, assets: report.outputs.filter(isAsset) };
		} catch (e) {
			// With the lines it's about, in the terminal and over the page.
			const said = diagnostics.describe(e, "build", at);
			process.stderr.write(`${diagnostics.red("Build failed:")} ${said}\n`);
			result = { ok: false, error: said, assets: [] };
		}
		await flushed();
		await send({ type: "built", ...result, ...state(config) });
	}
}
