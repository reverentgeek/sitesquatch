// The `markdown` config key: which of Markdown's extensions are on. The option names and the
// checks are 0.7's; the engine that reads them is the built-in Markdown.
import { bail } from "./diagnostics.ts";
import { isPlainObject } from "./data.ts";
import { closest } from "./suggest.ts";
import { pythonMarkdownSlug } from "./engines/markdown-dialects.ts";
import { vitepressSlug } from "./engines/vitepress-dialect.ts";

export type Slugger = "github" | "blackfriday" | "ascii" | "kramdown" | "markdown-it-anchor";

export interface MarkdownOptions {
	/** Automatic heading `id`s (GitHub style by default), or `null` for none. An explicit `{#id}` always wins. */
	headingIds: Slugger | null;
	/** `## Heading {#id .class key=value}`. */
	headingAttributes: boolean;
	/** `[^1]` references, with the notes collected at the end of the page. */
	footnotes: boolean;
	/** `- [ ]` and `- [x]` list items. */
	taskLists: boolean;
	/** Bare `https://` and `www.` URLs become links; `"email"` email addresses too, `"fuzzy"` bare domains (`example.com`) and email addresses, as markdown-it's `linkify` does. */
	autolinks: boolean | "fuzzy" | "email";
	/** A single newline in a paragraph is a `<br>`, as markdown-it's `breaks: true` makes it. */
	breaks: boolean;
	/** An image alone in a paragraph is a `<figure>` with its alt text as the `<figcaption>`, as markdown-it-implicit-figures makes it. */
	figures: boolean;
	/** GitHub's `> [!NOTE]` alerts (note, tip, important, warning, caution). */
	alerts: boolean;
	/** `::: name args` blocks; a `:::` indented less than four spaces closes the innermost open one, as markdown-it-container reads them. */
	containers: boolean;
	/** `Term` followed by `: definition` lines. */
	definitionLists: boolean;
	/** Curly quotes, dashes and ellipses. */
	smartPunctuation: boolean;
	/** Lines indented four spaces are code. Off, they're ordinary Markdown; fences are still code. */
	indentedCode: boolean;
	/** Highlight fenced code at build time. */
	highlight: boolean;
	/** Where the build writes the highlighting stylesheet (a URL path like `/highlight.css`), or `null` to leave it out. */
	highlightCss: string | null;
	/** Another highlighter's class names for the tokens (`highlight: { classes }`): `names` by kind, and `prism` for Prism's `<pre>` and marked lines too. */
	highlightClasses: { names: Record<string, string>; prism: boolean } | null;
	/** Languages the site adds or replaces (`highlight: { languages }`): a function, another language's name, or a `.sublime-syntax` file. */
	languages: Array<[string, ((code: string, lang: string) => unknown) | { alias: string } | { grammar: string }]>;
	/** A slugger of the site's own (`headingIds: text => id`), used instead of `headingIds` when set. Repeats still get `-1`, `-2`. */
	sluggerFn: ((text: string) => unknown) | null;
	/** Markdown inside HTML: `"kramdown"` reads `markdown="1"` elements' content as Markdown, with kramdown's HTML rules around them; `false` leaves HTML as CommonMark does. */
	htmlMarkdown: "kramdown" | false;
	/** MkDocs' `!!! note "Title"` and `??? note` blocks (`"mkdocs"`), written as Python-Markdown's admonition and pymdownx.details write them. */
	admonitions: "mkdocs" | false;
	/** MkDocs' `=== "Tab"` blocks (`"mkdocs"`), written as pymdownx.tabbed's alternate style writes them. */
	tabs: "mkdocs" | false;
	/** Hugo's shortcodes on lines of their own (`"hugo"`) as containers: `{{< note >}}` to `{{< /note >}}` renders `_includes/containers/note.*`. */
	shortcodes: "hugo" | false;
	/** Links to `.md` files go to the page built from that file: `true` from the site's root, `"relative"` from the page, as MkDocs writes them. */
	sourceLinks: boolean | "relative";
	/** A function of the site's that changes a page's Markdown before ssqch reads it: `(source, data) => source`. */
	preprocess: ((source: string, data: Record<string, unknown>) => unknown) | null;
	/** `"python-markdown"`: what Python-Markdown (MkDocs') reads and writes differently from CommonMark, as it does: raw HTML blocks to their closing tag, lists nested at four spaces, `"` in text, XHTML's void tags. */
	dialect: "python-markdown" | "vitepress" | null;
	/** The site's `urls` is `"html"`: the `vitepress` dialect's links get `.html`. Set from the config, not from `markdown`. */
	htmlUrls: boolean;
	/** Plugins' Markdown steps (a plugin's `markdown: { before, after, hooks }`), in the order the plugins are listed. Set from the plugins, not from `markdown`. */
	steps: MarkdownSteps;
	/** TeX between `$` and `$$` is math, kept as written (`math: true`), and rendered with the site's KaTeX at build time with `render: "katex"`; `null` when it's off. */
	math: MathOptions | null;
}

