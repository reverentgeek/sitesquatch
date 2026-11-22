// `ssqch/llms`: the site for language models, as llmstxt.org describes it. After the pages are
// written, `/llms.txt` lists the site's pages (each one's title, a link to its Markdown, and its
// description), grouped by the site's top folders; each of them gets a Markdown copy beside its
// URL (`/guide/intro.html` and `/guide/intro.md`); and `/llms-full.txt` has every copy in one file.
//
// A copy is what the page says, not the file it came from. A Markdown page's copy is its Markdown
// after its template engine ran (`{{ site.title }}` is the title, a `{% for %}` is the list it
// made), which is the text ssqch's Markdown read. A page from a template (a home page in Jinja)
// is its HTML as Markdown (src/html-markdown.ts). Either way its links are whole addresses, and a
// link to a page with a copy goes to the copy, so an agent that reads one can follow the rest.
//
// A build adds no markup of its own: `markdownCopy(page.url)` is the copy's URL for a layout's
// `<link rel="alternate" type="text/markdown">`, and an empty string for a page that has none.
import fs from "node:fs";
import path from "node:path";
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile, PageSummary } from "../config.ts";
import { decodeEntities } from "../content.ts";
import { bail, warn, warning } from "../diagnostics.ts";
import { globSet } from "../glob.ts";
import { htmlToMarkdown, rewriteLinks } from "../html-markdown.ts";
import { compareText } from "../paths.ts";
import { currentRendering } from "../rendering.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

export function llmsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/llms", builtin: "ssqch/llms", options };
}

/**
 * Where a page's Markdown copy goes, as llms.txt's v2 proposal (2026) puts it: a URL with a file
 * name has its extension replaced (`/guide/intro.html` is `/guide/intro.md`), and one without
 * gets `index.md` (`/guide/intro/` is `/guide/intro/index.md`, `/` is `/index.md`).
 */
export function copyUrl(url: string): string {
	if (url.endsWith("/")) return `${url}index.md`;
	return url.replace(/\.html?$/, "") + ".md";
}

