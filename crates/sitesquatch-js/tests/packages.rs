//! npm packages, CommonJS, timers, `fetch` and the web APIs packages expect.

mod common;

#[cfg(feature = "fetch")]
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(feature = "fetch")]
use std::net::TcpListener;
use std::path::Path;

use common::project;
use sitesquatch::{Config, Environment};

fn build(root: &Path) -> anyhow::Result<()> {
    let mut cfg = Config::new(root, Environment::Production);
    cfg.quiet = true;
    match sitesquatch_js::find_config(root) {
        Some(path) => sitesquatch_js::load(&mut cfg, &path, &[], &[])?,
        None => sitesquatch_js::add_data_files(&mut cfg, &[]),
    }
    sitesquatch::build(&cfg)?;
    Ok(())
}

fn read(root: &Path, path: &str) -> String {
    std::fs::read_to_string(root.join(path)).unwrap_or_else(|e| panic!("{}: {}", path, e))
}

fn build_error(files: &[(&str, &str)]) -> String {
    let root = project(files);
    format!("{:#}", build(&root).unwrap_err())
}

/// A package with conditional exports, subpath patterns, `imports`, and a
/// CommonJS dependency of its own.
const PACKAGES: &[(&str, &str)] = &[
    (
        "node_modules/dual/package.json",
        r##"{ "name": "dual", "type": "module", "exports": { ".": { "import": "./esm/index.js", "require": "./cjs/index.cjs" }, "./tools/*": "./esm/tools/*.js", "./package.json": "./package.json" }, "imports": { "#helper": "./esm/helper.js" } }"##,
    ),
    ("node_modules/dual/esm/index.js", "import helper from \"#helper\";\nexport const kind = \"esm\";\nexport default () => helper();\n"),
    ("node_modules/dual/esm/helper.js", "import legacy from \"legacy\";\nexport default () => `helped ${legacy.name}`;\n"),
    ("node_modules/dual/esm/tools/shout.js", "export default s => s.toUpperCase();\n"),
    ("node_modules/dual/cjs/index.cjs", "exports.kind = \"cjs\";\n"),
    // Old-style CommonJS: `main` without an extension, a folder require, JSON.
    ("node_modules/legacy/package.json", r#"{ "name": "legacy", "version": "1.2.3", "main": "lib/main" }"#),
    ("node_modules/legacy/lib/main.js", "const util = require(\"./util\");\nconst pkg = require(\"../package.json\");\nmodule.exports = { name: \"legacy\", version: pkg.version, twice: util.twice, dir: __dirname.endsWith(\"/legacy/lib\"), file: __filename.endsWith(\"/legacy/lib/main.js\") };\n"),
    ("node_modules/legacy/lib/util/index.js", "exports.twice = n => n * 2;\n"),
    ("node_modules/@squatch/cjs-fn/package.json", r#"{ "name": "@squatch/cjs-fn", "exports": "./index.js" }"#),
    ("node_modules/@squatch/cjs-fn/index.js", "function slug(s) { return s.toLowerCase().replace(/\\s+/g, \"-\"); }\nslug.extend = () => {};\nmodule.exports = slug;\n"),
];

fn with_packages(files: &[(&'static str, &'static str)]) -> Vec<(&'static str, &'static str)> {
    PACKAGES.iter().chain(files).copied().collect()
}

#[test]
fn packages_resolve_like_node() {
    let root = project(&with_packages(&[
        (
            "_data/out.js",
            "import run, { kind } from \"dual\";\nimport shout from \"dual/tools/shout\";\nimport legacy, { twice } from \"legacy\";\nimport slug from \"@squatch/cjs-fn\";\nimport { createRequire } from \"node:module\";\nconst require = createRequire(import.meta.url);\nexport default [run(), kind, require(\"dual\").kind, shout(\"hi\"), legacy.version, twice(4), legacy.dir, legacy.file, slug(\"Pine Cone\"), typeof slug.extend, require(\"dual/package.json\").name].join(\"|\");\n",
        ),
        ("index.edge", "{{ out }}"),
    ]));
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "helped legacy|esm|cjs|HI|1.2.3|8|true|true|pine-cone|function|dual");
}

#[test]
fn packages_resolve_from_a_parent_folder() {
    // A site in a monorepo, with node_modules above it.
    let root = project(&with_packages(&[("site/_data/out.js", "import legacy from \"legacy\"; export default legacy.version;"), ("site/index.edge", "{{ out }}")]));
    let site = root.join("site");
    build(&site).unwrap();
    assert_eq!(read(&site, "_site/index.html"), "1.2.3");
}

#[cfg(unix)]
#[test]
fn symlinked_packages_resolve_their_own_dependencies() {
    // pnpm's layout: node_modules/a links into .pnpm, where a's own
    // dependencies sit next to it.
    let root = project(&[
        ("node_modules/.pnpm/a@1/node_modules/a/package.json", r#"{ "name": "a", "main": "index.js" }"#),
        ("node_modules/.pnpm/a@1/node_modules/a/index.js", "module.exports = \"a+\" + require(\"b\");"),
        ("node_modules/.pnpm/a@1/node_modules/b/index.js", "module.exports = \"b\";"),
        ("_data/out.js", "import a from \"a\"; export default a;"),
        ("index.edge", "{{ out }}"),
    ]);
    std::os::unix::fs::symlink(root.join("node_modules/.pnpm/a@1/node_modules/a"), root.join("node_modules/a")).unwrap();
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "a+b");
}

#[test]
fn commonjs_data_files_and_configs() {
    let root = project(&with_packages(&[
        // The site's own `.js` files are CommonJS unless they use `import` or `export`.
        ("_data/site.js", "const { twice } = require(\"legacy\");\nmodule.exports = { title: \"Squatch\", n: twice(21) };\n"),
        ("_data/later.js", "module.exports = async () => \"async cjs\";\n"),
        ("_data/types.cjs", "exports.kind = typeof module + typeof exports + typeof require;\n"),
        // Top-level `await` alone makes an ES module, as in Node.
        ("lib/setup.js", "const value = await Promise.resolve(\"waited\");\nglobalThis.waited = value;\n"),
        ("lib/filters.cjs", "module.exports = { shout: s => s.toUpperCase() + \"!\" };\n"),
        // A cycle, finished the way Node finishes it.
        ("lib/a.js", "exports.early = \"a\";\nconst b = require(\"./b\");\nexports.both = b.fromA + \"+b\";\n"),
        ("lib/b.js", "exports.fromA = require(\"./a\").early;\n"),
        ("ssqch.config.js", "import \"./lib/setup.js\";\nimport filters from \"./lib/filters.cjs\";\nimport { createRequire } from \"node:module\";\nconst require = createRequire(import.meta.url);\nexport default { filters: { ...filters, cycle: () => require(\"./lib/a.js\").both, waitedFor: () => globalThis.waited } };\n"),
        ("index.edge", "{{ site.title }} {{ site.n }} {{ later }} {{ types.kind }} {{ shout(\"hi\") }} {{ cycle() }} {{ waitedFor() }}"),
    ]));
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "Squatch 42 async cjs objectobjectfunction HI! a+b waited");
}

