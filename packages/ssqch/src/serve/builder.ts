// The process that builds for `ssqch serve`.
//
// The server doesn't load the site's configuration itself: a second process does, and builds
// when the server asks. When a file the configuration came from changes (the config, a module it
// imports, a data file, a module that imports), the server starts another one and stops the
// first, so everything the site's JavaScript loaded is read again: ES modules, CommonJS ones and
// what they `require`, and whatever state they kept. Node can't forget a module it has loaded,
// and importing a changed file under a new URL reloads that file but not the ones it imports,
// which is how a filter in the config's `./lib/filters.js` stayed the old one. A process that
// starts again has none of that, as 0.7's new JavaScript engine for each reload didn't.
//
// It also keeps the server answering while a build runs (the browser's questions, and pages
// from the last build), and a site whose code ends the process ends only this one.
//
// The two talk over Node's channel between a process and the one it started (`process.send`).
// The server's words (`Fresh tracks in`, `Serving ... at`) are the server's to print; the
// build's (its summary, `Build failed:`, a config's error) are printed here, in order, since
// both write to the same terminal.
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import type { Config } from "../config.ts";
import { dirsOf } from "../config.ts";
import { build } from "../build.ts";
import * as diagnostics from "../diagnostics.ts";
import { Locator } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { loadedFiles } from "../modules.ts";
import { isInside, realPath, relative, slashes } from "../paths.ts";
import { summary } from "../report.ts";
import { isAsset } from "./live.ts";

/** The first argument of the process that builds, before its JSON and the server's own arguments. Not a command: `--help` doesn't list it. */
export const BUILDER = "__serve-builder";

/** What the server tells the process it starts. */
export interface BuilderStart {
	/** Whether a configuration loaded before this one: its error is then `Config error:`, and the server carries on. */
	reload: boolean;
	/** Other generators' words that have been noted already (`kind:word`), so each is noted once however often the configuration loads. */
	said: string[];
}

/** What the server needs to know about a site: what a reloaded configuration can change. */
export interface SiteInfo {
	root: string;
	env: string;
	/** The folders, absolute. */
	input: string;
	output: string;
	/** The output folder as messages show it: `dist`, from the project root. */
	outputName: string;
	base: string;
	serveRun: string[];
	/** The folders (and files) to watch, absolute: the input folder first, then the config's `watch`, its themes' and its plugins'. */
	watch: string[];
	/** Where an error's files can be named from. */
	locate: string[];
}

/** After the configuration loaded, and after each build. */
interface State {
	/** The site's own files that were loaded as modules: a change to one reads the configuration again. */
	files: string[];
	said: string[];
}

type FromBuilder =
	| ({ type: "loaded"; site: SiteInfo } & State)
	| { type: "failed" }
	| ({ type: "built"; ok: boolean; error?: string; assets: string[] } & State);

type ToBuilder = { type: "build"; recovered: boolean };

const key = (row: equivalents.Equivalent) => `${row.kind}:${row.word}`;

// ---- the process that builds ----------------------------------------------------------------

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
	const state = (): State => ({ files: [...loadedFiles].map(realPath), said: diagnostics.aliasesUsed().map(key) });
	diagnostics.aliasesKnown(equivalents.TABLE.filter((row) => start.said.includes(key(row))));
	// The server went away without stopping this (it was killed): nothing to build for.
	process.on("disconnect", () => process.exit(0));

	let config: Config;
	try {
		config = await makeConfig();
	} catch (e) {
		if (start.reload) process.stderr.write(`${diagnostics.red("Config error:")} ${diagnostics.messageOf(e)}\n(still serving with the last configuration that loaded)\n`);
		else diagnostics.printError("error:", e, "config", new Locator(root));
		await flushed();
		await send({ type: "failed" });
		return 1;
	}
	const at = new Locator(config.root, locatorDirs(config));
	const asked: ToBuilder[] = [];
	let wake: (() => void) | undefined;
	process.on("message", (message: ToBuilder) => { asked.push(message); wake?.(); });
	await send({ type: "loaded", site: siteInfo(config), ...state() });

	for (;;) {
		while (!asked.length) await new Promise<void>((resolve) => { wake = resolve; });
		wake = undefined;
		const { recovered } = asked.shift()!;
		// While a build runs, the channel to the server doesn't keep this process going: when the
		// site's code waits for a promise nothing can settle, Node is about to end, which is how
		// the build finds out and says so (`watchSettle`).
		process.channel?.unref();
		let result: { ok: boolean; error?: string; assets: string[] };
		try {
			const report = await build(config);
			if (!config.quiet) process.stdout.write(summary(config, report, recovered));
			result = { ok: true, assets: report.outputs.filter(isAsset) };
		} catch (e) {
			// With the lines it's about, in the terminal and over the page.
			const said = diagnostics.describe(e, "build", at);
			process.stderr.write(`${diagnostics.red("Build failed:")} ${said}\n`);
			result = { ok: false, error: said, assets: [] };
		}
		process.channel?.ref();
		await flushed();
		await send({ type: "built", ...result, ...state() });
	}
}

