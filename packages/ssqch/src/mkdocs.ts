// `mkdocsTemplates: true`: templates see what MkDocs gives a theme's (`config`, `nav`, `page`,
// `base_url`, the `url` filter), so an MkDocs theme's Jinja templates (Material for MkDocs')
// run as they're written. Every fresh MkDocs move wrote this context itself, about 220 lines
// each time (the httpx move's `mkdocs-compat/index.js`), as `jekyllTemplates` is Jekyll's.
//
// What it rebuilds is MkDocs 1.6's: `mkdocs/commands/build.py` (get_context),
// `mkdocs/structure/nav.py` (Section, Page, Link), `mkdocs/utils/__init__.py` (normalize_url,
// get_relative_url), and the theme's own defaults (`mkdocs_theme.yml`) under `mkdocs.yml`'s
// `theme`. Pages are ssqch's: a page's URL is the one ssqch gives it.
import fs from "node:fs";
import path from "node:path";
import { BuildError } from "./diagnostics.ts";
import type { Data } from "./data.ts";
import { isPlainObject, parseYaml, sourceDateEpoch } from "./data.ts";
import { compareText } from "./paths.ts";
import { safe } from "./rendering.ts";
import { readValues } from "./plugin-files.ts";

export const MKDOCS_VERSION = "1.6.1";

/** mkdocs.yml as plain data: Python's YAML tags (`!!python/name:x`, `!ENV`, `!relative`) read as the values they'd give. */
export function readMkdocsYaml(text: string, file = "mkdocs.yml"): Data {
	const plain = text.replace(/!!python\/name:(\S+)/g, '"$1"').replace(/!!python\/[\w/:.-]+/g, "").replace(/!ENV\s+\[([^\]]*)\]/g, (_m, args: string) => args.split(",").at(-1)!.trim()).replace(/!ENV\s+/g, "").replace(/!relative\s*/g, "");
	try { return parseYaml(plain) as Data; } catch (e) { throw new BuildError(`${file}: ${e instanceof Error ? e.message : String(e)}`); }
}

/** Material's plugins, which MkDocs names `material/<name>` when the theme is Material's. */
const MATERIAL_PLUGINS = new Set(["search", "blog", "tags", "social", "offline", "privacy", "info", "group", "meta", "optimize", "projects", "typeset"]);

/** What MkDocs reads from mkdocs.yml and the theme, once a build. */
export interface MkDocs {
	config: Data;
	/** mkdocs.yml's `nav`, as written, or `undefined` for one from the files. */
	nav: unknown[] | undefined;
	buildDate: Date;
}

/** mkdocs.yml (`file`, from the project root), with the theme's `mkdocs_theme.yml` (the first include folder that has one) below its `theme`. */
export function loadMkdocs(root: string, file: string, includeDirs: string[]): MkDocs {
	const full = path.resolve(root, file);
	let text: string;
	readValues(full);
	try { text = fs.readFileSync(full, "utf8"); } catch { throw new BuildError(`mkdocsTemplates: there's no ${file} in ${root} (give its path: \`mkdocsTemplates: "docs/mkdocs.yml"\`)`); }
	const raw = readMkdocsYaml(text, file);
	const themeFile = includeDirs.map((dir) => path.join(dir, "mkdocs_theme.yml")).find((f) => fs.existsSync(f));
	const defaults = themeFile ? readMkdocsYaml(fs.readFileSync(themeFile, "utf8"), path.relative(root, themeFile)) : {};
	for (const key of ["extends", "static_templates", "locale"]) delete defaults[key];
	const own = typeof raw.theme === "string" ? { name: raw.theme } : isPlainObject(raw.theme) ? raw.theme : {};
	const theme: Data = { ...defaults, ...own };
	theme.language ??= "en";
	theme.features ??= [];
	theme.icon ??= {};
	const material = theme.name === "material";
	const plugins: Data = {};
	const listed = raw.plugins === undefined ? ["search"] : Array.isArray(raw.plugins) ? raw.plugins : isPlainObject(raw.plugins) ? Object.entries(raw.plugins).map(([k, v]) => ({ [k]: v })) : [];
	for (const entry of listed) {
		const [name, options] = isPlainObject(entry) ? Object.entries(entry)[0] ?? [] : [String(entry), undefined];
		if (typeof name !== "string") continue;
		const key = material && !name.includes("/") && MATERIAL_PLUGINS.has(name) ? `material/${name}` : name;
		const config: Data = { enabled: true, ...(isPlainObject(options) ? options : {}) };
		if (/(?:^|\/)search$/.test(key)) for (const k of ["lang", "separator", "pipeline"]) config[k] ??= null;
		plugins[key] = { config };
	}
	const or = (key: string, fallback: unknown = null) => (raw[key] === undefined ? fallback : raw[key]);
	const config: Data = {
		site_name: or("site_name"),
		site_description: or("site_description"),
		site_author: or("site_author"),
		site_url: or("site_url"),
		repo_url: or("repo_url"),
		repo_name: or("repo_name", typeof raw.repo_url === "string" ? repoName(raw.repo_url) : null),
		edit_uri: or("edit_uri", typeof raw.repo_url === "string" ? defaultEditUri(raw.repo_url, String(or("docs_dir", "docs"))) : null),
		copyright: or("copyright"),
		docs_dir: or("docs_dir", "docs"),
		site_dir: or("site_dir", "site"),
		use_directory_urls: or("use_directory_urls", true),
		theme,
		nav: or("nav"),
		extra: or("extra", {}),
		extra_css: or("extra_css", []),
		extra_javascript: or("extra_javascript", []),
		extra_templates: or("extra_templates", []),
		markdown_extensions: or("markdown_extensions", []),
		mdx_configs: {},
		plugins,
		strict: or("strict", false),
	};
	const epoch = sourceDateEpoch();
	return { config, nav: Array.isArray(raw.nav) ? raw.nav : undefined, buildDate: new Date(epoch ?? Date.now()) };
}

