//! The `ssqch` binary's command line.

use std::process::Command;

#[test]
fn version_names_the_binary() {
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).arg("--version").output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout), format!("ssqch {}\n", env!("CARGO_PKG_VERSION")));
}

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ssqch-cli-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn ssqch(args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(args).env("TZ", "UTC").output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

#[test]
fn init_creates_a_site_that_builds() {
    let dir = temp_dir("init");
    let d = dir.to_str().unwrap();
    let (ok, log) = ssqch(&["init", d]);
    assert!(ok, "{}", log);
    for file in ["ssqch.config.js", "src/_includes/layout.edge", "src/index.edge", "src/posts/hello-world.md", "src/_data/site.json", "ssqch.d.ts", "jsconfig.json", ".gitignore"] {
        assert!(dir.join(file).is_file(), "{} wasn't created:\n{}", file, log);
    }
    assert!(log.contains("Next: cd "), "{}", log);

    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Links   3 checked, 0 broken"), "{}", log);
    let home = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
    assert!(home.contains("<a href=\"/posts/hello-world/\">Hello, world</a> (January 1, 2026)"), "{}", home);

    // Running it again keeps what's there.
    std::fs::write(dir.join("src/index.edge"), "mine").unwrap();
    let (ok, log) = ssqch(&["init", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Nothing to do"), "{}", log);
    assert_eq!(std::fs::read_to_string(dir.join("src/index.edge")).unwrap(), "mine");
}

#[test]
fn init_starts_a_site_in_each_engine() {
    for engine in ["liquid", "njk", "hbs"] {
        let dir = temp_dir(&format!("init-{}", engine));
        let d = dir.to_str().unwrap();
        let (ok, log) = ssqch(&["init", d, "--engine", engine]);
        assert!(ok, "{}", log);
        for file in [format!("src/_includes/layout.{}", engine), format!("src/index.{}", engine)] {
            assert!(dir.join(&file).is_file(), "{} wasn't created:\n{}", file, log);
        }
        assert!(!dir.join("src/index.edge").exists(), "{}", engine);
        let config = std::fs::read_to_string(dir.join("ssqch.config.js")).unwrap();
        assert!(config.contains(&format!("templateFormats: [\"{}\", \"md\"]", engine)), "{}", config);

        let (ok, log) = ssqch(&["build", "--root", d]);
        assert!(ok, "{}: {}", engine, log);
        assert!(log.contains("Links   3 checked, 0 broken"), "{}: {}", engine, log);
        let home = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
        assert!(home.contains("<a href=\"/posts/hello-world/\">Hello, world</a> (January 1, 2026)"), "{}: {}", engine, home);
        assert!(home.contains("<title>My Squatch Site</title>"), "{}: {}", engine, home);
        let post = std::fs::read_to_string(dir.join("dist/posts/hello-world/index.html")).unwrap();
        assert!(post.contains("<title>Hello, world | My Squatch Site</title>") && post.contains("<h1>Hello, world</h1>") && post.contains("<code>posts.json</code>"), "{}: {}", engine, post);
        assert!(post.contains(&format!("Built with SiteSquatch {}.", env!("CARGO_PKG_VERSION"))), "{}: {}", engine, post);
    }
}

#[test]
fn init_starts_a_docs_site() {
    let dir = temp_dir("init-docs");
    let d = dir.to_str().unwrap();
    let (ok, log) = ssqch(&["init", d, "--starter", "docs"]);
    assert!(ok, "{}", log);
    for file in ["ssqch.config.js", "src/_data/nav.yml", "src/_includes/doc.edge", "src/assets/docs.css", "src/docs/guides/writing.md", "ssqch.d.ts", ".gitignore"] {
        assert!(dir.join(file).is_file(), "{} wasn't created:\n{}", file, log);
    }
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains(", 0 broken") && !log.contains("warn"), "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    let page = read("docs/guides/writing/index.html");
    for expected in [
        "<title>Writing pages | Squatch Docs</title>",
        "<span>Guides</span> › <span aria-current=\"page\">Writing pages</span>",
        "<a href=\"/docs/guides/writing/\" aria-current=\"page\">Writing pages</a>",
        "<a rel=\"prev\" href=\"/docs/install/\">← Installation</a>",
        "<a rel=\"next\" href=\"/docs/guides/deploying/\">Deploying →</a>",
        "<a href=\"#tabs\">Tabs</a>",
        "<h2 id=\"notes\">Notes <a class=\"anchor\" href=\"#notes\"",
        "<div class=\"tabs\"><section class=\"tab\" data-label=\"npm\"><p class=\"tab-label\">npm</p>",
        "<div class=\"warning\"><p class=\"container-title\">Check twice</p>",
        "<details><summary>How do these work?</summary>",
        "<span class=\"line highlighted\">",
        "this site is called Squatch Docs.",
    ] {
        assert!(page.contains(expected), "missing {:?} in\n{}", expected, page);
    }
    assert!(read("404.html").contains("Page not found") && read("index.html").contains("Read the docs"));
    assert!(dir.join("dist/assets/docs.js").is_file() && dir.join("dist/highlight.css").is_file());

    let other = temp_dir("init-docs-liquid");
    let (ok, log) = ssqch(&["init", other.to_str().unwrap(), "--starter", "docs", "--engine", "liquid"]);
    assert!(!ok && log.contains("--starter docs is written in Edge"), "{}", log);
    let (ok, log) = ssqch(&["init", other.to_str().unwrap(), "--starter", "shop"]);
    assert!(!ok && log.contains("--starter shop: not a starter (use site or docs)"), "{}", log);
    assert!(!other.exists());
}

#[test]
fn init_rejects_an_unknown_engine() {
    let dir = temp_dir("init-pug");
    let (ok, log) = ssqch(&["init", dir.to_str().unwrap(), "--engine", "pug"]);
    assert!(!ok);
    assert!(log.contains("--engine pug: not a starter engine (use edge, liquid, njk, hbs)"), "{}", log);
    assert!(!dir.exists());
}

#[test]
fn development_builds_link_the_assets_a_production_build_left() {
    let dir = temp_dir("assets-after-build");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "import { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [assetsPlugin({ files: [\"/assets/index.css\"] })] };\n").unwrap();
    std::fs::write(dir.join("src/index.html"), "<link rel=\"stylesheet\" href=\"/assets/index.css\"><p>hi</p>").unwrap();
    std::fs::create_dir_all(dir.join("dist/assets")).unwrap();
    std::fs::write(dir.join("dist/assets/index.css"), "p { color: green }").unwrap();

    let (ok, log) = ssqch(&["build", "--root", d, "--env", "production"]);
    assert!(ok, "{}", log);
    let built = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
    let href = built.split("href=\"").nth(1).and_then(|r| r.split('"').next()).unwrap().to_string();
    assert!(href.starts_with("/assets/index.") && href != "/assets/index.css", "{}", built);
    assert!(!dir.join("dist/assets/index.css").exists());

    // `ssqch serve` (a development build) without a CSS watcher links the built copy.
    let (ok, log) = ssqch(&["build", "--root", d, "--env", "development"]);
    assert!(ok, "{}", log);
    let page = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
    assert!(page.contains(&format!("href=\"{}\"", href)), "{}", page);
    assert!(log.contains("pages link to") && log.contains("from the last production build"), "{}", log);

    // Once a watcher writes the plain file, pages link to it.
    std::fs::write(dir.join("dist/assets/index.css"), "p { color: blue }").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "--env", "development"]);
    assert!(ok, "{}", log);
    assert!(std::fs::read_to_string(dir.join("dist/index.html")).unwrap().contains("href=\"/assets/index.css\""));
}

