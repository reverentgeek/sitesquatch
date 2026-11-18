// Development server: static file server, file watcher and live reload.
//
// A change to the site's sources rebuilds it, and the browser reloads if the page it's showing
// came out different (a rebuild leaves identical pages alone). A changed stylesheet is swapped
// in place, without a reload. A CSS or JavaScript file that another tool writes into the output
// folder (a PostCSS or esbuild watcher, say) reaches the browser without a rebuild, so a page
// never reloads before its new CSS is there. A build that fails is shown over the page, until
// one works.
//
// The build itself runs in a process of its own (`builder.ts`), started again when the
// configuration changes.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Config } from "../config.ts";
import { dirsOf } from "../config.ts";
import * as diagnostics from "../diagnostics.ts";
import { BuildError, messageOf } from "../diagnostics.ts";
import { isInside, realPath, relative, slashes } from "../paths.ts";
import * as voice from "../voice.ts";
import { Builder, stopBuilders } from "./builder.ts";
import type { Built, SiteInfo } from "./builder.ts";
import * as companionProcesses from "./companions.ts";
import { Companions } from "./companions.ts";
import { handle, handleBuilt } from "./http.ts";
import { Live, assetStamps, fingerprint, isAsset, sameStamps } from "./live.ts";
import type { Written } from "./live.ts";
import { Channel, Watcher } from "./watch.ts";

/** How `ssqch serve` serves. */
export interface ServeOptions {
	/** The port to listen on; 0 picks a free one. */
	port: number;
	/**
	 * A file to write once the first build is done and the site is being served: JSON with the
	 * `url`, the `port`, the `output` folder, this process's `pid`, and `ok` (whether that build
	 * worked). A script waits for the file instead of reading the server's output. It's deleted
	 * at the start, and written again when a changed configuration loads.
	 */
	readyFile?: string;
	/** `--quiet` is the command line's, which a changed configuration doesn't change. */
	quiet: boolean;
}

/** What the HTTP server needs to know about the site, which a reloaded configuration can change. */
interface Served {
	output: string;
	base: string;
}

const exists = (file: string) => fs.existsSync(file);
const isFile = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
const isDir = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;
const say = (line: string) => { process.stdout.write(line + "\n"); };

/** Write the ready file in one step, so a reader never sees half of it. */
function writeReady(file: string, site: Served, port: number, ok: boolean): void {
	const ready = {
		schemaVersion: 1,
		url: `http://localhost:${port}${site.base}/`,
		port,
		base: site.base,
		output: realPath(site.output),
		pid: process.pid,
		ok,
	};
	const ext = path.extname(file);
	const partial = `${ext === "" ? file : file.slice(0, -ext.length)}.partial`;
	try { fs.writeFileSync(partial, JSON.stringify(ready, null, 2) + "\n"); } catch (e) { throw new BuildError(`--ready-file: writing ${partial}: ${messageOf(e)}`); }
	try { fs.renameSync(partial, file); } catch (e) { throw new BuildError(`--ready-file: writing ${file}: ${messageOf(e)}`); }
}

/** Start answering requests. Resolves with the port. */
function listen(port: number, answer: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
	const server = http.createServer((req, res) => {
		try {
			answer(req, res);
		} catch {
			// A request that can't be answered is dropped; the server goes on.
			if (res.headersSent) res.destroy();
			else res.writeHead(500, { "Content-Length": "0" }).end();
		}
	});
	// A request Node can't read (a space in its path): the status Node would send, with a length,
	// as 0.7 answered, so a client knows the answer is over.
	server.on("clientError", (e: NodeJS.ErrnoException, socket) => {
		if (e.code === "ECONNRESET" || !socket.writable) return socket.destroy();
		const status = e.code === "HPE_HEADER_OVERFLOW" ? "431 Request Header Fields Too Large" : e.code === "HPE_CHUNK_EXTENSIONS_OVERFLOW" ? "413 Payload Too Large" : "400 Bad Request";
		socket.end(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
	});
	return new Promise((resolve, reject) => {
		server.once("error", (e: NodeJS.ErrnoException) => {
			reject(new BuildError(e.code === "EADDRINUSE" ? `can't listen on port ${port}: something else is squatting on it (--port 0 picks a free one)` : `can't listen on port ${port}: ${e.message}`));
		});
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			resolve(typeof address === "object" && address !== null ? address.port : port);
		});
	});
}

