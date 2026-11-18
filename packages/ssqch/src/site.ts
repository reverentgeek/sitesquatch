// The site model: everything up to the list of pages. Engines, global data, templates with
// their data (the cascade), pagination, computed data, permalinks and collections. It's what
// `build` renders, and what `ssqch inspect` reports on.
//
// The cascade, lowest first: global data < layout front matter < directory data < template data
// file < front matter < `computed`.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as api from "./api.ts";
import type { Config, Dirs, Filter } from "./config.ts";
import { dirsOf } from "./config.ts";
import { excerpt, headings } from "./content.ts";
import type { Data } from "./data.ts";
import { NOT_DATA, decodeText, getPath, isPlainObject, loadDataFile, merge, normalizeTags, parseFrontMatter, readText, sameValue, setOwn, STATIC_DATA_EXTENSIONS, toDate } from "./data.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { BuildError, Diagnostics, aliasUsed, bail, context, error as errorOf, messageOf, progress, warn, warning } from "./diagnostics.ts";
import { edgeEngine } from "./engines/edge.ts";
import { ejsEngine } from "./engines/ejs.ts";
import { Engines, plainEngine } from "./engines/engine.ts";
import type { EngineEnv, RenderContext } from "./engines/engine.ts";
import { handlebarsEngine } from "./engines/handlebars.ts";
import { liquidEngine } from "./engines/liquid.ts";
import { loadHookTemplates, markdownEngine } from "./engines/markdown.ts";
import type { HookTemplate, Markdown } from "./engines/markdown.ts";
import { nunjucksEngine } from "./engines/nunjucks.ts";
import * as equivalents from "./equivalents.ts";
import { builtinFilters } from "./filters.ts";
import { globSet, globToRegExp, isGlob } from "./glob.ts";
import { describeThrown, settle } from "./modules.ts";
import { comparePaths, displayPath, isDir, isFile, isInside, readFollowing, realPath, relative, shown, slashes, walkFiles } from "./paths.ts";
import { closest } from "./suggest.ts";
import { VERSION } from "./version.ts";
import * as voice from "./voice.ts";

export interface Layout {
	name: string;
	/** The file. */
	path: string;
	/** The engines it runs through: `.html` layouts get `htmlEngine` first, `.md` layouts `markdownEngine`, like pages. */
	engines: string[];
	body: string;
	data: Data;
}

export interface Tpl {
	/** The file, absolute. */
	input: string;
	/** Its path from the input folder (or its theme's), with `/`. */
	rel: string;
	body: string;
	/** Its data: the whole cascade but `computed`. */
	data: Data;
	engines: string[];
	/** Its layouts, innermost first. */
	layouts: Layout[];
	fileSlug: string;
	filePathStem: string;
	mtime: Date;
	/** The same time in nanoseconds: pages without a date are ordered by it, and two files written in one millisecond still have an order. */
	mtimeNs: bigint;
	/** The date at the start of the file name (`2024-06-01-post.md`). */
	fileDate: Date | undefined;
	/** `page.lastModified`, with the `lastModified` setting. */
	lastModified: Date | undefined;
	/** Plain text with no front matter: copied as it is and kept out of collections. */
	plainCopy: boolean;
	/** The keys in the file's own front matter, for schemas' `unknown`. */
	frontKeys: string[];
	/** For `ssqch inspect`: each level of the data cascade that set something, lowest first, by what to call it. Empty in a build. */
	layers: Array<[string, Data]>;
}

export interface Page {
	/** Its place in the list of pages. */
	index: number;
	tpl: Tpl;
	data: Data;
	url: string | null;
	/** The file it's written to, absolute. */
	output: string | null;
	date: Date;
	/** The date as collections order by it, in nanoseconds: the file's own time when that's where the date came from. */
	when: bigint;
	inCollections: boolean;
	/** What collections hold for it (made once, when collections are first built). */
	item?: Data;
}

/** The engines a file with extension `ext` runs through, unless its data says otherwise. */
export function enginesFor(config: Config, ext: string): string[] {
	const pre = ext === "md" || ext === "markdown" ? config.markdownEngine : ext === "html" ? config.htmlEngine : null;
	const own = ext === "markdown" ? "md" : ext;
	return pre === null ? [own] : [pre, own];
}

/** A template's format from its extension; a file named only `.html` has no stem, so its whole name is the extension. */
function templateExtension(file: string): string {
	const name = path.basename(file);
	const ext = path.extname(name);
	return (ext !== "" ? ext.slice(1) : name.startsWith(".") ? name.slice(1) : "").toLowerCase();
}

/** Template and directory data files (`hello.data.js`, `posts.data.json`) sit next to templates, but aren't templates themselves. */
const isDataFile = (name: string) => name.includes(".data.");

export class Timer {
	last = performance.now();
	timings: Array<[string, number]> = [];
	lap(label: string): void {
		const now = performance.now();
		this.timings.push([label, now - this.last]);
		this.last = now;
	}
}

/** A file to copy, and where to. */
export type CopyJob = [from: string, to: string];

export class Site {
	config: Config;
	dirs: Dirs;
	markdown!: Markdown;
	engines = new Engines();
	themeIncludes: string[] = [];
	global: Data = {};
	/** The template files, in the order pages are made. */
	files: string[] = [];
	tpls: Tpl[] = [];
	pages: Page[] = [];
	themeCopies: CopyJob[] = [];
	/** Drafts a production build left out. */
	drafts = 0;
	/** The layouts the pages use, by name. */
	layouts = new Map<string, Layout>();
	collections: Data = {};
	/** Every file seen while looking for templates, so a data file next to a template is found without asking the disk. */
	private seen = new Set<string>();
	private keepLayers: boolean;
	/** Set by the build: a page's rendered body, on demand (for `templateContent`). */
	contentOf: (page: Page) => string | undefined = () => undefined;

	constructor(config: Config, keepLayers = false) {
		this.config = config;
		this.dirs = dirsOf(config);
		this.keepLayers = keepLayers;
	}

	private seenLower: Set<string> | undefined;
	private caseBlind: boolean | undefined;

