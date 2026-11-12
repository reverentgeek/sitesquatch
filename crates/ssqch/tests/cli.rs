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
    for file in ["ssqch.config.js", "src/_includes/layout.jinja", "src/index.jinja", "src/posts/i-know-what-i-saw.md", "src/posts/upon-further-review-a-stump.md", "src/posts/the-stump-has-moved.md", "src/404.md", "src/_data/site.json", "ssqch.d.ts", "jsconfig.json", ".gitignore", "AGENTS.md", "CLAUDE.md"] {
        assert!(dir.join(file).is_file(), "{} wasn't created:\n{}", file, log);
    }
    assert!(log.contains("Camp is set up. Next: cd "), "{}", log);
    // Instructions for coding agents: short, since an agent carries them through a session, and
    // pointing at what answers for this version. CLAUDE.md is the one-line import.
    let agents = std::fs::read_to_string(dir.join("AGENTS.md")).unwrap();
    assert!(agents.len() <= 1536 && agents.contains("`ssqch docs <name>`") && agents.contains("`src/posts/` has the posts") && agents.contains("(Jinja)") && agents.contains("`ssqch new posts --title"), "{} bytes:\n{}", agents.len(), agents);
    assert_eq!(std::fs::read_to_string(dir.join("CLAUDE.md")).unwrap(), "@AGENTS.md\n");
    let (ok, generic) = ssqch(&["docs", "agents"]);
    assert!(ok && generic.len() <= 1536 && generic.starts_with("# A SiteSquatch site\n") && generic.contains("its `dirs` say where"), "{}", generic);
    // A site's own AGENTS.md is never replaced.
    std::fs::write(dir.join("AGENTS.md"), "Ours.\n").unwrap();
    let (ok, log) = ssqch(&["init", d]);
    assert!(ok && log.contains("kept    AGENTS.md (already there)"), "{}", log);
    assert_eq!(std::fs::read_to_string(dir.join("AGENTS.md")).unwrap(), "Ours.\n");

    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Links   9 checked, 0 broken"), "{}", log);
    let home = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
    assert!(home.contains("<a href=\"/posts/i-know-what-i-saw/\">I Know What I Saw</a> (January 1, 2026)"), "{}", home);
    // Newest first.
    let at = |title: &str| home.find(title).unwrap_or_else(|| panic!("{} isn't on the home page: {}", title, home));
    assert!(at("The Stump Has Moved") < at("Upon Further Review, a Stump") && at("Upon Further Review, a Stump") < at("I Know What I Saw"), "{}", home);
    assert!(std::fs::read_to_string(dir.join("dist/404.html")).unwrap().contains("several eyewitness accounts"));
    // A site's first build says so; the next one doesn't.
    assert!(log.contains("First confirmed siting. Built in "), "{}", log);

    // The next post starts from the starter's blueprint, and is on the home page.
    let (ok, log) = ssqch(&["new", "--root", d, "posts", "--title", "My second post", "--date", "2026-02-03"]);
    assert_eq!((ok, log.as_str()), (true, "Created src/posts/my-second-post.md from src/_blueprints/posts.md\n"));
    assert_eq!(std::fs::read_to_string(dir.join("src/posts/my-second-post.md")).unwrap(), "---\ntitle: My second post\ndate: 2026-02-03\n---\nWrite down what you saw.\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Built in ") && !log.contains("First confirmed siting"), "{}", log);
    let home = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
    assert!(home.contains("<a href=\"/posts/my-second-post/\">My second post</a> (February 3, 2026)") && !dir.join("dist/_blueprints").exists(), "{}", home);

    // Running it again keeps what's there.
    std::fs::write(dir.join("src/index.jinja"), "mine").unwrap();
    let (ok, log) = ssqch(&["init", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Nothing to do"), "{}", log);
    assert_eq!(std::fs::read_to_string(dir.join("src/index.jinja")).unwrap(), "mine");
}

#[test]
fn init_starts_a_site_in_each_engine() {
    for engine in ["njk", "edge", "liquid", "hbs", "ejs"] {
        let dir = temp_dir(&format!("init-{}", engine));
        let d = dir.to_str().unwrap();
        let (ok, log) = ssqch(&["init", d, "--engine", engine]);
        assert!(ok, "{}", log);
        for file in [format!("src/_includes/layout.{}", engine), format!("src/index.{}", engine)] {
            assert!(dir.join(&file).is_file(), "{} wasn't created:\n{}", file, log);
        }
        assert!(!dir.join("src/index.jinja").exists(), "{}", engine);
        let config = std::fs::read_to_string(dir.join("ssqch.config.js")).unwrap();
        assert!(config.contains(&format!("templateFormats: [\"{0}\", \"md\"],\n  markdownEngine: \"{0}\",", engine)), "{}", config);

        let (ok, log) = ssqch(&["build", "--root", d]);
        assert!(ok, "{}: {}", engine, log);
        assert!(log.contains("Links   9 checked, 0 broken") && !log.contains("warn"), "{}: {}", engine, log);
        let home = std::fs::read_to_string(dir.join("dist/index.html")).unwrap();
        assert!(home.contains("<a href=\"/posts/i-know-what-i-saw/\">I Know What I Saw</a> (January 1, 2026)"), "{}: {}", engine, home);
        assert!(home.contains("<title>Field Notes</title>"), "{}: {}", engine, home);
        let post = std::fs::read_to_string(dir.join("dist/posts/i-know-what-i-saw/index.html")).unwrap();
        assert!(post.contains("<title>I Know What I Saw | Field Notes</title>") && post.contains("<h1>I Know What I Saw</h1>") && post.contains("<code>posts.json</code>"), "{}: {}", engine, post);
        assert!(post.contains(&format!("Built with SiteSquatch {}. Allegedly.", env!("CARGO_PKG_VERSION"))), "{}: {}", engine, post);
        let missing = std::fs::read_to_string(dir.join("dist/404.html")).unwrap();
        assert!(missing.contains("<h1>Page not found</h1>") && missing.contains("<a href=\"/\">Back to the trailhead</a>"), "{}: {}", engine, missing);
    }
}

#[test]
fn init_starts_a_docs_site() {
    let dir = temp_dir("init-docs");
    let d = dir.to_str().unwrap();
    let (ok, log) = ssqch(&["init", d, "--starter", "docs"]);
    assert!(ok, "{}", log);
    for file in ["ssqch.config.js", "src/_data/nav.yml", "src/_includes/doc.jinja", "src/assets/docs.css", "src/docs/guides/writing.md", "ssqch.d.ts", ".gitignore"] {
        assert!(dir.join(file).is_file(), "{} wasn't created:\n{}", file, log);
    }
    // The same pages, whichever language the templates are in.
    let check = |dir: &std::path::Path, engine: &str| {
        let (ok, log) = ssqch(&["build", "--root", dir.to_str().unwrap()]);
        assert!(ok, "{}: {}", engine, log);
        assert!(log.contains(", 0 broken") && !log.contains("warn"), "{}: {}", engine, log);
        let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
        let page = read("docs/guides/writing/index.html");
        for expected in [
            "<title>Writing pages | Squatch Docs</title>".to_string(),
            "<span>Guides</span> › <span aria-current=\"page\">Writing pages</span>".into(),
            "<a href=\"/docs/guides/writing/\" aria-current=\"page\">Writing pages</a>".into(),
            "<a rel=\"prev\" href=\"/docs/install/\">← Installation</a>".into(),
            "<a rel=\"next\" href=\"/docs/guides/deploying/\">Deploying →</a>".into(),
            "<a href=\"#tabs\">Tabs</a>".into(),
            "<h2 id=\"notes\">Notes <a class=\"anchor\" href=\"#notes\"".into(),
            "<div class=\"tabs\"><section class=\"tab\" data-label=\"npm\"><p class=\"tab-label\">npm</p>".into(),
            "<div class=\"warning\"><p class=\"container-title\">Check twice</p>".into(),
            "<details><summary>How do these work?</summary>".into(),
            "<span class=\"line highlighted\">".into(),
            "this site is called Squatch Docs.".into(),
            // The page names the starter's own files.
            format!("<code>src/_includes/containers/name.{}</code>", engine),
        ] {
            assert!(page.contains(&expected), "{}: missing {:?} in\n{}", engine, expected, page);
        }
        assert!(read("404.html").contains("Page not found") && read("index.html").contains("Read the docs"), "{}", engine);
        // The home page has no title of its own.
        assert!(read("index.html").contains("<title>Squatch Docs</title>"), "{}: {}", engine, read("index.html"));
    };
    check(&dir, "jinja");
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap();
    // A new page from the starter's blueprint passes the starter's schema.
    let (ok, log) = ssqch(&["new", "--root", d, "docs/guides", "--title", "Search"]);
    assert_eq!((ok, log.as_str()), (true, "Created src/docs/guides/search.md from src/_blueprints/docs.md\n"));
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("warn") && read("docs/guides/search/index.html").contains("<title>Search | Squatch Docs</title>"), "{}", log);
    assert!(dir.join("dist/assets/docs.js").is_file() && dir.join("dist/highlight.css").is_file());

    for engine in ["njk", "edge", "liquid", "hbs", "ejs"] {
        let other = temp_dir(&format!("init-docs-{}", engine));
        let (ok, log) = ssqch(&["init", other.to_str().unwrap(), "--starter", "docs", "--engine", engine]);
        assert!(ok, "{}: {}", engine, log);
        assert!(other.join(format!("src/_includes/doc.{}", engine)).is_file() && !other.join("src/_includes/doc.jinja").exists(), "{}: {}", engine, log);
        let config = std::fs::read_to_string(other.join("ssqch.config.js")).unwrap();
        assert!(config.contains(&format!("templateFormats: [\"{0}\", \"md\"],\n  markdownEngine: \"{0}\",", engine)), "{}", config);
        check(&other, engine);
    }

    let other = temp_dir("init-docs-shop");
    let (ok, log) = ssqch(&["init", other.to_str().unwrap(), "--starter", "shop"]);
    assert!(!ok && log.contains("--starter shop: not a starter (use site or docs)"), "{}", log);
    assert!(!other.exists());
}

#[test]
fn init_rejects_an_unknown_engine() {
    let dir = temp_dir("init-pug");
    let (ok, log) = ssqch(&["init", dir.to_str().unwrap(), "--engine", "pug"]);
    assert!(!ok);
    assert!(log.contains("--engine pug: not a starter engine (use jinja, njk, edge, liquid, hbs, ejs)"), "{}", log);
    assert!(!dir.exists());
}

