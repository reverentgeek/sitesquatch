// From crates/ssqch/tests/cli.rs.
//
// `other_generators_words_get_ssqch_names` walks the table of other generators' words
// (`TABLE` in packages/ssqch/src/equivalents.ts; 0.7's was `equivalents.rs`), which the Rust test
// read from the crate. A black-box test can't, so TABLE below is a copy of its rows (word, kind,
// alias, ssqch, say, more), in 0.7's names for the kinds. When the table changes, update the
// copy: packages/ssqch/src/equivalents.test.ts fails until they're the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ssqch, tempDir, write, REPO } from "../lib/ssqch.js";

// DELIBERATE (0.15): `absolute_url`'s hint says `absoluteUrl` is on every site, where it came
// with `rssPlugin()` until 0.15.
const TABLE = [
	{"word":"dev","kind":"Command","alias":true,"ssqch":"serve","say":"ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.","more":"ssqch docs serve"},
	{"word":"start","kind":"Command","alias":true,"ssqch":"serve","say":"ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.","more":"ssqch docs serve"},
	{"word":"server","kind":"Command","alias":true,"ssqch":"serve","say":"ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.","more":"ssqch docs serve"},
	{"word":"preview","kind":"Command","alias":true,"ssqch":"serve --built","say":"Serving a production build as it is, without building or reloading, is `ssqch serve --built`.","more":"ssqch docs serve"},
	{"word":"watch","kind":"Command","alias":true,"ssqch":"serve","say":"ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.","more":"ssqch docs serve"},
	{"word":"inspect","kind":"Command","alias":false,"ssqch":"trace","say":"`ssqch inspect` is `ssqch trace` now, with the same options and JSON: it follows a page's values back through the data cascade.","more":"ssqch trace --help"},
	{"word":"check","kind":"Command","alias":false,"ssqch":"build","say":"`ssqch build` checks as it builds: content schemas on every build, and internal links with `linksPlugin()`. `ssqch patrol` checks a build for what agents and crawlers read.","more":"ssqch docs \"Content schemas\""},
	{"word":"clean","kind":"Command","alias":false,"ssqch":"leaveNoTrace","say":"ssqch has no clean command: `leaveNoTrace: true` in the config deletes what an earlier build wrote and this one didn't.","more":"ssqch docs leaveNoTrace"},
	{"word":"generate","kind":"Command","alias":true,"ssqch":"build","say":"To build the site: `ssqch build`.","more":"ssqch docs build"},
	{"word":"version","kind":"Command","alias":false,"ssqch":"--version","say":"The version is `ssqch --version`.","more":"ssqch --help"},
	{"word":"deploy","kind":"Command","alias":false,"ssqch":"build","say":"ssqch doesn't deploy: `ssqch build` writes the site, and your host serves the output folder.","more":"ssqch docs Deploying"},
	{"word":"--watch","kind":"Flag","alias":true,"ssqch":"serve","say":"ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.","more":"ssqch docs serve"},
	{"word":"--serve","kind":"Flag","alias":true,"ssqch":"serve","say":"ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.","more":"ssqch docs serve"},
	{"word":"--drafts","kind":"Flag","alias":false,"ssqch":"--env","say":"Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.","more":"ssqch docs draft"},
	{"word":"-D","kind":"Flag","alias":false,"ssqch":"--env","say":"Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.","more":"ssqch docs draft"},
	{"word":"--buildDrafts","kind":"Flag","alias":false,"ssqch":"--env","say":"Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.","more":"ssqch docs draft"},
	{"word":"-d","kind":"Flag","alias":true,"ssqch":"--output","say":"The output folder is `-o, --output DIR` (or `dirs.output` in the config).","more":"ssqch build --help"},
	{"word":"--destination","kind":"Flag","alias":true,"ssqch":"--output","say":"The output folder is `-o, --output DIR` (or `dirs.output` in the config).","more":"ssqch build --help"},
	{"word":"--input","kind":"Flag","alias":false,"ssqch":"--root","say":"The input folder is `dirs.input` in the config; `--root DIR` is the project folder (where the config is).","more":"ssqch build --help"},
	{"word":"--pathprefix","kind":"Flag","alias":true,"ssqch":"--base","say":"The path a site is served under is `--base /repo/` (or `base` in the config).","more":"ssqch docs base"},
	{"word":"--baseURL","kind":"Flag","alias":false,"ssqch":"--base","say":"The path a site is served under is `--base /repo/` (or `base` in the config); the domain isn't needed.","more":"ssqch docs base"},
	{"word":"--minify","kind":"Flag","alias":false,"ssqch":"minifyPlugin","say":"Minifying is `minifyPlugin()` from \"ssqch/minify\", in the config's `plugins`.","more":"ssqch docs minifyPlugin"},
	{"word":"--incremental","kind":"Flag","alias":false,"ssqch":"serve","say":"There's nothing to turn on: a whole build is quick, and `ssqch serve` reloads only the pages that changed.","more":"ssqch docs serve"},
	{"word":"--kind","kind":"Flag","alias":false,"ssqch":"--blueprint","say":"What Hugo calls an archetype is a blueprint in ssqch: `ssqch new posts/pine.md --blueprint notes` starts from `_blueprints/notes.md`.","more":"ssqch new --help"},
	{"word":"--template","kind":"Flag","alias":false,"ssqch":"--starter","say":"`ssqch init --starter site|docs` picks the starter, and `--engine` its template language.","more":"ssqch init --help"},
	{"word":"pathPrefix","kind":"Config","alias":true,"ssqch":"base","say":"In ssqch it's `base`: base: \"/repo/\".","more":"ssqch docs base"},
	{"word":"dir","kind":"Config","alias":true,"ssqch":"dirs","say":"In ssqch it's `dirs`: dirs: { input: \"src\", output: \"dist\" }.","more":"ssqch docs dirs"},
	{"word":"publishDir","kind":"Config","alias":true,"ssqch":"dirs.output","say":"The output folder is `dirs.output`: dirs: { output: \"public\" }.","more":"ssqch docs dirs"},
	{"word":"outDir","kind":"Config","alias":true,"ssqch":"dirs.output","say":"The output folder is `dirs.output`: dirs: { output: \"dist\" }.","more":"ssqch docs dirs"},
	{"word":"integrations","kind":"Config","alias":false,"ssqch":"plugins","say":"In ssqch it's `plugins`: plugins: [imagePlugin()].","more":"ssqch docs plugins"},
	{"word":"markdownTemplateEngine","kind":"Config","alias":true,"ssqch":"markdownEngine","say":"In ssqch it's `markdownEngine`: markdownEngine: \"njk\" (or false).","more":"ssqch docs markdownEngine"},
	{"word":"htmlTemplateEngine","kind":"Config","alias":true,"ssqch":"htmlEngine","say":"In ssqch it's `htmlEngine`: htmlEngine: \"njk\" (or false).","more":"ssqch docs htmlEngine"},
	{"word":"uglyURLs","kind":"Config","alias":false,"ssqch":"urls","say":"In ssqch it's `urls`: urls: \"html\" writes /guide/intro.html.","more":"ssqch docs urls"},
	{"word":"cleanUrls","kind":"Config","alias":false,"ssqch":"urls","say":"ssqch's URLs are clean by default (urls: \"folders\", /guide/intro/); urls: \"html\" writes /guide/intro.html, as VitePress does without cleanUrls.","more":"ssqch docs urls"},
	{"word":"baseURL","kind":"Config","alias":false,"ssqch":"base","say":"ssqch's `base` is the path only (base: \"/repo/\"); the site's full URL goes in your data, for sitemapPlugin({ url }).","more":"ssqch docs base"},
	{"word":"title","kind":"Config","alias":false,"ssqch":"data","say":"The site's title is data: put it in `_data/site.json` and use `site.title` in templates.","more":"ssqch docs data"},
	{"word":"addPassthroughCopy","kind":"Config","alias":false,"ssqch":"passthrough","say":"In ssqch it's `passthrough`: passthrough: [\"src/fonts\", { \"src/static\": \"static\" }].","more":"ssqch docs passthrough"},
	{"word":"clean","kind":"Config","alias":false,"ssqch":"leaveNoTrace","say":"ssqch calls it `leaveNoTrace`: leaveNoTrace: true deletes what an earlier build wrote and this one didn't.","more":"ssqch docs leaveNoTrace"},
	{"word":"addFilter","kind":"Config","alias":false,"ssqch":"filters","say":"In ssqch it's `filters`: filters: { shout: (s) => s.toUpperCase() }.","more":"ssqch docs filters"},
	{"word":"addShortcode","kind":"Config","alias":false,"ssqch":"filters","say":"A shortcode is a function in `filters`: filters: { year: () => String(new Date().getFullYear()) }.","more":"ssqch docs filters"},
	{"word":"addCollection","kind":"Config","alias":false,"ssqch":"collections","say":"In ssqch it's `collections`: collections: { posts: (pages) => pages.byTag(\"post\") }.","more":"ssqch docs collections"},
	{"word":"addTransform","kind":"Config","alias":false,"ssqch":"transforms","say":"In ssqch it's `transforms`: transforms: { tidy: (content, page) => content }.","more":"ssqch docs transforms"},
	{"word":"addGlobalData","kind":"Config","alias":false,"ssqch":"data","say":"In ssqch it's `data`: data: { buildTime: () => new Date() }.","more":"ssqch docs data"},
	{"word":"addWatchTarget","kind":"Config","alias":false,"ssqch":"watch","say":"In ssqch it's `watch`: watch: [\"src/assets/\"].","more":"ssqch docs watch"},
	{"word":"watchIgnores","kind":"Config","alias":false,"ssqch":"serve.ignore","say":"In ssqch it's `serve.ignore`: serve: { ignore: [\"src/_css/**\"] }.","more":"ssqch docs serve.ignore"},
	{"word":"addPlugin","kind":"Config","alias":false,"ssqch":"plugins","say":"In ssqch it's `plugins`: plugins: [rssPlugin()].","more":"ssqch docs plugins"},
	{"word":"setTemplateFormats","kind":"Config","alias":false,"ssqch":"templateFormats","say":"In ssqch it's `templateFormats`: templateFormats: [\"njk\", \"md\"].","more":"ssqch docs templateFormats"},
	{"word":"eleventyComputed","kind":"FrontMatter","alias":true,"ssqch":"computed","say":"ssqch's name is `computed`.","more":"ssqch docs computed"},
	{"word":"eleventyExcludeFromCollections","kind":"FrontMatter","alias":true,"ssqch":"excludeFromCollections","say":"ssqch's name is `excludeFromCollections`.","more":"ssqch docs excludeFromCollections"},
	{"word":"eleventyNavigation","kind":"FrontMatter","alias":false,"ssqch":"nav","say":"ssqch's own navigation (`pagesTree` and `navTree`) reads `nav`, so these pages aren't in it: rename it to `nav` (the same `key`, `parent`, `order` and `title`), and `collections.all | eleventyNavigation: \"Feature\"` is `pagesTree(collections.all, { root: \"Feature\" })`. Templates and filters that read `eleventyNavigation` (eleventy-navigation's `findNavigationEntries`) still get it as it is.","more":"ssqch docs nav"},
	{"word":"templateEngineOverride","kind":"FrontMatter","alias":true,"ssqch":"render","say":"ssqch's name is `render`, a list: render: [njk, md].","more":"ssqch docs render"},
	{"word":"redirect_from","kind":"FrontMatter","alias":true,"ssqch":"aliases","say":"ssqch's name is `aliases`; `redirectsPlugin()` from \"ssqch/redirects\" writes the redirects.","more":"ssqch docs aliases"},
	{"word":"published","kind":"FrontMatter","alias":false,"ssqch":"draft","say":"`published: false` doesn't hold a page back in ssqch, so it's published: use `draft: true`.","more":"ssqch docs draft"},
	{"word":"url","kind":"Filter","alias":true,"ssqch":"base","say":"It returns the URL as it is: the build adds `base` to every URL from the site's root, so `href=\"/about/\"` needs no filter (use `withBase()` outside HTML attributes).","more":"ssqch docs base"},
	{"word":"relative_url","kind":"Filter","alias":true,"ssqch":"base","say":"It returns the URL as it is: the build adds `base` to every URL from the site's root, so `href=\"/about/\"` needs no filter (use `withBase()` outside HTML attributes).","more":"ssqch docs base"},
	{"word":"getPreviousCollectionItem","kind":"Filter","alias":true,"ssqch":"navPager","say":"`collection | getPreviousCollectionItem(page)` works: it's `navPager(collection, page.url).previous`, which gives `previous` and `next` at once.","more":"ssqch docs navPager"},
	{"word":"getNextCollectionItem","kind":"Filter","alias":true,"ssqch":"navPager","say":"`collection | getNextCollectionItem(page)` works: it's `navPager(collection, page.url).next`, which gives `previous` and `next` at once.","more":"ssqch docs navPager"},
	{"word":"slug","kind":"Filter","alias":false,"ssqch":"slugify","say":"ssqch's is `slugify`, which differs: Eleventy's `slug` (the `slugify` npm package) keeps `.` and some punctuation, so `Node.js` is `node.js` there and `node-js` in ssqch. To keep old URLs, define `slug` in `filters` with that package: slug: (s) => slugify(String(s), { lower: true }).","more":"ssqch docs slugify"},
	{"word":"rssDate","kind":"Filter","alias":true,"ssqch":"dateToRfc3339","say":"With `rssPlugin()` it's `dateToRfc3339`: {{ post.date | dateToRfc3339 }}.","more":"ssqch docs rssPlugin"},
	{"word":"rssLastUpdatedDate","kind":"Filter","alias":true,"ssqch":"getNewestCollectionItemDate","say":"With `rssPlugin()` it's `getNewestCollectionItemDate`, then `dateToRfc3339`: {{ collections.posts | getNewestCollectionItemDate | dateToRfc3339 }}.","more":"ssqch docs rssPlugin"},
	{"word":"absolute_url","kind":"Filter","alias":false,"ssqch":"absoluteUrl","say":"`absoluteUrl(url, site.url)` is on every site: the whole address, with the site's `base`.","more":"ssqch docs absoluteUrl"},
	{"word":"markdownify","kind":"Filter","alias":true,"ssqch":"markdown","say":"ssqch's function is `markdown(text)` (or `markdown(text, \"inline\")`).","more":"ssqch docs markdown"},
	{"word":"jsonify","kind":"Filter","alias":false,"ssqch":"dump","say":"`jsonify` works in Liquid templates; in Jinja it's `tojson`, and in Nunjucks `dump`.","more":"ssqch docs \"Jinja and Nunjucks\""},
	{"word":"eleventy.","kind":"Global","alias":false,"ssqch":"ssqch","say":"ssqch's is `ssqch`: `ssqch.generator`, `ssqch.version`, `ssqch.env` and `ssqch.serving`, so this prints nothing.","more":"ssqch docs ssqch.generator"},
	{"word":"site.posts","kind":"Global","alias":false,"ssqch":"collections","say":"ssqch's lists of pages are `collections`: `collections.posts` is the pages tagged `posts`, so this is empty.","more":"ssqch docs collections"},
	{"word":"site.pages","kind":"Global","alias":false,"ssqch":"collections","say":"ssqch's lists of pages are `collections`: `collections.all` is every page, so this is empty.","more":"ssqch docs collections"},
];

