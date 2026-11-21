// `ssqch/vue`: Vue components in a site's pages, rendered at build time. `<ApiIndex />` in a page
// whose `<script setup>` imports `ApiIndex.vue` (VitePress's way), or a component the config names,
// becomes the HTML Vue's server renderer writes for it; with `hydrate`, it runs in the browser
// too, as an island. The vuejs.org move did this with 241 lines of its own (a Vite build of the
// components, a renderer, a stylesheet) and 867 ms per dev rebuild.
//
// The site's Vite, @vitejs/plugin-vue and Vue do the work, from its own `node_modules`: ssqch
// doesn't bundle them. Before each build, the components the pages use are built into one module
// for the server (and, with `hydrate`, one for the browser), in `.cache/ssqch/vue/`; while
// serving, that's skipped when the change was only to pages. A tag renders in the components
// step (`_includes/components/` comes first), as a marker the build fills in once Vue answers.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BUILTINS } from "../config.ts";
import type { Config, GeneratedFile } from "../config.ts";
import { BuildError, bail } from "../diagnostics.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

/** A value in an error: a string as Rust's `{:?}` writes it, anything else as JSON. */
const shown = (v: unknown) => (typeof v === "string" ? debugString(v) : JSON.stringify(v) ?? String(v));

export function vuePlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/vue", builtin: "ssqch/vue", options };
}

/**
 * What a page's `<script setup>` imports: `.vue` components by name (`{ ApiIndex: "./ApiIndex.vue" }`)
 * and VitePress data loaders by the name the page gives their `data` (`{ data: "./errors.data" }`).
 * Code fences aren't read.
 */
export function setupImports(markdown: string): { components: Record<string, string>; loaders: Record<string, string> } {
	const out: Record<string, string> = {};
	const loaders: Record<string, string> = {};
	let fence: string | undefined;
	const lines = markdown.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const m = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
		if (fence !== undefined) { if (m && m[1][0] === fence[0] && lines[i].trim() === m[1]) fence = undefined; continue; }
		if (m) { fence = m[1]; continue; }
		if (!/^<script\b[^>]*\bsetup\b/.test(lines[i])) continue;
		const start = i;
		while (i < lines.length && !lines[i].includes("</script>")) i++;
		const code = lines.slice(start, i + 1).join("\n");
		for (const imp of code.matchAll(/import\s+([A-Z]\w*)\s+from\s+['"]([^'"]+\.vue)['"]/g)) out[imp[1]] = imp[2];
		for (const imp of code.matchAll(/import\s*\{\s*data(?:\s+as\s+(\w+))?\s*\}\s*from\s+['"]([^'"]+\.data(?:\.[cm]?[jt]s)?)['"]/g)) loaders[imp[1] ?? "data"] = imp[2];
	}
	return { components: out, loaders };
}

/** A dynamic route's params from its URL: `partners/[partnerId].md` written as `/partners/vehikl.html` is `{ partnerId: "vehikl" }`. */
export function routeParams(relativePath: string, url: string): Record<string, string> {
	const names = [...relativePath.matchAll(/\[(\w+)\]/g)].map((m) => m[1]);
	if (!names.length) return {};
	const pattern = new RegExp(`^/${relativePath.replace(/\.md$/, "").replace(/[.+^$()|{}\\]/g, "\\$&").replace(/\[\w+\]/g, "([^/]+?)")}(?:\\.html|/)?$`);
	const m = pattern.exec(url);
	return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) : {};
}

/** A package's ES module entry, from the site's `node_modules` (the folder and its parents): its `exports`' `import`, or `module`, or `main`. */
export function packageEntry(root: string, name: string, subpath = "."): string | undefined {
	for (let dir = root; ; dir = path.dirname(dir)) {
		const pkgDir = path.join(dir, "node_modules", ...name.split("/"));
		const file = path.join(pkgDir, "package.json");
		if (fs.existsSync(file)) {
			const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { exports?: unknown; module?: string; main?: string };
			const pick = (e: unknown): string | undefined => {
				if (typeof e === "string") return e;
				if (e === null || typeof e !== "object" || Array.isArray(e)) return undefined;
				const o = e as Record<string, unknown>;
				for (const key of ["import", "node", "default"]) if (key in o) { const p = pick(o[key]); if (p) return p; }
				return undefined;
			};
			const exp = pkg.exports;
			const entry = exp !== undefined ? pick(typeof exp === "object" && exp !== null && !Array.isArray(exp) && Object.keys(exp).some((k) => k.startsWith(".")) ? (exp as Record<string, unknown>)[subpath] : subpath === "." ? exp : undefined) : subpath === "." ? (pkg.module ?? pkg.main ?? "index.js") : undefined;
			return entry === undefined ? undefined : path.join(pkgDir, entry);
		}
		if (path.dirname(dir) === dir) return undefined;
	}
}

