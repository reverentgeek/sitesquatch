// `ssqch/redirects`: old URLs come from each page's `aliases` (a URL path or a list of them;
// without a leading `/`, a path is still from the site's root) and from the `redirects` option
// (`{ "/old/": "/new/" }`, where the target can be another site). Each becomes a small page that
// sends browsers on (a meta refresh, with a canonical link and `noindex`), a line in a Netlify
// `_redirects` file, or both. The `_redirects` lines go after any the site's own `_redirects`
// template writes, with the site's `base` on both URLs (a host matches the request's whole
// path), as a redirect page's target has it. Ported from `plugins/redirects`.
//
// An old URL with a `*` or a `:name` in it (`"/news/*": "/blog/:splat"`) is a pattern, which only
// a host can match: it's a line and never a page, and its line comes after the exact addresses,
// since a host takes the first line that matches.
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile } from "../config.ts";
import { bail, context } from "../diagnostics.ts";
import { withBase } from "../base.ts";
import { compareText, displayPath, isInside, relative, slashes } from "../paths.ts";
import { Options } from "./options.ts";
import { debugString, escapeHtml } from "./plugin-util.ts";

export function redirectsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/redirects", builtin: "ssqch/redirects", options };
}

function checkPath(path: string): void {
	if (!path.startsWith("/") || path.split("/").includes("..") || /[?# ]/.test(path)) bail(`${debugString(path)} must be a URL path starting with /, like "/old-post/"`);
}

/** The redirect page for `to`. With JavaScript on, it keeps the old URL's `#fragment` (`/old/#install` goes to `/new/#install`). */
export function redirectPage(to: string): string {
	const js = jsString(to);
	const html = escapeHtml(to);
	return `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<title>Redirecting to ${html}</title>\n<link rel="canonical" href="${html}">\n<meta name="robots" content="noindex">\n<meta http-equiv="refresh" content="0; url=${html}">\n<script>location.replace(${js} + location.hash)</script>\n<p>This page has moved to <a href="${html}">${html}</a>.</p>\n</html>\n`;
}

/** `to` as a JavaScript string literal that's safe inside `<script>`. */
function jsString(to: string): string {
	let out = "\"";
	for (const c of to) {
		if (c === "\"") out += "\\\"";
		else if (c === "\\") out += "\\\\";
		else if (c === "<") out += "\\u003c";
		else if (c.charCodeAt(0) < 0x20) out += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
		else out += c;
	}
	return `${out}"`;
}

const typeOf = (v: unknown) => (v === null ? "object" : typeof v);

/** `/old` and `/old/` both become `/old/index.html`; `/old.html` stays a file. `/releases/1.85.0` is a folder: an extension has letters. */
function hasExtension(from: string): boolean {
	const last = from.slice(from.lastIndexOf("/") + 1);
	const dot = last.lastIndexOf(".");
	if (dot <= 0) return false;
	const ext = last.slice(dot + 1);
	return ext.length >= 1 && ext.length <= 5 && /^[A-Za-z]+$/.test(ext);
}

const trimSlashes = (url: string) => url.replace(/\/+$/, "");

/** Where a pattern's own part starts: its first `*`, or a segment that's a placeholder (`/:year/`). A colon inside a segment (`/wiki/Help:Contents`) is part of the name. */
const PATTERN = /\*|\/:[A-Za-z_]/;
/** How much of an old URL is fixed: all of it, or what's before its pattern. */
const fixedLength = (from: string) => { const at = from.search(PATTERN); return at === -1 ? from.length : at; };
const isPattern = (from: string) => PATTERN.test(from);
/**
 * The order of the lines. A host takes the first one that matches, so the exact addresses come
 * first (sorted, as they always were), then the patterns, the one with the most fixed in front
 * first: `/snacks/old/` before `/snacks/*`, and `/snacks/2019/*` before `/snacks/*`. Sorted
 * together, `/snacks/*` came first and took every address under it.
 */
const byMatch = (a: string, b: string) => Number(isPattern(a)) - Number(isPattern(b)) || (isPattern(a) ? fixedLength(b) - fixedLength(a) : 0) || compareText(a, b);

/**
 * An alias that YAML read as a date (`aliases: 2024-01-01`), as it was written, which is how 0.7
 * kept it: the date, or the date and time (`2020-02-03T04:05:06Z`) when it has one.
 */
function asWritten(alias: unknown): unknown {
	if (!(alias instanceof Date) || Number.isNaN(alias.getTime())) return alias;
	const iso = alias.toISOString();
	return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(/\.000Z$/, "Z");
}

BUILTINS.set("ssqch/redirects", (config: Config, given) => {
	// `netlify` was this option's name until 0.14: Cloudflare reads the same `_redirects`, so it's
	// named for what it writes, and the old name says the new one rather than "unknown option".
	if (typeof given === "object" && given !== null && "netlify" in given && (given as Record<string, unknown>).netlify !== undefined) bail("netlify is called hostFile now (Netlify and Cloudflare both read _redirects): redirectsPlugin({ hostFile: true })");
	const o = new Options(given, ["pages", "hostFile", "redirects", "notFound"]);
	const hostFile = o.bool("hostFile") ?? false;
	// A host answers a miss with the site's 404 page only at its domain's root: under a path, the
	// site's own catch-all line does it, and it has to come after every other line, since a host
	// takes the first match (the Squatch Snacks rerun wrote its whole `_redirects` for this).
	const notFound = o.get("notFound");
	if (notFound !== undefined && (typeof notFound !== "string" || !notFound.startsWith("/"))) bail("notFound must be the not-found page's URL path, like \"/404.html\"");
	if (notFound !== undefined && !hostFile) bail("notFound is a line in _redirects: set hostFile: true too");
	if (notFound !== undefined) {
		try { checkPath(notFound as string); } catch (e) { throw context(e, "notFound"); }
	}
	// A host serves a file that exists before it reads `_redirects`, so with both, an old address
	// answers 200 with the redirect page and never the 301 line: pages are off when the file is on.
	const pages = o.bool("pages") ?? !hostFile;
	const redirects = new Map<string, string>();
	const map = o.get("redirects");
	if (map !== undefined) {
		if (typeof map !== "object" || Array.isArray(map)) bail("redirects must be an object of { \"/old/\": \"/new/\" }");
		for (const [from, to] of Object.entries(map as Record<string, unknown>)) {
			if (typeof to !== "string") bail(`redirects.${from}: the new URL must be a string`);
			redirects.set(from, to);
		}
	}
	if (!pages && !hostFile) bail("pages and hostFile are both false, so there's nothing to write; turn one on");
	for (const from of redirects.keys()) {
		try { checkPath(from); } catch (e) { throw context(e, "redirects"); }
	}

	config.generators.push(["ssqch/redirects", (config, summaries) => {
		// A page's URL, with or without its trailing slash, to the first page that has it.
		const byUrl = new Map<string, (typeof summaries)[number]>();
		for (const p of summaries) if (!byUrl.has(trimSlashes(p.url))) byUrl.set(trimSlashes(p.url), p);
		// Old URL -> (new URL, where it came from).
		const all = new Map<string, [string, string]>();
		for (const [from, to] of redirects) all.set(from, [to, "the redirects option"]);
		for (const page of summaries) {
			const source = displayPath(config.root, page.inputPath);
			const given = asWritten(page.data.aliases);
			if (given === undefined || given === null) continue;
			let aliases: unknown[];
			if (typeof given === "string") aliases = [given];
			else if (Array.isArray(given)) aliases = given.map(asWritten);
			else bail(`${source}: aliases must be a URL path or a list of them, not ${typeOf(given)}`);
			for (const each of aliases) {
				if (typeof each !== "string") bail(`${source}: aliases must be URL paths, not ${typeOf(each)}`);
				let alias: string = each;
				// `2019/05/15/post.html` is from the site's root, like `/2019/05/15/post.html`.
				if (!alias.startsWith("/")) alias = `/${alias}`;
				try { checkPath(alias); } catch (e) { throw context(e, `${source}: aliases`); }
				const other = all.get(alias);
				all.set(alias, [page.url, source]);
				if (other) bail(`${other[1]} and ${source} both redirect ${alias}`);
			}
		}
		const files: GeneratedFile[] = [];
		let lines = "";
		for (const [from, [to, source]] of [...all].sort((a, b) => byMatch(a[0], b[0]))) {
			const page = byUrl.get(trimSlashes(from));
			if (page) {
				const input = isInside(config.root, page.inputPath) ? relative(config.root, page.inputPath) : slashes(page.inputPath);
				bail(`${source}: ${from} is the URL of ${input}, so it can't redirect to ${to}`);
			}
			const pattern = isPattern(from);
			// A page can't stand for every address a pattern matches (it was written at `news/*/index.html`,
			// which answers nobody, and isn't a file name Windows takes), so without the lines there's
			// nothing that redirects it.
			if (pattern && !hostFile) bail(`${source}: ${from} is a pattern (a \`*\` or a \`:name\`), which only a host can match, and a redirect page can't. Set hostFile: true, so it's a line in _redirects`);
			if (pages && !pattern) {
				const path = from.endsWith("/") || hasExtension(from) ? from : `${from}/`;
				// Generated files aren't rewritten for `base`, so the target gets it here.
				const target = withBase(config.base, to);
				files.push({ path, contents: redirectPage(target), hook: { name: "redirect", value: { from, to: target } } });
			}
			// Hosts match a line against the whole URL path, which has the base in front.
			lines += `${withBase(config.base, from)}  ${withBase(config.base, to)}  301\n`;
		}
		if (typeof notFound === "string") lines += `${withBase(config.base, "/*")}  ${withBase(config.base, notFound)}  404\n`;
		if (hostFile && lines !== "") files.push({ path: "/_redirects", contents: lines, append: true });
		return files;
	}]);
});
