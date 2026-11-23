// A site's configuration: `ssqch.config.js` (or `.mjs`, `.cjs`, `.ts`, `.mts`), or
// `sitesquatch.toml`, read into one `Config` that the build works from.
//
// The contract is `ssqch.d.ts`, and the checks and their messages are 0.7's: a config (or a
// plugin) is a plain object, or a function returning one (sync or async) that gets
// `{ env, serving }`. Settings only make sense once, so they're allowed at the top level only.
// Everything else can also come from a plugin, and is applied in order: the config's own entries
// first, then each plugin's, depth first.
import type { EngineKind } from "./engines/engine.ts";
import fs from "node:fs";
import path from "node:path";
import * as api from "./api.ts";
import { normalizeBase } from "./base.ts";
import { budget } from "./budgets.ts";
import { parseSchema } from "./schema.ts";
import type { Schema } from "./schema.ts";
import { BuildError, aliasUsed, bail, context, error, messageOf, warn, warning } from "./diagnostics.ts";
import type { Data, DataLoader } from "./data.ts";
import { isPlainObject, readToml, tomlReason } from "./data.ts";
import { TomlError } from "smol-toml";
import * as equivalents from "./equivalents.ts";
import type { Equivalent } from "./equivalents.ts";
import { checkLanguages } from "./engines/markdown.ts";
import { installFetch, summary as fetchSummary } from "./fetch.ts";
import { useImages } from "./image/processor.ts";
import { addMarkdownSteps, applyMarkdownOptions, defaultMarkdownOptions } from "./markdown-options.ts";
import type { MarkdownOptions } from "./markdown-options.ts";
import { describeThrown, hookModules, importFile, loadedFiles, settle, watchSettle } from "./modules.ts";
import { withPage } from "./rendering.ts";
import { loadRustPart } from "./rust-plugin.ts";
import { resolveTheme } from "./theme.ts";
import { compareText, realPath, slashes } from "./paths.ts";
import { bundledPath } from "./bundled.ts";
import { CONFIG_FILES } from "./dirs.ts";
import type { Environment } from "./dirs.ts";
// The folders, config file names and environments live in dirs.ts, which the dev server loads
// without the rest of this.
export { CONFIG_FILES, dirsOf, parseEnvironment, shownDir, shownOutput } from "./dirs.ts";
export type { Dirs, Environment } from "./dirs.ts";

export type Filter = (...args: any[]) => unknown;
/** A site's own engine, as ssqch calls it: `name` is for messages; `context` is what the engine's function gets as its third argument. */
export type EngineFn = (source: string, data: Data, name: string, context: { kind: EngineKind; path: string }) => string | Promise<string>;
export type TransformFn = (content: string, page: { url: string; inputPath: string; outputPath: string }) => string | Promise<string>;
export type CollectionFn = (items: any[]) => unknown;
/** A hook: the site's function (told about the build), or a command to run. */
export type Hook = { label: string; fn: (event: Data) => unknown } | { run: string };

/** A file a plugin adds to the output: a URL path (`/sitemap.xml`) and its contents. */
export interface GeneratedFile {
	path: string;
	/** Text, or bytes for a binary file (a font, an image). */
	contents: string | Uint8Array;
	/** Add to the end of a file a page wrote at the same path, instead of it being a conflict. */
	append?: boolean;
	/** A site's `_includes/hooks/<name>.*` template that writes this file instead of `contents`, if it has one: it gets `value` as `<name>`, next to the global data. Generators' files only. */
	hook?: { name: string; value: unknown };
}

/** A page the build wrote, as generators see it. */
export interface PageSummary {
	url: string;
	outputPath: string;
	inputPath: string;
	date: Date;
	data: Data;
}

export interface Config {
	/** The project root, absolute and real; every relative path is from here. */
	root: string;
	/** The root as the command line gave it (`--root site`), which 0.7's messages named paths from when it isn't there. */
	rootGiven: string;
	/** The file the configuration came from, if any. */
	file: string | null;
	env: Environment;
	/** True while running the development server. */
	serving: boolean;
	/** While serving, the files whose change started this build (absolute), for `beforeBuild`'s `changed`; undefined for a build of everything. */
	changed?: string[];
	quiet: boolean;
	verbose: boolean;
	/** `ssqch build --profile`: time every filter, transform, engine, layout, data file, collection, hook and page (src/profile.ts). */
	profile: boolean;
	/** Where each filter, collection, transform and data function came from, by `filters.<name>` (`ssqch.config.js`, `plugin "toc"`), for a `slow-call` warning. */
	definedIn: Map<string, string>;
	/** The folders as the config gives them: `input` and `output` from the root, the rest from the input folder. */
	input: string;
	output: string;
	includes: string;
	layouts: string | null;
	data: string;
	templateFormats: string[];
	/** The engine that pre-processes Markdown files before Markdown renders them. */
	markdownEngine: string | null;
	/** The engine that pre-processes `.html` files. */
	htmlEngine: string | null;
	markdown: MarkdownOptions;
	deepMerge: boolean;
	leaveNoTrace: boolean;
	ignore: string[];
	bundles: boolean;
	strict: boolean;
	/** `jekyllTemplates`: templates see Jekyll's `page` (front matter too) and `site` (`posts`, collections, `data`, `categories`). */
	jekyllTemplates: boolean;
	/** `mkdocsTemplates`: the mkdocs.yml (from the root) whose context templates see, as MkDocs gives a theme's (`config`, `nav`, `page`, `base_url`, the `url` filter), or `null`. */
	mkdocsTemplates: string | null;
	/** `jinja.autoescape`: whether `.jinja` templates escape what they print. `null` is the default: they do, unless `mkdocsTemplates` is on (MkDocs' Jinja doesn't). */
	jinjaAutoescape: boolean | null;
	lastModified: "git" | "file" | null;
	/** `dateFallback`: the date of a page with none of its own (in its data or its file name): `"git"` for the last commit that changed its file, or `"file"` for the file's time. */
	dateFallback: "git" | "file";
	/** `layoutAliases`: other names for layouts (`post` for `layouts/post.njk`), as Eleventy's `addLayoutAlias` gave them. */
	layoutAliases: Map<string, string>;
	/** `timeZone`: the IANA zone the site's JavaScript runs in (`process.env.TZ`), or null for the machine's. */
	timeZone: string | null;
	/** `urls`: a page's URL without a permalink: `/guide/intro/` (`"folders"`) or `/guide/intro.html` (`"html"`). */
	urls: "folders" | "html";
	/** The path the site is served under: empty for the domain's root, or `/repo` (no `/` at the end). */
	base: string;
	serveRun: string[];
	/** Size budgets by kind of file, in bytes. */
	budgets: Array<[string, number]>;
	/** Content schemas, in the order they were added; one with the same name replaces the earlier one. */
	schemas: Schema[];
	/** The themes' folders, the one on top first. */
	themes: string[];