/**
 * Serve the output folder as the last build left it, the way a host would (`ssqch serve
 * --built`, or `ssqch preview`): no build, no watching, no reload script or icon added to pages,
 * and text compressed with gzip when the browser takes it. For checking a production build
 * locally (Lighthouse, say) before deploying it. Runs until stopped.
 */
export async function serveBuilt(config: Config, options: ServeOptions): Promise<never> {
	const dirs = dirsOf(config);
	const site: Served = { output: dirs.output, base: config.base };
	const shown = isInside(dirs.root, site.output) ? relative(dirs.root, site.output) : slashes(site.output);
	if (!isDir(site.output)) throw new BuildError(`${shown} doesn't exist: build the site first (ssqch build), then serve it with ssqch serve --built`);
	if (options.readyFile !== undefined) fs.rmSync(options.readyFile, { force: true });
	const port = await listen(options.port, (req, res) => handleBuilt(req, res, site.output, site.base));
	if (options.readyFile !== undefined) writeReady(options.readyFile, site, port, true);
	const url = `http://localhost:${port}${site.base}/`;
	say(config.quiet ? url : `Serving ${shown} as built at ${url}. It stays as it is until the next ssqch build.`);
	return new Promise<never>(() => {});
}

/**
 * `Serving dist at http://localhost:8080/. Squatch Watch is on.`: the last line after every
 * build, so a long build's output doesn't bury the address. With `--quiet`, just the address,
 * after the first build.
 */
function banner(site: Served, port: number, quiet: boolean): string {
	// The output folder from where the command was run (`dist`), when it's below it.
	const here = realPath(process.cwd());
	const output = realPath(site.output);
	const shown = isInside(here, output) && output !== here ? relative(here, output) : site.output;
	const serving = `Serving ${shown} at http://localhost:${port}${site.base}/`;
	return quiet ? serving : `${serving}. ${voice.SQUATCH_WATCH}`;
}

/** Ends the run when ssqch is told to stop: the companions first (and what they started), and the process that builds. */
function stopWithTheServer(): void {
	let stopping = false;
	const stop = (signal: NodeJS.Signals) => {
		if (stopping) return;
		stopping = true;
		stopBuilders();
		void companionProcesses.stopAll().then(() => {
			// With companions to stop, ssqch ends itself, as 0.7 did; without, the signal does.
			if (companionProcesses.everStarted || process.platform === "win32") process.exit(130);
			process.removeAllListeners(signal);
			process.kill(process.pid, signal);
		});
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop(signal));
	// Any other way out (an error of the server's own): nothing is left running.
	process.on("exit", () => {
		stopBuilders();
		companionProcesses.stopAllNow();
	});
}

/**
 * Serve the site, reading the configuration again when one of the files it came from changes.
 * If the new configuration doesn't load, the error is printed and the last good one keeps
 * serving. `args` is the command line, for the process that builds. Returns only when the first
 * configuration doesn't load (its error is printed), with the exit code.
 */
export async function serve(args: string[], options: ServeOptions): Promise<number> {
	stopWithTheServer();
	const first = await Builder.start(args, { reload: false, said: diagnostics.aliasesUsed().map((row) => `${row.kind}:${row.word}`) });
	if (!first) return 1;
	const live = new Live();
	const site: Served = { output: first.site.output, base: first.site.base };
	if (options.readyFile !== undefined) {
		// One from an earlier run would say this server is ready already.
		try { fs.rmSync(options.readyFile); } catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new BuildError(`--ready-file: removing ${options.readyFile}: ${messageOf(e)}`);
		}
	}
	const { quiet } = options;
	try {
		const port = await listen(options.port, (req, res) => handle(req, res, site.output, live, site.base));
		return await serving(first, { args, options, live, site, port, quiet });
	} catch (e) {
		// Nothing is left running behind an error.
		stopBuilders();
		await companionProcesses.stopAll();
		throw e;
	}
}

