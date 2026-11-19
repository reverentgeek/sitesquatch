// Splits the README (and copies the trailheads) into the site's docs pages, by lib/docs-map.ts,
// before each build: ssqch.config.js runs it as a `beforeBuild` hook, and `ssqch serve` watches the
// README and the trailheads. The README stays the one source until the docs move (TODO.md,
// section 9): src/docs/ is written here and isn't committed.
//
// A file is written only when its text changed, so the dev server's watcher doesn't rebuild in a
// loop. Links are rewritten for the site: one of the README's sections becomes its page (with the
// anchor), a trailhead becomes its page, and any other file of the repository becomes its address
// on GitHub. Headings move up to fit the page, and the stickers come from the site's copy of
// docs/assets/. Code blocks and code spans are left as they are.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS, NOT_ON_THE_SITE, url } from "./docs-map.ts";
import type { DocsPage } from "./docs-map.ts";

export const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = path.join(SITE, "..");
const OUT = path.join(SITE, "src", "docs");
const DATA = path.join(SITE, "src", "_data");
const GITHUB = "https://github.com/reverentgeek/sitesquatch";

/** A heading and the lines under it, up to the next heading. */
export interface Section {
	level: number;
	title: string;
	/** GitHub's anchor for the heading, made unique in the file the way GitHub does. */
	anchor: string;
	/** The heading's line, counting from 1. */
	line: number;
	body: string[];
}

/** GitHub's anchor for a heading: lowercase letters and digits, `-` and `_`, spaces as `-`. (ssqch's heading ids follow it too.) */
export function slug(title: string): string {
	let out = "";
	for (const c of title.toLowerCase()) {
		if (/[\p{Alphabetic}\p{N}_-]/u.test(c)) out += c;
		else if (c === " ") out += "-";
	}
	return out;
}

const fenceOf = (line: string) => /^\s*(```+|~~~+)/.exec(line)?.[1];

/** A Markdown file's sections, in order. The text before the first heading is left out. */
export function sections(text: string): Section[] {
	const out: Section[] = [];
	const seen = new Map<string, number>();
	let fence: string | undefined;
	text.split(/\r?\n/).forEach((line, i) => {
		const marker = fenceOf(line);
		if (marker) {
			if (fence === undefined) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
		}
		const heading = fence === undefined && !marker ? /^(#{1,6}) (.+?)\s*#*\s*$/.exec(line) : null;
		if (heading) {
			const base = slug(heading[2]);
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			out.push({ level: heading[1].length, title: heading[2], anchor: n === 0 ? base : `${base}-${n}`, line: i + 1, body: [] });
		} else {
			out[out.length - 1]?.body.push(line);
		}
	});
	return out;
}

/** What one docs page is made of. */
export interface Written {
	page: DocsPage;
	group: string;
	title: string;
	nav: string;
	url: string;
	/** The repository file it comes from, and the line it starts at. */
	source: string;
	line: number;
	command: string;
	description: string;
	markdown: string;
}

/** Each README section's page: the index of the page in `pages`, and whether the section is the page's own title (its heading is the page's `<h1>`). */
interface Home {
	page: number;
	title: boolean;
}

function readme() {
	return readFileSync(path.join(REPO, "README.md"), "utf8");
}

/** Where each README section goes: the map's pages, and which page each section is on. */
function plan() {
	const all = sections(readme());
	const index = (title: string) => {
		const found = all.filter((s) => s.title === title);
		if (found.length !== 1) throw new Error(`site/lib/docs-map.ts: the README has ${found.length === 0 ? "no" : found.length} "${title}" heading${found.length === 0 ? "" : "s"}`);
		return all.indexOf(found[0]);
	};
	const list = DOCS.flatMap((group) => group.pages.map((page) => ({ page, group: group.title })));
	// Which page each README section is on: a page's sections, and the ones under them that no other page takes.
	const roots = new Map<number, number>();
	list.forEach(({ page }, p) => page.from?.forEach((title) => roots.set(index(title), p)));
	for (const title of NOT_ON_THE_SITE) roots.set(index(title), -1);
	const home = new Map<number, Home>();
	all.forEach((_, i) => {
		if (roots.has(i)) {
			const p = roots.get(i)!;
			if (p >= 0) home.set(i, { page: p, title: list[p].page.from!.length === 1 });
			return;
		}
		for (let j = i - 1; j >= 0; j--) {
			if (all[j].level < all[i].level) {
				const parent = home.get(j);
				if (parent) home.set(i, { page: parent.page, title: false });
				break;
			}
		}
	});

	/** A link to the README's `#anchor`, from page `here` (-1 for none): the page it's on, with the anchor unless it's the page's own title. */
	const readmeLink = (anchor: string, here: number) => {
		const s = all.findIndex((x) => x.anchor === anchor);
		const where = s === -1 ? undefined : home.get(s);
		if (!where) return `${GITHUB}#${anchor}`;
		if (where.page === here) return where.title ? url(list[here].page.slug) : `#${anchor}`;
		return url(list[where.page].page.slug) + (where.title ? "" : `#${anchor}`);
	};
	return { all, list, home, index, readmeLink };
}