	passthrough: Array<{ from: string; to?: string }>;
	/**
	 * Passthrough destinations (absolute paths) a plugin has already written under another name,
	 * to that name: the assets plugin copies a listed file in before the pages and renames it to
	 * its fingerprinted name. The copy step leaves these out, so the plain file doesn't come back
	 * beside the renamed one, and records the other name as the build's own.
	 */
	renamedCopies: Map<string, string>;
	/** Functions every template can call, by name, in the order they were added. */
	filters: Map<string, Filter>;
	/** The names in `filters` that the site's config and its own plugins defined (not ssqch's built-in plugins). */
	siteFilters: Set<string>;
	globalData: Array<{ name: string; value?: unknown; fn?: () => unknown }>;
	dataExtensions: Map<string, DataLoader>;
	collections: Array<[string, CollectionFn]>;
	transforms: Array<[string, TransformFn]>;
	/** Transforms that run before every other, whatever order plugins were added in (images). */
	htmlTransforms: Array<[string, TransformFn]>;
	/** While `llmsPlugin()` is on: each Markdown page's text as its Markdown engine got it (after its template engine), by URL, for the page's copy. */
	markdownSources?: Map<string, string>;
	/** While `sitemapPlugin()` is on: the sitemap's whole address (with `base`), for robots.txt's `Sitemap:` line. */
	sitemap?: () => string;
	/** The `markdown` options the site's config sets itself, which plugins' `defaults` don't replace. */
	markdownGiven: Set<string>;
	/** With fromVitepress(): vuePlugin() gives components VitePress's `useData()`, `@theme/` and data loaders. */
	vitepress: boolean;
	/** Plugins that render a component tag the site has no template for (`vuePlugin()`): its HTML, or `undefined` for one it doesn't know. Asked in order, after `_includes/components/`. */
	componentRenderers: Array<(name: string, value: { name: string; props: Record<string, unknown>; content: string; attrs: string; bindings: Record<string, string> }, inputPath: string, data: Data) => string | undefined>;
	engines: Map<string, EngineFn>;
	/** The caches of engines with `cache: true`, which each build starts (`startBuild`). */
	engineCaches: EngineCache[];
	beforeBuild: Hook[];
	afterBuild: Hook[];
	watch: string[];
	plugins: string[];
	/** Lines plugins add to the build summary; a function that answers nothing leaves its line out. */
	summaries: Array<[string, (config: Config) => string | undefined]>;
	generators: Array<[string, (config: Config, pages: PageSummary[]) => GeneratedFile[] | Promise<GeneratedFile[]>]>;
	fileBuilders: Array<[string, (config: Config) => GeneratedFile[] | Promise<GeneratedFile[]>]>;
	/** What the build waits for once every page is written (the image files they point at), before the generators; counted as writing. */
	settle: Array<() => Promise<void>>;
}

export interface ConfigOptions {
	root: string;
	/** `--root` as it was given, for messages (default: `root`). */
	rootGiven?: string;
	env: Environment;
	serving?: boolean;
	quiet?: boolean;
	verbose?: boolean;
	profile?: boolean;
	/** `--output`: overrides the config's output folder. */
	output?: string;
	/** `--base`: overrides the config's `base`. */
	base?: string;
}


/** What a site gets without setting them: Jinja is the default template language, so pages are `.jinja` and Markdown and HTML go through it first (`ssqch capabilities` says so). */
export const DEFAULTS = { templateFormats: ["jinja", "md", "html"], markdownEngine: "jinja", htmlEngine: "jinja" } as const;

function emptyConfig(options: ConfigOptions): Config {
	return {
		root: realPath(path.resolve(options.root)),
		rootGiven: options.rootGiven ?? options.root,
		file: null,
		env: options.env,
		serving: options.serving ?? false,
		quiet: options.quiet ?? false,
		verbose: options.verbose ?? false,
		profile: options.profile ?? false,
		definedIn: new Map(),
		input: ".",
		output: "_site",
		includes: "_includes",
		layouts: null,
		data: "_data",
		templateFormats: [...DEFAULTS.templateFormats],
		markdownEngine: DEFAULTS.markdownEngine,
		htmlEngine: DEFAULTS.htmlEngine,
		markdown: defaultMarkdownOptions(),
		deepMerge: true,
		leaveNoTrace: false,
		ignore: [],
		bundles: false,
		strict: false,
		jekyllTemplates: false,
		mkdocsTemplates: null,
		jinjaAutoescape: null,
		lastModified: null,
		dateFallback: "file",
		timeZone: null,
		urls: "folders",
		layoutAliases: new Map(),
		base: "",
		serveRun: [],
		budgets: [],
		schemas: [],
		themes: [],
		passthrough: [],
		renamedCopies: new Map(),
		filters: new Map(),
		siteFilters: new Set(),
		globalData: [],
		dataExtensions: new Map(),
		collections: [],
		transforms: [],
		htmlTransforms: [],
		markdownGiven: new Set(),
		vitepress: false,
		engines: new Map(),
		engineCaches: [],
		beforeBuild: [],
		afterBuild: [],
		watch: [],
		plugins: [],
		summaries: [],
		generators: [],
		componentRenderers: [],
		fileBuilders: [],
		settle: [],
	};
}


