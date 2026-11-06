//! The `ssqch` binary running a config that imports Eleventy packages, which
//! ssqch answers with its own modules.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

const PNG: &[u8] = include_bytes!("fixtures/squatch.png");

fn project(files: &[(&str, &[u8])]) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!("ssqch-compat-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
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
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).arg("build").arg("--root").arg(root).env("TZ", "UTC").output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

fn read(root: &Path, path: &str) -> String {
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

const CONFIG: &str = r#"
import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import pluginRss, { absoluteUrl } from "@11ty/eleventy-plugin-rss";
import htmlmin from "html-minifier-terser";
import edgeJsPlugin from "eleventy-plugin-edgejs";
import brokenLinksPlugin from "eleventy-plugin-broken-links";

export default function (config) {
  config.addPlugin(eleventyImageTransformPlugin, {
    formats: ["webp", "auto"],
    widths: [16, 32],
    defaultAttributes: { loading: "lazy" },
    sharpWebpOptions: { quality: 80, effort: 4 },
  });
  config.addPlugin(pluginRss);
  config.addPlugin(edgeJsPlugin);
  config.addPlugin(brokenLinksPlugin);
  config.addFilter("abs", (url) => absoluteUrl(url, "https://example.com/blog/"));
  // Registered before the image plugin's transform would be in Eleventy terms;
  // images are still processed first, like Eleventy's htmlTransformer.
  config.addTransform("htmlmin", async function (content) {
    if (!this.page.outputPath.endsWith(".html")) return content;
    return htmlmin.minify(content, { collapseWhitespace: true, removeComments: true });
  });
  return { dir: { input: "src", output: "dist" } };
}
"#;

const HERO: &str = r#"
import Image from "@11ty/eleventy-img";
export default async function () {
  const metadata = await Image("src/img/squatch.png", { widths: [24, "auto"], formats: ["webp", "png"], outputDir: "./dist/img", urlPath: "/img/" });
  return { formats: Object.keys(metadata), png: metadata.png.map((e) => `${e.width}x${e.height} ${e.sourceType} ${e.url.startsWith("/img/")} ${e.size > 0}`) };
}
"#;

const PAGE: &str = "---\ndate: 2026-03-14\n---\n<!-- a comment -->\n<p>\n  <img src=\"/img/squatch.png\" alt=\"Squatch\">\n</p>\n<p>{{ hero.formats.join(',') }} | {{ hero.png.join(' / ') }}</p>\n<p>{{ abs('#top') }} {{ abs('https://example.com') }} {{ dateToRfc3339(page.date) }}</p>\n";

#[test]
fn an_eleventy_style_config_runs_on_ssqch_modules() {
    let root = project(&[
        ("ssqch.config.js", CONFIG.as_bytes()),
        ("src/_data/hero.js", HERO.as_bytes()),
        ("src/img/squatch.png", PNG),
        ("src/index.edge", PAGE.as_bytes()),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(ok, "{}", log);
    let html = read(&root, "dist/index.html");

    // The image transform ran before htmlmin, and its markup was minified with the rest.
    assert!(!html.contains("a comment") && !html.contains("\n"), "{}", html);
    assert!(html.contains("<picture><source type=\"image/webp\" srcset=\"/img/"), "{}", html);
    assert!(html.contains("-16.webp 16w, /img/") && html.contains("-32.webp 32w"), "{}", html);
    assert!(html.contains("loading=\"lazy\"") && html.contains("width=\"32\" height=\"16\""), "{}", html);

    // Image() returned eleventy-img's metadata shape.
    assert!(html.contains("webp,png | 24x12 image/png true true / 64x32 image/png true true"), "{}", html);

    // RSS plugin filters and the named absoluteUrl export (WHATWG URL rules).
    assert!(html.contains("https://example.com/blog/#top https://example.com/ 2026-03-14T00:00:00Z"), "{}", html);

    // Options and plugins ssqch can't honor are reported, not silently dropped.
    assert!(log.contains("sharpWebpOptions.effort is ignored"), "{}", log);
    assert!(log.contains("eleventy-plugin-broken-links isn't available in ssqch"), "{}", log);
    assert!(!log.contains("quality"), "quality 80 is mapped to webpQuality, so nothing to warn about: {}", log);
}

#[test]
fn image_calls_that_cant_match_eleventy_fail_clearly() {
    let root = project(&[
        ("ssqch.config.js", b"export default () => ({ dir: { input: \"src\", output: \"dist\" } });"),
        ("src/_data/hero.js", b"import Image from \"@11ty/eleventy-img\"; export default () => Image(\"src/img/squatch.png\", { outputDir: \"./public/images\" });"),
        ("src/img/squatch.png", PNG),
        ("src/index.edge", b"{{ hero }}"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(!ok);
    assert!(log.contains("outputDir \"./public/images\" isn't where this build writes images (dist/img)"), "{}", log);

    let root = project(&[
        ("ssqch.config.js", b"export default () => ({ dir: { input: \"src\", output: \"dist\" } });"),
        ("src/_data/hero.js", b"import Image from \"@11ty/eleventy-img\"; export default () => Image(\"https://example.com/a.png\");"),
        ("src/index.edge", b"{{ hero }}"),
    ]);
    let (ok, log) = ssqch(&root);
    assert!(!ok);
    assert!(log.contains("remote images aren't supported by ssqch"), "{}", log);
}
