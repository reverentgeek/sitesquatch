// Markdown, for `.md` files and the `markdown()` and `highlight()` functions: ssqch's own, 0.7's
// `markdown.rs` and `highlight.rs` built as WebAssembly (`wasm/markdown.wasm`, from
// `crates/ssqch-markdown`; `scripts/build-wasm.ts` builds it again). So a page comes out as 0.7
// wrote it: the same HTML, heading ids, footnotes, alerts, containers and `hl-*` classes, and a
// site's `.sublime-syntax` grammars.
//
// The wasm calls back here for what's the site's: render hooks and containers
// (`_includes/hooks/*`, `_includes/containers/*`), rendered by the site's engines with the page's
// data, and the config's functions (`headingIds: text => id`, highlighters in
// `markdown.highlight.languages`). Those calls are synchronous, so a hook whose engine answers
// with a promise is an error that names the hook. `crates/ssqch-markdown/src/wasm.rs` is the
// other side of this file, and the two change together.
//
// One instance serves the whole process, so the fences it has highlighted are kept across the
// builds `ssqch serve` runs (the wasm drops them when the languages change, or when a build
// didn't use them). Between processes they're kept in `.cache/ssqch/highlight/fences.json`
// (see "the cache of highlighted fences" below), so a first build doesn't load syntect's
// grammars for fences it has highlighted before.
import { kramdownHtml, restoreBlankLines, withKramdownIds } from "./kramdown-html.ts";
import { hugoShortcodes, INLINE_SHORTCODE_MARKER, type InlineShortcode, inlineShortcodeNumber, pythonMarkdownAfter, pythonMarkdownBefore, pythonMarkdownBlocks, pythonMarkdownIds, pythonMarkdownSlug, sourceLinks } from "./markdown-dialects.ts";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Data } from "../data.ts";
import { isPlainObject, parseFrontMatter, readText } from "../data.ts";
import { BuildError, Diagnostics, context, messageOf, warn, warning } from "../diagnostics.ts";
import type { MarkdownOptions } from "../markdown-options.ts";
import { describeThrown, settle } from "../modules.ts";
import { comparePaths } from "../paths.ts";
import * as voice from "../voice.ts";
import type { Engines, RenderContext, TemplateEngine } from "./engine.ts";
import { WebAssembly } from "./webassembly.ts";
import type { WasmImports, WasmMemory, WasmModule } from "./webassembly.ts";

export interface Markdown extends TemplateEngine {
	/** `markdown(text)` in a template: the site's options and render hooks (which get no page data), or without the `<p>` when `inline`. */
	html(text: string, inline: boolean): string;
	/** The `ssqch` module's `markdown()`: the site's options, without render hooks. */
	plain(text: string, inline: boolean): string;
	/** `highlight(code, lang)`: highlighted HTML for inside a `<code>`, or `undefined` for a language without a highlighter. */
	highlight(code: string, lang: string): string | undefined;
	/** The highlighting stylesheet. */
	css(): string;
	/** The site's render hooks and containers, and the engines that render them. */
	useHooks(hooks: Map<string, HookTemplate>, engines: Engines): void;
	/**
	 * A generator's file (a redirect page) through the site's `_includes/hooks/<name>.*` template,
	 * with `value` as `<name>` next to the global data, or `undefined` when the site has none.
	 */
	hookFile(name: string, value: unknown, data: Data): string | undefined;
}

/** A render hook or container template from `_includes/hooks/` or `_includes/containers/`. */
export interface HookTemplate {
	/** `_includes/hooks/heading.edge`, for errors. */
	name: string;
	/** The engines it runs through (`.html` ones get `htmlEngine` first). */
	engines: string[];
	body: string;
	/** The file, for includes relative to it. */
	path: string;
}

/**
 * Reads `_includes/hooks/*` and `_includes/containers/*` from `dir`, keyed by `hooks/heading`,
 * `containers/note`. Each name can have one template, in any engine. `name` is how errors name
 * the folder (`_includes`, or `_includes (theme)`).
 */
export function loadHookTemplates(dir: string, name: string, engines: Engines, chain: (ext: string) => string[]): Map<string, HookTemplate> {
	const out = new Map<string, HookTemplate>();
	for (const kind of ["hooks", "containers"]) {
		let files: string[];
		try { files = fs.readdirSync(path.join(dir, kind)); } catch { continue; }
		for (const file of files.sort(comparePaths)) {
			const full = path.join(dir, kind, file);
			if (file.startsWith(".") || !fs.statSync(full, { throwIfNoEntry: false })?.isFile()) continue;
			const dot = file.lastIndexOf(".");
			if (dot <= 0) continue;
			const shown = `${name}/${kind}/${file}`;
			const ext = file.slice(dot + 1).toLowerCase();
			try { engines.get(ext); } catch (e) { throw context(e, shown); }
			const key = `${kind}/${file.slice(0, dot)}`;
			const other = out.get(key);
			if (other) throw new BuildError(`${other.name} and ${shown} are both templates for \`${key}\`; keep one`);
			let src: string;
			try { src = readText(full); } catch (e) { throw context(e, `reading ${shown}`); }
			let body: string;
			try { body = parseFrontMatter(src).body; } catch (e) { throw context(e, shown); }
			out.set(key, { name: shown, engines: chain(ext), body, path: full });
		}
	}
	return out;
}

/**
 * With `markdown.highlight`, writes the highlighting stylesheet to its place in `output` (unless
 * `css` is false), and only when it changed, so a server doesn't see a new file each build.
 * Returns the file, for the build's list of what it wrote.
 */
/**
 * The stylesheet with the class names the site gave its tokens (`highlight: { classes }`), so it
 * colors what the pages have: `.token.keyword` for Prism's, and with Prism's markup, its marked
 * lines (`.highlight-line-active`).
 */
