// `ssqch import <generator>`: the mechanical part of moving a site.
//
// It renames data files, rewrites front matter keys and attributes to ssqch's names, writes a
// first `ssqch.config.js` from what it can read in the old config, and lists what's left to do by
// hand, with file and line. Without `--write` it only says what it would do.
//
// This is 0.7's importer (`crates/ssqch/src/import.rs`), messages and all. It reads a site's files
// as text and never runs them, so nothing in it was there for QuickJS, and nothing changes now
// that a site's packages run on Node.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import nunjucks from "nunjucks";
import { TomlError } from "smol-toml";
import { findConfig } from "./config.ts";
import { isPlainObject, parseYaml, readToml, tomlReason } from "./data.ts";
import type { Data } from "./data.ts";
import { red } from "./diagnostics.ts";
import { TABLE } from "./equivalents.ts";
import { jinjaFilters } from "./engines/jinja.ts";
import { BUILTIN_FILTERS } from "./filters.ts";
import { JsonText } from "./json-edit.ts";
import { compareText, isDir, isFile } from "./paths.ts";
import { rustRegExp } from "./rust-regex.ts";
import { VERSION } from "./version.ts";

/** What an import would do to a site. Paths are relative to its folder. */
export interface Plan {
	/** The generator the site is moving from, as people write it. */
	from: string;
	/** Files to rename: [from, to]. */
	renames: Array<[string, string]>;
	/** Files to change: [path as it is now, what changes, the new contents]. */
	edits: Array<[string, string[], string]>;
	/** Files to create: [path, where it came from, contents]. */
	newFiles: Array<[string, string, string]>;
	/** What's left for a person: [where, what to do]. */
	byHand: Array<[string, string]>;
}

/** Why an import stopped: printed as `error: <message>`. */
class ImportError extends Error {}

const fail = (message: string): never => {
	throw new ImportError(message);
};

/** `ssqch import <generator> [dir] [--write]`: prints the plan, makes it with `write`, and answers with the exit code. */
export function runImport(generator: string, dir: string, write: boolean): number {
	try {
		let plan: Plan;
		if (generator === "eleventy" || generator === "11ty") plan = eleventy(dir);
		else if (generator === "zola") plan = zola(dir);
		else if (generator === "jekyll") plan = jekyll(dir);
		else if (["hugo", "docusaurus", "mkdocs", "hexo", "astro", "vitepress"].includes(generator)) plan = fail(`there's no importer for ${generator} yet (only eleventy, jekyll and zola): \`ssqch docs --from ${generator}\` has its words and trailhead, and \`ssqch baseline "<its build command>"\` builds the site with it to compare with`);
		else plan = fail(`${generator}: not a generator ssqch can import from (use eleventy, jekyll or zola)`);
		process.stdout.write(describe(plan, dir, write));
		if (write) process.stdout.write(apply(plan, dir));
		return 0;
	} catch (e) {
		process.stderr.write(`${red("error:")} ${e instanceof Error ? e.message : String(e)}\n`);
		return 1;
	}
}

/** What the plan does, as the dry run and `--write` print it. */
export function describe(plan: Plan, dir: string, write: boolean): string {
	let out = `Importing the ${plan.from} site in ${dir}${write ? "" : " (a dry run: nothing is changed; add --write to make the changes)"}\n`;
	if (plan.renames.length) {
		out += `\nRename (${plan.renames.length})\n`;
		for (const [from, to] of plan.renames) out += `  ${from} -> ${to}\n`;
	}
	if (plan.edits.length) {
		out += `\nEdit (${plan.edits.length})\n`;
		for (const [file, changes] of plan.edits) out += `  ${file}: ${changes.join(", ")}\n`;
	}
	if (plan.newFiles.length) {
		out += `\nCreate (${plan.newFiles.length})\n`;
		for (const [file, from] of plan.newFiles) out += `  ${file} (${from})\n`;
	}
	if (!plan.renames.length && !plan.edits.length && !plan.newFiles.length) out += "\nNothing to rename, edit or create.\n";
	if (plan.byHand.length) {
		out += `\nBy hand (${plan.byHand.length})\n`;
		for (const [at, what] of plan.byHand) out += `  ${at}: ${what}\n`;
	}
	out += `\nNext: \`ssqch baseline "<${plan.from}'s build command>"\` (before --write, or with --commit) builds the site with ${plan.from} to compare with; then \`ssqch build\` and \`ssqch diff <the baseline> <ssqch's output>\`, the biggest group first. The whole loop: \`ssqch docs "moving a site with an agent"\`.\n`;
	return out;
}

/** Makes the changes, and answers with the line that says so. Edits are written before the renames move the files. */
export function apply(plan: Plan, dir: string): string {
	for (const [file, , contents] of plan.edits) attempt(() => fs.writeFileSync(path.join(dir, file), contents), `writing ${file}`);
	for (const [from, to] of plan.renames) {
		if (fs.existsSync(path.join(dir, to))) fail(`${to} is in the way of renaming ${from}`);
		attempt(() => fs.renameSync(path.join(dir, from), path.join(dir, to)), `renaming ${from} to ${to}`);
	}
	// A new file can be in a folder that isn't there yet (`_includes/seo.liquid`).
	for (const [file, , contents] of plan.newFiles) attempt(() => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), contents); }, `writing ${file}`);
	return `Done: ${plan.renames.length} renamed, ${plan.edits.length} edited, ${plan.newFiles.length} created. Welcome to the woods.\n`;
}

// ---- reading the site ----------------------------------------------------------------------

/** What the system said went wrong, in the words 0.7 printed (Rust's: `No such file or directory (os error 2)`). */
function reason(e: unknown): string {
	const err = e as NodeJS.ErrnoException;
	const words: Record<string, string> = { ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted", EISDIR: "Is a directory", ENOTDIR: "Not a directory", EEXIST: "File exists", ENOTEMPTY: "Directory not empty", EROFS: "Read-only file system", ENOSPC: "No space left on device" };
	if (process.platform !== "win32" && typeof err?.code === "string" && typeof err.errno === "number" && words[err.code]) return `${words[err.code]} (os error ${Math.abs(err.errno)})`;
	return e instanceof Error ? e.message : String(e);
}

/** Runs `step`, and fails with `what: <the reason>` when the file system refuses. */
function attempt(step: () => void, what: string): void {
	try { step(); } catch (e) { fail(`${what}: ${reason(e)}`); }
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A file's text, byte-order mark and all, or nothing when it can't be read or isn't UTF-8 (as 0.7 skipped such files). */
function readUtf8(file: string): string | undefined {
	try { return utf8.decode(fs.readFileSync(file)); } catch { return undefined; }
}

/** A file's text, or a failure that says why, after `what: `. */
function readStrict(file: string, what?: string): string {
	let bytes: Buffer;
	try { bytes = fs.readFileSync(file); } catch (e) { return fail(`${what ? `${what}: ` : ""}${reason(e)}`); }
	try { return utf8.decode(bytes); } catch { return fail(`${what ? `${what}: ` : ""}stream did not contain valid UTF-8`); }
}

/** A file's extension as 0.7 read it (`Path::extension`): none for `.gitignore`, `js` for `.eleventy.js`. */
function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1);
}

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** `text` split into lines as Rust's `str::lines` does: at `\n` or `\r\n`, with no empty line after a final line break. */
function lines(text: string): string[] {
	const parts = text.split("\n");
	const last = parts.pop()!;
	const out = parts.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	if (last !== "") out.push(last);
	return out;
}

/** `s` without any of `chars` at either end. */
function trimMatches(s: string, chars: string): string {
	let start = 0, end = s.length;
	while (start < end && chars.includes(s[start])) start++;
	while (end > start && chars.includes(s[end - 1])) end--;
	return s.slice(start, end);
}

// Rust's `trim`, `trim_start` and `split_whitespace`: Unicode's White_Space, which keeps a
// byte-order mark (U+FEFF) that JavaScript's `trim` takes off, and takes U+0085 it keeps.
const trim = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const trimStart = (s: string) => s.replace(/^\p{White_Space}+/u, "");
const splitWhitespace = (s: string) => s.split(/\p{White_Space}+/u).filter((w) => w !== "");
/** A line's indentation, as Rust's `&l[..l.len() - l.trim_start().len()]`. */
const indentOf = (line: string) => line.slice(0, line.length - trimStart(line).length);

const occurrences = (text: string, word: string) => text.split(word).length - 1;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\#&~-]/g, "\\$&");
/** Letters and digits in any script, as Rust's `char::is_alphanumeric`. */
const IDENTIFIER = /^[\p{Alphabetic}\p{N}_$]+$/u;

interface Entry {
	/** From the walk's folder, with `/`. */
	rel: string;
	abs: string;
	name: string;
	isFile: boolean;
}

/**
 * Every file and folder under `root`, each folder's entries in the order of their names' bytes,
 * a folder before what's in it (walkdir's `sort_by_file_name`). Links aren't followed. `skip`
 * leaves an entry out, with what's under it. `strict` stops at a folder that can't be read; else
 * it's passed over. A `root` that's a file is the one entry, as walkdir has it (Zola's
 * `templates` can be a file).
 */
function walk(root: string, skip: (name: string, rel: string) => boolean, strict: boolean): Entry[] {
	const out: Entry[] = [];
	if (isFile(root)) return [{ rel: "", abs: root, name: path.basename(root), isFile: true }];
	const visit = (abs: string, rel: string) => {
		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(abs, { withFileTypes: true });
		} catch (e) {
			// anyhow printed walkdir's error and then its cause, the same reason again.
			if (strict) fail(`IO error for operation on ${abs}: ${reason(e)}: ${reason(e)}`);
			return;
		}
		dirents.sort((a, b) => compareText(a.name, b.name));
		for (const d of dirents) {
			const childRel = rel === "" ? d.name : `${rel}/${d.name}`;
			if (skip(d.name, childRel)) continue;
			const childAbs = abs.endsWith(path.sep) ? abs + d.name : abs + path.sep + d.name;
			out.push({ rel: childRel, abs: childAbs, name: d.name, isFile: d.isFile() });
			if (d.isDirectory()) visit(childAbs, childRel);
		}
	};
	visit(root, "");
	return out;
}

/** A path's parts as Rust compares paths: `_site/` is `_site`, and `./_site` isn't. */
function components(p: string): string[] {
	const parts = p.split(process.platform === "win32" ? /[\\/]/ : "/");
	const out = parts.filter((part, i) => part !== "" && !(part === "." && i > 0));
	return p.startsWith("/") ? ["/", ...out] : out;
}

const samePath = (a: string, b: string) => components(a).join("\0") === components(b).join("\0");

// ---- Eleventy ------------------------------------------------------------------------------

const ELEVENTY_CONFIGS = [".eleventy.js", "eleventy.config.js", "eleventy.config.mjs", "eleventy.config.cjs"];
/** Files whose front matter and markup are rewritten. */
const TEMPLATE_EXTENSIONS = ["md", "markdown", "njk", "liquid", "html", "hbs", "handlebars", "mustache", "edge", "ejs"];

/** Front matter keys, and their names in data files: [Eleventy's, ssqch's], from the table of other generators' words. */
const keys = (): Array<[string, string]> => TABLE.filter((e) => e.kind === "frontMatter" && e.from.includes("Eleventy")).map((e) => [e.word, e.ssqch]);

// The patterns are 0.7's, in Rust's regex syntax, where `\w`, `\s` and `\b` know every script
// (`pluginÉté` is one name).
const NAVIGATION_FILTER = rustRegExp(String.raw`\|\s*eleventyNavigation(?:Breadcrumb|ToHtml|ToMarkdown)?\b|\beleventyNavigation(?:Breadcrumb|ToHtml|ToMarkdown)?\s*\(`);
const DATA_FILE = rustRegExp(String.raw`\.11tydata\.(js|cjs|mjs|json|ya?ml|toml)$`);
const IMAGE_ATTR = rustRegExp(String.raw`\beleventy:(widths|ignore)\b`, "g");
const TEMPLATE_GLOBAL = rustRegExp(String.raw`\beleventy\.(generator|version)\b`, "g");
const CALL = rustRegExp(String.raw`\.\s*(addFilter|addAsyncFilter|addNunjucksFilter|addLiquidFilter|addNunjucksAsyncFilter|addShortcode|addAsyncShortcode|addNunjucksShortcode|addNunjucksAsyncShortcode|addLiquidShortcode|addPairedShortcode|addPairedAsyncShortcode|addPairedNunjucksShortcode|addPairedNunjucksAsyncShortcode|addPairedLiquidShortcode|addNunjucksTag|addLiquidTag|addNunjucksGlobal|addMarkdownHighlighter|addCollection|addTransform|addGlobalData|addPlugin|addPassthroughCopy|addWatchTarget|setLibrary|addDataExtension|addTemplateFormats|setTemplateFormats|addLayoutAlias|on)\s*\(\s*(?:["'\x60]([^"'\x60]*)["'\x60]|([A-Za-z_$][\w$.]*))?`, "g");
const SETTING = rustRegExp(String.raw`\b(input|output|includes|layouts|data|markdownTemplateEngine|htmlTemplateEngine|pathPrefix)\s*:\s*["'\x60]([^"'\x60]*)["'\x60]`, "g");
const FORMATS = rustRegExp(String.raw`templateFormats\s*:\s*\[([^\]]*)\]`);
const REQUIRE = rustRegExp(String.raw`(?:require\(\s*|from\s+)["'](@11ty/[\w./-]+|markdown-it[\w-]*|eleventy-[\w-]+|@[\w-]+/eleventy-[\w-]+)["']`, "g");

/** A setting's value from the config, written as a string: `output: "dist"`. */
const setting = (code: string, key: string) => [...code.matchAll(SETTING)].find((c) => c[1] === key)?.[2];

/**
 * JavaScript with its comments blanked out (same length, newlines kept), so a commented-out
 * `// markdownTemplateEngine: "njk"` or `addFilter` isn't read as config, and offsets and line
 * numbers still match the source.
 */
export function blankComments(js: string): string {
	const out = js.split("");
	const blank = (from: number, to: number) => {
		for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
	};
	let i = 0;
	while (i < js.length) {
		const c = js[i];
		if (c === "\"" || c === "'" || c === "`") {
			i++;
			while (i < js.length && js[i] !== c && (c === "`" || js[i] !== "\n")) i += js[i] === "\\" ? 2 : 1;
			i++;
		} else if (c === "/" && js[i + 1] === "/") {
			const at = js.indexOf("\n", i);
			const end = at === -1 ? js.length : at;
			blank(i, end);
			i = end;
		} else if (c === "/" && js[i + 1] === "*") {
			const at = js.indexOf("*/", i + 2);
			const end = at === -1 ? js.length : at + 2;
			blank(i, end);
			i = end;
		} else i++;
	}
	return out.join("");
}

/** The package (or file) a config's `name` comes from: `const name = require("x")`, `import name from "x"`, or `const { name } = require("x")`. */
function pluginPackage(code: string, name: string): string | undefined {
	const base = name.split(".")[0];
	if (base === "" || !IDENTIFIER.test(base)) return undefined;
	const id = escapeRegex(base);
	const re = rustRegExp(String.raw`(?:\b(?:const|let|var)\s+(?:${id}|\{[^}]*\b${id}\b[^}]*\})\s*=\s*(?:await\s+)?(?:require|import)\(\s*|\bimport\s+(?:${id}(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?|(?:[A-Za-z_$][\w$]*\s*,\s*)?\{[^}]*\b${id}\b[^}]*\}|\*\s+as\s+${id})\s+from\s+)["'\x60]([^"'\x60]+)["'\x60]`);
	return re.exec(code)?.[1];
}

