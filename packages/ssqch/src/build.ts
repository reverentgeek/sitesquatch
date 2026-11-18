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
import path from "node:path";
import { spawnSync } from "node:child_process";
import { rewriteBase } from "./base.ts";
import type { Config, Dirs, GeneratedFile, Hook, PageSummary } from "./config.ts";
import { shownDir, shownOutput } from "./config.ts";
import type { Data } from "./data.ts";
import { STATIC_DATA_EXTENSIONS } from "./data.ts";
import { BuildError, Diagnostics, bail, context, isCapturing, messageOf, progress, warn, warning } from "./diagnostics.ts";
import type { RenderContext } from "./engines/engine.ts";
import { rendering as markdownRendering, writeHighlightCss } from "./engines/markdown.ts";
import * as equivalents from "./equivalents.ts";
import { measure, overBudget } from "./footprint.ts";
import { globBase, globSet, isGlob } from "./glob.ts";
import { describeThrown, settle } from "./modules.ts";
import { compareText, isDir, isFile, isInside, readFollowing, realPath, relative, shown, slashes, walkFiles } from "./paths.ts";
import { checkPages } from "./schema.ts";
import type { CopyJob, Page, Tpl } from "./site.ts";
import { Site, Timer, errorsTogether } from "./site.ts";
import * as voice from "./voice.ts";

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
}

/** How many page writes wait at once: each holds its page in memory, so the queue has a limit. */
const MAX_WRITES = 64;

