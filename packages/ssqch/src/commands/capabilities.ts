// `ssqch capabilities`: what this build can do. A script or a coding agent asks instead of
// guessing from documentation for another version. Ported from `crates/ssqch/src/capabilities.rs`.
import { CONFIG_FILES, DEFAULTS, configOptions } from "../config.ts";
import { red } from "../diagnostics.ts";
import { VERSION } from "../version.ts";
import { starterEngines } from "./init.ts";

/** The names each module exports, in the order `ssqch.d.ts` declares them. `capabilities.test.ts` checks each is a function the module has. */
export const MODULE_EXPORTS: ReadonlyArray<readonly [name: string, exports: readonly string[]]> = [
	["ssqch", ["defineConfig", "markdown", "readData", "files", "slugify", "slugger", "safe"]],
	["ssqch/image", ["imagePlugin", "image", "imageUrl"]],
	["ssqch/rss", ["rssPlugin", "getNewestCollectionItemDate", "dateToRfc3339", "dateToRfc822", "absoluteUrl", "htmlToAbsoluteUrls", "feedHtml"]],
	["ssqch/assets", ["assetsPlugin"]],
	["ssqch/links", ["linksPlugin"]],
	["ssqch/sitemap", ["sitemapPlugin"]],
	["ssqch/redirects", ["redirectsPlugin"]],
	["ssqch/sass", ["sassPlugin"]],
	["ssqch/elements", ["elementsPlugin"]],
	["ssqch/minify", ["minifyPlugin", "minify", "minifyCss"]],
	["ssqch/llms", ["llmsPlugin"]],
	["ssqch/robots", ["robotsPlugin"]],
	["ssqch/vue", ["vuePlugin"]],
	["ssqch/from-vitepress", ["fromVitepress"]],
];

/** The Node modules a config, a data file or a package can import. They are Node's own, so every one works (0.7's QuickJS had stand-ins for some that threw when used, listed as `stubs`). */
const NODE_MODULES = ["fs", "fs/promises", "path", "path/posix", "url", "process", "buffer", "crypto", "module", "util", "events", "os", "assert", "assert/strict", "timers", "timers/promises", "string_decoder", "http", "https", "http2", "net", "tls", "dns", "child_process", "worker_threads", "cluster", "readline", "zlib", "vm", "stream", "tty", "perf_hooks"];

/** The modules this build has, with their exports: all of 0.7's, Sass included (0.7's own compiler, as WebAssembly). */
export function modules(): Array<{ name: string; exports: string[] }> {
	return MODULE_EXPORTS.map(([name, exports]) => ({ name, exports: [...exports] }));
}

/** Whether sharp, which encodes the images, can write AVIF here. */
async function avifWorks(): Promise<boolean> {
	try {
		const name = "sharp";
		const sharp = (await import(name)).default;
		return Boolean(sharp?.format?.heif?.output?.buffer);
	} catch {
		return false;
	}
}

export interface Capabilities {
	schemaVersion: 1;
	version: string;
	commands: string[];
	json: string[];
	features: Record<string, boolean>;
	configFiles: string[];
	configOptions: string[];
	templateLanguages: Array<{ name: string; extensions: string[] }>;
	defaults: { templateFormats: string[]; markdownEngine: string; htmlEngine: string };
	frontMatter: string[];
	dataFiles: string[];
	modules: Array<{ name: string; exports: string[] }>;
	nodeModules: { available: string[]; stubs: string[] };
	globals: string[];
	imageFormats: string[];
	starters: string[];
	starterEngines: string[];
	/** The generators `ssqch scout` reads a site of in depth (the key is 0.7's, from when they were importers). */
	importers: string[];
}

/** `commands` are the ones `--help` lists. */
export async function capabilities(commands: string[]): Promise<Capabilities> {
	const avif = await avifWorks();
	const features: Record<string, boolean> = { avif, fetch: true, sass: true, liquid: true, jinja: true, handlebars: true };
	const globals = ["console", "process", "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "EventTarget", "Intl", "setTimeout", "setInterval", "setImmediate", "fetch", "Headers", "Request", "Response", "AbortController", "AbortSignal"];
	return {
		schemaVersion: 1,
		version: VERSION,
		commands,
		json: ["build --format json", "trace --format json", "diff --format json", "capabilities --format json", "docs --format json", "serve --ready-file"],
		features,
		configFiles: [...CONFIG_FILES, "sitesquatch.toml"],
		configOptions: configOptions(),
		templateLanguages: [
			{ name: "edge", extensions: ["edge"] },
			{ name: "markdown", extensions: ["md", "markdown"] },
			{ name: "html", extensions: ["html"] },
			{ name: "ejs", extensions: ["ejs"] },
			{ name: "liquid", extensions: ["liquid"] },
			{ name: "nunjucks", extensions: ["njk", "jinja", "j2"] },
			{ name: "handlebars", extensions: ["hbs", "handlebars", "mustache"] },
		],
		defaults: { templateFormats: [...DEFAULTS.templateFormats], markdownEngine: DEFAULTS.markdownEngine, htmlEngine: DEFAULTS.htmlEngine },
		frontMatter: ["yaml", "json", "toml"],
		dataFiles: ["json", "yaml", "yml", "toml", "js", "mjs", "cjs"],
		modules: modules(),
		nodeModules: { available: NODE_MODULES.map((m) => `node:${m}`), stubs: [] },
		globals,
		imageFormats: avif ? ["avif", "webp", "jpeg", "png", "gif", "svg"] : ["webp", "jpeg", "png", "gif", "svg"],
		starters: ["site", "docs"],
		starterEngines: starterEngines(),
		importers: ["eleventy", "jekyll", "zola", "hugo", "mkdocs"],
	};
}

function text(caps: Capabilities): string {
	let out = `What's in the pack: ssqch ${caps.version}\n`;
	const row = (label: string, value: string) => { out += `  ${label.padEnd(19)}${value}\n`; };
	row("Commands", caps.commands.join(", "));
	row("Optional features", Object.entries(caps.features).map(([name, on]) => `${name} ${on ? "yes" : "no"}`).join(", "));
	row("Template languages", caps.templateLanguages.map((l) => `${l.name} (.${l.extensions.join(", .")})`).join(", "));
	const { defaults } = caps;
	const through = defaults.markdownEngine === defaults.htmlEngine ? `Markdown and HTML through ${defaults.markdownEngine}` : `Markdown through ${defaults.markdownEngine}, HTML through ${defaults.htmlEngine}`;
	row("Defaults", `templateFormats ${defaults.templateFormats.join(", ")}; ${through}`);
	row("Config files", caps.configFiles.join(", "));
	row("Config options", caps.configOptions.join(", "));
	row("Modules", caps.modules.map((m) => m.name).join(", "));
	row("Node modules", caps.nodeModules.available.join(", "));
	row("Globals", caps.globals.join(", "));
	row("Image formats", caps.imageFormats.join(", "));
	row("Starters", `${caps.starters.join(", ")} (in ${caps.starterEngines.join(", ")})`);
	row("Scout reads", caps.importers.join(", "));
	return out + "\n--format json has all of it, with each module's exports.\n";
}

/** `ssqch capabilities`. Answers the exit code. */
export async function runCapabilities(format: string, commands: string[]): Promise<number> {
	if (format !== "text" && format !== "json") {
		process.stderr.write(`${red("error:")} --format ${format}: use text or json\n`);
		return 1;
	}
	const caps = await capabilities(commands);
	process.stdout.write(format === "json" ? JSON.stringify(caps, null, 2) + "\n" : text(caps));
	return 0;
}
