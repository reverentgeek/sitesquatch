import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { patrol, patrolJson, patrolLive, patrolText } from "./patrol.ts";

const built = (files: Record<string, string>) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-patrol-"));
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	}
	return dir;
};

const page = (title: string, body: string, head = "") => `<!doctype html><html><head><title>${title}</title><meta name="description" content="About ${title}">${head}</head><body><nav><a href="/">Home</a></nav><main><h1>${title}</h1>${body}</main></body></html>`;
const TEXT = "Pine cones fall in autumn, and rangers count them along the Cedar trail every morning before the hikers arrive at the stump.";

test("a site with its signs posted and its copies right is all clear", () => {
	const dir = built({
		"robots.txt": "User-agent: *\nAllow: /\n\nSitemap: https://trail.example/sitemap.xml\n",
		"sitemap.xml": "<urlset><url><loc>https://trail.example/</loc></url><url><loc>https://trail.example/guide/</loc></url></urlset>",
		"llms.txt": "# Trail\n\n## Pages\n\n- [Home](https://trail.example/index.md)\n- [Guide](https://trail.example/guide/index.md)\n",
		"index.html": page("Home", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/index.md\">"),
		"index.md": `# Home\n\n${TEXT}\n`,
		"guide/index.html": page("Guide", `<p>${TEXT}</p>`),
		"guide/index.md": `# Guide\n\n${TEXT}\n\nSee [home](https://trail.example/index.md).\n`,
		"404.html": page("Not found", "<p>Lost.</p>"),
	});
	const p = patrol(dir);
	assert.deepEqual(p.findings, []);
	assert.equal(p.pages, 2);
	assert.equal(p.copies, 2);
	assert.ok(patrolText(p, "dist").includes("All clear"));
	assert.deepEqual(patrolJson(p, "dist").signs, { robots: true, sitemap: true, llms: true, notFound: true });
});

// Pack Mule's search fetched 60 result cards, from a template with no layout: each was a page
// with no <h1> and no description, and patrol exited 1 for them.
test("a piece of HTML a script fetches isn't a page, and a minified page still is", () => {
	const dir = built({
		"index.html": page("Home", `<p>${TEXT}</p>`),
		"cards/cedar.html": "<article class=\"card\"><h3>Cedar Trail</h3><p>Four miles.</p></article>",
		"bare/index.html": "<title>Bare</title><p>A minified page without its optional tags.</p>",
	});
	const p = patrol(dir);
	assert.equal(p.pages, 2);
	assert.ok(!p.findings.some((f) => f.files.includes("cards/cedar.html")), JSON.stringify(p.findings));
	assert.ok(p.findings.some((f) => f.code === "no-h1" && f.files.includes("bare/index.html")), JSON.stringify(p.findings));
});

test("each kind of trouble has its code", () => {
	const dir = built({
		"llms.txt": "Trail\n\n- [Guide](guide/)\n- [Gone](/gone.md)\n- [Page](/guide/)\n",
		"index.html": "<html><body><h1>A</h1><h1>B</h1><p>No main.</p></body></html>",
		"guide/index.html": page("Guide", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/guide/index.md\">"),
		"guide/index.md": "# Guide\n\n{% for t in trails %}{{ t }}{% endfor %} and nothing else of the page\n\n```js\nlet open = true;\n\n[a](relative.md)\n",
		"other/index.html": page("Other", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/other/index.md\">"),
		"late/index.html": `<html><head><meta name="description" content="x"></head><body><nav>${"menu item ".repeat(80)}</nav><main><h1>Late</h1><p>Short.</p></main></body></html>`,
		"moved/index.html": "<html><head><meta http-equiv=\"refresh\" content=\"0; url=/guide/\"></head><body></body></html>",
	});
	const codes = patrol(dir).findings.map((f) => f.code).sort();
	assert.deepEqual(codes, ["content-late", "copy-differs", "copy-fence", "copy-missing", "h1s", "llms-broken", "llms-html", "llms-shape", "no-404", "no-description", "no-main", "no-robots", "no-sitemap", "relative-links"].sort());
	const p = patrol(dir);
	assert.deepEqual(p.findings.find((f) => f.code === "copy-missing")?.files, ["other/index.html"]);
	assert.equal(p.pages, 4, "the redirect isn't a page");
});

