// `ssqch patrol`: a ranger's round of a built site, for what agents and crawlers read. It reads an
// output folder, as `ssqch footprint` and `ssqch diff` do, so it works on any generator's build
// (something to try before a move, too). Each finding is a warning with a code, and the checks
// are the ones a folder can answer from the two public lists (the Agent-Friendly Documentation
// Spec and isitagentready.com): the posted signs (robots.txt, a sitemap, llms.txt, a real 404),
// each page's shape (one <h1>, its content in <main> or <article> and early in the page, a
// description), and each page's Markdown copy (there when it's linked, the page's own text, not
// too long for an agent's fetch, code fences that close, links that work from anywhere).
import fs from "node:fs";
import path from "node:path";
import { markdown } from "./api.ts";
import { htmlText } from "./content.ts";
import { bail } from "./diagnostics.ts";
import { compareText } from "./paths.ts";
import { count } from "./report.ts";

/** One kind of finding, and where. */
export interface Finding {
	code: string;
	/** What's wrong, for every file it names. */
	message: string;
	/** The files, from the folder, with `/` (`docs/index.html`); none for the site as a whole. */
	files: string[];
}

export interface Patrol {
	pages: number;
	/** The signs it found: the files agents and crawlers look for first. */
	signs: { robots: boolean; sitemap: boolean; llms: boolean; notFound: boolean };
	copies: number;
	/** Each page with a Markdown copy, by address (`/about/`, `/about/index.md`), for `--url`. */
	withCopies: Array<{ page: string; copy: string }>;
	findings: Finding[];
	/** What `--url` found on the live site: its address and how many pages it asked about. */
	live?: { url: string; asked: number };
}

/** llms.txt over this many characters is more than an agent reads before it decides (the specs' 50,000). */
const LLMS_LIMIT = 50_000;
/** A page's Markdown over this many characters is long for one fetch. */
const COPY_LONG = 50_000;
/** Where Claude Code's fetch stops reading a page. */
const COPY_CUT = 100_000;

const walk = (dir: string, rel = ""): string[] => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
	const r = rel ? `${rel}/${e.name}` : e.name;
	return e.isDirectory() ? walk(dir, r) : e.isFile() ? [r] : [];
}).sort(compareText);

/** `about/index.html` is `/about/`; `about.html` is `/about.html`. */
const urlOf = (file: string) => `/${file.replace(/(^|\/)index\.html?$/, "$1")}`;

/** Text a reader reads: scripts, styles and SVG left out. */
// Block elements' edges are a break between words, as a browser shows them: a minified list's
// `2017</span></li><li><a>Community` is two words, not `2017community`. Inline tags (`<a>`,
// `<em>`) stay as they are, so `pine<em>cone</em>s` is still one.
const BLOCK_EDGE = /<\/?(?:address|article|aside|blockquote|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|caption)\b[^>]*>/gi;
const textOf = (html: string) => htmlText(html.replace(/<(script|style|svg|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(BLOCK_EDGE, (tag) => ` ${tag} `));

/** The part of a page inside its first `<name>` and the last `</name>`, or undefined. */
function part(html: string, name: string): { start: number; html: string } | undefined {
	const open = new RegExp(`<${name}\\b[^>]*>`, "i").exec(html);
	if (!open) return undefined;
	const close = html.toLowerCase().lastIndexOf(`</${name}`);
	return close > open.index ? { start: open.index, html: html.slice(open.index + open[0].length, close) } : undefined;
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** How much of `a`'s words `b` has, counting repeats (0 to 1). */
function covered(a: string[], b: string[]): number {
	if (!a.length) return 1;
	const have = new Map<string, number>();
	for (const w of b) have.set(w, (have.get(w) ?? 0) + 1);
	let hits = 0;
	for (const w of a) {
		const n = have.get(w) ?? 0;
		if (n > 0) { hits++; have.set(w, n - 1); }
	}
	return hits / a.length;
}

/** Markdown's links' destinations, outside code (inline links and images, and reference definitions). */
function linksIn(md: string): string[] {
	const out: string[] = [];
	let fence: string | undefined;
	for (const line of md.split("\n")) {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence !== undefined) { if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined; continue; }
		if (marker) { fence = marker; continue; }
		const ref = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)/.exec(line);
		if (ref) out.push(ref[1]);
		for (const m of line.replace(/`+[^`]*`+/g, "").matchAll(/\]\(\s*<?([^\s)>]+)/g)) out.push(m[1]);
	}
	return out;
}

/** Markdown without its code: fenced blocks and code spans, where an `href` is an example, not a link. */
function prose(md: string): string {
	let fence: string | undefined;
	return md.split("\n").filter((line) => {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence !== undefined) { if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined; return false; }
		if (marker) { fence = marker; return false; }
		return true;
	}).map((line) => line.replace(/`+[^`]*`+/g, "")).join("\n");
}

/** Whether every code fence opened in `md` is closed. */
function fencesClose(md: string): boolean {
	let fence: string | undefined;
	for (const line of md.split("\n")) {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence === undefined) { if (marker) fence = marker; }
		else if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
	}
	return fence === undefined;
}

/** A link that doesn't work once the text is read away from its page: not a whole address, a path from the root or a fragment. */
const relative = (href: string) => !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) && !href.startsWith("#") && !href.startsWith("/");

