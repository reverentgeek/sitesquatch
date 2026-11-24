// Type definitions for ssqch.config.js and the modules built into ssqch.
// Written by `ssqch types`. Editors use them for autocomplete and checking;
// the build doesn't read them. Regenerate after upgrading ssqch.

// A config and its data files run on Node, so `process` is Node's own. These are the parts
// they most often use, declared the way @types/node declares them, so a project that installs
// those types gets theirs too.
declare namespace NodeJS {
	interface ProcessEnv {
		/** The build's environment (`--env`): `"production"` for `ssqch build`, `"development"` for `ssqch serve`. */
		SSQCH_ENV?: string;
		[name: string]: string | undefined;
	}
	interface Process {
		/** The environment variables, with `SSQCH_ENV` set to the build's environment when it isn't set. */
		env: ProcessEnv;
		/** The project root. */
		cwd(): string;
		/** `"darwin"`, `"linux"` or `"win32"`. */
		platform: string;
	}
}
declare var process: NodeJS.Process;

declare module "ssqch" {
	/** What a config function gets: which build this is. */
	export interface ConfigContext {
		/** `"production"` for `ssqch build`, `"development"` for `ssqch serve` (unless `--env` says otherwise). */
		env: "production" | "development";
		/** True while running `ssqch serve`. */
		serving: boolean;
	}

	/** The data of the pages each schema covers, by schema name. `ssqch types` fills this in from the config's `schemas`. */
	export interface Schemas {}

	/** A page in a collection, oldest first. */
	export interface CollectionItem<Data = Record<string, any>> {
		/** The page's URL, or `false` for `permalink: false`. */
		url: string | false;
		date: Date;
		/** The template's path, like `./src/posts/pine.md`. */
		inputPath: string;
		/** The file name without extensions (`pine` for `pine.md`; empty for an `index` page). */
		fileSlug: string;
		filePathStem: string;
		/** Where the page is written, from the project root like `inputPath` (`./dist/posts/pine/index.html`), or `false`. */
		outputPath: string | false;
		/** `url`, `inputPath`, `date` and the rest, plus `headings` from the rendered body. */
		page: Record<string, unknown> & { headings?: Heading[]; excerpt?: string; lastModified?: Date };
		/** The page's data: front matter, data files and the rest of the cascade. */
		data: Data & Record<string, any>;
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

	/** What a token is: its `hl-*` class without the prefix. */
	export type TokenKind = "comment" | "keyword" | "operator" | "string" | "regexp" | "escape" | "number" | "constant" | "builtin" | "property" | "attribute" | "function" | "type" | "parameter" | "tag" | "heading" | "strong" | "emphasis" | "link" | "inserted" | "deleted";

	/** A piece of highlighted code. Without a `kind` (or as a string), it's plain text. */
	export type Token = [text: string, kind?: TokenKind | null] | { text: string; kind?: TokenKind | null } | string;

	/** A site's language for `markdown.highlight.languages`: a function that cuts the code into tokens whose text adds up to the code, another language's name (`"chordpro"`, an alias), or the path of a `.sublime-syntax` grammar from the project root. */
	export type Highlighter = ((code: string, lang: string) => Token[]) | string;

	/** How Markdown renders. */
	export interface MarkdownOptions {
		/** Automatic heading `id`s: `"github"` (the default: GitHub's and github-slugger's anchors, character for character), `"blackfriday"` (Hugo's older style: `a-b` for `A -- B`), `"kramdown"` (Jekyll's: GitHub's ids for the page's headings, and kramdown's ASCII ones, `section` for none, for headings inside `markdown="1"` HTML), `"markdown-it-anchor"` (that plugin's default: the lowercase text with spaces as `-`, percent-encoded, `what%E2%80%99s-new%3F`), `"python-markdown"` (MkDocs': Python-Markdown's `toc` ids, ASCII, `cafe-notes` for `Café notes`), or `false` for none. A `{#id}` on the heading always wins. `"vitepress"`: VitePress's (@mdit-vue's `slugify`: `What's Vue?` is `what-s-vue`, `1. Setup` is `_1-setup`). */
		headingIds?: "github" | "blackfriday" | "ascii" | "kramdown" | "markdown-it-anchor" | "python-markdown" | "vitepress" | false | ((text: string) => string);
		/** `## Heading {#id .class key=value}`. Default `true`. */
		headingAttributes?: boolean;
		/** `[^1]` references, with the notes at the end of the page. Default `true`. */
		footnotes?: boolean;
		/** `- [ ]` and `- [x]` items. Default `true`. */
		taskLists?: boolean;
		/** Bare `https://` and `www.` URLs become links. `"fuzzy"` links bare domains (`example.com`, with a common or two-letter country TLD) and email addresses too, as markdown-it's `linkify` does. `"email"` links email addresses (with `mailto:`) and URLs, not bare domains, as markdown-it's `linkify` with `fuzzyLink: false` does (VitePress's setting). Default `true`. */
		autolinks?: boolean | "fuzzy" | "email";
		/** A single newline inside a paragraph (or a list item) becomes a `<br>`. Default `false`. (markdown-it's `breaks: true` writes the same.) */
		breaks?: boolean;
		/** An image (or a linked image) alone in a paragraph becomes `<figure><img alt=""><figcaption>its alt text</figcaption></figure>`. Default `false`. (markdown-it-implicit-figures with `figcaption: true` writes the same.) */
		figures?: boolean;
		/** GitHub's `> [!NOTE]` alerts: note, tip, important, warning and caution. Default `true`. */
		alerts?: boolean;
		/** `::: name args` blocks, rendered by `_includes/containers/name.*`. A closing `:::` indented less than four spaces closes the innermost open container, so Prettier's `:::`, indented under the list it ends, works (as markdown-it-container and VitePress read them). Default `true`. */
		containers?: boolean;
		/** A term, then `: definition` lines. Default `false`. */
		definitionLists?: boolean;
		/** Curly quotes, dashes and ellipses. Default `false`. */
		smartPunctuation?: boolean;
		/** Lines indented four spaces are code blocks. `false` renders them as ordinary Markdown (HTML indented inside Markdown, say); fences are still code. Default `true`. */
		indentedCode?: boolean;
		/** Highlight fenced code at build time, with `hl-*` classes. The build writes their stylesheet to `/highlight.css`, or to `css` (a URL path), or not at all with `css: false`. `languages` adds languages or replaces built-in ones. `classes` names the tokens as another highlighter does, so a site keeps its theme's CSS: `"prism"` (`token keyword`, `<pre class="language-js">`, marked lines as `<mark class="highlight-line highlight-line-active">`), `"pygments"` or `"chroma"` (Pygments' short names, `k`, `s`, `nf`, which MkDocs' and Hugo's themes style), or `{ keyword: "tok-keyword" }` for some kinds; the stylesheet uses the same names. Default `false`. */
		/** Links to `.md` files (`[Setup](setup/install.md#first)`) go to the page built from that file, with the `#` part: `true` writes its URL from the site's root (`/setup/install/#first`), `"relative"` from the page, as MkDocs does (`setup/install/#first`). A link to a file that isn't a page stays as written, for the link checker. Default `false`. */
		sourceLinks?: boolean | "relative";
		highlight?: boolean | { css?: string | false; languages?: Record<string, Highlighter>; classes?: "prism" | "pygments" | "chroma" | Partial<Record<TokenKind, string>> };
	}