test("a copy is compared with its page without the page's navigation", () => {
	const map = `<nav aria-label="The map"><ul>${Array.from({ length: 40 }, (_, i) => `<li><a href="/docs/${i}/">Trail ${i}</a>: where the ranger counts pine cones on stretch ${i} of the Old Growth loop</li>`).join("")}</ul></nav>`;
	const files = (around: string) => built({
		"index.html": page("Docs", `<p>${TEXT}</p>${around}`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/index.md\">"),
		"index.md": `# Docs\n\n${TEXT}\n`,
	});
	const differs = (dir: string) => patrol(dir).findings.some((f) => f.code === "copy-differs");
	assert.equal(differs(files(map)), false, "a map in a <nav> is navigation");
	// The same map as the page's own text is what the page says, and the copy leaves it out.
	assert.equal(differs(files(map.replace(/<\/?nav[^>]*>/g, ""))), true);
});

test("a post's copy is compared with its article, not the related posts and comments around it", () => {
	const extras = `<section><h2>Related posts</h2><ul>${Array.from({ length: 30 }, (_, i) => `<li>Squatch Snacks for the Cedar trail, part ${i}, and the stump where the rangers meet</li>`).join("")}</ul></section>`;
	const dir = built({
		"post/index.html": `<!doctype html><html><head><title>Post</title><meta name="description" content="x"></head><body><main><article><h1>Post</h1><p>${TEXT}</p></article>${extras}</main></body></html>`,
		"post/index.md": `# Post\n\n${TEXT}\n`,
	});
	assert.equal(patrol(dir).findings.some((f) => f.code === "copy-differs"), false);
});