export function cssWithClasses(css: string, classes: MarkdownOptions["highlightClasses"]): string {
	if (!classes) return css;
	let out = css.replace(/^\.hl-([a-z]+) \{/gm, (whole, kind: string) => (classes.names[kind] ? `.${classes.names[kind].split(" ").join(".")} {` : whole));
	if (classes.prism) out = out.replace("pre.highlight .line { display: inline-block; min-width: 100%; }\n", ".highlight-line { display: inline-block; min-width: 100%; }\n").replace("pre.highlight .line.highlighted {", ".highlight-line-active {");
	return out;
}

export function writeHighlightCss(options: MarkdownOptions, output: string, markdown: Markdown): string[] {
	const url = options.highlight ? options.highlightCss : null;
	if (url === null) return [];
	const file = path.join(output, ...url.replace(/^\/+/, "").split("/"));
	const css = cssWithClasses(markdown.css(), options.highlightClasses);
	let before: string | undefined;
	try { before = fs.readFileSync(file, "utf8"); } catch {}
	if (before !== css) {
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, css);
		} catch (e) {
			throw context(e, `writing ${file}`);
		}
	}
	return [file];
}

// ---- the page being rendered ---------------------------------------------------------------

let page: string | undefined;

/**
 * While a page renders, warnings from its Markdown and its `highlight()` calls name it (a site's
 * highlighter that failed). Returns the page named before, to put back.
 */
export function rendering(file: string | undefined): string | undefined {
	const before = page;
	page = file?.replace(/^(\.\/)+/, "");
	return before;
}

// ---- the engine ----------------------------------------------------------------------------

const INLINE = 1;
const HOOKS = 2;

/** ssqch's Markdown with the site's options. `root` is the project root, where grammar files are read from. */
export function markdownEngine(options: MarkdownOptions, root = process.cwd(), input?: string): Markdown {
	return new WasmMarkdown(options, root, input);
}

/**
 * Reads the site's `.sublime-syntax` grammars and checks its highlighters' aliases, as 0.7 did
 * when it read the config: a grammar that isn't there or can't be read, or aliases that go in a
 * circle, are the config's errors.
 */
export function checkLanguages(options: MarkdownOptions, root: string): void {
	if (!options.languages.length) return;
	const engine = new WasmMarkdown(options, root);
	engine.check();
	engine.close();
}

/** One of the config's functions, and how errors name it (`markdown.headingIds`). */
interface SiteFunction {
	fn: (...args: unknown[]) => unknown;
	name: string;
	/** `headingIds`: when it fails, the page fails, so nothing after it is called. */
	slugger: boolean;
}

/** A call the wasm made to a site's function: which, and its arguments as JSON. */
interface Asked {
	n: number;
	args: string;
}

/** What a site's function gave for one call, worked out before the render that uses it. */
type Answer = Asked & ({ value: unknown } | { error: unknown });

class WasmMarkdown implements Markdown {
	#options: MarkdownOptions;
	#root: string;
	/** The input folder, from the root with a `/` after it (`docs/`): where `sourceLinks` finds a relative URL's file in the output. */
	#inputRoot: string | undefined;
	#hooks = new Map<string, HookTemplate>();
	#engines: Engines | undefined;
	/** The config's functions, by the numbers the wasm calls them with. */
	#functions: SiteFunction[] = [];
	#setup: { json: string; files: Map<string, Buffer> } | undefined;
	#handle = -1;
	#wasm: Wasm | undefined;

	constructor(options: MarkdownOptions, root: string, input?: string) {
		this.#options = options;
		this.#root = root;
		if (input !== undefined) {
			const rel = path.relative(root, input).split(path.sep).join("/");
			this.#inputRoot = rel === "" ? "" : rel.startsWith("..") ? undefined : `${rel}/`;
		}
	}