/** The config file in `root`, if there is one. */
export function findConfig(root: string): string | undefined {
	return CONFIG_FILES.map((name) => path.join(root, name)).find((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile());
}

/** Reads the site's configuration. `ssqch serve` calls this again when a config file changes. */
export async function loadConfig(options: ConfigOptions): Promise<Config> {
	const config = emptyConfig(options);
	hookModules();
	// A site's code runs in its project root, as 0.7 ran it: `process.cwd()`, `fs.readFileSync("x")`
	// and `readData("x")` are all from there.
	// (A root that isn't there is the build's to report: nothing can be read from it.)
	if (fs.statSync(config.root, { throwIfNoEntry: false })?.isDirectory()) process.chdir(config.root);
	Object.assign(api.site, { root: config.root, input: null, markdown: null });
	// `fetch` gets 0.7's error words and its `cache` option, before any of the site's code runs.
	installFetch(config.root);
	config.summaries.push(["Fetch", fetchSummary]);
	// JavaScript data files (`_data/*.js`, `*.data.js`): the default export is the data, or a
	// function (sync or async) that returns it, called on every build.
	for (const ext of ["js", "mjs", "cjs", "ts", "mts"]) config.dataExtensions.set(ext, (file) => loadJsData(file, config.root));

	const toml = path.join(config.root, "sitesquatch.toml");
	const hasToml = fs.statSync(toml, { throwIfNoEntry: false })?.isFile() ?? false;
	const js = findConfig(config.root);
	if (js && hasToml) bail(`found both ${path.basename(js)} and sitesquatch.toml; keep one of them`);
	if (js) {
		config.file = js;
		await loadJs(config, js);
	} else {
		// Another generator's site: say what to do, rather than building it as ssqch's.
		if (!hasToml) {
			const message = equivalents.otherGenerator(config.root);
			if (message) warn(warning("other-generator", message));
		} else {
			config.file = toml;
			applyToml(config, toml);
		}
	}
	if (options.output !== undefined) config.output = options.output;
	if (options.base !== undefined) {
		try { config.base = normalizeBase(options.base); } catch (e) { throw context(e, "--base"); }
	}
	// JavaScript data files and templates can make images even without the plugin.
	useImages(config);
	useTimeZone(config.timeZone);
	return config;
}

/** The machine's own `TZ`, for a config that's loaded again without `timeZone`. */
const MACHINE_TZ = process.env.TZ;

/**
 * Runs the site's JavaScript in `zone` from here on: `Date`'s local methods and libraries that use
 * the local zone (luxon, date-fns) follow `process.env.TZ`, which Node reads again when it's set.
 * v8.dev's dates differed on 137 pages between a laptop in EST and CI in UTC (v8 C11). The config's
 * own top-level code has run by now, in the machine's zone.
 */
function useTimeZone(zone: string | null): void {
	const want = zone ?? MACHINE_TZ;
	if (process.env.TZ === want) return;
	if (want === undefined) delete process.env.TZ;
	else process.env.TZ = want;
}

/** A `timeZone` setting: an IANA zone name (`"UTC"`, `"America/New_York"`). */
function checkTimeZone(value: unknown): string {
	if (typeof value !== "string" || value === "") bail(`timeZone must be a time zone's name, like "UTC" or "America/New_York", not ${typeof value === "string" ? "an empty string" : typeof value}`);
	// Asked of Intl only to check the name; nothing a build writes comes from it.
	try { new Intl.DateTimeFormat("en", { timeZone: value }); } catch { bail(`timeZone: "${value}" isn't a time zone ssqch knows (like "UTC", "Europe/Berlin" or "America/New_York")`); }
	return value;
}

/** A JavaScript data file's value: its default export, called if it's a function. */
async function loadJsData(file: string, root: string): Promise<unknown> {
	const name = path.relative(root, file).split(path.sep).join("/");
	try {
		const module = await importFile(file);
		if (!("default" in module)) bail("a data file needs a default export: the data, or a function that returns it");
		const value = module.default;
		return typeof value === "function" ? await settle(value()) : value;
	} catch (e) {
		throw new BuildError(`${name}: ${describeThrown(e, root)}`);
	}
}

/**
 * What a site's engine with `cache: true` rendered, by the source it was given: the bodies of this
 * build, and of the one before, which a body this build renders again moves into this build's. So
 * `ssqch serve` renders only the pages whose text changed, and keeps no more than two builds of
 * them: a page that's deleted or edited is gone after the next build.
 */
export class EngineCache {
	now = new Map<string, string>();
	before = new Map<string, string>();

	startBuild(): void {
		this.before = this.now;
		this.now = new Map();
	}

	get(source: string): string | undefined {
		const kept = this.now.get(source);
		if (kept !== undefined) return kept;
		const earlier = this.before.get(source);
		if (earlier !== undefined) this.now.set(source, earlier);
		return earlier;
	}

	set(source: string, html: string): void {
		this.now.set(source, html);
	}
}

// ---- ssqch.config.js -------------------------------------------------------------------------

const SETTINGS = ["dirs", "templateFormats", "markdownEngine", "htmlEngine", "markdown", "deepMerge", "leaveNoTrace", "ignore", "bundles", "strict", "jinja", "lastModified", "dateFallback", "timeZone", "urls", "layoutAliases", "base", "schemas", "theme", "serve", "budgets"];
const PARTS = ["data", "filters", "collections", "transforms", "engines", "passthrough", "watch", "beforeBuild", "afterBuild", "plugins"];
/**
 * Engine names a config can't replace. `md` can be: a site that keeps its markdown-it replaces
 * Markdown once (`engines: { md }`) instead of naming its engine in every folder's `render`.
 */
const CORE_ENGINES = ["edge", "html", "txt"];
const DIRS = ["input", "output", "includes", "layouts", "data"];

/** The options a config can set, in the order its errors list them. */
export const configOptions = (): string[] => [...SETTINGS, ...PARTS];

const isObject = (v: unknown): v is Data => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): unknown[] => (v === undefined ? [] : ([] as unknown[]).concat(v));

/** ` (did you mean "dirs"?)` for a key within two edits of an option, or nothing. */
export function meant(key: unknown, options: readonly string[]): string {
	const distance = (a: string, b: string) => {
		const row = Array.from({ length: b.length + 1 }, (_, i) => i);
		for (let i = 0; i < a.length; i++) {
			let previous = row[0];
			row[0] = i + 1;
			for (let j = 0; j < b.length; j++) {
				const current = row[j + 1];
				row[j + 1] = a[i] === b[j] ? previous : 1 + Math.min(previous, current, row[j]);
				previous = current;
			}
		}
		return row[b.length];
	};
	let best: { edits: number; option: string } | undefined;
	for (const option of options) {
		const edits = distance(String(key).toLowerCase(), option.toLowerCase());
		if (edits <= 2 && edits < option.length && (!best || edits < best.edits)) best = { edits, option };
	}
	return best ? ` (did you mean "${best.option}"?)` : "";
}

const configWord = (key: string): Equivalent | undefined => equivalents.find(key, "config");

/**
 * Options ssqch had and took out, with what to do instead: they were there only so a move could
 * match another generator's bytes, which nothing that reads a site needs (the audit's plan,
 * 2026-11-21).
 */
const RETIRED: Record<string, string> = {
	jekyllTemplates: "it's fromJekyll() from \"ssqch/from-jekyll\" now, which also turns on kramdown's Markdown (`fromJekyll({ kramdown: false })` leaves that out): add it to plugins (`ssqch docs fromJekyll`)",
	mkdocsTemplates: "it's fromMkdocs({ templates: true }) from \"ssqch/from-mkdocs\" now (`config: \"docs/mkdocs.yml\"` names another mkdocs.yml), which also turns on MkDocs' Markdown: add it to plugins (`ssqch docs fromMkdocs`)",
	trimAfterFrontMatter: "the blank lines after a template's front matter are whitespace between tags in HTML, which browsers and `ssqch diff` read as the same. Where one matters (a feed that has to start with `<?xml`, a text file), take it out of that template: `ssqch scout --patch` does it for a Jekyll site",
};

/** A check that failed: the message is the whole error (`ssqch.config.js: ...`). */
const fail = (message: string): never => { throw new TypeError(message); };

/**
 * The config with its aliases as ssqch's names: `pathPrefix` as `base`, `publishDir` and
 * `outDir` as `dirs.output`, `dir` as `dirs`.
 */
