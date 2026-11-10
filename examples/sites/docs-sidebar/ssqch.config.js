import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

// The pages in `nav` (from _data/nav.yml) in reading order.
const flatten = nav => nav.flatMap( section => section.pages );

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "njk", "md" ],
	markdownEngine: "njk",
	markdown: { highlight: true },

	filters: {
		// The pages before and after `url`: { previous, next }.
		navPager( nav, url ) {
			const pages = flatten( nav );
			const i = pages.findIndex( p => p.url === url );
			return { previous: i > 0 ? pages[i - 1] : null, next: i >= 0 && i < pages.length - 1 ? pages[i + 1] : null };
		}
	},

	plugins: [ sitemapPlugin( { url: "https://docs-sidebar.sitesquatch.dev" } ), linksPlugin() ]
} );
