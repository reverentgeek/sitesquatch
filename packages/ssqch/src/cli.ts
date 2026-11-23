// The command line: every command and flag is the 0.7 binary's.
import { isIP } from "node:net";
import path from "node:path";
import util from "node:util";
import { Printed, UsageError, parse } from "./args.ts";
import type { Command, Grammar, Option } from "./args.ts";
import type { BuildReport } from "./build.ts";
import type { Config } from "./config.ts";
import { dirsOf, parseEnvironment, shownDir, shownOutput } from "./dirs.ts";
import type { Environment } from "./dirs.ts";
import * as diagnostics from "./diagnostics.ts";
import { Locator, bail } from "./diagnostics.ts";
import * as equivalents from "./equivalents.ts";
import type { Equivalent } from "./equivalents.ts";
// Each command's modules load when it runs (`import()` below): `ssqch serve` starts a server
// that never builds, and `--help` needs none of them.
import { DEFAULT_ENGINE } from "./commands/init.ts";
import type { NewCommand } from "./commands/new.ts";
import type { Field as TracedField, Trace } from "./trace.ts";
import { describeThrown } from "./modules.ts";
import { isDir, relative } from "./paths.ts";
import { prettyJson, quoted } from "./quote.ts";
import { BUILDER } from "./serve/builder.ts";
import type { BuilderStart } from "./serve/builder.ts";
import { VERSION } from "./version.ts";
import { bundled } from "./bundled.ts";

const FORMAT: Option = { long: "format", value: "FORMAT", help: "text or json", default: "text" };
// What 0.7 said for a number it couldn't read, word for word.
const digits = (value: string) => (/^\+?\d+$/.test(value) ? undefined : value === "" ? "cannot parse integer from empty string" : "invalid digit found in string");
const number = (value: string) => digits(value) ?? (BigInt(value) > 0xffff_ffff_ffff_ffffn ? "number too large to fit in target type" : undefined);
// An address to listen on: an IP address, or `localhost`.
const host = (value: string) => (value === "localhost" || isIP(value) !== 0 ? undefined : `${JSON.stringify(value)} isn't an IP address: use 0.0.0.0 for every network this machine is on, or one of its addresses (192.168.1.20)`);
const port = (value: string) => digits(value) ?? (BigInt(value) > 0x7fff_ffff_ffff_ffffn ? "number too large to fit in target type" : BigInt(value) > 65535n ? `${BigInt(value)} is not in 0..=65535` : undefined);

const GLOBALS: Option[] = [
	{ long: "root", value: "ROOT", path: true, help: "Project root (defaults to the current directory)" },
	{ long: "output", short: "o", value: "OUTPUT", path: true, help: "Override the output directory (relative to the root)" },
	{ long: "base", value: "BASE", help: "Serve the site under a path, like /repo/ (overrides the config's `base`)" },
	{ long: "offline", help: "Don't use the network: `fetch()` answers from the copies its `cache` option saved" },
	{ long: "env", value: "ENV", help: "development or production (default: $SSQCH_ENV, $NODE_ENV, then production for `build` and development for `serve`)" },
	{ long: "quiet", short: "q", help: "Print only warnings and errors" },
	{ long: "verbose", short: "v", help: "Also list every page written, and the slowest images to encode" },
];

const SHELLS = ["bash", "elvish", "fish", "powershell", "zsh"];

