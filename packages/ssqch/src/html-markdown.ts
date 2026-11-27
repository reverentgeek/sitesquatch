// A page's HTML as Markdown, for `llmsPlugin()`'s copy of a page that wasn't written in Markdown
// (a home page in Jinja, a list made by a template). The page's own part is its `<article>` (when
// it has one, not a list of them), or its `<main>`, or else its `<body>`; what's around it (the header, the sidebar) is the site's,
// not the page's. Inside it, what a reader reads becomes Markdown: headings, paragraphs, lists,
// links, emphasis, code, quotes, tables and pictures with a description. What isn't text is left
// out: scripts and styles, forms and buttons, navigation, anything `hidden` or `aria-hidden`, a
// heading's `#` link to itself, and a picture with `alt=""` (the HTML spec's word for one that's
// only decoration). Any element around headings, lists or paragraphs (a custom element, a
// `<search>`, a link around a card) is read as a `<div>` is: what's inside it is the page.
//
// It reads HTML as browsers mostly do without building the spec's whole tree: void elements, the
// end tags HTML lets a page leave out (`<p>`, `<li>`, `<td>`...), raw text in `<script>` and
// `<style>`, and stray end tags ignored. A page ssqch built is regular enough for that.
import { decodeEntities } from "./content.ts";

interface Element { name: string; attrs: Map<string, string>; children: Node[] }
type Node = Element | string;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "template", "iframe", "noembed", "noframes"]);
/** What a reader doesn't read: left out with everything inside it. */
const SKIP = new Set(["script", "style", "noscript", "template", "head", "nav", "form", "button", "select", "input", "textarea", "iframe", "canvas", "svg", "math", "video", "audio", "object", "embed", "dialog", "meta", "link", "title"]);
const BLOCK = new Set(["address", "article", "aside", "blockquote", "body", "details", "dialog", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "html", "caption"]);
/** An open `<p>` ends at these, as HTML closes it. */
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);

const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** HTML as a tree of elements and text (entities decoded). */
function parse(html: string): Element {
	const root: Element = { name: "#root", attrs: new Map(), children: [] };
	const stack: Element[] = [root];
	const top = () => stack[stack.length - 1];
	const close = (name: string, stopAt: ReadonlySet<string> = new Set()) => {
		for (let i = stack.length - 1; i > 0; i--) {
			if (stopAt.has(stack[i].name)) return;
			if (stack[i].name === name) { stack.length = i; return; }
		}
	};
	let at = 0;
	let text = "";
	const flush = () => {
		if (text) top().children.push(decodeEntities(text));
		text = "";
	};
	while (at < html.length) {
		const lt = html.indexOf("<", at);
		if (lt === -1) { text += html.slice(at); break; }
		text += html.slice(at, lt);
		at = lt;
		if (html.startsWith("<!--", at)) {
			const end = html.indexOf("-->", at + 4);
			at = end === -1 ? html.length : end + 3;
			continue;
		}
		if (html[at + 1] === "!" || html[at + 1] === "?") {
			const end = html.indexOf(">", at);
			at = end === -1 ? html.length : end + 1;
			continue;
		}
		TAG.lastIndex = at;
		const m = TAG.exec(html);
		if (!m) { text += "<"; at++; continue; }
		flush();
		at = TAG.lastIndex;
		const name = m[2].toLowerCase();
		if (m[1]) {
			if (name === "p" && !stack.some((e) => e.name === "p")) continue;
			close(name);
			continue;
		}
		const attrs = new Map<string, string>();
		for (const a of m[3].matchAll(ATTR)) attrs.set(a[1].toLowerCase(), decodeEntities(a[2] ?? a[3] ?? a[4] ?? ""));
		// The end tags HTML lets a page leave out.
		if (CLOSES_P.has(name)) close("p", new Set(["button", "td", "th", "li", "blockquote", "div", "section", "article", "main"]));
		if (name === "li") close("li", new Set(["ul", "ol"]));
		if (name === "dt" || name === "dd") { close("dt", new Set(["dl"])); close("dd", new Set(["dl"])); }
		if (name === "tr") close("tr", new Set(["table", "thead", "tbody", "tfoot"]));
		if (name === "td" || name === "th") { close("td", new Set(["tr", "table"])); close("th", new Set(["tr", "table"])); }
		if (name === "thead" || name === "tbody" || name === "tfoot") { close("thead", new Set(["table"])); close("tbody", new Set(["table"])); }
		const el: Element = { name, attrs, children: [] };
		top().children.push(el);
		if (VOID.has(name) || m[4]) continue;
		if (RAW.has(name)) {
			const end = html.toLowerCase().indexOf(`</${name}`, at);
			const inner = html.slice(at, end === -1 ? html.length : end);
			if (name === "textarea" || name === "title") el.children.push(decodeEntities(inner));
			at = end === -1 ? html.length : html.indexOf(">", end) + 1 || html.length;
			continue;
		}
		stack.push(el);
	}
	flush();
	return root;
}

