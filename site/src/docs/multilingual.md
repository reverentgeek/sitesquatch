---
title: "Multilingual sites: translations, i18n and hreflang"
navTitle: "Multilingual sites"
description: "ssqch has no built-in i18n yet."
---
ssqch has no built-in i18n yet. What two real sites (one from Jekyll, one from Astro) did instead, with what ssqch has:

- **A folder per language** (`content/fr/guide.md`), and the language from directory data (`content/fr/fr.json`: `{ "lang": "fr" }`) or front matter. A key that groups a page's translations (the file's path below the language folder, or a front matter key like `translationKey`).
- **A page's translations** are a lookup in a collection: `collections.docs | where: "data.key", key` in Liquid, or a filter of your own that groups pages by key once. A loop over every page on every page (a language menu built with `where`) is the slow way on a big site; a filter that groups them once is fast, and the same in every template language:

> [!NOTE]
> **Not released yet.** This ships with the next version of ssqch: the `translation` filter recipe.

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
- **Fallback pages** (the default language's page at another language's URL): a collection function that returns one object per URL (`{ lang, slug, page }`), choosing the translation when there is one, and one template with `pagination: { data: "collections.routes", size: 1, alias: "route" }` and `permalink: "/{{ route.lang }}/{{ route.slug }}/"` that writes `route.page.templateContent`. The content pages get `permalink: false`, so they're written only where the routes put them.
- **Strings:** `_data/i18n/<lang>.json`, read in templates as `i18n[lang].nav.about`, or a `t(lang, key)` filter that falls back to the default language.
- **hreflang:** a loop over the page's translations in the layout's `<head>`, with `x-default` for the default language; `sitemapPlugin({ url, alternates })` lists the same translations in the sitemap.
- **Direction:** `dir` on `<html>` from a language list in data (`{ "ar": { "dir": "rtl" } }`).
- **Old language codes:** `aliases` on each page, or `redirectsPlugin({ redirects })`.
