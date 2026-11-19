# sitesquatch.dev

ssqch's own website, built with the ssqch in this repository (`packages/ssqch`), so a change to ssqch that breaks its own site shows up here first. The plan is section 9 of [`TODO.md`](../TODO.md), "The website": this folder is its first stage, the landing page and the 404 page. The docs, the changelog, the live examples and the Cloudflare deploy come next.

From this folder, with `npm ci` already run in `packages/ssqch`:

- `node build.ts` builds it for production into `dist/`, and fails on any warning as well as any error: a broken link, or a file over its budget (`budgets` in `ssqch.config.js`: no page gets JavaScript it doesn't need).
- `node ../packages/ssqch/bin/ssqch.ts serve --root .` serves it with live reload.
- `node --test "tests/*.test.ts"` checks it: every pair of text and background in both modes has enough contrast (`tests/contrast.test.ts`, from the tokens in `src/assets/site.css`), and the README backs every number on the landing page (`tests/numbers.test.ts`).
- `../packages/ssqch/node_modules/.bin/tsc -p tsconfig.json` type-checks the build script and the tests.

CI's `site` job runs all four.

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