function aliased(part: Data, where: string): Data {
	const words = Object.keys(part).filter((key) => configWord(key)?.alias);
	if (!words.length) return part;
	const out: Data = { ...part };
	const dirs = isObject(part.dirs) ? { ...part.dirs } : part.dirs;
	const named: Record<string, string> = {}; // which word set each name, for the error when two do
	const twice = (name: string, word: string) => fail(`${where}: ${word} and ${named[name] ?? name} are two names for one option; set one of them`);
	for (const word of words) {
		const row = configWord(word)!;
		const name = row.ssqch;
		const value = part[word];
		delete out[word];
		if (name === "dirs") {
			if (!isObject(value)) fail(`${where}: ${word} must be an object, like ${word}: { input: "src", output: "dist" }`);
			for (const [key, folder] of Object.entries(value as Data)) {
				if ((isObject(dirs) && dirs[key] !== undefined) || named[`dirs.${key}`]) twice(`dirs.${key}`, `${word}.${key}`);
				out.dirs = isObject(out.dirs) ? out.dirs : { ...(isObject(dirs) ? dirs : {}) };
				out.dirs[key] = folder;
				named[`dirs.${key}`] = `${word}.${key}`;
			}
		} else if (name.startsWith("dirs.")) {
			const key = name.slice(5);
			if ((isObject(dirs) && dirs[key] !== undefined) || named[name]) twice(name, word);
			out.dirs = isObject(out.dirs) ? out.dirs : { ...(isObject(dirs) ? dirs : {}) };
			out.dirs[key] = value;
			named[name] = word;
		} else {
			if (part[name] !== undefined || named[name]) twice(name, word);
			out[name] = value;
			named[name] = word;
		}
		aliasUsed(row);
	}
	return out;
}

/** A plugin built into ssqch, which a config adds as `{ builtin: "ssqch/image", options }` (what `imagePlugin()` returns). */
export type BuiltinPlugin = (config: Config, options: Data) => void | Promise<void>;

/** The built-in plugins, by the module that makes them. The plugins register themselves here as they're ported. */
export const BUILTINS = new Map<string, BuiltinPlugin>();/** Every built-in plugin's module, in the order errors list them. One that isn't in `BUILTINS` isn't in the Node build yet, and its error says so rather than "unknown". */
const BUILTIN_NAMES = ["ssqch/rss", "ssqch/image", "ssqch/minify", "ssqch/assets", "ssqch/links", "ssqch/sitemap", "ssqch/redirects", "ssqch/sass", "ssqch/elements", "ssqch/llms", "ssqch/vue", "ssqch/robots", "ssqch/from-mkdocs", "ssqch/from-jekyll", "ssqch/from-hugo", "ssqch/from-vitepress"];

