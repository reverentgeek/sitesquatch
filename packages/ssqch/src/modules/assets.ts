// `ssqch/assets`: asset fingerprinting, from 0.7's `plugins/assets`.
//
//   import { assetsPlugin } from "ssqch/assets";
//
//   export default defineConfig({
//     plugins: [assetsPlugin({ files: ["/assets/index.css", "/assets/index.js"] })],
//   });
//
// Templates link the plain paths (`/assets/index.css`). In a production build, each listed file
// in the output folder (written there by a CSS or JS tool before the site build) is renamed to
// `name.<hash>.ext`, the hash being the first 8 hex characters of a BLAKE3 hash of its contents,
// and every `href` and `src` in HTML output that points at it is rewritten. Older fingerprinted
// copies of the same file are deleted, so the output doesn't collect stale versions.
//
// In development (`ssqch serve`), nothing is renamed, and pages use the plain paths a watcher
// keeps up to date. If a plain file isn't there but the last production build left one
// fingerprinted copy of it, pages link to that copy, so serving after a build still has styles.
//
// A listed file can be a passthrough copy (`passthrough: [{ "src/pco.js": "assets/pco.js" }]`):
// it's copied into the output before it's fingerprinted, since passthrough files are otherwise
// copied after pages. Static imports in inline module scripts (`import { setup } from
// "/assets/pco.js"`) are rewritten too, and so are `import("...")` calls with a plain string.
// Other references (`url()` in CSS, imports inside JavaScript files) aren't; for a hashed URL
// outside an HTML attribute, templates call `assetUrl("/assets/index.css")`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { blake3Hex } from "../blake3.ts";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { bail, warn, warning } from "../diagnostics.ts";
import { rewriteHtml } from "../html.ts";
import { displayPath } from "../paths.ts";
import { Options } from "./options.ts";

export function assetsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/assets", builtin: "ssqch/assets", options };
}

