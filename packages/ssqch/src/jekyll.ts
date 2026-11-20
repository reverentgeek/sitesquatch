// `jekyllTemplates: true`: templates see Jekyll's `page` and `site`, so a Jekyll site's layouts and
// includes run as they're written. The importer used to rewrite them (`page.title` to `title`,
// `site.posts` to `collections.posts`, `post.title` to `post.data.title`, a template's own `lang`
// to `my_lang`): regex surgery on Liquid that every new site broke a new way, and on
// www.ruby-lang.org changed 1,002 pages' output. Compatibility needs no edits.
//
// In ssqch, front matter is at the top level and `page` has the file's facts; collection items
// keep front matter under `data`. Here `page` has the page's front matter too (ssqch's own keys
// win), and `site` gets Jekyll's lists, made once a build after the collections.
import type { Data } from "./data.ts";
import { isPlainObject, sourceDateEpoch } from "./data.ts";

/** A post's categories as Jekyll makes them: the folders above `_posts`, then its own `categories` (a list, or words). */
export function categoriesOf(inputPath: unknown, data: Data | undefined): string[] {
	const out: string[] = [];
	const rel = typeof inputPath === "string" ? inputPath.replace(/^\.\//, "") : "";
	const at = rel.split("/").indexOf("_posts");
	if (at > 0) out.push(...rel.split("/").slice(0, at));
	const own = data?.categories ?? data?.category;
	if (Array.isArray(own)) out.push(...own.map(String));
	else if (typeof own === "string") out.push(...own.split(/\s+/).filter(Boolean));
	return out;
}

/** What Jekyll's documents and pages have that an ssqch collection item keeps elsewhere. */
function itemField(item: Data, key: string): unknown {
	switch (key) {
		case "content": return item.templateContent;
		case "excerpt": return item.page?.excerpt;
		case "path": return typeof item.inputPath === "string" ? item.inputPath.replace(/^\.\//, "") : undefined;
		case "categories": return categoriesOf(item.inputPath, item.data);
		default: return isPlainObject(item.data) ? item.data[key] : undefined;
	}
}

const ITEM_OWN = new Set(["url", "date", "inputPath", "fileSlug", "filePathStem", "outputPath", "page", "data", "templateContent"]);
const wrapped = new WeakMap<object, Data>();

/** A collection item as Jekyll's templates read one: `post.title`, `post.content`, `post.excerpt`, and ssqch's own keys as they are. Made once for each item, and nothing is read until a template asks. */
export function jekyllItem(item: Data): Data {
	const known = wrapped.get(item);
	if (known) return known;
	const proxy = new Proxy(item, {
		get(target, key, receiver) {
			if (typeof key !== "string" || ITEM_OWN.has(key)) return Reflect.get(target, key, receiver);
			const value = itemField(target, key);
			return value === undefined ? Reflect.get(target, key, receiver) : value;
		},
		has(target, key) {
			return Reflect.has(target, key) || (typeof key === "string" && itemField(target, key) !== undefined);
		},
		// Liquid reads only an object's own properties (`ownPropertyOnly`): the fields are its own too.
		getOwnPropertyDescriptor(target, key) {
			const own = Reflect.getOwnPropertyDescriptor(target, key);
			if (own || typeof key !== "string" || ITEM_OWN.has(key)) return own;
			const value = itemField(target, key);
			return value === undefined ? undefined : { value, enumerable: true, configurable: true, writable: false };
		},
	});
	wrapped.set(item, proxy);
	return proxy;
}

/** Jekyll's `page`: the page's own data (not the global data) and ssqch's `page`, whose keys win, with `path` and `categories`. */
export function jekyllPage(data: Data, page: Data, globalKeys: ReadonlySet<string>): Data {
	const out: Data = {};
	for (const key of Object.keys(data)) {
		if (key === "page" || key === "collections" || key === "pagination" || globalKeys.has(key)) continue;
		out[key] = data[key];
	}
	out.path = typeof page.inputPath === "string" ? page.inputPath.replace(/^\.\//, "") : undefined;
	out.categories = categoriesOf(page.inputPath, data);
	// ssqch's own keys win, as getters where it has them (`headings` after the page renders).
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(page))) Object.defineProperty(out, key, descriptor);
	return out;
}

/** Jekyll's `site`, made once a build: the config's keys, `posts` (newest first), each collection, `pages`, `categories`, `tags`, `data` and `time`. A key the site's own `site` has stays its own. */
export function jekyllSite(site: unknown, collections: Data, global: Data): Data {
	const own: Data = isPlainObject(site) ? site : {};
	const out: Data = {};
	const items = (list: unknown) => (Array.isArray(list) ? list.map((i) => (isPlainObject(i) ? jekyllItem(i) : i)) : []);
	const posts = items(collections.posts).reverse();
	out.posts = posts;
	for (const [name, list] of Object.entries(collections)) if (name !== "all" && name !== "posts") out[name] = items(list);
	// Jekyll's pages are what isn't in a collection: no `_folder` in the path.
	out.pages = items(collections.all).filter((p) => !/(?:^|\/)_[^/]+\//.test(String(p.inputPath ?? "").replace(/^\.\//, "")));
	out.html_pages = out.pages.filter((p: Data) => typeof p.url === "string" && (p.url.endsWith("/") || p.url.endsWith(".html")));
	const groups = (key: "categories" | "tags") => {
		const map: Data = {};
		for (const post of posts) {
			const names = key === "categories" ? categoriesOf(post.inputPath, post.data) : [post.data?.tags ?? []].flat().map(String);
			for (const name of names) (map[name] ??= []).push(post);
		}
		return map;
	};
	out.categories = groups("categories");
	out.tags = groups("tags");
	// `site.data`: the global data (`_data`'s files and the config's `data`), but `site` itself.
	const data: Data = {};
	for (const [key, value] of Object.entries(global)) if (key !== "site") data[key] = value;
	out.data = data;
	out.time = new Date(sourceDateEpoch() ?? Date.now());
	for (const [key, value] of Object.entries(own)) if (value !== undefined) out[key] = value;
	return out;
}