#[test]
fn types_writes_the_declarations() {
    let dir = temp_dir("types");
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("types/ssqch.d.ts");
    let (ok, log) = ssqch(&["types", "--out", out.to_str().unwrap()]);
    assert!(ok, "{}", log);
    let types = std::fs::read_to_string(&out).unwrap();
    for module in ["\"ssqch\"", "\"ssqch/image\"", "\"ssqch/rss\"", "\"ssqch/minify\"", "\"ssqch/assets\"", "\"ssqch/links\""] {
        assert!(types.contains(&format!("declare module {}", module)), "missing {}", module);
    }
    // A glob like `**/README.md` in a doc comment ends the comment early, and
    // the rest of the file stops parsing.
    for (n, line) in types.lines().enumerate() {
        let line = line.trim();
        if line.contains("*/") {
            assert!(line.matches("*/").count() == 1 && line.ends_with("*/"), "ssqch.d.ts line {}: a `*/` inside the comment closes it early: {}", n + 1, line);
        }
    }
}

#[test]
fn render_front_matter_picks_the_engines() {
    let dir = temp_dir("render");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    write("default.md", "---\nname: Bigfoot\n---\nHi {{ name }}\n");
    write("md-only.md", "---\nname: Bigfoot\nrender: md\n---\nHi {{ name }}\n");
    write("chain.md", "---\nname: Bigfoot\nrender: [edge, md]\n---\n*{{ name }}*\n");
    write("raw.md", "---\nrender: false\n---\n*{{ name }}*\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    let read = |name: &str| std::fs::read_to_string(dir.join("_site").join(name).join("index.html")).unwrap();
    assert_eq!(read("default"), "<p>Hi Bigfoot</p>\n");
    assert_eq!(read("md-only"), "<p>Hi {{ name }}</p>\n");
    assert_eq!(read("chain"), "<p><em>Bigfoot</em></p>\n");
    assert_eq!(read("raw"), "*{{ name }}*\n");

    write("old.md", "---\ntemplateEngineOverride: md\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("front matter `templateEngineOverride` is now `render`"), "{}", log);
    std::fs::remove_file(dir.join("old.md")).unwrap();

    write("bad.md", "---\nrender: 3\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("`render` must be an engine name"), "{}", log);
}

#[test]
fn clean_removes_only_stale_files_ssqch_wrote() {
    let dir = temp_dir("clean");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("files")).unwrap();
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    let config = |clean: bool| format!("export default {{ clean: {}, passthrough: \"files\" }};\n", clean);
    write("ssqch.config.js", &config(false));
    write("keep.md", "Keep\n");
    write("gone.md", "Gone\n");
    write("files/old.txt", "old\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    // Another tool (a CSS build, say) writes into the output too.
    std::fs::create_dir_all(dir.join("_site/assets")).unwrap();
    write("_site/assets/index.css", "body{}");

    std::fs::remove_file(dir.join("gone.md")).unwrap();
    std::fs::remove_file(dir.join("files/old.txt")).unwrap();
    let site = dir.join("_site");
    // With clean off, nothing goes.
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(site.join("gone/index.html").is_file() && site.join("files/old.txt").is_file());

    write("ssqch.config.js", &config(true));
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Removed  2 stale files"), "{}", log);
    assert!(!site.join("gone").exists(), "the emptied folder goes too");
    assert!(!site.join("files/old.txt").exists());
    assert!(site.join("keep/index.html").is_file());
    assert!(site.join("assets/index.css").is_file(), "files other tools wrote stay");

    // Nothing stale the next time.
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("Removed"), "{}", log);
}

#[test]
fn the_config_can_define_template_engines() {
    let dir = temp_dir("js-engines");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("_includes")).unwrap();
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    let config = |engines: &str, formats: &str| format!("export default {{ templateFormats: [{}], markdownEngine: \"tmpl\", engines: {{ {} }} }};\n", formats, engines);
    let engines = r#"
        shout: (source) => source.toUpperCase(),
        tmpl: {
            prefix: "~",
            async render(source, data) {
                return this.prefix + source.replace(/\$\{(\w+)\}/g, (_, key) => String(data[key] ?? ""));
            },
        },"#;
    write("ssqch.config.js", &config(engines, "\"shout\", \"tmpl\", \"md\""));
    write("_includes/frame.tmpl", "<frame>${content}</frame>");
    write("loud.shout", "hello, squatch\n");
    write("hi.tmpl", "---\nname: Bigfoot\nlayout: frame\n---\nHi ${name}");
    write("post.md", "---\nname: Bigfoot\n---\n*${name}*\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("_site").join(path)).unwrap();
    assert_eq!(read("loud/index.html"), "HELLO, SQUATCH\n");
    assert_eq!(read("hi/index.html"), "~<frame>~Hi Bigfoot</frame>");
    assert_eq!(read("post/index.html"), "<p>~<em>Bigfoot</em></p>\n");

    // Returning something other than a string names the engine and the file.
    write("ssqch.config.js", &config("shout: () => 42,", "\"shout\""));
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("engine \"shout\" returned number for loud.shout"), "{}", log);

    // Built-in engines can't be replaced.
    write("ssqch.config.js", &config("md: (s) => s,", "\"md\""));
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("engines.md: \"md\" is built in"), "{}", log);
}

