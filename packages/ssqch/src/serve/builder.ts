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
// from the last build), and a site whose code ends the process ends only this one. Another
// starts at once, with the configuration as it is then: the one that loaded last, unless its
// files have changed since (the server reads them again for that change anyway). So the last
// configuration that loaded goes on building, as in 0.7, where nothing could end it.
//
// An error the site's code throws where nothing catches it (in a timer, say) ends this process
// too, as Node can't vouch for what's left. It's told to the server first: it's the error of the
// build that was running, or of the next one (as in 0.7, where a timer ran at the next build).
//
// The two talk over Node's channel between a process and the one it started (`process.send`).
// The server's words (`Fresh tracks in`, `Serving ... at`) are the server's to print; the
// build's (its summary, `Build failed:`, a config's error) are printed here, in order, since
// both write to the same terminal.
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config.ts";
import { dirsOf } from "../config.ts";
import { build } from "../build.ts";
import * as diagnostics from "../diagnostics.ts";
import { Locator } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { describeThrown, loadedFiles } from "../modules.ts";
import { filesRead } from "../plugin-files.ts";
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
	/**
	 * For a reload: whether a process with the last configuration that loaded is there to go on
	 * building, which an error says. Not when this one takes the place of one that ended.
	 */
	fallback?: boolean;
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
	/**
	 * A hash of each of them as it was when it loaded, so the server can tell whether another
	 * process would load the same configuration.
	 */
	loadedAs: Record<string, string>;
	/** The files the plugins read for the last build, beyond the pages and the data (a stylesheet's partials): a change to one rebuilds the site. */
	read: string[];
	said: string[];
}

type FromBuilder =
	| ({ type: "loaded"; site: SiteInfo } & State)
	| { type: "failed" }
	| ({ type: "built"; ok: boolean; error?: string; assets: string[] } & State)
	/** The site's code threw where nothing caught it, and the process is ending: the error, said as a build's is. */
	| { type: "crashed"; error: string };

type ToBuilder = { type: "build"; recovered: boolean };

const key = (row: equivalents.Equivalent) => `${row.kind}:${row.word}`;

/** What a file holds, as a hash (`-` for a file that isn't there). */
function fileHash(file: string): string {
	try { return crypto.hash("sha1", fs.readFileSync(file), "base64"); } catch { return "-"; }
}

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
/** Set when the server is stopping: a build its process didn't finish isn't news, and nothing starts again. */
let stopping = false;

/** Stop every process that builds, at once, for good: the server is stopping. */
export function stopBuilders(): void {
	stopping = true;
	for (const builder of [...builders]) builder.stop();
}

/** What a build the server is stopping comes to: nothing, ever (it's ending). */
const never = () => new Promise<never>(() => {});

/** A process that builds one configuration of the site, as the server sees it. */
export class Builder {
	site!: SiteInfo;
	/** The configuration's files, as of the last build. */
	files = new Set<string>();
	/** What the plugins read for the last build. */
	read = new Set<string>();
	/** Other generators' words noted so far. */
	said: string[] = [];
	private args: string[];
	private child: ChildProcess | undefined;
	private waiting: ((message: FromBuilder | undefined) => void) | undefined;
	/** What each of the configuration's files held when it loaded (`State.loadedAs`). */
	private loadedAs: Record<string, string> = {};
	/** A process that's starting in place of one that ended, until it has loaded (or hasn't). */
	private starting: Promise<boolean> | undefined;
	/** What the site's code threw after a build had reported, ending its process: the next build's error. */
	private crashed: string | undefined;

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

	/** Whether a process with this configuration is there to build, or starting. */
	get alive(): boolean {
		return this.child !== undefined || this.starting !== undefined;
	}

	private async spawn(start: BuilderStart): Promise<boolean> {
		// The same program, started the same way: its own file, and the options Node was given.
		const child = fork(process.argv[1], [BUILDER, JSON.stringify(start), ...this.args], { stdio: ["inherit", "inherit", "inherit", "ipc"], execArgv: process.execArgv });
		this.child = child;
		builders.add(this);
		// What a process says once another has taken its place (or it was stopped) is nobody's business.
		const current = () => this.child === child;
		const lost = () => {
			this.child = undefined;
			builders.delete(this);
		};
		// Ended by the site's code, not stopped: another, before anything changes the files.
		const replace = () => {
			if (!stopping && this.site !== undefined) this.replace();
		};
		child.on("message", (message: FromBuilder) => {
			if (!current()) return;
			if (message.type !== "crashed") return this.waiting?.(message);
			// It's ending: the next build is another process's.
			this.crashed = message.error;
			lost();
			this.waiting?.(message);
			replace();
		});
		child.once("exit", () => {
			if (!current()) return;
			lost();
			this.waiting?.(undefined);
			replace();
		});
		child.once("error", () => {
			if (!current()) return;
			lost();
			this.waiting?.(undefined);
		});
		const message = await this.next();
		if (message?.type !== "loaded") {
			this.stop();
			return false;
		}
		this.site = message.site;
		this.note(message);
		return true;
	}

	/**
	 * Start a process in place of one that ended, when it would load the same configuration: the
	 * one that loaded last, whose files hold what they held then. Otherwise (they've changed
	 * since), the server reads them again for that change, and this has nothing to build with.
	 */
	private replace(): void {
		if (this.starting || !Object.entries(this.loadedAs).every(([file, hash]) => fileHash(file) === hash)) return;
		const starting = this.spawn({ reload: true, fallback: false, said: this.said });
		this.starting = starting;
		void starting.finally(() => {
			if (this.starting === starting) this.starting = undefined;
		});
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
		this.loadedAs = state.loadedAs;
		this.read = new Set(state.read);
		this.said = state.said;
	}

	/** Says a build failed, and why. */
	private failed(error: string): Built {
		process.stderr.write(`${diagnostics.red("Build failed:")} ${error}\n`);
		return { ok: false, error, assets: [] };
	}

	/** Build, and print the summary or the error. `recovered`: the last build failed, which the summary of one that works says. */
	async build(recovered: boolean): Promise<Built> {
		if (stopping) return never();
		if (this.starting) await this.starting;
		// The site's code threw after the last build had reported, which ended its process: this
		// build is where that's said, as 0.7 said it at the next build.
		if (this.crashed !== undefined) {
			const error = this.crashed;
			this.crashed = undefined;
			return this.failed(error);
		}
		// The process ended and none could start in its place (`replace`): try once more, with
		// the same configuration.
		if (!this.child) this.replace();
		if (this.starting) await this.starting;
		if (stopping) return never();
		if (!this.child) return { ok: false, error: "The configuration didn't load: its error is in the terminal.", assets: [] };
		const child = this.child;
		const answer = this.next();
		child.send({ type: "build", recovered } satisfies ToBuilder);
		const message = await answer;
		if (stopping) return never();
		if (message?.type === "crashed") {
			this.crashed = undefined;
			return this.failed(message.error);
		}
		if (message?.type !== "built") {
			const how = child.exitCode !== null ? `exit code ${child.exitCode}` : child.signalCode !== null ? `stopped by ${child.signalCode}` : "it stopped answering";
			return this.failed(`The build's process ended before the build did (${how}). What it said is in the terminal.`);
		}
		this.note(message);
		return { ok: message.ok, error: message.error, assets: message.assets };
	}

	stop(): void {
		const child = this.child;
		this.child = undefined;
		builders.delete(this);
		// SIGKILL: the process leaves the signals that end a server to the server.
		if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	}
}
