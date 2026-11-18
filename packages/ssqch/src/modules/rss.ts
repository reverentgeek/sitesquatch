// `ssqch/rss`: helpers for feeds. `rssPlugin()` adds them to templates as filters; the named
// exports are the same functions for a site's own code. Ported from `plugins/rss` and the module
// in `crates/ssqch/src/js/rss.js`. Dates are read and written in UTC with no `Intl`, as 0.7 did.
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { toDate } from "../data.ts";
import { bail } from "../diagnostics.ts";
import { rewriteHtml } from "../html.ts";
import * as image from "./image.ts";
import { Options } from "./options.ts";

export function rssPlugin(_options?: unknown) {
	// It takes no options: 0.7's module ignored anything passed.
	return { name: "ssqch/rss", builtin: "ssqch/rss" };
}

/** How a value prints in a template's `{{ }}`: nothing for `null` and `undefined`, a date as ISO 8601. */
const output = (v: unknown): string => (v === undefined || v === null ? "" : v instanceof Date ? v.toISOString() : String(v));

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
	const d = toDate(date);
	if (d === undefined) bail(`dateToRfc3339: not a date: ${shown(date)}`);
	return `${year(d)}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}Z`;
}

/** `Sat, 14 Mar 2026 00:00:00 +0000` */
export function dateToRfc822(date?: unknown): string {
	const d = toDate(date);
	if (d === undefined) bail(`dateToRfc822: not a date: ${shown(date)}`);
	return `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${year(d)} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} +0000`;
}

/** The year as 0.7 (chrono's `%Y`) wrote it: four digits, with a sign before 0 and after 9999 (`-0001`, `+10000`). */
function year(d: Date): string {
	const y = d.getUTCFullYear();
	if (y < 0) return `-${String(-y).padStart(4, "0")}`;
	return y > 9999 ? `+${y}` : String(y).padStart(4, "0");
}

/** `url` made absolute against `base`, as `new URL(url, base).toString()` does; a URL that can't be resolved comes back unchanged. */
export function absoluteUrl(url: unknown, base: unknown): string {
	const text = String(url);
	try { return new URL(text, String(base)).toString(); } catch { return text; }
}

/** `html` with `href`, `src`, `poster` and `srcset` made absolute against `base`; everything else is as it was. */
export function htmlToAbsoluteUrls(html: unknown, base: unknown): string {
	const baseUrl = String(base);
	return rewriteHtml(String(html ?? ""), {
		tag(el) {
			for (const attr of ["href", "src", "poster", "srcset"]) {
				const v = el.get(attr);
				if (v === undefined) continue;
				if (attr !== "srcset") { el.set(attr, absoluteUrl(v, baseUrl)); continue; }
				const candidates = v.split(",").map((c) => {
					const candidate = c.trim();
					const space = candidate.indexOf(" ");
					return space === -1 ? absoluteUrl(candidate, baseUrl) : `${absoluteUrl(candidate.slice(0, space), baseUrl)} ${candidate.slice(space + 1)}`;
				});
				el.set(attr, candidates.join(", "));
			}
		},
	});
}

/** A post's HTML for a feed: one generated copy for each local image, and every URL absolute. */
export function feedHtml(html?: unknown, base?: unknown, options?: unknown): string | Promise<string> {
	const feedImages = (image as { feedImages?: (html: string, base: string, options: unknown) => string | Promise<string> }).feedImages;
	if (typeof feedImages !== "function") bail("feedHtml() isn't in the Node build of ssqch yet (the move to Node, stage 5)");
	const source = html === undefined || html === null ? "" : String(html);
	const done = feedImages(source, String(base), options);
	return typeof done === "string" ? htmlToAbsoluteUrls(done, base) : done.then((h) => htmlToAbsoluteUrls(h, base));
}

BUILTINS.set("ssqch/rss", (config: Config, options) => {
	new Options(options, []);
	const filters = config.filters;
	filters.set("getNewestCollectionItemDate", (items?: unknown) => getNewestCollectionItemDate(items));
	filters.set("dateToRfc3339", (date?: unknown) => dateToRfc3339(date));
	filters.set("dateToRfc822", (date?: unknown) => dateToRfc822(date));
	filters.set("absoluteUrl", (url?: unknown, base?: unknown) => absoluteUrl(output(url), output(base)));
	filters.set("htmlToAbsoluteUrls", (html?: unknown, base?: unknown) => htmlToAbsoluteUrls(output(html), output(base)));
	// Template engines name the function in front of its errors already.
	const unprefixed = (e: unknown) => {
		if (e instanceof Error && e.message.startsWith("feedHtml(): ")) e.message = e.message.slice("feedHtml(): ".length);
		return e;
	};
	filters.set("feedHtml", (html?: unknown, base?: unknown, options?: unknown) => {
		try {
			const done = feedHtml(html, base, options);
			return typeof done === "string" ? done : done.catch((e) => { throw unprefixed(e); });
		} catch (e) { throw unprefixed(e); }
	});
});