	/**
	 * Whether a file next to a template is there, from what the walk saw (a page's own data file
	 * is looked for seven ways, for every page: asking the disk each time is most of a second on
	 * a big site). On a disk that doesn't tell `page.json` from `Page.json`, neither does this.
	 */
	private sawFile(file: string): boolean {
		if (this.seen.has(file)) return true;
		if (this.caseBlind === undefined) {
			// The input folder under another spelling is the same folder only on such a disk.
			const { input } = this.dirs;
			const other = input === input.toUpperCase() ? input.toLowerCase() : input.toUpperCase();
			this.caseBlind = other !== input && isDir(other);
		}
		if (!this.caseBlind) return false;
		this.seenLower ??= new Set([...this.seen].map((f) => f.toLowerCase()));
		return this.seenLower.has(file.toLowerCase());
	}

	/** From the project root with `./` in front: how templates and logs name a file. */
	display(file: string): string {
		return displayPath(this.dirs.root, file);
	}

	/** The folder `file` is a page of: the theme it's in, or the input folder. */
	rootOf(file: string): string {
		return this.config.themes.find((theme) => isInside(theme, file)) ?? this.dirs.input;
	}

	// ---- engines and global data ---------------------------------------------------------------

	async prepare(timer: Timer): Promise<void> {
		const { config, dirs } = this;
		this.markdown = markdownEngine(config.markdown, dirs.root);
		// The `ssqch` module's `markdown()` has the site's options and no render hooks.
		Object.assign(api.site, { root: dirs.root, input: dirs.input, markdown: (text: string, inline: boolean) => this.markdown.plain(text, inline) });
		const globals = builtinFilters(this.markdown, config);
		// Other generators' filters that are aliases here: `url` and `relative_url` give the URL
		// back (the build adds `base` itself), and `markdownify` is `markdown`. A config filter with
		// the same name replaces one.
		const pipeFilters = new Map<string, Filter>();
		for (const row of equivalents.TABLE) {
			if (row.kind !== "filter" || !row.alias || config.filters.has(row.word)) continue;
			const target = globals.get(row.ssqch);
			pipeFilters.set(row.word, (...args: unknown[]) => {
				aliasUsed(row);
				return target ? target(...args) : args[0];
			});
		}
		for (const [name, fn] of config.filters) globals.set(name, fn);
		this.themeIncludes = config.themes.map((theme) => path.join(theme, "_includes"));
		const env: EngineEnv = { config, dirs, includeDirs: [dirs.includes, ...this.themeIncludes], globals, pipeFilters, strict: config.strict };
		const byName = this.engines.byName;
		byName.set("md", this.markdown);
		byName.set("html", plainEngine);
		byName.set("txt", plainEngine);
		byName.set("edge", edgeEngine(env));
		byName.set("njk", nunjucksEngine(env, "njk"));
		const jinja = nunjucksEngine(env, "jinja");
		for (const name of ["jinja", "j2"]) byName.set(name, jinja);
		byName.set("liquid", liquidEngine(env));
		// Mustache templates render as Handlebars, which reads Mustache's tags, as in 0.7.
		const hbs = handlebarsEngine(env);
		for (const name of ["hbs", "handlebars", "mustache"]) byName.set(name, hbs);
		byName.set("ejs", ejsEngine(env));
		for (const [name, fn] of config.engines) {
			byName.set(name, {
				render: (source, data, ctx) => {
					try {
						const out = fn(source, data, ctx.name);
						return typeof out === "string" ? out : out.catch((e) => { throw new BuildError(describeThrown(e, dirs.root)); });
					} catch (e) {
						throw new BuildError(describeThrown(e, dirs.root));
					}
				},
			});
		}
		for (const format of config.templateFormats) {
			try { this.engines.get(format); } catch (e) { throw context(e, "check `template_formats`"); }
		}
		// Markdown's render hooks and containers: a theme's, then the site's own on top of them.
		const hooks = new Map<string, HookTemplate>();
		const chain = (ext: string) => enginesFor(config, ext);
		for (const dir of [...this.themeIncludes].reverse()) for (const [name, t] of loadHookTemplates(dir, "_includes (theme)", this.engines, chain)) hooks.set(name, t);
		for (const [name, t] of loadHookTemplates(dirs.includes, slashes(config.includes), this.engines, chain)) hooks.set(name, t);
		this.markdown.useHooks(hooks, this.engines);
		timer.lap("setup");

		// ---- global data
		const skipped: string[] = [];
		const siteData = await this.loadGlobalData(dirs.data, skipped, "");
		// Themes' `_data` first (the one on top last), then the site's over it.
		let global: Data = {};
		for (const theme of [...config.themes].reverse()) global = merge(global, await this.loadGlobalData(path.join(theme, "_data"), [], ""), config.deepMerge);
		global = merge(global, siteData, config.deepMerge);
		const provided = await Promise.all(config.globalData.map(async ({ name, value, fn }) => {
			if (!fn) return [name, value] as const;
			try { return [name, await settle(fn())] as const; } catch (e) { throw new BuildError(`global data \`${name}\` failed: data.${name}: ${describeThrown(e, dirs.root)}`); }
		}));
		for (const [name, value] of provided) global[name] = value;
		try { aliasDataKeys(global); } catch (e) { throw context(e, "in global data"); }
		for (const file of skipped) {
			const stem = (file.split("/").pop() ?? file).split(".")[0];
			if (!(stem in global) && !config.quiet) {
				warn(warning("data", `skipped _data/${file} (no loader for that format; provide \`${stem}\` in the config's \`data\`)`, { file: this.display(path.join(dirs.data, file)) }));
			}
		}
		global.ssqch = { version: VERSION, generator: `SiteSquatch v${VERSION}`, env: config.env, serving: config.serving, base: config.base };
		this.global = global;
		timer.lap("data");

		// ---- templates
		this.files = this.discover();
		// Pages and files from themes that the site doesn't have itself.
		const [themePages, themeCopies] = this.themeFiles();
		this.files.push(...themePages);
		this.themeCopies = themeCopies;
		const commitDates = config.lastModified === "git" ? this.gitDates() : new Map<string, Date>();
		const dirData = await this.loadDirectoryData();
		const sources = await readAll(this.files);
		const tpls = await collectErrors(this.files.map((file, i) => () => this.loadTemplate(file, sources[i], dirData, commitDates)));
		// Drafts (`draft: true`) are built in development only.
		this.tpls = config.env !== "production" ? tpls : tpls.filter((t) => {
			const draft = Boolean(t.data.draft);
			if (draft && config.verbose) progress(`[ssqch] Skipping draft ${t.rel}`);
			return !draft;
		});
		this.drafts = tpls.length - this.tpls.length;
		timer.lap("read");

		// ---- pagination, computed data and permalinks
		const overCollections = (t: Tpl) => typeof t.data.pagination?.data === "string" && t.data.pagination.data.startsWith("collections");
		const immediate = this.tpls.filter((t) => !overCollections(t));
		const deferred = this.tpls.filter(overCollections);
		const add = (pages: Page[][]) => { for (const page of pages.flat()) { page.index = this.pages.length; this.pages.push(page); } };
		add(await collectErrors(immediate.map((t) => () => this.expand(t, undefined))));
		if (deferred.length) {
			await this.buildCollections();
			const shallow = this.collections;
			add(await collectErrors(deferred.map((t) => () => this.expand(t, shallow))));
		}
		this.checkConflicts();
	}

