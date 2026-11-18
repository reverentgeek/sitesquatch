// `ssqch/minify`: HTML minification, by ssqch's own minifier (0.7's `plugins/minify`), built as
// WebAssembly (`wasm/minify.wasm`, from `crates/ssqch-minify`) so a page comes out as 0.7
// minified it. The wasm is an ssqch Rust plugin, loaded as a site's own Rust plugins are.
//
//   minifyPlugin({ removeComments: false })   minifies every HTML page, after the image transform
//   minify(html, { collapseWhitespace: false }) one string of HTML
//
// Options, all on by default: collapseWhitespace, removeComments, shortDoctype and
// shortenAttributes. Sites from Eleventy that want html-minifier-terser's bytes keep it as a
// transform of their own.
import { fileURLToPath } from "node:url";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { BuildError } from "../diagnostics.ts";
import { RustPlugin, compilePlugin } from "../rust-plugin.ts";
import { closest } from "../suggest.ts";
import { Options } from "./options.ts";

const OPTIONS = ["collapseWhitespace", "removeComments", "shortDoctype", "shortenAttributes"];

/** The file, next to `src/`. */
const WASM_FILE = fileURLToPath(new URL("../../wasm/minify.wasm", import.meta.url));

/** The minifier with `options` (checked already). */
function minifier(options: Record<string, boolean>): RustPlugin {
	return new RustPlugin(compilePlugin(WASM_FILE, WASM_FILE), options, WASM_FILE);
}

let shared: RustPlugin | undefined;

export function minifyPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/minify", builtin: "ssqch/minify", options };
}

/** Minify one string of HTML, with the plugin's options. */
export function minify(html: unknown, options: Record<string, unknown> = {}): string {
	for (const key of Object.keys(options)) {
		if (!OPTIONS.includes(key)) {
			const meant = closest(key, OPTIONS);
			throw new TypeError(`minify(): unknown option "${key}"${meant ? ` (did you mean "${meant}"?)` : ""} (options: ${OPTIONS.join(", ")})`);
		}
	}
	const { collapseWhitespace = true, removeComments = true, shortDoctype = true, shortenAttributes = true } = options;
	const on = { collapseWhitespace: Boolean(collapseWhitespace), removeComments: Boolean(removeComments), shortDoctype: Boolean(shortDoctype), shortenAttributes: Boolean(shortenAttributes) };
	shared ??= minifier({});
	try {
		return shared.filter("minify", [String(html), on]) as string;
	} catch (e) {
		throw e instanceof BuildError ? new Error(`minify(): ${e.message}`) : e;
	}
}

BUILTINS.set("ssqch/minify", (config: Config, given) => {
	const o = new Options(given, OPTIONS);
	const on: Record<string, boolean> = {};
	for (const key of OPTIONS) {
		const value = o.bool(key);
		if (value !== undefined) on[key] = value;
	}
	const plugin = minifier(on);
	// HTML pages only (0.7's `is_html`: the output file's extension is `.html`).
	config.transforms.push(["minify-html", (content, page) => (page.outputPath.endsWith(".html") ? plugin.transform(content, page) ?? content : content)]);
});
