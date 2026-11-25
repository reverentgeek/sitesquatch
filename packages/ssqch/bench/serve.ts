// Where the time goes from a save to the browser hearing of it, while serving: the dev server's
// design, stage 0 (the roadmap, "The dev server"). Not a check with a limit, a measurement.
//
//     node bench/serve.ts                                 the 10,000-page site (make-site.ts), an edit to one post's text
//     node bench/serve.ts --pages 1000                    a smaller one
//     node bench/serve.ts --site <folder> --edit <file>   a copy of another site, an edit to <file> (from its root)
//     node bench/serve.ts ... --edits 10                  how many edits to time (5), after one that isn't counted
//     node bench/serve.ts ... --check                     with SSQCH_CHECK_REBUILDS=1, each check's verdict, and exit
//                                                         code 1 when one isn't a pass (time and check in separate runs:
//                                                         the check's build starts as the browser would ask)
//     node bench/serve.ts --site <folder> --without dist  leave a folder of the site's root out of the copy (repeatable)
//
// The site is always a copy, in a folder of the system's temporary ones: a site's own folder (the
// blog, a study's) is never edited. Its `node_modules` is linked, not copied, `.git` is left
// out, and everything else is copied as it is: `.cache` (encoded images), so the first build
// isn't a cold one, and the output folder with what a production build left in it, as on the
// builder's own machine (a check lists those files as only in the output; `--without dist`
// leaves them out). The server runs ssqch from this
// checkout's source, with SSQCH_SERVE_TIMELINE (src/serve/timeline.ts); each edit appends a
// line to the file, the script stamps the save itself, and asks the server what a browser asks
// (`/__ssqch/build`) every 5 ms, to see when a browser could first hear of it. The reload script
// asks every 700 ms, so a browser hears up to 0.7 s later than that (0.35 s on average): that's
// a row of its own, not measured.
//
// Run it alone, like bench.ts: a study or a compiler beside it slows every row.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeSite } from "./make-site.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? undefined : args[at + 1];
};
const edits = Number(option("edits") ?? 5);
const checking = args.includes("--check");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-serve-bench-"));
const site = path.join(work, "site");
let edit: string;
const given = option("site");
if (given !== undefined) {
	const from = path.resolve(given);
	edit = option("edit") ?? "";
	if (!edit) throw new Error("--site needs --edit <file>, from the site's root");
	// Everything but installs, the repository and outputs a fresh copy wouldn't have.
	const without = new Set(["node_modules", ".git", ...args.flatMap((arg, i) => (args[i - 1] === "--without" ? [arg] : []))]);
	fs.cpSync(from, site, { recursive: true, filter: (file) => path.dirname(file) !== from || !without.has(path.basename(file)) });
	if (fs.existsSync(path.join(from, "node_modules"))) fs.symlinkSync(path.join(from, "node_modules"), path.join(site, "node_modules"), "junction");
} else {
	makeSite(site, Number(option("pages") ?? 10_000));
	edit = "src/posts/00042.md";
}
const editing = path.join(site, edit);
const original = fs.readFileSync(editing, "utf8");

