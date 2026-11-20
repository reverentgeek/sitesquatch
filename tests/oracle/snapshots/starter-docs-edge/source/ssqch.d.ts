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
		/** Where the page is written, or `false`. */
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
		/** Automatic heading `id`s: `"github"` (the default: GitHub's and github-slugger's anchors, character for character), `"blackfriday"` (Hugo's older style: `a-b` for `A -- B`), `"kramdown"` (Jekyll's: GitHub's ids for the page's headings, and kramdown's ASCII ones, `section` for none, for headings inside `markdown="1"` HTML), `"markdown-it-anchor"` (that plugin's default: the lowercase text with spaces as `-`, percent-encoded, `what%E2%80%99s-new%3F`), `"python-markdown"` (MkDocs': Python-Markdown's `toc` ids, ASCII, `cafe-notes` for `Café notes`), or `false` for none. A `{#id}` on the heading always wins. */
		headingIds?: "github" | "blackfriday" | "ascii" | "kramdown" | "markdown-it-anchor" | "python-markdown" | false | ((text: string) => string);
		/** `## Heading {#id .class key=value}`. Default `true`. */
		headingAttributes?: boolean;
		/** `[^1]` references, with the notes at the end of the page. Default `true`. */
		footnotes?: boolean;
		/** `- [ ]` and `- [x]` items. Default `true`. */
		taskLists?: boolean;
		/** Bare `https://` and `www.` URLs become links. `"fuzzy"` links bare domains (`example.com`, with a common or two-letter country TLD) and email addresses too, as markdown-it's `linkify` does. Default `true`. */
		autolinks?: boolean | "fuzzy";
		/** A single newline inside a paragraph (or a list item) becomes a `<br>`, as markdown-it's `breaks: true` makes it. Default `false`. */
		breaks?: boolean;
		/** An image (or a linked image) alone in a paragraph becomes `<figure><img alt=""><figcaption>its alt text</figcaption></figure>`, as markdown-it-implicit-figures with `figcaption: true` writes it. Default `false`. */
		figures?: boolean;
		/** GitHub's `> [!NOTE]` alerts: note, tip, important, warning and caution. Default `true`. */
		alerts?: boolean;
		/** `::: name args` blocks, rendered by `_includes/containers/name.*`. Default `true`. */
		containers?: boolean;
		/** A term, then `: definition` lines. Default `false`. */
		definitionLists?: boolean;
		/** Curly quotes, dashes and ellipses. Default `false`. */
		smartPunctuation?: boolean;
		/** Lines indented four spaces are code blocks. `false` renders them as ordinary Markdown (HTML indented inside Markdown, say); fences are still code. Default `true`. */
		indentedCode?: boolean;
		/** Link and image URLs are percent-encoded, as CommonMark's reference renderer writes them (`#كتابة` as `#%D9%83...`, `café.png` as `caf%C3%A9.png`). `false` writes them as the page has them, HTML-escaped only (`&` as `&amp;`), as kramdown (Jekyll) does; browsers go to the same place either way. A link or image hook gets the URL as written in both. Default `true`. */
		encodeUrls?: boolean;
		/** Highlight fenced code at build time, with `hl-*` classes. The build writes their stylesheet to `/highlight.css`, or to `css` (a URL path), or not at all with `css: false`. `languages` adds languages or replaces built-in ones. `classes` names the tokens as another highlighter does, so a site keeps its theme's CSS: `"prism"` (`token keyword`, `<pre class="language-js">`, marked lines as `<mark class="highlight-line highlight-line-active">`), `"pygments"` or `"chroma"` (Pygments' short names, `k`, `s`, `nf`, which MkDocs' and Hugo's themes style), or `{ keyword: "tok-keyword" }` for some kinds; the stylesheet uses the same names. Default `false`. */
		/** Markdown inside HTML, as Jekyll's kramdown reads it: `"kramdown"` renders the content of an element with `markdown="1"` (span-level for `p`, headings and inline elements, block-level for the others; `"block"` and `"span"` choose) and drops the attribute, and keeps kramdown's HTML rules: a block-level element is raw HTML to its end tag, blank lines and all. Default `false`: HTML is CommonMark's, and Markdown inside it stays text. */
		htmlMarkdown?: "kramdown" | false;
		/** MkDocs' admonitions: `"mkdocs"` writes `!!! note "Title"` (body indented four spaces) as Python-Markdown's `<div class="admonition note"><p class="admonition-title">Title</p>...</div>`, and `??? note` and `???+ note` (pymdownx.details) as `<details class="note">`, open with `+`. The title is the type's name when there's none, and left out for `""`. Default `false`. */
		admonitions?: "mkdocs" | false;
		/** MkDocs' content tabs: `"mkdocs"` writes `=== "Tab"` blocks (body indented four spaces; tabs one after another are one set, `===+` selected, `===!` a new set) as pymdownx.tabbed's `alternate_style` writes them (`<div class="tabbed-set tabbed-alternate">`), which Material's CSS styles. Default `false`. */
		tabs?: "mkdocs" | false;
		/** Hugo's shortcodes: `"hugo"` reads a shortcode on a line of its own as a container: `{{< note type="tip" >}}` to `{{< /note >}}` (or `{{% %}}`) renders `_includes/containers/note.*` with `container.args`, `container.props` and the content as Markdown; one with no closing tag has no content. A shortcode inside a line of text is left as written. Default `false`. */
		shortcodes?: "hugo" | false;
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
		inputPath: string;
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
		filters?: Record<string, (...args: any[]) => unknown>;
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

	export type Plugin =
		| ConfigParts
		| BuiltinPlugin
		| RustPlugin
		| ((context: ConfigContext) => MaybePromise<ConfigParts | BuiltinPlugin | RustPlugin | false | null | undefined>)
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
		/** Delete output files an earlier build wrote or copied that this one didn't (a deleted post's page). Files other tools write are never touched. Default `false`. */
		leaveNoTrace?: boolean;
		/** Another name for `leaveNoTrace`. Set one of them. */
		clean?: boolean;
		/** Globs (relative to the input folder) of files that aren't pages, like `["drafts/**", "notes/*.wip.md"]`. */
		ignore?: string | string[];
		/** Page bundles: copy the other files in a folder whose page is `index.*` (images, downloads) next to the page. Default `false`. */
		bundles?: boolean;
		/** Printing an undefined value (`{{ titel }}`) is an error, in every template language. Conditionals and defaults still work. Default `false`. */
		strict?: boolean;
		/** Start a template's body at its first line with text, dropping the blank lines after the closing `---`, as Jekyll does (its layouts and includes print no blank line there). Off by default: the body starts on the line after `---`, as Eleventy and gray-matter have it. */
		trimAfterFrontMatter?: boolean;
		/** Templates see Jekyll's `page` and `site`, so a Jekyll site's layouts and includes run as written: `page` has the page's front matter too (`page.title`; ssqch's own keys, like `url` and `date`, win) and `page.path` and `page.categories`; `site` has the site's own keys, `posts` (newest first), each collection by its tag (`site.articles`), `pages`, `html_pages`, `categories`, `tags`, `data` (the global data) and `time`; and their items read in Jekyll's shape (`post.title`, `post.content`, `post.excerpt`). Off by default: front matter is at the top level (`title`) and items keep it under `data`. */
		jekyllTemplates?: boolean;
		/** `page.lastModified`: `"git"` for the last commit that changed the page's file (its modification time when it has uncommitted changes), or `"file"` for the modification time. Off by default. Needs the full history in CI (`fetch-depth: 0`). */
		lastModified?: "git" | "file" | false;
		/** The date of a page with no date of its own (in its data or its file name): `"git"` for the last commit that changed its file, the same in every checkout, or `"file"` (the default) for the file's modification time, which is when the checkout wrote it. Either way it sorts after the dated pages, by path. Needs the full history in CI (`fetch-depth: 0`). */
		dateFallback?: "git" | "file";
		/** The time zone the site's own JavaScript runs in, as an IANA name (`"UTC"`, `"America/New_York"`): `Date`'s local methods and libraries like luxon and date-fns, in data files, filters, hooks and Edge templates, so a laptop and CI build the same pages. ssqch's own date filters are UTC whatever this says. Default: the machine's. The config's own top-level code runs before it applies. */
		timeZone?: string;
		/** Other names for layouts: `{ post: "layouts/post.njk" }` makes `layout: post` that file (where it would be `_includes/post.*`), as Eleventy's `addLayoutAlias` did. A page's `layout` is still the name it gave. */
		layoutAliases?: Record<string, string>;
		/** The path the site is served under, when that isn't the root of its domain: `"/repo/"` for `https://you.github.io/repo/`. Templates and `page.url` stay as they are; ssqch adds the base to URLs from the site's root in the HTML it writes. Use the `withBase()` filter outside HTML attributes. */
		base?: string;
		/** A theme under the site: a folder (`"themes/docs"`), or a git repository pinned to a tag or a commit's full hash (`"https://github.com/you/theme#v1.2.0"`, with `#v1.2.0:folder` for a theme in a folder of its repository), fetched once and kept in `.cache/ssqch/themes/`. The site's own includes, data, pages and files win over the theme's, one by one. In a list, earlier themes sit on top of later ones. */
		theme?: ThemeSource | ThemeSource[];
		/** Content schemas, by name: `{ posts: { fields: { title: "string", date: "date" } } }` checks every page tagged `posts`. */
		schemas?: Record<string, Schema>;
		/** Size budgets by kind of file, checked after each build: a file over its kind's budget is an `over-budget` warning. Sizes are bytes or strings like `"150 KB"` and `"1.5 MB"` (powers of 1,000). */
		budgets?: Partial<Record<"pages" | "images" | "css" | "javascript" | "fonts" | "media" | "documents" | "data" | "other" | "total", number | string>>;
		/** What `ssqch serve` runs besides the server. (The server builds in a process of its own, starts it again when the config or a module it imports changes, and listens on 127.0.0.1 only.) */
		serve?: {
			/** Programs to start with the server and stop with it, like the watchers of your CSS and JavaScript tools: `["npx postcss src/app.css -o dist/app.css --watch"]`. Their output is shown with the tool's name in front. They get `SSQCH_ENV`, `SSQCH_SERVING` (`true`), `SSQCH_QUIET`, `SSQCH_INPUT` and `SSQCH_OUTPUT`, as build commands do. Builds don't run them. */
			run?: string | string[];
		};
	}

	/** Returns its argument. It's there so the config reads as one, and for these types. */
	export function defineConfig<T extends Config | ((context: ConfigContext) => MaybePromise<Config>)>(config: T): T;
	/** Render Markdown with the site's `markdown` options (render hooks and containers are for templates). `inline` drops the `<p>` around a single paragraph: `markdown(text, { inline: true })`, or `markdown(text, "inline")` as in templates. */
	export function markdown(text: string, options?: { inline?: boolean } | "inline"): string;
	/** Read a JSON, YAML or TOML file (from the project root) into data: `readData("src/_data/sites/en.yml")`. */
	export function readData(path: string): any;
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
		/** Delete generated images the build didn't use. Only for full builds. */
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
	/** A post's HTML for a feed: each local image points at one generated copy (`width` 1200 and the source's format by default), page-only attributes go, and every URL is made absolute against `base`, the post's address. The images are made by the image plugin, so the config needs `imagePlugin()` too. */
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
		/** The site's address, like `"https://example.com"`. Without one (or with `""`, as a Jekyll site's `url` often is), each `<loc>` is a path from the site's root, as jekyll-sitemap writes it, and every build warns: search engines read only whole addresses. */
		url?: string;
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
		/** Write a redirect page (meta refresh, canonical link, `noindex`) at each old URL. Default `true`. */
		pages?: boolean;
		/** Add `/old /new 301` lines to `_redirects`, after any your own `_redirects` template writes. Default `false`. */
		netlify?: boolean;
		/** Redirects that aren't a page's `aliases`: `{ "/old/": "/new/" }`. The new URL can be on another site. */
		redirects?: Record<string, string>;
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
		/** `false` leaves out what CSS with a character outside ASCII starts with: a byte order mark (compressed) or `@charset "UTF-8";` (expanded), as Dart Sass's `--no-charset` does and jekyll-sass-converter's output has it. Default `true`. */
		charset?: boolean;
	}

	/** Compiles Sass at the start of each build, with grass (Rust, as WebAssembly: no Dart Sass), so fingerprinting and the link checker see the CSS. */
	export function sassPlugin(options: SassPluginOptions): BuiltinPlugin;
}
