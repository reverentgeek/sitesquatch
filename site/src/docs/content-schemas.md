---
title: "Content schemas"
description: "Front matter is easy to get wrong."
---
<img align="right" src="../../../docs/assets/stickers/ranger-mary.svg" alt="" width="96">

Front matter is easy to get wrong: a misspelled key, a date that isn't one, a hero image that was renamed. A schema says what a kind of page's data has to look like, and every build checks it:

```js
export default defineConfig({
  schemas: {
    posts: {
      fields: {
        title: "string",
        date: "date",
        description: "string?",
        status: "'draft' | 'published'",
        topics: "string[]",
        hero: { src: "file", alt: "string" },
        "author?": { name: "string", url: "string?" },
        slug: (value) => /^[a-z0-9-]+$/.test(value) || "must be lowercase letters, digits and dashes",
      },
      unknown: "error",
    },
    docs: { files: "docs/**/*.md", fields: { title: "string", order: "integer?" } },
  },
});
```

```text
error: 3 content errors:
  - src/posts/cedar.md: `status` must be "draft" or "published", not "drfat" (schema `posts`)
  - src/posts/cedar.md: `hero.src` is "cedar.jpg", but there's no such file next to the page (looked for src/posts/cedar.jpg) (schema `posts`)
  - src/posts/cedar.md: `descripton` isn't a field of this schema (did you mean `description`?) (schema `posts`)

  --> src/posts/cedar.md:5
   3 | date: 2026-03-02
   4 | tags: posts
   5 | status: drfat
     | ^^^^^^
   6 | hero: { src: cedar.jpg, alt: A cedar }
```

(The other two get their lines pointed at too.)

- **Which pages:** a schema covers the pages tagged with its name (the pages in `collections.posts`; `all` is every page in collections), or the files matching `files`, globs relative to the input folder. A paginated template's every page is checked, though only its first is in its tags' collections: a schema on `tags: snack` checks all six snacks a `pagination: { data: snacks, size: 1 }` template makes, and each problem names the item (`src/snack.jinja (item 4 of snacks, "Moss Mix")`). A schema whose `files` match no page is a warning (`schema \`snack\` matches no pages (files: "snacks/snack.jinja")`), since a page that moved would turn its checks off without a word; a schema for a tag with no pages yet says nothing, as an empty collection is fine.
- **What's checked:** each page's data after the data cascade and `computed`, so a value from a directory data file counts. Every problem in every page is reported in one go, with the file and the field.
- **Types:** `string`, `number`, `integer`, `boolean`, `date` (a date, or a string that reads as one), `file` (a path to a file that exists: next to the page, or from the input folder with a leading `/`), `object`, `array` and `any`. A quoted value, number, `true`, `false` or `null` is that exact value, `|` is either-or, `[]` is a list, and a `?` at the end makes the field optional.
- **Nested data:** an object of fields, or a one-item array for a list of them: `links: [{ href: "string", text: "string" }]`. A key that ends in `?` is optional too.
- **Your own rules:** a function gets the value and the page's data, and returns `true`, `false`, or what's wrong (`` `slug` must be lowercase letters, digits and dashes ``). An answer that goes on from the field's name (`must`, `should`, `is`, `needs`...) follows it; anything else follows a colon (`` `summary`: write the opening's own summary ``).
- **`unknown`:** what to do about keys in a page's own front matter that aren't fields: `"allow"` (the default), `"warn"` or `"error"`. Keys ssqch reads itself (`layout`, `tags`, `permalink`, `date` and the like) are always fine, and so is data from the rest of the cascade.
- **Editor types:** `ssqch types` adds the schemas to `ssqch.d.ts`, so `pages.byTag("posts")` in a collection function knows each page's fields. A build doesn't write the file, so run `ssqch types` again after adding or changing a schema; until then the editor knows the old fields, and a build says so: `note: ssqch.d.ts doesn't have the schema \`jobs\` as the config has it, so an editor shows old fields: run ssqch types` (not while serving, and only when the site has the file).

> [!NOTE]
> **Not released yet.** A tag's schema checking every page a paginated template makes, the warning for a schema that matches no pages, and the note about stale types ship with the next version of ssqch.

In `sitesquatch.toml`, a schema is a table: `[schemas.posts]` with `fields = { title = "string", date = "date" }`.
