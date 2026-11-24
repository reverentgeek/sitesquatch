// `ssqch/rss`: helpers for feeds. `rssPlugin()` adds them to templates as filters; the named
// exports are the same functions for a site's own code. Ported from `plugins/rss` and the module
// in `crates/ssqch/src/js/rss.js`. Dates are read and written in UTC with no `Intl`, as 0.7 did.
import { site } from "../api.ts";
import { withBaseOnce } from "../base.ts";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { shownAsUtc, toDate } from "../data.ts";
import { aliasUsed, bail } from "../diagnostics.ts";
import * as equivalents from "../equivalents.ts";
import { rewriteHtml } from "../html.ts";
import * as image from "./image.ts";
import { Options } from "./options.ts";

export function rssPlugin(_options?: unknown) {
	// It takes no options: 0.7's module ignored anything passed.
	return { name: "ssqch/rss", builtin: "ssqch/rss" };
}

/** How a value prints in a template's `{{ }}`: nothing for `null` and `undefined`, a date as ISO 8601. */
const output = (v: unknown): string => (v === undefined || v === null ? "" : v instanceof Date ? shownAsUtc(v).toISOString() : String(v));

/** A value as 0.7's error messages showed it. An invalid `Date` and `NaN` (which 0.7 took for 1970) are shown as JavaScript writes them. */
function shown(v: unknown): string {
	if (v === undefined) return "undefined";
	if (typeof v === "function") return "[Function]";
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : `Date(${v.toISOString().replace(/\.\d+Z$/, "+00:00")})`;
	if (typeof v === "number" && !Number.isFinite(v)) return String(v);
	try { return JSON.stringify(v) ?? "null"; } catch { return "null"; }
}

const two = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The newest `date` among a collection's items (`undefined` if it's empty). */
export function getNewestCollectionItemDate(items?: unknown): Date | undefined {
	let newest: Date | undefined;
	for (const item of Array.isArray(items) ? items : []) {
		const date = toDate(item === null || item === undefined ? undefined : (item as { date?: unknown }).date);
		if (date !== undefined && (newest === undefined || date.getTime() > newest.getTime())) newest = date;
	}
	return newest;
}

/** `2026-03-14T00:00:00Z` */
export function dateToRfc3339(date?: unknown): string {
	const given = toDate(date);
	if (given === undefined) bail(`dateToRfc3339: not a date: ${shown(date)}`);
	const d = shownAsUtc(given);
	return `${year(d)}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}Z`;
}

/** `Sat, 14 Mar 2026 00:00:00 +0000` */
export function dateToRfc822(date?: unknown): string {
	const given = toDate(date);
	if (given === undefined) bail(`dateToRfc822: not a date: ${shown(date)}`);
	const d = shownAsUtc(given);
	return `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${year(d)} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
}

/** The year as 0.7 (chrono's `%Y`) wrote it: four digits, with a sign before 0 and after 9999 (`-0001`, `+10000`). */
function year(d: Date): string {
	const y = d.getUTCFullYear();
	if (y < 0) return `-${String(-y).padStart(4, "0")}`;
	return y > 9999 ? `+${y}` : String(y).padStart(4, "0");
}

/**
 * `url` made absolute against `base`, as `new URL(url, base).toString()` does; a URL that can't be
 * resolved comes back unchanged. `siteBase` is the site's `base` (the filters pass it): a URL from
 * the site's root gets it first, unless it has it already, since `page.url` doesn't, and `new URL`
 * would drop a path in the address (`/posts/x/` against `https://example.com/repo/` is
 * `https://example.com/posts/x/`). Called from a site's code, it's the build's base, as the
 * template function's is: the named export dropped it, and the Squatch Snacks rerun wrote its own.
 */
export function absoluteUrl(url: unknown, base: unknown, siteBase = site.base): string {
	const text = withBaseOnce(siteBase, String(url));
	try { return new URL(text, String(base)).toString(); } catch { return text; }
}

/** `html` with `href`, `src`, `poster` and `srcset` made absolute against `base` (and `siteBase`, as `absoluteUrl` has it); everything else is as it was. */
export function htmlToAbsoluteUrls(html: unknown, base: unknown, siteBase = site.base): string {
	const baseUrl = String(base);
	return rewriteHtml(String(html ?? ""), {
		tag(el) {
			for (const attr of ["href", "src", "poster", "srcset"]) {
				const v = el.get(attr);
				if (v === undefined) continue;
				if (attr !== "srcset") { el.set(attr, absoluteUrl(v, baseUrl, siteBase)); continue; }
				const candidates = v.split(",").map((c) => {
					const candidate = c.trim();
					const space = candidate.indexOf(" ");
					return space === -1 ? absoluteUrl(candidate, baseUrl, siteBase) : `${absoluteUrl(candidate.slice(0, space), baseUrl, siteBase)} ${candidate.slice(space + 1)}`;
				});
				el.set(attr, candidates.join(", "));
			}
		},
	});
}

