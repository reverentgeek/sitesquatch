---
title: "GitHub Pages"
description: "A project site is served at https://you.github.io/<repository>/, so the build needs that path as its base."
---
A project site is served at `https://you.github.io/<repository>/`, so the build needs that path as its [`base`](deploying.md#serving-a-site-under-a-path). This workflow builds on every push to `main` and deploys with GitHub's own Pages actions (in the repository's settings, set Pages' source to "GitHub Actions"):

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx ssqch build --output dist --base "/${{ github.event.repository.name }}/"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- **`--base`** takes the repository's name from the workflow, so the config doesn't have to know it and `ssqch serve` on your machine still serves the site at `/`. A user site (`you.github.io`) or one with a custom domain is at the root: leave `--base` off.
- **The version** is the site's `ssqch` dev dependency, pinned by its lockfile, so a new release can't surprise a deploy. `node-version` can be any Node from 22.18 on. A site without a `package.json` replaces `npm ci` with `npm install --global ssqch@0.13.4` (drop `cache: npm`, which looks for a lockfile) and runs `ssqch build` instead of `npx ssqch build`.
- **A 404 page:** GitHub Pages serves `404.html` from the site's root, so give your 404 page `permalink: /404.html`.
- **Images:** to keep encoded images between builds, cache `.cache/ssqch` with `actions/cache` (see [Keep the image cache between builds](deploying.md#keep-the-image-cache-between-builds)).
- **Markdown for agents:** GitHub Pages can't vary an answer by the request's `Accept`, so agents find a page's Markdown copy through its `<link rel="alternate">` and `llms.txt` ([Serving Markdown to agents](serving-markdown.md#github-pages)).