/** The first element named `name`, depth first. */
function find(el: Element, name: string): Element | undefined {
	for (const c of el.children) {
		if (typeof c === "string") continue;
		if (c.name === name) return c;
		const inner = find(c, name);
		if (inner) return inner;
	}
	return undefined;
}

/** Every `<name>` that isn't inside another (a card's own, not a comment inside it). */
function findAll(el: Element, name: string, out: Element[] = []): Element[] {
	for (const c of el.children) {
		if (typeof c === "string") continue;
		if (c.name === name) out.push(c);
		else findAll(c, name, out);
	}
	return out;
}

const hidden = (el: Element) => el.attrs.has("hidden") || el.attrs.get("aria-hidden") === "true";
const skipped = (el: Element) => SKIP.has(el.name) || hidden(el);
const isBlock = (n: Node) => typeof n !== "string" && BLOCK.has(n.name);
/**
 * An element that isn't a block with a block somewhere inside: a wrapper, read as a `<div>` is.
 * A custom element (`elementsPlugin()`'s, whose inside is the page without its script), a
 * `<search>`, a `<span>` around a card, a link around one: as inline text, their headings and
 * lists ran together into one line. One with only text (`<x-badge>New</x-badge>`) stays part of
 * the line it's in. Code is read as its text, whatever is inside it.
 */
const wraps = (el: Element): boolean => !AS_TEXT.has(el.name) && el.children.some(holdsBlock);
const AS_TEXT = new Set(["code", "kbd", "samp", "tt"]);
const holdsBlock = (n: Node): boolean => typeof n !== "string" && !skipped(n) && (BLOCK.has(n.name) || n.children.some(holdsBlock));

/** All the text inside, as it is (for code). */
function textOf(n: Node): string {
	if (typeof n === "string") return n;
	if (n.name === "br") return "\n";
	return n.children.map(textOf).join("");
}