async function loadJs(config: Config, file: string): Promise<void> {
	const name = path.basename(file);
	const { root, env, serving } = config;
	loadedFiles.add(file);
	const settings: Data = {};
	// What the config and its plugins add, in call order: applied after the settings.
	const ops: Array<() => void | Promise<void>> = [];
	const names = { data: new Map<string, string>(), filters: new Map<string, string>(), collections: new Map<string, string>(), transforms: new Map<string, string>(), engines: new Map<string, string>() };

	// A config written as calls (`config.addPassthroughCopy("src/fonts")`) gets ssqch's name for each.
	const argument = new Proxy(Object.freeze({ env, serving }), {
		get(target, key, receiver) {
			const equivalent = typeof key === "string" && !(key in target) ? configWord(key) : undefined;
			if (equivalent) fail(`the config function's argument has no ${String(key)}(): an ssqch config returns an object. ${equivalent.say}\n  More: ${equivalent.more}`);
			return Reflect.get(target, key, receiver);
		},
	});

	const claim = (kind: keyof typeof names, singular: string, key: string, where: string) => {
		const earlier = names[kind].get(key);
		if (earlier) fail(`${where}: ${singular} "${key}" is already defined by ${earlier}`);
		names[kind].set(key, where);
		ops.push(() => { config.definedIn.set(`${kind}.${key}`, where); });
	};
	const functions = (kind: "filters" | "collections" | "transforms", singular: string, value: unknown, where: string, add: (key: string, fn: (...args: any[]) => any) => void) => {
		if (value === undefined) return;
		if (!isObject(value)) fail(`${where}: ${kind} must be an object of { name: function }`);
		for (const [key, fn] of Object.entries(value as Data)) {
			if (typeof fn !== "function") fail(`${where}: ${kind}.${key} must be a function`);
			claim(kind, singular, key, where);
			add(key, fn);
		}
	};
	// A hook is a function, or `{ run: "command" }` to run a program.
	const hooks = (event: "beforeBuild" | "afterBuild", value: unknown, where: string) => {
		for (const hook of list(value)) {
			if (isObject(hook)) {
				for (const key of Object.keys(hook)) {
					if (key !== "run") fail(`${where}: ${event}: "${key}" isn't an option (use { run: "command" })`);
				}
				if (!(typeof hook.run === "string" && hook.run.trim())) fail(`${where}: ${event}: run must be a command, like { run: "pagefind --site dist" }`);
				const run: string = hook.run;
				ops.push(() => { config[event].push({ run }); });
				continue;
			}
			if (typeof hook !== "function") fail(`${where}: ${event} must be a function or { run: "command" } (or an array of them)`);
			const fn = hook as (event: Data) => unknown;
			ops.push(() => { config[event].push({ label: `${event} (${where})`, fn }); });
		}
	};

	async function apply(part: any, where: string, top: boolean): Promise<void> {
		if (typeof part === "function") part = await settle(part(argument));
		if (part === undefined || part === null || part === false) return;
		if (!isObject(part)) fail(`${where} must be an object (or a function that returns one)`);

		// A built-in plugin, such as imagePlugin() from "ssqch/image".
		if ("builtin" in part) {
			const builtin = String(part.builtin);
			const options = part.options ?? {};
			ops.push(async () => {
				const register = BUILTINS.get(builtin);
				if (!register) {
					if (BUILTIN_NAMES.includes(builtin)) bail(`plugin "${builtin}": this plugin isn't in the Node build of ssqch yet (the move to Node, stage 5)`);
					bail(`unknown plugin "${builtin}" (built-in plugins: ${BUILTIN_NAMES.join(", ")})`);
				}
				config.plugins.push(builtin);
				try { await register(config, options); } catch (e) { throw context(e, `plugin "${builtin}"`); }
			});
			return;
		}

		// Another generator's word that's an alias here (`pathPrefix`, `publishDir`, `dir`) is read
		// as ssqch's, and setting both names is an error.
		if (top) part = aliased(part, where);

		// Every key that isn't an option, in one error. Another generator's word (`pathPrefix`) gets
		// ssqch's name for it; anything else, the closest option and the list.
		const unknown: string[] = [];
		let guessed = false;
		for (const key of Object.keys(part)) {
			if ((key === "name" || key === "rust") && !top) continue;
			// A plugin's `markdown` is its Markdown steps, and its `defaults` what the site doesn't set itself.
			if (!top && (key === "markdown" || key === "defaults")) continue;
			if (SETTINGS.includes(key)) {
				if (!top) fail(`${where}: "${key}" can only be set in the config itself, not in a plugin`);
			} else if (!PARTS.includes(key)) {
				const options = top ? [...SETTINGS, ...PARTS] : PARTS;
				const equivalent = configWord(key);
				if (equivalent?.alias) {
					unknown.push(`${where}: "${key}" can only be set in the config itself, not in a plugin (ssqch calls it ${equivalent.ssqch})`);
					continue;
				}
				if (equivalent) {
					unknown.push(`${where}: "${key}" isn't a config option. ${equivalent.say}\n  More: ${equivalent.more}`);
					continue;
				}
				if (top && Object.hasOwn(RETIRED, key)) {
					unknown.push(`${where}: "${key}" is gone: ${RETIRED[key]}`);
					continue;
				}
				// `output: "dist"` at the top is a folder that belongs in `dirs`.
				const hint = top && DIRS.includes(key) ? ` (it goes in dirs: { ${key}: "..." })` : meant(key, options);
				unknown.push(`${where}: "${key}" isn't a config option${hint}`);
				guessed = true;
			}
		}
		if (unknown.length) {
			const options = top ? [...SETTINGS, ...PARTS] : PARTS;
			fail(unknown.join("\n") + (guessed ? ` (options: ${options.join(", ")})` : ""));
		}

		if (!top && part.markdown !== undefined) {
			const steps = part.markdown;
			ops.push(() => { addMarkdownSteps(config.markdown.steps, where, steps); });
		}
		if (!top && part.defaults !== undefined) {
			const defaults = part.defaults;
			if (!isObject(defaults)) fail(`${where}: defaults must be an object, like { markdown: { headingIds: "ascii" } }`);
			for (const key of Object.keys(defaults)) if (key !== "markdown") fail(`${where}: defaults.${key}: a plugin's defaults can be markdown options only`);
			if (defaults.markdown !== undefined && !isObject(defaults.markdown)) fail(`${where}: defaults.markdown must be an object of markdown options`);
			// Under the site's own: only the keys its config's `markdown` doesn't set.
			ops.push(() => {
				const own = Object.fromEntries(Object.entries((defaults.markdown ?? {}) as Data).filter(([key]) => !config.markdownGiven.has(key)));
				if (!Object.keys(own).length) return;
				try { applyMarkdownOptions(config.markdown, own); } catch (e) { throw context(e, `${where}: defaults`); }
			});
		}

		// A plugin written in Rust (`{ name, rust: { wasm, options } }`, what its npm package
		// returns): its transform, filters and engines, as its manifest lists them.
		if (!top && part.rust !== undefined) {
			const rust = loadRustPart(part.rust, where, root);
			if (rust.transform) {
				const [key, fn] = rust.transform;
				claim("transforms", "transform", key, where);
				ops.push(() => { config.transforms.push([key, fn]); });
			}
			for (const [key, fn] of rust.filters) {
				claim("filters", "filter", key, where);
				ops.push(() => { config.filters.set(key, fn); config.siteFilters.add(key); });
			}
			for (const [key, run] of rust.engines) {
				if (!/^[A-Za-z0-9_-]+$/.test(key)) fail(`${where}: engines.${key}: an engine's name is a file extension (letters, digits, - and _)`);
				if (CORE_ENGINES.includes(key)) fail(`${where}: engines.${key}: "${key}" is built in and can't be replaced`);
				claim("engines", "engine", key, where);
				ops.push(() => { config.engines.set(key, run); });
			}
		}

		if (top) {
			if (part.dirs !== undefined) {
				if (!isObject(part.dirs)) fail(`${where}: dirs must be an object`);
				for (const [key, value] of Object.entries(part.dirs)) {
					if (!DIRS.includes(key)) fail(`${where}: dirs.${key} isn't supported${meant(key, DIRS)} (use ${DIRS.join(", ")})`);
					if (typeof value !== "string") fail(`${where}: dirs.${key} must be a string`);
					settings[key] = value;
				}
			}
			for (const key of SETTINGS.filter((k) => k !== "dirs")) {
				if (part[key] !== undefined) settings[key] = part[key];
			}
		}

		if (part.data !== undefined) {
			if (!isObject(part.data)) fail(`${where}: data must be an object of { name: value or function }`);
			for (const [key, value] of Object.entries(part.data)) {
				claim("data", "data", key, where);
				ops.push(() => { config.globalData.push(typeof value === "function" ? { name: key, fn: value as () => unknown } : { name: key, value }); });
			}
		}
		// A filter that's a `function` gets the page being rendered as `this.page` (src/rendering.ts).
		functions("filters", "filter", part.filters, where, (key, fn) => ops.push(() => { config.filters.set(key, withPage(fn, `filter \`${key}\``)); config.siteFilters.add(key); }));
		functions("collections", "collection", part.collections, where, (key, fn) => ops.push(() => { config.collections.push([key, fn]); }));
		functions("transforms", "transform", part.transforms, where, (key, fn) => {
			const run: TransformFn = async (content, page) => {
				const out = await settle(fn(content, page), `transform \`${key}\` (${page.outputPath})`);
				if (typeof out !== "string") {
					throw new TypeError(`transform "${key}" returned ${out === undefined ? "undefined" : typeof out} for ${page.outputPath}; return the content (unchanged if there's nothing to do)`);
				}
				return out;
			};
			ops.push(() => { config.transforms.push([key, run]); });
		});
		if (part.engines !== undefined) {
			if (!isObject(part.engines)) fail(`${where}: engines must be an object of { extension: function or { render } }`);
			for (const [key, engine] of Object.entries<any>(part.engines)) {
				const render = typeof engine === "function" ? engine : engine?.render;
				if (typeof render !== "function") fail(`${where}: engines.${key} must be a function (source, data) or an object with a render(source, data) method`);
				// Only an object of the site's own says `cache`: a library's instance (a markdown-it)
				// may have a property of that name that means something else.
				if (isPlainObject(engine) && engine.cache !== undefined && typeof engine.cache !== "boolean") fail(`${where}: engines.${key}.cache must be true or false`);
				const cache = typeof engine === "object" && engine.cache === true ? new EngineCache() : undefined;
				if (!/^[A-Za-z0-9_-]+$/.test(key)) fail(`${where}: engines.${key}: an engine's name is a file extension (letters, digits, - and _)`);
				if (CORE_ENGINES.includes(key)) fail(`${where}: engines.${key}: "${key}" is built in and can't be replaced`);
				claim("engines", "engine", key, where);
				// Synchronous until the site's function answers with a promise, so a page whose
				// engines are all synchronous can be rendered on demand (`templateContent`).
				const checked = (out: unknown, inputPath: string): string => {
					if (typeof out !== "string") throw new TypeError(`engine "${key}" returned ${out === undefined ? "undefined" : typeof out} for ${inputPath}; return the rendered text`);
					return out;
				};
				// The third argument says what's being rendered (`{ kind, path }`): an engine that only
				// has `source` and `data` had to guess whether it was a page, a layout or a permalink.
				const run: EngineFn = (source, data, inputPath, context) => {
					const out = render.call(engine, source, data, context);
					return out instanceof Promise ? watchSettle(out, `engine \`${key}\` (${inputPath})`).then((v) => checked(v, inputPath)) : checked(out, inputPath);
				};
				ops.push(() => {
					if (!cache) {
						config.engines.set(key, run);
						return;
					}
					config.engineCaches.push(cache);
					// A page's body, kept by its source. A layout's and a hook's text is the same on every
					// page while what they print isn't (`content`, the hook's value), so they render each time.
					config.engines.set(key, (source, data, inputPath, context) => {
						if (context.kind !== "body") return run(source, data, inputPath, context);
						const kept = cache.get(source);
						if (kept !== undefined) return kept;
						const out = run(source, data, inputPath, context);
						if (typeof out === "string") cache.set(source, out);
						else out.then((html) => cache.set(source, html), () => {});
						return out;
					});
				});
			}
		}

		for (const entry of list(part.passthrough)) {
			if (typeof entry === "string") {
				ops.push(() => { config.passthrough.push({ from: entry }); });
			} else if (isObject(entry)) {
				for (const [from, to] of Object.entries(entry)) {
					if (typeof to !== "string") fail(`${where}: passthrough destination for "${from}" must be a string`);
					ops.push(() => { config.passthrough.push({ from, to }); });
				}
			} else {
				fail(`${where}: passthrough entries must be paths or { from: to } objects`);
			}
		}
		for (const target of list(part.watch)) {
			if (typeof target !== "string") fail(`${where}: watch must be a path or an array of paths`);
			ops.push(() => { config.watch.push(target as string); });
		}
		hooks("beforeBuild", part.beforeBuild, where);
		hooks("afterBuild", part.afterBuild, where);

		const plugins = list(part.plugins) as any[];
		for (let i = 0; i < plugins.length; i++) {
			const plugin = plugins[i];
			const label = plugin?.name ? `plugin "${plugin.name}"` : `plugins[${i}]`;
			await apply(plugin, top ? label : `${where} > ${label}`, false);
		}
	}

	// Name the config file in an error, unless the message already starts with it
	// (`ssqch.config.js: dirs.ouput isn't supported`).
	const inFile = (e: unknown): BuildError => {
		const message = describeThrown(e, root);
		return new BuildError(message.startsWith(`${name}:`) || message.startsWith(`${name} `) ? message : `${name}: ${message}`);
	};
	try {
		const module = await importFile(file);
		if (!("default" in module)) fail(`${name} needs a default export: export default defineConfig({ ... })`);
		await apply(module.default, name, true);
	} catch (e) {
		throw inFile(e);
	}
	try {
		applySettings(config, settings);
		for (const op of ops) await op();
	} catch (e) {
		throw new BuildError(`${name}: ${e instanceof BuildError ? e.message : describeThrown(e, root)}`);
	}
}

