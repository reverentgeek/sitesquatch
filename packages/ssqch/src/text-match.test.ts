// `ssqch diff --text`, from the fresh vuejs.org run's 50-line script (tier 3 of a move that can't
// be byte for byte: 99.9% of 125,249 words, 99 of 109 pages identical).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { articleWords, commonWords, compareArticleText, textMatchJson, textMatchText, textSummary } from "./text-match.ts";

test("article_text_is_mains_words", () => {
	assert.deepEqual(articleWords("<nav>Menu</nav><main><h1>Pine&nbsp;cones</h1><p>Pack <b>out</b> what&#39;s in.<script>no()</script><!-- no --></p></main><footer>x</footer>"), ["Pine", "cones", "Pack", "out", "what's", "in."]);
	assert.deepEqual(articleWords("<body><article><p>Only this</p></article><aside>not</aside></body>"), ["Only", "this"]);
	assert.deepEqual(articleWords("<body><p>The body​</p></body>"), ["The", "body"]);
	assert.equal(commonWords(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"]), 3);
});

test("text_match_compares_each_page_and_sums_the_words", () => {
	const build = (files: Record<string, string>) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-text-"));
		for (const [rel, html] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), html); }
		return dir;
	};
	const ref = build({ "index.html": "<main><p>one two three four</p></main><script>app()</script>", "guide/a.html": "<main><p>Pack out what you pack in.</p></main>", "gone.html": "<main>bye</main>", "404.html": "<body></body>" });
	const port = build({ "index.html": "<main><p>one two three four</p></main>", "guide/a.html": "<main><p>Pack out what you carry in.</p></main>", "404.html": "<body></body>" });
	const report = compareArticleText(ref, port);
	assert.deepEqual(report.pages.map((p) => [p.url, p.match]), [["/404.html", 1], ["/gone.html", 0], ["/guide/a.html", 5 / 6], ["/index.html", 1]]);
	const s = textSummary(report);
	assert.deepEqual({ pages: s.pages, identical: s.identical, words: s.words, missing: s.missing, noText: s.noText }, { pages: 2, identical: 1, words: 10, missing: ["/gone.html"], noText: ["/404.html"] });
	const text = textMatchText(report, 10);
	assert.ok(text.includes("Identical: 1 of 2; at least 99%: 1; at least 95%: 1.\nAll the words together: 90.0% of 10 match.\n"), text);
	assert.ok(text.includes("   83.3%  /guide/a.html  (6 words, 6 in "), text);
	assert.ok(text.includes("\nThe text differs on 2 pages; `ssqch diff` without --text shows how.\n"), text);
	assert.equal((textMatchJson(report) as { summary: { match: number } }).summary.match, 0.9);
});
