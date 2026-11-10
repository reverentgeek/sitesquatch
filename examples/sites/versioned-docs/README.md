# versioned-docs

Documentation with versions and a blog, in Jinja. Distilled from [reactnative.dev](https://reactnative.dev), which is built with Docusaurus.

What it shows:

- Versions as folders: `docs/next/` (unreleased) and `docs/1.0/`, each with its own sidebar in `_data/sidebars/<version>.json` and its own directory data (`version`, `layout`). `_data/versions.json` lists them, and the version switcher links to the same page in each version that has it (or to its first page).
- Tabs from containers: a `:::: tabs` container holding `::: tab npm` and `::: tab yarn` ones (`_includes/containers/tabs.jinja` and `tab.jinja`). Without JavaScript the tabs read as labeled sections; a few lines of script turn them into buttons.
- A blog with authors from `_data/authors.json`, and a "This is unreleased documentation" banner on `next` pages.
- The sidebar, previous and next links from `navTree` and `navPager`, a sitemap, and the link checker.

Build it with `ssqch build`.
