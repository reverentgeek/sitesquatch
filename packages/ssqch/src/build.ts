// The build pipeline.
//
// 1. Run file builders and `beforeBuild` hooks, set up engines, load global data.
// 2. Discover templates and resolve each one's data cascade, expand pagination, render
//    permalinks, check for output conflicts (all in site.ts).
// 3. Render each page: its body through its engines, then its layouts, then the transforms,
//    then the file. Pages are written as they render, so nothing waits in memory for a write
//    phase. Pages that read `collections` go last, so the bodies they show (a feed's posts) are
//    already rendered; a body that isn't is rendered when it's first read.
// 4. Run generators, copy bundles and passthrough files, record what was written, run
//    `afterBuild` hooks.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { aboutToBlock, progressed } from "./activity.ts";
import { rewriteBase } from "./base.ts";
import type { Config, Dirs, GeneratedFile, GeneratorSite, Hook, PageSummary } from "./config.ts";
import { shownDir, shownOutput } from "./config.ts";
import type { Data } from "./data.ts";
import { sourceDateEpoch, STATIC_DATA_EXTENSIONS } from "./data.ts";
import { renderComponents } from "./components.ts";
import { BuildError, Diagnostics, bail, context, isCapturing, messageOf, progress, warn, warning } from "./diagnostics.ts";
import type { RenderContext } from "./engines/engine.ts";
import { beginFenceCache, rendering as markdownRendering, saveFenceCache, writeHighlightCss } from "./engines/markdown.ts";
import * as equivalents from "./equivalents.ts";
import { measure, overBudget } from "./footprint.ts";
import { globBase, globSet, isGlob } from "./glob.ts";
import { describeThrown, settle } from "./modules.ts";
import { compareText, isDir, isFile, isInside, readFollowing, realPath, relative, shown, slashes, walkFiles } from "./paths.ts";
import { commandLine } from "./command-line.ts";
export { commandLine, toolPath } from "./command-line.ts";
import { mkdocsGlobals, tocOf } from "./mkdocs.ts";
import { currentRendering, renderingAs, safe } from "./rendering.ts";
import { checkPages, paginated } from "./schema.ts";
import type { CopyJob, Page, Tpl } from "./site.ts";
import { Site, Timer, errorsTogether, readsCollections } from "./site.ts";
import type { Profile, ProfileReport } from "./profile.ts";
import * as voice from "./voice.ts";
import { jekyllPage, jekyllSite } from "./jekyll.ts";

/** What a build did, handed to `afterBuild` hooks and printed as the summary. */
export interface BuildReport {
	/** Template files read (a paginated template counts once). */
	templates: number;
	pagesWritten: number;
	/** Total size of the pages written. */
	pageBytes: number;
	/** While serving: the pages whose contents changed (the others were left as they were). Left out for a build that writes every page. */
	pagesChanged?: number;
	/** Pages the last build to this folder didn't have, and pages it had that this one doesn't. Left out when there's no earlier build to compare with. */
	pagesNew?: number;
	pagesGone?: number;
	/** Files an earlier build wrote that this one didn't, left in the output because `leaveNoTrace` is off (from the output folder, with `/`): `ssqch serve` doesn't serve them. */
	stale: string[];
	/** Passthrough files copied because they were new or changed. */
	filesCopied: number;
	/** Passthrough files already up to date in the output. */
	filesUnchanged: number;
	/** Total size of every passthrough file, copied or not. */
	passthroughBytes: number;
	/** Stale files deleted from the output (with `leaveNoTrace`). */
	filesRemoved: number;
	/** Drafts (`draft: true`) a production build left out. */
	drafts: number;
	/** With `--verbose`: the templates in the includes folder that nothing used in this build, from the project root. */
	unused: string[];
	/** Whether this is the site's first build: there was no list of an earlier build's files. */
	firstBuild: boolean;
	/** The pages and generated files written, absolute. */
	written: string[];
	/** Every file this build put in the output: pages, generated files, bundles and passthrough copies (written or already up to date). */
	outputs: string[];
	durationMs: number;
	timings: Array<[string, number]>;
	/** Lines plugins add to the build summary, such as `["Images", "4,689 files ..."]`. */
	summary: Array<[string, string]>;
	/** With `--profile`: where the time went, by kind, slowest first (src/profile.ts). */
	profile?: ProfileReport;
}

/** How many page writes wait at once: each holds its page in memory, so the queue has a limit. */
const MAX_WRITES = 64;

export async function build(config: Config): Promise<BuildReport> {
	// A SOURCE_DATE_EPOCH that isn't a number is one error now, not one for every page.
	sourceDateEpoch();
	// Until this build finishes, the next one can't take a page as this one wrote it.
	const afterAWorkingBuild = lastBuildWorked;
	lastBuildWorked = false;
	const started = performance.now();
	const timer = new Timer();
	const site = new Site(config);
	const { dirs } = site;
	// Fences this build highlights are its own from here; the file gets them when it finishes.
	beginFenceCache(dirs.root);
	if (!isDir(dirs.input)) bail(`input directory ${shownDir(config, config.input)} does not exist`);

	const built = await runFileBuilders(config, dirs);
	await runHooks(config, dirs, "beforeBuild", config.beforeBuild, undefined, site.profile);
	await site.prepare(timer);
	await checkPages(site);
	checkForeignKeys(site);
	checkForeignGlobals(site);
	timer.lap("paginate");

	const { pages } = site;
	const renderer = new Renderer(site);
	// Pages paginated over a collection render last too: their items come from the finished collections.
	const collectionIncludes = includesUsingCollections(site);
	const overCollections = (p: Page) => typeof p.data.pagination?.data === "string" && p.data.pagination.data.startsWith("collections.");
	const wanted = pages.filter((p) => p.output !== null || p.inCollections);
	const late = new Set(wanted.filter((p) => usesCollections(p.tpl, collectionIncludes) || overCollections(p)));
	await site.buildCollections();
	for (const page of late) {
		if (overCollections(page)) {
			try { site.refreshPagination(page); } catch (e) { throw context(e, `in ${page.tpl.rel}`); }
		}
	}
	// `SSQCH_INCREMENTAL=1`: only the pages whose bodies changed, and those that read collections
	// (a feed shows the bodies); the rest are as the last build wrote them.
	const only = afterAWorkingBuild ? incrementalPages(site, wanted, late) : undefined;
	if (only) for (const page of wanted) if (!only.has(page) && page.output !== null) renderer.written.set(page.index, { file: page.output, bytes: keptWritten.get(page.output)!, changed: false });
	const rendering = only ? wanted.filter((p) => only.has(p)) : wanted;
	renderedCount = [rendering.filter((p) => p.output !== null).length, wanted.filter((p) => p.output !== null).length];
	await renderer.renderAll([...rendering.filter((p) => !late.has(p)), ...rendering.filter((p) => late.has(p))], late);
	// Whose content each page read, and whether it read collections, for the next rebuild's choice.
	if (config.serving) {
		for (const page of rendering) {
			if (page.output === null) continue;
			const read = renderer.reads.get(page.index);
			if (read || late.has(page)) keptReads.set(page.output, read ?? new Set());
			else keptReads.delete(page.output);
			if (renderer.collectionReaders.has(page.index)) keptCollectionReaders.add(page.output);
			else keptCollectionReaders.delete(page.output);
		}
	}
	// What the built-in plugins learned from each page, said again for the pages taken as they
	// were (the image plugin's pictures in use), with the rendered pages' new records.
	if (config.serving) {
		const urls = (list: Page[]) => list.flatMap((p) => (typeof p.url === "string" ? [p.url] : []));
		const skipped = only ? urls(wanted.filter((p) => !only.has(p))) : [];
		for (const replay of config.replays) replay(skipped, urls(rendering));
	}
	warnUnknownComponents(site);
	for (const wait of config.settle) await wait();
	timer.timings.push(["render", renderer.renderMs], ["write", performance.now() - timer.last - renderer.renderMs]);
	timer.last = performance.now();

	// In the order of the pages, whatever order they were rendered in.
	const written = pages.flatMap((p) => (renderer.written.has(p.index) ? [renderer.written.get(p.index)!] : []));
	const { files: generated, owners: generatedBy } = await runGenerators(config, dirs, pages, new Set(written.map((w) => w.file)), site);
	const bundles = config.bundles ? bundleFiles(site) : [];
	bundles.push(...site.themeCopies);
	const copy = await passthroughCopy(config, dirs, bundles, generatedBy);
	const stylesheet = writeHighlightCss(config.markdown, dirs.output, site.markdown);
	timer.lap("copy");

	const pagePaths = written.map((w) => w.file);
	const outputs = [...pagePaths, ...generated, ...built, ...copy.paths, ...stylesheet, ...config.written.flatMap((files) => [...files()])];
	const recorded = recordOutputs(config, dirs, outputs, pagePaths);

	const report: BuildReport = {
		templates: site.tpls.length,
		pagesWritten: written.length,
		pageBytes: written.reduce((sum, w) => sum + w.bytes, 0),
		pagesChanged: config.serving ? written.filter((w) => w.changed).length : undefined,
		pagesNew: recorded.pagesNew,
		pagesGone: recorded.pagesGone,
		stale: recorded.stale,
		filesCopied: copy.copied,
		filesUnchanged: copy.unchanged,
		passthroughBytes: copy.bytes,
		filesRemoved: recorded.removed,
		unused: config.verbose ? unusedTemplates(site) : [],
		drafts: site.drafts,
		firstBuild: recorded.firstBuild,
		outputs,
		written: [...pagePaths, ...generated],
		durationMs: performance.now() - started,
		timings: [],
		summary: [],
	};
	// The plugins' hooks, the config's own (after them: it sees the output as they left it), then
	// the checks of the finished output (the link checker).
	const isCheck = (hook: Hook) => "check" in hook && hook.check === true;
	await runHooks(config, dirs, "afterBuild", [...config.afterBuild.filter((h) => !isCheck(h)), ...config.afterBuild.filter(isCheck)], report, site.profile);
	// The summary's size is what's on disk: a hook can minify the pages (4.43 MB said, 4.07 MB
	// written, a11y #20), or remove one.
	if (config.afterBuild.length) report.pageBytes = written.reduce((sum, w) => sum + (fs.statSync(w.file, { throwIfNoEntry: false })?.size ?? 0), 0);
	// After the hooks, which can fingerprint or minify what's measured.
	if (config.budgets.length) {
		const over = overBudget(await measure(dirs.output, config.root), config.budgets);
		// `budgets.fail` makes them errors where a broken link is one: a production build, not
		// `ssqch serve`, which keeps going so the page can be fixed.
		if (over.length && config.budgetsFail && config.env === "production" && !config.serving) {
			throw new Diagnostics(over.map((d) => d.message).join("\n"), over.map((d) => ({ ...d, severity: "error" })));
		}
		for (const found of over) warn(found);
	}
	for (const [label, line] of config.summaries) {
		const value = line(config);
		if (value !== undefined) report.summary.push([label, value]);
	}
	saveFenceCache();
	timer.lap("after");
	report.durationMs = performance.now() - started;
	report.timings = timer.timings;
	for (const slow of site.profile.slowCalls()) warn(slow);
	if (config.profile) report.profile = site.profile.report();
	lastBuildWorked = true;
	return report;
}