#[cfg(feature = "jinja")]
#[test]
fn jinja_is_the_default_and_other_templates_are_named() {
    let dir = temp_dir("default-engine");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    // No config: .jinja pages render, and Markdown and HTML run through Jinja first.
    write("_includes/base.jinja", "<main>{% if title %}<h1>{{ title }}</h1>{% endif %}{{ content }}</main>");
    write("index.jinja", "---\nlayout: base.jinja\ntitle: Camp\n---\n{% for n in [1, 2] %}{{ n }}{% endfor %}");
    write("trail.md", "---\nlayout: base.jinja\n---\n{{ \"cedar\" | upper }} trail");
    write("ranger.html", "{% set who = \"ranger\" %}<p>{{ who }}</p>");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("warn"), "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("_site").join(path)).unwrap();
    assert_eq!(read("index.html"), "<main><h1>Camp</h1>12</main>");
    assert_eq!(read("trail/index.html"), "<main><p>CEDAR trail</p>\n</main>");
    assert_eq!(read("ranger/index.html"), "<p>ranger</p>");

    // A template in a language the site has but doesn't list is named, not left out quietly.
    write("old.edge", "@if(true)\nold\n@end\n");
    write("older.edge", "{{ 'older' }}");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains("warn: 2 .edge files aren't rendered (old.edge, older.edge): templateFormats is jinja, md, html. Add \"edge\" to render them, or list them in `ignore`."), "{}", log);
    assert!(!dir.join("_site/old").exists());
    std::fs::remove_file(dir.join("older.edge")).unwrap();
    let (_, stdout, _) = ssqch_outputs(&["build", "--root", d, "--format", "json"]);
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert_eq!(json["warnings"], serde_json::json!([{ "code": "template-formats", "message": "old.edge isn't rendered: templateFormats is jinja, md, html. Add \"edge\" to render it, or list it in `ignore`.", "file": "old.edge" }]), "{}", json);
    // Listed, it renders; ignored, it's quiet.
    write("ssqch.config.js", "export default { templateFormats: [\"jinja\", \"edge\", \"md\", \"html\"] };\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("warn") && read("old/index.html").contains("old"), "{}", log);
    write("ssqch.config.js", "export default { ignore: [\"old.edge\"] };\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("warn"), "{}", log);
}

#[cfg(feature = "jinja")]
#[test]
fn jinja_errors_point_at_the_name_and_say_what_was_meant() {
    let dir = temp_dir("jinja-errors");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { filters: { shout: s => s } };\n");
    write("_includes/partials/nav.jinja", "<nav></nav>");
    write("_includes/base.jinja", "{{ content }}");
    // The line, the message, and what the carets go under.
    let cases = [
        ("{% include \"partials/navv.jinja\" %}", "template not found: can't include `partials/navv.jinja` (did you mean `partials/nav.jinja`?)", "partials/navv.jinja"),
        ("{% extends \"bse.jinja\" %}", "template not found: no template named `bse.jinja` (did you mean `base.jinja`?)", "bse.jinja"),
        ("{{ title | uper }}", "unknown filter `uper` (did you mean `upper`?)", "uper"),
        ("{{ title | shot }}", "unknown filter `shot` (did you mean `shout`?)", "shot"),
        ("{{ shoutt(title) }}", "unknown function `shoutt` (did you mean `shout`?)", "shoutt"),
        ("{% if 3 is od %}{% endif %}", "unknown test `od` (did you mean `odd`?)", "od"),
        ("{{ title | frobnicate }}", "unknown filter `frobnicate`\n", "frobnicate"),
    ];
    for (line, message, under) in cases {
        write("index.jinja", &format!("---\ntitle: Camp\n---\n{}\n", line));
        let (ok, log) = ssqch(&["build", "--root", d]);
        // The file's own line, as the frame below numbers it.
        assert!(!ok && log.contains(&format!("index.jinja:4: {}", message)), "{}\n{}", line, log);
        let column = line.rfind(under).unwrap();
        let frame = format!("  --> index.jinja:4\n   2 | title: Camp\n   3 | ---\n   4 | {}\n     | {}{}", line, " ".repeat(column), "^".repeat(under.len()));
        assert!(log.contains(&frame), "{}\n{}\nwanted:\n{}", line, log, frame);
    }
}

#[test]
fn ejs_templates_render_as_ejs_does() {
    let dir = temp_dir("ejs");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    let read = |path: &str| std::fs::read_to_string(dir.join("_site").join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e));
    write("ssqch.config.js", "export default { templateFormats: [\"ejs\", \"md\"], markdownEngine: \"ejs\", filters: { shout: s => String(s).toUpperCase() + \"!\" } };\n");
    write("_includes/partials/card.ejs", "<div class=\"card\"><%= name %><% if (typeof extra !== \"undefined\") { %> (<%= extra %>)<% } %></div>\n");
    // The output of EJS 3.1.10 for each template, with the same data.
    let cases = [
        ("<h1><%= title %></h1>\n<p><%- html %></p>\n<p><%= html %></p>\n", "<h1>Squatch &lt;Snacks&gt;</h1>\n<p><b>bold</b></p>\n<p>&lt;b&gt;bold&lt;/b&gt;</p>\n"),
        ("<ul>\n<% items.forEach(function (item) { -%>\n  <li><%= item.name %> is <%= item.n * 2 %></li>\n<% }) -%>\n</ul>\n", "<ul>\n  <li>pine cone is 4</li>\n  <li>Crunch is 6</li>\n</ul>\n"),
        ("<ul>\n  <%_ for (const item of items) { _%>\n    <li><%= item.name %></li>\n  <%_ } _%>\n</ul>\n", "<ul>\n    <li>pine cone</li>\n    <li>Crunch</li>\n</ul>\n"),
        ("a <%# a comment %> b <%% literal %> c\n<%= undefined %>|<%= null %>|<%- null %>|<%= 0 %>|<%= false %>\n", "a  b <% literal %> c\n|||0|false\n"),
        ("<%- include('partials/card', { name: 'Cedar' }) %>\n<%- include('partials/card', { name: 'Old Growth', extra: 'x' }) %>\n", "<div class=\"card\">Cedar</div>\n\n<div class=\"card\">Old Growth (x)</div>\n\n"),
        ("<% const shout = s => s.toUpperCase(); %><%= shout(title) %>\n<%= locals.title %> <%= typeof missing %>\n", "SQUATCH &lt;SNACKS&gt;\nSquatch &lt;Snacks&gt; undefined\n"),
        ("<%= title; %>\n<%\n  let total = 0;\n  for (const i of items) total += i.n;\n%>\nTotal: <%= total %>\n", "Squatch &lt;Snacks&gt;\n\nTotal: 5\n"),
        ("Quotes: <%= q %>\n<% if (items.length > 1) { %>many<% } else { %>one<% } %>\n", "Quotes: &#34;a&#34; &amp; &#39;b&#39;\nmany\n"),
        // An include inside an include gets its parent's data too, and names can be Unicode.
        ("<%- include('outer', { animal: 'fox' }) %>\n<%= café %>\n", "[fox|fox|undefined][fox|fox|string]\nowl\n"),
        // A name used only after `...` is a variable, not a property.
        ("<%= [...animals].join(\",\") %>|<%= Object.keys({...trailInfo}).join() %>|<%= Math.max(...nums) %>\n", "fox,owl|name|2\n"),
    ];
    write("_includes/outer.ejs", "[<%- include(\"inner\") %>][<%- include(\"inner\", { trail: \"Cedar\" }) %>]");
    write("_includes/inner.ejs", "<%= animal %>|<%= locals.animal %>|<%= typeof trail %>");
    let data = "---\ncafé: owl\nanimals: [fox, owl]\ntrailInfo: { name: Cedar }\nnums: [1, 2]\ntitle: \"Squatch <Snacks>\"\nhtml: \"<b>bold</b>\"\nq: \"\\\"a\\\" & 'b'\"\nitems:\n  - { name: pine cone, n: 2 }\n  - { name: Crunch, n: 3 }\n";
    for (i, (source, _)) in cases.iter().enumerate() {
        write(&format!("cases/c{}.ejs", i), &format!("{}permalink: /c{}.html\n---\n{}", data, i, source));
    }
    // A Markdown post in an EJS layout, with a config filter, one of ssqch's functions and collections.
    write("_includes/base.ejs", "<main><%- content %></main><footer><%= shout(\"stump\") %> <%- markdown(\"*Pine*\", \"inline\") %> <%= page.url %></footer>\n");
    write("trail.md", "---\nlayout: base.ejs\ntitle: Trail\n---\n# <%= title %>\n\n<%= collections.all.length %> pages.\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("warn"), "{}", log);
    for (i, (source, want)) in cases.iter().enumerate() {
        assert_eq!(read(&format!("c{}.html", i)), *want, "{}", source);
    }
    assert_eq!(read("trail/index.html"), "<main><h1 id=\"trail\">Trail</h1>\n<p>11 pages.</p>\n</main><footer>STUMP! <em>Pine</em> /trail/</footer>\n");

    // Errors name the template and line, and the frame shows the file's own lines.
    let fails = |source: &str, message: &str| {
        write("bad.ejs", &format!("---\ntitle: x\n---\nline one\n{}\n", source));
        let (ok, log) = ssqch(&["build", "--root", d]);
        assert!(!ok && log.contains(&format!("rendering bad.ejs with `ejs`: bad.ejs:5: {}", message)) && log.contains("  --> bad.ejs:5\n"), "{}\n{}", source, log);
        log
    };
    fails("<%= nope.x %>", "nope is not defined");
    fails("<% if (true) { %>open", "a block opened in a <% %> tag isn't closed (a `}` is missing)");
    fails("<% if (x) {", "this <% tag is never closed (with %>)");
    let log = fails("<%- include('partials/crd') %>", "template not found: can't include `partials/crd`: no sightings in _includes (did you mean `partials/card`?)");
    assert!(log.contains("   5 | <%- include('partials/crd') %>\n     |              ^^^^^^^^^^^^\n"), "{}", log);
    std::fs::remove_file(dir.join("bad.ejs")).unwrap();
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

    // Eleventy's name for it works too, and so does its comma-separated list.
    write("old.md", "---\nname: Bigfoot\ntemplateEngineOverride: \"edge,md\"\n---\n*{{ name }}*\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains("note: templateEngineOverride works; ssqch calls it render (ssqch docs render)"), "{}", log);
    assert_eq!(read("old"), "<p><em>Bigfoot</em></p>\n");
    write("old.md", "---\ntemplateEngineOverride: md\nrender: md\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("`templateEngineOverride` and `render` are two names for one key; set one of them"), "{}", log);
    std::fs::remove_file(dir.join("old.md")).unwrap();

    write("bad.md", "---\nrender: 3\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("`render` must be an engine name"), "{}", log);
}

#[test]
fn leave_no_trace_removes_only_stale_files_ssqch_wrote() {
    let dir = temp_dir("leave-no-trace");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("files")).unwrap();
    let write = |name: &str, body: &str| std::fs::write(dir.join(name), body).unwrap();
    let config = |on: bool| format!("export default {{ leaveNoTrace: {}, passthrough: \"files\" }};\n", on);
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
    // With it off, nothing goes.
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(site.join("gone/index.html").is_file() && site.join("files/old.txt").is_file());

    write("ssqch.config.js", &config(true));
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(log.contains("Removed  2 stale files, left no trace"), "{}", log);
    assert!(!site.join("gone").exists(), "the emptied folder goes too");
    assert!(!site.join("files/old.txt").exists());
    assert!(site.join("keep/index.html").is_file());
    assert!(site.join("assets/index.css").is_file(), "files other tools wrote stay");

    // Nothing stale the next time.
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains("Removed"), "{}", log);

    // `clean` is the option's other name.
    write("ssqch.config.js", "export default { clean: true, passthrough: \"files\" };\n");
    std::fs::remove_file(dir.join("keep.md")).unwrap();
    write("stay.md", "Stay\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains("Removed  1 stale file, left no trace") && !site.join("keep").exists(), "{}", log);
    // One name at a time.
    write("ssqch.config.js", "export default { leaveNoTrace: true, clean: true };\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("leaveNoTrace and clean are two names for one option; set one of them"), "{}", log);
    // In TOML it's `leave_no_trace`, or `clean`.
    std::fs::remove_file(dir.join("ssqch.config.js")).unwrap();
    for key in ["leave_no_trace", "clean"] {
        write("sitesquatch.toml", &format!("{} = true\n", key));
        let (ok, log) = ssqch(&["build", "--root", d]);
        assert!(ok, "{}: {}", key, log);
    }
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
        "import { defineConfig, markdown } from \"ssqch\";\nexport default defineConfig({\n  dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"edge\", \"md\", \"njk\", \"liquid\"],\n  markdownEngine: \"edge\",\n  markdown: { headingIds: \"blackfriday\", smartPunctuation: true },\n  data: { blurb: markdown(\"Made with *care*\", { inline: true }) },\n});\n",
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
    assert!(!ok && log.contains("markdown.footnote isn't an option (did you mean `footnotes`?) (options: headingIds,"), "{}", log);
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
    std::fs::write(dir.join("src/a.jinja"), "{{ page.lastModified.toISOString() }}").unwrap();
    std::fs::write(dir.join("src/b.jinja"), "{{ page.lastModified.toISOString() }}").unwrap();
    git(&["init", "-q"], "2020-01-01T00:00:00Z");
    git(&["add", "."], "2020-01-01T00:00:00Z");
    git(&["commit", "-q", "-m", "first"], "2021-03-04T05:06:07Z");
    std::fs::write(dir.join("src/b.jinja"), "{{ page.lastModified.toISOString() }} ").unwrap();
    git(&["commit", "-q", "-am", "second"], "2022-05-06T07:08:09Z");
    std::fs::write(dir.join("src/c.jinja"), "{{ page.lastModified.getFullYear() }}").unwrap();
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
    assert!(log.contains("No differences: 2 pages and 0 other files are the same. The stump has not moved."), "{}", log);

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

/// `serve.run` starts a watcher with the server, shows its output under its
/// name, and stops it (and what it started) when the server stops.
#[cfg(unix)]
#[test]
fn serve_runs_companion_processes() {
    let dir = temp_dir("serve-companions");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::create_dir_all(dir.join("bin")).unwrap();
    // A stand-in for a CSS watcher: it writes the stylesheet, says so, records its pid and keeps
    // watching until its standard input closes, as Tailwind's and esbuild's `--watch` do.
    let script = "#!/bin/sh\necho $$ > \"$SSQCH_INPUT/../watcher.pid\"\nmkdir -p \"$SSQCH_OUTPUT/assets\"\necho 'body { color: pine; }' > \"$SSQCH_OUTPUT/assets/app.css\"\necho \"wrote app.css, serving=$SSQCH_SERVING\"\ncat > /dev/null\nwhile true; do sleep 0.2; done\n";
    std::fs::write(dir.join("bin/pinecss"), script).unwrap();
    std::process::Command::new("chmod").arg("+x").arg(dir.join("bin/pinecss")).status().unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { dirs: { input: \"src\" }, serve: { run: [\"./bin/pinecss --watch\"] } };\n").unwrap();
    std::fs::write(dir.join("src/index.html"), "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>").unwrap();
    let log = temp_dir("serve-companions-log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--root"]).arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let server = Server(child);
    wait_for(&log, "[pinecss] wrote app.css, serving=true");
    wait_for(&dir.join("_site/assets/app.css"), "color: pine");
    wait_for(&dir.join("watcher.pid"), "\n");
    let pid = std::fs::read_to_string(dir.join("watcher.pid")).unwrap().trim().to_string();
    let alive = |pid: &str| std::process::Command::new("kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().unwrap().success();
    // Still watching a moment later: its standard input is held open.
    std::thread::sleep(std::time::Duration::from_millis(500));
    assert!(alive(&pid) && !std::fs::read_to_string(&log).unwrap().contains("warn:"), "{}", std::fs::read_to_string(&log).unwrap());
    // A build doesn't run them.
    assert!(std::fs::read_to_string(&log).unwrap().contains("[ssqch] serve.run: ./bin/pinecss --watch\n"));
    // Stopping the server stops the watcher.
    std::process::Command::new("kill").args(["-TERM", &server.0.id().to_string()]).status().unwrap();
    let started = std::time::Instant::now();
    while alive(&pid) {
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "the watcher outlived the server:\n{}", std::fs::read_to_string(&log).unwrap_or_default());
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(!std::fs::read_to_string(&log).unwrap().contains("warn:"), "{}", std::fs::read_to_string(&log).unwrap());
    // Not an option it knows: an error that says so.
    std::fs::write(dir.join("ssqch.config.js"), "export default { serve: { runs: [\"x\"] } };\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", dir.to_str().unwrap()]);
    assert!(!ok && log.contains("serve: \"runs\" isn't an option (options: run)"), "{}", log);
}

/// A companion that stopped starts again when the config is saved, and all of them start again
/// when the folders they were given change.
#[cfg(unix)]
#[test]
fn serve_restarts_companions_on_reload() {
    let dir = temp_dir("serve-companions-reload");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/index.html"), "<p>camp</p>").unwrap();
    let config = |extra: &str| format!("export default {{ dirs: {{ input: \"src\"{} }}, serve: {{ run: [\"echo out=$SSQCH_OUTPUT\"] }} }};\n", extra);
    std::fs::write(dir.join("ssqch.config.js"), config("")).unwrap();
    let log = temp_dir("serve-companions-reload-log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--root"]).arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let _server = Server(child);
    let read = || std::fs::read_to_string(&log).unwrap_or_default();
    let wait_count = |text: &str, n: usize| {
        let started = std::time::Instant::now();
        while read().matches(text).count() < n {
            assert!(started.elapsed() < std::time::Duration::from_secs(15), "waiting for {} of {:?}:\n{}", n, text, read());
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };
    wait_count("warn: serve.run: `echo out=$SSQCH_OUTPUT` finished. The server keeps going without it; save the config file to start it again.", 1);
    assert!(read().contains("[echo] out=") && read().contains("_site\n"), "{}", read());
    // Saved as it was: the one that finished starts again.
    std::fs::write(dir.join("ssqch.config.js"), config("")).unwrap();
    wait_count("[ssqch] serve.run: echo out=$SSQCH_OUTPUT", 2);
    // Another output folder: started again, with it.
    std::fs::write(dir.join("ssqch.config.js"), config(", output: \"dist\"")).unwrap();
    wait_count("[ssqch] serve.run: echo out=$SSQCH_OUTPUT", 3);
    wait_count("dist\n", 1);
}

/// A stylesheet a page links that nothing wrote: the page asks the server, which says so once,
/// names what could have written it, and says it again after each build until it's there.
#[test]
fn serve_says_when_a_linked_file_is_missing() {
    let dir = temp_dir("serve-missing");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { dirs: { input: \"src\" } };\n").unwrap();
    std::fs::write(dir.join("src/index.html"), "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp</p>").unwrap();
    let log = temp_dir("serve-missing-log");
    let ready = temp_dir("serve-missing-ready");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--root"]).arg(&dir).arg("--ready-file").arg(&ready).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let _server = Server(child);
    wait_for(&ready, "\"ok\": true");
    let info: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&ready).unwrap()).unwrap();
    let port = info["port"].as_u64().unwrap();
    let ask = |path: &str| -> serde_json::Value {
        use std::io::{Read, Write};
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port as u16)).unwrap();
        write!(stream, "GET /__ssqch/missing?path={} HTTP/1.0\r\n\r\n", path).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        serde_json::from_str(response.split("\r\n\r\n").nth(1).unwrap_or("")).unwrap_or_else(|e| panic!("{}: {}", e, response))
    };
    let said = "/assets/app.css is linked but nothing wrote it to _site. If a tool makes it, run its watcher with `serve.run` (see \"CSS and JavaScript\" in the README)";
    assert_eq!(ask("%2Fassets%2Fapp.css")["message"], said);
    ask("%2Fassets%2Fapp.css");
    // Said once, however many pages ask.
    wait_for(&log, said);
    assert_eq!(std::fs::read_to_string(&log).unwrap().matches(said).count(), 1);
    // Said again after the next build, while it's still missing.
    change_and_wait(&dir.join("src/index.html"), "<link rel=\"stylesheet\" href=\"/assets/app.css\"><p>camp two</p>", &dir.join("_site/index.html"), "camp two");
    let started = std::time::Instant::now();
    while std::fs::read_to_string(&log).unwrap().matches(said).count() < 2 {
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "{}", std::fs::read_to_string(&log).unwrap());
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // There now: nothing to say.
    std::fs::create_dir_all(dir.join("_site/assets")).unwrap();
    std::fs::write(dir.join("_site/assets/app.css"), "body {}").unwrap();
    assert_eq!(ask("%2Fassets%2Fapp.css")["message"], serde_json::Value::Null);
    assert_eq!(ask("%2F..%2Fetc%2Fpasswd")["message"], serde_json::Value::Null);
}

#[test]
fn footprint_weighs_a_build() {
    let dir = temp_dir("footprint");
    let d = dir.to_str().unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: [{ \"src/big.bin\": \"big.bin\" }] };\n").unwrap();
    std::fs::write(dir.join("src/index.html"), "<p>camp</p>").unwrap();
    std::fs::write(dir.join("src/big.bin"), vec![0u8; 5000]).unwrap();
    // Before a build: nothing to weigh.
    let (ok, log) = ssqch(&["footprint", "--root", d]);
    assert!(!ok && log.contains("isn't a folder; build the site first"), "{}", log);
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    // The site's output folder, from its config.
    let (ok, stdout, _) = ssqch_outputs(&["footprint", "--root", d]);
    assert!(ok && stdout.starts_with("Footprint of dist: 2 files, 5.01 KB\n") && stdout.contains("\nLargest footprints: other files\n  5.00 KB  /big.bin\n"), "{}", stdout);
    // Any folder, as JSON, without a config.
    let (ok, stdout, _) = ssqch_outputs(&["footprint", dir.join("dist").to_str().unwrap(), "--format", "json", "--top", "0"]);
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert!(ok && json["files"] == 2 && json["kinds"][0]["kind"] == "Pages" && json["largest"]["pages"] == serde_json::json!([]), "{}", stdout);

    // Budgets: a file over its kind's budget is a warning after the build.
    std::fs::write(dir.join("ssqch.config.js"), "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: [{ \"src/big.bin\": \"big.bin\" }], budgets: { other: \"4 KB\", pages: 1000 } };\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains("warn: /big.bin (5.00 KB) is over the other budget of 4.00 KB\n") && !log.contains("pages budget"), "{}", log);
    let (_, stdout, _) = ssqch_outputs(&["build", "--root", d, "--format", "json"]);
    assert!(stdout.contains("\"code\": \"over-budget\""), "{}", stdout);
    std::fs::write(dir.join("ssqch.config.js"), "export default { budgets: { page: \"100 KB\" } };\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("budgets.page isn't a kind of file (did you mean `pages`?)"), "{}", log);
}

/// An alias works as ssqch's word does, and says ssqch's name once.
#[cfg(feature = "jinja")]
fn alias_works(row: &sitesquatch::equivalents::Equivalent, dir: &std::path::Path) {
    use sitesquatch::equivalents::Kind;
    let d = dir.to_str().unwrap();
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).unwrap();
    let write = |path: &str, text: &str| std::fs::write(dir.join(path), text).unwrap();
    write("ssqch.config.js", "export default {};\n");
    write("index.md", "# Pine\n");
    let read = |path: &str| std::fs::read_to_string(dir.join(path)).unwrap_or_else(|e| panic!("{}: {}: {}", row.word, path, e));
    let (ok, log) = match (row.kind, row.word) {
        // The serving ones are checked in `aliases_rewrite_the_command_line`, without a server.
        (Kind::Command | Kind::Flag, _) if row.ssqch == "serve" => return,
        (Kind::Command, word) => ssqch(&[word, "--root", d]),
        (Kind::Flag, "--pathprefix") => {
            let result = ssqch(&["build", "--pathprefix", "/trail/", "--root", d]);
            assert!(read("_site/index.html").contains("Pine"), "{}", row.word);
            result
        }
        (Kind::Flag, word) => {
            let result = ssqch(&["build", word, "camp", "--root", d]);
            read("camp/index.html");
            result
        }
        (Kind::Config, word) => {
            let value = match word {
                "pathPrefix" => "\"/trail/\"",
                "dir" => "{ output: \"camp\" }",
                "markdownTemplateEngine" | "htmlTemplateEngine" => "\"jinja\"",
                _ => "\"camp\"",
            };
            write("ssqch.config.js", &format!("export default {{ {}: {} }};\n", word, value));
            let result = ssqch(&["build", "--root", d]);
            if !matches!(word, "pathPrefix" | "markdownTemplateEngine" | "htmlTemplateEngine") {
                read("camp/index.html");
            }
            // Both names: an error.
            write("ssqch.config.js", &format!("export default {{ {}: {}, {} }};\n", word, value, match row.ssqch { "dirs" | "dirs.output" => "dirs: { output: \"x\" }".to_string(), name => format!("{}: {}", name, value) }));
            let (both, log) = ssqch(&["build", "--root", d]);
            assert!(!both && log.contains("are two names for one option; set one of them"), "{}: {}", row.word, log);
            result
        }
        (Kind::FrontMatter, word) => {
            let (value, body, want) = match word {
                "eleventyComputed" => ("\n  label: \"{{ title }} trail\"", "{{ label }}", "Pine trail"),
                "eleventyExcludeFromCollections" => (" true", "{{ collections.all | length }}", "<p>0</p>"),
                "redirect_from" => (" [/old/]", "{{ aliases[0] }}", "/old/"),
                _ => (" md", "{{ title }}", "<p>{{ title }}</p>"),
            };
            write("index.md", &format!("---\ntitle: Pine\n{}:{}\n---\n{}\n", word, value, body));
            let result = ssqch(&["build", "--root", d]);
            assert!(read("_site/index.html").contains(want), "{}: {}", row.word, read("_site/index.html"));
            result
        }
        (Kind::Filter, word) => {
            std::fs::remove_file(dir.join("index.md")).unwrap();
            write("index.jinja", &format!("{{{{ \"/x/\" | {} }}}}", word));
            let result = ssqch(&["build", "--root", d]);
            assert!(read("_site/index.html").starts_with(if word == "markdownify" { "&lt;p&gt;/x/" } else { "/x/" }), "{}: {}", row.word, read("_site/index.html"));
            std::fs::remove_file(dir.join("index.jinja")).unwrap();
            result
        }
        (Kind::Global, _) => panic!("{}: a template global can't be an alias", row.word),
    };
    assert!(ok, "{}: {}", row.word, log);
    let note = format!("note: {}\n", row.note());
    assert_eq!(log.matches(&note).count(), 1, "{}: {}", row.word, log);
    assert!(!log.contains("warn:"), "{}: {}", row.word, log);
}

/// Every row of the table of other generators' words: the word is refused (or, in front matter,
/// warned about), what's said is the row's, and the name it gives is one ssqch has.
#[cfg(feature = "jinja")]
#[test]
fn other_generators_words_get_ssqch_names() {
    use sitesquatch::equivalents::{Kind, TABLE};
    let (_, capabilities, _) = ssqch_outputs(&["capabilities", "--format", "json"]);
    let mut known = capabilities.clone();
    for help in [&["build", "--help"][..], &["serve", "--help"], &["init", "--help"], &["new", "--help"], &["--help"]] {
        known.push_str(&ssqch(help).1);
    }
    let readme = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../README.md")).unwrap();
    let dir = temp_dir("equivalents");
    std::fs::create_dir_all(&dir).unwrap();
    let d = dir.to_str().unwrap();
    for row in TABLE {
        // The name it gives exists (`dirs.output` is in `dirs`).
        let name = row.ssqch.split('.').next().unwrap();
        assert!(known.contains(&format!("\"{}\"", name)) || known.contains(&format!("{} ", name)) || readme.contains(&format!("`{}", name)), "{}: ssqch has no {:?}", row.word, name);
        assert!(!row.say.is_empty() && !row.more.is_empty(), "{}", row.word);
        if row.alias {
            alias_works(row, &dir);
            continue;
        }
        let (ok, log) = match row.kind {
            Kind::Command => ssqch(&[row.word]),
            Kind::Flag => {
                let command = match row.word { "--template" => "init", "--kind" => "new", _ => "build" };
                let mut args = vec![command, row.word];
                if command == "new" {
                    args.extend(["posts/pine.md", "notes"]);
                }
                args.extend(["--root", d]);
                ssqch(&args)
            }
            Kind::Config => {
                std::fs::write(dir.join("ssqch.config.js"), format!("export default {{ {}: \"x\" }};\n", row.word)).unwrap();
                ssqch(&["build", "--root", d])
            }
            Kind::FrontMatter => {
                std::fs::write(dir.join("ssqch.config.js"), "export default {};\n").unwrap();
                std::fs::write(dir.join("page.md"), format!("---\n{}: false\n---\nPine.\n", row.word)).unwrap();
                let (ok, log) = ssqch(&["build", "--root", d]);
                std::fs::remove_file(dir.join("page.md")).unwrap();
                assert!(ok && log.contains("warn: page.md sets"), "{}: {}", row.word, log);
                (false, log)
            }
            Kind::Global => {
                std::fs::write(dir.join("ssqch.config.js"), "export default {};\n").unwrap();
                std::fs::write(dir.join("page.jinja"), format!("{{{{ {}.x }}}}", row.word.trim_end_matches('.'))).unwrap();
                let (ok, log) = ssqch(&["build", "--root", d]);
                std::fs::remove_file(dir.join("page.jinja")).unwrap();
                assert!(ok && log.contains("warn: page.jinja uses"), "{}: {}", row.word, log);
                (false, log)
            }
            Kind::Filter => {
                std::fs::write(dir.join("ssqch.config.js"), "export default {};\n").unwrap();
                std::fs::write(dir.join("page.jinja"), format!("{{{{ \"/x/\" | {} }}}}", row.word)).unwrap();
                let result = ssqch(&["build", "--root", d]);
                std::fs::remove_file(dir.join("page.jinja")).unwrap();
                result
            }
        };
        assert!(!ok, "{} worked: {}", row.word, log);
        assert!(log.contains(row.say) && log.contains(&format!("More: {}", row.more)), "{}: {}", row.word, log);
    }
    // A config written as calls gets the same answer.
    std::fs::write(dir.join("ssqch.config.js"), "export default function (config) { config.addPassthroughCopy(\"src/fonts\"); return {}; }\n").unwrap();
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("the config function's argument has no addPassthroughCopy()"), "{}", log);
    // So does a folder with another generator's config and none of ssqch's.
    std::fs::remove_file(dir.join("ssqch.config.js")).unwrap();
    std::fs::write(dir.join(".eleventy.js"), "module.exports = {};\n").unwrap();
    let (ok, stdout, stderr) = ssqch_outputs(&["build", "--root", d, "--format", "json"]);
    assert!(ok && stderr.is_empty(), "{}", stderr);
    let report: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(report["warnings"][0]["code"], "other-generator", "{}", stdout);
    assert!(report["warnings"][0]["message"].as_str().unwrap().starts_with("this folder has an Eleventy config (.eleventy.js) and no ssqch.config.js"), "{}", stdout);
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
    write("src/index.jinja", "{{ shout(greeting) }} {{ info.n }}");
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
    change_and_wait(&dir.join("src/index.jinja"), "plain {{ info.n }}", &page, "plain 2");
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

/// Eleventy's EJS templates render in ssqch as they are: `include()` reads from `_includes` in both.
#[test]
fn import_carries_over_ejs_templates() {
    let dir = temp_dir("import-ejs");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("eleventy.config.js", "module.exports = function (eleventyConfig) {\n  return { dir: { input: \"src\" }, markdownTemplateEngine: false };\n};\n");
    write("src/_includes/base.ejs", "<%- include(\"nav\") %><main><%- content %></main>");
    write("src/_includes/nav.ejs", "<nav><%= title %></nav>");
    write("src/index.ejs", "---\nlayout: base.ejs\ntitle: Camp\neleventyExcludeFromCollections: true\n---\n<% for (const post of collections.all) { %><a href=\"<%= post.url %>\"><%= post.data.title %></a><% } %>");
    write("src/trail.md", "---\nlayout: base.ejs\ntitle: Trail\n---\nOld Growth.\n");
    let (ok, log) = ssqch(&["import", "eleventy", d, "--write"]);
    assert!(ok && log.contains("  src/index.ejs: eleventyExcludeFromCollections -> excludeFromCollections\n"), "{}", log);
    let config = std::fs::read_to_string(dir.join("ssqch.config.js")).unwrap();
    assert!(config.contains("templateFormats: [\"ejs\", \"md\"],"), "{}", config);
    let (ok, log) = ssqch(&["build", "--root", d, "-q"]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("_site").join(path)).unwrap();
    assert_eq!(read("index.html"), "<nav>Camp</nav><main><a href=\"/trail/\">Trail</a></main>");
    assert_eq!(read("trail/index.html"), "<nav>Trail</nav><main><p>Old Growth.</p>\n</main>");
}

/// A site whose input folder is the project root (the default) has ssqch's
/// own `.cache` and the output inside what's watched. Writing them isn't a change.
#[test]
fn serve_does_not_rebuild_for_its_own_files() {
    let dir = temp_dir("serve-root");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.jinja"), "one {{ 1 + 1 }}").unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { clean: true };\n").unwrap();
    // The server's output goes outside the folder it watches: a log in there changes with every build.
    let log = temp_dir("serve-root-log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--root"]).arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let _server = Server(child);
    let page = dir.join("_site/index.html");
    wait_for(&page, "one 2");
    let builds = || std::fs::read_to_string(&log).unwrap_or_default().matches("Built in").count();
    std::thread::sleep(std::time::Duration::from_millis(1500));
    assert_eq!(builds(), 1, "it rebuilt with nothing changed:\n{}", std::fs::read_to_string(&log).unwrap_or_default());
    change_and_wait(&dir.join("index.jinja"), "two {{ 2 + 2 }}", &page, "two 4");
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let said = std::fs::read_to_string(&log).unwrap_or_default();
    assert_eq!(builds(), 2, "{}", said);
    // The server says its name, and what changed.
    assert!(said.contains("Squatch Watch is on. Serving ") && said.contains("Fresh tracks in index.jinja\n"), "{}", said);
    // The first build is the site's first; the rebuild isn't.
    assert_eq!(said.matches("First confirmed siting. Built in").count(), 1, "{}", said);
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

#[test]
fn inspect_says_where_a_page_and_its_data_come_from() {
    let dir = temp_dir("inspect");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    // The hook makes a data file, as a build's would; it and `console.log` mustn't get into the report.
    write(
        "ssqch.config.js",
        "import { writeFileSync } from \"node:fs\";\nconsole.log(\"from the config\");\nexport default {\n  dirs: { input: \"src\", output: \"dist\" },\n  data: { build: () => ({ n: 7 }) },\n  beforeBuild: [() => writeFileSync(\"src/_data/made.json\", \"{ \\\"by\\\": \\\"the hook\\\" }\"), { run: \"echo from-a-command\" }],\n  afterBuild: () => writeFileSync(\"after.txt\", \"ran\"),\n};\n",
    );
    write("src/_data/site.json", "{ \"name\": \"Trails\", \"author\": { \"name\": \"Sam\" } }");
    write("src/_includes/base.jinja", "---\nsection: none\ntheme: light\n---\n{{ content }}");
    write("src/_includes/guide.jinja", "---\nlayout: base.jinja\nsection: guides\n---\n{{ content }}");
    write("src/guides/guides.json", "{ \"layout\": \"guide.jinja\", \"tags\": \"guides\", \"level\": \"easy\", \"permalink\": \"/guides/{{ page.fileSlug }}/\", \"computed\": { \"label\": \"{{ title }} ({{ level }})\" } }");
    write("src/guides/2024-03-02-pine.md", "---\ntitle: Pine\nlevel: hard\nhero: { alt: A pine }\n---\nPine.\n");
    write("src/guides/2024-03-02-pine.json", "{ \"level\": \"medium\", \"reviewed\": true }");
    write("src/tags.jinja", "---\npagination: { data: collections, size: 1, alias: tag }\npermalink: \"/tags/{{ tag }}/\"\n---\n{{ tag }}");
    // The report (standard output), or what went wrong.
    let run = |args: &[&str]| {
        let mut all = vec!["inspect", "--root", d];
        all.extend(args);
        let (ok, stdout, stderr) = ssqch_outputs(&all);
        (ok, if ok { stdout } else { stderr })
    };

    let (ok, log) = run(&["/guides/pine/"]);
    assert!(ok, "{}", log);
    assert!(log.starts_with("/guides/pine/\n  From        src/guides/2024-03-02-pine.md (jinja, md)\n  Writes      dist/guides/pine/index.html\n  Layouts     _includes/guide.jinja > _includes/base.jinja\n  Date        2024-03-02T00:00:00Z (from the file's name)\n  Collections all, guides\n"), "{}", log);
    // The columns are as wide as the longest name, so compare the rows without their padding.
    let rows: Vec<String> = log.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).collect();
    for expected in [
        "site {name, author} src/_data/site.json",
        "build {n} the config's `data`",
        "ssqch {version, generator, env, serving, …} built in",
        "section \"guides\" layout _includes/guide.jinja (over layout _includes/base.jinja)",
        "theme \"light\" layout _includes/base.jinja",
        "layout \"guide.jinja\" src/guides/guides.json",
        "level \"hard\" front matter (over src/guides/guides.json, src/guides/2024-03-02-pine.json)",
        "reviewed true src/guides/2024-03-02-pine.json",
        "hero {alt} front matter",
        "label \"Pine (hard)\" computed",
        "page {url, outputPath, inputPath, fileSlug, …} built in",
    ] {
        assert!(rows.iter().any(|r| r == expected), "missing {:?} in\n{}", expected, log);
    }
    // No page was built, and `afterBuild` didn't run.
    assert!(!dir.join("dist").exists() && !dir.join("after.txt").exists());
    // `beforeBuild` did, since data can depend on it. What it and the config print isn't in the report.
    let (ok, stdout, stderr) = ssqch_outputs(&["inspect", "--root", d, "/guides/pine/", "--field", "made.by", "--format", "json"]);
    assert!(ok, "{}", stderr);
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert_eq!(json["field"], serde_json::json!({ "name": "made.by", "value": "the hook", "from": "src/_data/made.json", "setBy": [{ "from": "src/_data/made.json", "value": "the hook" }] }));
    assert!(stderr.contains("from the config") && stderr.contains("from-a-command"), "{}", stderr);

    // One field, by the template's path, with every level that set it.
    let (ok, log) = run(&["src/guides/2024-03-02-pine.md", "--field", "level"]);
    assert!(ok, "{}", log);
    assert_eq!(log, "level = \"hard\"\n\nSet by (the last one wins):\n    src/guides/guides.json                    \"easy\"\n    src/guides/2024-03-02-pine.json           \"medium\"\n  > front matter                              \"hard\"\n");
    let (ok, log) = run(&["/guides/pine", "--field", "site.author.name", "--format", "json"]);
    assert!(ok, "{}", log);
    let json: serde_json::Value = serde_json::from_str(&log).unwrap_or_else(|e| panic!("{}: {}", e, log));
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["date"], serde_json::json!({ "value": "2024-03-02T00:00:00Z", "from": "the file's name" }));
    assert_eq!(json["field"], serde_json::json!({ "name": "site.author.name", "value": "Sam", "from": "src/_data/site.json", "setBy": [{ "from": "src/_data/site.json", "value": "Sam" }] }));
    let (ok, log) = run(&["/guides/pine/", "--format", "json"]);
    assert!(ok, "{}", log);
    let json: serde_json::Value = serde_json::from_str(&log).unwrap();
    assert_eq!(json["data"]["title"], serde_json::json!({ "value": "Pine", "from": "front matter", "setBy": [{ "from": "front matter", "value": "Pine" }] }));

    // A page of a paginated template, and what goes wrong.
    let (ok, log) = run(&["/tags/guides/", "--field", "tag"]);
    assert!(ok && log.contains("tag = \"guides\"") && log.contains("> pagination (its `alias`)"), "{}", log);
    let (ok, log) = run(&["src/tags.jinja"]);
    assert!(!ok && log.contains("src/tags.jinja makes 2 pages; give the URL of one: /tags/all/, /tags/guides/"), "{}", log);
    let (ok, log) = run(&["/guides/pines/"]);
    assert!(!ok && log.contains("no page at \"/guides/pines/\""), "{}", log);
    let (ok, log) = run(&["/guides/pine/", "--field", "titel"]);
    assert!(!ok && log.contains("/guides/pine/ has no `titel` in its data (it has: "), "{}", log);

    // `index.html` is only the end of a URL when it's a whole part of it.
    write("src/a.md", "---\npermalink: /my/\ntitle: Cedar\n---\n");
    write("src/b.md", "---\npermalink: /myindex.html\ntitle: Pine\n---\n");
    for (url, title) in [("/myindex.html", "\"Pine\""), ("/my/", "\"Cedar\""), ("/my/index.html", "\"Cedar\""), ("/my", "\"Cedar\"")] {
        let (ok, log) = run(&[url, "--field", "title", "--format", "json"]);
        assert!(ok, "{}", log);
        let json: serde_json::Value = serde_json::from_str(&log).unwrap();
        assert_eq!(json["field"]["value"].to_string(), title, "{}: {}", url, log);
    }
}

/// Run `ssqch` and keep its two outputs apart.
fn ssqch_outputs(args: &[&str]) -> (bool, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(args).env("TZ", "UTC").output().unwrap();
    (out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
}

#[test]
fn build_reports_in_json() {
    let dir = temp_dir("build-json");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    let config = |schema: &str| {
        format!(
            "import {{ linksPlugin }} from \"ssqch/links\";\nconsole.log(\"from the config\");\nconsole.warn(\"pine cones are low\");\nexport default {{\n  dirs: {{ input: \"src\", output: \"dist\" }},\n  templateFormats: [\"edge\", \"md\"],\n  passthrough: [\"nothing/**\"],\n  schemas: {{ posts: {{ unknown: \"warn\", fields: {{ {} }} }} }},\n  beforeBuild: {{ run: \"echo from-a-command\" }},\n  plugins: [linksPlugin({{ fail: false }})],\n}};\n",
            schema
        )
    };
    write("ssqch.config.js", &config("title: \"string\""));
    write("src/posts/posts.json", "{ \"tags\": \"posts\" }");
    write("src/posts/pine.md", "---\ntitle: Pine\nextra: 1\n---\n[gone](/nope/)\n");
    write("src/index.edge", "---\ntitle: Home\n---\n\n<p>\n{{ title }}\n");
    let report = |args: &[&str]| {
        let mut all = vec!["build", "--format", "json", "--root", d];
        all.extend(args);
        let (ok, stdout, stderr) = ssqch_outputs(&all);
        // Standard output is the report and nothing else.
        let json: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {:?}\n{}", e, stdout, stderr));
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["ok"], ok, "{}", stdout);
        (json, stderr)
    };

    // A build that works: what it wrote, and its warnings as data.
    let (json, stderr) = report(&[]);
    assert_eq!(json["ok"], true, "{}", json);
    assert_eq!(json["environment"], "production");
    assert_eq!(json["output"], "dist");
    assert_eq!(json["pages"]["written"], 2);
    let mut written: Vec<&str> = json["written"].as_array().unwrap().iter().filter_map(|w| w.as_str()).collect();
    written.sort();
    assert_eq!(written, ["index.html", "posts/pine/index.html"]);
    assert!(json["durationMs"].as_f64().unwrap() > 0.0 && json["timings"][0]["phase"] == "setup", "{}", json);
    assert_eq!(json["summary"][0], serde_json::json!({ "label": "Links", "value": "1 checked, 1 broken" }));
    assert_eq!(json["errors"], serde_json::json!([]));
    assert_eq!(
        json["warnings"],
        serde_json::json!([
            // console.warn in the config is one of the warnings.
            { "code": "console", "message": "pine cones are low" },
            { "code": "schema", "message": "src/posts/pine.md: `extra` isn't a field of this schema (schema `posts`)", "file": "src/posts/pine.md", "field": "extra" },
            { "code": "passthrough", "message": "passthrough glob \"nothing/**\" matches no files" },
            { "code": "links", "message": "/posts/pine/ -> /nope/ (not found)", "url": "/posts/pine/" },
        ])
    );
    // What a person would have read went to standard error.
    for line in ["from the config", "from-a-command", "[ssqch] Writing "] {
        assert!(stderr.contains(line), "missing {:?} in {}", line, stderr);
    }
    assert!(!stderr.contains("warn:") && !stderr.contains("Built in"), "{}", stderr);
    let (_, stderr) = report(&["--quiet"]);
    assert!(!stderr.contains("[ssqch]"), "{}", stderr);

    // Content errors: the file and the field.
    write("ssqch.config.js", &config("title: \"string\", hero: \"string\""));
    let (json, _) = report(&[]);
    assert_eq!(json["errors"], serde_json::json!([{ "code": "schema", "message": "src/posts/pine.md: `hero` is required (a string) (schema `posts`)", "file": "src/posts/pine.md", "field": "hero" }]));
    assert_eq!(json["warnings"][1]["field"], "extra");
    assert!(json.get("pages").is_none(), "{}", json);
    write("ssqch.config.js", &config("title: \"string\""));

    // Template errors: each one apart, with the line of the file (not of the template's body).
    write("src/index.edge", "---\ntitle: Home\n---\n\n<p>\n{{ nope.x }}\n");
    write("src/about.edge", "---\ntitle: About\n---\n@if(title\n");
    let (json, _) = report(&[]);
    let mut errors: Vec<(String, String, u64)> = json["errors"].as_array().unwrap().iter().map(|e| (e["code"].as_str().unwrap().to_string(), e["file"].as_str().unwrap_or("").to_string(), e["line"].as_u64().unwrap_or(0))).collect();
    errors.sort();
    assert_eq!(errors, [("template".to_string(), "src/about.edge".to_string(), 4), ("template".to_string(), "src/index.edge".to_string(), 6)], "{}", json);
    std::fs::remove_file(dir.join("src/about.edge")).unwrap();
    write("src/index.edge", "---\ntitle: [Home\n---\nx\n");
    let (json, _) = report(&[]);
    assert_eq!((&json["errors"][0]["code"], &json["errors"][0]["file"]), (&serde_json::json!("front-matter"), &serde_json::json!("src/index.edge")), "{}", json);
    write("src/index.edge", "---\ntitle: Home\n---\nx\n");

    // A broken link that fails the build names the page.
    write("ssqch.config.js", &config("title: \"string\"").replace("fail: false", "fail: true"));
    let (json, _) = report(&[]);
    assert_eq!(json["errors"], serde_json::json!([{ "code": "links", "message": "/posts/pine/ -> /nope/ (not found)", "url": "/posts/pine/" }]));

    // A config that doesn't load.
    write("ssqch.config.js", "export default {\n  dirs: { input: \"src\" },\n  plugins: [nope()],\n};\n");
    let (json, _) = report(&[]);
    assert_eq!(json["errors"].as_array().unwrap().len(), 1, "{}", json);
    assert_eq!((&json["errors"][0]["code"], &json["errors"][0]["file"], &json["errors"][0]["line"]), (&serde_json::json!("config"), &serde_json::json!("ssqch.config.js"), &serde_json::json!(3)), "{}", json);
    assert!(json.get("output").is_none(), "{}", json);

    // The usual output is as it was.
    write("ssqch.config.js", &config("title: \"string\""));
    let (ok, stdout, stderr) = ssqch_outputs(&["build", "--root", d]);
    assert!(ok && stdout.contains("from the config") && stdout.contains("from-a-command") && stdout.contains("Built in"), "{}\n{}", stdout, stderr);
    assert_eq!(stderr.matches("warn: ").count(), 3, "{}", stderr);
    assert!(stderr.contains("warn: the trail goes cold on 1 broken link:\n  /posts/pine/ -> /nope/ (not found)"), "{}", stderr);
    let (ok, log) = ssqch(&["build", "--format", "yaml", "--root", d]);
    assert!(!ok && log.contains("--format yaml: use text or json"), "{}", log);
}

#[test]
fn capabilities_match_what_a_config_can_use() {
    let (ok, stdout, _) = ssqch_outputs(&["capabilities", "--format", "json"]);
    assert!(ok);
    let caps: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert_eq!(caps["schemaVersion"], 1);
    assert_eq!(caps["version"], env!("CARGO_PKG_VERSION"));
    let names = |value: &serde_json::Value| -> Vec<String> { value.as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect() };
    for (key, expected) in [("commands", "inspect"), ("configOptions", "dirs"), ("configOptions", "plugins"), ("nodeModules", "node:fs"), ("globals", "URL"), ("imageFormats", "webp")] {
        let list = if key == "nodeModules" { names(&caps[key]["available"]) } else { names(&caps[key]) };
        assert!(list.iter().any(|n| n == expected), "{} lacks {}: {:?}", key, expected, list);
    }
    assert_eq!(caps["features"]["avif"], cfg!(feature = "avif"));
    assert_eq!(names(&caps["imageFormats"]).contains(&"avif".to_string()), cfg!(feature = "avif"));
    assert!(names(&caps["nodeModules"]["stubs"]).contains(&"node:http".to_string()) && !names(&caps["nodeModules"]["available"]).contains(&"node:http".to_string()));
    // What a site gets without a config, and what a starter can be written in, the default first.
    let default = if cfg!(feature = "jinja") { "jinja" } else { "edge" };
    assert_eq!(caps["defaults"], serde_json::json!({ "templateFormats": [default, "md", "html"], "markdownEngine": default, "htmlEngine": default }));
    assert_eq!(names(&caps["starterEngines"])[0], default);
    assert!(names(&caps["starterEngines"]).contains(&"edge".to_string()));

    // Every command it lists is one, and it lists them all.
    let (_, help, _) = ssqch_outputs(&["--help"]);
    let listed: Vec<String> = help.lines().skip_while(|l| !l.starts_with("Commands:")).skip(1).take_while(|l| !l.trim().is_empty()).filter_map(|l| l.split_whitespace().next().map(String::from)).filter(|c| c != "help").collect();
    let mut commands = names(&caps["commands"]);
    let mut listed_sorted = listed.clone();
    commands.sort();
    listed_sorted.sort();
    assert_eq!(commands, listed_sorted);

    // A config that uses everything it says is there: each module with its
    // exports, each Node module, each global and each config option.
    let dir = temp_dir("capabilities");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/index.md"), "Hi\n").unwrap();
    let mut config = String::new();
    let mut checks = String::new();
    let modules = caps["modules"].as_array().unwrap();
    let node: Vec<String> = [names(&caps["nodeModules"]["available"]), names(&caps["nodeModules"]["stubs"])].concat();
    for (i, module) in modules.iter().enumerate() {
        config.push_str(&format!("import * as m{} from {};\n", i, module["name"]));
        for export in module["exports"].as_array().unwrap() {
            checks.push_str(&format!("if (typeof m{}[{}] !== \"function\") throw new Error({} + \" lacks \" + {});\n", i, export, module["name"], export));
        }
        assert!(!module["exports"].as_array().unwrap().is_empty(), "{} exports nothing", module["name"]);
    }
    for (i, name) in node.iter().enumerate() {
        config.push_str(&format!("import * as n{} from \"{}\";\n", i, name));
    }
    for global in names(&caps["globals"]) {
        checks.push_str(&format!("if (typeof {} === \"undefined\") throw new Error(\"no {}\");\n", global, global));
    }
    // An option the config doesn't know would be an error; `undefined` leaves each as it is.
    let options: Vec<String> = names(&caps["configOptions"]).iter().map(|o| if o == "dirs" { "dirs: { input: \"src\", output: \"dist\" }".to_string() } else { format!("{}: undefined", o) }).collect();
    config.push_str(&checks);
    config.push_str(&format!("export default {{ {} }};\n", options.join(", ")));
    std::fs::write(dir.join("ssqch.config.js"), &config).unwrap();
    let (ok, log) = ssqch(&["build", "--quiet", "--root", dir.to_str().unwrap()]);
    assert!(ok, "{}\n{}", log, config);

    // Each template language renders a file with each of its extensions.
    let mut formats = Vec::new();
    for language in caps["templateLanguages"].as_array().unwrap() {
        for ext in names(&language["extensions"]) {
            std::fs::write(dir.join(format!("src/page-{}.{}", ext, ext)), "language test\n").unwrap();
            // `.markdown` files come with `md`.
            if ext != "markdown" {
                formats.push(format!("\"{}\"", ext));
            }
        }
    }
    std::fs::write(dir.join("ssqch.config.js"), format!("export default {{ dirs: {{ input: \"src\", output: \"dist\" }}, templateFormats: [{}] }};\n", formats.join(", "))).unwrap();
    let (ok, log) = ssqch(&["build", "--quiet", "--root", dir.to_str().unwrap()]);
    assert!(ok, "{}", log);
    for language in caps["templateLanguages"].as_array().unwrap() {
        for ext in names(&language["extensions"]) {
            let page = std::fs::read_to_string(dir.join(format!("dist/page-{}/index.html", ext))).unwrap_or_else(|e| panic!("page-{}: {}", ext, e));
            assert!(page.contains("language test"), "{}: {}", ext, page);
        }
    }

    let (ok, text, _) = ssqch_outputs(&["capabilities"]);
    assert!(ok && text.starts_with(&format!("What's in the pack: ssqch {}\n  Commands           build, serve, ", env!("CARGO_PKG_VERSION"))) && text.contains("\n  Template languages edge (.edge), markdown (.md, .markdown), html (.html)"), "{}", text);
    assert!(text.contains(&format!("\n  Defaults           templateFormats {0}, md, html; Markdown and HTML through {0}\n", default)), "{}", text);
    let (ok, log) = ssqch(&["capabilities", "--format", "xml"]);
    assert!(!ok && log.contains("--format xml: use text or json"), "{}", log);
}

/// `ssqch docs` keeps up with `ssqch capabilities`: every command, config option and module export
/// it lists has a line on the card and an answer by name, and so does every word in the table of
/// other generators' words, with its hint's `More: ssqch docs ...` answered too.
#[test]
fn docs_answer_for_every_name() {
    let json = |args: &[&str]| -> serde_json::Value {
        let (_, stdout, stderr) = ssqch_outputs(&[&["docs", "--format", "json"][..], args].concat());
        serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{:?}: {}: {}{}", args, e, stdout, stderr))
    };
    let (_, caps, _) = ssqch_outputs(&["capabilities", "--format", "json"]);
    let caps: serde_json::Value = serde_json::from_str(&caps).unwrap();
    let names = |value: &serde_json::Value, key: &str| -> Vec<String> { value.as_array().unwrap().iter().map(|v| v[key].as_str().or(v.as_str()).unwrap().to_string()).collect() };

    // The card has everything capabilities lists, each with a line.
    let card = json(&[]);
    assert_eq!(card["version"], env!("CARGO_PKG_VERSION"));
    let mut commands = names(&card["commands"], "name");
    let mut listed = names(&caps["commands"], "name");
    commands.sort();
    listed.sort();
    assert_eq!(commands, listed);
    assert_eq!(names(&card["configOptions"], "name"), names(&caps["configOptions"], "name"));
    for module in caps["modules"].as_array().unwrap() {
        let on_card = card["modules"].as_array().unwrap().iter().find(|m| m["name"] == module["name"]).unwrap_or_else(|| panic!("the card lacks {}", module["name"]));
        let mut exports = names(&on_card["exports"], "name");
        let mut expected = names(&module["exports"], "name");
        exports.sort();
        expected.sort();
        assert_eq!(exports, expected, "{}", module["name"]);
    }
    for key in ["commands", "configOptions", "templateFunctions"] {
        for row in card[key].as_array().unwrap() {
            assert!(!row["summary"].as_str().unwrap().is_empty(), "{} {} has no description", key, row["name"]);
        }
    }
    for module in card["modules"].as_array().unwrap() {
        for row in module["exports"].as_array().unwrap() {
            assert!(!row["summary"].as_str().unwrap().is_empty(), "{} {} has no description in ssqch.d.ts", module["name"], row["name"]);
        }
    }

    // Each name has an answer: a command its --help, the rest a part of the README that writes it as code.
    for command in names(&card["commands"], "name") {
        let a = json(&[&command]);
        assert!(a["help"].as_str().is_some_and(|h| h.contains(&format!("Usage: ssqch {}", command))), "{}: {}", command, a);
    }
    let mut documented: Vec<String> = names(&card["configOptions"], "name");
    documented.extend(names(&card["templateFunctions"], "name"));
    for module in card["modules"].as_array().unwrap() {
        documented.extend(names(&module["exports"], "name"));
    }
    for name in documented {
        let a = json(&[&name]);
        assert!(a["found"] == true && a["names"].as_array().is_some_and(|n| !n.is_empty()), "{}: {}", name, a);
        assert!(a["section"]["text"].as_str().is_some_and(|t| t.contains(&format!("`{}", name))), "the README doesn't document `{}`: {}", name, a);
    }

    // Another generator's word says ssqch's, and its hint's `More:` answers.
    for row in sitesquatch::equivalents::TABLE {
        let a = json(&["--", row.word]);
        // A word that's ssqch's too, as something else (`watch`, a command elsewhere, is a config option), answers as ssqch's.
        assert!(a["equivalent"]["word"] == row.word || a["names"].as_array().is_some_and(|n| !n.is_empty()), "{}: {}", row.word, a);
        if let Some(query) = row.more.strip_prefix("ssqch docs ") {
            let more = json(&["--", query.trim_matches('"')]);
            assert!(more["help"].is_string() || more["section"]["text"].is_string(), "{}: More: {} has no answer: {}", row.word, row.more, more);
        } else {
            assert!(row.more.ends_with("--help"), "{}: More: {} is neither `ssqch docs` nor --help", row.word, row.more);
        }
    }

    // As text.
    let (ok, text) = ssqch(&["docs", "pathPrefix"]);
    assert!(ok && text.starts_with("`pathPrefix` (Eleventy) works in ssqch too. In ssqch it's `base`") && text.contains("| `base` |"), "{}", text);
    let (ok, text) = ssqch(&["docs", "baseURL"]);
    assert!(ok && text.starts_with("`baseURL` (Hugo) isn't ssqch's word."), "{}", text);
    let (ok, text) = ssqch(&["docs", "content", "schemas"]);
    assert!(ok && text.starts_with("## Content schemas\n"), "{}", text);
    let (ok, text) = ssqch(&["docs"]);
    assert!(ok && text.contains("\n  leaveNoTrace ") && text.contains("\n    imagePlugin ") && text.contains("\nTopics\n  Install, "), "{}", text);
    let (ok, log) = ssqch(&["docs", "pinecone", "crunch", "sightings"]);
    assert!(!ok && log.contains("no tracks of \"pinecone crunch sightings\" in the docs"), "{}", log);
    let (ok, log) = ssqch(&["docs", "leaveNoTrance"]);
    assert!(!ok && log.contains("(did you mean `leaveNoTrace`?)"), "{}", log);

    // Every generator that has a row or a config ssqch recognizes has field notes.
    let mut generators: Vec<&str> = sitesquatch::equivalents::TABLE.iter().flat_map(|e| e.from.iter().copied()).collect();
    generators.extend(sitesquatch::equivalents::OTHER_CONFIGS.iter().map(|(_, g, ..)| *g));
    for generator in generators {
        let (ok, text) = ssqch(&["docs", "--from", &generator.to_lowercase()]);
        assert!(ok && text.starts_with(&format!("{}'s words", generator)), "{}: {}", generator, text);
    }
    let (ok, text) = ssqch(&["docs", "--from", "eleventy"]);
    assert!(ok && text.contains("\n  pathPrefix ") && text.contains("The trailhead (docs/trailheads/from-eleventy.md):\n\n# Trailhead: moving from Eleventy"), "{}", text);
    let (ok, log) = ssqch(&["docs", "--from", "hugoo"]);
    assert!(!ok && log.contains("--from hugoo: no trailhead for that generator (did you mean `hugo`?)"), "{}", log);
}

#[test]
fn serve_writes_a_ready_file() {
    let dir = temp_dir("serve-ready");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "export default { dirs: { input: \"src\", output: \"dist\" }, base: \"/docs/\" };\n").unwrap();
    std::fs::write(dir.join("src/index.md"), "Ready *now*\n").unwrap();
    let ready = dir.join("ready.json");
    // One left by an earlier run mustn't count.
    std::fs::write(&ready, "{ \"port\": 1 }").unwrap();
    let out = std::fs::File::create(dir.join("serve.log")).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--ready-file"]).arg(&ready).arg("--root").arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let server = Server(child);
    wait_for(&ready, "\"schemaVersion\": 1");
    let info: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&ready).unwrap()).unwrap();
    let port = info["port"].as_u64().unwrap();
    assert!(port > 1, "{}", info);
    assert_eq!(info["url"], format!("http://localhost:{}/docs/", port));
    assert_eq!(info["base"], "/docs");
    assert_eq!(info["ok"], true);
    assert_eq!(info["pid"], server.0.id());
    let output = std::path::PathBuf::from(info["output"].as_str().unwrap());
    assert!(output.is_absolute() && output.ends_with("dist"), "{}", info);
    // The first build is done by the time the file is there, and the site is being served.
    assert!(std::fs::read_to_string(output.join("index.html")).unwrap().contains("Ready <em>now</em>"));
    let page = http_get(port as u16, "/docs/");
    assert!(page.starts_with("HTTP/1.1 200") && page.contains("Ready <em>now</em>"), "{}", page);
    assert!(page.contains("X-Powered-By: pine cones"), "{}", page);

    // A page that isn't there, in a site with no 404.html: the server's own page, which is never written.
    std::fs::create_dir_all(output.join("contact")).unwrap();
    std::fs::write(output.join("contact/index.html"), "<p>Contact</p>").unwrap();
    let missing = http_get(port as u16, "/docs/contactt/");
    assert!(missing.starts_with("HTTP/1.1 404") && missing.contains("The trail goes cold at <code>/contactt/</code>"), "{}", missing);
    assert!(missing.contains("Did you mean <a href=\"/docs/contact/\">/contact/</a>?") && missing.contains("<a href=\"/docs/\">Back to the trailhead</a>"), "{}", missing);
    assert!(missing.contains("/__ssqch/build") && !output.join("404.html").exists(), "{}", missing);
    // The site's own 404.html wins.
    std::fs::write(output.join("404.html"), "<p>Mine</p>").unwrap();
    let missing = http_get(port as u16, "/docs/contactt/");
    assert!(missing.starts_with("HTTP/1.1 404") && missing.contains("<p>Mine</p>") && !missing.contains("trail goes cold"), "{}", missing);
    // Outside the base.
    let outside = http_get(port as u16, "/contact/");
    assert!(outside.starts_with("HTTP/1.1 404") && outside.contains("Wrong trailhead: this site is served under /docs/ (its `base`)."), "{}", outside);

    // A port something else has.
    let (ok, log) = ssqch(&["serve", "--port", &port.to_string(), "--root", dir.to_str().unwrap()]);
    assert!(!ok && log.contains(&format!("can't listen on port {}: something else is squatting on it (--port 0 picks a free one)", port)), "{}", log);
}

