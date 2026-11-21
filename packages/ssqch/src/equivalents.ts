// Other generators' words, and ssqch's name for the same thing.
//
// When someone (or a coding agent) arriving from another generator types its command, flag,
// config option, front-matter key or filter, ssqch says its own name for it and where to read
// more, so the right spelling is learned on the first try. A row is an alias when the word means
// the same thing in ssqch: it works, and says ssqch's name once. The others refuse their word
// with a hint, because it would mean something else here (see AGENTS.md). A word ssqch has itself
// is never in the table.
//
// The table is curated: the words people and agents reach for, from the trailheads (migration
// guides) in `site/src/docs/trailheads/`, not every option of every generator. Each row is tested: an
// alias works and a hint is refused, and the name it gives exists.
import fs from "node:fs";
import path from "node:path";

/** Where a word can turn up: `ssqch dev`, `--drafts`, `pathPrefix` in the config, `eleventyComputed` in front matter, `| slug` in a template, `eleventy.generator` in template code. */
export type Kind = "command" | "flag" | "config" | "frontMatter" | "filter" | "global";

export interface Equivalent {
	/** The other generator's word, as it's typed (`dev`, `--drafts`, `pathPrefix`). */
	word: string;
	kind: Kind;
	/** Whether the word works in ssqch too, as another name for `ssqch`: it does the same thing, and prints a note once. A word that would mean something else here (`check`, `baseURL`) stays a hint and is refused. */
	alias: boolean;
	/** Whose word it is. Empty for a word half the ecosystem uses (`dev`). */
	from: readonly string[];
	/** ssqch's name for it: a command, flag, config option, front-matter key or function. */
	ssqch: string;
	/** What to say: ssqch's way, written out. */
	say: string;
	/** Where to read more: an `ssqch docs` lookup, or a command's `--help` for a flag. */
	more: string;
}

const SERVE = "ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.";