/** A page as `ssqch trace` sees it. */
export interface TracedPage {
	url: string | null;
	input: string;
	output: string | null;
	engines: string[];
	layouts: string[];
	date: Date;
	/** Whether the date is the one at the start of the file's name. */
	dateFromName: boolean;
	/** Where an undated page's date came from with `dateFallback: "git"`, and `page.lastModified`'s, in words; `undefined` when there's nothing to say. */
	commitFrom: string | undefined;
	lastModifiedFrom: string | undefined;
	inCollections: boolean;
	data: Data;
	layers: Array<[string, Data]>;
}

/**
 * Every page the site would build, with where its data came from. This is a build up to the
 * point of rendering: file builders and `beforeBuild` hooks run, because data can depend on
 * them (a plugin that learns the build's context there, a command that writes a data file). No
 * page is rendered or written, and `afterBuild` hooks don't run.
 */
export async function tracePages(config: Config): Promise<{ dirs: Dirs; global: Data; pages: TracedPage[] }> {
	const site = new Site(config, true);
	const { dirs } = site;
	if (!isDir(dirs.input)) bail(`input directory ${shownDir(config, config.input)} does not exist`);
	await runFileBuilders(config, dirs);
	await runHooks(config, dirs, "beforeBuild", config.beforeBuild, undefined);
	await site.prepare(new Timer());
	const pages = site.pages.map((p): TracedPage => ({
		url: p.url,
		input: p.tpl.input,
		output: p.output,
		engines: p.tpl.engines,
		layouts: (p.layouts ?? p.tpl.layouts).map((l) => l.name),
		date: p.date,
		dateFromName: p.tpl.fileDate !== undefined,
		commitFrom: config.dateFallback === "git" ? gitFrom(p.tpl.commitDate !== undefined, "dateFallback", p.tpl.input) : undefined,
		lastModifiedFrom: config.lastModified === "git" ? gitFrom(p.tpl.committed, "lastModified", p.tpl.input) : config.lastModified === "file" ? "the file's modification time: `lastModified: \"file\"`" : undefined,
		inCollections: p.inCollections,
		data: p.data,
		layers: p.tpl.layers,
	}));
	return { dirs, global: site.global, pages };

	/** "git: the last commit to src/privacy.md", or why it's the file's time: git's answer fell back quietly in a build (Squatch Snacks, E8). */
	function gitFrom(fromGit: boolean, setting: string, file: string): string {
		const rel = path.relative(dirs.root, file).split(path.sep).join("/");
		return fromGit ? `git: the last commit to ${rel}` : `the file's modification time: \`${setting}: "git"\`, but ${site.gitWhy(file)}`;
	}
}

// ---- render ----------------------------------------------------------------------------------

interface Written {
	file: string;
	bytes: number;
	/** Whether its contents changed (while serving, a page that comes out the same is left alone). */
	changed: boolean;
}

/**
 * Whether the last build in this process finished. One that failed rendered some of the pages it
 * was given and not others (a page whose filter threw, and what came after it), so the next
 * renders every page: taken as the last build wrote it, a broken page would look fixed.
 */
let lastBuildWorked = false;

/** The last build's pages rendered, of the pages it wrote, for the serve timeline. */
let renderedCount: [number, number] = [0, 0];
export const lastRendered = (): [number, number] => renderedCount;

/** While serving: each page's size as the last build wrote it, by its output file, for a page `SSQCH_INCREMENTAL=1` doesn't render. */
const keptWritten = new Map<string, number>();

/**
 * While serving: whose content (templateContent, content, an excerpt, headings: all through
 * `contentOf`) each page that reads collections read when it last rendered, by its output file. A
 * page that read none of the changed pages' content (a tag page that lists titles) is taken as it
 * was: its data, and every page's data, is what it was.
 */
const keptReads = new Map<string, Set<string>>();

/**
 * While serving with `SSQCH_INCREMENTAL=1`: the pages (by output file) whose last render read
 * `collections`, by anything: the template, a layout, an include, or a site's filter through
 * `this.data.collections`. A change to another page's front matter can change what they show.
 */
const keptCollectionReaders = new Set<string>();

/** While serving: what a generator last wrote to each file, with the size and time the file had then. */
const keptGenerated = new Map<string, { text: string; mark: string }>();

/** A page, as `keptReads` names it: its file and its URL (a paginated template has several). */
const pageKey = (page: Page) => `${page.tpl.input}\0${page.url}`;

/**
 * Built-in plugins a rebuild that renders only some pages can't get wrong: what they do comes from
 * the pages' data (the sitemap, redirects, robots), from every page's file on disk (the link
 * checker), from a page that reads collections, which always renders (a feed), or from the one
 * page they're given (minify), or a replay of what each page told them (`config.replays`: the
 * image plugin, whose pictures a page not rendered asks for again, so `prune` and `leaveNoTrace`
 * keep them; llms, whose copies and llms-full.txt read each page's text; elements' summary). The
 * assets plugin fingerprints the files it's given before the build, whatever renders.
 */
const REPLAYABLE = new Set(["ssqch/links", "ssqch/sitemap", "ssqch/rss", "ssqch/redirects", "ssqch/robots", "ssqch/minify", "ssqch/image", "ssqch/assets", "ssqch/elements", "ssqch/llms"]);

/**
 * `SSQCH_INCREMENTAL=1` while serving (the dev server's design, stage 3, its first slice): the
 * pages to render when every changed file is a template whose body alone changed
 * (`Site.bodyOnly`) or whose own data did (`Site.ownData`: its front matter), the site's plugins are all `REPLAYABLE`, and the config has no transforms or
 * after-build hooks of its own (code that sees rendered pages; a `beforeBuild` hook runs before any
 * page, every build). `undefined` means render everything.
 */
function incrementalPages(site: Site, wanted: Page[], late: Set<Page>): Set<Page> | undefined {
	const { config } = site;
	if (process.env.SSQCH_INCREMENTAL !== "1" || !config.serving || !(site.bodyOnly.size || site.ownData.size) || !config.changed?.length) return undefined;
	// By real paths on both sides: the server names files by theirs, and the site may not (a
	// temporary folder's `/var` is `/private/var` on macOS).
	const bodyOnly = new Set([...site.bodyOnly].map(realPath));
	const ownData = new Set([...site.ownData].map(realPath));
	if (!config.changed.every((file) => bodyOnly.has(realPath(file)) || ownData.has(realPath(file)))) return undefined;
	// A page's own data changed (its front matter, a date that's its file's time): what other
	// pages show of it comes through collections, which every page's data is made from again.
	const dataChanged = config.changed.some((file) => ownData.has(realPath(file)));
	if (!config.plugins.every((name) => REPLAYABLE.has(name))) return undefined;
	if (config.afterBuild.some((hook) => !("label" in hook) || hook.label !== "")) return undefined;
	if (config.transforms.some(([name]) => name !== "minify-html")) return undefined;
	// MkDocs' and Jekyll's templates read more of other pages than that, past `collections`.
	const everyLate = config.mkdocsTemplates !== null || config.jekyllTemplates;
	if (dataChanged && everyLate) return undefined;
	const only = new Set(wanted.filter((page) => site.bodyOnly.has(page.tpl.input) || site.ownData.has(page.tpl.input)));
	const changedKeys = new Set([...only].map(pageKey));
	for (const page of wanted) {
		if (only.has(page) || page.output === null) continue;
		const read = keptReads.get(page.output);
		// A page that read a changed page's content last time (a feed), or reads collections in its
		// own templates and has no record of what it read.
		if (read && [...read].some((key) => changedKeys.has(key))) only.add(page);
		else if (late.has(page) && (everyLate || !read)) only.add(page);
		// After a change to a page's own data, every page that read collections (its title in a
		// list, its place in prev and next), is paginated over one, or has computed data from them.
		else if (dataChanged && (late.has(page) || keptCollectionReaders.has(page.output) || readsCollections(page.tpl.data.computed))) only.add(page);
	}
	// A page the last build didn't write (new to the output) is rendered.
	for (const page of wanted) if (!only.has(page) && page.output !== null && !keptWritten.has(page.output)) only.add(page);
	return only;
}

/** Marks a body that's being rendered, so a page that reads its own content (through a collection it's in) gets nothing rather than a loop. */
const RENDERING = Symbol("rendering");

