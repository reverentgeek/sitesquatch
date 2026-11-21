// `markdown: { dialect: "vitepress" }`: Markdown as VitePress reads and writes it, so a site's pages
// move as they are and its theme's CSS still finds its classes. From the vuejs.org move, which
// matched VitePress's HTML with three hooks, six container templates, a preprocess engine and
// about 80 lines of filters (its `lib/ssqch/vitepress.js` and `vue-markdown.js`):
//
// - before ssqch reads a page: Vue's `<script>` and `<style>` blocks and `<ClientOnly>` left out
//   (VitePress compiles them and writes none of it), and a `-vue` fence's `{{ 'literal' }}` read;
// - built-in render hooks, each replaced by the site's own template of the same name: headings
//   with `tabindex="-1"` and the `header-anchor` link, links with `.html` (or without, as the
//   site's `urls` says) and external ones in a new tab, code blocks in VitePress's wrapper with
//   its copy button and language label, tables with `tabindex="0"`, and the `tip`, `info`,
//   `warning`, `danger`, `details`, `raw` and `code-group` containers;
// - after: `[[toc]]` (in any case) as markdown-it-table-of-contents writes it, and HTML comments
//   left out, as Vue's server renderer leaves them out.
//
// Shiki's colors aren't here: ssqch highlights with its own classes (`highlight: true`).
import crypto from "node:crypto";

type Data = Record<string, unknown>;
type Hook = (value: Data, options: { htmlUrls: boolean }) => string;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** VitePress's heading ids (@mdit-vue/shared's `slugify`): punctuation and spaces to `-`, accents off, a leading digit after `_`. */
export function vitepressSlug(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[\u0000-\u001f]/g, "")
		.replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^(\d)/, "_$1")
		.toLowerCase();
}

