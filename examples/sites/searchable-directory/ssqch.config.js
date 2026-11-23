import { defineConfig } from "ssqch";
import { elementsPlugin } from "ssqch/elements";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "ejs", "md" ],
	markdownEngine: "ejs",

	// Search: with SEARCH=1, Pagefind (https://pagefind.app) indexes the built
	// campground pages into /pagefind/. It's its own program; npx fetches it, at a
	// pinned version so every build gets the same one.
	afterBuild: process.env.SEARCH ? [ { run: "npx -y pagefind@1.6.0 --site dist" } ] : [],

	plugins: [
		// src/elements/campground-filter.js loads on the page with a <campground-filter>: the home page.
		elementsPlugin(),
		sitemapPlugin( { url: "https://sitesquatch.dev" } ),
		// The search files only exist with SEARCH=1.
		linksPlugin( { ignore: [ "/pagefind/" ] } )
	]
} );
