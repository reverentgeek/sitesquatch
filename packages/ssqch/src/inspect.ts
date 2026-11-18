// `ssqch inspect`: where a page comes from, and where each value in its data was set.
//
// A page's data is a cascade. From the bottom: global data (`_data/` files, the config's
// `data`), the front matter of its layouts (outermost first), directory data files (outermost
// folder first), the page's own data file, its front matter, and `computed`. Each level replaces
// what the ones below it set (objects and lists are merged, unless `deepMerge` is off). When a
// value isn't what you expect, this says which level set it, and which levels it overrode.
//
// The site is read as a build reads it, up to the point of rendering: `beforeBuild` hooks run,
// since data can depend on them, but no page is rendered or written and `afterBuild` hooks don't
// run. Ported from 0.7's `inspect.rs`.
import fs from "node:fs";
import path from "node:path";
import { inspectPages } from "./build.ts";
import type { InspectedPage } from "./build.ts";
import type { Config, Dirs } from "./config.ts";
import type { Data } from "./data.ts";
import { getPath } from "./data.ts";
import { bail } from "./diagnostics.ts";
import { comparePaths, compareText, realPath, shown } from "./paths.ts";
import { charCount, firstChars, jsString, padEnd, quoted, toJsonValue } from "./quote.ts";

/** One level of the cascade that set a field: what to call it, and the value it gave. */
export interface SetBy {
	from: string;
	value: unknown;
}

/** A field of the page's data. */
export interface Field {
	name: string;
	/** The value templates see. */
	value: unknown;
	/** The level that decided it (the last of `setBy`). */
	from: string;
	/** Every level that set it, lowest first. */
	setBy: SetBy[];
}

export interface Inspection {
	/** The page's URL, or `null` for `permalink: false`. */
	url: string | null;
	inputPath: string;
	outputPath: string | null;
	engines: string[];
	/** The layout chain, innermost first. */
	layouts: string[];
	date: string;
	/** Where the date came from. */
	dateFrom: string;
	/** The collections the page is in. */
	collections: string[];
	fields: Field[];
}

const has = (data: unknown, key: string) => data !== null && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, key);
const nullish = (v: unknown) => v === undefined || v === null;

/** Where a key of the global data came from. */
function globalOrigin(config: Config, dirs: Dirs, key: string): string {
	if (key === "ssqch") return "built in";
	if (config.globalData.some((d) => d.name === key)) return "the config's `data`";
	for (const dir of [dirs.data, ...config.themes.map((theme) => path.join(theme, "_data"))]) {
		let names: string[];
		try { names = fs.readdirSync(dir); } catch { continue; }
		const files = names.map((name) => path.join(dir, name)).sort(comparePaths);
		const found = files.find((file) => {
			const name = path.basename(file);
			return name === key || name.slice(0, name.length - path.extname(name).length) === key;
		});
		if (found !== undefined) return shown(dirs.root, found);
	}
	return "global data";
}

function fieldsOf(config: Config, dirs: Dirs, global: Data, page: InspectedPage): Field[] {
	const computed = page.data.computed !== null && typeof page.data.computed === "object" && !Array.isArray(page.data.computed) ? page.data.computed : {};
	const pagination = page.data.pagination;
	const alias = pagination === undefined ? "" : jsString(nullish(pagination) ? undefined : pagination.alias);
	const out: Field[] = [];
	for (const [name, value] of Object.entries(page.data)) {
		let setBy: SetBy[] = [];
		if (has(global, name)) setBy.push({ from: globalOrigin(config, dirs, name), value: global[name] });
		for (const [from, layer] of page.layers) {
			// A layout's own `layout` says what wraps it; it isn't a value for the page.
			if (name === "layout" && from.startsWith("layout ")) continue;
			if (has(layer, name)) setBy.push({ from, value: layer[name] });
		}
		if (name === "page") setBy = [{ from: "built in", value }];
		else if (has(computed, name)) setBy.push({ from: "computed", value });
		else if (name === alias) setBy.push({ from: "pagination (its `alias`)", value });
		else if (name === "pagination") setBy.push({ from: "pagination (this page's items and links)", value });
		out.push({ name, value, from: setBy.length ? setBy[setBy.length - 1].from : "the build", setBy });
	}
	return out;
}

