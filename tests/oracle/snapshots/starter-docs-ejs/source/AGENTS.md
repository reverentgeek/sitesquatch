# A SiteSquatch site

This site is built with SiteSquatch (`ssqch`), a static site generator. `ssqch.config.js` is the config. `src/docs/` has the pages (Markdown, with `src/_data/nav.yml` for the sidebar), `src/_includes/` the layouts and templates (EJS), `src/_data/` the global data and `src/_blueprints/` the blueprints for new pages. `dist/` is the build: don't edit it.

- How to use something: `ssqch docs <name>` (a config option, template function, command or topic) answers for the installed version, and `ssqch docs` lists everything.
- What this ssqch supports: `ssqch capabilities --format json`.
- Check a change: `ssqch build --format json`. `ok` is the result, and each problem has a `code`, a `file` and a `line`.
- What agents and crawlers find in the build (robots.txt, the sitemap, llms.txt, each page's Markdown copy): `ssqch patrol --format json` after `ssqch build`.
- Why a page's value is what it is: `ssqch trace <url or file> --format json`.
- Before changing layouts or the config: `ssqch build --output dist-before` into a folder that isn't there yet, and afterwards `ssqch build` and `ssqch diff dist-before dist`.
- A new page: `ssqch new docs/guides --title "..."` (then list it in `src/_data/nav.yml`).
- `ssqch serve` is for a person watching the browser. Check with `ssqch build`.
- A `note:` or hint naming another generator's word (`pathPrefix`): use ssqch's name.
