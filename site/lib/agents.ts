// What coding agents read on the web (TODO.md, section 9, "Agents, and launch"): a Markdown copy
// of every docs page, `/llms.txt` and `/llms-full.txt`. Written before each build into
// site/generated/ (not committed), which the config's passthrough copies into the site, so the
// link checker sees the copies each page's <head> links. The first thing each says is that
// `ssqch docs <name>` answers for the installed version, which beats any website.
//
// A page and its copy are the same file (src/docs/, lib/docs.ts), and nothing of the page's
// chrome goes into the copy: the title as a heading, then the page's text, with its relative .md
// links pointing at the other pages' copies. tests/agents.test.ts checks that each copy, rendered, is
// its page's text.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { docsHref, pages, SITE } from "./docs.ts";
import reference from "../src/_data/reference.js";

export const GENERATED = path.join(SITE, "generated");
const ADDRESS = "https://sitesquatch.dev";

/** A docs page's Markdown copy: `/docs/install/` is `/docs/install.md`, and `/docs/` is `/docs/index.md`. */
export const copyOf = (url: string) => (url === "/docs/" ? "/docs/index.md" : `${url.replace(/\/$/, "")}.md`);

/** The other place a copy is: `/docs/install/index.md` (the llms.txt proposal's name for a folder's page), and `/docs.md` for `/docs/`. */
const otherCopyOf = (url: string) => (url === "/docs/" ? "/docs.md" : `${url}index.md`);

/** Links to docs pages point at their copies: `](themes.md#x)` from `trailheads/from-hexo.md`, or `](/docs/themes/#x)`, is `](/docs/themes.md#x)`. */
function toCopies(markdown: string, from: string): string {
	let fence: string | undefined;
	return markdown.split("\n").map((line) => {
		const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
		if (marker) fence = fence === undefined ? marker : line.trim() === marker ? undefined : fence;
		if (fence !== undefined || marker) return line;
		return line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 === 1 ? part : part.replace(/\]\(([^)\s]+)\)/g, (whole, href: string) => {
			const url = docsHref(href, from);
			const page = /^(\/docs\/[^#]*)(#.*)?$/.exec(url);
			return page ? `](${copyOf(page[1])}${page[2] ?? ""})` : whole;
		}))).join("");
	}).join("\n");
}

/** A line that's only a picture (the README's stickers): decoration, which the copy leaves out. */
const PICTURE = /^\s*<img\b[^>]*>\s*$/;

/** Each docs page's copy: its URL, title and Markdown. */
export function copies(): Array<{ url: string; title: string; description: string; group: string; markdown: string }> {
	return pages().map((p) => {
		const body = p.file ? p.body.split("\n").filter((line) => !PICTURE.test(line)).join("\n") : reference().markdown;
		return { url: p.url, title: p.title, description: p.description, group: p.group, markdown: `# ${p.title}\n\n${toCopies(body, p.file).trim()}\n` };
	});
}

const GUIDANCE = [
	"- If ssqch is installed, `ssqch docs <name>` (a command, a config option, a function or a heading's words) prints the documentation for the installed version, with no network. `ssqch docs` alone lists every name, and `--format json` gives the same as JSON.",
	`- Every docs page here has a Markdown copy at its address with \`.md\` on the end (${ADDRESS}/docs/install.md), and a request for a docs page with \`Accept: text/markdown\` gets the copy.`,
	`- The example sites run live at ${ADDRESS}/examples/, and their source is at https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites.`,
];

/** Writes the copies, /llms.txt and /llms-full.txt into site/generated/, only what changed, and removes what's gone. Returns the files it wrote. */
export function writeAgentCopies(): string[] {
	const all = copies();
	const files = new Map<string, string>();
	for (const c of all) {
		files.set(copyOf(c.url), c.markdown);
		files.set(otherCopyOf(c.url), c.markdown);
	}
	const summary = "> SiteSquatch (`ssqch`) is a static site generator for Node.js. It turns Markdown and templates into plain HTML, and checks its own work on every build: links, front matter against schemas, and what a change did to the output.";
	const index = [`# SiteSquatch`, "", summary, "", ...GUIDANCE];
	for (const group of [...new Set(all.map((c) => c.group))]) {
		index.push("", `## ${group}`, "");
		for (const c of all.filter((c) => c.group === group)) index.push(`- [${c.title}](${ADDRESS}${copyOf(c.url)})${c.description ? `: ${c.description}` : ""}`);
	}
	files.set("/llms.txt", `${index.join("\n")}\n`);
	files.set("/llms-full.txt", `# SiteSquatch\n\n${summary}\n\n${GUIDANCE.join("\n")}\n\n${all.map((c) => `<!-- ${ADDRESS}${c.url} -->\n\n${c.markdown}`).join("\n\n")}`);

	const written: string[] = [];
	const keep = new Set<string>();
	for (const [url, text] of files) {
		const file = path.join(GENERATED, ...url.split("/"));
		keep.add(file);
		if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, text);
		written.push(url);
	}
	const walk = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
	for (const file of walk(GENERATED)) if (!keep.has(file)) rmSync(file);
	return written;
}
