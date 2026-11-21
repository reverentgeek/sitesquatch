---
title: "Following the tracks: where a value comes from"
description: "A page's data is a cascade."
---
A page's data is a cascade. From the lowest level to the highest:

1. **Global data:** files in a theme's `_data/`, then the site's `_data/` (`site.json` is `site`), then the config's `data`. A `layout` there (`data: { layout: "base.jinja" }`) is every page's that doesn't set one lower down: in directory data or front matter, where `layout: false` turns it off.
2. **Layouts:** the front matter of the page's layouts, the outermost layout first.
3. **Directory data:** `posts/posts.json` (or `.yaml`, `.toml`, `posts.data.js`) applies to everything in `posts/` and below it. The outermost folder goes first.
4. **The page's data file:** `pine.json` or `pine.data.js` next to `pine.md`.
5. **Front matter.**
6. **`computed`:** worked out last, from everything above. A computed value that reads `collections` sees them as they are without the pages that wait for them, the way a page paginated over a collection does. A computed `layout` can depend on the page (`layout: (data) => data.wide ? "wide.html" : "post.html"`): each page then gets the layouts its value names, with their front matter below the page's data, and `""` or `false` for none. It can't set `page` (ssqch's own: a computed `page` is an error, which names the file).

A higher level replaces what a lower one set. Objects merge key by key and lists are joined (a post's `tags` add to its folder's), unless `deepMerge` is off. `page` and `ssqch` are built in.

When a value isn't what you expected, `ssqch trace` follows its tracks back to the level that set it. Give it a page's URL or its template's path:

```sh
ssqch trace /guides/pine/
```

```text
/guides/pine/
  From        src/guides/2024-03-02-pine.md (jinja, md)
  Writes      dist/guides/pine/index.html
  Layouts     _includes/guide.jinja > _includes/base.jinja
  Date        2024-03-02T00:00:00Z (from the file's name)
  Collections all, guides

  Data (name, value, and the level of the cascade that set it)
    site       {name, author}        src/_data/site.json
    section    "guides"              layout _includes/guide.jinja (over layout _includes/base.jinja)
    layout     "guide.jinja"         src/guides/guides.json
    level      "hard"                front matter (over src/guides/guides.json, src/guides/2024-03-02-pine.json)
    title      "Pine"                front matter
    label      "Pine (hard)"         computed
```

`--field` shows one value in full, with every level that set it:

```sh
ssqch trace src/guides/2024-03-02-pine.md --field level
```

```text
level = "hard"

Set by (the last one wins):
    src/guides/guides.json                    "easy"
    src/guides/2024-03-02-pine.json           "medium"
  > front matter                              "hard"
```

- **Inside a value:** a dotted path reaches into objects (`--field site.author.name`, `--field hero.alt`).
- **Pages made by pagination:** a template that makes many pages needs the URL of one of them. `ssqch trace src/tags.jinja` lists them.
- **Scripts and agents:** `--format json` prints the report as JSON (`schemaVersion: 1`), with `value`, `from` and `setBy` for each field.
- **No page is built:** it reads the site as a build does, up to the point of rendering. `beforeBuild` hooks run, since data can depend on them (a command that writes a data file, a plugin that sets itself up there), but no page is rendered or written, and `afterBuild` doesn't run. Standard output is only the report; anything a hook or `console.log` prints goes to standard error.
