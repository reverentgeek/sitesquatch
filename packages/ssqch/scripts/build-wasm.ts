// Builds the Rust the Node build runs as WebAssembly, for wasm32-wasip1, and puts each file where
// it's committed (`wasm-inputs.ts` lists them): ssqch's Markdown and highlighter
// (crates/ssqch-markdown, packages/ssqch/wasm/markdown.wasm), its minifier (crates/ssqch-minify,
// wasm/minify.wasm), its Sass (crates/ssqch-sass, wasm/sass.wasm), and the example Rust plugin
// (examples/rust-plugin/trail_guide.wasm). They're committed so the Node build runs from a clone
// with `npm ci` and nothing else, and CI's Node jobs have no Rust. Run it after changing the Rust
// a file is built from; a test fails until then.
//
//   node packages/ssqch/scripts/build-wasm.ts            all of them
//   node packages/ssqch/scripts/build-wasm.ts minify     one (markdown, minify, sass, trail-guide)
//
// It needs Rust and the target: `rustup target add wasm32-wasip1`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BUILDS, REPO, builtHash, inputsHash, wasmBuild, withSection } from "./wasm-inputs.ts";

const wanted = process.argv.slice(2);
for (const build of wanted.length ? wanted.map(wasmBuild) : BUILDS) {
	const hash = inputsHash(build);
	const env: Record<string, string | undefined> = { ...process.env };
	if (build.env) env[build.env] = hash;
	const cargo = spawnSync("cargo", ["build", "--locked", "--profile", build.profile, "-p", build.crate, "--target", "wasm32-wasip1"], { cwd: REPO, stdio: "inherit", env });
	if (cargo.error) throw cargo.error;
	if (cargo.status !== 0) process.exit(cargo.status ?? 1);

	const target = process.env.CARGO_TARGET_DIR ? path.resolve(REPO, process.env.CARGO_TARGET_DIR) : path.join(REPO, "target");
	const built = path.join(target, "wasm32-wasip1", build.profile, `${build.crate.replaceAll("-", "_")}.wasm`);
	let bytes: Buffer = fs.readFileSync(built);
	// An example plugin is a plain plugin: its hash is added to the file here.
	if (!build.env) bytes = withSection(bytes, build.section, hash);
	if (builtHash(bytes, build.section) !== hash) throw new Error(`${built} doesn't hold the hash of its inputs; was it built by this script?`);
	const to = path.join(REPO, build.file);
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.writeFileSync(to, bytes);
	console.log(`Wrote ${build.file} (${(bytes.length / 1e6).toFixed(2)} MB, inputs ${hash.slice(0, 12)})`);
}