	/** What a collection function gets. */
	export interface Pages {
		/** Every page in collections, oldest first. */
		all(): CollectionItem[];
		/** Pages with this tag. A tag with a schema gives pages with that schema's fields. */
		byTag<Tag extends keyof Schemas>(tag: Tag): CollectionItem<Schemas[Tag]>[];
		byTag(tag: string): CollectionItem[];
		/** Pages with all of these tags. */
		byTags(...tags: string[]): CollectionItem[];
		/** Pages whose input path matches a glob (or any of several): `"src/posts/*.md"`. */
		byGlob(glob: string | string[]): CollectionItem[];
	}

	/** What a transform gets with the content. */
	export interface TransformPage {
		url: string;
		/** The template's path, like `./src/posts/pine.md`. */
		inputPath: string;
		/** The file being written, from the project root: `./dist/posts/pine/index.html`. */
		outputPath: string;
	}

	/** What `beforeBuild` and `afterBuild` hooks get. */
	export interface BuildEvent {
		env: "production" | "development";
		serving: boolean;
		/** The build was run with `--quiet`: print only warnings and errors. */
		quiet: boolean;
		/** The build was run with `--verbose`. */
		verbose: boolean;
		/** Folders relative to the project root, like `./src/`. */
		dirs: { input: string; output: string; includes: string; data: string };
		/** The files the build wrote (`afterBuild` only). */
		written?: string[];
		/** While serving, the files whose change started this build, relative to the project root (`./src/guide/intro.md`), so a hook can skip work the change doesn't touch: `if (changed && !changed.some((f) => f.endsWith(".vue"))) return;`. Not there on the first build or a build of everything (`ssqch build`). */
		changed?: string[];
	}

	type MaybePromise<T> = T | Promise<T>;
	/** A function, or `{ run: "command" }` to run a program in the project root (through `sh -c`, or `cmd /C` on Windows). It gets `SSQCH_ENV`, `SSQCH_SERVING`, `SSQCH_QUIET`, `SSQCH_INPUT` and `SSQCH_OUTPUT`; a failure fails the build. */
	type Hook = ((event: BuildEvent) => MaybePromise<void>) | { run: string };
	/** What a site's own engine is rendering, its third argument: a page's body, a layout, a Markdown render hook, or a page's `permalink` or `computed` string; and the file, as `page.inputPath` names it (`./src/posts/pine.md`). */
	interface EngineContext {
		kind: "body" | "layout" | "hook" | "permalink" | "computed";
		path: string;
	}
	/** Renders a template's body (front matter removed) with the page's data. The third argument says what's being rendered. */
	type EngineRender = (source: string, data: Record<string, any>, context: EngineContext) => MaybePromise<string>;

	/**
	 * A field's type: `"string"`, `"number"`, `"integer"`, `"boolean"`, `"date"`, `"file"` (a path to a file that exists), `"object"`, `"array"` or `"any"`;
	 * a literal (`"'draft'"`, `"1"`, `"true"`, `"null"`); a union (`"'draft' | 'published'"`); a list (`"string[]"`); and `?` at the end for optional (`"string?"`).
	 * Or an object of fields, a one-item array (`[{ name: "string" }]` is a list of objects), or a function that returns `true`, `false` or what's wrong.
	 */
	export type SchemaType = string | ((value: any, page: Record<string, any>) => boolean | string | void) | SchemaFields | [SchemaType];
	/** `{ field: type }`. A key ending in `?` is optional too: `"author?": { name: "string" }`. */
	export interface SchemaFields {
		[field: string]: SchemaType;
	}
	/** What a kind of page's data has to look like. Checked on every build; a problem names the file and the field. */
	export interface Schema {
		fields: SchemaFields;
		/** Globs (relative to the input folder) of the files this covers. Without it, the schema covers the pages tagged with its name (`all` is every page in collections). */
		files?: string | string[];
		/** Front matter keys that aren't fields: `"allow"` (the default), `"warn"` or `"error"`. */
		unknown?: "allow" | "warn" | "error";
	}

	/** Where a theme comes from: a folder, a pinned git URL, or the same as an object. */
	export type ThemeSource = string | { git: string; ref: string; dir?: string };

	/** A built-in plugin, as returned by `imagePlugin()` and the others. */
	export interface BuiltinPlugin {
		name: string;
		builtin: string;
		options?: Record<string, unknown>;
	}

	/** A plugin written in Rust: one `.wasm` file built with the `ssqch-plugin` crate, which ssqch runs in Node's WebAssembly on every platform. An npm package's default export returns this: `export default (options) => ({ name: "hello", rust: { wasm: fileURLToPath(new URL("./hello.wasm", import.meta.url)), options } })`. Its transform, filters and engines come from the manifest inside the file, so none are listed here; a name the config already uses is an error, and so is a file built for another plugin ABI. */
	export interface RustPlugin {
		/** Shows up in error messages. */
		name: string;
		rust: {
			/** The absolute path to the plugin's `.wasm` file. */
			wasm: string;
			/** The plugin's options, as JSON. The plugin checks them when the config loads (an unknown or misspelled option fails the build, and says which fields it has). */
			options?: unknown;
		};
	}

