//! Collections, transforms, build hooks, and the lazy views that template
//! values arrive in.

mod common;

use std::path::Path;

use common::project;
use sitesquatch::{Config, Environment};

fn configure(root: &Path) -> anyhow::Result<Config> {
    let mut cfg = Config::new(root, Environment::Production);
    cfg.quiet = true;
    let path = sitesquatch_js::find_config(root).expect("config file");
    sitesquatch_js::load(&mut cfg, &path, &[])?;
    Ok(cfg)
}

fn build(root: &Path) -> anyhow::Result<()> {
    sitesquatch::build(&configure(root)?)?;
    Ok(())
}

fn read(root: &Path, path: &str) -> String {
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

const POSTS: [(&str, &str); 5] = [
    ("src/posts/pine.md", "---\ntitle: Pine Cone Crunch\ndate: 2024-06-01\ntags: [posts, snacks]\n---\n# Pine\n"),
    ("src/posts/brittle.md", "---\ntitle: Bigfoot Brittle\ndate: 2025-02-03\ntags: [posts, snacks, sweet]\n---\n# Brittle\n"),
    ("src/posts/yogurt.md", "---\ntitle: Yeti Yogurt\ndate: 2025-07-04\ntags: [posts, dairy]\n---\n# Yogurt\n"),
    ("src/notes/a.md", "---\ntitle: Note A\ndate: 2023-01-01\n---\nnote\n"),
    ("src/notes/deep/b.txt.md", "---\ntitle: Note B\ndate: 2023-01-02\n---\nnote\n"),
];

fn site(config: &str, index: &str) -> std::path::PathBuf {
    let mut files: Vec<(&str, &str)> = POSTS.to_vec();
    files.push(("ssqch.config.js", config));
    files.push(("src/index.edge", index));
    project(&files)
}

#[test]
fn collection_api_matches_eleventy() {
    let root = site(
        r#"export default (c) => {
  c.addCollection("all2", (api) => api.getAll());
  c.addCollection("sorted", (api) => api.getAllSorted().map((p) => p.fileSlug));
  c.addCollection("snacks", (api) => api.getFilteredByTag("snacks"));
  c.addCollection("sweetSnacks", (api) => api.getFilteredByTags("snacks", "sweet"));
  c.addCollection("notes", (api) => api.getFilteredByGlob("./src/notes/**/*.md"));
  c.addCollection("shallowNotes", (api) => api.getFilteredByGlob("src/notes/*.md"));
  c.addCollection("either", (api) => api.getFilteredByGlob(["src/posts/{pine,yogurt}.md", "src/notes/?.md"]));
  c.addCollection("newestFirst", (api) => api.getFilteredByTag("posts").sort((a, b) => b.date - a.date));
  c.addCollection("summary", (api) => api.getFilteredByTag("snacks").map((p) => ({ title: p.data.title, year: p.date.getUTCFullYear(), html: p.templateContent.trim() })));
  return { dir: { input: "src" } };
};"#,
        r#"all2={{ collections.all2.length }}/{{ collections.all.length }}
sorted={{ collections.sorted.join(",") }}
snacks={{ collections.snacks.map(p => p.data.title).join(",") }}
sweet={{ collections.sweetSnacks.map(p => p.fileSlug).join(",") }}
notes={{ collections.notes.map(p => p.inputPath).join(",") }}
shallow={{ collections.shallowNotes.map(p => p.fileSlug).join(",") }}
either={{ collections.either.map(p => p.fileSlug).join(",") }}
newest={{ collections.newestFirst.map(p => p.fileSlug).join(",") }}
summary={{ JSON.stringify(collections.summary) }}
original={{ collections.posts.map(p => p.fileSlug).join(",") }}"#,
    );
    build(&root).unwrap();
    let html = read(&root, "_site/index.html");
    let lines: Vec<&str> = html.lines().collect();
    assert_eq!(lines[0], "all2=6/6");
    assert_eq!(lines[1], "sorted=a,b.txt,pine,brittle,yogurt,", "oldest first; a root index has an empty fileSlug, like Eleventy");
    assert_eq!(lines[2], "snacks=Pine Cone Crunch,Bigfoot Brittle");
    assert_eq!(lines[3], "sweet=brittle");
    assert_eq!(lines[4], "notes=./src/notes/a.md,./src/notes/deep/b.txt.md");
    assert_eq!(lines[5], "shallow=a");
    assert_eq!(lines[6], "either=a,pine,yogurt");
    assert_eq!(lines[7], "newest=yogurt,brittle,pine");
    assert_eq!(
        lines[8],
        r#"summary=[{&quot;title&quot;:&quot;Pine Cone Crunch&quot;,&quot;year&quot;:2024,&quot;html&quot;:&quot;&lt;h1&gt;Pine&lt;/h1&gt;&quot;},{&quot;title&quot;:&quot;Bigfoot Brittle&quot;,&quot;year&quot;:2025,&quot;html&quot;:&quot;&lt;h1&gt;Brittle&lt;/h1&gt;&quot;}]"#
    );
    assert_eq!(lines[9], "original=pine,brittle,yogurt", "sorting in a collection must not reorder collections.posts");
}

