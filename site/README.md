# sitesquatch.dev

ssqch's own website, built with the ssqch in this repository (`packages/ssqch`), so a change to ssqch that breaks its own site shows up here first. The plan is section 9 of [`TODO.md`](../TODO.md), "The website". So far: the landing page, the docs, the changelog, the 404 page and the Cloudflare deploy. The live examples come next.

From this folder, with `npm ci` already run in `packages/ssqch`:

- `node build.ts` builds it for production into `dist/`, and fails on any warning as well as any error: a broken link, or a file over its budget (`budgets` in `ssqch.config.js`: no page gets JavaScript it doesn't need).
- `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it with live reload.
- `node --test "tests/*.test.ts"` checks it: every pair of text and background in both modes has enough contrast (`tests/contrast.test.ts`, from the tokens in `src/assets/site.css`), the README backs every number on the landing page (`tests/numbers.test.ts`), and the docs pages cover the README (`tests/docs.test.ts`, below).
- `../packages/ssqch/node_modules/.bin/tsc -p tsconfig.json` type-checks the build script and the tests.

`.github/workflows/site.yml` runs all four on every pull request and push to `main`, and deploys what it built.

## Deploying

The site is one Cloudflare Worker with static assets and no script of its own (`wrangler.jsonc`): the build's `dist/`, with `404.html` for any address that isn't there (`not_found_handling: "404-page"`), and `src/_headers` caching the fingerprinted CSS and JavaScript for a year.

- **A pull request** gets a Worker Preview, `pr-<number>`, at its own `workers.dev` address, posted in a comment on the pull request and deleted when it closes. A pull request from a fork gets none, since it gets no secrets.
- **A push to `main`** is deployed to production. A fix to the site doesn't wait for a release, so the site can describe a feature that isn't on npm yet: that feature's documentation starts with a "Not released yet" note (AGENTS.md has the wording), which the release commit takes out. `node ../scripts/unreleased-notes.mjs` lists the notes, and the release workflow refuses a tag while one is left.
- **The secrets:** `CLOUDFLARE_API_TOKEN` (made from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. Until both are set, the preview and deploy jobs say so and skip, and the checks still run.
- **Wrangler** is pinned in the workflow (`WRANGLER`). `wrangler.jsonc`'s `compatibility_date` can't be newer than that version's runtime supports, so move them together.

To see the build as Cloudflare serves it, without an account: `node build.ts`, then `npx wrangler@4.157.0 dev` (it serves `dist/` at http://localhost:8787/ with the 404 handling and `_headers` applied).

## The docs

The README is the one source of the documentation until the docs move into pages of their own (TODO.md, section 9, "The docs move"). Before each build, `lib/split.ts` (the config's `beforeBuild`) splits it into pages in `src/docs/` by the map in `lib/docs-map.ts`, and copies the trailheads in from `docs/trailheads/`. `src/docs/` and `src/_data/nav.json` are written by it and aren't committed: edit the README or a trailhead, and `ssqch serve` (which watches both) shows the change.

- **The map** is the sidebar's groups and pages, in order. A page is one or more README sections by heading, each with the sections under it that no other page takes. A new `##` section in the README needs a place in the map (or in `NOT_ON_THE_SITE`), and `tests/docs.test.ts` fails until it has one.
- **Links** are rewritten for the site: a link to one of the README's sections goes to its page and anchor, a trailhead to its page, and any other file of the repository to GitHub. The build's link checker checks every one, anchors included.
- **Each page says where else it is:** the `ssqch docs` command that prints it (tested to print that section), and "Edit on GitHub" at its line of the README.
- **The reference** (`/docs/reference/`) is every name `ssqch docs` lists with its one line and the page that explains it, from `ssqch docs`'s own module (`src/_data/reference.js`), so the two can't disagree.
- **Search** is Pagefind, pinned in `build.ts`, which indexes the built docs after ssqch's build (`SEARCH=0` skips it). The header's `<site-search>` (`src/elements/site-search.js`, by `elementsPlugin()`) loads Pagefind's script and index the first time someone opens it, with the button or <kbd>/</kbd>. Without JavaScript it's a link to the reference.

## The changelog

`/changelog/` is the site's own writing, not `CHANGELOG.md` rendered: one entry for each minor release in `src/changelog/` (`0.9.md`), short and conversational, with the headlines, "What you might need to change" for every Breaking item, and a link to the release's section of `CHANGELOG.md`, which stays the complete record. A patch release adds its version to its minor's `releases` and a dated paragraph. `/changelog/feed.xml` is its Atom feed.

An entry's front matter is its `title`, `release` (the version it starts with), `releases` (every version it covers) and `date` (`release`'s date), and `lastRelease` and `lastDate` when it covers more than one. `tests/changelog.test.ts` keeps the entries in step with `CHANGELOG.md`: the package's version has an entry (so a release can't ship without one), every release is in exactly one entry with its date, an entry whose releases have a Breaking heading has "What you might need to change", and every number in an entry is in its releases' sections.

## What's where

- `src/index.jinja` is the landing page, `src/404.jinja` the 404 page, and `src/docs-reference.jinja` the reference. `src/_includes/base.jinja` is the layout, and `src/_includes/doc.jinja` the docs pages' (the sidebar, the table of contents, the strip under the title, previous and next).
- `src/_data/` holds what the pages list, so a list has one source: `examples.yml` (the example sites), `trailheads.yml`, `benchmarks.js` (the mileage boards, each with the README's words for it), `links.yml` (where the landing page's links to the docs go), `latest.js` (the latest release and the Node it needs, from `packages/ssqch/package.json`) and `drawings.js` (each drawing's size, from its viewBox).
- The drawings aren't copied in: `passthrough` takes them from `docs/assets/`, where the README's are.
- Every terminal on the landing page is ssqch's own output from a real run, with `...` where lines were left out. The `init` and `serve` samples are a run of the starter with ssqch 0.9.0; the schema error and the "No differences" line are the README's.

## The fonts

Caprasimo (headings) and National Park (labels and navigation), both under the [SIL Open Font License 1.1](https://openfontlicense.org), with no reserved font names. Their licences are beside them in `src/assets/fonts/`. They're served from the site, not from Google Fonts, as Latin subsets in WOFF2: 44 KB together.

They came from the [google/fonts](https://github.com/google/fonts) repository (`ofl/caprasimo/Caprasimo-Regular.ttf` and `ofl/nationalpark/NationalPark[wght].ttf`) and were made with [fonttools](https://github.com/fonttools/fonttools) (`pip install fonttools brotli`):

```sh
# National Park is variable; the site uses weights 400 to 700.
fonttools varLib.instancer "NationalPark[wght].ttf" wght=400:700 -o national-park.ttf
latin="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215"
pyftsubset Caprasimo-Regular.ttf --unicodes="$latin" --flavor=woff2 --layout-features=kern,liga,calt --output-file=caprasimo-latin.woff2
pyftsubset national-park.ttf --unicodes="$latin" --flavor=woff2 --layout-features=kern,liga,calt --output-file=national-park-latin.woff2
```
