# multilingual

A ranger station's site in English and Spanish, in Jinja. It's the [multilingual sites](../../../site/src/docs/multilingual.md) recipe as one site that runs: a folder per language, a language switch, hreflang links, the sitemap's alternates, strings that fall back, and a page that isn't translated yet.

What it shows:

- A folder per language: `src/en/` and `src/es/`, each with directory data (`en.json`: `{ "lang": "en", "layout": "base.jinja" }`). A page's `key` in its front matter ties its translations together, so a translation can have its own address (`/es/senderos/` is `/en/trails/`).
- Translations worked out once a build: the `untranslated` collection in `ssqch.config.js` groups the pages by `key` and language into a map, which the `versions` filter (a page's address in each language) and the sitemap's `alternates` read. A lookup in a map, not a loop over every page on every page.
- A fallback page: `src/es/` has no snacks page, so `src/fallback.jinja` writes the English one at `/es/snacks/`, with the Spanish header and a notice, `lang="en"` on its `<main>`, and a canonical link to the original. Every language has every page, so no link breaks while a translation is on its way. Add `src/es/snacks.md` (with `key: snacks`) and the fallback goes away.
- Strings: `src/_data/strings/<lang>.json`, read with the `t` filter (`{{ "nav.trails" | t(lang) }}`), which falls back to English for a string Spanish doesn't have yet (`nav.snacks`).
- hreflang: each page lists its real translations and `x-default` in its `<head>`, and `sitemapPlugin({ alternates })` lists the same in `sitemap.xml`. A fallback page and a page with one language have none.
- A home page that asks: `/` links each language instead of guessing from the browser's.

Build it with `ssqch build`. To add a language, add it to `src/_data/languages.json`, a folder with its directory data, a strings file, and an import in the config; every page it doesn't have yet gets a fallback.