/** Checks the build in `dir`. */
export function patrol(dir: string): Patrol {
	let stat: fs.Stats;
	try { stat = fs.statSync(dir); } catch { bail(`${dir} isn't there: build the site first (\`ssqch build\`), or name a build folder`); }
	if (!stat!.isDirectory()) bail(`${dir} is a file, not a build folder`);
	const files = walk(dir);
	const has = new Set(files);
	const read = (file: string) => fs.readFileSync(path.join(dir, file), "utf8");
	const found = new Map<string, Finding>();
	const say = (code: string, message: string, file?: string) => {
		const f = found.get(code) ?? { code, message, files: [] };
		if (file !== undefined) f.files.push(file);
		found.set(code, f);
	};

	const pages = files.filter((f) => /\.html?$/i.test(f) && !/(^|\/)404\.html?$/i.test(f));
	const robots = has.has("robots.txt") ? read("robots.txt") : undefined;
	// The site's address, from its signs: whole links to it count as its own files.
	const sitemapFile = has.has("sitemap.xml") ? "sitemap.xml" : undefined;
	const sitemapLine = robots && /^\s*sitemap:\s*(\S+)/im.exec(robots)?.[1];
	const sitemap = sitemapFile ? read(sitemapFile) : undefined;
	const locs = sitemap ? [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&")) : [];
	const origins = new Set<string>();
	for (const u of [sitemapLine, ...locs.slice(0, 1)]) {
		try { if (u) origins.add(new URL(u).origin); } catch { /* not an address */ }
	}
	/** A link's file in the folder, when it's the site's own: a path from the root, or a whole address on the site. */
	const fileOf = (href: string): string | undefined => {
		let p: string;
		if (href.startsWith("/") && !href.startsWith("//")) p = href;
		else {
			try {
				const u = new URL(href);
				if (!origins.has(u.origin)) return undefined;
				p = u.pathname;
			} catch { return undefined; }
		}
		p = decodeURIComponent(p.replace(/[?#].*$/, "")).replace(/^\/+/, "");
		if (has.has(p)) return p;
		if (has.has(`${p.replace(/\/$/, "")}/index.html`.replace(/^\//, ""))) return `${p.replace(/\/$/, "")}/index.html`.replace(/^\//, "");
		return "";
	};

	if (!robots) say("no-robots", "no robots.txt: crawlers find no sitemap line and no rules for AI crawlers (robotsPlugin() writes one)");
	if (!sitemapFile && !sitemapLine) say("no-sitemap", "no sitemap.xml, and robots.txt names none (sitemapPlugin({ url }) writes one)");
	if (!has.has("404.html")) say("no-404", "no 404.html: a missing page gets the host's error page, or worse, a 200");
	else if (has.has("index.html") && read("404.html") === read("index.html")) say("no-404", "404.html is the home page: a missing page should say it's missing");

	// llms.txt: there, an H1 first, short enough to read whole, its links working, to Markdown.
	// The same for each llms.txt it links (a part of the site's own, as llms.txt's v2 has them),
	// and what they all list counts for coverage.
	const llms = has.has("llms.txt") ? read("llms.txt") : undefined;
	const listed = new Set<string>();
	if (llms === undefined) say("no-llms", "no llms.txt: an agent gets no map of the site (llmsPlugin() writes one, with a Markdown copy of each page)");
	const maps = llms === undefined ? [] : ["llms.txt"];
	for (let i = 0; i < maps.length; i++) {
		const name = maps[i];
		const text = i === 0 ? (llms as string) : read(name);
		if (!/^\uFEFF?# \S/.test(text)) say("llms-shape", "llms.txt doesn't start with a `# ` heading (the site's name), which llmstxt.org's format requires", name);
		if (text.length > LLMS_LIMIT) say("llms-long", `llms.txt is ${count(text.length)} characters, over ${count(LLMS_LIMIT)}: more than an agent reads before deciding where to go (link section files from it instead)`, name);
		for (const href of linksIn(text)) {
			if (relative(href)) { say("relative-links", "links that aren't whole addresses (or from the site's root): they break once the text is read on its own", name); continue; }
			const file = fileOf(href);
			if (file === undefined) continue;
			if (file === "") say("llms-broken", `llms.txt links to files that aren't in the build`, href);
			else {
				if (!/\.(md|markdown|txt)$/i.test(file)) say("llms-html", "llms.txt links to pages, not their Markdown: an agent reads Markdown without the page's chrome", href);
				listed.add(file);
				if (/(^|\/)llms\.txt$/.test(file) && !maps.includes(file)) maps.push(file);
			}
		}
	}

	// Each page, and its copy.
	let copies = 0;
	const withCopies: Array<{ page: string; copy: string }> = [];
	const pageUrls: string[] = [];
	for (const file of pages) {
		const html = read(file);
		// A page that only sends a reader on (a redirect) isn't one to check.
		if (/<meta\s[^>]*http-equiv=["']?refresh/i.test(html)) continue;
		pageUrls.push(urlOf(file));
		const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
		if (h1 === 0) say("no-h1", "pages with no <h1>: an agent takes the first heading as what the page is about", file);
		else if (h1 > 1) say("h1s", "pages with more than one <h1>", file);
		if (!/<meta\s[^>]*name=["']?description["']?[^>]*content=["']?[^"'\s>]/i.test(html) && !/<meta\s[^>]*content=["']?[^"'>]+["']?[^>]*name=["']?description/i.test(html)) say("no-description", "pages with no <meta name=\"description\">: what search results and agents show for a link", file);
		const body = part(html, "body")?.html ?? html;
		const content = part(body, "main") ?? part(body, "article");
		if (!content) say("no-main", "pages with their content in neither <main> nor <article>: an agent can't tell the page from its navigation", file);
		else {
			const before = words(textOf(body.slice(0, content.start))).length;
			const all = words(textOf(body)).length;
			if (all > 0 && before / all > 0.5) say("content-late", "pages whose <main> comes after most of their text (navigation first): an agent with a short read sees the menus", file);
		}

		// The copy: the one the page links, or the address llms.txt's v2 proposal gives it.
		const linked = /<link\s[^>]*rel=["']?alternate["']?[^>]*type=["']?text\/markdown["']?[^>]*>/i.exec(html)?.[0] ?? /<link\s[^>]*type=["']?text\/markdown["']?[^>]*rel=["']?alternate["']?[^>]*>/i.exec(html)?.[0];
		const href = linked ? /href=["']?([^"'\s>]+)/i.exec(linked)?.[1] : undefined;
		let copy: string | undefined;
		if (href !== undefined) {
			const target = fileOf(href.startsWith("/") || /^[a-z]+:/i.test(href) ? href : `/${path.posix.join(path.posix.dirname(file), href)}`);
			if (target === "") { say("copy-missing", "pages that link a Markdown copy that isn't in the build", file); continue; }
			copy = target;
		} else {
			const guess = file.replace(/\.html?$/i, ".md");
			if (has.has(guess)) copy = guess;
		}
		if (!copy) continue;
		copies++;
		withCopies.push({ page: urlOf(file), copy: `/${copy}` });
		const md = read(copy);
		if (md.length > COPY_CUT) say("copy-cut-off", `Markdown copies over ${count(COPY_CUT)} characters, where Claude Code's fetch stops reading`, copy);
		else if (md.length > COPY_LONG) say("copy-long", `Markdown copies over ${count(COPY_LONG)} characters: long for one fetch`, copy);
		if (!fencesClose(md)) say("copy-fence", "Markdown copies with a code fence that never closes: the rest reads as code", copy);
		if (linksIn(md).some(relative)) say("relative-links", "links that aren't whole addresses (or from the site's root): they break once the text is read on its own", copy);
		// A link or picture to the site's own file that isn't in the build (a picture's source path, which an image plugin published under another name).
		if ([...linksIn(md), ...[...prose(md).matchAll(/<(?:img|a|source)\b[^>]*\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])].some((href) => !relative(href) && fileOf(href) === "")) say("copy-broken", "Markdown copies that link the site's own files that aren't in the build (an image's source path, say)", copy);
		// The copy says what the page says: most of each one's words are in the other.
		// The page's own part, as llmsPlugin() reads one (html-markdown.ts): its article when it has
		// just one (a post, without the related posts and comments around it in <main>), else <main>.
		const own = (body.match(/<article\b/gi) ?? []).length === 1 ? part(body, "article") : content;
		if (own) {
			// Navigation isn't what the page says: a layout's `<nav>` inside it (breadcrumbs, a
			// pager, a map of the docs) is left out, and the rest a layout adds (an "Edit" link, a
			// date) is why the page's side asks for half.
			const page = words(textOf(own.html.replace(/<nav\b[\s\S]*?<\/nav\s*>/gi, " ")));
			const copied = words(textOf(markdown(md)));
			if (page.length >= 20 && (covered(copied, page) < 0.8 || covered(page, copied) < 0.5)) say("copy-differs", "Markdown copies that don't say what their page says (under 80% of the copy's words on the page, or under half the page's in the copy)", copy);
		}
	}

	// llms.txt should list nearly every page the sitemap has.
	if (llms !== undefined && locs.length && listed.size) {
		const copyFor = (file: string) => file.replace(/\.html?$/i, ".md");
		const inList = locs.filter((loc) => {
			const file = fileOf(loc);
			return !file || listed.has(file) || listed.has(copyFor(file));
		}).length;
		if (inList / locs.length < 0.95) say("llms-coverage", `llms.txt lists ${count(inList)} of the sitemap's ${count(locs.length)} pages: under 95%, so an agent misses some (llmsPlugin() lists them all)`, "llms.txt");
	}

	return {
		pages: pageUrls.length,
		signs: { robots: robots !== undefined, sitemap: sitemapFile !== undefined || Boolean(sitemapLine), llms: llms !== undefined, notFound: has.has("404.html") },
		copies,
		withCopies,
		findings: [...found.values()].map((f) => ({ ...f, files: [...new Set(f.files)] })),
	};
}

/** How many pages `--url` asks the live site about: enough to see how the host answers, few enough to be quick and polite. */
const LIVE_PAGES = 10;
/** What a browser sends (Chrome's, for a page), and what an agent that wants Markdown sends. */
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const AGENT_ACCEPT = "text/markdown, text/html;q=0.9";

/**
 * `ssqch patrol --url`: asks the deployed site at `url` about up to ten of the build's pages with a
 * Markdown copy (the same ones each time: spread evenly over their sorted addresses), the way
 * agents and browsers do. An agent's `Accept: text/markdown` should get the copy, with `Vary:
 * Accept`; a browser's should still get the page; and each copy should be at its own address.
 * Adds what it finds to `p`'s findings (its files are addresses on the site).
 */
export async function patrolLive(p: Patrol, url: string, fetcher: typeof fetch = fetch): Promise<Patrol> {
	let base: URL;
	try { base = new URL(url); } catch { bail(`--url ${url}: not an address (https://example.com)`); }
	if (base.protocol !== "https:" && base.protocol !== "http:") bail(`--url ${url}: patrol asks a site over https or http`);
	const root = base.href.replace(/\/+$/, "");
	const pick = p.withCopies.length <= LIVE_PAGES ? p.withCopies : Array.from({ length: LIVE_PAGES }, (_, i) => p.withCopies[Math.floor((i * p.withCopies.length) / LIVE_PAGES)]);
	const found = new Map(p.findings.map((f) => [f.code, { ...f, files: [...f.files] }]));
	const say = (code: string, message: string, address: string) => {
		const f = found.get(code) ?? { code, message, files: [] };
		f.files.push(address);
		found.set(code, f);
	};
	const ask = async (address: string, accept: string) => {
		try {
			return await fetcher(root + address, { headers: { Accept: accept, "User-Agent": "ssqch-patrol" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
		} catch (e) {
			bail(`${root}${address}: the site didn't answer (${e instanceof Error ? e.message : String(e)})`);
		}
	};
	const markdown = (r: Response) => /^text\/markdown\b/i.test(r.headers.get("content-type") ?? "");
	for (const { page, copy } of pick) {
		const own = await ask(copy, "*/*");
		await own.body?.cancel();
		if (!own.ok) { say("live-copy-missing", "copies the build has that the live site doesn't serve at their own address (deploy the build, or check the host's rules)", copy); continue; }
		const agent = await ask(page, AGENT_ACCEPT);
		await agent.body?.cancel();
		if (!markdown(agent)) say("live-no-markdown", "pages that answer an agent's `Accept: text/markdown` with HTML: it gets the page's chrome, not the copy (`ssqch docs \"serving markdown\"` has the host's few lines)", page);
		else if (!/(^|,)\s*accept\s*(,|$)/i.test(agent.headers.get("vary") ?? "")) say("live-no-vary", "Markdown answers without `Vary: Accept`: a cache can hand the Markdown to a browser, or the page to an agent", page);
		const browser = await ask(page, BROWSER_ACCEPT);
		await browser.body?.cancel();
		if (markdown(browser)) say("live-browser-markdown", "pages that answer a browser with Markdown: people get the copy, not the page", page);
	}
	return { ...p, findings: [...found.values()], live: { url: root, asked: pick.length } };
}

/** The report, for people: the signs, then each kind of finding with up to five of its files. */
export function patrolText(p: Patrol, shown: string): string {
	const sign = (name: string, there: boolean) => `${name} ${there ? "posted" : "missing"}`;
	let out = `Patrol of ${shown}: ${p.pages} page${p.pages === 1 ? "" : "s"}, ${p.copies} with a Markdown copy\n`;
	out += `  ${[sign("robots.txt", p.signs.robots), sign("sitemap", p.signs.sitemap), sign("llms.txt", p.signs.llms), sign("404.html", p.signs.notFound)].join(", ")}\n`;
	if (p.live) out += `  Live at ${p.live.url}: asked about ${p.live.asked} page${p.live.asked === 1 ? "" : "s"} as an agent and as a browser\n`;
	if (!p.findings.length) return `${out}\nAll clear: nothing on the trail for an agent to trip on.\n`;
	out += "\n";
	for (const f of p.findings) {
		const n = f.files.length;
		out += `warn[${f.code}]: ${f.message}${n > 1 ? ` (${n})` : ""}\n`;
		for (const file of f.files.slice(0, 5)) out += `  ${file}\n`;
		if (n > 5) out += `  and ${n - 5} more (--format json lists them all)\n`;
	}
	const files = new Set(p.findings.flatMap((f) => f.files)).size;
	out += `\n${p.findings.length} kind${p.findings.length === 1 ? "" : "s"} of warning${files ? ` in ${files} file${files === 1 ? "" : "s"}` : ""}. \`ssqch docs "what patrol checks"\` says what each code means.\n`;
	return out;
}

/** The report as JSON (`schemaVersion` 1). */
export function patrolJson(p: Patrol, output: string): Record<string, unknown> {
	return { schemaVersion: 1, output, pages: p.pages, copies: p.copies, signs: p.signs, ...(p.live ? { live: p.live } : {}), warnings: p.findings.map((f) => ({ code: f.code, message: f.message, files: f.files })) };
}
