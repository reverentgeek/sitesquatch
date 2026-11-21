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
import { bail, warn, warning } from "../diagnostics.ts";
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
	const o = new Options(given, ["url", "exclude", "lastmod", "output", "paginated", "alternates", "format"]);
	// `"vitepress"`: the sitemap VitePress writes (its `sitemap` option, through the sitemap
	// package), so a move compares byte for byte: one line, its five namespaces, the pages in the
	// order of their files, and no `<lastmod>` unless it's asked for.
	const format = o.string("format") ?? "ssqch";
	if (format !== "ssqch" && format !== "vitepress") bail(`format must be "ssqch" or "vitepress" (got ${debugString(format)})`);
	const alternates = o.get("alternates");
	if (alternates !== undefined && typeof alternates !== "function") bail(`alternates must be a function that gets each page and returns its translations, like (page) => [{ hreflang: "fr", href: "/fr/" }] (got ${typeof alternates})`);
	// Without an address (`url: site.url`, which a Jekyll site's `_config.yml` leaves empty), the
	// `<loc>`s are paths from the site's root, as jekyll-sitemap writes them; search engines want
	// the whole address, so it says so on each build.
	const url = o.string("url") || undefined;
	const exclude = o.list("exclude") ?? [];
	const lastmod = o.bool("lastmod") ?? format === "ssqch";
	const output = o.string("output") ?? "/sitemap.xml";
	const paginated = o.bool("paginated") ?? false;

	if (url !== undefined && !(url.startsWith("https://") || url.startsWith("http://"))) bail(`url must be the site's address, like "https://example.com" (got ${debugString(url)})`);
	if (!output.startsWith("/") || output.endsWith("/")) bail(`output must be a URL path to a file, like "/sitemap.xml" (got ${debugString(output)})`);
	const matchers = exclude.map((glob) => {
		if (!glob.startsWith("/")) bail(`exclude: ${debugString(glob)} must be a URL path or glob starting with /, like "/tags/**"`);
		return globSet("exclude", [glob]);
	});
	const excluded = (url: string) => matchers.some((m) => m(url));

	config.generators.push(["ssqch/sitemap", (config, pages) => {
		// With a `base` of `/repo`, `url` can be the domain or include the base.
		if (url === undefined) warn(warning("config", `sitemapPlugin() has no url, so ${output}'s <loc>s are paths from the site's root (as jekyll-sitemap writes them without one), and search engines read only whole addresses: give it the site's address, like { url: "https://example.com" }`));
		const trimmed = (url ?? "").replace(/\/+$/, "");
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
		if (format === "vitepress") {
			const file = (u: string) => (u.endsWith("/") ? `${u}index.html` : u);
			entries.sort((a, b) => compareText(file(a[0]), file(b[0])));
			let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" xmlns:news=\"http://www.google.com/schemas/sitemap-news/0.9\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\" xmlns:image=\"http://www.google.com/schemas/sitemap-image/1.1\" xmlns:video=\"http://www.google.com/schemas/sitemap-video/1.1\">";
			for (const [pageUrl, date, links] of entries) {
				xml += `<url><loc>${loc}${escapeHtml(pageUrl)}</loc>`;
				if (lastmod) xml += `<lastmod>${date}</lastmod>`;
				for (const [hreflang, href] of links) xml += `<xhtml:link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(href)}"/>`;
				xml += "</url>";
			}
			return [{ path: output, contents: `${xml}</urlset>` }];
		}
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
