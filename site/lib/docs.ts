// The docs pages: the Markdown files in src/docs/, in the order src/docs/nav.yml gives them (the
// sidebar's groups, and the order `ssqch docs` reads them in). They're the documentation's one
// source: ssqch's package carries them for `ssqch docs` (packages/ssqch/src/bundled.ts), GitHub
// shows them as files, and the site renders them.
//
// Pages link each other with relative .md links (`content-schemas.md#types`), which GitHub
// follows; the site's link hook (src/_includes/hooks/link.jinja) turns them into page URLs with
// `docsHref`, and the copies for agents (lib/agents.ts) into the copies' URLs.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = path.join(SITE, "..");
export const DOCS_DIR = path.join(SITE, "src", "docs");

// ssqch's own YAML library, from its package.
const yaml = createRequire(path.join(REPO, "packages", "ssqch", "package.json"))("js-yaml");

/** GitHub's anchor for a heading (ssqch's heading ids follow it too). */
export function slug(title: string): string {
	let out = "";
	for (const c of title.toLowerCase()) {
		if (/[\p{Alphabetic}\p{N}_-]/u.test(c)) out += c;
		else if (c === " ") out += "-";
	}
	return out;
}

/** A page's URL from its file below src/docs/: `index.md` is `/docs/`, `trailheads/from-zola.md` is `/docs/trailheads/from-zola/`. */
export const urlOf = (file: string) => (file === "index.md" ? "/docs/" : `/docs/${file.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "/")}`);

export interface DocsPage {
	/** Below src/docs/, with `/`: `install.md`. Empty for a page the site makes itself. */
	file: string;
	url: string;
	title: string;
	/** The sidebar's name, when it's shorter than the title. */
	nav: string;
	description: string;
	group: string;
	/** The Markdown, without the front matter. */
	body: string;
	/** The front matter's own `command`, if it has one. */
	command?: string;
}

/** A page file's front matter and Markdown. */
export function readPage(file: string): { data: Record<string, unknown>; body: string } {
	const text = readFileSync(path.join(DOCS_DIR, file), "utf8");
	const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	return { data: front ? yaml.load(front[1]) ?? {} : {}, body: front ? text.slice(front[0].length) : text };
}

/** Every docs page, in nav.yml's order. */
export function pages(): DocsPage[] {
	const nav: Array<{ title: string; pages: Array<string | { title: string; url: string }> }> = yaml.load(readFileSync(path.join(DOCS_DIR, "nav.yml"), "utf8"));
	return nav.flatMap((group) => group.pages.map((entry): DocsPage => {
		if (typeof entry !== "string") return { file: "", url: entry.url, title: entry.title, nav: entry.title, description: "", group: group.title, body: "" };
		const { data, body } = readPage(entry);
		const title = String(data.title);
		return { file: entry, url: urlOf(entry), title, nav: String(data.navTitle ?? title), description: String(data.description ?? ""), group: group.title, body, command: data.command === undefined ? undefined : String(data.command) };
	}));
}

/** The `ssqch docs` command that prints a page: its own, `--from` for a trailhead, or its title. */
export function commandOf(page: Pick<DocsPage, "file" | "title" | "command">): string {
	if (page.command) return page.command;
	if (page.file === "index.md" || page.file === "") return "ssqch docs";
	const trailhead = /^trailheads\/from-([\w-]+)\.md$/.exec(page.file);
	return trailhead ? `ssqch docs --from ${trailhead[1]}` : `ssqch docs "${page.title}"`;
}

/** Where a link in a page goes on the site: a relative `.md` link to its page's URL (`../themes.md#x` from `trailheads/from-hexo.md` is `/docs/themes/#x`); anything else as it is. */
export function docsHref(href: string, from: string): string {
	const match = /^([^:#?]+\.md)(#.*)?$/.exec(href);
	if (!match || href.startsWith("/")) return href;
	const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), match[1]));
	return target.startsWith("..") ? href : `${urlOf(target)}${match[2] ?? ""}`;
}

/** The site's URL for a heading of the docs: its page, and its anchor unless it's the page's title. */
export function headingUrl(title: string): string | undefined {
	for (const page of pages()) {
		if (!page.file) continue;
		if (page.title === title) return page.url;
		let fence = false;
		for (const line of page.body.split("\n")) {
			if (/^\s*(```|~~~)/.test(line)) fence = !fence;
			const heading = !fence && /^#{1,6} (.+?)\s*$/.exec(line);
			if (heading && heading[1] === title) return `${page.url}#${slug(title)}`;
		}
	}
	return undefined;
}
