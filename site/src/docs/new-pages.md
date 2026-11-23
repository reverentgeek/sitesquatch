---
title: "Starting a new page"
description: "ssqch new creates a page from a blueprint."
---
`ssqch new` creates a page from a blueprint: a page to start from, kept in `_blueprints/` in the input folder and named after the folder its pages go in. Here's `src/_blueprints/posts.md`:

```md
---
# Fill in the description before publishing.
title:
date:
description:
draft: true
---
Write here. The title is {{ title }}.
```

```sh
ssqch new posts --title "Pine cones: a field guide"
```

```text
Created src/posts/pine-cones-a-field-guide.md from src/_blueprints/posts.md. Field notes started.
```

The new post:

```md
---
# Fill in the description before publishing.
title: "Pine cones: a field guide"
date: 2026-11-10
description:
draft: true
---
Write here. The title is {{ title }}.
```

- **Only front matter is filled in.** `title` is set, `date` is set to today when the blueprint has that key (or you pass `--date`), and `--set key=value` sets anything else (`--set draft=false`, `--set "tags=[news, trails]"`). Comments and the order of the keys stay. The body is copied as it is, so a blueprint isn't a template with a syntax of its own: `{{ title }}` in it is for the page.
- **Which blueprint:** the one named after the page's folder, the most specific first. `docs/guides/install.md` uses `_blueprints/docs/guides.md`, then `_blueprints/docs.md`, then `_blueprints/default.md`, and with none of them the page gets a `title` and a `date`. `--blueprint notes` picks one by name. A blueprint can be in any template language (`posts.jinja`), and a [theme](themes.md) can bring its own in its `_blueprints/`.
- **A file, or a folder and a title:** `ssqch new posts/pine-cones.md` names the file itself (the title is then "Pine cones", unless you pass `--title`). Given a folder, the file is named after the title, the way the folder's other pages are: with the date in front (`2026-11-10-pine-cones.md`) when most of them have one, and as `pine-cones/index.md` when most are folders with an index file.
- **A page that has to be filled in:** a page `ssqch new` makes passes its section's schema as the blueprint wrote it, example sentence and all. Leave a field the schema requires empty in the blueprint (`summary:`), and the build stops with `` `summary` is required (a string) `` until someone writes it; text that's only an example is better as a comment in the blueprint than as a value.
- **Nothing is overwritten,** and `--format json` prints the new file's `path`, its `blueprint`, `title` and `date`.