class Renderer {
	site: Site;
	/** Rendered bodies that something may read again, by page. */
	private bodies = new Map<number, string | typeof RENDERING>();
	/**
	 * Whether to keep every body after its page is written. On when a template reads
	 * `templateContent` or `.content`, and from the moment anything reads one: a body that's kept
	 * is rendered once however many pages show it.
	 */
	private keep: boolean;
	written = new Map<number, Written>();
	/** The page rendering now (pages render one at a time), and whose content each page read, by page index. */
	private rendering: Page | undefined;
	reads = new Map<number, Set<string>>();
	/** The page whose body is rendering now: `rendering`, or another page's body that it asked for. */
	private reader: Page | undefined;
	/** The pages, by index, whose render read `collections` (`keptCollectionReaders`). */
	collectionReaders = new Set<number>();
	/** `collections` as pages see them, which notes who reads it, with `SSQCH_INCREMENTAL=1` while serving. */
	private collectionsView: Data | undefined;
	/** Time spent rendering bodies, as the summary's `render`. */
	renderMs = 0;
	/**
	 * What failed, with the phase it failed in, as 0.7 ran them one after another: 0 the bodies of
	 * the pages that don't read `collections`, 1 those that do, 2 layouts, transforms and writes.
	 * Only the first phase that failed is reported, as 0.7 stopped there: a broken filter in a
	 * page's body is one error, not one more for each layout that would have shown it.
	 */
	private errors: Array<{ error: unknown; phase: number }> = [];
	/** Errors that came from rendering a page's own body (not its layouts or what follows). */
	private bodyErrors = new WeakSet<object>();
	/** Set when a body that another page asked for failed to render: the page that asked fails too, and only for that. */
	private borrowedFailure = false;
	private pending = new Set<Promise<void>>();
	private waiters: Array<() => void> = [];
	private folders = new Map<string, Promise<unknown>>();
	private writeError: unknown;

	constructor(site: Site) {
		this.site = site;
		this.keep = mentionsContent(site) || site.config.readsContent;
		site.contentOf = (page) => this.contentNow(page);
	}

	/** The data a page's templates get: its own, and the collections. */
	private data(page: Page): Data {
		const data: Data = { ...page.data, collections: this.collections() };
		if (this.site.config.jekyllTemplates) {
			data.site = this.jekyllSite();
			data.page = jekyllPage(page.data, page.data.page, this.globalKeys());
		}
		// `mkdocsTemplates`: MkDocs' context. A page's own body keeps ssqch's `page`; its layouts get
		// MkDocs' (see render), and MkDocs' 404 page (`mkdocsPage: false`) has none.
		const mk = this.site.mkdocs;
		if (mk) {
			const error = page.data.mkdocsPage === false;
			const context = this.site.mkdocsContext(error ? null : page);
			Object.assign(data, mkdocsGlobals(mk), { nav: context.nav, base_url: context.base_url });
			if (error) data.page = null;
			else if (context.page) this.mkdocsPageOf.set(data, context.page);
		}
		return data;
	}
	/**
	 * The collections for a page's templates. With `SSQCH_INCREMENTAL=1` while serving, a view that
	 * notes the page reading it, whatever reads it (a template, a layout, a site's filter): a
	 * rebuild after a change to one page's front matter renders those pages again. Anything an
	 * engine does to look at it counts, so at worst a page renders when it needn't have.
	 */
	private collections(): Data {
		const { collections, config } = this.site;
		if (process.env.SSQCH_INCREMENTAL !== "1" || !config.serving) return collections;
		if (this.collectionsView) return this.collectionsView;
		const note = () => {
			const who = this.reader ?? this.rendering;
			if (who) this.collectionReaders.add(who.index);
		};
		return (this.collectionsView = new Proxy(collections, {
			get: (target, key, receiver) => { note(); return Reflect.get(target, key, receiver); },
			has: (target, key) => { note(); return Reflect.has(target, key); },
			ownKeys: (target) => { note(); return Reflect.ownKeys(target); },
			getOwnPropertyDescriptor: (target, key) => { note(); return Reflect.getOwnPropertyDescriptor(target, key); },
		}));
	}

	/** Each page's MkDocs page, by the data its layouts render with. */
	private mkdocsPageOf = new WeakMap<Data, Data>();

	/** `jekyllTemplates`: Jekyll's `site`, made once a build, after the collections. */
	private jekyllSiteData: Data | undefined;
	private jekyllSite(): Data {
		return (this.jekyllSiteData ??= jekyllSite(this.site.global.site, this.site.collections, this.site.global));
	}
	private globalKeySet: Set<string> | undefined;
	private globalKeys(): Set<string> {
		return (this.globalKeySet ??= new Set(Object.keys(this.site.global)));
	}

	/** A page's body through its engines: at once when they all answer at once, otherwise later. */
	private body(page: Page): string | Promise<string> {
		const { tpl } = page;
		const data = this.data(page);
		// The config's functions see this page as `this.page` (src/rendering.ts): one store for the
		// page's render, whose data is the body's, then its layouts'.
		const now = currentRendering();
		if (now) now.data = data;
		const ctx: RenderContext = { name: tpl.rel, inputPath: tpl.input, cacheKey: tpl.rel };
		const run = (from: number, content: string): string | Promise<string> => {
			for (let i = from; i < tpl.engines.length; i++) {
				const name = tpl.engines[i];
				const engine = this.site.engines.get(name);
				// The page's Markdown as its template engine left it, for llmsPlugin()'s copy.
				if (name === "md" && page.url !== null) this.site.config.markdownSources?.set(page.url, content);
				let out: string | Promise<string>;
				try {
					out = engine.render(content, data, ctx);
					if (typeof out !== "string") out = asText(out, name, tpl.rel);
				} catch (e) { throw rendering(e, tpl, name, data); }
				if (typeof out !== "string") return out.then((text) => run(i + 1, text), (e) => { throw rendering(e, tpl, name, data); });
				content = out;
			}
			return content;
		};
		const out = run(0, tpl.body);
		// Components in the page (`<Badge type="tip">`, its Markdown's raw HTML included), once
		// its engines have run: what reads its body (`templateContent`, its layouts) gets them rendered.
		if (!this.componentsIn(page)) return out;
		return typeof out === "string" ? this.components(out, data, page) : out.then((text) => this.components(text, data, page));
	}

	/** Whether a page's HTML can have components: an HTML page, or one that's only read by others. */
	private componentsIn(page: Page): boolean {
		return page.output === null || page.output.endsWith(".html");
	}

	/** `html` with its component tags rendered through `_includes/components/<Name>.*`. */
	private components(html: string, data: Data, page: Page): string {
		const md = this.site.markdown;
		const unknown = this.site.unknownComponents;
		try {
			const others = this.site.config.componentRenderers;
			const input = page.tpl.input;
			const render = (name: string, value: Parameters<typeof others[number]>[1]) => {
				const own = md.component(name, value, data);
				if (own !== undefined) return own;
				for (const other of others) {
					const html = other(name, value, input, data);
					if (html !== undefined) return html;
				}
				return undefined;
			};
			return renderComponents(html, render, data, (name) => {
				const files = unknown.get(name) ?? new Set<string>();
				files.add(this.site.display(page.tpl.input));
				unknown.set(name, files);
			});
		} catch (e) { throw context(e, `in ${page.tpl.rel}`); }
	}

	/**
	 * A page's body for another page that reads it (`templateContent`), rendered now if it isn't
	 * yet. Nothing for a page that's reading its own.
	 */
	private contentNow(page: Page): string | undefined {
		this.keep = true;
		// Which pages' content each page read, for a rebuild that renders only some (`keptReads`).
		if (this.rendering && this.rendering !== page) {
			let read = this.reads.get(this.rendering.index);
			if (!read) this.reads.set(this.rendering.index, read = new Set());
			read.add(pageKey(page));
		}
		const kept = this.bodies.get(page.index);
		if (kept === RENDERING) return undefined;
		if (kept !== undefined) return kept;
		this.bodies.set(page.index, RENDERING);
		let out: string | Promise<string>;
		const before = markdownRendering(this.site.display(page.tpl.input));
		try {
			// Another page's body, read now: its functions see that page, then this one's again.
			const now = currentRendering();
			const was = now?.data;
			const reader = this.reader;
			this.reader = page;
			try { out = this.body(page); } finally { if (now && was) now.data = was; this.reader = reader; }
		} catch (e) {
			this.bodies.delete(page.index);
			// That page's own turn reports this; the page that asked isn't a second error.
			this.borrowedFailure = true;
			throw e;
		} finally {
			markdownRendering(before);
		}
		if (typeof out !== "string") {
			this.bodies.delete(page.index);
			// It will render in its own turn; what it would have been can't be waited for here.
			out.catch(() => {});
			throw new BuildError(`${page.tpl.rel}: another page read this page's templateContent before it was rendered, and it can't be rendered on demand because something in it is async (an async filter or engine). Pages that read \`collections\` in their own templates render last, so their content isn't ready for each other`);
		}
		this.bodies.set(page.index, out);
		return out;
	}

	async renderAll(pages: Page[], late: Set<Page> = new Set()): Promise<void> {
		for (const page of pages) {
			this.borrowedFailure = false;
			// Markdown's warnings (a site's highlighter that failed) name the page.
			markdownRendering(this.site.display(page.tpl.input));
			// What a slow call was working on (src/profile.ts): pages render one at a time.
			this.site.profile.at = shown(this.site.dirs.root, page.tpl.input);
			this.rendering = page;
			try {
				await renderingAs({ data: page.data }, () => this.render(page));
			} catch (e) {
				// A page that failed because a body it shows failed isn't reported: that body's page is.
				if (this.borrowedFailure) continue;
				const error = e instanceof BuildError || e instanceof Diagnostics ? e : internal(e, page.tpl.rel);
				const inBody = typeof e === "object" && e !== null && this.bodyErrors.has(e);
				this.errors.push({ error, phase: inBody ? (late.has(page) ? 1 : 0) : 2 });
			} finally {
				this.rendering = undefined;
			}
		}
		markdownRendering(undefined);
		this.site.profile.at = undefined;
		await Promise.all(this.pending);
		if (this.writeError !== undefined) this.errors.push({ error: this.writeError, phase: 2 });
		if (this.errors.length) {
			const first = Math.min(...this.errors.map((f) => f.phase));
			throw errorsTogether(this.errors.filter((f) => f.phase === first).map((f) => f.error));
		}
	}