#[test]
fn node_built_ins_for_packages() {
    let root = project(&[
        (
            "_data/out.js",
            r#"import { EventEmitter } from "node:events";
import util from "node:util";
import assert from "node:assert";
import os from "node:os";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

// ES5-style inheritance, as older packages do it.
function Squatch() { EventEmitter.call(this); }
util.inherits(Squatch, EventEmitter);
const s = new Squatch();
const heard = [];
s.on("snack", x => heard.push(x));
s.once("snack", x => heard.push("once " + x));
s.emit("snack", "berries");
s.emit("snack", "cones");
assert.deepStrictEqual(heard, ["berries", "once berries", "cones"]);
let threw = false;
try { assert.strictEqual(1, 2); } catch (e) { threw = e.code === "ERR_ASSERTION"; }
await sleep(5);
export default [
  heard.length,
  util.format("%s has %d snacks %j", "Squatch", 3, { a: 1 }),
  util.inspect({ a: [1, { b: "c" }] }),
  threw,
  typeof os.EOL,
  typeof http.request,
  await util.promisify((x, cb) => cb(null, x * 2))(21),
  new TextDecoder().decode(new TextEncoder().encode("✓")),
  typeof globalThis.global,
].join("|");
"#,
        ),
        ("index.edge", "{{{ out }}}"),
    ]);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "3|Squatch has 3 snacks {\"a\":1}|{ a: [ 1, { b: 'c' } ] }|true|string|function|42|✓|object");
}

