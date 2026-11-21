# Writing pages

Pages are Markdown, with GitHub's extensions and a few of ssqch's own. This page uses each of them once, so its source is a cheat sheet.

## Notes

:::note
A `:::note` block. There are `:::tip`, `:::warning` and `:::caution` too.
:::

:::warning[Check twice]
Give a block a title in brackets.
:::

> [!TIP]
> **Deer's shortcut:** GitHub's alert syntax works as well, which keeps a README readable in both places.

:::details How do these work?
Each `:::name` block renders through `src/_includes/containers/name.liquid` if there is one (like this one, `details.liquid`), or as a `<div class="name">`.
:::

## Tabs

::::tabs
:::tab npm
```sh
npm install pinecone
```
:::
:::tab pnpm
```sh
pnpm add pinecone
```
:::
::::

Without JavaScript, tabs are labeled sections, one after another. With it, picking a tab picks it in every group on the site that has one with that name.

## Code

Fences are highlighted while the site builds. Mark lines with braces:

```js {2}
export function trail(name) {
  return `/trails/${name}/`;
}
```

## Tables, tasks and footnotes

| Syntax | Result |
| --- | --- |
| `- [x] done` | A checked box |
| `[^1]` | A footnote[^1] |

- [x] Write the docs
- [ ] Spot a Squatch

## Data in a page

Front matter and the files in `src/_data/` are available in every page: this site is called Squatch Docs.

[^1]: https://example.com/docs/guides/writing/Footnotes collect at the end of the page.
