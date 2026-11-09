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
