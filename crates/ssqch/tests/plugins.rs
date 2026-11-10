//! The `ssqch` binary running configs that use the built-in plugin modules:
//! `ssqch/image`, `ssqch/rss` and `ssqch/minify`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

const PNG: &[u8] = include_bytes!("fixtures/squatch.png");

fn project(files: &[(&str, &[u8])]) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!("ssqch-plugins-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, bytes) in files {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    dir
}

/// Run `ssqch build` in `root`: (success, stdout + stderr).
fn ssqch(root: &Path) -> (bool, String) {
    ssqch_with(root, &[])
}

/// `ssqch build --root <root>` plus `args`.
fn ssqch_with(root: &Path, args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).arg("build").arg("--root").arg(root).args(args).env("TZ", "UTC").output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

fn read(root: &Path, path: &str) -> String {
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

const CONFIG: &str = r#"
import { defineConfig } from "ssqch";
import { imagePlugin } from "ssqch/image";
import { rssPlugin, absoluteUrl } from "ssqch/rss";
import { minifyPlugin } from "ssqch/minify";

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  filters: { abs: (url) => absoluteUrl(url, "https://example.com/blog/") },
  plugins: [
    // Listed before the image plugin, but minifying still runs after images.
    env === "production" && minifyPlugin(),
    imagePlugin({ formats: ["webp", "auto"], widths: [16, 32], defaultAttributes: { loading: "lazy" }, webpQuality: 80 }),
    rssPlugin(),
  ],
}));
"#;

const HERO: &str = r#"
import { image } from "ssqch/image";
export default async function () {
  const derivatives = await image("src/img/squatch.png", { widths: [24, "auto"], formats: ["webp", "png"] });
  return { formats: Object.keys(derivatives), png: derivatives.png.map((e) => `${e.width}x${e.height} ${e.sourceType} ${e.url.startsWith("/img/")} ${e.size > 0}`) };
}
"#;

const PAGE: &str = "---\ndate: 2026-03-14\n---\n<!-- a comment -->\n<p>\n  <img src=\"/img/squatch.png\" alt=\"Squatch\">\n  <img src=\"/img/squatch.png\" alt=\"Small\" ssqch:widths=\"16\">\n  <img src=\"/img/squatch.png\" alt=\"Plain\" ssqch:ignore>\n</p>\n<p>{{ hero.formats.join(',') }} | {{ hero.png.join(' / ') }}</p>\n<p>{{ abs('#top') }} {{ abs('https://example.com') }} {{ dateToRfc3339(page.date) }}</p>\n";

