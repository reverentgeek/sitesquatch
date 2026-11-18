// What the dev server answers: a file from the output folder, with the reload script and a tab
// icon added to pages as they're sent, the questions that script asks (`/__ssqch/build`,
// `/__ssqch/missing`), and a 404 page of its own for a site without one. `ssqch serve --built`
// answers with the files as they are, compressed as a host would.
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { relative, walkFiles } from "../paths.ts";
import { closestPath } from "../suggest.ts";
import type { Live } from "./live.ts";

/** The script added to each HTML page the server sends. It asks `/__ssqch/build` what changed since it last looked. */
const LIVE_SCRIPT = fs.readFileSync(new URL("./live.js", import.meta.url), "utf8");

/** The page for a URL that isn't there, when the site has no `404.html` of its own. Only the dev server sends it: it's never written to the output. */
const NOT_FOUND_PAGE = fs.readFileSync(new URL("./not-found.html", import.meta.url), "utf8");

/**
 * The footprint as a 1970s trail patch: broad harvest-gold and avocado stripes behind it, in a
 * pine ring. The picture on the dev server's 404 page.
 */
const PATCH = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\" role=\"img\" aria-label=\"A trail patch with one very large footprint\"><defs><clipPath id=\"ssqch-patch\"><circle cx=\"100\" cy=\"100\" r=\"96\"/></clipPath></defs><g clip-path=\"url(#ssqch-patch)\"><rect width=\"200\" height=\"200\" fill=\"#e8af43\"/><rect y=\"40\" width=\"200\" height=\"40\" fill=\"#a9b66a\"/><rect y=\"120\" width=\"200\" height=\"40\" fill=\"#a9b66a\"/></g><circle cx=\"100\" cy=\"100\" r=\"92\" fill=\"none\" stroke=\"#233b2b\" stroke-width=\"8\"/><g fill=\"#233b2b\" transform=\"rotate(12 100 100) translate(48 20) scale(0.8)\">";

/**
 * The tab icon: a map-paper footprint on a solid circle, big enough to read at 16 pixels.
 * `{circle}` is pine, or burnt orange while the build is broken.
 */
const ICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><circle cx=\"100\" cy=\"100\" r=\"100\" fill=\"{circle}\"/><g fill=\"#fff3d6\" transform=\"rotate(10 100 100) translate(42 5) scale(0.9)\">";

/** The footprint itself, from the 404 page's patch and the tab icon. */
const FOOTPRINT = "<path d=\"M62 72c27 0 39 22 35 56-4 31-13 64-37 64s-32-33-35-64c-3-34 10-56 37-56z\"/><circle cx=\"20\" cy=\"62\" r=\"8\"/><circle cx=\"37\" cy=\"44\" r=\"9\"/><circle cx=\"57\" cy=\"33\" r=\"10\"/><circle cx=\"79\" cy=\"30\" r=\"11\"/><circle cx=\"102\" cy=\"42\" r=\"14\"/></g></svg>";

/** The 404 page's trail patch. */
const patch = () => `${PATCH}${FOOTPRINT}`;

/** The tab icon, pine or (while the build is broken) burnt orange. */
export const icon = (broken: boolean) => `${ICON.replace("{circle}", broken ? "#a23e20" : "#233b2b")}${FOOTPRINT}`;

/** Text for a page of the server's own: `&`, `<`, `>`, `"`, `'` and a backtick, as 0.7 wrote them. */
function escapeHtml(s: string): string {
	return s.replace(/[&<>"'`]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "\"" ? "&quot;" : c === "'" ? "&#x27;" : "&#x60;"));
}

const isFile = (file: string) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const isDir = (file: string) => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };

/** `%2F` and the rest as the bytes they stand for, read as UTF-8 (a byte that isn't becomes U+FFFD). */
export function percentDecode(s: string): string {
	if (!s.includes("%")) return s;
	const bytes = Buffer.from(s, "utf8");
	const out = Buffer.alloc(bytes.length);
	let n = 0;
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0x25 && i + 2 < bytes.length) {
			const hex = bytes.toString("latin1", i + 1, i + 3);
			if (/^[0-9a-fA-F]{2}$/.test(hex)) {
				out[n++] = Number.parseInt(hex, 16);
				i += 2;
				continue;
			}
		}
		out[n++] = bytes[i];
	}
	return out.toString("utf8", 0, n);
}

/** One value from a query string (`v=3&p=%2Fabout%2F`), decoded. */
export function queryValue(query: string, key: string): string | undefined {
	for (const pair of query.split("&")) {
		const at = pair.indexOf("=");
		if (at !== -1 && pair.slice(0, at) === key) return percentDecode(pair.slice(at + 1));
	}
	return undefined;
}

/**
 * Where a request path is in the output folder, for a site served under `base` (`/repo`):
 * `/repo/about/` is `/about/`. Paths outside the base aren't part of the site, except `/`, which
 * sends the browser to it.
 */
export type Mounted = { path: string } | { redirect: string } | "outside";

