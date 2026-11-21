import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { patrol, patrolJson, patrolText } from "./patrol.ts";

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

test("a folder that isn't there says so", () => {
	assert.throws(() => patrol(path.join(os.tmpdir(), "no-such-build-folder")), /isn't there: build the site first/);
});

test("a copy's links to the site's own files that aren't there are copy-broken, but not in code", () => {
	const dir = built({
		"robots.txt": "Sitemap: https://trail.example/sitemap.xml\n",
		"index.html": page("Home", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/index.md\">"),
		"index.md": `# Home\n\n${TEXT}\n\n![Stump](https://trail.example/content/stump.jpg)\n\n\`\`\`html\n<a href="/logout">Log out</a>\n\`\`\`\n`,
		"guide/index.html": page("Guide", `<p>${TEXT}</p>`, "<link rel=\"alternate\" type=\"text/markdown\" href=\"/guide/index.md\">"),
		"guide/index.md": `# Guide\n\n${TEXT} Use \`<a href="/nope">\` in a template.\n`,
	});
	const broken = patrol(dir).findings.find((f) => f.code === "copy-broken");
	assert.deepEqual(broken?.files, ["index.md"]);
});
