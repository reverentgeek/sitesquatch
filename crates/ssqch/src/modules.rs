//! JavaScript modules for the built-in plugins: `ssqch/image`, `ssqch/rss`,
//! `ssqch/minify`, `ssqch/assets` and `ssqch/links`.

use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, bail, Result};
use sitesquatch::{Config, Map, Value};
use sitesquatch_js::JsModule;
use sitesquatch_plugin_image::{ImageOptions, ImagePlugin, ImageProcessor};
use sitesquatch_plugin_minify::MinifyOptions;

use crate::parse_format;

/// The image processor every image API in the build shares: the
/// `ssqch/image` plugin's, or a processor-only one when the config didn't add
/// the plugin but calls `image()`.
pub static IMAGES: Mutex<Option<Arc<ImageProcessor>>> = Mutex::new(None);

pub fn set_image_processor(processor: Arc<ImageProcessor>) -> Result<()> {
    let mut slot = IMAGES.lock().unwrap();
    if slot.is_some() {
        bail!("the ssqch/image plugin was added twice");
    }
    *slot = Some(processor);
    Ok(())
}

/// Give `image()` a processor if the config didn't add the plugin.
pub fn ensure_image_processor(cfg: &mut Config) {
    let mut slot = IMAGES.lock().unwrap();
    if slot.is_none() {
        let plugin = ImagePlugin::processor_only(ImageOptions::default());
        *slot = Some(plugin.processor.clone());
        drop(slot);
        cfg.add_plugin(plugin);
    }
}

fn processor() -> Result<Arc<ImageProcessor>> {
    IMAGES.lock().unwrap().clone().ok_or_else(|| anyhow!("the image processor isn't set up"))
}

fn module(name: &str, source: &str, natives: Vec<(&str, Value)>) -> JsModule {
    JsModule {
        name: name.into(),
        source: source.into(),
        natives: natives.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
    }
}

pub fn js_modules() -> Vec<JsModule> {
    vec![
        module(
            "ssqch/image",
            include_str!("js/image.js"),
            vec![
                ("generate", Value::func(generate_image)),
            ],
        ),
        module(
            "ssqch/rss",
            include_str!("js/rss.js"),
            vec![
                ("newestItemDate", Value::func(|args| Ok(sitesquatch_plugin_rss::newest_item_date(&arg(args, 0))))),
                ("dateToRfc3339", Value::func(|args| sitesquatch_plugin_rss::date_to_rfc3339(&arg(args, 0)).map(Value::from))),
                ("dateToRfc822", Value::func(|args| sitesquatch_plugin_rss::date_to_rfc822(&arg(args, 0)).map(Value::from))),
                ("absoluteUrl", Value::func(|args| Ok(Value::from(sitesquatch_plugin_rss::absolute_url(&arg(args, 0).to_js_string(), &arg(args, 1).to_js_string()))))),
                (
                    "htmlToAbsoluteUrls",
                    Value::func(|args| sitesquatch_plugin_rss::html_to_absolute_urls(&arg(args, 0).to_js_string(), &arg(args, 1).to_js_string()).map(Value::from)),
                ),
            ],
        ),
        module("ssqch/assets", include_str!("js/assets.js"), vec![]),
        module("ssqch/links", include_str!("js/links.js"), vec![]),
        module(
            "ssqch/minify",
            include_str!("js/minify.js"),
            vec![(
                "minify",
                Value::func(|args| {
                    let opts = MinifyOptions { collapse_whitespace: arg(args, 1).truthy(), remove_comments: arg(args, 2).truthy(), short_doctype: arg(args, 3).truthy(), shorten_attributes: arg(args, 4).truthy() };
                    Ok(Value::from(sitesquatch_plugin_minify::minify(&arg(args, 0).to_js_string(), &opts)))
                }),
            )],
        ),
    ]
}

fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or_default()
}

/// `generate(absolutePath, widths, formats)` -> one array per format:
/// `{ webp: [{ format, width, height, url, sourceType, srcset, filename, outputPath, size }], ... }`
fn generate_image(args: &[Value]) -> Result<Value> {
    let p = processor()?;
    let src = arg(args, 0).to_js_string();
    let widths: Vec<u32> = arg(args, 1).as_array().unwrap_or(&[]).iter().map(|w| w.to_number().max(0.0) as u32).collect();
    let formats = arg(args, 2).as_array().unwrap_or(&[]).iter().map(|f| parse_format(&f.to_js_string())).collect::<Result<Vec<_>>>()?;
    if !Path::new(&src).is_file() {
        bail!("image(): file not found: {}", src);
    }
    let meta = p.generate(Path::new(&src), &widths, &formats)?;
    let root = p.root()?;
    let mut out = Map::new();
    for (format, entries) in &meta.formats {
        let items = entries
            .iter()
            .map(|e| {
                let output = e.path.strip_prefix(&root).unwrap_or(&e.path).to_string_lossy().into_owned();
                Value::from_pairs([
                    ("format", Value::from(format.ext())),
                    ("width", Value::Num(e.width as f64)),
                    ("height", Value::Num(e.height as f64)),
                    ("url", Value::from(e.url.as_str())),
                    ("sourceType", Value::from(e.source_type)),
                    ("srcset", Value::from(e.srcset.as_str())),
                    ("filename", Value::from(e.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())),
                    ("outputPath", Value::from(output)),
                    ("size", Value::Num(std::fs::metadata(&e.path).map(|m| m.len() as f64).unwrap_or(0.0))),
                ])
            })
            .collect();
        out.insert(format.ext().to_string(), Value::array(items));
    }
    Ok(Value::object(out))
}