	/** Everything a plugin can add. The config itself can set these too. */
	export interface ConfigParts {
		/** Shows up in error messages. */
		name?: string;
		/** Functions templates can call: `{{ slug(title) }}`. Async functions are awaited. */
		filters?: Record<string, (this: FilterContext | undefined, ...args: any[]) => unknown>;
		/** Data for every template. A value that's a function (sync or async) is called on each build, and its answer is that name's value. */
		data?: Record<string, unknown>;
		/** Custom collections, from the pages in collections. */
		collections?: Record<string, (pages: Pages) => unknown>;
		/** Run on every output file. Return the content, changed or not. */
		transforms?: Record<string, (content: string, page: TransformPage) => MaybePromise<string>>;
		/** Template engines of your own, by file extension: a function, or an object with `render` (a markdown-it instance is one: `render(source, env)` gets the page's data as `env`). Return the rendered text. `md` replaces ssqch's Markdown for `.md` files and `md` in a `render` chain, after the `markdownEngine`; the `markdown` filter stays ssqch's. `cache: true` keeps the page bodies it renders by their source, so a body with the same text isn't rendered again, in a build or the next one in `ssqch serve`: for an engine whose output depends on the source alone. */
		engines?: Record<string, EngineRender | { render: EngineRender; cache?: boolean }>;
		/** Files or folders to copy: a path, or `{ from: to }`, or an array of them. */
		passthrough?: string | Record<string, string> | Array<string | Record<string, string>>;
		/** More paths for `ssqch serve` to watch. */
		watch?: string | string[];
		/** Run before each build: a function, `{ run: "command" }`, or a list of them. */
		beforeBuild?: Hook | Hook[];
		/** Run after each build, with `written` (the files the build wrote). */
		afterBuild?: Hook | Hook[];
		/** More config, from plugins. A plugin is an object with any of these keys, a function that returns one, a built-in plugin (`imagePlugin()`), and plugins written in Rust (`{ name, rust: { wasm, options } }`). `false`, `null` and `undefined` are skipped. */
		plugins?: Plugin[];
	}

	/** What a plugin's Markdown steps and hooks get besides their text. */
	export interface MarkdownStepContext {
		/** The page's data, as its templates see it. */
		data: Record<string, any>;
		/** The page (`data.page`): `url`, `inputPath` and the rest. */
		page: Record<string, any> | undefined;
		/** The site's `urls`: `"html"` when pages are `/guide/intro.html`. */
		urls: "folders" | "html";
		/** Markdown rendered with the site's options and hooks; `{ inline: true }` leaves out the `<p>`. */
		markdown(text: string, options?: { inline?: boolean }): string;
		/** Whether the site or a plugin has the render hook or container `name` (`"heading"`, `"containers/tip"`). */
		hasHook(name: string): boolean;
		/** Calls the render hook `name` with `value` under `key` (`renderHook("containers/tip", "container", { args, content })`): the site's template if it has one, else a plugin's. */
		renderHook(name: string, key: string, value: Record<string, any>): string;
	}

	/** A plugin's own steps in ssqch's Markdown. Each answers at once with text. */
	export interface PluginMarkdown {
		/** The page's Markdown, before ssqch's Markdown reads it (after its template engine). Runs in the order the plugins are listed, before the site's `markdown.preprocess`. */
		before?: (source: string, context: MarkdownStepContext) => string;
		/** The HTML ssqch's Markdown wrote for the page, before its layouts. */
		after?: (html: string, context: MarkdownStepContext) => string;
		/** Render hooks and containers, as functions that return HTML: `heading`, `link`, `image`, `fence`, `code`, `table`, `containers/<name>`. Each gets what the template of the same name would (`heading.level`, `container.content`). A site's own template of the same name (`_includes/hooks/heading.*`) replaces it; a later plugin's replaces an earlier one's. */
		hooks?: Record<string, (value: Record<string, any>, context: MarkdownStepContext) => string>;
	}

	/** A plugin: the config's parts, and what only a plugin can give. */
	export interface PluginParts extends ConfigParts {
		/** The plugin's name, for its errors. */
		name?: string;
		/** Steps in ssqch's Markdown, and render hooks as functions. */
		markdown?: PluginMarkdown;
		/** Values for the site's settings that its own config replaces: `markdown` options (`{ markdown: { headingIds: "ascii" } }`) for any key the site's `markdown` doesn't set. */
		defaults?: { markdown?: MarkdownOptions };
	}

