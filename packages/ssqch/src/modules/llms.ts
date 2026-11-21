// `ssqch/llms`: the site for language models, as llmstxt.org describes it. After the pages are
// written, `/llms.txt` lists every page that came from Markdown (its title, a link to its Markdown,
// and its description), grouped by the site's top folders; each of those pages gets a Markdown copy
// beside its URL (`/guide/intro.html` and `/guide/intro.md`); and `/llms-full.txt` has every page's
// Markdown in one file. vitepress-plugin-llms does this for VitePress sites (vuejs.org's 96 files),
// and an agent reading the docs gets the source rather than the rendered page.
//
// A page links to its copy only when `hint` asks: a build adds no markup of its own otherwise.
import fs from "node:fs";
import path from "node:path";
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile, PageSummary } from "../config.ts";
import { parseFrontMatter } from "../data.ts";
import { bail } from "../diagnostics.ts";
import { vitepressBefore } from "../engines/vitepress-dialect.ts";
import { globSet } from "../glob.ts";
import { compareText } from "../paths.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

export function llmsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/llms", builtin: "ssqch/llms", options };
}

/** Where a page's Markdown copy goes: `/guide/intro.html` and `/guide/intro/` are `/guide/intro.md`, `/guide/` (an index page) is `/guide.md`, and `/` is `/index.md`. */
export function copyUrl(url: string): string {
	if (url === "/") return "/index.md";
	const bare = url.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/\/$/, "");
	return `${bare}.md`;
}

/** A section's name from a page's first folder: `/guide/intro.html` is "Guide", `/api-reference/` is "Api reference", the top's pages are "Pages". */
function sectionOf(url: string): string {
	const first = url.split("/").filter(Boolean);
	if (first.length < 2 && !url.endsWith("/")) return "Pages";
	if (first.length === 0) return "Pages";
	const name = first[0].replace(/[-_]+/g, " ");
	return name.charAt(0).toUpperCase() + name.slice(1);
}

const isMarkdown = (file: string) => /\.(?:md|markdown)$/i.test(file);
const oneLine = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

BUILTINS.set("ssqch/llms", (config: Config, given) => {
	const o = new Options(given, ["title", "description", "url", "exclude", "copies", "full", "hint", "section"]);
	const url = o.string("url");
	if (url !== undefined && url !== "" && !/^https?:\/\//.test(url)) bail(`url must be the site's address, like "https://example.com" (got ${debugString(url)})`);
	const exclude = o.list("exclude") ?? [];
	for (const glob of exclude) if (!glob.startsWith("/")) bail(`exclude: ${debugString(glob)} must be a URL path or glob starting with /, like "/blog/**"`);
	const excluded = exclude.length ? globSet("exclude", exclude) : () => false;
	const copies = o.bool("copies") ?? true;
	const full = o.bool("full") ?? true;
	const hint = o.bool("hint") ?? false;
	const section = o.get("section");
	if (section !== undefined && typeof section !== "function") bail(`section must be a function that gets each page and returns its section's name, like (page) => page.data.category (got ${typeof section})`);
	const title = o.string("title");
	const description = o.string("description");
	const address = (url ?? "").replace(/\/+$/, "");
	const vitepress = config.markdown.dialect === "vitepress";

	/** The pages llms.txt lists: from Markdown, written as HTML, not excluded, not a 404. */
	const listed = (inputPath: string, pageUrl: string, outputPath: string) => isMarkdown(inputPath) && outputPath.endsWith(".html") && !excluded(pageUrl) && pageUrl !== "/404.html" && pageUrl !== "/404/";

	// `hint`: a link to the page's Markdown, hidden, as the first thing in its `<body>`.
	if (hint && copies) {
		config.htmlTransforms.push(["llms", (html, page) => {
			if (!listed(page.inputPath, page.url, page.outputPath)) return html;
			const at = /<body\b[^>]*>/i.exec(html);
			const note = `<div hidden aria-hidden="true">This page is also Markdown, for language models: ${address}${config.base.replace(/\/$/, "")}${copyUrl(page.url)}</div>`;
			return at ? html.slice(0, at.index + at[0].length) + note + html.slice(at.index + at[0].length) : html;
		}]);
	}

	config.generators.push(["ssqch/llms", (config, pages) => {
		const base = config.base.replace(/\/$/, "");
		const link = (u: string) => `${address}${base}${u}`;
		const files: GeneratedFile[] = [];
		const entries: Array<{ url: string; copy: string; title: string; description: string; section: string; markdown: string }> = [];
		for (const p of [...pages].sort((a, b) => compareText(a.url, b.url))) {
			if (!listed(p.inputPath, p.url, p.outputPath)) continue;
			let source: string;
			try { source = fs.readFileSync(path.resolve(config.root, p.inputPath), "utf8"); } catch { continue; }
			let body = parseFrontMatter(source).body;
			// VitePress's pages: Vue's `<script setup>` and `<style>` blocks aren't the page's text.
			if (vitepress) body = vitepressBefore(body).replace(/^\s+/, "");
			const pageTitle = oneLine(p.data.title) || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || p.url;
			// A page whose title is only in its front matter starts with it, as the page shows it.
			if (!/^#\s/m.test(body.slice(0, 400)) && oneLine(p.data.title)) body = `# ${oneLine(p.data.title)}\n\n${body}`;
			let name = sectionOf(p.url);
			if (typeof section === "function") {
				let out: unknown;
				try { out = (section as (page: PageSummary) => unknown)(p); } catch (e) { bail(`section(), for ${p.url}: ${e instanceof Error ? e.message : String(e)}`); }
				if (typeof out === "string" && out.trim() !== "") name = out.trim();
			}
			entries.push({ url: p.url, copy: copyUrl(p.url), title: pageTitle, description: oneLine(p.data.description), section: name, markdown: body.replace(/\s+$/, "") + "\n" });
		}
		// The site's title: the option, or `site.title` in its data (`_data/site.json`), or the home page's.
		const site = pages[0]?.data.site;
		const siteTitle = title ?? (oneLine(site !== null && typeof site === "object" ? (site as Record<string, unknown>).title : undefined) || entries.find((e) => e.url === "/")?.title || "Pages");
		let txt = `# ${siteTitle}\n`;
		if (description) txt += `\n> ${oneLine(description)}\n`;
		const sections = new Map<string, typeof entries>();
		for (const e of entries) sections.set(e.section, [...(sections.get(e.section) ?? []), e]);
		for (const [name, list] of sections) {
			txt += `\n## ${name}\n\n`;
			for (const e of list) txt += `- [${e.title.replace(/([[\]])/g, "\\$1")}](${link(copies ? e.copy : e.url)})${e.description ? `: ${e.description}` : ""}\n`;
		}
		files.push({ path: "/llms.txt", contents: txt });
		if (copies) for (const e of entries) files.push({ path: e.copy, contents: e.markdown });
		if (full) files.push({ path: "/llms-full.txt", contents: entries.map((e) => `---\nurl: ${link(e.url)}\n---\n\n${e.markdown}`).join("\n") });
		return files;
	}]);
});