	/**
	 * A page's Markdown. 0.7 waited for a site's function that answered with a promise
	 * (`headingIds: async (text) => id`), but the wasm calls back synchronously. So when the
	 * config has functions, a first render runs nothing of the site's (no hooks, a stand-in for
	 * each function) and notes the calls it makes; each function is then called once, in order,
	 * waiting for each promise as 0.7 did; and the render that counts takes those answers. A
	 * function or a hook never runs twice. Without functions, it's one render.
	 */
	render(source: string, data: Data, _ctx: RenderContext): string | Promise<string> {
		const file = page ?? pageOf(data);
		this.#ready();
		// Python-Markdown's raw HTML blocks are set aside first, before the other dialects write HTML.
		const python = this.#options.dialect === "python-markdown" ? pythonMarkdownBefore(source) : undefined;
		if (python) source = python.source;
		const shortcodes: InlineShortcode[] = [];
		source = this.#dialects(source, shortcodes, data, file);
		const links = this.#options.sourceLinks;
		const ids = this.#options.sluggerFn === pythonMarkdownSlug;
		const after = (html: string) => {
			if (shortcodes.length) html = this.#inlineShortcodes(html, shortcodes, data, file);
			if (links) html = sourceLinks(html, data, links, this.#inputRoot);
			if (ids) html = pythonMarkdownIds(html);
			return python ? pythonMarkdownAfter(html, python.raw) : html;
		};
		const changes = Boolean(links || ids || python || shortcodes.length);
		if (!this.#options.htmlMarkdown) {
			const out = this.#page(source, data, file);
			if (!changes) return out;
			return typeof out === "string" ? after(out) : out.then(after);
		}
		// The blank lines kept inside `<pre>` in `markdown="1"` blocks come back last.
		const out = this.#page(this.#inHtml(source, HOOKS, data, file), data, file);
		return typeof out === "string" ? after(restoreBlankLines(out)) : out.then((html) => after(restoreBlankLines(html)));
	}

	/** Other generators' syntax as ssqch's (markdown-dialects.ts): Hugo's shortcodes as containers, MkDocs' blocks as Python-Markdown's HTML. */
	#dialects(source: string, inline?: InlineShortcode[], data: Data = {}, file: string | undefined = page): string {
		const o = this.#options;
		if (o.shortcodes === "hugo") source = hugoShortcodes(source, inline, (name) => this.#hooks.has(`containers/${name}`));
		// A title is inline Markdown, as Python-Markdown reads it: `!!! tip "Run \`ssqch\`"`.
		const title = (text: string, refs: string) => this.#markdown(refs ? `${text}\n\n${refs}` : text, HOOKS | INLINE, data, file, undefined, "an admonition's or a tab's title");
		if (o.admonitions || o.tabs) source = pythonMarkdownBlocks(source, { admonitions: o.admonitions === "mkdocs", tabs: o.tabs === "mkdocs", title });
		return source;
	}

	/**
	 * Hugo's shortcodes inside a line of text, each through its container template, in place of
	 * the marker `#dialects` left: `container.content` is what's between its tags as inline
	 * Markdown (its own shortcodes too) and `container.source` that as written, and
	 * `container.inline` is true. What the template writes goes in as it is, as Hugo puts in a
	 * `{{< >}}` shortcode's output.
	 */
	#inlineShortcodes(html: string, calls: InlineShortcode[], data: Data, file: string | undefined): string {
		return html.replace(INLINE_SHORTCODE_MARKER, (whole, plain?: string, encoded?: string) => {
			const call = calls[inlineShortcodeNumber(plain, encoded)];
			if (!call) return whole;
			let content = "";
			if (call.inner !== undefined) {
				const inner: InlineShortcode[] = [];
				const text = hugoShortcodes(call.inner, inner, (name) => this.#hooks.has(`containers/${name}`));
				content = this.#markdown(text, HOOKS | INLINE, data, file, undefined, `the inside of {{< ${call.name} >}}`);
				if (inner.length) content = this.#inlineShortcodes(content, inner, data, file);
			}
			const out = this.renderHook(`containers/${call.name}`, "container", { name: call.name, args: call.args, content, source: call.inner ?? "", inline: true }, data);
			return call.spaces ? call.spaces[0] + out + call.spaces[1] : out;
		});
	}

	#page(source: string, data: Data, file: string | undefined): string | Promise<string> {
		if (!this.#functions.length) return this.#markdown(source, HOOKS, data, file);
		let asked: Asked[];
		try {
			asked = this.#dryRun(source, file);
		} catch {
			// The render that counts says what's wrong.
			return this.#markdown(source, HOOKS, data, file);
		}
		return this.#answer(asked, (answers) => this.#markdown(source, HOOKS, data, file, answers));
	}

	html(text: string, inline: boolean): string {
		const shortcodes: InlineShortcode[] = [];
		if (!inline) text = this.#dialects(text, shortcodes);
		const html = this.#options.htmlMarkdown
			? restoreBlankLines(this.#markdown(this.#inHtml(text, HOOKS, {}, page, "markdown() in a template"), HOOKS | (inline ? INLINE : 0), {}, page, undefined, "markdown() in a template"))
			: this.#markdown(text, HOOKS | (inline ? INLINE : 0), {}, page, undefined, "markdown() in a template");
		return shortcodes.length ? this.#inlineShortcodes(html, shortcodes, {}, page) : html;
	}

	plain(text: string, inline: boolean): string {
		if (this.#options.htmlMarkdown) return restoreBlankLines(this.#markdown(this.#inHtml(text, 0, {}, page, "markdown() from \"ssqch\""), inline ? INLINE : 0, {}, page, undefined, "markdown() from \"ssqch\""));
		return this.#markdown(text, inline ? INLINE : 0, {}, page, undefined, "markdown() from \"ssqch\"");
	}

	/** `markdown="1"` elements' content rendered, with kramdown's HTML rules (`htmlMarkdown: "kramdown"`). */
	#inHtml(source: string, flags: number, data: Data, file: string | undefined, what = "this Markdown"): string {
		const kramdownIds = this.#options.headingIds === "kramdown";
		const seen = new Map<string, number>();
		return kramdownHtml(source, {
			block: (text) => {
				const html = this.#markdown(text, flags, data, file, undefined, what);
				return kramdownIds ? withKramdownIds(html, text, seen) : html;
			},
			span: (text) => this.#markdown(text, flags | INLINE, data, file, undefined, what),
		});
	}

	highlight(code: string, lang: string): string | undefined {
		const wasm = this.#ready();
		const [ptr, lens] = wasm.input([code, lang, page ?? ""]);
		const frame = wasm.frame(this, {});
		const [status, text, thrown] = wasm.run(frame, () => wasm.x.md_highlight(this.#handle, ptr, lens[0], lens[1], lens[2]), page);
		this.#waited(frame, "highlight() in a template");
		if (status === NOTHING) return undefined;
		if (status !== DONE) throw failure(text, thrown);
		return text;
	}

	css(): string {
		const wasm = this.#ready();
		const [status, text] = wasm.run(wasm.frame(this, {}), () => wasm.x.md_css(), undefined);
		return status === DONE ? text : "";
	}

	useHooks(hooks: Map<string, HookTemplate>, engines: Engines): void {
		const own = hooks.get("containers/slot");
		if (own) throw new BuildError(`${own.name}: \`slot\` is ssqch's container for a named slot (\`::: slot footer\` inside another container is its \`container.slots.footer\`), so it can't have a template. Rename the container`);
		this.#hooks = hooks;
		this.#engines = engines;
		// The wasm learns the hooks' names when it sets up.
		this.close();
		this.#setup = undefined;
	}

	/** Sets up now, so that what's wrong with the options is said now. */
	check(): void {
		this.#ready();
	}

	/** For tests: a render that makes the wasm read past its memory, as a bug in it would. */
	crash(file: string): void {
		const wasm = this.#ready();
		wasm.run(wasm.frame(this, {}), () => wasm.x.md_render(this.#handle, 0xffffff00, 16, 0, 0), file);
	}

	/** Lets the wasm forget this setup. */
	close(): void {
		if (this.#wasm && this.#handle >= 0 && !this.#wasm.dead) this.#wasm.x.md_drop(this.#handle);
		handles.unregister(this);
		this.#handle = -1;
		this.#wasm = undefined;
	}

	/**
	 * One render. `answers` are what the site's functions gave, worked out before it; without
	 * them they're called as the wasm asks, and one that answers with a promise is an error for
	 * `what` (Markdown that's made at once, inside a template, can't wait for it).
	 */
	#markdown(source: string, flags: number, data: Data, file: string | undefined, answers?: Answer[], what = "this Markdown"): string {
		const wasm = this.#ready();
		const [ptr, lens] = wasm.input([source, file ?? ""]);
		const frame = wasm.frame(this, data);
		frame.answers = answers;
		const [status, text, thrown] = wasm.run(frame, () => wasm.x.md_render(this.#handle, ptr, lens[0], lens[1], flags), file);
		this.#waited(frame, what);
		if (status !== DONE) throw failure(text, thrown);
		return putBackSlots(text);
	}

	/** A render that runs nothing of the site's: the calls to its functions it would make, in order. */
	#dryRun(source: string, file: string | undefined): Asked[] {
		const wasm = this.#ready();
		const [ptr, lens] = wasm.input([source, file ?? ""]);
		const frame = wasm.frame(this, {});
		frame.asked = [];
		const [status, text] = wasm.run(frame, () => wasm.x.md_render(this.#handle, ptr, lens[0], lens[1], 0), file);
		if (status !== DONE) throw new BuildError(text);
		return frame.asked;
	}

	/**
	 * Calls the site's functions as a render will, one at a time, waiting for each promise
	 * before the next call, as 0.7 did; then `then` with what they gave. At once while nothing
	 * answers with a promise. After `headingIds` fails nothing more is called: the render
	 * stops there.
	 */
	#answer<T>(asked: Asked[], then: (answers: Answer[]) => T): T | Promise<T> {
		const answers: Answer[] = [];
		const from = (i: number): T | Promise<T> => {
			for (; i < asked.length; i++) {
				const call = asked[i];
				const site = this.#functions[call.n];
				let out: unknown;
				try {
					out = site.fn(...(JSON.parse(call.args) as unknown[]));
				} catch (error) {
					answers.push({ ...call, error });
					if (site.slugger) break;
					continue;
				}
				if (isThenable(out)) {
					const waited = settle(Promise.resolve(out)) as Promise<unknown>;
					return waited.then(
						(value: unknown) => { answers.push({ ...call, value }); return from(i + 1); },
						(error: unknown) => { answers.push({ ...call, error }); return site.slugger ? then(answers) : from(i + 1); },
					);
				}
				answers.push({ ...call, value: out });
			}
			return then(answers);
		};
		return from(0);
	}

	/** After a render without answers: a function that answered with a promise is an error for `what`. */
	#waited(frame: Frame, what: string): void {
		if (frame.waited === undefined) return;
		throw new BuildError(`${frame.waited} answered with a promise, and ${what} can't wait for one: it's made at once, while the template around it renders. Make the function synchronous (a page's own Markdown waits for it)`);
	}

	/** The wasm, with this setup made in it. */
	#ready(): Wasm {
		const wasm = instance();
		if (this.#wasm === wasm && this.#handle >= 0) return wasm;
		// A new instance (the first, or one after a panic) needs the setup made again.
		this.close();
		this.#setup ??= this.#describe();
		wasm.files = this.#setup.files;
		const [ptr, [len]] = wasm.input([this.#setup.json]);
		let handle: number;
		try {
			[handle] = wasm.run(wasm.frame(this, {}), () => wasm.x.md_new(ptr, len), "markdown options");
		} finally {
			wasm.files = new Map();
		}
		if (handle < 0) throw new BuildError(wasm.result());
		this.#wasm = wasm;
		this.#handle = handle;
		handles.register(this, { wasm, handle }, this);
		return wasm;
	}

	/** The options as the wasm reads them (`crates/ssqch-markdown/src/options.rs`), and the grammar files it reads. */
	#describe(): { json: string; files: Map<string, Buffer> } {
		const o = this.#options;
		this.#functions = [];
		const number = (fn: (...args: unknown[]) => unknown, name: string, slugger = false) => this.#functions.push({ fn, name, slugger }) - 1;
		const files = new Map<string, Buffer>();
		// The same languages and grammars make the same key: their fences are shared between builds.
		const key: unknown[] = [];
		const languages = o.languages.map(([name, language]) => {
			if (typeof language === "function") {
				key.push([name]);
				return [name, { function: number(language as (...args: unknown[]) => unknown, `markdown.highlight.languages.${name}`) }];
			}
			if ("alias" in language) {
				key.push([name, language.alias]);
				return [name, { alias: language.alias }];
			}
			const text = readGrammar(this.#root, name, language.grammar);
			files.set(wasmPath(language.grammar), text);
			key.push([name, language.grammar, crypto.createHash("sha256").update(text).digest("hex")]);
			return [name, { grammar: language.grammar }];
		});
		const json = JSON.stringify({
			// kramdown's GFM ids for the page's own headings; the ones inside `markdown="1"` HTML get kramdown's own after (kramdown-html.ts).
			headingIds: o.headingIds,
			headingAttributes: o.headingAttributes,
			footnotes: o.footnotes,
			taskLists: o.taskLists,
			autolinks: o.autolinks,
			breaks: o.breaks,
			figures: o.figures,
			alerts: o.alerts,
			containers: o.containers,
			definitionLists: o.definitionLists,
			smartPunctuation: o.smartPunctuation,
			indentedCode: o.indentedCode,
			encodeUrls: o.encodeUrls,
			highlight: o.highlight,
			highlightCss: o.highlightCss,
			highlightClasses: o.highlightClasses,
			languages,
			headingIdsFunction: o.sluggerFn ? number(o.sluggerFn as (...args: unknown[]) => unknown, "markdown.headingIds", true) : null,
			// `slot` is ssqch's container: it always calls back, to be kept for its parent.
			hooks: [...this.#hooks.keys(), "containers/slot"],
			languagesKey: JSON.stringify(key),
		});
		return { json, files };
	}

	hookFile(name: string, value: unknown, data: Data): string | undefined {
		// 0.7's `render_hook`: `hooks/redirect`, with the value in the data as `redirect`.
		return this.#hooks.has(`hooks/${name}`) ? this.renderHook(`hooks/${name}`, name, value, data) : undefined;
	}

	/** A render hook for the wasm: the template `name` with the page's data and `value` as `key`. */
	renderHook(name: string, key: string, value: unknown, data: Data): string {
		if (key === "container" && isPlainObject(value)) {
			if (name === "containers/slot") return keepSlot(value);
			const own: Data = { ...value, props: containerProps(value.args) };
			own.slots = takeSlots(own);
			value = own;
		}
		const template = this.#hooks.get(name);
		const engines = this.#engines;
		if (!template || !engines) throw new BuildError(`no template for \`${name}\``);
		const hookData: Data = { ...(isPlainObject(data) ? data : {}), [key]: value };
		let text = template.body;
		for (const name of template.engines) {
			const engine = engines.get(name);
			const ctx: RenderContext = { name: template.name, inputPath: template.path, cacheKey: `${template.name}#${name}`, kind: "hook" };
			let out: string | Promise<string>;
			try { out = engine.render(text, hookData, ctx); } catch (e) { throw context(e, `rendering ${template.name}`); }
			if (typeof out !== "string") {
				out.catch(() => {});
				throw new BuildError(`rendering ${template.name}: it answered with a promise (from an async filter, function or engine), and render hooks and containers can't wait for one: they render while the Markdown around them does. Make what it calls synchronous`);
			}
			text = out;
		}
		return text;
	}

	/** One of the config's functions, for the wasm: called, answered from `frame`'s answers, or (a dry run) noted and stood in for. */
	call(n: number, args: string, frame: Frame): unknown {
		const site = this.#functions[n];
		if (!site) throw new BuildError(`no function ${n}`);
		if (frame.asked) {
			frame.asked.push({ n, args });
			return standIn(site, args);
		}
		const answer = frame.answers?.[frame.next];
		if (answer && answer.n === n && answer.args === args) {
			frame.next++;
			if ("error" in answer) throw answer.error;
			return answer.value;
		}
		const out = site.fn(...(JSON.parse(args) as unknown[]));
		if (isThenable(out)) {
			// It can't be waited for here: the render finishes with a stand-in, and then fails.
			Promise.resolve(out).catch(() => {});
			frame.waited ??= site.name;
			return standIn(site, args);
		}
		return out;
	}

	/** What a function threw, as 0.7 said it: the message and the site's frames. */
	thrown(e: unknown): string {
		return describeThrown(e, this.#root);
	}
}

// ---- container props and named slots ---------------------------------------------------------

/**
 * A container's arguments as props, as a component's attributes read: `type="tip" title='Hot
 * pine cones' open` is `{ type: "tip", title: "Hot pine cones", open: true }`. A value in single
 * quotes that starts with `{` or `[` is read as JSON (`items='["a","b"]'`), as MDX's
 * `items={["a","b"]}` would be; unquoted, `size=3` is the text `3`. Words that aren't `name=` are
 * `true`. Nothing is refused: `container.args` still has the line as written.
 */
export function containerProps(args: unknown): Data {
	const props: Data = {};
	for (const [, name, dq, sq, bare] of String(args ?? "").matchAll(/([A-Za-z_][\w-]*)(?:="([^"]*)"|='([^']*)'|=([^\s"']+))?/g)) {
		if (dq !== undefined) props[name] = dq;
		else if (sq !== undefined) {
			if (/^\s*[{[]/.test(sq)) { try { props[name] = JSON.parse(sq); continue; } catch { /* the text as it is */ } }
			props[name] = sq;
		} else if (bare !== undefined) props[name] = bare;
		else props[name] = true;
	}
	return props;
}

/** Slots rendered and not yet taken by their parent, by the number in their marker. */
const slots = new Map<number, { name: string; content: string }>();
let slotCount = 0;
/** Where a slot stands in its parent's content until the parent takes it: private-use characters no Markdown makes. */
const SLOT = /\uE000slot(\d+)\uE001\n?/g;

/** `::: slot footer` (or `name="footer"`): kept for the container around it, which gets it as `container.slots.footer`. */
function keepSlot(value: Data): string {
	const props = containerProps(value.args);
	const name = typeof props.name === "string" ? props.name : String(value.args ?? "").trim().split(/\s+/)[0] || "default";
	const n = slotCount++;
	slots.set(n, { name, content: String(value.content ?? "") });
	return `\uE000slot${n}\uE001`;
}

/** The slots in a container's content, taken out of it: `{ footer: "<p>…</p>" }`. */
function takeSlots(value: Data): Data {
	const found: Data = {};
	if (typeof value.content !== "string" || !value.content.includes("\uE000slot")) return found;
	value.content = value.content.replace(SLOT, (_, n) => {
		const slot = slots.get(Number(n));
		slots.delete(Number(n));
		if (slot) found[slot.name] = String(found[slot.name] ?? "") + slot.content;
		return "";
	});
	return found;
}

/** A slot with no container template around it to take it renders where it is, as its content. */
function putBackSlots(html: string): string {
	if (!html.includes("\uE000slot")) return html;
	return html.replace(SLOT, (_, n) => {
		const slot = slots.get(Number(n));
		slots.delete(Number(n));
		return slot?.content ?? "";
	});
}

/** For tests: what a crash in the wasm (a panic, a bad read) throws while it renders `file`. */
export function crashForTest(markdown: Markdown, file: string): void {
	(markdown as WasmMarkdown).crash(file);
}

/** Lets the wasm forget a setup whose engine is gone (each build makes one). */
const handles = new FinalizationRegistry<{ wasm: Wasm; handle: number }>(({ wasm, handle }) => {
	if (!wasm.dead) wasm.x.md_drop(handle);
});

/** The page `data` belongs to, from the project root. */
function pageOf(data: Data): string | undefined {
	const input = isPlainObject(data) && isPlainObject(data.page) ? data.page.inputPath : undefined;
	return typeof input === "string" ? input.replace(/^(\.\/)+/, "") : undefined;
}

/** The error a call ended with: what a hook or function threw, kept as it was when the wasm passed it on unchanged. */
function failure(message: string, thrown: unknown): Error {
	if (thrown !== undefined && (thrown instanceof BuildError || thrown instanceof Diagnostics)) {
		const inner = messageOf(thrown);
		if (message === inner) return thrown;
		if (message.endsWith(`: ${inner}`)) return context(thrown, message.slice(0, -inner.length - 2));
	}
	return new BuildError(message);
}

/** A grammar file, from the project root, or the error 0.7 gave for one it couldn't read. */
function readGrammar(root: string, name: string, file: string): Buffer {
	try {
		return fs.readFileSync(path.resolve(root, file));
	} catch (e) {
		throw new BuildError(`markdown.highlight.languages.${name}: reading ${file}: ${ioError(e)}`);
	}
}

/** A file system error in Rust's words, as 0.7 printed it. */
function ioError(e: unknown): string {
	const code = (e as NodeJS.ErrnoException).code;
	if (code === "ENOENT") return process.platform === "win32" ? "The system cannot find the file specified. (os error 2)" : "No such file or directory (os error 2)";
	if (code === "EISDIR") return "Is a directory (os error 21)";
	if (code === "EACCES") return process.platform === "win32" ? "Access is denied. (os error 5)" : "Permission denied (os error 13)";
	return messageOf(e);
}

/** A grammar's path as the wasm asks for it: from `/`, its root. */
function wasmPath(file: string): string {
	return path.posix.normalize(file.replace(/^\/+/, ""));
}

// ---- the instance --------------------------------------------------------------------------

const DONE = 0;
const ERROR = 1;
const NOTHING = 2;

interface Exports {
	memory: WasmMemory;
	_initialize(): void;
	md_alloc(len: number): number;
	md_free(ptr: number, len: number): void;
	md_result_ptr(): number;
	md_result_len(): number;
	md_panic(): number;
	md_new(ptr: number, len: number): number;
	md_drop(handle: number): void;
	md_render(handle: number, ptr: number, sourceLen: number, pageLen: number, flags: number): number;
	md_highlight(handle: number, ptr: number, codeLen: number, langLen: number, pageLen: number): number;
	md_css(): number;
	md_fences_begin(ptr: number, versionLen: number, fileLen: number, flags: number): number;
	md_fences_save(ptr: number, len: number): number;
}

/** The file, next to `src/`. */
const WASM_FILE = fileURLToPath(new URL("../../wasm/markdown.wasm", import.meta.url));

let compiled: WasmModule | undefined;
let current: Wasm | undefined;

function instance(): Wasm {
	if (!current) {
		if (!compiled) {
			let bytes: Buffer;
			try { bytes = fs.readFileSync(WASM_FILE); } catch (e) { throw new BuildError(`ssqch's Markdown isn't there (${WASM_FILE}: ${messageOf(e)}); build it with node packages/ssqch/scripts/build-wasm.ts`); }
			compiled = new WebAssembly.Module(bytes);
			highlighter = highlighterOf(compiled, bytes);
		}
		current = new Wasm(compiled);
		// A new instance in a build (the first, or one after a panic) takes in the disk's fences.
		if (disk?.open) giveFences(current, disk);
	}
	return current;
}

// ---- the cache of highlighted fences -------------------------------------------------------
//
// A process's first build of the blog spent about 0.3 s loading syntect's grammars, the set of
// them and then each grammar's patterns the first time a fence used it: most of what its Markdown
// cost. So the fences a build highlighted are kept on disk for the next process, and a build
// whose fences are all there never loads a grammar. `ssqch serve`'s builder keeps them in memory
// between its builds already; the file is for its first build, and for `ssqch build`.
//
// - **One file per site,** not one per fence: the blog's 180 fences are one read and one parse in
//   the wasm (a few milliseconds), where a file each is a read each, and a site with thousands
//   of fences would spend more opening files than the grammars cost. The wasm reads and writes
//   it (`crates/ssqch-markdown/src/highlight.rs` has its shape), so the fences cross into it
//   once, as one text.
// - **The key** is a fence's language, code and marked lines (`{2,4}`), with the site's
//   languages (`languagesKey` below: names, aliases and each grammar's hash, so editing a
//   `.sublime-syntax` file is another key). That's all the HTML depends on: the classes are
//   fixed (`hl-*`), and `highlight.css` is a stylesheet, not part of a fence. A fence a site's
//   own highlighter handles (a function in `markdown.highlight.languages`) isn't ssqch's to keep:
//   it runs every time, in memory too.
// - **The highlighter's version** is the hash of what the `.wasm` is built from
//   (`scripts/wasm-inputs.ts`, which the build puts in the file), not a version number someone
//   has to remember to change: any change to the Rust, a crate or the lockfile is a new
//   highlighter, and a file from another one is ignored. A `.wasm` built without the script
//   uses the hash of its own bytes.
// - **Written only when it changes,** with the fences this build used and no others, so the file
//   doesn't grow as posts change, and a build with nothing new writes nothing. It's written
//   beside its place and renamed in, as `fetch`'s cache is, so a build reading it at the same
//   moment never sees half of it; half a file, another highlighter's file, or one that isn't
//   JSON, is ignored (and written again), never an error. A build that fails writes nothing.
// - It's a cache like the others in `.cache/ssqch/`: `leaveNoTrace` cleans the output, not
//   `.cache`, and deleting the folder (or the file) only means highlighting again. The cache
//   never changes a page: the HTML in it is the highlighter's own, for the same input.

/** The cache's file, from the project root. */
export const FENCE_CACHE = ".cache/ssqch/highlight/fences.json";

/** The highlighter's version, from the compiled `.wasm`. */
let highlighter = "";

/** The disk as this process knows it: the file, its text (empty when there's none), and the instance that took it in. */
interface Disk {
	file: string;
	text: string;
	given: Wasm | undefined;
	/** A build is running with it. */
	open: boolean;
}

let disk: Disk | undefined;

function highlighterOf(module: WasmModule, bytes: Buffer): string {
	const sections = WebAssembly.Module.customSections(module, "ssqch_markdown_inputs");
	const hash = sections.length ? Buffer.from(sections[sections.length - 1]).toString("utf8") : "";
	return /^[0-9a-f]{64}$/.test(hash) ? hash : `bytes ${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * A build of the site at `root` starts: the next highlighted fences are counted as its own, and
 * the wasm takes in the file when it hasn't (now, or when the first Markdown starts it).
 */
export function beginFenceCache(root: string): void {
	const file = path.join(root, FENCE_CACHE);
	if (disk?.file !== file) {
		let text = "";
		try { text = fs.readFileSync(file, "utf8"); } catch { /* none yet */ }
		disk = { file, text, given: undefined, open: true };
	}
	disk.open = true;
	if (current) giveFences(current, disk);
}

function giveFences(wasm: Wasm, d: Disk): void {
	const fresh = d.given !== wasm;
	const [ptr, lens] = wasm.input([highlighter, fresh ? d.text : ""]);
	wasm.run(wasm.frame(undefined as never, {}), () => wasm.x.md_fences_begin(ptr, lens[0], lens[1], fresh ? 1 : 0), "the cache of highlighted fences");
	d.given = wasm;
}

/**
 * A build finished: the file gets the fences it used, when they aren't what it has. Nothing for
 * a build that never started the wasm. A cache that can't be written is left as it is: it only
 * costs time.
 */
export function saveFenceCache(): void {
	const d = disk;
	if (!d?.open) return;
	d.open = false;
	const wasm = current;
	if (!wasm || d.given !== wasm) return;
	const [ptr, [len]] = wasm.input([highlighter]);
	const [status, text] = wasm.run(wasm.frame(undefined as never, {}), () => wasm.x.md_fences_save(ptr, len), "the cache of highlighted fences");
	if (status !== DONE) return;
	try {
		if (text === "") {
			fs.rmSync(d.file, { force: true });
		} else {
			fs.mkdirSync(path.dirname(d.file), { recursive: true });
			const temp = `${d.file.replace(/\.json$/, "")}.${process.pid}.tmp`;
			try {
				fs.writeFileSync(temp, text);
				fs.renameSync(temp, d.file);
			} catch (e) {
				fs.rmSync(temp, { force: true });
				throw e;
			}
		}
		d.text = text;
	} catch {
		// The next build tries again: the wasm can't know the disk refused, so it's told to look afresh.
		d.given = undefined;
	}
}

/** A call in progress: whose it is, the data its hooks get, and what a hook or function threw in it. */
interface Frame {
	owner: WasmMarkdown;
	data: Data;
	thrown?: unknown;
	/** A dry run's: the calls to the site's functions, noted instead of made. */
	asked?: Asked[];
	/** What the site's functions gave, in the order the render asks, and how many it has taken. */
	answers?: Answer[];
	next: number;
	/** The function that answered with a promise, when nothing could wait for it. */
	waited?: string;
}

const WASI_EBADF = 8;
const WASI_ENOENT = 44;
const WASI_ENOSYS = 52;
/** The one folder the wasm can open files in: `/`, holding the files Node gives it. */
const ROOT_FD = 3;

class Wasm {
	x: Exports;
	/** Set by a trap (a panic in the Rust): this instance is done, and the next call starts another. */
	dead = false;
	/** Files the wasm can read while it sets up (a site's grammars), by their paths from `/`. */
	files = new Map<string, Buffer>();
	#open = new Map<number, { data: Buffer; at: number }>();
	#nextFd = ROOT_FD + 1;
	#frames: Frame[] = [];
	#bytes = Buffer.alloc(0);

	constructor(module: WasmModule) {
		const wasi = this.#wasi();
		const imports: WasmImports = {
			// Anything else std might ask for isn't there.
			wasi_snapshot_preview1: new Proxy(wasi, { get: (target, name: string) => target[name] ?? (() => WASI_ENOSYS) }),
			ssqch: this.#host(),
		};
		this.x = new WebAssembly.Instance(module, imports).exports as unknown as Exports;
		this.x._initialize();
	}

	/** The wasm's memory as a Buffer (a new one after the memory grows). */
	bytes(): Buffer {
		const buffer = this.x.memory.buffer;
		if (this.#bytes.buffer !== buffer) this.#bytes = Buffer.from(buffer);
		return this.#bytes;
	}

	/** Copies strings into one buffer the wasm takes: its address, and each string's length in bytes. */
	input(parts: string[]): [number, number[]] {
		const lens = parts.map((part) => Buffer.byteLength(part, "utf8"));
		const ptr = this.x.md_alloc(lens.reduce((sum, n) => sum + n, 0));
		const bytes = this.bytes();
		let at = ptr;
		parts.forEach((part, i) => { at += bytes.write(part, at, lens[i], "utf8"); });
		return [ptr, lens];
	}

	result(): string {
		const ptr = this.x.md_result_ptr();
		return this.bytes().toString("utf8", ptr, ptr + this.x.md_result_len());
	}

	/** Makes a call for `owner`, whose hooks get `data`: its status, its result, and what a call back threw. */
	/** A call for `owner`, whose hooks get `data`. */
	frame(owner: WasmMarkdown, data: Data): Frame {
		return { owner, data, next: 0 };
	}

	/** Makes a call in `frame`: its status, its result, and what a call back threw. `what` names the page (or the setup) if the wasm crashes. */
	run(frame: Frame, call: () => number, what: string | undefined): [number, string, unknown] {
		if (this.dead) throw internal("its WebAssembly stopped", what);
		this.#frames.push(frame);
		try {
			const status = call();
			if (this.dead) throw internal("its WebAssembly stopped", what);
			return [status, this.result(), frame.thrown];
		} catch (e) {
			if (e instanceof WebAssembly.RuntimeError) throw this.#trapped(e, what);
			// Anything else that came out through the wasm (a stack overflow) left it in a state
			// nothing can rely on.
			this.#stop();
			throw e;
		} finally {
			this.#frames.pop();
		}
	}

	#stop(): void {
		this.dead = true;
		if (current === this) current = undefined;
	}

	#trapped(e: Error, what: string | undefined): Error {
		this.#stop();
		let message = "";
		try {
			this.x.md_panic();
			message = this.result();
		} catch {}
		return internal(message || `it crashed (${e.message})`, what);
	}

	/** Leaves Node's answer to a call back where the wasm reads it. */
	#reply(out: number, status: number, text: string): number {
		const len = Buffer.byteLength(text, "utf8");
		const ptr = this.x.md_alloc(len);
		const bytes = this.bytes();
		bytes.write(text, ptr, len, "utf8");
		bytes.writeUInt32LE(ptr, out);
		bytes.writeUInt32LE(len, out + 4);
		return status;
	}

	#text(ptr: number, len: number): string {
		return this.bytes().toString("utf8", ptr, ptr + len);
	}

	/** What the wasm calls: nothing here may throw into it, so every answer is a status. */
	#host(): Record<string, unknown> {
		return {
			hook: (namePtr: number, nameLen: number, keyPtr: number, keyLen: number, valuePtr: number, valueLen: number, out: number) => {
				const frame = this.#frames[this.#frames.length - 1];
				try {
					const value = JSON.parse(this.#text(valuePtr, valueLen));
					return this.#reply(out, DONE, frame.owner.renderHook(this.#text(namePtr, nameLen), this.#text(keyPtr, keyLen), value, frame.data));
				} catch (e) {
					frame.thrown = e;
					return this.#reply(out, ERROR, messageOf(e));
				}
			},
			call: (n: number, argsPtr: number, argsLen: number, out: number) => {
				const frame = this.#frames[this.#frames.length - 1];
				try {
					return this.#reply(out, DONE, toWasm(frame.owner.call(n, this.#text(argsPtr, argsLen), frame)));
				} catch (e) {
					frame.thrown = e;
					return this.#reply(out, ERROR, frame.owner.thrown(e));
				}
			},
			warn: (codePtr: number, codeLen: number, messagePtr: number, messageLen: number, filePtr: number, fileLen: number) => {
				try {
					// A dry run's warnings are the real render's to give.
					if (this.#frames[this.#frames.length - 1]?.asked) return;
					const file = this.#text(filePtr, fileLen);
					warn(warning(this.#text(codePtr, codeLen), this.#text(messagePtr, messageLen), file === "" ? {} : { file }));
				} catch {}
			},
		};
	}

	/**
	 * The calls Rust's std makes on `wasm32-wasip1`: no environment, real clocks, a fixed-seed
	 * random generator (a `HashMap`'s order then repeats), standard error for a stray print, and
	 * one folder, `/`, holding only the files Node gives it.
	 */
	#wasi(): Record<string, (...args: any[]) => number> {
		const view = () => new DataView(this.x.memory.buffer);
		let seed = 0x5eed5ca7c4edf007n;
		const mask = (1n << 64n) - 1n;
		return {
			environ_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
			environ_get: () => 0,
			args_sizes_get: (count: number, size: number) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
			args_get: () => 0,
			clock_time_get: (id: number, _precision: bigint, out: number) => {
				view().setBigUint64(out, id === 0 ? BigInt(Date.now()) * 1000000n : process.hrtime.bigint(), true);
				return 0;
			},
			random_get: (ptr: number, len: number) => {
				const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
				for (let at = 0; at < len; at += 8) {
					// xorshift64*
					seed ^= seed >> 12n;
					seed = (seed ^ (seed << 25n)) & mask;
					seed ^= seed >> 27n;
					let v = (seed * 0x2545f4914f6cdd1dn) & mask;
					for (let i = 0; i < 8 && at + i < len; i++) {
						bytes[at + i] = Number(v & 0xffn);
						v >>= 8n;
					}
				}
				return 0;
			},
			fd_write: (fd: number, iovs: number, count: number, written: number) => {
				const v = view();
				let total = 0;
				for (let i = 0; i < count; i++) {
					const ptr = v.getUint32(iovs + i * 8, true);
					const len = v.getUint32(iovs + i * 8 + 4, true);
					if (fd === 1 || fd === 2) process.stderr.write(new Uint8Array(this.x.memory.buffer, ptr, len).slice());
					total += len;
				}
				v.setUint32(written, total, true);
				return 0;
			},
			fd_prestat_get: (fd: number, out: number) => {
				if (fd !== ROOT_FD) return WASI_EBADF;
				view().setUint8(out, 0);
				view().setUint32(out + 4, 1, true);
				return 0;
			},
			fd_prestat_dir_name: (fd: number, ptr: number, len: number) => {
				if (fd !== ROOT_FD || len < 1) return WASI_EBADF;
				view().setUint8(ptr, "/".charCodeAt(0));
				return 0;
			},
			fd_fdstat_get: (fd: number, out: number) => {
				const filetype = fd === ROOT_FD ? 3 : this.#open.has(fd) ? 4 : fd <= 2 ? 2 : -1;
				if (filetype < 0) return WASI_EBADF;
				const v = view();
				v.setUint8(out, filetype);
				v.setUint16(out + 2, 0, true);
				v.setBigUint64(out + 8, mask, true);
				v.setBigUint64(out + 16, mask, true);
				return 0;
			},
			fd_filestat_get: (fd: number, out: number) => {
				const file = this.#open.get(fd);
				if (!file) return WASI_EBADF;
				new Uint8Array(this.x.memory.buffer, out, 64).fill(0);
				view().setUint8(out + 16, 4);
				view().setBigUint64(out + 32, BigInt(file.data.length), true);
				return 0;
			},
			path_open: (dirfd: number, _dirflags: number, ptr: number, len: number, _oflags: number, _base: bigint, _inheriting: bigint, _fdflags: number, out: number) => {
				if (dirfd !== ROOT_FD) return WASI_EBADF;
				const data = this.files.get(wasmPath(this.#text(ptr, len)));
				if (!data) return WASI_ENOENT;
				const fd = this.#nextFd++;
				this.#open.set(fd, { data, at: 0 });
				view().setUint32(out, fd, true);
				return 0;
			},
			fd_read: (fd: number, iovs: number, count: number, read: number) => {
				const file = this.#open.get(fd);
				if (!file) return WASI_EBADF;
				const v = view();
				let total = 0;
				for (let i = 0; i < count && file.at < file.data.length; i++) {
					const ptr = v.getUint32(iovs + i * 8, true);
					const len = v.getUint32(iovs + i * 8 + 4, true);
					const n = file.data.copy(this.bytes(), ptr, file.at, Math.min(file.at + len, file.data.length));
					file.at += n;
					total += n;
				}
				v.setUint32(read, total, true);
				return 0;
			},
			fd_close: (fd: number) => (this.#open.delete(fd) || fd === ROOT_FD ? 0 : WASI_EBADF),
			proc_exit: (code: number) => { throw new Error(`exited with ${code}`); },
		};
	}
}

/** A panic in the Rust: a bug in ssqch, said as 0.7 said one (with the panic's message). */
function internal(message: string, what: string | undefined): BuildError {
	return new BuildError(`${voice.SOMETHING_LARGE}: internal error while processing ${what ?? page ?? "Markdown"}: ${message} (this is a bug in ssqch; please report it at ${voice.ISSUES_URL})`);
}

/** What a dry run gives the wasm for a call it notes: an id of nothing, or the code as plain text. */
function standIn(site: SiteFunction, args: string): unknown {
	if (site.slugger) return "";
	const [code] = JSON.parse(args) as unknown[];
	return [[String(code)]];
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => (typeof v === "object" || typeof v === "function") && v !== null && typeof (v as PromiseLike<unknown>).then === "function";

// What JSON loses that 0.7's messages name (`returned undefined, not a list of tokens`), marked
// as `crates/ssqch-markdown/src/json.rs` reads it.
const UNDEFINED = { "\0": "undefined" };
const FUNCTION = { "\0": "function" };

/** A value from a site's function as JSON for the wasm. */
function toWasm(value: unknown): string {
	return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
		const original = this[key];
		if (original instanceof Date) return { "\0": "date", v: Number.isNaN(original.getTime()) ? "" : original.toISOString() };
		if (v === undefined || typeof v === "symbol") return UNDEFINED;
		if (typeof v === "function") return FUNCTION;
		if (typeof v === "number" && !Number.isFinite(v)) return { "\0": String(v) };
		if (typeof v === "bigint") return Number(v);
		return v;
	});
}