	export type Plugin =
		| PluginParts
		| BuiltinPlugin
		| RustPlugin
		| ((context: ConfigContext) => MaybePromise<PluginParts | BuiltinPlugin | RustPlugin | false | null | undefined>)
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
		/** File extensions to render. Default `["jinja", "md", "html"]`. Add `"edge"` for Edge, `"liquid"` for Liquid, `"njk"` for Nunjucks, `"j2"` for Jinja in `.j2` files, `"hbs"` / `"handlebars"` for Handlebars, `"mustache"`, or `"ejs"` for EJS. */
		templateFormats?: string[];
		/** The engine that runs over `.md` files first: `"jinja"` (the default), `"edge"`, `"liquid"`, `"njk"`, `"hbs"`, `"ejs"`, or `false` for none. */
		markdownEngine?: string | false;
		/** The engine that runs over `.html` files first. Default `"jinja"`; `false` for none. */
		htmlEngine?: string | false;
		/** Heading IDs, footnotes and the other Markdown extensions. */
		markdown?: MarkdownOptions;
		/** Merge objects and concatenate arrays through the data cascade. Default `true`. */
		deepMerge?: boolean;
		/** Delete output files an earlier build wrote or copied that this one didn't (a deleted post's page, a picture `imagePlugin()` encoded that no page uses now). Each output folder has its own list, so a build into another folder (`--output dist-before`) doesn't make the next forget `dist`'s. Files other tools write are never touched. Default `false`. */
		leaveNoTrace?: boolean;
		/** Globs (relative to the input folder) of files that aren't pages, like `["drafts/**", "notes/*.wip.md"]`. */
		ignore?: string | string[];
		/** Page bundles: copy the other files in a folder whose page is `index.*` (images, downloads) next to the page. Default `false`. */
		bundles?: boolean;
		/** Printing an undefined value (`{{ titel }}`) is an error, in every template language. Conditionals and defaults still work. Default `false`. */
		strict?: boolean;
		/** Jinja's settings for `.jinja` and `.j2` templates. `autoescape: false` prints values as they are (`| e` still escapes); default `true`, or `false` with `fromMkdocs({ templates: true })`, since MkDocs' Jinja doesn't escape. `.njk` always escapes. */
		jinja?: { autoescape?: boolean };
		/** `page.lastModified`: `"git"` for the last commit that changed the page's file (its modification time when it has uncommitted changes), or `"file"` for the modification time. Off by default. Needs the full history in CI (`fetch-depth: 0`). */
		lastModified?: "git" | "file" | false;
		/** The date of a page with no date of its own (in its data or its file name): `"git"` for the last commit that changed its file, the same in every checkout, or `"file"` (the default) for the file's modification time, which is when the checkout wrote it. Either way it sorts after the dated pages, by path. Needs the full history in CI (`fetch-depth: 0`). */
		dateFallback?: "git" | "file";
		/** The time zone the site's own JavaScript runs in, as an IANA name (`"UTC"`, `"America/New_York"`): `Date`'s local methods and libraries like luxon and date-fns, in data files, filters, hooks and Edge templates, so a laptop and CI build the same pages. ssqch's own date filters and the sitemap's `<lastmod>` are UTC whatever this says, and a front matter date without a time is midnight UTC (the day before, west of UTC, by `Date`'s local methods). Default: the machine's. The config's own top-level code runs before it applies. */
		timeZone?: string;
		/** A page's URL when it has no `permalink`: `"folders"` (the default) writes `guide/intro.md` as `/guide/intro/` (`guide/intro/index.html`), `"html"` as `/guide/intro.html`. An index page is its folder either way (`guide/index.md` is `/guide/`). (`"html"` is VitePress without `cleanUrls`, Hugo's `uglyURLs` and Docusaurus's `trailingSlash: false`.) */
		urls?: "folders" | "html";
		/** Other names for layouts: `{ post: "layouts/post.njk" }` makes `layout: post` that file (where it would be `_includes/post.*`). A page's `layout` is still the name it gave. (Eleventy's `addLayoutAlias` does the same.) */
		layoutAliases?: Record<string, string>;
		/** The path the site is served under, when that isn't the root of its domain: `"/repo/"` for `https://you.github.io/repo/`. Templates and `page.url` stay as they are; ssqch adds the base to URLs from the site's root in the HTML it writes. Use the `withBase()` filter outside HTML attributes. */
		base?: string;
		/** A theme under the site: a folder (`"themes/docs"`), or a git repository pinned to a tag or a commit's full hash (`"https://github.com/you/theme#v1.2.0"`, with `#v1.2.0:folder` for a theme in a folder of its repository), fetched once and kept in `.cache/ssqch/themes/`. The site's own includes, data, pages and files win over the theme's, one by one. In a list, earlier themes sit on top of later ones. */
		theme?: ThemeSource | ThemeSource[];
		/** Content schemas, by name: `{ posts: { fields: { title: "string", date: "date" } } }` checks every page tagged `posts`. */
		schemas?: Record<string, Schema>;
		/** Size budgets by kind of file, checked after each build: a file over its kind's budget is an `over-budget` warning, or with `fail: true` an error that fails a production build (development builds and `ssqch serve` still warn). Sizes are bytes or strings like `"150 KB"` and `"1.5 MB"` (powers of 1,000). */
		budgets?: Partial<Record<"pages" | "images" | "css" | "javascript" | "fonts" | "media" | "documents" | "data" | "other" | "total", number | string>> & { fail?: boolean };
		/** What `ssqch serve` runs besides the server. (The server builds in a process of its own, starts it again when the config or a module it imports changes, and listens on 127.0.0.1 only.) */
		serve?: {
			/** Programs to start with the server and stop with it, like the watchers of your CSS and JavaScript tools: `["npx postcss src/app.css -o dist/app.css --watch"]`. Their output is shown with the tool's name in front. They get `SSQCH_ENV`, `SSQCH_SERVING` (`true`), `SSQCH_QUIET`, `SSQCH_INPUT` and `SSQCH_OUTPUT`, as build commands do. Builds don't run them. */
			run?: string | string[];
			/** Globs (or folders, with what's in them) from the project root whose changes don't rebuild the site, for files only a `run` tool reads (`["src/_css/**"]` while PostCSS compiles it; a saved file it compiles still reaches the browser). Never the config or a file the last build read (a Sass partial). */
			ignore?: string | string[];
		};
	}

