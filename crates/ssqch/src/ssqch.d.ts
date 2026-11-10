// Type definitions for ssqch.config.js and the modules built into ssqch.
// Written by `ssqch types`. Editors use them for autocomplete and checking;
// the build doesn't read them. Regenerate after upgrading ssqch.

declare module "ssqch" {
	/** What a config function gets: which build this is. */
	export interface ConfigContext {
		/** `"production"` for `ssqch build`, `"development"` for `ssqch serve` (unless `--env` says otherwise). */
		env: "production" | "development";
		/** True while running `ssqch serve`. */
		serving: boolean;
	}

	/** A page in a collection, oldest first. */
	export interface CollectionItem {
		/** The page's URL, or `false` for `permalink: false`. */
		url: string | false;
		date: Date;
		/** The template's path, like `./src/posts/pine.md`. */
		inputPath: string;
		/** The file name without extensions (`pine` for `pine.md`; empty for an `index` page). */
		fileSlug: string;
		filePathStem: string;
		/** Where the page is written, or `false`. */
		outputPath: string | false;
		/** `url`, `inputPath`, `date` and the rest, plus `headings` from the rendered body. */
		page: Record<string, unknown> & { headings?: Heading[] };
		/** The page's data: front matter, data files and the rest of the cascade. */
		data: Record<string, any>;
		/** The rendered body, without layouts. */
		templateContent: string;
		content: string;
	}

	/** A heading in a page's rendered body (`page.headings`). */
	export interface Heading {
		level: number;
		/** The heading's `id`, if it has one. */
		id?: string;
		/** Its text, without tags or anything marked `aria-hidden="true"`. */
		text: string;
	}

	/** How Markdown renders. */
	export interface MarkdownOptions {
		/** Automatic heading `id`s: `"github"` (the default), `"blackfriday"` (Hugo's older style: `a-b` for `A -- B`), or `false` for none. A `{#id}` on the heading always wins. */
		headingIds?: "github" | "blackfriday" | false;
		/** `## Heading {#id .class key=value}`. Default `true`. */
		headingAttributes?: boolean;
		/** `[^1]` references, with the notes at the end of the page. Default `true`. */
		footnotes?: boolean;
		/** `- [ ]` and `- [x]` items. Default `true`. */
		taskLists?: boolean;
		/** Bare `https://` and `www.` URLs become links. Default `true`. */
		autolinks?: boolean;
		/** GitHub's `> [!NOTE]` alerts: note, tip, important, warning and caution. Default `true`. */
		alerts?: boolean;
		/** `::: name args` blocks, rendered by `_includes/containers/name.*`. Default `true`. */
		containers?: boolean;
		/** A term, then `: definition` lines. Default `false`. */
		definitionLists?: boolean;
		/** Curly quotes, dashes and ellipses. Default `false`. */
		smartPunctuation?: boolean;
		/** Highlight fenced code at build time, with `hl-*` classes. The build writes their stylesheet to `/highlight.css`, or to `css` (a URL path), or not at all with `css: false`. Default `false`. */
		highlight?: boolean | { css?: string | false };
	}

	/** What a collection function gets. */
	export interface Pages {
		/** Every page in collections, oldest first. */
		all(): CollectionItem[];
		/** Pages with this tag. */
		byTag(tag: string): CollectionItem[];
		/** Pages with all of these tags. */
		byTags(...tags: string[]): CollectionItem[];
		/** Pages whose input path matches a glob (or any of several): `"src/posts/*.md"`. */
		byGlob(glob: string | string[]): CollectionItem[];
	}

	/** What a transform gets with the content. */
	export interface TransformPage {
		url: string;
		inputPath: string;
		outputPath: string;
	}

	/** What `beforeBuild` and `afterBuild` hooks get. */
	export interface BuildEvent {
		env: "production" | "development";
		serving: boolean;
		/** Folders relative to the project root, like `./src/`. */
		dirs: { input: string; output: string; includes: string; data: string };
		/** The files the build wrote (`afterBuild` only). */
		written?: string[];
	}

