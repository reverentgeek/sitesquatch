// From crates/sitesquatch/src/diff.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compare, diffJson, diffText, isSame, keyed, tokens, withoutFingerprints } from "./diff.ts";
import type { DiffOptions } from "./diff.ts";
import { globToRegExp } from "./glob.ts";

const options = (more: Partial<DiffOptions> = {}): DiffOptions => ({ exact: false, ignore: [], only: undefined, lines: 0, ...more });

function build(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-diff-"));
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	}
	return dir;
}

test("html_is_compared_as_tags_and_text", () => {
	const t = tokens("<p class=\"a\">Hello\n   <b>big</b> world</p>\n<pre>  keep\n    this</pre><!-- c --><script>let a = '<p>';</script>");
	assert.deepEqual(t.map((x) => [x.tag, x.text]), [
		[true, "<p class=\"a\">"],
		[false, "Hello "],
		[true, "<b>"],
		[false, "big"],
		[true, "</b>"],
		[false, " world"],
		[true, "</p>"],
		[true, "<pre>"],
		[false, "  keep"],
		[false, "    this"],
		[true, "</pre>"],
		[true, "<!-- c -->"],
		[true, "<script>"],
		[false, "let a = '<p>';"],
		[true, "</script>"],
	]);
});

test("spaces_that_show_and_names_with_dates_count", () => {
	const texts = (html: string) => tokens(html).map((t) => t.text);
	// A space next to an inline tag is visible; between block tags it isn't.
	assert.notDeepEqual(texts("<p>a<b>b</b></p>"), texts("<p>a <b>b</b></p>"));
	assert.notDeepEqual(texts("<a>x</a><a>y</a>"), texts("<a>x</a> <a>y</a>"));
	assert.deepEqual(texts("<div><p>a</p><p>b</p></div>"), texts("<div>\n  <p>a</p>\n  <p>\n    b\n  </p>\n</div>\n"));
	// Whitespace that shows: in a field's value, a <pre>'s blank line, an attribute's value.
	assert.notDeepEqual(texts("<textarea>  pine</textarea>"), texts("<textarea>pine</textarea>"));
	assert.notDeepEqual(texts("<pre>pine\n\ncone</pre>"), texts("<pre>pine\ncone</pre>"));
	assert.notDeepEqual(texts("<p title=\"pine  cone\">Trail</p>"), texts("<p title=\"pine cone\">Trail</p>"));
	// Whitespace between attributes doesn't, and neither does the newline after <pre>.
	assert.deepEqual(texts("<p  class=\"a\"\n   id=\"b\" >x</p><br />"), texts("<p class=\"a\" id=\"b\">x</p><br/>"));
	assert.deepEqual(texts("<pre>\npine</pre>"), texts("<pre>pine</pre>"));
	// Unicode's spaces are spaces, as they were to 0.7 (a no-break space, a line separator).
	assert.deepEqual(texts("<p>pine   cone</p>"), texts("<p>pine cone</p>"));
	// A fingerprint goes; a date in a file's name stays.
	assert.equal(withoutFingerprints("/assets/index.3f2a1b4c.css /a/app.00112233.js"), "/assets/index.css /a/app.js");
	assert.equal(withoutFingerprints("/files/report.20240101.pdf /files/notes.19991231.txt"), "/files/report.20240101.pdf /files/notes.19991231.txt");
	assert.equal(withoutFingerprints("app.3f2a1b4c.json app.3f2a1b4c.jsx"), "app.json app.3f2a1b4c.jsx");
});