/** The page at `target`: a URL (`/guides/install/`) or a template's path (`src/guides/install.md`, from the project root or the input folder). */
export async function inspect(config: Config, target: string): Promise<Inspection> {
	const { dirs, global, pages } = await inspectPages(config);
	// `/trail/`, `/trail/index.html` and `/trail` are one page; `/trailindex.html` isn't. The exact URL first.
	const trim = (u: string) => {
		const rest = u.endsWith("index.html") ? u.slice(0, -10) : undefined;
		return (rest !== undefined && rest.endsWith("/") ? rest : u).replace(/\/+$/, "");
	};
	const exact = pages.filter((p) => p.url === target);
	const byUrl = exact.length ? exact : pages.filter((p) => p.url !== null && trim(p.url) === trim(target));
	const wanted = [path.resolve(dirs.root, target), path.resolve(dirs.input, target)].map(realPath);
	// Only a file with the same name can be the one (asking the disk for every page's real path is slow on a big site).
	const names = new Set(wanted.map((w) => path.basename(w)));
	const byFile = pages.filter((p) => names.has(path.basename(p.input)) && wanted.includes(realPath(p.input)));
	let page: InspectedPage;
	if (target.startsWith("/") && byUrl.length) page = byUrl[0];
	else if (byFile.length === 1) page = byFile[0];
	else if (byFile.length === 0) {
		// The closest URLs: the ones that share the target's last part.
		const parts = target.replace(/\/+$/, "").split("/");
		const last = asciiLower(parts[parts.length - 1].replace(/(\.md)+$/, ""));
		const near = pages.flatMap((p) => (p.url !== null && last !== "" && asciiLower(p.url).includes(last) ? [p.url] : [])).slice(0, 5).sort(compareText);
		bail(`no page at ${quoted(target)} (give a URL like /about/, or a template's path; the site has ${pages.length} pages).${near.length ? ` Close: ${near.join(", ")}` : ""}`);
	} else {
		const urls = byFile.flatMap((p) => (p.url === null ? [] : [p.url])).slice(0, 8);
		bail(`${target} makes ${byFile.length} pages; give the URL of one: ${urls.join(", ")}${byFile.length > 8 ? ", ..." : ""}`);
	}

	const setIn = (key: string) => [...page.layers].reverse().find(([, layer]) => has(layer, key) && !nullish(layer[key]))?.[0];
	const computedDate = has(page.data, "computed") && !nullish(getPath(page.data.computed, "date"));
	const dateFrom = computedDate ? "computed" : setIn("date") ?? (page.dateFromName ? "the file's name" : "the file's modification time");
	const collections: string[] = [];
	if (page.inCollections) {
		collections.push("all");
		if (Array.isArray(page.data.tags)) collections.push(...page.data.tags.map(jsString));
	}
	return {
		url: page.url,
		inputPath: shown(dirs.root, page.input),
		outputPath: page.output === null ? null : shown(dirs.root, page.output),
		engines: page.engines,
		layouts: page.layouts,
		date: page.date.toISOString().replace(/\.\d{3}Z$/, "Z"),
		dateFrom,
		collections,
		fields: fieldsOf(config, dirs, global, page),
	};
}

const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** A value, short enough for one column. */
function brief(value: unknown): string {
	if (typeof value === "string") return `${quoted(firstChars(value, 48))}${charCount(value) > 48 ? "…" : ""}`;
	if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
	if (typeof value === "function") return "a function";
	if (value === undefined) return "undefined";
	if (value !== null && typeof value === "object" && !(value instanceof Date)) {
		// As many of the first four keys as fit in the column.
		const all = Object.keys(value);
		const keys: string[] = [];
		for (const key of all.slice(0, 4)) {
			if (keys.reduce((sum, k) => sum + charCount(k) + 2, 0) + charCount(key) > 44) break;
			keys.push(key);
		}
		if (!keys.length) return `{${all.length} key${all.length === 1 ? "" : "s"}}`;
		return `{${keys.join(", ")}${all.length > keys.length ? ", …" : ""}}`;
	}
	return jsString(value);
}

