// `ssqch/sitemap`: sitemap.xml from the pages the build writes.
//
//   import { sitemapPlugin } from "ssqch/sitemap";
//
//   export default defineConfig({ plugins: [sitemapPlugin({ url: "https://example.com" })] });
//
// Lists every HTML page with its absolute URL and its date as <lastmod>.
// Left out: pages with `sitemap: false` in their data, 404 pages, pages after
// the first of a list split into pages, and URLs matching `exclude` globs.
// Options: `url` (required), `exclude`, `lastmod` (default true), `output`
// (default "/sitemap.xml") and `paginated` (default false).
export function sitemapPlugin( options = {} ) {
	return { name: "ssqch/sitemap", builtin: "ssqch/sitemap", options };
}
