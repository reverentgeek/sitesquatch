// The command line: every command and flag is the 0.7 binary's.
import path from "node:path";
import util from "node:util";
import { Printed, UsageError, parse } from "./args.ts";
import type { Command, Grammar, Option } from "./args.ts";
import { build } from "./build.ts";
import type { BuildReport } from "./build.ts";
import { dirsOf, loadConfig, parseEnvironment } from "./config.ts";
import type { Config, Environment } from "./config.ts";
import * as diagnostics from "./diagnostics.ts";
import { Locator } from "./diagnostics.ts";
import * as equivalents from "./equivalents.ts";
import type { Equivalent } from "./equivalents.ts";
import { runCapabilities } from "./commands/capabilities.ts";
import { runDocs } from "./commands/docs.ts";
import { DEFAULT_ENGINE, runInit } from "./commands/init.ts";
import { runNew } from "./commands/new.ts";
import { runSighting } from "./commands/sighting.ts";
import { runTypes } from "./commands/types.ts";
import { describeThrown } from "./modules.ts";
import { relative } from "./paths.ts";
import { summary } from "./report.ts";
import { VERSION } from "./version.ts";

const FORMAT: Option = { long: "format", value: "FORMAT", help: "text or json", default: "text" };
// What 0.7 said for a number it couldn't read, word for word.
const digits = (value: string) => (/^\+?\d+$/.test(value) ? undefined : value === "" ? "cannot parse integer from empty string" : "invalid digit found in string");
const number = (value: string) => digits(value) ?? (BigInt(value) > 0xffff_ffff_ffff_ffffn ? "number too large to fit in target type" : undefined);
const port = (value: string) => digits(value) ?? (BigInt(value) > 0x7fff_ffff_ffff_ffffn ? "number too large to fit in target type" : BigInt(value) > 65535n ? `${BigInt(value)} is not in 0..=65535` : undefined);

const GLOBALS: Option[] = [
	{ long: "root", value: "ROOT", help: "Project root (defaults to the current directory)" },
	{ long: "output", short: "o", value: "OUTPUT", help: "Override the output directory (relative to the root)" },
	{ long: "base", value: "BASE", help: "Serve the site under a path, like /repo/ (overrides the config's `base`)" },
	{ long: "offline", help: "Don't use the network: `fetch()` answers from the copies its `cache` option saved" },
	{ long: "env", value: "ENV", help: "development or production (default: $SSQCH_ENV, $NODE_ENV, then production for `build` and development for `serve`)" },
	{ long: "quiet", short: "q", help: "Print only warnings and errors" },
	{ long: "verbose", short: "v", help: "Also list the slowest images to encode" },
];

const SHELLS = ["bash", "elvish", "fish", "powershell", "zsh"];

