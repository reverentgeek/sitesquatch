// `ssqch/sitemap`: after the pages are written, `sitemap.xml` lists every HTML page with its
// absolute URL and, by default, its date as `<lastmod>`. Left out: pages with `sitemap: false`
// in their data, 404 pages (`/404.html`, `/404/`), pages after the first of a list split into
// pages (unless `paginated`), and URLs matching an `exclude` glob (`/drafts/**`). Ported from
// `plugins/sitemap`.
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
	const o = new Options(given, ["url", "exclude", "lastmod", "output", "paginated"]);
	const url = o.string("url");
	if (url === undefined) bail("url is required: the site's address, like \"https://example.com\"");
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

	config.generators.push(["ssqch/sitemap", (config, pages) => {
		// With a `base` of `/repo`, `url` can be the domain or include the base.
		const trimmed = url.replace(/\/+$/, "");
		const withBase = trimmed.endsWith(config.base) ? trimmed : trimmed + config.base;
		const entries: Array<[string, string]> = [];
		for (const p of pages) {
			if (path.extname(p.outputPath) !== ".html") continue;
			if (p.data.sitemap === false) continue;
			if (!paginated && isLaterPage(p.data)) continue;
			if (p.url === "/404.html" || p.url === "/404/") continue;
			if (excluded(p.url)) continue;
			// `page.lastModified` (with the `lastModified` setting), else the page's date.
			entries.push([p.url, isoDay(toDate(p.data.page?.lastModified) ?? p.date)]);
		}
		entries.sort((a, b) => compareText(a[0], b[0]) || compareText(a[1], b[1]));
		const loc = escapeHtml(withBase);
		let xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
		for (const [pageUrl, date] of entries) {
			xml += `  <url>\n    <loc>${loc}${escapeHtml(pageUrl)}</loc>\n`;
			if (lastmod) xml += `    <lastmod>${date}</lastmod>\n`;
			xml += "  </url>\n";
		}
		xml += "</urlset>\n";
		return [{ path: output, contents: xml }];
	}]);
});
