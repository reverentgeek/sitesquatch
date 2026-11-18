// How the commands a site runs are started (its hooks, and `serve.run`'s tools): apart from the
// build, so the dev server can start its tools without loading what building takes.
import os from "node:os";
import path from "node:path";
import { isDir } from "./paths.ts";

/**
 * `PATH` for a command a site runs (hooks, `serve.run`): each `node_modules/.bin` from the
 * project's folder up, first, as npm, pnpm and yarn give their scripts, so `postcss` works under
 * `ssqch build` as it does under `npm run build`.
 */
export function toolPath(root: string): string {
	const bins: string[] = [];
	for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
		const bin = path.join(dir, "node_modules", ".bin");
		if (isDir(bin)) bins.push(bin);
		if (path.dirname(dir) === dir) break;
	}
	const rest = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean);
	return [...bins, ...rest].join(path.delimiter);
}

/**
 * How a command a site runs (a hook, a `serve.run` tool) is started, as 0.7 started it: through
 * `/bin/sh -c`, or `cmd /C` on Windows, in the project root, with the environment ssqch was
 * given, `vars` and `PATH` from `toolPath`. Not Node's `shell: true`, whose `cmd /d` skips the
 * AutoRun commands cmd.exe runs for everything else (0.7's `cmd /C` ran them).
 */
export function commandLine(command: string, root: string, vars: Record<string, string>): { file: string; args: string[]; options: { cwd: string; env: NodeJS.ProcessEnv; windowsVerbatimArguments?: boolean } } {
	const env: NodeJS.ProcessEnv = { ...process.env, ...vars };
	// The thread pool the `ssqch` command sized for itself (`bin/ssqch.ts`) isn't the command's: a
	// Node tool would take it for its own. One the person running ssqch set is theirs to pass on.
	if (env.UV_THREADPOOL_SIZE === String(os.availableParallelism() + 4)) delete env.UV_THREADPOOL_SIZE;
	// One `PATH`, whatever case the platform spells it in.
	for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
	env.PATH = toolPath(root);
	if (process.platform !== "win32") return { file: "/bin/sh", args: ["-c", command], options: { cwd: root, env } };
	// `/s` and the quotes: what's between them runs as it was written, quotes and all.
	return { file: process.env.ComSpec ?? "cmd.exe", args: ["/s", "/c", `"${command}"`], options: { cwd: root, env, windowsVerbatimArguments: true } };
}