/** The settings a config made, checked and put in `config`. */
function applySettings(config: Config, settings: Data): void {
	for (const key of DIRS) {
		const value = settings[key];
		if (value === undefined || value === null) continue;
		if (typeof value !== "string") bail(`dirs.${key} must be a string, not ${typeof value}`);
		(config as any)[key] = value;
	}
	const formats = settings.templateFormats;
	if (typeof formats === "string") config.templateFormats = formats.split(",").map((f) => f.trim()).filter(Boolean);
	else if (Array.isArray(formats)) config.templateFormats = formats.map(String);
	else if (formats !== undefined) bail(`templateFormats must be an array or a comma-separated string, not ${typeof formats}`);
	for (const key of ["markdownEngine", "htmlEngine"] as const) {
		const value = settings[key];
		if (value === undefined) continue;
		if (value === false || value === null) config[key] = null;
		else if (typeof value === "string") config[key] = value === "" ? null : value;
		else bail(`${key} must be a string or false, not ${typeof value}`);
	}
	if (settings.markdown !== undefined) applyMarkdownOptions(config.markdown, settings.markdown);
	if (isObject(settings.markdown)) config.markdownGiven = new Set(Object.keys(settings.markdown));
	checkLanguages(config.markdown, config.root);
	if (settings.deepMerge !== undefined) {
		if (typeof settings.deepMerge !== "boolean") bail(`deepMerge must be true or false, not ${typeof settings.deepMerge}`);
		config.deepMerge = settings.deepMerge;
	}
	const trace = settings.leaveNoTrace;
	if (trace !== undefined && typeof trace !== "boolean") bail(`leaveNoTrace must be true or false, not ${typeof trace}`);
	if (trace !== undefined) config.leaveNoTrace = trace;
	for (const key of ["bundles", "strict"] as const) {
		const value = settings[key];
		if (value === undefined) continue;
		if (typeof value !== "boolean") bail(`${key} must be true or false, not ${typeof value}`);
		config[key] = value;
	}
	const jinja = settings.jinja;
	if (isObject(jinja)) {
		const unknown = Object.keys(jinja).find((k) => k !== "autoescape");
		if (unknown !== undefined) bail(`jinja: "${unknown}" isn't an option${meant(unknown, ["autoescape"])} (options: autoescape)`);
		if (jinja.autoescape !== undefined && typeof jinja.autoescape !== "boolean") bail(`jinja.autoescape must be true or false, not ${typeof jinja.autoescape}`);
		if (typeof jinja.autoescape === "boolean") config.jinjaAutoescape = jinja.autoescape;
	} else if (jinja !== undefined && jinja !== null) bail(`jinja must be an object, like { autoescape: false }, not ${typeof jinja}`);
	const modified = settings.lastModified;
	if (modified === true) config.lastModified = "git";
	else if (modified === "git" || modified === "file") config.lastModified = modified;
	else if (typeof modified === "string") bail(`lastModified must be "git", "file" or false, not "${modified}"`);
	else if (modified !== undefined && modified !== null && modified !== false) bail(`lastModified must be "git", "file" or false, not ${typeof modified}`);
	const fallback = settings.dateFallback;
	if (fallback === "git" || fallback === "file") config.dateFallback = fallback;
	else if (fallback !== undefined && fallback !== null) bail(`dateFallback must be "git" or "file", not ${typeof fallback === "string" ? `"${fallback}"` : typeof fallback}`);
	if (settings.timeZone !== undefined && settings.timeZone !== null) config.timeZone = checkTimeZone(settings.timeZone);
	const urls = settings.urls;
	if (urls === "folders" || urls === "html") config.urls = urls;
	else if (urls !== undefined && urls !== null) bail(`urls must be "folders" (/guide/intro/) or "html" (/guide/intro.html), not ${typeof urls === "string" ? `"${urls}"` : typeof urls}`);
	config.markdown.htmlUrls = config.urls === "html";
	// `layoutAliases: { post: "layouts/post.njk" }`: `layout: post` is that file, and a page's
	// `layout` is still `post` (a template that tests `layout == "post"` keeps working).
	if (settings.layoutAliases !== undefined && settings.layoutAliases !== null) {
		if (!isObject(settings.layoutAliases)) bail(`layoutAliases must be an object of { name: layout }, like { post: "layouts/post.njk" }, not ${typeof settings.layoutAliases}`);
		for (const [name, target] of Object.entries(settings.layoutAliases)) {
			if (typeof target !== "string" || target === "") bail(`layoutAliases.${name} must be a layout's name, like "layouts/post.njk"`);
			if (target === name) bail(`layoutAliases.${name} names itself`);
			config.layoutAliases.set(name, target);
		}
	}
	if (typeof settings.base === "string") config.base = normalizeBase(settings.base);
	else if (settings.base !== undefined && settings.base !== null) bail(`base must be a URL path like "/docs/", not ${typeof settings.base}`);
	// `theme: "themes/docs"`, a pinned git URL, `{ git, ref, dir }`, or a list of them.
	const theme = settings.theme;
	const themes = theme === undefined || theme === null || theme === false ? [] : Array.isArray(theme) ? theme : [theme];
	for (const one of themes) addTheme(config, one);
	// MkDocs' own pages (its 404) go under every theme, from the theme's 404.html.
	if (isObject(settings.schemas)) {
		for (const [name, spec] of Object.entries(settings.schemas)) {
			const schema = parseSchema(name, spec);
			config.schemas = config.schemas.filter((s) => s.name !== name);
			config.schemas.push(schema);
		}
	} else if (settings.schemas !== undefined && settings.schemas !== null) bail(`schemas must be an object of { name: { fields } }, not ${typeof settings.schemas}`);
	// `budgets: { pages: "150 KB", total: "300 MB" }`: sizes a build is checked against.
	if (isObject(settings.budgets)) config.budgets = Object.entries(settings.budgets).map(([name, size]) => budget(name, size));
	else if (settings.budgets !== undefined && settings.budgets !== null) bail(`budgets must be an object, like { pages: "150 KB", images: "1 MB" }, not ${typeof settings.budgets}`);
	// `serve: { run: ["npx postcss ... --watch"] }`: programs `ssqch serve` runs alongside.
	const serve = settings.serve;
	if (isObject(serve)) {
		const unknown = Object.keys(serve).find((k) => k !== "run");
		if (unknown !== undefined) bail(`serve: "${unknown}" isn't an option (options: run)`);
		const run = serve.run;
		if (run === undefined || run === null) config.serveRun = [];
		else if (typeof run === "string") config.serveRun = [run];
		else if (Array.isArray(run)) {
			config.serveRun = run.map((c) => (typeof c === "string" && c.trim() !== "" ? c : bail("serve.run must be a command or an array of commands, like [\"npx postcss src/app.css -o dist/app.css --watch\"]")));
		} else bail(`serve.run must be a command or an array of commands, not ${typeof run}`);
	} else if (serve !== undefined && serve !== null) bail(`serve must be an object, like { run: ["npx postcss ... --watch"] }, not ${typeof serve}`);
	const ignore = settings.ignore;
	if (typeof ignore === "string") config.ignore = [ignore];
	else if (Array.isArray(ignore)) config.ignore = ignore.map((g) => (typeof g === "string" ? g : bail(`ignore must be a glob or an array of globs, not an array with ${typeof g}`)));
	else if (ignore !== undefined) bail(`ignore must be a glob or an array of globs, not ${typeof ignore}`);
}


