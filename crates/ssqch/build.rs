//! Puts the documentation into the binary, for `ssqch docs`: the README and
//! the migration guides in `docs/guides/`, so the answers match the version
//! that's installed.
//!
//! In the repository they're two folders up. A published crate has only the
//! README, which `cargo package` copies into the crate's root; the guides
//! stay out of it, and `ssqch docs --from` links to them instead.

use std::path::{Path, PathBuf};

fn main() {
    let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace = crate_dir.join("../..");
    let readme = [workspace.join("README.md"), crate_dir.join("README.md")].into_iter().find(|p| p.is_file()).expect("README.md, for ssqch docs");
    println!("cargo:rerun-if-changed={}", readme.display());

    let guides_dir = workspace.join("docs/guides");
    println!("cargo:rerun-if-changed={}", guides_dir.display());
    let mut guides: Vec<PathBuf> = std::fs::read_dir(&guides_dir)
        .map(|dir| dir.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    guides.sort();

    // CARGO_MANIFEST_DIR is absolute, so these are too.
    let path = |p: &Path| format!("{:?}", p.display().to_string());
    let mut out = format!("pub const README: &str = include_str!({});\n", path(&readme));
    out.push_str("pub const GUIDES: &[(&str, &str)] = &[\n");
    for guide in &guides {
        println!("cargo:rerun-if-changed={}", guide.display());
        let name = guide.file_name().unwrap().to_string_lossy();
        out.push_str(&format!("    ({:?}, include_str!({})),\n", name, path(guide)));
    }
    out.push_str("];\n");
    std::fs::write(PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("docs.rs"), out).unwrap();
}
