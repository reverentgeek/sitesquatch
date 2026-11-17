// The `markdown` config key: which of Markdown's extensions are on. The option names and the
// checks are 0.7's; the engine that reads them is the built-in Markdown.
import { bail } from "./diagnostics.ts";
import { isPlainObject } from "./data.ts";
import { closest } from "./suggest.ts";

export type Slugger = "github" | "blackfriday" | "ascii";

export interface MarkdownOptions {
	/** Automatic heading `id`s (GitHub style by default), or `null` for none. An explicit `{#id}` always wins. */
	headingIds: Slugger | null;
	/** `## Heading {#id .class key=value}`. */
	headingAttributes: boolean;
	/** `[^1]` references, with the notes collected at the end of the page. */
	footnotes: boolean;
	/** `- [ ]` and `- [x]` list items. */
	taskLists: boolean;
	/** Bare `https://` and `www.` URLs become links. */
	autolinks: boolean;
	/** GitHub's `> [!NOTE]` alerts (note, tip, important, warning, caution). */
	alerts: boolean;
	/** `::: name args` blocks. */
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
	/** Languages the site adds or replaces (`highlight: { languages }`): a function, another language's name, or a `.sublime-syntax` file. */
	languages: Array<[string, ((code: string, lang: string) => unknown) | { alias: string } | { grammar: string }]>;
	/** A slugger of the site's own (`headingIds: text => id`), used instead of `headingIds` when set. Repeats still get `-1`, `-2`. */
	sluggerFn: ((text: string) => unknown) | null;
}

export function defaultMarkdownOptions(): MarkdownOptions {
	return {
		headingIds: "github",
		headingAttributes: true,
		footnotes: true,
		taskLists: true,
		autolinks: true,
		alerts: true,
		containers: true,
		definitionLists: false,
		smartPunctuation: false,
		indentedCode: true,
		highlight: false,
		highlightCss: "/highlight.css",
		languages: [],
		sluggerFn: null,
	};
}

/** The option names in `ssqch.config.js` (`markdown: { headingIds: "blackfriday" }`). */
export const MARKDOWN_KEYS = ["headingIds", "headingAttributes", "footnotes", "taskLists", "autolinks", "alerts", "containers", "definitionLists", "smartPunctuation", "indentedCode", "highlight"] as const;

const FLAGS = ["headingAttributes", "footnotes", "taskLists", "autolinks", "alerts", "containers", "definitionLists", "smartPunctuation", "indentedCode"] as const;

/** JavaScript's `typeof`, with a list or `null` as "object": how these errors name a value's type. */
const typeOf = (v: unknown) => typeof v;

/** Applies a `markdown` object from the config. Errors start with the key (`markdown.footnotes must be true or false`). */
export function applyMarkdownOptions(options: MarkdownOptions, value: unknown): void {
	if (!isPlainObject(value)) bail(`markdown must be an object, not ${typeOf(value)}`);
	for (const [key, v] of Object.entries(value)) {
		if (key === "headingIds") {
			// `headingIds: text => id`: a slugger of the site's own.
			if (typeof v === "function") { options.sluggerFn = v as (text: string) => unknown; options.headingIds = "github"; }
			else if (v === false || v === null) options.headingIds = null;
			else if (v === true) options.headingIds = "github";
			else if (typeof v === "string") {
				if (v !== "github" && v !== "blackfriday" && v !== "ascii") bail(`markdown.headingIds: unknown slugger "${v}" (use "github", "blackfriday", "ascii" or false)`);
				options.headingIds = v;
			} else bail(`markdown.headingIds must be "github", "blackfriday", "ascii" or false, not ${typeOf(v)}`);
		} else if (key === "highlight") {
			if (typeof v === "boolean") options.highlight = v;
			else if (isPlainObject(v)) {
				options.highlight = true;
				for (const [k, setting] of Object.entries(v)) {
					if (k === "css") {
						if (setting === false || setting === null) options.highlightCss = null;
						else if (typeof setting === "string" && setting.startsWith("/") && !setting.includes("..")) options.highlightCss = setting;
						else bail(`markdown.highlight.css must be a path like "/assets/highlight.css", or false, not ${typeof setting === "string" ? `"${setting}"` : typeOf(setting)}`);
					} else if (k === "languages") {
						if (!isPlainObject(setting)) bail(`markdown.highlight.languages must be an object of { name: highlighter }, not ${typeOf(setting)}`);
						for (const [name, language] of Object.entries(setting)) setLanguage(options, name, language);
					} else bail(`markdown.highlight.${k} isn't an option (options: css, languages)`);
				}
			} else bail(`markdown.highlight must be true, false or { css, languages }, not ${typeOf(v)}`);
		} else if ((FLAGS as readonly string[]).includes(key)) {
			if (typeof v !== "boolean") bail(`markdown.${key} must be true or false, not ${typeOf(v)}`);
			options[key as typeof FLAGS[number]] = v;
		} else {
			const near = closest(key, MARKDOWN_KEYS);
			bail(`markdown.${key} isn't an option${near ? ` (did you mean \`${near}\`?)` : ""} (options: ${MARKDOWN_KEYS.join(", ")})`);
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
