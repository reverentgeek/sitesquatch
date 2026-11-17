// The sites whose output is frozen: every example, every starter, and (on a machine that has them
// next to this repository) the blog and the trial ports.
//
// Each site is built in a copy whose files all have FIXED_TIME, with TZ=UTC and --format json, so
// dates that come from file times repeat. The output, the normalized JSON report and the build
// summary are compared with the snapshot that `node freeze.js` made with ssqch 0.7.0.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO, ORACLE, ssqch, tempDir, copyDir, fixTimes, expectedVersion } from "./ssqch.js";

/** Committed snapshots, for sites in this repository. */
export const SNAPSHOTS = path.join(ORACLE, "snapshots");
/** Snapshots of sites outside the repository (the blog, the trial ports): gitignored. */
export const LOCAL_SNAPSHOTS = path.join(ORACLE, "snapshots-local");

const ENGINES = ["jinja", "njk", "edge", "liquid", "hbs", "ejs"];

/**
 * Every site, as `{ name, local, prepare(dir) → root, args, env }`. `prepare` fills an empty
 * folder and returns the project root to build; `local` sites are skipped where their source
 * isn't there.
 */
export function sites() {
	const list = [];
	const examples = path.join(REPO, "examples/sites");
	for (const name of fs.readdirSync(examples).sort()) {
		const src = path.join(examples, name);
		if (!fs.existsSync(path.join(src, "ssqch.config.js"))) continue;
		const prepare = (dir) => { copyDir(src, dir); return dir; };
		list.push({ name: `example-${name}`, prepare });
		// The variants examples.rs checks: a staging build, and a build under a base.
		if (name === "blog-categories") list.push({ name: `example-${name}-staging`, prepare, env: { SITE: "staging" } });
		if (name === "islands") list.push({ name: `example-${name}-base`, prepare, args: ["--base", "/repo/"] });
	}
	for (const starter of ["site", "docs"]) {
		for (const engine of ENGINES) {
			list.push({ name: `starter-${starter}-${engine}`, starter: { starter, engine }, prepare: (dir) => { init(dir, starter, engine); return dir; } });
		}
	}
	const local = (name, from, { root = ".", extra = [], args = [], env = {} } = {}) => {
		const src = path.resolve(REPO, from);
		list.push({ name, local: true, available: fs.existsSync(path.join(src, root)), args, env, prepare: (dir) => copyWorkingTree(src, dir, extra) && path.join(dir, root) });
	};
	// The blog's assets come from PostCSS and esbuild (pnpm run build:css build:js) and its
	// images from the cache; the copy takes both from the checkout as they are.
	local("blog", "../blog", { extra: ["dist/assets", ".cache"], args: ["--env", "production"] });
	local("trial-a11yproject", "../trials/a11yproject.com", { extra: [".cache"] });
	local("trial-v8.dev", "../trials/v8.dev", { extra: [".cache"] });
	// As its case study builds it (ssqch-case-study/scripts/ssqch-step.sh). Not frozen yet: its
	// beforeBuild helper needs lit.dev's own SSR build (rollupout/server/ssr.js), which the
	// checkout doesn't have; run lit.dev's build, then node freeze.js trial-lit.dev.
	local("trial-lit.dev", "../trials/lit.dev", { root: "packages/lit-dev-content", extra: [".cache", "packages/lit-dev-content/.cache", "packages/lit-dev-content/rollupout"], env: { LITDEV_ENV: "local", NODE_OPTIONS: "--experimental-vm-modules --max_old_space_size=4096" } });
	return list;
}

function init(dir, starter, engine) {
	const r = ssqch(["init", dir, "--starter", starter, "--engine", engine, "--quiet"]);
	if (!r.ok) throw new Error(`ssqch init --starter ${starter} --engine ${engine} failed:\n${r.log}`);
}

/** The files git would commit (tracked, and untracked but not ignored), `extra` ignored paths, and node_modules as links. */
function copyWorkingTree(src, dir, extra) {
	const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: src, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean);
	for (const file of files) {
		const from = path.join(src, file), to = path.join(dir, file);
		const stat = fs.lstatSync(from, { throwIfNoEntry: false });
		if (!stat || stat.isDirectory()) continue; // deleted in the working tree, or a submodule
		fs.mkdirSync(path.dirname(to), { recursive: true });
		if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
		else fs.copyFileSync(from, to);
	}
	for (const e of extra) {
		const from = path.join(src, e);
		if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, e), { recursive: true });
	}
	// Every node_modules folder that isn't inside another, as a link (they're big, and not built).
	const link = (rel) => {
		for (const entry of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === ".git") continue;
			const sub = path.join(rel, entry.name);
			if (entry.name === "node_modules") {
				fs.mkdirSync(path.join(dir, rel), { recursive: true });
				fs.symlinkSync(path.join(src, sub), path.join(dir, sub), "junction");
			} else if (files.some((f) => f.startsWith(sub + "/"))) link(sub);
		}
	};
	link("");
	return true;
}

