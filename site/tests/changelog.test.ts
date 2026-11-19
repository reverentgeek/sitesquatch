// The changelog's entries (src/changelog/) against CHANGELOG.md, the complete record: the release
// in packages/ssqch/package.json has an entry (so a release can't ship without one), every
// release is in exactly one entry, an entry whose releases have a "Breaking" heading says what you
// might need to change, and the numbers in an entry are CHANGELOG.md's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO, SITE } from "../lib/split.ts";

const changelog = readFileSync(path.join(REPO, "CHANGELOG.md"), "utf8");

/** CHANGELOG.md's releases: `## 0.9.0 - 2026-11-18` and the text under it. */
const releases = new Map<string, { date: string; text: string }>();
for (const [, version, date, text] of changelog.matchAll(/^## (\d+\.\d+\.\d+(?:-[\w.]+)?) - (\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
	releases.set(version, { date, text });
}

interface Entry {
	file: string;
	release: string;
	releases: string[];
	date: string;
	lastRelease?: string;
	lastDate?: string;
	body: string;
}

/** The entries, with the front matter they use: plain `key: value` lines and `[a, b]` lists. */
const dir = path.join(SITE, "src", "changelog");
const entries: Entry[] = readdirSync(dir).filter((f) => f.endsWith(".md")).map((file) => {
	const text = readFileSync(path.join(dir, file), "utf8");
	const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? [];
	assert.ok(front, `${file} has no front matter`);
	const data: Record<string, string | string[]> = {};
	for (const [, key, value] of front.matchAll(/^(\w+): (.*)$/gm)) {
		data[key] = value.startsWith("[") ? value.slice(1, -1).split(",").map((v) => v.trim()) : value.replace(/^"|"$/g, "");
	}
	return { file, body, ...data } as unknown as Entry;
});

test("the release in packages/ssqch/package.json has an entry", () => {
	const { version } = JSON.parse(readFileSync(path.join(REPO, "packages/ssqch/package.json"), "utf8"));
	// A development version (0.10.0-dev) isn't a release yet.
	if (version.includes("-")) return;
	const entry = entries.find((e) => e.releases.includes(version));
	assert.ok(entry, `no entry in site/src/changelog/ has ${version} in its releases: write one (or a dated paragraph in its minor's entry) in the release commit`);
	if (!version.endsWith(".0")) assert.ok(entry.body.includes(version), `${entry.file} has ${version} in its releases, but no paragraph about it`);
});

test("every release in CHANGELOG.md is in exactly one entry, with its date", () => {
	for (const [version, { date }] of releases) {
		const covering = entries.filter((e) => e.releases.includes(version));
		assert.equal(covering.length, 1, `${version} is in ${covering.length} entries: ${covering.map((e) => e.file).join(", ") || "none"}`);
	}
	for (const e of entries) {
		for (const version of e.releases) assert.ok(releases.has(version), `${e.file} lists ${version}, which CHANGELOG.md doesn't have`);
		assert.equal(e.release, e.releases[0], `${e.file}: release is its first release`);
		assert.equal(e.date, releases.get(e.release)?.date, `${e.file}: date is ${e.release}'s`);
		if (e.releases.length > 1) {
			assert.equal(e.lastRelease, e.releases.at(-1), `${e.file}: lastRelease is its last release`);
			assert.equal(e.lastDate, releases.get(e.lastRelease!)?.date, `${e.file}: lastDate is ${e.lastRelease}'s`);
		}
	}
});

test("an entry whose releases break something says what you might need to change", () => {
	for (const e of entries) {
		const breaking = e.releases.filter((v) => /^### Breaking$/m.test(releases.get(v)?.text ?? ""));
		if (breaking.length) assert.match(e.body, /^## What you might need to change$/m, `${e.file}: ${breaking.join(", ")} ha${breaking.length === 1 ? "s" : "ve"} a "Breaking" heading`);
	}
});

test("the numbers in an entry are CHANGELOG.md's", () => {
	for (const e of entries) {
		const record = e.releases.map((v) => releases.get(v)?.text ?? "").join("\n");
		// Numbers of two or more characters, not versions (0.9, 0.8.0) or dates (2026-11-18).
		const prose = e.body.replace(/`[^`]*`/g, "").replace(/\b\d+\.\d+\.\d+\b|\b0\.\d+\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} \w+ \d{4}\b/g, "");
		for (const [n] of prose.matchAll(/\b\d[\d,.]*\d\b/g)) {
			assert.ok(record.includes(n), `${e.file} says ${n}, which its releases' sections of CHANGELOG.md don't`);
		}
	}
});
