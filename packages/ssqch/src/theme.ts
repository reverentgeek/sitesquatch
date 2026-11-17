// Themes: a site's defaults, without a package manager.
//
// A theme is a folder shaped like a site's input folder: `_includes/` (layouts, partials, hooks,
// containers), `_data/`, pages, and files to copy (stylesheets, fonts). The site sits on top of
// it, file by file: an include, layout, hook or container the site has wins over the theme's at
// the same path; `_data` is merged, with the site's values winning; and a page or file in the
// theme is built or copied unless the site's input folder has a file at the same path.
//
// A theme is a folder in the project (`themes/docs`), or a git repository pinned to a commit or
// tag (`https://github.com/you/theme#v1.2.0`), which is fetched once with `git` and kept in
// `.cache/ssqch/themes/`. With more than one theme, earlier ones sit on top of later ones.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bail, progress } from "./diagnostics.ts";

/** Where a theme comes from: a folder from the project root, or a git repository at a commit, tag or branch, and the folder inside it that's the theme (empty for the repository's root). */
export type ThemeSource = { folder: string } | { url: string; reference: string; dir: string };

const isGitUrl = (s: string) => ["https://", "http://", "ssh://", "git://", "file://", "git@"].some((p) => s.startsWith(p));
const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
/** A string in quotes, as these errors show what was given. */
const q = (s: string) => JSON.stringify(s);

/** `themes/docs`, or `https://github.com/you/theme#v1.2.0` (with `#ref:folder` for a theme in a folder of its repository). */
export function parseTheme(given: string): ThemeSource {
	const spec = given.trim();
	if (spec === "") bail("theme is empty: give a folder (\"themes/docs\") or a git URL with a commit or tag (\"https://github.com/you/theme#v1.2.0\")");
	if (!isGitUrl(spec)) return { folder: spec };
	const hash = spec.indexOf("#");
	const pin = hash === -1 ? "" : spec.slice(hash + 1);
	if (pin === "") bail(`theme ${q(spec)} isn't pinned: add the commit or tag to use, like "${spec.replace(/#+$/, "")}#v1.2.0"`);
	const colon = pin.indexOf(":");
	return gitTheme(spec.slice(0, hash), colon === -1 ? pin : pin.slice(0, colon), colon === -1 ? "" : pin.slice(colon + 1));
}

export function gitTheme(url: string, reference: string, dir: string): ThemeSource {
	if (!isGitUrl(url)) bail(`theme: ${q(url)} isn't a git URL (https://, ssh://, git@ or file://)`);
	if (reference === "" || reference.startsWith("-") || /\s/.test(reference)) bail(`theme ${q(url)}: ${q(reference)} isn't a commit or tag`);
	const folder = dir.replace(/^\/+|\/+$/g, "");
	if (folder.split("/").includes("..") || /[\\:]/.test(folder)) bail(`theme ${q(url)}: the folder ${q(folder)} must be inside the repository`);
	return { url, reference, dir: folder };
}

/** The theme's folder, fetching a git theme if it isn't cached yet. */
export function resolveTheme(root: string, theme: string | { git: string; ref: string; dir: string }, quiet: boolean): string {
	const source = typeof theme === "string" ? parseTheme(theme) : gitTheme(theme.git, theme.ref, theme.dir);
	if ("folder" in source) {
		const dir = path.resolve(root, source.folder);
		if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) bail(`theme folder ${dir} doesn't exist`);
		return real(dir);
	}
	const checkout = fetch(root, source.url, source.reference, quiet);
	const dir = path.join(checkout, source.dir);
	if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) bail(`theme ${source.url}#${source.reference}: there's no folder ${q(source.dir)} in it`);
	return real(dir);
}

/** A name for a checkout's folder: the repository's name and a hash of where it's from. */
export function cacheName(url: string, reference: string): string {
	const last = url.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "theme";
	const name = last.replace(/[^A-Za-z0-9_-]/g, "");
	// FNV-1a: stable across builds and platforms, which is all this needs.
	let hash = 0xcbf29ce484222325n;
	for (const b of Buffer.from(`${url}#${reference}`)) hash = ((hash ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
	return `${name === "" ? "theme" : name}-${hash.toString(16).padStart(16, "0")}`;
}

/** The cached checkout of `url` at `reference`, fetching it the first time. */
function fetch(root: string, url: string, reference: string, quiet: boolean): string {
	const dir = path.join(root, ".cache/ssqch/themes", cacheName(url, reference));
	const marker = path.join(dir, ".ssqch-theme");
	const source = `${url}#${reference}`;
	try { if (fs.readFileSync(marker, "utf8").trim() === source) return dir; } catch { /* not fetched yet */ }
	if (!quiet) progress(`[ssqch] Fetching theme ${source}`);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const git = (args: string[]) => {
		const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
		if (out.error) bail(`theme ${source}: can't run git (${out.error.message}); install git, or use a theme folder`);
		if (out.status !== 0) {
			fs.rmSync(dir, { recursive: true, force: true });
			// A shortened hash isn't a name a server knows.
			const short = reference.length >= 7 && reference.length < 40 && /^[0-9a-fA-F]+$/.test(reference);
			bail(`theme ${source}: git ${args[0] ?? ""} failed: ${(out.stderr ?? "").trim()}${short ? " (if that's a commit, give all 40 characters of its hash)" : ""}`);
		}
	};
	git(["init", "--quiet"]);
	// One commit, by name: a tag, a branch, or (on hosts that allow it, like GitHub) a commit's hash.
	git(["fetch", "--quiet", "--depth", "1", "--", url, reference]);
	git(["-c", "advice.detachedHead=false", "checkout", "--quiet", "FETCH_HEAD"]);
	// A snapshot, not a clone: the history isn't needed again.
	fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
	fs.writeFileSync(marker, source);
	return dir;
}
