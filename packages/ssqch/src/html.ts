// Rewriting HTML without parsing it into a tree: start tags are found where lol_html (what 0.7's
// plugins and `base` used) finds them, a handler may change their attributes, and every other
// byte of the page is passed through as it was. `base`, and the plugins that rewrite URLs, are
// built on this.
//
// lol_html follows the HTML spec's tokenizer, and stands in for the tree builder where that
// decides what the tokenizer does next. So does this:
//
// - After `<script>`, `<style>`, `<title>`, `<textarea>`, `<iframe>`... the content is text up to
//   the element's own end tag, even when the tag is written self-closed (`<iframe ... />`): HTML
//   ignores the slash there.
// - Inside `<svg>` and `<math>` (foreign content) those elements hold markup like any other,
//   `<![CDATA[...]]>` is text, and a `/>` closes an element. Foreign content ends at its own end
//   tag, at a tag that breaks out of it (`<p>`, `<div>`, `<img>`...), and inside an HTML
//   integration point (`<foreignObject>`, `<desc>` and `<title>` in SVG, `<mi>`... in MathML).
// - A comment ends at `-->` or `--!>`, and `<!-->` and `<!--->` are whole comments.
// - In a script, `<!--` then `<script>` starts a part that the next `</script>` doesn't end.
// - An end tag's attributes are read as a start tag's are (a `>` in quotes doesn't end it).
// - The handlers of a `<style>` or `<script>` whose content is markup (in SVG) get the text
//   inside it until lol_html would close it, as lol_html's text handlers do.
//
// Where lol_html isn't the same from one use to the next, this follows the spec: after a tag
// that ends in `=>` (`<script src=>`), lol_html reads markup or the element's text depending on
// what its handlers asked to see, and this reads the text, as browsers do. And lol_html refuses
// pages it can't read for certain (a `<style>` inside `<select>`), which this reads as if the
// `<select>` weren't there.

/** A start tag's attribute: its name in lowercase, and where it and its value are in the HTML (`-1` for an attribute a handler added, or for no value). */
interface Attribute {
	name: string;
	start: number;
	nameEnd: number;
	valueStart: number;
	valueEnd: number;
	end: number;
	/** The value, once it's been read or set. */
	value: string | undefined;
	changed: boolean;
	removed: boolean;
}

/** The namespaces lol_html tells apart. */
const HTML = 0;
const SVG = 1;
const MATH = 2;
const NAMESPACES = ["html", "svg", "math"] as const;

/** A start tag a handler can read and change. */
export class StartTag {
	/** The tag's name, in lowercase. */
	name: string;
	/** The element's namespace, as lol_html gives it. */
	namespace: "html" | "svg" | "math" = "html";
	/** Whether the tag ends with `/>`. */
	selfClosing: boolean;
	changed = false;
	/** Where the tag's `<` is in the HTML. */
	start = 0;
	private html: string;
	private rawName: string;
	private attributes: Attribute[];
	private replacement: string | undefined;

	constructor(html: string, rawName: string, attributes: Attribute[], selfClosing: boolean) {
		this.html = html;
		this.rawName = rawName;
		this.name = rawName.toLowerCase();
		this.attributes = attributes;
		this.selfClosing = selfClosing;
	}

	private valueOf(a: Attribute): string {
		if (a.value === undefined) a.value = a.valueStart === -1 ? "" : this.html.slice(a.valueStart, a.valueEnd);
		return a.value;
	}

	/** An attribute's value as it's written (not decoded), `""` for one without a value, or `undefined`. The first of two with one name is the one that counts, as in browsers. */
	get(name: string): string | undefined {
		for (const a of this.attributes) if (a.name === name && !a.removed) return this.valueOf(a);
		return undefined;
	}

	/** Takes every attribute with this name off the tag. */
	remove(name: string): void {
		for (const a of this.attributes) {
			if (a.name === name && !a.removed) {
				a.removed = true;
				this.changed = true;
			}
		}
	}

	set(name: string, value: string): void {
		const found = this.attributes.find((a) => a.name === name && !a.removed);
		if (found) { found.value = value; found.changed = true; }
		else this.attributes.push({ name, start: -1, nameEnd: -1, valueStart: -1, valueEnd: -1, end: -1, value, changed: true, removed: false });
		this.changed = true;
	}

