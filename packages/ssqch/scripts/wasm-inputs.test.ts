import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUILDS, REBUILD, REPO, builtHash, inputsHash, withSection } from "./wasm-inputs.ts";

for (const build of BUILDS) {
	test(`the committed ${path.basename(build.file)} is built from the Rust as it is`, () => {
		const built = builtHash(fs.readFileSync(path.join(REPO, build.file)), build.section);
		assert.equal(built, inputsHash(build), `${build.file} wasn't built from the Rust in the repository as it is now (${build.crate}, what it compiles by path, or Cargo.lock changed): rebuild the wasm: ${REBUILD} ${build.name}`);
	});
}

test("a section added to a built file is read back", () => {
	// The smallest module: the magic number and version 1.
	const empty = Buffer.from("0061736d01000000", "hex");
	const long = "x".repeat(300);
	assert.equal(builtHash(withSection(empty, "ssqch_test", long), "ssqch_test"), long);
	assert.equal(builtHash(empty, "ssqch_test"), undefined);
});
