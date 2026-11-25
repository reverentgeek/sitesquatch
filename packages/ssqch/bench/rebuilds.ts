// Whether rebuilds while serving write what a clean build writes, over a sequence of edits that
// cross pages: the dev server's design, stage 0's check made wider before any rebuild skips
// work (the roadmap, "The dev server"). One server, on a copy of the site, with
// SSQCH_CHECK_REBUILDS=1, so every rebuild is built again in a new process and compared byte for
// byte. A rebuild that keeps something between builds goes wrong after a history of edits, not
// after one, so the edits run in a row and end with everything put back.
//
//     node bench/rebuilds.ts --site <folder> --page <file>    a page with front matter (from the root)
//     ... --layout <file>                                     a layout or include to edit (found when left out)
//     ... --data <file>                                       a JSON data file to edit (found when left out; none, none edited)
//     ... --without dist                                      leave a folder of the root out of the copy
//
// It prints each step's verdict and exits 1 when one isn't a pass. Run it with nothing else on
// the machine that watches the same files.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? undefined : args[at + 1];
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const given = option("site");
const pageRel = option("page");
if (given === undefined || pageRel === undefined) throw new Error("give --site <folder> and --page <file>, a page with front matter, from the site's root");
const from = path.resolve(given);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-rebuilds-"));
const site = path.join(work, "site");
const without = new Set(["node_modules", ".git", ...args.flatMap((arg, i) => (args[i - 1] === "--without" ? [arg] : []))]);
fs.cpSync(from, site, { recursive: true, filter: (file) => path.dirname(file) !== from || !without.has(path.basename(file)) });
if (fs.existsSync(path.join(from, "node_modules"))) fs.symlinkSync(path.join(from, "node_modules"), path.join(site, "node_modules"), "junction");

