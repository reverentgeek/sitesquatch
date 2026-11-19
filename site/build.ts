// Builds sitesquatch.dev for production with this repository's ssqch (or SSQCH_BIN), and fails
// on any warning as well as any error: a broken link, a page over its budget (`budgets` in
// ssqch.config.js) or anything else ssqch would only warn about isn't something to deploy.
//
//   node build.ts
//
// 1. The example sites (examples/sites/), each built under its own path, /examples/<name>/,
//    into the site's output, with a trail marker in a corner of each page (its name, the gallery,
//    its source) and its `_redirects` lines moved into the site's own. They're built first so the
//    site's link checker finds them.
// 2. The site. Its docs pages are split from the README by the config's beforeBuild hook
//    (lib/split.ts).
// 3. Pagefind (https://pagefind.app) indexes the docs and the changelog for the site's search
//    (src/elements/site-search.js), and docs-sidebar for its own, unless SEARCH=0. It runs after
//    ssqch's build so its files aren't held to the site's budgets: they load only when someone
//    searches.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(root, "..");
const output = path.join(root, "dist");
const bin = process.env.SSQCH_BIN ?? path.join(repo, "packages", "ssqch", "bin", "ssqch.ts");
const command = bin.endsWith(".ts") ? [process.execPath, [bin]] as const : [bin, []] as const;
const GITHUB = "https://github.com/reverentgeek/sitesquatch";