	private async render(page: Page): Promise<void> {
		const { site } = this;
		const { tpl } = page;
		const { config, dirs } = site;
		const start = performance.now();
		let content: string;
		const kept = this.bodies.get(page.index);
		if (typeof kept === "string") content = kept;
		else {
			this.bodies.set(page.index, RENDERING);
			try {
				const out = this.body(page);
				content = typeof out === "string" ? out : await out;
			} catch (e) {
				if (typeof e === "object" && e !== null) this.bodyErrors.add(e);
				throw e;
			} finally {
				this.bodies.delete(page.index);
			}
			if (this.keep) this.bodies.set(page.index, content);
		}
		this.renderMs += performance.now() - start;
		if (page.output === null) return;

		const layouts = page.layouts ?? tpl.layouts;
		if (layouts.length) {
			const data = this.data(page);
			// While its layouts render, the page's own body is there for `page.headings` and `page.excerpt`.
			const had = this.bodies.get(page.index);
			this.bodies.set(page.index, content);
			try {
				data.page = config.jekyllTemplates ? jekyllPage(page.data, site.pageWithBody(page), this.globalKeys()) : site.pageWithBody(page);
				// MkDocs' page, with the page's HTML and its table of contents.
				const mkdocsPage = this.mkdocsPageOf.get(data);
				if (mkdocsPage) {
					mkdocsPage.content = safe(content);
					mkdocsPage.toc = tocOf((data.page as Data).headings as Array<{ level: number; id?: string; text: string }>);
					data.page = mkdocsPage;
				} else if (site.mkdocs && page.data.mkdocsPage === false) data.page = null;
				for (const layout of layouts) {
					const layoutStart = performance.now();
					data.content = content;
					let text = layout.body;
					for (const name of layout.engines) {
						const ctx: RenderContext = { name: layout.name, inputPath: layout.path, cacheKey: `${layout.name}#${name}`, kind: "layout" };
						const engine = site.engines.get(name);
						try {
							const now = currentRendering();
							if (now) now.data = data;
							const out = engine.render(text, data, ctx);
							text = typeof out === "string" ? out : await asText(out, name, layout.name);
						} catch (e) { throw context(e, `rendering layout ${layout.name} for ${tpl.rel}`); }
					}
					content = text;
					// Layouts are rendering too: the summary's `write` was most of opensource.guide's
					// build (1.2 s, its layouts' `where` calls) while its writes took a fraction of it.
					this.renderMs += performance.now() - layoutStart;
					if (site.profile.detailed) site.profile.add("layouts", layout.name, performance.now() - layoutStart, false);
				}
			} finally {
				if (had === undefined && !this.keep) this.bodies.delete(page.index);
			}
			// A layout's own components (`<SiteNav />`); the page's were rendered with its body.
			if (this.componentsIn(page)) content = this.components(content, this.data(page), page);
		}

		const output = page.output;
		// What a transform gets, both paths from the project root as templates have them.
		const info = { url: page.url ?? "", inputPath: site.display(tpl.input), outputPath: site.display(output) };
		const transforms = [...config.htmlTransforms, ...config.transforms];
		for (let i = 0; i < transforms.length; i++) {
			const [name, transform] = transforms[i];
			// The site's own (config.transforms) are timed for `slow-call`; ssqch's (images, assets) with `--profile`.
			const own = i >= config.htmlTransforms.length;
			const run = () => transform(content, info);
			try { content = await (site.profile.times(own) ? site.profile.time("transforms", name, own, run, config.definedIn.get(`transforms.${name}`)) : run()); } catch (e) { throw new BuildError(`transform \`${name}\` failed for ${tpl.rel}: ${describeThrown(e, dirs.root)}`); }
		}
		// Last, so URLs that transforms wrote (images, fingerprinted assets) get it too.
		if (config.base !== "" && output.endsWith(".html")) {
			try { content = rewriteBase(content, config.base); } catch (e) { throw context(e, `in ${tpl.rel}`); }
		}
		if (site.profile.detailed) {
			const ms = performance.now() - start;
			site.profile.add("pages", page.url ?? shown(dirs.root, output), ms, false);
			site.profile.add("templates", shown(dirs.root, tpl.input), ms, false);
		}
		// While serving, a page that comes out the same is left alone, so the browser only
		// reloads for a page that changed.
		const changed = !(config.serving && sameContents(output, content));
		this.written.set(page.index, { file: output, bytes: Buffer.byteLength(content), changed });
		if (config.serving) keptWritten.set(output, Buffer.byteLength(content));
		progressed();
		if (changed) await this.write(output, content);
		// A line per page only with `--verbose`: 404 of them for opensource.guide, on every build and
		// every save while serving, are tokens an agent pays for and lines a person scrolls past
		// (the osg fresh run, the new-blog run). The summary says what was written.
		if (config.verbose && !config.quiet) progress(`[ssqch] Writing ${site.display(output)} from ${site.display(tpl.input)} (${tpl.engines.join(", ")})`);
	}

	/**
	 * Writes go to Node's thread pool, so this thread keeps rendering. Room first, then the
	 * write, with nothing in between, so the queue never passes its limit (it holds pages in
	 * memory).
	 */
	private async write(file: string, content: string): Promise<void> {
		while (this.pending.size >= MAX_WRITES) await new Promise<void>((resolve) => this.waiters.push(resolve));
		const dir = path.dirname(file);
		let made = this.folders.get(dir);
		if (!made) this.folders.set(dir, made = fs.promises.mkdir(dir, { recursive: true }));
		const job: Promise<void> = made.then(() => fs.promises.writeFile(file, content)).catch((e) => { this.writeError ??= new BuildError(`writing ${file}: ${messageOf(e)}`); }).finally(() => {
			this.pending.delete(job);
			this.waiters.shift()?.();
		});
		this.pending.add(job);
	}
}

// A paginated page says which item it was rendering, after the engine's name, so the parts
// `locate` reads stay as they are: six errors that all said `snacks/snack.jinja` didn't say which
// snack (the Squatch Snacks rerun, as schema errors already did).
const rendering = (e: unknown, tpl: Tpl, engine: string, data?: Data) => context(e, `rendering ${tpl.rel} with \`${engine}\`${data ? paginated(data) : ""}`);

/**
 * An engine's answer that isn't a string: a promise of one. Anything else (a `null` from a
 * library that answered later than it should) is a bug in that engine, said here and as one
 * build error, where it would otherwise crash whatever read it next. A site's own engines are
 * checked where they're made (`engine "x" returned number`), as in 0.7.
 */
function asText(out: unknown, engine: string, what: string): Promise<string> {
	const notText = (value: unknown) => new BuildError(`${voice.SOMETHING_LARGE}: internal error while processing ${what}: the \`${engine}\` engine gave ${value === null ? "null" : typeof value} instead of text (this is a bug in ssqch; please report it at ${voice.ISSUES_URL})`);
	if (typeof (out as { then?: unknown } | null)?.then !== "function") throw notText(out);
	return (out as Promise<unknown>).then((text) => (typeof text === "string" ? text : Promise.reject(notText(text))));
}

/** An error that isn't the site's: a bug in ssqch, named so one bad page doesn't end the build without context. */
function internal(e: unknown, what: string): BuildError {
	const detail = e instanceof Error ? e.stack ?? e.message : String(e);
	return new BuildError(`${voice.SOMETHING_LARGE}: internal error while processing ${what}: ${detail} (this is a bug in ssqch; please report it at ${voice.ISSUES_URL})`);
}

/**
 * What each page's file held when a build last read it and found it the same as what it had
 * rendered: the file (its inode), its size, its modification and change times, and a hash of the
 * contents. While serving, the next build compares with this instead of reading the file again
 * (a sixth of a rebuild on a big site), as long as none of them is different. The change time is
 * the one a tool can't put back: `cp -p`, `rsync -a` and `touch -r` keep a modification time, and
 * a write with the same number of bytes would look like no write at all.
 */
const found = new Map<string, { ino: number; size: number; mtimeMs: number; ctimeMs: number; hash: string; at: number }>();

/** Whether the file at `file` already holds exactly `contents`. */
function sameContents(file: string, contents: string): boolean {
	const stat = fs.statSync(file, { throwIfNoEntry: false });
	if (!stat || stat.size !== Buffer.byteLength(contents)) {
		found.delete(file);
		return false;
	}
	const hash = crypto.hash("sha1", contents, "base64");
	const known = found.get(file);
	// A file written in the last moments before it was read may have been written again since
	// without its times changing (some disks keep times to the second): that one is read again.
	if (known && known.ino === stat.ino && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.ctimeMs === stat.ctimeMs && known.at - Math.max(known.mtimeMs, known.ctimeMs) > 2500) {
		if (known.hash === hash) return true;
		found.delete(file);
		return false;
	}
	let same = false;
	try { same = fs.readFileSync(file, "utf8") === contents; } catch { /* gone, or not a file */ }
	if (same) found.set(file, { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, hash, at: Date.now() });
	else found.delete(file);
	return same;
}

/**
 * Files in an include folder that can't hold template code, which the checks below don't read:
 * images (SVG too), fonts, media and archives. Material for MkDocs ships 14,376 icons as includes,
 * and reading each on every build made a 25-page site take a second (the fresh httpx move).
 */
const NOT_TEMPLATES = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|br|mp[34]|webm|ogg|wav|mov)$/i;
const includeTexts = new WeakMap<Site, Array<{ dir: string; file: string; text: string }>>();