	/** Returns its argument. It's there so the config reads as one, and for these types. */
	export function defineConfig<T extends Config | ((context: ConfigContext) => MaybePromise<Config>)>(config: T): T;
	/** Render Markdown with the site's `markdown` options (render hooks and containers are for templates). `inline` drops the `<p>` around a single paragraph: `markdown(text, { inline: true })`, or `markdown(text, "inline")` as in templates. */
	export function markdown(text: string, options?: { inline?: boolean } | "inline"): string;
	/** Read a JSON, YAML or TOML file (from the project root) into data: `readData("src/_data/sites/en.yml")`. */
	export function readData(path: string): any;
	/** HTML that templates print as it is, in every template language: a filter's answer that's markup, `return safe(`<b>${text}</b>`)`. Anything else gets the text as a string. Escape what goes in it yourself. */
	export function safe(html: unknown): string;
	/** `this` in a config filter written as a `function` (an arrow function has no `this`): the page being rendered. `undefined` outside a render (in a collection, a data file or a hook). */
	export interface FilterContext {
		/** The page being rendered, as its templates see `page`: `url`, `inputPath`, `outputPath`, `date`, and in a layout `headings` and `excerpt`. */
		page: Record<string, any>;
		/** Everything the template sees: front matter, the cascade, `collections`, and in a layout `content`. */
		data: Record<string, any>;
	}
	/** A file that `files()` found. */
	export interface FoundFile {
		/** From the project root, with `/`: `"images/albums/v1/20011222_08.JPG"`. */
		path: string;
		/** Where a passthrough copy to the same path is served: from the input folder when the file is inside it (`src/images/a.jpg` is `/images/a.jpg`), otherwise from the project root (`/images/albums/v1/20011222_08.JPG`). */
		url: string;
		/** The file name: `"20011222_08.JPG"`. */
		name: string;
		/** The name without its extension: `"20011222_08"`. */
		stem: string;
		/** The extension, lowercase, without the dot: `"jpg"`. */
		ext: string;
		/** From the start of the name (`20011222_08.JPG`, `2001-12-22-camp.jpg`, at midnight UTC), or the file's modification time. */
		date: Date;
		/** Where `date` came from: `"name"`, or `"modified"` (the modification time, which says when the file was copied or edited, not when a photo was taken). */
		dateFrom: "name" | "modified";
		/** Bytes. */
		size: number;
		/** Pixels, with `{ dimensions: true }`; `null` for a file whose size ssqch can't read (it reads PNG, JPEG, GIF, TIFF, WebP, HEIF, AVIF, BMP, PSD, ICO and QOI). */
		width?: number | null;
		/** Pixels, with `{ dimensions: true }`; `null` for a file whose size ssqch can't read (it reads PNG, JPEG, GIF, TIFF, WebP, HEIF, AVIF, BMP, PSD, ICO and QOI). */
		height?: number | null;
	}
	/** The files a glob matches, from the project root and ignoring case, sorted by path, as data: `files("images/albums/v1/*.{jpg,png}")`. `{ dimensions: true }` reads each image's width and height from its header, once: they're kept in `.cache/ssqch/image-sizes.json` until the file changes. No match is an empty list. */
	export function files(pattern: string, options?: { dimensions?: boolean }): FoundFile[];
	/** How `slugify` writes a slug. */
	export interface SlugifyOptions {
		/** Between words: a dash by default, `"_"` for `taco_bake`. */
		separator?: string;
		/** `"drop"` (the default): `Drew's Brownies` is `drews-brownies`. `"separate"`: an apostrophe splits words like other punctuation, `drew-s-brownies`, to keep a site's existing URLs. */
		apostrophes?: "drop" | "separate";
		/** `true` takes accents off and spells out a few letters and symbols first, as the slugify package does: `Thomas Sjögren` is `thomas-sjogren`, `Straße & 50%` is `strasse-and-50-percent`. Other scripts stay as they are. Default `false`. */
		ascii?: boolean;
		/** `true` drops HTML tags first: `Use <code>title</code>` is `use-title`, not `use-code-title-code`. Default `false`. */
		stripTags?: boolean;
	}
	/** The `slugify` template filter, for data files: `slugify("Taco Bake", { separator: "_" })` is `"taco_bake"`. Lowercase letters and digits, with `separator` (a dash by default) for each run of anything else. A string is the separator. */
	export function slugify(text: string, options?: SlugifyOptions | string): string;
	/** A `slugify` that counts, so every slug it makes is different: the first "Misc Pictures" is `misc-pictures`, the next `misc-pictures-1`, then `misc-pictures-2`. Make one per list, in a data file, and store the slug with each item, so a paginated page's permalink and the links to it agree. */
	export function slugger(options?: SlugifyOptions): (text: string) => string;
	const ssqch: { defineConfig: typeof defineConfig; markdown: typeof markdown; readData: typeof readData; files: typeof files; slugify: typeof slugify; slugger: typeof slugger };
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
		/** WebP quality, sharp's: a whole number from 1 to 100. Default 75. */
		webpQuality?: number;
		/** AVIF quality, sharp's: a whole number from 1 to 100. Default 41. */
		avifQuality?: number;
		/** sharp's AVIF effort: a whole number from 0 (fastest) to 9 (slowest, smallest files). Default 2. */
		avifEffort?: number;
		/** JPEG quality, sharp's (mozjpeg): a whole number from 1 to 100. Default 89. */
		jpegQuality?: number;
		/** A width larger than the original is clamped to it only when the width before it is this many times smaller. Default 1.25. */
		minimumThreshold?: number;
		/** Delete every file in the image folder that the build didn't use, ones no build of ssqch listed included. Only for full builds. `leaveNoTrace` removes the copies an earlier build used and this one didn't, without this. */
		prune?: boolean;
		/** Remember image ids between builds in `.cache/ssqch`. Default `true`. */
		hashCache?: boolean;
		/** Point links to local images at a generated copy. Default `true`. */
		linkedImages?: boolean;
		/** Where images are encoded and kept between builds, from the project root; the output gets links to them. Default `.cache/ssqch/img`. `false` encodes straight into the output. */
		cacheDir?: string | false;
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

	/** Turns every local `<img>` in HTML output into a `<picture>`, with AVIF, WebP and fallback sources encoded by sharp. `[ssqch] Encoded ...` lines come as each image's files are done, while pages go on rendering. */
	export function imagePlugin(options?: ImagePluginOptions): BuiltinPlugin;

	/** Generate one image's files with the plugin's settings and cache. Keyed by format, smallest first; with `"auto"` in `formats`, its files are under `auto` too. */
	export function image(src: string, options?: ImageCallOptions): Promise<Record<string, ImageEntry[]>>;

	/** One generated copy of an image, from `imageUrl()`. A remote URL comes back as only `{ url }`. */
	export interface ImageUrl {
		url: string;
		width?: number;
		height?: number;
		/** The MIME type, like `image/png`. */
		type?: string;
		/** The format it's in, like `png`. */
		format?: string;
	}

	/** The URL (and size and type) of one generated copy of an image, for `og:image`, JSON-LD and feeds: `imageUrl("/content/logo.png", { width: 1200 })`. `src` is a site path, from the input folder. Also a template function. */
	export function imageUrl(src: string, options?: { width?: number | "auto"; format?: FormatName }): ImageUrl;

	/** What `image()` takes for one image. Encoder settings go on `imagePlugin()`. */
	export interface ImageCallOptions {
		/** Widths to generate; `"auto"` is the original's. Default `["auto"]`. */
		widths?: Array<number | "auto">;
		/** Output formats. Default `["webp", "jpeg"]`. */
		formats?: FormatName[];
		/** The output's URL path without the width and extension, instead of a name from a hash: `"/assets/sponsors/acme"` writes `/assets/sponsors/acme-200.webp`. Without a leading `/`, it's inside the image output folder. */
		name?: string;
	}
}

declare module "ssqch/rss" {
	import type { BuiltinPlugin } from "ssqch";

