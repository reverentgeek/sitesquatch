//! Other generators' words, and ssqch's name for the same thing.
//!
//! When someone (or a coding agent) arriving from another generator types
//! its command, flag, config option, front-matter key or filter, ssqch
//! refuses it as before, and says its own name for it and where to read
//! more, so the right spelling is learned on the first try. It teaches and
//! never accepts: no word here starts working. A word ssqch has itself is
//! never in the table.
//!
//! The table is curated: the words people and agents reach for, from the
//! trailheads (migration guides) in `docs/trailheads/`, not every option of every generator.
//! Each row is tested: the word is refused, and the name it gives exists.

/// Where a word can turn up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `ssqch dev`.
    Command,
    /// `ssqch build --drafts`.
    Flag,
    /// `pathPrefix: "/x/"` in the config, or `config.addPassthroughCopy()`.
    Config,
    /// `eleventyComputed:` in front matter.
    FrontMatter,
    /// `{{ title | slugify }}` in a template.
    Filter,
    /// `{{ eleventy.generator }}` in a template: data another generator provides.
    Global,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Command => "command",
            Kind::Flag => "flag",
            Kind::Config => "config",
            Kind::FrontMatter => "frontMatter",
            Kind::Filter => "filter",
            Kind::Global => "global",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Equivalent {
    /// The other generator's word, as it's typed (`dev`, `--drafts`, `pathPrefix`).
    pub word: &'static str,
    pub kind: Kind,
    /// Whose word it is. Empty for a word half the ecosystem uses (`dev`).
    pub from: &'static [&'static str],
    /// ssqch's name for it: a command, flag, config option, front-matter key
    /// or function, which the tests check ssqch has.
    pub ssqch: &'static str,
    /// What to say: ssqch's way, written out.
    pub say: &'static str,
    /// Where to read more: an `ssqch docs` lookup (which the tests check
    /// answers), or a command's `--help` for a flag.
    pub more: &'static str,
}

const SERVE: &str = "ssqch's dev server is `ssqch serve`: it builds, watches and reloads the browser.";

