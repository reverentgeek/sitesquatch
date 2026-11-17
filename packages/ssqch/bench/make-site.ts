// Writes the synthetic site the benchmark builds: N Markdown posts (front matter, about 450
// words, a list, a code block, links) in sections of 50, one Nunjucks layout that lists the
// post's section (50 links per page), and an index of every post. The same files every time: the
// words come from a seeded generator, not from the clock.
//
//     node bench/make-site.ts <folder> <posts>
import fs from "node:fs";
import path from "node:path";

const WORDS = "pine cone cedar trail ranger stump footprint sighting blurry photo camp lantern creek ridge moss fern owl elk marmot switchback summit map compass snack crunch old growth meadow".split(" ");

export function makeSite(out: string, posts: number): void {
	// mulberry32: a small generator that gives the same numbers on every machine.
	let state = 76;
	const random = () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
	const sentence = (words: number) => {
		const text = Array.from({ length: words }, () => WORDS[Math.floor(random() * WORDS.length)]).join(" ");
		return `${text[0].toUpperCase()}${text.slice(1)}.`;
	};
	const pad = (n: number, width: number) => String(n).padStart(width, "0");
	fs.mkdirSync(path.join(out, "src/posts"), { recursive: true });
	fs.mkdirSync(path.join(out, "src/_includes"), { recursive: true });
	fs.writeFileSync(path.join(out, "src/_includes/layout.njk"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{{ title }}</title></head>
<body><header><a href="/">Trail log</a></header>
<nav><ul>{% for p in collections[section] %}<li><a href="{{ p.url }}">{{ p.data.title }}</a></li>{% endfor %}</ul></nav>
<main><h1>{{ title }}</h1>
{{ content | safe }}
</main><footer>{{ section }}</footer></body></html>
`);
	fs.writeFileSync(path.join(out, "src/index.njk"), `---
title: Trail log
section: s0
layout: layout.njk
---
<ul>{% for p in collections.post %}<li><a href="{{ p.url }}">{{ p.data.title }}</a></li>{% endfor %}</ul>
`);
	for (let i = 0; i < posts; i++) {
		const section = `s${Math.floor(i / 50)}`;
		const body: string[] = [];
		for (let h = 0; h < 4; h++) {
			body.push(`## ${sentence(4).slice(0, -1)}\n`);
			body.push(`${Array.from({ length: 6 }, () => sentence(between(8, 16))).join(" ")} See [the next marker](/posts/${pad((i + 1) % posts, 5)}/) and *${sentence(3).slice(0, -1)}*.\n`);
		}
		body.push(`${Array.from({ length: 6 }, () => `- ${sentence(6)}`).join("\n")}\n`);
		body.push("```js\nexport const sightings = trail.filter((t) => t.blurry).map((t) => t.name);\nconsole.log(sightings.length);\n```\n");
		fs.writeFileSync(path.join(out, `src/posts/${pad(i, 5)}.md`), `---\ntitle: "${sentence(5).slice(0, -1)} ${i}"\ndate: 2024-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}\nlayout: layout.njk\nsection: ${section}\ntags: [post, ${section}]\n---\n${body.join("\n")}`);
	}
	fs.writeFileSync(path.join(out, "ssqch.config.js"), `import { defineConfig } from "ssqch";
export default defineConfig({
	dirs: { input: "src", output: "_out" },
	templateFormats: ["md", "njk"],
	markdownEngine: "njk",
	htmlEngine: "njk",
	markdown: { headingIds: false },
});
`);
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
	const [out, posts] = process.argv.slice(2);
	if (!out || !/^\d+$/.test(posts ?? "")) {
		process.stderr.write("usage: node bench/make-site.ts <folder> <posts>\n");
		process.exit(2);
	}
	makeSite(out, Number(posts));
	process.stdout.write(`${out}: ${posts} posts\n`);
}
