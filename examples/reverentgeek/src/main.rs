//! The ReverentGeek blog, built with SiteSquatch.
//!
//! A port of the blog's `.eleventy.js`. With the blog cloned next to this repository:
//!
//! ```sh
//! cargo run --release -p reverentgeek -- build --root ../blog
//! cargo run --release -p reverentgeek -- serve --root ../blog
//! ```

mod assets;
mod site;

use sitesquatch_plugin_image::{Format, ImageOptions, ImagePlugin};
use sitesquatch_plugin_minify::MinifyPlugin;
use sitesquatch_plugin_rss::RssPlugin;

fn main() -> std::process::ExitCode {
    sitesquatch::cli::run(|cfg| {
        cfg.input = "src/site".into();
        cfg.output = "dist".into();
        cfg.template_formats = ["edge", "md", "txt", "html"].map(String::from).to_vec();
        cfg.markdown_template_engine = Some("edge".into());
        cfg.html_template_engine = Some("edge".into());
        cfg.data_deep_merge = true;

        cfg.add_watch_target("src/assets/");
        cfg.add_passthrough_copy_to("src/assets/js/pco.js", "assets/pco.js");
        cfg.add_passthrough_copy_to("src/assets/fonts", "fonts");
        cfg.add_passthrough_copy_to("src/site/static", "static");
        cfg.add_passthrough_copy("src/site/favicon.ico");

        cfg.add_plugin(RssPlugin);

        // Same settings as src/utils/eleventy/image-transform-options.js.
        // AVIF needs `--features avif` (slow to encode, so it's opt-in).
        let formats = if cfg!(feature = "avif") { vec![Format::Avif, Format::Webp, Format::Auto] } else { vec![Format::Webp, Format::Auto] };
        // Production builds also delete unused derivatives (scripts/prune-images.js).
        let images = ImagePlugin::new(ImageOptions { formats, prune: cfg.is_production(), ..ImageOptions::default() });
        let processor = images.processor.clone();
        cfg.add_plugin(images);

        cfg.add_plugin(site::ReverentGeek { images: processor });

        // Transforms run in registration order: images first, then minify.
        if cfg.is_production() {
            cfg.add_plugin(MinifyPlugin::default());
        }
    })
}
