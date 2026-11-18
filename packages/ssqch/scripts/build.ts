// Builds the npm package: what `npm publish` sends, in its own folder (`dist/` here by default).
//
//   node scripts/build.ts                 builds dist/, private (npm won't publish it)
//   node scripts/build.ts --out <dir>     somewhere else
//   node scripts/build.ts --release       publishable: the release workflow's build
//
// Node doesn't strip types from files under `node_modules`, so the package is JavaScript,
// bundled by esbuild with the template and Markdown libraries inside it: installing ssqch brings
// sharp (a native addon, which can't be bundled) and nothing else. The folder holds:
//
//   bin/ssqch.js     the command (bin/ssqch.ts)
//   lib/cli.js       the CLI, and lib/ssqch.js, lib/image.js, ...: the modules a config imports
//   lib/chunk-*.js   the code they share, so a config's `ssqch` and the build's are one module
//   wasm/, bundled/  the files ssqch reads beside its code, as they are in packages/ssqch
//   src/             the same for the files under src/ that aren't TypeScript (serve/live.js)
//   types/           the types, one file a module, cut from ssqch.d.ts (the `exports` map)
//
// Every output file is one folder down from the package's root, as `src/*.ts` is. That's what
// keeps the source's ways of finding a file beside it working: each file's `import.meta.url` is
// rewritten to the URL its source would have in the package (`src/engines/markdown.ts`), so
// `new URL("../../wasm/markdown.wasm", import.meta.url)` finds `wasm/` from wherever esbuild
// put the code. And `createRequire(import.meta.url)("liquidjs")`, how an engine loads its
// library on first use, becomes a `require` that esbuild bundles and still runs on first use.
//
// `node bin/ssqch.ts` keeps running the source as it is; this is only for the package.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Plugin } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE = path.dirname(here);
export const REPO = path.resolve(PACKAGE, "../..");

/** The packages the published package depends on: what can't be bundled. sharp is a native addon (D4). */
export const EXTERNAL = ["sharp"];

/** A module a config imports, by its name in the package (`lib/<name>.js`): `ssqch` is `ssqch`, `ssqch/image` is `image`. */
export const moduleFile = (specifier: string): string => (specifier === "ssqch" ? "ssqch" : specifier.slice("ssqch/".length));

/**
 * One of ssqch's own source files, as esbuild bundles it: `rel` is its path from the package's
 * root (`src/engines/markdown.ts`). Throws for what the package couldn't run.
 */
export function rewriteSource(text: string, rel: string): string {
	const strip = (s: string) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
	const other = /\bimport\.meta\.(dirname|filename)\b/.exec(strip(text));
	if (other) throw new Error(`${rel}: import.meta.${other[1]} can't be rewritten for the package; use fileURLToPath(new URL(".", import.meta.url)) instead`);
	// A library loaded on first use: esbuild bundles a `require`, and wraps the library so it
	// still loads only when it's called. External packages (sharp) are required from node_modules.
	let out = text.replace(/\bcreateRequire\(import\.meta\.url\)\(/g, "require(");
	if (/\bcreateRequire\(import\.meta\.url\)/.test(strip(out))) throw new Error(`${rel}: createRequire(import.meta.url) has to be called at once, as createRequire(import.meta.url)("name"), for the package to bundle the library`);
	const url = `new URL(${JSON.stringify(`../${rel}`)}, import.meta.url).href`;
	out = out.replace(/\bimport\.meta\.url\b/g, url);
	return out;
}

/** The esbuild plugin that applies `rewriteSource` to ssqch's own files (not the libraries'). */
export function sourcePlugin(): Plugin {
	const own = [path.join(PACKAGE, "src") + path.sep, path.join(PACKAGE, "bin") + path.sep];
	return {
		name: "ssqch-source",
		setup(build) {
			build.onLoad({ filter: /\.ts$/ }, (args) => {
				if (!own.some((dir) => args.path.startsWith(dir))) return undefined;
				const rel = path.relative(PACKAGE, args.path).split(path.sep).join("/");
				return { contents: rewriteSource(fs.readFileSync(args.path, "utf8"), rel), loader: "ts" };
			});
		},
	};
}

/** The modules a config imports (`ssqch`, `ssqch/image`, ...), from ssqch.d.ts, and the source of each. */
export function ownModules(): Array<{ specifier: string; source: string }> {
	const dts = fs.readFileSync(path.join(PACKAGE, "bundled/ssqch.d.ts"), "utf8");
	const out: Array<{ specifier: string; source: string }> = [];
	for (const [, specifier] of dts.matchAll(/^declare module "([^"]+)" \{$/gm)) {
		const source = specifier === "ssqch" ? "src/api.ts" : `src/modules/${moduleFile(specifier)}.ts`;
		if (!fs.existsSync(path.join(PACKAGE, source))) throw new Error(`ssqch.d.ts declares "${specifier}", and ${source} isn't there`);
		out.push({ specifier, source });
	}
	return out;
}