/** `markdown.math` when it's on. */
export interface MathOptions {
	/** `"katex"`: each formula rendered with the site's own `katex` package while the site builds; `null` leaves the TeX for a script in the page (KaTeX's auto-render or MathJax). */
	render: "katex" | null;
	/** KaTeX's own options for `renderToString` (`macros`, `strict`, `trust`...), with `displayMode` set by ssqch for each formula. */
	katex: Record<string, unknown>;
}

/** What a plugin's Markdown step or hook gets besides its text: the page, and the engine's own tools. */
export interface StepContext {
	/** The page's data, as its templates see it (`page`, front matter, global data). */
	data: Record<string, unknown>;
	/** The page (`data.page`): `url`, `inputPath` and the rest. */
	page: Record<string, unknown> | undefined;
	/** The site's `urls`: `"html"` writes `/guide/intro.html`. */
	urls: "folders" | "html";
	/** Markdown rendered with the site's options and hooks (`{ inline: true }` without the `<p>`). */
	markdown(text: string, options?: { inline?: boolean }): string;
	/** Whether the site (or a plugin) has the render hook or container `name` (`containers/tip`). */
	hasHook(name: string): boolean;
	/** The render hook `name` with `value`, as ssqch's Markdown calls it: the site's template if it has one, else a plugin's. */
	renderHook(name: string, key: string, value: Record<string, unknown>): string;
}

/** A plugin's render hook: what the template of the same name would write. */
export type HookFn = (value: Record<string, unknown>, context: StepContext) => string;

export interface MarkdownSteps {
	/** The page's Markdown before ssqch's reads it. */
	before: Array<[where: string, step: (source: string, context: StepContext) => string]>;
	/** The HTML ssqch's Markdown wrote, before the page's layouts. */
	after: Array<[where: string, step: (html: string, context: StepContext) => string]>;
	/** Render hooks and containers (`heading`, `containers/tip`), which a site's template of the same name replaces. */
	hooks: Map<string, [where: string, hook: HookFn]>;
}

export function defaultMarkdownOptions(): MarkdownOptions {
	return {
		headingIds: "github",
		headingAttributes: true,
		footnotes: true,
		taskLists: true,
		autolinks: true,
		breaks: false,
		figures: false,
		alerts: true,
		containers: true,
		definitionLists: false,
		smartPunctuation: false,
		indentedCode: true,
		highlight: false,
		highlightCss: "/highlight.css",
		highlightClasses: null,
		languages: [],
		sluggerFn: null,
		htmlMarkdown: false,
		admonitions: false,
		tabs: false,
		shortcodes: false,
		sourceLinks: false,
		preprocess: null,
		dialect: null,
		htmlUrls: false,
		steps: { before: [], after: [], hooks: new Map() },
		math: null,
	};
}

