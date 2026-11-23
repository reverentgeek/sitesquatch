import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { redirectsPlugin } from "ssqch/redirects";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "njk", "md" ],
	markdownEngine: "njk",

	data: { site: { title: "Squatchernetes", description: "Squatchernetes runs your squatches in pods across nodes: the concepts, a first deploy, and a glossary of every word.", url: "https://sitesquatch.dev" } },
	collections: {
		docs: pages => pages.byGlob( "src/docs/**/*.md" ).sort( ( a, b ) => ( a.data.weight ?? 0 ) - ( b.data.weight ?? 0 ) ),
		glossary: pages => pages.byTag( "glossary" ).sort( ( a, b ) => a.data.title.localeCompare( b.data.title ) )
	},

	plugins: [
		sitemapPlugin( { url: "https://sitesquatch.dev" } ),
		// Netlify follows these; no redirect pages needed.
		redirectsPlugin( { hostFile: true } ),
		linksPlugin()
	]
} );
