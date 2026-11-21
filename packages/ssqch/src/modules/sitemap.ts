// `ssqch/sitemap`: after the pages are written, `sitemap.xml` lists every HTML page with its
// absolute URL and, by default, its date as `<lastmod>`. Left out: pages with `sitemap: false`
// in their data, 404 pages (`/404.html`, `/404/`), pages after the first of a list split into
// pages (unless `paginated`), and URLs matching an `exclude` glob (`/drafts/**`). Ported from
// `plugins/sitemap`. `alternates` (a page's translations, as hreflang links) is 0.8's: ssqch has
// no languages of its own yet, so the site says what each page's are.
import path from "node:path";
import { BUILTINS } from "../config.ts";
import type { Config, PageSummary } from "../config.ts";
import { toDate } from "../data.ts";
import { bail } from "../diagnostics.ts";
import { globSet } from "../glob.ts";
import { compareText } from "../paths.ts";
import { Options } from "./options.ts";
import { debugString, escapeHtml, isoDay } from "./plugin-util.ts";

export function sitemapPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/sitemap", builtin: "ssqch/sitemap", options };
}

/** Page 2 and on of a list split into pages (`pagination.size` over 1). With a size of 1, each page is its own item (a tag's page), so it counts. */
function isLaterPage(data: PageSummary["data"]): boolean {
	const p = data.pagination;
	const number = typeof p?.pageNumber === "number" ? p.pageNumber : 0;
	const size = typeof p?.size === "number" ? p.size : 1;
	return number > 0 && size > 1;
}

BUILTINS.set("ssqch/sitemap", (config: Config, given) => {
	// `format: "vitepress"` wrote VitePress's bytes for a move to compare against. No reader of a
	// sitemap needs them: the URLs are the same, and the file is ssqch's.
	if (given !== null && typeof given === "object" && Object.hasOwn(given, "format")) bail("`format` is gone: the sitemap is ssqch's own, with the same URLs as any other generator's. Leave it out (`ssqch diff` lists sitemap.xml as changed, and that's expected)");
	const o = new Options(given, ["url", "exclude", "lastmod", "output", "paginated", "alternates"]);
	const alternates = o.get("alternates");
	if (alternates !== undefined && typeof alternates !== "function") bail(`alternates must be a function that gets each page and returns its translations, like (page) => [{ hreflang: "fr", href: "/fr/" }] (got ${typeof alternates})`);
	// A sitemap of paths from the root (jekyll-sitemap's, without a `url`) is one search engines
	// can't read, so the address is required rather than warned about on every build.
	const url = o.string("url");
	if (url === undefined || url === "") bail("needs the site's address, like sitemapPlugin({ url: \"https://example.com\" }): a sitemap lists whole addresses, and search engines read only those");
	const exclude = o.list("exclude") ?? [];
	const lastmod = o.bool("lastmod") ?? true;
	const output = o.string("output") ?? "/sitemap.xml";
	const paginated = o.bool("paginated") ?? false;

	if (!(url.startsWith("https://") || url.startsWith("http://"))) bail(`url must be the site's address, like "https://example.com" (got ${debugString(url)})`);
	if (!output.startsWith("/") || output.endsWith("/")) bail(`output must be a URL path to a file, like "/sitemap.xml" (got ${debugString(output)})`);
	const matchers = exclude.map((glob) => {
		if (!glob.startsWith("/")) bail(`exclude: ${debugString(glob)} must be a URL path or glob starting with /, like "/tags/**"`);
		return globSet("exclude", [glob]);
	});
	const excluded = (url: string) => matchers.some((m) => m(url));

	// robots.txt's `Sitemap:` line (robotsPlugin()): the same address the `<loc>`s start with.
	config.sitemap = () => {
		const trimmed = url.replace(/\/+$/, "");
		return `${trimmed.endsWith(config.base) ? trimmed : trimmed + config.base}${output}`;
	};
	config.generators.push(["ssqch/sitemap", (config, pages) => {
		// With a `base` of `/repo`, `url` can be the domain or include the base.
		const trimmed = url.replace(/\/+$/, "");
		const withBase = trimmed.endsWith(config.base) ? trimmed : trimmed + config.base;
		const entries: Array<[string, string, Array<[string, string]>]> = [];
		// A translation's `href` from the site's root gets the address and `base`, as `loc` does.
		const absolute = (href: string) => (href.startsWith("/") ? withBase + href : href);
		const linksOf = (p: PageSummary): Array<[string, string]> => {
			if (!alternates) return [];
			let out: unknown;
			try { out = (alternates as (page: PageSummary) => unknown)(p); } catch (e) { bail(`alternates(), for ${p.url}: ${e instanceof Error ? e.message : String(e)}`); }
			if (out === undefined || out === null) return [];
			if (out instanceof Promise) bail("alternates() answered with a promise; it has to answer at once (work the translations out in data or a collection first)");
			if (!Array.isArray(out)) bail(`alternates(), for ${p.url}: expected a list of { hreflang, href } (got ${typeof out})`);
			return out.map((a) => {
				const { hreflang, href } = (a ?? {}) as { hreflang?: unknown; href?: unknown };
				if (typeof hreflang !== "string" || hreflang === "" || typeof href !== "string" || !(href.startsWith("/") || /^https?:\/\//.test(href))) bail(`alternates(), for ${p.url}: each one is { hreflang: "fr", href: "/fr/page/" } (an href from the site's root, or a whole address), got ${JSON.stringify(a) ?? String(a)}`);
				return [hreflang, absolute(href)] as [string, string];
			});
		};
		for (const p of pages) {
			if (path.extname(p.outputPath) !== ".html") continue;
			if (p.data.sitemap === false) continue;
			if (!paginated && isLaterPage(p.data)) continue;
			if (p.url === "/404.html" || p.url === "/404/") continue;
			if (excluded(p.url)) continue;
			// `page.lastModified` (with the `lastModified` setting), else the page's date.
			entries.push([p.url, isoDay(toDate(p.data.page?.lastModified) ?? p.date), linksOf(p)]);
		}
		entries.sort((a, b) => compareText(a[0], b[0]) || compareText(a[1], b[1]));
		const loc = escapeHtml(withBase);
		// The xhtml namespace only when there are alternates, so a sitemap without them is as it was.
		const xhtml = entries.some((e) => e[2].length) ? " xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"" : "";
		let xml = `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtml}>\n`;
		for (const [pageUrl, date, links] of entries) {
			xml += `  <url>\n    <loc>${loc}${escapeHtml(pageUrl)}</loc>\n`;
			for (const [hreflang, href] of links) xml += `    <xhtml:link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(href)}"/>\n`;
			if (lastmod) xml += `    <lastmod>${date}</lastmod>\n`;
			xml += "  </url>\n";
		}
		xml += "</urlset>\n";
		return [{ path: output, contents: xml }];
	}]);
});