	type MaybePromise<T> = T | Promise<T>;
	type Hook = (event: BuildEvent) => MaybePromise<void>;
	/** Renders a template's body (front matter removed) with the page's data. */
	type EngineRender = (source: string, data: Record<string, any>) => MaybePromise<string>;

	/** A built-in plugin, as returned by `imagePlugin()` and the others. */
	export interface BuiltinPlugin {
		name: string;
		builtin: string;
		options?: Record<string, unknown>;
	}

	/** Everything a plugin can add. The config itself can set these too. */
	export interface ConfigParts {
		/** Shows up in error messages. */
		name?: string;
		/** Functions templates can call: `{{ slug(title) }}`. Async functions are awaited. */
		filters?: Record<string, (...args: any[]) => unknown>;
		/** Data for every template. A function (sync or async) is called on each build. */
		data?: Record<string, unknown>;
		/** Custom collections, from the pages in collections. */
		collections?: Record<string, (pages: Pages) => unknown>;
		/** Run on every output file. Return the content, changed or not. */
		transforms?: Record<string, (content: string, page: TransformPage) => MaybePromise<string>>;
		/** Template engines of your own, by file extension: a function, or an object with `render`. Return the rendered text. */
		engines?: Record<string, EngineRender | { render: EngineRender }>;
		/** Files or folders to copy: a path, or `{ from: to }`, or an array of them. */
		passthrough?: string | Record<string, string> | Array<string | Record<string, string>>;
		/** More paths for `ssqch serve` to watch. */
		watch?: string | string[];
		beforeBuild?: Hook | Hook[];
		afterBuild?: Hook | Hook[];
		/** More config, from plugins. `false`, `null` and `undefined` are skipped. */
		plugins?: Plugin[];
	}

	export type Plugin =
		| ConfigParts
		| BuiltinPlugin
		| ((context: ConfigContext) => MaybePromise<ConfigParts | BuiltinPlugin | false | null | undefined>)
		| false
		| null
		| undefined;

	export interface Config extends ConfigParts {
		/** Folders. `includes` and `data` are relative to `input`. */
		dirs?: {
			/** Default `.`. */
			input?: string;
			/** Default `_site`. */
			output?: string;
			/** Default `_includes`. */
			includes?: string;
			/** Default `_data`. */
			data?: string;
		};
		/** File extensions to render. Default `["edge", "md", "html"]`. Add `"liquid"` for Liquid, `"njk"` for Nunjucks, `"jinja"` / `"j2"` for Jinja, `"hbs"` / `"handlebars"` for Handlebars, or `"mustache"`. */
		templateFormats?: string[];
		/** The engine that runs over `.md` files first: `"edge"` (the default), `"liquid"`, `"njk"`, `"jinja"`, or `false` for none. */
		markdownEngine?: string | false;
		/** The engine that runs over `.html` files first. Default `"edge"`; `false` for none. */
		htmlEngine?: string | false;
		/** Heading IDs, footnotes and the other Markdown extensions. */
		markdown?: MarkdownOptions;
		/** Merge objects and concatenate arrays through the data cascade. Default `true`. */
		deepMerge?: boolean;
		/** Delete output files an earlier build wrote or copied that this one didn't (a deleted post's page). Files other tools write are never touched. Default `false`. */
		clean?: boolean;
	}

	/** Returns its argument. It's there so the config reads as one, and for these types. */
	export function defineConfig<T extends Config | ((context: ConfigContext) => MaybePromise<Config>)>(config: T): T;
	/** Render Markdown with the site's `markdown` options (render hooks and containers are for templates). `inline` drops the `<p>` around a single paragraph. */
	export function markdown(text: string, options?: { inline?: boolean }): string;
	const ssqch: { defineConfig: typeof defineConfig; markdown: typeof markdown };
	export default ssqch;
}

declare module "ssqch/image" {
	import type { BuiltinPlugin } from "ssqch";

	export type ImageFormat = "avif" | "webp" | "jpeg" | "jpg" | "png" | "gif" | "svg" | "auto";
	/** A format name. Known names autocomplete; ssqch rejects an unknown one when it builds. */
	type FormatName = ImageFormat | (string & {});