// ---- the server's side -------------------------------------------------------------------------

/** What a build came to. */
export interface Built {
	ok: boolean;
	/** A failed build's error, as the terminal has it. */
	error?: string;
	/** The stylesheets and scripts the build put in the output, absolute. */
	assets: string[];
}

/** Every builder running, for when the server stops. */
const builders = new Set<Builder>();

/** Stop every process that builds, at once. */
export function stopBuilders(): void {
	for (const builder of [...builders]) builder.stop();
}

/** A process that builds one configuration of the site, as the server sees it. */
export class Builder {
	site!: SiteInfo;
	/** The configuration's files, as of the last build. */
	files = new Set<string>();
	/** Other generators' words noted so far. */
	said: string[] = [];
	private args: string[];
	private child: ChildProcess | undefined;
	private waiting: ((message: FromBuilder | undefined) => void) | undefined;

	private constructor(args: string[]) {
		this.args = args;
	}

	/**
	 * Start a process that loads the configuration, with the command line's own arguments.
	 * Nothing when it doesn't load: the process has printed why.
	 */
	static async start(args: string[], start: BuilderStart): Promise<Builder | undefined> {
		const builder = new Builder(args);
		builder.said = start.said;
		return (await builder.spawn(start)) ? builder : undefined;
	}

	private async spawn(start: BuilderStart): Promise<boolean> {
		// The same program, started the same way: its own file, and the options Node was given.
		const child = fork(process.argv[1], [BUILDER, JSON.stringify(start), ...this.args], { stdio: ["inherit", "inherit", "inherit", "ipc"], execArgv: process.execArgv });
		this.child = child;
		builders.add(this);
		child.on("message", (message: FromBuilder) => this.waiting?.(message));
		child.once("exit", () => {
			if (this.child === child) {
				this.child = undefined;
				builders.delete(this);
			}
			this.waiting?.(undefined);
		});
		child.once("error", () => this.waiting?.(undefined));
		const message = await this.next();
		if (message?.type !== "loaded") {
			this.stop();
			return false;
		}
		this.site = message.site;
		this.note(message);
		return true;
	}

	private next(): Promise<FromBuilder | undefined> {
		return new Promise((resolve) => {
			this.waiting = (message) => {
				this.waiting = undefined;
				resolve(message);
			};
		});
	}

	private note(state: State): void {
		this.files = new Set(state.files);
		this.said = state.said;
	}

	/** Build, and print the summary or the error. `recovered`: the last build failed, which the summary of one that works says. */
	async build(recovered: boolean): Promise<Built> {
		// The site's code ended the process (or it crashed) since the last build: start again.
		if (!this.child && !(await this.spawn({ reload: true, said: this.said }))) {
			return { ok: false, error: "The configuration didn't load: its error is in the terminal.", assets: [] };
		}
		const child = this.child!;
		const answer = this.next();
		child.send({ type: "build", recovered } satisfies ToBuilder);
		const message = await answer;
		if (message?.type !== "built") {
			const how = child.exitCode !== null ? `exit code ${child.exitCode}` : child.signalCode !== null ? `stopped by ${child.signalCode}` : "it stopped answering";
			const error = `The build's process ended before the build did (${how}). What it said is in the terminal.`;
			process.stderr.write(`${diagnostics.red("Build failed:")} ${error}\n`);
			return { ok: false, error, assets: [] };
		}
		this.note(message);
		return { ok: message.ok, error: message.error, assets: message.assets };
	}

	stop(): void {
		const child = this.child;
		this.child = undefined;
		builders.delete(this);
		if (child && child.exitCode === null && child.signalCode === null) child.kill();
	}
}