interface Built {
	out: string;
	version: string;
	files: number;
	bytes: number;
}

/** Builds the package into `out` (emptied first). */
export async function buildPackage({ out, release = false, quiet = false }: { out: string; release?: boolean; quiet?: boolean }): Promise<Built> {
	const { build } = await import("esbuild");
	const source = JSON.parse(fs.readFileSync(path.join(PACKAGE, "package.json"), "utf8"));
	const version: string = source.version;
	if (release && /-dev\b/.test(version)) throw new Error(`package.json: version ${version} is a development version; set the release's version first`);
	fs.rmSync(out, { recursive: true, force: true });
	fs.mkdirSync(out, { recursive: true });

	const modules = ownModules();
	const entryPoints = [
		{ in: path.join(PACKAGE, "bin/ssqch.ts"), out: "bin/ssqch" },
		{ in: path.join(PACKAGE, "src/cli.ts"), out: "lib/cli" },
		...modules.map(({ specifier, source }) => ({ in: path.join(PACKAGE, source), out: `lib/${moduleFile(specifier)}` })),
	];
	const result = await build({
		entryPoints,
		outdir: out,
		bundle: true,
		splitting: true,
		format: "esm",
		platform: "node",
		target: "node22.18",
		chunkNames: "lib/chunk-[hash]",
		external: EXTERNAL,
		// What esbuild's `require` falls back to for an external package, which an ES module
		// doesn't have otherwise.
		banner: { js: `import { createRequire as __ssqchCreateRequire } from "node:module";\nconst require = __ssqchCreateRequire(import.meta.url);` },
		plugins: [sourcePlugin()],
		legalComments: "linked",
		logLevel: quiet ? "error" : "warning",
		metafile: true,
	});
	if (result.errors.length) throw new Error("esbuild failed");
	// The first line of bin/ssqch.js is its shebang, as in the source.
	const bin = path.join(out, "bin/ssqch.js");
	const text = fs.readFileSync(bin, "utf8");
	if (!text.startsWith("#!")) fs.writeFileSync(bin, `#!/usr/bin/env node\n${text}`);
	fs.chmodSync(bin, 0o755);

	copyTree(path.join(PACKAGE, "wasm"), path.join(out, "wasm"), (name) => name.endsWith(".wasm"));
	// The files the code reads beside its source (the dev server's live-reload script and its
	// 404 page), where the rewritten `import.meta.url` looks for them.
	copyTree(path.join(PACKAGE, "src"), path.join(out, "src"), (name) => !name.endsWith(".ts"));
	copyTree(path.join(PACKAGE, "bundled"), path.join(out, "bundled"));
	fs.copyFileSync(path.join(REPO, "LICENSE"), path.join(out, "LICENSE"));
	fs.copyFileSync(path.join(PACKAGE, "README.md"), path.join(out, "README.md"));
	writeTypes(path.join(out, "types"));

	const dependencies: Record<string, string> = {};
	for (const name of EXTERNAL) {
		const pinned = source.dependencies?.[name];
		if (!pinned) throw new Error(`package.json: ${name} is external to the bundle, so it has to be a dependency`);
		dependencies[name] = pinned;
	}
	const exports: Record<string, unknown> = {};
	for (const { specifier } of modules) {
		const name = moduleFile(specifier);
		const types = name === "ssqch" ? "index" : name;
		exports[specifier === "ssqch" ? "." : `./${name}`] = { types: `./types/${types}.d.ts`, default: `./lib/${name}.js` };
	}
	exports["./package.json"] = "./package.json";
	const manifest = {
		name: "ssqch",
		version,
		...(release ? {} : { private: true }),
		description: "SiteSquatch (ssqch): a fast static site generator, configured with JavaScript",
		keywords: ["static site generator", "ssg", "blog", "markdown", "jinja", "nunjucks", "liquid", "edge"],
		homepage: "https://github.com/reverentgeek/sitesquatch#readme",
		repository: { type: "git", url: "git+https://github.com/reverentgeek/sitesquatch.git", directory: "packages/ssqch" },
		bugs: "https://github.com/reverentgeek/sitesquatch/issues",
		license: "MIT",
		type: "module",
		bin: { ssqch: "bin/ssqch.js" },
		types: "./types/index.d.ts",
		exports,
		files: ["bin", "lib", "src", "types", "wasm", "bundled"],
		engines: { node: source.engines.node },
		dependencies,
	};
	fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);

	// Third-party code that looks for files beside itself would look in lib/, where there are none.
	for (const [file, info] of Object.entries(result.metafile.outputs)) {
		for (const input of Object.keys(info.inputs)) {
			if (!input.includes("node_modules")) continue;
			const code = fs.readFileSync(path.join(PACKAGE, input), "utf8");
			if (/\bimport\.meta\.(url|dirname|filename)\b|\b__dirname\b|\b__filename\b/.test(code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""))) {
				if (!KNOWN_LOOKUPS.some((known) => input.replaceAll("\\", "/").includes(known))) throw new Error(`${input} (in ${file}) finds files beside itself, which the bundle moves: check it, and list it in KNOWN_LOOKUPS with why it's fine`);
			}
		}
	}

	const { files, bytes } = sizeOf(out);
	if (!quiet) console.log(`Built ${shown(out)}: ssqch ${version}${release ? "" : " (private)"}, ${files} files, ${(bytes / 1e6).toFixed(2)} MB`);
	return { out, version, files, bytes };
}

