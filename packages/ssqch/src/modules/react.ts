// `ssqch/react`: React components in a site's pages, rendered at build time. `<Counter start={3} />`
// in a page that imports `Counter.jsx` (MDX's way, `import Counter from "./Counter.jsx"`), or a
// component the config names, becomes the HTML React's server renderer writes for it; with
// `hydrate`, it runs in the browser too, as an island. The Docusaurus move kept its components by
// hosting Docusaurus itself (399 lines), and the Gatsby move wrote 267 lines of shims, a renderer
// and its own esbuild bundles.
//
// The site's React, react-dom and esbuild do the work, from its own `node_modules`: ssqch doesn't
// bundle them. esbuild, because it's the JSX compiler a React site most likely has already (Vite
// and Astro install it) and it's one package with no plugins to configure; Vite with
// @vitejs/plugin-react would need Babel too, which a Docusaurus or Gatsby site doesn't have in the
// same shape. Before each build, the components the pages use are bundled into one module for the
// server (React itself stays the site's, so components and the renderer share one copy) and, with
// `hydrate`, one for the browser, in `.cache/ssqch/react/`; while serving, that's skipped unless a
// file the bundle read changed. React's `renderToString` answers at once, so a tag is its HTML in
// the components step (`_includes/components/` comes first), with no marker to fill in later.
// That step renders the innermost tag first, so a parent gets its children as HTML; when they're
// only components this page just rendered, the parent renders them again as React elements, as
// MDX would give them (a `<Tabs>` that reads its `<TabItem>`s' props).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile } from "../config.ts";
import { BuildError, bail, error } from "../diagnostics.ts";
import { jsxEnd } from "../components.ts";
import { addMarkdownSteps } from "../markdown-options.ts";
import { startReading } from "../plugin-files.ts";
import { realPath } from "../paths.ts";
import { closest } from "../suggest.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";
import { packageEntry } from "./vue.ts";

/** A value in an error: a string as Rust's `{:?}` writes it, anything else as JSON. */
const shown = (v: unknown) => (typeof v === "string" ? debugString(v) : JSON.stringify(v) ?? String(v));

export function reactPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/react", builtin: "ssqch/react", options };
}

/** A component a page imports: the module (as written) and which of its exports. */
export interface ImportedComponent { spec: string; export: string; /** The import's line, from 0. */ line: number }