/// The table. Words are matched exactly (flags with their dashes).
pub const TABLE: &[Equivalent] = &[
    // Commands.
    Equivalent { word: "dev", kind: Kind::Command, from: &[], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "start", kind: Kind::Command, from: &[], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "server", kind: Kind::Command, from: &["Hugo", "Hexo", "Jekyll"], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "preview", kind: Kind::Command, from: &[], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "watch", kind: Kind::Command, from: &[], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "check", kind: Kind::Command, from: &["Zola", "Astro"], ssqch: "build", say: "`ssqch build` checks as it builds: content schemas on every build, and internal links with `linksPlugin()`.", more: "ssqch docs \"Content schemas\"" },
    Equivalent { word: "clean", kind: Kind::Command, from: &["Hexo", "Jekyll", "Gatsby"], ssqch: "leaveNoTrace", say: "ssqch has no clean command: `leaveNoTrace: true` in the config deletes what an earlier build wrote and this one didn't.", more: "ssqch docs leaveNoTrace" },
    Equivalent { word: "generate", kind: Kind::Command, from: &["Hexo"], ssqch: "build", say: "To build the site: `ssqch build`.", more: "ssqch docs build" },
    Equivalent { word: "version", kind: Kind::Command, from: &["Hugo"], ssqch: "--version", say: "The version is `ssqch --version`.", more: "ssqch --help" },
    Equivalent { word: "deploy", kind: Kind::Command, from: &["Hexo"], ssqch: "build", say: "ssqch doesn't deploy: `ssqch build` writes the site, and your host serves the output folder.", more: "ssqch docs Deploying" },
    // Flags.
    Equivalent { word: "--watch", kind: Kind::Flag, from: &["Eleventy", "Jekyll"], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "--serve", kind: Kind::Flag, from: &["Eleventy"], ssqch: "serve", say: SERVE, more: "ssqch docs serve" },
    Equivalent { word: "--drafts", kind: Kind::Flag, from: &["Jekyll"], ssqch: "--env", say: "Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.", more: "ssqch docs draft" },
    Equivalent { word: "-D", kind: Kind::Flag, from: &["Hugo"], ssqch: "--env", say: "Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.", more: "ssqch docs draft" },
    Equivalent { word: "--buildDrafts", kind: Kind::Flag, from: &["Hugo"], ssqch: "--env", say: "Drafts (`draft: true`) are built with `--env development`, as `ssqch serve` does, and left out of production builds.", more: "ssqch docs draft" },
    Equivalent { word: "-d", kind: Kind::Flag, from: &["Hugo", "Jekyll"], ssqch: "--output", say: "The output folder is `-o, --output DIR` (or `dirs.output` in the config).", more: "ssqch build --help" },
    Equivalent { word: "--destination", kind: Kind::Flag, from: &["Hugo", "Jekyll"], ssqch: "--output", say: "The output folder is `-o, --output DIR` (or `dirs.output` in the config).", more: "ssqch build --help" },
    Equivalent { word: "--input", kind: Kind::Flag, from: &["Eleventy"], ssqch: "--root", say: "The input folder is `dirs.input` in the config; `--root DIR` is the project folder (where the config is).", more: "ssqch build --help" },
    Equivalent { word: "--pathprefix", kind: Kind::Flag, from: &["Eleventy"], ssqch: "--base", say: "The path a site is served under is `--base /repo/` (or `base` in the config).", more: "ssqch docs base" },
    Equivalent { word: "--baseURL", kind: Kind::Flag, from: &["Hugo"], ssqch: "--base", say: "The path a site is served under is `--base /repo/` (or `base` in the config); the domain isn't needed.", more: "ssqch docs base" },
    Equivalent { word: "--minify", kind: Kind::Flag, from: &["Hugo"], ssqch: "minifyPlugin", say: "Minifying is `minifyPlugin()` from \"ssqch/minify\", in the config's `plugins`.", more: "ssqch docs minifyPlugin" },
    Equivalent { word: "--incremental", kind: Kind::Flag, from: &["Eleventy", "Jekyll"], ssqch: "serve", say: "There's nothing to turn on: a whole build is quick, and `ssqch serve` reloads only the pages that changed.", more: "ssqch docs serve" },
    Equivalent { word: "--kind", kind: Kind::Flag, from: &["Hugo"], ssqch: "--blueprint", say: "What Hugo calls an archetype is a blueprint in ssqch: `ssqch new posts/pine.md --blueprint notes` starts from `_blueprints/notes.md`.", more: "ssqch new --help" },
    Equivalent { word: "--template", kind: Kind::Flag, from: &[], ssqch: "--starter", say: "`ssqch init --starter site|docs` picks the starter, and `--engine` its template language.", more: "ssqch init --help" },
    // Config options (and the methods of a config written as calls).
    Equivalent { word: "pathPrefix", kind: Kind::Config, from: &["Eleventy"], ssqch: "base", say: "In ssqch it's `base`: base: \"/repo/\".", more: "ssqch docs base" },
    Equivalent { word: "dir", kind: Kind::Config, from: &["Eleventy"], ssqch: "dirs", say: "In ssqch it's `dirs`: dirs: { input: \"src\", output: \"dist\" }.", more: "ssqch docs dirs" },
    Equivalent { word: "publishDir", kind: Kind::Config, from: &["Hugo"], ssqch: "dirs", say: "The output folder is `dirs.output`: dirs: { output: \"public\" }.", more: "ssqch docs dirs" },
    Equivalent { word: "outDir", kind: Kind::Config, from: &["Astro", "VitePress"], ssqch: "dirs", say: "The output folder is `dirs.output`: dirs: { output: \"dist\" }.", more: "ssqch docs dirs" },
    Equivalent { word: "integrations", kind: Kind::Config, from: &["Astro"], ssqch: "plugins", say: "In ssqch it's `plugins`: plugins: [imagePlugin()].", more: "ssqch docs plugins" },
    Equivalent { word: "markdownTemplateEngine", kind: Kind::Config, from: &["Eleventy"], ssqch: "markdownEngine", say: "In ssqch it's `markdownEngine`: markdownEngine: \"njk\" (or false).", more: "ssqch docs markdownEngine" },
    Equivalent { word: "htmlTemplateEngine", kind: Kind::Config, from: &["Eleventy"], ssqch: "htmlEngine", say: "In ssqch it's `htmlEngine`: htmlEngine: \"njk\" (or false).", more: "ssqch docs htmlEngine" },
    Equivalent { word: "baseURL", kind: Kind::Config, from: &["Hugo"], ssqch: "base", say: "ssqch's `base` is the path only (base: \"/repo/\"); the site's full URL goes in your data, for sitemapPlugin({ url }).", more: "ssqch docs base" },
    Equivalent { word: "title", kind: Kind::Config, from: &["Hugo", "Zola", "Jekyll"], ssqch: "data", say: "The site's title is data: put it in `_data/site.json` and use `site.title` in templates.", more: "ssqch docs data" },
    Equivalent { word: "addPassthroughCopy", kind: Kind::Config, from: &["Eleventy"], ssqch: "passthrough", say: "In ssqch it's `passthrough`: passthrough: [\"src/fonts\", { \"src/static\": \"static\" }].", more: "ssqch docs passthrough" },
    Equivalent { word: "addFilter", kind: Kind::Config, from: &["Eleventy"], ssqch: "filters", say: "In ssqch it's `filters`: filters: { shout: (s) => s.toUpperCase() }.", more: "ssqch docs filters" },
    Equivalent { word: "addShortcode", kind: Kind::Config, from: &["Eleventy"], ssqch: "filters", say: "A shortcode is a function in `filters`: filters: { year: () => String(new Date().getFullYear()) }.", more: "ssqch docs filters" },
    Equivalent { word: "addCollection", kind: Kind::Config, from: &["Eleventy"], ssqch: "collections", say: "In ssqch it's `collections`: collections: { posts: (pages) => pages.byTag(\"post\") }.", more: "ssqch docs collections" },
    Equivalent { word: "addTransform", kind: Kind::Config, from: &["Eleventy"], ssqch: "transforms", say: "In ssqch it's `transforms`: transforms: { tidy: (content, page) => content }.", more: "ssqch docs transforms" },
    Equivalent { word: "addGlobalData", kind: Kind::Config, from: &["Eleventy"], ssqch: "data", say: "In ssqch it's `data`: data: { buildTime: () => new Date() }.", more: "ssqch docs data" },
    Equivalent { word: "addWatchTarget", kind: Kind::Config, from: &["Eleventy"], ssqch: "watch", say: "In ssqch it's `watch`: watch: [\"src/assets/\"].", more: "ssqch docs watch" },
    Equivalent { word: "addPlugin", kind: Kind::Config, from: &["Eleventy"], ssqch: "plugins", say: "In ssqch it's `plugins`: plugins: [rssPlugin()].", more: "ssqch docs plugins" },
    Equivalent { word: "setTemplateFormats", kind: Kind::Config, from: &["Eleventy"], ssqch: "templateFormats", say: "In ssqch it's `templateFormats`: templateFormats: [\"njk\", \"md\"].", more: "ssqch docs templateFormats" },
    // Front-matter keys that can't be a site's own.
    Equivalent { word: "eleventyComputed", kind: Kind::FrontMatter, from: &["Eleventy"], ssqch: "computed", say: "ssqch's name is `computed`, so these values aren't computed.", more: "ssqch docs computed" },
    Equivalent { word: "eleventyExcludeFromCollections", kind: Kind::FrontMatter, from: &["Eleventy"], ssqch: "excludeFromCollections", say: "ssqch's name is `excludeFromCollections`, so the page is still in its collections.", more: "ssqch docs excludeFromCollections" },
    Equivalent { word: "eleventyNavigation", kind: Kind::FrontMatter, from: &["Eleventy"], ssqch: "nav", say: "ssqch's name is `nav` (with `pagesTree` and `navTree`), so it isn't in the navigation.", more: "ssqch docs nav" },
    Equivalent { word: "templateEngineOverride", kind: Kind::FrontMatter, from: &["Eleventy"], ssqch: "render", say: "ssqch's name is `render`, for example render: [njk, md].", more: "ssqch docs render" },
    Equivalent { word: "redirect_from", kind: Kind::FrontMatter, from: &["Jekyll"], ssqch: "aliases", say: "ssqch's name is `aliases`, with `redirectsPlugin()` from \"ssqch/redirects\", so no redirect is made.", more: "ssqch docs aliases" },
    Equivalent { word: "published", kind: Kind::FrontMatter, from: &["Jekyll"], ssqch: "draft", say: "`published: false` doesn't hold a page back in ssqch, so it's published: use `draft: true`.", more: "ssqch docs draft" },
    // Filters.
    Equivalent { word: "url", kind: Kind::Filter, from: &["Eleventy"], ssqch: "base", say: "There's nothing to write: the build adds `base` to every URL from the site's root, so `href=\"/about/\"` works as it is (use `withBase()` outside HTML attributes).", more: "ssqch docs base" },
    Equivalent { word: "relative_url", kind: Kind::Filter, from: &["Jekyll"], ssqch: "base", say: "There's nothing to write: the build adds `base` to every URL from the site's root, so `href=\"/about/\"` works as it is (use `withBase()` outside HTML attributes).", more: "ssqch docs base" },
    Equivalent { word: "absolute_url", kind: Kind::Filter, from: &["Jekyll"], ssqch: "absoluteUrl", say: "`absoluteUrl(url, base)` comes with `rssPlugin()` from \"ssqch/rss\".", more: "ssqch docs absoluteUrl" },
    Equivalent { word: "slugify", kind: Kind::Filter, from: &["Eleventy"], ssqch: "filters", say: "This template language has no `slugify`: add one to the config's `filters` (Liquid has it built in).", more: "ssqch docs filters" },
    Equivalent { word: "markdownify", kind: Kind::Filter, from: &["Jekyll", "Hugo"], ssqch: "markdown", say: "ssqch's function is `markdown(text)` (or `markdown(text, \"inline\")`).", more: "ssqch docs markdown" },
    Equivalent { word: "jsonify", kind: Kind::Filter, from: &["Jekyll"], ssqch: "dump", say: "Jinja's is `tojson` (`dump` in Nunjucks); Liquid's is `json`.", more: "ssqch docs \"Jinja and Nunjucks\"" },
    // Template globals: the word as it's written in template code.
    Equivalent { word: "eleventy.", kind: Kind::Global, from: &["Eleventy"], ssqch: "ssqch", say: "ssqch's is `ssqch`: `ssqch.generator`, `ssqch.version`, `ssqch.env` and `ssqch.serving`, so this prints nothing.", more: "ssqch docs ssqch.generator" },
    Equivalent { word: "site.posts", kind: Kind::Global, from: &["Jekyll"], ssqch: "collections", say: "ssqch's lists of pages are `collections`: `collections.posts` is the pages tagged `posts`, so this is empty.", more: "ssqch docs collections" },
    Equivalent { word: "site.pages", kind: Kind::Global, from: &["Jekyll"], ssqch: "collections", say: "ssqch's lists of pages are `collections`: `collections.all` is every page, so this is empty.", more: "ssqch docs collections" },
];

