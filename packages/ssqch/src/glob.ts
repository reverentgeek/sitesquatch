import { bail } from "./diagnostics.ts";

// ssqch's globs: `*`, `**`, `?`, `[abc]` and `{a,b}`, matched against whole paths with forward
// slashes. `*` and `?` stay inside one path segment; `**` crosses them.

const stripDot = (p: string) => p.replace(/^(\.\/)+/, "");

// A glob as a regular expression for whole paths (a leading `./` on the glob doesn't count).
// `**` crosses folders where it's a whole part of the path (`a/**`, `**/b`, `a/**/b`); anywhere
// else it's `*` twice. `loose` is the collection API's `byGlob`, where `**` crosses folders
// wherever it's written. (Line comments: a glob with `**` and a slash would end a block comment.)
export function globToRegExp(glob: string, { ignoreCase = false, loose = false } = {}): RegExp {
	const g = stripDot(glob);
	let re = "";
	let braces = 0;
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "*" && g[i + 1] === "*") {
			const whole = (i === 0 || g[i - 1] === "/") && (i + 2 === g.length || g[i + 2] === "/");
			if (!whole && !loose) {
				re += "[^/]*";
				i += 1;
				continue;
			}
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
	return new RegExp(`^${re}$`, ignoreCase ? "i" : "");
}

/** What's wrong with a glob, or nothing: a `[` or `{` that's never closed, a `}` that was never opened, a range that runs backwards. */
export function globProblem(glob: string): string | undefined {
	const g = stripDot(glob);
	let braces = 0;
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "[") {
			const end = g.indexOf("]", i + 2);
			if (end === -1) return "unclosed character class; missing ']'";
			const range = /(.)-(.)/.exec(g.slice(i + 1, end));
			if (range && range[1] > range[2]) return `invalid range; '${range[1]}' > '${range[2]}'`;
			i = end;
		} else if (c === "{") braces++;
		else if (c === "}") {
			if (!braces) return "unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)";
			braces--;
		}
	}
	return braces ? "unclosed alternate group; missing '}' (maybe escape '{' with '[{]'?)" : undefined;
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
		if (problem !== undefined) bail(`${what}: invalid glob ${JSON.stringify(glob)}: error parsing glob '${glob}': ${problem}`);
		return globToRegExp(glob);
	});
	if (!patterns.length) return () => false;
	return (p) => patterns.some((re) => re.test(p));
}