#[test]
fn the_built_in_plugins_work_together() {
    let root = project(&[
        ("ssqch.config.js", CONFIG.as_bytes()),
        ("src/_data/hero.js", HERO.as_bytes()),
        ("src/img/squatch.png", PNG),
        ("src/index.edge", PAGE.as_bytes()),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    let html = read(&root, "dist/index.html");

    // The image transform ran before minifying, and its markup was minified with the rest.
    assert!(!html.contains("a comment") && !html.contains("\n"), "{}", html);
    assert!(html.contains("<picture><source type=\"image/webp\" srcset=\"/img/"), "{}", html);
    assert!(html.contains("-16.webp 16w,/img/") && html.contains("-32.webp 32w"), "{}", html);
    assert!(html.contains("loading=\"lazy\"") && html.contains("width=\"32\" height=\"16\""), "{}", html);

    // Per-image attributes: ssqch:widths picks the widths, ssqch:ignore leaves the tag alone.
    assert!(html.contains("alt=\"Small\""), "{}", html);
    assert!(html.contains("<img src=\"/img/squatch.png\" alt=\"Plain\">"), "{}", html);
    assert!(!html.contains("ssqch:"), "ssqch: attributes are removed from the output: {}", html);

    // image() in a data file shares the plugin's processor.
    assert!(html.contains("webp,png | 24x12 image/png true true / 64x32 image/png true true"), "{}", html);

    // RSS plugin filters and the named absoluteUrl export (WHATWG URL rules).
    assert!(html.contains("https://example.com/blog/#top https://example.com/ 2026-03-14T00:00:00Z"), "{}", html);

    // A line per page written and per image encoded.
    assert!(log.contains("[ssqch] Writing ./dist/index.html from ./src/index.edge (edge)"), "{}", log);
    assert!(log.contains("[ssqch] Encoded ./src/img/squatch.png into "), "{}", log);
    assert!(!log.contains("warn"), "{}", log);

    // The summary at the end: every image file is new on the first build, and reused on the next.
    assert!(log.contains("Built in ") && log.contains(" (production)\n"), "{}", log);
    assert!(log.contains("  Pages   1 written from 1 template, "), "{}", log);
    assert!(log.contains("  Images  8 files from 1 source, ") && log.contains(": 8 encoded, 0 reused"), "{}", log);
    assert!(log.contains("  Output  dist: 9 files, "), "{}", log);
    assert!(log.contains("  Time    setup ") && log.contains(", write "), "{}", log);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert!(log.contains(": 0 encoded, 8 reused"), "{}", log);
}

#[test]
fn bad_plugin_options_fail_clearly() {
    let cases: [(&str, &[u8], &str); 4] = [
        (
            "ssqch.config.js",
            b"import { imagePlugin } from \"ssqch/image\"; export default { plugins: [imagePlugin({ sharpWebpOptions: { quality: 80 } })] };",
            "plugin \"ssqch/image\": unknown option \"sharpWebpOptions\" (options: formats, widths",
        ),
        (
            "src/_data/hero.js",
            b"import { image } from \"ssqch/image\"; export default () => image(\"src/img/squatch.png\", { outputDir: \"./public/images\" });",
            "image(): unknown option \"outputDir\" (options: widths, formats, name; encoder settings go on imagePlugin())",
        ),
        ("src/_data/hero.js", b"import { image } from \"ssqch/image\"; export default () => image(\"https://example.com/a.png\");", "image(): remote images aren't supported"),
        ("src/_data/hero.js", b"import { minify } from \"ssqch/minify\"; export default () => minify(\"<p>\", { useShortDoctype: true });", "minify(): unknown option \"useShortDoctype\""),
    ];
    for (file, source, want) in cases {
        let mut files: Vec<(&str, &[u8])> = vec![("src/img/squatch.png", PNG), ("src/index.edge", b"{{ hero }}")];
        if file != "ssqch.config.js" {
            files.push(("ssqch.config.js", b"export default { dirs: { input: \"src\", output: \"dist\" } };"));
        }
        files.push((file, source));
        let root = project(&files);
        let (ok, log) = ssqch(&root);
        assert!(!ok, "expected a failure for {}", want);
        assert!(log.contains(want), "wanted: {}\n  got: {}", want, log);
    }
}

const ASSETS_CONFIG: &[u8] = br#"
import { assetsPlugin } from "ssqch/assets";
export default {
  dirs: { input: "src", output: "dist" },
  plugins: [assetsPlugin({ files: ["/assets/index.css", "/assets/index.js"] })],
};
"#;

const ASSETS_PAGE: &[u8] = b"<link rel=\"stylesheet\" href=\"/assets/index.css\"><link rel=\"preload\" href=\"/assets/index.js?v=2\" as=\"script\"><script src=\"/assets/index.js\" defer></script><p>{{ assetUrl('/assets/index.css') }}</p>";

#[test]
fn assets_are_fingerprinted_in_production_builds() {
    // The CSS and JS tools write into the output folder before ssqch runs.
    let root = project(&[
        ("ssqch.config.js", ASSETS_CONFIG),
        ("src/index.edge", ASSETS_PAGE),
        ("dist/assets/index.css", b"body { color: green }"),
        ("dist/assets/index.js", b"console.log('squatch');"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    let html = read(&root, "dist/index.html");
    let css = std::fs::read_dir(root.join("dist/assets")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).find(|n| n.ends_with(".css")).unwrap();
    assert!(css.len() == "index.12345678.css".len() && css.starts_with("index.") && css != "index.css", "{}", css);
    assert!(!root.join("dist/assets/index.css").exists() && !root.join("dist/assets/index.js").exists(), "plain files are renamed");
    assert!(html.contains(&format!("href=\"/assets/{}\"", css)), "{}", html);
    assert!(html.contains(&format!("<p>/assets/{}</p>", css)), "assetUrl() returns the fingerprinted URL: {}", html);
    assert!(html.contains(".js?v=2\"") && !html.contains("\"/assets/index.js"), "every reference to index.js is rewritten, keeping the query: {}", html);
    assert!(log.contains("  Assets  2 fingerprinted (index."), "{}", log);

    // A second build without rebuilding the CSS and JS reuses the fingerprinted files.
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert_eq!(read(&root, "dist/index.html"), html);
}

#[test]
fn development_builds_use_the_plain_paths() {
    let root = project(&[
        ("ssqch.config.js", ASSETS_CONFIG),
        ("src/index.edge", ASSETS_PAGE),
        ("dist/assets/index.css", b"body { color: green }"),
        ("dist/assets/index.js", b"console.log('squatch');"),
    ]);
    let (ok, log) = ssqch_with(&root, &["--env", "development"]);
    assert!(ok, "{}", log);
    let html = read(&root, "dist/index.html");
    assert!(html.contains("href=\"/assets/index.css\"") && html.contains("<p>/assets/index.css</p>"), "{}", html);
    assert!(root.join("dist/assets/index.css").exists(), "nothing is renamed");
    assert!(!log.contains("Assets"), "{}", log);
}

#[test]
fn a_missing_asset_fails_a_production_build() {
    let root = project(&[("ssqch.config.js", ASSETS_CONFIG), ("src/index.edge", ASSETS_PAGE), ("dist/assets/index.css", b"body {}")]);
    let (ok, log) = ssqch(&root);
    assert!(!ok);
    assert!(log.contains("index.js doesn't exist; build the CSS and JS before ssqch"), "{}", log);
}

const LINKS_CONFIG: &[u8] = br#"
import { linksPlugin } from "ssqch/links";
export default {
  dirs: { input: "src", output: "dist" },
  plugins: [linksPlugin({ ignore: ["/downloads/"] })],
};
"#;

fn links_site(index: &[u8]) -> PathBuf {
    project(&[
        ("ssqch.config.js", LINKS_CONFIG),
        ("src/index.edge", index),
        ("src/about.edge", b"---\npermalink: /about/\n---\n<h2 id=\"team\">Team</h2>"),
        ("src/feed.xml", b"<feed/>"),
        ("src/_redirects", b"/old-post /about/ 301\n/archive/* /about/ 301\n"),
    ])
}

#[test]
fn the_link_checker_passes_a_clean_site() {
    let root = links_site(
        b"<h1 id=\"top\">Hi</h1><a href=\"/about/\">about</a><a href=\"/about/#team\">team</a><a href=\"about/\">relative</a><a href=\"#top\">top</a><a href=\"/feed.xml\">feed</a><a href=\"/old-post\">redirected</a><a href=\"/archive/2019/\">archived</a><a href=\"/downloads/missing.zip\">ignored</a><a href=\"https://example.com/nope\">external</a><a href=\"mailto:squatch@example.com\">mail</a>",
    );
    std::fs::write(root.join("src/_redirects"), "/old-post /about/ 301\n/archive/* /about/ 301\n").unwrap();
    let config = String::from_utf8_lossy(LINKS_CONFIG).replace("dirs: { input: \"src\", output: \"dist\" },", "dirs: { input: \"src\", output: \"dist\" },\n  templateFormats: [\"edge\"],\n  passthrough: [\"src/_redirects\", \"src/feed.xml\"],");
    std::fs::write(root.join("ssqch.config.js"), config).unwrap();
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert!(log.contains("  Links   "), "{}", log);
    assert!(log.contains("checked, 0 broken"), "{}", log);
}

#[test]
fn broken_links_fail_a_production_build_and_warn_in_development() {
    let root = links_site(b"<a href=\"/abuot/\">typo</a><a href=\"/about/#tema\">anchor</a><a href=\"#nowhere\">here</a><img src=\"/img/missing.png\" alt=\"\">");
    let (ok, log) = ssqch(&root);
    assert!(!ok, "{}", log);
    assert!(log.contains("4 broken links:"), "{}", log);
    assert!(log.contains("/ -> /abuot/ (not found)"), "{}", log);
    assert!(log.contains("/ -> /about/#tema (no id \"tema\" on that page)"), "{}", log);
    assert!(log.contains("/ -> #nowhere (no id \"nowhere\" on this page)"), "{}", log);
    assert!(log.contains("/ -> /img/missing.png (not found)"), "{}", log);

    let (ok, log) = ssqch_with(&root, &["--env", "development"]);
    assert!(ok, "{}", log);
    assert!(log.contains("warn: 4 broken links:") && log.contains("checked, 4 broken"), "{}", log);
}

fn linked_images_site(options: &str) -> PathBuf {
    let config = format!(
        "import {{ imagePlugin }} from \"ssqch/image\";\nexport default {{ dirs: {{ input: \"src\", output: \"dist\" }}, plugins: [imagePlugin({{ formats: [\"webp\", \"auto\"], widths: [16, 48]{} }})] }};",
        options
    );
    let page = "<a href=\"/img/squatch.png\"><img src=\"/img/squatch.png\" width=\"16\" alt=\"Squatch\"></a>\n<a href=\"img/squatch.png\" ssqch:ignore>raw</a>\n<a href=\"/about/\">about</a>\n<a href=\"/img/missing.png\">missing</a>";
    project(&[("ssqch.config.js", config.as_bytes()), ("src/img/squatch.png", PNG), ("src/index.edge", page.as_bytes())])
}

#[test]
fn links_to_images_point_at_a_generated_copy() {
    let root = linked_images_site("");
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    let html = read(&root, "dist/index.html");
    let first = html.lines().next().unwrap();
    // The source is 64 px wide; the largest configured width is 48, so the link gets a 48 px PNG.
    let href = first.split("href=\"").nth(1).unwrap().split('"').next().unwrap();
    assert!(href.starts_with("/img/") && href.ends_with("-48.png"), "{}", first);
    assert!(root.join("dist").join(href.trim_start_matches('/')).is_file(), "{} exists", href);
    assert!(first.contains("<picture>"), "the image inside is still a <picture>: {}", first);
    assert!(html.contains("<a href=\"img/squatch.png\">raw</a>"), "ssqch:ignore keeps the link (and is removed): {}", html);
    assert!(html.contains("<a href=\"/about/\">about</a>"), "links to pages are left alone: {}", html);
    assert!(html.contains("<a href=\"/img/missing.png\">") && log.contains("linked image not found: /img/missing.png"), "{}\n{}", html, log);
}

#[test]
fn linked_images_can_be_turned_off() {
    let root = linked_images_site(", linkedImages: false");
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert!(read(&root, "dist/index.html").starts_with("<a href=\"/img/squatch.png\">"), "{}", read(&root, "dist/index.html"));
}


#[test]
fn sitemap_and_redirects() {
    let root = project(&[
        (
            "ssqch.config.js",
            br#"
import { sitemapPlugin } from "ssqch/sitemap";
import { redirectsPlugin } from "ssqch/redirects";
import { linksPlugin } from "ssqch/links";
export default {
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md", "txt"],
  plugins: [
    sitemapPlugin({ url: "https://example.com/", exclude: ["/tags/**"] }),
    redirectsPlugin({ netlify: true, redirects: { "/feed/": "/feed.xml", "/elsewhere": "https://other.example/" } }),
    linksPlugin(),
  ],
};
"#,
        ),
        ("src/index.md", b"---\ndate: 2024-01-02\n---\nHome, see [the post](/2019/pine/)."),
        ("src/posts/pine.md", b"---\ndate: 2024-03-04\naliases: [/2019/pine/, /pine.html]\n---\nPine"),
        ("src/secret.md", b"---\nsitemap: false\n---\nshh"),
        ("src/tags/x.md", b"tag page"),
        ("src/404.md", b"---\npermalink: /404.html\n---\nnope"),
        ("src/feed.edge", b"---\npermalink: /feed.xml\n---\n<rss/>"),
        ("src/redirects.txt", b"---\npermalink: /_redirects\n---\n/mine  /  302"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    let sitemap = read(&root, "dist/sitemap.xml");
    assert!(sitemap.contains("<loc>https://example.com/</loc>\n    <lastmod>2024-01-02</lastmod>"), "{}", sitemap);
    assert!(sitemap.contains("<loc>https://example.com/posts/pine/</loc>\n    <lastmod>2024-03-04</lastmod>"), "{}", sitemap);
    for left_out in ["secret", "tags", "404", "feed", "2019"] {
        assert!(!sitemap.contains(left_out), "{} in {}", left_out, sitemap);
    }
    let page = read(&root, "dist/2019/pine/index.html");
    assert!(page.contains("<meta http-equiv=\"refresh\" content=\"0; url=/posts/pine/\">") && page.contains("<link rel=\"canonical\" href=\"/posts/pine/\">"), "{}", page);
    assert!(read(&root, "dist/pine.html").contains("url=/posts/pine/"));
    assert!(read(&root, "dist/elsewhere/index.html").contains("url=https://other.example/"));
    assert_eq!(
        read(&root, "dist/_redirects"),
        "/mine  /  302\n/2019/pine/  /posts/pine/  301\n/elsewhere  https://other.example/  301\n/feed/  /feed.xml  301\n/pine.html  /posts/pine/  301\n"
    );
    // A second build doesn't add the lines twice.
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert_eq!(read(&root, "dist/_redirects").matches("/pine.html").count(), 1);

    // An alias that's another page's URL.
    std::fs::write(root.join("src/secret.md"), "---\nsitemap: false\naliases: /posts/pine/\n---\nshh").unwrap();
    let (ok, log) = ssqch(&root);
    assert!(!ok && log.contains("./src/secret.md: /posts/pine/ is the URL of src/posts/pine.md"), "{}", log);
    std::fs::write(root.join("ssqch.config.js"), "import { sitemapPlugin } from \"ssqch/sitemap\";\nexport default { plugins: [sitemapPlugin({ url: \"example.com\" })] };").unwrap();
    let (ok, log) = ssqch(&root);
    assert!(!ok && log.contains("url must be the site's address, like \"https://example.com\""), "{}", log);
}

#[test]
fn assets_get_integrity_hashes() {
    let root = project(&[
        ("ssqch.config.js", b"import { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [assetsPlugin({ files: [\"/app.css\"], integrity: true })] };"),
        ("src/index.html", b"<link rel=\"stylesheet\" href=\"/app.css\">"),
        ("dist/app.css", b"abc"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    let html = read(&root, "dist/index.html");
    assert!(html.contains("integrity=\"sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn\""), "{}", html);
    // Not without fingerprinting (ssqch serve), where a watcher may rewrite the file.
    std::fs::write(root.join("dist/app.css"), "abc").unwrap();
    let (ok, log) = ssqch_with(&root, &["--env", "development"]);
    assert!(ok, "{}", log);
    assert!(!read(&root, "dist/index.html").contains("integrity"));
}

#[test]
fn sass_compiles_folders_and_files() {
    let root = project(&[
        ("ssqch.config.js", b"import { sassPlugin } from \"ssqch/sass\";\nimport { linksPlugin } from \"ssqch/links\";\nimport { assetsPlugin } from \"ssqch/assets\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, plugins: [sassPlugin({ files: { \"styles\": \"/css\", \"print.sass\": \"/print.css\" } }), assetsPlugin({ files: [\"/css/app.css\"] }), linksPlugin()] };"),
        ("styles/app.scss", b"@use \"colors\";\nbody { color: colors.$pine; a { color: red; } }\n"),
        ("styles/_colors.scss", b"$pine: #01796f;\n"),
        ("styles/pages/blog.scss", b".post { margin: 0 auto; }\n"),
        ("print.sass", b"body\n  font-size: 12pt\n"),
        ("src/index.html", b"<link rel=\"stylesheet\" href=\"/css/app.css\"><link rel=\"stylesheet\" href=\"/css/pages/blog.css\"><link rel=\"stylesheet\" href=\"/print.css\">"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert!(log.contains("Sass    3 files (compressed)"), "{}", log);
    assert!(log.contains("Links   3 checked, 0 broken"), "{}", log);
    // The assets plugin fingerprinted the compiled CSS.
    let html = read(&root, "dist/index.html");
    let app = html.split('"').find(|s| s.starts_with("/css/app.") && s.ends_with(".css")).unwrap_or_else(|| panic!("{}", html)).to_string();
    assert_eq!(read(&root, &format!("dist{}", app)), "body{color:#01796f}body a{color:red}");
    assert_eq!(read(&root, "dist/css/pages/blog.css"), ".post{margin:0 auto}");
    assert_eq!(read(&root, "dist/print.css"), "body{font-size:12pt}");
    assert!(!root.join("dist/css/_colors.css").exists());

    // Expanded in development, and a mistake names the file.
    let (ok, log) = ssqch_with(&root, &["--env", "development"]);
    assert!(ok, "{}", log);
    assert!(read(&root, "dist/css/pages/blog.css").contains(".post {\n  margin: 0 auto;\n}"));
    std::fs::write(root.join("styles/pages/blog.scss"), ".post { color: $missing; }").unwrap();
    let (ok, log) = ssqch(&root);
    assert!(!ok && log.contains("styles/pages/blog.scss") && log.contains("Undefined variable"), "{}", log);
}

#[test]
fn a_base_goes_in_front_of_urls_from_the_root() {
    let root = project(&[
        (
            "ssqch.config.js",
            br#"
import { sitemapPlugin } from "ssqch/sitemap";
import { redirectsPlugin } from "ssqch/redirects";
import { linksPlugin } from "ssqch/links";
import { imagePlugin } from "ssqch/image";
import { sassPlugin } from "ssqch/sass";
export default {
  dirs: { input: "src", output: "dist" },
  base: "/repo/",
  plugins: [
    imagePlugin({ formats: ["webp"], widths: [16] }),
    sassPlugin({ files: { "styles/site.scss": "/site.css" } }),
    sitemapPlugin({ url: "https://you.github.io" }),
    redirectsPlugin(),
    linksPlugin(),
  ],
};
"#,
        ),
        ("styles/site.scss", b"body { background: url(/img/squatch.png); }"),
        ("src/img/squatch.png", PNG),
        ("src/_includes/layout.edge", b"<html><head><link rel=\"stylesheet\" href=\"/site.css\"></head><body><nav><a href=\"/\">Home</a> <a href=\"/about/#team\">About</a> <a href=\"https://you.github.io/other-project/\">Other</a></nav>{{{ content }}}<script>const feed = \"{{ withBase('/feed.json') }}\";</script><p>{{ page.url }} {{ ssqch.base }}</p></body></html>"),
        ("src/index.md", b"---\nlayout: layout.edge\n---\nSee [about](/about/), [next door](about/) and [the old page](/old/).\n\n![Squatch](/img/squatch.png)\n"),
        ("src/about.md", b"---\nlayout: layout.edge\naliases: /old/\n---\n## Team\n"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert!(log.contains("0 broken"), "{}", log);
    // The output folder is the same with or without a base.
    let home = read(&root, "dist/index.html");
    for expected in [
        "<link rel=\"stylesheet\" href=\"/repo/site.css\">",
        "<a href=\"/repo/\">Home</a>",
        "<a href=\"/repo/about/#team\">About</a>",
        "<a href=\"/repo/about/\">about</a>",
        "<a href=\"about/\">next door</a>",
        "const feed = \"/repo/feed.json\";",
        "<p>/ /repo</p>",
        "decoding=\"async\" src=\"/repo/img/",
    ] {
        assert!(home.contains(expected), "missing {}\nin {}", expected, home);
    }
    assert!(!home.contains("/repo/repo"), "{}", home);
    assert!(read(&root, "dist/site.css").contains("url(/repo/img/squatch.png)"));
    assert!(read(&root, "dist/sitemap.xml").contains("<loc>https://you.github.io/repo/about/</loc>"));
    let old = read(&root, "dist/old/index.html");
    assert!(old.contains("url=/repo/about/") && old.contains("location.replace(\"/repo/about/\" + location.hash)"), "{}", old);

    // --base wins over the config. A broken link is still caught, and reported as the template has it.
    std::fs::write(root.join("src/about.md"), "---\nlayout: layout.edge\naliases: /old/\n---\n## Team\n\n[gone](/nope/)\n").unwrap();
    let (ok, log) = ssqch_with(&root, &["--base", "/preview/pr-7"]);
    assert!(!ok && log.contains("1 broken link:\n  /about/ -> /nope/ (not found)"), "{}", log);
    assert!(read(&root, "dist/about/index.html").contains("<a href=\"/preview/pr-7/nope/\">gone</a>"));
    let (ok, log) = ssqch_with(&root, &["--base", "preview"]);
    assert!(!ok && log.contains("--base: base must be a URL path starting with /"), "{}", log);
}

#[test]
fn a_hook_template_writes_redirect_pages_and_footnotes() {
    let root = project(&[
        ("ssqch.config.js", b"import { redirectsPlugin } from \"ssqch/redirects\";\nexport default { dirs: { input: \"src\", output: \"dist\" }, base: \"/docs\", data: { site: { name: \"Trails\" } }, plugins: [redirectsPlugin()] };"),
        ("src/_includes/hooks/redirect.liquid", b"<!doctype html><title>{{ site.name }}</title><meta http-equiv=\"refresh\" content=\"0; url={{ redirect.to }}\"><p>{{ redirect.from }} is now <a href=\"{{ redirect.to }}\">here</a>.</p>\n"),
        ("src/_includes/hooks/footnote-ref.edge", b"<sup><a href=\"#{{ footnote.label }}\">{{ footnote.label }}</a></sup>"),
        ("src/_includes/hooks/footnotes.edge", b"@each(note in footnotes)\n<div class=\"footnote-definition\" id=\"{{ note.label }}\"><sup>{{ note.label }}</sup>{{{ note.content }}}</div>\n@end"),
        ("src/pine.md", b"---\naliases: /old-pine/\n---\nPines[^1] are tall.\n\n[^1]: Mostly.\n"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert_eq!(read(&root, "dist/old-pine/index.html"), "<!doctype html><title>Trails</title><meta http-equiv=\"refresh\" content=\"0; url=/docs/pine/\"><p>/old-pine/ is now <a href=\"/docs/pine/\">here</a>.</p>\n");
    let page = read(&root, "dist/pine/index.html");
    assert!(page.contains("<p>Pines<sup><a href=\"#1\">1</a></sup> are tall.</p>"), "{}", page);
    assert!(page.contains("<div class=\"footnote-definition\" id=\"1\"><sup>1</sup><p>Mostly.</p>\n</div>"), "{}", page);
}

#[test]
fn image_takes_a_name_for_its_files() {
    let root = project(&[
        ("ssqch.config.js", b"export default { dirs: { input: \"src\", output: \"dist\" } };"),
        ("src/img/squatch.png", PNG),
        (
            "src/_data/logos.js",
            br#"import { image } from "ssqch/image";
const named = await image("src/img/squatch.png", { widths: [16, 24], formats: ["webp", "png"], name: "/assets/sponsors/acme" });
const inside = await image("src/img/squatch.png", { widths: [16], formats: ["webp"], name: "cards/pine" });
let bad;
try { await image("src/img/squatch.png", { name: "../up" }); } catch (e) { bad = e.message; }
export default { urls: [...named.webp, ...named.png, ...inside.webp].map((e) => e.url).join(" "), bad };
"#,
        ),
        ("src/index.edge", b"{{ logos.urls }}|{{ logos.bad }}"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert_eq!(
        read(&root, "dist/index.html"),
        "/assets/sponsors/acme-16.webp /assets/sponsors/acme-24.webp /assets/sponsors/acme-16.png /assets/sponsors/acme-24.png /img/cards/pine-16.webp|image(): image name &quot;../up&quot; must be a URL path without the width and extension, like &quot;/assets/sponsors/acme&quot;"
    );
    for file in ["dist/assets/sponsors/acme-16.webp", "dist/assets/sponsors/acme-24.png", "dist/img/cards/pine-16.webp"] {
        assert!(root.join(file).is_file(), "{} is missing", file);
    }
    // A newer source is encoded again under the same name.
    let before = std::fs::metadata(root.join("dist/assets/sponsors/acme-16.webp")).unwrap().modified().unwrap();
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert_eq!(std::fs::metadata(root.join("dist/assets/sponsors/acme-16.webp")).unwrap().modified().unwrap(), before, "an unchanged source was encoded again");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(root.join("src/img/squatch.png"), PNG).unwrap();
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    assert!(std::fs::metadata(root.join("dist/assets/sponsors/acme-16.webp")).unwrap().modified().unwrap() > before, "a changed source wasn't encoded again");
}
