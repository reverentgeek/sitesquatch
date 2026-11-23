// The site's config. `ssqch build` builds it into dist/, and `ssqch serve`
// serves it with live reload. ssqch.d.ts gives your editor the types.
import { defineConfig, readData } from "ssqch";
import { imagePlugin } from "ssqch/image";
import { linksPlugin } from "ssqch/links";
import { llmsPlugin } from "ssqch/llms";
import { minifyPlugin } from "ssqch/minify";
import { robotsPlugin } from "ssqch/robots";
import { rssPlugin } from "ssqch/rss";
import { sitemapPlugin } from "ssqch/sitemap";

// The site's address, from src/_data/site.json: put yours there.
const { url } = readData("src/_data/site.json");

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["liquid", "md"],
  markdownEngine: "liquid",
  // Delete what an earlier build wrote that this one didn't (a deleted post's page).
  leaveNoTrace: true,
  // Highlight code while building; the layout links /highlight.css.
  markdown: { highlight: true },

  // Functions templates can call: {{ post.date | readableDate }}
  filters: {
    readableDate: (date) => new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
    // A post's own tags, without the `posts` tag every post has: {{ ownTags(tags) }}
    ownTags: (tags) => (Array.isArray(tags) ? tags : []).filter((name) => name !== "posts"),
  },

  collections: {
    // Newest posts first, for the home page and the feed.
    newestPosts: (pages) => [...pages.byTag("posts")].reverse(),
    // Each tag on a post, in order, with its posts newest first: src/tags.jinja lists them, and
    // src/tag.jinja makes a page for each one.
    tagList: (pages) => {
      const tags = new Map();
      for (const post of [...pages.byTag("posts")].reverse()) {
        for (const name of post.data.tags) if (name !== "posts") tags.set(name, [...(tags.get(name) ?? []), post]);
      }
      return [...tags.keys()].sort().map((name) => ({ name, posts: tags.get(name) }));
    },
  },

  plugins: [
    // Every <img> becomes a responsive <picture>.
    imagePlugin({ formats: ["webp", "auto"], widths: [400, 800, 1200] }),
    // The feed's filters (src/feed.jinja): absoluteUrl, dateToRfc3339, feedHtml and friends.
    rssPlugin(),
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