/** A post's HTML for a feed: one generated copy for each local image, and every URL absolute. */
export function feedHtml(html?: unknown, base?: unknown, options?: unknown, siteBase = site.base): string | Promise<string> {
	const feedImages = (image as { feedImages?: (html: string, base: string, options: unknown) => string | Promise<string> }).feedImages;
	if (typeof feedImages !== "function") bail("feedHtml() isn't in the Node build of ssqch yet (the move to Node, stage 5)");
	const source = html === undefined || html === null ? "" : String(html);
	const done = feedImages(source, String(base), options);
	return typeof done === "string" ? htmlToAbsoluteUrls(done, base, siteBase) : done.then((h) => htmlToAbsoluteUrls(h, base, siteBase));
}

BUILTINS.set("ssqch/rss", (config: Config, options) => {
	new Options(options, []);
	const filters = config.filters;
	filters.set("getNewestCollectionItemDate", (items?: unknown) => getNewestCollectionItemDate(items));
	filters.set("dateToRfc3339", (date?: unknown) => dateToRfc3339(date));
	filters.set("dateToRfc822", (date?: unknown) => dateToRfc822(date));
	// The Eleventy RSS plugin's first names, which its sample feed and many sites' feeds still use:
	// aliases (src/equivalents.ts), which work and say ssqch's names once.
	const rssDate = equivalents.find("rssDate", "filter")!;
	const rssLastUpdatedDate = equivalents.find("rssLastUpdatedDate", "filter")!;
	filters.set("rssDate", (date?: unknown) => { aliasUsed(rssDate); return dateToRfc3339(date); });
	filters.set("rssLastUpdatedDate", (items?: unknown) => { aliasUsed(rssLastUpdatedDate); return dateToRfc3339(getNewestCollectionItemDate(items)); });
	// As filters, they know the site's `base` (absoluteUrl, which every site has: src/filters.ts).
	filters.set("htmlToAbsoluteUrls", (html?: unknown, base?: unknown) => htmlToAbsoluteUrls(output(html), output(base), config.base));
	// Template engines name the function in front of its errors already.
	const unprefixed = (e: unknown) => {
		if (e instanceof Error && e.message.startsWith("feedHtml(): ")) e.message = e.message.slice("feedHtml(): ".length);
		return e;
	};
	filters.set("feedHtml", (html?: unknown, base?: unknown, options?: unknown) => {
		try {
			const done = feedHtml(html, base, options, config.base);
			return typeof done === "string" ? done : done.catch((e) => { throw unprefixed(e); });
		} catch (e) { throw unprefixed(e); }
	});
});

// ---- feedPlugin(): the feed itself -------------------------------------------------------------

/**
 * `feedPlugin({ url })`: writes the site's feed, Atom (or RSS), from a collection: the newest
 * posts first, each with its title, address, date, description and its content as a feed needs it
 * (`feedHtml`: pictures as one generated copy each, every URL absolute). A new blog needed a
 * template for it in each template language (the new-blog fresh run wrote one from memory); this
 * is that template, as an option.
 */
export function feedPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/feed", builtin: "ssqch/feed", options };
}