async function serving(first: Builder, { args, options, live, site, port, quiet }: { args: string[]; options: ServeOptions; live: Live; site: Served; port: number; quiet: boolean }): Promise<never> {
	const sayWhere = () => say(banner(site, port, quiet));
	let builder = first;
	let companions = Companions.none();
	for (;;) {
		const info = builder.site;
		Object.assign(site, { output: info.output, base: info.base });
		// The configuration's companion processes, kept running across a reload that doesn't
		// change them (or their folders), and started again if one has stopped.
		const startedTools = !companions.runs(info, info.serveRun);
		if (startedTools) {
			await companions.stop();
			companions = Companions.none();
			companions = await Companions.start(info, info.serveRun);
		}
		live.setSite(companions.names(), info.outputName);
		const firstBuild = (ok: boolean) => {
			if (options.readyFile === undefined) return;
			try { writeReady(options.readyFile, site, port, ok); } catch (e) { process.stderr.write(`${diagnostics.red("error:")} ${messageOf(e)}\n`); }
		};
		// Stop `serve.run`'s tools and start them again, so they write their files into the output
		// again (a `--watch` tool writes when it starts, and then only when a source changes).
		const restart = async () => {
			if (!info.serveRun.length) return;
			// The old ones stop first, so two of a tool never write the same file.
			await companions.stop();
			companions = Companions.none();
			try { companions = await Companions.start(info, info.serveRun); } catch (e) { process.stderr.write(`${diagnostics.red("error:")} ${messageOf(e)}\n`); }
		};
		// Returns once a changed configuration has loaded.
		builder = await watch({ builder, live, args, quiet, startedTools, firstBuild, sayWhere, restart });
	}
}

/** How long the `serve.run` tools have to start writing after a rebuild, and how long the output has to stay quiet once they have. */
export const QUIET = 150;
/**
 * How long the tools have for their first compile when they've just started (`pnpm exec` and
 * `npx` take a moment before the tool runs). Tools that write no CSS or JavaScript at startup
 * hold the first build this long.
 */
const FIRST_COMPILE = 2000;
/** How much longer a tool that keeps writing can hold an update. */
const KEEPS_WRITING = 2000;

interface Watching {
	builder: Builder;
	live: Live;
	args: string[];
	quiet: boolean;
	/** The `serve.run` tools have just started (not kept across a reload), so the first build waits for their first compile. */
	startedTools: boolean;
	firstBuild: (ok: boolean) => void;
	/** Prints the site's address, after each build. */
	sayWhere: () => void;
	/** Starts `serve.run`'s tools again, when something else deleted what they wrote. */
	restart: () => Promise<void>;
}

/**
 * Build, then watch the site's sources and rebuild when they change. When a file the
 * configuration came from changes, it's read again by a new process: if it loads, this returns
 * that builder (the caller has a new configuration to watch with); if not, the watch goes on.
 */