	/**
	 * Reads every data file in a global data folder. Subfolders become nested objects. Files in
	 * a format nothing reads are added to `skipped`.
	 */
	private async loadGlobalData(dir: string, skipped: string[], prefix: string): Promise<Data> {
		const data: Data = {};
		if (!isDir(dir)) return data;
		for (const name of fs.readdirSync(dir).sort(comparePaths)) {
			if (name.startsWith(".")) continue;
			const file = path.join(dir, name);
			const stem = name.slice(0, name.length - path.extname(name).length);
			// A file or folder named `__proto__` is a key like any other (setOwn).
			if (isDir(file)) setOwn(data, name, await this.loadGlobalData(file, skipped, `${prefix}${name}/`));
			else {
				const value = await loadDataFile(file, this.config.dataExtensions);
				if (value === NOT_DATA) skipped.push(`${prefix}${name}`);
				else setOwn(data, stem, value);
			}
		}
		return data;
	}

	// ---- discover ------------------------------------------------------------------------------

	private formats(): Set<string> {
		const formats = new Set(this.config.templateFormats.map((f) => f.toLowerCase()));
		if (formats.has("md")) formats.add("markdown");
		return formats;
	}

	/** The template languages the site has engines for, rendered or not. */
	private engineLanguages(): Set<string> {
		return new Set([...this.engines.byName.keys()].filter((name) => !["md", "html", "txt"].includes(name)).map((name) => name.toLowerCase()));
	}

	/**
	 * Every template language the site has, listed in `templateFormats` or not, Markdown
	 * included. A file in one isn't copied as it is (from a theme or a page bundle) when it isn't
	 * rendered: its front matter may be a draft.
	 */
	templateLanguages(): Set<string> {
		return new Set([...this.config.templateFormats.map((f) => f.toLowerCase()), ...this.engineLanguages(), "markdown", "md"]);
	}

	private discover(): string[] {
		const { config, dirs } = this;
		const formats = this.formats();
		const ignore = globSet("ignore", config.ignore);
		const passthroughGlobs = globSet("passthrough", config.passthrough.map((p) => p.from).filter(isGlob));
		// `_blueprints` holds the pages `ssqch new` starts from, which aren't pages of the site.
		// A theme folder inside the input folder is a theme, not pages of the site's own.
		const skipDirs = new Set([dirs.includes, dirs.layouts, dirs.data, dirs.output, path.join(dirs.input, "_blueprints"), ...config.themes, ...config.passthrough.map((p) => path.resolve(dirs.root, p.from))].map(realPath));
		// Files in a template language the site has but doesn't render, by extension: usually a
		// missing `templateFormats` entry.
		const engines = this.engineLanguages();
		const unrendered = new Map<string, string[]>();
		const files: string[] = [];
		// Links are followed: a linked folder's pages are pages under the link's name too. A link
		// that leads back up to a folder it's inside, or to nothing, is an error.
		const lost = (problem: { path: string; loop?: string }): never => bail(problem.loop !== undefined ? `File system loop found: ${problem.path} points to an ancestor ${problem.loop}` : `IO error for operation on ${problem.path}: No such file or directory (os error 2)`);
		const walk = (dir: string, above: string[]) => {
			for (const entry of readFollowing(dir, above, lost)) {
				const { name, path: file } = entry;
				if (name.startsWith(".") || name === "node_modules") continue;
				if (skipDirs.has(entry.real)) continue;
				if (entry.isDirectory) {
					walk(file, [...above, entry.real]);
					continue;
				}
				if (!entry.isFile) continue;
				this.seen.add(file);
				if (isDataFile(name)) continue;
				const ext = path.extname(name).slice(1).toLowerCase();
				if (!formats.has(ext) && !engines.has(ext)) continue;
				const rel = relative(dirs.input, file);
				if (ignore(rel) || passthroughGlobs(relative(dirs.root, file))) continue;
				if (!formats.has(ext)) {
					if (!unrendered.has(ext)) unrendered.set(ext, []);
					unrendered.get(ext)!.push(relative(dirs.root, file));
					continue;
				}
				files.push(file);
			}
		};
		// The input folder itself is skipped too when it's one of those, as 0.7 skipped it: with
		// `--output .` the input folder is the output, and its pages would be written over
		// themselves.
		if (!skipDirs.has(realPath(dirs.input))) walk(dirs.input, [realPath(dirs.input)]);
		this.warnUnrendered(unrendered);
		return files.sort(comparePaths);
	}