	/** Every attribute's name, in order, a repeated one each time (as lol_html's `attributes()` lists them). */
	names(): string[] {
		const out: string[] = [];
		for (const a of this.attributes) if (!a.removed) out.push(a.name);
		return out;
	}

	/** Every attribute, in order, with its value as written (`""` for one without a value): a repeated one each time, as lol_html's `attributes()` lists them, so a tag built from them keeps it. */
	entries(): Array<[string, string]> {
		const out: Array<[string, string]> = [];
		for (const a of this.attributes) if (!a.removed) out.push([a.name, this.valueOf(a)]);
		return out;
	}

	/** Puts `markup` where the tag is (an `<img>` becoming a `<picture>`). */
	replaceWith(markup: string): void {
		this.replacement = markup;
		this.changed = true;
	}

	/** The tag as text, as lol_html writes a changed one: attributes that weren't changed as they were written, one space between them. */
	toString(): string {
		if (this.replacement !== undefined) return this.replacement;
		const html = this.html;
		let attributes = "";
		for (const a of this.attributes) {
			if (a.removed) continue;
			// A changed attribute keeps its name as it was written (`SRC`), with its value in double quotes.
			attributes += ` ${a.changed ? `${a.start === -1 ? a.name : html.slice(a.start, a.nameEnd)}="${(a.value ?? "").replaceAll("\"", "&quot;")}"` : html.slice(a.start, a.end)}`;
		}
		// With no attributes left, the slash closes the name: `<x-a/>`.
		return `<${this.rawName}${attributes}${this.selfClosing ? (attributes ? " />" : "/>") : ">"}`;
	}
}

