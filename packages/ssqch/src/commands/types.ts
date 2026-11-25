// `ssqch types`: writes `ssqch.d.ts`, the types editors use for `ssqch.config.js`, with the
// site's content schemas added to the `Schemas` interface so `pages.byTag("posts")` knows each
// page's fields. Ported from `run_types` in `crates/ssqch/src/init.rs`.
import fs from "node:fs";
import path from "node:path";
import { types } from "../bundled.ts";
import { loadConfig } from "../config.ts";
import type { Environment } from "../config.ts";
import { messageOf, red } from "../diagnostics.ts";
import { write } from "./init.ts";
import { schemaTypes } from "../schema.ts";

/** The site's schemas as an addition to the `Schemas` interface. */
export function schemaDeclarations(schemas: Array<[name: string, typescript: string]>): string {
	if (schemas.length === 0) return "";
	let out = "\n// This site's `schemas`. Run `ssqch types` again after changing them.\ndeclare module \"ssqch\" {\n\tinterface Schemas {\n";
	for (const [name, typescript] of schemas) {
		const plain = /^[A-Za-z0-9_]+$/.test(name) && !/^\d/.test(name);
		out += `\t\t${plain ? name : JSON.stringify(name)}: ${typescript};\n`;
	}
	return out + "\t}\n}\n";
}


export interface TypesOptions {
	/** `--root` as it was given. */
	root: string | undefined;
	out: string;
	/** `--quiet`: nothing on success (a `beforeBuild` command's line above every build's report). */
	quiet?: boolean;
	/** `--schemas-only`: only the `Schemas` interface, for a browser program, which mustn't see the config's Node `process`. */
	schemasOnly?: boolean;
}

/**
 * The schemas alone: what browser code imports (`import type { Schemas } from "ssqch"`), without
 * the config's types, whose global `process` told a browser program that `process.env` was
 * there (Pack Mule). An empty `Schemas` when the site has none, so the import still works.
 */
export function schemasOnly(schemas: Array<[name: string, typescript: string]>): string {
	const header = "// The site's `schemas` as types, for code that runs in the browser: `import type { Schemas } from \"ssqch\"`.\n// Written by `ssqch types --schemas-only`; run it again after changing them. The config's own\n// types, Node's `process` among them, are in ssqch.d.ts.\n";
	return header + (schemas.length ? schemaDeclarations(schemas) : "\ndeclare module \"ssqch\" {\n\tinterface Schemas {}\n}\n");
}

/** Whether the root's jsconfig.json or tsconfig.json names `out` already, so the hint to list it is noise. */
function listed(root: string, out: string): boolean {
	const name = path.basename(out);
	return ["jsconfig.json", "tsconfig.json"].some((config) => {
		try { return fs.readFileSync(path.join(root, config), "utf8").includes(name); } catch { return false; }
	});
}

/** `ssqch types`. Answers the exit code. */
export async function runTypes(options: TypesOptions): Promise<number> {
	const { root } = options;
	const out = root !== undefined && !path.isAbsolute(options.out) ? (/[\\/]$/.test(root) ? root + options.out : root + path.sep + options.out) : options.out;
	// Loading the config moves the process into the site's folder, so the file is named from here first.
	const file = path.resolve(out);
	// A site's schemas become types too. Without a config (or with one that doesn't load), the
	// types are the same for every site.
	let text = options.schemasOnly ? "" : types();
	let schemas = 0;
	try {
		const env: Environment = "development";
		const config = await loadConfig({ root: root ?? ".", env, quiet: true });
		const found = await schemaTypes(config);
		schemas = found.length;
		text += options.schemasOnly ? schemasOnly(found) : schemaDeclarations(found);
	} catch (e) {
		process.stderr.write(`warn: couldn't read the site's config, so its schemas aren't in the types: ${messageOf(e)}\n`);
	}
	try {
		write(file, text, out);
	} catch (e) {
		process.stderr.write(`${red("error:")} ${(e as Error).message}\n`);
		return 1;
	}
	if (options.quiet) return 0;
	const withSchemas = schemas === 0 ? "" : schemas === 1 ? " (with 1 schema)" : ` (with ${schemas} schemas)`;
	const hint = options.schemasOnly ? ` Include it in the tsconfig.json of the code that runs in the browser.` : listed(path.dirname(file), out) ? "" : ` List it in jsconfig.json's "include" so editors pick it up.`;
	process.stdout.write(`Wrote ${out}${withSchemas}.${hint}\n`);
	return 0;
}
