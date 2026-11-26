// `ssqch/elements`: custom elements without a framework. A custom element is a tag with a hyphen
// in its name (`<like-button>`) whose behaviour comes from a script that defines it. Put that
// script in the elements folder as `like-button.js` (with `like-button.css` next to it, if it has
// styles), and write the tag in any page or layout: each page gets the scripts and stylesheets of
// the elements it uses, and no others. What's inside the tag is what a visitor without JavaScript
// (or before the script loads) sees, so write the fallback there.
//
// `ssqch:load` on a tag says when its script loads: `eager` (with the page, the default), `idle`
// (when the browser has a quiet moment) or `visible` (when the element scrolls into view), which
// keeps a page's first load light: an "island". Ported from `plugins/elements`.
import fs from "node:fs";
import path from "node:path";
import { BUILTINS } from "../config.ts";
import type { Config } from "../config.ts";
import { withBase } from "../base.ts";
import { bail, context } from "../diagnostics.ts";
import { rewriteHtml } from "../html.ts";
import { compareText, displayPath, isDir, isFile, slashes } from "../paths.ts";
import { count } from "../report.ts";
import { Options } from "./options.ts";
import { debugString } from "./plugin-util.ts";

export function elementsPlugin(options: Record<string, unknown> = {}) {
	return { name: "ssqch/elements", builtin: "ssqch/elements", options };
}

/** When an element's script loads. */
type Load = "eager" | "idle" | "visible";
/** In the order a tag's loads are compared: the earlier wins. */
const LOADS: Load[] = ["eager", "idle", "visible"];
const parseLoad = (s: string): Load | undefined => LOADS.find((l) => l === s);

/** An element the site defines: the URLs of its script and stylesheet. */
interface Element {
	script: string;
	style?: string;
}

/** Whether `name` can be a custom element's: lowercase, with a hyphen. */
export function isElementName(name: string): boolean {
	return name.includes("-") && /^[a-z][a-z0-9_.-]*$/.test(name);
}

/** The elements in `dir`: every `.js` or `.mjs` file named like a custom element, at any depth, with the `.css` file of the same name next to it. */
function scan(root: string, dir: string, url: string): Map<string, Element> {
	if (!isDir(dir)) bail(`the elements folder ${displayPath(root, dir)} doesn't exist; create it, or set \`dir\``);
	const out = new Map<string, Element>();
	const sources = new Map<string, string>();
	const walk = (folder: string) => {
		const entries = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name));
		for (const entry of entries) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) { walk(file); continue; }
			const ext = path.extname(entry.name);
			if (!entry.isFile() || (ext !== ".js" && ext !== ".mjs")) continue;
			const stem = path.basename(entry.name, ext);
			if (!isElementName(stem)) continue;
			const rel = slashes(path.relative(dir, file));
			const other = sources.get(stem);
			if (other !== undefined) bail(`${other} and ${rel} both define <${stem}>; keep one`);
			sources.set(stem, rel);
			const css = path.join(folder, `${stem}.css`);
			out.set(stem, { script: url + rel, style: isFile(css) ? url + slashes(path.relative(dir, css)) : undefined });
		}
	};
	walk(dir);
	return out;
}

/** What a page uses: each element's tag and when to load it. */
type Used = Map<string, Load>;

/** Finds the known elements in `html`, taking `ssqch:load` off their tags. */
export function findUsed(html: string, known: Map<string, Element>, fallback: Load): { html: string; used: Used } {
	const used: Used = new Map();
	let problem: string | undefined;
	const out = rewriteHtml(html, {
		tag(el) {
			const tag = el.name;
			if (!known.has(tag)) return;
			let load = fallback;
			const value = el.get("ssqch:load");
			if (value !== undefined) {
				el.remove("ssqch:load");
				const parsed = parseLoad(value.trim());
				if (parsed === undefined) problem = `<${tag} ssqch:load="${value}">: use eager, idle or visible`;
				else load = parsed;
			}
			// Two tags that disagree: the earlier load wins.
			const slot = used.get(tag);
			used.set(tag, slot === undefined || LOADS.indexOf(load) < LOADS.indexOf(slot) ? load : slot);
		},
	});
	if (problem !== undefined) bail(problem);
	return { html: out, used };
}

const jsString = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("<", "\\u003c")}"`;

