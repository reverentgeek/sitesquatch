import crypto from "node:crypto";
import v8 from "node:v8";
// The site model: everything up to the list of pages. Engines, global data, templates with
// their data (the cascade), pagination, computed data, permalinks and collections. It's what
// `build` renders, and what `ssqch trace` reports on.
//
// The cascade, lowest first: global data < layout front matter < directory data < template data
// file < front matter < `computed`.
import { progressed } from "./activity.ts";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as api from "./api.ts";
import type { Config, Dirs, Filter } from "./config.ts";
import { dirsOf } from "./config.ts";
import { excerpt, headings } from "./content.ts";
import { bundledPath } from "./bundled.ts";
import { buildNav, loadMkdocs, mkdocsFilters, relativeUrl, sitePath } from "./mkdocs.ts";
import type { MkDocs, NavPage } from "./mkdocs.ts";
import { withPage } from "./rendering.ts";
import type { Data } from "./data.ts";
import { NOT_DATA, decodeText, getPath, isPlainObject, loadDataFile, merge, normalizeTags, parseFrontMatter, readText, sameValue, setOwn, sourceDateEpoch, STATIC_DATA_EXTENSIONS, toDate } from "./data.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { BuildError, Diagnostics, aliasUsed, bail, context, error as errorOf, messageOf, progress, warn, warning, warnedCount } from "./diagnostics.ts";
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
import { describeThrown, loadedFiles, settle } from "./modules.ts";
import { comparePaths, compareText, displayPath, isDir, isFile, isInside, readFollowing, realPath, relative, shown, slashes, walkFiles } from "./paths.ts";
import { closest } from "./suggest.ts";
import { Profile } from "./profile.ts";
import { paginated } from "./schema.ts";
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
	/** The date at the start of the file name (`2024-06-01-post.md`). */
	fileDate: Date | undefined;
	/** `page.lastModified`, with the `lastModified` setting. */
	lastModified: Date | undefined;
	/** When its file last changed in a commit, with `dateFallback: "git"`, for a page with no date of its own. */
	commitDate: Date | undefined;
	/** Whether git had a date for its file (with either setting): what `ssqch trace` says `page.lastModified` came from. */
	committed: boolean;
	/** Plain text with no front matter: copied as it is and kept out of collections. */
	plainCopy: boolean;
	/** The keys in the file's own front matter, for schemas' `unknown`. */
	frontKeys: string[];
	/** For `ssqch trace`: each level of the data cascade that set something, lowest first, by what to call it. Empty in a build. */
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
	/** The date as collections order by it, in nanoseconds; `UNDATED` for a page whose date is its file's time. */
	when: bigint;
	inCollections: boolean;
	/** What collections hold for it (made once, when collections are first built). */
	item?: Data;
	/** Its own layout chain, when a computed `layout` that depends on the page chose it; otherwise it's its template's (`tpl.layouts`). */
	layouts?: Layout[];
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
		// A phase done (setup, data, read, paginate) is progress, for `ssqch serve`'s limit.
		progressed();
		const now = performance.now();
		this.timings.push([label, now - this.last]);
		this.last = now;
	}
}

/** A file to copy, and where to. */
export type CopyJob = [from: string, to: string];

/** A file's modification time, or the pinned build time when `SOURCE_DATE_EPOCH` is set. */
const fileTime = (mtime: Date): Date => (sourceDateEpoch() === undefined ? mtime : new Date(sourceDateEpoch()!));

export class Site {
	config: Config;
	dirs: Dirs;
	markdown!: Markdown;
	engines = new Engines();
	themeIncludes: string[] = [];
	/** mkdocs.yml as MkDocs reads it, with `mkdocsTemplates`. */
	mkdocs: MkDocs | undefined;
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
	/** Every data file this build read (global, a theme's, directory data, a template's own), for `keptTemplates`. */
	private dataFilesRead = new Set<string>();
	/** While serving (`incremental`), what a template's data came from besides its own file, when it can be reused at all: `undefined` when it can't. */
	private shared: string | undefined;
	/**
	 * Templates made again this build whose data is what it was (the same front matter, shared
	 * inputs, layouts and commit date): only their bodies changed. For `incremental`.
	 */
	bodyOnly = new Set<string>();
	/**
	 * Templates made again this build from the same shared inputs and commit date whose front
	 * matter (or the file time their date is) changed: their own data did. For `incremental`.
	 */
	ownData = new Set<string>();
	/** Templates whose only change was their file's time, which is their date (no `date` of their own). */
	timeOnly = new Set<string>();
	/** Whether the shared inputs (the data files, the data's values) are what the last build had: when they aren't, every page's data may differ. */
	sameShared = false;
	/** Templates taken as the last build made them: a change named for one changed nothing (Windows can name a file before a delete is done, or with the folder it's in). */
	unchanged = new Set<string>();
	/** Templates new since the last build, and templates it had that this one doesn't (`lastPages`). */
	added = new Set<string>();
	gone = new Set<string>();
	/** Each layout's `fileMark`, asked once a build: 10,000 kept templates share a few layouts. */
	private layoutMarks = new Map<string, string>();
	private layoutMark(file: string): string {
		let mark = this.layoutMarks.get(file);
		if (mark === undefined) this.layoutMarks.set(file, mark = fileMark(file));
		return mark;
	}
	/** Why templates aren't kept this build, when they aren't: for the serve timeline. */
	notKept = "";
	get keepingTemplates(): boolean { return this.shared !== undefined; }
	private notKeeping(why: string): undefined {
		this.notKept = why;
		return undefined;
	}
	/** PascalCase tags the pages have with no template in `_includes/components/`, with the pages each is on. */
	unknownComponents = new Map<string, Set<string>>();
	/** Front matter dates that aren't dates, said with the schemas' errors (`checkPages`), so a page's other mistakes are said with them. */
	badDates: Diagnostic[] = [];
	private keepLayers: boolean;
	/** Set by the build: a page's rendered body, on demand (for `templateContent`). */
	contentOf: (page: Page) => string | undefined = () => undefined;

	/** What `ssqch build --profile` reports, and the `slow-call` warnings (src/profile.ts). */
	profile: Profile;

	constructor(config: Config, keepLayers = false) {
		this.config = config;
		this.dirs = dirsOf(config);
		this.keepLayers = keepLayers;
		this.profile = new Profile(config.profile);
	}

