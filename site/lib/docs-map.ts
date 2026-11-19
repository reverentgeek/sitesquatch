// Which README sections make which docs page, in the sidebar's order and groups. lib/split.ts
// writes the pages from it before each build (the README stays the one source until the docs
// move: TODO.md, section 9), and the sidebar, previous and next, and the docs' front page follow
// its order.
//
// A page is one or more README sections, by heading, each with the sections under it, except
// those another page takes. A page of one section takes its heading as its title. A page of
// several needs a `title`, and each section keeps its heading. `nav` is the sidebar's shorter
// name. A page with `file` is a Markdown file of its own (the trailheads), and one with neither
// `from` nor `file` is a template in src/ (the reference).

export interface DocsPage {
	/** The page's address below /docs/: "install", "trailheads/from-zola", or "" for /docs/ itself. */
	slug: string;
	/** README headings, without the #s. */
	from?: string[];
	/** A file of its own, from the repository's root. */
	file?: string;
	title?: string;
	nav?: string;
	/** The `ssqch docs` command that prints the page, when it isn't `ssqch docs "<heading>"`. */
	command?: string;
}

export interface DocsGroup {
	title: string;
	pages: DocsPage[];
}

const trailhead = (name: string, label: string, from: string): DocsPage => ({ slug: `trailheads/from-${name}`, file: `docs/trailheads/from-${name}.md`, nav: `From ${label}`, command: `ssqch docs --from ${from}` });

export const DOCS: DocsGroup[] = [
	{
		title: "Start here",
		pages: [
			{ slug: "", from: ["SiteSquatch"], title: "The SiteSquatch docs", nav: "Introduction", command: "ssqch docs" },
			{ slug: "install", from: ["Install"] },
			{ slug: "field-guide", from: ["Field guide: build your first site"], nav: "Field guide" },
		],
	},
	{
		title: "Build",
		pages: [
			{ slug: "configuring", from: ["Configuring a site"] },
			{ slug: "data-files", from: ["JavaScript data files"], nav: "Data files" },
			{ slug: "plugins", from: ["Built-in plugins"] },
			{ slug: "templates", from: ["Templates and data"] },
			{ slug: "markdown", from: ["Markdown"] },
			{ slug: "template-languages", from: ["Jinja and Nunjucks", "Edge", "Liquid", "Handlebars and Mustache", "EJS"], title: "Template languages" },
			{ slug: "css-and-javascript", from: ["CSS and JavaScript"] },
			{ slug: "multilingual", from: ["Multilingual sites: translations, i18n and hreflang"], nav: "Multilingual sites" },
			{ slug: "seo", from: ["SEO tags"] },
			{ slug: "themes", from: ["Themes"] },
			{ slug: "new-pages", from: ["Starting a new page"] },
		],
	},
	{
		title: "Check",
		pages: [
			{ slug: "content-schemas", from: ["Content schemas"] },
			{ slug: "where-values-come-from", from: ["Where a value comes from"] },
			{ slug: "build-summary", from: ["Reading the build summary"] },
			{ slug: "comparing-builds", from: ["Comparing two builds"] },
			{ slug: "footprint", from: ["A build's footprint"] },
		],
	},
	{
		title: "Ship",
		pages: [
			{ slug: "deploying", from: ["Deploying"] },
			{ slug: "netlify", from: ["Netlify"], nav: "Netlify" },
			{ slug: "github-pages", from: ["GitHub Pages"], nav: "GitHub Pages" },
			{ slug: "agents", from: ["Scripts and coding agents"] },
			{ slug: "rust-plugins", from: ["Plugins in Rust"] },
		],
	},
	{
		title: "Trailheads",
		pages: [
			{ slug: "trailheads", from: ["Trailheads: moving from another generator"], nav: "Moving to ssqch" },
			trailhead("eleventy", "Eleventy", "eleventy"),
			trailhead("jekyll", "Jekyll", "jekyll"),
			trailhead("zola", "Zola", "zola"),
			trailhead("docusaurus", "Docusaurus", "docusaurus"),
			trailhead("mkdocs", "MkDocs", "mkdocs"),
			trailhead("hexo", "Hexo", "hexo"),
			trailhead("component-frameworks", "Astro, VitePress, Next.js, Gatsby", "astro"),
		],
	},
	{
		title: "Reference",
		pages: [
			{ slug: "reference", title: "Every name", command: "ssqch docs" },
			{ slug: "benchmarks", from: ["Benchmarks"] },
			{ slug: "known-gaps", from: ["Known gaps"] },
		],
	},
];

/** The README sections the site leaves on GitHub. */
export const NOT_ON_THE_SITE = ["Working on SiteSquatch"];

export const url = (slug: string) => (slug === "" ? "/docs/" : `/docs/${slug}/`);
