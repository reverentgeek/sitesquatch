// `ssqch/minify`: HTML minification, by ssqch's own minifier (0.7's `plugins/minify`), built as
// WebAssembly (`wasm/minify.wasm`, from `crates/ssqch-minify`) so a page comes out as 0.7
// minified it. The wasm is an ssqch Rust plugin, loaded as a site's own Rust plugins are.
//
//   minifyPlugin({ removeComments: false })   minifies every HTML page, after the image transform
//   minify(html, { collapseWhitespace: false }) one string of HTML
//
// Options on by default: collapseWhitespace, removeComments, shortDoctype and shortenAttributes.
// Off by default, as html-minifier's are: css (each `<style>` compressed by ssqch's Sass), and
// xml and json (the output's other files). Sites from Eleventy that want html-minifier-terser's
// bytes keep it as a transform of their own.
import { fileURLToPath } from "node:url";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { BuildError, messageOf, warn, warning } from "../diagnostics.ts";
import { RustPlugin, compilePlugin } from "../rust-plugin.ts";
import { displayPath } from "../paths.ts";
import { closest } from "../suggest.ts";
import { Options } from "./options.ts";
import { compressCss } from "./sass.ts";

const OPTIONS = ["collapseWhitespace", "removeComments", "shortDoctype", "shortenAttributes"];
/** The plugin's own options, which the minifier's wasm doesn't take. */
const MORE = ["css", "xml", "json"];

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

/** CSS text compressed, as `<style>` elements are with `minifyPlugin({ css: true })`. Sass's own syntax, and CSS ssqch's Sass can't read (native nesting among it), is an error. */
export function minifyCss(css: unknown): string {
	try {
		return compressCss(String(css ?? ""), "minifyCss()");
	} catch (e) {
		throw new Error(messageOf(e));
	}
}

const STYLE = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;

/** A page's `<style>` elements compressed. One ssqch's Sass can't read stays as it is, and says so once for the page. */
function minifyStyles(html: string, page: string): string {
	if (!/<style\b/i.test(html)) return html;
	let warned = false;
	return html.replace(STYLE, (whole, open: string, css: string, close: string) => {
		// Only CSS: a `type` that isn't (a template's `text/x-template`) stays.
		const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(open)?.[1];
		if ((type !== undefined && type.toLowerCase() !== "text/css") || css.trim() === "") return whole;
		try {
			return `${open}${compressCss(css, `${page} <style>`)}${close}`;
		} catch (e) {
			if (!warned) {
				warned = true;
				warn(warning("build", `minify: a <style> in ${page} stays as it is, because ssqch's Sass can't read it: ${messageOf(e).split("\n")[0]}`, { file: page }));
			}
			return whole;
		}
	});
}

/** XML with the whitespace between its tags out (not inside text, CDATA or a comment): a feed, a sitemap. */
export function minifyXml(xml: string): string {
	const parts = xml.split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/);
	const out = parts.map((part, i) => (i % 2 === 1 ? part : part.replace(/>\s+</g, "><"))).join("").trim();
	return xml.endsWith("\n") ? `${out}\n` : out;
}

/** JSON written without spaces, its values as they were; text that isn't JSON stays as it is. */
export function minifyJson(json: string): string {
	try {
		return JSON.stringify(JSON.parse(json)) + (json.endsWith("\n") ? "\n" : "");
	} catch {
		return json;
	}
}

BUILTINS.set("ssqch/minify", (config: Config, given) => {
	const o = new Options(given, [...OPTIONS, ...MORE]);
	const on: Record<string, boolean> = {};
	for (const key of OPTIONS) {
		const value = o.bool(key);
		if (value !== undefined) on[key] = value;
	}
	const [css, xml, json] = MORE.map((key) => o.bool(key) === true);
	const plugin = minifier(on);
	const shown = (outputPath: string) => displayPath(config.root, outputPath);
	// HTML pages (0.7's `is_html`: the output file's extension is `.html`), and with `xml` and
	// `json`, those files.
	config.transforms.push(["minify-html", (content, page) => {
		if (page.outputPath.endsWith(".html")) {
			const html = plugin.transform(content, page) ?? content;
			return css ? minifyStyles(html, shown(page.outputPath)) : html;
		}
		if (xml && /\.(?:xml|rss|atom)$/.test(page.outputPath)) return minifyXml(content);
		if (json && /\.(?:json|webmanifest)$/.test(page.outputPath)) return minifyJson(content);
		return content;
	}]);
});