/**
 * Builds a site in a new folder with --format json, and again in another with the text summary.
 * Returns `{ ok, report, out, root, dir, summary }`; `summary` is the second build's stderr.
 */
export function buildSite(site) {
	const fresh = (suffix) => {
		const dir = tempDir(site.name + suffix);
		const root = site.prepare(dir);
		fixTimes(dir);
		return { dir, root };
	};
	const json = fresh("");
	const r = ssqch(["build", "--root", json.root, "--format", "json", ...(site.args ?? [])], { env: site.env, timeout: 600_000 });
	let report = null;
	try { report = JSON.parse(r.stdout); } catch { /* the failure is in the log */ }
	const text = fresh("-text");
	const t = ssqch(["build", "--root", text.root, ...(site.args ?? [])], { env: site.env, timeout: 600_000 });
	const summary = normalizeLog(t.log, text);
	return { ok: r.ok, log: r.log, report, out: report?.output && path.resolve(json.root, report.output), root: json.root, dir: json.dir, summary, textOk: t.ok };
}

// ---- normalizing ------------------------------------------------------------------------------

/** The implementation's version in text becomes `{{version}}`, so 0.7.0's snapshot fits 0.8.0. */
export function normalizeText(text, version = expectedVersion()) {
	const v = version.replaceAll(".", "\\.");
	return text.replace(new RegExp(`(SiteSquatch |ssqch |ssqch@|ssqch/|"version": "|version: ")v?${v}\\b`, "g"), "$1{{version}}");
}

/** The JSON report without what changes from run to run: times, absolute paths, the order of `written`. */
export function normalizeReport(report, build) {
	if (!report) return null;
	const { durationMs, timings, ...rest } = report;
	const paths = (v) => JSON.parse(JSON.stringify(v).replaceAll(JSON.stringify(build.root).slice(1, -1), "<root>").replaceAll(JSON.stringify(build.dir).slice(1, -1), "<root>"));
	const out = paths(rest);
	if (Array.isArray(out.written)) out.written = [...out.written].sort();
	out.timings = Array.isArray(timings) ? "(left out)" : timings;
	return JSON.parse(normalizeText(JSON.stringify(out)));
}

/** The build's summary (stdout and stderr): no "Writing" lines, times as <time>, paths as <root>. */
export function normalizeLog(stderr, build) {
	return normalizeText(stderr.split(/\r?\n/)
		.filter((line) => !line.startsWith("[ssqch] Writing") && !/^\s*Time\s/.test(line))
		.map((line) => line.replaceAll(build.root, "<root>").replaceAll(build.dir, "<root>").replace(/\b\d+(\.\d+)? ?(µs|ms|s)\b/g, "<time>"))
		.join("\n").trim() + "\n");
}

const decoder = new TextDecoder("utf-8", { fatal: true });
/** Text when it's UTF-8 without NUL bytes; otherwise a binary, compared by hash. */
export function asText(buffer) {
	if (buffer.includes(0)) return null;
	try { return decoder.decode(buffer); } catch { return null; }
}

/** Every file under `dir`, with forward slashes, sorted. Links are listed as links. */
export function listFiles(dir, rel = "") {
	const out = [];
	for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
		const p = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listFiles(dir, p));
		else out.push(p);
	}
	return out.sort();
}

/**
 * The snapshot of a built site, as `{ files: { path: { text } | { sha256, bytes } | { link } }, report, log }`.
 * `starter` sites also record the files `ssqch init` wrote.
 */