	/** Warns about templates the site doesn't render: usually a missing `templateFormats` entry. */
	private warnUnrendered(unrendered: Map<string, string[]>): void {
		for (const ext of [...unrendered.keys()].sort()) {
			const paths = unrendered.get(ext)!.sort();
			const n = paths.length;
			const which = n === 1 ? `${paths[0]} isn't rendered` : `${n} .${ext} files aren't rendered (${paths.slice(0, 3).join(", ")}${n > 3 ? ", ..." : ""})`;
			const them = n === 1 ? "it" : "them";
			warn(warning("template-formats", `${which}: templateFormats is ${this.config.templateFormats.join(", ")}. Add "${ext}" to render ${them}, or list ${them} in \`ignore\`.`, { file: paths[0] }));
		}
	}

	/**
	 * What themes add to the site: pages to render, and files to copy to the output. A path the
	 * site's input folder has is the site's, and a theme on top hides the same path in a theme
	 * below it.
	 */
	private themeFiles(): [string[], CopyJob[]] {
		const { config, dirs } = this;
		const formats = this.formats();
		const languages = this.templateLanguages(), engines = this.engineLanguages();
		const unrendered = new Map<string, string[]>();
		const ignore = globSet("ignore", config.ignore);
		const pages: string[] = [], copies: CopyJob[] = [];
		const taken = new Set<string>();
		for (const theme of config.themes) {
			const lost = (problem: { path: string; loop?: string }): never => bail(problem.loop !== undefined ? `File system loop found: ${problem.path} points to an ancestor ${problem.loop}` : `IO error for operation on ${problem.path}: No such file or directory (os error 2)`);
			const walk = (dir: string, depth: number, above: string[]) => {
				for (const entry of readFollowing(dir, above, lost).sort((a, b) => comparePaths(a.name, b.name))) {
					const { name, path: file } = entry;
					if (name.startsWith(".") || name === "node_modules" || (depth === 1 && (name === "_includes" || name === "_data" || name === "_blueprints" || isThemeMeta(name)))) continue;
					if (entry.isDirectory) { walk(file, depth + 1, [...above, entry.real]); continue; }
					if (!entry.isFile) continue;
					this.seen.add(file);
					const rel = relative(theme, file);
					if (ignore(rel) || fs.existsSync(path.join(dirs.input, rel)) || taken.has(rel)) continue;
					taken.add(rel);
					const ext = path.extname(name).slice(1).toLowerCase();
					if (formats.has(ext) && !isDataFile(name)) { pages.push(file); continue; }
					// A template that isn't rendered isn't copied as it is either: it may be a draft.
					if (languages.has(ext) && !isDataFile(name)) {
						if (engines.has(ext)) {
							if (!unrendered.has(ext)) unrendered.set(ext, []);
							unrendered.get(ext)!.push(relative(dirs.root, file));
						}
						continue;
					}
					// Data for a page or a folder (`posts/posts.json`, `about.json` next to `about.md`) isn't copied.
					const stem = name.slice(0, name.length - path.extname(name).length);
					const isDataExt = STATIC_DATA_EXTENSIONS.includes(ext);
					const besidePage = [...formats].some((f) => isFile(path.join(dir, `${stem}.${f}`)));
					if (isDataFile(name) || (isDataExt && (stem === path.basename(dir) || besidePage))) continue;
					copies.push([file, path.join(dirs.output, rel)]);
				}
			};
			walk(theme, 1, [realPath(theme)]);
		}
		this.warnUnrendered(unrendered);
		return [pages, copies];
	}

