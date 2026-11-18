// A site's folders, config file names and environments: what the dev server needs from the configuration,
// without loading what reading one takes (the engines, images, Rust plugins).
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import { slashes } from "./paths.ts";

/** Config file names looked for in the project root, in order. */
export const CONFIG_FILES = ["ssqch.config.js", "ssqch.config.mjs", "ssqch.config.cjs", "ssqch.config.ts", "ssqch.config.mts"];

/** The folders of a build, absolute. */
export interface Dirs {
	root: string;
	input: string;
	output: string;
	includes: string;
	/** Layouts: the includes folder unless `dirs.layouts` names another. */
	layouts: string;
	data: string;
}

export function dirsOf(config: Config): Dirs {
	const input = path.resolve(config.root, config.input);
	return {
		root: config.root,
		input,
		output: path.resolve(config.root, config.output),
		includes: path.resolve(input, config.includes),
		layouts: path.resolve(input, config.layouts ?? config.includes),
		data: path.resolve(input, config.data),
	};
}

/**
 * A folder of the site as 0.7's messages named it: the root (as it was given, when there's no
 * such folder) and the folder as the config gives it, joined as Rust joins paths, without
 * tidying them: `--root nope` and the input folder `.` are `nope/.`.
 */
export function shownDir(config: Config, configured: string): string {
	if (path.isAbsolute(configured)) return configured;
	const base = fs.existsSync(config.root) ? config.root : config.rootGiven;
	return /[\\/]$/.test(base) ? base + configured : base + path.sep + configured;
}

/**
 * The output folder as 0.7's reports named it: from the root (`dist`, or `../elsewhere` given
 * that way), or its whole path when it was given as one outside the root (`/srv/www`). With `/`,
 * or with the system's separator for the build summary, as 0.7 printed that one.
 */
export function shownOutput(config: Config, native = false): string {
	const output = path.resolve(config.root, config.output);
	const inside = output === config.root || output.startsWith(config.root + path.sep);
	const shown = path.isAbsolute(config.output) && !inside ? output : path.relative(config.root, output);
	return native ? shown : slashes(shown);
}

export type Environment = "production" | "development";

/** `dev` and `development`, `prod` and `production`, in any case. */
export function parseEnvironment(s: string): Environment | undefined {
	const name = s.toLowerCase();
	if (name === "dev" || name === "development") return "development";
	if (name === "prod" || name === "production") return "production";
	return undefined;
}