/** Text that Markdown would read as markup, escaped. */
function escape(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/[*`[\]]/g, "\\$&")
		.replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace("_", "\\_"))
		.replace(/<(?=[A-Za-z/!?])/g, "\\<")
		.replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
}

/** What a line can't start with as text: `#`, `>`, a list marker, a fence, a rule. */
function escapeLineStart(line: string): string {
	return line.replace(/^(\s*)(#{1,6}(?=\s|$)|>|[-+](?=\s)|(\d+)([.)])(?=\s)|=+\s*$|~~~)/, (_, space: string, mark: string, digits?: string, dot?: string) => (digits ? `${space}${digits}\\${dot}` : `${space}\\${mark}`));
}

/** A heading's link to itself (`<a class="anchor" href="#x">#</a>`): only a symbol, pointing at a fragment. */
const selfLink = (el: Element) => el.name === "a" && (el.attrs.get("href") ?? "").startsWith("#") && !/[\p{L}\p{N}]/u.test(textOf(el));

/**
 * A formula ssqch's Markdown wrote (`markdown.math`), as the TeX it was: KaTeX keeps it in an
 * `<annotation>` when it rendered it at build time (its MathML is left out, and the rest is
 * `aria-hidden`, so the formula would be gone), and otherwise it's between `\(` and `\)`, or `\[`
 * and `\]`.
 */
function mathOf(el: Element): { tex: string; display: boolean } | undefined {
	const classes = ` ${el.attrs.get("class") ?? ""} `.replace(/\s+/g, " ");
	if (!classes.includes(" math ")) return undefined;
	const display = classes.includes(" math-display ");
	if (!display && !classes.includes(" math-inline ")) return undefined;
	const annotation = find(el, "annotation");
	const tex = annotation ? textOf(annotation) : textOf(el).trim().replace(display ? /^\\\[([\s\S]*)\\\]$/ : /^\\\(([\s\S]*)\\\)$/, "$1");
	return { tex: tex.trim(), display };
}

function inline(nodes: Node[], inHeading = false): string {
	let out = "";
	for (const n of nodes) {
		if (typeof n === "string") { out += escape(n.replace(/\s+/g, " ")); continue; }
		if (skipped(n)) continue;
		const math = mathOf(n);
		if (math) { out += math.display ? `$$${math.tex}$$` : `$${math.tex}$`; continue; }
		switch (n.name) {
			case "br": out += "\\\n"; break;
			case "img": {
				const alt = n.attrs.get("alt");
				// No `alt` at all is a picture nobody described; `alt=""` is decoration.
				if (alt === "" || !n.attrs.get("src")) break;
				out += `![${escape(alt ?? "")}](${destination(n.attrs.get("src")!)})`;
				break;
			}
			case "a": {
				if (inHeading && selfLink(n)) break;
				const text = inline(n.children, inHeading).trim();
				const href = n.attrs.get("href");
				if (!href || !text) { out += text; break; }
				const title = n.attrs.get("title");
				out += `[${text}](${destination(href)}${title ? ` "${title.replace(/"/g, "\\\"")}"` : ""})`;
				break;
			}
			case "strong": case "b": { const t = inline(n.children, inHeading).trim(); if (t) out += `**${t}**`; break; }
			case "em": case "i": case "cite": case "dfn": { const t = inline(n.children, inHeading).trim(); if (t) out += `*${t}*`; break; }
			case "del": case "s": case "strike": { const t = inline(n.children, inHeading).trim(); if (t) out += `~~${t}~~`; break; }
			case "code": case "kbd": case "samp": case "tt": out += codeSpan(textOf(n)); break;
			default: out += inline(n.children, inHeading);
		}
	}
	return out;
}

/** A link's destination, in `<>` when it has spaces or parentheses. */
const destination = (href: string) => (/[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : href);

function codeSpan(text: string): string {
	const code = text.replace(/\n/g, " ");
	if (!code) return "";
	const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
	const ticks = "`".repeat(longest + 1);
	const pad = code.startsWith("`") || code.endsWith("`") || (code.startsWith(" ") && code.endsWith(" ") && code.trim()) ? " " : "";
	return `${ticks}${pad}${code}${pad}${ticks}`;
}

/** A paragraph's text: spaces collapsed, each line safe to start. */
function paragraph(text: string): string {
	return text.replace(/[ \t]+/g, " ").split("\n").map((l) => escapeLineStart(l.trim())).join("\n").trim();
}

/** The code block's language, from `class="language-x"` (or `lang-x`) on the `<pre>` or its `<code>`. */
function languageOf(pre: Element): string {
	const code = pre.children.find((c): c is Element => typeof c !== "string" && c.name === "code");
	for (const el of [code, pre]) {
		const m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(el?.attrs.get("class") ?? "") ?? (el?.attrs.get("data-lang") ? [, el.attrs.get("data-lang")] : null);
		if (m?.[1]) return m[1];
	}
	return "";
}

function fence(text: string, lang: string): string {
	const body = text.replace(/\n$/, "");
	const longest = Math.max(2, ...[...body.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1].length));
	const marks = "`".repeat(longest + 1);
	return `${marks}${lang}\n${body}\n${marks}`;
}

const indent = (text: string, by: string) => text.split("\n").map((l, i) => (i === 0 || l === "" ? l : by + l)).join("\n");

/** Blocks, separated by blank lines. Inline nodes between blocks are a paragraph of their own. */
function blocks(nodes: Node[]): string[] {
	const out: string[] = [];
	let run: Node[] = [];
	const endRun = () => {
		const text = paragraph(inline(run));
		if (text) out.push(text);
		run = [];
	};
	for (const n of nodes) {
		if (typeof n === "string" || !isBlock(n)) {
			if (typeof n !== "string" && skipped(n)) continue;
			if (typeof n !== "string" && wraps(n)) {
				endRun();
				const inside = blocks(n.children);
				out.push(...(n.name === "a" && n.attrs.get("href") ? linkFirst(inside, n.attrs.get("href")!, n.attrs.get("title")) : inside));
				continue;
			}
			run.push(n);
			continue;
		}
		endRun();
		if (skipped(n)) continue;
		out.push(...block(n));
	}
	endRun();
	return out;
}

/**
 * A link around blocks (a card: `<a href><h3>Day Hike</h3><p>...</p></a>`), which Markdown has no
 * way to write: the first heading or paragraph is the link (`### [Day Hike](/plans/day/)`), so
 * the copy keeps where the card goes. When the first block is something else (a list, a quote,
 * a link already), the address follows as a line of its own.
 */
function linkFirst(inside: string[], href: string, title: string | undefined): string[] {
	const to = `(${destination(href)}${title ? ` "${title.replace(/"/g, "\\\"")}"` : ""})`;
	const first = inside[0];
	if (first !== undefined && !first.includes("\n") && !first.includes("](")) {
		const heading = /^(#{1,6}) (.+)$/.exec(first);
		if (heading) return [`${heading[1]} [${heading[2]}]${to}`, ...inside.slice(1)];
		if (!/^(?:[-*+>|]\s|\d+[.)]\s|`{3}|---$|!\[)/.test(first)) return [`[${first}]${to}`, ...inside.slice(1)];
	}
	return [...inside, `[${escape(href)}]${to}`];
}

function block(el: Element): string[] {
	const name = el.name;
	const heading = /^h([1-6])$/.exec(name);
	if (heading) {
		const text = inline(el.children, true).replace(/\s+/g, " ").trim();
		return text ? [`${"#".repeat(Number(heading[1]))} ${text}`] : [];
	}
	const math = name === "div" ? mathOf(el) : undefined;
	if (math?.display) return [`$$\n${math.tex}\n$$`];
	switch (name) {
		case "p": { const t = paragraph(inline(el.children)); return t ? [t] : []; }
		case "hr": return ["---"];
		case "pre": return [fence(textOf(el), languageOf(el))];
		case "blockquote": {
			const inner = blocks(el.children).join("\n\n");
			return inner ? [inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")] : [];
		}
		case "ul": case "ol": return list(el);
		case "table": return table(el);
		case "dl": {
			const out: string[] = [];
			for (const c of el.children) {
				if (typeof c === "string" || skipped(c)) continue;
				if (c.name === "dt") { const t = inline(c.children).trim(); if (t) out.push(`**${t}**`); }
				else if (c.name === "dd") out.push(...blocks(c.children));
				else out.push(...blocks([c]));
			}
			return out;
		}
		case "summary": { const t = inline(el.children).trim(); return t ? [`**${t}**`] : []; }
		default: return blocks(el.children);
	}
}

function list(el: Element): string[] {
	const ordered = el.name === "ol";
	let n = ordered ? Number(el.attrs.get("start") ?? 1) || 1 : 0;
	const items: string[] = [];
	for (const c of el.children) {
		if (typeof c === "string" || c.name !== "li" || skipped(c)) continue;
		const marker = ordered ? `${n++}. ` : "- ";
		const inner = blocks(c.children);
		// An item without a `<p>` is tight (its text and a nested list on lines together); one with
		// paragraphs is loose, with a blank line between them.
		const loose = c.children.some((x) => typeof x !== "string" && x.name === "p");
		const body = inner.join(loose ? "\n\n" : "\n");
		items.push(marker + indent(body, " ".repeat(marker.length)));
	}
	return items.length ? [items.join("\n")] : [];
}

function table(el: Element): string[] {
	const rows: Array<{ cells: string[]; head: boolean }> = [];
	const walk = (e: Element, head: boolean) => {
		for (const c of e.children) {
			if (typeof c === "string" || skipped(c)) continue;
			if (c.name === "tr") {
				const cells = c.children.filter((x): x is Element => typeof x !== "string" && (x.name === "td" || x.name === "th"));
				rows.push({ cells: cells.map((x) => inline(x.children).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|")), head: head || (cells.length > 0 && cells.every((x) => x.name === "th")) });
			} else if (c.name === "thead") walk(c, true);
			else if (c.name === "tbody" || c.name === "tfoot") walk(c, false);
		}
	};
	walk(el, false);
	if (!rows.length) return [];
	const width = Math.max(...rows.map((r) => r.cells.length));
	const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
	const [first, ...rest] = rows[0].head ? rows : [{ cells: [], head: true }, ...rows];
	const caption = find(el, "caption");
	const out = caption ? [paragraph(inline(caption.children))].filter(Boolean) : [];
	out.push([line(first.cells), `|${" --- |".repeat(width)}`, ...rest.map((r) => line(r.cells))].join("\n"));
	return out;
}

/**
 * A page's HTML as Markdown: its `<article>` when it has one, or its `<main>`, or its `<body>`. A
 * page with several articles side by side is a list of them (a topic's posts, each a card), so its
 * `<main>` is the page's own part, not the first card.
 */
export function htmlToMarkdown(html: string): string {
	const root = parse(html);
	const articles = findAll(root, "article");
	const part = (articles.length === 1 ? articles[0] : undefined) ?? find(root, "main") ?? articles[0] ?? find(root, "body") ?? root;
	const text = blocks(part.children).join("\n\n").trim();
	return text ? `${text}\n` : "";
}

/** A Markdown link's destination, `<...>` or bare (with balanced parentheses), and its title. */
const INLINE_LINK = /(\]\()(\s*)(<[^>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)/g;
// Not a footnote (`[^1]: Two raccoons agree.`): its text isn't a destination (new-blog run).
const REFERENCE = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/;
const HTML_URL = /(<(?:a|img|source|link)\b[^>]*?\s(?:href|src)\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/**
 * Markdown with each link's destination given to `to` (inline links and images, reference
 * definitions, and `href`/`src` in raw HTML), outside code: fenced blocks and code spans stay as
 * they are.
 */
export function rewriteLinks(markdown: string, to: (href: string) => string): string {
	let fenced: string | undefined;
	return markdown.split("\n").map((line) => {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fenced !== undefined) {
			if (marker && marker[0] === fenced[0] && marker.length >= fenced.length && line.trim() === marker) fenced = undefined;
			return line;
		}
		if (marker) { fenced = marker; return line; }
		const ref = REFERENCE.exec(line);
		if (ref) {
			const href = ref[2].startsWith("<") ? ref[2].slice(1, -1) : ref[2];
			return ref[1] + destination(to(href)) + line.slice(ref[0].length);
		}
		// Code spans keep their text: only what's between them is rewritten.
		return line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 === 1 ? part : part
			.replace(INLINE_LINK, (_, open: string, space: string, dest: string) => open + space + destination(to(dest.startsWith("<") ? dest.slice(1, -1) : dest.replace(/\\(.)/g, "$1"))))
			.replace(HTML_URL, (_, before: string, _q: string, d?: string, s?: string) => `${before}"${to(d ?? s ?? "").replace(/"/g, "&quot;")}"`))).join("");
	}).join("\n");
}
