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
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Config } from "../config.ts";
import { CONFIG_FILES, dirsOf } from "../dirs.ts";
import * as diagnostics from "../diagnostics.ts";
import { BuildError, messageOf } from "../diagnostics.ts";
import { compareText, isInside, realPath, relative, slashes } from "../paths.ts";
import * as voice from "../voice.ts";
import { Builder, stopBuilders } from "./builder.ts";
import type { Built, SiteInfo } from "./builder.ts";
import * as companionProcesses from "./companions.ts";
import { Companions } from "./companions.ts";
import { handle, handleBuilt } from "./http.ts";
import { Live, assetStamps, fingerprint, isAsset, sameStamps } from "./live.ts";
import type { Written } from "./live.ts";
import { Channel, Watcher, chooseStrategy } from "./watch.ts";
import { checkFolder, compareOutputs, ownFiles, verdict } from "./check.ts";
import { record, timing } from "./timeline.ts";
import { globSet } from "../glob.ts";

/** How `ssqch serve` serves. */
export interface ServeOptions {
	/** The port to listen on; 0 picks a free one. */
	port: number;
	/** The address to listen on: `127.0.0.1` (the default), `0.0.0.0` for every network, or one of the machine's. */
	host?: string;
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
/** What a config file in the project root can be called: a change to one reads the configuration again, whether or not one loaded. */
const CONFIG_NAMES = new Set([...CONFIG_FILES, "sitesquatch.toml"]);

/**
 * What a changed source holds, to tell a change from a write of the same thing: a file's
 * contents, a folder's names, or nothing for what's gone. A folder isn't nothing: one renamed
 * away and back again (`git stash`, an editor's undo) was gone between, and is a change each time
 * (0.7 counted every folder the same, so the second rename didn't rebuild).
 */
/**
 * An editor's or a tool's file of its own beside the one being edited, which says nothing about
 * the site: BSD and macOS `sed -i` (`.!64277!hello.md`, which an agent's edits make all the time),
 * backups (`hello.md~`), Emacs' locks (`.#hello.md`), Vim's swap files (`.hello.md.swp`) and the
 * file it writes to see whether it can (`4913`), and JetBrains' safe writes (`hello.md___jb_tmp___`).
 * A rebuild for one changed no pages and named the wrong file (a11y #20, the new-blog run).
 */
export function editorsOwn(file: string): boolean {
	const name = path.basename(file);
	return /^\.![0-9]+!/.test(name) || /^\.subl\w*\.tmp$/.test(name) || name.endsWith("~") || name.startsWith(".#") || /^\..+\.sw[a-p]$/.test(name) || name === "4913" || /___jb_(?:tmp|old|bak)___$/.test(name);
}

function sourceState(file: string): string | undefined {
	if (!isDir(file)) return fingerprint(file);
	try { return `folder:${crypto.hash("sha1", fs.readdirSync(file).sort().join("\n"), "base64")}`; } catch { return undefined; }
}

/** What to do when the system has no watches left: what it's called, and polling, which needs none. */
export function outOfWatches(e: unknown): string {
	const code = (e as NodeJS.ErrnoException | undefined)?.code;
	if (code === "ENOSPC") return ". Linux ran out of file watches: raise fs.inotify.max_user_watches (sudo sysctl fs.inotify.max_user_watches=524288), or set SSQCH_WATCH=poll, which needs none";
	if (code === "EMFILE") return ". The system ran out of open files: raise the limit (ulimit -n 65536), or set SSQCH_WATCH=poll, which needs none";
	return "";
}

/** Rebuilds in a row with no write from `serve.run`'s tools, after which they aren't waited for. */
const TOOLS_LEARN = 3;
/** The quiet that ends a burst of changes, in ms. */
export const DEBOUNCE_MS = 50;
/** How much longer a burst waits when a file it names is gone, for a save that's half done. */
const GONE_MS = 200;

const LOOPBACK = "127.0.0.1";

/** Whether `host` answers only this machine. */
const loopbackOnly = (host: string) => host === LOOPBACK || host === "localhost" || host === "::1";

/** Every address this machine (IPv4) has on a network, for the URLs a phone can open: with `0.0.0.0`, all of them; otherwise the one given. */
function networkAddresses(host: string): string[] {
	if (loopbackOnly(host)) return [];
	if (host !== "0.0.0.0" && host !== "::") return [host];
	const found: string[] = [];
	for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) found.push(a.address);
	return [...new Set(found)].sort(compareText);
}