/** How the content after a start tag in HTML is read: as text to the element's end tag (with or without character references, which don't matter here), as a script, or as text to the end of the page. */
const TEXT = 1;
const SCRIPT = 2;
const PLAINTEXT = 3;
const TEXT_KIND = new Map<string, number>([["textarea", TEXT], ["title", TEXT], ["style", TEXT], ["iframe", TEXT], ["xmp", TEXT], ["noembed", TEXT], ["noframes", TEXT], ["noscript", TEXT], ["script", SCRIPT], ["plaintext", PLAINTEXT]]);
/** Start tags that end foreign content. */
const BREAKOUT = new Set(["b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed", "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "i", "img", "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s", "small", "span", "strong", "strike", "sub", "sup", "table", "tt", "u", "ul", "var"]);
/** SVG elements whose content is HTML. */
const SVG_HTML = new Set(["desc", "title", "foreignobject"]);
/** MathML elements whose content is HTML. */
const MATH_TEXT = new Set(["mi", "mo", "mn", "ms", "mtext"]);
/** Elements lol_html never holds open in HTML. */
const VOID = new Set(["area", "base", "basefont", "bgsound", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
/** The `encoding` that makes MathML's `<annotation-xml>` hold HTML. */
const HTML_ENCODINGS = new Set(["text/html", "application/xhtml+xml"]);

const LT = 60;
const GT = 62;
const SLASH = 47;
const BANG = 33;
const QUESTION = 63;
const EQUALS = 61;
const DASH = 45;
const DQUOTE = 34;
const SQUOTE = 39;
// Character codes, not a regular expression: these run for every character of every tag.
const isSpace = (c: number) => c === 32 || c === 10 || c === 9 || c === 13 || c === 12;
const isLetter = (c: number) => (c | 32) >= 97 && (c | 32) <= 122;

// The text handlers get an element's whole text when its content is text, and in SVG or MathML,
// where a `<style>` or `<script>` holds markup, each run of text between two tags inside it.
export interface Handlers {
	/** Called for each start tag; change it with `tag.set()`. */
	tag?(tag: StartTag): void;
	/** Called with the text inside each `<style>`; what it returns replaces the text. */
	style?(css: string): string;
	/** Called with the text inside each element whose content is text (`<script>`, `<title>`...), and inside a `<style>` or `<script>` in SVG, to read it. */
	rawText?(tag: StartTag, text: string): void;
	/** Called with the text inside each `<script>`; what it returns replaces the text. */
	script?(tag: StartTag, js: string): string;
	/** Called for each end tag, with its name in lowercase and where its `<` is. */
	endTag?(name: string, start: number): void;
}

/** `html` with its start tags (and the text of `<style>` and `<script>` elements) passed through `handlers`. A tag that wasn't changed keeps every byte. */
export function rewriteHtml(html: string, handlers: Handlers): string {
	return rewrite(html, handlers, true);
}

/**
 * The elements lol_html's selector matcher has open at the end of `html`: every start tag but
 * HTML's void elements and a self-closed one in SVG or MathML, until an end tag closes the
 * nearest of that name and everything opened inside it.
 */
function openElements(html: string): string[] {
	const open: string[] = [];
	rewrite(html, {
		tag(tag) { if (tag.namespace === "html" ? !VOID.has(tag.name) : !tag.selfClosing) open.push(tag.name); },
		endTag(name) {
			const at = open.lastIndexOf(name);
			if (at !== -1) open.length = at;
		},
	}, false);
	return open;
}

function rewrite(html: string, handlers: Handlers, owning: boolean): string {
	const n = html.length;
	let out = "";
	let copied = 0;
	let i = 0;
	// lol_html's stand-in for the tree builder: the namespaces entered and not yet left.
	const stack = [HTML];
	let ns = HTML;
	const enter = (to: number) => { stack.push(to); ns = to; };
	const leave = () => { stack.pop(); ns = stack[stack.length - 1]; };
	// A `<style>` or `<script>` whose content is markup (in SVG or MathML) is an owner: its handlers still get the text inside it, one run between two tags at a time, as
	// lol_html's text handlers do, until lol_html would close it. For that, the elements lol_html
	// has open are followed from the first owner on (and found for what comes before it then).
	const owners: StartTag[] = [];
	/** Where each owner is in `open`. */
	const ownedAt: number[] = [];
	let open: string[] | undefined;
	let textFrom = 0;
	/** The owners' handlers' answer for a text inside them. */
	const owned = (text: string): string => {
		for (const owner of owners) {
			handlers.rawText?.(owner, text);
			if (owner.name === "style") {
				if (handlers.style) text = handlers.style(text);
			} else if (handlers.script) text = handlers.script(owner, text);
		}
		return text;
	};
	/** Gives the owners' handlers the text from `from` to `to`, and puts what they return in its place. */
	const give = (from: number, to: number) => {
		if (to <= from) return;
		const text = html.slice(from, to);
		const changed = owned(text);
		if (changed !== text) {
			out += html.slice(copied, from) + changed;
			copied = to;
		}
	};
	const onTag = handlers.tag;
	const onEnd = handlers.endTag;

	while (i < n) {
		const lt = html.indexOf("<", i);
		if (lt === -1) break;
		const next = html.charCodeAt(lt + 1);
		if (next === BANG) {
			// A comment, a doctype or anything else in `<!...>`, or CDATA in foreign content.
			let end: number;
			if (html.startsWith("--", lt + 2)) {
				end = commentEnd(html, lt + 4);
				if (owners.length !== 0) give(textFrom, lt);
			} else if (ns !== HTML && html.startsWith("[CDATA[", lt + 2)) {
				const close = html.indexOf("]]>", lt + 9);
				end = close === -1 ? n : close + 3;
				if (owners.length !== 0) {
					give(textFrom, lt);
					give(lt + 9, close === -1 ? n : close);
				}
			} else {
				const gt = html.indexOf(">", lt + 2);
				end = gt === -1 ? n : gt + 1;
				if (owners.length !== 0) give(textFrom, lt);
			}
			i = textFrom = end;
			continue;
		}
		if (next === SLASH) {
			const after = html.charCodeAt(lt + 2);
			if (isLetter(after)) {
				// An end tag: its name, then attributes as a start tag has them.
				let q = lt + 3;
				for (let c = html.charCodeAt(q); q < n && !isSpace(c) && c !== SLASH && c !== GT; c = html.charCodeAt(++q));
				let end: number;
				if (html.charCodeAt(q) === GT) end = q + 1;
				else {
					end = scanAttributes(html, q, n, undefined);
					if (end === -1) break;
				}
				if (onEnd !== undefined || open !== undefined || stack.length > 1) {
					const name = html.slice(lt + 2, q).toLowerCase();
					if (owners.length !== 0) give(textFrom, lt);
					if (open !== undefined) {
						// The nearest open element of that name closes, with everything inside it.
						const at = open.lastIndexOf(name);
						if (at !== -1) {
							open.length = at;
							while (ownedAt.length !== 0 && ownedAt[ownedAt.length - 1] >= at) {
								owners.pop();
								ownedAt.pop();
							}
						}
					}
					onEnd?.(name, lt);
					if (stack.length > 1) {
						if (ns === HTML) {
							const outside = stack[stack.length - 2];
							if (outside === MATH ? MATH_TEXT.has(name) || name === "annotation-xml" : SVG_HTML.has(name)) leave();
						} else if ((ns === SVG && name === "svg") || (ns === MATH && name === "math") || name === "p" || name === "br") leave();
					}
				}
				i = textFrom = end;
				continue;
			}
			if (after === GT) {
				// `</>` is nothing.
				if (owners.length !== 0) give(textFrom, lt);
				i = textFrom = lt + 3;
				continue;
			}
			if (lt + 2 >= n) break;
		}
		if (next === SLASH || next === QUESTION) {
			// A bogus comment, to the next `>`.
			const gt = html.indexOf(">", lt + 2);
			if (owners.length !== 0) give(textFrom, lt);
			i = textFrom = gt === -1 ? n : gt + 1;
			continue;
		}
		if (!isLetter(next)) {
			i = lt + 1;
			continue;
		}
		// A start tag: its name, then its attributes, to `>`.
		let p = lt + 2;
		for (let c = html.charCodeAt(p); p < n && !isSpace(c) && c !== SLASH && c !== GT; c = html.charCodeAt(++p));
		const rawName = html.slice(lt + 1, p);
		const attributes: Attribute[] = [];
		let selfClosing = false;
		if (html.charCodeAt(p) === GT) p++;
		else {
			p = scanAttributes(html, p, n, attributes);
			if (p === -1) break;
			selfClosing = endedSelfClosing;
		}
		const tag = new StartTag(html, rawName, attributes, selfClosing);
		tag.start = lt;
		if (owners.length !== 0) give(textFrom, lt);
		const name = tag.name;
		let kind = 0;
		if (name === "svg") enter(SVG);
		else if (name === "math") enter(MATH);
		else if (ns !== HTML) {
			if (BREAKOUT.has(name)) leave();
			else if (ns === SVG ? SVG_HTML.has(name) : MATH_TEXT.has(name)) {
				if (!selfClosing) enter(HTML);
			} else if (name === "font") {
				if (attributes.some((a) => a.name === "color" || a.name === "size" || a.name === "face")) leave();
			} else if (ns === MATH && name === "annotation-xml") {
				// Any of its `encoding` attributes counts, as lol_html reads them.
				if (!selfClosing && attributes.some((a) => a.name === "encoding" && a.valueStart !== -1 && HTML_ENCODINGS.has(html.slice(a.valueStart, a.valueEnd).toLowerCase()))) enter(HTML);
			}
		} else kind = TEXT_KIND.get(name) ?? 0;
		if (ns !== HTML) tag.namespace = NAMESPACES[ns];
		onTag?.(tag);
		if (tag.changed) {
			out += html.slice(copied, lt) + tag.toString();
			copied = p;
		}
		i = textFrom = p;
		if (ns !== HTML && owning && !selfClosing && (name === "style" || name === "script")) {
			open ??= openElements(html.slice(0, lt));
			owners.push(tag);
			ownedAt.push(open.length);
		}
		if (open !== undefined && (ns === HTML ? !VOID.has(name) : !selfClosing)) open.push(name);
		if (kind === 0) continue;
		// The element's content is text, to its own end tag.
		const end = kind === SCRIPT ? scriptEnd(html, p, n) : kind === PLAINTEXT ? n : textEnd(html, p, name);
		if (end > p) {
			const text = html.slice(p, end);
			handlers.rawText?.(tag, text);
			let changed = text;
			if (name === "style") {
				if (handlers.style) changed = handlers.style(text);
			} else if (name === "script" && handlers.script) changed = handlers.script(tag, text);
			// Inside an owner (a `<style>` in SVG that's still open), the text is the owner's too.
			if (owners.length !== 0) changed = owned(changed);
			if (changed !== text) {
				out += html.slice(copied, p) + changed;
				copied = end;
			}
		}
		i = textFrom = end;
	}
	if (owners.length !== 0) give(textFrom, n);
	return copied === 0 ? html : out + html.slice(copied);
}

/** Whether the tag `scanAttributes` last read ended with `/>`. */
let endedSelfClosing = false;

/** Reads a tag's attributes from `p` (just after its name) to its `>`: the index after the `>`, or `-1` when the page ends first. They're collected into `attributes` when it's given; an end tag's are only skipped. */
function scanAttributes(html: string, p: number, n: number, attributes: Attribute[] | undefined): number {
	endedSelfClosing = false;
	while (p < n) {
		let c = html.charCodeAt(p);
		if (isSpace(c)) { p++; continue; }
		if (c === GT) return p + 1;
		if (c === SLASH) {
			if (html.charCodeAt(p + 1) === GT) { endedSelfClosing = true; return p + 2; }
			p++;
			continue;
		}
		// A name runs to whitespace, `/`, `>` or `=` (a leading `=` is part of it).
		const start = p;
		for (c = html.charCodeAt(++p); p < n && !isSpace(c) && c !== SLASH && c !== GT && c !== EQUALS; c = html.charCodeAt(++p));
		const nameEnd = p;
		let q = p;
		while (q < n && isSpace(html.charCodeAt(q))) q++;
		let valueStart = -1;
		let valueEnd = -1;
		let end = nameEnd;
		if (html.charCodeAt(q) === EQUALS) {
			q++;
			while (q < n && isSpace(html.charCodeAt(q))) q++;
			const quote = html.charCodeAt(q);
			if (quote === DQUOTE || quote === SQUOTE) {
				const close = html.indexOf(quote === DQUOTE ? "\"" : "'", q + 1);
				if (close === -1) return -1;
				valueStart = q + 1;
				valueEnd = close;
				p = end = close + 1;
			} else if (quote === GT) {
				// `name=>`: the attribute has an empty value and, as lol_html writes it again, is only its name.
				attributes?.push({ name: html.slice(start, nameEnd).toLowerCase(), start, nameEnd, valueStart: -1, valueEnd: -1, end: nameEnd, value: undefined, changed: false, removed: false });
				return q + 1;
			} else {
				valueStart = q;
				for (c = quote; q < n && !isSpace(c) && c !== GT; c = html.charCodeAt(++q));
				valueEnd = q;
				p = end = q;
			}
		}
		attributes?.push({ name: html.slice(start, nameEnd).toLowerCase(), start, nameEnd, valueStart, valueEnd, end, value: undefined, changed: false, removed: false });
	}
	return -1;
}

/** Whether `html` has `</name` at `at` (in any case) followed by what ends a tag name. `at` is just after the `</`. */
function endTagAt(html: string, at: number, name: string): boolean {
	const length = name.length;
	for (let j = 0; j < length; j++) if ((html.charCodeAt(at + j) | 32) !== name.charCodeAt(j)) return false;
	const c = html.charCodeAt(at + length);
	return isSpace(c) || c === SLASH || c === GT;
}

/** Where the text of an element like `<style>` or `<title>` ends: the `<` of its end tag, or the end of the page. */
function textEnd(html: string, from: number, name: string): number {
	for (let k = html.indexOf("</", from); k !== -1; k = html.indexOf("</", k + 2)) if (endTagAt(html, k + 2, name)) return k;
	return html.length;
}

/** Where a comment that starts at `from` (just after its `<!--`) ends: after its `-->` or `--!>`, or the end of the page. */
function commentEnd(html: string, from: number): number {
	// `<!-->` and `<!--->` end where they start.
	const first = html.charCodeAt(from);
	if (first === GT) return from + 1;
	if (first === DASH && html.charCodeAt(from + 1) === GT) return from + 2;
	for (let k = html.indexOf("--", from); k !== -1; k = html.indexOf("--", k)) {
		k += 2;
		while (html.charCodeAt(k) === DASH) k++;
		const c = html.charCodeAt(k);
		if (c === GT) return k + 1;
		if (c === BANG && html.charCodeAt(k + 1) === GT) return k + 2;
	}
	return html.length;
}

// The states of lol_html's script tokenizer, after `<!--` (escaped) and `<!--<script>` (double
// escaped), where it differs from plain script text.
const DATA = 0;
const ESCAPED = 1;
const ESCAPED_DASHES = 2;
const ESCAPED_LT = 3;
const DOUBLE_START = 4;
const DOUBLE = 5;
const DOUBLE_DASHES = 6;
const DOUBLE_LT = 7;
const DOUBLE_END_NAME = 8;
const DOUBLE_END = 9;

/** Whether `html` has `script` at `at`, in any case. */
const scriptAt = (html: string, at: number) => {
	for (let j = 0; j < 6; j++) if ((html.charCodeAt(at + j) | 32) !== "script".charCodeAt(j)) return false;
	return true;
};

/**
 * Where a script's text ends: the `<` of its `</script`, or the end of the page. Inside `<!--`, a
 * `<script>` starts a part that the next `</script>` doesn't end (it ends that part); `-->` ends both.
 */
function scriptEnd(html: string, from: number, n: number): number {
	let state = DATA;
	let i = from;
	for (;;) {
		switch (state) {
			case DATA: {
				const lt = html.indexOf("<", i);
				if (lt === -1) return n;
				const c = html.charCodeAt(lt + 1);
				if (c === SLASH) {
					if (endTagAt(html, lt + 2, "script")) return lt;
					i = lt + 2;
				} else if (c === BANG && html.startsWith("--", lt + 2)) {
					i = lt + 4;
					state = ESCAPED_DASHES;
				} else i = lt + 1;
				break;
			}
			case ESCAPED:
			case DOUBLE: {
				// To the next `<` or `--`.
				let k = i;
				for (let c = html.charCodeAt(k); k < n && c !== LT && !(c === DASH && html.charCodeAt(k + 1) === DASH); c = html.charCodeAt(++k));
				if (k >= n) return n;
				if (html.charCodeAt(k) === LT) {
					i = k + 1;
					state = state === ESCAPED ? ESCAPED_LT : DOUBLE_LT;
				} else {
					i = k + 2;
					state = state === ESCAPED ? ESCAPED_DASHES : DOUBLE_DASHES;
				}
				break;
			}
			case ESCAPED_DASHES:
			case DOUBLE_DASHES: {
				if (i >= n) return n;
				const c = html.charCodeAt(i);
				if (c === DASH) i++;
				else if (c === LT) {
					i++;
					state = state === ESCAPED_DASHES ? ESCAPED_LT : DOUBLE_LT;
				} else if (c === GT) state = DATA;
				else {
					i++;
					state = state === ESCAPED_DASHES ? ESCAPED : DOUBLE;
				}
				break;
			}
			case ESCAPED_LT: {
				if (i >= n) return n;
				if (scriptAt(html, i)) {
					i += 6;
					state = DOUBLE_START;
				} else if (html.charCodeAt(i) === SLASH) {
					if (endTagAt(html, i + 1, "script")) return i - 1;
					i++;
					state = ESCAPED;
				} else state = ESCAPED;
				break;
			}
			case DOUBLE_START:
			case DOUBLE_END: {
				if (i >= n) return n;
				const c = html.charCodeAt(i);
				if (isSpace(c) || c === SLASH || c === GT) {
					i++;
					state = state === DOUBLE_START ? DOUBLE : ESCAPED;
				} else state = state === DOUBLE_START ? ESCAPED : DOUBLE;
				break;
			}
			case DOUBLE_LT: {
				if (i >= n) return n;
				if (html.charCodeAt(i) === SLASH) {
					i++;
					state = DOUBLE_END_NAME;
				} else state = DOUBLE;
				break;
			}
			case DOUBLE_END_NAME: {
				if (i >= n) return n;
				if (scriptAt(html, i)) {
					i += 6;
					state = DOUBLE_END;
				} else state = DOUBLE;
				break;
			}
		}
	}
}