/** The option names in `ssqch.config.js` (`markdown: { headingIds: "blackfriday" }`). */
export const MARKDOWN_KEYS = ["headingIds", "headingAttributes", "footnotes", "taskLists", "autolinks", "alerts", "containers", "definitionLists", "smartPunctuation", "indentedCode", "highlight", "breaks", "figures", "sourceLinks", "preprocess", "math"] as const;

const FLAGS = ["headingAttributes", "footnotes", "taskLists", "alerts", "definitionLists", "smartPunctuation", "indentedCode", "breaks", "figures"] as const;

/** What a highlighted token can be: the `hl-*` names, without the prefix. */
export const HIGHLIGHT_KINDS = ["comment", "keyword", "operator", "string", "regexp", "escape", "number", "constant", "builtin", "property", "attribute", "function", "type", "parameter", "tag", "heading", "strong", "emphasis", "link", "inserted", "deleted"] as const;

/** Prism's names for each kind, the ones Prism's themes color (`.token.keyword`). */
/** Pygments' short class names (`.k`, `.s`, `.nf`), which its themes and Chroma's (Hugo's highlighter) color: MkDocs' and Hugo's stylesheets keep working. */
export const PYGMENTS_CLASSES: Record<string, string> = { comment: "c", keyword: "k", operator: "o", string: "s", regexp: "sr", escape: "se", number: "m", constant: "kc", builtin: "nb", property: "py", attribute: "na", function: "nf", type: "nc", parameter: "nv", tag: "nt", heading: "gh", strong: "gs", emphasis: "ge", link: "nl", inserted: "gi", deleted: "gd" };

export const PRISM_CLASSES: Record<string, string> = { comment: "token comment", keyword: "token keyword", operator: "token operator", string: "token string", regexp: "token regex", escape: "token escape", number: "token number", constant: "token constant", builtin: "token builtin", property: "token property", attribute: "token attr-name", function: "token function", type: "token class-name", parameter: "token parameter", tag: "token tag", heading: "token title", strong: "token bold", emphasis: "token italic", link: "token url", inserted: "token inserted", deleted: "token deleted" };

