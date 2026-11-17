// The functions every template has, whatever the site defines. A config filter with the same
// name replaces one.
import { withBase } from "./base.ts";
import type { Config, Filter } from "./config.ts";
import { escapeText, htmlText, splitWhitespace, toc } from "./content.ts";
import { isPlainObject } from "./data.ts";
import { BuildError } from "./diagnostics.ts";
import type { Markdown } from "./engines/markdown.ts";
import { breadcrumbsOf, fromPages, pagerOf, treeOf } from "./nav.ts";
import { slugOptions, slugWith } from "./slug.ts";

/** The built-in functions, with what each does, for `ssqch docs`. A test keeps it the same as what `builtinFilters` makes. */
export const BUILTIN_FILTERS: ReadonlyArray<readonly [string, string]> = [
	["markdown", "`markdown(text)` renders Markdown with the site's options; `markdown(text, \"inline\")` without the `<p>`."],
	["toc", "`toc(page.headings)` is a table of contents; `toc(page.headings, { from: 2, to: 4, ordered: true })` picks the levels."],
	["navTree", "`navTree(nav, page.url)` marks a navigation tree's entries `current`, `ancestor` or `open`."],
	["navPager", "`navPager(nav, page.url)` is `{ previous, next }` in reading order."],
	["navBreadcrumbs", "`navBreadcrumbs(nav, page.url)` is the entries from the top down to the page."],
	["pagesTree", "`pagesTree(collections.docs)` builds a navigation tree from pages' `nav` front matter."],
	["highlight", "`highlight(code, lang)` is highlighted HTML for inside a `<code>`, with `hl-*` classes."],
	["readingTime", "`readingTime(content)` is the minutes it takes to read some HTML, at 200 words a minute."],
	["withBase", "`withBase(\"/feed.xml\")` puts the site's `base` in front of a URL, for places outside HTML attributes."],
	["slugify", "`slugify(\"Pine Cone Crunch!\")` is `pine-cone-crunch`: lowercase letters and digits, with a dash for each run of anything else; `slugify(title, { separator: \"_\" })` uses another separator, and `apostrophes: \"separate\"` splits words at an apostrophe instead of dropping it."],
];

export function builtinFilters(markdown: Markdown, config: Config): Map<string, Filter> {
	const filters = new Map<string, Filter>();
	filters.set("markdown", (text: unknown, option?: unknown) => {
		const inline = option === "inline" || (isPlainObject(option) && Boolean(option.inline));
		return markdown.html(text === undefined || text === null ? "" : String(text), inline);
	});
	// highlight(code, lang): highlighted HTML for the inside of <code> (escaped text for a
	// language without a highlighter).
	filters.set("highlight", (...args: unknown[]) => {
		const code = args.length > 0 ? String(args[0]) : "";
		const lang = args.length > 1 ? String(args[1]) : "";
		return markdown.highlight(code, lang) ?? escapeText(code);
	});
	// The page's URL is the second argument as a string, as a template would print it.
	const urlArg = (args: unknown[]) => (args.length > 1 ? String(args[1]) : "");
	filters.set("navTree", (...args: unknown[]) => treeOf(args[0], urlArg(args)));
	filters.set("navPager", (...args: unknown[]) => pagerOf(args[0], urlArg(args)));
	filters.set("navBreadcrumbs", (...args: unknown[]) => breadcrumbsOf(args[0], urlArg(args)));
	filters.set("pagesTree", (...args: unknown[]) => fromPages(Array.isArray(args[0]) ? args[0] : []));
	filters.set("slugify", (text: unknown, option?: unknown) => {
		const [separator, apostrophes] = slugOptions(option);
		return slugWith(String(text), separator, apostrophes);
	});
	filters.set("readingTime", (text: unknown, wordsPerMinute?: unknown) => {
		const wpm = typeof wordsPerMinute === "number" && wordsPerMinute > 0 ? wordsPerMinute : 200;
		const words = splitWhitespace(htmlText(String(text))).length;
		return Math.max(Math.ceil(words / wpm), 1);
	});
	filters.set("toc", (list: unknown, option?: unknown, last?: unknown) => {
		const headings = Array.isArray(list) ? list : [];
		let [from, to, ordered] = [2, 3, false];
		if (isPlainObject(option)) {
			for (const key of Object.keys(option)) {
				if (!["from", "to", "ordered"].includes(key)) throw new BuildError(`toc: unknown option \`${key}\` (options: from, to, ordered)`);
			}
			if (typeof option.from === "number") from = option.from;
			if (typeof option.to === "number") to = option.to;
			ordered = Boolean(option.ordered);
		} else if (typeof option === "number") {
			from = option;
			to = typeof last === "number" ? last : Math.max(to, from);
		}
		const level = (n: number) => Math.trunc(Math.min(Math.max(n, 1), 6));
		return toc(headings, level(from), level(to), ordered);
	});
	// withBase("/feed.xml"): the URL with the site's `base` in front, for places outside HTML
	// attributes (which the build rewrites itself).
	filters.set("withBase", (url?: unknown) => withBase(config.base, url === undefined ? "" : String(url)));
	return filters;
}