/** The table. Words are matched exactly (flags with their dashes). */
export const TABLE: readonly Equivalent[] = [
	// Commands.
	{ word: "dev", kind: "command", alias: true, from: [], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
	{ word: "start", kind: "command", alias: true, from: [], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
	{ word: "server", kind: "command", alias: true, from: ["Hugo", "Hexo", "Jekyll"], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
	{ word: "preview", kind: "command", alias: true, from: ["Astro", "VitePress"], ssqch: "serve --built", say: "Serving a production build as it is, without building or reloading, is `ssqch serve --built`.", more: "ssqch docs serve" },
	{ word: "watch", kind: "command", alias: true, from: [], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
	{ word: "check", kind: "command", alias: false, from: ["Zola", "Astro"], ssqch: "build", say: "`ssqch build` checks as it builds: content schemas on every build, and internal links with `linksPlugin()`.", more: "ssqch docs \"Content schemas\"" },
	{ word: "clean", kind: "command", alias: false, from: ["Hexo", "Jekyll", "Gatsby"], ssqch: "leaveNoTrace", say: "ssqch has no clean command: `leaveNoTrace: true` in the config deletes what an earlier build wrote and this one didn't.", more: "ssqch docs leaveNoTrace" },
	{ word: "generate", kind: "command", alias: true, from: ["Hexo"], ssqch: "build", say: "To build the site: `ssqch build`.", more: "ssqch docs build" },
	{ word: "version", kind: "command", alias: false, from: ["Hugo"], ssqch: "--version", say: "The version is `ssqch --version`.", more: "ssqch --help" },
	{ word: "deploy", kind: "command", alias: false, from: ["Hexo"], ssqch: "build", say: "ssqch doesn't deploy: `ssqch build` writes the site, and your host serves the output folder.", more: "ssqch docs Deploying" },
	// Flags.
	{ word: "--watch", kind: "flag", alias: true, from: ["Eleventy", "Jekyll"], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
	{ word: "--serve", kind: "flag", alias: true, from: ["Eleventy"], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
	{ word: "--drafts", kind: "flag", alias: false, from: ["Jekyll"], ssqch: "--env", say: "Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.", more: "ssqch docs draft" },
	{ word: "-D", kind: "flag", alias: false, from: ["Hugo"], ssqch: "--env", say: "Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.", more: "ssqch docs draft" },
	{ word: "--buildDrafts", kind: "flag", alias: false, from: ["Hugo"], ssqch: "--env", say: "Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.", more: "ssqch docs draft" },
	{ word: "-d", kind: "flag", alias: true, from: ["Hugo", "Jekyll"], ssqch: "--output", say: "The output folder is `-o, --output DIR` (or `dirs.output` in the config).", more: "ssqch build --help" },
	{ word: "--destination", kind: "flag", alias: true, from: ["Hugo", "Jekyll"], ssqch: "--output", say: "The output folder is `-o, --output DIR` (or `dirs.output` in the config).", more: "ssqch build --help" },
	{ word: "--input", kind: "flag", alias: false, from: ["Eleventy"], ssqch: "--root", say: "The input folder is `dirs.input` in the config; `--root DIR` is the project folder (where the config is).", more: "ssqch build --help" },
	{ word: "--pathprefix", kind: "flag", alias: true, from: ["Eleventy"], ssqch: "--base", say: "The path a site is served under is `--base /repo/` (or `base` in the config).", more: "ssqch docs base" },
	{ word: "--baseURL", kind: "flag", alias: false, from: ["Hugo"], ssqch: "--base", say: "The path a site is served under is `--base /repo/` (or `base` in the config); the domain isn't needed.", more: "ssqch docs base" },
	{ word: "--minify", kind: "flag", alias: false, from: ["Hugo"], ssqch: "minifyPlugin", say: "Minifying is `minifyPlugin()` from \"ssqch/minify\", in the config's `plugins`.", more: "ssqch docs minifyPlugin" },
	{ word: "--incremental", kind: "flag", alias: false, from: ["Eleventy", "Jekyll"], ssqch: "serve", say: "There's nothing to turn on: a whole build is quick, and `ssqch serve` reloads only the pages that changed.", more: "ssqch docs serve" },
	{ word: "--kind", kind: "flag", alias: false, from: ["Hugo"], ssqch: "--blueprint", say: "What Hugo calls an archetype is a blueprint in ssqch: `ssqch new posts/pine.md --blueprint notes` starts from `_blueprints/notes.md`.", more: "ssqch new --help" },
	{ word: "--template", kind: "flag", alias: false, from: [], ssqch: "--starter", say: "`ssqch init --starter site|docs` picks the starter, and `--engine` its template language.", more: "ssqch init --help" },
	// Config options (and the methods of a config written as calls).
	{ word: "pathPrefix", kind: "config", alias: true, from: ["Eleventy"], ssqch: "base", say: "In ssqch it's `base`: base: \"/repo/\".", more: "ssqch docs base" },
	{ word: "dir", kind: "config", alias: true, from: ["Eleventy"], ssqch: "dirs", say: "In ssqch it's `dirs`: dirs: { input: \"src\", output: \"dist\" }.", more: "ssqch docs dirs" },
	{ word: "publishDir", kind: "config", alias: true, from: ["Hugo"], ssqch: "dirs.output", say: "The output folder is `dirs.output`: dirs: { output: \"public\" }.", more: "ssqch docs dirs" },
	{ word: "outDir", kind: "config", alias: true, from: ["Astro", "VitePress"], ssqch: "dirs.output", say: "The output folder is `dirs.output`: dirs: { output: \"dist\" }.", more: "ssqch docs dirs" },
	{ word: "integrations", kind: "config", alias: false, from: ["Astro"], ssqch: "plugins", say: "In ssqch it's `plugins`: plugins: [imagePlugin()].", more: "ssqch docs plugins" },
	{ word: "markdownTemplateEngine", kind: "config", alias: true, from: ["Eleventy"], ssqch: "markdownEngine", say: "In ssqch it's `markdownEngine`: markdownEngine: \"njk\" (or false).", more: "ssqch docs markdownEngine" },
	{ word: "htmlTemplateEngine", kind: "config", alias: true, from: ["Eleventy"], ssqch: "htmlEngine", say: "In ssqch it's `htmlEngine`: htmlEngine: \"njk\" (or false).", more: "ssqch docs htmlEngine" },
	{ word: "uglyURLs", kind: "config", alias: false, from: ["Hugo"], ssqch: "urls", say: "In ssqch it's `urls`: urls: \"html\" writes /guide/intro.html.", more: "ssqch docs urls" },
	{ word: "cleanUrls", kind: "config", alias: false, from: ["VitePress"], ssqch: "urls", say: "ssqch's URLs are clean by default (urls: \"folders\", /guide/intro/); urls: \"html\" writes /guide/intro.html, as VitePress does without cleanUrls.", more: "ssqch docs urls" },
	{ word: "baseURL", kind: "config", alias: false, from: ["Hugo"], ssqch: "base", say: "ssqch's `base` is the path only (base: \"/repo/\"); the site's full URL goes in your data, for sitemapPlugin({ url }).", more: "ssqch docs base" },
	{ word: "title", kind: "config", alias: false, from: ["Hugo", "Zola", "Jekyll"], ssqch: "data", say: "The site's title is data: put it in `_data/site.json` and use `site.title` in templates.", more: "ssqch docs data" },
	{ word: "addPassthroughCopy", kind: "config", alias: false, from: ["Eleventy"], ssqch: "passthrough", say: "In ssqch it's `passthrough`: passthrough: [\"src/fonts\", { \"src/static\": \"static\" }].", more: "ssqch docs passthrough" },
	{ word: "addFilter", kind: "config", alias: false, from: ["Eleventy"], ssqch: "filters", say: "In ssqch it's `filters`: filters: { shout: (s) => s.toUpperCase() }.", more: "ssqch docs filters" },
	{ word: "addShortcode", kind: "config", alias: false, from: ["Eleventy"], ssqch: "filters", say: "A shortcode is a function in `filters`: filters: { year: () => String(new Date().getFullYear()) }.", more: "ssqch docs filters" },
	{ word: "addCollection", kind: "config", alias: false, from: ["Eleventy"], ssqch: "collections", say: "In ssqch it's `collections`: collections: { posts: (pages) => pages.byTag(\"post\") }.", more: "ssqch docs collections" },
	{ word: "addTransform", kind: "config", alias: false, from: ["Eleventy"], ssqch: "transforms", say: "In ssqch it's `transforms`: transforms: { tidy: (content, page) => content }.", more: "ssqch docs transforms" },
	{ word: "addGlobalData", kind: "config", alias: false, from: ["Eleventy"], ssqch: "data", say: "In ssqch it's `data`: data: { buildTime: () => new Date() }.", more: "ssqch docs data" },
	{ word: "addWatchTarget", kind: "config", alias: false, from: ["Eleventy"], ssqch: "watch", say: "In ssqch it's `watch`: watch: [\"src/assets/\"].", more: "ssqch docs watch" },
	{ word: "addPlugin", kind: "config", alias: false, from: ["Eleventy"], ssqch: "plugins", say: "In ssqch it's `plugins`: plugins: [rssPlugin()].", more: "ssqch docs plugins" },
	{ word: "setTemplateFormats", kind: "config", alias: false, from: ["Eleventy"], ssqch: "templateFormats", say: "In ssqch it's `templateFormats`: templateFormats: [\"njk\", \"md\"].", more: "ssqch docs templateFormats" },
	// Front-matter keys that can't be a site's own.
	{ word: "eleventyComputed", kind: "frontMatter", alias: true, from: ["Eleventy"], ssqch: "computed", say: "ssqch's name is `computed`.", more: "ssqch docs computed" },
	{ word: "eleventyExcludeFromCollections", kind: "frontMatter", alias: true, from: ["Eleventy"], ssqch: "excludeFromCollections", say: "ssqch's name is `excludeFromCollections`.", more: "ssqch docs excludeFromCollections" },
	{ word: "eleventyNavigation", kind: "frontMatter", alias: false, from: ["Eleventy"], ssqch: "nav", say: "ssqch's own navigation (`pagesTree` and `navTree`) reads `nav`, so these pages aren't in it: rename it to `nav` (the same `key`, `parent`, `order` and `title`), and `collections.all | eleventyNavigation: \"Feature\"` is `pagesTree(collections.all, { root: \"Feature\" })`. Templates and filters that read `eleventyNavigation` (eleventy-navigation's `findNavigationEntries`) still get it as it is.", more: "ssqch docs nav" },
	{ word: "templateEngineOverride", kind: "frontMatter", alias: true, from: ["Eleventy"], ssqch: "render", say: "ssqch's name is `render`, a list: render: [njk, md].", more: "ssqch docs render" },
	{ word: "redirect_from", kind: "frontMatter", alias: true, from: ["Jekyll"], ssqch: "aliases", say: "ssqch's name is `aliases`; `redirectsPlugin()` from \"ssqch/redirects\" writes the redirects.", more: "ssqch docs aliases" },
	{ word: "published", kind: "frontMatter", alias: false, from: ["Jekyll"], ssqch: "draft", say: "`published: false` doesn't hold a page back in ssqch, so it's published: use `draft: true`.", more: "ssqch docs draft" },
	// Filters.
	{ word: "url", kind: "filter", alias: true, from: ["Eleventy"], ssqch: "base", say: "It returns the URL as it is: the build adds `base` to every URL from the site's root, so `href=\"/about/\"` needs no filter (use `withBase()` outside HTML attributes).", more: "ssqch docs base" },
	{ word: "relative_url", kind: "filter", alias: true, from: ["Jekyll"], ssqch: "base", say: "It returns the URL as it is: the build adds `base` to every URL from the site's root, so `href=\"/about/\"` needs no filter (use `withBase()` outside HTML attributes).", more: "ssqch docs base" },
	{ word: "getPreviousCollectionItem", kind: "filter", alias: true, from: ["Eleventy"], ssqch: "navPager", say: "`collection | getPreviousCollectionItem(page)` works: it's `navPager(collection, page.url).previous`, which gives `previous` and `next` at once.", more: "ssqch docs navPager" },
	{ word: "getNextCollectionItem", kind: "filter", alias: true, from: ["Eleventy"], ssqch: "navPager", say: "`collection | getNextCollectionItem(page)` works: it's `navPager(collection, page.url).next`, which gives `previous` and `next` at once.", more: "ssqch docs navPager" },
	{ word: "slug", kind: "filter", alias: false, from: ["Eleventy"], ssqch: "slugify", say: "ssqch's is `slugify`, which differs: Eleventy's `slug` (the `slugify` npm package) keeps `.` and some punctuation, so `Node.js` is `node.js` there and `node-js` in ssqch. To keep old URLs, define `slug` in `filters` with that package: slug: (s) => slugify(String(s), { lower: true }).", more: "ssqch docs slugify" },
	{ word: "absolute_url", kind: "filter", alias: false, from: ["Jekyll"], ssqch: "absoluteUrl", say: "`absoluteUrl(url, base)` comes with `rssPlugin()` from \"ssqch/rss\".", more: "ssqch docs absoluteUrl" },
	{ word: "markdownify", kind: "filter", alias: true, from: ["Jekyll", "Hugo"], ssqch: "markdown", say: "ssqch's function is `markdown(text)` (or `markdown(text, \"inline\")`).", more: "ssqch docs markdown" },
	{ word: "jsonify", kind: "filter", alias: false, from: ["Jekyll"], ssqch: "dump", say: "`jsonify` works in Liquid templates; in Jinja it's `tojson`, and in Nunjucks `dump`.", more: "ssqch docs \"Jinja and Nunjucks\"" },
	// Template globals: the word as it's written in template code.
	{ word: "eleventy.", kind: "global", alias: false, from: ["Eleventy"], ssqch: "ssqch", say: "ssqch's is `ssqch`: `ssqch.generator`, `ssqch.version`, `ssqch.env` and `ssqch.serving`, so this prints nothing.", more: "ssqch docs ssqch.generator" },
	{ word: "site.posts", kind: "global", alias: false, from: ["Jekyll"], ssqch: "collections", say: "ssqch's lists of pages are `collections`: `collections.posts` is the pages tagged `posts`, so this is empty.", more: "ssqch docs collections" },
	{ word: "site.pages", kind: "global", alias: false, from: ["Jekyll"], ssqch: "collections", say: "ssqch's lists of pages are `collections`: `collections.all` is every page, so this is empty.", more: "ssqch docs collections" },
];

/** The row for `word` of `kind`. */
export function find(word: string, kind: Kind): Equivalent | undefined {
	return TABLE.find((e) => e.word === word && e.kind === kind);
}

/** What an alias prints when it's used: `pathPrefix works; ssqch calls it base (ssqch docs base)`. */
export function note(row: Equivalent): string {
	// `url` and `relative_url` give the URL back: the build adds `base` itself.
	if (row.kind === "filter" && row.ssqch === "base") return `${row.word} works, and isn't needed: the build adds base to URLs itself (${row.more})`;
	return `${row.word} works; ssqch calls it ${row.ssqch} (${row.more})`;
}

/** The hint as it's printed under an error: the equivalent, then where to read more. */
export function hint(row: Equivalent): string {
	return `${row.say}\nMore: ${row.more}`;
}

/** The hint as data, for the JSON report. */
export function toJson(row: Equivalent) {
	return { word: row.word, kind: row.kind, use: row.ssqch, alias: row.alias, from: [...row.from], more: row.more };
}

/** The row whose sentence `message` contains, for the JSON report of an error whose text was built from it. */
export function inMessage(message: string): Equivalent | undefined {
	return TABLE.find((e) => message.includes(e.say));
}

/** Another generator's config, in a folder without ssqch's: [file, generator, importer, the trailhead in `site/src/docs/trailheads/` that `ssqch docs --from` prints]. */
export const OTHER_CONFIGS: ReadonlyArray<readonly [string, string, string | null, string | null]> = [
	[".eleventy.js", "Eleventy", "eleventy", "from-eleventy.md"],
	["eleventy.config.js", "Eleventy", "eleventy", "from-eleventy.md"],
	["eleventy.config.mjs", "Eleventy", "eleventy", "from-eleventy.md"],
	["eleventy.config.cjs", "Eleventy", "eleventy", "from-eleventy.md"],
	["hugo.toml", "Hugo", null, null],
	["hugo.yaml", "Hugo", null, null],
	["hugo.json", "Hugo", null, null],
	["mkdocs.yml", "MkDocs", null, "from-mkdocs.md"],
	["docusaurus.config.js", "Docusaurus", null, "from-docusaurus.md"],
	["docusaurus.config.ts", "Docusaurus", null, "from-docusaurus.md"],
	["astro.config.mjs", "Astro", null, "from-component-frameworks.md"],
	["astro.config.ts", "Astro", null, "from-component-frameworks.md"],
	["gatsby-config.js", "Gatsby", null, "from-component-frameworks.md"],
	[".vitepress/config.ts", "VitePress", null, "from-vitepress.md"],
	[".vitepress/config.mts", "VitePress", null, "from-vitepress.md"],
	[".vitepress/config.js", "VitePress", null, "from-vitepress.md"],
];

/** What to say about a folder that has another generator's config and none of ssqch's: the generator's name, `ssqch scout`, and the guide for it. */
export function otherGenerator(root: string): string | undefined {
	const isFile = (file: string) => fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() ?? false;
	const read = (file: string) => { try { return fs.readFileSync(path.join(root, file), "utf8"); } catch { return undefined; } };
	let found = OTHER_CONFIGS.find(([file]) => isFile(file));
	if (!found) {
		// `config.toml` is Zola's (with `base_url`) or an older Hugo's (with `baseURL`); `_config.yml` is Jekyll's or Hexo's.
		const toml = read("config.toml");
		if (toml?.includes("base_url")) found = ["config.toml", "Zola", "zola", "from-zola.md"];
		else if (toml?.includes("baseURL")) found = ["config.toml", "Hugo", null, null];
		else if (read("_config.yml") !== undefined) {
			const hexo = read("package.json")?.includes("\"hexo\"") ?? false;
			found = hexo ? ["_config.yml", "Hexo", null, "from-hexo.md"] : ["_config.yml", "Jekyll", null, null];
		}
	}
	if (!found) return undefined;
	const [file, generator] = found;
	const docs = `\`ssqch docs --from ${generator.toLowerCase()}\` says what maps to what`;
	const next = `\`ssqch scout\` lists what moving it takes and drafts a config (\`--write-draft\`), and ${docs}`;
	const article = /^[AEIOU]/.test(generator) ? "an" : "a";
	return `this folder has ${article} ${generator} config (${file}) and no ssqch.config.js, so ssqch builds it with its own defaults. ${next}.`;
}