/** MkDocs' repo_name from a repo_url: GitHub, GitLab and Bitbucket's. */
function repoName(url: string): string | null {
	const host = /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1]?.toLowerCase() ?? "";
	if (host === "github.com") return "GitHub";
	if (host === "bitbucket.org") return "Bitbucket";
	if (host === "gitlab.com") return "GitLab";
	return host.split(".")[0] || null;
}

function defaultEditUri(url: string, docsDir: string): string | null {
	const host = /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1]?.toLowerCase() ?? "";
	if (host === "github.com" || host === "gitlab.com") return `edit/master/${docsDir}/`;
	if (host === "bitbucket.org") return `src/default/${docsDir}/`;
	return null;
}

/** What the nav needs of a page: its source from the docs folder, its URL, and how to title it. */
export interface NavPage { src: string; url: string; title: string | null; meta: Data; firstHeading: () => string | null }

/** MkDocs' `get_relative_url(url, other)`: `url` from the page at `other`. */
export function relativeUrl(url: string, other: string): string {
	const slash = other.lastIndexOf("/");
	if (other.slice(slash + 1).includes(".")) other = slash === -1 ? "" : other.slice(0, slash);
	const parts = (p: string) => {
		let n = path.posix.normalize(p.startsWith("/") ? p : `/${p}`);
		if (n.length > 1 && n.endsWith("/")) n = n.slice(0, -1);
		n = n.slice(1);
		return n ? n.split("/") : [];
	};
	const from = parts(other);
	const to = parts(url);
	let common = 0;
	while (common < from.length && common < to.length && from[common] === to[common]) common++;
	const rel = [...Array(from.length - common).fill(".."), ...to.slice(common)].join("/") || ".";
	return url.endsWith("/") ? `${rel}/` : rel;
}

/**
 * MkDocs' `url` filter (`normalize_url`): a path from the site's root made relative to the
 * page, with `../` parts kept; a full URL, `/x` and `#x` are as they are. With no page (the 404
 * page), it's under `base`.
 */
export function normalizeUrl(value: unknown, pageUrl: string | null, base = ""): string {
	const given = value === undefined || value === null || value === "" ? "." : String(value);
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(given) || given.startsWith("/") || given.startsWith("#")) return given;
	const norm = `${path.posix.normalize(given)}/`;
	let level = 0;
	while (norm.startsWith("../", level * 3)) level++;
	if (pageUrl !== null) return "../".repeat(level) + relativeUrl(given, pageUrl);
	return given.startsWith("/") ? given : base === "" || base.endsWith("/") ? base + given : `${base}/${given}`;
}