/** Runs `ssqch build` with `args` and returns its JSON report, or stops the site's build on any error or warning. */
function build(name: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
	const run = spawnSync(command[0], [...command[1], "build", ...args, "--env", "production", "--format", "json", "--quiet"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env });
	if (run.error) throw run.error;
	let report;
	try {
		report = JSON.parse(run.stdout);
	} catch {
		process.stderr.write(run.stdout);
		console.error(`site: ssqch didn't print a report for ${name} (exit code ${run.status})`);
		process.exit(1);
	}
	for (const problem of [...report.errors, ...report.warnings]) {
		console.error(`${report.errors.includes(problem) ? "error" : "warning"} [${problem.code}] in ${name}: ${problem.message}`);
	}
	if (!report.ok || report.warnings.length > 0) {
		console.error(`site: ${name} ${report.ok ? `has ${report.warnings.length === 1 ? "a warning, which fails" : `${report.warnings.length} warnings, which fail`} the site's build` : "failed to build"}`);
		process.exit(1);
	}
	return report;
}

/** Every file below `dir`. */
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

// Pagefind's files from the last build would count against the budgets: they're made again after.
rmSync(path.join(output, "pagefind"), { recursive: true, force: true });

// 1. The examples.
const examplesDir = path.join(repo, "examples", "sites");
const examples = readdirSync(examplesDir).filter((name) => existsSync(path.join(examplesDir, name, "ssqch.config.js"))).sort();
const redirects: string[] = [];
const searched: string[] = [];
rmSync(path.join(output, "examples"), { recursive: true, force: true });
for (const name of examples) {
	const base = `/examples/${name}/`;
	const out = path.join(output, "examples", name);
	// Without SEARCH, docs-sidebar's own hook doesn't run Pagefind on its default folder; step 3 does it here.
	const { SEARCH: _search, ...env } = process.env;
	const report = build(name, ["--root", path.join(examplesDir, name), "--base", base, "--output", out], env);
	// Cloudflare reads _redirects at the root only: an example's rules go there, under its path.
	const own = path.join(out, "_redirects");
	if (existsSync(own)) {
		for (const line of readFileSync(own, "utf8").split("\n")) {
			const rule = line.trim();
			if (rule === "" || rule.startsWith("#")) continue;
			const [from, to, ...rest] = rule.split(/\s+/);
			// redirectsPlugin() writes its lines under the base already; a line of the example's own may not have it.
			const under = (url: string) => (url.startsWith("/") && !url.startsWith(base) ? `${base}${url.slice(1)}` : url);
			redirects.push([under(from), under(to), ...rest].join(" "));
		}
		rmSync(own);
	}
	// The trail marker: which example this is, and the way back to the gallery and to its source.
	// It's fixed in a corner, out of the example's own layout (a grid or flex <body> would make a
	// bar at the top one of its cells), and sets inline every property it shows, so the example's
	// stylesheet can't restyle it.
	const reset = "all:initial;box-sizing:border-box;font:600 13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff3d6";
	const link = (href: string, text: string) => `<a style="${reset};text-decoration:underline;cursor:pointer" href="${href}">${text}</a>`;
	const marker = `<div data-sitesquatch-marker style="${reset};position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;max-width:calc(100% - 24px);padding:7px 14px;border:2px solid #e8af43;border-radius:999px;background:#233b2b;box-shadow:0 2px 8px rgb(0 0 0 / 0.25)"><span style="${reset}">SiteSquatch example: <b style="${reset};font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace">${name}</b></span>${link(`/examples/#${name}`, "What it shows")}${link(`${GITHUB}/tree/main/examples/sites/${name}`, "Source")}${link("/examples/", "All examples")}</div>`;
	for (const file of walk(out).filter((f) => f.endsWith(".html"))) {
		const html = readFileSync(file, "utf8");
		// At the end of the <body>, after the page, for a screen reader.
		const marked = html.replace(/<\/body>/i, (end) => marker + end);
		if (marked !== html) writeFileSync(file, marked);
	}
	if (readFileSync(path.join(examplesDir, name, "ssqch.config.js"), "utf8").includes("pagefind")) searched.push(name);
	console.log(`  Example ${name}: ${report.pages.written} pages at ${base}`);
}

// 2. The site.
const report = build("the site", ["--root", root]);
for (const line of report.summary ?? []) console.log(typeof line === "string" ? line : `  ${line.label.padEnd(7)} ${line.value}`);
if (redirects.length) {
	const file = path.join(output, "_redirects");
	// Without the block an earlier build appended, when the site has no _redirects of its own to write over it.
	const MARK = "# The examples' redirects, under their paths (site/build.ts)";
	const own = existsSync(file) ? readFileSync(file, "utf8").split(MARK)[0].trimEnd() : "";
	writeFileSync(file, `${own ? `${own}\n` : ""}${MARK}\n${redirects.join("\n")}\n`);
	console.log(`  Redirects ${redirects.length} from the examples, in /_redirects`);
}

// 3. Search. Pinned: the index's format and the search UI's look come with the version.
const PAGEFIND = "pagefind@1.5.2";
if (process.env.SEARCH !== "0") {
	const npx = process.platform === "win32" ? "npx.cmd" : "npx";
	const pagefind = (site: string, ...more: string[]) => {
		const search = spawnSync(npx, ["--yes", PAGEFIND, "--site", site, ...more], { encoding: "utf8", shell: process.platform === "win32" });
		if (search.status !== 0) {
			process.stderr.write(search.stdout + search.stderr);
			console.error(`site: Pagefind (${PAGEFIND}) failed on ${site}. SEARCH=0 builds without the search.`);
			process.exit(1);
		}
		return /Indexed (\d+) pages?/.exec(search.stdout)?.[1] ?? "?";
	};
	// The site's own pages, not the examples' (docs-sidebar's pages mark their content for Pagefind too).
	console.log(`  Search  ${pagefind(output, "--glob", "{index.html,docs/**/*.html,changelog/**/*.html}")} pages indexed by ${PAGEFIND}`);
	for (const name of searched) console.log(`  Search  ${pagefind(path.join(output, "examples", name))} pages of ${name}`);
}
console.log(`site: built ${report.pages.written} pages and ${examples.length} examples into ${path.relative(process.cwd(), output) || "."} in ${Math.round(report.durationMs)} ms, with no warnings`);