async function watch({ builder, live, args, quiet, startedTools, firstBuild, sayWhere, restart }: Watching): Promise<Builder> {
	const site: SiteInfo = builder.site;
	const tools = live.tools.length > 0;
	if (tools && startedTools) await firstCompile(site.output, quiet);
	// What the build left, to tell a tool's write from the build's own: the output as it was,
	// with the files the build put there as it left them.
	const afterBuild = assetStamps(site.output);
	const report = await buildAndReport(builder, live);
	const ok = report.ok;
	for (const asset of report.assets) {
		const file = realPath(asset);
		const stat = fs.statSync(file, { throwIfNoEntry: false });
		if (stat) afterBuild.set(file, [stat.size, stat.mtimeMs]);
		else afterBuild.delete(file);
	}

	const rx = new Channel<string[]>();
	const watcher = new Watcher((file) => rx.send([file]));
	watcher.onError = (dir, e) => diagnostics.warn(diagnostics.warning("build", `can't watch ${dir}, or some of the folders beside it: ${messageOf(e)}. A change there won't be seen until the server starts again`));
	try {
		const watching = (dir: string, recursive: boolean) => {
			try { watcher.watch(dir, recursive); } catch (e) { throw new BuildError(`watching ${dir}: ${messageOf(e)}`); }
		};
		const watchPaths = site.watch.map(realPath);
		for (const target of watchPaths) {
			if (isDir(target)) watching(target, true);
			// Editors often replace a file when saving, which ends a watch on the file itself,
			// so its folder is watched (not what's below it).
			else if (exists(target)) watching(path.dirname(target), false);
		}
		// As the watcher reports paths: resolved, for an output that's a link or `../public`.
		const output = realPath(site.output);
		// The output too, for CSS and JavaScript other tools write there.
		const watchOutput = (must: boolean) => {
			if (!isDir(output) || watchPaths.some((p) => isInside(p, output))) return;
			try { watching(output, true); } catch (e) { if (must) throw e; }
		};
		watchOutput(true);
		// The configuration's own files that aren't in a watched folder (the config file in the
		// project root, the modules it imports). A build can add to them (a data file's imports),
		// so this runs after each one.
		const watchedFiles = new Set<string>();
		const watchConfigFiles = () => {
			// And what the plugins read for the last build that no watched folder holds (a
			// stylesheet's partial in a folder of its own).
			for (const file of [...builder.files, ...builder.read]) {
				if (isInside(output, file) || watchPaths.some((p) => isInside(p, file)) || watchedFiles.has(file)) continue;
				watchedFiles.add(file);
				try { watcher.watch(path.dirname(file), false); } catch { /* a folder that's gone */ }
			}
		};
		watchConfigFiles();
		// Changes seen while an update was held, for the loop to look at next.
		const carried: string[] = [];
		if (ok) {
			// What the tools write for the build (a Tailwind that scans the pages), so browsers get
			// the page and its CSS as one update, and the ready file means they're both there. What
			// a tool wrote before the watch began is in the output, and known from here (so it's
			// missed if something else deletes it).
			if (tools) await settle(rx, output, afterBuild, QUIET, carried);
			await publish(site, live);
		}
		firstBuild(ok);
		sayWhere();
		// What each changed source held the last time it was seen.
		const contents = new Map<string, string | undefined>();
		const show = (file: string) => (isInside(site.root, file) && file !== site.root ? path.relative(site.root, file) : file);
		// What a build writes for itself (`.cache`, in a site whose input folder is the project
		// root) isn't a change to the site: rebuilding for it would never end.
		const own = (file: string) => isInside(site.root, file) && path.relative(site.root, file).split(path.sep).some((part) => part === ".cache" || part === ".git" || part === "node_modules");
		for (;;) {
			const paths = carried.length ? carried.splice(0) : await rx.recv();
			// Debounce bursts of events (editors often write several times), for a second at most:
			// a folder that's written to all the time mustn't hold a rebuild back forever.
			const burst = performance.now();
			while (performance.now() - burst < 1000) {
				const more = await rx.recvTimeout(120);
				if (!more) break;
				paths.push(...more);
			}
			const changed = paths.map(realPath).filter((file) => !own(file));
			const outputs = changed.filter((file) => isInside(output, file));
			// A source written again with the same contents hasn't changed: a `beforeBuild` command
			// that writes into the input folder on every build would rebuild forever.
			const sources = changed.filter((file) => !isInside(output, file)).filter((file) => {
				const now = fingerprint(file);
				const seen = contents.has(file);
				const before = contents.get(file);
				contents.set(file, now);
				return !seen || before !== now;
			});
			const isConfig = (file: string) => builder.files.has(file);
			// Folders watched for a config file see their other files change too.
			const inSources = (file: string) => watchPaths.some((p) => isInside(p, file)) || isConfig(file) || builder.read.has(file);
			const config = sources.find(isConfig);
			const source = config === undefined ? sources.find(inSources) : undefined;
			if (config !== undefined) {
				if (!quiet) say(`${voice.FRESH_TRACKS} ${show(config)} (reading the configuration again)`);
				const next = await Builder.start(args, { reload: true, fallback: builder.alive, said: builder.said });
				if (next) {
					builder.stop();
					return next;
				}
			} else if (source !== undefined) {
				if (!quiet) say(`${voice.FRESH_TRACKS} ${show(source)}`);
				// The tools watch the same sources, and write what this edit changes for them (new
				// classes, say) a moment later: the update waits for that, so it's one.
				await runBuild(builder, live, async () => {
					if (tools) await settle(rx, output, assetStamps(output), QUIET, carried);
				});
				if (!quiet) sayWhere();
				watchConfigFiles();
			} else if (outputs.some((file) => isAsset(file) || !exists(file))) {
				// Another tool (PostCSS, esbuild) wrote a stylesheet or a script, or ssqch's own
				// write is late to arrive: the contents say which, so a tool's write that landed
				// during a build isn't missed.
				const differs = await live.changed(site.output);
				let gone = differs.filter((file) => isAsset(file) && !exists(path.join(site.output, file)));
				// Still gone once the output is quiet: not a tool that deletes a file before it
				// writes the new one (which is then seen like any of its writes).
				if (gone.length && await quietNow(rx)) {
					gone = gone.filter((file) => !exists(path.join(site.output, file)));
					if (!gone.length) await live.changed(site.output);
				}
				if (gone.length) {
					// ssqch serve deletes no stylesheets or scripts, and the tools that write them
					// don't either: something else did, like a production build into the same
					// folder (which cleans it, and renames them to fingerprinted names). A tool's
					// `--watch` only writes when a source changes, so they'd stay gone.
					const names = live.tools;
					const shown = gone.slice(0, 3).map((file) => show(path.join(site.output, file)));
					const more = gone.length > 3 ? ` and ${gone.length - 3} more` : "";
					const then = names.length === 0 ? "Rebuilding" : names.length === 1 ? `Starting serve.run's ${names[0]} again and rebuilding` : `Starting serve.run's ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} again and rebuilding`;
					say(`${voice.CAMPSITE_DISTURBED} ${shown.join(", ")}${more} deleted by something other than ssqch serve (another build into ${site.outputName}?). ${then}.`);
					await recover(rx, gone.map((file) => path.join(site.output, file)), restart);
					// A folder that was deleted and made again isn't watched any more.
					watcher.unwatch(output);
					watchOutput(false);
					await runBuild(builder, live, async () => {});
					sayWhere();
				} else {
					const file = differs.find(isAsset);
					// A stylesheet is swapped in place; a script reloads the page.
					if (file !== undefined && !quiet) say(`${voice.FRESH_TRACKS} ${show(path.join(site.output, file))} (${differs.every((f) => f.endsWith(".css")) ? "swapping it in" : "reloading"})`);
				}
			}
		}
	} finally {
		watcher.close();
	}
}