#[cfg(feature = "liquid")]
#[test]
fn liquid_templates_get_filters_includes_and_collections() {
    let dir = temp_dir("liquid");
    let d = dir.to_str().unwrap();
    for sub in ["src/_includes", "src/posts"] {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    write(
        "ssqch.config.js",
        "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"liquid\", \"md\", \"edge\"],\n  filters: { shout: (s) => String(s).toUpperCase(), wrap: (s, l, r) => l + s + r },\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n",
    );
    write("src/_includes/base.liquid", "<title>{{ title | shout }}</title>{% include nav.html section=\"home\" %}{{ content }}{% render \"footer\", year: 2026 %}");
    write("src/_includes/nav.html", "<nav>{{ include.section }}</nav>");
    write("src/_includes/footer.liquid", "<footer>{{ year }}</footer>");
    write("src/_includes/edge.edge", "<edge>{{ content }}</edge>");
    write(
        "src/index.liquid",
        "---\nlayout: base\ntitle: Sightings\n---\n{{ collections.posts | size }} {{ \"x\" | wrap: \"[\", \"]\" }} [{{ nope }}{{ page.nope }}]{% for post in collections.posts %} {{ post.data.title | slugify }}@{{ post.date | date: \"%Y-%m-%d\" }}{% endfor %} {{ 3 | plus: 1 }} {{ 2.5 }}",
    );
    write("src/edge-layout.liquid", "---\nlayout: edge\n---\n{{ \"liquid\" | upcase }}");
    write("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ntags: post\ndate: 2026-01-02\nlayout: base\n---\n*{{ title }}*\n");
    write("src/posts/brittle.md", "---\ntitle: Bigfoot Brittle\ntags: post\ndate: 2026-03-04\nrender: [liquid, md]\n---\n{{ title | downcase }}\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    assert_eq!(read("index.html"), "<title>SIGHTINGS</title><nav>home</nav>2 [x] [] pine-cone-crunch@2026-01-02 bigfoot-brittle@2026-03-04 4 2.5<footer>2026</footer>");
    assert_eq!(read("edge-layout/index.html"), "<edge>LIQUID</edge>");
    // Markdown runs through Edge first by default; a Liquid layout wraps it.
    assert_eq!(read("posts/pine/index.html"), "<title>PINE CONE CRUNCH</title><nav>home</nav><p><em>Pine Cone Crunch</em></p>\n<footer>2026</footer>");
    assert_eq!(read("posts/brittle/index.html"), "<p>bigfoot brittle</p>\n");

    // Liquid errors name the template.
    write("src/broken.liquid", "{% if %}");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("broken.liquid"), "{}", log);
}

#[cfg(feature = "jinja")]
#[test]
fn nunjucks_templates_get_filters_includes_and_collections() {
    let dir = temp_dir("nunjucks");
    let d = dir.to_str().unwrap();
    for sub in ["src/_includes", "src/posts"] {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    write(
        "ssqch.config.js",
        "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"njk\", \"jinja\", \"md\"],\n  filters: { shout: (s) => String(s).toUpperCase(), year: (d) => d.getUTCFullYear() },\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n",
    );
    write("src/_includes/base.njk", "<title>{{ title | shout }}</title>{% include \"nav.njk\" %}{{ content }}");
    write("src/_includes/nav.njk", "<nav>{% for p in collections.posts %}<a href=\"{{ p.url }}\">{{ p.data.title }}</a>{% endfor %}</nav>");
    write("src/_includes/frame.jinja", "<main>{% block body %}{% endblock %}</main>");
    write(
        "src/index.njk",
        "---\nlayout: base.njk\ntitle: Sightings <&>\n---\n{{ title }} {{ shout(\"fn\") }} [{{ nope }}{{ nope.deeper }}] {% for p in collections.posts %}{{ p.date | year }}{% endfor %}{% if false %}{% elseif true %} elseif{% endif %}{% set o = {\"a\": 1} %}{% for k, v in o %} {{ k }}={{ v }}{% endfor %} {{ \"the quick fox\" | truncate(9) }}",
    );
    write("src/extends.jinja", "{% extends \"frame.jinja\" %}{% block body %}{{ \"<b>\" | safe }}{% endblock %}");
    write("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ntags: post\ndate: 2026-01-02\nrender: [njk, md]\n---\n*{{ title | lower }}*\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    assert_eq!(read("index.html"), "<title>SIGHTINGS &lt;&amp;&gt;</title><nav><a href=\"/posts/pine/\">Pine Cone Crunch</a></nav>Sightings &lt;&amp;&gt; FN [] 2026 elseif a=1 the...");
    assert_eq!(read("extends/index.html"), "<main><b></main>");
    assert_eq!(read("posts/pine/index.html"), "<p><em>pine cone crunch</em></p>\n");

    // Errors name the template and line.
    write("src/broken.njk", "ok\n{% if %}");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("broken.njk:2: syntax error"), "{}", log);
}

#[cfg(feature = "handlebars")]
#[test]
fn handlebars_and_mustache_templates_render() {
    let dir = temp_dir("handlebars");
    let d = dir.to_str().unwrap();
    for sub in ["src/_includes", "src/posts"] {
        std::fs::create_dir_all(dir.join(sub)).unwrap();
    }
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    write(
        "ssqch.config.js",
        "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"hbs\", \"mustache\", \"md\"],\n  filters: { shout: (s) => String(s).toUpperCase(), wrap: (s, l, r) => l + s + r, opts: (s, o) => s + o.size },\n  collections: { posts: (pages) => pages.byTag(\"post\") },\n};\n",
    );
    write("src/_includes/base.hbs", "<title>{{shout title}}</title>{{> nav}}{{{content}}}");
    write("src/_includes/nav.hbs", "<nav>{{#each collections.posts}}<a href=\"{{this.url}}\">{{this.data.title}}</a>{{/each}}</nav>");
    write("src/index.hbs", "---\nlayout: base.hbs\ntitle: Sightings <&>\n---\n{{title}} {{{title}}} [{{nope}}{{nope.deeper}}] {{wrap \"x\" \"[\" \"]\"}} {{opts \"o\" size=2}} {{len collections.posts}}{{^nothing}} none{{/nothing}}");
    write("src/list.mustache", "---\nname: Squatch\nitems: [a, b]\nflag: true\n---\nHi {{name}}{{#items}} {{.}}{{/items}}{{#flag}} yes{{/flag}}{{#missing}} no{{/missing}}{{^missing}} empty{{/missing}}");
    write("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ntags: post\ndate: 2026-01-02\nlayout: base.hbs\n---\n*hi*\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    assert_eq!(read("index.html"), "<title>SIGHTINGS &lt;&amp;&gt;</title><nav><a href=\"/posts/pine/\">Pine Cone Crunch</a></nav>Sightings &lt;&amp;&gt; Sightings <&> [] [x] o2 1 none");
    assert_eq!(read("list/index.html"), "Hi Squatch a b yes empty");
    assert_eq!(read("posts/pine/index.html"), "<title>PINE CONE CRUNCH</title><nav><a href=\"/posts/pine/\">Pine Cone Crunch</a></nav><p><em>hi</em></p>\n");

    write("src/broken.hbs", "ok\n{{#if}}");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("broken.hbs"), "{}", log);
}

#[test]
fn markdown_options_hooks_containers_and_headings() {
    let dir = temp_dir("markdown");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write(
        "ssqch.config.js",
        "import { defineConfig, markdown } from \"ssqch\";\nexport default defineConfig({\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"edge\", \"md\", \"njk\", \"liquid\"],\n  markdown: { headingIds: \"blackfriday\", smartPunctuation: true },\n  data: { blurb: markdown(\"Made with *care*\", { inline: true }) },\n});\n",
    );
    write("src/_includes/doc.edge", "<nav>{{{ toc(page.headings, { to: 4 }) }}}</nav>\n<p>{{{ blurb }}}</p>\n<main>{{{ content }}}</main>\n");
    write("src/_includes/hooks/heading.liquid", "<h{{ heading.level }} id=\"{{ heading.id }}\">{{ heading.content }} <a href=\"#{{ heading.id }}\" aria-hidden=\"true\">#</a></h{{ heading.level }}>\n");
    write("src/_includes/hooks/fence-mermaid.edge", "<pre class=\"mermaid\" data-info=\"{{ fence.info }}\">{{ fence.code }}</pre>\n");
    write("src/_includes/containers/warning.njk", "<aside class=\"warning\" data-page=\"{{ title }}\"><strong>{{ container.args or \"Warning\" }}</strong>\n{{ container.content | safe }}</aside>\n");
    write(
        "src/docs/intro.md",
        "---\ntitle: Intro\nlayout: doc.edge\n---\n# Getting started\n\nSome \"quotes\" -- and a note.[^1] See https://example.com.\n\n## Install it {#setup}\n\n::: warning Careful\nDon't eat the *pine* cones.\n:::\n\n> [!TIP]\n> Use {{ title }}.\n\n### What's next?\n\n```mermaid {theme=dark}\ngraph TD\n```\n\n{{{ markdown(\"**bold**\", \"inline\") }}}\n\n[^1]: The note.\n",
    );
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let page = std::fs::read_to_string(dir.join("dist/docs/intro/index.html")).unwrap();
    for expected in [
        "<nav><ul><li><a href=\"#setup\">Install it</a><ul><li><a href=\"#what-s-next\">What’s next?</a></li></ul></li></ul></nav>",
        "<p>Made with <em>care</em></p>",
        "<h1 id=\"getting-started\">Getting started <a href=\"#getting-started\" aria-hidden=\"true\">#</a></h1>",
        "<p>Some “quotes” – and a note.<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup> See <a href=\"https://example.com\">https://example.com</a>.</p>",
        "<aside class=\"warning\" data-page=\"Intro\"><strong>Careful</strong>\n<p>Don’t eat the <em>pine</em> cones.</p>\n</aside>",
        "<div class=\"markdown-alert markdown-alert-tip\">\n<p class=\"markdown-alert-title\">Tip</p>\n<p>Use Intro.</p>\n</div>",
        "<pre class=\"mermaid\" data-info=\"mermaid {theme=dark}\">graph TD\n</pre>",
        "<p><strong>bold</strong></p>",
        "<li id=\"fn-1\">\n<p>The note. <a href=\"#fnref-1\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a></p>\n</li>",
    ] {
        assert!(page.contains(expected), "missing {:?} in\n{}", expected, page);
    }

    // Mistakes name the option or the file.
    write("ssqch.config.js", "export default { markdown: { footnote: false } };\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("markdown.footnote isn't an option (options: headingIds,"), "{}", log);
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" } };\n");
    write("src/_includes/hooks/link.pug", "a");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("_includes/hooks/link.pug: no template engine named `pug`"), "{}", log);
}

