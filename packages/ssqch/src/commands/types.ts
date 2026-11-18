// `ssqch types`: writes `ssqch.d.ts`, the types editors use for `ssqch.config.js`, with the
// site's content schemas added to the `Schemas` interface so `pages.byTag("posts")` knows each
// page's fields. Ported from `run_types` in `crates/ssqch/src/init.rs`.
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
}

/** `ssqch types`. Answers the exit code. */
export async function runTypes(options: TypesOptions): Promise<number> {
	const { root } = options;
	const out = root !== undefined && !path.isAbsolute(options.out) ? (/[\\/]$/.test(root) ? root + options.out : root + path.sep + options.out) : options.out;
	// Loading the config moves the process into the site's folder, so the file is named from here first.
	const file = path.resolve(out);
	// A site's schemas become types too. Without a config (or with one that doesn't load), the
	// types are the same for every site.
	let text = types();
	let schemas = 0;
	try {
		const env: Environment = "development";
		const config = await loadConfig({ root: root ?? ".", env, quiet: true });
		const found = await schemaTypes(config);
		schemas = found.length;
		text += schemaDeclarations(found);
	} catch (e) {
		process.stderr.write(`warn: couldn't read the site's config, so its schemas aren't in the types: ${messageOf(e)}\n`);
	}
	try {
		write(file, text, out);
	} catch (e) {
		process.stderr.write(`${red("error:")} ${(e as Error).message}\n`);
		return 1;
	}
	const withSchemas = schemas === 0 ? "" : schemas === 1 ? " (with 1 schema)" : ` (with ${schemas} schemas)`;
	process.stdout.write(`Wrote ${out}${withSchemas}. List it in jsconfig.json's "include" so editors pick it up.\n`);
	return 0;
}
