// Components written as HTML tags: `<VueSchoolLink href="/x" title="Watch">Free lesson</VueSchoolLink>`
// in a page (its Markdown's raw HTML included) or a layout renders `_includes/components/VueSchoolLink.*`,
// a template in any engine, with the tag's attributes as `component.props` and what's between its
// tags as `component.content`. VitePress, Astro and MDX pages use components this way; the
// vuejs.org move rebuilt its two presentational ones with a transform of 51 lines.
//
// A tag is a component when its name is PascalCase (`VueSchoolLink`, `Badge`): HTML's own names
// are lower case, SVG's camelCase ones start lower case (`linearGradient`), and a custom element
// has a hyphen. What's inside `<pre>`, `<code>`, `<script>`, `<style>`, `<textarea>` and comments
// is left alone, so a code sample's `<Button>` stays text.

/** What a component template gets as `component`. */
export interface ComponentValue {
	/** The tag's name, as written (`VueSchoolLink`). */
	name: string;
	/** Its attributes: `href="x"` is `"x"`, a bare `disabled` is `true`, `:count="3"` (Vue's binding) is `3`. A `kebab-case` name is there in camelCase too. */
	props: Record<string, unknown>;
	/** What's between its tags, as HTML, with the components inside it rendered already ("" for `<Tag />`). */
	content: string;
	/** Its attributes that aren't bindings or directives, as written (` class="x" href="y"`), to pass on to the element the template writes. */
	attrs: string;
	/** Vue's bindings as written: `:errors="data.runtime"` is `{ errors: "data.runtime" }`, for a renderer that knows more names than the page's data (`vuePlugin()`). */
	bindings: Record<string, string>;
}

/** A component's template, called with its value; undefined when the site has none of that name. */
export type RenderComponent = (name: string, value: ComponentValue) => string | undefined;

const NAME = /^[A-Z][A-Za-z0-9]*$/;
/** PascalCase: an upper-case first letter and a lower-case one somewhere (`DIV` is HTML's `div`). */
const isComponentName = (name: string) => NAME.test(name) && /[a-z]/.test(name);
const RAW = ["pre", "code", "script", "style", "textarea"];

/** Whether `html` might have a component tag in it: a quick check before the scan. */
export function mayHaveComponents(html: string): boolean {
	return /<[A-Z][A-Za-z0-9]*[a-z]/.test(html);
}

/**
 * `html` with each component tag rendered by `render`, the innermost first. A PascalCase tag
 * with no template is left as it is and passed to `unknown` (by name, once per tag). Bindings are
 * read against `data`: `:title="page.title"`, `:items="['a', 'b']"`.
 */