/** What an alias prints when it's used (`Equivalent::note`). */
function note(row) {
	// `url` and `relative_url` give the URL back: the build adds `base` itself.
	if (row.kind === "Filter" && row.ssqch === "base") return `${row.word} works, and isn't needed: the build adds base to URLs itself (${row.more})`;
	return `${row.word} works; ssqch calls it ${row.ssqch} (${row.more})`;
}

const count = (text, part) => text.split(part).length - 1;

/** An alias works as ssqch's word does, and says ssqch's name once. */
function aliasWorks(row, dir) {
	const d = dir;
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	write(dir, { "ssqch.config.js": "export default {};\n", "index.md": "# Pine\n" });
	const rd = (p) => {
		try { return fs.readFileSync(path.join(dir, p), "utf8"); } catch (e) { throw new Error(`${row.word}: ${p}: ${e.message}`); }
	};
	let result;
	// The serving ones are checked in `aliases_rewrite_the_command_line`, without a server.
	if ((row.kind === "Command" || row.kind === "Flag") && (row.ssqch === "serve" || row.ssqch.startsWith("serve "))) return;
	const word = row.word;
	if (row.kind === "Command") {
		result = ssqch([word, "--root", d]);
	} else if (row.kind === "Flag" && word === "--pathprefix") {
		result = ssqch(["build", "--pathprefix", "/trail/", "--root", d]);
		assert.ok(rd("_site/index.html").includes("Pine"), row.word);
	} else if (row.kind === "Flag") {
		result = ssqch(["build", word, "camp", "--root", d]);
		rd("camp/index.html");
	} else if (row.kind === "Config") {
		const value = { pathPrefix: "\"/trail/\"", dir: "{ output: \"camp\" }", markdownTemplateEngine: "\"jinja\"", htmlTemplateEngine: "\"jinja\"" }[word] ?? "\"camp\"";
		write(dir, { "ssqch.config.js": `export default { ${word}: ${value} };\n` });
		result = ssqch(["build", "--root", d]);
		if (!["pathPrefix", "markdownTemplateEngine", "htmlTemplateEngine"].includes(word)) rd("camp/index.html");
		// Both names: an error.
		const other = row.ssqch === "dirs" || row.ssqch === "dirs.output" ? "dirs: { output: \"x\" }" : `${row.ssqch}: ${value}`;
		write(dir, { "ssqch.config.js": `export default { ${word}: ${value}, ${other} };\n` });
		const both = ssqch(["build", "--root", d]);
		assert.ok(!both.ok && both.log.includes("are two names for one option; set one of them"), `${row.word}: ${both.log}`);
	} else if (row.kind === "FrontMatter") {
		const [value, body, want] = {
			eleventyComputed: ["\n  label: \"{{ title }} trail\"", "{{ label }}", "Pine trail"],
			eleventyExcludeFromCollections: [" true", "{{ collections.all | length }}", "<p>0</p>"],
			redirect_from: [" [/old/]", "{{ aliases[0] }}", "/old/"],
		}[word] ?? [" md", "{{ title }}", "<p>{{ title }}</p>"];
		write(dir, { "index.md": `---\ntitle: Pine\n${word}:${value}\n---\n${body}\n` });
		result = ssqch(["build", "--root", d]);
		assert.ok(rd("_site/index.html").includes(want), `${row.word}: ${rd("_site/index.html")}`);
	} else if (row.kind === "Filter") {
		fs.rmSync(path.join(dir, "index.md"));
		if (row.ssqch === "navPager") {
			// Eleventy's `collection | getNextCollectionItem(page)`: the neighbour in the list.
			write(dir, { "a.jinja": "---\ntags: trail\ndate: 2026-01-01\n---\nA", "b.jinja": "---\ntags: trail\ndate: 2026-01-02\n---\nB", "index.jinja": `{% set p = collections.trail | ${word}(collections.trail[${word === "getNextCollectionItem" ? 0 : 1}]) %}{{ p.url }}` });
			result = ssqch(["build", "--root", d]);
			assert.equal(rd("_site/index.html"), word === "getNextCollectionItem" ? "/b/" : "/a/", row.word);
			for (const f of ["a.jinja", "b.jinja"]) fs.rmSync(path.join(dir, f));
		} else if (word === "rssDate" || word === "rssLastUpdatedDate") {
			// Added in 0.13: the Eleventy RSS plugin's first names, with rssPlugin(), say its new ones.
			write(dir, { "ssqch.config.js": "import { rssPlugin } from \"ssqch/rss\";\nexport default { plugins: [rssPlugin()] };\n", "post.md": "---\ntags: posts\ndate: 2026-01-02\n---\nPine.\n", "index.jinja": word === "rssDate" ? "{{ collections.posts[0].date | rssDate }}" : "{{ collections.posts | rssLastUpdatedDate }}" });
			result = ssqch(["build", "--root", d]);
			assert.equal(rd("_site/index.html"), "2026-01-02T00:00:00Z", row.word);
			fs.rmSync(path.join(dir, "post.md"));
		} else {
			write(dir, { "index.jinja": `{{ "/x/" | ${word} }}` });
			result = ssqch(["build", "--root", d]);
			assert.ok(rd("_site/index.html").startsWith(word === "markdownify" ? "&lt;p&gt;/x/" : "/x/"), `${row.word}: ${rd("_site/index.html")}`);
			// DELIBERATE (0.13.5): an alias works in every template language. Edge writes a filter as a
			// call, and `{{ url }}` there is still the page's data (blog #4: `url` wasn't a function).
			write(dir, { "ssqch.config.js": "export default { templateFormats: [\"edge\"] };\n", "index.edge": `{{ ${word}("/x/") }}|{{ typeof ${word} }}` });
			const edge = ssqch(["build", "--root", d]);
			assert.ok(edge.ok, `${row.word} in Edge: ${edge.log}`);
			const page = rd("_site/index.html");
			assert.ok(page.startsWith(word === "markdownify" ? "&lt;p&gt;/x/" : "/x/") && page.endsWith("|undefined"), `${row.word} in Edge: ${page}`);
			fs.rmSync(path.join(dir, "index.edge"));
		}
		fs.rmSync(path.join(dir, "index.jinja"));
	} else {
		throw new Error(`${row.word}: a template global can't be an alias`);
	}
	assert.ok(result.ok, `${row.word}: ${result.log}`);
	const wanted = `note: ${note(row)}\n`;
	assert.equal(count(result.log, wanted), 1, `${row.word}: ${result.log}`);
	assert.ok(!result.log.includes("warn:"), `${row.word}: ${result.log}`);
}

