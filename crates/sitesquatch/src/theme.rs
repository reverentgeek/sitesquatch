//! Themes: a site's defaults, without a package manager.
//!
//! A theme is a folder shaped like a site's input folder: `_includes/`
//! (layouts, partials, hooks, containers), `_data/`, pages, and files to copy
//! (stylesheets, fonts). The site sits on top of it, file by file:
//!
//! - an include, layout, hook or container the site has wins over the
//!   theme's at the same path,
//! - `_data` is merged, with the site's values winning,
//! - a page or file in the theme is built or copied unless the site's input
//!   folder has a file at the same path.
//!
//! A theme is a folder in the project (`themes/docs`), or a git repository
//! pinned to a commit or tag (`https://github.com/you/theme#v1.2.0`), which
//! is fetched once with `git` and kept in `.cache/ssqch/themes/`. With more
//! than one theme, earlier ones sit on top of later ones.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

/// Where a theme comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ThemeSource {
    /// A folder, relative to the project root.
    Folder(PathBuf),
    /// A git repository at a commit, tag or branch, and the folder inside it
    /// that's the theme (empty for the repository's root).
    Git { url: String, reference: String, dir: String },
}

fn is_git_url(s: &str) -> bool {
    ["https://", "http://", "ssh://", "git://", "file://", "git@"].iter().any(|p| s.starts_with(p))
}

impl ThemeSource {
    /// `themes/docs`, or `https://github.com/you/theme#v1.2.0` (with
    /// `#ref:folder` for a theme in a folder of its repository).
    pub fn parse(spec: &str) -> Result<ThemeSource> {
        let spec = spec.trim();
        if spec.is_empty() {
            bail!("theme is empty: give a folder (\"themes/docs\") or a git URL with a commit or tag (\"https://github.com/you/theme#v1.2.0\")");
        }
        if !is_git_url(spec) {
            return Ok(ThemeSource::Folder(PathBuf::from(spec)));
        }
        let Some((url, pin)) = spec.split_once('#').filter(|(_, pin)| !pin.is_empty()) else {
            bail!("theme {:?} isn't pinned: add the commit or tag to use, like \"{}#v1.2.0\"", spec, spec.trim_end_matches('#'));
        };
        let (reference, dir) = pin.split_once(':').unwrap_or((pin, ""));
        ThemeSource::git(url, reference, dir)
    }

    pub fn git(url: &str, reference: &str, dir: &str) -> Result<ThemeSource> {
        if !is_git_url(url) {
            bail!("theme: {:?} isn't a git URL (https://, ssh://, git@ or file://)", url);
        }
        if reference.is_empty() || reference.starts_with('-') || reference.contains(char::is_whitespace) {
            bail!("theme {:?}: {:?} isn't a commit or tag", url, reference);
        }
        let dir = dir.trim_matches('/');
        if dir.split('/').any(|p| p == "..") || dir.contains(['\\', ':']) {
            bail!("theme {:?}: the folder {:?} must be inside the repository", url, dir);
        }
        Ok(ThemeSource::Git { url: url.to_string(), reference: reference.to_string(), dir: dir.to_string() })
    }

    /// The theme's folder, fetching a git theme if it isn't cached yet.
    pub fn resolve(&self, root: &Path, quiet: bool) -> Result<PathBuf> {
        match self {
            ThemeSource::Folder(rel) => {
                let dir = root.join(rel);
                if !dir.is_dir() {
                    bail!("theme folder {} doesn't exist", dir.display());
                }
                Ok(dunce::canonicalize(&dir).unwrap_or(dir))
            }
            ThemeSource::Git { url, reference, dir } => {
                let checkout = fetch(root, url, reference, quiet)?;
                let theme = checkout.join(dir);
                if !theme.is_dir() {
                    bail!("theme {}#{}: there's no folder {:?} in it", url, reference, dir);
                }
                Ok(dunce::canonicalize(&theme).unwrap_or(theme))
            }
        }
    }
}