	/**
	 * When each file in the git repository last changed in a commit, from one `git log`. Files
	 * with uncommitted changes are left out (they use their modification time). Not a
	 * repository, or no git: nothing, with a warning.
	 */
	private gitDates(): Map<string, Date> {
		const { config, dirs } = this;
		const git = (...args: string[]) => spawnSync("git", ["-C", dirs.root, "-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
		const dates = new Map<string, Date>();
		const lost = (message: string) => { if (!config.quiet) warn(warning("last-modified", `lastModified: ${message}`)); };
		const top = git("rev-parse", "--show-toplevel");
		if (top.error) { lost(`can't run git (${top.error.message}), so pages use their files' times`); return dates; }
		if (top.status !== 0) { lost("not a git repository, so pages use their files' times"); return dates; }
		const toplevel = realPath(top.stdout.trim());
		if (git("rev-parse", "--is-shallow-repository").stdout?.trim() === "true") {
			lost("this is a shallow clone, so dates come from the commits it has (fetch the full history, like `fetch-depth: 0` in GitHub Actions)");
		}
		const log = git("log", "--format=@%ct", "--name-only", "--no-merges", "--", ".");
		if (log.error || log.status !== 0) return dates;
		let current: Date | undefined;
		for (const line of log.stdout.split("\n")) {
			if (line.startsWith("@")) {
				const seconds = Number.parseInt(line.slice(1).trim(), 10);
				current = Number.isFinite(seconds) ? new Date(seconds * 1000) : undefined;
			} else if (line.trim() !== "" && current) {
				const file = path.join(toplevel, line.trim());
				if (!dates.has(file)) dates.set(file, current);
			}
		}
		const status = git("status", "--porcelain", "--", ".");
		if (!status.error && status.status === 0) {
			for (const line of status.stdout.split("\n")) {
				if (line.length <= 3) continue;
				const changed = line.slice(3).split(" -> ").pop()!;
				dates.delete(path.join(toplevel, changed));
			}
		}
		// Templates are found through the input folder's real path.
		return new Map([...dates].map(([file, date]) => [realPath(file), date]));
	}

	// ---- the cascade ---------------------------------------------------------------------------

	/** Directory data files: `posts/posts.json` (or `posts/posts.data.json`) applies to everything inside `posts/`. */
	private async loadDirectoryData(): Promise<Map<string, Data>> {
		const dirs = new Set<string>();
		for (const file of this.files) {
			const root = this.rootOf(file);
			for (let dir = path.dirname(file); isInside(root, dir); dir = path.dirname(dir)) {
				if (dirs.has(dir)) break;
				dirs.add(dir);
			}
		}
		const out = new Map<string, Data>();
		for (const dir of dirs) {
			const name = path.basename(dir);
			const candidates: string[] = [];
			for (const ext of STATIC_DATA_EXTENSIONS) candidates.push(`${name}.${ext}`, `${name}.data.${ext}`);
			// Added formats (JavaScript) only with the `.data.` suffix, so a `posts/posts.js` script
			// isn't mistaken for data.
			for (const ext of this.config.dataExtensions.keys()) candidates.push(`${name}.data.${ext}`);
			let data: Data = {};
			for (const candidate of candidates) {
				const file = path.join(dir, candidate);
				if (!(this.seen.has(file) || isFile(file))) continue;
				const value = await loadDataFile(file, this.config.dataExtensions);
				if (!isPlainObject(value)) continue;
				const layer = { ...value };
				try { aliasDataKeys(layer); } catch (e) { throw context(e, `in ${shown(this.dirs.root, file)}`); }
				data = merge(data, layer, true);
			}
			if (Object.keys(data).length) {
				normalizeTags(data);
				out.set(dir, data);
			}
		}
		return out;
	}

	/** ` (did you mean \`posts.edge\`?)` for a layout name that's nearly the name of a file in the layouts folder, or nothing. */
	private closestLayout(name: string): string {
		const files = walkFiles(this.dirs.layouts).map((file) => relative(this.dirs.layouts, file));
		// A layout can be named without its extension.
		const stems = files.filter((f) => f.includes(".")).map((f) => f.slice(0, f.lastIndexOf(".")));
		const found = closest(name, [...files, ...stems].filter((c) => c !== name));
		return found ? ` (did you mean \`${found}\`?)` : "";
	}

	private loadLayout(name: string): Layout {
		const cached = this.layouts.get(name);
		if (cached) return cached;
		const { config, dirs } = this;
		// The site's layouts folder, then each theme's includes.
		let file: string | undefined;
		for (const dir of [dirs.layouts, ...this.themeIncludes]) {
			file = [path.join(dir, name), ...config.templateFormats.map((ext) => path.join(dir, `${name}.${ext}`))].find(isFile);
			if (file) break;
		}
		if (!file) bail(`layout \`${name}\` not found: no sightings in ${dirs.layouts}${config.themes.length ? " or the theme" : ""}${this.closestLayout(name)}`);
		let parsed: { data: Data; body: string };
		try {
			parsed = parseFrontMatter(readText(file));
			aliasDataKeys(parsed.data);
		} catch (e) {
			throw context(e, `in layout ${file}`);
		}
		const layout: Layout = { name: `${slashes(config.layouts ?? config.includes)}/${name}`, path: file, engines: enginesFor(config, templateExtension(file)), body: parsed.body, data: parsed.data };
		this.layouts.set(name, layout);
		return layout;
	}

	private async loadTemplate(file: string, source: Buffer, dirData: Map<string, Data>, commitDates: Map<string, Date>): Promise<Tpl> {
		const { config, dirs } = this;
		const root = this.rootOf(file);
		const rel = relative(root, file);
		try {
			const src = decodeText(source);
			const { data: front, body } = parseFrontMatter(src);
			const frontKeys = Object.keys(front);
			aliasDataKeys(front);
			const hasFrontMatter = body.length !== src.length;

			// Template-level data: directory data (outermost first), then the template's own data
			// file, then front matter.
			let own: Data = {};
			const layers: Array<[string, Data]> = [];
			const above: string[] = [];
			for (let dir = path.dirname(file); isInside(root, dir); dir = path.dirname(dir)) above.unshift(dir);
			for (const dir of above) {
				const data = dirData.get(dir);
				if (!data) continue;
				own = merge(own, data, config.deepMerge);
				if (this.keepLayers) {
					// Named by its file, when there's just the one.
					const name = path.basename(dir);
					const files = fs.readdirSync(dir).filter((f) => { const stem = f.slice(0, f.length - path.extname(f).length); return (stem === name || stem === `${name}.data`) && isFile(path.join(dir, f)); });
					layers.push([files.length === 1 ? shown(dirs.root, path.join(dir, files[0])) : `directory data in ${shown(dirs.root, dir)}/`, data]);
				}
			}
			const name = path.basename(file);
			const stem = name.slice(0, name.length - path.extname(name).length);
			for (const suffix of ["json", "data.json", ...[...config.dataExtensions.keys()].map((ext) => `data.${ext}`)]) {
				const candidate = path.join(path.dirname(file), `${stem}.${suffix}`);
				if (!this.sawFile(candidate)) continue;
				const value = await loadDataFile(candidate, config.dataExtensions);
				if (!isPlainObject(value)) continue;
				const layer = { ...value };
				try { aliasDataKeys(layer); } catch (e) { throw context(e, `in ${shown(dirs.root, candidate)}`); }
				own = merge(own, layer, config.deepMerge);
				if (this.keepLayers) layers.push([shown(dirs.root, candidate), layer]);
			}
			normalizeTags(front);
			own = merge(own, front, config.deepMerge);
			if (this.keepLayers && frontKeys.length) layers.push(["front matter", front]);

			// The layout chain is chosen here, before `computed` runs: a computed layout that's plain
			// text is used as written, and one that depends on the page's data is refused rather
			// than ignored.
			const computedLayout = own.computed?.layout;
			if (computedLayout !== undefined && computedLayout !== null) {
				if (typeof computedLayout === "string" && !computedLayout.includes("{{") && !computedLayout.includes("{%") && !computedLayout.includes("<%")) own.layout = computedLayout;
				else bail("`layout` in computed isn't applied, because the layout is chosen before computed runs. Set `layout` in the front matter or a data file");
			}
			// Layout chain; layout front matter sits below template data. `layout: ""`, like `false`
			// and `null`, means no layout.
			const chain: Layout[] = [];
			const names: string[] = [];
			let next: unknown = typeof own.layout === "string" && own.layout !== "" ? own.layout : undefined;
			while (typeof next === "string") {
				// A layout that leads back to one already in the chain never ends.
				const start = names.indexOf(next);
				if (start !== -1) bail(`${voice.PASSED_THIS_TREE}. Layout loop: ${names.slice(start).join(" -> ")} -> ${next}`);
				const layout = this.loadLayout(next);
				names.push(next);
				chain.push(layout);
				next = layout.data.layout;
			}
			let data = this.global;
			let layoutLayers = 0;
			for (const layout of [...chain].reverse()) {
				data = merge(data, layout.data, config.deepMerge);
				// Layouts sit below everything the page has of its own, outermost first.
				if (this.keepLayers && Object.keys(layout.data).length) layers.splice(layoutLayers++, 0, [`layout ${layout.name}`, layout.data]);
			}
			data = merge(data, own, config.deepMerge);
			normalizeTags(data);

			let ext = templateExtension(file);
			if (ext === "markdown") ext = "md";
			const engines = data.render !== undefined && data.render !== null ? renderEngines(data.render) : enginesFor(config, ext);

			const parent = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
			let fileSlug = stem === "index" ? path.posix.basename(parent) : stem;
			fileSlug = fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
			const fileDate = /^\d{4}-\d{2}-\d{2}/.test(stem) ? toDate(stem.slice(0, 10)) : undefined;
			const stat = fs.statSync(file, { bigint: true });
			const mtime = new Date(Number(stat.mtimeMs));
			return {
				layers,
				frontKeys,
				plainCopy: !hasFrontMatter && engines.every((e) => e === "txt"),
				input: file,
				rel,
				body,
				data,
				engines,
				layouts: chain,
				fileSlug,
				filePathStem: parent === "" ? `/${stem}` : `/${parent}/${stem}`,
				mtime,
				mtimeNs: stat.mtimeNs,
				fileDate,
				lastModified: config.lastModified === "git" ? commitDates.get(file) ?? mtime : config.lastModified === "file" ? mtime : undefined,
			};
		} catch (e) {
			throw context(e, `in ${rel}`);
		}
	}

	// ---- pagination, computed data and permalinks ----------------------------------------------

	private async expand(tpl: Tpl, collections: Data | undefined): Promise<Page[]> {
		try {
			return await this.expandPages(tpl, collections);
		} catch (e) {
			throw context(e, `in ${tpl.rel}`);
		}
	}

	private async expandPages(tpl: Tpl, collections: Data | undefined): Promise<Page[]> {
		const { dirs } = this;
		const inputPath = this.display(tpl.input);
		let date: Date;
		let fromFileTime = false;
		if (tpl.data.date !== undefined && tpl.data.date !== null) date = toDate(tpl.data.date) ?? bail(`can't parse date ${show(tpl.data.date)}`);
		// Then the date in the file name, then when the file last changed.
		else if (tpl.fileDate) date = tpl.fileDate;
		else [date, fromFileTime] = [tpl.mtime, true];
		const basePage = (url: unknown, outputPath: unknown, when: Date): Data => {
			const page: Data = { url, outputPath, inputPath, fileSlug: tpl.fileSlug, filePathStem: tpl.filePathStem, date: when };
			if (tpl.lastModified) page.lastModified = tpl.lastModified;
			return page;
		};

		const pagination = isPlainObject(tpl.data.pagination) ? tpl.data.pagination : undefined;
		let chunks: Array<unknown[] | undefined> = [undefined];
		let size = 1;
		if (pagination) {
			const from = pagination.data;
			if (typeof from !== "string") bail("pagination.data must be a string");
			// `collections.posts` is a collection's pages; `collections` alone is the collections' names (a page per tag).
			let source: unknown;
			if (collections && from.startsWith("collections.")) source = getPath(collections, from.slice(12));
			else if (collections && from === "collections") source = collections;
			else source = getPath(tpl.data, from);
			const items = paginationItems(pagination, from, source);
			size = paginationSize(pagination);
			chunks = [];
			for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
			if (!chunks.length) return [];
		}
		const allChunks = pagination ? chunks.map((c) => (size === 1 ? c![0] : c)) : [];

		const pages: Page[] = [];
		for (let index = 0; index < chunks.length; index++) {
			const chunk = chunks[index];
			const data: Data = { ...tpl.data };
			if (pagination && chunk) {
				data.pagination = { ...pagination, items: chunk, pageNumber: index, pages: allChunks };
				if (typeof pagination.alias === "string") data[pagination.alias] = size === 1 ? chunk[0] : chunk;
			}
			if (collections) data.collections = collections;
			data.page = basePage(undefined, undefined, date);

			// computed
			const computed = tpl.data.computed;
			if (isPlainObject(computed)) {
				for (const [key, value] of Object.entries(computed)) {
					try { data[key] = await this.renderComputed(value, data, tpl); } catch (e) { throw context(e, `computed.${key}`); }
				}
			}
			// A computed `date` (from the URL, say) is the page's date.
			let pageDate = date;
			let fromFile = fromFileTime;
			if (isPlainObject(computed) && computed.date !== undefined && computed.date !== null && data.date !== undefined && data.date !== null) {
				pageDate = toDate(data.date) ?? bail(`computed.date: can't parse date ${show(data.date)}`);
				fromFile = false;
			}

			// permalink
			let url: string | null;
			const permalink = data.permalink;
			if (permalink === false) url = null;
			else if (typeof permalink === "string") {
				const dynamic = data.dynamicPermalink !== false;
				url = (dynamic && hasTags(tpl, permalink) ? await this.renderDataString(tpl, "permalink", permalink, data) : permalink).trim();
			} else if (permalink !== undefined && permalink !== null) bail("permalink must be a string or false");
			// Non-HTML plain files (llms.txt) keep their own name.
			else if (tpl.engines.length && tpl.engines.every((e) => e === "txt")) url = `/${tpl.rel}`;
			else {
				const stem = tpl.filePathStem;
				url = stem === "/index" ? "/" : stem.endsWith("/index") ? stem.slice(0, -5) : `${stem}/`;
				if (index > 0) url = `${url}${index}/`;
			}
			if (url !== null && !url.startsWith("/")) url = `/${url}`;
			let output: string | null = null;
			if (url !== null) {
				const rel = url.replace(/^\/+/, "");
				output = url.endsWith("/") ? path.join(dirs.output, rel, "index.html") : path.join(dirs.output, rel);
				// `permalink: /about/index.html` writes that file; its URL is `/about/`.
				if (url.endsWith("/index.html")) url = url.slice(0, -10);
				if (!isInside(dirs.output, output) || rel.split("/").includes("..")) bail(`permalink ${show(url)} points outside the output directory`);
			}
			data.page = basePage(url ?? false, output ?? false, pageDate);
			// Like js-yaml, front matter dates become real dates.
			if (data.date !== undefined && data.date !== null) data.date = pageDate;
			delete data.collections;

			const excluded = Boolean(data.excludeFromCollections);
			const inCollections = !excluded && !tpl.plainCopy && (index === 0 || Boolean(pagination?.addAllPagesToCollections));
			pages.push({ index: -1, tpl, data, url, output, date: pageDate, when: fromFile ? tpl.mtimeNs : BigInt(pageDate.getTime()) * 1_000_000n, inCollections });
		}

		// Fill in pagination hrefs now that every page has a URL.
		if (pagination && pages.length) {
			const hrefs = pages.map((p) => p.url ?? undefined);
			const n = pages.length;
			pages.forEach((page, i) => {
				const previous = i > 0 ? hrefs[i - 1] : undefined, next = i + 1 < n ? hrefs[i + 1] : undefined;
				Object.assign(page.data.pagination, {
					hrefs,
					href: { previous, next, first: hrefs[0], last: hrefs[n - 1] },
					previousPageHref: previous,
					nextPageHref: next,
					firstPageHref: hrefs[0],
					lastPageHref: hrefs[n - 1],
				});
			});
		}
		return pages;
	}

	/**
	 * Gives a page paginated over a collection the items from the finished collections. The
	 * first pass had the collections as they were before these pages joined them, enough to
	 * count the pages and work out URLs.
	 */
	refreshPagination(page: Page): void {
		const p = page.data.pagination;
		if (!isPlainObject(p) || typeof p.data !== "string" || !p.data.startsWith("collections.")) return;
		const items = paginationItems(p, p.data, getPath(this.collections, p.data.slice(12)));
		const size = paginationSize(p);
		const chunks: unknown[][] = [];
		for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
		const chunk = chunks[typeof p.pageNumber === "number" ? p.pageNumber : 0] ?? [];
		p.items = chunk;
		p.pages = chunks.map((c) => (size === 1 ? c[0] : c));
		if (typeof p.alias === "string" && chunk.length) page.data[p.alias] = size === 1 ? chunk[0] : chunk;
	}

	/** Renders a `permalink` or `computed` string with the page's own template language. */
	private async renderDataString(tpl: Tpl, what: string, text: string, data: Data): Promise<string> {
		const ctx: RenderContext = { name: `${tpl.rel} (${what})`, inputPath: tpl.input };
		return this.engines.get(dataStringEngine(tpl)).render(text, data, ctx);
	}

	private async renderComputed(value: unknown, data: Data, tpl: Tpl): Promise<unknown> {
		if (typeof value === "string") return hasTags(tpl, value) ? this.renderDataString(tpl, "computed", value, data) : value;
		if (isPlainObject(value)) {
			const out: Data = {};
			for (const [k, v] of Object.entries(value)) out[k] = await this.renderComputed(v, data, tpl);
			return out;
		}
		// A function (from a JavaScript data file) gets the page's data.
		if (typeof value === "function") {
			try { return await settle(value(data)); } catch (e) { throw new BuildError(describeThrown(e, this.dirs.root)); }
		}
		return value;
	}

	private checkConflicts(): void {
		const seen = new Map<string, string>();
		const errors: Array<[string, string]> = [];
		for (const p of this.pages) {
			if (p.output === null) continue;
			const other = seen.get(p.output);
			if (other !== undefined) errors.push([`${other} and ${p.tpl.rel} both write to ${p.output}`, p.tpl.input]);
			seen.set(p.output, p.tpl.rel);
		}
		if (!errors.length) return;
		const message = `output conflicts (two sets of tracks lead to the same place):\n  - ${errors.map(([m]) => m).join("\n  - ")}`;
		throw new Diagnostics(message, errors.map(([m, input]) => errorOf("conflict", m, { file: this.display(input) })));
	}

	// ---- collections ---------------------------------------------------------------------------

	/** What collections hold for a page. Its content is rendered when it's first read. */
	private itemOf(page: Page): Data {
		if (page.item) return page.item;
		const site = this;
		let withBody: Data | undefined;
		const item: Data = {
			url: page.url ?? false,
			date: page.date,
			inputPath: page.data.page.inputPath,
			fileSlug: page.tpl.fileSlug,
			filePathStem: page.tpl.filePathStem,
			outputPath: page.output ?? false,
			// `page` with `headings` and `excerpt` from the rendered body.
			get page() { return withBody ??= site.pageWithBody(page); },
			data: page.data,
			get templateContent() { return site.contentOf(page); },
			get content() { return site.contentOf(page); },
		};
		return page.item = item;
	}

	/** `page` as layouts and collections see it: with `headings` and `excerpt` from the rendered body, read when they're asked for. */
	pageWithBody(page: Page): Data {
		const site = this;
		let found: ReturnType<typeof headings> | undefined;
		return Object.defineProperties({ ...page.data.page }, {
			headings: { enumerable: true, get() { return found ??= headings(site.contentOf(page) ?? ""); } },
			excerpt: { enumerable: true, get() { return excerpt(site.contentOf(page) ?? ""); } },
		});
	}

	async buildCollections(): Promise<void> {
		const members = this.pages.filter((p) => p.inCollections);
		members.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : comparePaths(a.tpl.input, b.tpl.input) || a.index - b.index));
		const all = members.map((p) => this.itemOf(p));
		const collections: Data = { all };
		const byTag = new Map<string, Data[]>();
		members.forEach((p, i) => {
			if (!Array.isArray(p.data.tags)) return;
			for (const tag of p.data.tags) {
				const name = String(tag);
				if (!byTag.has(name)) byTag.set(name, []);
				byTag.get(name)!.push(all[i]);
			}
		});
		for (const [tag, items] of byTag) collections[tag] = items;
		const pages = collectionApi(all);
		for (const [name, fn] of this.config.collections) {
			try { collections[name] = await settle(fn(pages as any)); } catch (e) { throw new BuildError(`collection \`${name}\` failed: ${describeThrown(e, this.dirs.root)}`); }
		}
		this.collections = collections;
	}
}

