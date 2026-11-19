---
title: "Themes"
description: "A theme is a folder shaped like a site's input folder."
---
<img align="right" src="../../../docs/assets/stickers/tent.svg" alt="" width="96">

A theme is a folder shaped like a site's input folder: `_includes/` (layouts, partials, render hooks, containers), `_data/`, pages, and files to copy, like stylesheets and fonts. Your site sits on top of it:

```js
export default defineConfig({
  theme: "themes/trail",
});
```

```text
themes/trail/                 src/                        what the build uses
  _includes/base.jinja                                    the theme's layout
  _includes/footer.jinja      _includes/footer.jinja      your footer
  _data/site.json             _data/site.json             both, merged; your values win
  404.md                                                  the theme's 404 page
  about.md                    about.md                    your about page
  assets/theme.css                                        copied to /assets/theme.css
```

- **File by file:** an include, layout, hook or container you have wins over the theme's at the same path, so changing a theme's footer means adding one file, not forking the theme. Data is merged, with your values winning. A page or file in the theme is built or copied unless your input folder has a file at that path.
- **Any engine:** the fallback works for Jinja, Nunjucks, Edge, Liquid and Handlebars includes alike, and a theme can mix them.
- **No package manager:** a theme can be a git repository pinned to a tag or a commit (its full 40-character hash): `theme: "https://github.com/you/trail-theme#v1.2.0"`, or `#v1.2.0:theme` when the theme is in a folder of its repository (`{ git, ref, dir }` says the same as an object). ssqch fetches it once with `git` and keeps it in `.cache/ssqch/themes/`, so later builds don't touch the network; changing the commit or tag fetches the new one. An unpinned URL is an error, so a build next year gets the theme you tested with.
- **Layers:** `theme` takes a list, and earlier themes sit on top of later ones.
- **Not part of a theme:** the files about it at the top of its folder (`README`, `LICENSE`, `CHANGELOG`, `package.json`).

To change something in a git theme, copy that one file from `.cache/ssqch/themes/` to the same path in your input folder and edit it there. In `sitesquatch.toml`, it's `theme = ["themes/trail"]`.