/** The commands, in the order `--help` lists them. `stage` marks one that isn't in the Node build yet, by the stage of the move that brings it. `own` marks one that other generators' flag aliases don't touch (`ssqch docs -- --starter`). */
const COMMANDS: Array<Command & { stage?: number; own?: boolean }> = [
	{
		name: "build",
		about: "Build the site (default)",
		options: [FORMAT, { long: "profile", help: "Also time every page, template, layout, engine, filter, transform, data file, collection and hook, and list the slowest" }],
		positionals: [],
		afterHelp: "With --format json, standard output is one JSON report: whether the build worked, what it wrote, and its\nwarnings and errors, each with a code, the file, the line when it's known, and the field for a content error.\nProgress lines and `console.log` go to standard error.",
	},
	{
		name: "serve",
		about: "Build, serve, watch for changes and live-reload the browser (--built serves the last build as it is)",
		options: [
			{ long: "port", short: "p", value: "PORT", help: "The port to listen on (0 picks a free one)", default: "8080", check: port },
			{ long: "host", value: "ADDRESS", help: "The address to listen on: 0.0.0.0 to open the site from a phone on the same network", default: "127.0.0.1", check: host },
			{ long: "built", help: "Serve the output folder as it was built: no build, no watching, no reload script, gzip on" },
			{ long: "ready-file", value: "FILE", path: true, help: "Write this file once the first build is done: JSON with the url, port and output folder" },
		],
		positionals: [],
		afterHelp: "With --built, it serves the output folder as the last build left it, the way a host would: no build, no\nwatching, no reload script, and text compressed with gzip. For checking a production build (Lighthouse,\na deploy's files) before it goes out:\n\n  ssqch build\n  ssqch serve --built\n\nA host's own rules (_redirects, _headers) aren't applied: the host's CLI serves with them (netlify dev,\nwrangler dev).",
	},
	{
		name: "new",
		about: "Create a page from a blueprint (a file in _blueprints/), with its title and date filled in",
		options: [
			{ long: "title", value: "TITLE", help: "The page's title (default: from the file's name)" },
			{ long: "date", value: "DATE", help: "The page's date, as it's written in front matter (default: today)" },
			{ long: "blueprint", value: "NAME", help: "The blueprint to use (default: the page's folder, then `default`)" },
			{ long: "set", value: "KEY=VALUE", help: "Another front matter key, with its value as it's written there (repeatable)", many: true },
			FORMAT,
		],
		positionals: [{ name: "PATH", help: "The new file, from the input folder (posts/pine-cones.md), or a folder, with --title", required: true }],
		afterHelp: "The blueprint is named after the page's folder (_blueprints/posts.md for posts/), then `default`.\nIts body is copied as it is; only front matter keys are filled in. Nothing is overwritten.\n\n  ssqch new posts/pine-cones.md\n  ssqch new posts --title \"Pine cones\"      (named like the other pages in posts/)\n  ssqch new docs/guides/install.md --set order=3 --set draft=true",
	},
	{
		name: "trace",
		about: "Follow a page's tracks: where it comes from, and which level of the data cascade set each value",
		options: [{ long: "field", value: "NAME", help: "One field of its data, in full, with every level that set it (a dotted path reaches inside: hero.alt)" }, FORMAT],
		positionals: [{ name: "PAGE", help: "The page: its URL (/about/), or its template's path", required: true }],
		afterHelp: "The site is read as a build reads it, up to rendering: beforeBuild hooks run (data can depend on them),\nbut no page is rendered or written, and afterBuild hooks don't run. Standard output is only the report.\n\n  ssqch trace /guides/install/\n  ssqch trace src/guides/install.md --field title\n  ssqch trace /guides/install/ --field hero.alt --format json",
	},
	{
		name: "completions",
		about: "Print a completion script for your shell, so Tab finishes commands and options",
		options: [],
		positionals: [{ name: "SHELL", help: "bash, zsh, fish, powershell or elvish", required: true, values: SHELLS }],
		afterHelp: "Put the script where your shell looks for completions:\n\n  ssqch completions zsh > ~/.zfunc/_ssqch        (with ~/.zfunc in $fpath, before compinit)\n  ssqch completions bash > ~/.local/share/bash-completion/completions/ssqch\n  ssqch completions fish > ~/.config/fish/completions/ssqch.fish\n  ssqch completions powershell >> $PROFILE",
		// Not `own`: in 0.7 it was one of the core's commands, so `-d` and `--pathprefix` work there.
	},
	{
		name: "diff", helpGlobals: ["quiet"],
		about: "Compare two builds of a site: URLs added and removed, and what changed on each page. Given three or more, list what varies between them",
		options: [
			{ long: "exact", help: "Compare bytes: don't match fingerprinted files or ignore whitespace" },
			{ long: "ungrouped", help: "List each file with all its changes, without grouping the ones shared by several files" },
			{ long: "text", help: "Compare the article text of each page, word by word, and say how much of it matches" },
			{ long: "ignore", value: "REGEX", help: "Leave out text matching this regular expression before comparing (repeatable)", many: true },
			{ long: "only", value: "GLOB", help: "Only compare files matching this glob, like '**/*.html' (repeatable)", many: true },
			{ long: "exclude", value: "GLOB", help: "Leave out files matching this glob, like 'img/**' (repeatable)", many: true },
			{ long: "lines", value: "LINES", help: "Changed lines to show for each file (0 for all)", default: "10", check: number },
			FORMAT,
		],
		positionals: [{ name: "BEFORE", help: "The build from before the change", required: true, path: true }, { name: "AFTER", help: "The build from after it", required: true, path: true }, { name: "MORE", help: "More builds: with three or more, which files vary between them (builds made the same way)", required: false, many: true, path: true }],
		afterHelp: "Build the site into one folder before a change and another after it:\n\n  ssqch build --output dist-before\n  (upgrade ssqch, edit a layout, ...)\n  ssqch build\n  ssqch diff dist-before dist\n\nTo see whether a build is the same every time (another generator's, before a move), build it three times and compare all three:\n\n  ssqch diff ref-1 ref-2 ref-3\n\nExits with 0 when the builds are the same, 1 when they differ, and 2 on an error.",
	},
	{
		name: "footprint",
		about: "Show how much a build weighs: its files by kind, and the heaviest pages and files",
		options: [{ long: "top", value: "TOP", help: "How many of the heaviest pages and files to list (0 for none)", default: "5", check: number }, FORMAT],
		positionals: [{ name: "DIR", help: "The build folder (default: the site's output folder)", required: false, path: true }],
		afterHelp: "It reads a build folder, so build first:\n\n  ssqch build\n  ssqch footprint                 (the site's output folder)\n  ssqch footprint dist-before     (any build)\n  ssqch footprint --top 20 --format json",
	},
	{
		name: "patrol",
		about: "Check a build for what agents and crawlers read: robots.txt, the sitemap, llms.txt, Markdown copies, headings and descriptions",
		options: [{ long: "url", value: "URL", help: "Also ask the deployed site at this address about ten of the build's pages, as an agent and as a browser" }, FORMAT],
		positionals: [{ name: "DIR", help: "The build folder (default: the site's output folder)", required: false, path: true }],
		afterHelp: "It reads a build folder, any generator's, so build first:\n\n  ssqch build\n  ssqch patrol                    (the site's output folder)\n  ssqch patrol _site              (another generator's build, before a move)\n  ssqch patrol --url https://example.com   (and how the deployed site answers)\n  ssqch patrol --format json\n\nEach warning has a code (`ssqch docs \"what patrol checks\"` says what each means). Exits with 0 when it found nothing, 1 when\nit warned, and 2 on an error.",
	},
	{
		name: "init",
		about: "Create a starter site (config, layout, seven posts, data and editor types)",
		options: [
			{ long: "starter", value: "NAME", help: "What to start with: site (a small blog) or docs (documentation with a sidebar, tabs and search)", default: "site" },
			{ long: "engine", value: "NAME", help: "The template language for the starter's layouts and templates: jinja, njk, edge, liquid, hbs or ejs", default: DEFAULT_ENGINE },
		],
		positionals: [{ name: "dir", help: "Where to create it (default: the current folder)", required: false, default: "." }],
		own: true,
	},
	{ name: "types", about: "Write ssqch.d.ts, the types editors use for ssqch.config.js", options: [{ long: "out", value: "out", help: "Where to write it", default: "ssqch.d.ts" }], positionals: [], own: true },
	{
		name: "scout", helpGlobals: [], strictGlobals: true,
		about: "Scout a site built with another generator: what moving it to ssqch takes, with file and line, and what's left during a move. Changes nothing unless asked",
		options: [
			{ long: "from", value: "GENERATOR", help: "The generator the site is built with, when it isn't the one scout finds: eleventy, jekyll, zola, hugo, mkdocs, docusaurus, astro, vitepress or hexo" },
			FORMAT,
			{ long: "write-draft", help: "Write the draft's new files (a config draft, directory data, includes, hooks); never overwrites a file" },
			{ long: "patch", value: "FILE", help: "Write the mechanical edits (renames, a data file's name, an attribute) to FILE as a patch to review; nothing is applied" },
			{ long: "compare", help: "Also build with ssqch and compare the output with the reference build, listing the biggest groups of differences: what to fix next" },
			{ long: "reference", value: "DIR", help: "The reference build --compare compares with (default: ssqch baseline's, .cache/ssqch/baseline/ref-common or ref-1)" },
		],
		positionals: [{ name: "dir", help: "The site's folder (default: the current folder)", required: false, default: "." }],
		afterHelp: "Run it before a move, and again during one to see what's left. `ssqch docs \"scouting a site\"` explains the report and its JSON, and `ssqch docs --from <generator>` prints each generator's trailhead.",
		own: true,
	},

	{
		name: "baseline", helpGlobals: ["root", "quiet"], strictGlobals: true, insteadOf: { output: "to" },
		about: "Build the site with its old generator, in fresh copies with the clock pinned, and compare the builds: what to compare ssqch's with",
		options: [
			{ long: "from", value: "DIR", help: "The folder the command writes (Eleventy and Jekyll: _site; Hugo: public; Astro: dist)", default: "_site" },
			{ long: "runs", value: "RUNS", help: "How many builds to make and compare", default: "3", check: number },
			{ long: "commit", value: "REV", help: "Build this commit instead of the working tree (the one before the move's first change)" },
			{ long: "to", value: "NAME", help: "Where the builds go: the default makes .cache/ssqch/baseline/ref-1, -2 and -3", default: ".cache/ssqch/baseline/ref" },
			{ long: "link", value: "PATH", help: "Link this folder of the site into each copy, as node_modules, .bundle and vendor/bundle are (repeatable)", many: true },
			{ long: "patch", value: "FILE", help: "Apply this patch (git diff's) to each copy before building: a fix the --commit needs to build" },
			{ long: "copy-installs", help: "Copy node_modules and the other installs into each copy instead of linking them, for a tool that won't follow a link out of its folder (Hugo's are copied without it)" },
		],
		positionals: [{ name: "COMMAND", help: "The old generator's build command, quoted: \"npx @11ty/eleventy\"", required: true, many: true }],
		afterHelp: "Each build runs in a fresh copy of the site (the files git would commit, or the --commit), with TZ=UTC, SOURCE_DATE_EPOCH and every file's time set to the commit's, and node_modules linked in. Then the builds are compared as `ssqch diff ref-1 ref-2 ref-3` compares them, so what changes by itself is known before anything is compared with ssqch's build.\n\n  ssqch baseline \"npx @11ty/eleventy\"\n  ssqch baseline \"bundle exec jekyll build\" --commit main\n  ssqch baseline \"npx @11ty/eleventy\" --commit HEAD~3 --patch fix-build.patch\n  ssqch diff ref-1 dist",
		own: true,
	},
	{ name: "capabilities", about: "Say what this binary supports: template languages, modules, config options and optional features", options: [FORMAT], positionals: [], own: true },
	{
		name: "docs",
		about: "Read the documentation for this version: a command, config option, function or topic",
		options: [
			{ long: "from", value: "GENERATOR", help: "Another generator's words and ssqch's names for them: eleventy, hugo, jekyll, zola, ..." },
			FORMAT,
		],
		positionals: [{ name: "NAME OR WORDS", help: "A name (base, imagePlugin, toc, serve), another generator's word (pathPrefix), or words from a heading (\"content schemas\")", required: false, many: true }],
		afterHelp: "Without a name, it lists everything, one line each.\n\n  ssqch docs\n  ssqch docs base\n  ssqch docs \"content schemas\"\n  ssqch docs pathPrefix          (another generator's word: says ssqch's)\n  ssqch docs --from eleventy\n  ssqch docs -- --starter        (a flag: after --)\n  ssqch docs agents > AGENTS.md  (instructions for coding agents)\n\nThe text is this version's README, built into the binary.",
		own: true,
	},
	{ name: "sighting", about: "Photographic evidence", options: [], positionals: [], hidden: true, own: true },
];

