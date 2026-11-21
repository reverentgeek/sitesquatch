// A Jekyll site, laid out as Jekyll lays one out, built by ssqch with Jekyll's habits turned on.
import { defineConfig, readData } from "ssqch";
import { fromJekyll } from "ssqch/from-jekyll";
import { linksPlugin } from "ssqch/links";
import { redirectsPlugin } from "ssqch/redirects";

// `site.title` and the other keys of _config.yml, as Jekyll's templates read them.
const site = readData("_config.yml");

export default defineConfig({
	dirs: { output: "dist", layouts: "_layouts" },
	// Markdown and HTML pages run through Liquid first, as in Jekyll.
	templateFormats: ["liquid", "md", "html"],
	markdownEngine: "liquid",
	htmlEngine: "liquid",
	ignore: ["README.md"],
	passthrough: ["assets"],
	data: { site },
	plugins: [
		// Jekyll's `page` and `site` in templates (`page.title`, `site.posts`, `site.guides`), and
		// kramdown's habits: `markdown="1"`, its heading ids, smart quotes, no bare-URL links.
		fromJekyll(),
		redirectsPlugin(),
		linksPlugin(),
	],
});
