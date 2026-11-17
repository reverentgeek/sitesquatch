// What `wasm/markdown.wasm` is built from, as one hash: the Rust files (0.7's markdown.rs,
// highlight.rs and suggest.rs, the crate around them, and sitesquatch-edge, whose Value they
// use), the wasm profile, and the versions of the crates in Cargo.lock it depends on. The build
// script puts the hash in the file (a custom section), and a test compares it with the files, so
// a change to the Rust that isn't built into the committed file fails without needing Rust.
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

/** The custom section that holds the hash. */
export const SECTION = "ssqch_markdown_inputs";

/** The built file, committed. */
export const WASM = path.join(REPO, "packages/ssqch/wasm/markdown.wasm");

/** The command that builds the file again. */
export const REBUILD = "node packages/ssqch/scripts/build-wasm.ts";

const FILES = ["crates/sitesquatch/src/markdown.rs", "crates/sitesquatch/src/highlight.rs", "crates/sitesquatch/src/suggest.rs", "crates/ssqch-markdown/Cargo.toml", "crates/sitesquatch-edge/Cargo.toml"];
const FOLDERS = ["crates/ssqch-markdown/src", "crates/sitesquatch-edge/src"];

export function inputsHash(repo = REPO): string {
	const hash = crypto.createHash("sha256");
	const add = (label: string, text: string) => hash.update(`${label}\n${text.replaceAll("\r\n", "\n")}\n`);
	const files = [...FILES];
	for (const folder of FOLDERS) {
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
	add("profile.wasm", JSON.stringify(workspace.profile?.wasm ?? null));
	const lock = parse(fs.readFileSync(path.join(repo, "Cargo.lock"), "utf8")) as { package: Array<{ name: string; version: string; source?: string; checksum?: string; dependencies?: string[] }> };
	// The crates ssqch-markdown depends on, from the lockfile.
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
	visit("ssqch-markdown");
	const used = [...seen].map((p) => (p.source === undefined ? `${p.name} (path)` : `${p.name} ${p.version} ${p.source} ${p.checksum ?? ""}`)).sort();
	add("Cargo.lock", used.join("\n"));
	// How the workspace declares the ones it shares (`serde_json`'s features, say).
	const declared = workspace.workspace?.dependencies ?? {};
	add("workspace.dependencies", JSON.stringify([...seen].map((p) => p.name).filter((name) => name in declared).sort().map((name) => [name, { ...declared[name], version: declared[name].path ? undefined : declared[name].version }])));
	return hash.digest("hex");
}

/** The hash a built file holds, or `undefined` for a file without one. */
export function builtHash(wasm: Uint8Array): string | undefined {
	const sections = WebAssembly.Module.customSections(new WebAssembly.Module(wasm), SECTION);
	return sections.length ? Buffer.from(sections[0]).toString("utf8") : undefined;
}
