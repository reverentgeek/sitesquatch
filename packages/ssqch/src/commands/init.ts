// `ssqch init`: a starter site. Ported from `crates/ssqch/src/init.rs`; the starters' files are
// in `bundled/starter/` (the site) and `bundled/starter-docs/` (the documentation site).
import fs from "node:fs";
import path from "node:path";
import { bundled, bundledPath, types } from "../bundled.ts";
import { red } from "../diagnostics.ts";
import { CONFIG_FILES } from "../dirs.ts";
import { joinAsGiven, parentAsGiven, slashes } from "../paths.ts";
import { count } from "../report.ts";
import { packageManager } from "../scout.ts";
import { schemaDeclarations } from "./types.ts";

/** The starter site: (path in the new site, file in `bundled/`). It's an amateur investigator's field notes: seven posts that each show one thing. */
const STARTER: Array<[string, string]> = [
	["ssqch.config.js", "starter/ssqch.config.js"],
	["src/_data/site.json", "starter/src/_data/site.json"],
	["src/posts/posts.json", "starter/src/posts/posts.json"],
	["src/posts/i-know-what-i-saw.md", "starter/src/posts/i-know-what-i-saw.md"],
	["src/posts/upon-further-review-a-stump.md", "starter/src/posts/upon-further-review-a-stump.md"],
	["src/posts/the-stump-has-moved.md", "starter/src/posts/the-stump-has-moved.md"],
	["src/posts/raiders-of-the-lost-path.md", "starter/src/posts/raiders-of-the-lost-path.md"],
	["src/posts/the-cache-of-the-wild.md", "starter/src/posts/the-cache-of-the-wild.md"],
	["src/posts/the-stump-has-a-forwarding-address.md", "starter/src/posts/the-stump-has-a-forwarding-address.md"],
	["src/posts/honey-i-shrunk-the-site.md", "starter/src/posts/honey-i-shrunk-the-site.md"],
	["src/404.md", "starter/src/404.md"],
	["src/favicon.svg", "starter/src/favicon.svg"],
	["src/img/stump.jpg", "starter/src/img/stump.jpg"],
	["src/_blueprints/posts.md", "starter/src/_blueprints/posts.md"],
	["ssqch.d.ts", "ssqch.d.ts"],
	["jsconfig.json", "starter/jsconfig.json"],
	[".gitignore", "starter/gitignore"],
];

/** The documentation starter (`ssqch init --starter docs`): a sidebar, a table of contents, previous and next links, notes, tabs, highlighting, a schema and the link checker. */
const DOCS_STARTER: Array<[string, string]> = [
	["ssqch.config.js", "starter-docs/ssqch.config.js"],
	["src/_data/site.json", "starter-docs/src/_data/site.json"],
	["src/_data/nav.yml", "starter-docs/src/_data/nav.yml"],
	["src/assets/docs.css", "starter-docs/src/assets/docs.css"],
	["src/assets/docs.js", "starter-docs/src/assets/docs.js"],
	["src/assets/favicon.svg", "starter-docs/src/assets/favicon.svg"],
	["src/index.md", "starter-docs/src/index.md"],
	["src/404.md", "starter-docs/src/404.md"],
	["src/docs/docs.json", "starter-docs/src/docs/docs.json"],
	["src/docs/index.md", "starter-docs/src/docs/index.md"],
	["src/docs/install.md", "starter-docs/src/docs/install.md"],
	["src/docs/guides/writing.md", "starter-docs/src/docs/guides/writing.md"],
	["src/docs/guides/deploying.md", "starter-docs/src/docs/guides/deploying.md"],
	["src/_blueprints/docs.md", "starter-docs/src/_blueprints/docs.md"],
	["ssqch.d.ts", "ssqch.d.ts"],
	["jsconfig.json", "starter/jsconfig.json"],
	[".gitignore", "starter-docs/gitignore"],
];

/**
 * The docs starter's schemas as `ssqch types` writes them, so its `ssqch.d.ts` has them from the
 * start and the first build has nothing to say about stale types. `init.test.ts` keeps them equal
 * to the starter's config.
 */
export const DOCS_SCHEMAS: Array<[name: string, typescript: string]> = [["docs", "{\n\t\t\ttitle: string;\n\t\t\tdescription?: string;\n\t\t}"]];