test("a minified page's list items are separate words, as a browser shows them", () => {
	const items = Array.from({ length: 12 }, (_, i) => `<li><a href="/p${i}/">Trail ${i}</a> <span>May 1, 20${10 + i}</span></li>`).join("");
	const dir = built({
		"archive/index.html": `<!doctype html><html><head><title>Archive</title><meta name="description" content="x"></head><body><main><h1>Archive</h1><ul>${items}</ul></main></body></html>`,
		"archive/index.md": `# Archive\n\n${Array.from({ length: 12 }, (_, i) => `- [Trail ${i}](https://trail.example/p${i}/index.md) May 1, 20${10 + i}`).join("\n")}\n`,
	});
	assert.equal(patrol(dir).findings.some((f) => f.code === "copy-differs"), false);
});

test("a folder that isn't there says so", () => {
	assert.throws(() => patrol(path.join(os.tmpdir(), "no-such-build-folder")), /isn't there: build the site first/);
});

test("a copy's links to the site's own files that aren't there are copy-broken, but not in code", () => {
	const dir = built({
		"robots.txt": "Sitemap: https://trail.example/sitemap.xml\n",
		"index.html": page("Home", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/index.md\">"),
		"index.md": `# Home\n\n${TEXT}\n\n![Stump](https://trail.example/content/stump.jpg)\n\n\`\`\`html\n<a href="/logout">Log out</a>\n\`\`\`\n`,
		"guide/index.html": page("Guide", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/guide/index.md\">"),
		"guide/index.md": `# Guide\n\n${TEXT} Use \`<a href="/nope">\` in a template.[^1]\n\n[^1]: Two raccoons agree.\n`,
	});
	// A footnote's text isn't a link (the new-blog run): guide/index.md isn't listed.
	const findings = patrol(dir).findings;
	assert.deepEqual(findings.find((f) => f.code === "copy-broken")?.files, ["index.md"]);
	assert.ok(!findings.some((f) => f.code === "relative-links"), JSON.stringify(findings));
});

test("an llms.txt that llms.txt links is checked too, and its pages count for coverage", () => {
	const dir = built({
		"robots.txt": "Sitemap: https://trail.example/sitemap.xml\n",
		"sitemap.xml": "<urlset><url><loc>https://trail.example/</loc></url><url><loc>https://trail.example/docs/</loc></url><url><loc>https://trail.example/docs/start/</loc></url></urlset>",
		"llms.txt": "# Trail\n\n## Pages\n\n- [Home](https://trail.example/index.md)\n- [Docs](https://trail.example/docs/llms.txt)\n",
		"docs/llms.txt": "# Trail: Docs\n\n## Pages\n\n- [Docs](https://trail.example/docs/index.md)\n- [Start](https://trail.example/docs/start/index.md)\n- [Gone](https://trail.example/docs/gone.md)\n",
		"index.html": page("Home", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/index.md\">"),
		"index.md": `# Home\n\n${TEXT}\n`,
		"docs/index.html": page("Docs", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/docs/index.md\">"),
		"docs/index.md": `# Docs\n\n${TEXT}\n`,
		"docs/start/index.html": page("Start", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/docs/start/index.md\">"),
		"docs/start/index.md": `# Start\n\n${TEXT}\n`,
		"404.html": page("Not found", "<p>Lost.</p>"),
	});
	const codes = patrol(dir).findings.map((f) => `${f.code} ${f.files.join(",")}`);
	assert.deepEqual(codes, ["llms-broken https://trail.example/docs/gone.md"]);
});

// `--url`: a host for the tests, answering as `serve` asks (Markdown for an agent, by its Accept).
const host = (serve: (path: string, accept: string) => { status?: number; type: string; vary?: string }) => (async (input: string | URL | Request, init?: RequestInit) => {
	const u = new URL(String(input));
	const accept = new Headers(init?.headers).get("accept") ?? "";
	const r = serve(u.pathname, accept);
	return new Response("x", { status: r.status ?? 200, headers: { "Content-Type": r.type, ...(r.vary ? { Vary: r.vary } : {}) } });
}) as typeof fetch;
const trail = () => built(Object.fromEntries(Array.from({ length: 14 }, (_, i) => [[`t${i}/index.html`, page(`Trail ${i}`, `<p>${TEXT}</p>`, `<link rel="alternate" type="text/markdown" href="/t${i}/index.md">`)], [`t${i}/index.md`, `# Trail ${i}\n\n${TEXT}\n`]]).flat()));

test("--url asks the live site about ten pages, the same ten each time, as an agent and as a browser", async () => {
	const asked: string[] = [];
	const good = host((path, accept) => {
		asked.push(path);
		if (path.endsWith(".md")) return { type: "text/markdown; charset=utf-8" };
		return accept.startsWith("text/markdown") ? { type: "text/markdown; charset=utf-8", vary: "Accept-Encoding, Accept" } : { type: "text/html" };
	});
	const p = await patrolLive(patrol(trail()), "https://trail.example/", good);
	assert.deepEqual(p.findings.filter((f) => f.code.startsWith("live-")), []);
	assert.deepEqual(p.live, { url: "https://trail.example", asked: 10 });
	// Spread over the sorted addresses: t0, t1, t10 ... (14 pages, every 1.4th).
	assert.equal(new Set(asked.filter((a) => !a.endsWith(".md"))).size, 10);
	assert.ok(patrolText(p, "dist").includes("Live at https://trail.example: asked about 10 pages"));
	assert.deepEqual(patrolJson(p, "dist").live, { url: "https://trail.example", asked: 10 });
	// Without --url, no live key: the report is as it was.
	assert.equal("live" in patrolJson(patrol(trail()), "dist"), false);
});

test("--url names what the host gets wrong", async () => {
	const codes = async (serve: Parameters<typeof host>[0]) => (await patrolLive(patrol(trail()), "https://trail.example", host(serve))).findings.map((f) => f.code).filter((c) => c.startsWith("live-"));
	// A static host: the page whatever is asked.
	assert.deepEqual(await codes((path) => ({ type: path.endsWith(".md") ? "text/markdown" : "text/html" })), ["live-no-markdown"]);
	// Markdown for an agent, but no Vary: Accept.
	assert.deepEqual(await codes((path, accept) => ({ type: path.endsWith(".md") || accept.startsWith("text/markdown") ? "text/markdown" : "text/html" })), ["live-no-vary"]);
	// Markdown for everyone.
	assert.deepEqual(await codes(() => ({ type: "text/markdown", vary: "Accept" })), ["live-browser-markdown"]);
	// The build isn't deployed: its copies aren't there.
	assert.deepEqual(await codes((path) => (path.endsWith(".md") ? { status: 404, type: "text/html" } : { type: "text/html" })), ["live-copy-missing"]);
	// The copy and the agent's Markdown are right, and the browser's page is a 404 (or a 500): not a pass.
	assert.deepEqual(await codes((path, accept) => (path.endsWith(".md") || accept.startsWith("text/markdown") ? { type: "text/markdown", vary: "Accept" } : { status: 404, type: "text/html" })), ["live-page-failed"]);
	assert.deepEqual(await codes((path, accept) => (path.endsWith(".md") ? { type: "text/markdown" } : accept.startsWith("text/markdown") ? { status: 500, type: "text/markdown", vary: "Accept" } : { type: "text/html" })), ["live-page-failed"]);
});

test("--url that isn't an address, or a site that doesn't answer, is an error", async () => {
	await assert.rejects(patrolLive(patrol(trail()), "trail.example"), /--url trail\.example: not an address/);
	await assert.rejects(patrolLive(patrol(trail()), "ftp://trail.example"), /over https or http/);
	const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
	await assert.rejects(patrolLive(patrol(trail()), "https://trail.example", down), /https:\/\/trail\.example\/t0\/index\.md: the site didn't answer \(fetch failed\)/);
});
