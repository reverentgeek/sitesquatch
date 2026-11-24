// `ssqch/links`: a link checker. After a build, every internal link in the HTML it wrote has to
// point at something in the output folder, and a `#fragment` has to match an `id` (or `<a name>`)
// on the page it points to. Checked: `href` on `a`, `link` and `area`; `src` on `img`, `script`,
// `iframe`, `source`, `video`, `audio`, `track` and `embed`; and each URL in `srcset`.
//
// Pages also link with URLs outside those attributes, so these are checked too, when they're on
// the site (from its root, or absolute on its address): `<meta>` values that are URLs
// (`og:image`, `twitter:image`, `og:url`), strings in `application/ld+json` blocks, `imagesrcset`
// on a preload `<link>`, and in `.xml` output (feeds, the sitemap), URLs in attributes and
// elements, including the escaped HTML of a feed entry's content.
//
// External links (anything with a scheme, like `https:` or `mailto:`, or starting with `//`)
// aren't checked, unless they're on the site's own address: the `url` option, or the one
// `sitemap.xml` uses. Neither are paths a Netlify `_redirects` file in the output covers, or
// paths under an `ignore` prefix.
//
// A path matches a file (`/feed.xml`), `name.html` (`/about` for `/about.html`) or `index.html`
// in a folder (`/about/`, or `/about`, which hosts redirect to `/about/`).
//
// Broken links fail production builds; in `ssqch serve` and development builds they're printed
// as warnings. Ported from `plugins/links`.
import fs from "node:fs";
import path from "node:path";
import { BUILTINS, dirsOf } from "../config.ts";
import type { Config } from "../config.ts";
import { Diagnostics, bail, error, isCapturing, warn, warning } from "../diagnostics.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { rewriteHtml } from "../html.ts";
import { compareText } from "../paths.ts";
import { count } from "../report.ts";
import { closest, closestPathFinder } from "../suggest.ts";
import * as voice from "../voice.ts";
import { Options } from "./options.ts";

export function linksPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/links", builtin: "ssqch/links", options };
}

interface LinksOptions {
	/** Check `#fragments` against the target page's ids (default true). */
	anchors?: boolean;
	/** URL path prefixes not to check, like `/downloads/`. */
	ignore: string[];
	/** Fail the build on a broken link. `undefined` means production builds only (not `ssqch serve`); otherwise broken links are warnings. */
	fail?: boolean;
	/** The site's address (`https://example.com`), so absolute links to it are checked like links from its root. `undefined`: the address the output's `sitemap.xml` uses, if there is one. */
	url?: string;
}

/** A link that doesn't resolve: the page it's on, the link as written, why. */
interface Broken {
	page: string;
	link: string;
	reason: string;
}

/** What one page contains: the ids it defines and the links it makes. */
interface PageScan {
	ids: Set<string>;
	links: string[];
	/** URLs that are only checked when they're on the site (from its root, or absolute on its address): `<meta>` values, JSON-LD strings, and everything in XML, where a relative URL's base isn't the file's own. */
	siteLinks: string[];
	/** JSON-LD strings: their `#fragment` names a thing, not an id on a page. */
	sitePaths: string[];
	/** Where a redirect page sends a browser: its `<meta http-equiv="refresh">`'s `url`. */
	refresh?: string;
}

const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
const SPACES = /\s+/;
/** Rust's `trim()` and `split_whitespace()` cut at Unicode White_Space, which a few characters JavaScript's `\s` has don't belong to. */
const trim = (s: string) => s.trim();
const firstWord = (s: string): string | undefined => s.trim().split(SPACES)[0] || undefined;

/** `<meta>` names and properties whose `content` is a URL. */
function metaIsUrl(given: string): boolean {
	const name = asciiLower(given);
	if (name === "og:url" || name === "twitter:url" || name === "msapplication-tileimage" || name === "thumbnail") return true;
	return ["og:image", "og:video", "og:audio", "twitter:image", "twitter:player"].some((p) => {
		if (name === p) return true;
		if (!name.startsWith(p)) return false;
		const rest = name.slice(p.length);
		return rest === ":url" || rest === ":secure_url" || rest === ":src";
	});
}