/** `index.css` is `["index", ".css"]`; a name without an extension has `""`. */
function splitName(name: string): [string, string] {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** The files in `dir` named `stem.<8 lowercase hex characters>ext`, sorted. */
function fingerprintedCopies(dir: string, stem: string, ext: string): string[] {
	let names: string[];
	try { names = fs.readdirSync(dir); } catch { return []; }
	const out: string[] = [];
	for (const name of names) {
		if (!name.startsWith(`${stem}.`) || !name.endsWith(ext)) continue;
		const hash = name.slice(stem.length + 1, name.length - ext.length);
		if (hash.length === 8 && /^[0-9a-f]{8}$/.test(hash) && name.length === stem.length + 1 + 8 + ext.length && fs.statSync(path.join(dir, name), { throwIfNoEntry: false })?.isFile()) out.push(path.join(dir, name));
	}
	return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Renames the file at URL path `file` in `output` to its fingerprinted name, deletes older
 * fingerprinted copies, and returns the new URL path. If the plain file is missing but one
 * fingerprinted copy is there (a second build without rebuilding the CSS), that copy is used.
 */
export function fingerprint(output: string, file: string): string {
	const plain = path.join(output, file.replace(/^\/+/, ""));
	const dir = path.dirname(plain);
	const name = path.basename(plain);
	const [stem, ext] = splitName(name);
	const copies = fingerprintedCopies(dir, stem, ext);
	let hashed: string;
	if (fs.statSync(plain, { throwIfNoEntry: false })?.isFile()) {
		let bytes: Buffer;
		try { bytes = fs.readFileSync(plain); } catch (e) { bail(`reading ${plain}: ${(e as Error).message}`); }
		hashed = `${stem}.${blake3Hex(bytes).slice(0, 8)}${ext}`;
		try { fs.renameSync(plain, path.join(dir, hashed)); } catch (e) { bail(`renaming ${plain} to ${hashed}: ${(e as Error).message}`); }
		for (const old of copies.filter((c) => path.basename(c) !== hashed)) {
			try { fs.rmSync(old); } catch (e) { bail(`removing ${old}: ${(e as Error).message}`); }
		}
	} else if (copies.length === 1) {
		hashed = path.basename(copies[0]);
	} else if (copies.length === 0) {
		bail(`${plain} doesn't exist; build the CSS and JS before ssqch`);
	} else {
		bail(`${plain} doesn't exist, and there are ${copies.length} fingerprinted copies of it; rebuild it`);
	}
	return file.slice(0, file.length - name.length) + hashed;
}

/** The URL path of the one fingerprinted copy of `file` in `output`, if there's exactly one (what a production build leaves behind). */
export function builtCopy(output: string, file: string): string | undefined {
	const plain = path.join(output, file.replace(/^\/+/, ""));
	const name = path.basename(plain);
	const [stem, ext] = splitName(name);
	const copies = fingerprintedCopies(path.dirname(plain), stem, ext);
	return copies.length === 1 ? file.slice(0, file.length - name.length) + path.basename(copies[0]) : undefined;
}

/** `sha384-<base64>`, for an `integrity` attribute. */
export function integrity(bytes: Uint8Array): string {
	return `sha384-${crypto.createHash("sha384").update(bytes).digest("base64")}`;
}

/** The source of a passthrough copy that lands at URL path `url`, if one does (not from a glob). */
function passthroughSource(config: Config, url: string): string | undefined {
	const root = config.root;
	const input = path.resolve(root, config.input);
	const output = path.resolve(root, config.output);
	const want = path.join(output, url.replace(/^\/+/, ""));
	const inside = (dir: string, p: string) => p.startsWith(dir + path.sep);
	for (const { from, to } of config.passthrough) {
		if (/[*?[{]/.test(from)) continue;
		const src = path.resolve(root, from);
		const dest = to !== undefined ? path.join(output, to) : path.join(output, inside(input, src) ? path.relative(input, src) : inside(root, src) ? path.relative(root, src) : src);
		const found = want === dest ? src : inside(dest, want) ? path.join(src, path.relative(dest, want)) : undefined;
		if (found !== undefined && (fs.statSync(found, { throwIfNoEntry: false })?.isFile() ?? false)) return found;
	}
	return undefined;
}

/** A URL without its query and fragment. */
const plainPath = (value: string) => value.split(/[?#]/)[0];

/**
 * `html` with `href` and `src` attributes that point at a fingerprinted path rewritten, keeping a
 * query or fragment, and `integrity` (from `sri`, by plain path) on the `<link>` and `<script>`
 * elements that load one.
 */
export function rewriteAssets(html: string, urls: Map<string, string>, sri: Map<string, string>): string {
	const rewrite = (value: string): string | undefined => {
		const at = value.search(/[?#]/);
		const [p, rest] = at === -1 ? [value, ""] : [value.slice(0, at), value.slice(at)];
		const url = urls.get(p);
		return url !== undefined && url !== p ? url + rest : undefined;
	};
	return rewriteHtml(html, {
		tag: (el) => {
			for (const attr of ["href", "src"]) {
				const value = el.get(attr);
				if (value === undefined) continue;
				const loads = (el.name === "link" && attr === "href") || (el.name === "script" && attr === "src");
				if (loads && el.get("integrity") === undefined) {
					const hash = sri.get(plainPath(value));
					if (hash !== undefined) el.set("integrity", hash);
				}
				const changed = rewrite(value);
				if (changed !== undefined) el.set(attr, changed);
			}
		},
		script: (el, js) => {
			const module = el.get("src") === undefined && el.get("type")?.trim().toLowerCase() === "module";
			return module ? rewriteImports(js, urls) : js;
		},
	});
}

const IMPORT = /(\bfrom\s*|\bimport\s*(?:\(\s*)?)(?:"([^"\n]*)"|'([^'\n]*)')/g;

/** A module script with its imports of fingerprinted files pointed at them: `import ... from "/assets/pco.js"`, `import "/assets/pco.js"`, `export ... from "..."` and `import("...")` with a plain string. */
export function rewriteImports(js: string, urls: Map<string, string>): string {
	if (!js.includes("import") && !js.includes("export")) return js;
	return js.replace(IMPORT, (whole, lead: string, double: string | undefined, single: string | undefined) => {
		const [quote, spec] = double !== undefined ? ["\"", double] : ["'", single!];
		const at = spec.search(/[?#]/);
		const [p, rest] = at === -1 ? [spec, ""] : [spec.slice(0, at), spec.slice(at)];
		const url = urls.get(p);
		return url !== undefined && url !== p ? `${lead}${quote}${url}${rest}${quote}` : whole;
	});
}

BUILTINS.set("ssqch/assets", (config, given) => {
	const o = new Options(given, ["files", "fingerprint", "integrity"]);
	const files = o.list("files") ?? [];
	if (!files.length) bail("files is required: the URL paths of the files to fingerprint, like [\"/assets/index.css\"]");
	const fingerprinting = o.bool("fingerprint");
	const withIntegrity = o.bool("integrity") ?? false;
	for (const file of files) {
		if (!file.startsWith("/") || file.endsWith("/") || file.includes("..")) bail(`files: "${file}" must be a URL path to a file, starting with / (like "/assets/index.css")`);
	}
	// Plain URL path to the URL this build uses, and to its `integrity` value; the names fingerprinted, for the summary.
	let urls = new Map<string, string>();
	let sri = new Map<string, string>();
	let names: string[] = [];
	// The plain paths a page has to mention for this build to change it: one that's fingerprinted or gets an `integrity`.
	let changing: string[] = [];

	config.beforeBuild.push({ label: "", fn: () => {
		const output = path.resolve(config.root, config.output);
		const shownOutput = displayPath(config.root, output);
		const enabled = fingerprinting ?? (config.env === "production" && !config.serving);
		const map = new Map<string, string>();
		const hashes = new Map<string, string>();
		const done: string[] = [];
		for (const file of files) {
			if (enabled) {
				// A passthrough file isn't in the output until after the pages are written.
				const src = passthroughSource(config, file);
				if (src !== undefined) {
					const plain = path.join(output, file.replace(/^\/+/, ""));
					fs.mkdirSync(path.dirname(plain), { recursive: true });
					try { fs.copyFileSync(src, plain); } catch (e) { bail(`copying ${src} to ${plain}: ${(e as Error).message}`); }
				}
				const hashed = fingerprint(output, file);
				if (withIntegrity) {
					const at = path.join(output, hashed.replace(/^\/+/, ""));
					let bytes: Buffer;
					try { bytes = fs.readFileSync(at); } catch (e) { bail(`reading ${at}: ${(e as Error).message}`); }
					hashes.set(file, integrity(bytes));
				}
				done.push(hashed.slice(hashed.lastIndexOf("/") + 1));
				map.set(file, hashed);
			} else if ((fs.statSync(path.join(output, file.replace(/^\/+/, "")), { throwIfNoEntry: false })?.isFile() ?? false) || passthroughSource(config, file) !== undefined) {
				map.set(file, file);
			} else {
				const copy = builtCopy(output, file);
				if (copy !== undefined) {
					warn(warning("assets", `${file} isn't in the output (${shownOutput}), so pages link to ${copy} from the last production build; run the tool that writes ${file} to see changes`));
					map.set(file, copy);
				} else {
					warn(warning("assets", `${file} isn't in the output yet (${shownOutput}); its tool may still be building it`));
					map.set(file, file);
				}
			}
		}
		urls = map;
		sri = hashes;
		names = done;
		changing = [...new Set([...[...map].filter(([plain, url]) => plain !== url).map(([plain]) => plain), ...hashes.keys()])];
	} });

	config.htmlTransforms.push(["assets", (content, info) => {
		if (path.extname(info.outputPath) !== ".html") return content;
		// Every change is to an attribute or an import that has one of those paths as it's
		// written, so a page that doesn't have one is left as it is without reading its tags.
		if (!changing.some((plain) => content.includes(plain))) return content;
		return rewriteAssets(content, urls, sri);
	}]);

	// Called with nothing, it's asked about "", as in 0.7.
	config.filters.set("assetUrl", (...given: unknown[]) => {
		const p = given.length === 0 ? "" : String(given[0]);
		const url = urls.get(p);
		// The files by path, as 0.7 listed them.
		if (url === undefined) bail(`assetUrl("${p}"): not one of the assets plugin's files (${[...urls.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(", ")})`);
		return url;
	});

	config.summaries.push(["Assets", () => (names.length ? `${names.length} fingerprinted (${names.join(", ")})` : undefined)]);
});
