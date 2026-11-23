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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  // page.lastModified, which each page shows as "Last updated": when its file last changed in a
  // commit (in CI, check out the whole history: `fetch-depth: 0`). Before the first commit,
  // the file's time.
  lastModified: "git",
  // page.date for a page with no date of its own: its file's first commit, which is the same in
  // every clone (a checkout writes every file at once, so the file's time isn't).
  dateFallback: "git",
  // The site's own JavaScript runs in UTC, so a laptop and CI build the same dates.
  timeZone: "UTC",
  // Printing a name that isn't defined (a misspelled page.titel) is an error with the file and
  // line, not an empty spot on the page. Checking it first (an if, or a default) still works.
  strict: true,
  templateFormats: ["edge", "md"],
  markdownEngine: "edge",
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

  // Functions templates can call: the "Last updated" date at the foot of each page.
  filters: {
    // A date as people write it: January 1, 2026. In UTC, and spelled out here rather than
    // with toLocaleDateString, whose answers can change between Node releases.
    readableDate: (value) => {
      const date = new Date(value);
      return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
    },
    // The day, as <time datetime> takes it: 2026-01-01.
    isoDay: (date) => new Date(date).toISOString().slice(0, 10),
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