/** Text for XML: `&`, `<`, `>` and `"` escaped. */
const xml = (text: unknown) => output(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

BUILTINS.set("ssqch/feed", (config: Config, given) => {
	// Eleventy's RSS plugin (v2) has a `feedPlugin` too, with other options: a config moved from it
	// passes those, so each is named with ssqch's.
	if (given !== null && typeof given === "object") {
		const g = given as Record<string, unknown>;
		if (["type", "outputPath", "metadata"].some((k) => k in g) || (g.collection !== null && typeof g.collection === "object")) {
			bail("these are the options of Eleventy's feedPlugin, which ssqch's names differently: `type` is `format` (\"atom\" or \"rss\"), `outputPath` is `output`, `collection: { name, limit }` is `collection` and `limit`, and `metadata`'s `base`, `title`, `subtitle` and `author` are `url`, `title`, `description` and `author`. Like feedPlugin({ url: \"https://example.com\", collection: \"posts\", limit: 10 })");
		}
	}
	const o = new Options(given, ["url", "collection", "limit", "format", "output", "title", "description", "author"]);
	const url = o.string("url");
	if (url === undefined || url === "") bail("needs the site's address, like feedPlugin({ url: \"https://example.com\" }): a feed's links are whole addresses, which feed readers need");
	if (!(url.startsWith("https://") || url.startsWith("http://"))) bail(`url must be the site's address, like "https://example.com" (got ${JSON.stringify(url)})`);
	const collection = o.string("collection") ?? "posts";
	const limit = o.number("limit") ?? 20;
	if (!Number.isInteger(limit) || limit < 0) bail(`limit must be a whole number of entries, like 20, or 0 for all of them (got ${JSON.stringify(o.get("limit"))})`);
	const format = o.string("format") ?? "atom";
	if (format !== "atom" && format !== "rss") bail(`format must be "atom" or "rss" (got ${JSON.stringify(format)})`);
	const out = o.string("output") ?? "/feed.xml";
	if (!out.startsWith("/") || out.endsWith("/")) bail(`output must be a URL path to a file, like "/feed.xml" (got ${JSON.stringify(out)})`);
	const author = o.get("author");
	if (author !== undefined && typeof author !== "string" && !(author !== null && typeof author === "object" && typeof (author as { name?: unknown }).name === "string")) bail(`author must be a name, or { name, email, url } (got ${JSON.stringify(author)})`);
	const titleGiven = o.string("title");
	const descriptionGiven = o.string("description");
	// Each entry is a post's rendered body: kept from its render, since one that awaits something
	// (an async filter) can't render again on demand once the pages are written.
	config.readsContent = true;

	config.generators.push(["ssqch/feed", async (config, _pages, site) => {
		const items = site.collection(collection);
		if (!items) bail(`there's no collection \`${collection}\` to make the feed from (the collections are ${site.collectionNames().map((n) => `\`${n}\``).join(", ")}): name one with feedPlugin({ collection: "posts" }), a tag the posts have`);
		const data = (site.global.site ?? {}) as Record<string, unknown>;
		const title = titleGiven ?? (typeof data.title === "string" ? data.title : undefined);
		if (!title) bail("needs the feed's title: feedPlugin({ title: \"Field Notes\" }), or `title` in the site's data (src/_data/site.json)");
		const description = descriptionGiven ?? (typeof data.description === "string" ? data.description : undefined);
		const name = typeof author === "string" ? author : (author as { name?: string } | undefined)?.name ?? title;
		const email = typeof author === "object" && author !== null ? (author as { email?: unknown }).email : undefined;
		const home = absoluteUrl("/", url, config.base);
		const self = absoluteUrl(out, url, config.base);
		// A page in the collection, with an address: one with `permalink: false` has none, and isn't
		// in a feed (`https://example.com/false`, as the `url` alias once printed in a sitemap).
		if (items.some((item) => item === null || typeof item !== "object" || !("url" in item) || !("date" in item))) bail(`the collection \`${collection}\` has items that aren't pages (no \`url\` or \`date\`): a feed's entries are pages, like a tag's (\`posts\`)`);
		const pages = items.filter((item) => typeof item.url === "string" && toDate(item.date) !== undefined);
		// Newest first, by date, whatever order the collection is in (the starter's `newestPosts` is
		// newest first already); pages with the same date keep the collection's order.
		const newest = pages.map((item, i) => ({ item, i, date: toDate(item.date)! })).sort((a, b) => b.date.getTime() - a.date.getTime() || a.i - b.i).map((e) => e.item).slice(0, limit === 0 ? undefined : limit);
		const entries: Array<{ title: string; link: string; date: Date; summary?: string; content: string }> = [];
		for (const item of newest) {
			const link = absoluteUrl(output(item.url), url, config.base);
			const itemData = (item.data ?? {}) as Record<string, unknown>;
			const content = await feedHtml(item.templateContent ?? "", link, undefined, config.base);
			entries.push({ title: output(itemData.title) || link, link, date: toDate(item.date) ?? new Date(0), summary: typeof itemData.description === "string" ? itemData.description : undefined, content });
		}
		// The pictures the entries point at, made before the feed is out (the pages' own were made
		// before the generators ran).
		await image.settleImages();
		const updated = entries.reduce<Date | undefined>((latest, e) => (latest === undefined || e.date > latest ? e.date : latest), undefined) ?? new Date(0);
		let feed: string;
		if (format === "atom") {
			feed = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>${xml(title)}</title>\n${description ? `  <subtitle>${xml(description)}</subtitle>\n` : ""}  <link href="${xml(self)}" rel="self"/>\n  <link href="${xml(home)}"/>\n  <id>${xml(home)}</id>\n  <updated>${dateToRfc3339(updated)}</updated>\n  <author><name>${xml(name)}</name>${typeof email === "string" ? `<email>${xml(email)}</email>` : ""}</author>\n`;
			for (const e of entries) feed += `  <entry>\n    <title>${xml(e.title)}</title>\n    <link href="${xml(e.link)}"/>\n    <id>${xml(e.link)}</id>\n    <updated>${dateToRfc3339(e.date)}</updated>\n${e.summary ? `    <summary>${xml(e.summary)}</summary>\n` : ""}    <content type="html">${xml(e.content)}</content>\n  </entry>\n`;
			feed += "</feed>\n";
		} else {
			feed = `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>${xml(title)}</title>\n    <link>${xml(home)}</link>\n    <atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>\n    <description>${xml(description ?? title)}</description>\n    <lastBuildDate>${dateToRfc822(updated)}</lastBuildDate>\n`;
			for (const e of entries) feed += `    <item>\n      <title>${xml(e.title)}</title>\n      <link>${xml(e.link)}</link>\n      <guid>${xml(e.link)}</guid>\n      <pubDate>${dateToRfc822(e.date)}</pubDate>\n      <description>${xml(e.content)}</description>\n    </item>\n`;
			feed += "  </channel>\n</rss>\n";
		}
		return [{ path: out, contents: feed }];
	}]);
});
