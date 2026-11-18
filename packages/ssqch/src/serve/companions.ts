// Companion processes: the programs `serve.run` lists, which `ssqch serve` starts with the
// server and stops with it. They're for tools that watch and write files of their own, like
// PostCSS, Tailwind or esbuild with `--watch`, so one command serves a site that has its own CSS
// and JavaScript tools.
//
// Each runs through the shell in the project root, with the same `SSQCH_*` variables as a
// `beforeBuild` command, in a process group of its own (a process tree on Windows), so stopping
// it also stops what it started (`npx` starts the tool as another process). Each line it prints
// is shown with the tool's name in front: `[postcss] Finished in 120 ms`.
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { commandLine } from "../command-line.ts";
import { BuildError, progress } from "../diagnostics.ts";

/** What a companion is given: its folder and its `SSQCH_*` variables. */
export interface CompanionContext {
	root: string;
	env: string;
	input: string;
	output: string;
}

interface Running {
	child: ChildProcess;
	stopping: boolean;
	/** Set when the process exits, so the next reload starts it again. */
	exited: boolean;
}

/** Every companion running now, for when ssqch is told to stop. */
const running = new Set<Running>();
/** Set when ssqch is stopping, so a companion stopping with it isn't news. */
let shuttingDown = false;
/** Whether any companion was ever started: stopping them is then ssqch's to do before it ends. */
export let everStarted = false;

const environment = (ctx: CompanionContext) => [ctx.root, ctx.env, ctx.input, ctx.output];

/** The companions of one configuration. */
export class Companions {
	private commands: string[];
	/** What they were started with (root, env, input and output folders), so a reload that changes those starts them again. */
	private startedWith: string[];
	private running: Running[] = [];

	private constructor(commands: string[], startedWith: string[]) {
		this.commands = commands;
		this.startedWith = startedWith;
	}

	/** No companions. */
	static none(): Companions {
		return new Companions([], []);
	}