/** `classes: "prism"`, or `{ kind: "class names" }` for some kinds. */
function highlightClasses(value: unknown): MarkdownOptions["highlightClasses"] {
	if (value === "prism") return { names: { ...PRISM_CLASSES }, prism: true };
	if (value === "pygments" || value === "chroma") return { names: { ...PYGMENTS_CLASSES }, prism: false };
	if (!isPlainObject(value)) bail(`markdown.highlight.classes must be "prism", "pygments" or an object of { kind: "class names" }, not ${typeof value === "string" ? `"${value}"` : typeOf(value)}`);
	const names: Record<string, string> = {};
	for (const [kind, classes] of Object.entries(value)) {
		if (!(HIGHLIGHT_KINDS as readonly string[]).includes(kind)) {
			const near = closest(kind, HIGHLIGHT_KINDS);
			bail(`markdown.highlight.classes.${kind} isn't a kind of token${near ? ` (did you mean \`${near}\`?)` : ""} (kinds: ${HIGHLIGHT_KINDS.join(", ")})`);
		}
		if (typeof classes !== "string" || !/^-?[A-Za-z_][\w-]*(?: -?[A-Za-z_][\w-]*)*$/.test(classes.trim())) bail(`markdown.highlight.classes.${kind} must be class names, like "tok-keyword", not ${typeof classes === "string" ? `"${classes}"` : typeOf(classes)}`);
		names[kind] = classes.trim();
	}
	return { names, prism: false };
}

/** JavaScript's `typeof`, with a list or `null` as "object": how these errors name a value's type. */
const typeOf = (v: unknown) => typeof v;

/**
 * Options that were another generator's ways, now each the job of a module (`fromJekyll()` and the
 * rest, the audit's plan, step 6): a site's config that sets one is told which. The modules set
 * them themselves (`applyMarkdownOptions(..., "module")`).
 */
const RETIRED_MARKDOWN: Record<string, (value: unknown) => string> = {
	dialect: (v) => (v === "vitepress" ? "fromVitepress() from \"ssqch/from-vitepress\"" : "fromMkdocs() from \"ssqch/from-mkdocs\""),
	admonitions: () => "fromMkdocs() from \"ssqch/from-mkdocs\"",
	tabs: () => "fromMkdocs() from \"ssqch/from-mkdocs\"",
	shortcodes: () => "fromHugo() from \"ssqch/from-hugo\"",
	htmlMarkdown: () => "fromJekyll() from \"ssqch/from-jekyll\"",
};

/** Applies a `markdown` object: the site's config's (`"site"`), or a built-in module's own settings (`"module"`). Errors start with the key (`markdown.footnotes must be true or false`). */
export function applyMarkdownOptions(options: MarkdownOptions, value: unknown, from: "site" | "module" = "site"): void {
	if (!isPlainObject(value)) bail(`markdown must be an object, not ${typeOf(value)}`);
	if (from === "site") {
		for (const [key, v] of Object.entries(value)) {
			// `false` and `null` turned it off, which is where a site without the module is already.
			if (Object.hasOwn(RETIRED_MARKDOWN, key) && v !== false && v !== null && v !== undefined) bail(`markdown.${key} is ${RETIRED_MARKDOWN[key](v)} now: add it to plugins, and leave markdown.${key} out (\`ssqch docs ${RETIRED_MARKDOWN[key](v).split("(")[0]}\`)`);
		}
	}
	for (const [key, v] of Object.entries(value)) {
		if (key === "headingIds") {
			// `headingIds: text => id`: a slugger of the site's own.
			if (typeof v === "function") { options.sluggerFn = v as (text: string) => unknown; options.headingIds = "github"; }
			else if (v === false || v === null) options.headingIds = null;
			else if (v === true) options.headingIds = "github";
			else if (typeof v === "string") {
				// Python-Markdown's (MkDocs') ids are a function of the text, so they're a slugger function of ssqch's own.
				if (v === "python-markdown") { options.sluggerFn = pythonMarkdownSlug; options.headingIds = "github"; continue; }
				// VitePress's (@mdit-vue/shared's `slugify`).
				if (v === "vitepress") { options.sluggerFn = vitepressSlug; options.headingIds = "github"; continue; }
				if (!["github", "blackfriday", "ascii", "kramdown", "markdown-it-anchor"].includes(v)) bail(`markdown.headingIds: unknown slugger "${v}" (use "github", "blackfriday", "ascii", "kramdown", "markdown-it-anchor", "python-markdown", "vitepress" or false)`);
				options.headingIds = v as Slugger;
			} else bail(`markdown.headingIds must be "github", "blackfriday", "ascii", "kramdown", "markdown-it-anchor", "python-markdown", "vitepress" or false, not ${typeOf(v)}`);
		} else if (key === "htmlMarkdown") {
			if (v !== false && v !== "kramdown") bail(`markdown.htmlMarkdown must be "kramdown" or false, not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
			options.htmlMarkdown = v;
		} else if (key === "admonitions" || key === "tabs") {
			if (v !== false && v !== "mkdocs") bail(`markdown.${key} must be "mkdocs" or false, not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
			options[key] = v;
		} else if (key === "shortcodes") {
			if (v !== false && v !== "hugo") bail(`markdown.shortcodes must be "hugo" or false, not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
			options.shortcodes = v;
		} else if (key === "dialect") {
			if (v !== "python-markdown" && v !== "vitepress" && v !== null && v !== false) bail(`markdown.dialect: unknown dialect ${typeof v === "string" ? `"${v}"` : typeOf(v)} (use "python-markdown", "vitepress", or false for CommonMark's)`);
			options.dialect = v === "python-markdown" || v === "vitepress" ? v : null;
		} else if (key === "preprocess") {
			if (v !== null && v !== false && typeof v !== "function") bail(`markdown.preprocess must be a function (source, data) => source, not ${typeOf(v)}`);
			options.preprocess = typeof v === "function" ? (v as MarkdownOptions["preprocess"]) : null;
		} else if (key === "sourceLinks") {
			if (typeof v !== "boolean" && v !== "relative") bail(`markdown.sourceLinks must be true, false or "relative", not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
			options.sourceLinks = v;
		} else if (key === "highlight") {
			if (typeof v === "boolean") options.highlight = v;
			else if (isPlainObject(v)) {
				options.highlight = true;
				for (const [k, setting] of Object.entries(v)) {
					if (k === "css") {
						if (setting === false || setting === null) options.highlightCss = null;
						else if (typeof setting === "string" && setting.startsWith("/") && !setting.includes("..")) options.highlightCss = setting;
						else bail(`markdown.highlight.css must be a path like "/assets/highlight.css", or false, not ${typeof setting === "string" ? `"${setting}"` : typeOf(setting)}`);
					} else if (k === "classes") {
						options.highlightClasses = highlightClasses(setting);
					} else if (k === "languages") {
						if (!isPlainObject(setting)) bail(`markdown.highlight.languages must be an object of { name: highlighter }, not ${typeOf(setting)}`);
						for (const [name, language] of Object.entries(setting)) setLanguage(options, name, language);
					} else bail(`markdown.highlight.${k} isn't an option (options: classes, css, languages)`);
				}
			} else bail(`markdown.highlight must be true, false or { classes, css, languages }, not ${typeOf(v)}`);
		} else if (key === "math") {
			options.math = mathOptions(v);
		} else if (key === "autolinks") {
			if (typeof v !== "boolean" && v !== "fuzzy" && v !== "email") bail(`markdown.autolinks must be true, false, "email" or "fuzzy", not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
			options.autolinks = v;
		} else if (key === "containers") {
			// `"markdown-it"` (0.12) is what `true` does now (the audit's plan, step 7).
			if (v === "markdown-it") bail("markdown.containers: \"markdown-it\" is what `containers: true` does now (a closing `:::` indented under a list closes its container): write true, or leave it out");
			if (typeof v !== "boolean") bail(`markdown.containers must be true or false, not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
			options.containers = v;
		} else if ((FLAGS as readonly string[]).includes(key)) {
			if (typeof v !== "boolean") bail(`markdown.${key} must be true or false, not ${typeOf(v)}`);
			options[key as typeof FLAGS[number]] = v;
		} else if (key === "encodeUrls") {
			// Taken out (the audit's plan, 2026-11-21): it was there so a move could match kramdown's bytes.
			bail("markdown.encodeUrls is gone: link and image URLs are percent-encoded, as CommonMark writes them, and browsers go to the same place either way (so does `ssqch diff`). Leave it out");
		} else {
			const near = closest(key, MARKDOWN_KEYS);
			bail(`markdown.${key} isn't an option${near ? ` (did you mean \`${near}\`?)` : ""} (options: ${MARKDOWN_KEYS.join(", ")})`);
		}
	}
	// VitePress's markdown-it, for what the site doesn't set itself: its heading ids, linkify
	// without bare domains, and markdown-it-container's closing `:::`.
}

/** `markdown.math`: `true`, `false`, or `{ render: "katex", katex: { ... } }`. */
function mathOptions(v: unknown): MarkdownOptions["math"] {
	if (v === false || v === null) return null;
	if (v === true) return { render: null, katex: {} };
	if (!isPlainObject(v)) bail(`markdown.math must be true, false or { render: "katex", katex }, not ${typeof v === "string" ? `"${v}"` : typeOf(v)}`);
	const math: MathOptions = { render: null, katex: {} };
	for (const [k, setting] of Object.entries(v)) {
		if (k === "render") {
			if (setting === "katex") math.render = "katex";
			else if (setting === false || setting === null) math.render = null;
			else bail(`markdown.math.render must be "katex" (KaTeX renders each formula while the site builds) or false (a script in the page renders them), not ${typeof setting === "string" ? `"${setting}"` : typeOf(setting)}`);
		} else if (k === "katex") {
			if (!isPlainObject(setting)) bail(`markdown.math.katex must be an object of KaTeX's options, like { macros: { "\\RR": "\\mathbb{R}" } }, not ${typeOf(setting)}`);
			math.katex = setting;
		} else {
			const near = closest(k, ["render", "katex"]);
			bail(`markdown.math.${k} isn't an option${near ? ` (did you mean \`${near}\`?)` : ""} (options: render, katex)`);
		}
	}
	if (Object.keys(math.katex).length && math.render !== "katex") bail("markdown.math.katex is KaTeX's options for rendering at build time: add render: \"katex\", or give them to the KaTeX script in your layout");
	return math;
}

/** The keys a plugin's `markdown` part can have. */
const STEP_KEYS = ["before", "after", "hooks"];

/** A plugin's `markdown: { before, after, hooks }`, added to the site's steps in the order the plugins are listed. A later plugin's hook of the same name replaces an earlier one's. */
export function addMarkdownSteps(steps: MarkdownSteps, where: string, value: unknown): void {
	if (!isPlainObject(value)) bail(`${where}: markdown must be an object of { before, after, hooks }`);
	for (const key of Object.keys(value)) if (!STEP_KEYS.includes(key)) bail(`${where}: markdown.${key} isn't a plugin's Markdown step${closest(key, STEP_KEYS) ? ` (did you mean \`${closest(key, STEP_KEYS)}\`?)` : ""} (a plugin's markdown has before, after and hooks; the site's own options go in the config's markdown, or in the plugin's defaults)`);
	for (const key of ["before", "after"] as const) {
		const fn = value[key];
		if (fn === undefined) continue;
		if (typeof fn !== "function") bail(`${where}: markdown.${key} must be a function, (${key === "before" ? "source" : "html"}, context) => text`);
		steps[key].push([where, fn as (text: string, context: StepContext) => string]);
	}
	if (value.hooks !== undefined) {
		if (!isPlainObject(value.hooks)) bail(`${where}: markdown.hooks must be an object of { name: (value, context) => html }, like { heading: ..., "containers/tip": ... }`);
		for (const [name, hook] of Object.entries(value.hooks)) {
			if (typeof hook !== "function") bail(`${where}: markdown.hooks["${name}"] must be a function, (value, context) => html`);
			// `heading` is the engine's `hooks/heading`; `containers/tip` is as it is.
			steps.hooks.set(/^(?:hooks|containers)\//.test(name) ? name : `hooks/${name}`, [where, hook as HookFn]);
		}
	}
}

/** Adds a language (or replaces it). A name is the first word of a fence's info string, so it can't have spaces, braces or commas. */
function setLanguage(options: MarkdownOptions, name: string, value: unknown): void {
	let language: MarkdownOptions["languages"][number][1];
	if (typeof value === "function") language = value as (code: string, lang: string) => unknown;
	else if (typeof value === "string" && value.endsWith(".sublime-syntax")) language = { grammar: value };
	else if (typeof value === "string" && /[/\\]/.test(value)) bail(`markdown.highlight.languages.${name}: "${value}" isn't a .sublime-syntax file (a grammar's file name ends with .sublime-syntax)`);
	else if (typeof value === "string" && value.trim() !== "") language = { alias: value.trim().toLowerCase() };
	else bail(`markdown.highlight.languages.${name} must be a function (code, lang) => tokens, another language's name, or a path to a .sublime-syntax file, not ${typeOf(value)}`);
	if (name === "" || /[\s{},`]/.test(name)) bail(`markdown.highlight.languages: "${name}" can't be a language's name; a fence's language is one word (\`chordpro\`, \`cho\`)`);
	const lower = name.toLowerCase();
	const entry = options.languages.find(([n]) => n === lower);
	if (entry) entry[1] = language;
	else options.languages.push([lower, language]);
}