/** The site's address for the README's heading `#anchor`: its page, and the anchor on it. A heading the site leaves out goes to GitHub. */
export function readmeUrl(anchor: string): string {
	return plan().readmeLink(anchor, -1);
}

/** The pages, from the map: each one's title and Markdown, with its links rewritten. */
export function pages(): Written[] {
	const { all, list, home, index, readmeLink } = plan();
	return list.map(({ page, group }, p) => {
		if (page.file) {
			const text = readFileSync(path.join(REPO, page.file), "utf8");
			const own = sections(text);
			const first = own[0];
			const body = text.split(/\r?\n/).slice(first.line).join("\n");
			const markdown = rewrite(body, page.file, (anchor) => `#${anchor}`, readmeLink, p);
			const title = first.title.replace(/^Trailhead: /, "");
			return { page, group, title: title[0].toUpperCase() + title.slice(1), nav: page.nav ?? title, url: url(page.slug), source: page.file, line: 1, command: page.command!, description: describe(body), markdown };
		}
		if (!page.from) {
			return { page, group, title: page.title!, nav: page.nav ?? page.title!, url: url(page.slug), source: "", line: 0, command: page.command ?? "ssqch docs", description: "", markdown: "" };
		}
		const mine = all.map((s, i) => ({ s, i })).filter(({ i }) => home.get(i)?.page === p);
		const single = page.from.length === 1;
		const top = Math.min(...page.from.map((t) => all[index(t)].level));
		const lines: string[] = [];
		for (const { s, i } of mine) {
			const isTitle = home.get(i)!.title;
			if (!isTitle) lines.push("", `${"#".repeat(Math.min(6, s.level - top + (single ? 1 : 2)))} ${s.title}`);
			lines.push(...s.body);
		}
		const shift = (level: number) => Math.min(6, level - top + (single ? 1 : 2));
		let body = lines.join("\n").replace(/^\n+/, "");
		// The intro's badges are for GitHub and npm.
		if (page.slug === "") body = body.replace(/^\[!\[[^\n]*\n/gm, "").replace(/^\n+/, "");
		const markdown = rewrite(body, "README.md", (anchor) => readmeLink(anchor, p), readmeLink, p, shift);
		const first = all[index(page.from[0])];
		return {
			page,
			group,
			title: page.title ?? first.title,
			nav: page.nav ?? page.title ?? first.title,
			url: url(page.slug),
			source: "README.md",
			line: first.line,
			command: page.command ?? `ssqch docs "${first.title}"`,
			description: describe(body),
			markdown,
		};
	});
}

/** The first sentence of the first paragraph, as plain text, for the page's description. */
function describe(body: string): string {
	let fence: string | undefined;
	for (const line of body.split("\n")) {
		const marker = fenceOf(line);
		if (marker) { fence = fence ? undefined : marker; continue; }
		if (fence || line.trim() === "" || /^\s*(#|<|[-*|>]\s|\d+\.)/.test(line)) continue;
		const text = line.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "").trim();
		const end = text.search(/[.:](\s|$)/);
		return (end === -1 ? text : text.slice(0, end + 1)).replace(/:$/, ".");
	}
	return "";
}

/**
 * The page's Markdown for the site: links to the README's sections and the trailheads go to
 * their pages, other repository files to GitHub, `docs/assets/` images to the site's copy, and
 * headings (with `shift`) move to fit the page. Code blocks and code spans are left alone.
 */
function rewrite(text: string, file: string, anchor: (a: string) => string, readmeLink: (a: string, here: number) => string, here: number, shift?: (level: number) => number): string {
	const dir = path.posix.dirname(file);
	const target = (href: string): string => {
		if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return href;
		if (href.startsWith("#")) return anchor(href.slice(1));
		const [rel, hash = ""] = href.split("#");
		const repo = path.posix.normalize(path.posix.join(dir, rel));
		if (repo === "README.md") return hash ? readmeLink(hash, here) : "/docs/";
		const trail = /^docs\/trailheads\/(from-[\w-]+)\.md$/.exec(repo);
		if (trail) return `/docs/trailheads/${trail[1]}/${hash ? `#${hash}` : ""}`;
		if (repo.startsWith("docs/assets/")) return `/assets/drawings/${repo.slice("docs/assets/".length)}`;
		const full = path.join(REPO, repo);
		const folder = rel.endsWith("/") || (existsSync(full) && statSync(full).isDirectory());
		return `${GITHUB}/${folder ? "tree" : "blob"}/main/${repo.replace(/\/$/, "")}${folder ? "/" : ""}${hash ? `#${hash}` : ""}`;
	};
	const prose = (part: string) =>
		part
			.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, href: string, label: string) => `](${target(href)}${label})`)
			.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (_, a: string, src: string, b: string) => `${a}${target(src)}${b}`);
	let fence: string | undefined;
	const out: string[] = [];
	for (const line of text.split("\n")) {
		const marker = fenceOf(line);
		if (marker) {
			if (fence === undefined) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
			out.push(line);
			continue;
		}
		if (fence !== undefined) {
			out.push(line);
			continue;
		}
		const heading = shift && /^(#{1,6}) /.exec(line);
		const moved = heading ? `${"#".repeat(shift!(heading[1].length))}${line.slice(heading[1].length)}` : line;
		// Code spans are the odd parts between backticks.
		out.push(moved.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 === 1 ? part : prose(part))).join(""));
	}
	return out.join("\n").trim() + "\n";
}

