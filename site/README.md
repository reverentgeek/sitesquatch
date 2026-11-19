# sitesquatch.dev

ssqch's own website, built with the ssqch in this repository (`packages/ssqch`), so a change to ssqch that breaks its own site shows up here first. The plan is section 9 of [`TODO.md`](../TODO.md), "The website". So far: the landing page, the 404 page and the Cloudflare deploy. The docs, the changelog and the live examples come next.

From this folder, with `npm ci` already run in `packages/ssqch`:

- `node build.ts` builds it for production into `dist/`, and fails on any warning as well as any error: a broken link, or a file over its budget (`budgets` in `ssqch.config.js`: no page gets JavaScript it doesn't need).
- `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it with live reload.
- `node --test "tests/*.test.ts"` checks it: every pair of text and background in both modes has enough contrast (`tests/contrast.test.ts`, from the tokens in `src/assets/site.css`), and the README backs every number on the landing page (`tests/numbers.test.ts`).
- `../packages/ssqch/node_modules/.bin/tsc -p tsconfig.json` type-checks the build script and the tests.

`.github/workflows/site.yml` runs all four on every pull request and push to `main`, and deploys what it built.

## Deploying

The site is one Cloudflare Worker with static assets and no script of its own (`wrangler.jsonc`): the build's `dist/`, with `404.html` for any address that isn't there (`not_found_handling: "404-page"`), and `src/_headers` caching the fingerprinted CSS and JavaScript for a year.

- **A pull request** gets a Worker Preview, `pr-<number>`, at its own `workers.dev` address, posted in a comment on the pull request and deleted when it closes. A pull request from a fork gets none, since it gets no secrets.
- **A push to `main`** is deployed to production. A fix to the site doesn't wait for a release, so the site can describe a feature that isn't on npm yet: that feature's documentation starts with a "Not released yet" note (AGENTS.md has the wording), which the release commit takes out. `node ../scripts/unreleased-notes.mjs` lists the notes, and the release workflow refuses a tag while one is left.
- **The secrets:** `CLOUDFLARE_API_TOKEN` (made from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. Until both are set, the preview and deploy jobs say so and skip, and the checks still run.
- **Wrangler** is pinned in the workflow (`WRANGLER`). `wrangler.jsonc`'s `compatibility_date` can't be newer than that version's runtime supports, so move them together.

To see the build as Cloudflare serves it, without an account: `node build.ts`, then `npx wrangler@4.157.0 dev` (it serves `dist/` at http://localhost:8787/ with the 404 handling and `_headers` applied).

## What's where

- `src/index.jinja` is the landing page, and `src/404.jinja` the 404 page. `src/_includes/base.jinja` is the layout.
- `src/_data/` holds what the pages list, so a list has one source: `examples.yml` (the example sites), `trailheads.yml`, `benchmarks.js` (the mileage boards, each with the README's words for it), `links.yml` (where links to the documentation go: the README on GitHub until the docs are pages here), `release.js` (the latest release and the Node it needs, from `packages/ssqch/package.json`) and `drawings.js` (each drawing's size, from its viewBox).
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