/** The commands, in the order `--help` lists them. `stage` marks one that isn't in the Node build yet, by the stage of the move that brings it. `own` marks one that other generators' flag aliases don't touch (`ssqch docs -- --starter`). */
const COMMANDS: Array<Command & { stage?: number; own?: boolean }> = [
	{
		name: "build",
		about: "Build the site (default)",
		options: [FORMAT],
		positionals: [],
		afterHelp: "With --format json, standard output is one JSON report: whether the build worked, what it wrote, and its\nwarnings and errors, each with a code, the file, the line when it's known, and the field for a content error.\nProgress lines and `console.log` go to standard error.",
	},
	{
		name: "serve",
		about: "Build, serve, watch for changes and live-reload the browser",
		options: [
			{ long: "port", short: "p", value: "PORT", help: "The port to listen on (0 picks a free one)", default: "8080", check: port },
			{ long: "built", help: "Serve the output folder as it was built: no build, no watching, no reload script, gzip on" },
			{ long: "ready-file", value: "FILE", help: "Write this file once the first build is done: JSON with the url, port and output folder" },
		],
		positionals: [],
		afterHelp: "With --built, it serves the output folder as the last build left it, the way a host would: no build, no\nwatching, no reload script, and text compressed with gzip. For checking a production build (Lighthouse,\na deploy's files) before it goes out:\n\n  ssqch build\n  ssqch serve --built",
		stage: 6,
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
		name: "inspect",
		about: "Show where a page comes from, and which level of the data cascade set each value",
		options: [{ long: "field", value: "NAME", help: "One field of its data, in full, with every level that set it (a dotted path reaches inside: hero.alt)" }, FORMAT],
		positionals: [{ name: "PAGE", help: "The page: its URL (/about/), or its template's path", required: true }],
		afterHelp: "The site is read as a build reads it, up to rendering: beforeBuild hooks run (data can depend on them),\nbut no page is rendered or written, and afterBuild hooks don't run. Standard output is only the report.\n\n  ssqch inspect /guides/install/\n  ssqch inspect src/guides/install.md --field title\n  ssqch inspect /guides/install/ --field hero.alt --format json",
		stage: 4,
	},
	{
		name: "completions",
		about: "Print a completion script for your shell, so Tab finishes commands and options",
		options: [],
		positionals: [{ name: "SHELL", help: "bash, zsh, fish, powershell or elvish", required: true, values: SHELLS }],
		afterHelp: "Put the script where your shell looks for completions:\n\n  ssqch completions zsh > ~/.zfunc/_ssqch        (with ~/.zfunc in $fpath, before compinit)\n  ssqch completions bash > ~/.local/share/bash-completion/completions/ssqch\n  ssqch completions fish > ~/.config/fish/completions/ssqch.fish\n  ssqch completions powershell >> $PROFILE",
		stage: 4,
	},
	{
		name: "diff",
		about: "Compare two builds of a site: URLs added and removed, and what changed on each page",
		options: [
			{ long: "exact", help: "Compare bytes: don't match fingerprinted files or ignore whitespace" },
			{ long: "ignore", value: "REGEX", help: "Leave out text matching this regular expression before comparing (repeatable)", many: true },
			{ long: "only", value: "GLOB", help: "Only compare files matching this glob, like '**/*.html' (repeatable)", many: true },
			{ long: "lines", value: "LINES", help: "Changed lines to show for each file (0 for all)", default: "10", check: number },
			FORMAT,
		],
		positionals: [{ name: "BEFORE", help: "The build from before the change", required: true }, { name: "AFTER", help: "The build from after it", required: true }],
		afterHelp: "Build the site into one folder before a change and another after it:\n\n  ssqch build --output dist-before\n  (upgrade ssqch, edit a layout, ...)\n  ssqch build\n  ssqch diff dist-before dist\n\nExits with 0 when the builds are the same, 1 when they differ, and 2 on an error.",
		stage: 4,
	},
	{
		name: "footprint",
		about: "Show how much a build weighs: its files by kind, and the heaviest pages and files",
		options: [{ long: "top", value: "TOP", help: "How many of the heaviest pages and files to list (0 for none)", default: "5", check: number }, FORMAT],
		positionals: [{ name: "DIR", help: "The build folder (default: the site's output folder)", required: false }],
		afterHelp: "It reads a build folder, so build first:\n\n  ssqch build\n  ssqch footprint                 (the site's output folder)\n  ssqch footprint dist-before     (any build)\n  ssqch footprint --top 20 --format json",
		stage: 4,
	},
	{
		name: "init",
		about: "Create a starter site (config, layout, five posts, data and editor types)",
		options: [
			{ long: "starter", value: "NAME", help: "What to start with: site (a small blog) or docs (documentation with a sidebar, tabs and search)", default: "site" },
			{ long: "engine", value: "NAME", help: "The template language for the starter's layouts and templates: jinja, njk, edge, liquid, hbs or ejs", default: DEFAULT_ENGINE },
		],
		positionals: [{ name: "dir", help: "Where to create it (default: the current folder)", required: false, default: "." }],
		own: true,
	},
	{ name: "types", about: "Write ssqch.d.ts, the types editors use for ssqch.config.js", options: [{ long: "out", value: "out", help: "Where to write it", default: "ssqch.d.ts" }], positionals: [], own: true },
	// Reads its own arguments, with the code that runs it (stage 7).
	{ name: "import", about: "Move a site from another generator: rename and rewrite what's mechanical, and list the rest", options: [], positionals: [], raw: true, stage: 7 },
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

const GRAMMAR: Grammar = { name: "ssqch", about: "SiteSquatch (ssqch): a fast, pluggable static site generator", version: VERSION, globals: GLOBALS, commands: COMMANDS };

/** The options that take a value, so it isn't taken for the command. */
const VALUED = ["--root", "--output", "-o", "--base", "--env", "-d", "--destination", "--pathprefix", "--port", "-p", "--ready-file", "--format", "--title", "--date", "--blueprint", "--set", "--field", "--ignore", "--only", "--lines", "--top", "--starter", "--engine"];
/** The commands that read their own arguments: left as they are. */
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
	for (const row of aliases) diagnostics.aliasUsed(row);

	const later = COMMANDS.find((c) => c.name === command)?.stage;
	if (command !== "build" && later !== undefined) {
		process.stderr.write(`${diagnostics.red("error:")} \`ssqch ${command}\` isn't in the Node build of ssqch yet (the move to Node, stage ${later}); ssqch 0.7 has it\n`);
		return 1;
	}

	// The commands that don't build the site.
	switch (command) {
		case "init": return runInit({ dir: cli.positionals[0] ?? ".", starter: value("starter") ?? "site", engine: value("engine") ?? DEFAULT_ENGINE, quiet: flag("quiet") });
		case "capabilities": return runCapabilities(format, COMMANDS.filter((c) => !c.hidden).map((c) => c.name));
		case "docs": return runDocs(GRAMMAR, { query: cli.positionals, from: value("from"), format });
		case "sighting": return runSighting(path.resolve(value("root") ?? "."));
		case "types": {
			routeConsole();
			return runTypes({ root: value("root"), out: value("out") ?? "ssqch.d.ts" });
		}
	}

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
	const makeConfig = () => loadConfig({ root, env, serving, quiet: flag("quiet"), verbose: flag("verbose"), output: value("output"), base: value("base") });

	if (command === "new") return newPage(makeConfig, root, { path: cli.positionals[0], title: value("title"), date: value("date"), blueprint: value("blueprint"), set: (cli.options.set as string[] | undefined) ?? [], format });
	if (format === "json") return buildJson(makeConfig, root, env);
	if (format !== "text") {
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
		const report = await build(config);
		if (!config.quiet) process.stdout.write(summary(config, report));
		return 0;
	} catch (e) {
		diagnostics.printError("error:", e, "build", locatorOf(config));
		return 1;
	}
}

