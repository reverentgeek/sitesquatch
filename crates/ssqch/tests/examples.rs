//! Every site in `examples/sites/` builds, with no broken links (each one
//! uses `linksPlugin`, which fails a production build on a broken link).

use std::path::{Path, PathBuf};
use std::process::Command;

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let name = entry.file_name();
        if name == "dist" || name == ".cache" {
            continue;
        }
        let (src, dest) = (entry.path(), to.join(&name));
        if src.is_dir() {
            copy_dir(&src, &dest);
        } else {
            std::fs::copy(&src, &dest).unwrap();
        }
    }
}

fn build(site: &Path, env: &[(&str, &str)]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["build", "--root"]).arg(site).envs(env.iter().copied()).env("TZ", "UTC").output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

fn sites() -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/sites");
    let mut sites: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.join("ssqch.config.js").is_file()).collect();
    sites.sort();
    sites
}

#[test]
fn every_example_builds_without_broken_links() {
    let sites = sites();
    assert!(sites.len() >= 4, "{:?}", sites);
    for site in sites {
        let name = site.file_name().unwrap().to_string_lossy().to_string();
        let copy = std::env::temp_dir().join(format!("ssqch-example-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&copy);
        copy_dir(&site, &copy);
        let (ok, log) = build(&copy, &[]);
        assert!(ok, "{} failed to build:\n{}", name, log);
        assert!(log.contains(", 0 broken"), "{}: no link check in\n{}", name, log);
        assert!(copy.join("README.md").is_file(), "{} needs a README.md", name);
    }
}

#[test]
fn blog_categories_builds_the_staging_site() {
    let site = sites().into_iter().find(|s| s.ends_with("blog-categories")).unwrap();
    let copy = std::env::temp_dir().join(format!("ssqch-example-staging-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&copy);
    copy_dir(&site, &copy);
    let (ok, log) = build(&copy, &[("SITE", "staging")]);
    assert!(ok, "{}", log);
    let home = std::fs::read_to_string(copy.join("dist/index.html")).unwrap();
    assert!(home.contains("This is the staging site."), "{}", home);
    assert!(std::fs::read_to_string(copy.join("dist/sitemap.xml")).unwrap().contains("https://staging.blog-categories.sitesquatch.dev/"));
}

#[test]
fn islands_load_scripts_only_where_they_are_used() {
    let site = sites().into_iter().find(|s| s.ends_with("islands")).unwrap();
    let copy = std::env::temp_dir().join(format!("ssqch-example-islands-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&copy);
    copy_dir(&site, &copy);
    let (ok, log) = build(&copy, &[]);
    assert!(ok, "{}", log);
    assert!(log.contains("Elements  3 defined, 3 used on 2 pages"), "{}", log);
    let read = |path: &str| std::fs::read_to_string(copy.join("dist").join(path)).unwrap();
    let home = read("index.html");
    assert!(home.contains("<link rel=\"stylesheet\" href=\"/elements/like-button.css\">\n</head>"), "{}", home);
    assert!(home.contains("<script type=\"module\" src=\"/elements/like-button.js\"></script>"), "{}", home);
    assert!(home.contains("[\"local-time\",\"/elements/local-time.js\",\"idle\"]") && !home.contains("trail-filter") && !home.contains("ssqch:load"), "{}", home);
    let trails = read("trails/index.html");
    assert!(trails.contains("[\"trail-filter\",\"/elements/trail-filter.js\",\"visible\"]") && trails.contains("like-button.js") && !trails.contains("local-time"), "{}", trails);
    assert!(trails.contains("<li data-level=\"easy\">Cedar Hollow: 3.2 miles, easy</li>"), "{}", trails);
    assert!(!read("about/index.html").contains("<script"), "the about page has no islands, so no scripts");
    for file in ["like-button.js", "like-button.css", "local-time.js", "trail-filter.js", "shared/storage.js"] {
        assert!(copy.join("dist/elements").join(file).is_file(), "{} wasn't copied", file);
    }

    // Under a base, the tags and the lazy loader's URLs both get it.
    let (ok, log) = Command::new(env!("CARGO_BIN_EXE_ssqch")).args(["build", "--base", "/repo/", "--root"]).arg(&copy).output().map(|o| (o.status.success(), String::from_utf8_lossy(&o.stderr).to_string())).unwrap();
    assert!(ok, "{}", log);
    let home = read("index.html");
    assert!(home.contains("src=\"/repo/elements/like-button.js\"") && home.contains("\"/repo/elements/local-time.js\""), "{}", home);
}