export function mounted(url: string, base: string): Mounted {
	if (base === "") return { path: url };
	if (url.startsWith(base)) {
		const rest = url.slice(base.length);
		if (rest.startsWith("/")) return { path: rest };
		if (rest === "") return { redirect: `${base}/` };
	}
	return url === "/" ? { redirect: `${base}/` } : "outside";
}

/**
 * Whether a decoded request path (without its leading `/`) can only name something inside the
 * folder it's joined to: plain names, so no `..`, no second leading `/` (`/%2Fetc/hosts`), no
 * drive letter and no backslash.
 */
export function inside(rel: string): boolean {
	if (rel.includes("\\") || rel.includes("\0") || rel.startsWith("/")) return false;
	// On Windows a colon names a drive, or another stream of a file.
	if (process.platform === "win32" && rel.includes(":")) return false;
	const parts = rel.split("/");
	// A `.` after the first name is the same folder; one in front isn't a name.
	return parts[0] !== "." && !parts.includes("..");
}

/** The file in the output that a page's URL path is: `about/index.html` for `/about/` (under the site's `base`, when it has one). */
export function pageFile(url: string, base: string): string {
	const at = mounted(url, base);
	const rel = (typeof at === "object" && "path" in at ? at.path : url).replace(/^\/+/, "");
	return rel === "" || rel.endsWith("/") ? `${rel}index.html` : rel;
}

export function contentType(file: string): string {
	switch (path.extname(file).slice(1)) {
		case "html": return "text/html; charset=utf-8";
		case "css": return "text/css; charset=utf-8";
		case "js": case "mjs": return "text/javascript; charset=utf-8";
		case "json": return "application/json";
		case "xml": return "application/xml; charset=utf-8";
		case "txt": return "text/plain; charset=utf-8";
		case "svg": return "image/svg+xml";
		case "png": return "image/png";
		case "jpg": case "jpeg": return "image/jpeg";
		case "gif": return "image/gif";
		case "webp": return "image/webp";
		case "avif": return "image/avif";
		case "ico": return "image/x-icon";
		case "woff2": return "font/woff2";
		case "woff": return "font/woff";
		case "pdf": return "application/pdf";
		default: return "application/octet-stream";
	}
}

/** Whether a page has an icon of its own: a `<link>` whose `rel` has `icon`. */
export function linksAnIcon(html: string): boolean {
	return /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bicon\b/is.test(html);
}

/** Every page in the output folder, by URL: `/about/` for `about/index.html`. */
export function pageUrls(root: string): string[] {
	return walkFiles(root)
		.filter((file) => path.extname(file) === ".html")
		.map((file) => relative(root, file))
		.map((rel) => (rel.endsWith("index.html") ? `/${rel.slice(0, -10)}` : `/${rel}`));
}

/** The server's own 404 page for `url`, with the page whose URL is closest to it, if one is close. */
export function notFoundPage(root: string, url: string, base: string): string {
	const found = closestPath(url, pageUrls(root));
	const suggestion = found === undefined ? "" : `<p>Did you mean <a href="${escapeHtml(base)}${escapeHtml(found)}">${escapeHtml(found)}</a>?</p>`;
	// Each part goes in once, in this order, so a URL that has `{{home}}` in it stays as it was typed.
	const parts: Record<string, string> = { patch: patch(), url: escapeHtml(url), suggestion, home: `${escapeHtml(base)}/` };
	return NOT_FOUND_PAGE.replace(/\{\{(patch|url|suggestion|home)\}\}/g, (_, name: string) => parts[name]);
}

type Headers = Record<string, string>;

/** The type 0.7's server (tiny_http) gave the text it answered with, spelled as it spelled it. */
const PLAIN: Headers = { "Content-Type": "text/plain; charset=UTF-8" };

/** Answers with `body` and its length, so the response isn't sent in chunks and ends with the body. */
function respond(res: http.ServerResponse, status: number, headers: Headers, body: string | Buffer = ""): void {
	const bytes = typeof body === "string" ? Buffer.from(body) : body;
	res.writeHead(status, { ...headers, "Content-Length": String(bytes.length) });
	res.end(bytes);
}

/** A request's path and query, apart: what's before a `#` is all there is. */
function split(url: string | undefined): [path: string, query: string] {
	const whole = (url ?? "/").split("#")[0] || "/";
	const at = whole.indexOf("?");
	return at === -1 ? [whole, ""] : [whole.slice(0, at), whole.slice(at + 1)];
}

/** The file a request path names in `root`, or what to answer instead. */
function locate(res: http.ServerResponse, root: string, rawUrl: string, url: string): { status: number; file: string } | undefined {
	const rel = url.replace(/^\/+/, "");
	// No file has a NUL in its name, so that's a page that isn't there, as 0.7 answered (Node's
	// file functions refuse the name, where 0.7's found nothing).
	if (rel.includes("\0") && inside(rel.replaceAll("\0", "_"))) return { status: 404, file: path.join(root, "404.html") };
	if (!inside(rel)) { respond(res, 400, {}); return undefined; }
	let file = path.join(root, rel);
	if (isDir(file)) {
		if (!url.endsWith("/")) { respond(res, 301, { Location: `${rawUrl}/` }); return undefined; }
		file = path.join(file, "index.html");
	}
	return isFile(file) ? { status: 200, file } : { status: 404, file: path.join(root, "404.html") };
}

