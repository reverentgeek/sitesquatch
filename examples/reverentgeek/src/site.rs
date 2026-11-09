//! Site-specific filters, collections and data: the Rust version of
//! `src/utils/site/*.js` and `src/site/_data/*.js`.

use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use chrono::Datelike;
use sitesquatch::{Args, Config, Map, Plugin, Value};
use sitesquatch_plugin_image::{Format, ImageMetadata, ImageProcessor};

/// Tags that organize the site rather than describe a topic.
const RESERVED_TAGS: &[&str] = &["all", "posts", "page"];

const TOPIC_LABELS: &[(&str, &str)] = &[
    ("ai", "AI"),
    ("devrel", "DevRel"),
    ("dotnet", ".NET"),
    ("javascript", "JavaScript"),
    ("nodejs", "Node.js"),
    ("web-development", "Web Development"),
];

const HERO_SIZES: &str = "(min-width: 1024px) 700px, 100vw";
const HERO_WIDTHS: &[u32] = &[300, 600, 900, 1200, 1500];
const HERO_ALT: &str = "Site banner image with a collage of illustrations and doodles. The center image is the ReverentGeek logo with a speech bubble that reads, you don't need permission to be awesome.";

pub struct ReverentGeek {
    pub images: Arc<ImageProcessor>,
}

pub fn topic_label(slug: &str) -> String {
    if let Some((_, label)) = TOPIC_LABELS.iter().find(|(s, _)| *s == slug) {
        return label.to_string();
    }
    slug.split('-')
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn topics_only(tags: &Value) -> Vec<String> {
    let Some(list) = tags.as_array() else { return Vec::new() };
    let mut topics: Vec<String> = list.iter().map(Value::to_js_string).filter(|t| !RESERVED_TAGS.contains(&t.as_str())).collect();
    topics.sort();
    topics.dedup();
    topics
}

fn by_newest_first(posts: &mut [Value]) {
    posts.sort_by_key(|p| std::cmp::Reverse(p.get("date").to_date()));
}

fn date_arg(args: &[Value]) -> Result<chrono::DateTime<chrono::Utc>> {
    args.arg(0).to_date().ok_or_else(|| anyhow!("expected a date, got {:?}", args.arg(0)))
}

fn hero_image(images: &ImageProcessor, ctx: &sitesquatch::BuildContext) -> Result<Value> {
    let site: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(ctx.data_dir.join("site.json"))?)?;
    let Some(cover) = site.get("cover_image").and_then(|c| c.as_str()) else { return Ok(Value::object(Map::new())) };
    let src = ctx.input_dir.join(cover.trim_start_matches('/'));
    let formats: &[Format] = if cfg!(feature = "avif") { &[Format::Avif, Format::Webp, Format::Png] } else { &[Format::Webp, Format::Png] };
    let meta: Arc<ImageMetadata> = images.generate(&src, HERO_WIDTHS, formats)?;

    let png = meta.formats.get(&Format::Png).ok_or_else(|| anyhow!("hero image has no PNG output"))?;
    let fallback = png.last().unwrap();
    let preload_format = if meta.formats.contains_key(&Format::Avif) { Format::Avif } else { Format::Webp };
    let preload_entries = &meta.formats[&preload_format];
    let preload = preload_entries.iter().find(|e| e.width == 900).unwrap_or_else(|| preload_entries.last().unwrap());
    let share = png.iter().find(|e| e.width == 1200).unwrap_or(fallback);
    let entry = |e: &sitesquatch_plugin_image::ImageEntry| {
        Value::from_pairs([
            ("url", Value::from(e.url.as_str())),
            ("width", Value::from(e.width)),
            ("height", Value::from(e.height)),
            ("sourceType", Value::from(e.source_type)),
            ("srcset", Value::from(e.srcset.as_str())),
        ])
    };
    Ok(Value::from_pairs([
        ("alt", Value::from(HERO_ALT)),
        ("sizes", Value::from(HERO_SIZES)),
        ("fallback", entry(fallback)),
        (
            "srcset",
            Value::from_pairs([
                ("avif", Value::from(meta.srcset(Format::Avif))),
                ("webp", Value::from(meta.srcset(Format::Webp))),
                ("fallback", Value::from(meta.srcset(Format::Png))),
            ]),
        ),
        (
            "preload",
            Value::from_pairs([
                ("href", Value::from(preload.url.as_str())),
                ("imagesrcset", Value::from(meta.srcset(preload_format))),
                ("type", Value::from(preload.source_type)),
            ]),
        ),
        (
            "social",
            Value::from_pairs([
                ("url", Value::from(share.url.as_str())),
                ("width", Value::from(share.width)),
                ("height", Value::from(share.height)),
                ("type", Value::from(share.source_type)),
            ]),
        ),
    ]))
}

impl Plugin for ReverentGeek {
    fn name(&self) -> &str {
        "reverentgeek"
    }

