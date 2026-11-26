// Template engines, behind one interface. Each is the JavaScript library itself, so a site that
// comes from a JavaScript generator gets the bytes it had.
import type { Config, Dirs, Filter } from "../config.ts";
import type { Data } from "../data.ts";
import { BuildError, bail } from "../diagnostics.ts";
import { describeThrown } from "../modules.ts";

/**
 * Who hears of a file a template includes from beside it (EJS's `include("./part")`, Liquid's
 * `include_relative`), each time one is used: while serving, the renderer, which notes it against
 * the page rendering, so an edit to that file renders the page again (`build.ts`). A file from
 * the includes folders isn't a page, and an edit to one renders every page.
 */
let opened: ((file: string) => void) | undefined;
export function hearOpened(listener: ((file: string) => void) | undefined): void {
	opened = listener;
}
export function includedBeside(file: string): void {
	opened?.(file);
}

/** What an engine is made with. */
export interface EngineEnv {
	config: Config;
	dirs: Dirs;
	/** Every folder includes come from: the site's, then each theme's. */
	includeDirs: string[];
	/** Every function templates can call: the built-in ones and the config's `filters`. */
	globals: Map<string, Filter>;
	/**
	 * Filters only for the languages that write them after a pipe (Jinja, Nunjucks, Liquid): other
	 * generators' filters that work as aliases (`url`, `markdownify`). Where filters share names
	 * with page data (Edge, Handlebars, EJS), `{{ url }}` stays the data.
	 */
	pipeFilters: Map<string, Filter>;
	/** The config's `strict`: printing an undefined value is an error. */
	strict: boolean;
}

export interface RenderContext {
	/** The name used in error messages: the path from the input folder, or a layout's name. */
	name: string;
	/** The template's own file: the page's, or the layout's being rendered (a relative include starts from its folder). */
	inputPath: string;
	/** When set, the engine may keep the compiled template under this key. */
	cacheKey?: string;
	/** What's being rendered, for a site's own engine (`engines`), which is told: a page's body (the default), a layout, a render hook, or a `permalink` or `computed` string. */
	kind?: EngineKind;
}

export type EngineKind = "body" | "layout" | "hook" | "permalink" | "computed";

/**
 * Whether what's rendering is a `permalink` or `computed` string. Those are data, not HTML, so
 * nothing in them is escaped: a page's title is printed (and escaped) where a layout prints it,
 * and escaped here as well it read `Tagged Rock &amp;amp; Roll`.
 */
export const isDataString = (ctx: RenderContext): boolean => ctx.kind === "permalink" || ctx.kind === "computed";

export interface TemplateEngine {
	/**
	 * Renders `source` with `data`. The answer is a string when everything the template called
	 * was synchronous, and a promise once something (an async filter) wasn't: a page whose
	 * engines all answer at once can be rendered on demand, when another page reads its
	 * `templateContent`.
	 */
	render(source: string, data: Data, ctx: RenderContext): string | Promise<string>;
	/**
	 * The includes this engine has read so far, by their paths in the includes folder (with or
	 * without the extension), for `--verbose`'s list of templates nothing used. Left out when
	 * the engine doesn't keep track.
	 */
	included?(): string[];
}

/**
 * An engine made when its first template renders, so its library loads then and not when ssqch
 * starts: most sites use one or two languages, and each library costs milliseconds to load.
 */
export function lazyEngine(make: () => TemplateEngine): TemplateEngine {
	let engine: TemplateEngine | undefined;
	return {
		render: (source, data, ctx) => (engine ??= make()).render(source, data, ctx),
		included: () => engine?.included?.() ?? [],
	};
}

/** Plain text: the source as it is (`html` and `txt`). */
export const plainEngine: TemplateEngine = { render: (source) => source };

export class Engines {
	byName = new Map<string, TemplateEngine>();

	get(name: string): TemplateEngine {
		const engine = this.byName.get(name);
		if (!engine) bail(`no template engine named \`${name}\` (known: ${[...this.byName.keys()].sort().join(", ")})`);
		return engine;
	}
}

/**
 * A site's function as templates call it: what it throws names the function and keeps where in
 * the site's own code it happened (`boom(): the snack drawer is empty`, then the stack's frames),
 * which a template library's own wrapper drops.
 */
export function siteFunction(name: string, fn: Filter, root: string): Filter {
	return function (this: unknown, ...args: unknown[]) {
		try {
			const out = fn.apply(this, args);
			return out instanceof Promise ? out.catch((e) => { throw thrown(name, e, root); }) : out;
		} catch (e) {
			throw thrown(name, e, root);
		}
	};
}

const thrown = (name: string, e: unknown, root: string) => (e instanceof BuildError && e.message.startsWith(`${name}(): `) ? e : new BuildError(`${name}(): ${describeThrown(e, root)}`));