	/** Start `commands`. One that can't start is an error naming it (the ones before it are stopped again). */
	static async start(ctx: CompanionContext, commands: string[]): Promise<Companions> {
		const companions = new Companions([...commands], environment(ctx));
		for (const command of commands) {
			const name = toolName(command);
			progress(`[ssqch] serve.run: ${command}`);
			const { file, args, options } = commandLine(command, ctx.root, { SSQCH_ENV: ctx.env, SSQCH_SERVING: "true", SSQCH_INPUT: ctx.input, SSQCH_OUTPUT: ctx.output });
			const one: Running = { child: undefined as unknown as ChildProcess, stopping: false, exited: false };
			try {
				// Standard input is held open: Tailwind's and esbuild's `--watch` stop when theirs
				// closes, which a null one does at once. A process group of its own, so stopping it
				// stops what it started: on Linux and macOS Node makes one only with a session of its
				// own too, where 0.7 kept it in ssqch's (so it has no terminal), and on Windows not
				// at all without a console of its own too (each program a tool starts would open a
				// window), so it shares ssqch's and its group, and a tree is stopped with taskkill.
				one.child = spawn(file, args, { ...options, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
				await new Promise<void>((resolve, reject) => { one.child.once("spawn", resolve); one.child.once("error", reject); });
			} catch (e) {
				await companions.stop();
				throw new BuildError(`serve.run: couldn't run \`${command}\`: ${e instanceof Error ? e.message : String(e)}`);
			}
			everStarted = true;
			running.add(one);
			companions.running.push(one);
			const { child } = one;
			child.stdin?.on("error", () => { /* the tool closed it */ });
			const shown = [relay(child.stdout, name, false), relay(child.stderr, name, true)];
			child.on("error", () => { /* said when it exits */ });
			child.once("exit", (code, signal) => {
				one.exited = true;
				running.delete(one);
				if (one.stopping || shuttingDown) return;
				const how = code === 0 ? "finished" : code !== null ? `exited with status ${code}` : signal ? "was stopped" : "couldn't be waited for";
				// After its last lines, which may still be on their way (but not waiting for a
				// program it left running, which holds them open).
				void Promise.race([Promise.all(shown), sleep(250, undefined, { ref: false })]).then(() => {
					process.stderr.write(`warn: serve.run: \`${command}\` ${how}. The server keeps going without it; save the config file to start it again.\n`);
				});
			});
		}
		return companions;
	}

	/**
	 * Whether these are the companions `commands` would start in `ctx`, all still running. A
	 * reload keeps them only then: one that stopped starts again, and so do all of them when the
	 * output folder or the environment they were given changed.
	 */
	runs(ctx: CompanionContext, commands: string[]): boolean {
		const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);
		return same(this.commands, commands) && same(this.startedWith, environment(ctx)) && !this.running.some((r) => r.exited);
	}

	/** The tools' names (`postcss`, `esbuild`), for messages about a file one of them should have written. */
	names(): string[] {
		return this.commands.map(toolName);
	}

	/** Stop them, and what they started. Done when they're gone. */
	async stop(): Promise<void> {
		const all = this.running;
		this.running = [];
		await Promise.all(all.map(stop));
	}
}

/** Stop every companion, when ssqch itself is stopping. */
export async function stopAll(): Promise<void> {
	shuttingDown = true;
	await Promise.all([...running].map(stop));
}

/** Tell every companion to stop, without waiting for it: for a run that's ending this moment. */
export function stopAllNow(): void {
	shuttingDown = true;
	for (const one of [...running]) {
		one.stopping = true;
		running.delete(one);
		one.child.stdin?.destroy();
		const pid = one.child.pid;
		if (pid === undefined) continue;
		if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		else try { process.kill(-pid, "SIGTERM"); } catch { /* gone already */ }
	}
}

const alive = (group: number) => { try { process.kill(group, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

/** Stop the process group (or tree) that a companion leads. */
async function stop(one: Running): Promise<void> {
	one.stopping = true;
	running.delete(one);
	const { child } = one;
	// Closing standard input is the polite way to stop a watcher; the signal follows.
	child.stdin?.destroy();
	const pid = child.pid;
	if (pid === undefined) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		return;
	}
	const group = -pid;
	try { process.kill(group, "SIGTERM"); } catch { return; /* gone already */ }
	// A tool that ignores SIGTERM gets a moment, then SIGKILL.
	for (let i = 0; i < 20; i++) {
		if (!alive(group)) return;
		await sleep(50);
	}
	try { process.kill(group, "SIGKILL"); } catch { /* gone */ }
}

/** Show each line from `stream` with `[name]` in front. Done when the stream ends. */
function relay(stream: NodeJS.ReadableStream | null, name: string, error: boolean): Promise<void> {
	if (!stream) return Promise.resolve();
	const show = (line: string) => {
		// On Windows, Ctrl-C reaches the tools as well as ssqch (they share its console), and
		// cmd.exe asks whether to stop a batch file (`npx.cmd`): 0.7's never heard it, and taskkill
		// gave them no time to say more, so what they say once ssqch is stopping goes unshown.
		if (shuttingDown && process.platform === "win32") return;
		const shown = `[${name}] ${line.trimEnd()}`;
		if (error) process.stderr.write(shown + "\n");
		else progress(shown);
	};
	let rest = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk: string) => {
		const lines = (rest + chunk).split("\n");
		rest = lines.pop()!;
		for (const line of lines) show(line);
	});
	return new Promise((resolve) => {
		const done = () => {
			if (rest !== "") show(rest);
			rest = "";
			resolve();
		};
		stream.once("end", done);
		stream.once("error", done);
	});
}

/**
 * The name a command's output is shown under: the tool it runs, past `npx`, `pnpm exec` and the
 * like, without a scope or a path (`npx @tailwindcss/cli -i ...` is `tailwindcss`).
 */
export function toolName(command: string): string {
	const RUNNERS = ["npx", "pnpx", "bunx", "pnpm", "yarn", "npm", "bun", "deno", "node", "exec", "run", "dlx", "x", "env"];
	let word = command.split(/\s+/).filter(Boolean).find((w) => !RUNNERS.includes(w) && !w.startsWith("-") && !w.includes("=")) ?? "run";
	word = word.replace(/^["']+|["']+$/g, "");
	word = word.startsWith("@") ? word.slice(1).split("/")[0] : word.split(/[/\\]/).pop()!;
	word = word.split("@")[0];
	word = word.endsWith(".js") ? word.slice(0, -3) : word.endsWith(".mjs") ? word.slice(0, -4) : word;
	return word === "" ? "run" : word;
}
