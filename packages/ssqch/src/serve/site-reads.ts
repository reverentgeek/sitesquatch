// What a site's own code reads from disk while a page renders, in `ssqch serve`'s builder only
// (decision 3 of the dev server's design). A filter that reads `src/snippets/install.md` with
// `fs.readFileSync` shows that page's text without asking ssqch for it, so a rebuild that renders
// only the pages an edit can reach wouldn't know to render the filter's page too: it would stay
// as it was, with no word. Node's own `fs` functions are wrapped, so such a read is heard and
// noted against the page rendering (`build.ts`, the renderer's `beside`), like a file EJS includes
// from beside a page.
//
// Only here: `ssqch build` never sees the wrapped functions, and while serving the wrapper only
// calls a listener, which the renderer sets while pages render and which keeps nothing outside the
// input folder. A function whose answer depends on a file's absence or a folder's listing
// (`existsSync`, `readdirSync`) is a read too: a page added there is a change to that answer.
//
// What it can't hear: reads outside JavaScript (sharp's libvips, WebAssembly through WASI, a child
// process), file handles (`fs.open`, `fs.promises.open`, `FileHandle.readFile`), and a site
// that kept its own reference to a function before the builder started. Named imports
// (`import { readFileSync } from "node:fs"`) are rebound by `syncBuiltinESMExports()`.
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Who hears of a read: while serving, the renderer, while pages render. `listed` is a folder's listing. */
let listener: ((file: string, listed: boolean) => void) | undefined;
export function hearSiteReads(fn: ((file: string, listed: boolean) => void) | undefined): void {
	listener = fn;
}

function heard(p: unknown, listed: boolean): void {
	if (!listener) return;
	let file: string;
	if (typeof p === "string") file = p;
	else if (p instanceof URL) { if (p.protocol !== "file:") return; file = fileURLToPath(p); }
	else if (Buffer.isBuffer(p)) file = p.toString();
	else return; // a file descriptor: nothing to name
	listener(path.resolve(file), listed);
}

const FILE_READS = ["readFileSync", "readFile", "createReadStream", "existsSync", "statSync", "lstatSync", "stat", "lstat", "access", "accessSync"] as const;
const LISTINGS = ["readdirSync", "readdir", "opendirSync", "opendir"] as const;
const PROMISE_FILE_READS = ["readFile", "stat", "lstat", "access"] as const;
const PROMISE_LISTINGS = ["readdir", "opendir"] as const;

function wrap(target: Record<string, unknown>, name: string, listed: boolean): void {
	const original = target[name];
	if (typeof original !== "function") return;
	const wrapped = function (this: unknown, p: unknown, ...rest: unknown[]) {
		heard(p, listed);
		return original.call(this, p, ...rest);
	};
	// What a site checks of the function stays the same: its name, its length, `util.promisify`'s custom form.
	Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
	target[name] = wrapped;
}

let installed = false;
/** Wraps `fs`'s reads for the builder's life. Called once, before the config or any of the site's modules load. */
export function watchSiteReads(): void {
	if (installed) return;
	installed = true;
	const sync = fs as unknown as Record<string, unknown>;
	for (const name of FILE_READS) wrap(sync, name, false);
	for (const name of LISTINGS) wrap(sync, name, true);
	const promises = fs.promises as unknown as Record<string, unknown>;
	for (const name of PROMISE_FILE_READS) wrap(promises, name, false);
	for (const name of PROMISE_LISTINGS) wrap(promises, name, true);
	module.syncBuiltinESMExports();
}
