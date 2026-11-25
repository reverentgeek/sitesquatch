import fs from "node:fs";
import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "njk", "md" ],
	markdownEngine: "njk",
	markdown: { highlight: true },

	// Search: with SEARCH=1, Pagefind (https://pagefind.app) indexes the built
	// site into /pagefind/. It's its own program; npx fetches it, at a pinned
	// version so every build gets the same one.
	// The last index first: Pagefind names its files by their contents, so they'd pile up.
	afterBuild: process.env.SEARCH ? [ ({ dirs }) => fs.rmSync(`${dirs.output}pagefind`, { recursive: true, force: true }), { run: "npx -y pagefind@1.6.0 --site dist" } ] : [],

	plugins: [
		sitemapPlugin( { url: "https://sitesquatch.dev" } ),
		// The search files only exist with SEARCH=1.
		linksPlugin( { ignore: [ "/pagefind/" ] } )
	]
} );
