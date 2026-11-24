---
title: "Multilingual sites: translations, i18n and hreflang"
navTitle: "Multilingual sites"
description: "ssqch has no built-in i18n yet."
---
ssqch has no built-in i18n yet. What two real sites (one from Jekyll, one from Astro) did instead, with what ssqch has. The [`multilingual` example](https://github.com/reverentgeek/sitesquatch/tree/main/examples/sites/multilingual/) is all of it in one site that runs (English and Spanish, in Jinja, [live](https://sitesquatch.dev/examples/multilingual/)): copy its `ssqch.config.js`, `src/_includes/base.jinja` and `src/fallback.jinja` to start. It ships with ssqch, so a site that installed it has the files beside its own: `node_modules/ssqch/bundled/examples/multilingual/` (`cp -R node_modules/ssqch/bundled/examples/multilingual/src/_includes/base.jinja src/_includes/`, and so on).

- **A folder per language** (`content/fr/guide.md`), and the language from directory data (`content/fr/fr.json`: `{ "lang": "fr" }`) or front matter. A key that groups a page's translations (the file's path below the language folder, or a front matter key like `translationKey`).
- **A page's translations** are a lookup in a collection: `collections.docs | where: "data.key", key` in Liquid, or a filter of your own that groups pages by key once. A loop over every page on every page (a language menu built with `where`) is the slow way on a big site; a filter that groups them once is fast, and the same in every template language:

  ```js
  // ssqch.config.js: each page's translations, by its key and language, worked out once a build.
  const groups = new WeakMap();
  const byKey = (pages) => {
    let map = groups.get(pages);
    if (!map) {
      map = new Map();
      for (const p of pages) if (p.data.key) map.set(p.data.key, { ...map.get(p.data.key), [p.data.lang]: p });
      groups.set(pages, map);
    }
    return map;
  };
  export default { filters: { translation: (pages, key, lang) => byKey(pages).get(key)?.[lang] } };
  ```

  `{% assign fr = collections.docs | translation: key, "fr" %}` is the French page, or nothing.
- **Fallback pages** (the default language's page at another language's address, while its translation is on its way): a collection function that returns one object for each page a language doesn't have (`{ lang, key, url, page }`, with `page` the default language's), and one template that paginates over it, `pagination: { data: "collections.untranslated", size: 1, alias: "stand_in" }` with `permalink: "{{ stand_in.url }}"`, that writes `stand_in.page.templateContent`. The content pages stay where they are; only the missing ones are written. The example's fallback page has the language's header and a notice in that language, `lang` of the original on its `<main>`, a canonical link to the original, and `sitemap: false`, so search engines list the original. Its `computed` gives it the `lang`, `key` and `title` the layout reads. `templateContent` is the page's body without its own layout, so a page whose layout adds to it (a legal page's heading and "Last changed" date, a job's location) loses that part in its stand-in: move what the stand-in needs into an include that both the page's layout and the fallback template use. `ssqch patrol` notices a stand-in that lost its `<h1>`.
- **The map, once:** the collection function is a good place to group the pages by key, since collections are worked out before any page renders: keep the map in a variable in `ssqch.config.js`, and a filter (the example's `versions`: a page's address in each language) and `sitemapPlugin({ alternates })` read it.
- **Strings:** `_data/i18n/<lang>.json`, read in templates as `i18n[lang].nav.about`, or a filter that falls back to the default language for a string a language doesn't have yet (the example's `{{ "nav.trails" | t(lang) }}`).
- **hreflang:** a loop over the page's translations in the layout's `<head>`, the page itself included, with `x-default` for the default language; `sitemapPlugin({ url, alternates })` lists the same translations in the sitemap. Only real translations: a fallback page is a copy, and a page in one language has nothing to list.
- **The language switch:** a link to the page in each language (its translation, or its fallback), with `hreflang` and `lang` on each link and `aria-current` on the page's own. A home page at `/` that links each language is simpler and kinder than a redirect by the browser's language, which search engines can't follow.
- **Direction:** `dir` on `<html>` from a language list in data (`{ "ar": { "dir": "rtl" } }`).
- **Old language codes:** `aliases` on each page, or `redirectsPlugin({ redirects })`.
