// The comment a pull request's site preview leaves (.github/workflows/site.yml): the preview's
// address, and what `ssqch diff` found between main's last deploy and this build, so a reviewer
// sees which pages a change touched without opening every one.
//
//   node lib/preview-comment.ts --url <preview> --sha <commit> [--main <commit> --diff <diff.json> --text <diff.txt>]
//
// Without --diff (main's build wasn't there to compare), the comment is the address alone.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

interface Changed { url?: string; path: string; changes: string[] }
interface Diff { same: boolean; added: string[]; removed: string[]; changed: Changed[] }

/** At most this many URLs in each list; the rest are counted. */
const LIST = 25;

export function previewComment(o: { url: string; sha: string; main?: string; diff?: Diff; text?: string }): string {
	const lines = [`**Site preview:** ${o.url} (at ${o.sha.slice(0, 7)}). It follows this pull request, and goes when it closes.`];
	if (o.diff === undefined) return lines.join("\n");
	// The summary is the text report's last line (`Changes found: ...` or `No differences ...`).
	const summary = (o.text ?? "").trim().split("\n").at(-1) ?? "";
	lines.push("", `**Against main's last deploy** (${(o.main ?? "").slice(0, 7)}), by \`ssqch diff\`: ${summary}`);
	if (o.diff.same) return lines.join("\n");
	const link = (url: string) => `[\`${url}\`](${o.url.replace(/\/$/, "")}${url})`;
	const list = (title: string, items: string[]) => {
		if (!items.length) return;
		lines.push("", `${title} (${items.length}):`, "", ...items.slice(0, LIST).map((i) => `- ${i}`));
		if (items.length > LIST) lines.push(`- and ${items.length - LIST} more`);
	};
	lines.push("", "<details><summary>What changed</summary>");
	list("Changed", o.diff.changed.map((c) => `${c.url ? link(c.url) : `\`/${c.path}\``} (${c.changes.join(", ")})`));
	list("Added", o.diff.added.map((u) => (u.endsWith("/") || u.endsWith(".html") ? link(u) : `\`${u}\``)));
	list("Removed", o.diff.removed.map((u) => `\`${u}\``));
	lines.push("", "</details>");
	return lines.join("\n");
}

if (import.meta.main) {
	const { values } = parseArgs({ options: { url: { type: "string" }, sha: { type: "string" }, main: { type: "string" }, diff: { type: "string" }, text: { type: "string" } } });
	if (!values.url || !values.sha) throw new Error("preview-comment: --url and --sha are required");
	const diff = values.diff ? (JSON.parse(readFileSync(values.diff, "utf8")) as Diff) : undefined;
	const text = values.text ? readFileSync(values.text, "utf8") : undefined;
	console.log(previewComment({ url: values.url, sha: values.sha, main: values.main, diff, text }));
}