const FENCE = /^(\s*)(`{3,}|~{3,})/;

/** Vue's parts of a page, out before ssqch reads it: what's inside fences stays as written. */
export function vitepressBefore(source: string): string {
	if (!source.includes("<") && !source.includes("-vue")) return source;
	const lines = source.split("\n");
	const out: string[] = [];
	let fence: string | undefined;
	let vueFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (fence !== undefined) {
			const m = FENCE.exec(line);
			if (m && m[2][0] === fence[0] && m[2].length >= fence.length && line.trim() === m[2]) {
				fence = undefined;
				vueFence = false;
				out.push(line);
				continue;
			}
			// A `-vue` fence has Vue's `{{ }}` evaluated: string literals print as themselves.
			out.push(vueFence ? line.replace(/\{\{\s*(['"])((?:(?!\1).)*)\1\s*\}\}/g, "$2") : line);
			continue;
		}
		const open = FENCE.exec(line);
		if (open) {
			fence = open[2];
			vueFence = /^\s*(?:`{3,}|~{3,})\s*[\w-]+-vue\b/.test(line);
			out.push(vueFence ? line.replace(/-vue\b/, "") : line);
			continue;
		}
		// `<script setup>`, `<script>` and `<style>` at the start of a line, to their end tag.
		const block = /^<(script|style)\b/i.exec(line)?.[1].toLowerCase() ?? (/^\s*<ClientOnly>/.test(line) ? "ClientOnly" : undefined);
		if (block !== undefined) {
			const end = new RegExp(`</${block}>`, block === "ClientOnly" ? "" : "i");
			let j = i;
			while (j < lines.length && !end.test(lines[j])) j++;
			i = j;
			continue;
		}
		out.push(line);
	}
	return out.join("\n");
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** A page link as VitePress writes it: `.md` is the page's URL, with `.html` unless the site's URLs are folders, and a relative one starts with `./`. */
export function vitepressHref(href: string, htmlUrls: boolean): string {
	if (!href || href.startsWith("#") || EXTERNAL.test(href)) return href;
	const m = /^([^?#]*)(.*)$/.exec(href)!;
	let path = m[1];
	const rest = m[2];
	const index = /(^|.*\/)index\.md$/i.exec(path);
	if (index) path = index[1];
	else if (/\.md$/i.test(path)) path = path.slice(0, -3) + (htmlUrls ? ".html" : "");
	else if (htmlUrls && path && !path.endsWith("/") && !/\.\w+$/.test(path)) path += ".html";
	if (path && !path.startsWith("/") && !path.startsWith("./")) path = `./${path}`;
	return path + rest;
}

/** markdown-it's (mdurl's) encoding of a link: characters outside ASCII, and spaces, percent-encoded. */
const encodeUrl = (url: string) => url.replace(/[^\x21-\x7e]+/g, (s) => encodeURIComponent(s));

/** Each line of highlighted code in a `<span class="line">`, as Shiki writes them; a token that runs over a line break is closed and opened again around it. */
function lineSpans(html: string): string {
	if (html.startsWith("<span class=\"line")) return html.replace(/\n$/, "");
	const open: string[] = [];
	return html.replace(/\n$/, "").split("\n").map((line) => {
		const start = open.join("");
		for (const m of line.matchAll(/<span\b[^>]*>|<\/span>/g)) {
			if (m[0] === "</span>") open.pop();
			else open.push(m[0]);
		}
		return `<span class="line">${start}${line}${"</span>".repeat(open.length)}</span>`;
	}).join("\n");
}

/** A fence's label: its language, `vue-html` as `template`, without `-vue`. */
const fenceLabel = (lang: string) => (lang === "vue-html" ? "template" : lang.replace(/-vue$/, ""));
/** A fence's title, `[vite.config.js]` in its info string. */
const fenceTitle = (info: string) => /\[([^\]]+)\]/.exec(info)?.[1] ?? "";

function fenceHtml(fence: Data): string {
	const lang = fenceLabel(str(fence.lang));
	const highlighted = typeof fence.highlighted === "string" && fence.highlighted !== "" ? fence.highlighted : escapeHtml(str(fence.code));
	const block = `<div class="language-${escapeHtml(lang)} vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">${escapeHtml(lang)}</span><pre class="shiki vp-code" tabindex="0"><code>${lineSpans(highlighted)}</code></pre></div>`;
	const title = fenceTitle(str(fence.info));
	return title ? `<div class="vp-code-block-title"><div class="vp-code-block-title-bar"><span class="vp-code-block-title-text" data-title="${escapeHtml(title)}">${escapeHtml(title)}</span></div>${block}</div>` : block;
}

const custom = (kind: string, title: string) => (c: Data) => {
	const args = str(c.args).trim();
	const head = args ? `<p class="custom-block-title">${args}</p>` : `<p class="custom-block-title custom-block-title-default">${title}</p>`;
	return `<div class="${kind} custom-block">${head}\n${str(c.content)}</div>`;
};

/** `::: code-group`: a tab for each fence's `[label]`, then the blocks, the first one showing. The ids come from the group's text, so a build writes the same ones every time. */
function codeGroup(c: Data): string {
	const source = str(c.source);
	const labels = [...source.matchAll(/^\s*(?:`{3,}|~{3,})\S*[^\n]*?\[([^\]]+)\]/gm)].map((m) => m[1]);
	const id = crypto.createHash("sha1").update(source).digest("hex").slice(0, 5);
	const tabs = labels.map((label, i) => `<input type="radio" name="group-${id}" id="tab-${id}-${i}"${i === 0 ? " checked" : ""}><label data-title="${escapeHtml(label)}" for="tab-${id}-${i}">${escapeHtml(label)}</label>`).join("");
	// Inside a group, a block's title is its tab.
	const blocks = str(c.content)
		.replace(/<div class="vp-code-block-title"><div class="vp-code-block-title-bar">[\s\S]*?<\/div>(<div class="language-[\s\S]*?<\/pre><\/div>)<\/div>/g, "$1")
		.replace(/<div class="(language-[^"]*)"/, "<div class=\"$1 active\"");
	return `<div class="vp-code-group"><div class="tabs">${tabs}</div><div class="blocks">${blocks}</div></div>`;
}

/** The built-in hooks, by the name a site's template would have (`hooks/heading`, `containers/tip`). */
export const VITEPRESS_HOOKS: Record<string, Hook> = {
	"hooks/heading": (h) => {
		const level = str(h.level), id = escapeHtml(str(h.id));
		return `<h${level} id="${id}" tabindex="-1">${str(h.content)} <a class="header-anchor" href="#${id}" aria-label="Permalink to “${escapeHtml(str(h.text).trim())}”">​</a></h${level}>`;
	},
	"hooks/link": (l, o) => {
		const href = str(l.href);
		const title = l.title ? ` title="${escapeHtml(str(l.title))}"` : "";
		if (EXTERNAL.test(href)) return `<a href="${escapeHtml(encodeUrl(href))}"${title} target="_blank" rel="noreferrer">${str(l.content)}</a>`;
		return `<a href="${escapeHtml(encodeUrl(vitepressHref(href, o.htmlUrls)))}"${title}>${str(l.content)}</a>`;
	},
	"hooks/fence": (f) => fenceHtml(f),
	"hooks/table": (t) => `<table tabindex="0">${str(t.content)}</table>`,
	"containers/tip": custom("tip", "TIP"),
	"containers/info": custom("info", "INFO"),
	"containers/warning": custom("warning", "WARNING"),
	"containers/danger": custom("danger", "DANGER"),
	"containers/details": (c) => `<details class="details custom-block"><summary>${str(c.args).trim() || "Details"}</summary>\n${str(c.content)}</details>`,
	"containers/raw": (c) => `<div class="vp-raw">\n${str(c.content)}</div>`,
	"containers/code-group": codeGroup,
};

/** `[[toc]]`, and HTML comments, after ssqch's Markdown: the page's `h2` and `h3`s as nested lists, as markdown-it-table-of-contents writes them. */
export function vitepressAfter(html: string): string {
	let out = html.includes("<!--") ? withoutComments(html) : html;
	out = asVueWritesIt(out);
	const marker = /<p>\[\[toc\]\]<\/p>/i.exec(out);
	if (!marker) return out;
	const heads = [...out.matchAll(/<h([23]) id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/g)].map(([, level, id, inner]) => ({ level: Number(level), id, text: inner.replace(/<a class="header-anchor"[\s\S]*?<\/a>/, "").replace(/<[^>]+>/g, "").trim() }));
	let toc = "<nav class=\"table-of-contents\"><ul>";
	let level = 2;
	let open = false;
	for (const h of heads) {
		if (h.level > level) { toc += "<ul>"; level = h.level; }
		else if (h.level < level) { toc += "</li></ul></li>"; level = h.level; }
		else if (open) toc += "</li>";
		toc += `<li><a href="#${h.id}">${h.text}</a>`;
		open = true;
	}
	if (open) toc += "</li>";
	while (level-- > 2) toc += "</ul></li>";
	toc += "</ul></nav>";
	out = out.replace(marker[0], toc);
	return out;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * A page's raw HTML as Vue's template compiler writes it in VitePress: a self-closing element
 * (`<sup class="vt-badge" data-text="3.3+" />`) gets its end tag, as a browser would otherwise
 * leave it open and put the rest of the line inside it (32 of vuejs.org's pages), and `v-pre` and
 * event listeners (`@click="..."`, `v-on:click`) are left out, as Vue doesn't write them. Lower-case
 * tags only: a PascalCase one is a component. Code isn't touched.
 */
function asVueWritesIt(html: string): string {
	if (!/\/>|\sv-pre\b|\s@[\w.-]+=|\sv-on:/.test(html)) return html;
	return html.replace(/<(pre|code|script|style|textarea)\b[\s\S]*?<\/\1>|<([a-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g, (whole, raw: string | undefined, name: string, attrs: string, selfClosing: string) => {
		if (raw !== undefined) return whole;
		const kept = attrs.replace(/\s+(?:v-pre|@[\w.:-]+|v-on:[\w.:-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g, "");
		if (selfClosing && !VOID.has(name)) return `<${name}${kept}></${name}>`;
		return kept === attrs ? whole : `<${name}${kept}${selfClosing ? " /" : ""}>`;
	});
}

/** Comments out, outside `<pre>`, `<code>`, `<script>`, `<style>` and `<textarea>`. */
function withoutComments(html: string): string {
	return html.replace(/<(pre|code|script|style|textarea)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, (m, raw: string | undefined) => (raw ? m : ""));
}