#[test]
fn markdown_highlights_code_and_writes_the_stylesheet() {
    let dir = temp_dir("highlight");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("src/_includes/hooks")).unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { dirs: { input: \"src\", output: \"dist\" }, markdown: { highlight: { css: \"/assets/code.css\" } } };\n").unwrap();
    std::fs::write(dir.join("src/index.md"), "```js {2}\nconst a = 1;\nlet b = \"two\";\n```\n\n```nonsense\n<x>\n```\n\n```diagram\nA -> B\n```\n").unwrap();
    std::fs::write(dir.join("src/_includes/hooks/fence-diagram.edge"), "<figure data-lang=\"{{ fence.lang }}\">{{ fence.highlighted ?? fence.code }}</figure>\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let page = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
    assert_eq!(
        page,
        "<pre class=\"highlight\"><code class=\"language-js\"><span class=\"line\"><span class=\"hl-keyword\">const</span> a <span class=\"hl-operator\">=</span> <span class=\"hl-number\">1</span>;</span>\n\
         <span class=\"line highlighted\"><span class=\"hl-keyword\">let</span> b <span class=\"hl-operator\">=</span> <span class=\"hl-string\">&quot;two&quot;</span>;</span>\n</code></pre>\n\
         <pre><code class=\"language-nonsense\">&lt;x&gt;\n</code></pre>\n\
         <figure data-lang=\"diagram\">A -&gt; B\n</figure>\n"
    );
    let css = std::fs::read_to_string(dir.join("dist/assets/code.css")).unwrap();
    assert!(css.contains(".hl-keyword { color: var(--hl-keyword); }") && css.contains("prefers-color-scheme: dark"), "{}", css);

    std::fs::write(dir.join("ssqch.config.js"), "export default { markdown: { highlight: { css: \"code.css\" } } };\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("markdown.highlight.css must be a path like \"/assets/highlight.css\", or false, not \"code.css\""), "{}", log);
}

#[test]
fn site_plumbing() {
    let dir = temp_dir("plumbing");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write(
        "ssqch.config.js",
        "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"edge\", \"md\", \"liquid\"],\n  ignore: [\"drafts/**\", \"**/README.md\"],\n  bundles: true,\n  passthrough: [{ \"assets/**/*.png\": \"images\" }],\n};\n",
    );
    write("src/_includes/post.edge", "<p class=\"x\">{{{ page.excerpt }}}</p><p>{{ readingTime(content) }} min</p>{{{ content }}}");
    write("src/posts/trip/index.md", "+++\ntitle = \"Trip\"\nlayout = \"post.edge\"\n+++\nIntro *para*.\n\n<!-- more -->\nRest.\n");
    write("src/posts/trip/photo.jpg", "jpg");
    write("src/posts/trip/trip.json", "{ \"tags\": \"trips\" }");
    write("src/posts/old.markdown", "---json\n{ \"title\": \"Old\", \"draft\": true }\n---\n# Old\n");
    write("src/hi.liquid", "---\ntitle: Hi There\npermalink: \"/{{ title | slugify }}/\"\n---\n{{ title }}\n");
    write("src/drafts/wip.md", "wip");
    write("src/README.md", "readme");
    write("assets/icons/a.png", "png");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let mut files: Vec<String> = walk(&dir.join("dist")).into_iter().filter(|f| !f.starts_with(".cache")).collect();
    files.sort();
    assert_eq!(files, ["hi-there/index.html", "images/icons/a.png", "posts/trip/index.html", "posts/trip/photo.jpg"]);
    assert_eq!(std::fs::read_to_string(dir.join("dist/posts/trip/index.html")).unwrap(), "<p class=\"x\"><p>Intro <em>para</em>.</p></p><p>1 min</p><p>Intro <em>para</em>.</p>\n<!-- more -->\n<p>Rest.</p>");
    // Drafts build in development.
    let (ok, log) = ssqch(&["build", "--root", d, "-q", "--env", "development"]);
    assert!(ok, "{}", log);
    assert!(std::fs::read_to_string(dir.join("dist/posts/old/index.html")).unwrap().contains("<h1 id=\"old\">Old</h1>"));

    // strict: printing an undefined value fails, in any engine.
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"liquid\"], ignore: [\"posts/**\", \"drafts/**\", \"*.md\"], strict: true };\n");
    write("src/hi.liquid", "{% if nope %}x{% endif %}{{ titel }}");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("requested variable=titel"), "{}", log);
    write("src/hi.liquid", "fine");
    write("src/x.edge", "{{ page.url }} {{ titel }}");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("x.edge:1: `titel` is undefined (strict is on)"), "{}", log);
}

fn walk(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in std::fs::read_dir(&d).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path.strip_prefix(dir).unwrap().to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out
}

#[test]
fn last_modified_from_git() {
    let dir = temp_dir("lastmod");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    let git = |args: &[&str], date: &str| {
        let out = Command::new("git").arg("-C").arg(&dir).args(args).env("GIT_AUTHOR_DATE", date).env("GIT_COMMITTER_DATE", date).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@example.com").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@example.com").output().unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    };
    std::fs::write(dir.join("ssqch.config.js"), "import { sitemapPlugin } from \"ssqch/sitemap\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, lastModified: \"git\", plugins: [sitemapPlugin({ url: \"https://example.com\" })] };\n").unwrap();
    std::fs::write(dir.join("src/a.edge"), "{{ page.lastModified.toISOString() }}").unwrap();
    std::fs::write(dir.join("src/b.edge"), "{{ page.lastModified.toISOString() }}").unwrap();
    git(&["init", "-q"], "2020-01-01T00:00:00Z");
    git(&["add", "."], "2020-01-01T00:00:00Z");
    git(&["commit", "-q", "-m", "first"], "2021-03-04T05:06:07Z");
    std::fs::write(dir.join("src/b.edge"), "{{ page.lastModified.toISOString() }} ").unwrap();
    git(&["commit", "-q", "-am", "second"], "2022-05-06T07:08:09Z");
    std::fs::write(dir.join("src/c.edge"), "{{ page.lastModified.getFullYear() }}").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let read = |p: &str| std::fs::read_to_string(dir.join(p)).unwrap();
    assert_eq!(read("dist/a/index.html"), "2021-03-04T05:06:07.000Z");
    assert_eq!(read("dist/b/index.html"), "2022-05-06T07:08:09.000Z ");
    // Not committed yet: the file's own time.
    assert!(read("dist/c/index.html").trim().parse::<i32>().unwrap() >= 2026);
    assert!(read("dist/sitemap.xml").contains("<loc>https://example.com/a/</loc>\n    <lastmod>2021-03-04</lastmod>"), "{}", read("dist/sitemap.xml"));
}

