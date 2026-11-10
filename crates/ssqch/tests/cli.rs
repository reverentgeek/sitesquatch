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