/**
 * The commands as `capabilities` lists them: `--help`'s order, but with `completions` after
 * `footprint`, where 0.7 had it (it was the last of the core's own commands there).
 */
const CAPABILITY_ORDER = (() => {
	const names = COMMANDS.filter((c) => !c.hidden && c.name !== "completions").map((c) => c.name);
	names.splice(names.indexOf("footprint") + 1, 0, "completions");
	return names;
})();

export const GRAMMAR: Grammar = { name: "ssqch", about: "SiteSquatch (ssqch): a fast, pluggable static site generator", version: VERSION, globals: GLOBALS, commands: COMMANDS };

/** The options that take a value, so it isn't taken for the command. */
const VALUED = ["--root", "--output", "-o", "--base", "--env", "-d", "--destination", "--pathprefix", "--port", "-p", "--ready-file", "--format", "--title", "--date", "--blueprint", "--set", "--field", "--ignore", "--only", "--exclude", "--lines", "--top", "--starter", "--engine"];
/** The commands that read their own arguments, and `scout` (0.7 read `import`'s line apart from the build's too): left as they are, so `-d` there is refused with its hint. */
const OWN = COMMANDS.filter((c) => c.raw || c.own).map((c) => c.name);

/**
 * The command line with other generators' words that are aliases in ssqch (`ssqch dev`,
 * `build --watch`, `-d dist`, `--pathprefix /x/`) put as ssqch's, and the rows used. The
 * commands that read their own arguments are left as they are, and so is everything after `--`.
 */
