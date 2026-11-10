// A documentation site. `ssqch serve` serves it with live reload, and
// `ssqch build` builds it into dist/. ssqch.d.ts gives your editor the types.
import { defineConfig } from "ssqch";
import { linksPlugin } from "ssqch/links";
import { minifyPlugin } from "ssqch/minify";

// Search is Pagefind (https://pagefind.app), which indexes the built pages.
// It's a program of its own that npx fetches, so it's opt-in:
// SEARCH=1 ssqch build
const search = Boolean(process.env.SEARCH);

export default defineConfig(({ env }) => ({
  dirs: { input: "src", output: "dist" },
  templateFormats: ["edge", "md"],
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
  afterBuild: search ? [{ run: "npx -y pagefind --site dist" }] : [],

  plugins: [
    // Broken internal links (and anchors) fail a production build.
    linksPlugin({ ignore: ["/pagefind/"] }),
    env === "production" && minifyPlugin(),
  ],
}));
