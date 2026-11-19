# Working on SiteSquatch

Thanks for helping out! This is how the repository fits together, how to run ssqch from its source, and how to check a change. [`AGENTS.md`](AGENTS.md) has the full rules, for people and coding agents alike.

<img align="right" src="docs/assets/stickers/axe-stump.svg" alt="" width="96">

```text
packages/ssqch          ssqch itself: TypeScript on Node (src/, bin/, scripts/, bundled/ and wasm/)
packages/ssqch/vendor   The Nunjucks fork that renders Jinja and Nunjucks
crates/ssqch-markdown   Markdown and the syntax highlighter, built to packages/ssqch/wasm/markdown.wasm
crates/ssqch-minify     The HTML minifier (ssqch/minify), built to wasm/minify.wasm
crates/ssqch-sass       Sass, compiled with grass (ssqch/sass), built to wasm/sass.wasm
crates/ssqch-plugin     The SDK for writing plugins in Rust, published to crates.io
examples/sites          Example sites, built by the tests
examples/rust-plugin    A plugin written in Rust with all three hooks, and its npm package
tests/oracle            Black-box tests that run any ssqch (SSQCH_BIN) against frozen output
site                    sitesquatch.dev, built with ssqch; site/src/docs is the documentation
```

The Rust crates exist to build the `.wasm` files, which are committed (so a clone needs `npm ci` and nothing else, and CI's Node jobs have no Rust); `node packages/ssqch/scripts/build-wasm.ts` builds them again after the Rust changes (`rustup target add wasm32-wasip1` first), and a test fails until you do. `cargo test --workspace` tests them as plain Rust.

From `packages/ssqch/`, after `npm ci`:

```sh
node bin/ssqch.ts build --root ../../examples/sites/blog-tags   # runs from source: Node strips the types
node --test                                                     # the package's own unit tests
npx tsc --noEmit                                                # type-checks; keep it clean
```

The oracle is the definition of done for the commands and the output: from `tests/oracle/`, `node --test` runs it with ssqch from its source (add a test file's path to run only that one; `SSQCH_BIN` runs another ssqch). It compares each example, starter and test site with its frozen output, and a site whose output changes on purpose is frozen again with `node freeze.js <site>` ([its README](tests/oracle/README.md) says how). [CI](.github/workflows/ci.yml) runs it, the unit tests and the type check on Linux, macOS and Windows, on Node 22.18, 24 and 26.

The ReverentGeek blog is the real-world test site. To build it with your changes, clone it next to this repository and point its build script at your checkout's `ssqch` (the script runs `$SSQCH_BIN` when it is set), which also builds the CSS and JavaScript:

```sh
git clone https://github.com/reverentgeek/blog.git ../blog
(cd ../blog && pnpm install && SSQCH_BIN=../ssqch/packages/ssqch/bin/ssqch.ts pnpm test)
```

`pnpm test` builds the site and runs the blog's smoke tests. The first build encodes every image, so give it a few minutes; later builds reuse them. To see an example site, build it with `node packages/ssqch/bin/ssqch.ts build --root examples/sites/<name>`, or serve it with `serve` in place of `build`.

Messages follow the rules in [`AGENTS.md`](AGENTS.md#the-sasquatch-voice): the facts first, plain output for machines, nothing random, and nothing added to a site's pages. The lines more than one place uses are in `packages/ssqch/src/voice.ts`.

Releases are built by a hand-written workflow (`.github/workflows/release.yml`) from a version tag: the npm package, with provenance, and the Homebrew formula that installs it. The steps are in [`AGENTS.md`](AGENTS.md#releasing).

## The documentation

The docs are the pages in [`site/src/docs/`](site/src/docs/), in the order [`site/src/docs/nav.yml`](site/src/docs/nav.yml) gives them. They're the one copy: [sitesquatch.dev](https://sitesquatch.dev/docs/) renders them, `ssqch docs` prints them from the package (which carries them), and GitHub shows them as files. Pages are plain Markdown (no template code runs in them), link each other with relative `.md` links, and use GitHub's `> [!NOTE]` alerts for callouts, so the three show the same text. A new config option, module export or template function needs a row or a list item on the page that explains it, starting with its name in backticks, which is what `ssqch docs <name>` answers with.

The website itself is [`site/`](site/): its README says how to build, serve and test it. A pull request gets a preview of it, and a merge to `main` deploys it.

