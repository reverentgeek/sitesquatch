// A documentation site. `ssqch serve` serves it with live reload, and
// `ssqch build` builds it into dist/. ssqch.d.ts gives your editor the types.
import { defineConfig, readData } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { llmsPlugin } from "ssqch/llms";
import { minifyPlugin } from "ssqch/minify";
import { robotsPlugin } from "ssqch/robots";
import { sitemapPlugin } from "ssqch/sitemap";

// The site's address, from src/_data/site.json: put yours there.
const { url } = readData("src/_data/site.json");

// Search is Pagefind (https://pagefind.app), which indexes the built pages.
// It's a program of its own that npx fetches, so it's opt-in, and pinned, so
// every build gets the same one: SEARCH=1 ssqch build, then ssqch serve --built
// to try it (ssqch serve builds without it).
const search = Boolean(process.env.SEARCH);

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["jinja", "md"],
  passthrough: ["src/assets"],

  // For a site served under a path, like https://you.github.io/repo/:
  // base: "/repo/",

  // Highlight code while building; pages link /highlight.css.
  markdown: { highlight: true },

  // Every page in src/docs/ needs a title. A misspelled front matter key is a warning.
  schemas: {
    docs: {
      files: "docs/**/*.md",
      fields: { title: "string", description: "string?" },
      unknown: "warn",
    },
  },

  data: { search },
  afterBuild: search ? [{ run: "npx -y pagefind@1.6.0 --site dist" }] : [],

  plugins: [
    // Broken internal links (and anchors) fail a production build.
    linksPlugin({ ignore: ["/pagefind/"] }),
    // What crawlers and agents read: sitemap.xml, robots.txt, and llms.txt with a
    // Markdown copy of each page (each page links its copy). `ssqch patrol` checks them.
    sitemapPlugin({ url }),
    // `false` keeps that kind of AI crawler out: training (collecting pages to train
    // models), search (AI search answers) or fetch (a page a person asked about).
    robotsPlugin({ ai: { training: true, search: true, fetch: true } }),
    llmsPlugin({ url }),
    env === "production" && minifyPlugin(),
  ],
}));