/** The collection API: every page in collections (oldest first). Each answer is a new list, so sorting one doesn't reorder `collections.posts`. */
function collectionApi(items: Data[]) {
	const tagsOf = (item: Data): unknown[] => (Array.isArray(item.data.tags) ? item.data.tags : []);
	return {
		all: () => [...items],
		byTag: (tag: unknown) => items.filter((item) => tagsOf(item).includes(String(tag))),
		byTags: (...tags: unknown[]) => items.filter((item) => tags.every((tag) => tagsOf(item).includes(String(tag)))),
		byGlob(globs: string | string[]) {
			const patterns = ([] as string[]).concat(globs).map((g) => globToRegExp(String(g), { loose: true }));
			return items.filter((item) => patterns.some((re) => re.test(String(item.inputPath).replace(/^\.\//, ""))));
		},
	};
}

// ---- helpers ---------------------------------------------------------------------------------

/** A value as an error shows it. */
const show = (v: unknown) => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };

/** Files at the top of a theme's folder that are about the theme, not part of it. */
function isThemeMeta(name: string): boolean {
	const stem = name.split(".")[0].toUpperCase();
	return ["README", "LICENSE", "LICENCE", "CHANGELOG", "CONTRIBUTING", "PACKAGE", "PACKAGE-LOCK", "PNPM-LOCK", "SSQCH"].includes(stem) || name === "jsconfig.json";
}

/**
 * Other generators' front-matter keys that are aliases here, as ssqch's: `eleventyComputed` is
 * `computed`, `redirect_from` is `aliases`, and so on. One layer of the cascade at a time (a
 * data file, front matter), before it's merged, so a page's `computed` is still above its
 * folder's `eleventyComputed`. Both names in one layer is an error. Changes `data`.
 */
export function aliasDataKeys(data: Data): void {
	for (const row of FRONT_MATTER_ALIASES) {
		if (!(row.word in data)) continue;
		const value = data[row.word];
		delete data[row.word];
		if (row.ssqch in data) bail(`\`${row.word}\` and \`${row.ssqch}\` are two names for one key; set one of them`);
		data[row.ssqch] = value;
		aliasUsed(row);
	}
}
const FRONT_MATTER_ALIASES = equivalents.TABLE.filter((e) => e.kind === "frontMatter" && e.alias);

/** The items a pagination goes over: `source` as a list (an object's keys), with `filter` and `reverse` applied. */
function paginationItems(p: Data, from: string, source: unknown): unknown[] {
	let items: unknown[];
	if (Array.isArray(source)) items = [...source];
	else if (isPlainObject(source)) items = Object.keys(source);
	else if (source === undefined || source === null) bail(`pagination data \`${from}\` is undefined`);
	else bail(`pagination data \`${from}\` is a ${typeof source}, not a list`);
	if (Array.isArray(p.filter)) items = items.filter((item) => !p.filter.some((out: unknown) => sameValue(out, item)));
	if (p.reverse) items.reverse();
	return items;
}

const paginationSize = (p: Data) => (typeof p.size === "number" && p.size >= 1 ? Math.trunc(p.size) : 1);

/**
 * The engines named by a template's `render` data: one name (`md`), a comma-separated chain
 * (`"liquid, md"`), a list (`[liquid, md]`), or `false` to write the body as it is.
 */
function renderEngines(v: unknown): string[] {
	if (v === false) return [];
	let names: string[];
	if (typeof v === "string") names = v.split(",").map((s) => s.trim()).filter(Boolean);
	else if (Array.isArray(v)) names = v.map((item) => (typeof item === "string" ? item.trim() : bail(`\`render\` list items must be engine names, not ${typeof item}`)));
	else bail(`\`render\` must be an engine name (\`md\`), a list of names, or false, not ${typeof v}`);
	if (!names.length) bail("`render` is empty: name an engine (`md`), or use `render: false` to skip processing");
	return names;
}

/** The template language a page's data strings (`permalink`, `computed`) are written in: the first engine in its chain that isn't Markdown or plain text, or Edge for those. */
function dataStringEngine(tpl: Tpl): string {
	return tpl.engines.find((e) => e !== "md" && e !== "html" && e !== "txt") ?? "edge";
}

/** Whether a data string has tags in that language, so it needs rendering. */
function hasTags(tpl: Tpl, s: string): boolean {
	return dataStringEngine(tpl) === "ejs" ? s.includes("<%") : s.includes("{{") || s.includes("{%");
}

/** Reads files through Node's thread pool, 64 at a time. A file's bytes are decoded when its template is read, where an error can name it. */
async function readAll(files: string[]): Promise<Buffer[]> {
	const out = new Array<Buffer>(files.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(64, files.length) }, async () => {
		while (next < files.length) {
			const i = next++;
			out[i] = await fs.promises.readFile(files[i]);
		}
	}));
	return out;
}

/** Runs every job, then reports all failures together rather than just the first. */
export async function collectErrors<T>(jobs: Array<() => T | Promise<T>>): Promise<T[]> {
	const ok: T[] = [];
	const failed: unknown[] = [];
	for (const job of jobs) {
		try { ok.push(await job()); } catch (e) { failed.push(e); }
	}
	if (failed.length) throw errorsTogether(failed);
	return ok;
}

/** Several failures as one error: the first ten listed, and each one apart for `ssqch build --format json`. */
export function errorsTogether(failed: unknown[]): Diagnostics {
	const messages = failed.map(messageOf);
	const items: Diagnostic[] = failed.flatMap((e, i) => ((e instanceof Diagnostics || e instanceof BuildError) && e.items ? e.items : [errorOf("", messages[i])]));
	return new Diagnostics(`${failed.length} error(s):\n  - ${messages.slice(0, 10).join("\n  - ")}${failed.length > 10 ? "\n  ..." : ""}`, items);
}