/// The lines with a Sasquatch in them still say what happened.
#[test]
fn the_ranger_reports_what_happened() {
    let dir = temp_dir("voice");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, templateFormats: [\"edge\", \"md\"], markdownEngine: \"edge\" };\n");

    // Nothing to build.
    std::fs::create_dir_all(dir.join("src")).unwrap();
    write("src/notes.txt", "not a page");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains("Nothing sighted: no file in src matches templateFormats (edge, md).\n"), "{}", log);
    // A site whose input folder is the project root.
    let root_site = temp_dir("voice-root");
    std::fs::create_dir_all(&root_site).unwrap();
    std::fs::write(root_site.join("notes.txt"), "not a page").unwrap();
    let (ok, log) = ssqch(&["build", "--root", root_site.to_str().unwrap()]);
    assert!(ok && log.contains("Nothing sighted: no file in . matches templateFormats (jinja, md, html).\n"), "{}", log);

    // Layouts that lead back to each other: the loop is named.
    write("src/_includes/base.edge", "---\nlayout: wrap.edge\n---\n{{{ content }}}");
    write("src/_includes/wrap.edge", "---\nlayout: base.edge\n---\n{{{ content }}}");
    write("src/index.md", "---\nlayout: base.edge\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("in index.md: we've passed this tree before. Layout loop: base.edge -> wrap.edge -> base.edge"), "{}", log);
    let (_, stdout, _) = ssqch_outputs(&["build", "--format", "json", "--root", d]);
    let report: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert_eq!((&report["errors"][0]["code"], &report["errors"][0]["file"]), (&serde_json::json!("template"), &serde_json::json!("src/index.md")), "{}", stdout);

    // A layout that isn't there, with the one it probably meant.
    write("src/_includes/wrap.edge", "{{{ content }}}");
    write("src/index.md", "---\nlayout: bse\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("in index.md: layout `bse` not found: no sightings in ") && log.contains("_includes (did you mean `base`?)"), "{}", log);
    write("src/index.md", "---\nlayout: nothing-like-it.edge\n---\nHi\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("layout `nothing-like-it.edge` not found: no sightings in ") && !log.contains("did you mean"), "{}", log);

    // An include that isn't there, a config key and a plugin option that are nearly right.
    write("src/_includes/partials/nav.edge", "<nav></nav>");
    write("src/index.md", "---\nlayout: wrap.edge\n---\n@include('partials/navv')\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("index.md:4: @include('partials/navv'): template not found: ") && log.contains("(did you mean `partials/nav`?)"), "{}", log);
    // The line it's about, numbered as the file is, with carets under what the message quotes.
    assert!(log.contains("\n\n  --> src/index.md:4\n   2 | layout: wrap.edge\n   3 | ---\n   4 | @include('partials/navv')\n     |           ^^^^^^^^^^^^^\n"), "{}", log);
    // Colour is for terminals, and this is a pipe.
    assert!(log.starts_with("error: ") && !log.contains('\u{1b}'), "{:?}", log);
    let config = std::fs::read_to_string(dir.join("ssqch.config.js")).unwrap();
    for (bad, expected) in [
        ("export default { templateFormat: [\"md\"] };", "ssqch.config.js: \"templateFormat\" isn't a config option (did you mean \"templateFormats\"?) (options: dirs, "),
        ("export default { output: \"dist\" };", "ssqch.config.js: \"output\" isn't a config option (it goes in dirs: { output: \"...\" }) (options: dirs, "),
        ("export default { dirs: { inptu: \"src\" } };", "ssqch.config.js: dirs.inptu isn't supported (did you mean \"input\"?) (use input, "),
        ("export default { markdown: { footnote: true } };", "markdown.footnote isn't an option (did you mean `footnotes`?) (options: "),
        ("import { imagePlugin } from \"ssqch/image\";\nexport default { plugins: [imagePlugin({ widhts: [300] })] };", "unknown option \"widhts\" (did you mean \"widths\"?) (options: formats, widths, "),
        ("export default { pineCones: 3 };", "ssqch.config.js: \"pineCones\" isn't a config option (options: dirs, "),
    ] {
        write("ssqch.config.js", bad);
        let (ok, log) = ssqch(&["build", "--root", d]);
        assert!(!ok && log.contains(expected), "{}: {}", bad, log);
    }
    write("ssqch.config.js", &config);

    // Two pages for one URL.
    write("src/index.md", "---\nlayout: wrap.edge\n---\nHi\n");
    write("src/about.md", "About\n");
    write("src/about/index.md", "About too\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("output conflicts (two sets of tracks lead to the same place):\n  - about") && log.contains(" both write to "), "{}", log);
    let (_, stdout, _) = ssqch_outputs(&["build", "--format", "json", "--root", d]);
    assert!(stdout.contains("\"code\": \"conflict\""), "{}", stdout);
    std::fs::remove_file(dir.join("src/about/index.md")).unwrap();

    // Drafts are counted in production, and built in development.
    write("src/wip.md", "---\ndraft: true\n---\nNot yet\n");
    write("src/later.md", "---\ndraft: true\n---\nNot yet either\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains("  Drafts  2 unconfirmed (built in development only)\n") && !dir.join("dist/wip").exists(), "{}", log);
    let (ok, stdout, _) = ssqch_outputs(&["build", "--format", "json", "--root", d]);
    let report: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert!(ok && report["drafts"] == 2, "{}", stdout);
    let (ok, log) = ssqch(&["build", "--env", "development", "--root", d]);
    assert!(ok && !log.contains("Drafts") && dir.join("dist/wip/index.html").is_file(), "{}", log);

    // Nothing of ssqch's own is in what a build writes.
    for page in ["index.html", "about/index.html", "wip/index.html"] {
        let html = std::fs::read_to_string(dir.join("dist").join(page)).unwrap().to_lowercase();
        assert!(!html.contains("squatch") && !html.contains("ssqch") && !html.contains("<!--"), "{}: {}", page, html);
    }

    // What's new and what's gone since the last build (the drafts, which development built).
    write("src/extra.md", "Extra\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && log.contains(" (1 new, 2 gone)\n") && !log.contains("Uninhabited"), "{}", log);
    let (ok, stdout, _) = ssqch_outputs(&["build", "--format", "json", "--root", d]);
    let report: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{}: {}", e, stdout));
    assert!(ok && report["pages"]["new"] == 0 && report["pages"]["gone"] == 0, "{}", stdout);
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok && !log.contains(" new") && !log.contains(" gone"), "{}", log);

    // --verbose names the templates nothing used: the layout and the include from above.
    let (ok, log) = ssqch(&["build", "--verbose", "--root", d]);
    assert!(ok && log.contains("Uninhabited: 2 templates that nothing used in this build (src/_includes/base.edge, src/_includes/partials/nav.edge).\n"), "{}", log);

    // Jinja, Nunjucks and EJS includes count too, whichever engine read them.
    let other = temp_dir("uninhabited");
    let o = other.to_str().unwrap();
    for (path, text) in [
        ("ssqch.config.js", "export default { templateFormats: [\"jinja\", \"njk\", \"ejs\"] };\n"),
        ("_includes/nav.jinja", "<nav></nav>"),
        ("_includes/card.jinja", "<div></div>"),
        ("_includes/old.jinja", "old"),
        ("_includes/footer.ejs", "<footer></footer>"),
        ("_includes/spare.ejs", "spare"),
        ("_includes/hooks/heading.jinja", "<h{{ heading.level }}>{{ heading.text }}</h{{ heading.level }}>"),
        ("index.jinja", "{% include \"nav.jinja\" %}"),
        ("about.njk", "{% include \"card.jinja\" %}"),
        ("trail.ejs", "<%- include(\"footer\") %>"),
    ] {
        let path = other.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    let (ok, log) = ssqch(&["build", "--verbose", "--root", o]);
    assert!(ok && log.contains("Uninhabited: 2 templates that nothing used in this build (_includes/old.jinja, _includes/spare.ejs).\n"), "{}", log);

    // Completions for a shell, with every command that's in --help.
    let (ok, script) = ssqch(&["completions", "zsh"]);
    assert!(ok && script.contains("#compdef ssqch") && script.contains("inspect") && script.contains("capabilities") && !script.contains("sighting"), "{}", script);
    let (ok, log) = ssqch(&["completions", "klingon"]);
    assert!(!ok && log.contains("possible values: bash, elvish, fish, powershell, zsh"), "{}", log);

    // `ssqch sighting` is there for whoever finds it, and knows when the site was last built.
    let (ok, log) = ssqch(&["sighting", "--root", d]);
    assert!(ok && log.contains("Image quality meets cryptozoological standards.") && log.contains("Last confirmed siting: 3 pages in dist/, just now."), "{}", log);
    let (_, help) = ssqch(&["--help"]);
    assert!(help.contains("inspect") && !help.contains("sighting"), "{}", help);
    let (_, caps) = ssqch(&["capabilities", "--format", "json"]);
    assert!(!caps.contains("sighting"), "{}", caps);
}

/// What the dev server tells a browser that last heard `since` and is showing `page`.
fn live(port: u16, since: &str, page: &str) -> serde_json::Value {
    let response = http_get(port, &format!("/__ssqch/build?v={}&p={}", since, page.replace('/', "%2F")));
    let body = response.split("\r\n\r\n").nth(1).unwrap_or("");
    serde_json::from_str(body).unwrap_or_else(|e| panic!("{}: {}", e, response))
}

/// The dev server reloads a browser only for the page it's showing, and shows it a build that failed.
#[test]
fn serve_tells_the_browser_what_changed() {
    let dir = temp_dir("serve-live");
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, passthrough: { \"src/site.css\": \"site.css\" } };\n");
    write("src/index.md", "Home\n");
    write("src/about.md", "About\n");
    write("src/site.css", "body { color: green }\n");
    let ready = dir.join("ready.json");
    let log = dir.join("serve.log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--ready-file"]).arg(&ready).arg("--root").arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let _server = Server(child);
    wait_for(&ready, "\"schemaVersion\": 1");
    let port = serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&ready).unwrap()).unwrap()["port"].as_u64().unwrap() as u16;
    let said = || std::fs::read_to_string(&log).unwrap_or_default();
    assert!(said().contains("Pages   2 written from 2 templates, ") && said().contains(" (2 changed)\n"), "{}", said());
    // The address comes after the build's report, so a long build doesn't bury it.
    let report = said();
    assert!(report.find("Built in").unwrap() < report.find("Squatch Watch is on. Serving ").unwrap(), "{}", report);

    // A browser that has just opened the page learns where things stand.
    let first = live(port, "", "/");
    assert_eq!((&first["error"], &first["reload"]), (&serde_json::Value::Null, &serde_json::json!(false)), "{}", first);
    let since = first["id"].as_u64().unwrap().to_string();
    // The page it gets has the script, which isn't in the file.
    assert!(http_get(port, "/").contains("/__ssqch/build?v=") && !std::fs::read_to_string(dir.join("dist/index.html")).unwrap().contains("__ssqch"));

    // Another page changes: only a browser showing that page reloads.
    change_and_wait(&dir.join("src/about.md"), "About us\n", &dir.join("dist/about/index.html"), "About us");
    wait_for(&log, " (1 changed)\n");
    // And again after each rebuild.
    wait_for(&log, "Fresh tracks in src");
    let started = std::time::Instant::now();
    while said().matches("Squatch Watch is on. Serving ").count() < 2 {
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "{}", said());
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert_eq!(live(port, &since, "/")["reload"], false);
    assert_eq!(live(port, &since, "/about/")["reload"], true);

    // A stylesheet is swapped in place.
    change_and_wait(&dir.join("src/site.css"), "body { color: brown }\n", &dir.join("dist/site.css"), "brown");
    let started = std::time::Instant::now();
    loop {
        let now = live(port, &since, "/");
        if now["css"] == serde_json::json!(["/site.css"]) {
            assert_eq!(now["reload"], false, "{}", now);
            break;
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "the stylesheet never changed: {}\n{}", now, said());
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // A build that fails is the browser's to show, and the page it has stays.
    let since = live(port, "", "/")["id"].as_u64().unwrap().to_string();
    std::fs::write(dir.join("src/index.md"), "{{ nope( }}\n").unwrap();
    let started = std::time::Instant::now();
    let broken = loop {
        let now = live(port, &since, "/");
        if !now["error"].is_null() {
            break now;
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "the build never failed:\n{}", said());
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    assert!(broken["error"].as_str().unwrap().contains("index.md") && broken["reload"] == false, "{}", broken);
    assert!(http_get(port, "/").contains("Home"));
    // The tab's icon, for a site without one: each page links to it. And the broken-build one.
    let page = http_get(port, "/");
    assert!(page.contains(r#"<link rel="icon" href="/__ssqch/favicon.svg" type="image/svg+xml">"#), "{}", page);
    for icon in ["/__ssqch/favicon.svg", "/favicon.ico", "/__ssqch/favicon-error.svg"] {
        let response = http_get(port, icon);
        assert!(response.starts_with("HTTP/1.1 200") && response.contains("image/svg+xml") && response.contains("<svg "), "{}: {}", icon, response);
    }
    // Fixed: the error goes, and the page (the same as before it broke) doesn't reload.
    let since = broken["id"].as_u64().unwrap().to_string();
    std::fs::write(dir.join("src/index.md"), "Home\n").unwrap();
    let started = std::time::Instant::now();
    loop {
        let now = live(port, &since, "/");
        if now["error"].is_null() {
            assert_eq!(now["reload"], false, "{}", now);
            break;
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "the build never worked again:\n{}", said());
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// The whole response (status line, headers and body) to a GET from the dev server.
fn http_get(port: u16, path: &str) -> String {
    use std::io::{Read, Write};
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(std::time::Duration::from_secs(10))).unwrap();
    write!(stream, "GET {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", path).unwrap();
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
    String::from_utf8_lossy(&response).into_owned()
}

#[test]
fn new_creates_a_page_from_an_blueprint() {
    let dir = temp_dir("new");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    let read = |path: &str| std::fs::read_to_string(dir.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e));
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, theme: \"theme\" };\n");
    write("src/index.md", "Home\n");
    write("theme/_blueprints/notes.md", "---\ntitle:\nkind: note\n---\n\nFrom the theme.\n");
    let new = |args: &[&str]| {
        let mut all = vec!["new", "--root", d];
        all.extend(args);
        ssqch(&all)
    };
    let today = chrono_free_today();

    // No blueprint: a title from the file's name, and today's date.
    let (ok, log) = new(&["posts/pine-cone-crunch.md"]);
    assert!(ok, "{}", log);
    assert_eq!(log, "Created src/posts/pine-cone-crunch.md with a title and a date (there's no blueprint for it in src/_blueprints/)\n");
    assert_eq!(read("src/posts/pine-cone-crunch.md"), format!("---\ntitle: Pine cone crunch\ndate: {}\n---\n\n", today));
    // Nothing is overwritten.
    let (ok, log) = new(&["posts/pine-cone-crunch.md", "--title", "Other"]);
    assert!(!ok && log.contains("src/posts/pine-cone-crunch.md is already there"), "{}", log);
    assert!(read("src/posts/pine-cone-crunch.md").contains("title: Pine cone crunch"));

    // The folder's blueprint: its front matter is filled in, and its body is copied as it is.
    write("src/_blueprints/posts.md", "---\n# Fill in the description.\ntitle:\ndate:\ndescription:\ndraft: true\n---\n\nThe title is {{ title }}.\n");
    write("src/_blueprints/docs.md", "---\ntitle:\norder: 0\n---\n\nA doc.\n");
    write("src/_blueprints/docs/guides.jinja", "---\ntitle:\n---\n<p>A guide.</p>\n");
    write("src/_blueprints/default.md", "---\ntitle:\n---\n\nA page.\n");
    let (ok, log) = new(&["src/posts/2026-01-05-winter-trails.md", "--title", "Winter trails: a guide", "--set", "tags=[news, trails]", "--set", "draft=false"]);
    assert_eq!((ok, log.as_str()), (true, "Created src/posts/2026-01-05-winter-trails.md from src/_blueprints/posts.md\n"));
    assert_eq!(read("src/posts/2026-01-05-winter-trails.md"), format!("---\n# Fill in the description.\ntitle: \"Winter trails: a guide\"\ndate: {}\ndescription:\ndraft: false\ntags: [news, trails]\n---\n\nThe title is {{{{ title }}}}.\n", today));

    // The most specific folder's blueprint, by the new file's extension; then the folders above; then `default`.
    let (ok, log) = new(&["docs/guides/install.jinja"]);
    assert!(ok && log.ends_with("from src/_blueprints/docs/guides.jinja\n"), "{}", log);
    assert_eq!(read("src/docs/guides/install.jinja"), "---\ntitle: Install\n---\n<p>A guide.</p>\n");
    let (ok, log) = new(&["docs/reference/cli/index.md", "--date", "2026-03-02"]);
    assert!(ok && log.ends_with("from src/_blueprints/docs.md\n"), "{}", log);
    // An index page is named by its folder, and --date adds a date the blueprint doesn't have.
    assert_eq!(read("src/docs/reference/cli/index.md"), "---\ntitle: Cli\norder: 0\ndate: 2026-03-02\n---\n\nA doc.\n");
    let (ok, log) = new(&["about.md"]);
    assert!(ok && log.ends_with("from src/_blueprints/default.md\n"), "{}", log);
    assert_eq!(read("src/about.md"), "---\ntitle: About\n---\n\nA page.\n");
    // By name, and from a theme.
    let (ok, log) = new(&["ideas/cedar.md", "--blueprint", "notes", "--format", "json"]);
    assert!(ok, "{}", log);
    let json: serde_json::Value = serde_json::from_str(&log).unwrap_or_else(|e| panic!("{}: {}", e, log));
    assert_eq!(json, serde_json::json!({ "schemaVersion": 1, "path": "src/ideas/cedar.md", "blueprint": "theme/_blueprints/notes.md", "title": "Cedar", "date": today }));
    assert_eq!(read("src/ideas/cedar.md"), "---\ntitle: Cedar\nkind: note\n---\n\nFrom the theme.\n");

    // A folder and a title: the file is named as the folder's other pages are.
    let (ok, log) = new(&["docs", "--title", "Getting started"]);
    assert_eq!((ok, log.as_str()), (true, "Created src/docs/getting-started.md from src/_blueprints/docs.md\n"));
    // Most of the pages in posts/ have the date in front now.
    write("src/posts/2026-01-09-snow.md", "---\ntitle: Snow\n---\n");
    let (ok, log) = new(&["posts/", "--title", "What's new in 0.4?", "--date", "2026-03-02"]);
    assert_eq!((ok, log.as_str()), (true, "Created src/posts/2026-03-02-whats-new-in-0-4.md from src/_blueprints/posts.md\n"));
    assert!(read("src/posts/2026-03-02-whats-new-in-0-4.md").contains("title: What's new in 0.4?\ndate: 2026-03-02\n"));
    // Folders with an index file.
    write("src/trails/cedar/index.jinja", "---\ntitle: Cedar\n---\n");
    write("src/trails/fir/index.jinja", "---\ntitle: Fir\n---\n");
    std::fs::remove_file(dir.join("src/_blueprints/default.md")).unwrap();
    let (ok, log) = new(&["trails", "--title", "Old Growth Loop"]);
    assert!(ok && log.starts_with("Created src/trails/old-growth-loop/index.jinja with a title and a date"), "{}", log);

    // What goes wrong.
    for (args, expected) in [
        (vec!["posts"], "posts is a folder, so give the page a title to name its file after: ssqch new posts --title \"Pine cones\""),
        (vec!["posts", "--title", "!!!"], "--title \"!!!\" has no letters or digits to name the file after"),
        (vec!["../outside.md"], "../outside.md: a new page goes in the input folder (src/), so give a path from there"),
        (vec!["_data/x.md"], "_data/x.md: _data/ isn't a folder for pages"),
        (vec!["x.md", "--blueprint", "nope"], "no blueprint named \"nope\" in src/_blueprints/ (there's docs, docs/guides, notes, posts)"),
        (vec!["x.md", "--set", "draft"], "--set draft: give a key and a value, like --set draft=true"),
        (vec!["x.md", "--format", "yaml"], "--format yaml: use text or json"),
    ] {
        let (ok, log) = new(&args);
        assert!(!ok && log.contains(expected), "{:?}: {}", args, log);
    }
    assert!(!dir.join("src/x.md").exists() && !dir.join("outside.md").exists());

    // The blueprints aren't pages of the site (the site's or the theme's), and the new pages are.
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    assert!(!dir.join("dist/_blueprints").exists() && !log.contains("_blueprints"), "{}", log);
    assert!(read("dist/about/index.html").contains("A page."));
    assert!(dir.join("dist/posts/pine-cone-crunch/index.html").is_file() && dir.join("dist/trails/old-growth-loop/index.html").is_file());
    // A draft isn't built in production.
    assert!(!dir.join("dist/posts/2026-03-02-whats-new-in-0-4").exists() && dir.join("dist/posts/2026-01-05-winter-trails/index.html").is_file());
}

/// Today's date as `ssqch new` writes it (the local date), without a date crate here.
fn chrono_free_today() -> String {
    let dir = temp_dir("today");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    let (ok, log) = ssqch(&["new", "--root", dir.to_str().unwrap(), "today.md", "--format", "json"]);
    assert!(ok, "{}", log);
    let json: serde_json::Value = serde_json::from_str(&log).unwrap();
    let date = json["date"].as_str().unwrap().to_string();
    assert!(date.len() == 10 && date.starts_with("20"), "{}", date);
    date
}

/// EJS tags in `permalink` and `computed` are rendered, and a relative include in a theme's page
/// or layout starts from that file's folder.
#[test]
fn ejs_data_strings_and_theme_includes() {
    let dir = temp_dir("ejs-data-strings");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { theme: \"themes/trail\", dirs: { input: \"src\" }, templateFormats: [\"ejs\"] };\n");
    write("src/index.ejs", "---\ntitle: pine\npermalink: /<%= title %>/\ncomputed:\n  label: \"<%= title %> trail\"\nlayout: frame.ejs\n---\n<%= label %>\n");
    write("themes/trail/cones.ejs", "<%- include(\"./card.ejs\") %>\n");
    write("themes/trail/card.ejs", "Pine cones");
    write("themes/trail/_includes/frame.ejs", "<main><%- content %></main><%- include(\"./frame-footer\") %>");
    write("themes/trail/_includes/frame-footer.ejs", "<footer>stump</footer>");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("_site").join(path)).unwrap_or_else(|e| panic!("{}: {}\n{}", path, e, log));
    assert_eq!(read("pine/index.html"), "<main>pine trail\n</main><footer>stump</footer>");
    assert_eq!(read("cones/index.html").trim(), "Pine cones");
}

/// A page bundle and a theme leave out a template in a language the site doesn't render (it
/// could be a draft), and a file name that isn't ASCII doesn't trip the check for a date in it.
#[test]
fn bundles_leave_out_unrendered_templates() {
    let dir = temp_dir("bundles-unrendered");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, bundles: true };\n");
    write("src/trail/index.md", "# Trail\n");
    write("src/trail/private.edge", "---\ndraft: true\ninternalNote: not ready to publish\n---\nUnpublished trail notes: {{ internalNote }}\n");
    write("src/trail/notes.md", "---\npermalink: false\n---\nnot rendered here\n");
    write("src/trail/map.svg", "<svg/>");
    write("src/森林步道.md", "# Pine cones\n");
    let (ok, log) = ssqch(&["build", "--root", d, "--env", "production", "--format", "json"]);
    assert!(ok, "{}", log);
    assert!(log.contains("private.edge isn't rendered"), "{}", log);
    let files = walk(&dir.join("dist"));
    assert!(files.iter().any(|f| f.ends_with("trail/map.svg")), "{:?}", files);
    assert!(!files.iter().any(|f| f.ends_with(".edge") || f.ends_with(".md")), "{:?}", files);
    assert!(files.iter().any(|f| f.contains("森林步道")), "{:?}", files);

    // A theme's are left out the same way.
    let dir = temp_dir("theme-unrendered");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, theme: \"themes/trail\" };\n");
    write("src/index.md", "# Trail\n");
    write("themes/trail/private.edge", "---\ndraft: true\ninternalNote: unpublished\n---\nUnpublished trail notes: {{ internalNote }}\n");
    write("themes/trail/cones.svg", "<svg/>");
    let (ok, log) = ssqch(&["build", "--root", d, "--env", "production", "--format", "json"]);
    assert!(ok, "{}", log);
    assert!(log.contains("themes/trail/private.edge isn't rendered"), "{}", log);
    let files = walk(&dir.join("dist"));
    assert!(files.iter().any(|f| f.ends_with("cones.svg")), "{:?}", files);
    assert!(!files.iter().any(|f| f.ends_with(".edge")), "{:?}", files);
}

/// A Sass file's partials beside it, outside the input folder, rebuild its CSS when they change.
#[test]
fn serve_rebuilds_sass_when_a_partial_changes() {
    let dir = temp_dir("serve-sass-partial");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::create_dir_all(dir.join("styles")).unwrap();
    std::fs::write(dir.join("src/index.html"), "<p>camp</p>").unwrap();
    std::fs::write(dir.join("styles/main.scss"), "@use \"colors\";\nbody { color: colors.$pine; }\n").unwrap();
    std::fs::write(dir.join("styles/_colors.scss"), "$pine: green;\n").unwrap();
    std::fs::write(dir.join("ssqch.config.js"), "import { sassPlugin } from \"ssqch/sass\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [sassPlugin({ files: { \"styles/main.scss\": \"/app.css\" } })] };\n").unwrap();
    let log = temp_dir("serve-sass-partial-log");
    let out = std::fs::File::create(&log).unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["serve", "--port", "0", "--root"]).arg(&dir).stdout(out.try_clone().unwrap()).stderr(out).spawn().unwrap();
    let _server = Server(child);
    wait_for(&dir.join("dist/app.css"), "green");
    std::thread::sleep(std::time::Duration::from_millis(300));
    std::fs::write(dir.join("styles/_colors.scss"), "$pine: orange;\n").unwrap();
    wait_for(&dir.join("dist/app.css"), "orange");
}

/// An alias is read as ssqch's key in its own layer of the cascade, so a page's `computed` is
/// still above its folder's `eleventyComputed`; and a schema that flags unknown keys knows it.
#[test]
fn aliases_keep_their_place_in_the_cascade() {
    let dir = temp_dir("alias-cascade");
    let d = dir.to_str().unwrap();
    let write = |path: &str, text: &str| {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    };
    write("ssqch.config.js", "export default { dirs: { input: \"src\", output: \"dist\" }, schemas: { pages: { files: [\"**/*.md\"], fields: {}, unknown: \"error\" } } };\n");
    write("src/posts/posts.json", "{ \"eleventyComputed\": { \"title\": \"Directory\" }, \"redirect_from\": [\"/old-trail/\"] }\n");
    write("src/posts/pine.md", "---\ncomputed:\n  title: Page\n---\n{{ title }}\n");
    write("src/posts/cedar.md", "---\neleventyComputed:\n  title: Cedar\nredirect_from: []\n---\n{{ title }}\n");
    let (ok, log) = ssqch(&["build", "--root", d, "--format", "json"]);
    assert!(ok, "{}", log);
    let read = |path: &str| std::fs::read_to_string(dir.join("dist").join(path)).unwrap_or_else(|e| panic!("{}: {}\n{}", path, e, log));
    assert_eq!(read("posts/pine/index.html").trim(), "<p>Page</p>");
    assert_eq!(read("posts/cedar/index.html").trim(), "<p>Cedar</p>");

    // Both names in one layer is still an error, naming the file.
    write("src/posts/posts.json", "{ \"eleventyComputed\": {}, \"computed\": {} }\n");
    let (ok, log) = ssqch(&["build", "--root", d]);
    assert!(!ok && log.contains("posts.json") && log.contains("`eleventyComputed` and `computed` are two names for one key"), "{}", log);
}