	/** Adds the filters getNewestCollectionItemDate, dateToRfc3339, dateToRfc822, absoluteUrl, htmlToAbsoluteUrls and feedHtml. */
	export function rssPlugin(): BuiltinPlugin;
	/** Writes the site's feed (Atom, or RSS) from a collection, newest first, each entry's content as feedHtml makes it: `feedPlugin({ url: "https://example.com" })` writes /feed.xml from the `posts` collection. */
	export function feedPlugin(options: {
		/** The site's address, for the feed's whole links. Required. */
		url: string;
		/** The collection the entries come from: a tag (`posts`) or a collection of the config's. Default `"posts"`. */
		collection?: string;
		/** How many of the newest entries; 0 for all. Default 20. */
		limit?: number;
		/** `"atom"` (default) or `"rss"`. */
		format?: "atom" | "rss";
		/** Where it's written: a URL path to a file. Default `"/feed.xml"`. */
		output?: string;
		/** The feed's title. Default the site data's `site.title`. */
		title?: string;
		/** The feed's subtitle (RSS: description). Default the site data's `site.description`. */
		description?: string;
		/** Who writes it: a name, or `{ name, email }`. Default the title. */
		author?: string | { name: string; email?: string; url?: string };
	}): BuiltinPlugin;
	/** The newest `date` in a collection, for a feed's `updated`. */
	export function getNewestCollectionItemDate(collection: unknown[]): Date | undefined;
	/** A date as RFC 3339 (`2024-06-01T00:00:00Z`), for Atom feeds. */
	export function dateToRfc3339(date: Date | string): string;
	/** A date as RFC 822 (`Sat, 01 Jun 2024 00:00:00 +0000`), for RSS feeds. */
	export function dateToRfc822(date: Date | string): string;
	/** A URL made absolute against the site's address: `absoluteUrl(post.url, "https://example.com")`. As a template filter, it puts the site's `base` in front of a URL from the root that doesn't have it yet; called from code, it resolves as `new URL(url, base)` does. */
	export function absoluteUrl(url: string, base: string): string;
	/** Every link and image in some HTML made absolute, for a feed's content. */
	export function htmlToAbsoluteUrls(html: string, base: string): string;
	/** A post's HTML for a feed: each local image points at one generated copy (`width` 1200 and the source's format by default), a `<picture>`'s `<source srcset>` goes, page-only attributes go, and every URL is made absolute against `base`, the post's address. The images are made by the image plugin, so the config needs `imagePlugin()` too. */
	export function feedHtml(html: string, base: string, options?: { width?: number | "auto"; format?: string }): string;
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
		/** Drop boolean attributes' values (`defer="defer"` to `defer`) and extra whitespace in `class`, `srcset`, URLs and the viewport `<meta>` (whose numbers it writes as html-minifier-terser does: `initial-scale=1`). Default `true`. */
		shortenAttributes?: boolean;
	}

	/** `minifyPlugin()`'s options: the minifier's, and what else it minifies, all off by default. */
	export interface MinifyPluginOptions extends MinifyOptions {
		/** Compress each page's `<style>` elements with ssqch's Sass, as `minifyCss` does; one it can't read (Sass syntax, native CSS nesting) stays as it is, with a warning. Default `false`. */
		css?: boolean;
		/** Take the whitespace between tags out of `.xml`, `.rss` and `.atom` files (feeds, sitemaps), not inside text, CDATA or comments. Default `false`. */
		xml?: boolean;
		/** Write `.json` and `.webmanifest` files without spaces. Default `false`. */
		json?: boolean;
	}

	/** Minifies HTML output, after the image transform, with ssqch's own minifier (Rust, as WebAssembly): it doesn't write html-minifier-terser's bytes. With `css`, `xml` and `json`, inline CSS, feeds and manifests too. */
	export function minifyPlugin(options?: MinifyPluginOptions): BuiltinPlugin;
	/** Minify one string of HTML, with the plugin's options. */
	export function minify(html: string, options?: MinifyOptions): string;
	/** Compress CSS text as `style: "compressed"` Sass writes it (`.a{color:#fff}`), for CSS inlined by a template: `{{ css | minifyCss }}` in a filter of your own. Sass's own syntax, and CSS ssqch's Sass can't read (native nesting), is an error. */
	export function minifyCss(css: string): string;
}

declare module "ssqch/assets" {
	import type { BuiltinPlugin } from "ssqch";

	export interface AssetsPluginOptions {
		/** URL paths of files in the output to fingerprint, like `["/assets/index.css"]`. */
		files: string[];
		/** Default: production builds only. */
		fingerprint?: boolean;
		/** Add `integrity="sha384-..."` (subresource integrity) to the `<link>` and `<script>` elements that load a fingerprinted file. Default `false`. */
		integrity?: boolean;
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
		/** Fail the build on a broken link. Default: production builds only. A build lists the first 20 broken links; `--verbose` lists them all. */
		fail?: boolean;
		/** The site's address, like `"https://example.com"`, so absolute links to it are checked too. Default: the address `sitemap.xml` uses. */
		url?: string;
	}

	/** Checks every internal link and anchor after each build: in HTML attributes, `<meta>` URLs, JSON-LD, and feeds and other XML. */
	export function linksPlugin(options?: LinksPluginOptions): BuiltinPlugin;
}

declare module "ssqch/sitemap" {
	import type { BuiltinPlugin } from "ssqch";

	export interface SitemapPluginOptions {
		/** The site's address, like `"https://example.com"`: required, since a sitemap lists whole addresses and search engines read only those. With a `base`, it can be the domain or include the base. */
		url: string;
		/** URL globs to leave out, like `["/tags/**"]`. Pages with `sitemap: false` and 404 pages are always left out. */
		exclude?: string[];
		/** Add `<lastmod>` from each page's date. Default `true`. */
		lastmod?: boolean;
		/** Where to write it. Default `"/sitemap.xml"`. */
		output?: string;
		/** List every page of a list split into pages (`/2/`, `/3/`), not just the first. Pagination with `size: 1` (a page per tag, say) is always listed. Default `false`. */
		paginated?: boolean;
		/** A page's translations, as `<xhtml:link rel="alternate" hreflang>` links under its `<loc>` (Google's way to list them): a function that gets each page (`url`, `inputPath`, `outputPath`, `date`, `data`) and returns `[{ hreflang: "fr", href: "/fr/guide/" }]`, the page itself included, or nothing. An `href` from the site's root gets the `url` and `base` in front. It's called at once, for each page in the sitemap. */
		alternates?: (page: { url: string; inputPath: string; outputPath: string; date: Date; data: Record<string, any> }) => Array<{ hreflang: string; href: string }> | undefined | null;
	}

	/** Writes `sitemap.xml` listing every HTML page. */
	export function sitemapPlugin(options: SitemapPluginOptions): BuiltinPlugin;
}

declare module "ssqch/from-vitepress" {
	import type { BuiltinPlugin } from "ssqch";
	/** VitePress's Markdown, for a site moving from VitePress, and VitePress's ways for `vuePlugin()`'s components (`useData()` and the rest from "vitepress", `@theme/`, and `./x.data` imports running its data loaders): Vue's `<script>` and `<style>` blocks and `<ClientOnly>` left out, VitePress's markup for headings (`header-anchor`), links (`.html` with `urls: "html"`, external ones in a new tab), code blocks and tables, its `tip`, `info`, `warning`, `danger`, `details`, `raw` and `code-group` containers, `[[toc]]`, and, under the site's own `markdown` options, its heading ids and email autolinks. A site's own hook or container template of the same name replaces VitePress's. Takes no options. */
	export function fromVitepress(): BuiltinPlugin;
}