export function aliased(given: string[], own: string[] = OWN): [string[], Equivalent[]] {
	const args = [...given];
	let end = args.indexOf("--");
	if (end === -1) end = args.length;
	let command: number | undefined;
	for (let i = 0; i < end;) {
		if (args[i].startsWith("-")) i += VALUED.includes(args[i]) ? 2 : 1;
		else { command = i; break; }
	}
	const used: Equivalent[] = [];
	const name = command === undefined ? undefined : args[command];
	if (name !== undefined && own.includes(name)) return [args, used];
	const row = name === undefined ? undefined : equivalents.find(name, "command");
	if (command !== undefined && row?.alias) {
		// `preview` is `serve --built`: the command, then its flags.
		const words = row.ssqch.split(" ");
		args.splice(command, 1, ...words);
		end += words.length - 1;
		used.push(row);
	}
	let serve = false;
	for (let i = 0; i < end;) {
		const arg = args[i];
		const eq = arg.indexOf("=");
		const [flag, value] = eq !== -1 && arg.startsWith("--") ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
		const building = command === undefined || args[command] === "build" || args[command] === "serve";
		const found = flag.startsWith("-") ? equivalents.find(flag, "flag") : undefined;
		if (!found?.alias) {
			i += value === undefined && VALUED.includes(flag) && i !== command ? 2 : 1;
		} else if (found.ssqch === "serve" && !building) {
			// `--watch` and `--serve` are `ssqch serve`, from `build` (another command refuses them).
			i += 1;
		} else if (found.ssqch === "serve") {
			serve = true;
			used.push(found);
			args.splice(i, 1);
			end -= 1;
			if (command !== undefined && command > i) command -= 1;
		} else {
			// `-d dist` is `--output dist`, and `--destination=dist` is `--output=dist`.
			args[i] = value === undefined ? found.ssqch : `${found.ssqch}=${value}`;
			used.push(found);
			i += value === undefined ? 2 : 1;
		}
	}
	if (serve) {
		if (command === undefined) args.unshift("serve");
		else if (args[command] === "build") args[command] = "serve";
	}
	return [args, used];
}

/**
 * A command line that was refused. When the word it refused is another generator's (`ssqch
 * check`, `--drafts`), ssqch's name for it goes under the error, before the usage line.
 */