/**
 * Wait until nothing has changed for two seconds (a minute at most), so a build that's writing
 * to the output has finished. Whether it went quiet. What changed meanwhile is rebuilt for by
 * the caller, or seen by its contents.
 */
async function quietNow(rx: Channel<string[]>): Promise<boolean> {
	const started = performance.now();
	while (performance.now() - started < 60_000) {
		if (!(await rx.recvTimeout(2000))) return true;
	}
	return false;
}

/**
 * After something else deleted `gone` from the output: start the `serve.run` tools again and
 * give them up to 15 seconds to write `gone` again. A page built before then would link a
 * fingerprinted copy a production build left.
 */
async function recover(rx: Channel<string[]>, gone: string[], restart: () => Promise<void>): Promise<void> {
	await restart();
	const started = performance.now();
	while (performance.now() - started < 15_000 && !gone.every(isFile)) await sleep(100);
	// What the tools wrote meanwhile is told apart from the build's own writes by contents, like
	// any of their writes; the events themselves aren't news.
	rx.drain();
}

/**
 * Build, print the summary (or the error), and tell the browsers. `hold` runs between a build
 * that worked and telling them, to wait for what the `serve.run` tools write (`settle`).
 */
async function runBuild(builder: Builder, live: Live, hold: () => Promise<void>): Promise<boolean> {
	const { ok } = await buildAndReport(builder, live);
	if (ok) {
		await hold();
		await publish(builder.site, live);
	}
	return ok;
}

