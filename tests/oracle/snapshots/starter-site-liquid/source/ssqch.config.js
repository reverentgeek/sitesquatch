// The site's config. `ssqch build` builds it into dist/, and `ssqch serve`
// serves it with live reload. ssqch.d.ts gives your editor the types.
import { defineConfig } from "ssqch";
import { imagePlugin } from "ssqch/image";
import { linksPlugin } from "ssqch/links";
import { minifyPlugin } from "ssqch/minify";

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["liquid", "md"],
  markdownEngine: "liquid",

  // Functions templates can call: {{ post.date | readableDate }}
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
    env === "production" && minifyPlugin(),
  ],
}));
