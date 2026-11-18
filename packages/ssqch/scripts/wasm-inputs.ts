// What each committed `.wasm` file is built from, as one hash: the Rust files (for Markdown,
// 0.7's markdown.rs, highlight.rs and suggest.rs, the crate around them, and sitesquatch-edge,
// whose Value they use), the wasm profile, and the versions of the crates in Cargo.lock it
// depends on. The build script puts the hash in the file (a custom section), and a test
// compares it with the files, so a change to the Rust that isn't built into the committed file
// fails without needing Rust.
//
// The workspace's own version isn't in it: a release changes that, and not the wasm.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { WebAssembly } from "../src/engines/webassembly.ts";

/** The repository's root. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The command that builds the files again. */
export const REBUILD = "node packages/ssqch/scripts/build-wasm.ts";

/** A `.wasm` file the repository commits, and what it's built from. */
export interface WasmBuild {
	/** What `build-wasm.ts <name>` builds. */
	name: string;
	/** The Cargo package. */
	crate: string;
	/** The built file, committed, from the repository's root. */
	file: string;
	/** The custom section that holds the hash. */
	section: string;
	/**
	 * How the hash gets into the file: an environment variable the crate puts in its section
	 * (`option_env!`), or added to the built file by the script, for a crate that's an example
	 * and stays a plain plugin.
	 */
	env?: string;
	/** Files and folders (their `.rs` files) the hash covers, from the repository's root. */
	files: string[];
	folders: string[];
	/** Cargo's profile, and a `--release` build's folder name for it. */
	profile: "wasm" | "release";
}

export const BUILDS: WasmBuild[] = [
	{
		name: "markdown",
		crate: "ssqch-markdown",
		file: "packages/ssqch/wasm/markdown.wasm",
		section: "ssqch_markdown_inputs",
		env: "SSQCH_MARKDOWN_INPUTS",
		files: ["crates/sitesquatch/src/markdown.rs", "crates/sitesquatch/src/highlight.rs", "crates/sitesquatch/src/suggest.rs", "crates/ssqch-markdown/Cargo.toml", "crates/sitesquatch-edge/Cargo.toml"],
		folders: ["crates/ssqch-markdown/src", "crates/sitesquatch-edge/src"],
		profile: "wasm",
	},
	{
		name: "minify",
		crate: "ssqch-minify",
		file: "packages/ssqch/wasm/minify.wasm",
		section: "ssqch_minify_inputs",
		env: "SSQCH_MINIFY_INPUTS",
		files: ["plugins/minify/src/lib.rs", "crates/ssqch-minify/Cargo.toml", "crates/ssqch-plugin/Cargo.toml"],
		folders: ["crates/ssqch-minify/src", "crates/ssqch-plugin/src"],
		profile: "wasm",
	},
	{
		name: "trail-guide",
		crate: "ssqch-plugin-trail-guide",
		file: "examples/rust-plugin/trail_guide.wasm",
		section: "ssqch_example_inputs",
		files: ["examples/rust-plugin/Cargo.toml", "crates/ssqch-plugin/Cargo.toml"],
		folders: ["examples/rust-plugin/src", "crates/ssqch-plugin/src"],
		profile: "release",
	},
];

/** The build named `name`. */
export function wasmBuild(name: string): WasmBuild {
	const found = BUILDS.find((b) => b.name === name);
	if (!found) throw new Error(`no .wasm named ${name} (${BUILDS.map((b) => b.name).join(", ")})`);
	return found;
}

export function inputsHash(build: WasmBuild = BUILDS[0], repo = REPO): string {
	const hash = crypto.createHash("sha256");
	const add = (label: string, text: string) => hash.update(`${label}\n${text.replaceAll("\r\n", "\n")}\n`);
	const files = [...build.files];
	for (const folder of build.folders) {
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
				const rel = `${dir}/${entry.name}`;
				if (entry.isDirectory()) walk(rel);
				else if (entry.name.endsWith(".rs")) files.push(rel);
			}
		};
		walk(folder);
	}
	// Sorted as text, so every system lists them alike.
	for (const file of files.sort()) add(file, fs.readFileSync(path.join(repo, file), "utf8"));

	const workspace = parse(fs.readFileSync(path.join(repo, "Cargo.toml"), "utf8")) as Record<string, any>;
	add(`profile.${build.profile}`, JSON.stringify(workspace.profile?.[build.profile] ?? null));
	const lock = parse(fs.readFileSync(path.join(repo, "Cargo.lock"), "utf8")) as { package: Array<{ name: string; version: string; source?: string; checksum?: string; dependencies?: string[] }> };
	// The crates this one depends on, from the lockfile.
	const byName = new Map<string, typeof lock.package>();
	for (const p of lock.package) byName.set(p.name, [...(byName.get(p.name) ?? []), p]);
	const seen = new Set<(typeof lock.package)[number]>();
	const visit = (dependency: string) => {
		const [name, version] = dependency.split(" ");
		for (const p of byName.get(name) ?? []) {
			if ((version === undefined || p.version === version) && !seen.has(p)) {
				seen.add(p);
				for (const d of p.dependencies ?? []) visit(d);
			}
		}
	};
	visit(build.crate);
	const used = [...seen].map((p) => (p.source === undefined ? `${p.name} (path)` : `${p.name} ${p.version} ${p.source} ${p.checksum ?? ""}`)).sort();
	add("Cargo.lock", used.join("\n"));
	// How the workspace declares the ones it shares (`serde_json`'s features, say).
	const declared = workspace.workspace?.dependencies ?? {};
	add("workspace.dependencies", JSON.stringify([...seen].map((p) => p.name).filter((name) => name in declared).sort().map((name) => [name, { ...declared[name], version: declared[name].path ? undefined : declared[name].version }])));
	return hash.digest("hex");
}

/** The hash a built file holds, or `undefined` for a file without one. */
export function builtHash(wasm: Uint8Array, section = BUILDS[0].section): string | undefined {
	const sections = WebAssembly.Module.customSections(new WebAssembly.Module(wasm), section);
	return sections.length ? Buffer.from(sections[sections.length - 1]).toString("utf8") : undefined;
}

/** `wasm` with a custom section `name` holding `text` added at its end (where a custom section may be). */
export function withSection(wasm: Uint8Array, name: string, text: string): Buffer {
	const leb = (n: number) => {
		const out: number[] = [];
		do {
			let byte = n & 0x7f;
			n >>>= 7;
			if (n !== 0) byte |= 0x80;
			out.push(byte);
		} while (n !== 0);
		return out;
	};
	const nameBytes = Buffer.from(name, "utf8");
	const body = Buffer.concat([Buffer.from(leb(nameBytes.length)), nameBytes, Buffer.from(text, "utf8")]);
	return Buffer.concat([wasm, Buffer.from([0, ...leb(body.length)]), body]);
}