#[cfg(unix)]
#[test]
fn hooks_run_commands() {
    let dir = temp_dir("run");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(
        dir.join("ssqch.config.js"),
        "import { linksPlugin } from \"ssqch/links\";\nexport default {\n  dirs: { input: \"src\", output: \"dist\" },\n  afterBuild: [{ run: \"mkdir -p \\\"$SSQCH_OUTPUT/search\\\" && echo \\\"$SSQCH_ENV $SSQCH_SERVING\\\" > dist/search/index.js\" }, () => {}],\n  plugins: [linksPlugin()],\n};\n",
    )
    .unwrap();
    // The command runs before the link checker, so the link it makes resolves.
    std::fs::write(dir.join("src/index.html"), "<script src=\"/search/index.js\"></script>").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("[ssqch] afterBuild: mkdir -p"), "{}", log);
    assert_eq!(std::fs::read_to_string(dir.join("dist/search/index.js")).unwrap(), "production false\n");

    std::fs::write(dir.join("ssqch.config.js"), "export default { beforeBuild: { run: \"exit 3\" } };\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("beforeBuild: `exit 3` exited with status 3"), "{}", log);
    std::fs::write(dir.join("ssqch.config.js"), "export default { afterBuild: { cmd: \"x\" } };\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("afterBuild: \"cmd\" isn't an option (use { run: \"command\" })"), "{}", log);
}

#[test]
fn diff_compares_two_builds() {
    let dir = temp_dir("diff");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    let run = |args: &[&str]| {
        let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(args).current_dir(&dir).output().unwrap();
        (out.status.code(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    };
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" } };\n");
    write("src/_includes/layout.edge", "<html><head><title>{{ title }}</title><meta name=\"generator\" content=\"{{ ssqch.generator }}\"></head><body>{{{ content }}}</body></html>");
    write("src/index.md", "---\ntitle: Home\nlayout: layout.edge\n---\n## Trails\n\nPine trail.\n");
    write("src/about.md", "---\ntitle: About\nlayout: layout.edge\n---\nAbout.\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q", "--output", "before"]);
    assert!(ok, "{}", log);
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let (code, log) = run(&["diff", "before", "dist"]);
    assert_eq!(code, Some(0), "{}", log);
    assert!(log.contains("No differences: 2 pages and 0 other files are the same."), "{}", log);

    write("src/index.md", "---\ntitle: Home\nlayout: layout.edge\n---\n## Paths\n\nCedar trail.\n");
    write("src/new.md", "---\ntitle: New\nlayout: layout.edge\n---\nNew.\n");
    std::fs::remove_file(dir.join("src/about.md")).unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q", "--output", "after"]);
    assert!(ok, "{}", log);
    let (code, log) = run(&["diff", "before", "after"]);
    assert_eq!(code, Some(1), "{}", log);
    for expected in [
        "Added (1)\n  + /new/\n",
        "Removed (1)\n  - /about/\n",
        "  ~ /  (text and markup)\n      ids removed (links to them break): #trails\n      - <h2 id=\"trails\">\n      - Trails\n      + <h2 id=\"paths\">\n      + Paths\n      - Pine trail.\n      + Cedar trail.\n",
        "1 changed, 1 added, 1 removed; 0 pages and 0 other files are the same.",
    ] {
        assert!(log.contains(expected), "missing {:?} in\n{}", expected, log);
    }
    let (code, log) = run(&["diff", "before", "after", "--format", "json", "--only", "index.html"]);
    assert_eq!(code, Some(1), "{}", log);
    let json: serde_json::Value = serde_json::from_str(&log).unwrap_or_else(|e| panic!("{}: {}", e, log));
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["summary"], serde_json::json!({ "added": 0, "removed": 0, "changed": 1, "unchangedPages": 0, "unchangedFiles": 0 }));
    assert_eq!(json["changed"][0]["url"], "/");
    assert_eq!(json["changed"][0]["changes"], serde_json::json!(["text", "markup"]));

    let (code, log) = run(&["diff", "before", "after", "--ignore", "(Pine|Cedar) trail\\.|Trails|Paths|trails|paths", "--only", "index.html"]);
    assert_eq!(code, Some(0), "{}", log);
    let (code, log) = run(&["diff", "before", "missing"]);
    assert_eq!(code, Some(2), "{}", log);
    assert!(log.contains("missing isn't a folder"), "{}", log);
    let (code, log) = run(&["diff", "before", "after", "--ignore", "("]);
    assert_eq!(code, Some(2), "{}", log);
    assert!(log.contains("--ignore \"(\" isn't a regular expression"), "{}", log);
}

