// Helpers for tests of `ssqch serve`: start it, wait on files, and talk HTTP to it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { BIN } from "./ssqch.js";

const SCRIPT = /\.(c|m)?(j|t)s$/.test(BIN);
const running = new Set();
process.on("exit", () => { for (const child of running) try { child.kill("SIGKILL"); } catch { /* gone */ } });

/**
 * Starts `ssqch <args>` (usually `serve ...`) in the background, with stdout and stderr going to
 * `logFile` when it's given. Returns `{ child, pid, log(), stop() }`; `stop()` ends it and waits.
 * Every server a test starts is killed when the test process exits, whatever happens. With
 * `detached` (not on Windows), it leads a process group of its own, as a terminal's foreground job
 * does, so `process.kill(-pid, "SIGINT")` is Ctrl-C. A variable set to `undefined` in `env` isn't
 * passed on at all.
 */
export function start(args, { cwd, env = {}, logFile, detached = false } = {}) {
	const out = logFile ? fs.openSync(logFile, "w") : "ignore";
	const [command, argv] = SCRIPT ? [process.execPath, [BIN, ...args]] : [BIN, args];
	const child = spawn(command, argv, { cwd, env: { ...process.env, TZ: "UTC", NO_COLOR: "1", ...env }, stdio: ["ignore", out, out], detached });
	running.add(child);
	const exited = new Promise((resolve) => child.on("exit", (code, signal) => { running.delete(child); resolve({ code, signal }); }));
	return {
		child,
		pid: child.pid,
		exited,
		log: () => (logFile ? fs.readFileSync(logFile, "utf8") : ""),
		async stop() {
			if (child.exitCode === null && child.signalCode === null) child.kill(process.platform === "win32" ? undefined : "SIGTERM");
			const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
			await exited;
			clearTimeout(timer);
			if (typeof out === "number") fs.closeSync(out);
		},
	};
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readOr = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };

/** Waits (up to `timeout` ms, 20 s by default) until `file` contains `text`; returns its contents. */
export async function waitFor(file, text, timeout = 20_000) {
	const started = Date.now();
	for (;;) {
		const found = readOr(file);
		if (found.includes(text)) return found;
		if (Date.now() - started > timeout) throw new Error(`${file} never had ${JSON.stringify(text)}; it has ${JSON.stringify(found)}`);
		await sleep(50);
	}
}

/**
 * Writes `text` to `source` and waits (up to 40 s) for `file` to contain `expected`. The write is
 * repeated every second: on a busy machine the server may not be watching yet when the first one
 * lands, and writing the same contents again doesn't count as another change.
 */
export async function changeAndWait(source, text, file, expected, timeout = 40_000) {
	const started = Date.now();
	for (;;) {
		fs.writeFileSync(source, text);
		const written = Date.now();
		while (Date.now() - written < 1000) {
			if (readOr(file).includes(expected)) return;
			await sleep(50);
		}
		if (Date.now() - started > timeout) throw new Error(`${file} never had ${JSON.stringify(expected)} after writing ${source}; it has ${JSON.stringify(readOr(file))}`);
	}
}

/**
 * A raw `GET path` to 127.0.0.1:port with `Connection: close`. Returns the whole response as text,
 * status line and headers included (`HTTP/1.1 200 OK\r\n...\r\n\r\n<body>`), as the Rust tests read it.
 */
export function httpGet(port, path, headers = {}) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(port, "127.0.0.1");
		const chunks = [];
		socket.setTimeout(10_000, () => socket.destroy(new Error(`GET ${path}: no answer in 10 s`)));
		socket.on("connect", () => {
			const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
			socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${extra}\r\n`);
		});
		socket.on("data", (c) => chunks.push(c));
		socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		socket.on("error", (e) => (chunks.length ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(e)));
	});
}

/** The body of an HTTP response from httpGet. */
export const body = (response) => response.split("\r\n\r\n").slice(1).join("\r\n\r\n");

/** The dev server's build state for the browser: `GET /__ssqch/build?v=<since>&p=<page>`, as JSON. */
export async function live(port, since, page) {
	const response = await httpGet(port, `/__ssqch/build?v=${since}&p=${encodeURIComponent(page)}`);
	try { return JSON.parse(body(response)); } catch (e) { throw new Error(`${e.message}: ${response}`); }
}

/** Starts `ssqch serve --port 0 --ready-file <dir>/ready.json --root <dir> ...extra` and waits for it. Returns the server and the ready file's JSON. */
export async function serveSite(dir, extra = [], options = {}) {
	const ready = `${dir}/ready.json`;
	fs.rmSync(ready, { force: true });
	const server = start(["serve", "--port", "0", "--ready-file", ready, "--root", dir, ...extra], { logFile: `${dir}/serve.log`, ...options });
	try {
		await waitFor(ready, "\"schemaVersion\"", options.timeout ?? 60_000);
	} catch (e) {
		await server.stop();
		throw new Error(`${e.message}\nserve.log:\n${server.log()}`);
	}
	return { server, info: JSON.parse(fs.readFileSync(ready, "utf8")) };
}