#[test]
fn stub_built_ins_load_but_throw_when_used() {
    let e = build_error(&[("_data/x.js", "const http = require(\"http\");\nmodule.exports = http.get(\"http://localhost\");\n"), ("index.edge", "")]);
    assert!(e.contains("_data/x.js") && e.contains("node:http isn't available in ssqch"), "{}", e);
}

#[test]
fn package_errors_say_what_to_fix() {
    let e = build_error(&with_packages(&[("_data/x.js", "import x from \"dual/secret\"; export default x;"), ("index.edge", "")]));
    assert!(e.contains("package \"dual\" doesn't export \"./secret\" for import (see the \"exports\" in its package.json)"), "{}", e);

    let e = build_error(&[("_data/x.js", "module.exports = require(\"left-pad\");"), ("index.edge", "")]);
    assert!(e.contains("_data/x.js") && e.contains("Cannot find module 'left-pad' from '_data/x.js': package \"left-pad\" isn't installed"), "{}", e);

    let e = build_error(&[
        ("node_modules/boom/index.js", "exports.go = () => {\n  throw new Error(\"pine cones ran out\");\n};\n"),
        ("_data/x.js", "const { go } = require(\"boom\");\nmodule.exports = go();\n"),
        ("index.edge", ""),
    ]);
    assert!(e.contains("pine cones ran out") && e.contains("(node_modules/boom/index.js:2:"), "{}", e);
    assert!(!e.contains("<ssqch>") && !e.contains("at call (native)"), "internal frames should be hidden: {}", e);
}

#[test]
fn timers_run_while_a_promise_waits() {
    let root = project(&[
        (
            "_data/out.js",
            r#"const order = [];
setTimeout(() => order.push("b"), 20);
setTimeout(() => order.push("a"), 10);
const cleared = setTimeout(() => order.push("never"), 5);
clearTimeout(cleared);
let ticks = 0;
const interval = setInterval(() => { if (++ticks === 3) clearInterval(interval); }, 1);
setImmediate(() => order.push("now"));
const started = Date.now();
await new Promise(resolve => setTimeout(resolve, 30));
export default `${order.join(",")} ${ticks} ${Date.now() - started >= 25}`;
"#,
        ),
        ("index.edge", "{{ out }}"),
    ]);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "now,a,b 3 true");

    // An unref'd timer doesn't keep anything waiting, as in Node.
    let e = build_error(&[("_data/x.js", "export default await new Promise(r => setTimeout(r, 10).unref());"), ("index.edge", "")]);
    assert!(e.contains("_data/x.js: a Promise never settled"), "{}", e);
}

#[test]
fn urls_follow_the_whatwg_standard() {
    let root = project(&[
        (
            "_data/out.js",
            r#"const u = new URL("../a/b?x=1&y=two%20words#h", "https://Example.COM:443/docs/page/");
u.searchParams.append("z", "ü");
u.hash = "";
const p = new URLSearchParams([["q", "a b&c"], ["q", "2"]]);
export default [u.href, u.host, u.origin, u.searchParams.get("y"), p.toString(), p.getAll("q").length, URL.canParse("nope"), new URL("file:///a/b c").pathname].join("|");
"#,
        ),
        ("index.edge", "{{{ out }}}"),
    ]);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "https://example.com/docs/a/b?x=1&y=two+words&z=%C3%BC|example.com|https://example.com|two words|q=a+b%26c&q=2|2|false|/a/b%20c");
}

#[cfg(feature = "fetch")]
/// A tiny HTTP server for `fetch`: answers each request by path, on a
/// thread, until the test ends.
fn serve() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut parts = line.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
                let mut headers = Vec::new();
                let mut length = 0;
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    let h = h.trim_end().to_string();
                    if h.is_empty() {
                        break;
                    }
                    if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                    headers.push(h);
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let header = |name: &str| headers.iter().find_map(|h| h.to_ascii_lowercase().strip_prefix(&format!("{}:", name)).map(|v| v.trim().to_string())).unwrap_or_default();
                let (status, extra, text) = match path.as_str() {
                    "/data.json" => ("200 OK", "content-type: application/json\r\n".to_string(), r#"{"snacks":["pine cones","berries"]}"#.to_string()),
                    "/echo" => ("201 Created", "set-cookie: a=1\r\nset-cookie: b=2\r\n".to_string(), format!("{} {} {} {}", method, String::from_utf8_lossy(&body), header("content-type"), header("x-squatch"))),
                    "/moved" => ("301 Moved Permanently", "location: /data.json\r\n".to_string(), String::new()),
                    p if p.starts_with("/slow") => {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        ("200 OK", String::new(), "slow".to_string())
                    }
                    _ => ("404 Not Found", String::new(), "nope".to_string()),
                };
                let mut stream = stream;
                let _ = write!(stream, "HTTP/1.1 {}\r\n{}content-length: {}\r\nconnection: close\r\n\r\n{}", status, extra, text.len(), text);
            });
        }
    });
    format!("http://{}", addr)
}