function refusal(e: UsageError): string {
	const equivalent = e.refused && equivalents.find(e.refused.word, e.refused.kind);
	if (!equivalent) return e.message;
	const at = e.message.indexOf("\nUsage:");
	const head = at === -1 ? e.message : e.message.slice(0, at);
	const usage = at === -1 ? "" : e.message.slice(at + 1);
	// The parser's own tips guess (`a similar subcommand exists`); the hint knows.
	const lines = head.split("\n").filter((line) => !line.trimStart().startsWith("tip:")).filter((line, i, all) => !(line.trim() === "" && i > 0 && all[i - 1].trim() === ""));
	const hint = equivalents.hint(equivalent).split("\n").map((line) => `  ${line}\n`).join("");
	return `${lines.join("\n").trimEnd()}\n\n${hint}${usage === "" ? "" : `\n${usage}`}`;
}

/** What a site's own `console` calls print: `log` is progress, and `warn` is one of a JSON report's warnings. */
function routeConsole(): void {
	const text = (args: unknown[]) => util.format(...args);
	console.log = console.info = console.debug = (...args: unknown[]) => diagnostics.progress(text(args));
	console.warn = (...args: unknown[]) => {
		if (diagnostics.isCapturing()) diagnostics.warn(diagnostics.warning("console", text(args)));
		else process.stderr.write(text(args) + "\n");
	};
	console.error = (...args: unknown[]) => { process.stderr.write(text(args) + "\n"); };
	// Node's warnings are a site's warnings too (`process.emitWarning`, which packages use where
	// they have it): said when they happen, and without the process id Node puts in front, so
	// logs repeat.
	const said = (name: string, message: string, code: unknown) => {
		// Not the site's doing: a `.js` config in a package that doesn't say `"type": "module"` (every
		// 0.7 site), and features Node still calls experimental.
		if (code === "MODULE_TYPELESS_PACKAGE_JSON" || name === "ExperimentalWarning") return;
		console.warn(`${name}: ${message}`);
	};
	process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
		if (warning instanceof Error) return said(warning.name, warning.message, (warning as { code?: unknown }).code);
		const options = rest[0];
		if (options !== null && typeof options === "object") return said((options as { type?: string }).type ?? "Warning", String(warning), (options as { code?: unknown }).code);
		said(typeof options === "string" ? options : "Warning", String(warning), typeof rest[1] === "string" ? rest[1] : undefined);
	}) as typeof process.emitWarning;
	// The ones Node raises itself arrive as events.
	process.removeAllListeners("warning");
	process.on("warning", (w) => said(w.name, w.message, (w as { code?: unknown }).code));
}

/** Where the site is, for an error that arrives outside the build's own flow. */
let siteRoot = process.cwd();

/** Reports an error nothing caught, and ends the run. */
export function crashed(e: unknown): never {
	process.stderr.write(`${diagnostics.red("error:")} ${describeThrown(e, siteRoot)}\n`);
	process.exit(1);
}

