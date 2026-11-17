// `base`: a site served below the root of its domain, like a GitHub Pages project site at
// `https://user.github.io/repo/`.
//
// Templates keep writing URLs from the site's own root (`/about/`, `/assets/site.css`), and
// `page.url` stays `/about/`. With `base: "/repo/"`, the last step of writing an HTML page puts
// `/repo` in front of every such URL in its attributes (and in `url()` in its styles). The
// output folder doesn't change: it's what the host serves at `/repo/`.
//
// URLs outside HTML attributes (in an inline script, a JSON file, a feed) aren't touched;
// templates use the `withBase()` filter or `ssqch.base` there.
import { bail } from "./diagnostics.ts";
import { rewriteHtml } from "./html.ts";

/** A `base` setting as the build keeps it: empty for none, or `/repo` (starting with `/`, with no `/` at the end). */
export function normalizeBase(base: string): string {
	const trimmed = base.trim();
	if (trimmed === "" || trimmed === "/") return "";
	if (!trimmed.startsWith("/") || trimmed.startsWith("//")) bail(`base must be a URL path starting with /, like "/docs/" (got ${JSON.stringify(base)}); the domain isn't part of it`);
	if (/[?#\\\s]/.test(trimmed) || trimmed.split("/").some((p) => p === ".." || p === ".") || trimmed.includes("//")) bail(`base must be a plain URL path, like "/docs/" (got ${JSON.stringify(base)})`);
	return trimmed.replace(/\/+$/, "");
}

/** Whether `url` is from the site's root: `/about/`, but not `//cdn.example.com/x`. */
const fromRoot = (url: string) => url.startsWith("/") && !url.startsWith("//");

/** `url` with `base` in front, if it's from the site's root. Anything else (relative, `#top`, `https:`) is returned as it is. */
export function withBase(base: string, url: string): string {
	return base === "" || !fromRoot(url) ? url : base + url;
}

/** Attributes that hold one URL. */
const URL_ATTRIBUTES = ["href", "src", "action", "poster", "data", "formaction", "cite", "xlink:href", "manifest"];
/** Attributes that hold a list of `url descriptor` candidates. */
const SRCSET_ATTRIBUTES = ["srcset", "imagesrcset"];

// The quote can be written as an entity, as it is inside a `style` attribute that a serializer
// or a minifier wrote: `url(&quot;/hero.jpg&quot;)`.
const CSS_URL = /url\(\s*(["']|&quot;|&#34;|&#39;|&apos;)?\/((?:[^/)"'&]|&amp;)(?:[^)"'&]|&amp;)*)?(["')]|&quot;|&#34;|&#39;|&apos;)/g;
const REFRESH = /^(\s*[\d.]+\s*[;,]\s*url\s*=\s*["']?)(\/.*)$/is;
const SPACE = /[\t\n\f\r ]/;

/**
 * A `srcset` with `base` in front of each candidate's URL that's from the site's root. Read as
 * browsers read it: a URL runs to the next whitespace (so the commas in a `data:` URI are part
 * of it), then its descriptors run to the next comma.
 */
export function srcsetWithBase(base: string, srcset: string): string {
	let out = "";
	let i = 0;
	const n = srcset.length;
	while (i < n) {
		let start = i;
		while (i < n && (SPACE.test(srcset[i]) || srcset[i] === ",")) i++;
		out += srcset.slice(start, i);
		start = i;
		while (i < n && !SPACE.test(srcset[i])) i++;
		const url = srcset.slice(start, i);
		if (fromRoot(url)) out += base;
		out += url;
		// A URL that ends in a comma ends its candidate; otherwise its descriptors follow.
		if (!url.endsWith(",")) {
			start = i;
			while (i < n && srcset[i] !== ",") i++;
			out += srcset.slice(start, i);
		}
	}
	return out;
}

/** `css` with `base` in front of every `url()` from the site's root. */
export function cssWithBase(base: string, css: string): string {
	if (base === "") return css;
	return css.replace(CSS_URL, (_, open: string | undefined, rest: string | undefined, close: string) => `url(${open ?? ""}${base}/${rest ?? ""}${close}`);
}

/**
 * Puts `base` in front of every URL from the site's root in `html`: the attributes that hold
 * URLs, `srcset` lists, a meta refresh, and `url()` in `style` attributes and `<style>` elements.
 */
export function rewriteBase(html: string, base: string): string {
	if (base === "") return html;
	return rewriteHtml(html, {
		tag(el) {
			for (const attr of URL_ATTRIBUTES) {
				const v = el.get(attr);
				if (v !== undefined && fromRoot(v.trimStart())) el.set(attr, base + v.trimStart());
			}
			for (const attr of SRCSET_ATTRIBUTES) {
				const v = el.get(attr);
				if (v === undefined) continue;
				const changed = srcsetWithBase(base, v);
				if (changed !== v) el.set(attr, changed);
			}
			const style = el.get("style");
			if (style?.includes("url(")) el.set("style", cssWithBase(base, style));
			if (el.name === "meta" && el.get("http-equiv")?.toLowerCase() === "refresh") {
				const found = REFRESH.exec(el.get("content") ?? "");
				if (found && fromRoot(found[2])) el.set("content", `${found[1]}${base}${found[2]}`);
			}
		},
		style: (css) => (css.includes("url(") ? cssWithBase(base, css) : css),
	});
}
