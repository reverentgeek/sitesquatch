//! Responsive images for SiteSquatch, modelled on `@11ty/eleventy-img`'s transform.
//!
//! Every local `<img>` in HTML output becomes a `<picture>` with one
//! `<source>` per modern format and a fallback `<img>`. Derivatives are
//! written to `<output>/img/` and named by a hash of the source file's
//! contents (and the encoder settings), so anything already generated is
//! reused on later builds, including fresh CI checkouts that restore
//! `<output>/img/` from a cache.
//!
//! Per-image overrides (same as eleventy-img):
//! - `eleventy:widths="300,600"` sets the widths for that image
//! - `eleventy:ignore` leaves the tag untouched

mod hash_cache;

pub use hash_cache::CACHE_FILE;

use std::collections::{HashMap, HashSet};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use anyhow::{anyhow, bail, Context, Result};
use image::{DynamicImage, ImageDecoder, ImageReader};
use indexmap::IndexMap;
use lol_html::html_content::ContentType;
use lol_html::{element, rewrite_str, RewriteStrSettings};
use rayon::prelude::*;
use sitesquatch::{escape_html, BuildContext, Config, Plugin};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Format {
    Avif,
    Webp,
    Jpeg,
    Png,
    Gif,
    Svg,
    /// The source image's own format.
    Auto,
}

impl Format {
    pub fn ext(self) -> &'static str {
        match self {
            Format::Avif => "avif",
            Format::Webp => "webp",
            Format::Jpeg => "jpeg",
            Format::Png => "png",
            Format::Gif => "gif",
            Format::Svg => "svg",
            Format::Auto => "auto",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Format::Svg => "image/svg+xml",
            other => match other.ext() {
                "avif" => "image/avif",
                "webp" => "image/webp",
                "jpeg" => "image/jpeg",
                "png" => "image/png",
                _ => "image/gif",
            },
        }
    }

    fn from_path(path: &Path) -> Option<Format> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Some(Format::Jpeg),
            "png" => Some(Format::Png),
            "gif" => Some(Format::Gif),
            "svg" => Some(Format::Svg),
            "webp" => Some(Format::Webp),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub struct ImageOptions {
    /// Output formats; the last one is the `<img>` fallback.
    pub formats: Vec<Format>,
    pub widths: Vec<u32>,
    /// Attributes added to every `<img>` unless it already sets them.
    pub default_attributes: Vec<(String, String)>,
    /// Output folder (relative to the output directory) and its public URL.
    pub output_subdir: String,
    pub url_path: String,
    pub webp_quality: f32,
    pub avif_quality: f32,
    /// 1 (slowest, smallest) to 10 (fastest).
    pub avif_speed: u8,
    pub jpeg_quality: u8,
    /// A too-large width is clamped to the original only when the previous
    /// width is this many times smaller than the original (eleventy-img: 1.25).
    pub minimum_threshold: f64,
    /// After a build, delete files in the output folder that the build didn't
    /// use (derivatives of removed or edited images). Only turn this on for
    /// full builds where every image goes through this plugin.
    pub prune: bool,
    /// Remember each image's id between builds in `.cache/ssqch/image-hashes.json`
    /// (see [`CACHE_FILE`]), so warm builds don't re-read every image.
    pub hash_cache: bool,
}

