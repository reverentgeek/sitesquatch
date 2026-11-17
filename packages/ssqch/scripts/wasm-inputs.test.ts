import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REBUILD, WASM, builtHash, inputsHash } from "./wasm-inputs.ts";

test("the committed markdown.wasm is built from the Rust as it is", () => {
	const built = builtHash(fs.readFileSync(WASM));
	assert.equal(built, inputsHash(), `packages/ssqch/wasm/markdown.wasm wasn't built from the Rust in crates/ as it is now (crates/ssqch-markdown, 0.7's markdown.rs and highlight.rs, or Cargo.lock changed): rebuild the wasm: ${REBUILD}`);
});
