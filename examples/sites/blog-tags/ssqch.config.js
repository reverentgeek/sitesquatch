import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { redirectsPlugin } from "ssqch/redirects";
import { rssPlugin } from "ssqch/rss";
import { sitemapPlugin } from "ssqch/sitemap";

import site from "./src/_data/site.json";

// Tags that aren't topics: every post has its section's tag.
const SECTIONS = [ "blog", "inside" ];

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "njk", "md" ],
	markdownEngine: "njk",
	markdown: { highlight: true },

	filters: {
		// `2024/01/15`, for dated permalinks.
		datePath: date => date.toISOString().slice( 0, 10 ).replaceAll( "-", "/" ),
		readableDate: date => date.toLocaleDateString( "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } ),
		newestFirst: posts => [ ...posts ].reverse()
	},

	collections: {
		// Oldest first, like every collection; templates reverse it with `newestFirst`.
		posts: pages => pages.byGlob( [ "src/blog/*.md", "src/inside/*.md" ] ),
		// Every topic tag, sorted.
		tagList: pages => [ ...new Set( pages.all().flatMap( p => p.data.tags ?? [] ) ) ].filter( t => !SECTIONS.includes( t ) ).sort()
	},

	plugins: [
		rssPlugin(),
		sitemapPlugin( { url: site.url } ),
		redirectsPlugin(),
		linksPlugin()
	]
} );