/** Runs ssqch with `argv` (without the program's name) and answers with the exit code. */
export async function main(argv: string[]): Promise<number> {
	// Started by `ssqch serve` to build for it (`serve/builder.ts`), with the server's own arguments.
	let building: BuilderStart | undefined;
	if (argv[0] === BUILDER && process.send !== undefined) {
		building = JSON.parse(argv[1]) as BuilderStart;
		argv = argv.slice(2);
	}
	const [args, aliases] = aliased(argv);
	let cli;
	try {
		cli = parse(GRAMMAR, args);
	} catch (e) {
		if (e instanceof Printed) { process.stdout.write(e.text); return 0; }
		if (e instanceof UsageError) { process.stderr.write(refusal(e)); return 2; }
		throw e;
	}
	const flag = (name: string) => cli.options[name] === true;
	const value = (name: string) => (typeof cli.options[name] === "string" ? cli.options[name] as string : undefined);
	diagnostics.setQuiet(flag("quiet"));
	const format = value("format") ?? "text";
	const command = cli.command ?? "build";
	// A JSON build keeps its notes for the report.
	if (command === "build" && format === "json") diagnostics.capture();
	// (The server has said the command line's own already.)
	if (building) diagnostics.aliasesKnown(aliases);
	else for (const row of aliases) diagnostics.aliasUsed(row);

	const later = COMMANDS.find((c) => c.name === command)?.stage;
	if (command !== "build" && later !== undefined) {
		process.stderr.write(`${diagnostics.red("error:")} \`ssqch ${command}\` isn't in the Node build of ssqch yet (the move to Node, stage ${later}); ssqch 0.7 has it\n`);
		return 1;
	}
	// It runs another generator, not ssqch's build, so nothing below applies either.
	if (command === "baseline") return (await import("./commands/baseline.ts")).runBaseline({ root: value("root") ?? ".", command: cli.positionals.join(" "), from: value("from") ?? "_site", runs: Number(value("runs") ?? "3"), commit: value("commit"), to: value("to") ?? ".cache/ssqch/baseline/ref", link: [cli.options.link ?? []].flat() as string[], patch: value("patch"), copyInstalls: flag("copy-installs"), quiet: flag("quiet") });
	// It reads the site's files as text and runs none of them, so nothing below applies.
	if (command === "scout") return (await import("./scout.ts")).runScout(cli.positionals[0] ?? ".", { from: value("from"), format: value("format") === "json" ? "json" : "text", writeDraft: flag("write-draft"), patch: value("patch"), compare: flag("compare") ? value("reference") ?? "" : undefined });

	// The commands that don't build the site.
	switch (command) {
		case "init": return (await import("./commands/init.ts")).runInit({ dir: cli.positionals[0] ?? ".", starter: value("starter") ?? "site", engine: value("engine") ?? DEFAULT_ENGINE, quiet: flag("quiet") });
		case "capabilities": return (await import("./commands/capabilities.ts")).runCapabilities(format, CAPABILITY_ORDER);
		case "docs": return (await import("./commands/docs.ts")).runDocs(GRAMMAR, { query: cli.positionals, from: value("from"), format });
		case "sighting": return (await import("./commands/sighting.ts")).runSighting(path.resolve(value("root") ?? "."));
		case "completions": {
			// 0.7's scripts, which clap made from the same grammar (bundled/completions/; a test
			// checks they name every command and option this grammar has).
			process.stdout.write(bundled(`completions/${cli.positionals[0]}`));
			return 0;
		}
		case "types": {
			routeConsole();
			return (await import("./commands/types.ts")).runTypes({ root: value("root"), out: value("out") ?? "ssqch.d.ts" });
		}
	}

	const many = (name: string) => (Array.isArray(cli.options[name]) ? cli.options[name] as string[] : typeof cli.options[name] === "string" ? [cli.options[name] as string] : []);
	const top = Number(value("top") ?? "5");
	// Two build folders need no config, and neither does a folder given to `footprint`.
	if (command === "diff") return runDiff(cli.positionals, { exact: flag("exact"), ignore: many("ignore"), only: many("only"), exclude: many("exclude"), ungrouped: flag("ungrouped"), text: flag("text"), lines: Number(value("lines") ?? "10"), format });
	if (command === "patrol" && cli.positionals[0] !== undefined) return runPatrol(cli.positionals[0], cli.positionals[0], format, value("url"));
	if (command === "footprint" && cli.positionals[0] !== undefined) {
		try {
			await runFootprint(cli.positionals[0], cli.positionals[0], top, format);
			return 0;
		} catch (e) {
			process.stderr.write(`${diagnostics.red("error:")} ${describeThrown(e, process.cwd())}\n`);
			return 1;
		}
	}
	// `ssqch trace` prints a report: what its hooks and `console.log` say goes to standard error.
	const tracing = command === "trace";
	if (tracing) diagnostics.capture();

	const serving = command === "serve";
	// The first of --env, $SSQCH_ENV and $NODE_ENV that's set; a word that's neither environment is the command's default.
	const given = value("env") ?? process.env.SSQCH_ENV ?? process.env.NODE_ENV;
	const env: Environment = (given === undefined ? undefined : parseEnvironment(given)) ?? (serving ? "development" : "production");
	// Read where requests are made (the site's `fetch`).
	if (flag("offline")) process.env.SSQCH_OFFLINE = "1";
	// Code that reads it sees the `--env` choice.
	process.env.SSQCH_ENV ??= env;
	const root = path.resolve(value("root") ?? ".");
	siteRoot = root;
	routeConsole();
	const makeConfig = async () => (await import("./config.ts")).loadConfig({ root, rootGiven: value("root") ?? ".", env, serving, quiet: flag("quiet") || tracing, verbose: flag("verbose"), profile: command === "build" && flag("profile"), output: value("output"), base: value("base") });

	if (command === "new") return newPage(makeConfig, root, { path: cli.positionals[0], title: value("title"), date: value("date"), blueprint: value("blueprint"), set: (cli.options.set as string[] | undefined) ?? [], format });
	if (serving) {
		if (building) return (await import("./serve/build-process.ts")).runBuilder(building, makeConfig, root);
		// From where the command was run, wherever the site's code runs.
		const readyFile = value("ready-file") === undefined ? undefined : path.resolve(value("ready-file")!);
		const options = { port: Number(value("port") ?? "8080"), host: value("host") ?? "127.0.0.1", readyFile, quiet: flag("quiet") };
		if (!flag("built")) {
			try {
				return await (await import("./serve/server.ts")).serve(argv, options);
			} catch (e) {
				diagnostics.printError("error:", e, "build", new Locator(root));
				return 1;
			}
		}
		let config: Config;
		try {
			config = await makeConfig();
		} catch (e) {
			diagnostics.printError("error:", e, "config", new Locator(root));
			return 1;
		}
		try {
			return await (await import("./serve/server.ts")).serveBuilt(config, options);
		} catch (e) {
			diagnostics.printError("error:", e, "build", locatorOf(config));
			return 1;
		}
	}
	if (command === "build" && format === "json") return buildJson(makeConfig, root, env);
	if (command === "build" && format !== "text") {
		process.stderr.write(`${diagnostics.red("error:")} --format ${format}: use text or json\n`);
		return 1;
	}
	// Where an error's files are, once the configuration has said: its lines are printed under it.
	let config: Config;
	try {
		config = await makeConfig();
	} catch (e) {
		diagnostics.printError("error:", e, "config", new Locator(root));
		return 1;
	}
	try {
		if (tracing) {
			await runTrace(config, cli.positionals[0], value("field"), format);
			return 0;
		}
		if (command === "patrol") return runPatrol(shownDir(config, config.output), shownOutput(config), format, value("url"));
		if (command === "footprint") {
			const dirs = dirsOf(config);
			// Read from the folder as 0.7 named it, so an error names it the same way (`nope/_site`).
			await runFootprint(shownDir(config, config.output), shownOutput(config), top, format);
			return 0;
		}
		const [{ build }, { summary, profileText }] = await Promise.all([import("./build.ts"), import("./report.ts")]);
		const report = await build(config);
		if (!config.quiet) process.stdout.write(summary(config, report));
		// Asked for, so printed even with --quiet.
		if (report.profile) process.stdout.write(profileText(report.profile));
		return 0;
	} catch (e) {
		diagnostics.printError("error:", e, "build", locatorOf(config));
		return 1;
	}
}

