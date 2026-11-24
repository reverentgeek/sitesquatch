// The code "Serving Markdown to agents" gives people to paste does what ssqch serve does: its
// `prefersMarkdown` and `copyOf` answer as ssqch's own, and the Cloudflare Worker answers a
// request for Markdown with the copy and a browser's with the page. Read from the page itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prefersMarkdown as ours } from "../../packages/ssqch/src/serve/http.ts";
import { copyUrl } from "../../packages/ssqch/src/modules/llms.ts";
import { DOCS_DIR } from "../lib/docs.ts";

const page = readFileSync(path.join(DOCS_DIR, "serving-markdown.md"), "utf8");
const blocks = [...page.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]);
const shared = blocks[0];
const load = (code: string) => import(`data:text/javascript,${encodeURIComponent(code)}`);

test("the pasted functions answer as ssqch serve does", async () => {
	const { prefersMarkdown, copyOf, pageOf } = await load(`${shared}\nexport { prefersMarkdown, copyOf, pageOf };`);
	for (const accept of ["text/markdown", "text/markdown, text/html;q=0.9", "text/html, text/markdown;q=0.5", "*/*", "text/html,application/xhtml+xml,*/*;q=0.8", "text/markdown;q=0", ""]) assert.equal(prefersMarkdown(accept), ours(accept), accept);
	for (const url of ["/", "/guide/intro/", "/about.html"]) assert.equal(copyOf(url), copyUrl(url), url);
	assert.equal(copyOf("/guide/intro"), "/guide/intro/index.md");
	assert.equal(copyOf("/app.css"), undefined);
	// The Link header names the page as it's served: a folder's with its slash (Netlify, 2026-11-22).
	for (const [asked, page] of [["/guide/intro", "/guide/intro/"], ["/guide/intro/", "/guide/intro/"], ["/about.html", "/about.html"], ["/", "/"]]) assert.equal(pageOf(asked), page, asked);
});

test("the Cloudflare Worker answers Markdown to an agent and the page to a browser", async () => {
	const worker = blocks.find((b) => b.includes("env.ASSETS.fetch"));
	assert.ok(worker, "no Worker on the page");
	const { default: w } = await load(`${shared}\n${worker}`);
	const files: Record<string, [string, string]> = { "/guide/": ["<h1>Guide</h1>", "text/html"], "/guide/index.md": ["# Guide\n", "application/octet-stream"] };
	const env = { ASSETS: { fetch: async (r: Request | URL) => {
		const p = new URL(r instanceof URL ? r : r.url).pathname;
		return files[p] ? new Response(files[p][0], { headers: { "Content-Type": files[p][1] } }) : new Response("gone", { status: 404 });
	} } };
	const md = await w.fetch(new Request("https://trail.example/guide/", { headers: { Accept: "text/markdown" } }), env);
	assert.equal(md.headers.get("content-type"), "text/markdown; charset=utf-8");
	assert.equal(md.headers.get("link"), "<https://trail.example/guide/>; rel=\"canonical\"");
	assert.equal(md.headers.get("vary"), "Accept");
	assert.equal(await md.text(), "# Guide\n");
	const html = await w.fetch(new Request("https://trail.example/guide/", { headers: { Accept: "text/html" } }), env);
	assert.equal(await html.text(), "<h1>Guide</h1>");
	assert.equal(html.headers.get("vary"), "Accept");
});

test("the Netlify edge function answers Markdown to an agent and hands a browser on", async () => {
	const fn = blocks.find((b) => b.includes("export const config = { path: \"/*\""));
	assert.ok(fn, "no edge function on the page");
	// One block to paste, the shared functions in it as they are above (Squatch Snacks, D6).
	assert.ok(fn.startsWith(shared), "the edge function's block doesn't start with the shared functions");
	const { default: edge, config } = await load(fn);
	assert.deepEqual(config.header, { accept: "text/markdown" });
	const real = globalThis.fetch;
	globalThis.fetch = (async (u: URL) => (new URL(u).pathname === "/guide/index.md" ? new Response("# Guide\n") : new Response("gone", { status: 404 }))) as typeof fetch;
	try {
		const md = await edge(new Request("https://trail.example/guide/", { headers: { accept: "text/markdown" } }));
		assert.equal(md.headers.get("content-type"), "text/markdown; charset=utf-8");
		assert.equal(await md.text(), "# Guide\n");
		const bare = await edge(new Request("https://trail.example/guide", { headers: { accept: "text/markdown" } }));
		assert.equal(bare.headers.get("link"), "<https://trail.example/guide/>; rel=\"canonical\"");
		assert.equal(await edge(new Request("https://trail.example/guide/", { headers: { accept: "text/html" } })), undefined);
		assert.equal(await edge(new Request("https://trail.example/missing/", { headers: { accept: "text/markdown" } })), undefined);
	} finally {
		globalThis.fetch = real;
	}
});

test("sitesquatch.dev's worker.js is the page's Worker", () => {
	const worker = readFileSync(path.join(DOCS_DIR, "..", "..", "worker.js"), "utf8");
	assert.ok(worker.includes(shared) && worker.includes(blocks.find((b) => b.includes("env.ASSETS.fetch"))!), "worker.js and serving-markdown.md's Cloudflare code differ");
});