/**
 * Libraries in the bundle that mention their own folder, and why that's fine. Each is checked by
 * hand: the bundle moves them into lib/, where nothing they'd look for is.
 */
const KNOWN_LOOKUPS = [
	// nunjucks' FileSystemLoader resolves a site's template folders, not its own; `__dirname` is in its precompile and Express code.
	"vendor/nunjucks/",
	// Only to name a template in errors (`__filename` of the compiled template's function).
	"node_modules/ejs/",
	// `require.extensions` for `.hbs` files, which ssqch never requires.
	"node_modules/handlebars/",
];

/** A path as a message shows it: from here when it's below here, whole otherwise. */
export function shown(file: string): string {
	const rel = path.relative(process.cwd(), file);
	return rel === "" ? "." : rel.startsWith("..") || path.isAbsolute(rel) ? file : rel;
}

function copyTree(from: string, to: string, keep: (name: string) => boolean = () => true): void {
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dest = path.join(to, entry.name);
		if (entry.isDirectory()) copyTree(src, dest, keep);
		else if (keep(entry.name)) {
			fs.mkdirSync(to, { recursive: true });
			fs.copyFileSync(src, dest);
		}
	}
}

/**
 * The types, one file a module, from ssqch.d.ts (what `ssqch types` writes): `types/index.d.ts`
 * for `ssqch`, `types/image.d.ts` for `ssqch/image`, and `types/globals.d.ts` for what comes
 * before the modules (the parts of Node's `process` ssqch describes). Editors, TypeScript and
 * ESLint find them through the `exports` map.
 */
function writeTypes(dir: string): void {
	const dts = fs.readFileSync(path.join(PACKAGE, "bundled/ssqch.d.ts"), "utf8").split("\n");
	const first = dts.findIndex((line) => line.startsWith("declare module "));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "globals.d.ts"), `${dts.slice(0, first).join("\n").trimEnd()}\n`);
	for (let i = first; i < dts.length; i++) {
		const open = /^declare module "([^"]+)" \{$/.exec(dts[i]);
		if (!open) continue;
		const end = dts.findIndex((line, j) => j > i && line === "}");
		if (end < 0) throw new Error(`ssqch.d.ts: declare module "${open[1]}" has no closing brace`);
		const name = open[1] === "ssqch" ? "index" : moduleFile(open[1]);
		const body = dts.slice(i + 1, end).map((line) => line.replace(/^\t/, "")).join("\n");
		fs.writeFileSync(path.join(dir, `${name}.d.ts`), `// ${open[1]}: from ssqch.d.ts, the types \`ssqch types\` writes.\n/// <reference path="./globals.d.ts" />\n${body}\n`);
		i = end;
	}
}

function sizeOf(dir: string): { files: number; bytes: number } {
	let files = 0;
	let bytes = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue;
		files++;
		bytes += fs.statSync(path.join(entry.parentPath, entry.name)).size;
	}
	return { files, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({ options: { out: { type: "string" }, release: { type: "boolean" } } });
	await buildPackage({ out: path.resolve(values.out ?? path.join(PACKAGE, "dist")), release: values.release });
}