/** `ssqch new`: the page, or what went wrong, said as a build says it. */
async function newPage(makeConfig: () => Promise<Config>, root: string, command: NewCommand): Promise<number> {
	let config: Config;
	try {
		config = await makeConfig();
	} catch (e) {
		diagnostics.printError("error:", e, "config", new Locator(root));
		return 1;
	}
	try {
		(await import("./commands/new.ts")).runNew(config, command);
		return 0;
	} catch (e) {
		diagnostics.printError("error:", e, "build", locatorOf(config));
		return 1;
	}
}

const checkFormat = (format: string) => {
	if (format !== "text" && format !== "json") bail(`--format ${format}: use text or json`);
};

/** `ssqch trace`: prints where a page (or one field of its data) comes from. */
async function runTrace(config: Config, target: string, name: string | undefined, format: string): Promise<void> {
	checkFormat(format);
	const { field, fieldText, trace, traceJson, traceText } = await import("./trace.ts");
	let report: Trace;
	try {
		report = await trace(config, target);
	} finally {
		for (const found of diagnostics.takeWarnings()) process.stderr.write(`warn: ${found.message}\n`);
	}
	let one: TracedField | undefined;
	if (name !== undefined) {
		one = field(report, name);
		if (!one) bail(`${report.url ?? report.inputPath} has no \`${name.split(".")[0]}\` in its data (it has: ${report.fields.map((f) => f.name).join(", ")})`);
	}
	if (format === "json") process.stdout.write(prettyJson(traceJson(report, one)) + "\n");
	else process.stdout.write(one ? fieldText(one) : traceText(report));
}

/** `ssqch diff`: prints the comparison, and answers 0 when the builds are the same, 1 when they differ and 2 on an error. */
async function runDiff(dirs: string[], options: { exact: boolean; ignore: string[]; only: string[]; exclude: string[]; ungrouped: boolean; text: boolean; lines: number; format: string }): Promise<number> {
	const [before, after] = dirs;
	try {
		checkFormat(options.format);
		// Only `diff` reads Rust's regex syntax, so the translator loads with it.
		const [{ rustRegExp }, { globProblem, globToRegExp }, { compare, compareRuns, diffJson, diffText, isSame, runsJson, runsText }] = await Promise.all([import("./rust-regex.ts"), import("./glob.ts"), import("./diff.ts")]);
		const ignore = options.ignore.map((pattern) => {
			try { return rustRegExp(pattern, "g"); } catch (e) { return bail(`--ignore ${quoted(pattern)} isn't a regular expression: ${(e as Error).message}`); }
		});
		const globs = (flag: string, given: string[]) => given.map((one) => {
			// `/posts/x/`, a page's URL: everything in that folder (`posts/x/index.html`).
			const glob = one.replace(/^[./]+/, "").replace(/\/$/, "/**");
			const problem = globProblem(glob);
			if (problem !== undefined) bail(`--${flag} ${quoted(one)} isn't a glob: error parsing glob '${glob}': ${problem}`);
			return globToRegExp(glob);
		});
		const only = options.only.length ? globs("only", options.only) : undefined;
		const exclude = globs("exclude", options.exclude);
		// `--text`: how much of each page's article text matches, for a move that can't be byte for byte.
		if (options.text) {
			if (dirs.length > 2) bail("--text compares two builds; give it the reference and ssqch's (`ssqch diff ref dist --text`)");
			for (const dir of [before, after]) if (!isDir(dir)) bail(`${dir} isn't a folder; give \`ssqch diff --text\` two build folders, like \`ssqch diff .cache/ssqch/baseline/ref-1 dist --text\``);
			const { compareArticleText, textMatchJson, textMatchText, textSummary } = await import("./text-match.ts");
			const keep = (file: string) => (!only || only.some((re) => re.test(file))) && !exclude.some((re) => re.test(file));
			const report = compareArticleText(before, after, keep, ignore);
			if (options.format === "json") process.stdout.write(JSON.stringify(textMatchJson(report), null, 2) + "\n");
			else process.stdout.write(textMatchText(report, options.lines));
			const s = textSummary(report);
			return s.identical === s.pages && !s.missing.length ? 0 : 1;
		}
		if (dirs.length > 2) {
			const runs = await compareRuns(dirs, { exact: options.exact, ungrouped: options.ungrouped, ignore, only, onlyGiven: options.only, exclude, lines: options.lines });
			if (options.format === "json") process.stdout.write(JSON.stringify(runsJson(runs, options.lines), null, 2) + "\n");
			else process.stdout.write(runsText(runs, options.lines, process.stdout.isTTY === true));
			return runs.varies.length ? 1 : 0;
		}
		const report = await compare(before, after, { exact: options.exact, ungrouped: options.ungrouped, ignore, only, onlyGiven: options.only, exclude, lines: options.lines });
		if (options.format === "json") process.stdout.write(JSON.stringify(diffJson(report, options.lines), null, 2) + "\n");
		else process.stdout.write(diffText(report, options.lines, process.stdout.isTTY === true));
		return isSame(report) ? 0 : 1;
	} catch (e) {
		process.stderr.write(`${diagnostics.red("error:")} ${describeThrown(e, process.cwd())}\n`);
		return 2;
	}
}

