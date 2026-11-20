// kramdown's Markdown inside HTML (`markdown: { htmlMarkdown: "kramdown" }`): an element with
// `markdown="1"` (or `"block"`, `"span"`) has Markdown for its content, and kramdown's HTML rules
// hold around it. opensource.guide has 3,791 such elements in 327 files; without them, 325 pages
// showed quote credits as raw `[@name](url)`. The behavior is the study's port
// (`_ssqch/jekyll.js`'s `markdownInHtml`), checked against Jekyll's output for the whole site.
//
// It runs before the page's Markdown: each element's content is rendered with the site's own
// Markdown, innermost first, and the element is written back as HTML, which CommonMark then
// passes through. kramdown's other HTML rules come along: a block-level element is raw HTML to
// its end tag (CommonMark ends an HTML block at a blank line, so blank lines inside one are
// dropped), a block tag counts only at a line's start (up to three spaces in), an element with no
// end tag closes at the end of what holds it, and a blank line follows a block's end tag (kramdown
// ends the block there, so a heading on the next line is a heading).

/** Elements whose content kramdown reads as span-level Markdown when it's `markdown="1"`: no lists, headings or paragraphs inside. */
const SPAN_LEVEL = new Set(["a", "abbr", "b", "br", "cite", "code", "em", "i", "img", "kbd", "mark", "p", "q", "s", "small", "span", "strong", "sub", "sup", "u", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "td", "th"]);
/** kramdown's span-level HTML elements; every other is block-level, even those whose content is span-level (`p`, the headings). */
const INLINE = new Set(["a", "abbr", "b", "br", "cite", "code", "em", "i", "img", "kbd", "mark", "q", "s", "small", "span", "strong", "sub", "sup", "u"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const MARKDOWN_ATTR = /\s+markdown\s*=\s*(["']?)(1|block|span)\1/;
/** A line that starts with a span-level tag would start an HTML block in CommonMark, and a paragraph in kramdown: a mark in front makes it one, and comes out again afterwards. */
const MARK = "\u0091kd\u0092";
/** kramdown ends an HTML block at its end tag, CommonMark at the next blank line: a blank line after the tag ends it in both. */
const BLOCK_END = /^([ \t]*<\/(?:aside|blockquote|div|section|table|ul|ol|dl|details|figure|p)>)[ \t]*\n(?=[ \t]*\S)/gim;

/** What renders an element's content: a block of Markdown, or a span of it (no `<p>`). */
export interface KramdownRender {
	block(text: string): string;
	span(text: string): string;
}

/** HTML without blank lines, so CommonMark keeps reading it as one HTML block. */
const blank = (html: string) => html.replace(/\n[ \t]*(?=\n)/g, "").replace(/\n{2,}/g, "\n");

/** `source` with every `markdown="1"` element's content rendered, and kramdown's HTML rules applied. */
export function kramdownHtml(source: string, render: KramdownRender): string {
	// Nothing to do in a page without HTML, which is most of them.
	if (!source.includes("<")) return source;
	return elements(source, render).replace(BLOCK_END, "$1\n\n");
}

function elements(source: string, render: KramdownRender): string {
	const out: string[] = [];
	let at = 0;
	const tags = new RegExp(TAG.source, "g");
	let m: RegExpExecArray | null;
	while ((m = tags.exec(source))) {
		const [open, close, name, attrs, selfClosing] = m;
		if (close || selfClosing) continue;
		const lower = name.toLowerCase();
		const atLineStart = /(^|\n) {0,3}$/.test(source.slice(0, m.index));
		const wanted = MARKDOWN_ATTR.exec(attrs);
		const raw = wanted === null;
		// A block-level element without the attribute is raw HTML to its end tag in kramdown. A
		// span-level one, a void one, or a block tag that doesn't start a line is left as it is.
		if (raw && (INLINE.has(lower) || !atLineStart || VOID.has(lower))) continue;
		// kramdown reads a block-level element only at the start of a line (up to three spaces in);
		// elsewhere it stays as it is, attribute and all. Span-level elements work anywhere.
		if (!INLINE.has(lower) && !atLineStart) continue;
		// Its end tag, counting others of the same name inside it.
		const ends = new RegExp(`<(/?)${name}(?=[\\s>/])[^>]*>`, "gi");
		ends.lastIndex = tags.lastIndex;
		let depth = 1;
		let end: { index: number; text: string; missing: boolean } | undefined;
		for (let t: RegExpExecArray | null; (t = ends.exec(source)); ) {
			if (t[0].endsWith("/>")) continue;
			depth += t[1] ? -1 : 1;
			if (depth === 0) { end = { index: t.index, text: t[0], missing: false }; break; }
		}
		// No end tag: kramdown closes it at the end of what holds it.
		end ??= { index: source.length, text: `</${name}>`, missing: true };
		const inner = elements(source.slice(tags.lastIndex, end.index), render);
		if (raw) {
			out.push(source.slice(at, m.index), open, blank(inner), end.missing ? "" : end.text);
		} else {
			const tag = `<${name}${attrs.replace(MARKDOWN_ATTR, "")}>`;
			const span = wanted[2] === "span" || (wanted[2] !== "block" && SPAN_LEVEL.has(lower));
			out.push(source.slice(at, m.index), tag, span ? spanOf(inner, render) : `\n${blockOf(inner, render)}\n`, end.text);
		}
		at = tags.lastIndex = end.missing ? source.length : end.index + end.text.length;
	}
	out.push(source.slice(at));
	return out.join("");
}

/** Span-level content is never a list or a heading in kramdown: a mark in front of each line keeps CommonMark from reading `- @name` as one. */
function spanOf(inner: string, render: KramdownRender): string {
	const text = inner.replace(/^(?=[ \t]*\S)/gm, MARK);
	return blank(render.span(text)).split(MARK).join("");
}

/** Block-level content, not dedented: kramdown reads a line indented four spaces as code here too. */
function blockOf(inner: string, render: KramdownRender): string {
	const text = inner.replace(/^\n+|\s+$/g, "")
		.replace(/(^|\n[ \t]*\n)([ \t]*)<([a-zA-Z]+)/g, (m, start: string, space: string, tag: string) => (SPAN_LEVEL.has(tag.toLowerCase()) && !/^(p|h[1-6]|td|th|dt)$/i.test(tag) ? `${start}${space}${MARK}<${tag}` : m));
	return blank(render.block(text)).split(MARK).join("");
}

/**
 * kramdown's own heading ids, which a heading inside HTML gets (its GFM parser's ids are for the
 * page's own headings): ASCII letters, digits, spaces and dashes, from the first letter on, and
 * `section` when nothing's left. `seen` counts repeats, which get `-1`, `-2`.
 */
export function kramdownId(text: string, seen: Map<string, number>): string {
	const id = text.replace(/^[^a-zA-Z]+/, "").replace(/[^a-zA-Z0-9 -]/g, "").replace(/ /g, "-").toLowerCase() || "section";
	const n = seen.get(id);
	seen.set(id, (n ?? -1) + 1);
	return n === undefined ? id : `${id}-${n + 1}`;
}

/**
 * The headings a `markdown="1"` block's Markdown made (`html`, from `text`), with kramdown's own
 * ids where the Markdown gave them its GFM ones. A `{#id}` the page wrote is kept, and so is a
 * heading that was HTML in `text` already: a nested block's, given its id there, or the page's own.
 */
export function withKramdownIds(html: string, text: string, seen: Map<string, number>): string {
	const written = new Set([...text.matchAll(/\{#([^\s}]+)/g)].map((m) => m[1]));
	return html.replace(/<h([1-6])( id="([^"]*)")([^>]*)>([\s\S]*?)<\/h\1>/g, (whole, level: string, _attr: string, id: string, rest: string, content: string) => {
		if (written.has(id) || text.includes(whole)) return whole;
		const plain = content.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
		return `<h${level} id="${kramdownId(plain, seen)}"${rest}>${content}</h${level}>`;
	});
}
