# blog-categories

A blog with categories, in Nunjucks. Distilled from [eslint.org](https://eslint.org), which is built with Eleventy.

What it shows:

- Posts in `posts/` list their `categories` in front matter. A custom collection (`categoryPages` in `ssqch.config.js`) splits each category's posts into pages of two, and `category/category.njk` paginates over that list with `size: 1`, so every category gets `/category/releases/`, `/category/releases/2/` and so on, with previous and next links.
- Reading time on every post (the `readingTime` filter) and an excerpt in each list (`page.excerpt`, the text before `<!-- more -->`).
- An Atom feed (`ssqch/rss` filters).
- Two sites from one source: `SITE=staging ssqch build` reads `_data/sites/staging.json` instead of `main.json` (title, address and a banner), through `process.env` in the config.
- A sitemap, and `strict: true`, so a typo in a template fails the build instead of printing nothing.

Build it with `ssqch build`, or `SITE=staging ssqch build` for the staging site.
