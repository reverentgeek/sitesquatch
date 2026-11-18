// Rewriting HTML without parsing it into a tree: start tags are found as a browser's tokenizer
// finds them, a handler may change their attributes, and every other byte of the page is passed
// through as it was. `base`, and the plugins that rewrite URLs, are built on this.

/** A start tag's attribute: its name in lowercase and as written, its value as written (entities undecoded), and its source text. */
interface Attribute {
	name: string;
	rawName: string;
	value: string | null;
	raw: string;
	changed: boolean;
	/** A second attribute with a name the tag already has: browsers ignore it, so handlers don't see it, and it's written as it was. */
	repeat: boolean;
	removed?: boolean;
}

/** A start tag a handler can read and change. */
export class StartTag {
	/** The tag's name, in lowercase. */
	name: string;
	private rawName: string;
	private attributes: Attribute[];
	private selfClosing: boolean;
	changed = false;
	/** Where the tag's `<` is in the HTML. */
	start = 0;
	private replacement: string | undefined;

	constructor(rawName: string, attributes: Attribute[], selfClosing: boolean) {
		this.rawName = rawName;
		this.name = rawName.toLowerCase();
		this.attributes = attributes;
		this.selfClosing = selfClosing;
	}

	/** An attribute's value as it's written (not decoded), `""` for one without a value, or `undefined`. */
	get(name: string): string | undefined {
		const found = this.attributes.find((a) => a.name === name && !a.repeat && !a.removed);
		return found ? found.value ?? "" : undefined;
	}

	/** Takes every attribute with this name off the tag. */
	remove(name: string): void {
		for (const a of this.attributes) if (a.name === name) a.removed = true;
		this.changed = true;
	}

	set(name: string, value: string): void {
		const found = this.attributes.find((a) => a.name === name && !a.repeat && !a.removed);
		if (found) { found.value = value; found.changed = true; }
		else this.attributes.push({ name, rawName: name, value, raw: "", changed: true, repeat: false });
		this.changed = true;
	}

	/** The names of the attributes a browser reads, in order. */
	names(): string[] {
		return this.attributes.filter((a) => !a.repeat && !a.removed).map((a) => a.name);
	}

	/** The attributes a browser reads, in order, with their values as written (`""` for one without a value). */
	entries(): Array<[string, string]> {
		return this.attributes.filter((a) => !a.repeat && !a.removed).map((a) => [a.name, a.value ?? ""]);
	}

	/** Puts `markup` where the tag is (an `<img>` becoming a `<picture>`). */
	replaceWith(markup: string): void {
		this.replacement = markup;
		this.changed = true;
	}

	/** The tag as text: attributes that weren't changed as they were written, one space between them. */
	toString(): string {
		if (this.replacement !== undefined) return this.replacement;
		// A changed attribute keeps its name as it was written (`SRC`), with its value in double quotes.
		const attributes = this.attributes.filter((a) => !a.removed).map((a) => (a.changed ? `${a.rawName}="${(a.value ?? "").replaceAll("\"", "&quot;")}"` : a.raw));
		// With no attributes left, the slash closes the name: `<x-a/>`.
		return `<${this.rawName}${attributes.length ? ` ${attributes.join(" ")}` : ""}${this.selfClosing ? (attributes.length ? " />" : "/>") : ">"}`;
	}
}

/** Elements whose content is text, not markup, until their own end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);
// A function, not a regular expression: this runs for every character of every tag.
const SPACE = { test: (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f" };

export interface Handlers {
	/** Called for each start tag; change it with `tag.set()`. */
	tag?(tag: StartTag): void;
	/** Called with the text inside each `<style>`; what it returns replaces the text. */
	style?(css: string): string;
	/** Called with the text inside each element whose content is text (`<script>`, `<title>`...), to read it. */
	rawText?(tag: StartTag, text: string): void;
	/** Called with the text inside each `<script>`; what it returns replaces the text. */
	script?(tag: StartTag, js: string): string;
	/** Called for each end tag, with its name in lowercase and where its `<` is. */
	endTag?(name: string, start: number): void;
}

