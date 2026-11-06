//! JavaScript data files and the Node built-in shims.

mod common;

use std::path::Path;

use common::project;
use sitesquatch::{Config, Environment};

/// A site without `ssqch.config.js`: JavaScript data files still load.
fn build(root: &Path) -> anyhow::Result<()> {
    let mut cfg = Config::new(root, Environment::Production);
    cfg.quiet = true;
    sitesquatch_js::add_data_files(&mut cfg);
    sitesquatch::build(&cfg)?;
    Ok(())
}

fn read(root: &Path, path: &str) -> String {
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

fn json(root: &Path, path: &str) -> serde_json::Value {
    serde_json::from_str(&read(root, path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

#[test]
fn data_files_can_be_values_functions_or_async() {
    let root = project(&[
        ("_data/plain.js", "export default { snack: \"Pine Cone Crunch\" };"),
        ("_data/fn.js", "export default () => [1, 2, 3];"),
        ("_data/later.mjs", "export default async function () { await null; return \"async\"; }"),
        ("_data/nested/deep.js", "export default \"deep\";"),
        ("_data/site.json", "{ \"title\": \"Squatch\" }"),
        ("index.edge", "{{ plain.snack }}|{{ fn.join(\",\") }}|{{ later }}|{{ nested.deep }}|{{ site.title }}"),
    ]);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "Pine Cone Crunch|1,2,3|async|deep|Squatch");
}

#[test]
fn template_and_directory_data_files_with_computed_functions() {
    let root = project(&[
        (
            "posts/posts.11tydata.js",
            "export default { tags: \"posts\", from: \"directory\", eleventyComputed: { shout: (data) => data.title.toUpperCase() + \"!\", permalink: (data) => `/snacks/${data.page.fileSlug}/` } };",
        ),
        ("posts/hello.11tydata.js", "export default () => ({ from: \"template\" });"),
        ("posts/hello.edge", "---\ntitle: hello forest\n---\n{{ shout }}|{{ from }}|{{ tags }}"),
        // A plain `.js` next to templates is a script, not data.
        ("posts/posts.js", "throw new Error(\"not data\");"),
    ]);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/snacks/hello/index.html"), "HELLO FOREST!|template|posts");
}

#[test]
fn changed_data_files_reload_between_builds() {
    let root = project(&[("_data/snacks.js", "export default [\"Pine Cone Crunch\"];"), ("index.edge", "{{ snacks.join(\", \") }}")]);
    let mut cfg = Config::new(&root, Environment::Development);
    cfg.quiet = true;
    sitesquatch_js::add_data_files(&mut cfg);
    sitesquatch::build(&cfg).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "Pine Cone Crunch");

    let file = root.join("_data/snacks.js");
    std::fs::write(&file, "export default [\"Yeti Yogurt\"];").unwrap();
    // Make sure the modification time moves even on coarse-grained file systems.
    let later = std::fs::metadata(&file).unwrap().modified().unwrap() + std::time::Duration::from_secs(2);
    std::fs::File::options().write(true).open(&file).unwrap().set_modified(later).unwrap();
    sitesquatch::build(&cfg).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "Yeti Yogurt");
}

#[test]
fn path_matches_node() {
    let root = project(&[
        ("_data/out.mjs", include_str!("fixtures/path-cases.mjs")),
        ("index.edge", "{{{ JSON.stringify(out) }}}"),
    ]);
    build(&root).unwrap();
    let expected: serde_json::Value = serde_json::from_str(include_str!("fixtures/path-expected.json")).unwrap();
    let got = json(&root, "_site/index.html");
    let mut mismatches = Vec::new();
    for (key, cases) in expected.as_object().unwrap() {
        for (i, want) in cases.as_array().unwrap().iter().enumerate() {
            let have = &got[key][i];
            if have != want {
                mismatches.push(format!("{}[{}]: node {} vs {}", key, i, want, have));
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

const FS_CHECKS: &str = r#"
import fs, { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = (fn) => { try { fn(); return "no error"; } catch (e) { return e.code; } };

export default async function () {
  fs.mkdirSync("tmp/a/b", { recursive: true });
  fs.writeFileSync("tmp/a/b/snack.txt", "Pine Cone Crunch");
  fs.appendFileSync("tmp/a/b/snack.txt", " & Bigfoot Brittle");
  await writeFile("tmp/bytes.bin", Buffer.from([0, 1, 254, 255]));
  fs.copyFileSync("tmp/a/b/snack.txt", "tmp/copy.txt");
  fs.renameSync("tmp/copy.txt", "tmp/moved.txt");
  const result = {
    here: path.relative(process.cwd(), here),
    text: readFileSync("tmp/a/b/snack.txt", "utf8"),
    viaPromise: await readFile("tmp/moved.txt", { encoding: "utf8" }),
    bufferText: String(readFileSync("tmp/moved.txt")),
    bytes: Array.from(readFileSync("tmp/bytes.bin")),
    isBuffer: Buffer.isBuffer(readFileSync("tmp/bytes.bin")),
    listing: await readdir("tmp"),
    dirents: fs.readdirSync("tmp", { withFileTypes: true }).map((d) => `${d.name}:${d.isDirectory() ? "dir" : "file"}`),
    size: fs.statSync("tmp/bytes.bin").size,
    mtimeIsDate: fs.statSync("tmp/bytes.bin").mtime instanceof Date,
    exists: [existsSync("tmp/moved.txt"), existsSync("tmp/nope")],
    missing: code(() => readFileSync("tmp/nope")),
    notEmpty: code(() => fs.rmSync("tmp/a")),
    forced: code(() => fs.rmSync("tmp/nope", { force: true })),
    fileUrl: pathToFileURL("tmp/a b.txt").href.endsWith("/tmp/a%20b.txt"),
    urlPath: fileURLToPath(pathToFileURL("tmp/x.txt")) === path.resolve("tmp/x.txt"),
    base64: Buffer.from("Sasquatch").toString("base64"),
    fromBase64: Buffer.from("U2FzcXVhdGNo", "base64").toString(),
    hex: Buffer.from("squatch").toString("hex"),
    utf8Length: Buffer.byteLength("🦶"),
    slice: Buffer.from("bigfoot").subarray(3).toString(),
    concat: Buffer.concat([Buffer.from("big"), Buffer.from("foot")]).toString(),
    json: JSON.stringify(Buffer.from("hi")),
  };
  fs.rmSync("tmp", { recursive: true });
  result.cleanedUp = !existsSync("tmp");
  return result;
}
"#;

#[test]
fn fs_buffer_and_url_behave_like_node() {
    let root = project(&[("_data/checks.js", FS_CHECKS), ("index.edge", "{{{ JSON.stringify(checks) }}}")]);
    build(&root).unwrap();
    let got = json(&root, "_site/index.html");
    // What Node 24 returns for the same file.
    let expected = serde_json::json!({
        "here": "_data",
        "text": "Pine Cone Crunch & Bigfoot Brittle",
        "viaPromise": "Pine Cone Crunch & Bigfoot Brittle",
        "bufferText": "Pine Cone Crunch & Bigfoot Brittle",
        "bytes": [0, 1, 254, 255],
        "isBuffer": true,
        "listing": ["a", "bytes.bin", "moved.txt"],
        "dirents": ["a:dir", "bytes.bin:file", "moved.txt:file"],
        "size": 4,
        "mtimeIsDate": true,
        "exists": [true, false],
        "missing": "ENOENT",
        "notEmpty": "ERR_FS_EISDIR",
        "forced": "no error",
        "fileUrl": true,
        "urlPath": true,
        "base64": "U2FzcXVhdGNo",
        "fromBase64": "Sasquatch",
        "hex": "73717561746368",
        "utf8Length": 4,
        "slice": "foot",
        "concat": "bigfoot",
        "json": "{\"type\":\"Buffer\",\"data\":[104,105]}",
        "cleanedUp": true,
    });
    assert_eq!(got, expected);
}

#[test]
fn relative_fs_paths_resolve_against_the_project_root() {
    // The build's root isn't the process's working directory here, like
    // `ssqch build --root some/site`.
    let root = project(&[
        ("notes.txt", "from the project root"),
        ("_data/notes.js", "import fs from \"node:fs\"; export default fs.readFileSync(\"notes.txt\", \"utf8\");"),
        ("index.edge", "{{ notes }}"),
    ]);
    assert_ne!(std::env::current_dir().unwrap(), root);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "from the project root");
}

fn build_error(files: &[(&str, &str)]) -> String {
    let root = project(files);
    format!("{:#}", build(&root).unwrap_err())
}

#[test]
fn data_file_errors_name_the_file() {
    let e = build_error(&[("_data/x.js", "export const snacks = [];"), ("index.edge", "")]);
    assert!(e.contains("_data/x.js: a data file needs a default export"), "{}", e);

    let e = build_error(&[("_data/x.js", "export default async () => { await null; throw new TypeError(\"bad snack\"); };"), ("index.edge", "")]);
    assert!(e.contains("_data/x.js: bad snack") && e.contains("at default (_data/x.js:1:"), "{}", e);

    let e = build_error(&[("_data/x.js", "import fs from \"node:fs\"; export default fs.readFileSync(\"nope.json\", \"utf8\");"), ("index.edge", "")]);
    assert!(e.contains("ENOENT: no such file or directory, open 'nope.json'"), "{}", e);

    let e = build_error(&[("_data/x.js", "import c from \"node:crypto\"; export default 1;"), ("index.edge", "")]);
    assert!(e.contains("node:crypto isn't available in ssqch (available: node:fs"), "{}", e);
}