#[test]
fn schemas_check_every_page() {
    let dir = temp_dir("schemas");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write(
        "ssqch.config.js",
        r#"import { defineConfig } from "ssqch";
export default defineConfig({
  dirs: { input: "src", output: "dist" },
  schemas: {
    posts: {
      fields: {
        title: (value) => typeof value === "string" && value.length <= 20 || "must be a string of 20 characters or fewer",
        date: "date",
        description: "string?",
        status: "'draft' | 'published'",
        hero: { src: "file", alt: "string" },
        slug: "string",
      },
      unknown: "error",
    },
    guides: { files: "guides/**", fields: { order: "integer" }, unknown: "warn" },
  },
});
"#,
    );
    write("src/posts/posts.json", "{ \"tags\": \"posts\", \"computed\": { \"slug\": \"{{ page.fileSlug }}\" } }");
    write("src/posts/pine.md", "---\ntitle: Pine\ndate: 2026-03-14\nstatus: published\nhero: { src: pine.jpg, alt: A pine }\n---\nPine.\n");
    write("src/posts/pine.jpg", "jpg");
    write("src/guides/start.md", "---\norder: 1\n---\nStart.\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    assert!(!log.contains("warn"), "{}", log);

    write("src/posts/cedar.md", "---\ntitle: A title that goes on for far too long\nstatus: drfat\ndescripton: Typo\nhero: { src: cedar.jpg }\n---\nCedar.\n");
    write("src/guides/next.md", "---\norder: second\nlevel: 2\n---\nNext.\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok, "{}", log);
    for expected in [
        "7 content errors:",
        "  - src/posts/cedar.md: `date` is required (a date, like 2026-03-14) (schema `posts`)",
        "  - src/posts/cedar.md: `title` must be a string of 20 characters or fewer (schema `posts`)",
        "  - src/posts/cedar.md: `status` must be \"draft\" or \"published\", not \"drfat\" (schema `posts`)",
        "  - src/posts/cedar.md: `hero.src` is \"cedar.jpg\", but there's no such file next to the page (schema `posts`)",
        "  - src/posts/cedar.md: `hero.alt` is required (a string) (schema `posts`)",
        "  - src/posts/cedar.md: `descripton` isn't a field of this schema (did you mean `description`?) (schema `posts`)",
        "  - src/guides/next.md: `order` must be a whole number, not \"second\" (schema `guides`)",
        "warn: src/guides/next.md: `level` isn't a field of this schema (schema `guides`)",
    ] {
        assert!(log.contains(expected), "missing {:?} in\n{}", expected, log);
    }

    // The schemas become types.
    let (ok, log) = ssqch(&["types", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("(with 2 schemas)"), "{}", log);
    let types = std::fs::read_to_string(dir.join("ssqch.d.ts")).unwrap();
    assert!(types.contains("\tinterface Schemas {\n\t\tposts: {\n\t\t\ttitle: any;\n\t\t\tdate: Date | string;\n\t\t\tdescription?: string;\n\t\t\tstatus: \"draft\" | \"published\";\n"), "{}", types);
    assert!(types.contains("\t\tguides: {\n\t\t\torder: number;\n\t\t};\n"), "{}", types);

    write("ssqch.config.js", "export default { schemas: { posts: { title: \"string\" } } };\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("ssqch.config.js: schemas.posts: \"title\" isn't an option (options: fields, files, unknown); a schema's fields go in `fields`"), "{}", log);
}

/// Stops `ssqch serve` when the test ends, pass or fail.
struct Server(std::process::Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Wait (up to 20 seconds) for `file` to contain `text`.
fn wait_for(file: &std::path::Path, text: &str) {
    let started = std::time::Instant::now();
    loop {
        let found = std::fs::read_to_string(file).unwrap_or_default();
        if found.contains(text) {
            return;
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "{} never had {:?}; it has {:?}", file.display(), text, found);
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// Write `text` to `source` and wait (up to 40 seconds) for `file` to contain
/// `expected`. The write is repeated every second: on a busy machine the
/// server may not be watching yet when the first one lands, and writing the
/// same contents again doesn't count as another change.
fn change_and_wait(source: &std::path::Path, text: &str, file: &std::path::Path, expected: &str) {
    let started = std::time::Instant::now();
    loop {
        std::fs::write(source, text).unwrap();
        let written = std::time::Instant::now();
        while written.elapsed() < std::time::Duration::from_secs(1) {
            if std::fs::read_to_string(file).unwrap_or_default().contains(expected) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(40), "{} never had {:?} after writing {}; it has {:?}", file.display(), expected, source.display(), std::fs::read_to_string(file).unwrap_or_default());
    }
}

#[test]
fn serve_reads_a_changed_config_again() {
    let dir = temp_dir("serve-reload");
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "import { shout } from \"./lib/filters.js\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, filters: { shout }, data: { greeting: \"hello\" } };\n");
    write("lib/filters.js", "export const shout = (s) => s.toUpperCase() + \"!\";\n");
    write("src/_data/info.js", "import { n } from \"../util/helper.js\";\nexport default { n };\n");
    write("src/util/helper.js", "export const n = 1;\n");
    write("src/index.edge", "{{ shout(greeting) }} {{ info.n }}");
    let log = dir.join("serve.log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch"))
        .args(["serve", "--port", "0", "--root"])
        .arg(&dir)
        .stdout(out.try_clone().unwrap())
        .stderr(out)
        .spawn()
        .unwrap();
    let _server = Server(child);
    let page = dir.join("dist/index.html");
    wait_for(&page, "HELLO! 1");

    // A module the config imports, outside the input folder.
    change_and_wait(&dir.join("lib/filters.js"), "export const shout = (s) => s.toUpperCase() + \"?\";\n", &page, "HELLO? 1");
    // A module a data file imports.
    change_and_wait(&dir.join("src/util/helper.js"), "export const n = 2;\n", &page, "HELLO? 2");
    // A config that doesn't load is reported, and the last good one keeps serving.
    change_and_wait(&dir.join("ssqch.config.js"), "export default { dirs: { ouput: \"dist\" } };\n", &log, "dirs.ouput isn't supported");
    wait_for(&log, "still serving with the last configuration that loaded");
    // Fixed, with a changed setting.
    change_and_wait(&dir.join("ssqch.config.js"), "import { shout } from \"./lib/filters.js\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, filters: { shout }, data: { greeting: \"howdy\" } };\n", &page, "HOWDY? 2");
    // Templates still rebuild as before.
    change_and_wait(&dir.join("src/index.edge"), "plain {{ info.n }}", &page, "plain 2");
}

#[cfg(feature = "jinja")]
#[test]
fn nunjucks_tags_from_config_functions_and_jinja_dates() {
    let dir = temp_dir("njk-tags");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write(
        "ssqch.config.js",
        "export default {\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"njk\", \"jinja\"],\n  filters: {\n    image: (src, alt) => `<img src=\"${src}\" alt=\"${alt}\">`,\n    callout: (content, kind = \"note\") => `<aside class=\"${kind}\">${content.trim()}</aside>`,\n    include: () => \"never called\",\n  },\n};\n",
    );
    write("src/_includes/part.njk", "part");
    write(
        "src/index.njk",
        "---\ntitle: Pines\nimage: /hero.png\n---\n{% image \"/a.png\", title %}\n{%- callout \"tip\" -%}\n  Watch for <b>{{ title }}</b>.\n{%- endcallout %}\n{% callout %}Plain{% endcallout %}\n{% markdown %}*md* in a template{% endmarkdown %}{% include \"part.njk\" %} {{ image | upper }} {{ \"/b.png\" | image(\"B\") | safe }}",
    );
    write(
        "src/dates.jinja",
        "---\nwhen: 2026-03-14T09:05:00Z\ncount: 2\n---\n{{ when | dateformat }}|{{ when | dateformat(\"full\") }}|{{ when | datetimeformat(\"short\") }}|{{ when | timeformat }}|{{ when | dateformat(\"%B %-d, %Y\") }}|{{ \"2024-12-25\" | dateformat(\"long\") }}|{{ now().strftime(\"%Y\") | length }}{{ page.date.isoformat() | length }}|{{ count }} pine{{ count | pluralize }}|{{ 2048 | filesizeformat }}|{{ \"<b>bold</b>\" | striptags }}",
    );
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    assert_eq!(
        read("index.html"),
        "<img src=\"/a.png\" alt=\"Pines\"><aside class=\"tip\">Watch for <b>Pines</b>.</aside>\n<aside class=\"note\">Plain</aside>\n<p><em>md</em> in a template</p>\npart /HERO.PNG <img src=\"/b.png\" alt=\"B\">"
    );
    assert_eq!(read("dates/index.html"), "Mar 14 2026|Saturday, March 14 2026|2026-03-14 09:05|09:05|March 14, 2026|December 25 2024|425|2 pines|2.0 kB|bold");
}

#[cfg(all(feature = "jinja", feature = "liquid"))]
#[test]
fn a_theme_sits_under_the_site_file_by_file() {
    let dir = temp_dir("theme");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    // The theme: layouts in three engines, a partial, a hook, a container, data, a page and a stylesheet.
    write("themes/trail/_includes/base.edge", "<html><head><link rel=\"stylesheet\" href=\"/assets/theme.css\"></head><body>\n@include('partials/header')\n<main>{{{ content }}}</main>\n@include('partials/footer')\n</body></html>");
    write("themes/trail/_includes/partials/header.edge", "<header>{{ site.name }} ({{ site.tagline }})</header>");
    write("themes/trail/_includes/partials/footer.edge", "<footer>theme footer</footer>");
    write("themes/trail/_includes/post.njk", "---\nlayout: base.edge\n---\n<article>{% include \"byline.njk\" %}{{ content | safe }}</article>");
    write("themes/trail/_includes/byline.njk", "<p>theme byline</p>");
    write("themes/trail/_includes/card.liquid", "<div class=\"card\">{% include \"card-title.liquid\" %}{{ content }}</div>");
    write("themes/trail/_includes/card-title.liquid", "<b>theme title</b>");
    write("themes/trail/_includes/hooks/heading.edge", "<h{{ heading.level }} class=\"theme\">{{{ heading.content }}}</h{{ heading.level }}>");
    write("themes/trail/_includes/containers/note.edge", "<aside class=\"theme-note\">{{{ container.content }}}</aside>");
    write("themes/trail/_data/site.json", "{ \"name\": \"Theme Name\", \"tagline\": \"from the theme\" }");
    write("themes/trail/404.md", "---\nlayout: base.edge\npermalink: /404.html\n---\nTheme 404\n");
    write("themes/trail/about.md", "---\nlayout: base.edge\n---\nTheme about\n");
    write("themes/trail/assets/theme.css", "body { color: green }");
    write("themes/trail/assets/logo.svg", "<svg/>");
    write("themes/trail/README.md", "# Trail theme\n");
    write("themes/trail/LICENSE", "MIT");
    // The site: its own name, footer, byline, about page and logo.
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\", \"njk\", \"liquid\"], theme: \"themes/trail\" };\n");
    write("src/_data/site.json", "{ \"name\": \"My Site\" }");
    write("src/_includes/partials/footer.edge", "<footer>my footer</footer>");
    write("src/_includes/byline.njk", "<p>my byline</p>");
    write("src/index.md", "---\nlayout: post.njk\n---\n## Hello\n\n::: note\nNoted.\n:::\n");
    write("src/card.liquid", "---\nlayout: card.liquid\n---\nCard body");
    write("src/about.md", "---\nlayout: base.edge\n---\nMy about\n");
    write("src/assets/logo.svg", "<svg id=\"mine\"/>");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    assert_eq!(
        read("index.html"),
        "<html><head><link rel=\"stylesheet\" href=\"/assets/theme.css\"></head><body><header>My Site (from the theme)</header>\n<main><article><p>my byline</p><h2 class=\"theme\">Hello</h2>\n<aside class=\"theme-note\"><p>Noted.</p>\n</aside>\n</article></main><footer>my footer</footer>\n</body></html>"
    );
    assert_eq!(read("card/index.html"), "<div class=\"card\"><b>theme title</b>Card body</div>");
    assert!(read("404.html").contains("<main><p>Theme 404</p>\n</main>"), "{}", read("404.html"));
    assert!(read("about/index.html").contains("My about") && !read("about/index.html").contains("Theme about"));
    assert_eq!(read("assets/theme.css"), "body { color: green }");
    // The site has its own logo (and no passthrough for it), so the theme's isn't copied over it.
    assert!(!dir.join("dist/assets/logo.svg").exists());
    for not_built in ["README/index.html", "readme/index.html", "LICENSE", "themes"] {
        assert!(!dir.join("dist").join(not_built).exists(), "{} was built", not_built);
    }

    write("ssqch.config.js", "export default { theme: \"themes/missing\" };\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("ssqch.config.js: theme folder") && log.contains("themes/missing doesn't exist"), "{}", log);
    write("ssqch.config.js", "export default { theme: \"https://github.com/you/theme\" };\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("isn't pinned: add the commit or tag to use"), "{}", log);
}

#[test]
fn a_theme_from_git_is_fetched_once() {
    let git = |dir: &std::path::Path, args: &[&str]| {
        let out = Command::new("git").arg("-C").arg(dir).args(["-c", "user.name=Squatch", "-c", "user.email=squatch@example.com", "-c", "commit.gpgsign=false"]).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    // A repository with the theme in a folder, tagged.
    let repo = temp_dir("theme-repo");
    std::fs::create_dir_all(repo.join("theme/_includes")).unwrap();
    std::fs::write(repo.join("theme/_includes/base.edge"), "<main class=\"v1\">{{{ content }}}</main>").unwrap();
    git(&repo, &["init", "--quiet", "-b", "main"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "--quiet", "-m", "Theme"]);
    git(&repo, &["tag", "v1.0.0"]);
    std::fs::write(repo.join("theme/_includes/base.edge"), "<main class=\"v2\">{{{ content }}}</main>").unwrap();
    git(&repo, &["commit", "--quiet", "-am", "Change it"]);
    // `file:///C:/...` on Windows, `file:///tmp/...` elsewhere.
    let repo_path = repo.to_string_lossy().replace('\\', "/");
    let url = format!("file://{}{}", if repo_path.starts_with('/') { "" } else { "/" }, repo_path);

    let dir = temp_dir("theme-git");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("ssqch.config.js"), format!("export default {{ dirs: {{ input: \"src\", output: \"dist\" }}, theme: {{ git: \"{}\", ref: \"v1.0.0\", dir: \"theme\" }} }};\n", url)).unwrap();
    std::fs::write(dir.join("src/index.md"), "---\nlayout: base.edge\n---\nHi\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains(&format!("[ssqch] Fetching theme {}#v1.0.0", url)), "{}", log);
    // The tag's version, not the branch's.
    assert_eq!(std::fs::read_to_string(dir.join("dist/index.html")).unwrap(), "<main class=\"v1\"><p>Hi</p>\n</main>");

    // It's kept: the next build doesn't need the repository.
    // (Renamed rather than deleted: git's object files are read-only, which Windows minds.)
    std::fs::rename(&repo, temp_dir("theme-repo-moved")).unwrap();
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(!log.contains("Fetching theme"), "{}", log);

    // The same thing as one string, and a ref that doesn't exist.
    std::fs::write(dir.join("ssqch.config.js"), format!("export default {{ dirs: {{ input: \"src\", output: \"dist\" }}, theme: \"{}#v1.0.0:theme\" }};\n", url)).unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    std::fs::write(dir.join("ssqch.config.js"), format!("export default {{ theme: \"{}#v9\" }};\n", url)).unwrap();
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(!ok && log.contains("#v9: git fetch failed"), "{}", log);
}

#[cfg(feature = "jinja")]
#[test]
fn import_moves_an_eleventy_site() {
    let dir = temp_dir("import");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write(
        ".eleventy.js",
        "const pluginRss = require(\"@11ty/eleventy-plugin-rss\");\nmodule.exports = function (eleventyConfig) {\n  eleventyConfig.addPlugin(pluginRss);\n  eleventyConfig.addPassthroughCopy(\"src/css\");\n  eleventyConfig.addFilter(\"shout\", (s) => s.toUpperCase());\n  return { dir: { input: \"src\", output: \"_site\" }, markdownTemplateEngine: \"njk\", htmlTemplateEngine: \"njk\" };\n};\n",
    );
    write("src/_includes/base.njk", "<title>{{ label or title }}</title>{{ content | safe }}");
    write("src/index.njk", "---\ntitle: Home\neleventyExcludeFromCollections: true\n---\n{% for post in collections.post %}<a href=\"{{ post.url }}\">{{ post.data.label }}</a>{% endfor %} {{ collections.all | length }}");
    write("src/posts/posts.11tydata.json", "{ \"layout\": \"base.njk\", \"tags\": \"post\", \"eleventyComputed\": { \"label\": \"Post: {{ title }}\" } }");
    write("src/posts/pine.md", "---\ntitle: Pine\ntemplateEngineOverride: njk,md\n---\n*{{ title }}* <img src=\"/css/x.png\" eleventy:ignore>\n");
    write("src/feed.11ty.js", "module.exports = class {};");
    write("src/css/site.css", "body {}");
    write("_site/old/index.html", "from the last Eleventy build");
    let before = std::fs::read_to_string(dir.join("src/index.njk")).unwrap();

    // A dry run says what it would do, and does nothing.
    let (ok, log) = ssqch(&["import", "eleventy", d]);
    assert!(ok, "{}", log);
    for expected in [
        "(a dry run: nothing is changed; add --write to make the changes)",
        "Rename (1)\n  src/posts/posts.11tydata.json -> src/posts/posts.data.json\n",
        "  src/index.njk: eleventyExcludeFromCollections -> excludeFromCollections\n",
        "  src/posts/pine.md: templateEngineOverride -> render, eleventy:widths/ignore -> ssqch:widths/ignore\n",
        "  src/posts/posts.11tydata.json: eleventyComputed -> computed\n",
        "Create (1)\n  ssqch.config.js (a first draft, from .eleventy.js)\n",
        "  src/feed.11ty.js: JavaScript templates don't run in ssqch",
        "  .eleventy.js:5: addFilter(\"shout\") -> `filters: { shout: ... }`",
        "  .eleventy.js: @11ty/eleventy-plugin-rss -> `rssPlugin()` from \"ssqch/rss\"",
    ] {
        assert!(log.contains(expected), "missing {:?} in\n{}", expected, log);
    }
    assert!(!log.contains("_site/old"), "{}", log);
    assert_eq!(std::fs::read_to_string(dir.join("src/index.njk")).unwrap(), before);
    assert!(!dir.join("ssqch.config.js").exists() && dir.join("src/posts/posts.11tydata.json").exists());

    // With --write, the site builds with ssqch.
    let (ok, log) = ssqch(&["import", "eleventy", d, "--write"]);
    assert!(ok && log.contains("Done: 1 renamed, 3 edited, 1 created."), "{}", log);
    assert!(std::fs::read_to_string(dir.join("src/posts/posts.data.json")).unwrap().contains("\"computed\""));
    let config = std::fs::read_to_string(dir.join("ssqch.config.js")).unwrap();
    assert!(config.contains("dirs: { input: \"src\", output: \"_site\" },") && config.contains("markdownEngine: \"njk\",\n  htmlEngine: \"njk\",") && config.contains("passthrough: [\"src/css\"],"), "{}", config);
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("_site").join(path)).unwrap();
    assert_eq!(read("index.html"), "<a href=\"/posts/pine/\">Post: Pine</a> 1");
    assert_eq!(read("posts/pine/index.html"), "<title>Post: Pine</title><p><em>Pine</em> <img src=\"/css/x.png\" ssqch:ignore></p>\n");
    assert!(dir.join("_site/css/site.css").is_file());

    // A second run has nothing left to change, and keeps the config that's there.
    let (ok, log) = ssqch(&["import", "eleventy", d]);
    assert!(ok && log.contains("Nothing to rename, edit or create.") && log.contains("ssqch.config.js: it's already there"), "{}", log);
    let (ok, log) = ssqch(&["import", "hugo", d]);
    assert!(!ok && log.contains("there's no importer for hugo yet (only eleventy and zola)"), "{}", log);
}

/// A site whose input folder is the project root (the default) has ssqch's
/// own `.cache` and the output inside what's watched. Writing them isn't a change.
#[test]
fn serve_does_not_rebuild_for_its_own_files() {
    let dir = temp_dir("serve-root");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.edge"), "one {{ 1 + 1 }}").unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { clean: true };\n").unwrap();
    let log = dir.join("serve.log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--root"]).arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let _server = Server(child);
    let page = dir.join("_site/index.html");
    wait_for(&page, "one 2");
    let builds = || std::fs::read_to_string(&log).unwrap_or_default().matches("Built in").count();
    std::thread::sleep(std::time::Duration::from_millis(1500));
    assert_eq!(builds(), 1, "it rebuilt with nothing changed:\n{}", std::fs::read_to_string(&log).unwrap_or_default());
    change_and_wait(&dir.join("index.edge"), "two {{ 2 + 2 }}", &page, "two 4");
    std::thread::sleep(std::time::Duration::from_millis(1500));
    assert_eq!(builds(), 2, "{}", std::fs::read_to_string(&log).unwrap_or_default());
}

#[cfg(feature = "jinja")]
#[test]
fn import_moves_a_zola_site() {
    let dir = temp_dir("import-zola");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("config.toml", "base_url = \"https://example.com\"\ntitle = \"Trail Notes\"\ngenerate_feeds = true\ntaxonomies = [{ name = \"tags\" }]\n\n[markdown]\nhighlight_code = true\n\n[extra]\nauthor = \"Sam\"\n");
    write("content/_index.md", "+++\ntitle = \"Home\"\n+++\n");
    write("content/blog/_index.md", "+++\ntitle = \"Blog\"\nsort_by = \"date\"\npage_template = \"page.html\"\n+++\n");
    write("content/blog/pine.md", "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npath = \"blog/2024/pine\"\naliases = [\"old-pine.html\"]\n\n[taxonomies]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube(id=\"abc\") }}\n");
    write("templates/page.html", "<h1>{{ page.title }}</h1>{{ page.content | safe }}{{ get_url(path=\"@/blog/pine.md\") }}{{ page.date | date(format=\"%Y\") }}");
    write("templates/shortcodes/youtube.html", "<iframe src=\"https://www.youtube.com/embed/{{ id }}\"></iframe>");
    write("static/robots.txt", "User-agent: *\n");

    let (ok, log) = ssqch(&["import", "zola", d]);
    assert!(ok, "{}", log);
    for expected in [
        "Importing the Zola site in",
        "Edit (1)\n  content/blog/pine.md: path -> permalink, [taxonomies] tags -> tags\n",
        "Create (1)\n  ssqch.config.js (a first draft, from config.toml)\n",
        "  content/blog/_index.md: a section: its settings",
        "(content/blog/blog.json: `layout`, `tags`, `permalink`)",
        "  templates/shortcodes/youtube.html: a shortcode used in content",
        "  templates/: 2 Tera templates: they run as Jinja",
        "  templates/: 1 x Tera functions (get_url",
        "  templates/: 1 x filters with named arguments",
        "  templates/: 1 x `page.content`, `section.content`: `content` in a layout",
        "  config.toml: generate_feeds: a feed template",
        "compare with the site Zola built: `ssqch diff <Zola's output> <ssqch's output>`",
    ] {
        assert!(log.contains(expected), "missing {:?} in\n{}", expected, log);
    }
    assert!(!dir.join("ssqch.config.js").exists());

    let (ok, log) = ssqch(&["import", "zola", d, "--write"]);
    assert!(ok && log.contains("Done: 0 renamed, 1 edited, 1 created."), "{}", log);
    assert_eq!(
        std::fs::read_to_string(dir.join("content/blog/pine.md")).unwrap(),
        "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\naliases = [\"old-pine.html\"]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube(id=\"abc\") }}\n"
    );
    let config = std::fs::read_to_string(dir.join("ssqch.config.js")).unwrap();
    for expected in ["dirs: { input: \"content\", output: \"public\", includes: \"../templates\" },", "ignore: [\"**/_index.md\"],", "markdown: { headingIds: \"ascii\", highlight: true },", "passthrough: [{ static: \".\" }],", "\"title\": \"Trail Notes\"", "\"author\": \"Sam\"", "plugins: [sitemapPlugin({ url: \"https://example.com\" }), redirectsPlugin(), linksPlugin()],"] {
        assert!(config.contains(expected), "missing {:?} in\n{}", expected, config);
    }

    // The by-hand part, done: the template, the shortcode as a filter, and the section's data.
    write("templates/page.html", "<h1>{{ title }}</h1>{{ content | safe }}{{ config.title }} by {{ config.extra.author }}, {{ page.date | dateformat(\"%Y\") }}, {{ tags | join(\",\") }}");
    write("content/blog/blog.json", "{ \"layout\": \"page.html\" }");
    std::fs::write(dir.join("ssqch.config.js"), config.replace("    // Port shortcodes and Tera functions here: name: (...args) => result\n", "    youtube: () => \"<iframe></iframe>\",\n")).unwrap();
    write("content/blog/pine.md", "+++\ntitle = \"Pine\"\ndate = 2024-01-02\npermalink = \"/blog/2024/pine/\"\naliases = [\"old-pine.html\"]\ntags = [\"trees\"]\n+++\nA *pine*. {{ youtube() | safe }}\n");
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("public").join(path)).unwrap();
    assert_eq!(read("blog/2024/pine/index.html"), "<h1>Pine</h1><p>A <em>pine</em>. <iframe></iframe></p>\nTrail Notes by Sam, 2024, trees");
    assert!(read("old-pine.html").contains("url=/blog/2024/pine/") && read("robots.txt").contains("User-agent") && read("sitemap.xml").contains("https://example.com/blog/2024/pine/"));
    assert!(!dir.join("public/blog/_index/index.html").exists() && !dir.join("public/_index/index.html").exists());
}
