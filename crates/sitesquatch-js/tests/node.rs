//! JavaScript data files and the Node built-in shims.

mod common;

use std::path::Path;

use common::project;
use sitesquatch::{Config, Environment};

/// A site without `ssqch.config.js`: JavaScript data files still load.
fn build(root: &Path) -> anyhow::Result<()> {
    let mut cfg = Config::new(root, Environment::Production);
    cfg.quiet = true;
    sitesquatch_js::add_data_files(&mut cfg, &[]);
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
            "posts/posts.data.js",
            "export default { tags: \"posts\", from: \"directory\", computed: { shout: (data) => data.title.toUpperCase() + \"!\", permalink: (data) => `/snacks/${data.page.fileSlug}/` } };",
        ),
        ("posts/hello.data.js", "export default () => ({ from: \"template\" });"),
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
    sitesquatch_js::add_data_files(&mut cfg, &[]);
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

    let e = build_error(&[("_data/x.js", "import s from \"node:sqlite\"; export default 1;"), ("index.edge", "")]);
    assert!(e.contains("node:sqlite isn't available in ssqch (available: node:fs"), "{}", e);
}

#[test]
fn intl_dates_and_numbers_match_node() {
    let root = project(&[
        ("_data/out.mjs", include_str!("fixtures/intl-cases.mjs")),
        ("index.edge", "{{{ JSON.stringify(out) }}}"),
    ]);
    build(&root).unwrap();
    let expected: serde_json::Value = serde_json::from_str(include_str!("fixtures/intl-expected.json")).unwrap();
    let got = json(&root, "_site/index.html");
    let mut mismatches = Vec::new();
    for (key, cases) in expected.as_object().unwrap() {
        for (i, want) in cases.as_array().unwrap().iter().enumerate() {
            if &got[key][i] != want {
                mismatches.push(format!("{}[{}]: node {} vs {}", key, i, want, got[key][i]));
            }
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn collation_matches_node() {
    let root = project(&[("_data/out.mjs", include_str!("fixtures/collation-cases.mjs")), ("index.edge", "{{ out.join(\"\\n\") }}")]);
    build(&root).unwrap();
    let got = std::fs::read_to_string(root.join("_site/index.html")).unwrap();
    assert_eq!(got.trim_end(), include_str!("fixtures/collation-expected.txt").trim_end());
}

#[test]
fn intl_refuses_what_it_cant_format() {
    let e = build_error(&[("_data/x.js", "export default new Date(0).toLocaleDateString(\"de-DE\");"), ("index.edge", "")]);
    assert!(e.contains("only \"en-US\" formatting is available in ssqch (got \"de-DE\")"), "{}", e);
    let e = build_error(&[("_data/x.js", "export default new Date(0).toLocaleDateString(\"en-US\", { timeZone: \"America/Chicago\" });"), ("index.edge", "")]);
    assert!(e.contains("only the UTC and local time zones are available in ssqch"), "{}", e);
    let e = build_error(&[("_data/x.js", "export default (1).toLocaleString(\"en-US\", { style: \"currency\", currency: \"USD\" });"), ("index.edge", "")]);
    assert!(e.contains("the \"style\" option isn't supported in ssqch"), "{}", e);
}

#[test]
fn programs_can_add_modules_with_native_functions() {
    use sitesquatch::Value;
    let module = sitesquatch_js::JsModule {
        name: "test:snacks".into(),
        source: "const native = globalThis.__ssqch.natives[\"test:snacks\"];\nexport const shout = (s) => native.shout(s);\nexport default { shout };".into(),
        natives: vec![("shout".into(), Value::func(|args| Ok(Value::from(format!("{}!", args[0].to_js_string().to_uppercase())))))],
    };
    let root = project(&[
        ("_data/a.js", "import { shout } from \"test:snacks\"; export default shout(\"pine cone\");"),
        ("_data/b.js", "import snacks from \"test:snacks\"; export default snacks.shout(\"brittle\");"),
        ("index.edge", "{{ a }}|{{ b }}"),
    ]);
    let mut cfg = Config::new(&root, Environment::Production);
    cfg.quiet = true;
    sitesquatch_js::add_data_files(&mut cfg, &[module]);
    sitesquatch::build(&cfg).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "PINE CONE!|BRITTLE!");
}

#[test]
fn crypto_create_hash_matches_node() {
    // Expected values are Node's: crypto.createHash(alg).update("hello").digest("hex"), etc.
    let root = project(&[
        (
            "_data/hashes.js",
            r#"import crypto, { createHash } from "node:crypto";
import plain from "crypto";
const hex = (alg) => createHash(alg).update("hello").digest("hex");
export default {
  md5: hex("md5"),
  sha1: hex("sha1"),
  sha256: hex("sha256"),
  sha512Length: createHash("SHA512").update("hello").digest().length,
  chunked: createHash("sha256").update("hel").update(Buffer.from("lo")).digest("hex") === hex("sha256"),
  base64: createHash("sha256").update("68656c6c6f", "hex").digest("base64"),
  base64url: createHash("sha1").update("hello").digest("base64url"),
  sameModule: plain.createHash === crypto.createHash,
  hashes: crypto.getHashes().join(","),
};"#,
        ),
        (
            "index.edge",
            "{{ hashes.md5 }}\n{{ hashes.sha1 }}\n{{ hashes.sha256 }}\n{{ hashes.sha512Length }}\n{{ hashes.chunked }}\n{{ hashes.base64 }}\n{{ hashes.base64url }}\n{{ hashes.sameModule }}\n{{ hashes.hashes }}",
        ),
    ]);
    build(&root).unwrap();
    let html = read(&root, "_site/index.html");
    let lines: Vec<&str> = html.lines().collect();
    assert_eq!(lines[0], "5d41402abc4b2a76b9719d911017c592");
    assert_eq!(lines[1], "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    assert_eq!(lines[2], "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    assert_eq!(lines[3], "64");
    assert_eq!(lines[4], "true", "update() can be called in pieces, with strings or Buffers");
    assert_eq!(lines[5], "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=");
    assert_eq!(lines[6], "qvTGHdzF6KLavt4PO0gs2a6pQ00");
    assert_eq!(lines[7], "true");
    assert_eq!(lines[8], "md5,sha1,sha256,sha384,sha512");

    let e = build_error(&[("_data/x.js", "import { createHash } from \"node:crypto\"; export default createHash(\"whirlpool\");"), ("index.edge", "")]);
    assert!(e.contains("Digest method not supported: whirlpool (ssqch supports md5, sha1, sha256, sha384, sha512)"), "{}", e);
    let e = build_error(&[("_data/x.js", "import { createHash } from \"node:crypto\"; const h = createHash(\"md5\"); h.digest(); export default h.digest();"), ("index.edge", "")]);
    assert!(e.contains("Digest already called"), "{}", e);
}