/** What `ssqch init --starter` can create. */
export const STARTERS = ["site", "docs"];

/** The template languages `ssqch init --engine` can start a site in. `njk` uses the Jinja templates, which are Nunjucks too. */
export const ENGINES = ["jinja", "njk", "edge", "liquid", "hbs", "ejs"];

/** The engine a starter is in without `--engine`: Jinja, ssqch's default template language. */
export const DEFAULT_ENGINE = "jinja";

/** The engines this build can start a site in, the default first. */
export const starterEngines = (): string[] => [...ENGINES];

/** A starter's templates in one language: (path in the new site without the extension, file in `bundled/`). The Jinja ones are the starters' own; the rest are translations of them. */
const SITE_TEMPLATES: Record<string, Array<[string, string]>> = {
	jinja: ["_includes/layout", "index", "tags", "tag"].map((name) => [`src/${name}`, `starter/src/${name}.jinja`]),
	...Object.fromEntries(["edge", "liquid", "hbs", "ejs"].map((e) => [e, ["layout", "index", "tags", "tag"].map((name) => [`src/${name === "layout" ? "_includes/layout" : name}`, `starter/engines/${name}.${e}`]) as Array<[string, string]>])),
};

/** The documentation starter's templates, in the same order in each language. */
const DOCS_NAMES = ["base", "doc", "hooks/heading", "containers/tabs", "containers/tab", "containers/details"];
const docsTemplates = (dir: string, ext: string): Array<[string, string]> => DOCS_NAMES.map((name) => [`src/_includes/${name}`, `${dir}${name}.${ext}`]);
const DOCS_TEMPLATES: Record<string, Array<[string, string]>> = {
	jinja: docsTemplates("starter-docs/src/_includes/", "jinja"),
	...Object.fromEntries(["edge", "liquid", "hbs", "ejs"].map((e) => [e, docsTemplates(`starter-docs/engines/${e}/`, e)])),
};

/** Replaces the first `from` (which the starter file must contain) with `to`. */
function replaceOnce(contents: string, from: string, to: string): string {
	const at = contents.indexOf(from);
	if (at === -1) throw new Error(`starter file is missing ${JSON.stringify(from)}`);
	return contents.slice(0, at) + to + contents.slice(at + from.length);
}

/** Points a mention of a Jinja template (`layout: base.jinja`) at this language's file. */
const rename = (engine: string, contents: string): string => (engine === "jinja" ? contents : contents.replace(/\b([\w-]+)\.jinja\b/g, (_, name: string) => `${name}.${engine}`));

/** Fits a starter file written for Jinja to this engine. */
function adapt(engine: string, rel: string, contents: string): string {
	if (engine === "jinja") return contents;
	if (rel === "ssqch.config.js") {
		// Markdown runs through the site's language too, as it does through Jinja by default.
		let config = replaceOnce(contents, "templateFormats: [\"jinja\", \"md\"],", `templateFormats: ["${engine}", "md"],\n  markdownEngine: "${engine}",`);
		if (config.includes("{{ readableDate(post.date) }}")) {
			const call = { liquid: "{{ post.date | readableDate }}", hbs: "{{readableDate post.date}}", ejs: "<%= readableDate(post.date) %>" }[engine] ?? "{{ readableDate(post.date) }}";
			config = replaceOnce(config, "{{ readableDate(post.date) }}", call);
		}
		if (engine === "hbs" && config.includes("data: { search },")) {
			// Handlebars has no `replace`, so the docs layout's edit link gets its path from a helper.
			config = replaceOnce(config, "  filters: {\n", "  filters: {\n    // The path after `site.editUrl` in each page's \"Edit this page\" link.\n    sourcePath: (inputPath) => inputPath.replace(\"./\", \"\"),\n");
		}
		return config;
	}
	if (rel.endsWith(".md") && engine === "ejs") {
		// The pages' `{{ site.name }}` works in every other language; EJS prints with `<%= %>`.
		return rename(engine, contents).replace(/\{\{ ([\w.]+) \}\}/g, "<%= $1 %>");
	}
	if (rel.endsWith(".md") || rel.endsWith(".json")) return rename(engine, contents);
	return contents;
}

