import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "njk", "md" ],
	markdownEngine: "njk",
	markdown: { highlight: true },

	// Search: with SEARCH=1, Pagefind (https://pagefind.app) indexes the built
	// site into /pagefind/. It's its own program; npx fetches it.
	afterBuild: process.env.SEARCH ? [ { run: "npx -y pagefind --site dist" } ] : [],

	plugins: [
		sitemapPlugin( { url: "https://docs-sidebar.sitesquatch.dev" } ),
		// The search files only exist with SEARCH=1.
		linksPlugin( { ignore: [ "/pagefind/" ] } )
	]
} );
