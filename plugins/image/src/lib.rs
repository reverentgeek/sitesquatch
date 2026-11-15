//! Responsive images for SiteSquatch.
//!
//! Every local `<img>` in HTML output becomes a `<picture>` with one
//! `<source>` per modern format and a fallback `<img>`. Derivatives are
//! encoded into `.cache/ssqch/img/`, named by a hash of the source file's
//! contents (and the encoder settings), and hard-linked (or copied) into
//! `<output>/img/` on each build. So anything already generated is reused on
//! later builds, including fresh CI checkouts that restore `.cache/ssqch`,
//! and the output folder can be deleted without encoding anything again.
//!
//! Per-image overrides:
//! - `ssqch:widths="300,600"` sets the widths for that image
//! - `ssqch:ignore` leaves the tag untouched
//! - `ssqch:preload` preloads it: a `<link rel="preload" as="image">` for its
//!   first format goes in `<head>`, and the image loads eagerly with
//!   `fetchpriority="high"` (for the banner that's the page's largest paint)
//! - a plain `width` attribute pins the image to that one width
//!
//! Images with an RGB color profile other than sRGB (Display P3, Adobe RGB)
//! are converted to sRGB before encoding; see `color`.

mod color;
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

    /// A format by name: `avif`, `webp`, `jpeg` (or `jpg`), `png`, `gif`, `svg` or `auto`.
    pub fn parse(name: &str) -> Option<Format> {
        Some(match name {
            "avif" => Format::Avif,
            "webp" => Format::Webp,
            "jpeg" | "jpg" => Format::Jpeg,
            "png" => Format::Png,
            "gif" => Format::Gif,
            "svg" => Format::Svg,
            "auto" => Format::Auto,
            _ => return None,
        })
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
    /// Where derivatives are encoded and kept between builds, relative to the
    /// project root (default `.cache/ssqch/img`). Each build links (or copies)
    /// the ones it uses into the output. `None` encodes straight into the
    /// output, which then has to be kept to keep the images.
    pub cache_dir: Option<String>,
    pub url_path: String,
    pub webp_quality: f32,
    pub avif_quality: f32,
    /// 1 (slowest, smallest) to 10 (fastest).
    pub avif_speed: u8,
    pub jpeg_quality: u8,
    /// A too-large width is clamped to the original only when the previous
    /// width is this many times smaller than the original (default 1.25).
    pub minimum_threshold: f64,
    /// After a build, delete files in the output folder that the build didn't
    /// use (derivatives of removed or edited images). Only turn this on for
    /// full builds where every image goes through this plugin.
    pub prune: bool,
    /// Remember each image's id between builds in `.cache/ssqch/image-hashes.json`
    /// (see [`CACHE_FILE`]), so warm builds don't re-read every image.
    pub hash_cache: bool,
    /// Rewrite `<a href>` links to local images (click-to-enlarge) to a
    /// generated copy: the source's format, at its own width capped at the
    /// largest of `widths`. Without this, a link to a source image that isn't
    /// published is broken.
    pub linked_images: bool,
}