/** The plan for the Eleventy site in `dir`. */
export function eleventy(dir: string): Plan {
	if (!isDir(dir)) fail(`${dir} isn't a folder`);
	const config = ELEVENTY_CONFIGS.find((name) => isFile(path.join(dir, name)));
	const configText = config === undefined ? "" : readStrict(path.join(dir, config), `reading ${config}`);
	const output = setting(blankComments(configText), "output") ?? "_site";
	const plan: Plan = { from: "Eleventy", renames: [], edits: [], newFiles: [], byHand: [] };
	const extensions = new Set<string>();

	const entries = walk(dir, (name, rel) => name.startsWith(".git") || name === "node_modules" || name === ".cache" || samePath(rel, output), true);
	const isTemplate = (name: string) => TEMPLATE_EXTENSIONS.includes(asciiLower(extensionOf(name)));
	// Templates that call eleventy-navigation's filter read `eleventyNavigation` themselves:
	// renaming it to `nav` would empty their navigation (lit.dev).
	const readsNavigation = entries.some((e) => e.isFile && isTemplate(e.name) && NAVIGATION_FILTER.test(readUtf8(e.abs) ?? ""));
	const keep = readsNavigation ? ["eleventyNavigation"] : [];
	const major = eleventyMajor(dir);
	// Eleventy's input folder: what's outside it (notes, a README) isn't one of the site's pages.
	const dataEngine = /\bdataTemplateEngine\s*:\s*["'\x60](?!false)[^"'\x60]+["'\x60]/.test(blankComments(configText));
	const input = config === undefined ? "." : (setting(blankComments(configText), "input") ?? ".").replace(/^\.\//, "").replace(/\/+$/, "");
	const inInput = (rel: string) => input === "" || input === "." || rel === input || rel.startsWith(`${input}/`);
	if (major !== undefined && major < 2) keep.push("eleventy.generator");
	if (readsNavigation) {
		plan.byHand.push([".", "`eleventyNavigation` front matter was left as it is, because templates call the `eleventyNavigation` filter, which reads it. To keep that filter, define it with the package's own function: `import navigation from \"@11ty/eleventy-navigation/eleventy-navigation.js\"`, then `filters: { eleventyNavigation: (pages, key) => navigation.findNavigationEntries(pages, key) }`. To move to ssqch's navigation instead (`pagesTree`), rename it to `nav` (`ssqch docs nav`)"]);
	}
	for (const entry of entries) {
		if (!entry.isFile) continue;
		const { rel, name } = entry;
		const ext = asciiLower(extensionOf(name));
		if (DATA_FILE.test(name)) plan.renames.push([rel, rel.replace(DATA_FILE, ".data.$1")]);
		if (name.endsWith(".11ty.js") || name.endsWith(".11ty.cjs")) {
			plan.byHand.push([rel, "JavaScript templates don't run in ssqch: rewrite it as a template, or as an engine of your own (`engines` in the config)"]);
			continue;
		}
		if (ext === "webc") {
			plan.byHand.push([rel, "WebC isn't supported: rewrite it as a template, with custom elements from `ssqch/elements` for the interactive parts"]);
			continue;
		}
		const template = TEMPLATE_EXTENSIONS.includes(ext);
		const data = DATA_FILE.test(name) || (["json", "yaml", "yml"].includes(ext) && !name.startsWith("package"));
		if (!template && !data) continue;
		const text = readUtf8(entry.abs);
		if (text === undefined) continue;
		if (template) extensions.add(ext === "markdown" ? "md" : ext);
		let [next, changes] = template ? rewriteTemplate(text, ext === "md" || ext === "markdown", keep) : rewriteData(text, keep);
		// Eleventy's `dataTemplateEngine` rendered a data file's strings; ssqch doesn't. A string
		// that's only a literal through `url` is that literal (a11yproject.com: 27 in 4 files).
		if (data && dataEngine && /\{\{|\{%/.test(next)) {
			const [unwrapped, literals, left] = unwrapUrlLiterals(next);
			if (literals) { next = unwrapped; changes = [...changes, `${literals} \`{{ "/x/" | url }}\` -> "/x/" (dataTemplateEngine rendered them)`]; }
			if (left) plan.byHand.push([rel, `${left} ${left === 1 ? "value has" : "values have"} template code (\`{{ }}\` or \`{% %}\`), which Eleventy's \`dataTemplateEngine\` rendered and ssqch prints as written: write the value itself, or compute it in a \`.data.js\` file`]);
		}
		if (changes.length) plan.edits.push([rel, changes, next]);
		if (template && (text.includes("eleventy.env") || text.includes("eleventy.directories"))) plan.byHand.push([rel, "`eleventy.env` and `eleventy.directories` aren't there: use `ssqch.env` and `ssqch.serving`"]);
		if (template && inInput(rel) && keep.includes("eleventy.generator") && text.search(TEMPLATE_GLOBAL) !== -1) plan.byHand.push([rel, `\`eleventy.generator\` and \`eleventy.version\` left as they are: Eleventy ${major} printed nothing for them, so in ssqch they print nothing too and the output matches. \`ssqch.generator\` prints "SiteSquatch v${VERSION}" when the move is done`]);
	}

	packageFiles(dir, plan, entries);
	// `.eleventyignore` (at the top or in the input folder): the same globs in the draft's `ignore`,
	// or a file Eleventy never read becomes a page (a11yproject.com's `src/css/homepage.md`).
	const ignored: string[] = [];
	for (const at of [".eleventyignore", input && input !== "." ? `${input}/.eleventyignore` : ""]) {
		if (!at) continue;
		const text = readUtf8(path.join(dir, ...at.split("/")));
		if (text === undefined) continue;
		const base = at.includes("/") ? `${at.slice(0, at.lastIndexOf("/"))}/` : "";
		for (const line of lines(text)) {
			const glob = trim(line);
			if (glob === "" || glob.startsWith("#") || glob.startsWith("!")) continue;
			const rel = `${base}${glob.replace(/^\.\//, "")}`.replace(/\/$/, "/**");
			ignored.push(rel.startsWith(`${input}/`) && input !== "." ? rel.slice(input.length + 1) : rel);
		}
	}
	// `eleventyConfig.ignores.add("src/drafts/**")`: from the project root, as `.eleventyignore`'s.
	for (const m of blankComments(configText).matchAll(/\.ignores\.add\(\s*["'\x60]([^"'\x60]+)["'\x60]\s*\)/g)) {
		const rel = m[1].replace(/^\.\//, "").replace(/\/$/, "/**");
		ignored.push(rel.startsWith(`${input}/`) && input !== "." ? rel.slice(input.length + 1) : rel);
	}
	// The site's own modules the config passes `eleventyConfig` to: their calls count as the config's.
	const followed = config === undefined ? new Map<string, string>() : helperModules(dir, config, configText);
	const helpers: Array<[string, Array<[string, string]>]> = [];
	const helperLists: Array<[string, string]> = [];
	let helperText = "";
	for (const rel of new Set(followed.values())) {
		const text = readUtf8(path.join(dir, ...rel.split("/")));
		if (text === undefined) continue;
		const [, list, ported] = draftConfig(rel, text, extensions);
		// Its packages are listed by `modulesUsingEleventy`, with their lines.
		helperLists.push(...list.filter(([at]) => at !== rel));
		helpers.push([rel, ported]);
		helperText += `\n${blankComments(text)}`;
	}
	const ports = config === undefined ? [] : undefinedFilters(entries, blankComments(configText) + helperText, readsNavigation, plan);
	modulesUsingEleventy(entries, config, plan);
	outputChanges(entries, configText, input, plan);
	otherBuildTools(dir, plan);
	if (config !== undefined) {
		const [source, byHand] = draftConfig(config, configText, extensions, ports, major, helpers, new Set(followed.keys()), ignored);
		plan.byHand.push(...byHand, ...helperLists);
		if (findConfig(dir) === undefined) plan.newFiles.push(["ssqch.config.js", `a first draft, from ${config}`, source]);
		else plan.byHand.push(["ssqch.config.js", "it's already there, so the draft from the Eleventy config wasn't written"]);
	} else {
		plan.byHand.push([".", `no Eleventy config here (${ELEVENTY_CONFIGS.join(", ")}): is this the site's folder?`]);
	}
	return plan;
}

const HTML_TAG = /<[A-Za-z][^<>]*>/g;
const TEMPLATE_TAG = /\{\{.*?\}\}|\{%.*?%\}/gs;

/** A template with ssqch's front matter keys, image attributes and globals, leaving the keys in `keep` as they are. */
export function rewriteTemplate(text: string, markdown: boolean, keep: readonly string[] = []): [string, string[]] {
	const changes: string[] = [];
	// Front matter: the keys at the start of a line, in the block at the top.
	let front = "", body = text;
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) {
			front = text.slice(0, end + 4);
			body = text.slice(end + 4);
		}
	}
	for (const [from, to] of keys()) {
		if (keep.includes(from)) continue;
		const key = rustRegExp(String.raw`(?m)^(\s*["']?)${from}(["']?\s*:)`, "g");
		if (front.search(key) !== -1) {
			front = front.replace(key, (_, before: string, after: string) => `${before}${to}${after}`);
			changes.push(`${from} -> ${to}`);
		}
	}
	// In the body, only where the names mean something: an attribute inside an HTML tag, a
	// global inside a template tag. A post about Eleventy keeps its prose, and in Markdown its
	// code samples.
	let attrs = false, globals = false;
	body = outsideCode(body, markdown, (part) => {
		const tagged = part.replace(HTML_TAG, (tag) => {
			if (tag.search(IMAGE_ATTR) !== -1) attrs = true;
			return tag.replace(IMAGE_ATTR, "ssqch:$1");
		});
		// Eleventy 1 printed nothing for `eleventy.generator` (a11yproject.com's 112 pages had
		// `content=""`): rewritten, every page would change. `keep` has it then.
		if (keep.includes("eleventy.generator")) return tagged;
		return tagged.replace(TEMPLATE_TAG, (tag) => {
			if (tag.search(TEMPLATE_GLOBAL) !== -1) globals = true;
			return tag.replace(TEMPLATE_GLOBAL, "ssqch.$1");
		});
	});
	if (attrs) changes.push("eleventy:widths/ignore -> ssqch:widths/ignore");
	if (globals) changes.push("eleventy.generator/version -> ssqch.generator/version");
	return [front + body, changes];
}

/**
 * `text` with `change` applied to everything that isn't a code sample. In Markdown, that leaves
 * out fenced blocks and `inline code`; other templates have no code samples to tell apart, so all
 * of the text is changed.
 */
function outsideCode(text: string, markdown: boolean, change: (part: string) => string): string {
	if (!markdown) return change(text);
	let out = "";
	let fence: string | undefined;
	let prose = "";
	for (let start = 0; start < text.length;) {
		const nl = text.indexOf("\n", start);
		const end = nl === -1 ? text.length : nl + 1;
		const line = text.slice(start, end);
		start = end;
		const trimmed = trimStart(line);
		const marker = trimmed.startsWith("```") ? "```" : trimmed.startsWith("~~~") ? "~~~" : undefined;
		if (fence === undefined && marker !== undefined) {
			out += changeProse(prose, change);
			prose = "";
			fence = marker;
			out += line;
		} else if (fence !== undefined && marker === fence) {
			fence = undefined;
			out += line;
		} else if (fence !== undefined) {
			out += line;
		} else {
			prose += line;
		}
	}
	return out + changeProse(prose, change);
}

/** Prose with `change` applied around its `inline code`. */
function changeProse(prose: string, change: (part: string) => string): string {
	// Between the first and second backtick, the third and fourth, and so on, is code.
	return prose.split("`").map((part, i) => (i % 2 === 1 ? part : change(part))).join("`");
}

/** A data file with ssqch's names for the keys Eleventy reads: only where they're keys (`"eleventyComputed":`, `eleventyComputed:`), not in values. */
/**
 * A data file's `"{{ '/about/' | url }}"` as the literal (`"/about/"`), normalized as Eleventy's
 * `url` normalized it; and how many other strings have template code. JSON and YAML strings (a
 * JSON string's own quotes inside it are `\"`).
 */
export function unwrapUrlLiterals(text: string): [string, number, number] {
	let literals = 0;
	const out = text.replace(/\{\{-?\s*(\\?["'])([^"'{}\\]*)\1\s*\|\s*url\s*-?\}\}/g, (_, _q: string, value: string) => {
		literals++;
		return value === "" ? "." : value.startsWith("/") && !value.startsWith("//") ? path.posix.normalize(value) : value;
	});
	const left = (out.match(/\{\{|\{%/g) ?? []).length;
	return [out, literals, left];
}

export function rewriteData(text: string, keep: readonly string[] = []): [string, string[]] {
	let out = text;
	const changes: string[] = [];
	for (const [from, to] of keys()) {
		if (keep.includes(from)) continue;
		// Quoted (JSON), at the start of a line (YAML, JavaScript), or right after `{` or `,`.
		const key = rustRegExp(String.raw`(?m)(["'])${from}(["']\s*:)|(^[ \t]*|[{,][ \t]*)${from}(\s*:)`, "g");
		if (out.search(key) !== -1) {
			out = out.replace(key, (_, open?: string, close?: string, before?: string, after?: string) => `${open ?? ""}${before ?? ""}${to}${close ?? ""}${after ?? ""}`);
			changes.push(`${from} -> ${to}`);
		}
	}
	return [out, changes];
}

// ---- filters the templates use that nothing defines --------------------------------------------

/**
 * Eleventy's own filters and shortcodes, and its plugins', that a template can use without the
 * config defining them: what each is in ssqch, and a port for the draft when it's small.
 */
const ELEVENTY_FILTERS: Record<string, { say: string; port?: string }> = {
	slug: { say: "Eleventy's built-in `slug` (the slugify package): ssqch's is `slugify`, which drops `.` and other punctuation that `slug` keeps. For the same ids, port it: `slug: (s) => slugify(String(s), { lower: true })` with `import slugify from \"slugify\"`" },
	log: { say: "Eleventy's built-in `log`: ported into the draft (it prints the value and passes it on)", port: "(value) => {\n\t\t\tconsole.log(value);\n\t\t\treturn value;\n\t\t}" },
	getCollectionItemIndex: { say: "Eleventy's built-in, ported into the draft: pass the page, `collection | getCollectionItemIndex(page)`", port: "(collection, page) => collection.findIndex((item) => item.url === page.url)" },
	getCollectionItem: { say: "Eleventy's built-in, ported into the draft: pass the page, `collection | getCollectionItem(page)`", port: "(collection, page) => collection.find((item) => item.url === page.url)" },
	inputPathToUrl: { say: "Eleventy's built-in: link to the page's URL itself (`collections` items have `url`), or a filter of your own that looks it up" },
	renderTemplate: { say: "Eleventy's render plugin: a container (`::: name`) or an include does the same in ssqch" },
	renderFile: { say: "Eleventy's render plugin: an `{% include %}` of the file" },
	rssLastUpdatedDate: { say: "the RSS plugin's old name: `rssPlugin()` from \"ssqch/rss\" has it (and `getNewestCollectionItemDate(collection) | dateToRfc3339`, its new one)" },
	rssDate: { say: "the RSS plugin's old name: `rssPlugin()` from \"ssqch/rss\" has it (and `dateToRfc3339`, its new one)" },
	getNewestCollectionItemDate: { say: "the RSS plugin's: `rssPlugin()` from \"ssqch/rss\" has it" },
	dateToRfc3339: { say: "the RSS plugin's: `rssPlugin()` from \"ssqch/rss\" has it" },
	dateToRfc822: { say: "the RSS plugin's: `rssPlugin()` from \"ssqch/rss\" has it" },
	absoluteUrl: { say: "the RSS plugin's: `rssPlugin()` from \"ssqch/rss\" has it" },
	htmlToAbsoluteUrls: { say: "the RSS plugin's: `rssPlugin()` from \"ssqch/rss\" has it (or `feedHtml`)" },
	eleventyNavigationBreadcrumb: { say: "eleventy-navigation's: `navBreadcrumbs(nav, page.url)` with `nav` front matter (`ssqch docs navBreadcrumbs`)" },
	eleventyNavigationToHtml: { say: "eleventy-navigation's: `navTree(nav, page.url)` and a template that writes the list (`ssqch docs navTree`)" },
	eleventyNavigationToMarkdown: { say: "eleventy-navigation's: `navTree(nav, page.url)` and a template that writes the list (`ssqch docs navTree`)" },
};

/** Tags the template languages have themselves, which a `{% name %}` isn't a shortcode for. */
const BUILT_IN_TAGS = new Set(["if", "elif", "elseif", "elsif", "else", "endif", "for", "endfor", "empty", "set", "endset", "macro", "endmacro", "call", "endcall", "import", "from", "include", "extends", "block", "endblock", "filter", "endfilter", "raw", "endraw", "verbatim", "endverbatim", "asyncEach", "endeach", "asyncAll", "endall", "ifAsync", "assign", "capture", "endcapture", "case", "when", "endcase", "comment", "endcomment", "cycle", "decrement", "increment", "echo", "break", "continue", "unless", "endunless", "render", "layout", "liquid", "tablerow", "endtablerow", "with", "endwith", "autoescape", "endautoescape", "setAsync"]);

let engineFilterNames: Set<string> | undefined;

/** Every filter the template languages have themselves, and ssqch's: what a template can use that no config defines. */
function knownFilters(): Set<string> {
	if (engineFilterNames) return engineFilterNames;
	const names = new Set<string>([...BUILTIN_FILTERS.map(([name]) => name), ...TABLE.filter((r) => r.kind === "filter" && r.alias).map((r) => r.word)]);
	for (const name of Object.keys(jinjaFilters((t) => t))) names.add(name);
	for (const name of Object.keys(jinjaFilters((t) => t, "njk"))) names.add(name);
	// Nunjucks' own (`safe`, `dump`), which ssqch's engines keep.
	for (const name of Object.keys((new nunjucks.Environment() as unknown as { filters: Record<string, unknown> }).filters)) names.add(name);
	try {
		const { Liquid } = createRequire(import.meta.url)("liquidjs") as { Liquid: new () => { filters: Record<string, unknown> } };
		for (const name of Object.keys(new Liquid().filters)) names.add(name);
	} catch { /* without liquidjs, its filters read as unknown */ }
	return (engineFilterNames = names);
}

const TEMPLATE_CODE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const PIPE_FILTER = /\|\s*([A-Za-z_][\w]*)/g;
const TAG_NAME = /^\{%-?\s*([A-Za-z_][\w]*)/;

/**
 * The filters and shortcodes templates use that nothing defines: not the template languages, not
 * ssqch, and not the Eleventy config (a11y #5). Each goes in the list once, with how many
 * templates use it and the first place; Eleventy's own and its plugins' say what they are in
 * ssqch, and the small ones come back as ports for the draft's `filters`.
 */
function undefinedFilters(entries: Entry[], config: string, readsNavigation: boolean, plan: Plan): Array<[string, string]> {
	// Only the site's templates: what's in Eleventy's input folder (lit.dev's `samples/` aren't pages).
	const input = (setting(config, "input") ?? ".").replace(/^\.\//, "").replace(/\/+$/, "");
	const inInput = (rel: string) => input === "" || input === "." || rel === input || rel.startsWith(`${input}/`);
	const defined = new Set<string>();
	for (const c of config.matchAll(CALL)) {
		if (c[2] !== undefined && /Filter|Shortcode|Tag|Global/.test(c[1])) defined.add(c[2]);
	}
	const known = knownFilters();
	const uses = new Map<string, { first: string; templates: Set<string> }>();
	for (const entry of entries) {
		if (!entry.isFile || !inInput(entry.rel) || !["njk", "liquid", "md", "markdown", "html"].includes(asciiLower(extensionOf(entry.name)))) continue;
		const text = readUtf8(entry.abs);
		if (text === undefined || (!text.includes("{{") && !text.includes("{%"))) continue;
		for (const tag of text.matchAll(TEMPLATE_CODE)) {
			const found: string[] = [];
			// Quoted text inside a tag isn't code: `{{ "a | b" }}`.
			const code = tag[0].replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "\"\"");
			for (const m of code.matchAll(PIPE_FILTER)) found.push(m[1]);
			const name = TAG_NAME.exec(code)?.[1];
			if (name !== undefined && tag[0].startsWith("{%") && !BUILT_IN_TAGS.has(name)) found.push(name);
			for (const name of found) {
				if (defined.has(name) || (known.has(name) && !Object.hasOwn(ELEVENTY_FILTERS, name))) continue;
				if (readsNavigation && name === "eleventyNavigation") continue;
				const line = occurrences(text.slice(0, tag.index), "\n") + 1;
				const use = uses.get(name) ?? { first: `${entry.rel}:${line}`, templates: new Set<string>() };
				use.templates.add(entry.rel);
				uses.set(name, use);
			}
		}
	}
	// A paired shortcode's end tag (`{% endcallout %}`) goes with its start.
	for (const name of [...uses.keys()]) {
		const opens = name.slice(3);
		if (name.startsWith("end") && opens !== "" && (uses.has(opens) || defined.has(opens) || known.has(opens) || BUILT_IN_TAGS.has(opens))) uses.delete(name);
	}
	const ports: Array<[string, string]> = [];
	for (const [name, use] of [...uses].sort(([a], [b]) => compareText(a, b))) {
		const where = use.templates.size === 1 ? "" : ` (in ${use.templates.size} templates; this is the first)`;
		const eleventy = Object.hasOwn(ELEVENTY_FILTERS, name) ? ELEVENTY_FILTERS[name] : undefined;
		if (eleventy?.port) ports.push([name, eleventy.port]);
		plan.byHand.push([use.first, eleventy ? `\`${name}\`${where}: ${eleventy.say}` : `\`${name}\`${where} is a filter or shortcode nothing defines: not the template language, not ssqch, not the Eleventy config. A plugin's, or one a helper module adds? Port it to \`filters\``]);
	}
	return ports;
}

const RELATIVE_IMPORT = /(?:\brequire\(\s*|\bimport\s*\(\s*|\bfrom\s+)["'](\.{1,2}\/[^"']+)["']/g;
const HELPER_CALL = /\.\s*(?:addFilter|addAsyncFilter|addNunjucksFilter|addLiquidFilter|addNunjucksAsyncFilter|addShortcode|addAsyncShortcode|addPairedShortcode|addNunjucksShortcode|addLiquidShortcode|addCollection|addTransform|addGlobalData|addPlugin|addPassthroughCopy|setLibrary)\s*\(/;

/**
 * The site's own modules, from the config on, that call Eleventy's `add*` methods (blog #2: a
 * `registerSiteFilters(config)` in `lib/` hid 11 filters, 2 collections and a transform; lit D4:
 * a plugin of the site's own). Followed through relative imports, inside the site. By what the
 * importing file wrote (`./lib/filters.js`), each module's path from the site's folder.
 */
function helperModules(dir: string, config: string, configText: string): Map<string, string> {
	const found = new Map<string, string>();
	const seen = new Set<string>([config]);
	const queue: Array<[string, string]> = [[config, configText]];
	while (queue.length) {
		const [rel, text] = queue.shift()!;
		for (const m of blankComments(text).matchAll(RELATIVE_IMPORT)) {
			const base = path.posix.join(path.posix.dirname(rel), m[1]);
			if (base.startsWith("..")) continue;
			const target = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}/index.js`].find((p) => isFile(path.join(dir, ...p.split("/"))));
			if (target === undefined) continue;
			// Another file's name for a module already followed.
			if (seen.has(target)) {
				if ([...found.values()].includes(target)) found.set(m[1], target);
				continue;
			}
			seen.add(target);
			const next = readUtf8(path.join(dir, ...target.split("/")));
			if (next === undefined) continue;
			if (HELPER_CALL.test(blankComments(next))) found.set(m[1], target);
			queue.push([target, next]);
		}
	}
	return found;
}

/**
 * Eleventy's packages in the site's other modules (blog #3): a data file that runs eleventy-img or
 * eleventy-fetch itself, a helper the config imports. The config's are listed with the rest of it.
 */
function modulesUsingEleventy(entries: Entry[], config: string | undefined, plan: Plan): void {
	const inData: Record<string, string> = {
		"@11ty/eleventy-img": "`image(src, options)` from \"ssqch/image\" in a data file (the URLs and sizes, without markup), or `imageUrl(src)` in a template",
		"@11ty/eleventy-fetch": "`fetch(url, { cache: \"1d\" })`, from \"ssqch\" in a data file: it keeps a copy in `.cache/ssqch/fetch/` as eleventy-fetch kept one in `.cache`",
	};
	for (const entry of entries) {
		if (!entry.isFile || entry.rel === config || !/\.(?:[cm]?js|[cm]?ts)$/.test(entry.name)) continue;
		const text = readUtf8(entry.abs);
		if (text === undefined || (!text.includes("eleventy") && !text.includes("markdown-it"))) continue;
		const code = blankComments(text);
		const seen = new Set<string>();
		for (const m of code.matchAll(REQUIRE)) {
			const pkg = m[1];
			if (seen.has(pkg) || pkg === "@11ty/eleventy") continue;
			seen.add(pkg);
			const what = Object.hasOwn(inData, pkg) ? inData[pkg] : replacement(pkg);
			if (what !== undefined) plan.byHand.push([`${entry.rel}:${occurrences(code.slice(0, m.index), "\n") + 1}`, `${pkg} -> ${what}`]);
		}
	}
}

/**
 * A second build tool beside Eleventy (a11yproject.com's gulpfile: Sass, cache-busting, HTML
 * minifying, a style guide), with what ssqch has for each part it does and what it doesn't, so
 * the plan for the move after the first, identical build starts from a list.
 */
function otherBuildTools(dir: string, plan: Plan): void {
	const tools: Array<[string, string]> = [["gulpfile.js", "Gulp"], ["gulpfile.mjs", "Gulp"], ["gulpfile.cjs", "Gulp"], ["Gruntfile.js", "Grunt"], ["webpack.config.js", "webpack"], ["webpack.config.mjs", "webpack"], ["postcss.config.js", "PostCSS"], ["postcss.config.cjs", "PostCSS"], ["vite.config.js", "Vite"], ["vite.config.mjs", "Vite"], ["rollup.config.js", "Rollup"], ["rollup.config.mjs", "Rollup"]];
	const parts: Array<[RegExp, string]> = [
		[/\b(?:gulp-)?(?:dart-)?sass\b/, "Sass -> `sassPlugin()` from \"ssqch/sass\""],
		[/\b(?:gulp-rev|rev-hash|cachebust|gulp-hash)\b/, "cache-busting -> `assetsPlugin()` from \"ssqch/assets\" (fingerprints)"],
		[/\b(?:gulp-htmlmin|html-minifier(?:-terser)?)\b/, "HTML minifying -> `minifyPlugin()` from \"ssqch/minify\" (it keeps markup as written; html-minifier repairs unclosed tags)"],
		[/\b(?:gulp-(?:clean-css|cssnano)|cssnano|clean-css)\b/, "CSS minifying -> `minifyPlugin({ css: true })`, or Sass's compressed style"],
		[/\b(?:gulp-imagemin|imagemin|sharp)\b/, "images -> `imagePlugin()` from \"ssqch/image\""],
		[/\b(?:autoprefixer)\b/, "autoprefixer: not in ssqch; keep it as a `beforeBuild` `run:` step (or after `sassPlugin()`)"],
		[/\b(?:purgecss|gulp-purgecss|@fullhuman\/postcss-purgecss)\b/, "PurgeCSS: not in ssqch; keep it as a step of its own"],
		[/\b(?:terser|uglify|gulp-uglify|esbuild)\b/, "JavaScript bundling or minifying: not in ssqch; keep the tool, before `ssqch build`"],
		[/\b(?:svgo|gulp-svgmin|svg-sprite|gulp-svgstore)\b/, "SVG optimizing and sprites: not in ssqch; keep the tool"],
		[/\b(?:kss|gulp-kss)\b/, "a style guide (KSS): not a generator's job; keep it (`afterBuild: { run: \"kss ...\" }`)"],
	];
	for (const [file, tool] of tools) {
		const text = readUtf8(path.join(dir, file));
		if (text === undefined) continue;
		const found = parts.filter(([pattern]) => pattern.test(text)).map(([, say]) => say);
		plan.byHand.push([file, `${tool} builds part of the site too: keep it for the first, identical build (\`ssqch build && <the tool>\`, and both in \`ssqch baseline\`'s command)${found.length ? `. What it does, and ssqch's way: ${found.join("; ")}` : ""}`]);
	}
}

/**
 * What changes a page's output beyond the mechanical edits, found before the first diff: a Date
 * printed as it is (`Date.toString()` in Eleventy, ISO 8601 in ssqch; a11yproject.com's 66
 * posts), date code that reads the machine's time zone (v8.dev), `pagination` over `collections`
 * (its names come in another order), and templates in a folder that's passed through (Eleventy
 * rendered them; ssqch copies them).
 */
function outputChanges(entries: Entry[], configText: string, input: string, plan: Plan): void {
	const line = (text: string, at: number) => occurrences(text.slice(0, at), "\n") + 1;
	const inInput = (rel: string) => input === "." || rel.startsWith(`${input}/`);
	const bare: Array<[string, number]> = [];
	for (const entry of entries) {
		if (!entry.isFile) continue;
		const ext = asciiLower(extensionOf(entry.name));
		const template = TEMPLATE_EXTENSIONS.includes(ext);
		const code = /^(?:[cm]?js|[cm]?ts)$/.test(ext);
		if (!template && !code) continue;
		const text = readUtf8(entry.abs);
		if (text === undefined) continue;
		if (template && inInput(entry.rel)) {
			const d = /\{\{-?\s*((?:page\.|\w+\.data\.)?date)\s*-?\}\}/.exec(text);
			if (d) bare.push([`${entry.rel}:${line(text, d.index)}`, occurrences(text, d[0])]);
			const p = /^pagination:\s*\n(?:[ \t]+.*\n)*?[ \t]+data:\s*["']?collections["']?\s*$/m.exec(text);
			if (p) plan.byHand.push([`${entry.rel}:${line(text, p.index)}`, "`pagination: { data: collections }` pages over the collections' names, which come in another order in ssqch (the order they're defined, not Eleventy's): page over a list of names you make in data, in the order you want"]);
		}
		if (code) {
			const js = blankComments(text);
			for (const m of js.matchAll(/\.(toLocaleDateString|toLocaleString|toLocaleTimeString)\(([^()]*)\)|DateTime\.fromJSDate\(([^()]*)\)/g)) {
				const args = m[2] ?? m[3] ?? "";
				if (/timeZone|zone/.test(args)) continue;
				plan.byHand.push([`${entry.rel}:${line(js, m.index)}`, `\`${m[1] ?? "DateTime.fromJSDate"}\` without a time zone uses the build machine's, so the page changes with where it's built: give it one (\`{ timeZone: "UTC" }\`, luxon's \`{ zone: "utc" }\`), or set \`timeZone\` in the config`]);
			}
		}
	}
	if (bare.length) {
		const total = bare.reduce((n, [, c]) => n + c, 0);
		plan.byHand.push([bare[0][0], `\`{{ date }}\` prints a Date as it is (in ${bare.length} ${bare.length === 1 ? "template" : "templates"}, ${total} ${total === 1 ? "time" : "times"}; this is the first): Eleventy wrote \`Date.toString()\` (\`Mon Mar 08 2021 00:00:00 GMT+0000 (Coordinated Universal Time)\`, in the machine's time zone), ssqch writes ISO 8601. Format it (\`| dateformat("iso")\`), so the page doesn't depend on the machine; \`ssqch diff\` groups the two forms as dates`]);
	}
	// Folders passed through, from the project root: a template inside one is copied, not rendered.
	const passed = [...blankComments(configText).matchAll(/addPassthroughCopy\(\s*["'\x60]([^"'\x60*{]+)["'\x60]/g)].map((m) => m[1].replace(/^\.\//, "").replace(/\/+$/, ""));
	for (const folder of new Set(passed)) {
		const inside = entries.filter((e) => e.isFile && e.rel.startsWith(`${folder}/`) && TEMPLATE_EXTENSIONS.includes(asciiLower(extensionOf(e.name))));
		if (inside.length) plan.byHand.push([folder, `is passed through, and has ${inside.length} ${inside.length === 1 ? "template" : "templates"} (${inside.slice(0, 3).map((e) => e.rel).join(", ")}${inside.length > 3 ? ", ..." : ""}): Eleventy rendered ${inside.length === 1 ? "it" : "them"}, ssqch copies ${inside.length === 1 ? "it" : "them"} as ${inside.length === 1 ? "it is" : "they are"}. Move ${inside.length === 1 ? "it" : "them"} out of the folder, or pass through only the other files`]);
	}
}

/** The major version of Eleventy the site has: the one installed, or else the one `package.json` asks for. */
function eleventyMajor(dir: string): number | undefined {
	const major = (version: unknown) => (typeof version === "string" ? Number(/(\d+)/.exec(version)?.[1]) : Number.NaN);
	for (const file of [path.join(dir, "node_modules", "@11ty", "eleventy", "package.json"), path.join(dir, "package.json")]) {
		let pkg: unknown;
		try { pkg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
		if (!isPlainObject(pkg)) continue;
		const found = file.endsWith(path.join("eleventy", "package.json")) ? major(pkg.version) : major([pkg.dependencies, pkg.devDependencies].map((d) => (isPlainObject(d) ? d["@11ty/eleventy"] : undefined)).find((v) => v !== undefined));
		if (Number.isFinite(found)) return found;
	}
	return undefined;
}

/** What an Eleventy plugin or library is in ssqch. */
function replacement(pkg: string): string | undefined {
	switch (pkg) {
		case "@11ty/eleventy-img": return "`imagePlugin()` from \"ssqch/image\" (every <img> becomes a <picture>), or `image()` in data files";
		case "@11ty/eleventy-plugin-rss": return "`rssPlugin()` from \"ssqch/rss\"";
		case "@11ty/eleventy-plugin-syntaxhighlight": return "`markdown: { highlight: { classes: \"prism\", css: false } }`: Prism's class names and `<pre class=\"language-x\">`, so your Prism theme's CSS still colors the code";
		case "@11ty/eleventy-navigation": return "`nav` front matter and `pagesTree(collections.all)`, with `navTree`, `navPager` and `navBreadcrumbs`";
		case "@11ty/eleventy-fetch": return "`fetch(url, { cache: \"1d\" })`";
		case "@11ty/eleventy-plugin-bundle": case "@11ty/eleventy-plugin-webc": case "@11ty/is-land": return "custom elements with `elementsPlugin()` from \"ssqch/elements\"";
		case "@11ty/eleventy-upgrade-help": case "@11ty/eleventy": case "@11ty/eleventy-dev-server": return undefined;
		case "markdown-it": return "ssqch's own Markdown: see the `markdown` options (its `breaks`, `linkify` and `typographer` are `breaks`, `autolinks: \"fuzzy\"` and `smartPunctuation`), render hooks and containers; or keep it with `engines: { md }`";
		case "markdown-it-implicit-figures": return "`markdown: { figures: true }` (what it writes with `figcaption: true`)";
		case "markdown-it-anchor": return "heading ids are built in (`headingIds: \"markdown-it-anchor\"` for its own, in the draft unless it had a `slugify`); add its anchor links and `tabindex=\"-1\"` with `_includes/hooks/heading.*`";
		case "markdown-it-footnote": return "built in (`markdown: { footnotes: true }`, the default)";
		case "markdown-it-container": return "built in: `::: name` renders `_includes/containers/name.*`";
		case "markdown-it-attrs": return "`{#id .class}` on headings is built in";
		default: return "check whether it's needed: see `ssqch docs --from eleventy`";
	}
}

/** How a config is written, so the draft reads like the site's own code. */
interface Style {
	/** One level of indentation: a tab, or the config's number of spaces. */
	indent: string;
	/** Spaces inside brackets and parentheses: `[ "md" ]`, `defineConfig( {`. */
	padded: boolean;
	/** A comma after the last item of a multi-line object or list. */
	dangle: boolean;
	/** Quotes around every key (`"input": "src"`), not only the ones that need them. */
	quoteKeys: boolean;
}

const PADDED = rustRegExp(String.raw`[(\[][ \t]+[^\s)\]]`, "g");
const TIGHT = rustRegExp(String.raw`[(\[][^\s)\]]`, "g");
const DANGLING = rustRegExp(String.raw`,[ \t]*\r?\n[ \t]*[}\]]`, "g");
const CLOSED = rustRegExp(String.raw`[^\s,;{\[(][ \t]*\r?\n[ \t]*[}\]]`, "g");
const BARE_KEY = rustRegExp(String.raw`[{,]\s*[A-Za-z_$][\w$]*\s*:`);
const QUOTED_KEY = rustRegExp(String.raw`[{,]\s*["'][^"'\n]*["']\s*:`);

function styleOf(text: string): Style {
	const indents = lines(text).filter((l) => trim(l) !== "").map(indentOf).filter((i) => i !== "");
	let indent = "  ";
	if (indents.length && indents[0].startsWith("\t")) indent = "\t";
	else if (indents.length) {
		const sizes = indents.filter((i) => !i.includes("\t")).map((i) => Buffer.byteLength(i));
		const smallest = sizes.length ? sizes.reduce((a, b) => Math.min(a, b)) : 2;
		indent = " ".repeat(Math.min(8, Math.max(1, smallest)));
	}
	const count = (re: RegExp) => text.match(re)?.length ?? 0;
	const padded = count(PADDED) > count(TIGHT);
	// A closing bracket on its own line, after a comma or after a value (not after a statement's
	// `;`, which ends a function body).
	const dangle = count(DANGLING) >= count(CLOSED);
	const quoteKeys = !BARE_KEY.test(text) && QUOTED_KEY.test(text);
	return { indent, padded, dangle, quoteKeys };
}

/** An object key: quoted when it isn't an identifier, or when the config quotes every key. */
function styleKey(style: Style, key: string): string {
	const identifier = key !== "" && !/^[0-9]/.test(key) && IDENTIFIER.test(key);
	return identifier && !style.quoteKeys ? key : `"${key}"`;
}

/** Multi-line items (each already indented, without a comma), with commas between them and, if the config has them, after the last. */
function styleItems(style: Style, items: readonly string[]): string {
	return items.map((item, i) => `${item}${i + 1 < items.length || style.dangle ? "," : ""}\n`).join("");
}

/** `[a, b]` or `[ a, b ]`. */
const styleList = (style: Style, items: readonly string[]) => (style.padded ? `[ ${items.join(", ")} ]` : `[${items.join(", ")}]`);

/** Where the bracket that opens at `open` closes, skipping strings, template literals and comments. */
function closingBracket(text: string, open: number): number | undefined {
	let depth = 0;
	let i = open;
	while (i < text.length) {
		const c = text[i];
		if (c === "\"" || c === "'" || c === "`") {
			i++;
			while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end === -1 ? text.length : end + 1;
		} else if (c === "(" || c === "[" || c === "{") {
			depth++;
		} else if (c === ")" || c === "]" || c === "}") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return undefined;
}

/** `code` split at its top-level commas. */
function topLevelArgs(code: string): string[] {
	const parts: string[] = [];
	let start = 0, i = 0;
	while (i < code.length) {
		const c = code[i];
		if (c === "\"" || c === "'" || c === "`") {
			let j = i + 1;
			while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
			i = j;
		} else if (c === "(" || c === "[" || c === "{") {
			i = closingBracket(code, i) ?? code.length;
		} else if (c === ",") {
			parts.push(trim(code.slice(start, i)));
			start = i + 1;
		}
		i++;
	}
	parts.push(trim(code.slice(Math.min(start, code.length))));
	return parts.filter((p) => p !== "");
}

/** A JavaScript string literal's text (`"images"`, `'images'`), without escapes. */
function stringLiteral(code: string): string | undefined {
	const s = trim(code);
	const quote = s[0];
	if ((quote !== "\"" && quote !== "'" && quote !== "`") || s.length < 2 || !s.endsWith(quote)) return undefined;
	const inner = s.slice(1, -1);
	if (inner.includes("\\") || inner.includes(quote) || (quote === "`" && inner.includes("${"))) return undefined;
	return inner;
}

/** `{ "src/static": "/", images: "images" }` as passthrough entries, if every key and value is written out (no variables or computed values). */
function passthroughObject(code: string): Array<[string, string]> | undefined {
	const s = trim(code);
	if (!s.startsWith("{") || !s.endsWith("}") || s.length < 2) return undefined;
	const pairs: Array<[string, string]> = [];
	for (const pair of topLevelArgs(s.slice(1, -1))) {
		const colon = pair.indexOf(":");
		if (colon === -1) return undefined;
		const rawKey = trim(pair.slice(0, colon));
		const key = stringLiteral(rawKey) ?? (IDENTIFIER.test(rawKey) ? rawKey : undefined);
		const value = stringLiteral(pair.slice(colon + 1));
		if (key === undefined || value === undefined) return undefined;
		pairs.push([key, value]);
	}
	return pairs.length ? pairs : undefined;
}

const FUNCTION_EXPR = rustRegExp(String.raw`^(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)`);
const DECLARED = rustRegExp(String.raw`\b(?:const|let|var|function|class|import)\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)`, "g");
const DESTRUCTURED = rustRegExp(String.raw`\b(?:const|let|var|import)\s*\{([^}]*)\}`, "g");

/** The names a config declares (imports, requires, functions, variables), to tell a function that only uses its own arguments from one that needs something else in the file. */
function declaredNames(text: string): Set<string> {
	const names = new Set<string>();
	for (const c of text.matchAll(DECLARED)) names.add(c[1]);
	for (const c of text.matchAll(DESTRUCTURED)) {
		for (const part of c[1].split(",")) {
			const name = trim(part.split(/[: ]/).reverse().find((w) => trim(w) !== "") ?? "");
			if (name !== "") names.add(name);
		}
	}
	names.add("eleventyConfig");
	return names;
}

/**
 * The names a function's parameters declare: `(value, { a, b } = {}, ...rest) =>` declares
 * value, a, b and rest. A default value's names are what it reads, from the config
 * (`format = dateFormat`), so they aren't the function's; 0.7 counted them, and moved such a
 * function into the draft without the variable it needs.
 */
function parameterNames(head: string): Set<string> {
	const names = new Set<string>();
	const add = (text: string) => {
		for (const word of text.split(/[^\p{Alphabetic}\p{N}_$]/u)) if (word !== "") names.add(word);
	};
	const open = head.indexOf("("), close = head.lastIndexOf(")");
	// `name =>` and `function`, which has its parameters after the match.
	if (open === -1 || close < open) {
		add(head);
		return names;
	}
	for (const param of topLevelArgs(head.slice(open + 1, close))) add(withoutDefaults(param));
	return names;
}

/** A parameter without its default values (`{ a = 1, b } = {}` is `{ a, b }`). */
function withoutDefaults(param: string): string {
	let out = "";
	// The depth of the brackets a default value is being skipped at, or -1.
	let skipping = -1;
	let depth = 0;
	for (let i = 0; i < param.length; i++) {
		const c = param[i];
		if (c === "\"" || c === "'" || c === "`") {
			let j = i + 1;
			while (j < param.length && param[j] !== c) j += param[j] === "\\" ? 2 : 1;
			if (skipping === -1) out += param.slice(i, j + 1);
			i = j;
		} else if (c === "{" || c === "[") {
			depth++;
			if (skipping === -1) out += c;
		} else if (c === "}" || c === "]") {
			if (skipping === depth) skipping = -1;
			depth--;
			if (skipping === -1) out += c;
		} else if (c === "," && skipping === depth) {
			skipping = -1;
			out += c;
		} else if (c === "=" && param[i + 1] !== ">" && skipping === -1) {
			skipping = depth;
		} else if (skipping === -1) {
			out += c;
		}
	}
	return out;
}

/**
 * A filter's or shortcode's function, if it can move to `filters` as written: a function
 * expression that uses nothing from the rest of the config (no imports, no variables, no
 * `eleventyConfig`, no `this`, which is Eleventy's page context).
 */
function portableFunction(source: string, config: string, declared: ReadonlySet<string>): string | undefined {
	if (!FUNCTION_EXPR.test(source) || source.includes("this")) return undefined;
	// Names the function declares itself (its parameters, its own variables) are fine.
	const own = declaredNames(source);
	const params = parameterNames(FUNCTION_EXPR.exec(source)?.[0] ?? "");
	const outside = declaredNames(config.replace(source, () => ""));
	const uses = (name: string) => rustRegExp(String.raw`(^|[^\w$.])${escapeRegex(name)}([^\w$]|$)`).test(source);
	const foreign = [...declared].some((n) => outside.has(n) && !own.has(n) && !params.has(n) && uses(n));
	return foreign ? undefined : source;
}

/** `source` moved from `fromIndent` to `toIndent`: its first line as it is, the others with `fromIndent` swapped for `toIndent`. */
function reindent(source: string, fromIndent: string, toIndent: string): string {
	const [first = "", ...rest] = lines(source);
	let out = first;
	for (const line of rest) {
		out += "\n";
		if (trim(line) !== "") out += toIndent + (line.startsWith(fromIndent) ? line.slice(fromIndent.length) : trimStart(line));
	}
	return out;
}

/** A first `ssqch.config.js` from an Eleventy config, and what in it needs porting. */
export function draftConfig(name: string, text: string, extensions: ReadonlySet<string>, ports: ReadonlyArray<[string, string]> = [], eleventyMajor?: number, helpers: ReadonlyArray<[string, ReadonlyArray<[string, string]>]> = [], followed: ReadonlySet<string> = new Set(), ignored: readonly string[] = []): [string, Array<[string, string]>, Array<[string, string]>] {
	const code = blankComments(text);
	const lineOf = (offset: number) => occurrences(text.slice(0, offset), "\n") + 1;
	const style = styleOf(text);
	const ind = style.indent;
	const declared = declaredNames(text);
	const byHand: Array<[string, string]> = [];
	const passthrough: string[] = [], watch: string[] = [], todo: string[] = [];
	// `addLayoutAlias("post", "layouts/post.njk")`: [name, layout].
	const aliases: Array<[string, string]> = [];
	// Filters and shortcodes moved as written: [name, function source].
	const ported: Array<[string, string]> = [];
	for (const c of code.matchAll(CALL)) {
		const [whole, method, given, bare] = c;
		// A template literal with `${...}` in it is worked out when the config runs, like a
		// variable. 0.7 took its text for a name or a path (`passthrough: ["${dir}/img"]`).
		const quoted = given !== undefined && whole[whole.length - given.length - 2] === "`" && given.includes("${") ? undefined : given;
		const at = `${name}:${lineOf(c.index)}`;
		const arg = quoted ?? bare ?? "...";
		// The call's arguments, as written.
		const open = c.index + Math.max(0, whole.indexOf("("));
		const close = closingBracket(code, open);
		const args = close === undefined ? [] : topLevelArgs(text.slice(open + 1, close));
		const before = text.slice(0, c.index);
		const lastLine = before.slice(before.lastIndexOf("\n") + 1);
		const callIndent = indentOf(lastLine);
		const port = (): boolean => {
			if (quoted === undefined || args.length !== 2) return false;
			const source = portableFunction(args[1], text, declared);
			if (source === undefined) return false;
			ported.push([quoted, reindent(source, callIndent, ind.repeat(2))]);
			return true;
		};
		// A name from a variable (`addShortcode(name, ...)` in a helper that registers several):
		// there's no one name to list.
		const registers = method.startsWith("add") && (method.includes("Filter") || method.includes("Shortcode") || method.includes("Tag") || method === "addNunjucksGlobal");
		if (registers && quoted === undefined) {
			byHand.push([at, `${method}(${arg}, ...) takes its name from a variable: find the names it's called with, and port each one to \`filters\``]);
			continue;
		}
		switch (method) {
			case "addPassthroughCopy": {
				const pairs = args[0] === undefined ? undefined : passthroughObject(args[0]);
				if (quoted !== undefined) passthrough.push(`"${quoted}"`);
				else if (pairs) for (const [from, to] of pairs) passthrough.push(`{ ${styleKey(style, from)}: "${to}" }`);
				else byHand.push([at, "addPassthroughCopy with a variable or a computed value -> `passthrough: [{ from: to }]`"]);
				break;
			}
			case "addWatchTarget":
				if (quoted !== undefined) watch.push(`"${quoted}"`);
				else byHand.push([at, "addWatchTarget -> `watch`"]);
				break;
			case "addFilter": case "addAsyncFilter": case "addNunjucksFilter": case "addLiquidFilter":
				if (!port()) {
					todo.push(`filters: ${arg}`);
					byHand.push([at, `${method}("${arg}") -> \`filters: { ${arg}: ... }\` (async functions are awaited)`]);
				}
				break;
			case "addNunjucksAsyncFilter":
				todo.push(`filters: ${arg}`);
				byHand.push([at, `${method}("${arg}") -> \`filters: { ${arg}: async (value) => ... }\`: return the result instead of calling the callback`]);
				break;
			case "addShortcode": case "addAsyncShortcode": case "addNunjucksShortcode": case "addNunjucksAsyncShortcode": case "addLiquidShortcode":
				if (!port()) {
					todo.push(`filters: ${arg}`);
					byHand.push([at, `${method}("${arg}") -> a filter: \`filters: { ${arg}: ... }\`. Nunjucks keeps \`{% ${arg} ... %}\`; in Liquid it's \`{{ x | ${arg} }}\``]);
				}
				break;
			case "addPairedShortcode": case "addPairedAsyncShortcode": case "addPairedNunjucksShortcode": case "addPairedNunjucksAsyncShortcode": case "addPairedLiquidShortcode":
				if (!port()) {
					todo.push(`filters: ${arg}`);
					byHand.push([at, `${method}("${arg}") -> a filter that gets the content first. Nunjucks keeps \`{% ${arg} %}...{% end${arg} %}\`; in Markdown, a \`::: ${arg}\` container`]);
				}
				break;
			case "addCollection":
				todo.push(`collections: ${arg}`);
				byHand.push([at, `addCollection("${arg}") -> \`collections: { ${arg}: (pages) => ... }\`: getAll() is pages.all(), getFilteredByTag is pages.byTag, getFilteredByGlob is pages.byGlob`]);
				break;
			case "addTransform":
				byHand.push([at, `addTransform("${arg}") -> \`transforms: { ${arg}: (content, page) => content }\` (an HTML minifier is \`minifyPlugin()\`)`]);
				break;
			case "addGlobalData":
				byHand.push([at, `addGlobalData("${arg}") -> \`data: { ${arg}: value or function }\``]);
				break;
			case "addNunjucksTag": case "addLiquidTag":
				todo.push(`filters: ${arg}`);
				byHand.push([at, `${method}("${arg}") -> a custom tag is a filter in ssqch: \`filters: { ${arg}: ... }\`, and \`{% ${arg} ... %}\` keeps working in Nunjucks`]);
				break;
			case "addNunjucksGlobal":
				byHand.push([at, `addNunjucksGlobal("${arg}") -> \`data: { ${arg}: value }\`, or a filter for a function`]);
				break;
			case "addMarkdownHighlighter":
				byHand.push([at, "addMarkdownHighlighter -> `markdown: { highlight: true }`, or a fence hook for a highlighter of your own"]);
				break;
			case "addPlugin": {
				// A plugin from a package ssqch knows is listed below; one of the site's own isn't read.
				const pkg = pluginPackage(code, arg);
				const known = pkg !== undefined && `require("${pkg}")`.search(REQUIRE) !== -1 && replacement(pkg) !== undefined;
				const from = pkg === undefined ? "" : ` (from ${pkg})`;
				if (known) byHand.push([at, `addPlugin(${arg})${from} -> see its package below`]);
				else if (pkg !== undefined && followed.has(pkg)) byHand.push([at, `addPlugin(${arg})${from}: the site's own plugin. What it adds is listed with its own file and line, and what could be copied as written is in the draft`]);
				else byHand.push([at, `addPlugin(${arg})${from}: a plugin ssqch doesn't know, so the filters, shortcodes and transforms it adds aren't listed here. Read its source and port them, or put it in \`plugins: [...]\` if it's written for ssqch`]);
				break;
			}
			case "setLibrary": {
				// The library as written (`md`, `markdownIt(options).use(plugin)`): it comes along as an
				// engine, with the imports and setup it needs, which the draft can't follow.
				const library = quoted === "md" && args[1] !== undefined ? trim(args[1]) : undefined;
				if (library !== undefined) byHand.push([at, `setLibrary("md", ${library.length > 60 || library.includes("\n") ? "..." : library}) -> keep your markdown-it as it is with \`engines: { ${library === "md" ? "md" : `md: ${/^[A-Za-z_$][\w$]*$/.test(library) ? library : "yourMarkdownIt"}`} }\` (bring its import and setup into the config; \`ssqch docs "moving with identical output first"\`), or ssqch's own Markdown: \`markdown: { ... }\` options, render hooks and containers`]);
				else if (quoted !== undefined && quoted !== "md") byHand.push([at, `setLibrary("${quoted}") -> ssqch has its own; a library of your own is an engine: \`engines: { ${quoted}: { render: (source, data) => ... } }\``]);
				else byHand.push([at, "setLibrary -> ssqch renders Markdown itself: `markdown: { ... }` options, render hooks and containers"]);
				break;
			}
			case "addLayoutAlias": {
				const target = args[1] === undefined ? undefined : stringLiteral(args[1]);
				if (quoted !== undefined && target !== undefined) aliases.push([quoted, target]);
				else byHand.push([at, "addLayoutAlias with a variable -> `layoutAliases: { name: \"layouts/name.njk\" }`"]);
				break;
			}
			case "addDataExtension":
				byHand.push([at, "addDataExtension -> YAML, TOML and JSON data files load as they are"]);
				break;
			case "on":
				if (quoted?.startsWith("eleventy.")) byHand.push([at, `on("${arg}") -> \`beforeBuild\` or \`afterBuild\``]);
				break;
		}
	}
	const required = new Set([...code.matchAll(REQUIRE)].map((c) => c[1]));
	const packages = [...required].filter((p) => replacement(p) !== undefined).sort(compareText);
	// markdown-it's options that ssqch's Markdown has too, wherever the config sets them (in the
	// `markdownIt(...)` call, a variable it's given, or `md.set(...)`).
	const markdown: string[] = [];
	// Defaults where Eleventy's Markdown and ssqch's write different markup, each with why, so the
	// first build matches the old one (blog #5, #6; v8 #3). A person can take a line out to move to
	// ssqch's.
	const markdownDefaults: Array<[string, string]> = [];
	const ownLibrary = /\.\s*setLibrary\s*\(\s*["'\x60]md["'\x60]/.test(code);
	if (required.has("markdown-it")) {
		if (/\bbreaks\s*:\s*true\b/.test(code)) markdown.push("breaks: true");
		if (/\blinkify\s*:\s*true\b/.test(code)) markdown.push("autolinks: \"fuzzy\"");
		if (/\btypographer\s*:\s*true\b/.test(code)) markdown.push("smartPunctuation: true");
		if (required.has("markdown-it-implicit-figures")) markdown.push("figures: true");
	}
	if (extensions.has("md")) {
		if (!required.has("markdown-it-anchor")) markdownDefaults.push(["Eleventy's markdown-it gave headings no ids (no markdown-it-anchor); take this out for ssqch's.", "headingIds: false"]);
		// markdown-it-anchor's own ids, unless the site gives it a `slugify` of its own (the
		// a11yproject.com rerun: 50 pages' ids with `’`, `:` or `?` were others in ssqch's).
		else if (!/\bslugify\s*:/.test(code)) markdownDefaults.push(["markdown-it-anchor's ids (encodeURIComponent of the text); take this out for ssqch's.", "headingIds: \"markdown-it-anchor\""]);
		// Eleventy 2 turned indented code off in its own markdown-it, and 3 in a site's too.
		if (eleventyMajor !== undefined && (eleventyMajor >= 3 || (eleventyMajor === 2 && !ownLibrary))) markdownDefaults.push([`Eleventy ${eleventyMajor} turns off markdown-it's indented code blocks (\`md.disable("code")\`).`, "indentedCode: false"]);
	}
	for (const pkg of packages) byHand.push([name, `${pkg} -> ${replacement(pkg)}`]);

	// Eleventy runs Markdown and HTML through Liquid unless told otherwise.
	const engine = (key: string): string | undefined => {
		const value = setting(code, key);
		if (value === "njk") return "\"njk\"";
		if (value === "false" || value === "") return "false";
		if (value !== undefined) return `"${value}"`;
		return code.includes(`${key}: false`) ? "false" : undefined;
	};
	const markdownEngine = engine("markdownTemplateEngine"), htmlEngine = engine("htmlTemplateEngine");
	const enginesComment = markdownEngine === undefined
		? htmlEngine === undefined ? "Eleventy's defaults: Markdown and HTML run through Liquid first." : "From the Eleventy config's htmlTemplateEngine; Markdown runs through Liquid first, Eleventy's default."
		: htmlEngine === undefined ? "From the Eleventy config's markdownTemplateEngine; HTML runs through Liquid first, Eleventy's default." : "From the Eleventy config's markdownTemplateEngine and htmlTemplateEngine.";
	const listed = FORMATS.exec(code);
	const formats = listed
		? listed[1].split(",").map((f) => trimMatches(trim(f), "\"'`")).filter((f) => f !== "" && f !== "11ty.js")
		: [...extensions].sort(compareText).filter((e) => e !== "edge");
	const quotedList = (items: readonly string[]) => styleList(style, items.map((i) => `"${i}"`));
	const dirs: string[] = [];
	for (const key of ["input", "output", "includes", "layouts", "data"]) {
		const value = setting(code, key);
		if (value !== undefined) dirs.push(`${key}: "${value}"`);
	}
	const [open, close] = style.padded ? ["( {", "} )"] : ["({", "})"];
	let out = `// A first draft, written by \`ssqch import eleventy\` from ${name}.\n// What it couldn't carry over is listed at the end; \`ssqch docs --from eleventy\` has the whole\n// mapping.\nimport { defineConfig } from "ssqch";\n\nexport default defineConfig${open}\n`;
	const entries: string[] = [];
	if (dirs.length) entries.push(`${ind}dirs: { ${dirs.join(", ")} }`);
	if (formats.length) entries.push(`${ind}templateFormats: ${quotedList(formats)}`);
	entries.push(`${ind}// ${enginesComment}\n${ind}markdownEngine: ${markdownEngine ?? "\"liquid\""}`);
	entries.push(`${ind}htmlEngine: ${htmlEngine ?? "\"liquid\""}`);
	const prefix = setting(code, "pathPrefix");
	if (prefix !== undefined && prefix !== "/") entries.push(`${ind}base: "${prefix}"`);
	if (markdownDefaults.length) {
		const items = markdownDefaults.map(([why, item]) => `${ind}${ind}// ${why}\n${ind}${ind}${item}`);
		if (markdown.length) items.push(`${ind}${ind}// From the Eleventy config's markdown-it options.\n${ind}${ind}${markdown.join(`,\n${ind}${ind}`)}`);
		entries.push(`${ind}markdown: {\n${styleItems(style, items)}${ind}}`);
	} else if (markdown.length) entries.push(`${ind}// From the Eleventy config's markdown-it options.\n${ind}markdown: { ${markdown.join(", ")} }`);
	if (aliases.length) entries.push(`${ind}// From addLayoutAlias: \`layout: ${aliases[0][0]}\` is that file (without it, it'd be \`_includes/${aliases[0][0]}.*\`).\n${ind}layoutAliases: { ${aliases.map(([name, target]) => `${styleKey(style, name)}: "${target}"`).join(", ")} }`);
	if (ignored.length) entries.push(`${ind}// From .eleventyignore.\n${ind}ignore: ${styleList(style, ignored.map((g) => `"${g}"`))}`);
	// Eleventy renders a JSON data file's strings with this engine; ssqch reads data as it is.
	const dataEngine = /\bdataTemplateEngine\s*:\s*["'\x60]([^"'\x60]*)["'\x60]/.exec(code)?.[1];
	if (dataEngine) byHand.push([name, `dataTemplateEngine: "${dataEngine}" -> ssqch doesn't render data files' strings. The ones that were only a literal through \`url\` (\`{{ '/about/' | url }}\`) are the literal now; the files with other template code are listed`]);
	// The same entry twice (a11yproject.com's `logo-192x192.png`) is copied once.
	if (passthrough.length) entries.push(`${ind}passthrough: ${styleList(style, [...new Set(passthrough)])}`);
	if (watch.length) entries.push(`${ind}watch: ${styleList(style, watch)}`);
	let filters = `\n${ind}filters: {\n`;
	if (ported.length) {
		filters += `${ind}${ind}// From ${name}, as written.\n`;
		filters += styleItems(style, ported.map(([filter, source]) => `${ind}${ind}${styleKey(style, filter)}: ${source}`));
	}
	for (const [file, list] of helpers) {
		if (!list.length) continue;
		filters += `${ind}${ind}// From ${file}, as written.\n`;
		filters += styleItems(style, list.map(([filter, source]) => `${ind}${ind}${styleKey(style, filter)}: ${source}`));
	}
	if (ports.length) {
		filters += `${ind}${ind}// Eleventy's own filters the templates use, ported.\n`;
		// The ports are written with tabs; the draft indents as the config does.
		filters += styleItems(style, ports.map(([filter, source]) => `${ind}${ind}${styleKey(style, filter)}: ${source.replaceAll("\t", ind)}`));
	}
	// The placeholder, unless every filter and shortcode was ported (the list at the end names the
	// ones left). After the last filter, a comment doesn't count as a trailing comma.
	if ((!ported.length && !ports.length && !helpers.some(([, list]) => list.length)) || todo.some((t) => t.startsWith("filters:"))) filters += `${ind}${ind}// Port each filter and shortcode here: name: (value, ...args) => result\n`;
	filters += `${ind}}`;
	entries.push(filters);
	entries.push(`${ind}collections: {\n${ind}${ind}// name: (pages) => pages.byTag("post")\n${ind}}`);
	entries.push(`${ind}plugins: []`);
	out += styleItems(style, entries);
	out += `${close};\n`;
	if (todo.length) {
		out += `\n// To port from ${name}:\n`;
		for (const item of todo) out += `//   ${item}\n`;
	}
	return [out, byHand, ported];
}

const LOCKFILES: ReadonlyArray<readonly [string, readonly string[]]> = [["pnpm", ["pnpm-lock.yaml"]], ["yarn", ["yarn.lock"]], ["bun", ["bun.lock", "bun.lockb"]], ["npm", ["package-lock.json", "npm-shrinkwrap.json"]]];

/** `packageManager` in package.json, if it's written. */
const packageManagerField = (pkg: unknown) => (isPlainObject(pkg) && typeof pkg.packageManager === "string" ? pkg.packageManager : undefined);

/** The package manager a site uses: `packageManager` in package.json, or the lockfile that's there. */
function packageManager(dir: string, pkg: unknown): string {
	const named = (packageManagerField(pkg) ?? "").split("@")[0];
	const byName = LOCKFILES.find(([pm]) => named === pm);
	if (byName) return byName[0];
	return LOCKFILES.find(([, lockfiles]) => lockfiles.some((l) => isFile(path.join(dir, l))))?.[0] ?? "npm";
}

const ELEVENTY_COMMAND = rustRegExp(String.raw`(?:\bnpx\s+(?:-y\s+)?)?(?:@11ty/)?\beleventy\b((?:\s+--?[\w-]+(?:[= ](?:\x22[^\x22]*\x22|'[^']*'|[^\s&|;\x22-][^\s&|;\x22]*))?)*)`, "g");

/** An npm script with ssqch's commands for Eleventy's (`eleventy --serve` is `ssqch serve`), and the flags it couldn't carry over. */
export function rewriteScript(script: string, names: readonly string[]): [string, string[]] {
	const unknown: string[] = [];
	const out = script.replace(ELEVENTY_COMMAND, (whole: string, given: string, start: number) => {
		if (!isEleventyCommand(script, start, start + whole.length - given.length, names)) return whole;
		let command = "build";
		const flags: string[] = [];
		const parts = splitWhitespace(given);
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const eq = part.indexOf("=");
			const flag = eq === -1 ? part : part.slice(0, eq);
			let value = eq === -1 ? undefined : part.slice(eq + 1);
			// The value after `=`, or the next word if it isn't a flag.
			const valueOf = () => {
				if (value === undefined && i + 1 < parts.length && !parts[i + 1].startsWith("-")) value = parts[++i];
				return value;
			};
			if (flag === "--serve" || flag === "--watch") command = "serve";
			else if (flag === "--quiet") flags.push("--quiet");
			else if (flag === "--port") { const port = valueOf(); if (port !== undefined) flags.push(`--port ${port}`); }
			else if (flag === "--output") { const output = valueOf(); if (output !== undefined) flags.push(`--output ${output}`); }
			else if (flag === "--pathprefix" || flag === "--pathPrefix") { const base = valueOf(); if (base !== undefined) flags.push(`--base ${base}`); }
			else if (flag !== "--incremental") unknown.push(flag);
		}
		const kept = command === "build" ? flags.filter((f) => !f.startsWith("--port")) : flags;
		return [`ssqch ${command}`, ...kept].join(" ");
	});
	return [out, unknown];
}

const lastChar = (s: string) => (s === "" ? undefined : Array.from(s.slice(-2)).pop());
const firstChar = (s: string) => (s === "" ? undefined : String.fromCodePoint(s.codePointAt(0)!));

/**
 * Whether the `eleventy` matched from `start` (to `wordEnd`, the end of the word) runs Eleventy,
 * rather than being part of a name (`eleventy-watch`, `build:eleventy`, `eleventy.config.js`) or a
 * script that a package manager runs (`npm run eleventy`, `run-s clean eleventy`, and `pnpm
 * eleventy` or `yarn eleventy` when there's such a script).
 */
function isEleventyCommand(script: string, start: number, wordEnd: number, names: readonly string[]): boolean {
	const partOfName = (c: string | undefined) => c !== undefined && (/^[\p{Alphabetic}\p{N}]$/u.test(c) || "_-:./@$".includes(c));
	if (partOfName(lastChar(script.slice(0, start))) || partOfName(firstChar(script.slice(wordEnd)))) return false;
	// The words of this command before the match, after any `NAME=value` settings.
	const command = script.slice(0, start).split(/[&|;]/).pop() ?? "";
	const all = splitWhitespace(command);
	let skip = 0;
	while (skip < all.length && all[skip].includes("=") && !all[skip].startsWith("-")) skip++;
	const words = all.slice(skip);
	if (words.length === 0) return true;
	if (["npm", "pnpm", "yarn", "bun"].includes(words[0]) && ["run", "run-script"].includes(words[1])) return false;
	if (["run-s", "run-p", "npm-run-all", "npm-run-all2"].includes(words[0])) return false;
	if (words.length === 1 && (words[0] === "pnpm" || words[0] === "yarn")) return !names.includes("eleventy");
	return true;
}

/** package.json with ssqch for Eleventy, in the dependencies and the scripts, and what's left: lockfiles to update or remove. */
/**
 * Packages that came with `@11ty/eleventy` when its own `node_modules` has none to say: the ones
 * sites were found importing without listing (a11y #19, v8.dev's `slugify`, lit.dev's
 * gray-matter).
 */
const CAME_WITH_ELEVENTY = ["@sindresorhus/slugify", "browser-sync", "chokidar", "debug", "fast-glob", "gray-matter", "js-yaml", "liquidjs", "luxon", "markdown-it", "minimist", "moo", "nunjucks", "posthtml", "slugify"];

const BARE_IMPORT = new RegExp(String.raw`(?:\brequire\(\s*|\bimport\s*\(\s*|\bfrom\s+|^\s*import\s+)["']([^"'./][^"']*)["']`, "gm");

/** A bare specifier's package: `luxon`, `@11ty/eleventy-img` from `@11ty/eleventy-img/sharp`. */
function packageOf(specifier: string): string | undefined {
	if (specifier.startsWith("node:") || specifier.includes(":")) return undefined;
	const parts = specifier.split("/");
	const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
	return builtinModules.includes(name) ? undefined : name;
}

/**
 * The packages the site's own JavaScript (its config, data files, scripts, a gulpfile) imports
 * that `package.json` doesn't list and that came with Eleventy, with the version installed (or
 * undefined when there's no `node_modules` to read it from), and the first file that imports each.
 */
function cameWithEleventy(dir: string, root: Data, entries: Entry[]): Array<[string, string | undefined, string]> {
	const listed = new Set<string>();
	for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
		if (isPlainObject(root[section])) for (const name of Object.keys(root[section])) listed.add(name);
	}
	// What Eleventy itself depends on, when it's installed; else the packages sites were found using.
	const installed = (name: string): Data | undefined => {
		try { const p = JSON.parse(fs.readFileSync(path.join(dir, "node_modules", ...name.split("/"), "package.json"), "utf8")); return isPlainObject(p) ? p : undefined; } catch { return undefined; }
	};
	const eleventyPkg = installed("@11ty/eleventy");
	const eleventyDeps = eleventyPkg && isPlainObject(eleventyPkg.dependencies) ? new Set(Object.keys(eleventyPkg.dependencies)) : undefined;
	const came = (name: string) => (eleventyDeps ? eleventyDeps.has(name) : CAME_WITH_ELEVENTY.includes(name));
	const found = new Map<string, string>();
	for (const entry of entries) {
		if (!entry.isFile || !/\.(?:[cm]?js|[cm]?ts)$/.test(entry.name)) continue;
		const text = readUtf8(entry.abs);
		if (text === undefined) continue;
		for (const m of blankComments(text).matchAll(BARE_IMPORT)) {
			const name = packageOf(m[1]);
			if (name === undefined || listed.has(name) || name === "@11ty/eleventy" || found.has(name) || !came(name)) continue;
			found.set(name, entry.rel);
		}
	}
	return [...found].sort(([a], [b]) => compareText(a, b)).map(([name, file]) => {
		const version = installed(name)?.version;
		return [name, typeof version === "string" ? version : undefined, file];
	});
}

function packageFiles(dir: string, plan: Plan, entries: Entry[] = []): void {
	const text = readUtf8(path.join(dir, "package.json"));
	if (text === undefined) return;
	let pkg: unknown;
	try {
		pkg = JSON.parse(text);
	} catch {
		plan.byHand.push(["package.json", "isn't valid JSON, so its Eleventy dependency and scripts weren't changed"]);
		return;
	}
	const root: Data = isPlainObject(pkg) ? pkg : {};
	// The file is changed where it changes, and kept as it's written everywhere else.
	const edits = new JsonText(text);
	const version = VERSION;
	const changes: string[] = [];
	// The dependency: Eleventy's goes, and ssqch is a dev dependency (it builds the site; the site
	// doesn't import it at run time), pinned exactly, as the README's Install says.
	const hasSsqch = ["dependencies", "devDependencies"].some((k) => isPlainObject(root[k]) && Object.hasOwn(root[k], "ssqch"));
	let removed = false;
	// Where Eleventy was: the packages that came with it go there.
	let eleventySection = "devDependencies";
	const missing = cameWithEleventy(dir, root, entries);
	for (const section of ["dependencies", "devDependencies"]) {
		const deps = root[section];
		if (!isPlainObject(deps)) continue;
		if (Object.hasOwn(deps, "@11ty/eleventy")) {
			eleventySection = section;
			// Its packages stay, before it goes, so `dependencies` isn't left empty and removed.
			for (const [name, version] of missing) {
				if (version === undefined) continue;
				deps[name] = version;
				edits.insert([section], name, JSON.stringify(version), (other) => compareText(other, name) > 0);
			}
			delete deps["@11ty/eleventy"];
			edits.remove([section], "@11ty/eleventy");
			removed = true;
		}
		if (Object.keys(deps).length === 0 && section === "dependencies") {
			delete root[section];
			edits.remove([], section);
		}
	}
	if (removed) {
		const pinned = missing.filter(([, version]) => version !== undefined);
		if (pinned.length) changes.push(`${pinned.map(([name, version]) => `${name} ${version}`).join(", ")} added to ${eleventySection}: the site's own code imports ${pinned.length === 1 ? "it" : "them"}, and ${pinned.length === 1 ? "it" : "they"} came with @11ty/eleventy (pinned to the version installed, since the output can depend on it)`);
		for (const [name, version, file] of missing) {
			if (version === undefined) plan.byHand.push([file, `imports ${name}, which came with @11ty/eleventy and isn't in package.json: add it (\`npm ls ${name}\` before removing Eleventy says which version it had)`]);
		}
		if (hasSsqch) {
			changes.push("@11ty/eleventy removed (ssqch is already there)");
		} else {
			const pinned = JSON.stringify(version);
			if (!Object.hasOwn(root, "devDependencies")) {
				root.devDependencies = { ssqch: version };
				edits.insert([], "devDependencies", edits.object([["ssqch", pinned]], 1));
			} else if (isPlainObject(root.devDependencies)) {
				root.devDependencies.ssqch = version;
				// In its place in the sorted list, leaving the others where they are.
				edits.insert(["devDependencies"], "ssqch", pinned, (other) => compareText(other, "ssqch") > 0);
			}
			changes.push(`@11ty/eleventy -> ssqch ${version} in devDependencies`);
		}
	}
	// The scripts: each string value in the `scripts` object.
	const unknownFlags: string[] = [];
	const flagsAre = (unknown: string[]) => `${unknown.join(", ")} ${unknown.length === 1 ? "flag is" : "flags are"} Eleventy's: check what ssqch has (\`ssqch build --help\`, \`ssqch serve --help\`)`;
	const scripts = isPlainObject(root.scripts) ? root.scripts : undefined;
	const names = scripts ? Object.keys(scripts) : [];
	if (scripts) {
		let changed = false;
		for (const [name, script] of Object.entries(scripts)) {
			if (typeof script !== "string") continue;
			const [rewritten, unknown] = rewriteScript(script, names);
			if (rewritten !== script) {
				scripts[name] = rewritten;
				edits.replace(["scripts", name], JSON.stringify(rewritten));
				changed = true;
			}
			if (unknown.length) unknownFlags.push(`the \`${name}\` script's ${flagsAre(unknown)}`);
			// `eleventy & gulp` runs both at once, and npm returns when the last one does: a deploy
			// can start while ssqch is still writing (a11yproject.com's `publish`).
			if (/ssqch build[^&|;]*[^&]&(?!&)|(?:^|[^&])&\s*(?:npx\s+)?ssqch build/.test(rewritten)) plan.byHand.push(["package.json", `the \`${name}\` script runs \`ssqch build\` and another command at the same time (\`&\`): npm returns when the last one does, so what runs next (a deploy) can start while ssqch is still writing. Use \`&&\` to run them one after the other`]);
		}
		if (changed) changes.push("scripts: eleventy -> ssqch build, eleventy --serve -> ssqch serve");
	}
	// wireit runs a script's `command` from its own block, which monorepos use instead of
	// `scripts` (lit.dev).
	if (isPlainObject(root.wireit)) {
		let changed = false;
		for (const [name, task] of Object.entries(root.wireit)) {
			if (!isPlainObject(task) || typeof task.command !== "string") continue;
			const [rewritten, unknown] = rewriteScript(task.command, names);
			if (rewritten !== task.command) {
				task.command = rewritten;
				edits.replace(["wireit", name, "command"], JSON.stringify(rewritten));
				changed = true;
			}
			if (unknown.length) unknownFlags.push(`wireit's \`${name}\` command's ${flagsAre(unknown)}`);
		}
		if (changed) changes.push("wireit commands: eleventy -> ssqch build, eleventy --serve -> ssqch serve");
	}
	for (const what of unknownFlags) plan.byHand.push(["package.json", what]);
	const edited = changes.length > 0;
	if (edited) plan.edits.push(["package.json", changes, edits.text]);
	// Lockfiles: the package manager's needs updating, another one's is stale.
	const pm = packageManager(dir, pkg);
	for (const [manager, lockfiles] of LOCKFILES) {
		for (const lockfile of lockfiles) {
			const file = path.join(dir, lockfile);
			if (!isFile(file)) continue;
			let mentions = false;
			try { mentions = fs.readFileSync(file).includes("@11ty/eleventy"); } catch { /* as 0.7: an unreadable lockfile doesn't mention it */ }
			if (manager !== pm) plan.byHand.push([lockfile, `${manager}'s lockfile, but the site uses ${pm}: delete it (a host that installs from it gets ${mentions ? "Eleventy" : "old packages"} and no ssqch)`]);
			else if (mentions || edited) plan.byHand.push([lockfile, `run \`${pm} install\` to update it for ssqch`]);
		}
	}
	// pnpm 11 and later wait a day before installing a release.
	if (pm === "pnpm" && edited && waitsForReleaseAge(dir, pkg)) {
		plan.byHand.push(["pnpm-workspace.yaml", `pnpm waits a day before installing a new release, so if ssqch ${version} came out today, the install fails: add \`ssqch\` under \`minimumReleaseAgeExclude\` (\`ssqch docs "release age"\`)`]);
	}
}

/** Whether pnpm would hold back a release made today: pnpm 11 or later (or a version `packageManager` doesn't say), and ssqch not already excluded from `minimumReleaseAge`. */
function waitsForReleaseAge(dir: string, pkg: unknown): boolean {
	const field = packageManagerField(pkg);
	const major = field?.startsWith("pnpm@") ? field.slice(5).split(".")[0] : undefined;
	if (major !== undefined && /^\+?\d+$/.test(major) && Number(major) <= 0xffff_ffff && Number(major) < 11) return false;
	const workspace = lines(readUtf8(path.join(dir, "pnpm-workspace.yaml")) ?? "");
	const excluded = workspace.some((l) => trimMatches(trim(trimStart(l).replace(/^-+/, "")), "'\"").split("@")[0] === "ssqch");
	const off = workspace.some((l) => trim(l).replaceAll(" ", "") === "minimumReleaseAge:0");
	return !excluded && !off;
}

// ---- Zola ----------------------------------------------------------------------------------

const TERA_CALLS = rustRegExp(String.raw`\b(get_url|get_section|get_page|get_taxonomy|get_taxonomy_url|get_image_metadata|resize_image|load_data|trans|get_hash)\s*\(`, "g");
const NAMED_ARGUMENT = rustRegExp(String.raw`\|\s*\w+\(\s*\w+\s*=`, "g");
const SHORTCODE_CALL = rustRegExp(String.raw`\{[{%]\s*([a-z_][a-z0-9_]*)\s*\(`, "g");

/** A Zola page's front matter with ssqch's names: `tags` out of `[taxonomies]` to the top level, and `path` as a `permalink`. */
export function rewriteZolaFrontMatter(text: string): [string, string[]] {
	if (!text.startsWith("+++")) return [text, []];
	const rest = text.slice(3);
	const end = rest.indexOf("\n+++");
	if (end === -1) return [text, []];
	const front = rest.slice(0, end), after = rest.slice(end);
	const newline = front.includes("\r\n") ? "\r\n" : "\n";
	const all = lines(front);
	const changes: string[] = [];
	const top: string[] = [], tables: string[] = [], tags: string[] = [];
	let table = "";
	for (let i = 0; i < all.length; i++) {
		const line = all[i];
		const trimmed = trim(line);
		if (trimmed.startsWith("[") && !trimmed.startsWith("[[") && trimmed.endsWith("]")) {
			table = trim(trimMatches(trimmed, "[]"));
			tables.push(line);
		} else if (table === "taxonomies" && trimmed.startsWith("tags") && trimStart(trimmed.slice(4)).startsWith("=")) {
			// The array can run over several lines.
			let value = line;
			while (occurrences(value, "[") > occurrences(value, "]") && i + 1 < all.length) {
				i++;
				value += newline + all[i];
			}
			tags.push(trimStart(value));
		} else if (table === "" && trimmed.startsWith("path") && trimStart(trimmed.slice(4)).startsWith("=")) {
			const value = trim(trimStart(trimmed.slice(4)).replace(/^=+/, ""));
			const quote = value[0] === "\"" || value[0] === "'" ? value[0] : undefined;
			const close = quote === undefined ? -1 : value.indexOf(quote, 1);
			if (close !== -1) {
				top.push(`permalink = "/${trimMatches(value.slice(1, close), "/")}/"`);
				changes.push("path -> permalink");
			} else {
				top.push(line);
			}
		} else if (table === "") {
			top.push(line);
		} else {
			tables.push(line);
		}
	}
	if (!tags.length && !changes.length) return [text, []];
	if (tags.length) {
		changes.push("[taxonomies] tags -> tags");
		// Above the tables, after the last line that isn't blank.
		let at = 0;
		for (let k = top.length - 1; k >= 0; k--) {
			if (trim(top[k]) !== "") { at = k + 1; break; }
		}
		top.splice(at, 0, ...tags);
		// A `[taxonomies]` table with nothing left in it goes too.
		const header = tables.findIndex((l) => trim(l) === "[taxonomies]");
		if (header !== -1) {
			let next = tables.findIndex((l, k) => k > header && trim(l).startsWith("["));
			if (next === -1) next = tables.length;
			if (tables.slice(header + 1, next).every((l) => trim(l) === "")) {
				tables.splice(header, next - header);
				while (top.length && trim(top[top.length - 1]) === "" && !tables.length) top.pop();
			}
		}
	}
	// `front` began with the line break after the opening `+++`.
	const body = [...top, ...tables].join(newline);
	return [`+++${newline}${body.startsWith(newline) ? body.slice(newline.length) : body}${after}`, changes];
}

/** A TOML value as 0.7 wrote it into JSON: a table's keys in order (its tables were sorted maps). */
function sortedKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortedKeys);
	if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareText(a, b)).map(([k, v]) => [k, sortedKeys(v)]));
	return value;
}

/**
 * A TOML error as 0.7's TOML library wrote it: where, the line with a caret under the spot, and
 * what's wrong (in smol-toml's words), then a line break.
 */
export function tomlError(e: unknown, text: string): string {
	if (!(e instanceof TomlError)) return tomlReason(e);
	const what = e.message.split("\n")[0].replace(/^Invalid TOML document: /, "");
	const gutter = " ".repeat(String(e.line).length + 1);
	const content = text.split("\n")[e.line - 1] ?? "";
	return `TOML parse error at line ${e.line}, column ${e.column}\n${gutter}|\n${e.line} | ${content}\n${gutter}|${" ".repeat(e.column)}^\n${what}\n`;
}

/** The plan for the Zola site in `dir`. */
// ---- Jekyll ---------------------------------------------------------------------------------

/** What Jekyll leaves out by itself (its `exclude` defaults), beside what `_config.yml` lists. */
const JEKYLL_EXCLUDES = [".sass-cache", ".jekyll-cache", "gemfiles", "Gemfile", "Gemfile.lock", "node_modules", "vendor/bundle", "vendor/cache", "vendor/gems", "vendor/ruby"];

/** `page.<key>` that's the page's own in ssqch too (its facts, not its front matter): left as it is. */
const PAGE_KEYS = new Set(["url", "date", "excerpt", "inputPath", "outputPath", "fileSlug", "filePathStem", "headings", "lastModified"]);

/** `page.<key>` Jekyll fills in itself, which ssqch's `page` doesn't have: what each is in ssqch. */
const JEKYLL_PAGE: Record<string, string> = {
	content: "`content`, in a layout",
	path: "`page.inputPath` (with `./` in front)",
	name: "`page.fileSlug` (without the extension)",
	dir: "the folder of `page.url`",
	id: "`page.url`",
	collection: "the tag the collection is made from",
	next: "`navPager(collections.posts, page.url).next`",
	previous: "`navPager(collections.posts, page.url).previous`",
	categories: "`categories` front matter, or the folders above `_posts`",
};

/** Liquid's tags, Jekyll's and ssqch's, which a `{% name %}` isn't a plugin's tag for. */
const LIQUID_TAGS = new Set(["assign", "capture", "endcapture", "case", "when", "endcase", "comment", "endcomment", "cycle", "decrement", "increment", "echo", "for", "endfor", "break", "continue", "if", "elsif", "else", "endif", "unless", "endunless", "include", "include_relative", "render", "layout", "liquid", "raw", "endraw", "tablerow", "endtablerow", "highlight", "endhighlight", "link", "post_url", "block", "endblock"]);

/** The Jekyll plugins a site can name, and what each is in ssqch: an import and a plugin, or what to do. */
const JEKYLL_PLUGINS: Record<string, { use?: [string, string]; say: string }> = {
	"jekyll-sitemap": { use: ["import { sitemapPlugin } from \"ssqch/sitemap\";", "sitemapPlugin({ url: site.url })"], say: "`sitemapPlugin({ url: site.url })`, in the draft (an empty `url` writes paths, as jekyll-sitemap did, and warns)" },
	"jekyll-redirect-from": { use: ["import { redirectsPlugin } from \"ssqch/redirects\";", "redirectsPlugin()"], say: "`redirectsPlugin()`, in the draft: `redirect_from` works as it is; `_includes/hooks/redirect.*` is its page's markup" },
	"jekyll-feed": { use: ["import { rssPlugin } from \"ssqch/rss\";", "rssPlugin()"], say: "`rssPlugin()` is in the draft; the feed itself is a template of the site's (`feed.xml.liquid` with `permalink: /feed.xml`): `ssqch docs rssPlugin`" },
	"jekyll-seo-tag": { say: "`{% seo %}` becomes an include: `ssqch docs \"From jekyll-seo-tag\"` has one that writes its tags" },
	"jekyll-github-metadata": { say: "`site.github` isn't there: put what the templates read (`site.github.repository_nwo`, `site.github.url`) in the config's `data`" },
	"jekyll-paginate": { say: "`paginate` and `paginator` become `pagination: { data: \"collections.posts\", size: N }` in the listing page's front matter, and `pagination.items`" },
	"jekyll-toc": { say: "`toc(page.headings, { class: \"section-nav\" })` writes jekyll-toc's markup (`ssqch docs toc`)" },
	"jekyll-relative-links": { say: "ssqch leaves `[x](other.md)` as it's written: link to the page's URL" },
	"jekyll-optional-front-matter": { say: "a Markdown file without front matter is a page in ssqch too" },
	"jekyll-titles-from-headings": { say: "a page's `title` comes from its front matter only: add `title` to the pages that had theirs from the first heading" },
	"jekyll-default-layout": { say: "set `layout` in directory data, or in the config's `data`, for pages that had the default one" },
	"jekyll-readme-index": { say: "a `README.md` is a page in ssqch too; give it `permalink: /` to make it the index, or ignore it" },
	"jekyll-gist": { say: "`{% gist %}` becomes a function in `filters` (`{% gist \"id\" %}` calls it) that writes the `<script>`" },
	"jekyll-mentions": { say: "`@name` stays text: a transform of your own, or links in the source" },
	"jekyll-avatar": { say: "`{% avatar %}` becomes a function in `filters` that writes the `<img>`" },
};

/** jekyll-seo-tag's tags as an include (the one `ssqch docs "From jekyll-seo-tag"` shows; a test keeps them the same). */
export const SEO_INCLUDE = "{%- comment -%} _includes/seo.liquid {%- endcomment -%}\n{%- assign site_title = site.title | default: site.name | markdownify | strip_html | normalize_whitespace | escape_once -%}\n{%- assign page_title = title | markdownify | strip_html | normalize_whitespace | escape_once | default: site_title -%}\n{%- assign about = description | default: site.description | markdownify | strip_html | normalize_whitespace | escape_once -%}\n{%- if page_title != site_title -%}{%- assign full_title = page_title | append: \" | \" | append: site_title -%}{%- elsif site.description -%}{%- assign full_title = site_title | append: \" | \" | append: about -%}{%- else -%}{%- assign full_title = site_title -%}{%- endif -%}\n{%- assign canonical = site.url | append: page.url -%}\n<!-- Begin Jekyll SEO tag v2.8.0 -->\n<title>{{ full_title }}</title>\n<meta property=\"og:title\" content=\"{{ page_title }}\" />\n<meta property=\"og:locale\" content=\"{{ lang | default: site.lang | default: \"en_US\" | replace: \"-\", \"_\" }}\" />\n{% if about %}<meta name=\"description\" content=\"{{ about }}\" />\n<meta property=\"og:description\" content=\"{{ about }}\" />\n{% endif %}{% if site.url %}<link rel=\"canonical\" href=\"{{ canonical }}\" />\n<meta property=\"og:url\" content=\"{{ canonical }}\" />\n{% endif %}<meta property=\"og:site_name\" content=\"{{ site_title }}\" />\n{% if image %}<meta property=\"og:image\" content=\"{{ site.url | append: image }}\" />\n{% endif %}<meta property=\"og:type\" content=\"website\" />\n<meta name=\"twitter:card\" content=\"{% if image %}summary_large_image{% else %}summary{% endif %}\" />\n{% if image %}<meta property=\"twitter:image\" content=\"{{ site.url | append: image }}\" />\n{% endif %}<meta property=\"twitter:title\" content=\"{{ page_title }}\" />\n<!-- End Jekyll SEO tag -->\n";

/** github-pages' gem turns these on by itself. */
const GITHUB_PAGES_PLUGINS = ["jekyll-github-metadata", "jekyll-relative-links", "jekyll-optional-front-matter", "jekyll-titles-from-headings", "jekyll-default-layout", "jekyll-readme-index"];

/**
 * A Jekyll permalink style or pattern, as an ssqch permalink (Liquid, for the folder's directory
 * data), or undefined for a placeholder it can't write.
 */
export function jekyllPermalink(pattern: string, folder: string): string | undefined {
	const styles: Record<string, string> = {
		date: "/:categories/:year/:month/:day/:title:output_ext",
		pretty: "/:categories/:year/:month/:day/:title/",
		ordinal: "/:categories/:year/:y_day/:title:output_ext",
		none: "/:categories/:title:output_ext",
	};
	const p = styles[pattern] ?? pattern;
	const strip = folder === "" ? "" : ` | remove_first: '/${folder}'`;
	const parts: Record<string, string> = {
		":year": "{{ page.date | date: '%Y' }}",
		":month": "{{ page.date | date: '%m' }}",
		":day": "{{ page.date | date: '%d' }}",
		":i_month": "{{ page.date | date: '%-m' }}",
		":i_day": "{{ page.date | date: '%-d' }}",
		":short_year": "{{ page.date | date: '%y' }}",
		":y_day": "{{ page.date | date: '%j' }}",
		":title": "{{ page.fileSlug }}",
		":name": "{{ page.fileSlug }}",
		":slug": "{{ page.fileSlug }}",
		":path": `{{ page.filePathStem${strip} }}`,
		":collection": folder.replace(/^_/, ""),
		":output_ext": ".html",
		":categories": "{% if categories %}/{{ categories | join: '/' | downcase }}{% endif %}",
	};
	let unknown = false;
	const out = p.replace(/:[a-z_]+/g, (m) => {
		if (Object.hasOwn(parts, m)) return parts[m];
		unknown = true;
		return m;
	});
	if (unknown) return undefined;
	// `:path` is `filePathStem`, which starts with its own `/` (opensource.guide's URLs came out
	// `//ar/metrics/`).
	const stem = "{{ page.filePathStem";
	let joined = out;
	while (joined.includes(`/${stem}`)) joined = joined.replace(`/${stem}`, stem);
	// `/:categories` writes its own `/`, and nothing when there are none.
	return joined.replace(/^\/(\{% if categories %\})/, "$1").replace(/\/\.html$/, "/index.html");
}

/** A template's `page.<key>` renamed to `<key>` where it's the page's front matter, and what's left that ssqch's `page` doesn't have. */
/** What a collection item has itself in ssqch (beside `data`); any other key a Jekyll template reads on one is front matter, under `data`. */
const ITEM_KEYS = new Set(["url", "date", "page", "data", "templateContent", "inputPath", "outputPath", "fileSlug", "filePathStem"]);

export function rewriteJekyllTemplate(text: string, collections: readonly string[] = [], dataNames: readonly string[] = []): [string, string[], string[]] {
	const changes: string[] = [];
	const left: string[] = [];
	// A key the template also uses as its own variable can't be renamed: `{% assign lang = page.lang %}`.
	const own = new Set([...text.matchAll(/\{%-?\s*(?:assign|capture|for|increment|decrement)\s+([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
	const renamed = new Map<string, number>();
	const kept = new Map<string, number>();
	// `{{ page.path }}` (an "edit this page" link) is the input path without its `./`.
	let paths = 0;
	let out = text.replace(/\{\{(-?)\s*page\.path\s*(?=-?\}\}|\|)/g, (_, dash: string) => {
		paths++;
		return `{{${dash} page.inputPath | remove_first: "./" `;
	});
	if (paths) changes.push(`page.path -> page.inputPath | remove_first: "./"${paths > 1 ? ` (${paths})` : ""}`);
	// A variable of the template's own with the name a front matter key or a data name will have
	// (`{% assign lang = ... %}` beside `page.lang`, `{% assign locales = site.data.locales | sort %}`):
	// Liquid's `assign` is global, so it would replace the page's value for every include after it.
	// The template's own gets another name, `my_lang`, in every tag of this file.
	const renameOwn = (name: string, why: string) => {
		const mine = `my_${name}`;
		out = out.replace(/(\{\{[^}]*?\}\}|\{%[^%]*?%\})/g, (code) => code.replace(new RegExp(`(?<![\\w.'"-])${name}(?![\\w'"-]|\\s*:)`, "g"), mine));
		own.delete(name);
		changes.push(`${name} (the template's own variable) -> ${mine}`);
		left.push(`\`${name}\`, the template's own variable, is \`${mine}\` now (${why}): check the includes that read it without assigning it`);
	};
	for (const name of [...own].sort(compareText)) {
		if (PAGE_KEYS.has(name) || Object.hasOwn(JEKYLL_PAGE, name)) continue;
		if (new RegExp(`(?<![\\w.])page\\.${name}\\b`).test(out)) renameOwn(name, `\`page.${name}\` is \`${name}\``);
		else if (dataNames.includes(name) && new RegExp(`(?<![\\w.])site\\.data\\.${name}\\b`).test(out)) renameOwn(name, `\`site.data.${name}\` is \`${name}\``);
	}
	out = out.replace(/(\{\{[^}]*?\}\}|\{%[^%]*?%\})/g, (code) => code.replace(/(?<![\w.])page\.([A-Za-z_][\w-]*)/g, (whole, key: string) => {
		if (PAGE_KEYS.has(key)) return whole;
		if (Object.hasOwn(JEKYLL_PAGE, key)) {
			kept.set(key, (kept.get(key) ?? 0) + 1);
			return whole;
		}
		renamed.set(key, (renamed.get(key) ?? 0) + 1);
		return key;
	}));
	const inTags = (fn: (code: string) => string) => { out = out.replace(/(\{\{[^}]*?\}\}|\{%[^%]*?%\})/g, fn); };
	// `site.posts`, `site.<collection>` and `site.data.<name>`: collections and global data in ssqch.
	const lists = ["posts", ...collections.filter((c) => c !== "posts")];
	const listWord = new RegExp(`(?<![\\w.])site\\.(${lists.join("|")})\\b`, "g");
	inTags((code) => code.replace(listWord, (_, name: string) => {
		renamed.set(`site.${name}`, (renamed.get(`site.${name}`) ?? 0) + 1);
		return `collections.${name}`;
	}).replace(/(?<![\w.])site\.data\.(?=[A-Za-z_])/g, () => {
		renamed.set("site.data.", (renamed.get("site.data.") ?? 0) + 1);
		return "";
	}));
	// What's read from a collection's items: front matter is under `data` in ssqch, `content` is
	// `templateContent` and `excerpt` is `page.excerpt`. The items are the loop variables over a
	// collection, or over a variable assigned from one (`{% assign guides = collections.articles |
	// where: "lang", page.lang %}`), and what `first` and `last` take from them.
	const fromList = new RegExp(`collections\\.(?:${lists.join("|")})\\b`);
	const listVars = new Set<string>();
	for (const m of out.matchAll(/\{%-?\s*assign\s+([A-Za-z_][\w-]*)\s*=\s*([^%]*?)-?%\}/g)) if (fromList.test(m[2]) && !/\|\s*(?:first|last|size)\b/.test(m[2])) listVars.add(m[1]);
	const isList = (expr: string) => fromList.test(expr) || [...listVars].some((v) => new RegExp(`^\\s*${v}\\b`).test(expr));
	const items = new Set<string>();
	for (const m of out.matchAll(/\{%-?\s*for\s+([A-Za-z_][\w-]*)\s+in\s+([^%]*?)-?%\}/g)) if (isList(m[2])) items.add(m[1]);
	for (const m of out.matchAll(/\{%-?\s*assign\s+([A-Za-z_][\w-]*)\s*=\s*([^%]*?)-?%\}/g)) if (isList(m[2]) && /\|\s*(?:first|last)\b/.test(m[2])) items.add(m[1]);
	let fields = 0;
	if (items.size) {
		const item = new RegExp(`(?<![\\w.])(${[...items].join("|")})\\.([A-Za-z_][\\w-]*)`, "g");
		inTags((code) => code.replace(item, (whole, v: string, key: string) => {
			if (ITEM_KEYS.has(key)) return whole;
			fields++;
			return key === "content" ? `${v}.templateContent` : key === "excerpt" ? `${v}.page.excerpt` : `${v}.data.${key}`;
		}));
	}
	// A filter's property on a list of them is front matter too: `where: "lang"` is `where: "data.lang"`.
	const props = /(\|\s*(?:where|sort|sort_natural|group_by|map|find|reject)\s*:\s*)(["'])([A-Za-z_][\w-]*)\2/g;
	inTags((code) => {
		const body = code.replace(/^\{[{%]-?\s*(?:assign\s+[\w-]+\s*=|for\s+[\w-]+\s+in)?/, "");
		if (!isList(body)) return code;
		return code.replace(props, (whole, filter: string, q: string, key: string) => {
			if (ITEM_KEYS.has(key)) return whole;
			fields++;
			return `${filter}${q}data.${key}${q}`;
		});
	});
	for (const [key, n] of renamed) changes.push(key.startsWith("site.") && key !== "site.data." ? `${key} -> collections.${key.slice(5)}` : key === "site.data." ? "site.data.<name> -> <name>" : `page.${key} -> ${key}${n > 1 ? ` (${n})` : ""}`);
	if (fields) changes.push(`${fields} ${fields === 1 ? "field" : "fields"} of collection items -> under \`data\` (\`post.title\` -> \`post.data.title\`, \`content\` -> \`templateContent\`)`);
	for (const [key, n] of kept) left.push(`\`page.${key}\` (${n}): ${JEKYLL_PAGE[key]}`);
	return [out, changes, [...new Set(left)]];
}

export function jekyll(dir: string): Plan {
	const configFile = ["_config.yml", "_config.yaml", "_config.toml"].find((f) => isFile(path.join(dir, f)));
	if (configFile === undefined) fail(`there's no _config.yml in ${dir}: is this the Jekyll site's folder?`);
	const configText = readStrict(path.join(dir, configFile!));
	let config: Data = {};
	try { config = configFile!.endsWith(".toml") ? (readToml(configText) as Data) : parseYaml(configText); } catch (e) { fail(`${configFile}: ${e instanceof Error ? e.message : String(e)}`); }
	const plan: Plan = { from: "Jekyll", renames: [], edits: [], newFiles: [], byHand: [] };
	const list = (key: string) => (Array.isArray(config[key]) ? (config[key] as unknown[]).filter((v): v is string => typeof v === "string") : []);
	const layoutsDir = typeof config.layouts_dir === "string" ? config.layouts_dir : "_layouts";
	const includesDir = typeof config.includes_dir === "string" ? config.includes_dir : "_includes";
	const dataDir = typeof config.data_dir === "string" ? config.data_dir : "_data";
	const output = typeof config.destination === "string" ? config.destination.replace(/^\.\//, "") : "_site";
	const collections = isPlainObject(config.collections) ? config.collections : Array.isArray(config.collections) ? Object.fromEntries((config.collections as unknown[]).map((c) => [String(c), {}])) : {};
	const collectionsDir = typeof config.collections_dir === "string" ? config.collections_dir.replace(/\/$/, "") : "";
	const excluded = [...JEKYLL_EXCLUDES, ...list("exclude")];
	const included = new Set(list("include"));
	const isExcluded = (rel: string) => excluded.some((e) => {
		const glob = e.replace(/^\.\//, "").replace(/\/$/, "");
		return rel === glob || rel.startsWith(`${glob}/`) || (glob.includes("*") && new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`).test(rel));
	});
	// Jekyll reads `_`-folders it knows, and skips the rest (and dot files) unless `include` names them.
	const special = new Set([layoutsDir, includesDir, dataDir, "_posts", "_drafts", "_sass", ...Object.keys(collections).map((c) => (collectionsDir ? `${collectionsDir}/_${c}` : `_${c}`))]);
	const entries = walk(dir, (name, rel) => rel === output || name === ".git" || name === "node_modules" || name === ".cache" || isExcluded(rel) || ((name.startsWith(".") || name.startsWith("_")) && !included.has(name) && !special.has(rel) && !(collectionsDir && rel === collectionsDir)), true);

	// Templates: `page.<key>` renamed, the tags no one defines counted, and kramdown's habits.
	// The collections (`site.articles`) and the data's names (`site.data.locales`), which templates
	// read under other names in ssqch.
	const collectionList = Object.keys(collections);
	let dataNames: string[] = [];
	try { dataNames = [...new Set(fs.readdirSync(path.join(dir, ...dataDir.split("/"))).map((n) => n.replace(/\.(?:ya?ml|json|csv|toml|tsv)$/, "")).filter((n) => /^[A-Za-z_][\w-]*$/.test(n)))]; } catch { /* no data folder */ }
	const tags = new Map<string, [number, string]>();
	let markdownAttr = 0, ial = 0, seo = 0;
	const hasFrontMatter = (text: string) => /^---\s*\r?\n/.test(text);
	const statics: string[] = [];
	const frontMatterOther: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile) continue;
		const ext = asciiLower(extensionOf(entry.name));
		const text = readUtf8(entry.abs);
		const templateDir = entry.rel.startsWith(`${layoutsDir}/`) || entry.rel.startsWith(`${includesDir}/`);
		const front = text !== undefined && hasFrontMatter(text);
		if (!templateDir && !entry.rel.startsWith(`${dataDir}/`) && !entry.rel.startsWith("_sass/") && !front) {
			// Jekyll copies a file without front matter as it is; ssqch renders `.md` and `.html`.
			if (!["md", "markdown"].includes(ext)) statics.push(entry.rel);
			continue;
		}
		if (text === undefined) continue;
		if (front && !["md", "markdown", "html", "liquid", "xml", "txt", "json", "scss", "sass", "css"].includes(ext)) frontMatterOther.push(entry.rel);
		if (!(templateDir || front) || ["scss", "sass"].includes(ext)) continue;
		let [next, changes, left] = rewriteJekyllTemplate(text, collectionList, dataNames);
		// `{% seo %}` is jekyll-seo-tag's: the include written below.
		if (/\{%-?\s*seo\b[^%]*%\}/.test(next)) {
			next = next.replace(/\{%(-?)\s*seo\b[^%]*?(-?)%\}/g, "{%$1 include seo.liquid $2%}");
			changes = [...changes, "{% seo %} -> {% include seo.liquid %}"];
		}
		if (changes.length) plan.edits.push([entry.rel, changes, next]);
		for (const what of left) plan.byHand.push([entry.rel, what]);
		for (const m of text.matchAll(/\{%-?\s*([a-z_][\w-]*)/g)) {
			const name = m[1];
			if (LIQUID_TAGS.has(name) || name.startsWith("end")) continue;
			if (name === "seo") seo++;
			const had = tags.get(name);
			tags.set(name, had ? [had[0] + 1, had[1]] : [1, `${entry.rel}:${occurrences(text.slice(0, m.index), "\n") + 1}`]);
		}
		if (["md", "markdown"].includes(ext)) {
			markdownAttr += (text.match(/\smarkdown\s*=\s*["']?(?:1|block|span)/g) ?? []).length;
			ial += (text.match(/\{:\s*[.#][^}]*\}/g) ?? []).length;
		}
	}
	if (seo) {
		if (isFile(path.join(dir, includesDir, "seo.liquid"))) plan.byHand.push([`${includesDir}/seo.liquid`, "it's there already, so jekyll-seo-tag's include wasn't written: `{% seo %}` now includes it"]);
		else plan.newFiles.push([`${includesDir}/seo.liquid`, "jekyll-seo-tag's tags, for `{% seo %}`: add the ones your site's options turn on (`ssqch docs \"From jekyll-seo-tag\"`)", SEO_INCLUDE]);
		tags.delete("seo");
	}
	for (const [name, [n, at]] of [...tags].sort(([a], [b]) => compareText(a, b))) {
		plan.byHand.push([at, name === "seo" ? `\`{% seo %}\` (in ${n} ${n === 1 ? "place" : "places"}; this is the first): jekyll-seo-tag's tag becomes an include, \`{% include seo.liquid %}\`: \`ssqch docs "From jekyll-seo-tag"\` has one that writes its tags` : `\`{% ${name} %}\` (in ${n} ${n === 1 ? "place" : "places"}; this is the first) is a plugin's tag: a function in \`filters\` is a Liquid tag too (\`{% ${name} x %}\` calls \`${name}(x)\`), or an include`]);
	}
	if (ial) plan.byHand.push([".", `${ial} kramdown attribute lists (\`{: .class}\`): ssqch's Markdown doesn't read them, so they print as text. A \`{.class}\` on a heading works (\`## Title {#id .class}\`); for the others, HTML, or a container (\`::: name\`)`]);
	if (markdownAttr) plan.byHand.push([".", `${markdownAttr} \`markdown="1"\` elements: \`htmlMarkdown: "kramdown"\` (in the draft) reads them as kramdown does`]);
	for (const rel of frontMatterOther) plan.byHand.push([rel, "has front matter, so Jekyll renders it: in ssqch that's an engine for its extension (`engines: { js: (s) => s }`, the extension in `templateFormats`, and `\"render\": \"liquid,js\"` in its folder's directory data): `ssqch docs \"Text files with front matter\"`"]);

	// Collections and posts: directory data with the tag, the layout `defaults` gave, and the permalink.
	const defaults = Array.isArray(config.defaults) ? (config.defaults as unknown[]).filter(isPlainObject) : [];
	const defaultsFor = (folder: string, type: string) => {
		const values: Data = {};
		for (const d of defaults) {
			const scope = isPlainObject(d.scope) ? d.scope : {};
			const scopePath = typeof scope.path === "string" ? scope.path.replace(/^\.\//, "").replace(/\/$/, "") : "";
			if ((scopePath === "" || scopePath === folder) && (scope.type === undefined || scope.type === type) && isPlainObject(d.values)) Object.assign(values, d.values);
		}
		return values;
	};
	// `defaults` for every page: global data, below what a page and its folder set.
	const everyPage: Data = {};
	const collectionNames: string[] = [];
	const directoryData = (folder: string, data: Data, from: string) => {
		const name = `${folder}/${folder.split("/").pop()!}.json`;
		if (isFile(path.join(dir, ...name.split("/")))) return plan.byHand.push([name, `it's there already, so ${from} wasn't written into it: ${JSON.stringify(data)}`]);
		plan.newFiles.push([name, from, `${JSON.stringify(data, null, 2)}\n`]);
	};
	if (isDir(path.join(dir, "_posts"))) {
		const permalink = jekyllPermalink(typeof config.permalink === "string" ? config.permalink : "date", "");
		const data: Data = { tags: "posts", ...defaultsFor("_posts", "posts") };
		if (permalink) data.permalink = permalink;
		else plan.byHand.push([configFile!, `permalink: ${String(config.permalink)}: a placeholder ssqch can't write; give _posts/posts.json a \`permalink\` of your own`]);
		directoryData("_posts", data, `Jekyll's posts: the \`posts\` tag${permalink ? ", and the permalink" : ""}`);
		collectionNames.push("posts");
	}
	if (isDir(path.join(dir, "_drafts"))) plan.byHand.push(["_drafts", "drafts: move them to `_posts` with `draft: true`, which `ssqch serve` builds and production builds leave out"]);
	for (const [name, settings] of Object.entries(collections)) {
		if (name === "posts") continue;
		const folder = collectionsDir ? `${collectionsDir}/_${name}` : `_${name}`;
		if (!isDir(path.join(dir, ...folder.split("/")))) continue;
		const s = isPlainObject(settings) ? settings : {};
		const data: Data = { tags: name, ...defaultsFor(folder, name) };
		if (s.output === true) {
			const permalink = jekyllPermalink(typeof s.permalink === "string" ? s.permalink : "/:collection/:path/", folder);
			if (permalink) data.permalink = permalink;
			else plan.byHand.push([folder, `permalink: ${String(s.permalink)}: a placeholder ssqch can't write; give the folder's directory data a \`permalink\` of your own`]);
		} else data.permalink = false;
		directoryData(folder, data, `the \`${name}\` collection: its tag${s.output === true ? " and permalink" : ", and no pages (`output` isn't true)"}`);
		collectionNames.push(name);
	}
	// `defaults` for other folders: directory data there too.
	for (const d of defaults) {
		const scope = isPlainObject(d.scope) ? d.scope : {};
		const folder = typeof scope.path === "string" ? scope.path.replace(/^\.\//, "").replace(/\/$/, "") : "";
		if (!isPlainObject(d.values)) continue;
		if (folder === "" && scope.type === undefined) Object.assign(everyPage, d.values);
		else if (folder === "") { if (scope.type !== "posts" && !Object.hasOwn(collections, String(scope.type))) plan.byHand.push([configFile!, `defaults for \`type: ${String(scope.type)}\`: directory data in the folders those pages are in`]); }
		else if (!folder.includes("*") && folder !== "_posts" && !collectionNames.some((c) => folder === `_${c}` || folder === `${collectionsDir}/_${c}`) && isDir(path.join(dir, ...folder.split("/")))) directoryData(folder, { ...d.values }, `\`defaults\` for ${folder}`);
		else if (folder.includes("*")) plan.byHand.push([configFile!, `defaults for \`${folder}\`: directory data in each folder it matches`]);
	}

	// Files git doesn't track (notes, a scratch folder) aren't the site's: a fresh checkout doesn't
	// have them (the fresh opensource.guide move's notes went into `passthrough`).
	const tracked = spawnSync("git", ["-C", dir, "ls-files", "-z", "--others", "--exclude-standard"], { encoding: "utf8" });
	const untracked = tracked.status === 0 ? new Set(tracked.stdout.split("\0").filter(Boolean)) : new Set<string>();
	const left = statics.filter((rel) => untracked.has(rel));
	if (left.length) {
		for (const rel of left) statics.splice(statics.indexOf(rel), 1);
		const folders = [...new Set(left.map((rel) => (rel.includes("/") ? `${rel.slice(0, rel.indexOf("/"))}/` : rel)))].sort(compareText);
		plan.byHand.push([folders[0], `${left.length} ${left.length === 1 ? "file" : "files"} git doesn't track (${folders.slice(0, 4).join(", ")}${folders.length > 4 ? ", ..." : ""}) left out of \`passthrough\`: Jekyll copied ${left.length === 1 ? "it" : "them"} from this folder, a fresh checkout wouldn't have ${left.length === 1 ? "it" : "them"}. Add ${left.length === 1 ? "it" : "them"} to git if ${left.length === 1 ? "it's" : "they're"} the site's`]);
	}
	// What Jekyll copies as it is: the folders with no front matter in them, and the other files.
	const passthrough: string[] = [];
	const front = new Set(entries.filter((e) => e.isFile && !statics.includes(e.rel) && !untracked.has(e.rel)).map((e) => e.rel));
	const topLevel = new Map<string, string[]>();
	for (const rel of statics) {
		const top = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
		if (top.startsWith("_")) continue;
		topLevel.set(top, [...(topLevel.get(top) ?? []), rel]);
	}
	for (const [top, files] of [...topLevel].sort(([a], [b]) => compareText(a, b))) {
		const whole = top !== "" && ![...front].some((f) => f.startsWith(`${top}/`));
		if (whole) passthrough.push(top);
		else {
			// A folder with templates in it: its subfolders without any, and its other files.
			const sub = new Map<string, string[]>();
			for (const f of files) {
				const rest = top === "" ? f : f.slice(top.length + 1);
				const key = rest.includes("/") ? `${top === "" ? "" : `${top}/`}${rest.slice(0, rest.indexOf("/"))}` : f;
				sub.set(key, [...(sub.get(key) ?? []), f]);
			}
			for (const [key] of [...sub].sort(([a], [b]) => compareText(a, b))) {
				if (key.includes("/") && !isFile(path.join(dir, ...key.split("/"))) && [...front].some((f) => f.startsWith(`${key}/`))) for (const f of sub.get(key)!) passthrough.push(f);
				else passthrough.push(key);
			}
		}
	}
	// A folder is everything in it; a file or a glob is as it's written.
	const ignores = [...new Set([...list("exclude").map((e) => {
		const rel = e.replace(/^\.\//, "").replace(/\/$/, "");
		return !rel.includes("*") && isDir(path.join(dir, ...rel.split("/"))) ? `${rel}/**` : rel;
	}), "Gemfile", "Gemfile.lock"])];

	// Plugins: the config's `plugins` (or `gems`), the Gemfile's, and github-pages' own.
	const gemfile = readUtf8(path.join(dir, "Gemfile")) ?? "";
	const named = new Set([...list("plugins"), ...list("gems"), ...[...gemfile.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1])]);
	if (named.has("github-pages")) for (const p of GITHUB_PAGES_PLUGINS) named.add(p);
	const imports = ["import { defineConfig, readData } from \"ssqch\";"];
	const plugins: string[] = [];
	for (const name of [...named].sort(compareText)) {
		const known = JEKYLL_PLUGINS[name];
		if (!known) {
			if (name.startsWith("jekyll-") || name.startsWith("jekyll_")) plan.byHand.push(["Gemfile", `${name}: a plugin ssqch has no word for; what it adds to the output is a filter, a transform or a template of the site's`]);
			continue;
		}
		if (known.use) {
			imports.push(known.use[0]);
			plugins.push(known.use[1]);
		}
		if (name !== "jekyll-seo-tag" || seo === 0) plan.byHand.push(["Gemfile", `${name} -> ${known.say}`]);
	}
	if (named.has("github-pages")) plan.byHand.push(["Gemfile", "github-pages' default theme (jekyll-theme-primer) writes `/assets/css/style.css`: nothing in ssqch, so check whether a page links to it"]);
	const sass = isDir(path.join(dir, "_sass")) || entries.some((e) => e.isFile && /\.s[ac]ss$/.test(e.name) && front.has(e.rel));
	if (sass) {
		imports.push("import { sassPlugin } from \"ssqch/sass\";");
		const sources = entries.filter((e) => e.isFile && /\.s[ac]ss$/.test(e.name) && front.has(e.rel) && !e.rel.startsWith("_"));
		const files = sources.map((e) => `"${e.rel}": "/${e.rel.replace(/\.s[ac]ss$/, ".css")}"`);
		const loadPaths = isPlainObject(config.sass) && Array.isArray(config.sass.load_paths) ? (config.sass.load_paths as unknown[]).map(String) : isDir(path.join(dir, "_sass")) ? ["_sass"] : [];
		plugins.push(`sassPlugin({ files: { ${files.join(", ")} }${loadPaths.length ? `, loadPaths: ${JSON.stringify(loadPaths)}` : ""}, charset: false })`);
	}

	const markdown = ["htmlMarkdown: \"kramdown\"", "headingIds: \"kramdown\"", "smartPunctuation: true", "autolinks: false"];
	const kramdown = isPlainObject(config.kramdown) ? config.kramdown : {};
	if (kramdown.auto_ids === false) markdown[1] = "headingIds: false";
	if (kramdown.smart_quotes !== undefined || kramdown.input === "GFM" && kramdown.hard_wrap === true) plan.byHand.push([configFile!, "kramdown's `smart_quotes` or `hard_wrap`: check the draft's `markdown` against them (`breaks: true` for `hard_wrap`)"]);
	if (typeof config.markdown === "string" && !/kramdown/i.test(config.markdown)) plan.byHand.push([configFile!, `markdown: ${config.markdown}: the draft's options are kramdown's; ssqch's Markdown is CommonMark with extensions (\`ssqch docs markdown\`)`]);
	let out = `// A first draft, written by \`ssqch import jekyll\` from ${configFile}.\n// \`ssqch docs --from jekyll\` has the whole mapping.\n${[...new Set(imports)].join("\n")}\n\n`;
	out += `// \`site.title\` and every other key of ${configFile} in templates read this.\nconst site = readData(${JSON.stringify(configFile)});\n\nexport default defineConfig({\n`;
	out += "  // Markdown and HTML pages run through Liquid first, as in Jekyll.\n  templateFormats: [\"liquid\", \"md\", \"html\"],\n  markdownEngine: \"liquid\",\n  htmlEngine: \"liquid\",\n";
	const dirs = [`layouts: ${JSON.stringify(layoutsDir)}`];
	if (includesDir !== "_includes") dirs.push(`includes: ${JSON.stringify(includesDir)}`);
	if (dataDir !== "_data") dirs.push(`data: ${JSON.stringify(dataDir)}`);
	if (output !== "_site") dirs.push(`output: ${JSON.stringify(output)}`);
	out += `  dirs: { ${dirs.join(", ")} },\n`;
	out += "  // Jekyll drops the blank lines after the closing `---`.\n  trimAfterFrontMatter: true,\n";
	out += `  // kramdown's habits: markdown="1", its heading ids, smart quotes, no bare-URL links.\n  markdown: { ${markdown.join(", ")} },\n`;
	out += `  // ${configFile}'s \`exclude\`, and what Jekyll leaves out by itself.\n  ignore: [${ignores.map((g) => JSON.stringify(g)).join(", ")}],\n`;
	if (passthrough.length) out += `  // What Jekyll copied as it is: files without front matter.\n  passthrough: [${passthrough.map((p) => JSON.stringify(p)).join(", ")}],\n`;
	const pageDefaults = Object.entries(everyPage).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`);
	out += pageDefaults.length ? `  // ${configFile}'s \`defaults\` for every page.\n  data: { site, ${pageDefaults.join(", ")} },\n` : "  data: { site },\n";
	out += `  filters: {\n    // Plugins' tags and filters go here: name: (...args) => result\n  },\n  plugins: [${plugins.join(", ")}],\n});\n`;
	if (findConfig(dir) === undefined) plan.newFiles.unshift(["ssqch.config.js", `a first draft, from ${configFile}`, out]);
	else plan.byHand.push(["ssqch.config.js", "it's already there, so the draft from the Jekyll config wasn't written"]);
	if (!isFile(path.join(dir, "package.json"))) plan.byHand.push([".", "no package.json: `npm init -y && npm install -D ssqch` pins the version the site builds with"]);
	if (typeof config.url === "string" && config.url !== "" && !config.url.startsWith("http")) plan.byHand.push([configFile!, `url: ${config.url}: the site's address starts with https://`]);
	return plan;
}

export function zola(dir: string): Plan {
	const configPath = path.join(dir, "config.toml");
	if (!isFile(configPath)) fail(`there's no config.toml in ${dir}: is this the Zola site's folder?`);
	const configText = readStrict(configPath);
	let config: Data = {};
	try { config = readToml(configText) as Data; } catch (e) { fail(`config.toml: ${tomlError(e, configText)}`); }
	const plan: Plan = { from: "Zola", renames: [], edits: [], newFiles: [], byHand: [] };
	const sections: string[] = [];
	const shortcodes = new Set<string>();
	let aliases = false, bundles = false;
	for (const entry of walk(path.join(dir, "content"), () => false, false)) {
		if (!entry.isFile || extensionOf(entry.name) !== "md") continue;
		const rel = `content/${entry.rel}`;
		const text = readUtf8(entry.abs);
		if (text === undefined) continue;
		if (entry.name === "_index.md") {
			sections.push(rel);
			continue;
		}
		if (entry.name === "index.md") {
			let count = 0;
			try { count = fs.readdirSync(path.dirname(entry.abs)).length; } catch { /* not a bundle, as 0.7 read it */ }
			if (count > 1) bundles = true;
		}
		aliases ||= text.includes("\naliases");
		for (const c of text.matchAll(SHORTCODE_CALL)) shortcodes.add(c[1]);
		if (text.startsWith("---") && text.includes("taxonomies:")) plan.byHand.push([rel, "YAML front matter with `taxonomies`: move `tags` to the top level"]);
		const [next, changes] = rewriteZolaFrontMatter(text);
		if (changes.length) plan.edits.push([rel, changes, next]);
	}
	for (const section of sections) {
		let folder = section;
		while (folder.endsWith("/_index.md")) folder = folder.slice(0, -"/_index.md".length);
		const name = folder.split("/").pop();
		plan.byHand.push([section, `a section: its settings (\`sort_by\`, \`paginate_by\`, \`page_template\`) become directory data (${folder}/${name}.json: \`layout\`, \`tags\`, \`permalink\`) and an index page that lists the folder's pages`]);
	}
	for (const name of [...shortcodes].sort(compareText)) {
		const shortcode = (ext: string) => isFile(path.join(dir, "templates", "shortcodes", `${name}.${ext}`));
		if (shortcode("html") || shortcode("md")) plan.byHand.push([`templates/shortcodes/${name}.html`, `a shortcode used in content: make it a config filter (\`filters: { ${name}: ... }\`) or a macro; a body shortcode (\`{% ${name}() %}...{% end %}\`) becomes a \`::: ${name}\` container`]);
	}
	const tera = new Map<string, number>();
	let templateCount = 0;
	for (const entry of walk(path.join(dir, "templates"), () => false, false)) {
		if (!entry.isFile) continue;
		const text = readUtf8(entry.abs);
		if (text === undefined) continue;
		templateCount++;
		const count = (what: string, n: number) => {
			if (n > 0) tera.set(what, (tera.get(what) ?? 0) + n);
		};
		count("Tera functions (get_url, get_section, load_data, resize_image...): filters or data in the config", text.match(TERA_CALLS)?.length ?? 0);
		count("filters with named arguments (`| date(format=\"%Y\")`): positional in ssqch (`| dateformat(\"%Y\")`)", text.match(NAMED_ARGUMENT)?.length ?? 0);
		count("`page.content`, `section.content`: `content` in a layout", occurrences(text, "page.content") + occurrences(text, "section.content"));
		count("`section.pages`, `paginator.pages`: a collection (`collections.<tag>`), and `pagination.items`", occurrences(text, "section.pages") + occurrences(text, "paginator."));
		count("`page.title`, `page.extra`, `page.taxonomies`: front matter is at the top level (`title`, `extra`, `tags`)", occurrences(text, "page.title") + occurrences(text, "page.extra") + occurrences(text, "page.taxonomies"));
		count("`page.permalink`: `page.url`", occurrences(text, "page.permalink") + Math.max(0, occurrences(text, ".permalink") - occurrences(text, "page.permalink")));
	}
	if (templateCount > 0) {
		plan.byHand.push(["templates/", `${templateCount} Tera templates: they run as Jinja (\`htmlEngine: "jinja"\` in the draft config), and these need changing:`]);
		for (const [what, n] of [...tera].sort(([a], [b]) => compareText(a, b))) plan.byHand.push(["templates/", `${n} x ${what}`]);
	}

	const text = (key: string) => (typeof config[key] === "string" ? config[key] as string : undefined);
	const flag = (key: string) => config[key] === true || (isPlainObject(config.markdown) && config.markdown[key] === true);
	const baseUrl = text("base_url") ?? "";
	const site: Data = {};
	for (const key of ["base_url", "title", "description", "default_language"]) {
		const value = text(key);
		if (value !== undefined) site[key] = value;
	}
	if (config.extra !== undefined) site.extra = sortedKeys(config.extra);
	const imports = ["import { defineConfig } from \"ssqch\";", "import { linksPlugin } from \"ssqch/links\";"];
	const plugins: string[] = [];
	if (baseUrl.startsWith("http")) {
		imports.push("import { sitemapPlugin } from \"ssqch/sitemap\";");
		plugins.push(`sitemapPlugin({ url: ${JSON.stringify(baseUrl)} })`);
	}
	if (aliases) {
		imports.push("import { redirectsPlugin } from \"ssqch/redirects\";");
		plugins.push("redirectsPlugin()");
	}
	if (flag("compile_sass") && isDir(path.join(dir, "sass"))) {
		imports.push("import { sassPlugin } from \"ssqch/sass\";");
		plugins.push("sassPlugin({ files: { sass: \"/\" } })");
	}
	plugins.push("linksPlugin()");
	const markdown = ["headingIds: \"ascii\""];
	if (flag("highlight_code")) markdown.push("highlight: true");
	if (flag("smart_punctuation")) markdown.push("smartPunctuation: true");
	let out = `// A first draft, written by \`ssqch import zola\` from config.toml.\n// \`ssqch docs --from zola\` has the whole mapping.\n${imports.join("\n")}\n\nexport default defineConfig({\n`;
	out += `  dirs: { input: "content", output: ${JSON.stringify(text("output_dir") ?? "public")}, includes: "../templates" },\n`;
	out += "  // Tera templates are close to Jinja: Markdown and the .html templates run through it.\n  templateFormats: [\"md\"],\n  markdownEngine: \"jinja\",\n  htmlEngine: \"jinja\",\n";
	if (sections.length) out += "  // Section files: their settings go in directory data (see the list `ssqch import` printed).\n  ignore: [\"**/_index.md\"],\n";
	if (bundles) out += "  // Pages that are a folder (`post/index.md`) keep the files next to them.\n  bundles: true,\n";
	out += `  markdown: { ${markdown.join(", ")} },\n`;
	if (isDir(path.join(dir, "static"))) out += "  passthrough: [{ static: \".\" }],\n";
	out += `  // \`config.title\` and \`config.extra.*\` in templates read this.\n  data: {\n    config: ${JSON.stringify(site, null, 2).replaceAll("\n", "\n    ")},\n  },\n`;
	out += `  filters: {\n    // Port shortcodes and Tera functions here: name: (...args) => result\n  },\n  plugins: [${plugins.join(", ")}],\n});\n`;
	if (config.taxonomies !== undefined) plan.byHand.push(["config.toml", "taxonomies: tags are built in (`collections.<tag>`); tag pages are a template paginated over the tags (the `blog-tags` example), and other taxonomies are custom `collections`"]);
	if (flag("build_search_index")) plan.byHand.push(["config.toml", "build_search_index: Pagefind after the build (`afterBuild: { run: \"npx -y pagefind --site public\" }`)"]);
	if (flag("generate_feeds") || flag("generate_feed")) plan.byHand.push(["config.toml", "generate_feeds: a feed template with `rssPlugin()`'s filters (the `blog-tags` example has one)"]);
	if (findConfig(dir) === undefined) plan.newFiles.push(["ssqch.config.js", "a first draft, from config.toml", out]);
	else plan.byHand.push(["ssqch.config.js", "it's already there, so the draft from config.toml wasn't written"]);
	return plan;
}
