// Every pair of text (or a control's edge) and the background it sits on, in both modes, from the
// tokens in src/assets/site.css: WCAG 2's contrast ratio, 4.5:1 for text, 3:1 for large text (the
// display headings and the mileage boards' figures) and for what isn't text (a focus ring, a
// button's border, the mile markers). A new color in site.css goes in a pair here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/assets/site.css", import.meta.url), "utf8");
const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

/** Each token's color in light and dark mode: `light-dark(a, b)`, a plain color, or `var(--other)`. */
const tokens = new Map<string, { light: string; dark: string }>();
for (const [, name, value] of root.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
	const pair = /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/i.exec(value.trim());
	if (pair) tokens.set(name, { light: pair[1], dark: pair[2] });
	else if (/^#[0-9a-f]{6}$/i.test(value.trim())) tokens.set(name, { light: value.trim(), dark: value.trim() });
}
for (const [, name, other] of root.matchAll(/--([\w-]+):\s*var\(--([\w-]+)\);/g)) {
	const color = tokens.get(other);
	if (color) tokens.set(name, color);
}

function luminance(hex: string) {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const LARGE = 3;
const EDGE = 3;

/** [foreground, background, minimum, where] */
const pairs: [string, string, number, string][] = [
	["text", "background", TEXT, "body text"],
	["text", "chrome", TEXT, "text in cards, the header and the permit"],
	["text", "selected", TEXT, "the theme switch, hovered"],
	["heading", "background", TEXT, "headings, the mile markers' numbers"],
	["heading", "chrome", TEXT, "the brand, navigation, card headings"],
	["heading", "selected", TEXT, "a quiet button, hovered"],
	["muted", "background", TEXT, "fine print, the footer's labels"],
	["muted", "chrome", TEXT, "the permit's label, an example's engine, the camp"],
	["link", "background", TEXT, "links"],
	["link", "chrome", TEXT, "links in cards and the camp"],
	["marker", "background", TEXT, "the kickers"],
	["code", "surface", TEXT, "inline code"],
	["code", "background", TEXT, "inline code in a card"],
	["background", "heading", TEXT, "the skip link"],
	["sign-text", "sign", TEXT, "buttons and arrow signs"],
	["sign-text", "sign-hover", TEXT, "buttons and arrow signs, hovered"],
	["sign-text", "pine", TEXT, "a mileage board's words"],
	["board-figure", "pine", LARGE, "a mileage board's figure (2.4rem and up)"],
	["terminal-text", "terminal", TEXT, "terminal output"],
	["terminal-quiet", "terminal", TEXT, "a terminal's title and its quiet lines"],
	["terminal-prompt", "terminal", TEXT, "the prompt"],
	["terminal-voice", "terminal", TEXT, "the ranger's lines"],
	["terminal-error", "terminal", TEXT, "errors and removed lines"],
	["terminal-added", "terminal", TEXT, "added lines"],
	["exhibit-text", "paper", TEXT, "Exhibit A's caption"],
	["marker", "background", EDGE, "the focus ring"],
	["heading", "background", EDGE, "a mile marker's ring, a quiet button's border"],
	["muted", "background", EDGE, "the theme switch's border"],
	["muted", "chrome", EDGE, "the theme switch's border, in the header"],
];

for (const mode of ["light", "dark"] as const) {
	test(`text and edges have enough contrast in ${mode} mode`, () => {
		const failures = [];
		for (const [fg, bg, minimum, where] of pairs) {
			const a = tokens.get(fg);
			const b = tokens.get(bg);
			assert.ok(a, `site.css has no --${fg}`);
			assert.ok(b, `site.css has no --${bg}`);
			const r = ratio(a[mode], b[mode]);
			if (r < minimum) failures.push(`${where}: --${fg} ${a[mode]} on --${bg} ${b[mode]} is ${r.toFixed(2)}:1, under ${minimum}:1`);
		}
		assert.deepEqual(failures, []);
	});
}

test("every token a pair names is in site.css", () => {
	assert.ok(tokens.size > 20, `read only ${tokens.size} tokens from site.css's :root`);
});
