//! Front matter, data files and the data cascade.

use std::path::Path;
use std::sync::Arc;

use anyhow::{bail, Context, Result};

use crate::{Map, Value};

/// Split front matter from a template body: `---` YAML (or `---yaml`,
/// `---json`, `---toml`), or `+++` TOML.
pub fn parse_front_matter(src: &str) -> Result<(Map, &str)> {
    let (format, fence, rest) = if let Some(rest) = src.strip_prefix("+++") {
        ("toml", "+++", rest)
    } else if let Some(rest) = src.strip_prefix("---") {
        let lang_len = rest.find(['\r', '\n']).unwrap_or(rest.len());
        match rest[..lang_len].trim() {
            "" | "yaml" | "yml" => ("yaml", "---", &rest[lang_len..]),
            "json" => ("json", "---", &rest[lang_len..]),
            "toml" => ("toml", "---", &rest[lang_len..]),
            _ => return Ok((Map::new(), src)),
        }
    } else {
        return Ok((Map::new(), src));
    };
    let rest = rest.strip_prefix("\r\n").or_else(|| rest.strip_prefix('\n'));
    let Some(rest) = rest else { return Ok((Map::new(), src)) };
    // Closing fence: a line that is exactly `---` (or `+++`).
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == fence {
            let text = &rest[..offset];
            // Blank lines right after the fence are dropped, like gray-matter.
            let body = rest[offset + line.len()..].trim_start_matches(['\r', '\n']);
            let data = match format {
                "json" => object(serde_json::from_str::<serde_json::Value>(if text.trim().is_empty() { "{}" } else { text }).map(Value::from).context("invalid JSON front matter")?, "JSON")?,
                "toml" => {
                    let t: toml::Table = toml::from_str(text).context("invalid TOML front matter")?;
                    object(toml_to_value(toml::Value::Table(t)), "TOML")?
                }
                _ => parse_yaml(text).context("invalid YAML front matter")?,
            };
            return Ok((data, body));
        }
        offset += line.len();
    }
    bail!("front matter is missing its closing `{}`", fence)
}

fn object(v: Value, format: &str) -> Result<Map> {
    match v {
        Value::Obj(o) => Ok(Arc::try_unwrap(o).unwrap_or_else(|o| (*o).clone())),
        other => bail!("{} front matter must be an object, not {}", format, other.type_of()),
    }
}

/// A TOML value as a template value. A date or time (`2024-01-02`, without
/// quotes) is its text, as a date in YAML front matter is; the page's `date`
/// becomes a real date either way.
pub fn toml_to_value(v: toml::Value) -> Value {
    use toml::Value as T;
    match v {
        T::String(s) => Value::from(s),
        T::Integer(i) => Value::Num(i as f64),
        T::Float(f) => Value::Num(f),
        T::Boolean(b) => Value::Bool(b),
        T::Datetime(d) => Value::from(d.to_string()),
        T::Array(items) => Value::array(items.into_iter().map(toml_to_value).collect()),
        T::Table(table) => Value::object(table.into_iter().map(|(k, v)| (k, toml_to_value(v))).collect()),
    }
}

pub fn parse_yaml(src: &str) -> Result<Map> {
    if src.trim().is_empty() {
        return Ok(Map::new());
    }
    let yaml: serde_yaml::Value = serde_yaml::from_str(src)?;
    match yaml_to_value(yaml) {
        Value::Obj(o) => Ok(Arc::try_unwrap(o).unwrap_or_else(|o| (*o).clone())),
        Value::Null => Ok(Map::new()),
        _ => bail!("expected a mapping at the top level"),
    }
}

pub fn yaml_to_value(v: serde_yaml::Value) -> Value {
    use serde_yaml::Value as Y;
    match v {
        Y::Null => Value::Null,
        Y::Bool(b) => Value::Bool(b),
        Y::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
        Y::String(s) => Value::from(s),
        Y::Sequence(seq) => Value::array(seq.into_iter().map(yaml_to_value).collect()),
        Y::Mapping(m) => Value::object(
            m.into_iter()
                .map(|(k, v)| {
                    let key = match k {
                        Y::String(s) => s,
                        other => yaml_to_value(other).to_js_string(),
                    };
                    (key, yaml_to_value(v))
                })
                .collect(),
        ),
        Y::Tagged(t) => yaml_to_value(t.value),
    }
}

/// Loads a data file in a format added with `Config::add_data_extension`.
pub type DataLoader = Arc<dyn Fn(&Path) -> Result<Value> + Send + Sync>;

/// Load a JSON, YAML or TOML data file, or one in an `extra` format, into a
/// value. `None` means the format isn't known.
pub fn load_data_file(path: &Path, extra: &[(String, DataLoader)]) -> Result<Option<Value>> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let read = || std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()));
    let value = match ext {
        "json" => Value::from(serde_json::from_str::<serde_json::Value>(&read()?).with_context(|| format!("invalid JSON in {}", path.display()))?),
        "yaml" | "yml" => yaml_to_value(serde_yaml::from_str(&read()?).with_context(|| format!("invalid YAML in {}", path.display()))?),
        "toml" => {
            let t: toml::Value = toml::from_str(&read()?).with_context(|| format!("invalid TOML in {}", path.display()))?;
            toml_to_value(t)
        }
        _ => match extra.iter().find(|(e, _)| e == ext) {
            Some((_, load)) => load(path)?,
            None => return Ok(None),
        },
    };
    Ok(Some(value))
}