/**
 * The `AGENTS.md` for a site: what each file is, how to look a name up and how to check a
 * change, for a coding agent. It's plain, not in the voice, and short, since an agent carries it
 * through a whole session. For a starter, it names the starter's folders; without one (`ssqch
 * docs agents`, for a site that exists already) it says where the config says they are.
 * `CLAUDE.md` is one line, `@AGENTS.md`.
 */
export function agentsMd(site?: { starter: string; engine: string }): string {
	let files: string;
	if (site) {
		const language = { njk: "Nunjucks", edge: "Edge", liquid: "Liquid", hbs: "Handlebars", ejs: "EJS" }[site.engine] ?? "Jinja";
		const pages = site.starter === "docs" ? "`src/docs/` has the pages (Markdown, with `src/_data/nav.yml` for the sidebar)" : "`src/posts/` has the posts and `src/` the other pages (Markdown)";
		files = `\`ssqch.config.js\` is the config. ${pages}, \`src/_includes/\` the layouts and templates (${language}), \`src/_data/\` the global data and \`src/_blueprints/\` the blueprints for new pages. \`dist/\` is the build: don't edit it.`;
	} else {
		files = "`ssqch.config.js` (or `sitesquatch.toml`) is the config, and its `dirs` say where the pages, layouts (`_includes/`), global data (`_data/`) and the build are. Don't edit the build.";
	}
	const newPage = !site ? "`ssqch new <folder> --title \"...\"`, from a blueprint in `_blueprints/`" : site.starter === "docs" ? "`ssqch new docs/guides --title \"...\"` (then list it in `src/_data/nav.yml`)" : "`ssqch new posts --title \"...\"`";
	const out = site ? "dist" : "<output>";
	return `# A SiteSquatch site

This site is built with SiteSquatch (\`ssqch\`), a static site generator. ${files}

- How to use something: \`ssqch docs <name>\` (a config option, template function, command or topic) answers for the installed version, and \`ssqch docs\` lists everything.
- What this ssqch supports: \`ssqch capabilities --format json\`.
- Check a change: \`ssqch build --format json\`. \`ok\` is the result, and each problem has a \`code\`, a \`file\` and a \`line\`.
- What agents and crawlers find in the build (robots.txt, the sitemap, llms.txt, each page's Markdown copy): \`ssqch patrol --format json\` after \`ssqch build\`, and with \`--url <address>\` on a deploy.
- Why a page's value is what it is: \`ssqch trace <url or file> --format json\`.
- Before changing layouts or the config: \`ssqch build --output ${out}-before\` into a folder that isn't there yet, and afterwards \`ssqch build\` and \`ssqch diff ${out}-before ${out}\`.
- That a fresh copy builds the same: \`ssqch baseline "npx ssqch build" --from ${out}\`.
- A new page: ${newPage}.
- \`ssqch serve\` is for a person watching the browser. Check with \`ssqch build\`.
- A \`note:\` or hint naming another generator's word (\`pathPrefix\`): use ssqch's name.
`;
}

/** A starter's file that's copied as its bytes: a picture. */
const isBinary = (rel: string) => /\.(?:jpe?g|png|gif|webp|avif)$/i.test(rel);

/** The starter's files for `engine`, as (path in the site, contents: text, or a picture's bytes). */
export function starterFiles(starter: string, engine: string): Array<[string, string | Buffer]> {
	const common = (starter === "docs" ? DOCS_STARTER : STARTER).map(([rel, file]): [string, string | Buffer] => [rel, isBinary(rel) ? fs.readFileSync(bundledPath(file)) : adapt(engine, rel, rel === "ssqch.d.ts" ? types() + (starter === "docs" ? schemaDeclarations(DOCS_SCHEMAS) : "") : bundled(file))]);
	const set = (starter === "docs" ? DOCS_TEMPLATES : SITE_TEMPLATES)[engine === "njk" ? "jinja" : engine];
	const templates = set.map(([rel, file]): [string, string] => [`${rel}.${engine}`, rename(engine, bundled(file))]);
	return [...common, ...templates, ["AGENTS.md", agentsMd({ starter, engine })], ["CLAUDE.md", "@AGENTS.md\n"]];
}

