//! `files(pattern, { dimensions })` from `ssqch`: the files a glob matches,
//! as data, for a gallery of photos or a folder of downloads.

use std::path::Path;

use anyhow::{bail, Result};
use chrono::{DateTime, NaiveDate, Utc};
use sitesquatch::{Map, Value};

/// Where image sizes are kept between builds, by path, size and modification time.
const SIZES_CACHE: &str = ".cache/ssqch/image-sizes.json";

/// The files under `root` that `pattern` matches (ignoring case), sorted by
/// path: `{ path, url, name, stem, ext, date, dateFrom, size }`, and `width`
/// and `height` with `dimensions` (`null` for a file that isn't an image).
pub fn list(root: &Path, pattern: &str, dimensions: bool) -> Result<Value> {
    let call = || format!("files({:?})", pattern);
    let pattern = pattern.trim().trim_start_matches("./");
    if pattern.is_empty() {
        bail!("{}: give a glob, like files(\"images/*.jpg\")", call());
    }
    if Path::new(pattern).is_absolute() || pattern.split('/').any(|part| part == "..") {
        bail!("{}: the glob is from the project root, and can't leave it", call());
    }
    let glob = globset::GlobBuilder::new(pattern).case_insensitive(true).literal_separator(true).build().map_err(|e| anyhow::anyhow!("{}: not a glob ({})", call(), e))?.compile_matcher();
    // Walk only below the part of the pattern without wildcards.
    let base: std::path::PathBuf = pattern.split('/').take_while(|part| !part.contains(['*', '?', '[', '{'])).collect();
    let base = if base.as_os_str() == pattern { base.parent().map(Path::to_path_buf).unwrap_or_default() } else { base };
    let input = sitesquatch::data::input_dir();
    let mut found = Vec::new();
    for entry in walkdir::WalkDir::new(root.join(&base)).follow_links(true).sort_by_file_name() {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() || entry.file_name() == ".DS_Store" {
            continue;
        }
        let path = entry.path();
        let rel = sitesquatch::slashes(path.strip_prefix(root).unwrap_or(path));
        if !glob.is_match(&rel) {
            continue;
        }
        found.push((rel, path.to_path_buf(), entry.metadata().ok()));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    let sizes = if dimensions { image_sizes(root, &found) } else { Vec::new() };
    let items = found
        .into_iter()
        .enumerate()
        .map(|(i, (rel, path, meta))| {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let (stem, ext) = match name.rsplit_once('.') {
                Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), ext.to_ascii_lowercase()),
                _ => (name.clone(), String::new()),
            };
            // The URL a passthrough copy to the same path gets: from the input folder when it's inside it.
            let from_input = input.as_deref().and_then(|dir| path.strip_prefix(dir).ok()).map(sitesquatch::slashes);
            let url = format!("/{}", from_input.unwrap_or_else(|| rel.clone()));
            let modified = meta.as_ref().and_then(|m| m.modified().ok()).map(DateTime::<Utc>::from);
            let named = date_in_name(&name);
            let date_from = if named.is_some() { "name" } else { "modified" };
            let date = named.or(modified).unwrap_or_default();
            let mut item = Map::new();
            item.insert("path".into(), Value::from(rel.as_str()));
            item.insert("url".into(), Value::from(url.as_str()));
            item.insert("name".into(), Value::from(name.as_str()));
            item.insert("stem".into(), Value::from(stem.as_str()));
            item.insert("ext".into(), Value::from(ext.as_str()));
            item.insert("date".into(), Value::Date(date));
            item.insert("dateFrom".into(), Value::from(date_from));
            item.insert("size".into(), Value::Num(meta.map_or(0, |m| m.len()) as f64));
            if dimensions {
                let size = sizes.get(i).copied().flatten();
                item.insert("width".into(), size.map_or(Value::Null, |(w, _)| Value::Num(w as f64)));
                item.insert("height".into(), size.map_or(Value::Null, |(_, h)| Value::Num(h as f64)));
            }
            Value::object(item)
        })
        .collect();
    Ok(Value::array(items))
}

/// Each file's width and height, from the cache when its size and modification
/// time haven't changed, otherwise from its header (read on a few threads, since
/// a cold disk makes that slow: about 100 µs a photo). New sizes go back in the cache.
fn image_sizes(root: &Path, found: &[(String, std::path::PathBuf, Option<std::fs::Metadata>)]) -> Vec<Option<(u64, u64)>> {
    type Cache = std::collections::HashMap<String, (u64, u64, Option<(u64, u64)>)>;
    let cache_path = root.join(SIZES_CACHE);
    let mut cache: Cache = std::fs::read(&cache_path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    let stamp = |meta: &Option<std::fs::Metadata>| {
        let meta = meta.as_ref();
        let modified = meta.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64);
        (meta.map_or(0, |m| m.len()), modified)
    };
    let mut sizes: Vec<Option<Option<(u64, u64)>>> = found
        .iter()
        .map(|(rel, _, meta)| cache.get(rel).filter(|(len, modified, _)| (*len, *modified) == stamp(meta)).map(|(_, _, size)| *size))
        .collect();
    let missing: Vec<usize> = (0..found.len()).filter(|i| sizes[*i].is_none()).collect();
    if missing.is_empty() {
        return sizes.into_iter().map(Option::flatten).collect();
    }
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).min(8).min(missing.len());
    let read: Vec<(usize, Option<(u64, u64)>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = missing
            .chunks(missing.len().div_ceil(threads))
            .map(|chunk| scope.spawn(move || chunk.iter().map(|&i| (i, imagesize::size(&found[i].1).ok().map(|s| (s.width as u64, s.height as u64)))).collect::<Vec<_>>()))
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    for (i, size) in read {
        sizes[i] = Some(size);
        let (len, modified) = stamp(&found[i].2);
        cache.insert(found[i].0.clone(), (len, modified, size));
    }
    if let Ok(json) = serde_json::to_vec(&cache) {
        let _ = std::fs::create_dir_all(cache_path.parent().unwrap_or(root)).and_then(|_| std::fs::write(&cache_path, json));
    }
    sizes.into_iter().map(Option::flatten).collect()
}

/// A date at the start of a file name: `2001-12-22-camp.jpg` or
/// `20011222_08.JPG`, at midnight UTC.
fn date_in_name(name: &str) -> Option<DateTime<Utc>> {
    let digits: String = name.chars().take(10).filter(|c| *c != '-').collect();
    let compact = name.get(..8).filter(|d| d.bytes().all(|b| b.is_ascii_digit()) && !name[8..].starts_with(|c: char| c.is_ascii_digit()));
    let dashed = name.get(..10).filter(|d| d.as_bytes().get(4) == Some(&b'-') && d.as_bytes().get(7) == Some(&b'-') && digits.len() == 8 && digits.bytes().all(|b| b.is_ascii_digit()));
    let ymd = compact.map(String::from).or(dashed.map(|_| digits))?;
    let date = NaiveDate::parse_from_str(&ymd, "%Y%m%d").ok()?;
    Some(date.and_hms_opt(0, 0, 0)?.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_come_from_file_names() {
        let day = |s: &str| date_in_name(s).map(|d| d.format("%Y-%m-%d").to_string());
        assert_eq!(day("20011222_08.JPG").as_deref(), Some("2001-12-22"));
        assert_eq!(day("2024-06-01-camp.png").as_deref(), Some("2024-06-01"));
        assert_eq!(day("20011322_08.JPG"), None);
        assert_eq!(day("200112220.jpg"), None);
        assert_eq!(day("pine-cone.jpg"), None);
        assert_eq!(day("2024-0601.jpg"), None);
    }
}