#[cfg(feature = "fetch")]
#[test]
fn fetch_makes_requests() {
    let base = serve();
    let data = format!(
        r#"const base = "{}";
const out = [];
const r = await fetch(`${{base}}/data.json`);
out.push(`${{r.status}} ${{r.ok}} ${{r.headers.get("content-type")}} ${{(await r.json()).snacks.join("+")}}`);
const e = await fetch(new URL("/echo", base), {{ method: "post", body: JSON.stringify({{ a: 1 }}), headers: {{ "Content-Type": "application/json", "X-Squatch": "yes" }} }});
out.push(`${{e.status}} ${{await e.text()}} ${{e.headers.getSetCookie().join(";")}}`);
const started = Date.now();
const many = await Promise.all([1, 2, 3, 4].map(i => fetch(`${{base}}/slow?${{i}}`).then(r => r.text())));
out.push(`${{many.join(",")}} ${{Date.now() - started < 1100 ? "parallel" : "one at a time"}}`);
const moved = await fetch(`${{base}}/moved`);
out.push(`${{moved.status}} ${{moved.redirected}} ${{moved.url.endsWith("/data.json")}}`);
const manual = await fetch(`${{base}}/moved`, {{ redirect: "manual" }});
out.push(`${{manual.status}} ${{manual.headers.get("location")}}`);
const missing = await fetch(`${{base}}/missing`);
out.push(`${{missing.status}} ${{missing.ok}} ${{missing.bodyUsed}} ${{await missing.text()}} ${{missing.bodyUsed}}`);
try {{ await fetch(`${{base}}/slow`, {{ signal: AbortSignal.timeout(50) }}); out.push("no timeout"); }} catch (err) {{ out.push(err.name); }}
try {{ await fetch("file:///etc/hosts"); }} catch (err) {{ out.push(err.message); }}
export default out.join("\n");
"#,
        base
    );
    let root = project(&[("_data/out.js", &data), ("index.edge", "{{{ out }}}")]);
    build(&root).unwrap();
    let got = read(&root, "_site/index.html");
    assert_eq!(
        got.lines().collect::<Vec<_>>(),
        [
            "200 true application/json pine cones+berries",
            "201 POST {\"a\":1} application/json yes a=1;b=2",
            "slow,slow,slow,slow parallel",
            "200 true true",
            "301 /data.json",
            "404 false false nope true",
            "TimeoutError",
            "fetch failed: file:///etc/hosts: only http: and https: URLs can be fetched",
        ]
    );
}

#[cfg(feature = "fetch")]
#[test]
fn fetch_errors_reject_with_type_errors() {
    // Nothing listens on port 9 here (the discard port), or it refuses.
    let root = project(&[("_data/out.js", "try { await fetch(\"http://127.0.0.1:9/\"); } catch (e) { var out = `${e.name}: ${e.message.startsWith(\"fetch failed: http://127.0.0.1:9/\")}`; }\nexport default out;"), ("index.edge", "{{ out }}")]);
    build(&root).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "TypeError: true");
}

#[test]
fn changed_commonjs_data_files_reload_between_builds() {
    let root = project(&[("_data/snacks.js", "module.exports = [\"Pine Cone Crunch\"];"), ("index.edge", "{{ snacks.join(\", \") }}")]);
    let mut cfg = Config::new(&root, Environment::Development);
    cfg.quiet = true;
    sitesquatch_js::add_data_files(&mut cfg, &[]);
    sitesquatch::build(&cfg).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "Pine Cone Crunch");

    let file = root.join("_data/snacks.js");
    std::fs::write(&file, "module.exports = [\"Yeti Yogurt\"];").unwrap();
    let later = std::fs::metadata(&file).unwrap().modified().unwrap() + std::time::Duration::from_secs(2);
    std::fs::File::options().write(true).open(&file).unwrap().set_modified(later).unwrap();
    sitesquatch::build(&cfg).unwrap();
    assert_eq!(read(&root, "_site/index.html"), "Yeti Yogurt");
}
