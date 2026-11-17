// The oracle's way of running ssqch: any implementation, as a black box.
//
//   SSQCH_BIN=target/release/ssqch node --test        (the default: the Rust build)
//   SSQCH_BIN=packages/ssqch/bin/ssqch.ts node --test (a .js or .ts file runs with this Node)
//
// Every run gets TZ=UTC, so dates don't depend on the machine.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository's root. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** This folder (`tests/oracle`). */
export const ORACLE = path.join(REPO, "tests/oracle");
/** Files the tests read: `tests/oracle/fixtures`. */
export const FIXTURES = path.join(ORACLE, "fixtures");

const exe = process.platform === "win32" ? ".exe" : "";
/** The ssqch under test, as an absolute path. */
export const BIN = path.resolve(REPO, process.env.SSQCH_BIN ?? `target/release/ssqch${exe}`);
if (!fs.existsSync(BIN)) {
	throw new Error(`${BIN} doesn't exist. Build it (cargo build --release -p ssqch) or set SSQCH_BIN to the ssqch to test.`);
}
const SCRIPT = /\.(c|m)?(j|t)s$/.test(BIN);

/**
 * Runs ssqch with `args`. Returns `{ ok, code, stdout, stderr, log }`; `log` is stdout then
 * stderr, as the Rust tests read it.
 * Options: `cwd`, `env` (added to the environment), `input` (stdin), `timeout` (ms).
 */
export function ssqch(args, { cwd, env = {}, input, timeout = 120_000 } = {}) {
	const [command, argv] = SCRIPT ? [process.execPath, [BIN, ...args]] : [BIN, args];
	const r = spawnSync(command, argv, { cwd, input, timeout, encoding: "utf8", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", ...env }, maxBuffer: 64 * 1024 * 1024 });
	if (r.error) throw r.error;
	const stdout = r.stdout ?? "", stderr = r.stderr ?? "";
	return { ok: r.status === 0, code: r.status, signal: r.signal, stdout, stderr, log: stdout + stderr };
}

/** `ssqch` that must succeed: returns the log, or throws with it. */
export function ssqchOk(args, options) {
	const r = ssqch(args, options);
	if (!r.ok) throw new Error(`ssqch ${args.join(" ")} failed (exit ${r.code}):\n${r.log}`);
	return r.log;
}

/** `ssqch` that must fail: returns the log, or throws with it. */
export function ssqchFails(args, options) {
	const r = ssqch(args, options);
	if (r.ok) throw new Error(`ssqch ${args.join(" ")} should have failed:\n${r.log}`);
	return r.log;
}

/**
 * The version the implementation under test should report: SSQCH_EXPECT_VERSION, or
 * `packages/ssqch/package.json` once it exists, or Cargo.toml's workspace version.
 */
export function expectedVersion() {
	if (process.env.SSQCH_EXPECT_VERSION) return process.env.SSQCH_EXPECT_VERSION;
	const pkg = path.join(REPO, "packages/ssqch/package.json");
	if (process.env.SSQCH_BIN?.includes("packages/ssqch") && fs.existsSync(pkg)) return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
	const cargo = fs.readFileSync(path.join(REPO, "Cargo.toml"), "utf8");
	return /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/.exec(cargo)[1];
}

let counter = 0;
/** A new, empty folder for one test. Removed when the process exits unless SSQCH_KEEP is set. */
export function tempDir(name) {
	const dir = path.join(os.tmpdir(), `ssqch-oracle-${process.pid}-${counter++}-${name}`);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	made.push(dir);
	return dir;
}
const made = [];
process.on("exit", () => {
	if (process.env.SSQCH_KEEP) return;
	for (const dir of made) try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use on Windows */ }
});

/**
 * A project in a new folder: `files` maps paths (with forward slashes) to contents (strings or
 * Buffers). Returns the folder.
 */
export function project(files, name = "project") {
	const dir = tempDir(name);
	write(dir, files);
	return dir;
}

/** Writes `files` into `dir`, making folders as needed. */
export function write(dir, files) {
	for (const [file, content] of Object.entries(files)) {
		const to = path.join(dir, file);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.writeFileSync(to, content);
	}
}

/** A file's text, or a failure that names it. */
export function read(dir, file) {
	try {
		return fs.readFileSync(path.join(dir, file), "utf8");
	} catch (e) {
		throw new Error(`${file}: ${e.message}`);
	}
}

export const exists = (dir, file) => fs.existsSync(path.join(dir, file));
export const isFile = (dir, file) => fs.statSync(path.join(dir, file), { throwIfNoEntry: false })?.isFile() ?? false;
export const isDir = (dir, file) => fs.statSync(path.join(dir, file), { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Copies a folder, skipping `skip` names at any depth (dist and .cache by default). */
export function copyDir(from, to, skip = ["dist", ".cache", "node_modules"]) {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		if (skip.includes(entry.name)) continue;
		const src = path.join(from, entry.name), dest = path.join(to, entry.name);
		if (entry.isDirectory()) copyDir(src, dest, skip);
		else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest);
		else fs.copyFileSync(src, dest);
	}
}

/** The time the oracle gives every source file, so dates from file times repeat. */
export const FIXED_TIME = new Date("2026-01-01T00:00:00Z");

/** Sets every file and folder under `dir` to FIXED_TIME (not following links, not node_modules). */
export function fixTimes(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.isSymbolicLink()) continue;
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) fixTimes(p);
		fs.utimesSync(p, FIXED_TIME, FIXED_TIME);
	}
	fs.utimesSync(dir, FIXED_TIME, FIXED_TIME);
}

/**
 * True while the oracle runs against ssqch 0.7 (the Rust build). A test of behavior that 0.8
 * changes on purpose (QuickJS's limits, say) runs only then:
 * `test("...", { skip: !RUST_07 && "QuickJS only: ..." }, ...)`.
 */
export const RUST_07 = expectedVersion().startsWith("0.7.");

/** What `ssqch capabilities` reports (cached): use it to skip a test of an optional feature. */
let capabilities;
export function hasCapability(name) {
	capabilities ??= ssqch(["capabilities"]).log;
	return new RegExp(`\\b${name} yes\\b`).test(capabilities);
}