impl Default for ImageOptions {
    fn default() -> Self {
        ImageOptions {
            formats: vec![Format::Webp, Format::Auto],
            widths: vec![300, 600, 900, 1200, 1500],
            default_attributes: vec![("loading".into(), "lazy".into()), ("decoding".into(), "async".into()), ("sizes".into(), "auto".into())],
            output_subdir: "img".into(),
            url_path: "/img/".into(),
            webp_quality: 75.0,
            avif_quality: 50.0,
            avif_speed: 8,
            jpeg_quality: 80,
            minimum_threshold: 1.25,
            prune: false,
            hash_cache: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ImageEntry {
    pub format: Format,
    pub width: u32,
    pub height: u32,
    pub url: String,
    pub path: PathBuf,
    pub source_type: &'static str,
    /// `"<url> <width>w"`
    pub srcset: String,
}

/// Generated derivatives, grouped by format in the requested order.
#[derive(Clone, Debug, Default)]
pub struct ImageMetadata {
    pub formats: IndexMap<Format, Vec<ImageEntry>>,
}

impl ImageMetadata {
    pub fn srcset(&self, format: Format) -> String {
        self.formats.get(&format).map(|e| e.iter().map(|x| x.srcset.clone()).collect::<Vec<_>>().join(", ")).unwrap_or_default()
    }

    /// The fallback format's entries (the last format generated).
    pub fn fallback(&self) -> &[ImageEntry] {
        self.formats.values().last().map(|v| v.as_slice()).unwrap_or(&[])
    }
}

type MemoKey = (PathBuf, Vec<u32>, Vec<Format>);
type MemoCell = Arc<OnceLock<Result<Arc<ImageMetadata>, String>>>;

/// Generates derivatives. Shared between the HTML transform and any plugin
/// that needs images directly (hero images, social cards...).
pub struct ImageProcessor {
    pub options: ImageOptions,
    ctx: RwLock<Option<BuildContext>>,
    memo: Mutex<HashMap<MemoKey, MemoCell>>,
    generated: AtomicUsize,
    reused: AtomicUsize,
    /// Every derivative this build produced or reused, for `prune`.
    used: Mutex<HashSet<PathBuf>>,
    hashes: Mutex<hash_cache::HashCache>,
    warned: Mutex<HashSet<String>>,
}

impl ImageProcessor {
    pub fn new(options: ImageOptions) -> Arc<Self> {
        Arc::new(ImageProcessor {
            options,
            ctx: RwLock::new(None),
            memo: Mutex::new(HashMap::new()),
            generated: AtomicUsize::new(0),
            reused: AtomicUsize::new(0),
            used: Mutex::new(HashSet::new()),
            hashes: Mutex::new(hash_cache::HashCache::default()),
            warned: Mutex::new(HashSet::new()),
        })
    }

    fn ctx(&self) -> Result<BuildContext> {
        self.ctx.read().unwrap().clone().ok_or_else(|| anyhow!("the image plugin is used before the build started"))
    }

    fn warn_once(&self, msg: String) {
        if self.warned.lock().unwrap().insert(msg.clone()) {
            eprintln!("warn: {}", msg);
        }
    }

    /// Where derivatives are written, once the build has started.
    pub fn output_dir(&self) -> Result<PathBuf> {
        Ok(self.ctx()?.output_dir.join(&self.options.output_subdir))
    }

    /// The project root, once the build has started.
    pub fn root(&self) -> Result<PathBuf> {
        Ok(self.ctx()?.root)
    }

    /// Resolve an `<img src>` to a file: site-absolute paths are relative to
    /// the input directory, others to the page's own directory.
    pub fn resolve_src(&self, src: &str, page_input: &Path) -> Option<PathBuf> {
        if src.is_empty() || src.contains("://") || src.starts_with("//") || src.starts_with("data:") {
            return None;
        }
        let ctx = self.ctx().ok()?;
        let clean = percent_decode(src.split(['?', '#']).next().unwrap_or(src));
        let path = match clean.strip_prefix('/') {
            Some(rest) => ctx.input_dir.join(rest),
            None => page_input.parent()?.join(&clean),
        };
        Some(path)
    }

    /// Generate (or reuse) derivatives of `src` at `widths` in `formats`.
    pub fn generate(&self, src: &Path, widths: &[u32], formats: &[Format]) -> Result<Arc<ImageMetadata>> {
        let key = (src.to_path_buf(), widths.to_vec(), formats.to_vec());
        let cell = self.memo.lock().unwrap().entry(key).or_default().clone();
        cell.get_or_init(|| {
            let meta = self.generate_uncached(src, widths, formats).map_err(|e| format!("{:#}", e))?;
            self.used.lock().unwrap().extend(meta.formats.values().flatten().map(|e| e.path.clone()));
            Ok(Arc::new(meta))
        })
        .clone()
            .map_err(|e| anyhow!(e))
    }

    fn generate_uncached(&self, src: &Path, widths: &[u32], formats: &[Format]) -> Result<ImageMetadata> {
        let ctx = self.ctx()?;
        let src_format = sniff_format(src)?;
        let id = self.hash_id(src)?;
        let out_dir = ctx.output_dir.join(&self.options.output_subdir);
        std::fs::create_dir_all(&out_dir)?;
        let entry = |format: Format, width: u32, height: u32, name: String| ImageEntry {
            format,
            width,
            height,
            url: format!("{}{}", self.options.url_path, name),
            path: out_dir.join(&name),
            source_type: format.mime(),
            srcset: format!("{}{} {}w", self.options.url_path, name, width),
        };

        // SVGs are copied as they are, and so are GIFs in `auto` output (which
        // keeps animations; eleventy-img keeps only the first frame). A GIF
        // explicitly requested as PNG/WebP (a social card) is converted.
        let copy_gif = src_format == Format::Gif && formats.iter().all(|f| matches!(f, Format::Auto | Format::Gif | Format::Webp | Format::Avif));
        if src_format == Format::Svg || copy_gif {
            let (w, h) = if src_format == Format::Gif { header_dimensions(src)?.0 } else { svg_dimensions(src).unwrap_or((0, 0)) };
            let name = if w > 0 { format!("{}-{}.{}", id, w, src_format.ext()) } else { format!("{}.{}", id, src_format.ext()) };
            let e = entry(src_format, w, h, name);
            if !e.path.exists() {
                std::fs::copy(src, &e.path)?;
                self.generated.fetch_add(1, Ordering::Relaxed);
            } else {
                self.reused.fetch_add(1, Ordering::Relaxed);
            }
            let mut meta = ImageMetadata::default();
            meta.formats.insert(src_format, vec![e]);
            return Ok(meta);
        }

        let ((w0, h0), _) = header_dimensions(src)?;
        let targets = valid_widths(w0, widths, self.options.minimum_threshold);

        let mut meta = ImageMetadata::default();
        let mut jobs = Vec::new();
        for &f in formats {
            let f = if f == Format::Auto { src_format } else { f };
            if f == Format::Avif && !cfg!(feature = "avif") {
                self.warn_once("AVIF output needs the `avif` feature of sitesquatch-plugin-image; skipping AVIF".into());
                continue;
            }
            if meta.formats.contains_key(&f) {
                continue;
            }
            let mut entries = Vec::new();
            for &w in &targets {
                // eleventy-img (sharp) rounds heights down.
                let h = ((h0 as f64) * (w as f64) / (w0 as f64)).floor().max(1.0) as u32;
                let e = entry(f, w, h, format!("{}-{}.{}", id, w, f.ext()));
                if !e.path.exists() {
                    jobs.push(e.clone());
                }
                entries.push(e);
            }
            meta.formats.insert(f, entries);
        }

        let reused = meta.formats.values().map(Vec::len).sum::<usize>() - jobs.len();
        self.reused.fetch_add(reused, Ordering::Relaxed);
        if !jobs.is_empty() {
            let img = decode(src)?;
            jobs.par_iter().try_for_each(|job| self.encode(&img, job).with_context(|| format!("encoding {}", job.path.display())))?;
            self.generated.fetch_add(jobs.len(), Ordering::Relaxed);
        }
        Ok(meta)
    }

    /// Short, URL-safe id from the source file's contents and the encoder
    /// settings. Not the path or mtime: a fresh `git clone` gives every file a
    /// new mtime, which would turn every CI build into a cold one. The hash
    /// cache only saves re-reading files whose size and mtime haven't changed.
    fn hash_id(&self, src: &Path) -> Result<String> {
        let o = &self.options;
        let settings = format!("{}|{}|{}|{}", o.webp_quality, o.avif_quality, o.avif_speed, o.jpeg_quality);
        let (size, mtime) = hash_cache::stamp(src)?;
        let mtime = mtime.filter(|_| o.hash_cache);
        if let Some(m) = mtime {
            if let Some(id) = self.hashes.lock().unwrap().get(src, size, m, &settings) {
                return Ok(id);
            }
        }
        let file = std::fs::File::open(src).with_context(|| format!("image not found: {}", src.display()))?;
        let mut h = blake3::Hasher::new();
        h.update_reader(file).with_context(|| format!("reading {}", src.display()))?;
        h.update(settings.as_bytes());
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let id: String = h.finalize().as_bytes().iter().take(10).map(|b| ALPHABET[(*b & 63) as usize] as char).collect();
        if let Some(m) = mtime {
            self.hashes.lock().unwrap().put(src, size, m, &settings, &id);
        }
        Ok(id)
    }

    fn encode(&self, img: &DynamicImage, job: &ImageEntry) -> Result<()> {
        let resized = if img.width() == job.width {
            img.clone()
        } else {
            img.resize_exact(job.width, job.height, image::imageops::FilterType::CatmullRom)
        };
        // Unique temp name: two requests can share a derivative (same source,
        // overlapping widths) and encode it at the same time.
        static TMP: AtomicUsize = AtomicUsize::new(0);
        let tmp = job.path.with_extension(format!("{}.{}.tmp", job.format.ext(), TMP.fetch_add(1, Ordering::Relaxed)));
        {
            let file = std::fs::File::create(&tmp)?;
            let mut w = BufWriter::new(file);
            match job.format {
                Format::Jpeg => {
                    let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, self.options.jpeg_quality);
                    resized.to_rgb8().write_with_encoder(enc)?;
                }
                Format::Png => resized.write_to(&mut w, image::ImageFormat::Png)?,
                Format::Webp => {
                    let rgba = resized.to_rgba8();
                    let data = webp::Encoder::from_rgba(&rgba, rgba.width(), rgba.height()).encode(self.options.webp_quality);
                    std::io::Write::write_all(&mut w, &data)?;
                }
                Format::Avif => self.encode_avif(&resized, &mut w)?,
                other => bail!("cannot encode {:?}", other),
            }
        }
        std::fs::rename(&tmp, &job.path)?;
        Ok(())
    }

    /// Delete files in `dir` that this build didn't produce or reuse.
    fn prune(&self, dir: &Path) -> Result<usize> {
        let used = self.used.lock().unwrap();
        let Ok(entries) = std::fs::read_dir(dir) else { return Ok(0) };
        let mut removed = 0;
        for entry in entries {
            let path = entry?.path();
            if path.is_file() && !used.contains(&path) {
                std::fs::remove_file(&path).with_context(|| format!("pruning {}", path.display()))?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    #[cfg(feature = "avif")]
    fn encode_avif(&self, img: &DynamicImage, w: &mut impl std::io::Write) -> Result<()> {
        let rgba = img.to_rgba8();
        let pixels: Vec<rgb::RGBA8> = rgba.pixels().map(|p| rgb::RGBA8::new(p[0], p[1], p[2], p[3])).collect();
        let out = ravif::Encoder::new()
            .with_quality(self.options.avif_quality)
            .with_speed(self.options.avif_speed)
            .encode_rgba(ravif::Img::new(&pixels[..], rgba.width() as usize, rgba.height() as usize))?;
        w.write_all(&out.avif_file)?;
        Ok(())
    }

    #[cfg(not(feature = "avif"))]
    fn encode_avif(&self, _img: &DynamicImage, _w: &mut impl std::io::Write) -> Result<()> {
        bail!("AVIF support is not compiled in")
    }

    /// Build `<picture>` markup for generated images and `<img>` attributes.
    pub fn picture_html(&self, meta: &ImageMetadata, attrs: &[(String, String)]) -> String {
        let fallback = meta.fallback();
        let (Some(low), Some(high)) = (fallback.first(), fallback.last()) else { return String::new() };
        let mut sizes = None;
        let mut img_attrs: Vec<(String, String)> = Vec::new();
        for (k, v) in &self.options.default_attributes {
            if k == "sizes" {
                sizes = Some(v.clone());
            } else if !attrs.iter().any(|(a, _)| a == k) {
                img_attrs.push((k.clone(), v.clone()));
            }
        }
        for (k, v) in attrs {
            match k.as_str() {
                "width" | "height" => {}
                "sizes" => sizes = Some(v.clone()),
                "src" => img_attrs.push(("src".into(), low.url.clone())),
                _ => img_attrs.push((k.clone(), v.clone())),
            }
        }
        if fallback.len() > 1 {
            img_attrs.push(("srcset".into(), srcset_attr(fallback)));
            if let Some(s) = &sizes {
                img_attrs.push(("sizes".into(), s.clone()));
            }
        }
        if high.width > 0 {
            img_attrs.push(("width".into(), high.width.to_string()));
            img_attrs.push(("height".into(), high.height.to_string()));
        }
        let mut img = String::from("<img");
        for (k, v) in &img_attrs {
            // Values copied from the original tag are still entity-encoded, so
            // only quotes need escaping; generated values are plain URLs/numbers.
            img.push_str(&format!(" {}=\"{}\"", k, v.replace('"', "&quot;")));
        }
        img.push('>');

        if meta.formats.len() < 2 {
            return img;
        }
        let mut html = String::from("<picture>");
        for (format, entries) in meta.formats.iter().take(meta.formats.len() - 1) {
            let srcset = srcset_attr(entries);
            html.push_str(&format!("<source type=\"{}\" srcset=\"{}\"", format.mime(), escape_html(&srcset)));
            if let Some(s) = &sizes {
                html.push_str(&format!(" sizes=\"{}\"", s.replace('"', "&quot;")));
            }
            html.push('>');
        }
        html.push_str(&img);
        html.push_str("</picture>");
        html
    }

    /// Rewrite every local `<img>` in an HTML document.
    pub fn transform_html(&self, html: &str, page_input: &Path) -> Result<String> {
        if !html.contains("<img") {
            return Ok(html.to_string());
        }
        rewrite_str(
            html,
            RewriteStrSettings {
                element_content_handlers: vec![element!("img[src]", |el| {
                    if el.has_attribute("eleventy:ignore") {
                        el.remove_attribute("eleventy:ignore");
                        return Ok(());
                    }
                    let src = el.get_attribute("src").unwrap_or_default();
                    let Some(path) = self.resolve_src(&src, page_input) else { return Ok(()) };
                    if !path.is_file() {
                        self.warn_once(format!("image not found: {} (in {})", src, page_input.display()));
                        return Ok(());
                    }
                    // Like eleventy-img: a plain `width` attribute pins the image to that one width.
                    let widths: Vec<u32> = match (el.get_attribute("eleventy:widths"), el.get_attribute("width").and_then(|w| w.trim().parse::<u32>().ok())) {
                        (Some(w), _) => w.split(',').filter_map(|s| s.trim().parse().ok()).collect(),
                        (None, Some(w)) => vec![w],
                        (None, None) => self.options.widths.clone(),
                    };
                    let meta = match self.generate(&path, &widths, &self.options.formats) {
                        Ok(m) => m,
                        Err(e) => {
                            self.warn_once(format!("{:#}", e));
                            return Ok(());
                        }
                    };
                    let attrs: Vec<(String, String)> =
                        el.attributes().iter().filter(|a| !a.name().starts_with("eleventy:")).map(|a| (a.name(), a.value())).collect();
                    el.replace(&self.picture_html(&meta, &attrs), ContentType::Html);
                    Ok(())
                })],
                ..RewriteStrSettings::new()
            },
        )
        .map_err(|e| anyhow!("image transform: {}", e))
    }
}

/// Port of eleventy-img's `getValidWidths` (no upscaling).
pub fn valid_widths(original: u32, requested: &[u32], minimum_threshold: f64) -> Vec<u32> {
    let mut sorted: Vec<u32> = requested.iter().map(|&w| if w == 0 { original } else { w }).collect();
    sorted.sort_unstable();
    let mut last_big_enough = true;
    let mut out = Vec::new();
    for w in sorted {
        if w > original {
            if last_big_enough {
                out.push(original);
            }
            continue;
        }
        last_big_enough = original as f64 > (w as f64 * minimum_threshold).floor();
        out.push(w);
    }
    out.dedup();
    if out.is_empty() {
        out.push(original);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_depend_on_contents_not_path_or_mtime() {
        let dir = std::env::temp_dir().join(format!("ssqch-hash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, b, c) = (dir.join("a.png"), dir.join("b.png"), dir.join("c.png"));
        std::fs::write(&a, b"same bytes").unwrap();
        std::fs::write(&b, b"same bytes").unwrap();
        std::fs::write(&c, b"other bytes").unwrap();
        let p = ImageProcessor::new(ImageOptions::default());
        let id = p.hash_id(&a).unwrap();

        // A fresh checkout gives files a new mtime; the id must not change.
        std::fs::File::options().write(true).open(&a).unwrap().set_modified(std::time::SystemTime::UNIX_EPOCH).unwrap();
        assert_eq!(p.hash_id(&a).unwrap(), id);
        assert_eq!(p.hash_id(&b).unwrap(), id, "a moved or renamed image keeps its derivatives");
        assert_ne!(p.hash_id(&c).unwrap(), id);
        let q = ImageProcessor::new(ImageOptions { webp_quality: 90.0, ..ImageOptions::default() });
        assert_ne!(q.hash_id(&a).unwrap(), id, "encoder settings are part of the id");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_hash_cache_skips_unchanged_files_and_rereads_changed_ones() {
        use std::time::{Duration, SystemTime};
        let dir = std::env::temp_dir().join(format!("ssqch-hashcache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (img, cache) = (dir.join("a.png"), dir.join(".cache/ssqch/image-hashes.json"));
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let write = |bytes: &[u8], mtime: SystemTime| {
            std::fs::write(&img, bytes).unwrap();
            std::fs::File::options().write(true).open(&img).unwrap().set_modified(mtime).unwrap();
        };
        write(b"pine cone", t0);

        let first = ImageProcessor::new(ImageOptions::default());
        first.hashes.lock().unwrap().load(cache.clone());
        let id = first.hash_id(&img).unwrap();
        first.hashes.lock().unwrap().save().unwrap();
        assert!(cache.is_file(), "the cache is written after a build that hashed something");

        // Same size and mtime: the id comes from the cache, so swapping the
        // bytes behind its back goes unnoticed. That's the trade-off.
        write(b"pine c0ne", t0);
        let second = ImageProcessor::new(ImageOptions::default());
        second.hashes.lock().unwrap().load(cache.clone());
        assert_eq!(second.hash_id(&img).unwrap(), id);

        // A new mtime (an edit, or a fresh checkout) means reading the file again.
        write(b"pine c0ne", t0 + Duration::from_secs(1));
        assert_ne!(second.hash_id(&img).unwrap(), id);
        write(b"pine cone", t0 + Duration::from_secs(2));
        assert_eq!(second.hash_id(&img).unwrap(), id, "same contents, same id, whatever the mtime");

        // Different encoder settings never reuse an entry.
        let third = ImageProcessor::new(ImageOptions { webp_quality: 90.0, ..ImageOptions::default() });
        third.hashes.lock().unwrap().load(cache.clone());
        assert_ne!(third.hash_id(&img).unwrap(), id);

        // A corrupt cache is just an empty one.
        std::fs::write(&cache, "not json").unwrap();
        let fourth = ImageProcessor::new(ImageOptions::default());
        fourth.hashes.lock().unwrap().load(cache.clone());
        assert_eq!(fourth.hash_id(&img).unwrap(), id);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn widths_match_eleventy_img() {
        let defaults = [300, 600, 900, 1200, 1500];
        assert_eq!(valid_widths(810, &defaults, 1.25), vec![300, 600, 810]);
        assert_eq!(valid_widths(672, &defaults, 1.25), vec![300, 600]);
        assert_eq!(valid_widths(2000, &defaults, 1.25), vec![300, 600, 900, 1200, 1500]);
        assert_eq!(valid_widths(256, &[48, 96, 144], 1.25), vec![48, 96, 144]);
        assert_eq!(valid_widths(200, &[300, 600], 1.25), vec![200]);
    }
}

/// A single candidate needs no width descriptor (matches eleventy-img).
fn srcset_attr(entries: &[ImageEntry]) -> String {
    match entries {
        [one] => one.url.clone(),
        many => many.iter().map(|e| e.srcset.clone()).collect::<Vec<_>>().join(", "),
    }
}

/// Width and height of an SVG from its root `width`/`height` or `viewBox`.
fn svg_dimensions(src: &Path) -> Option<(u32, u32)> {
    let text = std::fs::read_to_string(src).ok()?;
    let start = text.find("<svg")?;
    let tag = &text[start..start + text[start..].find('>')?];
    let attr = |name: &str| -> Option<String> {
        let i = tag.find(&format!(" {}=", name))? + name.len() + 2;
        let quote = tag[i..].chars().next()?;
        let rest = &tag[i + 1..];
        Some(rest[..rest.find(quote)?].to_string())
    };
    let num = |v: String| v.trim_end_matches("px").trim().parse::<f64>().ok();
    if let (Some(w), Some(h)) = (attr("width").and_then(num), attr("height").and_then(num)) {
        return Some((w as u32, h as u32));
    }
    let vb: Vec<f64> = attr("viewBox")?.split([' ', ',']).filter_map(|p| p.parse().ok()).collect();
    (vb.len() == 4).then(|| (vb[2] as u32, vb[3] as u32))
}

/// The real format from the file's contents (a `.png` may hold a JPEG).
fn sniff_format(src: &Path) -> Result<Format> {
    if let Some(Format::Svg) = Format::from_path(src) {
        return Ok(Format::Svg);
    }
    let sniffed = ImageReader::open(src)?.with_guessed_format()?.format();
    Ok(match sniffed {
        Some(image::ImageFormat::Jpeg) => Format::Jpeg,
        Some(image::ImageFormat::Png) => Format::Png,
        Some(image::ImageFormat::Gif) => Format::Gif,
        Some(image::ImageFormat::WebP) => Format::Webp,
        _ => Format::from_path(src).ok_or_else(|| anyhow!("unsupported image type: {}", src.display()))?,
    })
}

/// Image dimensions after EXIF orientation, read from the header only.
fn header_dimensions(src: &Path) -> Result<((u32, u32), image::metadata::Orientation)> {
    let mut decoder = ImageReader::open(src)?.with_guessed_format()?.into_decoder().with_context(|| format!("reading {}", src.display()))?;
    let (w, h) = decoder.dimensions();
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    use image::metadata::Orientation::*;
    let dims = match orientation {
        Rotate90 | Rotate270 | Rotate90FlipH | Rotate270FlipH => (h, w),
        _ => (w, h),
    };
    Ok((dims, orientation))
}

fn decode(src: &Path) -> Result<DynamicImage> {
    let mut decoder = ImageReader::open(src)?.with_guessed_format()?.into_decoder()?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).with_context(|| format!("decoding {}", src.display()))?;
    img.apply_orientation(orientation);
    Ok(img)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Registers the `<img>` transform. Keep a clone of [`ImagePlugin::processor`]
/// to generate images from other plugins.
pub struct ImagePlugin {
    pub processor: Arc<ImageProcessor>,
    /// Rewrite `<img>` tags in HTML output. Off for a site that only
    /// generates images itself (through the processor).
    pub transform: bool,
}

impl ImagePlugin {
    pub fn new(options: ImageOptions) -> Self {
        ImagePlugin { processor: ImageProcessor::new(options), transform: true }
    }

    /// Only the processor, without the `<img>` transform.
    pub fn processor_only(options: ImageOptions) -> Self {
        ImagePlugin { processor: ImageProcessor::new(options), transform: false }
    }
}

impl Plugin for ImagePlugin {
    fn name(&self) -> &str {
        "image"
    }

    fn register(&self, cfg: &mut Config) {
        let p = self.processor.clone();
        cfg.on_before_build(move |ctx| {
            *p.ctx.write().unwrap() = Some(ctx.clone());
            // Source files may have changed between dev-server builds.
            p.memo.lock().unwrap().clear();
            p.used.lock().unwrap().clear();
            if p.options.hash_cache {
                p.hashes.lock().unwrap().load(ctx.root.join(CACHE_FILE));
            }
            p.generated.store(0, Ordering::Relaxed);
            p.reused.store(0, Ordering::Relaxed);
            Ok(())
        });
        if self.transform {
            let p = self.processor.clone();
            cfg.add_html_transform("image", move |ctx, html| if ctx.is_html() { p.transform_html(&html, ctx.input_path) } else { Ok(html) });
        }
        let p = self.processor.clone();
        let quiet = cfg.quiet;
        cfg.on_after_build(move |ctx, _| {
            let pruned = if p.options.prune { p.prune(&ctx.output_dir.join(&p.options.output_subdir))? } else { 0 };
            if p.options.hash_cache {
                // A cache that can't be written only costs speed, so warn and carry on.
                if let Err(e) = p.hashes.lock().unwrap().save() {
                    p.warn_once(format!("couldn't write {}: {:#}", ctx.root.join(CACHE_FILE).display(), e));
                }
            }
            let busy = p.generated.load(Ordering::Relaxed) + p.reused.load(Ordering::Relaxed) + pruned > 0;
            if !quiet && busy {
                println!(
                    "Images: generated {} files, reused {}{}",
                    p.generated.load(Ordering::Relaxed),
                    p.reused.load(Ordering::Relaxed),
                    if p.options.prune { format!(", pruned {}", pruned) } else { String::new() }
                );
            }
            Ok(())
        });
    }
}