export async function build(config: Config): Promise<BuildReport> {
	const started = performance.now();
	const timer = new Timer();
	const site = new Site(config);
	const { dirs } = site;
	if (!isDir(dirs.input)) bail(`input directory ${shownDir(config, config.input)} does not exist`);

	const built = await runFileBuilders(config, dirs);
	await runHooks(config, dirs, "beforeBuild", config.beforeBuild, undefined);
	await site.prepare(timer);
	await checkPages(site);
	checkForeignKeys(site);
	checkForeignGlobals(site);
	timer.lap("paginate");

	const { pages } = site;
	const renderer = new Renderer(site);
	// Pages paginated over a collection render last too: their items come from the finished collections.
	const collectionIncludes = includesUsingCollections([dirs.includes, ...site.themeIncludes]);
	const overCollections = (p: Page) => typeof p.data.pagination?.data === "string" && p.data.pagination.data.startsWith("collections.");
	const wanted = pages.filter((p) => p.output !== null || p.inCollections);
	const late = new Set(wanted.filter((p) => usesCollections(p.tpl, collectionIncludes) || overCollections(p)));
	await site.buildCollections();
	for (const page of late) {
		if (overCollections(page)) {
			try { site.refreshPagination(page); } catch (e) { throw context(e, `in ${page.tpl.rel}`); }
		}
	}
	await renderer.renderAll([...wanted.filter((p) => !late.has(p)), ...wanted.filter((p) => late.has(p))], late);
	for (const wait of config.settle) await wait();
	timer.timings.push(["render", renderer.renderMs], ["write", performance.now() - timer.last - renderer.renderMs]);
	timer.last = performance.now();

	// In the order of the pages, whatever order they were rendered in.
	const written = pages.flatMap((p) => (renderer.written.has(p.index) ? [renderer.written.get(p.index)!] : []));
	const generated = await runGenerators(config, dirs, pages, new Set(written.map((w) => w.file)), site);
	const bundles = config.bundles ? bundleFiles(site) : [];
	bundles.push(...site.themeCopies);
	const copy = await passthroughCopy(config, dirs, bundles);
	const stylesheet = writeHighlightCss(config.markdown, dirs.output, site.markdown);
	timer.lap("copy");

	const pagePaths = written.map((w) => w.file);
	const outputs = [...pagePaths, ...generated, ...built, ...copy.paths, ...stylesheet];
	const recorded = recordOutputs(config, dirs, outputs, pagePaths);

	const report: BuildReport = {
		templates: site.tpls.length,
		pagesWritten: written.length,
		pageBytes: written.reduce((sum, w) => sum + w.bytes, 0),
		pagesChanged: config.serving ? written.filter((w) => w.changed).length : undefined,
		pagesNew: recorded.pagesNew,
		pagesGone: recorded.pagesGone,
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
	await runHooks(config, dirs, "afterBuild", config.afterBuild, report);
	// After the hooks, which can fingerprint or minify what's measured.
	if (config.budgets.length) for (const found of overBudget(await measure(dirs.output), config.budgets)) warn(found);
	for (const [label, line] of config.summaries) {
		const value = line(config);
		if (value !== undefined) report.summary.push([label, value]);
	}
	timer.lap("after");
	report.durationMs = performance.now() - started;
	report.timings = timer.timings;
	return report;
}

/** A page as `ssqch inspect` sees it. */
export interface InspectedPage {
	url: string | null;
	input: string;
	output: string | null;
	engines: string[];
	layouts: string[];
	date: Date;
	/** Whether the date is the one at the start of the file's name. */
	dateFromName: boolean;
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
export async function inspectPages(config: Config): Promise<{ dirs: Dirs; global: Data; pages: InspectedPage[] }> {
	const site = new Site(config, true);
	const { dirs } = site;
	if (!isDir(dirs.input)) bail(`input directory ${shownDir(config, config.input)} does not exist`);
	await runFileBuilders(config, dirs);
	await runHooks(config, dirs, "beforeBuild", config.beforeBuild, undefined);
	await site.prepare(new Timer());
	const pages = site.pages.map((p): InspectedPage => ({
		url: p.url,
		input: p.tpl.input,
		output: p.output,
		engines: p.tpl.engines,
		layouts: p.tpl.layouts.map((l) => l.name),
		date: p.date,
		dateFromName: p.tpl.fileDate !== undefined,
		inCollections: p.inCollections,
		data: p.data,
		layers: p.tpl.layers,
	}));
	return { dirs, global: site.global, pages };
}

// ---- render ----------------------------------------------------------------------------------

interface Written {
	file: string;
	bytes: number;
	/** Whether its contents changed (while serving, a page that comes out the same is left alone). */
	changed: boolean;
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
		this.keep = mentionsContent(site);
		site.contentOf = (page) => this.contentNow(page);
	}

	/** The data a page's templates get: its own, and the collections. */
	private data(page: Page): Data {
		return { ...page.data, collections: this.site.collections };
	}

	/** A page's body through its engines: at once when they all answer at once, otherwise later. */
	private body(page: Page): string | Promise<string> {
		const { tpl } = page;
		const data = this.data(page);
		const ctx: RenderContext = { name: tpl.rel, inputPath: tpl.input, cacheKey: tpl.rel };
		const run = (from: number, content: string): string | Promise<string> => {
			for (let i = from; i < tpl.engines.length; i++) {
				const name = tpl.engines[i];
				const engine = this.site.engines.get(name);
				let out: string | Promise<string>;
				try { out = engine.render(content, data, ctx); } catch (e) { throw rendering(e, tpl, name); }
				if (typeof out !== "string") return out.then((text) => run(i + 1, text), (e) => { throw rendering(e, tpl, name); });
				content = out;
			}
			return content;
		};
		return run(0, tpl.body);
	}

	/**
	 * A page's body for another page that reads it (`templateContent`), rendered now if it isn't
	 * yet. Nothing for a page that's reading its own.
	 */
	private contentNow(page: Page): string | undefined {
		this.keep = true;
		const kept = this.bodies.get(page.index);
		if (kept === RENDERING) return undefined;
		if (kept !== undefined) return kept;
		this.bodies.set(page.index, RENDERING);
		let out: string | Promise<string>;
		const before = markdownRendering(this.site.display(page.tpl.input));
		try {
			out = this.body(page);
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
			try {
				await this.render(page);
			} catch (e) {
				// A page that failed because a body it shows failed isn't reported: that body's page is.
				if (this.borrowedFailure) continue;
				const error = e instanceof BuildError || e instanceof Diagnostics ? e : internal(e, page.tpl.rel);
				const inBody = typeof e === "object" && e !== null && this.bodyErrors.has(e);
				this.errors.push({ error, phase: inBody ? (late.has(page) ? 1 : 0) : 2 });
			}
		}
		markdownRendering(undefined);
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

		if (tpl.layouts.length) {
			const data = this.data(page);
			// While its layouts render, the page's own body is there for `page.headings` and `page.excerpt`.
			const had = this.bodies.get(page.index);
			this.bodies.set(page.index, content);
			try {
				data.page = site.pageWithBody(page);
				for (const layout of tpl.layouts) {
					data.content = content;
					let text = layout.body;
					for (const name of layout.engines) {
						const ctx: RenderContext = { name: layout.name, inputPath: layout.path, cacheKey: `${layout.name}#${name}` };
						const engine = site.engines.get(name);
						try { text = await engine.render(text, data, ctx); } catch (e) { throw context(e, `rendering layout ${layout.name} for ${tpl.rel}`); }
					}
					content = text;
				}
			} finally {
				if (had === undefined && !this.keep) this.bodies.delete(page.index);
			}
		}

		const output = page.output;
		const info = { url: page.url ?? "", inputPath: site.display(tpl.input), outputPath: output };
		for (const [name, transform] of [...config.htmlTransforms, ...config.transforms]) {
			try { content = await transform(content, info); } catch (e) { throw new BuildError(`transform \`${name}\` failed for ${tpl.rel}: ${describeThrown(e, dirs.root)}`); }
		}
		// Last, so URLs that transforms wrote (images, fingerprinted assets) get it too.
		if (config.base !== "" && output.endsWith(".html")) {
			try { content = rewriteBase(content, config.base); } catch (e) { throw context(e, `in ${tpl.rel}`); }
		}
		// While serving, a page that comes out the same is left alone, so the browser only
		// reloads for a page that changed.
		const changed = !(config.serving && sameContents(output, content));
		this.written.set(page.index, { file: output, bytes: Buffer.byteLength(content), changed });
		if (changed) await this.write(output, content);
		if (!config.quiet) progress(`[ssqch] Writing ${site.display(output)} from ${site.display(tpl.input)} (${tpl.engines.join(", ")})`);
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

const rendering = (e: unknown, tpl: Tpl, engine: string) => context(e, `rendering ${tpl.rel} with \`${engine}\``);

/** An error that isn't the site's: a bug in ssqch, named so one bad page doesn't end the build without context. */
function internal(e: unknown, what: string): BuildError {
	const detail = e instanceof Error ? e.stack ?? e.message : String(e);
	return new BuildError(`${voice.SOMETHING_LARGE}: internal error while processing ${what}: ${detail} (this is a bug in ssqch; please report it at ${voice.ISSUES_URL})`);
}

/**
 * What each page's file held when a build last read it and found it the same as what it had
 * rendered: its size, when it was written, and a hash of the contents. While serving, the next
 * build compares with this instead of reading the file again (a sixth of a rebuild on a big
 * site), as long as the file hasn't been written since.
 */
const found = new Map<string, { size: number; mtimeMs: number; hash: string; at: number }>();

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
	// without its time changing (some disks keep times to the second): that one is read again.
	if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.at - known.mtimeMs > 2500) {
		if (known.hash === hash) return true;
		found.delete(file);
		return false;
	}
	let same = false;
	try { same = fs.readFileSync(file, "utf8") === contents; } catch { /* gone, or not a file */ }
	if (same) found.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, hash, at: Date.now() });
	else found.delete(file);
	return same;
}