/// Deep-merge `over` into `base`: objects merge recursively and arrays
/// concatenate; everything else, or
/// everything when `deep` is false, is replaced.
pub fn merge(base: &mut Map, over: &Map, deep: bool) {
    for (key, value) in over {
        match (base.get_mut(key), value) {
            (Some(Value::Obj(existing)), Value::Obj(incoming)) if deep => {
                merge(Arc::make_mut(existing), incoming, deep);
            }
            (Some(Value::Arr(existing)), Value::Arr(incoming)) if deep => {
                Arc::make_mut(existing).extend(incoming.iter().cloned());
            }
            _ => {
                base.insert(key.clone(), value.clone());
            }
        }
    }
}

/// `tags: posts` and `tags: [a, b]` both become a list of strings.
pub fn normalize_tags(data: &mut Map) {
    let tags: Vec<String> = match data.get("tags") {
        None => return,
        Some(Value::Str(s)) => vec![s.to_string()],
        Some(Value::Arr(a)) => a.iter().filter(|v| !v.is_nullish()).map(Value::to_js_string).collect(),
        Some(v) if v.is_nullish() => Vec::new(),
        Some(other) => vec![other.to_js_string()],
    };
    let mut unique: Vec<String> = Vec::with_capacity(tags.len());
    for t in tags {
        if !unique.contains(&t) {
            unique.push(t);
        }
    }
    data.insert("tags".into(), Value::array(unique.into_iter().map(Value::from).collect()));
}

/// Read every data file in the global data directory. Subdirectories become
/// nested objects. Returns the data and the names of files that could not be
/// loaded (in a format nothing handles).
pub fn load_global_data(dir: &Path, extra: &[(String, DataLoader)]) -> Result<(Map, Vec<String>)> {
    let mut data = Map::new();
    let mut skipped = Vec::new();
    if !dir.is_dir() {
        return Ok((data, skipped));
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        if path.is_dir() {
            let (nested, nested_skipped) = load_global_data(&path, extra)?;
            data.insert(name.clone(), Value::object(nested));
            skipped.extend(nested_skipped.into_iter().map(|s| format!("{}/{}", name, s)));
        } else if let Some(value) = load_data_file(&path, extra)? {
            data.insert(stem, value);
        } else {
            skipped.push(name);
        }
    }
    Ok((data, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_formats() {
        let (d, body) = parse_front_matter("---\ntitle: Y\n---\nbody").unwrap();
        assert_eq!((d.get("title").unwrap().to_js_string(), body), ("Y".into(), "body"));
        let (d, body) = parse_front_matter("+++\ntitle = \"T\"\ntags = [\"a\"]\n+++\n\nbody").unwrap();
        assert_eq!((d.get("title").unwrap().to_js_string(), d.get("tags").unwrap().as_array().unwrap().len(), body), ("T".into(), 1, "body"));
        let (d, body) = parse_front_matter("---json\n{ \"title\": \"J\", \"n\": 2 }\n---\nbody").unwrap();
        assert_eq!((d.get("title").unwrap().to_js_string(), d.get("n").unwrap().to_number(), body), ("J".into(), 2.0, "body"));
        // A TOML date without quotes is its text, which reads as a date.
        let (d, _) = parse_front_matter("+++\ndate = 2024-01-02\nupdated = 2024-03-04T10:00:00Z\n[extra]\nwhen = 2020-05-06\n+++\n").unwrap();
        assert_eq!(d["date"].as_str(), Some("2024-01-02"));
        assert_eq!(d["date"].to_date().map(|d| d.format("%Y-%m-%d").to_string()).as_deref(), Some("2024-01-02"));
        assert_eq!(d["updated"].as_str(), Some("2024-03-04T10:00:00Z"));
        assert_eq!(d["extra"].get("when").as_str(), Some("2020-05-06"));
        let (d, _) = parse_front_matter("---toml\ntitle = \"T2\"\n---\n").unwrap();
        assert_eq!(d.get("title").unwrap().to_js_string(), "T2");
        // Not front matter: a rule, or an unknown language.
        assert_eq!(parse_front_matter("----\nx").unwrap().1, "----\nx");
        assert_eq!(parse_front_matter("---ruby\nx\n---\n").unwrap().1, "---ruby\nx\n---\n");
        assert!(parse_front_matter("---json\n[1]\n---\n").unwrap_err().to_string().contains("JSON front matter must be an object"));
        assert!(parse_front_matter("+++\ntitle = 1\n").unwrap_err().to_string().contains("closing `+++`"));
    }
}
