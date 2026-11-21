// Other generators' Markdown syntax, read before ssqch's Markdown sees the page, so a site's
// content moves as it's written. From the fresh moves of Material for MkDocs' docs and gohugo.io
// (2026-11-20): MkDocs' agent wrote a 624-line preprocessor for its admonitions, tabs and `.md`
// links, and Hugo's 674 lines for shortcodes. Each is an option (`markdown: { admonitions:
// "mkdocs", tabs: "mkdocs", shortcodes: "hugo", sourceLinks: true }`) that `ssqch scout` turns on
// in its draft.
//
// They work on lines, outside code fences: MkDocs' blocks become the HTML Python-Markdown writes,
// with the Markdown inside left for ssqch's (a blank line after an HTML block's lines makes
// CommonMark read what follows as Markdown again), and Hugo's shortcodes become containers.
import path from "node:path";
import type { Data } from "../data.ts";

const FENCE = /^([ \t]*)(`{3,}|~{3,})/;

/** Calls `each` for every line outside fenced code, with the index; lines inside a fence are left alone. */
function outsideFences(lines: string[], each: (line: string, i: number) => number | void): void {
	let fence: string | undefined;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (fence) {
			const m = FENCE.exec(line);
			if (m && m[2][0] === fence[0] && m[2].length >= fence.length && line.slice(m[0].length).trim() === "") fence = undefined;
			continue;
		}
		const m = FENCE.exec(line);
		if (m) { fence = m[2]; continue; }
		const next = each(line, i);
		if (typeof next === "number") i = next - 1;
	}
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The lines after `start` that belong to a block opened at `indent`: blank, or indented four more. Trailing blank lines aren't the block's. */
function blockBody(lines: string[], start: number, indent: number): number {
	let end = start;
	let last = start;
	while (end < lines.length) {
		const line = lines[end];
		if (line.trim() === "") { end++; continue; }
		const own = line.length - line.trimStart().length + (line.slice(0, line.length - line.trimStart().length).match(/\t/g)?.length ?? 0) * 3;
		if (own < indent + 4) break;
		end++;
		last = end;
	}
	return last;
}

/** Without the blank lines at its start (the block adds its own). */
const trimStart = (lines: string[]) => { let i = 0; while (i < lines.length && lines[i].trim() === "") i++; return lines.slice(i); };

const dedent = (lines: string[], by: number) => trimStart(lines).map((line) => {
	let cut = 0;
	let width = 0;
	while (cut < line.length && width < by && (line[cut] === " " || line[cut] === "\t")) { width += line[cut] === "\t" ? 4 : 1; cut++; }
	return line.slice(cut);
});

const ADMONITION = /^([ \t]*)(!!!|\?\?\?\+?)[ \t]*([\w-]+(?:[ \t]+[\w-]+)*)?(?:[ \t]+"(.*?)")?[ \t]*$/;
const TAB = /^([ \t]*)===([+!]{0,2})[ \t]+"(.*?)"[ \t]*$/;

export interface PythonMarkdownOptions {
	/** `!!! note "Title"` and `??? note` (pymdownx.details) blocks. */
	admonitions: boolean;
	/** `=== "Tab"` blocks, as pymdownx.tabbed's `alternate_style` writes them. */
	tabs: boolean;
}

/**
 * MkDocs' blocks as Python-Markdown's extensions write them: `!!! note "Title"` as
 * `<div class="admonition note"><p class="admonition-title">Title</p>...</div>`, `??? note` as
 * `<details class="note"><summary>Note</summary>...</details>` (`???+` open), and `=== "Tab"` as
 * pymdownx.tabbed's alternate style. Blocks nest, and code fences are left as they are.
 */
export function pythonMarkdownBlocks(source: string, options: PythonMarkdownOptions): string {
	if (!(options.admonitions && /^[ \t]*(?:!!!|\?\?\?)/m.test(source)) && !(options.tabs && /^[ \t]*===/m.test(source))) return source;
	const counter = { sets: 0 };
	return convertBlocks(source.split("\n"), options, counter).join("\n");
}

function convertBlocks(lines: string[], options: PythonMarkdownOptions, counter: { sets: number }): string[] {
	const out: string[] = [];
	let copied = 0;
	const flush = (to: number) => { out.push(...lines.slice(copied, to)); copied = to; };
	outsideFences(lines, (line, i) => {
		if (i < copied) return;
		const a = options.admonitions ? ADMONITION.exec(line) : null;
		if (a && (a[3] !== undefined || a[4] !== undefined)) {
			flush(i);
			const pad = a[1];
			const end = blockBody(lines, i + 1, pad.length);
			const body = convertBlocks(dedent(lines.slice(i + 1, end), pad.length + 4), options, counter);
			const classes = (a[3] ?? "note").trim().split(/[ \t]+/).join(" ");
			const first = classes.split(" ")[0];
			const title = a[4] ?? first[0].toUpperCase() + first.slice(1);
			const details = a[2] !== "!!!";
			const open = details
				? `<details class="${escapeHtml(classes)}"${a[2] === "???+" ? " open=\"open\"" : ""}>${title === "" ? "" : `\n${pad}<summary>${escapeHtml(title)}</summary>`}`
				: `<div class="admonition ${escapeHtml(classes)}">${title === "" ? "" : `\n${pad}<p class="admonition-title">${escapeHtml(title)}</p>`}`;
			out.push(`${pad}${open}`, "", ...body.map((l) => (l === "" ? l : pad + l)), "", `${pad}${details ? "</details>" : "</div>"}`);
			copied = end;
			return end;
		}
		const t = options.tabs ? TAB.exec(line) : null;
		if (t) {
			flush(i);
			const pad = t[1];
			const tabs: Array<{ title: string; selected: boolean; body: string[] }> = [];
			let at = i;
			for (;;) {
				const m = TAB.exec(lines[at] ?? "");
				if (!m || m[1] !== pad || (tabs.length && m[2].includes("!"))) break;
				const end = blockBody(lines, at + 1, pad.length);
				tabs.push({ title: m[3], selected: m[2].includes("+"), body: convertBlocks(dedent(lines.slice(at + 1, end), pad.length + 4), options, counter) });
				// The next tab of the same set follows after blank lines only.
				let next = end;
				while (next < lines.length && lines[next].trim() === "") next++;
				if (!TAB.test(lines[next] ?? "")) { at = end; break; }
				at = next;
			}
			const set = ++counter.sets;
			const selected = Math.max(0, tabs.findIndex((tab) => tab.selected));
			const inputs = tabs.map((_, n) => `<input${n === selected ? " checked=\"checked\"" : ""} id="__tabbed_${set}_${n + 1}" name="__tabbed_${set}" type="radio" />`).join("");
			const labels = tabs.map((tab, n) => `<label for="__tabbed_${set}_${n + 1}">${escapeHtml(tab.title)}</label>`).join("");
			out.push(`${pad}<div class="tabbed-set tabbed-alternate" data-tabs="${set}:${tabs.length}">${inputs}<div class="tabbed-labels">${labels}</div>`, `${pad}<div class="tabbed-content">`);
			for (const tab of tabs) out.push(`${pad}<div class="tabbed-block">`, "", ...tab.body.map((l) => (l === "" ? l : pad + l)), "", `${pad}</div>`);
			out.push(`${pad}</div>`, `${pad}</div>`);
			copied = at;
			return at;
		}
	});
	flush(lines.length);
	return out;
}

// ---- Hugo's shortcodes -----------------------------------------------------------------------

const SHORTCODE_LINE = /^([ \t]*)\{\{([<%])[ \t]*(\/?)[ \t]*([\w./-]+)((?:[^}]|\}(?!\}))*?)[ \t]*(\/?)[ \t]*[>%]\}\}[ \t]*$/;

/**
 * Hugo's shortcodes on lines of their own as ssqch's containers: `{{< note type="tip" >}}` to
 * `{{< /note >}}` is `::: note type="tip"` to `:::`, rendered by `_includes/containers/note.*`
 * (`container.args`, `container.props`, `container.content`). One without a closing tag is a
 * container with no content. An outer one gets more colons. A shortcode inside a line of text is
 * left as it is: `ssqch scout` lists those.
 */
export function hugoShortcodes(source: string): string {
	if (!source.includes("{{<") && !source.includes("{{%")) return source;
	return unescapeShortcodes(shortcodeContainers(source));
}

// Hugo's docs show a shortcode without calling it by putting `/*` and `*/` inside the braces
// (`{{</` then `* name *` then `/>}}`): it prints `{{< name >}}`.
const unescapeShortcodes = (text: string) => text.replace(/\{\{([<%])\/\*/g, "{{$1").replace(/\*\/([>%])\}\}/g, "$1}}");

function shortcodeContainers(source: string): string {
	const lines = source.split("\n");
	interface Open { name: string; line: number; depth: number }
	const marks = new Map<number, { kind: "open" | "close" | "self"; pad: string; name: string; args: string; partner?: number }>();
	const stack: Open[] = [];
	outsideFences(lines, (line, i) => {
		const m = SHORTCODE_LINE.exec(line);
		if (!m) return;
		const [, pad, , closing, name, args, selfClosing] = m;
		if (closing) {
			for (let k = stack.length - 1; k >= 0; k--) {
				if (stack[k].name !== name) continue;
				const open = stack[k];
				stack.length = k;
				marks.get(open.line)!.kind = "open";
				marks.get(open.line)!.partner = i;
				marks.set(i, { kind: "close", pad, name, args: "", partner: open.line });
				return;
			}
			return;
		}
		marks.set(i, { kind: "self", pad, name, args: args.trim() });
		if (!selfClosing) stack.push({ name, line: i, depth: stack.length });
	});
	if (!marks.size) return source;
	// Colons: three for the innermost, one more for each container inside.
	const colons = new Map<number, number>();
	const depthOf = (open: number): number => {
		const known = colons.get(open);
		if (known !== undefined) return known;
		const mark = marks.get(open)!;
		let inner = 0;
		for (let k = open + 1; k < (mark.partner ?? open); k++) {
			const m = marks.get(k);
			if (m && m.kind !== "close") inner = Math.max(inner, m.kind === "open" ? depthOf(k) : 3);
		}
		const n = inner ? inner + 1 : 3;
		colons.set(open, n);
		return n;
	};
	for (const [i, mark] of marks) {
		if (mark.kind === "close") lines[i] = `${mark.pad}${":".repeat(depthOf(mark.partner!))}`;
		else if (mark.kind === "open") lines[i] = `${mark.pad}${":".repeat(depthOf(i))} ${mark.name}${mark.args ? ` ${mark.args}` : ""}`;
		else lines[i] = `${mark.pad}::: ${mark.name}${mark.args ? ` ${mark.args}` : ""}\n${mark.pad}:::`;
	}
	return lines.join("\n");
}

// ---- links to Markdown files -----------------------------------------------------------------

const pagesByFile = new WeakMap<object, Map<string, string>>();
const inputRoots = new WeakMap<Map<string, string>, string>();

/** Each page's URL by its source file (`docs/setup/index.md`), from `collections.all`, made once for each build. */
function urlsByFile(all: unknown): Map<string, string> | undefined {
	if (!Array.isArray(all)) return undefined;
	const known = pagesByFile.get(all);
	if (known) return known;
	const map = new Map<string, string>();
	for (const item of all) {
		if (item && typeof item === "object" && typeof (item as Data).inputPath === "string" && typeof (item as Data).url === "string") map.set(path.posix.normalize(((item as Data).inputPath as string).replace(/^\.\//, "")), (item as Data).url as string);
	}
	pagesByFile.set(all, map);
	// The input folder: the folder every page's source is in (`docs/`).
	let common: string[] | undefined;
	for (const file of map.keys()) {
		const folders = file.split("/").slice(0, -1);
		common = common === undefined ? folders : common.slice(0, [...common, ""].findIndex((part, i) => part !== folders[i]));
	}
	inputRoots.set(map, (common ?? []).map((part) => `${part}/`).join(""));
	return map;
}

/** The URL `to` from the page at `from`, as MkDocs writes it: `../setup/`, `./` for the same page's folder. */
function relativeUrl(from: string, to: string): string {
	const fromDir = from.endsWith("/") ? from : path.posix.dirname(from) + "/";
	let rel = path.posix.relative(fromDir, to.endsWith("/") ? to.slice(0, -1) || "/" : to);
	if (to.endsWith("/") && rel !== "") rel += "/";
	return rel === "" ? "./" : rel;
}

/**
 * Links and images as GitHub, MkDocs and jekyll-relative-links read them, from the Markdown
 * file's folder: a link to a `.md` file (`[Setup](../setup/index.md#install)`) goes to the page
 * built from that file, with its `#` part, and another relative URL (`![](img/stump.png)`) to
 * that file where the build copies it. `"relative"` writes each URL from the page
 * (`../setup/#install`), as MkDocs does; `true` from the site's root. A link to a `.md` file
 * that isn't a page is left as it is, for the link checker to report.
 */
export function sourceLinks(html: string, data: Data, mode: true | "relative", input?: string): string {
	const page = data.page as Data | undefined;
	const inputPath = typeof page?.inputPath === "string" ? page.inputPath.replace(/^\.\//, "") : undefined;
	const pageUrl = typeof page?.url === "string" ? page.url : undefined;
	const urls = urlsByFile((data.collections as Data | undefined)?.all);
	if (!inputPath || !urls || !pageUrl) return html;
	// The URL of the page's own source folder: where its relative URLs start.
	const sourceDir = path.posix.dirname(inputPath);
	// The site's input folder when it's known: the common folder of the pages' sources is the
	// project's root once a theme has pages of its own (its 404 page), which sent every image
	// to `../../docs/img/` (the fresh httpx move).
	const inputRoot = input ?? inputRoots.get(urls);
	return html.replace(/(<(?:a|img|source)\s[^>]*?(?:href|src)=")([^"#?]*)((?:[#?][^"]*)?)"/g, (whole, start: string, ref: string, rest: string) => {
		if (ref === "" || /^[a-z][a-z0-9+.-]*:|^\/|^\/\//i.test(ref)) return whole;
		let target: string;
		try { target = path.posix.normalize(path.posix.join(sourceDir, decodeURI(ref))); } catch { return whole; }
		let url: string | undefined;
		if (/\.md$/i.test(ref)) url = urls.get(target);
		else if (inputRoot !== undefined && (target + "/").startsWith(inputRoot)) url = `/${target.slice(inputRoot.length)}`;
		if (url === undefined) return whole;
		return `${start}${mode === "relative" ? relativeUrl(pageUrl, url) : url}${rest}"`;
	});
}

/** Python-Markdown's `toc` ids (its default `slugify`): ASCII from NFKD, word characters, spaces and hyphens, lowercased, runs of spaces and hyphens as one `-`. */
export function pythonMarkdownSlug(text: string): string {
	const ascii = text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
	return ascii.replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[-\s]+/g, "-");
}
