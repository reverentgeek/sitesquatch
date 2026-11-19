// sitesquatch.dev, built with the ssqch in this repository (packages/ssqch), so a change to ssqch
// that breaks its own site shows up here first. `node build.ts` builds it for production and
// fails on any warning; `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it.
import { defineConfig } from "ssqch";
import { assetsPlugin } from "ssqch/assets";
import { elementsPlugin } from "ssqch/elements";
import { linksPlugin } from "ssqch/links";
import { minifyPlugin } from "ssqch/minify";
import { rssPlugin } from "ssqch/rss";
import { sitemapPlugin } from "ssqch/sitemap";
import { copyOf, writeAgentCopies } from "./lib/agents.ts";
import { docsHref } from "./lib/docs.ts";

/** "0.9.0" as a number that sorts: 9000. */
const version = (v) => String(v).split(".").reduce((n, part) => n * 1000 + Number(part), 0);

export default defineConfig(({ env }) => ({
	dirs: { input: "src", output: "dist" },
	templateFormats: ["jinja", "md"],
	passthrough: [
		{ "src/assets": "assets" },
		{ "src/favicon.svg": "favicon.svg" },
		{ "src/robots.txt": "robots.txt" },
		// Read by Cloudflare, not served (wrangler.jsonc).
		{ "src/_headers": "_headers" },
		// The drawings have one home, docs/assets/, beside the README that floats them.
		{ "../docs/assets/stickers": "assets/drawings/stickers" },
		{ "../docs/assets/sitesquatch.svg": "assets/drawings/sitesquatch.svg" },
		{ "../docs/assets/footprint.svg": "assets/drawings/footprint.svg" },
		// What agents read: each docs page as Markdown, /llms.txt and /llms-full.txt, written
		// before the build by lib/agents.ts.
		{ generated: "." },
	],

	// The docs pages are src/docs/ (lib/docs.ts). What agents read is written from them before
	// each build, only what changed, so the dev server's rebuild doesn't start another.
	beforeBuild: [() => { writeAgentCopies(); }],
	watch: ["lib"],

	markdown: { highlight: true },

	// The changelog's entries (src/changelog/), newest release first.
	collections: {
		changelog: (pages) => pages.byTag("changelog").sort((a, b) => version(b.data.release) - version(a.data.release)),
	},
	filters: {
		/** A page's first paragraph, for a list of entries. */
		firstParagraph: (html) => /<p\b[\s\S]*?<\/p>/.exec(String(html ?? ""))?.[0] ?? "",
		/** A docs page's Markdown copy: `/docs/install/` is `/docs/install.md`. */
		markdownCopy: (url) => copyOf(String(url)),
		/** A link in a docs page, from `page.inputPath`: a relative .md link is its page's URL (lib/docs.ts). */
		docsHref: (href, inputPath) => docsHref(String(href), String(inputPath).replace(/\\/g, "/").replace(/^.*?src\/docs\//, "")),
	},
	schemas: {
		docs: {
			files: "docs/**/*.md",
			fields: { title: "string", "navTitle?": "string", "description?": "string", "command?": "string" },
			unknown: "error",
		},
		changelog: {
			fields: { title: "string", release: "string", releases: "string[]", date: "date", "lastRelease?": "string", "lastDate?": "date" },
			unknown: "error",
		},
	},

	// The site's promise is that a page gets no script it doesn't need. build.ts fails on any
	// warning, so going over one of these fails the build. Pagefind's files are written after
	// the build, so they aren't counted: they load only when someone searches. Production only:
	// `ssqch serve` would count the Pagefind files the last production build left in dist/.
	budgets: env === "production" ? { pages: "100 KB", css: "40 KB", javascript: "3 KB", fonts: "30 KB", images: "100 KB" } : {},

	// The docs pages' stickers point into docs/assets/ by a relative path, which GitHub follows;
	// the site serves those drawings from /assets/drawings/ (passthrough, above).
	transforms: {
		stickers: (content, page) => (page.outputPath?.endsWith(".html") ? content.replace(/(<img\b[^>]*\bsrc=")(?:\.\.\/)+docs\/assets\//g, "$1/assets/drawings/") : content),
	},

	plugins: [
		elementsPlugin(),
		rssPlugin(),
		linksPlugin({ ignore: ["/pagefind/"] }),
		sitemapPlugin({ url: "https://sitesquatch.dev", lastmod: false }),
		assetsPlugin({ files: ["/assets/site.css", "/assets/theme.js"] }),
		env === "production" && minifyPlugin(),
	],
}));