/** The text of each file in the includes folders that can be a template, read once per build. */
function includeSources(site: Site): Array<{ dir: string; file: string; text: string }> {
	let list = includeTexts.get(site);
	if (list) return list;
	list = [];
	for (const dir of [site.dirs.includes, ...site.themeIncludes]) {
		for (const file of walkFiles(dir)) {
			if (NOT_TEMPLATES.test(file)) continue;
			try { list.push({ dir, file, text: fs.readFileSync(file, "utf8") }); } catch { /* not text */ }
		}
	}
	includeTexts.set(site, list);
	return list;
}

/** Whether any template, layout or include reads a page's rendered content (cheap: it decides whether bodies are kept from the start). */
function mentionsContent(site: Site): boolean {
	const reads = (text: string) => text.includes("templateContent") || /\.content\b/.test(text);
	if (site.tpls.some((t) => reads(t.body))) return true;
	for (const layout of site.layouts.values()) if (reads(layout.body)) return true;
	return includeSources(site).some(({ text }) => reads(text));
}

// ---- which pages read collections ------------------------------------------------------------

/**
 * Whether a template's body reads `collections`, so it renders after every other page (whose
 * `templateContent` it may show). Only template code counts: `{{ ... }}` and `@directive` lines
 * for Edge, `{{ }}`, `{% %}` and `<% %>` tags for other template languages. A post that merely
 * mentions "collections" in its text, or is only Markdown (`render: md`), renders first so its
 * content can appear in feeds.
 */
function usesCollections(tpl: Tpl, includes: Set<string>): boolean {
	if (tpl.body.includes("collections") && codeMentions(tpl.body, tpl.engines, "collections")) return true;
	// An include, import or component that reads collections. Only names in template code:
	// `The "footer" of a page` in a post's text isn't an include.
	if (!includes.size) return false;
	for (const [at, name] of quotedNames(tpl.body)) {
		if (includes.has(includeKey(name)) && inCode(tpl.body, tpl.engines, at)) return true;
	}
	return false;
}

const isPlain = (engine: string) => engine === "edge" || engine === "md" || engine === "html" || engine === "txt";

/** Whether `word` is in template code (not prose) for a template rendered by `engines`. */
function codeMentions(body: string, engines: string[], word: string): boolean {
	if (engines.includes("edge") && edgeCodeMentions(body, word)) return true;
	// Other template languages (Liquid and the like) put code in `{{ }}` and `{% %}`. Markdown
	// and plain files have none.
	return engines.some((e) => !isPlain(e)) && tagCodeMentions(body, word);
}

/** Whether the character at `at` is in template code for a template rendered by `engines`. */
function inCode(body: string, engines: string[], at: number): boolean {
	return (engines.includes("edge") && inEdgeCode(body, at)) || (engines.some((e) => !isPlain(e)) && inTagCode(body, at));
}