/** `ssqch patrol`: what agents and crawlers find in the build in `dir`, and with `url`, how the deployed site answers them. 0 when it's clear, 1 when it warned, 2 on an error. */
async function runPatrol(dir: string, shown: string, format: string, url?: string): Promise<number> {
	try {
		checkFormat(format);
		const { patrol, patrolJson, patrolLive, patrolText } = await import("./patrol.ts");
		const report = url === undefined ? patrol(dir) : await patrolLive(patrol(dir), url);
		process.stdout.write(format === "json" ? JSON.stringify(patrolJson(report, shown), null, 2) + "\n" : patrolText(report, shown));
		return report.findings.length ? 1 : 0;
	} catch (e) {
		process.stderr.write(`${diagnostics.red("error:")} ${describeThrown(e, process.cwd())}\n`);
		return 2;
	}
}

/** `ssqch footprint`: what the build in `dir` weighs. `shown` is how the report names the folder. */
async function runFootprint(dir: string, shown: string, top: number, format: string): Promise<void> {
	checkFormat(format);
	const { footprintJson, footprintText, measure } = await import("./footprint.ts");
	const measured = await measure(dir);
	if (format === "json") process.stdout.write(JSON.stringify(footprintJson(measured, shown, top), null, 2) + "\n");
	else process.stdout.write(footprintText(measured, shown, top));
}

/** Where a site's files can be named from: its root, its input, includes and data folders, and its themes'. */
export function locatorOf(config: Config): Locator {
	const dirs = dirsOf(config);
	return new Locator(dirs.root, [dirs.input, dirs.includes, dirs.data, ...config.themes.flatMap((theme) => [theme, path.join(theme, "_includes")])]);
}

/** Milliseconds with three digits after the point, as the report writes them. */
const ms = (n: number) => Math.round(n * 1000) / 1000;

/** `ssqch build --format json`: build, and print one JSON report on standard output whether or not it worked. */
async function buildJson(makeConfig: () => Promise<Config>, root: string, env: Environment): Promise<number> {
	diagnostics.capture();
	const out: Record<string, unknown> = { schemaVersion: 1, ok: false, environment: env };
	let errors: diagnostics.Diagnostic[];
	let config: Config | undefined;
	try {
		config = await makeConfig();
	} catch (e) {
		errors = diagnostics.fromError(e, "config", new Locator(root));
	}
	if (config) {
		const dirs = dirsOf(config);
		out.output = shownOutput(config);
		try {
			const report: BuildReport = await (await import("./build.ts")).build(config);
			out.durationMs = ms(report.durationMs);
			out.pages = { written: report.pagesWritten, templates: report.templates, bytes: report.pageBytes, new: report.pagesNew ?? null, gone: report.pagesGone ?? null };
			out.copied = { files: report.filesCopied, unchanged: report.filesUnchanged, bytes: report.passthroughBytes };
			out.removed = report.filesRemoved;
			out.drafts = report.drafts;
			out.written = report.written.map((file) => relative(dirs.output, file));
			out.summary = report.summary.map(([label, text]) => ({ label, value: text }));
			out.timings = report.timings.map(([phase, time]) => ({ phase, ms: ms(time) }));
			if (report.profile) out.profile = Object.fromEntries(Object.entries(report.profile).map(([kind, list]) => [kind, list.map((e) => ({ name: e.name, calls: e.calls, ms: ms(e.ms), async: e.async }))]));
			errors = [];
		} catch (e) {
			errors = diagnostics.fromError(e, "build", locatorOf(config));
		}
	}
	out.ok = errors!.length === 0;
	out.warnings = diagnostics.takeWarnings().map(diagnostics.toJson);
	// Other generators' words the site used that work as ssqch's (`pathPrefix`): not warnings.
	out.aliases = diagnostics.aliasesUsed().map(equivalents.toJson);
	out.errors = errors!.map(diagnostics.toJson);
	process.stdout.write(JSON.stringify(out, null, 2) + "\n");
	return errors!.length === 0 ? 0 : 1;
}