/** A folder's name as a heading: `api-reference` is "Api reference". */
function folderName(folder: string): string {
	const name = folder.replace(/[-_]+/g, " ");
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The length past which `llms.txt` moves pages into "Optional": patrol's `llms-long` limit, what an agent reads before it decides. */
const BUDGET = 50_000;

/** A section's name from a page's first folder: `/guide/intro.html` is "Guide", `/api-reference/` is "Api reference", the top's pages are "Pages". */
function sectionOf(url: string): string {
	const first = url.split("/").filter(Boolean);
	if (first.length < 2 && !url.endsWith("/")) return "Pages";
	if (first.length === 0) return "Pages";
	return folderName(first[0]);
}

/** 50000 as "50,000", without Intl (its output changes between Node releases). */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A value as an error shows it: a string quoted, anything else as JSON. */
const shown = (v: unknown) => (typeof v === "string" ? debugString(v) : (JSON.stringify(v) ?? typeof v));
const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const isPageUrl = (url: string) => url.endsWith("/") || url.endsWith(".html");

/** A page's URL as one key: `/guide/index.html` is `/guide/`. */
const keyOf = (url: string) => url.replace(/\/index\.html$/, "/");

/**
 * What isn't the page's text in its Markdown, outside code: `<script>` and `<style>` blocks (a
 * VitePress page's `<script setup>`), and lines that are only a picture with `alt=""`, which the
 * HTML spec calls decoration (a sticker floated beside a section).
 */
function pageText(markdown: string): string {
	const out: string[] = [];
	let fenced: string | undefined;
	let raw: string | undefined;
	for (const line of markdown.split("\n")) {
		if (raw !== undefined) {
			if (new RegExp(`</${raw}\\s*>`, "i").test(line)) raw = undefined;
			continue;
		}
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fenced !== undefined) {
			if (marker && marker[0] === fenced[0] && marker.length >= fenced.length && line.trim() === marker) fenced = undefined;
			out.push(line);
			continue;
		}
		if (marker) { fenced = marker; out.push(line); continue; }
		const open = /^\s{0,3}<(script|style)\b/i.exec(line);
		if (open) {
			if (!new RegExp(`</${open[1]}\\s*>`, "i").test(line)) raw = open[1].toLowerCase();
			continue;
		}
		if (/^\s*(?:<img\b[^>]*\balt=(?:""|'')[^>]*>\s*)+$/i.test(line)) continue;
		// One blank line between blocks, however many a template's tags left.
		if (line.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
		out.push(line);
	}
	return out.join("\n").replace(/^\s+/, "");
}

/**
 * A copy's pictures at the addresses the page shows them at: an image plugin (`imagePlugin()`)
 * publishes resized copies under new names and rewrites the page's `<img>`, while the copy has
 * the source's path, which isn't published. Each picture takes the page's address for the picture
 * with the same `alt`, in order (two pictures can share one), from the page as it was written.
 */
function publishedImages(markdown: string, outputPath: string, base: string, output: string): string {
	let html: string;
	try { html = fs.readFileSync(outputPath, "utf8"); } catch { return markdown; }
	const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);
	const byAlt = new Map<string, string[]>();
	for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
		const alt = decodeEntities(attr(tag, "alt") ?? "");
		let src = attr(tag, "src");
		if (src === undefined || /^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
		src = decodeEntities(src);
		// The page's own URLs have the site's `base`; the copy's are from the site's root, as written.
		if (base && src.startsWith(`${base}/`)) src = src.slice(base.length);
		byAlt.set(alt, [...(byAlt.get(alt) ?? []), src]);
	}
	// The page's links by their text, for a copy's link to a source file the page links published.
	const byText = new Map<string, string[]>();
	for (const [, href, text] of html.matchAll(/<a\b[^>]*\shref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
		const key = decodeEntities(text.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
		if (key) byText.set(key, [...(byText.get(key) ?? []), base && href.startsWith(`${base}/`) ? href.slice(base.length) : href]);
	}
	if (!byAlt.size && !byText.size) return markdown;
	const next = (alt: string) => byAlt.get(alt)?.shift();
	// One pass, so Markdown's pictures and raw `<img>` tags take their addresses in the page's order.
	// What each source path became, for a link to it (a picture that links to its full size).
	const became = new Map<string, string>();
	const out = !byAlt.size ? markdown : markdown.replace(/(!\[([^\]]*)\]\()(<[^>]*>|[^\s)]+)|<img\b[^>]*>/gi, (whole, open?: string, alt?: string, dest?: string) => {
		if (open !== undefined) {
			const src = next((alt ?? "").replace(/\\(.)/g, "$1"));
			if (src === undefined) return whole;
			became.set((dest ?? "").replace(/^<|>$/g, ""), src);
			return open + src;
		}
		const src = next(decodeEntities(attr(whole, "alt") ?? ""));
		if (src === undefined) return whole;
		const was = attr(whole, "src");
		if (was !== undefined) became.set(decodeEntities(was), src);
		return whole.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${src}"`);
	});
	// A link from the site's root to a file the build doesn't have.
	const missing = (href: string) => href.startsWith("/") && !href.startsWith("//") && !fs.existsSync(path.join(output, decodeURIComponent(href.split(/[?#]/)[0])));
	return out
		.replace(/(\[([^\]]*)\]\()([^\s)]+)/g, (whole, open: string, text: string, href: string) => {
			if (became.has(href)) return open + became.get(href);
			const instead = missing(href) ? byText.get(text.replace(/\\(.)/g, "$1").replace(/[*_`]/g, "").trim())?.find((h) => !missing(h)) : undefined;
			return instead === undefined ? whole : open + instead;
		})
		.replace(/(<a\b[^>]*\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (whole, open: string, d?: string, q?: string) => { const href = decodeEntities(d ?? q ?? ""); return became.has(href) ? `${open}"${became.get(href)}"` : whole; });
}

/** A part of the site with an llms.txt of its own (`paths`). */
interface LlmsFile { path: string; title?: string; description?: string; details?: string }

/** A listed page: its section is the one `section()` gave, or undefined for its folder's. */
interface Entry { url: string; copy: string; title: string; description: string; section: string | undefined; markdown: string }

/**
 * An llms.txt: its heading, then a `##` section for each name, in the order of their first item,
 * with "Optional" last (llms.txt's convention for links an agent can skip when its context is
 * short). Past `budget` characters, pages from the end move into "Optional" without their notes
 * until it fits; a file that wouldn't fit even so stays as it is, and the build says so.
 */
function listing(head: string, items: Array<{ section: string; line: string; short: string }>, budget: number, file: string): string {
	const render = (list: typeof items) => {
		const sections = new Map<string, string[]>();
		for (const item of list) sections.set(item.section, [...(sections.get(item.section) ?? []), item.line]);
		const optional = sections.get("Optional");
		if (optional) { sections.delete("Optional"); sections.set("Optional", optional); }
		let txt = head;
		for (const [name, lines] of sections) txt += `\n## ${name}\n\n${lines.join("")}`;
		return txt;
	};
	let txt = render(items);
	if (txt.length <= budget) return txt;
	// What moving each page saves, counted rather than rendered again for each: its note, less the
	// "Optional" heading the first one adds. A section a move empties saves its heading too, which
	// this doesn't count, so it can move a page or two more than it had to.
	const moved = items.map((item) => ({ ...item }));
	let over = txt.length - budget + (items.some((i) => i.section === "Optional") ? 0 : "\n## Optional\n\n".length);
	// When moving every page wouldn't make it fit, moving them only hides pages: leave them.
	const most = items.reduce((n, i) => n + (i.section === "Optional" ? 0 : i.line.length - i.short.length), 0);
	if (most < over) {
		warn(warning("build", `llmsPlugin: ${file} is ${grouped(txt.length)} characters, over the budget of ${grouped(budget)} even without its pages' notes: give a part of the site an llms.txt of its own (paths: ["/docs/"]), or raise budget`));
		return txt;
	}
	for (let i = moved.length - 1; i >= 0 && over > 0; i--) {
		if (moved[i].section === "Optional") continue;
		over -= moved[i].line.length - moved[i].short.length;
		moved[i] = { section: "Optional", line: moved[i].short, short: moved[i].short };
	}
	return render(moved);
}

BUILTINS.set("ssqch/llms", (config: Config, given) => {
	if (given !== null && typeof given === "object" && Object.hasOwn(given, "hint")) bail("`hint` is gone: a build adds no markup of its own. Link the copy from your layout's <head> instead: <link rel=\"alternate\" type=\"text/markdown\" href=\"{{ markdownCopy(page.url) }}\">");
	const o = new Options(given, ["title", "description", "details", "url", "exclude", "copies", "full", "section", "sort", "paths", "budget"]);
	const url = o.string("url");
	if (url !== undefined && url !== "" && !/^https?:\/\//.test(url)) bail(`url must be the site's address, like "https://example.com" (got ${debugString(url)})`);
	const exclude = o.list("exclude") ?? [];
	for (const glob of exclude) if (!glob.startsWith("/")) bail(`exclude: ${debugString(glob)} must be a URL path or glob starting with /, like "/blog/**"`);
	const excluded = exclude.length ? globSet("exclude", exclude) : () => false;
	const copies = o.bool("copies") ?? true;
	const full = o.bool("full") ?? true;
	const section = o.get("section");
	if (section !== undefined && typeof section !== "function") bail(`section must be a function that gets each page and returns its section's name, like (page) => page.data.category (got ${typeof section})`);
	const sort = o.get("sort");
	if (sort !== undefined && typeof sort !== "function") bail(`sort must be a function that compares two pages, like (a, b) => a.data.order - b.data.order (got ${typeof sort})`);
	const title = o.string("title");
	const description = o.string("description");
	const details = o.string("details");
	const address = (url ?? "").replace(/\/+$/, "");
	const givenBudget = o.get("budget");
	if (givenBudget !== undefined && givenBudget !== false && !(typeof givenBudget === "number" && Number.isInteger(givenBudget) && givenBudget > 0)) bail(`budget must be a number of characters, like 50000, or false for no limit (got ${shown(givenBudget)})`);
	const budget = givenBudget === false ? Infinity : (givenBudget as number | undefined) ?? BUDGET;
	// The parts of the site with an llms.txt of their own, most specific first, so a page belongs
	// to the deepest one it's under (llms.txt's v2: "agents should use the most specific one").
	const paths: LlmsFile[] = [];
	const givenPaths = o.get("paths");
	if (givenPaths !== undefined && !Array.isArray(givenPaths)) bail(`paths must be a list of URL paths that get an llms.txt of their own, like ["/docs/"] (got ${shown(givenPaths)})`);
	for (const item of (givenPaths ?? []) as unknown[]) {
		const one = typeof item === "string" ? { path: item } : item;
		if (one === null || typeof one !== "object" || typeof (one as Record<string, unknown>).path !== "string") bail(`paths: each one is a URL path like "/docs/", or { path: "/docs/", title, description, details } (got ${shown(item)})`);
		const { path: at, ...rest } = one as Record<string, unknown>;
		for (const [key, value] of Object.entries(rest)) {
			if (!["title", "description", "details"].includes(key)) bail(`paths: ${shown(at)} has \`${key}\`, which isn't an option; it takes title, description and details`);
			if (typeof value !== "string") bail(`paths: ${shown(at)}'s ${key} must be a string (got ${shown(value)})`);
		}
		const folder = at as string;
		if (!folder.startsWith("/") || !folder.endsWith("/") || folder === "/") bail(`paths: ${shown(folder)} must be a folder's URL path, starting and ending with /, like "/docs/" (/llms.txt is the site's)`);
		if (paths.some((f) => f.path === folder)) bail(`paths: ${shown(folder)} is listed twice`);
		paths.push({ path: folder, ...(rest as { title?: string; description?: string; details?: string }) });
	}
	paths.sort((a, b) => b.path.length - a.path.length || compareText(a.path, b.path));
	/** The llms.txt that covers a URL: the deepest of `paths` it's under, or the site's. */
	const coveringFile = (pageUrl: string) => paths.find((f) => pageUrl.startsWith(f.path))?.path ?? "/";

	/** Whether a page at `pageUrl` gets a copy: written as HTML, not excluded, not a 404. Its front matter's `llms: false` is checked where the data is. */
	const listedUrl = (pageUrl: string) => isPageUrl(pageUrl) && !excluded(pageUrl) && pageUrl !== "/404.html" && pageUrl !== "/404/";
	const listed = (p: PageSummary) => p.outputPath.endsWith(".html") && listedUrl(p.url) && p.data.llms !== false;

	// Each Markdown page's text as its Markdown engine got it (src/build.ts keeps it while this
	// plugin is on), and each other page's HTML as Markdown, before `base` and the site's own
	// transforms. Emptied after each build.
	const sources = new Map<string, string>();
	config.markdownSources = sources;
	const converted = new Map<string, string>();
	// A template page's `<title>`, for its name in llms.txt when it has no title or heading of its own.
	const titles = new Map<string, string>();
	config.htmlTransforms.push(["llms", (html, page) => {
		if (copies || full) {
			if (page.outputPath.endsWith(".html") && listedUrl(page.url)) {
				if (!sources.has(page.url)) converted.set(page.url, htmlToMarkdown(html));
				const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
				if (title) titles.set(page.url, decodeEntities(title).replace(/\s+/g, " ").trim());
			}
		}
		return html;
	}]);

	// `markdownCopy(page.url)`: the copy's URL, or "" when the page has none, so a layout can
	// write `{% if markdownCopy(page.url) %}<link ...>{% endif %}`.
	config.filters.set("markdownCopy", (value: unknown) => {
		const pageUrl = value === undefined || value === null ? "" : String(value);
		if (!copies || !listedUrl(pageUrl)) return "";
		const data = currentRendering()?.data;
		const page = data?.page as { url?: unknown } | undefined;
		if (page && page.url === pageUrl && data?.llms === false) return "";
		return copyUrl(pageUrl);
	});

	// `llmsTxt(page.url)`: the llms.txt that covers the page, for a layout's
	// `<link rel="describedby">` (`/docs/llms.txt` for a page under a path in `paths`).
	config.filters.set("llmsTxt", (value: unknown) => `${coveringFile(value === undefined || value === null ? "/" : String(value))}llms.txt`);

	config.generators.push(["ssqch/llms", (config, pages) => {
		const base = config.base.replace(/\/$/, "");
		const output = path.resolve(config.root, config.output);
		const whole = (u: string) => `${address}${base}${u}`;
		const files: GeneratedFile[] = [];
		const chosen = pages.filter(listed).sort((a, b) => compareText(a.url, b.url));
		if (typeof sort === "function") {
			try { chosen.sort(sort as (a: PageSummary, b: PageSummary) => number); } catch (e) { bail(`sort(): ${e instanceof Error ? e.message : String(e)}`); }
		}
		// Links go to a page's copy when it has one: by URL, and by source file for a relative
		// `.md` link (`[Install](install.md)`, which GitHub follows too).
		// A page without a copy (`llms: false`, excluded) is linked as it is.
		const withCopy = new Set(chosen);
		const byUrl = new Map(pages.map((p) => [keyOf(p.url), p]));
		const byFile = new Map(pages.map((p) => [path.resolve(p.inputPath), p]));
		const linkTo = (page: PageSummary) => (copies && withCopy.has(page) ? copyUrl(page.url) : page.url);
		const target = (href: string, from: PageSummary): string => {
			if (href === "" || href.startsWith("#") || href.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) return href;
			const cut = href.search(/[?#]/);
			const [file, rest] = cut === -1 ? [href, ""] : [href.slice(0, cut), href.slice(cut)];
			if (/\.(?:md|markdown)$/i.test(file) && !file.startsWith("/")) {
				const page = byFile.get(path.resolve(path.dirname(from.inputPath), decodeURIComponent(file)));
				if (page) return whole(linkTo(page)) + rest;
			}
			let resolved: string;
			try { resolved = new URL(file, `https://ssqch.invalid${from.url}`).pathname; } catch { return href; }
			const page = byUrl.get(keyOf(resolved)) ?? byUrl.get(keyOf(`${resolved}/`));
			return whole(page ? linkTo(page) : resolved) + rest;
		};

		const entries: Entry[] = [];
		for (const p of chosen) {
			const source = sources.get(p.url);
			let body = source !== undefined ? pageText(source) : converted.get(p.url) ?? "";
			const pageTitle = oneLine(p.data.title) || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || titles.get(p.url) || p.url;
			// A page whose title is only in its front matter (or its layout) starts with it, as the
			// page shows it. Only a heading the page starts with counts: a `#` further down can be a
			// shell comment in a code block.
			if (!/^#\s/.test(body) && oneLine(p.data.title)) body = `# ${oneLine(p.data.title)}\n\n${body}`;
			body = publishedImages(body, p.outputPath, base, output);
			body = rewriteLinks(body, (href) => target(href, p));
			let name: string | undefined;
			if (typeof section === "function") {
				let out: unknown;
				try { out = (section as (page: PageSummary) => unknown)(p); } catch (e) { bail(`section(), for ${p.url}: ${e instanceof Error ? e.message : String(e)}`); }
				if (typeof out === "string" && out.trim() !== "") name = out.trim();
			}
			entries.push({ url: p.url, copy: copyUrl(p.url), title: pageTitle, description: oneLine(p.data.description), section: name, markdown: body.replace(/\s+$/, "") + "\n" });
		}
		sources.clear();
		converted.clear();
		titles.clear();
		// The site's title: the option, or `site.title` in its data (`_data/site.json`), or the home page's.
		const site = pages[0]?.data.site;
		const siteTitle = title ?? (oneLine(site !== null && typeof site === "object" ? (site as Record<string, unknown>).title : undefined) || entries.find((e) => e.url === "/")?.title || "Pages");
		let head = `# ${siteTitle}\n`;
		if (description) head += `\n> ${oneLine(description)}\n`;
		if (details?.trim()) head += `\n${details.trim()}\n`;
		// Each llms.txt lists its own pages, and in place of the pages under a part of the site with
		// a file of its own, that file, once, where its first page would be.
		const written = paths.filter((f) => {
			if (entries.some((e) => coveringFile(e.url) === f.path)) return true;
			warn(warning("build", `llmsPlugin: no listed pages under ${f.path}, so ${f.path}llms.txt isn't written (paths in ssqch.config.js)`));
			return false;
		});
		const fileFor = (pageUrl: string) => written.find((f) => pageUrl.startsWith(f.path))?.path ?? "/";
		/** The file `inner` is listed in: the deepest written one above it. */
		const parentOf = (inner: string) => written.find((f) => f.path !== inner && inner.startsWith(f.path))?.path ?? "/";
		const nameOf = (f: LlmsFile) => f.title ?? folderName(f.path.split("/").filter(Boolean).at(-1) ?? "");
		const link = (title: string, href: string, note: string) => `- [${title.replace(/([[\]])/g, "\\$1")}](${href})${note ? `: ${note}` : ""}\n`;
		for (const file of [{ path: "/" } as LlmsFile, ...written]) {
			const items: Array<{ section: string; line: string; short: string }> = [];
			const listedFiles = new Set<string>();
			for (const e of entries) {
				let at = fileFor(e.url);
				if (at === file.path) {
					const name = e.section ?? sectionOf(`/${e.url.slice(file.path.length)}`);
					items.push({ section: name, line: link(e.title, whole(copies ? e.copy : e.url), e.description), short: link(e.title, whole(copies ? e.copy : e.url), "") });
					continue;
				}
				// A page in a file under this one: list the file that's directly under this one.
				if (file.path !== "/" && !at.startsWith(file.path)) continue;
				while (at !== "/" && parentOf(at) !== file.path) at = parentOf(at);
				if (at === "/" || listedFiles.has(at)) continue;
				listedFiles.add(at);
				const inner = written.find((f) => f.path === at) as LlmsFile;
				const name = e.section ?? sectionOf(`/${e.url.slice(file.path.length)}`);
				items.push({ section: name, line: link(nameOf(inner), whole(`${inner.path}llms.txt`), oneLine(inner.description)), short: link(nameOf(inner), whole(`${inner.path}llms.txt`), "") });
			}
			let top = head;
			if (file.path !== "/") {
				top = `# ${file.title ?? `${siteTitle}: ${nameOf(file)}`}\n`;
				if (file.description) top += `\n> ${oneLine(file.description)}\n`;
				if (file.details?.trim()) top += `\n${file.details.trim()}\n`;
			}
			files.push({ path: `${file.path}llms.txt`, contents: listing(top, items, budget, `${file.path}llms.txt`) });
		}
		if (copies) for (const e of entries) files.push({ path: e.copy, contents: e.markdown });
		if (full) files.push({ path: "/llms-full.txt", contents: `${head}\n${entries.map((e) => `---\nurl: ${whole(e.url)}\n---\n\n${e.markdown}`).join("\n")}` });
		return files;
	}]);
});
