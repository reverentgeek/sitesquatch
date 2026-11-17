// Navigation helpers for templates: a nav tree marked for the current page, previous and next
// links, breadcrumbs, and a tree built from pages' `nav` front matter.
//
// A tree is a list of entries, each an object with `title`, `url` (optional, for a section
// heading) and children under `children`, `items` or `pages`.
import { isPlainObject } from "./data.ts";
import type { Data } from "./data.ts";
import { compareText } from "./paths.ts";

const CHILD_KEYS = ["children", "items", "pages"];

/** What a tree holds: an entry is an object, but anything can be in the list. */
type Entry = unknown;

/** The first of `children`, `items` and `pages` that is a list with something in it, and its key. */
function children(entry: Entry): [string, Entry[]] | undefined {
	if (!isPlainObject(entry)) return undefined;
	for (const key of CHILD_KEYS) {
		const list = entry[key];
		if (Array.isArray(list) && list.length > 0) return [key, list];
	}
	return undefined;
}

/** An entry's `url`, if it is a string. */
const urlOf = (entry: Entry): string | undefined => (isPlainObject(entry) && typeof entry.url === "string" ? entry.url : undefined);

/** `/docs/`, `/docs` and `/docs/index.html` are the same page. */
function sameUrl(a: string, b: string): boolean {
	return a !== "" && b !== "" && normal(a) === normal(b);
}

