//! End-to-end tests: write a small site with an `ssqch.config.js`, build it,
//! and check the output.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Result;
use sitesquatch::{Config, Environment, Value};
use sitesquatch_js::BuiltinPlugin;

/// A fresh, empty project directory.
fn project(files: &[(&str, &str)]) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!("ssqch-js-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, text) in files {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
    dir
}

/// A stand-in for a built-in plugin: registers a filter that reads its options.
fn greeter(cfg: &mut Config, options: &serde_json::Value) -> Result<()> {
    let greeting = options["greeting"].as_str().unwrap_or("Hello").to_string();
    cfg.add_filter("greet", move |args| Ok(Value::from(format!("{}, {}", greeting, args[0].to_js_string()))));
    Ok(())
}

const BUILTINS: &[(&str, BuiltinPlugin)] = &[("test:greeter", greeter)];

fn configure(root: &Path, env: Environment) -> Result<Config> {
    let mut cfg = Config::new(root, env);
    cfg.quiet = true;
    let path = sitesquatch_js::find_config(root).expect("config file");
    sitesquatch_js::load(&mut cfg, &path, BUILTINS)?;
    Ok(cfg)
}

fn build(root: &Path) -> Result<()> {
    let cfg = configure(root, Environment::Production)?;
    sitesquatch::build(&cfg)?;
    Ok(())
}

