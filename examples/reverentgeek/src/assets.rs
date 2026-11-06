//! Asset fingerprinting: the Rust version of `scripts/hash-assets.js`.
//!
//! In production, `dist/assets/{index.css,index.js,prism.js}` (written by the
//! Tailwind and esbuild steps) are renamed to `name.<sha256:8>.ext` and the
//! names are recorded in `.asset-manifest.json`, in the same format the Node
//! script writes, so either pipeline can produce it. Older fingerprinted
//! copies are removed so a local `dist/` doesn't collect them.
//!
//! If none of the unhashed files exist, an earlier step (or `pnpm run
//! build:hash`) already fingerprinted them and the manifest is left alone.

use std::path::Path;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use sitesquatch::{BuildContext, Environment, Map, Value};

/// Template key and file name of every fingerprinted asset.
const ENTRIES: [(&str, &str); 3] = [("css", "index.css"), ("js", "index.js"), ("prism", "prism.js")];

pub const MANIFEST: &str = ".asset-manifest.json";

pub fn fingerprint(ctx: &BuildContext) -> Result<()> {
    if ctx.env != Environment::Production {
        return Ok(());
    }
    let dir = ctx.output_dir.join("assets");
    let missing: Vec<&str> = ENTRIES.iter().map(|(_, f)| *f).filter(|f| !dir.join(f).is_file()).collect();
    if missing.len() == ENTRIES.len() {
        return Ok(());
    }
    if !missing.is_empty() {
        bail!("missing {} in {} (build the CSS and JS before ssqch)", missing.join(", "), dir.display());
    }

    // Read everything before renaming anything, like hash-assets.js.
    let mut sources = Vec::new();
    for (key, file) in ENTRIES {
        let bytes = std::fs::read(dir.join(file)).with_context(|| format!("reading {}", dir.join(file).display()))?;
        sources.push((key, file, bytes));
    }

    let mut manifest = serde_json::Map::new();
    for (key, file, bytes) in sources {
        let (stem, ext) = file.rsplit_once('.').expect("asset names have an extension");
        let digest = Sha256::digest(&bytes);
        let hashed = format!("{}.{}.{}", stem, &hex(&digest)[..8], ext);
        remove_stale(&dir, stem, ext, &hashed)?;
        std::fs::rename(dir.join(file), dir.join(&hashed))?;
        manifest.insert(key.into(), format!("/assets/{}", hashed).into());
        println!("  {} -> {}", file, hashed);
    }
    let json = serde_json::to_string_pretty(&manifest)?.replace("  ", "\t");
    std::fs::write(ctx.root.join(MANIFEST), json + "\n")?;
    Ok(())
}

/// Template paths for `{{ assets.css }}` etc.
///
/// In production: the fingerprinted names from the manifest. In development:
/// the plain name when a watcher (`pnpm run serve:css`) is writing it,
/// otherwise the fingerprinted file a production build left behind, so
/// `serve` after `build` still has styles. A file that doesn't exist either
/// way gets a warning instead of a silently unstyled site.
pub fn data(ctx: &BuildContext) -> Result<Value> {
    let manifest: serde_json::Map<String, serde_json::Value> = match std::fs::read_to_string(ctx.root.join(MANIFEST)) {
        Ok(text) => serde_json::from_str(&text).with_context(|| format!("invalid {}", MANIFEST))?,
        Err(_) => Default::default(),
    };
    let exists = |url: &str| ctx.output_dir.join(url.trim_start_matches('/')).is_file();
    let mut assets = Map::new();
    for (key, file) in ENTRIES {
        let plain = format!("/assets/{}", file);
        let hashed = manifest.get(key).and_then(|v| v.as_str()).map(String::from);
        let url = match (ctx.env, hashed) {
            (Environment::Production, Some(h)) => h,
            (Environment::Development, Some(h)) if !exists(&plain) && exists(&h) => h,
            _ => plain,
        };
        if !exists(&url) {
            warn_once(format!(
                "{} doesn't exist in {}; build the CSS and JS first (pnpm run build:css and build:js, or serve:css and serve:js while serving)",
                url,
                ctx.output_dir.display()
            ));
        }
        assets.insert(key.into(), Value::from(url));
    }
    Ok(Value::object(assets))
}

fn warn_once(message: String) {
    static WARNED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    let mut warned = WARNED.lock().unwrap();
    if !warned.contains(&message) {
        eprintln!("warn: {}", message);
        warned.push(message);
    }
}

/// Delete `stem.<8 hex>.ext` files other than `keep`.
fn remove_stale(dir: &Path, stem: &str, ext: &str, keep: &str) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let name = entry?.file_name().to_string_lossy().into_owned();
        let Some(hash) = name.strip_prefix(stem).and_then(|r| r.strip_prefix('.')).and_then(|r| r.strip_suffix(ext)).and_then(|r| r.strip_suffix('.')) else {
            continue;
        };
        if name != keep && hash.len() == 8 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            std::fs::remove_file(dir.join(&name))?;
        }
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