/** One step of a dotted path: an object's key, a list's index or `length`, a string's character or `length`. */
function valueAt(value: unknown, key: string): unknown {
	const index = /^\+?\d+$/.test(key) ? Number(key) : undefined;
	if (Array.isArray(value)) return key === "length" ? value.length : index === undefined ? undefined : value[index];
	if (typeof value === "string") return key === "length" ? value.length : index === undefined ? undefined : [...value][index];
	if (value instanceof Date || typeof value === "function") return undefined;
	return has(value, key) ? (value as Data)[key] : undefined;
}

/** A field by name, or by a dotted path into one (`hero.alt`): the top field, and the value at the path in it and in each level that set it. */
export function field(inspection: Inspection, dotted: string): Field | undefined {
	const at = dotted.indexOf(".");
	const [top, rest] = at === -1 ? [dotted, ""] : [dotted.slice(0, at), dotted.slice(at + 1)];
	const found = inspection.fields.find((f) => f.name === top);
	if (!found || rest === "") return found;
	const pathIn = (v: unknown) => rest.split(".").reduce<unknown>(valueAt, v);
	const setBy = found.setBy.filter((s) => !nullish(pathIn(s.value))).map((s) => ({ from: s.from, value: pathIn(s.value) }));
	return { name: dotted, value: pathIn(found.value), from: setBy.length ? setBy[setBy.length - 1].from : found.from, setBy };
}

export function inspectionText(inspection: Inspection): string {
	let out = `${inspection.url ?? "(no URL: permalink is false)"}\n`;
	const row = (label: string, value: string) => { out += `  ${padEnd(label, 12)}${value}\n`; };
	row("From", `${inspection.inputPath} (${inspection.engines.length ? inspection.engines.join(", ") : "as it is"})`);
	if (inspection.outputPath !== null) row("Writes", inspection.outputPath);
	if (inspection.layouts.length) row("Layouts", inspection.layouts.join(" > "));
	row("Date", `${inspection.date} (from ${inspection.dateFrom})`);
	row("Collections", inspection.collections.length ? inspection.collections.join(", ") : "none");
	out += "\n  Data (name, value, and the level of the cascade that set it)\n";
	const width = Math.min(24, Math.max(0, ...inspection.fields.map((f) => charCount(f.name))));
	for (const f of inspection.fields) {
		const overrides = f.setBy.length > 1 ? ` (over ${f.setBy.slice(0, -1).map((s) => s.from).join(", ")})` : "";
		out += `    ${padEnd(f.name, width)}  ${padEnd(brief(f.value), 52)}  ${f.from}${overrides}\n`;
	}
	return out;
}

/** JSON as serde_json's pretty printer wrote it: two spaces, and `[]` and `{}` when empty. */
const pretty = (v: unknown) => JSON.stringify(toJsonValue(v), null, 2);

/** One field: its value in full, and each level that set it. */
export function fieldText(f: Field): string {
	let out = `${f.name} = ${pretty(f.value)}\n`;
	if (!f.setBy.length) return `${out}  Nothing in the cascade sets it.\n`;
	out += "\nSet by (the last one wins):\n";
	f.setBy.forEach((set, i) => {
		out += `  ${i + 1 === f.setBy.length ? ">" : " "} ${padEnd(set.from, 40)}  ${brief(set.value)}\n`;
	});
	return out;
}

const setByJson = (f: Field) => f.setBy.map((s) => ({ from: s.from, value: toJsonValue(s.value) }));

/** The report as JSON (`schemaVersion` 1), or one field of it. */
export function inspectionJson(inspection: Inspection, one: Field | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {
		schemaVersion: 1,
		url: inspection.url,
		inputPath: inspection.inputPath,
		outputPath: inspection.outputPath,
		engines: inspection.engines,
		layouts: inspection.layouts,
		date: { value: inspection.date, from: inspection.dateFrom },
		collections: inspection.collections,
	};
	if (one) out.field = { name: one.name, value: toJsonValue(one.value), from: one.from, setBy: setByJson(one) };
	else out.data = Object.fromEntries(inspection.fields.map((f) => [f.name, { value: toJsonValue(f.value), from: f.from, setBy: setByJson(f) }]));
	return out;
}
