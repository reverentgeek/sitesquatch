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
import path from "node:path";
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile, PageSummary } from "../config.ts";
import { decodeEntities } from "../content.ts";
import { bail } from "../diagnostics.ts";
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

/** A section's name from a page's first folder: `/guide/intro.html` is "Guide", `/api-reference/` is "Api reference", the top's pages are "Pages". */
function sectionOf(url: string): string {
	const first = url.split("/").filter(Boolean);
	if (first.length < 2 && !url.endsWith("/")) return "Pages";
	if (first.length === 0) return "Pages";
	const name = first[0].replace(/[-_]+/g, " ");
	return name.charAt(0).toUpperCase() + name.slice(1);
}

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

BUILTINS.set("ssqch/llms", (config: Config, given) => {
	if (given !== null && typeof given === "object" && Object.hasOwn(given, "hint")) bail("`hint` is gone: a build adds no markup of its own. Link the copy from your layout's <head> instead: <link rel=\"alternate\" type=\"text/markdown\" href=\"{{ markdownCopy(page.url) }}\">");
	const o = new Options(given, ["title", "description", "details", "url", "exclude", "copies", "full", "section", "sort"]);
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

	config.generators.push(["ssqch/llms", (config, pages) => {
		const base = config.base.replace(/\/$/, "");
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

		const entries: Array<{ url: string; copy: string; title: string; description: string; section: string; markdown: string }> = [];
		for (const p of chosen) {
			const source = sources.get(p.url);
			let body = source !== undefined ? pageText(source) : converted.get(p.url) ?? "";
			const pageTitle = oneLine(p.data.title) || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || titles.get(p.url) || p.url;
			// A page whose title is only in its front matter (or its layout) starts with it, as the
			// page shows it. Only a heading the page starts with counts: a `#` further down can be a
			// shell comment in a code block.
			if (!/^#\s/.test(body) && oneLine(p.data.title)) body = `# ${oneLine(p.data.title)}\n\n${body}`;
			body = rewriteLinks(body, (href) => target(href, p));
			let name = sectionOf(p.url);
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
		let txt = head;
		const sections = new Map<string, typeof entries>();
		for (const e of entries) sections.set(e.section, [...(sections.get(e.section) ?? []), e]);
		for (const [name, list] of sections) {
			txt += `\n## ${name}\n\n`;
			for (const e of list) txt += `- [${e.title.replace(/([[\]])/g, "\\$1")}](${whole(copies ? e.copy : e.url)})${e.description ? `: ${e.description}` : ""}\n`;
		}
		files.push({ path: "/llms.txt", contents: txt });
		if (copies) for (const e of entries) files.push({ path: e.copy, contents: e.markdown });
		if (full) files.push({ path: "/llms-full.txt", contents: `${head}\n${entries.map((e) => `---\nurl: ${whole(e.url)}\n---\n\n${e.markdown}`).join("\n")}` });
		return files;
	}]);
});
