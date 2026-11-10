import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

import versions from "./src/_data/versions.json";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "jinja", "md" ],
	markdown: { highlight: true },

	filters: {
		// The same page in another version: `/docs/1.0/install/` for `/docs/next/install/` and "1.0",
		// if that version has it, else the version's first page.
		inVersion( url, version, pages ) {
			const current = versions.find( v => url.startsWith( `/docs/${ v.name }/` ) );
			const target = current ? url.replace( `/docs/${ current.name }/`, `/docs/${ version }/` ) : null;
			return target && pages.some( p => p.url === target ) ? target : `/docs/${ version }/`;
		}
	},

	collections: {
		posts: pages => pages.byGlob( "src/blog/*.md" ).reverse()
	},

	plugins: [ sitemapPlugin( { url: "https://versioned-docs.sitesquatch.dev" } ), linksPlugin() ]
} );