/** A URL as `sameUrl` compares it. */
function normal(url: string): string {
	let u = url.split(/[#?]/)[0];
	if (u.endsWith("index.html")) u = u.slice(0, -"index.html".length);
	return u.replace(/\/+$/, "");
}

/**
 * What the helpers need to know about one tree, worked out once: a sidebar is asked about on every
 * page, and marking 9,000 entries for each of 9,000 pages is most of such a site's build.
 */
interface Index {
	/** The tree itself, kept so its identity stays its identity. */
	entries: Entry[];
	/** Every entry with `current`, `ancestor` and `open` false. */
	unmarked: Entry[];
	/** Where each URL's entries are: child indexes from the top. */
	paths: Map<string, number[][]>;
	/** The entries with a URL, in reading order, without their children. */
	flat: Entry[];
	/** Each URL's first place in `flat`. */
	position: Map<string, number>;
}

function buildIndex(entries: Entry[]): Index {
	// A URL no entry has: nothing is current.
	const index: Index = { entries, unmarked: entries.map((e) => mark(e, "\0")[0]), paths: new Map(), flat: [], position: new Map() };
	const walk = (level: Entry[], prefix: number[]) => {
		level.forEach((e, i) => {
			prefix.push(i);
			const url = urlOf(e);
			if (url !== undefined && url !== "") {
				const key = normal(url);
				const at = index.paths.get(key);
				if (at) at.push([...prefix]);
				else index.paths.set(key, [[...prefix]]);
				if (!index.position.has(key)) index.position.set(key, index.flat.length);
				index.flat.push(withoutChildren(e));
			}
			const below = children(e);
			if (below) walk(below[1], prefix);
			prefix.pop();
		});
	};
	walk(entries, []);
	return index;
}

// Trees are remembered by identity, the 16 most recent.
const RECENT: Index[] = [];
const SEEN_ONCE: Entry[][] = [];

/**
 * The index for `entries`, if this tree has been asked about before: an index costs more than one
 * answer, and an engine that hands over a fresh copy of the tree for each page (Liquid) would never
 * reuse it.
 */
function indexOf(entries: Entry[]): Index | undefined {
	const found = RECENT.find((i) => i.entries === entries);
	if (found) return found;
	const at = SEEN_ONCE.indexOf(entries);
	if (at < 0) {
		if (SEEN_ONCE.length >= 16) SEEN_ONCE.shift();
		SEEN_ONCE.push(entries);
		return undefined;
	}
	SEEN_ONCE.splice(at, 1);
	const index = buildIndex(entries);
	if (RECENT.length >= 16) RECENT.shift();
	RECENT.push(index);
	return index;
}

/** `level` with the entries at `paths` (and the ones above them) marked. Entries off those paths are shared, not copied. */
function markPaths(level: Entry[], paths: number[][]): Entry[] {
	const out = level.slice();
	const firsts = [...new Set(paths.map((p) => p[0]))].sort((a, b) => a - b);
	for (const i of firsts) {
		const entry = level[i];
		if (!isPlainObject(entry)) continue;
		const here = paths.filter((p) => p[0] === i).map((p) => p.slice(1));
		const current = here.some((p) => p.length === 0);
		const below = here.filter((p) => p.length > 0);
		const map: Data = { ...entry };
		if (below.length > 0) {
			const kids = children(entry);
			if (kids) map[kids[0]] = markPaths(kids[1], below);
		}
		map.current = current;
		map.ancestor = below.length > 0;
		map.open = true;
		out[i] = map;
	}
	return out;
}

/** The tree with `current`, `ancestor` and `open` set on each entry. */
export function tree(entries: Entry[], url: string): Entry[] {
	return entries.map((e) => mark(e, url)[0]);
}

/** `tree` for a tree that's a template value, remembering the work that doesn't depend on the page. */
export function treeOf(nav: unknown, url: string): Entry[] {
	if (!Array.isArray(nav)) return [];
	const index = indexOf(nav);
	if (!index) return tree(nav, url);
	const paths = url === "" ? undefined : index.paths.get(normal(url));
	return paths ? markPaths(index.unmarked, paths) : index.unmarked.slice();
}

/** `pager` for a tree that's a template value. */
export function pagerOf(nav: unknown, url: string): { previous: Entry; next: Entry } {
	if (!Array.isArray(nav)) return pager([], url);
	const index = indexOf(nav);
	if (!index) return pager(nav, url);
	const i = url === "" ? undefined : index.position.get(normal(url));
	const at = (j: number | undefined) => (j === undefined ? null : (index.flat[j] ?? null));
	return { previous: at(i === undefined || i === 0 ? undefined : i - 1), next: at(i === undefined ? undefined : i + 1) };
}

/** `breadcrumbs` for a tree that's a template value. */
export function breadcrumbsOf(nav: unknown, url: string): Entry[] {
	if (!Array.isArray(nav)) return [];
	const index = indexOf(nav);
	if (!index) return breadcrumbs(nav, url);
	const path = url === "" ? undefined : index.paths.get(normal(url))?.[0];
	if (!path) return [];
	let level: Entry[] = nav;
	const out: Entry[] = [];
	for (const i of path) {
		const entry = level[i];
		out.push(withoutChildren(entry));
		level = children(entry)?.[1] ?? [];
	}
	return out;
}

/** An entry marked, and whether it or something below it is the current page. */
function mark(entry: Entry, url: string): [Entry, boolean] {
	if (!isPlainObject(entry)) return [entry, false];
	const out: Data = { ...entry };
	const own = urlOf(entry);
	const current = own !== undefined && sameUrl(own, url);
	let ancestor = false;
	const below = children(entry);
	if (below) {
		out[below[0]] = below[1].map((c) => {
			const [v, found] = mark(c, url);
			ancestor ||= found;
			return v;
		});
	}
	out.current = current;
	out.ancestor = ancestor;
	out.open = current || ancestor;
	return [out, current || ancestor];
}

/** The entries with a URL, in reading order (depth first). */
function flatten(entries: Entry[], out: Entry[]): void {
	for (const e of entries) {
		const url = urlOf(e);
		if (url !== undefined && url !== "") out.push(e);
		const below = children(e);
		if (below) flatten(below[1], out);
	}
}

/** `{ previous, next }`: the entries before and after the current page. */
export function pager(entries: Entry[], url: string): { previous: Entry; next: Entry } {
	const flat: Entry[] = [];
	flatten(entries, flat);
	const i = flat.findIndex((e) => sameUrl(urlOf(e) ?? "", url));
	const at = (j: number | undefined) => (j === undefined || j < 0 || j >= flat.length ? null : withoutChildren(flat[j]));
	return { previous: at(i < 0 || i === 0 ? undefined : i - 1), next: at(i < 0 ? undefined : i + 1) };
}

function withoutChildren(e: Entry): Entry {
	if (!isPlainObject(e)) return e;
	return Object.fromEntries(Object.entries(e).filter(([k]) => !CHILD_KEYS.includes(k)));
}

/** The entries from the top of the tree down to the current page. */
export function breadcrumbs(entries: Entry[], url: string): Entry[] {
	const path: Entry[] = [];
	const walk = (level: Entry[]): boolean => {
		for (const e of level) {
			path.push(withoutChildren(e));
			const own = urlOf(e);
			if (own !== undefined && sameUrl(own, url)) return true;
			const below = children(e);
			if (below && walk(below[1])) return true;
			path.pop();
		}
		return false;
	};
	return walk(entries) ? path : [];
}

/** Rust's `f64::total_cmp` for the numbers `order` can be: -0 before +0, and NaN after everything. */
function totalCompare(a: number, b: number): number {
	if (Number.isNaN(a) || Number.isNaN(b)) return Number(Number.isNaN(a)) - Number(Number.isNaN(b));
	if (a < b) return -1;
	if (a > b) return 1;
	if (a === 0 && b === 0) return Number(Object.is(a, 0)) - Number(Object.is(b, 0));
	return 0;
}

/** An object's property, or undefined for anything that isn't an object. */
const get = (v: unknown, key: string): unknown => (isPlainObject(v) ? v[key] : undefined);

interface Node {
	key: string;
	parent: string | undefined;
	order: number;
	entry: Data;
}

/**
 * A tree from collection items with `nav` front matter: `nav: { title, parent, order }` (or
 * `nav: true` for a top-level entry titled by `title`). An entry's key is its `nav.key`, or its
 * title; `parent` names another entry's key. Siblings sort by `order`, then title.
 */
export function fromPages(items: unknown[]): Entry[] {
	let nodes: Node[] = [];
	for (const item of items) {
		const data = get(item, "data");
		const nav = get(data, "nav");
		if (nav === undefined || nav === null || nav === false) continue;
		const navTitle = get(nav, "title");
		const title = typeof navTitle === "string" ? navTitle : String(get(data, "title"));
		const navKey = get(nav, "key");
		const key = typeof navKey === "string" ? navKey : title;
		const parent = get(nav, "parent");
		const order = get(nav, "order");
		nodes.push({ key, parent: typeof parent === "string" ? parent : undefined, order: typeof order === "number" ? order : Number.MAX_VALUE, entry: { title, url: get(item, "url"), key } });
	}
	const build = (parent: string | undefined, depth: number): Entry[] => {
		if (depth > 32) return [];
		const level = nodes.filter((n) => n.parent === parent);
		level.sort((a, b) => totalCompare(a.order, b.order) || compareText(a.entry.title, b.entry.title));
		return level.map((n) => ({ ...n.entry, children: build(n.key, depth + 1) }));
	};
	// Entries whose parent doesn't exist go at the top.
	const keys = new Set(nodes.map((n) => n.key));
	nodes = nodes.map((n) => (n.parent !== undefined && !keys.has(n.parent) ? { ...n, parent: undefined } : n));
	return build(undefined, 0);
}
