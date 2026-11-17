// Builds ssqch's Markdown and highlighter (crates/ssqch-markdown) for wasm32-wasip1 and puts it
// at packages/ssqch/wasm/markdown.wasm, which is committed: the Node build runs from a clone
// with `npm ci` and nothing else, and CI's Node jobs have no Rust. Run it after changing the
// Rust the file is built from (`wasm-inputs.ts` lists it); a test fails until then.
//
//   node packages/ssqch/scripts/build-wasm.ts
//
// It needs Rust and the target: `rustup target add wasm32-wasip1`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, WASM, builtHash, inputsHash } from "./wasm-inputs.ts";

const hash = inputsHash();
const cargo = spawnSync("cargo", ["build", "--locked", "--profile", "wasm", "-p", "ssqch-markdown", "--target", "wasm32-wasip1"], {
	cwd: REPO,
	stdio: "inherit",
	env: { ...process.env, SSQCH_MARKDOWN_INPUTS: hash },
});
if (cargo.error) throw cargo.error;
if (cargo.status !== 0) process.exit(cargo.status ?? 1);

const built = path.join(process.env.CARGO_TARGET_DIR ? path.resolve(REPO, process.env.CARGO_TARGET_DIR) : path.join(REPO, "target"), "wasm32-wasip1", "wasm", "ssqch_markdown.wasm");
const bytes = fs.readFileSync(built);
if (builtHash(bytes) !== hash) throw new Error(`${built} doesn't hold the hash of its inputs; was it built by this script?`);
const to = WASM;
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.writeFileSync(to, bytes);
console.log(`Wrote ${path.relative(REPO, to).split(path.sep).join("/")} (${(bytes.length / 1e6).toFixed(2)} MB, inputs ${hash.slice(0, 12)})`);