declare module "ssqch/from-mkdocs" {
	import type { BuiltinPlugin } from "ssqch";
	export interface FromMkdocsOptions {
		/** The mkdocs.yml, from the project root, that `templates` reads. Default `"mkdocs.yml"`. */
		config?: string;
		/** What MkDocs gives a theme's templates, so an MkDocs theme's Jinja (Material for MkDocs') runs as written: `config`, `nav`, `page` (with `content` and `toc` in layouts), `base_url`, the `url` filter, `main.html` (or a page's `template`) as a Markdown page's layout, the theme's `404.html` as the 404 page, and `.jinja` not escaping what it prints, as MkDocs' Jinja doesn't. Default `false`: turn it on once the theme's templates are in the site (`theme: "theme"`). */
		templates?: boolean;
	}
	/** MkDocs' Markdown for a site moving from MkDocs, each a default under the site's own `markdown` options: Python-Markdown's reading (`dialect: "python-markdown"`: raw HTML blocks to their closing tag, lists at four spaces), its toc's heading ids, `!!! note` admonitions and `=== "Tab"` tabs as Material writes them, and `.md` links from the page; and with `templates`, MkDocs' context for a theme's templates. */
	export function fromMkdocs(options?: FromMkdocsOptions): BuiltinPlugin;
}

declare module "ssqch/from-jekyll" {
	import type { BuiltinPlugin } from "ssqch";
	export interface FromJekyllOptions {
		/** Templates see Jekyll's `page` and `site`, so a Jekyll site's layouts and includes run as written: `page` has the page's front matter too (`page.title`; ssqch's own keys, like `url` and `date`, win), `page.path` and `page.categories`; `site` has the site's own keys, `posts` (newest first), each collection by its tag (`site.articles`), `pages`, `html_pages`, `categories`, `tags`, `data` (the global data) and `time`; and items read in Jekyll's shape (`post.title`, `post.content`, `post.excerpt`). Default `true`. */
		templates?: boolean;
		/** kramdown's Markdown, each a default under the site's own `markdown` options: Markdown inside HTML with `markdown="1"` (`htmlMarkdown: "kramdown"`), kramdown's heading ids (`headingIds: "kramdown"`), smart quotes (`smartPunctuation: true`) and no links from bare URLs (`autolinks: false`). Default `true`. */
		kramdown?: boolean;
	}
	/** What a Jekyll site's templates and Markdown expect, for a site moving from Jekyll: Jekyll's `page` and `site` in templates, and kramdown's Markdown. */
	export function fromJekyll(options?: FromJekyllOptions): BuiltinPlugin;
}

declare module "ssqch/from-hugo" {
	import type { BuiltinPlugin } from "ssqch";
	/** Hugo's shortcodes for a site moving from Hugo, as a default under the site's own `markdown` options (`shortcodes: "hugo"`): a shortcode on a line of its own (`{{< note type="tip" >}}` to `{{< /note >}}`, or `{{% %}}`) is a container rendered by `_includes/containers/<name>.*`, with its arguments as `container.props`, and one inside a line of text renders the same template in its place, with `container.inline` true. Takes no options. */
	export function fromHugo(): BuiltinPlugin;
}

declare module "ssqch/vue" {
	import type { BuiltinPlugin } from "ssqch";
	export interface VuePluginOptions {
		/** Components every page can use without importing them, by name: `{ VueSchoolLink: ".vitepress/theme/components/VueSchoolLink.vue" }` (VitePress's `app.component()`), paths from the project's root. A page's own come from its `<script setup>` imports. */
		components?: Record<string, string>;
		/** Vite's root for the build, from the project's root. Default: the input folder (VitePress's `srcDir`), so the components' scope ids are the ones VitePress gave them. */
		root?: string;
		/** Run each component in the browser too, as an island: `"load"` (at once), `"idle"` (when the browser is idle) or `"visible"` (when it scrolls into view). Its server HTML is wrapped in `<ssqch-vue>` and the page gets one script, `/assets/vue/islands.js`. Default `false`: HTML only. */
		hydrate?: false | "load" | "idle" | "visible";
		/** Where the components' styles go: a path like `"/assets/vue.css"` (the default), for the layout to link, or `false`. */
		css?: string | false;
		/** Vite's options to add (`resolve.alias`, more `plugins`), as a Vite config has them. */
		vite?: Record<string, unknown>;
	}
	/** Renders the Vue components a page uses (`<ApiIndex />`, imported in its `<script setup>`) with the site's own Vite, @vitejs/plugin-vue and Vue, at build time; with `hydrate`, as islands in the browser too. */
	export function vuePlugin(options?: VuePluginOptions): BuiltinPlugin;
}