/// The row for `word` of `kind`.
pub fn find(word: &str, kind: Kind) -> Option<&'static Equivalent> {
    TABLE.iter().find(|e| e.word == word && e.kind == kind)
}

impl Equivalent {
    /// `"pathPrefix" (Eleventy)`, naming the generator only when the word is one generator's.
    pub fn named(&self) -> String {
        match self.from {
            [one] => format!("{} ({})", self.word, one),
            _ => self.word.to_string(),
        }
    }

    /// The hint as it's printed under an error: the equivalent, then where to read more.
    pub fn hint(&self) -> String {
        format!("{}\nMore: {}", self.say, self.more)
    }

    /// The hint as data, for the JSON report.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "word": self.word, "kind": self.kind.as_str(), "use": self.ssqch, "from": self.from, "more": self.more })
    }
}

/// The row whose sentence `message` contains, for the JSON report of an
/// error whose text was built from it.
pub fn in_message(message: &str) -> Option<&'static Equivalent> {
    TABLE.iter().find(|e| message.contains(e.say))
}

/// Another generator's config, in a folder without ssqch's: (file, generator,
/// importer, the trailhead in `docs/trailheads/` that `ssqch docs --from` prints).
pub const OTHER_CONFIGS: &[(&str, &str, Option<&str>, Option<&str>)] = &[
    (".eleventy.js", "Eleventy", Some("eleventy"), Some("from-eleventy.md")),
    ("eleventy.config.js", "Eleventy", Some("eleventy"), Some("from-eleventy.md")),
    ("eleventy.config.mjs", "Eleventy", Some("eleventy"), Some("from-eleventy.md")),
    ("eleventy.config.cjs", "Eleventy", Some("eleventy"), Some("from-eleventy.md")),
    ("hugo.toml", "Hugo", None, None),
    ("hugo.yaml", "Hugo", None, None),
    ("hugo.json", "Hugo", None, None),
    ("mkdocs.yml", "MkDocs", None, Some("from-mkdocs.md")),
    ("docusaurus.config.js", "Docusaurus", None, Some("from-docusaurus.md")),
    ("docusaurus.config.ts", "Docusaurus", None, Some("from-docusaurus.md")),
    ("astro.config.mjs", "Astro", None, Some("from-component-frameworks.md")),
    ("astro.config.ts", "Astro", None, Some("from-component-frameworks.md")),
    ("gatsby-config.js", "Gatsby", None, Some("from-component-frameworks.md")),
    (".vitepress/config.mts", "VitePress", None, Some("from-component-frameworks.md")),
    (".vitepress/config.js", "VitePress", None, Some("from-component-frameworks.md")),
];