/** Writes `contents` to `file`, making its folders. */
export function write(file: string, contents: string | Buffer, shown = file): void {
	// Its folder first, then the file, each error naming which (as given), as 0.7's did.
	const parent = parentAsGiven(shown);
	if (parent !== "") {
		try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) { throw new Error(`creating ${parent}: ${(e as Error).message}`); }
	}
	try { fs.writeFileSync(file, contents); } catch (e) { throw new Error(`writing ${shown}: ${(e as Error).message}`); }
}

export interface InitOptions {
	dir: string;
	starter: string;
	engine: string;
	quiet: boolean;
}

/** Whether `dir` is the current folder as Rust compares paths (`.`, `./`, `./.`), where 0.7 printed no `cd`. */
const isCurrentFolder = (dir: string) => dir.startsWith(".") && dir.split(path.sep === "/" ? "/" : /[\\/]/).every((part) => part === "" || part === ".");

/** Folders a project's own code isn't in: installs, a repository's files, builds. */
const NOT_OWN_CODE = new Set(["node_modules", ".git", ".cache", "dist", "_site", "public", "build"]);

/** A JavaScript or TypeScript file of the project's own that Node could read as CommonJS (`.js`, `.cjs`, `.ts`, `.cts`), outside `skip`. */
function ownCode(dir: string, skip: Set<string>, depth = 0): boolean {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
	for (const entry of entries) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!NOT_OWN_CODE.has(entry.name) && depth < 6 && ownCode(file, skip, depth + 1)) return true;
		} else if (/\.(?:c?js|c?ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !skip.has(file)) return true;
	}
	return false;
}

/**
 * The project's `package.json`, made ready for the starter: `"type": "module"`, which the
 * config's `export default` needs (`npm init -y` on npm 12 writes `"type": "commonjs"`, and every
 * command then warned `Failed to load the ES module ... ssqch.config.js`: both new-site runs),
 * and `build` and `serve` scripts. A project with JavaScript of its own keeps its `type` (its
 * files may be CommonJS), and the config is written as `ssqch.config.mjs` instead, which is a
 * module whatever the type. No `package.json`, no change: a site needs none to build. Answers
 * what was changed, for the output, and whether the config is to be `.mjs`.
 */
function preparePackage(dir: string, skip: Set<string>): { changes: string[]; mjs: boolean; write?: () => void } {
	const file = path.join(dir, "package.json");
	let text: string;
	try { text = fs.readFileSync(file, "utf8"); } catch { return { changes: [], mjs: false }; }
	let pkg: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { changes: [], mjs: false };
		pkg = parsed as Record<string, unknown>;
	} catch { return { changes: [], mjs: false }; }
	const changes: string[] = [];
	let mjs = false;
	if (pkg.type !== "module") {
		if (ownCode(dir, skip)) mjs = true;
		else {
			pkg.type = "module";
			changes.push("\"type\": \"module\"");
		}
	}
	const scripts = pkg.scripts !== null && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? pkg.scripts as Record<string, unknown> : pkg.scripts === undefined ? {} : undefined;
	if (scripts) {
		const added = [["build", "ssqch build"], ["serve", "ssqch serve"]].filter(([name]) => scripts[name] === undefined);
		for (const [name, command] of added) scripts[name] = command;
		if (added.length) {
			pkg.scripts = scripts;
			changes.push(`the ${added.map(([name]) => name).join(" and ")} script${added.length > 1 ? "s" : ""}`);
		}
	}
	if (!changes.length) return { changes, mjs };
	// The file's own indent (npm's is two spaces), and its final newline.
	const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ";
	const out = JSON.stringify(pkg, null, indent) + (text.endsWith("\n") ? "\n" : "");
	return { changes, mjs, write: () => fs.writeFileSync(file, out) };
}

/** How the package managers run a package's own command, `ssqch` from `node_modules/.bin`. */
const EXEC: Record<string, string> = { npm: "npx", pnpm: "pnpm exec", yarn: "yarn", bun: "bunx" };

/**
 * The command that starts the dev server in `dir`, as this site has ssqch: `ssqch serve` when it's
 * installed for the machine, and through the package manager when it's the project's own, where a
 * bare `ssqch` isn't on the PATH (the new docs site's rerun, `npm install -D ssqch`). The `serve`
 * script when it runs ssqch's, since that's what the project's README will say.
 */
