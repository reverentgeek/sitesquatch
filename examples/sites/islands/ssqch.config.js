import { defineConfig } from "ssqch";
import { elementsPlugin } from "ssqch/elements";
import { linksPlugin } from "ssqch/links";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig( {
	dirs: { input: "src", output: "dist" },
	templateFormats: [ "jinja", "md" ],
	// The trail camera's photos, served from /images/trail-cam/ (src/_data/trailCam.js lists them).
	passthrough: [ "images" ],

	plugins: [
		// src/elements/like-button.js loads on the pages with a <like-button>, and nowhere else.
		elementsPlugin(),
		sitemapPlugin( { url: "https://islands.sitesquatch.dev" } ),
		linksPlugin()
	]
} );
