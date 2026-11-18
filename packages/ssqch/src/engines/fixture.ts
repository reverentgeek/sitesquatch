// What the engines' tests are made with: a site in a temporary folder, with its includes and a
// theme's, and the config's functions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Filter } from "../config.ts";
import type { EngineEnv, RenderContext } from "./engine.ts";

export interface TestSite {
	root: string;
	env: EngineEnv;
	/** A page's context: `name` from the input folder. */
	ctx(name: string, cacheKey?: string): RenderContext;
}

/** A site whose files (paths from its root, `_includes/...` and `themes/trail/_includes/...`) are `files`. */
export function testSite(files: Record<string, string>, filters: Record<string, Filter> = {}, strict = false): TestSite {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ssqch-engine-")));
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	}
	const includes = path.join(root, "_includes");
	const env = {
		config: { root, strict } as any,
		dirs: { root, input: root, includes } as any,
		includeDirs: [includes, path.join(root, "themes/trail/_includes")],
		globals: new Map(Object.entries(filters)),
		pipeFilters: new Map<string, Filter>(),
		strict,
	} satisfies EngineEnv;
	return { root, env, ctx: (name, cacheKey) => ({ name, inputPath: path.join(root, name), cacheKey }) };
}

/** What rendering threw, as its message. */
export async function failure(run: () => unknown): Promise<string> {
	try {
		await run();
	} catch (e) {
		return (e as Error).message;
	}
	throw new Error("expected the render to fail");
}