/** The tags to add for what a page uses: for the head, and for the end of the body. */
export function tags(used: Used, known: Map<string, Element>, base: string): [string, string] {
	let head = "";
	let body = "";
	const lazy: string[] = [];
	for (const [tag, load] of [...used].sort((a, b) => compareText(a[0], b[0]))) {
		const element = known.get(tag)!;
		if (element.style !== undefined) head += `<link rel="stylesheet" href="${element.style}">\n`;
		if (load === "eager") body += `<script type="module" src="${element.script}"></script>\n`;
		// In a script, so the build's `base` isn't added for us.
		else lazy.push(`[${jsString(tag)},${jsString(withBase(base, element.script))},${jsString(load)}]`);
	}
	if (lazy.length) {
		body += `<script type="module">const idle=window.requestIdleCallback||((f)=>setTimeout(f,200));for(const[tag,src,when]of[${lazy.join(",")}]){if(when==="idle"){idle(()=>import(src));continue}const seen=new IntersectionObserver((entries)=>{if(entries.some((e)=>e.isIntersecting)){seen.disconnect();import(src)}},{rootMargin:"200px"});document.querySelectorAll(tag).forEach((el)=>seen.observe(el))}</script>\n`;
	}
	return [head, body];
}

const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** `html` with `addition` before the first (or last) `close` tag (`</body>`), or at the end. */
export function insertBefore(html: string, close: string, addition: string, last: boolean): string {
	if (addition === "") return html;
	const lower = asciiLower(html);
	const at = last ? lower.lastIndexOf(close) : lower.indexOf(close);
	return at === -1 ? html + addition : html.slice(0, at) + addition + html.slice(at);
}

BUILTINS.set("ssqch/elements", (config: Config, given) => {
	const o = new Options(given, ["dir", "url", "load"]);
	const dirOption = o.string("dir");
	let url = o.string("url") ?? "/elements/";
	const loadOption = o.string("load");
	let fallback: Load = "eager";
	if (loadOption !== undefined) {
		const parsed = parseLoad(loadOption);
		if (parsed === undefined) bail(`load must be "eager", "idle" or "visible", not ${debugString(loadOption)}`);
		fallback = parsed;
	}
	if (!url.startsWith("/") || url.includes("..")) bail(`url must be a URL path starting with /, like "/elements/" (got ${debugString(url)})`);
	if (!url.endsWith("/")) url += "/";

	const dir = dirOption ?? path.join(config.input, "elements");
	// The whole folder goes to the output, so elements can import shared modules.
	config.passthrough.push({ from: dir, to: url.replace(/^\/+|\/+$/g, "") });
	config.watch.push(dir);

	let known = new Map<string, Element>();
	let pages = 0;
	const usedNames = new Set<string>();
	// While serving: the elements each page used, by its URL, for the summary of a rebuild that
	// takes some pages as they were (`incremental` in site.ts).
	const perPage = new Map<string, string[]>();
	let thisBuild = new Map<string, string[]>();
	config.replays.push((skipped, rendered) => {
		for (const url of rendered) {
			const names = thisBuild.get(url);
			if (names) perPage.set(url, names);
			else perPage.delete(url);
		}
		for (const url of skipped) {
			const names = perPage.get(url);
			if (!names) continue;
			pages++;
			for (const name of names) usedNames.add(name);
		}
		thisBuild = new Map();
	});
	config.beforeBuild.push({
		label: "",
		fn: () => {
			try { known = scan(config.root, path.resolve(config.root, dir), url); } catch (e) { throw context(e, "elements"); }
			pages = 0;
			usedNames.clear();
		},
	});

	config.htmlTransforms.push(["elements", (html, page) => {
		if (!page.outputPath.endsWith(".html")) return html;
		// Most pages use none: don't parse those.
		let any = false;
		for (const tag of known.keys()) if (html.includes(`<${tag}`)) { any = true; break; }
		if (!any) return html;
		const { html: found, used } = findUsed(html, known, fallback);
		if (used.size === 0) return html;
		const [head, body] = tags(used, known, config.base);
		let out = found;
		// Without a <head>, the stylesheets go with the scripts.
		if (asciiLower(out).includes("</head>")) {
			out = insertBefore(out, "</head>", head, false);
			out = insertBefore(out, "</body>", body, true);
		} else {
			out = insertBefore(out, "</body>", head + body, true);
		}
		pages++;
		for (const tag of used.keys()) usedNames.add(tag);
		if (config.serving) thisBuild.set(page.url, [...used.keys()]);
		return out;
	}]);

	config.summaries.push(["Elements", () => `${known.size} defined, ${usedNames.size} used on ${count(pages)} page${pages === 1 ? "" : "s"}`]);
});