	/** A data file's value, timed with `--profile`. One that fetches can take a while on purpose, so it's no `slow-call`. */
	private ignoreGlobs: ((rel: string) => boolean) | undefined;
	/**
	 * Whether `ignore` lists a data file beside the templates. Data is read by its name
	 * (`api/api.data.ts` is `api/`'s), so another generator's file with that name (VitePress's
	 * loaders) would be imported as data: `ignore: ["**\/*.data.ts"]` keeps it out.
	 */
	private ignoredData(file: string): boolean {
		this.ignoreGlobs ??= globSet("ignore", this.config.ignore);
		return this.ignoreGlobs(relative(this.dirs.input, file));
	}

	/** A data file's error, saying why ssqch read it: a file is data by its name, which another generator's file can have too. */
	private async loadNamedData(file: string, why: string): Promise<unknown> {
		try {
			return await this.loadData(file);
		} catch (e) {
			const items = e instanceof Diagnostics || e instanceof BuildError ? e.items : undefined;
			throw new BuildError(`${messageOf(e)}. ssqch read ${shown(this.dirs.root, file)} as ${why}, by its name: if it isn't ssqch data (a VitePress loader is named this way too), list it in \`ignore\``, items);
		}
	}

	private loadData(file: string): ReturnType<typeof loadDataFile> {
		this.dataFilesRead.add(file);
		const load = () => loadDataFile(file, this.config.dataExtensions);
		return this.profile.detailed ? this.profile.time("data", shown(this.dirs.root, file), false, load) : load();
	}

	private seenLower: Set<string> | undefined;
	/** Why git gave no dates at all (`gitDates`), and the files it left out for changes not committed: for `ssqch trace`. */
	private gitNote: string | undefined;
	private gitChanged = new Set<string>();
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
		this.markdown = markdownEngine(config.markdown, dirs.root, dirs.input);
		// The `ssqch` module's `markdown()` has the site's options and no render hooks.
		Object.assign(api.site, { root: dirs.root, input: dirs.input, base: config.base, markdown: (text: string, inline: boolean) => this.markdown.plain(text, inline) });
		const globals = builtinFilters(this.markdown, config);
		// Other generators' filters that are aliases here: `url` and `relative_url` give the URL
		// back (the build adds `base` itself), and `markdownify` is `markdown`. A config filter with
		// the same name replaces one. An alias calls ssqch's name as the site has it, looked up when
		// it's called: a site with its own `markdown` (its markdown-it, with `engines: { md }`) gets
		// that from `markdownify` too.
		const pipeFilters = new Map<string, Filter>();
		for (const row of equivalents.TABLE) {
			if (row.kind !== "filter" || !row.alias || config.filters.has(row.word)) continue;
			// A plugin's function (`rssDate` is rssPlugin()'s `dateToRfc3339`): the plugin has the alias.
			if (row.ssqch !== "base" && !globals.has(row.ssqch)) continue;
			// `url` on a page with `permalink: false` (its url is `false`) printed `/false` in a11y's
			// sitemap: it prints nothing, and says so once.
			const takesUrl = row.ssqch === "base";
			let warned = false;
			pipeFilters.set(row.word, (...args: unknown[]) => {
				aliasUsed(row);
				if (takesUrl && args[0] === false) {
					if (!warned) {
						warned = true;
						warn(warning("template", `\`${row.word}\` got false, the url of a page with \`permalink: false\`, and printed nothing instead of "false". Leave such pages out first: \`{% if p.url %}\``));
					}
					return "";
				}
				const target = globals.get(row.ssqch);
				// Eleventy's `url` normalized the path it was given: `""` (and nothing) is `.`, and
				// `/a//b/../c/` is `/a/c/` (a11yproject.com's menus). A full URL stays as it is; the base is
				// ssqch's to add.
				if (row.word === "url" && (args[0] === undefined || args[0] === null || typeof args[0] === "string")) {
					const given = (args[0] ?? "") as string;
					if (given === "") args = [".", ...args.slice(1)];
					else if (given.startsWith("/") && !given.startsWith("//")) args = [path.posix.normalize(given), ...args.slice(1)];
				}
				// `collection | getNextCollectionItem(page)`: the page's neighbour in the list, or nothing.
				if (row.ssqch === "navPager") {
					const page = args[1];
					const url = page !== null && typeof page === "object" && typeof (page as { url?: unknown }).url === "string" ? (page as { url: string }).url : "";
					const pager = target ? (target(args[0], url) as { previous: unknown; next: unknown }) : { previous: null, next: null };
					return (row.word === "getNextCollectionItem" ? pager.next : pager.previous) ?? undefined;
				}
				return target ? target(...args) : args[0];
			});
		}
		for (const [name, fn] of config.filters) globals.set(name, fn);
		// Timed for the profile: every filter with `--profile`, the site's own for `slow-call`.
		for (const [name, fn] of globals) {
			const own = config.siteFilters.has(name);
			if (this.profile.times(own)) globals.set(name, this.profile.wrap("filters", name, fn, own, config.definedIn.get(`filters.${name}`)));
		}
		this.themeIncludes = config.themes.map((theme) => path.join(theme, "_includes"));
		// MkDocs' context and filters for its theme's templates (src/mkdocs.ts). A filter of the
		// site's own with the same name wins.
		if (config.mkdocsTemplates !== null) {
			this.mkdocs = loadMkdocs(dirs.root, config.mkdocsTemplates, [dirs.includes, ...this.themeIncludes]);
			for (const [name, fn] of Object.entries(mkdocsFilters(this.mkdocs))) if (!config.filters.has(name)) globals.set(name, withPage(fn));
		}
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
		// A site's engine with `cache: true` keeps what this build renders, and forgets what the
		// build before rendered and this one doesn't.
		for (const cache of config.engineCaches) cache.startBuild();
		// A site's engine named `md` takes the place of ssqch's Markdown, set just above, for `.md`
		// files and `md` in a `render` chain. The `markdown` filter stays ssqch's.
		for (const [name, fn] of config.engines) {
			byName.set(name, {
				render: (source, data, ctx) => {
					try {
						// What's being rendered, and its file as `page.inputPath` names it (`./src/posts/pine.md`).
						const out = fn(source, data, ctx.name, { kind: ctx.kind ?? "body", path: this.display(ctx.inputPath) });
						return typeof out === "string" ? out : out.catch((e) => { throw new BuildError(describeThrown(e, dirs.root)); });
					} catch (e) {
						throw new BuildError(describeThrown(e, dirs.root));
					}
				},
			});
		}
		// With `--profile`, each engine's renders are timed, under the name a page's chain uses
		// (`jinja`, `j2`). The time includes the filters the template calls.
		if (this.profile.detailed) {
			for (const [name, engine] of byName) {
				const timed = Object.create(engine);
				timed.render = (source: string, data: Data, ctx: RenderContext) => this.profile.time("engines", name, false, () => engine.render(source, data, ctx));
				byName.set(name, timed);
			}
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
			try { return [name, await settle(this.profile.detailed ? this.profile.time("data", `data.${name}`, false, fn) : fn(), `data.${name}`)] as const; } catch (e) { throw new BuildError(`global data \`${name}\` failed: data.${name}: ${describeThrown(e, dirs.root)}`); }
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
		const commitDates = config.lastModified === "git" || config.dateFallback === "git" ? this.gitDates(config.lastModified === "git" ? "lastModified" : "dateFallback") : new Map<string, Date>();
		const dirData = await this.loadDirectoryData();
		this.shared = this.sharedInputs(dirData);
		const sources = await readAll(this.files, config.serving ? new Set((config.changed ?? []).map(realPath)) : undefined);
		const tpls = await collectErrors(this.files.map((file, i) => () => this.loadTemplate(file, sources[i], dirData, commitDates)));
		// Drafts (`draft: true`) are built in development only.
		this.tpls = config.env !== "production" ? tpls : tpls.filter((t) => {
			const draft = Boolean(t.data.draft);
			if (draft && config.verbose) progress(`[ssqch] Skipping draft ${t.rel}`);
			return !draft;
		});
		this.drafts = tpls.length - this.tpls.length;
		// Pages added and gone since the last build from the same shared inputs, for
		// `incremental`: an added one only when its data is all its own (kept, as `loadTemplate`
		// keeps one: no data file of its own, no warning).
		this.sameShared = this.shared !== undefined && lastPages?.shared === this.shared;
		if (this.shared !== undefined && lastPages?.shared === this.shared) {
			const now = new Set(this.files);
			for (const file of this.files) if (!lastPages.files.has(file) && keptTemplates.has(file)) this.added.add(file);
			for (const file of lastPages.files) if (!now.has(file)) this.gone.add(file);
		}
		lastPages = this.shared === undefined ? undefined : { shared: this.shared, files: new Set(this.files) };
		timer.lap("read");

		// ---- pagination, computed data and permalinks
		const overCollections = (t: Tpl) => typeof t.data.pagination?.data === "string" && t.data.pagination.data.startsWith("collections");
		// A page whose `computed` reads `collections` waits for them too, and sees them as they are
		// without the pages that wait (the waiting pages' own computed values can change what's in
		// a collection). Expanded with the rest, it read `collections` as undefined, and a list
		// built from it came out empty, without a word (found in a migration).
		const waits = (t: Tpl) => overCollections(t) || readsCollections(t.data.computed);
		const immediate = this.tpls.filter((t) => !waits(t));
		const deferred = this.tpls.filter(waits);
		const add = (pages: Page[][]) => { for (const page of pages.flat()) { page.index = this.pages.length; this.pages.push(page); } };
		add(await collectErrors(immediate.map((t) => () => this.expand(t, undefined))));
		if (deferred.length) {
			await this.buildCollections();
			const shallow = this.collections;
			add(await collectErrors(deferred.map((t) => () => this.expand(t, shallow))));
		}
		this.checkConflicts();
		this.checkDoubleSlashes();
	}