/**
 * A package from the site, or else from VitePress's own folder: pnpm keeps vite and
 * @vitejs/plugin-vue beside vitepress, not in the site's `node_modules` (the vuejs.org rerun).
 */
export function sitePackage(root: string, name: string): string | undefined {
	const found = packageEntry(root, name);
	if (found !== undefined) return found;
	const vitepress = path.join(root, "node_modules", "vitepress");
	if (!fs.existsSync(vitepress)) return undefined;
	return packageEntry(fs.realpathSync(vitepress), name);
}

async function fromSite(root: string, name: string): Promise<Record<string, any>> {
	const entry = sitePackage(root, name);
	if (entry === undefined) {
		const pm = fs.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm add -D" : fs.existsSync(path.join(root, "yarn.lock")) ? "yarn add -D" : "npm install -D";
		bail(`vuePlugin() needs ${name} in the site's packages, as a VitePress site has it: \`${pm} vite @vitejs/plugin-vue vue\``);
	}
	return import(pathToFileURL(entry!).href);
}

const HYDRATE = ["load", "idle", "visible"] as const;
const MARK = (n: number) => `\uE050${n}\uE051`;
const MARKS = /\uE050(\d+)\uE051/g;

BUILTINS.set("ssqch/vue", (config: Config, given) => {
	// `vitepress: true` (0.12) is fromVitepress()'s now.
	if (given !== null && typeof given === "object" && Object.hasOwn(given, "vitepress")) bail("`vitepress` is fromVitepress() from \"ssqch/from-vitepress\" now: add it to plugins, and vuePlugin() gives the components VitePress's `useData()`, `@theme/` and data loaders (`ssqch docs fromVitepress`)");
	const o = new Options(given, ["components", "root", "hydrate", "css", "vite"]);
	const globals = o.get("components") ?? {};
	if (typeof globals !== "object" || globals === null || Array.isArray(globals)) bail(`components must be an object of { Name: "path/to/Name.vue" }, the ones the site registers for every page (VitePress's \`app.component()\`) (got ${shown(globals)})`);
	for (const [name, file] of Object.entries(globals)) if (!/^[A-Z]\w*$/.test(name) || typeof file !== "string") bail(`components: ${debugString(name)} must be a PascalCase name with a .vue file's path, like { Badge: ".vitepress/theme/Badge.vue" }`);
	const hydrateGiven = o.get("hydrate");
	if (hydrateGiven !== undefined && hydrateGiven !== false && !(HYDRATE as readonly unknown[]).includes(hydrateGiven)) bail(`hydrate must be false, "load", "idle" or "visible" (got ${shown(hydrateGiven)})`);
	const hydrate = hydrateGiven === undefined || hydrateGiven === false ? false : (hydrateGiven as typeof HYDRATE[number]);
	const cssGiven = o.get("css");
	if (cssGiven !== undefined && typeof cssGiven !== "boolean" && !(typeof cssGiven === "string" && cssGiven.startsWith("/") && cssGiven.endsWith(".css"))) bail(`css must be a path like "/assets/vue.css", or false (got ${shown(cssGiven)})`);
	const cssPath = cssGiven === false ? undefined : typeof cssGiven === "string" ? cssGiven : "/assets/vue.css";
	const extra = o.get("vite") ?? {};
	if (typeof extra !== "object" || extra === null) bail(`vite must be Vite's options to add, like { resolve: { alias: { "@theme": "./.vitepress/theme" } } } (got ${shown(extra)})`);
	const rootGiven = o.string("root");
	// A VitePress site's components import `useData()` and the like from "vitepress", which only work
	// inside VitePress's app: they get a stand-in with the page's front matter, its route and the
	// site's `themeConfig`, `@theme/` is its theme's folder, and `./x.data` imports run its data
	// loaders. On with fromVitepress() (ssqch/from-vitepress), which can be listed before or after.
	const vitepressFolder = [".vitepress", "docs/.vitepress"].map((f) => path.join(config.root, f)).find((f) => fs.existsSync(f));

	const cache = path.join(config.root, ".cache", "ssqch", "vue");
	// A component the config names is from the project's root (or a package's, as written).
	const globalFile = (file: string) => (file.startsWith(".") ? path.resolve(config.root, file) : file);
	// Per build: each page's components (by its file), the module that renders them, and the work in flight.
	let byPage = new Map<string, Record<string, string>>();
	// Each page's loaders, by the name its `<script setup>` gives their data, and what each `load()` answered.
	let pageLoaders = new Map<string, Record<string, string>>();
	const loaded = new Map<string, unknown>();
	let ids = new Map<string, number>();
	let render: ((id: number, props: Record<string, unknown>, content: string, page: Record<string, unknown>) => Promise<string>) | undefined;
	let builtFrom = "";
	let pending: Array<Promise<string>> = [];
	let islands = false;

	/** The `.md` files under the input folder, and each one's components. */
	const scan = () => {
		const pages = new Map<string, Record<string, string>>();
		const walk = (dir: string) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "_site") continue;
				const full = path.join(dir, e.name);
				if (e.isDirectory()) { if (path.resolve(full) !== path.resolve(config.root, config.output)) walk(full); continue; }
				if (!/\.md$/i.test(e.name)) continue;
				const found = setupImports(fs.readFileSync(full, "utf8"));
				const files: Record<string, string> = {};
				for (const [name, spec] of Object.entries(found.components)) files[name] = spec.startsWith(".") ? path.resolve(path.dirname(full), spec) : spec;
				if (Object.keys(files).length) pages.set(path.resolve(full), files);
				const data: Record<string, string> = {};
				for (const [local, spec] of Object.entries(found.loaders)) {
					const at = path.resolve(path.dirname(full), spec);
					const file = [at, `${at}.ts`, `${at}.js`, `${at}.mts`, `${at}.mjs`].find((f) => /\.data\.[cm]?[jt]s$/.test(f) && fs.existsSync(f));
					if (file) data[local] = file;
				}
				if (Object.keys(data).length) pageLoaders.set(path.resolve(full), data);
			}
		};
		walk(path.resolve(config.root, config.input));
		return pages;
	};

	config.beforeBuild.push({ label: "", fn: async (event) => {
		// Vue picks its development or production build from NODE_ENV when it loads: ssqch's env,
		// unless it's set (without it, a production build wrote Vue's `<!--v-if-->` on every page).
		process.env.NODE_ENV ??= config.env === "production" ? "production" : "development";
		pending = [];
		islands = false;
		const changed = Array.isArray(event.changed) ? (event.changed as string[]) : undefined;
		pageLoaders = new Map();
		byPage = scan();
		const all = new Set<string>([...Object.values(globals as Record<string, string>).map(globalFile), ...[...byPage.values()].flatMap((m) => Object.values(m))]);
		const files = [...all].sort();
		ids = new Map(files.map((f, i) => [f, i]));
		const key = JSON.stringify([files, hydrate, rootGiven, cssPath]);
		// While serving, a change only to pages (Markdown, data) keeps the last build of the components.
		const codeChanged = changed === undefined || changed.some((f) => /\.(?:vue|[cm]?[jt]sx?|css|scss)$/.test(f));
		if (render && key === builtFrom && !codeChanged) return;
		if (!files.length) { render = undefined; builtFrom = key; return; }
		const [vite, vuePluginModule] = await Promise.all([fromSite(config.root, "vite"), fromSite(config.root, "@vitejs/plugin-vue")]);
		const vue = (vuePluginModule.default ?? vuePluginModule) as () => unknown;
		fs.rmSync(cache, { recursive: true, force: true });
		fs.mkdirSync(cache, { recursive: true });
		const vitepress = config.vitepress;
		const shim = path.join(cache, "vitepress.js");
		const quiet = { logLevel: config.quiet ? "silent" : "warn" };
		const root = path.resolve(config.root, rootGiven ?? config.input);
		// `__dirname` and `__filename` in the site's own modules (loaders, helpers), as VitePress gives them when it bundles them.
		const dirname = {
			name: "ssqch:dirname",
			transform(code: string, id: string) {
				if (!/\.[cm]?[jt]sx?$/.test(id.split("?")[0]) || id.includes("node_modules") || !/\b__(?:dirname|filename)\b/.test(code)) return null;
				const file = id.split("?")[0];
				return code.replace(/\b__dirname\b/g, JSON.stringify(path.dirname(file))).replace(/\b__filename\b/g, JSON.stringify(file));
			},
		};
		const given = extra as { resolve?: { alias?: unknown } };
		// VitePress's own aliases: "vitepress" (the stand-in) and `@theme/` (its theme folder).
		const alias = [...(vitepress ? [{ find: /^vitepress$/, replacement: shim }, ...(vitepressFolder ? [{ find: /^@theme\//, replacement: `${path.join(vitepressFolder, "theme")}/` }] : [])] : []), ...(Array.isArray(given.resolve?.alias) ? given.resolve!.alias as unknown[] : Object.entries((given.resolve?.alias as Record<string, string> | undefined) ?? {}).map(([find, replacement]) => ({ find, replacement })))];
		// `publicDir: false`: the site's `public/` is the site's to copy (passthrough), not the components'.
		const base = { publicDir: false, ...(extra as Record<string, unknown>), root, configFile: false, resolve: { ...(given.resolve ?? {}), alias }, ssr: { noExternal: vitepress ? ["vitepress"] : [] }, plugins: [dirname, vue(), ...((extra as { plugins?: unknown[] }).plugins ?? [])], define: { __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false, ...((extra as { define?: object }).define ?? {}) } };
		// VitePress's data loaders (`import { data } from "./api.data"`): each `load()` run once, through
		// Vite (they're TypeScript, and import what the site does), and its answer is the `data` export.
		loaded.clear();
		let runner: { ssrLoadModule(id: string): Promise<Record<string, any>>; close(): Promise<void> } | undefined;
		const runLoader = async (file: string) => {
			if (loaded.has(file)) return;
			runner ??= await vite.createServer({ ...base, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
			let mod: Record<string, any>;
			try { mod = await runner!.ssrLoadModule(file); } catch (e) { throw new BuildError(`vuePlugin(): the data loader ${path.relative(config.root, file)} didn't load: ${e instanceof Error ? e.message : String(e)}`); }
			const loader = mod.default;
			if (!loader || typeof loader.load !== "function") throw new BuildError(`vuePlugin(): ${path.relative(config.root, file)} is imported as a data loader, but its default export has no \`load()\` (VitePress's \`export default { load() { ... } }\`)`);
			loaded.set(file, await loader.load());
		};
		const loaders = {
			name: "ssqch:vitepress-loaders",
			enforce: "pre",
			async resolveId(source: string, importer: string | undefined) {
				if (!importer || !/\.data(?:\.[cm]?[jt]s)?$/.test(source) || importer.startsWith("\0")) return null;
				const base = source.startsWith(".") ? path.resolve(path.dirname(importer.split("?")[0]), source) : undefined;
				if (base === undefined) return null;
				const file = [base, `${base}.ts`, `${base}.js`, `${base}.mts`, `${base}.mjs`].find((f) => /\.data\.[cm]?[jt]s$/.test(f) && fs.existsSync(f));
				return file === undefined ? null : `\0ssqch-loader:${file}`;
			},
			async load(id: string) {
				if (!id.startsWith("\0ssqch-loader:")) return null;
				const file = id.slice("\0ssqch-loader:".length);
				await runLoader(file);
				return `export const data = ${JSON.stringify(loaded.get(file))};`;
			},
		};
		// The stand-in for "vitepress", with the site's config (its `themeConfig`) as VitePress read it.
		if (vitepress) {
			let siteConfig: Record<string, unknown> = {};
			const file = vitepressFolder && ["config.ts", "config.mts", "config.js", "config.mjs"].map((f) => path.join(vitepressFolder, f)).find((f) => fs.existsSync(f));
			if (file) {
				const reader = await vite.createServer({ root: config.root, configFile: false, plugins: [dirname], logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
				try { siteConfig = (await reader.ssrLoadModule(file)).default ?? {}; } catch { /* a config that only runs inside VitePress: the components get an empty one */ } finally { await reader.close(); }
			}
			const site = { title: siteConfig.title ?? "", description: siteConfig.description ?? "", base: config.base || "/", lang: siteConfig.lang ?? "en-US", themeConfig: siteConfig.themeConfig ?? {} };
			fs.writeFileSync(shim, [
				`import { ref, computed } from "vue";`,
				`export const current = { page: ref({ relativePath: "", frontmatter: {}, params: {}, title: "" }), frontmatter: ref({}), params: ref({}) };`,
				`const site = ref(${JSON.stringify(site)});`,
				`export const useData = () => ({ site, theme: computed(() => site.value.themeConfig), page: current.page, frontmatter: current.frontmatter, params: current.params, title: computed(() => current.page.value.title), description: computed(() => current.frontmatter.value.description ?? site.value.description), lang: computed(() => site.value.lang), isDark: ref(false), localeIndex: ref("root"), hash: ref("") });`,
				`export const useRoute = () => ({ path: "/" + current.page.value.relativePath.replace(/(^|\\/)index\\.md$/, "$1").replace(/\\.md$/, ${JSON.stringify(config.urls === "html" ? ".html" : "/")}), data: current.page.value, component: null });`,
				`export const useRouter = () => ({ route: useRoute(), go: () => {} });`,
				`export const withBase = (p) => (p.startsWith("/") ? ${JSON.stringify(config.base.replace(/\/$/, ""))} + p : p);`,
				`export const inBrowser = false;`,
				`export const defineLoader = (loader) => loader;`,
				`export const defineConfig = (c) => c;`,
				`export const defineConfigWithTheme = (c) => c;`,
				`export const onContentUpdated = () => {};`,
				`export const Content = { render: () => null };`,
				`export const ClientOnly = { setup: () => () => null };`,
				"",
			].join("\n"));
		}
		const imports = files.map((f, i) => `import C${i} from ${JSON.stringify(f)};`).join("\n");
		const server = path.join(cache, "server.js");
		fs.writeFileSync(server, [
			`import { createSSRApp, h, createStaticVNode } from "vue";`,
			`import { renderToString } from "vue/server-renderer";`,
			...(vitepress ? [`import { current } from ${JSON.stringify(shim)};`] : []),
			imports,
			`const components = [${files.map((_, i) => `C${i}`).join(", ")}];`,
			`export async function render(id, props, content, page) {`,
			...(vitepress ? [`  current.page.value = page; current.frontmatter.value = page.frontmatter; current.params.value = page.params;`] : []),
			// What's between the tags is the default slot, as the page's HTML.
			`  const app = createSSRApp({ render: () => h(components[id], props, content ? { default: () => createStaticVNode(content, 1) } : undefined) });`,
			// VitePress's <ClientOnly> renders nothing on the server.
			`  app.component("ClientOnly", { setup: () => () => null });`,
			`  return renderToString(app);`,
			`}`,
			"",
		].join("\n"));
		try {
			await vite.build({ ...base, plugins: [...(vitepress ? [loaders] : []), ...base.plugins], ...quiet, base: config.base || "/", build: { ssr: server, outDir: path.join(cache, "ssr"), emptyOutDir: true, minify: false, cssCodeSplit: false, ssrEmitAssets: true, rollupOptions: { output: { entryFileNames: "server.mjs" } } } });
		} catch (e) { throw e instanceof BuildError ? e : new BuildError(`vuePlugin(): Vite couldn't build the components for the server: ${e instanceof Error ? e.message : String(e)}`); }
		// The loaders pages import for their own bindings (`:errors="data.runtime"`).
		for (const file of new Set([...pageLoaders.values()].flatMap((m) => Object.values(m)))) await runLoader(file);
		await runner?.close();
		const mod = await import(`${pathToFileURL(path.join(cache, "ssr", "server.mjs")).href}?${Date.now()}`);
		render = mod.render;
		// The browser's: each component its own chunk, loaded where a page has it.
		if (hydrate) {
			const client = path.join(cache, "client.js");
			fs.writeFileSync(client, [
				`import { createSSRApp, h } from "vue";`,
				`const load = [${files.map((f) => `() => import(${JSON.stringify(f)})`).join(", ")}];`,
				`const start = (el) => load[Number(el.dataset.component)]().then((m) => { createSSRApp({ render: () => h(m.default, JSON.parse(el.dataset.props || "{}")) }).mount(el); });`,
				`for (const el of document.querySelectorAll("ssqch-vue")) {`,
				`  const when = el.dataset.hydrate;`,
				`  if (when === "visible" && "IntersectionObserver" in window) { const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); start(el); } }); seen.observe(el); }`,
				`  else if (when === "idle" && "requestIdleCallback" in window) requestIdleCallback(() => start(el));`,
				`  else start(el);`,
				`}`,
				"",
			].join("\n"));
			try {
				await vite.build({ ...base, plugins: [...(vitepress ? [loaders] : []), ...base.plugins], ...quiet, base: `${config.base.replace(/\/$/, "")}/assets/vue/`, build: { outDir: path.join(cache, "client"), emptyOutDir: true, manifest: false, cssCodeSplit: false, rollupOptions: { input: client, output: { entryFileNames: "islands.js", chunkFileNames: "[name]-[hash].js", assetFileNames: "[name]-[hash][extname]" } } } });
			} catch (e) { throw new BuildError(`vuePlugin(): Vite couldn't build the components for the browser: ${e instanceof Error ? e.message : String(e)}`); }
		}
		builtFrom = key;
	} });

	// A component's tag: started now, with its props read against the page's data, and filled in
	// when the page is written.
	config.componentRenderers.push((name, value, inputPath, data) => {
		if (!render) return undefined;
		const pageFile = byPage.get(path.resolve(inputPath))?.[name];
		const globalName = (globals as Record<string, string>)[name];
		const file = pageFile ?? (globalName === undefined ? undefined : globalFile(globalName));
		const id = file === undefined ? undefined : ids.get(file);
		if (id === undefined) return undefined;
		// Props by Vue's names: a `kebab-case` attribute is there in camelCase too, and `class` and
		// `style` fall through to the component's root element, as Vue does with them.
		const props = Object.fromEntries(Object.entries(value.props).filter(([k]) => !k.includes("-") && k !== "class" && k !== "style"));
		const attrs = Object.fromEntries(Object.entries(value.props).filter(([k]) => k === "class" || k === "style"));
		// What `useData()` gives the component: the page's front matter, title and path from the input folder.
		const front = Object.fromEntries(Object.entries(data).filter(([k]) => !["collections", "page", "content", "pagination", "eleventyComputed", "computed"].includes(k) && typeof data[k] !== "function"));
		const relativePath = path.relative(path.resolve(config.root, config.input), inputPath).split(path.sep).join("/");
		const url = typeof (data.page as { url?: unknown } | undefined)?.url === "string" ? (data.page as { url: string }).url : "";
		const params = (data.params as Record<string, unknown> | undefined) ?? routeParams(relativePath, url);
		// A dynamic route's page is its own path in VitePress (`partners/vehikl.md`), not its file's (`[partnerId].md`).
		const ownPath = relativePath.includes("[") && url !== "" ? url.replace(/^\//, "").replace(/(^|\/)$/, "$1index.html").replace(/\.html$/, ".md").replace(/^(?!.*\.md$)(.*)$/, "$1.md") : relativePath;
		const page = { relativePath: ownPath, frontmatter: front, params, title: typeof data.title === "string" ? data.title : "" };
		// Bindings, as Vue reads them in the page: with its loaders' data, `params` and `frontmatter` in scope.
		// `page` is `useData()`'s, which a page's script takes (`const { page } = useData()`) and its template reads unwrapped.
		const scope: Record<string, unknown> = { page, params, $params: params, frontmatter: front, $frontmatter: front };
		for (const [local, file] of Object.entries(pageLoaders.get(path.resolve(inputPath)) ?? {})) scope[local] = loaded.get(file);
		for (const [prop, expr] of Object.entries(value.bindings)) {
			try { props[prop] = new Function(...Object.keys(scope), `"use strict"; return (${expr});`)(...Object.values(scope)); } catch { /* left as the page's data read it */ }
		}
		// The components inside its slot first: Vue gets their HTML, not their markers.
		const pageJson = JSON.parse(JSON.stringify(page, (_, v) => (v instanceof Date ? v.toISOString() : v)));
		const html = fill(value.content).then((content) => render!(id, { ...props, ...attrs }, content, pageJson)).then(
			(h) => {
				if (!hydrate) return h;
				islands = true;
				return `<ssqch-vue data-component="${id}" data-hydrate="${hydrate}" data-props="${JSON.stringify(props).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${h}</ssqch-vue>`;
			},
			(e: unknown) => { throw new BuildError(`vuePlugin(): <${name}> in ${path.relative(config.root, inputPath)} didn't render: ${e instanceof Error ? e.message : String(e)}`); },
		);
		// A page that isn't written (`permalink: false`) never asks for it.
		html.catch(() => {});
		pending.push(html);
		return MARK(pending.length - 1);
	});

	config.htmlTransforms.push(["vue", async (content, page) => {
		if (!content.includes("\uE050")) return content;
		let out: string;
		try { out = await fill(content); } catch (e) { throw e instanceof BuildError ? e : new BuildError(`vuePlugin(): ${page.inputPath}: ${e instanceof Error ? e.message : String(e)}`); }
		// The islands' script, once, before the page's end.
		if (hydrate && out.includes("<ssqch-vue ")) {
			const tag = `<script type="module" src="${config.base.replace(/\/$/, "")}/assets/vue/islands.js"></script>`;
			out = out.includes("</body>") ? out.replace("</body>", `${tag}</body>`) : out + tag;
		}
		return out;
	}]);

	/** `text` with each component's marker replaced by its HTML, again until none are left (one inside another's HTML: a layout component's slot holds the page's). */
	async function fill(text: string): Promise<string> {
		for (let round = 0; text.includes("\uE050"); round++) {
			if (round > 50) throw new BuildError("vuePlugin(): components nest more than 50 deep");
			const done = new Map<number, string>();
			for (const m of text.matchAll(MARKS)) {
				const n = Number(m[1]);
				if (pending[n] === undefined) throw new BuildError(`vuePlugin(): a component's HTML went missing (marker ${n}): this is a bug in ssqch`);
				done.set(n, await pending[n]);
			}
			text = text.replace(MARKS, (_, n: string) => done.get(Number(n))!);
		}
		return text;
	}

	// The components' styles, and the browser's modules.
	config.generators.push(["ssqch/vue", () => {
		const files: GeneratedFile[] = [];
		if (!render) return files;
		const ssrDir = path.join(cache, "ssr");
		const listed = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort() : []);
		const ssr = listed(ssrDir);
		const css = ssr.filter((f) => f.endsWith(".css"));
		if (cssPath && css.length) {
			files.push({ path: cssPath, contents: css.map((f) => fs.readFileSync(path.join(ssrDir, f), "utf8")).join("\n") });
			// What the styles point at (the theme's fonts, images), where Vite wrote them: `/assets/inter-x.woff2`.
			for (const f of ssr) if (!/\.(?:[cm]?js|css|map)$/.test(f)) files.push({ path: `/${f.split(path.sep).join("/")}`, contents: fs.readFileSync(path.join(ssrDir, f)) });
		}
		const clientDir = path.join(cache, "client");
		if (hydrate && islands) {
			for (const f of listed(clientDir)) {
				if (f.endsWith(".map")) continue;
				const full = path.join(clientDir, f);
				files.push({ path: `/assets/vue/${f.split(path.sep).join("/")}`, contents: /\.(?:[cm]?js|css|svg|json)$/.test(f) ? fs.readFileSync(full, "utf8") : fs.readFileSync(full) });
			}
		}
		return files;
	}]);
});
