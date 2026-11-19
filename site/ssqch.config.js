// sitesquatch.dev, built with the ssqch in this repository (packages/ssqch), so a change to ssqch
// that breaks its own site shows up here first. `node build.ts` builds it for production and
// fails on any warning; `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it.
import { defineConfig } from "ssqch";
import { assetsPlugin } from "ssqch/assets";
import { linksPlugin } from "ssqch/links";
import { minifyPlugin } from "ssqch/minify";
import { sitemapPlugin } from "ssqch/sitemap";

export default defineConfig(({ env }) => ({
	dirs: { input: "src", output: "dist" },
	templateFormats: ["jinja", "md"],
	passthrough: [
		{ "src/assets": "assets" },
		{ "src/favicon.svg": "favicon.svg" },
		{ "src/robots.txt": "robots.txt" },
		// The drawings have one home, docs/assets/, beside the README that floats them.
		{ "../docs/assets/stickers": "assets/drawings/stickers" },
		{ "../docs/assets/sitesquatch.svg": "assets/drawings/sitesquatch.svg" },
		{ "../docs/assets/footprint.svg": "assets/drawings/footprint.svg" },
	],

	// The site's promise is that a page gets no script it doesn't need. build.ts fails on any
	// warning, so going over one of these fails the build.
	budgets: { pages: "60 KB", css: "30 KB", javascript: "2 KB", fonts: "30 KB", images: "100 KB" },

	plugins: [
		linksPlugin(),
		sitemapPlugin({ url: "https://sitesquatch.dev", lastmod: false }),
		assetsPlugin({ files: ["/assets/site.css", "/assets/theme.js"] }),
		env === "production" && minifyPlugin(),
	],
}));