#[test]
fn transforms_get_the_page_like_eleventy() {
    let root = site(
        r#"export default (c) => {
  c.addTransform("upper", async function (content) {
    if ((this.page.outputPath || "").endsWith(".html")) return content.replace(/<h1>(.*?)<\/h1>/g, (_, t) => `<h1>${t.toUpperCase()}</h1>`);
    return content;
  });
  c.addTransform("stamp", function (content, outputPath) {
    return outputPath.endsWith(".html") ? `${content}<!-- ${this.page.url} ${this.inputPath} -->` : content;
  });
  return { dir: { input: "src" } };
};"#,
        "home",
    );
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/posts/pine/index.html"), "<h1>PINE</h1>\n<!-- /posts/pine/ ./src/posts/pine.md -->");
}

#[test]
fn a_transform_must_return_content() {
    let root = site(
        r#"export default (c) => {
  c.addTransform("forgetful", function (content) { if (this.page.url === "/never/") return content; });
  return { dir: { input: "src" } };
};"#,
        "home",
    );
    let e = format!("{:#}", build(&root).unwrap_err());
    assert!(e.contains("transform `forgetful` failed"), "{}", e);
    assert!(e.contains("transform \"forgetful\" returned undefined") && e.contains("return the content (unchanged if there's nothing to do)"), "{}", e);
}

#[test]
fn build_hooks_run_before_and_after() {
    let root = site(
        r#"import fs from "node:fs";
const log = [];
export default (c) => {
  c.on("eleventy.before", async ({ directories, dir, runMode, outputMode }) => {
    await null;
    log.push(`before ${runMode} ${outputMode} ${directories.input} ${dir.output} ${directories.includes}`);
  });
  c.on("eleventy.after", ({ results }) => {
    log.push(`after ${results.length} ${results.every((r) => r.outputPath.endsWith(".html"))}`);
    fs.writeFileSync("hooks.txt", log.join("\n"));
  });
  return { dir: { input: "src", output: "public" } };
};"#,
        "home",
    );
    build(&root).unwrap();
    assert_eq!(read(&root, "hooks.txt"), "before build fs ./src/ ./public/ ./src/_includes/\nafter 6 true");
}

#[test]
fn hook_errors_stop_the_build() {
    let root = site(r#"export default (c) => { c.on("eleventy.before", () => { throw new Error("no snacks today"); }); return { dir: { input: "src" } }; };"#, "home");
    let e = format!("{:#}", build(&root).unwrap_err());
    assert!(e.contains("config.on(\"eleventy.before\")") && e.contains("no snacks today"), "{}", e);

    let root = site(r#"export default (c) => { c.on("eleventy.beforeWatch", () => {}); };"#, "home");
    let e = format!("{:#}", configure(&root).err().expect("expected an error"));
    assert!(e.contains("unknown event \"eleventy.beforeWatch\" (supported: eleventy.before, eleventy.after)"), "{}", e);
}

#[test]
fn views_behave_like_plain_objects() {
    let root = project(&[
        ("battery.js", include_str!("fixtures/view-battery.js")),
        (
            "ssqch.config.js",
            r#"import { battery, copy } from "./battery.js";
export default (c) => {
  c.addFilter("viaView", (d) => JSON.stringify(battery(d)));
  c.addFilter("viaCopy", (d) => JSON.stringify(battery(copy(d))));
};"#,
        ),
        ("_data/site.json", r#"{ "title": "Squatch Snacks", "author": "Sasquatch" }"#),
        (
            "_data/posts.js",
            r#"export default [
  { title: "Pine Cone Crunch", stars: 4, tags: ["snacks", "forest"], date: new Date("2026-01-02") },
  { title: "Bigfoot Brittle", stars: 5, tags: ["snacks"], date: new Date("2026-02-03") },
  { title: "Yeti Yogurt", stars: 2, tags: ["dairy", "cold", "snowy"], date: new Date("2026-03-04") },
  { title: "Mothman Mints", stars: 3, tags: ["snacks", "night"], date: new Date("2026-04-05") },
];"#,
        ),
        ("index.edge", "{{{ viaView({ site, posts }) }}}\n{{{ viaCopy({ site, posts }) }}}\n{{ site.title }}|{{ posts[0].title }}|{{ posts.length }}"),
    ]);
    build(&root).unwrap();
    let html = read(&root, "_site/index.html");
    let lines: Vec<&str> = html.lines().collect();
    let view: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    let copy: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
    for (key, want) in copy.as_object().unwrap() {
        assert_eq!(&view[key], want, "{} differs between a view and a plain copy", key);
    }
    assert!(copy.as_object().unwrap().len() >= 40);
    assert_eq!(lines[2], "Squatch Snacks|Pine Cone Crunch|4", "writes in JavaScript must not change the site's data");
}