const read = (file: string) => { try { return fs.readFileSync(file); } catch { return undefined; } };

/** One request to the dev server. */
export function handle(req: http.IncomingMessage, res: http.ServerResponse, root: string, live: Live, base: string): void {
	const [rawUrl, query] = split(req.url);
	const noCache = { "Cache-Control": "no-store" };
	// A page's stylesheet or script answered 404: say so, and what could have written it.
	if (rawUrl === "/__ssqch/missing") {
		const url = queryValue(query, "path") ?? "";
		const at = mounted(url, base);
		const rel = typeof at === "object" && "path" in at ? at.path.replace(/^\/+/, "") : "";
		const message = inside(rel) && !isFile(path.join(root, rel)) ? live.missing(rel, url) : null;
		return respond(res, 200, { "Content-Type": "application/json", ...noCache }, JSON.stringify({ message }));
	}
	if (rawUrl === "/__ssqch/build") {
		const v = queryValue(query, "v");
		const since = v !== undefined && /^\+?\d+$/.test(v) ? Number(v) : undefined;
		const page = pageFile(queryValue(query, "p") ?? "", base);
		return respond(res, 200, { "Content-Type": "application/json", ...noCache }, JSON.stringify(live.answer(since, page, base)));
	}
	// A footprint for the tab of a site without an icon, and a burnt orange one while the build is broken.
	const wanted = rawUrl === "/__ssqch/favicon.svg" || (rawUrl === "/favicon.ico" && !isFile(path.join(root, "favicon.ico"))) ? false : rawUrl === "/__ssqch/favicon-error.svg" ? true : undefined;
	if (wanted !== undefined) return respond(res, 200, { "Content-Type": "image/svg+xml", ...noCache }, icon(wanted));
	// Decoded once, before anything looks at the path.
	const fullUrl = percentDecode(rawUrl);
	const at = mounted(fullUrl, base);
	if (at === "outside") return respond(res, 404, PLAIN, `Wrong trailhead: this site is served under ${base}/ (its \`base\`).`);
	if ("redirect" in at) return respond(res, 302, { Location: at.redirect });
	const url = at.path;
	const found = locate(res, root, rawUrl, url);
	if (!found) return;
	let body = read(found.file);
	let ctype = contentType(found.file);
	if (!body) {
		body = Buffer.from(notFoundPage(root, url, base));
		ctype = "text/html; charset=utf-8";
	}
	if (ctype.startsWith("text/html")) {
		let html = body.toString("utf8");
		// Browsers only look for an SVG icon when a page links to one: `/favicon.ico` has to be an
		// ICO or a PNG. So a page of a site without an icon of its own is pointed at the patch.
		if (!isFile(path.join(root, "favicon.ico")) && !linksAnIcon(html)) {
			const link = "<link rel=\"icon\" href=\"/__ssqch/favicon.svg\" type=\"image/svg+xml\">";
			const head = html.indexOf("</head>");
			html = head === -1 ? `${link}${html}` : `${html.slice(0, head)}${link}${html.slice(head)}`;
		}
		const end = html.lastIndexOf("</body>");
		body = Buffer.from(end === -1 ? `${html}<script>${LIVE_SCRIPT}</script>` : `${html.slice(0, end)}<script>${LIVE_SCRIPT}</script>${html.slice(end)}`);
	}
	// The dev server's own; a deployed site's headers are its host's.
	respond(res, found.status, { "Content-Type": ctype, ...noCache, "X-Powered-By": "pine cones" }, body);
}

/** Whether a browser takes gzip: `gzip` among what its `Accept-Encoding` lists. */
function takesGzip(req: http.IncomingMessage): boolean {
	return String(req.headers["accept-encoding"] ?? "").split(",").some((encoding) => encoding.trim().split(";")[0] === "gzip");
}

/** One request to `ssqch serve --built`. */
export function handleBuilt(req: http.IncomingMessage, res: http.ServerResponse, root: string, base: string): void {
	const [rawUrl] = split(req.url);
	const fullUrl = percentDecode(rawUrl);
	const at = mounted(fullUrl, base);
	if (at === "outside") return respond(res, 404, PLAIN, `Not found: ${fullUrl} (this site is served under ${base}/)`);
	if ("redirect" in at) return respond(res, 302, { Location: at.redirect });
	const found = locate(res, root, rawUrl, at.path);
	if (!found) return;
	let body = read(found.file);
	let ctype = contentType(found.file);
	if (!body) {
		body = Buffer.from(`Not found: ${fullUrl}`);
		ctype = "text/plain; charset=utf-8";
	}
	const compressible = ctype.startsWith("text/") || ctype.startsWith("application/json") || ctype.startsWith("application/xml") || ctype === "image/svg+xml";
	const gzip = compressible && body.length > 256 && takesGzip(req);
	const headers: Headers = { "Content-Type": ctype };
	if (compressible) headers.Vary = "Accept-Encoding";
	if (gzip) headers["Content-Encoding"] = "gzip";
	respond(res, found.status, headers, gzip ? zlib.gzipSync(body) : body);
}