/// What to say about a folder that has another generator's config and none of
/// ssqch's: the generator's name, and the importer or guide for it.
pub fn other_generator(root: &std::path::Path) -> Option<String> {
    let found = OTHER_CONFIGS.iter().find(|(file, ..)| root.join(file).is_file()).copied().or_else(|| {
        // `config.toml` is Zola's (with `base_url`) or an older Hugo's (with `baseURL`); `_config.yml` is Jekyll's or Hexo's.
        let read = |file: &str| std::fs::read_to_string(root.join(file)).ok();
        if let Some(text) = read("config.toml") {
            if text.contains("base_url") {
                return Some(("config.toml", "Zola", Some("zola"), Some("from-zola.md")));
            }
            if text.contains("baseURL") {
                return Some(("config.toml", "Hugo", None, None));
            }
        }
        read("_config.yml").map(|_| {
            let hexo = read("package.json").is_some_and(|p| p.contains("\"hexo\""));
            if hexo { ("_config.yml", "Hexo", None, Some("from-hexo.md")) } else { ("_config.yml", "Jekyll", None, None) }
        })
    })?;
    let (file, generator, importer, _) = found;
    let docs = format!("`ssqch docs --from {}` says what maps to what", generator.to_lowercase());
    let next = match importer {
        Some(importer) => format!("`ssqch import {}` drafts one from it, and {}", importer, docs),
        None => format!("`ssqch init` starts one, and {}", docs),
    };
    let article = if generator.starts_with(['A', 'E', 'I', 'O', 'U']) { "an" } else { "a" };
    Some(format!("this folder has {} {} config ({}) and no ssqch.config.js, so ssqch builds it with its own defaults. {}.", article, generator, file, next))
}