	/**
	 * A URL with `//` in it is almost always a permalink that puts a `/` before a value that starts
	 * with one (`/{{ page.filePathStem }}/`): the files land where they should, so nothing fails,
	 * but every link to the page is wrong (opensource.guide's `//ar/metrics/`). Said once a build.
	 */
	private checkDoubleSlashes(): void {
		const found = this.pages.filter((p) => p.url !== null && p.url.includes("//"));
		if (!found.length) return;
		const shown = found.slice(0, 3).map((p) => `${p.url} (${this.display(p.tpl.input)})`).join(", ");
		warn(warning("template", `${found.length === 1 ? "1 page has" : `${found.length} pages have`} \`//\` in ${found.length === 1 ? "its URL" : "their URLs"}: ${shown}${found.length > 3 ? ", ..." : ""}. Its permalink puts a \`/\` before a value that starts with one (\`page.filePathStem\` does): take one out`, found.length === 1 ? { file: this.display(found[0].tpl.input) } : {}));
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
				const value = await this.loadData(file);
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
		const skipDirs = new Set([dirs.includes, dirs.layouts, dirs.data, dirs.output, path.join(dirs.input, "_blueprints"), ...(config.servedOutput === undefined ? [] : [path.resolve(dirs.root, config.servedOutput)]), ...config.themes, ...config.passthrough.map((p) => path.resolve(dirs.root, p.from))].map(realPath));
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
					if (isBundlerInstall(file)) continue;
					// `_site` at the top is where Jekyll and Eleventy write: another generator's build,
					// not pages (opensource.guide's Jekyll build was read as 405 more pages when ssqch
					// wrote elsewhere). It's skipped as `node_modules` is; ssqch's own output already is.
					if (name === "_site" && dir === dirs.input) continue;
					walk(file, [...above, entry.real]);
					continue;
				}
				if (!entry.isFile) continue;
				this.seen.add(file);
				if (isDataFile(name)) continue;
				// The config and the modules it (or a data file) imported are code, not pages, even
				// when `templateFormats` has "js" for a site's `.js` templates.
				if (file === config.file || loadedFiles.has(file)) continue;
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
			// mkdocsTemplates' own 404 page renders the theme's 404.html: none, no page.
			if (theme === bundledPath("mkdocs") && ![dirs.includes, ...this.themeIncludes].some((dir) => fs.existsSync(path.join(dir, "404.html")))) continue;
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
	 * with uncommitted changes are left out (they use their modification time). No git: nothing,
	 * with a warning. Not a repository: nothing, quietly, since a site made with `ssqch init`
	 * builds before anyone runs `git init`, and a warning on every build there names nothing to
	 * fix; its pages use their files' times until the first commit.
	 */
	private gitDates(setting: string): Map<string, Date> {
		const { config, dirs } = this;
		this.gitNote = undefined;
		this.gitChanged.clear();
		const git = (...args: string[]) => spawnSync("git", ["-C", dirs.root, "-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
		const dates = new Map<string, Date>();
		const lost = (message: string) => { if (!config.quiet) warn(warning("last-modified", `${setting}: ${message}`)); };
		const top = git("rev-parse", "--show-toplevel");
		if (top.error) { lost(`can't run git (${top.error.message}), so pages use their files' times`); this.gitNote = "git couldn't run"; return dates; }
		if (top.status !== 0) { this.gitNote = "the project isn't in a git repository"; return dates; }
		const toplevel = realPath(top.stdout.trim());
		if (git("rev-parse", "--is-shallow-repository").stdout?.trim() === "true") {
			lost("this is a shallow clone, so dates come from the commits it has (fetch the full history, like `fetch-depth: 0` in GitHub Actions)");
		}
		const log = git("log", "--format=@%ct", "--name-only", "--no-merges", "--", ".");
		if (log.error || log.status !== 0) { this.gitNote = "git log failed"; return dates; }
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
				if (dates.delete(path.join(toplevel, changed))) this.gitChanged.add(realPath(path.join(toplevel, changed)));
			}
		}
		// Templates are found through the input folder's real path.
		return new Map([...dates].map(([file, date]) => [realPath(file), date]));
	}

