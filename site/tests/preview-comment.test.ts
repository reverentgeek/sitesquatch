// The preview comment (lib/preview-comment.ts): the address, and what `ssqch diff` found against
// main's last deploy, with the changed pages linked on the preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewComment } from "../lib/preview-comment.ts";

const url = "https://pr-7-sitesquatch.example.workers.dev";

test("without a diff, the comment is the preview's address", () => {
	assert.equal(previewComment({ url, sha: "abcdef123" }), `**Site preview:** ${url} (at abcdef1). It follows this pull request, and goes when it closes.`);
});

test("a diff's summary, and its pages linked on the preview", () => {
	const text = "Comparing a with b\n\nChanges found: 1 page (1 changed); 9 pages are the same. The stump has moved.\n";
	const body = previewComment({ url, sha: "abcdef123", main: "1234567890", text, diff: {
		same: false,
		added: ["/new/", "/feed.xml", "/pagefind/index/en_1.pf_index"],
		removed: ["/old/", "/pagefind/index/en_2.pf_index"],
		changed: [{ url: "/docs/install/", path: "docs/install/index.html", kind: "page", changes: ["text"] }, { url: "/docs/install.md", path: "docs/install.md", kind: "file", changes: [] }],
	} });
	assert.match(body, /\*\*Against main's last deploy\*\* \(1234567\), by `ssqch diff`: Changes found: 1 page/);
	assert.match(body, /Changed \(1\):\n\n- \[`\/docs\/install\/`\]\(https:\/\/pr-7-sitesquatch\.example\.workers\.dev\/docs\/install\/\) \(text\)\n/);
	assert.match(body, /Added \(1\):\n\n- \[`\/new\/`\]\(.*\/new\/\)\n/);
	assert.match(body, /Removed \(1\):\n\n- `\/old\/`/);
	assert.match(body, /Other files \(Markdown copies, assets, the search index\): 1 changed, 2 added, 1 removed\./);
	assert.ok(!body.includes("pagefind") && !body.includes("()"), body);
});

test("no differences is the summary alone", () => {
	const body = previewComment({ url, sha: "abcdef123", main: "1234567890", text: "No differences: 9 pages are the same. The stump has not moved.\n", diff: { same: true, added: [], removed: [], changed: [] } });
	assert.ok(body.endsWith("`ssqch diff`: No differences: 9 pages are the same. The stump has not moved."), body);
});