export function renderComponents(html: string, render: RenderComponent, data: Record<string, unknown>, unknown: (name: string) => void = () => {}): string {
	if (!mayHaveComponents(html)) return html;
	let out = "";
	let i = 0;
	while (i < html.length) {
		const lt = html.indexOf("<", i);
		if (lt === -1) break;
		out += html.slice(i, lt);
		// A comment, or an element whose text isn't HTML: copied as it is.
		if (html.startsWith("<!--", lt)) {
			const end = html.indexOf("-->", lt + 4);
			const stop = end === -1 ? html.length : end + 3;
			out += html.slice(lt, stop);
			i = stop;
			continue;
		}
		const raw = RAW.find((tag) => html.slice(lt + 1, lt + 1 + tag.length).toLowerCase() === tag && /[\s/>]/.test(html[lt + 1 + tag.length] ?? ""));
		if (raw) {
			const close = html.toLowerCase().indexOf(`</${raw}`, lt + raw.length + 1);
			const stop = close === -1 ? html.length : html.indexOf(">", close) + 1 || html.length;
			out += html.slice(lt, stop);
			i = stop;
			continue;
		}
		// The name ends where the tag's name does: `<Trail-Map>` is a custom element, not `Trail`.
		const name = /^<([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/.exec(html.slice(lt, lt + 80))?.[1];
		if (name === undefined || !isComponentName(name)) {
			out += "<";
			i = lt + 1;
			continue;
		}
		const open = openTag(html, lt + 1 + name.length);
		if (open === undefined) {
			out += "<";
			i = lt + 1;
			continue;
		}
		let content = "";
		let stop = open.end;
		let endTag = "";
		// Without an end tag, the start tag alone is the component.
		const close = open.selfClosing ? undefined : closingTag(html, name, open.end);
		if (close !== undefined) {
			content = renderComponents(html.slice(open.end, close.start), render, data, unknown);
			endTag = html.slice(close.start, close.end);
			stop = close.end;
		}
		const value: ComponentValue = { name, props: propsOf(open.attrs, data), content, attrs: plainAttrs(open.attrs), bindings: bindingsOf(open.attrs) };
		const rendered = render(name, value);
		if (rendered === undefined) {
			unknown(name);
			out += html.slice(lt, open.end) + content + endTag;
		} else {
			out += rendered;
		}
		i = stop;
	}
	return out + html.slice(i);
}

/** A start tag's attributes, from just after its name to its `>`: quotes are respected. */
function openTag(html: string, from: number): { attrs: Array<[string, string | true]>; end: number; selfClosing: boolean } | undefined {
	const attrs: Array<[string, string | true]> = [];
	let i = from;
	for (;;) {
		while (i < html.length && /\s/.test(html[i])) i++;
		if (i >= html.length) return undefined;
		if (html[i] === ">") return { attrs, end: i + 1, selfClosing: false };
		if (html.startsWith("/>", i)) return { attrs, end: i + 2, selfClosing: true };
		const name = /^[^\s"'>/=]+/.exec(html.slice(i, i + 200))?.[0];
		if (name === undefined) { i++; continue; }
		i += name.length;
		while (i < html.length && /\s/.test(html[i])) i++;
		if (html[i] !== "=") { attrs.push([name, true]); continue; }
		i++;
		while (i < html.length && /\s/.test(html[i])) i++;
		const quote = html[i];
		if (quote === "\"" || quote === "'") {
			const end = html.indexOf(quote, i + 1);
			if (end === -1) return undefined;
			attrs.push([name, decode(html.slice(i + 1, end))]);
			i = end + 1;
		} else {
			const value = /^[^\s>]*/.exec(html.slice(i))![0];
			attrs.push([name, decode(value.endsWith("/") && html[i + value.length] === ">" ? value.slice(0, -1) : value)]);
			i += value.length;
			if (value.endsWith("/") && html[i] === ">") i--;
		}
	}
}

/** The end tag that closes the component opened before `from`, counting ones of the same name inside it. */
function closingTag(html: string, name: string, from: number): { start: number; end: number } | undefined {
	const tags = new RegExp(`<(/?)${name}(?=[\\s/>])[^>]*?(/?)>`, "g");
	tags.lastIndex = from;
	let depth = 1;
	for (let m = tags.exec(html); m; m = tags.exec(html)) {
		if (m[1] === "/") depth--;
		else if (m[2] !== "/") depth++;
		if (depth === 0) return { start: m.index, end: m.index + m[0].length };
	}
	return undefined;
}

const decode = (s: string) => s.replace(/&(quot|#39|apos|lt|gt|amp);/g, (_, e: string) => ({ quot: "\"", "#39": "'", apos: "'", lt: "<", gt: ">", amp: "&" })[e]!);
const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
/** Vue's directives and events (`v-if`, `@click`, `#title`): what a page does in the browser, not a prop. */
const isDirective = (name: string) => (name.startsWith("v-") && !name.startsWith("v-bind:")) || name.startsWith("@") || name.startsWith("#");

function propsOf(attrs: Array<[string, string | true]>, data: Record<string, unknown>): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const [given, value] of attrs) {
		if (isDirective(given)) continue;
		const bound = given.startsWith(":") || given.startsWith("v-bind:");
		const name = bound ? given.slice(given.indexOf(":") + 1) : given;
		const v = bound && value !== true ? bindingValue(value, data) : value;
		props[name] = v;
		if (name.includes("-")) props[camel(name)] = v;
	}
	return props;
}

function bindingsOf(attrs: Array<[string, string | true]>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [given, value] of attrs) if ((given.startsWith(":") || given.startsWith("v-bind:")) && value !== true) out[given.slice(given.indexOf(":") + 1)] = value;
	return out;
}

function plainAttrs(attrs: Array<[string, string | true]>): string {
	let out = "";
	for (const [name, value] of attrs) {
		if (isDirective(name) || name.startsWith(":") || name.startsWith("v-bind:")) continue;
		out += value === true ? ` ${name}` : ` ${name}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
	}
	return out;
}

/**
 * A binding's value, from what Vue would read: a string in quotes, a number, `true`, `false` or
 * `null`, a list or an object of those (`['a', 'b']`, `{ size: 2 }`), or a name in the page's data
 * (`title`, `page.url`, `$frontmatter.title`). Anything else (a function call, arithmetic) is the
 * expression as written.
 */
export function bindingValue(expr: string, data: Record<string, unknown>): unknown {
	const text = expr.trim();
	const path = /^\$?(?:frontmatter\.)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.exec(text.replace(/^\$frontmatter\./, ""));
	if (path && !["true", "false", "null", "undefined"].includes(text)) {
		let at: unknown = data;
		for (const key of path[1].split(".")) at = at !== null && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined;
		return at;
	}
	if (text === "undefined") return undefined;
	try { return JSON.parse(text); } catch { /* not JSON as it is */ }
	// Vue's own literals: single quotes, unquoted keys, a comma at the end.
	const json = text
		.replace(/'((?:[^'\\]|\\.)*)'/g, (_, s: string) => JSON.stringify(s.replace(/\\'/g, "'")))
		.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, "$1\"$2\":")
		.replace(/,\s*([}\]])/g, "$1");
	try { return JSON.parse(json); } catch { return text; }
}