/** Build and print the summary, or the error (which browsers are told at once). */
async function buildAndReport(builder: Builder, live: Live): Promise<Built> {
	const built = await builder.build(live.error !== null);
	if (!built.ok) live.failed(built.error ?? "");
	return built;
}

/** After a build that worked: tell the browsers what changed in the output. */
async function publish(site: SiteInfo, live: Live): Promise<void> {
	live.repeatMissing(site.output);
	await live.changed(site.output);
}

/**
 * Wait for the `serve.run` tools' first compile, so the first build finds their files (a page
 * links `/assets/index.css`, not the fingerprinted copy a production build left) and the first
 * page served has its CSS: until a stylesheet or script in `output` changes, for
 * `FIRST_COMPILE` at most, and then until they stay the same for `QUIET`. A watcher writes when
 * it starts, even the contents that are there already.
 */
async function firstCompile(output: string, quiet: boolean): Promise<void> {
	const started = performance.now();
	let last = assetStamps(output);
	let wroteAt: number | undefined;
	while (performance.now() - started < FIRST_COMPILE + KEEPS_WRITING) {
		await sleep(40);
		const now = assetStamps(output);
		if (!sameStamps(now, last)) {
			last = now;
			wroteAt = performance.now();
		} else if (wroteAt !== undefined) {
			if (performance.now() - wroteAt >= QUIET) return;
		} else if (performance.now() - started >= FIRST_COMPILE) {
			if (!quiet) diagnostics.progress(`[ssqch] serve.run's tools wrote no CSS or JavaScript in ${FIRST_COMPILE / 1000} s; building without it`);
			return;
		}
	}
}

/**
 * Hold an update until the `serve.run` tools have written what they write for it: until a
 * stylesheet or script in `output` (resolved) differs from `before`, for `first` at most, and
 * then until the output has been quiet for `QUIET` (`KEEPS_WRITING` more at most). Then browsers
 * hear about the page and its new CSS at once, instead of the page first and its CSS a moment
 * later. Other changes seen meanwhile go in `carried`.
 */
export async function settle(rx: Channel<string[]>, output: string, before: Map<string, Written>, first: number, carried: string[]): Promise<void> {
	const started = performance.now();
	const cap = started + first + KEEPS_WRITING;
	// A tool may have written already, between the build and now.
	let wrote = !sameStamps(assetStamps(output), before);
	let until = wrote ? started + QUIET : started + first;
	for (;;) {
		const left = Math.min(until, cap) - performance.now();
		if (left <= 0) return;
		const paths = await rx.recvTimeout(left);
		if (!paths) return;
		for (const given of paths) {
			const file = realPath(given);
			if (!isInside(output, file)) {
				carried.push(file);
				continue;
			}
			if (!isAsset(file)) continue;
			// The build's own copy of a script (a passthrough file) reports a write too.
			const stat = fs.statSync(file, { throwIfNoEntry: false });
			const was = before.get(file);
			const same = stat === undefined ? was === undefined : was !== undefined && was[0] === stat.size && was[1] === stat.mtimeMs;
			if (wrote || !same) {
				wrote = true;
				until = performance.now() + QUIET;
			}
		}
	}
}