/// A name for a checkout's folder: the repository's name and a hash of where it's from.
fn cache_name(url: &str, reference: &str) -> String {
    let name: String = url.trim_end_matches('/').trim_end_matches(".git").rsplit(['/', ':']).next().unwrap_or("theme").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    // FNV-1a: stable across builds and platforms, which is all this needs.
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in url.bytes().chain(std::iter::once(b'#')).chain(reference.bytes()) {
        hash = (hash ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("{}-{:016x}", if name.is_empty() { "theme" } else { &name }, hash)
}

/// The cached checkout of `url` at `reference`, fetching it the first time.
fn fetch(root: &Path, url: &str, reference: &str, quiet: bool) -> Result<PathBuf> {
    let dir = root.join(".cache/ssqch/themes").join(cache_name(url, reference));
    let marker = dir.join(".ssqch-theme");
    let source = format!("{}#{}", url, reference);
    if std::fs::read_to_string(&marker).is_ok_and(|m| m.trim() == source) {
        return Ok(dir);
    }
    if !quiet {
        println!("[ssqch] Fetching theme {}", source);
    }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let git = |args: &[&str]| -> Result<()> {
        let out = Command::new("git").arg("-C").arg(&dir).args(args).output().map_err(|e| anyhow::anyhow!("theme {}: can't run git ({}); install git, or use a theme folder", source, e))?;
        if !out.status.success() {
            let _ = std::fs::remove_dir_all(&dir);
            // A shortened hash isn't a name a server knows.
            let short = (7..40).contains(&reference.len()) && reference.bytes().all(|b| b.is_ascii_hexdigit());
            let hint = if short { " (if that's a commit, give all 40 characters of its hash)" } else { "" };
            bail!("theme {}: git {} failed: {}{}", source, args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim(), hint);
        }
        Ok(())
    };
    git(&["init", "--quiet"])?;
    // One commit, by name: a tag, a branch, or (on hosts that allow it, like GitHub) a commit's hash.
    git(&["fetch", "--quiet", "--depth", "1", "--", url, reference])?;
    git(&["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"])?;
    // A snapshot, not a clone: the history isn't needed again.
    let _ = std::fs::remove_dir_all(dir.join(".git"));
    std::fs::write(&marker, &source).with_context(|| format!("writing {}", marker.display()))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_sources_parse() {
        assert_eq!(ThemeSource::parse("themes/docs").unwrap(), ThemeSource::Folder("themes/docs".into()));
        assert_eq!(
            ThemeSource::parse("https://github.com/you/theme#v1.2.0").unwrap(),
            ThemeSource::Git { url: "https://github.com/you/theme".into(), reference: "v1.2.0".into(), dir: String::new() }
        );
        assert_eq!(
            ThemeSource::parse("git@github.com:you/themes.git#3f2a1b4:docs/theme/").unwrap(),
            ThemeSource::Git { url: "git@github.com:you/themes.git".into(), reference: "3f2a1b4".into(), dir: "docs/theme".into() }
        );
        for (bad, why) in [
            ("https://github.com/you/theme", "isn't pinned: add the commit or tag to use, like \"https://github.com/you/theme#v1.2.0\""),
            ("https://github.com/you/theme#", "isn't pinned"),
            ("https://github.com/you/theme#--upload-pack=x", "isn't a commit or tag"),
            ("https://github.com/you/theme#v1:../up", "must be inside the repository"),
            ("https://github.com/you/theme#v1:..\\up", "must be inside the repository"),
            ("", "theme is empty"),
        ] {
            let e = ThemeSource::parse(bad).unwrap_err().to_string();
            assert!(e.contains(why), "{}: {}", bad, e);
        }
        assert_eq!(cache_name("https://github.com/you/My-Theme.git", "v1"), cache_name("https://github.com/you/My-Theme.git", "v1"));
        assert!(cache_name("https://github.com/you/My-Theme.git", "v1").starts_with("My-Theme-"));
        assert_ne!(cache_name("https://github.com/you/t", "v1"), cache_name("https://github.com/you/t", "v2"));
    }
}