const IMPORT = /^import\s+(?:([A-Z][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s*(['"])([^'"]+)\3\s*;?\s*$/;

/**
 * What a Markdown page imports, MDX's way: `import Counter from "./Counter.jsx"` and
 * `import { Tabs, TabItem as Tab } from "./tabs.jsx"`, one statement per line or spread over
 * several, at the start of a line outside code fences. PascalCase names only: they're the tags.
 * `lines` are the lines (from 0) the statements take, which the page's Markdown leaves out.
 */
export function pageImports(markdown: string): { components: Record<string, ImportedComponent>; lines: Set<number> } {
	const components: Record<string, ImportedComponent> = {};
	const lines = new Set<number>();
	const all = markdown.split("\n");
	let fence: string | undefined;
	for (let i = 0; i < all.length; i++) {
		const m = /^\s*(`{3,}|~{3,})/.exec(all[i]);
		if (fence !== undefined) { if (m && m[1][0] === fence[0] && all[i].trim().startsWith(fence)) fence = undefined; continue; }
		if (m) { fence = m[1]; continue; }
		if (!/^import\s/.test(all[i])) continue;
		// A statement over several lines ends at the line with its `from "..."`.
		let end = i;
		let text = all[i];
		while (!/\bfrom\s*['"][^'"]+['"]/.test(text) && end + 1 < all.length && end - i < 50) text += ` ${all[++end].trim()}`;
		const found = IMPORT.exec(text.replace(/\s+/g, " ").trim());
		if (!found) continue;
		const [, def, named, , spec] = found;
		let any = false;
		if (def) { components[def] = { spec, export: "default", line: i }; any = true; }
		for (const part of (named ?? "").split(",")) {
			const pair = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
			if (!pair) continue;
			const local = pair[2] ?? pair[1];
			if (!/^[A-Z]/.test(local)) continue;
			components[local] = { spec, export: pair[1], line: i };
			any = true;
		}
		if (!any) continue;
		for (let n = i; n <= end; n++) lines.add(n);
		i = end;
	}
	return { components, lines };
}

/** The text of `markdown` outside code fences and inline code, with what's inside them blanked (so a tag in a code sample isn't counted or rewritten). Lengths and line breaks are kept. */
function outsideCode(markdown: string): string {
	let fence: string | undefined;
	return markdown.split("\n").map((line) => {
		const m = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence !== undefined) { if (m && m[1][0] === fence[0] && line.trim().startsWith(fence)) fence = undefined; return " ".repeat(line.length); }
		if (m) { fence = m[1]; return " ".repeat(line.length); }
		return line.replace(/(`+)[^`]*?\1/g, (code) => " ".repeat(code.length));
	}).join("\n");
}

/**
 * A page's Markdown as ssqch's reads it, with MDX's ways made into ssqch's: the import lines
 * `pageImports` found left out, and on each PascalCase tag, a JSX value (`height={500}`,
 * `style={{ color: "red" }}`, a tag over several lines) written as the binding the components
 * step reads (`:height="500"`), on one line. CommonMark takes a tag as HTML only when its
 * attributes are HTML's, so `{{ a: 1 }}`, with its space, would have been text.
 */
export function mdxToMarkdown(markdown: string): string {
	const { lines } = pageImports(markdown);
	if (lines.size) markdown = markdown.split("\n").map((line, i) => (lines.has(i) ? "" : line)).join("\n");
	if (!/<[A-Z]/.test(markdown)) return markdown;
	const plain = outsideCode(markdown);
	let out = "";
	let at = 0;
	for (const m of plain.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) {
		if (m.index < at) continue;
		const tag = jsxTag(markdown, m.index + m[0].length);
		if (tag === undefined) continue;
		out += markdown.slice(at, m.index) + `<${m[1]}${tag.attrs}`;
		at = tag.end;
	}
	return out + markdown.slice(at);
}

/** A start tag's attributes from `from` to its `>`, JSX values written as bindings and line breaks as spaces; undefined when it doesn't end. */
function jsxTag(text: string, from: number): { attrs: string; end: number } | undefined {
	let out = "";
	let i = from;
	while (i < text.length) {
		const c = text[i];
		if (c === ">") return { attrs: `${out}>`, end: i + 1 };
		if (c === "\"" || c === "'") {
			const close = text.indexOf(c, i + 1);
			if (close === -1) return undefined;
			out += text.slice(i, close + 1).replace(/\s*\n\s*/g, " ");
			i = close + 1;
			continue;
		}
		if (c === "{") {
			const close = jsxEnd(text, i);
			if (close === -1) return undefined;
			const expr = text.slice(i + 1, close).trim();
			// `name={expr}`: the binding `:name="expr"`. A `{...spread}` has no name, and is left as written.
			const name = /([A-Za-z_][\w.:-]*)\s*=\s*$/.exec(out);
			if (name) out = `${out.slice(0, name.index)}:${name[1]}="${expr.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s*\n\s*/g, " ")}"`;
			else out += text.slice(i, close + 1);
			i = close + 1;
			continue;
		}
		if (c === "<") return undefined;
		out += c === "\n" ? " " : c;
		i++;
	}
	return undefined;
}

/** The line (from 1) of the `nth` (from 0) `<Name` tag in `source` outside code, or undefined when it has fewer (the tag is in a layout). */
export function tagLine(source: string, name: string, nth: number): number | undefined {
	const plain = outsideCode(source);
	let n = 0;
	for (const m of plain.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "g"))) {
		if (n++ === nth) return plain.slice(0, m.index).split("\n").length;
	}
	return undefined;
}

/** A package from the site, or from beside its Vite (pnpm keeps esbuild there, not in the site's `node_modules`). */
function sitePackage(root: string, name: string): string | undefined {
	const found = packageEntry(root, name);
	if (found !== undefined) return found;
	for (const tool of ["vite", "astro"]) {
		const dir = path.join(root, "node_modules", tool);
		if (fs.existsSync(dir)) { const beside = packageEntry(fs.realpathSync(dir), name); if (beside !== undefined) return beside; }
	}
	return undefined;
}

const HYDRATE = ["load", "idle", "visible"] as const;
type When = typeof HYDRATE[number];
/** Where a component's children go in its HTML until they're put in (`\uE052<n>\uE053`): private-use characters no React or Markdown writes. */
const SLOTS = /\uE052(\d+)\uE053/g;
/** What a relative import without its extension can mean, as esbuild reads it. */
const EXTENSIONS = [".jsx", ".tsx", ".js", ".ts", ".mjs", ".mts"];

/** A component as the server renders it: its children the components inside it, or HTML. */
interface Tree { id: string; props: Record<string, unknown>; kids?: Tree[]; content?: string }

/** A component's module and export, as the bundles import it. */
interface Entry { file: string; export: string; name: string; id: string }

BUILTINS.set("ssqch/react", (config: Config, given) => {
	const o = new Options(given, ["components", "hydrate", "css", "esbuild"]);
	const globals = o.get("components") ?? {};
	if (typeof globals !== "object" || globals === null || Array.isArray(globals)) bail(`components must be an object of { Name: "path/to/Name.jsx" }, the ones every page can use without importing them (got ${shown(globals)})`);
	for (const [name, file] of Object.entries(globals)) if (!/^[A-Z]\w*$/.test(name) || typeof file !== "string") bail(`components: ${debugString(name)} must be a PascalCase name with a component's path, like { Counter: "src/components/Counter.jsx" }`);
	const hydrateGiven = o.get("hydrate");
	const whenOk = (v: unknown) => (HYDRATE as readonly unknown[]).includes(v);
	if (hydrateGiven !== undefined && hydrateGiven !== false && !whenOk(hydrateGiven)) {
		if (typeof hydrateGiven !== "object" || hydrateGiven === null || Array.isArray(hydrateGiven)) bail(`hydrate must be false, "load", "idle" or "visible", or an object of them by component ({ Counter: "visible" }) (got ${shown(hydrateGiven)})`);
		for (const [name, when] of Object.entries(hydrateGiven)) if (when !== false && !whenOk(when)) bail(`hydrate.${name} must be false, "load", "idle" or "visible" (got ${shown(when)})`);
	}
	const hydrate = hydrateGiven === undefined ? false : (hydrateGiven as false | When | Record<string, When | false>);
	const hydrateFor = (name: string): When | false => (typeof hydrate === "string" ? hydrate : hydrate === false ? false : (hydrate[name] ?? false));
	const anyHydrate = hydrate !== false && (typeof hydrate === "string" || Object.values(hydrate).some((w) => w !== false));
	const cssGiven = o.get("css");
	if (cssGiven !== undefined && typeof cssGiven !== "boolean" && !(typeof cssGiven === "string" && cssGiven.startsWith("/") && cssGiven.endsWith(".css"))) bail(`css must be a path like "/assets/react.css", or false (got ${shown(cssGiven)})`);
	const cssPath = cssGiven === false ? undefined : typeof cssGiven === "string" ? cssGiven : "/assets/react.css";
	const extra = (o.get("esbuild") ?? {}) as Record<string, unknown>;
	if (typeof extra !== "object" || extra === null || Array.isArray(extra)) bail(`esbuild must be esbuild's options to add, like { alias: { "@site": "." } } (got ${shown(extra)})`);

	// MDX's import lines and JSX values, made into ssqch's Markdown before it reads the page.
	addMarkdownSteps(config.markdown.steps, 'plugin "reactPlugin"', { before: mdxToMarkdown });

	const cache = path.join(config.root, ".cache", "ssqch", "react");
	const base = config.base.replace(/\/$/, "");
	const shownFile = (file: string) => (path.isAbsolute(file) ? path.relative(config.root, file).split(path.sep).join("/") : file);
	// A component the config names is a file from the project's root, or else a package's, as written.
	const globalFile = (file: string) => {
		const at = path.resolve(config.root, file);
		return file.startsWith(".") || fs.existsSync(at) ? at : file;
	};
	// An id that doesn't move when components come or go: the islands' `data-component`.
	const entryOf = (file: string, exp: string, name: string): Entry => {
		const key = `${shownFile(file)}#${exp}`;
		const stem = exp === "default" ? path.basename(file).replace(/\.[^.]*$/, "").replace(/[^\w-]/g, "") || name : exp;
		return { file, export: exp, name, id: `${stem}-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 8)}` };
	};

	// Per build: each page's components by name, the entries the bundles import, and what React needs.
	let byPage = new Map<string, Record<string, Entry>>();
	let globalEntries: Record<string, Entry> = {};
	let entries = new Map<string, Entry>();
	let server: { render(tree: unknown): string; island(id: string, props: Record<string, unknown>, slot: string | undefined): string } | undefined;
	let builtFrom = "";
	let inputs = new Set<string>();
	let islands = false;
	// Which of a page's tags of one name this is, for the line of the one that failed.
	let seen = new Map<string, number>();
	const sources = new Map<string, string>();
	// Where each component is imported (its first page and line), for an import esbuild can't find.
	let importedAt = new Map<string, { page: string; line: number; spec: string }>();
	// The components this page rendered, by their HTML, so a parent whose children are only components gets them as React elements.
	let rendered = new Map<string, Tree>();
	let renderedFor = "";

	/** The `.md` files under the input folder, and each one's imported components. */
	const scan = () => {
		const pages = new Map<string, Record<string, Entry>>();
		const walk = (dir: string) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
				if (e.name.startsWith(".") || e.name === "node_modules") continue;
				const full = path.join(dir, e.name);
				if (e.isDirectory()) { if (path.resolve(full) !== path.resolve(config.root, config.output)) walk(full); continue; }
				if (!/\.(?:md|markdown)$/i.test(e.name)) continue;
				const found = pageImports(fs.readFileSync(full, "utf8")).components;
				const own: Record<string, Entry> = {};
				for (const [name, imp] of Object.entries(found)) {
					let file = imp.spec;
					if (imp.spec.startsWith(".")) {
						const at = path.resolve(path.dirname(full), imp.spec);
						const there = [at, ...EXTENSIONS.map((ext) => at + ext), ...EXTENSIONS.map((ext) => path.join(at, `index${ext}`))].find((f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile());
						if (there === undefined) {
							const message = `reactPlugin(): ${shownFile(full)}:${imp.line + 1} imports ${imp.spec}, which isn't there (no file, and none with ${EXTENSIONS.join(", ")})`;
							throw new BuildError(message, [error("template", message, { file: shownFile(full), line: imp.line + 1 })]);
						}
						file = at;
					}
					own[name] = entryOf(file, imp.export, name);
					if (!importedAt.has(own[name].id)) importedAt.set(own[name].id, { page: shownFile(full), line: imp.line + 1, spec: imp.spec });
				}
				if (Object.keys(own).length) pages.set(path.resolve(full), own);
			}
		};
		walk(path.resolve(config.root, config.input));
		return pages;
	};

	async function fromSite(name: string): Promise<Record<string, any>> {
		const entry = sitePackage(config.root, name);
		if (entry === undefined) {
			const lock = (f: string) => fs.existsSync(path.join(config.root, f));
			const [add, dev] = lock("pnpm-lock.yaml") ? ["pnpm add", "pnpm add -D"] : lock("yarn.lock") ? ["yarn add", "yarn add -D"] : lock("bun.lock") || lock("bun.lockb") ? ["bun add", "bun add -d"] : ["npm install", "npm install -D"];
			const missing = ["react", "react-dom", "esbuild"].filter((p) => sitePackage(config.root, p) === undefined);
			const run = [missing.some((p) => p !== "esbuild") && `\`${add} react react-dom\``, missing.includes("esbuild") && `\`${dev} esbuild\``].filter(Boolean).join(" and ");
			bail(`reactPlugin() needs ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")} in the site's packages: ${run}. React and react-dom render the components; esbuild compiles their JSX`);
		}
		return import(pathToFileURL(entry!).href);
	}

	config.beforeBuild.push({ label: "", fn: async (event) => {
		// React picks its development or production build from NODE_ENV when it loads: ssqch's env, unless it's set.
		process.env.NODE_ENV ??= config.env === "production" ? "production" : "development";
		islands = false;
		seen = new Map();
		sources.clear();
		importedAt = new Map();
		rendered = new Map();
		renderedFor = "";
		byPage = scan();
		globalEntries = Object.fromEntries(Object.entries(globals as Record<string, string>).map(([name, file]) => [name, entryOf(globalFile(file), "default", name)]));
		entries = new Map();
		for (const entry of [...Object.values(globalEntries), ...[...byPage.values()].flatMap((m) => Object.values(m))]) entries.set(entry.id, entry);
		// A component named in `hydrate` that no page imports and `components` doesn't name: a misspelling.
		if (hydrate !== false && typeof hydrate === "object") {
			const names = new Set([...Object.keys(globalEntries), ...[...byPage.values()].flatMap((m) => Object.keys(m))]);
			for (const name of Object.keys(hydrate)) {
				if (names.has(name)) continue;
				const near = closest(name, names);
				throw new BuildError(`reactPlugin(): hydrate names ${name}, which no page imports and components doesn't name${near ? ` (did you mean ${near}?)` : ""}`);
			}
		}
		const ids = [...entries.keys()].sort();
		const key = JSON.stringify([ids.map((id) => [id, entries.get(id)!.file]), hydrate, cssPath, base, config.env]);
		// While serving, a change to nothing the bundle read keeps the last one.
		const changed = Array.isArray(config.changed) ? config.changed : undefined;
		const touched = changed === undefined || changed.some((f) => { try { return inputs.has(realPath(f)); } catch { return true; } });
		const read = startReading(config, "ssqch/react");
		if (server && key === builtFrom && !touched) { for (const f of inputs) read.add(f); return; }
		// Nothing to render with until the new bundle works: a failed one isn't kept for the next build.
		server = undefined;
		builtFrom = "";
		if (!ids.length) { builtFrom = key; inputs = new Set(); return; }
		const esbuildModule = await fromSite("esbuild");
		await fromSite("react");
		await fromSite("react-dom");
		const esbuild = (typeof esbuildModule.build === "function" ? esbuildModule : esbuildModule.default) as { build(options: Record<string, unknown>): Promise<{ metafile?: { inputs: Record<string, unknown> } }> };
		fs.rmSync(cache, { recursive: true, force: true });
		fs.mkdirSync(cache, { recursive: true });
		const importPath = (file: string) => JSON.stringify(path.isAbsolute(file) ? file.split(path.sep).join("/") : file);
		const pick = `const pick = (m, exp, name) => (exp === "default" ? (m.default ?? m[name]) : m[exp]);`;
		const serverEntry = path.join(cache, "server.js");
		fs.writeFileSync(serverEntry, [
			`import { createElement } from "react";`,
			`import { renderToString } from "react-dom/server";`,
			...ids.map((id, i) => `import * as M${i} from ${importPath(entries.get(id)!.file)};`),
			pick,
			`export const components = {`,
			...ids.map((id, i) => `  ${JSON.stringify(id)}: pick(M${i}, ${JSON.stringify(entries.get(id)!.export)}, ${JSON.stringify(entries.get(id)!.name)}),`),
			`};`,
			`const element = (t) => createElement(components[t.id], t.props, ...(t.kids ? t.kids.map(element) : t.slot === undefined ? [] : [t.slot]));`,
			`export function render(tree) { return renderToString(element(tree)); }`,
			// An island's children are HTML React mustn't touch, in an element that takes no room, so the browser's render matches.
			`export function island(id, props, slot) {`,
			`  const children = slot === undefined ? props.children : createElement("ssqch-children", { style: { display: "contents" }, dangerouslySetInnerHTML: { __html: slot } });`,
			`  return renderToString(createElement(components[id], children === undefined ? props : { ...props, children }));`,
			`}`,
			"",
		].join("\n"));
		const loaders = Object.fromEntries(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "woff", "woff2", "ttf", "otf", "eot", "mp4", "webm"].map((ext) => [`.${ext}`, "file"]));
		const shared = {
			bundle: true,
			absWorkingDir: config.root,
			jsx: "automatic",
			logLevel: "silent",
			metafile: true,
			assetNames: "[name]-[hash]",
			publicPath: `${base}/assets/react/`,
			...extra,
			loader: { ".js": "jsx", ...loaders, ...((extra.loader as object | undefined) ?? {}) },
		};
		const failed = (where: string, e: unknown) => {
			const errors = (e as { errors?: Array<{ text: string; location?: { file: string; line: number; lineText?: string } | null }> }).errors;
			const first = errors?.[0];
			const loc = first?.location;
			// An import in ssqch's own entry module is a page's import (or the config's): said as that.
			if (first && loc && /(?:^|\/)\.cache\/ssqch\/react\/(?:server|client)\.js$/.test(loc.file.replaceAll("\\", "/"))) {
				const id = ids.find((i) => (loc.lineText ?? "").includes(importPath(entries.get(i)!.file)));
				const at = id === undefined ? undefined : importedAt.get(id);
				const named = id === undefined ? undefined : Object.entries(globalEntries).find(([, g]) => g.id === id)?.[0];
				const text = first.text.replace(/^Could not resolve "[^"]*"/, "can't find it");
				if (at) {
					const message = `reactPlugin(): ${at.page}:${at.line} imports ${at.spec}, and esbuild ${text.startsWith("can't") ? text : `says: ${text}`} (a package to install, or an alias in reactPlugin()'s esbuild option)`;
					return new BuildError(message, [error("template", message, { file: at.page, line: at.line })]);
				}
				if (named) return new BuildError(`reactPlugin(): components.${named} is ${shown((globals as Record<string, string>)[named])}, and esbuild ${text.startsWith("can't") ? text : `says: ${text}`}`);
			}
			const said = first ? `${loc ? `${loc.file}:${loc.line} ` : ""}${first.text}` : e instanceof Error ? e.message : String(e);
			return new BuildError(`reactPlugin(): esbuild couldn't build the components for the ${where}: ${said}`);
		};
		let built;
		try {
			built = await esbuild.build({
				...shared,
				entryPoints: [serverEntry],
				outdir: path.join(cache, "ssr"),
				entryNames: "server",
				platform: "node",
				format: "esm",
				// React stays the site's, so the components and the renderer share one copy.
				external: ["react", "react/*", "react-dom", "react-dom/*", ...((extra.external as string[] | undefined) ?? [])],
				// A CommonJS package bundled in that requires React gets Node's `require`.
				banner: { js: `import { createRequire as __ssqchRequire } from "node:module"; const require = __ssqchRequire(import.meta.url);` },
			});
		} catch (e) { throw failed("server", e); }
		inputs = new Set(Object.keys(built.metafile?.inputs ?? {}).filter((f) => !f.split(/[\\/]/).includes("node_modules") && !f.includes(":")).map((f) => { const full = path.resolve(config.root, f); try { return realPath(full); } catch { return full; } }));
		inputs.delete(realPath(serverEntry));
		for (const f of inputs) read.add(f);
		const mod = await import(`${pathToFileURL(path.join(cache, "ssr", "server.js")).href}?${Date.now()}`);
		for (const id of ids) {
			const c = mod.components[id];
			const entry = entries.get(id)!;
			if (typeof c !== "function" && (typeof c !== "object" || c === null)) throw new BuildError(`reactPlugin(): ${shownFile(entry.file)} has no ${entry.export === "default" ? `default export (or one named ${entry.name})` : `export named ${entry.export}`} to render as <${entry.name}>`);
		}
		// The browser's: each hydrated component its own chunk, loaded where a page has it.
		const hydrated = ids.filter((id) => anyHydrate && [...Object.entries(globalEntries), ...[...byPage.values()].flatMap((m) => Object.entries(m))].some(([name, e]) => e.id === id && hydrateFor(name) !== false));
		if (hydrated.length) {
			const client = path.join(cache, "client.js");
			fs.writeFileSync(client, [
				`import { createElement } from "react";`,
				`import { hydrateRoot } from "react-dom/client";`,
				pick,
				`const load = {`,
				...hydrated.map((id) => `  ${JSON.stringify(id)}: () => import(${importPath(entries.get(id)!.file)}).then((m) => pick(m, ${JSON.stringify(entries.get(id)!.export)}, ${JSON.stringify(entries.get(id)!.name)})),`),
				`};`,
				`const start = (el) => load[el.dataset.component]?.().then((C) => {`,
				`  const props = JSON.parse(el.dataset.props || "{}");`,
				`  const slot = el.querySelector("ssqch-children");`,
				`  if (slot) props.children = createElement("ssqch-children", { style: { display: "contents" }, dangerouslySetInnerHTML: { __html: slot.innerHTML } });`,
				`  hydrateRoot(el, createElement(C, props));`,
				`});`,
				`for (const el of document.querySelectorAll("ssqch-react")) {`,
				`  const when = el.dataset.hydrate;`,
				`  if (when === "visible" && "IntersectionObserver" in window) { const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); start(el); } }); seen.observe(el); }`,
				`  else if (when === "idle" && "requestIdleCallback" in window) requestIdleCallback(() => start(el));`,
				`  else start(el);`,
				`}`,
				"",
			].join("\n"));
			try {
				await esbuild.build({
					...shared,
					entryPoints: [client],
					outdir: path.join(cache, "client"),
					entryNames: "islands",
					chunkNames: "[name]-[hash]",
					platform: "browser",
					format: "esm",
					splitting: true,
					minify: config.env === "production",
					define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV), ...((extra.define as object | undefined) ?? {}) },
				});
			} catch (e) { throw failed("browser", e); }
		}
		server = mod;
		builtFrom = key;
	} });

	/** The page's source, for the line a tag is on. */
	const sourceOf = (file: string) => {
		let text = sources.get(file);
		if (text === undefined) { try { text = fs.readFileSync(file, "utf8"); } catch { text = ""; } sources.set(file, text); }
		return text;
	};

	/** `content`'s components, when it's only components this page rendered (and space between them); undefined when it's anything more. */
	const componentsIn = (content: string): Tree[] | undefined => {
		if (rendered.size === 0 || !content.includes("<")) return undefined;
		const kids: Tree[] = [];
		for (let i = 0; ;) {
			while (i < content.length && /\s/.test(content[i])) i++;
			if (i >= content.length) break;
			let best: [string, Tree] | undefined;
			for (const pair of rendered) if (pair[0].length > (best?.[0].length ?? 0) && content.startsWith(pair[0], i)) best = pair;
			if (!best) return undefined;
			kids.push(best[1]);
			i += best[0].length;
		}
		return kids.length ? kids : undefined;
	};

	config.componentRenderers.push((name, value, inputPath, data) => {
		if (!server) return undefined;
		const own = byPage.get(path.resolve(inputPath)) ?? {};
		const entry = own[name] ?? globalEntries[name];
		const page = shownFile(path.resolve(inputPath));
		const url = typeof (data.page as { url?: unknown } | undefined)?.url === "string" ? (data.page as { url: string }).url : "";
		const nthKey = `${inputPath}\0${url}\0${name}`;
		const nth = seen.get(nthKey) ?? 0;
		seen.set(nthKey, nth + 1);
		const where = () => {
			const line = tagLine(sourceOf(path.resolve(inputPath)), name, nth);
			return { text: line === undefined ? `${page} (or its layout)` : `${page}:${line}`, extra: line === undefined ? { file: page } : { file: page, line } };
		};
		if (entry === undefined) {
			// A misspelled name, or a component another page imports: said here, with the fix.
			const names = [...Object.keys(own), ...Object.keys(globalEntries)];
			const near = closest(name, names);
			const elsewhere = near === undefined ? [...byPage].find(([, m]) => m[name] !== undefined) : undefined;
			if (near === undefined && elsewhere === undefined) return undefined;
			const at = where();
			const message = near !== undefined
				? `reactPlugin(): <${name}> at ${at.text} isn't a component this page has (did you mean <${near}>?)`
				: `reactPlugin(): <${name}> at ${at.text} isn't imported in this page (${shownFile(elsewhere![0])} imports it): add \`import ${name} from "..."\` to the page, or name it in reactPlugin()'s components for every page`;
			throw new BuildError(message, [error("template", message, at.extra)]);
		}
		// Props as JSX has them: attributes by the names written (`aria-label`, not also `ariaLabel`),
		// and `class` as React's `className`.
		const props: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value.props)) {
			if (/^[a-z][\w]*[A-Z]/.test(k) && Object.keys(value.props).some((w) => w.includes("-") && w.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()) === k)) continue;
			props[k] = v;
		}
		if ("class" in props && !("className" in props)) { props.className = props.class; delete props.class; }
		const when = hydrateFor(name);
		const content = value.content;
		// A new page: what the last one rendered can't be its children.
		const pageKey = `${inputPath}\0${url}`;
		if (pageKey !== renderedFor) { rendered = new Map(); renderedFor = pageKey; }
		let html: string;
		let tree: Tree | undefined;
		try {
			if (when === false) {
				// Children that are only components (`<Tabs>` around `<TabItem>`s) are React elements, as
				// MDX gives them, so a parent can read their props; anything else is its HTML.
				const kids = componentsIn(content);
				tree = kids ? { id: entry.id, props, kids } : { id: entry.id, props, content };
				const slots: string[] = [];
				const plain = (t: Tree): unknown => ({ id: t.id, props: t.props, kids: t.kids?.map(plain), slot: t.kids || !t.content ? undefined : `\uE052${slots.push(t.content) - 1}\uE053` });
				html = server.render(plain(tree)).replace(SLOTS, (_, n: string) => slots[Number(n)]);
			} else {
				html = server.island(entry.id, props, content === "" ? undefined : content);
			}
		} catch (e) {
			const at = where();
			const cause = e instanceof Error ? `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}` : String(e);
			const message = `reactPlugin(): <${name}> (${shownFile(entry.file)}) at ${at.text} didn't render: ${cause}`;
			throw new BuildError(message, [error("template", message, at.extra)]);
		}
		if (tree && html !== "") rendered.set(html, tree);
		if (when === false) return html;
		islands = true;
		const json = JSON.stringify(props, (_, v) => (v instanceof Date ? v.toISOString() : v)) ?? "{}";
		return `<ssqch-react data-component="${entry.id}" data-hydrate="${when}" data-props="${json.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${html}</ssqch-react>`;
	});

	// The islands' script, once, before the end of a page that has one.
	config.htmlTransforms.push(["react", (content) => {
		if (!anyHydrate || !content.includes("<ssqch-react ")) return content;
		const tag = `<script type="module" src="${base}/assets/react/islands.js"></script>`;
		return content.includes("</body>") ? content.replace("</body>", `${tag}</body>`) : content + tag;
	}]);

	// The components' styles, what they import (pictures, fonts), and the browser's modules.
	config.generators.push(["ssqch/react", () => {
		const files: GeneratedFile[] = [];
		if (!server) return files;
		const listed = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort() : []);
		const ssrDir = path.join(cache, "ssr");
		for (const f of listed(ssrDir)) {
			if (/\.(?:[cm]?js|map)$/.test(f)) continue;
			if (f.endsWith(".css")) { if (cssPath) files.push({ path: cssPath, contents: fs.readFileSync(path.join(ssrDir, f), "utf8") }); continue; }
			files.push({ path: `/assets/react/${f.split(path.sep).join("/")}`, contents: fs.readFileSync(path.join(ssrDir, f)) });
		}
		if (islands) {
			const clientDir = path.join(cache, "client");
			for (const f of listed(clientDir)) if (/\.js$/.test(f)) files.push({ path: `/assets/react/${f.split(path.sep).join("/")}`, contents: fs.readFileSync(path.join(clientDir, f), "utf8") });
		}
		return files;
	}]);
});