fn read(root: &Path, path: &str) -> String {
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

const SITE_CONFIG: &str = r##"
import { shout } from "./lib/text";
import site from "./lib/site.json";

let calls = 0;

export const config = { dir: { output: "public" } };

export default async function (config) {
  config.addFilter("shout", shout);
  config.addFilter("count", () => ++calls);
  config.addFilter("year", (d) => d.getUTCFullYear());
  config.addFilter("nextDay", (d) => new Date(d.getTime() + 86400000));
  config.addAsyncFilter("later", async (s) => { await null; return s + " (async)"; });
  config.addFilter("applyTwice", (fn, x) => fn(fn(x)));
  config.addFilter("envName", () => `${config.env}/${process.env.ELEVENTY_ENV}`);
  config.addShortcode("hashtags", (list) => list.map((t) => "#" + t).join(" "));
  config.addGlobalData("site", site);
  config.addGlobalData("snacks", async () => [{ name: "Pine Cone Crunch" }, { name: "Bigfoot Brittle" }]);
  config.addPassthroughCopy({ "static/robots.txt": "robots.txt" });
  config.addPassthroughCopy("src/plain.txt");
  config.addPlugin((c, opts) => c.addFilter("wave", (n) => `${opts.emoji} ${n}`), { emoji: "o/" });
  config.addPlugin("test:greeter", { greeting: "Howdy" });
  return { dir: { input: "src" }, templateFormats: ["edge"] };
}
"##;

const SITE_PAGE: &str = r##"---
title: snack report
date: 2026-03-14
tags: [snacks, forest]
---
{{ shout(title) }}|{{ year(page.date) }}|{{ year(nextDay(page.date)) }}|{{ later("crunchy") }}|{{ applyTwice(shout, "hi") }}
{{ hashtags(tags) }}|{{ site.title }}|{{ greet(site.author) }}|{{ wave("bye") }}|{{ count() }}{{ count() }}|{{ envName() }}
@each(snack in snacks)
{{ snack.name }};
@end
"##;

#[test]
fn builds_a_site_configured_in_javascript() {
    let root = project(&[
        ("ssqch.config.js", SITE_CONFIG),
        ("lib/text.js", "export const shout = (s) => String(s).toUpperCase() + \"!\";\n"),
        ("lib/site.json", r#"{ "title": "Squatch Snacks", "author": "Sasquatch" }"#),
        ("static/robots.txt", "User-agent: *\n"),
        ("src/plain.txt", "plain\n"),
        ("src/index.edge", SITE_PAGE),
        ("src/skipped.md", "# not a template format here\n"),
    ]);
    build(&root).unwrap();

    let html = read(&root, "public/index.html");
    let lines: Vec<&str> = html.lines().collect();
    assert_eq!(lines[0], "SNACK REPORT!|2026|2026|crunchy (async)|HI!!");
    assert_eq!(lines[1], "#snacks #forest|Squatch Snacks|Howdy, Sasquatch|o/ bye|12|production/production");
    assert_eq!(&lines[2..], ["Pine Cone Crunch;", "Bigfoot Brittle;"]);
    assert_eq!(read(&root, "public/robots.txt"), "User-agent: *\n");
    assert_eq!(read(&root, "public/plain.txt"), "plain\n");
    assert!(!root.join("public/skipped/index.html").exists(), "templateFormats should exclude .md");
}

#[test]
fn development_env_is_visible_to_the_config() {
    let root = project(&[
        ("ssqch.config.js", "export default (c) => { c.addGlobalData(\"mode\", { env: c.env, dev: c.isDevelopment }); };"),
        ("index.edge", "{{ mode.env }} {{ mode.dev }}"),
    ]);
    let cfg = configure(&root, Environment::Development).unwrap();
    sitesquatch::build(&cfg).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "development true");
}

#[test]
fn javascript_calls_are_serialized_across_parallel_pages() {
    let mut files = vec![(
        "ssqch.config.js".to_string(),
        "let n = 0; export default (c) => { c.addFilter(\"tick\", () => ++n); };".to_string(),
    )];
    for i in 0..300 {
        files.push((format!("p{}.edge", i), "{{ tick() }}".to_string()));
    }
    let refs: Vec<(&str, &str)> = files.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let root = project(&refs);
    build(&root).unwrap();

    let mut seen: Vec<u32> = (0..300).map(|i| read(&root, &format!("_site/p{}/index.html", i)).trim().parse().unwrap()).collect();
    seen.sort_unstable();
    assert_eq!(seen, (1..=300).collect::<Vec<_>>(), "every call should see the previous one's update");
}

fn load_error(config: &str) -> String {
    let root = project(&[("ssqch.config.js", config), ("lib/bad.js", "export const bad = () => { throw new RangeError(\"too many pine cones\"); };\n")]);
    match configure(&root, Environment::Production) {
        Ok(_) => panic!("expected an error"),
        Err(e) => format!("{:#}", e),
    }
}

#[test]
fn errors_point_at_the_config_source() {
    let e = load_error("export default (c) => {\n  c.addFilter(\"x\", () => 1 +);\n};\n");
    assert!(e.starts_with("ssqch.config.js: "), "{}", e);
    assert!(e.contains("at ssqch.config.js:2:"), "{}", e);

    let e = load_error("import { bad } from \"./lib/bad.js\";\nexport default () => bad();\n");
    assert!(e.contains("too many pine cones"), "{}", e);
    assert!(e.contains("at bad (lib/bad.js:1:"), "{}", e);
    assert!(!e.contains("<ssqch>"), "internal frames should be hidden: {}", e);
}

#[test]
fn unsupported_things_say_so() {
    assert!(load_error("export default (c) => c.addCollection(\"posts\", () => []);").contains("config.addCollection() isn't supported by ssqch yet"));
    assert!(load_error("import x from \"left-pad\"; export default () => {};").contains("importing npm packages isn't supported"));
    assert!(load_error("import fs from \"node:fs\"; export default () => {};").contains("Node built-in modules aren't available"));
    assert!(load_error("export default () => ({ dir: { layouts: \"_layouts\" } });").contains("dir.layouts isn't supported"));
    assert!(load_error("export default (c) => c.addPlugin(\"test:gretter\");").contains("unknown plugin \"test:gretter\" (built-in plugins: test:greeter)"));
    assert!(load_error("export default async () => { await new Promise(() => {}); };").contains("never settled"));
    assert!(load_error("export default (c) => c.addFilter(\"x\");").contains("the second argument must be a function"));
}

#[test]
fn filter_errors_carry_the_javascript_stack() {
    let root = project(&[
        ("ssqch.config.js", "export default (c) => {\n  c.addFilter(\"boom\", () => { throw new Error(\"the snack drawer is empty\"); });\n};\n"),
        ("index.edge", "{{ boom() }}"),
    ]);
    let e = format!("{:#}", build(&root).unwrap_err());
    assert!(e.contains("boom(): the snack drawer is empty"), "{}", e);
    assert!(e.contains("(ssqch.config.js:2:"), "{}", e);
}

#[test]
fn circular_data_is_an_error_not_a_hang() {
    let root = project(&[
        ("ssqch.config.js", "export default (c) => { const a = {}; a.self = a; c.addGlobalData(\"loop\", () => a); };"),
        ("index.edge", "{{ loop }}"),
    ]);
    let e = format!("{:#}", build(&root).unwrap_err());
    assert!(e.contains("nested too deeply"), "{}", e);
}