/** `ssqch new`: the page, or what went wrong, said as a build says it. */
async function newPage(makeConfig: () => Promise<Config>, root: string, command: Parameters<typeof runNew>[1]): Promise<number> {
	let config: Config;
	try {
		config = await makeConfig();
	} catch (e) {
		diagnostics.printError("error:", e, "config", new Locator(root));
		return 1;
	}
	try {
		runNew(config, command);
		return 0;
	} catch (e) {
		diagnostics.printError("error:", e, "build", locatorOf(config));
		return 1;
	}
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
		out.output = relative(dirs.root, dirs.output);
		try {
			const report: BuildReport = await build(config);
			out.durationMs = ms(report.durationMs);
			out.pages = { written: report.pagesWritten, templates: report.templates, bytes: report.pageBytes, new: report.pagesNew ?? null, gone: report.pagesGone ?? null };
			out.copied = { files: report.filesCopied, unchanged: report.filesUnchanged, bytes: report.passthroughBytes };
			out.removed = report.filesRemoved;
			out.drafts = report.drafts;
			out.written = report.written.map((file) => relative(dirs.output, file));
			out.summary = report.summary.map(([label, text]) => ({ label, value: text }));
			out.timings = report.timings.map(([phase, time]) => ({ phase, ms: ms(time) }));
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
