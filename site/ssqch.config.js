// sitesquatch.dev, built with the ssqch in this repository (packages/ssqch), so a change to ssqch
// that breaks its own site shows up here first. `node build.ts` builds it for production and
// fails on any warning; `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it.
import { defineConfig } from "ssqch";
import { assetsPlugin } from "ssqch/assets";
import { elementsPlugin } from "ssqch/elements";
import { linksPlugin } from "ssqch/links";
import { llmsPlugin } from "ssqch/llms";
import { minifyPlugin } from "ssqch/minify";
import { robotsPlugin } from "ssqch/robots";
import { rssPlugin } from "ssqch/rss";
import { sitemapPlugin } from "ssqch/sitemap";
import { docsHref, pages } from "./lib/docs.ts";

/** Each docs page's sidebar group and place, by URL (src/docs/nav.yml), read once a build. */
let order;
const docsOrder = () => (order ??= new Map(pages().map((p, at) => [p.url, { group: p.group, at }])));

/** "0.9.0" as a number that sorts: 9000. */
const version = (v) => String(v).split(".").reduce((n, part) => n * 1000 + Number(part), 0);

export default defineConfig(({ env }) => ({
	dirs: { input: "src", output: "dist" },
	templateFormats: ["jinja", "md"],
	passthrough: [
		{ "src/assets": "assets" },
		{ "src/favicon.svg": "favicon.svg" },
		// Read by Cloudflare, not served (wrangler.jsonc).
		{ "src/_headers": "_headers" },
		// The drawings have one home, docs/assets/, beside the README that floats them.
		{ "../docs/assets/stickers": "assets/drawings/stickers" },
		{ "../docs/assets/sitesquatch.svg": "assets/drawings/sitesquatch.svg" },
		{ "../docs/assets/footprint.svg": "assets/drawings/footprint.svg" },
	],

	// The docs pages are src/docs/ (lib/docs.ts). Their order is read again for each build, so an
	// edit to nav.yml while serving reorders /llms.txt.
	beforeBuild: [() => { order = undefined; }],
	watch: ["lib"],

	markdown: { highlight: true },

	// The changelog's entries (src/changelog/), newest release first.
	collections: {
		changelog: (pages) => pages.byTag("changelog").sort((a, b) => version(b.data.release) - version(a.data.release)),
	},
	filters: {
		/** A page's first paragraph, for a list of entries. */
		firstParagraph: (html) => /<p\b[\s\S]*?<\/p>/.exec(String(html ?? ""))?.[0] ?? "",
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
	budgets: env === "production" ? { pages: "100 KB", css: "40 KB", javascript: "4 KB", fonts: "30 KB", images: "100 KB" } : {},

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
		// Every crawler welcome, AI ones included: the sitemap line comes from sitemapPlugin().
		robotsPlugin(),
		// What agents read: each docs page as Markdown (`/docs/install/index.md`), /llms.txt and
		// /llms-full.txt, in the sidebar's groups and order. The first thing they say is that
		// `ssqch docs <name>` answers for the installed version, which beats any website.
		llmsPlugin({
			url: "https://sitesquatch.dev",
			title: "SiteSquatch",
			description: "SiteSquatch (`ssqch`) is a static site generator for Node.js. It turns Markdown and templates into plain HTML, and checks its own work on every build: links, front matter against schemas, and what a change did to the output.",
			details: [
				"- If ssqch is installed, `ssqch docs <name>` (a command, a config option, a function or a heading's words) prints the documentation for the installed version, with no network. `ssqch docs` alone lists every name, and `--format json` gives the same as JSON.",
				"- Every docs page here has a Markdown copy at its address with `index.md` on the end (https://sitesquatch.dev/docs/install/index.md), and a request for a docs page with `Accept: text/markdown` gets the copy.",
				"- The example sites run live at https://sitesquatch.dev/examples/, and their source is at https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites.",
			].join("\n"),
			// The examples are sites of their own; the home page and the changelog are listed after the docs.
			exclude: ["/examples/**"],
			section: (page) => docsOrder().get(page.url)?.group,
			sort: (a, b) => (docsOrder().get(a.url)?.at ?? Infinity) - (docsOrder().get(b.url)?.at ?? Infinity),
		}),
		assetsPlugin({ files: ["/assets/site.css", "/assets/theme.js"] }),
		env === "production" && minifyPlugin(),
	],
}));
