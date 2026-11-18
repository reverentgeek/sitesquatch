// The standalone executable's entry (D7). Node's single-executable feature puts this file and
// ssqch's npm package, as npm installs it (node_modules/ssqch, sharp and its native addon), into
// one copy of Node: `scripts/build-sea.ts` builds it. The first run of each build unpacks the
// package into a folder of its own, and every run starts ssqch from there, so the executable
// runs the very files the npm package does, and Node loads them as it loads any package (the
// module hooks, `import "ssqch"`, sharp's addon, the compile cache).
//
// The folder: $SSQCH_UNPACK_DIR, or the system's cache folder (~/Library/Caches/ssqch on macOS,
// %LOCALAPPDATA%\ssqch on Windows, $XDG_CACHE_HOME/ssqch or ~/.cache/ssqch elsewhere), and the
// temporary folder when that can't be written. Each build has its own subfolder, named for its
// version and contents; deleting it is safe (the next run unpacks it again), and a subfolder
// nobody has run for a week goes when another build unpacks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sea from "node:sea";
import vm from "node:vm";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// bin/ssqch.js says why (sharp's encodes and page writes share libuv's pool); it has to be set
// before anything starts the pool, and unpacking could.
process.env.UV_THREADPOOL_SIZE ??= String(os.availableParallelism() + 4);

const { id, entry } = JSON.parse(sea.getAsset("unpack.json", "utf8")) as { id: string; entry: string };
const MARK = ".unpacked";
const DAY = 24 * 60 * 60 * 1000;

function fail(message: string): never {
	process.stderr.write(`error: ${message}\n`);
	process.exit(1);
}

/**
 * Node's own `import()` from the executable's entry only loads Node's built-in modules. A
 * function compiled with the main context's loader loads files, and packages, as Node does.
 */
function importer(): (url: string) => Promise<unknown> {
	// Its first use says it's experimental, which is Node's business, not the site's.
	const emit = process.emitWarning;
	process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
		if (!String(typeof warning === "string" ? warning : warning?.message).includes("USE_MAIN_CONTEXT_DEFAULT_LOADER")) (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
	}) as typeof process.emitWarning;
	const load = new vm.Script("(url) => import(url)", { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInThisContext() as (url: string) => Promise<unknown>;
	return (url) => {
		try {
			return load(url);
		} finally {
			process.emitWarning = emit;
		}
	};
}

function bases(): string[] {
	if (process.env.SSQCH_UNPACK_DIR) return [path.resolve(process.env.SSQCH_UNPACK_DIR)];
	const home = os.homedir();
	const cache = process.platform === "darwin" ? path.join(home, "Library", "Caches")
		: process.platform === "win32" ? (process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"))
		: (process.env.XDG_CACHE_HOME || path.join(home, ".cache"));
	let user = "user";
	try { user = os.userInfo().username; } catch { /* no name for this uid */ }
	return [path.join(cache, "ssqch"), path.join(os.tmpdir(), `ssqch-${user}`)];
}

/** The folder this build is unpacked in, unpacking it first if it isn't there. */
function unpacked(): string {
	const problems: string[] = [];
	for (const base of bases()) {
		const dir = path.join(base, id);
		const mark = path.join(dir, MARK);
		const seen = fs.statSync(mark, { throwIfNoEntry: false });
		if (seen) {
			// Noted at most once a day, so a build in use isn't taken for one nobody runs.
			if (Date.now() - seen.mtimeMs > DAY) try { fs.utimesSync(mark, new Date(), new Date()); } catch { /* read-only: fine */ }
			return dir;
		}
		try {
			unpack(base, dir);
			return dir;
		} catch (e) {
			problems.push(`${base}: ${(e as Error).message}`);
			if (process.env.SSQCH_UNPACK_DIR) break;
		}
	}
	fail(`the ssqch executable couldn't unpack itself (${problems.join("; ")}). Set SSQCH_UNPACK_DIR to a folder it can write, or install ssqch from npm (npm install --save-dev ssqch).`);
}

function unpack(base: string, dir: string): void {
	fs.mkdirSync(base, { recursive: true });
	// Written beside its place and renamed into it, so another ssqch starting at the same time
	// never sees half of it.
	const temp = fs.mkdtempSync(path.join(base, `.${id}-`));
	try {
		// getAssetKeys is Node 24's; the types are 22.18's, the lowest Node the package runs on.
		for (const key of (sea as typeof sea & { getAssetKeys(): string[] }).getAssetKeys()) {
			if (key === "unpack.json") continue;
			const file = path.join(temp, ...key.split("/"));
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, new Uint8Array(sea.getRawAsset(key) as ArrayBuffer));
		}
		fs.writeFileSync(path.join(temp, MARK), `${id}\n`);
		try {
			fs.renameSync(temp, dir);
		} catch (e) {
			// Another ssqch got there first.
			if (!fs.existsSync(path.join(dir, MARK))) throw e;
		}
	} finally {
		fs.rmSync(temp, { recursive: true, force: true });
	}
	prune(base);
}

/** Other builds' folders that nobody has run for a week. One still running keeps the files it has open. */
function prune(base: string): void {
	for (const name of fs.readdirSync(base)) {
		if (name === id || name.startsWith(".")) continue;
		const mark = fs.statSync(path.join(base, name, MARK), { throwIfNoEntry: false });
		if (mark && Date.now() - mark.mtimeMs > 7 * DAY) try { fs.rmSync(path.join(base, name), { recursive: true, force: true }); } catch { /* in use (Windows): next time */ }
	}
}

/**
 * `node --check <file>`, which ssqch runs to find the line of a syntax error in a site's file
 * (`src/modules.ts`): an executable is Node, but it runs its entry, not Node's command line.
 * The file is loaded as a module with an import added on a line of its own at the end, and every
 * import it has is refused, so it's parsed but never runs, and a syntax error goes uncaught,
 * printed as `node --check` prints it. One error lands a line lower than Node's: a block left
 * open at the end of the file, which the added import is then inside.
 */
async function checkSyntax(file: string): Promise<never> {
	const real = fs.realpathSync(file);
	const url = pathToFileURL(real).href;
	const PARSED = "ssqch:parsed";
	registerHooks({
		resolve(specifier, context, next) {
			if (context.parentURL === url) throw new Error(PARSED);
			return next(specifier, context);
		},
		load(loading, context, next) {
			if (loading !== url) return next(loading, context);
			return { format: "module", source: `${fs.readFileSync(real, "utf8")}\nimport ${JSON.stringify(PARSED)};\n`, shortCircuit: true };
		},
	});
	try {
		await importer()(url);
	} catch (e) {
		if ((e as Error)?.message !== PARSED) throw e;
	}
	process.exit(0);
}

if (process.env.SSQCH_SYNTAX_CHECK === "1" && process.argv[2] === "--check" && process.argv.length === 4) await checkSyntax(process.argv[3]);
const script = path.join(unpacked(), ...entry.split("/"));
// As `node bin/ssqch.js` has it, argv[1] is the script, and the arguments come after it. That's
// also how ssqch starts a process of its own (`ssqch serve`'s builder: `fork(process.argv[1])`),
// which runs this executable with the script first: then the script is argv[1], not an argument.
if (process.argv[2] && path.resolve(process.argv[2]) === script) process.argv.splice(2, 1);
process.argv[1] = script;
await importer()(pathToFileURL(script).href);
