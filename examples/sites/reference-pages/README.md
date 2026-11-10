# reference-pages

A reference with one page per item, in Handlebars. Distilled from the [TSConfig reference](https://www.typescriptlang.org/tsconfig/) on typescriptlang.org, whose pages are generated from TypeScript's option schema.

What it shows:

- A separate source of truth: `schema/squatchrc.schema.json` describes every option. `_data/options.js` turns it into the list the templates use (sorted, grouped by category, with default values written out), so nothing is copied by hand. A site whose data comes from another program can run it first with `beforeBuild: { run: "node scripts/generate.js" }`.
- One page per option from `reference/option.hbs`, paginated over the list with `size: 1`, at `/reference/<name>/`, with "related options" links between pages.
- An index grouped by category (a `byCategory` helper from the config), and descriptions written in Markdown, rendered with the built-in `markdown` helper.

Build it with `ssqch build`.