    fn register(&self, cfg: &mut Config) {
        // ---- data (scripts/hash-assets.js, src/site/_data/assets.js, heroImage.js)
        cfg.on_before_build(crate::assets::fingerprint);
        cfg.add_global_data("assets", crate::assets::data);
        let images = self.images.clone();
        cfg.add_global_data("heroImage", move |ctx| hero_image(&images, ctx));

        // ---- filters (src/utils/site/filters.js)
        cfg.add_filter("isSiteMapSafe", |args| Ok(Value::from((!args.arg_string(0).starts_with("/_")).to_string())));
        cfg.add_filter("htmlDateString", |args| Ok(Value::from(date_arg(args)?.format("%Y-%m-%d").to_string())));
        cfg.add_filter("postDate", |args| Ok(Value::from(date_arg(args)?.format("%B %-d, %Y").to_string())));
        cfg.add_filter("topicsOnly", |args| Ok(Value::array(topics_only(&args.arg(0)).into_iter().map(Value::from).collect())));
        cfg.add_filter("topicLabel", |args| Ok(Value::from(topic_label(&args.arg_string(0)))));
        cfg.add_filter("adjacentPosts", |args| {
            let items = args.arg(0);
            let items = items.as_array().unwrap_or(&[]);
            let url = args.arg(1);
            let found = items.iter().position(|item| item.get("url").strict_eq(&url));
            let (older, newer) = match found {
                Some(i) => (
                    if i > 0 { items[i - 1].clone() } else { Value::Null },
                    items.get(i + 1).cloned().unwrap_or(Value::Null),
                ),
                None => (Value::Null, Value::Null),
            };
            Ok(Value::from_pairs([("older", older), ("newer", newer)]))
        });
        let tag_re = regex::Regex::new(r"<[^>]+>").unwrap();
        cfg.add_filter("readingTime", move |args| {
            let text = tag_re.replace_all(&args.arg_string(0), " ").to_string();
            let words = text.split_whitespace().count() as f64;
            Ok(Value::from((words / 200.0).round().max(1.0)))
        });
        cfg.add_filter("jsonLdArticle", |args| {
            let a = args.arg(0);
            let ld = serde_json::json!({
                "@context": "https://schema.org",
                "@type": "Article",
                "headline": a.get("title").to_json(),
                "description": a.get("description").to_json(),
                "image": a.get("image").to_json(),
                "datePublished": a.get("datePublished").to_json(),
                "author": { "@type": "Person", "name": a.get_path("author.name").to_json(), "url": a.get_path("author.url").to_json() },
                "publisher": {
                    "@type": "Organization",
                    "name": a.get_path("publisher.name").to_json(),
                    "logo": { "@type": "ImageObject", "url": a.get_path("publisher.logoUrl").to_json() }
                },
                "mainEntityOfPage": { "@type": "WebPage", "@id": a.get("pageUrl").to_json() }
            });
            Ok(Value::from(serde_json::to_string_pretty(&ld)?))
        });
        cfg.add_filter("currentYear", |_| Ok(Value::from(chrono::Utc::now().year())));

        // src/utils/site/social-image.js
        let images = self.images.clone();
        cfg.add_filter("socialImage", move |args| {
            let path = args.arg_string(0);
            let fallback = || Value::from_pairs([("url", Value::from(path.as_str())), ("width", Value::from(1200)), ("height", Value::from(630))]);
            if path.is_empty() || path.starts_with("http") {
                return Ok(fallback());
            }
            let Some(src) = images.resolve_src(&format!("/{}", path.trim_start_matches('/')), std::path::Path::new("/")) else { return Ok(fallback()) };
            Ok(match images.generate(&src, &[1200], &[Format::Png]) {
                Ok(meta) => match meta.fallback().first() {
                    Some(e) => Value::from_pairs([("url", Value::from(e.url.as_str())), ("width", Value::from(e.width)), ("height", Value::from(e.height))]),
                    None => fallback(),
                },
                Err(_) => fallback(),
            })
        });

        // ---- collections (src/utils/site/collections.js)
        cfg.add_collection("topics", |api| {
            let mut by_topic: BTreeMap<String, Vec<Value>> = BTreeMap::new();
            for post in api.by_tag("posts") {
                for tag in topics_only(&post.get("data").get("tags")) {
                    by_topic.entry(tag).or_default().push(post.clone());
                }
            }
            let mut topics: Vec<(String, Vec<Value>)> = by_topic.into_iter().collect();
            for (_, posts) in topics.iter_mut() {
                by_newest_first(posts);
            }
            topics.sort_by(|(a, pa), (b, pb)| pb.len().cmp(&pa.len()).then_with(|| topic_label(a).cmp(&topic_label(b))));
            Ok(Value::array(
                topics
                    .into_iter()
                    .map(|(slug, posts)| {
                        Value::from_pairs([
                            ("label", Value::from(topic_label(&slug))),
                            ("url", Value::from(format!("/topics/{}/", slug))),
                            ("count", Value::from(posts.len())),
                            ("posts", Value::array(posts)),
                            ("slug", Value::from(slug)),
                        ])
                    })
                    .collect(),
            ))
        });
        cfg.add_collection("postsByYear", |api| {
            let mut posts = api.by_tag("posts");
            by_newest_first(&mut posts);
            let mut years: Vec<(i32, Vec<Value>)> = Vec::new();
            for post in posts {
                let year = post.get("date").to_date().map(|d| d.year()).unwrap_or(0);
                match years.last_mut() {
                    Some((y, list)) if *y == year => list.push(post),
                    _ => years.push((year, vec![post])),
                }
            }
            Ok(Value::array(years.into_iter().map(|(year, posts)| Value::from_pairs([("year", Value::from(year)), ("posts", Value::array(posts))])).collect()))
        });
    }
}
