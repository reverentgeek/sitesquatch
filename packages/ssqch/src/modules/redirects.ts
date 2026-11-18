// `ssqch/redirects`: old URLs come from each page's `aliases` (a URL path or a list of them;
// without a leading `/`, a path is still from the site's root) and from the `redirects` option
// (`{ "/old/": "/new/" }`, where the target can be another site). Each becomes a small page that
// sends browsers on (a meta refresh, with a canonical link and `noindex`), a line in a Netlify
// `_redirects` file, or both. The `_redirects` lines go after any the site's own `_redirects`
// template writes. Ported from `plugins/redirects`.
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
	const o = new Options(given, ["pages", "netlify", "redirects"]);
	const pages = o.bool("pages") ?? true;
	const netlify = o.bool("netlify") ?? false;
	const redirects = new Map<string, string>();
	const map = o.get("redirects");
	if (map !== undefined) {
		if (typeof map !== "object" || Array.isArray(map)) bail("redirects must be an object of { \"/old/\": \"/new/\" }");
		for (const [from, to] of Object.entries(map as Record<string, unknown>)) {
			if (typeof to !== "string") bail(`redirects.${from}: the new URL must be a string`);
			redirects.set(from, to);
		}
	}
	if (!pages && !netlify) bail("pages and netlify are both false, so there's nothing to write; turn one on");
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
		for (const [from, [to, source]] of [...all].sort((a, b) => compareText(a[0], b[0]))) {
			const page = byUrl.get(trimSlashes(from));
			if (page) {
				const input = isInside(config.root, page.inputPath) ? relative(config.root, page.inputPath) : slashes(page.inputPath);
				bail(`${source}: ${from} is the URL of ${input}, so it can't redirect to ${to}`);
			}
			if (pages) {
				const path = from.endsWith("/") || hasExtension(from) ? from : `${from}/`;
				// Generated files aren't rewritten for `base`, so the target gets it here.
				const target = withBase(config.base, to);
				files.push({ path, contents: redirectPage(target), hook: { name: "redirect", value: { from, to: target } } });
			}
			lines += `${from}  ${to}  301\n`;
		}
		if (netlify && lines !== "") files.push({ path: "/_redirects", contents: lines, append: true });
		return files;
	}]);
});