/** MkDocs' context's own theme, under every other: the 404 page MkDocs renders from the theme's `404.html` (`mkdocsTemplates`, and `fromMkdocs({ templates: true })`). */
export function addMkdocsTheme(config: Config): void {
	const dir = bundledPath("mkdocs");
	if (!config.themes.includes(dir)) config.themes.push(dir);
}

function addTheme(config: Config, theme: unknown): void {
	let dir: string;
	if (typeof theme === "string") dir = resolveTheme(config.root, theme, config.quiet);
	else if (isObject(theme)) {
		const unknown = Object.keys(theme).find((k) => !["git", "ref", "dir"].includes(k));
		if (unknown !== undefined) bail(`theme: "${unknown}" isn't an option (options: git, ref, dir)`);
		const text = (key: string) => (typeof theme[key] === "string" ? theme[key] as string : "");
		if (text("git") === "" || text("ref") === "") bail("theme: an object needs `git` (the repository's URL) and `ref` (the commit or tag to use)");
		dir = resolveTheme(config.root, { git: text("git"), ref: text("ref"), dir: text("dir") }, config.quiet);
	} else bail(`theme must be a folder, a git URL with #commit, or { git, ref, dir }, not ${typeof theme}`);
	if (!config.themes.includes(dir)) {
		config.watch.push(dir);
		config.themes.push(dir);
	}
}

// ---- sitesquatch.toml ------------------------------------------------------------------------

const TOML_KEYS = ["input", "output", "includes", "layouts", "data", "template_formats", "markdown_engine", "html_engine", "data_deep_merge", "clean", "leave_no_trace", "ignore", "bundles", "strict", "base", "last_modified", "before_build", "after_build", "budgets", "serve", "theme", "schemas", "markdown", "passthrough"];

/** A TOML table with its keys (and its tables' keys) in the order of their names, as 0.7's TOML library kept them. */
function byName(table: Data): Data {
	const out: Data = {};
	for (const key of Object.keys(table).sort(compareText)) {
		const value = table[key];
		out[key] = isPlainObject(value) ? byName(value) : Array.isArray(value) ? value.map((v) => (isPlainObject(v) ? byName(v) : v)) : value;
	}
	return out;
}

/**
 * A TOML value as 0.7's TOML library wrote it (`toml::Value`'s `Display`), which is how 0.7 quoted
 * a budget that's neither a number nor a string: `[10, 20]`, `{ a = 1 }`, `inf`.
 */
function tomlText(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(tomlText).join(", ")}]`;
	if (isPlainObject(v)) {
		const keys = Object.keys(v);
		return keys.length ? `{ ${keys.map((k) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)} = ${tomlText(v[k])}`).join(", ")} }` : "{}";
	}
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number" && !Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
	return String(v);
}

/**
 * The line of a key in a TOML file, for an error's excerpt: `["budgets", "pages"]` is `pages`
 * under `[budgets]` (or `budgets` itself, when it's written another way), and `["input"]` is the
 * top-level `input`.
 */