/** The first file below `dir` whose path matches, skipping installs, outputs and caches. */
function find(dir: string, matches: (rel: string) => boolean): string | undefined {
	const skip = new Set(["node_modules", ".git", ".cache", "dist", "_site"]);
	const visit = (folder: string): string | undefined => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
			if (skip.has(entry.name)) continue;
			const file = path.join(folder, entry.name);
			const rel = path.relative(site, file).split(path.sep).join("/");
			if (entry.isDirectory()) {
				const found = visit(file);
				if (found) return found;
			} else if (matches(rel)) return rel;
		}
		return undefined;
	};
	return visit(dir);
}
const layoutRel = option("layout") ?? find(site, (rel) => /(^|\/)(_includes|_layouts|layouts)\//.test(rel) && /\.(njk|jinja|liquid|edge|hbs|ejs|html)$/.test(rel));
const dataRel = option("data") ?? find(site, (rel) => /(^|\/)_data\/[^/]+\.json$/.test(rel));

const at = (rel: string) => path.join(site, rel);
const originals = new Map<string, string>();
const keep = (rel: string) => {
	if (!originals.has(rel)) originals.set(rel, fs.readFileSync(at(rel), "utf8"));
};
const page = at(pageRel);
const ext = path.extname(pageRel);
const added = path.join(path.dirname(pageRel), `rebuilds-check-added${ext}`).split(path.sep).join("/");
const renamed = path.join(path.dirname(pageRel), `rebuilds-check-renamed${ext}`).split(path.sep).join("/");

/** Each step: what it does to the site. */
const steps: Array<[string, () => void]> = [
	// A data file first, and back: its change can read the configuration again, which starts a new
	// process, so it goes before the edits whose history the last step checks.
	...(dataRel ? [[`a data file (${dataRel})`, () => {
		keep(dataRel);
		const data = JSON.parse(fs.readFileSync(at(dataRel), "utf8"));
		// A key no template reads: the data changes, the pages that use it shouldn't.
		const changed = Array.isArray(data) ? [...data] : { ...data, rebuildsCheck: true };
		if (Array.isArray(changed)) changed.reverse();
		fs.writeFileSync(at(dataRel), JSON.stringify(changed, null, 2) + "\n");
	}] as [string, () => void]] : []),
	...(dataRel ? [["the data file put back", () => { fs.writeFileSync(at(dataRel), originals.get(dataRel)!); originals.delete(dataRel); }] as [string, () => void]] : []),
	["a page's body", () => { keep(pageRel); fs.appendFileSync(page, "\n\nA line the rebuild check added.\n"); }],
	["the page's title", () => {
		keep(pageRel);
		const text = fs.readFileSync(page, "utf8");
		const titled = text.replace(/^(title:\s*)(["']?)(.*?)\2\s*$/m, (_m, key, quote, title) => `${key}${quote}${title} (rebuilt)${quote}`);
		if (titled === text) throw new Error(`${pageRel} has no title: line in its front matter`);
		fs.writeFileSync(page, titled);
	}],
	// A page like it, with the same one-line front matter but its title and its address.
	["a page added beside it", () => {
		const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(page, "utf8"))?.[1] ?? "";
		// Every one-line key but those that make an address, which the copy would share.
		const plain = front.split(/\r?\n/).filter((line) => /^[A-Za-z_][\w-]*:\s*\S/.test(line) && !/^(permalink|aliases|slug|redirect_from|url|eleventyNavigation):/.test(line)).map((line) => (line.startsWith("title:") ? "title: Added by the rebuild check" : line));
		fs.writeFileSync(at(added), `---\n${plain.join("\n")}\n---\nA page the rebuild check added.\n`);
	}],
	["that page renamed", () => fs.renameSync(at(added), at(renamed))],
	["that page deleted", () => fs.rmSync(at(renamed))],
	...(layoutRel ? [[`a layout (${layoutRel})`, () => { keep(layoutRel); fs.appendFileSync(at(layoutRel), "\n"); }] as [string, () => void]] : []),
	["everything else put back, in the process that saw it all", () => {
		for (const [rel, text] of originals) fs.writeFileSync(at(rel), text);
	}],
];

const timeline = path.join(work, "timeline.jsonl");
const ready = path.join(work, "ready.json");
const log = fs.openSync(path.join(work, "serve.log"), "w");
const server = spawn(process.execPath, [path.join(here, "../bin/ssqch.ts"), "serve", "--port", "0", "--root", site, "--ready-file", ready], {
	env: { ...process.env, SSQCH_SERVE_TIMELINE: timeline, SSQCH_CHECK_REBUILDS: "1", NO_COLOR: "1" },
	stdio: ["ignore", log, log],
});
const serveLog = () => { try { return fs.readFileSync(path.join(work, "serve.log"), "utf8"); } catch { return ""; } };
const timed = () => { try { return fs.readFileSync(timeline, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } };

async function until<T>(what: string, look: () => T | undefined, ms = 300_000): Promise<T> {
	const started = Date.now();
	for (;;) {
		const found = look();
		if (found !== undefined) return found;
		if (Date.now() - started > ms) throw new Error(`gave up waiting for ${what}; the server's output is in ${path.join(work, "serve.log")}`);
		await sleep(20);
	}
}

let failed = 0;
try {
	await until("the first build (the ready file)", () => (fs.existsSync(ready) ? true : undefined));
	await sleep(1500);
	console.log(`${given}: ${steps.length} edits in a row, each rebuild checked against a clean build`);
	for (const [name, act] of steps) {
		const before = timed().length;
		const said = serveLog().length;
		act();
		// A rebuild's line, then its check's (none when the build failed). An edit that reads the
		// configuration again (a data file its code read) builds in a new process instead: a clean
		// build by construction, which isn't checked.
		const outcome = await until(`the rebuild after "${name}"`, () => timed().slice(before).find((line) => line.kind === "rebuild") ?? (/reading the configuration again[\s\S]*Serving /.test(serveLog().slice(said)) ? "reloaded" : undefined));
		if (outcome === "reloaded") {
			console.log(`  pass ${name}: the configuration read again, so a new process built it (a clean build)`);
			await sleep(1500);
			continue;
		}
		const rebuild = outcome;
		if (rebuild.ok) await until(`the check after "${name}"`, () => timed().slice(before).find((line) => line.kind === "check"));
		// Let the output settle, and a second rebuild the edit set off (a rename's two events).
		await sleep(1500);
		const lines = timed().slice(before);
		const lastRebuild = lines.filter((line) => line.kind === "rebuild").at(-1);
		const last = lines.filter((line) => line.kind === "check").at(-1);
		const pass = lastRebuild.ok && last !== undefined && / wrote what a clean build writes /.test(last.verdict);
		if (!pass) failed += 1;
		console.log(`  ${pass ? "pass" : "FAIL"} ${name}: ${lastRebuild.ok ? last?.verdict ?? "no check" : "the build failed (the server's output says why)"}`);
	}
} finally {
	server.kill("SIGTERM");
}
console.log(`The copy, its timeline and the server's output: ${work}`);
if (failed) process.exitCode = 1;