const timeline = path.join(work, "timeline.jsonl");
const ready = path.join(work, "ready.json");
const log = fs.openSync(path.join(work, "serve.log"), "w");
const server = spawn(process.execPath, [path.join(here, "../bin/ssqch.ts"), "serve", "--port", "0", "--root", site, "--ready-file", ready], {
	env: { ...process.env, SSQCH_SERVE_TIMELINE: timeline, ...(checking ? { SSQCH_CHECK_REBUILDS: "1" } : {}), NO_COLOR: "1" },
	stdio: ["ignore", log, log],
});
const lines = () => { try { return fs.readFileSync(timeline, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } };

async function until<T>(what: string, look: () => T | undefined, ms = 600_000): Promise<T> {
	const started = Date.now();
	for (;;) {
		const found = look();
		if (found !== undefined) return found;
		if (Date.now() - started > ms) throw new Error(`gave up waiting for ${what}; the server's output is in ${path.join(work, "serve.log")}`);
		await sleep(5);
	}
}

interface Row { save: number; heard: number; entry: any; check?: any }
const rows: Row[] = [];
try {
	const info = await until("the first build (the ready file)", () => (fs.existsSync(ready) ? JSON.parse(fs.readFileSync(ready, "utf8")) : undefined));
	const ask = async () => (await (await fetch(`${info.url.replace(/\/$/, "")}/__ssqch/build`)).json()).id as number;
	for (let i = 0; i <= edits; i++) {
		const before = lines().length;
		const id = await ask();
		// Text that changes this page's own output and no other's.
		fs.writeFileSync(editing, `${original}\n\nEdit ${i} of the bench.\n`);
		const save = Date.now();
		let heard: number | undefined;
		for (;;) {
			if ((await ask()) !== id) { heard = Date.now(); break; }
			if (Date.now() - save > 600_000) throw new Error("the server never said the build changed");
			await sleep(5);
		}
		const entry = await until("the rebuild's line", () => lines().slice(before).find((line) => line.kind === "rebuild"));
		const check = checking ? await until("the check's line", () => lines().slice(before).find((line) => line.kind === "check")) : undefined;
		// Let the output settle (the server's last walks, a tool's writes) before the next edit.
		await sleep(1500);
		if (i > 0) rows.push({ save, heard: heard!, entry, check });
	}
} finally {
	server.kill("SIGTERM");
	fs.writeFileSync(editing, original);
}

const steps: Array<[string, (r: Row) => number]> = [
	["save to the watcher hearing it", (r) => r.entry.heard - r.save],
	["the wait for more changes (debounce)", (r) => r.entry.debounced - r.entry.heard],
	["deciding what changed, saying Fresh tracks", (r) => r.entry.asked - r.entry.debounced],
	["the message to the builder", (r) => r.entry.builder.received - r.entry.asked],
	["the build", (r) => r.entry.builder.finished - r.entry.builder.started],
	["printing the summary", (r) => r.entry.builder.said - r.entry.builder.finished],
	["the answer back", (r) => r.entry.built - r.entry.builder.said],
	["waiting for serve.run's tools", (r) => r.entry.held - r.entry.built],
	["comparing the output (publish)", (r) => r.entry.published - r.entry.held],
	["the Serving line", (r) => r.entry.said - r.entry.published],
];
const pad = (text: string, width: number) => text.padEnd(width);
const msText = (ms: number) => `${Math.round(ms)} ms`;
console.log(`${given ?? `make-site.ts, ${option("pages") ?? 10_000} pages`}: ${rows.length} edits to ${edit}, medians (each step's own median: the sum isn't the total's)`);
for (const [label, of] of steps) console.log(`  ${pad(label, 46)} ${msText(median(rows.map(of)))}`);
const phases = rows[0]?.entry.builder.phases.map(([name]: [string, number]) => name) ?? [];
console.log(`  ${pad("  the build's phases", 46)} ${phases.map((name: string, i: number) => `${name} ${msText(median(rows.map((r) => r.entry.builder.phases[i][1])))}`).join(", ")}`);
console.log(`  ${pad("save to the Serving line", 46)} ${msText(median(rows.map((r) => r.entry.said - r.save)))}`);
console.log(`  ${pad("save to a browser could hear (asked every 5 ms)", 46)} ${msText(median(rows.map((r) => r.heard - r.save)))}`);
console.log(`  ${pad("then the reload script's poll (every 700 ms)", 46)} 0 to 700 ms, 350 on average (not measured)`);
if (checking) for (const r of rows) console.log(`  ${r.check.verdict}`);
console.log(`The copy, its timeline and the server's output: ${work}`);
if (checking && rows.some((r) => !/ wrote what a clean build writes /.test(r.check.verdict))) process.exitCode = 1;