/** Quoted strings in a template, the names an `include`, `import`, `@include` or `{{> partial}}` uses (and any other strings), with where each starts. */
function* quotedNames(body: string): Generator<[number, string]> {
	for (const found of body.matchAll(/["']([\w./-]{1,200})["']|\{\{>\s*([\w./-]+)/g)) {
		const name = found[1] ?? found[2];
		yield [found.index + found[0].indexOf(name), name];
	}
}

/** `partials/nav.njk` and `./partials/nav` are both `partials/nav`. */
function includeKey(name: string): string {
	const plain = name.replace(/^(\.\/)+/, "");
	const dot = plain.lastIndexOf(".");
	return dot > 0 && !plain.slice(dot + 1).includes("/") ? plain.slice(0, dot) : plain;
}

/** The files in the includes folders (as `includeKey`s) whose code reads `collections`, or that include one that does. */
function includesUsingCollections(site: Site): Set<string> {
	const files: Array<[string, string]> = includeSources(site).map(({ dir, file, text }) => [includeKey(relative(dir, file)), text]);
	const using = new Set<string>();
	for (const [key, text] of files) {
		if (text.includes("collections") && (edgeCodeMentions(text, "collections") || tagCodeMentions(text, "collections"))) using.add(key);
	}
	for (;;) {
		const before = using.size;
		for (const [key, text] of files) {
			if (using.has(key)) continue;
			for (const [at, name] of quotedNames(text)) {
				if (using.has(includeKey(name)) && (inEdgeCode(text, at) || inTagCode(text, at))) { using.add(key); break; }
			}
		}
		if (using.size === before) return using;
	}
}

function* indexesOf(body: string, word: string): Generator<number> {
	for (let at = body.indexOf(word); at !== -1; at = body.indexOf(word, at + word.length)) yield at;
}

/** Whether `word` appears inside a `{{ ... }}`, `{% ... %}` or EJS `<% ... %>` tag. */
function tagCodeMentions(body: string, word: string): boolean {
	for (const at of indexesOf(body, word)) if (inTagCode(body, at)) return true;
	return false;
}

/** Whether `at` is inside a `{{ }}`, `{% %}` or `<% %>` tag. */
function inTagCode(body: string, at: number): boolean {
	const before = body.slice(0, at);
	return [["{{", "}}"], ["{%", "%}"], ["<%", "%>"]].some(([open, close]) => {
		const from = before.lastIndexOf(open);
		return from !== -1 && !before.slice(from).includes(close);
	});
}

function edgeCodeMentions(body: string, word: string): boolean {
	for (const at of indexesOf(body, word)) if (inEdgeCode(body, at)) return true;
	return false;
}

/** Whether `at` is inside an Edge interpolation or on a directive line. */
export function inEdgeCode(body: string, at: number): boolean {
	const before = body.slice(0, at);
	// Inside an interpolation: the last `{{` comes after the last `}}`.
	const open = before.lastIndexOf("{{");
	if (open !== -1 && !before.slice(open).includes("}}") && !before.startsWith("{{--", open)) return true;
	// On a directive line such as `@each(post in collections.posts)`.
	const lineStart = before.lastIndexOf("\n") + 1;
	return body.slice(lineStart).trimStart().startsWith("@");
}

export const edgeCodeMentionsForTest = edgeCodeMentions;
export const asTextForTest = asText;
export const sameContentsForTest = sameContents;

// ---- checks ----------------------------------------------------------------------------------

/**
 * Warns about data keys that are another generator's name for something ssqch calls otherwise
 * (`eleventyNavigation`, `published: false`): any key is valid data, so these do nothing,
 * quietly. One warning per key.
 */
function checkForeignKeys(site: Site): void {
	// Aliases are read as ssqch's keys (see `aliasDataKeys`).
	for (const row of equivalents.TABLE) {
		if (row.kind !== "frontMatter" || row.alias) continue;
		// A site with a filter of that name reads the key on purpose: `ssqch scout` leaves
		// `eleventyNavigation` and eleventy-navigation's filter when templates call it.
		if (site.config.filters.has(row.word)) continue;
		// `published` is a site's own word too; only `false`, which means something elsewhere, is news.
		const sets = (page: Page) => (row.word in page.data) && (row.word !== "published" || page.data[row.word] === false);
		const files = dedup(site.pages.filter(sets).map((p) => shown(site.dirs.root, p.tpl.input)));
		const n = files.length;
		if (!n) continue;
		const message = n === 1
			? `${files[0]} sets \`${row.word}\`${row.from.length ? ` (${row.from[0]}'s name)` : ""}. ${row.say}\n  More: ${row.more}`
			: `${n} pages set \`${row.word}\` (${files.slice(0, 3).join(", ")}${n > 3 ? ", ..." : ""}): ${row.say}\n  More: ${row.more}`;
		warn(warning("foreign-key", message, n === 1 ? { field: row.word, file: files[0] } : { field: row.word }));
	}
	// `page` is ssqch's own (url, inputPath, date, headings), so a page's front matter `page` is
	// replaced: VitePress's `page: true` on vuejs.org's 9 pages vanished without a word.
	const files = dedup(site.pages.filter((p) => p.tpl.frontKeys.includes("page")).map((p) => shown(site.dirs.root, p.tpl.input)));
	if (files.length) {
		const say = "`page` is ssqch's (the page's url, inputPath, date and headings), so the front matter's value is replaced and templates never see it. Give it another name (`pageLayout: true`); VitePress's `page: true`, a page without the docs layout, is a layout in ssqch (`layout: page`)";
		const message = files.length === 1 ? `${files[0]} sets \`page\` in its front matter. ${say}` : `${files.length} pages set \`page\` in their front matter (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", ..." : ""}): ${say}`;
		warn(warning("foreign-key", message, files.length === 1 ? { field: "page", file: files[0] } : { field: "page" }));
	}
}

/**
 * A PascalCase tag with no template in `_includes/components/` (`<VueSchoolLink>`, from a
 * VitePress, Astro or MDX page): browsers show what's inside it and drop the tag, so it's said,
 * once a name, with the pages it's on.
 */
function warnUnknownComponents(site: Site): void {
	const unknown = [...site.unknownComponents].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	// Many at once (a move from VitePress has dozens): one warning, the most-used first.
	if (unknown.length > 3) {
		const ranked = [...unknown].sort(([a, x], [b, y]) => y.size - x.size || (a < b ? -1 : 1));
		const listed = ranked.slice(0, 8).map(([name, files]) => `<${name}> (${files.size === 1 ? [...files][0] : `${files.size} pages`})`).join(", ");
		warn(warning("template", `${unknown.length} components (PascalCase tags) have no template: ${listed}${unknown.length > 8 ? `, and ${unknown.length - 8} more` : ""}. Browsers drop the tags and show what's inside them. Give each one in _includes/components/<Name>.* (it gets \`component.props\` and \`component.content\`; \`ssqch docs components\`), or write the HTML it stands for`));
		return;
	}
	for (const [name, files] of unknown) {
		const list = [...files].sort();
		const where = list.length === 1 ? list[0] : `${list.length} pages (${list.slice(0, 3).join(", ")}${list.length > 3 ? ", ..." : ""})`;
		warn(warning("template", `\`<${name}>\` in ${where} is a component (a PascalCase tag) with no template: browsers drop the tag and show what's inside it. Give it one in _includes/components/${name}.* (it gets \`component.props\` and \`component.content\`; \`ssqch docs components\`), or write the HTML it stands for`, list.length === 1 ? { file: list[0] } : {}));
	}
}

/** A list without repeats that follow each other. */
const dedup = (list: string[]) => list.filter((item, i) => i === 0 || item !== list[i - 1]);

/**
 * Warns about template code that reads another generator's globals (`eleventy.generator`,
 * Jekyll's `site.posts`), which print nothing or an empty list here, quietly. Pages, their
 * layouts and the includes are read. `site.posts` is the site's own when its `site` data has
 * `posts`.
 */
function checkForeignGlobals(site: Site): void {
	// `site.posts` is Jekyll's only where nothing gives `site` a `posts`: not the global data, and
	// not a page's own data (front matter, directory data).
	const defines = (data: Data, key: string) => data.site !== undefined && data.site !== null && data.site[key] !== undefined;
	// With `jekyllTemplates`, Jekyll's `site` is there: its words aren't another generator's then.
	const jekyll = site.config.jekyllTemplates;
	const rows = equivalents.TABLE.filter((e) => e.kind === "global" && (!e.word.startsWith("site.") || (!jekyll && !defines(site.global, e.word.slice(5)))));
	if (!rows.length) return;
	// Each template's text, with the pages it makes (none for layouts and includes).
	const sources: Array<[string, string, Tpl | undefined]> = [];
	const seen = new Set<string>();
	for (const tpl of site.tpls) {
		// A page no template language reads (`render: md`, plain HTML) prints `{{ eleventy.generator }}`
		// as it's written: a page about another generator, not a use of it. Its layouts still count.
		if (tpl.engines.some((e) => e !== "md" && e !== "html" && e !== "txt")) sources.push([site.display(tpl.input), tpl.body, tpl]);
		for (const layout of tpl.layouts) {
			if (seen.has(layout.path)) continue;
			seen.add(layout.path);
			sources.push([site.display(layout.path), layout.body, undefined]);
		}
	}
	for (const { file, text } of includeSources(site)) {
		if (seen.has(file)) continue;
		seen.add(file);
		sources.push([site.display(file), text, undefined]);
	}
	// `site.articles`, a Jekyll collection's name, is a collection here too: `collections.articles`.
	// opensource.guide's language menus and guide lists were empty on 380 pages, with no word. Each
	// template is read once for the `site.<name>`s it has, and the names that are tags count: a row
	// for every tag would read every template once for each (10,000 pages took 2.5 s more).
	const mentioned = new Set<string>();
	for (const [, text] of sources) {
		if (!text.includes("site.")) continue;
		for (const m of text.matchAll(/\bsite\.([A-Za-z_][\w-]*)/g)) mentioned.add(m[1]);
	}
	if (mentioned.size && !jekyll) {
		const tagged = new Set<string>();
		for (const p of site.pages) {
			const tags = Array.isArray(p.data.tags) ? p.data.tags : typeof p.data.tags === "string" ? [p.data.tags] : [];
			for (const t of tags) if (typeof t === "string" && mentioned.has(t)) tagged.add(t);
		}
		for (const name of [...tagged].sort(compareText)) {
			if (name === "all" || name === "posts" || defines(site.global, name)) continue;
			rows.push({ word: `site.${name}`, kind: "global", alias: false, from: ["Jekyll"], ssqch: "collections", say: `ssqch's lists of pages are \`collections\`: \`collections.${name}\` is the pages tagged \`${name}\`, so this is empty (and an item's front matter is under \`data\`: \`item.data.title\`).`, more: "ssqch docs collections" });
		}
	}
	// Whether the pages a source renders for have the value: its own pages, or any page for a layout or include.
	const hasValue = (key: string, tpl: Tpl | undefined) => site.pages.some((p) => (tpl === undefined || p.tpl === tpl) && defines(p.data, key));
	for (const row of rows) {
		const key = row.word.startsWith("site.") ? row.word.slice(5) : undefined;
		const files = [...new Set(sources
			.filter(([, text]) => text.includes(row.word) && (tagCodeMentions(text, row.word) || edgeCodeMentions(text, row.word)))
			.filter(([, , tpl]) => key === undefined || !hasValue(key, tpl))
			.map(([file]) => file.replace(/^\.\//, "")))].sort(compareText);
		if (!files.length) continue;
		const word = row.word.replace(/\.+$/, "");
		const message = files.length === 1
			? `${files[0]} uses \`${word}\` (${row.from[0] ?? "another generator"}'s). ${row.say}\n  More: ${row.more}`
			: `${files.length} templates use \`${word}\` (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", ..." : ""}): ${row.say}\n  More: ${row.more}`;
		warn(warning("foreign-global", message, files.length === 1 ? { file: files[0] } : {}));
	}
}

/**
 * The templates in the includes folder (and the layouts folder, when it's another one) that
 * this build used neither as a layout nor as an include or component, from the project root.
 * Only the languages whose engine keeps track of its includes are looked at; render hooks and
 * containers are found by name, not included, so they're left out. An include counts whichever
 * engine read it (a `.jinja` file a `.njk` page includes).
 */
function unusedTemplates(site: Site): string[] {
	const { dirs } = site;
	const tracked = new Set<string>();
	const included = new Set<string>();
	for (const [ext, engine] of site.engines.byName) {
		const list = engine.included?.();
		if (!list) continue;
		tracked.add(ext);
		for (const name of list) included.add(name.replace(/^(\.\/)+/, ""));
	}
	const layouts = new Set([...site.layouts.values()].map((l) => l.path));
	const unused = new Set<string>();
	for (const dir of dirs.layouts === dirs.includes ? [dirs.includes] : [dirs.includes, dirs.layouts]) {
		for (const file of walkFiles(dir)) {
			const ext = path.extname(file).slice(1).toLowerCase();
			if (ext === "" || !tracked.has(ext)) continue;
			const rel = relative(dir, file);
			const name = rel.slice(0, rel.length - ext.length - 1);
			const byName = rel.startsWith("hooks/") || rel.startsWith("containers/");
			if (!byName && !layouts.has(file) && !included.has(rel) && !included.has(name)) unused.add(shown(dirs.root, file));
		}
	}
	return [...unused].sort(compareText);
}

// ---- hooks -----------------------------------------------------------------------------------

/** The argument to `beforeBuild` and `afterBuild` hooks. Folders are from the project root; `written` (after the build) lists the files it wrote. */
function hookEvent(config: Config, dirs: Dirs, report: BuildReport | undefined): Data {
	const rel = (dir: string) => (dir === dirs.root ? "./" : isInside(dirs.root, dir) ? `./${relative(dirs.root, dir)}/` : `${dir}/`);
	// `quiet` and `verbose` say what the build was asked to print, so a hook's own messages can follow
	// `-q` (expressjs.com's social-image hook read process.argv for it, ex #11).
	const event: Data = { env: config.env, serving: config.serving, quiet: config.quiet, verbose: config.verbose, dirs: { input: rel(dirs.input), output: rel(dirs.output), includes: rel(dirs.includes), data: rel(dirs.data) } };
	if (report) event.written = [...report.written];
	// While serving, what changed to start this build (`./src/guide/intro.md`): a hook can skip
	// work the change doesn't touch (vuejs.org's Vite build of its components, when only Markdown
	// changed: 867 ms to 343 ms). Not there on a build of everything.
	if (config.changed) event.changed = config.changed.map((file) => (isInside(dirs.root, file) ? `./${relative(dirs.root, file)}` : file));
	return event;
}

async function runHooks(config: Config, dirs: Dirs, event: "beforeBuild" | "afterBuild", hooks: Hook[], report: BuildReport | undefined, profile?: Profile): Promise<void> {
	const failed = event === "beforeBuild" ? "before_build hook failed" : "after_build hook failed";
	for (const hook of hooks) {
		try {
			// With `--profile`, timed: a command, or a function by its label (`afterBuild
			// (ssqch.config.js)`); a built-in plugin's has none. A hook runs once a build, and a long
			// one (Pagefind) is often the point, so it's no `slow-call`.
			if ("run" in hook) {
				// spawnSync holds the event loop for as long as the command runs: the server is told
				// first, so a long one (Pagefind's first download) isn't taken for a stuck build.
				await aboutToBlock(`${event}: ${hook.run}`);
				const run = () => runCommand(config, dirs, event, hook.run);
				try {
					if (profile?.detailed) profile.time("hooks", `${event}: ${hook.run}`, false, run);
					else run();
				} finally {
					// The command's time isn't time the build stood still.
					progressed();
				}
			} else {
				const call = () => hook.fn(hookEvent(config, dirs, report));
				// A built-in plugin's hook has no label: its errors already say who it is.
				try { await settle(profile?.detailed ? profile.time("hooks", hook.label || `${event} (built in)`, false, call) : call(), `${event} hook ${hook.label || "(built in)"}`); } catch (e) { throw hook.label === "" && e instanceof Error ? e : new BuildError(`${hook.label}: ${describeThrown(e, dirs.root)}`); }
			}
		} catch (e) {
			throw context(e, failed);
		}
	}
}

/**
 * Runs `command` through the shell (`sh -c`, or `cmd /C` on Windows) in the project root, with
 * its output passed through. It gets `SSQCH_ENV`, `SSQCH_SERVING` and `SSQCH_QUIET` (`true` or
 * `false`), `SSQCH_INPUT` and `SSQCH_OUTPUT` (the folders, absolute). A failure (or a program that can't
 * start) is an error naming the command.
 */
export function runCommand(config: Config, dirs: Dirs, event: string, command: string): void {
	if (!config.quiet) progress(`[ssqch] ${event}: ${command}`);
	const { file, args, options } = commandLine(command, dirs.root, { SSQCH_ENV: config.env, SSQCH_SERVING: config.serving ? "true" : "false", SSQCH_QUIET: config.quiet ? "true" : "false", SSQCH_INPUT: dirs.input, SSQCH_OUTPUT: dirs.output });
	// Under `-q` the tool's own output is held (Tailwind's banner printed on every quiet build,
	// Squatch Snacks E10), and shown only when it fails, where it's the part that says why.
	const held = config.quiet;
	const ran = spawnSync(file, args, {
		...options,
		// Standard output is kept for the JSON report, so the command's goes to standard error.
		stdio: held ? ["inherit", "pipe", "pipe"] : ["inherit", isCapturing() ? 2 : "inherit", "inherit"],
		maxBuffer: 256 * 1024 * 1024,
	});
	if (ran.error) bail(`${event}: couldn't run \`${command}\`: ${ran.error.message}`);
	if (held && ran.status !== 0) {
		if (ran.stdout?.length) process.stderr.write(ran.stdout);
		if (ran.stderr?.length) process.stderr.write(ran.stderr);
	}
	if (ran.status !== 0) bail(`${event}: \`${command}\` ${ran.status === null ? "was stopped" : `exited with status ${ran.status}`}`);
}

// ---- files plugins add -----------------------------------------------------------------------

/** Whether `file` holds `contents` already (text, or a binary file's bytes), so it isn't written again. */
const sameText = (file: string, contents: string | Uint8Array) => {
	try { return typeof contents === "string" ? fs.readFileSync(file, "utf8") === contents : Buffer.from(contents).equals(fs.readFileSync(file)); } catch { return false; }
};

/** Runs the file builders (files built from sources of their own, like compiled CSS) and writes their files, unless a file is already up to date. */
async function runFileBuilders(config: Config, dirs: Dirs): Promise<string[]> {
	const owners = new Map<string, string>();
	const out: string[] = [];
	for (const [name, builder] of config.fileBuilders) {
		let files: GeneratedFile[];
		try { files = await builder(config); } catch (e) { throw context(e, `${name} failed`); }
		for (const file of files) {
			const rel = file.path.replace(/^\/+/, "");
			if (!file.path.startsWith("/") || rel === "" || rel.endsWith("/") || rel.split("/").includes("..")) bail(`${name}: ${JSON.stringify(file.path)} must be a URL path to a file in the output, starting with /`);
			const target = path.join(dirs.output, rel);
			const other = owners.get(target);
			if (other !== undefined) bail(`${other} and ${name} both write ${displayOf(dirs, target)}`);
			owners.set(target, name);
			if (!sameText(target, file.contents)) {
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.writeFileSync(target, file.contents);
			}
			out.push(target);
		}
	}
	return out;
}

const displayOf = (dirs: Dirs, file: string) => (isInside(dirs.root, file) ? `./${relative(dirs.root, file)}` : file);

/**
 * Runs the generators (files made from the list of pages: a sitemap, redirect pages) over the
 * written pages and writes their files. Returns the paths written (not counting appends to a
 * page's own file).
 */
/** The files generators wrote (not pages'), and which generator wrote each. */
interface Generated { files: string[]; owners: Map<string, string> }

async function runGenerators(config: Config, dirs: Dirs, pages: Page[], pageOutputs: Set<string>, site: Site): Promise<Generated> {
	if (!config.generators.length) return { files: [], owners: new Map() };
	const summaries: PageSummary[] = pages.flatMap((p) => (p.url !== null && p.output !== null ? [{ url: p.url, outputPath: p.output, inputPath: p.tpl.input, date: p.date, data: p.data }] : []));
	const owners = new Map<string, string>();
	const out: string[] = [];
	const view: GeneratorSite = {
		collection: (name) => (Array.isArray(site.collections[name]) ? site.collections[name] : undefined),
		collectionNames: () => Object.keys(site.collections).filter((n) => Array.isArray(site.collections[n])).sort(compareText),
		global: site.global,
	};
	for (const [name, generator] of config.generators) {
		let files: GeneratedFile[];
		try { files = await generator(config, summaries, view); } catch (e) { throw context(e, `${name} failed`); }
		for (const file of files) {
			const rel = file.path.replace(/^\/+/, "");
			if (!file.path.startsWith("/") || rel.split("/").includes("..")) bail(`${name}: ${JSON.stringify(file.path)} must be a URL path in the output, starting with /`);
			const target = rel === "" || rel.endsWith("/") ? path.join(dirs.output, rel, "index.html") : path.join(dirs.output, rel);
			const isPage = pageOutputs.has(target);
			if (!file.append) {
				if (isPage) bail(`${name} and a page both write ${displayOf(dirs, target)}`);
				const other = owners.get(target);
				if (other !== undefined) bail(`${other} and ${name} both write ${displayOf(dirs, target)}`);
			}
			let contents = file.contents;
			// The site's own template for this kind of file, if it has one.
			if (file.hook) {
				let rendered: string | undefined;
				try { rendered = site.markdown.hookFile(file.hook.name, file.hook.value, site.global); } catch (e) { throw context(e, `${name}: writing ${file.path}`); }
				if (rendered !== undefined) contents = rendered;
			}
			if (file.append && typeof contents === "string" && (isPage || owners.has(target))) {
				let existing = "";
				try { existing = fs.readFileSync(target, "utf8"); } catch { /* nothing there yet */ }
				if (existing !== "" && !existing.endsWith("\n")) existing += "\n";
				contents = existing + contents;
			}
			// While serving: the same text this build wrote last time, into a file that's as it was
			// left (its size and time), is left as it is without reading it (the llms plugin's copies:
			// one a page).
			const was = config.serving && typeof contents === "string" ? keptGenerated.get(target) : undefined;
			const stat = was ? fs.statSync(target, { throwIfNoEntry: false }) : undefined;
			if (!(was && stat && was.text === contents && was.mark === `${stat.size}:${stat.mtimeMs}`)) {
				fs.mkdirSync(path.dirname(target), { recursive: true });
				if (!sameText(target, contents)) fs.writeFileSync(target, contents);
				if (config.serving && typeof contents === "string") {
					const now = fs.statSync(target);
					keptGenerated.set(target, { text: contents, mark: `${now.size}:${now.mtimeMs}` });
				}
			}
			if (!isPage) {
				if (!owners.has(target)) out.push(target);
				owners.set(target, name);
			}
		}
	}
	return { files: out, owners };
}

// ---- passthrough -----------------------------------------------------------------------------

/**
 * Page bundles: the files next to an `index` page (outside the input folder's root) that aren't
 * templates or data, copied next to its output. Subfolders with templates of their own are left
 * out.
 */
function bundleFiles(site: Site): CopyJob[] {
	const { config, dirs } = site;
	const templates = new Set(site.files);
	// Template files left out by `ignore` (or not rendered) aren't bundle files either.
	const ignore = globSet("ignore", config.ignore);
	// A template that isn't rendered isn't copied as it is either (it may be a draft).
	const formats = site.templateLanguages();
	const seen = new Set<string>();
	const jobs: CopyJob[] = [];
	for (const page of site.pages) {
		const input = page.tpl.input;
		const dir = path.dirname(input);
		const name = path.basename(input);
		if (page.output === null || name.slice(0, name.length - path.extname(name).length) !== "index" || dir === site.rootOf(input) || seen.has(input)) continue;
		seen.add(input);
		const outDir = path.dirname(page.output);
		const dirName = path.basename(dir);
		const walk = (folder: string, depth: number) => {
			for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				const file = path.join(folder, entry.name);
				if (entry.isDirectory()) {
					// A subfolder with its own templates is its own section.
					if (![...templates].some((t) => isInside(file, t))) walk(file, depth + 1);
					continue;
				}
				// Directory data (`my-post/my-post.json`) and the page's own data file (`index.json`).
				const isData = depth === 1 && STATIC_DATA_EXTENSIONS.some((ext) => entry.name === `${dirName}.${ext}` || entry.name === `index.${ext}`);
				const ext = path.extname(entry.name).slice(1).toLowerCase();
				if (!entry.isFile() || templates.has(file) || entry.name.includes(".data.") || isData || ignore(relative(dirs.input, file)) || formats.has(ext)) continue;
				jobs.push([file, path.join(outDir, path.relative(dir, file))]);
			}
		};
		walk(dir, 1);
	}
	return jobs;
}

/**
 * Every file under `dir`, following links: a linked file or folder is copied under the link's
 * name. A link to nothing (or one that leads back up to a folder it's inside) goes to `onLost`,
 * which throws, or the link is skipped.
 */
function walkFollowing(dir: string, onLost: (link: string) => void): string[] {
	const out: string[] = [];
	const walk = (folder: string, above: string[]) => {
		for (const entry of readFollowing(folder, above, (problem) => onLost(problem.path)).sort((a, b) => compareText(a.name, b.name))) {
			if (entry.isDirectory) walk(entry.path, [...above, entry.real]);
			else if (entry.isFile && entry.name !== ".DS_Store") out.push(entry.path);
		}
	};
	walk(dir, [realPath(dir)]);
	return out;
}

/**
 * The files a passthrough glob matches (from the project root), and where each goes: under `to`
 * by its path below the glob's fixed prefix, or by its own path, like a plain passthrough path.
 */
function globJobs(config: Config, dirs: Dirs, glob: string, to: string | undefined): CopyJob[] {
	const pattern = slashes(glob).replace(/^(\.\/)+/, "");
	const matches = globSet("passthrough", [pattern]);
	const base = path.join(dirs.root, globBase(pattern));
	const jobs: CopyJob[] = [];
	// What can't be walked (a link to nothing) is skipped, as a glob that doesn't match it would.
	for (const file of isDir(base) ? walkFollowing(base, () => {}) : []) {
		const rel = relative(dirs.root, file);
		if (!matches(rel)) continue;
		jobs.push([file, to !== undefined ? path.join(dirs.output, to, path.relative(base, file)) : path.join(dirs.output, isInside(dirs.input, file) ? path.relative(dirs.input, file) : rel)]);
	}
	if (!jobs.length && !config.serving) warn(warning("passthrough", `passthrough glob ${JSON.stringify(pattern)} matches no files`));
	return jobs;
}

interface CopyStats {
	copied: number;
	unchanged: number;
	bytes: number;
	/** Every destination, copied or not. */
	paths: string[];
}

/**
 * Two sources copied to one file (two passthrough folders with a `favicon.ico` each, v8 #19) raced,
 * so either could win. The one listed later wins, every time, and when they differ that's a
 * warning naming both. Identical files are copied once. Changes `jobs` in place.
 */
function sameDestinations(jobs: CopyJob[], dirs: Dirs): void {
	const at = new Map<string, number>();
	const kept: CopyJob[] = [];
	const same = (a: string, b: string) => {
		if (realPath(a) === realPath(b)) return true;
		const [x, y] = [fs.statSync(a), fs.statSync(b)];
		return x.size === y.size && fs.readFileSync(a).equals(fs.readFileSync(b));
	};
	for (const job of jobs) {
		const earlier = at.get(job[1]);
		if (earlier === undefined) { at.set(job[1], kept.length); kept.push(job); continue; }
		const [first] = kept[earlier];
		if (!same(first, job[0])) warn(warning("passthrough", `${shown(dirs.root, first)} and ${shown(dirs.root, job[0])} are both copied to ${shown(dirs.root, job[1])}, and they differ: the one listed later (${shown(dirs.root, job[0])}) is the one written. Remove one, or give one another \`to\``, { file: shown(dirs.root, job[0]) }));
		kept[earlier] = job;
	}
	jobs.splice(0, jobs.length, ...kept);
}

async function passthroughCopy(config: Config, dirs: Dirs, extra: CopyJob[], generatedBy: Map<string, string> = new Map()): Promise<CopyStats> {
	const jobs: CopyJob[] = [...extra];
	for (const { from, to } of config.passthrough) {
		if (isGlob(from)) {
			jobs.push(...globJobs(config, dirs, from, to));
			continue;
		}
		const given = path.resolve(dirs.root, from);
		if (!fs.existsSync(given)) bail(`passthrough source ${given} does not exist`);
		const src = realPath(given);
		const dest = to !== undefined ? path.join(dirs.output, to) : path.join(dirs.output, isInside(dirs.input, src) ? path.relative(dirs.input, src) : isInside(dirs.root, src) ? path.relative(dirs.root, src) : src);
		if (isDir(src)) {
			// Links are followed, as in a glob.
			const broken = (link: string): never => bail(`passthrough ${from}: ${shown(dirs.root, link)} is a link to ${fs.readlinkSync(link)}, which doesn't exist`);
			for (const file of walkFollowing(src, broken)) jobs.push([file, path.join(dest, path.relative(src, file))]);
		} else {
			// A file given a folder (`"."`, `"img/"`, or one that's there) goes into it, by its own name.
			const into = to !== undefined && (to === "." || /[\\/]$/.test(to) || isDir(dest));
			jobs.push([src, into ? path.join(dest, path.basename(src)) : dest]);
		}
	}
	sameDestinations(jobs, dirs);
	// A copy onto a file a plugin wrote would replace it, silently: a glob that copied a robots.txt
	// dropped robotsPlugin()'s, `ai.training: false` and all (the 2026-11-24 review). The file is
	// named by where it lands, so a glob is caught as a path is.
	for (const [from, to] of jobs) {
		const owner = generatedBy.get(to);
		if (owner !== undefined) bail(`passthrough copies ${shown(dirs.root, from)} to ${displayOf(dirs, to)}, which ${owner} writes: keep one of them`);
	}
	// What a plugin already wrote under another name stays that way (config.renamedCopies).
	const renamed = jobs.filter(([, to]) => config.renamedCopies.has(to)).map(([, to]) => config.renamedCopies.get(to)!);
	if (renamed.length) jobs.splice(0, jobs.length, ...jobs.filter(([, to]) => !config.renamedCopies.has(to)));
	// Copies go through Node's thread pool, 32 at a time. A file whose copy is as new and as big is left alone.
	const stats: CopyStats = { copied: 0, unchanged: 0, bytes: 0, paths: [...jobs.map(([, to]) => to), ...renamed] };
	const folders = new Map<string, Promise<unknown>>();
	const failed: unknown[] = [];
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(32, jobs.length) }, async () => {
		while (next < jobs.length) {
			const [from, to] = jobs[next++];
			try {
				const [src, dest] = await Promise.all([fs.promises.stat(from), fs.promises.stat(to).catch(() => undefined)]);
				stats.bytes += src.size;
				if (dest && dest.size === src.size && dest.mtimeMs >= src.mtimeMs) { stats.unchanged++; continue; }
				const dir = path.dirname(to);
				let made = folders.get(dir);
				if (!made) folders.set(dir, made = fs.promises.mkdir(dir, { recursive: true }));
				await made;
				try { await fs.promises.copyFile(from, to); } catch (e) { throw new BuildError(`copying ${from} to ${to}: ${messageOf(e)}`); }
				stats.copied++;
			} catch (e) {
				failed.push(e);
			}
		}
	}));
	if (failed.length) throw errorsTogether(failed);
	return stats;
}

// ---- leave no trace --------------------------------------------------------------------------

/**
 * Where the build records the files it wrote and copied, from the output folder, so a later
 * build with `leaveNoTrace` knows which ones are its own.
 */
export const OUTPUT_LIST = ".cache/ssqch/output-files.json";

interface Recorded {
	/** Stale files deleted (with `leaveNoTrace`). */
	removed: number;
	/** There was no list: this is the site's first build. */
	firstBuild: boolean;
	/** Pages the last build to this folder didn't write, and pages it wrote that this one didn't. Left out when the last build's pages aren't known. */
	pagesNew?: number;
	pagesGone?: number;
	/** Files an earlier build to this folder wrote that this one didn't, still there because `leaveNoTrace` is off: by their path from the output folder, with `/`. */
	stale: string[];
}

/**
 * Records this build's output files. Files an earlier build recorded that this one didn't
 * produce are stale: with `leaveNoTrace` they're deleted, and without it they stay on the list,
 * so turning it on later still finds them. The list also has the pages, so the next build can
 * say which are new and which are gone.
 */
function recordOutputs(config: Config, dirs: Dirs, outputs: string[], pagePaths: string[]): Recorded {
	const listPath = path.join(dirs.root, OUTPUT_LIST);
	const firstBuild = !isFile(listPath);
	const outputName = shownOutput(config);
	const rel = (files: string[]) => new Set(files.filter((f) => isInside(dirs.output, f) && f !== dirs.output).map((f) => relative(dirs.output, f)));
	const current = rel(outputs);
	const pages = rel(pagePaths);
	let last: any;
	let text: string | undefined;
	try { text = fs.readFileSync(listPath, "utf8"); last = JSON.parse(text); } catch { /* no list, or not one of ours */ }
	if (last === null || typeof last !== "object" || Array.isArray(last)) last = undefined;
	// The top of the list is the last build; each other folder built into keeps its own under
	// `outputs`, so a build into `dist-before` doesn't make the next build forget `dist`'s files.
	const others: Record<string, unknown> = last?.outputs !== null && typeof last?.outputs === "object" && !Array.isArray(last.outputs) ? { ...last.outputs } : {};
	if (typeof last?.output === "string" && last.output !== outputName) others[last.output] = { files: last.files, pages: last.pages };
	const kept: any = last?.output === outputName ? last : others[outputName];
	const before: any = kept !== null && typeof kept === "object" ? kept : undefined;
	delete others[outputName];
	const names = (key: string): string[] | undefined => (Array.isArray(before?.[key]) ? before[key].filter((f: unknown) => typeof f === "string") : undefined);
	const previous = names("files") ?? [];
	// A list from before 0.4 has no pages: nothing to compare with.
	const old = names("pages");
	// (Sets: a list searched once for each page is a second and more on a big site.)
	const oldPages = old ? new Set(old) : undefined;
	const pagesNew = oldPages ? [...pages].filter((p) => !oldPages.has(p)).length : undefined;
	const pagesGone = oldPages ? [...oldPages].filter((p) => !pages.has(p)).length : undefined;

	let removed = 0;
	const left: string[] = [];
	for (const stale of previous.filter((f) => !current.has(f))) {
		// Only plain relative paths inside the output folder.
		if (path.isAbsolute(stale) || stale.split(/[/\\]/).some((part) => part === "" || part === "." || part === "..")) continue;
		const file = path.join(dirs.output, stale);
		if (!isFile(file)) continue;
		if (!config.leaveNoTrace) {
			// Still ours, and stale: remember it for when `leaveNoTrace` is turned on.
			current.add(stale);
			left.push(stale);
			continue;
		}
		try { fs.rmSync(file); } catch (e) { throw new BuildError(`removing stale ${file}: ${messageOf(e)}`); }
		removed++;
		if (!config.quiet) progress(`[ssqch] Removed ${displayOf(dirs, file)}`);
		// Then any folders that are now empty, up to the output folder.
		for (let dir = path.dirname(file); dir !== dirs.output && isInside(dirs.output, dir); dir = path.dirname(dir)) {
			try { fs.rmdirSync(dir); } catch { break; }
		}
	}

	const entry: Record<string, unknown> = { output: outputName, files: [...current].sort(compareText), pages: [...pages].sort(compareText) };
	// A folder that's gone (a `dist-before` deleted after its diff) has nothing left to clean.
	const otherNames = Object.keys(others).filter((name) => isDir(path.resolve(dirs.root, name))).sort(compareText);
	if (otherNames.length) entry.outputs = Object.fromEntries(otherNames.map((name) => [name, others[name]]));
	const list = JSON.stringify(entry, null, 2);
	// Left alone when nothing changed, so a build with nothing new touches no files.
	if (text !== list) {
		fs.mkdirSync(path.dirname(listPath), { recursive: true });
		fs.writeFileSync(listPath, list);
	}
	return { removed, firstBuild, pagesNew, pagesGone, stale: left.map(slashes).sort(compareText) };
}
