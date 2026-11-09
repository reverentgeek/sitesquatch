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
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).arg("build").arg("--root").arg(root).env("TZ", "UTC").output().unwrap();
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
    assert!(html.contains("-16.webp 16w, /img/") && html.contains("-32.webp 32w"), "{}", html);
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
            "image(): unknown option \"outputDir\" (options: widths, formats; encoder settings go on imagePlugin())",
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
