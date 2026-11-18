# trail-guide: an ssqch plugin in Rust

An example of a plugin written in Rust with [`ssqch-plugin`](../../crates/ssqch-plugin), with each kind of hook a plugin can have. It's built as one `.wasm` file, `trail_guide.wasm`, which ssqch 0.8 runs on every platform.

| Hook | What it does |
| --- | --- |
| Engine `.trail` | A trail's stops, one a line, as a list: `# Cedar Trail` is the title (or the page's `title`), and `1.2 Old Growth junction \| Fork left.` is a stop at 1.2 miles with a note. |
| Filter `readingTime(html)` | Whole minutes to read the text (at least 1), at `wordsPerMinute`. |
| Filter `greet(name)` | `"Hello, Sasquatch"`, with the `greeting` option first. |
| Filter `tally(items, key)` | How many items have each value of `key`, in the order the values first appear: `tally(sightings, "creature")` is `{ "Sasquatch": 2, "elk": 1 }`. |
| Transform | Links to other sites (`https://`, `http://`, `//`) without a `rel` get `rel="external"` (the `externalRel` option; `""` turns it off). |

None of this needs Rust: a regex in JavaScript does the transform as fast. It's the shape to start from; the crate's README says when Rust pays.

## Using it

```js
// ssqch.config.js
import trailGuide from "ssqch-plugin-trail-guide";

export default {
  templateFormats: ["jinja", "md", "trail"],
  plugins: [trailGuide({ greeting: "Howdy", wordsPerMinute: 180 })],
};
```

```text
---
title: Cedar Trail
layout: base.jinja
---
0.0 Ranger station
1.2 Old Growth junction | Fork left for the falls.
2.4 Pine cone overlook
```

A mistake says where it is: `trailGuide({ greting: "Howdy" })` fails the build with ``plugin "trail-guide": options: unknown field `greting`, expected one of `greeting`, `wordsPerMinute`, `externalRel` ``, and a stop without a distance with `trail-guide: cedar.trail:5: a stop starts with its distance in miles` and the line.

## Building it

```sh
rustup target add wasm32-wasip1
cargo test -p ssqch-plugin-trail-guide                                     # as plain Rust
cargo build --release --target wasm32-wasip1 -p ssqch-plugin-trail-guide   # the .wasm file
```

In this repository, `node packages/ssqch/scripts/build-wasm.ts trail-guide` builds it and copies the file here, where it's committed so the tests run without Rust (`packages/ssqch/src/rust-plugin.test.ts`, and the oracle's `config/config.test.js` and `config/node.test.js`). A test fails when the Rust changes and the file isn't built again.

The npm package is `package.json`, `index.js` (the function a config calls, returning `{ name, rust: { wasm, options } }`) and `index.d.ts` (its types).