test("noise_is_ignored_and_changes_are_classified", async () => {
	const page = (css: string, body: string) => `<html><head><title>T</title><meta name="generator" content="SiteSquatch v${css.length}"><link rel="stylesheet" href="/assets/index.${css}.css" integrity="sha384-${css}"></head><body>${body}</body></html>`;
	const before = build({
		"index.html": page("11111111", "<h2 id=\"team\">Team</h2><p>Old   text</p>"),
		"same/index.html": page("11111111", "<p>Same</p>"),
		"markup/index.html": page("11111111", "<p>Words</p>"),
		"old/index.html": "<p>bye</p>",
		"assets/index.11111111.css": "body { color: red }\n",
		"assets/font.woff2": "\u0000\u0001",
		"feed.xml": "<rss>1</rss>\n",
	});
	const after = build({
		"index.html": page("22222222", "<h2>Team</h2>\n<p>New text</p>"),
		"same/index.html": page("22222222", "\n  <p>Same</p>\n"),
		"markup/index.html": page("22222222", "<p class=\"lead\">Words</p>"),
		"new/index.html": "<p>hi</p>",
		"assets/index.22222222.css": "body { color: blue }\n",
		"assets/font.woff2": "\u0000\u0001",
		"feed.xml": "<rss>1</rss>\n",
	});
	let report = await compare(before, after, options());
	assert.deepEqual(report.added, ["/new/"]);
	assert.deepEqual(report.removed, ["/old/"]);
	assert.deepEqual([report.unchangedPages, report.unchangedFiles], [1, 2]);
	const byUrl = (url: string) => report.changed.find((f) => f.url === url)!;
	const home = byUrl("/");
	assert.deepEqual(home.what, ["text", "markup"]);
	assert.deepEqual(home.notes, ["ids removed (links to them break): #team"]);
	assert.deepEqual(home.hunks, [{ removed: ["<h2 id=\"team\">"], added: ["<h2>"] }, { removed: ["Old text"], added: ["New text"] }]);
	assert.deepEqual(byUrl("/markup/").what, ["markup"]);
	const css = byUrl("/assets/index.css");
	assert.deepEqual(css.renamed, ["assets/index.11111111.css", "assets/index.22222222.css"]);
	assert.deepEqual(css.hunks, [{ removed: ["body { color: red }"], added: ["body { color: blue }"] }]);
	assert.equal(report.changed.length, 3);

	const text = diffText(report, 10, false);
	assert.ok(text.includes("  ~ /  (text and markup)\n      ids removed (links to them break): #team\n      - <h2 id=\"team\">\n      + <h2>\n      - Old text\n      + New text\n"), text);
	assert.ok(text.includes("  ~ /assets/index.css  (index.11111111.css -> index.22222222.css)"), text);
	assert.ok(text.endsWith("Changes found: 4 pages and 1 other file (3 changed, 1 added, 1 removed); 1 page and 2 other files are the same. The stump has moved.\n"), text);
	const json = diffJson(report, 1) as { same: boolean; summary: { changed: number }; changed: Array<{ url: string; changedLines: number; hunks: unknown[] }> };
	assert.equal(json.same, false);
	assert.equal(json.summary.changed, 3);
	const homeJson = json.changed.find((f) => f.url === "/")!;
	assert.equal(homeJson.changedLines, 4);
	assert.equal(homeJson.hunks.length, 1);

	// --exact: fingerprints are different files, and every byte counts.
	const exact = await compare(before, after, options({ exact: true }));
	assert.ok(exact.added.includes("/assets/index.22222222.css") && exact.removed.includes("/assets/index.11111111.css"));
	assert.ok(exact.changed.some((f) => f.url === "/same/"));

	// An ignore pattern, and only some files.
	report = await compare(before, after, options({ ignore: [/(Old|New)\s+text/gu], only: [globToRegExp("index.html")] }));
	assert.equal(report.changed.length, 1);
	assert.deepEqual(report.changed[0].what, ["markup"]);
	assert.ok(!report.added.length && !report.removed.length);

	// Pages that differ only in a date or a year say so.
	const datedBefore = build({ "index.html": "<footer>&copy; 2025, March 14, 2025</footer>", "a/index.html": "<time>2025-03-14</time>" });
	const datedAfter = build({ "index.html": "<footer>&copy; 2026, March 14, 2026</footer>", "a/index.html": "<time>2026-01-02T10:00:00Z</time>" });
	report = await compare(datedBefore, datedAfter, options());
	const dated = report.changed.find((f) => f.url === "/")!;
	assert.deepEqual(dated.onlyDates, ["2025", "2026"]);
	assert.deepEqual(dated.notes, ["only dates changed (2025 -> 2026)"]);
	assert.ok(diffText(report, 10, false).includes("\nAll 2 changed files differ only in dates or years. See `ssqch docs \"dates that changed\"`"));
	assert.equal((diffJson(report, 0) as { changed: Array<{ onlyDates: boolean }> }).changed[0].onlyDates, true);
	// Text that changed too isn't only dates.
	const words = build({ "index.html": "<footer>&copy; 2026, Cedar</footer>", "a/index.html": "<time>2025-03-14</time>" });
	report = await compare(datedBefore, words, options());
	assert.ok(report.changed.every((f) => f.onlyDates === undefined) && !diffText(report, 10, false).includes("only in dates"));

	assert.ok(isSame(await compare(before, before, options())));
	await assert.rejects(compare(path.join(before, "nope"), after, options()), /isn't a folder; give `ssqch diff` two build folders/);
	for (const dir of [before, after, datedBefore, datedAfter, words]) fs.rmSync(dir, { recursive: true });
});

test("lines_beyond_the_limit_are_counted_not_kept", async () => {
	const before = build({ "notes.txt": Array.from({ length: 30 }, (_, i) => `pine ${i}`).join("\n") });
	const after = build({ "notes.txt": Array.from({ length: 30 }, (_, i) => `cedar ${i}`).join("\n") });
	const report = await compare(before, after, options({ lines: 3 }));
	const file = report.changed[0];
	assert.equal(file.changedLines, 60);
	assert.deepEqual(file.hunks, [{ removed: ["pine 0", "pine 1", "pine 2"], added: [] }]);
	assert.ok(diffText(report, 3, false).includes("      - pine 2\n      ... 57 more changed lines (--lines 0 shows all)\n"));
	for (const dir of [before, after]) fs.rmSync(dir, { recursive: true });
});

test("a fingerprinted name that's another file's key keeps every file", async () => {
	// `x.11111111.css` keeps its own path (it shares `x.css` with `x.css`), and that path is
	// `x.11111111.22222222.css` without its last fingerprint: 0.7 lost one of the two.
	const keys = keyed(["x.11111111.22222222.css", "x.11111111.css", "x.css"], false);
	assert.deepEqual([...keys.values()].sort(), ["x.11111111.22222222.css", "x.11111111.css", "x.css"]);
	const before = build({ "x.css": "a", "x.11111111.css": "b", "x.11111111.22222222.css": "c" });
	const after = build({ "x.22222222.css": "a" });
	const report = await compare(before, after, options());
	assert.deepEqual([...report.removed].sort(), ["/x.11111111.22222222.css", "/x.11111111.css"]);
	assert.equal(report.unchangedFiles, 1);
	for (const dir of [before, after]) fs.rmSync(dir, { recursive: true });
});