	export interface ImagePluginOptions {
		/** Output formats; the last is the `<img>` fallback. `"auto"` keeps the source's format. */
		formats?: FormatName[];
		/** Widths to generate (never wider than the original). */
		widths?: number[];
		/** Attributes added to every `<img>`, like `{ loading: "lazy" }`. */
		defaultAttributes?: Record<string, string>;
		/** Folder in the output for generated images. Default `img`. */
		outputDir?: string;
		/** URL path they're served from. Default `/img/`. */
		urlPath?: string;
		webpQuality?: number;
		avifQuality?: number;
		/** 1 (slowest, smallest) to 10 (fastest). Default 8. */
		avifSpeed?: number;
		jpegQuality?: number;
		minimumThreshold?: number;
		/** Delete generated images the build didn't use. Only for full builds. */
		prune?: boolean;
		/** Remember image ids between builds in `.cache/ssqch`. Default `true`. */
		hashCache?: boolean;
		/** Point links to local images at a generated copy. Default `true`. */
		linkedImages?: boolean;
	}

	/** One generated file. */
	export interface ImageEntry {
		format: string;
		width: number;
		height: number;
		url: string;
		/** The MIME type, like `image/webp`. */
		sourceType: string;
		/** `url width`, for a `srcset`. */
		srcset: string;
		filename: string;
		outputPath: string;
		size: number;
	}

	/** Turns every local `<img>` in HTML output into a `<picture>`. */
	export function imagePlugin(options?: ImagePluginOptions): BuiltinPlugin;

	/** Generate one image's files with the plugin's settings and cache. Keyed by format, smallest first. */
	export function image(src: string, options?: { widths?: Array<number | "auto">; formats?: FormatName[] }): Promise<Record<string, ImageEntry[]>>;
}

declare module "ssqch/rss" {
	import type { BuiltinPlugin } from "ssqch";

	/** Adds the filters getNewestCollectionItemDate, dateToRfc3339, dateToRfc822, absoluteUrl, htmlToAbsoluteUrls and url. */
	export function rssPlugin(): BuiltinPlugin;
	export function getNewestCollectionItemDate(collection: unknown[]): Date | undefined;
	export function dateToRfc3339(date: Date | string): string;
	export function dateToRfc822(date: Date | string): string;
	export function absoluteUrl(url: string, base: string): string;
	export function htmlToAbsoluteUrls(html: string, base: string): string;
}

declare module "ssqch/minify" {
	import type { BuiltinPlugin } from "ssqch";

	export interface MinifyOptions {
		/** Default `true`. */
		collapseWhitespace?: boolean;
		/** Default `true`. */
		removeComments?: boolean;
		/** Default `true`. */
		shortDoctype?: boolean;
		/** Drop boolean attributes' values (`defer="defer"` to `defer`) and extra whitespace in `class`, `srcset`, URLs and the viewport `<meta>`. Default `true`. */
		shortenAttributes?: boolean;
	}

	/** Minifies HTML output, after the image transform. */
	export function minifyPlugin(options?: MinifyOptions): BuiltinPlugin;
	export function minify(html: string, options?: MinifyOptions): string;
}

declare module "ssqch/assets" {
	import type { BuiltinPlugin } from "ssqch";

	export interface AssetsPluginOptions {
		/** URL paths of files in the output to fingerprint, like `["/assets/index.css"]`. */
		files: string[];
		/** Default: production builds only. */
		fingerprint?: boolean;
	}

	/** Renames each file to `name.<hash>.ext` in production builds and rewrites the links to it. */
	export function assetsPlugin(options: AssetsPluginOptions): BuiltinPlugin;
}

declare module "ssqch/links" {
	import type { BuiltinPlugin } from "ssqch";

	export interface LinksPluginOptions {
		/** Check `#fragments` against the target page's ids. Default `true`. */
		anchors?: boolean;
		/** URL path prefixes to skip, like `["/downloads/"]`. */
		ignore?: string[];
		/** Fail the build on a broken link. Default: production builds only. */
		fail?: boolean;
	}

	/** Checks every internal link and anchor after each build. */
	export function linksPlugin(options?: LinksPluginOptions): BuiltinPlugin;
}
