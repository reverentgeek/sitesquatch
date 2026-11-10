//! `ssqch sighting`: not in `--help`. A picture, and when the site was last built.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::SystemTime;

use sitesquatch::cli::clap;

const PHOTO: &str = r"
       /\                                 /\
      /  \             /\                /  \
     /    \           /  \       _      /    \
    /      \         /    \     (_)    /      \
   /        \       /      \   /| |\  /        \
  /__________\     /________\  '| |' /__________\
       ||              ||       / \       ||
       ||              ||      /   \      ||
";

pub fn sighting_command() -> clap::Command {
    clap::Command::new("sighting").about("Photographic evidence").hide(true)
}

pub fn run_sighting(matches: &clap::ArgMatches) -> ExitCode {
    let root = matches.try_get_one::<PathBuf>("root").ok().flatten().cloned().unwrap_or_else(|| PathBuf::from("."));
    println!("{}\n  Image quality meets cryptozoological standards.\n\n  {}", PHOTO, last_siting(&root, SystemTime::now()));
    ExitCode::SUCCESS
}

/// The last build of the site in `root`, from the list a build keeps of what
/// it wrote: how many pages, where, and how long ago.
fn last_siting(root: &Path, now: SystemTime) -> String {
    let none = || "No confirmed sitings here yet. `ssqch build` would be the first.".to_string();
    let Some(list) = std::fs::read_to_string(root.join(sitesquatch::build::OUTPUT_LIST)).ok().and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok()) else { return none() };
    let output = list["output"].as_str().unwrap_or("");
    // A list from before 0.4 doesn't tell pages from other files.
    let named = |key: &str| -> Vec<&str> { list[key].as_array().into_iter().flatten().filter_map(|f| f.as_str()).collect() };
    let pages = if list["pages"].is_array() { named("pages") } else { named("files").into_iter().filter(|f| f.ends_with(".html")).collect() };
    let Some(newest) = pages.iter().filter_map(|page| std::fs::metadata(root.join(output).join(page)).and_then(|m| m.modified()).ok()).max() else { return none() };
    let minutes = now.duration_since(newest).map(|d| d.as_secs() / 60).unwrap_or(0);
    let unit = |n: u64, name: &str| format!("{} {}{} ago", n, name, if n == 1 { "" } else { "s" });
    let ago = match minutes {
        0 => "just now".to_string(),
        1..=59 => unit(minutes, "minute"),
        60..=1439 => unit(minutes / 60, "hour"),
        _ => unit(minutes / 1440, "day"),
    };
    format!("Last confirmed siting: {} page{} in {}/, {}.", sitesquatch::report::count(pages.len()), if pages.len() == 1 { "" } else { "s" }, output, ago)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_build_is_the_last_siting() {
        let dir = std::env::temp_dir().join(format!("ssqch-sighting-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".cache/ssqch")).unwrap();
        std::fs::create_dir_all(dir.join("dist/about")).unwrap();
        assert_eq!(last_siting(&dir, SystemTime::now()), "No confirmed sitings here yet. `ssqch build` would be the first.");
        std::fs::write(dir.join("dist/index.html"), "home").unwrap();
        std::fs::write(dir.join("dist/about/index.html"), "about").unwrap();
        std::fs::write(dir.join(sitesquatch::build::OUTPUT_LIST), r#"{ "output": "dist", "files": ["index.html", "about/index.html", "site.css"], "pages": ["index.html", "about/index.html"] }"#).unwrap();
        let built = std::fs::metadata(dir.join("dist/about/index.html")).unwrap().modified().unwrap();
        let later = |seconds: u64| last_siting(&dir, built + std::time::Duration::from_secs(seconds));
        assert_eq!(later(5), "Last confirmed siting: 2 pages in dist/, just now.");
        assert_eq!(later(60), "Last confirmed siting: 2 pages in dist/, 1 minute ago.");
        assert_eq!(later(12 * 60), "Last confirmed siting: 2 pages in dist/, 12 minutes ago.");
        assert_eq!(later(3 * 3600), "Last confirmed siting: 2 pages in dist/, 3 hours ago.");
        assert_eq!(later(2 * 86400), "Last confirmed siting: 2 pages in dist/, 2 days ago.");
        // A list from an older ssqch has no `pages`.
        std::fs::write(dir.join(sitesquatch::build::OUTPUT_LIST), r#"{ "output": "dist", "files": ["index.html", "site.css"] }"#).unwrap();
        assert_eq!(later(5), "Last confirmed siting: 1 page in dist/, just now.");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