export function snapshotOf(build, site) {
	const files = {};
	if (build.out && fs.existsSync(build.out)) {
		for (const file of listFiles(build.out)) {
			const abs = path.join(build.out, file);
			if (fs.lstatSync(abs).isSymbolicLink()) { files[file] = { link: fs.readlinkSync(abs) }; continue; }
			const buf = fs.readFileSync(abs);
			const text = asText(buf);
			files[file] = text === null ? { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length } : { text: normalizeText(text) };
		}
	}
	let source = null;
	if (site.starter) {
		source = {};
		const skip = new Set([path.relative(build.root, build.out ?? "").split(path.sep)[0], ".cache"]);
		for (const file of listFiles(build.root)) {
			if (skip.has(file.split("/")[0])) continue;
			const buf = fs.readFileSync(path.join(build.root, file));
			const text = asText(buf);
			source[file] = text === null ? { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length } : normalizeText(text);
		}
	}
	return { ok: build.ok, report: normalizeReport(build.report, build), log: build.summary, files, source };
}

// ---- storing ----------------------------------------------------------------------------------
// snapshots/<site>/manifest.json has the report, the log, and every output file's kind; text
// files are stored as they are under snapshots/<site>/output/ (and the starter's files under
// source/), so a change shows in `git diff`.

export function saveSnapshot(dir, snap) {
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const manifest = { ok: snap.ok, report: snap.report, log: snap.log, files: {}, source: snap.source ? {} : undefined };
	for (const [file, entry] of Object.entries(snap.files)) {
		if ("text" in entry) {
			fs.mkdirSync(path.dirname(path.join(dir, "output", file)), { recursive: true });
			fs.writeFileSync(path.join(dir, "output", file), entry.text);
			manifest.files[file] = "text";
		} else manifest.files[file] = entry;
	}
	for (const [file, text] of Object.entries(snap.source ?? {})) {
		if (typeof text !== "string") { manifest.source[file] = text; continue; }
		fs.mkdirSync(path.dirname(path.join(dir, "source", file)), { recursive: true });
		fs.writeFileSync(path.join(dir, "source", file), text);
		manifest.source[file] = "text";
	}
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

export function loadSnapshot(dir) {
	const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
	const files = {};
	for (const [file, kind] of Object.entries(manifest.files)) files[file] = kind === "text" ? { text: fs.readFileSync(path.join(dir, "output", file), "utf8") } : kind;
	const source = manifest.source ? Object.fromEntries(Object.entries(manifest.source).map(([f, kind]) => [f, kind === "text" ? fs.readFileSync(path.join(dir, "source", f), "utf8") : kind])) : null;
	return { ok: manifest.ok, report: manifest.report, log: manifest.log, files, source };
}

/** What differs between two snapshots, as lines a person reads (empty when they're the same). */
export function differences(expected, actual) {
	const out = [];
	if (expected.ok !== actual.ok) out.push(`the build ${expected.ok ? "failed" : "succeeded"}, and 0.7.0's ${expected.ok ? "succeeded" : "failed"}`);
	const compareMaps = (label, a, b, same) => {
		for (const f of Object.keys(a)) if (!(f in b)) out.push(`${label}${f}: missing`);
		for (const f of Object.keys(b)) if (!(f in a)) out.push(`${label}${f}: not in the snapshot`);
		for (const f of Object.keys(a)) if (f in b && !same(a[f], b[f])) out.push(`${label}${f}: ${describe(a[f], b[f])}`);
	};
	compareMaps("", expected.files, actual.files, (x, y) => JSON.stringify(x) === JSON.stringify(y));
	if (expected.source || actual.source) compareMaps("init wrote ", expected.source ?? {}, actual.source ?? {}, (x, y) => JSON.stringify(x) === JSON.stringify(y));
	if (JSON.stringify(expected.report) !== JSON.stringify(actual.report)) out.push(`the JSON report: ${describe({ text: JSON.stringify(expected.report, null, 2) }, { text: JSON.stringify(actual.report, null, 2) })}`);
	if (expected.log !== actual.log) out.push(`the build summary: ${describe({ text: expected.log }, { text: actual.log })}`);
	return out;
}

function describe(a, b) {
	const ta = typeof a === "string" ? a : a.text, tb = typeof b === "string" ? b : b.text;
	if (ta === undefined || tb === undefined) return `was ${JSON.stringify(a)}, now ${JSON.stringify(b)}`;
	const la = ta.split("\n"), lb = tb.split("\n");
	let i = 0;
	while (i < la.length && la[i] === lb[i]) i++;
	const cut = (s) => JSON.stringify(s === undefined ? "(end)" : s.length > 200 ? s.slice(0, 200) + "…" : s);
	return `line ${i + 1} was ${cut(la[i])}, now ${cut(lb[i])}`;
}