/** Every string in a JSON value that could be a URL on this site. */
function jsonUrls(value: unknown, out: string[]): void {
	if (typeof value === "string") {
		if (value !== "" && !/\p{White_Space}/u.test(value) && (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://"))) out.push(value);
	} else if (Array.isArray(value)) {
		for (const v of value) jsonUrls(v, out);
	} else if (value !== null && typeof value === "object") {
		for (const v of Object.values(value)) jsonUrls(v, out);
	}
}

/** The candidates' URLs in a `srcset`. */
function srcsetUrls(srcset: string, out: string[], keep: Keep): void {
	for (const candidate of srcset.split(",")) {
		const url = firstWord(candidate);
		if (url !== undefined) out.push(keep(url));
	}
}

const XML_ATTR = /[\s<](?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const XML_SRCSET = /[\s<](?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const XML_TEXT = />\s*((?:https?:\/\/|\/)[^<>\s]*)\s*</g;
// Code in a feed entry's HTML (`<code>/snacks/*</code>`) is an example, not a link, as it is on a
// page, whose text isn't scanned at all. Only the text scan skips it: an `<a href>` in a `<pre>` is
// still a link.
const XML_CODE = /<(code|kbd|samp|pre|var)(?=[\s>])[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** What a scan keeps of a string it found: by default the string, which may be a slice that keeps its whole page alive (V8 slices long strings rather than copying them). */
type Keep = (found: string) => string;
const asFound: Keep = (found) => found;

/**
 * The URLs in an XML file (a feed, a sitemap): attribute values (`href`, `src`, `srcset`...) and
 * elements that hold only a URL (`<loc>`, `<link>`, `<id>`), including those in escaped HTML (a
 * feed entry's content), which is unescaped first.
 */
export function scanXml(xml: string, keep: Keep = asFound): string[] {
	const unescaped = unescapeXml(xml);
	const out: string[] = [];
	for (const c of unescaped.matchAll(XML_ATTR)) out.push(keep(unescapeXml(c[1] ?? c[2] ?? "")));
	for (const c of unescaped.matchAll(XML_SRCSET)) {
		for (const candidate of (c[1] ?? c[2] ?? "").split(",")) {
			const url = firstWord(candidate);
			if (url !== undefined) out.push(keep(unescapeXml(url)));
		}
	}
	const text = /<(?:code|kbd|samp|pre|var)(?=[\s>])/i.test(unescaped) ? unescaped.replace(XML_CODE, "<>") : unescaped;
	for (const c of text.matchAll(XML_TEXT)) out.push(keep(unescapeXml(c[1])));
	return out;
}

const NAMED: Record<string, string> = { lt: "<", gt: ">", quot: "\"", apos: "'", amp: "&" };

/** XML's five entities and numeric references, and CDATA markers (whose contents are already plain). */
export function unescapeXml(given: string): string {
	if (!given.includes("&") && !given.includes("<![CDATA[")) return given;
	const s = given.replaceAll("<![CDATA[", "").replaceAll("]]>", "");
	let out = "";
	let rest = s;
	for (let i = rest.indexOf("&"); i !== -1; i = rest.indexOf("&")) {
		out += rest.slice(0, i);
		const after = rest.slice(i + 1);
		const end = after.indexOf(";");
		let decoded: string | undefined;
		if (end !== -1 && end <= 8) {
			const name = after.slice(0, end);
			if (Object.hasOwn(NAMED, name)) decoded = NAMED[name];
			else {
				const hex = /^#[xX]([0-9a-fA-F]+)$/.exec(name);
				const dec = /^#([0-9]+)$/.exec(name);
				const code = hex ? Number.parseInt(hex[1], 16) : dec ? Number.parseInt(dec[1], 10) : undefined;
				if (code !== undefined && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) decoded = String.fromCodePoint(code);
			}
		}
		if (decoded !== undefined) {
			out += decoded;
			rest = after.slice(end + 1);
		} else {
			out += "&";
			rest = after;
		}
	}
	return out + rest;
}

/** The ids and links in a page. What it keeps of each string it found is `keep`'s answer. */
export function scanHtml(html: string, keep: Keep = asFound): PageScan {
	const found: PageScan = { ids: new Set(), links: [], siteLinks: [], sitePaths: [] };
	rewriteHtml(html, {
		tag(el) {
			const id = el.get("id");
			if (id !== undefined) found.ids.add(keep(id));
			switch (el.name) {
				case "a": {
					const name = el.get("name");
					if (name !== undefined) found.ids.add(keep(name));
					const href = el.get("href");
					if (href !== undefined) found.links.push(keep(href));
					break;
				}
				case "area": {
					const href = el.get("href");
					if (href !== undefined) found.links.push(keep(href));
					break;
				}
				case "link": {
					const href = el.get("href");
					if (href !== undefined) {
						// Hints to other origins, not resources on this site.
						const rel = asciiLower(el.get("rel") ?? "");
						if (!rel.trim().split(SPACES).some((r) => r === "preconnect" || r === "dns-prefetch")) found.links.push(keep(href));
					}
					const srcset = el.get("imagesrcset");
					if (srcset !== undefined) srcsetUrls(srcset, found.links, keep);
					break;
				}
				case "meta": {
					const content = el.get("content");
					if (content === undefined) break;
					if (asciiLower(el.get("http-equiv") ?? "") === "refresh") {
						const url = /;\s*url\s*=\s*['"]?([^'"]+)/i.exec(content)?.[1];
						if (url !== undefined) found.refresh = keep(url.trim());
						break;
					}
					const name = el.get("property") ?? el.get("name") ?? el.get("itemprop") ?? "";
					if (metaIsUrl(name)) found.siteLinks.push(keep(content));
					break;
				}
				case "img":
				case "source": {
					const src = el.get("src");
					if (src !== undefined) found.links.push(keep(src));
					const srcset = el.get("srcset");
					if (srcset !== undefined) srcsetUrls(srcset, found.links, keep);
					break;
				}
				case "script":
				case "iframe":
				case "video":
				case "audio":
				case "track":
				case "embed": {
					const src = el.get("src");
					if (src !== undefined) found.links.push(keep(src));
					break;
				}
			}
		},
		rawText(tag, text) {
			// A `type` attribute's value is matched without regard to case, as a CSS selector does for it in HTML (not in SVG).
			if (tag.name !== "script") return;
			const type = tag.get("type") ?? "";
			if ((tag.namespace === "html" ? asciiLower(type) : type) !== "application/ld+json") return;
			let value: unknown;
			try { value = JSON.parse(text); } catch { return; }
			jsonUrls(value, found.sitePaths);
		},
	});
	return found;
}

/** `https://example.com` from a site's address (`https://example.com/blog/`): the scheme and host, lowercase. `undefined` when it isn't an http(s) address. */
export function originOf(given: string): string | undefined {
	const url = trim(given);
	const at = url.indexOf("://");
	if (at === -1) return undefined;
	const scheme = asciiLower(url.slice(0, at));
	if (scheme !== "http" && scheme !== "https") return undefined;
	const rest = url.slice(at + 3);
	const host = asciiLower(rest.split(/[/?#]/)[0]);
	return host === "" ? undefined : `${scheme}://${host}`;
}

/** The address the output's `sitemap.xml` uses, from its first `<loc>`. */
function sitemapOrigin(output: string): string | undefined {
	let xml: string;
	try { xml = fs.readFileSync(path.join(output, "sitemap.xml"), "utf8"); } catch { return undefined; }
	const open = xml.indexOf("<loc>");
	if (open === -1) return undefined;
	const start = open + 5;
	const close = xml.indexOf("</loc>", start);
	if (close === -1) return undefined;
	return originOf(unescapeXml(trim(xml.slice(start, close))));
}

/** The path of an absolute URL on the site's address (`https://example.com/about/` is `/about/`), whether it's `http` or `https`. `undefined` for other URLs. */
export function stripOrigin(given: string, origin: string): string | undefined {
	const link = trim(given);
	const host = origin.slice(origin.indexOf("://") + 3);
	let rest: string | undefined;
	for (const scheme of ["https://", "http://"]) {
		if (asciiLower(link.slice(0, scheme.length)) === scheme) { rest = link.slice(scheme.length); break; }
	}
	if (rest === undefined || asciiLower(rest.slice(0, host.length)) !== host) return undefined;
	const after = rest.slice(host.length);
	if (after === "") return "/";
	return after.startsWith("/") || after.startsWith("?") || after.startsWith("#") ? after : undefined;
}

/** `link` without the site's `base`, or `undefined` for a path on the same domain that's outside it (`/other-project/` when the base is `/repo`). */
export function inSite(link: string, base: string): string | undefined {
	const trimmed = trim(link);
	if (base === "" || !trimmed.startsWith("/") || trimmed.startsWith("//")) return link;
	if (!trimmed.startsWith(base)) return undefined;
	const rest = trimmed.slice(base.length);
	if (rest === "") return "/";
	return rest.startsWith("/") || rest.startsWith("#") || rest.startsWith("?") ? rest : undefined;
}

/** `dist/about/index.html` -> `/about/`, `dist/feed.xml` -> `/feed.xml`. */
function urlOf(output: string, file: string): string {
	// The files written are in the output folder, as `path.join` made them: their path from it is
	// the rest of the string (`path.relative` takes longer than the scan of a page).
	const inside = file.length > output.length && file.startsWith(output) && file[output.length] === path.sep;
	const rel = (inside ? file.slice(output.length + 1) : path.relative(output, file)).split(path.sep).join("/");
	const url = `/${rel}`;
	return url.endsWith("index.html") ? url.slice(0, -"index.html".length) : url;
}

/** Whether a `#fragment` names one of `ids`, as a browser finds it: the fragment as written first, then percent-decoded (`#caf%C3%A9` reaches `id="café"`, `#tl%3Bdr` reaches `id="tl%3Bdr"`). */
function hasId(ids: Set<string>, fragment: string): boolean {
	return ids.has(fragment) || ids.has(percentDecode(fragment));
}

/** `mailto:`, `https:`, `data:`... A scheme comes before any `/`, `?` or `#`. */
function hasScheme(link: string): boolean {
	const i = link.indexOf(":");
	return i !== -1 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(link.slice(0, i));
}

/**
 * The URL path and fragment `link` points to, from a page at `pageUrl`. `undefined` for links
 * that aren't checked (external, or nothing to check). An empty path means the page itself
 * (`#top`).
 */
export function resolve(pageUrl: string, given: string): [string, string | undefined] | undefined {
	const link = trim(given);
	if (link === "" || link.startsWith("//") || hasScheme(link)) return undefined;
	// The fragment as written: an id can hold `%` (markdown-it-anchor's `tl%3Bdr`); `hasId` decodes too.
	const hash = link.indexOf("#");
	const rest = hash === -1 ? link : link.slice(0, hash);
	const fragment = hash === -1 || hash === link.length - 1 ? undefined : link.slice(hash + 1);
	const query = rest.indexOf("?");
	const target = query === -1 ? rest : rest.slice(0, query);
	if (target === "") return fragment === undefined ? undefined : ["", fragment];
	const joined = target.startsWith("/") ? target : pageUrl.slice(0, pageUrl.lastIndexOf("/") + 1) + target;
	return [normalize(percentDecode(joined)), fragment];
}

/** Resolves `.` and `..` segments, keeping a trailing slash. */
function normalize(p: string): string {
	const parts: string[] = [];
	for (const seg of p.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") parts.pop();
		else parts.push(seg);
	}
	const out = `/${parts.join("/")}`;
	return p.endsWith("/") && out !== "/" ? `${out}/` : out;
}

/** Whether `p` is a file. A path the system refuses (one with a NUL byte, from a link's `%00`, or too long) isn't one, as for 0.7. */
function isFile(p: string): boolean {
	try {
		return fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
	} catch {
		return false;
	}
}

/** The output file a URL path serves, if any. */
function find(output: string, urlPath: string, written: Set<string>): string | undefined {
	// A file this build wrote is there without asking the disk.
	const there = (p: string) => written.has(p) || isFile(p);
	const rel = urlPath.replace(/^\/+/, "");
	const base = path.join(output, rel);
	if (urlPath.endsWith("/")) {
		const index = path.join(base, "index.html");
		return there(index) ? index : undefined;
	}
	if (there(base)) return base;
	const html = path.join(output, `${rel}.html`);
	if (there(html)) return html;
	const index = path.join(base, "index.html");
	return there(index) ? index : undefined;
}

/**
 * The source paths of a Netlify `_redirects` file in the output: exact paths, and prefixes for
 * ones ending in `*`, with the site's `base` taken off (they're compared with links that have it
 * off). A line without the base is kept as it is, as a `_redirects` template written for the root
 * has it.
 */
export function redirectRules(output: string, base: string): RedirectRule[] {
	let text: string;
	try { text = fs.readFileSync(path.join(output, "_redirects"), "utf8"); } catch { return []; }
	const rules: RedirectRule[] = [];
	for (const line of text.split(/\r?\n/)) {
		const l = trim(line);
		if (l === "" || l.startsWith("#")) continue;
		const [from, to, status = ""] = l.split(/\s+/);
		if (from === undefined || !from.startsWith("/")) continue;
		const code = Number.parseInt(status, 10);
		rules.push({ from: inSite(from, base) ?? from, to: to ?? "", notFound: code >= 400 && code < 500, forced: status.endsWith("!") });
	}
	return rules;
}

/**
 * A line of `_redirects`. `notFound` is a 4xx line (`/*  /404.html  404`): the host answers
 * with that page and that status, so a link it covers is broken, not redirected. `forced` (`301!`)
 * is followed even where a file exists; a line that isn't is only for paths with no file, as
 * Netlify and Cloudflare serve a file before they read the rules.
 */
export interface RedirectRule { from: string; to: string; notFound: boolean; forced: boolean }

/**
 * The line a host follows for `p`: the first that covers it, as hosts take the first match, and
 * for a path with a file (`exists`), only a forced one. `undefined` when none applies.
 */
export function ruleFor(rules: RedirectRule[], p: string, exists: boolean): RedirectRule | undefined {
	return rules.find((r) => (!exists || r.forced) && covers(r.from, p));
}

/** Whether the line from `from` covers the path `p`. */
export const covers = (from: string, p: string) => (from.includes("/:") ? placeholdersMatch(from, p) : from.endsWith("*") ? p.startsWith(from.slice(0, -1)) : from === p || from.replace(/\/+$/, "") === p.replace(/\/+$/, ""));

export function redirected(sources: string[], p: string): boolean {
	return sources.some((from) => covers(from, p));
}

/**
 * A source with placeholders (`/news/:year/:slug/`), as a host matches it: each `:name` is one
 * whole segment of the path, the rest are equal, and a last `*` is whatever follows. A trailing
 * slash doesn't matter, as it doesn't for an exact path.
 */
function placeholdersMatch(from: string, p: string): boolean {
	const want = from.replace(/\/+$/, "").split("/");
	const got = p.replace(/\/+$/, "").split("/");
	for (let i = 0; i < want.length; i++) {
		const w = want[i];
		if (w === "*" && i === want.length - 1) return got.length >= i;
		if (i >= got.length) return false;
		if (w.startsWith(":") ? got[i] === "" : w !== got[i]) return false;
	}
	return want.length === got.length;
}

const HEX2 = /^[0-9a-fA-F]{2}$/;

function percentDecode(s: string): string {
	if (!s.includes("%")) return s;
	const bytes = Buffer.from(s, "utf8");
	const out: number[] = [];
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0x25 && i + 2 < bytes.length) {
			const hex = bytes.toString("latin1", i + 1, i + 3);
			if (HEX2.test(hex)) {
				out.push(Number.parseInt(hex, 16));
				i += 2;
				continue;
			}
		}
		out.push(bytes[i]);
	}
	return Buffer.from(out).toString("utf8");
}

interface Checked {
	checked: number;
	broken: Broken[];
	/** Links that work by going through a redirect: each link, where it ends up, and the pages it's on. */
	detours: Detour[];
}

interface Detour { link: string; to: string; pages: string[] }

/** Checks every HTML and XML page the build wrote. */
async function check(config: Config, output: string, written: string[], options: LinksOptions): Promise<Checked> {
	const scans: Array<[string, PageScan]> = [];
	// The scans are kept until every page is read, so each string they keep is a copy, made once
	// for the whole site: a slice of a page would keep the whole page alive, and most links are
	// the same on every page (a sidebar's).
	const kept = new Map<string, string>();
	const keep: Keep = (found) => {
		let copy = kept.get(found);
		if (copy === undefined) {
			copy = ` ${found}`.slice(1);
			kept.set(copy, copy);
		}
		return copy;
	};
	// The files are read ahead, a few at a time, so reading (on Node's thread pool) goes on while this thread scans.
	const pages = written.filter((file) => { const ext = path.extname(file); return ext === ".html" || ext === ".xml"; });
	const reading = new Map<number, Promise<string>>();
	const AHEAD = 32;
	for (let i = 0; i < pages.length; i++) {
		for (let j = i; j < Math.min(i + AHEAD, pages.length); j++) if (!reading.has(j)) reading.set(j, fs.promises.readFile(pages[j], "utf8"));
		const text = await reading.get(i)!;
		reading.delete(i);
		scans.push([pages[i], path.extname(pages[i]) === ".xml" ? { ids: new Set(), links: [], siteLinks: scanXml(text, keep), sitePaths: [] } : scanHtml(text, keep)]);
	}
	kept.clear();
	// The site's address, so absolute links to it are checked.
	const origin = (options.url === undefined ? undefined : originOf(options.url)) ?? sitemapOrigin(output);
	const ids = new Map<string, Set<string>>(scans.map(([file, scan]) => [file, scan.ids]));
	const writtenFiles = new Set(written);
	const rules = redirectRules(output, config.base);
	// Redirect pages (`redirectsPlugin()`'s, or a site's own meta refresh): where each sends a browser.
	const refreshes = new Map<string, string>();
	for (const [file, scan] of scans) if (scan.refresh !== undefined) refreshes.set(file, scan.refresh);
	const anchors = options.anchors ?? true;

	let checked = 0;
	const seen = new Set<string>();
	const broken: Broken[] = [];
	// Most links on a site point at the same few pages (every sidebar lists them), so each target is looked up on disk once.
	const found = new Map<string, string | undefined>();
	// "Did you mean": the page whose URL is nearly a missing one, looked for once.
	const urls = scans.map(([file]) => urlOf(output, file));
	let nearest: ((wanted: string) => string | undefined) | undefined;
	const meant = new Map<string, string>();
	const didYouMean = (name: string | undefined, mark: string) => (name === undefined ? "" : `; did you mean ${mark}${name}?`);
	/** Why `inside` (a link with the base off) is broken from a page, or `undefined`. */
	const reasonFor = (pageUrl: string, page: PageScan, inside: string, ignoreFragment: boolean): string | undefined => {
		const resolved = resolve(pageUrl, inside);
		if (resolved === undefined) return undefined;
		const [targetPath, anchor] = resolved;
		const fragment = ignoreFragment ? undefined : anchor;
		if (targetPath === "" && fragment === undefined) return undefined;
		if (targetPath === "") {
			// `#top`: this page.
			return anchors && !hasId(page.ids, fragment!) ? `no id "${fragment}" on this page${didYouMean(closest(fragment!, page.ids), "#")}` : undefined;
		}
		if (options.ignore.some((p) => targetPath.startsWith(p))) return undefined;
		if (!found.has(targetPath)) found.set(targetPath, find(output, targetPath, writtenFiles));
		const target = found.get(targetPath);
		// A line of `_redirects` rescues a link, unless it's a 4xx one: a catch-all `/*  /404.html
		// 404` covers every path, and a link it answers is still broken (the Squatch Snacks rerun).
		const rule = rules.length ? ruleFor(rules, targetPath, target !== undefined) : undefined;
		if (rule !== undefined && !rule.notFound) return undefined;
		if (target === undefined) {
			// A site with hundreds of dead links has a bigger problem than typos.
			if (!meant.has(targetPath) && meant.size < 500) meant.set(targetPath, didYouMean((nearest ??= closestPathFinder(urls))(targetPath), ""));
			return `not found${meant.get(targetPath) ?? ""}`;
		}
		const targetIds = ids.get(target);
		if (fragment !== undefined && targetIds !== undefined && anchors && !hasId(targetIds, fragment)) {
			return `no id "${fragment}" on that page${didYouMean(closest(fragment, targetIds), "#")}`;
		}
		return undefined;
	};
	// A link that works through a redirect, by its target: where it ends up (Squatch Snacks, E9:
	// after a move, that's the link to hear about). Only links that aren't broken get here.
	const detourOf = new Map<string, string | undefined>();
	const detours = new Map<string, Detour>();
	const detour = (pageUrl: string, inside: string, shown: string) => {
		if (!rules.length && !refreshes.size) return;
		const targetPath = resolve(pageUrl, inside)?.[0];
		if (targetPath === undefined || targetPath === "") return;
		let to = detourOf.get(targetPath);
		if (!detourOf.has(targetPath)) {
			if (!found.has(targetPath)) found.set(targetPath, find(output, targetPath, writtenFiles));
			const target = found.get(targetPath);
			const rule = options.ignore.some((p) => targetPath.startsWith(p)) ? undefined : ruleFor(rules, targetPath, target !== undefined);
			if (rule !== undefined) to = rule.notFound ? undefined : rule.to;
			else to = target === undefined ? undefined : refreshes.get(target);
			detourOf.set(targetPath, to);
		}
		if (to === undefined) return;
		// A page that links its own old address is showing it off ("this page moved; try it").
		if ((inSite(to, config.base) ?? to) === pageUrl) return;
		const key = `${shown}\0${to}`;
		let d = detours.get(key);
		if (!d) detours.set(key, (d = { link: shown, to, pages: [] }));
		if (!d.pages.includes(pageUrl)) d.pages.push(pageUrl);
	};
	// A link from the site's root with no `#fragment` leads to the same place from every page (every sidebar lists the same pages), so its answer is kept.
	const fromRoot = new Map<string, string | undefined>();
	const one = (pageUrl: string, page: PageScan, written: string, relativeOk: boolean, ignoreFragment: boolean) => {
		const onSite = origin === undefined ? undefined : stripOrigin(written, origin);
		let link: string;
		if (onSite !== undefined) link = onSite;
		else if (relativeOk) link = written;
		else if (trim(written).startsWith("/") && !trim(written).startsWith("//")) link = written;
		else return;
		checked++;
		// With a `base`, the HTML has it in front of every URL from the site's root. Other paths on the domain aren't this site's.
		const inside = inSite(link, config.base);
		if (inside === undefined) return;
		let reason: string | undefined;
		if (inside.charCodeAt(0) === 47 && inside.charCodeAt(1) !== 47 && !inside.includes("#")) {
			if (fromRoot.has(inside)) reason = fromRoot.get(inside);
			else fromRoot.set(inside, (reason = reasonFor(pageUrl, page, inside, ignoreFragment)));
		} else {
			reason = reasonFor(pageUrl, page, inside, ignoreFragment);
		}
		// Reported as the template has it: from the root without the base, or the whole address.
		const shown = onSite !== undefined ? trim(written) : inside;
		if (reason === undefined) {
			if (relativeOk) detour(pageUrl, inside, shown);
			return;
		}
		const key = `${pageUrl}\0${shown}\0${reason}`;
		if (!seen.has(key)) {
			seen.add(key);
			broken.push({ page: pageUrl, link: shown, reason });
		}
	};
	for (const [at, [, page]] of scans.entries()) {
		const pageUrl = urls[at];
		// Links in attributes as written; the others only when they're on the site; JSON-LD's without their #fragment.
		for (const l of page.links) one(pageUrl, page, l, true, false);
		for (const l of page.siteLinks) one(pageUrl, page, l, false, false);
		for (const l of page.sitePaths) one(pageUrl, page, l, false, true);
	}
	// A set of (page, link, reason) in the order of the three, each compared by its bytes.
	broken.sort((a, b) => compareText(a.page, b.page) || compareText(a.link, b.link) || compareText(a.reason, b.reason));
	const went = [...detours.values()].sort((a, b) => compareText(a.link, b.link) || compareText(a.to, b.to));
	for (const d of went) d.pages.sort(compareText);
	return { checked, broken, detours: went };
}

/** The links that go through a redirect, as a note: each link, where it ends up, and the pages it's on (the first `shown`, and three pages each). */
function describeDetours(detours: Detour[], shown: number): string {
	const n = detours.length;
	let out = `note: ${n} link${n === 1 ? " goes" : "s go"} through a redirect; linking to where ${n === 1 ? "it ends" : "they end"} up saves a hop:`;
	for (const d of detours.slice(0, shown)) out += `\n  ${d.link} -> ${d.to} (from ${d.pages.slice(0, 3).join(", ")}${d.pages.length > 3 ? `, and ${d.pages.length - 3} more` : ""})`;
	if (n > shown) out += `\n  ... and ${n - shown} more (--verbose lists them all)`;
	return `${out}\n`;
}

/** The broken links, the first `shown` of them listed (all of them with `--verbose`). */
function describe(broken: Broken[], shown: number): string {
	let out = `${voice.TRAIL_GOES_COLD} on ${broken.length} broken link${broken.length === 1 ? "" : "s"}:`;
	// One line for each link and why, with the pages it's on: a sidebar's broken link was a line
	// for every page (Squatch Snacks' log). On one page, it's the line it always was.
	const groups = new Map<string, { link: string; reason: string; pages: string[] }>();
	for (const b of broken) {
		const key = `${b.link}\0${b.reason}`;
		const g = groups.get(key);
		if (g) g.pages.push(b.page);
		else groups.set(key, { link: b.link, reason: b.reason, pages: [b.page] });
	}
	const lines = [...groups.values()];
	for (const g of lines.slice(0, shown)) {
		// Three pages each, or every page with `--verbose`.
		const from = shown === Infinity || g.pages.length <= 3 ? g.pages.join(", ") : `${g.pages.slice(0, 3).join(", ")} and ${g.pages.length - 3} more`;
		out += `\n  ${from} -> ${g.link} (${g.reason})`;
	}
	if (lines.length > shown) out += `\n  ... and ${lines.length - shown} more (--verbose lists them all)`;
	return out;
}

BUILTINS.set("ssqch/links", (config: Config, given) => {
	const o = new Options(given, ["anchors", "ignore", "fail", "url"]);
	const options: LinksOptions = { anchors: o.bool("anchors"), ignore: o.list("ignore") ?? [], fail: o.bool("fail"), url: o.string("url") };
	const bad = options.ignore.find((p) => !p.startsWith("/"));
	if (bad !== undefined) bail(`ignore: "${bad}" must be a URL path starting with / (like "/downloads/")`);
	if (options.url !== undefined && originOf(options.url) === undefined) bail(`url: "${options.url}" must be the site's address, like "https://example.com"`);

	// (links checked, broken) from the last build, for the summary.
	let counts: [number, number] | undefined;
	config.afterBuild.push({
		label: "",
		fn: async (event) => {
			const output = dirsOf(config).output;
			const result = await check(config, output, event.written as string[], options);
			counts = [result.checked, result.broken.length];
			// A note, not a warning: the link works, and a site may link an old address on purpose.
			if (result.detours.length && !config.quiet && !isCapturing()) process.stderr.write(describeDetours(result.detours, config.verbose ? Infinity : 20));
			if (result.broken.length === 0) return;
			const fail = options.fail ?? (config.env === "production" && !config.serving);
			const message = describe(result.broken, config.verbose ? Infinity : 20);
			// One for each link, for `ssqch build --format json`.
			const each = (severity: "error" | "warning"): Diagnostic[] => result.broken.map((b) => ({ ...(severity === "error" ? error : warning)("links", `${b.page} -> ${b.link} (${b.reason})`), url: b.page }));
			// Named for the plugin after the hook's words: "after_build hook failed" alone sent The North
			// Fake study looking for a hook of its own (E6). The JSON's code is `links` either way.
			if (fail) throw new Diagnostics(`linksPlugin: ${message}`, each("error"));
			if (isCapturing()) each("warning").forEach(warn);
			else if (!config.quiet) warn(warning("links", message));
		},
	});
	config.summaries.push(["Links", () => (counts === undefined ? undefined : `${count(counts[0])} checked, ${count(counts[1])} broken`)]);
});