// Every row of the table of other generators' words: the word is refused (or, in front matter,
// warned about), what's said is the row's, and the name it gives is one ssqch has.
test("other_generators_words_get_ssqch_names", () => {
	const capabilities = ssqch(["capabilities", "--format", "json"]).stdout;
	let known = capabilities;
	for (const help of [["build", "--help"], ["serve", "--help"], ["init", "--help"], ["new", "--help"], ["--help"]]) {
		known += ssqch(help).log;
	}
	// The docs: sitesquatch.dev's pages, which `ssqch docs` reads.
	const docs = path.join(REPO, "site", "src", "docs");
	const readme = fs.readdirSync(docs, { recursive: true }).filter((f) => String(f).endsWith(".md")).map((f) => fs.readFileSync(path.join(docs, String(f)), "utf8")).join("\n");
	const dir = tempDir("equivalents");
	const d = dir;
	for (const row of TABLE) {
		// The name it gives exists (`dirs.output` is in `dirs`).
		const name = row.ssqch.split(/[. ]/)[0];
		assert.ok(known.includes(`"${name}"`) || known.includes(`${name} `) || readme.includes(`\`${name}`), `${row.word}: ssqch has no ${JSON.stringify(name)}`);
		assert.ok(row.say.length > 0 && row.more.length > 0, row.word);
		if (row.alias) {
			aliasWorks(row, dir);
			continue;
		}
		let r;
		if (row.kind === "Command") {
			r = ssqch([row.word], { cwd: dir });
		} else if (row.kind === "Flag") {
			const command = { "--template": "init", "--kind": "new" }[row.word] ?? "build";
			const args = [command, row.word];
			if (command === "new") args.push("posts/pine.md", "notes");
			args.push("--root", d);
			r = ssqch(args);
		} else if (row.kind === "Config") {
			write(dir, { "ssqch.config.js": `export default { ${row.word}: "x" };\n` });
			r = ssqch(["build", "--root", d]);
		} else if (row.kind === "FrontMatter") {
			write(dir, { "ssqch.config.js": "export default {};\n", "page.md": `---\n${row.word}: false\n---\nPine.\n` });
			const built = ssqch(["build", "--root", d]);
			fs.rmSync(path.join(dir, "page.md"));
			assert.ok(built.ok && built.log.includes("warn: page.md sets"), `${row.word}: ${built.log}`);
			r = { ok: false, log: built.log };
		} else if (row.kind === "Global") {
			write(dir, { "ssqch.config.js": "export default {};\n", "page.jinja": `{{ ${row.word.replace(/\.+$/, "")}.x }}` });
			const built = ssqch(["build", "--root", d]);
			fs.rmSync(path.join(dir, "page.jinja"));
			assert.ok(built.ok && built.log.includes("warn: page.jinja uses"), `${row.word}: ${built.log}`);
			r = { ok: false, log: built.log };
		} else if (row.kind === "Filter") {
			write(dir, { "ssqch.config.js": "export default {};\n", "page.jinja": `{{ "/x/" | ${row.word} }}` });
			r = ssqch(["build", "--root", d]);
			fs.rmSync(path.join(dir, "page.jinja"));
		}
		assert.ok(!r.ok, `${row.word} worked: ${r.log}`);
		assert.ok(r.log.includes(row.say) && r.log.includes(`More: ${row.more}`), `${row.word}: ${r.log}`);
	}
	// A config written as calls gets the same answer.
	write(dir, { "ssqch.config.js": "export default function (config) { config.addPassthroughCopy(\"src/fonts\"); return {}; }\n" });
	let r = ssqch(["build", "--root", d]);
	assert.ok(!r.ok && r.log.includes("the config function's argument has no addPassthroughCopy()"), r.log);
	// So does a folder with another generator's config and none of ssqch's.
	fs.rmSync(path.join(dir, "ssqch.config.js"));
	write(dir, { ".eleventy.js": "module.exports = {};\n" });
	r = ssqch(["build", "--root", d, "--format", "json"]);
	assert.ok(r.ok && r.stderr === "", r.stderr);
	const report = JSON.parse(r.stdout);
	assert.equal(report.warnings[0].code, "other-generator", r.stdout);
	assert.ok(report.warnings[0].message.startsWith("this folder has an Eleventy config (.eleventy.js) and no ssqch.config.js"), r.stdout);
	// DELIBERATE (0.11): it names `ssqch scout`, which replaced `ssqch import`.
	assert.ok(report.warnings[0].message.includes("`ssqch scout` lists what moving it takes and drafts a config (`--write-draft`)"), r.stdout);
});
