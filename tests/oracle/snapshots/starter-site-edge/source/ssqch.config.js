// The site's config. `ssqch build` builds it into dist/, and `ssqch serve`
// serves it with live reload. ssqch.d.ts gives your editor the types.
import { defineConfig, readData } from "ssqch";
import { imagePlugin } from "ssqch/image";
import { linksPlugin } from "ssqch/links";
import { llmsPlugin } from "ssqch/llms";
import { minifyPlugin } from "ssqch/minify";
import { robotsPlugin } from "ssqch/robots";
import { sitemapPlugin } from "ssqch/sitemap";

// The site's address, from src/_data/site.json: put yours there.
const { url } = readData("src/_data/site.json");

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",

  // Functions templates can call: {{ readableDate(post.date) }}
  filters: {
    readableDate: (date) => new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
  },

  // Newest posts first, for the home page.
  collections: {
    newestPosts: (pages) => [...pages.byTag("posts")].reverse(),
  },

  plugins: [
    // Every <img> becomes a responsive <picture>.
    imagePlugin({ formats: ["webp", "auto"], widths: [400, 800, 1200] }),
    // Broken internal links fail a production build.
    linksPlugin(),
    // What crawlers and agents read: sitemap.xml, robots.txt, and llms.txt with a
    // Markdown copy of each page. `ssqch patrol` checks them after a build.
    sitemapPlugin({ url }),
    // `false` keeps that kind of AI crawler out: training (collecting pages to train
    // models), search (AI search answers) or fetch (a page a person asked about).
    robotsPlugin({ ai: { training: true, search: true, fetch: true } }),
    llmsPlugin({ url }),
    env === "production" && minifyPlugin(),
  ],
}));
