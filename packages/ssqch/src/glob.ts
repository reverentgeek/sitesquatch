import { bail } from "./diagnostics.ts";
import { quoted } from "./quote.ts";

// ssqch's globs: `*`, `**`, `?`, `[abc]` and `{a,b}`, matched against whole paths with forward
// slashes. `*` and `?` stay inside one path segment; `**` crosses them. They read as 0.7's did,
// where the globset crate read them (with `literal_separator`), so this is a port of its parser:
// `\` escapes the next character (on Windows it's a folder separator instead, as it was there),
// `**` crosses folders only as a whole part of the path. A path is matched by its characters:
// `?` and each member of a class are one character (0.7 matched UTF-8 bytes, so `?` didn't match
// `é` and `[é]` matched nothing; decided 2026-11-18, and in the changelog).

const stripDot = (p: string) => p.replace(/^(\.\/)+/, "");

/** A glob globset couldn't read, with its words for why. */
class GlobProblem extends Error {}

type Token =
	| { kind: "literal"; char: string }
	| { kind: "any" }
	| { kind: "zeroOrMore" }
	| { kind: "recursivePrefix" }
	| { kind: "recursiveSuffix" }
	| { kind: "recursiveZeroOrMore" }
	| { kind: "class"; negated: boolean; ranges: Array<[string, string]> }
	| { kind: "alternates"; branches: Token[][] };

const UNOPENED = "unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)";
const UNCLOSED = "unclosed alternate group; missing '}' (maybe escape '{' with '[{]'?)";

/** globset's parser, step for step (`Parser` in its `glob.rs`). */
function parse(glob: string, windows: boolean): Token[] {
	const isSeparator = (c: string | undefined) => c === "/" || (windows && c === "\\");
	const chars = [...glob];
	let at = 0;
	let prev: string | undefined, cur: string | undefined;
	const bump = () => {
		prev = cur;
		cur = chars[at++];
		return cur;
	};
	const peek = () => chars[at];
	const stack: number[] = [];
	const branches: Token[][] = [[]];
	const push = (token: Token) => {
		const last = branches[branches.length - 1];
		if (!last) throw new GlobProblem(UNOPENED);
		last.push(token);
	};
	const star = () => {
		const before = prev;
		if (peek() !== "*") return push({ kind: "zeroOrMore" });
		bump();
		if (!branches[branches.length - 1].length) {
			if (peek() !== undefined && !isSeparator(peek())) {
				push({ kind: "zeroOrMore" });
				push({ kind: "zeroOrMore" });
			} else {
				push({ kind: "recursivePrefix" });
				bump();
			}
			return;
		}
		if (!isSeparator(before) && (branches.length <= 1 || (before !== "," && before !== "{"))) {
			push({ kind: "zeroOrMore" });
			push({ kind: "zeroOrMore" });
			return;
		}
		let suffix: boolean;
		const next = peek();
		if (next === undefined) {
			bump();
			suffix = true;
		} else if ((next === "," || next === "}") && branches.length >= 2) suffix = true;
		else if (isSeparator(next)) {
			bump();
			suffix = false;
		} else {
			push({ kind: "zeroOrMore" });
			push({ kind: "zeroOrMore" });
			return;
		}
		const popped = branches[branches.length - 1].pop()!;
		if (popped.kind === "recursivePrefix" || popped.kind === "recursiveSuffix") push(popped);
		else push({ kind: suffix ? "recursiveSuffix" : "recursiveZeroOrMore" });
	};
	const cls = () => {
		const ranges: Array<[string, string]> = [];
		const extend = (range: [string, string], c: string) => {
			range[1] = c;
			if (range[1].codePointAt(0)! < range[0].codePointAt(0)!) throw new GlobProblem(`invalid range; '${range[0]}' > '${range[1]}'`);
		};
		let negated = false;
		if (peek() === "!" || peek() === "^") {
			bump();
			negated = true;
		}
		let first = true, inRange = false;
		for (;;) {
			const c = bump();
			if (c === undefined) throw new GlobProblem("unclosed character class; missing ']'");
			if (c === "]") {
				if (!first) break;
				ranges.push(["]", "]"]);
			} else if (c === "-") {
				if (first) ranges.push(["-", "-"]);
				else if (inRange) {
					extend(ranges[ranges.length - 1], "-");
					inRange = false;
				} else inRange = true;
			} else {
				if (inRange) extend(ranges[ranges.length - 1], c);
				else ranges.push([c, c]);
				inRange = false;
			}
			first = false;
		}
		if (inRange) ranges.push(["-", "-"]);
		push({ kind: "class", negated, ranges });
	};
	for (let c = bump(); c !== undefined; c = bump()) {
		if (c === "?") push({ kind: "any" });
		else if (c === "*") star();
		else if (c === "[") cls();
		else if (c === "{") {
			stack.push(branches.length);
			branches.push([]);
		} else if (c === "}") {
			const start = stack.pop();
			if (start === undefined) throw new GlobProblem(UNOPENED);
			push({ kind: "alternates", branches: branches.splice(start) });
		} else if (c === ",") {
			if (!stack.length) push({ kind: "literal", char: "," });
			else branches.push([]);
		} else if (c === "\\") {
			if (!windows) {
				const next = bump();
				if (next === undefined) throw new GlobProblem("dangling '\\'");
				push({ kind: "literal", char: next });
			} else push({ kind: "literal", char: "/" });
		} else push({ kind: "literal", char: c });
	}
	if (branches.length > 1) throw new GlobProblem(UNCLOSED);
	return branches[0];
}

