# component-docs

Docs for a CSS component library, in Edge. Distilled from [getbootstrap.com](https://getbootstrap.com), which is built with Hugo (and from docs sites that use MDX).

What it shows:

- Edge components where an MDX site would use JSX components: `@!component('components/swatch', { name, color })` and `@component('components/callout', { type: 'warning' })` with a slot of Markdown (rendered with the `markdown` filter), right in the Markdown page.
- Live examples: a `::: example` container renders its HTML as written (`container.source`, the lines inside the container) and, below it, the same HTML as highlighted code (the built-in `highlight` filter).
- Sass variables shown from the source: `scssDocs("scss/_buttons.scss", "variables")` (a config filter) reads the lines between `// scss-docs-start variables` and `// scss-docs-end variables`, so the docs can't drift from the code.
- The library's own Sass compiled by `ssqch/sass` into `/css/pinecone.css`, which the pages use.

Build it with `ssqch build`.