/** A Markdown file's title from its name, as MkDocs makes one (`getting-started.md` is `Getting started`). */
function titleFromName(src: string): string {
	const name = path.posix.basename(src).replace(/\.(?:md|markdown)$/i, "");
	const folder = path.posix.dirname(src);
	const base = name === "index" || name === "README" ? (folder === "." ? "Home" : path.posix.basename(folder)) : name;
	const words = base.replace(/[-_]/g, " ");
	return words === words.toLowerCase() ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/** MkDocs' order for files with no `nav`: by folder, each folder's index first, then by name. */
function fileOrder(a: string, b: string): number {
	const pa = a.split("/"), pb = b.split("/");
	const [da, db] = [pa.slice(0, -1), pb.slice(0, -1)];
	for (let i = 0; i < Math.min(da.length, db.length); i++) if (da[i] !== db[i]) return compareText(da[i], db[i]);
	if (da.length !== db.length) return da.length - db.length;
	const index = (p: string[]) => /^(?:index|README)\.(?:md|markdown)$/i.test(p.at(-1)!);
	if (index(pa) !== index(pb)) return index(pa) ? -1 : 1;
	return compareText(pa.at(-1)!, pb.at(-1)!);
}

/**
 * MkDocs' `nav` for the page at `current` (a source path, or `null` for none): Sections, Pages
 * and Links, with `active` on the page and its sections, `previous_page` and `next_page`,
 * `ancestors`, and `nav.items`, `nav.pages` and `nav.homepage`. Made for each page, so the
 * current page is the nav's own object (`nav_item == page` in a template).
 */
export function buildNav(mk: MkDocs, pages: NavPage[], current: string | null): { nav: Data[] & Data; page: Data | null } {
	const bySrc = new Map(pages.map((p) => [p.src, p]));
	const siteUrl = typeof mk.config.site_url === "string" ? mk.config.site_url : null;
	const order: Data[] = [];
	let found: Data | null = null;
	const pageObject = (src: string, title: string | null, parent: Data | null, inNav = true): Data => {
		const p = bySrc.get(src);
		const url = p ? p.url.replace(/^\//, "") : src.replace(/\.(?:md|markdown)$/i, "/");
		const editUri = typeof mk.config.edit_uri === "string" && mk.config.edit_uri !== "" && typeof mk.config.repo_url === "string" ? mk.config.edit_uri : null;
		const repo = typeof mk.config.repo_url === "string" ? (mk.config.repo_url.endsWith("/") ? mk.config.repo_url : `${mk.config.repo_url}/`) : "";
		const page: Data = {
			title: title ?? p?.title ?? p?.firstHeading() ?? titleFromName(src),
			url,
			abs_url: `/${url}`,
			canonical_url: siteUrl ? new URL(url, siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`).href : null,
			edit_url: editUri === null ? null : /^[a-z]+:\/\//i.test(editUri) ? `${editUri}${src}` : `${repo}${editUri}${src}`,
			file: { src_uri: src, src_path: src, name: path.posix.basename(src).replace(/\.[^.]+$/, ""), url, dest_uri: url.endsWith("/") || url === "" ? `${url}index.html` : url },
			meta: p?.meta ?? {},
			is_page: true, is_section: false, is_link: false,
			is_homepage: url === "", is_index: /(?:^|\/)(?:index|README)\.(?:md|markdown)$/i.test(src), is_top_level: parent === null,
			active: false, parent, children: null, ancestors: [],
			update_date: mk.buildDate.toISOString().slice(0, 10),
			toc: [], content: null,
		};
		if (inNav) order.push(page);
		if (src === current) found = page;
		return page;
	};
	const item = (entry: unknown, parent: Data | null): Data | undefined => {
		let title: string | null = null;
		let value = entry;
		if (isPlainObject(entry)) [[title, value]] = Object.entries(entry) as [[string, unknown]];
		if (Array.isArray(value)) {
			const section: Data = { title, is_section: true, is_page: false, is_link: false, active: false, parent, children: [], ancestors: [] };
			section.children = value.map((e) => item(e, section)).filter(Boolean);
			return section;
		}
		if (typeof value !== "string") return undefined;
		if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/")) return { title, url: value, is_link: true, is_page: false, is_section: false, active: false, parent, children: null };
		return pageObject(path.posix.normalize(value), title, parent);
	};
	let items: Data[];
	if (mk.nav) items = mk.nav.map((e) => item(e, null)).filter((x): x is Data => x !== undefined);
	else {
		// No nav: the files, by folder, a Section for each folder.
		items = [];
		const sections = new Map<string, Data>();
		const sectionFor = (dir: string): Data | null => {
			if (dir === "." || dir === "") return null;
			let s = sections.get(dir);
			if (s) return s;
			const parent = sectionFor(path.posix.dirname(dir));
			const name = path.posix.basename(dir).replace(/[-_]/g, " ");
			s = { title: name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name, is_section: true, is_page: false, is_link: false, active: false, parent, children: [], ancestors: [] };
			sections.set(dir, s);
			(parent ? parent.children as Data[] : items).push(s);
			return s;
		};
		for (const src of pages.map((p) => p.src).sort(fileOrder)) {
			const parent = sectionFor(path.posix.dirname(src));
			const page = pageObject(src, null, parent);
			(parent ? parent.children as Data[] : items).push(page);
		}
	}
	order.forEach((p, i) => { p.previous_page = order[i - 1] ?? null; p.next_page = order[i + 1] ?? null; });
	const ancestorsOf = (x: Data) => { const out: Data[] = []; for (let a = x.parent as Data | null; a; a = a.parent as Data | null) out.push(a); return out; };
	for (const p of order) p.ancestors = ancestorsOf(p);
	const nav = Object.assign([...items], { items, pages: order, homepage: order.find((p) => p.is_homepage) ?? null }) as Data[] & Data;
	// A page the nav doesn't list is a page all the same, with no neighbours.
	if (found === null && current !== null && bySrc.has(current)) {
		found = pageObject(current, null, null, false);
		(found as Data).previous_page = null;
		(found as Data).next_page = null;
	}
	const page = found as Data | null;
	if (page) for (let x: Data | null = page; x; x = x.parent as Data | null) x.active = true;
	return { nav, page };
}

/** Python-Markdown's toc tokens, nested, from a page's headings: MkDocs' `page.toc`. */
export function tocOf(headings: Array<{ level: number; id?: string; text: string }>): Data[] {
	const root: Data[] = [];
	const stack: Data[] = [];
	for (const h of headings) {
		if (!h.id) continue;
		const token: Data = { title: h.text, id: h.id, url: `#${h.id}`, level: h.level, children: [] };
		while (stack.length && (stack.at(-1)!.level as number) >= h.level) stack.pop();
		(stack.length ? stack.at(-1)!.children as Data[] : root).push(token);
		stack.push(token);
	}
	return root;
}

/** What every template sees with `mkdocsTemplates`, besides `nav`, `page` and `base_url`. */
export function mkdocsGlobals(mk: MkDocs): Data {
	return { config: mk.config, mkdocs_version: MKDOCS_VERSION, build_date_utc: mk.buildDate };
}

/** The path the site is served under, from site_url (`https://x.org/docs/` is `/docs/`), for the 404 page's URLs. */
export function sitePath(mk: MkDocs): string {
	const url = mk.config.site_url;
	if (typeof url !== "string") return "/";
	try { return new URL(url).pathname || "/"; } catch { return "/"; }
}

/** MkDocs' filters: `url` (a URL relative to the page being rendered) and `script_tag` (an `extra_javascript` entry as a `<script>`). They read the page from `this.page`. */
export function mkdocsFilters(mk: MkDocs): Record<string, (this: { page?: Data | null } | undefined, ...args: unknown[]) => unknown> {
	const pageUrl = (self: { page?: Data | null } | undefined): string | null => {
		const p = self?.page;
		if (p === null || p === undefined) return null;
		// MkDocs' page (in a layout) has its URL without the first `/`; ssqch's (in a page) with it.
		return typeof p.abs_url === "string" ? String(p.url) : String(p.url ?? "").replace(/^\//, "");
	};
	return {
		url(value: unknown) { return normalizeUrl(value, pageUrl(this), sitePath(mk)); },
		script_tag(value: unknown) {
			const script = isPlainObject(value) ? value : { path: value };
			const src = normalizeUrl(script.path, pageUrl(this), sitePath(mk));
			const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
			return safe(`<script src="${attr(src)}"${script.type ? ` type="${attr(String(script.type))}"` : ""}${script.defer ? " defer" : ""}${script.async ? " async" : ""}></script>`);
		},
	};
}