	/** Why git gave a page's file no date, for `ssqch trace`: the whole project's reason, or the file's own. */
	gitWhy(file: string): string {
		if (this.gitNote !== undefined) return this.gitNote;
		return this.gitChanged.has(file) ? "it has changes that aren't committed" : "it isn't in a commit yet";
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
				if (!(this.seen.has(file) || isFile(file)) || this.ignoredData(file)) continue;
				const value = await this.loadNamedData(file, `the directory data for ${shown(this.dirs.root, dir)}/`);
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

	private loadLayout(name: string, aliases: string[] = []): Layout {
		const cached = this.layouts.get(name);
		if (cached) return cached;
		const { config, dirs } = this;
		// Another name for a layout (`layoutAliases: { post: "layouts/post.njk" }`): its file, kept under
		// the name the page gave, so `layout: post` finds the layout, not `_includes/post.njk`.
		const alias = config.layoutAliases.get(name);
		if (alias !== undefined) {
			if (aliases.includes(name)) bail(`${voice.PASSED_THIS_TREE}. Layout alias loop: ${[...aliases, name].join(" -> ")} (layoutAliases)`);
			const layout = this.loadLayout(alias, [...aliases, name]);
			this.layouts.set(name, layout);
			return layout;
		}
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
		const commit = commitDates.get(file)?.getTime();
		const kept = this.shared !== undefined ? keptTemplates.get(file) : undefined;
		// The same bytes, as `keptSources` kept them or read again with nothing different (a file in
		// a folder Windows named): nothing in it changed, unless its date is its file's time and that moved.
		if (kept && (kept.bytes === source || (kept.bytes.equals(source) && (kept.time === undefined || new Date(fs.statSync(file).mtimeMs).getTime() === kept.tpl.mtime.getTime()))) && kept.shared === this.shared && kept.commit === commit && kept.layouts.every(([layout, mark]) => this.layoutMark(layout) === mark)) {
			this.unchanged.add(file);
			return kept.tpl;
		}
		const warned = warnedCount;
		const ownData = this.dataFilesRead.size;
		const tpl = await this.makeTemplate(file, source, dirData, commitDates);
		const text = decodeText(source);
		const front = text.slice(0, text.length - tpl.body.length);
		const layouts = tpl.layouts.map((layout): [string, string] => [layout.path, this.layoutMark(layout.path)]);
		// Kept when nothing in it can differ next time with the same bytes and the same shared
		// inputs: no data file of its own (read just now), no warning said (it would be lost).
		if (this.shared !== undefined && warnedCount === warned && this.dataFilesRead.size === ownData) {
			// Its data is what it was when everything it comes from is: only the body changed.
			// A page whose date or lastModified is its file's time has new data with every save.
			const time = this.usesFileTime(tpl) ? tpl.mtime.getTime() : undefined;
			if (kept && kept.shared === this.shared && kept.commit === commit) {
				if (kept.front !== front || kept.time !== time) this.ownData.add(file);
				// Only its file's time, which is its date: the server says so once (`build.ts`).
				if (kept.front === front && kept.time !== time) this.timeOnly.add(file);
				else if (JSON.stringify(kept.layouts) === JSON.stringify(layouts)) this.bodyOnly.add(file);
			}
			keptTemplates.set(file, { bytes: source, shared: this.shared, commit, time, layouts, front, tpl });
			remadeTemplates.delete(file);
		} else {
			keptTemplates.delete(file);
			// One that can't be kept (a data file of its own, a warning) is made every build: when it
			// comes out with the same bytes and the same data as last time, it changed nothing.
			if (this.shared !== undefined) {
				let data: string | undefined;
				try { data = crypto.createHash("sha1").update(serializedData(tpl.data)).digest("base64"); } catch { /* data that can't be compared */ }
				const was = remadeTemplates.get(file);
				const mark = JSON.stringify([this.shared, commit, layouts, tpl.mtime.getTime()]);
				if (data !== undefined && was && was.data === data && was.mark === mark && was.bytes.equals(source)) this.unchanged.add(file);
				if (data !== undefined) remadeTemplates.set(file, { bytes: source, data, mark });
				else remadeTemplates.delete(file);
			}
		}
		// Any other template made again, from the shared inputs the last build had, changed only its
		// own data as far as the other pages can tell: they see it through the collections, which
		// every build makes again. One the last build didn't keep (a warning, a file Windows sent
		// half-written) or didn't have (a page added) is one of these too.
		if (!this.bodyOnly.has(file) && !this.unchanged.has(file) && this.shared !== undefined && lastPages?.shared === this.shared) this.ownData.add(file);
		return tpl;
	}

	/**
	 * Whether a template's data can come from its file's time: `lastModified` from the file (or
	 * from git, for a file no commit has), or a date from nowhere else (`pageData`'s fallbacks). A
	 * `date` the directory data gives isn't in the template's own data, so it counts as the file's
	 * time here: only a rebuild that renders more.
	 */
	private usesFileTime(tpl: Tpl): boolean {
		const { config } = this;
		if (config.lastModified === "file" || (config.lastModified === "git" && !tpl.committed)) return sourceDateEpoch() === undefined;
		const given = tpl.data.date;
		return (given === undefined || given === null) && !tpl.fileDate && !tpl.commitDate && sourceDateEpoch() === undefined;
	}

	/**
	 * While serving (`incremental`): the inputs every template's data has besides its
	 * own file, as one string, or `undefined` when they can't be known: each data file read so far
	 * (global, the themes', directory data) by its size and time, and a hash of the values.
	 */
	private sharedInputs(dirData: Map<string, Data>): string | undefined {
		const { config } = this;
		if (!incremental(config)) return this.notKeeping(config.serving ? "SSQCH_INCREMENTAL=0" : "not serving");
		if (this.keepLayers || config.profile) return this.notKeeping("trace or --profile");
		const files = [...this.dataFilesRead].sort(compareText);
		// The values themselves too, for what code made (a data function in the config, a
		// JavaScript data file, which can answer differently each build): the global and directory
		// data, serialized as Node does (Maps, Sets and Dates kept, where JSON drops them) and hashed.
		// Something it can't serialize (a function in the data) means no reuse. The blog's global
		// data serialized and hashed in about a millisecond.
		let values: string;
		try { values = crypto.createHash("sha1").update(serializedData([this.global, [...dirData]])).digest("base64"); } catch (e) { return this.notKeeping(`the data has something that can't be compared (${messageOf(e)})`); }
		return JSON.stringify([values, files.map((file) => [file, fileMark(file)])]);
	}

	private async makeTemplate(file: string, source: Buffer, dirData: Map<string, Data>, commitDates: Map<string, Date>): Promise<Tpl> {
		const { config, dirs } = this;
		const root = this.rootOf(file);
		const rel = relative(root, file);
		try {
			const src = decodeText(source);
			const { data: front, body, duplicate } = parseFrontMatter(src);
			if (duplicate) warn(warning("front-matter", `${this.display(file)}: front matter has \`${duplicate.key}\` twice (line ${duplicate.line + 1}); the last one is used, as Jekyll uses it. Take one out`, { file: this.display(file), line: duplicate.line + 1, field: duplicate.key }));
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
				if (!this.sawFile(candidate) || this.ignoredData(candidate)) continue;
				const value = await this.loadNamedData(candidate, `the data for ${shown(dirs.root, file)}`);
				if (!isPlainObject(value)) continue;
				const layer = { ...value };
				try { aliasDataKeys(layer); } catch (e) { throw context(e, `in ${shown(dirs.root, candidate)}`); }
				own = merge(own, layer, config.deepMerge);
				if (this.keepLayers) layers.push([shown(dirs.root, candidate), layer]);
			}
			normalizeTags(front);
			own = merge(own, front, config.deepMerge);
			if (this.keepLayers && frontKeys.length) layers.push(["front matter", front]);

			// The template's layout chain is chosen here, before `computed` runs: a computed layout
			// that's plain text is used as written. One that depends on the page's data (a function,
			// or a string with template tags) chooses each page's chain after its computed values
			// (expandPages), and this one is what the page has until then.
			const computedLayout = own.computed?.layout;
			if (typeof computedLayout === "string" && !dependsOnPage(computedLayout)) own.layout = computedLayout;
			// `page` is ssqch's (url, inputPath, date, headings), set after computed: a computed `page`
			// would be thrown away, so it's refused (opensource.guide set one to give templates
			// Jekyll's `page.title`, and nothing said it didn't take).
			if (isPlainObject(own.computed) && Object.hasOwn(own.computed, "page")) bail("`page` in computed isn't applied, because `page` is ssqch's: its url, inputPath, date and headings. Give the value another name (`computed: { meta: ... }`); front matter is at the top level already (`title`, not `page.title`)");
			// Layout chain; layout front matter sits below template data. `layout: ""`, like `false`
			// and `null`, means no layout.
			// A `layout` in global data (the config's `data`, `_data/layout.*`) is every page's, below
			// directory data and front matter, as any other global value is.
			// With `mkdocsTemplates`, a Markdown page's layout is the theme's `main.html`, or the one its
			// front matter's `template` names, as MkDocs renders it.
			const mkdocsLayout = config.mkdocsTemplates !== null && /\.(?:md|markdown)$/i.test(file) ? (typeof own.template === "string" ? own.template : "main.html") : undefined;
			const chain = this.layoutChain(Object.hasOwn(own, "layout") ? own.layout : this.global.layout ?? mkdocsLayout);
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
				fileDate,
				// A file's time is when this checkout (or an editor) wrote it, so `SOURCE_DATE_EPOCH`
				// pins it, as it does an undated page's date: the same build gives the same pages.
				lastModified: config.lastModified === "git" ? commitDates.get(file) ?? fileTime(mtime) : config.lastModified === "file" ? fileTime(mtime) : undefined,
				commitDate: config.dateFallback === "git" ? commitDates.get(file) : undefined,
				committed: commitDates.has(file),
			};
		} catch (e) {
			throw context(e, `in ${rel}`);
		}
	}

	/** The layouts `layout` names, innermost first: that layout, the one its front matter names, and so on. `""`, `false` and `null` are none. */
	private layoutChain(layout: unknown): Layout[] {
		const chain: Layout[] = [];
		const names: string[] = [];
		let next: unknown = typeof layout === "string" && layout !== "" ? layout : undefined;
		while (typeof next === "string") {
			// A layout that leads back to one already in the chain never ends.
			const start = names.indexOf(next);
			if (start !== -1) bail(`${voice.PASSED_THIS_TREE}. Layout loop: ${names.slice(start).join(" -> ")} -> ${next}`);
			const found = this.loadLayout(next);
			names.push(next);
			chain.push(found);
			next = found.data.layout;
		}
		return chain;
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
		// Material for MkDocs' blog writes `date: { created, updated }`: the page's date is `created`,
		// and `date.updated` stays in its data for a template that shows it.
		const given = isPlainObject(tpl.data.date) && tpl.data.date.created !== undefined ? tpl.data.date.created : tpl.data.date;
		const parsed = given === undefined || given === null ? undefined : toDate(given);
		// A date that isn't one points at its line, and the build goes on to the schemas, so it's
		// said with the page's other mistakes (the new-docs run: `can't parse date "last Tuesday"`,
		// with no field or line, and a missing title unsaid). The page gets the date it would have
		// had without one, which the build never writes: it fails.
		if (given !== undefined && given !== null && parsed === undefined) {
			const file = inputPath.replace(/^(\.\/)+/, "");
			if (!this.badDates.some((d) => d.file === inputPath)) this.badDates.push(errorOf("front-matter", `${file}: \`date\` isn't a date: ${show(tpl.data.date)}. Write it as 2026-11-22, or with a time, 2026-11-22T09:30:00Z`, { file: inputPath, field: "date" }));
		}
		if (parsed !== undefined) date = parsed;
		// Then the date in the file name, then the last commit that changed the file
		// (`dateFallback: "git"`, the same in every checkout, where a file's time is when the checkout
		// wrote it), then the pinned build time (`SOURCE_DATE_EPOCH`, as Jekyll's `time:` gives undated
		// pages `site.time`), then when the file last changed. A commit's date and a file's time
		// aren't the page's own: it still sorts after the dated pages, by path.
		else if (tpl.fileDate) date = tpl.fileDate;
		else if (tpl.commitDate) [date, fromFileTime] = [tpl.commitDate, true];
		else if (sourceDateEpoch() !== undefined) date = new Date(sourceDateEpoch()!);
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
					try { data[key] = await this.renderComputed(value, data, tpl); } catch (e) { throw context(e, `computed.${key}${paginated(data)}`); }
				}
			}
			// A computed `layout` that depends on the page chooses this page's chain (one that's plain
			// text was chosen for the template already). Its layouts' front matter sits below the
			// page's data, as a template's layouts' does: a key the page has stays the page's.
			let layouts: Layout[] | undefined;
			if (isPlainObject(computed) && Object.hasOwn(computed, "layout") && !(typeof computed.layout === "string" && !dependsOnPage(computed.layout))) {
				const value = data.layout;
				if (value !== undefined && value !== null && value !== false && typeof value !== "string") bail(`computed.layout must be a layout's name, \`""\` or \`false\`, not ${show(value)}`);
				layouts = this.layoutChain(value);
				for (const layout of layouts) {
					for (const [key, v] of Object.entries(layout.data)) if (key !== "layout" && data[key] === undefined) data[key] = v;
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
				url = (dynamic && hasTags(tpl, this.config, permalink) ? await this.renderDataString(tpl, "permalink", permalink, data) : permalink).trim();
				// A permalink that still has tags, or came out as a paragraph, went through something
				// that isn't its template language: say so, rather than write a page at that URL.
				if (dynamic && (/\{\{|\{%|<%/.test(url) || /^<p>/i.test(url))) bail(`permalink ${show(url)} isn't a URL: it was rendered with \`${dataStringEngine(tpl, this.config)}\`, which left it like that. Write it in that template language, or set \`dynamicPermalink: false\` to use it as written`);
			} else if (permalink !== undefined && permalink !== null) bail("permalink must be a string or false");
			// Non-HTML plain files (llms.txt) keep their own name.
			else if (tpl.engines.length && tpl.engines.every((e) => e === "txt")) url = `/${tpl.rel}`;
			else {
				const stem = tpl.filePathStem;
				if (this.config.urls === "html") {
					// `/guide/intro.html`, as VitePress (without `cleanUrls`), Hugo's `uglyURLs` and
					// Docusaurus's `trailingSlash: false` write it; an index page is still its folder.
					const folder = stem === "/index" ? "/" : stem.endsWith("/index") ? stem.slice(0, -5) : undefined;
					url = index > 0 ? `${folder ?? `${stem}/`}${index}.html` : folder ?? `${stem}.html`;
				} else {
					url = stem === "/index" ? "/" : stem.endsWith("/index") ? stem.slice(0, -5) : `${stem}/`;
					if (index > 0) url = `${url}${index}/`;
				}
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
			// `page.outputPath` is named as `page.inputPath` is, from the project root (`./dist/about/index.html`):
			// the machine's whole path made a page that prints it another page on every machine.
			data.page = basePage(url ?? false, output === null ? false : this.display(output), pageDate);
			// Like js-yaml, front matter dates become real dates.
			if (data.date !== undefined && data.date !== null) data.date = pageDate;
			delete data.collections;

			const excluded = Boolean(data.excludeFromCollections);
			const inCollections = !excluded && !tpl.plainCopy && (index === 0 || Boolean(pagination?.addAllPagesToCollections));
			pages.push({ index: -1, tpl, data, url, output, date: pageDate, when: fromFile ? UNDATED : BigInt(pageDate.getTime()) * 1_000_000n, inCollections, ...(layouts ? { layouts } : {}) });
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
	private async renderDataString(tpl: Tpl, what: "permalink" | "computed", text: string, data: Data): Promise<string> {
		const ctx: RenderContext = { name: `${tpl.rel} (${what})`, inputPath: tpl.input, kind: what };
		return this.engines.get(dataStringEngine(tpl, this.config)).render(text, data, ctx);
	}

	private async renderComputed(value: unknown, data: Data, tpl: Tpl): Promise<unknown> {
		if (typeof value === "string") return hasTags(tpl, this.config, value) ? this.renderDataString(tpl, "computed", value, data) : value;
		if (isPlainObject(value)) {
			const out: Data = {};
			for (const [k, v] of Object.entries(value)) out[k] = await this.renderComputed(v, data, tpl);
			return out;
		}
		// A function (from a JavaScript data file) gets the page's data.
		if (typeof value === "function") {
			try { return await settle(value(data), "a computed value"); } catch (e) { throw new BuildError(describeThrown(e, this.dirs.root)); }
		}
		return value;
	}

	private checkConflicts(): void {
		const seen = new Map<string, string>();
		// By the two templates, in the order found: a paginated template whose pages share a
		// permalink conflicts at every path (v8 #6: 58 lines of `blog/tag.njk and blog/tag.njk both
		// write to ...`), which is one mistake, said once with how many paths.
		const groups = new Map<string, { first: string; second: string; input: string; outputs: string[] }>();
		for (const p of this.pages) {
			if (p.output === null) continue;
			const other = seen.get(p.output);
			if (other !== undefined) {
				const key = `${other}\0${p.tpl.rel}`;
				const group = groups.get(key) ?? { first: other, second: p.tpl.rel, input: p.tpl.input, outputs: [] };
				group.outputs.push(p.output);
				groups.set(key, group);
			}
			seen.set(p.output, p.tpl.rel);
		}
		if (!groups.size) return;
		const errors = [...groups.values()].map(({ first, second, input, outputs }) => {
			const paths = [...new Set(outputs)].map((o) => this.display(o));
			// Each path's first page, and the ones after it that conflict.
			const pages = paths.length + outputs.length;
			const who = first === second ? `${first} makes ${pages} pages that write to` : `${first} and ${second} both write to`;
			const where = paths.length === 1 ? paths[0] : `${paths.length} paths: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? `, and ${paths.length - 3} more` : ""}`;
			const why = first === second ? " (its pages share a permalink: give each page a part of its own, like `{{ pagination.pageNumber }}`)" : "";
			return [`${who} ${where}${why}`, input] as const;
		});
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
			outputPath: page.output === null ? false : this.display(page.output),
			// `page` with `headings` and `excerpt` from the rendered body.
			get page() { return withBody ??= site.pageWithBody(page); },
			data: page.data,
			get templateContent() { return site.contentOf(page); },
			get content() { return site.contentOf(page); },
		};
		return page.item = item;
	}

	private mkdocsPages: NavPage[] | undefined;
	/**
	 * With `mkdocsTemplates`: MkDocs' `nav` for `page` (null for the 404 page), its MkDocs page,
	 * and its `base_url`. The site's Markdown pages in the input folder are the nav's pages.
	 */
	mkdocsContext(page: Page | null): { nav: Data; page: Data | null; base_url: string } {
		const mk = this.mkdocs!;
		const { dirs } = this;
		const isDoc = (p: Page) => p.url !== null && /\.(?:md|markdown)$/i.test(p.tpl.input) && isInside(dirs.input, p.tpl.input);
		this.mkdocsPages ??= this.pages.filter(isDoc).map((p): NavPage => {
			let heading: string | null | undefined;
			return {
				src: relative(dirs.input, p.tpl.input),
				url: p.url!,
				title: typeof p.data.title === "string" ? p.data.title : null,
				meta: Object.fromEntries(p.tpl.frontKeys.map((k) => [k, p.data[k]])),
				firstHeading: () => (heading !== undefined ? heading : (heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(p.tpl.body)?.[1] ?? null)),
			};
		});
		const { nav, page: own } = buildNav(mk, this.mkdocsPages, page && isDoc(page) ? relative(dirs.input, page.tpl.input) : null);
		return { nav, page: own, base_url: own ? relativeUrl(".", String(own.url)) : sitePath(mk) };
	}

	/** `page` as layouts and collections see it: with `headings` and `excerpt` from the rendered body, read when they're asked for. */
	pageWithBody(page: Page): Data {
		const site = this;
		let found: ReturnType<typeof headings> | undefined;
		return Object.defineProperties({ ...page.data.page }, {
			// Not remembered until the page has rendered: a read before that (from `computed`, which
			// runs before any page renders) gets an empty list, and a later one the real headings.
			headings: {
				enumerable: true,
				get() {
					if (found) return found;
					const html = site.contentOf(page);
					return html === undefined ? [] : (found = headings(html));
				},
			},
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
			const from = this.config.definedIn.get(`collections.${name}`);
			try { collections[name] = await settle(this.profile.time("collections", name, true, () => fn(pages as any), from), `collection \`${name}\``); } catch (e) { throw new BuildError(`collection \`${name}\` failed: ${describeThrown(e, this.dirs.root)}`); }
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

/**
 * Where an undated page sorts: after every dated one (its date is its file's time, which is nearly
 * always the newest, so a list in date order still reads in date order), and among the undated by
 * path, as Jekyll sorts them. A fresh checkout or one edit gives files new times, and collections
 * ordered by them changed with every clone (osg #13, v8 C9).
 */
const UNDATED = 1n << 80n;

/**
 * A folder Bundler installed gems into (`bundle install --path vendor/bundle`): `ruby/<version>/gems/`
 * inside it. Its files are Ruby gems' (Jekyll's own templates among them), not the site's, so the
 * walk skips it, as it skips `node_modules`. opensource.guide's `vendor/gems` was built as pages.
 */
function isBundlerInstall(dir: string): boolean {
	const ruby = path.join(dir, "ruby");
	if (!fs.existsSync(ruby)) return false;
	try {
		return fs.readdirSync(ruby).some((version) => fs.existsSync(path.join(ruby, version, "gems")));
	} catch {
		return false;
	}
}

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

/** Whether a computed value is worked out from the page's data: a string with template tags. */
const dependsOnPage = (value: string) => value.includes("{{") || value.includes("{%") || value.includes("<%");

/**
 * Whether a page's `computed` reads `collections`: a string that mentions it, or a function whose
 * source does (`(data) => data.collections.articles`), at any depth.
 */
export function readsCollections(computed: unknown): boolean {
	if (typeof computed === "string") return computed.includes("collections");
	if (typeof computed === "function") return Function.prototype.toString.call(computed).includes("collections");
	if (Array.isArray(computed)) return computed.some(readsCollections);
	if (isPlainObject(computed)) return Object.values(computed).some(readsCollections);
	return false;
}

/** The template language a page's data strings (`permalink`, `computed`) are written in: the first engine in its chain that isn't Markdown or plain text, or Edge for those. */
// A site's own engine (`engines: { mdit }`) isn't one either: it's usually a Markdown renderer, and
// a permalink through markdown-it came out as `<p>/blog/tags/{{ tag | slug }}/</p>` (found in a
// migration). So it's the first of ssqch's template languages in the chain, then the
// `markdownEngine` (what the site's Markdown pages read their tags with), then Edge.
const TEMPLATE_LANGUAGES = new Set(["edge", "njk", "jinja", "j2", "liquid", "hbs", "handlebars", "mustache", "ejs"]);
function dataStringEngine(tpl: Tpl, config: Config): string {
	const own = (e: string) => TEMPLATE_LANGUAGES.has(e) && !config.engines.has(e);
	const markdown = config.markdownEngine;
	return tpl.engines.find(own) ?? (markdown !== null && own(markdown) ? markdown : "edge");
}

/** Whether a data string has tags in that language, so it needs rendering. */
function hasTags(tpl: Tpl, config: Config, s: string): boolean {
	return dataStringEngine(tpl, config) === "ejs" ? s.includes("<%") : s.includes("{{") || s.includes("{%");
}

/**
 * While serving: each template's bytes as the last build read them, with the size and time the
 * file had just before, so a rebuild reads again only what changed. Reading 10,000 pages took 175
 * ms of a rebuild's 321 ms "read" (stat-ing them, 23). The builder's process keeps it until the
 * configuration is read again, which starts a new one.
 */
const keptSources = new Map<string, { size: number; mtimeMs: number; bytes: Buffer }>();

/**
 * While serving (`incremental`; the dev server's design, stage 1): each template as the last build made it, reused
 * when its bytes are the very ones `keptSources` kept (unchanged), the shared inputs are the same
 * (`Site.sharedInputs`), its layouts' files are as they were, and its commit date (git dates) too.
 * Making them was 200 to 290 ms of a 10,000-page rebuild.
 */
/**
 * Whether rebuilds while serving keep templates and render only the pages an edit can reach (the
 * dev server's design, stage 3). On while serving; `SSQCH_INCREMENTAL=0` turns it off, for a page
 * that looks out of date: if it's right with it off, that's a bug in ssqch.
 */
export function incremental(config: Config): boolean {
	return config.serving && process.env.SSQCH_INCREMENTAL !== "0";
}

/** While serving: each template that can't be kept as it was last made, its bytes, a hash of its data, and what else it came from (`loadTemplate`). */
const remadeTemplates = new Map<string, { bytes: Buffer; data: string; mark: string }>();

/** While serving with templates kept: the last build's template files and the shared inputs they were made from, for `Site.added` and `Site.gone`. */
let lastPages: { shared: string; files: Set<string> } | undefined;

const keptTemplates = new Map<string, { bytes: Buffer; shared: string; commit: number | undefined; time: number | undefined; layouts: Array<[string, string]>; front: string; tpl: Tpl }>();

/**
 * Data as bytes to hash (`sharedInputs`), as `v8.serialize` writes it, with each function as a
 * number of its own: the same function object is the same number from one build to the next.
 * A function comes from a module the builder loaded (a JavaScript data file's `computed`), and a
 * change to one starts a new builder, so the same object means the same code. Without functions,
 * serializing is all it does.
 */
function serializedData(value: unknown): Buffer {
	try { return v8.serialize(value); } catch { /* a function, most likely: numbered below */ }
	const copies = new Map<object, unknown>();
	const copy = (item: unknown): unknown => {
		if (typeof item === "function") {
			let id = functionIds.get(item);
			if (id === undefined) functionIds.set(item, id = ++functionsSeen);
			return `\0function ${id}`;
		}
		if (item === null || typeof item !== "object" || item instanceof Date || item instanceof RegExp || ArrayBuffer.isView(item)) return item;
		const done = copies.get(item);
		if (done !== undefined) return done;
		if (Array.isArray(item)) {
			const out: unknown[] = [];
			copies.set(item, out);
			for (const entry of item) out.push(copy(entry));
			return out;
		}
		if (item instanceof Map) {
			const out = new Map();
			copies.set(item, out);
			for (const [key, entry] of item) out.set(copy(key), copy(entry));
			return out;
		}
		if (item instanceof Set) {
			const out = new Set();
			copies.set(item, out);
			for (const entry of item) out.add(copy(entry));
			return out;
		}
		const out: Record<string, unknown> = {};
		copies.set(item, out);
		for (const key of Object.keys(item)) out[key] = copy((item as Record<string, unknown>)[key]);
		return out;
	};
	return v8.serialize(copy(value));
}
/** Weakly, so a data function that makes new functions each build doesn't keep the old ones for the server's life. */
const functionIds = new WeakMap<Function, number>();
let functionsSeen = 0;

/** A file's size and time, as one string: what tells it's as it was. */
function fileMark(file: string): string {
	const stat = fs.statSync(file, { throwIfNoEntry: false });
	return stat ? `${stat.size}:${stat.mtimeMs}` : "gone";
}

/**
 * Reads files through Node's thread pool, 64 at a time. A file's bytes are decoded when its
 * template is read, where an error can name it. With `changed` (serving), a file whose size and
 * time are what they were when it was last read is taken as it was, unless it's one of the files
 * (or in a folder: Windows names the folder) whose change started this build. A file is stat-ed
 * before it's read, so one written in between is read again next time, never kept stale.
 */
async function readAll(files: string[], changed?: ReadonlySet<string>): Promise<Buffer[]> {
	const out = new Array<Buffer>(files.length);
	let next = 0;
	const named = (file: string) => changed!.has(file) || changed!.has(path.dirname(file));
	await Promise.all(Array.from({ length: Math.min(64, files.length) }, async () => {
		while (next < files.length) {
			const i = next++;
			const file = files[i];
			if (!changed) {
				out[i] = await fs.promises.readFile(file);
				continue;
			}
			const stat = fs.statSync(file, { throwIfNoEntry: false });
			const was = keptSources.get(file);
			if (stat && was && was.size === stat.size && was.mtimeMs === stat.mtimeMs && !named(file)) {
				out[i] = was.bytes;
				continue;
			}
			const bytes = await fs.promises.readFile(file);
			if (stat) keptSources.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, bytes });
			out[i] = bytes;
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
	const listed = sameErrorsTogether(messages);
	return new Diagnostics(`${failed.length} error(s):\n  - ${listed.slice(0, 10).join("\n  - ")}${listed.length > 10 ? "\n  ..." : ""}`, items);
}

/**
 * One line for the same error on several pages: a layout's mistake fails every page that uses it
 * (vuejs.org's move: one unknown Jinja test, 86 times). The first page's line, and how many more.
 */
export function sameErrorsTogether(messages: string[]): string[] {
	// Where a message names its page: `in <page>: `, `rendering layout <layout> for <page>: `,
	// `rendering <page> with `. The rest, with the page left out, is the error.
	const PAGE = /^(?:in |rendering layout [^\s]+ for |rendering )([^\s:]+?\.[A-Za-z0-9]+)(?:: | with )/;
	// A paginated page's item (` (item 2 of snacks, "Moss Mix")`) is where, not what: the same
	// error on two items is one line, and the "more" names each item.
	const ITEM = / \((?:item|page) \d+ of [^)]*\)(?=: )/;
	const keyOf = (m: string): [string, string] | undefined => {
		const found = PAGE.exec(m);
		if (!found) return undefined;
		const at = found[0].indexOf(found[1]);
		const rest = m.slice(at + found[1].length);
		const item = ITEM.exec(rest);
		const key = m.slice(0, at) + "\0" + (item ? rest.slice(0, item.index) + rest.slice(item.index + item[0].length) : rest);
		return [key, item ? `${found[1]}${item[0]}` : found[1]];
	};
	const pages = new Map<string, string[]>();
	for (const m of messages) {
		const key = keyOf(m);
		if (key) pages.set(key[0], [...(pages.get(key[0]) ?? []), key[1]]);
	}
	const out: string[] = [];
	const said = new Set<string>();
	for (const m of messages) {
		const key = keyOf(m);
		const all = key ? pages.get(key[0])! : [];
		if (!key || all.length === 1) { out.push(m); continue; }
		if (said.has(key[0])) continue;
		said.add(key[0]);
		const more = all.slice(1);
		out.push(`${m} (and ${more.length} more ${more.length === 1 ? "page" : "pages"} with the same error: ${more.slice(0, 3).join(", ")}${more.length > 3 ? ", ..." : ""})`);
	}
	return out;
}