/** A host as a URL has it: an IPv6 address in brackets (`[::1]`), which a URL needs to tell its colons from the port's (the 2026-11-24 review). */
const urlHost = (host: string) => (host.includes(":") && !host.startsWith("[") ? `[${host}]` : host);

/** Where a browser on this machine reaches the server: `localhost`, unless it listens on one other address only. */
const localUrl = (host: string, port: number, base: string) => `http://${loopbackOnly(host) || host === "0.0.0.0" || host === "::" ? "localhost" : urlHost(host)}:${port}${base}/`;

/** The line after the address when the site can be seen from other machines: where, and that anyone on the network can. */
function onTheNetwork(host: string, port: number, base: string): string {
	const addresses = networkAddresses(host).filter((a) => a !== host || (host !== "0.0.0.0" && host !== "::"));
	if (!addresses.length) return host === "0.0.0.0" || host === "::" ? "\nOn your network: no network address found (is this machine on one?)" : "";
	const urls = addresses.map((a) => `http://${urlHost(a)}:${port}${base}/`);
	return `\nOn your network: ${urls.join(", ")} (anyone on it can see the site)`;
}

/** Write the ready file in one step, so a reader never sees half of it. */
function writeReady(file: string, site: Served, port: number, ok: boolean, host = LOOPBACK): void {
	const ready = {
		schemaVersion: 1,
		url: localUrl(host, port, site.base),
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
function listen(port: number, answer: (req: http.IncomingMessage, res: http.ServerResponse) => void, host = LOOPBACK): Promise<number> {
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
			reject(new BuildError(e.code === "EADDRINUSE" ? `can't listen on port ${port}: something else is squatting on it (--port 0 picks a free one)` : e.code === "EADDRNOTAVAIL" ? `can't listen on ${host}: it isn't one of this machine's addresses (0.0.0.0 listens on all of them)` : `can't listen on port ${port}: ${e.message}`));
		});
		server.listen(port, host, () => {
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
	const host = options.host ?? LOOPBACK;
	const port = await listen(options.port, (req, res) => handleBuilt(req, res, site.output, site.base), host);
	if (options.readyFile !== undefined) writeReady(options.readyFile, site, port, true, host);
	const url = localUrl(host, port, site.base);
	say((config.quiet ? url : `Serving ${shown} as built at ${url}. It stays as it is until the next ssqch build.`) + onTheNetwork(host, port, site.base));
	return new Promise<never>(() => {});
}

/**
 * `Serving dist at http://localhost:8080/. Squatch Watch is on.`: the last line after every
 * build, so a long build's output doesn't bury the address. With `--quiet`, just the address,
 * after the first build.
 */
function banner(site: Served, port: number, quiet: boolean, host = LOOPBACK): string {
	// The output folder from where the command was run (`dist`), when it's below it.
	const here = realPath(process.cwd());
	const output = realPath(site.output);
	const shown = isInside(here, output) && output !== here ? relative(here, output) : site.output;
	const serving = `Serving ${shown} at ${localUrl(host, port, site.base)}`;
	return (quiet ? serving : `${serving}. ${voice.SQUATCH_WATCH}`) + onTheNetwork(host, port, site.base);
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
		const port = await listen(options.port, (req, res) => handle(req, res, site.output, live, site.base), options.host ?? LOOPBACK);
		return await serving(first, { args, options, live, site, port, quiet });
	} catch (e) {
		// Nothing is left running behind an error.
		stopBuilders();
		await companionProcesses.stopAll();
		throw e;
	}
}

async function serving(first: Builder, { args, options, live, site, port, quiet }: { args: string[]; options: ServeOptions; live: Live; site: Served; port: number; quiet: boolean }): Promise<never> {
	const sayWhere = () => say(banner(site, port, quiet, options.host ?? LOOPBACK));
	let builder = first;
	let companions = Companions.none();
	for (;;) {
		const info = { ...builder.site, quiet };
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
		if (startedTools && info.serveRun.length > 0) {
			const started = companions;
			live.startFirstCompile(info.output, FIRST_COMPILE_GRACE, () => started.anyRunning());
		}
		const firstBuild = (ok: boolean) => {
			if (options.readyFile === undefined) return;
			try { writeReady(options.readyFile, site, port, ok, options.host ?? LOOPBACK); } catch (e) { process.stderr.write(`${diagnostics.red("error:")} ${messageOf(e)}\n`); }
		};
		// Stop `serve.run`'s tools and start them again, so they write their files into the output
		// again (a `--watch` tool writes when it starts, and then only when a source changes).
		const restart = async () => {
			if (!info.serveRun.length) return;
			// The old ones stop first, so two of a tool never write the same file.
			await companions.stop();
			companions = Companions.none();
			try { companions = await Companions.start(info, info.serveRun); } catch (e) { process.stderr.write(`${diagnostics.red("error:")} ${messageOf(e)}\n`); }
			const started = companions;
			live.startFirstCompile(info.output, FIRST_COMPILE_GRACE, () => started.anyRunning());
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
/** How long a missing stylesheet or script is taken for one the `serve.run` tools are still compiling, before it's warned about. */
const FIRST_COMPILE_GRACE = 30_000;
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
	const rx = new Channel<string[]>();
	// Polling where the system sends no events (a Windows drive under WSL), said once.
	const how = chooseStrategy([site.root, ...site.watch].map(realPath));
	if (how.unknown !== undefined) diagnostics.warn(diagnostics.warning("build", `SSQCH_WATCH=${how.unknown} isn't a way to watch: use poll, or events (the system's own, the default)`));
	if (how.why !== undefined && !quiet) say(`Watching by looking at every file now and then (${how.why}): a change shows a moment later than with the system's events. SSQCH_WATCH=events turns it off.`);
	// When the first change of the next rebuild was heard (`SSQCH_SERVE_TIMELINE`).
	let heard: number | undefined;
	const watcher = new Watcher((file) => {
		if (timing) heard ??= Date.now();
		rx.send([file]);
	}, how.strategy);
	watcher.onError = (dir, e) => diagnostics.warn(diagnostics.warning("build", `can't watch ${dir}, or some of the folders beside it: ${messageOf(e)}. A change there won't be seen until the server starts again${outOfWatches(e)}`));
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
		// The output may not be there before the first build: it's watched again after it.
		watchOutput(false);
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
		// The project root's own files, for a config file that isn't there now: one that's put
		// back (or made) is read, where the defaults were building (0.7 missed it).
		const root = realPath(site.root);
		if (!watchPaths.some((p) => isInside(p, root))) {
			try { watcher.watch(root, false); } catch { /* the root's gone: nothing builds anyway */ }
		}
		// The watch begins before the first build, so an edit made while it runs is seen: one made
		// after the build read the page and before the watch began was missed, and the server went
		// on serving the old page (a11y #21: an agent that edits as soon as a page answers).
		// What the build itself writes while it's watched is told apart as after a rebuild: the
		// output's files by their contents, and sources by whether they've changed.
		const built = async () => {
			if (tools && startedTools) await firstCompile(site.output, quiet);
			// What the build left, to tell a tool's write from the build's own: the output as it was,
			// with the files the build put there as it left them.
			const stamps = assetStamps(site.output);
			const report = await buildAndReport(builder, live);
			for (const asset of report.assets) {
				const file = realPath(asset);
				const stat = fs.statSync(file, { throwIfNoEntry: false });
				if (stat) stamps.set(file, [stat.size, stat.mtimeMs]);
				else stamps.delete(file);
			}
			return [report.ok, stamps] as const;
		};
		const [ok, afterBuild] = await built();
		watchOutput(true);
		watchConfigFiles();
		// A config saved after this process loaded it and before the watch began (a reload loads
		// it before this runs) was heard by no watcher: it's a change all the same, so the loop
		// below reads the configuration again (CI's `serve_restarts_companions_on_reload`).
		const savedMeanwhile = builder.changedSinceLoad();
		if (savedMeanwhile !== undefined) rx.send([savedMeanwhile]);
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
		// Rebuilds in a row after which no `serve.run` tool wrote anything.
		let quietRebuilds = 0;
		// From the site's root, for a watched file outside it too (`../docs/guide.md`), as the
		// files inside are named; absolute only when there's no way there (another drive).
		const show = (file: string) => {
			if (file === site.root) return file;
			const rel = path.relative(site.root, file);
			return path.isAbsolute(rel) ? file : rel;
		};
		// What a build writes for itself (`.cache`, in a site whose input folder is the project
		// root) isn't a change to the site: rebuilding for it would never end.
		const own = (file: string) => isInside(site.root, file) && path.relative(site.root, file).split(path.sep).some((part) => part === ".cache" || part === ".git" || part === "node_modules");
		const isConfig = (file: string) => builder.files.has(file) || (path.dirname(file) === root && CONFIG_NAMES.has(path.basename(file)));
		// `serve.ignore`: files only a `serve.run` tool reads (PostCSS's sources), which a rebuild
		// would do nothing for (v8 #18). Never the config or its modules, and never a file the last
		// build said it read (a Sass partial): ignoring that would leave a page stale with no word,
		// so it rebuilds and says why, once a file.
		const globs = globSet("serve.ignore", site.serveIgnore);
		// A folder a glob names covers what's in it (`src/_css`), and a folder whose contents a
		// glob covers (`src/_css/**`) is covered itself: Windows reports the folder when a file in
		// it changes, which rebuilt for the file all the same.
		const ignored = (rel: string) => {
			if (globs(rel) || globs(`${rel}/`)) return true;
			for (let at = rel.lastIndexOf("/"); at > 0; at = rel.lastIndexOf("/", at - 1)) if (globs(rel.slice(0, at))) return true;
			return false;
		};
		const readAnyway = new Set<string>();
		const skipped = (file: string) => {
			if (isInside(output, file) || !isInside(root, file) || !ignored(relative(root, file)) || isConfig(file)) return false;
			if (!builder.read.has(file)) return true;
			if (!readAnyway.has(file)) {
				readAnyway.add(file);
				diagnostics.warn(diagnostics.warning("build", `serve.ignore lists ${show(file)}, but the last build read it, so a change to it rebuilds the site all the same. Take it out of serve.ignore, or the glob that matches it`));
			}
			return false;
		};
		for (;;) {
			// What a tool wrote during the last rebuild was heard and read while it was held: with
			// nothing waiting, the next change is the first one since.
			if (!carried.length && !rx.peek().length) heard = undefined;
			const paths = carried.length ? carried.splice(0) : await rx.recv();
			const heardAt = heard ?? Date.now();
			// Debounce bursts of events (editors often write several times), for a second at most:
			// a folder that's written to all the time mustn't hold a rebuild back forever. 50 ms of
			// quiet ends one: it was 120, which every edit waited for. A save whose source is gone
			// at that point may be half done (Vim renames the file away for its backup, and writes it
			// again 40 to 50 ms later), so it waits up to 200 ms more for it to come back, rather than
			// rebuild without the page and put it back a moment later.
			const burst = performance.now();
			let waitedForGone = false;
			while (performance.now() - burst < 1000) {
				let more = await rx.recvTimeout(DEBOUNCE_MS);
				if (!more && !waitedForGone && paths.some((file) => !own(file) && !editorsOwn(file) && !isInside(output, file) && !exists(file))) {
					waitedForGone = true;
					more = await rx.recvTimeout(GONE_MS);
				}
				if (!more) break;
				paths.push(...more);
			}
			const debounced = Date.now();
			heard = undefined;
			const changed = paths.map(realPath).filter((file) => !own(file) && !editorsOwn(file) && !skipped(file));
			const outputs = changed.filter((file) => isInside(output, file));
			// A source written again with the same contents hasn't changed: a `beforeBuild` command
			// that writes into the input folder on every build would rebuild forever.
			const sources = changed.filter((file) => !isInside(output, file)).filter((file) => {
				const now = sourceState(file);
				const seen = contents.has(file);
				const before = contents.get(file);
				contents.set(file, now);
				// The configuration's files by what the last build used of them, which a hook may
				// have written while it ran.
				if (isConfig(file) && builder.usedAsIs(file)) return false;
				return !seen || before !== now;
			});
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
				const asked = Date.now();
				// The tools watch the same sources, and write what this edit changes for them (new
				// classes, say) a moment later: the update waits for that, so it's one.
				// A tool that hasn't written after the last few rebuilds (PostCSS, which watches only its
				// CSS) isn't waited for: v8.dev waited 150 ms after every page edit for a write that
				// never came. The first write it makes after one starts the waiting again.
				const marks = await runBuild(builder, live, async () => {
					if (!tools) return;
					const wrote = await settle(rx, output, assetStamps(output), quietRebuilds >= TOOLS_LEARN ? 0 : QUIET, carried);
					quietRebuilds = wrote ? 0 : quietRebuilds + 1;
				}, sources);
				if (!quiet) sayWhere();
				record({ kind: "rebuild", file: show(source), heard: heardAt, debounced, asked, ...marks, said: Date.now() });
				watchConfigFiles();
				if (CHECKING && marks.ok) await checkRebuild({ args, builder, rx, carried, tools, changed: show(source), moved: (file) => !own(file) && !editorsOwn(file) && !skipped(file) && !isInside(output, file) && inSources(file) && sourceState(file) !== contents.get(file), show });
			} else if (outputs.some((file) => isAsset(file) || !exists(file))) {
				// Another tool (PostCSS, esbuild) wrote a stylesheet or a script, or ssqch's own
				// write is late to arrive: the contents say which, so a tool's write that landed
				// during a build isn't missed.
				const differs = await live.changed(site.output);
				// A tool that writes after a rebuild is waited for again from the next one.
				if (differs.some(isAsset)) quietRebuilds = 0;
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
async function runBuild(builder: Builder, live: Live, hold: () => Promise<void>, changed?: string[]): Promise<{ ok: boolean; built: number; held: number; published: number; builder?: Built["times"] }> {
	const { ok, times } = await buildAndReport(builder, live, changed);
	const built = Date.now();
	let held = built;
	if (ok) {
		await hold();
		held = Date.now();
		await publish(builder.site, live);
	}
	return { ok, built, held, published: Date.now(), ...(times ? { builder: times } : {}) };
}

/** `SSQCH_CHECK_REBUILDS=1`: check each rebuild against a clean build (`check.ts`). */
const CHECKING = process.env.SSQCH_CHECK_REBUILDS === "1";

/**
 * After a rebuild that worked: build the same files again in a new process, into
 * `.cache/ssqch/check-rebuilds/`, and say whether the rebuild wrote the same. A change heard
 * meanwhile (other than the check's own files) means the two didn't build the same files, so
 * nothing is said but that.
 */
async function checkRebuild({ args, builder, rx, carried, tools, changed, moved, show }: { args: string[]; builder: Builder; rx: Channel<string[]>; carried: string[]; tools: boolean; changed: string; moved: (file: string) => boolean; show: (file: string) => string }): Promise<void> {
	const site = builder.site;
	const dir = checkFolder(site.root);
	const started = Date.now();
	fs.rmSync(dir, { recursive: true, force: true });
	const checker = await Builder.start(args, { reload: true, fallback: true, said: builder.said, check: dir });
	if (!checker) {
		say("check-rebuilds: the configuration didn't load for the clean build (its error is above)");
		return;
	}
	let built: Built;
	try { built = await checker.build(false); } finally { checker.stop(); }
	// By the loop's own rule: a source the next rebuild would be for (its contents differ from
	// what the loop last saw), not any event (a save of the same text, a log in the project root).
	const meanwhile = [...carried, ...rx.peek().flat()].map(realPath).find(moved);
	let line: string;
	let found: ReturnType<typeof compareOutputs> | undefined;
	if (!built.ok) line = `check-rebuilds: the clean build after ${changed} failed where the rebuild worked: ${built.error ?? "its error is above"}`;
	else if (meanwhile !== undefined) line = `check-rebuilds: ${show(meanwhile)} changed while the clean build ran, so the two didn't build the same files; not judged`;
	else {
		found = compareOutputs(site.output, dir, tools ? ownFiles(site.root, site.outputName) : undefined);
		line = verdict(found, changed, site.outputName);
	}
	say(line);
	record({ kind: "check", file: changed, started, finished: Date.now(), verdict: line, ...(found ?? {}) });
}

/** Build and print the summary, or the error (which browsers are told at once). */
async function buildAndReport(builder: Builder, live: Live, changed?: string[]): Promise<Built> {
	const built = await builder.build(live.error !== null, changed);
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
			if (!quiet) diagnostics.progress(`[ssqch] serve.run's tools wrote no CSS or JavaScript in ${FIRST_COMPILE / 1000} s; building now, and what they write goes in when it's ready`);
			return;
		}
	}
}

/**
 * Hold an update until the `serve.run` tools have written what they write for it: until a
 * stylesheet or script in `output` (resolved) differs from `before`, for `first` at most, and
 * then until the output has been quiet for `QUIET` (`KEEPS_WRITING` more at most). Then browsers
 * hear about the page and its new CSS at once, instead of the page first and its CSS a moment
 * later. Other changes seen meanwhile go in `carried`. Answers whether a tool wrote.
 */
export async function settle(rx: Channel<string[]>, output: string, before: Map<string, Written>, first: number, carried: string[]): Promise<boolean> {
	const started = performance.now();
	const cap = started + first + KEEPS_WRITING;
	// A tool may have written already, between the build and now.
	let wrote = !sameStamps(assetStamps(output), before);
	let until = wrote ? started + QUIET : started + first;
	for (;;) {
		const left = Math.min(until, cap) - performance.now();
		if (left <= 0) return wrote;
		const paths = await rx.recvTimeout(left);
		if (!paths) return wrote;
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
