// `markdown.math: { render: "katex" }`: the formulas ssqch's Markdown marked, rendered with the
// site's own KaTeX while the site builds. The Rust writes each formula as the TeX it was, escaped,
// in `<span class="math math-inline">\(...\)</span>` or `<div class="math math-display">\[...\]</div>`
// (a `<span>` inside a line), the markup KaTeX's auto-render and MathJax read in a browser; this
// replaces what's inside with KaTeX's HTML. KaTeX is the site's package, as Vue is for `ssqch/vue`:
// ssqch doesn't bundle it, so a site gets the version (and the stylesheet) it installed.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { bail, BuildError } from "../diagnostics.ts";
import type { MathOptions } from "../markdown-options.ts";

/** What ssqch calls of KaTeX. */
interface Katex {
	renderToString(tex: string, options: Record<string, unknown>): string;
}

/** The site's KaTeX, by project root: loaded once a process (`ssqch serve` starts its builder again when the config changes). */
const loaded = new Map<string, Katex>();

/** The site's `katex`, from its `node_modules` (the root's and its parents'), or an error that says how to install it. */
export function siteKatex(root: string): Katex {
	const known = loaded.get(root);
	if (known) return known;
	// CommonJS, so it loads while a page renders, which can't wait: KaTeX's package has a
	// `require` entry (`dist/katex.js`).
	const req = createRequire(path.join(root, "package.json"));
	let entry: string;
	try {
		entry = req.resolve("katex");
	} catch {
		const pm = fs.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm add -D" : fs.existsSync(path.join(root, "yarn.lock")) ? "yarn add -D" : "npm install -D";
		bail(`markdown.math: render: "katex" needs the katex package in the site's packages: \`${pm} katex\` (and link its stylesheet, katex/dist/katex.min.css, from your layout)`);
	}
	const mod = req(entry!) as Katex & { default?: Katex };
	const katex = typeof mod.renderToString === "function" ? mod : mod.default;
	if (typeof katex?.renderToString !== "function") bail(`markdown.math: the katex package at ${entry!} has no renderToString(): is it KaTeX?`);
	loaded.set(root, katex!);
	return katex!;
}

const MATH = /<span class="math math-inline">\\\(([\s\S]*?)\\\)<\/span>|<(span|div) class="math math-display">\\\[([\s\S]*?)\\\]<\/\2>/g;

/** The HTML ssqch's Markdown wrote with its formulas through KaTeX (`katex()`, asked for at the first formula). `where(tex)` says where an error is (`page.md:12: `, or `in page.md: `). */
export function renderMath(html: string, math: MathOptions, katex: () => Katex, where: (tex: string) => string): string {
	if (!html.includes("class=\"math math-")) return html;
	return html.replace(MATH, (_whole, inline: string | undefined, element: string | undefined, display: string | undefined) => {
		const displayMode = inline === undefined;
		// The Rust escaped the TeX for HTML; KaTeX gets it as it was written.
		const tex = unescape(displayMode ? display! : inline);
		const site = katex();
		let out: string;
		try {
			out = site.renderToString(tex,{ throwOnError: true, ...math.katex, displayMode });
		} catch (e) {
			// KaTeX's `ParseError` has the message without its excerpt (`rawMessage`) and where in
			// the formula it is (`position`, from 0): the formula's written out in full here.
			const { rawMessage, position } = (e ?? {}) as { rawMessage?: unknown; position?: unknown };
			const message = typeof rawMessage === "string" ? `${rawMessage}${typeof position === "number" ? ` (at character ${position + 1})` : ""}` : e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : String(e);
			const dollars = displayMode ? "$$" : "$";
			throw new BuildError(`${where(tex)}KaTeX can't render ${dollars}${tex.trim()}${dollars}: ${message}`);
		}
		return displayMode ? `<${element} class="math math-display">${out}</${element}>` : `<span class="math math-inline">${out}</span>`;
	});
}

const KATEX_HTML = "<span class=\"katex-html\" aria-hidden=\"true\">";

/**
 * KaTeX's output for a feed: its MathML alone. KaTeX writes each formula twice, as MathML (for
 * screen readers) and as HTML that its stylesheet lays out; a feed reader has no stylesheet, so
 * the HTML half shows as a second, broken copy beside the MathML, which readers' browsers render
 * by themselves.
 */
export function mathmlOnly(html: string): string {
	if (!html.includes(KATEX_HTML)) return html;
	let out = "";
	let from = 0;
	for (let at = html.indexOf(KATEX_HTML); at !== -1; at = html.indexOf(KATEX_HTML, from)) {
		out += html.slice(from, at);
		// To its `</span>`, past the spans inside it.
		let depth = 0;
		const tag = /<span\b|<\/span>/g;
		tag.lastIndex = at;
		let end = html.length;
		for (let m = tag.exec(html); m; m = tag.exec(html)) {
			depth += m[0] === "</span>" ? -1 : 1;
			if (depth === 0) { end = m.index + m[0].length; break; }
		}
		from = end;
	}
	return out + html.slice(from);
}

/** Where a formula is in a page's Markdown: the line of the source its first line is on, from 1 (the front matter's lines are added later, as for a template's). */
export function lineOf(source: string, tex: string): number | undefined {
	const first = tex.split("\n").map((line) => line.trim()).find((line) => line !== "");
	if (first === undefined) return undefined;
	// The occurrence that a `$` opens (spaces, a line's end or a quote's `>` between them), not the
	// same text written earlier in prose or code: `$&$` after a sentence with an `&` in it.
	let at = source.indexOf(first);
	while (at !== -1 && !/\$[ \t]*(?:\r?\n[ \t>]*)?$/.test(source.slice(Math.max(0, at - 64), at))) at = source.indexOf(first, at + 1);
	if (at === -1) return undefined;
	let line = 1;
	for (let i = source.indexOf("\n"); i !== -1 && i < at; i = source.indexOf("\n", i + 1)) line++;
	return line;
}

/** What `escape_html` in the Rust wrote, back as it was. */
function unescape(text: string): string {
	if (!text.includes("&")) return text;
	return text.replace(/&(?:amp|lt|gt|quot);/g, (entity) => (entity === "&amp;" ? "&" : entity === "&lt;" ? "<" : entity === "&gt;" ? ">" : "\""));
}