function serveCommand(dir: string): string {
	let pkg: Record<string, unknown> | undefined;
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) pkg = parsed as Record<string, unknown>;
	} catch { /* no package.json */ }
	const listed = (field: string) => { const deps = pkg?.[field]; return deps !== null && typeof deps === "object" && "ssqch" in deps; };
	const local = listed("dependencies") || listed("devDependencies") || fs.existsSync(path.join(dir, "node_modules", "ssqch", "package.json"));
	// `npx ssqch init`, with nothing installed: the same way again.
	if (!local) return process.env.npm_command === "exec" ? "npx ssqch serve" : "ssqch serve";
	const pm = packageManager(dir, pkg);
	const scripts = pkg?.scripts as Record<string, unknown> | undefined;
	if (typeof scripts?.serve === "string" && /^ssqch serve\b/.test(scripts.serve)) return `${pm} run serve`;
	return `${EXEC[pm] ?? "npx"} ssqch serve`;
}

/** `ssqch init`: writes the starter into `dir`, keeping any file that's there. Answers the exit code. */
export function runInit(options: InitOptions): number {
	const { dir, starter, engine, quiet } = options;
	const written: string[] = [], skipped: string[] = [], leftOut: string[] = [];
	let keptConfig: string | undefined;
	let packageChanges: string[] = [];
	try {
		if (!STARTERS.includes(starter)) throw new Error(`--starter ${starter}: not a starter (use ${STARTERS.join(" or ")})`);
		if (!ENGINES.includes(engine)) throw new Error(`--engine ${engine}: not a starter engine (use ${ENGINES.join(", ")})`);
		const files = starterFiles(starter, engine);
		// A config that's there already, under any of its names, is the site's.
		const hasConfig = (keptConfig = CONFIG_FILES.find((name) => fs.existsSync(path.join(dir, name))));
		const prepared = preparePackage(dir, new Set(files.map(([rel]) => path.join(dir, rel))));
		for (let [rel, contents] of files) {
			if (rel === "ssqch.config.js") {
				if (hasConfig !== undefined) {
					skipped.push(hasConfig);
					continue;
				}
				if (prepared.mjs) rel = "ssqch.config.mjs";
			}
			const file = path.join(dir, rel);
			if (fs.existsSync(file)) skipped.push(rel);
			// The starter's pages, layouts and posts read what its config sets up (the tag pages,
			// `collections.tagList`), so beside a config of the site's own they'd stop the build:
			// they're left out, and the rest (AGENTS.md, the types) is written (the Squatch Snacks rerun).
			else if (hasConfig !== undefined && rel.startsWith("src/")) leftOut.push(rel);
			else {
				write(file, contents, joinAsGiven(dir, rel));
				written.push(rel);
			}
		}
		if (prepared.write) {
			try { prepared.write(); } catch (e) { throw new Error(`writing ${joinAsGiven(dir, "package.json")}: ${(e as Error).message}`); }
			packageChanges = prepared.changes;
		}
	} catch (e) {
		process.stderr.write(`${red("error:")} ${(e as Error).message}\n`);
		return 1;
	}
	// `--quiet`: only warnings and errors.
	if (quiet) return 0;
	let out = "";
	for (const rel of written) out += `  created ${slashes(rel)}\n`;
	for (const rel of skipped) out += `  kept    ${slashes(rel)} (already there)\n`;
	if (leftOut.length) out += `  left out the starter's ${count(leftOut.length)} file${leftOut.length === 1 ? "" : "s"} in src/: they need the starter's config, and ${keptConfig} is this site's own\n`;
	if (packageChanges.length) out += `  updated package.json: ${packageChanges.join(" and ")}\n`;
	if (written.includes("ssqch.config.mjs")) out += "  (ssqch.config.mjs, not .js: package.json isn't \"type\": \"module\" and this project has JavaScript of its own, so it's left as it is)\n";
	if (written.length === 0 && leftOut.length === 0) out += "Nothing to do: camp is already set up (every starter file is there).\n";
	else out += `\nCamp is set up. Next: ${isCurrentFolder(dir) ? "" : `cd ${dir} && `}${serveCommand(dir)}, then open http://localhost:8080\n`;
	process.stdout.write(out);
	return 0;
}
