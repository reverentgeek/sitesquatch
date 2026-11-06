//! Remembers each source image's id between builds, so a warm build doesn't
//! re-read every image to hash it.
//!
//! Ids are hashes of file contents (see `ImageProcessor::hash_id`), which
//! keeps them stable across fresh clones. Reading ~400 MB of images on every
//! build costs ~20 ms, so this cache keeps `(size, modification time,
//! settings) -> id` in `.cache/ssqch/image-hashes.json`. A file whose size or
//! modification time changed is read and hashed again, so a fresh CI checkout
//! (new modification times) re-hashes everything once and still gets the same
//! ids. The cache holds no secrets but does name source paths, which is why it
//! lives in `.cache/` and not next to the published images.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::{Context, Result};

/// Where the cache lives, relative to the project root.
pub const CACHE_FILE: &str = ".cache/ssqch/image-hashes.json";

#[derive(Clone, PartialEq)]
struct Entry {
    size: u64,
    mtime: u128,
    settings: String,
    id: String,
}

#[derive(Default)]
pub(crate) struct HashCache {
    path: Option<PathBuf>,
    entries: HashMap<String, Entry>,
    used: HashSet<String>,
    dirty: bool,
}

/// What a file's id is checked against: its size and modification time.
pub(crate) fn stamp(src: &Path) -> Result<(u64, Option<u128>)> {
    let meta = std::fs::metadata(src).with_context(|| format!("image not found: {}", src.display()))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos());
    Ok((meta.len(), mtime))
}

impl HashCache {
    /// Load the cache at `path`, once per process (later builds reuse what's
    /// in memory). A missing or unreadable file is an empty cache.
    pub(crate) fn load(&mut self, path: PathBuf) {
        self.used.clear();
        if self.path.as_ref() == Some(&path) {
            return;
        }
        self.entries = std::fs::read_to_string(&path).ok().and_then(|text| parse(&text)).unwrap_or_default();
        self.path = Some(path);
        self.dirty = false;
    }

    pub(crate) fn get(&mut self, src: &Path, size: u64, mtime: u128, settings: &str) -> Option<String> {
        let key = src.to_string_lossy().into_owned();
        let e = self.entries.get(&key)?;
        if e.size == size && e.mtime == mtime && e.settings == settings {
            let id = e.id.clone();
            self.used.insert(key);
            return Some(id);
        }
        None
    }

    pub(crate) fn put(&mut self, src: &Path, size: u64, mtime: u128, settings: &str, id: &str) {
        let key = src.to_string_lossy().into_owned();
        let entry = Entry { size, mtime, settings: settings.to_string(), id: id.to_string() };
        if self.entries.get(&key) != Some(&entry) {
            self.entries.insert(key.clone(), entry);
            self.dirty = true;
        }
        self.used.insert(key);
    }

    /// Write the cache if it changed, keeping only the images this build
    /// used. Does nothing for a build that used no images and has no cache.
    pub(crate) fn save(&mut self) -> Result<()> {
        let Some(path) = self.path.clone() else { return Ok(()) };
        let before = self.entries.len();
        let used = &self.used;
        self.entries.retain(|k, _| used.contains(k));
        if !self.dirty && self.entries.len() == before {
            return Ok(());
        }
        if self.entries.is_empty() && !path.exists() {
            return Ok(());
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serialize(&self.entries))?;
        std::fs::rename(&tmp, &path)?;
        self.dirty = false;
        Ok(())
    }
}

fn serialize(entries: &HashMap<String, Entry>) -> String {
    let mut keys: Vec<&String> = entries.keys().collect();
    keys.sort();
    let files: serde_json::Map<String, serde_json::Value> = keys
        .into_iter()
        .map(|k| {
            let e = &entries[k];
            // The modification time is in nanoseconds, too big for a JSON number.
            (k.clone(), serde_json::json!({ "size": e.size, "mtime": e.mtime.to_string(), "settings": e.settings, "id": e.id }))
        })
        .collect();
    let doc = serde_json::json!({ "version": 1, "files": files });
    serde_json::to_string_pretty(&doc).unwrap_or_default() + "\n"
}

fn parse(text: &str) -> Option<HashMap<String, Entry>> {
    let doc: serde_json::Value = serde_json::from_str(text).ok()?;
    if doc.get("version")?.as_u64()? != 1 {
        return None;
    }
    let mut out = HashMap::new();
    for (k, v) in doc.get("files")?.as_object()? {
        let entry = (|| {
            Some(Entry {
                size: v.get("size")?.as_u64()?,
                mtime: v.get("mtime")?.as_str()?.parse().ok()?,
                settings: v.get("settings")?.as_str()?.to_string(),
                id: v.get("id")?.as_str()?.to_string(),
            })
        })();
        if let Some(e) = entry {
            out.insert(k.clone(), e);
        }
    }
    Some(out)
}