export function tomlKeyLine(text: string, at: string[]): number | undefined {
	const lines = text.split(/\r?\n/);
	const escaped = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const isKey = (line: string, k: string) => new RegExp(`^\\s*(?:${escaped(k)}|"${escaped(k)}"|'${escaped(k)}')\\s*[=.]`).test(line);
	const header = (line: string) => /^\s*\[\[?\s*([^\]]*?)\s*\]/.exec(line)?.[1].replace(/["'\s]/g, "");
	let table = "";
	let found: number | undefined;
	for (let i = 0; i < lines.length && found === undefined; i++) {
		const name = header(lines[i]);
		if (name !== undefined) {
			table = name;
			if (name === at[0] || name.startsWith(`${at[0]}.`)) found = i + 1;
			continue;
		}
		if (table === "" && isKey(lines[i], at[0])) found = i + 1;
	}
	if (found !== undefined && at.length > 1) {
		for (let i = found; i < lines.length && header(lines[i]) === undefined; i++) if (isKey(lines[i], at[1])) return i + 1;
	}
	return found;
}

/** Applies `sitesquatch.toml`: the config's settings in snake case, for a site with no JavaScript of its own. */
function applyToml(config: Config, file: string): void {
	loadedFiles.add(file);
	// Named as 0.7 named it, from the root as it was given (`./sitesquatch.toml`), with the line of
	// what's wrong when it's known, for the excerpt.
	const shown = /[\\/]$/.test(config.rootGiven) ? config.rootGiven + "sitesquatch.toml" : config.rootGiven + path.sep + "sitesquatch.toml";
	let source = "";
	// The key being read, for the line of an error in it.
	let at: string[] = [];
	const invalid = (e: unknown): never => {
		const message = `invalid ${shown}: ${e instanceof TomlError ? tomlReason(e) : messageOf(e)}`;
		const line = e instanceof TomlError ? e.line : at.length ? tomlKeyLine(source, at) : undefined;
		throw new BuildError(message, [error("config", message, { file: path.relative(config.root, file), line })]);
	};
	let site: Data;
	try {
		source = fs.readFileSync(file, "utf8");
		site = readToml(source) as Data;
	} catch (e) { return invalid(e); }
	try {
		const unknown = Object.keys(site).find((k) => !TOML_KEYS.includes(k));
		at = unknown === undefined ? [] : [unknown];
		if (unknown !== undefined) bail(`unknown field \`${unknown}\`, expected one of ${TOML_KEYS.map((k) => `\`${k}\``).join(", ")}`);
		const text = (key: string): string | undefined => (at = [key], site[key] === undefined ? undefined : typeof site[key] === "string" ? site[key] : bail(`${key} must be a string`));
		const flag = (key: string): boolean | undefined => (at = [key], site[key] === undefined ? undefined : typeof site[key] === "boolean" ? site[key] : bail(`${key} must be true or false`));
		const texts = (key: string): string[] | undefined => (at = [key], site[key] === undefined ? undefined : Array.isArray(site[key]) && site[key].every((v: unknown) => typeof v === "string") ? site[key] : bail(`${key} must be an array of strings`));
		config.input = text("input") ?? config.input;
		config.output = text("output") ?? config.output;
		config.includes = text("includes") ?? config.includes;
		config.layouts = text("layouts") ?? config.layouts;
		config.data = text("data") ?? config.data;
		config.templateFormats = texts("template_formats") ?? config.templateFormats;
		for (const [key, slot] of [["markdown_engine", "markdownEngine"], ["html_engine", "htmlEngine"]] as const) {
			const value = text(key);
			if (value !== undefined) config[slot] = value === "" ? null : value;
		}
		config.deepMerge = flag("data_deep_merge") ?? config.deepMerge;
		at = ["clean"];
		if (site.leave_no_trace !== undefined && site.clean !== undefined) bail("duplicate field `leave_no_trace`");
		config.leaveNoTrace = flag("leave_no_trace") ?? flag("clean") ?? config.leaveNoTrace;
		config.ignore = texts("ignore") ?? config.ignore;
		config.bundles = flag("bundles") ?? config.bundles;
		config.strict = flag("strict") ?? config.strict;
		const base = text("base");
		if (base !== undefined) config.base = normalizeBase(base);
		if (site.budgets !== undefined) {
			at = ["budgets"];
			if (!isPlainObject(site.budgets)) bail("budgets must be a table");
			// A whole number is bytes; anything else is read as a size is written (`1.5` is 2 bytes,
			// rounded, and `[1]` isn't one). In the order of their names, as 0.7 read them.
			for (const [name, value] of Object.entries(byName(site.budgets))) {
				at = ["budgets", name];
				config.budgets.push(budget(name, Number.isInteger(value) || typeof value === "string" ? value : tomlText(value)));
			}
		}
		if (site.serve !== undefined) {
			at = ["serve"];
			if (!isPlainObject(site.serve)) bail("serve must be a table");
			const unknownServe = Object.keys(site.serve).find((k) => k !== "run");
			if (unknownServe !== undefined) bail(`unknown field \`${unknownServe}\`, expected \`run\``);
			const run = site.serve.run ?? [];
			if (!Array.isArray(run) || !run.every((command: unknown) => typeof command === "string")) bail("serve.run must be an array of commands, like run = [\"npx postcss src/app.css -o dist/app.css --watch\"]");
			config.serveRun = run;
		}
		for (const command of texts("before_build") ?? []) config.beforeBuild.push({ run: command });
		for (const command of texts("after_build") ?? []) config.afterBuild.push({ run: command });
		const modified = text("last_modified");
		if (modified !== undefined) {
			if (modified !== "git" && modified !== "file") bail("last_modified must be \"git\" or \"file\"");
			config.lastModified = modified;
		}
		if (site.markdown !== undefined) {
			at = ["markdown"];
			if (!isPlainObject(site.markdown)) bail("markdown must be a table");
			// The config's keys in snake case: `heading_ids = "blackfriday"`.
			const camel: Data = {};
			for (const [key, value] of Object.entries(site.markdown)) camel[key.replace(/_(.)/g, (_, c: string) => c.toUpperCase())] = value;
			applyMarkdownOptions(config.markdown, camel);
			checkLanguages(config.markdown, config.root);
		}
		for (const theme of texts("theme") ?? []) addTheme(config, theme);
		if (site.schemas !== undefined) {
			at = ["schemas"];
			if (!isPlainObject(site.schemas)) bail("schemas must be a table");
			// Schemas and their fields in the order of their names, as 0.7 read every table here.
			for (const [name, spec] of Object.entries(byName(site.schemas))) {
				at = ["schemas", name];
				const schema = parseSchema(name, spec);
				config.schemas = config.schemas.filter((s) => s.name !== name);
				config.schemas.push(schema);
			}
		}
		if (site.passthrough !== undefined) {
			at = ["passthrough"];
			if (!isPlainObject(site.passthrough)) bail("passthrough must be a table");
			// In the order of their names, as 0.7 read them.
			for (const from of Object.keys(site.passthrough).sort()) {
				at = ["passthrough", from];
				const to = site.passthrough[from];
				if (typeof to !== "string") bail(`passthrough: the destination for "${from}" must be a string`);
				config.passthrough.push(to === "" ? { from } : { from, to });
			}
		}
	} catch (e) {
		invalid(e);
	}
}