/** `html` with its start tags (and the text of `<style>` elements) passed through `handlers`. A tag that wasn't changed keeps every byte. */
export function rewriteHtml(html: string, handlers: Handlers): string {
	let out = "";
	let copied = 0;
	let i = 0;
	const n = html.length;
	while (i < n) {
		const lt = html.indexOf("<", i);
		if (lt === -1) break;
		const next = html[lt + 1];
		if (next === "!") {
			// A comment runs to `-->`; a doctype or anything else in `<!...>` to the next `>`.
			if (html.startsWith("<!--", lt)) {
				const end = html.indexOf("-->", lt + 4);
				i = end === -1 ? n : end + 3;
			} else {
				const end = html.indexOf(">", lt + 2);
				i = end === -1 ? n : end + 1;
			}
			continue;
		}
		if (next === "/" || next === "?") {
			const end = html.indexOf(">", lt + 2);
			if (next === "/" && handlers.endTag && /[A-Za-z]/.test(html[lt + 2] ?? "")) {
				let q = lt + 2;
				while (q < n && !SPACE.test(html[q]) && html[q] !== "/" && html[q] !== ">") q++;
				handlers.endTag(html.slice(lt + 2, q).toLowerCase(), lt);
			}
			i = end === -1 ? n : end + 1;
			continue;
		}
		if (next === undefined || !((next >= "a" && next <= "z") || (next >= "A" && next <= "Z"))) {
			i = lt + 1;
			continue;
		}
		// A start tag: its name, then its attributes, to `>`.
		let p = lt + 1;
		while (p < n && !SPACE.test(html[p]) && html[p] !== "/" && html[p] !== ">") p++;
		const rawName = html.slice(lt + 1, p);
		const attributes: Attribute[] = [];
		let selfClosing = false;
		let closed = false;
		while (p < n) {
			while (p < n && SPACE.test(html[p])) p++;
			if (p >= n) break;
			if (html[p] === ">") { p++; closed = true; break; }
			if (html[p] === "/") {
				if (html[p + 1] === ">") { selfClosing = true; p += 2; closed = true; break; }
				p++;
				continue;
			}
			const start = p;
			// A name runs to whitespace, `/`, `>` or `=` (a leading `=` is part of the name).
			if (html[p] === "=") p++;
			while (p < n && !SPACE.test(html[p]) && html[p] !== "/" && html[p] !== ">" && html[p] !== "=") p++;
			const rawName = html.slice(start, p);
			const name = rawName.toLowerCase();
			let q = p;
			while (q < n && SPACE.test(html[q])) q++;
			let value: string | null = null;
			if (html[q] === "=") {
				q++;
				while (q < n && SPACE.test(html[q])) q++;
				const quote = html[q];
				if (quote === "\"" || quote === "'") {
					const end = html.indexOf(quote, q + 1);
					value = html.slice(q + 1, end === -1 ? n : end);
					p = end === -1 ? n : end + 1;
				} else {
					const from = q;
					while (q < n && !SPACE.test(html[q]) && html[q] !== ">") q++;
					value = html.slice(from, q);
					p = q;
				}
			}
			// The first of two attributes with one name is the one that counts.
			attributes.push({ name, rawName, value, raw: html.slice(start, p), changed: false, repeat: attributes.some((a) => a.name === name) });
		}
		if (!closed) break;
		const tag = new StartTag(rawName, attributes, selfClosing);
		tag.start = lt;
		handlers.tag?.(tag);
		if (tag.changed) {
			out += html.slice(copied, lt) + tag.toString();
			copied = p;
		}
		i = p;
		if (RAW_TEXT.has(tag.name) && !selfClosing) {
			// Text to this element's own end tag.
			const close = new RegExp(`</${tag.name}(?=[\\t\\n\\f\\r />])`, "ig");
			close.lastIndex = p;
			const found = close.exec(html);
			const end = found ? found.index : n;
			if (handlers.rawText && end > p) handlers.rawText(tag, html.slice(p, end));
			if (tag.name === "style" && handlers.style && end > p) {
				const css = html.slice(p, end);
				const changed = handlers.style(css);
				if (changed !== css) {
					out += html.slice(copied, p) + changed;
					copied = end;
				}
			}
			if (tag.name === "script" && handlers.script && end > p) {
				const js = html.slice(p, end);
				const changed = handlers.script(tag, js);
				if (changed !== js) {
					out += html.slice(copied, p) + changed;
					copied = end;
				}
			}
			i = end;
			if (tag.name === "plaintext") break;
		}
	}
	return copied === 0 ? html : out + html.slice(copied);
}