/** Whether any template, layout or include reads a page's rendered content (cheap: it decides whether bodies are kept from the start). */
function mentionsContent(site: Site): boolean {
	const reads = (text: string) => text.includes("templateContent") || /\.content\b/.test(text);
	if (site.tpls.some((t) => reads(t.body))) return true;
	for (const layout of site.layouts.values()) if (reads(layout.body)) return true;
	for (const dir of [site.dirs.includes, ...site.themeIncludes]) {
		for (const file of walkFiles(dir)) {
			try { if (reads(fs.readFileSync(file, "utf8"))) return true; } catch { /* not text */ }
		}
	}
	return false;
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
function includesUsingCollections(dirs: string[]): Set<string> {
	const files: Array<[string, string]> = [];
	for (const dir of dirs) {
		for (const file of walkFiles(dir)) {
			try { files.push([includeKey(relative(dir, file)), fs.readFileSync(file, "utf8")]); } catch { /* not text */ }
		}
	}
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
	const rows = equivalents.TABLE.filter((e) => e.kind === "global" && (!e.word.startsWith("site.") || !defines(site.global, e.word.slice(5))));
	if (!rows.length) return;
	// Each template's text, with the pages it makes (none for layouts and includes).
	const sources: Array<[string, string, Tpl | undefined]> = [];
	const seen = new Set<string>();
	for (const tpl of site.tpls) {
		sources.push([site.display(tpl.input), tpl.body, tpl]);
		for (const layout of tpl.layouts) {
			if (seen.has(layout.path)) continue;
			seen.add(layout.path);
			sources.push([site.display(layout.path), layout.body, undefined]);
		}
	}
	for (const dir of [site.dirs.includes, ...site.themeIncludes]) {
		for (const file of walkFiles(dir)) {
			if (seen.has(file)) continue;
			seen.add(file);
			try { sources.push([site.display(file), fs.readFileSync(file, "utf8"), undefined]); } catch { /* not text */ }
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
	const event: Data = { env: config.env, serving: config.serving, dirs: { input: rel(dirs.input), output: rel(dirs.output), includes: rel(dirs.includes), data: rel(dirs.data) } };
	if (report) event.written = [...report.written];
	return event;
}

async function runHooks(config: Config, dirs: Dirs, event: "beforeBuild" | "afterBuild", hooks: Hook[], report: BuildReport | undefined): Promise<void> {
	const failed = event === "beforeBuild" ? "before_build hook failed" : "after_build hook failed";
	for (const hook of hooks) {
		try {
			if ("run" in hook) runCommand(config, dirs, event, hook.run);
			else {
				// A built-in plugin's hook has no label: its errors already say who it is.
				try { await settle(hook.fn(hookEvent(config, dirs, report))); } catch (e) { throw hook.label === "" && e instanceof Error ? e : new BuildError(`${hook.label}: ${describeThrown(e, dirs.root)}`); }
			}
		} catch (e) {
			throw context(e, failed);
		}
	}
}

/**
 * `PATH` for a command a site runs (hooks, `serve.run`): each `node_modules/.bin` from the
 * project's folder up, first, as npm, pnpm and yarn give their scripts, so `postcss` works under
 * `ssqch build` as it does under `npm run build`.
 */
export function toolPath(root: string): string {
	const bins: string[] = [];
	for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
		const bin = path.join(dir, "node_modules", ".bin");
		if (isDir(bin)) bins.push(bin);
		if (path.dirname(dir) === dir) break;
	}
	const rest = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean);
	return [...bins, ...rest].join(path.delimiter);
}

/**
 * Runs `command` through the shell (`sh -c`, or `cmd /C` on Windows) in the project root, with
 * its output passed through. It gets `SSQCH_ENV`, `SSQCH_SERVING` (`true` or `false`),
 * `SSQCH_INPUT` and `SSQCH_OUTPUT` (the folders, absolute). A failure (or a program that can't
 * start) is an error naming the command.
 */
export function runCommand(config: Config, dirs: Dirs, event: string, command: string): void {
	if (!config.quiet) progress(`[ssqch] ${event}: ${command}`);
	const env: NodeJS.ProcessEnv = { ...process.env, SSQCH_ENV: config.env, SSQCH_SERVING: config.serving ? "true" : "false", SSQCH_INPUT: dirs.input, SSQCH_OUTPUT: dirs.output };
	// One `PATH`, whatever case the platform spells it in.
	for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
	env.PATH = toolPath(dirs.root);
	const ran = spawnSync(command, {
		cwd: dirs.root,
		env,
		shell: true,
		// Standard output is kept for the JSON report, so the command's goes to standard error.
		stdio: ["inherit", isCapturing() ? 2 : "inherit", "inherit"],
	});
	if (ran.error) bail(`${event}: couldn't run \`${command}\`: ${ran.error.message}`);
	if (ran.status !== 0) bail(`${event}: \`${command}\` ${ran.status === null ? "was stopped" : `exited with status ${ran.status}`}`);
}

// ---- files plugins add -----------------------------------------------------------------------

const sameText = (file: string, contents: string) => { try { return fs.readFileSync(file, "utf8") === contents; } catch { return false; } };

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
async function runGenerators(config: Config, dirs: Dirs, pages: Page[], pageOutputs: Set<string>, site: Site): Promise<string[]> {
	if (!config.generators.length) return [];
	const summaries: PageSummary[] = pages.flatMap((p) => (p.url !== null && p.output !== null ? [{ url: p.url, outputPath: p.output, inputPath: p.tpl.input, date: p.date, data: p.data }] : []));
	const owners = new Map<string, string>();
	const out: string[] = [];
	for (const [name, generator] of config.generators) {
		let files: GeneratedFile[];
		try { files = await generator(config, summaries); } catch (e) { throw context(e, `${name} failed`); }
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
			if (file.append && (isPage || owners.has(target))) {
				let existing = "";
				try { existing = fs.readFileSync(target, "utf8"); } catch { /* nothing there yet */ }
				if (existing !== "" && !existing.endsWith("\n")) existing += "\n";
				contents = existing + contents;
			}
			fs.mkdirSync(path.dirname(target), { recursive: true });
			if (!sameText(target, contents)) fs.writeFileSync(target, contents);
			if (!isPage) {
				if (!owners.has(target)) out.push(target);
				owners.set(target, name);
			}
		}
	}
	return out;
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

async function passthroughCopy(config: Config, dirs: Dirs, extra: CopyJob[]): Promise<CopyStats> {
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
			jobs.push([src, dest]);
		}
	}
	// Copies go through Node's thread pool, 32 at a time. A file whose copy is as new and as big is left alone.
	const stats: CopyStats = { copied: 0, unchanged: 0, bytes: 0, paths: jobs.map(([, to]) => to) };
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
	let before: any;
	let text: string | undefined;
	try { text = fs.readFileSync(listPath, "utf8"); before = JSON.parse(text); } catch { /* no list, or not one of ours */ }
	if (before === null || typeof before !== "object" || before.output !== outputName) before = undefined;
	const names = (key: string): string[] | undefined => (Array.isArray(before?.[key]) ? before[key].filter((f: unknown) => typeof f === "string") : undefined);
	const previous = names("files") ?? [];
	// A list from before 0.4 has no pages: nothing to compare with.
	const old = names("pages");
	// (Sets: a list searched once for each page is a second and more on a big site.)
	const oldPages = old ? new Set(old) : undefined;
	const pagesNew = oldPages ? [...pages].filter((p) => !oldPages.has(p)).length : undefined;
	const pagesGone = oldPages ? [...oldPages].filter((p) => !pages.has(p)).length : undefined;

	let removed = 0;
	for (const stale of previous.filter((f) => !current.has(f))) {
		// Only plain relative paths inside the output folder.
		if (path.isAbsolute(stale) || stale.split(/[/\\]/).some((part) => part === "" || part === "." || part === "..")) continue;
		const file = path.join(dirs.output, stale);
		if (!isFile(file)) continue;
		if (!config.leaveNoTrace) {
			// Still ours, and stale: remember it for when `leaveNoTrace` is turned on.
			current.add(stale);
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

	const list = JSON.stringify({ output: outputName, files: [...current].sort(compareText), pages: [...pages].sort(compareText) }, null, 2);
	// Left alone when nothing changed, so a build with nothing new touches no files.
	if (text !== list) {
		fs.mkdirSync(path.dirname(listPath), { recursive: true });
		fs.writeFileSync(listPath, list);
	}
	return { removed, firstBuild, pagesNew, pagesGone };
}