const frontMatter = (data: Record<string, unknown>) => `---\n${Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n`;

/** Writes `file` when its text is new, and says whether it did. */
function write(file: string, text: string): boolean {
	if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
	return true;
}

/** Writes the docs pages into src/docs/, the sidebar into src/_data/nav.json, and removes pages the map no longer has. Returns the files it wrote. */
export function splitDocs(): string[] {
	const written: string[] = [];
	const keep = new Set<string>();
	const put = (file: string, text: string) => {
		keep.add(file);
		if (write(file, text)) written.push(path.relative(SITE, file));
	};
	const all = pages();
	put(path.join(OUT, "docs.json"), `${JSON.stringify({ layout: "doc.jinja", render: "md", generated: "site/lib/split.ts writes this folder from the README and docs/trailheads/; edit those." }, null, "\t")}\n`);
	for (const p of all) {
		if (!p.page.from && !p.page.file) continue;
		const data: Record<string, unknown> = { title: p.title, description: p.description, command: p.command, source: p.source, sourceLine: p.line };
		if (p.page.slug === "") data.permalink = "/docs/";
		put(path.join(OUT, `${p.page.slug === "" ? "index" : p.page.slug}.md`), `${frontMatter(data)}${p.markdown}`);
	}
	const nav = DOCS.map((group) => ({ title: group.title, pages: all.filter((p) => p.group === group.title).map((p) => ({ title: p.nav, url: p.url, description: p.description })) }));
	put(path.join(DATA, "nav.json"), `${JSON.stringify(nav, null, "\t")}\n`);
	// What the map no longer has.
	const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
	for (const file of walk(OUT)) if (!keep.has(file)) rmSync(file);
	return written;
}