impl Default for ImageOptions {
    fn default() -> Self {
        ImageOptions {
            formats: vec![Format::Webp, Format::Auto],
            widths: vec![300, 600, 900, 1200, 1500],
            default_attributes: vec![("loading".into(), "lazy".into()), ("decoding".into(), "async".into()), ("sizes".into(), "auto".into())],
            output_subdir: "img".into(),
            cache_dir: Some(".cache/ssqch/img".into()),
            url_path: "/img/".into(),
            webp_quality: 75.0,
            avif_quality: 50.0,
            avif_speed: 8,
            jpeg_quality: 80,
            minimum_threshold: 1.25,
            prune: false,
            hash_cache: true,
            linked_images: true,
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
    /// The format `Format::Auto` became (the source's own), when it was asked for.
    pub auto: Option<Format>,
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

type MemoKey = (PathBuf, Vec<u32>, Vec<Format>, Option<String>);
type MemoCell = Arc<OnceLock<Result<Arc<ImageMetadata>, String>>>;

/// Generates derivatives. Shared between the HTML transform and any plugin
/// that needs images directly (hero images, social cards...).
pub struct ImageProcessor {
    pub options: ImageOptions,
    ctx: RwLock<Option<BuildContext>>,
    memo: Mutex<HashMap<MemoKey, MemoCell>>,
    generated: AtomicUsize,
    /// Files deleted by `prune` at the end of the last build.
    pruned: AtomicUsize,
    /// Source images this build converted to sRGB (see `color`).
    converted: Mutex<HashSet<PathBuf>>,
    /// Every derivative this build produced or reused, for `prune`.
    used: Mutex<HashSet<PathBuf>>,
    /// Every source image this build used.
    sources: Mutex<HashSet<PathBuf>>,
    hashes: Mutex<hash_cache::HashCache>,
    /// Set from the build's `--quiet`.
    quiet: std::sync::atomic::AtomicBool,
    /// Every source image encoded this build: (path, files written, time).
    timings: Mutex<Vec<(PathBuf, usize, std::time::Duration)>>,
    warned: Mutex<HashSet<String>>,
}

impl ImageProcessor {
    pub fn new(options: ImageOptions) -> Arc<Self> {
        Arc::new(ImageProcessor {
            options,
            ctx: RwLock::new(None),
            memo: Mutex::new(HashMap::new()),
            generated: AtomicUsize::new(0),
            pruned: AtomicUsize::new(0),
            converted: Mutex::new(HashSet::new()),
            used: Mutex::new(HashSet::new()),
            sources: Mutex::new(HashSet::new()),
            hashes: Mutex::new(hash_cache::HashCache::default()),
            quiet: std::sync::atomic::AtomicBool::new(false),
            timings: Mutex::new(Vec::new()),
            warned: Mutex::new(HashSet::new()),
        })
    }

    fn ctx(&self) -> Result<BuildContext> {
        self.ctx.read().unwrap().clone().ok_or_else(|| anyhow!("the image plugin is used before the build started"))
    }

    fn warn_once(&self, msg: String) {
        if self.warned.lock().unwrap().insert(msg.clone()) {
            sitesquatch::diagnostics::warn(sitesquatch::diagnostics::Diagnostic::warning("images", msg));
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

    /// Resolve a site path to a file in the input folder, the way an `<img src>`
    /// starting with `/` is: `/content/logo.png` (or `content/logo.png`) is
    /// `<input>/content/logo.png`. `None` for a remote or `data:` URL.
    pub fn resolve_site_src(&self, src: &str) -> Option<PathBuf> {
        if src.contains("://") || src.starts_with("//") || src.starts_with("data:") {
            return None;
        }
        let ctx = self.ctx().ok()?;
        let clean = percent_decode(src.split(['?', '#']).next().unwrap_or(src));
        Some(ctx.input_dir.join(clean.trim_start_matches('/')))
    }

    /// One generated copy of the image at `src` (a site path, see
    /// [`resolve_site_src`](Self::resolve_site_src)): `width` pixels wide at
    /// most (0 is the original's), in `format` (`Auto` keeps the source's).
    /// What `imageUrl()` returns. A remote URL is only `{ url }`.
    pub fn image_url(&self, src: &str, width: u32, format: Format) -> Result<sitesquatch::Value> {
        use sitesquatch::Value;
        if src.trim().is_empty() {
            bail!("imageUrl(): no image given");
        }
        let Some(path) = self.resolve_site_src(src) else { return Ok(Value::from_pairs([("url", Value::from(src))])) };
        if !path.is_file() {
            let ctx = self.ctx()?;
            bail!("imageUrl(): image not found: {} (looked for {})", src, sitesquatch::display_path(&ctx, &path));
        }
        let meta = self.generate(&path, &[width], &[format])?;
        let resolved = if format == Format::Auto { meta.auto } else { Some(format) };
        let entries = resolved.and_then(|f| meta.formats.get(&f)).or_else(|| meta.formats.values().next());
        let e = entries.and_then(|e| e.iter().max_by_key(|e| e.width)).ok_or_else(|| anyhow!("imageUrl(): no image generated for {}", src))?;
        Ok(Value::from_pairs([
            ("url", Value::from(e.url.as_str())),
            ("width", Value::Num(e.width as f64)),
            ("height", Value::Num(e.height as f64)),
            ("type", Value::from(e.source_type)),
            ("format", Value::from(e.format.ext())),
        ]))
    }

    /// The URL a link to the image at `src` should point to: one copy in the
    /// source's own format (so it opens anywhere), at the image's width capped
    /// at the largest configured width. GIFs and SVGs are their copied files.
    fn link_target(&self, src: &Path) -> Result<String> {
        let cap = self.options.widths.iter().copied().max().unwrap_or(0);
        let meta = self.generate(src, &[cap], &[Format::Auto])?;
        let entry = meta.formats.values().flatten().max_by_key(|e| e.width).ok_or_else(|| anyhow!("no image generated for {}", src.display()))?;
        Ok(entry.url.clone())
    }

    /// Generate (or reuse) derivatives of `src` at `widths` in `formats`.
    pub fn generate(&self, src: &Path, widths: &[u32], formats: &[Format]) -> Result<Arc<ImageMetadata>> {
        self.generate_named(src, widths, formats, None)
    }

    /// [`generate`](Self::generate), with file names of your own instead of
    /// ones from a hash of the source. `name` is the output's URL path
    /// without the width and extension: `/assets/sponsors/acme` writes
    /// `/assets/sponsors/acme-200.webp`, and a name without a leading `/` is
    /// inside the image output folder. A file is encoded again when its
    /// source is newer than it.
    pub fn generate_named(&self, src: &Path, widths: &[u32], formats: &[Format], name: Option<&str>) -> Result<Arc<ImageMetadata>> {
        if let Some(name) = name {
            let last = name.rsplit('/').next().unwrap_or("");
            if last.is_empty() || name.split('/').any(|p| p == "..") || name.contains(['\\', '?', '#']) {
                bail!("image name {:?} must be a URL path without the width and extension, like \"/assets/sponsors/acme\"", name);
            }
        }
        let key = (src.to_path_buf(), widths.to_vec(), formats.to_vec(), name.map(String::from));
        let cell = self.memo.lock().unwrap().entry(key).or_default().clone();
        cell.get_or_init(|| {
            let meta = self.generate_uncached(src, widths, formats, name).map_err(|e| format!("{:#}", e))?;
            self.used.lock().unwrap().extend(meta.formats.values().flatten().map(|e| e.path.clone()));
            self.sources.lock().unwrap().insert(src.to_path_buf());
            Ok(Arc::new(meta))
        })
        .clone()
            .map_err(|e| anyhow!(e))
    }

    fn generate_uncached(&self, src: &Path, widths: &[u32], formats: &[Format], name: Option<&str>) -> Result<ImageMetadata> {
        let ctx = self.ctx()?;
        let src_format = sniff_format(src)?;
        // The folder, its URL, and the start of each file's name.
        let (out_dir, url_path, id) = match name {
            None => (ctx.output_dir.join(&self.options.output_subdir), self.options.url_path.clone(), self.hash_id(src)?),
            Some(name) => {
                let rel = name.trim_start_matches('/');
                let (dir, stem) = match rel.rsplit_once('/') {
                    Some((dir, stem)) => (format!("{}/", dir), stem),
                    None => (String::new(), rel),
                };
                if name.starts_with('/') {
                    (ctx.output_dir.join(&dir), format!("/{}", dir), stem.to_string())
                } else {
                    (ctx.output_dir.join(&self.options.output_subdir).join(&dir), format!("{}{}", self.options.url_path, dir), stem.to_string())
                }
            }
        };
        std::fs::create_dir_all(&out_dir)?;
        // Encoded files live in the cache; the output gets links to them.
        // Names of the site's own get a folder there that mirrors the output.
        let cache_dir = self.options.cache_dir.as_ref().map(|c| {
            let root = ctx.root.join(c);
            match name {
                None => root,
                Some(_) => root.join("named").join(out_dir.strip_prefix(&ctx.output_dir).unwrap_or(Path::new(""))),
            }
        });
        if let Some(c) = &cache_dir {
            std::fs::create_dir_all(c).with_context(|| format!("creating the image cache {}", c.display()))?;
        }
        let cached = |e: &ImageEntry| -> PathBuf {
            match (&cache_dir, e.path.file_name()) {
                (Some(c), Some(file)) => c.join(file),
                _ => e.path.clone(),
            }
        };
        // A hashed name says what's in the file. A name of the site's own
        // doesn't, so its file is stale when the source is newer.
        let modified = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
        let source_time = name.and_then(|_| modified(src));
        let fresh = |p: &Path| p.exists() && (source_time.is_none() || modified(p) >= source_time);
        let entry = |format: Format, width: u32, height: u32, name: String| ImageEntry {
            format,
            width,
            height,
            url: format!("{}{}", url_path, name),
            path: out_dir.join(&name),
            source_type: format.mime(),
            srcset: format!("{}{} {}w", url_path, name, width),
        };

        // SVGs are copied as they are, and so are GIFs in `auto` output (which
        // keeps animations). A GIF
        // explicitly requested as PNG/WebP (a social card) is converted.
        let copy_gif = src_format == Format::Gif && formats.iter().all(|f| matches!(f, Format::Auto | Format::Gif | Format::Webp | Format::Avif));
        if src_format == Format::Svg || copy_gif {
            let (w, h) = if src_format == Format::Gif { header_dimensions(src)?.0 } else { svg_dimensions(src).unwrap_or((0, 0)) };
            let name = if w > 0 { format!("{}-{}.{}", id, w, src_format.ext()) } else { format!("{}.{}", id, src_format.ext()) };
            let e = entry(src_format, w, h, name);
            if !fresh(&e.path) {
                std::fs::copy(src, &e.path)?;
                self.generated.fetch_add(1, Ordering::Relaxed);
            }
            let mut meta = ImageMetadata { auto: formats.contains(&Format::Auto).then_some(src_format), ..ImageMetadata::default() };
            meta.formats.insert(src_format, vec![e]);
            return Ok(meta);
        }

        let ((w0, h0), _) = header_dimensions(src)?;
        let targets = valid_widths(w0, widths, self.options.minimum_threshold);

        let mut meta = ImageMetadata { auto: formats.contains(&Format::Auto).then_some(src_format), ..ImageMetadata::default() };
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
                // Heights round down.
                let h = ((h0 as f64) * (w as f64) / (w0 as f64)).floor().max(1.0) as u32;
                let e = entry(f, w, h, format!("{}-{}.{}", id, w, f.ext()));
                let in_cache = cached(&e);
                if !fresh(&in_cache) {
                    if in_cache != e.path && fresh(&e.path) {
                        // Encoded into the output before there was a cache
                        // (or restored there by a deploy's cache): keep it.
                        link_or_copy(&e.path, &in_cache)?;
                    } else {
                        jobs.push(ImageEntry { path: in_cache, ..e.clone() });
                    }
                }
                entries.push(e);
            }
            meta.formats.insert(f, entries);
        }

        if !jobs.is_empty() {
            let started = std::time::Instant::now();
            let (img, plan) = decode(src)?;
            match plan {
                color::Plan::Convert(_) => {
                    self.converted.lock().unwrap().insert(src.to_path_buf());
                }
                color::Plan::Unsupported(why) => self.warn_once(format!(
                    "{} has a color profile ssqch can't convert to sRGB ({}), so its colors may look washed out. HDR photos from newer iPhones do this; converting the source to sRGB once fixes it (on macOS: sips -m \"/System/Library/ColorSync/Profiles/sRGB Profile.icc\" <file>)",
                    sitesquatch::display_path(&ctx, src),
                    why
                )),
                color::Plan::Keep => {}
            }
            jobs.par_iter().try_for_each(|job| self.encode(&img, job).with_context(|| format!("encoding {}", job.path.display())))?;
            self.generated.fetch_add(jobs.len(), Ordering::Relaxed);
            let took = started.elapsed();
            if !self.quiet.load(Ordering::Relaxed) {
                let formats: Vec<&str> = meta.formats.keys().map(|f| f.ext()).collect();
                sitesquatch::diagnostics::progress(&format!(
                    "[ssqch] Encoded {} into {} file{} ({}) in {:.2?}",
                    sitesquatch::display_path(&ctx, src),
                    jobs.len(),
                    if jobs.len() == 1 { "" } else { "s" },
                    formats.join(", "),
                    took
                ));
            }
            self.timings.lock().unwrap().push((src.to_path_buf(), jobs.len(), took));
        }
        if cache_dir.is_some() {
            for e in meta.formats.values().flatten() {
                publish(&cached(e), &e.path).with_context(|| format!("copying {} into the output", e.path.display()))?;
            }
        }
        Ok(meta)
    }

    /// Short, URL-safe id from the source file's contents and the encoder
    /// settings. Not the path or mtime: a fresh `git clone` gives every file a
    /// new mtime, which would turn every CI build into a cold one. The hash
    /// cache only saves re-reading files whose size and mtime haven't changed.
    ///
    /// An image that gets converted to sRGB (see `color`) has that mixed into
    /// its id, so turning conversion on renamed only those images' files
    /// instead of re-encoding every image. The hash cache's key has a
    /// `color1` marker, so ids cached before conversion existed are worked out
    /// again.
    fn hash_id(&self, src: &Path) -> Result<String> {
        let o = &self.options;
        let settings = format!("{}|{}|{}|{}", o.webp_quality, o.avif_quality, o.avif_speed, o.jpeg_quality);
        let cache_key = format!("{}|color1", settings);
        let (size, mtime) = hash_cache::stamp(src)?;
        let mtime = mtime.filter(|_| o.hash_cache);
        if let Some(m) = mtime {
            if let Some(id) = self.hashes.lock().unwrap().get(src, size, m, &cache_key) {
                return Ok(id);
            }
        }
        let file = std::fs::File::open(src).with_context(|| format!("image not found: {}", src.display()))?;
        let mut h = blake3::Hasher::new();
        h.update_reader(file).with_context(|| format!("reading {}", src.display()))?;
        h.update(settings.as_bytes());
        if color::Plan::for_file(src).converts() {
            h.update(b"|srgb");
        }
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let id: String = h.finalize().as_bytes().iter().take(10).map(|b| ALPHABET[(*b & 63) as usize] as char).collect();
        if let Some(m) = mtime {
            self.hashes.lock().unwrap().put(src, size, m, &cache_key, &id);
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

    /// The `Images` line of the build summary: the derivatives this build
    /// used, from how many source images, and how many it had to encode.
    fn summary(&self) -> Option<String> {
        let used = self.used.lock().unwrap();
        let pruned = self.pruned.load(Ordering::Relaxed);
        if used.is_empty() && pruned == 0 {
            return None;
        }
        let size: u64 = used.iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum();
        let sources = self.sources.lock().unwrap().len();
        // A file two pages ask for in different widths can be counted twice
        // by the encoder, so cap at the number of files.
        let encoded = self.generated.load(Ordering::Relaxed).min(used.len());
        let converted = self.converted.lock().unwrap().len();
        let mut line = format!(
            "{} file{} from {} source{}, {}: {} encoded, {} reused",
            sitesquatch::report::count(used.len()),
            if used.len() == 1 { "" } else { "s" },
            sitesquatch::report::count(sources),
            if sources == 1 { "" } else { "s" },
            sitesquatch::report::bytes(size),
            sitesquatch::report::count(encoded),
            sitesquatch::report::count(used.len() - encoded),
        );
        if converted > 0 {
            line.push_str(&format!(" ({} source{} converted to sRGB)", sitesquatch::report::count(converted), if converted == 1 { "" } else { "s" }));
        }
        if self.options.prune {
            line.push_str(&format!(", {} pruned", sitesquatch::report::count(pruned)));
        }
        Some(line)
    }

    /// Delete files in `dir` that this build didn't produce or reuse, and
    /// their copies in the cache. Counts the output's files.
    fn prune(&self, ctx: &BuildContext, dir: &Path) -> Result<usize> {
        let used = self.used.lock().unwrap();
        let mut removed = 0;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries {
                let path = entry?.path();
                if path.is_file() && !used.contains(&path) {
                    std::fs::remove_file(&path).with_context(|| format!("pruning {}", path.display()))?;
                    removed += 1;
                }
            }
        }
        // The cache's hashed files (its `named/` folder isn't pruned).
        if let Some(cache) = &self.options.cache_dir {
            let names: HashSet<&std::ffi::OsStr> = used.iter().filter(|p| p.parent() == Some(dir)).filter_map(|p| p.file_name()).collect();
            if let Ok(entries) = std::fs::read_dir(ctx.root.join(cache)) {
                for entry in entries {
                    let path = entry?.path();
                    if path.is_file() && !path.file_name().is_some_and(|n| names.contains(n)) {
                        std::fs::remove_file(&path).with_context(|| format!("pruning {}", path.display()))?;
                    }
                }
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
        self.picture_markup(meta, attrs, false).0
    }

    /// [`picture_html`](Self::picture_html), and with `preload`, the
    /// `<link rel="preload">` for it: the image loads eagerly with
    /// `fetchpriority="high"`, and `sizes="auto"` (which only works for lazy
    /// images) is left out.
    fn picture_markup(&self, meta: &ImageMetadata, attrs: &[(String, String)], preload: bool) -> (String, Option<String>) {
        let fallback = meta.fallback();
        let (Some(low), Some(high)) = (fallback.first(), fallback.last()) else { return (String::new(), None) };
        let mut sizes = None;
        let mut img_attrs: Vec<(String, String)> = Vec::new();
        for (k, v) in &self.options.default_attributes {
            if k == "sizes" {
                sizes = Some(v.clone());
            } else if preload && k == "loading" {
            } else if !attrs.iter().any(|(a, _)| a == k) {
                img_attrs.push((k.clone(), v.clone()));
            }
        }
        for (k, v) in attrs {
            match k.as_str() {
                "width" | "height" => {}
                "sizes" => sizes = Some(v.clone()),
                "src" => img_attrs.push(("src".into(), low.url.clone())),
                "loading" if preload && v.eq_ignore_ascii_case("lazy") => {}
                _ => img_attrs.push((k.clone(), v.clone())),
            }
        }
        if preload {
            sizes = sizes.map(|s| without_auto(&s)).filter(|s| !s.is_empty());
            if !attrs.iter().any(|(a, _)| a == "fetchpriority") {
                img_attrs.push(("fetchpriority".into(), "high".into()));
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

        let preload = preload.then(|| {
            let (format, entries) = meta.formats.iter().next().expect("a format");
            let mut link = format!("<link rel=\"preload\" as=\"image\" type=\"{}\" fetchpriority=\"high\"", format.mime());
            match entries.as_slice() {
                [one] => link.push_str(&format!(" href=\"{}\"", escape_html(&one.url))),
                many => {
                    link.push_str(&format!(" imagesrcset=\"{}\"", escape_html(&srcset_attr(many))));
                    if let Some(s) = &sizes {
                        link.push_str(&format!(" imagesizes=\"{}\"", s.replace('"', "&quot;")));
                    }
                }
            }
            link.push('>');
            link
        });
        if meta.formats.len() < 2 {
            return (img, preload);
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
        (html, preload)
    }

    /// Some HTML made ready for a feed (what `feedHtml()` does before making
    /// URLs absolute): each local `<img src>` points at one generated copy
    /// (`width` pixels wide at most, or less when the tag's own `width` says
    /// so, in `format`), since feed readers drop `<picture>` and `srcset`; a
    /// link to a local image points at the copy a page's link would; and
    /// `srcset`, `sizes`, `loading`, `decoding`, `fetchpriority` and `ssqch:*`
    /// attributes go. `page_url` is the page the HTML is from (a path or a
    /// whole URL), for relative image paths.
    pub fn feed_images(&self, html: &str, page_url: &str, width: u32, format: Format) -> Result<String> {
        if !html.contains("<img") && !html.contains("<a") {
            return Ok(html.to_string());
        }
        let page_path = match page_url.split_once("://") {
            Some((_, rest)) => rest.find('/').map(|i| &rest[i..]).unwrap_or("/"),
            None => page_url,
        };
        let site_path = |src: &str| -> Option<PathBuf> {
            if src.starts_with('/') || src.contains("://") || src.starts_with("data:") {
                return self.resolve_site_src(src);
            }
            self.resolve_site_src(&join_url_path(page_path, src))
        };
        let site_path = &site_path;
        let img = element!("img[src]", move |el| {
            let ignored = el.has_attribute("ssqch:ignore");
            let names: Vec<String> = el.attributes().iter().map(|a| a.name()).filter(|n| n.starts_with("ssqch:")).collect();
            for n in names {
                el.remove_attribute(&n);
            }
            if ignored {
                return Ok(());
            }
            let src = el.get_attribute("src").unwrap_or_default();
            let Some(path) = site_path(&src) else { return Ok(()) };
            if !path.is_file() {
                self.warn_once(format!("feedHtml(): image not found: {}", src));
                return Ok(());
            }
            let own = el.get_attribute("width").and_then(|w| w.trim().parse::<u32>().ok()).filter(|w| *w > 0);
            let w = match own {
                Some(own) if width == 0 || own < width => own,
                _ => width,
            };
            let meta = match self.generate(&path, &[w], &[format]) {
                Ok(m) => m,
                Err(e) => {
                    self.warn_once(format!("{:#}", e));
                    return Ok(());
                }
            };
            let resolved = if format == Format::Auto { meta.auto } else { Some(format) };
            if let Some(e) = resolved.and_then(|f| meta.formats.get(&f)).or_else(|| meta.formats.values().next()).and_then(|e| e.iter().max_by_key(|e| e.width)) {
                el.set_attribute("src", &e.url)?;
            }
            for attr in ["srcset", "sizes", "loading", "decoding", "fetchpriority"] {
                el.remove_attribute(attr);
            }
            Ok(())
        });
        let link = element!("a[href]", move |el| {
            if el.has_attribute("ssqch:ignore") {
                el.remove_attribute("ssqch:ignore");
                return Ok(());
            }
            let href = el.get_attribute("href").unwrap_or_default();
            let Some(path) = site_path(&href) else { return Ok(()) };
            if Format::from_path(&path).is_none() || !path.is_file() {
                return Ok(());
            }
            match self.link_target(&path) {
                Ok(url) => el.set_attribute("href", &url)?,
                Err(e) => self.warn_once(format!("{:#}", e)),
            }
            Ok(())
        });
        let out = rewrite_str(html, RewriteStrSettings { element_content_handlers: vec![img, link], ..RewriteStrSettings::new() });
        out.map_err(|e| anyhow!("feedHtml(): {}", e))
    }

    /// Rewrite every local `<img>` in an HTML document.
    pub fn transform_html(&self, html: &str, page_input: &Path) -> Result<String> {
        let links = self.options.linked_images && html.contains("<a");
        if !html.contains("<img") && !links {
            return Ok(html.to_string());
        }
        let preloads: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let preloads_ref = &preloads;
        // Links to local images (click-to-enlarge), rewritten to a generated copy.
        let link_handler = element!("a[href]", move |el| {
            if el.has_attribute("ssqch:ignore") {
                el.remove_attribute("ssqch:ignore");
                return Ok(());
            }
            if !links {
                return Ok(());
            }
            let href = el.get_attribute("href").unwrap_or_default();
            let Some(path) = self.resolve_src(&href, page_input) else { return Ok(()) };
            if Format::from_path(&path).is_none() {
                return Ok(());
            }
            if !path.is_file() {
                self.warn_once(format!("linked image not found: {} (in {})", href, page_input.display()));
                return Ok(());
            }
            match self.link_target(&path) {
                Ok(url) => el.set_attribute("href", &url)?,
                Err(e) => self.warn_once(format!("{:#}", e)),
            }
            Ok(())
        });
        let out = rewrite_str(
            html,
            RewriteStrSettings {
                element_content_handlers: vec![link_handler, element!("img[src]", |el| {
                    if el.has_attribute("ssqch:ignore") {
                        el.remove_attribute("ssqch:ignore");
                        el.remove_attribute("ssqch:preload");
                        return Ok(());
                    }
                    let preload = el.has_attribute("ssqch:preload");
                    let src = el.get_attribute("src").unwrap_or_default();
                    let Some(path) = self.resolve_src(&src, page_input) else { return Ok(()) };
                    if !path.is_file() {
                        self.warn_once(format!("image not found: {} (in {})", src, page_input.display()));
                        return Ok(());
                    }
                    // A plain `width` attribute pins the image to that one width.
                    let widths: Vec<u32> = match (el.get_attribute("ssqch:widths"), el.get_attribute("width").and_then(|w| w.trim().parse::<u32>().ok())) {
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
                        el.attributes().iter().filter(|a| !a.name().starts_with("ssqch:")).map(|a| (a.name(), a.value())).collect();
                    let (markup, link) = self.picture_markup(&meta, &attrs, preload);
                    el.replace(&markup, ContentType::Html);
                    preloads_ref.lock().unwrap().extend(link);
                    Ok(())
                })],
                ..RewriteStrSettings::new()
            },
        )
        .map_err(|e| anyhow!("image transform: {}", e))?;
        let preloads = preloads.into_inner().unwrap();
        if preloads.is_empty() {
            return Ok(out);
        }
        insert_preloads(&out, &preloads.join("")).ok_or_else(|| anyhow!("ssqch:preload in {}: the page has no <head> to put the preload in", page_input.display()))
    }
}

/// `imageUrl()`'s options: `{ width, format }`, where `width` is a number or
/// `"auto"` (the original's, the default) and `format` a format name
/// (default `"auto"`, the source's).
pub fn image_url_options(options: Option<&sitesquatch::Value>) -> Result<(u32, Format)> {
    image_options_for("imageUrl()", options, 0)
}

/// [`image_url_options`] for another function: `who` names it in errors,
/// and `default_width` is used when there's no `width`.
pub fn image_options_for(who: &str, options: Option<&sitesquatch::Value>, default_width: u32) -> Result<(u32, Format)> {
    let Some(o) = options.filter(|v| !v.is_nullish()) else { return Ok((default_width, Format::Auto)) };
    if o.as_object().is_none() {
        bail!("{}: options must be an object like {{ width: 1200, format: \"png\" }}", who);
    }
    for key in o.as_object().map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
        if key != "width" && key != "format" {
            bail!("{}: unknown option \"{}\" (options: width, format)", who, key);
        }
    }
    let width = match o.get("width") {
        v if v.is_nullish() => default_width,
        v if v.as_str() == Some("auto") => 0,
        v => {
            let n = v.to_number();
            if !(n.is_finite() && n >= 1.0 && n.fract() == 0.0) {
                bail!("{}: width must be a whole number of pixels or \"auto\", got {}", who, v.to_js_string());
            }
            n as u32
        }
    };
    let format = match o.get("format") {
        v if v.is_nullish() => Format::Auto,
        v => Format::parse(&v.to_js_string()).ok_or_else(|| anyhow!("{}: unknown format \"{}\" (use avif, webp, jpeg, png, gif, svg or auto)", who, v.to_js_string()))?,
    };
    Ok((width, format))
}

/// The widths to generate for an image `original` pixels wide: never wider
/// than the original, and a too-large width is clamped to the original only
/// when the previous width is `minimum_threshold` times smaller than it.
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

/// A single candidate needs no width descriptor.
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

/// The image's pixels, rotated by its EXIF orientation and converted to sRGB
/// if its color profile calls for it, with the plan that was followed.
fn decode(src: &Path) -> Result<(DynamicImage, color::Plan)> {
    let mut decoder = ImageReader::open(src)?.with_guessed_format()?.into_decoder()?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let plan = color::Plan::for_icc(decoder.icc_profile().ok().flatten().as_deref());
    let mut img = DynamicImage::from_decoder(decoder).with_context(|| format!("decoding {}", src.display()))?;
    img.apply_orientation(orientation);
    if let color::Plan::Convert(profile) = &plan {
        img = color::to_srgb(&img, profile).with_context(|| format!("decoding {}", src.display()))?;
    }
    Ok((img, plan))
}

/// Put the cached file at `out` in the output, unless it's already there: a
/// hard link (no extra space), or a copy where links don't work (another
/// drive). A copy that's older or a different size is replaced.
fn publish(cache: &Path, out: &Path) -> Result<()> {
    if let (Ok(a), Ok(b)) = (std::fs::metadata(cache), std::fs::metadata(out)) {
        if a.len() == b.len() && b.modified().ok() >= a.modified().ok() {
            return Ok(());
        }
    }
    let _ = std::fs::remove_file(out);
    link_or_copy(cache, out)
}

fn link_or_copy(from: &Path, to: &Path) -> Result<()> {
    if std::fs::hard_link(from, to).is_err() {
        // Another build thread may have just put the same file there.
        if to.exists() && std::fs::metadata(from)?.len() == std::fs::metadata(to)?.len() {
            return Ok(());
        }
        std::fs::copy(from, to)?;
    }
    Ok(())
}

/// `sizes` without `auto`, which only lazy images can use: `auto, 50vw` is
/// `50vw`, and `auto` alone is nothing (the browser's default, `100vw`).
fn without_auto(sizes: &str) -> String {
    sizes.split(',').map(str::trim).filter(|s| !s.eq_ignore_ascii_case("auto")).collect::<Vec<_>>().join(", ")
}

/// `html` with `links` in its `<head>`, before the first stylesheet or
/// script there (so the browser asks for the image early), or at the end of
/// `<head>`. `None` when there's no `<head>`.
fn insert_preloads(html: &str, links: &str) -> Option<String> {
    use std::cell::Cell;
    use std::rc::Rc;
    let (seen, done) = (Cell::new(false), Rc::new(Cell::new(false)));
    let out = rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!("head", |el| {
                    seen.set(true);
                    let (done, links) = (done.clone(), links.to_string());
                    if let Some(handlers) = el.end_tag_handlers() {
                        let handler: lol_html::EndTagHandler<'static> = Box::new(move |end| {
                            if !done.get() {
                                end.before(&links, ContentType::Html);
                                done.set(true);
                            }
                            Ok(())
                        });
                        handlers.push(handler);
                    }
                    Ok(())
                }),
                element!("head link[rel], head script", |el| {
                    // A script that runs (not JSON-LD or another data block), or a stylesheet.
                    let script = el.tag_name() == "script" && el.get_attribute("type").is_none_or(|t| {
                        let t = t.trim().to_ascii_lowercase();
                        t.is_empty() || t == "module" || t.contains("javascript")
                    });
                    let stylesheet = script || el.get_attribute("rel").is_some_and(|r| r.to_ascii_lowercase().split_whitespace().any(|r| r == "stylesheet"));
                    if stylesheet && !done.get() {
                        el.before(links, ContentType::Html);
                        done.set(true);
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::new()
        },
    )
    .ok()?;
    (seen.get() && done.get()).then_some(out)
}

/// A relative URL path resolved against a page's path:
/// `("/posts/hike/", "./map.png")` is `/posts/hike/map.png`.
fn join_url_path(page: &str, rel: &str) -> String {
    let page = page.split(['?', '#']).next().unwrap_or(page);
    let dir = &page[..page.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let mut parts: Vec<&str> = Vec::new();
    for part in dir.split('/').chain(rel.split('/')) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
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
            p.sources.lock().unwrap().clear();
            p.converted.lock().unwrap().clear();
            p.timings.lock().unwrap().clear();
            if p.options.hash_cache {
                p.hashes.lock().unwrap().load(ctx.root.join(CACHE_FILE));
            }
            p.generated.store(0, Ordering::Relaxed);
            p.pruned.store(0, Ordering::Relaxed);
            Ok(())
        });
        // imageUrl(src, { width, format }): one generated copy, for templates.
        let p = self.processor.clone();
        cfg.add_filter("imageUrl", move |args| {
            let src = args.first().filter(|v| !v.is_nullish()).map(|v| v.to_js_string()).unwrap_or_default();
            // Template engines name the function in front of its errors already.
            let unnamed = |e: anyhow::Error| anyhow!("{}", format!("{:#}", e).trim_start_matches("imageUrl(): "));
            let (width, format) = image_url_options(args.get(1)).map_err(unnamed)?;
            p.image_url(&src, width, format).map_err(unnamed)
        });
        if self.transform {
            let p = self.processor.clone();
            cfg.add_html_transform("image", move |ctx, html| if ctx.is_html() { p.transform_html(&html, ctx.input_path) } else { Ok(html) });
        }
        let p = self.processor.clone();
        let quiet = cfg.quiet;
        let verbose = cfg.verbose;
        self.processor.quiet.store(quiet, Ordering::Relaxed);
        cfg.on_after_build(move |ctx, _| {
            let pruned = if p.options.prune { p.prune(ctx, &ctx.output_dir.join(&p.options.output_subdir))? } else { 0 };
            p.pruned.store(pruned, Ordering::Relaxed);
            if p.options.hash_cache {
                // A cache that can't be written only costs speed, so warn and carry on.
                if let Err(e) = p.hashes.lock().unwrap().save() {
                    p.warn_once(format!("couldn't write {}: {:#}", ctx.root.join(CACHE_FILE).display(), e));
                }
            }
            if verbose && !quiet {
                let mut timings = p.timings.lock().unwrap().clone();
                timings.sort_by_key(|t| std::cmp::Reverse(t.2));
                if !timings.is_empty() {
                    sitesquatch::diagnostics::progress("Slowest images to encode:");
                    for (src, files, took) in timings.iter().take(10) {
                        sitesquatch::diagnostics::progress(&format!("  {:>8.2?}  {} ({} files)", took, sitesquatch::display_path(ctx, src), files));
                    }
                }
            }
            Ok(())
        });
        let p = self.processor.clone();
        cfg.add_summary("Images", move |_| p.summary());
    }
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
    fn preloads_go_before_the_first_stylesheet_in_head() {
        let link = "<link rel=\"preload\" as=\"image\">";
        assert_eq!(
            insert_preloads("<html><head><meta charset=\"utf-8\"><link rel=\"icon\" href=\"/i.png\"><link rel=\"stylesheet\" href=\"/s.css\"></head><body></body></html>", link).unwrap(),
            "<html><head><meta charset=\"utf-8\"><link rel=\"icon\" href=\"/i.png\"><link rel=\"preload\" as=\"image\"><link rel=\"stylesheet\" href=\"/s.css\"></head><body></body></html>"
        );
        assert_eq!(insert_preloads("<head><title>x</title></head><body><script></script></body>", link).unwrap(), "<head><title>x</title><link rel=\"preload\" as=\"image\"></head><body><script></script></body>");
        assert_eq!(insert_preloads("<p>no head</p>", link), None);
        assert_eq!(
            insert_preloads("<head><script type=\"application/ld+json\">{}</script><script type=\"module\" src=\"/a.js\"></script></head>", link).unwrap(),
            "<head><script type=\"application/ld+json\">{}</script><link rel=\"preload\" as=\"image\"><script type=\"module\" src=\"/a.js\"></script></head>"
        );
        assert_eq!(without_auto("auto, (min-width: 896px) 832px, 100vw"), "(min-width: 896px) 832px, 100vw");
        assert_eq!(without_auto("auto"), "");
    }

    #[test]
    fn relative_paths_join_the_page_path() {
        assert_eq!(join_url_path("/posts/hike/", "./map.png"), "/posts/hike/map.png");
        assert_eq!(join_url_path("/posts/hike/index.html", "map.png"), "/posts/hike/map.png");
        assert_eq!(join_url_path("/posts/hike/", "../shared/a.png"), "/posts/shared/a.png");
        assert_eq!(join_url_path("/", "a.png"), "/a.png");
    }

    #[test]
    fn widths_never_upscale() {
        let defaults = [300, 600, 900, 1200, 1500];
        assert_eq!(valid_widths(810, &defaults, 1.25), vec![300, 600, 810]);
        assert_eq!(valid_widths(672, &defaults, 1.25), vec![300, 600]);
        assert_eq!(valid_widths(2000, &defaults, 1.25), vec![300, 600, 900, 1200, 1500]);
        assert_eq!(valid_widths(256, &[48, 96, 144], 1.25), vec![48, 96, 144]);
        assert_eq!(valid_widths(200, &[300, 600], 1.25), vec![200]);
    }
}