declare module "ssqch/llms" {
	import type { BuiltinPlugin } from "ssqch";
	/** A page as `section` and `sort` get it. */
	export interface LlmsPage { url: string; inputPath: string; outputPath: string; date: Date; data: Record<string, any> }
	export interface LlmsPluginOptions {
		/** The `# heading` of `llms.txt`. Default: `site.title` in the site's data, or the home page's title. */
		title?: string;
		/** A line under it, as `> description`. */
		description?: string;
		/** Markdown after the description, in `llms.txt` and `llms-full.txt`: what a model should know before it reads on, like a list of where else the docs are. */
		details?: string;
		/** The site's address, like `"https://example.com"`, for whole links in `llms.txt` and in every copy. Default: links from the site's root. */
		url?: string;
		/** URL globs of pages to leave out, like `["/blog/**"]`. 404 pages are always left out, and so is a page whose front matter says `llms: false`. */
		exclude?: string[];
		/** A Markdown copy of each listed page beside its URL (`/guide/intro.html` is `/guide/intro.md`, and `/guide/intro/` is `/guide/intro/index.md`, as llms.txt's v2 proposal has them), which `llms.txt` links to. A Markdown page's copy is its Markdown after its template engine ran; another page's is its `<article>`, `<main>` or `<body>` as Markdown. Links in a copy are whole addresses, and a link to a page with a copy goes to the copy. Default `true`; with `false`, `llms.txt` links to the pages. */
		copies?: boolean;
		/** `/llms-full.txt`, every listed page's Markdown in one file, each after a `url:` line. Default `true`. */
		full?: boolean;
		/** A page's section in `llms.txt`: a function that gets each page and returns a name. Default: its first folder (`/guide/...` is "Guide"; the top's pages are "Pages"). Sections are in the order their first page comes, with "Optional" (links an agent can skip) last. Inside a file of `paths`, the default is the page's folder under that path. */
		section?: (page: LlmsPage) => string | undefined;
		/** The pages' order, as `Array.prototype.sort` takes it: `(a, b) => a.data.order - b.data.order`. Default: by URL. */
		sort?: (a: LlmsPage, b: LlmsPage) => number;
		/** Parts of the site with an `llms.txt` of their own, as llms.txt's v2 has them: `["/docs/"]` writes `/docs/llms.txt` with the pages under `/docs/`, and `/llms.txt` lists that file in their place. An item is a URL path that starts and ends with `/`, or an object with its `path` and the file's `title` (its heading; default the site's title and the folder's name), `description` and `details`. A page belongs to the deepest path it's under. A path with no listed pages writes no file, and the build warns. */
		paths?: Array<string | LlmsPath>;
		/** The most characters an `llms.txt` has: past it, pages from the end move into "Optional" without their descriptions until it fits. A file that wouldn't fit even so stays as it is, and the build warns. Default `50000` (where `ssqch patrol` warns); `false` for no limit. */
		budget?: number | false;
	}
	/** A part of the site with an `llms.txt` of its own, in `paths`. */
	export interface LlmsPath { path: string; title?: string; description?: string; details?: string }
	/** Writes `/llms.txt` (the site's pages, with links to their Markdown), a Markdown copy of each, and `/llms-full.txt`, for language models, as llmstxt.org describes; and adds the template functions `markdownCopy(page.url)`, the URL of a page's copy (or `""` when it has none), for a layout's `<link rel="alternate" type="text/markdown">`, and `llmsTxt(page.url)`, the `llms.txt` that covers the page, for its `<link rel="describedby">`. */
	export function llmsPlugin(options?: LlmsPluginOptions): BuiltinPlugin;
}

declare module "ssqch/robots" {
	import type { BuiltinPlugin } from "ssqch";
	export interface RobotsPluginOptions {
		/** What AI crawlers may do, by what they're for: `training` (collecting pages to train models: GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent, Bytespider), `search` (indexing them for an AI search: OAI-SearchBot, Claude-SearchBot, PerplexityBot) and `fetch` (reading a page a person asked about: ChatGPT-User, Claude-User, Perplexity-User, meta-externalfetcher). `false` gives that purpose's crawlers a group with `Disallow: /`. Each defaults to `true`: no group, so they read everyone's. */
		ai?: { training?: boolean; search?: boolean; fetch?: boolean };
		/** URL paths no crawler should read, like `["/drafts/"]`, as `Disallow:` lines in everyone's group. */
		disallow?: string[];
		/** The `Sitemap:` line: by default `sitemapPlugin()`'s address when it's on (none without it); `false` leaves it out; a string is another sitemap's whole address. */
		sitemap?: boolean | string;
	}
	/** Writes `/robots.txt`: the paths no crawler reads, a group for each kind of AI crawler that's turned off, and the sitemap's address. */
	export function robotsPlugin(options?: RobotsPluginOptions): BuiltinPlugin;
}

declare module "ssqch/elements" {
	import type { BuiltinPlugin } from "ssqch";

	export interface ElementsPluginOptions {
		/** The folder with the elements' files, relative to the project root. Default: `elements` in the input folder. */
		dir?: string;
		/** Where that folder goes in the output. Default `"/elements/"`. */
		url?: string;
		/** When scripts load, for tags without `ssqch:load`: with the page (`"eager"`, the default), when the browser is idle, or when the element scrolls into view. */
		load?: "eager" | "idle" | "visible";
	}

	/** Custom elements: `like-button.js` in the elements folder loads on the pages that have a `<like-button>`, and nowhere else. */
	export function elementsPlugin(options?: ElementsPluginOptions): BuiltinPlugin;
}

declare module "ssqch/redirects" {
	import type { BuiltinPlugin } from "ssqch";

	export interface RedirectsPluginOptions {
		/** Write a redirect page (meta refresh, canonical link, `noindex`) at each old URL. Default `true`, and `false` with `hostFile`, since a host serves a page that exists before it reads `_redirects`. */
		pages?: boolean;
		/** Add `/old /new 301` lines to `_redirects`, the file Netlify and Cloudflare read, after any your own `_redirects` template writes. Default `false`. (Called `netlify` before 0.14.) */
		hostFile?: boolean;
		/** Redirects that aren't a page's `aliases`: `{ "/old/": "/new/" }`. The new URL can be on another site. */
		redirects?: Record<string, string>;
		/** The not-found page's URL path (`"/404.html"`): with `hostFile`, the last line of `_redirects` is `/*  /404.html  404`, with the site's `base` in front of both. A host answers a miss with the 404 page by itself only at its domain's root, so a site served under a path needs this line, after every other. */
		notFound?: string;
	}

	/** Redirects from each page's `aliases` front matter and from `redirects`. */
	export function redirectsPlugin(options?: RedirectsPluginOptions): BuiltinPlugin;
}

declare module "ssqch/sass" {
	import type { BuiltinPlugin } from "ssqch";

	export interface SassPluginOptions {
		/** Sources (relative to the project root) to output URL paths. A folder compiles every `.scss` and `.sass` file in it that doesn't start with `_`, keeping their paths: `{ "src/scss": "/css" }`. A file compiles to the path given: `{ "src/app.scss": "/app.css" }`. */
		files: Record<string, string>;
		/** Default: `"compressed"` for production builds, `"expanded"` otherwise. */
		style?: "compressed" | "expanded";
		/** More folders `@use` and `@import` look in, relative to the project root. */
		loadPaths?: string[];
		/** `false` leaves out what CSS with a character outside ASCII starts with: a byte order mark (compressed) or `@charset "UTF-8";` (expanded). Default `true`. (Dart Sass's `--no-charset`; jekyll-sass-converter's CSS has neither.) */
		charset?: boolean;
	}

	/** Compiles Sass at the start of each build, with grass (Rust, as WebAssembly: no Dart Sass), so fingerprinting and the link checker see the CSS. */
	export function sassPlugin(options: SassPluginOptions): BuiltinPlugin;
}
