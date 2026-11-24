import { defineConfig, readData, safe } from "ssqch";
import { assetsPlugin } from "ssqch/assets";
import { elementsPlugin } from "ssqch/elements";
import { image, imagePlugin } from "ssqch/image";
import { linksPlugin } from "ssqch/links";
import { llmsPlugin } from "ssqch/llms";
import { minifyPlugin } from "ssqch/minify";
import { robotsPlugin } from "ssqch/robots";
import { sitemapPlugin } from "ssqch/sitemap";

const { url } = readData("src/_data/site.json");

export default defineConfig(({ env }) => ({
	dirs: { input: "src", output: "dist" },
	templateFormats: ["jinja", "md"],
	// Printing a value a page doesn't have is an error that names it, not an empty space.
	strict: true,
	// "Last changed" on the privacy policy and the terms: the last commit to the page's file.
	lastModified: "git",
	passthrough: ["src/favicon.svg", { "src/assets": "assets" }],

	schemas: {
		// Every snack page needs its snack's price and picture. snack.jinja tags the six pages it
		// makes `snack` (addAllPagesToCollections), so a snack without a price fails the build and
		// the error names it.
		snack: { fields: { snack: { name: "string", slug: "string", price: "number", image: "file", imageAlt: "string" } } },
		// Job openings, src/careers/jobs/*.md: `ssqch new careers/jobs --title "Trail Cook"` starts
		// one from src/_blueprints/careers/jobs.md.
		jobs: {
			fields: {
				title: "string",
				date: "date",
				team: "string",
				location: "string",
				type: "'Full time' | 'Part time' | 'Seasonal'",
				picture: "file",
				pictureAlt: "string",
				summary: "string"
			},
			unknown: "error"
		}
	},

	filters: {
		// $6.5 is "$6.50", and whole dollars stay whole ("$12").
		money: n => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`),
		// Another crop of a picture for phones: <source>s in every format, at two widths. The image
		// plugin adds the <img>'s own formats after them.
		//   <picture>{{ "src/img/hero-tall.jpg" | crop("(max-width: 40rem)", "100vw") }}<img ...></picture>
		crop: async (src, media, sizes) => {
			const files = await image(src, { widths: [300, 600], formats: ["avif", "webp", "jpeg"] });
			return safe(Object.values(files).map(copies => `<source media="${media}" type="${copies[0].sourceType}" srcset="${copies.map(c => c.srcset).join(", ")}" sizes="${sizes}">`).join(""));
		}
	},

	plugins: [
		// src/elements/price-toggle.js loads on the pricing page, the one page with a <price-toggle>.
		elementsPlugin(),
		imagePlugin({ formats: ["avif", "webp", "auto"], widths: [400, 800, 1600] }),
		sitemapPlugin({ url }),
		robotsPlugin({ ai: { training: false, search: true, fetch: true } }),
		llmsPlugin({
			url,
			description: "Trail snacks made in Pine Cone Gap, West Virginia, sold by the bag and by monthly or yearly subscription.",
			details: "Each snack has a page under /provisions/ with its price, weight and ingredients. The subscriptions (Day Hike, Overnight, Thru-Hike) and their monthly and yearly prices are on /pricing/. Prices are in US dollars."
		}),
		env === "production" && minifyPlugin(),
		// After elementsPlugin(), so the pricing page's <script> is written before the file is renamed.
		assetsPlugin({ files: ["/assets/site.css", "/elements/price-toggle.js", "/elements/price-toggle.css"] }),
		linksPlugin()
	]
}));