const code = (c: string) => c.codePointAt(0)!;
const isAsciiLetter = (n: number) => (n >= 0x41 && n <= 0x5a) || (n >= 0x61 && n <= 0x7a);
/** A character in a pattern (the expression has the `u` flag): letters and digits as they are, the rest by code. */
const charCode = (n: number) => (/[0-9A-Za-z]/.test(String.fromCodePoint(n)) ? String.fromCodePoint(n) : `\\u{${n.toString(16)}}`);

/** A character as a pattern: `[aA]` for a letter when case doesn't count (ASCII only, as in 0.7). */
const charLiteral = (n: number, ignoreCase: boolean) => (ignoreCase && isAsciiLetter(n) ? `[${String.fromCharCode(n | 0x20)}${String.fromCharCode(n & ~0x20)}]` : charCode(n));

/** A class of characters. Without case, ASCII letters in the class bring their other case along. */
function classPattern(negated: boolean, ranges: Array<[string, string]>, ignoreCase: boolean): string {
	const items: Array<[number, number]> = ranges.map(([from, to]) => [code(from), code(to)]);
	if (ignoreCase) {
		for (const [lo, hi] of [...items]) {
			for (const [start, end, shift] of [[0x41, 0x5a, 0x20], [0x61, 0x7a, -0x20]]) {
				const l = Math.max(lo, start), h = Math.min(hi, end);
				if (l <= h) items.push([l + shift, h + shift]);
			}
		}
	}
	return `[${negated ? "^" : ""}${items.map(([lo, hi]) => (lo === hi ? charCode(lo) : `${charCode(lo)}-${charCode(hi)}`)).join("")}]`;
}

function tokensPattern(tokens: Token[], ignoreCase: boolean): string {
	let re = "";
	for (const token of tokens) {
		switch (token.kind) {
			case "literal": re += [...token.char].map((c) => charLiteral(code(c), ignoreCase)).join(""); break;
			case "any": re += "[^/]"; break;
			case "zeroOrMore": re += "[^/]*"; break;
			case "recursivePrefix": re += "(?:/?|.*/)"; break;
			case "recursiveSuffix": re += "/.*"; break;
			case "recursiveZeroOrMore": re += "(?:/|/.*/)"; break;
			case "class": re += classPattern(token.negated, token.ranges, ignoreCase); break;
			case "alternates": {
				// An empty alternative is left out, so `{,a}` is `a`, as globset reads it.
				const parts = token.branches.map((branch) => tokensPattern(branch, ignoreCase)).filter((part) => part !== "");
				if (parts.length) re += `(?:${parts.join("|")})`;
			}
		}
	}
	return re;
}

/** Whether `\` is a folder separator in globs, as globset had it: on Windows. */
const WINDOWS = process.platform === "win32";

/**
 * A glob as a regular expression for whole paths (a leading `./` on the glob doesn't count), as
 * the globset crate read it for 0.7. `loose` is the collection API's `byGlob`, which 0.7 read
 * with its own code: there `**` crosses folders wherever it's written, and `\` is an ordinary
 * character. (Line comments: a glob with `**` and a slash would end a block comment.)
 */
export function globToRegExp(glob: string, { ignoreCase = false, loose = false, windows = WINDOWS } = {}): RegExp {
	if (loose) return looseGlobToRegExp(glob);
	const tokens = parse(stripDot(glob), windows);
	// The whole glob `**` matches every path, the empty one included.
	const re = tokens.length === 1 && tokens[0].kind === "recursivePrefix" ? ".*" : tokensPattern(tokens, ignoreCase);
	return new RegExp(`^${re}$`, "su");
}

/** `byGlob`'s reading of a glob: 0.7's collection API's own, kept as it was. */
function looseGlobToRegExp(glob: string): RegExp {
	const g = stripDot(glob);
	let re = "";
	let braces = 0;
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*" && g[i + 1] === "*") {
			const slash = g[i + 2] === "/";
			re += slash ? "(?:.*/)?" : ".*";
			i += slash ? 2 : 1;
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else if (c === "[") {
			const end = g.indexOf("]", i);
			if (end === -1) re += "\\[";
			else {
				re += "[" + g.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]";
				i = end;
			}
		} else if (c === "{") {
			braces++;
			re += "(?:";
		} else if (c === "}" && braces) {
			braces--;
			re += ")";
		} else if (c === "," && braces) re += "|";
		else re += c.replace(/[.+^$()|\\{}\]]/g, "\\$&");
	}
	return new RegExp(`^${re}$`);
}

/**
 * What's wrong with a glob, in globset's words, or nothing: a `[` or `{` that's never closed, a
 * `}` that was never opened, a range that runs backwards, or a `\` at the end.
 */
export function globProblem(glob: string, { windows = WINDOWS } = {}): string | undefined {
	try {
		parse(stripDot(glob), windows);
		return undefined;
	} catch (e) {
		if (e instanceof GlobProblem) return e.message;
		throw e;
	}
}

/** Whether a path has a wildcard, so it's a glob rather than a file or a folder. */
export const isGlob = (p: string) => /[*?[{]/.test(p);

/** The part of a glob before its first wildcard: `src/_img` for `src/_img/**\/*.png`. */
export function globBase(glob: string): string {
	const fixed: string[] = [];
	for (const part of stripDot(glob).split("/")) {
		if (isGlob(part)) break;
		fixed.push(part);
	}
	return fixed.join("/");
}

/** A matcher for any of `globs`; `what` (the config key) names a glob that can't be read. */
export function globSet(what: string, globs: Iterable<string>): (path: string) => boolean {
	const patterns = [...globs].map((given) => {
		const glob = stripDot(given);
		const problem = globProblem(glob);
		if (problem !== undefined) bail(`${what}: invalid glob ${quoted(glob)}: error parsing glob '${glob}': ${problem}`);
		return globToRegExp(glob);
	});
	if (!patterns.length) return () => false;
	return (p) => patterns.some((re) => re.test(p));
}
